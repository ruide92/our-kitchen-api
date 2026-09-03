# 《我们家的大食堂》V4 当前实现事实审计

审计日期：2026-09-03  
审计分支：`codex/kitchen-v4`  
基线提交：`8e74014e8f5182cf8c4b97b2513b77eabadf5ec2`

## 1. 审计结论

当前仓库是一个可以启动、拥有较完整页面外壳的原型，但不是一个已经打通核心闭环的家庭厨房系统。主要问题不是单个 Bug，而是四层契约同时漂移：页面调用、`utils/api.js`、Express 路由、JSON 数据字段彼此不一致；同时自制 `JsonDatabase` 无法执行路由中写下的 SQL 语义。

当前适合保留的是原生小程序页面结构、部分 WXML/WXSS、45 道基础菜数据和若干简单工具函数。必须替换或重新定义的是身份认证、密钥、持久化数据库、家庭边界、API 契约、字段模型、测试体系和大部分跨模块业务链。

## 2. 审计范围与证据方法

审计覆盖：

- `miniprogram/app.*`、16 个页面、`miniprogram/utils/api.js`。
- 9 组 Express 路由、认证中间件、`database.js`、`database.json`。
- `package.json`、`package-lock.json`、`Procfile`、`.gitignore`、旧 `test-api.js`、旧交接文档。
- 本地 `main`、远端 `main`、独立工作树和未提交运行数据。

使用的验证：

- `git status`、`git rev-parse`、`git ls-remote`、逐文件 SHA-256 对比。
- `rg` 枚举页面 API 调用、客户端方法、路由和字段。
- `node --check` 检查全部项目 JavaScript 语法。
- `npm ci` 验证锁定依赖可安装。
- 在系统临时目录复制 `database.js` 与数据库后执行隔离语义探针；没有用测试操作修改用户的运行数据库。
- 对既有 Render API 做只读健康、分页、关键词和分类请求。

## 3. Git 与本地现场

| 项目 | 事实 |
|---|---|
| 本地 `main` 与远端 `main` | 审计开始时均为 `8e74014e...` |
| 原始后端工作区 | `database.json` 在审计前已经被修改 |
| 原始运行数据库 | 已单独备份并校验 SHA-256 |
| V4 开发 | 位于隔离工作树和 `codex/kitchen-v4` 分支 |
| 桌面原生前端与仓库前端 | 71 个文件，逐文件哈希差异 0 |
| 旧桌面前端目录 | `我们的小厨房-小程序` 仅 11 个文件，应视为旧副本，不能继续作为开发源 |

结论：仓库内的 `miniprogram` 是后续唯一前端代码源；不得在三个目录之间人工复制代码。

## 4. 功能真实状态

| 领域 | 当前状态 | 证据结论 |
|---|---|---|
| 健康检查 | 真实可用 | 本地与线上 `/api/health` 返回 200 |
| 基础菜列表 | 部分可用 | 能返回 45 道菜，但搜索、分页、懒人过滤、总数错误 |
| 菜品分类 | 前端不可用 | 后端返回字符串数组，前端读取 `c.name`，产生 `undefined` |
| 菜品详情 | 部分可用 | 基础 GET 存在，但字段模型与详情页预期不一致，图片为空 |
| 登录 | 原型可响应，生产不可接受 | 任意 code 经 MD5 生成 fake openid，没有微信校验 |
| 家庭创建/加入 | 部分或不可用 | 自动建家庭、手动建家庭字段/角色不一致；加入参数名不一致 |
| 家庭权限 | 不安全 | 角色大小写漂移；普通成员可刷新邀请码 |
| 本周菜单 | 数据错误 | JOIN 和家庭别名条件不执行，49 项均缺菜名/图片，存在跨家庭读取风险 |
| 本餐菜单/今日菜单 | 只有页面 | 页面调用的方法、客户端方法、后端路由和正式表均不完整 |
| 随机点餐 | 只有页面 | `recommend-random` 后端不存在；WXML 还调用不受支持的 `includes()` |
| 收藏 | 读取部分可用 | 页面写操作调用不存在的 `addFavorite/removeFavorite` |
| 评分 | 不可用 | 列表方法缺失，页面 `score` 与后端 `rating` 不一致 |
| 菜谱新增/编辑/删除 | 只有页面和客户端声明 | `POST /dishes/custom`、PATCH/DELETE `/dishes/:id` 均无后端路由 |
| 冰箱 | 部分读取，写入字段错误 | 前端 `amount/expiry`，后端 `quantity/expire_date`；更新解析器失效 |
| 购物清单 | 核心闭环不可用 | 生成/完成方法名缺失，勾选状态模型漂移，库存累加 SQL 无效 |
| 调味品 | 后端原型存在，页面不可用 | 页面使用 Seasoning 方法名，客户端导出 Condiment 方法名 |
| 做饭模式/完成扣库存 | 只有入口概念 | `startCooking` 不存在，没有 cooking session 或扣库存闭环 |
| 么么哒 | 只有展示概念 | 没有账本、授予流程、家庭历史和权限 |
| AI 菜谱导入 | 只有页面雏形 | `importRecipe` 不存在，没有 KRP 服务端解析/校验/预览/保存 |
| 回收站 | 只有页面 | 客户端和后端能力缺失 |
| 厨房设置/统计 | 只有 UI | `getStats/updateKitchen/inviteMember` 等页面调用未定义 |
| 分享广场 | 未实现 | 只应在 V4 数据模型留扩展边界 |

