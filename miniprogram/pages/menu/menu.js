/**
 * 菜单 Tab — Real V1 data mode
 *
 * REAL MODE: authenticated + active family -> no fixture fallback.
 * Recipes from GET /recipes, weekly from GET /weekly-plans.
 * Manual add only writes to Meal, never Weekly Plan.
 */

const { createV1Api } = require('../../utils/v1-api')
const { createMealTarget } = require('../../utils/meal-target')

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
    weeklyLoading: false,
    weeklyError: null,
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
    // Mini cart
    miniCartCount: 0,
    miniCartVisible: false,
    miniCartLoading: false,
  },

  onLoad() {
    this._familyId = wx.getStorageSync('v1_active_family_id')
    this._api = createV1Api({ wxAdapter: wx })
    this._mealTarget = createMealTarget({ wxAdapter: wx })
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
    this.setData({ weeklyLoading: true, weeklyError: null })
    try {
      const plan = await this._api.getWeeklyPlan(this._familyId, this.data.weekStartDate)
      this.setData({ weeklyPlan: plan, weeklyLoading: false })
      this._refreshSelectedMeals()
    } catch (e) {
      this.setData({ weeklyLoading: false, weeklyError: e.message || '加载失败' })
    }
  },

  _refreshSelectedMeals() {
    const { selectedDate, weeklyPlan } = this.data
    const items = weeklyPlan && weeklyPlan.items ? weeklyPlan.items.filter(it => it.plan_date === selectedDate) : []
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
    const target = this._mealTarget.update({ meal_date: option.meal_date, meal_type: option.meal_type })
    showTabBar(this)
    this.setData({ targetMeal: target, showTargetPicker: false }, () => {
      this._refreshTargetMealText()
      this._refreshMiniCart()
    })
  },

  // ===== Mini cart (real Meal API) =====
  async _refreshMiniCart() {
    if (!this._familyId || !this._api) return
    const { targetMeal } = this.data
    this.setData({ miniCartLoading: true })
    try {
      const meal = await this._api.getCurrentMeal(this._familyId, targetMeal.meal_date, targetMeal.meal_type)
      const count = meal && meal.items ? meal.items.length : 0
      this.setData({ miniCartCount: count, miniCartVisible: count > 0, miniCartLoading: false })
    } catch (e) {
      // Meal not found = 0 items
      this.setData({ miniCartCount: 0, miniCartVisible: false, miniCartLoading: false })
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
      if (err.code === 'ALREADY_IN_MEAL' || err.status === 409) {
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

  // Weekly placeholders (recommendation not implemented)
  toggleLock() { wx.showToast({ title: '推荐引擎接入后启用', icon: 'none' }) },
  swapDish() { wx.showToast({ title: '推荐引擎接入后启用', icon: 'none' }) },
  removePlanItem() { wx.showToast({ title: '推荐引擎接入后启用', icon: 'none' }) },
  rearrangeMeal() { wx.showToast({ title: '推荐引擎接入后启用', icon: 'none' }) },
  rearrangeDay() { wx.showToast({ title: '推荐引擎接入后启用', icon: 'none' }) },
  rearrangeWeek() { wx.showToast({ title: '推荐引擎接入后启用', icon: 'none' }) },

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

  goDetail() { wx.showToast({ title: '菜品详情接入后启用', icon: 'none' }) },

  noop() {},

  onPullDownRefresh() {
    this._loadAll()
    wx.stopPullDownRefresh()
  },
})
