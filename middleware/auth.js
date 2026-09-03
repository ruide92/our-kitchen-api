const jwt = require('jsonwebtoken');
const db = require('../database');

const JWT_SECRET = 'our-kitchen-secret-key-2024';

// 生成Token
function generateToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '365d' });
}

// 认证中间件
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录' });
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: '用户不存在' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: '登录已过期' });
  }
}

// 获取用户当前家庭（手动处理关联，因为JSON数据库不支持JOIN）
function getUserFamily(userId) {
  const member = db.prepare('SELECT * FROM family_members WHERE user_id = ? LIMIT 1').get(userId);
  if (member) {
    const family = db.prepare('SELECT * FROM families WHERE id = ?').get(member.family_id);
    if (family) {
      member.family_name = family.name;
      member.invite_code = family.invite_code;
    }
  }
  return member;
}

module.exports = {
  JWT_SECRET,
  generateToken,
  authMiddleware,
  getUserFamily
};
