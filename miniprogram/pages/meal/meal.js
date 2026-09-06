const { createV1Api } = require('../../utils/v1-api');
const { createMealTarget } = require('../../utils/meal-target');

const MEAL_LABELS = { BREAKFAST: '早餐', LUNCH: '午餐', DINNER: '晚餐' };
const SOURCE_LABELS = { MANUAL: '手工点', WEEKLY_PLAN: '周计划', RANDOM: '随机', WISH: '想吃' };

Page({
  data: {
    familyId: '',
    mealDate: '',
    mealType: 'DINNER',
    meal: null,
    items: [],
    loading: true,
    mealError: null,
    dinersCount: 2,
    pageTitle: '',
    dateLabel: '',
    busy: false,
    // Cooking state
    cooking: null,       // { session_id, meal, steps }
    cookingSteps: [],    // flattened steps with recipe_name
    autoStart: false,
  },

  onLoad(options) {
    const familyId = wx.getStorageSync('v1_active_family_id');
    const mealDate = options.date || this._today();
    const mealType = options.meal_type || 'DINNER';
    const autoStart = options.auto_start === '1';
    this.setData({ familyId, mealDate, mealType, autoStart });
    this._api = createV1Api({ wxAdapter: wx });
    this._mealTarget = createMealTarget({ wxAdapter: wx });
    this._refreshTitle();
    this.loadMeal();
  },

  onShow() {
    if (this.getTabBar()) this.getTabBar().setData({ selected: 1, hidden: false });
    this.loadMeal();
  },

  _today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },

  _refreshTitle() {
    const { mealDate, mealType } = this.data;
    const today = this._today();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = this._formatDate(tomorrow);
    let dayLabel = mealDate;
    if (mealDate === today) dayLabel = '今天';
    else if (mealDate === tomorrowStr) dayLabel = '明天';
    const mealLabel = MEAL_LABELS[mealType] || '晚餐';
    this.setData({
      pageTitle: dayLabel + mealLabel + '的菜单',
      dateLabel: mealDate + ' · ' + mealLabel,
    });
  },

  _formatDate(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },

  async loadMeal() {
    this.setData({ loading: true });
    try {
      const meal = await this._api.getCurrentMeal(this.data.familyId, this.data.mealDate, this.data.mealType);
      const items = (meal?.items || []).map(it => ({
        ...it,
        sourceLabel: SOURCE_LABELS[it.source] || it.source || '手工点',
        selectedByLabel: it.selected_by_nickname || '家庭成员',
      }));
      this.setData({ meal, items, loading: false, dinersCount: meal?.diners_count || 2 });
      // Auto-start cooking if requested and meal is CONFIRMED
      if (this.data.autoStart && meal?.status === 'CONFIRMED') {
        this.setData({ autoStart: false });
        this.startCooking();
      }
    } catch (e) {
      this.setData({ meal: null, items: [], loading: false, mealError: e.message || '加载失败，请重试' });
    }
  },

  retryLoad() {
    this.setData({ loading: true, mealError: null, items: [] });
    this.loadMeal();
  },

  async ensureMeal() {
    try {
      const meal = await this._api.ensureCurrentMeal(this.data.familyId, {
        meal_date: this.data.mealDate,
        meal_type: this.data.mealType,
        diners_count: this.data.dinersCount,
      });
      this.setData({ meal, items: meal.items || [] });
      return meal;
    } catch (e) {
      wx.showToast({ title: e.message || '创建失败', icon: 'none' });
      return null;
    }
  },

  async decreaseDiners() {
    if (this.data.dinersCount <= 1) return;
    if (this.data.meal?.status !== 'PLANNING') return;
    await this._updateDiners(this.data.dinersCount - 1);
  },

  async increaseDiners() {
    if (this.data.meal?.status !== 'PLANNING') return;
    await this._updateDiners(this.data.dinersCount + 1);
  },

  async _updateDiners(count) {
    if (!this.data.meal) {
      const meal = await this.ensureMeal();
      if (!meal) return;
    }
    try {
      const meal = await this._api.ensureCurrentMeal(this.data.familyId, {
        meal_date: this.data.mealDate,
        meal_type: this.data.mealType,
        diners_count: count,
      });
      this.setData({ dinersCount: count, meal, items: meal?.items || [] });
    } catch (e) {
      wx.showToast({ title: e.message || '更新失败', icon: 'none' });
    }
  },

  async removeItem(e) {
    if (this.data.meal?.status !== 'PLANNING') return;
    const itemId = e.currentTarget.dataset.id;
    if (!this.data.meal) return;
    wx.showModal({
      title: '移除菜品',
      content: '确定从本餐移除这道菜吗？',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await this._api.removeMealItem(this.data.familyId, this.data.meal.id, itemId);
          await this.loadMeal();
        } catch (e) {
          wx.showToast({ title: e.message || '删除失败', icon: 'none' });
        }
      },
    });
  },

  // ===== MEAL-07: Confirm menu (PLANNING -> CONFIRMED, creates snapshot) =====
  async confirmMenu() {
    if (this.data.busy) return;
    if (!this.data.meal || this.data.items.length === 0) {
      wx.showToast({ title: '请先添加菜品', icon: 'none' });
      return;
    }
    if (this.data.meal.status !== 'PLANNING') {
      wx.showToast({ title: '当前状态不可确认', icon: 'none' });
      return;
    }
    this.setData({ busy: true });
    try {
      const confirmed = await this._api.confirmMeal(this.data.familyId, this.data.meal.id);
      // Verify snapshot exists
      const snapshot = confirmed?.recipe_snapshot;
      if (!snapshot || snapshot.schema_version !== 1) {
        throw new Error('MEAL_SNAPSHOT_MISSING');
      }
      const items = (confirmed.items || []).map(it => ({
        ...it,
        sourceLabel: SOURCE_LABELS[it.source] || it.source || '手工点',
        selectedByLabel: it.selected_by_nickname || '家庭成员',
      }));
      this.setData({ meal: confirmed, items, busy: false });
      wx.showToast({ title: '菜单已确认', icon: 'success' });
    } catch (err) {
      this.setData({ busy: false });
      if (err.code === 'MEAL_SNAPSHOT_MISSING' || err.code === 'MEAL_SNAPSHOT_UNSUPPORTED' || err.message === 'MEAL_SNAPSHOT_MISSING') {
        wx.showModal({
          title: '确认失败',
          content: '菜单快照创建失败，请重试。',
          showCancel: false,
        });
      } else {
        wx.showToast({ title: err.message || '确认失败', icon: 'none' });
      }
    }
  },

  // ===== MEAL-08: Start cooking (CONFIRMED -> COOKING, steps from snapshot) =====
  async startCooking() {
    if (this.data.busy) return;
    if (!this.data.meal || this.data.meal.status !== 'CONFIRMED') {
      wx.showToast({ title: '请先确认菜单', icon: 'none' });
      return;
    }
    this.setData({ busy: true });
    try {
      const result = await this._api.startCooking(this.data.familyId, this.data.meal.id);
      // result = { session_id, meal, steps } — steps from frozen snapshot
      const cookingSteps = (result.steps || []).map(s => ({
        ...s,
        recipeName: s.recipe_name || '',
        instruction: s.operation || s.title || '',
        durationText: s.duration_text || (s.duration_seconds ? `${Math.round(s.duration_seconds / 60)}分钟` : ''),
      }));
      this.setData({
        cooking: result,
        cookingSteps,
        meal: result.meal || this.data.meal,
        busy: false,
      });
      wx.showToast({ title: '开始做饭', icon: 'success' });
    } catch (err) {
      this.setData({ busy: false });
      if (err.code === 'MEAL_NOT_CONFIRMED') {
        wx.showToast({ title: '请先确认菜单', icon: 'none' });
      } else {
        wx.showToast({ title: err.message || '开始做饭失败', icon: 'none' });
      }
    }
  },

  // Exit cooking view (does NOT complete cooking — that's next phase)
  exitCooking() {
    this.setData({ cooking: null, cookingSteps: [] });
  },

  async generateShopping() {
    if (!this.data.meal || this.data.items.length === 0) {
      wx.showToast({ title: '请先添加菜品', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '生成中...' });
    try {
      await this._api.generateShoppingList(this.data.familyId, { meal_id: this.data.meal.id, mode: 'REPLACE_GENERATED' });
      wx.hideLoading();
      wx.switchTab({ url: '/pages/shopping/shopping' });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '生成失败', icon: 'none' });
    }
  },

  goAddRecipes() {
    if (this.data.meal?.status !== 'PLANNING') {
      wx.showToast({ title: '已确认菜单不可加菜', icon: 'none' });
      return;
    }
    this._mealTarget.update({ meal_date: this.data.mealDate, meal_type: this.data.mealType, diners_count: this.data.dinersCount });
    wx.switchTab({ url: '/pages/menu/menu' });
  },
});
