const api = require('../../utils/api.js')
const util = require('../../utils/util.js')
Page({
  data: { dishes: [] },
  onLoad() { this.loadRatings() },
  async loadRatings() {
    try {
      const data = await api.getRatings()
      const dishes = (data.list || data).map(item => ({
        ...item,
        stars: '★'.repeat(item.score || 5) + '☆'.repeat(5 - (item.score || 5))
      }))
      this.setData({ dishes })
    } catch (err) {}
  },
  goDetail(e) { wx.navigateTo({ url: `/pages/detail/detail?id=${e.currentTarget.dataset.id}` }) },
  removeRating(e) {
    const id = e.currentTarget.dataset.id
    api.removeRating(id).then(() => { util.showSuccess('已取消评分'); this.loadRatings() })
  }
})
