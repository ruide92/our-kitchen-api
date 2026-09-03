const api = require('../../utils/api.js')
const util = require('../../utils/util.js')
Page({
  data: { krpText: '', skillText: '', showSkill: false },
  copySkill() {
    wx.setClipboardData({
      data: this.data.skillText || '你是一个专业的菜谱整理员，请按照KRP格式输出菜谱...',
      success: () => util.showSuccess('已复制AI指令')
    })
  },
  onInput(e) { this.setData({ krpText: e.detail.value }) },
  toggleSkill() { this.setData({ showSkill: !this.data.showSkill }) },
  async importRecipe() {
    if (!this.data.krpText) { util.showError('请粘贴KRP菜谱包'); return }
    try {
      wx.showLoading({ title: '解析中...' })
      await api.importRecipe({ krp: this.data.krpText })
      wx.hideLoading()
      util.showSuccess('导入成功')
      setTimeout(() => wx.navigateBack(), 1000)
    } catch (err) { wx.hideLoading(); util.showError('解析失败，请检查格式') }
  }
})
