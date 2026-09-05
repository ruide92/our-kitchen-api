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

  // Seed ingredients (units already seeded by migration)
  const ingTomato = randomUUID();
  const ingPork = randomUUID();
  await pool.query(`INSERT INTO ingredients(id,canonical_code,display_name,category_code,default_unit_code) VALUES
    ($1,'tomato','西红柿','VEGETABLE','g'),($2,'pork_loin','猪里脊','MEAT','g')`, [ingTomato, ingPork]);
  await pool.query("INSERT INTO ingredient_aliases(id,ingredient_id,alias_name,normalized_alias) VALUES ($1,$2,'番茄','番茄')", [randomUUID(), ingTomato]);

  // Seed recipe
  const recipeId = randomUUID();
  await pool.query(`INSERT INTO recipes(id,kind,family_id,source_type,name,base_servings,visibility,version)
    VALUES ($1,'BASE',NULL,'SEED','番茄炒肉',2,'PUBLIC',1)`, [recipeId]);
  await pool.query(`INSERT INTO recipe_ingredients(id,recipe_id,ingredient_id,display_name_override,quantity,unit_code,type,required,sort_order) VALUES
    ($1,$2,$3,'西红柿',400,'g','MAIN',true,0),($4,$2,$5,'猪里脊',300,'g','MAIN',true,1)`,
    [randomUUID(), recipeId, ingTomato, randomUUID(), ingPork]);
  await pool.query("INSERT INTO recipe_meal_types(recipe_id,meal_type) VALUES ($1,'DINNER')", [recipeId]);

  const { createFamilyService } = require('../../backend/v1/family-service');
  const repo = createRepository(pool);
  const families = createFamilyService(pool);
  const tokens = createTokens('core-kitchen-test-key-'.repeat(3));
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

  const users = {};
  for (const name of ['A','B']) users[name] = await repo.upsertWechatUser({ openid: name, unionid: null });
  const fa = (await request('A','POST','/families',{ name: 'Test Kitchen' })).body.data;

  // A14: Alias resolve - 番茄 maps to 西红柿
  await t.test('A14 alias resolve: 番茄 -> 西红柿 canonical', async () => {
    const r = await request('A','POST',`/families/${fa.id}/ingredients/resolve`,{ name: '番茄' });
    assert.equal(r.status, 200);
    assert.ok(r.body.data.match, 'should match');
    assert.equal(r.body.data.match.canonical_code, 'tomato');
    assert.equal(r.body.data.confidence, 1.0);
  });

  // A15: g/kg unit conversion in shopping calculation
  await t.test('A15 unit conversion: g and kg merge correctly', async () => {
    // Create meal with recipe (400g tomato + 300g pork for 2 servings)
    const meal = (await request('A','PUT',`/families/${fa.id}/meals/current`,{ meal_date:'2026-09-10', meal_type:'DINNER', diners_count:2 })).body.data;
    await request('A','POST',`/families/${fa.id}/meals/${meal.id}/items`,{ recipe_id: recipeId, servings:2 });
    // Add fridge: 0.5kg tomato = 500g
    await request('A','POST',`/families/${fa.id}/fridge`,{ ingredient_id: ingTomato, quantity:0.5, unit_code:'kg', storage_location:'REFRIGERATED' });
    const list = (await request('A','POST',`/families/${fa.id}/shopping-lists/generate`,{ meal_id: meal.id, mode:'REPLACE_GENERATED' })).body.data;
    const tomatoItem = list.items.find(i => i.ingredient_id === ingTomato);
    // Required 400g, fridge has 500g (0.5kg converted), so missing should be 0 -> not in list
    assert.ok(!tomatoItem, 'tomato should be fully covered by fridge 0.5kg');
    const porkItem = list.items.find(i => i.ingredient_id === ingPork);
    assert.ok(porkItem, 'pork should be in list');
    assert.equal(porkItem.required_quantity, 300);
    assert.equal(porkItem.missing_quantity, 300);
  });

  // A16: Shopping evidence - required/inventory/missing
  await t.test('A16 shopping evidence: required, inventory_deducted, missing', async () => {
    const meal = (await request('A','PUT',`/families/${fa.id}/meals/current`,{ meal_date:'2026-09-11', meal_type:'DINNER', diners_count:2 })).body.data;
    await request('A','POST',`/families/${fa.id}/meals/${meal.id}/items`,{ recipe_id: recipeId, servings:2 });
    // Add fridge: 200g tomato
    await request('A','POST',`/families/${fa.id}/fridge`,{ ingredient_id: ingTomato, quantity:200, unit_code:'g', storage_location:'REFRIGERATED' });
    const list = (await request('A','POST',`/families/${fa.id}/shopping-lists/generate`,{ meal_id: meal.id, mode:'REPLACE_GENERATED' })).body.data;
    const tomatoItem = list.items.find(i => i.ingredient_id === ingTomato);
    assert.ok(tomatoItem);
    assert.equal(tomatoItem.required_quantity, 400, 'required should be original 400g');
    assert.equal(tomatoItem.inventory_deducted, 200, 'inventory deducted 200g');
    assert.equal(tomatoItem.missing_quantity, 200, 'missing 200g');
  });

  // A17: Pantry deduction - assume_available with null quantity = fully deduct
  await t.test('A17 pantry deduction: assume_available null quantity fully deducts', async () => {
    const meal = (await request('A','PUT',`/families/${fa.id}/meals/current`,{ meal_date:'2026-09-12', meal_type:'DINNER', diners_count:2 })).body.data;
    await request('A','POST',`/families/${fa.id}/meals/${meal.id}/items`,{ recipe_id: recipeId, servings:2 });
    // Add pantry staple: salt (assume_available=true, quantity=null)
    // Use pork as pantry test - assume available fully
    await request('A','PUT',`/families/${fa.id}/pantry-staples/${ingPork}`,{ assume_available: true });
    const list = (await request('A','POST',`/families/${fa.id}/shopping-lists/generate`,{ meal_id: meal.id, mode:'REPLACE_GENERATED' })).body.data;
    const porkItem = list.items.find(i => i.ingredient_id === ingPork);
    assert.ok(!porkItem, 'pork should be fully covered by pantry assume_available');
  });

  // A18: Shopping idempotency - REPLACE_GENERATED preserves MANUAL
  await t.test('A18 shopping idempotency: REPLACE_GENERATED preserves MANUAL', async () => {
    const meal = (await request('A','PUT',`/families/${fa.id}/meals/current`,{ meal_date:'2026-09-13', meal_type:'DINNER', diners_count:2 })).body.data;
    await request('A','POST',`/families/${fa.id}/meals/${meal.id}/items`,{ recipe_id: recipeId, servings:2 });
    let list = (await request('A','POST',`/families/${fa.id}/shopping-lists/generate`,{ meal_id: meal.id, mode:'REPLACE_GENERATED' })).body.data;
    // Add manual item
    await request('A','POST',`/families/${fa.id}/shopping-lists/${list.id}/items`,{ name:'酸奶', quantity:2, unit_code:'box' });
    // Generate again
    list = (await request('A','POST',`/families/${fa.id}/shopping-lists/generate`,{ meal_id: meal.id, mode:'REPLACE_GENERATED' })).body.data;
    const manualItem = list.items.find(i => i.source === 'MANUAL');
    assert.ok(manualItem, 'MANUAL item should survive REPLACE_GENERATED');
    assert.equal(manualItem.display_name_override, '酸奶');
  });

  // A20: Complete purchase -> fridge
  await t.test('A20 complete purchase: purchased items enter fridge', async () => {
    const meal = (await request('A','PUT',`/families/${fa.id}/meals/current`,{ meal_date:'2026-09-14', meal_type:'DINNER', diners_count:2 })).body.data;
    await request('A','POST',`/families/${fa.id}/meals/${meal.id}/items`,{ recipe_id: recipeId, servings:2 });
    let list = (await request('A','POST',`/families/${fa.id}/shopping-lists/generate`,{ meal_id: meal.id, mode:'REPLACE_GENERATED' })).body.data;
    const porkItem = list.items.find(i => i.ingredient_id === ingPork);
    // Mark as purchased
    await request('A','PATCH',`/families/${fa.id}/shopping-lists/${list.id}/items/${porkItem.id}`,{ is_purchased: true });
    // Complete
    await request('A','POST',`/families/${fa.id}/shopping-lists/${list.id}/complete`,{});
    // Check fridge
    const fridge = (await request('A','GET',`/families/${fa.id}/fridge`)).body.data;
    const fridgePork = fridge.find(f => f.ingredient_id === ingPork);
    assert.ok(fridgePork, 'pork should be in fridge after purchase');
    assert.equal(fridgePork.quantity, 300);
    // Check inventory movement
    const movements = (await pool.query("SELECT * FROM inventory_movements WHERE movement_type='PURCHASE_IN' AND ingredient_id=$1", [ingPork])).rows;
    assert.ok(movements.length > 0, 'PURCHASE_IN movement should exist');
  });

  // A22: Weekly GET null - no implicit generation
  await t.test('A22 weekly GET returns null, no fixture generation', async () => {
    const r = await request('A','GET',`/families/${fa.id}/weekly-plans?week_start=2026-09-14`);
    assert.equal(r.status, 200);
    assert.equal(r.body.data, null, 'should return null, not generate fixture');
  });

  // A30: Weekly vs Meal separation - manual add doesn't touch weekly
  await t.test('A30 weekly vs meal: manual meal add does not modify weekly plan', async () => {
    const meal = (await request('A','PUT',`/families/${fa.id}/meals/current`,{ meal_date:'2026-09-15', meal_type:'DINNER', diners_count:2 })).body.data;
    await request('A','POST',`/families/${fa.id}/meals/${meal.id}/items`,{ recipe_id: recipeId, servings:2, source:'MANUAL' });
    const weeklyCount = (await pool.query('SELECT count(*) FROM weekly_plans WHERE family_id=$1', [fa.id])).rows[0].count;
    assert.equal(weeklyCount, 0, 'no weekly plan should be created by manual meal add');
    const weeklyItemCount = (await pool.query('SELECT count(*) FROM weekly_plan_items')).rows[0].count;
    assert.equal(weeklyItemCount, 0, 'no weekly plan items should be created');
  });

  // A31: selected_by from token
  await t.test('A31 selected_by_user_id comes from token, not client', async () => {
    const meal = (await request('A','PUT',`/families/${fa.id}/meals/current`,{ meal_date:'2026-09-16', meal_type:'DINNER', diners_count:2 })).body.data;
    // Try to spoof selected_by_user_id as user B
    await request('A','POST',`/families/${fa.id}/meals/${meal.id}/items`,{ recipe_id: recipeId, servings:2, selected_by_user_id: users.B.id });
    const item = (await pool.query('SELECT selected_by_user_id FROM meal_items WHERE meal_id=$1', [meal.id])).rows[0];
    assert.equal(item.selected_by_user_id, users.A.id, 'selected_by should be token user A, not spoofed B');
  });

  // Fridge version conflict
  await t.test('fridge version conflict: stale version returns 409', async () => {
    const added = (await request('A','POST',`/families/${fa.id}/fridge`,{ ingredient_id: ingTomato, quantity:100, unit_code:'g' })).body.data;
    // Update with correct version
    const updated = (await request('A','PATCH',`/families/${fa.id}/fridge/${added.id}`,{ quantity:200, version: added.version })).body.data;
    assert.equal(updated.version, added.version + 1);
    // Try again with old version
    const stale = await request('A','PATCH',`/families/${fa.id}/fridge/${added.id}`,{ quantity:300, version: added.version });
    assert.equal(stale.status, 409, 'stale version should return 409');
  });

  // Pantry route contract
  await t.test('pantry route: PUT by ingredient_id, GET, DELETE idempotent', async () => {
    const r1 = await request('A','PUT',`/families/${fa.id}/pantry-staples/${ingTomato}`,{ quantity:500, unit_code:'g', assume_available:true });
    assert.equal(r1.status, 200);
    // Repeat PUT should update, not duplicate
    const r2 = await request('A','PUT',`/families/${fa.id}/pantry-staples/${ingTomato}`,{ quantity:800, unit_code:'g', assume_available:true });
    assert.equal(r2.status, 200);
    const pantryList = (await request('A','GET',`/families/${fa.id}/pantry-staples`)).body.data;
    const tomatoPantry = pantryList.filter(p => p.ingredient_id === ingTomato);
    assert.equal(tomatoPantry.length, 1, 'should have exactly one pantry staple for tomato');
    assert.equal(tomatoPantry[0].quantity, 800);
    // Delete
    await request('A','DELETE',`/families/${fa.id}/pantry-staples/${ingTomato}`);
    const afterDelete = (await request('A','GET',`/families/${fa.id}/pantry-staples`)).body.data;
    assert.equal(afterDelete.filter(p => p.ingredient_id === ingTomato).length, 0);
  });

  // Recipe family isolation
  await t.test('recipe family isolation: FAMILY recipe not visible to other family', async () => {
    // User A creates FAMILY recipe
    const familyRecipe = (await request('A','POST',`/families/${fa.id}/recipes`,{ name:'A的私房菜', base_servings:2, meal_types:['DINNER'] })).body.data;
    // User B is not in family A, should get 403
    const r = await request('B','GET',`/families/${fa.id}/recipes/${familyRecipe.id}`);
    assert.equal(r.status, 403, 'non-member should not see FAMILY recipe');
  });

  // Recipe detail contract
  await t.test('recipe detail response contract: recipe/ingredients/steps/viewer', async () => {
    const r = await request('A','GET',`/families/${fa.id}/recipes/${recipeId}`);
    assert.equal(r.status, 200);
    assert.ok(r.body.data.recipe, 'should have recipe field');
    assert.ok(r.body.data.ingredients, 'should have ingredients field');
    assert.ok(Array.isArray(r.body.data.ingredients));
    assert.ok(r.body.data.steps, 'should have steps field');
    assert.ok(r.body.data.viewer, 'should have viewer field');
    assert.equal(r.body.data.viewer.wish_status, 'UNKNOWN');
  });

  // Meal confirm snapshot
  await t.test('meal confirm: recipe snapshot frozen', async () => {
    const meal = (await request('A','PUT',`/families/${fa.id}/meals/current`,{ meal_date:'2026-09-17', meal_type:'DINNER', diners_count:2 })).body.data;
    await request('A','POST',`/families/${fa.id}/meals/${meal.id}/items`,{ recipe_id: recipeId, servings:2 });
    const confirmed = (await request('A','POST',`/families/${fa.id}/meals/${meal.id}/confirm`,{})).body.data;
    assert.equal(confirmed.status, 'CONFIRMED');
    const item = (await pool.query('SELECT recipe_snapshot FROM meal_items WHERE meal_id=$1', [meal.id])).rows[0];
    assert.ok(item.recipe_snapshot, 'recipe_snapshot should be populated');
    assert.equal(item.recipe_snapshot.name, '番茄炒肉');
    assert.ok(item.recipe_snapshot.ingredients.length > 0);
  });
});
