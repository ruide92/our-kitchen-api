# Kitchen V4 Project State

Last updated: 2026-09-04 (Asia/Shanghai)

## Current stage

- Phase 0: complete
- Phase 1: complete
- Phase 2: complete
- Phase 2.5: complete
- Phase 3: in progress — isolated backend foundation slice; NOT complete

## Git state

- Working branch: `codex/kitchen-v4`
- Isolated worktree: `C:\Users\zhang\.config\superpowers\worktrees\our-kitchen-api\kitchen-v4`
- Base commit: `8e74014e8f5182cf8c4b97b2513b77eabadf5ec2`
- Phase 0 checkpoint: `c36c4f8573fa2519e5ba3678b4ae11622e9c6855`
- Phase 1 audit checkpoint: `78dc16c071d2fcd9221651b9b207cf1d6d9de600`
- Phase 2 specification checkpoint before state update: `9cf8eeb13a45987ea9970ba2343809676ece4ba2`
- Phase 2.5 homepage UI acceptance checkpoint: `80e5c261599a34655b9c6340257b706006a39b33`
- Phase 3 handoff gate: local and remote both verified at `27b3fcb51a13558d226b48c72d32c24ef8d94e99` after fetch/checkout/ff-only pull.
- Phase 3 foundation implementation checkpoint: `508623ef995305fcb6021a94386a33e0e57e372c`.
- Base branch: `main`
- Remote: `https://github.com/ruide92/our-kitchen-api.git`
- The original `main` checkout has a pre-existing modification to `database.json`. It has not been overwritten or included in this worktree.

## Protection and backup

- Original runtime database backup: `C:\Users\zhang\Documents\ChatGPT\菜谱小程序\backups\2026-09-03-pre-v4\database.json`
- Backup SHA-256: `FC633F7D5E58E2BA69546AEB244DAA372C548666D83BA55A25421950C6FEBCED`
- Source and backup hashes matched at backup time.
- No force push and no modification of `main` are permitted.

## Completed

### Phase 0

- Verified local `main` and GitHub `main` pointed to the same base commit.
- Created isolated `codex/kitchen-v4` worktree/branch.
- Installed locked dependencies with `npm ci`.
- Backed up the pre-existing runtime database without modifying it.

### Phase 1

- Completed frontend/backend/config audits.
- Completed isolated JsonDatabase semantic probe.
- Published `docs/AUDIT_CURRENT_STATE.md`.
- Confirmed API/field drift, missing routes, fake identity, exposed JWT secret, non-durable storage and untrustworthy legacy tests.

### Phase 2

Published and frozen seven normative specifications:

1. `docs/PRODUCT_SPEC_V4.md`
2. `docs/DATA_MODEL_V4.md`
3. `docs/API_CONTRACT_V4.md`
4. `docs/KRP_V2_SPEC.md`
5. `docs/RECOMMENDATION_ENGINE.md`
6. `docs/ACCEPTANCE_TESTS.md`
7. `docs/IMPLEMENTATION_ROADMAP.md`

Cross-document consistency review completed. During review two freeze-level inconsistencies were corrected before declaring Phase 2 complete:

- `families` and `family_settings` now explicitly carry `version` for optimistic concurrency, matching the API contract.
- Unknown/non-reliably-convertible recipe/shopping units may use `unit_code=null` with textual quantity; such rows must not be silently merged through guessed conversion.

Canonical V4 decisions now frozen include:

- `/api/v1` is the new V4 API namespace; legacy `/api` is not a source of truth.
- Shared resources use server-validated `family_id` membership boundaries.
- User/family roles are `OWNER | ADMIN | MEMBER`.
- Public/base and family recipes share one physical `recipes` table but are strictly separated by `kind + family_id + visibility` DB constraints; BASE is immutable to family users.
- Weekly plan, real meal, and meal items are distinct domain concepts.
- `quantity, spiciness, sweetness, suggested_kiss, cookware, expiry_date, storage_location, is_purchased, invite_code, rating` are the canonical V4 names.
- Ingredient matching uses canonical ingredient IDs + aliases + safe unit dimensions; no string-only shopping calculation.
- Weekly planning and random meals share one recommendation engine.
- KRP v2 requires parse → validate → preview/edit → confirm and explicit inferred/uncertain fields.
- Kiss is an append-only family ledger, not a price/score field.
- UI reference images define visual acceptance; V4 specs define business behavior.

### Phase 2.5

Homepage fixture UI implemented and visually accepted.

