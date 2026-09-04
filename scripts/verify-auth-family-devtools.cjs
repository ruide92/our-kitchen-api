// Runtime evidence only. Never mock wx.login, inject a token, or set fixture data.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const automator = require(process.argv[2] || 'miniprogram-automator');

async function main() {
  const output = path.resolve('docs/evidence/auth-family-cutover');
  await fs.mkdir(output, { recursive: true });
  const mini = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  let projectExceptions = 0;
  mini.on('exception', () => { projectExceptions++; });
  try {
    // SDK reLaunch asks currentPage first, which fails on an initial empty
    // simulator. Call the documented wx navigation method directly instead.
    await mini.callWxMethod('reLaunch', { url: '/pages/mine/mine' });
    let page;
    const navigationDeadline = Date.now() + 10000;
    while (!page && Date.now() < navigationDeadline) {
      try { page = await mini.currentPage(); } catch (_) {}
      if (!page) await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!page) throw new Error('Mine navigation did not produce a page');
    const deadline = Date.now() + 20000;
    let status;
    do {
      status = await page.data('status');
      if (status !== 'loading') break;
      await new Promise(resolve => setTimeout(resolve, 200));
    } while (Date.now() < deadline);
    if (status === 'loading') throw new Error('Session did not settle in the observation window');
    const info = await mini.systemInfo();
    const environmentBlocked = await page.data('environmentBlocked');
    const file = environmentBlocked ? 'mine-BLOCKED_BY_ENV.png' : 'mine-runtime.png';
    await mini.screenshot({ path: path.join(output, file) });
    const sourceHashes = {};
    for (const file of ['miniprogram/app.js','miniprogram/config/v1.js','miniprogram/utils/v1-api.js','miniprogram/utils/v1-session.js','miniprogram/pages/mine/mine.js','miniprogram/pages/mine/mine-controller.js','miniprogram/pages/mine/mine.wxml','miniprogram/pages/mine/mine.wxss']) {
      sourceHashes[file] = createHash('sha256').update(await fs.readFile(file)).digest('hex');
    }
    const report = {
      observed_at: new Date().toISOString(),
      base_head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      working_tree_changes: execFileSync('git', ['diff', '--name-only'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean),
      page: page.path, status, environment_status: environmentBlocked ? 'BLOCKED_BY_ENV' : 'REQUIRES_MANUAL_BUSINESS_ACCEPTANCE',
      authenticated: await page.data('authenticated'), has_family: await page.data('hasFamily'),
      fixture_injected: false, project_exceptions_observed: projectExceptions,
      device: { model: info.model, platform: info.platform, window_width: info.windowWidth, window_height: info.windowHeight },
      screenshot: file,
      source_sha256: sourceHashes,
      real_login_accepted: false, real_family_creation_accepted: false, dual_user_accepted: false
    };
    await fs.writeFile(path.join(output, 'runtime-report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
    if (projectExceptions) process.exitCode = 1;
  } finally { mini.disconnect(); }
}
main().catch(() => { console.error('DevTools runtime verification failed; no business PASS claimed'); process.exitCode = 1; });
