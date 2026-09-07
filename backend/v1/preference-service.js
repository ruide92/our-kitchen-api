// Preference Service — V4 (12G)
// User-level preferences: spiciness, allergens, disliked ingredients, diet tags.
// Family-scoped: one row per (family_id, user_id). Association tables full-replace on PATCH.
// No migration needed (010 already applied).
const { withTransaction } = require('./db');
const { ApiError } = require('./errors');
const { authorize, forbidden } = require('./family-access');

const ALLOWED_ALLERGENS = new Set([
  'SOY', 'PEANUT', 'TREE_NUT', 'MILK', 'EGG', 'WHEAT', 'FISH', 'SHELLFISH',
  'SESAME', 'MUSTARD', 'CELERY', 'LUPIN', 'SULFITE', 'PORK', 'BEEF', 'CHICKEN',
  'SEafood', 'GLUTEN', 'LACTOSE', 'ALCOHOL'
]);

function createPreferenceService(pool) {
  async function access(familyId, userId, roles, write, work) {
    return withTransaction(pool, async tx => {
      const family = (await tx.query(`SELECT id FROM families WHERE id=$1 AND deleted_at IS NULL${write ? ' FOR UPDATE' : ' FOR SHARE'}`, [familyId])).rows[0];
      if (!family) throw forbidden();
      await authorize(tx, familyId, userId, roles);
      return work(tx);
    });
  }

  function validateSpiciness(val) {
    if (val == null) return null;
    const n = Number(val);
    if (!Number.isInteger(n) || n < 0 || n > 5) {
      throw new ApiError(400, 'INVALID_SPICINESS', '辣度偏好必须是 0-5 的整数或不设置');
    }
    return n;
  }

  function validateAllergens(list) {
    if (!Array.isArray(list)) throw new ApiError(400, 'INVALID_REQUEST', 'allergens 必须是数组');
    const clean = [...new Set(list.map(a => String(a).toUpperCase().trim()).filter(Boolean))];
    for (const code of clean) {
      if (!ALLOWED_ALLERGENS.has(code)) {
        throw new ApiError(400, 'INVALID_ALLERGEN', `未知过敏原代码: ${code}`);
      }
    }
    return clean;
  }

  function validateDietTags(list) {
    if (!Array.isArray(list)) throw new ApiError(400, 'INVALID_REQUEST', 'diet_tags 必须是数组');
    return [...new Set(list.map(t => String(t).toUpperCase().trim()).filter(Boolean))];
  }

  async function validateIngredientIds(tx, list) {
    if (!Array.isArray(list)) throw new ApiError(400, 'INVALID_REQUEST', 'disliked_ingredient_ids 必须是数组');
    const clean = [...new Set(list.filter(Boolean))];
    if (clean.length === 0) return [];
    const placeholders = clean.map((_, i) => `$${i + 1}`).join(',');
    const rows = (await tx.query(`SELECT id FROM ingredients WHERE id IN (${placeholders})`, clean)).rows;
    const valid = new Set(rows.map(r => r.id));
    const invalid = clean.filter(id => !valid.has(id));
    if (invalid.length > 0) {
      throw new ApiError(400, 'INVALID_INGREDIENT', `不存在的食材 ID: ${invalid.length} 个`);
    }
    return clean;
  }

  async function _fetchPreferences(tx, familyId, userId) {
    const pref = (await tx.query(
      'SELECT spiciness_preference, notes FROM user_preferences WHERE family_id=$1 AND user_id=$2',
      [familyId, userId]
    )).rows[0];

    const [disliked, allergens, dietTags] = await Promise.all([
      tx.query(`
        SELECT d.ingredient_id, i.display_name as name
        FROM user_disliked_ingredients d
        LEFT JOIN ingredients i ON i.id = d.ingredient_id
        WHERE d.family_id=$1 AND d.user_id=$2
        ORDER BY i.display_name
      `, [familyId, userId]),
      tx.query(
        'SELECT allergen_code FROM user_allergens WHERE family_id=$1 AND user_id=$2 ORDER BY allergen_code',
        [familyId, userId]
      ),
      tx.query(
        'SELECT tag_code FROM user_diet_tags WHERE family_id=$1 AND user_id=$2 ORDER BY tag_code',
        [familyId, userId]
      )
    ]);

    return {
      spiciness_preference: pref ? pref.spiciness_preference : null,
      disliked_ingredients: disliked.rows,
      allergens: allergens.rows.map(r => r.allergen_code),
      diet_tags: dietTags.rows.map(r => r.tag_code),
      notes: pref ? pref.notes : null
    };
  }

  // GET current user's preferences in this family
  async function getPreferences(familyId, userId) {
    return access(familyId, userId, null, false, async tx => {
      return _fetchPreferences(tx, familyId, userId);
    });
  }

  // PATCH — full-replace fields that are present in body
  async function updatePreferences(familyId, userId, body) {
    return access(familyId, userId, null, true, async tx => {
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new ApiError(400, 'INVALID_REQUEST', '请求体必须是对象');
      }

      const allowedKeys = ['spiciness_preference', 'disliked_ingredient_ids', 'allergens', 'diet_tags', 'notes'];
      const extraKeys = Object.keys(body).filter(k => !allowedKeys.includes(k));
      if (extraKeys.length > 0) {
        throw new ApiError(400, 'INVALID_REQUEST', `不允许的字段: ${extraKeys.join(', ')}`);
      }

      // Upsert user_preferences row
      const spiciness = body.spiciness_preference !== undefined ? validateSpiciness(body.spiciness_preference) : undefined;
      const notes = body.notes !== undefined ? (body.notes == null ? null : String(body.notes).slice(0, 500)) : undefined;

      // Ensure row exists
      await tx.query(`
        INSERT INTO user_preferences (family_id, user_id) VALUES ($1, $2)
        ON CONFLICT (family_id, user_id) DO NOTHING
      `, [familyId, userId]);

      // Targeted UPDATE — explicit null overwrites, omitted fields unchanged
      const setParts = ['updated_at = now()'];
      const params = [];
      if (spiciness !== undefined) {
        params.push(spiciness);
        setParts.push(`spiciness_preference = $${params.length}`);
      }
      if (notes !== undefined) {
        params.push(notes);
        setParts.push(`notes = $${params.length}`);
      }
      if (setParts.length > 1) {
        params.push(familyId, userId);
        await tx.query(`
          UPDATE user_preferences SET ${setParts.join(', ')}
          WHERE family_id = $${params.length - 1} AND user_id = $${params.length}
        `, params);
      }

      // Full-replace disliked ingredients
      if (body.disliked_ingredient_ids !== undefined) {
        const validIds = await validateIngredientIds(tx, body.disliked_ingredient_ids);
        await tx.query('DELETE FROM user_disliked_ingredients WHERE family_id=$1 AND user_id=$2', [familyId, userId]);
        for (const ingId of validIds) {
          await tx.query(
            'INSERT INTO user_disliked_ingredients (family_id, user_id, ingredient_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
            [familyId, userId, ingId]
          );
        }
      }

      // Full-replace allergens
      if (body.allergens !== undefined) {
        const clean = validateAllergens(body.allergens);
        await tx.query('DELETE FROM user_allergens WHERE family_id=$1 AND user_id=$2', [familyId, userId]);
        for (const code of clean) {
          await tx.query(
            'INSERT INTO user_allergens (family_id, user_id, allergen_code) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
            [familyId, userId, code]
          );
        }
      }

      // Full-replace diet tags
      if (body.diet_tags !== undefined) {
        const clean = validateDietTags(body.diet_tags);
        await tx.query('DELETE FROM user_diet_tags WHERE family_id=$1 AND user_id=$2', [familyId, userId]);
        for (const code of clean) {
          await tx.query(
            'INSERT INTO user_diet_tags (family_id, user_id, tag_code) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
            [familyId, userId, code]
          );
        }
      }

      return _fetchPreferences(tx, familyId, userId);
    });
  }

  return { getPreferences, updatePreferences };
}

module.exports = { createPreferenceService };
