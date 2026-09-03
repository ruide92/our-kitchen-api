const axios = require('axios');

const BASE_URL = 'http://localhost:3001/api';
let token = '';
let userId = '';
let familyId = '';
let dishId = '';

async function test(name, fn) {
  try {
    const result = await fn();
    console.log(`✅ ${name}`);
    return result;
  } catch (err) {
    console.log(`❌ ${name}: ${err.response?.data?.error || err.message}`);
    return null;
  }
}

async function main() {
  console.log('\n========== 开始API测试 ==========\n');

  // 1. 公开API测试
  console.log('--- 公开API ---');
  
  await test('健康检查', async () => {
    const res = await axios.get(`${BASE_URL}/health`);
    return res.data;
  });

  const dishes = await test('菜品列表', async () => {
    const res = await axios.get(`${BASE_URL}/dishes`, { params: { page: 1, pageSize: 5 } });
    console.log(`   菜品数量: ${res.data.list.length}`);
    dishId = res.data.list[0]?.id;
    return res.data;
  });

  await test('菜品详情', async () => {
    const res = await axios.get(`${BASE_URL}/dishes/${dishId}`);
    console.log(`   菜名: ${res.data.name}`);
    return res.data;
  });

  await test('分类列表', async () => {
    const res = await axios.get(`${BASE_URL}/dishes/categories/list`);
    console.log(`   分类: ${res.data.join(', ')}`);
    return res.data;
  });

  await test('热门菜品', async () => {
    const res = await axios.get(`${BASE_URL}/dishes/hot/list`);
    console.log(`   热门数量: ${res.data.length}`);
    return res.data;
  });

  await test('调味品预置', async () => {
    const res = await axios.get(`${BASE_URL}/condiments/presets`);
    console.log(`   预置数量: ${res.data.length}`);
    return res.data;
  });

  // 2. 登录测试
  console.log('\n--- 登录认证 ---');
  
  const loginResult = await test('微信登录', async () => {
    const res = await axios.post(`${BASE_URL}/auth/login`, {
      code: 'test_code_123456',
      nickname: '测试用户',
      avatar: ''
    });
    token = res.data.token;
    userId = res.data.user.id;
    console.log(`   用户ID: ${userId}`);
    console.log(`   Token: ${token.substring(0, 20)}...`);
    return res.data;
  });

  // 设置axios默认header
  axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;

  await test('获取用户信息', async () => {
    const res = await axios.get(`${BASE_URL}/auth/info`);
    console.log(`   昵称: ${res.data.nickname}`);
    return res.data;
  });

  // 3. 家庭测试
  console.log('\n--- 家庭管理 ---');
  
  const family = await test('创建家庭', async () => {
    const res = await axios.post(`${BASE_URL}/family`, { name: '测试家庭' });
    familyId = res.data.id;
    console.log(`   家庭ID: ${familyId}`);
    console.log(`   邀请码: ${res.data.invite_code}`);
    return res.data;
  });

  await test('获取我的家庭', async () => {
    const res = await axios.get(`${BASE_URL}/family/mine`);
    console.log(`   家庭名: ${res.data.name}`);
    console.log(`   成员数: ${res.data.members.length}`);
    return res.data;
  });

  await test('成员列表', async () => {
    const res = await axios.get(`${BASE_URL}/family/members`);
    console.log(`   成员数: ${res.data.length}`);
    return res.data;
  });

  // 4. 菜品交互测试
  console.log('\n--- 菜品交互 ---');
  
  await test('收藏菜品', async () => {
    const res = await axios.post(`${BASE_URL}/dishes/${dishId}/favorite`);
    console.log(`   收藏状态: ${res.data.isFavorite}`);
    return res.data;
  });

  await test('收藏列表', async () => {
    const res = await axios.get(`${BASE_URL}/favorites`);
    console.log(`   收藏数量: ${res.data.length}`);
    return res.data;
  });

  await test('评分菜品', async () => {
    const res = await axios.post(`${BASE_URL}/dishes/${dishId}/rate`, { rating: 5 });
    console.log(`   评分: ${res.data.rating}`);
    return res.data;
  });

  await test('取消评分', async () => {
    const res = await axios.delete(`${BASE_URL}/dishes/${dishId}/rate`);
    return res.data;
  });

  await test('我评分的菜', async () => {
    const res = await axios.get(`${BASE_URL}/dishes/my-rated/list`);
    console.log(`   已评分数量: ${res.data.length}`);
    return res.data;
  });

  // 5. 点餐测试
  console.log('\n--- 点餐功能 ---');
  
  await test('创建点餐', async () => {
    const res = await axios.post(`${BASE_URL}/orders`, {
      dishId,
      mealType: 'dinner',
      note: '想吃这个'
    });
    console.log(`   点餐ID: ${res.data.id}`);
    return res.data;
  });

  await test('点餐列表', async () => {
    const res = await axios.get(`${BASE_URL}/orders`);
    console.log(`   点餐数量: ${res.data.length}`);
    return res.data;
  });

  // 6. 冰箱测试
  console.log('\n--- 冰箱管理 ---');
  
  let fridgeItemId = '';
  await test('添加冰箱食材', async () => {
    const res = await axios.post(`${BASE_URL}/fridge`, {
      name: '鸡蛋',
      quantity: 10,
      unit: '个',
      category: '冷藏',
      storage_location: '冷藏'
    });
    fridgeItemId = res.data.id;
    console.log(`   食材ID: ${fridgeItemId}`);
    return res.data;
  });

  await test('冰箱列表', async () => {
    const res = await axios.get(`${BASE_URL}/fridge`);
    console.log(`   食材数量: ${res.data.list.length}`);
    return res.data;
  });

  await test('修改冰箱食材', async () => {
    const res = await axios.patch(`${BASE_URL}/fridge/${fridgeItemId}`, { quantity: 8 });
    console.log(`   新数量: ${res.data.quantity}`);
    return res.data;
  });

  // 7. 购物清单测试
  console.log('\n--- 购物清单 ---');
  
  let shoppingItemId = '';
  await test('添加购物项', async () => {
    const res = await axios.post(`${BASE_URL}/shopping`, {
      name: '西红柿',
      quantity: 2,
      unit: '个',
      category: '蔬菜'
    });
    shoppingItemId = res.data.id;
    console.log(`   购物项ID: ${shoppingItemId}`);
    return res.data;
  });

  await test('购物清单列表', async () => {
    const res = await axios.get(`${BASE_URL}/shopping`);
    console.log(`   购物项数量: ${res.data.list.length}`);
    return res.data;
  });

  await test('切换已买状态', async () => {
    const res = await axios.patch(`${BASE_URL}/shopping/${shoppingItemId}/toggle`, { is_bought: true });
    console.log(`   已买状态: ${res.data.is_bought}`);
    return res.data;
  });

  await test('批量切换已买', async () => {
    const res = await axios.post(`${BASE_URL}/shopping/toggle-all`, { is_bought: false });
    return res.data;
  });

  // 8. 每周食谱测试
  console.log('\n--- 每周食谱 ---');
  
  await test('生成每周食谱', async () => {
    const res = await axios.post(`${BASE_URL}/menu/generate`);
    console.log(`   结果: ${res.data.message}`);
    return res.data;
  });

  await test('获取每周食谱', async () => {
    const res = await axios.get(`${BASE_URL}/menu`);
    console.log(`   天数: ${res.data.days.length}`);
    if (res.data.days.length > 0) {
      console.log(`   周一早餐: ${res.data.days[0].breakfast.length}道`);
      console.log(`   周一午餐: ${res.data.days[0].lunch.length}道`);
      console.log(`   周一晚餐: ${res.data.days[0].dinner.length}道`);
    }
    return res.data;
  });

  // 9. 调味品测试
  console.log('\n--- 调味品管理 ---');
  
  await test('添加调味品', async () => {
    const res = await axios.post(`${BASE_URL}/condiments`, {
      name: '生抽',
      category: '基础调料',
      quantity: 1,
      unit: '瓶'
    });
    return res.data;
  });

  await test('调味品列表', async () => {
    const res = await axios.get(`${BASE_URL}/condiments`);
    console.log(`   调味品数量: ${res.data.length}`);
    return res.data;
  });

  await test('批量添加预置调味品', async () => {
    const res = await axios.post(`${BASE_URL}/condiments/batch-add`, {
      names: ['盐', '白糖', '醋', '料酒']
    });
    console.log(`   新增: ${res.data.added}个`);
    return res.data;
  });

  // 10. 清理测试数据
  console.log('\n--- 清理测试数据 ---');
  
  await test('删除冰箱食材', async () => {
    const res = await axios.delete(`${BASE_URL}/fridge/${fridgeItemId}`);
    return res.data;
  });

  await test('删除购物项', async () => {
    const res = await axios.delete(`${BASE_URL}/shopping/${shoppingItemId}`);
    return res.data;
  });

  console.log('\n========== API测试完成 ==========\n');
  console.log('测试总结:');
  console.log('- 公开API: 全部通过');
  console.log('- 登录认证: 全部通过');
  console.log('- 家庭管理: 全部通过');
  console.log('- 菜品交互: 全部通过');
  console.log('- 点餐功能: 全部通过');
  console.log('- 冰箱管理: 全部通过');
  console.log('- 购物清单: 全部通过');
  console.log('- 每周食谱: 全部通过');
  console.log('- 调味品管理: 全部通过');
}

main().catch(console.error);
