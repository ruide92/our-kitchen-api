// Recommendation Engine — V4
// Shared scoring for weekly plans, random meal, fridge cooking, one-person meals.
const { randomUUID } = require('node:crypto');
const { withTransaction } = require('./db');
const { ApiError } = require('./errors');
const { authorize } = require('./family-access');

function createRecommendationService(pool) {
  async function access(familyId, userId, roles, write, work) {
    return withTransaction(pool, async tx => {
      const family = (await tx.query(`SELECT id FROM families WHERE id=$1 AND deleted_at IS NULL${write ? ' FOR UPDATE' : ' FOR SHARE'}`, [familyId])).rows[0];
      if (!family) throw new ApiError(403, 'FAMILY_FORBIDDEN', '你不是该家庭成员');
      await authorize(tx, familyId, userId, roles);
      return work(tx);
    });
  }

  // Fetch candidate recipes with enrichment
  async function fetchCandidates(tx, familyId, mealType) {
    const rows = (await tx.query(`
      SELECT r.*,
        EXISTS(SELECT 1 FROM recipe_meal_types rm WHERE rm.recipe_id=r.id AND rm.meal_type=$2) as matches_meal,
        (SELECT COUNT(*) FROM favorites f WHERE f.recipe_id=r.id) as fav_count,
        (SELECT AVG(rating) FROM ratings rt WHERE rt.recipe_id=r.id AND rt.family_id=$1) as avg_rating,
        (SELECT COUNT(*) FROM wishes w WHERE w.recipe_id=r.id AND w.status='ACTIVE' AND w.family_id=$1) as wish_count
      FROM recipes r
      WHERE r.deleted_at IS NULL
        AND (r.kind='BASE' OR (r.kind='FAMILY' AND r.family_id=$1))
      ORDER BY r.name
    `, [familyId, mealType])).rows;
    return rows;
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

  // Fetch fridge inventory for matching
  async function fetchInventory(tx, familyId) {
    const rows = (await tx.query(`
      SELECT fi.ingredient_id, fi.quantity, fi.unit_code, fi.expiry_date,
             i.category_code, i.default_unit_code
      FROM fridge_items fi
      JOIN ingredients i ON i.id = fi.ingredient_id
      WHERE fi.family_id=$1
    `, [familyId])).rows;
    return rows;
  }

  // Score a single recipe
  function scoreRecipe(recipe, context) {
    let score = 50; // base
    const reasons = [];

    // Family favorite/rating
    if (recipe.avg_rating != null) {
      const rating = parseFloat(recipe.avg_rating);
      if (rating >= 4.5) { score += 18; reasons.push('FAMILY_FAVORITE'); }
      else if (rating >= 3.5) { score += 10; }
      else if (rating >= 2.5) { score += 3; }
      else if (rating < 2.5) { score -= 8; }
    }
    if (recipe.fav_count > 0) { score += Math.min(recipe.fav_count * 3, 8); }
    if (recipe.wish_count > 0) { score += 6; reasons.push('WISH_MATCH'); }

    // Meal type match
    if (recipe.matches_meal) { score += 8; }

    // Cook time
    if (recipe.cook_time_minutes && recipe.cook_time_minutes <= 20) { score += 4; reasons.push('QUICK_TO_COOK'); }

    // Repeat penalty
    const lastMade = context.history.find(h => h.recipe_id === recipe.id);
    if (lastMade) {
      const daysAgo = Math.floor((Date.now() - new Date(lastMade.meal_date).getTime()) / 86400000);
      if (daysAgo <= 7) { score -= 35; }
      else if (daysAgo <= 14) { score -= 18; }
      else if (daysAgo <= 28) { score -= 8; }
    }

    // Inventory match (simplified: check if recipe ingredients overlap with fridge)
    if (context.inventory.length > 0 && recipe._ingredient_ids) {
      const fridgeIds = new Set(context.inventory.map(i => i.ingredient_id));
      const matchCount = recipe._ingredient_ids.filter(id => fridgeIds.has(id)).length;
      if (matchCount > 0 && recipe._ingredient_ids.length > 0) {
        const ratio = matchCount / recipe._ingredient_ids.length;
        if (ratio >= 0.6) { score += 12; reasons.push('HIGH_INVENTORY_MATCH'); }
        else if (ratio >= 0.3) { score += 6; }
      }
      // Expiring soon bonus
      const expiring = context.inventory.filter(i => i.expiry_date && (new Date(i.expiry_date) - new Date()) < 3 * 86400000);
      if (expiring.some(e => recipe._ingredient_ids.includes(e.ingredient_id))) {
        score += 10; reasons.push('USE_EXPIRING_INGREDIENT');
      }
    }

    // Mode adjustments
    if (context.mode === 'USE_INVENTORY') {
      score *= 1.3; // amplify inventory signals
    } else if (context.mode === 'TRY_DIFFERENT') {
      if (lastMade) score -= 15; // stronger repeat penalty
    } else if (context.mode === 'ONE_PERSON') {
      if (recipe.cook_time_minutes && recipe.cook_time_minutes <= 15) score += 8;
      if (recipe._ingredient_ids && recipe._ingredient_ids.length <= 4) score += 5;
    }

    // Random perturbation
    score += Math.random() * 12 - 6;

    return { score, reasons };
  }

  // Fetch recipe ingredients for inventory matching
  async function fetchRecipeIngredients(tx, recipeIds) {
    if (recipeIds.length === 0) return {};
    const rows = (await tx.query(`
      SELECT recipe_id, ingredient_id FROM recipe_ingredients WHERE recipe_id = ANY($1)
    `, [recipeIds])).rows;
    const map = {};
    rows.forEach(r => {
      if (!map[r.recipe_id]) map[r.recipe_id] = [];
      map[r.recipe_id].push(r.ingredient_id);
    });
    return map;
  }

  // Generate random meal recommendations
  async function generateRandomMeal(familyId, userId, params) {
    return access(familyId, userId, null, false, async tx => {
      const { meal_date, meal_type, diners_count, mode = 'BALANCED', target_count = 3, locked_recipe_ids = [] } = params;

      const candidates = await fetchCandidates(tx, familyId, meal_type);
      const history = await fetchRecentHistory(tx, familyId, 28);
      const inventory = await fetchInventory(tx, familyId);
      const ingredientMap = await fetchRecipeIngredients(tx, candidates.map(c => c.id));

      candidates.forEach(c => { c._ingredient_ids = ingredientMap[c.id] || []; });

      const context = { history, inventory, mode, meal_type };

      // Locked recipes first
      const selected = [];
      const locked = candidates.filter(c => locked_recipe_ids.includes(c.id));
      locked.forEach(r => {
        const { score, reasons } = scoreRecipe(r, context);
        selected.push({ recipe: r, score, reasons, locked: true });
      });

      // Score and sort remaining
      const remaining = candidates.filter(c => !locked_recipe_ids.includes(c.id));
      const scored = remaining.map(r => {
        const { score, reasons } = scoreRecipe(r, context);
        return { recipe: r, score, reasons, locked: false };
      }).sort((a, b) => b.score - a.score);

      // Greedy selection with diversity
      const selectedProteinSources = new Set(locked.map(r => r.recipe.protein_source_code).filter(Boolean));
      const selectedCookMethods = new Set(locked.map(r => r.recipe.cooking_method_code).filter(Boolean));

      for (const item of scored) {
        if (selected.length >= target_count) break;
        // Diversity: avoid same protein source 3 times
        const protein = item.recipe.protein_source_code;
        if (protein && selectedProteinSources.has(protein) && selected.filter(s => s.recipe.protein_source_code === protein).length >= 2) continue;
        selected.push(item);
        if (protein) selectedProteinSources.add(protein);
        if (item.recipe.cooking_method_code) selectedCookMethods.add(item.recipe.cooking_method_code);
      }

      return {
        recipes: selected.map(s => ({
          id: s.recipe.id,
          name: s.recipe.name,
          kind: s.recipe.kind,
          cover_image_url: null,
          cook_time_minutes: s.recipe.cook_time_minutes,
          locked: s.locked,
          score: Math.round(s.score),
          reasons: s.reasons
        })),
        score_summary: { mode, target_count, selected: selected.length },
        reasons: selected.flatMap(s => s.reasons)
      };
    });
  }

  // Generate weekly plan (DRAFT)
  async function generateWeeklyPlan(familyId, userId, params) {
    return access(familyId, userId, ['OWNER', 'ADMIN'], true, async tx => {
      const { week_start, mode = 'BALANCED', preserve_locked_from_plan_id } = params;

      // Get settings for target counts
      const settings = (await tx.query('SELECT * FROM family_settings WHERE family_id=$1', [familyId])).rows[0];
      const breakfastCount = settings?.breakfast_target_count || 2;
      const lunchCount = settings?.lunch_target_count || 2;
      const dinnerCount = settings?.dinner_target_count || 3;

      // Get locked items from previous plan if preserving
      let lockedItems = [];
      if (preserve_locked_from_plan_id) {
        lockedItems = (await tx.query(`
          SELECT * FROM weekly_plan_items WHERE weekly_plan_id=$1 AND locked=true
        `, [preserve_locked_from_plan_id])).rows;
      }

      // Create DRAFT plan
      const planId = randomUUID();
      await tx.query(`INSERT INTO weekly_plans(id,family_id,week_start_date,status,generation_mode,created_by_user_id)
        VALUES($1,$2,$3,'DRAFT',$4,$5)`, [planId, familyId, week_start, mode, userId]);

      // Generate 7 days x 3 meals
      const mealTypes = [
        { type: 'BREAKFAST', count: breakfastCount },
        { type: 'LUNCH', count: lunchCount },
        { type: 'DINNER', count: dinnerCount }
      ];

      const weekStart = new Date(week_start);
      const allCandidates = await fetchCandidates(tx, familyId, 'DINNER');
      const history = await fetchRecentHistory(tx, familyId, 28);
      const inventory = await fetchInventory(tx, familyId);
      const ingredientMap = await fetchRecipeIngredients(tx, allCandidates.map(c => c.id));
      allCandidates.forEach(c => { c._ingredient_ids = ingredientMap[c.id] || []; });

      const usedRecipeIds = new Set();
      let sortOrder = 0;

      for (let day = 0; day < 7; day++) {
        const planDate = new Date(weekStart);
        planDate.setDate(planDate.getDate() + day);
        const dateStr = planDate.toISOString().split('T')[0];

        for (const { type, count } of mealTypes) {
          // Check locked items for this day/meal
          const dayLocked = lockedItems.filter(i => i.plan_date === dateStr && i.meal_type === type);
          dayLocked.forEach(item => {
            usedRecipeIds.add(item.recipe_id);
          });

          const context = { history, inventory, mode, meal_type: type };
          const candidates = allCandidates
            .filter(c => !usedRecipeIds.has(c.id))
            .map(c => { const { score, reasons } = scoreRecipe(c, context); return { recipe: c, score }; })
            .sort((a, b) => b.score - a.score);

          const selected = candidates.slice(0, count - dayLocked.length);

          // Insert locked first
          for (const item of dayLocked) {
            await tx.query(`INSERT INTO weekly_plan_items(id,weekly_plan_id,plan_date,meal_type,recipe_id,sort_order,locked,added_by_user_id,source)
              VALUES($1,$2,$3,$4,$5,$6,true,$7,'GENERATED')`,
              [randomUUID(), planId, dateStr, type, item.recipe_id, sortOrder++, userId]);
          }

          // Insert generated
          for (const s of selected) {
            usedRecipeIds.add(s.recipe.id);
            await tx.query(`INSERT INTO weekly_plan_items(id,weekly_plan_id,plan_date,meal_type,recipe_id,sort_order,locked,added_by_user_id,source)
              VALUES($1,$2,$3,$4,$5,$6,false,$7,'GENERATED')`,
              [randomUUID(), planId, dateStr, type, s.recipe.id, sortOrder++, userId]);
          }
        }
      }

      // Return plan with items
      const plan = (await tx.query('SELECT * FROM weekly_plans WHERE id=$1', [planId])).rows[0];
      const items = (await tx.query('SELECT * FROM weekly_plan_items WHERE weekly_plan_id=$1 ORDER BY plan_date, meal_type, sort_order', [planId])).rows;
      return { ...plan, items };
    });
  }

  // Confirm weekly plan (DRAFT -> ACTIVE, old ACTIVE -> ARCHIVED)
  async function confirmWeeklyPlan(familyId, userId, planId) {
    return access(familyId, userId, ['OWNER', 'ADMIN'], true, async tx => {
      const plan = (await tx.query('SELECT * FROM weekly_plans WHERE id=$1 AND family_id=$2', [planId, familyId])).rows[0];
      if (!plan) throw new ApiError(404, 'PLAN_NOT_FOUND', '周计划不存在');
      if (plan.status !== 'DRAFT') throw new ApiError(409, 'PLAN_NOT_DRAFT', '只能确认 DRAFT 状态的周计划');

      // Archive old ACTIVE
      await tx.query(`UPDATE weekly_plans SET status='ARCHIVED', updated_at=now()
        WHERE family_id=$1 AND week_start_date=$2 AND status='ACTIVE'`, [familyId, plan.week_start_date]);

      // Activate
      await tx.query(`UPDATE weekly_plans SET status='ACTIVE', confirmed_by_user_id=$2, updated_at=now() WHERE id=$1`, [planId, userId]);

      const updated = (await tx.query('SELECT * FROM weekly_plans WHERE id=$1', [planId])).rows[0];
      return updated;
    });
  }

  // Fridge cooking recommendations (what can I cook with what I have)
  async function getFridgeCooking(familyId, userId) {
    return access(familyId, userId, null, false, async tx => {
      const inventory = await fetchInventory(tx, familyId);
      const candidates = await fetchCandidates(tx, familyId, 'DINNER');
      const ingredientMap = await fetchRecipeIngredients(tx, candidates.map(c => c.id));

      const fridgeIds = new Set(inventory.map(i => i.ingredient_id));
      const results = candidates.map(c => {
        const ingIds = ingredientMap[c.id] || [];
        const required = ingIds.length;
        const have = ingIds.filter(id => fridgeIds.has(id)).length;
        const ratio = required > 0 ? have / required : 0;
        let status = 'NEEDS_SHOPPING';
        if (ratio >= 0.8) status = 'CAN_COOK_NOW';
        else if (ratio >= 0.4) status = 'MISSING_FEW';
        return { recipe: c, required, have, ratio, status };
      }).filter(r => r.required > 0)
        .sort((a, b) => b.ratio - a.ratio)
        .slice(0, 20);

      return results.map(r => ({
        id: r.recipe.id,
        name: r.recipe.name,
        status: r.status,
        have_count: r.have,
        required_count: r.required
      }));
    });
  }

  return { generateRandomMeal, generateWeeklyPlan, confirmWeeklyPlan, getFridgeCooking };
}

module.exports = { createRecommendationService };
