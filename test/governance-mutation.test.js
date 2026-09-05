// Governance Mutation Tests — prove the gates actually catch bad inputs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPTS = path.join(ROOT, 'scripts');

function runScript(script, args = [], cwd = ROOT) {
  try {
    const out = execFileSync('node', [path.join(SCRIPTS, script), ...args], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    });
    return { code: 0, stdout: out, stderr: '' };
  } catch (e) {
    return { code: e.status || 1, stdout: e.stdout?.toString() || '', stderr: e.stderr?.toString() || '' };
  }
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gov-mut-'));
}

function writeFile(dir, rel, content) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function makeMinimalRepo(dir, extraRegistry = []) {
  writeFile(dir, 'miniprogram/app.json', JSON.stringify({ pages: ['pages/test/test', 'pages/index/index', 'pages/fridge/fridge'] }));
  writeFile(dir, 'miniprogram/pages/test/test.wxml', '<view bindtap="existingHandler">ok</view>');
  writeFile(dir, 'miniprogram/pages/test/test.js', 'Page({ existingHandler(){} })');
  writeFile(dir, 'miniprogram/pages/index/index.wxml', '<view>home</view>');
  writeFile(dir, 'miniprogram/pages/index/index.js', 'Page({})');
  writeFile(dir, 'miniprogram/pages/fridge/fridge.wxml', '<view>fridge</view>');
  writeFile(dir, 'miniprogram/pages/fridge/fridge.js', 'Page({})');
  writeFile(dir, 'miniprogram/app.wxss', '.tab-safe-sheet-mask{}.tab-safe-sheet-panel{}.tab-page-dock{}.tab-page-scroll-spacer{}.sheet-mask-no-tabbar{}.sheet-panel-no-tabbar{}');
  writeFile(dir, 'miniprogram/custom-tab-bar/index.js', 'Component({data:{locked:false}})');
  writeFile(dir, 'miniprogram/custom-tab-bar/index.wxml', '<view class="{{locked?\'tabbar-locked\':\'\'}}"></view>');
  writeFile(dir, 'docs/DATA_MODEL_V4.md', 'test_table');
  writeFile(dir, 'backend/v1/sql/001_test.sql', 'CREATE TABLE test_table(id int);');
  const registry = {
    $schema: 'product-surfaces-registry-v1',
    surfaces: [
      { id: 'TEST-01', page: 'test', kind: 'wxml-handler', handler: 'existingHandler', label: 'existing', status: 'REAL', final: 'REAL' },
      ...extraRegistry
    ]
  };
  writeFile(dir, 'governance/product-surfaces.json', JSON.stringify(registry));
}

// Case A: WXML has real implemented handler but registry doesn't register it → UNCLASSIFIED FAIL
test('Mutation A: unregistered real handler causes UNCLASSIFIED FAIL', () => {
  const tmp = makeTempDir();
  makeMinimalRepo(tmp);
  writeFile(tmp, 'miniprogram/pages/test/test.wxml', '<view bindtap="existingHandler">ok</view><view bindtap="realNewFeature">new</view>');
  writeFile(tmp, 'miniprogram/pages/test/test.js', 'Page({ existingHandler(){}, realNewFeature(){ console.log("real impl") } })');

  const result = runScript('product-surface-audit.js', ['--mode=governance'], tmp);
  assert.notEqual(result.code, 0, `should FAIL for unclassified handler, got code=0`);
  assert.ok(result.stdout.includes('UNCLASSIFIED') && result.stdout.includes('realNewFeature'),
    `should report UNCLASSIFIED for realNewFeature, got: ${result.stdout.slice(0, 300)}`);
});

// Case B: Registry says REAL but handler is placeholderToast → GOVERNANCE FAIL (fake REAL)
test('Mutation B: REAL surface with placeholderToast causes GOVERNANCE FAIL', () => {
  const tmp = makeTempDir();
  makeMinimalRepo(tmp);
  writeFile(tmp, 'miniprogram/pages/test/test.wxml', '<view bindtap="placeholderToast">click</view>');
  writeFile(tmp, 'miniprogram/pages/test/test.js', 'Page({ placeholderToast(){ wx.showToast({title:"待接入"}) } })');
  const registry = {
    $schema: 'v1',
    surfaces: [
      { id: 'TEST-01', page: 'test', kind: 'wxml-handler', handler: 'placeholderToast', label: 'fake real', status: 'REAL', final: 'REAL' }
    ]
  };
  writeFile(tmp, 'governance/product-surfaces.json', JSON.stringify(registry));

  // Governance must catch fake REAL
  const govResult = runScript('product-surface-audit.js', ['--mode=governance'], tmp);
  assert.notEqual(govResult.code, 0, `governance should FAIL for REAL+placeholder, got code=0`);
  assert.ok(govResult.stdout.includes('REAL_VIOLATION') || govResult.stdout.includes('placeholder'),
    `should report REAL_VIOLATION, got: ${govResult.stdout.slice(0, 300)}`);
});

