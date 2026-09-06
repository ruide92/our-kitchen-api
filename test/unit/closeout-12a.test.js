const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createMinePage } = require('../../miniprogram/pages/mine/mine-controller');
const { validateSettingsPatch } = require('../../backend/v1/family-validation');

// ===== Mine harness =====
function mineHarness(initial = {}) {
  const base = { status: 'authenticated', user: { id: 'u', nickname: 'Tester' }, families: [{ id: 'f', name: 'Test Family', role: 'OWNER' }], active_family_id: 'f', activeFamily: { id: 'f', name: 'Test Family', role: 'OWNER', invite_code: 'CODE' }, members: [{ id: 'm', role: 'OWNER', user: { id: 'u', nickname: 'Tester' } }], settings: { family_id: 'f', version: 1, default_diners: 2, breakfast_target_count: 2, lunch_target_count: 2, dinner_target_count: 3, default_spiciness: 0, cookware: ['WOK'], random_default_mode: 'BALANCED', prefer_expiring_inventory: true, repeat_strong_days: 3, repeat_penalty_days: 7, repeat_recover_days: 14 }, hasFamily: true, familyStatus: 'ready' };
  let state = { ...base, ...initial };
  let listener;
  const actions = [];
  const toasts = [];
  const storage = {};
  const session = {
    subscribe(fn) { listener = fn; fn(state); return () => { listener = null; }; },
    getState: () => state,
    refresh: async () => state,
    updateSettings: async (data) => { actions.push(['updateSettings', data]); state = { ...state, settings: { ...state.settings, ...data, version: state.settings.version + 1 } }; return state; },
  };
  const app = { getV1Session: () => session, ensureSessionReady: async () => state, retryV1Session: async () => state };
  const wx = {
    showToast: (o) => toasts.push(o.title),
    setStorageSync: (k, v) => { storage[k] = v; },
    getStorageSync: (k) => storage[k],
    removeStorageSync: (k) => { delete storage[k]; },
    switchTab: (o) => { actions.push(['switchTab', o.url]); },
  };
  const page = createMinePage({ app, wxAdapter: wx });
  page.setData = (values) => {
    for (const [k, v] of Object.entries(values)) {
      if (k.includes('.')) {
        const parts = k.split('.');
        let obj = page.data;
        for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
        obj[parts[parts.length - 1]] = v;
      } else {
        page.data[k] = v;
      }
    }
  };
  page.getTabBar = () => ({ setData: () => {}, lockTabBar: () => { actions.push('lockTabBar'); }, unlockTabBar: () => { actions.push('unlockTabBar'); } });
  page.onLoad();
  return { page, actions, toasts, storage, session, app, publish(value) { state = value; if (listener) listener(state); } };
}

// ===== Fridge harness =====
function fridgeHarness() {
  const toasts = [];
  const apiCalls = [];
  const mockApi = {
    resolveIngredient: async (familyId, name) => { apiCalls.push(['resolveIngredient', name]); return { match: null, confidence: 0 }; },
    putPantry: async (familyId, ingredientId, payload) => { apiCalls.push(['putPantry', ingredientId, payload]); return {}; },
    putCustomPantry: async (familyId, payload) => { apiCalls.push(['putCustomPantry', payload]); return {}; },
    deletePantry: async (familyId, ingredientId) => { apiCalls.push(['deletePantry', ingredientId]); return {}; },
    deleteCustomPantry: async (familyId, name) => { apiCalls.push(['deleteCustomPantry', name]); return {}; },
    getPantry: async () => [],
  };
  // Mock global Page to capture config
  let pageConfig = null;
  global.Page = (config) => { pageConfig = config; };
  global.wx = {
    showToast: (o) => toasts.push(o.title),
    showLoading: () => {},
    hideLoading: () => {},
    setStorageSync: () => {},
    getStorageSync: () => null,
    removeStorageSync: () => {},
    switchTab: () => {},
    stopPullDownRefresh: () => {},
  };
  global.getApp = () => ({ getV1Session: () => ({ getState: () => ({ active_family_id: 'f' }) }) });
  // Clear require cache to get fresh page
  delete require.cache[require.resolve('../../miniprogram/pages/fridge/fridge.js')];
  require('../../miniprogram/pages/fridge/fridge.js');
  const page = { ...pageConfig, data: { ...pageConfig.data }, _familyId: 'f', _api: mockApi, _loadPantry: async () => {}, setData(values) { Object.assign(this.data, values); } };
  return { page, toasts, apiCalls, mockApi };
}

