/**
 * Frontend payload/behavior tests for miniprogram pages.
 * Mocks wx global and tests that pages send correct API payloads.
 */
const test = require('node:test')
const assert = require('node:assert')

// ===== Mock wx global =====
function createMockWx() {
  const storage = {}
  const calls = []
  return {
    _calls: calls,
    getStorageSync: (k) => storage[k] || '',
    setStorageSync: (k, v) => { storage[k] = v },
    showToast: (opts) => calls.push({ type: 'showToast', opts }),
    showLoading: (opts) => calls.push({ type: 'showLoading', opts }),
    hideLoading: () => calls.push({ type: 'hideLoading' }),
    switchTab: (opts) => calls.push({ type: 'switchTab', opts }),
    navigateTo: (opts) => calls.push({ type: 'navigateTo', opts }),
  }
}

// ===== Mock V1 API =====
function createMockApi() {
  const calls = []
  return {
    _calls: calls,
    getSettings: async (id) => { calls.push({ method: 'getSettings', id }); return { default_diners: 2 } },
    getFamily: async (id) => { calls.push({ method: 'getFamily', id }); return { id, name: '测试家庭' } },
    getMembers: async (id) => { calls.push({ method: 'getMembers', id }); return [] },
    getWeeklyPlan: async (id, week) => { calls.push({ method: 'getWeeklyPlan', id, week }); return null },
    getCurrentMeal: async (id, date, type) => { calls.push({ method: 'getCurrentMeal', id, date, type }); return null },
    ensureCurrentMeal: async (id, body) => { calls.push({ method: 'ensureCurrentMeal', id, body }); return { id: 'meal-1', ...body } },
    addMealItem: async (id, mealId, body) => { calls.push({ method: 'addMealItem', id, mealId, body }); return { id: 'item-1' } },
    getRecipes: async (id) => { calls.push({ method: 'getRecipes', id }); return [] },
    addFridgeItem: async (id, body) => { calls.push({ method: 'addFridgeItem', id, body }); return { id: 'fridge-1' } },
    updateFridgeItem: async (id, itemId, body) => { calls.push({ method: 'updateFridgeItem', id, itemId, body }); return { id: itemId } },
    getPantry: async (id) => { calls.push({ method: 'getPantry', id }); return [] },
    putPantry: async (id, ingId, body) => { calls.push({ method: 'putPantry', id, ingId, body }); return {} },
    deletePantry: async (id, ingId) => { calls.push({ method: 'deletePantry', id, ingId }); return {} },
    getCurrentShoppingList: async (id) => { calls.push({ method: 'getCurrentShoppingList', id }); return null },
    addShoppingItem: async (id, listId, body) => { calls.push({ method: 'addShoppingItem', id, listId, body }); return { id: 'manual-1' } },
    updateShoppingItem: async (id, listId, itemId, body) => { calls.push({ method: 'updateShoppingItem', id, listId, itemId, body }); return {} },
    completeShoppingList: async (id, listId, body) => { calls.push({ method: 'completeShoppingList', id, listId, body }); return {} },
  }
}

// ===== Helper: create page instance =====
function createPageInstance(modulePath, mockWx, mockApi) {
  global.wx = mockWx
  let capturedConfig = null
  global.Page = function(config) { capturedConfig = config }
  delete require.cache[require.resolve(modulePath)]
  require(modulePath)
  const instance = Object.create(capturedConfig || {})
  Object.assign(instance, capturedConfig || {})
  instance.data = JSON.parse(JSON.stringify((capturedConfig || {}).data || {}))
  instance._api = mockApi
  instance._familyId = 'family-1'
  instance.setData = function(patch) { Object.assign(this.data, patch) }
  instance.getTabBar = () => ({ setData: () => {} })
  return instance
}

test('Fridge add: 2个 -> unit_code=piece', async () => {
  const wx = createMockWx()
  const api = createMockApi()
  const page = createPageInstance('../miniprogram/pages/fridge/fridge.js', wx, api)
  page.data.addForm = { name: '鸡蛋', quantity: '2', unit_code: '个', custom_unit: '', storage_location: '冷藏', expiry_date: '', note: '' }
  await page.saveAddItem()
  const call = api._calls.find(c => c.method === 'addFridgeItem')
  assert.ok(call, 'addFridgeItem should be called')
  assert.equal(call.body.unit_code, 'piece')
  assert.equal(call.body.quantity, 2)
})

