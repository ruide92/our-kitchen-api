# Kitchen V4 Project State

Last updated: 2026-09-05 (Asia/Shanghai)

## Current stage

### V1 LOCAL REAL AUTH/FAMILY CHECKPOINT (2026-09-05)

Local V1 environment and real WeChat login verified end-to-end on this machine.

- PostgreSQL 16.15 local environment: **PASS** (service running, localhost:5432)
- Migration (`node --env-file=.env backend/v1/migrate-cli.js`): **PASS** — "Core migrations applied"
- Unit tests: **38/38 PASS**, 0 fail
- PostgreSQL integration tests: **19/19 PASS**, 0 fail (real PostgreSQL Family HTTP checkpoint)
- `DATABASE_URL`: **PRESENT** (dev DB `our_kitchen_v1_dev`, owner `our_kitchen_v1`)
- `TEST_DATABASE_URL`: **PRESENT** (test DB `our_kitchen_v1_test`)
- `WECHAT_APP_SECRET`: **PRESENT** (32-char, written to local `.env`; not committed)
- Local V1 server (`node --env-file=.env backend/v1/start.js`): **PASS** — listening on 3101; `GET /api/v1/me` without token returns **401 AUTH_REQUIRED** (not 404)
- Real WeChat login (`wx.login` → `POST /api/v1/auth/wechat`): **LOGIN_ACCEPTED** — user created/upserted, JWT issued
- Real `/api/v1/me`: **PASS** — authenticated user returned
- Real family: first login had 0 families → created **"我们的小厨房"** → role **OWNER**
- Real members: current user **ACTIVE**, role **OWNER**, members=1
- Real family settings: **PASS** — `family_id` consistent, `default_diners=2`
- v1Session runtime: **PASS** — backend request log confirms bootstrap auto-loads `/me`, `/me/families`, `/families/{id}`, `/members`, `/settings` all 200
- Mine page:
  - Code/Data Wiring: **PASS** — `mine.js` uses `mine-controller`; `mine-fixture.js` intentionally not imported
  - Runtime Backend Evidence: **PASS** — real session data flows through v1Session
  - Visual Acceptance: **PENDING** — DevTools GUI obstacle prevented capturing the Mine tab screenshot; not claimed as visual PASS
- `.env` is gitignored; no secrets committed. No AppSecret, database password, DATABASE_URL, openid, token, or JWT secret recorded in this document.

**Explicitly NOT DONE at this checkpoint:**

- Public HTTPS V1 deployment: **NOT DONE** (only localhost loopback, DevTools-only)
- Second WeChat user / 糖糖 join: **NOT DONE**
- Two-user members=2 verification: **NOT DONE**
- Homepage / Menu / Fridge / Shopping List: still **fixture data**; not wired to real backend
- Recipe / weekly plan / meal / inventory / shopping / recommendation cutover: **NOT DONE**

### PUBLIC V1 DEPLOYMENT CHECKPOINT (2026-09-05)

Public cloud V1 environment deployed and verified with real WeChat login.

- Neon PostgreSQL (Free tier, aws-us-east-2): **PASS** — project `our-kitchen-v1`, branch `br-curly-queen-aejg97pm`, SSL connection string verified with Node pg
- Cloud migration (`backend/v1/migrate-cli.js` against Neon): **PASS** — "Core migrations applied"; core tables `users`, `families`, `family_members`, `family_settings`, `family_cookware`, `schema_migrations` confirmed
- Render Web Service (Free tier): **PASS** — `our-kitchen-v1`, branch `codex/kitchen-v4`, build `npm ci`, start `npm run start:v1`, deploy succeeded in 31.4s
- Public HTTPS URL: **https://our-kitchen-v1.onrender.com**
- Render environment variables: `DATABASE_URL` **PRESENT**, `WECHAT_APP_ID` **PRESENT**, `WECHAT_APP_SECRET` **PRESENT**, `JWT_SECRET` **PRESENT** (newly generated 64-hex-char secret, not reused from local)
- Public `GET /api/v1/me` without token: **401 AUTH_REQUIRED** (not 404) — confirms HTTPS, V1 routing, and auth middleware
- Public `POST /api/v1/auth/wechat` with invalid code: **401** — V1 auth endpoint exists and rejects bad codes
- Public real WeChat login: **PUBLIC_LOGIN_ACCEPTED** — DevTools CLI recompile triggered `wx.login`; Neon `users` table shows 1 user created at 2026-09-05T01:26:05Z (first public login)
- Public user: **PASS** — real WeChat openid stored, user row exists in Neon
- Public family: **"我们的小厨房"** — created in Neon (first login had 0 families); invite_code generated; `header_mode=DUAL_AVATAR`
- Public member: **ACTIVE / OWNER**, members=1
- Public settings: **PASS** — `default_diners=2`, `breakfast_target_count=2`, `lunch_target_count=2`, `dinner_target_count=3`, `random_default_mode=BALANCED`
- Mini program `config/v1.js`: baseUrl switched from `http://127.0.0.1:3101` to `https://our-kitchen-v1.onrender.com`
- Mine Visual Acceptance: **PENDING** — DevTools GUI obstacle persists; not claimed as visual PASS
- No secrets recorded in this document. No AppSecret, database password, DATABASE_URL, Neon connection string, openid, token, or JWT secret.

**Explicitly NOT DONE at this checkpoint:**