// Case C: navigateTo non-existent page → FAIL
test('Mutation C: invalid navigation target is detected', () => {
  const tmp = makeTempDir();
  makeMinimalRepo(tmp);
  writeFile(tmp, 'miniprogram/pages/test/test.js', "Page({ existingHandler(){ wx.navigateTo({ url: '/pages/nonexistent/page' }) } })");

  const result = runScript('product-surface-audit.js', ['--mode=governance'], tmp);
  assert.notEqual(result.code, 0, `should FAIL for invalid nav target, got code=0`);
  assert.ok(result.stdout.includes('Invalid nav') || result.stdout.includes('nonexistent'),
    `should report invalid nav, got: ${result.stdout.slice(0, 300)}`);
});

// Case D: unclassified tab sheet (no data-surface-id) → overlay audit FAIL
test('Mutation D: unclassified tab sheet causes overlay FAIL', () => {
  const tmp = makeTempDir();
  makeMinimalRepo(tmp);
  writeFile(tmp, 'miniprogram/pages/index/index.wxml', '<view class="unknown-sheet-mask"></view>');
  writeFile(tmp, 'miniprogram/pages/index/index.wxss', '');

  const result = runScript('overlay-contract-audit.js', ['--mode=governance'], tmp);
  assert.notEqual(result.code, 0, `should FAIL for unclassified sheet on index, got code=0`);
  assert.ok(result.stdout.includes('MISSING_SURFACE_ID') || result.stdout.includes('UNCLASSIFIED'),
    `should report missing/unclassified, got: ${result.stdout.slice(0, 300)}`);
});

// Case D2: known-broken page has registered overlay + NEW unregistered overlay → UNCLASSIFIED
// This proves surface_id whitelist, not page-wide whitelist
test('Mutation D2: new sheet on known-broken page is UNCLASSIFIED not auto-whitelisted', () => {
  const tmp = makeTempDir();
  makeMinimalRepo(tmp);
  // fridge has FRIDGE-OVERLAY-01 registered as KNOWN_BROKEN
  // plus a NEW sheet FRIDGE-OVERLAY-NEW that is NOT registered
  writeFile(tmp, 'miniprogram/pages/fridge/fridge.wxml',
    '<view wx:if="{{showAdd}}" class="sheet-mask" data-surface-id="FRIDGE-OVERLAY-01"></view>' +
    '<view wx:if="{{showNew}}" class="sheet-mask" data-surface-id="FRIDGE-OVERLAY-NEW"></view>');
  const registry = {
    $schema: 'v1',
    surfaces: [
      { id: 'TEST-01', page: 'test', kind: 'wxml-handler', handler: 'existingHandler', label: 'e', status: 'REAL', final: 'REAL' },
      { id: 'FRIDGE-OVERLAY-01', page: 'fridge', kind: 'overlay', surface_id: 'FRIDGE-OVERLAY-01', label: 'add sheet', status: 'KNOWN_BROKEN', final: 'REAL' }
    ]
  };
  writeFile(tmp, 'governance/product-surfaces.json', JSON.stringify(registry));

  const result = runScript('overlay-contract-audit.js', ['--mode=governance'], tmp);
  assert.notEqual(result.code, 0, `should FAIL for unregistered NEW overlay, got code=0`);
  assert.ok(result.stdout.includes('UNCLASSIFIED') && result.stdout.includes('FRIDGE-OVERLAY-NEW'),
    `should report UNCLASSIFIED for FRIDGE-OVERLAY-NEW, got: ${result.stdout.slice(0, 400)}`);
});

// Case E: DRAFT migration → release schema audit FAIL
test('Mutation E: DRAFT amendment blocks release schema audit', () => {
  const tmp = makeTempDir();
  writeFile(tmp, 'docs/DATA_MODEL_V4.md', 'test_table');
  writeFile(tmp, 'backend/v1/sql/001_test.sql', 'CREATE TABLE test_table(id int);');
  writeFile(tmp, 'backend/v1/sql/008_new.sql', 'CREATE TABLE new_unapproved_table(id int);');
  writeFile(tmp, 'docs/SPEC_AMENDMENT_12A.md', 'Status: DRAFT\nnew_unapproved_table');

  const result = runScript('schema-contract-audit.js', ['--mode=release'], tmp);
  assert.notEqual(result.code, 0, `release schema should FAIL with DRAFT, got code=0`);
});

