/**
 * 首页 Phase 2.5 Fixture / Mock 数据
 *
 * 重要：这是显式 fixture，不是真实后端返回。
 * 数据结构严格对齐 docs/API_CONTRACT_V4.md 第 21 节「首页 fixture 契约」。
 * 当前阶段不接真实后端，不得将此数据描述为真实家庭多人同步已完成。
 *
 * 字段命名使用 V4 snake_case；与未来 /api/v1 响应保持同形。
 */

const HOMEPAGE_FIXTURE = {
  family: {
    id: 'fixture-family',
    name: '我们的小厨房',
    photo_url: null,
    header_mode: 'DUAL_AVATAR',
    version: 1
  },
  members: [
    {
      id: 'm1',
      role: 'OWNER',
      user: { id: 'u1', nickname: '锐', avatar_url: null }
    },
    {
      id: 'm2',
      role: 'MEMBER',
      user: { id: 'u2', nickname: '糖糖', avatar_url: null }
    }
  ],
  today: {
    date: '2026-09-02',
    weekday: 3,
    diners_count: 2
  },
  weekly_plan: {
    id: 'fixture-plan',
    week_start_date: '2026-08-31',
    status: 'ACTIVE',
    items: [
      // ===== 周一 2026-08-31 =====
      { id: 'wp-mon-b1', plan_date: '2026-08-31', meal_type: 'BREAKFAST', sort_order: 1, locked: false,
        recipe: { id: 'r-soy-milk', name: '豆浆', cover_image_url: null } },
      { id: 'wp-mon-b2', plan_date: '2026-08-31', meal_type: 'BREAKFAST', sort_order: 2, locked: false,
        recipe: { id: 'r-you-tiao', name: '油条', cover_image_url: null } },
      { id: 'wp-mon-l1', plan_date: '2026-08-31', meal_type: 'LUNCH', sort_order: 1, locked: false,
        recipe: { id: 'r-tomato-egg', name: '番茄炒蛋', cover_image_url: null } },
      { id: 'wp-mon-l2', plan_date: '2026-08-31', meal_type: 'LUNCH', sort_order: 2, locked: false,
        recipe: { id: 'r-green-veg', name: '清炒时蔬', cover_image_url: null } },
      { id: 'wp-mon-d1', plan_date: '2026-08-31', meal_type: 'DINNER', sort_order: 1, locked: false,
        recipe: { id: 'r-braised-ribs', name: '红烧排骨', cover_image_url: null } },
      { id: 'wp-mon-d2', plan_date: '2026-08-31', meal_type: 'DINNER', sort_order: 2, locked: false,
        recipe: { id: 'r-broccoli', name: '蒜蓉西兰花', cover_image_url: null } },

      // ===== 周二 2026-09-01 =====
      { id: 'wp-tue-b1', plan_date: '2026-09-01', meal_type: 'BREAKFAST', sort_order: 1, locked: false,
        recipe: { id: 'r-congee', name: '白粥', cover_image_url: null } },
      { id: 'wp-tue-b2', plan_date: '2026-09-01', meal_type: 'BREAKFAST', sort_order: 2, locked: false,
        recipe: { id: 'r-tea-egg', name: '茶叶蛋', cover_image_url: null } },
      { id: 'wp-tue-l1', plan_date: '2026-09-01', meal_type: 'LUNCH', sort_order: 1, locked: false,
        recipe: { id: 'r-kung-pao', name: '宫保鸡丁', cover_image_url: null } },
      { id: 'wp-tue-l2', plan_date: '2026-09-01', meal_type: 'LUNCH', sort_order: 2, locked: false,
        recipe: { id: 'r-cucumber', name: '凉拌黄瓜', cover_image_url: null } },
      { id: 'wp-tue-d1', plan_date: '2026-09-01', meal_type: 'DINNER', sort_order: 1, locked: false,
        recipe: { id: 'r-steamed-fish', name: '清蒸鲈鱼', cover_image_url: null } },
      { id: 'wp-tue-d2', plan_date: '2026-09-01', meal_type: 'DINNER', sort_order: 2, locked: false,
        recipe: { id: 'r-bok-choy', name: '炒青菜', cover_image_url: null } },

      // ===== 周三 2026-09-02 (today = weekday 3) =====
      { id: 'wp-wed-b1', plan_date: '2026-09-02', meal_type: 'BREAKFAST', sort_order: 1, locked: false,
        recipe: { id: 'r-milk-bread', name: '牛奶吐司', cover_image_url: '/pages/index/images/dish-milk-toast.jpg' } },
      { id: 'wp-wed-b2', plan_date: '2026-09-02', meal_type: 'BREAKFAST', sort_order: 2, locked: false,
        recipe: { id: 'r-fruit', name: '水果拼盘', cover_image_url: '/pages/index/images/dish-fruit-plate.jpg' } },
      { id: 'wp-wed-l1', plan_date: '2026-09-02', meal_type: 'LUNCH', sort_order: 1, locked: true,
        recipe: { id: 'r-mapo-tofu', name: '麻婆豆腐', cover_image_url: '/pages/index/images/dish-mapo-tofu.jpg' } },
      { id: 'wp-wed-l2', plan_date: '2026-09-02', meal_type: 'LUNCH', sort_order: 2, locked: false,
        recipe: { id: 'r-spinach', name: '蒜蓉菠菜', cover_image_url: '/pages/index/images/dish-garlic-spinach.jpg' } },
      { id: 'wp-wed-d1', plan_date: '2026-09-02', meal_type: 'DINNER', sort_order: 1, locked: false,
        recipe: { id: 'r-chili-pork', name: '辣椒炒肉', cover_image_url: '/pages/index/images/dish-chili-pork.jpg' } },
      { id: 'wp-wed-d2', plan_date: '2026-09-02', meal_type: 'DINNER', sort_order: 2, locked: false,
        recipe: { id: 'r-bitter-melon-egg', name: '苦瓜炒蛋', cover_image_url: '/pages/index/images/dish-bitter-melon-egg.jpg' } },
      { id: 'wp-wed-d3', plan_date: '2026-09-02', meal_type: 'DINNER', sort_order: 3, locked: false,
        recipe: { id: 'r-seaweed-soup', name: '紫菜蛋花汤', cover_image_url: '/pages/index/images/dish-seaweed-soup.jpg' } },

      // ===== 周四 2026-09-03 =====
      { id: 'wp-thu-b1', plan_date: '2026-09-03', meal_type: 'BREAKFAST', sort_order: 1, locked: false,
        recipe: { id: 'r-egg-pancake', name: '鸡蛋饼', cover_image_url: null } },
      { id: 'wp-thu-l1', plan_date: '2026-09-03', meal_type: 'LUNCH', sort_order: 1, locked: false,
        recipe: { id: 'r-beef-noodle', name: '红烧牛肉面', cover_image_url: null } },
      { id: 'wp-thu-d1', plan_date: '2026-09-03', meal_type: 'DINNER', sort_order: 1, locked: false,
        recipe: { id: 'r-shrimp', name: '油焖大虾', cover_image_url: null } },
      { id: 'wp-thu-d2', plan_date: '2026-09-03', meal_type: 'DINNER', sort_order: 2, locked: false,
        recipe: { id: 'r-cauliflower', name: '干煸菜花', cover_image_url: null } },

      // ===== 周五 2026-09-04 =====
      { id: 'wp-fri-b1', plan_date: '2026-09-04', meal_type: 'BREAKFAST', sort_order: 1, locked: false,
        recipe: { id: 'r-porridge', name: '皮蛋瘦肉粥', cover_image_url: null } },
      { id: 'wp-fri-l1', plan_date: '2026-09-04', meal_type: 'LUNCH', sort_order: 1, locked: false,
        recipe: { id: 'r-black-fish', name: '酸菜鱼', cover_image_url: null } },
      { id: 'wp-fri-l2', plan_date: '2026-09-04', meal_type: 'LUNCH', sort_order: 2, locked: false,
        recipe: { id: 'r-potato-shred', name: '酸辣土豆丝', cover_image_url: null } },
      { id: 'wp-fri-d1', plan_date: '2026-09-04', meal_type: 'DINNER', sort_order: 1, locked: false,
        recipe: { id: 'r-curry-chicken', name: '咖喱鸡', cover_image_url: null } },
      { id: 'wp-fri-d2', plan_date: '2026-09-04', meal_type: 'DINNER', sort_order: 2, locked: false,
        recipe: { id: 'r-okra', name: '白灼秋葵', cover_image_url: null } },

      // ===== 周六 2026-09-05 =====
      { id: 'wp-sat-b1', plan_date: '2026-09-05', meal_type: 'BREAKFAST', sort_order: 1, locked: false,
        recipe: { id: 'r-dumpling', name: '三鲜饺子', cover_image_url: null } },
      { id: 'wp-sat-l1', plan_date: '2026-09-05', meal_type: 'LUNCH', sort_order: 1, locked: false,
        recipe: { id: 'r-hotpot', name: '家庭火锅', cover_image_url: null } },
      { id: 'wp-sat-d1', plan_date: '2026-09-05', meal_type: 'DINNER', sort_order: 1, locked: false,
        recipe: { id: 'r-roast-lamb', name: '烤羊排', cover_image_url: null } },
      { id: 'wp-sat-d2', plan_date: '2026-09-05', meal_type: 'DINNER', sort_order: 2, locked: false,
        recipe: { id: 'r-mushroom', name: '香菇青菜', cover_image_url: null } },

      // ===== 周日 2026-09-06 =====
      { id: 'wp-sun-b1', plan_date: '2026-09-06', meal_type: 'BREAKFAST', sort_order: 1, locked: false,
        recipe: { id: 'r-wonton', name: '鲜肉小馄饨', cover_image_url: null } },
      { id: 'wp-sun-l1', plan_date: '2026-09-06', meal_type: 'LUNCH', sort_order: 1, locked: false,
        recipe: { id: 'r-braised-pork', name: '红烧肉', cover_image_url: null } },
      { id: 'wp-sun-l2', plan_date: '2026-09-06', meal_type: 'LUNCH', sort_order: 2, locked: false,
        recipe: { id: 'r-lotus-root', name: '荷塘小炒', cover_image_url: null } },
      { id: 'wp-sun-d1', plan_date: '2026-09-06', meal_type: 'DINNER', sort_order: 1, locked: false,
        recipe: { id: 'r-congbao-tofu', name: '小葱拌豆腐', cover_image_url: null } },
      { id: 'wp-sun-d2', plan_date: '2026-09-06', meal_type: 'DINNER', sort_order: 2, locked: false,
        recipe: { id: 'r-pumpkin', name: '蒸南瓜', cover_image_url: null } }
    ]
  },
  current_meal: {
    id: 'fixture-meal',
    meal_date: '2026-09-02',
    meal_type: 'DINNER',
    status: 'PLANNING',
    diners_count: 2,
    items: [
      {
        id: 'mi-1',
        recipe: { id: 'r-chili-pork', name: '辣椒炒肉', cover_image_url: '/pages/index/images/dish-chili-pork.jpg' },
        servings: 2,
        selected_by_user_id: 'u2',
        selected_by_nickname: '糖糖'
      },
      {
        id: 'mi-2',
        recipe: { id: 'r-bitter-melon-egg', name: '苦瓜炒蛋', cover_image_url: '/pages/index/images/dish-bitter-melon-egg.jpg' },
        servings: 2,
        selected_by_user_id: 'u1',
        selected_by_nickname: '锐'
      }
    ]
  }
}

module.exports = HOMEPAGE_FIXTURE
