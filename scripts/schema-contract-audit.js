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

const BASELINE_DRIFT_REGISTRY = path.join(ROOT, 'governance', 'schema-baseline-drift.json');
function loadBaselineDrift() {
  try { return JSON.parse(fs.readFileSync(BASELINE_DRIFT_REGISTRY, 'utf8')); }
  catch { return { drifts: [] }; }
}

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

// Parse CREATE TABLE columns: name, type, nullable
function parseCreateTableColumns(sql) {
  const result = {};
  // Find CREATE TABLE start positions
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const tableName = m[1];
    const startIdx = m.index + m[0].length;
    // Find matching closing paren with depth tracking
    let depth = 1;
    let endIdx = startIdx;
    for (let i = startIdx; i < sql.length; i++) {
      if (sql[i] === '(') depth++;
      if (sql[i] === ')') {
        depth--;
        if (depth === 0) { endIdx = i; break; }
      }
    }
    const body = sql.substring(startIdx, endIdx);
    const columns = [];
    let parenDepth = 0;
    let current = '';
    for (const ch of body) {
      if (ch === '(') parenDepth++;
      if (ch === ')') parenDepth--;
      if (ch === ',' && parenDepth === 0) {
        columns.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) columns.push(current.trim());

    const colDefs = [];
    for (const col of columns) {
      if (/^(PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY|CONSTRAINT|INDEX)/i.test(col)) continue;
      const parts = col.split(/\s+/);
      const name = parts[0];
      const type = parts[1] || '';
      const nullable = !/NOT\s+NULL/i.test(col);
      colDefs.push({ name, type, nullable });
    }
    result[tableName] = colDefs;
  }
  return result;
}

