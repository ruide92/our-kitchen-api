const api = require('../../utils/api.js')
const util = require('../../utils/util.js')
Page({
  data: { items: [] },
  onLoad() { this.loadRecycle() },
  async loadRecycle() {
    try {
      const data = await api.getRecycle()
      this.setData({ items: data.list || data })
    } catch (err) {}
  },
  restore(e) {
    const id = e.currentTarget.dataset.id
    api.restoreRecycle(id).then(() => { util.showSuccess('已恢复'); this.loadRecycle() })
  },
  deleteForever(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '永久删除',
      content: '确定要永久删除吗？此操作不可恢复！',
      confirmColor: '#E91E63',
      success: (res) => {
        if (res.confirm) {
          api.deleteRecycle(id).then(() => { util.showSuccess('已删除'); this.loadRecycle() })
        }
      }
    })
  }
})
