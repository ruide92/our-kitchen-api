---
name: our-kitchen-project-director
description: >
  MUST use for any planning, implementation, debugging, refactoring,
  testing, UI change, API work, database or migration work, deployment,
  release, code review, completion audit, or continuation task in
  ruide92/our-kitchen-api on codex/kitchen-v4 — including requests like
  "修一下", "继续12A", "检查仓库", "看看回执", "部署", "出二维码",
  "继续", or "都好了吗". Enforces repository-truth discovery,
  Blast Radius, Product Surface and User Journey analysis,
  evidence-first execution, governance/release gates, scope control,
  checkpoint discipline, and no user-as-QA behavior.
---

# Our Kitchen Project Director

Permanent project director skill for `ruide92/our-kitchen-api` on `codex/kitchen-v4`.

## 0. Mandatory preflight

Before any project work:

```bash
node skills/our-kitchen-project-director/scripts/preflight.js
```

Always read:

- `docs/REVIEW_GATE.md`
- machine-readable surface registry: `governance/product-surfaces.json`
- `docs/PRODUCT_SURFACE_MATRIX.md` (DERIVED view only, not authoritative)
- `docs/USER_JOURNEY_ACCEPTANCE.md`

Then load only the authoritative references needed by the Blast Radius:

- product semantics → `docs/PRODUCT_SPEC_V4.md`
- API/DTO → `docs/API_CONTRACT_V4.md`
- DB/schema → `docs/DATA_MODEL_V4.md`
- recommendation → `docs/RECOMMENDATION_ENGINE.md`
- KRP import → `docs/KRP_V2_SPEC.md`
- historical state → `docs/PROJECT_STATE.md`

This is progressive disclosure: do not reread every long document when the task does not touch it.

## 1. Repository truth before task truth

Separate evidence:

- **FACT** — directly verified from repository, test output, public API, DB, or current user evidence.
- **REPORTED** — another agent claims it, but you did not verify.
- **INFERENCE** — plausible explanation not yet proven.

Never convert REPORTED/INFERENCE into FACT.

Do not trust a completion report as the audit scope. Verify actual HEAD/diff and inspect the whole Blast Radius.

## 2. Reproduce before repair

Before fixing a bug, establish failure evidence:

- failing test
- static audit
- HTTP/DB mismatch
- deterministic code path
- current valid user screenshot / phone evidence

If valid evidence already exists, do not ask the user to rescan or retest just to "re-prove".

## 3. Four task profiles

| Profile | Use for | Strictness |
|---|---|---|
| AUDIT | review, inspection, completion audit, checking another agent's report | read-only, no code changes |
| IMPLEMENT | features, bugs, UI, refactoring | vertical slice, full Blast Radius |
| SCHEMA | migration, frozen model, DB contract changes | Spec Amendment required, BLOCKED check |
| RELEASE | deploy, public verification, preview QR, final acceptance | release gate must be green |

Tasks may escalate to a stricter profile. Never silently downgrade.

## 4. Permanent execution state machine

Every project task must follow:

```
DISCOVER → CLASSIFY → BLAST RADIUS → PLAN → IMPLEMENT → VERIFY LOCAL
→ VERIFY ADJACENT → UPDATE SURFACE/JOURNEY → GOVERNANCE → CHECKPOINT
→ RELEASE (only if needed) → USER TEST (only after release green)
```

Never jump directly from "saw problem" to "changed file" to "reported done".

## 5. Blast Radius (mandatory before any code change)

Output before editing:

```
BLAST RADIUS
Profile:
User outcome:
Reported symptom / requested change:
Surface IDs:
User Journey IDs:
Frontend:
API / DTO:
Backend:
DB / migration:
Shared UI/session/format contracts:
Adjacent regressions:
FACT:
REPORTED:
INFERENCE:
Known blockers:
Planned verification:
```

Small tasks may be brief, but must not omit it. If new scope appears during work, stop, update Blast Radius, then decide. No while-I-am-here changes.

## 6. Product Surface permanent rules

Machine authority: `governance/product-surfaces.json`.

Valid current status: `REAL`, `PARTIAL`, `BROKEN`, `PLANNED_DISABLED`, `HIDDEN`, `KNOWN_BROKEN`.

Core invariants:

- `UNCLASSIFIED = 0`
- `MISSING_SURFACE = 0`
- `MISSING_HANDLER = 0`
- `DUPLICATE_MAPPING = 0`
- `REAL_VIOLATION = 0`

Any new user-visible entry must be registered.

