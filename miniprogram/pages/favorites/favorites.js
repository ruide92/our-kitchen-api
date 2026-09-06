// Favorites Page — V1 API cutover
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
    this.loadFavorites();
  },

  async loadFavorites() {
    const familyId = wx.getStorageSync('v1_active_family_id') || '';
    const epoch = ++this.data._requestEpoch;
    this.setData({ familyId, loading: true, loadError: null });
    try {
      const data = await this._api.listFavorites(familyId);
      if (epoch !== this.data._requestEpoch) return; // stale response guard
      const dishes = (data || []).map(r => ({
        id: r.id,
        name: r.name,
        cover_image_url: r.cover_image_url || null,
        kind: r.kind,
        favorited_at: r.favorited_at,
      }));
      this.setData({ dishes, loading: false });
    } catch (err) {
      if (epoch !== this.data._requestEpoch) return;
      this.setData({ loading: false, loadError: err.message || '加载失败' });
    }
  },

  retryLoad() {
    this.loadFavorites();
  },

  goDetail(e) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${e.currentTarget.dataset.id}` });
  },

  async removeFavorite(e) {
    const id = e.currentTarget.dataset.id;
    try {
      await this._api.setFavorite(this.data.familyId, id, false);
      wx.showToast({ title: '已取消收藏', icon: 'success' });
      this.loadFavorites();
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    }
  },
});
