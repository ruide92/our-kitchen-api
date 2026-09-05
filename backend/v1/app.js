const express = require('express');
const { ApiError, errorHandler } = require('./errors');
const { installFamilyRoutes } = require('./family-routes');
const { installKitchenRoutes } = require('./kitchen-routes');
const { validateProfile } = require('./family-validation');
const { createRecipeService } = require('./recipe-service');
const { createMealService } = require('./meal-service');
const { createFridgeService } = require('./fridge-service');
const { createShoppingService } = require('./shopping-service');
const { createIngredientService } = require('./ingredient-service');
const { createRecommendationService } = require('./recommendation-service');
const { createCookingService } = require('./cooking-service');
const { createKissService } = require('./kiss-service');
const { createRecipeImportService } = require('./recipe-import-service');
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

function createApp({ repo, wechat, tokens, families, pool }) {
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
  app.patch('/api/v1/me', asyncRoute(async (req,res) => res.json({data:await repo.updateUser(req.user.id,validateProfile(req.body)),meta:{}})));
  app.get('/api/v1/me/families', asyncRoute(async (req, res) => res.json({ data: await repo.listFamilies(req.user.id), meta: {} })));
  installFamilyRoutes(app,repo,families);
  const kitchenServices = {
    recipes: createRecipeService(pool),
    meals: createMealService(pool),
    fridge: createFridgeService(pool),
    shopping: createShoppingService(pool),
    ingredients: createIngredientService(pool),
    recommendation: createRecommendationService(pool),
    cooking: createCookingService(pool),
    kiss: createKissService(pool),
    recipeImports: createRecipeImportService(pool)
  };
  installKitchenRoutes(app, kitchenServices);
  app.use((req, res, next) => next(new ApiError(404, 'NOT_FOUND', '接口不存在')));
  app.use(errorHandler);
  return app;
}
module.exports = { createApp };