// Case F: BROKEN Final=REAL → release readiness FAIL (reads JSON now)
test('Mutation F: BROKEN required surface blocks release readiness', () => {
  const tmp = makeTempDir();
  const registry = {
    $schema: 'v1',
    surfaces: [
      { id: 'TEST-01', page: 'test', kind: 'wxml-handler', handler: 'brokenHandler', label: 'broken required', status: 'BROKEN', final: 'REAL' },
      { id: 'TEST-02', page: 'test', kind: 'wxml-handler', handler: 'okHandler', label: 'real ok', status: 'REAL', final: 'REAL' }
    ]
  };
  writeFile(tmp, 'governance/product-surfaces.json', JSON.stringify(registry));

  const result = runScript('release-readiness-audit.js', [], tmp);
  assert.notEqual(result.code, 0, `release readiness should FAIL with BROKEN Final=REAL, got code=0`);
  assert.ok(result.stdout.includes('BROKEN_REQUIRED_NOW') || result.stdout.includes('BROKEN'),
    `should list BROKEN required, got: ${result.stdout.slice(0, 300)}`);
});

// Case G: release surface mode catches REAL+placeholder
test('Mutation G: surface release mode catches REAL+placeholder', () => {
  const tmp = makeTempDir();
  makeMinimalRepo(tmp);
  writeFile(tmp, 'miniprogram/pages/test/test.wxml', '<view bindtap="placeholderToast">click</view>');
  writeFile(tmp, 'miniprogram/pages/test/test.js', 'Page({ placeholderToast(){ wx.showToast({title:"待接入"}) } })');
  const registry = {
    $schema: 'v1',
    surfaces: [
      { id: 'TEST-01', page: 'test', kind: 'wxml-handler', handler: 'placeholderToast', label: 'fake', status: 'REAL', final: 'REAL' }
    ]
  };
  writeFile(tmp, 'governance/product-surfaces.json', JSON.stringify(registry));

  const result = runScript('product-surface-audit.js', ['--mode=release'], tmp);
  assert.notEqual(result.code, 0, `surface:release should FAIL, got code=0`);
});

// Case H: Registry REAL, WXML bindtap=realAction, but JS has no realAction → MISSING_HANDLER FAIL
test('Mutation H: REAL wxml-handler missing from JS causes MISSING_HANDLER FAIL', () => {
  const tmp = makeTempDir();
  makeMinimalRepo(tmp);
  writeFile(tmp, 'miniprogram/pages/test/test.wxml', '<view bindtap="realAction">click</view>');
  writeFile(tmp, 'miniprogram/pages/test/test.js', 'Page({ otherMethod(){} })');
  const registry = {
    $schema: 'v1',
    surfaces: [
      { id: 'TEST-01', page: 'test', kind: 'wxml-handler', handler: 'realAction', label: 'real action', status: 'REAL', final: 'REAL' }
    ]
  };
  writeFile(tmp, 'governance/product-surfaces.json', JSON.stringify(registry));

  const result = runScript('product-surface-audit.js', ['--mode=governance'], tmp);
  assert.notEqual(result.code, 0, `should FAIL for missing handler, got code=0`);
  assert.ok(result.stdout.includes('MISSING_HANDLER') && result.stdout.includes('realAction'),
    `should report MISSING_HANDLER for realAction, got: ${result.stdout.slice(0, 300)}`);
});

// Case I: Registry overlay status=REAL, WXML has data-surface-id, but no global contract class → Governance FAIL
test('Mutation I: REAL overlay without global contract class causes Governance FAIL', () => {
  const tmp = makeTempDir();
  makeMinimalRepo(tmp);
  // index is a TAB page; add REAL overlay with surface_id but no tab-safe-sheet class
  writeFile(tmp, 'miniprogram/pages/index/index.wxml',
    '<view wx:if="{{showSheet}}" class="sheet-mask" data-surface-id="INDEX-OVERLAY-01"></view>' +
    '<view class="sheet-panel"></view>');
  const registry = {
    $schema: 'v1',
    surfaces: [
      { id: 'TEST-01', page: 'test', kind: 'wxml-handler', handler: 'existingHandler', label: 'e', status: 'REAL', final: 'REAL' },
      { id: 'INDEX-OVERLAY-01', page: 'index', kind: 'overlay', surface_id: 'INDEX-OVERLAY-01', label: 'index sheet', status: 'REAL', final: 'REAL' }
    ]
  };
  writeFile(tmp, 'governance/product-surfaces.json', JSON.stringify(registry));

  const result = runScript('overlay-contract-audit.js', ['--mode=governance'], tmp);
  assert.notEqual(result.code, 0, `should FAIL for REAL overlay without contract, got code=0`);
  assert.ok(result.stdout.includes('REAL_OVERLAY_CONTRACT_VIOLATION'),
    `should report REAL_OVERLAY_CONTRACT_VIOLATION, got: ${result.stdout.slice(0, 400)}`);
});

