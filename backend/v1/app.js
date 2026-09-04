const express = require('express');
const { ApiError, errorHandler } = require('./errors');
const { UUID } = require('./tokens');
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

function createApp({ repo, wechat, tokens }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  app.post('/api/v1/auth/wechat', asyncRoute(async (req, res) => {
    if (!req.body || typeof req.body.code !== 'string' || !req.body.code.trim() || req.body.code.length > 512 || Object.keys(req.body).some(key => key !== 'code')) {
      throw new ApiError(400, 'INVALID_REQUEST', '请求仅允许非空 code');
    }
    const identity = await wechat.exchange(req.body.code);
    const user = await repo.upsertWechatUser(identity);
    const families = await repo.listFamilies(user.id);
    res.json({ data: { token: tokens.sign(user.id), user, families }, meta: {} });
  }));
  // Every v1 route other than the login route requires verified identity.
  app.use('/api/v1', (req, res, next) => {
    const match = /^Bearer ([^\s]+)$/.exec(req.headers.authorization || '');
    let userId;
    try { if (!match) throw new Error(); userId = tokens.verify(match[1]); }
    catch { return next(new ApiError(401, 'AUTH_REQUIRED', '请重新登录')); }
    repo.getUser(userId).then(user => {
      if (!user) return next(new ApiError(401, 'AUTH_REQUIRED', '请重新登录'));
      req.user = user; next();
    }).catch(next);
  });
  app.get('/api/v1/me', (req, res) => res.json({ data: req.user, meta: {} }));
  app.get('/api/v1/me/families', asyncRoute(async (req, res) => res.json({ data: await repo.listFamilies(req.user.id), meta: {} })));
  app.use('/api/v1/families/:family_id', (req, res, next) => {
    if (!UUID.test(req.params.family_id)) return next(new ApiError(400, 'INVALID_REQUEST', '家庭 ID 无效'));
    repo.getMembership(req.params.family_id, req.user.id).then(member => {
      if (!member) return next(new ApiError(403, 'FAMILY_FORBIDDEN', '你不是该家庭成员'));
      req.membership = member; next();
    }).catch(next);
  });
  app.use((req, res, next) => next(new ApiError(404, 'NOT_FOUND', '接口不存在')));
  app.use(errorHandler);
  return app;
}
module.exports = { createApp };
