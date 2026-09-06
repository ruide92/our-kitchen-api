// Random Meal Page — V1
// Uses shared recommendation engine. Modes: BALANCED, USE_INVENTORY, TRY_DIFFERENT.
// One-person via diners_count=1 (not a separate mode).
const { createV1Api } = require('../../utils/v1-api');
const { createMealTarget } = require('../../utils/meal-target');

const MODE_LABELS = { BALANCED: '均衡推荐', USE_INVENTORY: '冰箱优先', TRY_DIFFERENT: '换个口味' };
const REASON_LABELS = {
  FAMILY_FAVORITE: '家人喜欢',
  WISH_MATCH: '有人想吃',
  USE_EXPIRING_INGREDIENT: '快过期食材优先',
  HIGH_INVENTORY_MATCH: '家里食材齐全',
  QUICK_TO_COOK: '快手菜',
  PROTEIN_VARIETY: '蛋白多样',
  VEGETABLE_BALANCE: '荤素搭配',
  COOKING_METHOD_VARIETY: '烹饪方式多样',
  TRY_SOMETHING_DIFFERENT: '换个新口味'
};

function reasonLabel(code) {
  return REASON_LABELS[code] || code;
}

Page({
  data: {
    familyId: '',
    mealDate: '',
    mealType: 'DINNER',
    dinersCount: 2,
    mode: 'BALANCED',
    targetCount: 3,
    recipes: [],
    lockedIds: [],
    loading: false,
    error: null,
    isEmpty: false,
    warnings: [],
    busy: false,
    requestEpoch: 0,
    modeLabels: MODE_LABELS
  },

  onLoad(options) {
    const familyId = wx.getStorageSync('v1_active_family_id');
    const mealTarget = createMealTarget({ wxAdapter: wx }).get();
    const mealDate = options.meal_date || mealTarget.meal_date;
    const mealType = options.meal_type || mealTarget.meal_type;
    const dinersCount = options.diners_count ? parseInt(options.diners_count) : mealTarget.diners_count;
    const mode = options.mode || 'BALANCED';
    this.setData({ familyId, mealDate, mealType, dinersCount, mode });
    this._api = createV1Api({ wxAdapter: wx });
    this._mealTarget = createMealTarget({ wxAdapter: wx });
    this.generate();
  },

  onShow() {
    if (this.getTabBar()) this.getTabBar().setData({ selected: 0, hidden: false });
  },

  setMode(e) {
    if (this.data.busy) return; // busy: do not change UI mode, prevents stale response mismatch
    const mode = e.currentTarget.dataset.mode;
    this.setData({ mode, lockedIds: [] });
    this.generate();
  },

  setCount(e) {
    if (this.data.busy) return; // busy: do not change UI count
    const targetCount = parseInt(e.currentTarget.dataset.count);
    this.setData({ targetCount, lockedIds: [] });
    this.generate();
  },

  async generate() {
    if (this.data.busy) return;
    const epoch = ++this.data.requestEpoch;
    this.setData({ busy: true, loading: true, error: null, isEmpty: false });

    try {
      const result = await this._api.generateRandomMeal(this.data.familyId, {
        meal_date: this.data.mealDate,
        meal_type: this.data.mealType,
        diners_count: this.data.dinersCount,
        mode: this.data.mode,
        target_count: this.data.targetCount,
        locked_recipe_ids: this.data.lockedIds
      });
      if (epoch !== this.data.requestEpoch) return; // stale response guard

      const recipes = (result.recipes || []).map(r => ({
        ...r,
        reasonLabels: (r.reasons || []).map(reasonLabel)
      }));
      this.setData({
        recipes,
        isEmpty: recipes.length === 0,
        warnings: result.warnings || [],
        loading: false,
        busy: false
      });
    } catch (err) {
      if (epoch !== this.data.requestEpoch) return;
      this.setData({ error: err.message || '推荐失败，请重试', loading: false, busy: false, recipes: [] });
    }
  },

  toggleLock(e) {
    const id = e.currentTarget.dataset.id;
    const lockedIds = this.data.lockedIds.includes(id)
      ? this.data.lockedIds.filter(i => i !== id)
      : [...this.data.lockedIds, id];
    this.setData({ lockedIds });
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  async eatThese() {
    if (this.data.busy || this.data.recipes.length === 0) return;
    this.setData({ busy: true });

    try {
      // Ensure current meal exists
      const meal = await this._api.ensureCurrentMeal(this.data.familyId, {
        meal_date: this.data.mealDate,
        meal_type: this.data.mealType,
        diners_count: this.data.dinersCount
      });
      const mealId = meal.id || meal.meal?.id;

      // Add each recipe as RANDOM source
      const results = [];
      for (const recipe of this.data.recipes) {
        try {
          await this._api.addMealItem(this.data.familyId, mealId, {
            recipe_id: recipe.id,
            servings: this.data.dinersCount,
            source: 'RANDOM'
          });
          results.push({ id: recipe.id, ok: true });
        } catch (err) {
          if (err.code === 'ALREADY_IN_MEAL' || err.status === 409) {
            results.push({ id: recipe.id, ok: true, already: true });
          } else {
            results.push({ id: recipe.id, ok: false, error: err.message });
          }
        }
      }

      const failed = results.filter(r => !r.ok);
      if (failed.length > 0) {
        wx.showToast({ title: `${failed.length} 道加入失败`, icon: 'none' });
      } else {
        wx.showToast({ title: '已加入本餐菜单', icon: 'success' });
      }

      this.setData({ busy: false });
      setTimeout(() => {
        wx.redirectTo({
          url: `/pages/meal/meal?date=${this.data.mealDate}&meal_type=${this.data.mealType}`
        });
      }, 800);
    } catch (err) {
      this.setData({ busy: false });
      wx.showToast({ title: err.message || '加入失败', icon: 'none' });
    }
  }
});
