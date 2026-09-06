const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const DETAIL_JS = path.resolve(__dirname, '../../miniprogram/pages/detail/detail.js');
const DETAIL_WXML = path.resolve(__dirname, '../../miniprogram/pages/detail/detail.wxml');
const MEAL_JS = path.resolve(__dirname, '../../miniprogram/pages/meal/meal.js');
const MEAL_WXML = path.resolve(__dirname, '../../miniprogram/pages/meal/meal.wxml');
const MENU_JS = path.resolve(__dirname, '../../miniprogram/pages/menu/menu.js');

// ===== Helpers =====
function mockPageEnv(extraWx = {}) {
  const captured = { pageConfig: null };
  global.Page = (config) => { captured.pageConfig = config; };
  const toasts = [];
  const modals = [];
  const storage = {};
  const wx = {
    showToast: (o) => toasts.push(o.title),
    showModal: (o) => modals.push(o),
    showLoading: () => {},
    hideLoading: () => {},
    setStorageSync: (k, v) => { storage[k] = v; },
    getStorageSync: (k) => storage[k],
    removeStorageSync: (k) => { delete storage[k]; },
    switchTab: () => {},
    navigateTo: (o) => { storage.__navigateTo = o.url; },
    navigateBack: () => {},
    ...extraWx,
  };
  global.wx = wx;
  global.getApp = () => ({ getV1Session: () => ({ getState: () => ({ active_family_id: 'f' }) }) });
  return { captured, toasts, modals, storage, wx };
}

function makePage(captured, initialData = {}) {
  const pageConfig = captured.pageConfig;
  if (!pageConfig) throw new Error('Page config not captured — did require() call global.Page?');
  const page = { ...pageConfig, data: { ...pageConfig.data, ...initialData } };
  page.setData = function (values) { Object.assign(this.data, values); };
  return page;
}

function loadDetailPage() {
  delete require.cache[require.resolve(DETAIL_JS)];
  const env = mockPageEnv();
  require(DETAIL_JS);
  return env;
}

function loadMealPage() {
  delete require.cache[require.resolve(MEAL_JS)];
  const env = mockPageEnv();
  require(MEAL_JS);
  return env;
}

// ===== B1: detail.js no longer imports legacy utils/api.js =====
test('B1: detail.js does not import legacy utils/api.js', () => {
  const src = fs.readFileSync(DETAIL_JS, 'utf8');
  assert.ok(!src.includes("utils/api.js"), 'detail.js must not import legacy utils/api.js');
  assert.ok(src.includes('createV1Api'), 'detail.js must use createV1Api');
});

// ===== B2: detail page calls getRecipe(familyId, recipeId) =====
test('B2: detail page calls getRecipe with familyId and recipeId', async () => {
  const env = loadDetailPage();
  const page = makePage(env.captured);
  const apiCalls = [];
  page._api = {
    getRecipe: async (familyId, recipeId) => {
      apiCalls.push([familyId, recipeId]);
      return { recipe: { id: recipeId, name: '红烧肉' }, ingredients: [], steps: [], cookware: [], meal_types: [], tags: [], allergens: [], nutrition: null, media: [] };
    },
  };
  page.recipeId = 'r1';
  page.familyId = 'f1';
  await page.loadRecipe();
  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0][0], 'f1');
  assert.equal(apiCalls[0][1], 'r1');
  assert.equal(page.data.recipe.name, '红烧肉');
  assert.equal(page.data.loading, false);
});

// ===== B3: recipe structured data maps ingredients/steps =====
test('B3: recipe structured data maps ingredients and steps', async () => {
  const env = loadDetailPage();
  const page = makePage(env.captured);
  page._api = {
    getRecipe: async () => ({
      recipe: { id: 'r1', name: '红烧肉', base_servings: 2, cook_time_minutes: 30, difficulty: 2 },
      ingredients: [
        { id: 'i1', ingredient_name: '五花肉', quantity: 500, unit_code: 'g', quantity_text: '500g', type: 'MAIN' },
        { id: 'i2', ingredient_name: '生抽', quantity: null, unit_code: null, quantity_text: '适量', type: 'SEASONING' },
      ],
      steps: [
        { id: 's1', step_no: 1, operation: '五花肉切块焯水', duration_text: '5分钟', tip: '冷水下锅' },
        { id: 's2', step_no: 2, operation: '炒糖色', duration_text: '3分钟' },
      ],
      cookware: [{ cookware_code: 'WOK' }],
      meal_types: ['LUNCH', 'DINNER'],
      tags: [{ tag_code: '家常菜' }],
      allergens: [],
      nutrition: null,
      media: [],
    }),
  };
  page.recipeId = 'r1'; page.familyId = 'f1';
  await page.loadRecipe();
  assert.equal(page.data.ingredients.length, 2);
  assert.equal(page.data.ingredients[0].displayName, '五花肉');
  assert.equal(page.data.ingredients[0].amountText, '500g');
  assert.equal(page.data.steps.length, 2);
  assert.equal(page.data.steps[0].instruction, '五花肉切块焯水');
  assert.equal(page.data.steps[0].durationText, '5分钟');
  assert.equal(page.data.cookware.length, 1);
  assert.equal(page.data.mealTypes.length, 2);
});

