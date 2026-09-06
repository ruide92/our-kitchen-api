// Recommendation Engine — V4
// Shared scoring for weekly plans, random meal, fridge cooking, one-person meals.
const { randomUUID } = require('node:crypto');
const { withTransaction } = require('./db');
const { ApiError } = require('./errors');
const { authorize } = require('./family-access');
const { areUnitsCompatible, loadUnitsMap } = require('./unit-conversion');

// Seedable mulberry32 PRNG for deterministic tests
function createRng(seed) {
  let a = seed >>> 0;
  return function() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createRecommendationService(pool, options = {}) {
  const randomFn = options.randomFn || Math.random;

  async function access(familyId, userId, roles, write, work) {
    return withTransaction(pool, async tx => {
      const family = (await tx.query(`SELECT id FROM families WHERE id=$1 AND deleted_at IS NULL${write ? ' FOR UPDATE' : ' FOR SHARE'}`, [familyId])).rows[0];
      if (!family) throw new ApiError(403, 'FAMILY_FORBIDDEN', '你不是该家庭成员');
      await authorize(tx, familyId, userId, roles);
      return work(tx);
    });
  }

  // Fetch family settings for repeat days and default mode
  async function fetchSettings(tx, familyId) {
    const row = (await tx.query('SELECT * FROM family_settings WHERE family_id=$1', [familyId])).rows[0];
    return row || {
      repeat_strong_days: 7, repeat_penalty_days: 14, repeat_recover_days: 28,
      random_default_mode: 'BALANCED', default_diners: 2
    };
  }

  // Fetch ACTIVE family member user IDs (for favorite/wish scoping)
  async function fetchActiveMembers(tx, familyId) {
    const rows = (await tx.query(
      'SELECT user_id, role FROM family_members WHERE family_id=$1 AND status=$2',
      [familyId, 'ACTIVE']
    )).rows;
    return rows;
  }

  // Fetch candidate recipes with enrichment — correct table names + family scope
  async function fetchCandidates(tx, familyId, mealType, activeMemberIds) {
    const rows = (await tx.query(`
      SELECT r.*,
        EXISTS(SELECT 1 FROM recipe_meal_types rm WHERE rm.recipe_id=r.id AND rm.meal_type=$2) as matches_meal,
        (SELECT COUNT(*) FROM recipe_meal_types rm WHERE rm.recipe_id=r.id) as meal_type_count,
        (SELECT COUNT(*) FROM recipe_favorites f
           JOIN family_members fm ON fm.user_id=f.user_id AND fm.family_id=$1 AND fm.status='ACTIVE'
           WHERE f.recipe_id=r.id) as fav_count,
        (SELECT AVG(rating) FROM recipe_ratings rt
           WHERE rt.recipe_id=r.id AND rt.family_id=$1 AND rt.meal_id IS NULL) as avg_rating,
        (SELECT COUNT(*) FROM wishes w WHERE w.recipe_id=r.id AND w.status='ACTIVE' AND w.family_id=$1) as wish_count,
        (SELECT array_agg(allergen_code) FROM recipe_allergens ra WHERE ra.recipe_id=r.id) as allergen_codes
      FROM recipes r
      WHERE r.deleted_at IS NULL
        AND (r.kind='BASE' OR (r.kind='FAMILY' AND r.family_id=$1))
      ORDER BY r.name
    `, [familyId, mealType])).rows;
    return rows;
  }

  // Family variant dedup: if BASE has a FAMILY variant in this family, prefer variant
  function dedupFamilyVariants(candidates) {
    const familyVariants = new Set();
    const baseByParent = new Map();
    for (const c of candidates) {
      if (c.kind === 'FAMILY' && c.parent_recipe_id) {
        familyVariants.add(c.parent_recipe_id);
      }
    }
    return candidates.filter(c => {
      if (c.kind === 'BASE' && familyVariants.has(c.id)) return false;
      return true;
    });
  }

  // Hard filter: meal_type
  function filterMealType(candidates, mealType, warnings) {
    const result = [];
    for (const c of candidates) {
      if (c.meal_type_count > 0 && !c.matches_meal) {
        continue; // has explicit tags but doesn't match → hard exclude
      }
      if (c.meal_type_count === 0) {
        warnings.push({ code: 'MEAL_TYPE_UNTAGGED', recipe_id: c.id, recipe_name: c.name });
      }
      result.push(c);
    }
    return result;
  }

  // Hard filter: allergens — user_allergens table doesn't exist yet, DATA_QUALITY_WARNING
  function filterAllergens(candidates, warnings) {
    // No user_allergens table in current schema. Record warning, don't fabricate.
    warnings.push({ code: 'DATA_QUALITY_WARNING', detail: 'user_allergens table not present; allergen hard filter deferred' });
    return candidates;
  }

  // Fetch recent meal history for repeat penalty
  async function fetchRecentHistory(tx, familyId, days) {
    const rows = (await tx.query(`
      SELECT DISTINCT mi.recipe_id, m.meal_date
      FROM meal_items mi
      JOIN meals m ON m.id = mi.meal_id
      WHERE m.family_id=$1 AND m.status IN ('CONFIRMED','COOKING','COMPLETED')
        AND m.meal_date >= CURRENT_DATE - $2 * INTERVAL '1 day'
      ORDER BY m.meal_date DESC
    `, [familyId, days])).rows;
    return rows;
  }

  // Fetch fridge inventory (non-expired)
  async function fetchInventory(tx, familyId) {
    const rows = (await tx.query(`
      SELECT fi.ingredient_id, fi.quantity, fi.unit_code, fi.expiry_date,
             i.category_code, i.default_unit_code
      FROM fridge_items fi
      JOIN ingredients i ON i.id = fi.ingredient_id
      WHERE fi.family_id=$1 AND (fi.expiry_date IS NULL OR fi.expiry_date >= CURRENT_DATE)
    `, [familyId])).rows;
    return rows;
  }

  // Fetch pantry staples (canonical assume_available)
  async function fetchPantry(tx, familyId) {
    const rows = (await tx.query(`
      SELECT ps.ingredient_id, ps.assume_available, ps.quantity, ps.unit_code
      FROM pantry_staples ps
      WHERE ps.family_id=$1
    `, [familyId])).rows;
    return rows;
  }

  // Fetch recipe ingredients with required flag + quantity + unit
  async function fetchRecipeIngredients(tx, recipeIds) {
    if (recipeIds.length === 0) return {};
    const rows = (await tx.query(`
      SELECT recipe_id, ingredient_id, quantity, unit_code, required, type
      FROM recipe_ingredients WHERE recipe_id = ANY($1)
    `, [recipeIds])).rows;
    const map = {};
    rows.forEach(r => {
      if (!map[r.recipe_id]) map[r.recipe_id] = [];
      map[r.recipe_id].push(r);
    });
    return map;
  }

  // Compute inventory match for a recipe using required canonical ingredients
  function computeInventoryMatch(recipe, ingredientMap, inventory, pantry, unitsMap) {
    const ings = ingredientMap[recipe.id] || [];
    const required = ings.filter(i => i.required && i.ingredient_id);
    if (required.length === 0) return { matchRatio: 0, availableCount: 0, missingCount: 0, missingIngredients: [], expiringMatch: false };

    const invByIngredient = new Map();
    for (const inv of inventory) {
      if (!invByIngredient.has(inv.ingredient_id)) invByIngredient.set(inv.ingredient_id, []);
      invByIngredient.get(inv.ingredient_id).push(inv);
    }
    const pantryByIngredient = new Map();
    for (const p of pantry) {
      if (p.assume_available) pantryByIngredient.set(p.ingredient_id, p);
    }

    let availableCount = 0;
    const missingIngredients = [];
    let expiringMatch = false;
    const now = new Date();

    for (const ing of required) {
      let hasIt = false;
      // Check fridge with unit compatibility
      const fridgeItems = invByIngredient.get(ing.ingredient_id) || [];
      for (const fi of fridgeItems) {
        if (ing.unit_code && fi.unit_code && !areUnitsCompatible(ing.unit_code, fi.unit_code, unitsMap)) continue;
        hasIt = true;
        // Check expiry
        if (fi.expiry_date) {
          const daysToExpiry = Math.ceil((new Date(fi.expiry_date) - now) / 86400000);
          if (daysToExpiry <= 3) expiringMatch = true;
        }
        break;
      }
      // Check pantry canonical
      if (!hasIt && pantryByIngredient.has(ing.ingredient_id)) {
        hasIt = true;
      }
      if (hasIt) availableCount++;
      else missingIngredients.push(ing.ingredient_id);
    }

    return {
      matchRatio: availableCount / required.length,
      availableCount,
      missingCount: required.length - availableCount,
      missingIngredients,
      expiringMatch,
      requiredCount: required.length
    };
  }

  // Score a single recipe
  function scoreRecipe(recipe, context) {
    let score = 50;
    const reasons = [];
    const settings = context.settings;

    // Family rating (general, meal_id IS NULL)
    if (recipe.avg_rating != null) {
      const rating = parseFloat(recipe.avg_rating);
      if (rating >= 4.5) { score += 18; reasons.push('FAMILY_FAVORITE'); }
      else if (rating >= 3.5) { score += 12; }
      else if (rating >= 2.5) { score += 4; }
      else if (rating >= 1.5) { score -= 6; }
      else { score -= 15; }
    }
    // Family favorites (ACTIVE members only)
    if (recipe.fav_count > 0) {
      score += Math.min(recipe.fav_count * 4, 8);
      if (recipe.fav_count >= 2) reasons.push('FAMILY_FAVORITE');
    }
    // Active wishes
    if (recipe.wish_count > 0) {
      score += Math.min(6 + (recipe.wish_count - 1) * 2, 12);
      reasons.push('WISH_MATCH');
    }

    // Meal type match
    if (recipe.matches_meal) { score += 8; }

    // Cook time
    if (recipe.cook_time_minutes && recipe.cook_time_minutes <= 20) { score += 4; reasons.push('QUICK_TO_COOK'); }

    // Repeat penalty — read from settings
    const lastMade = context.history.find(h => h.recipe_id === recipe.id);
    if (lastMade) {
      const daysAgo = Math.floor((Date.now() - new Date(lastMade.meal_date).getTime()) / 86400000);
      if (daysAgo <= settings.repeat_strong_days) { score -= 40; }
      else if (daysAgo <= settings.repeat_penalty_days) {
        const t = (daysAgo - settings.repeat_strong_days) / (settings.repeat_penalty_days - settings.repeat_strong_days);
        score -= Math.round(25 - t * 10);
      }
      else if (daysAgo <= settings.repeat_recover_days) {
        const t = (daysAgo - settings.repeat_penalty_days) / (settings.repeat_recover_days - settings.repeat_penalty_days);
        score -= Math.round(12 - t * 12);
      }
    }

    // Inventory match
    if (recipe._invMatch) {
      const inv = recipe._invMatch;
      if (inv.matchRatio >= 0.6) { score += 14; reasons.push('HIGH_INVENTORY_MATCH'); }
      else if (inv.matchRatio >= 0.3) { score += 7; }
      if (inv.expiringMatch) { score += 10; reasons.push('USE_EXPIRING_INGREDIENT'); }
    }

    // One person profile (diners_count=1)
    if (context.diners_count === 1) {
      if (recipe.cook_time_minutes && recipe.cook_time_minutes <= 15) score += 8;
      const ingCount = (context.ingredientMap[recipe.id] || []).length;
      if (ingCount > 0 && ingCount <= 4) score += 5;
    }

    // Mode adjustments
    if (context.mode === 'USE_INVENTORY') {
      score *= 1.3;
    } else if (context.mode === 'TRY_DIFFERENT') {
      if (lastMade) score -= 15;
    }

    // Random perturbation (seedable)
    score += context.randomFn() * 12 - 6;

    return { score, reasons };
  }

  // Validate locked recipes exist, accessible, and pass hard filters
  function validateLocked(lockedIds, candidates, targetCount) {
    if (lockedIds.length > targetCount) {
      throw new ApiError(422, 'INVALID_LOCKED_RECIPES', `锁定菜谱数(${lockedIds.length})超过目标数(${targetCount})`);
    }
    const candidateIds = new Set(candidates.map(c => c.id));
    for (const id of lockedIds) {
      if (!candidateIds.has(id)) {
        throw new ApiError(422, 'INVALID_LOCKED_RECIPES', `锁定菜谱 ${id} 不存在或不可访问`);
      }
    }
  }

  // Generate random meal recommendations
  async function generateRandomMeal(familyId, userId, params) {
    return access(familyId, userId, null, false, async tx => {
      const { meal_date, meal_type, diners_count, mode = 'BALANCED', target_count = 3, locked_recipe_ids = [] } = params;
      const rng = params._seed != null ? createRng(params._seed) : randomFn;

      const settings = await fetchSettings(tx, familyId);
      const activeMembers = await fetchActiveMembers(tx, familyId);
      const activeMemberIds = activeMembers.map(m => m.user_id);

      let candidates = await fetchCandidates(tx, familyId, meal_type, activeMemberIds);
      candidates = dedupFamilyVariants(candidates);

      const warnings = [];
      candidates = filterMealType(candidates, meal_type, warnings);
      candidates = filterAllergens(candidates, warnings);

      // Validate locked
      validateLocked(locked_recipe_ids, candidates, target_count);

      const history = await fetchRecentHistory(tx, familyId, settings.repeat_recover_days);
      const inventory = await fetchInventory(tx, familyId);
      const pantry = await fetchPantry(tx, familyId);
      const unitsMap = await loadUnitsMap(tx);
      const ingredientMap = await fetchRecipeIngredients(tx, candidates.map(c => c.id));

      // Compute inventory match for each candidate
      for (const c of candidates) {
        c._ingredient_ids = (ingredientMap[c.id] || []).map(i => i.ingredient_id).filter(Boolean);
        c._invMatch = computeInventoryMatch(c, ingredientMap, inventory, pantry, unitsMap);
      }

      const context = { history, inventory, mode, meal_type, settings, diners_count, ingredientMap, randomFn: rng };

      // Locked recipes first
      const selected = [];
      const locked = candidates.filter(c => locked_recipe_ids.includes(c.id));
      for (const r of locked) {
        const { score, reasons } = scoreRecipe(r, context);
        selected.push({ recipe: r, score, reasons, locked: true });
      }

      // Score remaining
      const remaining = candidates.filter(c => !locked_recipe_ids.includes(c.id));
      const scored = remaining.map(r => {
        const { score, reasons } = scoreRecipe(r, context);
        return { recipe: r, score, reasons, locked: false };
      }).sort((a, b) => b.score - a.score);

      // Greedy selection with diversity — consider already-selected
      const selectedProteinSources = new Set(locked.map(r => r.protein_source_code).filter(Boolean));
      const selectedCookMethods = new Set(locked.map(r => r.cooking_method_code).filter(Boolean));

      for (const item of scored) {
        if (selected.length >= target_count) break;
        const protein = item.recipe.protein_source_code;
        const cookMethod = item.recipe.cooking_method_code;
        // Diversity penalty: avoid 3x same protein or 3x same cook method
        const proteinCount = selected.filter(s => s.recipe.protein_source_code === protein).length;
        const methodCount = selected.filter(s => s.recipe.cooking_method_code === cookMethod).length;
        if (protein && proteinCount >= 2) continue;
        if (cookMethod && methodCount >= 2) continue;
        selected.push(item);
        if (protein) selectedProteinSources.add(protein);
        if (cookMethod) selectedCookMethods.add(cookMethod);
      }

      // If not enough after diversity filter, relax and fill
      if (selected.length < target_count) {
        warnings.push({ code: 'CANDIDATE_SHORTAGE', detail: `候选不足，已放宽多样性约束，实际返回${selected.length}/${target_count}` });
        for (const item of scored) {
          if (selected.length >= target_count) break;
          if (selected.some(s => s.recipe.id === item.recipe.id)) continue;
          selected.push(item);
        }
      }

      return {
        recipes: selected.map(s => ({
          id: s.recipe.id,
          name: s.recipe.name,
          kind: s.recipe.kind,
          cook_time_minutes: s.recipe.cook_time_minutes,
          locked: s.locked,
          score: Math.round(s.score),
          reasons: s.reasons,
          protein_source_code: s.recipe.protein_source_code,
          cooking_method_code: s.recipe.cooking_method_code
        })),
        score_summary: { mode, target_count, selected: selected.length, diners_count },
        reasons: [...new Set(selected.flatMap(s => s.reasons))],
        warnings
      };
    });
  }

  // Generate weekly plan (DRAFT) — foundation fixes only
  async function generateWeeklyPlan(familyId, userId, params) {
    return access(familyId, userId, ['OWNER', 'ADMIN'], true, async tx => {
      const { week_start, mode = 'BALANCED', preserve_locked_from_plan_id } = params;
      const rng = params._seed != null ? createRng(params._seed) : randomFn;

      const settings = await fetchSettings(tx, familyId);
      const activeMembers = await fetchActiveMembers(tx, familyId);
      const activeMemberIds = activeMembers.map(m => m.user_id);

      const breakfastCount = settings.breakfast_target_count || 2;
      const lunchCount = settings.lunch_target_count || 2;
      const dinnerCount = settings.dinner_target_count || 3;

      let lockedItems = [];
      if (preserve_locked_from_plan_id) {
        lockedItems = (await tx.query(`
          SELECT * FROM weekly_plan_items WHERE weekly_plan_id=$1 AND locked=true
        `, [preserve_locked_from_plan_id])).rows;
      }

      const planId = randomUUID();
      await tx.query(`INSERT INTO weekly_plans(id,family_id,week_start_date,status,generation_mode,created_by_user_id)
        VALUES($1,$2,$3,'DRAFT',$4,$5)`, [planId, familyId, week_start, mode, userId]);

      const mealTypes = [
        { type: 'BREAKFAST', count: breakfastCount },
        { type: 'LUNCH', count: lunchCount },
        { type: 'DINNER', count: dinnerCount }
      ];

      const weekStart = new Date(week_start);
      const history = await fetchRecentHistory(tx, familyId, settings.repeat_recover_days);
      const inventory = await fetchInventory(tx, familyId);
      const pantry = await fetchPantry(tx, familyId);
      const unitsMap = await loadUnitsMap(tx);

      // in-plan recent history for repeat penalty (not permanent ban)
      const inPlanHistory = [];
      let sortOrder = 0;

      for (let day = 0; day < 7; day++) {
        const planDate = new Date(weekStart);
        planDate.setDate(planDate.getDate() + day);
        const dateStr = planDate.toISOString().split('T')[0];

        for (const { type, count } of mealTypes) {
          // FIX: fetch candidates per meal_type, not reuse DINNER
          let candidates = await fetchCandidates(tx, familyId, type, activeMemberIds);
          candidates = dedupFamilyVariants(candidates);
          const warnings = [];
          candidates = filterMealType(candidates, type, warnings);
          candidates = filterAllergens(candidates, warnings);

          const ingredientMap = await fetchRecipeIngredients(tx, candidates.map(c => c.id));
          for (const c of candidates) {
            c._ingredient_ids = (ingredientMap[c.id] || []).map(i => i.ingredient_id).filter(Boolean);
            c._invMatch = computeInventoryMatch(c, ingredientMap, inventory, pantry, unitsMap);
          }

          const dayLocked = lockedItems.filter(i => i.plan_date === dateStr && i.meal_type === type);
          const lockedIds = dayLocked.map(i => i.recipe_id);

          // Combine real history + in-plan history for repeat penalty
          const combinedHistory = [...history, ...inPlanHistory];
          const context = { history: combinedHistory, inventory, mode, meal_type: type, settings, diners_count: settings.default_diners, ingredientMap, randomFn: rng };

          const remaining = candidates.filter(c => !lockedIds.includes(c.id));
          const scored = remaining.map(c => {
            const { score } = scoreRecipe(c, context);
            return { recipe: c, score };
          }).sort((a, b) => b.score - a.score);

          // FIX: no permanent usedRecipeIds ban; allow repeats with penalty
          const selected = scored.slice(0, count - dayLocked.length);

          for (const item of dayLocked) {
            await tx.query(`INSERT INTO weekly_plan_items(id,weekly_plan_id,plan_date,meal_type,recipe_id,sort_order,locked,added_by_user_id,source)
              VALUES($1,$2,$3,$4,$5,$6,true,$7,'GENERATED')`,
              [randomUUID(), planId, dateStr, type, item.recipe_id, sortOrder++, userId]);
            inPlanHistory.push({ recipe_id: item.recipe_id, meal_date: dateStr });
          }
          for (const s of selected) {
            await tx.query(`INSERT INTO weekly_plan_items(id,weekly_plan_id,plan_date,meal_type,recipe_id,sort_order,locked,added_by_user_id,source)
              VALUES($1,$2,$3,$4,$5,$6,false,$7,'GENERATED')`,
              [randomUUID(), planId, dateStr, type, s.recipe.id, sortOrder++, userId]);
            inPlanHistory.push({ recipe_id: s.recipe.id, meal_date: dateStr });
          }
        }
      }

      const plan = (await tx.query('SELECT * FROM weekly_plans WHERE id=$1', [planId])).rows[0];
      const items = (await tx.query('SELECT * FROM weekly_plan_items WHERE weekly_plan_id=$1 ORDER BY plan_date, meal_type, sort_order', [planId])).rows;
      return { ...plan, items };
    });
  }

  async function confirmWeeklyPlan(familyId, userId, planId) {
    return access(familyId, userId, ['OWNER', 'ADMIN'], true, async tx => {
      const plan = (await tx.query('SELECT * FROM weekly_plans WHERE id=$1 AND family_id=$2', [planId, familyId])).rows[0];
      if (!plan) throw new ApiError(404, 'PLAN_NOT_FOUND', '周计划不存在');
      if (plan.status !== 'DRAFT') throw new ApiError(409, 'PLAN_NOT_DRAFT', '只能确认 DRAFT 状态的周计划');
      await tx.query(`UPDATE weekly_plans SET status='ARCHIVED', updated_at=now()
        WHERE family_id=$1 AND week_start_date=$2 AND status='ACTIVE'`, [familyId, plan.week_start_date]);
      await tx.query(`UPDATE weekly_plans SET status='ACTIVE', confirmed_by_user_id=$2, updated_at=now() WHERE id=$1`, [planId, userId]);
      const updated = (await tx.query('SELECT * FROM weekly_plans WHERE id=$1', [planId])).rows[0];
      return updated;
    });
  }

  // Fridge cooking recommendations — real required ingredient + unit + pantry
  async function getFridgeCooking(familyId, userId) {
    return access(familyId, userId, null, false, async tx => {
      const settings = await fetchSettings(tx, familyId);
      const activeMembers = await fetchActiveMembers(tx, familyId);
      const activeMemberIds = activeMembers.map(m => m.user_id);

      let candidates = await fetchCandidates(tx, familyId, 'DINNER', activeMemberIds);
      candidates = dedupFamilyVariants(candidates);

      const inventory = await fetchInventory(tx, familyId);
      const pantry = await fetchPantry(tx, familyId);
      const unitsMap = await loadUnitsMap(tx);
      const ingredientMap = await fetchRecipeIngredients(tx, candidates.map(c => c.id));

      const results = candidates.map(c => {
        const invMatch = computeInventoryMatch(c, ingredientMap, inventory, pantry, unitsMap);
        const required = invMatch.requiredCount || 0;
        const have = invMatch.availableCount;
        const missing = invMatch.missingCount;
        let status = 'NEEDS_SHOPPING';
        if (required > 0 && have === required) status = 'CAN_COOK_NOW';
        else if (required > 0 && missing <= 2) status = 'MISSING_FEW';
        const reasons = [];
        if (invMatch.expiringMatch) reasons.push('USE_EXPIRING_INGREDIENT');
        return {
          recipe: c,
          required_count: required,
          available_count: have,
          missing_count: missing,
          missing_ingredients: invMatch.missingIngredients,
          status,
          reasons
        };
      }).filter(r => r.required_count > 0)
        .sort((a, b) => {
          const order = { CAN_COOK_NOW: 0, MISSING_FEW: 1, NEEDS_SHOPPING: 2 };
          if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
          return b.available_count - a.available_count;
        })
        .slice(0, 20);

      return results.map(r => ({
        id: r.recipe.id,
        name: r.recipe.name,
        kind: r.recipe.kind,
        cook_time_minutes: r.recipe.cook_time_minutes,
        status: r.status,
        available_count: r.available_count,
        required_count: r.required_count,
        missing_count: r.missing_count,
        missing_ingredients: r.missing_ingredients,
        reasons: r.reasons
      }));
    });
  }

  return { generateRandomMeal, generateWeeklyPlan, confirmWeeklyPlan, getFridgeCooking };
}

module.exports = { createRecommendationService };
