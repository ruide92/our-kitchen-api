/**
 * Static audit: verify every this._api.X() call in pages has a matching method in createV1Api.
 * Also verify hideTabBar/showTabBar and other shared symbols are imported when used.
 */
const fs = require('fs')
const path = require('path')

const MINIPROGRAM = path.join(__dirname, '..', 'miniprogram')
const PAGES = ['index', 'menu', 'meal', 'fridge', 'shopping', 'mine']

// Read v1-api.js to get all exported methods
const apiSource = fs.readFileSync(path.join(MINIPROGRAM, 'utils', 'v1-api.js'), 'utf8')
const apiMethods = new Set()
const methodRegex = /(\w+):\s*(?:async\s*)?(?:\([^)]*\)|[\w]+)\s*=>/g
let m
while ((m = methodRegex.exec(apiSource)) !== null) {
  apiMethods.add(m[1])
}
// Also check return object keys
const returnRegex = /return\s*\{([^}]+)\}/s
const returnMatch = apiSource.match(returnRegex)
if (returnMatch) {
  const keyRegex = /(\w+):/g
  while ((m = keyRegex.exec(returnMatch[1])) !== null) {
    apiMethods.add(m[1])
  }
}

let failures = 0
const missingApi = []
const missingSymbols = []

for (const page of PAGES) {
  const jsPath = path.join(MINIPROGRAM, 'pages', page, page + '.js')
  if (!fs.existsSync(jsPath)) continue
  const src = fs.readFileSync(jsPath, 'utf8')

  // Check this._api.X() calls
  const apiCallRegex = /this\._api\.(\w+)\s*\(/g
  while ((m = apiCallRegex.exec(src)) !== null) {
    const method = m[1]
    if (!apiMethods.has(method)) {
      missingApi.push(`${page}: this._api.${method}() not in v1-api.js`)
    }
  }

  // Check hideTabBar/showTabBar usage requires import
  const usesHideTabBar = /hideTabBar\s*\(/.test(src)
  const usesShowTabBar = /showTabBar\s*\(/.test(src)
  const hasTabbarImport = /require\(.*tabbar-overlay/.test(src)
  if ((usesHideTabBar || usesShowTabBar) && !hasTabbarImport) {
    missingSymbols.push(`${page}: uses hideTabBar/showTabBar but missing tabbar-overlay import`)
  }

  // Check createMealTarget usage requires import
  const usesMealTarget = /createMealTarget\s*\(/.test(src)
  const hasMealTargetImport = /require\(.*meal-target/.test(src)
  if (usesMealTarget && !hasMealTargetImport) {
    missingSymbols.push(`${page}: uses createMealTarget but missing meal-target import`)
  }

  // Check createV1Api usage requires import
  const usesV1Api = /createV1Api\s*\(/.test(src)
  const hasV1ApiImport = /require\(.*v1-api/.test(src)
  if (usesV1Api && !hasV1ApiImport) {
    missingSymbols.push(`${page}: uses createV1Api but missing v1-api import`)
  }
}

if (missingApi.length > 0) {
  console.log('=== MISSING API METHODS ===')
  missingApi.forEach(x => console.log('  ' + x))
  failures += missingApi.length
}
if (missingSymbols.length > 0) {
  console.log('=== MISSING SYMBOL IMPORTS ===')
  missingSymbols.forEach(x => console.log('  ' + x))
  failures += missingSymbols.length
}

if (failures === 0) {
  console.log('STATIC API AUDIT: PASS (0 missing API methods, 0 missing symbol imports)')
  console.log('API methods found:', [...apiMethods].sort().join(', '))
  process.exit(0)
} else {
  console.log(`STATIC API AUDIT: FAIL (${failures} issues)`)
  process.exit(1)
}
