# 《我们家的大食堂》V4 API 契约

状态：Normative / Phase 2 Freeze

本文件是前端与后端的唯一接口契约。实现不得再由页面、`api.js` 和 Express route 各自发明字段。

## 1. 版本与通用规则

V4 新接口统一前缀：`/api/v1`。

旧 `/api/*` 在迁移期可暂存，但 V4 页面不得继续依赖未列入本文件的 legacy endpoint。

认证：`Authorization: Bearer <token>`。

JSON 命名：`snake_case`。

成功：

```json
{
  "data": {},
  "meta": {}
}
```

列表：

```json
{
  "data": [],
  "meta": {"page":1,"page_size":20,"total":45}
}
```

错误：

```json
{
  "error": {
    "code": "FAMILY_FORBIDDEN",
    "message": "你不是该家庭成员",
    "details": null
  }
}
```

标准 HTTP：400 参数、401 未登录、403 无权限、404 不存在、409 冲突/版本冲突、422 业务校验、500 未预期错误。

可编辑共享实体更新支持 `version`；客户端提交旧 version 时返回 409，禁止最后写入静默覆盖另一家庭成员修改。

## 2. 家庭访问原则

家庭共享资源统一放在 `/families/:family_id/...` 下。服务端必须根据 Token 的 `user_id` 查询 `family_members`；不得只验证 family_id 格式。

BASE 菜谱虽然是公共数据，但在家庭上下文中读取，是为了返回“当前家庭是否存在家庭版本、库存匹配、收藏/评分”等派生状态。

## 3. Auth / Me

### POST `/api/v1/auth/wechat`

请求：

```json
{"code":"wx.login temporary code"}
```

行为：服务端调用微信 `code2Session`，以 openid 查/建 user，返回应用 Token。生产禁止 fake openid 回退。

响应：

```json
{
  "data": {
    "token":"...",
    "user":{"id":"...","nickname":null,"avatar_url":null},
    "families":[{"id":"...","name":"我们的小厨房","role":"OWNER"}]
  }
}
```

### GET `/api/v1/me`

返回当前 user。

### PATCH `/api/v1/me`

允许：`nickname, avatar_url`。

### GET `/api/v1/me/families`

返回当前 ACTIVE memberships；第一版 UI 可自动使用上次/唯一家庭。

## 4. Families

### POST `/api/v1/families`

请求：`{"name":"张爱罗的小厨房"}`。

创建 family + OWNER membership + default settings，使用事务。

### POST `/api/v1/families/join`

请求字段唯一：

```json
{"invite_code":"ABC123"}
```

不得再使用 `code/inviteCode`。

### GET `/api/v1/families/:family_id`

返回 family、当前成员 role、settings 概要。

### PATCH `/api/v1/families/:family_id`

OWNER/ADMIN。允许：`name, photo_url, header_mode, version`。

### GET `/api/v1/families/:family_id/members`

返回 ACTIVE members。

### POST `/api/v1/families/:family_id/invite-code/rotate`

OWNER/ADMIN，返回新 `invite_code`。

### PATCH `/api/v1/families/:family_id/members/:member_id`

OWNER；修改 role 或执行 remove。不能删除最后一个 OWNER。

## 5. Family settings / preferences

### GET `/api/v1/families/:family_id/settings`

返回 `family_settings`、cookware、成员偏好摘要、pantry staples 摘要。

### PATCH `/api/v1/families/:family_id/settings`

OWNER/ADMIN。字段见 DATA_MODEL；数组关系采用显式字段：

```json
{
  "default_diners":2,
  "breakfast_target_count":2,
  "lunch_target_count":2,
  "dinner_target_count":3,
  "repeat_strong_days":7,
  "repeat_penalty_days":14,
  "repeat_recover_days":28,
  "random_default_mode":"BALANCED",
  "cookware":["WOK","RICE_COOKER"]
}
```

### GET/PATCH `/api/v1/families/:family_id/me/preferences`

个人偏好。PATCH 支持 `spiciness_preference, disliked_ingredient_ids, allergens, diet_tags, notes`。

## 6. Recipe list

### GET `/api/v1/families/:family_id/recipes`

查询：

- `scope=ALL|BASE|FAMILY` 默认 ALL
- `category`
- `keyword`
- `cuisine`
- `meal_type`
- `cookware`
- `ingredient_id`
- `favorite=true|false`
- `recent=true|false`
- `page,page_size`

返回列表项统一：

```json
{
  "id":"recipe-id",
  "kind":"BASE",
  "family_id":null,
  "name":"辣椒炒肉",
  "cover_image_url":null,
  "category_code":"HOT_DISH",
  "cook_time_minutes":20,
  "spiciness":3,
  "sweetness":null,
  "suggested_kiss":4,
  "has_family_variant":true,
  "family_variant_id":"...",
  "is_favorite":false,
  "wish_status":null
}
```

