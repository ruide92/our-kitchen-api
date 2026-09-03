const api = require('../../utils/api.js')
const util = require('../../utils/util.js')
Page({
  data: {
    mode: 'double',
    dishCount: 2,
    dishes: [],
    locked: [],
    loading: false
  },
  onLoad(options) {
    if (options.mode === 'one') this.setData({ mode: 'one', dishCount: 1 })
    this.generate()
  },
  setMode(e) { this.setData({ mode: e.currentTarget.dataset.mode }); this.generate() },
  setCount(e) { this.setData({ dishCount: parseInt(e.currentTarget.dataset.count) }); this.generate() },
  async generate() {
    try {
      this.setData({ loading: true })
      const data = await api.getRandomMenu({ mode: this.data.mode, count: this.data.dishCount, locked: this.data.locked })
      this.setData({ dishes: data.dishes || data, loading: false })
    } catch (err) { this.setData({ loading: false }) }
  },
  toggleLock(e) {
    const id = e.currentTarget.dataset.id
    const locked = this.data.locked.includes(id)
      ? this.data.locked.filter(i => i !== id)
      : [...this.data.locked, id]
    this.setData({ locked })
  },
  goDetail(e) { wx.navigateTo({ url: `/pages/detail/detail?id=${e.currentTarget.dataset.id}` }) },
  addAllToMenu() {
    this.data.dishes.forEach(dish => {
      api.addToTodayMenu({ dishId: dish.id }).catch(() => {})
    })
    util.showSuccess('已全部加入今日菜单')
  }
})
