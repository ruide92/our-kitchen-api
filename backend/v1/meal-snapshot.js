// Meal Recipe Snapshot Builder
// Builds a versioned full JSON snapshot of all recipes in a meal at confirm time.
// Schema version 1. Frozen content: recipe identity, ingredients, steps, cookware, tags, etc.
// Never freezes: is_favorite, viewer.rating, inventory_summary, current fridge, current shopping state.
//
// IMPORTANT: All snapshot fields are built via explicit mappers. Never SELECT * into snapshot.
// Underlying DB schema changes must not silently alter schema_version=1 JSON shape.
const { ApiError } = require('./errors');

const SNAPSHOT_SCHEMA_VERSION = 1;

// Build full snapshot for a meal's items within a transaction
async function buildRecipeSnapshot(tx, mealId) {
  const items = (await tx.query(`
    SELECT mi.id, mi.meal_id, mi.recipe_id, mi.selected_by_user_id, mi.source,
           mi.servings, mi.sort_order, mi.created_at,
           r.name as recipe_name
    FROM meal_items mi
    JOIN recipes r ON r.id = mi.recipe_id
    WHERE mi.meal_id = $1
    ORDER BY mi.sort_order
  `, [mealId])).rows;

  const snapshotItems = [];
  for (const item of items) {
    const recipe = await fetchFullRecipe(tx, item.recipe_id);
    const ingredients = await fetchRecipeIngredients(tx, item.recipe_id);
    const steps = await fetchRecipeSteps(tx, item.recipe_id);

    snapshotItems.push({
      meal_item_id: item.id,
      recipe_id: item.recipe_id,
      recipe_version: recipe ? (recipe.version || 1) : 1,
      servings: Number(item.servings),
      source: item.source,
      selected_by_user_id: item.selected_by_user_id,
      recipe: recipe ? mapRecipe(recipe) : null,
      ingredients: ingredients.map(ing => mapIngredient(ing)),
      steps: steps.map(step => mapStep(step)),
      cookware: await fetchRecipeCookware(tx, item.recipe_id),
      meal_types: await fetchRecipeMealTypes(tx, item.recipe_id),
      tags: await fetchRecipeTags(tx, item.recipe_id),
      allergens: await fetchRecipeAllergens(tx, item.recipe_id),
      nutrition: await fetchRecipeNutrition(tx, item.recipe_id),
      nutrition_tags: await fetchNutritionTags(tx, item.recipe_id),
      traditional_diet_tags: await fetchTraditionalDietTags(tx, item.recipe_id),
      vegetable_categories: await fetchVegetableCategories(tx, item.recipe_id),
      media: await fetchRecipeMedia(tx, item.recipe_id),
    });
  }

  return {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    captured_at: new Date().toISOString(),
    items: snapshotItems,
  };
}

// --- Explicit mappers (stable schema_version=1 shape) ---

function mapRecipe(r) {
  return {
    id: r.id,
    kind: r.kind,
    family_id: r.family_id,
    parent_recipe_id: r.parent_recipe_id,
    source_type: r.source_type,
    name: r.name,
    description: r.description,
    category_code: r.category_code,
    cuisine_code: r.cuisine_code,
    base_servings: r.base_servings != null ? Number(r.base_servings) : null,
    cook_time_minutes: r.cook_time_minutes,
    difficulty: r.difficulty,
    spiciness: r.spiciness,
    sweetness: r.sweetness,
    saltiness: r.saltiness,
    sourness: r.sourness,
    oiliness: r.oiliness,
    cooking_method_code: r.cooking_method_code,
    protein_source_code: r.protein_source_code,
    suggested_kiss: r.suggested_kiss,
    version: r.version,
  };
}

function mapIngredient(ing) {
  return {
    ingredient_id: ing.ingredient_id,
    canonical_code: ing.canonical_code,
    category_code: ing.category_code,
    name: ing.name,
    display_name_override: ing.display_name_override,
    quantity: ing.quantity != null ? Number(ing.quantity) : null,
    quantity_text: ing.quantity_text,
    unit_code: ing.unit_code,
    type: ing.type,
    required: ing.required,
    sort_order: ing.sort_order,
    note: ing.note,
    alternatives: ing.alternatives || [],
  };
}

function mapStep(step) {
  return {
    step_no: step.step_no,
    title: step.title,
    operation: step.operation,
    duration_seconds: step.duration_seconds,
    duration_text: step.duration_text,
    heat_code: step.heat_code,
    doneness_cue: step.doneness_cue,
    tip: step.tip,
    sort_order: step.sort_order,
    media: step.media || [],
  };
}

