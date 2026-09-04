# Phase 3 后端执行记录

基线：`27b3fcb51a13558d226b48c72d32c24ef8d94e99`。本地与远端门禁已通过。

## 历史切片：独立 v1 身份/数据库基础

不修改任何 `miniprogram/**`；不切换 Render 启动命令，不连接生产数据库。

1. 先写 Node test runner 测试，确认缺失实现导致失败。
2. 新建 `backend/v1/`：必需环境变量校验、脱敏错误、微信 code2Session 适配器、JWT、事务助手、用户/家庭 repository 和 v1 app。
3. 新建 core migration：仅 users/families/family_members/family_settings；不提前实现菜谱、购物或推荐表。
4. 为真实 PostgreSQL 集成测试提供显式命令；没有测试数据库时必须非零退出，不得假通过。
5. 运行测试、只读保护检查、独立 review，更新 PROJECT_STATE 并 commit/push。

## 环境边界

当前未发现 `DATABASE_URL` / `TEST_DATABASE_URL` / 微信凭据环境变量，也未发现 PATH 上的 PostgreSQL 或 Docker。可以完成独立基础切片，但 A01–A05 的真实数据库集成验收和 A46/A47 不能据此宣称完成。后续使用专用测试库验证，不使用用户旧 database.json。

## 尚未完成

- 全量 schema、45 道菜脱敏 seed、持久化验收。
- 真实 PostgreSQL 两家庭全资源隔离（当前仅家庭域，菜谱/库存等后续域不在本轮）。
- 生产 secret 轮换、旧 JSON 停止跟踪与生产切换。
- 前端 bootstrap 和真实 API 接线（本次完全不改前端）。

## Foundation checkpoint 实现与验证（历史）

