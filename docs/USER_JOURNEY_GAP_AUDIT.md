# User Journey Gap Audit — V4 Full Product Closeout

状态：2026-09-06 审计基准 commit 845f608

本文件遍历所有用户可见入口，分类为 REAL / PARTIAL / BROKEN / PLACEHOLDER / PLANNED。

## 1. 首页 (pages/index)

| 入口 | 预期 | 当前状态 | 处理 |
|---|---|---|---|
| 家庭头像区 | 显示家庭成员 | REAL | 保留 |
| 厨房名称 | 真实家庭名 | REAL | 保留 |
| 今天/今晚人数 | 真实日期+settings | REAL | 保留 |
| 随机菜谱 | 推荐引擎随机 | BROKEN(goRandom未实现) | 12B 实现 |
| 看冰箱做菜 | 基于库存推荐 | BROKEN(goFridgeCook未实现) | 12B 实现 |
| 家人喜欢的菜 | 基于favorites/ratings | BROKEN(goFavorites未实现) | 12B 实现 |
| 一人菜 | diners=1推荐 | BROKEN(goOnePerson未实现) | 12B 实现 |
| 本周菜谱-查看本周 | 进入周计划 | BROKEN(goWeeklyPlan未实现) | 12B 实现 |
| 本周菜谱-空状态 | 真实空 | REAL | 保留 |
| 本周菜谱-日期切换 | 真实weeklyPlan | REAL | 保留 |
| 加入本餐 | importWeeklyPlan | REAL | 保留 |
| 已点菜单-查看 | navigateTo meal | REAL | 保留 |
| 已点菜单-继续添加 | navigateTo meal | REAL | 保留 |
| 重新加载 | retryLoad | REAL | 保留 |

## 2. 菜单 (pages/menu)

### 本周安排 Tab
| 入口 | 预期 | 当前状态 | 处理 |
|---|---|---|---|
| 重新安排本周 | 推荐引擎生成 | BROKEN(rearrangeWeek未实现) | 12B 实现 |
| 日期切换 | 真实weeklyPlan | REAL | 保留 |
| 重新安排某餐 | 推荐引擎 | BROKEN(rearrangeMeal未实现) | 12B 实现 |
| 锁定/解锁 | PATCH weekly item | BROKEN(toggleLock未实现) | 12B 实现 |
| 换一道 | 推荐引擎swap | BROKEN(swapDish未实现) | 12B 实现 |
| 删除计划项 | DELETE weekly item | BROKEN(removePlanItem未实现) | 12B 实现 |
| 添加到计划 | POST weekly item | BROKEN(addToMeal未实现) | 12B 实现 |
| 重新安排今天 | 推荐引擎 | BROKEN(rearrangeDay未实现) | 12B 实现 |

### 全部菜品 Tab
| 入口 | 预期 | 当前状态 | 处理 |
|---|---|---|---|
| 目标餐次选择器 | 选择date+meal_type | REAL | 保留 |
| 自选日期 | date picker+meal type | REAL | 保留 |
| 搜索 | keyword filter | REAL | 保留 |
| 分类筛选 | category sidebar | REAL | 保留 |
| 菜谱列表 | GET /recipes | REAL | 保留 |
| 菜谱详情 | navigateTo detail | REAL(但detail页是旧结构) | 12B 重写detail |
| 加入本餐 | POST meal item | REAL | 保留 |
| mini-cart | 显示当前meal | REAL | 保留 |
| 查看菜单 | navigateTo meal | REAL | 保留 |

## 3. 菜谱详情 (pages/detail)

| 入口 | 预期 | 当前状态 | 处理 |
|---|---|---|---|
| 整个页面 | V1 recipe detail API | BROKEN(旧fixture结构) | 12B 完全重写 |
| 收藏 | PUT/DELETE favorite | BROKEN | 12C 实现 |
| 编辑 | FAMILY recipe edit | BROKEN | 12D 实现 |
| 评分 | PUT rating | BROKEN | 12C 实现 |
| 我想吃 | PUT wish | BROKEN | 12C 实现 |
| 加入菜单 | POST meal item | BROKEN | 12B 实现 |
| 开始做饭 | cooking session | BROKEN | 12C 实现 |

## 4. 本餐菜单 (pages/meal)

| 入口 | 预期 | 当前状态 | 处理 |
|---|---|---|---|
| 标题/日期/餐次 | 动态 | REAL | 保留 |
| 人数调整 | PUT /meals/current | REAL | 保留 |
| 加菜 | switchTab menu | REAL | 保留 |
| 菜品列表 | GET meal items | REAL | 保留 |
| 删除 | DELETE meal item | REAL | 保留 |
| 生成购物清单 | POST shopping generate | REAL | 保留 |
| 确认菜单 | POST meal confirm | BROKEN(缺按钮) | 12C 实现 |
| 开始做饭 | cooking session | BROKEN(缺按钮) | 12C 实现 |

## 5. 冰箱 (pages/fridge)