// Case J: Registry REAL surface completely absent from code → MISSING_SURFACE Governance FAIL
test('Mutation J: REAL registry surface absent from code causes MISSING_SURFACE Governance FAIL', () => {
  const tmp = makeTempDir();
  makeMinimalRepo(tmp);
  // Registry has a REAL menu-action that doesn't exist in code
  const registry = {
    $schema: 'v1',
    surfaces: [
      { id: 'TEST-01', page: 'test', kind: 'wxml-handler', handler: 'existingHandler', label: 'e', status: 'REAL', final: 'REAL' },
      { id: 'TEST-MENU-01', page: 'test', kind: 'menu-action', label: 'Ghost Menu', action: 'ghostAction', status: 'REAL', final: 'REAL' }
    ]
  };
  writeFile(tmp, 'governance/product-surfaces.json', JSON.stringify(registry));

  const result = runScript('product-surface-audit.js', ['--mode=governance'], tmp);
  assert.notEqual(result.code, 0, `should FAIL for missing REAL surface, got code=0`);
  assert.ok(result.stdout.includes('MISSING_SURFACE'),
    `should report MISSING_SURFACE, got: ${result.stdout.slice(0, 300)}`);
});

// Case K: status=BROKEN final=PLANNED_DISABLED action=placeholderToast → release-readiness FAIL
test('Mutation K: BROKEN final=PLANNED_DISABLED with clickable action causes release-readiness FAIL', () => {
  const tmp = makeTempDir();
  const registry = {
    $schema: 'v1',
    surfaces: [
      { id: 'TEST-01', page: 'test', kind: 'wxml-handler', handler: 'existingHandler', label: 'e', status: 'REAL', final: 'REAL' },
      { id: 'TEST-PLAN-01', page: 'test', kind: 'menu-action', label: 'Future Feature', action: 'placeholderToast', status: 'BROKEN', final: 'PLANNED_DISABLED' }
    ]
  };
  writeFile(tmp, 'governance/product-surfaces.json', JSON.stringify(registry));

  const result = runScript('release-readiness-audit.js', [], tmp);
  assert.notEqual(result.code, 0, `release-readiness should FAIL, got code=0`);
  assert.ok(result.stdout.includes('PLANNED_DISABLED_NOT_READY'),
    `should report PLANNED_DISABLED_NOT_READY, got: ${result.stdout.slice(0, 300)}`);
});

// Case L: Same TAB page two REAL overlays — A contract correct, B has surface-id but no tab-safe contract → Governance FAIL
test('Mutation L: REAL overlay on same page without independent contract causes Governance FAIL', () => {
  const tmp = makeTempDir();
  makeMinimalRepo(tmp);
  // menu is a TAB page; overlay A has full contract, overlay B has surface-id but no tab-safe class
  writeFile(tmp, 'miniprogram/pages/menu/menu.wxml',
    '<view wx:if="{{showA}}" class="sheet-mask tab-safe-sheet-mask" data-surface-id="MENU-A">' +
    '<view class="sheet-panel tab-safe-sheet-panel" data-surface-id="MENU-A"></view></view>' +
    '<view wx:if="{{showB}}" class="sheet-mask" data-surface-id="MENU-B">' +
    '<view class="sheet-panel" data-surface-id="MENU-B"></view></view>');
  const registry = {
    $schema: 'v1',
    surfaces: [
      { id: 'TEST-01', page: 'test', kind: 'wxml-handler', handler: 'existingHandler', label: 'e', status: 'REAL', final: 'REAL' },
      { id: 'MENU-A', page: 'menu', kind: 'overlay', surface_id: 'MENU-A', label: 'A', status: 'REAL', final: 'REAL' },
      { id: 'MENU-B', page: 'menu', kind: 'overlay', surface_id: 'MENU-B', label: 'B', status: 'REAL', final: 'REAL' }
    ]
  };
  writeFile(tmp, 'governance/product-surfaces.json', JSON.stringify(registry));

  const result = runScript('overlay-contract-audit.js', ['--mode=governance'], tmp);
  assert.notEqual(result.code, 0, `should FAIL for overlay B missing contract, got code=0`);
  assert.ok(result.stdout.includes('REAL_OVERLAY_CONTRACT_VIOLATION') && result.stdout.includes('MENU-B'),
    `should report REAL_OVERLAY_CONTRACT_VIOLATION for MENU-B, got: ${result.stdout.slice(0, 400)}`);
});

