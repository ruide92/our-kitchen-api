// API封装 - 我们家的大食堂（独立后端）
const BASE_URL = 'https://our-kitchen-api-6vk6.onrender.com/api'

function request(options) {
  return new Promise((resolve, reject) => {
    const token = wx.getStorageSync('token')
    wx.request({
      url: BASE_URL + options.url,
      method: options.method || 'GET',
      data: options.data || {},
      header: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      success: (res) => {
        if (res.statusCode === 200) {
          resolve(res.data)
        } else if (res.statusCode === 401) {
          wx.removeStorageSync('token')
          reject(res)
        } else {
          reject(res)
        }
      },
      fail: (err) => {
        reject(err)
      }
    })
  })
}

// 认证
const login = (data) => request({ url: '/auth/login', method: 'POST', data })
const getUserInfo = () => request({ url: '/auth/info' })
const updateUserInfo = (data) => request({ url: '/auth/info', method: 'PUT', data })

// 家庭
const getKitchen = () => request({ url: '/family/mine' })
const createKitchen = (data) => request({ url: '/family', method: 'POST', data })
const getMembers = () => request({ url: '/family/members' })
const joinKitchen = (data) => request({ url: '/family/join', method: 'POST', data })
const updateKitchenName = (data) => request({ url: '/family/name', method: 'PATCH', data })
const regenerateInviteCode = () => request({ url: '/family/invite-code', method: 'POST' })

// 菜品
const getDishes = (params) => request({ url: '/dishes', data: params })
const getDish = (id) => request({ url: `/dishes/${id}` })
const getHotDishes = () => request({ url: '/dishes/hot/list' })
const getMyRatedDishes = () => request({ url: '/dishes/my-rated/list' })
const addDish = (data) => request({ url: '/dishes/custom', method: 'POST', data })
const updateDish = (id, data) => request({ url: `/dishes/${id}`, method: 'PATCH', data })
const deleteDish = (id) => request({ url: `/dishes/${id}`, method: 'DELETE' })

// 分类
const getCategories = () => request({ url: '/dishes/categories/list' })

// 每周食谱
const getWeeklyMenu = () => request({ url: '/menu' })
const addToWeeklyMenu = (data) => request({ url: '/menu', method: 'POST', data })
const removeFromWeeklyMenu = (id) => request({ url: `/menu/${id}`, method: 'DELETE' })
const regenerateWeeklyMenu = () => request({ url: '/menu/generate', method: 'POST' })

// 点菜（我想吃）
const createOrder = (data) => request({ url: '/orders', method: 'POST', data })
const getOrders = (params) => request({ url: '/orders', data: params })
const getOrderHistory = (params) => request({ url: '/orders/history', data: params })
const cancelOrder = (id) => request({ url: `/orders/${id}`, method: 'DELETE' })
const updateOrderStatus = (id, data) => request({ url: `/orders/${id}/status`, method: 'PATCH', data })

// 收藏
const getFavorites = () => request({ url: '/favorites' })
const toggleFavorite = (dishId) => request({ url: `/dishes/${dishId}/favorite`, method: 'POST' })
const checkFavorite = (dishId) => request({ url: `/favorites/check/${dishId}` })

// 评分
const addRating = (data) => request({ url: `/dishes/${data.dishId}/rate`, method: 'POST', data: { rating: data.rating } })
const removeRating = (dishId) => request({ url: `/dishes/${dishId}/rate`, method: 'DELETE' })

// 随机推荐
const getRandomMenu = (params) => request({ url: '/dishes/recommend-random', method: 'POST', data: params })

// 冰箱
const getFridge = () => request({ url: '/fridge' })
const addFridgeItem = (data) => request({ url: '/fridge', method: 'POST', data })
const updateFridgeItem = (id, data) => request({ url: `/fridge/${id}`, method: 'PATCH', data })
const deleteFridgeItem = (id) => request({ url: `/fridge/${id}`, method: 'DELETE' })

// 购物清单
const getShoppingList = () => request({ url: '/shopping' })
const addShoppingItem = (data) => request({ url: '/shopping', method: 'POST', data })
const updateShoppingItem = (id, data) => request({ url: `/shopping/${id}`, method: 'PATCH', data })
const toggleShoppingItem = (id, data) => request({ url: `/shopping/${id}/toggle`, method: 'PATCH', data })
const toggleAllShopping = (data) => request({ url: '/shopping/toggle-all', method: 'POST', data })
const deleteShoppingItem = (id) => request({ url: `/shopping/${id}`, method: 'DELETE' })
const moveToFridge = () => request({ url: '/shopping/move-to-fridge', method: 'POST' })
const generateFromDishes = (data) => request({ url: '/shopping/generate-from-dishes', method: 'POST', data })

// 调味品
const getCondiments = () => request({ url: '/condiments' })
const getCondimentPresets = () => request({ url: '/condiments/presets' })
const addCondiment = (data) => request({ url: '/condiments', method: 'POST', data })
const batchAddCondiments = (data) => request({ url: '/condiments/batch-add', method: 'POST', data })
const updateCondiment = (id, data) => request({ url: `/condiments/${id}`, method: 'PATCH', data })
const deleteCondiment = (id) => request({ url: `/condiments/${id}`, method: 'DELETE' })

module.exports = {
  login,
  getUserInfo,
  updateUserInfo,
  getKitchen,
  createKitchen,
  getMembers,
  joinKitchen,
  updateKitchenName,
  regenerateInviteCode,
  getDishes,
  getDish,
  getHotDishes,
  getMyRatedDishes,
  addDish,
  updateDish,
  deleteDish,
  getCategories,
  getWeeklyMenu,
  addToWeeklyMenu,
  removeFromWeeklyMenu,
  regenerateWeeklyMenu,
  createOrder,
  getOrders,
  getOrderHistory,
  cancelOrder,
  updateOrderStatus,
  getFavorites,
  toggleFavorite,
  checkFavorite,
  addRating,
  removeRating,
  getRandomMenu,
  getFridge,
  addFridgeItem,
  updateFridgeItem,
  deleteFridgeItem,
  getShoppingList,
  addShoppingItem,
  updateShoppingItem,
  toggleShoppingItem,
  toggleAllShopping,
  deleteShoppingItem,
  moveToFridge,
  generateFromDishes,
  getCondiments,
  getCondimentPresets,
  addCondiment,
  batchAddCondiments,
  updateCondiment,
  deleteCondiment
}
