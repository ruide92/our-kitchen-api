const api = require('../../utils/api.js')
const util = require('../../utils/util.js')
const app = getApp()

Page({
  data: {
    dish: null,
    loading: true,
    currentTab: 'ingredients',
    isFavorite: false,
    myRating: 0,
    showRating: false
  },

  onLoad(options) {
    this.dishId = options.id
    this.loadDish()
    this.checkFavorite()
    this.checkRating()
  },

  // 加载菜品详情
  async loadDish() {
    try {
      const data = await api.getDish(this.dishId)
      const dish = {
        ...data,
        spicyText: util.getSpicyText(data.spicy_level || 0),
        spicyIcons: util.getSpicyIcons(data.spicy_level || 0),
        difficultyText: util.getDifficultyText(data.difficulty || 0),
        healthStars: util.getHealthStars(data.health_score || 3),
        kissText: util.getKissText(data.kiss_reward || 3)
      }
      this.setData({ dish, loading: false })
    } catch (err) {
      console.log('加载菜品失败', err)
      this.setData({ loading: false })
    }
  },

  // 检查是否收藏
  async checkFavorite() {
    try {
      const favorites = await api.getFavorites()
      const isFav = (favorites.list || favorites).some(f => f.dish_id == this.dishId)
      this.setData({ isFavorite: isFav })
    } catch (err) {}
  },

  // 检查评分
  async checkRating() {
    try {
      const ratings = await api.getRatings()
      const myRate = (ratings.list || ratings).find(r => r.dish_id == this.dishId)
      this.setData({ myRating: myRate ? myRate.score : 0 })
    } catch (err) {}
  },

  // 切换tab
  switchTab(e) {
    this.setData({ currentTab: e.currentTarget.dataset.tab })
  },

  // 收藏/取消收藏
  async toggleFavorite() {
    try {
      if (this.data.isFavorite) {
        await api.removeFavorite(this.dishId)
        util.showSuccess('已取消收藏')
      } else {
        await api.addFavorite({ dishId: this.dishId })
        util.showSuccess('已收藏')
      }
      this.setData({ isFavorite: !this.data.isFavorite })
    } catch (err) {}
  },

  // 我想吃
  async wantToEat() {
    try {
      await api.createOrder({ dishId: this.dishId })
      util.showSuccess('已加入我想吃')
    } catch (err) {}
  },

  // 加入今日菜单
  async addToToday() {
    try {
      await api.addToTodayMenu({ dishId: this.dishId })
      util.showSuccess('已加入今日菜单')
    } catch (err) {}
  },

  // 开始做饭
  startCooking() {
    wx.showModal({
      title: '开始做饭',
      content: `确定开始做「${this.data.dish.name}」吗？`,
      confirmColor: '#7CB342',
      success: (res) => {
        if (res.confirm) {
          api.startCooking({ dishId: this.dishId }).then(() => {
            util.showSuccess('开始做饭啦')
          }).catch(() => {})
        }
      }
    })
  },

  // 评分
  showRatingPanel() {
    this.setData({ showRating: true })
  },

  hideRatingPanel() {
    this.setData({ showRating: false })
  },

  async setRating(e) {
    const score = e.currentTarget.dataset.score
    try {
      // 如果点击的分数和当前分数相同，取消评分
      if (this.data.myRating === score) {
        await api.removeRating(this.dishId)
        this.setData({ myRating: 0, showRating: false })
        util.showSuccess('已取消评分')
        return
      }
      // 否则先删除旧评分再添加新评分
      if (this.data.myRating > 0) {
        await api.removeRating(this.dishId)
      }
      await api.addRating({ dishId: this.dishId, score })
      this.setData({ myRating: score, showRating: false })
      util.showSuccess('评分成功')
    } catch (err) {
      util.showError('评分失败')
    }
  },

  // 编辑菜品
  editDish() {
    wx.navigateTo({ url: `/pages/add-recipe/add-recipe?id=${this.dishId}` })
  },

  // 删除/隐藏菜品
  deleteDish() {
    wx.showModal({
      title: '提示',
      content: '确定要删除这道菜吗？',
      confirmColor: '#E91E63',
      success: (res) => {
        if (res.confirm) {
          api.deleteDish(this.dishId).then(() => {
            util.showSuccess('已删除')
            setTimeout(() => wx.navigateBack(), 1000)
          }).catch(() => {})
        }
      }
    })
  },

  // 分享
  onShareAppMessage() {
    return {
      title: `推荐一道菜：${this.data.dish ? this.data.dish.name : '我们的小厨房'}`,
      path: `/pages/detail/detail?id=${this.dishId}`
    }
  }
})
