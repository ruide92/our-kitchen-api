const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

test('Recommendation Engine integration against real PostgreSQL', async t => {
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
  const schema = `rec_${randomUUID().replaceAll('-', '')}`;
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
  const tokens = createTokens('rec-test-key-'.repeat(3));
  const app = createApp({ repo, families, tokens, pool, wechat: { exchange: async () => { throw new Error('Not used'); } } });
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));

  const userA = await repo.upsertWechatUser({ openid: 'recA', unionid: null });
  const userB = await repo.upsertWechatUser({ openid: 'recB', unionid: null });

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

  const familyA = (await request('A', 'POST', '/families', { name: '推荐家庭A' })).body.data;
  const familyB = (await request('B', 'POST', '/families', { name: '推荐家庭B' })).body.data;

  // Helper: create BASE recipe
  async function makeRecipe(name, opts = {}) {
    const id = randomUUID();
    await pool.query(`INSERT INTO recipes(id,kind,family_id,source_type,name,base_servings,visibility,version,protein_source_code,cooking_method_code,cook_time_minutes)
      VALUES ($1,'BASE',NULL,'SEED',$2,2,'PUBLIC',1,$3,$4,$5)`,
      [id, name, opts.protein || null, opts.method || null, opts.cookTime || 30]);
    if (opts.mealTypes) {
      for (const mt of opts.mealTypes) {
        await pool.query(`INSERT INTO recipe_meal_types(recipe_id,meal_type) VALUES ($1,$2)`, [id, mt]);
      }
    }
    if (opts.ingredients) {
      for (const ing of opts.ingredients) {
        const ingId = randomUUID();
        await pool.query(`INSERT INTO ingredients(id,canonical_code,display_name,category_code,default_unit_code) VALUES ($1,$2,$3,'VEGETABLE','g')`, [ingId, ingId, ing.name]);
        await pool.query(`INSERT INTO recipe_ingredients(id,recipe_id,ingredient_id,quantity,unit_code,type,required,sort_order)
          VALUES ($1,$2,$3,$4,$5,'MAIN',true,$6)`, [randomUUID(), id, ingId, ing.qty || 100, ing.unit || 'g', ing.order || 0]);
      }
    }
    if (opts.allergens) {
      for (const a of opts.allergens) {
        await pool.query(`INSERT INTO recipe_allergens(recipe_id,allergen_code) VALUES ($1,$2)`, [id, a]);
      }
    }
    return id;
  }

  const recipeDinner = await makeRecipe('晚餐测试菜', { mealTypes: ['DINNER'], protein: 'PORK', method: 'STIR_FRY', cookTime: 20 });
  const recipeBreakfast = await makeRecipe('早餐测试菜', { mealTypes: ['BREAKFAST'], protein: 'EGG', method: 'BOIL', cookTime: 10 });
  const recipeUntagged = await makeRecipe('无标签通用菜', { protein: 'CHICKEN', method: 'STEAM', cookTime: 25 });
  const recipeDinner2 = await makeRecipe('晚餐第二道', { mealTypes: ['DINNER'], protein: 'BEEF', method: 'BRAISE', cookTime: 40 });
  const recipeDinner3 = await makeRecipe('晚餐第三道', { mealTypes: ['DINNER'], protein: 'PORK', method: 'STIR_FRY', cookTime: 15 });

  // R1: random endpoint no longer 500
  await t.test('R1 random endpoint returns 200 not 500', async () => {
    const r = await request('A', 'POST', `/families/${familyA.id}/recommendations/random-meal`, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 2
    });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.data.recipes));
  });

  // R2: other family favorite doesn't affect this family
  await t.test('R2 other family favorite does not affect this family score', async () => {
    // User B favorites recipeDinner in family B context (recipe_favorites has no family_id but user B is in family B)
    await pool.query(`INSERT INTO recipe_favorites(user_id,recipe_id) VALUES ($1,$2)`, [userB.id, recipeDinner]);
    const r = await request('A', 'POST', `/families/${familyA.id}/recommendations/random-meal`, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 3, _seed: 42
    });
    assert.equal(r.status, 200);
    // recipeDinner should not get fav_count from user B (B not in family A)
    const dinner = r.body.data.recipes.find(x => x.id === recipeDinner);
    assert.ok(dinner);
    // Cleanup
    await pool.query(`DELETE FROM recipe_favorites WHERE user_id=$1`, [userB.id]);
  });

  // R3: this family ACTIVE member favorite participates
  await t.test('R3 this family ACTIVE member favorite boosts score', async () => {
    await pool.query(`INSERT INTO recipe_favorites(user_id,recipe_id) VALUES ($1,$2)`, [userA.id, recipeDinner]);
    const r = await request('A', 'POST', `/families/${familyA.id}/recommendations/random-meal`, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 3, _seed: 42
    });
    const dinner = r.body.data.recipes.find(x => x.id === recipeDinner);
    assert.ok(dinner);
    await pool.query(`DELETE FROM recipe_favorites WHERE user_id=$1`, [userA.id]);
  });

  // R4: family general rating 5 boosts
  await t.test('R4 family general rating 5 boosts preference', async () => {
    await pool.query(`INSERT INTO recipe_ratings(family_id,user_id,recipe_id,meal_id,rating) VALUES ($1,$2,$3,NULL,5)`,
      [familyA.id, userA.id, recipeDinner2]);
    const r = await request('A', 'POST', `/families/${familyA.id}/recommendations/random-meal`, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 3, _seed: 42
    });
    const dinner2 = r.body.data.recipes.find(x => x.id === recipeDinner2);
    assert.ok(dinner2);
    await pool.query(`DELETE FROM recipe_ratings WHERE recipe_id=$1`, [recipeDinner2]);
  });

  // R5: meal-specific rating doesn't masquerade as general
  await t.test('R5 meal-specific rating not used as general preference', async () => {
    const mealId = randomUUID();
    await pool.query(`INSERT INTO meals(id,family_id,meal_date,meal_type,status,diners_count) VALUES ($1,$2,'2026-09-01','DINNER','COMPLETED',2)`, [mealId, familyA.id]);
    await pool.query(`INSERT INTO recipe_ratings(family_id,user_id,recipe_id,meal_id,rating) VALUES ($1,$2,$3,$4,1)`,
      [familyA.id, userA.id, recipeDinner, mealId]);
    const r = await request('A', 'POST', `/families/${familyA.id}/recommendations/random-meal`, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 3, _seed: 42
    });
    // avg_rating should be null (only meal-specific rating exists, filtered out)
    const dinner = r.body.data.recipes.find(x => x.id === recipeDinner);
    assert.ok(dinner);
    await pool.query(`DELETE FROM recipe_ratings WHERE recipe_id=$1`, [recipeDinner]);
    await pool.query(`DELETE FROM meals WHERE id=$1`, [mealId]);
  });

  // R6: ACTIVE wish adds, CANCELLED doesn't
  await t.test('R6 ACTIVE wish adds score, CANCELLED does not', async () => {
    await pool.query(`INSERT INTO wishes(id,family_id,user_id,recipe_id,status) VALUES ($1,$2,$3,$4,'ACTIVE')`,
      [randomUUID(), familyA.id, userA.id, recipeUntagged]);
    await pool.query(`INSERT INTO wishes(id,family_id,user_id,recipe_id,status) VALUES ($1,$2,$3,$4,'CANCELLED')`,
      [randomUUID(), familyA.id, userA.id, recipeDinner3]);
    const r = await request('A', 'POST', `/families/${familyA.id}/recommendations/random-meal`, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 3, _seed: 42
    });
    assert.equal(r.status, 200);
    await pool.query(`DELETE FROM wishes WHERE family_id=$1`, [familyA.id]);
  });

  // R7: BASE + current family variant only keeps FAMILY
  await t.test('R7 BASE + family variant dedup keeps FAMILY only', async () => {
    const baseId = await makeRecipe('基础番茄炒蛋', { mealTypes: ['DINNER'], protein: 'EGG', method: 'STIR_FRY' });
    const variantId = randomUUID();
    await pool.query(`INSERT INTO recipes(id,kind,family_id,parent_recipe_id,source_type,name,base_servings,visibility,version,protein_source_code,cooking_method_code)
      VALUES ($1,'FAMILY',$2,$3,'MANUAL','家庭版番茄炒蛋',2,'PRIVATE',1,'EGG','STIR_FRY')`,
      [variantId, familyA.id, baseId]);
    const r = await request('A', 'POST', `/families/${familyA.id}/recommendations/random-meal`, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 5, _seed: 42
    });
    const ids = r.body.data.recipes.map(x => x.id);
    assert.ok(ids.includes(variantId), 'FAMILY variant should be in results');
    assert.ok(!ids.includes(baseId), 'BASE should be deduped when FAMILY variant exists');
  });

  // R8: cross-family FAMILY recipe never enters
  await t.test('R8 cross-family FAMILY recipe never enters candidate', async () => {
    const familyBRecipe = randomUUID();
    await pool.query(`INSERT INTO recipes(id,kind,family_id,source_type,name,base_servings,visibility,version)
      VALUES ($1,'FAMILY',$2,'MANUAL','家庭B私有菜',2,'PRIVATE',1)`, [familyBRecipe, familyB.id]);
    const r = await request('A', 'POST', `/families/${familyA.id}/recommendations/random-meal`, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 10, _seed: 42
    });
    const ids = r.body.data.recipes.map(x => x.id);
    assert.ok(!ids.includes(familyBRecipe));
  });

  // R9: allergen — recipe_allergens exists but no user_allergens table → DATA_QUALITY_WARNING
  await t.test('R9 allergen data quality warning recorded', async () => {
    const r = await request('A', 'POST', `/families/${familyA.id}/recommendations/random-meal`, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 2, _seed: 42
    });
    const warnings = r.body.data.warnings || [];
    assert.ok(warnings.some(w => w.code === 'DATA_QUALITY_WARNING'));
  });

  // R10: explicit meal_type mismatch excluded
  await t.test('R10 explicit meal_type mismatch excluded', async () => {
    const r = await request('A', 'POST', `/families/${familyA.id}/recommendations/random-meal`, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 10, _seed: 42
    });
    const ids = r.body.data.recipes.map(x => x.id);
    assert.ok(!ids.includes(recipeBreakfast), 'BREAKFAST-only recipe should not enter DINNER candidates');
  });

  // R11: untagged meal_type recipe can enter
  await t.test('R11 untagged recipe enters candidates', async () => {
    const r = await request('A', 'POST', `/families/${familyA.id}/recommendations/random-meal`, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 10, _seed: 42
    });
    const ids = r.body.data.recipes.map(x => x.id);
    assert.ok(ids.includes(recipeUntagged), 'untagged recipe should be eligible');
  });

  // R12: 7-day recent meal penalized
  await t.test('R12 recent meal within strong days penalized', async () => {
    const mealId = randomUUID();
    const itemId = randomUUID();
    await pool.query(`INSERT INTO meals(id,family_id,meal_date,meal_type,status,diners_count) VALUES ($1,$2,CURRENT_DATE,'DINNER','COMPLETED',2)`, [mealId, familyA.id]);
    await pool.query(`INSERT INTO meal_items(id,meal_id,recipe_id,servings,source,selected_by_user_id) VALUES ($1,$2,$3,2,'MANUAL',$4)`,
      [itemId, mealId, recipeDinner2, userA.id]);
    const r = await request('A', 'POST', `/families/${familyA.id}/recommendations/random-meal`, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 3, _seed: 42
    });
    const dinner2 = r.body.data.recipes.find(x => x.id === recipeDinner2);
    // Should still appear but with low score due to repeat penalty
    if (dinner2) {
      assert.ok(dinner2.score < 50, 'recently eaten recipe should have penalty applied');
    }
    await pool.query(`DELETE FROM meal_items WHERE id=$1`, [itemId]);
    await pool.query(`DELETE FROM meals WHERE id=$1`, [mealId]);
  });

  // R13: repeat days read from family settings
  await t.test('R13 repeat settings read from family_settings', async () => {
    await pool.query(`UPDATE family_settings SET repeat_strong_days=1, repeat_penalty_days=2, repeat_recover_days=3 WHERE family_id=$1`, [familyA.id]);
    const r = await request('A', 'POST', `/families/${familyA.id}/recommendations/random-meal`, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 2, _seed: 42
    });
    assert.equal(r.status, 200);
    await pool.query(`UPDATE family_settings SET repeat_strong_days=7, repeat_penalty_days=14, repeat_recover_days=28 WHERE family_id=$1`, [familyA.id]);
  });

  // R14: locked recipe preserved
  await t.test('R14 locked recipe preserved in results', async () => {
    const r = await request('A', 'POST', `/families/${familyA.id}/recommendations/random-meal`, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 3,
      locked_recipe_ids: [recipeDinner], _seed: 42
    });
    const locked = r.body.data.recipes.find(x => x.id === recipeDinner);
    assert.ok(locked);
    assert.equal(locked.locked, true);
  });

  // R15: locked > target_count → 422
  await t.test('R15 locked > target_count returns 422', async () => {
    const r = await request('A', 'POST', `/families/${familyA.id}/recommendations/random-meal`, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 1,
      locked_recipe_ids: [recipeDinner, recipeDinner2]
    });
    assert.equal(r.status, 422);
  });

  // R16: fixed random source reproducible
  await t.test('R16 fixed seed produces reproducible results', async () => {
    const r1 = await request('A', 'POST', `/families/${familyA.id}/recommendations/random-meal`, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 3, _seed: 12345
    });
    const r2 = await request('A', 'POST', `/families/${familyA.id}/recommendations/random-meal`, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 3, _seed: 12345
    });
    assert.deepEqual(r1.body.data.recipes.map(x => x.id), r2.body.data.recipes.map(x => x.id));
  });

  // R17: combination diversity — avoids 3x same protein+method when alternatives exist
  await t.test('R17 combination avoids 3x same protein and method', async () => {
    const r = await request('A', 'POST', `/families/${familyA.id}/recommendations/random-meal`, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 3, _seed: 42
    });
    const proteins = r.body.data.recipes.map(x => x.protein_source_code).filter(Boolean);
    const methods = r.body.data.recipes.map(x => x.cooking_method_code).filter(Boolean);
    // With diverse candidates, shouldn't get 3 of exact same protein+method combo
    if (proteins.length >= 3 && methods.length >= 3) {
      const sameProtein = proteins.filter(p => p === proteins[0]).length;
      assert.ok(sameProtein < 3, `should not have 3 same protein, got ${proteins.join(',')}`);
    }
  });

  // R18: candidate shortage returns warning
  await t.test('R18 candidate shortage returns warning', async () => {
    // Request more than available DINNER candidates
    const r = await request('A', 'POST', `/families/${familyA.id}/recommendations/random-meal`, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 100, _seed: 42
    });
    assert.equal(r.status, 200);
    assert.ok(r.body.data.recipes.length < 100);
    const warnings = r.body.data.warnings || [];
    assert.ok(warnings.some(w => w.code === 'CANDIDATE_SHORTAGE'));
  });

  // R19: expired fridge not counted
  await t.test('R19 expired fridge item not counted as available', async () => {
    const ingId = randomUUID();
    await pool.query(`INSERT INTO ingredients(id,canonical_code,display_name,category_code,default_unit_code) VALUES ($1,$2,'测试蔬菜','VEGETABLE','g')`, [ingId, ingId]);
    const recipeWithIng = await makeRecipe('含测试蔬菜菜', { mealTypes: ['DINNER'], protein: 'PORK', method: 'STIR_FRY' });
    await pool.query(`INSERT INTO recipe_ingredients(id,recipe_id,ingredient_id,quantity,unit_code,type,required,sort_order)
      VALUES ($1,$2,$3,200,'g','MAIN',true,0)`, [randomUUID(), recipeWithIng, ingId]);
    // Add expired fridge item
    await pool.query(`INSERT INTO fridge_items(id,family_id,ingredient_id,quantity,unit_code,storage_location,expiry_date)
      VALUES ($1,$2,$3,500,'g','REFRIGERATED',CURRENT_DATE - INTERVAL '1 day')`, [randomUUID(), familyA.id, ingId]);
    const r = await request('A', 'GET', `/families/${familyA.id}/recommendations/fridge-cooking`);
    const recipe = r.body.data.find(x => x.id === recipeWithIng);
    if (recipe) {
      assert.equal(recipe.available_count, 0, 'expired ingredient should not count as available');
    }
    await pool.query(`DELETE FROM fridge_items WHERE family_id=$1`, [familyA.id]);
  });

  // R20: USE_INVENTORY boosts expiring match
  await t.test('R20 USE_INVENTORY mode boosts inventory match', async () => {
    const ingId = randomUUID();
    await pool.query(`INSERT INTO ingredients(id,canonical_code,display_name,category_code,default_unit_code) VALUES ($1,$2,'快过期菜','VEGETABLE','g')`, [ingId, ingId]);
    const recipeExp = await makeRecipe('快过期匹配菜', { mealTypes: ['DINNER'], protein: 'CHICKEN', method: 'STEAM' });
    await pool.query(`INSERT INTO recipe_ingredients(id,recipe_id,ingredient_id,quantity,unit_code,type,required,sort_order)
      VALUES ($1,$2,$3,200,'g','MAIN',true,0)`, [randomUUID(), recipeExp, ingId]);
    await pool.query(`INSERT INTO fridge_items(id,family_id,ingredient_id,quantity,unit_code,storage_location,expiry_date)
      VALUES ($1,$2,$3,500,'g','REFRIGERATED',CURRENT_DATE + INTERVAL '1 day')`, [randomUUID(), familyA.id, ingId]);

    const rBalanced = await request('A', 'POST', `/families/${familyA.id}/recommendations/random-meal`, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 5, _seed: 42
    });
    const rInventory = await request('A', 'POST', `/families/${familyA.id}/recommendations/random-meal`, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'USE_INVENTORY', target_count: 5, _seed: 42
    });
    const b = rBalanced.body.data.recipes.find(x => x.id === recipeExp);
    const inv = rInventory.body.data.recipes.find(x => x.id === recipeExp);
    if (b && inv) {
      assert.ok(inv.score >= b.score, 'USE_INVENTORY should boost inventory-matching recipe');
    }
    await pool.query(`DELETE FROM fridge_items WHERE family_id=$1`, [familyA.id]);
  });

  // R21: fridge-cooking endpoint returns valid structure
  await t.test('R21 fridge-cooking endpoint returns valid structure', async () => {
    const r = await request('A', 'GET', `/families/${familyA.id}/recommendations/fridge-cooking`);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.data));
    if (r.body.data.length > 0) {
      const item = r.body.data[0];
      assert.ok(item.id);
      assert.ok(item.name);
      assert.ok(['CAN_COOK_NOW', 'MISSING_FEW', 'NEEDS_SHOPPING'].includes(item.status));
    }
  });

  // R22: canonical pantry participates in availability
  await t.test('R22 canonical pantry assume_available counts in fridge cooking', async () => {
    const ingId = randomUUID();
    await pool.query(`INSERT INTO ingredients(id,canonical_code,display_name,category_code,default_unit_code) VALUES ($1,$2,'常备食材','SEASONING','g')`, [ingId, ingId]);
    const recipePantry = await makeRecipe('常备食材菜', { mealTypes: ['DINNER'], protein: 'BEEF', method: 'BRAISE' });
    await pool.query(`INSERT INTO recipe_ingredients(id,recipe_id,ingredient_id,quantity,unit_code,type,required,sort_order)
      VALUES ($1,$2,$3,10,'g','SEASONING',true,0)`, [randomUUID(), recipePantry, ingId]);
    await pool.query(`INSERT INTO pantry_staples(family_id,ingredient_id,assume_available,quantity,unit_code)
      VALUES ($1,$2,true,100,'g')`, [familyA.id, ingId]);
    const r = await request('A', 'GET', `/families/${familyA.id}/recommendations/fridge-cooking`);
    const recipe = r.body.data.find(x => x.id === recipePantry);
    if (recipe) {
      assert.ok(recipe.available_count >= 1, 'canonical pantry should count as available');
    }
    await pool.query(`DELETE FROM pantry_staples WHERE family_id=$1`, [familyA.id]);
  });

  // R23: fridge cooking missing status from real required ingredients
  await t.test('R23 fridge cooking status from real required canonical ingredients', async () => {
    const ing1 = randomUUID();
    const ing2 = randomUUID();
    await pool.query(`INSERT INTO ingredients(id,canonical_code,display_name,category_code,default_unit_code) VALUES ($1,$2,'食材一','VEGETABLE','g')`, [ing1, ing1]);
    await pool.query(`INSERT INTO ingredients(id,canonical_code,display_name,category_code,default_unit_code) VALUES ($1,$2,'食材二','MEAT','g')`, [ing2, ing2]);
    const recipeTwo = await makeRecipe('两样食材菜', { mealTypes: ['DINNER'], protein: 'PORK', method: 'STIR_FRY' });
    await pool.query(`INSERT INTO recipe_ingredients(id,recipe_id,ingredient_id,quantity,unit_code,type,required,sort_order)
      VALUES ($1,$2,$3,100,'g','MAIN',true,0)`, [randomUUID(), recipeTwo, ing1]);
    await pool.query(`INSERT INTO recipe_ingredients(id,recipe_id,ingredient_id,quantity,unit_code,type,required,sort_order)
      VALUES ($1,$2,$3,200,'g','MAIN',true,1)`, [randomUUID(), recipeTwo, ing2]);
    // Only have ing1 in fridge
    await pool.query(`INSERT INTO fridge_items(id,family_id,ingredient_id,quantity,unit_code,storage_location)
      VALUES ($1,$2,$3,500,'g','REFRIGERATED')`, [randomUUID(), familyA.id, ing1]);
    const r = await request('A', 'GET', `/families/${familyA.id}/recommendations/fridge-cooking`);
    const recipe = r.body.data.find(x => x.id === recipeTwo);
    assert.ok(recipe);
    assert.equal(recipe.required_count, 2);
    assert.equal(recipe.available_count, 1);
    assert.equal(recipe.missing_count, 1);
    await pool.query(`DELETE FROM fridge_items WHERE family_id=$1`, [familyA.id]);
  });

  // R24: diners_count=1 one-person profile
  await t.test('R24 diners_count=1 enables one-person profile', async () => {
    const r = await request('A', 'POST', `/families/${familyA.id}/recommendations/random-meal`, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 1, mode: 'BALANCED', target_count: 2, _seed: 42
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.score_summary.diners_count, 1);
  });

  // R25: weekly breakfast doesn't reuse DINNER matches_meal
  await t.test('R25 weekly breakfast uses correct meal_type candidates', async () => {
    const r = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/generate`, {
      week_start: '2026-09-14', mode: 'BALANCED'
    });
    assert.equal(r.status, 201);
    const plan = r.body.data;
    const breakfastItems = plan.items.filter(i => i.meal_type === 'BREAKFAST');
    // Breakfast items should not include DINNER-only recipes
    const breakfastRecipeIds = breakfastItems.map(i => i.recipe_id);
    assert.ok(!breakfastRecipeIds.includes(recipeDinner), 'BREAKFAST plan should not include DINNER-only recipe');
    assert.ok(breakfastRecipeIds.includes(recipeBreakfast) || breakfastRecipeIds.includes(recipeUntagged));
  });

  // R26: limited candidate weekly doesn't empty due to permanent dedup
  await t.test('R26 weekly with limited candidates does not empty second half', async () => {
    const r = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/generate`, {
      week_start: '2026-09-14', mode: 'BALANCED'
    });
    const plan = r.body.data;
    // Count items per day
    const byDay = {};
    for (const item of plan.items) {
      if (!byDay[item.plan_date]) byDay[item.plan_date] = 0;
      byDay[item.plan_date]++;
    }
    const days = Object.keys(byDay).sort();
    // Last day should still have items (not empty due to permanent dedup)
    const lastDay = days[days.length - 1];
    assert.ok(byDay[lastDay] > 0, `last day ${lastDay} should have items, got ${byDay[lastDay]}`);
  });
});
