const config = require('../../config/v1')
const { createV1Api } = require('../../utils/v1-api')
const roleLabels = { OWNER: '家庭主人', ADMIN: '管理员', MEMBER: '家庭成员' }
const modeLabels = { BALANCED: '均衡推荐', USE_INVENTORY: '优先吃库存', TRY_DIFFERENT: '换换口味' }
const toolLabels = { WOK: '炒锅', RICE_COOKER: '电饭锅', AIR_FRYER: '空气炸锅', PRESSURE_COOKER: '高压锅' }
const ALLERGEN_OPTIONS = [
  { code: 'SOY', label: '大豆' }, { code: 'PEANUT', label: '花生' }, { code: 'TREE_NUT', label: '坚果' },
  { code: 'MILK', label: '牛奶' }, { code: 'EGG', label: '鸡蛋' }, { code: 'WHEAT', label: '小麦' },
  { code: 'FISH', label: '鱼类' }, { code: 'SHELLFISH', label: '贝类' }, { code: 'SESAME', label: '芝麻' },
  { code: 'PORK', label: '猪肉' }, { code: 'BEEF', label: '牛肉' }, { code: 'CHICKEN', label: '鸡肉' }
]
const DIET_TAG_OPTIONS = [
  { code: 'VEGETARIAN', label: '素食' }, { code: 'VEGAN', label: '纯素' }, { code: 'HALAL', label: '清真' },
  { code: 'LOW_CARB', label: '低碳水' }, { code: 'HIGH_PROTEIN', label: '高蛋白' },
  { code: 'GLUTEN_FREE', label: '无麸质' }, { code: 'DAIRY_FREE', label: '无乳制品' }
]
const SPICINESS_LABELS = ['不辣', '微辣', '中辣', '较辣', '很辣', '爆辣']
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
          { icon: '🧂', name: '调味品 / 常备品', action: 'goPantry' },
          { icon: '💋', name: '么么哒', action: 'placeholderToast', badge: '待接入' }
        ] },
        { title: '我的吃饭记录', items: [
          { icon: '📋', name: '本餐菜单 / 历史', action: 'goHistory' },
          { icon: '⭐', name: '我的收藏', action: 'goFavorites' },
          { icon: '❤️', name: '我的评分', action: 'goRatings' },
          { icon: '🥢', name: '个人偏好', action: 'openPreferenceSheet' },
          { icon: '📖', name: '我的菜谱', action: 'placeholderToast', badge: '待接入' }
        ] },
        { title: '创作与分享', items: [
          { icon: '🤖', name: 'AI 导入菜谱', action: 'placeholderToast', badge: '规划中' },
          { icon: '🌐', name: '分享广场', action: '', disabled: true, badge: '规划中' },
          { icon: '📤', name: '我的分享', action: '', disabled: true, badge: '规划中' },
          { icon: '🗑️', name: '回收站', action: 'placeholderToast', badge: '待接入' }
        ] },
        { title: '其他', items: [{ icon: '⚙️', name: '设置', action: 'openSettingsSheet' }, { icon: 'ℹ️', name: '关于我们', action: 'placeholderToast' }] }
      ],
      kitchenForm: null,
      canEditKitchenSettings: false,
      preferenceForm: null,
      preferenceStatus: 'idle',
      allergenOptions: ALLERGEN_OPTIONS,
      dietTagOptions: DIET_TAG_OPTIONS,
      spicinessLabels: SPICINESS_LABELS
    },
    onLoad() {
      this._session = app.getV1Session()
      this._unsubscribe = this._session.subscribe(state => this.applySession(state))
      this._api = createV1Api({ wxAdapter })
    },
    onShow() {
      if (typeof this.getTabBar === 'function') { const bar = this.getTabBar(); if (bar) bar.setData({ selected: 4, hidden: false }) }
      return this.refreshPage()
    },
    onHide() { this._unlockTabBar(); this.setData({ sheet: '', kitchenForm: null }) },
    onUnload() { this._unlockTabBar(); this.setData({ sheet: '', kitchenForm: null }); if (this._unsubscribe) this._unsubscribe(); this._unloaded = true },
    _getTabBar() { if (typeof this.getTabBar === 'function') { const bar = this.getTabBar(); return bar || null } return null },
    _lockTabBar() { const bar = this._getTabBar(); if (bar && bar.lockTabBar) bar.lockTabBar() },
    _unlockTabBar() { const bar = this._getTabBar(); if (bar && bar.unlockTabBar) bar.unlockTabBar() },
    _openSheet(name) { this.setData({ sheet: name }); this._lockTabBar() },
    _closeSheet() { this.setData({ sheet: '' }); this._unlockTabBar() },
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
        canEditKitchenSettings: state.activeFamily && (state.activeFamily.role === 'OWNER' || state.activeFamily.role === 'ADMIN'),
        errorMessage: state.error && state.error.message || state.familyError && state.familyError.message || '',
        environmentBlocked: state.status === 'authFailed' && /^http:\/\/127\.0\.0\.1/.test(config.baseUrl),
        sheet: shouldClearSheet ? '' : this.data.sheet
      })
      if (shouldClearSheet) this._unlockTabBar()
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
    goPantry() {
      if (!this.familyReady()) return
      wxAdapter.setStorageSync('v1_fridge_target_tab', 'pantry')
      wxAdapter.switchTab({ url: '/pages/fridge/fridge' })
    },
    goHistory() {
      if (!this.familyReady()) return
      wxAdapter.navigateTo({ url: '/pages/history/history' })
    },
    goFavorites() {
      if (!this.familyReady()) return
      wxAdapter.navigateTo({ url: '/pages/favorites/favorites' })
    },
    goRatings() {
      if (!this.familyReady()) return
      wxAdapter.navigateTo({ url: '/pages/ratings/ratings' })
    },
    openKitchenSettingsSheet() {
      if (!this.familyReady()) return
      const s = this.data.settings
      if (!s) { toast('设置未加载，请刷新'); return }
      this.setData({ kitchenForm: this._rebuildKitchenFormFromSettings(s) })
      this._openSheet('kitchen')
    },
    onKitchenNumber(e) {
      const field = e.currentTarget.dataset.field
      const val = parseInt(e.detail.value, 10)
      if (isNaN(val) || val < 0) return
      this.setData({ [`kitchenForm.${field}`]: val })
    },
    onKitchenMode(e) {
      if (!this.data.canEditKitchenSettings) return
      this.setData({ 'kitchenForm.random_default_mode': e.currentTarget.dataset.value })
    },
    onKitchenCookware(e) {
      if (!this.data.canEditKitchenSettings) return
      const code = e.currentTarget.dataset.code
      const current = this.data.kitchenForm.cookware || []
      const next = current.includes(code) ? current.filter(c => c !== code) : [...current, code]
      this.setData({ 'kitchenForm.cookware': next })
    },
    onKitchenSpiciness(e) {
      if (!this.data.canEditKitchenSettings) return
      const val = e.currentTarget.dataset.value
      const num = val === null || val === '' || val === undefined ? null : Number(val)
      this.setData({ 'kitchenForm.default_spiciness': num })
    },
    onKitchenToggle(e) {
      const field = e.currentTarget.dataset.field
      this.setData({ [`kitchenForm.${field}`]: !!e.detail.value })
    },
    _validateKitchenForm(form) {
      if (!form) return '设置未加载'
      if (!Number.isInteger(form.default_diners) || form.default_diners < 1) return '默认用餐人数必须大于等于 1'
      if (!Number.isInteger(form.breakfast_target_count) || form.breakfast_target_count < 1) return '早餐默认菜数必须大于等于 1'
      if (!Number.isInteger(form.lunch_target_count) || form.lunch_target_count < 1) return '午餐默认菜数必须大于等于 1'
      if (!Number.isInteger(form.dinner_target_count) || form.dinner_target_count < 1) return '晚餐默认菜数必须大于等于 1'
      if (form.default_spiciness !== null && (!Number.isInteger(form.default_spiciness) || form.default_spiciness < 0 || form.default_spiciness > 5)) return '默认辣度必须是 0-5 或不设置'
      if (!Number.isInteger(form.repeat_strong_days) || form.repeat_strong_days < 0) return '强避重复天数必须大于等于 0'
      if (!Number.isInteger(form.repeat_penalty_days) || form.repeat_penalty_days < form.repeat_strong_days) return '重复惩罚天数必须大于等于强避重复天数'
      if (!Number.isInteger(form.repeat_recover_days) || form.repeat_recover_days < form.repeat_penalty_days) return '恢复周期必须大于等于重复惩罚天数'
      return null
    },
    _rebuildKitchenFormFromSettings(s) {
      if (!s) return null
      return {
        default_diners: s.default_diners != null ? s.default_diners : 2,
        breakfast_target_count: s.breakfast_target_count != null ? s.breakfast_target_count : 2,
        lunch_target_count: s.lunch_target_count != null ? s.lunch_target_count : 2,
        dinner_target_count: s.dinner_target_count != null ? s.dinner_target_count : 3,
        default_spiciness: s.default_spiciness == null ? null : Number(s.default_spiciness),
        cookware: Array.isArray(s.cookware) ? [...s.cookware] : [],
        random_default_mode: s.random_default_mode || 'BALANCED',
        prefer_expiring_inventory: s.prefer_expiring_inventory !== false,
        repeat_strong_days: s.repeat_strong_days != null ? s.repeat_strong_days : 3,
        repeat_penalty_days: s.repeat_penalty_days != null ? s.repeat_penalty_days : 7,
        repeat_recover_days: s.repeat_recover_days != null ? s.repeat_recover_days : 14,
      }
    },
    async saveKitchenSettings() {
      if (this.data.busy || !this.data.canEditKitchenSettings) return
      const validationError = this._validateKitchenForm(this.data.kitchenForm)
      if (validationError) { toast(validationError); return }
      this.setData({ busy: true })
      try {
        await this._session.updateSettings({ ...this.data.kitchenForm })
        this._closeSheet()
        toast('厨房设置已保存')
      } catch (error) {
        if (error.code === 'VERSION_CONFLICT' || error.status === 409) {
          try {
            await this._session.refresh()
            const fresh = this._session.getState().settings
            const rebuilt = this._rebuildKitchenFormFromSettings(fresh)
            this.setData({ kitchenForm: rebuilt })
            toast('厨房设置已被家人修改，已刷新为最新设置，请重新确认')
          } catch (_) {
            toast('厨房设置已被家人修改，请刷新后再试')
          }
        } else if (error.status === 403) {
          toast('只有家庭主人或管理员可以修改设置')
        } else {
          toast(error.message || '保存失败，请重试')
        }
      } finally { this.setData({ busy: false }) }
    },
    onMenuTap(e) {
      const action = e.currentTarget.dataset.action
      if (!action) return
      if (['openFamilySheet','openKitchenSettingsSheet','openSettingsSheet','placeholderToast','goPantry','goHistory','goFavorites','goRatings','openPreferenceSheet'].includes(action)) this[action]()
    },
    async openPreferenceSheet() {
      if (!this.familyReady() || this.data.busy) return
      this.setData({ busy: true, preferenceStatus: 'loading', preferenceError: '' })
      try {
        const prefs = await this._api.getPreferences(this.data.active_family_id)
        this.setData({
          preferenceForm: {
            spiciness_preference: prefs.spiciness_preference != null ? prefs.spiciness_preference : null,
            allergens: Array.isArray(prefs.allergens) ? [...prefs.allergens] : [],
            disliked_ingredients: Array.isArray(prefs.disliked_ingredients) ? prefs.disliked_ingredients.map(i => ({ ingredient_id: i.ingredient_id, name: i.name })) : [],
            diet_tags: Array.isArray(prefs.diet_tags) ? [...prefs.diet_tags] : [],
            ingredientSearch: '',
            ingredientResults: []
          },
          preferenceStatus: 'ready'
        })
        this._openSheet('preference')
      } catch (error) {
        this.setData({ preferenceStatus: 'error', preferenceError: error.message || '加载偏好失败' })
        toast(error.message || '加载偏好失败')
      } finally {
        this.setData({ busy: false })
      }
    },
    onPreferenceSpiciness(e) {
      if (this.data.busy) return
      const val = e.currentTarget.dataset.value
      const num = val === null || val === '' || val === undefined ? null : Number(val)
      this.setData({ 'preferenceForm.spiciness_preference': num })
    },
    onPreferenceAllergen(e) {
      if (this.data.busy) return
      const code = e.currentTarget.dataset.code
      const current = this.data.preferenceForm.allergens || []
      const next = current.includes(code) ? current.filter(c => c !== code) : [...current, code]
      this.setData({ 'preferenceForm.allergens': next })
    },
    onPreferenceDietTag(e) {
      if (this.data.busy) return
      const code = e.currentTarget.dataset.code
      const current = this.data.preferenceForm.diet_tags || []
      const next = current.includes(code) ? current.filter(c => c !== code) : [...current, code]
      this.setData({ 'preferenceForm.diet_tags': next })
    },
    onPreferenceIngredientSearch(e) {
      const keyword = (e.detail.value || '').trim()
      this.setData({ 'preferenceForm.ingredientSearch': keyword })
      if (keyword.length < 1) { this.setData({ 'preferenceForm.ingredientResults': [] }); return }
      this._api.searchIngredients(keyword).then(results => {
        const list = Array.isArray(results) ? results : (results && Array.isArray(results.data) ? results.data : [])
        this.setData({ 'preferenceForm.ingredientResults': list.slice(0, 20) })
      }).catch(() => { this.setData({ 'preferenceForm.ingredientResults': [] }) })
    },
    onPreferenceIngredientToggle(e) {
      if (this.data.busy) return
      const ing = e.currentTarget.dataset.ingredient
      if (!ing || !ing.id) return
      const current = this.data.preferenceForm.disliked_ingredients || []
      const exists = current.some(i => i.ingredient_id === ing.id)
      const next = exists
        ? current.filter(i => i.ingredient_id !== ing.id)
        : [...current, { ingredient_id: ing.id, name: ing.display_name || ing.name || ing.id }]
      this.setData({ 'preferenceForm.disliked_ingredients': next, 'preferenceForm.ingredientSearch': '', 'preferenceForm.ingredientResults': [] })
    },
    onPreferenceRemoveDisliked(e) {
      if (this.data.busy) return
      const id = e.currentTarget.dataset.id
      const current = this.data.preferenceForm.disliked_ingredients || []
      this.setData({ 'preferenceForm.disliked_ingredients': current.filter(i => i.ingredient_id !== id) })
    },
    async savePreferences() {
      if (this.data.busy || !this.data.preferenceForm) return
      const form = this.data.preferenceForm
      const payload = {
        spiciness_preference: form.spiciness_preference,
        allergens: form.allergens || [],
        disliked_ingredient_ids: (form.disliked_ingredients || []).map(i => i.ingredient_id),
        diet_tags: form.diet_tags || []
      }
      this.setData({ busy: true })
      try {
        await this._api.updatePreferences(this.data.active_family_id, payload)
        this._closeSheet()
        toast('个人偏好已保存')
      } catch (error) {
        toast(error.message || '保存失败，请重试')
      } finally {
        this.setData({ busy: false })
      }
    },
    noop() {},
  }
}
module.exports = { createMinePage }