// ===== T1: default_spiciness=0 stays numeric =====
test('T1: server default_spiciness=0 opens as numeric 0, not NONE', () => {
  const h = mineHarness({ settings: { family_id: 'f', version: 1, default_diners: 2, breakfast_target_count: 2, lunch_target_count: 2, dinner_target_count: 3, default_spiciness: 0, cookware: [], random_default_mode: 'BALANCED', prefer_expiring_inventory: true, repeat_strong_days: 3, repeat_penalty_days: 7, repeat_recover_days: 14 } });
  h.page.openKitchenSettingsSheet();
  assert.equal(h.page.data.kitchenForm.default_spiciness, 0);
  assert.notEqual(h.page.data.kitchenForm.default_spiciness, 'NONE');
});

// ===== T2: spiciness selection produces number payload =====
test('T2: selecting spiciness produces numeric payload', async () => {
  const h = mineHarness();
  h.page.openKitchenSettingsSheet();
  h.page.onKitchenSpiciness({ currentTarget: { dataset: { value: '2' } } });
  assert.equal(typeof h.page.data.kitchenForm.default_spiciness, 'number');
  assert.equal(h.page.data.kitchenForm.default_spiciness, 2);
  await h.page.saveKitchenSettings();
  const updateCall = h.actions.find(a => Array.isArray(a) && a[0] === 'updateSettings');
  assert.ok(updateCall);
  assert.equal(typeof updateCall[1].default_spiciness, 'number');
  assert.ok(updateCall[1].default_spiciness >= 0 && updateCall[1].default_spiciness <= 5);
});

// ===== T3: full kitchenForm passes backend validateSettingsPatch =====
test('T3: full kitchenForm payload passes backend validateSettingsPatch', () => {
  const h = mineHarness();
  h.page.openKitchenSettingsSheet();
  const form = h.page.data.kitchenForm;
  const payload = { version: 1, ...form };
  // Should not throw
  const result = validateSettingsPatch(payload);
  assert.ok(result);
  assert.equal(typeof result.default_spiciness, 'number');
});

// ===== T4: diners=0 blocked by frontend validation =====
test('T4: default_diners=0 blocked by frontend validation', async () => {
  const h = mineHarness();
  h.page.openKitchenSettingsSheet();
  h.page.data.kitchenForm.default_diners = 0;
  await h.page.saveKitchenSettings();
  assert.ok(!h.actions.some(a => Array.isArray(a) && a[0] === 'updateSettings'));
  assert.ok(h.toasts.some(t => t.includes('人数') || t.includes('大于等于')));
});

// ===== T5: repeat strong > penalty blocked =====
test('T5: repeat strong > penalty blocked by frontend validation', async () => {
  const h = mineHarness();
  h.page.openKitchenSettingsSheet();
  h.page.data.kitchenForm.repeat_strong_days = 10;
  h.page.data.kitchenForm.repeat_penalty_days = 5;
  await h.page.saveKitchenSettings();
  assert.ok(!h.actions.some(a => Array.isArray(a) && a[0] === 'updateSettings'));
  assert.ok(h.toasts.some(t => t.includes('惩罚') || t.includes('强避')));
});

