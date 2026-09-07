const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

test('Family Preference Discovery integration against real PostgreSQL', async t => {
  const connectionString = process.env.TEST_DATABASE_URL;
  assert.ok(connectionString, 'TEST_DATABASE_URL required');
  assert.match(new URL(connectionString).pathname, /_test$/i);
  assert.notEqual(connectionString, process.env.DATABASE_URL);
  const { Pool, types } = require('pg');
  types.setTypeParser(1082, (val) => val);
  const { loadMigrations, migrate } = require('../../backend/v1/migrations');
  const { createRepository } = require('../../backend/v1/repository');
  const { createFamilyService } = require('../../backend/v1/family-service');
  const { createApp } = require('../../backend/v1/app');
  const { createTokens } = require('../../backend/v1/tokens');
  const schema = `fam_pref_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  let pool, server;
  t.after(async () => {
    try { if (server) await new Promise(resolve => server.close(resolve)); }
    finally { try { if (pool) await pool.end(); } finally {
      try { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await admin.end(); }
    } }
  });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  pool = new Pool({ connectionString, max: 6, connectionTimeoutMillis: 5000, options: `-c search_path=${schema}` });
  await migrate(pool, await loadMigrations(path.join(__dirname, '../../backend/v1/sql')));

  // Seed BASE recipes
  const recipeA = randomUUID();
  const recipeB = randomUUID();
  const recipeC = randomUUID();
  await pool.query(`INSERT INTO recipes(id,kind,family_id,source_type,name,base_servings,visibility,version,spiciness,cook_time_minutes)
    VALUES ($1,'BASE',NULL,'SEED','红烧肉',2,'PUBLIC',1,3,40)`, [recipeA]);
  await pool.query(`INSERT INTO recipes(id,kind,family_id,source_type,name,base_servings,visibility,version,spiciness,cook_time_minutes)
    VALUES ($1,'BASE',NULL,'SEED','清蒸鱼',2,'PUBLIC',1,1,25)`, [recipeB]);
  await pool.query(`INSERT INTO recipes(id,kind,family_id,source_type,name,base_servings,visibility,version,spiciness,cook_time_minutes)
    VALUES ($1,'BASE',NULL,'SEED','番茄炒蛋',2,'PUBLIC',1,2,15)`, [recipeC]);

  const repo = createRepository(pool);
  const families = createFamilyService(pool);
  const tokens = createTokens('fam-pref-test-key-'.repeat(3));
  const app = createApp({ repo, families, tokens, pool, wechat: { exchange: async () => { throw new Error('Not used'); } } });
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));

  const userA = await repo.upsertWechatUser({ openid: 'fpA', unionid: null });
  const userB = await repo.upsertWechatUser({ openid: 'fpB', unionid: null });
  const userC = await repo.upsertWechatUser({ openid: 'fpC', unionid: null });

  async function request(who, method, endpoint, body) {
    const uidMap = { A: userA.id, B: userB.id, C: userC.id };
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1${endpoint}`, {
      method, headers: { Authorization: `Bearer ${tokens.sign(uidMap[who])}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: response.status, body: data };
  }

  const familyA = (await request('A', 'POST', '/families', { name: '偏好家庭A' })).body.data;
  const familyB = (await request('B', 'POST', '/families', { name: '偏好家庭B' })).body.data;

  // Join userB and userC to familyA
  await request('A', 'POST', `/families/${familyA.id}/members/invite`, { nickname: '用户B' });
  // Use direct DB insert for member join (simpler than invite flow)
  await pool.query(`INSERT INTO family_members(id,family_id,user_id,role,status) VALUES ($1,$2,$3,'MEMBER','ACTIVE')`,
    [randomUUID(), familyA.id, userB.id]);
  await pool.query(`INSERT INTO family_members(id,family_id,user_id,role,status) VALUES ($1,$2,$3,'MEMBER','ACTIVE')`,
    [randomUUID(), familyA.id, userC.id]);

  // F1: empty data returns empty recipes
  await t.test('F1 no data returns empty', async () => {
    const r = await request('A', 'GET', `/families/${familyA.id}/family-preferences`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data.recipes, []);
  });

  // F2: single user favorite
  await t.test('F2 single user favorite appears', async () => {
    await pool.query(`INSERT INTO recipe_favorites(id,user_id,recipe_id) VALUES ($1,$2,$3)`,
      [randomUUID(), userA.id, recipeA]);
    const r = await request('A', 'GET', `/families/${familyA.id}/family-preferences`);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.recipes.length, 1);
    assert.equal(r.body.data.recipes[0].recipe_id, recipeA);
    assert.equal(r.body.data.recipes[0].family_score, 5); // favorite_count=1 * 5
    assert.ok(r.body.data.recipes[0].reasons.some(x => x.code === 'FAVORITE_COUNT'));
  });

  // F3: multi-user favorite aggregation
  await t.test('F3 multi-user favorite aggregates', async () => {
    await pool.query(`INSERT INTO recipe_favorites(id,user_id,recipe_id) VALUES ($1,$2,$3)`,
      [randomUUID(), userB.id, recipeA]);
    const r = await request('A', 'GET', `/families/${familyA.id}/family-preferences`);
    const rec = r.body.data.recipes.find(x => x.recipe_id === recipeA);
    assert.equal(rec.family_score, 10); // 2 favorites * 5
    assert.equal(rec.members.length, 2);
  });

  // F4: rating affects score
  await t.test('F4 rating affects score', async () => {
    await pool.query(`INSERT INTO recipe_ratings(id,family_id,user_id,recipe_id,meal_id,rating) VALUES ($1,$2,$3,$4,NULL,5)`,
      [randomUUID(), familyA.id, userA.id, recipeB]);
    const r = await request('A', 'GET', `/families/${familyA.id}/family-preferences`);
    const rec = r.body.data.recipes.find(x => x.recipe_id === recipeB);
    assert.ok(rec);
    assert.equal(rec.family_score, 15); // avg_rating=5 * 3
    assert.ok(rec.reasons.some(x => x.code === 'RATING_HIGH'));
  });

  // F5: active wish affects score
  await t.test('F5 active wish affects score', async () => {
    await pool.query(`INSERT INTO wishes(id,family_id,user_id,recipe_id,status) VALUES ($1,$2,$3,$4,'ACTIVE')`,
      [randomUUID(), familyA.id, userA.id, recipeC]);
    const r = await request('A', 'GET', `/families/${familyA.id}/family-preferences`);
    const rec = r.body.data.recipes.find(x => x.recipe_id === recipeC);
    assert.ok(rec);
    assert.equal(rec.family_score, 4); // wish_count=1 * 4
    assert.ok(rec.reasons.some(x => x.code === 'WISH_COUNT'));
  });

  // F6: completed meal history affects score
  await t.test('F6 completed meal history affects score', async () => {
    const mealId = randomUUID();
    await pool.query(`INSERT INTO meals(id,family_id,meal_date,meal_type,diners_count,status) VALUES ($1,$2,'2026-09-01','DINNER',2,'COMPLETED')`,
      [mealId, familyA.id]);
    await pool.query(`INSERT INTO meal_items(id,meal_id,recipe_id,source,servings,sort_order) VALUES ($1,$2,$3,'MANUAL',2,0)`,
      [randomUUID(), mealId, recipeC]);
    const r = await request('A', 'GET', `/families/${familyA.id}/family-preferences`);
    const rec = r.body.data.recipes.find(x => x.recipe_id === recipeC);
    // wish(4) + meal_count(1)*2 = 6
    assert.equal(rec.family_score, 6);
    assert.ok(rec.reasons.some(x => x.code === 'MEAL_HISTORY'));
  });

  // F7: family isolation - family B only sees its own members' signals
  await t.test('F7 family isolation', async () => {
    const r = await request('B', 'GET', `/families/${familyB.id}/family-preferences`);
    assert.equal(r.status, 200);
    // userB is in both families, so userB's favorite on recipeA appears in family B
    // But userA (only in family A) should NOT contribute to family B score
    const rec = r.body.data.recipes.find(x => x.recipe_id === recipeA);
    assert.ok(rec, 'recipeA should appear via userB favorite');
    assert.equal(rec.family_score, 5); // only userB's favorite (1 * 5), not userA+userB (10)
    assert.equal(rec.members.length, 1);
    assert.equal(rec.members[0].user_id, userB.id);
  });

  // F8: inactive member doesn't participate
  await t.test('F8 inactive member excluded', async () => {
    // Mark userC as LEFT
    await pool.query(`UPDATE family_members SET status='LEFT' WHERE family_id=$1 AND user_id=$2`,
      [familyA.id, userC.id]);
    // userC had no signals yet, but add a favorite to verify exclusion
    await pool.query(`INSERT INTO recipe_favorites(id,user_id,recipe_id) VALUES ($1,$2,$3)`,
      [randomUUID(), userC.id, recipeB]);
    const r = await request('A', 'GET', `/families/${familyA.id}/family-preferences`);
    const rec = r.body.data.recipes.find(x => x.recipe_id === recipeB);
    // userA rating=5 (15) + userC favorite excluded = still 15
    assert.equal(rec.family_score, 15);
    assert.equal(rec.members.length, 1); // only userA
  });

  // F9: deleted recipe not returned
  await t.test('F9 deleted recipe excluded', async () => {
    const deletedRecipe = randomUUID();
    await pool.query(`INSERT INTO recipes(id,kind,family_id,source_type,name,base_servings,visibility,version,deleted_at)
      VALUES ($1,'BASE',NULL,'SEED','已删除菜谱',2,'PUBLIC',1,now())`, [deletedRecipe]);
    await pool.query(`INSERT INTO recipe_favorites(id,user_id,recipe_id) VALUES ($1,$2,$3)`,
      [randomUUID(), userA.id, deletedRecipe]);
    const r = await request('A', 'GET', `/families/${familyA.id}/family-preferences`);
    assert.ok(!r.body.data.recipes.find(x => x.recipe_id === deletedRecipe));
  });

  // F10: stable sorting by score desc
  await t.test('F10 stable sorting by family_score', async () => {
    const r = await request('A', 'GET', `/families/${familyA.id}/family-preferences`);
    const scores = r.body.data.recipes.map(x => x.family_score);
    for (let i = 1; i < scores.length; i++) {
      assert.ok(scores[i - 1] >= scores[i], `score not sorted: ${scores[i-1]} < ${scores[i]}`);
    }
    // recipeA: 2 favorites = 10, recipeB: 1 rating=5 = 15, recipeC: wish4+meal2 = 6
    assert.equal(r.body.data.recipes[0].recipe_id, recipeB); // 15
    assert.equal(r.body.data.recipes[1].recipe_id, recipeA); // 10
    assert.equal(r.body.data.recipes[2].recipe_id, recipeC); // 6
  });

  // F11: repeated requests consistent
  await t.test('F11 repeated requests consistent', async () => {
    const r1 = await request('A', 'GET', `/families/${familyA.id}/family-preferences`);
    const r2 = await request('A', 'GET', `/families/${familyA.id}/family-preferences`);
    assert.deepEqual(r1.body.data.recipes.map(x => x.recipe_id), r2.body.data.recipes.map(x => x.recipe_id));
    assert.deepEqual(r1.body.data.recipes.map(x => x.family_score), r2.body.data.recipes.map(x => x.family_score));
  });

  // F12: cross-family access forbidden
  await t.test('F12 cross-family access forbidden', async () => {
    // userB is in familyA but not familyB (userB created familyB, so userB IS in familyB as OWNER)
    // Use userC (only in familyA, now LEFT) to access familyB
    const r = await request('C', 'GET', `/families/${familyB.id}/family-preferences`);
    assert.equal(r.status, 403);
  });
});
