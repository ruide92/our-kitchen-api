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
  await pool.query(`INSERT INTO recipe_ingredients(id,recipe_id,ingredient_id,display_name_override,quantity,unit_code,type,required,sort_order) VALUES
    ($1,$2,$3,'五花肉',500,'g','MAIN',true,0)`, [randomUUID(), recipeId, ingPork]);
  await pool.query(`INSERT INTO recipe_steps(id,recipe_id,step_no,title,operation,sort_order) VALUES
    ($1,$2,1,'焯水','冷水下锅焯水',0),($3,$2,2,'炖煮','加糖色炖煮',1)`,
    [randomUUID(), recipeId, randomUUID()]);
  await pool.query("INSERT INTO recipe_meal_types(recipe_id,meal_type) VALUES ($1,'DINNER')", [recipeId]);

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

  // ===== S2: ingredients/steps/cookware/tags captured =====
  await t.test('S2: ingredients/steps/cookware/tags captured in snapshot', async () => {
    const mealId = await createMealWithRecipe('2026-09-11', 'DINNER');
    const confirmRes = await request('POST', `/families/${family.id}/meals/${mealId}/confirm`, {});
    const snap = confirmRes.body.data.recipe_snapshot.items[0];
    assert.equal(snap.ingredients[0].name, '五花肉');
    assert.equal(snap.ingredients[0].unit_code, 'g');
    assert.equal(snap.ingredients[0].required, true);
    assert.equal(snap.steps[1].operation, '加糖色炖煮');
    assert.ok(snap.meal_types.includes('DINNER'));
    assert.equal(snap.recipe.cook_time_minutes, 40);
    assert.equal(snap.recipe.difficulty, 2);
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
    // cooking_sessions.started_by_user_id NOT NULL
    const cookingStarted = (await pool.query(`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name='cooking_sessions' AND column_name='started_by_user_id'
    `)).rows[0];
    assert.equal(cookingStarted.is_nullable, 'NO', 'cooking_sessions.started_by_user_id must be NOT NULL');

    // kiss_ledger.meal_id NOT NULL
    const kissMeal = (await pool.query(`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name='kiss_ledger' AND column_name='meal_id'
    `)).rows[0];
    assert.equal(kissMeal.is_nullable, 'NO', 'kiss_ledger.meal_id must be NOT NULL');

    // recipe_imports.created_by_user_id NOT NULL
    const importCreated = (await pool.query(`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name='recipe_imports' AND column_name='created_by_user_id'
    `)).rows[0];
    assert.equal(importCreated.is_nullable, 'NO', 'recipe_imports.created_by_user_id must be NOT NULL');

    // pantry custom CHECK constraint exists
    const pantryCheck = (await pool.query(`
      SELECT conname FROM pg_constraint
      WHERE conname='pantry_custom_name_required'
    `)).rows;
    assert.ok(pantryCheck.length > 0, 'pantry_custom_name_required CHECK constraint exists');

    // pantry canonical partial unique index exists
    const canonicalIdx = (await pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename='pantry_staples' AND indexname LIKE '%canonical%'
    `)).rows;
    assert.ok(canonicalIdx.length > 0, 'pantry canonical partial unique index exists');

    // pantry custom normalized partial unique index exists
    const customIdx = (await pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename='pantry_staples' AND indexname LIKE '%custom%'
    `)).rows;
    assert.ok(customIdx.length > 0, 'pantry custom normalized partial unique index exists');
  });

  // ===== S19: DATA_MODEL / SPEC approval consistency =====
  await t.test('S19: amendment approval consistency', async () => {
    const fs = require('fs');
    const path = require('path');
    const amendmentPath = path.join(__dirname, '..', '..', 'docs', 'SPEC_AMENDMENT_12A.md');
    const content = fs.readFileSync(amendmentPath, 'utf8');
    const statusMatch = content.match(/^Status:\s*(\w+)/m);
    const blockedMatch = content.match(/^Blocked:\s*(.+)/m);
    if (statusMatch && statusMatch[1] === 'APPROVED') {
      assert.ok(blockedMatch && blockedMatch[1].trim().startsWith('NO'),
        'APPROVED amendment must have Blocked: NO');
    }
    // If DRAFT, must be BLOCKED
    if (statusMatch && statusMatch[1] === 'DRAFT') {
      assert.ok(blockedMatch && blockedMatch[1].includes('YES'),
        'DRAFT amendment must be Blocked: YES');
    }
  });
});
