const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const DETAIL_JS = path.resolve(__dirname, '../../miniprogram/pages/detail/detail.js');
const DETAIL_WXML = path.resolve(__dirname, '../../miniprogram/pages/detail/detail.wxml');
const FAVORITES_JS = path.resolve(__dirname, '../../miniprogram/pages/favorites/favorites.js');
const FAVORITES_WXML = path.resolve(__dirname, '../../miniprogram/pages/favorites/favorites.wxml');
const RATINGS_JS = path.resolve(__dirname, '../../miniprogram/pages/ratings/ratings.js');
const RATINGS_WXML = path.resolve(__dirname, '../../miniprogram/pages/ratings/ratings.wxml');
const MINE_CONTROLLER = path.resolve(__dirname, '../../miniprogram/pages/mine/mine-controller.js');
const V1_API = path.resolve(__dirname, '../../miniprogram/utils/v1-api.js');

function mockPageEnv(extraWx = {}) {
  const captured = { pageConfig: null };
  global.Page = (config) => { captured.pageConfig = config; };
  const toasts = [];
  const modals = [];
  const storage = {};
  const wx = {
    showToast: (o) => toasts.push(o.title),
    showModal: (o) => modals.push(o),
    showLoading: () => {},
    hideLoading: () => {},
    setStorageSync: (k, v) => { storage[k] = v; },
    getStorageSync: (k) => storage[k],
    removeStorageSync: (k) => { delete storage[k]; },
    switchTab: () => {},
    navigateTo: (o) => { storage.__navigateTo = o.url; },
    navigateBack: () => {},
    ...extraWx,
  };
  global.wx = wx;
  global.getApp = () => ({
    getV1Session: () => ({
      getState: () => ({ active_family_id: 'f1', user: { id: 'u1' } }),
      api: null,
    }),
  });
  return { captured, toasts, modals, storage, wx };
}

function makePage(captured, initialData = {}) {
  const pageConfig = captured.pageConfig;
  if (!pageConfig) throw new Error('Page config not captured');
  const page = { ...pageConfig, data: { ...pageConfig.data, ...initialData } };
  page.setData = function (values) { Object.assign(this.data, values); };
  return page;
}

function loadDetailPage() {
  delete require.cache[require.resolve(DETAIL_JS)];
  const env = mockPageEnv();
  require(DETAIL_JS);
  return env;
}

function loadFavoritesPage() {
  delete require.cache[require.resolve(FAVORITES_JS)];
  const env = mockPageEnv();
  require(FAVORITES_JS);
  return env;
}

function loadRatingsPage() {
  delete require.cache[require.resolve(RATINGS_JS)];
  const env = mockPageEnv();
  require(RATINGS_JS);
  return env;
}

// Q1: Detail load viewer.is_favorite=true → 收藏状态正确
test('Q1 detail load sets isFavorite from viewer', async () => {
  const env = loadDetailPage();
  const page = makePage(env.captured);
  page.recipeId = 'r1';
  page.familyId = 'f1';
  page._api = {
    getRecipe: async () => ({
      recipe: { id: 'r1', name: 'test' },
      ingredients: [], steps: [], media: [],
      meal_types: [], tags: [], cookware: [], allergens: [],
      viewer: { is_favorite: true, rating: 3, wish_status: null }
    }),
  };
  await page.loadRecipe();
  assert.equal(page.data.isFavorite, true);
  assert.equal(page.data.currentRating, 3);
});

// Q2: favorite click calls V1 setFavorite
test('Q2 favorite click calls setFavorite', async () => {
  const env = loadDetailPage();
  const page = makePage(env.captured, { isFavorite: false, favoriteBusy: false });
  page.recipeId = 'r1';
  page.familyId = 'f1';
  let called = false;
  page._api = { setFavorite: async () => { called = true; return {}; } };
  await page.onToggleFavorite();
  assert.equal(called, true);
  assert.equal(page.data.isFavorite, true);
});

// Q3: favorite busy guard
test('Q3 favorite busy guard prevents double click', async () => {
  const env = loadDetailPage();
  const page = makePage(env.captured, { isFavorite: false, favoriteBusy: true });
  let callCount = 0;
  page._api = { setFavorite: async () => { callCount++; return {}; } };
  await page.onToggleFavorite();
  assert.equal(callCount, 0);
});

