const { randomUUID } = require('node:crypto');

function createRepository(pool) {
  return {
    async upsertWechatUser({ openid, unionid }) {
      const { rows } = await pool.query(`
        INSERT INTO users(id,wechat_openid,wechat_unionid) VALUES($1,$2,$3)
        ON CONFLICT(wechat_openid) DO UPDATE SET
          wechat_unionid=COALESCE(EXCLUDED.wechat_unionid,users.wechat_unionid),
          last_login_at=now(), updated_at=now()
        RETURNING id,nickname,avatar_url`, [randomUUID(), openid, unionid]);
      return rows[0];
    },
    async getUser(id) {
      return (await pool.query('SELECT id,nickname,avatar_url FROM users WHERE id=$1', [id])).rows[0] || null;
    },
    async updateUser(id, data) {
      const validated = require('./family-validation').validateProfile(data);
      const keys = ['nickname','avatar_url'].filter(key => key in validated);
      const values = keys.map(key => validated[key]); values.push(id);
      return (await pool.query(`UPDATE users SET ${keys.map((key,i)=>`${key}=$${i+1}`).join(',')},updated_at=now() WHERE id=$${values.length} RETURNING id,nickname,avatar_url`,values)).rows[0];
    },
    async listFamilies(userId) {
      return (await pool.query(`SELECT f.id,f.name,m.role FROM families f
        JOIN family_members m ON m.family_id=f.id
        WHERE m.user_id=$1 AND m.status='ACTIVE' AND f.deleted_at IS NULL
        ORDER BY f.created_at,f.id`, [userId])).rows;
    },
    async getMembership(familyId, userId) {
      return (await pool.query(`SELECT m.id,m.family_id,m.user_id,m.role,m.status
        FROM family_members m JOIN families f ON f.id=m.family_id
        WHERE m.family_id=$1 AND m.user_id=$2 AND m.status='ACTIVE' AND f.deleted_at IS NULL`, [familyId, userId])).rows[0] || null;
    }
  };
}
module.exports = { createRepository };
