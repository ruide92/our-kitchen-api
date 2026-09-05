/**
 * 冰箱 Tab — Real V1 data mode
 *
 * REAL MODE: no fixture fallback. All CRUD via V1 API.
 * Freshness computed from real today's date.
 * Storage enum mapped: 冷藏->REFRIGERATED, 冷冻->FROZEN, 常温->ROOM_TEMP, 其他->OTHER
 */

const { hideTabBar, showTabBar } = require('../../utils/tabbar-overlay.js')
const { createV1Api } = require('../../utils/v1-api')

const STORAGE_MAP = { '冷藏': 'REFRIGERATED', '冷冻': 'FROZEN', '常温': 'ROOM_TEMP', '其他': 'OTHER' }
const STORAGE_REVERSE = { REFRIGERATED: '冷藏', FROZEN: '冷冻', ROOM_TEMP: '常温', OTHER: '其他' }

const CATEGORIES = ['全部', '蔬菜', '肉蛋', '海鲜', '乳品', '调料', '主食', '水果', '其他']
const UNIT_OPTIONS = ['g', 'kg', 'ml', 'L', '个', '盒', '袋', '根', '瓶']
const STORAGE_OPTIONS = ['冷藏', '冷冻', '常温', '其他']

function pad(n) { return n < 10 ? '0' + n : '' + n }
function todayStr() { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) }

