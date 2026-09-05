// WXML ↔ JS event handler contract audit + fixture import audit
const fs = require('fs')
const path = require('path')

const PAGES = ['index', 'menu', 'meal', 'fridge', 'shopping', 'mine']
const REAL_MODE_PAGES = ['index', 'menu', 'fridge', 'shopping']
const BASE = path.join(__dirname, '..', 'miniprogram', 'pages')
const EVENT_ATTRS = ['bindtap', 'catchtap', 'bindchange', 'bindinput', 'bindconfirm', 'bindsubmit', 'bindlongpress', 'catchlongpress']

function extractHandlers(wxmlContent) {
  const handlers = new Set()
  const dynamic = []
  for (const attr of EVENT_ATTRS) {
    const re = new RegExp(attr + '="([^"]+)"', 'g')
    let m
    while ((m = re.exec(wxmlContent)) !== null) {
      const h = m[1].trim()
      if (h.startsWith('{{')) {
        dynamic.push({ attr, value: h })
      } else if (h) {
        handlers.add(h)
      }
    }
  }
  return { handlers: [...handlers], dynamic }
}

function extractJsMethods(jsContent) {
  const methods = new Set()
  const re = /(\w+)\s*[:\(]\s*(?:e\s*)?[,\)]?\s*\{/g
  let m
  while ((m = re.exec(jsContent)) !== null) {
    methods.add(m[1])
  }
  const re2 = /async\s+(\w+)\s*\(/g
  while ((m = re2.exec(jsContent)) !== null) {
    methods.add(m[1])
  }
  return methods
}

let totalMissing = 0
let totalDynamic = 0
let totalFixtureImports = 0
const results = {}

for (const page of PAGES) {
  const wxmlPath = path.join(BASE, page, page + '.wxml')
  const jsPath = path.join(BASE, page, page + '.js')
  const controllerPath = path.join(BASE, page, page + '-controller.js')
  if (!fs.existsSync(wxmlPath) || !fs.existsSync(jsPath)) continue

  const wxml = fs.readFileSync(wxmlPath, 'utf8')
  let js = fs.readFileSync(jsPath, 'utf8')
  if (fs.existsSync(controllerPath)) {
    js += '\n' + fs.readFileSync(controllerPath, 'utf8')
  }
  const { handlers, dynamic } = extractHandlers(wxml)
  const methods = extractJsMethods(js)
  const missing = handlers.filter(h => !methods.has(h))

  // Fixture import check for real-mode pages
  let fixtureImports = []
  if (REAL_MODE_PAGES.includes(page)) {
    const fixtureRe = /require\(['"][^'"]*fixture[^'"]*['"]\)/g
    let fm
    while ((fm = fixtureRe.exec(js)) !== null) {
      fixtureImports.push(fm[0])
    }
  }

  results[page] = { handlers: handlers.length, missing, dynamic, fixtureImports }
  totalMissing += missing.length
  totalDynamic += dynamic.length
  totalFixtureImports += fixtureImports.length
}

console.log('=== WXML EVENT HANDLER CONTRACT AUDIT ===')
for (const [page, r] of Object.entries(results)) {
  console.log(`\n${page}: ${r.handlers} handlers, ${r.missing.length} missing, ${r.dynamic.length} dynamic, ${r.fixtureImports.length} fixture imports`)
  if (r.missing.length > 0) r.missing.forEach(h => console.log(`  MISSING: ${h}`))
  if (r.dynamic.length > 0) r.dynamic.forEach(d => console.log(`  DYNAMIC: ${d.attr}="${d.value}"`))
  if (r.fixtureImports.length > 0) r.fixtureImports.forEach(f => console.log(`  FIXTURE IMPORT: ${f}`))
}
console.log(`\n=== TOTAL MISSING: ${totalMissing} ===`)
console.log(`=== TOTAL DYNAMIC HANDLERS: ${totalDynamic} ===`)
console.log(`=== TOTAL FIXTURE IMPORTS: ${totalFixtureImports} ===`)
process.exit((totalMissing > 0 || totalDynamic > 0 || totalFixtureImports > 0) ? 1 : 0)
