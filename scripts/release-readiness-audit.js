#!/usr/bin/env node
// Release Readiness Audit — all Final=REAL surfaces must be Status=REAL
// Single source of truth: governance/product-surfaces.json
// Usage: node scripts/release-readiness-audit.js
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const REGISTRY_PATH = path.join(ROOT, 'governance', 'product-surfaces.json');

function main() {
  const data = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const surfaces = data.surfaces || [];

  const brokenRequired = [];
  const partialRequired = [];
  const placeholderRequired = [];
  const realOk = [];
  const planned = [];
  const hidden = [];

  for (const s of surfaces) {
    if (s.final === 'REAL') {
      if (s.status === 'REAL') realOk.push(s);
      else if (s.status === 'BROKEN' || s.status === 'KNOWN_BROKEN') brokenRequired.push(s);
      else if (s.status === 'PARTIAL') partialRequired.push(s);
      else if (s.status === 'PLANNED_DISABLED') placeholderRequired.push(s);
    } else if (s.final === 'PLANNED_DISABLED') {
      planned.push(s);
    } else if (s.final === 'HIDDEN') {
      hidden.push(s);
    }
  }

  console.log('=== RELEASE READINESS AUDIT ===');
  console.log(`Source: governance/product-surfaces.json (single authority)`);
  console.log(`Total surfaces: ${surfaces.length}`);
  console.log(`Final=REAL and Status=REAL: ${realOk.length}`);
  console.log(`Final=REAL but Status=BROKEN/KNOWN_BROKEN: ${brokenRequired.length}`);
  console.log(`Final=REAL but Status=PARTIAL: ${partialRequired.length}`);
  console.log(`Final=REAL but Status=PLANNED_DISABLED: ${placeholderRequired.length}`);
  console.log(`Final=PLANNED_DISABLED: ${planned.length}`);
  console.log(`Final=HIDDEN: ${hidden.length}`);

  if (brokenRequired.length > 0) {
    console.log('\n--- BROKEN_REQUIRED_NOW ---');
    brokenRequired.forEach(s => console.log(`  ${s.id}: ${s.label || s.handler || s.page} [${s.status}]`));
  }
  if (partialRequired.length > 0) {
    console.log('\n--- PARTIAL_REQUIRED_NOW ---');
    partialRequired.forEach(s => console.log(`  ${s.id}: ${s.label || s.handler || s.page} [${s.status}]`));
  }
  if (placeholderRequired.length > 0) {
    console.log('\n--- PLACEHOLDER_REQUIRED_NOW ---');
    placeholderRequired.forEach(s => console.log(`  ${s.id}: ${s.label || s.handler || s.page} [${s.status}]`));
  }

  const blockers = brokenRequired.length + partialRequired.length + placeholderRequired.length;
  console.log(`\n=== SUMMARY ===`);
  console.log(`BLOCKERS: ${blockers}`);

  if (blockers > 0) {
    console.log(`\nFAIL: release not ready — ${blockers} required surfaces are not REAL`);
    process.exit(1);
  }
  console.log('\nPASS: all required surfaces are REAL');
  process.exit(0);
}

main();