// Q4: rating panel reads current viewer.rating
test('Q4 rating panel highlights current rating', () => {
  const env = loadDetailPage();
  const page = makePage(env.captured, { currentRating: 4 });
  page.onOpenRating();
  assert.equal(page.data.showRatingPanel, true);
  assert.equal(page.data.currentRating, 4);
});

// Q5: set rating calls V1 setRating and updates UI
test('Q5 set rating calls API and updates UI', async () => {
  const env = loadDetailPage();
  const page = makePage(env.captured, { currentRating: 0, ratingBusy: false, showRatingPanel: true });
  page.recipeId = 'r1';
  page.familyId = 'f1';
  let calledRating = null;
  page._api = { setRating: async (fid, rid, rating, mealId) => { calledRating = rating; return {}; } };
  await page.onSetRating({ currentTarget: { dataset: { rating: 5 } } });
  assert.equal(calledRating, 5);
  assert.equal(page.data.currentRating, 5);
  assert.equal(page.data.showRatingPanel, false);
});

// Q6: Favorites page no legacy api import
test('Q6 favorites page no legacy api import', () => {
  const js = fs.readFileSync(FAVORITES_JS, 'utf8');
  assert.ok(!js.includes("require('../../utils/api.js')"), 'favorites.js should not import legacy api.js');
  assert.ok(js.includes('createV1Api'), 'favorites.js should use createV1Api');
});

// Q7: Favorites page real listFavorites
test('Q7 favorites page uses listFavorites', async () => {
  const env = loadFavoritesPage();
  const page = makePage(env.captured);
  env.storage['v1_active_family_id'] = 'f1';
  let called = false;
  page._api = { listFavorites: async () => { called = true; return [{ id: 'r1', name: '菜1' }]; } };
  await page.loadFavorites();
  assert.equal(called, true);
  assert.equal(page.data.dishes.length, 1);
});

// Q8: Favorites remove calls setFavorite false
test('Q8 favorites remove calls setFavorite false', async () => {
  const env = loadFavoritesPage();
  const page = makePage(env.captured, { familyId: 'f1', dishes: [{ id: 'r1' }] });
  let called = null;
  page._api = { setFavorite: async (fid, rid, fav) => { called = fav; return {}; }, listFavorites: async () => [] };
  await page.removeFavorite({ currentTarget: { dataset: { id: 'r1' } } });
  assert.equal(called, false);
});

// Q9: Ratings page no legacy api import
test('Q9 ratings page no legacy api import', () => {
  const js = fs.readFileSync(RATINGS_JS, 'utf8');
  assert.ok(!js.includes("require('../../utils/api.js')"), 'ratings.js should not import legacy api.js');
  assert.ok(js.includes('createV1Api'), 'ratings.js should use createV1Api');
});

// Q10: Ratings uses item.rating not score/default 5
test('Q10 ratings uses item.rating not score', async () => {
  const env = loadRatingsPage();
  const page = makePage(env.captured);
  env.storage['v1_active_family_id'] = 'f1';
  page._api = { listRatings: async () => [{ recipe_id: 'r1', recipe_name: '菜1', rating: 2 }] };
  await page.loadRatings();
  assert.equal(page.data.dishes[0].rating, 2);
  assert.equal(page.data.dishes[0].stars, '★★☆☆☆');
});

// Q11: Mine 我的收藏 real navigation
test('Q11 mine favorites entry navigates to favorites page', () => {
  const mineJs = fs.readFileSync(path.resolve(__dirname, '../../miniprogram/pages/mine/mine-controller.js'), 'utf8');
  assert.ok(mineJs.includes("action: 'goFavorites'"), 'mine menu should have goFavorites action');
  assert.ok(mineJs.includes('goFavorites()'), 'mine controller should have goFavorites handler');
  assert.ok(mineJs.includes("/pages/favorites/favorites"), 'goFavorites should navigate to favorites page');
});

