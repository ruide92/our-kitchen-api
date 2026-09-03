# 《我们家的大食堂》V4 数据模型

状态：Normative / Phase 2 Freeze

本文件定义唯一字段名、实体关系、枚举与家庭边界。旧字段如 `amount/spicy_level/health_score/kiss_reward/expire_date` 仅作为迁移来源，不得继续进入 V4 API。

## 1. 通用约定

- 主键：字符串 UUID，字段名统一 `id`。
- 外键：`<entity>_id`。
- 数量：统一 `quantity`，可精确数量使用 decimal；无法精确的“少许/适量”允许 `quantity = null` 并保留 `quantity_text`。
- 单位：统一 `unit_code`，展示名由单位字典映射；无法可靠确定单位时允许 nullable，但不得瞎猜。
- 日期：`YYYY-MM-DD`；时间戳：UTC ISO-8601。
- 枚举：数据库/API 使用大写稳定 code，UI 自行翻译。
- 软删除：需要恢复能力的实体用 `deleted_at`；不得把“回收站”实现成另一套复制表。
- 乐观并发：可编辑共享实体使用 `version` 整数，每次更新 +1。
- 家庭共享表必须包含 `family_id`，服务端访问时再校验 membership。

## 2. 核心关系

`users ↔ family_members ↔ families`

`families → recipes(FAMILY)`

`recipes → recipe_ingredients → ingredients`

`recipes → recipe_steps → recipe_step_media`

`families → weekly_plans → weekly_plan_items → recipes`

`families → meals → meal_items → recipes`

`families → fridge_items / pantry_staples / shopping_lists`

`meals → cooking_sessions → inventory_movements`

`users → favorites / ratings / wishes`

`families → kiss_ledger`

## 3. users

字段：

- `id`
- `wechat_openid`：同一小程序内稳定身份，唯一、非空
- `wechat_unionid`：可空，若微信返回则保存
- `nickname`
- `avatar_url`
- `created_at`
- `updated_at`
- `last_login_at`

禁止保存 `wx.login` 临时 code 作为身份。

## 4. families

- `id`
- `name`
- `invite_code`：唯一，可轮换
- `created_by_user_id`
- `photo_url`
- `header_mode`：`PHOTO | DUAL_AVATAR`
- `version` integer >=1
- `created_at`
- `updated_at`
- `deleted_at`

## 5. family_members

- `id`
- `family_id`
- `user_id`
- `role`：`OWNER | ADMIN | MEMBER`
- `status`：`ACTIVE | LEFT | REMOVED`
- `joined_at`
- `updated_at`

约束：`family_id + user_id` 唯一（允许历史状态更新，不重复插活跃成员）。每个未删除家庭至少一个 OWNER。

## 6. family_settings

每家庭一条：

- `family_id` PK/FK
- `default_diners` integer >=1
- `breakfast_target_count`
- `lunch_target_count`
- `dinner_target_count`
- `default_spiciness` 0–5 nullable
- `repeat_strong_days` 默认 7
- `repeat_penalty_days` 默认 14
- `repeat_recover_days` 默认 28
- `random_default_mode`：`BALANCED | USE_INVENTORY | TRY_DIFFERENT`
- `prefer_expiring_inventory` boolean
- `version` integer >=1
- `created_at`
- `updated_at`

厨具、忌口、常备品不塞 JSON 到此表，使用独立关系。

## 7. user_preferences

一用户在一家庭一条，可表达个人差异：

- `id`
- `family_id`
- `user_id`
- `spiciness_preference` 0–5 nullable
- `notes`
- `created_at`
- `updated_at`

关联表：

- `user_disliked_ingredients(user_id,family_id,ingredient_id)`
- `user_allergens(user_id,family_id,allergen_code)`
- `user_diet_tags(user_id,family_id,tag_code)`
- `family_cookware(family_id,cookware_code)`

明确过敏原为推荐硬约束；普通不喜欢是软/强软约束，除非用户标成禁用。

## 8. ingredients

标准食材字典：

- `id`
- `canonical_code`：稳定唯一，例如 `tomato`
- `display_name`：例如“西红柿”
- `category_code`
- `default_unit_code` nullable
- `nutrition_reference_id` nullable
- `created_at`
- `updated_at`

## 9. ingredient_aliases

- `id`
- `ingredient_id`
- `alias_name`
- `normalized_alias`
- `locale` 默认 `zh-CN`

`normalized_alias` 唯一或按 locale 唯一。例如“番茄”“西红柿”映射同一 ingredient。

## 10. units

