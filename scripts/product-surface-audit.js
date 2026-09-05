#!/usr/bin/env node
// Product Surface Audit — bidirectional mapping + handler existence + REAL truth enforcement
// Single source of truth: governance/product-surfaces.json
// Usage: node scripts/product-surface-audit.js [--mode=governance|release]
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const MP = path.join(ROOT, 'miniprogram');
const REGISTRY_PATH = path.join(ROOT, 'governance', 'product-surfaces.json');

const mode = process.argv.find(a => a.startsWith('--mode='))?.split('=')[1] || 'governance';

function readFile(p) { return fs.readFileSync(p, 'utf8'); }

function walk(dir, ext) {
  let r = [];
  if (!fs.existsSync(dir)) return r;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) r.push(...walk(f, ext));
    else if (e.name.endsWith(ext)) r.push(f);
  }
  return r;
}

function pageNameFromPath(filePath) {
  const rel = path.relative(MP, filePath);
  const match = rel.match(/pages[\\/]([^\\/]+)[\\/]/);
  return match ? match[1] : path.basename(path.dirname(filePath));
}

function loadRegistry() {
  const raw = readFile(REGISTRY_PATH);
  const data = JSON.parse(raw);
  return data.surfaces || [];
}

// Collect all JS source for a page (page.js + *-controller.js + other modules in same dir)
function collectPageJs(page) {
  const pageDir = path.join(MP, 'pages', page);
  let js = '';
  if (fs.existsSync(pageDir)) {
    for (const f of fs.readdirSync(pageDir)) {
      if (f.endsWith('.js')) {
        js += '\n' + readFile(path.join(pageDir, f));
      }
    }
  }
  // Also check utils if handler is imported from there
  const utilsDir = path.join(MP, 'utils');
  if (fs.existsSync(utilsDir)) {
    for (const f of fs.readdirSync(utilsDir)) {
      if (f.endsWith('.js')) {
        js += '\n' + readFile(path.join(utilsDir, f));
      }
    }
  }
  return js;
}

function handlerExistsInJs(js, handler) {
  // Match: handlerName( or handlerName: function or handlerName() { or "handlerName"
  const patterns = [
    new RegExp(`${handler}\\s*\\(`),
    new RegExp(`${handler}\\s*:\\s*function`),
    new RegExp(`${handler}\\s*:\\s*\\(`),
    new RegExp(`${handler}\\s*\\(\\s*\\)`),
  ];
  return patterns.some(p => p.test(js));
}

function isPlaceholderImplementation(js, handler) {
  if (handler === 'placeholderToast') return true;
  // Check if handler body is just showToast with 待接入/规划中/未实现
  const re = new RegExp(`${handler}\\s*[(:][\\s\\S]{0,300}?(showToast|wx\\.showToast)[\\s\\S]{0,150}?(待接入|规划中|未实现|coming soon)`, 'i');
  return re.test(js);
}

function isEmptyImplementation(js, handler) {
  // Handler exists but body is empty or just return
  const re = new RegExp(`${handler}\\s*[(:][\\s\\S]{0,100}?\\{[\\s\\S]{0,50}?\\}`);
  const match = js.match(re);
  if (!match) return false;
  const body = match[0];
  // Empty body or only comments/whitespace
  return /\{\s*(\/\/[^\n]*\n|\s)*\}/.test(body) || /\{\s*return;\s*\}/.test(body);
}

function scanCode() {
  const wxmlFiles = walk(path.join(MP, 'pages'), '.wxml');
  const jsFiles = walk(path.join(MP, 'pages'), '.js');

  const detected = [];

  // Scan WXML handlers
  for (const f of wxmlFiles) {
    const page = pageNameFromPath(f);
    const wxml = readFile(f);
    const re = /(bindtap|catchtap|bindchange|bindinput|bindconfirm|bindsubmit)\s*=\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(wxml)) !== null) {
      detected.push({ page, kind: 'wxml-handler', handler: m[2], file: path.relative(MP, f) });
    }
  }

  // Scan JS navigations
  for (const f of jsFiles) {
    const page = pageNameFromPath(f);
    const js = readFile(f);
    const navRe = /wx\.(navigateTo|switchTab|redirectTo|reLaunch)\s*\(\s*\{[^}]*url\s*:\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = navRe.exec(js)) !== null) {
      const url = m[2].replace(/\?.*$/, '');
      detected.push({ page, kind: 'navigation', handler: m[1], url, file: path.relative(MP, f) });
    }
  }

  // Scan menuGroups (mine-controller.js pattern)
  for (const f of jsFiles) {
    const page = pageNameFromPath(f);
    const js = readFile(f);
    const menuRe = /name\s*:\s*['"]([^'"]+)['"][\s\S]*?action\s*:\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = menuRe.exec(js)) !== null) {
      detected.push({ page, kind: 'menu-action', label: m[1], action: m[2], file: path.relative(MP, f) });
    }
  }

  // Scan overlay/sheet elements in WXML — read data-surface-id for exact matching
  for (const f of wxmlFiles) {
    const page = pageNameFromPath(f);
    const wxml = readFile(f);
    const overlayRe = /<view[^>]*class="[^"]*(sheet-mask|sheet-panel|modal)[^"]*"[^>]*>/g;
    let m;
    while ((m = overlayRe.exec(wxml)) !== null) {
      const tag = m[0];
      const idMatch = tag.match(/data-surface-id="([^"]+)"/);
      const surfaceId = idMatch ? idMatch[1] : null;
      // Only count sheet-mask as the overlay root (avoid double-counting mask+panel)
      if (tag.includes('sheet-mask') || tag.includes('modal')) {
        detected.push({ page, kind: 'overlay', handler: 'sheet', surface_id: surfaceId, file: path.relative(MP, f) });
      }
    }
  }

  return { detected, wxmlFiles, jsFiles };
}

