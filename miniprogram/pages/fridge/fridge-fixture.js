/**
 * 冰箱 Tab Phase fixture / Mock 数据
 *
 * 重要：这是显式 fixture，不是真实后端返回。
 * 数据结构对齐 docs/API_CONTRACT_V4.md 中库存与常备食材相关契约。
 * 当前阶段不接真实后端，不得将此数据描述为真实家庭库存同步已完成。
 * "看冰箱做菜"在 fixture 阶段只显示 placeholder，不做真实推荐。
 *
 * 字段命名使用 V4 snake_case；与未来 /api/v1 响应保持同形。
 * fixture 参考日期：2026-09-02（周三），与菜单页 fixture 一致。
 */

// 复用首页已有本地演示图；没有对应图的食材使用彩色占位圆
const IMG = {
  spinach: '/pages/index/images/dish-garlic-spinach.jpg',
  tomato: '/pages/index/images/dish-chili-pork.jpg', // 占位，后续可替换
  pork: '/pages/index/images/dish-chili-pork.jpg',
  egg: '/pages/index/images/dish-milk-toast.jpg', // 占位
  milk: '/pages/index/images/dish-milk-toast.jpg',
  tofu: '/pages/index/images/dish-mapo-tofu.jpg',
  potato: '/pages/index/images/dish-bitter-melon-egg.jpg', // 占位
  rice: '/pages/index/images/dish-seaweed-soup.jpg', // 占位
}

const FRIDGE_FIXTURE = {
  family: {
    id: 'fixture-family',
    name: '我们的小厨房',
  },

  // 参考日期（fixture 用，不接系统时间）
  reference_date: '2026-09-02',

  // ===== 冰箱库存 =====
  inventory_items: [
    {
      id: 'inv-001',
      ingredient_id: 'ing-spinach',
      name: '菠菜',
      image: IMG.spinach,
      quantity: 300,
      unit_code: 'g',
      storage_location: '冷藏',
      category: '蔬菜',
      purchase_date: '2026-08-31',
      expiry_date: '2026-09-03',
      freshness_status: 'EXPIRING',
      expiry_label: '明天到期',
    },
    {
      id: 'inv-002',
      ingredient_id: 'ing-pork-loin',
      name: '猪里脊',
      image: IMG.pork,
      quantity: 450,
      unit_code: 'g',
      storage_location: '冷冻',
      category: '肉蛋',
      purchase_date: '2026-09-01',
      expiry_date: '2026-09-14',
      freshness_status: 'FRESH',
      expiry_label: '还有12天',
    },
    {
      id: 'inv-003',
      ingredient_id: 'ing-egg',
      name: '鸡蛋',
      image: IMG.egg,
      quantity: 8,
      unit_code: '个',
      storage_location: '冷藏',
      category: '肉蛋',
      purchase_date: '2026-08-30',
      expiry_date: '2026-09-11',
      freshness_status: 'FRESH',
      expiry_label: '还有9天',
    },
    {
      id: 'inv-004',
      ingredient_id: 'ing-milk',
      name: '牛奶',
      image: IMG.milk,
      quantity: 1,
      unit_code: '盒',
      storage_location: '冷藏',
      category: '乳品',
      purchase_date: '2026-08-28',
      expiry_date: '2026-09-04',
      freshness_status: 'EXPIRING',
      expiry_label: '2天到期',
    },
    {
      id: 'inv-005',
      ingredient_id: 'ing-tofu',
      name: '嫩豆腐',
      image: IMG.tofu,
      quantity: 1,
      unit_code: '盒',
      storage_location: '冷藏',
      category: '其他',
      purchase_date: '2026-09-01',
      expiry_date: '2026-09-04',
      freshness_status: 'EXPIRING',
      expiry_label: '2天到期',
    },
    {
      id: 'inv-006',
      ingredient_id: 'ing-tomato',
      name: '西红柿',
      image: IMG.tomato,
      quantity: 4,
      unit_code: '个',
      storage_location: '冷藏',
      category: '蔬菜',
      purchase_date: '2026-08-31',
      expiry_date: '2026-09-07',
      freshness_status: 'FRESH',
      expiry_label: '还有5天',
    },
    {
      id: 'inv-007',
      ingredient_id: 'ing-potato',
      name: '土豆',
      image: IMG.potato,
      quantity: 5,
      unit_code: '个',
      storage_location: '常温',
      category: '蔬菜',
      purchase_date: '2026-08-25',
      expiry_date: '2026-09-20',
      freshness_status: 'FRESH',
      expiry_label: '还有18天',
    },
    {
      id: 'inv-008',
      ingredient_id: 'ing-rice',
      name: '大米',
      image: IMG.rice,
      quantity: 2.5,
      unit_code: 'kg',
      storage_location: '常温',
      category: '主食',
      purchase_date: '2026-08-01',
      expiry_date: null,
      freshness_status: 'NORMAL',
      expiry_label: '长期',
    },
  ],

  // ===== 常备食材 =====
  pantry_staples: [
    { id: 'staple-001', ingredient_id: 'ing-oil', name: '食用油', is_staple: true },
    { id: 'staple-002', ingredient_id: 'ing-salt', name: '盐', is_staple: true },
    { id: 'staple-003', ingredient_id: 'ing-soy-light', name: '生抽', is_staple: true },
    { id: 'staple-004', ingredient_id: 'ing-soy-dark', name: '老抽', is_staple: true },
    { id: 'staple-005', ingredient_id: 'ing-vinegar', name: '香醋', is_staple: true },
    { id: 'staple-006', ingredient_id: 'ing-sugar', name: '白糖', is_staple: true },
    { id: 'staple-007', ingredient_id: 'ing-starch', name: '淀粉', is_staple: true },
    { id: 'staple-008', ingredient_id: 'ing-cooking-wine', name: '料酒', is_staple: true },
  ],

  // 分类
  categories: ['全部', '蔬菜', '肉蛋', '水产', '乳品', '主食', '其他'],

  // 单位选项
  unit_options: ['g', 'kg', 'ml', 'L', '个', '盒', '袋'],

  // 存放位置选项
  storage_options: ['冷藏', '冷冻', '常温'],
}

module.exports = FRIDGE_FIXTURE
