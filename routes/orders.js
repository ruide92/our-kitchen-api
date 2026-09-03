const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../database');
const { authMiddleware, getUserFamily } = require('../middleware/auth');

function generateId() {
  return crypto.randomUUID();
}

// 手动关联菜品和用户信息
function enrichOrders(orders) {
  return orders.map(o => {
    const dish = db.prepare('SELECT * FROM dishes WHERE id = ?').get(o.dish_id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(o.user_id);
    return {
      ...o,
      name: dish ? dish.name : '',
      image_url: dish ? dish.image_url : '',
      category: dish ? dish.category : '',
      user_nickname: user ? user.nickname : '',
      user_avatar: user ? user.avatar : ''
    };
  });
}

// 获取点餐列表
router.get('/', authMiddleware, (req, res) => {
  const family = getUserFamily(req.user.id);
  if (!family) {
    return res.json([]);
  }
  
  const { date, status } = req.query;
  
  let sql = 'SELECT * FROM order_items WHERE family_id = ?';
  const params = [family.family_id];
  
  if (date) {
    sql += ' AND meal_date = ?';
    params.push(date);
  }
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  
  sql += ' ORDER BY created_at DESC';
  
  const orders = db.prepare(sql).all(...params);
  res.json(enrichOrders(orders));
});

// 创建点餐
router.post('/', authMiddleware, (req, res) => {
  const family = getUserFamily(req.user.id);
  if (!family) {
    return res.status(400).json({ error: '请先创建或加入家庭' });
  }
  
  const { dishId, mealDate, mealType, note } = req.body;
  
  if (!dishId) {
    return res.status(400).json({ error: '请选择菜品' });
  }
  
  const id = generateId();
  const today = new Date().toISOString().split('T')[0];
  
  db.prepare(`
    INSERT INTO order_items (id, family_id, dish_id, user_id, meal_date, meal_type, note, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, family.family_id, dishId, req.user.id, mealDate || today, mealType || 'dinner', note || '', 'wanted');
  
  const order = db.prepare('SELECT * FROM order_items WHERE id = ?').get(id);
  const enriched = enrichOrders([order])[0];
  res.json(enriched);
});

// 历史订单
router.get('/history', authMiddleware, (req, res) => {
  const family = getUserFamily(req.user.id);
  if (!family) {
    return res.json([]);
  }
  
  const { days = 30, keyword, status } = req.query;
  
  let sql = 'SELECT * FROM order_items WHERE family_id = ?';
  const params = [family.family_id];
  
  if (keyword) {
    // 先获取所有订单，再按菜品名过滤
    const allOrders = db.prepare(sql).all(...params);
    const enriched = enrichOrders(allOrders);
    const filtered = enriched.filter(o => o.name && o.name.includes(keyword));
    if (status) {
      return res.json(filtered.filter(o => o.status === status));
    }
    return res.json(filtered);
  }
  
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  
  sql += ' ORDER BY created_at DESC';
  
  const orders = db.prepare(sql).all(...params);
  res.json(enrichOrders(orders));
});

// 删除点餐
router.delete('/:id', authMiddleware, (req, res) => {
  const family = getUserFamily(req.user.id);
  if (!family) {
    return res.status(400).json({ error: '请先创建或加入家庭' });
  }
  
  db.prepare('DELETE FROM order_items WHERE id = ? AND family_id = ?').run(req.params.id, family.family_id);
  res.json({ success: true });
});

// 更新点餐状态
router.patch('/:id/status', authMiddleware, (req, res) => {
  const family = getUserFamily(req.user.id);
  if (!family) {
    return res.status(400).json({ error: '请先创建或加入家庭' });
  }
  
  const { status } = req.body;
  db.prepare('UPDATE order_items SET status = ? WHERE id = ? AND family_id = ?').run(status, req.params.id, family.family_id);
  
  const order = db.prepare('SELECT * FROM order_items WHERE id = ?').get(req.params.id);
  res.json(order);
});

module.exports = router;
