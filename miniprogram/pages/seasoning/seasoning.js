const api = require('../../utils/api.js')
const util = require('../../utils/util.js')

Page({
  data: {
    items: [],
    categories: ['基础调味', '油类', '酱料', '香辛料', '干货调料'],
    currentCategory: '全部',
    showAdd: false,
    newItem: { name: '', amount: '', unit: '', category: '基础调味', status: '有' }
  },
  onLoad() { this.loadData() },
  onShow() { this.loadData() },
  async loadData() {
    try {
      const data = await api.getSeasonings()
      this.setData({ items: data.list || data.items || data })
    } catch (err) {}
  },
  selectCategory(e) { this.setData({ currentCategory: e.currentTarget.dataset.category }) },
  showAddPanel() { this.setData({ showAdd: true }) },
  hideAddPanel() { this.setData({ showAdd: false }) },
  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`newItem.${field}`]: e.detail.value })
  },
  async addItem() {
    if (!this.data.newItem.name) { util.showError('请输入名称'); return }
    try {
      await api.addSeasoning(this.data.newItem)
      util.showSuccess('添加成功')
      this.hideAddPanel()
      this.loadData()
    } catch (err) {}
  },
  toggleStatus(e) {
    const id = e.currentTarget.dataset.id
    const item = this.data.items.find(i => i.id === id)
    const statuses = ['有', '快用完', '没有']
    const nextStatus = statuses[(statuses.indexOf(item.status) + 1) % 3]
    api.updateSeasoning(id, { status: nextStatus }).then(() => {
      util.showSuccess('已更新')
      this.loadData()
    })
  },
  deleteItem(e) {
    const id = e.currentTarget.dataset.id
    api.deleteSeasoning(id).then(() => { util.showSuccess('已删除'); this.loadData() })
  }
})
