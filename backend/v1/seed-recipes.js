// Seed base recipes and ingredients for V1 kitchen core
const { Pool } = require('pg');
const { randomUUID } = require('node:crypto');

const INGREDIENTS = [
  { name: '五花肉', category: 'MEAT', default_unit: 'g' },
  { name: '猪里脊', category: 'MEAT', default_unit: 'g' },
  { name: '鸡胸肉', category: 'MEAT', default_unit: 'g' },
  { name: '鸡蛋', category: 'MEAT', default_unit: '个' },
  { name: '嫩豆腐', category: 'SOY', default_unit: '盒' },
  { name: '西红柿', category: 'VEGETABLE', default_unit: '个' },
  { name: '苦瓜', category: 'VEGETABLE', default_unit: '根' },
  { name: '菠菜', category: 'VEGETABLE', default_unit: 'g' },
  { name: '西兰花', category: 'VEGETABLE', default_unit: 'g' },
  { name: '青椒', category: 'VEGETABLE', default_unit: '个' },
  { name: '大蒜', category: 'SEASONING', default_unit: '瓣' },
  { name: '生姜', category: 'SEASONING', default_unit: '片' },
  { name: '小葱', category: 'SEASONING', default_unit: '根' },
  { name: '紫菜', category: 'DRY', default_unit: 'g' },
  { name: '生抽', category: 'SEASONING', default_unit: 'ml' },
  { name: '盐', category: 'SEASONING', default_unit: 'g' },
  { name: '食用油', category: 'SEASONING', default_unit: 'ml' },
  { name: '牛奶', category: 'DAIRY', default_unit: '盒' },
  { name: '吐司', category: 'STAPLE', default_unit: '片' },
  { name: '鲜虾', category: 'SEAFOOD', default_unit: 'g' },
];

