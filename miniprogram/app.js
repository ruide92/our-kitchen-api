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
    // V4 fixture 阶段：启动时不执行 legacy wx.login / api.login。
    // 不读取旧 storage，不写入旧 token/userInfo/kitchenInfo。
    // 真实 Auth 将在下一阶段统一接入 V1 backend。
    // legacy helper 方法暂时保留但不被启动路径调用。
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