test('Fridge add: 2盒 -> unit_code=null + quantity_text=2盒', async () => {
  const wx = createMockWx()
  const api = createMockApi()
  const page = createPageInstance('../miniprogram/pages/fridge/fridge.js', wx, api)
  page.data.addForm = { name: '酸奶', quantity: '2', unit_code: '自定义', custom_unit: '盒', storage_location: '冷藏', expiry_date: '', note: '' }
  await page.saveAddItem()
  const call = api._calls.find(c => c.method === 'addFridgeItem')
  assert.ok(call, 'addFridgeItem should be called')
  assert.equal(call.body.unit_code, null)
  assert.equal(call.body.quantity_text, '2盒')
})

test('Fridge edit: purchase_date, version, storage, unit all sent', async () => {
  const wx = createMockWx()
  const api = createMockApi()
  const page = createPageInstance('../miniprogram/pages/fridge/fridge.js', wx, api)
  page.data.editingItem = { id: 'fridge-1', version: 3, name: '猪肉' }
  page.data.editForm = { quantity: '500', unit_code: 'g', custom_unit: '', storage_location: '冷冻', purchase_date: '2026-09-01', expiry_date: '2026-09-10', note: 'test' }
  await page.saveEditItem()
  const call = api._calls.find(c => c.method === 'updateFridgeItem')
  assert.ok(call, 'updateFridgeItem should be called')
  assert.equal(call.body.purchase_date, '2026-09-01')
  assert.equal(call.body.version, 3)
  assert.equal(call.body.storage_location, 'FROZEN')
  assert.equal(call.body.unit_code, 'g')
})

test('Shopping manual add: 2盒 body correct', async () => {
  const wx = createMockWx()
  const api = createMockApi()
  const page = createPageInstance('../miniprogram/pages/shopping/shopping.js', wx, api)
  page.data.currentList = { id: 'list-1', status: 'OPEN' }
  page.data.addForm = { name: '酸奶', quantity: '2', unit: '自定义', customUnit: '盒', note: '' }
  await page.saveAddItem()
  const call = api._calls.find(c => c.method === 'addShoppingItem')
  assert.ok(call, 'addManualItem should be called')
  assert.equal(call.body.required_quantity, 2)
  assert.equal(call.body.unit_code, null)
  assert.equal(call.body.required_quantity_text, '2盒')
})

test('Complete Purchase payload: item_id, purchased_quantity, storage, expiry', async () => {
  const wx = createMockWx()
  const api = createMockApi()
  const page = createPageInstance('../miniprogram/pages/shopping/shopping.js', wx, api)
  page.data.currentList = { id: 'list-1', status: 'OPEN' }
  page.data.purchasedItems = [{ id: 'item-1', name: '猪肉', purchased_quantity: 300, storage_location: '冷冻', expiry_date: '2026-09-10' }]
  await page.confirmComplete()
  const call = api._calls.find(c => c.method === 'completeShoppingList')
  assert.ok(call, 'completeShoppingList should be called')
  assert.equal(call.body.items.length, 1)
  assert.equal(call.body.items[0].item_id, 'item-1')
  assert.equal(call.body.items[0].purchased_quantity, 300)
  assert.equal(call.body.items[0].storage_location, 'FROZEN')
  assert.equal(call.body.items[0].expiry_date, '2026-09-10')
})

test('Menu overlay: open picker -> hidden=true, close -> hidden=false', async () => {
  const wx = createMockWx()
  const api = createMockApi()
  const page = createPageInstance('../miniprogram/pages/menu/menu.js', wx, api)
  let tabBarData = {}
  page.getTabBar = () => ({ setData: (d) => { Object.assign(tabBarData, d) } })
  page._mealTarget = { options: () => [{meal_date:'2026-09-22', meal_type:'DINNER', label:'今天晚餐'}], update: (t) => t, get: () => ({meal_date:'2026-09-22', meal_type:'DINNER'}) }; page.openTargetPicker()
  assert.equal(tabBarData.hidden, true)
  page.closeTargetPicker()
  assert.equal(tabBarData.hidden, false)
})