- `code`：如 `g, kg, jin, ml, l, piece, root, clove, spoon, pinch, appropriate`
- `dimension`：`MASS | VOLUME | COUNT | TEXT`
- `to_base_factor`：同 dimension 可安全换算时使用
- `display_name`

规则：只有同 dimension 且存在可靠 factor 时自动换算；COUNT/TEXT 不跨维度猜测重量。

## 11. recipes：统一物理表、严格逻辑隔离

为避免 `base_recipes/family_recipes` 两套字段漂移，V4 使用一个规范 `recipes` 表，但用约束实现公共基础与家庭版本严格分离。

字段：

- `id`
- `kind`：`BASE | FAMILY`
- `family_id`：BASE 必须 null；FAMILY 必须非空
- `parent_recipe_id`：家庭版从基础/社区菜谱派生时指向来源，可空
- `source_type`：`SEED | MANUAL | BASE_VARIANT | KRP_IMPORT | COMMUNITY_FORK`
- `name`
- `description`
- `category_code`
- `cuisine_code` nullable
- `base_servings`
- `cook_time_minutes`
- `difficulty` 1–5
- `spiciness` 0–5 nullable
- `sweetness` 0–5 nullable
- `saltiness` 0–5 nullable
- `sourness` 0–5 nullable
- `oiliness` 0–5 nullable
- `cooking_method_code` nullable
- `protein_source_code` nullable
- `suggested_kiss` integer >=0 nullable
- `visibility`：BASE 固定 `PUBLIC`；FAMILY 为 `PRIVATE | FAMILY | PUBLIC`
- `created_by_user_id` nullable（seed 可空）
- `updated_by_user_id` nullable
- `version` integer >=1
- `created_at`
- `updated_at`
- `deleted_at`

约束：

- `kind=BASE => family_id IS NULL AND visibility=PUBLIC`
- `kind=FAMILY => family_id IS NOT NULL`
- 家庭用户不得 UPDATE BASE。

附属多值表：

- `recipe_meal_types(recipe_id, meal_type)`：`BREAKFAST | LUNCH | DINNER | SNACK`
- `recipe_tags(recipe_id, tag_code)`
- `recipe_cookware(recipe_id, cookware_code)`
- `recipe_allergens(recipe_id, allergen_code)`
- `recipe_vegetable_categories(recipe_id, vegetable_category_code)`

## 12. recipe_ingredients

- `id`
- `recipe_id`
- `ingredient_id`
- `display_name_override` nullable
- `quantity` decimal nullable
- `quantity_text` nullable
- `unit_code` nullable
- `type`：`MAIN | SIDE | SEASONING | GARNISH`
- `required` boolean
- `sort_order`
- `note`

替代食材：`recipe_ingredient_alternatives(id, recipe_ingredient_id, alternative_ingredient_id, note, sort_order)`。

原则：购物计算只读取当前实际选中的 recipe 的 ingredient rows；基础菜谱被家庭版本替代后不得再混入基础配料。unit_code 不明时不得参与跨单位自动合并，必须保留为人工确认项。

## 13. recipe_steps

- `id`
- `recipe_id`
- `step_no`
- `title`
- `operation`
- `duration_seconds` nullable
- `duration_text` nullable
- `heat_code` nullable：`NO_HEAT | LOW | MEDIUM_LOW | MEDIUM | MEDIUM_HIGH | HIGH | CUSTOM`
- `doneness_cue` nullable
- `tip` nullable
- `sort_order`

`recipe_step_media`：

- `id`
- `recipe_step_id`
- `media_type`：`IMAGE | VIDEO | SOURCE_FRAME`
- `asset_url` nullable
- `asset_id` nullable
- `generation_prompt` nullable
- `source_url` nullable
- `sort_order`

## 14. recipe_media

菜谱级媒体：

- `id`
- `recipe_id`
- `media_type`：`COVER_IMAGE | IMAGE | VIDEO`
- `asset_url` nullable
- `asset_id` nullable
- `generation_prompt` nullable
- `source_url` nullable
- `sort_order`

没有对象存储时允许 asset 为空、prompt 存在，但不得用失效外链冒充正式资产。

## 15. recipe_nutrition

一菜谱一条，可为空：

- `recipe_id`
- `status`：`UNKNOWN | TAG_ONLY | ESTIMATED | VERIFIED_SOURCE`
- `basis_servings`
- `calories_kcal` nullable
- `protein_g` nullable
- `fat_g` nullable
- `carbs_g` nullable
- `fiber_g` nullable
- `sodium_mg` nullable
- `calcium_mg` nullable
- `iron_mg` nullable
- `potassium_mg` nullable
- `source_note` nullable
- `updated_at`

