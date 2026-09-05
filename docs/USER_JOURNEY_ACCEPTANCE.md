# User Journey Acceptance — V4

基线 commit: b9df70c
每条 Journey 定义: precondition / steps / UI / API / DB / expected / failure modes

## UJ-01 Login → Home

**Precondition**: 微信已登录，用户属于至少一个家庭
**Steps**:
1. wx.login → POST /auth/wechat → token
2. GET /me → 用户信息
3. GET /me/families → 家庭列表
4. GET /families/:id → 家庭详情
5. GET /families/:id/settings → 厨房设置
6. GET /families/:id/weekly-plans?week_start= → 周计划（可能null）
7. GET /families/:id/meals/current?date=&meal_type= → 当前餐
**UI**: 首页显示真实家庭名、成员、今天日期、当前/下一餐、本周计划（或空态）
**API**: auth/me/families/settings/weekly/meals
**DB**: users/families/family_members/family_settings/weekly_plans/meals
**Expected**: 首页无 fixture、无报错、无"未登录家庭"（session race已修）
**Failure modes**:
- session bootstrap 未完成 → onShow 必须 await ensureSessionReady 后重试
- API 5xx → 显示加载失败+重试，不显示 fixture
- 无 weekly plan → 显示真实空态"本周还没有生成计划"
**Status**: REAL

## UJ-02 Recipe → Meal

**Precondition**: 已登录，active family 存在
**Steps**:
1. 菜单 Tab → 全部菜品 → GET /recipes
2. 选择目标餐次（今天午餐/今晚/明天...）
3. 点击菜谱 + → POST /meals/:id/items
4. Toast: "已加入今天午餐菜单"（动态）
5. mini-cart 显示 "今晚菜单 · 2道"
6. 点击 mini-cart → navigateTo /pages/meal/meal
7. GET /meals/:id → 菜品列表
**UI**: 菜谱列表真实、目标餐次明确、mini-cart 真实、本餐菜单真实
**API**: recipes/meals
**DB**: recipes/meals/meal_items
**Expected**: 点的菜能在本餐菜单找到，退出重进不丢，Weekly Plan 不被修改
**Failure modes**:
- recipe 不存在 → 404
- 重复添加 → 409 ALREADY_IN_MEAL（视为幂等成功）
- meal 不存在 → ensureCurrentMeal 先创建
**Status**: REAL

## UJ-03 Meal → Shopping

**Precondition**: 当前 Meal 至少有 1 道菜
**Steps**:
1. 本餐菜单 → 点击"生成购物清单"
2. POST /shopping-lists/generate {meal_id, mode: REPLACE_GENERATED}
3. 后端: Meal Items → Recipe → servings → canonical ingredient → unit normalize → merge → subtract fridge → subtract pantry → missing
4. switchTab 购物清单
5. GET /shopping-lists/current → 列表 + evidence
**UI**: 购物清单显示真实食材、required/inventory/pantry/missing、来源菜谱
**API**: shopping-lists
**DB**: shopping_lists/shopping_list_items/shopping_item_sources
**Expected**: 购物清单真实产生食材，evidence 包含来源菜谱，重新进入不丢失
**Failure modes**:
- Meal 空 → 提示先加菜
- 单位不兼容 → needs_unit_confirmation=true，不乱合并
- pantry assume_available=true 且 quantity 空 → 完全抵扣
**Status**: REAL

## UJ-04 Shopping → Fridge

**Precondition**: 存在 OPEN shopping list，至少 1 个 GENERATED item
**Steps**:
1. 勾选一个 item → PATCH /shopping-lists/:id/items/:id {is_purchased: true}
2. 点击"完成采购" → 打开 Sheet
3. 设置实际购买量、存放位置、保质期
4. POST /shopping-lists/:id/complete {items: [...]}
5. 后端: 只有 purchased 项入冰箱，写 PURCHASE_IN movement，list → COMPLETED
6. 进入冰箱 Tab → GET /fridge → 新食材存在
**UI**: 完成采购 Sheet 完整可见（不被 TabBar 遮挡），冰箱显示新入库食材
**API**: shopping-lists/fridge
**DB**: shopping_lists/fridge_items/inventory_movements
**Expected**: 已购项真实入冰箱，未购项不入，inventory_movements 有 PURCHASE_IN
**Failure modes**:
- 未勾选 → 不入冰箱
- 购买量默认 = missing_quantity（不是 required）
- 不同有效期不能乱合并批次
**Status**: REAL

