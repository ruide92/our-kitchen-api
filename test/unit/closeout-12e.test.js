const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const RANDOM_JS = path.resolve(__dirname, '../../miniprogram/pages/random/random.js');
const RANDOM_WXML = path.resolve(__dirname, '../../miniprogram/pages/random/random.wxml');
const INDEX_JS = path.resolve(__dirname, '../../miniprogram/pages/index/index.js');
const FRIDGE_JS = path.resolve(__dirname, '../../miniprogram/pages/fridge/fridge.js');
const FRIDGE_WXML = path.resolve(__dirname, '../../miniprogram/pages/fridge/fridge.wxml');
const V1_API = path.resolve(__dirname, '../../miniprogram/utils/v1-api.js');

function mockPageEnv(extraWx = {}) {
  const captured = { pageConfig: null };
  global.Page = (config) => { captured.pageConfig = config; };
  const toasts = [];
  const storage = {};
  const wx = {
    showToast: (o) => toasts.push(o.title),
    showLoading: () => {},
    hideLoading: () => {},
    setStorageSync: (k, v) => { storage[k] = v; },
    getStorageSync: (k) => storage[k],
    removeStorageSync: (k) => { delete storage[k]; },
    switchTab: (o) => { storage.__switchTab = o.url; },
    navigateTo: (o) => { storage.__navigateTo = o.url; },
    redirectTo: (o) => { storage.__redirectTo = o.url; },
    getTabBar: () => null,
    ...extraWx,
  };
  global.wx = wx;
  return { captured, toasts, storage, wx };
}

function makePage(captured, initialData = {}) {
  const pageConfig = captured.pageConfig;
  if (!pageConfig) throw new Error('Page config not captured');
  const page = { ...pageConfig, data: { ...pageConfig.data, ...initialData } };
  page.setData = function (values) { Object.assign(this.data, values); };
  return page;
}

function loadPage(filePath) {
  delete require.cache[require.resolve(filePath)];
  const env = mockPageEnv();
  require(filePath);
  return env;
}

// U1: random page no legacy api import
test('U1 random page has no legacy utils/api import', () => {
  const src = fs.readFileSync(RANDOM_JS, 'utf8');
  assert.ok(!src.includes("require('../../utils/api.js')"), 'random.js must not import legacy api');
  assert.ok(src.includes('createV1Api'), 'random.js must use createV1Api');
});

// U2: random load calls generateRandomMeal V1
test('U2 random generate calls V1 generateRandomMeal', async () => {
  const env = loadPage(RANDOM_JS);
  const page = makePage(env.captured, { familyId: 'f1', mealDate: '2026-09-10', mealType: 'DINNER', dinersCount: 2, mode: 'BALANCED', targetCount: 2 });
  let called = false;
  page._api = {
    generateRandomMeal: async (fid, data) => {
      called = true;
      assert.equal(fid, 'f1');
      assert.equal(data.meal_type, 'DINNER');
      assert.equal(data.mode, 'BALANCED');
      return { recipes: [], warnings: [] };
    }
  };
  await page.generate();
  assert.ok(called);
});

// U3: three valid modes
test('U3 random supports BALANCED USE_INVENTORY TRY_DIFFERENT', () => {
  const env = loadPage(RANDOM_JS);
  const page = makePage(env.captured);
  for (const mode of ['BALANCED', 'USE_INVENTORY', 'TRY_DIFFERENT']) {
    page.setMode({ currentTarget: { dataset: { mode } } });
    assert.equal(page.data.mode, mode);
  }
});

// U4: lock after regenerate preserves locked ids
test('U4 locked ids preserved on regenerate', async () => {
  const env = loadPage(RANDOM_JS);
  const page = makePage(env.captured, { familyId: 'f1', mealDate: '2026-09-10', mealType: 'DINNER', dinersCount: 2, mode: 'BALANCED', targetCount: 2 });
  page.toggleLock({ currentTarget: { dataset: { id: 'r1' } } });
  assert.deepEqual(page.data.lockedIds, ['r1']);
  let passedLocked = null;
  page._api = {
    generateRandomMeal: async (fid, data) => {
      passedLocked = data.locked_recipe_ids;
      return { recipes: [{ id: 'r1', name: 'A', reasons: [] }], warnings: [] };
    }
  };
  await page.generate();
  assert.deepEqual(passedLocked, ['r1']);
});

// U5: busy/stale guard
test('U5 busy guard prevents concurrent generate', async () => {
  const env = loadPage(RANDOM_JS);
  const page = makePage(env.captured, { familyId: 'f1', mealDate: '2026-09-10', mealType: 'DINNER', dinersCount: 2, mode: 'BALANCED', targetCount: 2 });
  let callCount = 0;
  page._api = {
    generateRandomMeal: async () => {
      callCount++;
      await new Promise(r => setTimeout(r, 50));
      return { recipes: [], warnings: [] };
    }
  };
  page.generate();
  page.generate(); // should be blocked by busy
  await new Promise(r => setTimeout(r, 100));
  assert.equal(callCount, 1);
});

