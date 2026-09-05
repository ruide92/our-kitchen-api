// Seed base recipes and ingredients for V1 kitchen core
// Normative: docs/DATA_MODEL_V4.md
const { Pool } = require('pg');
const { randomUUID } = require('node:crypto');

// Ingredients: canonical_code, display_name, category_code, default_unit_code, aliases
const INGREDIENTS = [
  { code: 'pork_belly', name: '五花肉', category: 'MEAT', unit: 'g', aliases: [] },
  { code: 'pork_ribs', name: '排骨', category: 'MEAT', unit: 'g', aliases: ['猪排骨'] },
  { code: 'pork_tenderloin', name: '猪里脊', category: 'MEAT', unit: 'g', aliases: ['里脊肉'] },
  { code: 'chicken_breast', name: '鸡胸肉', category: 'MEAT', unit: 'g', aliases: [] },
  { code: 'egg', name: '鸡蛋', category: 'MEAT', unit: 'piece', aliases: [] },
  { code: 'tofu_soft', name: '嫩豆腐', category: 'SOY', unit: 'piece', aliases: ['豆腐'] },
  { code: 'tomato', name: '西红柿', category: 'VEGETABLE', unit: 'piece', aliases: ['番茄'] },
  { code: 'bitter_melon', name: '苦瓜', category: 'VEGETABLE', unit: 'root', aliases: [] },
  { code: 'spinach', name: '菠菜', category: 'VEGETABLE', unit: 'g', aliases: [] },
  { code: 'broccoli', name: '西兰花', category: 'VEGETABLE', unit: 'g', aliases: [] },
  { code: 'green_pepper', name: '青椒', category: 'VEGETABLE', unit: 'piece', aliases: ['尖椒'] },
  { code: 'garlic', name: '大蒜', category: 'SEASONING', unit: 'clove', aliases: ['蒜'] },
  { code: 'ginger', name: '生姜', category: 'SEASONING', unit: 'piece', aliases: ['姜'] },
  { code: 'scallion', name: '小葱', category: 'SEASONING', unit: 'root', aliases: ['葱','葱花'] },
  { code: 'seaweed', name: '紫菜', category: 'DRY', unit: 'g', aliases: [] },
  { code: 'soy_sauce', name: '生抽', category: 'SEASONING', unit: 'ml', aliases: ['酱油'] },
  { code: 'salt', name: '盐', category: 'SEASONING', unit: 'g', aliases: [] },
  { code: 'cooking_oil', name: '食用油', category: 'SEASONING', unit: 'ml', aliases: ['油'] },
  { code: 'milk', name: '牛奶', category: 'DAIRY', unit: 'piece', aliases: [] },
  { code: 'toast', name: '吐司', category: 'STAPLE', unit: 'piece', aliases: ['面包'] },
  { code: 'shrimp', name: '鲜虾', category: 'SEAFOOD', unit: 'g', aliases: ['虾'] },
  { code: 'sea_bass', name: '鲈鱼', category: 'SEAFOOD', unit: 'g', aliases: ['海鲈鱼'] },
];

