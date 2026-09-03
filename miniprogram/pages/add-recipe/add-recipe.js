const api = require('../../utils/api.js')
const util = require('../../utils/util.js')
Page({
  data: {
    isEdit: false,
    form: {
      name: '', description: '', category: '家常菜', cook_time: 20,
      difficulty: 1, spicy_level: 2, health_score: 3, kiss_reward: 3,
      servings: 2, equipment: '炒锅', ingredients: '', steps: '', tips: ''
    }
  },
  onLoad(options) {
    if (options.id) {
      this.setData({ isEdit: true })
      api.getDish(options.id).then(data => {
        this.setData({ form: { ...this.data.form, ...data } })
      })
    }
  },
  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: e.detail.value })
  },
  async save() {
    if (!this.data.form.name) { util.showError('请输入菜名'); return }
    try {
      wx.showLoading({ title: '保存中...' })
      if (this.data.isEdit) {
        await api.updateDish(this.data.form.id, this.data.form)
      } else {
        await api.addDish(this.data.form)
      }
      wx.hideLoading()
      util.showSuccess('保存成功')
      setTimeout(() => wx.navigateBack(), 1000)
    } catch (err) { wx.hideLoading() }
  }
})
