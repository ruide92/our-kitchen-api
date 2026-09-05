# Review Gate — Permanent Code Review Governance

本文件定义永久代码审查规则。任何 AI 或人工修改功能代码前必须遵守。

## 1. Blast Radius 声明

任何功能修改 commit 前，必须在 commit message 或 PR 描述中包含：

```
BLAST RADIUS:
- Surface IDs affected: [HOME-03, MENU-R-06, ...]
- User Journeys affected: [UJ-02, UJ-11, ...]
- APIs affected: [GET /recipes, POST /meals/:id/items, ...]
- DB tables affected: [recipes, meal_items, ...]
- Shared UI Contracts: [tab-safe-sheet-panel, tab-page-dock, ...]
- Adjacent features requiring regression: [mini-cart, meal page, ...]
```

Reviewer 必须检查 Blast Radius 中列出的所有项，不能只检查施工者声称修改的部分。

## 2. Surface Matrix 同步规则

- 任何新增用户可见入口（bindtap/navigateTo/Sheet/menu item）必须同时更新 `docs/PRODUCT_SURFACE_MATRIX.md`
- `scripts/product-surface-audit.js` 会自动检测未登记入口，UNCLASSIFIED > 0 时 commit 失败
- 删除/隐藏入口也必须更新 Matrix

## 3. Status 诚实规则

### 禁止行为
- 把 BROKEN 改成 PLANNED 来让 Gate PASS
- 把 PARTIAL 标成 REAL 来虚报进度
- 用 fixture 通过测试后标 REAL
- 后端 skeleton 存在就标 REAL（必须有 frontend consumer + integration test + E2E）
- 旧测试通过就声称新功能通过

### REAL 的必要条件
一个 Surface 标为 REAL 必须同时满足：
1. 前端真实调用 V1 API（非 fixture、非本地内存）
2. 后端 service 真实读写 PostgreSQL
3. 至少 1 个 integration test 覆盖
4. API 错误不假装成功
5. 重启小程序后数据不丢失
6. WXML handler 真实存在（非 noop/placeholderToast）

### PARTIAL 的定义
- 后端已实现但前端未接
- 前端已接但缺少关键功能（如只读但要求可编辑）
- 有 integration test 但缺 E2E
- 自定义路径未实现（如 pantry 只有 canonical 没有 custom）

### BROKEN 的定义
- placeholderToast / noop
- 旧 fixture 结构
- 前端调用不存在的 API
- 看起来能点但点完没反应
- 只读但产品要求可编辑

## 4. 测试口径规则

### 禁止
- "旧 42/42 integration 通过" ≠ "新功能通过"
- "unit test 通过" ≠ "业务流程可用"
- "compile 0 error" ≠ "视觉正确"
- catch error 后打印 PASS

### 每个 REAL Surface 必须有
- Acceptance Evidence 字段非空
- 至少一种：integration test / E2E / 真实 API 验证

### 测试分类
- `test:unit` — 纯函数/helper
- `test:integration` — PostgreSQL HTTP 端到端
- `test:frontend` — 页面 payload/behavior mock
- `test:user-journey` — 完整用户流程
- `test:audit` — 静态审计（WXML/WXSS/API/Surface/Overlay/Schema）

## 5. Global UI Contract 规则

以下为共享契约，任何页面不得自行其是：

### Bottom Dock
- 主 Tab 页面：使用 `.tab-page-dock`，bottom = TabBar 顶部 + 16rpx
- 二级页面：使用 `.page-dock-no-tabbar`，bottom = safe area + 16rpx
- 滚动内容必须有 `.tab-page-scroll-spacer` 确保最后一项可见

### Bottom Sheet
- 主 Tab 页面：使用 `.tab-safe-sheet-mask` + `.tab-safe-sheet-panel`
  - mask bottom = TabBar 顶部
  - panel bottom = TabBar 顶部 + 16rpx
  - TabBar 保持可见但 `pointer-events: none`（locked）
- 二级页面：使用 `.sheet-mask-no-tabbar` + `.sheet-panel-no-tabbar`
  - 只需避开 safe area

### 禁止
- 主 Tab 页面自己写 `bottom: 0` 的 sheet
- 每页一套 magic number
- Sheet 打开时 TabBar 可点击

## 6. Schema Contract 规则

- 任何 migration 新增的表/字段必须在 `DATA_MODEL_V4.md` 或 `SPEC_AMENDMENT_*.md` 中有定义
- `scripts/schema-contract-audit.js` 检测未批准的 schema 变更
- 未批准 schema 不得应用到 Neon
- 修改已有 migration（001-007）必须有充分理由并记录

## 7. Git Status 报告规则

禁止汇报"git status clean 但有 untracked"。必须明确：
- tracked clean: yes/no
- untracked count: N
- untracked 文件类别（evidence/临时文件/新代码）

evidence 目录应 commit 或加入 .gitignore，不能长期游离。

## 8. Governance Gate vs Release Gate

### Governance Gate（每次 commit 前）
- UNCLASSIFIED = 0
- UNKNOWN HANDLER = 0
- Matrix 与代码一致
- 新增代码无未登记入口
- 允许已知 BROKEN/PARTIAL
- 通过只证明"我们知道所有问题在哪里"

### Release Gate（给用户二维码前）
- Governance Gate PASS
- 所有 Required Final Status = REAL 的 Surface 当前状态 = REAL
- BROKEN_REQUIRED_NOW = 0
- PARTIAL_REQUIRED_NOW = 0
- PLACEHOLDER_REQUIRED_NOW = 0
- 全部 integration + user-journey tests PASS
- DevTools compile 0 error
- 公网 E2E PASS

## 9. Commit Message 规范

```
<type>: <subject>

BLAST RADIUS:
- Surfaces: [...]
- Journeys: [...]
- APIs: [...]
- DB: [...]
- Contracts: [...]
- Regression: [...]

TESTS:
- unit: X/X
- integration: X/X
- frontend: X/X
- audit: PASS

EVIDENCE:
- <test name or screenshot path>
```

type: feat / fix / chore / docs / test / refactor
