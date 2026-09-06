const { createV1Api } = require('../../utils/v1-api');

const MEAL_LABELS = { BREAKFAST: '早餐', LUNCH: '午餐', DINNER: '晚餐' };
const STATUS_LABELS = { CONFIRMED: '已确认', COOKING: '做饭中', COMPLETED: '已完成' };

Page({
  data: {
    familyId: '',
    loading: true,
    historyError: null,
    meals: [],
  },

  onLoad() {
    const familyId = wx.getStorageSync('v1_active_family_id');
    this.setData({ familyId });
    this._api = createV1Api({ wxAdapter: wx });
    this.loadHistory();
  },

  onShow() {
    if (this.getTabBar()) this.getTabBar().setData({ selected: 4, hidden: false });
    this.loadHistory();
  },

  async loadHistory() {
    this.setData({ loading: true });
    try {
      const meals = await this._api.getMealHistory(this.data.familyId, 50);
      const normalized = (meals || []).map(m => ({
        ...m,
        meal_label: MEAL_LABELS[m.meal_type] || m.meal_type,
        status_label: STATUS_LABELS[m.status] || m.status,
        date_label: m.meal_date,
        items: (m.items || []).map(it => ({
          ...it,
          selectedByLabel: it.selected_by_nickname || '家庭成员',
        })),
      }));
      this.setData({ meals: normalized, loading: false, historyError: null });
    } catch (e) {
      this.setData({ loading: false, historyError: e.message || '加载失败' });
    }
  },

  retryLoad() {
    this.loadHistory();
  },

  goMeal(e) {
    const { date, type } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/meal/meal?date=${date}&meal_type=${type}` });
  },
});
