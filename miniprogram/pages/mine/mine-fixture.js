/**
 * 我的 Tab V4 fixture / Mock 数据
 *
 * 重要：这是显式 fixture，不是真实后端返回。
 * 当前阶段不接真实 Auth、不接 Family V1 API、不接真实设置。
 * 默认状态：已登录、已加入家庭、角色 OWNER。
 * 真正的 wx.login / code2Session / JWT / /me / /me/families
 * 将在下一阶段统一接入 V1 backend。
 */

const MINE_FIXTURE = {
  authenticated: true,
  has_family: true,

  user: {
    id: 'fixture-user-rui',
    nickname: '锐',
    avatar_url: null, // 使用文字头像占位
  },

  family: {
    id: 'fixture-family',
    name: '我们的小厨房',
    role: 'OWNER',
    invite_code: 'KITCHEN8',
  },

  members: [
    {
      id: 'fixture-member-rui',
      user_id: 'fixture-user-rui',
      nickname: '锐',
      role: 'OWNER',
      role_label: '家庭主人',
    },
    {
      id: 'fixture-member-tangtang',
      user_id: 'fixture-user-tangtang',
      nickname: '糖糖',
      role: 'MEMBER',
      role_label: '家庭成员',
    },
  ],

  stats: {
    favorites: 12,
    ratings: 8,
    cooked: 21,
    kisses: 36,
  },

  // 厨房设置 preview（仅展示结构，不保存）
  kitchen_settings_preview: {
    kitchen_name: '我们的小厨房',
    default_diners: 2,
    breakfast_target_count: 2,
    lunch_target_count: 2,
    dinner_target_count: 3,
    common_tools: ['炒锅', '蒸锅', '电饭煲', '微波炉'],
    repeat_strong_days: 7,
    repeat_penalty_days: 14,
    repeat_recover_days: 28,
    random_default_mode: 'BALANCED',
  },

  // 设置 preview 分组（仅展示结构）
  settings_preview: {
    personal: ['昵称', '头像'],
    family: ['默认人数', '餐次默认菜数', '常用厨具'],
    diet: ['辣度', '忌口', '过敏原', '不喜欢的食材'],
    recommendation: ['重复周期', '随机默认模式'],
    other: ['数据导入导出', '关于'],
  },
}

module.exports = MINE_FIXTURE
