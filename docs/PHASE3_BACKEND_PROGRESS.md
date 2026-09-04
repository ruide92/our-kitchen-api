# Phase 3 后端执行记录

基线：`27b3fcb51a13558d226b48c72d32c24ef8d94e99`。本地与远端门禁已通过。

## 本次切片：独立 v1 身份/数据库基础

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
- 家庭角色/设置写接口、真实 PostgreSQL 两家庭全资源隔离。
- 生产 secret 轮换、旧 JSON 停止跟踪与生产切换。
- 前端 bootstrap 和真实 API 接线（本次完全不改前端）。

## 本次实现与验证

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
