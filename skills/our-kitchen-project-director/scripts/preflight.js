#!/usr/bin/env node
// Preflight — verify repository identity, branch, HEAD, cleanliness, governance files
// Uses spawnSync with argv array — no shell redirection, no 2>$null, cross-platform.
// HEAD comparison is authoritative: direct SHA mismatch blocks preflight.
// Usage: node skills/our-kitchen-project-director/scripts/preflight.js
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const EXPECTED_REPO = 'ruide92/our-kitchen-api';
const EXPECTED_BRANCH = 'codex/kitchen-v4';

function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return {
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim(),
    status: r.status,
  };
}

function gitNoProxy(args) {
  const env = { ...process.env, http_proxy: '', https_proxy: '', HTTP_PROXY: '', HTTPS_PROXY: '' };
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', env, timeout: 15000 });
  return {
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim(),
    status: r.status,
  };
}

function main() {
  let failures = 0;

  console.log('=== PROJECT PREFLIGHT ===');

  // Repository identity
  const originR = git(['remote', 'get-url', 'origin']);
  const origin = originR.stdout;
  const repoMatch = origin.includes(EXPECTED_REPO);
  console.log(`Origin: ${origin}`);
  console.log(`Repository identity: ${repoMatch ? 'OK' : 'FAIL'} (expected ${EXPECTED_REPO})`);
  if (!repoMatch) failures++;

  // Branch
  const branchR = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = branchR.stdout;
  const branchMatch = branch === EXPECTED_BRANCH;
  console.log(`Branch: ${branch}`);
  console.log(`Branch match: ${branchMatch ? 'OK' : 'FAIL'} (expected ${EXPECTED_BRANCH})`);
  if (!branchMatch) failures++;

  // Local HEAD
  const localR = git(['rev-parse', 'HEAD']);
  const localHead = localR.stdout;
  console.log(`LOCAL_HEAD: ${localHead}`);

  // Remote HEAD (specific branch, no proxy)
  const remoteR = gitNoProxy(['ls-remote', 'origin', EXPECTED_BRANCH]);
  let remoteHead = '';
  if (remoteR.status === 0 && remoteR.stdout) {
    remoteHead = remoteR.stdout.split('\t')[0].trim();
    console.log(`REMOTE_HEAD: ${remoteHead}`);
  } else {
    console.log(`REMOTE_HEAD: UNKNOWN (status=${remoteR.status}, stderr=${remoteR.stderr.slice(0, 100)})`);
    failures++;
    console.log('FAIL: REMOTE_HEAD_UNKNOWN');
  }

  // Authoritative HEAD comparison — direct SHA mismatch blocks preflight
  if (remoteHead && localHead !== remoteHead) {
    console.log('FAIL: HEAD_DIVERGENCE (direct SHA mismatch)');
    console.log(`  LOCAL_HEAD:  ${localHead}`);
    console.log(`  REMOTE_HEAD: ${remoteHead}`);
    failures++;
  } else if (remoteHead) {
    console.log('HEAD match: yes (direct SHA comparison)');
  }

  // Auxiliary divergence counts — only diagnostic, must check git status
  if (remoteHead) {
    const loR = git(['rev-list', '--count', `${remoteHead}..HEAD`]);
    const roR = git(['rev-list', '--count', `HEAD..${remoteHead}`]);
    if (loR.status === 0 && roR.status === 0) {
      const lo = parseInt(loR.stdout, 10) || 0;
      const ro = parseInt(roR.stdout, 10) || 0;
      console.log(`LOCAL_ONLY: ${lo}`);
      console.log(`REMOTE_ONLY: ${ro}`);
    } else {
      console.log('DIVERGENCE_COUNT_UNKNOWN (rev-list command failed)');
    }
  }

  // Tracked changes
  const trackedDiff = git(['diff', '--name-only']).stdout;
  const stagedDiff = git(['diff', '--cached', '--name-only']).stdout;
  const trackedClean = trackedDiff === '' && stagedDiff === '';
  console.log(`Tracked clean: ${trackedClean ? 'yes' : 'no'}`);
  if (!trackedClean) {
    if (trackedDiff) console.log(`  Unstaged: ${trackedDiff.split('\n').join(', ')}`);
    if (stagedDiff) console.log(`  Staged: ${stagedDiff.split('\n').join(', ')}`);
  }

  // Untracked files
  const untracked = git(['ls-files', '--others', '--exclude-standard']).stdout;
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
