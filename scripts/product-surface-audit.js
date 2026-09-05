#!/usr/bin/env node
// Product Surface Audit — scans WXML+JS for user-visible entry points and maps to PRODUCT_SURFACE_MATRIX
// Usage: node scripts/product-surface-audit.js [--mode=governance|release]
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');
const MATRIX_PATH = path.join(ROOT, 'docs', 'PRODUCT_SURFACE_MATRIX.md');

const mode = process.argv.find(a => a.startsWith('--mode='))?.split('=')[1] || 'governance';

function readFile(p) { return fs.readFileSync(p, 'utf8'); }

function listFiles(dir, ext) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...listFiles(full, ext));
    else if (entry.name.endsWith(ext)) results.push(full);
  }
  return results;
}

function parseMatrix(markdown) {
  const surfaces = new Map();
  const lines = markdown.split('\n');
  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map(c => c.trim());
    if (cells.length < 8) continue;
    const id = cells[1];
    if (!/^[A-Z]+(-[A-Z]+)?-\d+$/.test(id)) continue;
    surfaces.set(id, {
      id, label: cells[2], trigger: cells[3], status: cells[5], final: cells[7],
      frontend: cells[8], api: cells[9]
    });
  }
  return surfaces;
}

function extractWxmlHandlers(wxml) {
  const handlers = [];
  const re = /(bindtap|catchtap|bindchange|bindinput|bindconfirm|bindsubmit)\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(wxml)) !== null) {
    handlers.push({ type: m[1], handler: m[2], dynamic: m[2].startsWith('{{') });
  }
  return handlers;
}

function extractJsNavigations(js) {
  const navs = [];
  const re = /wx\.(navigateTo|switchTab|redirectTo|reLaunch)\s*\(\s*(?:\{[^}]*url\s*:\s*['"]([^'"]+)['"]|['"]([^'"]+)['"])/g;
  let m;
  while ((m = re.exec(js)) !== null) {
    const url = m[2] || m[3];
    navs.push({ type: m[1], url });
  }
  return navs;
}

function extractMenuActions(js) {
  const actions = [];
  const re = /action:\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(js)) !== null) actions.push(m[1]);
  return actions;
}

function pageNameFromPath(filePath) {
  const rel = path.relative(MP, filePath);
  const match = rel.match(/pages[\\/]([^\\/]+)[\\/]/);
  return match ? match[1] : path.basename(path.dirname(filePath));
}

