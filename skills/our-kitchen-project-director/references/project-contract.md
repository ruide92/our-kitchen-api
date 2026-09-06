# Project Contract

> **MUTABLE CURRENT STATE IS NOT AUTHORITATIVE HERE.**
> This file stores only relatively stable project identity and permanent rules.
> Current phase, migration applied state, deploy commit, release gate status,
> visual gate status — all must be rediscovered from: preflight, actual repo,
> actual DB, actual deploy, current gate runs. `docs/PROJECT_STATE.md` is
> historical/context input only and never overrides current actual evidence.

## Repository

- Repo: ruide92/our-kitchen-api
- Branch: codex/kitchen-v4
- Worktree: C:\Users\zhang\.config\superpowers\worktrees\our-kitchen-api\kitchen-v4

## Product

《我们家的大食堂 / 我们的小厨房》V4 WeChat Mini Program.

### Frozen semantics

- 菜品大全 = all recipes (BASE + FAMILY)
- Weekly Plan = planning tool (not actual meals)
- Meal = one actual eating menu
- Shopping derives only from current Meal
- Weekly → Meal requires explicit import
- Manual Add only modifies Meal
- Main Tabs: 首页, 菜单, 冰箱, 购物清单, 我的
- Meal / Recipe Detail = secondary pages

### Auth

- Real wx.login → POST /api/v1/auth/wechat → token
- Synthetic JWT only for isolated tests, must be labeled SYNTHETIC AUTH
- Production owner identity is discovered from actual session/DB, not hardcoded here

### Infrastructure (identity only — current state must be rediscovered)

- Backend: Node.js, Express, PostgreSQL
- Neon DB: ep-dry-paper-ael6cis1-pooler (migration state from schema_migrations, not this file)
- Render: our-kitchen-v1, srv-dadmub0u01pc73bgup20 (deployed commit from Render API/dashboard, not this file)
- Mini Program: AppID wxbd67ce4437e3ea3b
- DevTools CLI: D:\微信web开发者工具\cli.bat
- Public API: https://our-kitchen-v1.onrender.com

### Governance authority

- Surface registry: governance/product-surfaces.json (single machine authority)
- Matrix: docs/PRODUCT_SURFACE_MATRIX.md (DERIVED view, not authoritative)
- Journeys: docs/USER_JOURNEY_ACCEPTANCE.md
- Review rules: docs/REVIEW_GATE.md
- Gates: npm run test:governance-gate, npm run test:release-gate

## Completion state layers (never conflate)

- DESIGN APPROVED — reviewer accepted the design/schema direction
- IMPLEMENTATION VERIFIED — code + tests pass locally
- DEPLOYMENT READY / DEPLOYED — release gate green + actually deployed
- USER ACCEPTED — real user confirmed on device

A task report may only claim the layer it actually verified.

## High-risk regressions (never reintroduce)

1. custom-tab-bar attached/pageLifetimes auto route sync → caused Home/Menu blank
2. PowerShell Set-Content default encoding → corrupts Chinese files (use Node fs.writeFileSync utf8)
3. PowerShell curl alias → use Invoke-WebRequest or node http
4. Fixture imports in REAL MODE pages
5. Dynamic WXML handlers (bindtap="{{var}}")
6. Page-wide overlay whitelist
7. wxml.includes() contract pollution
8. Forged JWT reported as real auth
9. SQL placeholder eaten by PowerShell interpolation ($1 → empty)
10. DATE fields outputting ISO timestamps instead of YYYY-MM-DD