- **REAL**: must truly exist and work. Backend skeleton, fixture, placeholderToast, fake handler are NOT REAL.
- **PARTIAL**: entry exists but full user outcome not closed.
- **BROKEN**: known unimplemented/broken.
- **PLANNED_DISABLED**: must be truly non-executable. Clickable "规划中" toast is NOT PLANNED_DISABLED.
- **HIDDEN**: user cannot access.

## 7. Overlay / Dock permanent rules

Main Tabs: 首页, 菜单, 冰箱, 购物清单, 我的.

All main-tab overlays verified independently by `data-surface-id`. No page-wide whitelist. One overlay compliant cannot auto-justify another on the same page.

- TAB REAL overlay: mask = `tab-safe-sheet-mask`, panel = `tab-safe-sheet-panel`
- Secondary REAL/PARTIAL overlay: `sheet-mask-no-tabbar` / `sheet-panel-no-tabbar`

No per-page magic bottom offset. Shared UI problems must fix the shared contract.

## 8. User Journey is the unit of completion

Do not say "a button is fixed". Trace the upstream/downstream journey.

Examples:

- **Kitchen Settings**: UI control → client → PATCH → DB → reload → Meal defaults → recommendation defaults
- **Pantry**: add → custom/canonical → persistence → reload → delete → shopping deduction → Mine entry → overlay
- **Recipe**: detail → Meal → shopping → purchase → fridge → cooking → inventory deduction → history → rating/favorite → future recommendation

## 9. Frozen product semantics

- 菜品大全 = all recipes
- Weekly Plan = planning tool
- Meal = one actual eating menu
- Shopping derives only from current Meal
- Weekly Plan is NOT automatically a Shopping source
- Weekly → Meal requires explicit import/selection
- Manual Add only modifies Meal
- Main Tabs fixed: 首页, 菜单, 冰箱, 购物清单, 我的
- Meal / Recipe Detail = secondary pages
- Owner core closed first, then second-user acceptance

## 10. Known high-risk regressions

Never reintroduce:

- custom-tab-bar `attached`/`pageLifetimes` auto route sync (caused Home/Menu blank)
- Tab sync continues via each page's `onShow`

## 11. API / Auth evidence

Production public auth evidence cannot use forged JWT in place of real wx.login/token flow. Synthetic tokens are only for isolated internal tests and must be labeled as such. Never report "real WeChat login public E2E passed" from synthetic auth.

## 12. Schema permanent rules

Any schema change: compare with `docs/DATA_MODEL_V4.md`. True frozen model change requires Spec Amendment. DRAFT/BLOCKED cannot deploy.

Current: `backend/v1/sql/008_full_closeout.sql` is **BLOCKED**. Do not apply to Neon without approved `SPEC_AMENDMENT_12A`. Especially `recipe_snapshot` design is unapproved. Historical Meal must not drift from future Recipe edits.

## 13. User operation principle

AI completes: CLI, browser, code, tests, deploy config, repo operations. Only call the user when truly irreplaceable: UAC allow, WeChat scan, admin confirmation. Never offload complex install/config/debug to the user.

## 14. Secrets

Never commit secrets, print full secrets, or expose tokens/passwords/keys in reports. Reports only say: configured / missing / invalid.

## 15. Checkpoint

```bash
node skills/our-kitchen-project-director/scripts/checkpoint.js
```

Runs `git diff --check` + `npm run test:governance-gate`. Only true Governance PASS allows checkpoint completion. Then review diff, commit, push. Long tasks require staged checkpoints.

## 16. Release

```bash
node skills/our-kitchen-project-director/scripts/release-check.js
```

Internally runs `npm run test:release-gate`. Non-zero → RELEASE BLOCKED, no QR, no preview acceptance, no asking user to scan for remaining bugs.

After green, still verify: exact remote HEAD, deployment, migration state, public E2E, real auth evidence, preview artifact before final QR.

## 17. Governance gates (do not duplicate)

This skill does NOT create a parallel governance system. It calls the project's existing:

- `npm run test:governance-gate`
- `npm run test:release-gate`

Including: product surface audit, matrix sync, overlay contract, schema contract, mutation tests, release readiness, user journey.

The skill is the "construction director". Existing gates are "hard enforcement". Both must be used together.

## 18. Skill selfcheck

```bash
node skills/our-kitchen-project-director/scripts/skill-selfcheck.js
```

Verifies SKILL.md, references, scripts, evals, frontmatter, eval schema. Selfcheck failure → do not report installation complete.
