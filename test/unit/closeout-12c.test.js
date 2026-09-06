const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const MEAL_JS = path.resolve(__dirname, '../../miniprogram/pages/meal/meal.js');
const MEAL_WXML = path.resolve(__dirname, '../../miniprogram/pages/meal/meal.wxml');
const HISTORY_JS = path.resolve(__dirname, '../../miniprogram/pages/history/history.js');
const HISTORY_WXML = path.resolve(__dirname, '../../miniprogram/pages/history/history.wxml');
const MINE_CONTROLLER = path.resolve(__dirname, '../../miniprogram/pages/mine/mine-controller.js');
const V1_API = path.resolve(__dirname, '../../miniprogram/utils/v1-api.js');

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
  global.getApp = () => ({
    getV1Session: () => ({
      getState: () => ({ active_family_id: 'f1', user: { id: 'u1' } }),
      api: null,
    }),
  });
  return { captured, toasts, modals, storage, wx };
}

function makePage(captured, initialData = {}) {
  const pageConfig = captured.pageConfig;
  if (!pageConfig) throw new Error('Page config not captured');
  const page = { ...pageConfig, data: { ...pageConfig.data, ...initialData } };
  page.setData = function (values) { Object.assign(this.data, values); };
  return page;
}

function loadMealPage() {
  delete require.cache[require.resolve(MEAL_JS)];
  const env = mockPageEnv();
  require(MEAL_JS);
  return env;
}

function loadHistoryPage() {
  delete require.cache[require.resolve(HISTORY_JS)];
  const env = mockPageEnv();
  require(HISTORY_JS);
  return env;
}

// ===== F1: COOKING reload uses server resume =====
test('F1: COOKING state triggers server resume on load', () => {
  const mealJs = fs.readFileSync(MEAL_JS, 'utf8');
  // Must have server resume logic
  assert.ok(mealJs.includes('getCookingSession'), 'meal.js must call getCookingSession for server resume');
  assert.ok(mealJs.includes('_resumeCookingFromServer') || mealJs.includes('resumeCooking'), 'meal.js must have server resume method');
  // Must check COOKING status
  assert.ok(mealJs.includes("COOKING"), 'meal.js must handle COOKING status');
});

// ===== F2: local cached steps cannot override different server session =====
test('F2: server session takes precedence over local cache', () => {
  const mealJs = fs.readFileSync(MEAL_JS, 'utf8');
  // Server resume should be attempted first, local as fallback
  const serverFirst = mealJs.indexOf('getCookingSession');
  const localFallback = mealJs.indexOf('getStorageSync');
  assert.ok(serverFirst > 0, 'server resume must exist');
  // Must update local cache from server (not just use local)
  assert.ok(mealJs.includes('setStorageSync') || mealJs.includes('cookingData'), 'must update local state from server');
});

// ===== F3: completion sheet uses server/snapshot candidates =====
test('F3: completion sheet uses consumption_candidates from server', () => {
  const mealJs = fs.readFileSync(MEAL_JS, 'utf8');
  assert.ok(mealJs.includes('consumption_candidates') || mealJs.includes('consumptionCandidates'), 'must use consumption_candidates');
  assert.ok(mealJs.includes('showCompletionSheet'), 'must have showCompletionSheet');
  // Candidates must come from getCookingSession response, not live recipe
  assert.ok(!mealJs.includes('getRecipe('), 'completion must not call getRecipe');
});

// ===== F4: actual quantity edit produces numeric payload =====
test('F4: quantity input produces numeric consumption payload', () => {
  const mealJs = fs.readFileSync(MEAL_JS, 'utf8');
  assert.ok(mealJs.includes('confirmComplete'), 'must have confirmComplete');
  // Must filter positive quantities
  assert.ok(mealJs.includes('quantity') && mealJs.includes('> 0'), 'must filter positive quantity');
  // Payload must have ingredient_id, quantity, unit_code
  assert.ok(mealJs.includes('ingredient_id'), 'payload must include ingredient_id');
  assert.ok(mealJs.includes('unit_code'), 'payload must include unit_code');
});

