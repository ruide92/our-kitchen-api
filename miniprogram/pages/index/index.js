/**
 * 首页 — Real V1 Data
 * 数据来源：V1 API（family/members/weekly/meal）。
 * 正常已登录 + active family 路径不使用任何 fixture。
 */

const { createV1Api } = require('../../utils/v1-api')

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const MEAL_TYPES = [
  { key: 'BREAKFAST', label: '早餐', icon: '🌅' },
  { key: 'LUNCH', label: '午餐', icon: '☀️' },
  { key: 'DINNER', label: '晚餐', icon: '🌙' }
]

const DISH_COLORS = [
  '#FFE0B2', '#C8E6C9', '#F8BBD0', '#B3E5FC',
  '#FFF9C4', '#D1C4E9', '#FFCCBC', '#DCEDC8'
]

function dishColor(name) {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return DISH_COLORS[hash % DISH_COLORS.length]
}

Page({
  data: {
    family: null,
    members: [],
    todayLabel: '',
    dinersLabel: '',
    loading: true,
    loadError: null,

    weekdays: WEEKDAYS,
    selectedDayIndex: 0,
    weekDays: [],
    selectedFullDate: '',
    weeklyPlan: null,
    selectedMeals: [],

    currentMeal: { meal_date: '', meal_type: 'DINNER', items: [] },
    currentMealDate: '',
    mealTypeLabel: '晚餐',
    currentMealLabel: '',
  },

  onLoad() {
    this._familyId = wx.getStorageSync('v1_active_family_id')
    this._api = createV1Api({ wxAdapter: wx })
    this._initWeekDays()
    this._loadRealData()
  },

  onShow() {
    try { if (this.getTabBar()) this.getTabBar().setData({ selected: 0, hidden: false }) } catch(e) {}
    if (this._familyId) this._loadRealData()
  },

  _initWeekDays() {
    const now = new Date()
    const day = now.getDay()
    const mondayOffset = day === 0 ? -6 : 1 - day
    const monday = new Date(now)
    monday.setDate(now.getDate() + mondayOffset)
    const weekDays = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      weekDays.push({
        index: i,
        label: WEEKDAYS[i],
        date: String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'),
        fullDate: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'),
        isToday: d.toDateString() === now.toDateString(),
      })
    }
    const todayIndex = weekDays.findIndex(d => d.isToday)
    this.setData({
      weekDays,
      selectedDayIndex: todayIndex >= 0 ? todayIndex : 0,
      selectedFullDate: weekDays[todayIndex >= 0 ? todayIndex : 0].fullDate,
      todayLabel: now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日 ' + WEEKDAYS[(now.getDay() + 6) % 7],
    })
  },

  async _loadRealData() {
    if (!this._familyId) {
      this.setData({ family: { name: '未登录家庭' }, members: [], loading: false, loadError: null })
      return
    }
    this.setData({ loading: true, loadError: null })
    try {
      const [family, members, weekly, settings] = await Promise.all([
        this._api.getFamily(this._familyId),
        this._api.getMembers(this._familyId),
        this._api.getWeeklyPlan(this._familyId, this.data.weekDays[0].fullDate),
        this._api.getSettings(this._familyId),
      ])
      // Family + members view model
      const memberVM = (members || []).map(m => ({
        nickname: m.nickname || m.user?.nickname || '家庭成员',
        avatar_url: m.avatar_url || m.user?.avatar_url || '',
        role: m.role || 'MEMBER',
      }))
      this.setData({
        family: { name: family?.name || '我们的小厨房' },
        members: memberVM,
        dinersLabel: (settings?.default_diners || 2) + '人',
        weeklyPlan: weekly || null,
      })
      // Weekly display from real weeklyPlan
      this._buildWeeklyDisplay(weekly || null)
      // Current meal from shared meal-target
      const mealTarget = wx.getStorageSync('v1_meal_target')
      if (mealTarget) {
        try {
          const meal = await this._api.getCurrentMeal(this._familyId, mealTarget.meal_date, mealTarget.meal_type)
          if (meal && meal.items) {
            const mealItems = meal.items.map(it => ({
              id: it.id,
              recipeId: it.recipe_id,
              name: it.recipe_name || '菜谱',
              coverImageUrl: it.cover_image_url || '',
              color: dishColor(it.recipe_name || '菜'),
              initial: (it.recipe_name || '菜').charAt(0),
              selected_by_nickname: it.selected_by_nickname || '家庭成员',
            }))
            const mtLabel = MEAL_TYPES.find(m => m.key === meal.meal_type)?.label || '晚餐'
            this.setData({
              currentMeal: { meal_date: meal.meal_date, meal_type: meal.meal_type, items: mealItems },
              currentMealDate: meal.meal_date,
              mealTypeLabel: mtLabel,
              currentMealLabel: mtLabel + '菜单 · ' + mealItems.length + '道',
            })
          } else {
            this.setData({
              currentMeal: { meal_date: mealTarget.meal_date, meal_type: mealTarget.meal_type, items: [] },
              currentMealDate: mealTarget.meal_date,
              mealTypeLabel: MEAL_TYPES.find(m => m.key === mealTarget.meal_type)?.label || '晚餐',
              currentMealLabel: '',
            })
          }
        } catch (mealErr) { if (mealErr.status !== 404 && mealErr.code !== 'NOT_FOUND') throw mealErr; }
      }
      this.setData({ loading: false, loadError: null })
    } catch (e) {
      this.setData({ loading: false, loadError: e.message || '加载失败，请重试' })
    }
  },

  goMine() { wx.switchTab({ url: '/pages/mine/mine' }) },

  retryLoad() {
    this._loadRealData()
  },

  _buildWeeklyDisplay(weekly) {
    const { selectedFullDate } = this.data
    if (!weekly || !weekly.items) {
      this.setData({ selectedMeals: MEAL_TYPES.map(mt => ({ key: mt.key, label: mt.label, icon: mt.icon, dishes: [] })) })
      return
    }
    const items = weekly.items
    const selectedMeals = MEAL_TYPES.map(mt => {
      const dishes = items
        .filter(it => it.plan_date === selectedFullDate && it.meal_type === mt.key)
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
        .map(it => ({
          id: it.id,
          recipeId: it.recipe_id,
          name: it.recipe_name || '菜谱',
          coverImageUrl: it.cover_image_url || '',
          color: dishColor(it.recipe_name || '菜'),
          initial: (it.recipe_name || '菜').charAt(0),
          locked: !!it.locked,
        }))
      return { key: mt.key, label: mt.label, icon: mt.icon, dishes }
    })
    this.setData({ selectedMeals })
  },

  selectDay(e) {
    const idx = Number(e.currentTarget.dataset.index)
    if (idx === this.data.selectedDayIndex) return
    const selectedFullDate = this.data.weekDays[idx].fullDate
    this.setData({ selectedDayIndex: idx, selectedFullDate })
    this._buildWeeklyDisplay(this.data.weeklyPlan)
  },

  async addMealToCurrent(e) {
    const mealKey = e.currentTarget.dataset.mealKey
    const meal = this.data.selectedMeals.find((m) => m.key === mealKey)
    if (!meal || meal.dishes.length === 0) {
      wx.showToast({ title: '该餐暂未安排', icon: 'none' })
      return
    }
    if (!this._familyId || !this._api) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    const selDate = this.data.selectedFullDate
    wx.showLoading({ title: '加入中...' })
    try {
      let mealObj = null
      try {
        mealObj = await this._api.getCurrentMeal(this._familyId, selDate, mealKey)
      } catch (mealErr) {
        if (mealErr.status !== 404 && mealErr.code !== 'NOT_FOUND') throw mealErr
      }
      if (!mealObj || !mealObj.id) {
        mealObj = await this._api.ensureCurrentMeal(this._familyId, { meal_date: selDate, meal_type: mealKey, diners_count: 2 })
      }
      let added = 0, already = 0, failed = 0
      for (const dish of meal.dishes) {
        try {
          await this._api.addMealItem(this._familyId, mealObj.id, { recipe_id: dish.recipeId, servings: 2, source: 'WEEKLY_PLAN' })
          added++
        } catch (addErr) {
          if (addErr.code === 'ALREADY_IN_MEAL') {
            already++
          } else {
            failed++
          }
        }
      }
      wx.hideLoading()
      this._loadRealData()
      if (failed > 0) {
        wx.showToast({ title: `加入${added}道，${failed}道失败`, icon: 'none' })
      } else if (already > 0) {
        wx.showToast({ title: `已加入${added}道，${already}道已在菜单中`, icon: 'success' })
      } else {
        wx.showToast({ title: `已加入${added}道`, icon: 'success' })
      }
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: err.message || '加入失败', icon: 'none' })
    }
  },

  // ===== 快捷入口 =====
  goRandom() { wx.showToast({ title: '随机菜谱将在推荐引擎接入后启用', icon: 'none', duration: 1500 }) },
  goFridgeCook() { wx.switchTab({ url: '/pages/fridge/fridge' }) },
  goFavorites() { wx.showToast({ title: '家庭收藏真实数据接入后启用', icon: 'none', duration: 1500 }) },
  goOnePerson() { wx.showToast({ title: '一人菜将在推荐引擎接入后启用', icon: 'none', duration: 1500 }) },
  goWeeklyPlan() { wx.switchTab({ url: '/pages/menu/menu' }) },

  goTodayMenu() {
    const mealTarget = wx.getStorageSync('v1_meal_target')
    const date = mealTarget?.meal_date || this.data.currentMealDate || this.data.selectedFullDate
    const mealType = mealTarget?.meal_type || 'DINNER'
    wx.navigateTo({ url: '/pages/meal/meal?date=' + date + '&meal_type=' + mealType })
  },

  goDetail() { wx.showToast({ title: '菜品详情真实数据接入后启用', icon: 'none', duration: 1500 }) },

  onPullDownRefresh() {
    this._loadRealData()
    wx.stopPullDownRefresh()
  }
})
