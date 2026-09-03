const db = require('./database');
const crypto = require('crypto');

// 常见菜品数据（30道）
const dishes = [
  {
    name: '辣椒炒肉',
    category: '热菜',
    cuisine: '湘菜',
    cookware: JSON.stringify(['炒菜锅']),
    spiciness: 3,
    healthiness: 3,
    cook_time: 20,
    difficulty: 1,
    ingredients: JSON.stringify([
      { name: '五花肉', amount: 200, unit: 'g', type: 'main' },
      { name: '青辣椒', amount: 150, unit: 'g', type: 'side' },
      { name: '蒜', amount: 3, unit: '瓣', type: 'seasoning' },
      { name: '生抽', amount: 1, unit: '勺', type: 'seasoning' },
      { name: '盐', amount: 0.5, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '五花肉切薄片，青辣椒切块',
      '锅中放油，五花肉煸炒出油',
      '加入蒜末爆香',
      '倒入青辣椒翻炒',
      '加生抽盐调味，翻炒均匀即可'
    ]),
    tips: JSON.stringify(['五花肉要煸出油才香', '辣椒不要炒太久']),
    description: '湘菜经典，下饭神器',
    tags: JSON.stringify(['下饭菜', '家常', '辣味']),
    kiss_level: 4,
    is_lazy: 0
  },
  {
    name: '番茄炒蛋',
    category: '热菜',
    cuisine: '家常',
    cookware: JSON.stringify(['炒菜锅']),
    spiciness: 0,
    healthiness: 4,
    cook_time: 10,
    difficulty: 1,
    ingredients: JSON.stringify([
      { name: '鸡蛋', amount: 3, unit: '个', type: 'main' },
      { name: '番茄', amount: 2, unit: '个', type: 'side' },
      { name: '葱', amount: 1, unit: '根', type: 'seasoning' },
      { name: '盐', amount: 0.5, unit: '勺', type: 'seasoning' },
      { name: '糖', amount: 0.5, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '鸡蛋打散，番茄切块',
      '锅中放油，倒入蛋液炒散盛出',
      '锅中再放油，番茄炒出汁',
      '倒入鸡蛋，加盐糖调味',
      '撒葱花出锅'
    ]),
    tips: JSON.stringify(['鸡蛋要嫩', '番茄要炒出汁']),
    description: '国民家常菜，酸甜可口',
    tags: JSON.stringify(['家常', '快手菜', '儿童爱吃']),
    kiss_level: 3,
    is_lazy: 1
  },
  {
    name: '红烧肉',
    category: '热菜',
    cuisine: '家常',
    cookware: JSON.stringify(['高压锅', '炒菜锅']),
    spiciness: 0,
    healthiness: 2,
    cook_time: 60,
    difficulty: 2,
    ingredients: JSON.stringify([
      { name: '五花肉', amount: 500, unit: 'g', type: 'main' },
      { name: '冰糖', amount: 30, unit: 'g', type: 'seasoning' },
      { name: '生抽', amount: 2, unit: '勺', type: 'seasoning' },
      { name: '老抽', amount: 1, unit: '勺', type: 'seasoning' },
      { name: '料酒', amount: 2, unit: '勺', type: 'seasoning' },
      { name: '八角', amount: 2, unit: '个', type: 'seasoning' },
      { name: '桂皮', amount: 1, unit: '小块', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '五花肉切方块，冷水下锅焯水',
      '锅中放冰糖，小火炒糖色',
      '倒入五花肉翻炒上色',
      '加生抽老抽料酒',
      '加热水没过肉，放八角桂皮',
      '大火烧开转小火炖40分钟',
      '大火收汁即可'
    ]),
    tips: JSON.stringify(['糖色要小火炒', '炖的时间要够']),
    description: '肥而不腻，入口即化',
    tags: JSON.stringify(['硬菜', '家常', '宴客菜']),
    kiss_level: 5,
    is_lazy: 0
  },
  {
    name: '蒜蓉空心菜',
    category: '素菜',
    cuisine: '家常',
    cookware: JSON.stringify(['炒菜锅']),
    spiciness: 0,
    healthiness: 5,
    cook_time: 8,
    difficulty: 1,
    ingredients: JSON.stringify([
      { name: '空心菜', amount: 300, unit: 'g', type: 'main' },
      { name: '蒜', amount: 5, unit: '瓣', type: 'seasoning' },
      { name: '盐', amount: 0.5, unit: '勺', type: 'seasoning' },
      { name: '生抽', amount: 1, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '空心菜洗净切段',
      '蒜切末',
      '锅中放油，蒜末爆香',
      '倒入空心菜大火翻炒',
      '加盐生抽调味，炒软即可'
    ]),
    tips: JSON.stringify(['大火快炒', '不要炒太久']),
    description: '清爽解腻，营养丰富',
    tags: JSON.stringify(['素菜', '快手菜', '健康']),
    kiss_level: 2,
    is_lazy: 1
  },
  {
    name: '可乐鸡翅',
    category: '热菜',
    cuisine: '家常',
    cookware: JSON.stringify(['炒菜锅']),
    spiciness: 0,
    healthiness: 3,
    cook_time: 30,
    difficulty: 1,
    ingredients: JSON.stringify([
      { name: '鸡翅中', amount: 500, unit: 'g', type: 'main' },
      { name: '可乐', amount: 1, unit: '罐', type: 'seasoning' },
      { name: '生抽', amount: 2, unit: '勺', type: 'seasoning' },
      { name: '老抽', amount: 0.5, unit: '勺', type: 'seasoning' },
      { name: '料酒', amount: 1, unit: '勺', type: 'seasoning' },
      { name: '姜', amount: 3, unit: '片', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '鸡翅两面划刀，冷水下锅焯水',
      '锅中放油，鸡翅煎至两面金黄',
      '加姜片料酒',
      '倒入可乐没过鸡翅',
      '加生抽老抽',
      '大火烧开转小火炖20分钟',
      '大火收汁'
    ]),
    tips: JSON.stringify(['可乐要没过鸡翅', '收汁要注意不要糊']),
    description: '甜香入味，小朋友最爱',
    tags: JSON.stringify(['家常', '硬菜', '儿童爱吃']),
    kiss_level: 4,
    is_lazy: 0
  },
  {
    name: '麻婆豆腐',
    category: '热菜',
    cuisine: '川菜',
    cookware: JSON.stringify(['炒菜锅']),
    spiciness: 4,
    healthiness: 3,
    cook_time: 15,
    difficulty: 1,
    ingredients: JSON.stringify([
      { name: '嫩豆腐', amount: 1, unit: '盒', type: 'main' },
      { name: '牛肉末', amount: 100, unit: 'g', type: 'main' },
      { name: '豆瓣酱', amount: 1, unit: '勺', type: 'seasoning' },
      { name: '花椒粉', amount: 0.5, unit: '勺', type: 'seasoning' },
      { name: '蒜', amount: 3, unit: '瓣', type: 'seasoning' },
      { name: '葱', amount: 1, unit: '根', type: 'seasoning' },
      { name: '淀粉', amount: 1, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '豆腐切小块，开水焯一下',
      '锅中放油，牛肉末炒散',
      '加豆瓣酱蒜末炒出红油',
      '加适量水，倒入豆腐',
      '小火炖5分钟',
      '水淀粉勾芡',
      '撒花椒粉葱花'
    ]),
    tips: JSON.stringify(['豆腐要焯水去豆腥', '花椒粉最后撒']),
    description: '麻辣鲜香，川菜经典',
    tags: JSON.stringify(['川菜', '辣味', '下饭菜']),
    kiss_level: 4,
    is_lazy: 0
  },
  {
    name: '凉拌黄瓜',
    category: '凉菜',
    cuisine: '家常',
    cookware: JSON.stringify(['无需烹饪']),
    spiciness: 2,
    healthiness: 5,
    cook_time: 5,
    difficulty: 1,
    ingredients: JSON.stringify([
      { name: '黄瓜', amount: 2, unit: '根', type: 'main' },
      { name: '蒜', amount: 3, unit: '瓣', type: 'seasoning' },
      { name: '醋', amount: 2, unit: '勺', type: 'seasoning' },
      { name: '生抽', amount: 1, unit: '勺', type: 'seasoning' },
      { name: '香油', amount: 0.5, unit: '勺', type: 'seasoning' },
      { name: '辣椒油', amount: 1, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '黄瓜拍碎切段',
      '蒜切末',
      '所有调料混合',
      '倒入黄瓜拌匀',
      '腌制10分钟更入味'
    ]),
    tips: JSON.stringify(['黄瓜要拍不要切', '腌制一下更好吃']),
    description: '清爽开胃，夏日必备',
    tags: JSON.stringify(['凉菜', '快手菜', '健康']),
    kiss_level: 2,
    is_lazy: 1
  },
  {
    name: '西红柿鸡蛋汤',
    category: '汤品',
    cuisine: '家常',
    cookware: JSON.stringify(['炒菜锅']),
    spiciness: 0,
    healthiness: 4,
    cook_time: 10,
    difficulty: 1,
    ingredients: JSON.stringify([
      { name: '番茄', amount: 2, unit: '个', type: 'main' },
      { name: '鸡蛋', amount: 2, unit: '个', type: 'main' },
      { name: '葱', amount: 1, unit: '根', type: 'seasoning' },
      { name: '盐', amount: 0.5, unit: '勺', type: 'seasoning' },
      { name: '香油', amount: 0.5, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '番茄切块，鸡蛋打散',
      '锅中放油，番茄炒出汁',
      '加适量水烧开',
      '倒入蛋液，不要搅拌',
      '加盐调味',
      '撒葱花，滴香油'
    ]),
    tips: JSON.stringify(['蛋液倒入后不要立即搅拌', '番茄要炒出汁']),
    description: '简单营养，家常靓汤',
    tags: JSON.stringify(['汤品', '快手菜', '健康']),
    kiss_level: 2,
    is_lazy: 1
  },
  {
    name: '空气炸锅烤鸡翅',
    category: '空气炸锅',
    cuisine: '家常',
    cookware: JSON.stringify(['空气炸锅']),
    spiciness: 1,
    healthiness: 3,
    cook_time: 25,
    difficulty: 1,
    ingredients: JSON.stringify([
      { name: '鸡翅中', amount: 500, unit: 'g', type: 'main' },
      { name: '生抽', amount: 2, unit: '勺', type: 'seasoning' },
      { name: '料酒', amount: 1, unit: '勺', type: 'seasoning' },
      { name: '蜂蜜', amount: 1, unit: '勺', type: 'seasoning' },
      { name: '黑胡椒', amount: 0.5, unit: '勺', type: 'seasoning' },
      { name: '蒜', amount: 3, unit: '瓣', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '鸡翅两面划刀',
      '所有调料混合，腌制鸡翅30分钟',
      '空气炸锅180度预热5分钟',
      '鸡翅放入炸篮',
      '180度烤15分钟',
      '翻面再烤5分钟'
    ]),
    tips: JSON.stringify(['腌制时间越长越入味', '中途翻面']),
    description: '外焦里嫩，少油健康',
    tags: JSON.stringify(['空气炸锅', '硬菜', '健康']),
    kiss_level: 4,
    is_lazy: 1
  },
  {
    name: '酸辣土豆丝',
    category: '素菜',
    cuisine: '家常',
    cookware: JSON.stringify(['炒菜锅']),
    spiciness: 2,
    healthiness: 4,
    cook_time: 10,
    difficulty: 1,
    ingredients: JSON.stringify([
      { name: '土豆', amount: 2, unit: '个', type: 'main' },
      { name: '青辣椒', amount: 1, unit: '个', type: 'side' },
      { name: '干辣椒', amount: 3, unit: '个', type: 'seasoning' },
      { name: '醋', amount: 2, unit: '勺', type: 'seasoning' },
      { name: '盐', amount: 0.5, unit: '勺', type: 'seasoning' },
      { name: '蒜', amount: 2, unit: '瓣', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '土豆切丝，泡水去淀粉',
      '青辣椒切丝，蒜切末',
      '锅中放油，干辣椒蒜末爆香',
      '倒入土豆丝大火翻炒',
      '加醋盐调味',
      '加青椒丝翻炒均匀'
    ]),
    tips: JSON.stringify(['土豆丝要泡水', '醋要早放']),
    description: '酸辣爽脆，下饭神器',
    tags: JSON.stringify(['素菜', '快手菜', '辣味']),
    kiss_level: 3,
    is_lazy: 1
  },
  {
    name: '水煮肉片',
    category: '热菜',
    cuisine: '川菜',
    cookware: JSON.stringify(['炒菜锅']),
    spiciness: 5,
    healthiness: 2,
    cook_time: 30,
    difficulty: 2,
    ingredients: JSON.stringify([
      { name: '猪里脊', amount: 300, unit: 'g', type: 'main' },
      { name: '豆芽', amount: 200, unit: 'g', type: 'side' },
      { name: '豆瓣酱', amount: 2, unit: '勺', type: 'seasoning' },
      { name: '干辣椒', amount: 10, unit: '个', type: 'seasoning' },
      { name: '花椒', amount: 1, unit: '勺', type: 'seasoning' },
      { name: '蒜', amount: 5, unit: '瓣', type: 'seasoning' },
      { name: '淀粉', amount: 1, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '肉片用淀粉料酒盐腌制15分钟',
      '豆芽焯水铺碗底',
      '锅中放油，豆瓣酱炒出红油',
      '加水烧开，下肉片',
      '肉片变色后连汤倒入碗中',
      '上面撒蒜末干辣椒花椒',
      '淋上热油'
    ]),
    tips: JSON.stringify(['肉片要嫩', '最后淋油要热']),
    description: '麻辣鲜香，川菜代表',
    tags: JSON.stringify(['川菜', '辣味', '硬菜']),
    kiss_level: 5,
    is_lazy: 0
  },
  {
    name: '蛋炒饭',
    category: '主食',
    cuisine: '家常',
    cookware: JSON.stringify(['炒菜锅']),
    spiciness: 0,
    healthiness: 3,
    cook_time: 10,
    difficulty: 1,
    ingredients: JSON.stringify([
      { name: '米饭', amount: 2, unit: '碗', type: 'main' },
      { name: '鸡蛋', amount: 2, unit: '个', type: 'main' },
      { name: '葱', amount: 1, unit: '根', type: 'seasoning' },
      { name: '盐', amount: 0.5, unit: '勺', type: 'seasoning' },
      { name: '生抽', amount: 0.5, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '鸡蛋打散，葱切葱花',
      '锅中放油，倒入蛋液炒散',
      '倒入米饭翻炒均匀',
      '加盐生抽调味',
      '撒葱花出锅'
    ]),
    tips: JSON.stringify(['用隔夜饭最好', '大火快炒']),
    description: '简单快手，一人食首选',
    tags: JSON.stringify(['主食', '快手菜', '一人食']),
    kiss_level: 2,
    is_lazy: 1
  },
  {
    name: '苦瓜炒肉',
    category: '热菜',
    cuisine: '家常',
    cookware: JSON.stringify(['炒菜锅']),
    spiciness: 1,
    healthiness: 5,
    cook_time: 15,
    difficulty: 1,
    ingredients: JSON.stringify([
      { name: '苦瓜', amount: 1, unit: '根', type: 'main' },
      { name: '猪肉', amount: 150, unit: 'g', type: 'main' },
      { name: '蒜', amount: 3, unit: '瓣', type: 'seasoning' },
      { name: '生抽', amount: 1, unit: '勺', type: 'seasoning' },
      { name: '盐', amount: 0.5, unit: '勺', type: 'seasoning' },
      { name: '糖', amount: 0.5, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '苦瓜切片，用盐腌一下去苦味',
      '猪肉切片，用生抽淀粉腌制',
      '锅中放油，肉片炒散盛出',
      '锅中再放油，蒜末爆香',
      '倒入苦瓜翻炒',
      '加肉片，加盐糖生抽调味'
    ]),
    tips: JSON.stringify(['苦瓜用盐腌一下去苦味', '肉片要嫩']),
    description: '清热降火，健康营养',
    tags: JSON.stringify(['素菜', '健康', '下饭菜']),
    kiss_level: 3,
    is_lazy: 0
  },
  {
    name: '清蒸鲈鱼',
    category: '热菜',
    cuisine: '家常',
    cookware: JSON.stringify(['电饭锅']),
    spiciness: 0,
    healthiness: 5,
    cook_time: 20,
    difficulty: 1,
    ingredients: JSON.stringify([
      { name: '鲈鱼', amount: 1, unit: '条', type: 'main' },
      { name: '葱', amount: 2, unit: '根', type: 'seasoning' },
      { name: '姜', amount: 5, unit: '片', type: 'seasoning' },
      { name: '蒸鱼豉油', amount: 2, unit: '勺', type: 'seasoning' },
      { name: '料酒', amount: 1, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '鲈鱼处理干净，两面划刀',
      '鱼身抹料酒盐，放姜片',
      '水开后上锅蒸8分钟',
      '倒掉蒸出的水',
      '放葱丝，淋蒸鱼豉油',
      '淋上热油'
    ]),
    tips: JSON.stringify(['蒸的时间不要太长', '最后淋热油']),
    description: '鲜嫩可口，营养丰富',
    tags: JSON.stringify(['海鲜', '健康', '宴客菜']),
    kiss_level: 4,
    is_lazy: 0
  },
  {
    name: '地三鲜',
    category: '素菜',
    cuisine: '东北菜',
    cookware: JSON.stringify(['炒菜锅']),
    spiciness: 0,
    healthiness: 3,
    cook_time: 20,
    difficulty: 1,
    ingredients: JSON.stringify([
      { name: '茄子', amount: 1, unit: '个', type: 'main' },
      { name: '土豆', amount: 1, unit: '个', type: 'main' },
      { name: '青椒', amount: 1, unit: '个', type: 'main' },
      { name: '蒜', amount: 3, unit: '瓣', type: 'seasoning' },
      { name: '生抽', amount: 1, unit: '勺', type: 'seasoning' },
      { name: '盐', amount: 0.5, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '茄子土豆切滚刀块，青椒切块',
      '锅中放油，土豆炸至金黄',
      '茄子炸软',
      '锅中留底油，蒜末爆香',
      '倒入所有食材翻炒',
      '加生抽盐调味，水淀粉勾芡'
    ]),
    tips: JSON.stringify(['茄子要炸软', '最后勾芡']),
    description: '东北经典，素菜也能很下饭',
    tags: JSON.stringify(['素菜', '东北菜', '下饭菜']),
    kiss_level: 3,
    is_lazy: 0
  },
  {
    name: '紫菜蛋花汤',
    category: '汤品',
    cuisine: '家常',
    cookware: JSON.stringify(['炒菜锅']),
    spiciness: 0,
    healthiness: 4,
    cook_time: 5,
    difficulty: 1,
    ingredients: JSON.stringify([
      { name: '紫菜', amount: 1, unit: '片', type: 'main' },
      { name: '鸡蛋', amount: 1, unit: '个', type: 'main' },
      { name: '虾皮', amount: 1, unit: '勺', type: 'seasoning' },
      { name: '葱', amount: 1, unit: '根', type: 'seasoning' },
      { name: '盐', amount: 0.5, unit: '勺', type: 'seasoning' },
      { name: '香油', amount: 0.5, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '紫菜撕碎放碗中',
      '鸡蛋打散',
      '锅中水烧开',
      '倒入蛋液，不要搅拌',
      '加盐虾皮调味',
      '倒入放紫菜的碗中',
      '撒葱花，滴香油'
    ]),
    tips: JSON.stringify(['蛋液倒入后不要搅拌', '紫菜最后放']),
    description: '简单快手，营养丰富',
    tags: JSON.stringify(['汤品', '快手菜', '健康']),
    kiss_level: 2,
    is_lazy: 1
  },
  {
    name: '黄焖鸡',
    category: '热菜',
    cuisine: '家常',
    cookware: JSON.stringify(['高压锅', '炒菜锅']),
    spiciness: 2,
    healthiness: 3,
    cook_time: 40,
    difficulty: 2,
    ingredients: JSON.stringify([
      { name: '鸡腿肉', amount: 500, unit: 'g', type: 'main' },
      { name: '香菇', amount: 100, unit: 'g', type: 'side' },
      { name: '青椒', amount: 1, unit: '个', type: 'side' },
      { name: '姜', amount: 3, unit: '片', type: 'seasoning' },
      { name: '蒜', amount: 3, unit: '瓣', type: 'seasoning' },
      { name: '生抽', amount: 2, unit: '勺', type: 'seasoning' },
      { name: '老抽', amount: 0.5, unit: '勺', type: 'seasoning' },
      { name: '豆瓣酱', amount: 1, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '鸡腿肉切块，焯水',
      '香菇切块，青椒切块',
      '锅中放油，姜片蒜瓣爆香',
      '加豆瓣酱炒出红油',
      '倒入鸡肉翻炒上色',
      '加生抽老抽',
      '加热水没过鸡肉，放香菇',
      '大火烧开转小火炖20分钟',
      '加青椒，大火收汁'
    ]),
    tips: JSON.stringify(['鸡肉要焯水', '最后加青椒']),
    description: '酱香浓郁，米饭杀手',
    tags: JSON.stringify(['硬菜', '下饭菜', '家常']),
    kiss_level: 5,
    is_lazy: 0
  },
  {
    name: '白灼虾',
    category: '热菜',
    cuisine: '海鲜',
    cookware: JSON.stringify(['炒菜锅']),
    spiciness: 0,
    healthiness: 5,
    cook_time: 10,
    difficulty: 1,
    ingredients: JSON.stringify([
      { name: '鲜虾', amount: 500, unit: 'g', type: 'main' },
      { name: '姜', amount: 3, unit: '片', type: 'seasoning' },
      { name: '葱', amount: 2, unit: '根', type: 'seasoning' },
      { name: '料酒', amount: 1, unit: '勺', type: 'seasoning' },
      { name: '生抽', amount: 2, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '虾剪去虾须，挑去虾线',
      '锅中水烧开，放姜片葱段料酒',
      '倒入虾，煮2-3分钟',
      '虾变红弯曲即可捞出',
      '蘸料：生抽加姜末'
    ]),
    tips: JSON.stringify(['煮的时间不要太长', '挑去虾线']),
    description: '鲜嫩清甜，原汁原味',
    tags: JSON.stringify(['海鲜', '健康', '宴客菜']),
    kiss_level: 4,
    is_lazy: 1
  },
  {
    name: '炒时蔬',
    category: '素菜',
    cuisine: '家常',
    cookware: JSON.stringify(['炒菜锅']),
    spiciness: 0,
    healthiness: 5,
    cook_time: 8,
    difficulty: 1,
    ingredients: JSON.stringify([
      { name: '时令蔬菜', amount: 300, unit: 'g', type: 'main' },
      { name: '蒜', amount: 3, unit: '瓣', type: 'seasoning' },
      { name: '盐', amount: 0.5, unit: '勺', type: 'seasoning' },
      { name: '生抽', amount: 1, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '蔬菜洗净切段',
      '蒜切末',
      '锅中放油，蒜末爆香',
      '倒入蔬菜大火翻炒',
      '加盐生抽调味，炒软即可'
    ]),
    tips: JSON.stringify(['大火快炒', '不要炒太久']),
    description: '清爽健康，营养均衡',
    tags: JSON.stringify(['素菜', '快手菜', '健康']),
    kiss_level: 2,
    is_lazy: 1
  },
  {
    name: '糖醋排骨',
    category: '热菜',
    cuisine: '家常',
    cookware: JSON.stringify(['炒菜锅']),
    spiciness: 0,
    healthiness: 2,
    cook_time: 40,
    difficulty: 2,
    ingredients: JSON.stringify([
      { name: '排骨', amount: 500, unit: 'g', type: 'main' },
      { name: '冰糖', amount: 30, unit: 'g', type: 'seasoning' },
      { name: '醋', amount: 3, unit: '勺', type: 'seasoning' },
      { name: '生抽', amount: 2, unit: '勺', type: 'seasoning' },
      { name: '料酒', amount: 1, unit: '勺', type: 'seasoning' },
      { name: '姜', amount: 3, unit: '片', type: 'seasoning' },
      { name: '芝麻', amount: 1, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '排骨冷水下锅焯水',
      '锅中放冰糖，小火炒糖色',
      '倒入排骨翻炒上色',
      '加姜片料酒生抽',
      '加热水没过排骨',
      '大火烧开转小火炖30分钟',
      '加醋，大火收汁',
      '撒芝麻'
    ]),
    tips: JSON.stringify(['糖色要小火炒', '醋最后放']),
    description: '酸甜可口，老少皆宜',
    tags: JSON.stringify(['硬菜', '家常', '儿童爱吃']),
    kiss_level: 5,
    is_lazy: 0
  }
];

// 导入菜品
let count = 0;
dishes.forEach(dish => {
  const existing = db.prepare('SELECT * FROM dishes WHERE name = ?').get(dish.name);
  if (!existing) {
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO dishes (id, name, image_url, category, cuisine, cookware, spiciness, healthiness, cook_time, difficulty, ingredients, steps, tips, description, tags, kiss_level, is_lazy, is_custom)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      id,
      dish.name,
      '',
      dish.category,
      dish.cuisine,
      dish.cookware,
      dish.spiciness,
      dish.healthiness,
      dish.cook_time,
      dish.difficulty,
      dish.ingredients,
      dish.steps,
      dish.tips,
      dish.description,
      dish.tags,
      dish.kiss_level,
      dish.is_lazy
    );
    count++;
  }
});

console.log(`成功导入 ${count} 道菜品`);
console.log(`当前菜品总数: ${db.prepare('SELECT COUNT(*) as total FROM dishes').get().total}`);
