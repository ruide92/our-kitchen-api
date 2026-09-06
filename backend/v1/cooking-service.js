// Cooking Service — V4
// Meal confirm -> cooking session -> complete -> inventory consumption -> history
// CONFIRMED+ meals use frozen recipe_snapshot; no live recipe JOIN for historical content.
const { randomUUID } = require('node:crypto');
const { withTransaction } = require('./db');
const { ApiError } = require('./errors');
const { authorize } = require('./family-access');
const { buildRecipeSnapshot, requireSnapshot, getStepsFromSnapshot, getItemsFromSnapshot, getIngredientsFromSnapshot } = require('./meal-snapshot');
const { toBaseQuantity, fromBaseQuantity, areUnitsCompatible, loadUnitsMap } = require('./unit-conversion');

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
  async function confirmMeal(familyId, userId, mealId) {
    return access(familyId, userId, null, true, async tx => {
      const meal = (await tx.query('SELECT * FROM meals WHERE id=$1 AND family_id=$2', [mealId, familyId])).rows[0];
      if (!meal) throw new ApiError(404, 'MEAL_NOT_FOUND', '本餐不存在');
      if (meal.status !== 'PLANNING') throw new ApiError(409, 'MEAL_NOT_PLANNING', `当前状态 ${meal.status} 不能确认`);

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

      // Check for existing ACTIVE session (idempotency)
      const existing = (await tx.query(`SELECT id FROM cooking_sessions WHERE meal_id=$1 AND status='ACTIVE'`, [mealId])).rows[0];
      if (existing) {
        throw new ApiError(409, 'SESSION_ALREADY_ACTIVE', '本餐已有进行中的做饭会话');
      }

      const sessionId = randomUUID();
      await tx.query(`INSERT INTO cooking_sessions(id,family_id,meal_id,status,started_by_user_id)
        VALUES($1,$2,$3,'ACTIVE',$4)`, [sessionId, familyId, mealId, userId]);
      await tx.query(`UPDATE meals SET status='COOKING', updated_at=now() WHERE id=$1`, [mealId]);

      const steps = getStepsFromSnapshot(snapshot);
      return { session_id: sessionId, meal, steps };
    });
  }

  // GET cooking session: server-side resume with frozen steps + consumption candidates
  async function getCookingSession(familyId, userId, sessionId) {
    return access(familyId, userId, null, false, async tx => {
      const session = (await tx.query('SELECT * FROM cooking_sessions WHERE id=$1 AND family_id=$2', [sessionId, familyId])).rows[0];
      if (!session) throw new ApiError(404, 'SESSION_NOT_FOUND', '做饭会话不存在');

      const meal = (await tx.query('SELECT * FROM meals WHERE id=$1 AND family_id=$2', [session.meal_id, familyId])).rows[0];
      if (!meal) throw new ApiError(404, 'MEAL_NOT_FOUND', '关联本餐不存在');

      // Fail closed: snapshot must exist for frozen meals
      const snapshot = requireSnapshot(meal, 'getCookingSession');
      const steps = getStepsFromSnapshot(snapshot);

      // Build consumption candidates from snapshot (NOT live recipe)
      const unitsMap = await loadUnitsMap(tx);
      const consumptionCandidates = await buildConsumptionCandidates(tx, familyId, meal, snapshot, unitsMap);

      return {
        session_id: session.id,
        status: session.status,
        started_at: session.started_at,
        completed_at: session.completed_at,
        started_by_user_id: session.started_by_user_id,
        meal: {
          id: meal.id,
          meal_date: meal.meal_date,
          meal_type: meal.meal_type,
          diners_count: meal.diners_count,
          status: meal.status,
        },
        steps,
        consumption_candidates: consumptionCandidates,
      };
    });
  }

  // GET active cooking session by meal (for new-device resume without local session_id)
  async function getActiveCookingSessionByMeal(familyId, userId, mealId) {
    return access(familyId, userId, null, false, async tx => {
      const session = (await tx.query(`SELECT * FROM cooking_sessions WHERE meal_id=$1 AND family_id=$2 AND status='ACTIVE' ORDER BY started_at DESC LIMIT 1`, [mealId, familyId])).rows[0];
      if (!session) return null;
      return getCookingSession(familyId, userId, session.id);
    });
  }

  // Build consumption candidates from frozen snapshot + current fridge inventory
  async function buildConsumptionCandidates(tx, familyId, meal, snapshot, unitsMap) {
    const snapshotIngredients = getIngredientsFromSnapshot(snapshot);
    const candidates = [];

    for (const ing of snapshotIngredients) {
      if (!ing.ingredient_id) continue; // custom/text ingredients: not auto-deductable

      // Get current fridge inventory for this ingredient
      const fridgeItems = (await tx.query(`
        SELECT id, quantity, unit_code, expiry_date FROM fridge_items
        WHERE family_id=$1 AND ingredient_id=$2 AND quantity > 0
        ORDER BY expiry_date NULLS LAST
      `, [familyId, ing.ingredient_id])).rows;

      // Calculate total available in base units
      let availableBase = 0;
      let availableUnitCode = ing.unit_code;
      for (const fi of fridgeItems) {
        const conv = toBaseQuantity(fi.quantity, fi.unit_code, unitsMap);
        if (conv.converted) {
          availableBase += conv.quantity;
          availableUnitCode = conv.unitCode;
        } else if (fi.unit_code === ing.unit_code) {
          availableBase += fi.quantity;
        }
      }

      // Convert available back to ingredient's unit for display
      let availableQuantity = availableBase;
      if (availableBase > 0 && ing.unit_code) {
        const back = fromBaseQuantity(availableBase, ing.unit_code, unitsMap);
        if (back.converted) availableQuantity = back.quantity;
      }

      candidates.push({
        ingredient_id: ing.ingredient_id,
        name: ing.name,
        suggested_quantity: ing.quantity,
        unit_code: ing.unit_code,
        available_quantity: availableQuantity,
        available_unit_code: ing.unit_code,
        auto_deductable: true,
      });
    }

    return candidates;
  }

  // Complete cooking: validate consumption, deduct inventory in batches, write movements
  async function completeCooking(familyId, userId, sessionId, consumption) {
    return access(familyId, userId, null, true, async tx => {
      const session = (await tx.query('SELECT * FROM cooking_sessions WHERE id=$1 AND family_id=$2', [sessionId, familyId])).rows[0];
      if (!session) throw new ApiError(404, 'SESSION_NOT_FOUND', '做饭会话不存在');
      if (session.status !== 'ACTIVE') throw new ApiError(409, 'SESSION_NOT_ACTIVE', `当前状态 ${session.status}`);

      const meal = (await tx.query('SELECT * FROM meals WHERE id=$1 AND family_id=$2', [session.meal_id, familyId])).rows[0];
      if (!meal) throw new ApiError(404, 'MEAL_NOT_FOUND', '关联本餐不存在');

      // Fail closed: snapshot must exist
      const snapshot = requireSnapshot(meal, 'completeCooking');
      const unitsMap = await loadUnitsMap(tx);

      // Build allowed ingredient set from snapshot (snapshot-bound validation)
      const snapshotIngredients = getIngredientsFromSnapshot(snapshot);
      const allowedIngredientIds = new Set(snapshotIngredients.filter(i => i.ingredient_id).map(i => i.ingredient_id));

      const movements = [];
      const fridgeMutations = []; // collect first, apply after movements to avoid FK violation

      for (const cons of consumption || []) {
        const { ingredient_id, quantity, unit_code } = cons;

        // Skip zero-quantity items (user chose not to deduct)
        if (quantity == null || Number(quantity) <= 0) continue;

        // Validate ingredient exists in frozen snapshot
        if (!ingredient_id || !allowedIngredientIds.has(ingredient_id)) {
          throw new ApiError(422, 'INGREDIENT_NOT_IN_SNAPSHOT',
            `食材 ${ingredient_id || '未知'} 不在本餐冻结菜谱中，不能扣库存`,
            { ingredient_id });
        }

        // Validate quantity
        const qty = Number(quantity);
        if (!Number.isFinite(qty) || qty <= 0) {
          throw new ApiError(422, 'INVALID_CONSUMPTION', `用量必须是正数`, { ingredient_id });
        }

        // Validate unit code
        if (!unit_code) {
          throw new ApiError(422, 'INVALID_CONSUMPTION', `缺少单位`, { ingredient_id });
        }

        // Get fridge batches for this ingredient, FIFO by expiry
        const fridgeItems = (await tx.query(`
          SELECT * FROM fridge_items WHERE family_id=$1 AND ingredient_id=$2 AND quantity > 0
          ORDER BY expiry_date NULLS LAST
          FOR UPDATE
        `, [familyId, ingredient_id])).rows;

        // Convert requested quantity to base units
        const requestedBase = toBaseQuantity(qty, unit_code, unitsMap);
        let remainingBase = requestedBase.converted ? requestedBase.quantity : qty;
        const workingUnitCode = requestedBase.converted ? requestedBase.unitCode : unit_code;

        for (const fi of fridgeItems) {
          if (remainingBase <= 0.0001) break;

          // Check unit compatibility
          if (!areUnitsCompatible(fi.unit_code, workingUnitCode, unitsMap) && fi.unit_code !== workingUnitCode) {
            continue; // skip incompatible batches
          }

          const fiBase = toBaseQuantity(fi.quantity, fi.unit_code, unitsMap);
          const fiQtyBase = fiBase.converted ? fiBase.quantity : fi.quantity;
          const takeBase = Math.min(fiQtyBase, remainingBase);

          // Convert taken amount back to this batch's unit for the actual mutation
          const takeInBatchUnit = fromBaseQuantity(takeBase, fi.unit_code, unitsMap);
          const take = takeInBatchUnit.converted ? takeInBatchUnit.quantity : takeBase;
          const newQty = Number(fi.quantity) - take;

          fridgeMutations.push({ id: fi.id, newQty, willDelete: newQty <= 0.0001 });

          remainingBase -= takeBase;

          // Movement recorded in the BATCH's actual unit (matches mutation)
          movements.push({
            fridge_item_id: fi.id,
            ingredient_id,
            quantity_delta: -take,
            unit_code: fi.unit_code,
          });
        }

        if (remainingBase > 0.0001) {
          // Convert remaining back to requested unit for error message
          const remainingInReqUnit = fromBaseQuantity(remainingBase, unit_code, unitsMap);
          throw new ApiError(422, 'INVENTORY_INSUFFICIENT',
            `食材库存不足`,
            {
              ingredient_id,
              requested: qty,
              requested_unit: unit_code,
              remaining: remainingInReqUnit.converted ? remainingInReqUnit.quantity : remainingBase,
              remaining_unit: unit_code,
            });
        }
      }

      // Write COOK_OUT movements FIRST (before fridge DELETEs) to avoid FK violation
      for (const m of movements) {
        await tx.query(`INSERT INTO inventory_movements(id,family_id,fridge_item_id,ingredient_id,movement_type,quantity_delta,unit_code,meal_id,performed_by_user_id)
          VALUES($1,$2,$3,$4,'COOK_OUT',$5,$6,$7,$8)`,
          [randomUUID(), familyId, m.fridge_item_id, m.ingredient_id, m.quantity_delta, m.unit_code, session.meal_id, userId]);
      }

      // Now apply fridge mutations (UPDATE or DELETE)
      for (const fm of fridgeMutations) {
        if (fm.willDelete) {
          await tx.query('DELETE FROM fridge_items WHERE id=$1', [fm.id]);
        } else {
          await tx.query('UPDATE fridge_items SET quantity=$1, version=version+1, updated_at=now() WHERE id=$2', [fm.newQty, fm.id]);
        }
      }

      await tx.query(`UPDATE cooking_sessions SET status='COMPLETED', completed_by_user_id=$2, completed_at=now() WHERE id=$1`, [sessionId, userId]);
      await tx.query(`UPDATE meals SET status='COMPLETED', updated_at=now() WHERE id=$1`, [session.meal_id]);

      return { ok: true, consumed: movements.length, session_id: sessionId, movements };
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

  return { confirmMeal, startCooking, getCookingSession, getActiveCookingSessionByMeal, completeCooking, getMealHistory };
}

module.exports = { createCookingService };