const RECIPES = [
  { id: 'r-chili-pork', name: '辣椒炒肉', category: 'HOT_DISH', cook_time: 20, spiciness: 3, base_servings: 2,
    ingredients: [
      { name: '猪里脊', quantity: 200, unit: 'g', type: 'MAIN' },
      { name: '青椒', quantity: 2, unit: '个', type: 'MAIN' },
      { name: '大蒜', quantity: 3, unit: '瓣', type: 'SEASONING' },
      { name: '生抽', quantity: 15, unit: 'ml', type: 'SEASONING' },
      { name: '食用油', quantity: 15, unit: 'ml', type: 'SEASONING' },
      { name: '盐', quantity: 2, unit: 'g', type: 'SEASONING' },
    ]},
  { id: 'r-bitter-melon-egg', name: '苦瓜炒蛋', category: 'VEGETABLE', cook_time: 15, spiciness: 0, base_servings: 2,
    ingredients: [
      { name: '苦瓜', quantity: 1, unit: '根', type: 'MAIN' },
      { name: '鸡蛋', quantity: 3, unit: '个', type: 'MAIN' },
      { name: '大蒜', quantity: 2, unit: '瓣', type: 'SEASONING' },
      { name: '盐', quantity: 2, unit: 'g', type: 'SEASONING' },
      { name: '食用油', quantity: 15, unit: 'ml', type: 'SEASONING' },
    ]},
  { id: 'r-mapo-tofu', name: '麻婆豆腐', category: 'HOT_DISH', cook_time: 25, spiciness: 4, base_servings: 2,
    ingredients: [
      { name: '嫩豆腐', quantity: 1, unit: '盒', type: 'MAIN' },
      { name: '猪里脊', quantity: 100, unit: 'g', type: 'MAIN' },
      { name: '大蒜', quantity: 3, unit: '瓣', type: 'SEASONING' },
      { name: '生姜', quantity: 2, unit: '片', type: 'SEASONING' },
      { name: '小葱', quantity: 2, unit: '根', type: 'SEASONING' },
      { name: '生抽', quantity: 15, unit: 'ml', type: 'SEASONING' },
      { name: '食用油', quantity: 15, unit: 'ml', type: 'SEASONING' },
    ]},
  { id: 'r-garlic-spinach', name: '蒜蓉菠菜', category: 'VEGETABLE', cook_time: 10, spiciness: 0, base_servings: 2,
    ingredients: [
      { name: '菠菜', quantity: 300, unit: 'g', type: 'MAIN' },
      { name: '大蒜', quantity: 4, unit: '瓣', type: 'SEASONING' },
      { name: '盐', quantity: 2, unit: 'g', type: 'SEASONING' },
      { name: '食用油', quantity: 10, unit: 'ml', type: 'SEASONING' },
    ]},
  { id: 'r-seaweed-soup', name: '紫菜蛋花汤', category: 'SOUP', cook_time: 10, spiciness: 0, base_servings: 2,
    ingredients: [
      { name: '紫菜', quantity: 5, unit: 'g', type: 'MAIN' },
      { name: '鸡蛋', quantity: 2, unit: '个', type: 'MAIN' },
      { name: '小葱', quantity: 1, unit: '根', type: 'SEASONING' },
      { name: '盐', quantity: 2, unit: 'g', type: 'SEASONING' },
      { name: '生抽', quantity: 5, unit: 'ml', type: 'SEASONING' },
    ]},
  { id: 'r-tomato-egg', name: '番茄炒蛋', category: 'HOT_DISH', cook_time: 15, spiciness: 0, base_servings: 2,
    ingredients: [
      { name: '西红柿', quantity: 2, unit: '个', type: 'MAIN' },
      { name: '鸡蛋', quantity: 3, unit: '个', type: 'MAIN' },
      { name: '小葱', quantity: 1, unit: '根', type: 'SEASONING' },
      { name: '盐', quantity: 2, unit: 'g', type: 'SEASONING' },
      { name: '食用油', quantity: 15, unit: 'ml', type: 'SEASONING' },
    ]},
  { id: 'r-milk-toast', name: '牛奶吐司', category: 'BREAKFAST', cook_time: 5, spiciness: 0, base_servings: 1,
    ingredients: [
      { name: '吐司', quantity: 2, unit: '片', type: 'MAIN' },
      { name: '牛奶', quantity: 1, unit: '盒', type: 'MAIN' },
    ]},
  { id: 'r-kung-pao', name: '宫保鸡丁', category: 'HOT_DISH', cook_time: 20, spiciness: 3, base_servings: 2,
    ingredients: [
      { name: '鸡胸肉', quantity: 250, unit: 'g', type: 'MAIN' },
      { name: '青椒', quantity: 1, unit: '个', type: 'MAIN' },
      { name: '大蒜', quantity: 3, unit: '瓣', type: 'SEASONING' },
      { name: '生姜', quantity: 2, unit: '片', type: 'SEASONING' },
      { name: '生抽', quantity: 15, unit: 'ml', type: 'SEASONING' },
      { name: '食用油', quantity: 15, unit: 'ml', type: 'SEASONING' },
    ]},
  { id: 'r-braised-ribs', name: '红烧排骨', category: 'HOT_DISH', cook_time: 60, spiciness: 1, base_servings: 3,
    ingredients: [
      { name: '猪里脊', quantity: 500, unit: 'g', type: 'MAIN' },
      { name: '生姜', quantity: 3, unit: '片', type: 'SEASONING' },
      { name: '大蒜', quantity: 4, unit: '瓣', type: 'SEASONING' },
      { name: '小葱', quantity: 2, unit: '根', type: 'SEASONING' },
      { name: '生抽', quantity: 30, unit: 'ml', type: 'SEASONING' },
      { name: '食用油', quantity: 20, unit: 'ml', type: 'SEASONING' },
    ]},
  { id: 'r-steamed-fish', name: '清蒸鲈鱼', category: 'HOT_DISH', cook_time: 20, spiciness: 0, base_servings: 2,
    ingredients: [
      { name: '鲜虾', quantity: 400, unit: 'g', type: 'MAIN' },
      { name: '生姜', quantity: 3, unit: '片', type: 'SEASONING' },
      { name: '小葱', quantity: 2, unit: '根', type: 'SEASONING' },
      { name: '生抽', quantity: 20, unit: 'ml', type: 'SEASONING' },
    ]},
];

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  try {
    for (const ing of INGREDIENTS) {
      const existing = (await pool.query('SELECT id FROM ingredients WHERE name=$1', [ing.name])).rows[0];
      if (!existing) {
        await pool.query(`INSERT INTO ingredients(id,name,category_code,default_unit_code) VALUES($1,$2,$3,$4)`,
          [randomUUID(), ing.name, ing.category, ing.default_unit]);
      }
    }
    for (const r of RECIPES) {
      const existing = (await pool.query('SELECT id FROM recipes WHERE id=$1', [r.id])).rows[0];
      if (existing) continue;
      await pool.query(`INSERT INTO recipes(id,kind,family_id,name,category_code,meal_types,base_servings,cook_time_minutes,spiciness,source_type)
        VALUES($1,'BASE',NULL,$2,$3,$4::jsonb,$5,$6,$7,'SYSTEM')`,
        [r.id, r.name, r.category, JSON.stringify(['LUNCH','DINNER']), r.base_servings, r.cook_time, r.spiciness]);
      for (let i = 0; i < r.ingredients.length; i++) {
        const ing = r.ingredients[i];
        const ingRow = (await pool.query('SELECT id FROM ingredients WHERE name=$1', [ing.name])).rows[0];
        await pool.query(`INSERT INTO recipe_ingredients(id,recipe_id,ingredient_id,name,quantity,unit_code,type,sort_order)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [randomUUID(), r.id, ingRow?.id || null, ing.name, ing.quantity, ing.unit, ing.type, i]);
      }
    }
    console.log(`Seeded ${INGREDIENTS.length} ingredients and ${RECIPES.length} recipes`);
  } finally {
    await pool.end();
  }
}
main().catch(e => { console.error('Seed failed:', e.message); process.exitCode = 1; });