## UJ-05 Pantry

**Precondition**: 已登录，active family
**Steps**:
1. 冰箱 Tab → 常备食材
2. 添加"盐" → resolve ingredient → canonical → PUT /pantry-staples/:ingredient_id
3. 添加"花椒"（未知）→ 允许自定义保存 → POST /pantry-staples/custom {display_name: "花椒"}
4. GET /pantry-staples → 两项都存在
5. 删除"花椒" → DELETE /pantry-staples/custom/花椒
**UI**: 常备食材列表真实，未知食材不报错，自定义项正常保存
**API**: pantry-staples
**DB**: pantry_staples
**Expected**: canonical 参与自动抵扣，custom 先保存展示不参与自动抵扣
**Failure modes**:
- canonical 未找到 → 不报错，走自定义路径
- 重复添加同名自定义 → 幂等更新
**Status**: PARTIAL (backend custom done, frontend 未接)

## UJ-06 Kitchen Settings Persistence

**Precondition**: OWNER/ADMIN 角色
**Steps**:
1. 我的 → 厨房设置
2. 修改默认用餐人数 2→4
3. 修改晚餐默认菜数 3→4
4. 保存 → PATCH /families/:id/settings
5. 关闭重新打开 → GET /settings → 值为 4/4
6. 重启小程序 → 仍然是 4/4
**UI**: 设置项可编辑（不是只读预览），保存成功 Toast
**API**: PATCH /families/:id/settings
**DB**: family_settings
**Expected**: 设置真实持久化，MEMBER 角色只读
**Failure modes**:
- MEMBER 尝试修改 → 403
- API 失败 → 不假装保存成功
**Status**: BROKEN (当前只读)

## UJ-07 Weekly → Explicit Meal Import

**Precondition**: 存在 ACTIVE weekly plan
**Steps**:
1. 菜单 → 本周安排 → 查看周计划
2. 点击某道菜"加入本餐" → POST /meals/:id/import-weekly-plan {weekly_plan_id}
3. 后端: 从 weekly_plan_items 复制到 meal_items，source=WEEKLY_PLAN
4. Weekly Plan 原数据不改变
5. 手工点菜（全部菜品 +）绝不修改 weekly_plan_items
**UI**: 周计划真实显示，加入本餐后本餐菜单出现该菜
**API**: weekly-plans/meals
**DB**: weekly_plans/weekly_plan_items/meals/meal_items
**Expected**: Weekly ≠ Meal，手工点菜不写 weekly，只有显式"加入本餐"才导入
**Failure modes**:
- 无 ACTIVE weekly plan → GET 返回 null，显示空态
- 不允许 GET 时隐式生成 fixture
**Status**: PARTIAL (import API exists, weekly generate 未接前端)

## UJ-08 Cooking → Inventory Consume → History

**Precondition**: Meal 状态 CONFIRMED（已确认菜单）
**Steps**:
1. 本餐菜单 → 确认菜单 → POST /meals/:id/confirm → 冻结 recipe_snapshot
2. 开始做饭 → POST /meals/:id/cooking-sessions → ACTIVE session
3. 按步骤做完 → POST /cooking-sessions/:id/complete {consumption: [...]}
4. 后端: FIFO 扣冰箱库存，写 COOK_OUT movement，meal → COMPLETED
5. 我的 → 本餐菜单/历史 → GET /meals/history → 该餐在历史中
**UI**: 确认菜单按钮、开始做饭按钮、做饭步骤、历史列表
**API**: meals/cooking-sessions
**DB**: meals.recipe_snapshot/cooking_sessions/fridge_items/inventory_movements
**Expected**: 库存真实扣减，历史真实记录，不重复扣库存
**Failure modes**:
- 库存不足 → 422 INVENTORY_INSUFFICIENT
- Meal 不是 CONFIRMED → 409
- session 不是 ACTIVE → 409
**Status**: BROKEN (backend skeleton, 前端缺按钮/页面)

## UJ-09 Favorite / Rating

