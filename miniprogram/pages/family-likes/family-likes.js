// Family Likes Page — family preference discovery
const { createV1Api } = require('../../utils/v1-api');

Page({
  data: {
    recipes: [],
    loading: true,
    loadError: null,
    familyId: '',
    _requestEpoch: 0,
  },

  onLoad() {
    this._api = createV1Api({ wxAdapter: wx });
  },

  onShow() {
    this.loadFamilyPreferences();
  },

  async loadFamilyPreferences() {
    const familyId = wx.getStorageSync('v1_active_family_id') || '';
    const epoch = ++this.data._requestEpoch;
    this.setData({ familyId, loading: true, loadError: null });
    try {
      const data = await this._api.getFamilyPreferences(familyId);
      if (epoch !== this.data._requestEpoch) return; // stale response guard
      const recipes = (data?.recipes || []).map(r => ({
        recipe_id: r.recipe_id,
        recipe_name: r.recipe_name,
        cover_image: r.cover_image,
        family_score: r.family_score,
        reasons: r.reasons || [],
        members: r.members || [],
      }));
      this.setData({ recipes, loading: false });
    } catch (err) {
      if (epoch !== this.data._requestEpoch) return;
      this.setData({ loading: false, loadError: err.message || '加载失败' });
    }
  },

  retryLoad() {
    this.loadFamilyPreferences();
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },
});
