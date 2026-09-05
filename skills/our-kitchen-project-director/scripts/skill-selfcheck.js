#!/usr/bin/env node
// Skill Selfcheck — verify skill files, frontmatter, eval schema
// Usage: node skills/our-kitchen-project-director/scripts/skill-selfcheck.js
const fs = require('node:fs');
const path = require('node:path');

const SKILL_DIR = path.resolve(__dirname, '..');

function main() {
  let failures = 0;

  console.log('=== SKILL SELFCHECK ===');
  console.log(`Skill dir: ${SKILL_DIR}\n`);

  // Required files
  const required = [
    'SKILL.md',
    'references/task-profiles.md',
    'references/project-contract.md',
    'references/failure-patterns.md',
    'references/report-contract.md',
    'scripts/preflight.js',
    'scripts/checkpoint.js',
    'scripts/release-check.js',
    'scripts/surface-context.js',
    'scripts/skill-selfcheck.js',
    'evals/evals.json',
    'evals/trigger-evals.json',
  ];

  console.log('--- Required files ---');
  for (const f of required) {
    const full = path.join(SKILL_DIR, f);
    const exists = fs.existsSync(full);
    const size = exists ? fs.statSync(full).size : 0;
    console.log(`  ${f}: ${exists ? `OK (${size}b)` : 'MISSING'}`);
    if (!exists || size === 0) failures++;
  }

  // SKILL.md frontmatter
  console.log('\n--- SKILL.md frontmatter ---');
  const skillMd = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
  const nameMatch = skillMd.match(/^name:\s*(.+)$/m);
  const descMatch = skillMd.match(/^description:\s*(>|\S)/m);
  console.log(`  name: ${nameMatch ? nameMatch[1].trim() : 'MISSING'}`);
  console.log(`  description: ${descMatch ? 'present' : 'MISSING'}`);
  if (!nameMatch || nameMatch[1].trim() !== 'our-kitchen-project-director') {
    console.log('  FAIL: name must be our-kitchen-project-director');
    failures++;
  }
  if (!descMatch) failures++;

  // Evals schema
  console.log('\n--- Evals ---');
  try {
    const evals = JSON.parse(fs.readFileSync(path.join(SKILL_DIR, 'evals/evals.json'), 'utf8'));
    const evalList = evals.evals || evals;
    console.log(`  evals.json: ${Array.isArray(evalList) ? evalList.length : 'not array'} entries`);
    if (!Array.isArray(evalList) || evalList.length === 0) failures++;
  } catch (e) {
    console.log(`  evals.json: PARSE FAIL (${e.message})`);
    failures++;
  }

  try {
    const triggers = JSON.parse(fs.readFileSync(path.join(SKILL_DIR, 'evals/trigger-evals.json'), 'utf8'));
    const triggerList = triggers.should_trigger || triggers;
    console.log(`  trigger-evals.json: ${Array.isArray(triggerList) ? triggerList.length : 'not array'} triggers`);
    if (!Array.isArray(triggerList) || triggerList.length === 0) failures++;
  } catch (e) {
    console.log(`  trigger-evals.json: PARSE FAIL (${e.message})`);
    failures++;
  }

  console.log(`\n=== SELFCHECK RESULT: ${failures === 0 ? 'PASS' : `FAIL (${failures})`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
