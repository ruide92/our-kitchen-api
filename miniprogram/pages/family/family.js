const api = require('../../utils/api.js')
const util = require('../../utils/util.js')
const app = getApp()

Page({
  data: {
    kitchen: null,
    members: [],
    inviteCode: '',
    hasKitchen: false,
    isLoggedIn: false,
    showCreateModal: false,
    kitchenName: '',
    showJoinModal: false,
    joinCode: ''
  },

  onLoad() {
    this.loadData()
  },

  onShow() {
    this.loadData()
  },

  async loadData() {
    const token = app.globalData.token
    const kitchen = app.globalData.kitchenInfo
    const hasKitchen = app.globalData.hasKitchen

    this.setData({
      isLoggedIn: !!token,
      kitchen: kitchen,
      hasKitchen: hasKitchen
    })

    if (token && hasKitchen) {
      try {
        const members = await api.getMembers()
        this.setData({ members: members.list || members })
      } catch (err) {}
    }
  },

  // 生成邀请码
  async generateInvite() {
    try {
      const data = await api.inviteMember({})
      const code = data.code || data.invite_code
      this.setData({ inviteCode: code })
      wx.showModal({
        title: '邀请码已生成',
        content: `邀请码：${code}\n\n分享给家人，让他们在"我的"页面点击"加入家人厨房"，输入此邀请码即可加入。`,
        showCancel: false,
        confirmText: '复制邀请码',
        success: (res) => {
          if (res.confirm) {
            wx.setClipboardData({ data: code, success: () => util.showSuccess('已复制') })
          }
        }
      })
    } catch (err) {
      util.showError('生成失败，请重试')
    }
  },

  copyInvite() {
    if (this.data.inviteCode) {
      wx.setClipboardData({ data: this.data.inviteCode, success: () => util.showSuccess('已复制') })
    }
  },

  // 分享邀请
  shareInvite() {
    if (this.data.inviteCode) {
      wx.showShareMenu({ withShareTicket: true })
      util.showSuccess('点击右上角分享给家人')
    } else {
      util.showError('请先生成邀请码')
    }
  },

  editKitchenName() {
    if (!this.data.hasKitchen) return
    wx.showModal({
      title: '修改厨房名称',
      editable: true,
      placeholderText: this.data.kitchen?.name || '我们的小厨房',
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
    this.setData({ showJoinModal: true, joinCode: '' })
  },

  // 加入厨房
  async joinKitchen() {
    const { joinCode } = this.data
    if (!joinCode || joinCode.trim().length < 4) {
      util.showError('请输入有效的邀请码')
      return
    }
    try {
      const kitchen = await app.joinKitchen(joinCode.trim())
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

  onKitchenNameInput(e) {
    this.setData({ kitchenName: e.detail.value })
  },

  onJoinCodeInput(e) {
    this.setData({ joinCode: e.detail.value })
  },

  // 退出家庭
  leaveKitchen() {
    wx.showModal({
      title: '退出家庭',
      content: '确定要退出这个家庭厨房吗？退出后将无法查看家庭数据。',
      confirmColor: '#E91E63',
      success: (res) => {
        if (res.confirm) {
          // 调用退出接口
          util.showSuccess('已退出')
          app.updateKitchenInfo(null)
          this.loadData()
        }
      }
    })
  }
})
