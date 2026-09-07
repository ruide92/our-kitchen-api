const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const INDEX_JS = path.resolve(__dirname, '../../miniprogram/pages/index/index.js');
const INDEX_WXML = path.resolve(__dirname, '../../miniprogram/pages/index/index.wxml');
const RANDOM_JS = path.resolve(__dirname, '../../miniprogram/pages/random/random.js');
const FRIDGE_JS = path.resolve(__dirname, '../../miniprogram/pages/fridge/fridge.js');

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

// PA1: 首页本周菜谱卡片点击 → navigateTo detail?id=recipe_id
test('PA1 index weekly dish card click navigates to detail', () => {
  const env = loadPage(INDEX_JS);
  const page = makePage(env.captured);
  page.goDishDetail({ currentTarget: { dataset: { id: 'recipe-abc' } } });
  assert.equal(env.storage.__navigateTo, '/pages/detail/detail?id=recipe-abc');
});

// PA2: 首页已点菜单卡片点击 → navigateTo detail?id=recipe_id
test('PA2 index ordered meal card click navigates to detail', () => {
  const env = loadPage(INDEX_JS);
  const page = makePage(env.captured);
  page.goDishDetail({ currentTarget: { dataset: { id: 'dish-123' } } });
  assert.equal(env.storage.__navigateTo, '/pages/detail/detail?id=dish-123');
});

// PA3: random 页 goDetail 前调用 mealTarget.update
test('PA3 random goDetail updates mealTarget before navigate', () => {
  const env = loadPage(RANDOM_JS);
  const page = makePage(env.captured, {
    familyId: 'f1', mealDate: '2026-09-10', mealType: 'LUNCH', dinersCount: 3
  });
  let updateCalled = null;
  page._mealTarget = {
    update: (data) => { updateCalled = data; return data; }
  };
  page.goDetail({ currentTarget: { dataset: { id: 'r-1' } } });
  assert.ok(updateCalled, 'mealTarget.update must be called');
  assert.equal(updateCalled.meal_date, '2026-09-10');
  assert.equal(updateCalled.meal_type, 'LUNCH');
  assert.equal(updateCalled.diners_count, 3);
});

// PA4: random 页 goDetail 后 navigateTo detail
test('PA4 random goDetail navigates to detail page', () => {
  const env = loadPage(RANDOM_JS);
  const page = makePage(env.captured, {
    familyId: 'f1', mealDate: '2026-09-10', mealType: 'DINNER', dinersCount: 2
  });
  page._mealTarget = { update: (d) => d };
  page.goDetail({ currentTarget: { dataset: { id: 'recipe-xyz' } } });
  assert.equal(env.storage.__navigateTo, '/pages/detail/detail?id=recipe-xyz');
});

// PA5: 首页已点菜单有菜时显示"去确认"入口
test('PA5 index wxml shows confirm button when meal has items', () => {
  const wxml = fs.readFileSync(INDEX_WXML, 'utf8');
  assert.ok(wxml.includes('meal-action-row'), 'meal action row must exist');
  assert.ok(wxml.includes('去确认菜单'), 'confirm button text must exist');
  assert.ok(wxml.includes('开始做饭'), 'start cooking button text must exist');
  assert.ok(wxml.includes("currentMealStatus !== 'COMPLETED'"), 'must hide for completed meals');
});

// PA6: fridge cookAddToMeal 成功后 navigateTo meal page
test('PA6 fridge cookAddToMeal navigates to meal after success', async () => {
  const env = loadPage(FRIDGE_JS);
  const page = makePage(env.captured);
  page._familyId = 'f1';
  page.data.cookRecipes = [{ id: 'r1', name: '红烧肉' }];
  page.closeCookSheet = () => {};
  let addCalled = false;
  page._api = {
    ensureCurrentMeal: async () => ({ id: 'meal-1', meal: { id: 'meal-1' } }),
    addMealItem: async () => { addCalled = true; return {}; }
  };
  await page.cookAddToMeal({ currentTarget: { dataset: { id: 'r1' } } });
  assert.ok(addCalled, 'addMealItem must be called');
  // Wait for setTimeout navigation
  await new Promise(r => setTimeout(r, 800));
  assert.ok(env.storage.__navigateTo, 'must navigate to meal page');
  assert.ok(env.storage.__navigateTo.includes('/pages/meal/meal'), 'must navigate to meal page');
});

// PA7: index.js 不存在 goDetail placeholder 方法
test('PA7 index.js has no dead goDetail placeholder', () => {
  const src = fs.readFileSync(INDEX_JS, 'utf8');
  assert.ok(!src.includes('菜品详情真实数据接入后启用'), 'placeholder toast must be removed');
  assert.ok(!/goDetail\s*\(\s*\)\s*\{/.test(src), 'goDetail placeholder method must not exist');
  assert.ok(src.includes('goDishDetail'), 'goDishDetail must exist');
});

// PA8: 首页卡片点击使用正确的 recipe_id（不是 undefined）
test('PA8 index goDishDetail rejects undefined id', () => {
  const env = loadPage(INDEX_JS);
  const page = makePage(env.captured);
  // No id → should not navigate
  page.goDishDetail({ currentTarget: { dataset: {} } });
  assert.equal(env.storage.__navigateTo, undefined, 'must not navigate with undefined id');
  // With id → navigates
  page.goDishDetail({ currentTarget: { dataset: { id: 'valid-id' } } });
  assert.equal(env.storage.__navigateTo, '/pages/detail/detail?id=valid-id');
});
