// Recommendation Engine — V4 (12E Contract Seal)
// Shared scoring for weekly plans, random meal, fridge cooking, one-person meals.
// Hard filters: access, deleted, family variant dedup, meal type, allergen.
// Quantity-aware inventory match with unit conversion.
// Production _seed is REJECTED; deterministic RNG only via service dependency injection.
const { randomUUID } = require('node:crypto');
const { withTransaction } = require('./db');
const { ApiError } = require('./errors');
const { authorize } = require('./family-access');
const { areUnitsCompatible, loadUnitsMap, toBaseQuantity } = require('./unit-conversion');

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

  async function fetchSettings(tx, familyId) {
    const row = (await tx.query('SELECT * FROM family_settings WHERE family_id=$1', [familyId])).rows[0];
    return row || {
      repeat_strong_days: 7, repeat_penalty_days: 14, repeat_recover_days: 28,
      random_default_mode: 'BALANCED', default_diners: 2
    };
  }

  async function fetchActiveMembers(tx, familyId) {
    return (await tx.query(
      'SELECT user_id, role FROM family_members WHERE family_id=$1 AND status=$2',
      [familyId, 'ACTIVE']
    )).rows;
  }

  // Fetch user allergens for ACTIVE family members
  async function fetchFamilyAllergens(tx, familyId, activeMemberIds) {
    if (activeMemberIds.length === 0) return new Set();
    const rows = (await tx.query(
      'SELECT DISTINCT allergen_code FROM user_allergens WHERE family_id=$1 AND user_id = ANY($2)',
      [familyId, activeMemberIds]
    )).rows;
    return new Set(rows.map(r => r.allergen_code));
  }

  // Fetch disliked ingredients for ACTIVE family members
  async function fetchDislikedIngredients(tx, familyId, activeMemberIds) {
    if (activeMemberIds.length === 0) return new Set();
    const rows = (await tx.query(
      'SELECT DISTINCT ingredient_id FROM user_disliked_ingredients WHERE family_id=$1 AND user_id = ANY($2)',
      [familyId, activeMemberIds]
    )).rows;
    return new Set(rows.map(r => r.ingredient_id));
  }

  // Fetch candidate recipes with enrichment
  async function fetchCandidates(tx, familyId, mealType) {
    return (await tx.query(`
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
  }

  function dedupFamilyVariants(candidates) {
    const familyVariants = new Set();
    for (const c of candidates) {
      if (c.kind === 'FAMILY' && c.parent_recipe_id) familyVariants.add(c.parent_recipe_id);
    }
    return candidates.filter(c => !(c.kind === 'BASE' && familyVariants.has(c.id)));
  }

  // Hard filter: meal_type
  function filterMealType(candidates, mealType, warnings) {
    const result = [];
    for (const c of candidates) {
      if (c.meal_type_count > 0 && !c.matches_meal) continue;
      if (c.meal_type_count === 0) {
        warnings.push({ code: 'MEAL_TYPE_UNTAGGED', recipe_id: c.id, recipe_name: c.name });
      }
      result.push(c);
    }
    return result;
  }

  // Hard filter: allergens — REAL exclusion, not warning
  function filterAllergens(candidates, familyAllergens, warnings) {
    if (familyAllergens.size === 0) return candidates;
    const result = [];
    for (const c of candidates) {
      const recipeAllergens = c.allergen_codes || [];
      const overlap = recipeAllergens.filter(a => familyAllergens.has(a));
      if (overlap.length > 0) {
        warnings.push({ code: 'ALLERGEN_EXCLUDED', recipe_id: c.id, recipe_name: c.name, allergens: overlap });
        continue;
      }
      result.push(c);
    }
    return result;
  }

  // SHARED candidate pipeline — Random, Weekly, Fridge all use this
  async function prepareEligibleCandidates(tx, familyId, mealType, activeMemberIds, warnings) {
    let candidates = await fetchCandidates(tx, familyId, mealType);
    candidates = dedupFamilyVariants(candidates);
    candidates = filterMealType(candidates, mealType, warnings);
    const familyAllergens = await fetchFamilyAllergens(tx, familyId, activeMemberIds);
    candidates = filterAllergens(candidates, familyAllergens, warnings);
    return { candidates, familyAllergens };
  }

  // Fetch recent meal history — returns latest occurrence per recipe
  async function fetchRecentHistory(tx, familyId, days) {
    const rows = (await tx.query(`
      SELECT mi.recipe_id, m.meal_date
      FROM meal_items mi
      JOIN meals m ON m.id = mi.meal_id
      WHERE m.family_id=$1 AND m.status IN ('CONFIRMED','COOKING','COMPLETED')
        AND m.meal_date >= CURRENT_DATE - $2 * INTERVAL '1 day'
      ORDER BY m.meal_date DESC
    `, [familyId, days])).rows;
    // Deduplicate: keep latest meal_date per recipe_id
    const latest = new Map();
    for (const row of rows) {
      if (!latest.has(row.recipe_id) || new Date(row.meal_date) > new Date(latest.get(row.recipe_id))) {
        latest.set(row.recipe_id, row.meal_date);
      }
    }
    return Array.from(latest.entries()).map(([recipe_id, meal_date]) => ({ recipe_id, meal_date }));
  }

  // Combine real history + in-plan history, keeping latest occurrence per recipe
  function combineHistory(realHistory, inPlanHistory) {
    const latest = new Map();
    for (const h of realHistory) latest.set(h.recipe_id, h.meal_date);
    for (const h of inPlanHistory) {
      if (!latest.has(h.recipe_id) || new Date(h.meal_date) > new Date(latest.get(h.recipe_id))) {
        latest.set(h.recipe_id, h.meal_date);
      }
    }
    return Array.from(latest.entries()).map(([recipe_id, meal_date]) => ({ recipe_id, meal_date }));
  }

  async function fetchInventory(tx, familyId) {
    return (await tx.query(`
      SELECT fi.ingredient_id, fi.quantity, fi.unit_code, fi.expiry_date,
             i.category_code, i.default_unit_code, i.display_name
      FROM fridge_items fi
      JOIN ingredients i ON i.id = fi.ingredient_id
      WHERE fi.family_id=$1
    `, [familyId])).rows;
  }

  async function fetchPantry(tx, familyId) {
    return (await tx.query(`
      SELECT ps.ingredient_id, ps.assume_available, ps.quantity, ps.unit_code
      FROM pantry_staples ps
      WHERE ps.family_id=$1
    `, [familyId])).rows;
  }

  async function fetchRecipeIngredients(tx, recipeIds) {
    if (recipeIds.length === 0) return {};
    const rows = (await tx.query(`
      SELECT recipe_id, ingredient_id, quantity, unit_code, required, type,
             i.display_name as ingredient_name
      FROM recipe_ingredients ri
      JOIN ingredients i ON i.id = ri.ingredient_id
      WHERE recipe_id = ANY($1)
    `, [recipeIds])).rows;
    const map = {};
    rows.forEach(r => {
      if (!map[r.recipe_id]) map[r.recipe_id] = [];
      map[r.recipe_id].push(r);
    });
    return map;
  }

  // Compute expiry bonus tier (0-1 high, 2-3 medium-high, 4-7 light, >7 0, expired 0)
  function expiryBonus(daysToExpiry) {
    if (daysToExpiry < 0) return 0; // expired
    if (daysToExpiry <= 1) return 12;
    if (daysToExpiry <= 3) return 8;
    if (daysToExpiry <= 7) return 4;
    return 0;
  }

  // Per-recipe serving scale: dinersCount / recipe.base_servings
  // Returns null for invalid data (caller should exclude + warn)
  function getServingScale(recipe, dinersCount) {
    const base = parseFloat(recipe?.base_servings);
    const diners = parseFloat(dinersCount);
    if (!Number.isFinite(base) || base <= 0) return null;
    if (!Number.isFinite(diners) || diners <= 0) return null;
    return diners / base;
  }

  // Quantity-aware inventory match
  // dinersScale = dinersCount / recipe.base_servings (per-recipe)
  function computeInventoryMatch(recipe, ingredientMap, inventory, pantry, unitsMap, dinersScale) {
    const ings = ingredientMap[recipe.id] || [];
    const required = ings.filter(i => i.required && i.ingredient_id);
    if (required.length === 0) {
      return { matchRatio: 0, availableCount: 0, missingCount: 0, missingIngredients: [], expiringBonus: 0, requiredCount: 0, uncertainIngredients: [] };
    }

    const invByIngredient = new Map();
    for (const inv of inventory) {
      if (!invByIngredient.has(inv.ingredient_id)) invByIngredient.set(inv.ingredient_id, []);
      invByIngredient.get(inv.ingredient_id).push(inv);
    }
    const pantryByIngredient = new Map();
    for (const p of pantry) {
      if (p.assume_available && p.ingredient_id) pantryByIngredient.set(p.ingredient_id, p);
    }

    const now = new Date();
    let availableCount = 0;
    const missingIngredients = [];
    const uncertainIngredients = [];
    let totalExpiryBonus = 0;

    for (const ing of required) {
      const scale = dinersScale || 1;
      const recipeQty = ing.quantity != null ? parseFloat(ing.quantity) * scale : null;
      const recipeUnit = ing.unit_code;

      // Pantry canonical assume_available = satisfied
      if (pantryByIngredient.has(ing.ingredient_id)) {
        availableCount++;
        continue;
      }

      // If no quantity or TEXT unit, cannot reliably compare
      if (recipeQty == null || isNaN(recipeQty) || !recipeUnit) {
        uncertainIngredients.push({ ingredient_id: ing.ingredient_id, name: ing.ingredient_name });
        continue;
      }

      const recipeBase = toBaseQuantity(recipeQty, recipeUnit, unitsMap);
      if (!recipeBase.converted && unitsMap.get(recipeUnit)?.dimension !== 'COUNT') {
        // TEXT or unknown unit — cannot compare quantity
        uncertainIngredients.push({ ingredient_id: ing.ingredient_id, name: ing.ingredient_name });
        continue;
      }

      // Sum compatible non-expired fridge batches
      let availableBase = 0;
      let bestExpiryBonus = 0;
      const fridgeItems = invByIngredient.get(ing.ingredient_id) || [];
      for (const fi of fridgeItems) {
        if (!areUnitsCompatible(recipeUnit, fi.unit_code, unitsMap)) continue;
        // Expired items don't count
        if (fi.expiry_date && new Date(fi.expiry_date) < now) continue;
        const fiBase = toBaseQuantity(parseFloat(fi.quantity), fi.unit_code, unitsMap);
        if (fiBase.converted || unitsMap.get(fi.unit_code)?.dimension === 'COUNT') {
          availableBase += fiBase.quantity;
        }
        // Expiry bonus only if this batch is actually used (recipe needs it)
        if (fi.expiry_date) {
          const daysToExpiry = Math.ceil((new Date(fi.expiry_date) - now) / 86400000);
          bestExpiryBonus = Math.max(bestExpiryBonus, expiryBonus(daysToExpiry));
        }
      }

      if (availableBase >= recipeBase.quantity) {
        availableCount++;
        totalExpiryBonus += bestExpiryBonus;
      } else {
        missingIngredients.push({
          ingredient_id: ing.ingredient_id,
          name: ing.ingredient_name,
          required_quantity: recipeQty,
          unit_code: recipeUnit,
          available_quantity: availableBase
        });
      }
    }

    const satisfied = availableCount;
    const uncertain = uncertainIngredients.length;
    // CAN_COOK_NOW requires all required items satisfied (no uncertain blocking)
    return {
      matchRatio: satisfied / required.length,
      availableCount: satisfied,
      missingCount: required.length - satisfied - uncertain,
      missingIngredients,
      expiringBonus: totalExpiryBonus,
      requiredCount: required.length,
      uncertainIngredients,
      canCookNow: uncertain === 0 && satisfied === required.length
    };
  }

  // Score a single recipe — inventory/expiry contributions are separate for USE_INVENTORY mode
  function scoreRecipe(recipe, context) {
    let score = 50;
    const reasons = [];
    const settings = context.settings;
    let inventoryContribution = 0;
    let expiryContribution = 0;

    // Family rating
    if (recipe.avg_rating != null) {
      const rating = parseFloat(recipe.avg_rating);
      if (rating >= 4.5) { score += 18; reasons.push('FAMILY_FAVORITE'); }
      else if (rating >= 3.5) { score += 12; }
      else if (rating >= 2.5) { score += 4; }
      else if (rating >= 1.5) { score -= 6; }
      else { score -= 15; }
    }
    // Family favorites
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

    // Disliked ingredient soft penalty
    if (context.dislikedSet && context.dislikedSet.size > 0) {
      const ings = context.ingredientMap[recipe.id] || [];
      const hasDisliked = ings.some(i => i.ingredient_id && context.dislikedSet.has(i.ingredient_id));
      if (hasDisliked) {
        score -= 10;
        reasons.push('DISLIKED_INGREDIENT');
      }
    }

    // Repeat penalty — uses latest occurrence (combined history)
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

    // Inventory match contribution (separate for USE_INVENTORY)
    if (recipe._invMatch) {
      const inv = recipe._invMatch;
      if (inv.matchRatio >= 0.6) { inventoryContribution += 14; reasons.push('HIGH_INVENTORY_MATCH'); }
      else if (inv.matchRatio >= 0.3) { inventoryContribution += 7; }
      expiryContribution += inv.expiringBonus || 0;
      if (inv.expiringBonus > 0) reasons.push('USE_EXPIRING_INGREDIENT');
    }

    // One person profile — real effect: short cook time + few ingredients
    if (context.diners_count === 1) {
      if (recipe.cook_time_minutes && recipe.cook_time_minutes <= 15) score += 8;
      const ingCount = (context.ingredientMap[recipe.id] || []).length;
      if (ingCount > 0 && ingCount <= 4) score += 5;
      if (recipe.cook_time_minutes && recipe.cook_time_minutes <= 10) score += 4;
    }

    // Mode: USE_INVENTORY only boosts inventory + expiry, NOT whole score
    if (context.mode === 'USE_INVENTORY') {
      score += inventoryContribution * 1.5 + expiryContribution * 1.5;
    } else {
      score += inventoryContribution + expiryContribution;
    }
    // TRY_DIFFERENT: extra penalty for recently made
    if (context.mode === 'TRY_DIFFERENT' && lastMade) {
      score -= 15;
    }

    // Random perturbation
    score += context.randomFn() * 12 - 6;

    return { score, reasons, inventoryContribution, expiryContribution };
  }

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

  // Generate random meal — production _seed is NOT accepted
  async function generateRandomMeal(familyId, userId, params) {
    return access(familyId, userId, null, false, async tx => {
      const { meal_date, meal_type, diners_count, mode = 'BALANCED', target_count = 3, locked_recipe_ids = [] } = params;

      const settings = await fetchSettings(tx, familyId);
      const activeMembers = await fetchActiveMembers(tx, familyId);
      const activeMemberIds = activeMembers.map(m => m.user_id);

      const warnings = [];
      const { candidates } = await prepareEligibleCandidates(tx, familyId, meal_type, activeMemberIds, warnings);
      const dislikedSet = await fetchDislikedIngredients(tx, familyId, activeMemberIds);

      validateLocked(locked_recipe_ids, candidates, target_count);

      const history = await fetchRecentHistory(tx, familyId, settings.repeat_recover_days);
      const inventory = await fetchInventory(tx, familyId);
      const pantry = await fetchPantry(tx, familyId);
      const unitsMap = await loadUnitsMap(tx);
      const ingredientMap = await fetchRecipeIngredients(tx, candidates.map(c => c.id));

      const dinersForScale = diners_count || settings.default_diners || 2;
      const validCandidates = [];
      for (const c of candidates) {
        const scale = getServingScale(c, dinersForScale);
        if (scale === null) {
          warnings.push(`INVALID_BASE_SERVINGS: recipe ${c.id} base_servings=${c.base_servings}`);
          continue;
        }
        c._ingredient_ids = (ingredientMap[c.id] || []).map(i => i.ingredient_id).filter(Boolean);
        c._invMatch = computeInventoryMatch(c, ingredientMap, inventory, pantry, unitsMap, scale);
        validCandidates.push(c);
      }
      candidates.length = 0;
      candidates.push(...validCandidates);

      const context = { history, mode, meal_type, settings, diners_count, ingredientMap, randomFn, dislikedSet };

      const selected = [];
      const locked = candidates.filter(c => locked_recipe_ids.includes(c.id));
      for (const r of locked) {
        const { score, reasons } = scoreRecipe(r, context);
        selected.push({ recipe: r, score, reasons, locked: true });
      }

      const remaining = candidates.filter(c => !locked_recipe_ids.includes(c.id));
      const scored = remaining.map(r => {
        const { score, reasons } = scoreRecipe(r, context);
        return { recipe: r, score, reasons, locked: false };
      }).sort((a, b) => b.score - a.score);

      // Greedy diversity selection
      for (const item of scored) {
        if (selected.length >= target_count) break;
        const protein = item.recipe.protein_source_code;
        const cookMethod = item.recipe.cooking_method_code;
        const proteinCount = selected.filter(s => s.recipe.protein_source_code === protein).length;
        const methodCount = selected.filter(s => s.recipe.cooking_method_code === cookMethod).length;
        if (protein && proteinCount >= 2) continue;
        if (cookMethod && methodCount >= 2) continue;
        selected.push(item);
      }

      // If not enough after diversity, relax
      let diversityRelaxed = false;
      if (selected.length < target_count && scored.length > selected.length) {
        diversityRelaxed = true;
        for (const item of scored) {
          if (selected.length >= target_count) break;
          if (selected.some(s => s.recipe.id === item.recipe.id)) continue;
          selected.push(item);
        }
      }

      // Only warn CANDIDATE_SHORTAGE if truly fewer than target
      if (selected.length < target_count) {
        warnings.push({ code: 'CANDIDATE_SHORTAGE', detail: `候选不足，实际返回${selected.length}/${target_count}` });
      } else if (diversityRelaxed) {
        warnings.push({ code: 'DIVERSITY_RELAXED', detail: '多样性约束已放宽以满足目标数量' });
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

  // Generate weekly plan
  async function generateWeeklyPlan(familyId, userId, params) {
    return access(familyId, userId, ['OWNER', 'ADMIN'], true, async tx => {
      const { week_start, mode = 'BALANCED', preserve_locked_from_plan_id } = params;

      const settings = await fetchSettings(tx, familyId);
      const activeMembers = await fetchActiveMembers(tx, familyId);
      const activeMemberIds = activeMembers.map(m => m.user_id);

      const breakfastCount = settings.breakfast_target_count || 2;
      const lunchCount = settings.lunch_target_count || 2;
      const dinnerCount = settings.dinner_target_count || 3;

      // Family-isolated locked items: source plan must belong to current family
      let lockedItems = [];
      if (preserve_locked_from_plan_id) {
        const sourcePlan = (await tx.query(
          'SELECT id FROM weekly_plans WHERE id=$1 AND family_id=$2',
          [preserve_locked_from_plan_id, familyId]
        )).rows[0];
        if (!sourcePlan) {
          throw new ApiError(404, 'PLAN_NOT_FOUND', '来源周计划不存在或不属于当前家庭');
        }
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
      const realHistory = await fetchRecentHistory(tx, familyId, settings.repeat_recover_days);
      const inventory = await fetchInventory(tx, familyId);
      const pantry = await fetchPantry(tx, familyId);
      const unitsMap = await loadUnitsMap(tx);
      const dislikedSet = await fetchDislikedIngredients(tx, familyId, activeMemberIds);

      const inPlanHistory = [];
      let sortOrder = 0;

      for (let day = 0; day < 7; day++) {
        const planDate = new Date(weekStart);
        planDate.setDate(planDate.getDate() + day);
        const dateStr = planDate.toISOString().split('T')[0];

        for (const { type, count } of mealTypes) {
          const warnings = [];
          const { candidates } = await prepareEligibleCandidates(tx, familyId, type, activeMemberIds, warnings);
          const ingredientMap = await fetchRecipeIngredients(tx, candidates.map(c => c.id));

          const weeklyDiners = settings.default_diners || 2;
          const weeklyValid = [];
          for (const c of candidates) {
            const scale = getServingScale(c, weeklyDiners);
            if (scale === null) {
              warnings.push(`INVALID_BASE_SERVINGS: recipe ${c.id} base_servings=${c.base_servings}`);
              continue;
            }
            c._ingredient_ids = (ingredientMap[c.id] || []).map(i => i.ingredient_id).filter(Boolean);
            c._invMatch = computeInventoryMatch(c, ingredientMap, inventory, pantry, unitsMap, scale);
            weeklyValid.push(c);
          }
          candidates.length = 0;
          candidates.push(...weeklyValid);

          const dayLocked = lockedItems.filter(i => i.plan_date === dateStr && i.meal_type === type);
          const lockedIds = dayLocked.map(i => i.recipe_id);

          // Validate locked recipes pass hard filters
          for (const lid of lockedIds) {
            if (!candidates.some(c => c.id === lid)) {
              throw new ApiError(422, 'INVALID_LOCKED_RECIPES', `锁定菜谱 ${lid} 不符合当前餐次过滤条件`);
            }
          }

          // Combined history with latest occurrence
          const combinedHistory = combineHistory(realHistory, inPlanHistory);
          const context = { history: combinedHistory, mode, meal_type: type, settings, diners_count: settings.default_diners, ingredientMap, randomFn, dislikedSet };

          const remaining = candidates.filter(c => !lockedIds.includes(c.id));
          const scored = remaining.map(c => {
            const { score } = scoreRecipe(c, context);
            return { recipe: c, score };
          }).sort((a, b) => b.score - a.score);

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
      return (await tx.query('SELECT * FROM weekly_plans WHERE id=$1', [planId])).rows[0];
    });
  }

  // Fridge cooking — uses shared candidate pipeline + quantity-aware match
  async function getFridgeCooking(familyId, userId) {
    return access(familyId, userId, null, false, async tx => {
      const settings = await fetchSettings(tx, familyId);
      const activeMembers = await fetchActiveMembers(tx, familyId);
      const activeMemberIds = activeMembers.map(m => m.user_id);

      const warnings = [];
      const { candidates } = await prepareEligibleCandidates(tx, familyId, 'DINNER', activeMemberIds, warnings);

      const inventory = await fetchInventory(tx, familyId);
      const pantry = await fetchPantry(tx, familyId);
      const unitsMap = await loadUnitsMap(tx);
      const ingredientMap = await fetchRecipeIngredients(tx, candidates.map(c => c.id));

      const fridgeDiners = settings.default_diners || 2;

      const results = candidates.map(c => {
        const scale = getServingScale(c, fridgeDiners);
        if (scale === null) {
          warnings.push(`INVALID_BASE_SERVINGS: recipe ${c.id} base_servings=${c.base_servings}`);
          return null;
        }
        const invMatch = computeInventoryMatch(c, ingredientMap, inventory, pantry, unitsMap, scale);
        const required = invMatch.requiredCount || 0;
        const have = invMatch.availableCount;
        const missing = invMatch.missingCount;
        let status = 'NEEDS_SHOPPING';
        if (invMatch.canCookNow) status = 'CAN_COOK_NOW';
        else if (required > 0 && missing <= 2 && invMatch.uncertainIngredients.length === 0) status = 'MISSING_FEW';
        const reasons = [];
        if (invMatch.expiringBonus > 0) reasons.push('USE_EXPIRING_INGREDIENT');
        return {
          recipe: c,
          required_count: required,
          available_count: have,
          missing_count: missing,
          missing_ingredients: invMatch.missingIngredients,
          uncertain_ingredients: invMatch.uncertainIngredients,
          status,
          reasons
        };
      }).filter(Boolean)
        .filter(r => r.required_count > 0)
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
        uncertain_ingredients: r.uncertain_ingredients,
        diners_count_used: settings.default_diners,
        reasons: r.reasons,
        warnings
      }));
    });
  }

  return { generateRandomMeal, generateWeeklyPlan, confirmWeeklyPlan, getFridgeCooking };
}

module.exports = { createRecommendationService };
