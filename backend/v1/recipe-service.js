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

  function recipeRow(row) {
    if (!row) return null;
    return {
      id: row.id, kind: row.kind, family_id: row.family_id, parent_recipe_id: row.parent_recipe_id,
      name: row.name, description: row.description, category_code: row.category_code,
      cuisine_code: row.cuisine_code, meal_types: row.meal_types, base_servings: row.base_servings,
      cook_time_minutes: row.cook_time_minutes, difficulty: row.difficulty,
      spiciness: row.spiciness, sweetness: row.sweetness, saltiness: row.saltiness,
      sourness: row.sourness, oiliness: row.oiliness, cookware: row.cookware,
      cooking_method_code: row.cooking_method_code, suggested_kiss: row.suggested_kiss,
      tags: row.tags, allergens: row.allergens, cover_image_url: row.cover_image_url,
      source_type: row.source_type, version: row.version,
      has_family_variant: row.has_family_variant || false,
      family_variant_id: row.family_variant_id || null,
      is_favorite: row.is_favorite || false
    };
  }

  async function listRecipes(familyId, userId, query) {
    return access(familyId, userId, null, false, async tx => {
      const conditions = ['r.deleted_at IS NULL'];
      const params = [];
      let paramIdx = 1;
      if (query.scope === 'BASE') conditions.push('r.kind = $' + (paramIdx++));
      else if (query.scope === 'FAMILY') { conditions.push('r.kind = $' + (paramIdx++)); params.push('FAMILY'); }
      if (query.category) { conditions.push('r.category_code = $' + (paramIdx++)); params.push(query.category); }
      if (query.keyword) { conditions.push('r.name ILIKE $' + (paramIdx++)); params.push('%' + query.keyword + '%'); }
      if (query.favorite === 'true') conditions.push('f.recipe_id IS NOT NULL');
      const sql = `
        SELECT r.*,
          EXISTS(SELECT 1 FROM recipes fv WHERE fv.parent_recipe_id = r.id AND fv.family_id = $1 AND fv.deleted_at IS NULL) AS has_family_variant,
          (SELECT fv.id FROM recipes fv WHERE fv.parent_recipe_id = r.id AND fv.family_id = $1 AND fv.deleted_at IS NULL LIMIT 1) AS family_variant_id,
          EXISTS(SELECT 1 FROM recipe_favorites fav WHERE fav.family_id = $1 AND fav.user_id = $2 AND fav.recipe_id = r.id) AS is_favorite
        FROM recipes r
        LEFT JOIN recipe_favorites f ON f.family_id = $1 AND f.user_id = $2 AND f.recipe_id = r.id
        WHERE ${conditions.join(' AND ')}
        ORDER BY r.name
        LIMIT 200
      `;
      const rows = (await tx.query(sql, [familyId, userId, ...params])).rows;
      return rows.map(recipeRow);
    });
  }

  async function getRecipe(familyId, userId, recipeId) {
    return access(familyId, userId, null, false, async tx => {
      const recipe = (await tx.query('SELECT * FROM recipes WHERE id=$1 AND deleted_at IS NULL', [recipeId])).rows[0];
      if (!recipe) throw new ApiError(404, 'NOT_FOUND', '菜谱不存在');
      if (recipe.kind === 'FAMILY' && recipe.family_id !== familyId) throw forbidden();
      const ingredients = (await tx.query('SELECT * FROM recipe_ingredients WHERE recipe_id=$1 ORDER BY sort_order,id', [recipeId])).rows;
      const steps = (await tx.query('SELECT * FROM recipe_steps WHERE recipe_id=$1 ORDER BY step_no', [recipeId])).rows;
      return { recipe: recipeRow(recipe), ingredients, steps };
    });
  }

  async function createRecipe(familyId, userId, body) {
    return access(familyId, userId, null, true, async tx => {
      const id = randomUUID();
      const r = (await tx.query(`INSERT INTO recipes(id,kind,family_id,name,description,category_code,cuisine_code,meal_types,base_servings,cook_time_minutes,difficulty,spiciness,sweetness,saltiness,sourness,oiliness,cookware,cooking_method_code,suggested_kiss,tags,allergens,cover_image_url,source_type)
        VALUES($1,'FAMILY',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'MANUAL') RETURNING *`,
        [id, familyId, body.name, body.description || null, body.category_code || 'HOT_DISH', body.cuisine_code || null,
         body.meal_types || ['LUNCH', 'DINNER'], body.base_servings || 2, body.cook_time_minutes || null,
         body.difficulty || null, body.spiciness || null, body.sweetness || null, body.saltiness || null,
         body.sourness || null, body.oiliness || null, body.cookware || [], body.cooking_method_code || null,
         body.suggested_kiss || null, body.tags || [], body.allergens || [], body.cover_image_url || null])).rows[0];
      if (body.ingredients) {
        for (let i = 0; i < body.ingredients.length; i++) {
          const ing = body.ingredients[i];
          await tx.query(`INSERT INTO recipe_ingredients(id,recipe_id,ingredient_id,name,quantity,quantity_text,unit_code,type,required,alternatives,note,sort_order)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [randomUUID(), id, ing.ingredient_id || null, ing.name, ing.quantity || null, ing.quantity_text || null,
             ing.unit_code || null, ing.type || 'MAIN', ing.required !== false, ing.alternatives || [], ing.note || null, i]);
        }
      }
      if (body.steps) {
        for (const step of body.steps) {
          await tx.query(`INSERT INTO recipe_steps(id,recipe_id,step_no,title,operation,duration_seconds,duration_text,heat_code,doneness_cue,tip,media)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [randomUUID(), id, step.step_no, step.title || null, step.operation, step.duration_seconds || null,
             step.duration_text || null, step.heat_code || 'NO_HEAT', step.doneness_cue || null, step.tip || null, step.media || []]);
        }
      }
      return recipeRow(r);
    });
  }

  async function setFavorite(familyId, userId, recipeId, favorite) {
    return access(familyId, userId, null, true, async tx => {
      if (favorite) {
        await tx.query('INSERT INTO recipe_favorites(family_id,user_id,recipe_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [familyId, userId, recipeId]);
      } else {
        await tx.query('DELETE FROM recipe_favorites WHERE family_id=$1 AND user_id=$2 AND recipe_id=$3', [familyId, userId, recipeId]);
      }
      return { ok: true };
    });
  }

  return { listRecipes, getRecipe, createRecipe, setFavorite };
}

module.exports = { createRecipeService };
