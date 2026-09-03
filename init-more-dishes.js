const db = require('./database');
const crypto = require('crypto');

// 补充菜品数据（30道）
const moreDishes = [
  // 河南菜
  {
    name: '河南烩面',
    category: '主食',
    cuisine: '豫菜',
    cookware: JSON.stringify(['炒菜锅']),
    spiciness: 1,
    healthiness: 3,
    cook_time: 40,
    difficulty: 2,
    ingredients: JSON.stringify([
      { name: '面粉', amount: 300, unit: 'g', type: 'main' },
      { name: '羊肉', amount: 200, unit: 'g', type: 'main' },
      { name: '海带丝', amount: 50, unit: 'g', type: 'side' },
      { name: '豆腐丝', amount: 50, unit: 'g', type: 'side' },
      { name: '香菜', amount: 20, unit: 'g', type: 'side' },
      { name: '盐', amount: 1, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '面粉加水和成面团，醒发30分钟',
      '羊肉切片，用料酒盐腌制',
      '锅中放水烧开，羊肉下锅煮熟',
      '面团擀成大片，切成宽条',
      '面条下锅煮熟',
      '加海带丝豆腐丝',
      '加盐调味，撒香菜出锅'
    ]),
    tips: JSON.stringify(['面要醒到位', '羊肉要新鲜']),
    description: '河南经典面食，汤鲜面筋',
    tags: JSON.stringify(['主食', '河南菜', '汤面']),
    kiss_level: 4,
    is_lazy: 0
  },
  {
    name: '胡辣汤',
    category: '汤品',
    cuisine: '豫菜',
    cookware: JSON.stringify(['炒菜锅']),
    spiciness: 3,
    healthiness: 3,
    cook_time: 30,
    difficulty: 2,
    ingredients: JSON.stringify([
      { name: '牛肉', amount: 100, unit: 'g', type: 'main' },
      { name: '面筋', amount: 100, unit: 'g', type: 'main' },
      { name: '黄花菜', amount: 30, unit: 'g', type: 'side' },
      { name: '木耳', amount: 30, unit: 'g', type: 'side' },
      { name: '胡椒粉', amount: 1, unit: '勺', type: 'seasoning' },
      { name: '淀粉', amount: 2, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '牛肉切丁，面筋切小块',
      '黄花菜木耳泡发',
      '锅中放水烧开，下牛肉丁',
      '加面筋黄花菜木耳',
      '煮10分钟',
      '水淀粉勾芡',
      '加胡椒粉盐调味',
      '滴香油出锅'
    ]),
    tips: JSON.stringify(['胡椒粉要多放', '勾芡要浓稠']),
    description: '河南特色早餐，香辣开胃',
    tags: JSON.stringify(['汤品', '河南菜', '早餐']),
    kiss_level: 3,
    is_lazy: 0
  },
  // 湖南菜
  {
    name: '剁椒鱼头',
    category: '热菜',
    cuisine: '湘菜',
    cookware: JSON.stringify(['电饭锅']),
    spiciness: 4,
    healthiness: 4,
    cook_time: 25,
    difficulty: 2,
    ingredients: JSON.stringify([
      { name: '胖头鱼头', amount: 1, unit: '个', type: 'main' },
      { name: '剁椒', amount: 100, unit: 'g', type: 'seasoning' },
      { name: '姜', amount: 5, unit: '片', type: 'seasoning' },
      { name: '蒜', amount: 5, unit: '瓣', type: 'seasoning' },
      { name: '葱', amount: 2, unit: '根', type: 'seasoning' },
      { name: '蒸鱼豉油', amount: 2, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '鱼头处理干净，两面划刀',
      '用料酒盐腌制10分钟',
      '盘底铺姜片葱段',
      '鱼头放上，铺满剁椒',
      '水开后上锅蒸15分钟',
      '倒掉蒸出的水',
      '淋蒸鱼豉油，撒葱花',
      '淋热油'
    ]),
    tips: JSON.stringify(['鱼头要新鲜', '剁椒要铺匀']),
    description: '湘菜经典，香辣鲜嫩',
    tags: JSON.stringify(['湘菜', '辣味', '硬菜']),
    kiss_level: 5,
    is_lazy: 0
  },
  {
    name: '小炒黄牛肉',
    category: '热菜',
    cuisine: '湘菜',
    cookware: JSON.stringify(['炒菜锅']),
    spiciness: 4,
    healthiness: 4,
    cook_time: 15,
    difficulty: 2,
    ingredients: JSON.stringify([
      { name: '黄牛肉', amount: 300, unit: 'g', type: 'main' },
      { name: '小米辣', amount: 50, unit: 'g', type: 'side' },
      { name: '青辣椒', amount: 100, unit: 'g', type: 'side' },
      { name: '蒜', amount: 5, unit: '瓣', type: 'seasoning' },
      { name: '生抽', amount: 2, unit: '勺', type: 'seasoning' },
      { name: '蚝油', amount: 1, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '牛肉切薄片，用生抽淀粉腌制',
      '小米辣青辣椒切圈',
      '蒜切末',
      '锅中放油，大火烧热',
      '牛肉下锅快速翻炒变色盛出',
      '锅中留底油，蒜末辣椒爆香',
      '倒回牛肉，加生抽蚝油',
      '大火翻炒均匀出锅'
    ]),
    tips: JSON.stringify(['牛肉要切薄', '大火快炒']),
    description: '湘菜招牌，香辣下饭',
    tags: JSON.stringify(['湘菜', '辣味', '下饭菜']),
    kiss_level: 5,
    is_lazy: 0
  },
  // 江西菜
  {
    name: '萍乡小炒肉',
    category: '热菜',
    cuisine: '赣菜',
    cookware: JSON.stringify(['炒菜锅']),
    spiciness: 5,
    healthiness: 3,
    cook_time: 15,
    difficulty: 1,
    ingredients: JSON.stringify([
      { name: '五花肉', amount: 200, unit: 'g', type: 'main' },
      { name: '瘦肉', amount: 100, unit: 'g', type: 'main' },
      { name: '青辣椒', amount: 200, unit: 'g', type: 'side' },
      { name: '红辣椒', amount: 100, unit: 'g', type: 'side' },
      { name: '蒜', amount: 5, unit: '瓣', type: 'seasoning' },
      { name: '生抽', amount: 2, unit: '勺', type: 'seasoning' },
      { name: '老抽', amount: 0.5, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '五花肉瘦肉切薄片',
      '青红辣椒切滚刀块',
      '蒜切末',
      '锅中放油，五花肉煸出油',
      '加瘦肉翻炒变色',
      '加蒜末爆香',
      '倒辣椒大火翻炒',
      '加生抽老抽盐调味',
      '翻炒均匀出锅'
    ]),
    tips: JSON.stringify(['辣椒要多', '大火快炒']),
    description: '江西名菜，鲜辣过瘾',
    tags: JSON.stringify(['赣菜', '辣味', '下饭菜']),
    kiss_level: 5,
    is_lazy: 0
  },
  {
    name: '三杯鸡',
    category: '热菜',
    cuisine: '赣菜',
    cookware: JSON.stringify(['高压锅', '炒菜锅']),
    spiciness: 0,
    healthiness: 3,
    cook_time: 40,
    difficulty: 2,
    ingredients: JSON.stringify([
      { name: '三黄鸡', amount: 1, unit: '只', type: 'main' },
      { name: '米酒', amount: 1, unit: '杯', type: 'seasoning' },
      { name: '生抽', amount: 1, unit: '杯', type: 'seasoning' },
      { name: '香油', amount: 1, unit: '杯', type: 'seasoning' },
      { name: '姜', amount: 5, unit: '片', type: 'seasoning' },
      { name: '蒜', amount: 10, unit: '瓣', type: 'seasoning' },
      { name: '九层塔', amount: 20, unit: 'g', type: 'side' }
    ]),
    steps: JSON.stringify([
      '鸡切块，焯水',
      '锅中放香油，姜片蒜瓣爆香',
      '倒入鸡块翻炒',
      '加米酒生抽',
      '大火烧开转小火炖30分钟',
      '大火收汁',
      '加九层塔翻炒出锅'
    ]),
    tips: JSON.stringify(['三杯比例要准', '收汁要到位']),
    description: '江西名菜，香浓入味',
    tags: JSON.stringify(['赣菜', '硬菜', '家常']),
    kiss_level: 5,
    is_lazy: 0
  },
  // 懒人菜
  {
    name: '电饭煲焖饭',
    category: '主食',
    cuisine: '家常',
    cookware: JSON.stringify(['电饭锅']),
    spiciness: 1,
    healthiness: 3,
    cook_time: 40,
    difficulty: 1,
    ingredients: JSON.stringify([
      { name: '大米', amount: 2, unit: '杯', type: 'main' },
      { name: '腊肠', amount: 100, unit: 'g', type: 'main' },
      { name: '胡萝卜', amount: 1, unit: '根', type: 'side' },
      { name: '土豆', amount: 1, unit: '个', type: 'side' },
      { name: '青豆', amount: 50, unit: 'g', type: 'side' },
      { name: '生抽', amount: 2, unit: '勺', type: 'seasoning' },
      { name: '蚝油', amount: 1, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '大米淘洗干净',
      '腊肠切片，胡萝卜土豆切丁',
      '所有食材放入电饭煲',
      '加正常煮饭的水量',
      '加生抽蚝油盐调味',
      '按下煮饭键',
      '煮好后拌匀即可'
    ]),
    tips: JSON.stringify(['水量要合适', '食材可以随意搭配']),
    description: '懒人必备，一锅出',
    tags: JSON.stringify(['主食', '懒人菜', '电饭锅']),
    kiss_level: 4,
    is_lazy: 1
  },
  {
    name: '葱油拌面',
    category: '主食',
    cuisine: '家常',
    cookware: JSON.stringify(['炒菜锅']),
    spiciness: 0,
    healthiness: 3,
    cook_time: 10,
    difficulty: 1,
    ingredients: JSON.stringify([
      { name: '面条', amount: 200, unit: 'g', type: 'main' },
      { name: '葱', amount: 3, unit: '根', type: 'side' },
      { name: '生抽', amount: 2, unit: '勺', type: 'seasoning' },
      { name: '老抽', amount: 0.5, unit: '勺', type: 'seasoning' },
      { name: '糖', amount: 0.5, unit: '勺', type: 'seasoning' },
      { name: '食用油', amount: 3, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '葱切段，葱白葱绿分开',
      '锅中放油，小火慢慢炸葱白',
      '葱白炸至金黄加葱绿',
      '炸至焦黄捞出',
      '锅中留葱油，加生抽老抽调汁',
      '面条煮熟捞出',
      '淋上葱油汁拌匀'
    ]),
    tips: JSON.stringify(['葱要炸透', '小火慢炸']),
    description: '简单快手，葱香浓郁',
    tags: JSON.stringify(['主食', '懒人菜', '快手菜']),
    kiss_level: 3,
    is_lazy: 1
  },
  // 空气炸锅菜
  {
    name: '空气炸锅烤红薯',
    category: '空气炸锅',
    cuisine: '家常',
    cookware: JSON.stringify(['空气炸锅']),
    spiciness: 0,
    healthiness: 5,
    cook_time: 35,
    difficulty: 1,
    ingredients: JSON.stringify([
      { name: '红薯', amount: 3, unit: '个', type: 'main' }
    ]),
    steps: JSON.stringify([
      '红薯洗净擦干',
      '空气炸锅200度预热5分钟',
      '红薯放入炸篮',
      '200度烤25分钟',
      '中途翻面一次',
      '烤至外皮焦皱即可'
    ]),
    tips: JSON.stringify(['红薯不要太大', '中途翻面']),
    description: '健康零食，香甜软糯',
    tags: JSON.stringify(['空气炸锅', '健康', '零食']),
    kiss_level: 3,
    is_lazy: 1
  },
  {
    name: '空气炸锅烤茄子',
    category: '空气炸锅',
    cuisine: '家常',
    cookware: JSON.stringify(['空气炸锅']),
    spiciness: 2,
    healthiness: 4,
    cook_time: 25,
    difficulty: 1,
    ingredients: JSON.stringify([
      { name: '茄子', amount: 2, unit: '根', type: 'main' },
      { name: '蒜', amount: 5, unit: '瓣', type: 'seasoning' },
      { name: '生抽', amount: 2, unit: '勺', type: 'seasoning' },
      { name: '蚝油', amount: 1, unit: '勺', type: 'seasoning' },
      { name: '辣椒油', amount: 1, unit: '勺', type: 'seasoning' },
      { name: '孜然粉', amount: 0.5, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '茄子对半切开，划几刀',
      '刷一层油',
      '空气炸锅180度烤15分钟',
      '蒜切末，加生抽蚝油辣椒油调汁',
      '茄子取出，铺上蒜蓉汁',
      '再烤5分钟',
      '撒孜然粉葱花'
    ]),
    tips: JSON.stringify(['茄子要选嫩的', '蒜蓉要多']),
    description: '烧烤风味，少油健康',
    tags: JSON.stringify(['空气炸锅', '素菜', '健康']),
    kiss_level: 4,
    is_lazy: 1
  },
  // 素菜
  {
    name: '干煸豆角',
    category: '素菜',
    cuisine: '川菜',
    cookware: JSON.stringify(['炒菜锅']),
    spiciness: 3,
    healthiness: 4,
    cook_time: 20,
    difficulty: 1,
    ingredients: JSON.stringify([
      { name: '四季豆', amount: 300, unit: 'g', type: 'main' },
      { name: '肉末', amount: 100, unit: 'g', type: 'main' },
      { name: '干辣椒', amount: 5, unit: '个', type: 'seasoning' },
      { name: '花椒', amount: 0.5, unit: '勺', type: 'seasoning' },
      { name: '蒜', amount: 3, unit: '瓣', type: 'seasoning' },
      { name: '生抽', amount: 1, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '豆角洗净掰段',
      '锅中放油，豆角炸至表皮起皱',
      '捞出沥油',
      '锅中留底油，肉末炒散',
      '加干辣椒花椒蒜末爆香',
      '倒回豆角翻炒',
      '加生抽盐调味'
    ]),
    tips: JSON.stringify(['豆角要炸透', '一定要做熟']),
    description: '川菜经典，干香麻辣',
    tags: JSON.stringify(['素菜', '川菜', '辣味']),
    kiss_level: 4,
    is_lazy: 0
  },
  {
    name: '蒜蓉西兰花',
    category: '素菜',
    cuisine: '家常',
    cookware: JSON.stringify(['炒菜锅']),
    spiciness: 0,
    healthiness: 5,
    cook_time: 10,
    difficulty: 1,
    ingredients: JSON.stringify([
      { name: '西兰花', amount: 1, unit: '颗', type: 'main' },
      { name: '蒜', amount: 5, unit: '瓣', type: 'seasoning' },
      { name: '盐', amount: 0.5, unit: '勺', type: 'seasoning' },
      { name: '生抽', amount: 1, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '西兰花掰小朵，盐水浸泡10分钟',
      '蒜切末',
      '锅中水烧开，西兰花焯水1分钟',
      '捞出过凉水',
      '锅中放油，蒜末爆香',
      '倒西兰花翻炒',
      '加盐生抽调味'
    ]),
    tips: JSON.stringify(['焯水时间不要太长', '保持翠绿']),
    description: '健康营养，清爽可口',
    tags: JSON.stringify(['素菜', '健康', '快手菜']),
    kiss_level: 2,
    is_lazy: 1
  },
  // 汤品
  {
    name: '冬瓜排骨汤',
    category: '汤品',
    cuisine: '家常',
    cookware: JSON.stringify(['高压锅']),
    spiciness: 0,
    healthiness: 5,
    cook_time: 50,
    difficulty: 1,
    ingredients: JSON.stringify([
      { name: '排骨', amount: 300, unit: 'g', type: 'main' },
      { name: '冬瓜', amount: 300, unit: 'g', type: 'side' },
      { name: '姜', amount: 3, unit: '片', type: 'seasoning' },
      { name: '葱', amount: 1, unit: '根', type: 'seasoning' },
      { name: '盐', amount: 1, unit: '勺', type: 'seasoning' },
      { name: '料酒', amount: 1, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '排骨冷水下锅焯水',
      '捞出洗净',
      '冬瓜去皮切厚片',
      '高压锅中放排骨姜片料酒',
      '加水没过排骨',
      '上汽后压20分钟',
      '放气后加冬瓜',
      '再压5分钟',
      '加盐调味，撒葱花'
    ]),
    tips: JSON.stringify(['排骨要焯水', '冬瓜后放']),
    description: '清热解暑，营养丰富',
    tags: JSON.stringify(['汤品', '健康', '高压锅']),
    kiss_level: 3,
    is_lazy: 0
  },
  {
    name: '玉米胡萝卜排骨汤',
    category: '汤品',
    cuisine: '家常',
    cookware: JSON.stringify(['高压锅']),
    spiciness: 0,
    healthiness: 5,
    cook_time: 50,
    difficulty: 1,
    ingredients: JSON.stringify([
      { name: '排骨', amount: 300, unit: 'g', type: 'main' },
      { name: '玉米', amount: 1, unit: '根', type: 'side' },
      { name: '胡萝卜', amount: 1, unit: '根', type: 'side' },
      { name: '姜', amount: 3, unit: '片', type: 'seasoning' },
      { name: '盐', amount: 1, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '排骨冷水下锅焯水',
      '玉米切段，胡萝卜切滚刀块',
      '高压锅中放排骨姜片',
      '加水没过排骨',
      '上汽后压15分钟',
      '放气后加玉米胡萝卜',
      '再压10分钟',
      '加盐调味'
    ]),
    tips: JSON.stringify(['玉米要甜玉米', '胡萝卜不要切太小']),
    description: '甜香浓郁，营养均衡',
    tags: JSON.stringify(['汤品', '健康', '高压锅']),
    kiss_level: 4,
    is_lazy: 0
  },
  // 凉菜
  {
    name: '口水鸡',
    category: '凉菜',
    cuisine: '川菜',
    cookware: JSON.stringify(['炒菜锅']),
    spiciness: 4,
    healthiness: 3,
    cook_time: 30,
    difficulty: 2,
    ingredients: JSON.stringify([
      { name: '三黄鸡', amount: 0.5, unit: '只', type: 'main' },
      { name: '花生碎', amount: 30, unit: 'g', type: 'side' },
      { name: '葱', amount: 2, unit: '根', type: 'side' },
      { name: '蒜', amount: 5, unit: '瓣', type: 'seasoning' },
      { name: '辣椒油', amount: 3, unit: '勺', type: 'seasoning' },
      { name: '花椒油', amount: 1, unit: '勺', type: 'seasoning' },
      { name: '生抽', amount: 2, unit: '勺', type: 'seasoning' },
      { name: '醋', amount: 1, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '鸡处理干净，水中加姜片料酒',
      '水开后煮15分钟',
      '捞出过冰水',
      '斩块装盘',
      '蒜切末，葱切葱花',
      '生抽醋辣椒油花椒油调汁',
      '淋在鸡块上',
      '撒花生碎葱花'
    ]),
    tips: JSON.stringify(['煮好后过冰水皮更脆', '料汁要够味']),
    description: '川菜经典，麻辣鲜香',
    tags: JSON.stringify(['凉菜', '川菜', '辣味']),
    kiss_level: 5,
    is_lazy: 0
  },
  {
    name: '皮蛋豆腐',
    category: '凉菜',
    cuisine: '家常',
    cookware: JSON.stringify(['无需烹饪']),
    spiciness: 1,
    healthiness: 4,
    cook_time: 5,
    difficulty: 1,
    ingredients: JSON.stringify([
      { name: '内酯豆腐', amount: 1, unit: '盒', type: 'main' },
      { name: '皮蛋', amount: 2, unit: '个', type: 'main' },
      { name: '葱', amount: 1, unit: '根', type: 'side' },
      { name: '蒜', amount: 3, unit: '瓣', type: 'seasoning' },
      { name: '生抽', amount: 2, unit: '勺', type: 'seasoning' },
      { name: '醋', amount: 1, unit: '勺', type: 'seasoning' },
      { name: '香油', amount: 0.5, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '豆腐倒扣在盘中',
      '皮蛋切小块铺在豆腐上',
      '蒜切末，葱切葱花',
      '生抽醋香油调汁',
      '淋在豆腐上',
      '撒蒜末葱花'
    ]),
    tips: JSON.stringify(['豆腐要新鲜', '皮蛋不要太多']),
    description: '清爽开胃，简单快手',
    tags: JSON.stringify(['凉菜', '快手菜', '健康']),
    kiss_level: 3,
    is_lazy: 1
  },
  // 更多热菜
  {
    name: '鱼香肉丝',
    category: '热菜',
    cuisine: '川菜',
    cookware: JSON.stringify(['炒菜锅']),
    spiciness: 3,
    healthiness: 3,
    cook_time: 20,
    difficulty: 2,
    ingredients: JSON.stringify([
      { name: '猪里脊', amount: 200, unit: 'g', type: 'main' },
      { name: '木耳', amount: 50, unit: 'g', type: 'side' },
      { name: '胡萝卜', amount: 0.5, unit: '根', type: 'side' },
      { name: '青椒', amount: 0.5, unit: '个', type: 'side' },
      { name: '泡椒', amount: 30, unit: 'g', type: 'seasoning' },
      { name: '蒜', amount: 3, unit: '瓣', type: 'seasoning' },
      { name: '生抽', amount: 2, unit: '勺', type: 'seasoning' },
      { name: '醋', amount: 2, unit: '勺', type: 'seasoning' },
      { name: '糖', amount: 2, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '肉切丝，用生抽淀粉腌制',
      '木耳胡萝卜青椒切丝',
      '泡椒剁碎，蒜切末',
      '调鱼香汁：生抽醋糖淀粉水',
      '锅中放油，肉丝炒散盛出',
      '锅中留底油，泡椒蒜末爆香',
      '加蔬菜丝翻炒',
      '倒回肉丝',
      '淋鱼香汁翻炒均匀'
    ]),
    tips: JSON.stringify(['鱼香汁比例要准', '泡椒是灵魂']),
    description: '川菜经典，鱼香味浓',
    tags: JSON.stringify(['川菜', '下饭菜', '家常']),
    kiss_level: 4,
    is_lazy: 0
  },
  {
    name: '宫保鸡丁',
    category: '热菜',
    cuisine: '川菜',
    cookware: JSON.stringify(['炒菜锅']),
    spiciness: 3,
    healthiness: 3,
    cook_time: 20,
    difficulty: 2,
    ingredients: JSON.stringify([
      { name: '鸡胸肉', amount: 300, unit: 'g', type: 'main' },
      { name: '花生米', amount: 50, unit: 'g', type: 'side' },
      { name: '干辣椒', amount: 10, unit: '个', type: 'seasoning' },
      { name: '花椒', amount: 1, unit: '勺', type: 'seasoning' },
      { name: '葱', amount: 2, unit: '根', type: 'seasoning' },
      { name: '蒜', amount: 3, unit: '瓣', type: 'seasoning' },
      { name: '生抽', amount: 2, unit: '勺', type: 'seasoning' },
      { name: '醋', amount: 1, unit: '勺', type: 'seasoning' },
      { name: '糖', amount: 1, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '鸡肉切丁，用生抽淀粉腌制',
      '花生米炸熟',
      '干辣椒剪段，葱切段，蒜切片',
      '调汁：生抽醋糖淀粉水',
      '锅中放油，干辣椒花椒爆香',
      '下鸡丁翻炒变色',
      '加葱蒜翻炒',
      '淋调好的汁',
      '加花生米翻炒均匀'
    ]),
    tips: JSON.stringify(['花生最后放才脆', '火要大']),
    description: '川菜经典，麻辣鲜香',
    tags: JSON.stringify(['川菜', '下饭菜', '家常']),
    kiss_level: 5,
    is_lazy: 0
  },
  {
    name: '孜然羊肉',
    category: '热菜',
    cuisine: '西北',
    cookware: JSON.stringify(['炒菜锅']),
    spiciness: 2,
    healthiness: 3,
    cook_time: 15,
    difficulty: 2,
    ingredients: JSON.stringify([
      { name: '羊肉', amount: 300, unit: 'g', type: 'main' },
      { name: '洋葱', amount: 0.5, unit: '个', type: 'side' },
      { name: '香菜', amount: 20, unit: 'g', type: 'side' },
      { name: '孜然粉', amount: 2, unit: '勺', type: 'seasoning' },
      { name: '辣椒粉', amount: 1, unit: '勺', type: 'seasoning' },
      { name: '生抽', amount: 1, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '羊肉切薄片',
      '洋葱切丝，香菜切段',
      '锅中放油，大火烧热',
      '羊肉下锅快速翻炒变色',
      '加洋葱翻炒',
      '加孜然粉辣椒粉',
      '加生抽盐调味',
      '撒香菜出锅'
    ]),
    tips: JSON.stringify(['羊肉要切薄', '大火快炒']),
    description: '西北风味，孜然香浓',
    tags: JSON.stringify(['西北菜', '硬菜', '下饭菜']),
    kiss_level: 5,
    is_lazy: 0
  },
  {
    name: '酸菜白肉',
    category: '热菜',
    cuisine: '东北菜',
    cookware: JSON.stringify(['高压锅']),
    spiciness: 0,
    healthiness: 3,
    cook_time: 40,
    difficulty: 1,
    ingredients: JSON.stringify([
      { name: '五花肉', amount: 300, unit: 'g', type: 'main' },
      { name: '酸菜', amount: 300, unit: 'g', type: 'main' },
      { name: '粉丝', amount: 50, unit: 'g', type: 'side' },
      { name: '姜', amount: 3, unit: '片', type: 'seasoning' },
      { name: '葱', amount: 1, unit: '根', type: 'seasoning' },
      { name: '盐', amount: 1, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '五花肉冷水下锅焯水',
      '捞出切厚片',
      '酸菜洗净切丝',
      '粉丝泡软',
      '锅中放油，姜片爆香',
      '五花肉翻炒出油',
      '加酸菜翻炒',
      '加水烧开',
      '倒入高压锅压15分钟',
      '加粉丝再煮5分钟',
      '加盐调味'
    ]),
    tips: JSON.stringify(['酸菜要洗一下', '五花肉要肥一点']),
    description: '东北经典，酸香开胃',
    tags: JSON.stringify(['东北菜', '硬菜', '汤菜']),
    kiss_level: 4,
    is_lazy: 0
  },
  {
    name: '蒜蓉粉丝蒸虾',
    category: '热菜',
    cuisine: '家常',
    cookware: JSON.stringify(['电饭锅']),
    spiciness: 1,
    healthiness: 5,
    cook_time: 20,
    difficulty: 2,
    ingredients: JSON.stringify([
      { name: '鲜虾', amount: 300, unit: 'g', type: 'main' },
      { name: '粉丝', amount: 50, unit: 'g', type: 'side' },
      { name: '蒜', amount: 10, unit: '瓣', type: 'seasoning' },
      { name: '生抽', amount: 2, unit: '勺', type: 'seasoning' },
      { name: '蚝油', amount: 1, unit: '勺', type: 'seasoning' },
      { name: '葱', amount: 1, unit: '根', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '虾剪去虾须，开背去虾线',
      '粉丝泡软铺盘底',
      '虾摆在粉丝上',
      '蒜切末，一半炸金黄',
      '生蒜和炸蒜混合，加生抽蚝油',
      '蒜蓉铺在虾上',
      '水开后上锅蒸8分钟',
      '撒葱花，淋热油'
    ]),
    tips: JSON.stringify(['蒜要多', '蒸的时间不要太长']),
    description: '鲜香入味，宴客好菜',
    tags: JSON.stringify(['海鲜', '健康', '宴客菜']),
    kiss_level: 5,
    is_lazy: 0
  },
  {
    name: '蚝油生菜',
    category: '素菜',
    cuisine: '家常',
    cookware: JSON.stringify(['炒菜锅']),
    spiciness: 0,
    healthiness: 5,
    cook_time: 8,
    difficulty: 1,
    ingredients: JSON.stringify([
      { name: '生菜', amount: 300, unit: 'g', type: 'main' },
      { name: '蒜', amount: 3, unit: '瓣', type: 'seasoning' },
      { name: '蚝油', amount: 2, unit: '勺', type: 'seasoning' },
      { name: '生抽', amount: 1, unit: '勺', type: 'seasoning' },
      { name: '淀粉', amount: 0.5, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '生菜洗净掰开',
      '蒜切末',
      '锅中水烧开，加少许油盐',
      '生菜焯水30秒捞出摆盘',
      '锅中放油，蒜末爆香',
      '加蚝油生抽',
      '加少许水烧开',
      '水淀粉勾芡',
      '淋在生菜上'
    ]),
    tips: JSON.stringify(['生菜不要焯太久', '蚝油是灵魂']),
    description: '清爽健康，简单快手',
    tags: JSON.stringify(['素菜', '健康', '快手菜']),
    kiss_level: 3,
    is_lazy: 1
  },
  {
    name: '酸辣汤',
    category: '汤品',
    cuisine: '川菜',
    cookware: JSON.stringify(['炒菜锅']),
    spiciness: 3,
    healthiness: 4,
    cook_time: 15,
    difficulty: 1,
    ingredients: JSON.stringify([
      { name: '豆腐', amount: 0.5, unit: '盒', type: 'main' },
      { name: '木耳', amount: 30, unit: 'g', type: 'side' },
      { name: '鸡蛋', amount: 1, unit: '个', type: 'main' },
      { name: '醋', amount: 3, unit: '勺', type: 'seasoning' },
      { name: '胡椒粉', amount: 1, unit: '勺', type: 'seasoning' },
      { name: '淀粉', amount: 2, unit: '勺', type: 'seasoning' },
      { name: '香油', amount: 0.5, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '豆腐切丝，木耳泡发切丝',
      '鸡蛋打散',
      '锅中放水烧开',
      '下豆腐丝木耳丝',
      '煮3分钟',
      '加盐醋胡椒粉',
      '水淀粉勾芡',
      '淋蛋液',
      '滴香油出锅'
    ]),
    tips: JSON.stringify(['醋和胡椒要够', '勾芡要浓稠']),
    description: '酸辣开胃，暖身汤品',
    tags: JSON.stringify(['汤品', '川菜', '辣味']),
    kiss_level: 3,
    is_lazy: 1
  },
  {
    name: '煎饺',
    category: '主食',
    cuisine: '家常',
    cookware: JSON.stringify(['炒菜锅']),
    spiciness: 0,
    healthiness: 3,
    cook_time: 20,
    difficulty: 2,
    ingredients: JSON.stringify([
      { name: '饺子皮', amount: 30, unit: '张', type: 'main' },
      { name: '猪肉馅', amount: 200, unit: 'g', type: 'main' },
      { name: '韭菜', amount: 100, unit: 'g', type: 'side' },
      { name: '鸡蛋', amount: 1, unit: '个', type: 'main' },
      { name: '生抽', amount: 1, unit: '勺', type: 'seasoning' },
      { name: '盐', amount: 0.5, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '韭菜切碎，鸡蛋炒散',
      '肉馅加生抽盐鸡蛋搅匀',
      '加韭菜拌匀',
      '饺子皮包馅捏紧',
      '锅中放油，饺子摆好',
      '小火煎至底部金黄',
      '加半碗水，盖盖焖',
      '水收干后再煎1分钟',
      '底部酥脆即可'
    ]),
    tips: JSON.stringify(['水要加够', '最后要煎脆']),
    description: '外酥里嫩，早餐首选',
    tags: JSON.stringify(['主食', '早餐', '家常']),
    kiss_level: 4,
    is_lazy: 0
  },
  {
    name: '皮蛋瘦肉粥',
    category: '主食',
    cuisine: '家常',
    cookware: JSON.stringify(['电饭锅']),
    spiciness: 0,
    healthiness: 4,
    cook_time: 60,
    difficulty: 1,
    ingredients: JSON.stringify([
      { name: '大米', amount: 1, unit: '杯', type: 'main' },
      { name: '皮蛋', amount: 2, unit: '个', type: 'main' },
      { name: '瘦肉', amount: 100, unit: 'g', type: 'main' },
      { name: '姜', amount: 3, unit: '片', type: 'seasoning' },
      { name: '葱', amount: 1, unit: '根', type: 'seasoning' },
      { name: '盐', amount: 1, unit: '勺', type: 'seasoning' },
      { name: '生抽', amount: 1, unit: '勺', type: 'seasoning' }
    ]),
    steps: JSON.stringify([
      '大米淘洗干净，加水浸泡30分钟',
      '瘦肉切丝，用生抽盐腌制',
      '皮蛋切小块',
      '大米放入电饭锅，加足量水',
      '按下煮粥键',
      '煮30分钟后加瘦肉丝',
      '加皮蛋姜片',
      '再煮20分钟',
      '加盐调味，撒葱花'
    ]),
    tips: JSON.stringify(['米要泡', '瘦肉后放才嫩']),
    description: '经典广式粥品，鲜香顺滑',
    tags: JSON.stringify(['主食', '早餐', '健康']),
    kiss_level: 4,
    is_lazy: 0
  }
];

// 导入补充菜品
let count = 0;
moreDishes.forEach(dish => {
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

console.log(`成功导入 ${count} 道补充菜品`);
console.log(`当前菜品总数: ${db.prepare('SELECT COUNT(*) as total FROM dishes').get().total}`);
