const api = require('./utils/api.js')

App({
  globalData: {
    userInfo: null,
    kitchenInfo: null,
    baseUrl: 'https://4kykmasf002ky.aiforce.cloud',
    token: '',
    hasKitchen: false
  },

  onLaunch() {
    // 读取本地存储
    const token = wx.getStorageSync('token')
    const userInfo = wx.getStorageSync('userInfo')
    const kitchenInfo = wx.getStorageSync('kitchenInfo')
    if (token) this.globalData.token = token
    if (userInfo) this.globalData.userInfo = userInfo
    if (kitchenInfo) {
      this.globalData.kitchenInfo = kitchenInfo
      this.globalData.hasKitchen = true
    }

    // 微信登录
    this.wxLogin()
  },

  wxLogin() {
    wx.login({
      success: (res) => {
        if (res.code) {
          api.login({ code: res.code }).then(data => {
            if (data && data.token) {
              this.globalData.token = data.token
              wx.setStorageSync('token', data.token)
              if (data.user) {
                this.globalData.userInfo = data.user
                wx.setStorageSync('userInfo', data.user)
              }
              if (data.kitchen) {
                this.globalData.kitchenInfo = data.kitchen
                this.globalData.hasKitchen = true
                wx.setStorageSync('kitchenInfo', data.kitchen)
              }
            }
          }).catch(err => {
            console.log('登录失败', err)
          })
        }
      }
    })
  },

  // 微信授权获取头像昵称后更新用户信息
  async updateWxUserInfo(avatar, nickname) {
    try {
      const user = await api.updateUserInfo({ avatar, nickname })
      if (user) {
        this.globalData.userInfo = user
        wx.setStorageSync('userInfo', user)
        return user
      }
    } catch (err) {
      console.log('更新用户信息失败', err)
    }
    return null
  },

  // 创建厨房
  async createKitchen(name) {
    try {
      const kitchen = await api.createKitchen({ name })
      if (kitchen) {
        this.globalData.kitchenInfo = kitchen
        this.globalData.hasKitchen = true
        wx.setStorageSync('kitchenInfo', kitchen)
        return kitchen
      }
    } catch (err) {
      console.log('创建厨房失败', err)
    }
    return null
  },

  // 加入厨房
  async joinKitchen(inviteCode) {
    try {
      const kitchen = await api.joinKitchen({ code: inviteCode })
      if (kitchen) {
        this.globalData.kitchenInfo = kitchen
        this.globalData.hasKitchen = true
        wx.setStorageSync('kitchenInfo', kitchen)
        return kitchen
      }
    } catch (err) {
      console.log('加入厨房失败', err)
      wx.showToast({ title: err.message || '邀请码无效', icon: 'none' })
    }
    return null
  },

  // 更新用户信息
  updateUserInfo(user) {
    this.globalData.userInfo = user
    wx.setStorageSync('userInfo', user)
  },

  // 更新厨房信息
  updateKitchenInfo(kitchen) {
    this.globalData.kitchenInfo = kitchen
    this.globalData.hasKitchen = !!kitchen
    wx.setStorageSync('kitchenInfo', kitchen)
  },

  // 退出登录
  logout() {
    wx.removeStorageSync('token')
    wx.removeStorageSync('userInfo')
    wx.removeStorageSync('kitchenInfo')
    this.globalData.token = ''
    this.globalData.userInfo = null
    this.globalData.kitchenInfo = null
    this.globalData.hasKitchen = false
  }
})
