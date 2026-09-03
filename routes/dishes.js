const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../database');
const { authMiddleware, getUserFamily } = require('../middleware/auth');

function generateId() {
  return crypto.randomUUID();
}

// 菜品列表（公开，不需要登录）
router.get('/', (req, res) => {
  const { category, cuisine, cookware, spiciness, keyword, page = 1, pageSize = 50, onlyFavorites, onlyLazy } = req.query;
  
  let sql = 'SELECT * FROM dishes WHERE is_hidden = 0';
  const params = [];
  
  if (category && category !== '全部') {
    sql += ' AND category = ?';
    params.push(category);
  }
  if (cuisine) {
    sql += ' AND cuisine = ?';
    params.push(cuisine);
  }
  if (cookware) {
    sql += ' AND cookware LIKE ?';
    params.push('%' + cookware + '%');
  }
  if (spiciness) {
    sql += ' AND spiciness >= ?';
    params.push(parseInt(spiciness));
  }
  if (keyword) {
    sql += ' AND (name LIKE ? OR tags LIKE ? OR description LIKE ?)';
    params.push('%' + keyword + '%', '%' + keyword + '%', '%' + keyword + '%');
  }
  if (onlyLazy === 'true' || onlyLazy === '1') {
    sql += ' AND is_lazy = 1';
  }
  
  sql += ' ORDER BY is_custom DESC, created_at DESC';
  
  // 分页
  const offset = (parseInt(page) - 1) * parseInt(pageSize);
  sql += ' LIMIT ? OFFSET ?';
  params.push(parseInt(pageSize), offset);
  
  const dishes = db.prepare(sql).all(...params);
  
  // 解析JSON字段
  const result = dishes.map(d => ({
    ...d,
    ingredients: d.ingredients ? JSON.parse(d.ingredients) : [],
    steps: d.steps ? JSON.parse(d.steps) : [],
    tips: d.tips ? JSON.parse(d.tips) : [],
    tags: d.tags ? JSON.parse(d.tags) : [],
    cookware: d.cookware ? JSON.parse(d.cookware) : []
  }));
  
  // 获取总数
  let countSql = 'SELECT COUNT(*) as total FROM dishes WHERE is_hidden = 0';
  const countParams = params.slice(0, params.length - 2);
  const total = db.prepare(countSql).get(...countParams).total;
  
  res.json({
    list: result,
    total,
    page: parseInt(page),
    pageSize: parseInt(pageSize)
  });
});

// 菜品详情
router.get('/:id', (req, res) => {
  const dish = db.prepare('SELECT * FROM dishes WHERE id = ?').get(req.params.id);
  if (!dish) {
    return res.status(404).json({ error: '菜品不存在' });
  }
  
  const result = {
    ...dish,
    ingredients: dish.ingredients ? JSON.parse(dish.ingredients) : [],
    steps: dish.steps ? JSON.parse(dish.steps) : [],
    tips: dish.tips ? JSON.parse(dish.tips) : [],
    tags: dish.tags ? JSON.parse(dish.tags) : [],
    cookware: dish.cookware ? JSON.parse(dish.cookware) : []
  };
  
  res.json(result);
});

// 热门排行
router.get('/hot/list', (req, res) => {
  const dishes = db.prepare('SELECT * FROM dishes WHERE is_hidden = 0 ORDER BY is_custom DESC, created_at DESC LIMIT 10').all();
  res.json(dishes.map(d => ({
    ...d,
    ingredients: d.ingredients ? JSON.parse(d.ingredients) : [],
    steps: d.steps ? JSON.parse(d.steps) : [],
    tags: d.tags ? JSON.parse(d.tags) : []
  })));
});

// 分类列表
router.get('/categories/list', (req, res) => {
  const categories = db.prepare('SELECT DISTINCT category FROM dishes WHERE category IS NOT NULL AND category != "" ORDER BY category').all();
  res.json(categories.map(c => c.category));
});

// 评分
router.post('/:id/rate', authMiddleware, (req, res) => {
  const { rating } = req.body;
  const dishId = req.params.id;
  const userId = req.user.id;
  
  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: '评分必须在1-5之间' });
  }
  
  // 检查是否已评分
  const existing = db.prepare('SELECT * FROM dish_ratings WHERE dish_id = ? AND user_id = ?').get(dishId, userId);
  
  if (existing) {
    db.prepare('UPDATE dish_ratings SET rating = ? WHERE id = ?').run(rating, existing.id);
  } else {
    db.prepare('INSERT INTO dish_ratings (id, dish_id, user_id, rating) VALUES (?, ?, ?, ?)')
      .run(generateId(), dishId, userId, rating);
  }
  
  res.json({ success: true, rating });
});

// 取消评分
router.delete('/:id/rate', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM dish_ratings WHERE dish_id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

// 收藏/取消收藏
router.post('/:id/favorite', authMiddleware, (req, res) => {
  const dishId = req.params.id;
  const userId = req.user.id;
  
  const existing = db.prepare('SELECT * FROM favorites WHERE user_id = ? AND dish_id = ?').get(userId, dishId);
  
  if (existing) {
    db.prepare('DELETE FROM favorites WHERE id = ?').run(existing.id);
    res.json({ success: true, isFavorite: false });
  } else {
    db.prepare('INSERT INTO favorites (id, user_id, dish_id) VALUES (?, ?, ?)')
      .run(generateId(), userId, dishId);
    res.json({ success: true, isFavorite: true });
  }
});

// 我的评分列表
router.get('/my-rated/list', authMiddleware, (req, res) => {
  const ratings = db.prepare('SELECT * FROM dish_ratings WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  const enriched = ratings.map(r => {
    const dish = db.prepare('SELECT * FROM dishes WHERE id = ?').get(r.dish_id);
    return {
      ...r,
      name: dish ? dish.name : '',
      image_url: dish ? dish.image_url : '',
      category: dish ? dish.category : ''
    };
  });
  res.json(enriched);
});

module.exports = router;