- Second WeChat user / 糖糖 join: **NOT DONE**
- Two-user members=2 verification: **NOT DONE**
- Homepage / Menu / Fridge / Shopping List: still **fixture data**; not wired to real public backend
- Recipe / weekly plan / meal / inventory / shopping / recommendation cutover: **NOT DONE**
- WeChat official request domain whitelist for `onrender.com`: **NOT DONE** (current DevTools uses debug mode; production release requires compliant HTTPS domain)
- Render free instance cold-start latency (up to 50s) accepted for dev; not optimized

### TASK-REAL-AUTH-FAMILY-CUTOVER-01 (2026-09-04)

- Handoff gate passed: local = remote = `c40c6db20d0e8e839a22ecb65ebe19edb08b70b3`, clean worktree after fetch.
- Commit A: `fc9b6543b10f7896a69d1f5d4570a6946ca7d68d`, pushed. [CI 33886425548](https://github.com/ruide92/our-kitchen-api/actions/runs/33886425548) completed successfully.
- V1 API/session/bootstrap implemented with isolated `v1_token`, `v1_user`, `v1_active_family_id`; no legacy auth/storage operations. One pending bootstrap promise; explicit retry; no fake fallback.
- Mine normal path no longer imports fixture. Real endpoint wiring: account, create/join, membership selection, family/members/settings reads, nickname PATCH and invite copy. Statistics are unavailable markers, avatar display only, settings read only.
- Backend unchanged. Homepage/menu/fridge/shopping and Custom TabBar unchanged; their business data remain fixture. Do not describe them as real shared data.
- Local unit tests: 38 pass, 0 fail, 0 skipped (16 backend + 22 frontend/session/Mine).
- Local PostgreSQL integration: not run because TEST_DATABASE_URL is absent. CI evidence is separate and does not prove real WeChat login.
- Real WeChat + V1 environment: `BLOCKED_BY_ENV`. DATABASE_URL/JWT_SECRET/WECHAT_APP_ID/WECHAT_APP_SECRET absent; no local .env beyond example. No server credentials added to mini program.
- DevTools CLI auto returned success; actual Mine runtime captured as authFailed/BLOCKED_BY_ENV, 0 project exceptions observed, no injected fixture/token. [Screenshot](evidence/auth-family-cutover/mine-BLOCKED_BY_ENV.png) and [runtime report](evidence/auth-family-cutover/runtime-report.json) include source hashes. Simulator was iPhone 12/13 Pro, not claimed as iPhone15 evidence.
- Real login accepted: NO. Real family creation/join accepted: NO. Two-phone test accepted: NO. These require configured backend and real WeChat users; unit adapters are not business acceptance.
- Stop after Commit B push/verification. No recipe/weekly/meal/inventory/shopping/recommendation/KRP cutover or production deployment.

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
- V1 Auth/Family frontend cutover checkpoint: `f2f392ea837483d16e5dfc1f348d35da374cf18e`
- V1 local real auth/family acceptance checkpoint: `718aa944d948bbcfa3b5e7f1ac85053d8f040cd0`
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

### Historical Family checkpoint (superseded by the c40c6db handoff)

- Local Family implementation commit: `6a39392a770c94596a244a99dc6cc8fdf09f060a`.
- Historical push blockage was resolved before current handoff; current remote c40c6db and subsequent Commit A have been verified. Old blockage is not the current state.

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
- Five main Tabs no longer start legacy auth. Mine now uses V1; the other four remain fixture. Non-migrated secondary legacy pages are not repaired or wired in this task.
- Phase 2.5 homepage is fixture UI only; must not be described as real multi-user completion until Phase 3 backend is live.

## Test status

Baseline evidence remains:

- `npm ci`: pass (99 packages installed at Phase 1 baseline).
- JavaScript syntax baseline: 34 project files checked, 0 failures at Phase 1.
- Legacy `test-api.js` is not accepted as trustworthy.
- Isolated JsonDatabase probe confirmed broken pagination/search/count/JOIN/COALESCE/update-expression behavior.

Phase 2 consisted only of specification documents; no business code or production deployment was modified. Normative cross-check was performed across Product ↔ Data Model ↔ API ↔ Acceptance Tests plus KRP/Recommendation/Roadmap.

Phase 2.5 added homepage fixture UI only. WeChat DevTools real compile: 0 error. No backend, database, or auth code was touched.

V1 local checkpoint (2026-09-05): unit 38/38 PASS, PostgreSQL integration 19/19 PASS, real wx.login LOGIN_ACCEPTED, real family created and verified.

## Deployment status

- No deployment changed.
- `main` not modified or merged.
- Existing Render API remains legacy/non-V4.
- Local V1 runs on localhost:3101 only (DevTools loopback). Public HTTPS deployment NOT DONE.

## Next first action

1. **Mine visual acceptance** — open `pages/mine/mine` in DevTools and screenshot real V1 data (no fixture). Currently PENDING.
2. **Public HTTPS V1 deployment** — deploy V1 backend to an HTTPS endpoint (localhost loopback is DevTools-only).
3. **小程序切换到 HTTPS V1** — update `miniprogram/config/v1.js` baseUrl to the HTTPS endpoint.
4. **第二个真实微信用户/糖糖加入** — invite and join with a second real WeChat account.
5. **双用户 members=2 验收** — verify both users ACTIVE, roles correct, family shared.
6. Only after the above: begin Recipe / Weekly Plan / Fridge / Shopping real-backend cutover.
