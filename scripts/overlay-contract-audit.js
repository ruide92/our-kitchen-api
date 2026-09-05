#!/usr/bin/env node
// Overlay / Dock Contract Audit — uses product-surfaces.json for known-broken whitelist
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

function main() {
  const registry = loadRegistry();

  // Build known-broken overlay whitelist from registry (status=KNOWN_BROKEN or BROKEN)
  const knownBrokenOverlays = new Set(
    registry.filter(s => s.kind === 'overlay' && (s.status === 'KNOWN_BROKEN' || s.status === 'BROKEN')).map(s => s.page)
  );
  const globalContractOverlays = new Set(
    registry.filter(s => s.kind === 'overlay' && s.status === 'REAL').map(s => s.page)
  );

  let unclassified = 0;
  let knownBroken = 0;
  let globalContract = 0;
  let bottomZeroViolations = 0;

  console.log('=== OVERLAY / DOCK CONTRACT AUDIT ===');
  console.log(`Mode: ${mode}`);
  console.log(`Known-broken overlay pages (from registry): ${[...knownBrokenOverlays].join(', ') || 'none'}`);
  console.log(`Global-contract overlay pages (from registry): ${[...globalContractOverlays].join(', ') || 'none'}`);

  for (const page of TAB_PAGES) {
    const wxmlPath = path.join(MP, 'pages', page, `${page}.wxml`);
    const wxssPath = path.join(MP, 'pages', page, `${page}.wxss`);
    if (!fs.existsSync(wxmlPath)) continue;

    const wxml = readFile(wxmlPath);
    const wxss = fs.existsSync(wxssPath) ? readFile(wxssPath) : '';

    const hasSheet = /class="[^"]*(sheet-mask|sheet-panel|modal)[^"]*"/.test(wxml);
    const hasDock = /class="[^"]*(dock|mini-cart|complete-bar|action-bar)[^"]*"/.test(wxml);
    const usesGlobalContract = GLOBAL_CONTRACT_CLASSES.some(c => wxml.includes(c));
    const bottomZero = (wxss.match(/(?:^|[\s{])bottom:\s*0[^;]*;/g) || []).length;

    console.log(`\n[${page}]`);
    console.log(`  sheet: ${hasSheet ? 'yes' : 'no'}, dock: ${hasDock ? 'yes' : 'no'}`);
    console.log(`  global contract classes: ${usesGlobalContract ? 'yes' : 'no'}`);
    console.log(`  bottom:0 in wxss: ${bottomZero}`);

    if (hasSheet || hasDock) {
      if (usesGlobalContract) {
        globalContract++;
        console.log(`  -> GLOBAL_TAB_CONTRACT`);
      } else if (knownBrokenOverlays.has(page)) {
        knownBroken++;
        console.log(`  -> KNOWN_BROKEN (registered in product-surfaces.json)`);
      } else {
        unclassified++;
        console.log(`  -> UNCLASSIFIED (not in registry!)`);
      }
    }

    // bottom:0 check
    if (bottomZero > 0 && TAB_PAGES.includes(page)) {
      const hasTabBarClass = wxss.includes('.tab-bar') || wxss.includes('custom-tab-bar');
      if (!hasTabBarClass) {
        if (knownBrokenOverlays.has(page)) {
          console.log(`  -> bottom:0 on known-broken page (tracked)`);
        } else {
          bottomZeroViolations++;
          console.log(`  -> bottom:0 VIOLATION (unregistered)`);
        }
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
  console.log(`KNOWN_BROKEN (registered): ${knownBroken}`);
  console.log(`UNCLASSIFIED: ${unclassified}`);
  console.log(`BOTTOM_ZERO_UNREGISTERED: ${bottomZeroViolations}`);

  if (unclassified > 0 || bottomZeroViolations > 0) {
    console.log('\nFAIL: unclassified overlay elements found');
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

  if (mode === 'release' && knownBroken > 0) {
    console.log(`\nFAIL: ${knownBroken} known-broken overlays must be fixed for release`);
    process.exit(1);
  }

  console.log(`\nPASS: overlay audit (${mode} mode, known_broken=${knownBroken} registered)`);
  process.exit(0);
}

main();
