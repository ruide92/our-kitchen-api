# 《我们家的大食堂》V4 实施路线图

状态：Normative / Phase 2 Freeze

目标：避免“所有页面一起写、接口边写边猜、最后统一修”。每阶段必须有清晰输入、输出、测试和 checkpoint。

## 1. 角色分工原则

项目可以使用不同 AI，但必须共享同一 Git 分支/规格，不允许每个 AI 建一套自己的产品逻辑。

### ARCHITECT / REVIEWER

负责：产品规格、数据模型、API contract、复杂算法、独立审查。

### PRIMARY ENGINEER（Codex 或等价强工程模型）

优先负责高风险：

- PostgreSQL / migrations / transaction
- 微信 code2Session / auth / secret
- family membership / authorization
- canonical ingredient 与单位引擎
- shopping calculation
- cooking inventory transaction
- recommendation engine
- KRP parser/validator
- 跨模块 integration

### ASSIST ENGINEER（豆包/露娜等）

只能在规格冻结后承担明确、低风险、可验收的任务：

- 代码/字段扫描
- fixture/mock 数据
- 按参考图实现单页 WXML/WXSS（不得改业务 contract）
- 已定义 API client wrapper 的机械实现
- 组件提取、样式统一
- 简单 CRUD 页面
- 测试 case 初稿
- seed 清洗辅助
- 文档/日志整理

**ASSIST ENGINEER 禁止自行决定**：数据库 schema、登录方案、family scope、字段改名、购物算法、推荐算法、KRP schema、安全策略、merge main。

如果辅助模型提出架构改变：只记录 proposal，不实施，交 Reviewer 决定。

## 2. Git 规则

工作分支：`codex/kitchen-v4`。

main 不直接开发，不 force push，不自行 merge。

每一可验证 slice：

`实现 → 测试 → PROJECT_STATE → commit → push`

不同 AI 接手前必须先：

1. `git status`
2. `git pull --ff-only`
3. 读 `PROJECT_STATE.md`
4. 读本任务涉及的规范文件

不得只靠聊天上下文接着做。

## 3. Phase 0 — 保护现场（DONE）

输出：

- 基线 SHA
- 独立工作树/工作分支
- 运行数据库备份
- 本地/远端一致性证据
- PROJECT_STATE

不得修改业务代码。

## 4. Phase 1 — 事实审计（DONE）

输出：`AUDIT_CURRENT_STATE.md`。

已确认主要问题：API 契约断裂、JsonDatabase 语义不匹配、fake openid、secret、家庭风险、核心页面壳等。

## 5. Phase 2 — 规格冻结（CURRENT）

输出：

- PRODUCT_SPEC_V4.md
- DATA_MODEL_V4.md
- API_CONTRACT_V4.md
- KRP_V2_SPEC.md
- RECOMMENDATION_ENGINE.md
- ACCEPTANCE_TESTS.md
- IMPLEMENTATION_ROADMAP.md

完成条件：四向交叉检查 Product ↔ Data ↔ API ↔ Tests，无核心概念字段漂移。

Phase 2 不改业务代码。

## 6. Phase 2.5 — 首页第一次 UI 验收

目的：先锁定用户真正认可的页面视觉，不等待高风险后端完成。

### 6.1 输入

- 用户最终首页参考图
- PRODUCT_SPEC 首页章节
- API_CONTRACT 首页 fixture 形状

### 6.2 实现

使用显式 `fixture/mock`：

- 家庭头部
- 四个紧凑快捷入口
- 本周菜谱（突出今天）
- 早/中/晚餐
- 一键加入本餐菜单的 UI 行为（fixture state）
- 已点菜单 + 谁点的
- 五 Tab

禁止为了“跑起来”接 legacy 错误 API。

### 6.3 可交给辅助模型吗？

可以，但仅作为 UI 实现者。给它一个单独任务：只改首页相关 WXML/WXSS/fixture/view-model，不改 api contract/后端/数据库；每次完成必须真实 DevTools 截图。若参考图偏离，写 UI_DEVIATIONS。

由于用户曾对辅助模型 UI 结果不满意，**首页不能由辅助模型自我验收**。必须用户/Reviewer 看截图通过。

### 6.4 完成证据

- 微信开发者工具真实编译成功
- iPhone 14/15 比例截图
- 与参考图逐项对照
- A41 通过

未通过不进入“其他页面批量 UI”。

## 7. Phase 3 — P0 基础设施

Primary Engineer 优先。

### 3A PostgreSQL

- 选 Node `pg` 等纯 JS client
- migration runner
- test DB
- schema/constraints/indexes 按 DATA_MODEL
- 45 基础菜 seed 清洗
- 旧 runtime user/family 不 seed

测试：A46/A47。

### 3B 安全配置

- `.env.example`
- JWT_SECRET 轮换
- WECHAT_APPID/WECHAT_SECRET env
- DATABASE_URL env
- 移除/停止跟踪 runtime DB（保留 migration source/备份，不误删用户本地文件）

测试 A45。

### 3C 微信登录

- `/api/v1/auth/wechat`
- code2Session adapter（test mock + production real）
- stable user
- bootstrap promise/state

测试 A01。

### 3D Family

- create/join/members/roles/settings
- service-side authorization middleware
- two-family integration tests

测试 A02–A05。

### 3E API foundation

建立 v1 router、统一 response/error、request validation、transaction helpers。

Phase 3 完成后才可把首页 fixture 切真实 identity/family skeleton。

## 8. Phase 4 — 菜谱资产

### 4A Ingredient dictionary

