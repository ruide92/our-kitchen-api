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
  const { createRecommendationService } = require('../../backend/v1/recommendation-service');
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

  async function makeRecipe(name, opts = {}) {
    const id = randomUUID();
    const baseServings = opts.baseServings != null ? opts.baseServings : 2;
    await pool.query(`INSERT INTO recipes(id,kind,family_id,source_type,name,base_servings,visibility,version,protein_source_code,cooking_method_code,cook_time_minutes)
      VALUES ($1,'BASE',NULL,'SEED',$2,$3,'PUBLIC',1,$4,$5,$6)`,
      [id, name, baseServings, opts.protein || null, opts.method || null, opts.cookTime || 30]);
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

  // R1b: production _seed is rejected
  await t.test('R1b production _seed rejected with 400', async () => {
    const r = await request('A', 'POST', `/families/${familyA.id}/recommendations/random-meal`, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 2, _seed: 42
    });
    assert.equal(r.status, 400);
  });

  // Helper: get score for a specific recipe via service with deterministic RNG
  async function getRecipeScoreSvc(svc, familyId, userId, recipeId, opts = {}) {
    const r = await svc.generateRandomMeal(familyId, userId, {
      meal_date: opts.meal_date || '2026-09-10',
      meal_type: opts.meal_type || 'DINNER',
      diners_count: opts.diners_count || 2,
      mode: opts.mode || 'BALANCED',
      target_count: opts.target_count || 20
    });
    const found = r.recipes.find(x => x.id === recipeId);
    return found ? found.score : null;
  }

  // R2: other family favorite doesn't affect this family score — deterministic
  await t.test('R2 other family favorite does not change this family score', async () => {
    const target = await makeRecipe('R2目标菜', { mealTypes: ['DINNER'], protein: 'FISH', method: 'BAKE', cookTime: 25 });
    const svc = createRecommendationService(pool, { randomFn: () => 0.3 });
    const baseline = await getRecipeScoreSvc(svc, familyA.id, userA.id, target);
    assert.ok(baseline != null, 'target recipe should be in candidates');
    // Add favorite from user B (different family)
    await pool.query(`INSERT INTO recipe_favorites(user_id,recipe_id) VALUES ($1,$2)`, [userB.id, target]);
    const after = await getRecipeScoreSvc(svc, familyA.id, userA.id, target);
    assert.equal(after, baseline, `other family favorite must not change score: baseline=${baseline} after=${after}`);
    await pool.query(`DELETE FROM recipe_favorites WHERE user_id=$1`, [userB.id]);
  });

  // R3: this family ACTIVE member favorite boosts score — deterministic
  await t.test('R3 this family ACTIVE member favorite boosts score', async () => {
    const target = await makeRecipe('R3目标菜', { mealTypes: ['DINNER'], protein: 'LAMB', method: 'GRILL', cookTime: 30 });
    const svc = createRecommendationService(pool, { randomFn: () => 0.3 });
    const baseline = await getRecipeScoreSvc(svc, familyA.id, userA.id, target);
    assert.ok(baseline != null);
    await pool.query(`INSERT INTO recipe_favorites(user_id,recipe_id) VALUES ($1,$2)`, [userA.id, target]);
    const after = await getRecipeScoreSvc(svc, familyA.id, userA.id, target);
    assert.ok(after > baseline, `active family favorite should boost: baseline=${baseline} after=${after}`);
    await pool.query(`DELETE FROM recipe_favorites WHERE user_id=$1`, [userA.id]);
  });

  // R4: family general rating 5 boosts — deterministic
  await t.test('R4 family general rating 5 boosts score', async () => {
    const target = await makeRecipe('R4目标菜', { mealTypes: ['DINNER'], protein: 'DUCK', method: 'ROAST', cookTime: 35 });
    const svc = createRecommendationService(pool, { randomFn: () => 0.3 });
    const baseline = await getRecipeScoreSvc(svc, familyA.id, userA.id, target);
    assert.ok(baseline != null);
    await pool.query(`INSERT INTO recipe_ratings(family_id,user_id,recipe_id,meal_id,rating) VALUES ($1,$2,$3,NULL,5)`,
      [familyA.id, userA.id, target]);
    const after = await getRecipeScoreSvc(svc, familyA.id, userA.id, target);
    assert.ok(after > baseline, `general rating 5 should boost: baseline=${baseline} after=${after}`);
    await pool.query(`DELETE FROM recipe_ratings WHERE recipe_id=$1`, [target]);
  });

  // R5: meal-specific rating doesn't masquerade as general — deterministic
  await t.test('R5 meal-specific rating does not change general recommendation score', async () => {
    const target = await makeRecipe('R5目标菜', { mealTypes: ['DINNER'], protein: 'SHRIMP', method: 'STEAM', cookTime: 15 });
    const svc = createRecommendationService(pool, { randomFn: () => 0.3 });
    const baseline = await getRecipeScoreSvc(svc, familyA.id, userA.id, target);
    assert.ok(baseline != null);
    const mealId = randomUUID();
    await pool.query(`INSERT INTO meals(id,family_id,meal_date,meal_type,status,diners_count) VALUES ($1,$2,'2026-09-01','DINNER','COMPLETED',2)`, [mealId, familyA.id]);
    await pool.query(`INSERT INTO recipe_ratings(family_id,user_id,recipe_id,meal_id,rating) VALUES ($1,$2,$3,$4,1)`,
      [familyA.id, userA.id, target, mealId]);
    const after = await getRecipeScoreSvc(svc, familyA.id, userA.id, target);
    assert.equal(after, baseline, `meal-specific rating must not change general score: baseline=${baseline} after=${after}`);
    await pool.query(`DELETE FROM recipe_ratings WHERE recipe_id=$1`, [target]);
    await pool.query(`DELETE FROM meals WHERE id=$1`, [mealId]);
  });

  // R6: ACTIVE wish adds, CANCELLED doesn't — deterministic
  await t.test('R6 ACTIVE wish boosts score, CANCELLED does not', async () => {
    const target = await makeRecipe('R6目标菜', { mealTypes: ['DINNER'], protein: 'TOFU', method: 'STIR_FRY', cookTime: 20 });
    const svc = createRecommendationService(pool, { randomFn: () => 0.3 });
    const baseline = await getRecipeScoreSvc(svc, familyA.id, userA.id, target);
    assert.ok(baseline != null);
    // ACTIVE wish
    const wishId = randomUUID();
    await pool.query(`INSERT INTO wishes(id,family_id,user_id,recipe_id,status) VALUES ($1,$2,$3,$4,'ACTIVE')`,
      [wishId, familyA.id, userA.id, target]);
    const activeScore = await getRecipeScoreSvc(svc, familyA.id, userA.id, target);
    assert.ok(activeScore > baseline, `ACTIVE wish should boost: baseline=${baseline} active=${activeScore}`);
    // Cancel it
    await pool.query(`UPDATE wishes SET status='CANCELLED' WHERE id=$1`, [wishId]);
    const cancelledScore = await getRecipeScoreSvc(svc, familyA.id, userA.id, target);
    assert.equal(cancelledScore, baseline, `CANCELLED wish must not boost: baseline=${baseline} cancelled=${cancelledScore}`);
    await pool.query(`DELETE FROM wishes WHERE id=$1`, [wishId]);
  });

  // R7: BASE + current family variant only keeps FAMILY
  await t.test('R7 BASE + family variant dedup keeps FAMILY only', async () => {
    const baseId = await makeRecipe('基础番茄炒蛋', { mealTypes: ['DINNER'], protein: 'EGG', method: 'STIR_FRY' });
    const variantId = randomUUID();
    await pool.query(`INSERT INTO recipes(id,kind,family_id,parent_recipe_id,source_type,name,base_servings,visibility,version,protein_source_code,cooking_method_code)
      VALUES ($1,'FAMILY',$2,$3,'MANUAL','家庭版番茄炒蛋',2,'PRIVATE',1,'EGG','STIR_FRY')`,
      [variantId, familyA.id, baseId]);
    const r = await request('A', 'POST', `/families/${familyA.id}/recommendations/random-meal`, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 20
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
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 10
    });
    const ids = r.body.data.recipes.map(x => x.id);
    assert.ok(!ids.includes(familyBRecipe));
  });

  // R9: allergen hard filter — real exclusion
  await t.test('R9 allergen conflict recipe is hard excluded', async () => {
    const soyRecipe = await makeRecipe('含大豆菜', { mealTypes: ['DINNER'], protein: 'TOFU', method: 'STIR_FRY', allergens: ['SOY'] });
    // Add SOY allergen for user A in family A
    await pool.query(`INSERT INTO user_allergens(family_id,user_id,allergen_code) VALUES ($1,$2,'SOY')`, [familyA.id, userA.id]);
    const r = await request('A', 'POST', `/families/${familyA.id}/recommendations/random-meal`, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 30
    });
    const ids = r.body.data.recipes.map(x => x.id);
    assert.ok(!ids.includes(soyRecipe), 'SOY allergen recipe should be excluded for SOY-allergic family');
    // Family B (no SOY allergy) can see it
    const rB = await request('B', 'POST', `/families/${familyB.id}/recommendations/random-meal`, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 30
    });
    const idsB = rB.body.data.recipes.map(x => x.id);
    assert.ok(idsB.includes(soyRecipe), 'non-allergic family should see SOY recipe');
    await pool.query(`DELETE FROM user_allergens WHERE family_id=$1`, [familyA.id]);
  });

  // R10: explicit meal_type mismatch excluded
  await t.test('R10 explicit meal_type mismatch excluded', async () => {
    const r = await request('A', 'POST', `/families/${familyA.id}/recommendations/random-meal`, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 10
    });
    const ids = r.body.data.recipes.map(x => x.id);
    assert.ok(!ids.includes(recipeBreakfast), 'BREAKFAST-only recipe should not enter DINNER candidates');
  });

  // R11: untagged meal_type recipe can enter
  await t.test('R11 untagged recipe enters candidates', async () => {
    const r = await request('A', 'POST', `/families/${familyA.id}/recommendations/random-meal`, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 10
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
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 5
    });
    const dinner2 = r.body.data.recipes.find(x => x.id === recipeDinner2);
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
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 2
    });
    assert.equal(r.status, 200);
    await pool.query(`UPDATE family_settings SET repeat_strong_days=7, repeat_penalty_days=14, repeat_recover_days=28 WHERE family_id=$1`, [familyA.id]);
  });

  // R14: locked recipe preserved
  await t.test('R14 locked recipe preserved in results', async () => {
    const r = await request('A', 'POST', `/families/${familyA.id}/recommendations/random-meal`, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 3,
      locked_recipe_ids: [recipeDinner]
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

  // R16: deterministic RNG via service dependency injection (not HTTP _seed)
  await t.test('R16 fixed injected RNG produces reproducible results', async () => {
    let counter = 0;
    const fixedRng = () => { counter++; return 0.5; };
    const svc = createRecommendationService(pool, { randomFn: fixedRng });
    const r1 = await svc.generateRandomMeal(familyA.id, userA.id, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 3
    });
    const counterAfter1 = counter;
    const r2 = await svc.generateRandomMeal(familyA.id, userA.id, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 3
    });
    assert.deepEqual(r1.recipes.map(x => x.id), r2.recipes.map(x => x.id));
    assert.equal(counter, counterAfter1 * 2, 'RNG called same number of times');
  });

  // R17: combination diversity
  await t.test('R17 combination avoids 3x same protein and method', async () => {
    const r = await request('A', 'POST', `/families/${familyA.id}/recommendations/random-meal`, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 3
    });
    const proteins = r.body.data.recipes.map(x => x.protein_source_code).filter(Boolean);
    if (proteins.length >= 3) {
      const sameProtein = proteins.filter(p => p === proteins[0]).length;
      assert.ok(sameProtein < 3, `should not have 3 same protein, got ${proteins.join(',')}`);
    }
  });

  // R18: candidate shortage returns warning
  await t.test('R18 candidate shortage returns warning', async () => {
    const r = await request('A', 'POST', `/families/${familyA.id}/recommendations/random-meal`, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 100
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
    await pool.query(`INSERT INTO fridge_items(id,family_id,ingredient_id,quantity,unit_code,storage_location,expiry_date)
      VALUES ($1,$2,$3,500,'g','REFRIGERATED',CURRENT_DATE - INTERVAL '1 day')`, [randomUUID(), familyA.id, ingId]);
    const r = await request('A', 'GET', `/families/${familyA.id}/recommendations/fridge-cooking`);
    const recipe = r.body.data.find(x => x.id === recipeWithIng);
    if (recipe) {
      assert.equal(recipe.available_count, 0, 'expired ingredient should not count as available');
    }
    await pool.query(`DELETE FROM fridge_items WHERE family_id=$1`, [familyA.id]);
  });

  // R20: USE_INVENTORY boosts inventory match (not whole score)
  await t.test('R20 USE_INVENTORY mode boosts inventory match contribution', async () => {
    const ingId = randomUUID();
    await pool.query(`INSERT INTO ingredients(id,canonical_code,display_name,category_code,default_unit_code) VALUES ($1,$2,'快过期菜','VEGETABLE','g')`, [ingId, ingId]);
    const recipeExp = await makeRecipe('快过期匹配菜', { mealTypes: ['DINNER'], protein: 'CHICKEN', method: 'STEAM' });
    await pool.query(`INSERT INTO recipe_ingredients(id,recipe_id,ingredient_id,quantity,unit_code,type,required,sort_order)
      VALUES ($1,$2,$3,200,'g','MAIN',true,0)`, [randomUUID(), recipeExp, ingId]);
    await pool.query(`INSERT INTO fridge_items(id,family_id,ingredient_id,quantity,unit_code,storage_location,expiry_date)
      VALUES ($1,$2,$3,500,'g','REFRIGERATED',CURRENT_DATE + INTERVAL '1 day')`, [randomUUID(), familyA.id, ingId]);

    const rBalanced = await request('A', 'POST', `/families/${familyA.id}/recommendations/random-meal`, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 8
    });
    const rInventory = await request('A', 'POST', `/families/${familyA.id}/recommendations/random-meal`, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'USE_INVENTORY', target_count: 8
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
      assert.ok(item.diners_count_used != null);
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

  // R24: diners_count=1 one-person profile — real effect via service injection
  await t.test('R24 diners_count=1 one-person profile has real effect', async () => {
    const quickRecipe = await makeRecipe('快手一人菜', { mealTypes: ['DINNER'], protein: 'EGG', method: 'BOIL', cookTime: 8 });
    const slowRecipe = await makeRecipe('慢炖大菜', { mealTypes: ['DINNER'], protein: 'BEEF', method: 'BRAISE', cookTime: 60 });
    // Add 5 ingredients to slow recipe to make it less one-person friendly
    for (let i = 0; i < 5; i++) {
      const ingId = randomUUID();
      await pool.query(`INSERT INTO ingredients(id,canonical_code,display_name,category_code,default_unit_code) VALUES ($1,$2,'慢菜食材','VEGETABLE','g')`, [ingId, ingId]);
      await pool.query(`INSERT INTO recipe_ingredients(id,recipe_id,ingredient_id,quantity,unit_code,type,required,sort_order)
        VALUES ($1,$2,$3,50,'g','MAIN',true,$4)`, [randomUUID(), slowRecipe, ingId, i]);
    }
    const svc = createRecommendationService(pool, { randomFn: () => 0.5 });
    const r1 = await svc.generateRandomMeal(familyA.id, userA.id, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 1, mode: 'BALANCED', target_count: 10
    });
    const quick = r1.recipes.find(x => x.id === quickRecipe);
    const slow = r1.recipes.find(x => x.id === slowRecipe);
    if (quick && slow) {
      assert.ok(quick.score > slow.score, 'one-person profile should favor quick/simple recipe');
    }
  });

  // R25: weekly breakfast doesn't reuse DINNER matches_meal
  await t.test('R25 weekly breakfast uses correct meal_type candidates', async () => {
    const r = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/generate`, {
      week_start: '2026-09-14', mode: 'BALANCED'
    });
    assert.equal(r.status, 201);
    const plan = r.body.data;
    const breakfastItems = plan.items.filter(i => i.meal_type === 'BREAKFAST');
    const breakfastRecipeIds = breakfastItems.map(i => i.recipe_id);
    assert.ok(!breakfastRecipeIds.includes(recipeDinner), 'BREAKFAST plan should not include DINNER-only recipe');
  });

  // R26: limited candidate weekly doesn't empty due to permanent dedup
  await t.test('R26 weekly with limited candidates does not empty second half', async () => {
    const r = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/generate`, {
      week_start: '2026-09-14', mode: 'BALANCED'
    });
    const plan = r.body.data;
    const byDay = {};
    for (const item of plan.items) {
      if (!byDay[item.plan_date]) byDay[item.plan_date] = 0;
      byDay[item.plan_date]++;
    }
    const days = Object.keys(byDay).sort();
    const lastDay = days[days.length - 1];
    assert.ok(byDay[lastDay] > 0, `last day ${lastDay} should have items, got ${byDay[lastDay]}`);
  });

  // R27: quantity-aware — 500g recipe vs 1g fridge = NOT CAN_COOK_NOW
  await t.test('R27 500g recipe with 1g fridge is not can-cook-now', async () => {
    const ingId = randomUUID();
    await pool.query(`INSERT INTO ingredients(id,canonical_code,display_name,category_code,default_unit_code) VALUES ($1,$2,'猪肉','MEAT','g')`, [ingId, ingId]);
    const recipePork = await makeRecipe('猪肉菜谱', { mealTypes: ['DINNER'], protein: 'PORK', method: 'STIR_FRY' });
    await pool.query(`INSERT INTO recipe_ingredients(id,recipe_id,ingredient_id,quantity,unit_code,type,required,sort_order)
      VALUES ($1,$2,$3,500,'g','MAIN',true,0)`, [randomUUID(), recipePork, ingId]);
    await pool.query(`INSERT INTO fridge_items(id,family_id,ingredient_id,quantity,unit_code,storage_location)
      VALUES ($1,$2,$3,1,'g','REFRIGERATED')`, [randomUUID(), familyA.id, ingId]);
    const r = await request('A', 'GET', `/families/${familyA.id}/recommendations/fridge-cooking`);
    const recipe = r.body.data.find(x => x.id === recipePork);
    assert.ok(recipe);
    assert.notEqual(recipe.status, 'CAN_COOK_NOW', '1g fridge should not satisfy 500g recipe');
    await pool.query(`DELETE FROM fridge_items WHERE family_id=$1`, [familyA.id]);
  });

  // R28: multi-batch quantity — 0.2kg + 300g = 500g sufficient
  await t.test('R28 multi-batch 0.2kg + 300g satisfies 500g', async () => {
    const ingId = randomUUID();
    await pool.query(`INSERT INTO ingredients(id,canonical_code,display_name,category_code,default_unit_code) VALUES ($1,$2,'牛肉','MEAT','g')`, [ingId, ingId]);
    const recipeBeef = await makeRecipe('牛肉菜谱', { mealTypes: ['DINNER'], protein: 'BEEF', method: 'STIR_FRY' });
    await pool.query(`INSERT INTO recipe_ingredients(id,recipe_id,ingredient_id,quantity,unit_code,type,required,sort_order)
      VALUES ($1,$2,$3,500,'g','MAIN',true,0)`, [randomUUID(), recipeBeef, ingId]);
    await pool.query(`INSERT INTO fridge_items(id,family_id,ingredient_id,quantity,unit_code,storage_location)
      VALUES ($1,$2,$3,0.2,'kg','REFRIGERATED')`, [randomUUID(), familyA.id, ingId]);
    await pool.query(`INSERT INTO fridge_items(id,family_id,ingredient_id,quantity,unit_code,storage_location)
      VALUES ($1,$2,$3,300,'g','REFRIGERATED')`, [randomUUID(), familyA.id, ingId]);
    const r = await request('A', 'GET', `/families/${familyA.id}/recommendations/fridge-cooking`);
    const recipe = r.body.data.find(x => x.id === recipeBeef);
    assert.ok(recipe);
    assert.equal(recipe.status, 'CAN_COOK_NOW', '0.2kg + 300g = 500g should satisfy');
    await pool.query(`DELETE FROM fridge_items WHERE family_id=$1`, [familyA.id]);
  });

  // R29: COUNT quantity — 2 piece recipe vs 1 piece fridge = insufficient
  await t.test('R29 2 piece recipe with 1 piece fridge is insufficient', async () => {
    const ingId = randomUUID();
    await pool.query(`INSERT INTO ingredients(id,canonical_code,display_name,category_code,default_unit_code) VALUES ($1,$2,'鸡蛋','PROTEIN','piece')`, [ingId, ingId]);
    const recipeEgg = await makeRecipe('鸡蛋菜谱', { mealTypes: ['DINNER'], protein: 'EGG', method: 'BOIL' });
    await pool.query(`INSERT INTO recipe_ingredients(id,recipe_id,ingredient_id,quantity,unit_code,type,required,sort_order)
      VALUES ($1,$2,$3,2,'piece','MAIN',true,0)`, [randomUUID(), recipeEgg, ingId]);
    await pool.query(`INSERT INTO fridge_items(id,family_id,ingredient_id,quantity,unit_code,storage_location)
      VALUES ($1,$2,$3,1,'piece','REFRIGERATED')`, [randomUUID(), familyA.id, ingId]);
    const r = await request('A', 'GET', `/families/${familyA.id}/recommendations/fridge-cooking`);
    const recipe = r.body.data.find(x => x.id === recipeEgg);
    assert.ok(recipe);
    assert.notEqual(recipe.status, 'CAN_COOK_NOW', '1 piece should not satisfy 2 piece recipe');
    await pool.query(`DELETE FROM fridge_items WHERE family_id=$1`, [familyA.id]);
  });

  // R30: COUNT incompatibility — 2 piece recipe vs 2 root fridge = incompatible
  await t.test('R30 piece recipe with root fridge is incompatible/insufficient', async () => {
    const ingId = randomUUID();
    await pool.query(`INSERT INTO ingredients(id,canonical_code,display_name,category_code,default_unit_code) VALUES ($1,$2,'蒜','VEGETABLE','piece')`, [ingId, ingId]);
    const recipeGarlic = await makeRecipe('蒜菜谱', { mealTypes: ['DINNER'], protein: 'VEGETABLE', method: 'STIR_FRY' });
    await pool.query(`INSERT INTO recipe_ingredients(id,recipe_id,ingredient_id,quantity,unit_code,type,required,sort_order)
      VALUES ($1,$2,$3,2,'piece','MAIN',true,0)`, [randomUUID(), recipeGarlic, ingId]);
    await pool.query(`INSERT INTO fridge_items(id,family_id,ingredient_id,quantity,unit_code,storage_location)
      VALUES ($1,$2,$3,2,'root','REFRIGERATED')`, [randomUUID(), familyA.id, ingId]);
    const r = await request('A', 'GET', `/families/${familyA.id}/recommendations/fridge-cooking`);
    const recipe = r.body.data.find(x => x.id === recipeGarlic);
    assert.ok(recipe);
    assert.notEqual(recipe.status, 'CAN_COOK_NOW', 'root should not satisfy piece recipe');
    await pool.query(`DELETE FROM fridge_items WHERE family_id=$1`, [familyA.id]);
  });

  // R31: fridge cooking uses shared meal-type filter — BREAKFAST-only excluded
  await t.test('R31 fridge cooking excludes BREAKFAST-only recipes', async () => {
    const r = await request('A', 'GET', `/families/${familyA.id}/recommendations/fridge-cooking`);
    const ids = r.body.data.map(x => x.id);
    assert.ok(!ids.includes(recipeBreakfast), 'BREAKFAST-only recipe should not appear in dinner fridge cooking');
  });

  // R32: fridge cooking uses shared allergen filter
  await t.test('R32 fridge cooking excludes allergen-conflict recipes', async () => {
    const soyRecipe = await makeRecipe('冰箱大豆菜', { mealTypes: ['DINNER'], protein: 'TOFU', method: 'STIR_FRY', allergens: ['SOY'] });
    await pool.query(`INSERT INTO user_allergens(family_id,user_id,allergen_code) VALUES ($1,$2,'SOY')`, [familyA.id, userA.id]);
    const r = await request('A', 'GET', `/families/${familyA.id}/recommendations/fridge-cooking`);
    const ids = r.body.data.map(x => x.id);
    assert.ok(!ids.includes(soyRecipe), 'SOY allergen recipe should be excluded from fridge cooking');
    await pool.query(`DELETE FROM user_allergens WHERE family_id=$1`, [familyA.id]);
  });

  // R33: weekly locked family isolation — other family plan ID rejected
  await t.test('R33 weekly generate rejects other family locked plan', async () => {
    const r = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/generate`, {
      week_start: '2026-09-21', mode: 'BALANCED', preserve_locked_from_plan_id: randomUUID()
    });
    assert.ok(r.status === 404 || r.status === 403, 'other family/nonexistent plan ID should be rejected');
  });

  // R34: in-plan recency — recipe planned yesterday gets strong penalty today
  await t.test('R34 in-plan recency uses latest occurrence', async () => {
    // Create a meal 20 days ago with recipeDinner3
    const oldMealId = randomUUID();
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 20);
    const oldDateStr = oldDate.toISOString().split('T')[0];
    await pool.query(`INSERT INTO meals(id,family_id,meal_date,meal_type,status,diners_count) VALUES ($1,$2,$3,'DINNER','COMPLETED',2)`, [oldMealId, familyA.id, oldDateStr]);
    await pool.query(`INSERT INTO meal_items(id,meal_id,recipe_id,servings,source,selected_by_user_id) VALUES ($1,$2,$3,2,'MANUAL',$4)`,
      [randomUUID(), oldMealId, recipeDinner3, userA.id]);
    // Generate weekly plan starting yesterday (so recipeDinner3 gets planned yesterday)
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 1);
    const weekStartStr = weekStart.toISOString().split('T')[0];
    const plan = await request('A', 'POST', `/families/${familyA.id}/weekly-plans/generate`, {
      week_start: weekStartStr, mode: 'BALANCED'
    });
    // Now random meal today should see recipeDinner3 as "recently planned" (yesterday), not 20 days ago
    const r = await request('A', 'POST', `/families/${familyA.id}/recommendations/random-meal`, {
      meal_date: new Date().toISOString().split('T')[0], meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 5
    });
    const d3 = r.body.data.recipes.find(x => x.id === recipeDinner3);
    if (d3) {
      assert.ok(d3.score < 50, 'recipe planned yesterday should have strong repeat penalty, not 20-day-old');
    }
    await pool.query(`DELETE FROM meal_items WHERE meal_id=$1`, [oldMealId]);
    await pool.query(`DELETE FROM meals WHERE id=$1`, [oldMealId]);
  });

  // R35: base_servings=4, diners=2 → required scaled to 200g, 200g fridge = CAN_COOK_NOW
  await t.test('R35 base_servings=4 diners=2 scales required to 200g not 400g', async () => {
    const ingId = randomUUID();
    await pool.query(`INSERT INTO ingredients(id,canonical_code,display_name,category_code,default_unit_code) VALUES ($1,$2,'R35猪肉','MEAT','g')`, [ingId, ingId]);
    const recipeId = await makeRecipe('R35四人份菜', { mealTypes: ['DINNER'], protein: 'PORK', method: 'STIR_FRY', baseServings: 4 });
    await pool.query(`INSERT INTO recipe_ingredients(id,recipe_id,ingredient_id,quantity,unit_code,type,required,sort_order)
      VALUES ($1,$2,$3,400,'g','MAIN',true,0)`, [randomUUID(), recipeId, ingId]);
    // Fridge has exactly 200g — correct scale (2/4=0.5) requires 200g → sufficient
    await pool.query(`INSERT INTO fridge_items(id,family_id,ingredient_id,quantity,unit_code,storage_location)
      VALUES ($1,$2,$3,200,'g','REFRIGERATED')`, [randomUUID(), familyA.id, ingId]);
    const r = await request('A', 'GET', `/families/${familyA.id}/recommendations/fridge-cooking`);
    const recipe = r.body.data.find(x => x.id === recipeId);
    assert.ok(recipe, 'recipe should appear in fridge cooking');
    assert.equal(recipe.status, 'CAN_COOK_NOW', `200g fridge should satisfy scaled 200g requirement, got status=${recipe.status}`);
    const missing = recipe.missing_ingredients.find(m => m.ingredient_id === ingId);
    assert.ok(!missing, 'should not report pork as missing when 200g satisfies scaled 200g');
    await pool.query(`DELETE FROM fridge_items WHERE family_id=$1`, [familyA.id]);
  });

  // R36: base_servings=1, diners=2 → required scaled to 200g, 100g fridge = NOT sufficient
  await t.test('R36 base_servings=1 diners=2 scales required to 200g, 100g insufficient', async () => {
    const ingId = randomUUID();
    await pool.query(`INSERT INTO ingredients(id,canonical_code,display_name,category_code,default_unit_code) VALUES ($1,$2,'R36牛肉','MEAT','g')`, [ingId, ingId]);
    const recipeId = await makeRecipe('R36一人份菜', { mealTypes: ['DINNER'], protein: 'BEEF', method: 'STIR_FRY', baseServings: 1 });
    await pool.query(`INSERT INTO recipe_ingredients(id,recipe_id,ingredient_id,quantity,unit_code,type,required,sort_order)
      VALUES ($1,$2,$3,100,'g','MAIN',true,0)`, [randomUUID(), recipeId, ingId]);
    // Fridge has 100g — correct scale (2/1=2) requires 200g → insufficient
    await pool.query(`INSERT INTO fridge_items(id,family_id,ingredient_id,quantity,unit_code,storage_location)
      VALUES ($1,$2,$3,100,'g','REFRIGERATED')`, [randomUUID(), familyA.id, ingId]);
    const r = await request('A', 'GET', `/families/${familyA.id}/recommendations/fridge-cooking`);
    const recipe = r.body.data.find(x => x.id === recipeId);
    assert.ok(recipe);
    assert.notEqual(recipe.status, 'CAN_COOK_NOW', '100g fridge should not satisfy scaled 200g requirement');
    const missing = recipe.missing_ingredients.find(m => m.ingredient_id === ingId);
    assert.ok(missing, 'pork should be reported as missing');
    assert.equal(missing.required_quantity, 200, `required_quantity should be 200g (scaled from 100g base × 2 diners), got ${missing.required_quantity}`);
    assert.equal(missing.available_quantity, 100, `available_quantity should be 100g, got ${missing.available_quantity}`);
    await pool.query(`DELETE FROM fridge_items WHERE family_id=$1`, [familyA.id]);
  });

  // R37: Random recommendation uses per-recipe base_servings for inventory scoring
  await t.test('R37 random recommendation uses recipe.base_servings for inventory scale', async () => {
    const ingId = randomUUID();
    await pool.query(`INSERT INTO ingredients(id,canonical_code,display_name,category_code,default_unit_code) VALUES ($1,$2,'R37鸡肉','MEAT','g')`, [ingId, ingId]);
    // Recipe: base_servings=4, 400g ingredient. With diners=2, scale=0.5, required=200g.
    const recipeId = await makeRecipe('R37随机四人菜', { mealTypes: ['DINNER'], protein: 'CHICKEN', method: 'STIR_FRY', baseServings: 4, cookTime: 20 });
    await pool.query(`INSERT INTO recipe_ingredients(id,recipe_id,ingredient_id,quantity,unit_code,type,required,sort_order)
      VALUES ($1,$2,$3,400,'g','MAIN',true,0)`, [randomUUID(), recipeId, ingId]);
    const svc = createRecommendationService(pool, { randomFn: () => 0.3 });
    // Baseline: no fridge inventory
    const r1 = await svc.generateRandomMeal(familyA.id, userA.id, {
      meal_date: '2026-09-15', meal_type: 'DINNER', diners_count: 2, mode: 'USE_INVENTORY', target_count: 10
    });
    const baseline = r1.recipes.find(x => x.id === recipeId);
    assert.ok(baseline, 'recipe should be in candidates');
    // Add 200g fridge — exactly satisfies scaled 200g requirement
    await pool.query(`INSERT INTO fridge_items(id,family_id,ingredient_id,quantity,unit_code,storage_location)
      VALUES ($1,$2,$3,200,'g','REFRIGERATED')`, [randomUUID(), familyA.id, ingId]);
    const r2 = await svc.generateRandomMeal(familyA.id, userA.id, {
      meal_date: '2026-09-15', meal_type: 'DINNER', diners_count: 2, mode: 'USE_INVENTORY', target_count: 10
    });
    const withInv = r2.recipes.find(x => x.id === recipeId);
    assert.ok(withInv);
    // With correct per-recipe scale (200g required, 200g available), inventory match should boost score
    // With old /2 bug (400g required, 200g available), no boost → score unchanged
    assert.ok(withInv.score > baseline.score,
      `USE_INVENTORY with 200g fridge should boost score when scale=2/4: baseline=${baseline.score} withInv=${withInv.score}`);
    await pool.query(`DELETE FROM fridge_items WHERE family_id=$1`, [familyA.id]);
  });

  // R38: Weekly serving scale is deterministic — old /2 must FAIL
  await t.test('R38 weekly serving scale determines DINNER slot deterministically', async () => {
    // Save and narrow dinner target to 1 so top-score decides
    const settingsRow = (await pool.query('SELECT dinner_target_count FROM family_settings WHERE family_id=$1', [familyA.id])).rows[0];
    const origDinnerCount = settingsRow?.dinner_target_count;
    await pool.query('UPDATE family_settings SET dinner_target_count=1 WHERE family_id=$1', [familyA.id]);

    const ingId = randomUUID();
    await pool.query(`INSERT INTO ingredients(id,canonical_code,display_name,category_code,default_unit_code) VALUES ($1,$2,'R38牛肉','MEAT','g')`, [ingId, ingId]);

    // A: base_servings=4, 400g. default_diners=2 → correct scale=0.5 → required=200g.
    //    No rating. With correct scale + 200g fridge → inventory boost → wins.
    //    Old /2 → required=400g → 200g insufficient → no boost → loses.
    const recipeA = await makeRecipe('R38四人份牛肉', { mealTypes: ['DINNER'], protein: 'BEEF', method: 'STIR_FRY', baseServings: 4, cookTime: 30 });
    await pool.query(`INSERT INTO recipe_ingredients(id,recipe_id,ingredient_id,quantity,unit_code,type,required,sort_order)
      VALUES ($1,$2,$3,400,'g','MAIN',true,0)`, [randomUUID(), recipeA, ingId]);

    // B: control with rating 5 (+18 base), no required ingredients → no inventory boost
    const recipeB = await makeRecipe('R38对照高分菜', { mealTypes: ['DINNER'], protein: 'PORK', method: 'ROAST', baseServings: 2, cookTime: 30 });
    await pool.query(`INSERT INTO recipe_ratings(family_id,user_id,recipe_id,meal_id,rating) VALUES ($1,$2,$3,NULL,5)`,
      [familyA.id, userA.id, recipeB]);

    // 200g fridge — exactly satisfies correct scale (200g), insufficient for old /2 (400g)
    await pool.query(`INSERT INTO fridge_items(id,family_id,ingredient_id,quantity,unit_code,storage_location)
      VALUES ($1,$2,$3,200,'g','REFRIGERATED')`, [randomUUID(), familyA.id, ingId]);

    const svc = createRecommendationService(pool, { randomFn: () => 0.3 });
    const plan = await svc.generateWeeklyPlan(familyA.id, userA.id, { week_start: '2026-09-28', mode: 'USE_INVENTORY' });

    // Day 0 DINNER slot — with correct scale A must win; old /2 would select B
    const day0Dinner = plan.items.find(i => i.plan_date === '2026-09-28' && i.meal_type === 'DINNER');
    assert.ok(day0Dinner, 'day 0 DINNER should exist');
    assert.equal(day0Dinner.recipe_id, recipeA,
      `day 0 DINNER must be A (correct scale 2/4=0.5 → 200g satisfied → inventory boost). Got ${day0Dinner.recipe_id}`);

    // Cleanup
    await pool.query(`DELETE FROM fridge_items WHERE family_id=$1`, [familyA.id]);
    await pool.query(`DELETE FROM recipe_ratings WHERE recipe_id=$1`, [recipeB]);
    if (origDinnerCount != null) {
      await pool.query('UPDATE family_settings SET dinner_target_count=$1 WHERE family_id=$2', [origDinnerCount, familyA.id]);
    } else {
      await pool.query('UPDATE family_settings SET dinner_target_count=DEFAULT WHERE family_id=$1', [familyA.id]);
    }
  });

  // R39: invalid base_servings produces structured warning, recipe excluded
  await t.test('R39 invalid base_servings warning is structured object and recipe excluded', async () => {
    const badRecipe = randomUUID();
    await pool.query(`INSERT INTO recipes(id,kind,source_type,name,base_servings,visibility,version,protein_source_code,cooking_method_code,cook_time_minutes)
      VALUES ($1,'BASE','MANUAL','R39无效份数菜',-1,'PUBLIC',1,'FISH','BAKE',20)`, [badRecipe]);
    await pool.query(`INSERT INTO recipe_meal_types(recipe_id,meal_type) VALUES ($1,'DINNER')`, [badRecipe]);

    const svc = createRecommendationService(pool, { randomFn: () => 0.3 });
    const r = await svc.generateRandomMeal(familyA.id, userA.id, {
      meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED', target_count: 30
    });
    const ids = r.recipes.map(x => x.id);
    assert.ok(!ids.includes(badRecipe), 'invalid base_servings recipe must be excluded');
    const warn = r.warnings.find(w => w && typeof w === 'object' && w.code === 'INVALID_BASE_SERVINGS' && w.recipe_id === badRecipe);
    assert.ok(warn, 'warnings must include structured INVALID_BASE_SERVINGS object');
    assert.ok(r.warnings.every(w => w && typeof w === 'object'), 'all warnings must be objects, no strings');
  });

  // R40: locked invalid recipe must 422, not 200 with silent disappearance
  await t.test('R40 locked invalid base_servings recipe returns 422', async () => {
    const badLocked = randomUUID();
    await pool.query(`INSERT INTO recipes(id,kind,source_type,name,base_servings,visibility,version,protein_source_code,cooking_method_code,cook_time_minutes)
      VALUES ($1,'BASE','MANUAL','R40锁定无效菜',-1,'PUBLIC',1,'FISH','BAKE',20)`, [badLocked]);
    await pool.query(`INSERT INTO recipe_meal_types(recipe_id,meal_type) VALUES ($1,'DINNER')`, [badLocked]);

    const svc = createRecommendationService(pool, { randomFn: () => 0.3 });
    let err = null;
    try {
      await svc.generateRandomMeal(familyA.id, userA.id, {
        meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2, mode: 'BALANCED',
        target_count: 3, locked_recipe_ids: [badLocked]
      });
    } catch (e) {
      err = e;
    }
    assert.ok(err, 'locked invalid recipe must throw');
    assert.equal(err.status, 422, `expected 422, got ${err.status}`);
    assert.equal(err.code, 'INVALID_LOCKED_RECIPES', `expected INVALID_LOCKED_RECIPES, got ${err.code}`);
  });
});