## 5. 前端 API 契约断裂

页面中实际使用 45 个业务 API 方法，以下 21 个页面调用在 `utils/api.js` 没有对应定义（排除路径字符串误识别出的 `api.js`）：

```text
addFavorite
addSeasoning
addToTodayMenu
completeShopping
deleteRecycle
deleteSeasoning
generateShoppingList
getRatings
getRecycle
getSeasonings
getStats
getTodayMenu
importRecipe
inviteMember
removeFavorite
removeFromTodayMenu
restoreOrder
restoreRecycle
startCooking
updateKitchen
updateSeasoning
```

其中同时存在“客户端已经声明、后端没有路由”的接口：

| 客户端声明 | 后端状态 |
|---|---|
| `POST /dishes/custom` | 不存在 |
| `PATCH /dishes/:id` | 不存在 |
| `DELETE /dishes/:id` | 不存在 |
| `POST /dishes/recommend-random` | 不存在 |

关键页面级冲突：

- `miniprogram/pages/menu/menu.js:35` 把分类字符串当成 `{name}`。
- `miniprogram/pages/index/index.js:50-51` 用仅含成功消息的“重新生成”响应覆盖完整周菜单。
- `miniprogram/app.js:88` 发送 `{code}`，`routes/family.js:86` 读取 `{inviteCode}`。
- `miniprogram/pages/detail/detail.js:133` 使用 `score`，后端评分读取 `rating`。
- 首页、详情、今日菜单、随机页面都调用不存在的 `addToTodayMenu`。
- `miniprogram/pages/orders/orders.js` 发送 `filter`，后端读取 `date/status`；前端状态展示与后端小写状态值不一致。

## 6. 字段模型漂移

| 概念 | 当前不同命名 |
|---|---|
| 辣度 | `spiciness` / `spicy_level` |
| 健康度 | `healthiness` / `health_score` |
| 么么哒建议值 | `kiss_level` / `kiss_reward` / V4 `suggested_kiss` |
| 厨具 | `cookware` / `equipment` |
| 数量 | `quantity` / `amount` |
| 到期日 | `expiry` / `expiry_date` / `expire_date` |
| 存放位置 | `location` / `storage_location` |
| 购物勾选 | `checked` / `is_bought` |
| 家庭邀请码 | `code` / `inviteCode` / `invite_code` |
| 评分 | `score` / `rating` |

`ingredients` 也存在结构冲突：数据库是平面数组并用 `type` 区分，详情页部分逻辑期待 `main/side/seasoning` 分组对象。Phase 2 必须冻结唯一的传输结构，页面展示分组只能在视图模型中派生。

## 7. JsonDatabase 隔离语义验证

隔离探针结果：

```json
{
  "pageItems": 45,
  "keywordItems": 45,
  "countTotal": "undefined",
  "joinItems": 49,
  "joinMissingNames": 49,
  "updateExpressionChanges": 0,
  "coalesceChanges": 0
}
```

对应根因：

- `database.js:60-115` 只支持极少量简单条件，不支持字面量比较、`OR`、括号、`!=`、表别名。
- `database.js:173-179` 的 LIMIT 正则只接受写死数字，不接受 `LIMIT ? OFFSET ?`。
- `SELECT COUNT(*) AS total` 不进行聚合或字段投影，`total` 为 `undefined`。
- `FROM weekly_menu wm JOIN dishes...` 只识别第一个 `FROM` 表，不执行 JOIN。
- `wm.family_id = ?` 不能被条件解析器识别，因此周菜单没有实际家庭过滤。
- `SET` 使用逗号直接切分，破坏 `COALESCE(?, field)`。
- `quantity = quantity + ?` 不受更新解析器支持。
- 每次写操作同步重写整个 JSON 文件，无事务、锁、原子替换或并发控制。

结论：禁止继续修补该 SQL 模拟器。它只能作为待迁移的旧数据读取来源。

## 8. 家庭边界与权限风险

### P0：周菜单跨家庭风险

周菜单查询使用 JOIN 和 `wm.family_id`，两者都不受数据库实现支持。当前提交数据只有一个家庭，所以尚未在现有数据中观察到两个家庭互相可见；但代码路径会返回全表，第二个家庭一旦拥有菜单就会形成真实泄露。

### P0：身份可伪造

- `routes/auth.js:21-24` 没有调用微信 `code2Session`。
- `middleware/auth.js:4` 使用已公开的固定 JWT 密钥。
- 固定密钥有效期 365 天，仓库又提交了可用于构造令牌的用户标识。