function buildKey(surface) {
  if (surface.kind === 'wxml-handler') return `${surface.page}:wxml-handler:${surface.handler}`;
  if (surface.kind === 'navigation') return `${surface.page}:navigation:${surface.handler}:${surface.url}`;
  if (surface.kind === 'menu-action') return `${surface.page}:menu-action:${surface.label}`;
  if (surface.kind === 'overlay') return `${surface.page}:overlay:${surface.surface_id || surface.handler}`;
  if (surface.kind === 'dock') return `${surface.page}:dock:${surface.handler}`;
  if (surface.kind === 'page') return `page:${surface.page}`;
  if (surface.kind === 'internal-guard') return `internal:${surface.page}:${surface.handler}`;
  return `${surface.page}:${surface.kind}:${surface.handler || surface.id}`;
}

function buildDetectedKey(d) {
  if (d.kind === 'wxml-handler') return `${d.page}:wxml-handler:${d.handler}`;
  if (d.kind === 'navigation') return `${d.page}:navigation:${d.handler}:${d.url}`;
  if (d.kind === 'menu-action') return `${d.page}:menu-action:${d.label}`;
  if (d.kind === 'overlay') return `${d.page}:overlay:${d.surface_id || d.handler}`;
  return `${d.page}:${d.kind}:${d.handler || ''}`;
}