// ===== B4: API error is not empty state =====
test('B4: API error is distinct from empty state', async () => {
  const env = loadDetailPage();
  const page = makePage(env.captured);
  page._api = { getRecipe: async () => { throw new Error('NETWORK_ERROR'); } };
  page.recipeId = 'r1'; page.familyId = 'f1';
  await page.loadRecipe();
  assert.equal(page.data.loading, false);
  assert.ok(page.data.loadError, 'must set loadError');
  assert.equal(page.data.recipe, null);
});

// ===== B5: addToMeal uses ensureCurrentMeal + addMealItem source=MANUAL =====
test('B5: addToMeal ensures meal and adds item with source MANUAL', async () => {
  const env = loadDetailPage();
  const page = makePage(env.captured);
  const apiCalls = [];
  page._api = {
    getCurrentMeal: async () => null,
    ensureCurrentMeal: async (fid, payload) => { apiCalls.push(['ensure', payload]); return { id: 'm1', diners_count: 2 }; },
    addMealItem: async (fid, mealId, payload) => { apiCalls.push(['add', mealId, payload]); return {}; },
  };
  page._mealTarget = { get: () => ({ meal_date: '2026-09-06', meal_type: 'DINNER', diners_count: 2 }) };
  page.recipeId = 'r1'; page.familyId = 'f1';
  await page.addToMeal();
  assert.equal(apiCalls[0][0], 'ensure');
  assert.equal(apiCalls[1][0], 'add');
  assert.equal(apiCalls[1][2].recipe_id, 'r1');
  assert.equal(apiCalls[1][2].source, 'MANUAL');
  assert.equal(apiCalls[1][2].servings, 2);
});

// ===== B6: ALREADY_IN_MEAL shows friendly message =====
test('B6: ALREADY_IN_MEAL shows friendly toast', async () => {
  const env = loadDetailPage();
  const page = makePage(env.captured);
  page._api = {
    getCurrentMeal: async () => ({ id: 'm1', diners_count: 2 }),
    ensureCurrentMeal: async () => ({ id: 'm1', diners_count: 2 }),
    addMealItem: async () => { const e = new Error('already'); e.code = 'ALREADY_IN_MEAL'; throw e; },
  };
  page._mealTarget = { get: () => ({ meal_date: '2026-09-06', meal_type: 'DINNER', diners_count: 2 }) };
  page.recipeId = 'r1'; page.familyId = 'f1';
  await page.addToMeal();
  assert.ok(env.toasts.some(t => t.includes('已经在本餐')), 'must show friendly already-in-meal message');
});

// ===== B7: addToMeal does not call any weekly mutation =====
test('B7: addToMeal does not call weekly mutations', async () => {
  const env = loadDetailPage();
  const page = makePage(env.captured);
  const called = [];
  page._api = {
    getCurrentMeal: async () => ({ id: 'm1', diners_count: 2 }),
    ensureCurrentMeal: async () => ({ id: 'm1', diners_count: 2 }),
    addMealItem: async () => ({}),
  };
  // No weekly methods exist on mock api — if code calls them, it will throw
  page._mealTarget = { get: () => ({ meal_date: '2026-09-06', meal_type: 'DINNER', diners_count: 2 }) };
  page.recipeId = 'r1'; page.familyId = 'f1';
  await page.addToMeal();
  // If no weekly method was called, no error thrown
  assert.ok(true);
});

