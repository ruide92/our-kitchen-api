/**
 * 菜单 Tab — Phase fixture UI
 *
 * 重要：本页面仅使用 menu-fixture.js，不调用 legacy api.js，不接真实后端。
 * 所有"重新安排"操作为 placeholder（推荐引擎 Phase 6 接入）。
 * 本餐选菜使用 date + meal_type 二维隔离，与首页一致。
 */

const fixture = require('./menu-fixture.js')

const MEAL_META = {
  BREAKFAST: { key: 'BREAKFAST', label: '早餐', icon: '🌅' },
  LUNCH: { key: 'LUNCH', label: '午餐', icon: '☀️' },
  DINNER: { key: 'DINNER', label: '晚餐', icon: '🌙' },
}

const WEEK_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

Page({
  data: {
    // 视图切换：'weekly' | 'recipes'
    activeTab: 'weekly',

    // 本周安排
    weekStartDate: '',
    weekRangeText: '',
    weekDays: [],        // [{index, label, date, isToday}]
    selectedDayIndex: 2, // 默认周三（today）
    selectedDate: '',
    selectedMeals: [],   // [{key, label, icon, count, dishes: [...]}]

    // 全部菜品
    categories: [],
    currentCategory: 'RECOMMEND',
    recipes: [],
    filteredRecipes: [],
    searchText: '',

    // 选菜目标（全部菜品视图顶部上下文）
    targetMeal: { meal_date: '', meal_type: 'DINNER' },
    targetMealText: '',

    // 本餐菜单本地状态（date + meal_type 二维隔离）
    mealsByDateAndType: {},
    miniCartCount: 0,
    miniCartVisible: false,
  },

  onLoad() {
    this._initFromFixture()
  },

  onShow() {
    // fixture 阶段：每次 onShow 从 fixture 重新计算展示数据
    this._refreshSelectedMeals()
    this._refreshMiniCart()
  },

  // ===== 初始化 =====
  _initFromFixture() {
    const weekStart = fixture.weekly_plan.week_start_date
    const today = fixture.today.date

    // 生成周一到周日（使用本地日期，避免 toISOString 时区偏移）
    const weekDays = []
    const start = new Date(weekStart + 'T00:00:00')
    for (let i = 0; i < 7; i++) {
      const d = new Date(start.getTime() + i * 86400000)
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      const dateStr = y + '-' + m + '-' + day
      const md = m + '.' + day
      weekDays.push({
        index: i,
        label: WEEK_LABELS[i],
        date: md,
        fullDate: dateStr,
        isToday: dateStr === today,
      })
    }

    // 周范围文本：8.31 - 9.06
    const rangeText = weekDays[0].date + ' - ' + weekDays[6].date

    // 今天的 index
    const todayIndex = weekDays.findIndex(d => d.isToday)
    const selectedIndex = todayIndex >= 0 ? todayIndex : 0

    // 分类
    const categories = fixture.categories

    // 菜谱
    const recipes = fixture.recipes.map(r => ({
      ...r,
      spicyText: r.spiciness > 0 ? '🌶️'.repeat(Math.min(r.spiciness, 5)) : '',
      kissText: r.suggested_kiss > 0 ? '💋×' + r.suggested_kiss : '',
      timeText: r.cook_time_minutes + '分钟',
      familyVariantText: (r.has_family_variant || r.kind === 'FAMILY') ? '我家版本' : '',
    }))

    // mealsByDateAndType 深拷贝（避免直接改 fixture）
    const mealsByDateAndType = JSON.parse(JSON.stringify(fixture.meals_by_date_and_type))

    // target meal
    const targetMeal = { ...fixture.target_meal }

    this.setData({
      weekStartDate: weekStart,
      weekRangeText: rangeText,
      weekDays,
      selectedDayIndex: selectedIndex,
      selectedDate: weekDays[selectedIndex].fullDate,
      categories,
      recipes,
      filteredRecipes: recipes,
      mealsByDateAndType,
      targetMeal,
    }, () => {
      this._refreshSelectedMeals()
      this._refreshTargetMealText()
      this._refreshMiniCart()
    })
  },

  // ===== 本周安排：根据选中日期组装三餐 =====
  _refreshSelectedMeals() {
    const { selectedDate, mealsByDateAndType } = this.data
    const items = fixture.weekly_plan.items.filter(it => it.plan_date === selectedDate)

    const meals = ['BREAKFAST', 'LUNCH', 'DINNER'].map(mealKey => {
      const meta = MEAL_META[mealKey]
      const dishes = items
        .filter(it => it.meal_type === mealKey)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(it => ({
          id: it.id,
          recipeId: it.recipe.id,
          name: it.recipe.name,
          coverImageUrl: it.recipe.cover_image_url,
          locked: it.locked,
          color: this._phColor(it.recipe.name),
          initial: it.recipe.name.charAt(0),
        }))
      return {
        key: mealKey,
        label: meta.label,
        icon: meta.icon,
        count: dishes.length,
        dishes,
      }
    })

    this.setData({ selectedMeals: meals })
  },

  // ===== 全部菜品：目标餐次文本 =====
  _refreshTargetMealText() {
    const { targetMeal, weekDays } = this.data
    const day = weekDays.find(d => d.fullDate === targetMeal.meal_date)
    const dayLabel = day ? day.label : targetMeal.meal_date
    const mealLabel = MEAL_META[targetMeal.meal_type].label
    this.setData({ targetMealText: dayLabel + mealLabel })
  },

  // ===== mini cart =====
  _refreshMiniCart() {
    const { targetMeal, mealsByDateAndType } = this.data
    const bucket = mealsByDateAndType[targetMeal.meal_date]
    const meal = bucket && bucket[targetMeal.meal_type]
    const count = meal && meal.items ? meal.items.length : 0
    this.setData({
      miniCartCount: count,
      miniCartVisible: count > 0,
    })
  },

  // ===== 占位图颜色 =====
  _phColor(name) {
    const colors = ['#FFE0B2', '#C8E6C9', '#BBDEFB', '#F8BBD0', '#D1C4E9', '#FFCCBC', '#B2DFDB']
    let hash = 0
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
    return colors[Math.abs(hash) % colors.length]
  },

  // ===== 视图切换 =====
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ activeTab: tab })
  },

  // ===== 选日期 =====
  selectDay(e) {
    const index = e.currentTarget.dataset.index
    const day = this.data.weekDays[index]
    this.setData({
      selectedDayIndex: index,
      selectedDate: day.fullDate,
    }, () => this._refreshSelectedMeals())
  },

  // ===== 锁定 / 解锁（仅改本地 fixture 展示状态）=====
  toggleLock(e) {
    const itemId = e.currentTarget.dataset.itemId
    const item = fixture.weekly_plan.items.find(it => it.id === itemId)
    if (item) {
      item.locked = !item.locked
      this._refreshSelectedMeals()
      wx.showToast({
        title: item.locked ? '已锁定，重新安排时保留' : '已解锁',
        icon: 'none',
        duration: 1200,
      })
    }
  },

  // ===== 换一道（placeholder）=====
  swapDish(e) {
    wx.showToast({ title: '推荐引擎将在 Phase 6 接入', icon: 'none', duration: 1500 })
  },

  // ===== 删除计划项（placeholder：fixture 阶段不真删）=====
  removePlanItem(e) {
    wx.showToast({ title: 'fixture 演示：删除将在真实后端接入', icon: 'none', duration: 1500 })
  },

  // ===== 重新安排（placeholder）=====
  rearrangeMeal(e) {
    wx.showToast({ title: '推荐引擎将在 Phase 6 接入', icon: 'none', duration: 1500 })
  },
  rearrangeDay() {
    wx.showToast({ title: '推荐引擎将在 Phase 6 接入', icon: 'none', duration: 1500 })
  },
  rearrangeWeek() {
    wx.showToast({ title: '推荐引擎将在 Phase 6 接入', icon: 'none', duration: 1500 })
  },

  // ===== 从本周安排点"+添加" → 切到全部菜品，设置目标餐次 =====
  addToMeal(e) {
    const mealKey = e.currentTarget.dataset.mealKey
    const { selectedDate } = this.data
    this.setData({
      activeTab: 'recipes',
      targetMeal: { meal_date: selectedDate, meal_type: mealKey },
      currentCategory: 'RECOMMEND',
      searchText: '',
      filteredRecipes: this.data.recipes,
    }, () => {
      this._refreshTargetMealText()
      this._refreshMiniCart()
    })
  },

  // ===== 全部菜品：选分类 =====
  selectCategory(e) {
    const code = e.currentTarget.dataset.code
    this.setData({ currentCategory: code }, () => this._applyFilter())
  },

  // ===== 全部菜品：搜索 =====
  onSearchInput(e) {
    const text = e.detail.value
    this.setData({ searchText: text }, () => this._applyFilter())
  },

  _applyFilter() {
    const { recipes, currentCategory, searchText } = this.data
    let list = recipes
    if (currentCategory !== 'RECOMMEND') {
      if (currentCategory === 'FAVORITES') {
        list = list.filter(r => r.is_favorite)
      } else if (currentCategory === 'RECENT') {
        list = list.slice(0, 6) // fixture：最近吃过取前6
      } else if (currentCategory === 'MY_RECIPES') {
        list = list.filter(r => r.kind === 'FAMILY')
      } else {
        list = list.filter(r => r.category_code === currentCategory)
      }
    }
    if (searchText) {
      const kw = searchText.toLowerCase()
      list = list.filter(r =>
        r.name.toLowerCase().includes(kw) ||
        (r.tags && r.tags.some(t => t.toLowerCase().includes(kw)))
      )
    }
    this.setData({ filteredRecipes: list })
  },

  // ===== 加入当前目标餐次（date + meal_type 隔离，幂等，V4 家庭版本语义）=====
  addRecipeToMeal(e) {
    const clickedId = e.currentTarget.dataset.recipeId
    const clickedRecipe = this.data.recipes.find(r => r.id === clickedId)
    if (!clickedRecipe) return

    // V4 语义：BASE 且已有家庭派生版时，业务动作优先使用 family_variant_id
    let effectiveRecipe = clickedRecipe
    if (clickedRecipe.kind === 'BASE' &&
        clickedRecipe.has_family_variant === true &&
        clickedRecipe.family_variant_id) {
      const familyRecipe = this.data.recipes.find(r => r.id === clickedRecipe.family_variant_id)
      if (familyRecipe) effectiveRecipe = familyRecipe
    }
    const effectiveId = effectiveRecipe.id

    const { targetMeal, mealsByDateAndType } = this.data
    const date = targetMeal.meal_date
    const mealType = targetMeal.meal_type

    // 确保 bucket 存在
    if (!mealsByDateAndType[date]) {
      mealsByDateAndType[date] = { BREAKFAST: { items: [] }, LUNCH: { items: [] }, DINNER: { items: [] } }
    }
    if (!mealsByDateAndType[date][mealType]) {
      mealsByDateAndType[date][mealType] = { items: [] }
    }

    const bucket = mealsByDateAndType[date][mealType]

    // 幂等：针对最终实际 recipe_id（BASE 与其 FAMILY 派生版视为同一道菜）
    const exists = bucket.items.some(it => it.recipe_id === effectiveId)
    if (exists) {
      wx.showToast({ title: '已在' + this.data.targetMealText + '中', icon: 'none', duration: 1200 })
      return
    }

    bucket.items.push({
      id: 'mi-' + date + '-' + mealType + '-' + effectiveId + '-' + Date.now(),
      recipe_id: effectiveId,
      source_recipe_id: clickedRecipe.id,
      recipe_name: effectiveRecipe.name,
      cover_image_url: effectiveRecipe.cover_image_url,
      servings: 2,
      source: 'MANUAL',
      selected_by_user_id: 'u1',
      selected_by_nickname: '锐',
    })

    this.setData({ mealsByDateAndType }, () => {
      this._refreshMiniCart()
      wx.showToast({ title: '已加入' + this.data.targetMealText, icon: 'success', duration: 1000 })
    })
  },

  // ===== mini cart：查看菜单（placeholder：today-menu 尚未 V4 化）=====
  goTodayMenu() {
    wx.showToast({ title: '完整本餐菜单将在后续阶段接入', icon: 'none', duration: 1500 })
  },

  // ===== 菜品详情（fixture 阶段 placeholder）=====
  goDetail(e) {
    wx.showToast({ title: '菜品详情将在后续阶段接入', icon: 'none', duration: 1200 })
  },

  // 下拉刷新
  onPullDownRefresh() {
    this._refreshSelectedMeals()
    this._refreshMiniCart()
    wx.stopPullDownRefresh()
  },
})
