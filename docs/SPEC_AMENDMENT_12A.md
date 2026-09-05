# Spec Amendment 12A — Full Product Closeout Schema Additions

状态: DRAFT — 待 Reviewer 批准后才能应用 Neon
基线: DATA_MODEL_V4.md + API_CONTRACT_V4.md
Commit: b9df70c

## 背景

TASK-KITCHEN-FULL-USER-JOURNEY-CLOSEOUT-12 要求把所有用户可见入口从 fixture 切换为真实功能。现有 DATA_MODEL_V4 覆盖了核心业务表（recipes/meals/fridge/shopping），但缺少以下完整用户旅程所需的表和字段。

本 Amendment 记录 008_full_closeout.sql 中的所有 schema 变更，供 Reviewer 审查。批准前不得应用到 Neon 生产数据库。

## 变更清单

### 1. pantry_staples.display_name_override

**问题**: 当前 pantry_staples 强制 ingredient_id NOT NULL（实际 schema 中是 nullable，但 UNIQUE(family_id, ingredient_id) 约束导致多个 null 冲突）。用户输入"花椒"等未收录食材时无法保存。

**变更**:
- 新增 `display_name_override TEXT`
- 删除旧 UNIQUE(family_id, ingredient_id) 约束
- 新增部分唯一索引 `idx_pantry_canonical_unique`（仅 ingredient_id NOT NULL 时唯一）
- 新增部分唯一索引 `idx_pantry_custom_unique`（ingredient_id IS NULL 时按 display_name 唯一）

**对 Shopping deduction 的影响**:
- canonical pantry（ingredient_id NOT NULL）继续参与自动库存抵扣
- custom pantry（ingredient_id IS NULL）不参与自动数量抵扣（无法安全匹配 recipe ingredient）
- custom pantry 正常保存和展示，后续可标准化为 canonical

**向后兼容**: 完全 additive，现有 canonical pantry 数据不受影响。

**风险**: 低。仅新增列和索引，不修改现有列。

### 2. cooking_sessions 表

**问题**: DATA_MODEL_V4 定义了 Meal 状态机（PLANNING → CONFIRMED → COOKING → COMPLETED），但没有 cooking_sessions 表来追踪做饭过程。

**变更**: 新建 cooking_sessions 表
- id, family_id, meal_id, status(ACTIVE/COMPLETED/CANCELLED)
- started_by_user_id, completed_by_user_id
- started_at, completed_at

**用途**: 开始做饭时创建 ACTIVE session，完成时写 COMPLETED + 库存扣减。

**向后兼容**: 新表，无影响。

### 3. kiss_ledger 表

**问题**: DATA_MODEL_V4 定义了 Kiss 是 append-only family ledger，但没有表。

**变更**: 新建 kiss_ledger 表
- id, family_id, from_user_id, to_user_id
- meal_id, recipe_id（可空，关联上下文）
- suggested_amount, actual_amount, rating_id, reason
- created_at

**用途**: 么么哒账本，按成员统计。不是货币，不是评分。

**向后兼容**: 新表，无影响。

### 4. recipe_imports 表

**问题**: KRP_V2_SPEC 定义了 AI 导入菜谱的 parse → validate → preview → confirm 流程，但没有持久化表。

**变更**: 新建 recipe_imports 表
- id, family_id, created_by_user_id
- schema_version, raw_payload(JSONB), normalized_payload(JSONB)
- status(PARSED/NEEDS_REVIEW/VALIDATED/IMPORTED/REJECTED)
- inferred_fields(JSONB), uncertain_fields(JSONB)
- imported_recipe_id
- created_at, updated_at

**用途**: 存储导入过程，用户确认后才创建 FAMILY recipe。

**向后兼容**: 新表，无影响。

### 5. wishes 表

**问题**: 003 migration 有 recipe_favorites 和 recipe_ratings，但没有 wishes（我想吃）。

**变更**: 新建 wishes 表
- id, family_id, user_id, recipe_id
- status(ACTIVE/FULFILLED/CANCELLED)
- created_at, resolved_at

**向后兼容**: 新表，无影响。

### 6. meals.recipe_snapshot

**问题**: DATA_MODEL_V4 要求 Meal CONFIRMED 时冻结菜谱版本，以后家庭菜谱修改不能改变历史餐。当前 confirmMeal 只改 status。

**变更**: 新增 `meals.recipe_snapshot JSONB`
- confirm 时写入当时的 recipe_id/name/servings/source 快照
- 历史餐查询使用 snapshot，不依赖 recipes 表当前状态

**向后兼容**: 新增列，现有 meal 数据 snapshot 为 NULL（历史数据无快照，查询时 fallback 到实时 recipe）。

**风险**: 低。JSONB 列，不影响现有查询。

## 未在本 Amendment 中的变更

以下功能在 12 任务中需要但 schema 已存在于 001-007：
- recipe_favorites（003）
- recipe_ratings（003）
- weekly_plans / weekly_plan_items（004）
- inventory_movements（005）
- shopping_list_items.sources（007）

## Reviewer 决策点

1. pantry custom 的 ingredient_id nullable + display_name_override 方案是否可接受？
   - 替代方案: 新建 family_custom_ingredients 表，pantry 通过多态关联
   - 当前方案更简单，但 custom pantry 不参与自动抵扣

2. cooking_sessions 是否需要更详细的字段（如当前步骤、暂停状态）？
   - 当前最小实现只追踪 start/complete
   - 高级 Cooking UI 后续可扩展

3. meals.recipe_snapshot 的 JSON 结构是否需要规范化？
   - 当前是自由 JSONB，包含 recipe_id/name/servings/source
   - 后续可考虑 recipe_versions 表

## 批准状态

- [ ] Reviewer 批准 pantry custom schema
- [ ] Reviewer 批准 cooking_sessions
- [ ] Reviewer 批准 kiss_ledger
- [ ] Reviewer 批准 recipe_imports
- [ ] Reviewer 批准 wishes
- [ ] Reviewer 批准 meals.recipe_snapshot
- [ ] 全部批准后允许应用 Neon 008 migration
