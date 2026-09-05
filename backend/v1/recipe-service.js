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
    const [mealTypes, tags, cookware, allergens, ingredients, steps, fav] = await Promise.all([
      tx.query('SELECT meal_type FROM recipe_meal_types WHERE recipe_id=$1', [recipeId]),
      tx.query('SELECT tag_code FROM recipe_tags WHERE recipe_id=$1', [recipeId]),
      tx.query('SELECT cookware_code FROM recipe_cookware WHERE recipe_id=$1', [recipeId]),
      tx.query('SELECT allergen_code FROM recipe_allergens WHERE recipe_id=$1', [recipeId]),
      tx.query('SELECT ri.*, i.display_name as ingredient_name, i.canonical_code FROM recipe_ingredients ri LEFT JOIN ingredients i ON i.id=ri.ingredient_id WHERE ri.recipe_id=$1 ORDER BY ri.sort_order, ri.id', [recipeId]),
      tx.query('SELECT * FROM recipe_steps WHERE recipe_id=$1 ORDER BY step_no', [recipeId]),
      tx.query('SELECT 1 FROM recipe_favorites WHERE user_id=$1 AND recipe_id=$2', [userId, recipeId])
    ]);
    return {
      meal_types: mealTypes.rows.map(r => r.meal_type),
      tags: tags.rows.map(r => r.tag_code),
      cookware: cookware.rows.map(r => r.cookware_code),
      allergens: allergens.rows.map(r => r.allergen_code),
      ingredients: ingredients.rows,
      steps: steps.rows,
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
          EXISTS(SELECT 1 FROM recipe_favorites fav WHERE fav.user_id = $${userIdParam} AND fav.recipe_id = r.id) AS is_favorite
        FROM recipes r
        WHERE ${conditions.join(' AND ')}
        ORDER BY r.name
        LIMIT 200
      `;
      const rows = (await tx.query(sql, params)).rows;
      return rows.map(r => recipeRow(r, { is_favorite: r.is_favorite }));
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
      const baseRecipe = recipeRow(recipe, extras);
      return {
        recipe: { ...baseRecipe, cover_image_url: coverMedia ? coverMedia.url : null },
        ingredients: extras.ingredients,
        steps: extras.steps,
        media: extras.media,
        nutrition: null,
        inventory_summary: null,
        viewer: {
          is_favorite: extras.is_favorite,
          rating: null,
          wish_status: 'UNKNOWN'
        }
      };
    });
  }

  async function createRecipe(familyId, userId, body) {
    return access(familyId, userId, null, true, async tx => {
      const id = randomUUID();
      const r = (await tx.query(`INSERT INTO recipes(id,kind,family_id,parent_recipe_id,source_type,name,description,category_code,cuisine_code,base_servings,cook_time_minutes,difficulty,spiciness,visibility,created_by_user_id,updated_by_user_id,version)
        VALUES($1,'FAMILY',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'FAMILY',$13,$13,1) RETURNING *`,
        [id, familyId, body.parent_recipe_id || null, body.source_type || 'MANUAL',
         body.name, body.description || null, body.category_code || 'HOT_DISH', body.cuisine_code || null,
         body.base_servings || 2, body.cook_time_minutes || null, body.difficulty || null,
         body.spiciness || null, userId])).rows[0];
      // meal types
      for (const mt of body.meal_types || ['LUNCH','DINNER']) {
        await tx.query('INSERT INTO recipe_meal_types (recipe_id, meal_type) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, mt]);
      }
      // ingredients
      if (body.ingredients && Array.isArray(body.ingredients)) {
        let sortOrder = 0;
        for (const ing of body.ingredients) {
          await tx.query(`INSERT INTO recipe_ingredients (recipe_id, ingredient_id, display_name_override, quantity, quantity_text, unit_code, type, required, sort_order, note)
            VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9)`,
            [id, ing.ingredient_id || null, ing.display_name_override || ing.name, ing.quantity || null,
             ing.quantity_text || null, ing.unit_code || null, ing.type || 'MAIN', sortOrder++, ing.note || null]);
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
          await tx.query(`INSERT INTO recipe_steps (id, recipe_id, step_order, instruction, duration_minutes)
            VALUES ($1,$2,$3,$4,$5)`,
            [randomUUID(), id, stepOrder++, step.instruction || '', step.duration_minutes || null]);
        }
      }
      // media
      if (body.media && Array.isArray(body.media)) {
        for (const m of body.media) {
          await tx.query(`INSERT INTO recipe_media (id, recipe_id, media_type, url, sort_order)
            VALUES ($1,$2,$3,$4,$5)`,
            [randomUUID(), id, m.media_type || 'IMAGE', m.url, m.sort_order || 0]);
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

  return { listRecipes, getRecipe, createRecipe, setFavorite };
}

module.exports = { createRecipeService };