// ===== T6: VERSION_CONFLICT rebuilds kitchenForm from fresh server =====
test('T6: VERSION_CONFLICT rebuilds kitchenForm from fresh server settings', async () => {
  const h = mineHarness();
  h.page.openKitchenSettingsSheet();
  h.page.data.kitchenForm.default_diners = 99; // stale edit
  h.session.updateSettings = async () => { const e = new Error('conflict'); e.code = 'VERSION_CONFLICT'; e.status = 409; throw e; };
  const freshSettings = { family_id: 'f', version: 2, default_diners: 4, breakfast_target_count: 2, lunch_target_count: 2, dinner_target_count: 3, default_spiciness: 1, cookware: ['WOK'], random_default_mode: 'USE_INVENTORY', prefer_expiring_inventory: false, repeat_strong_days: 3, repeat_penalty_days: 7, repeat_recover_days: 14 };
  h.session.refresh = async () => { h.session.getState = () => ({ status: 'authenticated', active_family_id: 'f', activeFamily: { id: 'f', role: 'OWNER' }, settings: freshSettings }); return h.session.getState(); };
  await h.page.saveKitchenSettings();
  assert.equal(h.page.data.kitchenForm.default_diners, 4);
  assert.equal(h.page.data.kitchenForm.default_spiciness, 1);
  assert.equal(h.page.data.kitchenForm.random_default_mode, 'USE_INVENTORY');
  assert.ok(h.toasts.some(t => t.includes('刷新') || t.includes('最新')));
});

// ===== T7: MEMBER canEdit=false, save does not PATCH =====
test('T7: MEMBER canEditKitchenSettings=false and save does not PATCH', async () => {
  const h = mineHarness({ activeFamily: { id: 'f', name: 'Test', role: 'MEMBER', invite_code: 'C' } });
  assert.equal(h.page.data.canEditKitchenSettings, false);
  h.page.openKitchenSettingsSheet();
  await h.page.saveKitchenSettings();
  assert.ok(!h.actions.some(a => Array.isArray(a) && a[0] === 'updateSettings'));
});

// ===== T8: custom pantry "花椒" calls putCustomPantry =====
test('T8: custom pantry 花椒 calls putCustomPantry with correct payload', async () => {
  const f = fridgeHarness();
  f.page.data.newStapleName = '花椒';
  await f.page.saveAddStaple();
  const customCall = f.apiCalls.find(c => c[0] === 'putCustomPantry');
  assert.ok(customCall, 'putCustomPantry should be called');
  assert.equal(customCall[1].name, '花椒');
  assert.equal(customCall[1].assume_available, true);
});

// ===== T9: CUSTOM_PANTRY_EXISTS shows friendly toast =====
test('T9: CUSTOM_PANTRY_EXISTS shows friendly toast', async () => {
  const f = fridgeHarness();
  f.mockApi.putCustomPantry = async () => { const e = new Error('exists'); e.code = 'CUSTOM_PANTRY_EXISTS'; e.status = 409; throw e; };
  f.page.data.newStapleName = '花椒';
  await f.page.saveAddStaple();
  assert.ok(f.toasts.includes('这个常备食材已经添加过了'));
});

// ===== T10: custom delete uses deleteCustomPantry, canonical uses deletePantry =====
test('T10: custom delete uses deleteCustomPantry, canonical uses deletePantry', async () => {
  const f = fridgeHarness();
  // Custom (ingredient_id null)
  await f.page.removeStaple({ currentTarget: { dataset: { ingredientId: null, displayName: '花椒' } } });
  assert.ok(f.apiCalls.some(c => c[0] === 'deleteCustomPantry' && c[1] === '花椒'));
  // Canonical
  f.apiCalls.length = 0;
  await f.page.removeStaple({ currentTarget: { dataset: { ingredientId: 'ing-123', displayName: '盐' } } });
  assert.ok(f.apiCalls.some(c => c[0] === 'deletePantry' && c[1] === 'ing-123'));
});

// ===== T11: navigation intent consumed once =====
test('T11: fridge navigation intent consumed after onShow', () => {
  const storage = { 'v1_fridge_target_tab': 'pantry' };
  global.wx = {
    ...global.wx,
    getStorageSync: (k) => storage[k],
    removeStorageSync: (k) => { delete storage[k]; },
  };
  let pageConfig = null;
  global.Page = (config) => { pageConfig = config; };
  delete require.cache[require.resolve('../../miniprogram/pages/fridge/fridge.js')];
  require('../../miniprogram/pages/fridge/fridge.js');
  const page = { ...pageConfig, data: { ...pageConfig.data, activeTab: 'inventory' }, _familyId: 'f', _api: {}, _loadAll: async () => {}, setData(v) { Object.assign(this.data, v); } };
  page.onShow();
  assert.equal(page.data.activeTab, 'pantry');
  assert.equal(storage['v1_fridge_target_tab'], undefined);
});

