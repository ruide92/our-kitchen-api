Component({
  data: {
    selected: 0,
    hidden: false,
    locked: false,
    list: [
      { pagePath: '/pages/index/index', text: '首页' },
      { pagePath: '/pages/menu/menu', text: '菜单' },
      { pagePath: '/pages/fridge/fridge', text: '冰箱' },
      { pagePath: '/pages/shopping/shopping', text: '购物清单' },
      { pagePath: '/pages/mine/mine', text: '我的' },
    ],
  },
  methods: {
    switchTab(e) {
      if (this.data.locked) return
      const path = e.currentTarget.dataset.path
      wx.switchTab({ url: path })
    },
    lockTabBar() { if (!this.data.locked) this.setData({ locked: true }) },
    unlockTabBar() { if (this.data.locked) this.setData({ locked: false }) },
  },
})
