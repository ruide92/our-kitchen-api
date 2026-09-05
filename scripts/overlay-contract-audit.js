#!/usr/bin/env node
// Overlay / Dock Contract Audit — per-overlay independent verification
// No page-wide whitelist, no wxml.includes() pollution
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

  // Build overlay registry by surface_id
  const overlayRegistry = new Map();
  for (const s of registry) {
    if (s.kind === 'overlay' && s.surface_id) {
      overlayRegistry.set(s.surface_id, s);
    }
  }

  // HIDDEN pages skip
  const hiddenPages = new Set(registry.filter(s => s.kind === 'page' && s.status === 'HIDDEN').map(s => s.page));

  const appJson = JSON.parse(readFile(path.join(MP, 'app.json')));
  const allPages = appJson.pages || [];

  // Counters
  let unclassified = 0;
  let knownBroken = 0;
  let globalContract = 0;
  let missingOverlayId = 0;
  let realOverlayContractViolation = 0;
  let secondaryContractViolation = 0;
  const unclassifiedDetails = [];
  const missingIdDetails = [];
  const contractViolationDetails = [];
  const secondaryViolationDetails = [];

  console.log('=== OVERLAY / DOCK CONTRACT AUDIT ===');
  console.log(`Mode: ${mode}`);
  console.log(`Registered overlays: ${overlayRegistry.size}`);

  // Scan all pages (TAB + secondary non-HIDDEN)
  for (const pagePath of allPages) {
    const page = pagePath.split('/').pop();
    if (hiddenPages.has(page)) continue;

    const wxmlPath = path.join(MP, `${pagePath}.wxml`);
    if (!fs.existsSync(wxmlPath)) continue;
    const wxml = readFile(wxmlPath);

    // Find all overlay elements: sheet-mask, sheet-panel, modal
    // Each element: extract data-surface-id and class list
    const overlayRe = /<view[^>]*class="([^"]*)"[^>]*>/g;
    let m;
    // Group by surface_id: { mask: {classes}, panel: {classes} }
    const overlaysById = new Map();

    while ((m = overlayRe.exec(wxml)) !== null) {
      const tag = m[0];
      const classes = m[1].split(/\s+/);
      const isMask = classes.some(c => c.includes('sheet-mask') || c.includes('modal'));
      const isPanel = classes.some(c => c.includes('sheet-panel') || c.includes('modal-panel'));
      if (!isMask && !isPanel) continue;

      const idMatch = tag.match(/data-surface-id="([^"]+)"/);
      const surfaceId = idMatch ? idMatch[1] : null;

      if (!surfaceId) {
        // Only count if it's on a page we audit (TAB or secondary non-HIDDEN)
        missingOverlayId++;
        missingIdDetails.push(`${page}:${isMask ? 'mask' : 'panel'}`);
        console.log(`  [${page}] MISSING data-surface-id on ${isMask ? 'mask' : 'panel'}`);
        continue;
      }

      if (!overlaysById.has(surfaceId)) {
        overlaysById.set(surfaceId, { mask: null, panel: null, page });
      }
      const entry = overlaysById.get(surfaceId);
      if (isMask) entry.mask = { classes };
      if (isPanel) entry.panel = { classes };
    }

    if (overlaysById.size === 0) continue;

    const isTabPage = TAB_PAGES.includes(page);

    for (const [surfaceId, ov] of overlaysById) {
      const reg = overlayRegistry.get(surfaceId);

      if (!reg) {
        unclassified++;
        unclassifiedDetails.push(`${page}:${surfaceId}`);
        console.log(`  [${page}] UNCLASSIFIED: ${surfaceId} (not in registry)`);
        continue;
      }

      const status = reg.status;

      if (status === 'BROKEN' || status === 'KNOWN_BROKEN') {
        knownBroken++;
        console.log(`  [${page}] KNOWN_BROKEN (registered): ${surfaceId}`);
        continue;
      }

      // REAL or PARTIAL: must verify contract independently
      if (isTabPage) {
        // TAB page: mask must have tab-safe-sheet-mask, panel must have tab-safe-sheet-panel
        const maskOk = ov.mask && ov.mask.classes.includes('tab-safe-sheet-mask');
        const panelOk = ov.panel && ov.panel.classes.includes('tab-safe-sheet-panel');
        if (!maskOk || !panelOk) {
          realOverlayContractViolation++;
          const reasons = [];
          if (!maskOk) reasons.push('mask missing tab-safe-sheet-mask');
          if (!panelOk) reasons.push('panel missing tab-safe-sheet-panel');
          contractViolationDetails.push(`${page}:${surfaceId} (${reasons.join(', ')})`);
          console.log(`  [${page}] REAL_OVERLAY_CONTRACT_VIOLATION: ${surfaceId} (${reasons.join(', ')})`);
        } else {
          globalContract++;
          console.log(`  [${page}] GLOBAL_TAB_CONTRACT: ${surfaceId}`);
        }
      } else {
        // Secondary page: mask must have sheet-mask-no-tabbar, panel must have sheet-panel-no-tabbar
        // modal without panel is acceptable (centered modal)
        const maskOk = ov.mask && (ov.mask.classes.includes('sheet-mask-no-tabbar') || ov.mask.classes.some(c => c.endsWith('-modal')));
        const panelOk = !ov.panel || ov.panel.classes.includes('sheet-panel-no-tabbar') || ov.panel.classes.includes('modal-panel');
        if (!maskOk || !panelOk) {
          secondaryContractViolation++;
          const reasons = [];
          if (!maskOk) reasons.push('mask missing sheet-mask-no-tabbar');
          if (!panelOk) reasons.push('panel missing sheet-panel-no-tabbar');
          secondaryViolationDetails.push(`${page}:${surfaceId} (${reasons.join(', ')})`);
          console.log(`  [${page}] SECONDARY_OVERLAY_CONTRACT_VIOLATION: ${surfaceId} (${reasons.join(', ')})`);
        } else {
          console.log(`  [${page}] SECONDARY_CONTRACT_OK: ${surfaceId}`);
        }
      }
    }
  }

  // Registry -> Code: REAL/PARTIAL overlays must exist
  const foundIds = new Set();
  for (const pagePath of allPages) {
    const page = pagePath.split('/').pop();
    if (hiddenPages.has(page)) continue;
    const wxmlPath = path.join(MP, `${pagePath}.wxml`);
    if (!fs.existsSync(wxmlPath)) continue;
    const wxml = readFile(wxmlPath);
    const idRe = /data-surface-id="([^"]+)"/g;
    let m;
    while ((m = idRe.exec(wxml)) !== null) foundIds.add(m[1]);
  }

  const missingRegistered = [];
  for (const [id, reg] of overlayRegistry) {
    if ((reg.status === 'REAL' || reg.status === 'PARTIAL') && !foundIds.has(id)) {
      missingRegistered.push(id);
    }
  }

  // Check app.wxss global classes
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
  console.log(`REAL_OVERLAY_CONTRACT_VIOLATION: ${realOverlayContractViolation}`);
  console.log(`SECONDARY_OVERLAY_CONTRACT_VIOLATION: ${secondaryContractViolation}`);

  // Governance FAIL: unclassified, missing-id, real-contract-violation, secondary-contract-violation, missing-registered
  const governanceFail = unclassified + missingOverlayId + realOverlayContractViolation + secondaryContractViolation + missingRegistered.length;
  if (governanceFail > 0) {
    if (unclassifiedDetails.length > 0) console.log(`\nUnclassified: ${unclassifiedDetails.join(', ')}`);
    if (missingIdDetails.length > 0) console.log(`Missing surface_id: ${missingIdDetails.join(', ')}`);
    if (contractViolationDetails.length > 0) console.log(`REAL overlay violations: ${contractViolationDetails.join(', ')}`);
    if (secondaryViolationDetails.length > 0) console.log(`Secondary overlay violations: ${secondaryViolationDetails.join(', ')}`);
    if (missingRegistered.length > 0) console.log(`Missing registered REAL overlays: ${missingRegistered.join(', ')}`);
    console.log('\nFAIL: governance overlay violations found');
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

  // Release mode: known-broken overlays also fail
  if (mode === 'release' && knownBroken > 0) {
    console.log(`\nFAIL: ${knownBroken} known-broken overlays must be fixed for release`);
    process.exit(1);
  }

  console.log(`\nPASS: overlay audit (${mode} mode, known_broken=${knownBroken} registered by surface_id)`);
  process.exit(0);
}

main();