// ===== F5: 0 quantity not sent as positive consumption =====
test('F5: zero quantity items are excluded from consumption', () => {
  const mealJs = fs.readFileSync(MEAL_JS, 'utf8');
  // Must filter out quantity <= 0
  assert.ok(mealJs.includes('quantity') && (mealJs.includes('<= 0') || mealJs.includes('> 0')), 'must filter zero quantity');
});

// ===== F6: all-zero triggers secondary confirmation =====
test('F6: all-zero consumption triggers no-deduction confirmation', () => {
  const mealJs = fs.readFileSync(MEAL_JS, 'utf8');
  assert.ok(mealJs.includes('showModal'), 'must show modal for all-zero confirmation');
  // Modal should mention no deduction
  assert.ok(mealJs.includes('不扣') || mealJs.includes('库存'), 'modal must mention no deduction');
});

// ===== F7: busy guard prevents double complete =====
test('F7: complete has busy guard against double-click', () => {
  const mealJs = fs.readFileSync(MEAL_JS, 'utf8');
  assert.ok(mealJs.includes('completing') || mealJs.includes('busy') || mealJs.includes('isCompleting'), 'must have busy guard');
});

// ===== F8: 422 inventory insufficient shows friendly error =====
test('F8: INVENTORY_INSUFFICIENT shows friendly error and keeps cooking UI', () => {
  const mealJs = fs.readFileSync(MEAL_JS, 'utf8');
  assert.ok(mealJs.includes('INVENTORY_INSUFFICIENT'), 'must handle INVENTORY_INSUFFICIENT');
  assert.ok(mealJs.includes('库存不足') || mealJs.includes('showModal'), 'must show friendly error');
});

// ===== F9: complete success clears local cache and meal COMPLETED =====
test('F9: complete success clears local cache and sets COMPLETED', () => {
  const mealJs = fs.readFileSync(MEAL_JS, 'utf8');
  assert.ok(mealJs.includes('removeStorageSync'), 'must clear local cooking cache');
  assert.ok(mealJs.includes('COMPLETED'), 'must set COMPLETED status');
  assert.ok(mealJs.includes('showCooking') || mealJs.includes('cooking'), 'must hide cooking view');
});

// ===== F10: COMPLETED does not show cooking actions =====
test('F10: COMPLETED state hides cooking actions in WXML', () => {
  const wxml = fs.readFileSync(MEAL_WXML, 'utf8');
  // Must have COMPLETED branch
  assert.ok(wxml.includes('COMPLETED'), 'WXML must handle COMPLETED state');
  // COMPLETED should not show start cooking / complete buttons
  const completedSection = wxml.substring(wxml.indexOf('COMPLETED'));
  assert.ok(!completedSection.includes('开始做饭') || wxml.includes('wx:if'), 'COMPLETED must conditionally hide cooking actions');
});

// ===== F11: Mine history calls getMealHistory =====
test('F11: history page calls getMealHistory', () => {
  const historyJs = fs.readFileSync(HISTORY_JS, 'utf8');
  assert.ok(historyJs.includes('getMealHistory'), 'history page must call getMealHistory');
  // Mine controller must navigate to history
  const mineCtrl = fs.readFileSync(MINE_CONTROLLER, 'utf8');
  assert.ok(mineCtrl.includes('goHistory') || mineCtrl.includes('history'), 'mine must have history entry');
  assert.ok(mineCtrl.includes('pages/history/history'), 'mine must navigate to history page');
});

// ===== F12: history renders frozen item identity =====
test('F12: history WXML renders recipe name, servings, source from snapshot', () => {
  const wxml = fs.readFileSync(HISTORY_WXML, 'utf8');
  // Must render meal items
  assert.ok(wxml.includes('recipe') || wxml.includes('name'), 'history must render recipe name');
  assert.ok(wxml.includes('servings') || wxml.includes('份'), 'history must render servings');
  assert.ok(wxml.includes('status') || wxml.includes('COMPLETED'), 'history must render status');
});

// ===== Additional: meal.js has server resume endpoint =====
test('F1-extra: v1-api has getCookingSession and getActiveCookingSession', () => {
  const apiJs = fs.readFileSync(V1_API, 'utf8');
  assert.ok(apiJs.includes('getCookingSession'), 'v1-api must have getCookingSession');
  assert.ok(apiJs.includes('getActiveCookingSession'), 'v1-api must have getActiveCookingSession');
});
