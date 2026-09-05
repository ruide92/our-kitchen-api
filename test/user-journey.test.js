// User Journey Acceptance Tests — Phase 1 (REAL journeys only)
// BROKEN journeys are NOT tested here — they remain BROKEN in PRODUCT_SURFACE_MATRIX.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Pool } = require('pg');
const { randomUUID } = require('node:crypto');
const { createApp } = require('../backend/v1/app');
const { createRepository } = require('../backend/v1/repository');
const { createFamilyService } = require('../backend/v1/family-service');
const { createTokens } = require('../backend/v1/tokens');
const { loadMigrations, migrate } = require('../backend/v1/migrations');

const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

test('User journey acceptance suite (REAL journeys)', async t => {
  const schema = `uj_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  let pool, server;

  t.after(async () => {
    try { if (server) await new Promise(r => server.close(r)); } finally {
      try { if (pool) await pool.end(); } finally {
        try { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await admin.end(); }
      }
    }
  });

  await admin.query(`CREATE SCHEMA "${schema}"`);
  pool = new Pool({ connectionString, max: 6, connectionTimeoutMillis: 5000, options: `-c search_path=${schema}` });
  await migrate(pool, await loadMigrations(path.join(__dirname, '../backend/v1/sql')));

  const repo = createRepository(pool);
  const families = createFamilyService(pool, repo);
  const tokens = createTokens(process.env.JWT_SECRET || 'user-journey-test-key-'.repeat(3));
  const app = createApp({ repo, families, tokens, pool, wechat: { exchange: async () => { throw new Error('not used'); } } });
  server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));

  const users = {};
  for (const name of ['A', 'B']) users[name] = await repo.upsertWechatUser({ openid: name, unionid: null });

  async function request(who, method, endpoint, body) {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/v1${endpoint}`, {
      method, headers: { Authorization: `Bearer ${tokens.sign(users[who].id)}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: res.status, body: await res.json() };
  }

  async function makeFamily(owner, name) {
    const r = await request(owner, 'POST', '/families', { name });
    assert.equal(r.status, 201);
    return r.body.data;
  }

  // Seed ingredients
  const ingPork = randomUUID();
  const ingCabbage = randomUUID();
  await pool.query(`INSERT INTO ingredients(id,canonical_code,display_name,category_code,default_unit_code) VALUES
    ($1,'pork_uj','猪肉','MEAT','g'),($2,'cabbage_uj','白菜','VEGETABLE','g')`, [ingPork, ingCabbage]);

  const num = v => v == null ? v : Number(v);

  // ===== UJ-01: Auth → family data =====
  await t.test('UJ-01 Login → Home: me, family, settings accessible', async () => {
    const fa = await makeFamily('A', 'UJ01 Home');
    const me = await request('A', 'GET', '/me');
    assert.equal(me.status, 200);
    const fam = await request('A', 'GET', `/families/${fa.id}`);
    assert.equal(fam.status, 200);
    const settings = await request('A', 'GET', `/families/${fa.id}/settings`);
    assert.equal(settings.status, 200);
  });

  // ===== UJ-02: Recipe → Meal =====
  await t.test('UJ-02 Recipe → Meal: add recipe, persist, reload', async () => {
    const fa = await makeFamily('A', 'UJ02 Meal');
    // Create recipe
    const rec = await request('A', 'POST', `/families/${fa.id}/recipes`, { name: 'UJ02 Dish', base_servings: 2 });
    assert.equal(rec.status, 201);
    const recipeId = rec.body.data.id;

    const today = '2026-09-10';
    const meal = (await request('A', 'PUT', `/families/${fa.id}/meals/current`, { meal_date: today, meal_type: 'DINNER', diners_count: 2 })).body.data;

    const add = await request('A', 'POST', `/families/${fa.id}/meals/${meal.id}/items`, { recipe_id: recipeId, servings: 2 });
    assert.ok(add.status === 201 || add.status === 409);

    const get = await request('A', 'GET', `/families/${fa.id}/meals/${meal.id}`);
    assert.equal(get.status, 200);
    assert.ok((get.body.data.items || []).some(i => i.recipe_id === recipeId));
  });

  // ===== UJ-03: Meal → Shopping =====
  await t.test('UJ-03 Meal → Shopping: generate list, evidence persists', async () => {
    const fa = await makeFamily('A', 'UJ03 Shop');
    const rec = await request('A', 'POST', `/families/${fa.id}/recipes`, {
      name: 'UJ03 Dish', base_servings: 2,
      ingredients: [{ ingredient_id: ingPork, quantity: 300, unit_code: 'g', type: 'MAIN' }]
    });
    const today = '2026-09-11';
    const meal = (await request('A', 'PUT', `/families/${fa.id}/meals/current`, { meal_date: today, meal_type: 'DINNER', diners_count: 2 })).body.data;
    await request('A', 'POST', `/families/${fa.id}/meals/${meal.id}/items`, { recipe_id: rec.body.data.id, servings: 2 });

    const gen = await request('A', 'POST', `/families/${fa.id}/shopping-lists/generate`, { meal_id: meal.id, mode: 'REPLACE_GENERATED' });
    assert.equal(gen.status, 201);
    assert.ok(gen.body.data.items && gen.body.data.items.length > 0);

    // Reload — evidence must persist
    const cur = await request('A', 'GET', `/families/${fa.id}/shopping-lists/current`);
    assert.equal(cur.status, 200);
    assert.ok(cur.body.data, 'current list should exist after reload');
  });

  // ===== UJ-04: Shopping → Fridge =====
  await t.test('UJ-04 Shopping → Fridge: complete purchase adds to fridge', async () => {
    const fa = await makeFamily('A', 'UJ04 Fridge');
    const rec = await request('A', 'POST', `/families/${fa.id}/recipes`, {
      name: 'UJ04 Dish', base_servings: 2,
      ingredients: [{ ingredient_id: ingCabbage, quantity: 200, unit_code: 'g', type: 'MAIN' }]
    });
    const today = '2026-09-12';
    const meal = (await request('A', 'PUT', `/families/${fa.id}/meals/current`, { meal_date: today, meal_type: 'DINNER', diners_count: 2 })).body.data;
    await request('A', 'POST', `/families/${fa.id}/meals/${meal.id}/items`, { recipe_id: rec.body.data.id, servings: 2 });

    const gen = await request('A', 'POST', `/families/${fa.id}/shopping-lists/generate`, { meal_id: meal.id, mode: 'REPLACE_GENERATED' });
    const list = gen.body.data;
    const item = list.items[0];

    await request('A', 'PATCH', `/families/${fa.id}/shopping-lists/${list.id}/items/${item.id}`, { is_purchased: true });

    const complete = await request('A', 'POST', `/families/${fa.id}/shopping-lists/${list.id}/complete`, {
      items: [{ item_id: item.id, purchased_quantity: num(item.missing_quantity) || num(item.required_quantity), storage_location: 'REFRIGERATED', expiry_date: today }]
    });
    assert.equal(complete.status, 200);

    const fridge = await request('A', 'GET', `/families/${fa.id}/fridge`);
    assert.equal(fridge.status, 200);
    assert.ok((fridge.body.data || []).length > 0, 'fridge should have purchased item');
  });

  // ===== UJ-05: Pantry canonical =====
  await t.test('UJ-05 Pantry: add canonical staple, list, delete', async () => {
    const fa = await makeFamily('A', 'UJ05 Pantry');
    const put = await request('A', 'PUT', `/families/${fa.id}/pantry-staples/${ingPork}`, { assume_available: true });
    assert.equal(put.status, 200);

    const list = await request('A', 'GET', `/families/${fa.id}/pantry-staples`);
    assert.equal(list.status, 200);
    assert.ok((list.body.data || []).some(s => s.ingredient_id === ingPork));

    const del = await request('A', 'DELETE', `/families/${fa.id}/pantry-staples/${ingPork}`);
    assert.equal(del.status, 200);
  });

  // ===== UJ-07: Weekly → Meal separation =====
  await t.test('UJ-07 Weekly null + manual meal does not create weekly', async () => {
    const fa = await makeFamily('A', 'UJ07 Weekly');
    const weekStart = '2026-09-14';

    const w1 = await request('A', 'GET', `/families/${fa.id}/weekly-plans?week_start=${weekStart}`);
    assert.equal(w1.status, 200);
    assert.equal(w1.body.data, null, 'no plan should return null, not fixture');

    // Manual add to meal
    const rec = await request('A', 'POST', `/families/${fa.id}/recipes`, { name: 'UJ07 Manual', base_servings: 2 });
    const meal = (await request('A', 'PUT', `/families/${fa.id}/meals/current`, { meal_date: '2026-09-15', meal_type: 'DINNER', diners_count: 2 })).body.data;
    await request('A', 'POST', `/families/${fa.id}/meals/${meal.id}/items`, { recipe_id: rec.body.data.id, servings: 2 });

    const w2 = await request('A', 'GET', `/families/${fa.id}/weekly-plans?week_start=${weekStart}`);
    assert.equal(w2.body.data, null, 'manual meal must not create weekly plan');
  });

  // BROKEN journeys explicitly NOT tested:
  // UJ-06 Kitchen Settings: BROKEN (read-only)
  // UJ-08 Cooking: BROKEN (frontend missing)
  // UJ-09 Favorite/Rating: BROKEN (frontend missing)
  // UJ-10 Mine Navigation: BROKEN (placeholderToast)
  // UJ-11 Recommendation: BROKEN (frontend missing)
  // UJ-12 AI Import: BROKEN (frontend missing)
});
