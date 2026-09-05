Component({
  data: {
    selected: 0,
    hidden: false,
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
      const path = e.currentTarget.dataset.path
      wx.switchTab({ url: path })
    },
  },
})
