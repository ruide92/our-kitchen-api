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
  },

  onLoad(options) {
    const familyId = wx.getStorageSync('v1_active_family_id');
    const mealDate = options.date || this._today();
    const mealType = options.meal_type || 'DINNER';
    this.setData({ familyId, mealDate, mealType });
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
    } catch (e) {
      this.setData({ meal: null, items: [], loading: false });
    }
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
    await this._updateDiners(this.data.dinersCount - 1);
  },

  async increaseDiners() {
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
    // Save current meal target so menu page continues with same meal
    this._mealTarget.update({ meal_date: this.data.mealDate, meal_type: this.data.mealType, diners_count: this.data.dinersCount });
    wx.switchTab({ url: '/pages/menu/menu' });
  },
});