function parseAmendment(filePath) {
  const content = readFile(filePath);
  const name = path.basename(filePath);
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
  const baselineColumns = {}; // table -> [{name, type, nullable}]
  const baselineTableMigration = {}; // table -> migration file

  for (const f of sqlFiles) {
    const sql = readFile(path.join(SQL_DIR, f));
    extractTables(sql).forEach(t => {
      allTables.set(t, f);
      // Only parse columns for baseline migrations 001-007
      if (/^00[1-7]_/.test(f)) {
        const cols = parseCreateTableColumns(sql);
        for (const [tname, colDefs] of Object.entries(cols)) {
          baselineColumns[tname] = colDefs;
          baselineTableMigration[tname] = f;
        }
      }
    });
    allAlters.push(...extractAlterColumns(sql).map(a => ({ ...a, migration: f })));
  }

  const totalBaselineTables = Object.keys(baselineColumns).length;
  const totalBaselineColumns = Object.values(baselineColumns).reduce((s, cols) => s + cols.length, 0);

  console.log(`\nSQL migrations: ${sqlFiles.join(', ')}`);
  console.log(`Total tables: ${allTables.size}`);
  console.log(`ALTER ADD COLUMN: ${allAlters.length}`);
  console.log(`Baseline tables (001-007): ${totalBaselineTables}`);
  console.log(`Baseline columns (001-007): ${totalBaselineColumns}`);

  const baselineDrift = loadBaselineDrift();
  const knownDriftKeys = new Set((baselineDrift.drifts || []).map(d => `${d.migration}:${d.table || ''}:${d.column || ''}`));
  const registryEntries = baselineDrift.drifts || [];

  // Check each table is referenced
  const unapprovedTables = [];
  const knownBaselineDrift = [];
  for (const [table, migration] of allTables) {
    const inDataModel = dataModel.includes(table);
    const inAmendment = amendments.some(a => a.content.includes(table));
    if (!inDataModel && !inAmendment) {
      const key = `${migration}:${table}:`;
      if (knownDriftKeys.has(key)) {
        knownBaselineDrift.push({ table, migration, type: 'KNOWN_BASELINE_DRIFT' });
      } else {
        unapprovedTables.push({ table, migration });
      }
    }
  }

  const unapprovedAlters = [];
  for (const alter of allAlters) {
    const inDataModel = dataModel.includes(alter.column);
    const inAmendment = amendments.some(a =>
      a.content.includes(alter.table) && a.content.includes(alter.column)
    );
    if (!inDataModel && !inAmendment) {
      const key = `${alter.migration}:${alter.table}:${alter.column}`;
      if (knownDriftKeys.has(key)) {
        knownBaselineDrift.push({ table: alter.table, column: alter.column, migration: alter.migration, type: 'KNOWN_BASELINE_DRIFT' });
      } else {
        unapprovedAlters.push(alter);
      }
    }
  }

  // Field-level baseline drift: for tables in DATA_MODEL, check columns
  const fieldLevelDrift = [];
  for (const [table, cols] of Object.entries(baselineColumns)) {
    // Check if table is documented in DATA_MODEL
    const tableInDM = new RegExp('## \\d+\\. ' + table + '\\b').test(dataModel);
    if (!tableInDM) continue; // table-level drift already handled above

    // Extract DATA_MODEL section for this table
    const sectionRe = new RegExp('## \\d+\\. ' + table + '[\\s\\S]*?(?=## \\d+\\.|$)');
    const sectionMatch = dataModel.match(sectionRe);
    const section = sectionMatch ? sectionMatch[0] : '';

    for (const col of cols) {
      // Check if column name appears in this section
      const colInSection = section.includes('`' + col.name + '`');
      if (!colInSection) {
        const migration = baselineTableMigration[table];
        const key = `${migration}:${table}:${col.name}`;
        if (knownDriftKeys.has(key)) {
          fieldLevelDrift.push({ table, column: col.name, migration, type: 'KNOWN_BASELINE_DRIFT', detail: `actual type=${col.type} nullable=${col.nullable}` });
        } else {
          fieldLevelDrift.push({ table, column: col.name, migration, type: 'UNTRACKED_FIELD_DRIFT', detail: `actual type=${col.type} nullable=${col.nullable}` });
        }
      }
    }
  }

  const untrackedFieldDrift = fieldLevelDrift.filter(d => d.type === 'UNTRACKED_FIELD_DRIFT');
  const knownFieldDrift = fieldLevelDrift.filter(d => d.type === 'KNOWN_BASELINE_DRIFT');

  // STALE registry detection: registry entry that doesn't match any actual schema element
  const staleEntries = [];
  for (const entry of registryEntries) {
    let found = false;
    if (!entry.column) {
      // Table-level: check if table exists in any migration
      if (allTables.has(entry.table)) found = true;
    } else {
      // Column-level: check CREATE TABLE columns or ALTER ADD COLUMN
      if (baselineColumns[entry.table]?.some(c => c.name === entry.column)) found = true;
      if (allAlters.some(a => a.table === entry.table && a.column === entry.column)) found = true;
      // Also check 008+ tables
      for (const f of sqlFiles) {
        if (/^00[8-9]_/.test(f) || /^0[1-9]\d_/.test(f)) {
          const sql = readFile(path.join(SQL_DIR, f));
          const cols = parseCreateTableColumns(sql);
          if (cols[entry.table]?.some(c => c.name === entry.column)) found = true;
        }
      }
    }
    if (!found) staleEntries.push({ ...entry, key: `${entry.migration}:${entry.table}:${entry.column}` });
  }

  console.log(`\n--- Tables not in DATA_MODEL or amendments ---`);
  if (unapprovedTables.length === 0) console.log('  none');
  else unapprovedTables.forEach(u => console.log(`  - ${u.table} (from ${u.migration})`));

  console.log(`\n--- ALTER columns not in DATA_MODEL or amendments ---`);
  if (unapprovedAlters.length === 0) console.log('  none');
  else unapprovedAlters.forEach(u => console.log(`  - ${u.table}.${u.column} (from ${u.migration})`));

  console.log(`\n--- Field-level baseline drift (001-007 CREATE TABLE) ---`);
  if (fieldLevelDrift.length === 0) console.log('  none');
  else {
    console.log(`  KNOWN: ${knownFieldDrift.length}`);
    knownFieldDrift.forEach(d => console.log(`    - ${d.table}.${d.column} (${d.detail})`));
    console.log(`  UNTRACKED: ${untrackedFieldDrift.length}`);
    untrackedFieldDrift.forEach(d => console.log(`    - ${d.table}.${d.column} (${d.detail})`));
  }

  console.log(`\n--- Known baseline drift (tracked in registry) ---`);
  const allKnown = [...knownBaselineDrift, ...knownFieldDrift];
  if (allKnown.length === 0) console.log('  none');
  else allKnown.forEach(d => console.log(`  - ${d.table}${d.column ? '.'+d.column : ''} (from ${d.migration})`));

  console.log(`\n--- Stale registry entries (registry has, actual schema doesn't) ---`);
  if (staleEntries.length === 0) console.log('  none');
  else staleEntries.forEach(s => console.log(`  - ${s.key}: ${s.reason || 'no longer matches actual schema'}`));

  // Amendment status
  const draftAmendments = amendments.filter(a => a.status !== 'APPROVED');
  const approvedAmendments = amendments.filter(a => a.status === 'APPROVED');

  console.log(`\n--- Amendment Status ---`);
  console.log(`APPROVED: ${approvedAmendments.length}`);
  console.log(`DRAFT/UNAPPROVED: ${draftAmendments.length}`);
  draftAmendments.forEach(a => console.log(`  - ${a.name}: ${a.status}`));

  // 008 check
  const has008 = sqlFiles.includes('008_full_closeout.sql');
  let zeroZeroEightStatus = 'NOT_PRESENT';
  if (has008) {
    const amendment12A = amendments.find(a => a.name === 'SPEC_AMENDMENT_12A.md');
    if (!amendment12A) zeroZeroEightStatus = 'NO_AMENDMENT';
    else if (amendment12A.status === 'APPROVED') zeroZeroEightStatus = 'APPROVED';
    else zeroZeroEightStatus = 'BLOCKED (DRAFT)';
    console.log(`\n--- 008_full_closeout.sql ---`);
    console.log(`  Status: ${zeroZeroEightStatus}`);
    if (zeroZeroEightStatus === 'BLOCKED (DRAFT)') {
      console.log(`  Action: DO NOT apply to Neon until SPEC_AMENDMENT_12A is APPROVED`);
    }
  }

  const totalUntracked = unapprovedTables.length + unapprovedAlters.length + untrackedFieldDrift.length;
  const totalKnown = allKnown.length;
  const totalStale = staleEntries.length;

  console.log(`\n=== SUMMARY ===`);
  console.log(`TOTAL_BASELINE_TABLES: ${totalBaselineTables}`);
  console.log(`TOTAL_BASELINE_COLUMNS: ${totalBaselineColumns}`);
  console.log(`KNOWN_BASELINE_DRIFT: ${totalKnown}`);
  console.log(`UNTRACKED_BASELINE_DRIFT: ${totalUntracked}`);
  console.log(`STALE_BASELINE_DRIFT_ENTRY: ${totalStale}`);
  console.log(`DRAFT_AMENDMENTS: ${draftAmendments.length}`);
  console.log(`008_STATUS: ${zeroZeroEightStatus}`);

  if (mode === 'governance') {
    if (totalUntracked > 0 || totalStale > 0) {
      console.log('\nFAIL: governance requires UNTRACKED=0 and STALE=0');
      process.exit(1);
    }
    console.log('\nPASS: schema audit complete (governance mode)');
    process.exit(0);
  }

  if (draftAmendments.length > 0 || totalUntracked > 0 || totalStale > 0 || zeroZeroEightStatus.includes('BLOCKED')) {
    console.log('\nFAIL: release requires all amendments APPROVED, no untracked/stale drift');
    process.exit(1);
  }

  console.log('\nPASS: schema audit complete (release mode)');
  process.exit(0);
}

main();
