const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../database');
const { authMiddleware, getUserFamily } = require('../middleware/auth');

function generateId() {
  return crypto.randomUUID();
}

// 生成每周食谱（通用函数）
function generateWeeklyMenu(familyId, userId) {
  // 清空现有周菜单
  db.prepare('DELETE FROM weekly_menu WHERE family_id = ?').run(familyId);
  
  // 获取所有菜品
  const allDishes = db.prepare('SELECT * FROM dishes WHERE is_hidden = 0').all();
  
  // 按分类分组
  const meatDishes = allDishes.filter(d => d.category === '荤菜' || d.category === '热菜');
  const vegDishes = allDishes.filter(d => d.category === '素菜');
  const soupDishes = allDishes.filter(d => d.category === '汤品');
  const stapleDishes = allDishes.filter(d => d.category === '主食');
  const breakfastDishes = allDishes.filter(d => d.category === '早餐' || (d.tags && JSON.parse(d.tags).includes('早餐')));
  
  // 为每天生成菜单
  for (let day = 0; day < 7; day++) {
    // 早餐：1-2道
    const breakfastCount = Math.min(2, Math.max(1, breakfastDishes.length));
    for (let i = 0; i < breakfastCount; i++) {
      const dish = breakfastDishes[Math.floor(Math.random() * breakfastDishes.length)];
      if (dish) {
        db.prepare(`
          INSERT INTO weekly_menu (id, family_id, dish_id, week_day, meal_type, added_by)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(generateId(), familyId, dish.id, day, 'breakfast', userId);
      }
    }
    
    // 午餐：1荤1素
    const lunchMeat = meatDishes[Math.floor(Math.random() * meatDishes.length)];
    const lunchVeg = vegDishes[Math.floor(Math.random() * vegDishes.length)];
    if (lunchMeat) {
      db.prepare(`
        INSERT INTO weekly_menu (id, family_id, dish_id, week_day, meal_type, added_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(generateId(), familyId, lunchMeat.id, day, 'lunch', userId);
    }
    if (lunchVeg) {
      db.prepare(`
        INSERT INTO weekly_menu (id, family_id, dish_id, week_day, meal_type, added_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(generateId(), familyId, lunchVeg.id, day, 'lunch', userId);
    }
    
    // 晚餐：1荤1素1汤
    const dinnerMeat = meatDishes[Math.floor(Math.random() * meatDishes.length)];
    const dinnerVeg = vegDishes[Math.floor(Math.random() * vegDishes.length)];
    const dinnerSoup = soupDishes[Math.floor(Math.random() * soupDishes.length)];
    if (dinnerMeat) {
      db.prepare(`
        INSERT INTO weekly_menu (id, family_id, dish_id, week_day, meal_type, added_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(generateId(), familyId, dinnerMeat.id, day, 'dinner', userId);
    }
    if (dinnerVeg) {
      db.prepare(`
        INSERT INTO weekly_menu (id, family_id, dish_id, week_day, meal_type, added_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(generateId(), familyId, dinnerVeg.id, day, 'dinner', userId);
    }
    if (dinnerSoup) {
      db.prepare(`
        INSERT INTO weekly_menu (id, family_id, dish_id, week_day, meal_type, added_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(generateId(), familyId, dinnerSoup.id, day, 'dinner', userId);
    }
  }
}

// 获取周菜单
router.get('/', authMiddleware, (req, res) => {
  const family = getUserFamily(req.user.id);
  if (!family) {
    return res.json({ days: [] });
  }
  
  let items = db.prepare(`
    SELECT wm.*, d.name, d.image_url, d.category, d.spiciness, d.healthiness, d.cook_time
    FROM weekly_menu wm 
    JOIN dishes d ON wm.dish_id = d.id 
    WHERE wm.family_id = ? 
    ORDER BY wm.week_day, wm.meal_type
  `).all(family.family_id);
  
  // 如果没有数据，自动生成
  if (!items || items.length === 0) {
    // 调用生成逻辑
    generateWeeklyMenu(family.family_id, req.user.id);
    // 重新查询
    items = db.prepare(`
      SELECT wm.*, d.name, d.image_url, d.category, d.spiciness, d.healthiness, d.cook_time
      FROM weekly_menu wm 
      JOIN dishes d ON wm.dish_id = d.id 
      WHERE wm.family_id = ? 
      ORDER BY wm.week_day, wm.meal_type
    `).all(family.family_id);
  }
  
  // 按天和餐次分组
  const days = [];
  const dayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  
  for (let i = 0; i < 7; i++) {
    const dayItems = items.filter(item => item.week_day === i);
    days.push({
      day: i,
      name: dayNames[i],
      breakfast: dayItems.filter(item => item.meal_type === 'breakfast'),
      lunch: dayItems.filter(item => item.meal_type === 'lunch'),
      dinner: dayItems.filter(item => item.meal_type === 'dinner'),
      nutrition: '优质蛋白+碳水+维生素+膳食纤维'
    });
  }
  
  res.json({ days, stats: '本周已搭配7天营养均衡食谱' });
});

// 添加到周菜单
router.post('/', authMiddleware, (req, res) => {
  const family = getUserFamily(req.user.id);
  if (!family) {
    return res.status(400).json({ error: '请先创建或加入家庭' });
  }
  
  const { dishId, weekDay, mealType } = req.body;
  
  if (!dishId || weekDay === undefined || !mealType) {
    return res.status(400).json({ error: '参数不完整' });
  }
  
  const id = generateId();
  db.prepare(`
    INSERT INTO weekly_menu (id, family_id, dish_id, week_day, meal_type, added_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, family.family_id, dishId, weekDay, mealType, req.user.id);
  
  res.json({ success: true, id });
});

// 从周菜单移除
router.delete('/:id', authMiddleware, (req, res) => {
  const family = getUserFamily(req.user.id);
  if (!family) {
    return res.status(400).json({ error: '请先创建或加入家庭' });
  }
  
  db.prepare('DELETE FROM weekly_menu WHERE id = ? AND family_id = ?').run(req.params.id, family.family_id);
  res.json({ success: true });
});

// 生成推荐周菜单
router.post('/generate', authMiddleware, (req, res) => {
  const family = getUserFamily(req.user.id);
  if (!family) {
    return res.status(400).json({ error: '请先创建或加入家庭' });
  }
  
  generateWeeklyMenu(family.family_id, req.user.id);
  
  res.json({ success: true, message: '已生成本周营养食谱' });
});

// 重新生成整周菜单
router.post('/regenerate-weekly', authMiddleware, (req, res) => {
  // 复用generate逻辑
  return router.handle({ ...req, url: '/generate', method: 'POST' }, res);
});

module.exports = router;
