// WXML ↔ JS event handler contract audit
// Scans main pages for event handlers in WXML and verifies they exist in JS.
const fs = require('fs')
const path = require('path')

const PAGES = ['index', 'menu', 'meal', 'fridge', 'shopping', 'mine']
const BASE = path.join(__dirname, '..', 'miniprogram', 'pages')
const EVENT_ATTRS = ['bindtap', 'catchtap', 'bindchange', 'bindinput', 'bindconfirm', 'bindsubmit', 'bindlongpress', 'catchlongpress']

function extractHandlers(wxmlContent) {
  const handlers = new Set()
  for (const attr of EVENT_ATTRS) {
    const re = new RegExp(attr + '="([^"]+)"', 'g')
    let m
    while ((m = re.exec(wxmlContent)) !== null) {
      const h = m[1].trim()
      if (h && !h.startsWith('{{')) handlers.add(h)
    }
  }
  return [...handlers]
}

function extractJsMethods(jsContent) {
  const methods = new Set()
  // Match methodName() { or methodName: function or methodName(e) {
  const re = /(\w+)\s*[:\(]\s*(?:e\s*)?[,\)]?\s*\{/g
  let m
  while ((m = re.exec(jsContent)) !== null) {
    methods.add(m[1])
  }
  // Also match async methodName() {
  const re2 = /async\s+(\w+)\s*\(/g
  while ((m = re2.exec(jsContent)) !== null) {
    methods.add(m[1])
  }
  return methods
}

let totalMissing = 0
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
  const handlers = extractHandlers(wxml)
  const methods = extractJsMethods(js)
  const missing = handlers.filter(h => !methods.has(h))
  results[page] = { handlers: handlers.length, missing }
  if (missing.length > 0) totalMissing += missing.length
}

console.log('=== WXML EVENT HANDLER CONTRACT AUDIT ===')
for (const [page, r] of Object.entries(results)) {
  console.log(`\n${page}: ${r.handlers} handlers, ${r.missing.length} missing`)
  if (r.missing.length > 0) {
    r.missing.forEach(h => console.log(`  MISSING: ${h}`))
  }
}
console.log(`\n=== TOTAL MISSING: ${totalMissing} ===`)
process.exit(totalMissing > 0 ? 1 : 0)
