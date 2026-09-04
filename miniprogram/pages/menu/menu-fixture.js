/**
 * 菜单 Tab Phase fixture / Mock 数据
 *
 * 重要：这是显式 fixture，不是真实后端返回。
 * 数据结构对齐 docs/API_CONTRACT_V4.md：
 *   - 第 6 节 Recipe list
 *   - 第 10 节 Weekly plans
 *   - 第 11 节 Meals / 本餐菜单
 * 当前阶段不接真实后端，不得将此数据描述为真实家庭多人同步已完成。
 * 所有"重新安排"操作在 fixture 阶段只显示 placeholder，不真的随机改计划。
 *
 * 字段命名使用 V4 snake_case；与未来 /api/v1 响应保持同形。
 */

// 复用首页已有的本地演示菜品图（绝对路径，menu 页可直接引用）
const IMG = {
  chiliPork: '/pages/index/images/dish-chili-pork.jpg',
  bitterMelonEgg: '/pages/index/images/dish-bitter-melon-egg.jpg',
  mapoTofu: '/pages/index/images/dish-mapo-tofu.jpg',
  garlicSpinach: '/pages/index/images/dish-garlic-spinach.jpg',
  milkToast: '/pages/index/images/dish-milk-toast.jpg',
  fruitPlate: '/pages/index/images/dish-fruit-plate.jpg',
  seaweedSoup: '/pages/index/images/dish-seaweed-soup.jpg',
}

