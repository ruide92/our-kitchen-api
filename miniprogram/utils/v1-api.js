const config = require('../config/v1')
const SESSION_KEYS = ['v1_token', 'v1_user', 'v1_active_family_id']
function v1Error(code, message, status = 0, details = null) {
  return Object.assign(new Error(message), { code, status, details })
}
function createV1Api({ wxAdapter, baseUrl = config.baseUrl, timeoutMs = config.timeoutMs, onUnauthorized = () => {} }) {
  const origin = baseUrl.replace(/\/+$/, '')
  function request(path, { method = 'GET', data, auth = true } = {}) {
    return new Promise((resolve, reject) => {
      if (/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
        let platform
        try { platform = wxAdapter.getDeviceInfo ? wxAdapter.getDeviceInfo().platform : wxAdapter.getSystemInfoSync().platform } catch (_) {}
        if (platform !== 'devtools') return reject(v1Error('DEVTOOLS_ONLY', '尚未配置真机 HTTPS 服务'))
      } else if (!/^https:\/\/[^/?#@\s]+$/.test(origin)) return reject(v1Error('INVALID_CONFIG', 'V1 服务地址配置无效'))
      if (typeof path !== 'string' || !/^\/(?!\/)/.test(path)) return reject(v1Error('INVALID_PATH', '请求路径无效'))
      const sentToken = auth ? (wxAdapter.getStorageSync('v1_token') || '') : ''
      const header = { 'Content-Type': 'application/json' }
      if (sentToken) header.Authorization = `Bearer ${sentToken}`
      wxAdapter.request({
        url: origin + '/api/v1' + path, method, data, header, timeout: timeoutMs,
        success(response) {
          const body = response.data
          if (response.statusCode === 401 && (wxAdapter.getStorageSync('v1_token') || '') === sentToken) {
            SESSION_KEYS.forEach(key => wxAdapter.removeStorageSync(key))
            onUnauthorized()
          }
          if (response.statusCode >= 200 && response.statusCode < 300 && body && !body.error && Object.prototype.hasOwnProperty.call(body, 'data')) {
            resolve({ data: body.data, meta: body.meta || {} })
          } else {
            const error = body && body.error
            reject(v1Error(error && error.code || 'INVALID_RESPONSE', error && error.message || '服务响应异常，请重试', response.statusCode, error && error.details || null))
          }
        },
        // Do not retain raw wx errors (may contain request/header information).
        fail() { reject(v1Error('NETWORK_ERROR', '无法连接登录服务，请检查网络或开发环境')) }
      })
    })
  }
  const dataRequest = (path, options) => request(path, options).then(result => result.data)
  const familyPath = id => '/families/' + encodeURIComponent(id)
  return {
    request,
    login: code => dataRequest('/auth/wechat', { method: 'POST', data: { code }, auth: false }),
    getMe: () => dataRequest('/me'),
    updateNickname: nickname => dataRequest('/me', { method: 'PATCH', data: { nickname } }),
    getMyFamilies: () => dataRequest('/me/families'),
    createFamily: name => dataRequest('/families', { method: 'POST', data: { name } }),
    joinFamily: invite_code => dataRequest('/families/join', { method: 'POST', data: { invite_code } }),
    getFamily: id => dataRequest(familyPath(id)),
    getMembers: id => dataRequest(familyPath(id) + '/members'),
    getSettings: id => dataRequest(familyPath(id) + '/settings'),
    // Recipes
    listRecipes: (id, query) => dataRequest(familyPath(id) + '/recipes' + (query ? '?' + Object.entries(query).filter(([,v]) => v != null).map(([k,v]) => k + '=' + encodeURIComponent(v)).join('&') : '')),
    getRecipe: (id, recipeId) => dataRequest(familyPath(id) + '/recipes/' + recipeId),
    createRecipe: (id, data) => dataRequest(familyPath(id) + '/recipes', { method: 'POST', data }),
    setFavorite: (id, recipeId, fav) => dataRequest(familyPath(id) + '/recipes/' + recipeId + '/favorite', { method: fav ? 'PUT' : 'DELETE' }),
    // Meals
    getCurrentMeal: (id, date, mealType) => dataRequest(familyPath(id) + '/meals/current?date=' + date + '&meal_type=' + mealType),
    ensureCurrentMeal: (id, data) => dataRequest(familyPath(id) + '/meals/current', { method: 'PUT', data }),
    getMeal: (id, mealId) => dataRequest(familyPath(id) + '/meals/' + mealId),
    addMealItem: (id, mealId, data) => dataRequest(familyPath(id) + '/meals/' + mealId + '/items', { method: 'POST', data }),
    removeMealItem: (id, mealId, itemId) => dataRequest(familyPath(id) + '/meals/' + mealId + '/items/' + itemId, { method: 'DELETE' }),
    confirmMeal: (id, mealId) => dataRequest(familyPath(id) + '/meals/' + mealId + '/confirm', { method: 'POST' }),
    // Fridge
    listFridge: (id, query) => dataRequest(familyPath(id) + '/fridge' + (query ? '?' + Object.entries(query).filter(([,v]) => v != null).map(([k,v]) => k + '=' + encodeURIComponent(v)).join('&') : '')),
    addFridgeItem: (id, data) => dataRequest(familyPath(id) + '/fridge', { method: 'POST', data }),
    updateFridgeItem: (id, itemId, data) => dataRequest(familyPath(id) + '/fridge/' + itemId, { method: 'PATCH', data }),
    deleteFridgeItem: (id, itemId) => dataRequest(familyPath(id) + '/fridge/' + itemId, { method: 'DELETE' }),
    listPantry: id => dataRequest(familyPath(id) + '/pantry-staples'),
    putPantry: (id, ingredientId, data) => dataRequest(familyPath(id) + '/pantry-staples/' + ingredientId, { method: 'PUT', data }),
    deletePantry: (id, ingredientId) => dataRequest(familyPath(id) + '/pantry-staples/' + ingredientId, { method: 'DELETE' }),
    // Weekly
    getWeeklyPlan: (id, weekStart) => dataRequest(familyPath(id) + '/weekly-plans' + (weekStart ? '?week_start=' + weekStart : '')),
    importWeeklyPlan: (id, mealId, data) => dataRequest(familyPath(id) + '/meals/' + mealId + '/import-weekly-plan', { method: 'POST', data }),
    // Ingredients
    searchIngredients: keyword => dataRequest('/ingredients/search?keyword=' + encodeURIComponent(keyword)),
    resolveIngredient: (id, name) => dataRequest(familyPath(id) + '/ingredients/resolve', { method: 'POST', data: { name } }),
    // Shopping
    getCurrentShoppingList: id => dataRequest(familyPath(id) + '/shopping-lists/current'),
    generateShoppingList: (id, data) => dataRequest(familyPath(id) + '/shopping-lists/generate', { method: 'POST', data }),
    addShoppingItem: (id, listId, data) => dataRequest(familyPath(id) + '/shopping-lists/' + listId + '/items', { method: 'POST', data }),
    updateShoppingItem: (id, listId, itemId, data) => dataRequest(familyPath(id) + '/shopping-lists/' + listId + '/items/' + itemId, { method: 'PATCH', data }),
    deleteShoppingItem: (id, listId, itemId) => dataRequest(familyPath(id) + '/shopping-lists/' + listId + '/items/' + itemId, { method: 'DELETE' }),
    completeShoppingList: (id, listId, data) => dataRequest(familyPath(id) + '/shopping-lists/' + listId + '/complete', { method: 'POST', data })
  }
}
module.exports = { createV1Api, v1Error, SESSION_KEYS }
