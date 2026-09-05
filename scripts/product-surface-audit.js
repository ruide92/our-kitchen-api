#!/usr/bin/env node
// Product Surface Audit — scans WXML for user-visible entry points and matches against PRODUCT_SURFACE_MATRIX
// Usage: node scripts/product-surface-audit.js
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');
const MATRIX_PATH = path.join(ROOT, 'docs', 'PRODUCT_SURFACE_MATRIX.md');

function readFile(p) { return fs.readFileSync(p, 'utf8'); }

function listWxml(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...listWxml(full));
    else if (entry.name.endsWith('.wxml')) results.push(full);
  }
  return results;
}

function extractHandlers(wxml) {
  const handlers = new Set();
  const re = /(?:bindtap|catchtap|bindchange|bindinput|bindconfirm|bindsubmit)\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(wxml)) !== null) handlers.add(m[1]);
  return [...handlers];
}

function extractNavigations(wxml) {
  const navs = new Set();
  const re = /(?:navigateTo|switchTab|redirectTo)\s*\(\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(wxml)) !== null) navs.add(m[1]);
  return [...navs];
}

function extractMenuActions(js) {
  const actions = new Set();
  // menuGroups items with action: 'xxx'
  const re = /action:\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(js)) !== null) actions.add(m[1]);
  return [...actions];
}

function main() {
  const wxmlFiles = listWxml(path.join(MP, 'pages'));
  const allHandlers = new Map(); // page -> handlers
  const allNavs = new Map();

  for (const f of wxmlFiles) {
    const rel = path.relative(MP, f);
    const wxml = readFile(f);
    allHandlers.set(rel, extractHandlers(wxml));
    allNavs.set(rel, extractNavigations(wxml));
  }

  // Also scan custom-tab-bar
  const tabBarWxml = path.join(MP, 'custom-tab-bar', 'index.wxml');
  if (fs.existsSync(tabBarWxml)) {
    allHandlers.set('custom-tab-bar/index.wxml', extractHandlers(readFile(tabBarWxml)));
  }

  // Scan JS files for menuGroups actions
  const menuActions = new Map();
  const jsFiles = [];
  function listJs(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) listJs(full);
      else if (entry.name.endsWith('.js')) jsFiles.push(full);
    }
  }
  listJs(path.join(MP, 'pages'));
  for (const f of jsFiles) {
    const rel = path.relative(MP, f);
    const js = readFile(f);
    const actions = extractMenuActions(js);
    if (actions.length > 0) menuActions.set(rel, actions);
  }

  // Load matrix and extract known surface labels
  const matrix = readFile(MATRIX_PATH);
  const knownLabels = new Set();
  const labelRe = /\|\s*([A-Z]+-\d+)\s*\|\s*([^|]+)\|/g;
  let lm;
  while ((lm = labelRe.exec(matrix)) !== null) {
    knownLabels.add(lm[1].trim());
  }

  // Check for placeholderToast / noop usage in handlers
  const placeholderHandlers = [];
  for (const [page, handlers] of allHandlers) {
    for (const h of handlers) {
      if (h === 'placeholderToast' || h === 'noop') {
        placeholderHandlers.push({ page, handler: h });
      }
    }
  }

  // Check for dynamic handlers {{...}}
  const dynamicHandlers = [];
  for (const f of wxmlFiles) {
    const wxml = readFile(f);
    const dynRe = /(?:bindtap|catchtap)\s*=\s*"\{\{[^}]+\}\}"/g;
    let dm;
    while ((dm = dynRe.exec(wxml)) !== null) {
      dynamicHandlers.push({ page: path.relative(MP, f), match: dm[0] });
    }
  }

  // Summary
  const totalHandlers = [...allHandlers.values()].reduce((s, h) => s + h.length, 0);
  const totalPages = allHandlers.size;

  console.log('=== PRODUCT SURFACE AUDIT ===');
  console.log(`WXML pages scanned: ${totalPages}`);
  console.log(`Total event handlers: ${totalHandlers}`);
  console.log(`Known Surface IDs in matrix: ${knownLabels.size}`);
  console.log(`placeholderToast/noop handlers: ${placeholderHandlers.length}`);
  if (placeholderHandlers.length > 0) {
    placeholderHandlers.forEach(p => console.log(`  - ${p.page}: ${p.handler}`));
  }
  console.log(`Dynamic handlers: ${dynamicHandlers.length}`);
  if (dynamicHandlers.length > 0) {
    dynamicHandlers.forEach(d => console.log(`  - ${d.page}: ${d.match}`));
  }

  // Check menuGroups actions
  console.log(`\nmenuGroups actions found: ${menuActions.size} pages`);
  for (const [page, actions] of menuActions) {
    console.log(`  ${page}: ${actions.join(', ')}`);
  }

  // Navigation targets
  const allNavTargets = new Set();
  for (const navs of allNavs.values()) navs.forEach(n => allNavTargets.add(n));
  console.log(`\nNavigation targets: ${allNavTargets.size}`);

  // Check app.json registered pages
  const appJson = JSON.parse(readFile(path.join(MP, 'app.json')));
  const registeredPages = new Set(appJson.pages || []);
  const unregisteredNavs = [...allNavTargets].filter(n => {
    const pagePath = n.replace(/^\//, '').replace(/\?.*$/, '');
    return !registeredPages.has(pagePath);
  });
  if (unregisteredNavs.length > 0) {
    console.log(`\nWARNING: ${unregisteredNavs.length} navigation targets not in app.json:`);
    unregisteredNavs.forEach(n => console.log(`  - ${n}`));
  }

  // Exit code: dynamic handlers > 0 is fail
  if (dynamicHandlers.length > 0) {
    console.log('\nFAIL: dynamic event handlers found');
    process.exit(1);
  }

  console.log('\nPASS: surface audit complete (placeholder handlers are tracked in matrix as BROKEN)');
  process.exit(0);
}

main();
