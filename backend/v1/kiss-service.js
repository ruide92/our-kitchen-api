// Kiss Service — V4
// Append-only family emotional ledger. Not currency, not rating.
const { randomUUID } = require('node:crypto');
const { withTransaction } = require('./db');
const { ApiError } = require('./errors');
const { authorize } = require('./family-access');

function createKissService(pool) {
  async function access(familyId, userId, roles, write, work) {
    return withTransaction(pool, async tx => {
      const family = (await tx.query(`SELECT id FROM families WHERE id=$1 AND deleted_at IS NULL${write ? ' FOR UPDATE' : ' FOR SHARE'}`, [familyId])).rows[0];
      if (!family) throw new ApiError(403, 'FAMILY_FORBIDDEN', '你不是该家庭成员');
      await authorize(tx, familyId, userId, roles);
      return work(tx);
    });
  }

  async function sendKiss(familyId, userId, body) {
    return access(familyId, userId, null, true, async tx => {
      const { to_user_id, recipe_id, meal_id, suggested_amount, actual_amount, rating_id, reason } = body;
      if (!to_user_id) throw new ApiError(400, 'TO_USER_REQUIRED', '请选择接收么么哒的家人');
      if (to_user_id === userId) throw new ApiError(400, 'CANNOT_KISS_SELF', '不能给自己送么么哒');

      // Verify both are active family members
      const toMember = (await tx.query('SELECT * FROM family_members WHERE family_id=$1 AND user_id=$2 AND status=\'ACTIVE\'', [familyId, to_user_id])).rows[0];
      if (!toMember) throw new ApiError(403, 'USER_NOT_IN_FAMILY', '对方不是该家庭成员');

      const amount = actual_amount != null ? parseInt(actual_amount) : (suggested_amount != null ? parseInt(suggested_amount) : 1);
      if (isNaN(amount) || amount < 0) throw new ApiError(400, 'INVALID_AMOUNT', '么么哒数量无效');

      const id = randomUUID();
      await tx.query(`INSERT INTO kiss_ledger(id,family_id,from_user_id,to_user_id,recipe_id,meal_id,suggested_amount,actual_amount,rating_id,reason)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, familyId, userId, to_user_id, recipe_id || null, meal_id || null,
         suggested_amount != null ? parseInt(suggested_amount) : null, amount, rating_id || null, reason || null]);

      const record = (await tx.query('SELECT * FROM kiss_ledger WHERE id=$1', [id])).rows[0];
      return record;
    });
  }

  async function getKissSummary(familyId, userId, period = 'month') {
    return access(familyId, userId, null, false, async tx => {
      const dateFilter = period === 'month'
        ? "AND created_at >= date_trunc('month', CURRENT_DATE)"
        : period === 'week' ? "AND created_at >= date_trunc('week', CURRENT_DATE)"
        : '';

      // Total family count
      const total = (await tx.query(`SELECT COUNT(*) as cnt, COALESCE(SUM(actual_amount),0) as total_amount FROM kiss_ledger WHERE family_id=$1 ${dateFilter}`, [familyId])).rows[0];

      // Per member: received and sent
      const members = (await tx.query(`
        SELECT u.id, u.nickname, u.avatar_url,
          COALESCE((SELECT SUM(actual_amount) FROM kiss_ledger k WHERE k.family_id=$1 AND k.to_user_id=u.id ${dateFilter}),0) as received,
          COALESCE((SELECT SUM(actual_amount) FROM kiss_ledger k WHERE k.family_id=$1 AND k.from_user_id=u.id ${dateFilter}),0) as sent
        FROM family_members fm
        JOIN users u ON u.id = fm.user_id
        WHERE fm.family_id=$1 AND fm.status='ACTIVE'
        ORDER BY received DESC
      `, [familyId])).rows;

      // Recent entries
      const recent = (await tx.query(`
        SELECT k.*, fu.nickname as from_nickname, tu.nickname as to_nickname, r.name as recipe_name
        FROM kiss_ledger k
        LEFT JOIN users fu ON fu.id = k.from_user_id
        LEFT JOIN users tu ON tu.id = k.to_user_id
        LEFT JOIN recipes r ON r.id = k.recipe_id
        WHERE k.family_id=$1
        ORDER BY k.created_at DESC
        LIMIT 20
      `, [familyId])).rows;

      return {
        period,
        total_count: parseInt(total.cnt),
        total_amount: parseInt(total.total_amount),
        members,
        recent
      };
    });
  }

  return { sendKiss, getKissSummary };
}

module.exports = { createKissService };
