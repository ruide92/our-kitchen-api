const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

test('Core kitchen HTTP checkpoint against real PostgreSQL', async t => {
  const connectionString = process.env.TEST_DATABASE_URL;
  assert.ok(connectionString, 'TEST_DATABASE_URL required');
  assert.match(new URL(connectionString).pathname, /_test$/i);
  assert.notEqual(connectionString, process.env.DATABASE_URL);
  const { Pool } = require('pg');
  const { loadMigrations, migrate } = require('../../backend/v1/migrations');
  const { createRepository } = require('../../backend/v1/repository');
  const { createFamilyService } = require('../../backend/v1/family-service');
  const { createApp } = require('../../backend/v1/app');
  const { createTokens } = require('../../backend/v1/tokens');
  const schema = `kitchen_core_${randomUUID().replaceAll('-', '')}`;
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

  // Seed shared ingredients + BASE recipe (same across all families)
  const ingTomato = randomUUID();
  const ingPork = randomUUID();
  const ingWater = randomUUID();
  await pool.query(`INSERT INTO ingredients(id,canonical_code,display_name,category_code,default_unit_code) VALUES
    ($1,'tomato','西红柿','VEGETABLE','g'),($2,'pork_loin','猪里脊','MEAT','g'),($3,'water','水','BEVERAGE','ml')`, [ingTomato, ingPork, ingWater]);
  await pool.query("INSERT INTO ingredient_aliases(id,ingredient_id,alias_name,normalized_alias) VALUES ($1,$2,'番茄','番茄')", [randomUUID(), ingTomato]);

  // Recipe: 番茄炒肉 (400g tomato + 300g pork, 2 servings)
  const recipeTomatoPork = randomUUID();
  await pool.query(`INSERT INTO recipes(id,kind,family_id,source_type,name,base_servings,visibility,version)
    VALUES ($1,'BASE',NULL,'SEED','番茄炒肉',2,'PUBLIC',1)`, [recipeTomatoPork]);
  await pool.query(`INSERT INTO recipe_ingredients(id,recipe_id,ingredient_id,display_name_override,quantity,unit_code,type,required,sort_order) VALUES
    ($1,$2,$3,'西红柿',400,'g','MAIN',true,0),($4,$2,$5,'猪里脊',300,'g','MAIN',true,1)`,
    [randomUUID(), recipeTomatoPork, ingTomato, randomUUID(), ingPork]);
  await pool.query("INSERT INTO recipe_meal_types(recipe_id,meal_type) VALUES ($1,'DINNER')", [recipeTomatoPork]);

  // Recipe B: 红烧肉 (1kg pork, 2 servings) - for merge test
  const recipePorkKg = randomUUID();
  await pool.query(`INSERT INTO recipes(id,kind,family_id,source_type,name,base_servings,visibility,version)
    VALUES ($1,'BASE',NULL,'SEED','红烧肉',2,'PUBLIC',1)`, [recipePorkKg]);
  await pool.query(`INSERT INTO recipe_ingredients(id,recipe_id,ingredient_id,display_name_override,quantity,unit_code,type,required,sort_order) VALUES
    ($1,$2,$3,'猪里脊',1,'kg','MAIN',true,0)`,
    [randomUUID(), recipePorkKg, ingPork]);

  // Recipe C: 蛋花汤 (500ml water, 2 servings) - for ml/l merge
  const recipeSoup = randomUUID();
  await pool.query(`INSERT INTO recipes(id,kind,family_id,source_type,name,base_servings,visibility,version)
    VALUES ($1,'BASE',NULL,'SEED','蛋花汤',2,'PUBLIC',1)`, [recipeSoup]);
  await pool.query(`INSERT INTO recipe_ingredients(id,recipe_id,ingredient_id,display_name_override,quantity,unit_code,type,required,sort_order) VALUES
    ($1,$2,$3,'水',500,'ml','MAIN',true,0)`,
    [randomUUID(), recipeSoup, ingWater]);

  const repo = createRepository(pool);
  const families = createFamilyService(pool);
  const tokens = createTokens('core-kitchen-test-key-'.repeat(3));
  const app = createApp({ repo, families, tokens, pool, wechat: { exchange: async () => { throw new Error('Not used'); } } });
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));

  const users = {};
  for (const name of ['A','B','C']) users[name] = await repo.upsertWechatUser({ openid: name, unionid: null });

  async function request(who, method, endpoint, body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1${endpoint}`, {
      method, headers: { Authorization: `Bearer ${tokens.sign(users[who].id)}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  }

  // PostgreSQL DECIMAL returns string; normalize for assertions
  const num = v => v == null ? v : Number(v);

  // Helper: create isolated family for a test
  async function makeFamily(owner, name) {
    const r = await request(owner, 'POST', '/families', { name });
    assert.equal(r.status, 201, `create family ${name}`);
    return r.body.data;
  }

  // Helper: create meal + add recipe, return meal
  async function makeMealWithRecipes(owner, familyId, date, mealType, recipeIds, diners = 2) {
    const meal = (await request(owner, 'PUT', `/families/${familyId}/meals/current`, { meal_date: date, meal_type: mealType, diners_count: diners })).body.data;
    for (const rid of recipeIds) {
      await request(owner, 'POST', `/families/${familyId}/meals/${meal.id}/items`, { recipe_id: rid, servings: diners });
    }
    return meal;
  }

  // ===== A14: Alias resolve =====
  await t.test('A14 alias resolve: 番茄 -> 西红柿 canonical', async () => {
    const fa = await makeFamily('A', 'A14 Family');
    const r = await request('A', 'POST', `/families/${fa.id}/ingredients/resolve`, { name: '番茄' });
    assert.equal(r.status, 200);
    assert.ok(r.body.data.match, 'should match via alias');
    assert.equal(r.body.data.match.canonical_code, 'tomato');
    assert.equal(r.body.data.confidence, 1.0);
    assert.equal(r.body.data.match_type, 'ALIAS_EXACT');
  });

  // ===== A15: g/kg unit conversion + merge =====
  await t.test('A15 unit conversion: g/kg merge and fridge deduction', async () => {
    const fa = await makeFamily('A', 'A15 Family');
    // Meal with 番茄炒肉 (300g pork) + 红烧肉 (1kg pork) => pork required = 1300g
    const meal = await makeMealWithRecipes('A', fa.id, '2026-09-10', 'DINNER', [recipeTomatoPork, recipePorkKg]);
    // Add fridge: 0.5kg pork = 500g
    await request('A', 'POST', `/families/${fa.id}/fridge`, { ingredient_id: ingPork, quantity: 0.5, unit_code: 'kg', storage_location: 'REFRIGERATED' });
    const list = (await request('A', 'POST', `/families/${fa.id}/shopping-lists/generate`, { meal_id: meal.id, mode: 'REPLACE_GENERATED' })).body.data;
    const porkItem = list.items.find(i => i.ingredient_id === ingPork);
    assert.ok(porkItem, 'pork should be in shopping list');
    assert.equal(num(porkItem.required_quantity), 1300, 'pork required = 300g + 1000g = 1300g');
    assert.equal(num(porkItem.inventory_deducted), 500, 'fridge 0.5kg = 500g deducted');
    assert.equal(num(porkItem.missing_quantity), 800, 'missing = 1300 - 500 = 800g');
  });

  // ===== A15b: ml/l merge =====
  await t.test('A15b unit conversion: ml/l merge correctly', async () => {
    const fa = await makeFamily('A', 'A15b Family');
    // Meal with 蛋花汤 (500ml water) + a 1L water recipe
    const recipeWaterL = randomUUID();
    await pool.query(`INSERT INTO recipes(id,kind,family_id,source_type,name,base_servings,visibility,version)
      VALUES ($1,'BASE',NULL,'SEED','大水',2,'PUBLIC',1)`, [recipeWaterL]);
    await pool.query(`INSERT INTO recipe_ingredients(id,recipe_id,ingredient_id,display_name_override,quantity,unit_code,type,required,sort_order) VALUES
      ($1,$2,$3,'水',1,'l','MAIN',true,0)`, [randomUUID(), recipeWaterL, ingWater]);
    const meal = await makeMealWithRecipes('A', fa.id, '2026-09-10', 'DINNER', [recipeSoup, recipeWaterL]);
    const list = (await request('A', 'POST', `/families/${fa.id}/shopping-lists/generate`, { meal_id: meal.id, mode: 'REPLACE_GENERATED' })).body.data;
    const waterItem = list.items.find(i => i.ingredient_id === ingWater);
    assert.ok(waterItem, 'water should be in list');
    assert.equal(num(waterItem.required_quantity), 1500, 'water required = 500ml + 1000ml = 1500ml');
    assert.equal(waterItem.unit_code, 'ml', 'base unit ml');
  });

  // ===== A16: Shopping evidence =====
  await t.test('A16 shopping evidence: required, inventory_deducted, missing', async () => {
    const fa = await makeFamily('A', 'A16 Family');
    const meal = await makeMealWithRecipes('A', fa.id, '2026-09-11', 'DINNER', [recipeTomatoPork]);
    // Add fridge: 200g tomato
    await request('A', 'POST', `/families/${fa.id}/fridge`, { ingredient_id: ingTomato, quantity: 200, unit_code: 'g', storage_location: 'REFRIGERATED' });
    const list = (await request('A', 'POST', `/families/${fa.id}/shopping-lists/generate`, { meal_id: meal.id, mode: 'REPLACE_GENERATED' })).body.data;
    const tomatoItem = list.items.find(i => i.ingredient_id === ingTomato);
    assert.ok(tomatoItem);
    assert.equal(num(tomatoItem.required_quantity), 400, 'required = original 400g');
    assert.equal(num(tomatoItem.inventory_deducted), 200, 'inventory deducted 200g');
    assert.equal(num(tomatoItem.missing_quantity), 200, 'missing = 200g');
  });

  // ===== A17: Pantry deduction =====
  await t.test('A17 pantry deduction: assume_available null quantity fully deducts', async () => {
    const fa = await makeFamily('A', 'A17 Family');
    const meal = await makeMealWithRecipes('A', fa.id, '2026-09-12', 'DINNER', [recipeTomatoPork]);
    // Pantry: pork assume_available=true, quantity=null => fully deduct
    await request('A', 'PUT', `/families/${fa.id}/pantry-staples/${ingPork}`, { assume_available: true });
    const list = (await request('A', 'POST', `/families/${fa.id}/shopping-lists/generate`, { meal_id: meal.id, mode: 'REPLACE_GENERATED' })).body.data;
    const porkItem = list.items.find(i => i.ingredient_id === ingPork);
    assert.ok(!porkItem, 'pork should be fully covered by pantry assume_available');
    const tomatoItem = list.items.find(i => i.ingredient_id === ingTomato);
    assert.ok(tomatoItem, 'tomato should still be in list (no pantry)');
  });

  // ===== A18: Shopping idempotency (MANUAL preserved) =====
  await t.test('A18 shopping idempotency: REPLACE_GENERATED preserves MANUAL', async () => {
    const fa = await makeFamily('A', 'A18 Family');
    const meal = await makeMealWithRecipes('A', fa.id, '2026-09-13', 'DINNER', [recipeTomatoPork]);
    let list = (await request('A', 'POST', `/families/${fa.id}/shopping-lists/generate`, { meal_id: meal.id, mode: 'REPLACE_GENERATED' })).body.data;
    // Add manual item: 酸奶 2盒 (unit_code=null, quantity_text="2盒")
    await request('A', 'POST', `/families/${fa.id}/shopping-lists/${list.id}/items`, { name: '酸奶', quantity: 2, quantity_text: '2盒', unit_code: null });
    // Generate again with REPLACE_GENERATED
    list = (await request('A', 'POST', `/families/${fa.id}/shopping-lists/generate`, { meal_id: meal.id, mode: 'REPLACE_GENERATED' })).body.data;
    const manualItem = list.items.find(i => i.source === 'MANUAL');
    assert.ok(manualItem, 'MANUAL item should survive REPLACE_GENERATED');
    assert.equal(manualItem.display_name_override, '酸奶');
    assert.equal(manualItem.required_quantity_text, '2盒');
    assert.equal(manualItem.unit_code, null);
  });

  // ===== A20: Complete purchase -> fridge, unpurchased excluded =====
  await t.test('A20 complete purchase: only purchased items enter fridge', async () => {
    const fa = await makeFamily('A', 'A20 Family');
    const meal = await makeMealWithRecipes('A', fa.id, '2026-09-14', 'DINNER', [recipeTomatoPork]);
    let list = (await request('A', 'POST', `/families/${fa.id}/shopping-lists/generate`, { meal_id: meal.id, mode: 'REPLACE_GENERATED' })).body.data;
    const porkItem = list.items.find(i => i.ingredient_id === ingPork);
    const tomatoItem = list.items.find(i => i.ingredient_id === ingTomato);
    // Mark only pork as purchased
    await request('A', 'PATCH', `/families/${fa.id}/shopping-lists/${list.id}/items/${porkItem.id}`, { is_purchased: true });
    // Complete
    await request('A', 'POST', `/families/${fa.id}/shopping-lists/${list.id}/complete`, {});
    // Check fridge: pork should be there, tomato should NOT
    const fridge = (await request('A', 'GET', `/families/${fa.id}/fridge`)).body.data;
    const fridgePork = fridge.find(f => f.ingredient_id === ingPork);
    const fridgeTomato = fridge.find(f => f.ingredient_id === ingTomato);
    assert.ok(fridgePork, 'pork (purchased) should be in fridge');
    assert.equal(num(fridgePork.quantity), 300, 'pork quantity = missing 300g');
    assert.ok(!fridgeTomato, 'tomato (not purchased) should NOT be in fridge');
    // Inventory movements: only PURCHASE_IN for pork
    const movements = (await pool.query("SELECT * FROM inventory_movements WHERE movement_type='PURCHASE_IN' AND family_id=$1", [fa.id])).rows;
    assert.equal(movements.length, 1, 'only one PURCHASE_IN movement (pork)');
    assert.equal(movements[0].ingredient_id, ingPork);
  });

  // ===== A20b: Purchase quantity uses missing not required =====
  await t.test('A20b purchase quantity: missing_quantity not required_quantity', async () => {
    const fa = await makeFamily('A', 'A20b Family');
    const meal = await makeMealWithRecipes('A', fa.id, '2026-09-15', 'DINNER', [recipeTomatoPork]);
    // Add fridge: 200g tomato (required 400, missing 200)
    await request('A', 'POST', `/families/${fa.id}/fridge`, { ingredient_id: ingTomato, quantity: 200, unit_code: 'g', storage_location: 'REFRIGERATED' });
    let list = (await request('A', 'POST', `/families/${fa.id}/shopping-lists/generate`, { meal_id: meal.id, mode: 'REPLACE_GENERATED' })).body.data;
    const tomatoItem = list.items.find(i => i.ingredient_id === ingTomato);
    assert.equal(num(tomatoItem.required_quantity), 400);
    assert.equal(num(tomatoItem.missing_quantity), 200);
    // Mark purchased and complete
    await request('A', 'PATCH', `/families/${fa.id}/shopping-lists/${list.id}/items/${tomatoItem.id}`, { is_purchased: true });
    await request('A', 'POST', `/families/${fa.id}/shopping-lists/${list.id}/complete`, {});
    // New fridge tomato should be 200g (the missing amount), not 400g
    const fridge = (await request('A', 'GET', `/families/${fa.id}/fridge`)).body.data;
    const fridgeTomatoes = fridge.filter(f => f.ingredient_id === ingTomato);
    const totalTomato = fridgeTomatoes.reduce((s, f) => s + (f.quantity || 0), 0);
    assert.equal(num(totalTomato), 400, 'total tomato in fridge = original 200 + purchased 200 = 400g');
  });

  // ===== A22: Weekly GET null =====
  await t.test('A22 weekly GET returns null when no ACTIVE plan', async () => {
    const fa = await makeFamily('A', 'A22 Family');
    const r = await request('A', 'GET', `/families/${fa.id}/weekly-plans?week_start=2026-09-14`);
    assert.equal(r.status, 200);
    assert.equal(r.body.data, null, 'should return null, not generate fixture');
  });

  // ===== A22b: Weekly GET only returns ACTIVE =====
  await t.test('A22b weekly GET: DRAFT not returned, ACTIVE returned', async () => {
    const fa = await makeFamily('A', 'A22b Family');
    // Insert DRAFT plan
    const draftId = randomUUID();
    await pool.query(`INSERT INTO weekly_plans(id,family_id,week_start_date,status,generation_mode,created_by_user_id)
      VALUES ($1,$2,'2026-09-14','DRAFT','MANUAL',$3)`, [draftId, fa.id, users.A.id]);
    let r = await request('A', 'GET', `/families/${fa.id}/weekly-plans?week_start=2026-09-14`);
    assert.equal(r.body.data, null, 'DRAFT should not be returned');
    // Insert ACTIVE plan
    const activeId = randomUUID();
    await pool.query(`INSERT INTO weekly_plans(id,family_id,week_start_date,status,generation_mode,created_by_user_id)
      VALUES ($1,$2,'2026-09-14','ACTIVE','MANUAL',$3)`, [activeId, fa.id, users.A.id]);
    r = await request('A', 'GET', `/families/${fa.id}/weekly-plans?week_start=2026-09-14`);
    assert.ok(r.body.data, 'ACTIVE plan should be returned');
    assert.equal(r.body.data.id, activeId);
    assert.equal(r.body.data.status, 'ACTIVE');
  });

  // ===== A30: Weekly vs Meal separation =====
  await t.test('A30 weekly vs meal: manual meal add does not modify weekly plan', async () => {
    const fa = await makeFamily('A', 'A30 Family');
    const meal = await makeMealWithRecipes('A', fa.id, '2026-09-16', 'DINNER', [recipeTomatoPork], 2);
    const weeklyCount = (await pool.query('SELECT count(*)::int AS n FROM weekly_plans WHERE family_id=$1', [fa.id])).rows[0].n;
    assert.equal(weeklyCount, 0, 'no weekly plan created by manual meal add');
    const weeklyItemCount = (await pool.query('SELECT count(*)::int AS n FROM weekly_plan_items')).rows[0].n;
    assert.equal(weeklyItemCount, 0, 'no weekly plan items created');
    // Meal item source should be MANUAL
    const mealItems = (await pool.query('SELECT source FROM meal_items WHERE meal_id=$1', [meal.id])).rows;
    assert.equal(mealItems[0].source, 'MANUAL');
  });

  // ===== A31: selected_by from token =====
  await t.test('A31 selected_by_user_id comes from token, not client body', async () => {
    const fa = await makeFamily('A', 'A31 Family');
    const meal = (await request('A', 'PUT', `/families/${fa.id}/meals/current`, { meal_date: '2026-09-17', meal_type: 'DINNER', diners_count: 2 })).body.data;
    // Spoof selected_by_user_id as user C
    await request('A', 'POST', `/families/${fa.id}/meals/${meal.id}/items`, { recipe_id: recipeTomatoPork, servings: 2, selected_by_user_id: users.C.id });
    const item = (await pool.query('SELECT selected_by_user_id FROM meal_items WHERE meal_id=$1', [meal.id])).rows[0];
    assert.equal(item.selected_by_user_id, users.A.id, 'selected_by should be token user A');
  });

  // ===== Fridge version conflict =====
  await t.test('fridge version conflict: stale version returns 409', async () => {
    const fa = await makeFamily('A', 'Version Family');
    const added = (await request('A', 'POST', `/families/${fa.id}/fridge`, { ingredient_id: ingTomato, quantity: 100, unit_code: 'g' })).body.data;
    // Update with correct version
    const updated = (await request('A', 'PATCH', `/families/${fa.id}/fridge/${added.id}`, { quantity: 200, version: added.version })).body.data;
    assert.equal(updated.version, added.version + 1);
    // Try again with old version
    const stale = await request('A', 'PATCH', `/families/${fa.id}/fridge/${added.id}`, { quantity: 300, version: added.version });
    assert.equal(stale.status, 409, 'stale version should return 409');
  });

  // ===== Pantry route contract =====
  await t.test('pantry route: PUT by ingredient_id, GET, DELETE idempotent', async () => {
    const fa = await makeFamily('A', 'Pantry Family');
    const r1 = await request('A', 'PUT', `/families/${fa.id}/pantry-staples/${ingTomato}`, { quantity: 500, unit_code: 'g', assume_available: true });
    assert.equal(r1.status, 200);
    // Repeat PUT should update, not duplicate
    const r2 = await request('A', 'PUT', `/families/${fa.id}/pantry-staples/${ingTomato}`, { quantity: 800, unit_code: 'g', assume_available: true });
    assert.equal(r2.status, 200);
    const pantryList = (await request('A', 'GET', `/families/${fa.id}/pantry-staples`)).body.data;
    const tomatoPantry = pantryList.filter(p => p.ingredient_id === ingTomato);
    assert.equal(tomatoPantry.length, 1, 'exactly one pantry staple for tomato');
    assert.equal(num(tomatoPantry[0].quantity), 800);
    // Delete
    await request('A', 'DELETE', `/families/${fa.id}/pantry-staples/${ingTomato}`);
    const afterDelete = (await request('A', 'GET', `/families/${fa.id}/pantry-staples`)).body.data;
    assert.equal(afterDelete.filter(p => p.ingredient_id === ingTomato).length, 0);
  });

  // ===== Recipe cross-family isolation =====
  await t.test('recipe cross-family isolation: FAMILY recipe invisible to other family', async () => {
    const fa = await makeFamily('A', 'Iso Family A');
    const fb = await makeFamily('B', 'Iso Family B');
    // User A creates FAMILY recipe
    const familyRecipe = (await request('A', 'POST', `/families/${fa.id}/recipes`, { name: 'A的私房菜', base_servings: 2, meal_types: ['DINNER'] })).body.data;
    // B listRecipes should not include it
    const bList = (await request('B', 'GET', `/families/${fb.id}/recipes`)).body.data;
    assert.ok(!bList.find(r => r.id === familyRecipe.id), 'B should not see A FAMILY recipe in list');
    // B getRecipe -> 403
    const bGet = await request('B', 'GET', `/families/${fb.id}/recipes/${familyRecipe.id}`);
    assert.equal(bGet.status, 403, 'B getRecipe A FAMILY recipe -> 403');
    // B addMealItem with A FAMILY recipe -> 403
    const mealB = (await request('B', 'PUT', `/families/${fb.id}/meals/current`, { meal_date: '2026-09-18', meal_type: 'DINNER', diners_count: 2 })).body.data;
    const bAdd = await request('B', 'POST', `/families/${fb.id}/meals/${mealB.id}/items`, { recipe_id: familyRecipe.id, servings: 2 });
    assert.equal(bAdd.status, 403, 'B addMealItem with A FAMILY recipe -> 403');
    // A can see own FAMILY recipe
    const aList = (await request('A', 'GET', `/families/${fa.id}/recipes`)).body.data;
    assert.ok(aList.find(r => r.id === familyRecipe.id), 'A should see own FAMILY recipe');
  });

  // ===== Recipe detail contract =====
  await t.test('recipe detail response contract: recipe/ingredients/steps/viewer', async () => {
    const fa = await makeFamily('A', 'Detail Family');
    const r = await request('A', 'GET', `/families/${fa.id}/recipes/${recipeTomatoPork}`);
    assert.equal(r.status, 200);
    assert.ok(r.body.data.recipe, 'should have recipe field');
    assert.ok(r.body.data.ingredients, 'should have ingredients field');
    assert.ok(Array.isArray(r.body.data.ingredients));
    assert.ok(r.body.data.steps, 'should have steps field');
    assert.ok(r.body.data.viewer, 'should have viewer field');
    assert.equal(r.body.data.viewer.wish_status, null);
    assert.equal(r.body.data.nutrition, null);
  });

  // ===== Meal confirm snapshot =====
  await t.test('meal confirm: recipe snapshot frozen', async () => {
    const fa = await makeFamily('A', 'Snapshot Family');
    const meal = await makeMealWithRecipes('A', fa.id, '2026-09-19', 'DINNER', [recipeTomatoPork]);
    const confirmed = (await request('A', 'POST', `/families/${fa.id}/meals/${meal.id}/confirm`, {})).body.data;
    assert.equal(confirmed.status, 'CONFIRMED');
    const item = (await pool.query('SELECT recipe_snapshot FROM meal_items WHERE meal_id=$1', [meal.id])).rows[0];
    assert.ok(item.recipe_snapshot, 'recipe_snapshot should be populated');
    assert.equal(item.recipe_snapshot.name, '番茄炒肉');
    assert.ok(item.recipe_snapshot.ingredients.length > 0);
    assert.ok(item.recipe_snapshot.version, 'snapshot should record recipe version');
  });

  // ===== Single recipe no double count =====
  await t.test('single recipe no double count: pork 300g = 300 not 600', async () => {
    const fa = await makeFamily('A', 'NoDouble Family');
    const meal = await makeMealWithRecipes('A', fa.id, '2026-09-20', 'DINNER', [recipeTomatoPork]);
    const list = (await request('A', 'POST', `/families/${fa.id}/shopping-lists/generate`, { meal_id: meal.id, mode: 'REPLACE_GENERATED' })).body.data;
    const porkItem = list.items.find(i => i.ingredient_id === ingPork);
    assert.ok(porkItem);
    assert.equal(num(porkItem.required_quantity), 300, 'single recipe pork = 300g, not 600g');
  });

  // ===== Incompatible units: COUNT vs MASS not merged =====
  await t.test('incompatible units: 葱 2根 + 葱 30g stay separate', async () => {
    const fa = await makeFamily('A', 'Incompat Family');
    // Create scallion ingredient with default unit root (COUNT)
    const ingScallion = randomUUID();
    await pool.query(`INSERT INTO ingredients(id,canonical_code,display_name,category_code,default_unit_code) VALUES ($1,'scallion','葱','VEGETABLE','root')`, [ingScallion]);
    // Recipe A: 葱 2根
    const recipeA = randomUUID();
    await pool.query(`INSERT INTO recipes(id,kind,family_id,source_type,name,base_servings,visibility,version) VALUES ($1,'BASE',NULL,'SEED','葱菜谱A',2,'PUBLIC',1)`, [recipeA]);
    await pool.query(`INSERT INTO recipe_ingredients(id,recipe_id,ingredient_id,display_name_override,quantity,unit_code,type,required,sort_order) VALUES ($1,$2,$3,'葱',2,'root','MAIN',true,0)`, [randomUUID(), recipeA, ingScallion]);
    // Recipe B: 葱 30g
    const recipeB = randomUUID();
    await pool.query(`INSERT INTO recipes(id,kind,family_id,source_type,name,base_servings,visibility,version) VALUES ($1,'BASE',NULL,'SEED','葱菜谱B',2,'PUBLIC',1)`, [recipeB]);
    await pool.query(`INSERT INTO recipe_ingredients(id,recipe_id,ingredient_id,display_name_override,quantity,unit_code,type,required,sort_order) VALUES ($1,$2,$3,'葱',30,'g','MAIN',true,0)`, [randomUUID(), recipeB, ingScallion]);

    const meal = await makeMealWithRecipes('A', fa.id, '2026-09-21', 'DINNER', [recipeA, recipeB]);
    const list = (await request('A', 'POST', `/families/${fa.id}/shopping-lists/generate`, { meal_id: meal.id, mode: 'REPLACE_GENERATED' })).body.data;
    const scallionItems = list.items.filter(i => i.ingredient_id === ingScallion);
    assert.equal(scallionItems.length, 2, 'should have 2 separate items for incompatible units');
    const rootItem = scallionItems.find(i => i.unit_code === 'root');
    const gItem = scallionItems.find(i => i.unit_code === 'g');
    assert.ok(rootItem, 'root unit item should exist');
    assert.ok(gItem, 'g unit item should exist');
    assert.equal(num(rootItem.required_quantity), 2, 'root item = 2根');
    assert.equal(num(gItem.required_quantity), 30, 'g item = 30g');
  });

  await t.test('shopping GET current returns meal_summary with real recipe names', async () => {
    const fa = await makeFamily('B', 'GETCUR Family');
    // Create pork ingredient
    const ingPork = randomUUID();
    await pool.query(`INSERT INTO ingredients(id,canonical_code,display_name,category_code,default_unit_code) VALUES ($1,'pork','猪肉','MEAT','g')`, [ingPork]);
    // Recipe: 辣椒炒肉 with pork 300g
    const recipe = randomUUID();
    await pool.query(`INSERT INTO recipes(id,kind,family_id,source_type,name,base_servings,visibility,version) VALUES ($1,'BASE',NULL,'SEED','辣椒炒肉',2,'PUBLIC',1)`, [recipe]);
    await pool.query(`INSERT INTO recipe_ingredients(id,recipe_id,ingredient_id,display_name_override,quantity,unit_code,type,required,sort_order) VALUES ($1,$2,$3,'猪肉',300,'g','MAIN',true,0)`, [randomUUID(), recipe, ingPork]);
    // Create meal with 2 servings
    const meal = await makeMealWithRecipes('B', fa.id, '2026-09-22', 'DINNER', [recipe]);
    // Generate shopping list
    await request('B', 'POST', `/families/${fa.id}/shopping-lists/generate`, { meal_id: meal.id, mode: 'REPLACE_GENERATED' });
    // GET current
    const res = await request('B', 'GET', `/families/${fa.id}/shopping-lists/current`);
    assert.equal(res.status, 200, 'GET current should be 200');
    const list = res.body.data;
    assert.ok(list.meal_summary, 'meal_summary should not be null');
    const md = new Date(list.meal_summary.meal_date); assert.equal(md.getUTCFullYear(), 2026, 'meal_date year'); assert.equal(md.getUTCMonth(), 8, 'meal_date month'); assert.equal(md.getUTCDate(), 21, 'meal_date day (UTC)');
    assert.equal(list.meal_summary.meal_type, 'DINNER', 'meal_type correct');
    assert.equal(num(list.meal_summary.diners_count), 2, 'diners_count correct');
    assert.ok(list.meal_summary.recipes.includes('辣椒炒肉'), 'recipes should include 辣椒炒肉');
  });

  await t.test('shopping evidence persistence: sources survive GET current reload', async () => {
    const fa = await makeFamily('C', 'EVID Family');
    const ingPork = randomUUID();
    await pool.query(`INSERT INTO ingredients(id,canonical_code,display_name,category_code,default_unit_code) VALUES ($1,'pork2','猪肉','MEAT','g')`, [ingPork]);
    const recipe = randomUUID();
    await pool.query(`INSERT INTO recipes(id,kind,family_id,source_type,name,base_servings,visibility,version) VALUES ($1,'BASE',NULL,'SEED','苦瓜炒蛋',2,'PUBLIC',1)`, [recipe]);
    await pool.query(`INSERT INTO recipe_ingredients(id,recipe_id,ingredient_id,display_name_override,quantity,unit_code,type,required,sort_order) VALUES ($1,$2,$3,'猪肉',400,'g','MAIN',true,0)`, [randomUUID(), recipe, ingPork]);
    const meal = await makeMealWithRecipes('C', fa.id, '2026-09-23', 'LUNCH', [recipe]);
    await request('C', 'POST', `/families/${fa.id}/shopping-lists/generate`, { meal_id: meal.id, mode: 'REPLACE_GENERATED' });
    // GET current and verify evidence fields + sources
    const res = await request('C', 'GET', `/families/${fa.id}/shopping-lists/current`);
    const list = res.body.data;
    const porkItem = list.items.find(i => i.ingredient_id === ingPork);
    assert.ok(porkItem, 'pork item should exist');
    assert.ok(porkItem.required_quantity != null, 'required_quantity present');
    assert.ok(porkItem.inventory_deducted != null, 'inventory_deducted present');
    assert.ok(porkItem.pantry_deducted != null, 'pantry_deducted present');
    assert.ok(porkItem.missing_quantity != null, 'missing_quantity present');
    assert.ok(Array.isArray(porkItem.sources), 'sources should be array');
    assert.ok(porkItem.sources.length > 0, 'sources should not be empty');
    assert.ok(porkItem.sources[0].recipe_name, 'source should have recipe_name');
    assert.equal(porkItem.sources[0].recipe_name, '苦瓜炒蛋', 'source recipe_name correct');
  });
});
