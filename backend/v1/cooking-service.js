// Cooking Service — V4
// Meal confirm -> cooking session -> complete -> inventory consumption -> history
const { randomUUID } = require('node:crypto');
const { withTransaction } = require('./db');
const { ApiError } = require('./errors');
const { authorize } = require('./family-access');

function createCookingService(pool) {
  async function access(familyId, userId, roles, write, work) {
    return withTransaction(pool, async tx => {
      const family = (await tx.query(`SELECT id FROM families WHERE id=$1 AND deleted_at IS NULL${write ? ' FOR UPDATE' : ' FOR SHARE'}`, [familyId])).rows[0];
      if (!family) throw new ApiError(403, 'FAMILY_FORBIDDEN', '你不是该家庭成员');
      await authorize(tx, familyId, userId, roles);
      return work(tx);
    });
  }

  // Confirm meal: PLANNING -> CONFIRMED, snapshot recipes
  async function confirmMeal(familyId, userId, mealId) {
    return access(familyId, userId, null, true, async tx => {
      const meal = (await tx.query('SELECT * FROM meals WHERE id=$1 AND family_id=$2', [mealId, familyId])).rows[0];
      if (!meal) throw new ApiError(404, 'MEAL_NOT_FOUND', '本餐不存在');
      if (meal.status !== 'PLANNING') throw new ApiError(409, 'MEAL_NOT_PLANNING', `当前状态 ${meal.status} 不能确认`);

      // Snapshot recipe data
      const items = (await tx.query(`
        SELECT mi.*, r.name as recipe_name, r.base_servings
        FROM meal_items mi JOIN recipes r ON r.id = mi.recipe_id
        WHERE mi.meal_id=$1 ORDER BY mi.sort_order
      `, [mealId])).rows;

      const snapshot = items.map(i => ({
        meal_item_id: i.id,
        recipe_id: i.recipe_id,
        recipe_name: i.recipe_name,
        servings: i.servings,
        source: i.source,
        selected_by_user_id: i.selected_by_user_id
      }));

      await tx.query(`UPDATE meals SET status='CONFIRMED', recipe_snapshot=$2, updated_at=now() WHERE id=$1`,
        [mealId, JSON.stringify(snapshot)]);

      const updated = (await tx.query('SELECT * FROM meals WHERE id=$1', [mealId])).rows[0];
      return updated;
    });
  }

  // Start cooking: CONFIRMED -> COOKING, create session
  async function startCooking(familyId, userId, mealId) {
    return access(familyId, userId, null, true, async tx => {
      const meal = (await tx.query('SELECT * FROM meals WHERE id=$1 AND family_id=$2', [mealId, familyId])).rows[0];
      if (!meal) throw new ApiError(404, 'MEAL_NOT_FOUND', '本餐不存在');
      if (meal.status !== 'CONFIRMED') throw new ApiError(409, 'MEAL_NOT_CONFIRMED', `当前状态 ${meal.status} 不能开始做饭`);

      const sessionId = randomUUID();
      await tx.query(`INSERT INTO cooking_sessions(id,family_id,meal_id,status,started_by_user_id)
        VALUES($1,$2,$3,'ACTIVE',$4)`, [sessionId, familyId, mealId, userId]);
      await tx.query(`UPDATE meals SET status='COOKING', updated_at=now() WHERE id=$1`, [mealId]);

      // Return frozen steps from snapshot
      const items = (await tx.query(`
        SELECT mi.*, r.name as recipe_name
        FROM meal_items mi JOIN recipes r ON r.id = mi.recipe_id
        WHERE mi.meal_id=$1 ORDER BY mi.sort_order
      `, [mealId])).rows;

      const allSteps = [];
      for (const item of items) {
        const steps = (await tx.query(`
          SELECT rs.*, r.name as recipe_name
          FROM recipe_steps rs JOIN recipes r ON r.id = rs.recipe_id
          WHERE rs.recipe_id=$1 ORDER BY rs.sort_order
        `, [item.recipe_id])).rows;
        steps.forEach(s => allSteps.push({ ...s, recipe_name: item.recipe_name }));
      }

      return { session_id: sessionId, meal, steps: allSteps };
    });
  }

  // Complete cooking: consume inventory, session -> COMPLETED, meal -> COMPLETED
  async function completeCooking(familyId, userId, sessionId, consumption) {
    return access(familyId, userId, null, true, async tx => {
      const session = (await tx.query('SELECT * FROM cooking_sessions WHERE id=$1 AND family_id=$2', [sessionId, familyId])).rows[0];
      if (!session) throw new ApiError(404, 'SESSION_NOT_FOUND', '做饭会话不存在');
      if (session.status !== 'ACTIVE') throw new ApiError(409, 'SESSION_NOT_ACTIVE', `当前状态 ${session.status}`);

      // Validate and consume each ingredient
      const movements = [];
      for (const cons of consumption || []) {
        const { ingredient_id, quantity, unit_code } = cons;
        if (!ingredient_id || quantity == null) continue;

        // Find fridge items with this ingredient (FIFO by expiry)
        const fridgeItems = (await tx.query(`
          SELECT * FROM fridge_items WHERE family_id=$1 AND ingredient_id=$2 ORDER BY expiry_date NULLS LAST
          FOR UPDATE
        `, [familyId, ingredient_id])).rows;

        let remaining = parseFloat(quantity);
        for (const fi of fridgeItems) {
          if (remaining <= 0) break;
          const fiQty = parseFloat(fi.quantity) || 0;
          if (fi.unit_code !== unit_code) continue; // skip incompatible units
          const take = Math.min(fiQty, remaining);
          const newQty = fiQty - take;
          if (newQty <= 0.001) {
            await tx.query('DELETE FROM fridge_items WHERE id=$1', [fi.id]);
          } else {
            await tx.query('UPDATE fridge_items SET quantity=$1, version=version+1, updated_at=now() WHERE id=$2', [newQty, fi.id]);
          }
          remaining -= take;
          movements.push({ fridge_item_id: fi.id, ingredient_id, quantity_delta: -take, unit_code });
        }

        if (remaining > 0.001) {
          throw new ApiError(422, 'INVENTORY_INSUFFICIENT',
            `食材库存不足，还缺 ${remaining}${unit_code || ''}`, { ingredient_id, remaining });
        }
      }

      // Write inventory movements
      for (const m of movements) {
        await tx.query(`INSERT INTO inventory_movements(id,family_id,fridge_item_id,ingredient_id,movement_type,quantity_delta,unit_code,meal_id,performed_by_user_id)
          VALUES($1,$2,$3,$4,'COOK_OUT',$5,$6,$7,$8)`,
          [randomUUID(), familyId, m.fridge_item_id, m.ingredient_id, m.quantity_delta, m.unit_code, session.meal_id, userId]);
      }

      // Complete session and meal
      await tx.query(`UPDATE cooking_sessions SET status='COMPLETED', completed_by_user_id=$2, completed_at=now() WHERE id=$1`, [sessionId, userId]);
      await tx.query(`UPDATE meals SET status='COMPLETED', updated_at=now() WHERE id=$1`, [session.meal_id]);

      return { ok: true, consumed: movements.length, session_id: sessionId };
    });
  }

  // Get meal history
  async function getMealHistory(familyId, userId, limit = 30) {
    return access(familyId, userId, null, false, async tx => {
      const meals = (await tx.query(`
        SELECT m.*,
          (SELECT COUNT(*) FROM meal_items mi WHERE mi.meal_id=m.id) as dish_count
        FROM meals m
        WHERE m.family_id=$1 AND m.status IN ('CONFIRMED','COOKING','COMPLETED')
        ORDER BY m.meal_date DESC, m.meal_type DESC
        LIMIT $2
      `, [familyId, limit])).rows;

      const result = [];
      for (const meal of meals) {
        const items = (await tx.query(`
          SELECT mi.*, r.name as recipe_name, u.nickname as selected_by_nickname
          FROM meal_items mi
          JOIN recipes r ON r.id = mi.recipe_id
          LEFT JOIN users u ON u.id = mi.selected_by_user_id
          WHERE mi.meal_id=$1 ORDER BY mi.sort_order
        `, [meal.id])).rows;
        result.push({ ...meal, items });
      }
      return result;
    });
  }

  return { confirmMeal, startCooking, completeCooking, getMealHistory };
}

module.exports = { createCookingService };