- ingredients / aliases / units
- normalization service
- autocomplete/resolve API
- initial aliases（番茄/西红柿等）

测试 A14/A15。

### 4B Recipe storage/read

- BASE + FAMILY scope constraints
- recipe detail flat ingredients
- steps/media/nutrition
- list/search/pagination

测试 A06/A11/A12。

### 4C 家庭版本

- derive
- edit with version
- soft delete/restore
- family sharing

测试 A08–A10。

### 4D 前端

菜单页、详情页、编辑页按 UI reference。辅助模型可以在 API 已冻结/后端已通过 integration 后做 UI wiring；不得自行另造 endpoint。

## 9. Phase 5 — 核心家庭点餐闭环

这是 V4 最重要的业务阶段。

### 5A Meals

- current meal ensure
- meal items
- selected_by
- weekly import
- confirm snapshot

测试 A30/A31。

### 5B Fridge / Pantry

- batch inventory
- expiry
- pantry staples
- inventory movements

测试 A21/A43。

### 5C Shopping Engine

实现服务：

`meal recipes → servings scale → canonical → unit normalize → aggregate → fridge deduct → pantry deduct → missing`

测试 A13–A20。

此任务不可交辅助模型自行设计；可以让辅助模型根据已定算法写部分单元测试/CRUD UI。

### 5D Shopping completion

事务入冰箱，批次/保质期不丢失。

### 5E Cooking

session + frozen steps + confirmed consumption + transaction COOK_OUT。

测试 A32/A33。

### 5F 首页第二轮业务验收

把 Phase 2.5 fixture 替换真实 `/api/v1` 数据；A42 通过。

## 10. Phase 6 — 周计划与推荐

Primary Engineer 实现推荐 core，严格按 RECOMMENDATION_ENGINE。

### 6A History + scoring

- completed meal history
- repeat penalty
- rating/favorite/wish
- inventory/expiry

### 6B Meal composition

- slots
- marginal diversity
- hard allergen filters
- deterministic seed tests

### 6C Weekly plans

- DRAFT generation
- confirm transaction
- lock/regenerate

### 6D Random meal

- BALANCED
- USE_INVENTORY
- TRY_DIFFERENT
- locked reroll

测试 A22–A29。

### 6E 看冰箱做菜 / 一人菜

复用同一 engine profile，不开新算法。

## 11. Phase 7 — AI KRP

Primary Engineer：parser/validator/confirm transaction。

辅助模型可协助：Recipe Skill 文案、KRP fixtures、错误样本，但不能擅自改 schema。

输出：

- `skills/kitchen-recipe-import/SKILL.md`
- parser
- validator
- preview model
- import UI
- confirm

测试 A36–A40。

AI 图片只做 media/prompt 支持，不因对象存储问题阻塞 KRP 文本核心。

## 12. Phase 8 — 家庭体验

- 正式厨房设置
- 家庭合影/头像模式
- 收藏/评分/我想吃
- 么么哒 ledger/summary
- 点菜/做饭历史
- 大字做饭模式基础
- 保质期 UI

辅助模型适合已确定数据/API 的多数前端页面，但每页需要截图/业务验收，不允许“页面完成=功能完成”。

## 13. Phase 9 — 扩展骨架

核心稳定后：

- 分享广场最小公开/复制
- 我的分享
- activity log UI
- 数据导入导出
- AI 图片资产
- 多厨房切换

宝宝辅食/老人餐继续 Roadmap，不抢核心。

公开社区上线前必须另做内容安全、隐私、版权、举报/审核设计 Review。

## 14. Phase 10 — 上线前验收

- 全自动测试
- 微信 DevTools 编译
- 两个真实体验用户同家庭流程
- 第二测试家庭隔离
- Render/新部署环境数据库持久化验证
- secrets 检查
- request 合法域名
- 体验版回归

没有证据不得宣布 V4 完成。

## 15. 豆包参与的安全清单

如果用户希望在 Codex 无额度期间继续施工，豆包一次只给一个 slice，指令必须包含：

**允许修改文件范围**、**禁止修改范围**、**验收命令/截图**、**commit message**。

推荐先后：

1. Phase 2.5 首页 fixture UI（可做，但截图必须外部验收）。
2. 规范化 UI 组件/图标/空状态（首页通过后）。
3. API client wrapper 按 contract 机械编写（Reviewer 对照检查）。
4. 简单 settings 表单页面（后端 contract 已实现后）。
5. 测试 fixture 数据和非关键测试初稿。

不要交豆包独立完成：

- “把整个 V4 做完”
- “自己研究最佳数据库然后改”
- “把登录修好”
- “把购物清单算法修好”
- “把推荐做智能”
- “看着哪里不对自己优化”

这些开放式指令正是旧项目失控的来源。

## 16. 每个辅助模型任务模板

后续给辅助模型的任务应类似：

> 你只执行 TASK-X。先读 PRODUCT_SPEC_V4 的相关章节和 API_CONTRACT_V4。允许修改 A/B/C 文件，禁止修改 server/database/auth/API contract。完成后运行指定检查、DevTools 截图，更新 PROJECT_STATE 的 task 子项，commit + push。发现规格冲突立即停止并报告，不自行决定新字段/新接口。

## 17. 停止条件

遇到以下情况立即停当前 slice：

- 需要新增规范外字段/endpoint。
- 数据模型无法满足需求。
- 家庭权限不清楚。
- 测试与产品规格互相矛盾。
- git 工作树出现非本任务来源的未提交修改。
- 需要修改 main/force push。

先由 Reviewer 处理，不让施工模型“顺手解决”。