test('Homepage addMeal: ALREADY_IN_MEAL (409) can be ignored, other errors throw', async () => {
  const wx = createMockWx()
  const api = createMockApi()
  api.getCurrentMeal = async () => null
  api.ensureCurrentMeal = async () => ({ id: 'meal-1' })
  api.addMealItem = async () => { const e = new Error('already'); e.status = 409; e.code = 'ALREADY_IN_MEAL'; throw e }
  const page = createPageInstance('../miniprogram/pages/index/index.js', wx, api)
  page.data.selectedFullDate = '2026-09-22'
  page.data.selectedMeals = [{ key: 'DINNER', label: '晚餐', icon: '🌙', dishes: [{ recipeId: 'r1', name: '菜1' }] }]
  page._loadRealData = () => {}
  await page.addMealToCurrent({ currentTarget: { dataset: { mealKey: 'DINNER' } } })
  const toast = wx._calls.find(c => c.type === 'showToast')
  assert.ok(toast, 'toast should show')
  assert.ok(toast.opts.title.includes('已在菜单中') || toast.opts.title.includes('加入0道'), 'should report already in meal')
})

test('Homepage uses getSettings (not getFamilySettings)', async () => {
  const wx = createMockWx()
  const api = createMockApi()
  const page = createPageInstance('../miniprogram/pages/index/index.js', wx, api)
  page._familyId = 'family-1'
  page.data.weekDays = [{ fullDate: '2026-09-22' }]
  await page._loadRealData()
  const call = api._calls.find(c => c.method === 'getSettings')
  assert.ok(call, 'getSettings should be called')
  const wrongCall = api._calls.find(c => c.method === 'getFamilySettings')
  assert.equal(wrongCall, undefined, 'getFamilySettings should NOT be called')
})

test('Menu custom meal type click reads dataset.type', () => {
  const wx = createMockWx()
  const api = createMockApi()
  const page = createPageInstance('../miniprogram/pages/menu/menu.js', wx, api)
  page.onCustomMealTypeChange({ currentTarget: { dataset: { type: 'BREAKFAST' } } })
  assert.equal(page.data.customMealType, 'BREAKFAST')
  page.onCustomMealTypeChange({ currentTarget: { dataset: { type: 'LUNCH' } } })
  assert.equal(page.data.customMealType, 'LUNCH')
  page.onCustomMealTypeChange({ currentTarget: { dataset: { type: 'DINNER' } } })
  assert.equal(page.data.customMealType, 'DINNER')
})

test('Menu mini-cart network error preserves last valid count', async () => {
  const wx = createMockWx()
  const api = createMockApi()
  const page = createPageInstance('../miniprogram/pages/menu/menu.js', wx, api)
  page._familyId = 'family-1'
  page.data.targetMeal = { meal_date: '2026-09-22', meal_type: 'DINNER' }
  page.data.miniCartCount = 3
  page.data.miniCartVisible = true
  api.getCurrentMeal = async () => { throw new Error('NETWORK_ERROR') }
  await page._refreshMiniCart()
  assert.equal(page.data.miniCartCount, 3, 'should preserve last count on network error')
  assert.equal(page.data.miniCartVisible, true, 'should preserve visibility on network error')
  assert.ok(page.data.miniCartError, 'should record miniCartError')
})

test('Menu mini-cart 404 clears count, network error does not', async () => {
  const wx = createMockWx()
  const api = createMockApi()
  const page = createPageInstance('../miniprogram/pages/menu/menu.js', wx, api)
  page._familyId = 'family-1'
  page.data.targetMeal = { meal_date: '2026-09-22', meal_type: 'DINNER' }
  page.data.miniCartCount = 3
  const err404 = new Error('not found'); err404.status = 404; err404.code = 'NOT_FOUND'
  api.getCurrentMeal = async () => { throw err404 }
  await page._refreshMiniCart()
  assert.equal(page.data.miniCartCount, 0, '404 should clear count')
  assert.equal(page.data.miniCartError, null, '404 should not set error')
})