- 实现 `backend/v1` 独立入口；现有 server.js、Procfile 和 frontend 全部不改。
- 仅提供已冻结的 auth/wechat、me、me/families；家庭路由只有权限门禁，**没有假装实现 family CRUD**。
- 内部 token 使用 HS256、固定 issuer/audience、1小时过期；不新增 refresh 或其他未冻结 endpoint。上线前仍需审查凭据轮换、限流和撤销策略。
- core SQL 仅 users/families/family_members/family_settings；最后 OWNER 约束将在家庭写服务事务/迁移测试中补齐，目前不可启用家庭写操作。
- 测试先红后绿：缺失实现；CRLF/LF checksum 不一致；rollback 失败未销毁连接，均有对应测试。
- `npm run test:unit`：12通过、0失败、0跳过。
- `npm run test:integration`：本地1失败，原因仅为未设置 TEST_DATABASE_URL；这不是 PostgreSQL 已验证的证据。
- `.github/workflows/backend-v1.yml` 提供 PostgreSQL16 的独立 CI 数据库；push 后再核对实际运行结果。
- 实际 CI：[33839190932](https://github.com/ruide92/our-kitchen-api/actions/runs/33839190932)，commit `508623ef995305fcb6021a94386a33e0e57e372c`，completed/success。PostgreSQL16、npm ci、npm test 均成功，12 unit + 1 core integration 无跳过。覆盖 core migration、重复执行、openid唯一/stable repository、两家庭membership隔离和回滚；不等于所有家庭业务完成。
- review 修正：checksum跨平台一致、rollback失败销毁连接、测试清理finally/连接超时。

事务必须使用同一 checkout client，不能混用 pool.query；参见 [node-postgres transactions](https://node-postgres.com/features/transactions)。

## 运行方式

Reviewer correction: external WeChat variables are exclusively `WECHAT_APP_ID` and `WECHAT_APP_SECRET`. Legacy names are not fallback aliases. start.js retains its internal config-to-client mapping; unit tests reject either missing canonical variable even when legacy variables are present.

使用支持内置 fetch 的 Node 22+。将 `.env.example` 中变量设置到本地环境或受忽略的 `.env`，不要发送凭据到聊天或 Git。

```text
npm ci
npm run test:unit
# TEST_DATABASE_URL 必须指向独立、名称以 _test 结尾的数据库，且不能等于 DATABASE_URL
npm run test:integration
# 只在明确指定的开发库执行；本轮未连接生产
npm run db:migrate
npm run start:v1
```

入口不自动读取 `.env`；可由环境注入或用 `node --env-file=.env backend/v1/start.js` 显式加载。没有配置必须拒绝启动。旧 `npm start` 仍运行旧后端，不能用它验证 v1。

## Family checkpoint（2026-09-04）

环境变量修正 commit：`33919a6ad0c2ac800a9faa0b3a744eec0b164edb`。新增反向测试确认旧变量不能替代新变量；start 内部映射不需另造参数。

新增 endpoints（全部 `/api/v1`）：

- `POST /families`、`POST /families/join`
- `GET/PATCH /families/:family_id`
- `GET /families/:family_id/members`
- `PATCH /families/:family_id/members/:member_id`
- `POST /families/:family_id/invite-code/rotate`
- `GET/PATCH /families/:family_id/settings`
- `PATCH /me`

实现语义：

- create 单事务插入 family、OWNER membership、默认 settings；任一步失败全部 rollback。
- join 仅接受 `invite_code`；随机邀请码轮换后旧码立即失效。ACTIVE 重复加入返回同一 membership；LEFT 重激活为 MEMBER；REMOVED 返回403，不能绕过移除。
- `requireFamilyMember/requireFamilyRole` 为统一路由门禁；所有核心家庭写事务先锁 family `FOR UPDATE`，再重新读取 actor 的 ACTIVE membership/role。
- 最后 OWNER 降级/移除返回409；同家庭所有 role/remove/join 写操作共用 family 锁，防止两名 OWNER 同时自降级后归零。
- 聚合读取持有 family `FOR SHARE` 到提交，避免旧 settings version 与新 cookware 混合。
- family/settings PATCH 使用 `version` 条件更新并+1，过期版本409；cookware 是明确整组 replace，与 settings 同事务。
- member PATCH 精确载荷：`{role:OWNER|ADMIN|MEMBER}` 或 `{status:REMOVED}` 二选一。OWNER-only；不允许任意 status或混合动作。
- profile PATCH 只允许 `nickname,avatar_url`；null 清空；URL仅HTTPS；身份字段/驼峰别名/未知字段400。
- GET family 为 family列 + role + settings；GET settings 为设置列 + cookware。成员偏好/pantry摘要尚未接入对应后续域，不伪造空业务数据；个人偏好写API不在本轮。

本地 unit：16通过。真实 PG family suite 包含17个子场景（包括首次并发join、重复并发join、人工settings触发器失败回滚、两家庭403、权限、两个version409、资料限制、邀请轮换、移除成员、OWNER竞争、settings受控读写交错）。CI结果在执行结束后另记录，不以unit代替。

Review：未发现权限绕过；修正 settings/cookware READ COMMITTED 混合快照风险。所有前端、旧JsonDatabase、legacy routes、Render启动文件均保持不变。

## npm audit 风险记录（不自动修复）

实际执行：`npm audit --json`（npmmirror返回404 NOT_IMPLEMENTED）；`npm audit --json --registry=https://registry.npmjs.org --fetch-retries=0 --fetch-timeout=15000`（本地网络超时）。因此本地网络失败绝不视为0漏洞。

`npm ls qs body-parser express` 核实依赖链：

```text
express@4.22.2 (direct)
├─ qs@6.15.3 (transitive)
└─ body-parser@1.20.6 (transitive)
   └─ qs@6.15.3 (deduped)
```

此前npm报告/缓存的3个moderate是 qs、body-parser、express 三个受影响包节点，不是3个不同根因。公开advisory已核对：

- [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx)：qs bracket-key/comma array-limit bypass，影响6.14.2–6.15.3，修复6.16.0。
- [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g)：qs attacker-controlled isBuffer DoS，修复6.16.0。

Express4.22.2声明 `qs ~6.15.1`，普通lock刷新无法纳入6.16.0。可提出单独checkpoint评估 qs override=6.16.0并回归query/form解析；这超出其原传递版本范围，不能无测试称无破坏。Express5是主版本迁移，本轮不做。未运行npm audit fix/force，未修改依赖版本或lock。

CI增加只读audit输出artifact（允许已知漏洞令audit步骤非零但不遮蔽测试结果）；测试步骤仍严格pipefail。最终以该run输出核对风险数量。

## 当前阻塞：GitHub 身份认证

Family实现本地commit：`6a39392a770c94596a244a99dc6cc8fdf09f060a`。环境变量修正和Family实现均已本地提交，但push卡在Git Credential Manager；禁用交互后的安全重试明确返回 `unable to get password from user`。远端仍为 `ce42ac86600645a7dfd39c0da12dc684b9b55825`。

本轮没有新GitHub Actions run；不得借用上一个foundation的13/13结果作为Family验收。恢复GitHub登录后推送现有commit、等待PostgreSQL CI结束、核对audit artifact，再交Reviewer。未继续后续Phase。