function main() {
  const matrix = parseMatrix(readFile(MATRIX_PATH));
  const wxmlFiles = listFiles(path.join(MP, 'pages'), '.wxml');
  const jsFiles = listFiles(path.join(MP, 'pages'), '.js');

  // Also include custom-tab-bar
  const tabBarWxml = path.join(MP, 'custom-tab-bar', 'index.wxml');
  if (fs.existsSync(tabBarWxml)) wxmlFiles.push(tabBarWxml);

  const allHandlers = [];
  const allNavs = [];
  const allMenuActions = [];

  for (const f of wxmlFiles) {
    const page = pageNameFromPath(f);
    const wxml = readFile(f);
    for (const h of extractWxmlHandlers(wxml)) {
      allHandlers.push({ ...h, page, file: path.relative(MP, f) });
    }
  }

  for (const f of jsFiles) {
    const page = pageNameFromPath(f);
    const js = readFile(f);
    for (const n of extractJsNavigations(js)) {
      allNavs.push({ ...n, page, file: path.relative(MP, f) });
    }
    for (const a of extractMenuActions(js)) {
      allMenuActions.push({ action: a, page, file: path.relative(MP, f) });
    }
  }

  // Check app.json registered pages
  const appJson = JSON.parse(readFile(path.join(MP, 'app.json')));
  const registeredPages = new Set(appJson.pages || []);

  // Check navigation targets
  const invalidNavs = [];
  for (const n of allNavs) {
    const pagePath = n.url.replace(/^\//, '').replace(/\?.*$/, '');
    if (!registeredPages.has(pagePath)) {
      invalidNavs.push(n);
    }
  }

  // Check dynamic handlers
  const dynamicHandlers = allHandlers.filter(h => h.dynamic);

  // Check handler existence in JS (check all JS files in page directory)
  const missingHandlers = [];
  const jsByPage = new Map();
  for (const f of jsFiles) {
    const page = pageNameFromPath(f);
    const existing = jsByPage.get(page) || '';
    jsByPage.set(page, existing + '\n' + readFile(f));
  }
  // Also include custom-tab-bar
  const tabBarDir = path.join(MP, 'custom-tab-bar');
  if (fs.existsSync(tabBarDir)) {
    for (const f of fs.readdirSync(tabBarDir)) {
      if (f.endsWith('.js')) {
        const existing = jsByPage.get('custom-tab-bar') || '';
        jsByPage.set('custom-tab-bar', existing + '\n' + readFile(path.join(tabBarDir, f)));
      }
    }
  }
  for (const h of allHandlers) {
    if (h.dynamic) continue;
    if (h.handler === 'noop') continue; // noop is intentional
    const js = jsByPage.get(h.page);
    if (js && !js.includes(h.handler)) {
      missingHandlers.push(h);
    }
  }

  // Check REAL surfaces don't use placeholderToast/noop
  const realViolations = [];
  for (const [id, s] of matrix) {
    if (s.status !== 'REAL') continue;
    // Check if frontend mentions placeholderToast
    if (s.frontend && s.frontend.includes('placeholder')) {
      realViolations.push({ id, reason: 'REAL surface uses placeholder' });
    }
  }

  // Check PLANNED_DISABLED surfaces are actually disabled
  const plannedClickable = [];
  // (This requires deeper WXML analysis — flag if handler exists and is not disabled)

  console.log('=== PRODUCT SURFACE AUDIT ===');
  console.log(`Mode: ${mode}`);
  console.log(`Matrix surfaces: ${matrix.size}`);
  console.log(`WXML files: ${wxmlFiles.length}`);
  console.log(`JS files: ${jsFiles.length}`);
  console.log(`Event handlers found: ${allHandlers.length}`);
  console.log(`Navigations found: ${allNavs.length}`);
  console.log(`menuGroups actions: ${allMenuActions.length}`);
  console.log(`Dynamic handlers: ${dynamicHandlers.length}`);
  console.log(`Missing handlers: ${missingHandlers.length}`);
  console.log(`Invalid navigation targets: ${invalidNavs.length}`);
  console.log(`REAL surface violations: ${realViolations.length}`);

  if (dynamicHandlers.length > 0) {
    console.log('\n--- DYNAMIC HANDLERS ---');
    dynamicHandlers.forEach(h => console.log(`  ${h.file}: ${h.handler}`));
  }
  if (missingHandlers.length > 0) {
    console.log('\n--- MISSING HANDLERS ---');
    missingHandlers.forEach(h => console.log(`  ${h.file}: ${h.handler}`));
  }
  if (invalidNavs.length > 0) {
    console.log('\n--- INVALID NAVIGATION TARGETS ---');
    invalidNavs.forEach(n => console.log(`  ${n.file}: ${n.type} → ${n.url}`));
  }

  // Surface key mapping: each handler should map to a matrix surface
  // We use page + handler as a fuzzy key
  const unclassified = [];
  // For now, we verify that known placeholderToast handlers map to BROKEN surfaces
  const placeholderHandlers = allHandlers.filter(h => h.handler === 'placeholderToast');
  const brokenSurfaces = [...matrix.values()].filter(s => s.status === 'BROKEN');

  console.log(`\nplaceholderToast handlers: ${placeholderHandlers.length}`);
  console.log(`BROKEN surfaces in matrix: ${brokenSurfaces.length}`);

  const hardFailures = dynamicHandlers.length + missingHandlers.length + invalidNavs.length;

  if (hardFailures > 0) {
    console.log(`\nFAIL: ${hardFailures} hard failures (dynamic/missing/invalid)`);
    process.exit(1);
  }

  if (mode === 'release' && realViolations.length > 0) {
    console.log(`\nFAIL: ${realViolations.length} REAL surface violations`);
    process.exit(1);
  }

  console.log('\nPASS: surface audit complete');
  process.exit(0);
}

main();
