const test = require('node:test')
const assert = require('node:assert/strict')
const { defaultMealType, formatDate, mealTypeLabel, dateLabel } = require('../../miniprogram/utils/meal-target')

test('defaultMealType: morning -> breakfast', () => {
  const r = defaultMealType(new Date(2026, 8, 5, 8, 0))
  assert.equal(r.meal_type, 'BREAKFAST')
  assert.equal(r.dateOffset, 0)
})

test('defaultMealType: noon -> lunch', () => {
  const r = defaultMealType(new Date(2026, 8, 5, 12, 0))
  assert.equal(r.meal_type, 'LUNCH')
})

test('defaultMealType: evening -> dinner', () => {
  const r = defaultMealType(new Date(2026, 8, 5, 19, 0))
  assert.equal(r.meal_type, 'DINNER')
})

test('defaultMealType: late night -> next day breakfast', () => {
  const r = defaultMealType(new Date(2026, 8, 5, 2, 0))
  assert.equal(r.meal_type, 'BREAKFAST')
  assert.equal(r.dateOffset, 1)
})

test('formatDate: YYYY-MM-DD', () => {
  assert.equal(formatDate(new Date(2026, 0, 5)), '2026-01-05')
  assert.equal(formatDate(new Date(2026, 8, 15)), '2026-09-15')
})

test('mealTypeLabel: Chinese labels', () => {
  assert.equal(mealTypeLabel('BREAKFAST'), '早餐')
  assert.equal(mealTypeLabel('LUNCH'), '午餐')
  assert.equal(mealTypeLabel('DINNER'), '晚餐')
})
