# Product Surface Matrix — V4

基线 commit: b9df70c
生成时间: 2026-09-06
状态定义: REAL / PARTIAL / BROKEN / PLANNED_DISABLED / HIDDEN

本文件是所有用户可见入口的唯一权威清单。任何新增用户入口必须在此登记。

## 首页 (pages/index)

| Surface ID | Label | Trigger | Expected Outcome | Status | Phase | Final | Frontend | API | Backend | DB | Journey | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| HOME-01 | 家庭头像/名称 | onShow | 显示真实家庭名+成员 | REAL | 12A | REAL | index.js | GET /families/:id | family-service | families | UJ-01 | integration |
| HOME-02 | 今天/今晚人数 | onShow | 真实日期+settings diners | REAL | 12A | REAL | index.js | GET /settings | family-service | family_settings | UJ-01 | integration |
| HOME-03 | 随机菜谱 | bindtap goRandom | 推荐引擎随机推荐 | BROKEN | 12B | REAL | index.js | POST /recommendations/random-meal | recommendation-service | recipes | UJ-11 | 未实现 |
| HOME-04 | 看冰箱做菜 | bindtap goFridgeCook | 基于库存推荐可做菜 | BROKEN | 12B | REAL | index.js | GET /recommendations/fridge-cooking | recommendation-service | fridge_items | UJ-11 | 未实现 |
| HOME-05 | 家人喜欢的菜 | bindtap goFavorites | 基于favorites/ratings | BROKEN | 12B | REAL | index.js | GET /favorites | recipe-service | recipe_favorites | UJ-11 | 未实现 |
| HOME-06 | 一人菜 | bindtap goOnePerson | diners=1推荐 | BROKEN | 12B | REAL | index.js | POST /recommendations/random-meal | recommendation-service | recipes | UJ-11 | 未实现 |
| HOME-07 | 本周菜谱-查看 | bindtap goWeeklyPlan | 进入周计划视图 | BROKEN | 12B | REAL | index.js | GET /weekly-plans | meal-service | weekly_plans | UJ-07 | 未实现 |
| HOME-08 | 本周空状态 | render | 真实空态"本周还没有生成计划" | REAL | 12A | REAL | index.wxml | — | — | — | UJ-07 | visual |
| HOME-09 | 加入本餐 | bindtap addToMeal | importWeeklyPlan | REAL | 12A | REAL | index.js | POST /meals/:id/import-weekly-plan | meal-service | meal_items | UJ-07 | integration |
| HOME-10 | 已点菜单-查看 | bindtap goMeal | navigateTo /pages/meal/meal | REAL | 12A | REAL | index.js | GET /meals/current | meal-service | meals | UJ-02 | integration |
| HOME-11 | 重新加载 | bindtap retryLoad | 重新加载首页数据 | REAL | 12A | REAL | index.js | multiple | multiple | multiple | UJ-01 | unit |

## 菜单 (pages/menu)

### 本周安排 Tab
| Surface ID | Label | Trigger | Expected Outcome | Status | Phase | Final | Frontend | API | Backend | DB | Journey | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| MENU-W-01 | 重新安排本周 | bindtap rearrangeWeek | 推荐引擎生成周计划 | BROKEN | 12B | REAL | menu.js | POST /weekly-plans/generate | recommendation-service | weekly_plans | UJ-07 | 未实现 |
| MENU-W-02 | 重新安排某餐 | bindtap rearrangeMeal | 推荐引擎替换该餐 | BROKEN | 12B | REAL | menu.js | POST /weekly-plans/generate | recommendation-service | weekly_plan_items | UJ-07 | 未实现 |
| MENU-W-03 | 锁定/解锁 | bindtap toggleLock | PATCH weekly item locked | BROKEN | 12B | REAL | menu.js | (未实现) | (未实现) | weekly_plan_items | UJ-07 | 未实现 |
| MENU-W-04 | 换一道 | bindtap swapDish | 推荐引擎swap | BROKEN | 12B | REAL | menu.js | (未实现) | (未实现) | weekly_plan_items | UJ-07 | 未实现 |
| MENU-W-05 | 删除计划项 | bindtap removePlanItem | DELETE weekly item | BROKEN | 12B | REAL | menu.js | (未实现) | (未实现) | weekly_plan_items | UJ-07 | 未实现 |
| MENU-W-06 | 添加到计划 | bindtap addToMeal | POST weekly item | BROKEN | 12B | REAL | menu.js | (未实现) | (未实现) | weekly_plan_items | UJ-07 | 未实现 |
| MENU-W-07 | 重新安排今天 | bindtap rearrangeDay | 推荐引擎替换当天 | BROKEN | 12B | REAL | menu.js | (未实现) | (未实现) | weekly_plan_items | UJ-07 | 未实现 |

