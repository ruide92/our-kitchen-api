// Governance Mutation Tests — prove the gates actually catch bad inputs
// Each test simulates a regression and verifies the audit FAILs.
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

// Case A: new WXML bindtap not in matrix → surface audit should detect
test('Mutation A: unregistered WXML handler is detected', () => {
  const tmp = makeTempDir();
  // Create minimal miniprogram structure
  writeFile(tmp, 'miniprogram/app.json', JSON.stringify({ pages: ['pages/test/test'] }));
  writeFile(tmp, 'miniprogram/pages/test/test.wxml', '<view bindtap="unregisteredNewHandler">click</view>');
  writeFile(tmp, 'miniprogram/pages/test/test.js', 'Page({})');
  // Matrix without this handler
  writeFile(tmp, 'docs/PRODUCT_SURFACE_MATRIX.md', '| ID | Label | Trigger | Page | Status | Phase | Final | Frontend |\n|---|---|---|---|---|---|---|---|\n| TEST-01 | existing | tap | test | REAL | 12A | REAL | test.js |\n');

  const result = runScript('product-surface-audit.js', [], tmp);
  // Should detect missing handler in JS
  assert.ok(result.stdout.includes('Missing handlers') || result.stdout.includes('missing'),
    `expected missing handler detection, got: ${result.stdout.slice(0, 200)}`);
});

// Case B: REAL surface uses placeholderToast → FAIL
test('Mutation B: REAL surface with placeholderToast is flagged', () => {
  const tmp = makeTempDir();
  writeFile(tmp, 'miniprogram/app.json', JSON.stringify({ pages: ['pages/test/test'] }));
  writeFile(tmp, 'miniprogram/pages/test/test.wxml', '<view bindtap="placeholderToast">click</view>');
  writeFile(tmp, 'miniprogram/pages/test/test.js', 'Page({ placeholderToast(){} })');
  writeFile(tmp, 'docs/PRODUCT_SURFACE_MATRIX.md', '| ID | Label | Trigger | Page | Status | Phase | Final | Frontend |\n|---|---|---|---|---|---|---|---|\n| TEST-01 | fake real | tap | test | REAL | 12A | REAL | placeholderToast |\n');

  const result = runScript('product-surface-audit.js', ['--mode=release'], tmp);
  assert.ok(result.code !== 0 || result.stdout.includes('REAL surface violations'),
    `expected release mode FAIL for REAL+placeholder, got code=${result.code}`);
});

// Case C: navigateTo non-existent page → FAIL
test('Mutation C: invalid navigation target is detected', () => {
  const tmp = makeTempDir();
  writeFile(tmp, 'miniprogram/app.json', JSON.stringify({ pages: ['pages/test/test'] }));
  writeFile(tmp, 'miniprogram/pages/test/test.wxml', '<view>test</view>');
  writeFile(tmp, 'miniprogram/pages/test/test.js', "Page({ go() { wx.navigateTo({ url: '/pages/nonexistent/page' }) } })");
  writeFile(tmp, 'docs/PRODUCT_SURFACE_MATRIX.md', '| ID | Label | Trigger | Page | Status | Phase | Final | Frontend |\n|---|---|---|---|---|---|---|---|\n| TEST-01 | nav | tap | test | REAL | 12A | REAL | test.js |\n');

  const result = runScript('product-surface-audit.js', [], tmp);
  assert.ok(result.stdout.includes('Invalid navigation') || result.stdout.includes('invalid'),
    `expected invalid nav detection, got: ${result.stdout.slice(0, 300)}`);
});

