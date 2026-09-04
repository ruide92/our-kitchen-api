# 《我们家的大食堂》V4 验收测试

状态：Normative / Phase 2 Freeze

原则：一个功能只有在对应测试通过、失败会产生非零退出码、且测试验证真实业务结果时才能标记 DONE。页面存在、HTTP 200、控制台无报错都不等于完成。

## 1. 测试层级

### Unit

- 食材名称归一
- 单位换算
- 购物缺失量计算
- 推荐评分/硬过滤
- 份量缩放
- KRP parser/schema validation

### API integration

使用真实测试数据库、迁移和事务；每个 case 独立 family fixture。

### Mini Program contract

静态检查页面 `api.xxx` 均有客户端定义，客户端 endpoint 均在 API contract/后端存在；字段不得出现旧同义词漂移。

### WeChat DevTools UI

Phase 2.5 首页真实编译、运行、截图；后续关键页面逐步增加。

## 2. 全局测试规则

- 测试失败 `exit code != 0`。
- 不允许 catch 后继续打印“全部通过”。
- 测试数据不得写用户当前 `database.json`。
- PostgreSQL integration 使用单独 test DB/schema，并在 case 前后清理。
- 推荐测试支持固定 random seed。
- 每个 family isolation test 至少同时创建两个家庭。

## 3. A01 — 微信身份稳定

步骤：

1. mock 微信 code2Session 第一次 code-A → openid-X。
2. 登录得到 user-X。
3. 第二次 code-B → 同一 openid-X。
4. 再登录。

期望：`user.id` 相同；系统不使用临时 code hash 作为 openid。

生产配置缺 WECHAT_APP_SECRET 时必须 fail closed，不允许 fake-login fallback。

## 4. A02 — 创建家庭

用户 A `POST /api/v1/families`。

期望：

- family 创建成功。
- family_members 有且仅有 A ACTIVE membership。
- role=`OWNER`。
- default family_settings 同事务创建。

## 5. A03 — 邀请家庭成员

A 获取 `invite_code`；B `POST /api/v1/families/join` 请求只使用 `invite_code`。

期望：A/B 都能在 `/me/families` 看到同一 family；B 默认 MEMBER。

重复接受同一家庭邀请不得重复插 membership。

## 6. A04 — 家庭权限

MEMBER 尝试移除 OWNER 或轮换受限操作。

期望：403。

OWNER 执行允许操作成功。

最后一个 OWNER 不能被删除/降级导致家庭无 OWNER。

## 7. A05 — 家庭数据隔离

创建 family-A、family-B：

- A 冰箱有五花肉。
- A 有家庭红烧肉版本。
- A 有晚餐菜单和购物项。

B 请求所有对应 family-B endpoint。

期望：不出现 A 的任何行。

B 直接访问 `/families/family-A/...` 期望 403，而不是靠前端隐藏。

## 8. A06 — 菜品分类不再 NULL

GET recipe list/categories（若实现 category dictionary endpoint）并在小程序菜单页渲染。

期望：分类 code/display 均有效；无 `null/undefined`；不得再把字符串当 `{name}`。

## 9. A07 — API 静态契约

扫描 `miniprogram/pages/**/*.js` 所有 `api.<method>`：

- 每个方法在 V4 client wrapper 中定义。
- 每个 wrapper 指向 API_CONTRACT_V4 中 endpoint。
- 后端 route 存在。

任何缺失测试失败。

额外 grep 禁止 V4 业务代码继续出现旧字段：`spicy_level, health_score, kiss_reward, expire_date, is_bought, inviteCode`（迁移脚本/legacy adapter 可白名单）。

## 10. A08 — 公共菜谱不可被家庭修改

家庭 MEMBER 对 BASE recipe PATCH/DELETE。

期望：403/422。

点击“改成我家的做法”调用 derive 后生成新的 FAMILY recipe；BASE 内容不变。

## 11. A09 — 家庭版菜谱共享

A/B 同 family。

A 从 BASE 红烧肉 derive；删除白糖并保存 version=1→2。

B GET 该 FAMILY recipe。

期望：无白糖；version=2；updated_by=A。

另一个 family C 浏览 BASE：白糖仍按 BASE 原数据存在。

## 12. A10 — 家庭菜谱并发冲突

A、B 同时读取 FAMILY recipe version=2。

A PATCH version=2 成功 → version=3。

B 用旧 version=2 PATCH。

期望：409，不静默覆盖 A 修改。

## 13. A11 — 结构化食材

recipe detail `ingredients` 必须是平面数组，每项含 `type`；前端可分组显示 MAIN/SIDE/SEASONING/GARNISH。

不得后端返回一套 grouped object、另一个页面期待 flat array。

## 14. A12 — 图文步骤兼容

Recipe 1：步骤只有文字、media=[]。

Recipe 2：至少一图片 media。

详情/做饭页两者正常渲染；无图不出现破损占位；有图正确显示。

## 15. A13 — 份量缩放

基础 2 人份五花肉 200g，meal diners_count=4。

