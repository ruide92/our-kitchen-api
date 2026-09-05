const { randomUUID } = require('node:crypto');
const { withTransaction } = require('./db');
const { ApiError } = require('./errors');
const { authorize, forbidden } = require('./family-access');

function createRecipeService(pool) {
  async function access(familyId, userId, roles, write, work) {
    return withTransaction(pool, async tx => {
      const family = (await tx.query(`SELECT id FROM families WHERE id=$1 AND deleted_at IS NULL${write ? ' FOR UPDATE' : ' FOR SHARE'}`, [familyId])).rows[0];
      if (!family) throw forbidden();
      await authorize(tx, familyId, userId, roles);
      return work(tx);
    });
  }

  async function loadRecipeExtras(tx, recipeId, familyId, userId) {
    const [mealTypes, tags, cookware, allergens, ingredients, steps, media, fav] = await Promise.all([
      tx.query('SELECT meal_type FROM recipe_meal_types WHERE recipe_id=$1', [recipeId]),
      tx.query('SELECT tag_code FROM recipe_tags WHERE recipe_id=$1', [recipeId]),
      tx.query('SELECT cookware_code FROM recipe_cookware WHERE recipe_id=$1', [recipeId]),
      tx.query('SELECT allergen_code FROM recipe_allergens WHERE recipe_id=$1', [recipeId]),
      tx.query('SELECT ri.*, i.display_name as ingredient_name, i.canonical_code FROM recipe_ingredients ri LEFT JOIN ingredients i ON i.id=ri.ingredient_id WHERE ri.recipe_id=$1 ORDER BY ri.sort_order, ri.id', [recipeId]),
      tx.query('SELECT * FROM recipe_steps WHERE recipe_id=$1 ORDER BY step_no', [recipeId]),
      tx.query('SELECT * FROM recipe_media WHERE recipe_id=$1 ORDER BY sort_order', [recipeId]),
      tx.query('SELECT 1 FROM recipe_favorites WHERE user_id=$1 AND recipe_id=$2', [userId, recipeId])
    ]);
    return {
      meal_types: mealTypes.rows.map(r => r.meal_type),
      tags: tags.rows.map(r => r.tag_code),
      cookware: cookware.rows.map(r => r.cookware_code),
      allergens: allergens.rows.map(r => r.allergen_code),
      ingredients: ingredients.rows,
      steps: steps.rows,
      media: media.rows,
      is_favorite: fav.rows.length > 0
    };
  }

  function recipeRow(row, extras) {
    if (!row) return null;
    const base = {
      id: row.id, kind: row.kind, family_id: row.family_id, parent_recipe_id: row.parent_recipe_id,
      name: row.name, description: row.description, category_code: row.category_code,
      cuisine_code: row.cuisine_code, base_servings: row.base_servings,
      cook_time_minutes: row.cook_time_minutes, difficulty: row.difficulty,
      spiciness: row.spiciness, sweetness: row.sweetness, saltiness: row.saltiness,
      sourness: row.sourness, oiliness: row.oiliness,
      cooking_method_code: row.cooking_method_code, protein_source_code: row.protein_source_code,
      suggested_kiss: row.suggested_kiss, visibility: row.visibility,
      source_type: row.source_type, version: row.version,
      has_family_variant: row.has_family_variant || false,
      family_variant_id: row.family_variant_id || null,
    };
    if (extras) Object.assign(base, extras);
    return base;
  }

  // listRecipes: only BASE + current family's FAMILY. Strict family isolation.
  async function listRecipes(familyId, userId, query) {
    return access(familyId, userId, null, false, async tx => {
      // Core isolation: BASE OR (FAMILY AND family_id = current family)
      const conditions = [
        'r.deleted_at IS NULL',
        '(r.kind = \'BASE\' OR (r.kind = \'FAMILY\' AND r.family_id = $1))'
      ];
      const params = [familyId];
      let paramIdx = 2;

      if (query.scope === 'BASE') {
        conditions.push('r.kind = $' + paramIdx);
        params.push('BASE');
        paramIdx++;
      } else if (query.scope === 'FAMILY') {
        conditions.push('r.kind = $' + paramIdx);
        params.push('FAMILY');
        paramIdx++;
      }
      if (query.category) {
        conditions.push('r.category_code = $' + paramIdx);
        params.push(query.category);
        paramIdx++;
      }
      if (query.keyword) {
        conditions.push('r.name ILIKE $' + paramIdx);
        params.push('%' + query.keyword + '%');
        paramIdx++;
      }
      if (query.favorite === 'true') {
        conditions.push('EXISTS(SELECT 1 FROM recipe_favorites fav WHERE fav.user_id = $' + paramIdx + ' AND fav.recipe_id = r.id)');
        params.push(userId);
        paramIdx++;
      }

      const userIdParam = paramIdx;
      params.push(userId);

      const sql = `
        SELECT r.*,
          EXISTS(SELECT 1 FROM recipes fv WHERE fv.parent_recipe_id = r.id AND fv.family_id = $1 AND fv.deleted_at IS NULL) AS has_family_variant,
          (SELECT fv.id FROM recipes fv WHERE fv.parent_recipe_id = r.id AND fv.family_id = $1 AND fv.deleted_at IS NULL LIMIT 1) AS family_variant_id,
          EXISTS(SELECT 1 FROM recipe_favorites fav WHERE fav.user_id = $${userIdParam} AND fav.recipe_id = r.id) AS is_favorite,
          (SELECT rm.asset_url FROM recipe_media rm WHERE rm.recipe_id = r.id AND rm.media_type = 'COVER_IMAGE' ORDER BY rm.sort_order LIMIT 1) AS cover_image_url
        FROM recipes r
        WHERE ${conditions.join(' AND ')}
        ORDER BY r.name
        LIMIT 200
      `;
      const rows = (await tx.query(sql, params)).rows;
      return rows.map(r => recipeRow(r, { is_favorite: r.is_favorite, cover_image_url: r.cover_image_url }));
    });
  }

  async function getRecipe(familyId, userId, recipeId) {
    return access(familyId, userId, null, false, async tx => {
      const recipe = (await tx.query('SELECT * FROM recipes WHERE id=$1 AND deleted_at IS NULL', [recipeId])).rows[0];
      if (!recipe) throw new ApiError(404, 'NOT_FOUND', '菜谱不存在');
      // Family isolation: BASE accessible, FAMILY only if same family
      if (recipe.kind === 'FAMILY' && recipe.family_id !== familyId) throw forbidden();
      const extras = await loadRecipeExtras(tx, recipeId, familyId, userId);
      // Cover image from recipe_media
      const coverMedia = extras.media.find(m => m.media_type === 'COVER_IMAGE');
      // recipe only contains its own fields + summary, NOT ingredients/steps/media
      const baseRecipe = recipeRow(recipe, { is_favorite: extras.is_favorite });
      return {
        recipe: { ...baseRecipe, cover_image_url: coverMedia ? coverMedia.asset_url : null },
        ingredients: extras.ingredients,
        steps: extras.steps,
        media: extras.media,
        nutrition: null,
        inventory_summary: null,
        viewer: {
          is_favorite: extras.is_favorite,
          rating: null,
          wish_status: null
        }
      };
    });
  }

  async function createRecipe(familyId, userId, body) {
    return access(familyId, userId, null, true, async tx => {
      const id = randomUUID();
      const r = (await tx.query(`INSERT INTO recipes(id,kind,family_id,parent_recipe_id,source_type,name,description,category_code,cuisine_code,base_servings,cook_time_minutes,difficulty,spiciness,sweetness,saltiness,sourness,oiliness,cooking_method_code,protein_source_code,suggested_kiss,visibility,created_by_user_id,updated_by_user_id,version)
        VALUES($1,'FAMILY',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'FAMILY',$20,$20,1) RETURNING *`,
        [id, familyId, body.parent_recipe_id || null, body.source_type || 'MANUAL',
         body.name, body.description || null, body.category_code || 'HOT_DISH', body.cuisine_code || null,
         body.base_servings || 2, body.cook_time_minutes || null, body.difficulty || null,
         body.spiciness || null, body.sweetness || null, body.saltiness || null,
         body.sourness || null, body.oiliness || null, body.cooking_method_code || null,
         body.protein_source_code || null, body.suggested_kiss || null, userId])).rows[0];
      // meal types
      for (const mt of body.meal_types || ['LUNCH','DINNER']) {
        await tx.query('INSERT INTO recipe_meal_types (recipe_id, meal_type) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, mt]);
      }
      // ingredients
      if (body.ingredients && Array.isArray(body.ingredients)) {
        let sortOrder = 0;
        for (const ing of body.ingredients) {
          await tx.query(`INSERT INTO recipe_ingredients (recipe_id, ingredient_id, display_name_override, quantity, quantity_text, unit_code, type, required, sort_order, note)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [id, ing.ingredient_id || null, ing.display_name_override || ing.name, ing.quantity || null,
             ing.quantity_text || null, ing.unit_code || null, ing.type || 'MAIN',
             ing.required === false ? false : true, sortOrder++, ing.note || null]);
        }
      }
      // tags
      if (body.tags && Array.isArray(body.tags)) {
        for (const tag of body.tags) {
          await tx.query('INSERT INTO recipe_tags (recipe_id, tag_code) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, tag]);
        }
      }
      // cookware
      if (body.cookware && Array.isArray(body.cookware)) {
        for (const cw of body.cookware) {
          await tx.query('INSERT INTO recipe_cookware (recipe_id, cookware_code) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, cw]);
        }
      }
      // allergens
      if (body.allergens && Array.isArray(body.allergens)) {
        for (const al of body.allergens) {
          await tx.query('INSERT INTO recipe_allergens (recipe_id, allergen_code) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, al]);
        }
      }
      // steps
      if (body.steps && Array.isArray(body.steps)) {
        let stepOrder = 0;
        for (const step of body.steps) {
          await tx.query(`INSERT INTO recipe_steps (id, recipe_id, step_no, operation, duration_seconds)
            VALUES ($1,$2,$3,$4,$5)`,
            [randomUUID(), id, stepOrder++, step.instruction || step.operation || '', step.duration_seconds || (step.duration_minutes ? step.duration_minutes * 60 : null)]);
        }
      }
      // media
      if (body.media && Array.isArray(body.media)) {
        for (const m of body.media) {
          await tx.query(`INSERT INTO recipe_media (id, recipe_id, media_type, asset_url, sort_order)
            VALUES ($1,$2,$3,$4,$5)`,
            [randomUUID(), id, m.media_type || 'IMAGE', m.url || m.asset_url, m.sort_order || 0]);
        }
      }
      const extras = await loadRecipeExtras(tx, id, familyId, userId);
      return recipeRow(r, extras);
    });
  }

  async function setFavorite(familyId, userId, recipeId, isFavorite) {
    return access(familyId, userId, null, true, async tx => {
      // Verify recipe accessibility
      const recipe = (await tx.query('SELECT id, kind, family_id FROM recipes WHERE id=$1 AND deleted_at IS NULL', [recipeId])).rows[0];
      if (!recipe) throw new ApiError(404, 'NOT_FOUND', '菜谱不存在');
      if (recipe.kind === 'FAMILY' && recipe.family_id !== familyId) throw forbidden();

      if (isFavorite) {
        await tx.query('INSERT INTO recipe_favorites (user_id, recipe_id) VALUES ($1,$2) ON CONFLICT (user_id, recipe_id) DO NOTHING', [userId, recipeId]);
      } else {
        await tx.query('DELETE FROM recipe_favorites WHERE user_id=$1 AND recipe_id=$2', [userId, recipeId]);
      }
      return { recipe_id: recipeId, is_favorite: isFavorite };
    });
  }

  async function listFavorites(familyId, userId) {
    return access(familyId, userId, null, false, async tx => {
      const rows = (await tx.query(`
        SELECT r.*, rf.created_at as favorited_at
        FROM recipe_favorites rf
        JOIN recipes r ON r.id = rf.recipe_id
        WHERE rf.user_id = $1 AND r.deleted_at IS NULL
          AND (r.kind='BASE' OR (r.kind='FAMILY' AND r.family_id=$2))
        ORDER BY rf.created_at DESC
      `, [userId, familyId])).rows;
      return rows;
    });
  }

  async function setRating(familyId, userId, recipeId, rating, mealId) {
    return access(familyId, userId, null, true, async tx => {
      if (!rating || rating < 1 || rating > 5) throw new ApiError(400, 'INVALID_RATING', '评分必须 1-5');
      const recipe = (await tx.query('SELECT id FROM recipes WHERE id=$1 AND deleted_at IS NULL', [recipeId])).rows[0];
      if (!recipe) throw new ApiError(404, 'NOT_FOUND', '菜谱不存在');

      const existing = (await tx.query('SELECT id FROM recipe_ratings WHERE user_id=$1 AND recipe_id=$2', [userId, recipeId])).rows[0];
      if (existing) {
        await tx.query('UPDATE recipe_ratings SET rating=$1, meal_id=$2, updated_at=now() WHERE id=$3', [rating, mealId || null, existing.id]);
      } else {
        await tx.query('INSERT INTO recipe_ratings(family_id,user_id,recipe_id,meal_id,rating) VALUES($1,$2,$3,$4,$5)', [familyId, userId, recipeId, mealId || null, rating]);
      }
      return { recipe_id: recipeId, rating };
    });
  }

  async function listRatings(familyId, userId) {
    return access(familyId, userId, null, false, async tx => {
      const rows = (await tx.query(`
        SELECT rr.*, r.name as recipe_name, r.cover_image_url
        FROM recipe_ratings rr
        JOIN recipes r ON r.id = rr.recipe_id
        WHERE rr.user_id = $1 AND rr.family_id = $2
        ORDER BY rr.updated_at DESC
      `, [userId, familyId])).rows;
      return rows;
    });
  }

  async function getUserStats(familyId, userId) {
    return access(familyId, userId, null, false, async tx => {
      const favCount = (await tx.query('SELECT COUNT(*) as cnt FROM recipe_favorites WHERE user_id=$1', [userId])).rows[0].cnt;
      const ratingCount = (await tx.query('SELECT COUNT(*) as cnt FROM recipe_ratings WHERE user_id=$1 AND family_id=$2', [userId, familyId])).rows[0].cnt;
      const cookedCount = (await tx.query(`SELECT COUNT(DISTINCT m.id) as cnt FROM meals m
        JOIN meal_items mi ON mi.meal_id = m.id
        WHERE m.family_id=$1 AND m.status IN ('CONFIRMED','COOKING','COMPLETED')
          AND mi.selected_by_user_id=$2`, [familyId, userId])).rows[0].cnt;
      const kissCount = (await tx.query('SELECT COALESCE(SUM(actual_amount),0) as cnt FROM kiss_ledger WHERE to_user_id=$1 AND family_id=$2', [userId, familyId])).rows[0].cnt;
      return {
        favorites: parseInt(favCount),
        ratings: parseInt(ratingCount),
        cooked: parseInt(cookedCount),
        kisses_received: parseInt(kissCount)
      };
    });
  }

  return { listRecipes, getRecipe, createRecipe, setFavorite, listFavorites, setRating, listRatings, getUserStats };
}

module.exports = { createRecipeService };