### 全部菜品 Tab
| Surface ID | Label | Trigger | Expected Outcome | Status | Phase | Final | Frontend | API | Backend | DB | Journey | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| MENU-R-01 | 目标餐次选择器 | bindtap openTargetPicker | 选择date+meal_type | REAL | 12A | REAL | menu.js | — | — | — | UJ-02 | unit |
| MENU-R-02 | 自选日期 | bindtap + date picker | 自定义date+meal_type | REAL | 12A | REAL | menu.js | — | — | — | UJ-02 | unit |
| MENU-R-03 | 搜索 | bindinput | keyword filter | REAL | 12A | REAL | menu.js | GET /recipes | recipe-service | recipes | UJ-02 | integration |
| MENU-R-04 | 分类筛选 | bindtap selectCategory | category filter | REAL | 12A | REAL | menu.js | GET /recipes | recipe-service | recipes | UJ-02 | integration |
| MENU-R-05 | 菜谱列表 | render | GET /recipes | REAL | 12A | REAL | menu.js | GET /recipes | recipe-service | recipes | UJ-02 | integration |
| MENU-R-06 | 菜谱详情 | bindtap goDetail | navigateTo /pages/detail/detail | PARTIAL | 12B | REAL | menu.js | GET /recipes/:id | recipe-service | recipes | UJ-02 | detail页旧结构 |
| MENU-R-07 | 加入本餐 | bindtap addToMeal | POST meal item | REAL | 12A | REAL | menu.js | POST /meals/:id/items | meal-service | meal_items | UJ-02 | integration |
| MENU-R-08 | mini-cart | render | 显示当前meal count | REAL | 12A | REAL | menu.js | GET /meals/current | meal-service | meals | UJ-02 | integration |
| MENU-R-09 | 查看菜单 | bindtap goMeal | navigateTo /pages/meal/meal | REAL | 12A | REAL | menu.js | — | — | — | UJ-02 | integration |

## 菜谱详情 (pages/detail)

| Surface ID | Label | Trigger | Expected Outcome | Status | Phase | Final | Frontend | API | Backend | DB | Journey | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| DETAIL-01 | 菜名/图片 | render | V1 recipe data | BROKEN | 12B | REAL | detail.js | GET /recipes/:id | recipe-service | recipes | UJ-02 | 旧fixture结构 |
| DETAIL-02 | 食材列表 | render | V1 ingredients平面数组 | BROKEN | 12B | REAL | detail.js | GET /recipes/:id | recipe-service | recipe_ingredients | UJ-02 | 旧fixture结构 |
| DETAIL-03 | 做法步骤 | render | V1 steps | BROKEN | 12B | REAL | detail.js | GET /recipes/:id | recipe-service | recipe_steps | UJ-02 | 旧fixture结构 |
| DETAIL-04 | 收藏 | bindtap toggleFavorite | PUT/DELETE favorite | BROKEN | 12C | REAL | detail.js | PUT/DELETE /recipes/:id/favorite | recipe-service | recipe_favorites | UJ-09 | 未实现 |
| DETAIL-05 | 评分 | bindtap rateRecipe | PUT rating | BROKEN | 12C | REAL | detail.js | PUT /recipes/:id/rating | recipe-service | recipe_ratings | UJ-09 | 未实现 |
| DETAIL-06 | 加入菜单 | bindtap addToMeal | POST meal item | BROKEN | 12B | REAL | detail.js | POST /meals/:id/items | meal-service | meal_items | UJ-02 | 未实现 |
| DETAIL-07 | 开始做饭 | bindtap startCooking | POST cooking session | BROKEN | 12C | REAL | detail.js | POST /meals/:id/cooking-sessions | cooking-service | cooking_sessions | UJ-08 | backend skeleton |

## 本餐菜单 (pages/meal)