// ===== T12: Pantry WXML uses wx:key="id" =====
test('T12: pantry WXML uses wx:key="id" not ingredient_id', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '..', '..', 'miniprogram', 'pages', 'fridge', 'fridge.wxml'), 'utf8');
  const pantrySection = wxml.substring(wxml.indexOf('pantryStaples'));
  assert.ok(pantrySection.includes('wx:key="id"'));
  assert.ok(!pantrySection.includes('wx:key="ingredient_id"'));
});

// ===== T13: Share disabled WXML branch has no bindtap/data-action/arrow =====
test('T13: share disabled WXML branch has no bindtap/data-action/menu-arrow', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '..', '..', 'miniprogram', 'pages', 'mine', 'mine.wxml'), 'utf8');
  // Find the disabled branch
  const disabledMatch = wxml.match(/wx:if="\{\{item\.disabled\}\}"[\s\S]*?<\/view>/);
  assert.ok(disabledMatch, 'disabled branch should exist');
  const disabledBranch = disabledMatch[0];
  assert.ok(!disabledBranch.includes('bindtap'), 'disabled branch should not have bindtap');
  assert.ok(!disabledBranch.includes('data-action'), 'disabled branch should not have data-action');
  assert.ok(!disabledBranch.includes('menu-arrow'), 'disabled branch should not have menu-arrow');
});

// ===== T14: Mine onHide clears sheet =====
test('T14: Mine onHide clears sheet and kitchenForm', () => {
  const h = mineHarness();
  h.page.openKitchenSettingsSheet();
  assert.equal(h.page.data.sheet, 'kitchen');
  h.page.onHide();
  assert.equal(h.page.data.sheet, '');
  assert.equal(h.page.data.kitchenForm, null);
});

// ===== T15: Fridge onHide clears all overlay sheets =====
test('T15: Fridge onHide clears all show*Sheet states', () => {
  const f = fridgeHarness();
  f.page.data.showAddSheet = true;
  f.page.data.showEditSheet = true;
  f.page.data.editingItem = { id: 'x' };
  f.page.data.showAddStapleSheet = true;
  f.page.onHide();
  assert.equal(f.page.data.showAddSheet, false);
  assert.equal(f.page.data.showEditSheet, false);
  assert.equal(f.page.data.editingItem, null);
  assert.equal(f.page.data.showAddStapleSheet, false);
});

// ===== T16: Shopping onHide clears all overlay sheets =====
test('T16: Shopping onHide clears all show*Sheet states', () => {
  let pageConfig = null;
  global.Page = (config) => { pageConfig = config; };
  global.wx = { ...global.wx, showToast: () => {}, showLoading: () => {}, hideLoading: () => {} };
  delete require.cache[require.resolve('../../miniprogram/pages/shopping/shopping.js')];
  require('../../miniprogram/pages/shopping/shopping.js');
  const page = { ...pageConfig, data: { ...pageConfig.data, showEvidenceSheet: true, evidenceItem: { id: 'e' }, showManualDetailSheet: true, manualItem: { id: 'm' }, showAddSheet: true, showCompleteSheet: true, purchasedItems: [{ id: 'p' }] }, setData(v) { Object.assign(this.data, v); } };
  page.onHide();
  assert.equal(page.data.showEvidenceSheet, false);
  assert.equal(page.data.evidenceItem, null);
  assert.equal(page.data.showManualDetailSheet, false);
  assert.equal(page.data.manualItem, null);
  assert.equal(page.data.showAddSheet, false);
  assert.equal(page.data.showCompleteSheet, false);
  assert.deepEqual(page.data.purchasedItems, []);
});

// ===== T17: WXML must not call Page method, controller has no duplicate helper =====
test('T17: mine.wxml uses data boolean not Page method; controller has no duplicate helper', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '..', '..', 'miniprogram', 'pages', 'mine', 'mine.wxml'), 'utf8');
  assert.ok(!wxml.includes('canEditKitchenSettings('), 'WXML must not call canEditKitchenSettings() method');
  assert.ok(wxml.includes("canEditKitchenSettings ? '可编辑' : '只读'"), 'WXML must use data boolean with ternary');
  const controller = fs.readFileSync(path.join(__dirname, '..', '..', 'miniprogram', 'pages', 'mine', 'mine-controller.js'), 'utf8');
  assert.ok(!controller.includes('canEditKitchenSettings() {'), 'controller must not define duplicate canEditKitchenSettings() method');
  assert.ok(controller.includes('canEditKitchenSettings: state.activeFamily'), 'controller must compute canEditKitchenSettings in applySession');
});

