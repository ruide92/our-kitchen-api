const { randomUUID } = require('node:crypto');
const { withTransaction } = require('./db');
const { ApiError } = require('./errors');
const { authorize, forbidden } = require('./family-access');

function createMealService(pool) {
  async function access(familyId, userId, roles, write, work) {
    return withTransaction(pool, async tx => {
      const family = (await tx.query(`SELECT id FROM families WHERE id=$1 AND deleted_at IS NULL${write ? ' FOR UPDATE' : ' FOR SHARE'}`, [familyId])).rows[0];
      if (!family) throw forbidden();
      await authorize(tx, familyId, userId, roles);
      return work(tx);
    });
  }

  function mealItemRow(row) {
    if (!row) return null;
    return {
      id: row.id, meal_id: row.meal_id, recipe_id: row.recipe_id,
      recipe_name: row.recipe_name, recipe_image: row.recipe_image,
      servings: row.servings, source: row.source,
      selected_by_user_id: row.selected_by_user_id,
      selected_by_nickname: row.selected_by_nickname,
      locked: row.locked, created_at: row.created_at
    };
  }

  async function getCurrentMeal(familyId, userId, mealDate, mealType) {
    return access(familyId, userId, null, false, async tx => {
      const meal = (await tx.query('SELECT * FROM meals WHERE family_id=$1 AND meal_date=$2 AND meal_type=$3', [familyId, mealDate, mealType])).rows[0];
      if (!meal) return null;
      const items = (await tx.query(`
        SELECT mi.*, r.name AS recipe_name, r.cover_image_url AS recipe_image, u.nickname AS selected_by_nickname
        FROM meal_items mi
        JOIN recipes r ON r.id = mi.recipe_id
        LEFT JOIN users u ON u.id = mi.selected_by_user_id
        WHERE mi.meal_id=$1 ORDER BY mi.created_at`, [meal.id])).rows;
      return { ...meal, items: items.map(mealItemRow) };
    });
  }

  async function ensureCurrentMeal(familyId, userId, body) {
    return access(familyId, userId, null, true, async tx => {
      let meal = (await tx.query('SELECT * FROM meals WHERE family_id=$1 AND meal_date=$2 AND meal_type=$3 FOR UPDATE', [familyId, body.meal_date, body.meal_type])).rows[0];
      if (!meal) {
        meal = (await tx.query(`INSERT INTO meals(id,family_id,meal_date,meal_type,diners_count,source_weekly_plan_id,created_by_user_id)
          VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [randomUUID(), familyId, body.meal_date, body.meal_type, body.diners_count || 2, body.source_weekly_plan_id || null, userId])).rows[0];
      }
      const items = (await tx.query(`
        SELECT mi.*, r.name AS recipe_name, r.cover_image_url AS recipe_image, u.nickname AS selected_by_nickname
        FROM meal_items mi
        JOIN recipes r ON r.id = mi.recipe_id
        LEFT JOIN users u ON u.id = mi.selected_by_user_id
        WHERE mi.meal_id=$1 ORDER BY mi.created_at`, [meal.id])).rows;
      return { ...meal, items: items.map(mealItemRow) };
    });
  }

  async function getMeal(familyId, userId, mealId) {
    return access(familyId, userId, null, false, async tx => {
      const meal = (await tx.query('SELECT * FROM meals WHERE id=$1 AND family_id=$2', [mealId, familyId])).rows[0];
      if (!meal) throw new ApiError(404, 'NOT_FOUND', '本餐菜单不存在');
      const items = (await tx.query(`
        SELECT mi.*, r.name AS recipe_name, r.cover_image_url AS recipe_image, u.nickname AS selected_by_nickname
        FROM meal_items mi
        JOIN recipes r ON r.id = mi.recipe_id
        LEFT JOIN users u ON u.id = mi.selected_by_user_id
        WHERE mi.meal_id=$1 ORDER BY mi.created_at`, [mealId])).rows;
      return { ...meal, items: items.map(mealItemRow) };
    });
  }

  async function addMealItem(familyId, userId, mealId, body) {
    return access(familyId, userId, null, true, async tx => {
      const meal = (await tx.query('SELECT * FROM meals WHERE id=$1 AND family_id=$2 AND status=$3 FOR UPDATE', [mealId, familyId, 'PLANNING'])).rows[0];
      if (!meal) throw new ApiError(409, 'MEAL_NOT_EDITABLE', '当前餐次状态不可编辑');
      const recipe = (await tx.query('SELECT id,name FROM recipes WHERE id=$1 AND deleted_at IS NULL', [body.recipe_id])).rows[0];
      if (!recipe) throw new ApiError(404, 'NOT_FOUND', '菜谱不存在');
      const existing = (await tx.query('SELECT id FROM meal_items WHERE meal_id=$1 AND recipe_id=$2', [mealId, body.recipe_id])).rows[0];
      if (existing) throw new ApiError(409, 'ALREADY_IN_MEAL', '该菜品已在本餐菜单中');
      const item = (await tx.query(`INSERT INTO meal_items(id,meal_id,recipe_id,servings,source,selected_by_user_id)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
        [randomUUID(), mealId, body.recipe_id, body.servings || meal.diners_count, body.source || 'MANUAL', userId])).rows[0];
      return mealItemRow({ ...item, recipe_name: recipe.name, recipe_image: null, selected_by_nickname: null });
    });
  }

  async function removeMealItem(familyId, userId, mealId, itemId) {
    return access(familyId, userId, null, true, async tx => {
      const meal = (await tx.query('SELECT id FROM meals WHERE id=$1 AND family_id=$2 AND status=$3', [mealId, familyId, 'PLANNING'])).rows[0];
      if (!meal) throw new ApiError(409, 'MEAL_NOT_EDITABLE', '当前餐次状态不可编辑');
      await tx.query('DELETE FROM meal_items WHERE id=$1 AND meal_id=$2', [itemId, mealId]);
      return { ok: true };
    });
  }

  async function confirmMeal(familyId, userId, mealId) {
    return access(familyId, userId, null, true, async tx => {
      const result = await tx.query(`UPDATE meals SET status='CONFIRMED',version=version+1,updated_at=now()
        WHERE id=$1 AND family_id=$2 AND status='PLANNING' RETURNING *`, [mealId, familyId]);
      if (!result.rows[0]) throw new ApiError(409, 'MEAL_NOT_EDITABLE', '当前餐次状态不可确认');
      return result.rows[0];
    });
  }

  return { getCurrentMeal, ensureCurrentMeal, getMeal, addMealItem, removeMealItem, confirmMeal };
}

module.exports = { createMealService };