- Scope: `miniprogram/pages/index/*` only — homepage WXML/WXSS/JS + explicit fixture file (`homepage-fixture.js`). No backend, database, auth, API contract, or other-page changes.
- Data source: explicit local fixture matching `API_CONTRACT_V4.md` homepage contract structure. Zero legacy `/api/*` calls.
- Fixture is clearly marked as mock in file header and code comments; no visible fixture banner on the rendered homepage.
- Homepage structure accepted: family header (dual avatars + kitchen name + day/diners), four quick entries, weekly plan core area (Mon–Sun tabs, today highlighted, breakfast/lunch/dinner as compact horizontal rows with per-meal "加入本餐" button), ordered meal menu (horizontal cards with dish image/name/who-ordered + "继续添加"), five-tab bottom bar.
- Business logic accepted: date + meal_type two-dimensional isolation for local meal selections; per-meal idempotent batch add; "查看本周" uses toast placeholder (Phase 2.5 marker) until menu page is built.
- WeChat DevTools (Stable 2.02.2608060) real compile on iPhone 15 Pro simulator: **0 error** (4 internal DevTools warnings unrelated to project code).
- Homepage UI passed external Reviewer + user visual acceptance at commit `80e5c261599a34655b9c6340257b706006a39b33`.
- **Important: this is fixture UI only. It does NOT represent real multi-user backend, real family sync, or production persistence. Those remain Phase 3+.**

## In progress

### Family checkpoint (2026-09-04; awaiting PostgreSQL CI / Reviewer)

- Local Family implementation commit: `6a39392a770c94596a244a99dc6cc8fdf09f060a`.
- Push currently blocked by Git Credential Manager authentication. Noninteractive retry reports `unable to get password from user`; remote remains `ce42ac86600645a7dfd39c0da12dc684b9b55825`. Do not mark remote/CI complete.

- Canonical WeChat env correction: `33919a6ad0c2ac800a9faa0b3a744eec0b164edb`; only WECHAT_APP_ID/WECHAT_APP_SECRET, no legacy fallback.
- Family create/join/read/update/members/roles/invite rotation/settings and PATCH me implemented in isolated v1 backend.
- Shared middleware plus fresh transaction authorization; family locks protect last OWNER and optimistic version updates; settings read uses shared lock.
- 16 local unit tests pass. Expanded PostgreSQL tests must pass in CI before this checkpoint is accepted; full Phase 3 remains incomplete.
- npm audit risks recorded in PHASE3_BACKEND_PROGRESS; no audit fix or dependency version change.
- No miniprogram, legacy JsonDatabase/routes or production deployment changes.

### Foundation checkpoint (previously reviewed)

Phase 3 backend foundation in `backend/v1/`:

- Independent `start:v1`; legacy `npm start`, Render and all frontend files unchanged.
- Config fail-closed, WeChat code2Session adapter, short-lived JWT, `/api/v1/auth/wechat`, `/me`, `/me/families`, and membership gate.
- Parameterized PostgreSQL identity/membership reads; four-table core migration with transactional runner/checksum lock.
- Node tests and PostgreSQL CI service added. Local unit tests: 12 passed. Local integration: fails explicitly without TEST_DATABASE_URL (0 skipped); real PostgreSQL result must be recorded separately.
- Real PostgreSQL 16 CI at implementation checkpoint: [run 33839190932](https://github.com/ruide92/our-kitchen-api/actions/runs/33839190932) completed successfully, including npm test (12 unit + 1 core integration). This validates only the four-table foundation, not full A01–A05/A46/A47 or production behavior.
- The foundation checkpoint did not deliver family writes. Current Family slice adds them; all-resource isolation, seed, production secret rotation and deployment remain incomplete.
- See `docs/PHASE3_BACKEND_PROGRESS.md` for scope, validation and remaining work.
- Menu fixture commits through `27b3fcb` are preserved. No `miniprogram/**` modifications permitted in this slice; menu visual acceptance remains outstanding but not a backend blocker.

## Not started

- Phase 3 remaining: complete schema/seed, member preference/pantry summaries, production secret rotation/persistence rollout and all-resource isolation.
- Phase 4+ recipe assets, meal/shopping/cooking core, recommendation, KRP, family experience and future community work.

## Known critical risks

- Publicly exposed hard-coded JWT secret and tracked runtime user data remain in legacy code until Phase 3 migration.
- Fake openid derived from `wx.login` code remains in legacy code until Phase 3.
- JsonDatabase still cannot implement route SQL semantics and must not be extended.
- Existing production JSON persistence is not V4-compliant.
- Existing frontend remains connected to legacy contract until phased migration.
- Phase 2.5 homepage is fixture UI only; must not be described as real multi-user completion until Phase 3 backend is live.

## Test status

Baseline evidence remains:

- `npm ci`: pass (99 packages installed at Phase 1 baseline).
- JavaScript syntax baseline: 34 project files checked, 0 failures at Phase 1.
- Legacy `test-api.js` is not accepted as trustworthy.
- Isolated JsonDatabase probe confirmed broken pagination/search/count/JOIN/COALESCE/update-expression behavior.

Phase 2 consisted only of specification documents; no business code or production deployment was modified. Normative cross-check was performed across Product ↔ Data Model ↔ API ↔ Acceptance Tests plus KRP/Recommendation/Roadmap.

Phase 2.5 added homepage fixture UI only. WeChat DevTools real compile: 0 error. No backend, database, or auth code was touched.

## Deployment status

- No deployment changed.
- `main` not modified or merged.
- Existing Render API remains legacy/non-V4.

## Next first action

Restore GitHub authentication, push existing commits without rewriting them, wait for new PostgreSQL CI to complete, record the actual run, then return to Reviewer. Do not proceed to another Phase or touch frontend fixtures. Member preferences/pantry summaries and full schema/seed remain explicitly pending.