// Case D: tab sheet bottom:0 unclassified → overlay audit FAIL
test('Mutation D: unclassified tab sheet is detected', () => {
  const tmp = makeTempDir();
  writeFile(tmp, 'miniprogram/app.json', JSON.stringify({ pages: ['pages/index/index'] }));
  writeFile(tmp, 'miniprogram/pages/index/index.wxml', '<view class="my-custom-sheet-mask"></view><view class="my-custom-sheet-panel"></view>');
  writeFile(tmp, 'miniprogram/pages/index/index.wxss', '.my-custom-sheet-panel { bottom: 0; }');
  writeFile(tmp, 'miniprogram/app.wxss', '.tab-safe-sheet-mask{} .tab-safe-sheet-panel{} .tab-page-dock{} .tab-page-scroll-spacer{} .sheet-mask-no-tabbar{} .sheet-panel-no-tabbar{}');
  writeFile(tmp, 'miniprogram/custom-tab-bar/index.js', 'Component({ data: { locked: false } })');
  writeFile(tmp, 'miniprogram/custom-tab-bar/index.wxml', '<view class="{{locked ? \'tabbar-locked\' : \'\'}}"></view>');
  writeFile(tmp, 'docs/PRODUCT_SURFACE_MATRIX.md', '| ID | Label | Trigger | Page | Status | Phase | Final | Frontend |\n|---|---|---|---|---|---|---|---|\n');

  const result = runScript('overlay-contract-audit.js', [], tmp);
  // index is a TAB page, sheet doesn't use global contract and is not in KNOWN_BROKEN list
  // Wait — KNOWN_BROKEN_PAGES includes 'index'? No, it's menu/fridge/shopping/mine.
  // So index sheet should be UNCLASSIFIED
  assert.ok(result.code !== 0 || result.stdout.includes('UNCLASSIFIED'),
    `expected unclassified detection for index sheet, got code=${result.code}: ${result.stdout.slice(0, 300)}`);
});

// Case E: DRAFT migration → release schema audit FAIL
test('Mutation E: DRAFT amendment blocks release schema audit', () => {
  const tmp = makeTempDir();
  writeFile(tmp, 'docs/DATA_MODEL_V4.md', 'test_table test_column');
  writeFile(tmp, 'backend/v1/sql/001_test.sql', 'CREATE TABLE test_table(id int);');
  writeFile(tmp, 'backend/v1/sql/008_test.sql', 'CREATE TABLE new_unapproved_table(id int); ALTER TABLE test_table ADD COLUMN new_col int;');
  writeFile(tmp, 'docs/SPEC_AMENDMENT_12A.md', 'Status: DRAFT\nnew_unapproved_table new_col');

  const result = runScript('schema-contract-audit.js', ['--mode=release'], tmp);
  assert.notEqual(result.code, 0, `release schema audit should FAIL with DRAFT amendment, got code=0`);
});

// Case F: matrix has BROKEN Final=REAL → release readiness FAIL
test('Mutation F: BROKEN required surface blocks release readiness', () => {
  const tmp = makeTempDir();
  writeFile(tmp, 'docs/PRODUCT_SURFACE_MATRIX.md',
    '| ID | Label | Trigger | Page | Status | Phase | Final | Frontend | API | Backend | DB | Journey | Evidence |\n' +
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|\n' +
    '| TEST-01 | broken required | tap | test | BROKEN | 12A | REAL | test.js | GET /x | svc | tbl | UJ-01 | none |\n' +
    '| TEST-02 | real ok | tap | test | REAL | 12A | REAL | test.js | GET /y | svc | tbl | UJ-01 | test |\n');

  const result = runScript('release-readiness-audit.js', [], tmp);
  assert.notEqual(result.code, 0, `release readiness should FAIL with BROKEN Final=REAL, got code=0`);
  assert.ok(result.stdout.includes('BROKEN_REQUIRED_NOW') || result.stdout.includes('TEST-01'),
    `expected BROKEN_REQUIRED_NOW listing, got: ${result.stdout.slice(0, 300)}`);
});

// Verify current baseline: governance gate passes, release gate fails
test('Baseline: governance audit passes on real repo', () => {
  const result = runScript('product-surface-audit.js', ['--mode=governance']);
  assert.equal(result.code, 0, `governance surface audit should pass, got code=${result.code}: ${result.stderr}`);
});

test('Baseline: release readiness fails on real repo (38 BROKEN)', () => {
  const result = runScript('release-readiness-audit.js');
  assert.notEqual(result.code, 0, `release readiness should FAIL on current repo (38 BROKEN), got code=0`);
});

test('Baseline: schema governance passes with 008 BLOCKED reported', () => {
  const result = runScript('schema-contract-audit.js', ['--mode=governance']);
  assert.equal(result.code, 0, `governance schema audit should pass, got code=${result.code}`);
  assert.ok(result.stdout.includes('BLOCKED') || result.stdout.includes('DRAFT'),
    `should report 008 BLOCKED/DRAFT`);
});

test('Baseline: schema release fails due to 008 DRAFT', () => {
  const result = runScript('schema-contract-audit.js', ['--mode=release']);
  assert.notEqual(result.code, 0, `release schema audit should FAIL due to 008 DRAFT, got code=0`);
});
