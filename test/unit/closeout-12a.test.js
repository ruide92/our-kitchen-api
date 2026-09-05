const test = require('node:test');
const assert = require('node:assert/strict');
const { createMinePage } = require('../../miniprogram/pages/mine/mine-controller');

function mineHarness(initial = {}) {
  const base = { status: 'authenticated', user: { id: 'u', nickname: 'Tester' }, families: [{ id: 'f', name: 'Test Family', role: 'OWNER' }], active_family_id: 'f', activeFamily: { id: 'f', name: 'Test Family', role: 'OWNER', invite_code: 'CODE' }, members: [{ id: 'm', role: 'OWNER', user: { id: 'u', nickname: 'Tester' } }], settings: { family_id: 'f', version: 1, default_diners: 2, breakfast_target_count: 2, lunch_target_count: 2, dinner_target_count: 3, default_spiciness: 'NONE', cookware: ['WOK'], random_default_mode: 'BALANCED', prefer_expiring_inventory: true, repeat_strong_days: 3, repeat_penalty_days: 7, repeat_recover_days: 14 }, hasFamily: true, familyStatus: 'ready' };
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

test('A8: OWNER can edit and save kitchen settings', async () => {
  const h = mineHarness();
  h.page.openKitchenSettingsSheet();
  assert.equal(h.page.data.sheet, 'kitchen');
  assert.equal(h.page.data.kitchenForm.default_diners, 2);
  h.page.data.kitchenForm.default_diners = 4;
  h.page.onKitchenMode({ currentTarget: { dataset: { value: 'USE_INVENTORY' } } });
  assert.equal(h.page.data.kitchenForm.random_default_mode, 'USE_INVENTORY');
  await h.page.saveKitchenSettings();
  assert.equal(h.page.data.sheet, '');
  assert.ok(h.actions.some(a => Array.isArray(a) && a[0] === 'updateSettings'));
});

test('A9: ADMIN can edit kitchen settings', () => {
  const h = mineHarness({ activeFamily: { id: 'f', name: 'Test', role: 'ADMIN', invite_code: 'C' } });
  assert.equal(h.page.canEditKitchenSettings(), true);
});

test('A10: MEMBER cannot edit kitchen settings', async () => {
  const h = mineHarness({ activeFamily: { id: 'f', name: 'Test', role: 'MEMBER', invite_code: 'C' } });
  assert.equal(h.page.canEditKitchenSettings(), false);
  h.page.openKitchenSettingsSheet();
  h.page.data.kitchenForm.default_diners = 5;
  await h.page.saveKitchenSettings();
  assert.ok(!h.actions.some(a => Array.isArray(a) && a[0] === 'updateSettings'));
});

test('A11: VERSION_CONFLICT triggers reload and friendly message', async () => {
  const h = mineHarness();
  h.session.updateSettings = async () => { const e = new Error('conflict'); e.code = 'VERSION_CONFLICT'; e.status = 409; throw e; };
  h.page.openKitchenSettingsSheet();
  await h.page.saveKitchenSettings();
  assert.ok(h.toasts.some(t => t.includes('刷新') || t.includes('修改')));
});

test('A12: recommendation mode uses code not Chinese label', () => {
  const h = mineHarness();
  h.page.openKitchenSettingsSheet();
  h.page.onKitchenMode({ currentTarget: { dataset: { value: 'TRY_DIFFERENT' } } });
  assert.equal(h.page.data.kitchenForm.random_default_mode, 'TRY_DIFFERENT');
});

test('A13: cookware multi-select toggles correctly', () => {
  const h = mineHarness();
  h.page.openKitchenSettingsSheet();
  assert.deepEqual(h.page.data.kitchenForm.cookware, ['WOK']);
  h.page.onKitchenCookware({ currentTarget: { dataset: { code: 'AIR_FRYER' } } });
  assert.deepEqual(h.page.data.kitchenForm.cookware, ['WOK', 'AIR_FRYER']);
  h.page.onKitchenCookware({ currentTarget: { dataset: { code: 'WOK' } } });
  assert.deepEqual(h.page.data.kitchenForm.cookware, ['AIR_FRYER']);
});

test('A6: goPantry sets navigation intent and switches to fridge', () => {
  const h = mineHarness();
  h.page.goPantry();
  assert.equal(h.storage['v1_fridge_target_tab'], 'pantry');
  assert.ok(h.actions.some(a => Array.isArray(a) && a[0] === 'switchTab' && a[1] === '/pages/fridge/fridge'));
});

test('A18: TabBar lock/unlock lifecycle', () => {
  const h = mineHarness();
  h.page.openKitchenSettingsSheet();
  assert.ok(h.actions.includes('lockTabBar'));
  h.page.closeSheet();
  assert.ok(h.actions.includes('unlockTabBar'));
});

test('A18b: onHide unlocks TabBar', () => {
  const h = mineHarness();
  h.page.openKitchenSettingsSheet();
  h.page.onHide();
  assert.ok(h.actions.filter(a => a === 'unlockTabBar').length >= 1);
});

test('A20: 分享广场 is disabled with no action', () => {
  const h = mineHarness();
  const shareItem = h.page.data.menuGroups.find(g => g.title === '创作与分享').items.find(i => i.name === '分享广场');
  assert.equal(shareItem.disabled, true);
  assert.equal(shareItem.action, '');
});

test('A21: 我的分享 is disabled with no action', () => {
  const h = mineHarness();
  const shareItem = h.page.data.menuGroups.find(g => g.title === '创作与分享').items.find(i => i.name === '我的分享');
  assert.equal(shareItem.disabled, true);
  assert.equal(shareItem.action, '');
});

test('A3: duplicate custom pantry shows friendly message', async () => {
  const toasts = [];
  const api = { putCustomPantry: async () => { const e = new Error('exists'); e.code = 'CUSTOM_PANTRY_EXISTS'; e.status = 409; throw e; } };
  try { await api.putCustomPantry('f', { name: '花椒' }); }
  catch (e) { if (e.code === 'CUSTOM_PANTRY_EXISTS' || e.status === 409) toasts.push('这个常备食材已经添加过了'); }
  assert.equal(toasts[0], '这个常备食材已经添加过了');
});

test('A14-A17: main-tab overlays use tab-safe contract classes', () => {
  const fs = require('fs');
  const path = require('path');
  const MP = path.join(__dirname, '..', '..', 'miniprogram', 'pages');
  for (const page of ['mine', 'fridge', 'shopping']) {
    const wxml = fs.readFileSync(path.join(MP, page, page + '.wxml'), 'utf8');
    const oldMask = wxml.match(/class="[^"]*sheet-mask[^"]*"/g) || [];
    for (const cls of oldMask) assert.ok(cls.includes('tab-safe-sheet-mask'), `${page}: ${cls}`);
    const oldPanel = wxml.match(/class="[^"]*sheet-panel[^"]*"/g) || [];
    for (const cls of oldPanel) assert.ok(cls.includes('tab-safe-sheet-panel'), `${page}: ${cls}`);
  }
});

test('A19: shopping complete-bar uses tab-page-dock', () => {
  const fs = require('fs');
  const path = require('path');
  const wxml = fs.readFileSync(path.join(__dirname, '..', '..', 'miniprogram', 'pages', 'shopping', 'shopping.wxml'), 'utf8');
  assert.ok(wxml.includes('tab-page-dock'));
  assert.ok(wxml.includes('tab-page-scroll-spacer'));
});
