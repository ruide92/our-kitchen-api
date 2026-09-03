# Kitchen V4 Project State

Last updated: 2026-09-03 (Asia/Shanghai)

## Current stage

- Phase 0: complete
- Phase 1: complete
- Phase 2: not started
- Phase 2.5: not started

## Git state

- Working branch: `codex/kitchen-v4`
- Isolated worktree: `C:\Users\zhang\.config\superpowers\worktrees\our-kitchen-api\kitchen-v4`
- Base commit: `8e74014e8f5182cf8c4b97b2513b77eabadf5ec2`
- Phase 0 checkpoint: `c36c4f8573fa2519e5ba3678b4ae11622e9c6855`
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
- Completed independent Luna read-only audits for frontend, backend, and quality/configuration; all three reported without editing the worktree.
- Completed an isolated JsonDatabase semantics probe using a temporary copy.
- Published the evidence-backed current-state audit.

## In progress

- Preparing the Phase 2 specification freeze.

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
- Isolated JsonDatabase probe confirmed broken pagination/search/count/JOIN/COALESCE/update-expression behavior.
- Phase 1 findings are recorded in `docs/AUDIT_CURRENT_STATE.md`.

## Deployment status

- Existing Render API was reachable during the pre-Phase audit.
- Existing production behavior is not yet accepted as V4-compliant.
- No deployment has been changed by this branch.

## Next first action

Write and cross-review the seven Phase 2 normative specifications, then freeze field names, family boundaries, API contracts, KRP v2, recommendation rules, acceptance tests, and the implementation roadmap.
