const { ApiError } = require('./errors');
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

function installKitchenRoutes(app, services) {
  const { recipes, meals, fridge, shopping, ingredients } = services;
  const familyId = req => req.params.family_id;

  // ===== Ingredients =====
  app.get('/api/v1/ingredients/search', asyncRoute(async (req, res) => {
    res.json({ data: await ingredients.searchIngredients(req.query.keyword), meta: {} });
  }));
  app.post('/api/v1/families/:family_id/ingredients/resolve', asyncRoute(async (req, res) => {
    res.json({ data: await ingredients.resolveIngredient(familyId(req), req.user.id, req.body), meta: {} });
  }));

  // ===== Recipes =====
  app.get('/api/v1/families/:family_id/recipes', asyncRoute(async (req, res) => {
    res.json({ data: await recipes.listRecipes(familyId(req), req.user.id, req.query), meta: {} });
  }));
  app.get('/api/v1/families/:family_id/recipes/:recipe_id', asyncRoute(async (req, res) => {
    res.json({ data: await recipes.getRecipe(familyId(req), req.user.id, req.params.recipe_id), meta: {} });
  }));
  app.post('/api/v1/families/:family_id/recipes', asyncRoute(async (req, res) => {
    res.status(201).json({ data: await recipes.createRecipe(familyId(req), req.user.id, req.body), meta: {} });
  }));
  app.put('/api/v1/families/:family_id/recipes/:recipe_id/favorite', asyncRoute(async (req, res) => {
    res.json({ data: await recipes.setFavorite(familyId(req), req.user.id, req.params.recipe_id, true), meta: {} });
  }));
  app.delete('/api/v1/families/:family_id/recipes/:recipe_id/favorite', asyncRoute(async (req, res) => {
    res.json({ data: await recipes.setFavorite(familyId(req), req.user.id, req.params.recipe_id, false), meta: {} });
  }));

  // ===== Meals =====
  app.get('/api/v1/families/:family_id/meals/current', asyncRoute(async (req, res) => {
    const { date, meal_type } = req.query;
    if (!date || !meal_type) throw new ApiError(400, 'INVALID_REQUEST', '需要 date 和 meal_type');
    res.json({ data: await meals.getCurrentMeal(familyId(req), req.user.id, date, meal_type), meta: {} });
  }));
  app.put('/api/v1/families/:family_id/meals/current', asyncRoute(async (req, res) => {
    res.json({ data: await meals.ensureCurrentMeal(familyId(req), req.user.id, req.body), meta: {} });
  }));
  app.get('/api/v1/families/:family_id/meals/:meal_id', asyncRoute(async (req, res) => {
    res.json({ data: await meals.getMeal(familyId(req), req.user.id, req.params.meal_id), meta: {} });
  }));
  app.post('/api/v1/families/:family_id/meals/:meal_id/items', asyncRoute(async (req, res) => {
    res.status(201).json({ data: await meals.addMealItem(familyId(req), req.user.id, req.params.meal_id, req.body), meta: {} });
  }));
  app.delete('/api/v1/families/:family_id/meals/:meal_id/items/:item_id', asyncRoute(async (req, res) => {
    res.json({ data: await meals.removeMealItem(familyId(req), req.user.id, req.params.meal_id, req.params.item_id), meta: {} });
  }));
  app.post('/api/v1/families/:family_id/meals/:meal_id/confirm', asyncRoute(async (req, res) => {
    res.json({ data: await meals.confirmMeal(familyId(req), req.user.id, req.params.meal_id), meta: {} });
  }));
  app.post('/api/v1/families/:family_id/meals/:meal_id/import-weekly-plan', asyncRoute(async (req, res) => {
    res.json({ data: await meals.importWeeklyPlan(familyId(req), req.user.id, req.params.meal_id, req.body.weekly_plan_id), meta: {} });
  }));

  // ===== Weekly Plans =====
  app.get('/api/v1/families/:family_id/weekly-plans', asyncRoute(async (req, res) => {
    res.json({ data: await meals.getWeeklyPlans(familyId(req), req.user.id, req.query.week_start), meta: {} });
  }));

  // ===== Fridge =====
  app.get('/api/v1/families/:family_id/fridge', asyncRoute(async (req, res) => {
    res.json({ data: await fridge.listFridge(familyId(req), req.user.id, req.query), meta: {} });
  }));
  app.post('/api/v1/families/:family_id/fridge', asyncRoute(async (req, res) => {
    res.status(201).json({ data: await fridge.addFridgeItem(familyId(req), req.user.id, req.body), meta: {} });
  }));
  app.patch('/api/v1/families/:family_id/fridge/:fridge_item_id', asyncRoute(async (req, res) => {
    res.json({ data: await fridge.updateFridgeItem(familyId(req), req.user.id, req.params.fridge_item_id, req.body), meta: {} });
  }));
  app.delete('/api/v1/families/:family_id/fridge/:fridge_item_id', asyncRoute(async (req, res) => {
    res.json({ data: await fridge.deleteFridgeItem(familyId(req), req.user.id, req.params.fridge_item_id), meta: {} });
  }));

  // ===== Pantry =====
  app.get('/api/v1/families/:family_id/pantry-staples', asyncRoute(async (req, res) => {
    res.json({ data: await fridge.listPantry(familyId(req), req.user.id), meta: {} });
  }));
  app.put('/api/v1/families/:family_id/pantry-staples/:ingredient_id', asyncRoute(async (req, res) => {
    res.json({ data: await fridge.putPantry(familyId(req), req.user.id, req.params.ingredient_id, req.body), meta: {} });
  }));
  app.delete('/api/v1/families/:family_id/pantry-staples/:ingredient_id', asyncRoute(async (req, res) => {
    res.json({ data: await fridge.deletePantry(familyId(req), req.user.id, req.params.ingredient_id), meta: {} });
  }));

  // ===== Shopping =====
  app.get('/api/v1/families/:family_id/shopping-lists/current', asyncRoute(async (req, res) => {
    res.json({ data: await shopping.getCurrentList(familyId(req), req.user.id), meta: {} });
  }));
  app.post('/api/v1/families/:family_id/shopping-lists/generate', asyncRoute(async (req, res) => {
    res.status(201).json({ data: await shopping.generateList(familyId(req), req.user.id, req.body), meta: {} });
  }));
  app.post('/api/v1/families/:family_id/shopping-lists/:list_id/items', asyncRoute(async (req, res) => {
    res.status(201).json({ data: await shopping.addManualItem(familyId(req), req.user.id, req.params.list_id, req.body), meta: {} });
  }));
  app.patch('/api/v1/families/:family_id/shopping-lists/:list_id/items/:item_id', asyncRoute(async (req, res) => {
    res.json({ data: await shopping.updateItem(familyId(req), req.user.id, req.params.list_id, req.params.item_id, req.body), meta: {} });
  }));
  app.delete('/api/v1/families/:family_id/shopping-lists/:list_id/items/:item_id', asyncRoute(async (req, res) => {
    res.json({ data: await shopping.deleteItem(familyId(req), req.user.id, req.params.list_id, req.params.item_id), meta: {} });
  }));
  app.post('/api/v1/families/:family_id/shopping-lists/:list_id/complete', asyncRoute(async (req, res) => {
    res.json({ data: await shopping.completeList(familyId(req), req.user.id, req.params.list_id, req.body), meta: {} });
  }));
}

module.exports = { installKitchenRoutes };
