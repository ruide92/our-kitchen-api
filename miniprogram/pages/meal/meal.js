const { createV1Api } = require('../../utils/v1-api');
const { createMealTarget } = require('../../utils/meal-target');

const MEAL_LABELS = { BREAKFAST: '早餐', LUNCH: '午餐', DINNER: '晚餐' };
const SOURCE_LABELS = { MANUAL: '手工点', WEEKLY_PLAN: '周计划', RANDOM: '随机', WISH: '想吃' };
const COOKING_STORAGE_PREFIX = 'v1_cooking_state_';

function cookingStorageKey(familyId, mealId) {
  return COOKING_STORAGE_PREFIX + familyId + '_' + mealId;
}

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
    cookingData: null,
    cookingSteps: [],
    showCooking: false,
    cookingUnavailable: false,
    autoStart: false,
    // Completion sheet
    showCompletionSheet: false,
    consumptionCandidates: [],
    completing: false,
    confirmZeroConsumption: false,
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

  onHide() {
    this.setData({ showCompletionSheet: false });
  },

  onUnload() {
    this.setData({ showCompletionSheet: false });
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

  _normalizeSteps(steps) {
    return (steps || []).map(s => ({
      ...s,
      recipeName: s.recipe_name || '',
      instruction: s.operation || s.title || '',
      durationText: s.duration_text || (s.duration_seconds ? `${Math.round(s.duration_seconds / 60)}分钟` : ''),
    }));
  },

  _loadLocalCooking(mealId) {
    try {
      const key = cookingStorageKey(this.data.familyId, mealId);
      const stored = wx.getStorageSync(key);
      if (stored && stored.session_id && stored.steps) {
        return stored;
      }
    } catch (_) {}
    return null;
  },

  _saveLocalCooking(mealId, data) {
    try {
      const key = cookingStorageKey(this.data.familyId, mealId);
      wx.setStorageSync(key, data);
    } catch (_) {}
  },

  _clearLocalCooking(mealId) {
    try {
      const key = cookingStorageKey(this.data.familyId, mealId);
      wx.removeStorageSync(key);
    } catch (_) {}
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

      // Handle COOKING state — server-side resume is authoritative
      if (meal?.status === 'COOKING') {
        await this._resumeCookingFromServer(meal.id);
      } else if (meal?.status === 'COMPLETED') {
        this.setData({ cookingData: null, cookingSteps: [], showCooking: false, cookingUnavailable: false });
      } else {
        this.setData({ cookingUnavailable: false });
      }

      // Auto-start cooking if requested and meal is CONFIRMED
      if (this.data.autoStart && meal?.status === 'CONFIRMED') {
        this.setData({ autoStart: false });
        this.startCooking();
      }
    } catch (e) {
      this.setData({ meal: null, items: [], loading: false, mealError: e.message || '加载失败，请重试' });
    }
  },

  // Server-side resume: authoritative source for COOKING state
  async _resumeCookingFromServer(mealId) {
    try {
      // Try local cache first for session_id, then fetch from server
      const local = this._loadLocalCooking(mealId);
      let sessionData = null;

      if (local && local.session_id) {
        try {
          sessionData = await this._api.getCookingSession(this.data.familyId, local.session_id);
        } catch (_) {
          // If session not found by local id, try active session by meal
          sessionData = await this._api.getActiveCookingSession(this.data.familyId, mealId);
        }
      } else {
        // No local session_id — use active session by meal (new device resume)
        sessionData = await this._api.getActiveCookingSession(this.data.familyId, mealId);
      }

      if (sessionData && sessionData.status === 'ACTIVE') {
        const cookingData = {
          session_id: sessionData.session_id,
          meal_id: mealId,
          family_id: this.data.familyId,
          meal_date: this.data.mealDate,
          meal_type: this.data.mealType,
          steps: sessionData.steps || [],
          saved_at: new Date().toISOString(),
        };
        // Update local cache with server data
        this._saveLocalCooking(mealId, cookingData);
        this.setData({
          cookingData,
          cookingSteps: this._normalizeSteps(sessionData.steps),
          consumptionCandidates: sessionData.consumption_candidates || [],
          cookingUnavailable: false,
        });
      } else if (sessionData && sessionData.status === 'COMPLETED') {
        // Session already completed — meal should be COMPLETED, reload
        this._clearLocalCooking(mealId);
        this.setData({ cookingData: null, cookingSteps: [], cookingUnavailable: false });
      } else {
        this.setData({ cookingUnavailable: true, cookingData: null, cookingSteps: [] });
      }
    } catch (_) {
      // Server resume failed — fall back to local if available
      const local = this._loadLocalCooking(mealId);
      if (local) {
        this.setData({
          cookingData: local,
          cookingSteps: this._normalizeSteps(local.steps),
          cookingUnavailable: false,
        });
      } else {
        this.setData({ cookingUnavailable: true, cookingData: null, cookingSteps: [] });
      }
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

  // ===== MEAL-07: Confirm menu =====
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
      const existingItems = this.data.items;
      const confirmed = await this._api.confirmMeal(this.data.familyId, this.data.meal.id);
      const snapshot = confirmed?.recipe_snapshot;
      if (!snapshot || snapshot.schema_version !== 1) {
        throw new Error('MEAL_SNAPSHOT_MISSING');
      }
      this.setData({ meal: confirmed, items: existingItems, busy: false });
      wx.showToast({ title: '菜单已确认', icon: 'success' });
    } catch (err) {
      this.setData({ busy: false });
      if (err.code === 'MEAL_SNAPSHOT_MISSING' || err.code === 'MEAL_SNAPSHOT_UNSUPPORTED' || err.message === 'MEAL_SNAPSHOT_MISSING') {
        wx.showModal({ title: '确认失败', content: '菜单快照创建失败，请重试。', showCancel: false });
      } else {
        wx.showToast({ title: err.message || '确认失败', icon: 'none' });
      }
    }
  },

  // ===== MEAL-08: Start cooking =====
  async startCooking() {
    if (this.data.busy) return;
    if (!this.data.meal || this.data.meal.status !== 'CONFIRMED') {
      wx.showToast({ title: '请先确认菜单', icon: 'none' });
      return;
    }
    this.setData({ busy: true });
    try {
      const result = await this._api.startCooking(this.data.familyId, this.data.meal.id);
      const cookingData = {
        session_id: result.session_id,
        meal_id: this.data.meal.id,
        family_id: this.data.familyId,
        meal_date: this.data.mealDate,
        meal_type: this.data.mealType,
        steps: result.steps || [],
        saved_at: new Date().toISOString(),
      };
      this._saveLocalCooking(this.data.meal.id, cookingData);
      // Fetch full session with consumption candidates
      let candidates = [];
      try {
        const fullSession = await this._api.getCookingSession(this.data.familyId, result.session_id);
        candidates = fullSession.consumption_candidates || [];
      } catch (_) {}
      this.setData({
        cookingData,
        cookingSteps: this._normalizeSteps(result.steps),
        consumptionCandidates: candidates,
        showCooking: true,
        cookingUnavailable: false,
        meal: { ...this.data.meal, status: 'COOKING' },
        busy: false,
      });
      wx.showToast({ title: '开始做饭', icon: 'success' });
    } catch (err) {
      this.setData({ busy: false });
      if (err.code === 'MEAL_NOT_CONFIRMED') {
        wx.showToast({ title: '请先确认菜单', icon: 'none' });
      } else if (err.code === 'SESSION_ALREADY_ACTIVE') {
        wx.showToast({ title: '已有进行中的做饭会话', icon: 'none' });
        this.loadMeal();
      } else {
        wx.showToast({ title: err.message || '开始做饭失败', icon: 'none' });
      }
    }
  },

  // ===== MEAL-10: Resume cooking =====
  resumeCooking() {
    if (!this.data.cookingData) {
      wx.showToast({ title: '没有可恢复的做饭步骤', icon: 'none' });
      return;
    }
    this.setData({ showCooking: true });
  },

  exitCooking() {
    this.setData({ showCooking: false });
  },

  // ===== MEAL-11: Show completion sheet =====
  showCompletionSheet() {
    if (!this.data.cookingData) return;
    // Reset quantities to suggested
    const candidates = (this.data.consumptionCandidates || []).map(c => ({
      ...c,
      actual_quantity: c.suggested_quantity != null ? c.suggested_quantity : 0,
    }));
    this.setData({ showCompletionSheet: true, consumptionCandidates: candidates, confirmZeroConsumption: false });
  },

  hideCompletionSheet() {
    this.setData({ showCompletionSheet: false, confirmZeroConsumption: false });
  },

  onConsumptionInput(e) {
    const idx = e.currentTarget.dataset.index;
    const value = e.detail.value;
    const candidates = this.data.consumptionCandidates.slice();
    candidates[idx] = { ...candidates[idx], actual_quantity: value === '' ? 0 : Number(value) };
    this.setData({ consumptionCandidates: candidates });
  },

  // ===== MEAL-12: Confirm complete cooking =====
  async confirmComplete() {
    if (this.data.completing) return;
    if (!this.data.cookingData?.session_id) return;

    const candidates = this.data.consumptionCandidates || [];
    const hasPositive = candidates.some(c => Number(c.actual_quantity) > 0);

    // If all zero, require explicit confirmation
    if (!hasPositive && !this.data.confirmZeroConsumption) {
      this.setData({ confirmZeroConsumption: true });
      wx.showModal({
        title: '不扣库存',
        content: '本次所有食材用量为 0，不会扣减冰箱库存。仍要完成做饭吗？',
        confirmText: '完成',
        success: (res) => {
          if (res.confirm) {
            this._doComplete([]);
          } else {
            this.setData({ confirmZeroConsumption: false });
          }
        },
      });
      return;
    }

    // Build consumption payload (only positive quantities)
    const consumption = candidates
      .filter(c => Number(c.actual_quantity) > 0)
      .map(c => ({
        ingredient_id: c.ingredient_id,
        quantity: Number(c.actual_quantity),
        unit_code: c.unit_code,
      }));

    this._doComplete(consumption);
  },

  async _doComplete(consumption) {
    this.setData({ completing: true });
    try {
      await this._api.completeCooking(this.data.familyId, this.data.cookingData.session_id, { consumption });
      // Clear local cooking cache
      this._clearLocalCooking(this.data.meal.id);
      this.setData({
        showCompletionSheet: false,
        showCooking: false,
        cookingData: null,
        cookingSteps: [],
        consumptionCandidates: [],
        completing: false,
        confirmZeroConsumption: false,
      });
      wx.showToast({ title: '这顿饭完成啦', icon: 'success' });
      // Reload meal to show COMPLETED state
      await this.loadMeal();
    } catch (err) {
      this.setData({ completing: false });
      if (err.code === 'INVENTORY_INSUFFICIENT') {
        const details = err.details || {};
        wx.showModal({
          title: '库存不足',
          content: `食材库存不足，还缺 ${details.remaining || ''}${details.remaining_unit || ''}。请调整用量后重试。`,
          showCancel: false,
        });
      } else if (err.code === 'INGREDIENT_NOT_IN_SNAPSHOT') {
        wx.showToast({ title: '食材不在本餐菜谱中', icon: 'none' });
      } else if (err.code === 'SESSION_NOT_ACTIVE') {
        wx.showToast({ title: '会话已完成', icon: 'none' });
        this.loadMeal();
      } else {
        wx.showToast({ title: err.message || '完成失败', icon: 'none' });
      }
    }
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
