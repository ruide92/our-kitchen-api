const { createV1Session } = require('./utils/v1-session')

App({
  globalData: { v1Session: null },
  getV1Session() {
    if (!this.v1Session) {
      this.v1Session = createV1Session({ wxAdapter: wx })
      this.v1Session.subscribe(state => { this.globalData.v1Session = state })
    }
    return this.v1Session
  },
  onLaunch() {
    // Failure is observable as authFailed in Mine. Observe the lifecycle promise
    // to avoid an unhandled rejection; never use legacy auth or mock fallback.
    this.bootstrapV1Session().catch(() => {})
  },
  bootstrapV1Session() { return this.getV1Session().bootstrap() },
  ensureSessionReady() { return this.getV1Session().ensureReady() },
  retryV1Session() { return this.getV1Session().retry() }
})
