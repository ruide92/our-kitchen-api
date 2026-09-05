// Cooking Service — V4
// Meal confirm -> cooking session -> complete -> inventory consumption -> history
// CONFIRMED+ meals use frozen recipe_snapshot; no live recipe JOIN for historical content.
const { randomUUID } = require('node:crypto');
const { withTransaction } = require('./db');
const { ApiError } = require('./errors');
const { authorize } = require('./family-access');
const { buildRecipeSnapshot, requireSnapshot, getStepsFromSnapshot, getItemsFromSnapshot } = require('./meal-snapshot');

function createCookingService(pool) {
  async function access(familyId, userId, roles, write, work) {
    return withTransaction(pool, async tx => {
      const family = (await tx.query(`SELECT id FROM families WHERE id=$1 AND deleted_at IS NULL${write ? ' FOR UPDATE' : ' FOR SHARE'}`, [familyId])).rows[0];
      if (!family) throw new ApiError(403, 'FAMILY_FORBIDDEN', '你不是该家庭成员');
      await authorize(tx, familyId, userId, roles);
      return work(tx);
    });
  }

  // Confirm meal: PLANNING -> CONFIRMED, build full versioned snapshot
  // Snapshot failure rolls back entire transaction — no CONFIRMED without snapshot.
  async function confirmMeal(familyId, userId, mealId) {
    return access(familyId, userId, null, true, async tx => {
      const meal = (await tx.query('SELECT * FROM meals WHERE id=$1 AND family_id=$2', [mealId, familyId])).rows[0];
      if (!meal) throw new ApiError(404, 'MEAL_NOT_FOUND', '本餐不存在');
      if (meal.status !== 'PLANNING') throw new ApiError(409, 'MEAL_NOT_PLANNING', `当前状态 ${meal.status} 不能确认`);

      // Build full snapshot (recipe + ingredients + steps + cookware + tags + etc.)
      const snapshot = await buildRecipeSnapshot(tx, mealId);

      await tx.query(`UPDATE meals SET status='CONFIRMED', recipe_snapshot=$2, updated_at=now() WHERE id=$1`,
        [mealId, JSON.stringify(snapshot)]);

      const updated = (await tx.query('SELECT * FROM meals WHERE id=$1', [mealId])).rows[0];
      return updated;
    });
  }

  // Start cooking: CONFIRMED -> COOKING, steps from snapshot (no live recipe JOIN)
  async function startCooking(familyId, userId, mealId) {
    return access(familyId, userId, null, true, async tx => {
      const meal = (await tx.query('SELECT * FROM meals WHERE id=$1 AND family_id=$2', [mealId, familyId])).rows[0];
      if (!meal) throw new ApiError(404, 'MEAL_NOT_FOUND', '本餐不存在');
      if (meal.status !== 'CONFIRMED') throw new ApiError(409, 'MEAL_NOT_CONFIRMED', `当前状态 ${meal.status} 不能开始做饭`);

      // Fail closed: snapshot must exist and be supported
      const snapshot = requireSnapshot(meal, 'startCooking');

      const sessionId = randomUUID();
      await tx.query(`INSERT INTO cooking_sessions(id,family_id,meal_id,status,started_by_user_id)
        VALUES($1,$2,$3,'ACTIVE',$4)`, [sessionId, familyId, mealId, userId]);
      await tx.query(`UPDATE meals SET status='COOKING', updated_at=now() WHERE id=$1`, [mealId]);

      // Steps come ENTIRELY from frozen snapshot
      const steps = getStepsFromSnapshot(snapshot);

      return { session_id: sessionId, meal, steps };
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

        const fridgeItems = (await tx.query(`
          SELECT * FROM fridge_items WHERE family_id=$1 AND ingredient_id=$2 ORDER BY expiry_date NULLS LAST
          FOR UPDATE
        `, [familyId, ingredient_id])).rows;

        let remaining = parseFloat(quantity);
        for (const fi of fridgeItems) {
          if (remaining <= 0) break;
          const fiQty = parseFloat(fi.quantity) || 0;
          if (fi.unit_code !== unit_code) continue;
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

      for (const m of movements) {
        await tx.query(`INSERT INTO inventory_movements(id,family_id,fridge_item_id,ingredient_id,movement_type,quantity_delta,unit_code,meal_id,performed_by_user_id)
          VALUES($1,$2,$3,$4,'COOK_OUT',$5,$6,$7,$8)`,
          [randomUUID(), familyId, m.fridge_item_id, m.ingredient_id, m.quantity_delta, m.unit_code, session.meal_id, userId]);
      }

      await tx.query(`UPDATE cooking_sessions SET status='COMPLETED', completed_by_user_id=$2, completed_at=now() WHERE id=$1`, [sessionId, userId]);
      await tx.query(`UPDATE meals SET status='COMPLETED', updated_at=now() WHERE id=$1`, [session.meal_id]);

      return { ok: true, consumed: movements.length, session_id: sessionId };
    });
  }

  // Get meal history — CONFIRMED+ uses snapshot for recipe identity (no live recipe JOIN drift)
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
        // Fail closed: CONFIRMED/COOKING/COMPLETED must have valid snapshot
        const snapshot = requireSnapshot(meal, 'getMealHistory');
        const snapshotItems = getItemsFromSnapshot(snapshot);
        const items = await Promise.all(snapshotItems.map(async si => {
          const user = si.selected_by_user_id
            ? (await tx.query('SELECT nickname FROM users WHERE id=$1', [si.selected_by_user_id])).rows[0]
            : null;
          return {
            id: si.meal_item_id,
            recipe_id: si.recipe_id,
            recipe_name: si.recipe?.name || si.recipe_name,
            servings: si.servings,
            source: si.source,
            selected_by_user_id: si.selected_by_user_id,
            selected_by_nickname: user?.nickname || null,
          };
        }));
        result.push({ ...meal, items });
      }
      return result;
    });
  }

  return { confirmMeal, startCooking, completeCooking, getMealHistory };
}

module.exports = { createCookingService };