// U6: error != empty
test('U6 API error sets error not empty', async () => {
  const env = loadPage(RANDOM_JS);
  const page = makePage(env.captured, { familyId: 'f1', mealDate: '2026-09-10', mealType: 'DINNER', dinersCount: 2, mode: 'BALANCED', targetCount: 2 });
  page._api = { generateRandomMeal: async () => { throw new Error('network fail'); } };
  await page.generate();
  assert.ok(page.data.error);
  assert.equal(page.data.isEmpty, false);
});

// U7: eatThese calls addMealItem source=RANDOM
test('U7 eatThese calls addMealItem with source RANDOM', async () => {
  const env = loadPage(RANDOM_JS);
  const page = makePage(env.captured, { familyId: 'f1', mealDate: '2026-09-10', mealType: 'DINNER', dinersCount: 2, mode: 'BALANCED', targetCount: 2, recipes: [{ id: 'r1', name: 'A' }] });
  const added = [];
  page._api = {
    ensureCurrentMeal: async () => ({ id: 'm1' }),
    addMealItem: async (fid, mid, data) => { added.push(data); return {}; }
  };
  await page.eatThese();
  assert.equal(added.length, 1);
  assert.equal(added[0].source, 'RANDOM');
  assert.equal(added[0].recipe_id, 'r1');
});

// U8: partial failure not谎报全部成功
test('U8 partial add failure does not claim all success', async () => {
  const env = loadPage(RANDOM_JS);
  const page = makePage(env.captured, { familyId: 'f1', mealDate: '2026-09-10', mealType: 'DINNER', dinersCount: 2, mode: 'BALANCED', targetCount: 2, recipes: [{ id: 'r1' }, { id: 'r2' }] });
  page._api = {
    ensureCurrentMeal: async () => ({ id: 'm1' }),
    addMealItem: async (fid, mid, data) => {
      if (data.recipe_id === 'r2') throw new Error('fail');
      return {};
    }
  };
  await page.eatThese();
  assert.ok(env.toasts.some(t => t.includes('失败')));
});

// U9: success navigates to Meal
test('U9 eatThese success navigates to meal page', async () => {
  const env = loadPage(RANDOM_JS);
  const page = makePage(env.captured, { familyId: 'f1', mealDate: '2026-09-10', mealType: 'DINNER', dinersCount: 2, mode: 'BALANCED', targetCount: 2, recipes: [{ id: 'r1' }] });
  page._api = {
    ensureCurrentMeal: async () => ({ id: 'm1' }),
    addMealItem: async () => ({})
  };
  await page.eatThese();
  await new Promise(r => setTimeout(r, 900));
  assert.ok(env.storage.__redirectTo && env.storage.__redirectTo.includes('/pages/meal/meal'));
});

// U10: result click → Detail
test('U10 random result click navigates to detail', () => {
  const env = loadPage(RANDOM_JS);
  const page = makePage(env.captured);
  page.goDetail({ currentTarget: { dataset: { id: 'r1' } } });
  assert.ok(env.storage.__navigateTo && env.storage.__navigateTo.includes('/pages/detail/detail?id=r1'));
});

// U11: HOME-03 real random navigation
test('U11 HOME-03 goRandom navigates to random page', () => {
  const env = loadPage(INDEX_JS);
  const page = makePage(env.captured);
  env.storage['v1_meal_target'] = { meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2 };
  page.goRandom();
  assert.ok(env.storage.__navigateTo && env.storage.__navigateTo.includes('/pages/random/random'));
});

// U12: HOME-06 diners_count=1
test('U12 HOME-06 goOnePerson passes diners_count=1', () => {
  const env = loadPage(INDEX_JS);
  const page = makePage(env.captured);
  env.storage['v1_meal_target'] = { meal_date: '2026-09-10', meal_type: 'DINNER', diners_count: 2 };
  page.goOnePerson();
  assert.ok(env.storage.__navigateTo && env.storage.__navigateTo.includes('diners_count=1'));
});

// U13: HOME-04 sets COOK intent
test('U13 HOME-04 goFridgeCook sets COOK intent and switches tab', () => {
  const env = loadPage(INDEX_JS);
  const page = makePage(env.captured);
  page.goFridgeCook();
  assert.equal(env.storage['v1_fridge_intent'], 'COOK');
  assert.ok(env.storage.__switchTab && env.storage.__switchTab.includes('/pages/fridge/fridge'));
});

// U14: Fridge onShow consumes COOK intent
test('U14 fridge onShow consumes COOK intent', async () => {
  const env = loadPage(FRIDGE_JS);
  const page = makePage(env.captured);
  env.storage['v1_fridge_intent'] = 'COOK';
  env.storage['v1_active_family_id'] = 'f1';
  page._api = { getFridgeCooking: async () => [], listFridge: async () => [], listPantry: async () => [] };
  page.onShow();
  await new Promise(r => setTimeout(r, 50));
  assert.equal(env.storage['v1_fridge_intent'], undefined);
  assert.equal(page.data.showCookSheet, true);
});

