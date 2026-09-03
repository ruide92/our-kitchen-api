const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../database');
const { authMiddleware, getUserFamily } = require('../middleware/auth');

function generateId() {
  return crypto.randomUUID();
}

// 获取冰箱食材
router.get('/', authMiddleware, (req, res) => {
  const family = getUserFamily(req.user.id);
  if (!family) {
    return res.json([]);
  }
  
  const items = db.prepare('SELECT * FROM fridge_items WHERE family_id = ? ORDER BY created_at DESC').all(family.family_id);
  
  // 统计
  const total = items.length;
  const expiring = items.filter(i => {
    if (!i.expire_date) return false;
    const diff = (new Date(i.expire_date) - new Date()) / (1000 * 60 * 60 * 24);
    return diff <= 3;
  }).length;
  
  res.json({
    list: items,
    stats: { total, expiring, canCook: 0 }
  });
});

// 添加食材
router.post('/', authMiddleware, (req, res) => {
  const family = getUserFamily(req.user.id);
  if (!family) {
    return res.status(400).json({ error: '请先创建或加入家庭' });
  }
  
  const { name, quantity, unit, category, storage_location, expire_date } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: '请输入食材名称' });
  }
  
  const id = generateId();
  db.prepare(`
    INSERT INTO fridge_items (id, family_id, name, quantity, unit, category, storage_location, expire_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, family.family_id, name, quantity || 0, unit || '', category || '冷藏', storage_location || '', expire_date || null);
  
  const item = db.prepare('SELECT * FROM fridge_items WHERE id = ?').get(id);
  res.json(item);
});

// 修改食材
router.patch('/:id', authMiddleware, (req, res) => {
  const family = getUserFamily(req.user.id);
  if (!family) {
    return res.status(400).json({ error: '请先创建或加入家庭' });
  }
  
  const { name, quantity, unit, category, storage_location, expire_date } = req.body;
  const item = db.prepare('SELECT * FROM fridge_items WHERE id = ? AND family_id = ?').get(req.params.id, family.family_id);
  
  if (!item) {
    return res.status(404).json({ error: '食材不存在' });
  }
  
  db.prepare(`
    UPDATE fridge_items SET 
      name = COALESCE(?, name),
      quantity = COALESCE(?, quantity),
      unit = COALESCE(?, unit),
      category = COALESCE(?, category),
      storage_location = COALESCE(?, storage_location),
      expire_date = COALESCE(?, expire_date)
    WHERE id = ?
  `).run(name || null, quantity !== undefined ? quantity : null, unit || null, category || null, storage_location || null, expire_date || null, req.params.id);
  
  const updated = db.prepare('SELECT * FROM fridge_items WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// 删除食材
router.delete('/:id', authMiddleware, (req, res) => {
  const family = getUserFamily(req.user.id);
  if (!family) {
    return res.status(400).json({ error: '请先创建或加入家庭' });
  }
  
  db.prepare('DELETE FROM fridge_items WHERE id = ? AND family_id = ?').run(req.params.id, family.family_id);
  res.json({ success: true });
});

module.exports = router;