当用户浏览 BASE 且家庭已有派生版时，客户端可展示“我家版本”，业务动作优先显式使用 `family_variant_id`，服务端不静默替换传入 id。

## 7. Recipe detail

### GET `/api/v1/families/:family_id/recipes/:recipe_id`

返回：

```json
{
  "data": {
    "recipe": {
      "id":"...","kind":"FAMILY","family_id":"...","parent_recipe_id":"...",
      "name":"...","description":"...","category_code":"...","cuisine_code":"...",
      "meal_types":["LUNCH","DINNER"],"base_servings":2,
      "cook_time_minutes":20,"difficulty":2,
      "spiciness":3,"sweetness":null,"saltiness":2,"sourness":null,"oiliness":2,
      "cookware":["WOK"],"cooking_method_code":"STIR_FRY",
      "suggested_kiss":4,"tags":[],"allergens":[],"version":3
    },
    "ingredients":[
      {"id":"...","ingredient_id":"...","name":"五花肉","quantity":200,"quantity_text":null,"unit_code":"g","type":"MAIN","required":true,"alternatives":[],"note":null}
    ],
    "steps":[
      {"id":"...","step_no":1,"title":"切肉","operation":"...","duration_seconds":120,"duration_text":null,"heat_code":"NO_HEAT","doneness_cue":null,"tip":null,"media":[]}
    ],
    "media":[],
    "nutrition":{"status":"TAG_ONLY","nutrition_tags":["HIGH_PROTEIN"]},
    "inventory_summary":{"required_count":4,"available_count":3,"missing_count":1,"items":[]},
    "viewer":{"is_favorite":false,"rating":null,"wish_status":null}
  }
}
```

`ingredients` 传输结构永远是平面数组 + `type`，前端分组只作为 view model。

## 8. Family recipe writes

### POST `/api/v1/families/:family_id/recipes`

OWNER/ADMIN/MEMBER 可新建家庭菜谱；请求使用与 detail 相同的 recipe/ingredients/steps/media 结构（无服务端字段 id）。`source_type=MANUAL`。

### POST `/api/v1/families/:family_id/recipes/:recipe_id/derive`

从可访问 BASE/PUBLIC recipe 复制为 Family Recipe。

请求可只含：`{"name":"红烧肉 · 我家的做法"}`；服务端完整复制结构，`source_type=BASE_VARIANT` 或 `COMMUNITY_FORK`。

### PATCH `/api/v1/families/:family_id/recipes/:recipe_id`

只允许 FAMILY 且同 family。请求包含 `version` 和需要替换的完整子集合。若编辑 ingredients/steps，API 采用“整组 replace + transaction”，避免局部 patch 产生排序/孤儿数据漂移。

### DELETE `/api/v1/families/:family_id/recipes/:recipe_id`

软删除 FAMILY recipe。若它正在未来 ACTIVE plan / PLANNING meal 中使用，返回 409 并给出引用详情，前端需先替换或确认受控移除。

### POST `/api/v1/families/:family_id/recipes/:recipe_id/restore`

恢复软删除。

## 9. Favorites / ratings / wishes

### PUT/DELETE `/api/v1/families/:family_id/recipes/:recipe_id/favorite`

个人收藏，PUT 幂等创建，DELETE 幂等取消。

### PUT `/api/v1/families/:family_id/recipes/:recipe_id/rating`

请求：`{"rating":5,"meal_id":null}`。字段唯一为 `rating`。

### DELETE `/api/v1/families/:family_id/recipes/:recipe_id/rating?meal_id=...`

取消评分。

### PUT/DELETE `/api/v1/families/:family_id/recipes/:recipe_id/wish`

近期“我想吃”。

## 10. Weekly plans

### GET `/api/v1/families/:family_id/weekly-plans?week_start=YYYY-MM-DD`

返回当前 ACTIVE plan；不存在时返回 `data:null`，**不得 GET 时隐式随机生成**。

### POST `/api/v1/families/:family_id/weekly-plans/generate`

请求：

```json
{
  "week_start":"2026-09-07",
  "mode":"BALANCED",
  "preserve_locked_from_plan_id":"optional"
}
```

生成 `DRAFT`，返回完整 candidate 及 recommendation reasons；不覆盖 ACTIVE。

### POST `/api/v1/families/:family_id/weekly-plans/:plan_id/confirm`

事务：旧 ACTIVE → ARCHIVED；该 DRAFT → ACTIVE。

### POST `/api/v1/families/:family_id/weekly-plans/:plan_id/items`