function mapNutrition(n) {
  if (!n) return null;
  return {
    serving_size: n.serving_size != null ? Number(n.serving_size) : null,
    serving_unit: n.serving_unit,
    calories_kcal: n.calories_kcal != null ? Number(n.calories_kcal) : null,
    protein_g: n.protein_g != null ? Number(n.protein_g) : null,
    fat_g: n.fat_g != null ? Number(n.fat_g) : null,
    carbs_g: n.carbs_g != null ? Number(n.carbs_g) : null,
    fiber_g: n.fiber_g != null ? Number(n.fiber_g) : null,
    sodium_mg: n.sodium_mg != null ? Number(n.sodium_mg) : null,
    source: n.source,
  };
}

function mapMedia(m) {
  return {
    id: m.id,
    media_type: m.media_type,
    asset_url: m.asset_url,
    asset_id: m.asset_id,
    generation_prompt: m.generation_prompt,
    source_url: m.source_url,
    sort_order: m.sort_order,
  };
}

// --- Fetchers ---

async function fetchFullRecipe(tx, recipeId) {
  const row = (await tx.query(`
    SELECT id, kind, family_id, parent_recipe_id, source_type, name, description,
           category_code, cuisine_code, base_servings, cook_time_minutes, difficulty,
           spiciness, sweetness, saltiness, sourness, oiliness,
           cooking_method_code, protein_source_code, suggested_kiss, version
    FROM recipes WHERE id = $1
  `, [recipeId])).rows[0];
  return row || null;
}

async function fetchRecipeIngredients(tx, recipeId) {
  const rows = (await tx.query(`
    SELECT ri.id, ri.recipe_id, ri.ingredient_id,
           i.canonical_code, i.category_code,
           COALESCE(ri.display_name_override, i.display_name) as name, ri.display_name_override,
           ri.quantity, ri.quantity_text, ri.unit_code, ri.type,
           ri.required, ri.sort_order, ri.note
    FROM recipe_ingredients ri
    LEFT JOIN ingredients i ON i.id = ri.ingredient_id
    WHERE ri.recipe_id = $1
    ORDER BY ri.sort_order
  `, [recipeId])).rows;

  // Attach alternatives per ingredient
  for (const row of rows) {
    row.alternatives = await fetchIngredientAlternatives(tx, row.id);
  }
  return rows;
}

async function fetchIngredientAlternatives(tx, recipeIngredientId) {
  const rows = (await tx.query(`
    SELECT id, recipe_ingredient_id, alternative_ingredient_id,
           alternative_name, ratio, note, sort_order
    FROM recipe_ingredient_alternatives
    WHERE recipe_ingredient_id = $1
    ORDER BY sort_order
  `, [recipeIngredientId])).rows;
  return rows.map(a => ({
    alternative_ingredient_id: a.alternative_ingredient_id,
    alternative_name: a.alternative_name,
    ratio: a.ratio != null ? Number(a.ratio) : null,
    note: a.note,
    sort_order: a.sort_order,
  }));
}

async function fetchRecipeSteps(tx, recipeId) {
  const rows = (await tx.query(`
    SELECT id, recipe_id, step_no, title, operation,
           duration_seconds, duration_text, heat_code, doneness_cue, tip, sort_order
    FROM recipe_steps WHERE recipe_id = $1
    ORDER BY sort_order
  `, [recipeId])).rows;

  // Attach step media per step
  for (const row of rows) {
    row.media = await fetchStepMedia(tx, row.id);
  }
  return rows;
}

async function fetchStepMedia(tx, recipeStepId) {
  const rows = (await tx.query(`
    SELECT id, recipe_step_id, media_type, url, sort_order
    FROM recipe_step_media
    WHERE recipe_step_id = $1
    ORDER BY sort_order
  `, [recipeStepId])).rows;
  // Snapshot V1 stable media vocabulary: asset_url (mapped from legacy url),
  // asset_id/generation_prompt/source_url = null until migration adds them.
  return rows.map(m => ({
    media_type: m.media_type,
    asset_url: m.url,
    asset_id: null,
    generation_prompt: null,
    source_url: null,
    sort_order: m.sort_order,
  }));
}

async function fetchRecipeCookware(tx, recipeId) {
  const rows = (await tx.query(`
    SELECT rc.recipe_id, rc.cookware_code
    FROM recipe_cookware rc WHERE rc.recipe_id = $1
  `, [recipeId])).rows;
  return rows.map(r => ({ cookware_code: r.cookware_code }));
}

async function fetchRecipeMealTypes(tx, recipeId) {
  const rows = (await tx.query(`
    SELECT recipe_id, meal_type FROM recipe_meal_types WHERE recipe_id = $1
  `, [recipeId])).rows;
  return rows.map(r => r.meal_type);
}

async function fetchRecipeTags(tx, recipeId) {
  const rows = (await tx.query(`
    SELECT rt.recipe_id, rt.tag_code FROM recipe_tags rt WHERE rt.recipe_id = $1
  `, [recipeId])).rows;
  return rows.map(r => r.tag_code);
}

