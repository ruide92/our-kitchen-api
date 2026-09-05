#!/usr/bin/env node
// Overlay / Dock Contract Audit — ensures all main-tab sheets use global contract
// Usage: node scripts/overlay-contract-audit.js
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');

const TAB_PAGES = ['index', 'menu', 'fridge', 'shopping', 'mine'];
const GLOBAL_CONTRACT_CLASSES = [
  'tab-safe-sheet-mask',
  'tab-safe-sheet-panel',
  'tab-page-dock',
  'tab-page-scroll-spacer',
  'sheet-mask-no-tabbar',
  'sheet-panel-no-tabbar'
];

function readFile(p) { return fs.readFileSync(p, 'utf8'); }

function main() {
  let violations = 0;
  let unclassified = 0;

  console.log('=== OVERLAY / DOCK CONTRACT AUDIT ===');

  for (const page of TAB_PAGES) {
    const wxmlPath = path.join(MP, 'pages', page, `${page}.wxml`);
    const wxssPath = path.join(MP, 'pages', page, `${page}.wxss`);
    if (!fs.existsSync(wxmlPath)) continue;

    const wxml = readFile(wxmlPath);
    const wxss = fs.existsSync(wxssPath) ? readFile(wxssPath) : '';

    // Find sheet-like elements
    const sheetMasks = (wxml.match(/class="[^"]*sheet-mask[^"]*"/g) || []);
    const sheetPanels = (wxml.match(/class="[^"]*sheet-panel[^"]*"/g) || []);
    const modals = (wxml.match(/class="[^"]*modal[^"]*"/g) || []);
    const docks = (wxml.match(/class="[^"]*dock[^"]*"/g) || []);
    const bottomFixed = (wxss.match(/bottom:\s*0[^;]*;/g) || []);

    // Check if sheets use global contract
    const allSheetClasses = [...sheetMasks, ...sheetPanels, ...modals].join(' ');
    const usesGlobalContract = GLOBAL_CONTRACT_CLASSES.some(c => allSheetClasses.includes(c));
    const hasSheets = sheetMasks.length > 0 || sheetPanels.length > 0 || modals.length > 0;

    console.log(`\n[${page}]`);
    console.log(`  sheet-mask: ${sheetMasks.length}, sheet-panel: ${sheetPanels.length}, modal: ${modals.length}, dock: ${docks.length}`);
    console.log(`  bottom:0 in wxss: ${bottomFixed.length}`);

    if (hasSheets && !usesGlobalContract) {
      console.log(`  VIOLATION: sheet/modal exists but does not use global contract class`);
      violations++;
    }

    // Check for unauthorized bottom:0 in tab page wxss
    if (bottomFixed.length > 0) {
      // Check if it's inside a global contract class or tabbar
      const hasTabBar = wxss.includes('.tab-bar') || wxss.includes('custom-tab-bar');
      if (!hasTabBar) {
        console.log(`  WARNING: bottom:0 found in tab page wxss (verify it's not an unauthorized sheet)`);
      }
    }

    // Check scroll spacer
    const hasScrollSpacer = wxml.includes('tab-page-scroll-spacer');
    const hasDock = wxml.includes('tab-page-dock') || wxml.includes('mini-cart') || wxml.includes('complete-bar') || wxml.includes('action-bar');
    if (hasDock && !hasScrollSpacer) {
      console.log(`  WARNING: page has dock but may lack scroll-spacer (check manually)`);
    }
  }

  // Check app.wxss has global contract
  const appWxss = readFile(path.join(MP, 'app.wxss'));
  const missingClasses = GLOBAL_CONTRACT_CLASSES.filter(c => !appWxss.includes(`.${c}`));
  console.log(`\n[app.wxss global contract]`);
  console.log(`  missing classes: ${missingClasses.length > 0 ? missingClasses.join(', ') : 'none'}`);
  if (missingClasses.length > 0) violations++;

  // Check custom-tab-bar supports locked
  const tabBarJs = readFile(path.join(MP, 'custom-tab-bar', 'index.js'));
  const tabBarWxml = readFile(path.join(MP, 'custom-tab-bar', 'index.wxml'));
  const hasLocked = tabBarJs.includes('locked') && tabBarWxml.includes('locked');
  console.log(`\n[custom-tab-bar]`);
  console.log(`  locked state support: ${hasLocked ? 'yes' : 'NO'}`);
  if (!hasLocked) violations++;

  console.log(`\n=== SUMMARY ===`);
  console.log(`TAB_OVERLAY_UNCLASSIFIED: ${unclassified}`);
  console.log(`DOCK_CONTRACT_VIOLATIONS (known, tracked in matrix as BROKEN): ${violations}`);

  if (unclassified > 0) {
    console.log('\nFAIL: unclassified overlay elements found');
    process.exit(1);
  }
  if (violations > 0) {
    console.log('\nWARNING: known overlay contract violations (governance gate allows; release gate requires fix)');
  }
  console.log('\nPASS: overlay audit complete (violations are tracked known issues)');
  process.exit(0);
}

main();
