/**
 * 菜单 Tab — Real V1 data mode
 *
 * REAL MODE: authenticated + active family -> no fixture fallback.
 * Recipes from GET /recipes, weekly from GET /weekly-plans.
 * Manual add only writes to Meal, never Weekly Plan.
 */

const { createV1Api } = require('../../utils/v1-api')
const { createMealTarget } = require('../../utils/meal-target')
const { hideTabBar, showTabBar } = require('../../utils/tabbar-overlay')

const MEAL_META = {
  BREAKFAST: { key: 'BREAKFAST', label: '早餐', icon: '🌅' },
  LUNCH: { key: 'LUNCH', label: '午餐', icon: '☀️' },
  DINNER: { key: 'DINNER', label: '晚餐', icon: '🌙' },
}

const WEEK_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const CATEGORIES = [
  { code: 'RECOMMEND', label: '推荐' },
  { code: 'HOT_DISH', label: '热菜' },
  { code: 'COLD_DISH', label: '凉菜' },
  { code: 'SOUP', label: '汤' },
  { code: 'STAPLE', label: '主食' },
  { code: 'FAVORITES', label: '收藏' },
  { code: 'MY_RECIPES', label: '我家' },
]

function pad(n) { return n < 10 ? '0' + n : '' + n }
function formatDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) }

