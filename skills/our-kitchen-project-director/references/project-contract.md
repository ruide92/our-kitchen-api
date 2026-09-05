# Project Contract

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
- Synthetic JWT only for isolated tests, must be labeled
- Production user: 张锐, family: 我们的小厨房 (OWNER)

### Infrastructure

- Backend: Node.js, Express, PostgreSQL
- Neon DB: ep-dry-paper-ael6cis1-pooler, migrations 001-007 applied, 008 BLOCKED
- Render: our-kitchen-v1, srv-dadmub0u01pc73bgup20
- Mini Program: AppID wxbd67ce4437e3ea3b
- DevTools CLI: D:\微信web开发者工具\cli.bat
- Public API: https://our-kitchen-v1.onrender.com

### Governance

- Surface registry: governance/product-surfaces.json (single machine authority)
- Matrix: docs/PRODUCT_SURFACE_MATRIX.md (DERIVED view)
- Journeys: docs/USER_JOURNEY_ACCEPTANCE.md
- Review rules: docs/REVIEW_GATE.md
- Gates: npm run test:governance-gate, npm run test:release-gate

### Current state

- CODE GATE: PASS
- PUBLIC CORE E2E: PASS
- VISUAL GATE: FAIL (11A/11B fixes pending owner retest)
- 008 migration: BLOCKED (recipe_snapshot unapproved)
- 12A business: backend skeleton done, frontend not started
- 12B-12F: not started

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
