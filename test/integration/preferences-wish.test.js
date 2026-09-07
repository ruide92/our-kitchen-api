const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

test('Preferences & Wish integration against real PostgreSQL', async t => {
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
  const { createRecommendationService } = require('../../backend/v1/recommendation-service');
  const schema = `pref_wish_${randomUUID().replaceAll('-', '')}`;
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

  // Seed BASE recipes with different spiciness
  const recipeMild = randomUUID();
  const recipeSpicy = randomUUID();
  await pool.query(`INSERT INTO recipes(id,kind,family_id,source_type,name,base_servings,visibility,version,spiciness,cook_time_minutes)
    VALUES ($1,'BASE',NULL,'SEED','清淡菜谱',2,'PUBLIC',1,1,20)`, [recipeMild]);
  await pool.query(`INSERT INTO recipes(id,kind,family_id,source_type,name,base_servings,visibility,version,spiciness,cook_time_minutes)
    VALUES ($1,'BASE',NULL,'SEED','重辣菜谱',2,'PUBLIC',1,5,20)`, [recipeSpicy]);
  // Add DINNER meal type to both
  await pool.query(`INSERT INTO recipe_meal_types(recipe_id,meal_type) VALUES ($1,'DINNER')`, [recipeMild]);
  await pool.query(`INSERT INTO recipe_meal_types(recipe_id,meal_type) VALUES ($1,'DINNER')`, [recipeSpicy]);

  const repo = createRepository(pool);
  const families = createFamilyService(pool);
  const tokens = createTokens('pref-wish-test-key-'.repeat(3));
  const app = createApp({ repo, families, tokens, pool, wechat: { exchange: async () => { throw new Error('Not used'); } } });
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));

  const userA = await repo.upsertWechatUser({ openid: 'prefA', unionid: null });
  const userB = await repo.upsertWechatUser({ openid: 'prefB', unionid: null });

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

  const familyA = (await request('A', 'POST', '/families', { name: '偏好家庭A' })).body.data;
  const familyB = (await request('B', 'POST', '/families', { name: '偏好家庭B' })).body.data;

  // PR1: GET preferences defaults
  await t.test('PR1 GET preferences returns defaults', async () => {
    const r = await request('A', 'GET', `/families/${familyA.id}/me/preferences`);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.spiciness_preference, null);
    assert.deepEqual(r.body.data.allergens, []);
    assert.deepEqual(r.body.data.diet_tags, []);
    assert.equal(Array.isArray(r.body.data.disliked_ingredients), true);
  });

  // PR2: PATCH spiciness
  await t.test('PR2 PATCH spiciness_preference', async () => {
    const r = await request('A', 'PATCH', `/families/${familyA.id}/me/preferences`, { spiciness_preference: 3 });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.spiciness_preference, 3);
    const get = await request('A', 'GET', `/families/${familyA.id}/me/preferences`);
    assert.equal(get.body.data.spiciness_preference, 3);
  });

  // PR3: PATCH allergens
  await t.test('PR3 PATCH allergens', async () => {
    const r = await request('A', 'PATCH', `/families/${familyA.id}/me/preferences`, { allergens: ['SOY', 'PEANUT'] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data.allergens.sort(), ['PEANUT', 'SOY']);
  });

  // PR4: PATCH invalid allergen → 400
  await t.test('PR4 PATCH invalid allergen returns 400', async () => {
    const r = await request('A', 'PATCH', `/families/${familyA.id}/me/preferences`, { allergens: ['NOT_REAL'] });
    assert.equal(r.status, 400);
  });

  // PR5: PATCH invalid spiciness → 400
  await t.test('PR5 PATCH invalid spiciness returns 400', async () => {
    const r = await request('A', 'PATCH', `/families/${familyA.id}/me/preferences`, { spiciness_preference: 9 });
    assert.equal(r.status, 400);
  });

  // PR6: PATCH extra field → 400
  await t.test('PR6 PATCH extra field returns 400', async () => {
    const r = await request('A', 'PATCH', `/families/${familyA.id}/me/preferences`, { spiciness_preference: 2, evil_field: 'x' });
    assert.equal(r.status, 400);
  });

  // PR7: PATCH diet tags
  await t.test('PR7 PATCH diet_tags', async () => {
    const r = await request('A', 'PATCH', `/families/${familyA.id}/me/preferences`, { diet_tags: ['VEGETARIAN'] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data.diet_tags, ['VEGETARIAN']);
  });

  // PR8: family isolation — A in familyA, B in familyB independent
  await t.test('PR8 family isolation preferences independent', async () => {
    await request('A', 'PATCH', `/families/${familyA.id}/me/preferences`, { spiciness_preference: 1 });
    await request('B', 'PATCH', `/families/${familyB.id}/me/preferences`, { spiciness_preference: 5 });
    const a = await request('A', 'GET', `/families/${familyA.id}/me/preferences`);
    const b = await request('B', 'GET', `/families/${familyB.id}/me/preferences`);
    assert.equal(a.body.data.spiciness_preference, 1);
    assert.equal(b.body.data.spiciness_preference, 5);
  });

  // PR9: cross-family preference access forbidden
  await t.test('PR9 cross-family preference GET forbidden', async () => {
    const r = await request('A', 'GET', `/families/${familyB.id}/me/preferences`);
    assert.equal(r.status, 403);
  });

  // W1: wish PUT → viewer.wish_status=ACTIVE
  await t.test('W1 wish PUT sets viewer.wish_status ACTIVE', async () => {
    const r = await request('A', 'PUT', `/families/${familyA.id}/recipes/${recipeMild}/wish`);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.wish_status, 'ACTIVE');
    const detail = await request('A', 'GET', `/families/${familyA.id}/recipes/${recipeMild}`);
    assert.equal(detail.body.data.viewer.wish_status, 'ACTIVE');
  });

  // W2: wish DELETE → viewer.wish_status=null
  await t.test('W2 wish DELETE clears viewer.wish_status', async () => {
    const r = await request('A', 'DELETE', `/families/${familyA.id}/recipes/${recipeMild}/wish`);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.wish_status, 'CANCELLED');
    const detail = await request('A', 'GET', `/families/${familyA.id}/recipes/${recipeMild}`);
    assert.equal(detail.body.data.viewer.wish_status, null);
  });

  // W3: wish idempotent — no duplicate ACTIVE rows
  await t.test('W3 wish idempotent no duplicate ACTIVE', async () => {
    await request('A', 'PUT', `/families/${familyA.id}/recipes/${recipeMild}/wish`);
    await request('A', 'PUT', `/families/${familyA.id}/recipes/${recipeMild}/wish`);
    const { rows } = await pool.query(
      'SELECT COUNT(*) as cnt FROM wishes WHERE user_id=$1 AND recipe_id=$2 AND family_id=$3 AND status=$4',
      [userA.id, recipeMild, familyA.id, 'ACTIVE']
    );
    assert.equal(parseInt(rows[0].cnt), 1);
  });

  // W4: wish reactivate after cancel
  await t.test('W4 wish reactivate after cancel', async () => {
    await request('A', 'DELETE', `/families/${familyA.id}/recipes/${recipeMild}/wish`);
    const r = await request('A', 'PUT', `/families/${familyA.id}/recipes/${recipeMild}/wish`);
    assert.equal(r.body.data.wish_status, 'ACTIVE');
    const { rows } = await pool.query(
      'SELECT COUNT(*) as cnt FROM wishes WHERE user_id=$1 AND recipe_id=$2 AND family_id=$3',
      [userA.id, recipeMild, familyA.id]
    );
    // Only one row total (reactivated, not duplicated)
    assert.equal(parseInt(rows[0].cnt), 1);
  });

  // W5: cross-family FAMILY recipe wish forbidden
  await t.test('W5 cross-family FAMILY recipe wish forbidden', async () => {
    const familyRecipeB = randomUUID();
    await pool.query(`INSERT INTO recipes(id,kind,family_id,source_type,name,base_servings,visibility,version,created_by_user_id,updated_by_user_id)
      VALUES ($1,'FAMILY',$2,'MANUAL','家庭B私有',2,'PRIVATE',1,$3,$3)`, [familyRecipeB, familyB.id, userB.id]);
    const r = await request('A', 'PUT', `/families/${familyA.id}/recipes/${familyRecipeB}/wish`);
    assert.equal(r.status, 403);
  });

  // W6: wish DELETE idempotent (safe repeat)
  await t.test('W6 wish DELETE idempotent safe', async () => {
    await request('A', 'DELETE', `/families/${familyA.id}/recipes/${recipeMild}/wish`);
    const r2 = await request('A', 'DELETE', `/families/${familyA.id}/recipes/${recipeMild}/wish`);
    assert.equal(r2.status, 200);
  });

  // SP1: spiciness preference affects recommendation score
  await t.test('SP1 spiciness preference boosts matching recipe score', async () => {
    // Set user A spiciness preference = 1 (mild)
    await request('A', 'PATCH', `/families/${familyA.id}/me/preferences`, { spiciness_preference: 1, allergens: [], diet_tags: [] });
    const recService = createRecommendationService(pool, { randomFn: () => 0.3 });
    // Use service-level generateRandomMeal to get scores
    const result = await recService.generateRandomMeal(familyA.id, userA.id, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 2
    });
    const recipes = result.recipes || [];
    assert.ok(recipes.length >= 1, 'should return at least 1 recipe');
    // With spiciness_preference=1, mild recipe (spiciness=1) should score higher than spicy (spiciness=5)
    // Check that mild appears before or has higher score
    const mild = recipes.find(r => r.recipe && r.recipe.id === recipeMild);
    const spicy = recipes.find(r => r.recipe && r.recipe.id === recipeSpicy);
    if (mild && spicy) {
      assert.ok(mild.score >= spicy.score, 'mild recipe should score >= spicy with spiciness_preference=1');
    }
    // Verify reasons include SPICINESS_MATCH for mild
    if (mild && mild.reasons) {
      assert.ok(mild.reasons.includes('SPICINESS_MATCH'), 'mild recipe should have SPICINESS_MATCH reason');
    }
  });

  // SP2: no spiciness preference → no SPICINESS_MATCH reason
  await t.test('SP2 no spiciness preference → no spiciness scoring', async () => {
    // Clear preference
    await request('A', 'PATCH', `/families/${familyA.id}/me/preferences`, { spiciness_preference: null });
    const recService = createRecommendationService(pool, { randomFn: () => 0.3 });
    const result = await recService.generateRandomMeal(familyA.id, userA.id, {
      meal_date: '2026-09-11', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 2
    });
    const recipes = result.recipes || [];
    for (const r of recipes) {
      if (r.reasons) {
        assert.ok(!r.reasons.includes('SPICINESS_MATCH'), 'should not have SPICINESS_MATCH when no preference');
        assert.ok(!r.reasons.includes('SPICINESS_MISMATCH'), 'should not have SPICINESS_MISMATCH when no preference');
      }
    }
  });
});
