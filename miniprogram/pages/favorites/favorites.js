const api = require('../../utils/api.js')
const util = require('../../utils/util.js')
Page({
  data: { dishes: [] },
  onLoad() { this.loadFavorites() },
  onShow() { this.loadFavorites() },
  async loadFavorites() {
    try {
      const data = await api.getFavorites()
      this.setData({ dishes: data.list || data })
    } catch (err) {}
  },
  goDetail(e) { wx.navigateTo({ url: `/pages/detail/detail?id=${e.currentTarget.dataset.id}` }) },
  removeFavorite(e) {
    const id = e.currentTarget.dataset.id
    api.removeFavorite(id).then(() => { util.showSuccess('已取消收藏'); this.loadFavorites() })
  }
})