function main() {
  const registry = loadRegistry();
  const { detected, wxmlFiles, jsFiles } = scanCode();

  // Build registry lookup
  const registryByKey = new Map();
  const duplicates = [];
  const hiddenPages = new Set();
  for (const s of registry) {
    if (s.kind === 'page' && s.status === 'HIDDEN') hiddenPages.add(s.page);
    if (s.kind === 'internal-guard') continue; // skip internal guards from mapping
    const key = buildKey(s);
    if (registryByKey.has(key)) {
      duplicates.push({ key, ids: [registryByKey.get(key).id, s.id] });
    } else {
      registryByKey.set(key, s);
    }
  }

  // Code -> Registry: detect unclassified
  const unclassified = [];
  const detectedKeys = new Set();
  for (const d of detected) {
    if (hiddenPages.has(d.page)) continue;
    // internal-guard handlers (noop) are not user surfaces
    if (d.handler === 'noop' && d.kind === 'wxml-handler') continue;
    const key = buildDetectedKey(d);
    detectedKeys.add(key);
    if (!registryByKey.has(key)) {
      unclassified.push(d);
    }
  }

  // Registry -> Code: detect missing surfaces (REAL/PARTIAL only)
  const missingSurfaces = [];
  for (const s of registry) {
    if (s.kind === 'internal-guard' || s.kind === 'page') continue;
    if (s.status !== 'REAL' && s.status !== 'PARTIAL') continue;
    if (hiddenPages.has(s.page)) continue;
    const key = buildKey(s);
    if (!detectedKeys.has(key)) {
      missingSurfaces.push(s);
    }
  }

  // Handler existence check for REAL/PARTIAL wxml-handler
  const missingHandlers = [];
  for (const s of registry) {
    if (s.kind !== 'wxml-handler') continue;
    if (s.status !== 'REAL' && s.status !== 'PARTIAL') continue;
    if (hiddenPages.has(s.page)) continue;
    const js = collectPageJs(s.page);
    if (!handlerExistsInJs(js, s.handler)) {
      missingHandlers.push({ id: s.id, page: s.page, handler: s.handler });
    }
  }

  // REAL truth check: placeholder / empty implementation -> Governance FAIL
  const realViolations = [];
  for (const s of registry) {
    if (s.status !== 'REAL') continue;
    if (s.kind === 'wxml-handler' && s.handler) {
      const js = collectPageJs(s.page);
      if (isPlaceholderImplementation(js, s.handler)) {
        realViolations.push({ id: s.id, handler: s.handler, reason: 'REAL surface uses placeholder implementation' });
      } else if (isEmptyImplementation(js, s.handler)) {
        realViolations.push({ id: s.id, handler: s.handler, reason: 'REAL surface has empty implementation' });
      }
    }
    if (s.kind === 'menu-action' && s.action === 'placeholderToast') {
      realViolations.push({ id: s.id, label: s.label, reason: 'REAL menu action uses placeholderToast' });
    }
  }

  // PLANNED_DISABLED check: any executable action (including placeholderToast) = clickable
  const plannedClickable = [];
  for (const s of registry) {
    if (s.status !== 'PLANNED_DISABLED') continue;
    if (s.kind === 'menu-action' && s.action) {
      plannedClickable.push({ id: s.id, label: s.label, action: s.action, reason: 'PLANNED_DISABLED menu action is clickable' });
    }
    if (s.kind === 'wxml-handler' && s.handler) {
      plannedClickable.push({ id: s.id, handler: s.handler, reason: 'PLANNED_DISABLED handler is bound' });
    }
  }

  // Check navigation targets exist in app.json
  const appJson = JSON.parse(readFile(path.join(MP, 'app.json')));
  const registeredPages = new Set(appJson.pages || []);
  const invalidNavs = detected.filter(d => d.kind === 'navigation' && !registeredPages.has(d.url.replace(/^\//, '')));

  // Dynamic handlers
  const dynamicHandlers = detected.filter(d => d.kind === 'wxml-handler' && d.handler.startsWith('{{'));

  console.log('=== PRODUCT SURFACE AUDIT ===');
  console.log(`Mode: ${mode}`);
  console.log(`Source: governance/product-surfaces.json (single authority)`);
  console.log(`Registry surfaces: ${registry.length}`);
  console.log(`WXML files: ${wxmlFiles.length}`);
  console.log(`JS files: ${jsFiles.length}`);
  console.log(`Detected code surfaces: ${detected.length}`);
  console.log(`DETECTED_CODE_SURFACES: ${detected.length}`);
  console.log(`REGISTERED_SURFACES: ${registry.length}`);
  console.log(`UNCLASSIFIED: ${unclassified.length}`);
  console.log(`MISSING_SURFACE: ${missingSurfaces.length}`);
  console.log(`MISSING_HANDLER: ${missingHandlers.length}`);
  console.log(`DUPLICATE_MAPPING: ${duplicates.length}`);
  console.log(`REAL_VIOLATION: ${realViolations.length}`);
  console.log(`PLANNED_CLICKABLE: ${plannedClickable.length}`);
  console.log(`Dynamic handlers: ${dynamicHandlers.length}`);
  console.log(`Invalid nav targets: ${invalidNavs.length}`);

  if (unclassified.length > 0) {
    console.log('\n--- UNCLASSIFIED (code has entry, registry missing) ---');
    unclassified.slice(0, 20).forEach(d => console.log(`  ${d.file}: ${d.kind} ${d.handler || d.label || d.url || d.surface_id}`));
  }
  if (missingSurfaces.length > 0) {
    console.log('\n--- MISSING_SURFACE (registry REAL/PARTIAL, code not found) ---');
    missingSurfaces.slice(0, 20).forEach(s => console.log(`  ${s.id}: ${s.page} ${s.kind} ${s.handler || s.label || s.surface_id}`));
  }
  if (missingHandlers.length > 0) {
    console.log('\n--- MISSING_HANDLER (REAL/PARTIAL wxml-handler not found in JS) ---');
    missingHandlers.forEach(h => console.log(`  ${h.id}: ${h.page}.${h.handler}`));
  }
  if (duplicates.length > 0) {
    console.log('\n--- DUPLICATE_MAPPING ---');
    duplicates.forEach(d => console.log(`  ${d.key}: ${d.ids.join(', ')}`));
  }
  if (realViolations.length > 0) {
    console.log('\n--- REAL_VIOLATION (fake REAL) ---');
    realViolations.forEach(v => console.log(`  ${v.id}: ${v.reason}`));
  }
  if (plannedClickable.length > 0) {
    console.log('\n--- PLANNED_CLICKABLE (PLANNED_DISABLED but executable) ---');
    plannedClickable.forEach(p => console.log(`  ${p.id}: ${p.reason}`));
  }

  // Governance FAIL: unclassified, duplicates, dynamic, invalid-nav, missing-handler, real-violation
  // These are truth violations — governance must catch fake REAL
  const governanceFailures = unclassified.length + duplicates.length + dynamicHandlers.length + invalidNavs.length + missingHandlers.length + realViolations.length;

  if (governanceFailures > 0) {
    console.log(`\nFAIL: ${governanceFailures} governance failures (unclassified/duplicates/dynamic/invalid-nav/missing-handler/real-violation)`);
    process.exit(1);
  }

  if (mode === 'release') {
    const releaseFailures = missingSurfaces.length + plannedClickable.length;
    if (releaseFailures > 0) {
      console.log(`\nFAIL: ${releaseFailures} release failures (missing-surface/planned-clickable)`);
      process.exit(1);
    }
  }

  console.log(`\nPASS: surface audit complete (${mode} mode)`);
  process.exit(0);
}

main();
