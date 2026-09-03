// 工具函数
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

// 格式化时间
function formatTime(date) {
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hour = date.getHours()
  const minute = date.getMinutes()
  return `${year}-${month}-${day} ${hour}:${minute}`
}

// 获取今天是周几（0-6）
function getDayOfWeek() {
  const day = new Date().getDay()
  return day === 0 ? 6 : day - 1
}

// 获取问候语
function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 6) return '夜深了'
  if (hour < 9) return '早上好'
  if (hour < 12) return '上午好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  if (hour < 22) return '晚上好'
  return '夜深了'
}

// 辣度文字
function getSpicyText(level) {
  const texts = ['不辣', '微辣', '中辣', '重辣', '变态辣']
  return texts[Math.min(level, 4)] || '不辣'
}

// 辣度图标
function getSpicyIcons(level) {
  return '🌶'.repeat(Math.min(level, 5))
}

// 难度文字
function getDifficultyText(level) {
  const texts = ['简单', '普通', '中等', '较难', '困难']
  return texts[Math.min(level, 4)] || '简单'
}

// 健康度星星
function getHealthStars(score) {
  const full = Math.floor(score)
  const half = score - full >= 0.5
  let stars = '★'.repeat(full)
  if (half) stars += '☆'
  stars += '☆'.repeat(5 - full - (half ? 1 : 0))
  return stars
}

// 么么哒
function getKissText(count) {
  return '💋'.repeat(Math.min(count, 5))
}

// 防抖
function debounce(fn, delay) {
  let timer = null
  return function (...args) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn.apply(this, args), delay)
  }
}

// 显示加载
function showLoading(title = '加载中...') {
  wx.showLoading({ title, mask: true })
}

function hideLoading() {
  wx.hideLoading()
}

// 显示成功
function showSuccess(title) {
  wx.showToast({ title, icon: 'success' })
}

// 显示错误
function showError(title) {
  wx.showToast({ title, icon: 'none' })
}

// 确认对话框
function showConfirm(title, content) {
  return new Promise((resolve) => {
    wx.showModal({
      title,
      content,
      confirmColor: '#7CB342',
      success: (res) => resolve(res.confirm)
    })
  })
}

module.exports = {
  WEEKDAYS,
  formatTime,
  getDayOfWeek,
  getGreeting,
  getSpicyText,
  getSpicyIcons,
  getDifficultyText,
  getHealthStars,
  getKissText,
  debounce,
  showLoading,
  hideLoading,
  showSuccess,
  showError,
  showConfirm
}