Page({
  data: {
    activeTab: 'weekly',
    // Week
    weekStartDate: '',
    weekRangeText: '',
    weekDays: [],
    selectedDayIndex: 0,
    selectedDate: '',
    selectedMeals: [],
    weeklyPlan: null,
    editingPlan: null,
    weeklyStatus: 'loading', // loading | error | empty | active | draft
    weeklyLoading: false,
    weeklyError: null,
    weeklyBusy: false,
    canEditWeekly: true,
    // Recipes
    categories: CATEGORIES,
    currentCategory: 'RECOMMEND',
    recipes: [],
    filteredRecipes: [],
    searchText: '',
    recipesLoading: false,
    recipesError: null,
    // Meal target
    targetMeal: { meal_date: '', meal_type: 'DINNER', diners_count: 2 },
    targetMealText: '',
    targetMealOptions: [],
    showTargetPicker: false,
    showCustomDate: false,
    customDate: '',
    customMealType: 'DINNER',
    // Mini cart
    miniCartCount: 0,
    miniCartVisible: false,
    miniCartLoading: false,
    miniCartError: null,
  },

  onLoad() {
    this._familyId = wx.getStorageSync('v1_active_family_id')
    this._api = createV1Api({ wxAdapter: wx })
    this._mealTarget = createMealTarget({ wxAdapter: wx })
    this._weeklyEpoch = 0
    this._buildWeekDays()
    this._loadAll()
  },

  onHide() { showTabBar(this) },

  onUnload() { showTabBar(this) },

  onShow() {
    if (this._mealTarget) {
      const target = this._mealTarget.get()
      this.setData({ targetMeal: target })
      this._refreshTargetMealText()
    }
    this._refreshMiniCart()
    if (!this.data.showTargetPicker) { try { if (this.getTabBar()) this.getTabBar().setData({ selected: 1, hidden: false }) } catch (e) {} }
  },

  _buildWeekDays() {
    const now = new Date()
    const day = now.getDay() // 0=Sun
    const mondayOffset = day === 0 ? -6 : 1 - day
    const monday = new Date(now)
    monday.setDate(now.getDate() + mondayOffset)
    const weekDays = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      const dateStr = formatDate(d)
      weekDays.push({
        index: i,
        label: WEEK_LABELS[i],
        date: (d.getMonth() + 1) + '.' + d.getDate(),
        fullDate: dateStr,
        isToday: dateStr === formatDate(now),
      })
    }
    const todayIndex = weekDays.findIndex(d => d.isToday)
    this.setData({
      weekStartDate: weekDays[0].fullDate,
      weekRangeText: weekDays[0].date + ' - ' + weekDays[6].date,
      weekDays,
      selectedDayIndex: todayIndex >= 0 ? todayIndex : 0,
      selectedDate: weekDays[todayIndex >= 0 ? todayIndex : 0].fullDate,
    })
  },

  async _loadAll() {
    this._loadRecipes()
    this._loadWeeklyPlan()
  },

  retryRecipes() { this._loadRecipes() },
  retryWeekly() { this._loadWeeklyPlan() },

  // ===== Recipes (real API) =====
  async _loadRecipes() {
    if (!this._familyId) {
      this.setData({ recipesError: '未登录家庭' })
      return
    }
    this.setData({ recipesLoading: true, recipesError: null })
    try {
      const recipes = await this._api.listRecipes(this._familyId, {})
      const list = (recipes || []).map(r => ({
        ...r,
        spicyText: r.spiciness > 0 ? '🌶️'.repeat(Math.min(r.spiciness, 5)) : '',
        timeText: r.cook_time_minutes ? r.cook_time_minutes + '分钟' : '',
        familyVariantText: (r.has_family_variant || r.kind === 'FAMILY') ? '我家版本' : '',
      }))
      this.setData({ recipes: list, filteredRecipes: list, recipesLoading: false })
      this._applyFilter()
    } catch (e) {
      this.setData({ recipesLoading: false, recipesError: e.message || '加载失败' })
    }
  },

  // ===== Weekly plan (real API, null = empty) =====
  async _loadWeeklyPlan() {
    if (!this._familyId) return
    const epoch = ++this._weeklyEpoch
    this.setData({ weeklyLoading: true, weeklyError: null, weeklyStatus: 'loading' })
    try {
      // Load role for edit permission
      try {
        const user = wx.getStorageSync('v1_user') || {}
        const members = await this._api.getMembers(this._familyId)
        const me = (members || []).find(m => m.user_id === user.id)
        this.setData({ canEditWeekly: !me || me.role === 'OWNER' || me.role === 'ADMIN' })
      } catch (e) { /* keep default */ }
      const plan = await this._api.getWeeklyPlan(this._familyId, this.data.weekStartDate)
      if (epoch !== this._weeklyEpoch) return
      this.setData({
        weeklyPlan: plan,
        editingPlan: null,
        weeklyStatus: plan ? 'active' : 'empty',
        weeklyLoading: false
      })
      this._refreshSelectedMeals()
    } catch (e) {
      if (epoch !== this._weeklyEpoch) return
      this.setData({ weeklyLoading: false, weeklyError: e.message || '加载失败', weeklyStatus: 'error' })
    }
  },

  // Get the plan currently being displayed (editing DRAFT or ACTIVE)
  _currentPlan() {
    return this.data.editingPlan || this.data.weeklyPlan
  },

  // Ensure we have a DRAFT to edit (copy from ACTIVE if needed)
  async _ensureDraft() {
    if (this.data.editingPlan) return this.data.editingPlan
    const active = this.data.weeklyPlan
    if (!active) throw new Error('没有可编辑的周计划')
    if (active.status === 'DRAFT') {
      this.setData({ editingPlan: active, weeklyStatus: 'draft' })
      return active
    }
    const draft = await this._api.generateWeeklyPlan(this._familyId, { copy_from_plan_id: active.id })
    this.setData({ editingPlan: draft, weeklyStatus: 'draft' })
    return draft
  },

  // Apply a new DRAFT plan (from regenerate etc.)
  _applyDraft(plan) {
    this.setData({ editingPlan: plan, weeklyPlan: plan, weeklyStatus: 'draft' })
    this._refreshSelectedMeals()
  },

  async generateWeekly() {
    if (this.data.weeklyBusy) return
    const epoch = ++this._weeklyEpoch
    this.setData({ weeklyBusy: true })
    wx.showLoading({ title: '生成中...' })
    try {
      const settings = await this._api.getSettings(this._familyId)
      const mode = (settings && settings.random_default_mode) || 'BALANCED'
      const plan = await this._api.generateWeeklyPlan(this._familyId, {
        week_start: this.data.weekStartDate,
        mode
      })
      if (epoch !== this._weeklyEpoch) return
      this._applyDraft(plan)
      wx.hideLoading()
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: e.message || '生成失败', icon: 'none' })
    } finally {
      if (epoch === this._weeklyEpoch) this.setData({ weeklyBusy: false })
    }
  },

  async confirmWeekly() {
    if (this.data.weeklyBusy) return
    const draft = this.data.editingPlan
    if (!draft || draft.status !== 'DRAFT') return
    this.setData({ weeklyBusy: true })
    wx.showLoading({ title: '确认中...' })
    try {
      await this._api.confirmWeeklyPlan(this._familyId, draft.id)
      const plan = await this._api.getWeeklyPlan(this._familyId, this.data.weekStartDate)
      this.setData({ weeklyPlan: plan, editingPlan: null, weeklyStatus: 'active', weeklyBusy: false })
      this._refreshSelectedMeals()
      wx.hideLoading()
      wx.showToast({ title: '本周安排已确认', icon: 'success' })
    } catch (e) {
      wx.hideLoading()
      this.setData({ weeklyBusy: false })
      wx.showToast({ title: e.message || '确认失败', icon: 'none' })
    }
  },

  discardDraft() {
    this.setData({ editingPlan: null, weeklyStatus: this.data.weeklyPlan ? 'active' : 'empty' })
    this._refreshSelectedMeals()
  },

  retryWeekly() {
    this._loadWeeklyPlan()
  },

  _refreshSelectedMeals() {
    const { selectedDate } = this.data
    const plan = this._currentPlan()
    const items = plan && plan.items ? plan.items.filter(it => it.plan_date === selectedDate) : []
    const meals = ['BREAKFAST', 'LUNCH', 'DINNER'].map(mealKey => {
      const meta = MEAL_META[mealKey]
      const dishes = items
        .filter(it => it.meal_type === mealKey)
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
        .map(it => ({
          id: it.id,
          recipeId: it.recipe_id,
          name: it.recipe_name || '菜谱',
          coverImageUrl: it.cover_image_url || null,
          locked: it.locked || false,
          initial: (it.recipe_name || '菜').charAt(0),
        }))
      return { key: mealKey, label: meta.label, icon: meta.icon, count: dishes.length, dishes }
    })
    this.setData({ selectedMeals: meals })
  },

  // ===== Meal target =====
  _refreshTargetMealText() {
    const { targetMeal } = this.data
    const mealLabel = MEAL_META[targetMeal.meal_type] ? MEAL_META[targetMeal.meal_type].label : targetMeal.meal_type
    const today = formatDate(new Date())
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowStr = formatDate(tomorrow)
    let dayLabel = targetMeal.meal_date
    if (targetMeal.meal_date === today) dayLabel = '今天'
    else if (targetMeal.meal_date === tomorrowStr) dayLabel = '明天'
    this.setData({ targetMealText: dayLabel + mealLabel })
  },

  openTargetPicker() {
    hideTabBar(this)
    const options = this._mealTarget.options()
    this.setData({ targetMealOptions: options, showTargetPicker: true })
  },

  closeTargetPicker() {
    showTabBar(this)
    this.setData({ showTargetPicker: false })
  },

  selectTargetMeal(e) {
    const idx = e.currentTarget.dataset.index
    const option = this.data.targetMealOptions[idx]
    if (!option) return
    if (option.isCustom) {
      const today = new Date()
      const dateStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0')
      this.setData({ showCustomDate: true, customDate: dateStr, customMealType: 'DINNER' })
      return
    }
    const target = this._mealTarget.update({ meal_date: option.meal_date, meal_type: option.meal_type })
    showTabBar(this)
    this.setData({ targetMeal: target, showTargetPicker: false }, () => {
      this._refreshTargetMealText()
      this._refreshMiniCart()
    })
  },

  onCustomDateChange(e) {
    this.setData({ customDate: e.detail.value })
  },

  onCustomMealTypeChange(e) {
    this.setData({ customMealType: e.currentTarget.dataset.type })
  },

  confirmCustomDate() {
    const { customDate, customMealType } = this.data
    if (!customDate) return
    const target = this._mealTarget.update({ meal_date: customDate, meal_type: customMealType })
    showTabBar(this)
    this.setData({ targetMeal: target, showTargetPicker: false, showCustomDate: false }, () => {
      this._refreshTargetMealText()
      this._refreshMiniCart()
    })
  },

  cancelCustomDate() {
    this.setData({ showCustomDate: false })
  },

  // ===== Mini cart (real Meal API) =====
  async _refreshMiniCart() {
    if (!this._familyId || !this._api) return
    const { targetMeal } = this.data
    this.setData({ miniCartLoading: true, miniCartError: null })
    try {
      const meal = await this._api.getCurrentMeal(this._familyId, targetMeal.meal_date, targetMeal.meal_type)
      const count = meal && meal.items ? meal.items.length : 0
      this.setData({ miniCartCount: count, miniCartVisible: count > 0, miniCartLoading: false, miniCartError: null })
    } catch (e) {
      if (e.status === 404 || e.code === 'NOT_FOUND') {
        this.setData({ miniCartCount: 0, miniCartVisible: false, miniCartLoading: false, miniCartError: null })
      } else {
        // Network/500/401/403: preserve last valid count, record error
        this.setData({ miniCartLoading: false, miniCartError: e.message || '加载失败' })
      }
    }
  },

  // ===== UI actions =====
  switchTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab })
  },

  selectDay(e) {
    const index = e.currentTarget.dataset.index
    const day = this.data.weekDays[index]
    this.setData({ selectedDayIndex: index, selectedDate: day.fullDate }, () => this._refreshSelectedMeals())
  },

  selectCategory(e) {
    this.setData({ currentCategory: e.currentTarget.dataset.code }, () => this._applyFilter())
  },

  onSearchInput(e) {
    this.setData({ searchText: e.detail.value }, () => this._applyFilter())
  },

  _applyFilter() {
    const { recipes, currentCategory, searchText } = this.data
    let list = recipes
    if (currentCategory === 'FAVORITES') list = list.filter(r => r.is_favorite)
    else if (currentCategory === 'MY_RECIPES') list = list.filter(r => r.kind === 'FAMILY')
    else if (currentCategory !== 'RECOMMEND') list = list.filter(r => r.category_code === currentCategory)
    if (searchText) {
      const kw = searchText.toLowerCase()
      list = list.filter(r => r.name.toLowerCase().includes(kw))
    }
    this.setData({ filteredRecipes: list })
  },

  // ===== Add recipe to current Meal (real API, never Weekly) =====
  async addRecipeToMeal(e) {
    const clickedId = e.currentTarget.dataset.recipeId
    const clickedRecipe = this.data.recipes.find(r => r.id === clickedId)
    if (!clickedRecipe) return
    let effectiveId = clickedId
    if (clickedRecipe.kind === 'BASE' && clickedRecipe.has_family_variant && clickedRecipe.family_variant_id) {
      effectiveId = clickedRecipe.family_variant_id
    }
    const { targetMeal } = this.data
    if (!this._familyId || !this._api) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    wx.showLoading({ title: '加入中...' })
    try {
      let meal = await this._api.getCurrentMeal(this._familyId, targetMeal.meal_date, targetMeal.meal_type)
      if (!meal || !meal.id) {
        meal = await this._api.ensureCurrentMeal(this._familyId, {
          meal_date: targetMeal.meal_date,
          meal_type: targetMeal.meal_type,
          diners_count: targetMeal.diners_count || 2,
        })
      }
      await this._api.addMealItem(this._familyId, meal.id, { recipe_id: effectiveId, servings: targetMeal.diners_count || 2 })
      wx.hideLoading()
      this._refreshMiniCart()
      wx.showToast({ title: this._mealTarget.toastLabel(targetMeal), icon: 'success', duration: 1000 })
    } catch (err) {
      wx.hideLoading()
      if (err.code === 'ALREADY_IN_MEAL') {
        wx.showToast({ title: '已在' + this.data.targetMealText + '中', icon: 'none' })
      } else {
        wx.showToast({ title: err.message || '加入失败', icon: 'none' })
      }
    }
  },

  goTodayMenu() {
    const { targetMeal } = this.data
    wx.navigateTo({
      url: '/pages/meal/meal?date=' + targetMeal.meal_date + '&meal_type=' + targetMeal.meal_type,
    })
  },

  // ===== Weekly management (real V1 API) =====
  async toggleLock(e) {
    if (this.data.weeklyBusy || !this.data.canEditWeekly) return
    const itemId = e.currentTarget.dataset.itemId
    const plan = this._currentPlan()
    const item = plan && plan.items ? plan.items.find(i => i.id === itemId) : null
    if (!item) return
    try {
      const draft = await this._ensureDraft()
      this.setData({ weeklyBusy: true })
      await this._api.updateWeeklyPlanItem(this._familyId, draft.id, itemId, { locked: !item.locked })
      const refreshed = await this._api.getWeeklyPlan(this._familyId, this.data.weekStartDate)
      // If we were editing a DRAFT, the GET returns ACTIVE; need to re-fetch DRAFT
      // Simpler: reload the DRAFT by copy again if needed
      this.setData({ weeklyPlan: refreshed, editingPlan: null, weeklyStatus: refreshed ? 'active' : 'empty', weeklyBusy: false })
      this._refreshSelectedMeals()
    } catch (err) {
      this.setData({ weeklyBusy: false })
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    }
  },

  async swapDish(e) {
    if (this.data.weeklyBusy || !this.data.canEditWeekly) return
    const itemId = e.currentTarget.dataset.itemId
    const plan = this._currentPlan()
    const item = plan && plan.items ? plan.items.find(i => i.id === itemId) : null
    if (!item) return
    if (item.locked) {
      wx.showToast({ title: '请先解锁这道菜', icon: 'none' })
      return
    }
    try {
      const draft = await this._ensureDraft()
      const epoch = ++this._weeklyEpoch
      this.setData({ weeklyBusy: true })
      const newDraft = await this._api.regenerateWeeklyPlan(this._familyId, draft.id, {
        scope: 'MEAL',
        plan_date: item.plan_date,
        meal_type: item.meal_type,
        swap_item_id: item.id
      })
      if (epoch !== this._weeklyEpoch) return
      this._applyDraft(newDraft)
      this.setData({ weeklyBusy: false })
    } catch (err) {
      this.setData({ weeklyBusy: false })
      wx.showToast({ title: err.message || '换一道失败', icon: 'none' })
    }
  },

  async removePlanItem(e) {
    if (this.data.weeklyBusy || !this.data.canEditWeekly) return
    const itemId = e.currentTarget.dataset.itemId
    const plan = this._currentPlan()
    const item = plan && plan.items ? plan.items.find(i => i.id === itemId) : null
    if (!item) return
    const doDelete = async () => {
      try {
        const draft = await this._ensureDraft()
        this.setData({ weeklyBusy: true })
        await this._api.deleteWeeklyPlanItem(this._familyId, draft.id, itemId)
        const refreshed = await this._api.getWeeklyPlan(this._familyId, this.data.weekStartDate)
        this.setData({ weeklyPlan: refreshed, editingPlan: null, weeklyStatus: refreshed ? 'active' : 'empty', weeklyBusy: false })
        this._refreshSelectedMeals()
      } catch (err) {
        this.setData({ weeklyBusy: false })
        wx.showToast({ title: err.message || '删除失败', icon: 'none' })
      }
    }
    if (item.locked) {
      wx.showModal({
        title: '删除锁定菜',
        content: '这道菜已锁定，确定要删除吗？',
        success: (res) => { if (res.confirm) doDelete() }
      })
    } else {
      await doDelete()
    }
  },

  async rearrangeMeal(e) {
    if (this.data.weeklyBusy || !this.data.canEditWeekly) return
    const mealKey = e.currentTarget.dataset.mealKey
    const { selectedDate } = this.data
    try {
      const draft = await this._ensureDraft()
      const epoch = ++this._weeklyEpoch
      this.setData({ weeklyBusy: true })
      const newDraft = await this._api.regenerateWeeklyPlan(this._familyId, draft.id, {
        scope: 'MEAL', plan_date: selectedDate, meal_type: mealKey
      })
      if (epoch !== this._weeklyEpoch) return
      this._applyDraft(newDraft)
      this.setData({ weeklyBusy: false })
    } catch (err) {
      this.setData({ weeklyBusy: false })
      wx.showToast({ title: err.message || '重排失败', icon: 'none' })
    }
  },

  async rearrangeDay() {
    if (this.data.weeklyBusy || !this.data.canEditWeekly) return
    const { selectedDate } = this.data
    try {
      const draft = await this._ensureDraft()
      const epoch = ++this._weeklyEpoch
      this.setData({ weeklyBusy: true })
      const newDraft = await this._api.regenerateWeeklyPlan(this._familyId, draft.id, {
        scope: 'DAY', plan_date: selectedDate
      })
      if (epoch !== this._weeklyEpoch) return
      this._applyDraft(newDraft)
      this.setData({ weeklyBusy: false })
    } catch (err) {
      this.setData({ weeklyBusy: false })
      wx.showToast({ title: err.message || '重排失败', icon: 'none' })
    }
  },

  async rearrangeWeek() {
    if (this.data.weeklyBusy || !this.data.canEditWeekly) return
    try {
      const draft = await this._ensureDraft()
      const epoch = ++this._weeklyEpoch
      this.setData({ weeklyBusy: true })
      const newDraft = await this._api.regenerateWeeklyPlan(this._familyId, draft.id, { scope: 'WEEK' })
      if (epoch !== this._weeklyEpoch) return
      this._applyDraft(newDraft)
      this.setData({ weeklyBusy: false })
    } catch (err) {
      this.setData({ weeklyBusy: false })
      wx.showToast({ title: err.message || '重排失败', icon: 'none' })
    }
  },

  addToMeal(e) {
    const mealKey = e.currentTarget.dataset.mealKey
    const { selectedDate } = this.data
    const target = this._mealTarget.update({ meal_date: selectedDate, meal_type: mealKey })
    this.setData({ activeTab: 'recipes', targetMeal: target, currentCategory: 'RECOMMEND', searchText: '' }, () => {
      this._refreshTargetMealText()
      this._refreshMiniCart()
      this._applyFilter()
    })
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  noop() {},

  onPullDownRefresh() {
    this._loadAll()
    wx.stopPullDownRefresh()
  },
})