**Precondition**: 已登录
**Steps**:
1. 菜谱详情 → 收藏 → PUT /recipes/:id/favorite
2. 取消收藏 → DELETE /recipes/:id/favorite
3. 做完饭后评分 → PUT /recipes/:id/rating {rating: 5, meal_id}
4. 我的 → 我的收藏 → GET /favorites → 列表
5. 我的 → 我的评分 → GET /ratings → 列表
6. Mine Top Stats → GET /stats → 收藏数/评分数真实
**UI**: 收藏状态真实、评分真实、统计真实
**API**: favorites/ratings/stats
**DB**: recipe_favorites/recipe_ratings
**Expected**: 收藏/评分持久化，统计数字不是破折号
**Failure modes**:
- 重复收藏 → 幂等
- rating 不在 1-5 → 400
**Status**: BROKEN (backend done, 前端未接)

## UJ-10 Mine Navigation

**Precondition**: 已登录，active family
**Steps**:
1. 我的 → 查看个人资料/家庭/设置
2. 点击各 menuGroup 项 → 进入对应页面或 Sheet
3. Top Stats 显示真实数字
4. 么么哒 → 送么么哒 → POST /kiss → GET /kiss/summary
**UI**: 所有 menuGroup 项要么真实可用，要么明确禁用态"规划中"
**API**: multiple
**DB**: multiple
**Expected**: 没有 placeholderToast"待接入"，没有看起来能点但点完没反应的入口
**Failure modes**:
- PLANNED 功能必须禁用态，不能正常点击
- BROKEN 功能必须修复或隐藏
**Status**: BROKEN (多数 placeholderToast)

## UJ-11 Recommendation Quick Actions

**Precondition**: 已登录，active family
**Steps**:
1. 首页 → 随机菜谱 → POST /recommendations/random-meal {mode: BALANCED}
2. 首页 → 看冰箱做菜 → GET /recommendations/fridge-cooking
3. 首页 → 家人喜欢 → 基于 favorites/ratings 推荐
4. 首页 → 一人菜 → POST /recommendations/random-meal {diners_count: 1, mode: ONE_PERSON}
5. 冰箱 → 优先做掉/看冰箱做菜 → 同上
**UI**: 推荐结果真实，不是 Math.random 或 fixture
**API**: recommendations
**DB**: recipes/fridge_items/recipe_favorites/recipe_ratings
**Expected**: 推荐引擎统一使用，含评分/重复惩罚/库存匹配
**Failure modes**:
- 无菜谱 → 空态
- 推荐结果可加入本餐
**Status**: BROKEN (backend skeleton, 前端未接)

## UJ-12 AI Import

**Precondition**: 已登录，active family
**Steps**:
1. 我的 → AI导入菜谱
2. 粘贴 KRP JSON 或自然语言菜谱
3. POST /recipe-imports/parse → 返回 preview + inferred_fields + uncertain_fields
4. 用户确认/修改 → PUT /recipe-imports/:id
5. GET /recipe-imports/:id/validate → 检查错误
6. POST /recipe-imports/:id/confirm → 创建 FAMILY recipe
**UI**: 解析预览、不确定字段标记、用户确认后才写数据库
**API**: recipe-imports
**DB**: recipe_imports/recipes/recipe_ingredients/recipe_steps
**Expected**: 不 AI 一解析就直接写库，不确定字段必须用户确认
**Failure modes**:
- JSON 格式错误 → 400 INVALID_JSON
- 校验有错误 → status NEEDS_REVIEW，不能 confirm
- 已 IMPORTED → 409
**Status**: BROKEN (backend skeleton, 前端未接)

## Journey 状态汇总

| Journey | Status |
|---|---|
| UJ-01 Login → Home | REAL |
| UJ-02 Recipe → Meal | REAL |
| UJ-03 Meal → Shopping | REAL |
| UJ-04 Shopping → Fridge | REAL |
| UJ-05 Pantry | PARTIAL |
| UJ-06 Kitchen Settings | BROKEN |
| UJ-07 Weekly → Meal | PARTIAL |
| UJ-08 Cooking → History | BROKEN |
| UJ-09 Favorite/Rating | BROKEN |
| UJ-10 Mine Navigation | BROKEN |
| UJ-11 Recommendation | BROKEN |
| UJ-12 AI Import | BROKEN |
