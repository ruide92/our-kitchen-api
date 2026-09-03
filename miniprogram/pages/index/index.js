/**
 * 首页 — Phase 2.5 Fixture UI
 *
 * 数据来源：本目录 homepage-fixture.js（显式 mock / fixture）。
 * 当前阶段不接真实后端，不调用 utils/api.js 中的 legacy /api/* 接口。
 * 「加入本餐菜单」仅在本地 fixture 状态上演示，不产生服务端写入。
 */

const fixture = require('./homepage-fixture.js')

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const MEAL_TYPES = [
  { key: 'BREAKFAST', label: '早餐', icon: '🌅' },
  { key: 'LUNCH', label: '午餐', icon: '☀️' },
  { key: 'DINNER', label: '晚餐', icon: '🌙' }
]

// 菜品占位色板（cover_image_url 为 null 时使用，纯展示用，不写入 fixture）
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

function dishInitial(name) {
  return name ? name.charAt(0) : '菜'
}

Page({
  data: {
    // ---- 顶部家庭区 ----
    family: null,
    members: [],
    todayLabel: '',
    dinersLabel: '',

    // ---- 本周菜谱 ----
    weekdays: WEEKDAYS,
    selectedDayIndex: 0,
    weekDays: [],          // [{date, label, index}]
    selectedMeals: [],     // [{key,label,icon,dishes:[{id,name,color,initial,locked}]}]

    // ---- 已点菜单 ----
    // 按餐次分开存储，避免串餐（V4 PRODUCT_SPEC 5.3）。
    // currentMeal 仅用于底部"已点菜单"展示，默认展示 fixture.current_meal（DINNER）。
    mealsByType: {
      BREAKFAST: { items: [] },
      LUNCH: { items: [] },
      DINNER: { items: [] }
    },
    currentMeal: null,     // {meal_type, items:[...]} — 底部展示的当前餐次
    mealTypeLabel: '',
    currentMealLabel: ''
  },

  onLoad() {
    this._buildFromFixture()
  },

  onShow() {
    // fixture 模式下 onShow 不重新拉取；保持本地状态
  },

  /**
   * 将 fixture 原始数据转为首页 view model。
   * 不修改 fixture 原对象。
   */
  _buildFromFixture() {
    const { family, members, today, weekly_plan, current_meal } = fixture

    // today.weekday: 1=周一 … 7=周日 → 数组下标 0..6
    const todayIndex = Math.max(0, Math.min(6, (today.weekday || 1) - 1))

    // 构造周一到周日的日期标签
    const weekStart = new Date(weekly_plan.week_start_date)
    const weekDays = WEEKDAYS.map((label, i) => {
      const d = new Date(weekStart.getTime() + i * 86400000)
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      return { index: i, label, date: `${mm}-${dd}`, isToday: i === todayIndex }
    })

    // 按天 + 餐次分组
    const items = weekly_plan.items || []
    const byDayMeal = {}
    items.forEach((item) => {
      const dayKey = item.plan_date
      if (!byDayMeal[dayKey]) byDayMeal[dayKey] = {}
      const mt = item.meal_type
      if (!byDayMeal[dayKey][mt]) byDayMeal[dayKey][mt] = []
      byDayMeal[dayKey][mt].push(item)
    })

    // 选中天（默认今天）的三餐
    const selectedDate = weekDays[todayIndex].date
    const selectedFullDate = this._fullDate(weekStart, todayIndex)
    const selectedMeals = MEAL_TYPES.map((mt) => {
      const dayItems = (byDayMeal[selectedFullDate] && byDayMeal[selectedFullDate][mt.key]) || []
      const dishes = dayItems
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
        .map((item) => ({
          id: item.id,
          recipeId: item.recipe.id,
          name: item.recipe.name,
          coverImageUrl: item.recipe.cover_image_url || '',
          color: dishColor(item.recipe.name),
          initial: dishInitial(item.recipe.name),
          locked: !!item.locked
        }))
      return { key: mt.key, label: mt.label, icon: mt.icon, dishes }
    })

    // 已点菜单 — 按餐次分开存储，fixture.current_meal 初始化为 DINNER
    const mealItems = (current_meal.items || []).map((mi) => ({
      id: mi.id,
      recipeId: mi.recipe.id,
      name: mi.recipe.name,
      coverImageUrl: mi.recipe.cover_image_url || '',
      color: dishColor(mi.recipe.name),
      initial: dishInitial(mi.recipe.name),
      selected_by_nickname: mi.selected_by_nickname
    }))

    const mealTypeLabel = MEAL_TYPES.find((m) => m.key === current_meal.meal_type)
      ? MEAL_TYPES.find((m) => m.key === current_meal.meal_type).label
      : '本餐'

    // mealsByType：三餐独立存储，底部 currentMeal 展示 DINNER（fixture 当前餐次）
    const mealsByType = {
      BREAKFAST: { items: [] },
      LUNCH: { items: [] },
      DINNER: { items: mealItems }
    }

    this.setData({
      family,
      members,
      todayLabel: WEEKDAYS[todayIndex],
      dinersLabel: `${today.diners_count}人`,
      weekDays,
      selectedDayIndex: todayIndex,
      selectedMeals,
      mealsByType,
      currentMeal: {
        meal_type: current_meal.meal_type,
        items: mealItems
      },
      mealTypeLabel,
      currentMealLabel: `${mealTypeLabel}菜单 · ${mealItems.length}道`
    })
  },

  _fullDate(weekStart, dayIndex) {
    const d = new Date(weekStart.getTime() + dayIndex * 86400000)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  },

  // ===== 交互 =====

  selectDay(e) {
    const idx = Number(e.currentTarget.dataset.index)
    if (idx === this.data.selectedDayIndex) return

    const { weekly_plan } = fixture
    const weekStart = new Date(weekly_plan.week_start_date)
    const selectedFullDate = this._fullDate(weekStart, idx)

    const items = weekly_plan.items || []
    const byDayMeal = {}
    items.forEach((item) => {
      if (!byDayMeal[item.plan_date]) byDayMeal[item.plan_date] = {}
      const mt = item.meal_type
      if (!byDayMeal[item.plan_date][mt]) byDayMeal[item.plan_date][mt] = []
      byDayMeal[item.plan_date][mt].push(item)
    })

    const selectedMeals = MEAL_TYPES.map((mt) => {
      const dayItems = (byDayMeal[selectedFullDate] && byDayMeal[selectedFullDate][mt.key]) || []
      const dishes = dayItems
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
        .map((item) => ({
          id: item.id,
          recipeId: item.recipe.id,
          name: item.recipe.name,
          coverImageUrl: item.recipe.cover_image_url || '',
          color: dishColor(item.recipe.name),
          initial: dishInitial(item.recipe.name),
          locked: !!item.locked
        }))
      return { key: mt.key, label: mt.label, icon: mt.icon, dishes }
    })

    this.setData({ selectedDayIndex: idx, selectedMeals })
  },

  /**
   * 一键加入本餐菜单（餐次级，fixture 本地演示）。
   * 将当前选中天的指定餐次全部菜品加入该餐次对应的已点菜单。
   * 按 BREAKFAST / LUNCH / DINNER 分开存储，不串餐（V4 PRODUCT_SPEC 5.3）。
   * 幂等：已存在的菜不重复加入。
   * 底部"已点菜单"仅展示 currentMeal.meal_type（fixture 默认 DINNER）。
   * 真实后端接入后应调用 POST /api/v1/families/:family_id/meals/:meal_id/items（批量）。
   */
  addMealToCurrent(e) {
    const mealKey = e.currentTarget.dataset.mealKey
    const meal = this.data.selectedMeals.find((m) => m.key === mealKey)
    if (!meal || meal.dishes.length === 0) {
      wx.showToast({ title: '该餐暂未安排', icon: 'none' })
      return
    }

    // 写入对应餐次的独立存储
    const targetItems = (this.data.mealsByType[mealKey] && this.data.mealsByType[mealKey].items) || []
    const existingIds = new Set(targetItems.map((it) => it.recipeId))
    const toAdd = meal.dishes.filter((d) => !existingIds.has(d.recipeId))

    if (toAdd.length === 0) {
      wx.showToast({ title: '已全部在本餐菜单', icon: 'none' })
      return
    }

    const newItems = toAdd.map((d) => ({
      id: `mi-local-${Date.now()}-${d.recipeId}`,
      recipeId: d.recipeId,
      name: d.name,
      coverImageUrl: d.coverImageUrl || '',
      color: dishColor(d.name),
      initial: dishInitial(d.name),
      selected_by_nickname: '锐'
    }))

    const allItems = targetItems.concat(newItems)
    const patch = {
      [`mealsByType.${mealKey}.items`]: allItems
    }

    // 仅当加入的餐次等于底部展示餐次时，刷新 currentMeal 展示
    if (mealKey === this.data.currentMeal.meal_type) {
      patch['currentMeal.items'] = allItems
      patch.currentMealLabel = `${this.data.mealTypeLabel}菜单 · ${allItems.length}道`
    }

    this.setData(patch)
    const mealLabel = MEAL_TYPES.find((m) => m.key === mealKey)
      ? MEAL_TYPES.find((m) => m.key === mealKey).label
      : mealKey
    wx.showToast({ title: `${mealLabel}已加入${toAdd.length}道`, icon: 'success' })
  },

  // ===== 快捷入口 =====

  goRandom() {
    wx.navigateTo({ url: '/pages/random/random' })
  },

  goFridgeCook() {
    wx.switchTab({ url: '/pages/fridge/fridge' })
  },

  goFavorites() {
    wx.navigateTo({ url: '/pages/favorites/favorites' })
  },

  goOnePerson() {
    wx.navigateTo({ url: '/pages/random/random?mode=one' })
  },

  // 查看完整周计划 — Phase 2.5 placeholder
  // 旧 menu 页尚未接入"本周安排"，暂不跳转，避免错误交互。
  // 下一阶段菜单页完成后改为 wx.switchTab({ url: '/pages/menu/menu' })。
  goWeeklyPlan() {
    wx.showToast({
      title: '完整周计划将在菜单页接入',
      icon: 'none'
    })
  },

  // ===== 已点菜单 =====

  goTodayMenu() {
    wx.navigateTo({ url: '/pages/today-menu/today-menu' })
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.recipeId
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` })
  },

  // 下拉刷新（fixture 模式：重建 view model 并停止刷新）
  onPullDownRefresh() {
    this._buildFromFixture()
    wx.stopPullDownRefresh()
  }
})