期望计算需求 400g。

`适量`/TEXT 单位不强制变成虚构克数。

## 16. A14 — 食材别名

标准 ingredient=tomato，aliases 包含“番茄/西红柿”。

冰箱：西红柿 3 piece。

菜谱：番茄 2 piece。

购物计算：missing=0，不产生番茄购物项。

## 17. A15 — 单位换算

菜 A 猪肉 200g；菜 B 猪肉 0.3kg。

期望合并为 500g（或 0.5kg，标准基准一致即可）。

`2 piece` 不得与 `200g` 在无 conversion mapping 时瞎合并数值。

## 18. A16 — 合并后减库存

两菜猪肉合计 500g；冰箱同标准猪肉 200g。

期望购物 missing=300g，response 计算证据显示 required=500/inventory_deducted=200。

## 19. A17 — 常备调味品抵扣

盐 `assume_available=true`；三道菜都需要盐。

期望购物清单没有 GENERATED 盐项。

若用户家庭版本已经删除白糖，则无论 BASE 是否含糖，购物不得出现糖。

## 20. A18 — 购物生成幂等

对同一 meal 连续两次 `shopping-lists/generate` mode=REPLACE_GENERATED。

期望 GENERATED 项不重复翻倍；用户 MANUAL 项保留。

## 21. A19 — 购物多人同步

A 将购物 item `is_purchased=true`。

B 重新 GET 当前 shopping list。

期望 B 看到 true；状态不依赖 A 手机 local checkedMap。

## 22. A20 — 购买完成入冰箱

冰箱番茄 batch=2 piece；购物番茄 purchased_quantity=3 piece。

complete 后：

- 兼容批次策略允许时库存总可用量=5 piece。
- 写 `PURCHASE_IN` inventory movement。
- 未勾选项不入库。
- shopping list → COMPLETED。

事务中任一步失败必须回滚。

## 23. A21 — 不同保质期库存批次

已有牛奶 expiry 09-04，新购买 expiry 09-10。

complete 后允许两个 fridge batch，不得为了“去重”丢失批次有效期。

购物计算总可用量可跨兼容 batch 汇总，并按快过期优先消耗策略扣减。

## 24. A22 — 周计划 GET 不隐式生成

不存在该周 plan，GET weekly-plans。

期望 `data:null`，数据库无新行。

只有 generate endpoint 创建 DRAFT。

## 25. A23 — 周计划持久化

生成 DRAFT → confirm ACTIVE。

应用退出/重新加载再次 GET。

期望相同 plan/items，不重新随机。

## 26. A24 — 周计划草稿不会直接覆盖

已有 ACTIVE plan-A。

调用 regenerate 得 DRAFT plan-B。

未 confirm 前 GET active 仍为 plan-A。

confirm B 后 A→ARCHIVED，B→ACTIVE，事务成功。

## 27. A25 — 锁定

ACTIVE/DRAFT 中锁定红烧肉，regenerate MEAL。

期望新 DRAFT 仍含同一锁定 recipe；其他未锁定项可替换。

若 target_count < locked count 返回 422。

## 28. A26 — 防重复

历史 3 天前吃过辣椒炒肉；候选中有足够替代。

BALANCED 固定 seed 下验证辣椒炒肉获得强重复惩罚；TRY_DIFFERENT 惩罚更强。

不要只测试“最终恰好没抽中”，同时断言 score/reason 或内部规则输出。

## 29. A27 — 营养组合基本合理

候选充足时生成晚餐 3 道。

期望：

- 不全是纯主要肉菜。
- 不全部同一 protein_source。
- 不全部同一重烹饪方式。
- 硬过敏菜不存在。

这是家庭日常均衡规则，不验证医疗营养结论。

## 30. A28 — 随机不是纯随机

同一候选池设置：某食材明天过期。

运行大量固定 seeds 比较 BALANCED 与 USE_INVENTORY。

期望 USE_INVENTORY 选择相关菜谱的比例显著更高；规则统计阈值在测试中固定，避免偶然性。

## 31. A29 — 随机锁定重摇

random-meal locked_recipe_ids=[红烧肉]，target=3。

连续 reroll：每次必须包含红烧肉；其余两道可变化。

## 32. A30 — 本餐与周计划分离

周三晚餐计划有 A/B/C。

用户只 import A/B 到 meal，再手工加 D。

期望：meal items=A/B/D；weekly plan 仍 A/B/C，互不偷偷同步覆盖。

## 33. A31 — 谁点的

用户 B 向 meal 加辣椒炒肉。

服务端 `selected_by_user_id` 必须取 Token 的 B，不接受请求冒充 A。

用户 A GET meal 能看到 selected_by=B 的成员摘要。

## 34. A32 — 做饭前不扣库存

打开详情、进入 meal、confirm、启动 cooking session 前后检查库存。

开始做饭之前库存不变；仅 complete cooking 后按确认 consumption 扣减。

## 35. A33 — 做饭完成事务

