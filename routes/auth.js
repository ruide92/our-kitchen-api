const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../database');
const { generateToken, getUserFamily, authMiddleware } = require('../middleware/auth');

// 生成UUID
function generateId() {
  return crypto.randomUUID();
}

// 微信登录
router.post('/login', async (req, res) => {
  const { code, nickname, avatar } = req.body;
  
  if (!code) {
    return res.status(400).json({ error: '缺少code' });
  }

  try {
    // 这里应该调用微信API获取openid
    // 微信API: https://api.weixin.qq.com/sns/jscode2session
    // 由于没有AppSecret，暂时用code模拟openid
    const openid = 'wx_' + crypto.createHash('md5').update(code).digest('hex').substring(0, 16);
    
    // 查找或创建用户
    let user = db.prepare('SELECT * FROM users WHERE openid = ?').get(openid);
    
    if (!user) {
      const userId = generateId();
      db.prepare(`
        INSERT INTO users (id, openid, nickname, avatar) 
        VALUES (?, ?, ?, ?)
      `).run(userId, openid, nickname || '微信用户', avatar || '');
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    } else if (nickname || avatar) {
      // 更新用户信息
      db.prepare(`
        UPDATE users SET nickname = COALESCE(?, nickname), avatar = COALESCE(?, avatar) WHERE id = ?
      `).run(nickname || null, avatar || null, user.id);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    }

    // 生成Token
    const token = generateToken(user.id);
    
    // 获取用户家庭
    let family = getUserFamily(user.id);
    
    // 如果没有家庭，自动创建一个默认家庭
    if (!family) {
      const familyId = generateId();
      const inviteCode = crypto.randomBytes(3).toString('hex').toUpperCase();
      db.prepare(`
        INSERT INTO families (id, name, invite_code, created_by) 
        VALUES (?, ?, ?, ?)
      `).run(familyId, '我们家的大食堂', inviteCode, user.id);
      
      db.prepare(`
        INSERT INTO family_members (id, family_id, user_id, role, joined_at) 
        VALUES (?, ?, ?, ?, ?)
      `).run(generateId(), familyId, user.id, 'OWNER', new Date().toISOString());
      
      family = getUserFamily(user.id);
    }
    
    res.json({
      token,
      user: {
        id: user.id,
        nickname: user.nickname,
        avatar: user.avatar
      },
      kitchen: family ? {
        id: family.family_id,
        name: family.family_name,
        invite_code: family.invite_code,
        role: family.role
      } : null
    });
  } catch (err) {
    console.error('登录失败:', err);
    res.status(500).json({ error: '登录失败' });
  }
});

// 更新用户信息
router.put('/info', authMiddleware, (req, res) => {
  const { nickname, avatar } = req.body;
  const userId = req.user.id;
  
  db.prepare(`
    UPDATE users SET nickname = COALESCE(?, nickname), avatar = COALESCE(?, avatar) WHERE id = ?
  `).run(nickname || null, avatar || null, userId);
  
  const user = db.prepare('SELECT id, nickname, avatar FROM users WHERE id = ?').get(userId);
  res.json(user);
});

// 获取用户信息
router.get('/info', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id, nickname, avatar FROM users WHERE id = ?').get(req.user.id);
  res.json(user);
});

module.exports = router;
