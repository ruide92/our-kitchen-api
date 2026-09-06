# Report Contract

## Completion report requirements

Every task completion report must include:

1. **What was actually done** — file names, not "已完成"
2. **Verification evidence** — test output, audit output, HTTP status, not "应该没问题"
3. **FACT / REPORTED / INFERENCE separation**
4. **Current commit** — full hash
5. **Remote HEAD** — full hash after push
6. **Git status** — tracked clean yes/no, untracked count N
7. **Remaining items** — what is NOT done, explicitly
8. **Next** — only if all gates pass; otherwise list blockers

## Claim → Evidence (mandatory for key completion claims)

For every key completion claim, map:

```
CLAIM:  <what is being claimed complete>
EVIDENCE: <file/test/audit/HTTP/DB observation that proves it>
GRADE:  FACT | REPORTED | UNVERIFIED
```

- **FACT** — directly verified by this executor from code, test output, HTTP, DB, or current user evidence.
- **REPORTED** — another agent/report claimed it; this executor did not independently verify.
- **UNVERIFIED** — plausible but no evidence produced this run.

INFERENCE may be used for analysis/diagnosis but is never a completion GRADE.

### Executor vs independent reviewer evidence

- Evidence gathered by the executing agent in its own authenticated session = FACT for that executor.
- An independent reviewer who cannot access that session must treat the executor's claim as REPORTED until independently verified.
- Reports must make this distinction explicit when the claim depends on an authenticated session (Render dashboard, Neon console, WeChat DevTools).

## Evidence must not overreach (hard examples)

| Weak evidence | May claim | May NOT claim |
|---|---|---|
| `cli open --project` succeeds | DEVTOOLS_OPEN = PASS | COMPILE = PASS |
| Synthetic JWT + production backend | routing/business path under SYNTHETIC AUTH | REAL WX AUTH PASS |
| Deploy succeeded | deployment status = success | public business endpoint works |
| Governance Gate PASS | governance invariants hold | Release Gate PASS |
| Schema design approved | DESIGN APPROVED | migration ready / production applied |
| Unit stub with mock API | controller/client orchestration | DB persistence / public E2E |
| Test self-generates toast then asserts it | test harness behavior | real page error handling |

## Section-aware verification

Verification scope must equal claim scope.

- Claim "DATA_MODEL Section 18 contains recipe_snapshot" → must parse Section 18, not `wholeFile.includes('recipe_snapshot')` (word may appear in Section 19).
- Claim "mine.wxml has no canEditKitchenSettings()" → full-file scan is valid because claim scope is the whole file.
- Claim "schema field X exists on table Y" → must check table/column contract, not document keyword presence.

## Weak test ≠ strong claim

Tests must be labeled by what they actually prove:

- Stub/mock API call → controller orchestration only.
- Parser test on constructed strings → PARSER-LEVEL, not real artifact mutation.
- Self-generated error + self-asserted toast → harness behavior, not production path.

To claim production path behavior, the test must invoke the real controller/page/helper production code path.

## Prohibited report phrases

- "已完成" without evidence
- "测试全过" without test names/counts
- "git status clean" when untracked files exist
- "PASS" for visual without real screenshot evidence
- "REAL" for backend skeleton
- "用户可以扫码" when release gate red
- "008 没问题" without Amendment approval check
- "COMPILE PASS" from cli open alone
- "REAL AUTH" from synthetic JWT

## Required sections by profile

### AUDIT
- HEAD verified
- Files inspected
- Findings (each with FACT/REPORTED/INFERENCE)
- Governance gate result
- Recommendation

### IMPLEMENT
- Blast Radius
- Files changed
- Tests run + results
- Surface/Journey updates
- Governance gate
- Commit + remote HEAD
- Remaining

### SCHEMA
- Current migration state (from actual schema_migrations)
- DATA_MODEL comparison (section-aware)
- Amendment status (actual file)
- Migration replay result
- Backward compatibility
- BLOCKED items

### RELEASE
- Release gate result (green/red)
- Exact remote HEAD
- Deploy verification
- Migration state
- Public E2E results (real auth label)
- Preview artifact
- QR allowed? yes/no

## Visual evidence rules

- VISUAL GATE = PASS only with real user phone confirmation or DevTools screenshot
- DevTools compile = CODE/COMPILE only, not visual
- No screenshot = VISUAL GATE = PENDING (or FAIL if user already reported failure)
- Never write PASS from "代码结构已就位"

## Test reporting rules

- Report exact test counts: Unit X/X, Frontend X/X, Core Integration X/X, Legacy Integration X/X
- Report which test script ran, not "all tests"
- If a test was skipped, say why
- Mutation tests: report A-M pass/fail individually if any fail

## Git reporting rules

- Full commit hash (7+ chars minimum, full preferred)
- tracked clean: yes/no
- untracked count: N (list if < 5)
- local/remote divergence: local-only N, remote-only N
- Never "clean except untracked"
