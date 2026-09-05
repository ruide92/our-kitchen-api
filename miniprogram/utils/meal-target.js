// Shared meal target context for menu -> meal -> continue adding flow.
// Persists non-sensitive state: v1_meal_target in wx storage.
const STORAGE_KEY = 'v1_meal_target'

function pad(n) { return n < 10 ? '0' + n : '' + n }

function formatDate(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

function addDays(d, n) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

// Reasonable default meal based on current local time.
// 05:00-10:00 -> today breakfast
// 10:00-14:00 -> today lunch
// 14:00-17:00 -> today dinner (early dinner planning)
// 17:00-23:00 -> today dinner
// 23:00-05:00 -> next day breakfast
function defaultMealType(now = new Date()) {
  const h = now.getHours()
  if (h >= 5 && h < 10) return { meal_type: 'BREAKFAST', dateOffset: 0 }
  if (h >= 10 && h < 14) return { meal_type: 'LUNCH', dateOffset: 0 }
  if (h >= 14 && h < 17) return { meal_type: 'DINNER', dateOffset: 0 }
  if (h >= 17 && h < 23) return { meal_type: 'DINNER', dateOffset: 0 }
  return { meal_type: 'BREAKFAST', dateOffset: 1 }
}

function mealTypeLabel(mealType) {
  const map = { BREAKFAST: '早餐', LUNCH: '午餐', DINNER: '晚餐' }
  return map[mealType] || mealType
}

function dateLabel(dateStr) {
  const today = formatDate(new Date())
  const tomorrow = formatDate(addDays(new Date(), 1))
  if (dateStr === today) return '今天'
  if (dateStr === tomorrow) return '明天'
  return dateStr
}

function createMealTarget({ wxAdapter }) {
  function get() {
    try {
      const stored = wxAdapter.getStorageSync(STORAGE_KEY)
      if (stored && stored.meal_date && stored.meal_type) return stored
    } catch (_) {}
    const def = defaultMealType()
    const target = {
      meal_date: formatDate(addDays(new Date(), def.dateOffset)),
      meal_type: def.meal_type,
      diners_count: 2
    }
    set(target)
    return target
  }

  function set(target) {
    try { wxAdapter.setStorageSync(STORAGE_KEY, target) } catch (_) {}
  }

  function update(patch) {
    const current = get()
    const next = Object.assign({}, current, patch)
    set(next)
    return next
  }

  function reset() {
    try { wxAdapter.removeStorageSync(STORAGE_KEY) } catch (_) {}
  }

  function label(target = get()) {
    return dateLabel(target.meal_date) + mealTypeLabel(target.meal_type)
  }

  function toastLabel(target = get()) {
    return '已加入' + dateLabel(target.meal_date) + mealTypeLabel(target.meal_type) + '菜单'
  }

  // Available meal options for picker
  function options() {
    const today = new Date()
    const opts = []
    for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
      const d = addDays(today, dayOffset)
      const dateStr = formatDate(d)
      for (const mt of ['BREAKFAST', 'LUNCH', 'DINNER']) {
        opts.push({
          meal_date: dateStr,
          meal_type: mt,
          label: dateLabel(dateStr) + mealTypeLabel(mt)
        })
      }
    }
    opts.push({ meal_date: null, meal_type: null, label: '自选日期...', isCustom: true })
    return opts
  }

  return { get, set, update, reset, label, toastLabel, options, defaultMealType, formatDate, mealTypeLabel, dateLabel }
}

module.exports = { createMealTarget, STORAGE_KEY, defaultMealType, formatDate, mealTypeLabel, dateLabel }