| Surface ID | Label | Trigger | Expected Outcome | Status | Phase | Final | Frontend | API | Backend | DB | Journey | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| MEAL-01 | 标题/日期/餐次 | render | 动态显示 | REAL | 12A | REAL | meal.js | GET /meals/current | meal-service | meals | UJ-02 | integration |
| MEAL-02 | 人数调整 | bindtap +/- | PUT /meals/current | REAL | 12A | REAL | meal.js | PUT /meals/current | meal-service | meals | UJ-02 | integration |
| MEAL-03 | 继续加菜 | bindtap goMenu | switchTab menu | REAL | 12A | REAL | meal.js | — | — | — | UJ-02 | integration |
| MEAL-04 | 菜品列表 | render | GET meal items | REAL | 12A | REAL | meal.js | GET /meals/:id | meal-service | meal_items | UJ-02 | integration |
| MEAL-05 | 删除菜品 | bindtap removeItem | DELETE meal item | REAL | 12A | REAL | meal.js | DELETE /meals/:id/items/:id | meal-service | meal_items | UJ-02 | integration |
| MEAL-06 | 生成购物清单 | bindtap generateShopping | POST shopping generate | REAL | 12A | REAL | meal.js | POST /shopping-lists/generate | shopping-service | shopping_lists | UJ-03 | integration |
| MEAL-07 | 确认菜单 | bindtap confirmMenu | POST meal confirm (snapshot) | BROKEN | 12C | REAL | meal.js | POST /meals/:id/confirm | cooking-service | meals.recipe_snapshot | UJ-08 | backend skeleton, 前端缺按钮 |
| MEAL-08 | 开始做饭 | bindtap startCooking | POST cooking session | BROKEN | 12C | REAL | meal.js | POST /meals/:id/cooking-sessions | cooking-service | cooking_sessions | UJ-08 | backend skeleton, 前端缺按钮 |

## 冰箱 (pages/fridge)

### 库存 Tab
| Surface ID | Label | Trigger | Expected Outcome | Status | Phase | Final | Frontend | API | Backend | DB | Journey | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FRIDGE-01 | 添加食材 | bindtap openAddSheet | POST fridge | REAL | 12A | REAL | fridge.js | POST /fridge | fridge-service | fridge_items | UJ-04 | integration |
| FRIDGE-02 | 编辑食材 | bindtap openEditSheet | PATCH fridge + version | REAL | 12A | REAL | fridge.js | PATCH /fridge/:id | fridge-service | fridge_items | UJ-04 | integration |
| FRIDGE-03 | 删除食材 | bindtap deleteItem | DELETE fridge | REAL | 12A | REAL | fridge.js | DELETE /fridge/:id | fridge-service | fridge_items | UJ-04 | integration |
| FRIDGE-04 | 搜索 | bindinput | keyword filter | REAL | 12A | REAL | fridge.js | GET /fridge | fridge-service | fridge_items | UJ-04 | integration |
| FRIDGE-05 | 分类筛选 | bindtap selectCategory | category filter | REAL | 12A | REAL | fridge.js | GET /fridge | fridge-service | fridge_items | UJ-04 | integration |
| FRIDGE-06 | 快过期提示 | render | expiry calculation | REAL | 12A | REAL | fridge.js | GET /fridge | fridge-service | fridge_items | UJ-04 | integration |
| FRIDGE-07 | 优先做掉 | bindtap prioritizeExpiring | 推荐引擎 | BROKEN | 12B | REAL | fridge.js | GET /recommendations/fridge-cooking | recommendation-service | — | UJ-11 | 未实现 |
| FRIDGE-08 | 看冰箱做菜 | bindtap cookWithFridge | 推荐引擎 | BROKEN | 12B | REAL | fridge.js | GET /recommendations/fridge-cooking | recommendation-service | — | UJ-11 | 未实现 |
| FRIDGE-09 | 自定义单位 | select 自定义 | unit_code=null+quantity_text | REAL | 12A | REAL | fridge.js | POST/PATCH /fridge | fridge-service | fridge_items | UJ-04 | unit |

### 常备食材 Tab
| Surface ID | Label | Trigger | Expected Outcome | Status | Phase | Final | Frontend | API | Backend | DB | Journey | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PANTRY-01 | 添加常备 | bindtap addStaple | PUT pantry (canonical) | REAL | 12A | REAL | fridge.js | PUT /pantry-staples/:id | fridge-service | pantry_staples | UJ-05 | integration |
| PANTRY-02 | 自定义常备 | bindtap addStaple | POST pantry custom | PARTIAL | 12A | REAL | fridge.js | POST /pantry-staples/custom | fridge-service | pantry_staples | UJ-05 | backend done, 前端未接 |
| PANTRY-03 | 删除常备 | bindtap removeStaple | DELETE pantry | REAL | 12A | REAL | fridge.js | DELETE /pantry-staples/:id | fridge-service | pantry_staples | UJ-05 | integration |
| PANTRY-04 | 常备列表 | render | GET pantry | REAL | 12A | REAL | fridge.js | GET /pantry-staples | fridge-service | pantry_staples | UJ-05 | integration |

## 购物清单 (pages/shopping)

