const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const FRIDGE_JS = path.resolve(__dirname, '../../miniprogram/pages/fridge/fridge.js');
const FRIDGE_WXML = path.resolve(__dirname, '../../miniprogram/pages/fridge/fridge.wxml');
const MINE_CTRL = path.resolve(__dirname, '../../miniprogram/pages/mine/mine-controller.js');
const MINE_WXML = path.resolve(__dirname, '../../miniprogram/pages/mine/mine.wxml');
const INDEX_JS = path.resolve(__dirname, '../../miniprogram/pages/index/index.js');
const RANDOM_JS = path.resolve(__dirname, '../../miniprogram/pages/random/random.js');

function read(p) { return fs.readFileSync(p, 'utf8'); }

// PA-HF-01: FRIDGE-04 优先做掉 不再可点击
test('PA-HF-01 fridge expiring-action has no bindtap', () => {
  const wxml = read(FRIDGE_WXML);
  // The expiring action area must not have bindtap="prioritizeExpiring"
  assert.ok(!wxml.includes('bindtap="prioritizeExpiring"'), 'expiring action must not be clickable');
  assert.ok(wxml.includes('expiring-action-disabled'), 'must show disabled style');
});

// PA-HF-02: prioritizeExpiring 方法已移除
test('PA-HF-02 fridge.js has no prioritizeExpiring method', () => {
  const js = read(FRIDGE_JS);
  assert.ok(!/prioritizeExpiring\s*\(/.test(js), 'prioritizeExpiring method must be removed');
});

// PA-HF-03: Mine 页所有 BROKEN placeholder 菜单项为 disabled:true
test('PA-HF-03 mine placeholder menu items are disabled', () => {
  const ctrl = read(MINE_CTRL);
  const placeholders = ['么么哒', '我的菜谱', 'AI 导入菜谱', '回收站', '关于我们'];
  for (const name of placeholders) {
    // Find the line containing this menu item
    const re = new RegExp(`name:\\s*['"]${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"][^}]*}`);
    const m = ctrl.match(re);
    assert.ok(m, `menu item "${name}" must exist`);
    assert.ok(m[0].includes('disabled: true'), `"${name}" must be disabled:true, got: ${m[0]}`);
  }
});

// PA-HF-04: Mine placeholder 菜单项 action 不是 placeholderToast
test('PA-HF-04 mine placeholder items do not use placeholderToast action', () => {
  const ctrl = read(MINE_CTRL);
  assert.ok(!ctrl.includes("action: 'placeholderToast'"), 'no menu item should use placeholderToast action');
});

// PA-HF-05: placeholderToast 方法已移除
test('PA-HF-05 mine-controller has no placeholderToast method', () => {
  const ctrl = read(MINE_CTRL);
  assert.ok(!/placeholderToast\s*\(/.test(ctrl), 'placeholderToast method must be removed');
});

// PA-HF-06: 全局无 "推荐引擎接入后启用" 文案
test('PA-HF-06 no "推荐引擎接入后启用" text in frontend', () => {
  const files = [FRIDGE_JS, FRIDGE_WXML, MINE_CTRL, MINE_WXML, INDEX_JS, RANDOM_JS];
  for (const f of files) {
    const content = read(f);
    assert.ok(!content.includes('推荐引擎接入后启用'), `${path.basename(f)} must not contain placeholder text`);
  }
});

// PA-HF-07: 全局无 "功能待接入" 可点击 toast 文案
test('PA-HF-07 no "功能待接入" toast in frontend', () => {
  const files = [FRIDGE_JS, MINE_CTRL, INDEX_JS, RANDOM_JS];
  for (const f of files) {
    const content = read(f);
    assert.ok(!content.includes('功能待接入'), `${path.basename(f)} must not contain "功能待接入"`);
    assert.ok(!content.includes('此功能待接入'), `${path.basename(f)} must not contain "此功能待接入"`);
  }
});

// PA-HF-08: 核心流程不受影响 — random goDetail 仍存在且更新 mealTarget
test('PA-HF-08 random goDetail still works with mealTarget', () => {
  const js = read(RANDOM_JS);
  assert.ok(js.includes('goDetail(e)'), 'random goDetail must exist');
  assert.ok(js.includes('_mealTarget.update'), 'random goDetail must update mealTarget');
  assert.ok(js.includes("navigateTo"), 'random goDetail must navigate to detail');
});

// PA-HF-09: 核心流程不受影响 — fridge cookAddToMeal 仍存在且跳转 meal
test('PA-HF-09 fridge cookAddToMeal still navigates to meal', () => {
  const js = read(FRIDGE_JS);
  assert.ok(js.includes('cookAddToMeal'), 'fridge cookAddToMeal must exist');
  assert.ok(js.includes('/pages/meal/meal'), 'fridge cookAddToMeal must navigate to meal page');
});

// PA-HF-10: 核心流程不受影响 — index goDishDetail 仍存在
test('PA-HF-10 index goDishDetail still exists', () => {
  const js = read(INDEX_JS);
  assert.ok(js.includes('goDishDetail'), 'index goDishDetail must exist');
});

// PA-HF-11: Mine WXML disabled items use menu-item-disabled class (no bindtap)
test('PA-HF-11 mine wxml disabled items have no bindtap', () => {
  const wxml = read(MINE_WXML);
  // Disabled items use wx:if="{{item.disabled}}" with class menu-item-disabled and NO bindtap
  const disabledBlock = wxml.match(/wx:if="\{\{item\.disabled\}\}"[^>]*>/);
  assert.ok(disabledBlock, 'must have disabled item rendering block');
  assert.ok(!disabledBlock[0].includes('bindtap'), 'disabled items must not have bindtap');
});
