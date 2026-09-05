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
      recipe_name: row.recipe_name,
      servings: row.servings, source: row.source,
      selected_by_user_id: row.selected_by_user_id,
      selected_by_nickname: row.selected_by_nickname,
      sort_order: row.sort_order,
      created_at: row.created_at
    };
  }

  async function loadMealItems(tx, mealId) {
    const items = (await tx.query(`
      SELECT mi.*, r.name AS recipe_name, u.nickname AS selected_by_nickname
      FROM meal_items mi
      JOIN recipes r ON r.id = mi.recipe_id
      LEFT JOIN users u ON u.id = mi.selected_by_user_id
      WHERE mi.meal_id=$1 ORDER BY mi.sort_order, mi.created_at`, [mealId])).rows;
    return items.map(mealItemRow);
  }

  async function getCurrentMeal(familyId, userId, mealDate, mealType) {
    return access(familyId, userId, null, false, async tx => {
      const meal = (await tx.query('SELECT * FROM meals WHERE family_id=$1 AND meal_date=$2 AND meal_type=$3', [familyId, mealDate, mealType])).rows[0];
      if (!meal) return null;
      const items = await loadMealItems(tx, meal.id);
      return { ...meal, items };
    });
  }

  async function ensureCurrentMeal(familyId, userId, body) {
    return access(familyId, userId, null, true, async tx => {
      let meal = (await tx.query('SELECT * FROM meals WHERE family_id=$1 AND meal_date=$2 AND meal_type=$3 FOR UPDATE', [familyId, body.meal_date, body.meal_type])).rows[0];
      if (!meal) {
        meal = (await tx.query(`INSERT INTO meals(id,family_id,meal_date,meal_type,diners_count,source_weekly_plan_id)
          VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
          [randomUUID(), familyId, body.meal_date, body.meal_type, body.diners_count || 2, body.source_weekly_plan_id || null])).rows[0];
      } else if (body.diners_count && meal.status === 'PLANNING') {
        meal = (await tx.query('UPDATE meals SET diners_count=$1, updated_at=now() WHERE id=$2 RETURNING *', [body.diners_count, meal.id])).rows[0];
      }
      const items = await loadMealItems(tx, meal.id);
      return { ...meal, items };
    });
  }

  async function getMeal(familyId, userId, mealId) {
    return access(familyId, userId, null, false, async tx => {
      const meal = (await tx.query('SELECT * FROM meals WHERE id=$1 AND family_id=$2', [mealId, familyId])).rows[0];
      if (!meal) throw new ApiError(404, 'NOT_FOUND', '本餐菜单不存在');
      const items = await loadMealItems(tx, mealId);
      return { ...meal, items };
    });
  }

  async function addMealItem(familyId, userId, mealId, body) {
    return access(familyId, userId, null, true, async tx => {
      const meal = (await tx.query('SELECT * FROM meals WHERE id=$1 AND family_id=$2 AND status=$3 FOR UPDATE', [mealId, familyId, 'PLANNING'])).rows[0];
      if (!meal) throw new ApiError(409, 'MEAL_NOT_EDITABLE', '当前餐次状态不可编辑');
      // Recipe family isolation: BASE or same-family FAMILY
      const recipe = (await tx.query('SELECT id,name,kind,family_id FROM recipes WHERE id=$1 AND deleted_at IS NULL', [body.recipe_id])).rows[0];
      if (!recipe) throw new ApiError(404, 'NOT_FOUND', '菜谱不存在');
      if (recipe.kind === 'FAMILY' && recipe.family_id !== familyId) throw forbidden();
      const existing = (await tx.query('SELECT id FROM meal_items WHERE meal_id=$1 AND recipe_id=$2', [mealId, body.recipe_id])).rows[0];
      if (existing) throw new ApiError(409, 'ALREADY_IN_MEAL', '该菜品已在本餐菜单中');
      const sortOrder = (await tx.query('SELECT COALESCE(MAX(sort_order),-1)+1 as next FROM meal_items WHERE meal_id=$1', [mealId])).rows[0].next;
      const item = (await tx.query(`INSERT INTO meal_items(id,meal_id,recipe_id,servings,source,selected_by_user_id,sort_order)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [randomUUID(), mealId, body.recipe_id, body.servings || meal.diners_count, body.source || 'MANUAL', userId, sortOrder])).rows[0];
      return mealItemRow({ ...item, recipe_name: recipe.name, selected_by_nickname: null });
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
      const result = await tx.query(`UPDATE meals SET status='CONFIRMED',updated_at=now()
        WHERE id=$1 AND family_id=$2 AND status='PLANNING' RETURNING *`, [mealId, familyId]);
      if (!result.rows[0]) throw new ApiError(409, 'MEAL_NOT_EDITABLE', '当前餐次状态不可确认');
      return result.rows[0];
    });
  }

  async function importWeeklyPlan(familyId, userId, mealId, weeklyPlanId) {
    return access(familyId, userId, null, true, async tx => {
      const meal = (await tx.query('SELECT * FROM meals WHERE id=$1 AND family_id=$2 AND status=$3 FOR UPDATE', [mealId, familyId, 'PLANNING'])).rows[0];
      if (!meal) throw new ApiError(409, 'MEAL_NOT_EDITABLE', '当前餐次状态不可编辑');
      const plan = (await tx.query('SELECT * FROM weekly_plans WHERE id=$1 AND family_id=$2 AND status=$3', [weeklyPlanId, familyId, 'ACTIVE'])).rows[0];
      if (!plan) throw new ApiError(404, 'NOT_FOUND', '周计划不存在');
      const planItems = (await tx.query('SELECT * FROM weekly_plan_items WHERE weekly_plan_id=$1 AND plan_date=$2 AND meal_type=$3', [weeklyPlanId, meal.meal_date, meal.meal_type])).rows;
      let added = 0;
      for (const pi of planItems) {
        const existing = (await tx.query('SELECT id FROM meal_items WHERE meal_id=$1 AND recipe_id=$2', [mealId, pi.recipe_id])).rows[0];
        if (!existing) {
          const sortOrder = (await tx.query('SELECT COALESCE(MAX(sort_order),-1)+1 as next FROM meal_items WHERE meal_id=$1', [mealId])).rows[0].next;
          await tx.query(`INSERT INTO meal_items(id,meal_id,recipe_id,servings,source,selected_by_user_id,sort_order)
            VALUES($1,$2,$3,$4,'WEEKLY_PLAN',$5,$6)`,
            [randomUUID(), mealId, pi.recipe_id, meal.diners_count, userId, sortOrder]);
          added++;
        }
      }
      return { imported: added, meal_id: mealId };
    });
  }

  return { getCurrentMeal, ensureCurrentMeal, getMeal, addMealItem, removeMealItem, confirmMeal, importWeeklyPlan };
}

module.exports = { createMealService };
