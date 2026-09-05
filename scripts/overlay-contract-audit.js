#!/usr/bin/env node
// Overlay / Dock Contract Audit — exact surface_id matching, no page-wide whitelist
// Usage: node scripts/overlay-contract-audit.js [--mode=governance|release]
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const MP = path.join(ROOT, 'miniprogram');
const REGISTRY_PATH = path.join(ROOT, 'governance', 'product-surfaces.json');

const mode = process.argv.find(a => a.startsWith('--mode='))?.split('=')[1] || 'governance';

const TAB_PAGES = ['index', 'menu', 'fridge', 'shopping', 'mine'];
const GLOBAL_CONTRACT_CLASSES = [
  'tab-safe-sheet-mask', 'tab-safe-sheet-panel',
  'tab-page-dock', 'tab-page-scroll-spacer',
  'sheet-mask-no-tabbar', 'sheet-panel-no-tabbar'
];

function readFile(p) { return fs.readFileSync(p, 'utf8'); }

function loadRegistry() {
  const data = JSON.parse(readFile(REGISTRY_PATH));
  return data.surfaces || [];
}

function pageNameFromPath(filePath) {
  const rel = path.relative(MP, filePath);
  const match = rel.match(/pages[\\/]([^\\/]+)[\\/]/);
  return match ? match[1] : path.basename(path.dirname(filePath));
}

