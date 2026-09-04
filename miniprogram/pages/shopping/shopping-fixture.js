/**
 * 购物清单 Tab V4 fixture / Mock 数据
 *
 * 重要：这是显式 fixture，不是真实后端返回。
 * 所有 calculation evidence（本餐需要/冰箱已有/常备食材/还缺/来源菜谱）
 * 均为预置演示数据，不是前端实时计算所得。
 * 当前阶段不接真实后端，不实现购物计算引擎、库存扣减、单位换算。
 *
 * 字段命名使用 V4 snake_case；与未来 /api/v1 响应保持同形。
 * fixture 参考餐次：2026-09-02 DINNER 2人
 */

const SHOPPING_FIXTURE = {
  current_list: {
    id: 'sl-fixture-001',
    status: 'OPEN',
    meal_id: 'meal-fixture-dinner',
    meal_date: '2026-09-02',
    meal_type: 'DINNER',
    diners_count: 2,
  },

  meal_summary: {
    title: '周三晚餐',
    recipes: ['辣椒炒肉', '苦瓜炒蛋', '紫菜蛋花汤'],
  },

  // ===== 购物清单项 =====
  // 注意：所有 missing_quantity / inventory_deducted / pantry_deducted
  // 均为 fixture 预置证据，非前端计算。
  items: [
    // ---- GENERATED（本餐生成）----
    {
      id: 'si-001',
      ingredient_id: 'ing-green-pepper',
      name: '青椒',
      category: '蔬菜',
      source: 'GENERATED',
      required_quantity: 4,
      required_quantity_text: '4个',
      unit_code: '个',
      inventory_deducted: 1,
      pantry_deducted: 0,
      missing_quantity: 3,
      missing_quantity_text: '3个',
      is_purchased: true,
      needs_unit_confirmation: false,
      sources: [
        {
          recipe_id: 'r-chili-pork',
          recipe_name: '辣椒炒肉',
          quantity: 4,
          quantity_text: '4个',
          unit_code: '个',
        },
      ],
    },
    {
      id: 'si-002',
      ingredient_id: 'ing-bitter-melon',
      name: '苦瓜',
      category: '蔬菜',
      source: 'GENERATED',
      required_quantity: null,
      required_quantity_text: '2根',
      unit_code: null,
      inventory_deducted: 0,
      pantry_deducted: 0,
      missing_quantity: null,
      missing_quantity_text: '2根',
      is_purchased: false,
      needs_unit_confirmation: true,
      unit_confirmation_note: '该单位无法可靠自动换算，真实版本需要人工确认后再合并。',
      sources: [
        {
          recipe_id: 'r-bitter-melon-egg',
          recipe_name: '苦瓜炒蛋',
          quantity: null,
          quantity_text: '2根',
          unit_code: null,
        },
      ],
    },
    {
      id: 'si-003',
      ingredient_id: 'ing-pork-loin',
      name: '猪里脊',
      category: '肉蛋',
      source: 'GENERATED',
      required_quantity: 600,
      required_quantity_text: '600g',
      unit_code: 'g',
      inventory_deducted: 450,
      pantry_deducted: 0,
      missing_quantity: 150,
      missing_quantity_text: '150g',
      is_purchased: true,
      needs_unit_confirmation: false,
      sources: [
        {
          recipe_id: 'r-chili-pork',
          recipe_name: '辣椒炒肉',
          quantity: 400,
          quantity_text: '400g',
          unit_code: 'g',
        },
        {
          recipe_id: 'r-bitter-melon-egg',
          recipe_name: '苦瓜炒蛋',
          quantity: 200,
          quantity_text: '200g',
          unit_code: 'g',
        },
      ],
    },
    {
      id: 'si-004',
      ingredient_id: 'ing-seaweed',
      name: '紫菜',
      category: '干货',
      source: 'GENERATED',
      required_quantity: 12,
      required_quantity_text: '12g',
      unit_code: 'g',
      inventory_deducted: 0,
      pantry_deducted: 0,
      missing_quantity: 12,
      missing_quantity_text: '12g',
      is_purchased: false,
      needs_unit_confirmation: false,
      sources: [
        {
          recipe_id: 'r-seaweed-soup',
          recipe_name: '紫菜蛋花汤',
          quantity: 12,
          quantity_text: '12g',
          unit_code: 'g',
        },
      ],
    },
    {
      id: 'si-005',
      ingredient_id: 'ing-scallion',
      name: '小葱',
      category: '蔬菜',
      source: 'GENERATED',
      required_quantity: null,
      required_quantity_text: '2根',
      unit_code: null,
      inventory_deducted: 0,
      pantry_deducted: 0,
      missing_quantity: null,
      missing_quantity_text: '2根',
      is_purchased: false,
      needs_unit_confirmation: true,
      unit_confirmation_note: '该单位无法可靠自动换算，真实版本需要人工确认后再合并。',
      sources: [
        {
          recipe_id: 'r-chili-pork',
          recipe_name: '辣椒炒肉',
          quantity: null,
          quantity_text: '1根',
          unit_code: null,
        },
        {
          recipe_id: 'r-seaweed-soup',
          recipe_name: '紫菜蛋花汤',
          quantity: null,
          quantity_text: '1根',
          unit_code: null,
        },
      ],
    },

    // ---- MANUAL（手动添加）----
    {
      id: 'si-006',
      ingredient_id: null,
      name: '酸奶',
      category: '手动添加',
      source: 'MANUAL',
      required_quantity: 2,
      required_quantity_text: '2盒',
      unit_code: '盒',
      is_purchased: false,
      note: '糖糖想喝',
    },
    {
      id: 'si-007',
      ingredient_id: null,
      name: '矿泉水',
      category: '手动添加',
      source: 'MANUAL',
      required_quantity: 1,
      required_quantity_text: '1箱',
      unit_code: null,
      unit_text: '箱',
      is_purchased: false,
      note: '',
    },
  ],

  // 分类顺序（用于分组展示）
  category_order: ['蔬菜', '肉蛋', '干货', '手动添加'],

  // 单位选项
  unit_options: ['g', 'kg', 'ml', 'L', '个', '盒', '袋', '自定义'],

  // 分类选项
  category_options: ['蔬菜', '肉蛋', '水产', '乳品', '干货', '主食', '其他'],
}

module.exports = SHOPPING_FIXTURE