| Surface ID | Label | Trigger | Expected Outcome | Status | Phase | Final | Frontend | API | Backend | DB | Journey | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SHOP-01 | 空状态引导 | render | 去本餐菜单 | REAL | 12A | REAL | shopping.js | GET /shopping-lists/current | shopping-service | shopping_lists | UJ-03 | integration |
| SHOP-02 | 手动添加 | bindtap openAddSheet | POST shopping item | REAL | 12A | REAL | shopping.js | POST /shopping-lists/:id/items | shopping-service | shopping_list_items | UJ-03 | integration |
| SHOP-03 | 手动编辑 | bindtap openEditSheet | PATCH shopping item | REAL | 12A | REAL | shopping.js | PATCH /shopping-lists/:id/items/:id | shopping-service | shopping_list_items | UJ-03 | integration |
| SHOP-04 | 手动删除 | bindtap deleteItem | DELETE shopping item | REAL | 12A | REAL | shopping.js | DELETE /shopping-lists/:id/items/:id | shopping-service | shopping_list_items | UJ-03 | integration |
| SHOP-05 | 勾选购买 | bindtap togglePurchased | PATCH is_purchased | REAL | 12A | REAL | shopping.js | PATCH /shopping-lists/:id/items/:id | shopping-service | shopping_list_items | UJ-04 | integration |
| SHOP-06 | 证据详情 | bindtap openEvidence | required/inventory/missing | REAL | 12A | REAL | shopping.js | GET /shopping-lists/current | shopping-service | shopping_list_items | UJ-03 | integration |
| SHOP-07 | 从本餐更新 | bindtap updateFromMeal | REPLACE_GENERATED | REAL | 12A | REAL | shopping.js | POST /shopping-lists/generate | shopping-service | shopping_lists | UJ-03 | integration |
| SHOP-08 | 完成采购 | bindtap openCompleteSheet | POST complete +入冰箱 | REAL | 12A | REAL | shopping.js | POST /shopping-lists/:id/complete | shopping-service | fridge_items | UJ-04 | integration |
| SHOP-09 | 购买量/存放/保质期 | sheet inputs | complete payload | REAL | 12A | REAL | shopping.js | POST /shopping-lists/:id/complete | shopping-service | fridge_items | UJ-04 | integration |

## 我的 (pages/mine)

| Surface ID | Label | Trigger | Expected Outcome | Status | Phase | Final | Frontend | API | Backend | DB | Journey | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| MINE-01 | 个人资料/昵称 | bindtap openProfileSheet | PATCH /me | REAL | 12A | REAL | mine-controller.js | PATCH /me | family-service | users | UJ-10 | integration |
| MINE-02 | 家庭管理 | bindtap openFamilySheet | members list | REAL | 12A | REAL | mine-controller.js | GET /families/:id/members | family-service | family_members | UJ-10 | integration |
| MINE-03 | 邀请家人 | bindtap openInviteSheet | invite code | REAL | 12A | REAL | mine-controller.js | GET /families/:id | family-service | families | UJ-10 | integration |
| MINE-04 | 厨房设置 | bindtap openKitchenSettingsSheet | PATCH settings (可编辑) | BROKEN | 12A | REAL | mine-controller.js | PATCH /families/:id/settings | family-service | family_settings | UJ-06 | 当前只读 |
| MINE-05 | 调味品/常备品 | bindtap menuGroups | switchTab fridge pantry | BROKEN | 12A | REAL | mine-controller.js | — | — | — | UJ-05 | placeholderToast |
| MINE-06 | 么么哒 | bindtap menuGroups | kiss ledger | BROKEN | 12D | REAL | mine-controller.js | POST /kiss, GET /kiss/summary | kiss-service | kiss_ledger | UJ-10 | backend skeleton |
| MINE-07 | 本餐菜单/历史 | bindtap menuGroups | meal history page | BROKEN | 12C | REAL | mine-controller.js | GET /meals/history | cooking-service | meals | UJ-08 | backend skeleton |
| MINE-08 | 我的收藏 | bindtap menuGroups | favorites list | BROKEN | 12C | REAL | mine-controller.js | GET /favorites | recipe-service | recipe_favorites | UJ-09 | backend skeleton |
| MINE-09 | 我的评分 | bindtap menuGroups | ratings list | BROKEN | 12C | REAL | mine-controller.js | GET /ratings | recipe-service | recipe_ratings | UJ-09 | backend skeleton |
| MINE-10 | 我的菜谱 | bindtap menuGroups | FAMILY recipes | BROKEN | 12D | REAL | mine-controller.js | GET /recipes?scope=FAMILY | recipe-service | recipes | UJ-10 | backend skeleton |
| MINE-11 | AI导入菜谱 | bindtap menuGroups | KRP import flow | BROKEN | 12D | REAL | mine-controller.js | POST /recipe-imports/parse | recipe-import-service | recipe_imports | backend skeleton |
| MINE-12 | 分享广场 | bindtap menuGroups | community | PLANNED_DISABLED | future | PLANNED_DISABLED | mine-controller.js | — | — | — | — | 用户明确规划中 |
| MINE-13 | 我的分享 | bindtap menuGroups | community | PLANNED_DISABLED | future | PLANNED_DISABLED | mine-controller.js | — | — | — | — | 用户明确规划中 |
| MINE-14 | 回收站 | bindtap menuGroups | soft-deleted items | BROKEN | 12E | PLANNED_DISABLED | mine-controller.js | — | — | — | — | 模型无安全恢复语义 |
| MINE-15 | 设置 | bindtap openSettingsSheet | settings page | PARTIAL | 12E | REAL | mine-controller.js | multiple | multiple | multiple | UJ-10 | 部分实现 |
| MINE-16 | 关于我们 | bindtap menuGroups | static about page | BROKEN | 12E | REAL | mine-controller.js | — | — | — | UJ-10 | placeholderToast |
| MINE-17 | Top Stats-收藏 | render | 真实count | BROKEN | 12E | REAL | mine-controller.js | GET /stats | recipe-service | recipe_favorites | UJ-09 | 显示破折号 |
| MINE-18 | Top Stats-评分 | render | 真实count | BROKEN | 12E | REAL | mine-controller.js | GET /stats | recipe-service | recipe_ratings | UJ-09 | 显示破折号 |
| MINE-19 | Top Stats-做过 | render | 真实count | BROKEN | 12E | REAL | mine-controller.js | GET /stats | recipe-service | meals | UJ-08 | 显示破折号 |
| MINE-20 | Top Stats-么么哒 | render | 真实count | BROKEN | 12E | REAL | mine-controller.js | GET /stats | kiss-service | kiss_ledger | UJ-10 | 显示破折号 |

