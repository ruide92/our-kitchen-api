# Task Profiles

## AUDIT

Read-only review. No code changes.

Use when:
- "检查仓库", "看看回执", "都好了吗", "review 一下"
- Verifying another agent's completion report
- Pre-deploy inspection
- Surface/Journey gap analysis

Required:
- Verify actual HEAD, not reported HEAD
- Inspect full Blast Radius, not just files mentioned in report
- Run governance gate
- Classify every finding as FACT / REPORTED / INFERENCE

Output: findings with evidence, not "looks good".

## IMPLEMENT

Feature, bug, UI, refactoring work. Vertical slice.

Use when:
- "修一下", "继续12A", "加功能", "改 UI"
- Any code change to frontend/backend/tests/docs

Required:
- Preflight
- Blast Radius
- Reproduce before repair (for bugs)
- Implement full slice: UI → API → DB → persistence → reload
- Verify local + adjacent
- Update Surface/Journey registry if new entry
- Governance gate PASS
- Checkpoint (commit + push)

## SCHEMA

Migration / frozen model / DB contract changes.

Use when:
- "008迁移", "加字段", "改表", "Neon migration"
- Any change to backend/v1/sql/*.sql
- Any change to DATA_MODEL_V4 semantics

Required:
- Compare with docs/DATA_MODEL_V4.md
- Spec Amendment if frozen model changes
- Check Amendment Status: APPROVED / DRAFT / BLOCKED
- DRAFT/BLOCKED → cannot deploy, cannot apply Neon
- Migration fresh replay test
- Backward compatibility analysis

Current BLOCKED: 008_full_closeout.sql (recipe_snapshot unapproved).

## RELEASE

Deploy, public verification, preview QR, final acceptance.

Use when:
- "部署", "出二维码", "公网验证", "用户验收"
- Render deploy
- DevTools preview
- Public E2E

Required:
- Release gate GREEN (non-zero → BLOCKED, no QR)
- Exact remote HEAD matches intended commit
- Deployment verified (service logs, version)
- Migration state verified
- Public E2E with REAL auth (not synthetic)
- Preview artifact generated
- Only then user scan

Never: ask user to scan to find remaining bugs when release gate is red.

## Escalation

Tasks may escalate to stricter profile. Example: IMPLEMENT that touches migration → SCHEMA. IMPLEMENT that needs deploy → RELEASE.

Never silently downgrade. If a RELEASE task finds code bugs, escalate to IMPLEMENT, fix, then return to RELEASE.