手工添加计划项。

### PATCH `/api/v1/families/:family_id/weekly-plans/:plan_id/items/:item_id`

允许 `locked, sort_order`。

### DELETE `/api/v1/families/:family_id/weekly-plans/:plan_id/items/:item_id`

删除计划项。

### POST `/api/v1/families/:family_id/weekly-plans/:plan_id/regenerate`

请求 scope：

```json
{"scope":"MEAL|DAY|WEEK","plan_date":"2026-09-09","meal_type":"DINNER"}
```

返回新的 DRAFT；保留 locked item。

## 11. Meals / 本餐菜单

### GET `/api/v1/families/:family_id/meals/current?date=YYYY-MM-DD&meal_type=DINNER`

若不存在返回 null。

### PUT `/api/v1/families/:family_id/meals/current`

Ensure/创建本餐：

```json
{"meal_date":"2026-09-03","meal_type":"DINNER","diners_count":2,"source_weekly_plan_id":null}
```

幂等返回同一 meal。

### GET `/api/v1/families/:family_id/meals/:meal_id`

返回 meal + items + `selected_by` member summary。

### POST `/api/v1/families/:family_id/meals/:meal_id/items`

请求：

```json
{"recipe_id":"...","servings":2,"source":"MANUAL"}
```

服务端从 Token 写 `selected_by_user_id`，不能由客户端冒充。

### DELETE `/api/v1/families/:family_id/meals/:meal_id/items/:item_id`

PLANNING 状态可删。

### POST `/api/v1/families/:family_id/meals/:meal_id/import-weekly-plan`

将该日期餐次计划项一次性加入本餐；幂等去重。

### POST `/api/v1/families/:family_id/meals/:meal_id/confirm`

PLANNING → CONFIRMED，并冻结用于该餐的菜谱版本/snapshot。

## 12. Random meal

### POST `/api/v1/families/:family_id/recommendations/random-meal`

请求：

```json
{
  "meal_date":"2026-09-03",
  "meal_type":"DINNER",
  "diners_count":2,
  "mode":"BALANCED",
  "target_count":3,
  "locked_recipe_ids":[]
}
```

返回 candidate，不直接写入 meal：

```json
{"data":{"recipes":[],"score_summary":{},"reasons":[]}}
```

用户点“就吃这些”后调用 meal item API 批量加入（可增加 batch endpoint，若增加必须回写本文档）。

## 13. Fridge

### GET `/api/v1/families/:family_id/fridge`

查询 `storage_location, expiring_within_days, ingredient_id`。

### POST `/api/v1/families/:family_id/fridge`

请求统一：

```json
{"ingredient_id":"...","quantity":3,"quantity_text":null,"unit_code":"piece","storage_location":"REFRIGERATED","purchase_date":"2026-09-03","expiry_date":"2026-09-08","note":null}
```

### PATCH `/api/v1/families/:family_id/fridge/:fridge_item_id`

含 `version`。

### DELETE `/api/v1/families/:family_id/fridge/:fridge_item_id`

删除/清零需记录 inventory movement（实现可统一走 adjustment service）。

### POST `/api/v1/families/:family_id/fridge/recalculate-availability`

不要求公开 API；详情页库存摘要可由 recipe detail 或专用 quote endpoint 计算。不得把库存判断只做在前端。

## 14. Pantry staples

### GET `/api/v1/families/:family_id/pantry-staples`

### PUT `/api/v1/families/:family_id/pantry-staples/:ingredient_id`

请求：`quantity, unit_code, assume_available`。PUT 幂等。

### DELETE `/api/v1/families/:family_id/pantry-staples/:ingredient_id`

## 15. Shopping

### GET `/api/v1/families/:family_id/shopping-lists/current`

返回 OPEN list 和 items。

### POST `/api/v1/families/:family_id/shopping-lists/generate`

请求：

```json
{"meal_id":"...","mode":"REPLACE_GENERATED"}
```

服务端执行标准化/合并/减库存/减常备品。`REPLACE_GENERATED` 只替换 GENERATED 项，保留用户 MANUAL 项。

响应 items 包含计算证据：

```json
{
  "ingredient_id":"...",
  "required_quantity":500,
  "inventory_deducted":200,
  "pantry_deducted":0,
  "missing_quantity":300,
  "unit_code":"g",
  "sources":[{"recipe_id":"...","quantity":200},{"recipe_id":"...","quantity":300}]
}
```

### POST `/api/v1/families/:family_id/shopping-lists/:list_id/items`

手工添加，`source=MANUAL`。

### PATCH `/api/v1/families/:family_id/shopping-lists/:list_id/items/:item_id`

