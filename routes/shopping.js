const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../database');
const { authMiddleware, getUserFamily } = require('../middleware/auth');

function generateId() {
  return crypto.randomUUID();
}

// 获取购物清单
router.get('/', authMiddleware, (req, res) => {
  const family = getUserFamily(req.user.id);
  if (!family) {
    return res.json([]);
  }
  
  const items = db.prepare('SELECT * FROM shopping_items WHERE family_id = ? ORDER BY is_bought ASC, created_at DESC').all(family.family_id);
  
  res.json({
    list: items,
    total: items.length,
    bought: items.filter(i => i.is_bought).length
  });
});

// 添加购物项
router.post('/', authMiddleware, (req, res) => {
  const family = getUserFamily(req.user.id);
  if (!family) {
    return res.status(400).json({ error: '请先创建或加入家庭' });
  }
  
  const { name, quantity, unit, category, is_custom } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: '请输入商品名称' });
  }
  
  const id = generateId();
  db.prepare(`
    INSERT INTO shopping_items (id, family_id, name, quantity, unit, category, is_custom)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, family.family_id, name, quantity || 1, unit || '', category || '蔬菜', is_custom ? 1 : 0);
  
  const item = db.prepare('SELECT * FROM shopping_items WHERE id = ?').get(id);
  res.json(item);
});

// 切换已买状态
router.patch('/:id/toggle', authMiddleware, (req, res) => {
  const family = getUserFamily(req.user.id);
  if (!family) {
    return res.status(400).json({ error: '请先创建或加入家庭' });
  }
  
  const { is_bought } = req.body;
  const item = db.prepare('SELECT * FROM shopping_items WHERE id = ? AND family_id = ?').get(req.params.id, family.family_id);
  
  if (!item) {
    return res.status(404).json({ error: '商品不存在' });
  }
  
  const newStatus = is_bought !== undefined ? (is_bought ? 1 : 0) : (item.is_bought ? 0 : 1);
  db.prepare('UPDATE shopping_items SET is_bought = ? WHERE id = ?').run(newStatus, req.params.id);
  
  const updated = db.prepare('SELECT * FROM shopping_items WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// 批量切换已买状态
router.post('/toggle-all', authMiddleware, (req, res) => {
  const family = getUserFamily(req.user.id);
  if (!family) {
    return res.status(400).json({ error: '请先创建或加入家庭' });
  }
  
  const { is_bought } = req.body;
  const status = is_bought ? 1 : 0;
  
  db.prepare('UPDATE shopping_items SET is_bought = ? WHERE family_id = ?').run(status, family.family_id);
  
  res.json({ success: true });
});

// 修改购物项
router.patch('/:id', authMiddleware, (req, res) => {
  const family = getUserFamily(req.user.id);
  if (!family) {
    return res.status(400).json({ error: '请先创建或加入家庭' });
  }
  
  const { name, quantity, unit, category } = req.body;
  db.prepare(`
    UPDATE shopping_items SET 
      name = COALESCE(?, name),
      quantity = COALESCE(?, quantity),
      unit = COALESCE(?, unit),
      category = COALESCE(?, category)
    WHERE id = ? AND family_id = ?
  `).run(name || null, quantity !== undefined ? quantity : null, unit || null, category || null, req.params.id, family.family_id);
  
  const updated = db.prepare('SELECT * FROM shopping_items WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// 删除购物项
router.delete('/:id', authMiddleware, (req, res) => {
  const family = getUserFamily(req.user.id);
  if (!family) {
    return res.status(400).json({ error: '请先创建或加入家庭' });
  }
  
  db.prepare('DELETE FROM shopping_items WHERE id = ? AND family_id = ?').run(req.params.id, family.family_id);
  res.json({ success: true });
});

// 已购食材移入冰箱
router.post('/move-to-fridge', authMiddleware, (req, res) => {
  const family = getUserFamily(req.user.id);
  if (!family) {
    return res.status(400).json({ error: '请先创建或加入家庭' });
  }
  
  const boughtItems = db.prepare('SELECT * FROM shopping_items WHERE family_id = ? AND is_bought = 1').all(family.family_id);
  
  boughtItems.forEach(item => {
    // 检查冰箱中是否已有相同食材
    const existing = db.prepare('SELECT * FROM fridge_items WHERE family_id = ? AND name = ?').get(family.family_id, item.name);
    if (existing) {
      db.prepare('UPDATE fridge_items SET quantity = quantity + ? WHERE id = ?').run(item.quantity, existing.id);
    } else {
      db.prepare(`
        INSERT INTO fridge_items (id, family_id, name, quantity, unit, category)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(generateId(), family.family_id, item.name, item.quantity, item.unit, item.category);
    }
  });
  
  // 清空已买项
  db.prepare('DELETE FROM shopping_items WHERE family_id = ? AND is_bought = 1').run(family.family_id);
  
  res.json({ success: true, moved: boughtItems.length });
});

// 从菜品生成购物清单
router.post('/generate-from-dishes', authMiddleware, (req, res) => {
  const family = getUserFamily(req.user.id);
  if (!family) {
    return res.status(400).json({ error: '请先创建或加入家庭' });
  }
  
  const { dishIds } = req.body;
  if (!dishIds || !Array.isArray(dishIds) || dishIds.length === 0) {
    return res.status(400).json({ error: '请选择菜品' });
  }
  
  const allIngredients = {};
  
  dishIds.forEach(dishId => {
    const dish = db.prepare('SELECT * FROM dishes WHERE id = ?').get(dishId);
    if (dish && dish.ingredients) {
      const ingredients = JSON.parse(dish.ingredients);
      ingredients.forEach(ing => {
        const key = ing.name + '_' + (ing.unit || '');
        if (allIngredients[key]) {
          allIngredients[key].quantity += (ing.amount || 1);
        } else {
          allIngredients[key] = {
            name: ing.name,
            quantity: ing.amount || 1,
            unit: ing.unit || '',
            category: ing.type === 'main' ? '肉类' : ing.type === 'side' ? '蔬菜' : '调料',
            source_dishes: [{ dishId, dishName: dish.name }]
          };
        }
      });
    }
  });
  
  // 扣除冰箱已有食材
  const fridgeItems = db.prepare('SELECT * FROM fridge_items WHERE family_id = ?').all(family.family_id);
  Object.values(allIngredients).forEach(ing => {
    const fridgeItem = fridgeItems.find(f => f.name === ing.name);
    if (fridgeItem && fridgeItem.quantity >= ing.quantity) {
      ing.quantity = 0; // 冰箱足够，不需要买
    } else if (fridgeItem) {
      ing.quantity -= fridgeItem.quantity; // 扣除冰箱已有
    }
  });
  
  // 添加到购物清单
  const added = [];
  Object.values(allIngredients).forEach(ing => {
    if (ing.quantity > 0) {
      const id = generateId();
      db.prepare(`
        INSERT INTO shopping_items (id, family_id, name, quantity, unit, category, source_dishes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, family.family_id, ing.name, ing.quantity, ing.unit, ing.category, JSON.stringify(ing.source_dishes));
      added.push(id);
    }
  });
  
  res.json({ success: true, added: added.length });
});

module.exports = router;