## 二级页面 (app.json 注册但未使用)

| Surface ID | Label | Trigger | Expected Outcome | Status | Phase | Final | Frontend | API | Backend | DB | Journey | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PAGE-01 | pages/favorites | navigateTo | 收藏列表 | BROKEN | 12C | REAL | favorites.js | GET /favorites | recipe-service | recipe_favorites | UJ-09 | 旧fixture |
| PAGE-02 | pages/ratings | navigateTo | 评分列表 | BROKEN | 12C | REAL | ratings.js | GET /ratings | recipe-service | recipe_ratings | UJ-09 | 旧fixture |
| PAGE-03 | pages/random | navigateTo | 随机推荐 | BROKEN | 12B | REAL | random.js | POST /recommendations/random-meal | recommendation-service | recipes | UJ-11 | 旧fixture |
| PAGE-04 | pages/add-recipe | navigateTo | 创建家庭菜谱 | BROKEN | 12D | REAL | add-recipe.js | POST /recipes | recipe-service | recipes | UJ-10 | 旧fixture |
| PAGE-05 | pages/ai-import | navigateTo | AI导入 | BROKEN | 12D | REAL | ai-import.js | POST /recipe-imports/* | recipe-import-service | recipe_imports | UJ-12 | 旧fixture |
| PAGE-06 | pages/recycle | navigateTo | 回收站 | BROKEN | 12E | HIDDEN | recycle.js | — | — | — | — | 模型不支持 |
| PAGE-07 | pages/seasoning | navigateTo | 调味品 | HIDDEN | 12A | HIDDEN | seasoning.js | — | — | — | — | 已被fridge pantry替代 |
| PAGE-08 | pages/orders | navigateTo | 订单 | HIDDEN | 12A | HIDDEN | orders.js | — | — | — | — | 不属于V4 |
| PAGE-09 | pages/today-menu | navigateTo | 今日菜单 | BROKEN | 12C | REAL | today-menu.js | GET /meals/current | meal-service | meals | UJ-02 | 旧fixture |
| PAGE-10 | pages/family | navigateTo | 家庭管理 | BROKEN | 12E | HIDDEN | family.js | — | — | — | — | 已在mine内实现 |

## 统计汇总

| 状态 | 数量 |
|---|---|
| REAL | 37 |
| PARTIAL | 4 |
| BROKEN | 38 |
| PLANNED_DISABLED | 2 |
| HIDDEN | 4 |
| UNCLASSIFIED | 0 |
| **TOTAL** | **85** |
