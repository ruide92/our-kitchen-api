const test = require('node:test')
const assert = require('node:assert/strict')
const { toCode, toLabel, isValidCode, formatQuantity } = require('../../miniprogram/utils/unit-display')

test('toCode: Chinese labels map to canonical codes', () => {
  assert.equal(toCode('克'), 'g')
  assert.equal(toCode('千克'), 'kg')
  assert.equal(toCode('毫升'), 'ml')
  assert.equal(toCode('升'), 'l')
  assert.equal(toCode('个'), 'piece')
  assert.equal(toCode('根'), 'root')
  assert.equal(toCode('瓣'), 'clove')
  assert.equal(toCode('勺'), 'spoon')
  assert.equal(toCode('少许'), 'pinch')
  assert.equal(toCode('适量'), 'appropriate')
})

test('toCode: uppercase L maps to lowercase l', () => {
  assert.equal(toCode('L'), 'l')
  assert.equal(toCode('ML'), 'ml')
  assert.equal(toCode('KG'), 'kg')
})

test('toCode: custom units return null', () => {
  assert.equal(toCode('盒'), null)
  assert.equal(toCode('袋'), null)
  assert.equal(toCode('瓶'), null)
  assert.equal(toCode('箱'), null)
  assert.equal(toCode('提'), null)
})

test('toCode: valid codes pass through', () => {
  assert.equal(toCode('g'), 'g')
  assert.equal(toCode('kg'), 'kg')
  assert.equal(toCode('piece'), 'piece')
})

test('toLabel: codes map to Chinese labels', () => {
  assert.equal(toLabel('g'), '克')
  assert.equal(toLabel('kg'), '千克')
  assert.equal(toLabel('ml'), '毫升')
  assert.equal(toLabel('l'), '升')
  assert.equal(toLabel('piece'), '个')
})

test('isValidCode: database valid codes', () => {
  assert.equal(isValidCode('g'), true)
  assert.equal(isValidCode('kg'), true)
  assert.equal(isValidCode('piece'), true)
  assert.equal(isValidCode('L'), false)
  assert.equal(isValidCode('个'), false)
  assert.equal(isValidCode('盒'), false)
})

test('formatQuantity: numeric + code', () => {
  assert.equal(formatQuantity(500, 'g', null), '500克')
  assert.equal(formatQuantity(1, 'kg', null), '1千克')
  assert.equal(formatQuantity(2, 'piece', null), '2个')
})

test('formatQuantity: custom text takes priority', () => {
  assert.equal(formatQuantity(2, null, '2盒'), '2盒')
  assert.equal(formatQuantity(null, null, '适量'), '适量')
})
