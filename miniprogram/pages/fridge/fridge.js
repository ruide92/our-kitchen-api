/**
 * 冰箱 Tab — V4 fixture UI
 *
 * 本页面完全使用 fridge-fixture.js 本地演示数据，不接 legacy API。
 * 所有增删改仅修改页面运行态，刷新后恢复 fixture。
 * "看冰箱做菜"为 placeholder，不做真实推荐。
 */

const FIXTURE = require('./fridge-fixture.js')

Page({
  data: {
    // 双段切换
    activeTab: 'inventory',

    // 库存运行态
    inventoryItems: [],
    pantryStaples: [],
    filteredItems: [],

    // 筛选
    categories: FIXTURE.categories,
    currentCategory: '全部',
    searchKeyword: '',

    // 摘要
    totalCount: 0,
    expiringCount: 0,
    expiringItems: [],

    // bottom sheet
    showAddSheet: false,
    showEditSheet: false,
    editingItem: null,
    showAddStapleSheet: false,
    newStapleName: '',

    // 表单
    addForm: {
      name: '',
      quantity: '',
      unit_code: 'g',
      storage_location: '冷藏',
      expiry_date: '',
      note: '',
    },
    editForm: {
      quantity: '',
      unit_code: 'g',
      storage_location: '冷藏',
      purchase_date: '',
      expiry_date: '',
      note: '',
    },
    unitOptions: FIXTURE.unit_options,
    storageOptions: FIXTURE.storage_options,
  },

  onLoad() {
    this.initFromFixture()
  },

  // 注意：不在 onShow 重置 fixture。
  // 用户运行态（添加/编辑/删除/常备食材修改）在切换 Tab 后必须保留。
  // 只有页面真正重新加载（onLoad）时才恢复 fixture。

  initFromFixture() {
    const items = JSON.parse(JSON.stringify(FIXTURE.inventory_items))
    const staples = JSON.parse(JSON.stringify(FIXTURE.pantry_staples))
    const expiring = items.filter(i => i.freshness_status === 'EXPIRING')
    this.setData({
      inventoryItems: items,
      pantryStaples: staples,
      totalCount: items.length,
      expiringCount: expiring.length,
      expiringItems: expiring.slice(0, 3),
    })
    this._refreshFiltered()
  },

  _refreshFiltered() {
    const { inventoryItems, currentCategory, searchKeyword } = this.data
    let list = inventoryItems
    if (currentCategory !== '全部') {
      list = list.filter(i => i.category === currentCategory)
    }
    if (searchKeyword && searchKeyword.trim()) {
      const kw = searchKeyword.trim().toLowerCase()
      list = list.filter(i => i.name.toLowerCase().includes(kw))
    }
    this.setData({ filteredItems: list })
  },

  /**
   * 基于 FIXTURE.reference_date 确定性计算保质状态。
   * 不使用系统当前时间，避免 fixture 漂移。
   */
  _computeFreshness(expiryDate) {
    if (!expiryDate) {
      return { freshness_status: 'NORMAL', expiry_label: '长期' }
    }
    const ref = new Date(FIXTURE.reference_date + 'T00:00:00')
    const exp = new Date(expiryDate + 'T00:00:00')
    const diff = Math.round((exp - ref) / (1000 * 60 * 60 * 24))
    if (diff < 0) {
      return { freshness_status: 'EXPIRED', expiry_label: '已过期' }
    }
    if (diff === 0) {
      return { freshness_status: 'EXPIRING', expiry_label: '今天到期' }
    }
    if (diff === 1) {
      return { freshness_status: 'EXPIRING', expiry_label: '明天到期' }
    }
    if (diff <= 3) {
      return { freshness_status: 'EXPIRING', expiry_label: diff + '天到期' }
    }
    return { freshness_status: 'FRESH', expiry_label: '还有' + diff + '天' }
  },

  /**
   * 统一刷新统计：totalCount / expiringCount / expiringItems / filteredItems。
   * 新增/编辑/删除后统一调用，避免多套漂移逻辑。
   */
  _refreshStats() {
    const items = this.data.inventoryItems
    const expiring = items.filter(i => i.freshness_status === 'EXPIRING')
    this.setData({
      totalCount: items.length,
      expiringCount: expiring.length,
      expiringItems: expiring.slice(0, 3),
    })
    this._refreshFiltered()
  },

  // ===== 双段切换 =====
  switchTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab })
  },

  // ===== 分类筛选 =====
  selectCategory(e) {
    this.setData({ currentCategory: e.currentTarget.dataset.category })
    this._refreshFiltered()
  },

  // ===== 搜索 =====
  onSearchInput(e) {
    this.setData({ searchKeyword: e.detail.value })
    this._refreshFiltered()
  },

  // ===== 看冰箱做菜（placeholder）=====
  cookWithFridge() {
    wx.showToast({ title: '推荐功能将在真实库存接入后启用', icon: 'none', duration: 2000 })
  },

  prioritizeExpiring() {
    wx.showToast({ title: '推荐功能将在真实库存接入后启用', icon: 'none', duration: 2000 })
  },

  // ===== 添加食材 =====
  openAddSheet() {
    this.setData({
      showAddSheet: true,
      addForm: { name: '', quantity: '', unit_code: 'g', storage_location: '冷藏', expiry_date: '', note: '' },
    })
  },

  closeAddSheet() {
    this.setData({ showAddSheet: false })
  },

  onAddInput(e) {
    this.setData({ [`addForm.${e.currentTarget.dataset.field}`]: e.detail.value })
  },

  onAddUnitChange(e) {
    this.setData({ 'addForm.unit_code': this.data.unitOptions[e.detail.value] })
  },

  onAddStorageChange(e) {
    this.setData({ 'addForm.storage_location': this.data.storageOptions[e.detail.value] })
  },

  onAddExpiryChange(e) {
    this.setData({ 'addForm.expiry_date': e.detail.value })
  },

  saveAddItem() {
    const { addForm, inventoryItems } = this.data
    if (!addForm.name || !addForm.name.trim()) {
      wx.showToast({ title: '请输入食材名称', icon: 'none' })
      return
    }
    const fresh = this._computeFreshness(addForm.expiry_date || null)
    const newItem = {
      id: 'inv-runtime-' + Date.now(),
      ingredient_id: 'ing-runtime-' + Date.now(),
      name: addForm.name.trim(),
      image: null,
      quantity: Number(addForm.quantity) || 0,
      unit_code: addForm.unit_code,
      storage_location: addForm.storage_location,
      category: '其他',
      purchase_date: FIXTURE.reference_date,
      expiry_date: addForm.expiry_date || null,
      freshness_status: fresh.freshness_status,
      expiry_label: fresh.expiry_label,
      note: addForm.note || '',
    }
    this.setData({
      inventoryItems: [...inventoryItems, newItem],
      showAddSheet: false,
    })
    this._refreshStats()
    wx.showToast({ title: '已添加（fixture 运行态）', icon: 'none' })
  },

  // ===== 编辑食材 =====
  openEditSheet(e) {
    const id = e.currentTarget.dataset.id
    const item = this.data.inventoryItems.find(i => i.id === id)
    if (!item) return
    this.setData({
      showEditSheet: true,
      editingItem: item,
      editForm: {
        quantity: String(item.quantity),
        unit_code: item.unit_code,
        storage_location: item.storage_location,
        purchase_date: item.purchase_date || '',
        expiry_date: item.expiry_date || '',
        note: item.note || '',
      },
    })
  },

  closeEditSheet() {
    this.setData({ showEditSheet: false, editingItem: null })
  },

  onEditInput(e) {
    this.setData({ [`editForm.${e.currentTarget.dataset.field}`]: e.detail.value })
  },

  onEditUnitChange(e) {
    this.setData({ 'editForm.unit_code': this.data.unitOptions[e.detail.value] })
  },

  onEditStorageChange(e) {
    this.setData({ 'editForm.storage_location': this.data.storageOptions[e.detail.value] })
  },

  onEditPurchaseChange(e) {
    this.setData({ 'editForm.purchase_date': e.detail.value })
  },

  onEditExpiryChange(e) {
    this.setData({ 'editForm.expiry_date': e.detail.value })
  },

  saveEditItem() {
    const { editingItem, editForm, inventoryItems } = this.data
    if (!editingItem) return
    const fresh = this._computeFreshness(editForm.expiry_date || null)
    const items = inventoryItems.map(i => {
      if (i.id !== editingItem.id) return i
      return {
        ...i,
        quantity: Number(editForm.quantity) || i.quantity,
        unit_code: editForm.unit_code,
        storage_location: editForm.storage_location,
        purchase_date: editForm.purchase_date,
        expiry_date: editForm.expiry_date || null,
        note: editForm.note,
        freshness_status: fresh.freshness_status,
        expiry_label: fresh.expiry_label,
      }
    })
    this.setData({ inventoryItems: items, showEditSheet: false, editingItem: null })
    this._refreshStats()
    wx.showToast({ title: '已保存（fixture 运行态）', icon: 'none' })
  },

  // ===== 移出冰箱 =====
  removeItem() {
    const { editingItem, inventoryItems } = this.data
    if (!editingItem) return
    wx.showModal({
      title: '移出冰箱',
      content: `确定将「${editingItem.name}」移出冰箱吗？`,
      confirmColor: '#E57373',
      success: (res) => {
        if (res.confirm) {
          const items = inventoryItems.filter(i => i.id !== editingItem.id)
          this.setData({
            inventoryItems: items,
            showEditSheet: false,
            editingItem: null,
          })
          this._refreshStats()
          wx.showToast({ title: '已移出（fixture 运行态）', icon: 'none' })
        }
      },
    })
  },

  // ===== 常备食材 =====
  toggleStaple(e) {
    const id = e.currentTarget.dataset.id
    const staples = this.data.pantryStaples.map(s =>
      s.id === id ? { ...s, is_staple: !s.is_staple } : s
    )
    this.setData({ pantryStaples: staples })
  },

  openAddStapleSheet() {
    this.setData({ showAddStapleSheet: true, newStapleName: '' })
  },

  closeAddStapleSheet() {
    this.setData({ showAddStapleSheet: false })
  },

  onStapleNameInput(e) {
    this.setData({ newStapleName: e.detail.value })
  },

  saveAddStaple() {
    const name = this.data.newStapleName.trim()
    if (!name) {
      wx.showToast({ title: '请输入食材名称', icon: 'none' })
      return
    }
    const newStaple = {
      id: 'staple-runtime-' + Date.now(),
      ingredient_id: 'ing-runtime-' + Date.now(),
      name,
      is_staple: true,
    }
    this.setData({
      pantryStaples: [...this.data.pantryStaples, newStaple],
      showAddStapleSheet: false,
    })
    wx.showToast({ title: '已添加（fixture 运行态）', icon: 'none' })
  },

  noop() {},
})
