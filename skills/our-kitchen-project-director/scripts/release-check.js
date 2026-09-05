#!/usr/bin/env node
// Release Check — run release gate, verify HEAD match, decide predeploy eligibility
// Does NOT authorize final QR. QR requires post-deploy evidence separately.
// Usage: node skills/our-kitchen-project-director/scripts/release-check.js
const { spawnSync, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const EXPECTED_BRANCH = 'codex/kitchen-v4';

function gitNoProxy(args) {
  const env = { ...process.env, http_proxy: '', https_proxy: '', HTTP_PROXY: '', HTTPS_PROXY: '' };
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', env, timeout: 15000 });
  return { stdout: (r.stdout || '').trim(), status: r.status };
}

function main() {
  console.log('=== RELEASE CHECK ===');

  // 1. Run release gate
  console.log('\n--- npm run test:release-gate ---');
  let releaseCode = 0;
  try {
    const out = execSync('npm run test:release-gate', { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    console.log(out.trim());
  } catch (e) {
    releaseCode = e.status || 1;
    const out = (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
    console.log(out.trim());
  }

  if (releaseCode !== 0) {
    console.log('\n========================================');
    console.log('RELEASE BLOCKED — release gate non-zero');
    console.log('========================================');
    console.log('No QR. No preview acceptance. No user scan.');
    console.log('Fix blockers, re-run release gate.');
    process.exit(1);
  }

  // 2. Release gate green — verify HEAD match
  console.log('\n--- HEAD verification ---');
  const localHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const remoteResult = gitNoProxy(['ls-remote', 'origin', EXPECTED_BRANCH]);

  if (remoteResult.status !== 0 || !remoteResult.stdout) {
    console.log('LOCAL_HEAD: ' + localHead);
    console.log('REMOTE_HEAD: UNKNOWN');
    console.log('\nRELEASE BLOCKED — REMOTE_HEAD_UNKNOWN');
    console.log('Cannot verify deployment target. Push or fix network.');
    process.exit(1);
  }

  const remoteHead = remoteResult.stdout.split('\t')[0].trim();
  console.log('LOCAL_HEAD: ' + localHead);
  console.log('REMOTE_HEAD: ' + remoteHead);

  if (localHead !== remoteHead) {
    console.log('\nRELEASE BLOCKED — REMOTE_HEAD_MISMATCH');
    console.log('Push latest commit before deploy.');
    process.exit(1);
  }
  console.log('HEAD match: yes');

  // 3. 008 status
  const amendmentPath = path.join(ROOT, 'docs/SPEC_AMENDMENT_12A.md');
  let amendmentStatus = 'not found';
  if (fs.existsSync(amendmentPath)) {
    const content = fs.readFileSync(amendmentPath, 'utf8');
    const statusMatch = content.match(/Status:\s*(\w+)/);
    const blockedMatch = content.match(/Blocked:\s*(YES|NO)/i);
    amendmentStatus = `${statusMatch?.[1] || 'unknown'}${blockedMatch?.[1] === 'YES' ? ' (BLOCKED)' : ''}`;
  }
  console.log(`008 Amendment: ${amendmentStatus}`);

  // 4. Predeploy eligibility — NOT final QR authorization
  console.log('\n========================================');
  console.log('PREDEPLOY ELIGIBLE');
  console.log('========================================');
  console.log('Release gate green + HEAD match verified.');
  console.log('');
  console.log('QR STILL BLOCKED UNTIL POST-DEPLOY EVIDENCE COMPLETE:');
  console.log('  1. Render deploy verified (service logs, version)');
  console.log('  2. Migration state verified on Neon');
  console.log('  3. Public E2E with REAL auth (not synthetic)');
  console.log('  4. Preview artifact generated');
  console.log('  5. DevTools compile 0 errors');
  console.log('');
  console.log('This script does NOT authorize final QR.');
  process.exit(0);
}

main();
