const { ApiError } = require('./errors');
const { authorize, forbidden } = require('./family-access');

function createIngredientService(pool) {
  async function searchIngredients(keyword) {
    if (!keyword || keyword.trim().length < 1) {
      throw new ApiError(400, 'INVALID_REQUEST', '需要搜索关键词');
    }
    const kw = `%${keyword.trim()}%`;
    // Search canonical ingredients + aliases
    const rows = (await pool.query(`
      SELECT DISTINCT i.id, i.canonical_code, i.display_name, i.category_code, i.default_unit_code,
             CASE WHEN ia.normalized_alias IS NOT NULL THEN true ELSE false END as matched_via_alias
      FROM ingredients i
      LEFT JOIN ingredient_aliases ia ON ia.ingredient_id = i.id
      WHERE i.display_name ILIKE $1 OR i.canonical_code ILIKE $1 OR ia.normalized_alias ILIKE $1
      ORDER BY i.display_name
      LIMIT 50
    `, [kw])).rows;
    return rows;
  }

  async function resolveIngredient(familyId, userId, body) {
    // Family membership check
    const member = (await pool.query('SELECT id FROM family_members WHERE family_id=$1 AND user_id=$2 AND status=$3', [familyId, userId, 'ACTIVE'])).rows[0];
    if (!member) throw forbidden();

    const name = (body.name || '').trim();
    if (!name) throw new ApiError(400, 'INVALID_REQUEST', '需要 name');

    // Exact alias match (normalized)
    const normalized = name.toLowerCase().replace(/\s+/g, '');
    const aliasMatch = (await pool.query(`
      SELECT i.*, 'ALIAS_EXACT' as match_type, 1.0 as confidence
      FROM ingredient_aliases ia
      JOIN ingredients i ON i.id = ia.ingredient_id
      WHERE ia.normalized_alias = $1
      LIMIT 1
    `, [normalized])).rows[0];

    if (aliasMatch) {
      return {
        match: { id: aliasMatch.id, canonical_code: aliasMatch.canonical_code, display_name: aliasMatch.display_name },
        confidence: 1.0,
        match_type: 'ALIAS_EXACT',
        candidates: []
      };
    }

    // Exact display name match
    const nameMatch = (await pool.query(`
      SELECT i.*, 'NAME_EXACT' as match_type, 0.95 as confidence
      FROM ingredients i
      WHERE LOWER(REPLACE(i.display_name, ' ', '')) = $1
      LIMIT 1
    `, [normalized])).rows[0];

    if (nameMatch) {
      return {
        match: { id: nameMatch.id, canonical_code: nameMatch.canonical_code, display_name: nameMatch.display_name },
        confidence: 0.95,
        match_type: 'NAME_EXACT',
        candidates: []
      };
    }

    // Fuzzy candidates (low confidence, needs confirmation)
    const candidates = (await pool.query(`
      SELECT i.id, i.canonical_code, i.display_name, 0.5 as confidence
      FROM ingredients i
      WHERE i.display_name ILIKE $1 OR i.canonical_code ILIKE $1
      LIMIT 5
    `, [`%${name}%`])).rows;

    return {
      match: null,
      confidence: 0,
      match_type: 'NONE',
      candidates,
      needs_confirmation: true
    };
  }

  return { searchIngredients, resolveIngredient };
}

module.exports = { createIngredientService };
