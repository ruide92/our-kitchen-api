# Kitchen V4 Execution Design

## Authority and precedence

1. The user-approved V4 product specification defines business behavior, data flow, family boundaries, and acceptance rules.
2. The two supplied UI images define visual hierarchy, page structure, density, and visual language.
3. Existing code and old handoff documentation are implementation evidence and reusable assets, not product truth.
4. Any necessary visual deviation must be documented in `docs/UI_DEVIATIONS.md` before implementation.

## Approved delivery order

Phase 0 protects the existing Git and runtime-data state. Phase 1 establishes facts from the actual repository. Phase 2 freezes the product, data model, API contract, KRP protocol, recommendation rules, acceptance tests, and roadmap. Phase 2.5 then implements the homepage against contract-shaped fixtures and validates the real rendering in WeChat DevTools. Phase 3 replaces fixtures with secure, persistent family-scoped services and performs the second homepage acceptance pass for shared data.

## Homepage acceptance model

### First pass: UI and interaction

- Use contract-shaped fixture data kept explicitly separate from production API code.
- Match the supplied mobile reference: family header, four compact shortcuts, week selector, today's breakfast/lunch/dinner, per-meal add action, selected-meal section with selector identity, and five tabs.
- Compile and run in WeChat DevTools, capture an actual runtime screenshot, compare it with the reference, and correct material deviations.
- Do not claim backend or multi-user completion from fixture behavior.

### Second pass: business and shared data

- Replace fixtures with the frozen V4 API.
- Verify same-family shared weekly plan and meal selections, selector attribution, persistence across reloads, and complete cross-family isolation.

## Architectural boundary

The current JSON SQL emulator will not be extended. V4 uses PostgreSQL through `DATABASE_URL`, migrations, explicit repositories/services, server-side family membership enforcement, real WeChat `code2Session`, rotated secrets, and contract tests. Public base recipes and family recipe variants remain distinct, and all household state is scoped to a verified family membership.

## Verification policy

Every phase must have objective checks, an updated `PROJECT_STATE.md`, a small commit, and a pushed branch. A page is not complete merely because WXML/WXSS exists; UI completion requires DevTools runtime evidence, and business completion requires automated API/database/integration acceptance tests.
