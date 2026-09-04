const { createV1Api, v1Error, SESSION_KEYS } = require('./v1-api')
function createV1Session({ wxAdapter, baseUrl, timeoutMs }) {
  const empty = () => ({ status: 'loading', user: null, families: [], active_family_id: null, activeFamily: null, hasFamily: false, members: [], settings: null, familyStatus: 'idle', error: null, familyError: null })
  let state = empty(), ready = null, pending = false, epoch = 0, familyEpoch = 0
  const listeners = new Set()
  const snapshot = () => JSON.parse(JSON.stringify(state))
  const publish = values => { state = { ...state, ...values }; listeners.forEach(listener => listener(snapshot())) }
  const current = run => { if (epoch !== run) throw v1Error('SESSION_CHANGED', '会话已变化，请重试') }
  const errorView = error => ({ code: error.code || 'SESSION_ERROR', message: error.message || '加载失败，请重试' })
  function invalidate() {
    epoch++; familyEpoch++
    SESSION_KEYS.forEach(key => wxAdapter.removeStorageSync(key))
    publish({ ...empty(), status: 'authFailed', error: { code: 'AUTH_REQUIRED', message: '登录已过期，请重新登录' } })
  }
  const api = createV1Api({ wxAdapter, baseUrl, timeoutMs, onUnauthorized: invalidate })
  function choose(families, saved) {
    if (families.length === 1) return families[0].id
    return families.some(family => family.id === saved) ? saved : null
  }
  function setSelection(id) {
    familyEpoch++
    if (id) wxAdapter.setStorageSync('v1_active_family_id', id)
    else wxAdapter.removeStorageSync('v1_active_family_id')
    publish({ active_family_id: id, activeFamily: null, hasFamily: Boolean(id), members: [], settings: null, familyStatus: id ? 'loading' : 'idle', familyError: null })
  }
  async function loadFamily() {
    const id = state.active_family_id, run = epoch, selection = ++familyEpoch
    if (!id) return snapshot()
    publish({ activeFamily: null, members: [], settings: null, familyStatus: 'loading', familyError: null })
    try {
      const [family, members, settings] = await Promise.all([api.getFamily(id), api.getMembers(id), api.getSettings(id)])
      current(run)
      if (selection !== familyEpoch) return snapshot()
      if (!family || family.id !== id || !Array.isArray(members) || !settings || settings.family_id !== id) throw v1Error('INVALID_RESPONSE', '家庭数据格式异常')
      publish({ activeFamily: family, members, settings, familyStatus: 'ready' })
      return snapshot()
    } catch (error) {
      if (run === epoch && selection === familyEpoch) publish({ familyStatus: 'error', familyError: errorView(error) })
      throw error
    }
  }
  function bootstrap(force = false) {
    if (pending || (ready && !force)) return ready
    const run = ++epoch, saved = wxAdapter.getStorageSync('v1_active_family_id')
    familyEpoch++; pending = true
    wxAdapter.removeStorageSync('v1_token'); wxAdapter.removeStorageSync('v1_user')
    publish(empty())
    const login = new Promise((resolve, reject) => wxAdapter.login({ timeout: 10000,
      success: result => typeof result.code === 'string' && result.code ? resolve(result.code) : reject(v1Error('WX_LOGIN_FAILED', '微信登录暂时失败')),
      fail: () => reject(v1Error('WX_LOGIN_FAILED', '微信登录暂时失败'))
    }))
    ready = login.then(code => { current(run); return api.login(code) }).then(async result => {
      current(run)
      if (!result || typeof result.token !== 'string' || !result.token || !result.user || !result.user.id || !Array.isArray(result.families)) throw v1Error('INVALID_RESPONSE', '登录响应格式异常')
      wxAdapter.setStorageSync('v1_token', result.token); wxAdapter.setStorageSync('v1_user', result.user)
      publish({ status: 'authenticated', user: result.user, families: result.families, error: null })
      setSelection(choose(result.families, saved))
      // Family load errors remain visible separately; do not trigger a login loop.
      try { await loadFamily() } catch (error) { current(run); if (state.status !== 'authenticated') throw error }
      return snapshot()
    }).catch(error => {
      if (run === epoch) {
        SESSION_KEYS.forEach(key => wxAdapter.removeStorageSync(key))
        publish({ ...empty(), status: 'authFailed', error: errorView(error) })
      }
      throw error
    }).finally(() => { pending = false })
    return ready
  }
  function ensureReady() {
    if (!pending && state.status === 'authFailed') return ready && state.error.code !== 'AUTH_REQUIRED' ? ready : Promise.reject(v1Error('AUTH_REQUIRED', '请重新登录', 401))
    return bootstrap()
  }
  async function requireAuthenticated() {
    await ensureReady()
    if (state.status !== 'authenticated') throw v1Error('AUTH_REQUIRED', '请重新登录', 401)
  }
  async function selectFamily(id) {
    await requireAuthenticated()
    if (!state.families.some(family => family.id === id)) throw v1Error('FAMILY_UNAVAILABLE', '请选择当前账号已加入的家庭')
    setSelection(id); return loadFamily()
  }
  async function refresh() {
    await requireAuthenticated()
    const run = epoch
    const [user, families] = await Promise.all([api.getMe(), api.getMyFamilies()])
    current(run)
    if (!user || !user.id || !Array.isArray(families)) throw v1Error('INVALID_RESPONSE', '用户数据格式异常')
    wxAdapter.setStorageSync('v1_user', user)
    const id = choose(families, state.active_family_id)
    publish({ user, families }); setSelection(id); return loadFamily()
  }
  async function mutateFamily(action, value) {
    await requireAuthenticated()
    const run = epoch, family = await action(value.trim())
    current(run)
    if (!family || !family.id) throw v1Error('INVALID_RESPONSE', '家庭响应格式异常')
    publish({ families: [...state.families.filter(item => item.id !== family.id), { id: family.id, name: family.name, role: family.role }] })
    setSelection(family.id)
    try {
      const families = await api.getMyFamilies(); current(run)
      if (!Array.isArray(families)) throw v1Error('INVALID_RESPONSE', '家庭列表格式异常')
      publish({ families }); await loadFamily(); return snapshot()
    } catch (error) {
      if (run === epoch) publish({ familyStatus: 'error', familyError: errorView(error) })
      error.mutationSucceeded = true; throw error
    }
  }
  async function updateNickname(nickname) {
    await requireAuthenticated()
    const run = epoch, user = await api.updateNickname(nickname.trim())
    current(run)
    if (!user || !user.id) throw v1Error('INVALID_RESPONSE', '用户数据格式异常')
    wxAdapter.setStorageSync('v1_user', user); publish({ user })
    try { await loadFamily() } catch (error) { error.mutationSucceeded = true; throw error }
    return snapshot()
  }
  return { getState: snapshot, bootstrap, ensureReady, retry: () => bootstrap(true), refresh, selectFamily,
    createFamily: name => mutateFamily(api.createFamily, name), joinFamily: code => mutateFamily(api.joinFamily, code), updateNickname,
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener) }
  }
}
module.exports = { createV1Session }
