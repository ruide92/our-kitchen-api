// Meal Recipe Snapshot Builder
// Builds a versioned full JSON snapshot of all recipes in a meal at confirm time.
// Schema version 1. Frozen content: recipe identity, ingredients, steps, cookware, tags, etc.
// Never freezes: is_favorite, viewer.rating, inventory_summary, current fridge, current shopping state.
const { ApiError } = require('./errors');

const SNAPSHOT_SCHEMA_VERSION = 1;

// Build full snapshot for a meal's items within a transaction
async function buildRecipeSnapshot(tx, mealId) {
  const items = (await tx.query(`
    SELECT mi.*, r.name as recipe_name
    FROM meal_items mi
    JOIN recipes r ON r.id = mi.recipe_id
    WHERE mi.meal_id = $1
    ORDER BY mi.sort_order
  `, [mealId])).rows;

  const snapshotItems = [];
  for (const item of items) {
    const recipe = await fetchFullRecipe(tx, item.recipe_id);
    snapshotItems.push({
      meal_item_id: item.id,
      recipe_id: item.recipe_id,
      recipe_version: recipe.version || 1,
      servings: Number(item.servings),
      source: item.source,
      selected_by_user_id: item.selected_by_user_id,
      recipe,
      ingredients: (await fetchRecipeIngredients(tx, item.recipe_id)).map(ing => ({
        ...ing,
        quantity: ing.quantity != null ? Number(ing.quantity) : null,
      })),
      steps: await fetchRecipeSteps(tx, item.recipe_id),
      cookware: await fetchRecipeCookware(tx, item.recipe_id),
      meal_types: await fetchRecipeMealTypes(tx, item.recipe_id),
      tags: await fetchRecipeTags(tx, item.recipe_id),
      allergens: await fetchRecipeAllergens(tx, item.recipe_id),
      nutrition: await fetchRecipeNutrition(tx, item.recipe_id),
      media: await fetchRecipeMedia(tx, item.recipe_id),
    });
  }

  return {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    captured_at: new Date().toISOString(),
    items: snapshotItems,
  };
}

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
  return rows;
}

async function fetchRecipeSteps(tx, recipeId) {
  const rows = (await tx.query(`
    SELECT id, recipe_id, step_no, title, operation,
           duration_seconds, duration_text, heat_code, doneness_cue, tip, sort_order
    FROM recipe_steps WHERE recipe_id = $1
    ORDER BY sort_order
  `, [recipeId])).rows;
  return rows;
}

async function fetchRecipeCookware(tx, recipeId) {
  const rows = (await tx.query(`
    SELECT rc.recipe_id, rc.cookware_code
    FROM recipe_cookware rc WHERE rc.recipe_id = $1
  `, [recipeId])).rows;
  return rows;
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
    SELECT * FROM recipe_nutrition WHERE recipe_id = $1
  `, [recipeId])).rows[0];
  return row || null;
}

async function fetchRecipeMedia(tx, recipeId) {
  const rows = (await tx.query(`
    SELECT id, recipe_id, media_type, asset_url, sort_order
    FROM recipe_media WHERE recipe_id = $1
    ORDER BY sort_order
  `, [recipeId])).rows;
  return rows;
}

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
