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

## Prohibited report phrases

- "已完成" without evidence
- "测试全过" without test names/counts
- "git status clean" when untracked files exist
- "PASS" for visual without real screenshot evidence
- "REAL" for backend skeleton
- "用户可以扫码" when release gate red
- "008 没问题" without Amendment approval check

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
- Current migration state
- DATA_MODEL comparison
- Amendment status
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