// U15: FRIDGE-08 calls getFridgeCooking
test('U15 cookWithFridge calls V1 getFridgeCooking', async () => {
  const env = loadPage(FRIDGE_JS);
  const page = makePage(env.captured);
  page._familyId = 'f1';
  let called = false;
  page._api = { getFridgeCooking: async (fid) => { called = true; assert.equal(fid, 'f1'); return []; } };
  await page.cookWithFridge();
  assert.ok(called);
  assert.equal(page.data.showCookSheet, true);
});

// U16: fridge recommendation error != empty
test('U16 fridge cook error sets error not empty', async () => {
  const env = loadPage(FRIDGE_JS);
  const page = makePage(env.captured);
  page._familyId = 'f1';
  page._api = { getFridgeCooking: async () => { throw new Error('fail'); } };
  await page.cookWithFridge();
  assert.ok(page.data.cookError);
  assert.equal(page.data.cookRecipes.length, 0);
});

// U17: fridge recommendation click → Detail
test('U17 fridge cook recipe click navigates to detail', () => {
  const env = loadPage(FRIDGE_JS);
  const page = makePage(env.captured, { showCookSheet: true });
  page.cookGoDetail({ currentTarget: { dataset: { id: 'r1' } } });
  assert.ok(env.storage.__navigateTo && env.storage.__navigateTo.includes('/pages/detail/detail?id=r1'));
});

// U18: overlay closes and tabbar restores
test('U18 closeCookSheet hides overlay and unlocks tabbar', () => {
  const env = loadPage(FRIDGE_JS);
  const page = makePage(env.captured, { showCookSheet: true });
  let unlocked = false;
  page._unlockTabBar = () => { unlocked = true; };
  page.closeCookSheet();
  assert.equal(page.data.showCookSheet, false);
  assert.ok(unlocked);
});

// U19: random busy/mode consistency — busy时setMode不改变UI mode
test('U19 random busy prevents mode change and stale response', async () => {
  const env = loadPage(RANDOM_JS);
  const page = makePage(env.captured, { familyId: 'f1', mealDate: '2026-09-10', mealType: 'DINNER', dinersCount: 2, mode: 'BALANCED', targetCount: 3 });
  page._api = { generateRandomMeal: async () => new Promise(resolve => setTimeout(() => resolve({ recipes: [], warnings: [] }), 50)) };
  // Start generate (sets busy=true)
  page.generate();
  assert.equal(page.data.busy, true);
  assert.equal(page.data.mode, 'BALANCED');
  // Try to change mode while busy
  page.setMode({ currentTarget: { dataset: { mode: 'USE_INVENTORY' } } });
  // Mode should NOT change while busy
  assert.equal(page.data.mode, 'BALANCED', 'mode should not change while busy');
  // Wait for generate to complete
  await new Promise(r => setTimeout(r, 100));
  assert.equal(page.data.busy, false);
});

// U20: fridge add to meal uses createMealTarget with valid date/type/diners
test('U20 fridge cookAddToMeal uses shared meal target not empty fallback', async () => {
  const env = loadPage(FRIDGE_JS);
  const page = makePage(env.captured, { cookRecipes: [{ id: 'r1', name: 'test' }] });
  page._familyId = 'f1';
  // No v1_meal_target in storage — createMealTarget should generate defaults
  let ensureArgs = null;
  let addArgs = null;
  page._api = {
    ensureCurrentMeal: async (fid, args) => { ensureArgs = args; return { id: 'm1' }; },
    addMealItem: async (fid, mid, args) => { addArgs = args; return {}; }
  };
  await page.cookAddToMeal({ currentTarget: { dataset: { id: 'r1' } } });
  assert.ok(ensureArgs, 'ensureCurrentMeal should be called');
  assert.ok(ensureArgs.meal_date && ensureArgs.meal_date.length >= 8, 'meal_date should be valid YYYY-MM-DD, got ' + ensureArgs.meal_date);
  assert.ok(['BREAKFAST', 'LUNCH', 'DINNER'].includes(ensureArgs.meal_type), 'meal_type should be valid');
  assert.ok(ensureArgs.diners_count >= 1, 'diners_count should be >= 1');
});

// WXML checks
test('random.wxml uses V1 data fields not legacy', () => {
  const wxml = fs.readFileSync(RANDOM_WXML, 'utf8');
  assert.ok(!wxml.includes('api.getRandomMenu'), 'no legacy API call in wxml');
  assert.ok(wxml.includes('bindtap="generate"'), 'has generate handler');
  assert.ok(wxml.includes('bindtap="eatThese"'), 'has eatThese handler');
  assert.ok(wxml.includes('toggleLock'), 'has toggleLock handler');
});

test('fridge.wxml has cook overlay with data-surface-id', () => {
  const wxml = fs.readFileSync(FRIDGE_WXML, 'utf8');
  assert.ok(wxml.includes('FRIDGE-OVERLAY-04'), 'cook overlay registered');
  assert.ok(wxml.includes('cookWithFridge'), 'cookWithFridge handler');
  assert.ok(wxml.includes('closeCookSheet'), 'closeCookSheet handler');
});
