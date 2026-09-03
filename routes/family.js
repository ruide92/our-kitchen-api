const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../database');
const { authMiddleware, getUserFamily } = require('../middleware/auth');

function generateId() {
  return crypto.randomUUID();
}

function generateInviteCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// 手动获取成员列表（关联用户表）
function getMembersWithUserInfo(familyId) {
  const members = db.prepare('SELECT * FROM family_members WHERE family_id = ?').all(familyId);
  return members.map(m => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(m.user_id);
    return {
      ...m,
      nickname: user ? user.nickname : m.nickname,
      avatar: user ? user.avatar : ''
    };
  });
}

// 获取我的家庭
router.get('/mine', authMiddleware, (req, res) => {
  const family = getUserFamily(req.user.id);
  if (!family) {
    return res.json(null);
  }
  
  const members = getMembersWithUserInfo(family.family_id);
  
  res.json({
    id: family.family_id,
    name: family.family_name,
    invite_code: family.invite_code,
    role: family.role,
    members: members.map(m => ({
      id: m.id,
      user_id: m.user_id,
      nickname: m.nickname,
      avatar: m.avatar,
      role: m.role
    }))
  });
});

// 创建家庭
router.post('/', authMiddleware, (req, res) => {
  const { name } = req.body;
  const userId = req.user.id;
  
  if (!name || name.trim().length < 2) {
    return res.status(400).json({ error: '家庭名称至少2个字' });
  }
  
  // 检查用户是否已有家庭
  const existing = getUserFamily(userId);
  if (existing) {
    return res.status(400).json({ error: '你已经加入了一个家庭' });
  }
  
  const familyId = generateId();
  const inviteCode = generateInviteCode();
  
  db.prepare('INSERT INTO families (id, name, invite_code, owner_id) VALUES (?, ?, ?, ?)')
    .run(familyId, name.trim(), inviteCode, userId);
  
  db.prepare('INSERT INTO family_members (id, family_id, user_id, nickname, role) VALUES (?, ?, ?, ?, ?)')
    .run(generateId(), familyId, userId, req.user.nickname, 'owner');
  
  res.json({
    id: familyId,
    name: name.trim(),
    invite_code: inviteCode,
    role: 'owner'
  });
});

// 加入家庭
router.post('/join', authMiddleware, (req, res) => {
  const { inviteCode } = req.body;
  const userId = req.user.id;
  
  if (!inviteCode) {
    return res.status(400).json({ error: '请输入邀请码' });
  }
  
  // 检查用户是否已有家庭
  const existing = getUserFamily(userId);
  if (existing) {
    return res.status(400).json({ error: '你已经加入了一个家庭' });
  }
  
  const family = db.prepare('SELECT * FROM families WHERE invite_code = ?').get(inviteCode.toUpperCase());
  if (!family) {
    return res.status(400).json({ error: '邀请码无效' });
  }
  
  db.prepare('INSERT INTO family_members (id, family_id, user_id, nickname, role) VALUES (?, ?, ?, ?, ?)')
    .run(generateId(), family.id, userId, req.user.nickname, 'member');
  
  res.json({
    id: family.id,
    name: family.name,
    invite_code: family.invite_code,
    role: 'member'
  });
});

// 成员列表
router.get('/members', authMiddleware, (req, res) => {
  const family = getUserFamily(req.user.id);
  if (!family) {
    return res.json([]);
  }
  
  const members = getMembersWithUserInfo(family.family_id);
  res.json(members.map(m => ({
    id: m.id,
    user_id: m.user_id,
    nickname: m.nickname,
    avatar: m.avatar,
    role: m.role
  })));
});

// 修改家庭名称
router.patch('/name', authMiddleware, (req, res) => {
  const { name } = req.body;
  const family = getUserFamily(req.user.id);
  
  if (!family) {
    return res.status(400).json({ error: '你还没有加入家庭' });
  }
  
  if (family.role !== 'owner' && family.role !== 'admin') {
    return res.status(403).json({ error: '没有权限修改' });
  }
  
  db.prepare('UPDATE families SET name = ? WHERE id = ?').run(name, family.family_id);
  res.json({ success: true, name });
});

// 生成新邀请码
router.post('/invite-code', authMiddleware, (req, res) => {
  const family = getUserFamily(req.user.id);
  if (!family) {
    return res.status(400).json({ error: '你还没有加入家庭' });
  }
  
  const newCode = generateInviteCode();
  db.prepare('UPDATE families SET invite_code = ? WHERE id = ?').run(newCode, family.family_id);
  
  res.json({ invite_code: newCode });
});

module.exports = router;