标签：`recipe_nutrition_tags(recipe_id, tag_code)`。

传统食养单独：`recipe_traditional_diet_tags(recipe_id, tag_code, note)`，不得与现代营养数值混表表达医疗结论。

## 16. weekly_plans

- `id`
- `family_id`
- `week_start_date`（周一）
- `status`：`DRAFT | ACTIVE | ARCHIVED`
- `generation_mode` nullable
- `created_by_user_id`
- `confirmed_by_user_id` nullable
- `created_at`
- `updated_at`

约束：一个家庭同一 `week_start_date` 最多一个 ACTIVE。

## 17. weekly_plan_items

- `id`
- `weekly_plan_id`
- `plan_date`
- `meal_type`：`BREAKFAST | LUNCH | DINNER`
- `recipe_id`
- `sort_order`
- `locked` boolean
- `added_by_user_id`
- `source`：`GENERATED | MANUAL | SWAP`
- `created_at`

生成 draft 时保留 locked 的语义由推荐服务实现。

## 18. meals

代表真实的一顿饭，而非计划：

- `id`
- `family_id`
- `meal_date`
- `meal_type`：`BREAKFAST | LUNCH | DINNER`
- `diners_count`
- `status`：`PLANNING | CONFIRMED | COOKING | COMPLETED | CANCELLED`
- `source_weekly_plan_id` nullable
- `created_at`
- `updated_at`

约束：家庭 + 日期 + meal_type 唯一（取消后仍更新该实体，不重复制造多个当前餐）。

## 19. meal_items

- `id`
- `meal_id`
- `recipe_id`
- `selected_by_user_id`
- `source`：`WEEKLY_PLAN | MANUAL | RANDOM | WISH`
- `servings` decimal
- `sort_order`
- `created_at`

为了保证后续家庭菜谱被编辑也不会悄悄改变一顿已经确认/做过的饭，在 Meal 从 `PLANNING` 转 `CONFIRMED` 时应创建可审计 recipe snapshot（实现方式可为 JSON snapshot 或版本引用）；Phase 3 施工前在 migration 设计中确定，但行为必须满足“历史不漂移”。

## 20. fridge_items

- `id`
- `family_id`
- `ingredient_id`
- `display_name_override` nullable
- `quantity` decimal nullable
- `quantity_text` nullable
- `unit_code`
- `storage_location`：`REFRIGERATED | FROZEN | ROOM_TEMP | OTHER`
- `purchase_date` nullable
- `expiry_date` nullable
- `note`
- `created_by_user_id`
- `created_at`
- `updated_at`
- `version`

相同 ingredient 是否合并取决于单位兼容、储存位置和有效期；不能无条件把不同保质期批次合成一条。购物“入冰箱”可优先合并兼容批次，否则新建批次。

## 21. pantry_staples

- `id`
- `family_id`
- `ingredient_id`
- `quantity` nullable
- `quantity_text` nullable
- `unit_code` nullable
- `assume_available` boolean
- `updated_by_user_id`
- `updated_at`

`assume_available=true` 表示生成购物清单时默认足量；若家庭希望精确管理调味品可设 quantity。

## 22. shopping_lists

- `id`
- `family_id`
- `meal_id` nullable
- `status`：`OPEN | COMPLETED | ARCHIVED`
- `generated_at` nullable
- `created_by_user_id`
- `created_at`
- `updated_at`

## 23. shopping_items

- `id`
- `shopping_list_id`
- `ingredient_id`
- `display_name_override` nullable
- `required_quantity` decimal nullable
- `required_quantity_text` nullable
- `unit_code` nullable
- `purchased_quantity` decimal nullable
- `is_purchased` boolean
- `source`：`GENERATED | MANUAL`
- `note`
- `created_by_user_id`
- `updated_at`

统一使用 `is_purchased`，不再使用 `checked/is_bought`。

生成操作对同一 list 应幂等或显式 replace，不能每点击一次就重复追加相同缺失项。

## 24. inventory_movements

库存变化必须可审计：

- `id`
- `family_id`
- `fridge_item_id` nullable
- `ingredient_id`
- `movement_type`：`PURCHASE_IN | MANUAL_IN | COOK_OUT | MANUAL_ADJUST | WASTE_OUT`
- `quantity_delta`
- `unit_code`
- `meal_id` nullable
- `shopping_item_id` nullable
- `performed_by_user_id`
- `created_at`

## 25. cooking_sessions