// ===== Existing tests (kept) =====
test('A9: ADMIN can edit kitchen settings', () => {
  const h = mineHarness({ activeFamily: { id: 'f', name: 'Test', role: 'ADMIN', invite_code: 'C' } });
  assert.equal(h.page.data.canEditKitchenSettings, true);
});

test('A18: TabBar lock/unlock lifecycle', () => {
  const h = mineHarness();
  h.page.openKitchenSettingsSheet();
  assert.ok(h.actions.includes('lockTabBar'));
  h.page.closeSheet();
  assert.ok(h.actions.includes('unlockTabBar'));
});

test('A20: 分享广场 is disabled', () => {
  const h = mineHarness();
  const shareItem = h.page.data.menuGroups.find(g => g.title === '创作与分享').items.find(i => i.name === '分享广场');
  assert.equal(shareItem.disabled, true);
  assert.equal(shareItem.action, '');
});

test('A21: 我的分享 is disabled', () => {
  const h = mineHarness();
  const shareItem = h.page.data.menuGroups.find(g => g.title === '创作与分享').items.find(i => i.name === '我的分享');
  assert.equal(shareItem.disabled, true);
  assert.equal(shareItem.action, '');
});

test('A14-A17: main-tab overlays use tab-safe contract classes', () => {
  const MP = path.join(__dirname, '..', '..', 'miniprogram', 'pages');
  for (const pg of ['mine', 'fridge', 'shopping']) {
    const wxml = fs.readFileSync(path.join(MP, pg, pg + '.wxml'), 'utf8');
    const oldMask = wxml.match(/class="[^"]*sheet-mask[^"]*"/g) || [];
    for (const cls of oldMask) assert.ok(cls.includes('tab-safe-sheet-mask'), `${pg}: ${cls}`);
    const oldPanel = wxml.match(/class="[^"]*sheet-panel[^"]*"/g) || [];
    for (const cls of oldPanel) assert.ok(cls.includes('tab-safe-sheet-panel'), `${pg}: ${cls}`);
  }
});

test('A19: shopping complete-bar uses tab-page-dock', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '..', '..', 'miniprogram', 'pages', 'shopping', 'shopping.wxml'), 'utf8');
  assert.ok(wxml.includes('tab-page-dock'));
  assert.ok(wxml.includes('tab-page-scroll-spacer'));
});

test('A6: goPantry sets navigation intent and switches to fridge', () => {
  const h = mineHarness();
  h.page.goPantry();
  assert.equal(h.storage['v1_fridge_target_tab'], 'pantry');
  assert.ok(h.actions.some(a => Array.isArray(a) && a[0] === 'switchTab' && a[1] === '/pages/fridge/fridge'));
});

test('A12: recommendation mode uses code', () => {
  const h = mineHarness();
  h.page.openKitchenSettingsSheet();
  h.page.onKitchenMode({ currentTarget: { dataset: { value: 'TRY_DIFFERENT' } } });
  assert.equal(h.page.data.kitchenForm.random_default_mode, 'TRY_DIFFERENT');
});

test('A13: cookware multi-select toggles', () => {
  const h = mineHarness();
  h.page.openKitchenSettingsSheet();
  assert.deepEqual(h.page.data.kitchenForm.cookware, ['WOK']);
  h.page.onKitchenCookware({ currentTarget: { dataset: { code: 'AIR_FRYER' } } });
  assert.deepEqual(h.page.data.kitchenForm.cookware, ['WOK', 'AIR_FRYER']);
  h.page.onKitchenCookware({ currentTarget: { dataset: { code: 'WOK' } } });
  assert.deepEqual(h.page.data.kitchenForm.cookware, ['AIR_FRYER']);
});
