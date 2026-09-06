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

  // P12: Same user multi-family — ratings must not overwrite each other
  await t.test('P12 same user multi-family rating isolation', async () => {
    // Add user A to family B as MEMBER
    await pool.query('INSERT INTO family_members(id,family_id,user_id,role,joined_at) VALUES($1,$2,$3,\'MEMBER\',now())', [randomUUID(), familyB.id, userA.id]);
    // Family A: rating 4
    await request('A', 'PUT', `/families/${familyA.id}/recipes/${recipeBase}/rating`, { rating: 4 });
    // Family B: rating 2 (same user, same recipe, different family)
    await request('A', 'PUT', `/families/${familyB.id}/recipes/${recipeBase}/rating`, { rating: 2 });
    // DB: two rows
    const { rows } = await pool.query(
      'SELECT family_id, rating FROM recipe_ratings WHERE user_id=$1 AND recipe_id=$2 AND meal_id IS NULL',
      [userA.id, recipeBase]
    );
    assert.equal(rows.length, 2);
    const rowA = rows.find(r => r.family_id === familyA.id);
    const rowB = rows.find(r => r.family_id === familyB.id);
    assert.ok(rowA, 'family A rating row exists');
    assert.ok(rowB, 'family B rating row exists');
    assert.equal(rowA.rating, 4);
    assert.equal(rowB.rating, 2);
    // GET Detail A: viewer.rating=4
    const detailA = await request('A', 'GET', `/families/${familyA.id}/recipes/${recipeBase}`);
    assert.equal(detailA.body.data.viewer.rating, 4);
    // GET Detail B: viewer.rating=2
    const detailB = await request('A', 'GET', `/families/${familyB.id}/recipes/${recipeBase}`);
    assert.equal(detailB.body.data.viewer.rating, 2);
    // listRatings A: 4
    const listA = await request('A', 'GET', `/families/${familyA.id}/ratings`);
    assert.equal(listA.body.data[0].rating, 4);
    // listRatings B: 2
    const listB = await request('A', 'GET', `/families/${familyB.id}/ratings`);
    assert.equal(listB.body.data[0].rating, 2);
    // Cleanup: remove family_members and ratings for next run
    await pool.query('DELETE FROM family_members WHERE family_id=$1 AND user_id=$2', [familyB.id, userA.id]);
    await pool.query('DELETE FROM recipe_ratings WHERE user_id=$1 AND recipe_id=$2', [userA.id, recipeBase]);
  });

  // P13: General vs Meal rating — must coexist, viewer.rating stays general
  await t.test('P13 general and meal rating coexist', async () => {
    // Create a meal with recipeBase, confirm it
    const meal = (await request('A', 'PUT', `/families/${familyA.id}/meals/current`, { meal_date: '2026-09-07', meal_type: 'DINNER', diners_count: 2 })).body.data;
    await request('A', 'POST', `/families/${familyA.id}/meals/${meal.id}/items`, { recipe_id: recipeBase, servings: 2 });
    await request('A', 'POST', `/families/${familyA.id}/meals/${meal.id}/confirm`, {});
    // General rating: 4
    await request('A', 'PUT', `/families/${familyA.id}/recipes/${recipeBase}/rating`, { rating: 4 });
    // Meal-specific rating: 5
    await request('A', 'PUT', `/families/${familyA.id}/recipes/${recipeBase}/rating`, { rating: 5, meal_id: meal.id });
    // DB: two rows
    const { rows } = await pool.query(
      'SELECT meal_id, rating FROM recipe_ratings WHERE user_id=$1 AND recipe_id=$2 AND family_id=$3 ORDER BY meal_id NULLS FIRST',
      [userA.id, recipeBase, familyA.id]
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0].meal_id, null);
    assert.equal(rows[0].rating, 4);
    assert.equal(rows[1].rating, 5);
    // viewer.rating still = 4 (general)
    const detail = await request('A', 'GET', `/families/${familyA.id}/recipes/${recipeBase}`);
    assert.equal(detail.body.data.viewer.rating, 4);
  });

  // P14: DELETE general (no meal_id) — meal rating remains
  await t.test('P14 delete general preserves meal rating', async () => {
    const meal = (await request('A', 'GET', `/families/${familyA.id}/meals/current?date=2026-09-07&meal_type=DINNER`)).body.data;
    await request('A', 'DELETE', `/families/${familyA.id}/recipes/${recipeBase}/rating`);
    const { rows } = await pool.query(
      'SELECT meal_id, rating FROM recipe_ratings WHERE user_id=$1 AND recipe_id=$2 AND family_id=$3',
      [userA.id, recipeBase, familyA.id]
    );
    assert.equal(rows.length, 1);
    assert.ok(rows[0].meal_id);
    assert.equal(rows[0].rating, 5);
  });

  // P15: DELETE meal-specific — general rating remains (recreate general first)
  await t.test('P15 delete meal-specific preserves general', async () => {
    const meal = (await request('A', 'GET', `/families/${familyA.id}/meals/current?date=2026-09-07&meal_type=DINNER`)).body.data;
    // Recreate general
    await request('A', 'PUT', `/families/${familyA.id}/recipes/${recipeBase}/rating`, { rating: 4 });
    // Delete meal-specific
    await request('A', 'DELETE', `/families/${familyA.id}/recipes/${recipeBase}/rating?meal_id=${meal.id}`);
    const { rows } = await pool.query(
      'SELECT meal_id, rating FROM recipe_ratings WHERE user_id=$1 AND recipe_id=$2 AND family_id=$3',
      [userA.id, recipeBase, familyA.id]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].meal_id, null);
    assert.equal(rows[0].rating, 4);
  });

  // P16: DELETE idempotent — twice is safe
  await t.test('P16 delete idempotent', async () => {
    await request('A', 'DELETE', `/families/${familyA.id}/recipes/${recipeBase}/rating`);
    const r2 = await request('A', 'DELETE', `/families/${familyA.id}/recipes/${recipeBase}/rating`);
    assert.equal(r2.status, 200);
    const { rows } = await pool.query(
      'SELECT COUNT(*) as cnt FROM recipe_ratings WHERE user_id=$1 AND recipe_id=$2 AND family_id=$3 AND meal_id IS NULL',
      [userA.id, recipeBase, familyA.id]
    );
    assert.equal(parseInt(rows[0].cnt), 0);
  });

  // P17: Cross-family DELETE — family A delete does not affect family B
  await t.test('P17 cross-family delete isolation', async () => {
    // Ensure user A is in family B and has a rating there
    await pool.query('INSERT INTO family_members(id,family_id,user_id,role,joined_at) VALUES($1,$2,$3,\'MEMBER\',now()) ON CONFLICT DO NOTHING', [randomUUID(), familyB.id, userA.id]);
    await request('A', 'PUT', `/families/${familyB.id}/recipes/${recipeBase}/rating`, { rating: 2 });
    // Family A also has a rating
    await request('A', 'PUT', `/families/${familyA.id}/recipes/${recipeBase}/rating`, { rating: 4 });
    // Delete family A rating
    await request('A', 'DELETE', `/families/${familyA.id}/recipes/${recipeBase}/rating`);
    const { rows } = await pool.query(
      'SELECT family_id, rating FROM recipe_ratings WHERE user_id=$1 AND recipe_id=$2 AND meal_id IS NULL',
      [userA.id, recipeBase]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].family_id, familyB.id);
    assert.equal(rows[0].rating, 2);
    // Cleanup
    await pool.query('DELETE FROM family_members WHERE family_id=$1 AND user_id=$2', [familyB.id, userA.id]);
    await pool.query('DELETE FROM recipe_ratings WHERE user_id=$1 AND recipe_id=$2', [userA.id, recipeBase]);
  });

  // P18: 009 migration — partial unique indexes exist
  await t.test('P18 009 partial unique indexes exist', async () => {
    const { rows } = await pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = current_schema() AND indexname IN ('idx_ratings_general_unique','idx_ratings_meal_unique')
    `);
    assert.equal(rows.length, 2);
  });

  // P19: duplicate general rating rejected by DB
  await t.test('P19 duplicate general rating rejected', async () => {
    // Insert one general row directly
    await pool.query(
      'INSERT INTO recipe_ratings(family_id,user_id,recipe_id,meal_id,rating) VALUES($1,$2,$3,NULL,3)',
      [familyA.id, userA.id, recipeBase]
    );
    // Try to insert another — should fail
    await assert.rejects(
      pool.query(
        'INSERT INTO recipe_ratings(family_id,user_id,recipe_id,meal_id,rating) VALUES($1,$2,$3,NULL,4)',
        [familyA.id, userA.id, recipeBase]
      ),
      /duplicate|unique/i
    );
    // Cleanup
    await pool.query('DELETE FROM recipe_ratings WHERE family_id=$1 AND user_id=$2 AND recipe_id=$3 AND meal_id IS NULL', [familyA.id, userA.id, recipeBase]);
  });

  // P20: duplicate meal-specific rejected; different family allowed
  await t.test('P20 duplicate meal-specific rejected, different family allowed', async () => {
    const meal = (await request('A', 'GET', `/families/${familyA.id}/meals/current?date=2026-09-07&meal_type=DINNER`)).body.data;
    // Insert one meal-specific row
    await pool.query(
      'INSERT INTO recipe_ratings(family_id,user_id,recipe_id,meal_id,rating) VALUES($1,$2,$3,$4,3)',
      [familyA.id, userA.id, recipeBase, meal.id]
    );
    // Duplicate should fail
    await assert.rejects(
      pool.query(
        'INSERT INTO recipe_ratings(family_id,user_id,recipe_id,meal_id,rating) VALUES($1,$2,$3,$4,4)',
        [familyA.id, userA.id, recipeBase, meal.id]
      ),
      /duplicate|unique/i
    );
    // Different family same meal_id should be allowed (different family_id in unique key)
    await pool.query(
      'INSERT INTO recipe_ratings(family_id,user_id,recipe_id,meal_id,rating) VALUES($1,$2,$3,$4,3)',
      [familyB.id, userA.id, recipeBase, meal.id]
    );
    // Cleanup
    await pool.query('DELETE FROM recipe_ratings WHERE recipe_id=$1 AND meal_id=$2', [recipeBase, meal.id]);
  });
});
