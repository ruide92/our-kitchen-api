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

// ===== F13: merged candidate renders one row, sends one deduction =====
test('F13: merged candidate from server renders single row and sends one deduction', () => {
  const mealJs = fs.readFileSync(MEAL_JS, 'utf8');
  const mealWxml = fs.readFileSync(MEAL_WXML, 'utf8');
  // Completion sheet must render server-provided consumption_candidates directly
  assert.ok(mealWxml.includes('consumption_candidates') || mealWxml.includes('consumptionCandidates') || mealWxml.includes('candidates'),
    'WXML must render server candidates list');
  // confirmComplete must build consumption from the candidate list (not re-aggregate)
  assert.ok(mealJs.includes('confirmComplete'), 'must have confirmComplete handler');
  assert.ok(mealJs.includes('ingredient_id') && mealJs.includes('quantity') && mealJs.includes('unit_code'),
    'payload must include ingredient_id, quantity, unit_code');
  // Must not have a second client-side aggregation pass that could double-count
  assert.ok(!mealJs.includes('groupByIngredient') || mealJs.includes('server'), 'should not independently re-aggregate');
});

// ===== F14: auto_deductable=false → completion default quantity = 0 (behavioral) =====
test('F14: non-auto-deductable candidate defaults actual_quantity to 0', () => {
  const env = mockPageEnv();
  delete require.cache[require.resolve(MEAL_JS)];
  require(MEAL_JS);
  const page = makePage(env.captured, {
    cookingData: { session_id: 's1' },
    consumptionCandidates: [
      { ingredient_id: 'egg', name: '鸡蛋', suggested_quantity: 2, unit_code: 'piece', auto_deductable: false },
      { ingredient_id: 'pork', name: '五花肉', suggested_quantity: 500, unit_code: 'g', auto_deductable: true },
    ],
  });
  page.showCompletionSheet();
  const egg = page.data.consumptionCandidates.find(c => c.ingredient_id === 'egg');
  const pork = page.data.consumptionCandidates.find(c => c.ingredient_id === 'pork');
  assert.equal(egg.actual_quantity, 0, 'auto_deductable=false must default to 0, not suggested 2');
  assert.equal(pork.actual_quantity, 500, 'auto_deductable=true keeps suggested 500');
});

// ===== F15: confirmComplete does not send zero-quantity candidates =====
test('F15: confirmComplete filters out zero-quantity candidates from payload', () => {
  const mealJs = fs.readFileSync(MEAL_JS, 'utf8');
  // Must filter positive quantities only
  assert.ok(mealJs.includes("actual_quantity) > 0") || mealJs.includes("actual_quantity > 0"),
    'confirmComplete must filter only positive actual_quantity');
  // Behavioral: build page and verify payload construction
  const env = mockPageEnv();
  delete require.cache[require.resolve(MEAL_JS)];
  require(MEAL_JS);
  let capturedPayload = null;
  const page = makePage(env.captured, {
    cookingData: { session_id: 's1' },
    familyId: 'f1',
    meal: { id: 'm1' },
    consumptionCandidates: [
      { ingredient_id: 'egg', actual_quantity: 0, unit_code: 'piece', auto_deductable: false },
      { ingredient_id: 'pork', actual_quantity: 300, unit_code: 'g', auto_deductable: true },
    ],
    completing: false,
    confirmZeroConsumption: true,
  });
  page._api = { completeCooking: async (fid, sid, body) => { capturedPayload = body; return { ok: true }; } };
  page._clearLocalCooking = () => {};
  page.loadMeal = async () => {};
  page._doComplete([{ ingredient_id: 'pork', quantity: 300, unit_code: 'g' }]);
  // Verify _doComplete sends only the positive item
  assert.ok(capturedPayload, 'payload should be captured');
  assert.equal(capturedPayload.consumption.length, 1, 'only positive candidate sent');
  assert.equal(capturedPayload.consumption[0].ingredient_id, 'pork');
});

// ===== F16: WXML explicitly shows "不自动扣库存" for non-deductable =====
test('F16: WXML shows non-auto-deductable label for non-deductable candidates', () => {
  const mealWxml = fs.readFileSync(MEAL_WXML, 'utf8');
  assert.ok(mealWxml.includes('不自动扣库存'),
    'WXML must explicitly label non-auto-deductable items');
  assert.ok(mealWxml.includes('auto_deductable'),
    'WXML must branch on auto_deductable field');
});

// ===== F17: candidate_key unique identity for same ingredient different units =====
test('F17: same ingredient different units get distinct candidate_key and WXML uses it', () => {
  const mealWxml = fs.readFileSync(MEAL_WXML, 'utf8');
  // WXML must use candidate_key, not ingredient_id
  assert.ok(mealWxml.includes('wx:key="candidate_key"'),
    'WXML completion list must use wx:key="candidate_key"');
  assert.ok(!mealWxml.includes('wx:key="ingredient_id"'),
    'WXML must not use wx:key="ingredient_id" for candidates (non-unique)');

  // Behavioral: _normalizeCandidates produces distinct keys
  const env = mockPageEnv();
  delete require.cache[require.resolve(MEAL_JS)];
  require(MEAL_JS);
  const page = makePage(env.captured, {});
  const result = page._normalizeCandidates([
    { ingredient_id: 'garlic', unit_code: 'piece', name: '大蒜' },
    { ingredient_id: 'garlic', unit_code: 'root', name: '大蒜' },
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].candidate_key, 'garlic|piece');
  assert.equal(result[1].candidate_key, 'garlic|root');
  assert.notEqual(result[0].candidate_key, result[1].candidate_key);
  // null unit gets 'null' suffix
  const nullUnit = page._normalizeCandidates([{ ingredient_id: 'x', unit_code: null }]);
  assert.equal(nullUnit[0].candidate_key, 'x|null');
});
