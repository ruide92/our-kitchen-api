/**
 * 我的 Tab — V4 fixture UI
 *
 * 本页面完全使用 mine-fixture.js 本地演示数据，不接 legacy API。
 * 默认状态：已登录、已加入家庭、角色 OWNER。
 * 所有未迁移入口点击后只显示 toast / preview sheet，不跳 legacy 页面。
 * 个人资料修改仅 runtime fixture，不上传、不写后端。
 *
 * 注意：不在 onShow 做网络刷新。
 */

const FIXTURE = require('./mine-fixture.js')

Page({
  data: {
    // 登录与家庭状态
    authenticated: true,
    hasFamily: true,
    user: null,
    family: null,
    members: [],
    stats: null,
    kitchenSettings: null,
    settingsPreview: null,

    // bottom sheet
    showProfileSheet: false,
    showFamilySheet: false,
    showInviteSheet: false,
    showKitchenSettingsSheet: false,
    showSettingsSheet: false,

    // 个人资料编辑
    editNickname: '',

    // 功能菜单分组
    menuGroups: [
      {
        title: '家庭与厨房',
        items: [
          { icon: '👨‍👩‍👧', name: '家庭管理', action: 'openFamilySheet' },
          { icon: '🍳', name: '厨房设置', action: 'openKitchenSettingsSheet' },
          { icon: '🧂', name: '调味品 / 常备品', action: 'placeholderToast' },
          { icon: '💋', name: '么么哒', action: 'placeholderToast' },
        ],
      },
      {
        title: '我的吃饭记录',
        items: [
          { icon: '📋', name: '本餐菜单 / 历史', action: 'placeholderToast' },
          { icon: '⭐', name: '我的收藏', action: 'placeholderToast' },
          { icon: '❤️', name: '我的评分', action: 'placeholderToast' },
          { icon: '📖', name: '我的菜谱', action: 'placeholderToast' },
        ],
      },
      {
        title: '创作与分享',
        items: [
          { icon: '🤖', name: 'AI 导入菜谱', badge: '规划中', action: 'aiImportToast' },
          { icon: '🌐', name: '分享广场', badge: '规划中', action: 'placeholderToast' },
          { icon: '📤', name: '我的分享', badge: '规划中', action: 'placeholderToast' },
          { icon: '🗑️', name: '回收站', action: 'recycleToast' },
        ],
      },
      {
        title: '其他',
        items: [
          { icon: '⚙️', name: '设置', action: 'openSettingsSheet' },
          { icon: 'ℹ️', name: '关于我们', action: 'placeholderToast' },
        ],
      },
    ],
  },

  onLoad() {
    this.initFromFixture()
  },

  onShow() {
    try { if (this.getTabBar()) this.getTabBar().setData({ selected: 4 }) } catch(e) {}
  },

  // 注意：不实现 onShow 网络刷新。

  initFromFixture() {
    this.setData({
      authenticated: FIXTURE.authenticated,
      hasFamily: FIXTURE.has_family,
      user: JSON.parse(JSON.stringify(FIXTURE.user)),
      family: JSON.parse(JSON.stringify(FIXTURE.family)),
      members: JSON.parse(JSON.stringify(FIXTURE.members)),
      stats: JSON.parse(JSON.stringify(FIXTURE.stats)),
      kitchenSettings: JSON.parse(JSON.stringify(FIXTURE.kitchen_settings_preview)),
      settingsPreview: JSON.parse(JSON.stringify(FIXTURE.settings_preview)),
    })
  },

  // ===== 个人资料 =====
  openProfileSheet() {
    this.setData({
      showProfileSheet: true,
      editNickname: this.data.user.nickname,
    })
  },

  closeProfileSheet() {
    this.setData({ showProfileSheet: false })
  },

  onNicknameInput(e) {
    this.setData({ editNickname: e.detail.value })
  },

  saveProfile() {
    const nickname = this.data.editNickname.trim()
    if (!nickname) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' })
      return
    }
    // 仅 runtime fixture 修改，不写后端
    this.setData({
      'user.nickname': nickname,
      showProfileSheet: false,
    })
    wx.showToast({ title: '已保存（fixture 运行态）', icon: 'none' })
  },

  // ===== 家庭管理 =====
  openFamilySheet() {
    this.setData({ showFamilySheet: true })
  },

  closeFamilySheet() {
    this.setData({ showFamilySheet: false })
  },

  // ===== 邀请家人 =====
  openInviteSheet() {
    this.setData({ showInviteSheet: true })
  },

  closeInviteSheet() {
    this.setData({ showInviteSheet: false })
  },

  copyInviteCode() {
    wx.setClipboardData({
      data: this.data.family.invite_code,
      success: () => {
        wx.showToast({ title: '邀请码已复制', icon: 'success' })
      },
    })
  },

  // ===== 厨房设置 preview =====
  openKitchenSettingsSheet() {
    this.setData({ showKitchenSettingsSheet: true })
  },

  closeKitchenSettingsSheet() {
    this.setData({ showKitchenSettingsSheet: false })
  },

  // ===== 设置 preview =====
  openSettingsSheet() {
    this.setData({ showSettingsSheet: true })
  },

  closeSettingsSheet() {
    this.setData({ showSettingsSheet: false })
  },

  // ===== 通用 placeholder =====
  placeholderToast() {
    wx.showToast({
      title: '真实数据接入后启用',
      icon: 'none',
      duration: 2000,
    })
  },

  aiImportToast() {
    wx.showToast({
      title: '将在 KRP v2 接入后启用',
      icon: 'none',
      duration: 2000,
    })
  },

  recycleToast() {
    wx.showToast({
      title: '家庭菜谱真实数据接入后启用',
      icon: 'none',
      duration: 2000,
    })
  },

  // 菜单点击分发
  onMenuTap(e) {
    const action = e.currentTarget.dataset.action
    if (this[action]) {
      this[action]()
    }
  },

  // 阻止 sheet 内容区点击冒泡
  noop() {},
})