const MENU_FIXTURE = {
  family: {
    id: 'fixture-family',
    name: '我们的小厨房',
    version: 1
  },

  // ===== 本周计划（与首页 fixture 同一周，today = 周三 2026-09-02）=====
  weekly_plan: {
    id: 'fixture-plan',
    week_start_date: '2026-08-31',
    status: 'ACTIVE',
    items: [
      // 周一
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

      // 周二
      { id: 'wp-tue-b1', plan_date: '2026-09-01', meal_type: 'BREAKFAST', sort_order: 1, locked: false,
        recipe: { id: 'r-congee', name: '白粥', cover_image_url: null } },
      { id: 'wp-tue-b2', plan_date: '2026-09-01', meal_type: 'BREAKFAST', sort_order: 2, locked: false,
        recipe: { id: 'r-tea-egg', name: '茶叶蛋', cover_image_url: null } },
      { id: 'wp-tue-l1', plan_date: '2026-09-01', meal_type: 'LUNCH', sort_order: 1, locked: false,
        recipe: { id: 'r-kung-pao', name: '宫保鸡丁', cover_image_url: null } },
      { id: 'wp-tue-l2', plan_date: '2026-09-01', meal_type: 'LUNCH', sort_order: 2, locked: false,
        recipe: { id: 'r-cucumber-salad', name: '凉拌黄瓜', cover_image_url: null } },
      { id: 'wp-tue-d1', plan_date: '2026-09-01', meal_type: 'DINNER', sort_order: 1, locked: false,
        recipe: { id: 'r-steamed-fish', name: '清蒸鲈鱼', cover_image_url: null } },
      { id: 'wp-tue-d2', plan_date: '2026-09-01', meal_type: 'DINNER', sort_order: 2, locked: false,
        recipe: { id: 'r-bok-choy', name: '炒青菜', cover_image_url: null } },

      // 周三 (today)
      { id: 'wp-wed-b1', plan_date: '2026-09-02', meal_type: 'BREAKFAST', sort_order: 1, locked: false,
        recipe: { id: 'r-milk-toast', name: '牛奶吐司', cover_image_url: IMG.milkToast } },
      { id: 'wp-wed-b2', plan_date: '2026-09-02', meal_type: 'BREAKFAST', sort_order: 2, locked: false,
        recipe: { id: 'r-fruit-plate', name: '水果拼盘', cover_image_url: IMG.fruitPlate } },
      { id: 'wp-wed-l1', plan_date: '2026-09-02', meal_type: 'LUNCH', sort_order: 1, locked: true,
        recipe: { id: 'r-mapo-tofu', name: '麻婆豆腐', cover_image_url: IMG.mapoTofu } },
      { id: 'wp-wed-l2', plan_date: '2026-09-02', meal_type: 'LUNCH', sort_order: 2, locked: false,
        recipe: { id: 'r-garlic-spinach', name: '蒜蓉菠菜', cover_image_url: IMG.garlicSpinach } },
      { id: 'wp-wed-d1', plan_date: '2026-09-02', meal_type: 'DINNER', sort_order: 1, locked: false,
        recipe: { id: 'r-chili-pork', name: '辣椒炒肉', cover_image_url: IMG.chiliPork } },
      { id: 'wp-wed-d2', plan_date: '2026-09-02', meal_type: 'DINNER', sort_order: 2, locked: false,
        recipe: { id: 'r-bitter-melon-egg', name: '苦瓜炒蛋', cover_image_url: IMG.bitterMelonEgg } },
      { id: 'wp-wed-d3', plan_date: '2026-09-02', meal_type: 'DINNER', sort_order: 3, locked: false,
        recipe: { id: 'r-seaweed-soup', name: '紫菜蛋花汤', cover_image_url: IMG.seaweedSoup } },

      // 周四
      { id: 'wp-thu-b1', plan_date: '2026-09-03', meal_type: 'BREAKFAST', sort_order: 1, locked: false,
        recipe: { id: 'r-egg-pancake', name: '鸡蛋饼', cover_image_url: null } },
      { id: 'wp-thu-l1', plan_date: '2026-09-03', meal_type: 'LUNCH', sort_order: 1, locked: false,
        recipe: { id: 'r-braised-pork', name: '红烧肉', cover_image_url: null } },
      { id: 'wp-thu-l2', plan_date: '2026-09-03', meal_type: 'LUNCH', sort_order: 2, locked: false,
        recipe: { id: 'r-egg-drop-soup', name: '蛋花汤', cover_image_url: null } },
      { id: 'wp-thu-d1', plan_date: '2026-09-03', meal_type: 'DINNER', sort_order: 1, locked: false,
        recipe: { id: 'r-shrimp', name: '白灼虾', cover_image_url: null } },
      { id: 'wp-thu-d2', plan_date: '2026-09-03', meal_type: 'DINNER', sort_order: 2, locked: false,
        recipe: { id: 'r-mushroom', name: '香菇青菜', cover_image_url: null } },

      // 周五
      { id: 'wp-fri-b1', plan_date: '2026-09-04', meal_type: 'BREAKFAST', sort_order: 1, locked: false,
        recipe: { id: 'r-noodle', name: '阳春面', cover_image_url: null } },
      { id: 'wp-fri-l1', plan_date: '2026-09-04', meal_type: 'LUNCH', sort_order: 1, locked: false,
        recipe: { id: 'r-sweet-sour-ribs', name: '糖醋排骨', cover_image_url: null } },
      { id: 'wp-fri-d1', plan_date: '2026-09-04', meal_type: 'DINNER', sort_order: 1, locked: false,
        recipe: { id: 'r-hot-pot', name: '家庭火锅', cover_image_url: null } },

      // 周六
      { id: 'wp-sat-b1', plan_date: '2026-09-05', meal_type: 'BREAKFAST', sort_order: 1, locked: false,
        recipe: { id: 'r-dim-sum', name: '广式早茶', cover_image_url: null } },
      { id: 'wp-sat-l1', plan_date: '2026-09-05', meal_type: 'LUNCH', sort_order: 1, locked: false,
        recipe: { id: 'r-roast-duck', name: '北京烤鸭', cover_image_url: null } },
      { id: 'wp-sat-d1', plan_date: '2026-09-05', meal_type: 'DINNER', sort_order: 1, locked: false,
        recipe: { id: 'r-pizza', name: '家庭披萨', cover_image_url: null } },

      // 周日
      { id: 'wp-sun-b1', plan_date: '2026-09-06', meal_type: 'BREAKFAST', sort_order: 1, locked: false,
        recipe: { id: 'r-porridge', name: '皮蛋瘦肉粥', cover_image_url: null } },
      { id: 'wp-sun-l1', plan_date: '2026-09-06', meal_type: 'LUNCH', sort_order: 1, locked: false,
        recipe: { id: 'r-dumplings', name: '手工饺子', cover_image_url: null } },
      { id: 'wp-sun-d1', plan_date: '2026-09-06', meal_type: 'DINNER', sort_order: 1, locked: false,
        recipe: { id: 'r-congee-buffet', name: '清粥小菜', cover_image_url: null } },
    ]
  },

  // ===== 菜谱分类（左侧栏）=====
  categories: [
    { code: 'RECOMMEND', label: '推荐' },
    { code: 'HOT_DISH', label: '热菜' },
    { code: 'COLD_DISH', label: '凉菜' },
    { code: 'SOUP', label: '汤羹' },
    { code: 'MEAT', label: '荤菜' },
    { code: 'VEGETABLE', label: '素菜' },
    { code: 'STAPLE', label: '主食' },
    { code: 'BREAKFAST', label: '早餐' },
    { code: 'DESSERT', label: '甜品' },
    { code: 'MY_RECIPES', label: '我的菜谱' },
    { code: 'FAVORITES', label: '收藏' },
    { code: 'RECENT', label: '最近吃过' },
  ],

  // ===== 菜谱库（对齐 API_CONTRACT 第6节 Recipe list 字段）=====
  recipes: [
    { id: 'r-chili-pork', kind: 'BASE', name: '辣椒炒肉', cover_image_url: IMG.chiliPork,
      category_code: 'HOT_DISH', cook_time_minutes: 20, spiciness: 3, sweetness: null,
      suggested_kiss: 4, has_family_variant: true, family_variant_id: 'fr-chili-pork',
      is_favorite: true, tags: ['下饭菜', '湘菜'] },
    { id: 'r-bitter-melon-egg', kind: 'BASE', name: '苦瓜炒蛋', cover_image_url: IMG.bitterMelonEgg,
      category_code: 'VEGETABLE', cook_time_minutes: 15, spiciness: 0, sweetness: null,
      suggested_kiss: 3, has_family_variant: false, is_favorite: false, tags: ['清热', '快手'] },
    { id: 'r-mapo-tofu', kind: 'BASE', name: '麻婆豆腐', cover_image_url: IMG.mapoTofu,
      category_code: 'HOT_DISH', cook_time_minutes: 25, spiciness: 4, sweetness: null,
      suggested_kiss: 5, has_family_variant: true, family_variant_id: 'fr-mapo-tofu',
      is_favorite: true, tags: ['川菜', '下饭'] },
    { id: 'r-garlic-spinach', kind: 'BASE', name: '蒜蓉菠菜', cover_image_url: IMG.garlicSpinach,
      category_code: 'VEGETABLE', cook_time_minutes: 10, spiciness: 0, sweetness: null,
      suggested_kiss: 2, has_family_variant: false, is_favorite: false, tags: ['快手', '补铁'] },
    { id: 'r-milk-toast', kind: 'BASE', name: '牛奶吐司', cover_image_url: IMG.milkToast,
      category_code: 'BREAKFAST', cook_time_minutes: 5, spiciness: 0, sweetness: 2,
      suggested_kiss: 2, has_family_variant: false, is_favorite: false, tags: ['早餐', '快手'] },
    { id: 'r-fruit-plate', kind: 'BASE', name: '水果拼盘', cover_image_url: IMG.fruitPlate,
      category_code: 'DESSERT', cook_time_minutes: 5, spiciness: 0, sweetness: 3,
      suggested_kiss: 2, has_family_variant: false, is_favorite: false, tags: ['健康', '免开火'] },
    { id: 'r-seaweed-soup', kind: 'BASE', name: '紫菜蛋花汤', cover_image_url: IMG.seaweedSoup,
      category_code: 'SOUP', cook_time_minutes: 8, spiciness: 0, sweetness: null,
      suggested_kiss: 2, has_family_variant: false, is_favorite: false, tags: ['快手', '汤'] },
    { id: 'r-tomato-egg', kind: 'BASE', name: '番茄炒蛋', cover_image_url: null,
      category_code: 'HOT_DISH', cook_time_minutes: 12, spiciness: 0, sweetness: 2,
      suggested_kiss: 3, has_family_variant: true, family_variant_id: 'fr-tomato-egg',
      is_favorite: true, tags: ['家常', '下饭'] },
    { id: 'r-braised-ribs', kind: 'BASE', name: '红烧排骨', cover_image_url: null,
      category_code: 'MEAT', cook_time_minutes: 45, spiciness: 0, sweetness: 2,
      suggested_kiss: 5, has_family_variant: false, is_favorite: true, tags: ['硬菜', '宴客'] },
    { id: 'r-kung-pao', kind: 'BASE', name: '宫保鸡丁', cover_image_url: null,
      category_code: 'HOT_DISH', cook_time_minutes: 20, spiciness: 3, sweetness: 1,
      suggested_kiss: 4, has_family_variant: false, is_favorite: false, tags: ['川菜', '下饭'] },
    { id: 'r-cucumber-salad', kind: 'BASE', name: '凉拌黄瓜', cover_image_url: null,
      category_code: 'COLD_DISH', cook_time_minutes: 5, spiciness: 1, sweetness: null,
      suggested_kiss: 2, has_family_variant: false, is_favorite: false, tags: ['凉菜', '快手'] },
    { id: 'r-steamed-fish', kind: 'BASE', name: '清蒸鲈鱼', cover_image_url: null,
      category_code: 'MEAT', cook_time_minutes: 20, spiciness: 0, sweetness: null,
      suggested_kiss: 4, has_family_variant: false, is_favorite: true, tags: ['清淡', '高蛋白'] },
    { id: 'r-braised-pork', kind: 'BASE', name: '红烧肉', cover_image_url: null,
      category_code: 'MEAT', cook_time_minutes: 60, spiciness: 0, sweetness: 2,
      suggested_kiss: 5, has_family_variant: false, is_favorite: true, tags: ['硬菜', '经典'] },
    { id: 'r-egg-drop-soup', kind: 'BASE', name: '蛋花汤', cover_image_url: null,
      category_code: 'SOUP', cook_time_minutes: 8, spiciness: 0, sweetness: null,
      suggested_kiss: 2, has_family_variant: false, is_favorite: false, tags: ['快手', '汤'] },
    { id: 'r-shrimp', kind: 'BASE', name: '白灼虾', cover_image_url: null,
      category_code: 'MEAT', cook_time_minutes: 10, spiciness: 0, sweetness: null,
      suggested_kiss: 4, has_family_variant: false, is_favorite: false, tags: ['海鲜', '清淡'] },
    { id: 'r-mushroom', kind: 'BASE', name: '香菇青菜', cover_image_url: null,
      category_code: 'VEGETABLE', cook_time_minutes: 12, spiciness: 0, sweetness: null,
      suggested_kiss: 3, has_family_variant: false, is_favorite: false, tags: ['素菜', '鲜'] },
    { id: 'r-noodle', kind: 'BASE', name: '阳春面', cover_image_url: null,
      category_code: 'STAPLE', cook_time_minutes: 10, spiciness: 0, sweetness: null,
      suggested_kiss: 2, has_family_variant: false, is_favorite: false, tags: ['主食', '快手'] },
    { id: 'r-sweet-sour-ribs', kind: 'BASE', name: '糖醋排骨', cover_image_url: null,
      category_code: 'MEAT', cook_time_minutes: 40, spiciness: 0, sweetness: 4,
      suggested_kiss: 5, has_family_variant: false, is_favorite: true, tags: ['酸甜', '孩子爱'] },
    { id: 'r-hot-pot', kind: 'BASE', name: '家庭火锅', cover_image_url: null,
      category_code: 'HOT_DISH', cook_time_minutes: 30, spiciness: 2, sweetness: null,
      suggested_kiss: 4, has_family_variant: false, is_favorite: false, tags: ['聚餐', '热闹'] },
    { id: 'r-dumplings', kind: 'BASE', name: '手工饺子', cover_image_url: null,
      category_code: 'STAPLE', cook_time_minutes: 40, spiciness: 0, sweetness: null,
      suggested_kiss: 4, has_family_variant: false, is_favorite: true, tags: ['主食', '节日'] },

    // ===== FAMILY recipes（家庭派生版，对齐 API_CONTRACT kind=FAMILY）=====
    { id: 'fr-chili-pork', kind: 'FAMILY', family_id: 'fixture-family',
      parent_recipe_id: 'r-chili-pork', name: '辣椒炒肉', cover_image_url: IMG.chiliPork,
      category_code: 'HOT_DISH', cook_time_minutes: 18, spiciness: 2, sweetness: null,
      suggested_kiss: 5, has_family_variant: false, is_favorite: true, tags: ['我家做法', '少辣'] },
    { id: 'fr-mapo-tofu', kind: 'FAMILY', family_id: 'fixture-family',
      parent_recipe_id: 'r-mapo-tofu', name: '麻婆豆腐', cover_image_url: IMG.mapoTofu,
      category_code: 'HOT_DISH', cook_time_minutes: 22, spiciness: 3, sweetness: null,
      suggested_kiss: 5, has_family_variant: false, is_favorite: true, tags: ['我家做法', '嫩豆腐'] },
    { id: 'fr-tomato-egg', kind: 'FAMILY', family_id: 'fixture-family',
      parent_recipe_id: 'r-tomato-egg', name: '番茄炒蛋', cover_image_url: null,
      category_code: 'HOT_DISH', cook_time_minutes: 10, spiciness: 0, sweetness: 3,
      suggested_kiss: 4, has_family_variant: false, is_favorite: true, tags: ['我家做法', '多糖'] },
  ],

  // ===== 当前选菜目标（全部菜品视图顶部上下文）=====
  // 默认目标：今天晚餐
  target_meal: {
    meal_date: '2026-09-02',
    meal_type: 'DINNER',
  },

  // ===== 本餐菜单本地状态（date + meal_type 二维隔离，与首页一致）=====
  // fixture 预填：周三晚餐已有两道（与首页 current_meal 对齐）
  meals_by_date_and_type: {
    '2026-09-02': {
      BREAKFAST: { items: [] },
      LUNCH: { items: [] },
      DINNER: {
        items: [
          { id: 'mi-wed-d-1', recipe_id: 'fr-chili-pork', source_recipe_id: 'r-chili-pork',
            recipe_name: '辣椒炒肉',
            cover_image_url: IMG.chiliPork, servings: 2, source: 'WEEKLY_PLAN',
            selected_by_user_id: 'u2', selected_by_nickname: '糖糖' },
          { id: 'mi-wed-d-2', recipe_id: 'r-bitter-melon-egg', recipe_name: '苦瓜炒蛋',
            cover_image_url: IMG.bitterMelonEgg, servings: 2, source: 'WEEKLY_PLAN',
            selected_by_user_id: 'u1', selected_by_nickname: '锐' },
        ]
      },
    },
  },

  // 今天信息（与首页一致）
  today: {
    date: '2026-09-02',
    weekday: 3,
    diners_count: 2,
  },
}

module.exports = MENU_FIXTURE
