const { createMinePage } = require('./mine-controller')

// Real V1 Auth/Family only. mine-fixture.js is intentionally not imported.
Page(createMinePage({ app: getApp(), wxAdapter: wx }))
