const express = require('express');
const router = express.Router();
const db = require('../database');
const { authMiddleware } = require('../middleware/auth');

// 手动关联菜品信息
function enrichFavorites(favorites) {
  return favorites.map(f => {
    const dish = db.prepare('SELECT * FROM dishes WHERE id = ?').get(f.dish_id);
    return {
      ...f,
      name: dish ? dish.name : '',
      image_url: dish ? dish.image_url : '',
      category: dish ? dish.category : '',
      spiciness: dish ? dish.spiciness : 0,
      healthiness: dish ? dish.healthiness : 0,
      cook_time: dish ? dish.cook_time : 0,
      kiss_level: dish ? dish.kiss_level : 0
    };
  });
}

// 获取收藏列表
router.get('/', authMiddleware, (req, res) => {
  const favorites = db.prepare('SELECT * FROM favorites WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json(enrichFavorites(favorites));
});

// 检查是否收藏
router.get('/check/:dishId', authMiddleware, (req, res) => {
  const favorite = db.prepare('SELECT * FROM favorites WHERE user_id = ? AND dish_id = ?').get(req.user.id, req.params.dishId);
  res.json({ isFavorite: !!favorite });
});

module.exports = router;
