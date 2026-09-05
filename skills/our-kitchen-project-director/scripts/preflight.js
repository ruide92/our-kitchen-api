#!/usr/bin/env node
// Preflight — verify repository identity, branch, HEAD, cleanliness, governance files
// Usage: node skills/our-kitchen-project-director/scripts/preflight.js
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const EXPECTED_REPO = 'ruide92/our-kitchen-api';
const EXPECTED_BRANCH = 'codex/kitchen-v4';

function git(args) {
  try {
    return execSync(`git ${args}`, { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    return e.stdout?.toString().trim() || e.stderr?.toString().trim() || '';
  }
}

function main() {
  let failures = 0;

  console.log('=== PROJECT PREFLIGHT ===');

  // Repository identity
  const origin = git('remote get-url origin');
  const repoMatch = origin.includes(EXPECTED_REPO);
  console.log(`Origin: ${origin}`);
  console.log(`Repository identity: ${repoMatch ? 'OK' : 'FAIL'} (expected ${EXPECTED_REPO})`);
  if (!repoMatch) failures++;

  // Branch
  const branch = git('rev-parse --abbrev-ref HEAD');
  const branchMatch = branch === EXPECTED_BRANCH;
  console.log(`Branch: ${branch}`);
  console.log(`Branch match: ${branchMatch ? 'OK' : 'FAIL'} (expected ${EXPECTED_BRANCH})`);
  if (!branchMatch) failures++;

  // HEAD
  const localHead = git('rev-parse HEAD');
  console.log(`Local HEAD: ${localHead}`);

  // Remote HEAD (specific branch, not default)
  let remoteHead = '';
  try {
    remoteHead = execSync(`git -c http.proxy= -c https.proxy= ls-remote origin ${EXPECTED_BRANCH}`, { cwd: ROOT, encoding: 'utf8', timeout: 15000 }).split('\t')[0].trim();
  } catch (e) {
    remoteHead = '(fetch failed)';
  }
  console.log(`Remote HEAD: ${remoteHead}`);

  // Divergence
  const localOnly = git(`rev-list --count ${remoteHead}..HEAD 2>$null`);
  const remoteOnly = git(`rev-list --count HEAD..${remoteHead} 2>$null`);
  console.log(`Divergence: local-only=${localOnly || 0}, remote-only=${remoteOnly || 0}`);

  // Tracked changes
  const trackedDiff = git('diff --name-only');
  const stagedDiff = git('diff --cached --name-only');
  const trackedClean = trackedDiff === '' && stagedDiff === '';
  console.log(`Tracked clean: ${trackedClean ? 'yes' : 'no'}`);
  if (!trackedClean) {
    if (trackedDiff) console.log(`  Unstaged: ${trackedDiff.split('\n').join(', ')}`);
    if (stagedDiff) console.log(`  Staged: ${stagedDiff.split('\n').join(', ')}`);
  }

  // Untracked files
  const untracked = git('ls-files --others --exclude-standard');
  const untrackedCount = untracked === '' ? 0 : untracked.split('\n').length;
  console.log(`Untracked count: ${untrackedCount}`);
  if (untrackedCount > 0 && untrackedCount <= 10) {
    console.log(`  ${untracked.split('\n').join(', ')}`);
  }

  // Mandatory governance files
  const requiredFiles = [
    'docs/REVIEW_GATE.md',
    'governance/product-surfaces.json',
    'docs/PRODUCT_SURFACE_MATRIX.md',
    'docs/USER_JOURNEY_ACCEPTANCE.md',
    'docs/PROJECT_STATE.md',
  ];
  console.log('\n--- Governance files ---');
  for (const f of requiredFiles) {
    const exists = fs.existsSync(path.join(ROOT, f));
    console.log(`  ${f}: ${exists ? 'OK' : 'MISSING'}`);
    if (!exists) failures++;
  }

  // Surface registry validity
  try {
    const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance/product-surfaces.json'), 'utf8'));
    console.log(`  Surface registry: ${registry.surfaces?.length || 0} surfaces`);
  } catch (e) {
    console.log(`  Surface registry: PARSE FAIL (${e.message})`);
    failures++;
  }

  console.log(`\n=== PREFLIGHT RESULT: ${failures === 0 ? 'PASS' : `FAIL (${failures})`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
