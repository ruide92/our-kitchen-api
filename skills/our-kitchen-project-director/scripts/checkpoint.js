#!/usr/bin/env node
// Checkpoint — git diff --check + governance gate, then ready to commit
// Usage: node skills/our-kitchen-project-director/scripts/checkpoint.js
const { execSync } = require('node:child_process');

const ROOT = process.cwd();

function run(cmd, label) {
  console.log(`\n--- ${label} ---`);
  try {
    const out = execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    console.log(out.trim() || '(no output)');
    return { code: 0, output: out };
  } catch (e) {
    const out = (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
    console.log(out.trim() || `(exit ${e.status})`);
    return { code: e.status || 1, output: out };
  }
}

function main() {
  console.log('=== CHECKPOINT ===');

  // 1. git diff --check
  const diffCheck = run('git diff --check', 'git diff --check');
  if (diffCheck.code !== 0) {
    console.log('\nFAIL: git diff --check found whitespace errors');
    process.exit(1);
  }

  // 2. Governance gate
  const gov = run('npm run test:governance-gate', 'governance gate');
  if (gov.code !== 0) {
    console.log('\nFAIL: governance gate not green — cannot checkpoint');
    process.exit(1);
  }

  // 3. Summary
  console.log('\n=== CHECKPOINT READY ===');
  console.log('Next: review diff, commit, push');
  process.exit(0);
}

main();
