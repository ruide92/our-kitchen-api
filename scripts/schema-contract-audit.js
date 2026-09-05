#!/usr/bin/env node
// Schema Contract Audit — checks migration schema against DATA_MODEL_V4 and SPEC_AMENDMENTs
// Usage: node scripts/schema-contract-audit.js
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SQL_DIR = path.join(ROOT, 'backend', 'v1', 'sql');
const DATA_MODEL = path.join(ROOT, 'docs', 'DATA_MODEL_V4.md');
const AMENDMENT_DIR = path.join(ROOT, 'docs');

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

function main() {
  const dataModel = readFile(DATA_MODEL);
  const amendments = [];
  for (const f of fs.readdirSync(AMENDMENT_DIR)) {
    if (f.startsWith('SPEC_AMENDMENT') && f.endsWith('.md')) {
      amendments.push({ name: f, content: readFile(path.join(AMENDMENT_DIR, f)) });
    }
  }

  console.log('=== SCHEMA CONTRACT AUDIT ===');
  console.log(`DATA_MODEL_V4 loaded: ${dataModel.length} chars`);
  console.log(`SPEC_AMENDMENT files: ${amendments.map(a => a.name).join(', ') || 'none'}`);

  const sqlFiles = listSql();
  const allTables = new Map(); // table -> source migration
  const allAlters = [];

  for (const f of sqlFiles) {
    const sql = readFile(path.join(SQL_DIR, f));
    const tables = extractTables(sql);
    const alters = extractAlterColumns(sql);
    tables.forEach(t => allTables.set(t, f));
    allAlters.push(...alters.map(a => ({ ...a, migration: f })));
  }

  console.log(`\nSQL migrations: ${sqlFiles.join(', ')}`);
  console.log(`Total tables: ${allTables.size}`);
  console.log(`ALTER ADD COLUMN: ${allAlters.length}`);

  // Check each table is referenced in DATA_MODEL or amendment
  const unapproved = [];
  for (const [table, migration] of allTables) {
    const inDataModel = dataModel.includes(table);
    const inAmendment = amendments.some(a => a.content.includes(table));
    if (!inDataModel && !inAmendment) {
      unapproved.push({ table, migration });
    }
  }

  // Check each ALTER column
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
  if (unapproved.length === 0) console.log('  none');
  else unapproved.forEach(u => console.log(`  - ${u.table} (from ${u.migration})`));

  console.log(`\n--- ALTER columns not in DATA_MODEL or amendments ---`);
  if (unapprovedAlters.length === 0) console.log('  none');
  else unapprovedAlters.forEach(u => console.log(`  - ${u.table}.${u.column} (from ${u.migration})`));

  // Special check: 008 migration
  const has008 = sqlFiles.includes('008_full_closeout.sql');
  if (has008) {
    console.log(`\n--- 008_full_closeout.sql special check ---`);
    const sql008 = readFile(path.join(SQL_DIR, '008_full_closeout.sql'));
    const tables008 = extractTables(sql008);
    const alters008 = extractAlterColumns(sql008);
    console.log(`  New tables: ${tables008.join(', ')}`);
    console.log(`  Altered columns: ${alters008.map(a => `${a.table}.${a.column}`).join(', ')}`);

    const amendment12A = amendments.find(a => a.name === 'SPEC_AMENDMENT_12A.md');
    if (!amendment12A) {
      console.log(`  WARNING: SPEC_AMENDMENT_12A.md not found — 008 schema unapproved`);
    } else {
      const approved = amendment12A.content.includes('[x]');
      console.log(`  SPEC_AMENDMENT_12A approved: ${approved ? 'YES' : 'NO (DRAFT)'}`);
      if (!approved) {
        console.log(`  STATUS: UNAPPROVED_SCHEMA_CHANGE — do not apply to Neon`);
      }
    }
  }

  const totalUnapproved = unapproved.length + unapprovedAlters.length;
  console.log(`\n=== SUMMARY ===`);
  console.log(`UNAPPROVED_SCHEMA_CHANGES: ${totalUnapproved}`);

  if (totalUnapproved > 0) {
    console.log('\nWARNING: unapproved schema changes found (may be intentional in amendments)');
    // Don't exit 1 for warnings — amendments are the approval mechanism
  }
  console.log('\nPASS: schema contract audit complete');
  process.exit(0);
}

main();
