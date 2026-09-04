const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

test('Family HTTP checkpoint against real PostgreSQL', async t => {
  const connectionString = process.env.TEST_DATABASE_URL;
  assert.ok(connectionString, 'TEST_DATABASE_URL required; no skipped integration tests');
  assert.match(new URL(connectionString).pathname, /_test$/i);
  assert.notEqual(connectionString, process.env.DATABASE_URL);
  const { Pool } = require('pg');
  const { loadMigrations, migrate } = require('../../backend/v1/migrations');
  const { createRepository } = require('../../backend/v1/repository');
  const { createFamilyService } = require('../../backend/v1/family-service');
  const { createApp } = require('../../backend/v1/app');
  const { createTokens } = require('../../backend/v1/tokens');
  const schema = `kitchen_test_${randomUUID().replaceAll('-', '')}`;
  assert.match(schema, /^kitchen_test_[a-f0-9]{32}$/);
  const admin = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  let pool, server;
  t.after(async () => {
    try { if (server) await new Promise(resolve => server.close(resolve)); }
    finally { try { if (pool) await pool.end(); } finally {
      try { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await admin.end(); }
    } }
  });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  pool = new Pool({ connectionString, max: 6, connectionTimeoutMillis: 5000, options: `-c search_path=${schema} -c statement_timeout=10000 -c lock_timeout=10000` });
  await migrate(pool, await loadMigrations(path.join(__dirname, '../../backend/v1/sql')));
  const repo = createRepository(pool), families = createFamilyService(pool);
  const users = {};
  for (const name of ['A','B','C','D']) users[name] = await repo.upsertWechatUser({ openid: name, unionid: null });
  const tokens = createTokens('family-integration-test-key-'.repeat(3));
  const app = createApp({ repo, families, tokens, wechat: { exchange: async () => { throw new Error('Not used'); } } });
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  async function request(who, method, endpoint, body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1${endpoint}`, {
      method, headers: { Authorization: `Bearer ${tokens.sign(users[who].id)}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  }
  let fa, fb;
  await t.test('A creates family, OWNER and default settings atomically', async () => {
    const result = await request('A','POST','/families',{ name: 'Family A' });
    assert.equal(result.status,201); fa = result.body.data;
    assert.equal(fa.role,'OWNER'); assert.equal(fa.settings.default_diners,2);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM family_members WHERE family_id=$1 AND role=$2',[fa.id,'OWNER'])).rows[0].n,1);
    fb = (await request('C','POST','/families',{name:'Family B'})).body.data;
  });
  await t.test('failure inserting settings rolls back family and OWNER too', async () => {
    const before = (await pool.query('SELECT (SELECT count(*) FROM families) AS f,(SELECT count(*) FROM family_members) AS m,(SELECT count(*) FROM family_settings) AS s')).rows[0];
    await pool.query(`CREATE FUNCTION fail_settings() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END $$;
      CREATE TRIGGER fail_settings BEFORE INSERT ON family_settings FOR EACH ROW EXECUTE FUNCTION fail_settings()`);
    try { assert.equal((await request('A','POST','/families',{name:'Must rollback'})).status,500); }
    finally { await pool.query('DROP TRIGGER fail_settings ON family_settings; DROP FUNCTION fail_settings()'); }
    assert.deepEqual((await pool.query('SELECT (SELECT count(*) FROM families) AS f,(SELECT count(*) FROM family_members) AS m,(SELECT count(*) FROM family_settings) AS s')).rows[0],before);
  });
  await t.test('invite_code join and repeat join are idempotent', async () => {
    const joining=await Promise.all([request('B','POST','/families/join',{invite_code:fa.invite_code}),request('B','POST','/families/join',{invite_code:fa.invite_code})]);
    assert.ok(joining.every(result=>result.status===200));
    const first = joining[0];
    assert.equal(first.status,200); assert.equal(first.body.data.role,'MEMBER');
    assert.equal((await request('B','POST','/families/join',{invite_code:fa.invite_code})).status,200);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM family_members WHERE family_id=$1 AND user_id=$2',[fa.id,users.B.id])).rows[0].n,1);
  });
  await t.test('join rejects code and inviteCode aliases', async () => {
    for (const body of [{code:fa.invite_code},{inviteCode:fa.invite_code},{invite_code:fa.invite_code,code:'x'}]) assert.equal((await request('B','POST','/families/join',body)).status,400);
  });
  await t.test('parallel repeat joins retain one ACTIVE membership',async()=>{
    const results=await Promise.all(Array.from({length:3},()=>request('B','POST','/families/join',{invite_code:fa.invite_code})));
    assert.ok(results.every(r=>r.status===200));
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM family_members WHERE family_id=$1 AND user_id=$2',[fa.id,users.B.id])).rows[0].n,1);
  });
  await t.test('nonmembers cannot read either family or nested settings/members', async () => {
    for (const suffix of ['', '/members','/settings']) {
      assert.equal((await request('C','GET',`/families/${fa.id}${suffix}`)).status,403);
      assert.equal((await request('A','GET',`/families/${fb.id}${suffix}`)).status,403);
    }
  });
  let bMember;
  await t.test('MEMBER cannot update family/settings, rotate invite or change roles', async () => {
    const members = (await request('A','GET',`/families/${fa.id}/members`)).body.data;
    bMember = members.find(m => m.user_id === users.B.id);
    assert.equal((await request('B','PATCH',`/families/${fa.id}`,{version:1,name:'No'})).status,403);
    assert.equal((await request('B','PATCH',`/families/${fa.id}/settings`,{version:1,default_diners:4})).status,403);
    assert.equal((await request('B','POST',`/families/${fa.id}/invite-code/rotate`,{})).status,403);
    assert.equal((await request('B','PATCH',`/families/${fa.id}/members/${bMember.id}`,{role:'OWNER'})).status,403);
  });
  await t.test('ADMIN may maintain family/settings but not OWNER-only membership', async () => {
    assert.equal((await request('A','PATCH',`/families/${fa.id}/members/${bMember.id}`,{role:'ADMIN'})).status,200);
    const update = await request('B','PATCH',`/families/${fa.id}`,{version:1,name:'Renamed'});
    assert.equal(update.status,200); assert.equal(update.body.data.version,2);
    assert.equal((await request('B','PATCH',`/families/${fa.id}/members/${bMember.id}`,{role:'OWNER'})).status,403);
  });
  await t.test('family optimistic concurrency rejects stale version', async () => {
    assert.equal((await request('A','PATCH',`/families/${fa.id}`,{version:1,name:'Lost update'})).status,409);
    assert.equal((await request('A','GET',`/families/${fa.id}`)).body.data.name,'Renamed');
  });
  await t.test('settings version and cookware replace are atomic', async () => {
    const update = await request('B','PATCH',`/families/${fa.id}/settings`,{version:1,default_diners:4,cookware:['WOK','RICE_COOKER']});
    assert.equal(update.status,200); assert.equal(update.body.data.version,2);
    assert.deepEqual(update.body.data.cookware,['RICE_COOKER','WOK']);
    assert.equal((await request('A','PATCH',`/families/${fa.id}/settings`,{version:1,default_diners:9,cookware:[]})).status,409);
    const current = (await request('A','GET',`/families/${fa.id}/settings`)).body.data;
    assert.equal(current.default_diners,4); assert.equal(current.cookware.length,2);
    assert.equal((await request('A','PATCH',`/families/${fa.id}/settings`,{version:2,repeat_strong_days:30})).status,422);
    assert.equal((await request('A','GET',`/families/${fa.id}/settings`)).body.data.version,2);
  });
  await t.test('last OWNER cannot be demoted or removed', async () => {
    const aMember = (await request('A','GET',`/families/${fa.id}/members`)).body.data.find(m=>m.user_id===users.A.id);
    for (const body of [{role:'MEMBER'},{status:'REMOVED'}]) assert.equal((await request('A','PATCH',`/families/${fa.id}/members/${aMember.id}`,body)).status,409);
  });
  await t.test('settings aggregate stays coherent during an interleaved writer',async()=>{
    let reach, resume, writerConnected;
    const reached=new Promise(resolve=>{reach=resolve;});
    const paused=new Promise(resolve=>{resume=resolve;});
    const connected=new Promise(resolve=>{writerConnected=resolve;});
    const reader=createFamilyService({connect:async()=>{
      const client=await pool.connect();
      return {release:error=>client.release(error),query:async(sql,params)=>{
        const result=await client.query(sql,params);
        if(sql.startsWith('SELECT * FROM family_settings')){reach();await paused;}
        return result;
      }};
    }});
    const writer=createFamilyService({connect:async()=>{const client=await pool.connect();writerConnected(client.processID);return client;}});
    const reading=reader.getSettings(fa.id,users.A.id);
    await Promise.race([reached,reading]);
    let done=false,blocked=false;
    const writing=writer.updateSettings(fa.id,users.A.id,{version:2,default_diners:5,cookware:['AIR_FRYER']}).finally(()=>{done=true;});
    try {
      const pid=await Promise.race([connected,writing]);
      const deadline=Date.now()+5000;
      while(!done&&!blocked&&Date.now()<deadline){
        blocked=(await pool.query('SELECT cardinality(pg_blocking_pids($1)) AS n',[pid])).rows[0].n>0;
        if(!blocked) await new Promise(resolve=>setTimeout(resolve,10));
      }
    } finally {resume();}
    const before=await reading;const after=await writing;
    assert.equal(blocked,true);
    assert.equal(before.version,2);assert.equal(before.default_diners,4);
    assert.deepEqual(before.cookware,['RICE_COOKER','WOK']);
    assert.equal(after.version,3);assert.deepEqual(after.cookware,['AIR_FRYER']);
  });
  await t.test('profile is limited to nickname/avatar_url and cannot mutate identity', async () => {
    assert.equal((await request('B','PATCH','/me',{nickname:'B new',avatar_url:'https://example.com/avatar.png'})).status,200);
    for (const body of [{wechat_openid:'A'},{user_id:users.A.id},{avatarUrl:'https://example.com/a'},{avatar_url:'javascript:alert(1)'}]) assert.equal((await request('B','PATCH','/me',body)).status,400);
    assert.equal((await request('B','GET','/me')).body.data.nickname,'B new');
    assert.equal((await repo.getUser(users.A.id)).nickname,null);
  });
  await t.test('snake_case only and server ownership fields cannot be spoofed', async () => {
    for (const body of [{name:'Spoof',created_by_user_id:users.C.id},{familyName:'wrong'}]) assert.equal((await request('A','POST','/families',body)).status,400);
    assert.equal((await request('A','PATCH',`/families/${fa.id}/settings`,{version:2,defaultDiners:9})).status,400);
  });
  await t.test('ADMIN rotation invalidates old invite code', async () => {
    const result = await request('B','POST',`/families/${fa.id}/invite-code/rotate`,{});
    assert.equal(result.status,200); assert.notEqual(result.body.data.invite_code,fa.invite_code);
    assert.equal((await request('D','POST','/families/join',{invite_code:fa.invite_code})).status,422);
    fa.invite_code = result.body.data.invite_code;
  });
  await t.test('removed member is denied; service rechecks authorization in transaction', async () => {
    await request('D','POST','/families/join',{invite_code:fa.invite_code});
    const member = (await request('A','GET',`/families/${fa.id}/members`)).body.data.find(m=>m.user_id===users.D.id);
    assert.equal((await request('A','PATCH',`/families/${fa.id}/members/${member.id}`,{status:'REMOVED'})).status,200);
    assert.equal((await request('D','GET',`/families/${fa.id}`)).status,403);
    assert.equal((await request('D','POST','/families/join',{invite_code:fa.invite_code})).status,403);
    await assert.rejects(families.updateFamily(fa.id,users.D.id,{version:3,name:'bypass'}), error=>error.status===403);
  });
  await t.test('simultaneous OWNER demotions cannot leave zero OWNERs', async () => {
    await request('A','PATCH',`/families/${fa.id}/members/${bMember.id}`,{role:'OWNER'});
    const members = (await request('A','GET',`/families/${fa.id}/members`)).body.data;
    const aMember = members.find(m=>m.user_id===users.A.id);
    const results = await Promise.all([
      request('A','PATCH',`/families/${fa.id}/members/${aMember.id}`,{role:'MEMBER'}),
      request('B','PATCH',`/families/${fa.id}/members/${bMember.id}`,{role:'MEMBER'})
    ]);
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM family_members WHERE family_id=$1 AND role='OWNER' AND status='ACTIVE'",[fa.id])).rows[0].n,1);
  });
});
