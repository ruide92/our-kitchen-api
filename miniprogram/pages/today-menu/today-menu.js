const api = require('../../utils/api.js')
const util = require('../../utils/util.js')
Page({
  data: { dishes: [], totalKiss: 0 },
  onLoad() { this.loadTodayMenu() },
  onShow() { this.loadTodayMenu() },
  async loadTodayMenu() {
    try {
      const data = await api.getTodayMenu()
      const dishes = data.list || data.dishes || data
      const totalKiss = dishes.reduce((sum, d) => sum + (d.kiss_reward || 3), 0)
      this.setData({ dishes, totalKiss })
    } catch (err) {}
  },
  goDetail(e) { wx.navigateTo({ url: `/pages/detail/detail?id=${e.currentTarget.dataset.id}` }) },
  removeDish(e) {
    const id = e.currentTarget.dataset.id
    api.removeFromTodayMenu(id).then(() => { util.showSuccess('已移除'); this.loadTodayMenu() })
  },
  generateShopping() {
    api.generateShoppingList().then(() => {
      util.showSuccess('已生成购物清单')
      wx.switchTab({ url: '/pages/shopping/shopping' })
    })
  },
  startCooking() {
    if (this.data.dishes.length === 0) { util.showError('还没有菜品'); return }
    util.showSuccess('开始做饭啦')
  }
})