const RECIPES = [
  { name: '辣椒炒肉', category: 'HOT_DISH', cook_time: 20, spiciness: 3, base_servings: 2, meal_types: ['LUNCH','DINNER'],
    ingredients: [
      { name: '猪里脊', quantity: 200, unit: 'g', type: 'MAIN' },
      { name: '青椒', quantity: 2, unit: 'piece', type: 'MAIN' },
      { name: '大蒜', quantity: 3, unit: 'clove', type: 'SEASONING' },
      { name: '生抽', quantity: 15, unit: 'ml', type: 'SEASONING' },
      { name: '食用油', quantity: 15, unit: 'ml', type: 'SEASONING' },
      { name: '盐', quantity: 2, unit: 'g', type: 'SEASONING' },
    ]},
  { name: '苦瓜炒蛋', category: 'VEGETABLE', cook_time: 15, spiciness: 0, base_servings: 2, meal_types: ['LUNCH','DINNER'],
    ingredients: [
      { name: '苦瓜', quantity: 1, unit: 'root', type: 'MAIN' },
      { name: '鸡蛋', quantity: 3, unit: 'piece', type: 'MAIN' },
      { name: '大蒜', quantity: 2, unit: 'clove', type: 'SEASONING' },
      { name: '盐', quantity: 2, unit: 'g', type: 'SEASONING' },
      { name: '食用油', quantity: 15, unit: 'ml', type: 'SEASONING' },
    ]},
  { name: '麻婆豆腐', category: 'HOT_DISH', cook_time: 25, spiciness: 4, base_servings: 2, meal_types: ['LUNCH','DINNER'],
    ingredients: [
      { name: '嫩豆腐', quantity: 1, unit: 'piece', type: 'MAIN' },
      { name: '猪里脊', quantity: 100, unit: 'g', type: 'MAIN' },
      { name: '大蒜', quantity: 3, unit: 'clove', type: 'SEASONING' },
      { name: '生姜', quantity: 2, unit: 'piece', type: 'SEASONING' },
      { name: '小葱', quantity: 2, unit: 'root', type: 'SEASONING' },
      { name: '生抽', quantity: 15, unit: 'ml', type: 'SEASONING' },
      { name: '食用油', quantity: 15, unit: 'ml', type: 'SEASONING' },
    ]},
  { name: '蒜蓉菠菜', category: 'VEGETABLE', cook_time: 10, spiciness: 0, base_servings: 2, meal_types: ['LUNCH','DINNER'],
    ingredients: [
      { name: '菠菜', quantity: 300, unit: 'g', type: 'MAIN' },
      { name: '大蒜', quantity: 4, unit: 'clove', type: 'SEASONING' },
      { name: '盐', quantity: 2, unit: 'g', type: 'SEASONING' },
      { name: '食用油', quantity: 10, unit: 'ml', type: 'SEASONING' },
    ]},
  { name: '紫菜蛋花汤', category: 'SOUP', cook_time: 10, spiciness: 0, base_servings: 2, meal_types: ['LUNCH','DINNER'],
    ingredients: [
      { name: '紫菜', quantity: 5, unit: 'g', type: 'MAIN' },
      { name: '鸡蛋', quantity: 2, unit: 'piece', type: 'MAIN' },
      { name: '小葱', quantity: 1, unit: 'root', type: 'SEASONING' },
      { name: '盐', quantity: 2, unit: 'g', type: 'SEASONING' },
      { name: '生抽', quantity: 5, unit: 'ml', type: 'SEASONING' },
    ]},
  { name: '番茄炒蛋', category: 'HOT_DISH', cook_time: 15, spiciness: 0, base_servings: 2, meal_types: ['LUNCH','DINNER'],
    ingredients: [
      { name: '西红柿', quantity: 2, unit: 'piece', type: 'MAIN' },
      { name: '鸡蛋', quantity: 3, unit: 'piece', type: 'MAIN' },
      { name: '小葱', quantity: 1, unit: 'root', type: 'SEASONING' },
      { name: '盐', quantity: 2, unit: 'g', type: 'SEASONING' },
      { name: '食用油', quantity: 15, unit: 'ml', type: 'SEASONING' },
    ]},
  { name: '牛奶吐司', category: 'BREAKFAST', cook_time: 5, spiciness: 0, base_servings: 1, meal_types: ['BREAKFAST'],
    ingredients: [
      { name: '牛奶', quantity: 1, unit: 'piece', type: 'MAIN' },
      { name: '吐司', quantity: 2, unit: 'piece', type: 'MAIN' },
    ]},
  { name: '宫保鸡丁', category: 'HOT_DISH', cook_time: 20, spiciness: 3, base_servings: 2, meal_types: ['LUNCH','DINNER'],
    ingredients: [
      { name: '鸡胸肉', quantity: 250, unit: 'g', type: 'MAIN' },
      { name: '青椒', quantity: 1, unit: 'piece', type: 'MAIN' },
      { name: '大蒜', quantity: 3, unit: 'clove', type: 'SEASONING' },
      { name: '生姜', quantity: 2, unit: 'piece', type: 'SEASONING' },
      { name: '生抽', quantity: 15, unit: 'ml', type: 'SEASONING' },
      { name: '食用油', quantity: 15, unit: 'ml', type: 'SEASONING' },
    ]},
  { name: '红烧排骨', category: 'HOT_DISH', cook_time: 45, spiciness: 1, base_servings: 2, meal_types: ['LUNCH','DINNER'],
    ingredients: [
      { name: '排骨', quantity: 400, unit: 'g', type: 'MAIN' },
      { name: '生姜', quantity: 3, unit: 'piece', type: 'SEASONING' },
      { name: '大蒜', quantity: 3, unit: 'clove', type: 'SEASONING' },
      { name: '生抽', quantity: 20, unit: 'ml', type: 'SEASONING' },
      { name: '食用油', quantity: 10, unit: 'ml', type: 'SEASONING' },
    ]},
  { name: '清蒸鲈鱼', category: 'SEAFOOD', cook_time: 20, spiciness: 0, base_servings: 2, meal_types: ['LUNCH','DINNER'],
    ingredients: [
      { name: '鲈鱼', quantity: 300, unit: 'g', type: 'MAIN' },
      { name: '小葱', quantity: 2, unit: 'root', type: 'SEASONING' },
      { name: '生姜', quantity: 3, unit: 'piece', type: 'SEASONING' },
      { name: '生抽', quantity: 15, unit: 'ml', type: 'SEASONING' },
      { name: '食用油', quantity: 10, unit: 'ml', type: 'SEASONING' },
    ]},
];