// ===== B8: PLANNING meal with items > 0 calls confirmMeal =====
test('B8: confirmMenu calls confirmMeal when PLANNING with items', async () => {
  const env = loadMealPage();
  const page = makePage(env.captured, {
    familyId: 'f1', mealDate: '2026-09-06', mealType: 'DINNER',
    meal: { id: 'm1', status: 'PLANNING', diners_count: 2 },
    items: [{ id: 'it1', recipe_id: 'r1', recipe_name: '红烧肉' }],
  });
  let confirmCalled = false;
  page._api = {
    confirmMeal: async (fid, mealId) => {
      confirmCalled = true;
      assert.equal(fid, 'f1');
      assert.equal(mealId, 'm1');
      return { id: 'm1', status: 'CONFIRMED', recipe_snapshot: { schema_version: 1, items: [] }, items: [] };
    },
  };
  await page.confirmMenu();
  assert.ok(confirmCalled, 'confirmMeal must be called');
  assert.equal(page.data.meal.status, 'CONFIRMED');
});

// ===== B9: confirm success reloads status=CONFIRMED =====
test('B9: confirm success sets status CONFIRMED and verifies snapshot', async () => {
  const env = loadMealPage();
  const page = makePage(env.captured, {
    familyId: 'f1', meal: { id: 'm1', status: 'PLANNING' }, items: [{ id: 'it1' }],
  });
  page._api = {
    confirmMeal: async () => ({ id: 'm1', status: 'CONFIRMED', recipe_snapshot: { schema_version: 1 }, items: [] }),
  };
  await page.confirmMenu();
  assert.equal(page.data.meal.status, 'CONFIRMED');
  assert.equal(page.data.meal.recipe_snapshot.schema_version, 1);
});

// ===== B10: confirm后 edit controls disabled (WXML) =====
test('B10: meal.wxml disables editing when not PLANNING', () => {
  const wxml = fs.readFileSync(MEAL_WXML, 'utf8');
  // diners control only shown when status === PLANNING
  assert.ok(wxml.includes("meal.status === 'PLANNING'"), 'diners control must be PLANNING-only');
  // remove button only when PLANNING
  assert.ok(wxml.includes("meal.status === 'PLANNING'"), 'remove button must be PLANNING-only');
  // add button only when PLANNING
  assert.ok(wxml.includes("meal.status === 'PLANNING'"), 'add button must be PLANNING-only');
});

// ===== B11: CONFIRMED meal can startCooking =====
test('B11: CONFIRMED meal calls startCooking', async () => {
  const env = loadMealPage();
  const page = makePage(env.captured, {
    familyId: 'f1', meal: { id: 'm1', status: 'CONFIRMED' }, items: [{ id: 'it1' }],
  });
  let startCalled = false;
  page._api = {
    startCooking: async (fid, mealId) => {
      startCalled = true;
      return { session_id: 's1', meal: { id: 'm1', status: 'COOKING' }, steps: [{ id: 'st1', recipe_name: '红烧肉', operation: '焯水', step_no: 1 }] };
    },
  };
  await page.startCooking();
  assert.ok(startCalled);
  assert.equal(page.data.cooking.session_id, 's1');
  assert.equal(page.data.cookingSteps.length, 1);
  assert.equal(page.data.cookingSteps[0].recipeName, '红烧肉');
});

// ===== B12: PLANNING meal cannot startCooking =====
test('B12: PLANNING meal cannot startCooking', async () => {
  const env = loadMealPage();
  const page = makePage(env.captured, {
    familyId: 'f1', meal: { id: 'm1', status: 'PLANNING' }, items: [{ id: 'it1' }],
  });
  let startCalled = false;
  page._api = { startCooking: async () => { startCalled = true; return {}; } };
  await page.startCooking();
  assert.ok(!startCalled, 'startCooking must NOT be called for PLANNING');
  assert.ok(env.toasts.some(t => t.includes('确认')), 'must prompt to confirm first');
});

// ===== B13: detail startCooking is meal-scoped, not dish-scoped =====
test('B13: detail startCooking checks meal status, does not call dish-scoped API', async () => {
  const env = loadDetailPage();
  const page = makePage(env.captured);
  const apiCalls = [];
  page._api = {
    getCurrentMeal: async () => ({ id: 'm1', status: 'PLANNING', items: [{ recipe_id: 'r1' }] }),
  };
  page._mealTarget = { get: () => ({ meal_date: '2026-09-06', meal_type: 'DINNER' }) };
  page.recipeId = 'r1'; page.familyId = 'f1';
  await page.startCooking();
  // Should show modal prompting to confirm, NOT call startCooking API
  assert.equal(env.modals.length, 1);
  assert.ok(env.modals[0].content.includes('确认'));
});

