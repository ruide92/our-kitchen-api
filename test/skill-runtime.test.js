// Skill Runtime Tests — verify preflight/release-check hard-fail behavior
// R1: local HEAD != remote HEAD → preflight FAIL
// R2: remote HEAD unavailable → preflight FAIL
// R3: release gate green but HEAD mismatch → release-check FAIL
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');

const SKILL_SCRIPTS = path.resolve(__dirname, '..', 'skills', 'our-kitchen-project-director', 'scripts');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'skill-rt-'));
}

function writeFile(dir, rel, content) {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content, 'utf8');
}

function makeMinimalRepo(dir) {
  // Governance files
  writeFile(dir, 'docs/REVIEW_GATE.md', 'review gate');
  writeFile(dir, 'docs/PROJECT_STATE.md', 'state');
  writeFile(dir, 'docs/USER_JOURNEY_ACCEPTANCE.md', 'journeys');
  writeFile(dir, 'docs/PRODUCT_SURFACE_MATRIX.md', 'matrix');
  writeFile(dir, 'governance/product-surfaces.json', JSON.stringify({ surfaces: [] }));
  // package.json with release-gate script (always passes for R3)
  writeFile(dir, 'package.json', JSON.stringify({
    name: 'test',
    scripts: { 'test:release-gate': 'node -e "process.exit(0)"' }
  }));
  // SPEC_AMENDMENT
  writeFile(dir, 'docs/SPEC_AMENDMENT_12A.md', 'Status: DRAFT\nBlocked: YES');
}

function makeMockGit(dir, behavior) {
  // Create a mock git script that returns controlled output
  const gitDir = path.join(dir, '.mockbin');
  fs.mkdirSync(gitDir, { recursive: true });
  const gitScript = path.join(gitDir, process.platform === 'win32' ? 'git.cmd' : 'git');
  const lines = [];
  if (process.platform === 'win32') {
    lines.push('@echo off');
    lines.push('setlocal');
    lines.push('set "ARGS=%*"');
    // Default: behave like real git for basic commands
    lines.push('git.exe %*');
    fs.writeFileSync(gitScript, lines.join('\r\n'), 'utf8');
  } else {
    fs.writeFileSync(gitScript, '#!/bin/bash\nexec git "$@"\n', 'utf8');
    fs.chmodSync(gitScript, '755');
  }
  return gitDir;
}

function runScript(scriptName, args, cwd, extraEnv = {}) {
  const scriptPath = path.join(SKILL_SCRIPTS, scriptName);
  try {
    const out = execFileSync('node', [scriptPath, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...extraEnv }, stdio: ['pipe', 'pipe', 'pipe'] });
    return { code: 0, stdout: out };
  } catch (e) {
    return { code: e.status || 1, stdout: (e.stdout?.toString() || '') + (e.stderr?.toString() || '') };
  }
}

// R1: local HEAD != remote HEAD → preflight FAIL (authoritative direct SHA comparison)
// Origin path must contain ruide92/our-kitchen-api to pass repo identity check.
test('R1: preflight FAILs on HEAD divergence (direct SHA mismatch)', () => {
  const dir = makeTempDir();
  makeMinimalRepo(dir);
  // Init a real git repo
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['branch', '-M', 'codex/kitchen-v4'], { cwd: dir, stdio: 'pipe' });
  // Origin path contains ruide92/our-kitchen-api to satisfy repo identity
  const bare = path.join(dir, 'ruide92', 'our-kitchen-api.git');
  execFileSync('git', ['init', '--bare', bare], { stdio: 'pipe' });
  execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: dir, stdio: 'pipe' });
  // Push local to bare first
  execFileSync('git', ['push', '-u', 'origin', 'codex/kitchen-v4'], { cwd: dir, stdio: 'pipe' });
  // Create a DIFFERENT commit in bare via a separate clone (specify branch)
  const tmp2 = makeTempDir();
  execFileSync('git', ['clone', '--branch', 'codex/kitchen-v4', bare, tmp2], { stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: tmp2, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: tmp2, stdio: 'pipe' });
  writeFile(tmp2, 'remote-only-file.txt', 'remote');
  execFileSync('git', ['add', '.'], { cwd: tmp2, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'remote-only commit'], { cwd: tmp2, stdio: 'pipe' });
  execFileSync('git', ['push', 'origin', 'HEAD:codex/kitchen-v4'], { cwd: tmp2, stdio: 'pipe' });
  // Do NOT fetch into dir — local HEAD != remote HEAD

  const result = runScript('preflight.js', [], dir);
  assert.notEqual(result.code, 0, `preflight should FAIL on divergence, got code=0`);
  assert.ok(result.stdout.includes('HEAD_DIVERGENCE'),
    `must report HEAD_DIVERGENCE, got: ${result.stdout.slice(0, 600)}`);
  assert.ok(result.stdout.includes('LOCAL_HEAD:') && result.stdout.includes('REMOTE_HEAD:'),
    `must output both HEADs, got: ${result.stdout.slice(0, 600)}`);
});

