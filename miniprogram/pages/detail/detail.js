// Recipe Detail — V1 API cutover
// Uses createV1Api + meal-target. No legacy API imports.
const { createV1Api } = require('../../utils/v1-api');
const { createMealTarget } = require('../../utils/meal-target');

const MEAL_TYPE_LABELS = { BREAKFAST: '早餐', LUNCH: '午餐', DINNER: '晚餐' };
const DIFFICULTY_LABELS = { 1: '简单', 2: '普通', 3: '较难', 4: '困难', 5: '大厨' };

Page({
  data: {
    recipeId: '',
    familyId: '',
    recipe: null,
    ingredients: [],
    steps: [],
    cookware: [],
    mealTypes: [],
    tags: [],
    allergens: [],
    nutrition: null,
    media: [],
    loading: true,
    loadError: null,
    currentTab: 'ingredients',
    busy: false,
    // Favorite / Rating (real this phase)
    isFavorite: false,
    currentRating: 0,
    showRatingPanel: false,
    favoriteBusy: false,
    ratingBusy: false,
    // Features not implemented this phase — kept as explicit disabled state
    wishDisabled: true,
    editDisabled: true,
  },

  onLoad(options) {
    this.recipeId = options.id;
    this.familyId = wx.getStorageSync('v1_active_family_id') || '';
    this._api = createV1Api({ wxAdapter: wx });
    this._mealTarget = createMealTarget({ wxAdapter: wx });
    this.setData({ recipeId: this.recipeId, familyId: this.familyId });
    this.loadRecipe();
  },

  async loadRecipe() {
    this.setData({ loading: true, loadError: null });
    try {
      const data = await this._api.getRecipe(this.familyId, this.recipeId);
      // V1 getRecipe returns { recipe, ingredients, steps, cookware, meal_types, tags, allergens, nutrition, media }
      const recipe = data.recipe || data;
      const ingredients = (data.ingredients || []).map(ing => ({
        ...ing,
        displayName: ing.display_name_override || ing.ingredient_name || '食材',
        amountText: ing.quantity_text || (ing.quantity != null ? `${ing.quantity}${ing.unit_code || ''}` : '适量'),
      }));
      const steps = (data.steps || []).map(s => ({
        ...s,
        stepNo: s.step_no,
        instruction: s.operation || s.title || '',
        durationText: s.duration_text || (s.duration_seconds ? `${Math.round(s.duration_seconds / 60)}分钟` : ''),
      }));
      // Backend returns extras as string[]: cookware=['WOK'], tags=['HOME_STYLE'], allergens=['PEANUT'], meal_types=['LUNCH']
      const cookware = (data.cookware || []).map(c => typeof c === 'string' ? c : (c.cookware_code || c.code || ''));
      const tags = (data.tags || []).map(t => typeof t === 'string' ? t : (t.tag_code || t.code || ''));
      const allergens = (data.allergens || []).map(a => typeof a === 'string' ? a : (a.allergen_code || a.code || ''));
      const mealTypes = (data.meal_types || []).map(m => typeof m === 'string' ? m : (m.meal_type_code || m.code || ''));
      this.setData({
        recipe,
        ingredients,
        steps,
        cookware,
        mealTypes,
        tags,
        allergens,
        nutrition: data.nutrition || null,
        media: data.media || [],
        isFavorite: data.viewer?.is_favorite === true,
        currentRating: data.viewer?.rating || 0,
        loading: false,
      });
    } catch (err) {
      console.error('loadRecipe failed', err);
      this.setData({ loading: false, loadError: err.message || '加载失败，请重试' });
    }
  },

  retryLoad() {
    this.loadRecipe();
  },

  switchTab(e) {
    this.setData({ currentTab: e.currentTarget.dataset.tab });
  },

  // ===== DETAIL-06: Add to current Meal (V1) =====
  async addToMeal() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const target = this._mealTarget.get();
      // Ensure meal exists
      let meal = await this._api.getCurrentMeal(this.familyId, target.meal_date, target.meal_type);
      if (!meal) {
        meal = await this._api.ensureCurrentMeal(this.familyId, {
          meal_date: target.meal_date,
          meal_type: target.meal_type,
          diners_count: target.diners_count || 2,
        });
      }
      // Add item — source MANUAL, servings from meal diners
      await this._api.addMealItem(this.familyId, meal.id, {
        recipe_id: this.recipeId,
        servings: meal.diners_count || 2,
        source: 'MANUAL',
      });
      const label = MEAL_TYPE_LABELS[target.meal_type] || target.meal_type;
      wx.showToast({ title: `已加入${label}菜单`, icon: 'success' });
    } catch (err) {
      if (err.code === 'ALREADY_IN_MEAL') {
        wx.showToast({ title: '这道菜已经在本餐菜单里了', icon: 'none' });
      } else {
        wx.showToast({ title: err.message || '加入失败，请重试', icon: 'none' });
      }
    } finally {
      this.setData({ busy: false });
    }
  },

  // ===== DETAIL-07: Start cooking (Meal-scoped, NOT dish-scoped) =====
  async startCooking() {
    if (this.data.busy) return;
    try {
      const target = this._mealTarget.get();
      const meal = await this._api.getCurrentMeal(this.familyId, target.meal_date, target.meal_type);
      if (!meal || meal.status !== 'CONFIRMED') {
        wx.showModal({
          title: '请先确认菜单',
          content: '需要先把这道菜加入本餐并确认菜单，才能开始做饭。',
          confirmText: '去确认',
          success: (res) => {
            if (res.confirm) {
              wx.navigateTo({
                url: `/pages/meal/meal?date=${target.meal_date}&meal_type=${target.meal_type}`,
              });
            }
          },
        });
        return;
      }
      const hasRecipe = (meal.items || []).some(it => it.recipe_id === this.recipeId);
      if (!hasRecipe) {
        wx.showToast({ title: '这道菜不在当前确认的菜单中', icon: 'none' });
        return;
      }
      // Navigate to meal page which will trigger cooking flow
      wx.navigateTo({
        url: `/pages/meal/meal?date=${target.meal_date}&meal_type=${target.meal_type}&auto_start=1`,
      });
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    }
  },

  // ===== DETAIL-01: Toggle favorite (V1) =====
  async onToggleFavorite() {
    if (this.data.favoriteBusy) return;
    this.setData({ favoriteBusy: true });
    const next = !this.data.isFavorite;
    try {
      await this._api.setFavorite(this.familyId, this.recipeId, next);
      this.setData({ isFavorite: next });
      wx.showToast({ title: next ? '已收藏' : '已取消收藏', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    } finally {
      this.setData({ favoriteBusy: false });
    }
  },

  // ===== DETAIL-03/08/09: Rating (V1) =====
  onOpenRating() {
    this.setData({ showRatingPanel: true });
  },

  onCloseRating() {
    this.setData({ showRatingPanel: false });
  },

  async onSetRating(e) {
    if (this.data.ratingBusy) return;
    const rating = Number(e.currentTarget.dataset.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return;
    this.setData({ ratingBusy: true });
    try {
      await this._api.setRating(this.familyId, this.recipeId, rating, null);
      this.setData({ currentRating: rating, showRatingPanel: false });
      wx.showToast({ title: '评分成功', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: err.message || '评分失败', icon: 'none' });
    } finally {
      this.setData({ ratingBusy: false });
    }
  },

  async onDeleteRating() {
    if (this.data.ratingBusy) return;
    this.setData({ ratingBusy: true });
    try {
      await this._api.deleteRating(this.familyId, this.recipeId);
      this.setData({ currentRating: 0, showRatingPanel: false });
      wx.showToast({ title: '已取消评分', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: err.message || '取消失败', icon: 'none' });
    } finally {
      this.setData({ ratingBusy: false });
    }
  },

  goBack() {
    wx.navigateBack();
  },

  onShareAppMessage() {
    const name = this.data.recipe ? this.data.recipe.name : '我们的小厨房';
    return {
      title: `推荐一道菜：${name}`,
      path: `/pages/detail/detail?id=${this.recipeId}`,
    };
  },
});
