/**
 * 冰箱 Tab — V4 fixture UI
 *
 * 本页面完全使用 fridge-fixture.js 本地演示数据，不接 legacy API。
 * 所有增删改仅修改页面运行态，刷新后恢复 fixture。
 * "看冰箱做菜"为 placeholder，不做真实推荐。
 */

const FIXTURE = require('./fridge-fixture.js')
const { hideTabBar, showTabBar } = require('../../utils/tabbar-overlay.js')
const { createV1Api } = require('../../utils/v1-api')

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
    this._familyId = wx.getStorageSync('v1_active_family_id')
    this._api = createV1Api({ wxAdapter: wx })
    this._loadRealFridge()
  },

  async _loadRealFridge() {
    if (!this._familyId || !this._api) return
    try {
      const items = await this._api.listFridge(this._familyId, {})
      if (items && items.length > 0) {
        const enriched = items.map(i => ({
          ...i,
          freshness_status: this._computeFreshness(i.expiry_date).status,
          expiry_label: this._computeFreshness(i.expiry_date).label
        }))
        const expiring = enriched.filter(i => i.freshness_status === 'EXPIRING')
        this.setData({
          inventoryItems: enriched,
          totalCount: enriched.length,
          expiringCount: expiring.length,
          expiringItems: expiring.slice(0, 3),
          filteredItems: enriched
        })
      }
    } catch (e) {
      // fallback to fixture
    }
  },

  onShow() {
    try { if (this.getTabBar()) this.getTabBar().setData({ selected: 2, hidden: false }) } catch(e) {}
  },

  onHide() { showTabBar(this) },
  onUnload() { showTabBar(this) },

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

  /**
   * 解析数量输入。
   * 空字符串 → 返回 oldValue（编辑时保留旧值，新增时为 0）。
   * NaN → toast 提示，返回 null（调用方应中止保存）。
   * 负数 → toast 提示，返回 null。
   * 合法数字（含 0）→ 返回该数字。
   */
  _parseQuantity(raw, oldValue) {
    if (raw === '' || raw === null || raw === undefined) {
      return oldValue
    }
    const n = Number(raw)
    if (isNaN(n)) {
      wx.showToast({ title: '请输入正确数量', icon: 'none' })
      return null
    }
    if (n < 0) {
      wx.showToast({ title: '数量不能小于0', icon: 'none' })
      return null
    }
    return n
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
    hideTabBar(this)
  },

  closeAddSheet() {
    this.setData({ showAddSheet: false })
    showTabBar(this)
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

  async saveAddItem() {
    const { addForm, inventoryItems } = this.data
    if (!addForm.name || !addForm.name.trim()) {
      wx.showToast({ title: '请输入食材名称', icon: 'none' })
      return
    }
    const qty = this._parseQuantity(addForm.quantity, 0)
    if (qty === null) return
    const fresh = this._computeFreshness(addForm.expiry_date || null)

    // 如果有真实 V1 环境，调用真实 API
    if (this._familyId && this._api) {
      try {
        await this._api.addFridgeItem(this._familyId, {
          name: addForm.name.trim(),
          quantity: qty,
          unit_code: addForm.unit_code,
          storage_location: addForm.storage_location,
          purchase_date: FIXTURE.reference_date,
          expiry_date: addForm.expiry_date || null,
          note: addForm.note || ''
        })
        this.setData({ showAddSheet: false })
        showTabBar(this)
        await this._loadRealFridge()
        wx.showToast({ title: '已添加', icon: 'success' })
        return
      } catch (e) {
        // fallback to fixture
      }
    }

    const newItem = {
      id: 'inv-runtime-' + Date.now(),
      ingredient_id: 'ing-runtime-' + Date.now(),
      name: addForm.name.trim(),
      image: null,
      quantity: qty,
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
    showTabBar(this)
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
    hideTabBar(this)
  },

  closeEditSheet() {
    this.setData({ showEditSheet: false, editingItem: null })
    showTabBar(this)
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
    // 数量校验：空字符串保留旧值；0 允许保存；NaN/负数拒绝
    const qty = this._parseQuantity(editForm.quantity, editingItem.quantity)
    if (qty === null) return
    const fresh = this._computeFreshness(editForm.expiry_date || null)
    const items = inventoryItems.map(i => {
      if (i.id !== editingItem.id) return i
      return {
        ...i,
        quantity: qty,
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
    showTabBar(this)
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
      success: async (res) => {
        if (res.confirm) {
          // 如果有真实 V1 环境，调用真实 API
          if (this._familyId && this._api) {
            try {
              await this._api.deleteFridgeItem(this._familyId, editingItem.id)
              this.setData({ showEditSheet: false, editingItem: null })
              showTabBar(this)
              await this._loadRealFridge()
              wx.showToast({ title: '已移出', icon: 'success' })
              return
            } catch (e) {
              // fallback to fixture
            }
          }
          const items = inventoryItems.filter(i => i.id !== editingItem.id)
          this.setData({
            inventoryItems: items,
            showEditSheet: false,
            editingItem: null,
          })
          showTabBar(this)
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
    hideTabBar(this)
  },

  closeAddStapleSheet() {
    this.setData({ showAddStapleSheet: false })
    showTabBar(this)
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
    showTabBar(this)
    wx.showToast({ title: '已添加（fixture 运行态）', icon: 'none' })
  },

  noop() {},
})