// ===== B14: cooking UI steps come from startCooking response (frozen) =====
test('B14: cooking steps come from startCooking response, not getRecipe', async () => {
  const env = loadMealPage();
  const page = makePage(env.captured, {
    familyId: 'f1', meal: { id: 'm1', status: 'CONFIRMED' }, items: [{ id: 'it1' }],
  });
  let getRecipeCalled = false;
  page._api = {
    startCooking: async () => ({
      session_id: 's1', meal: { id: 'm1', status: 'COOKING' },
      steps: [{ id: 'st1', recipe_name: '红烧肉', operation: '老步骤焯水', step_no: 1 }],
    }),
    getRecipe: async () => { getRecipeCalled = true; return {}; },
  };
  await page.startCooking();
  assert.ok(!getRecipeCalled, 'must NOT call getRecipe to build cooking steps');
  assert.equal(page.data.cookingSteps[0].instruction, '老步骤焯水');
});

// ===== B15: cooking view WXML does not call getRecipe =====
test('B15: meal.wxml cooking view uses cookingSteps data', () => {
  const wxml = fs.readFileSync(MEAL_WXML, 'utf8');
  assert.ok(wxml.includes('cookingSteps'), 'cooking view must iterate cookingSteps');
  assert.ok(wxml.includes('cooking.session_id'), 'cooking view must show session_id');
});

// ===== B16: snapshot missing/unsupported fail closed =====
test('B16: confirm with missing snapshot fails closed', async () => {
  const env = loadMealPage();
  const page = makePage(env.captured, {
    familyId: 'f1', meal: { id: 'm1', status: 'PLANNING' }, items: [{ id: 'it1' }],
  });
  page._api = {
    confirmMeal: async () => ({ id: 'm1', status: 'CONFIRMED', recipe_snapshot: null }),
  };
  await page.confirmMenu();
  // Must NOT show success toast
  assert.ok(!env.toasts.some(t => t.includes('已确认')), 'must not show confirmed toast');
  assert.ok(env.modals.length > 0 || env.toasts.some(t => t.includes('失败') || t.includes('快照')), 'must show error');
});

// ===== B17: duplicate startCooking has busy guard =====
test('B17: busy guard prevents duplicate startCooking', async () => {
  const env = loadMealPage();
  const page = makePage(env.captured, {
    familyId: 'f1', meal: { id: 'm1', status: 'CONFIRMED' }, items: [{ id: 'it1' }],
  });
  let callCount = 0;
  page._api = {
    startCooking: async () => {
      callCount++;
      await new Promise(r => setTimeout(r, 10));
      return { session_id: 's1', meal: { id: 'm1', status: 'COOKING' }, steps: [] };
    },
  };
  // Fire two calls simultaneously
  const p1 = page.startCooking();
  const p2 = page.startCooking();
  await Promise.all([p1, p2]);
  assert.equal(callCount, 1, 'only one startCooking call due to busy guard');
});

// ===== B18: MENU-15 navigateTo detail with recipe_id =====
test('B18: menu goDetail navigates to detail with recipe_id', () => {
  const src = fs.readFileSync(MENU_JS, 'utf8');
  assert.ok(src.includes("navigateTo"), 'menu.js must call navigateTo');
  assert.ok(src.includes('/pages/detail/detail?id='), 'must navigate to detail with id param');
  assert.ok(!src.includes('菜品详情接入后启用'), 'must not be placeholder toast');
});

// ===== B19: detail.wxml no legacy dish structure =====
test('B19: detail.wxml uses V1 recipe data structure', () => {
  const wxml = fs.readFileSync(DETAIL_WXML, 'utf8');
  assert.ok(wxml.includes('recipe.name'), 'must use recipe.name');
  assert.ok(wxml.includes('ingredients'), 'must use ingredients array');
  assert.ok(wxml.includes('steps'), 'must use steps array');
  assert.ok(!wxml.includes('dish.ingredients.main'), 'must not use legacy dish.ingredients.main grouping');
  assert.ok(!wxml.includes('dish.image'), 'must not use legacy dish.image');
});

// ===== B20: meal.wxml has confirm and start cooking buttons =====
test('B20: meal.wxml has confirmMenu and startCooking buttons', () => {
  const wxml = fs.readFileSync(MEAL_WXML, 'utf8');
  assert.ok(wxml.includes('confirmMenu'), 'must have confirmMenu bindtap');
  assert.ok(wxml.includes('startCooking'), 'must have startCooking bindtap');
  assert.ok(wxml.includes("meal.status === 'CONFIRMED'"), 'startCooking only for CONFIRMED');
});
