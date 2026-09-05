// Skill Runtime Tests — verify preflight/release-check hard-fail behavior
// R1: local HEAD != remote HEAD → preflight FAIL
// R2: remote HEAD unavailable → preflight FAIL
// R3: release gate green but HEAD mismatch → release-check FAIL
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

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

// R1: local HEAD != remote HEAD → preflight FAIL
// We test this by checking the divergence logic: preflight calls git rev-list --count
// and if >0, increments failures. We verify by code inspection + a controlled scenario.
test('R1: preflight FAILs on HEAD divergence', () => {
  const dir = makeTempDir();
  makeMinimalRepo(dir);
  // Init a real git repo with one commit
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['branch', '-M', 'codex/kitchen-v4'], { cwd: dir, stdio: 'pipe' });
  // Set origin to a local bare repo with DIFFERENT HEAD
  const bare = path.join(dir, 'bare.git');
  execFileSync('git', ['init', '--bare', bare], { stdio: 'pipe' });
  execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: dir, stdio: 'pipe' });
  // Create a different commit in bare
  const tmp2 = makeTempDir();
  execFileSync('git', ['clone', bare, tmp2], { stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: tmp2, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: tmp2, stdio: 'pipe' });
  writeFile(tmp2, 'remote-file.txt', 'remote');
  execFileSync('git', ['add', '.'], { cwd: tmp2, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'remote commit'], { cwd: tmp2, stdio: 'pipe' });
  execFileSync('git', ['push', 'origin', 'HEAD:codex/kitchen-v4'], { cwd: tmp2, stdio: 'pipe' });

  const result = runScript('preflight.js', [], dir);
  assert.notEqual(result.code, 0, `preflight should FAIL on divergence, got code=0`);
  assert.ok(result.stdout.includes('HEAD_DIVERGENCE') || result.stdout.includes('REMOTE_ONLY'),
    `should report divergence, got: ${result.stdout.slice(0, 500)}`);
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
