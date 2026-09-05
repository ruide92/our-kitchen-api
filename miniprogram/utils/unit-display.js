// Unit UI ↔ API canonical code mapping
// UI displays Chinese labels; API always sends canonical codes.
// Custom units (盒/袋/瓶/箱) use unit_code=null + quantity_text.

const LABEL_TO_CODE = {
  '克': 'g', 'g': 'g', 'G': 'g',
  '千克': 'kg', 'kg': 'kg', 'KG': 'kg', 'Kg': 'kg',
  '斤': 'jin', 'jin': 'jin',
  '毫升': 'ml', 'ml': 'ml', 'ML': 'ml', 'mL': 'ml',
  '升': 'l', 'l': 'l', 'L': 'l',
  '个': 'piece', 'piece': 'piece',
  '根': 'root', 'root': 'root',
  '瓣': 'clove', 'clove': 'clove',
  '勺': 'spoon', 'spoon': 'spoon',
  '少许': 'pinch', 'pinch': 'pinch',
  '适量': 'appropriate', 'appropriate': 'appropriate',
}

const CODE_TO_LABEL = {
  g: '克', kg: '千克', jin: '斤',
  ml: '毫升', l: '升',
  piece: '个', root: '根', clove: '瓣', spoon: '勺',
  pinch: '少许', appropriate: '适量',
}

// Canonical codes valid in database units table
const VALID_CODES = new Set(['g', 'kg', 'jin', 'ml', 'l', 'piece', 'root', 'clove', 'spoon', 'pinch', 'appropriate'])

function toCode(label) {
  if (!label) return null
  const code = LABEL_TO_CODE[label]
  if (code && VALID_CODES.has(code)) return code
  // If already a valid code, return as-is
  if (VALID_CODES.has(label)) return label
  return null // custom unit -> null
}

function toLabel(code) {
  if (!code) return ''
  return CODE_TO_LABEL[code] || code
}

function isValidCode(code) {
  return VALID_CODES.has(code)
}

// Format quantity + unit for display
function formatQuantity(quantity, unitCode, quantityText) {
  if (quantityText) return quantityText
  if (quantity == null) return ''
  const num = parseFloat(quantity)
  const clean = isNaN(num) ? String(quantity) : String(num)
  const label = toLabel(unitCode)
  return clean + (label || '')
}

// UI options for picker (Chinese labels)
const UI_UNIT_OPTIONS = ['克', '千克', '斤', '毫升', '升', '个', '根', '瓣', '勺', '少许', '适量', '自定义']

module.exports = { toCode, toLabel, isValidCode, formatQuantity, UI_UNIT_OPTIONS, VALID_CODES }