// R1b: remote SHA not in local object database, ls-remote readable, local != remote
// → preflight must HEAD_DIVERGENCE FAIL (covers the dangerous un-fetched scenario)
test('R1b: preflight FAILs when remote SHA is unknown to local object DB', () => {
  const dir = makeTempDir();
  makeMinimalRepo(dir);
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'local init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['branch', '-M', 'codex/kitchen-v4'], { cwd: dir, stdio: 'pipe' });
  const bare = path.join(dir, 'ruide92', 'our-kitchen-api.git');
  execFileSync('git', ['init', '--bare', bare], { stdio: 'pipe' });
  execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: dir, stdio: 'pipe' });
  // Push local, then create remote commit from a clone that is NEVER fetched into dir
  execFileSync('git', ['push', '-u', 'origin', 'codex/kitchen-v4'], { cwd: dir, stdio: 'pipe' });
  const tmp2 = makeTempDir();
  execFileSync('git', ['clone', '--branch', 'codex/kitchen-v4', bare, tmp2], { stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'r@r.com'], { cwd: tmp2, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'R'], { cwd: tmp2, stdio: 'pipe' });
  writeFile(tmp2, 'unfetched.txt', 'never-fetched-into-dir');
  execFileSync('git', ['add', '.'], { cwd: tmp2, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'unfetched remote commit'], { cwd: tmp2, stdio: 'pipe' });
  execFileSync('git', ['push', 'origin', 'HEAD:codex/kitchen-v4'], { cwd: tmp2, stdio: 'pipe' });

  // Verify remote SHA is NOT in dir's object database
  const remoteSha = execFileSync('git', ['ls-remote', 'origin', 'codex/kitchen-v4'], { cwd: dir, encoding: 'utf8' }).split('\t')[0].trim();
  const catFile = spawnSync('git', ['cat-file', '-t', remoteSha], { cwd: dir, encoding: 'utf8' });
  assert.notEqual(catFile.status, 0, 'remote SHA should NOT exist in local object DB before preflight');

  const result = runScript('preflight.js', [], dir);
  assert.notEqual(result.code, 0, `preflight should FAIL, got code=0`);
  assert.ok(result.stdout.includes('HEAD_DIVERGENCE'),
    `must report HEAD_DIVERGENCE even when rev-list may fail, got: ${result.stdout.slice(0, 600)}`);
});

// R2: remote HEAD unavailable → preflight FAIL
test('R2: preflight FAILs when remote HEAD unknown', () => {
  const dir = makeTempDir();
  makeMinimalRepo(dir);
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['branch', '-M', 'codex/kitchen-v4'], { cwd: dir, stdio: 'pipe' });
  // Set origin to nonexistent URL
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/nonexistent/repo-that-does-not-exist-12345.git'], { cwd: dir, stdio: 'pipe' });

  const result = runScript('preflight.js', [], dir);
  assert.notEqual(result.code, 0, `preflight should FAIL on unknown remote, got code=0`);
  assert.ok(result.stdout.includes('REMOTE_HEAD_UNKNOWN') || result.stdout.includes('fetch failed'),
    `should report REMOTE_HEAD_UNKNOWN, got: ${result.stdout.slice(0, 500)}`);
});

// R3: release gate green but HEAD mismatch → release-check FAIL
test('R3: release-check FAILs on HEAD mismatch even when gate green', () => {
  const dir = makeTempDir();
  makeMinimalRepo(dir);
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['branch', '-M', 'codex/kitchen-v4'], { cwd: dir, stdio: 'pipe' });
  // Bare repo with different HEAD
  const bare = path.join(dir, 'bare.git');
  execFileSync('git', ['init', '--bare', bare], { stdio: 'pipe' });
  execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: dir, stdio: 'pipe' });
  const tmp2 = makeTempDir();
  execFileSync('git', ['clone', bare, tmp2], { stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: tmp2, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: tmp2, stdio: 'pipe' });
  writeFile(tmp2, 'remote.txt', 'r');
  execFileSync('git', ['add', '.'], { cwd: tmp2, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'r'], { cwd: tmp2, stdio: 'pipe' });
  execFileSync('git', ['push', 'origin', 'HEAD:codex/kitchen-v4'], { cwd: tmp2, stdio: 'pipe' });

  const result = runScript('release-check.js', [], dir);
  assert.notEqual(result.code, 0, `release-check should FAIL on HEAD mismatch, got code=0`);
  assert.ok(result.stdout.includes('REMOTE_HEAD_MISMATCH'),
    `should report REMOTE_HEAD_MISMATCH, got: ${result.stdout.slice(0, 500)}`);
});

// Verify no $null file created by preflight
test('R4: preflight does not create $null or temp files', () => {
  const dir = makeTempDir();
  makeMinimalRepo(dir);
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['branch', '-M', 'codex/kitchen-v4'], { cwd: dir, stdio: 'pipe' });
  const bare = path.join(dir, 'bare.git');
  execFileSync('git', ['init', '--bare', bare], { stdio: 'pipe' });
  execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['push', '-u', 'origin', 'codex/kitchen-v4'], { cwd: dir, stdio: 'pipe' });

  const before = new Set(fs.readdirSync(dir));
  runScript('preflight.js', [], dir);
  const after = new Set(fs.readdirSync(dir));
  const created = [...after].filter(f => !before.has(f));
  assert.ok(!created.includes('$null'), `$null file was created: ${created.join(', ')}`);
  // Only .git changes expected, no new top-level temp files
  const newFiles = created.filter(f => f !== '.git' && !f.startsWith('bare'));
  assert.equal(newFiles.length, 0, `unexpected temp files created: ${newFiles.join(', ')}`);
});
