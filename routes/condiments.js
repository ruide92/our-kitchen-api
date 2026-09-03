const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../database');
const { authMiddleware, getUserFamily } = require('../middleware/auth');

function generateId() {
  return crypto.randomUUID();
}

// 预置调味品列表
const PRESET_CONDIMENTS = [
  '盐', '白糖', '生抽', '老抽', '醋', '料酒', '蚝油', '豆瓣酱',
  '辣椒酱', '花椒', '八角', '桂皮', '香叶', '孜然', '胡椒粉',
  '鸡精', '味精', '香油', '花生油', '玉米油', '橄榄油', '淀粉',
  '面粉', '大米', '小米', '红豆', '绿豆', '枸杞', '红枣',
  '干辣椒', '花椒粉', '五香粉', '咖喱粉', '番茄酱', '沙拉酱',
  '芝麻酱', '豆腐乳', '豆豉', '泡椒', '酸豆角'
];

// 获取调味品列表
router.get('/', authMiddleware, (req, res) => {
  const family = getUserFamily(req.user.id);
  if (!family) {
    return res.json([]);
  }
  
  const items = db.prepare('SELECT * FROM condiments WHERE family_id = ? ORDER BY created_at DESC').all(family.family_id);
  res.json(items);
});

// 获取预置调味品
router.get('/presets', (req, res) => {
  res.json(PRESET_CONDIMENTS);
});

// 添加调味品
router.post('/', authMiddleware, (req, res) => {
  const family = getUserFamily(req.user.id);
  if (!family) {
    return res.status(400).json({ error: '请先创建或加入家庭' });
  }
  
  const { name, category, quantity, unit, note } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: '请输入调味品名称' });
  }
  
  const id = generateId();
  db.prepare(`
    INSERT INTO condiments (id, family_id, name, category, quantity, unit, note)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, family.family_id, name, category || '基础调料', quantity || 1, unit || '瓶', note || '');
  
  const item = db.prepare('SELECT * FROM condiments WHERE id = ?').get(id);
  res.json(item);
});

// 批量添加预置调味品
router.post('/batch-add', authMiddleware, (req, res) => {
  const family = getUserFamily(req.user.id);
  if (!family) {
    return res.status(400).json({ error: '请先创建或加入家庭' });
  }
  
  const { names } = req.body;
  if (!names || !Array.isArray(names)) {
    return res.status(400).json({ error: '请选择调味品' });
  }
  
  let added = 0;
  names.forEach(name => {
    // 检查是否已存在
    const existing = db.prepare('SELECT * FROM condiments WHERE family_id = ? AND name = ?').get(family.family_id, name);
    if (!existing) {
      db.prepare(`
        INSERT INTO condiments (id, family_id, name, category, quantity, unit)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(generateId(), family.family_id, name, '基础调料', 1, '瓶');
      added++;
    }
  });
  
  res.json({ success: true, added });
});

// 修改调味品
router.patch('/:id', authMiddleware, (req, res) => {
  const family = getUserFamily(req.user.id);
  if (!family) {
    return res.status(400).json({ error: '请先创建或加入家庭' });
  }
  
  const { name, category, quantity, unit, status, note } = req.body;
  db.prepare(`
    UPDATE condiments SET 
      name = COALESCE(?, name),
      category = COALESCE(?, category),
      quantity = COALESCE(?, quantity),
      unit = COALESCE(?, unit),
      status = COALESCE(?, status),
      note = COALESCE(?, note)
    WHERE id = ? AND family_id = ?
  `).run(name || null, category || null, quantity !== undefined ? quantity : null, unit || null, status || null, note || null, req.params.id, family.family_id);
  
  const updated = db.prepare('SELECT * FROM condiments WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// 删除调味品
router.delete('/:id', authMiddleware, (req, res) => {
  const family = getUserFamily(req.user.id);
  if (!family) {
    return res.status(400).json({ error: '请先创建或加入家庭' });
  }
  
  db.prepare('DELETE FROM condiments WHERE id = ? AND family_id = ?').run(req.params.id, family.family_id);
  res.json({ success: true });
});

module.exports = router;