async function seed() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if already seeded
    const existing = await client.query("SELECT COUNT(*)::int as c FROM recipes WHERE source_type = 'SEED'");
    if (existing.rows[0].c > 0) {
      console.log('Seed data already present, skipping.');
      await client.query('ROLLBACK');
      return;
    }

    // Insert ingredients
    const ingredientMap = {};
    for (const ing of INGREDIENTS) {
      const id = randomUUID();
      const res = await client.query(
        'INSERT INTO ingredients (id, canonical_code, display_name, category_code, default_unit_code) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [id, ing.code, ing.name, ing.category, ing.unit]
      );
      ingredientMap[ing.name] = res.rows[0].id;
      // Insert aliases
      for (const alias of ing.aliases) {
        await client.query(
          'INSERT INTO ingredient_aliases (ingredient_id, alias_name, normalized_alias, locale) VALUES ($1,$2,$3,$4)',
          [id, alias, alias.toLowerCase(), 'zh-CN']
        );
      }
    }

    // Insert recipes
    for (const recipe of RECIPES) {
      const recipeId = randomUUID();
      await client.query(
        `INSERT INTO recipes (id, kind, family_id, source_type, name, category_code, base_servings, cook_time_minutes, spiciness, visibility, version)
         VALUES ($1,'BASE',NULL,'SEED',$2,$3,$4,$5,$6,'PUBLIC',1)`,
        [recipeId, recipe.name, recipe.category, recipe.base_servings, recipe.cook_time, recipe.spiciness]
      );
      // meal types
      for (const mt of recipe.meal_types || []) {
        await client.query('INSERT INTO recipe_meal_types (recipe_id, meal_type) VALUES ($1,$2)', [recipeId, mt]);
      }
      // ingredients
      let sortOrder = 0;
      for (const ri of recipe.ingredients) {
        const ingredientId = ingredientMap[ri.name];
        if (!ingredientId) { console.log('WARN: ingredient not found:', ri.name); continue; }
        await client.query(
          `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, display_name_override, quantity, unit_code, type, required, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,true,$7)`,
          [recipeId, ingredientId, ri.name, ri.quantity, ri.unit, ri.type, sortOrder++]
        );
      }
    }

    await client.query('COMMIT');
    console.log(`Seeded ${INGREDIENTS.length} ingredients and ${RECIPES.length} recipes.`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', e.message);
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(e => { console.error(e); process.exit(1); });
