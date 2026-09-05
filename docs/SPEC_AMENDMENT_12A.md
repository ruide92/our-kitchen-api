# Spec Amendment 12A — Full Product Closeout Schema Additions

Status: DRAFT
Blocked: YES (recipe_snapshot design incomplete)
基线: DATA_MODEL_V4.md + API_CONTRACT_V4.md
Commit: b9df70c → 8c30814

## 背景

TASK-KITCHEN-FULL-USER-JOURNEY-CLOSEOUT-12 要求把所有用户可见入口从 fixture 切换为真实功能。008_full_closeout.sql 包含以下变更。

本 Amendment 区分：
- **已在 DATA_MODEL_V4 定义的表**：实现冻结规范，不需要 Amendment 批准
- **真正需要 Amendment 的 additive 变更**：需要 Reviewer 批准

## 已在 DATA_MODEL_V4 定义的表（实现冻结规范）

以下表在 DATA_MODEL_V4.md 中已有定义，008 只是实现它们，不属于规范变更：

1. **cooking_sessions** — DATA_MODEL_V4 第 X 节定义
2. **kiss_ledger** — DATA_MODEL_V4 第 X 节定义（append-only family ledger）
3. **recipe_imports** — DATA_MODEL_V4 / KRP_V2_SPEC 定义
4. **wishes** — DATA_MODEL_V4 定义（我想吃）

这些表的 schema 应与 DATA_MODEL_V4 严格一致。如有偏差，以 DATA_MODEL_V4 为准并修正 008。

## 真正需要 Amendment 的变更

### 1. pantry_staples.display_name_override

**问题**: 用户输入"花椒"等未收录 canonical ingredient 时无法保存常备食材。

**当前 008 实现**:
- 新增 `display_name_override TEXT`
- 删除旧 UNIQUE(family_id, ingredient_id) 约束
- 新增部分唯一索引 `idx_pantry_canonical_unique`（仅 ingredient_id NOT NULL 时唯一）
- 新增部分唯一索引 `idx_pantry_custom_unique`（ingredient_id IS NULL 时按 display_name 唯一）

**PostgreSQL NULL 说明（修正）**:
- 普通 `UNIQUE(family_id, ingredient_id)` 约束**允许多个 NULL**（PostgreSQL 标准行为）
- 但多个 NULL 行无法通过 ingredient_id 区分，需要 display_name_override + 部分唯一索引来保证自定义项不重复
- 之前文档中"多个 NULL 冲突"的说法不准确，实际问题是"多个 NULL 无法区分同名自定义项"

**对 Shopping deduction 的影响**:
- canonical pantry（ingredient_id NOT NULL）继续参与自动库存抵扣
- custom pantry（ingredient_id IS NULL）不参与自动数量抵扣（无法安全匹配 recipe ingredient）
- custom pantry 正常保存和展示，后续可标准化为 canonical

**向后兼容**: 完全 additive，现有 canonical pantry 数据不受影响。

**风险**: 低。仅新增列和索引，不修改现有列。

### 2. meals.recipe_snapshot — BLOCKED

**问题**: DATA_MODEL_V4 要求 Meal CONFIRMED 时冻结菜谱版本，以后家庭菜谱修改不能改变历史餐。

**当前 008 实现**:
- 新增 `meals.recipe_snapshot JSONB`
- confirmMeal 时写入：recipe_id, recipe_name, servings, source

**BLOCKED 原因**: 当前 snapshot 结构不足：
- 只冻结了 recipe identity/name/servings/source
- **没有冻结 ingredients**（确认后菜谱改食材，历史餐的购物/库存计算会漂移）
- **没有冻结 steps**（startCooking 仍读取当前 recipe_steps，不是 snapshot）
- **没有冻结 cookware / display data**
- startCooking 仍从 recipes 表实时读取，snapshot 形同虚设

**需要的设计决策**（二选一）：

**方案 A: 完整 JSON snapshot**
- confirm 时把 recipe 的所有字段（ingredients/steps/cookware/tags/nutrition）序列化为 JSONB
- startCooking / history 查询全部从 snapshot 读取，不再 JOIN recipes 表
- 优点：简单，历史完全不漂移
- 缺点：JSONB 数据冗余，无法利用 SQL JOIN

**方案 B: recipe_versions 表**
- 新建 recipe_versions 表，每次菜谱修改创建新版本
- meal 确认时引用 recipe_version_id
- 优点：规范化，可审计
- 缺点：需要额外 migration 和版本管理逻辑

**在 Reviewer 批准前**:
- 008 = BLOCKED
- 不得应用到 Neon
- confirmMeal 的 snapshot 写入逻辑不得标记为 REAL

## 未在本 Amendment 中的变更

以下功能在 12 任务中需要但 schema 已存在于 001-007：
- recipe_favorites（003）
- recipe_ratings（003）
- weekly_plans / weekly_plan_items（004）
- inventory_movements（005）
- shopping_list_items.sources（007）

## Reviewer 决策点

1. [ ] pantry_staples.display_name_override + 部分唯一索引方案可接受？
2. [ ] recipe_snapshot 选方案 A（完整 JSON）还是方案 B（recipe_versions 表）？
3. [ ] cooking_sessions/kiss_ledger/recipe_imports/wishes 的 schema 与 DATA_MODEL_V4 一致？
4. [ ] 全部批准后，008 状态从 BLOCKED → APPROVED，允许应用 Neon

## 批准状态

- [ ] pantry custom schema
- [ ] recipe snapshot 设计（方案 A 或 B）
- [ ] 冻结规范表 schema 一致性
- [ ] 全部批准 → Status: APPROVED → 允许应用 Neon 008
