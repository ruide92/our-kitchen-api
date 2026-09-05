#!/usr/bin/env node
// Product Surface Audit — bidirectional mapping between code and governance/product-surfaces.json
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

function scanCode() {
  const wxmlFiles = walk(path.join(MP, 'pages'), '.wxml');
  const jsFiles = walk(path.join(MP, 'pages'), '.js');

  // Also include custom-tab-bar (but its handlers are infrastructure, not user entry points)
  const tabBarDir = path.join(MP, 'custom-tab-bar');
  // custom-tab-bar handlers are infrastructure — skip from surface detection

  const detected = []; // {page, kind, handler, url, label, file}

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

  // Scan overlay/sheet elements in WXML (dedup by page+type)
  const overlayPages = new Set();
  for (const f of wxmlFiles) {
    const page = pageNameFromPath(f);
    const wxml = readFile(f);
    if (/class="[^"]*(sheet-mask|sheet-panel|modal)[^"]*"/.test(wxml)) {
      if (!overlayPages.has(page)) {
        overlayPages.add(page);
        detected.push({ page, kind: 'overlay', handler: 'sheet', file: path.relative(MP, f) });
      }
    }
  }

  return { detected, wxmlFiles, jsFiles };
}

function buildKey(surface) {
  if (surface.kind === 'wxml-handler') return `${surface.page}:wxml-handler:${surface.handler}`;
  if (surface.kind === 'navigation') return `${surface.page}:navigation:${surface.handler}:${surface.url}`;
  if (surface.kind === 'menu-action') return `${surface.page}:menu-action:${surface.label}`;
  if (surface.kind === 'overlay') return `${surface.page}:overlay:${surface.handler}`;
  if (surface.kind === 'dock') return `${surface.page}:dock:${surface.handler}`;
  if (surface.kind === 'page') return `page:${surface.page}`;
  return `${surface.page}:${surface.kind}:${surface.handler || surface.id}`;
}

function buildDetectedKey(d) {
  if (d.kind === 'wxml-handler') return `${d.page}:wxml-handler:${d.handler}`;
  if (d.kind === 'navigation') return `${d.page}:navigation:${d.handler}:${d.url}`;
  if (d.kind === 'menu-action') return `${d.page}:menu-action:${d.label}`;
  if (d.kind === 'overlay') return `${d.page}:overlay:${d.handler}`;
  return `${d.page}:${d.kind}:${d.handler || ''}`;
}

