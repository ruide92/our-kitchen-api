/**
 * 购物清单 Tab — Real V1 data mode
 *
 * REAL MODE: no fixture fallback. All CRUD via V1 API.
 * Evidence from real API calculation. Complete purchase writes to fridge.
 */

const { hideTabBar, showTabBar } = require('../../utils/tabbar-overlay.js')
const { createV1Api } = require('../../utils/v1-api')
const { toCode, toLabel, formatQuantity, UI_UNIT_OPTIONS } = require('../../utils/unit-display.js')

const UNIT_OPTIONS = UI_UNIT_OPTIONS
const CATEGORY_OPTIONS = ['蔬菜', '肉蛋', '海鲜', '乳品', '调料', '主食', '水果', '其他']
const CATEGORY_ORDER = ['蔬菜', '肉蛋', '海鲜', '乳品', '调料', '主食', '水果', '其他']
const STORAGE_OPTIONS = ['冷藏', '冷冻', '常温', '其他']
const STORAGE_MAP = { '冷藏': 'REFRIGERATED', '冷冻': 'FROZEN', '常温': 'ROOM_TEMP', '其他': 'OTHER' }

Page({
  data: {
    currentList: null,
    mealSummary: null,
    items: [],
    groupedItems: [],
    totalCount: 0,
    purchasedCount: 0,
    progressPercent: 0,
    filterMode: 'all',
    loading: false,
    error: null,
    // Sheets
    showEvidenceSheet: false,
    evidenceItem: null,
    showManualDetailSheet: false,
    manualItem: null,
    showAddSheet: false,
    showCompleteSheet: false,
    purchasedItems: [],
    // Forms
    addForm: { name: '', quantity: '', unit: 'g', customUnit: '', category: '蔬菜', note: '' },
    editForm: { name: '', quantity: '', unit: 'g', customUnit: '', category: '蔬菜', note: '' },
    isEditingManual: false,
    editingManualId: null,
    unitOptions: UNIT_OPTIONS,
    categoryOptions: CATEGORY_OPTIONS,
    storageOptions: STORAGE_OPTIONS,
  },

  onLoad() {
    this._familyId = wx.getStorageSync('v1_active_family_id')
    this._api = createV1Api({ wxAdapter: wx })
    this._loadShopping()
  },

  onShow() {
    try { if (this.getTabBar()) this.getTabBar().setData({ selected: 3, hidden: false }) } catch (e) {}
    this._loadShopping()
  },

  onHide() { showTabBar(this) },
  onUnload() { showTabBar(this) },

  async _loadShopping() {
    if (!this._familyId) return
    this.setData({ loading: true, error: null })
    try {
      const list = await this._api.getCurrentShoppingList(this._familyId)
      if (list && list.id) {
        this.setData({ currentList: list, mealSummary: list.meal_summary || null, loading: false })
        this._setItems(list.items || [])
      } else {
        this.setData({ currentList: null, items: [], groupedItems: [], totalCount: 0, purchasedCount: 0, progressPercent: 0, loading: false })
      }
    } catch (e) {
      this.setData({ loading: false, error: e.message || '加载失败', currentList: null, items: [], groupedItems: [] })
    }
  },

  _setItems(items) {
    const enriched = (items || []).map(i => ({
      ...i,
      name: i.display_name_override || i.ingredient_name || '商品',
      quantity_label: formatQuantity(i.required_quantity, i.unit_code, i.required_quantity_text),
      missing_label: formatQuantity(i.missing_quantity, i.unit_code, null),
    }))
    const purchased = enriched.filter(i => i.is_purchased).length
    const total = enriched.length
    const percent = total > 0 ? Math.round((purchased / total) * 100) : 0
    this.setData({ items: enriched, totalCount: total, purchasedCount: purchased, progressPercent: percent })
    this._refreshGrouped()
  },

  _refreshGrouped() {
    const { items, filterMode } = this.data
    let filtered = items
    if (filterMode === 'pending') filtered = items.filter(i => !i.is_purchased)
    else if (filterMode === 'purchased') filtered = items.filter(i => i.is_purchased)

    const orderSet = new Set(CATEGORY_ORDER)
    const groups = []
    CATEGORY_ORDER.forEach(cat => {
      const catItems = filtered.filter(i => (i.category || '其他') === cat)
      if (catItems.length > 0) groups.push({ category: cat, items: catItems })
    })
    filtered.forEach(item => {
      if (orderSet.has(item.category || '其他')) return
      const existing = groups.find(g => g.category === item.category)
      if (existing) existing.items.push(item)
      else groups.push({ category: item.category || '其他', items: [item] })
    })
    this.setData({ groupedItems: groups })
  },

  setFilter(e) { this.setData({ filterMode: e.currentTarget.dataset.mode }, () => this._refreshGrouped()) },

  // ===== Toggle purchased (real API, no local fallback) =====
  async togglePurchased(e) {
    const id = e.currentTarget.dataset.id
    const item = this.data.items.find(i => i.id === id)
    if (!item || !this.data.currentList) return
    const newPurchased = !item.is_purchased
    try {
      await this._api.updateShoppingItem(this._familyId, this.data.currentList.id, id, { is_purchased: newPurchased })
      const items = this.data.items.map(i => i.id === id ? { ...i, is_purchased: newPurchased } : i)
      this._setItems(items)
    } catch (e) {
      wx.showToast({ title: e.message || '更新失败', icon: 'none' })
    }
  },

  // ===== Update from meal (real generate) =====
  async updateFromMeal() {
    if (!this.data.currentList || !this.data.currentList.meal_id) {
      wx.showToast({ title: '请先从本餐菜单生成购物清单', icon: 'none' })
      return
    }
    wx.showLoading({ title: '更新中...' })
    try {
      await this._api.generateShoppingList(this._familyId, { meal_id: this.data.currentList.meal_id, mode: 'REPLACE_GENERATED' })
      wx.hideLoading()
      this._loadShopping()
      wx.showToast({ title: '已从本餐更新', icon: 'success' })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: e.message || '更新失败', icon: 'none' })
    }
  },

  // ===== Evidence sheet =====
  openEvidence(e) {
    const item = this.data.items.find(i => i.id === e.currentTarget.dataset.id)
    if (!item || item.source !== 'GENERATED') return
    this.setData({ showEvidenceSheet: true, evidenceItem: item })
    hideTabBar(this)
  },
  closeEvidence() { this.setData({ showEvidenceSheet: false, evidenceItem: null }); showTabBar(this) },

  // ===== Manual detail =====
  openManualDetail(e) {
    const item = this.data.items.find(i => i.id === e.currentTarget.dataset.id)
    if (!item || item.source !== 'MANUAL') return
    const standardUnits = UNIT_OPTIONS.filter(u => u !== '自定义')
    const isCustom = !item.unit_code || !standardUnits.includes(toLabel(item.unit_code))
    this.setData({
      showManualDetailSheet: true,
      manualItem: item,
      isEditingManual: false,
      editingManualId: item.id,
      editForm: {
        name: item.name,
        quantity: String(item.required_quantity || ''),
        unit: isCustom ? '自定义' : toLabel(item.unit_code),
        customUnit: isCustom ? (item.unit_text || item.required_quantity_text || '') : '',
        category: item.category || '其他',
        note: item.note || '',
      },
    })
    hideTabBar(this)
  },
  closeManualDetail() { this.setData({ showManualDetailSheet: false, manualItem: null, isEditingManual: false }); showTabBar(this) },
  startEditManual() { this.setData({ isEditingManual: true }) },
  onEditManualInput(e) { this.setData({ ['editForm.' + e.currentTarget.dataset.field]: e.detail.value }) },
  onEditManualUnitChange(e) { this.setData({ 'editForm.unit': this.data.unitOptions[e.detail.value] }) },
  onEditManualCategoryChange(e) { this.setData({ 'editForm.category': this.data.categoryOptions[e.detail.value] }) },
  onEditManualCustomUnitInput(e) { this.setData({ 'editForm.customUnit': e.detail.value }) },

  async saveEditManual() {
    const { editingManualId, editForm } = this.data
    if (!editForm.name || !editForm.name.trim()) { wx.showToast({ title: '请输入商品名称', icon: 'none' }); return }
    const isCustom = editForm.unit === '自定义'
    if (isCustom && !editForm.customUnit.trim()) { wx.showToast({ title: '请输入自定义单位', icon: 'none' }); return }
    const unitCode = isCustom ? null : toCode(editForm.unit)
    const quantityText = isCustom ? (editForm.quantity || '') + editForm.customUnit.trim() : (editForm.quantity ? editForm.quantity + (toLabel(unitCode) || '') : null)
    wx.showLoading({ title: '保存中...' })
    try {
      await this._api.updateShoppingItem(this._familyId, this.data.currentList.id, editingManualId, {
        display_name_override: editForm.name.trim(),
        required_quantity: Number(editForm.quantity) || 0,
        required_quantity_text: quantityText,
        unit_code: unitCode,
        note: editForm.note || null,
      })
      wx.hideLoading()
      this.closeManualDetail()
      this._loadShopping()
      wx.showToast({ title: '已保存', icon: 'success' })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: e.message || '保存失败', icon: 'none' })
    }
  },

  deleteManual() {
    const { editingManualId } = this.data
    wx.showModal({
      title: '删除',
      content: '确定删除这个商品吗？',
      confirmColor: '#E57373',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await this._api.deleteShoppingItem(this._familyId, this.data.currentList.id, editingManualId)
          this.closeManualDetail()
          this._loadShopping()
          wx.showToast({ title: '已删除', icon: 'success' })
        } catch (e) {
          wx.showToast({ title: e.message || '删除失败', icon: 'none' })
        }
      },
    })
  },

  // ===== Add manual =====
  openAddSheet() {
    if (!this.data.currentList) {
      wx.showToast({ title: '请先从本餐菜单生成购物清单', icon: 'none' })
      return
    }
    this.setData({ showAddSheet: true, addForm: { name: '', quantity: '', unit: 'g', customUnit: '', category: '蔬菜', note: '' } })
    hideTabBar(this)
  },
  closeAddSheet() { this.setData({ showAddSheet: false }); showTabBar(this) },
  onAddInput(e) { this.setData({ ['addForm.' + e.currentTarget.dataset.field]: e.detail.value }) },
  onAddUnitChange(e) { this.setData({ 'addForm.unit': this.data.unitOptions[e.detail.value] }) },
  onAddCategoryChange(e) { this.setData({ 'addForm.category': this.data.categoryOptions[e.detail.value] }) },
  onAddCustomUnitInput(e) { this.setData({ 'addForm.customUnit': e.detail.value }) },

  async saveAddItem() {
    const { addForm } = this.data
    if (!addForm.name || !addForm.name.trim()) { wx.showToast({ title: '请输入商品名称', icon: 'none' }); return }
    const isCustom = addForm.unit === '自定义'
    if (isCustom && !addForm.customUnit.trim()) { wx.showToast({ title: '请输入自定义单位', icon: 'none' }); return }
    const unitCode = isCustom ? null : toCode(addForm.unit)
    const quantityText = isCustom ? (addForm.quantity || '') + addForm.customUnit.trim() : (addForm.quantity ? addForm.quantity + (toLabel(unitCode) || '') : null)
    wx.showLoading({ title: '添加中...' })
    try {
      await this._api.addShoppingItem(this._familyId, this.data.currentList.id, {
        name: addForm.name.trim(),
        required_quantity: Number(addForm.quantity) || 0,
        required_quantity_text: quantityText,
        unit_code: unitCode,
        note: addForm.note || null,
        source: 'MANUAL',
      })
      wx.hideLoading()
      this.closeAddSheet()
      this._loadShopping()
      wx.showToast({ title: '已添加', icon: 'success' })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: e.message || '添加失败', icon: 'none' })
    }
  },

  // ===== Complete purchase =====
  openCompleteSheet() {
    const purchased = this.data.items.filter(i => i.is_purchased)
    if (purchased.length === 0) { wx.showToast({ title: '请先勾选已购买的商品', icon: 'none' }); return }
    const purchasedItems = purchased.map(i => ({
      ...i,
      purchased_quantity: i.purchased_quantity != null ? i.purchased_quantity : (i.missing_quantity != null ? i.missing_quantity : i.required_quantity),
      storage_location: '冷藏',
      expiry_date: '',
    }))
    this.setData({ showCompleteSheet: true, purchasedItems })
    hideTabBar(this)
  },
  closeCompleteSheet() { this.setData({ showCompleteSheet: false, purchasedItems: [] }); showTabBar(this) },
  onCompleteQtyInput(e) {
    const idx = e.currentTarget.dataset.index
    this.setData({ ['purchasedItems[' + idx + '].purchased_quantity']: Number(e.detail.value) || 0 })
  },
  onCompleteStorageChange(e) {
    const idx = e.currentTarget.dataset.index
    this.setData({ ['purchasedItems[' + idx + '].storage_location']: this.data.storageOptions[e.detail.value] })
  },
  onCompleteExpiryChange(e) {
    const idx = e.currentTarget.dataset.index
    this.setData({ ['purchasedItems[' + idx + '].expiry_date']: e.detail.value })
  },

  async confirmComplete() {
    if (!this.data.currentList) return
    const items = this.data.purchasedItems.map(i => ({
      item_id: i.id,
      purchased_quantity: i.purchased_quantity,
      storage_location: STORAGE_MAP[i.storage_location] || 'REFRIGERATED',
      expiry_date: i.expiry_date || null,
    }))
    wx.showLoading({ title: '入库中...' })
    try {
      await this._api.completeShoppingList(this._familyId, this.data.currentList.id, { items })
      wx.hideLoading()
      this.closeCompleteSheet()
      this._loadShopping()
      wx.showToast({ title: '采购完成，已入冰箱', icon: 'success', duration: 2000 })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: e.message || '入库失败', icon: 'none' })
    }
  },

  goToMeal() { wx.switchTab({ url: '/pages/menu/menu' }) },

  noop() {},
})
