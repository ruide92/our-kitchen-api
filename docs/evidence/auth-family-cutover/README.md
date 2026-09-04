# TASK-REAL-AUTH-FAMILY-CUTOVER-01 evidence

## Scope

Base: `c40c6db20d0e8e839a22ecb65ebe19edb08b70b3` (local/remote clean gate verified).
Commit A: `fc9b6543b10f7896a69d1f5d4570a6946ca7d68d`.
Commit B contains the Mine controller/view, race regressions, this report and screenshot. Source SHA256 in `runtime-report.json` binds the working-tree runtime capture to those exact inputs before Commit B.

## Automated tests

`npm run test:unit`: 38 pass / 0 fail / 0 skipped, including the existing 16 backend tests. Frontend tests use isolated test-only wx/request adapters, never real secrets. Coverage includes the requested 12 cases plus 401 memory clearing, late-401 protection, family switch races, stale creation follow-up, stale onShow refresh, nickname PATCH races and Mine lifecycle/view mapping.

Local TEST_DATABASE_URL is absent: local PostgreSQL integration was not run. Commit A GitHub PostgreSQL workflow [33886425548](https://github.com/ruide92/our-kitchen-api/actions/runs/33886425548) succeeded. Later CI is regression evidence only, not real WeChat-user acceptance.

## DevTools actual run

Executed installed CLI:

```text
D:\微信web开发者工具\cli.bat auto --project <worktree>\miniprogram --auto-port 9420
```

CLI result: exit 0, auto succeeded. Internal tool emitted a punycode deprecation warning. It is not a project compilation error.

Ran `scripts/verify-auth-family-devtools.cjs` through miniprogram-automator installed outside the repository in a tool cache. No application dependency was changed. The script does not mock wx, inject tokens or set page data.

Initial SDK navigation tried to read metadata from an empty simulator. Diagnostic: `getPageMetaByWebviewId` returned null. Direct documented `callWxMethod('reLaunch',...)` navigated successfully; the final capture used that route after the simulator was ready. This was a tool-readiness issue, not evidence of business success.

Final actual observation:

- Page: `pages/mine/mine`.
- State: `authFailed`; authenticated=false; has_family=false.
- UI explicitly shows `BLOCKED_BY_ENV`; no fabricated account, family or statistics.
- Project exceptions observed during run: 0.
- Simulator: iPhone 12/13 (Pro), window 390×753. No claim that this is iPhone15 visual acceptance.
- Screenshot: [mine-BLOCKED_BY_ENV.png](mine-BLOCKED_BY_ENV.png).
- Machine report: [runtime-report.json](runtime-report.json).

## Real business status

DATABASE_URL, JWT_SECRET, WECHAT_APP_ID, WECHAT_APP_SECRET and TEST_DATABASE_URL were not supplied. Only .env.example exists locally. App attempts real wx.login and the real V1 origin; no backend/env was manufactured.

Real server-validated login, actual family create/join, and two-phone membership=2 acceptance: **NOT DONE — BLOCKED_BY_ENV**. Successful/onboarding branches are automatically tested, not passed off as live DevTools business screenshots.

## Cutover details / remaining work

- Central origin: `miniprogram/config/v1.js`. HTTP loopback is refused outside DevTools; configure approved HTTPS service before phone use.
- Storage keys isolated; no legacy storage clears or writes.
- Mine keeps its warm card/sheet style. User/family/member/settings data come only from V1; profile edits only nickname; no avatar upload, settings mutation, role/delete/rotate UI.
- Zero-family and multi-family selection are explicit. Create/join post-success read failure is reported without pretending the mutation itself failed or inventing data.
- Existing mine-fixture.js remains unused for recovery/reference. Other four tabs and Custom TabBar remain unchanged fixtures.
- No backend, legacy api.js/server/database logic or production deployment changes.
