const api = require('../../utils/api.js')
const util = require('../../utils/util.js')

Page({
  data: {
    categories: [],
    currentCategory: '全部',
    dishes: [],
    allDishes: [],
    searchText: '',
    loading: true
  },

  onLoad() {
    this.loadCategories()
    this.loadDishes()
  },

  onShow() {
    this.loadDishes()
    // 检查是否有从首页传递的搜索词
    const app = getApp()
    if (app.globalData.searchKeyword) {
      const keyword = app.globalData.searchKeyword
      app.globalData.searchKeyword = null
      this.setData({ searchText: keyword })
      this.onSearchInput({ detail: { value: keyword } })
    }
  },

  // 加载分类
  async loadCategories() {
    try {
      const data = await api.getCategories()
      const cats = ['全部', ...data.map(c => c.name)]
      this.setData({ categories: cats })
    } catch (err) {
      this.setData({
        categories: ['全部', '热门', '家常菜', '下饭菜', '素菜', '肉类', '汤羹', '主食', '甜品', '凉菜', '空气炸锅', '电饭锅', '高压锅']
      })
    }
  },

  // 加载菜品
  async loadDishes() {
    try {
      this.setData({ loading: true })
      const data = await api.getDishes({ category: this.data.currentCategory === '全部' ? '' : this.data.currentCategory })
      const dishes = (data.list || data).map(d => ({
        ...d,
        spicyText: util.getSpicyText(d.spicy_level || 0),
        spicyIcons: util.getSpicyIcons(d.spicy_level || 0),
        difficultyText: util.getDifficultyText(d.difficulty || 0)
      }))
      this.setData({ dishes, allDishes: dishes, loading: false })
    } catch (err) {
      console.log('加载菜品失败', err)
      this.setData({ loading: false })
    }
  },

  // 选择分类
  selectCategory(e) {
    const category = e.currentTarget.dataset.category
    this.setData({ currentCategory: category })
    this.loadDishes()
  },

  // 搜索
  onSearchInput(e) {
    const text = e.detail.value
    this.setData({ searchText: text })
    if (text) {
      const filtered = this.data.allDishes.filter(d =>
        d.name.includes(text) || (d.tags && d.tags.some(t => t.includes(text)))
      )
      this.setData({ dishes: filtered })
    } else {
      this.setData({ dishes: this.data.allDishes })
    }
  },

  setSearchText(text) {
    this.setData({ searchText: text })
    this.onSearchInput({ detail: { value: text } })
  },

  // 菜品详情
  goDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` })
  },

  // 添加菜品
  goAdd() {
    wx.navigateTo({ url: '/pages/add-recipe/add-recipe' })
  },

  // 下拉刷新
  onPullDownRefresh() {
    this.loadDishes().then(() => wx.stopPullDownRefresh())
  }
})