// Q12: Mine 我的评分 real navigation
test('Q12 mine ratings entry navigates to ratings page', () => {
  const mineJs = fs.readFileSync(path.resolve(__dirname, '../../miniprogram/pages/mine/mine-controller.js'), 'utf8');
  assert.ok(mineJs.includes("action: 'goRatings'"), 'mine menu should have goRatings action');
  assert.ok(mineJs.includes('goRatings()'), 'mine controller should have goRatings handler');
  assert.ok(mineJs.includes("/pages/ratings/ratings"), 'goRatings should navigate to ratings page');
});

// Q13: empty !== error — favorites has distinct empty and error states
test('Q13 favorites empty vs error distinct', () => {
  const wxml = fs.readFileSync(FAVORITES_WXML, 'utf8');
  assert.ok(wxml.includes('还没有收藏的菜谱'), 'favorites should have empty state text');
  assert.ok(wxml.includes('loadError'), 'favorites should have error state');
  assert.ok(wxml.includes('retryLoad'), 'favorites should have retry button');
});

// Q14: family change stale response guard
test('Q14 favorites stale response guard', async () => {
  const env = loadFavoritesPage();
  const page = makePage(env.captured);
  env.storage['v1_active_family_id'] = 'f1';
  // First request starts (slow)
  let resolveFirst;
  const firstPromise = new Promise(r => { resolveFirst = r; });
  page._api = { listFavorites: async () => { await firstPromise; return [{ id: 'old' }]; } };
  const firstLoad = page.loadFavorites();
  // Second request starts
  env.storage['v1_active_family_id'] = 'f2';
  page._api = { listFavorites: async () => [{ id: 'new' }] };
  await page.loadFavorites();
  // Resolve first (stale)
  resolveFirst();
  await firstLoad;
  // Should still have new data, not old
  assert.equal(page.data.dishes[0].id, 'new');
});

// Q15: Detail currentRating>0 shows delete rating entry
test('Q15 detail shows delete rating when currentRating>0', () => {
  const wxml = fs.readFileSync(DETAIL_WXML, 'utf8');
  assert.ok(wxml.includes('onDeleteRating'), 'detail should have onDeleteRating handler');
  assert.ok(wxml.includes('取消评分'), 'detail should show 取消评分 text');
  assert.ok(wxml.includes('currentRating > 0'), 'delete rating should be conditional on currentRating>0');
});

// Q16: Detail deleteRating success → currentRating=0
test('Q16 detail deleteRating success clears rating', async () => {
  const env = loadDetailPage();
  const page = makePage(env.captured, { currentRating: 4, ratingBusy: false, showRatingPanel: true });
  page.recipeId = 'r1';
  page.familyId = 'f1';
  let called = false;
  page._api = { deleteRating: async () => { called = true; return {}; } };
  await page.onDeleteRating();
  assert.equal(called, true);
  assert.equal(page.data.currentRating, 0);
  assert.equal(page.data.showRatingPanel, false);
});

// Q17: Ratings Page delete uses V1 deleteRating, not legacy
test('Q17 ratings page delete uses V1 deleteRating', () => {
  const js = fs.readFileSync(RATINGS_JS, 'utf8');
  assert.ok(js.includes('deleteRating'), 'ratings.js should call deleteRating');
  assert.ok(!js.includes("require('../../utils/api.js')"), 'ratings.js should not import legacy api');
  const wxml = fs.readFileSync(RATINGS_WXML, 'utf8');
  assert.ok(wxml.includes('removeRating'), 'ratings.wxml should have removeRating handler');
});

// Q18: Ratings delete success removes/reloads
test('Q18 ratings delete success reloads list', async () => {
  const env = loadRatingsPage();
  const page = makePage(env.captured, { familyId: 'f1', dishes: [{ recipe_id: 'r1', rating: 4 }] });
  let deleteCalled = false;
  let loadCalled = false;
  page._api = {
    deleteRating: async () => { deleteCalled = true; return {}; },
    listRatings: async () => { loadCalled = true; return []; }
  };
  await page.removeRating({ currentTarget: { dataset: { id: 'r1' } } });
  assert.equal(deleteCalled, true);
  assert.equal(loadCalled, true);
  assert.equal(page.data.dishes.length, 0);
});
