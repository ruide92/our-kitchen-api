const { createV1Api } = require('../../utils/v1-api');
const { hideTabBar, showTabBar } = require('../../utils/tabbar-overlay');

const MEAL_LABELS = { BREAKFAST: '早餐', LUNCH: '午餐', DINNER: '晚餐' };

Page({
  data: {
    familyId: '',
    mealDate: '',
    mealType: 'DINNER',
    meal: null,
    items: [],
    loading: true,
    dinersCount: 2
  },

  onLoad(options) {
    const familyId = wx.getStorageSync('v1_active_family_id');
    const mealDate = options.date || this._today();
    const mealType = options.meal_type || 'DINNER';
    this.setData({ familyId, mealDate, mealType });
    this._api = createV1Api({ wxAdapter: wx });
    this.loadMeal();
  },

  onShow() {
    if (this.getTabBar()) this.getTabBar().setData({ selected: 1, hidden: false });
  },

  _today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },

  async loadMeal() {
    this.setData({ loading: true });
    try {
      const meal = await this._api.getCurrentMeal(this.data.familyId, this.data.mealDate, this.data.mealType);
      this.setData({ meal, items: meal?.items || [], loading: false, dinersCount: meal?.diners_count || 2 });
    } catch (e) {
      this.setData({ meal: null, items: [], loading: false });
    }
  },

  async ensureMeal() {
    try {
      const meal = await this._api.ensureCurrentMeal(this.data.familyId, {
        meal_date: this.data.mealDate,
        meal_type: this.data.mealType,
        diners_count: this.data.dinersCount
      });
      this.setData({ meal, items: meal.items || [] });
      return meal;
    } catch (e) {
      wx.showToast({ title: e.message || '创建失败', icon: 'none' });
      return null;
    }
  },

  async removeItem(e) {
    const itemId = e.currentTarget.dataset.id;
    if (!this.data.meal) return;
    try {
      await this._api.removeMealItem(this.data.familyId, this.data.meal.id, itemId);
      await this.loadMeal();
    } catch (e) {
      wx.showToast({ title: e.message || '删除失败', icon: 'none' });
    }
  },

  async generateShopping() {
    if (!this.data.meal || this.data.items.length === 0) {
      wx.showToast({ title: '请先添加菜品', icon: 'none' });
      return;
    }
    try {
      await this._api.generateShoppingList(this.data.familyId, { meal_id: this.data.meal.id, mode: 'REPLACE_GENERATED' });
      wx.switchTab({ url: '/pages/shopping/shopping' });
    } catch (e) {
      wx.showToast({ title: e.message || '生成失败', icon: 'none' });
    }
  },

  goAddRecipes() {
    wx.switchTab({ url: '/pages/menu/menu' });
  },

  get mealLabel() {
    return MEAL_LABELS[this.data.mealType] || '晚餐';
  }
});
