const { withTransaction } = require('./db');
const { ApiError } = require('./errors');
const { authorize, forbidden } = require('./family-access');

function createFamilyPreferenceService(pool) {
  async function access(familyId, userId, roles, write, work) {
    return withTransaction(pool, async tx => {
      const family = (await tx.query(`SELECT id FROM families WHERE id=$1 AND deleted_at IS NULL${write ? ' FOR UPDATE' : ' FOR SHARE'}`, [familyId])).rows[0];
      if (!family) throw forbidden();
      await authorize(tx, familyId, userId, roles);
      return work(tx);
    });
  }

  async function getFamilyPreferences(familyId, userId) {
    return access(familyId, userId, null, false, async tx => {
      // Active family members
      const members = (await tx.query(`
        SELECT fm.user_id, u.nickname, u.avatar_url
        FROM family_members fm
        JOIN users u ON u.id = fm.user_id
        WHERE fm.family_id = $1 AND fm.status = 'ACTIVE'
      `, [familyId])).rows;

      const memberIds = members.map(m => m.user_id);
      if (memberIds.length === 0) return { recipes: [] };

      // Favorites per recipe (join family_members for family isolation)
      const favRows = (await tx.query(`
        SELECT rf.recipe_id, rf.user_id, COUNT(*) as cnt
        FROM recipe_favorites rf
        JOIN family_members fm ON fm.user_id = rf.user_id AND fm.family_id = $1 AND fm.status = 'ACTIVE'
        JOIN recipes r ON r.id = rf.recipe_id AND r.deleted_at IS NULL
        WHERE (r.kind = 'BASE' OR (r.kind = 'FAMILY' AND r.family_id = $1))
        GROUP BY rf.recipe_id, rf.user_id
      `, [familyId])).rows;

      // Ratings per recipe (general only, meal_id IS NULL)
      const ratingRows = (await tx.query(`
        SELECT rr.recipe_id, rr.user_id, rr.rating
        FROM recipe_ratings rr
        JOIN recipes r ON r.id = rr.recipe_id AND r.deleted_at IS NULL
        WHERE rr.family_id = $1 AND rr.meal_id IS NULL
          AND (r.kind = 'BASE' OR (r.kind = 'FAMILY' AND r.family_id = $1))
      `, [familyId])).rows;

      // Active wishes per recipe
      const wishRows = (await tx.query(`
        SELECT w.recipe_id, w.user_id, COUNT(*) as cnt
        FROM wishes w
        JOIN recipes r ON r.id = w.recipe_id AND r.deleted_at IS NULL
        WHERE w.family_id = $1 AND w.status = 'ACTIVE'
          AND (r.kind = 'BASE' OR (r.kind = 'FAMILY' AND r.family_id = $1))
        GROUP BY w.recipe_id, w.user_id
      `, [familyId])).rows;

      // Completed meal history per recipe
      const mealRows = (await tx.query(`
        SELECT mi.recipe_id, COUNT(DISTINCT m.id) as meal_count
        FROM meal_items mi
        JOIN meals m ON m.id = mi.meal_id AND m.family_id = $1 AND m.status = 'COMPLETED'
        JOIN recipes r ON r.id = mi.recipe_id AND r.deleted_at IS NULL
        WHERE (r.kind = 'BASE' OR (r.kind = 'FAMILY' AND r.family_id = $1))
        GROUP BY mi.recipe_id
      `, [familyId])).rows;

      // Aggregate by recipe
      const recipeMap = new Map();

      function getRecipe(recipeId) {
        if (!recipeMap.has(recipeId)) {
          recipeMap.set(recipeId, {
            recipe_id: recipeId,
            favorite_users: new Set(),
            rating_users: new Map(), // user_id -> rating
            wish_users: new Set(),
            meal_count: 0,
          });
        }
        return recipeMap.get(recipeId);
      }

      for (const row of favRows) {
        getRecipe(row.recipe_id).favorite_users.add(row.user_id);
      }
      for (const row of ratingRows) {
        getRecipe(row.recipe_id).rating_users.set(row.user_id, row.rating);
      }
      for (const row of wishRows) {
        getRecipe(row.recipe_id).wish_users.add(row.user_id);
      }
      for (const row of mealRows) {
        getRecipe(row.recipe_id).meal_count = parseInt(row.meal_count, 10);
      }

      // Get recipe names
      const recipeIds = Array.from(recipeMap.keys());
      let recipeNames = new Map();
      if (recipeIds.length > 0) {
        const nameRows = (await tx.query(
          `SELECT id, name FROM recipes WHERE id = ANY($1)`,
          [recipeIds]
        )).rows;
        recipeNames = new Map(nameRows.map(r => [r.id, r.name]));
      }

      // Build member lookup
      const memberMap = new Map(members.map(m => [m.user_id, m]));

      // Build result
      const recipes = [];
      for (const [recipeId, data] of recipeMap.entries()) {
        const favoriteCount = data.favorite_users.size;
        const ratingValues = Array.from(data.rating_users.values());
        const avgRating = ratingValues.length > 0
          ? ratingValues.reduce((a, b) => a + b, 0) / ratingValues.length
          : 0;
        const wishCount = data.wish_users.size;
        const mealCount = data.meal_count;

        const familyScore = favoriteCount * 5 + avgRating * 3 + wishCount * 4 + mealCount * 2;

        // Reasons
        const reasons = [];
        if (favoriteCount > 0) {
          reasons.push({ code: 'FAVORITE_COUNT', text: `${favoriteCount}位家庭成员收藏` });
        }
        if (ratingValues.length > 0) {
          const topRating = Math.max(...ratingValues);
          const topUser = Array.from(data.rating_users.entries()).find(([, r]) => r === topRating)?.[0];
          const topName = memberMap.get(topUser)?.nickname || '家人';
          reasons.push({ code: 'RATING_HIGH', text: `${topName}评分${topRating}分` });
        }
        if (wishCount > 0) {
          reasons.push({ code: 'WISH_COUNT', text: `${wishCount}人想吃` });
        }
        if (mealCount > 0) {
          reasons.push({ code: 'MEAL_HISTORY', text: `最近做过${mealCount}次` });
        }

        // Members with signals
        const recipeMembers = [];
        const allSignalUsers = new Set([
          ...data.favorite_users,
          ...data.rating_users.keys(),
          ...data.wish_users,
        ]);
        for (const uid of allSignalUsers) {
          const m = memberMap.get(uid);
          if (!m) continue;
          const signals = [];
          if (data.favorite_users.has(uid)) signals.push('FAVORITE');
          if (data.rating_users.has(uid)) signals.push('RATING');
          if (data.wish_users.has(uid)) signals.push('WISH');
          recipeMembers.push({
            user_id: uid,
            display_name: m.nickname,
            signals,
          });
        }

        recipes.push({
          recipe_id: recipeId,
          recipe_name: recipeNames.get(recipeId) || '未知菜谱',
          cover_image: null,
          family_score: Math.round(familyScore * 10) / 10,
          reasons,
          members: recipeMembers,
        });
      }

      // Sort by family_score desc, then recipe_name for stability
      recipes.sort((a, b) => {
        if (b.family_score !== a.family_score) return b.family_score - a.family_score;
        return a.recipe_name.localeCompare(b.recipe_name, 'zh-CN');
      });

      return { recipes };
    });
  }

  return { getFamilyPreferences };
}

module.exports = { createFamilyPreferenceService };