- `id`
- `family_id`
- `meal_id`
- `status`：`ACTIVE | COMPLETED | CANCELLED`
- `started_by_user_id`
- `completed_by_user_id` nullable
- `started_at`
- `completed_at` nullable

完成时根据确认的实际消耗以事务写入 `inventory_movements` 并更新 fridge batch；失败必须整体回滚。

## 26. favorites / ratings / wishes

`favorites`：

- `id, user_id, recipe_id, created_at`
- user + recipe 唯一

`ratings`：

- `id, family_id, user_id, recipe_id, meal_id nullable, rating(1..5), created_at, updated_at`
- 同一 user 对同一 meal+recipe 最多一条；无 meal 的菜谱评分按 user+recipe 唯一。

`wishes`：

- `id, family_id, user_id, recipe_id, status(ACTIVE|FULFILLED|CANCELLED), created_at, resolved_at`

## 27. kiss_ledger

账本只追加，不通过直接改余额实现：

- `id`
- `family_id`
- `from_user_id`
- `to_user_id`
- `meal_id`
- `recipe_id` nullable
- `suggested_amount` integer nullable
- `actual_amount` integer >=0
- `rating_id` nullable
- `reason` nullable
- `created_at`

余额/本月统计由聚合计算或缓存派生。禁止直接修改历史账目；若未来需要纠错，新增 reversal entry，不覆写原记录。

## 28. recipe_imports

- `id`
- `family_id`
- `created_by_user_id`
- `schema_version`
- `raw_payload` JSONB
- `normalized_payload` JSONB nullable
- `status`：`PARSED | NEEDS_REVIEW | VALIDATED | IMPORTED | REJECTED`
- `inferred_fields` JSONB
- `uncertain_fields` JSONB
- `imported_recipe_id` nullable
- `created_at`
- `updated_at`

KRP 具体 schema 见 `KRP_V2_SPEC.md`。

## 29. public_recipe_posts（未来骨架）

- `id`
- `family_id`
- `author_user_id`
- `recipe_id`
- `status`：`DRAFT | PUBLISHED | HIDDEN | DELETED`
- `published_at`
- `created_at`
- `updated_at`

社区 Fork 通过新 Family Recipe 的 `parent_recipe_id + source_type=COMMUNITY_FORK` 保留来源关系。

## 30. activity_logs（未来/审计）

- `id, family_id, actor_user_id, action_code, entity_type, entity_id, metadata JSONB, created_at`

只记录必要业务事件，不保存 secret、Token、微信 code 或敏感请求原文。

## 31. API 唯一字段映射

V4 统一：

| 概念 | 唯一字段 |
|---|---|
| 数量 | `quantity` |
| 辣度 | `spiciness` |
| 甜度 | `sweetness` |
| 健康信息 | `nutrition`，不再 `healthiness/health_score` |
| 建议么么哒 | `suggested_kiss` |
| 厨具 | `cookware` |
| 到期日 | `expiry_date` |
| 储存位置 | `storage_location` |
| 购物勾选 | `is_purchased` |
| 邀请码 | `invite_code`（JSON）；接受邀请请求字段同名 |
| 评分 | `rating` |
| 菜谱基础人数 | `base_servings` |
| 餐实际人数 | `diners_count` |

旧字段只在迁移适配层出现，不能泄漏回 V4 页面。

## 32. 必要索引/约束

至少：

- users.wechat_openid unique
- family_members(family_id,user_id) unique
- families.invite_code unique
- ingredients.canonical_code unique
- ingredient_aliases(normalized_alias,locale) unique
- weekly_plans(family_id,week_start_date) 对 ACTIVE 唯一
- meals(family_id,meal_date,meal_type) unique
- favorites(user_id,recipe_id) unique
- pantry_staples(family_id,ingredient_id) unique
- recipes family scope/BASE scope CHECK

所有 family-scoped 查询需以 family_id 索引支持。

## 33. 事务边界

必须事务：

1. 接受家庭邀请 + membership 写入。
2. 周计划 draft 确认替换 ACTIVE。
3. 购物完成 → inventory movements + fridge 更新 + shopping 状态。
4. 做饭完成 → inventory movements + fridge 扣减 + meal/cooking status。
5. KRP 确认导入 → recipe + ingredients + steps + media + import status。
6. 删除/恢复共享菜谱涉及关联状态变更时。

## 34. 迁移原则

旧 `database.json` 只读迁移：

- 45 道基础菜清洗为 BASE recipe seed。
- 测试用户、家庭、邀请码、点菜、收藏、调味品和运行周菜单不进入正式 seed。
- 旧字段在迁移脚本显式映射；无法确定的数据记录 migration warning，不静默猜测。
