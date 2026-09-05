// Meal Recipe Snapshot + Pantry Custom Integration Tests
// S1-S14: historical correctness, fail-closed, pantry custom semantics, fresh migration replay
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

test('Meal snapshot historical correctness + pantry custom', async t => {
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
  const schema = `snap_${randomUUID().replaceAll('-', '')}`;
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

  // Seed ingredients
  const ingPork = randomUUID();
  const ingTomato = randomUUID();
  await pool.query(`INSERT INTO ingredients(id,canonical_code,display_name,category_code,default_unit_code) VALUES
    ($1,'pork_loin','猪里脊','MEAT','g'),($2,'tomato','西红柿','VEGETABLE','g')`, [ingPork, ingTomato]);

  // Recipe: 红烧肉 (500g pork, 2 servings, 2 steps)
  const recipeId = randomUUID();
  await pool.query(`INSERT INTO recipes(id,kind,family_id,source_type,name,base_servings,visibility,version,cook_time_minutes,difficulty)
    VALUES ($1,'BASE',NULL,'SEED','红烧肉',2,'PUBLIC',1,40,2)`, [recipeId]);
  await pool.query("INSERT INTO recipe_meal_types(recipe_id,meal_type) VALUES ($1,'DINNER')", [recipeId]);

  // Seed rich recipe metadata for S2 completeness proof
  const riId = randomUUID();
  await pool.query(`INSERT INTO recipe_ingredients(id,recipe_id,ingredient_id,display_name_override,quantity,unit_code,type,required,sort_order) VALUES
    ($1,$2,$3,'五花肉',500,'g','MAIN',true,0)`, [riId, recipeId, ingPork]);
  const step1Id = randomUUID();
  const step2Id = randomUUID();
  await pool.query(`INSERT INTO recipe_steps(id,recipe_id,step_no,title,operation,sort_order) VALUES
    ($1,$2,1,'焯水','冷水下锅焯水',0),($3,$2,2,'炖煮','加糖色炖煮',1)`,
    [step1Id, recipeId, step2Id]);
  // cookware
  await pool.query("INSERT INTO recipe_cookware(recipe_id,cookware_code) VALUES ($1,'WOK'),($1,'POT')", [recipeId]);
  // tags
  await pool.query("INSERT INTO recipe_tags(recipe_id,tag_code) VALUES ($1,'HOME_STYLE'),($1,'FAVORITE')", [recipeId]);
  // allergens
  await pool.query("INSERT INTO recipe_allergens(recipe_id,allergen_code) VALUES ($1,'SOY')", [recipeId]);
  // ingredient alternatives
  await pool.query(`INSERT INTO recipe_ingredient_alternatives(id,recipe_ingredient_id,alternative_ingredient_id,alternative_name,ratio,note,sort_order)
    VALUES ($1,$2,$3,'牛腩',1.2,'可替代',0)`, [randomUUID(), riId, ingPork]);
  // step media
  await pool.query(`INSERT INTO recipe_step_media(id,recipe_step_id,media_type,url,sort_order)
    VALUES ($1,$2,'IMAGE','https://img.example.com/step1.jpg',0)`, [randomUUID(), step1Id]);
  // nutrition
  await pool.query(`INSERT INTO recipe_nutrition(id,recipe_id,serving_size,serving_unit,calories_kcal,protein_g,fat_g,carbs_g,fiber_g,sodium_mg,source)
    VALUES ($1,$2,100,'g',250,15,18,8,2,500,'ESTIMATED')`, [randomUUID(), recipeId]);
  // nutrition tags
  await pool.query("INSERT INTO recipe_nutrition_tags(recipe_id,tag_code) VALUES ($1,'HIGH_PROTEIN')", [recipeId]);
  // traditional diet tags
  await pool.query("INSERT INTO recipe_traditional_diet_tags(recipe_id,tag_code) VALUES ($1,'WARMING')", [recipeId]);
  // recipe media with full fields
  await pool.query(`INSERT INTO recipe_media(id,recipe_id,media_type,asset_url,asset_id,generation_prompt,source_url,sort_order)
    VALUES ($1,$2,'IMAGE','https://img.example.com/dish.jpg','asset_123','prompt text','https://source.example.com',0)`,
    [randomUUID(), recipeId]);
  // vegetable categories
  await pool.query("INSERT INTO recipe_vegetable_categories(recipe_id,category_code) VALUES ($1,'ROOT')", [recipeId]);

  const repo = createRepository(pool);
  const families = createFamilyService(pool);
  const tokens = createTokens('snapshot-test-key-'.repeat(3));
  const app = createApp({ repo, families, tokens, pool, wechat: { exchange: async () => { throw new Error('Not used'); } } });
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));

  const user = await repo.upsertWechatUser({ openid: 'snapuser', unionid: null });

  async function request(method, endpoint, body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1${endpoint}`, {
      method, headers: { Authorization: `Bearer ${tokens.sign(user.id)}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  }

  // Create family via HTTP API
  const famRes = await request('POST', '/families', { name: '快照测试家庭' });
  assert.equal(famRes.status, 201, `create family: ${JSON.stringify(famRes.body)}`);
  const family = famRes.body.data;

  // Helper: create meal + add recipe
  async function createMealWithRecipe(date, type) {
    const mealRes = await request('PUT', `/families/${family.id}/meals/current`, { meal_date: date, meal_type: type, diners_count: 2 });
    assert.equal(mealRes.status, 200, `ensure meal failed: ${JSON.stringify(mealRes.body)}`);
    const meal = mealRes.body.data || mealRes.body;
    const mealId = meal.id;
    assert.ok(mealId, 'meal id must exist');
    const addRes = await request('POST', `/families/${family.id}/meals/${mealId}/items`, { recipe_id: recipeId, servings: 2 });
    assert.equal(addRes.status, 201, `add meal item failed: ${JSON.stringify(addRes.body)}`);
    return mealId;
  }

  // ===== S1: confirm creates schema_version=1 full snapshot =====
  await t.test('S1: confirm creates schema_version=1 full snapshot', async () => {
    const mealId = await createMealWithRecipe('2026-09-10', 'DINNER');
    const confirmRes = await request('POST', `/families/${family.id}/meals/${mealId}/confirm`, {});
    assert.equal(confirmRes.status, 200, `confirm failed: ${JSON.stringify(confirmRes.body)}`);
    const meal = confirmRes.body.data;
    assert.ok(meal.recipe_snapshot, 'snapshot must exist');
    assert.equal(meal.recipe_snapshot.schema_version, 1, 'schema_version must be 1');
    assert.ok(meal.recipe_snapshot.captured_at, 'captured_at must exist');
    assert.equal(meal.recipe_snapshot.items.length, 1, 'one recipe in snapshot');
    const item = meal.recipe_snapshot.items[0];
    assert.equal(item.recipe_id, recipeId);
    assert.equal(item.recipe.name, '红烧肉');
    assert.equal(item.recipe.version, 1);
    assert.equal(item.servings, 2);
    assert.equal(item.ingredients.length, 1, 'ingredients captured');
    assert.equal(item.ingredients[0].quantity, 500);
    assert.equal(item.steps.length, 2, 'steps captured');
    assert.equal(item.steps[0].title, '焯水');
  });

  // ===== S2: full snapshot completeness proof =====
  await t.test('S2: full snapshot completeness — all fields captured', async () => {
    const mealId = await createMealWithRecipe('2026-09-11', 'DINNER');
    const confirmRes = await request('POST', `/families/${family.id}/meals/${mealId}/confirm`, {});
    assert.equal(confirmRes.status, 200);
    const snap = confirmRes.body.data.recipe_snapshot.items[0];

    // recipe core
    assert.equal(snap.recipe.name, '红烧肉');
    assert.equal(snap.recipe.cook_time_minutes, 40);
    assert.equal(snap.recipe.difficulty, 2);
    assert.equal(snap.recipe.version, 1);

    // ingredients + alternatives
    assert.equal(snap.ingredients.length, 1);
    assert.equal(snap.ingredients[0].name, '五花肉');
    assert.equal(snap.ingredients[0].quantity, 500);
    assert.equal(snap.ingredients[0].unit_code, 'g');
    assert.equal(snap.ingredients[0].required, true);
    assert.ok(snap.ingredients[0].alternatives.length >= 1, 'ingredient alternatives captured');
    assert.equal(snap.ingredients[0].alternatives[0].alternative_name, '牛腩');
    assert.equal(snap.ingredients[0].alternatives[0].ratio, 1.2);

    // steps + step media
    assert.equal(snap.steps.length, 2);
    assert.equal(snap.steps[0].title, '焯水');
    assert.equal(snap.steps[1].operation, '加糖色炖煮');
    assert.ok(snap.steps[0].media.length >= 1, 'step media captured');
    assert.equal(snap.steps[0].media[0].asset_url, 'https://img.example.com/step1.jpg');
    assert.equal(snap.steps[0].media[0].media_type, 'IMAGE');

    // cookware
    assert.ok(snap.cookware.length >= 2, 'cookware captured');
    assert.ok(snap.cookware.some(c => c.cookware_code === 'WOK'));
    assert.ok(snap.cookware.some(c => c.cookware_code === 'POT'));

    // meal_types
    assert.ok(snap.meal_types.includes('DINNER'));

    // tags
    assert.ok(snap.tags.includes('HOME_STYLE'));
    assert.ok(snap.tags.includes('FAVORITE'));

    // allergens
    assert.ok(snap.allergens.includes('SOY'));

    // nutrition
    assert.ok(snap.nutrition, 'nutrition captured');
    assert.equal(snap.nutrition.calories_kcal, 250);
    assert.equal(snap.nutrition.protein_g, 15);
    assert.equal(snap.nutrition.source, 'ESTIMATED');

    // nutrition_tags
    assert.ok(snap.nutrition_tags.includes('HIGH_PROTEIN'), 'nutrition_tags captured');

    // traditional_diet_tags
    assert.ok(snap.traditional_diet_tags.includes('WARMING'), 'traditional_diet_tags captured');

    // recipe media — full fields
    assert.ok(snap.media.length >= 1, 'recipe media captured');
    assert.equal(snap.media[0].asset_url, 'https://img.example.com/dish.jpg');
    assert.equal(snap.media[0].asset_id, 'asset_123');
    assert.equal(snap.media[0].generation_prompt, 'prompt text');
    assert.equal(snap.media[0].source_url, 'https://source.example.com');
    assert.equal(snap.media[0].media_type, 'IMAGE');

    // vegetable_categories
    assert.ok(snap.vegetable_categories.includes('ROOT'), 'vegetable_categories captured');
  });

  // ===== S3: confirm then modify recipe, startCooking still old steps =====
  await t.test('S3: confirm then modify recipe — startCooking still old steps', async () => {
    const mealId = await createMealWithRecipe('2026-09-12', 'DINNER');
    await request('POST', `/families/${family.id}/meals/${mealId}/confirm`, {});
    await pool.query("UPDATE recipes SET name='新红烧肉' WHERE id=$1", [recipeId]);
    await pool.query("DELETE FROM recipe_steps WHERE recipe_id=$1", [recipeId]);
    await pool.query(`INSERT INTO recipe_steps(id,recipe_id,step_no,title,operation,sort_order) VALUES
      ($1,$2,1,'新步骤','全新操作',0)`, [randomUUID(), recipeId]);

    const startRes = await request('POST', `/families/${family.id}/meals/${mealId}/cooking-sessions`, {});
    assert.equal(startRes.status, 201, `startCooking failed: ${JSON.stringify(startRes.body)}`);
    const steps = startRes.body.data.steps;
    assert.equal(steps.length, 2, 'must use OLD snapshot steps (2), not new live steps (1)');
    assert.equal(steps[0].title, '焯水', 'old step title preserved');
    assert.equal(steps[0].recipe_name, '红烧肉', 'old recipe name preserved in snapshot');

    // Restore recipe for subsequent tests
    await pool.query("UPDATE recipes SET name='红烧肉' WHERE id=$1", [recipeId]);
    await pool.query("DELETE FROM recipe_steps WHERE recipe_id=$1", [recipeId]);
    await pool.query(`INSERT INTO recipe_steps(id,recipe_id,step_no,title,operation,sort_order) VALUES
      ($1,$2,1,'焯水','冷水下锅焯水',0),($3,$2,2,'炖煮','加糖色炖煮',1)`, [randomUUID(), recipeId, randomUUID()]);
  });

  // ===== S4: confirm then modify recipe ingredients, shopping still old requirements =====
  await t.test('S4: confirm then modify ingredients — shopping still old requirements', async () => {
    const mealId = await createMealWithRecipe('2026-09-13', 'DINNER');
    await request('POST', `/families/${family.id}/meals/${mealId}/confirm`, {});
    await pool.query("UPDATE recipe_ingredients SET quantity=300 WHERE recipe_id=$1 AND ingredient_id=$2", [recipeId, ingPork]);

    const genRes = await request('POST', `/families/${family.id}/shopping-lists/generate`, { meal_id: mealId, mode: 'REPLACE_GENERATED' });
    assert.equal(genRes.status, 201, `generate failed: ${JSON.stringify(genRes.body)}`);
    const items = genRes.body.data.items || [];
    const porkItem = items.find(i => i.ingredient_id === ingPork);
    assert.ok(porkItem, 'pork item must exist');
    assert.equal(Number(porkItem.required_quantity), 500, 'must use OLD snapshot quantity 500g, not new 300g');
  });

  // ===== S5: confirm then rename recipe, history still old name =====
  await t.test('S5: confirm then rename recipe — history still old name', async () => {
    const mealId = await createMealWithRecipe('2026-09-14', 'DINNER');
    const confirmRes = await request('POST', `/families/${family.id}/meals/${mealId}/confirm`, {});
    assert.equal(confirmRes.status, 200, `S5 confirm failed: ${JSON.stringify(confirmRes.body)}`);
    await pool.query("UPDATE recipes SET name='历史改名红烧肉' WHERE id=$1", [recipeId]);

    const histRes = await request('GET', `/families/${family.id}/meals/history?limit=10`);
    assert.equal(histRes.status, 200);
    const meals = histRes.body.data;
    const found = meals.find(m => m.id === mealId);
    assert.ok(found, 'meal must be in history');
    assert.equal(found.items[0].recipe_name, '红烧肉', 'history must show OLD snapshot name');

    // Restore recipe name for subsequent tests
    await pool.query("UPDATE recipes SET name='红烧肉' WHERE id=$1", [recipeId]);
  });

  // ===== S6: confirm then soft delete recipe, history still works =====
  await t.test('S6: confirm then soft delete recipe — history still works', async () => {
    const mealId = await createMealWithRecipe('2026-09-15', 'DINNER');
    await request('POST', `/families/${family.id}/meals/${mealId}/confirm`, {});
    await pool.query("UPDATE recipes SET deleted_at=now() WHERE id=$1", [recipeId]);

    const histRes = await request('GET', `/families/${family.id}/meals/history?limit=10`);
    assert.equal(histRes.status, 200);
    const found = histRes.body.data.find(m => m.id === mealId);
    assert.ok(found, 'meal must still be in history after recipe soft delete');
    assert.equal(found.items[0].recipe_name, '红烧肉', 'snapshot name survives recipe deletion');
    await pool.query("UPDATE recipes SET deleted_at=NULL WHERE id=$1", [recipeId]);
  });

  // ===== S7: CONFIRMED snapshot missing — no live fallback =====
  await t.test('S7: CONFIRMED with missing snapshot fails closed (no live fallback)', async () => {
    const mealId = await createMealWithRecipe('2026-09-16', 'DINNER');
    await pool.query("UPDATE meals SET status='CONFIRMED', recipe_snapshot=NULL WHERE id=$1", [mealId]);

    const startRes = await request('POST', `/families/${family.id}/meals/${mealId}/cooking-sessions`, {});
    assert.notEqual(startRes.status, 201, 'must fail when snapshot missing');
    const errCode = startRes.body.error?.code || startRes.body.code;
    assert.equal(errCode, 'MEAL_SNAPSHOT_MISSING', `expected MEAL_SNAPSHOT_MISSING, got ${errCode}`);
  });

  // ===== S8: unsupported snapshot schema fails closed =====
  await t.test('S8: unsupported snapshot schema_version fails closed', async () => {
    const mealId = await createMealWithRecipe('2026-09-17', 'DINNER');
    await pool.query("UPDATE meals SET status='CONFIRMED', recipe_snapshot=$2 WHERE id=$1",
      [mealId, JSON.stringify({ schema_version: 999, items: [] })]);

    const startRes = await request('POST', `/families/${family.id}/meals/${mealId}/cooking-sessions`, {});
    assert.notEqual(startRes.status, 201);
    const errCode = startRes.body.error?.code || startRes.body.code;
    assert.equal(errCode, 'MEAL_SNAPSHOT_UNSUPPORTED');
  });

  // ===== S9: PLANNING meal shopping may still use live recipe =====
  await t.test('S9: PLANNING meal shopping uses live recipe', async () => {
    const mealId = await createMealWithRecipe('2026-09-18', 'DINNER');
    const genRes = await request('POST', `/families/${family.id}/shopping-lists/generate`, { meal_id: mealId, mode: 'REPLACE_GENERATED' });
    assert.equal(genRes.status, 201);
    const porkItem = (genRes.body.data.items || []).find(i => i.ingredient_id === ingPork);
    assert.ok(porkItem, 'pork item exists for PLANNING meal');
    assert.equal(Number(porkItem.required_quantity), 300, 'PLANNING uses live recipe (300g after S4 edit)');
  });

  // ===== S10: custom pantry "花椒" can persist =====
  await t.test('S10: custom pantry 花椒 can persist', async () => {
    const addRes = await request('POST', `/families/${family.id}/pantry-staples/custom`, {
      display_name: '花椒', assume_available: true, quantity: null
    });
    assert.equal(addRes.status, 201, `custom pantry add failed: ${JSON.stringify(addRes.body)}`);
    assert.equal(addRes.body.data.display_name_override, '花椒');
    assert.equal(addRes.body.data.ingredient_id, null);

    const listRes = await request('GET', `/families/${family.id}/pantry-staples`);
    assert.equal(listRes.status, 200);
    const huajiao = listRes.body.data.find(p => p.display_name_override === '花椒');
    assert.ok(huajiao, '花椒 must appear in pantry list');
  });

  // ===== S11: custom duplicate "花椒" and " 花椒 " cannot duplicate =====
  await t.test('S11: custom duplicate normalized name rejected', async () => {
    const dupRes = await request('POST', `/families/${family.id}/pantry-staples/custom`, {
      display_name: ' 花椒 ', assume_available: true, quantity: null
    });
    assert.notEqual(dupRes.status, 201, 'duplicate normalized name must be rejected');
  });

  // ===== S12: custom pantry does not participate in canonical auto deduction =====
  await t.test('S12: custom pantry does not auto-deduct canonical shopping', async () => {
    await request('POST', `/families/${family.id}/pantry-staples/custom`, {
      display_name: '猪里脊碎', assume_available: true, quantity: null
    });
    const mealId = await createMealWithRecipe('2026-09-19', 'DINNER');
    const genRes = await request('POST', `/families/${family.id}/shopping-lists/generate`, { meal_id: mealId, mode: 'REPLACE_GENERATED' });
    const porkItem = (genRes.body.data.items || []).find(i => i.ingredient_id === ingPork);
    assert.ok(porkItem);
    assert.equal(Number(porkItem.pantry_deducted), 0, 'custom pantry must not deduct canonical ingredient');
  });

  // ===== S13: existing canonical pantry behavior unchanged =====
  await t.test('S13: canonical pantry still auto-deducts', async () => {
    await request('PUT', `/families/${family.id}/pantry-staples/${ingPork}`, {
      assume_available: true, quantity: null
    });
    const mealId = await createMealWithRecipe('2026-09-20', 'DINNER');
    const genRes = await request('POST', `/families/${family.id}/shopping-lists/generate`, { meal_id: mealId, mode: 'REPLACE_GENERATED' });
    const porkItem = (genRes.body.data.items || []).find(i => i.ingredient_id === ingPork);
    // canonical unlimited pantry should fully deduct -> item may not appear in list (missing=0)
    if (porkItem) {
      assert.ok((porkItem.pantry_deducted || 0) > 0, 'canonical pantry must deduct');
    } else {
      // fully deducted = not in shopping list (missing=0, not needs confirmation)
      assert.ok(true, 'canonical pantry fully deducted, item not in list');
    }
  });

  // ===== S14: 001 -> 008 fresh migration replay =====
  await t.test('S14: 001-008 fresh migration replay PASS', async () => {
    const cols = (await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name='pantry_staples' AND column_name='display_name_override'
    `)).rows;
    assert.equal(cols.length, 1, 'pantry_staples.display_name_override exists');
    const snapCols = (await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name='meals' AND column_name='recipe_snapshot'
    `)).rows;
    assert.equal(snapCols.length, 1, 'meals.recipe_snapshot exists');
    const cooking = (await pool.query(`SELECT to_regclass('cooking_sessions') as t`)).rows[0].t;
    assert.ok(cooking, 'cooking_sessions table exists');
    const kiss = (await pool.query(`SELECT to_regclass('kiss_ledger') as t`)).rows[0].t;
    assert.ok(kiss, 'kiss_ledger table exists');
    // preflight/ directory must NOT be executed by migration loader
    const { loadMigrations } = require('../../backend/v1/migrations');
    const migs = await loadMigrations(path.join(__dirname, '../../backend/v1/sql'));
    const migNames = migs.map(m => m.name);
    assert.ok(!migNames.some(n => n.includes('preflight')), 'preflight SQL files must not be loaded as migrations');
    assert.equal(migNames.length, 8, 'exactly 8 migrations (001-008)');
  });

  // ===== S15: History CONFIRMED snapshot missing → MEAL_SNAPSHOT_MISSING =====
  await t.test('S15: history missing snapshot fails closed', async () => {
    const mealId = await createMealWithRecipe('2026-09-21', 'DINNER');
    await request('POST', `/families/${family.id}/meals/${mealId}/confirm`, {});
    // Corrupt: set snapshot to null
    await pool.query('UPDATE meals SET recipe_snapshot=NULL WHERE id=$1', [mealId]);
    const res = await request('GET', `/families/${family.id}/meals/history?limit=10`);
    assert.notEqual(res.statusCode, 200, 'history must fail when snapshot missing');
    assert.equal(res.body?.error?.code, 'MEAL_SNAPSHOT_MISSING');
  });

  // ===== S16: History schema_version unsupported → MEAL_SNAPSHOT_UNSUPPORTED =====
  await t.test('S16: history unsupported schema version fails closed', async () => {
    const mealId = await createMealWithRecipe('2026-09-22', 'DINNER');
    await request('POST', `/families/${family.id}/meals/${mealId}/confirm`, {});
    // Corrupt: set schema_version to 999
    await pool.query(`UPDATE meals SET recipe_snapshot=jsonb_set(recipe_snapshot, '{schema_version}', '999') WHERE id=$1`, [mealId]);
    const res = await request('GET', `/families/${family.id}/meals/history?limit=10`);
    assert.notEqual(res.statusCode, 200, 'history must fail when schema_version unsupported');
    assert.equal(res.body?.error?.code, 'MEAL_SNAPSHOT_UNSUPPORTED');
  });

  // ===== S17: confirm 后修改 recipe 内容，snapshot JSON 本身保持不变 =====
  await t.test('S17: snapshot immutable after recipe modification', async () => {
    const mealId = await createMealWithRecipe('2026-09-23', 'DINNER');
    const confirmed = (await request('POST', `/families/${family.id}/meals/${mealId}/confirm`, {})).body.data;
    const snapshotBefore = JSON.stringify(confirmed.recipe_snapshot);

    // Modify recipe name, ingredients, steps
    await pool.query(`UPDATE recipes SET name='新红烧肉_immutable_test' WHERE id=$1`, [recipeId]);
    await pool.query(`DELETE FROM recipe_ingredients WHERE recipe_id=$1`, [recipeId]);
    await pool.query(`DELETE FROM recipe_steps WHERE recipe_id=$1`, [recipeId]);

    // Re-fetch meal — snapshot must be unchanged
    const mealAfter = (await pool.query('SELECT recipe_snapshot FROM meals WHERE id=$1', [mealId])).rows[0];
    const snapshotAfter = JSON.stringify(mealAfter.recipe_snapshot);
    assert.equal(snapshotAfter, snapshotBefore, 'snapshot must be immutable after recipe modification');

    // Restore recipe for subsequent tests
    await pool.query(`UPDATE recipes SET name='红烧肉' WHERE id=$1`, [recipeId]);
  });

  // ===== S18: 008 fields/nullability/index/check 逐项匹配 DATA_MODEL 25-28 =====
  await t.test('S18: 008 schema alignment with DATA_MODEL sections 25-28', async () => {
    const expected = {
      cooking_sessions: { id:'NO', family_id:'NO', meal_id:'NO', status:'NO', started_by_user_id:'NO', completed_by_user_id:'YES', started_at:'NO', completed_at:'YES' },
      wishes: { id:'NO', family_id:'NO', user_id:'NO', recipe_id:'NO', status:'NO', created_at:'NO', resolved_at:'YES' },
      kiss_ledger: { id:'NO', family_id:'NO', from_user_id:'NO', to_user_id:'NO', meal_id:'NO', recipe_id:'YES', suggested_amount:'YES', actual_amount:'NO', rating_id:'YES', reason:'YES', created_at:'NO' },
      recipe_imports: { id:'NO', family_id:'NO', created_by_user_id:'NO', schema_version:'NO', raw_payload:'NO', normalized_payload:'YES', status:'NO', inferred_fields:'NO', uncertain_fields:'NO', imported_recipe_id:'YES', created_at:'NO', updated_at:'NO' },
    };
    let drift = 0;
    const misaligned = [];
    for (const [table, columns] of Object.entries(expected)) {
      const actualRows = (await pool.query(`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 ORDER BY ordinal_position`, [table])).rows;
      const actual = Object.fromEntries(actualRows.map(r => [r.column_name, r.is_nullable]));
      for (const [col, exp] of Object.entries(columns)) {
        const act = actual[col];
        if (act !== exp) { drift++; misaligned.push({table, column:col, expected:exp, actual:act}); }
      }
    }
    const checks = (await pool.query(`SELECT conname FROM pg_constraint WHERE conname IN ('cooking_sessions_status_check','wishes_status_check','kiss_ledger_actual_amount_check','recipe_imports_status_check')`)).rows.map(c=>c.conname);
    assert.ok(checks.includes('cooking_sessions_status_check'), 'cooking status CHECK');
    assert.ok(checks.includes('wishes_status_check'), 'wishes status CHECK');
    assert.ok(checks.includes('kiss_ledger_actual_amount_check'), 'kiss actual_amount CHECK');
    assert.ok(checks.includes('recipe_imports_status_check'), 'imports status CHECK');
    const jsonbCols = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='recipe_imports' AND data_type='jsonb'`)).rows.map(c=>c.column_name);
    for (const c of ['raw_payload','normalized_payload','inferred_fields','uncertain_fields']) assert.ok(jsonbCols.includes(c), c+' JSONB');
    const pantryCheck = (await pool.query(`SELECT conname FROM pg_constraint WHERE conname='pantry_custom_name_required'`)).rows;
    assert.ok(pantryCheck.length > 0, 'pantry_custom_name_required CHECK');
    const pantryIdx = (await pool.query(`SELECT indexname FROM pg_indexes WHERE tablename='pantry_staples'`)).rows.map(i=>i.indexname);
    assert.ok(pantryIdx.some(n=>n.includes('canonical')), 'pantry canonical partial unique');
    assert.ok(pantryIdx.some(n=>n.includes('custom')), 'pantry custom partial unique');
    assert.equal(drift, 0, 'SCHEMA_ALIGNMENT_DRIFT='+drift+': '+JSON.stringify(misaligned));
  });

  // ===== S19: DATA_MODEL / SPEC approval consistency =====
  await t.test('S19: amendment approval consistency (section-aware)', async () => {
    const fs = require('fs');
    const path = require('path');
    const amendmentPath = path.join(__dirname, '..', '..', 'docs', 'SPEC_AMENDMENT_12A.md');
    const content = fs.readFileSync(amendmentPath, 'utf8');
    const statusMatch = content.match(/^Status:\s*(\w+)/m);
    const blockedMatch = content.match(/^Blocked:\s*(.+)/m);
    const status = statusMatch ? statusMatch[1] : null;

    function extractSection(md, heading) {
      const re = new RegExp('## \\d+\\. ' + heading + '[\\s\\S]*?(?=## \\d+\\.|$)');
      const m = md.match(re);
      return m ? m[0] : '';
    }

    if (status === 'APPROVED') {
      assert.ok(blockedMatch && blockedMatch[1].trim().startsWith('NO'),
        'APPROVED amendment must have Blocked: NO');
      assert.ok(content.includes('Option A') && content.includes('APPROVED'),
        'APPROVED amendment must document Reviewer Decision Option A');
      const unchecked = content.match(/^\s*-\s*\[\s\]/m);
      assert.ok(!unchecked, 'APPROVED amendment must have all checklist items [x]');

      const preflightDir = path.join(__dirname, '..', '..', 'backend', 'v1', 'sql', 'preflight');
      assert.ok(fs.existsSync(path.join(preflightDir, '008_preflight.sql')), '008_preflight.sql must exist');
      assert.ok(fs.existsSync(path.join(preflightDir, '008_postcheck.sql')), '008_postcheck.sql must exist');

      // PRE-008 section must NOT reference 008-only columns
      const preMatch = content.match(/PRE-008[\s\S]*?(?=POST-008|$)/);
      if (preMatch) {
        assert.ok(!preMatch[0].includes('recipe_snapshot IS NULL'),
          'PRE-008 must not reference recipe_snapshot IS NULL (008-only column)');
        assert.ok(!preMatch[0].includes('display_name_override'),
          'PRE-008 must not reference display_name_override (008-only column)');
      }

      // DATA_MODEL Section-aware checks — NOT full-file substring
      const dataModelPath = path.join(__dirname, '..', '..', 'docs', 'DATA_MODEL_V4.md');
      const dm = fs.readFileSync(dataModelPath, 'utf8');
      const section18 = extractSection(dm, 'meals');
      const section21 = extractSection(dm, 'pantry_staples');
      assert.ok(section18.includes('`recipe_snapshot`'),
        'DATA_MODEL Section 18 (meals) field list must contain recipe_snapshot');
      assert.ok(section21.includes('`display_name_override`'),
        'DATA_MODEL Section 21 (pantry_staples) field list must contain display_name_override');
    } else if (status === 'DRAFT') {
      assert.ok(blockedMatch && blockedMatch[1].includes('YES'),
        'DRAFT amendment must be Blocked: YES');
    }
  });
});