旧密钥必须视为已经泄露。Phase 3 上线前必须轮换，并从环境变量读取；生产环境不得提供 fake-login 回退。

### P1：角色不一致

- 自动创建家庭写 `created_by` 和 `OWNER`。
- 手动创建家庭写 `owner_id` 和 `owner`。
- 改名权限只接受小写 `owner/admin`。
- 刷新邀请码接口只检查成员身份，没有 OWNER/ADMIN 权限。

Phase 2 将角色固定为 `OWNER | ADMIN | MEMBER`，并为每个写接口明确最小权限。

## 9. 数据、隐私与持久化

- `database.json` 被 Git 跟踪，提交内容不是纯 seed：包含 1 个用户、1 个家庭、1 条成员关系、49 条周菜单、1 条点菜、1 条收藏和 5 条调味品记录。
- 原始桌面运行库当前包含更多本地运行记录，已在 Phase 0 单独备份，不能提交。
- 45 道菜可以清洗后迁移为公开基础菜 seed；用户、家庭、邀请码和行为数据不得进入 seed。
- Render 容器本地 JSON 不能作为 V4 持久化方案。Phase 3 使用 PostgreSQL、migration、事务、约束、索引和测试数据库。

## 10. 图片与 UI 现状

- 45 道菜的 `image_url` 非空数量为 0。
- 仓库没有 `data/images` 菜品资源。
- 旧文档所称“图片问题已修复”只修了字段映射，没有图片资产。
- 当前首页具有家庭头部、快捷入口和周菜单的大致轮廓，但数据字段、双头像、加入本餐菜单及底部已点菜单都未形成可信实现。
- Phase 2.5 必须使用与冻结 API 同形的显式 fixture，并在微信开发者工具真实编译、运行、截图；fixture 结果不得被描述为多人业务已经完成。

## 11. 测试与工程化

- `package.json` 只有 `start` 和 `dev`，没有 `test`、lint 或 CI。
- `test-api.js:9-17` 捕获失败后返回 `null`，不抛错，也不设置失败退出码。
- `test-api.js:284-294` 无条件打印所有模块“全部通过”。
- 测试会写固定的本地 3001 服务，只清理部分冰箱/购物数据，遗留家庭、菜单、订单、收藏和调味品。
- `Procfile` 仅能启动 `node server.js`，缺少迁移、部署 smoke test、Node 版本约束和监控。

因此旧测试结果全部不作为验收证据。Phase 3 前先建立：

- 单元测试。
- 数据库/迁移测试。
- API contract 测试。
- 家庭隔离集成测试。
- 食材标准化和单位换算测试。
- 购物计算测试。
- 推荐规则测试。
- 失败时非零退出的 CI。

## 12. 基线验证结果

| 检查 | 结果 |
|---|---|
| `npm ci` | 通过，安装 99 个依赖包 |
| 项目 JavaScript `node --check` | 34 个文件，0 个语法失败 |
| `git diff --check`（Phase 0 文档） | 通过 |
| 线上健康接口 | 200 / `ok` |
| 线上 `pageSize=1` | 错误返回 45 项 |
| 线上关键词“番茄” | 错误返回 45 项 |
| 图片数据 | 45 道菜，0 个有效 `image_url` |
| 自动化测试基线 | 不存在可信测试命令 |

语法通过只证明 JavaScript 可解析，不证明页面可编译或业务正确。微信开发者工具编译属于 Phase 2.5 的强制验收。

## 13. Phase 2 冻结决策输入

Phase 2 必须先锁定以下内容，之后禁止边实现边猜字段：

1. PostgreSQL 数据模型、家庭作用域、角色权限和软删除策略。
2. 公共基础菜谱与家庭版本的优先级和版本记录。
3. 结构化食材、步骤、媒体、别名与安全单位换算。
4. 本周计划、本餐菜单和“谁点的”的明确边界。
5. 冰箱、常备调味品、购物生成、购入冰箱和做饭扣库存的事务边界。
6. 唯一 HTTP method/path/request/response/error contract。
7. KRP v2 的推断字段、校验、预览、编辑和确认入库。
8. 周计划与随机点餐共用的约束推荐核心。
9. 25 项 V4 核心验收测试及 UI 两轮验收证据格式。

## 14. 优先级

### P0

- 冻结数据模型/API/家庭边界。
- 移除公开运行数据和硬编码密钥；轮换泄露密钥。
- 迁移 PostgreSQL，禁止继续扩展 JsonDatabase。
- 真实微信身份与服务端家庭成员校验。
- 修复跨家庭查询和写入授权。
- 建立可信测试与 CI。

### P1

- 公共菜谱/家庭版本、结构化食材和步骤。
- 本餐菜单、多人点菜、冰箱、调味品、购物与库存闭环。
- 首页契约 fixture 及第一轮 DevTools UI 验收。

### 后续

- 约束随机推荐、周计划、KRP、么么哒、分享广场和高级做饭模式按 V4 路线图逐步交付，不提前抢占 P0。
