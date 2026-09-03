const api = require('../../utils/api.js')
const util = require('../../utils/util.js')

Page({
  data: {
    items: [],
    groupedItems: {},
    allChecked: false,
    checkedCount: 0,
    totalCount: 0,
    showAdd: false,
    newItem: { name: '', amount: '', unit: '', category: '蔬菜' },
    // 保存勾选状态的Map，key是item id
    checkedMap: {}
  },

  onLoad() {
    this.loadShoppingList()
  },

  onShow() {
    this.loadShoppingList()
  },

  async loadShoppingList() {
    try {
      const data = await api.getShoppingList()
      const rawItems = data.list || data.items || data
      // 保留之前的勾选状态
      const checkedMap = this.data.checkedMap
      const items = rawItems.map(item => ({
        ...item,
        checked: checkedMap[item.id] !== undefined ? checkedMap[item.id] : (item.checked || false)
      }))
      // 更新checkedMap
      const newCheckedMap = {}
      items.forEach(item => { newCheckedMap[item.id] = item.checked })
      
      const grouped = this.groupByCategory(items)
      this.setData({
        items,
        groupedItems: grouped,
        checkedMap: newCheckedMap,
        totalCount: items.length,
        checkedCount: items.filter(i => i.checked).length,
        allChecked: items.length > 0 && items.every(i => i.checked)
      })
    } catch (err) {
      console.log('加载购物清单失败', err)
    }
  },

  groupByCategory(items) {
    const groups = {}
    items.forEach(item => {
      const cat = item.category || '其他'
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(item)
    })
    return groups
  },

  toggleCheck(e) {
    const id = e.currentTarget.dataset.id
    const items = this.data.items.map(item => {
      if (item.id === id) {
        return { ...item, checked: !item.checked }
      }
      return item
    })
    // 更新checkedMap
    const checkedMap = { ...this.data.checkedMap }
    const targetItem = this.data.items.find(i => i.id === id)
    if (targetItem) {
      checkedMap[id] = !targetItem.checked
    }
    
    const grouped = this.groupByCategory(items)
    this.setData({
      items,
      groupedItems: grouped,
      checkedMap,
      checkedCount: items.filter(i => i.checked).length,
      allChecked: items.length > 0 && items.every(i => i.checked)
    })
  },

  toggleAll() {
    const newChecked = !this.data.allChecked
    const items = this.data.items.map(item => ({ ...item, checked: newChecked }))
    // 更新checkedMap
    const checkedMap = {}
    items.forEach(item => { checkedMap[item.id] = newChecked })
    
    const grouped = this.groupByCategory(items)
    this.setData({
      items,
      groupedItems: grouped,
      checkedMap,
      checkedCount: newChecked ? items.length : 0,
      allChecked: newChecked
    })
  },

  async generateList() {
    try {
      wx.showLoading({ title: '生成中...' })
      await api.generateShoppingList()
      wx.hideLoading()
      util.showSuccess('已生成购物清单')
      // 生成新清单后清空勾选状态
      this.setData({ checkedMap: {} })
      this.loadShoppingList()
    } catch (err) {
      wx.hideLoading()
      util.showError('生成失败，请先添加菜品到今日菜单')
    }
  },

  async completeShopping() {
    if (this.data.checkedCount === 0) {
      util.showError('请先勾选已购买的商品')
      return
    }
    try {
      const res = await util.showConfirm('购买完成', `已勾选${this.data.checkedCount}样商品，是否加入冰箱？`)
      if (res) {
        wx.showLoading({ title: '处理中...' })
        // 获取已勾选的商品id
        const checkedIds = this.data.items.filter(i => i.checked).map(i => i.id)
        await api.completeShopping({ ids: checkedIds, addToFridge: true })
        wx.hideLoading()
        util.showSuccess('已加入冰箱')
        // 清空勾选状态
        this.setData({ checkedMap: {} })
        this.loadShoppingList()
      }
    } catch (err) {
      wx.hideLoading()
      util.showError('操作失败')
    }
  },

  deleteItem(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除',
      content: '确定删除这个商品吗？',
      confirmColor: '#E91E63',
      success: (res) => {
        if (res.confirm) {
          api.deleteShoppingItem(id).then(() => {
            util.showSuccess('已删除')
            // 从checkedMap中移除
            const checkedMap = { ...this.data.checkedMap }
            delete checkedMap[id]
            this.setData({ checkedMap })
            this.loadShoppingList()
          })
        }
      }
    })
  },

  showAddPanel() {
    this.setData({ showAdd: true })
  },

  hideAddPanel() {
    this.setData({ showAdd: false })
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`newItem.${field}`]: e.detail.value })
  },

  async addItem() {
    if (!this.data.newItem.name) {
      util.showError('请输入商品名称')
      return
    }
    try {
      await api.addShoppingItem(this.data.newItem)
      util.showSuccess('添加成功')
      this.hideAddPanel()
      this.loadShoppingList()
    } catch (err) {
      util.showError('添加失败')
    }
  },

  onPullDownRefresh() {
    this.loadShoppingList().then(() => wx.stopPullDownRefresh())
  }
})
