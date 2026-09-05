#!/usr/bin/env node
// Preflight — verify repository identity, branch, HEAD, cleanliness, governance files
// Uses spawnSync with argv array — no shell redirection, no 2>$null, cross-platform.
// Usage: node skills/our-kitchen-project-director/scripts/preflight.js
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const EXPECTED_REPO = 'ruide92/our-kitchen-api';
const EXPECTED_BRANCH = 'codex/kitchen-v4';

function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return (r.stdout || '').trim();
}

function gitNoProxy(args) {
  const env = { ...process.env, http_proxy: '', https_proxy: '', HTTP_PROXY: '', HTTPS_PROXY: '' };
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', env, timeout: 15000 });
  return { stdout: (r.stdout || '').trim(), status: r.status };
}

function main() {
  let failures = 0;

  console.log('=== PROJECT PREFLIGHT ===');

  // Repository identity
  const origin = git(['remote', 'get-url', 'origin']);
  const repoMatch = origin.includes(EXPECTED_REPO);
  console.log(`Origin: ${origin}`);
  console.log(`Repository identity: ${repoMatch ? 'OK' : 'FAIL'} (expected ${EXPECTED_REPO})`);
  if (!repoMatch) failures++;

  // Branch
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const branchMatch = branch === EXPECTED_BRANCH;
  console.log(`Branch: ${branch}`);
  console.log(`Branch match: ${branchMatch ? 'OK' : 'FAIL'} (expected ${EXPECTED_BRANCH})`);
  if (!branchMatch) failures++;

  // Local HEAD
  const localHead = git(['rev-parse', 'HEAD']);
  console.log(`LOCAL_HEAD: ${localHead}`);

  // Remote HEAD (specific branch, no proxy)
  const remoteResult = gitNoProxy(['ls-remote', 'origin', EXPECTED_BRANCH]);
  let remoteHead = '';
  if (remoteResult.status === 0 && remoteResult.stdout) {
    remoteHead = remoteResult.stdout.split('\t')[0].trim();
    console.log(`REMOTE_HEAD: ${remoteHead}`);
  } else {
    console.log(`REMOTE_HEAD: UNKNOWN (fetch failed, status=${remoteResult.status})`);
    failures++;
    console.log('FAIL: REMOTE_HEAD_UNKNOWN');
  }

  // Divergence — hard fail if mismatch
  if (remoteHead) {
    const localOnly = git(['rev-list', '--count', `${remoteHead}..HEAD`]);
    const remoteOnly = git(['rev-list', '--count', `HEAD..${remoteHead}`]);
    const lo = parseInt(localOnly, 10) || 0;
    const ro = parseInt(remoteOnly, 10) || 0;
    console.log(`LOCAL_ONLY: ${lo}`);
    console.log(`REMOTE_ONLY: ${ro}`);
    if (lo > 0 || ro > 0) {
      console.log('FAIL: HEAD_DIVERGENCE (local != remote)');
      failures++;
    } else {
      console.log('HEAD match: yes');
    }
  }

  // Tracked changes
  const trackedDiff = git(['diff', '--name-only']);
  const stagedDiff = git(['diff', '--cached', '--name-only']);
  const trackedClean = trackedDiff === '' && stagedDiff === '';
  console.log(`Tracked clean: ${trackedClean ? 'yes' : 'no'}`);
  if (!trackedClean) {
    if (trackedDiff) console.log(`  Unstaged: ${trackedDiff.split('\n').join(', ')}`);
    if (stagedDiff) console.log(`  Staged: ${stagedDiff.split('\n').join(', ')}`);
  }

  // Untracked files
  const untracked = git(['ls-files', '--others', '--exclude-standard']);
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
