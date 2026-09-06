// Ratings Page — V1 API cutover
const { createV1Api } = require('../../utils/v1-api');

Page({
  data: {
    dishes: [],
    loading: true,
    loadError: null,
    familyId: '',
    _requestEpoch: 0,
  },

  onLoad() {
    this._api = createV1Api({ wxAdapter: wx });
  },

  onShow() {
    this.loadRatings();
  },

  async loadRatings() {
    const familyId = wx.getStorageSync('v1_active_family_id') || '';
    const epoch = ++this.data._requestEpoch;
    this.setData({ familyId, loading: true, loadError: null });
    try {
      const data = await this._api.listRatings(familyId);
      if (epoch !== this.data._requestEpoch) return; // stale response guard
      const dishes = (data || []).map(item => ({
        id: item.recipe_id,
        recipe_id: item.recipe_id,
        name: item.recipe_name || '未命名菜谱',
        rating: item.rating,
        stars: '★'.repeat(item.rating || 0) + '☆'.repeat(5 - (item.rating || 0)),
        updated_at: item.updated_at,
      }));
      this.setData({ dishes, loading: false });
    } catch (err) {
      if (epoch !== this.data._requestEpoch) return;
      this.setData({ loading: false, loadError: err.message || '加载失败' });
    }
  },

  retryLoad() {
    this.loadRatings();
  },

  goDetail(e) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${e.currentTarget.dataset.id}` });
  },

  async removeRating(e) {
    const id = e.currentTarget.dataset.id;
    try {
      await this._api.deleteRating(this.data.familyId, id);
      wx.showToast({ title: '已取消评分', icon: 'success' });
      this.loadRatings();
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    }
  },
});
