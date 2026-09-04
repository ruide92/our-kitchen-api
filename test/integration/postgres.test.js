const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

test('real PostgreSQL: core migrations, stable identity, uniqueness, membership isolation and rollback', async t => {
  const connectionString = process.env.TEST_DATABASE_URL;
  assert.ok(connectionString, 'TEST_DATABASE_URL is required; integration checks are NOT skipped');
  const url = new URL(connectionString);
  assert.match(url.pathname, /_test$/i, 'Use a dedicated database ending in _test');
  assert.notEqual(connectionString, process.env.DATABASE_URL, 'Test URL must not equal application DATABASE_URL');
  const { Pool } = require('pg');
  const { loadMigrations, migrate } = require('../../backend/v1/migrations');
  const { createRepository } = require('../../backend/v1/repository');
  const { withTransaction } = require('../../backend/v1/db');
  const schema = `kitchen_test_${randomUUID().replaceAll('-', '')}`;
  assert.match(schema, /^kitchen_test_[a-f0-9]{32}$/);
  const admin = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  let pool;
  t.after(async () => {
    try { if (pool) await pool.end(); }
    finally {
      try { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
      finally { await admin.end(); }
    }
  });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  pool = new Pool({ connectionString, options: `-c search_path=${schema}`, max: 2, connectionTimeoutMillis: 5000 });
  const migrations = await loadMigrations(path.join(__dirname, '../../backend/v1/sql'));
  await migrate(pool, migrations); await migrate(pool, migrations);
  const repo = createRepository(pool);
  const a = await repo.upsertWechatUser({ openid: 'A', unionid: null });
  const again = await repo.upsertWechatUser({ openid: 'A', unionid: null });
  assert.equal(a.id, again.id);
  const b = await repo.upsertWechatUser({ openid: 'B', unionid: null });
  const fa = randomUUID(); const fb = randomUUID();
  await withTransaction(pool, async tx => {
    for (const [family, user, code] of [[fa, a, 'TESTA1'], [fb, b, 'TESTB1']]) {
      await tx.query('INSERT INTO families(id,name,invite_code,created_by_user_id) VALUES($1,$2,$3,$4)', [family, 'Test family', code, user.id]);
      await tx.query("INSERT INTO family_members(id,family_id,user_id,role) VALUES($1,$2,$3,'OWNER')", [randomUUID(), family, user.id]);
      await tx.query('INSERT INTO family_settings(family_id) VALUES($1)', [family]);
    }
  });
  assert.equal((await repo.listFamilies(a.id)).length, 1);
  assert.equal((await repo.getMembership(fa, a.id)).role, 'OWNER');
  assert.equal(await repo.getMembership(fa, b.id), null);
  await assert.rejects(pool.query("INSERT INTO users(id,wechat_openid) VALUES($1,'A')", [randomUUID()]), { code: '23505' });
  await assert.rejects(withTransaction(pool, async tx => { await tx.query("UPDATE families SET name='must rollback' WHERE id=$1", [fa]); throw new Error('rollback'); }), /rollback/);
  assert.equal((await pool.query('SELECT name FROM families WHERE id=$1', [fa])).rows[0].name, 'Test family');
});
