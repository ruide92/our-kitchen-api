const api = require('../../utils/api.js')
const util = require('../../utils/util.js')

Page({
  data: {
    items: [],
    filteredItems: [],
    categories: ['全部', '冷藏', '冷冻', '常温', '调料'],
    currentCategory: '全部',
    stats: { total: 0, expiring: 0, canCook: 0 },
    showAdd: false,
    newItem: { name: '', amount: '', unit: 'g', category: '冷藏', expiry: '' }
  },

  onLoad() {
    this.loadFridge()
  },

  onShow() {
    this.loadFridge()
  },

  async loadFridge() {
    try {
      const data = await api.getFridge()
      const items = (data.list || data.items || data).map(item => ({
        ...item,
        expiring: this.checkExpiring(item.expiry_date || item.expiry)
      }))
      const stats = data.stats || { total: items.length, expiring: items.filter(i => i.expiring).length, canCook: 0 }
      const filteredItems = this.filterByCategory(items, this.data.currentCategory)
      this.setData({ items, filteredItems, stats })
    } catch (err) {
      console.log('加载冰箱失败', err)
    }
  },

  checkExpiring(expiryDate) {
    if (!expiryDate) return false
    const expiry = new Date(expiryDate)
    const now = new Date()
    const diff = (expiry - now) / (1000 * 60 * 60 * 24)
    return diff <= 3
  },

  filterByCategory(items, category) {
    if (category === '全部') return items
    return items.filter(i => i.category === category)
  },

  selectCategory(e) {
    const category = e.currentTarget.dataset.category
    const filteredItems = this.filterByCategory(this.data.items, category)
    this.setData({ currentCategory: category, filteredItems })
  },

  showAddPanel() {
    this.setData({ showAdd: true })
  },

  hideAddPanel() {
    this.setData({ showAdd: false, newItem: { name: '', amount: '', unit: 'g', category: '冷藏', expiry: '' } })
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`newItem.${field}`]: e.detail.value })
  },

  onCategoryChange(e) {
    const categories = ['冷藏', '冷冻', '常温', '调料']
    this.setData({ 'newItem.category': categories[e.detail.value] })
  },

  async addItem() {
    if (!this.data.newItem.name) {
      util.showError('请输入食材名称')
      return
    }
    try {
      await api.addFridgeItem(this.data.newItem)
      util.showSuccess('添加成功')
      this.hideAddPanel()
      this.loadFridge()
    } catch (err) {}
  },

  async updateItem(e) {
    const id = e.currentTarget.dataset.id
    const item = this.data.items.find(i => i.id === id)
    if (!item) return
    wx.showActionSheet({
      itemList: ['修改数量', '删除'],
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.showModal({
            title: '修改数量',
            editable: true,
            placeholderText: `当前：${item.amount}${item.unit}`,
            success: (modalRes) => {
              if (modalRes.confirm && modalRes.content) {
                api.updateFridgeItem(id, { amount: modalRes.content }).then(() => {
                  util.showSuccess('修改成功')
                  this.loadFridge()
                })
              }
            }
          })
        } else if (res.tapIndex === 1) {
          wx.showModal({
            title: '删除',
            content: `确定删除「${item.name}」吗？`,
            confirmColor: '#E91E63',
            success: (delRes) => {
              if (delRes.confirm) {
                api.deleteFridgeItem(id).then(() => {
                  util.showSuccess('已删除')
                  this.loadFridge()
                })
              }
            }
          })
        }
      }
    })
  },

  goSeasoning() {
    wx.navigateTo({ url: '/pages/seasoning/seasoning' })
  },

  onPullDownRefresh() {
    this.loadFridge().then(() => wx.stopPullDownRefresh())
  }
})
