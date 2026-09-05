#!/usr/bin/env node
// Overlay / Dock Contract Audit — classifies all sheets/docks and enforces global contract
// Usage: node scripts/overlay-contract-audit.js [--mode=governance|release]
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');

const mode = process.argv.find(a => a.startsWith('--mode='))?.split('=')[1] || 'governance';

const TAB_PAGES = ['index', 'menu', 'fridge', 'shopping', 'mine'];
const GLOBAL_CONTRACT_CLASSES = [
  'tab-safe-sheet-mask', 'tab-safe-sheet-panel',
  'tab-page-dock', 'tab-page-scroll-spacer',
  'sheet-mask-no-tabbar', 'sheet-panel-no-tabbar'
];

// Known broken sheets — these are tracked in PRODUCT_SURFACE_MATRIX as BROKEN
const KNOWN_BROKEN_PAGES = ['menu', 'fridge', 'shopping', 'mine'];

function readFile(p) { return fs.readFileSync(p, 'utf8'); }

function classifySheet(page, wxml, wxss) {
  const classifications = [];

  const sheetMasks = (wxml.match(/class="[^"]*sheet-mask[^"]*"/g) || []);
  const sheetPanels = (wxml.match(/class="[^"]*sheet-panel[^"]*"/g) || []);
  const modals = (wxml.match(/class="[^"]*modal[^"]*"/g) || []);
  const docks = (wxml.match(/class="[^"]*(?:dock|mini-cart|complete-bar|action-bar)[^"]*"/g) || []);

  const allSheetClasses = [...sheetMasks, ...sheetPanels, ...modals].join(' ');
  const usesGlobalContract = GLOBAL_CONTRACT_CLASSES.some(c => allSheetClasses.includes(c));

  if (sheetMasks.length > 0 || sheetPanels.length > 0 || modals.length > 0) {
    if (usesGlobalContract) {
      classifications.push({ type: 'SHEET', classification: 'GLOBAL_TAB_CONTRACT', count: sheetMasks.length + sheetPanels.length + modals.length });
    } else if (KNOWN_BROKEN_PAGES.includes(page)) {
      classifications.push({ type: 'SHEET', classification: 'KNOWN_BROKEN', count: sheetMasks.length + sheetPanels.length + modals.length });
    } else {
      classifications.push({ type: 'SHEET', classification: 'UNCLASSIFIED', count: sheetMasks.length + sheetPanels.length + modals.length });
    }
  }

  if (docks.length > 0) {
    const usesDockContract = wxml.includes('tab-page-dock') || wxml.includes('page-dock-no-tabbar');
    if (usesDockContract) {
      classifications.push({ type: 'DOCK', classification: 'GLOBAL_TAB_CONTRACT', count: docks.length });
    } else if (KNOWN_BROKEN_PAGES.includes(page)) {
      classifications.push({ type: 'DOCK', classification: 'KNOWN_BROKEN', count: docks.length });
    } else {
      classifications.push({ type: 'DOCK', classification: 'UNCLASSIFIED', count: docks.length });
    }
  }

  // Check for unauthorized bottom:0 in tab page wxss
  const bottomZero = (wxss.match(/bottom:\s*0[^;]*;/g) || []);
  const hasTabBarClass = wxss.includes('.tab-bar') || wxss.includes('custom-tab-bar');
  if (bottomZero.length > 0 && !hasTabBarClass && TAB_PAGES.includes(page)) {
    classifications.push({ type: 'BOTTOM_ZERO', classification: 'REVIEW_REQUIRED', count: bottomZero.length });
  }

  return classifications;
}

function main() {
  let unclassified = 0;
  let knownBroken = 0;
  let globalContract = 0;
  let reviewRequired = 0;

  console.log('=== OVERLAY / DOCK CONTRACT AUDIT ===');
  console.log(`Mode: ${mode}`);

  for (const page of TAB_PAGES) {
    const wxmlPath = path.join(MP, 'pages', page, `${page}.wxml`);
    const wxssPath = path.join(MP, 'pages', page, `${page}.wxss`);
    if (!fs.existsSync(wxmlPath)) continue;

    const wxml = readFile(wxmlPath);
    const wxss = fs.existsSync(wxssPath) ? readFile(wxssPath) : '';
    const classifications = classifySheet(page, wxml, wxss);

    console.log(`\n[${page}]`);
    for (const c of classifications) {
      console.log(`  ${c.type}: ${c.classification} (${c.count})`);
      if (c.classification === 'UNCLASSIFIED') unclassified += c.count;
      else if (c.classification === 'KNOWN_BROKEN') knownBroken += c.count;
      else if (c.classification === 'GLOBAL_TAB_CONTRACT') globalContract += c.count;
      else if (c.classification === 'REVIEW_REQUIRED') reviewRequired += c.count;
    }
  }

  // Check app.wxss
  const appWxss = readFile(path.join(MP, 'app.wxss'));
  const missingClasses = GLOBAL_CONTRACT_CLASSES.filter(c => !appWxss.includes(`.${c}`));
  console.log(`\n[app.wxss] missing global classes: ${missingClasses.length > 0 ? missingClasses.join(', ') : 'none'}`);

  // Check custom-tab-bar
  const tabBarJs = readFile(path.join(MP, 'custom-tab-bar', 'index.js'));
  const tabBarWxml = readFile(path.join(MP, 'custom-tab-bar', 'index.wxml'));
  const hasLocked = tabBarJs.includes('locked') && tabBarWxml.includes('locked');
  console.log(`[custom-tab-bar] locked support: ${hasLocked ? 'yes' : 'NO'}`);

  console.log(`\n=== SUMMARY ===`);
  console.log(`GLOBAL_TAB_CONTRACT: ${globalContract}`);
  console.log(`KNOWN_BROKEN (tracked in matrix): ${knownBroken}`);
  console.log(`UNCLASSIFIED: ${unclassified}`);
  console.log(`REVIEW_REQUIRED: ${reviewRequired}`);

  if (unclassified > 0) {
    console.log('\nFAIL: unclassified overlay elements found');
    process.exit(1);
  }

  if (mode === 'release' && knownBroken > 0) {
    console.log(`\nFAIL: ${knownBroken} known broken overlays must be fixed for release`);
    process.exit(1);
  }

  if (missingClasses.length > 0) {
    console.log('\nFAIL: missing global contract classes in app.wxss');
    process.exit(1);
  }

  if (!hasLocked) {
    console.log('\nFAIL: custom-tab-bar missing locked state support');
    process.exit(1);
  }

  console.log(`\nPASS: overlay audit (${mode} mode, known_broken=${knownBroken} tracked)`);
  process.exit(0);
}

main();