确认消耗猪肉 180g、青椒 100g。

complete 后：

- inventory movements 两条 COOK_OUT。
- 对应 batch 数量正确。
- meal COMPLETED。
- session COMPLETED。

若青椒库存不足且用户未确认调整，返回 422、所有库存均不扣。

## 36. A34 — 收藏/评分/我想吃语义分离

同一用户可以 Favorite=true、Wish=ACTIVE、Rating=5，各自独立取消；取消收藏不能删除 rating/wish。

家庭喜爱度可从 ratings 聚合，不从么么哒直接推导。

## 37. A35 — 么么哒账本

A 做饭，B 给 A 5 💋。

期望：

- from_user=B（取 Token）
- to_user=A
- family/meal/recipe 正确
- actual_amount=5
- summary 聚合增加 5

自己给自己送、跨家庭送均被拒绝。

## 38. A36 — KRP v2 正常导入

输入合法 KRP：parse → validate → preview/edit → confirm。

期望生成 FAMILY recipe，`source_type=KRP_IMPORT`，ingredients/steps 完整，recipe_import status=IMPORTED。

## 39. A37 — KRP 推断字段提示

KRP 有 `/ingredients/2/quantity` inferred。

parse response 必须保留并在预览 view model 标记；不能静默当原作者明确数据。

## 40. A38 — KRP 非法包

测试：错误 JSON、schema 1.0、无 recipe.name、ingredient type 非法。

期望 VALIDATED 失败，confirm 不允许写 recipe。

## 41. A39 — 营养不伪造

KRP/菜谱没有可靠营养数值时 `nutrition.status=TAG_ONLY/UNKNOWN`，精确 kcal/protein 字段 null。

UI 不展示虚构精确数字。

## 42. A40 — 传统食养分离

传统 tag 存在时，只展示在传统食养区域；不出现在现代 nutrient 数值表，不产生治疗疾病文案。

## 43. A41 — 首页 Phase 2.5 视觉验收

使用与 API_CONTRACT 同形 fixture，微信开发者工具真实编译/运行并截图。

必须人工对照确认：

- iPhone 14/15 纵向手机比例正常。
- 顶部家庭头像/合影 + 厨房名称。
- 四个紧凑快捷入口。
- 本周菜谱为视觉核心、突出今天。
- 早餐/午餐/晚餐及“一键加入本餐菜单”。
- 下部已点菜单，显示谁点的。
- 五个 Tab。
- 暖米白、绿色主操作、粉色情感提示、紧凑圆角卡片。
- 无资讯流、广告式模块、大型随机区域。

截图路径/证据写 PROJECT_STATE；明显偏离先修，不进入下一阶段。

## 44. A42 — 首页第二轮真实业务验收

Phase 3+ 接真实 API 后重复首页测试：

- A/B 同家庭看到同一周计划。
- B 点菜后 A onShow/刷新看到。
- selected_by 正确。
- 重启数据不丢。
- family C 看不到 A/B 数据。

第一轮 fixture UI 验收不能替代此测试。

## 45. A43 — 快过期

冰箱 item expiry=明天。

期望 fridge 标为 expiring；USE_INVENTORY 推荐相关 recipe 加分。已过期库存不算可用量。

## 46. A44 — 一人菜

`diners_count=1` / single-person profile 下，在候选充足情况下相比普通模式优先短时间、少食材、易缩放菜；份量计算按 1 人。

## 47. A45 — 敏感配置

自动扫描仓库：

- 不含真实 `WECHAT_APP_SECRET/JWT_SECRET/DATABASE_URL`。
- `.env` 未跟踪。
- 运行时用户/家庭 JSON 不再作为正式数据库提交。
- `.env.example` 只有占位变量。

## 48. A46 — PostgreSQL migration

空数据库执行所有 migrations + seed 成功；重复启动不重复 seed；45 道可清洗菜进入 BASE recipes；不导入旧测试 user/family/invite 行。

## 49. A47 — 关键索引/约束

integration 验证：

- openid unique
- family membership unique
- meal family+date+type unique
- ACTIVE weekly plan uniqueness
- BASE/FAMILY recipe scope CHECK
- pantry staple family+ingredient unique

数据库约束失败应转换成明确 API 409/422，不泄露 SQL stack 给客户端。

## 50. A48 — Legacy 数据不参与新业务

V4 页面网络请求只走 `/api/v1`；旧 `/api` 可以在迁移期间用于旧页面/只读检查，但 V4 完成页面不得依赖它。

## 51. A49 — 错误测试不得吞掉

人为让一个 API assertion 失败。

测试进程必须非零退出，CI/本地 runner 显示失败；禁止最终仍打印“全部通过”。

## 52. 完成门槛

Phase 标记完成前至少：

- 该 phase 对应 tests 全过。
- `git diff --check` 通过。
- JS/JSON/SQL migration 基础语法/执行检查通过。
- PROJECT_STATE 更新真实结果与未通过项。
- commit + push 工作分支。
- 不把未实现功能写成 DONE。