function isPlaceholderImplementation(js, handler) {
  if (handler === 'noop') return false; // noop is intentional for catchtap
  if (handler === 'placeholderToast') return true;
  // Check if handler body is just showToast with 待接入/规划中
  const re = new RegExp(`${handler}\\s*[(:][\\s\\S]{0,200}?(showToast|wx\\.showToast)[\\s\\S]{0,100}?(待接入|规划中|未实现|coming soon)`, 'i');
  return re.test(js);
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
    const key = buildKey(s);
    if (registryByKey.has(key)) {
      duplicates.push({ key, ids: [registryByKey.get(key).id, s.id] });
    } else {
      registryByKey.set(key, s);
    }
  }

  // Code -> Registry: detect unclassified
  // HIDDEN pages' handlers are auto-classified as HIDDEN (page-level registration covers them)
  const unclassified = [];
  const detectedKeys = new Set();
  for (const d of detected) {
    if (hiddenPages.has(d.page)) continue; // HIDDEN page handlers covered by page-level registration
    const key = buildDetectedKey(d);
    detectedKeys.add(key);
    if (!registryByKey.has(key)) {
      unclassified.push(d);
    }
  }

  // Registry -> Code: detect missing surfaces
  // Only REAL and PARTIAL must exist in code. BROKEN/KNOWN_BROKEN means functionality is missing by definition.
  const missingSurfaces = [];
  for (const s of registry) {
    if (s.status !== 'REAL' && s.status !== 'PARTIAL') continue;
    if (s.kind === 'page') continue;
    if (hiddenPages.has(s.page)) continue;
    const key = buildKey(s);
    if (!detectedKeys.has(key)) {
      missingSurfaces.push(s);
    }
  }

  // REAL check: handler must not be placeholder
  const realViolations = [];
  const jsByPage = new Map();
  for (const f of jsFiles) {
    const page = pageNameFromPath(f);
    jsByPage.set(page, (jsByPage.get(page) || '') + '\n' + readFile(f));
  }
  for (const s of registry) {
    if (s.status !== 'REAL') continue;
    if (s.kind === 'wxml-handler' && s.handler) {
      const js = jsByPage.get(s.page) || '';
      if (isPlaceholderImplementation(js, s.handler)) {
        realViolations.push({ id: s.id, handler: s.handler, reason: 'REAL surface uses placeholder implementation' });
      }
    }
    if (s.kind === 'menu-action' && s.action === 'placeholderToast') {
      realViolations.push({ id: s.id, label: s.label, reason: 'REAL menu action uses placeholderToast' });
    }
  }

  // PLANNED_DISABLED check: must not be clickable
  const plannedClickable = [];
  for (const s of registry) {
    if (s.status !== 'PLANNED_DISABLED') continue;
    if (s.kind === 'menu-action' && s.action && s.action !== 'placeholderToast') {
      plannedClickable.push({ id: s.id, label: s.label, action: s.action });
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
  console.log(`Registry surfaces: ${registry.length}`);
  console.log(`WXML files: ${wxmlFiles.length}`);
  console.log(`JS files: ${jsFiles.length}`);
  console.log(`Detected code surfaces: ${detected.length}`);
  console.log(`DETECTED_CODE_SURFACES: ${detected.length}`);
  console.log(`REGISTERED_SURFACES: ${registry.length}`);
  console.log(`UNCLASSIFIED: ${unclassified.length}`);
  console.log(`MISSING_SURFACE: ${missingSurfaces.length}`);
  console.log(`DUPLICATE_MAPPING: ${duplicates.length}`);
  console.log(`REAL violations: ${realViolations.length}`);
  console.log(`PLANNED clickable: ${plannedClickable.length}`);
  console.log(`Dynamic handlers: ${dynamicHandlers.length}`);
  console.log(`Invalid nav targets: ${invalidNavs.length}`);

  if (unclassified.length > 0) {
    console.log('\n--- UNCLASSIFIED (code has entry, registry missing) ---');
    unclassified.slice(0, 20).forEach(d => console.log(`  ${d.file}: ${d.kind} ${d.handler || d.label || d.url}`));
  }
  if (missingSurfaces.length > 0) {
    console.log('\n--- MISSING_SURFACE (registry says REAL/PARTIAL/BROKEN, code not found) ---');
    missingSurfaces.slice(0, 20).forEach(s => console.log(`  ${s.id}: ${s.page} ${s.kind} ${s.handler || s.label}`));
  }
  if (duplicates.length > 0) {
    console.log('\n--- DUPLICATE_MAPPING ---');
    duplicates.forEach(d => console.log(`  ${d.key}: ${d.ids.join(', ')}`));
  }
  if (realViolations.length > 0) {
    console.log('\n--- REAL VIOLATIONS ---');
    realViolations.forEach(v => console.log(`  ${v.id}: ${v.reason}`));
  }

  const hardFailures = unclassified.length + duplicates.length + dynamicHandlers.length + invalidNavs.length;

  if (hardFailures > 0) {
    console.log(`\nFAIL: ${hardFailures} hard failures (unclassified/duplicates/dynamic/invalid-nav)`);
    process.exit(1);
  }

  if (mode === 'release') {
    const releaseFailures = missingSurfaces.length + realViolations.length + plannedClickable.length;
    if (releaseFailures > 0) {
      console.log(`\nFAIL: ${releaseFailures} release failures (missing/real-violations/planned-clickable)`);
      process.exit(1);
    }
  }

  console.log(`\nPASS: surface audit complete (${mode} mode)`);
  process.exit(0);
}

main();
