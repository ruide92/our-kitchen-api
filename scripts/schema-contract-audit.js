#!/usr/bin/env node
// Schema Contract Audit — checks migration schema against DATA_MODEL_V4 and SPEC_AMENDMENTs
// Usage: node scripts/schema-contract-audit.js [--mode=governance|release]
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const SQL_DIR = path.join(ROOT, 'backend', 'v1', 'sql');
const DATA_MODEL = path.join(ROOT, 'docs', 'DATA_MODEL_V4.md');
const AMENDMENT_DIR = path.join(ROOT, 'docs');

const mode = process.argv.find(a => a.startsWith('--mode='))?.split('=')[1] || 'governance';

function readFile(p) { return fs.readFileSync(p, 'utf8'); }

function listSql() {
  return fs.readdirSync(SQL_DIR).filter(f => f.endsWith('.sql')).sort();
}

function extractTables(sql) {
  const tables = new Set();
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi;
  let m;
  while ((m = re.exec(sql)) !== null) tables.add(m[1]);
  return [...tables];
}

function extractAlterColumns(sql) {
  const cols = [];
  const re = /ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi;
  let m;
  while ((m = re.exec(sql)) !== null) cols.push({ table: m[1], column: m[2] });
  return cols;
}

function parseAmendment(filePath) {
  const content = readFile(filePath);
  const name = path.basename(filePath);
  // Status must be explicit machine field: "Status: APPROVED" or "Status: DRAFT"
  const statusMatch = content.match(/^Status:\s*(\w+)/m);
  const status = statusMatch ? statusMatch[1].toUpperCase() : 'DRAFT';
  return { name, content, status };
}

function main() {
  const dataModel = readFile(DATA_MODEL);
  const amendments = [];
  for (const f of fs.readdirSync(AMENDMENT_DIR)) {
    if (f.startsWith('SPEC_AMENDMENT') && f.endsWith('.md')) {
      amendments.push(parseAmendment(path.join(AMENDMENT_DIR, f)));
    }
  }

  console.log('=== SCHEMA CONTRACT AUDIT ===');
  console.log(`Mode: ${mode}`);
  console.log(`DATA_MODEL_V4: ${dataModel.length} chars`);
  console.log(`Amendments: ${amendments.map(a => `${a.name}(${a.status})`).join(', ') || 'none'}`);

  const sqlFiles = listSql();
  const allTables = new Map();
  const allAlters = [];

  for (const f of sqlFiles) {
    const sql = readFile(path.join(SQL_DIR, f));
    extractTables(sql).forEach(t => allTables.set(t, f));
    allAlters.push(...extractAlterColumns(sql).map(a => ({ ...a, migration: f })));
  }

  console.log(`\nSQL migrations: ${sqlFiles.join(', ')}`);
  console.log(`Total tables: ${allTables.size}`);
  console.log(`ALTER ADD COLUMN: ${allAlters.length}`);

  // Check each table is referenced
  const unapprovedTables = [];
  for (const [table, migration] of allTables) {
    const inDataModel = dataModel.includes(table);
    const inAmendment = amendments.some(a => a.content.includes(table));
    if (!inDataModel && !inAmendment) {
      unapprovedTables.push({ table, migration });
    }
  }

  const unapprovedAlters = [];
  for (const alter of allAlters) {
    const inDataModel = dataModel.includes(alter.column);
    const inAmendment = amendments.some(a =>
      a.content.includes(alter.table) && a.content.includes(alter.column)
    );
    if (!inDataModel && !inAmendment) {
      unapprovedAlters.push(alter);
    }
  }

  console.log(`\n--- Tables not in DATA_MODEL or amendments ---`);
  if (unapprovedTables.length === 0) console.log('  none');
  else unapprovedTables.forEach(u => console.log(`  - ${u.table} (from ${u.migration})`));

  console.log(`\n--- ALTER columns not in DATA_MODEL or amendments ---`);
  if (unapprovedAlters.length === 0) console.log('  none');
  else unapprovedAlters.forEach(u => console.log(`  - ${u.table}.${u.column} (from ${u.migration})`));

  // Check amendment approval status
  const draftAmendments = amendments.filter(a => a.status !== 'APPROVED');
  const approvedAmendments = amendments.filter(a => a.status === 'APPROVED');

  console.log(`\n--- Amendment Status ---`);
  console.log(`APPROVED: ${approvedAmendments.length}`);
  console.log(`DRAFT/UNAPPROVED: ${draftAmendments.length}`);
  draftAmendments.forEach(a => console.log(`  - ${a.name}: ${a.status}`));

  // Special check: 008 migration
  const has008 = sqlFiles.includes('008_full_closeout.sql');
  let zeroZeroEightStatus = 'NOT_PRESENT';
  if (has008) {
    const amendment12A = amendments.find(a => a.name === 'SPEC_AMENDMENT_12A.md');
    if (!amendment12A) {
      zeroZeroEightStatus = 'NO_AMENDMENT';
    } else if (amendment12A.status === 'APPROVED') {
      zeroZeroEightStatus = 'APPROVED';
    } else {
      zeroZeroEightStatus = 'BLOCKED (DRAFT)';
    }
    console.log(`\n--- 008_full_closeout.sql ---`);
    console.log(`  Status: ${zeroZeroEightStatus}`);
    if (zeroZeroEightStatus === 'BLOCKED (DRAFT)') {
      console.log(`  Action: DO NOT apply to Neon until SPEC_AMENDMENT_12A is APPROVED`);
    }
  }

  const totalUnapproved = unapprovedTables.length + unapprovedAlters.length;
  console.log(`\n=== SUMMARY ===`);
  console.log(`UNAPPROVED_SCHEMA_CHANGES: ${totalUnapproved}`);
  console.log(`DRAFT_AMENDMENTS: ${draftAmendments.length}`);
  console.log(`008_STATUS: ${zeroZeroEightStatus}`);

  // Governance mode: allow DRAFT, but report
  if (mode === 'governance') {
    if (totalUnapproved > 0) {
      console.log('\nWARNING: unapproved schema changes (governance allows with tracking)');
    }
    console.log('\nPASS: schema audit complete (governance mode)');
    process.exit(0);
  }

  // Release mode: any DRAFT or unapproved = FAIL
  if (draftAmendments.length > 0 || totalUnapproved > 0 || zeroZeroEightStatus.includes('BLOCKED')) {
    console.log('\nFAIL: release requires all amendments APPROVED and no unapproved schema changes');
    process.exit(1);
  }

  console.log('\nPASS: schema audit complete (release mode)');
  process.exit(0);
}

main();