Page({
  data: {
    activeTab: 'inventory',
    inventoryItems: [],
    pantryStaples: [],
    filteredItems: [],
    categories: CATEGORIES,
    currentCategory: '全部',
    searchKeyword: '',
    totalCount: 0,
    expiringCount: 0,
    expiringItems: [],
    loading: false,
    error: null,
    // Sheets
    showAddSheet: false,
    showEditSheet: false,
    editingItem: null,
    showAddStapleSheet: false,
    newStapleName: '',
    // Forms
    addForm: { name: '', quantity: '', unit_code: 'g', storage_location: '冷藏', expiry_date: '', note: '' },
    editForm: { quantity: '', unit_code: 'g', storage_location: '冷藏', expiry_date: '', note: '' },
    unitOptions: UNIT_OPTIONS,
    storageOptions: STORAGE_OPTIONS,
  },

  onLoad() {
    this._familyId = wx.getStorageSync('v1_active_family_id')
    this._api = createV1Api({ wxAdapter: wx })
    this._loadAll()
  },

  onShow() {
    try { if (this.getTabBar()) this.getTabBar().setData({ selected: 2, hidden: false }) } catch (e) {}
    this._loadAll()
  },

  onHide() { showTabBar(this) },
  onUnload() { showTabBar(this) },

  async _loadAll() {
    this._loadFridge()
    this._loadPantry()
  },

  async _loadFridge() {
    if (!this._familyId) return
    this.setData({ loading: true, error: null })
    try {
      const items = await this._api.listFridge(this._familyId, {})
      const enriched = (items || []).map(i => this._enrichItem(i))
      const expiring = enriched.filter(i => i.freshness_status === 'EXPIRING' || i.freshness_status === 'EXPIRED')
      this.setData({
        inventoryItems: enriched,
        totalCount: enriched.length,
        expiringCount: expiring.length,
        expiringItems: expiring.slice(0, 3),
        loading: false,
      })
      this._refreshFiltered()
    } catch (e) {
      this.setData({ loading: false, error: e.message || '加载失败', inventoryItems: [], filteredItems: [] })
    }
  },

  async _loadPantry() {
    if (!this._familyId) return
    try {
      const staples = await this._api.listPantry(this._familyId)
      this.setData({ pantryStaples: staples || [] })
    } catch (e) {
      this.setData({ pantryStaples: [] })
    }
  },

  _enrichItem(item) {
    const fresh = this._computeFreshness(item.expiry_date)
    return {
      ...item,
      storage_label: STORAGE_REVERSE[item.storage_location] || item.storage_location,
      freshness_status: fresh.status,
      expiry_label: fresh.label,
      name: item.display_name_override || item.ingredient_name || '食材',
    }
  },

  _computeFreshness(expiryDate) {
    if (!expiryDate) return { status: 'FRESH', label: '无保质期' }
    const today = new Date(todayStr() + 'T00:00:00')
    const expiry = new Date(expiryDate + 'T00:00:00')
    const days = Math.floor((expiry - today) / 86400000)
    if (days < 0) return { status: 'EXPIRED', label: '已过期' }
    if (days <= 2) return { status: 'EXPIRING', label: days + '天后过期' }
    return { status: 'FRESH', label: days + '天' }
  },

  _refreshFiltered() {
    const { inventoryItems, currentCategory, searchKeyword } = this.data
    let list = inventoryItems
    if (currentCategory !== '全部') list = list.filter(i => (i.category_code || '其他') === currentCategory || i.name.includes(currentCategory))
    if (searchKeyword) list = list.filter(i => i.name.includes(searchKeyword))
    this.setData({ filteredItems: list })
  },

  // ===== Tab switch =====
  switchTab(e) { this.setData({ activeTab: e.currentTarget.dataset.tab }) },
  selectCategory(e) { this.setData({ currentCategory: e.currentTarget.dataset.code }, () => this._refreshFiltered()) },
  onSearchInput(e) { this.setData({ searchKeyword: e.detail.value }, () => this._refreshFiltered()) },

  // ===== Add sheet =====
  openAddSheet() {
    this.setData({ showAddSheet: true, addForm: { name: '', quantity: '', unit_code: 'g', storage_location: '冷藏', expiry_date: '', note: '' } })
    hideTabBar(this)
  },
  closeAddSheet() { this.setData({ showAddSheet: false }); showTabBar(this) },
  onAddInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ ['addForm.' + field]: e.detail.value })
  },
  onAddUnitChange(e) { this.setData({ 'addForm.unit_code': this.data.unitOptions[e.detail.value] }) },
  onAddStorageChange(e) { this.setData({ 'addForm.storage_location': this.data.storageOptions[e.detail.value] }) },
  onAddExpiryChange(e) { this.setData({ 'addForm.expiry_date': e.detail.value }) },

  async saveAddItem() {
    const form = this.data.addForm
    if (!form.name.trim()) { wx.showToast({ title: '请输入食材名', icon: 'none' }); return }
    const qty = Number(form.quantity)
    if (form.quantity && (isNaN(qty) || qty < 0)) { wx.showToast({ title: '请输入正确数量', icon: 'none' }); return }
    wx.showLoading({ title: '添加中...' })
    try {
      // Try resolve ingredient
      let ingredientId = null
      try {
        const resolved = await this._api.resolveIngredient(this._familyId, form.name.trim())
        if (resolved && resolved.match && (resolved.confidence >= 0.95 || resolved.match_type === 'ALIAS_EXACT')) {
          ingredientId = resolved.match.id
        }
      } catch (_) {}
      await this._api.addFridgeItem(this._familyId, {
        ingredient_id: ingredientId,
        display_name_override: ingredientId ? null : form.name.trim(),
        quantity: qty || null,
        quantity_text: form.quantity ? form.quantity + (form.unit_code || '') : null,
        unit_code: form.unit_code || null,
        storage_location: STORAGE_MAP[form.storage_location] || 'REFRIGERATED',
        expiry_date: form.expiry_date || null,
        purchase_date: todayStr(),
        note: form.note || null,
      })
      wx.hideLoading()
      this.closeAddSheet()
      this._loadFridge()
      wx.showToast({ title: '已添加', icon: 'success' })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: e.message || '添加失败', icon: 'none' })
    }
  },

  // ===== Edit sheet =====
  openEditSheet(e) {
    const item = this.data.inventoryItems.find(i => i.id === e.currentTarget.dataset.id)
    if (!item) return
    this.setData({
      showEditSheet: true,
      editingItem: item,
      editForm: {
        quantity: item.quantity != null ? String(item.quantity) : '',
        unit_code: item.unit_code || 'g',
        storage_location: STORAGE_REVERSE[item.storage_location] || '冷藏',
        expiry_date: item.expiry_date || '',
        note: item.note || '',
      },
    })
    hideTabBar(this)
  },
  closeEditSheet() { this.setData({ showEditSheet: false, editingItem: null }); showTabBar(this) },
  onEditInput(e) { this.setData({ ['editForm.' + e.currentTarget.dataset.field]: e.detail.value }) },
  onEditUnitChange(e) { this.setData({ 'editForm.unit_code': this.data.unitOptions[e.detail.value] }) },
  onEditStorageChange(e) { this.setData({ 'editForm.storage_location': this.data.storageOptions[e.detail.value] }) },
  onEditExpiryChange(e) { this.setData({ 'editForm.expiry_date': e.detail.value }) },

  async saveEditItem() {
    const item = this.data.editingItem
    if (!item) return
    const form = this.data.editForm
    const qty = Number(form.quantity)
    if (form.quantity === '') { wx.showToast({ title: '数量不能为空', icon: 'none' }); return }
    if (isNaN(qty)) { wx.showToast({ title: '请输入正确数量', icon: 'none' }); return }
    if (qty < 0) { wx.showToast({ title: '数量不能小于0', icon: 'none' }); return }
    wx.showLoading({ title: '保存中...' })
    try {
      await this._api.updateFridgeItem(this._familyId, item.id, {
        quantity: qty,
        unit_code: form.unit_code || null,
        storage_location: STORAGE_MAP[form.storage_location] || 'REFRIGERATED',
        expiry_date: form.expiry_date || null,
        note: form.note || null,
        version: item.version,
      })
      wx.hideLoading()
      this.closeEditSheet()
      this._loadFridge()
      wx.showToast({ title: '已保存', icon: 'success' })
    } catch (e) {
      wx.hideLoading()
      if (e.status === 409 || e.code === 'VERSION_CONFLICT') {
        wx.showToast({ title: '数据已被家人修改，请刷新', icon: 'none' })
        this._loadFridge()
      } else {
        wx.showToast({ title: e.message || '保存失败', icon: 'none' })
      }
    }
  },

  // ===== Delete =====
  deleteItem(e) {
    const id = e.currentTarget.dataset.id
    const item = this.data.inventoryItems.find(i => i.id === id)
    wx.showModal({
      title: '删除食材',
      content: '确定删除「' + (item?.name || '食材') + '」吗？',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await this._api.deleteFridgeItem(this._familyId, id)
          this._loadFridge()
          wx.showToast({ title: '已删除', icon: 'success' })
        } catch (e) {
          wx.showToast({ title: e.message || '删除失败', icon: 'none' })
        }
      },
    })
  },

  // ===== Pantry =====
  openAddStapleSheet() {
    this.setData({ showAddStapleSheet: true, newStapleName: '' })
    hideTabBar(this)
  },
  closeAddStapleSheet() { this.setData({ showAddStapleSheet: false }); showTabBar(this) },
  onStapleNameInput(e) { this.setData({ newStapleName: e.detail.value }) },

  async saveAddStaple() {
    const name = this.data.newStapleName.trim()
    if (!name) { wx.showToast({ title: '请输入食材名', icon: 'none' }); return }
    wx.showLoading({ title: '添加中...' })
    try {
      let ingredientId = null
      try {
        const resolved = await this._api.resolveIngredient(this._familyId, name)
        if (resolved && resolved.match && (resolved.confidence >= 0.95 || resolved.match_type === 'ALIAS_EXACT')) {
          ingredientId = resolved.match.id
        }
      } catch (_) {}
      if (!ingredientId) {
        wx.hideLoading()
        wx.showToast({ title: '未找到标准食材，暂不支持自定义常备品', icon: 'none' })
        return
      }
      await this._api.putPantry(this._familyId, ingredientId, { assume_available: true, quantity: null, unit_code: null })
      wx.hideLoading()
      this.closeAddStapleSheet()
      this._loadPantry()
      wx.showToast({ title: '已添加', icon: 'success' })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: e.message || '添加失败', icon: 'none' })
    }
  },

  async removeStaple(e) {
    const ingredientId = e.currentTarget.dataset.ingredientId
    try {
      await this._api.deletePantry(this._familyId, ingredientId)
      this._loadPantry()
      wx.showToast({ title: '已移除', icon: 'success' })
    } catch (e) {
      wx.showToast({ title: e.message || '移除失败', icon: 'none' })
    }
  },

  // ===== Cook with fridge (placeholder) =====
  cookWithFridge() { wx.showToast({ title: '看冰箱做菜将在推荐引擎接入后启用', icon: 'none' }) },

  onPullDownRefresh() {
    this._loadAll()
    wx.stopPullDownRefresh()
  },
})