function main() {
  const registry = loadRegistry();

  // Build overlay registry by surface_id
  const overlayRegistry = new Map(); // surface_id -> registry entry
  for (const s of registry) {
    if (s.kind === 'overlay' && s.surface_id) {
      overlayRegistry.set(s.surface_id, s);
    }
  }

  let unclassified = 0;
  let knownBroken = 0;
  let globalContract = 0;
  let missingOverlayId = 0;
  const unclassifiedDetails = [];
  const missingIdDetails = [];

  console.log('=== OVERLAY / DOCK CONTRACT AUDIT ===');
  console.log(`Mode: ${mode}`);
  console.log(`Registered overlays: ${overlayRegistry.size}`);

  for (const page of TAB_PAGES) {
    const wxmlPath = path.join(MP, 'pages', page, `${page}.wxml`);
    const wxssPath = path.join(MP, 'pages', page, `${page}.wxss`);
    if (!fs.existsSync(wxmlPath)) continue;

    const wxml = readFile(wxmlPath);
    const wxss = fs.existsSync(wxssPath) ? readFile(wxssPath) : '';

    // Find all sheet-mask / modal elements and read their data-surface-id
    const overlayRe = /<view[^>]*class="[^"]*(sheet-mask|modal)[^"]*"[^>]*>/g;
    let m;
    const pageOverlays = [];
    while ((m = overlayRe.exec(wxml)) !== null) {
      const tag = m[0];
      const idMatch = tag.match(/data-surface-id="([^"]+)"/);
      const surfaceId = idMatch ? idMatch[1] : null;
      const usesGlobal = GLOBAL_CONTRACT_CLASSES.some(c => tag.includes(c)) || wxml.includes('tab-safe-sheet');
      pageOverlays.push({ surfaceId, usesGlobal });
    }

    if (pageOverlays.length === 0) continue;

    console.log(`\n[${page}] overlays: ${pageOverlays.length}`);

    for (const ov of pageOverlays) {
      if (!ov.surfaceId) {
        missingOverlayId++;
        missingIdDetails.push(page);
        console.log(`  -> MISSING data-surface-id (${page})`);
        continue;
      }

      const reg = overlayRegistry.get(ov.surfaceId);
      if (!reg) {
        unclassified++;
        unclassifiedDetails.push(`${page}:${ov.surfaceId}`);
        console.log(`  -> UNCLASSIFIED: ${ov.surfaceId} (not in registry!)`);
      } else if (reg.status === 'REAL') {
        globalContract++;
        console.log(`  -> GLOBAL_TAB_CONTRACT: ${ov.surfaceId}`);
      } else if (reg.status === 'KNOWN_BROKEN' || reg.status === 'BROKEN') {
        knownBroken++;
        console.log(`  -> KNOWN_BROKEN (registered): ${ov.surfaceId}`);
      } else {
        unclassified++;
        unclassifiedDetails.push(`${page}:${ov.surfaceId} [${reg.status}]`);
        console.log(`  -> UNCLASSIFIED status: ${ov.surfaceId} [${reg.status}]`);
      }
    }
  }

  // Registry -> Code: check registered REAL overlays exist in code
  const registeredOverlayIds = new Set();
  for (const page of TAB_PAGES) {
    const wxmlPath = path.join(MP, 'pages', page, `${page}.wxml`);
    if (!fs.existsSync(wxmlPath)) continue;
    const wxml = readFile(wxmlPath);
    const idRe = /data-surface-id="([^"]+)"/g;
    let m;
    while ((m = idRe.exec(wxml)) !== null) {
      registeredOverlayIds.add(m[1]);
    }
  }

  const missingRegistered = [];
  for (const [id, reg] of overlayRegistry) {
    if (reg.status === 'REAL' || reg.status === 'PARTIAL') {
      if (!registeredOverlayIds.has(id)) {
        missingRegistered.push(id);
      }
    }
  }

  // Check app.wxss
  const appWxss = readFile(path.join(MP, 'app.wxss'));
  const missingClasses = GLOBAL_CONTRACT_CLASSES.filter(c => !appWxss.includes(`.${c}`));
  console.log(`\n[app.wxss] missing global classes: ${missingClasses.length > 0 ? missingClasses.join(', ') : 'none'}`);

  // Check custom-tab-bar locked
  const tabBarJs = readFile(path.join(MP, 'custom-tab-bar', 'index.js'));
  const tabBarWxml = readFile(path.join(MP, 'custom-tab-bar', 'index.wxml'));
  const hasLocked = tabBarJs.includes('locked') && tabBarWxml.includes('locked');
  console.log(`[custom-tab-bar] locked support: ${hasLocked ? 'yes' : 'NO'}`);

  console.log(`\n=== SUMMARY ===`);
  console.log(`GLOBAL_TAB_CONTRACT: ${globalContract}`);
  console.log(`KNOWN_BROKEN (registered by surface_id): ${knownBroken}`);
  console.log(`UNCLASSIFIED: ${unclassified}`);
  console.log(`MISSING_SURFACE_ID: ${missingOverlayId}`);
  console.log(`MISSING_REGISTERED_OVERLAY: ${missingRegistered.length}`);

  const hardFail = unclassified + missingOverlayId;
  if (hardFail > 0) {
    if (unclassifiedDetails.length > 0) console.log(`\nUnclassified: ${unclassifiedDetails.join(', ')}`);
    if (missingIdDetails.length > 0) console.log(`Missing surface_id: ${missingIdDetails.join(', ')}`);
    console.log('\nFAIL: unclassified or missing-id overlay elements found');
    process.exit(1);
  }

  if (missingClasses.length > 0) {
    console.log('\nFAIL: missing global contract classes in app.wxss');
    process.exit(1);
  }

  if (!hasLocked) {
    console.log('\nFAIL: custom-tab-bar missing locked state');
    process.exit(1);
  }

  if (missingRegistered.length > 0) {
    console.log(`\nFAIL: registered REAL overlays not found in code: ${missingRegistered.join(', ')}`);
    process.exit(1);
  }

  if (mode === 'release' && knownBroken > 0) {
    console.log(`\nFAIL: ${knownBroken} known-broken overlays must be fixed for release`);
    process.exit(1);
  }

  console.log(`\nPASS: overlay audit (${mode} mode, known_broken=${knownBroken} registered by surface_id)`);
  process.exit(0);
}

main();