// Case M: Secondary REAL overlay has surface-id but no no-tabbar contract → Governance FAIL
test('Mutation M: secondary REAL overlay without no-tabbar contract causes Governance FAIL', () => {
  const tmp = makeTempDir();
  makeMinimalRepo(tmp);
  // detail is a secondary page (not TAB, not HIDDEN in this fixture)
  writeFile(tmp, 'miniprogram/pages/detail/detail.wxml',
    '<view wx:if="{{showSheet}}" class="sheet-mask" data-surface-id="DETAIL-SHEET">' +
    '<view class="sheet-panel" data-surface-id="DETAIL-SHEET"></view></view>');
  // Add detail to app.json pages
  const appJsonPath = path.join(tmp, 'miniprogram/app.json');
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  appJson.pages.push('pages/detail/detail');
  writeFile(tmp, 'miniprogram/app.json', JSON.stringify(appJson));
  writeFile(tmp, 'miniprogram/pages/detail/detail.js', 'Page({})');

  const registry = {
    $schema: 'v1',
    surfaces: [
      { id: 'TEST-01', page: 'test', kind: 'wxml-handler', handler: 'existingHandler', label: 'e', status: 'REAL', final: 'REAL' },
      { id: 'DETAIL-SHEET', page: 'detail', kind: 'overlay', surface_id: 'DETAIL-SHEET', label: 'detail sheet', status: 'REAL', final: 'REAL' }
    ]
  };
  writeFile(tmp, 'governance/product-surfaces.json', JSON.stringify(registry));

  const result = runScript('overlay-contract-audit.js', ['--mode=governance'], tmp);
  assert.notEqual(result.code, 0, `should FAIL for secondary overlay missing contract, got code=0`);
  assert.ok(result.stdout.includes('SECONDARY_OVERLAY_CONTRACT_VIOLATION'),
    `should report SECONDARY_OVERLAY_CONTRACT_VIOLATION, got: ${result.stdout.slice(0, 400)}`);
});

// Baseline tests on real repo
test('Baseline: governance surface audit passes on real repo', () => {
  const result = runScript('product-surface-audit.js', ['--mode=governance']);
  assert.equal(result.code, 0, `governance surface audit should pass, got code=${result.code}: ${result.stderr}`);
});

test('Baseline: governance overlay audit passes on real repo', () => {
  const result = runScript('overlay-contract-audit.js', ['--mode=governance']);
  assert.equal(result.code, 0, `governance overlay audit should pass, got code=${result.code}: ${result.stderr}`);
});

test('Baseline: release readiness fails on real repo (known BROKEN)', () => {
  const result = runScript('release-readiness-audit.js');
  assert.notEqual(result.code, 0, `release readiness should FAIL on current repo, got code=0`);
});

test('Baseline: schema governance passes with 008 BLOCKED reported', () => {
  const result = runScript('schema-contract-audit.js', ['--mode=governance']);
  assert.equal(result.code, 0, `governance schema should pass, got code=${result.code}`);
  assert.ok(result.stdout.includes('BLOCKED') || result.stdout.includes('DRAFT'), `should report 008 BLOCKED`);
});

test('Baseline: schema release fails due to 008 DRAFT', () => {
  const result = runScript('schema-contract-audit.js', ['--mode=release']);
  assert.notEqual(result.code, 0, `release schema should FAIL due to 008, got code=0`);
});

test('Baseline: product surface matrix is in sync', () => {
  const result = runScript('generate-product-surface-matrix.js', ['--check']);
  assert.equal(result.code, 0, `matrix sync should pass, got code=${result.code}: ${result.stdout}`);
});

test('Baseline: UNCLASSIFIED detector is not hardcoded to 0', () => {
  const tmp = makeTempDir();
  makeMinimalRepo(tmp);
  writeFile(tmp, 'miniprogram/pages/test/test.wxml', '<view bindtap="existingHandler">ok</view><view bindtap="unregHandler">x</view>');
  writeFile(tmp, 'miniprogram/pages/test/test.js', 'Page({ existingHandler(){}, unregHandler(){} })');
  const result = runScript('product-surface-audit.js', ['--mode=governance'], tmp);
  assert.ok(result.stdout.includes('UNCLASSIFIED: 1') || result.stdout.includes('UNCLASSIFIED: 2'),
    `UNCLASSIFIED should be >0, got: ${result.stdout.match(/UNCLASSIFIED: \d+/)}`);
});
