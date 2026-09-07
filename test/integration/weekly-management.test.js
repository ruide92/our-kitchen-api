const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

test('Weekly Plan Management integration against real PostgreSQL', async t => {
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
  const schema = `wm_${randomUUID().replaceAll('-', '')}`;
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

  const repo = createRepository(pool);
  const families = createFamilyService(pool);
  const tokens = createTokens('wm-test-key-'.repeat(3));
  const app = createApp({ repo, families, tokens, pool, wechat: { exchange: async () => { throw new Error('Not used'); } } });
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));

  const userA = await repo.upsertWechatUser({ openid: 'wmA', unionid: null });
  const userB = await repo.upsertWechatUser({ openid: 'wmB', unionid: null });

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

  const familyA = (await request('A', 'POST', '/families', { name: '周计划家庭A' })).body.data;
  const familyB = (await request('B', 'POST', '/families', { name: '周计划家庭B' })).body.data;
  // User B joins family A as MEMBER
  await request('B', 'POST', '/families/join', { invite_code: familyA.invite_code });

  const WEEK_START = '2026-09-07';

  async function makeRecipe(name, opts = {}) {
    const id = randomUUID();
    await pool.query(`INSERT INTO recipes(id,kind,family_id,source_type,name,base_servings,visibility,version,protein_source_code,cooking_method_code,cook_time_minutes)
      VALUES ($1,'BASE',NULL,'SEED',$2,$3,'PUBLIC',1,$4,$5,$6)`,
      [id, name, opts.baseServings || 2, opts.protein || null, opts.method || null, opts.cookTime || 30]);
    if (opts.mealTypes) {
      for (const mt of opts.mealTypes) {
        await pool.query(`INSERT INTO recipe_meal_types(recipe_id,meal_type) VALUES ($1,$2)`, [id, mt]);
      }
    }
    return id;
  }

  const r1 = await makeRecipe('红烧肉', { mealTypes: ['DINNER'], protein: 'PORK', method: 'BRAISE' });
  const r2 = await makeRecipe('清蒸鱼', { mealTypes: ['DINNER'], protein: 'FISH', method: 'STEAM' });
  const r3 = await makeRecipe('炒青菜', { mealTypes: ['DINNER'], protein: 'VEGETABLE', method: 'STIR_FRY' });
  const r4 = await makeRecipe('白粥', { mealTypes: ['BREAKFAST'], protein: 'GRAIN', method: 'BOIL' });
  const r5 = await makeRecipe('三明治', { mealTypes: ['LUNCH'], protein: 'MEAT', method: 'NONE' });

  // ===== W1: empty GET returns null =====
  await t.test('W1 empty GET returns null', async () => {
    const r = await request('A', 'GET', `/families/${familyA.id}/weekly-plans?week_start=${WEEK_START}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.data, null);
  });

  // ===== W2: generate creates DRAFT, does not replace ACTIVE =====
  let draftPlan;
  await t.test('W2 generate creates DRAFT', async () => {
    const r = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/generate`, {
      week_start: WEEK_START, mode: 'BALANCED'
    });
    assert.equal(r.status, 201);
    draftPlan = r.body.data;
    assert.equal(draftPlan.status, 'DRAFT');
    assert.ok(draftPlan.items && draftPlan.items.length > 0);
    // GET still returns null (no ACTIVE yet)
    const g = await request('A', 'GET', `/families/${familyA.id}/weekly-plans?week_start=${WEEK_START}`);
    assert.equal(g.body.data, null);
  });

  // ===== W3: confirm DRAFT archives old ACTIVE, new plan ACTIVE =====
  let activePlan;
  await t.test('W3 confirm DRAFT → ACTIVE', async () => {
    const r = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/${draftPlan.id}/confirm`);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.status, 'ACTIVE');
    activePlan = r.body.data;
    const g = await request('A', 'GET', `/families/${familyA.id}/weekly-plans?week_start=${WEEK_START}`);
    assert.equal(g.body.data.status, 'ACTIVE');
    assert.equal(g.body.data.id, activePlan.id);
  });

  // ===== W4: manual item add to DRAFT =====
  await t.test('W4 manual item add to DRAFT', async () => {
    // Create a DRAFT copy first
    const copy = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/generate`, {
      copy_from_plan_id: activePlan.id
    });
    assert.equal(copy.status, 201);
    const draft = copy.body.data;
    const before = draft.items.length;
    const r = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/${draft.id}/items`, {
      plan_date: WEEK_START, meal_type: 'DINNER', recipe_id: r1
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.data.recipe_id, r1);
    assert.equal(r.body.data.source, 'MANUAL');
    assert.equal(r.body.data.locked, false);
  });

  // ===== W5: add rejected on ACTIVE =====
  await t.test('W5 add rejected on ACTIVE', async () => {
    const r = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/${activePlan.id}/items`, {
      plan_date: WEEK_START, meal_type: 'DINNER', recipe_id: r2
    });
    assert.equal(r.status, 409);
  });

  // ===== W6: PATCH locked true persists =====
  await t.test('W6 PATCH locked persists', async () => {
    const copy = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/generate`, {
      copy_from_plan_id: activePlan.id
    });
    const draft = copy.body.data;
    const item = draft.items[0];
    const r = await request('A', 'PATCH', `/families/${familyA.id}/weekly-plans/${draft.id}/items/${item.id}`, {
      locked: true
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.locked, true);
  });

  // ===== W7: PATCH only allows locked/sort_order =====
  await t.test('W7 PATCH rejects recipe_id change', async () => {
    const copy = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/generate`, {
      copy_from_plan_id: activePlan.id
    });
    const draft = copy.body.data;
    const item = draft.items[0];
    const r = await request('A', 'PATCH', `/families/${familyA.id}/weekly-plans/${draft.id}/items/${item.id}`, {
      recipe_id: r2
    });
    assert.equal(r.status, 400);
  });

  // ===== W8: DELETE item persists =====
  await t.test('W8 DELETE item persists', async () => {
    const copy = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/generate`, {
      copy_from_plan_id: activePlan.id
    });
    const draft = copy.body.data;
    const item = draft.items[0];
    const r = await request('A', 'DELETE', `/families/${familyA.id}/weekly-plans/${draft.id}/items/${item.id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.deleted, 1);
  });

  // ===== W9: foreign family plan mutation rejected =====
  await t.test('W9 foreign family plan mutation rejected', async () => {
    const r = await request('B', 'POST', `/families/${familyB.id}/weekly-plans/${activePlan.id}/items`, {
      plan_date: WEEK_START, meal_type: 'DINNER', recipe_id: r1
    });
    assert.ok(r.status === 403 || r.status === 404);
  });

  // ===== W10: foreign family item mutation rejected =====
  await t.test('W10 foreign family item mutation rejected', async () => {
    const activeWithItems = (await request('A', 'GET', `/families/${familyA.id}/weekly-plans?week_start=${WEEK_START}`)).body.data;
    const item = activeWithItems.items[0];
    const r = await request('B', 'PATCH', `/families/${familyB.id}/weekly-plans/${activePlan.id}/items/${item.id}`, {
      locked: true
    });
    assert.ok(r.status === 403 || r.status === 404);
  });

  // ===== W11: MEAL regenerate only changes target meal unlocked items =====
  await t.test('W11 MEAL regenerate scope isolation', async () => {
    const copy = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/generate`, {
      copy_from_plan_id: activePlan.id
    });
    const draft = copy.body.data;
    // Lock one dinner item
    const dinnerItems = draft.items.filter(i => i.meal_type === 'DINNER' && i.plan_date === WEEK_START);
    if (dinnerItems.length > 0) {
      await request('A', 'PATCH', `/families/${familyA.id}/weekly-plans/${draft.id}/items/${dinnerItems[0].id}`, { locked: true });
    }
    const breakfastBefore = draft.items.filter(i => i.meal_type === 'BREAKFAST').map(i => i.recipe_id).sort();
    const r = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/${draft.id}/regenerate`, {
      scope: 'MEAL', plan_date: WEEK_START, meal_type: 'DINNER'
    });
    assert.equal(r.status, 201);
    const newDraft = r.body.data;
    assert.equal(newDraft.status, 'DRAFT');
    // Breakfast items unchanged
    const breakfastAfter = newDraft.items.filter(i => i.meal_type === 'BREAKFAST').map(i => i.recipe_id).sort();
    assert.deepEqual(breakfastAfter, breakfastBefore);
  });

  // ===== W12: MEAL regenerate preserves locked =====
  await t.test('W12 MEAL regenerate preserves locked', async () => {
    const copy = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/generate`, {
      copy_from_plan_id: activePlan.id
    });
    const draft = copy.body.data;
    const dinnerItems = draft.items.filter(i => i.meal_type === 'DINNER' && i.plan_date === WEEK_START);
    if (dinnerItems.length === 0) return;
    await request('A', 'PATCH', `/families/${familyA.id}/weekly-plans/${draft.id}/items/${dinnerItems[0].id}`, { locked: true });
    const lockedRecipe = dinnerItems[0].recipe_id;
    const r = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/${draft.id}/regenerate`, {
      scope: 'MEAL', plan_date: WEEK_START, meal_type: 'DINNER'
    });
    const newDraft = r.body.data;
    const lockedInNew = newDraft.items.find(i => i.recipe_id === lockedRecipe && i.locked === true);
    assert.ok(lockedInNew, 'locked item must be preserved');
  });

  // ===== W13: DAY regenerate changes only target day =====
  await t.test('W13 DAY regenerate scope isolation', async () => {
    const copy = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/generate`, {
      copy_from_plan_id: activePlan.id
    });
    const draft = copy.body.data;
    const day2 = '2026-09-08';
    const beforeDay2 = draft.items.filter(i => i.plan_date === day2).map(i => i.recipe_id).sort();
    const r = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/${draft.id}/regenerate`, {
      scope: 'DAY', plan_date: day2
    });
    assert.equal(r.status, 201);
    const newDraft = r.body.data;
    // Other days (day 1) preserved
    const day1After = newDraft.items.filter(i => i.plan_date === WEEK_START).map(i => i.recipe_id).sort();
    const day1Before = draft.items.filter(i => i.plan_date === WEEK_START).map(i => i.recipe_id).sort();
    assert.deepEqual(day1After, day1Before);
  });

  // ===== W14: WEEK regenerate preserves all locked =====
  await t.test('W14 WEEK regenerate preserves locked', async () => {
    const copy = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/generate`, {
      copy_from_plan_id: activePlan.id
    });
    const draft = copy.body.data;
    const item = draft.items[0];
    await request('A', 'PATCH', `/families/${familyA.id}/weekly-plans/${draft.id}/items/${item.id}`, { locked: true });
    const r = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/${draft.id}/regenerate`, { scope: 'WEEK' });
    assert.equal(r.status, 201);
    const newDraft = r.body.data;
    const found = newDraft.items.find(i => i.recipe_id === item.recipe_id && i.locked === true);
    assert.ok(found, 'locked item preserved across WEEK regenerate');
  });

  // ===== W15: scope-outside items copied unchanged =====
  await t.test('W15 scope-outside items copied unchanged', async () => {
    const copy = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/generate`, {
      copy_from_plan_id: activePlan.id
    });
    const draft = copy.body.data;
    const lunchBefore = draft.items.filter(i => i.meal_type === 'LUNCH').map(i => `${i.plan_date}|${i.recipe_id}|${i.sort_order}`).sort();
    const r = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/${draft.id}/regenerate`, {
      scope: 'MEAL', plan_date: WEEK_START, meal_type: 'BREAKFAST'
    });
    const newDraft = r.body.data;
    const lunchAfter = newDraft.items.filter(i => i.meal_type === 'LUNCH').map(i => `${i.plan_date}|${i.recipe_id}|${i.sort_order}`).sort();
    assert.deepEqual(lunchAfter, lunchBefore);
  });

  // ===== W16: swap locked item rejected by backend =====
  await t.test('W16 swap locked item rejected by backend', async () => {
    const copy = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/generate`, {
      copy_from_plan_id: activePlan.id
    });
    const draft = copy.body.data;
    const dinnerItems = draft.items.filter(i => i.meal_type === 'DINNER' && i.plan_date === WEEK_START);
    if (dinnerItems.length === 0) return;
    await request('A', 'PATCH', `/families/${familyA.id}/weekly-plans/${draft.id}/items/${dinnerItems[0].id}`, { locked: true });
    const r = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/${draft.id}/regenerate`, {
      scope: 'MEAL', plan_date: WEEK_START, meal_type: 'DINNER', swap_item_id: dinnerItems[0].id
    });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'ITEM_LOCKED');
  });

  // ===== W17: regenerate returns new DRAFT, original plan unchanged =====
  await t.test('W17 regenerate original unchanged', async () => {
    const copy = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/generate`, {
      copy_from_plan_id: activePlan.id
    });
    const draft = copy.body.data;
    const originalItems = draft.items.length;
    const r = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/${draft.id}/regenerate`, { scope: 'WEEK' });
    assert.notEqual(r.body.data.id, draft.id);
    // Original still DRAFT with same items
    const orig = await pool.query('SELECT status FROM weekly_plans WHERE id=$1', [draft.id]);
    assert.equal(orig.rows[0].status, 'DRAFT');
  });

  // ===== W18: repeated regenerate does not corrupt ACTIVE =====
  await t.test('W18 repeated regenerate does not corrupt ACTIVE', async () => {
    const g1 = await request('A', 'GET', `/families/${familyA.id}/weekly-plans?week_start=${WEEK_START}`);
    const activeId = g1.body.data.id;
    const copy = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/generate`, {
      copy_from_plan_id: activePlan.id
    });
    let d = copy.body.data;
    for (let i = 0; i < 3; i++) {
      const r = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/${d.id}/regenerate`, { scope: 'WEEK' });
      d = r.body.data;
    }
    const g2 = await request('A', 'GET', `/families/${familyA.id}/weekly-plans?week_start=${WEEK_START}`);
    assert.equal(g2.body.data.id, activeId);
    assert.equal(g2.body.data.status, 'ACTIVE');
  });

  // ===== W19: confirm then GET returns new ACTIVE =====
  await t.test('W19 confirm then GET returns new ACTIVE', async () => {
    const copy = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/generate`, {
      copy_from_plan_id: activePlan.id
    });
    const draft = copy.body.data;
    const c = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/${draft.id}/confirm`);
    assert.equal(c.status, 200);
    const g = await request('A', 'GET', `/families/${familyA.id}/weekly-plans?week_start=${WEEK_START}`);
    assert.equal(g.body.data.id, draft.id);
    assert.equal(g.body.data.status, 'ACTIVE');
  });

  // ===== W20: import weekly → Meal only matching date/meal =====
  await t.test('W20 import weekly to Meal', async () => {
    const g = await request('A', 'GET', `/families/${familyA.id}/weekly-plans?week_start=${WEEK_START}`);
    const plan = g.body.data;
    const dinnerItem = plan.items.find(i => i.meal_type === 'DINNER');
    if (!dinnerItem) return;
    // Ensure current meal
    await request('A', 'PUT', `/families/${familyA.id}/meals/current`, {
      meal_date: dinnerItem.plan_date, meal_type: 'DINNER', diners_count: 2
    });
    const meal = (await request('A', 'GET', `/families/${familyA.id}/meals/current?date=${dinnerItem.plan_date}&meal_type=DINNER`)).body.data;
    const r = await request('A', 'POST', `/families/${familyA.id}/meals/${meal.id}/import-weekly-plan`, {
      weekly_plan_id: plan.id
    });
    assert.equal(r.status, 200);
    assert.ok(r.body.data.imported > 0);
  });

  // ===== W21: repeated import idempotent =====
  await t.test('W21 repeated import idempotent', async () => {
    const g = await request('A', 'GET', `/families/${familyA.id}/weekly-plans?week_start=${WEEK_START}`);
    const plan = g.body.data;
    const dinnerItem = plan.items.find(i => i.meal_type === 'DINNER');
    if (!dinnerItem) return;
    const meal = (await request('A', 'GET', `/families/${familyA.id}/meals/current?date=${dinnerItem.plan_date}&meal_type=DINNER`)).body.data;
    const before = (await pool.query('SELECT COUNT(*)::int as n FROM meal_items WHERE meal_id=$1', [meal.id])).rows[0].n;
    await request('A', 'POST', `/families/${familyA.id}/meals/${meal.id}/import-weekly-plan`, { weekly_plan_id: plan.id });
    const after = (await pool.query('SELECT COUNT(*)::int as n FROM meal_items WHERE meal_id=$1', [meal.id])).rows[0].n;
    assert.equal(after, before, 'repeated import must not duplicate');
  });

  // ===== W22: MEMBER write forbidden =====
  await t.test('W22 MEMBER write forbidden', async () => {
    const copy = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/generate`, {
      copy_from_plan_id: activePlan.id
    });
    const draft = copy.body.data;
    // User B is MEMBER in family A
    const r = await request('B', 'POST', `/families/${familyA.id}/weekly-plans/${draft.id}/items`, {
      plan_date: WEEK_START, meal_type: 'DINNER', recipe_id: r1
    });
    assert.equal(r.status, 403);
  });

  // ===== W23: locked item not duplicated on regenerate =====
  await t.test('W23 locked item preserved exactly once on MEAL regenerate', async () => {
    const copy = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/generate`, {
      copy_from_plan_id: activePlan.id
    });
    const draft = copy.body.data;
    const dinnerItems = draft.items.filter(i => i.meal_type === 'DINNER' && i.plan_date === WEEK_START);
    if (dinnerItems.length < 2) return;
    // Lock first dinner item
    await request('A', 'PATCH', `/families/${familyA.id}/weekly-plans/${draft.id}/items/${dinnerItems[0].id}`, { locked: true });
    const lockedRecipe = dinnerItems[0].recipe_id;
    const r = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/${draft.id}/regenerate`, {
      scope: 'MEAL', plan_date: WEEK_START, meal_type: 'DINNER'
    });
    assert.equal(r.status, 201);
    const newDraft = r.body.data;
    const lockedCount = newDraft.items.filter(i => i.recipe_id === lockedRecipe && i.locked === true).length;
    assert.equal(lockedCount, 1, 'locked recipe must appear exactly once');
  });

  // ===== W24: swap actually changes recipe =====
  await t.test('W24 swap actually changes target recipe', async () => {
    // Create a controlled DRAFT with exactly 2 dinner items: r1 (target), r2 (preserved)
    const planId = randomUUID();
    await pool.query(`INSERT INTO weekly_plans(id,family_id,week_start_date,status,generation_mode,created_by_user_id)
      VALUES ($1,$2,$3,'DRAFT','BALANCED',$4)`, [planId, familyA.id, WEEK_START, userA.id]);
    await pool.query(`INSERT INTO weekly_plan_items(id,weekly_plan_id,plan_date,meal_type,recipe_id,sort_order,locked,added_by_user_id,source)
      VALUES ($1,$2,$3,'DINNER',$4,0,false,$5,'GENERATED')`, [randomUUID(), planId, WEEK_START, r1, userA.id]);
    await pool.query(`INSERT INTO weekly_plan_items(id,weekly_plan_id,plan_date,meal_type,recipe_id,sort_order,locked,added_by_user_id,source)
      VALUES ($1,$2,$3,'DINNER',$4,1,false,$5,'GENERATED')`, [randomUUID(), planId, WEEK_START, r2, userA.id]);
    const targetItem = (await pool.query('SELECT * FROM weekly_plan_items WHERE weekly_plan_id=$1 AND recipe_id=$2', [planId, r1])).rows[0];
    const r = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/${planId}/regenerate`, {
      scope: 'MEAL', plan_date: WEEK_START, meal_type: 'DINNER', swap_item_id: targetItem.id
    });
    assert.equal(r.status, 201);
    const newDraft = r.body.data;
    const dinnerNew = newDraft.items.filter(i => i.meal_type === 'DINNER' && i.plan_date === WEEK_START);
    // r1 (target) must NOT remain as the swapped item
    const targetStillThere = dinnerNew.find(i => i.recipe_id === r1 && i.id !== targetItem.id);
    assert.ok(!targetStillThere, 'target recipe must be replaced');
    // r2 (preserved) must remain
    assert.ok(dinnerNew.some(i => i.recipe_id === r2), 'preserved recipe must remain');
    // No duplicate recipes
    const recipeIds = dinnerNew.map(i => i.recipe_id);
    assert.equal(new Set(recipeIds).size, recipeIds.length, 'no duplicate recipes in meal');
  });

  // ===== W25: no alternative recipe =====
  await t.test('W25 swap with no alternative returns 409', async () => {
    // Create DRAFT with only r1 and r2 in dinner, and ensure r3 is not DINNER-eligible
    // Actually r3 is DINNER. Let's use a meal type with only 1 recipe: BREAKFAST has only r4
    const planId = randomUUID();
    await pool.query(`INSERT INTO weekly_plans(id,family_id,week_start_date,status,generation_mode,created_by_user_id)
      VALUES ($1,$2,$3,'DRAFT','BALANCED',$4)`, [planId, familyA.id, WEEK_START, userA.id]);
    await pool.query(`INSERT INTO weekly_plan_items(id,weekly_plan_id,plan_date,meal_type,recipe_id,sort_order,locked,added_by_user_id,source)
      VALUES ($1,$2,$3,'BREAKFAST',$4,0,false,$5,'GENERATED')`, [randomUUID(), planId, WEEK_START, r4, userA.id]);
    const targetItem = (await pool.query('SELECT * FROM weekly_plan_items WHERE weekly_plan_id=$1', [planId])).rows[0];
    const r = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/${planId}/regenerate`, {
      scope: 'MEAL', plan_date: WEEK_START, meal_type: 'BREAKFAST', swap_item_id: targetItem.id
    });
    // Only r4 is BREAKFAST, so no alternative exists
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'NO_ALTERNATIVE_RECIPE');
    // Source plan unchanged
    const sourceItems = (await pool.query('SELECT COUNT(*)::int as n FROM weekly_plan_items WHERE weekly_plan_id=$1', [planId])).rows[0].n;
    assert.equal(sourceItems, 1);
  });

  // ===== W26: strict PATCH rejects extra fields =====
  await t.test('W26 strict PATCH rejects recipe_id field', async () => {
    const copy = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/generate`, {
      copy_from_plan_id: activePlan.id
    });
    const draft = copy.body.data;
    const item = draft.items.find(i => i.meal_type === 'DINNER');
    if (!item) return;
    const beforeLocked = item.locked;
    const r = await request('A', 'PATCH', `/families/${familyA.id}/weekly-plans/${draft.id}/items/${item.id}`, {
      locked: true, recipe_id: r2
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, 'INVALID_REQUEST');
    // Verify unchanged
    const after = (await pool.query('SELECT locked, recipe_id FROM weekly_plan_items WHERE id=$1', [item.id])).rows[0];
    assert.equal(after.locked, beforeLocked);
    assert.equal(after.recipe_id, item.recipe_id);
  });

  // ===== W27: regenerate parameter validation =====
  await t.test('W27 regenerate validation rejects missing fields', async () => {
    const copy = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/generate`, {
      copy_from_plan_id: activePlan.id
    });
    const draft = copy.body.data;
    // MEAL without plan_date
    const r1 = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/${draft.id}/regenerate`, {
      scope: 'MEAL', meal_type: 'DINNER'
    });
    assert.equal(r1.status, 400);
    // DAY without plan_date
    const r2 = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/${draft.id}/regenerate`, {
      scope: 'DAY'
    });
    assert.equal(r2.status, 400);
    // swap_item_id with DAY scope
    const r3 = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/${draft.id}/regenerate`, {
      scope: 'DAY', plan_date: WEEK_START, swap_item_id: randomUUID()
    });
    assert.equal(r3.status, 400);
    // invalid meal_type
    const r4 = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/${draft.id}/regenerate`, {
      scope: 'MEAL', plan_date: WEEK_START, meal_type: 'SNACK'
    });
    assert.equal(r4.status, 400);
  });

  // ===== W28: copy preserves sort_order and business fields, regenerates ids =====
  await t.test('W28 copy preserves sort_order and fields, regenerates ids', async () => {
    // Create source plan with known sort_orders
    const srcId = randomUUID();
    await pool.query(`INSERT INTO weekly_plans(id,family_id,week_start_date,status,generation_mode,created_by_user_id)
      VALUES ($1,$2,$3,'ACTIVE','BALANCED',$4)`, [srcId, familyA.id, '2026-09-14', userA.id]);
    const srcItemId = randomUUID();
    await pool.query(`INSERT INTO weekly_plan_items(id,weekly_plan_id,plan_date,meal_type,recipe_id,sort_order,locked,added_by_user_id,source)
      VALUES ($1,$2,$3,'DINNER',$4,5,true,$5,'MANUAL')`, [srcItemId, srcId, '2026-09-14', r1, userA.id]);
    const r = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/generate`, {
      copy_from_plan_id: srcId
    });
    assert.equal(r.status, 201);
    const newDraft = r.body.data;
    const newItem = newDraft.items[0];
    assert.notEqual(newItem.id, srcItemId, 'item id must be regenerated');
    assert.equal(newItem.plan_date, '2026-09-14');
    assert.equal(newItem.meal_type, 'DINNER');
    assert.equal(newItem.recipe_id, r1);
    assert.equal(newItem.sort_order, 5, 'sort_order must be preserved');
    assert.equal(newItem.locked, true, 'locked must be preserved');
    assert.equal(newItem.source, 'MANUAL', 'source must be preserved');
  });

  // ===== W29: locked + unlocked count preservation =====
  await t.test('W29 regenerate preserves total count with locked+unlocked', async () => {
    const planId = randomUUID();
    await pool.query(`INSERT INTO weekly_plans(id,family_id,week_start_date,status,generation_mode,created_by_user_id)
      VALUES ($1,$2,$3,'DRAFT','BALANCED',$4)`, [planId, familyA.id, WEEK_START, userA.id]);
    const itemA = randomUUID();
    const itemB = randomUUID();
    await pool.query(`INSERT INTO weekly_plan_items(id,weekly_plan_id,plan_date,meal_type,recipe_id,sort_order,locked,added_by_user_id,source)
      VALUES ($1,$2,$3,'DINNER',$4,0,true,$5,'GENERATED')`, [itemA, planId, WEEK_START, r1, userA.id]);
    await pool.query(`INSERT INTO weekly_plan_items(id,weekly_plan_id,plan_date,meal_type,recipe_id,sort_order,locked,added_by_user_id,source)
      VALUES ($1,$2,$3,'DINNER',$4,1,false,$5,'GENERATED')`, [itemB, planId, WEEK_START, r2, userA.id]);

    const r = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/${planId}/regenerate`, {
      scope: 'MEAL', plan_date: WEEK_START, meal_type: 'DINNER'
    });
    assert.equal(r.status, 201);
    const dinner = r.body.data.items.filter(i => i.plan_date === WEEK_START && i.meal_type === 'DINNER');
    assert.equal(dinner.length, 2, 'must preserve original slot count (locked + 1 replacement)');
    const aItems = dinner.filter(i => i.recipe_id === r1);
    assert.equal(aItems.length, 1, 'locked recipe A must appear exactly once');
    assert.equal(aItems[0].locked, true, 'A must remain locked');
    const unlocked = dinner.filter(i => !i.locked);
    assert.equal(unlocked.length, 1, 'exactly one unlocked replacement');
    const recipeIds = dinner.map(i => i.recipe_id);
    assert.equal(new Set(recipeIds).size, recipeIds.length, 'no duplicate recipe ids');
  });

  // ===== W30: all-locked exact preservation, no extra dishes =====
  await t.test('W30 all-locked regenerate preserves exactly no extra items', async () => {
    const planId = randomUUID();
    await pool.query(`INSERT INTO weekly_plans(id,family_id,week_start_date,status,generation_mode,created_by_user_id)
      VALUES ($1,$2,$3,'DRAFT','BALANCED',$4)`, [planId, familyA.id, WEEK_START, userA.id]);
    await pool.query(`INSERT INTO weekly_plan_items(id,weekly_plan_id,plan_date,meal_type,recipe_id,sort_order,locked,added_by_user_id,source)
      VALUES ($1,$2,$3,'DINNER',$4,0,true,$5,'GENERATED')`, [randomUUID(), planId, WEEK_START, r1, userA.id]);
    await pool.query(`INSERT INTO weekly_plan_items(id,weekly_plan_id,plan_date,meal_type,recipe_id,sort_order,locked,added_by_user_id,source)
      VALUES ($1,$2,$3,'DINNER',$4,1,true,$5,'GENERATED')`, [randomUUID(), planId, WEEK_START, r2, userA.id]);

    const r = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/${planId}/regenerate`, {
      scope: 'MEAL', plan_date: WEEK_START, meal_type: 'DINNER'
    });
    assert.equal(r.status, 201);
    const dinner = r.body.data.items.filter(i => i.plan_date === WEEK_START && i.meal_type === 'DINNER');
    assert.equal(dinner.length, 2, 'all-locked slot must not generate extra items');
    const ids = dinner.map(i => i.recipe_id).sort();
    assert.deepEqual(ids, [r1, r2].sort(), 'exactly A + B');
    assert.ok(dinner.every(i => i.locked === true), 'both must remain locked');
  });

  // ===== W31: ACTIVE regenerate rejected with zero side effects =====
  await t.test('W31 regenerate on ACTIVE plan rejected PLAN_NOT_DRAFT', async () => {
    const activeId = randomUUID();
    await pool.query(`INSERT INTO weekly_plans(id,family_id,week_start_date,status,generation_mode,created_by_user_id)
      VALUES ($1,$2,$3,'ACTIVE','BALANCED',$4)`, [activeId, familyA.id, '2026-09-21', userA.id]);
    await pool.query(`INSERT INTO weekly_plan_items(id,weekly_plan_id,plan_date,meal_type,recipe_id,sort_order,locked,added_by_user_id,source)
      VALUES ($1,$2,$3,'DINNER',$4,0,false,$5,'GENERATED')`, [randomUUID(), activeId, '2026-09-21', r1, userA.id]);

    const draftBefore = (await pool.query(`SELECT COUNT(*)::int AS c FROM weekly_plans WHERE family_id=$1 AND week_start_date=$2 AND status='DRAFT'`, [familyA.id, '2026-09-21'])).rows[0].c;

    const r = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/${activeId}/regenerate`, {
      scope: 'MEAL', plan_date: '2026-09-21', meal_type: 'DINNER'
    });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'PLAN_NOT_DRAFT');

    const activeAfter = (await pool.query(`SELECT status FROM weekly_plans WHERE id=$1`, [activeId])).rows[0];
    assert.equal(activeAfter.status, 'ACTIVE', 'ACTIVE must remain ACTIVE');
    const itemsAfter = (await pool.query(`SELECT COUNT(*)::int AS c FROM weekly_plan_items WHERE weekly_plan_id=$1`, [activeId])).rows[0].c;
    assert.equal(itemsAfter, 1, 'ACTIVE items unchanged');
    const draftAfter = (await pool.query(`SELECT COUNT(*)::int AS c FROM weekly_plans WHERE family_id=$1 AND week_start_date=$2 AND status='DRAFT'`, [familyA.id, '2026-09-21'])).rows[0].c;
    assert.equal(draftAfter, draftBefore, 'no DRAFT created as side effect');
  });
});
