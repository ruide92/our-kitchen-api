# Spec Amendment 12A — Full Product Closeout Schema Additions

Status: APPROVED
Blocked: NO
基线: DATA_MODEL_V4.md + API_CONTRACT_V4.md
批准: 2026-09-06 — TASK-KITCHEN-12A-MIGRATION-READINESS-SEAL 完成后批准

## Reviewer Decision

1. **recipe_snapshot**: Option A — VERSIONED FULL JSON SNAPSHOT (APPROVED)
2. **pantry custom display_name_override**: APPROVED
3. **008 frozen schema alignment (sections 25-28)**: APPROVED after nullability correction

## Implementation Status

- [x] pantry custom schema (display_name_override + CHECK + partial unique indexes)
- [x] recipe snapshot Option A (meals.recipe_snapshot JSONB, schema_version=1)
- [x] frozen tables schema alignment (cooking_sessions/kiss_ledger/recipe_imports/wishes nullability)
- [x] fresh migration replay (001→008)
- [x] historical consumption paths verified (cooking/shopping/history read from snapshot)
- [x] history fail-closed (MEAL_SNAPSHOT_MISSING / MEAL_SNAPSHOT_UNSUPPORTED)

## 已在 DATA_MODEL_V4 定义的表（实现冻结规范）

以下表在 DATA_MODEL_V4.md 中已有定义，008 只是实现它们：

1. **cooking_sessions** — Section 25
2. **kiss_ledger** — Section 27 (append-only family ledger)
3. **recipe_imports** — Section 28 / KRP_V2_SPEC
4. **wishes** — Section 26

### Nullability alignment (corrected in this task)

| field | normative | SQL (corrected) |
|---|---|---|
| cooking_sessions.started_by_user_id | required (NOT NULL) | NOT NULL |
| cooking_sessions.completed_by_user_id | nullable | nullable |
| kiss_ledger.meal_id | required (NOT NULL) | NOT NULL |
| kiss_ledger.recipe_id | nullable | nullable |
| recipe_imports.created_by_user_id | required (NOT NULL) | NOT NULL |
| recipe_imports.normalized_payload | nullable | nullable |
| recipe_imports.imported_recipe_id | nullable | nullable |

kiss-service.sendKiss 已增加 meal_id 必填校验。

## Amendment 变更 1: pantry_staples.display_name_override

**问题**: 用户输入"花椒"等未收录 canonical ingredient 时无法保存常备食材。

**实现**:
- 新增 `display_name_override TEXT`
- CHECK 约束 `pantry_custom_name_required`: ingredient_id IS NOT NULL OR NULLIF(BTRIM(display_name_override), '') IS NOT NULL
- 部分唯一索引 `idx_pantry_canonical_unique`: UNIQUE(family_id, ingredient_id) WHERE ingredient_id IS NOT NULL
- 部分唯一索引 `idx_pantry_custom_unique`: UNIQUE(family_id, LOWER(BTRIM(display_name_override))) WHERE ingredient_id IS NULL

**对 Shopping deduction 的影响**:
- canonical pantry（ingredient_id NOT NULL）继续参与自动库存抵扣
- custom pantry（ingredient_id IS NULL）不参与自动数量抵扣
- custom pantry 正常保存和展示，后续可标准化为 canonical

**向后兼容**: 完全 additive，现有 canonical pantry 数据不受影响。

## Amendment 变更 2: meals.recipe_snapshot (Option A)

**问题**: DATA_MODEL_V4 要求 Meal CONFIRMED 时冻结菜谱版本，以后家庭菜谱修改不能改变历史餐。

**实现**:
- `meals.recipe_snapshot JSONB` nullable
- PLANNING 阶段为 null；PLANNING→CONFIRMED 时原子写入 versioned full snapshot
- schema_version = 1
- 冻结内容: recipe identity/name/食材/步骤/厨具/标签/过敏原/营养/媒体/营养标签/传统饮食标签/蔬菜分类/食材替代品/步骤媒体
- 不冻结: is_favorite, viewer.rating, 当前库存, 当前购物状态
- CONFIRMED 后 immutable
- startCooking / shopping (CONFIRMED+) / history 全部从 snapshot 读取，不再 JOIN live recipes
- snapshot 缺失或 schema_version 不支持 → fail closed (MEAL_SNAPSHOT_MISSING / MEAL_SNAPSHOT_UNSUPPORTED)

### Snapshot V1 contract

顶层:
```json
{
  "schema_version": 1,
  "captured_at": "UTC ISO timestamp",
  "items": [ ... ]
}
```

Item:
```json
{
  "meal_item_id": "uuid",
  "recipe_id": "uuid",
  "recipe_version": 3,
  "servings": 2,
  "source": "MANUAL",
  "selected_by_user_id": "uuid",
  "recipe": { "id": "...", "name": "...", "base_servings": 2, "...": "..." },
  "ingredients": [
    { "ingredient_id": "...", "canonical_code": "...", "name": "...", "quantity": 500, "unit_code": "g", "alternatives": [] }
  ],
  "steps": [
    { "step_no": 1, "title": "...", "operation": "...", "media": [] }
  ],
  "cookware": [{ "cookware_code": "..." }],
  "meal_types": ["DINNER"],
  "tags": ["..."],
  "allergens": ["..."],
  "nutrition": null,
  "nutrition_tags": [],
  "traditional_diet_tags": [],
  "vegetable_categories": [],
  "media": [{ "id": "...", "media_type": "IMAGE", "asset_url": "...", "asset_id": null, "generation_prompt": null, "source_url": null }]
}
```

所有字段通过显式 mapper 构建，禁止 SELECT * 直接进入 snapshot。

### Step Media V1 Compatibility

当前 003 migration 中 `recipe_step_media` 表只有 `url` 字段，而 `recipe_media` 表有 `asset_url/asset_id/generation_prompt/source_url`。为统一 Snapshot V1 media vocabulary：

- step media 的 `url` 映射为 `asset_url`
- `asset_id`、`generation_prompt`、`source_url` 输出 `null`（当前 DB 尚不存在这些字段）
- Snapshot consumer 统一使用 `asset_url`，不暴露临时的 `media.url`
- 未来若 migration 为 recipe_step_media 增加这些字段，snapshot builder 可直接填充，不改变 v1 contract shape

## Production preflight (未来 apply 008 前必须执行)

在生产 Neon 应用 008 前，必须查询：

A. `SELECT COUNT(*) FROM meals WHERE status IN ('CONFIRMED','COOKING','COMPLETED') AND recipe_snapshot IS NULL`
B. `SELECT COUNT(*) FROM pantry_staples WHERE ingredient_id IS NULL AND (display_name_override IS NULL OR BTRIM(display_name_override) = '')`

任何 count > 0 → STOP，交 Reviewer 决定 backfill strategy。禁止 silent historical fake backfill。

## Tests

- S1-S14: snapshot historical correctness (meal-snapshot.test.js)
- S15: history missing snapshot → MEAL_SNAPSHOT_MISSING HTTP non-200
- S16: history unsupported schema → MEAL_SNAPSHOT_UNSUPPORTED HTTP non-200
- S17: snapshot immutable after recipe modification
- S18: 008 schema alignment with DATA_MODEL 25-28
- S19: amendment approval consistency

全部 PASS (20/20)。
