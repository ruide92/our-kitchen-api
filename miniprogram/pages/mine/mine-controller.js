const config = require('../../config/v1')
const roleLabels = { OWNER: '家庭主人', ADMIN: '管理员', MEMBER: '家庭成员' }
const modeLabels = { BALANCED: '均衡推荐', USE_INVENTORY: '优先吃库存', TRY_DIFFERENT: '换换口味' }
const toolLabels = { WOK: '炒锅', RICE_COOKER: '电饭锅', AIR_FRYER: '空气炸锅', PRESSURE_COOKER: '高压锅' }
const avatar = value => typeof value === 'string' && /^https:\/\//.test(value) ? value : ''
function createMinePage({ app, wxAdapter }) {
  const toast = message => wxAdapter.showToast({ title: message, icon: 'none' })
  return {
    data: {
      status: 'loading', authenticated: false, hasFamily: false, user: null, displayName: '', avatarUrl: '',
      family: null, active_family_id: null, families: [], members: [], settings: null, settingsRows: [],
      familyStatus: 'idle', errorMessage: '', pageError: '', environmentBlocked: false,
      sheet: '', fieldText: '', busy: false,
      menuGroups: [
        { title: '家庭与厨房', items: [
          { icon: '👨‍👩‍👧', name: '家庭管理', action: 'openFamilySheet' },
          { icon: '🍳', name: '厨房设置', action: 'openKitchenSettingsSheet' },
          { icon: '🧂', name: '调味品 / 常备品', action: 'placeholderToast', badge: '待接入' },
          { icon: '💋', name: '么么哒', action: 'placeholderToast', badge: '待接入' }
        ] },
        { title: '我的吃饭记录', items: [
          { icon: '📋', name: '本餐菜单 / 历史', action: 'placeholderToast', badge: '待接入' },
          { icon: '⭐', name: '我的收藏', action: 'placeholderToast', badge: '待接入' },
          { icon: '❤️', name: '我的评分', action: 'placeholderToast', badge: '待接入' },
          { icon: '📖', name: '我的菜谱', action: 'placeholderToast', badge: '待接入' }
        ] },
        { title: '创作与分享', items: [
          { icon: '🤖', name: 'AI 导入菜谱', action: 'placeholderToast', badge: '规划中' },
          { icon: '🌐', name: '分享广场', action: 'placeholderToast', badge: '规划中' },
          { icon: '📤', name: '我的分享', action: 'placeholderToast', badge: '规划中' },
          { icon: '🗑️', name: '回收站', action: 'placeholderToast', badge: '待接入' }
        ] },
        { title: '其他', items: [{ icon: '⚙️', name: '设置', action: 'openSettingsSheet' }, { icon: 'ℹ️', name: '关于我们', action: 'placeholderToast' }] }
      ]
    },
    onLoad() {
      this._session = app.getV1Session()
      this._unsubscribe = this._session.subscribe(state => this.applySession(state))
    },
    onShow() {
      if (typeof this.getTabBar === 'function') { const bar = this.getTabBar(); if (bar) bar.setData({ selected: 4, hidden: false }) }
      return this.refreshPage()
    },
    onHide() { this._setTabBarHidden(false) },
    onUnload() { this._setTabBarHidden(false); if (this._unsubscribe) this._unsubscribe(); this._unloaded = true },
    _setTabBarHidden(hidden) {
      if (typeof this.getTabBar === 'function') { const bar = this.getTabBar(); if (bar) bar.setData({ hidden }) }
    },
    _openSheet(name) { this.setData({ sheet: name }); this._setTabBarHidden(true) },
    _closeSheet() { this.setData({ sheet: '' }); this._setTabBarHidden(false) },
    applySession(state) {
      const changed = this.data.active_family_id !== state.active_family_id
      const authenticated = state.status === 'authenticated'
      const members = state.members.map(member => ({ ...member,
        nickname: member.user && member.user.nickname || '微信用户',
        avatar_url: avatar(member.user && member.user.avatar_url), role_label: roleLabels[member.role] || '—'
      }))
      const settings = state.settings
      const rows = settings ? [
        ['默认用餐人数', settings.default_diners], ['早餐默认菜数', settings.breakfast_target_count],
        ['午餐默认菜数', settings.lunch_target_count], ['晚餐默认菜数', settings.dinner_target_count],
        ['常用厨具', (settings.cookware || []).map(code => toolLabels[code] || code).join('、') || '尚未设置'],
        ['推荐偏好', modeLabels[settings.random_default_mode] || settings.random_default_mode],
        ['强避重复（天）', settings.repeat_strong_days], ['重复惩罚（天）', settings.repeat_penalty_days],
        ['恢复周期（天）', settings.repeat_recover_days]
      ].map(([label,value]) => ({ label, value: value === undefined || value === null ? '—' : value })) : []
      const shouldClearSheet = !authenticated || changed
      this.setData({ status: state.status, authenticated, user: state.user,
        displayName: state.user && state.user.nickname || (authenticated ? '微信用户' : ''),
        avatarUrl: avatar(state.user && state.user.avatar_url), family: state.activeFamily,
        roleLabel: roleLabels[state.activeFamily && state.activeFamily.role] || '—',
        families: state.families.map(f => ({ ...f, role_label: roleLabels[f.role] || '—' })),
        active_family_id: state.active_family_id, hasFamily: state.hasFamily, members, settings, settingsRows: rows,
        familyStatus: state.familyStatus,
        errorMessage: state.error && state.error.message || state.familyError && state.familyError.message || '',
        environmentBlocked: state.status === 'authFailed' && /^http:\/\/127\.0\.0\.1/.test(config.baseUrl),
        sheet: shouldClearSheet ? '' : this.data.sheet
      })
      if (shouldClearSheet) this._setTabBarHidden(false)
    },
    refreshPage() {
      if (this._refreshPromise) return this._refreshPromise
      this.setData({ pageError: '' })
      this._refreshPromise = app.ensureSessionReady().then(() => this._session.refresh()).catch(error => {
        if (!this._unloaded) this.setData({ pageError: error.message || '加载失败，请重试' })
      }).finally(() => { this._refreshPromise = null })
      return this._refreshPromise
    },
    async retryLogin() {
      if (this.data.busy) return
      this.setData({ busy: true, pageError: '' })
      try { await app.retryV1Session() } catch (error) { this.setData({ pageError: error.message || '登录暂时失败' }) }
      finally { this.setData({ busy: false }) }
    },
    accountReady() { if (this.data.authenticated) return true; toast('请先完成登录'); return false },
    familyReady() {
      if (this.accountReady() && this.data.familyStatus === 'ready' && this.data.family) return true
      toast('请先选择并加载家庭'); return false
    },
    openProfileSheet() { if (this.accountReady()) { this.setData({ fieldText: this.data.user.nickname || '' }); this._openSheet('profile') } },
    openCreateSheet() { if (this.accountReady()) { this.setData({ fieldText: '我们的小厨房' }); this._openSheet('create') } },
    openJoinSheet() { if (this.accountReady()) { this.setData({ fieldText: '' }); this._openSheet('join') } },
    openSelectSheet() { if (this.accountReady()) this._openSheet('select') },
    openFamilySheet() { if (this.familyReady()) this._openSheet('family') },
    openInviteSheet() { if (this.familyReady()) this._openSheet('invite') },
    openKitchenSettingsSheet() { if (this.familyReady()) this._openSheet('kitchen') },
    openSettingsSheet() { this._openSheet('settings') },
    closeSheet() { if (!this.data.busy) this._closeSheet() },
    onFieldInput(e) { this.setData({ fieldText: e.detail.value }) },
    async submitFamily() {
      if (this.data.busy || !this.accountReady()) return
      const mode = this.data.sheet, value = this.data.fieldText.trim()
      if (!['create','join'].includes(mode)) return
      if (!value) { toast(mode === 'create' ? '请输入家庭名称' : '请输入邀请码'); return }
      this.setData({ busy: true, pageError: '' })
      try {
        await this._session[mode === 'create' ? 'createFamily' : 'joinFamily'](value)
        this._closeSheet(); toast(mode === 'create' ? '家庭已创建' : '已加入家庭')
      } catch (error) {
        if (error.mutationSucceeded) this._closeSheet()
        toast(error.mutationSucceeded ? '家庭操作已成功，请刷新加载数据' : error.code === 'INVALID_INVITE' ? '邀请码无效' : error.message || '操作失败')
      } finally { this.setData({ busy: false }) }
    },
    async selectFamily(e) {
      if (this.data.busy) return
      this.setData({ busy: true, pageError: '' })
      this._closeSheet()
      try { await this._session.selectFamily(e.currentTarget.dataset.id) }
      catch (error) { this.setData({ pageError: error.message || '家庭加载失败' }) }
      finally { this.setData({ busy: false }) }
    },
    async saveProfile() {
      if (this.data.busy || !this.accountReady()) return
      const nickname = this.data.fieldText.trim()
      if (!nickname) { toast('昵称不能为空'); return }
      this.setData({ busy: true })
      try { await this._session.updateNickname(nickname); this._closeSheet(); toast('昵称已保存') }
      catch (error) {
        if (error.mutationSucceeded) this._closeSheet()
        toast(error.mutationSucceeded ? '昵称已保存，成员信息请刷新' : error.message || '保存失败')
      } finally { this.setData({ busy: false }) }
    },
    copyInviteCode() {
      const code = this.data.family && this.data.family.invite_code
      if (this.data.familyStatus !== 'ready' || !code) { toast('暂无邀请码，请刷新家庭数据'); return }
      wxAdapter.setClipboardData({ data: code, success: () => toast('邀请码已复制'), fail: () => toast('复制失败，请重试') })
    },
    placeholderToast() { toast('此功能待接入真实数据') },
    onMenuTap(e) {
      const action = e.currentTarget.dataset.action
      if (['openFamilySheet','openKitchenSettingsSheet','openSettingsSheet','placeholderToast'].includes(action)) this[action]()
    },
    noop() {}
  }
}
module.exports = { createMinePage }
