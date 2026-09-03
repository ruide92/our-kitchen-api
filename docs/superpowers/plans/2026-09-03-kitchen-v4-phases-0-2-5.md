# Kitchen V4 Phases 0-2.5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect the existing project, establish an evidence-backed baseline, freeze V4 contracts, and complete the first real WeChat DevTools homepage UI acceptance pass.

**Architecture:** Work in `codex/kitchen-v4` from an isolated worktree while preserving the dirty runtime database in the original checkout. Freeze family-scoped PostgreSQL and HTTP contracts before UI work; the homepage consumes contract-shaped fixtures only until Phase 3 supplies the real services.

**Tech Stack:** Native WeChat Mini Program, Node.js, Express, PostgreSQL/`pg`, Markdown specifications, Node test runner or an explicitly selected test framework, WeChat DevTools CLI/UI.

---

### Task 1: Protect the current state

**Files:**
- Create: `docs/PROJECT_STATE.md`
- Create: `docs/superpowers/specs/2026-09-03-kitchen-v4-execution-design.md`

- [x] Verify `git status`, branch, remote, local HEAD, remote HEAD, and existing worktrees.
- [x] Back up the dirty runtime database and verify source/backup SHA-256 equality.
- [x] Create isolated branch/worktree `codex/kitchen-v4` without modifying `main`.
- [x] Run `npm ci` and baseline syntax checks.
- [ ] Commit and push the Phase 0 checkpoint.

### Task 2: Audit the actual implementation

**Files:**
- Create: `docs/AUDIT_CURRENT_STATE.md`
- Modify: `docs/PROJECT_STATE.md`

- [ ] Enumerate every page API call and every `utils/api.js` definition/export.
- [ ] Enumerate every Express route with method, path, auth, request, response, permission, and family scope.
- [ ] Compare frontend fields, API fields, database fields, and V4 canonical names.
- [ ] Test the JSON database semantics used by the routes without modifying user runtime data.
- [ ] Audit login, JWT, secrets, CORS, committed runtime data, persistence, images, and deployment configuration.
- [ ] Classify each feature as working, partial, UI-only, documentation-only, missing, bugged, architectural risk, or security risk.
- [ ] Run fresh verification, update `PROJECT_STATE.md`, commit, and push Phase 1.

### Task 3: Freeze V4 specifications

**Files:**
- Create: `docs/PRODUCT_SPEC_V4.md`
- Create: `docs/DATA_MODEL_V4.md`
- Create: `docs/API_CONTRACT_V4.md`
- Create: `docs/KRP_V2_SPEC.md`
- Create: `docs/RECOMMENDATION_ENGINE.md`
- Create: `docs/ACCEPTANCE_TESTS.md`
- Create: `docs/IMPLEMENTATION_ROADMAP.md`
- Create: `docs/UI_DEVIATIONS.md`
- Modify: `docs/PROJECT_STATE.md`

- [ ] Convert the approved V4 brief into concise normative requirements using MUST/SHOULD/MAY language.
- [ ] Define PostgreSQL entities, constraints, indexes, ownership, lifecycle, and migration/seed rules.
- [ ] Define one HTTP contract for each V4 capability, including exact JSON and family authorization behavior.
- [ ] Define KRP v2 schema, inference provenance, validation, preview, edit, and import behavior.
- [ ] Define shared constrained recommendation primitives for weekly plans and random meals.
- [ ] Convert the 25 named acceptance scenarios into executable test cases and trace them to contracts.
- [ ] Self-review for placeholders, contradictions, field-name drift, and missing acceptance coverage.
- [ ] Update `PROJECT_STATE.md`, commit, and push Phase 2.

### Task 4: Implement the contract-shaped homepage fixture

**Files:**
- Create: `miniprogram/fixtures/home-v4.js`
- Create: `miniprogram/services/home-data.js`
- Modify: `miniprogram/pages/index/index.js`
- Modify: `miniprogram/pages/index/index.wxml`
- Modify: `miniprogram/pages/index/index.wxss`
- Modify: `miniprogram/app.wxss`
- Modify: `docs/UI_DEVIATIONS.md`
- Modify: `docs/PROJECT_STATE.md`

- [ ] Add a fixture whose shape exactly matches the frozen homepage response contract and label it development-only.
- [ ] Add a data adapter that selects fixtures only under an explicit development flag and cannot silently fall back in production.
- [ ] Implement automatic selection of the current weekday and compact breakfast/lunch/dinner groups.
- [ ] Implement family header, four shortcuts, per-meal add actions, selected-meal attribution, continue-add/view-meal actions, and existing five tabs.
- [ ] Match the approved warm, compact iPhone 14/15 reference without adding unrelated modules.
- [ ] Record every unavoidable reference-image deviation before making it.

### Task 5: Perform real homepage UI acceptance

**Files:**
- Create: `docs/evidence/homepage-phase-2-5/README.md`
- Create: `docs/evidence/homepage-phase-2-5/homepage-runtime.png`
- Modify: `docs/PROJECT_STATE.md`

- [ ] Use the installed WeChat DevTools to compile the actual mini program project.
- [ ] Fix every compile error and repeat compilation until it succeeds.
- [ ] Run the homepage in an iPhone 14/15-like viewport and capture the actual runtime screenshot.
- [ ] Compare header, shortcuts, weekly plan, current-day emphasis, meal rows, selected menu, whitespace, typography, colors, and tab bar against the supplied reference.
- [ ] Correct material differences and repeat the screenshot comparison.
- [ ] Document the final evidence and explicitly label data as fixture-backed.
- [ ] Update `PROJECT_STATE.md`, commit, and push Phase 2.5 before Phase 3 begins.