允许 `required_quantity, purchased_quantity, is_purchased, note`。

### DELETE `/api/v1/families/:family_id/shopping-lists/:list_id/items/:item_id`

### POST `/api/v1/families/:family_id/shopping-lists/:list_id/complete`

请求可指定已购买项的实际购买数量与入库位置/保质期。事务写 inventory movements 和 fridge batches，再将 list 置 COMPLETED。未勾选项不得自动入冰箱。

## 16. Cooking

### POST `/api/v1/families/:family_id/meals/:meal_id/cooking-sessions`

要求 meal CONFIRMED；创建 ACTIVE session，并将 meal → COOKING。

### GET `/api/v1/families/:family_id/cooking-sessions/:session_id`

返回当前餐冻结后的步骤，供普通/大字模式。

### POST `/api/v1/families/:family_id/cooking-sessions/:session_id/complete`

请求：

```json
{
  "consumption":[{"ingredient_id":"...","quantity":180,"unit_code":"g"}]
}
```

服务端校验、事务扣库存、写 movements、session → COMPLETED、meal → COMPLETED。库存不足时返回 422 并给出可调整项，不静默变负数。

## 17. Kiss

### POST `/api/v1/families/:family_id/meals/:meal_id/kisses`

请求：

```json
{"to_user_id":"...","recipe_id":"...","suggested_amount":4,"actual_amount":5,"rating_id":"...","reason":"超好吃"}
```

`from_user_id` 取当前登录用户。不能给自己送；双方必须是 ACTIVE family member。

### GET `/api/v1/families/:family_id/kisses/summary?period=month`

返回成员获得/送出统计和家庭累计。

## 18. Ingredients lookup

### GET `/api/v1/ingredients/search?keyword=番茄`

返回 canonical ingredient 与 aliases；供菜谱编辑/冰箱录入 autocomplete。

### POST `/api/v1/families/:family_id/ingredients/resolve`

可用于 AI/手工未知名称解析：请求 `{"name":"西红柿"}`，返回标准匹配、置信度和候选。低置信度必须让用户确认，不能自动错合并。

## 19. KRP import

### POST `/api/v1/families/:family_id/recipe-imports/parse`

请求：`{"krp_text":"<KITCHEN_RECIPE_PACK>...</...>"}` 或标准 JSON payload。

返回 import id、normalized preview、errors、warnings、inferred_fields、uncertain_fields；状态 PARSED/NEEDS_REVIEW/VALIDATED。

### PATCH `/api/v1/families/:family_id/recipe-imports/:import_id`

保存用户在预览页修订后的 normalized payload。

### POST `/api/v1/families/:family_id/recipe-imports/:import_id/validate`

重新校验。

### POST `/api/v1/families/:family_id/recipe-imports/:import_id/confirm`

只有 VALIDATED 可确认；事务生成 FAMILY recipe，`source_type=KRP_IMPORT`，返回 recipe id。

## 20. Community future boundary

当前只冻结：

- GET `/api/v1/public-recipes`（未来）
- POST `/api/v1/families/:family_id/recipes/:recipe_id/publish`（未来）
- POST `/api/v1/families/:family_id/public-recipes/:public_recipe_id/fork`（未来）

Phase 3–8 未明确安排前不得先实现完整社交系统。

## 21. 首页 fixture 契约（Phase 2.5）

首页在真实后端完成前使用显式 fixture，形状必须与未来 API 一致：

```json
{
  "family":{"id":"fixture-family","name":"我们的小厨房","photo_url":null,"header_mode":"DUAL_AVATAR"},
  "members":[{"id":"m1","user":{"id":"u1","nickname":"锐","avatar_url":"..."}},{"id":"m2","user":{"id":"u2","nickname":"糖糖","avatar_url":"..."}}],
  "today":{"date":"2026-09-03","weekday":3,"diners_count":2},
  "weekly_plan":{"id":"fixture-plan","week_start_date":"2026-08-31","status":"ACTIVE","items":[]},
  "current_meal":{"id":"fixture-meal","meal_type":"DINNER","status":"PLANNING","items":[]}
}
```

fixture 文件必须显式命名 mock/fixture；UI 验收不得声称多人真实业务已打通。

## 22. 禁止事项

- 不增加本文档外的同义 endpoint 来“临时兼容页面”。
- 不在 API 同时返回 `amount/quantity`、`score/rating` 等两套字段。
- 不在 GET 周计划时自动生成并持久化随机菜单。
- 不用客户端提交的 `selected_by_user_id/from_user_id` 冒充身份。
- 不把复杂库存/购物计算搬到小程序前端。
- 若实施中确需更改契约，先修改本文档并同步 DATA_MODEL/TEST，再改代码。
