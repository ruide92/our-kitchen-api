# Kitchen V4 Project State

Last updated: 2026-09-03 (Asia/Shanghai)

## Current stage

- Phase 0: complete
- Phase 1: in progress
- Phase 2: not started
- Phase 2.5: not started

## Git state

- Working branch: `codex/kitchen-v4`
- Isolated worktree: `C:\Users\zhang\.config\superpowers\worktrees\our-kitchen-api\kitchen-v4`
- Base commit: `8e74014e8f5182cf8c4b97b2513b77eabadf5ec2`
- Base branch: `main`
- Remote: `https://github.com/ruide92/our-kitchen-api.git`
- The original `main` checkout has a pre-existing modification to `database.json`. It has not been overwritten or included in this worktree.

## Protection and backup

- Original runtime database backup: `C:\Users\zhang\Documents\ChatGPT\菜谱小程序\backups\2026-09-03-pre-v4\database.json`
- Backup SHA-256: `FC633F7D5E58E2BA69546AEB244DAA372C548666D83BA55A25421950C6FEBCED`
- Source and backup hashes matched at backup time.
- No force push and no modification of `main` are permitted.

## Completed

- Verified local `main` and GitHub `main` pointed to the same base commit.
- Created the isolated `codex/kitchen-v4` worktree.
- Installed locked dependencies with `npm ci`.
- Recorded the approved V4 phase order and two-pass homepage acceptance model.
- Started independent Luna read-only audits for frontend, backend, and quality/configuration.

## In progress

- Full evidence-based Phase 1 audit.
- Page-to-client-to-route-to-database API contract matrix.
- Classification of features as working, partial, UI-only, missing, bugged, architectural risk, or security risk.

## Not started

- Phase 2 specification freeze.
- Phase 2.5 homepage fixture implementation and WeChat DevTools screenshot acceptance.
- Phase 3 PostgreSQL, real WeChat identity, family isolation, and production persistence.

## Known critical risks

- Publicly exposed hard-coded JWT secret and tracked runtime user data.
- Fake openid derived from `wx.login` code without `code2Session` verification.
- The JSON SQL emulator does not implement SQL semantics used by routes.
- Frontend API names, backend routes, and stored fields are inconsistent.
- Existing production JSON storage is not an acceptable durable database.

## Test status

- `npm ci`: pass (99 packages installed).
- JavaScript syntax baseline: 34 project files checked, 0 failures.
- `package.json` contains no `test` script; the legacy API script is not accepted as a trustworthy baseline.
- Full Phase 1 static and behavioral audit is in progress.

## Deployment status

- Existing Render API was reachable during the pre-Phase audit.
- Existing production behavior is not yet accepted as V4-compliant.
- No deployment has been changed by this branch.

## Next first action

Finish `docs/AUDIT_CURRENT_STATE.md`, verify every claim against the worktree, commit Phase 0/1 documentation, and push `codex/kitchen-v4`.
