const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

test('Favorites & Ratings integration against real PostgreSQL', async t => {
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
  const schema = `fav_rat_${randomUUID().replaceAll('-', '')}`;
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

  // Seed BASE recipe
  const recipeBase = randomUUID();
  await pool.query(`INSERT INTO recipes(id,kind,family_id,source_type,name,base_servings,visibility,version)
    VALUES ($1,'BASE',NULL,'SEED','测试基础菜谱',2,'PUBLIC',1)`, [recipeBase]);

  const repo = createRepository(pool);
  const families = createFamilyService(pool);
  const tokens = createTokens('fav-rat-test-key-'.repeat(3));
  const app = createApp({ repo, families, tokens, pool, wechat: { exchange: async () => { throw new Error('Not used'); } } });
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));

  const userA = await repo.upsertWechatUser({ openid: 'favA', unionid: null });
  const userB = await repo.upsertWechatUser({ openid: 'favB', unionid: null });

  async function request(who, method, endpoint, body) {
    const uid = who === 'A' ? userA.id : userB.id;
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1${endpoint}`, {
      method, headers: { Authorization: `Bearer ${tokens.sign(uid)}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: response.status, body: data };
  }

  // Create families via HTTP API
  const familyA = (await request('A', 'POST', '/families', { name: '家庭A' })).body.data;
  const familyB = (await request('B', 'POST', '/families', { name: '家庭B' })).body.data;

  // FAMILY recipe for family B (private)
  const recipeFamilyB = randomUUID();
  await pool.query(`INSERT INTO recipes(id,kind,family_id,source_type,name,base_servings,visibility,version,created_by_user_id,updated_by_user_id)
    VALUES ($1,'FAMILY',$2,'MANUAL','家庭B私有菜谱',2,'PRIVATE',1,$3,$3)`, [recipeFamilyB, familyB.id, userB.id]);

  // P1: favorite PUT → viewer.is_favorite=true
  await t.test('P1 favorite PUT sets viewer.is_favorite', async () => {
    const r = await request('A', 'PUT', `/families/${familyA.id}/recipes/${recipeBase}/favorite`);
    assert.equal(r.status, 200);
    const detail = await request('A', 'GET', `/families/${familyA.id}/recipes/${recipeBase}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.data.viewer.is_favorite, true);
  });

  // P2: favorite DELETE → viewer.is_favorite=false
  await t.test('P2 favorite DELETE clears viewer.is_favorite', async () => {
    const r = await request('A', 'DELETE', `/families/${familyA.id}/recipes/${recipeBase}/favorite`);
    assert.equal(r.status, 200);
    const detail = await request('A', 'GET', `/families/${familyA.id}/recipes/${recipeBase}`);
    assert.equal(detail.body.data.viewer.is_favorite, false);
  });

  // P3: favorite idempotent — no duplicate row
  await t.test('P3 favorite idempotent no duplicate row', async () => {
    await request('A', 'PUT', `/families/${familyA.id}/recipes/${recipeBase}/favorite`);
    await request('A', 'PUT', `/families/${familyA.id}/recipes/${recipeBase}/favorite`);
    const { rows } = await pool.query('SELECT COUNT(*) as cnt FROM recipe_favorites WHERE user_id=$1 AND recipe_id=$2', [userA.id, recipeBase]);
    assert.equal(parseInt(rows[0].cnt), 1);
    await request('A', 'DELETE', `/families/${familyA.id}/recipes/${recipeBase}/favorite`);
    await request('A', 'DELETE', `/families/${familyA.id}/recipes/${recipeBase}/favorite`);
    const { rows: rows2 } = await pool.query('SELECT COUNT(*) as cnt FROM recipe_favorites WHERE user_id=$1 AND recipe_id=$2', [userA.id, recipeBase]);
    assert.equal(parseInt(rows2[0].cnt), 0);
  });

  // P4: cross-family FAMILY recipe favorite forbidden
  await t.test('P4 cross-family FAMILY recipe favorite forbidden', async () => {
    const r = await request('A', 'PUT', `/families/${familyA.id}/recipes/${recipeFamilyB}/favorite`);
    assert.equal(r.status, 403);
    const { rows } = await pool.query('SELECT COUNT(*) as cnt FROM recipe_favorites WHERE user_id=$1 AND recipe_id=$2', [userA.id, recipeFamilyB]);
    assert.equal(parseInt(rows[0].cnt), 0);
  });

  // P5: set rating 4 → getRecipe viewer.rating=4
  await t.test('P5 set rating 4 reflects in viewer.rating', async () => {
    const r = await request('A', 'PUT', `/families/${familyA.id}/recipes/${recipeBase}/rating`, { rating: 4 });
    assert.equal(r.status, 200);
    const detail = await request('A', 'GET', `/families/${familyA.id}/recipes/${recipeBase}`);
    assert.equal(detail.body.data.viewer.rating, 4);
  });

  // P6: rating 4→5 only one row, final 5
  await t.test('P6 rating update 4→5 single row final 5', async () => {
    await request('A', 'PUT', `/families/${familyA.id}/recipes/${recipeBase}/rating`, { rating: 5 });
    const { rows } = await pool.query('SELECT rating FROM recipe_ratings WHERE user_id=$1 AND recipe_id=$2', [userA.id, recipeBase]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].rating, 5);
  });

  // P7: invalid rating 0/6/1.5
  await t.test('P7 invalid rating rejected', async () => {
    for (const bad of [0, 6, 1.5]) {
      const r = await request('A', 'PUT', `/families/${familyA.id}/recipes/${recipeBase}/rating`, { rating: bad });
      assert.equal(r.status, 400, `rating=${bad} should be 400`);
    }
  });

  // P8: cross-family FAMILY recipe rating forbidden
  await t.test('P8 cross-family FAMILY recipe rating forbidden', async () => {
    const r = await request('A', 'PUT', `/families/${familyA.id}/recipes/${recipeFamilyB}/rating`, { rating: 3 });
    assert.equal(r.status, 403);
    const { rows } = await pool.query('SELECT COUNT(*) as cnt FROM recipe_ratings WHERE user_id=$1 AND recipe_id=$2', [userA.id, recipeFamilyB]);
    assert.equal(parseInt(rows[0].cnt), 0);
  });

  // P9: listFavorites isolation
  await t.test('P9 listFavorites returns favorited recipes', async () => {
    await request('A', 'PUT', `/families/${familyA.id}/recipes/${recipeBase}/favorite`);
    const listA = await request('A', 'GET', `/families/${familyA.id}/favorites`);
    assert.equal(listA.status, 200);
    assert.ok(Array.isArray(listA.body.data));
    assert.ok(listA.body.data.some(r => r.id === recipeBase));
  });

  // P10: listRatings family/user isolation
  await t.test('P10 listRatings family/user isolation', async () => {
    const listA = await request('A', 'GET', `/families/${familyA.id}/ratings`);
    assert.equal(listA.status, 200);
    assert.ok(Array.isArray(listA.body.data));
    assert.ok(listA.body.data.some(r => r.recipe_id === recipeBase && r.rating === 5));
    const listB = await request('B', 'GET', `/families/${familyB.id}/ratings`);
    assert.equal(listB.status, 200);
    assert.equal(listB.body.data.length, 0);
  });

  // P11: foreign/unrelated meal_id → INVALID_RATING_CONTEXT
  await t.test('P11 foreign meal_id rejected', async () => {
    const fakeMeal = randomUUID();
    const r = await request('A', 'PUT', `/families/${familyA.id}/recipes/${recipeBase}/rating`, { rating: 4, meal_id: fakeMeal });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'INVALID_RATING_CONTEXT');
  });
});
