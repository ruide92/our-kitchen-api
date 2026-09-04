/**
 * 购物清单 Tab — V4 fixture UI
 *
 * 本页面完全使用 shopping-fixture.js 本地演示数据，不接 legacy API。
 * 所有 calculation evidence 均为 fixture 预置，非前端实时计算。
 * 勾选/添加/删除仅修改页面运行态，刷新后恢复 fixture。
 * 完成采购只做 preview，不真的写入冰箱。
 *
 * 注意：不在 onShow 重置 fixture，运行态在切换 Tab 后保留。
 */

const FIXTURE = require('./shopping-fixture.js')

Page({
  data: {
    // 清单元信息
    currentList: null,
    mealSummary: null,

    // 运行态商品
    items: [],
    groupedItems: [],

    // 进度
    totalCount: 0,
    purchasedCount: 0,
    progressPercent: 0,

    // 过滤
    filterMode: 'all', // all | pending | purchased

    // bottom sheet
    showEvidenceSheet: false,
    evidenceItem: null,
    showManualDetailSheet: false,
    manualItem: null,
    showAddSheet: false,
    showCompleteSheet: false,
    purchasedItems: [],

    // 添加表单
    addForm: {
      name: '',
      quantity: '',
      unit: 'g',
      category: '蔬菜',
      note: '',
    },
    unitOptions: FIXTURE.unit_options,
    categoryOptions: FIXTURE.category_options,

    // 编辑手动商品
    editForm: {
      name: '',
      quantity: '',
      unit: 'g',
      category: '蔬菜',
      note: '',
    },
    isEditingManual: false,
    editingManualId: null,
  },

  onLoad() {
    this.initFromFixture()
  },

  // 注意：不实现 onShow 重置。运行态在 Tab 切换后保留。

  initFromFixture() {
    const items = JSON.parse(JSON.stringify(FIXTURE.items))
    this.setData({
      currentList: FIXTURE.current_list,
      mealSummary: FIXTURE.meal_summary,
    })
    this._setItems(items)
  },

  /**
   * 统一设置 items 并刷新分组、进度、过滤。
   */
  _setItems(items) {
    const purchased = items.filter(i => i.is_purchased).length
    const total = items.length
    const percent = total > 0 ? Math.round((purchased / total) * 100) : 0
    this.setData({
      items,
      totalCount: total,
      purchasedCount: purchased,
      progressPercent: percent,
    })
    this._refreshGrouped()
  },

  /**
   * 按 category 分组，并应用当前过滤模式。
   */
  _refreshGrouped() {
    const { items, filterMode } = this.data
    let filtered = items
    if (filterMode === 'pending') {
      filtered = items.filter(i => !i.is_purchased)
    } else if (filterMode === 'purchased') {
      filtered = items.filter(i => i.is_purchased)
    }

    const order = FIXTURE.category_order
    const groups = []
    const seen = new Set()

    // 按预设顺序分组
    order.forEach(cat => {
      const catItems = filtered.filter(i => i.category === cat)
      if (catItems.length > 0) {
        groups.push({ category: cat, items: catItems })
        seen.add(cat)
      }
    })
    // 未在预设顺序中的分类
    filtered.forEach(item => {
      if (!seen.has(item.category)) {
        const existing = groups.find(g => g.category === item.category)
        if (existing) {
          existing.items.push(item)
        } else {
          groups.push({ category: item.category, items: [item] })
        }
        seen.add(item.category)
      }
    })

    this.setData({ groupedItems: groups })
  },

  // ===== 过滤 =====
  setFilter(e) {
    const mode = e.currentTarget.dataset.mode
    this.setData({ filterMode: mode })
    this._refreshGrouped()
  },

  // ===== 勾选购买 =====
  togglePurchased(e) {
    const id = e.currentTarget.dataset.id
    const items = this.data.items.map(i =>
      i.id === id ? { ...i, is_purchased: !i.is_purchased } : i
    )
    this._setItems(items)
  },

  // ===== 从本餐更新（placeholder）=====
  updateFromMeal() {
    wx.showToast({
      title: '真实购物计算将在库存与菜谱引擎接入后启用',
      icon: 'none',
      duration: 2000,
    })
  },

  // ===== 打开 GENERATED 证据详情 =====
  openEvidence(e) {
    const id = e.currentTarget.dataset.id
    const item = this.data.items.find(i => i.id === id)
    if (!item || item.source !== 'GENERATED') return
    this.setData({ showEvidenceSheet: true, evidenceItem: item })
  },

  closeEvidence() {
    this.setData({ showEvidenceSheet: false, evidenceItem: null })
  },

  // ===== 打开 MANUAL 详情 =====
  openManualDetail(e) {
    const id = e.currentTarget.dataset.id
    const item = this.data.items.find(i => i.id === id)
    if (!item || item.source !== 'MANUAL') return
    this.setData({
      showManualDetailSheet: true,
      manualItem: item,
      isEditingManual: false,
      editingManualId: id,
      editForm: {
        name: item.name,
        quantity: String(item.required_quantity || ''),
        unit: item.unit_code || 'g',
        category: item.category === '手动添加' ? '其他' : item.category,
        note: item.note || '',
      },
    })
  },

  closeManualDetail() {
    this.setData({ showManualDetailSheet: false, manualItem: null, isEditingManual: false })
  },

  startEditManual() {
    this.setData({ isEditingManual: true })
  },

  onEditManualInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`editForm.${field}`]: e.detail.value })
  },

  onEditManualUnitChange(e) {
    this.setData({ 'editForm.unit': this.data.unitOptions[e.detail.value] })
  },

  onEditManualCategoryChange(e) {
    this.setData({ 'editForm.category': this.data.categoryOptions[e.detail.value] })
  },

  saveEditManual() {
    const { editingManualId, editForm, items } = this.data
    if (!editForm.name || !editForm.name.trim()) {
      wx.showToast({ title: '请输入商品名称', icon: 'none' })
      return
    }
    const updated = items.map(i => {
      if (i.id !== editingManualId) return i
      return {
        ...i,
        name: editForm.name.trim(),
        required_quantity: Number(editForm.quantity) || 0,
        required_quantity_text: (editForm.quantity || '') + (editForm.unit || ''),
        unit_code: editForm.unit,
        category: editForm.category,
        note: editForm.note,
      }
    })
    this._setItems(updated)
    this.setData({ showManualDetailSheet: false, manualItem: null, isEditingManual: false })
    wx.showToast({ title: '已保存（fixture 运行态）', icon: 'none' })
  },

  deleteManual() {
    const { editingManualId, items } = this.data
    wx.showModal({
      title: '删除',
      content: '确定删除这个手动添加的商品吗？',
      confirmColor: '#E57373',
      success: (res) => {
        if (res.confirm) {
          const updated = items.filter(i => i.id !== editingManualId)
          this._setItems(updated)
          this.setData({ showManualDetailSheet: false, manualItem: null })
          wx.showToast({ title: '已删除（fixture 运行态）', icon: 'none' })
        }
      },
    })
  },

  // ===== 手动添加 =====
  openAddSheet() {
    this.setData({
      showAddSheet: true,
      addForm: { name: '', quantity: '', unit: 'g', category: '蔬菜', note: '' },
    })
  },

  closeAddSheet() {
    this.setData({ showAddSheet: false })
  },

  onAddInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`addForm.${field}`]: e.detail.value })
  },

  onAddUnitChange(e) {
    this.setData({ 'addForm.unit': this.data.unitOptions[e.detail.value] })
  },

  onAddCategoryChange(e) {
    this.setData({ 'addForm.category': this.data.categoryOptions[e.detail.value] })
  },

  saveAddItem() {
    const { addForm, items } = this.data
    if (!addForm.name || !addForm.name.trim()) {
      wx.showToast({ title: '请输入商品名称', icon: 'none' })
      return
    }
    const newItem = {
      id: 'si-runtime-' + Date.now(),
      ingredient_id: null,
      name: addForm.name.trim(),
      category: addForm.category,
      source: 'MANUAL',
      required_quantity: Number(addForm.quantity) || 0,
      required_quantity_text: (addForm.quantity || '') + (addForm.unit || ''),
      unit_code: addForm.unit,
      is_purchased: false,
      note: addForm.note || '',
    }
    this._setItems([...items, newItem])
    this.setData({ showAddSheet: false })
    wx.showToast({ title: '已添加（fixture 运行态）', icon: 'none' })
  },

  // ===== 完成采购 =====
  openCompleteSheet() {
    const purchased = this.data.items.filter(i => i.is_purchased)
    if (purchased.length === 0) return
    this.setData({ showCompleteSheet: true, purchasedItems: purchased })
  },

  closeCompleteSheet() {
    this.setData({ showCompleteSheet: false, purchasedItems: [] })
  },

  confirmComplete() {
    // 本轮只做 toast，不真的写入冰箱
    wx.showToast({
      title: '真实入库将在库存事务接入后启用',
      icon: 'none',
      duration: 2000,
    })
    this.setData({ showCompleteSheet: false, purchasedItems: [] })
  },

  // 阻止 sheet 内容区点击冒泡
  noop() {},
})
