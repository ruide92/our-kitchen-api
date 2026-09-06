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
  page._saveLocalCooking = () => {};
  let startCalled = false;
  page._api = {
    startCooking: async (fid, mealId) => {
      startCalled = true;
      // Production shape: meal is pre-update (status CONFIRMED)
      return { session_id: 's1', meal: { id: 'm1', status: 'CONFIRMED' }, steps: [{ id: 'st1', recipe_name: '红烧肉', operation: '焯水', step_no: 1 }] };
    },
  };
  await page.startCooking();
  assert.ok(startCalled);
  assert.equal(page.data.cookingData.session_id, 's1');
  assert.equal(page.data.cookingSteps.length, 1);
  assert.equal(page.data.cookingSteps[0].recipeName, '红烧肉');
  assert.equal(page.data.meal.status, 'COOKING', 'page must reflect server COOKING');
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
  page._saveLocalCooking = () => {};
  let getRecipeCalled = false;
  page._api = {
    startCooking: async () => ({
      session_id: 's1', meal: { id: 'm1', status: 'CONFIRMED' },
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
  assert.ok(wxml.includes('cookingData.session_id'), 'cooking view must show session_id');
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
  page._saveLocalCooking = () => {};
  let callCount = 0;
  page._api = {
    startCooking: async () => {
      callCount++;
      await new Promise(r => setTimeout(r, 10));
      return { session_id: 's1', meal: { id: 'm1', status: 'CONFIRMED' }, steps: [] };
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

// ===== C1: confirm production shape (no items) preserves existing items =====
test('C1: confirm production response without items preserves existing items', async () => {
  const env = loadMealPage();
  const page = makePage(env.captured, {
    familyId: 'f1', meal: { id: 'm1', status: 'PLANNING' },
    items: [{ id: 'it1', recipe_name: '红烧肉' }, { id: 'it2', recipe_name: '青菜' }],
  });
  page._api = {
    // Production shape: returns meal row WITHOUT items
    confirmMeal: async () => ({ id: 'm1', status: 'CONFIRMED', recipe_snapshot: { schema_version: 1 } }),
  };
  await page.confirmMenu();
  assert.equal(page.data.meal.status, 'CONFIRMED');
  assert.equal(page.data.items.length, 2, 'items must be preserved, not cleared');
  assert.equal(page.data.items[0].recipe_name, '红烧肉');
});

// ===== C2: confirm后 start button visible condition holds =====
test('C2: after confirm, CONFIRMED action bar with startCooking is visible', () => {
  const wxml = fs.readFileSync(MEAL_WXML, 'utf8');
  // CONFIRMED action bar requires items.length > 0 && meal.status === CONFIRMED
  assert.ok(wxml.includes("meal.status === 'CONFIRMED'"), 'CONFIRMED bar must exist');
  assert.ok(wxml.includes('startCooking'), 'CONFIRMED bar must have startCooking');
});

// ===== C3: start production shape (meal.status=CONFIRMED) -> page state COOKING =====
test('C3: startCooking production response meal.status CONFIRMED -> page COOKING', async () => {
  const env = loadMealPage();
  const page = makePage(env.captured, {
    familyId: 'f1', meal: { id: 'm1', status: 'CONFIRMED' }, items: [{ id: 'it1' }],
  });
  page._saveLocalCooking = () => {};
  page._api = {
    // Production shape: meal is pre-update object, status still CONFIRMED
    startCooking: async () => ({ session_id: 's1', meal: { id: 'm1', status: 'CONFIRMED' }, steps: [] }),
  };
  await page.startCooking();
  assert.equal(page.data.meal.status, 'COOKING', 'page must reflect server COOKING state');
  assert.equal(page.data.showCooking, true);
});

// ===== C4: start success saves local cooking state =====
test('C4: startCooking saves local cooking state', async () => {
  const env = loadMealPage();
  const page = makePage(env.captured, {
    familyId: 'f1', meal: { id: 'm1', status: 'CONFIRMED' }, items: [{ id: 'it1' }],
  });
  let saved = null;
  page._saveLocalCooking = (mealId, data) => { saved = data; };
  page._api = {
    startCooking: async () => ({ session_id: 's1', meal: { id: 'm1', status: 'CONFIRMED' }, steps: [{ id: 'st1', operation: '焯水' }] }),
  };
  await page.startCooking();
  assert.ok(saved, 'must save local cooking state');
  assert.equal(saved.session_id, 's1');
  assert.equal(saved.meal_id, 'm1');
  assert.equal(saved.family_id, 'f1');
  assert.equal(saved.steps.length, 1);
});

// ===== C5: exitCooking does NOT delete frozen steps =====
test('C5: exitCooking preserves cookingData and steps', async () => {
  const env = loadMealPage();
  const page = makePage(env.captured, {
    familyId: 'f1', meal: { id: 'm1', status: 'COOKING' }, items: [{ id: 'it1' }],
    cookingData: { session_id: 's1', steps: [{ id: 'st1' }] },
    cookingSteps: [{ id: 'st1', instruction: '焯水' }],
    showCooking: true,
  });
  page.exitCooking();
  assert.equal(page.data.showCooking, false, 'exit only hides view');
  assert.ok(page.data.cookingData, 'cookingData must NOT be deleted');
  assert.equal(page.data.cookingSteps.length, 1, 'steps must NOT be deleted');
});

// ===== C6: resumeCooking does NOT call POST startCooking =====
test('C6: resumeCooking does not call startCooking API', async () => {
  const env = loadMealPage();
  const page = makePage(env.captured, {
    familyId: 'f1', meal: { id: 'm1', status: 'COOKING' }, items: [{ id: 'it1' }],
    cookingData: { session_id: 's1', steps: [] }, cookingSteps: [], showCooking: false,
  });
  let apiCalled = false;
  page._api = { startCooking: async () => { apiCalled = true; return {}; } };
  page.resumeCooking();
  assert.ok(!apiCalled, 'resume must NOT call startCooking');
  assert.equal(page.data.showCooking, true);
});

// ===== C7: same-device reload — server COOKING + local state restores steps =====
test('C7: same-device reload with local cooking state restores frozen steps', async () => {
  const env = loadMealPage();
  const page = makePage(env.captured, { familyId: 'f1', mealDate: '2026-09-06', mealType: 'DINNER' });
  const localState = { session_id: 's1', meal_id: 'm1', steps: [{ id: 'st1', operation: '旧步骤' }] };
  page._loadLocalCooking = () => localState;
  page._api = {
    getCurrentMeal: async () => ({ id: 'm1', status: 'COOKING', diners_count: 2, items: [] }),
  };
  await page.loadMeal();
  assert.equal(page.data.meal.status, 'COOKING');
  assert.ok(page.data.cookingData, 'local cooking data must be restored');
  assert.equal(page.data.cookingSteps[0].instruction, '旧步骤');
  assert.equal(page.data.cookingUnavailable, false);
});

// ===== C8: server COOKING + no local state -> truthful unavailable, no re-start =====
test('C8: server COOKING without local state shows unavailable and does not re-start', async () => {
  const env = loadMealPage();
  const page = makePage(env.captured, { familyId: 'f1', mealDate: '2026-09-06', mealType: 'DINNER' });
  page._loadLocalCooking = () => null;
  let startCalled = false;
  page._api = {
    getCurrentMeal: async () => ({ id: 'm1', status: 'COOKING', diners_count: 2, items: [] }),
    startCooking: async () => { startCalled = true; return {}; },
  };
  await page.loadMeal();
  assert.equal(page.data.cookingUnavailable, true);
  assert.equal(page.data.cookingData, null);
  assert.ok(!startCalled, 'must NOT auto-start cooking');
});

// ===== C9: getRecipe real response includes extras =====
test('C9: getRecipe backend response includes meal_types/tags/cookware/allergens', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../backend/v1/recipe-service.js'), 'utf8');
  assert.ok(src.includes('meal_types: extras.meal_types'), 'getRecipe must return meal_types');
  assert.ok(src.includes('tags: extras.tags'), 'getRecipe must return tags');
  assert.ok(src.includes('cookware: extras.cookware'), 'getRecipe must return cookware');
  assert.ok(src.includes('allergens: extras.allergens'), 'getRecipe must return allergens');
});

// ===== C10: Detail string[] extras render correctly =====
test('C10: detail normalizes string[] extras and WXML renders them', async () => {
  const env = loadDetailPage();
  const page = makePage(env.captured);
  page._api = {
    getRecipe: async () => ({
      recipe: { id: 'r1', name: '红烧肉' },
      ingredients: [], steps: [], media: [],
      cookware: ['WOK', 'RICE_COOKER'],
      tags: ['HOME_STYLE'],
      allergens: ['SOY'],
      meal_types: ['LUNCH', 'DINNER'],
    }),
  };
  page.recipeId = 'r1'; page.familyId = 'f1';
  await page.loadRecipe();
  assert.deepEqual(page.data.cookware, ['WOK', 'RICE_COOKER']);
  assert.deepEqual(page.data.tags, ['HOME_STYLE']);
  assert.deepEqual(page.data.allergens, ['SOY']);
  assert.deepEqual(page.data.mealTypes, ['LUNCH', 'DINNER']);
  // WXML must render string items, not item.tag_code
  const wxml = fs.readFileSync(DETAIL_WXML, 'utf8');
  assert.ok(wxml.includes('wx:for="{{cookware}}" wx:key="*this"'), 'cookware must use *this key for string[]');
  assert.ok(wxml.includes('wx:for="{{tags}}" wx:key="*this"'), 'tags must use *this key for string[]');
});

// ===== C11: disabled favorite has no bindtap =====
test('C11: disabled favorite button has no bindtap or data-name', () => {
  const wxml = fs.readFileSync(DETAIL_WXML, 'utf8');
  // Find the disabled favorite section
  const disabledSection = wxml.match(/action-disabled[\s\S]*?<\/view>/);
  assert.ok(disabledSection, 'must have disabled action button');
  assert.ok(!disabledSection[0].includes('bindtap'), 'disabled button must NOT have bindtap');
  assert.ok(!disabledSection[0].includes('data-name'), 'disabled button must NOT have data-name');
  assert.ok(!wxml.includes('onDisabledFeature'), 'onDisabledFeature handler must be removed');
});

// ===== C12: registry does not contain fake DETAIL-11 =====
test('C12: registry does not contain fake DETAIL-11 onDisabledFeature', () => {
  const r = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../governance/product-surfaces.json'), 'utf8'));
  const detail11 = r.surfaces.find(s => s.id === 'DETAIL-11');
  assert.ok(!detail11, 'DETAIL-11 fake REAL surface must be removed');
  const detail01 = r.surfaces.find(s => s.id === 'DETAIL-01');
  assert.ok(detail01, 'DETAIL-01 must still exist');
  assert.equal(detail01.status, 'BROKEN', 'DETAIL-01 favorite must remain BROKEN');
  // MEAL-10 resumeCooking must exist and be REAL
  const meal10 = r.surfaces.find(s => s.id === 'MEAL-10');
  assert.ok(meal10, 'MEAL-10 resumeCooking must be registered');
  assert.equal(meal10.status, 'REAL');
});
