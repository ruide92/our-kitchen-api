const api = require('../../utils/api.js')
const util = require('../../utils/util.js')
const app = getApp()

Page({
  data: {
    userInfo: null,
    kitchenInfo: null,
    hasKitchen: false,
    isLoggedIn: false,
    stats: { favorites: 0, ratings: 0, cooked: 0, kisses: 0 },
    menuItems: [
      { icon: '📋', name: '今日菜单', path: '/pages/today-menu/today-menu' },
      { icon: '❤️', name: '点赞菜谱', path: '/pages/ratings/ratings' },
      { icon: '📝', name: '点菜历史', path: '/pages/orders/orders' },
      { icon: '⭐', name: '我的收藏', path: '/pages/favorites/favorites' },
      { icon: '🧂', name: '调味品', path: '/pages/seasoning/seasoning' },
      { icon: '📖', name: '我的菜谱', path: '/pages/add-recipe/add-recipe' },
      { icon: '🤖', name: 'AI导入', path: '/pages/ai-import/ai-import' },
      { icon: '🗑️', name: '回收站', path: '/pages/recycle/recycle' },
      { icon: '👨‍👩‍👧', name: '家庭管理', path: '/pages/family/family' },
      { icon: '⚙️', name: '设置', path: '' }
    ],
    // 创建厨房弹窗
    showCreateModal: false,
    kitchenName: '',
    // 加入厨房弹窗
    showJoinModal: false,
    inviteCode: ''
  },

  onLoad() {
    this.loadData()
  },

  onShow() {
    this.loadData()
  },

  async loadData() {
    const token = app.globalData.token
    const userInfo = app.globalData.userInfo
    const kitchenInfo = app.globalData.kitchenInfo
    const hasKitchen = app.globalData.hasKitchen

    this.setData({
      isLoggedIn: !!token,
      userInfo: userInfo,
      kitchenInfo: kitchenInfo,
      hasKitchen: hasKitchen
    })

    if (token && hasKitchen) {
      try {
        const stats = await api.getStats()
        this.setData({ stats: stats || this.data.stats })
      } catch (err) {}
    }
  },

  // 微信授权获取头像
  onChooseAvatar(e) {
    const avatarUrl = e.detail.avatarUrl
    const userInfo = { ...this.data.userInfo, avatar: avatarUrl }
    this.setData({ userInfo })
    app.updateUserInfo(userInfo)
    // 上传头像到后端
    if (app.globalData.token) {
      app.updateWxUserInfo(avatarUrl, userInfo.nickname || '')
    }
  },

  // 微信授权获取昵称
  onNicknameInput(e) {
    const nickname = e.detail.value
    const userInfo = { ...this.data.userInfo, nickname }
    this.setData({ userInfo })
    app.updateUserInfo(userInfo)
  },

  // 完成登录（真正执行微信登录+更新用户信息）
  async completeLogin() {
    const { userInfo } = this.data
    if (!userInfo || !userInfo.avatar || !userInfo.nickname) {
      util.showError('请先设置头像和昵称')
      return
    }
    try {
      wx.showLoading({ title: '登录中...' })
      
      // 1. 执行微信登录获取code
      const loginRes = await new Promise((resolve, reject) => {
        wx.login({
          success: resolve,
          fail: reject
        })
      })
      
      if (!loginRes.code) {
        throw new Error('获取微信登录凭证失败')
      }
      
      // 2. 调用后端登录接口
      const loginData = await api.login({ 
        code: loginRes.code,
        nickname: userInfo.nickname,
        avatar: userInfo.avatar
      })
      
      if (!loginData || !loginData.token) {
        throw new Error('登录失败')
      }
      
      // 3. 保存token和用户信息
      app.globalData.token = loginData.token
      wx.setStorageSync('token', loginData.token)
      
      if (loginData.user) {
        app.globalData.userInfo = loginData.user
        wx.setStorageSync('userInfo', loginData.user)
        this.setData({ userInfo: loginData.user })
      }
      
      if (loginData.kitchen) {
        app.globalData.kitchenInfo = loginData.kitchen
        app.globalData.hasKitchen = true
        wx.setStorageSync('kitchenInfo', loginData.kitchen)
      }
      
      wx.hideLoading()
      util.showSuccess('登录成功')
      
      // 4. 刷新页面数据
      this.loadData()
      
      // 5. 延迟跳转到首页
      setTimeout(() => {
        wx.switchTab({ url: '/pages/index/index' })
      }, 1000)
      
    } catch (err) {
      wx.hideLoading()
      console.error('登录失败:', err)
      util.showError(err.message || '登录失败，请重试')
    }
  },

  // 显示创建厨房弹窗
  showCreateKitchen() {
    this.setData({ showCreateModal: true, kitchenName: '' })
  },

  // 创建厨房
  async createKitchen() {
    const { kitchenName } = this.data
    if (!kitchenName || kitchenName.trim().length < 2) {
      util.showError('厨房名称至少2个字')
      return
    }
    try {
      const kitchen = await app.createKitchen(kitchenName.trim())
      if (kitchen) {
        util.showSuccess('厨房创建成功')
        this.setData({ showCreateModal: false })
        this.loadData()
      } else {
        util.showError('创建失败，请重试')
      }
    } catch (err) {
      util.showError('创建失败，请重试')
    }
  },

  // 显示加入厨房弹窗
  showJoinKitchen() {
    this.setData({ showJoinModal: true, inviteCode: '' })
  },

  // 加入厨房
  async joinKitchen() {
    const { inviteCode } = this.data
    if (!inviteCode || inviteCode.trim().length < 4) {
      util.showError('请输入有效的邀请码')
      return
    }
    try {
      const kitchen = await app.joinKitchen(inviteCode.trim())
      if (kitchen) {
        util.showSuccess('加入成功')
        this.setData({ showJoinModal: false })
        this.loadData()
      }
    } catch (err) {}
  },

  // 关闭弹窗
  closeModal() {
    this.setData({ showCreateModal: false, showJoinModal: false })
  },

  // 厨房名称输入
  onKitchenNameInput(e) {
    this.setData({ kitchenName: e.detail.value })
  },

  // 邀请码输入
  onInviteCodeInput(e) {
    this.setData({ inviteCode: e.detail.value })
  },

  goPage(e) {
    const path = e.currentTarget.dataset.path
    if (!this.data.isLoggedIn) {
      util.showError('请先登录')
      return
    }
    if (!this.data.hasKitchen && path !== '/pages/family/family') {
      util.showError('请先创建或加入厨房')
      return
    }
    if (path) {
      wx.navigateTo({ url: path })
    } else {
      util.showError('功能开发中')
    }
  },

  editKitchen() {
    if (!this.data.hasKitchen) return
    wx.showModal({
      title: '修改厨房名称',
      editable: true,
      placeholderText: this.data.kitchenInfo?.name || '我们的小厨房',
      success: (res) => {
        if (res.confirm && res.content) {
          api.updateKitchen({ name: res.content }).then(() => {
            util.showSuccess('修改成功')
            app.updateKitchenInfo({ ...app.globalData.kitchenInfo, name: res.content })
            this.loadData()
          })
        }
      }
    })
  },

  editAvatar() {
    if (!this.data.isLoggedIn) {
      util.showError('请先登录')
      return
    }
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempFilePath = res.tempFilePaths[0]
        const userInfo = { ...this.data.userInfo, avatar: tempFilePath }
        this.setData({ userInfo })
        app.updateUserInfo(userInfo)
        util.showSuccess('头像已更新')
      }
    })
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          app.logout()
          util.showSuccess('已退出')
          setTimeout(() => {
            wx.reLaunch({ url: '/pages/index/index' })
          }, 1000)
        }
      }
    })
  }
})
