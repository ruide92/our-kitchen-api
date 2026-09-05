#!/usr/bin/env node
// Release Check — run release gate, report blockers, decide if QR allowed
// Usage: node skills/our-kitchen-project-director/scripts/release-check.js
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();

function main() {
  console.log('=== RELEASE CHECK ===');

  // 1. Run release gate
  console.log('\n--- npm run test:release-gate ---');
  let releaseCode = 0;
  let releaseOutput = '';
  try {
    releaseOutput = execSync('npm run test:release-gate', { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    console.log(releaseOutput.trim());
  } catch (e) {
    releaseCode = e.status || 1;
    releaseOutput = (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
    console.log(releaseOutput.trim());
  }

  if (releaseCode !== 0) {
    console.log('\n========================================');
    console.log('RELEASE BLOCKED — release gate non-zero');
    console.log('========================================');
    console.log('No QR. No preview acceptance. No user scan.');
    console.log('Fix blockers, re-run release gate.');
    process.exit(1);
  }

  // 2. Release gate green — verify prerequisites
  console.log('\n--- Release prerequisites ---');

  // Remote HEAD
  const { execSync: ex } = require('node:child_process');
  let remoteHead = '';
  try {
    remoteHead = ex('git -c http.proxy= -c https.proxy= ls-remote origin codex/kitchen-v4', { cwd: ROOT, encoding: 'utf8', timeout: 15000 }).split('\t')[0].trim();
  } catch { remoteHead = '(unknown)'; }
  const localHead = ex('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  console.log(`Local HEAD:  ${localHead}`);
  console.log(`Remote HEAD: ${remoteHead}`);
  console.log(`Match: ${localHead === remoteHead ? 'yes' : 'NO — push first'}`);

  // 008 status
  const amendmentPath = path.join(ROOT, 'docs/SPEC_AMENDMENT_12A.md');
  let amendmentStatus = 'not found';
  if (fs.existsSync(amendmentPath)) {
    const content = fs.readFileSync(amendmentPath, 'utf8');
    const statusMatch = content.match(/Status:\s*(\w+)/);
    const blockedMatch = content.match(/Blocked:\s*(YES|NO)/i);
    amendmentStatus = `${statusMatch?.[1] || 'unknown'}${blockedMatch?.[1] === 'YES' ? ' (BLOCKED)' : ''}`;
  }
  console.log(`008 Amendment: ${amendmentStatus}`);

  console.log('\n=== RELEASE GATE GREEN ===');
  console.log('Proceed to deploy + public E2E + preview if all prerequisites met.');
  process.exit(0);
}

main();