async function fetchRecipeAllergens(tx, recipeId) {
  const rows = (await tx.query(`
    SELECT ra.recipe_id, ra.allergen_code FROM recipe_allergens ra WHERE ra.recipe_id = $1
  `, [recipeId])).rows;
  return rows.map(r => r.allergen_code);
}

async function fetchRecipeNutrition(tx, recipeId) {
  const row = (await tx.query(`
    SELECT serving_size, serving_unit, calories_kcal, protein_g, fat_g,
           carbs_g, fiber_g, sodium_mg, source
    FROM recipe_nutrition WHERE recipe_id = $1
  `, [recipeId])).rows[0];
  return mapNutrition(row);
}

async function fetchNutritionTags(tx, recipeId) {
  const rows = (await tx.query(`
    SELECT tag_code FROM recipe_nutrition_tags WHERE recipe_id = $1
  `, [recipeId])).rows;
  return rows.map(r => r.tag_code);
}

async function fetchTraditionalDietTags(tx, recipeId) {
  const rows = (await tx.query(`
    SELECT tag_code FROM recipe_traditional_diet_tags WHERE recipe_id = $1
  `, [recipeId])).rows;
  return rows.map(r => r.tag_code);
}

async function fetchVegetableCategories(tx, recipeId) {
  const rows = (await tx.query(`
    SELECT category_code FROM recipe_vegetable_categories WHERE recipe_id = $1
  `, [recipeId])).rows;
  return rows.map(r => r.category_code);
}

async function fetchRecipeMedia(tx, recipeId) {
  const rows = (await tx.query(`
    SELECT id, recipe_id, media_type, asset_url, asset_id,
           generation_prompt, source_url, sort_order
    FROM recipe_media WHERE recipe_id = $1
    ORDER BY sort_order
  `, [recipeId])).rows;
  return rows.map(mapMedia);
}

// --- Fail-closed validation ---

// Validate snapshot exists and schema version is supported
function requireSnapshot(meal, context) {
  if (!meal.recipe_snapshot) {
    throw new ApiError(422, 'MEAL_SNAPSHOT_MISSING',
      `Meal ${meal.id} status=${meal.status} but recipe_snapshot is null. ${context} requires a confirmed snapshot.`);
  }
  if (meal.recipe_snapshot.schema_version !== SNAPSHOT_SCHEMA_VERSION) {
    throw new ApiError(422, 'MEAL_SNAPSHOT_UNSUPPORTED',
      `Meal ${meal.id} snapshot schema_version=${meal.recipe_snapshot.schema_version}, supported=${SNAPSHOT_SCHEMA_VERSION}`);
  }
  return meal.recipe_snapshot;
}

// --- Snapshot consumers ---

// Get steps from snapshot for cooking
function getStepsFromSnapshot(snapshot) {
  const allSteps = [];
  for (const item of snapshot.items || []) {
    for (const step of item.steps || []) {
      allSteps.push({ ...step, recipe_name: item.recipe?.name, recipe_id: item.recipe_id });
    }
  }
  return allSteps;
}

// Get ingredients from snapshot for shopping (confirmed+ meals)
function getIngredientsFromSnapshot(snapshot) {
  const result = [];
  for (const item of snapshot.items || []) {
    const ratio = item.servings / (item.recipe?.base_servings || 2);
    for (const ing of item.ingredients || []) {
      if (!ing.required) continue;
      result.push({
        ingredient_id: ing.ingredient_id,
        canonical_code: ing.canonical_code,
        name: ing.name || ing.display_name_override,
        display_name_override: ing.display_name_override,
        quantity: ing.quantity ? ing.quantity * ratio : null,
        quantity_text: ing.quantity_text,
        unit_code: ing.unit_code,
        type: ing.type,
        sort_order: ing.sort_order,
        note: ing.note,
        recipe_id: item.recipe_id,
        recipe_name: item.recipe?.name,
        source_recipe_version: item.recipe_version,
      });
    }
  }
  return result;
}

// Get recipe names from snapshot for history
function getItemsFromSnapshot(snapshot) {
  return (snapshot.items || []).map(item => ({
    meal_item_id: item.meal_item_id,
    recipe_id: item.recipe_id,
    recipe_name: item.recipe?.name,
    servings: item.servings,
    source: item.source,
    selected_by_user_id: item.selected_by_user_id,
    recipe_version: item.recipe_version,
  }));
}

module.exports = {
  SNAPSHOT_SCHEMA_VERSION,
  buildRecipeSnapshot,
  requireSnapshot,
  getStepsFromSnapshot,
  getIngredientsFromSnapshot,
  getItemsFromSnapshot,
};
