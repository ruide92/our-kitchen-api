const api = require('../../utils/api.js')
const util = require('../../utils/util.js')
Page({
  data: { orders: [], filter: '全部' },
  onLoad() { this.loadOrders() },
  async loadOrders() {
    try {
      const data = await api.getOrders({ filter: this.data.filter })
      this.setData({ orders: data.list || data })
    } catch (err) {}
  },
  setFilter(e) { this.setData({ filter: e.currentTarget.dataset.filter }); this.loadOrders() },
  goDetail(e) { wx.navigateTo({ url: `/pages/detail/detail?id=${e.currentTarget.dataset.id}` }) },
  cancelOrder(e) {
    const id = e.currentTarget.dataset.id
    api.cancelOrder(id).then(() => { util.showSuccess('已取消'); this.loadOrders() })
  },
  restoreOrder(e) {
    const id = e.currentTarget.dataset.id
    api.restoreOrder(id).then(() => { util.showSuccess('已恢复'); this.loadOrders() })
  }
})