test('ALREADY_IN_MEAL is ignored, MEAL_NOT_EDITABLE 409 is failure', async () => {
  const wx = createMockWx()
  const api = createMockApi()
  api.getCurrentMeal = async () => null
  api.ensureCurrentMeal = async () => ({ id: 'meal-1' })
  let callCount = 0
  api.addMealItem = async () => {
    callCount++
    if (callCount === 1) { const e = new Error('already'); e.code = 'ALREADY_IN_MEAL'; throw e }
    if (callCount === 2) { const e = new Error('not editable'); e.status = 409; e.code = 'MEAL_NOT_EDITABLE'; throw e }
    return { id: 'item-1' }
  }
  const page = createPageInstance('../miniprogram/pages/index/index.js', wx, api)
  page.data.selectedFullDate = '2026-09-22'
  page.data.selectedMeals = [{ key: 'DINNER', label: '晚餐', icon: '🌙', dishes: [{ recipeId: 'r1', name: '菜1' }, { recipeId: 'r2', name: '菜2' }, { recipeId: 'r3', name: '菜3' }] }]
  page._loadRealData = () => {}
  await page.addMealToCurrent({ currentTarget: { dataset: { mealKey: 'DINNER' } } })
  const toast = wx._calls.find(c => c.type === 'showToast')
  assert.ok(toast, 'toast should show')
  assert.ok(toast.opts.title.includes('失败') || toast.opts.title.includes('1道失败'), 'MEAL_NOT_EDITABLE should be reported as failure')
})

test('Homepage settings failure sets loadError, not fallback 2', async () => {
  const wx = createMockWx()
  const api = createMockApi()
  api.getSettings = async () => { throw new Error('SETTINGS_UNAVAILABLE') }
  const page = createPageInstance('../miniprogram/pages/index/index.js', wx, api)
  page._familyId = 'family-1'
  page.data.weekDays = [{ fullDate: '2026-09-22' }]
  await page._loadRealData()
  assert.ok(page.data.loadError, 'settings failure should set loadError')
})

test('Pantry API error sets pantryError, not empty array', async () => {
  const wx = createMockWx()
  const api = createMockApi()
  api.listPantry = async () => { throw new Error('PANTRY_ERROR') }
  const page = createPageInstance('../miniprogram/pages/fridge/fridge.js', wx, api)
  page._familyId = 'family-1'
  page.data.pantryStaples = [{ name: 'existing', ingredient_id: 'i1' }]
  await page._loadPantry()
  assert.ok(page.data.pantryError, 'pantry error should be recorded')
  assert.equal(page.data.pantryStaples.length, 1, 'should preserve existing staples on error')
  assert.equal(page.data.pantryLoading, false)
})

test('Pantry API [] returns empty, not error', async () => {
  const wx = createMockWx()
  const api = createMockApi()
  api.listPantry = async () => []
  const page = createPageInstance('../miniprogram/pages/fridge/fridge.js', wx, api)
  page._familyId = 'family-1'
  await page._loadPantry()
  assert.equal(page.data.pantryError, null)
  assert.equal(page.data.pantryStaples.length, 0)
  assert.equal(page.data.pantryLoading, false)
})

test('Fridge existing custom unit edit round trip', async () => {
  const wx = createMockWx()
  const api = createMockApi()
  const page = createPageInstance('../miniprogram/pages/fridge/fridge.js', wx, api)
  page.data.inventoryItems = [{ id: 'f1', name: '酸奶', quantity: 2, unit_code: null, quantity_text: '2盒', storage_location: 'REFRIGERATED', version: 1 }]
  page.openEditSheet({ currentTarget: { dataset: { id: 'f1' } } })
  assert.equal(page.data.editForm.quantity, '2')
  assert.equal(page.data.editForm.unit_code, '自定义')
  assert.equal(page.data.editForm.custom_unit, '盒')
  await page.saveEditItem()
  const call = api._calls.find(c => c.method === 'updateFridgeItem')
  assert.ok(call, 'updateFridgeItem should be called')
  assert.equal(call.body.unit_code, null)
  assert.equal(call.body.quantity_text, '2盒')
  assert.equal(call.body.quantity, 2)
})

test('Fridge category mapping: MEAT item shows under 肉蛋', () => {
  const wx = createMockWx()
  const api = createMockApi()
  const page = createPageInstance('../miniprogram/pages/fridge/fridge.js', wx, api)
  const enriched = page._enrichItem({ id: 'f1', name: '猪肉', category_code: 'MEAT', quantity: 500, unit_code: 'g' })
  assert.equal(enriched.category_label, '肉蛋')
  page.data.inventoryItems = [enriched]
  page.data.currentCategory = '肉蛋'
  page.data.searchKeyword = ''
  page._refreshFiltered()
  assert.equal(page.data.filteredItems.length, 1, 'MEAT item should show under 肉蛋')
  page.data.currentCategory = '蔬菜'
  page._refreshFiltered()
  assert.equal(page.data.filteredItems.length, 0, 'MEAT item should NOT show under 蔬菜')
})
