const api = require('../../utils/api.js')
const util = require('../../utils/util.js')
const app = getApp()

Page({
  data: {
    userInfo: null,
    kitchenInfo: null,
    greeting: '',
    searchText: '',
    weeklyMenu: null,
    currentDay: 0,
    weekdays: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
    loading: true
  },

  onLoad() {
    this.setData({
      greeting: util.getGreeting(),
      currentDay: util.getDayOfWeek(),
      userInfo: app.globalData.userInfo,
      kitchenInfo: app.globalData.kitchenInfo
    })
    this.loadWeeklyMenu()
  },

  onShow() {
    this.setData({
      userInfo: app.globalData.userInfo,
      kitchenInfo: app.globalData.kitchenInfo,
      greeting: util.getGreeting()
    })
  },

  // 加载每周食谱
  async loadWeeklyMenu() {
    try {
      const data = await api.getWeeklyMenu()
      this.setData({ weeklyMenu: data, loading: false })
    } catch (err) {
      console.log('加载每周食谱失败', err)
      this.setData({ loading: false })
    }
  },

  // 重新生成每周食谱
  async regenerateWeeklyMenu() {
    try {
      wx.showLoading({ title: '生成中...' })
      const data = await api.regenerateWeeklyMenu()
      this.setData({ weeklyMenu: data })
      wx.hideLoading()
      util.showSuccess('已重新生成')
    } catch (err) {
      wx.hideLoading()
    }
  },

  // 选择某天
  selectDay(e) {
    const day = e.currentTarget.dataset.day
    this.setData({ currentDay: day })
  },

  // 搜索
  onSearchInput(e) {
    this.setData({ searchText: e.detail.value })
  },

  onSearch() {
    if (this.data.searchText) {
      // 用全局变量传递搜索词
      app.globalData.searchKeyword = this.data.searchText
      wx.switchTab({ url: '/pages/menu/menu' })
    }
  },

  // 快捷功能
  goRandom() {
    wx.navigateTo({ url: '/pages/random/random' })
  },

  goFridge() {
    wx.switchTab({ url: '/pages/fridge/fridge' })
  },

  goFavorites() {
    wx.navigateTo({ url: '/pages/favorites/favorites' })
  },

  goOnePerson() {
    wx.navigateTo({ url: '/pages/random/random?mode=one' })
  },

  // 菜品详情
  goDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` })
  },

  // 加入今日菜单
  async addToToday(e) {
    e.stopPropagation()
    const dishId = e.currentTarget.dataset.id
    try {
      await api.addToTodayMenu({ dishId })
      util.showSuccess('已加入今日菜单')
    } catch (err) {
      console.log('加入失败', err)
    }
  },

  // 下拉刷新
  onPullDownRefresh() {
    this.loadWeeklyMenu().then(() => {
      wx.stopPullDownRefresh()
    })
  }
})