### 库存 Tab
| 入口 | 预期 | 当前状态 | 处理 |
|---|---|---|---|
| 添加食材 | POST fridge | REAL | 保留 |
| 编辑食材 | PATCH fridge | REAL | 保留 |
| 删除食材 | DELETE fridge | REAL | 保留 |
| 搜索 | keyword filter | REAL | 保留 |
| 分类筛选 | category filter | REAL | 保留 |
| 快过期提示 | expiry calculation | REAL | 保留 |
| 优先做掉 | 推荐引擎 | BROKEN(prioritizeExpiring未实现) | 12B 实现 |
| 看冰箱做菜 | 推荐引擎 | BROKEN(cookWithFridge未实现) | 12B 实现 |
| 自定义单位 | unit_code=null+quantity_text | REAL | 保留 |

### 常备食材 Tab
| 入口 | 预期 | 当前状态 | 处理 |
|---|---|---|---|
| 添加常备 | PUT pantry | PARTIAL(未知ingredient报错) | 12A 修复自定义保存 |
| 删除常备 | DELETE pantry | REAL | 保留 |
| 列表 | GET pantry | REAL | 保留 |

## 6. 购物清单 (pages/shopping)

| 入口 | 预期 | 当前状态 | 处理 |
|---|---|---|---|
| 空状态引导 | 去本餐菜单 | REAL | 保留 |
| 手动添加 | POST shopping item | REAL | 保留 |
| 手动编辑 | PATCH shopping item | REAL | 保留 |
| 手动删除 | DELETE shopping item | REAL | 保留 |
| 勾选购买 | PATCH is_purchased | REAL | 保留 |
| 证据详情 | required/inventory/missing | REAL | 保留 |
| 从本餐更新 | REPLACE_GENERATED | REAL | 保留 |
| 完成采购 | POST complete | REAL | 保留 |
| 购买量/存放/保质期 | complete sheet | REAL | 保留 |

## 7. 我的 (pages/mine)

| 入口 | 预期 | 当前状态 | 处理 |
|---|---|---|---|
| 个人资料 | PATCH /me | REAL | 保留 |
| 家庭管理 | members list | REAL(只读) | 保留 |
| 邀请家人 | invite code | REAL | 保留 |
| 厨房设置 | PATCH settings | BROKEN(只读) | 12A 实现可编辑 |
| 调味品/常备品 | switchTab fridge pantry | BROKEN(placeholderToast) | 12A 修复 |
| 么么哒 | kiss ledger | BROKEN(placeholderToast) | 12D 实现 |
| 本餐菜单/历史 | meal history | BROKEN(placeholderToast) | 12C 实现 |
| 我的收藏 | favorites list | BROKEN(placeholderToast) | 12C 实现 |
| 我的评分 | ratings list | BROKEN(placeholderToast) | 12C 实现 |
| 我的菜谱 | FAMILY recipes | BROKEN(placeholderToast) | 12D 实现 |
| AI导入菜谱 | KRP import | BROKEN(placeholderToast) | 12D 实现 |
| 分享广场 | community | PLANNED(用户明确规划中) | 禁用态 |
| 我的分享 | community | PLANNED(用户明确规划中) | 禁用态 |
| 回收站 | soft-deleted items | BROKEN(placeholderToast) | 12E 评估 |
| 设置 | settings page | PARTIAL | 12E 完善 |
| 关于我们 | static page | BROKEN(placeholderToast) | 12E 实现 |
| Top Stats(收藏/评分/做过/么么哒) | 真实count | BROKEN(全是破折号) | 12E 实现 |

## 8. 其他二级页面

| 页面 | 预期 | 当前状态 | 处理 |
|---|---|---|---|
| pages/favorites | 收藏列表 | BROKEN(可能旧fixture) | 12C 重写或移除 |
| pages/ratings | 评分列表 | BROKEN | 12C 重写或移除 |
| pages/random | 随机推荐 | BROKEN | 12B 重写或移除 |
| pages/add-recipe | 创建家庭菜谱 | BROKEN | 12D 重写或移除 |
| pages/ai-import | AI导入 | BROKEN | 12D 重写或移除 |
| pages/recycle | 回收站 | BROKEN | 12E 评估 |
| pages/seasoning | 调味品 | BROKEN | 12A 移除(用fridge pantry) |
| pages/orders | 订单 | BROKEN(不属于V4) | 12E 移除 |
| pages/today-menu | 今日菜单 | BROKEN(可能旧fixture) | 12C 重写或移除 |
| pages/family | 家庭管理 | BROKEN | 保留mine内 |

## 9. 后端已实现 vs 待实现

### 已实现
- Auth/WeChat/Family/Settings(GET, PATCH route存在)
- Recipes(list/detail/favorite/rating/wish route存在)
- Meals(current/items/confirm/import route存在)
- Fridge(CRUD)
- Pantry(GET/PUT/DELETE)
- Shopping(generate/current/items/complete)
- Ingredients(search/resolve)

### 待实现
- Recommendation Engine(weekly generate/random-meal/fridge-cook)
- Cooking Sessions(create/complete/inventory consume)
- Meal History(list)
- Kiss Ledger(create/summary)
- KRP Import(parse/validate/confirm)
- Family Recipe CRUD(create/edit/delete/derive)
- Weekly Plan full CRUD(generate/confirm/items/regenerate)

## 10. 数据库 Migration 待新增

- 008: cooking_sessions (可能已在004?需检查)
- 009: kiss_ledger
- 010: recipe_imports
- favorites/ratings/wishes (可能已在003?需检查)
