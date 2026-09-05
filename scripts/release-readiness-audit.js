#!/usr/bin/env node
// Release Readiness Audit — enforces that all Final=REAL surfaces are actually REAL
// Usage: node scripts/release-readiness-audit.js
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const MATRIX_PATH = path.join(ROOT, 'docs', 'PRODUCT_SURFACE_MATRIX.md');

function readFile(p) { return fs.readFileSync(p, 'utf8'); }

function parseMatrix(markdown) {
  const surfaces = [];
  // Match table rows: | SURFACE-ID | label | ... | Status | Phase | Final | ...
  // Status is column 6 (0-indexed 5), Final is column 7 (0-indexed 6)
  const lines = markdown.split('\n');
  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map(c => c.trim());
    if (cells.length < 8) continue;
    const id = cells[1];
    if (!/^[A-Z]+(-[A-Z]+)?-\d+$/.test(id)) continue;
    const status = cells[5];
    const final = cells[7];
    if (!['REAL','PARTIAL','BROKEN','PLANNED_DISABLED','HIDDEN'].includes(status)) continue;
    surfaces.push({ id, label: cells[2], status, final });
  }
  return surfaces;
}

function main() {
  const matrix = readFile(MATRIX_PATH);
  const surfaces = parseMatrix(matrix);

  const brokenRequired = [];
  const partialRequired = [];
  const placeholderRequired = [];
  const realOk = [];
  const planned = [];
  const hidden = [];

  for (const s of surfaces) {
    if (s.final === 'REAL') {
      if (s.status === 'REAL') realOk.push(s);
      else if (s.status === 'BROKEN') brokenRequired.push(s);
      else if (s.status === 'PARTIAL') partialRequired.push(s);
      else if (s.status === 'PLANNED_DISABLED') placeholderRequired.push(s);
    } else if (s.final === 'PLANNED_DISABLED') {
      planned.push(s);
    } else if (s.final === 'HIDDEN') {
      hidden.push(s);
    }
  }

  console.log('=== RELEASE READINESS AUDIT ===');
  console.log(`Total surfaces in matrix: ${surfaces.length}`);
  console.log(`Final=REAL and Status=REAL: ${realOk.length}`);
  console.log(`Final=REAL but Status=BROKEN: ${brokenRequired.length}`);
  console.log(`Final=REAL but Status=PARTIAL: ${partialRequired.length}`);
  console.log(`Final=REAL but Status=PLANNED_DISABLED: ${placeholderRequired.length}`);
  console.log(`Final=PLANNED_DISABLED: ${planned.length}`);
  console.log(`Final=HIDDEN: ${hidden.length}`);

  if (brokenRequired.length > 0) {
    console.log('\n--- BROKEN_REQUIRED_NOW ---');
    brokenRequired.forEach(s => console.log(`  ${s.id}: ${s.label} [${s.status}]`));
  }
  if (partialRequired.length > 0) {
    console.log('\n--- PARTIAL_REQUIRED_NOW ---');
    partialRequired.forEach(s => console.log(`  ${s.id}: ${s.label} [${s.status}]`));
  }
  if (placeholderRequired.length > 0) {
    console.log('\n--- PLACEHOLDER_REQUIRED_NOW ---');
    placeholderRequired.forEach(s => console.log(`  ${s.id}: ${s.label} [${s.status}]`));
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
