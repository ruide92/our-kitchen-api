# Failure Patterns

## Pattern 1: Report PASS but code not done

**Symptom**: Agent reports "测试全过" but actual HEAD doesn't contain the claimed changes, or tests only cover helpers not real surfaces.

**Detection**: AUDIT profile. Verify actual HEAD, run tests yourself, inspect Blast Radius.

**Example**: "Frontend Payload Tests 8/8 PASS" but all 8 are unit-display helper tests, not real page payload tests.

## Pattern 2: Fixture in REAL MODE

**Symptom**: Page imports fixture, falls back to fixture on API failure, shows fake data.

**Detection**: Grep for `fixture`, `homepage-fixture`, `_buildFromFixture` in REAL MODE pages.

**Rule**: REAL MODE = no fixture. Empty state is legitimate; fake data is not.

## Pattern 3: Placeholder that looks clickable

**Symptom**: Menu item or button has bindtap but handler only showsToast("待接入") or "规划中".

**Detection**: product-surface-audit PLANNED_CLICKABLE check. placeholderToast on REAL = REAL_VIOLATION.

**Rule**: PLANNED features must be disabled or hidden. Clickable placeholder = BROKEN.

## Pattern 4: Page-wide overlay whitelist

**Symptom**: Overlay audit uses `.map(s => s.page)` so one registered overlay covers all overlays on that page.

**Detection**: New unregistered sheet on same page passes audit.

**Rule**: Each overlay must have unique data-surface-id and be independently verified.

## Pattern 5: wxml.includes() contract pollution

**Symptom**: usesGlobal = exact class || wxml.includes('tab-safe-sheet'), so one overlay's class makes all overlays on page "compliant".

**Detection**: Mutation L (same page A compliant, B not).

**Rule**: Each overlay verified by its own element's classes.

## Pattern 6: Error swallowed as empty

**Symptom**: API catch(() => null) turns network errors / 500 into "empty state".

**Detection**: Grep for `.catch(() => null)`, `.catch(() => [])`.

**Rule**: Distinguish loading / error / empty / data. Real null = empty. Exception = error.

## Pattern 7: Backend skeleton = REAL

**Symptom**: Service file exists but no endpoint, no integration test, no frontend consumer, yet registry says REAL.

**Detection**: Check for route registration, test coverage, frontend usage.

**Rule**: Skeleton = PARTIAL or BROKEN, never REAL.

## Pattern 8: SQL placeholder eaten by PowerShell

**Symptom**: `WHERE id=$1` becomes `WHERE id=` because PowerShell string interpolation eats `$1`.

**Detection**: Grep for `WHERE ... =` with no parameter, `meal_id= ORDER BY`.

**Rule**: Use parameterized SQL, test with malformed SQL audit.

## Pattern 9: DATE drift

**Symptom**: meal_date returns "2026-09-21T16:00:00.000Z" instead of "2026-09-22" due to timezone.

**Detection**: API contract test asserting strict YYYY-MM-DD.

**Rule**: DATE columns serialize as YYYY-MM-DD. TIMESTAMPTZ stays ISO.

## Pattern 10: User as QA

**Symptom**: Known BROKEN features, then "让用户扫码看看哪里有问题".

**Detection**: Release gate red + QR generated.

**Rule**: All BROKEN_REQUIRED_NOW = 0 before user scan. User does one representative acceptance, not bug hunting.

## Pattern 11: Dual authority

**Symptom**: JSON declared authoritative but scripts still read Markdown. Two sources drift.

**Detection**: Grep scripts for PRODUCT_SURFACE_MATRIX.md reads.

**Rule**: Single source = governance/product-surfaces.json. Markdown = generated view.

## Pattern 12: Missing handler on REAL surface

**Symptom**: WXML bindtap="foo" but JS has no foo(). DevTools compile passes but runtime ReferenceError.

**Detection**: product-surface-audit MISSING_HANDLER check (page.js + *-controller.js + utils).

**Rule**: REAL/PARTIAL wxml-handler must exist in JS. Mutation H proves detection.

## Pattern 13: Encoding corruption

**Symptom**: Chinese files become mojibake, CSS comments unterminated (`/* ... ?/`).

**Detection**: wxss-sanity-audit (/* */ pairing), file encoding check.

**Rule**: Always use Node fs.writeFileSync(..., 'utf8'). Never PowerShell Set-Content.

## Pattern 14: Untracked files reported as clean

**Symptom**: "git status clean" but evidence/ or temp scripts untracked.

**Detection**: git status --short, separate tracked clean vs untracked count.

**Rule**: Report tracked clean: yes/no, untracked count: N.
