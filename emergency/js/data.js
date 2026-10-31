/* =========================================================================
   临界 · 紧急调度 — 游戏数据（数值、警情、单位、班次、升级、文案）
   说明：全部内容为原创虚构，织雾市与所有警情均为游戏设定，不构成真实救援指导。
   回退办法：删除 emergency/ 目录或 revert 对应提交即可；本文件不读写任何外部数据。
   ========================================================================= */
(function (root) {
  'use strict';
  var EM = root.EM = root.EM || {};

  var D = EM.data = {};
  D.VERSION = '2.2.0';
  D.TITLE = '临界 · 紧急调度';
  D.SETTINGS_KEY = 'emergency112.settings.v1';
  D.SAVE_KEY = 'emergency112.campaign.v1';
  D.STATS_KEY = 'emergency112.stats.v1';
  // 成就与排行榜也是本机存档；键名沿用旧前缀，避免升级时丢失已有记录
  D.ACH_KEY = 'emergency112.achievements.v1';
  D.BOARD_KEY = 'emergency112.leaderboard.v1';

  D.WORLD = { W: 140, H: 100, TILE: 32 };
  D.WORLD_NAME = '织雾市';
  D.MAX_PLAYERS = 4;

  /* ---------------- 区域 ---------------- */
  D.DISTRICTS = [
    { id: 'city', name: '中心城区', short: '城区', x: 3, y: 3, w: 64, h: 47, tone: '#2a3340', labelXY: { x: 0.5, y: 0.32 } },
    { id: 'industrial', name: '织雾工业区', short: '工业区', x: 72, y: 3, w: 65, h: 45, tone: '#33342f', labelXY: { x: 0.5, y: 0.35 } },
    { id: 'country', name: '稻香乡', short: '乡下', x: 3, y: 60, w: 56, h: 37, tone: '#27362b', labelXY: { x: 0.5, y: 0.45 } },
    { id: 'prison', name: '白岩监狱', short: '监狱', x: 62, y: 74, w: 21, h: 22, tone: '#2f3238', labelXY: { x: 0.5, y: 0.3 } },
    { id: 'airport', name: '织雾国际机场', short: '机场', x: 88, y: 58, w: 49, h: 39, tone: '#30343c', labelXY: { x: 0.5, y: 0.3 } }
  ];

  /* ---------------- 服务与能力 ---------------- */
  D.SERVICES = {
    police: { id: 'police', name: '警务', icon: '🚓', color: '#5aa9ff', short: '警' },
    fire: { id: 'fire', name: '消防', icon: '🚒', color: '#ff7a45', short: '消' },
    medical: { id: 'medical', name: '医疗', icon: '🚑', color: '#45e0c3', short: '医' },
    engineering: { id: 'engineering', name: '工程抢险', icon: '🚧', color: '#e0a83c', short: '工' }
  };
  D.CAPS = {
    police: { name: '警力', icon: '🛡', color: '#5aa9ff', short: '警' },
    fire: { name: '灭火', icon: '🔥', color: '#ff7a45', short: '火' },
    medical: { name: '医疗', icon: '✚', color: '#45e0c3', short: '医' },
    hazmat: { name: '危化', icon: '☣', color: '#b8e34c', short: '危' },
    rescue: { name: '救援', icon: '⛑', color: '#c7a0ff', short: '救' },
    engineering: { name: '工程', icon: '🚧', color: '#e0a83c', short: '工' }
  };
  D.CAP_ORDER = ['police', 'fire', 'medical', 'hazmat', 'rescue', 'engineering'];

  D.PRIORITIES = {
    1: { id: 1, name: '紧急', color: '#ff4d5e', label: 'P1' },
    2: { id: 2, name: '重要', color: '#ff9f43', label: 'P2' },
    3: { id: 3, name: '一般', color: '#ffd166', label: 'P3' }
  };
  D.PRIORITY_ORDER = [1, 2, 3];

  /* ---------------- 单位 ---------------- */
  D.UNITS = {
    cruiser: {
      id: 'cruiser', name: '巡逻车', short: '巡逻车', service: 'police', icon: '🚓',
      caps: { police: 1 }, speed: 96, restock: 9, crew: 2, flying: false,
      size: { len: 24, wid: 13 }, color: '#dfe8ef', accent: '#2f6fd0', beacon: '#3b8bff',
      desc: '机动性强，适合现场封控与一般治安警情。'
    },
    swat: {
      id: 'swat', name: '特警装甲车', short: '特警车', service: 'police', icon: '🚐',
      caps: { police: 3 }, speed: 64, restock: 15, crew: 6, flying: false,
      size: { len: 30, wid: 15 }, color: '#3c4655', accent: '#1b2430', beacon: '#ff4d5e',
      desc: '高威慑力，适合暴动、劫持与重案；抵达较慢。'
    },
    engine: {
      id: 'engine', name: '泵浦消防车', short: '消防车', service: 'fire', icon: '🚒',
      caps: { fire: 2 }, speed: 74, restock: 14, crew: 5, flying: false,
      size: { len: 33, wid: 14 }, color: '#c8402f', accent: '#f2f2f2', beacon: '#ff6a3d',
      desc: '灭火主力，携带水罐与泵浦。'
    },
    ladder: {
      id: 'ladder', name: '云梯消防车', short: '云梯车', service: 'fire', icon: '🚒',
      caps: { fire: 1, rescue: 2 }, speed: 61, restock: 18, crew: 4, flying: false,
      size: { len: 38, wid: 14 }, color: '#b53a2b', accent: '#e8e2d0', beacon: '#ff6a3d',
      desc: '高层救援与破拆，同时提供少量灭火力量。'
    },
    hazmat: {
      id: 'hazmat', name: '危化救援车', short: '危化车', service: 'fire', icon: '🚛',
      caps: { hazmat: 2, fire: 1 }, speed: 68, restock: 20, crew: 4, flying: false,
      size: { len: 35, wid: 15 }, color: '#8f9d33', accent: '#d9e66b', beacon: '#b8e34c',
      desc: '处理泄漏、毒气与危险品；数量有限。'
    },
    ambulance: {
      id: 'ambulance', name: '救护车', short: '救护车', service: 'medical', icon: '🚑',
      caps: { medical: 2 }, speed: 90, restock: 11, crew: 3, flying: false,
      size: { len: 28, wid: 13 }, color: '#eef4f5', accent: '#d63b4f', beacon: '#ff4d5e',
      desc: '标准急救单元，可同时处理多名伤员。'
    },
    bike: {
      id: 'bike', name: '急救摩托', short: '急救摩托', service: 'medical', icon: '🏍',
      caps: { medical: 1 }, speed: 120, restock: 6, crew: 1, flying: false,
      size: { len: 16, wid: 9 }, color: '#e8f4ef', accent: '#2ea88c', beacon: '#45e0c3',
      desc: '穿过拥堵最快，但只能处理一名伤员。'
    },
    heli: {
      id: 'heli', name: '医疗直升机', short: '直升机', service: 'medical', icon: '🚁',
      caps: { medical: 2, rescue: 1 }, speed: 175, restock: 24, crew: 3, flying: true,
      size: { len: 34, wid: 18 }, color: '#e9f2f5', accent: '#2f7fa8', beacon: '#45e0c3',
      desc: '无视道路直飞现场，适合远郊与机场；整备时间长。'
    }
  };
  D.UNIT_ORDER = ['cruiser', 'swat', 'engine', 'ladder', 'hazmat', 'ambulance', 'bike', 'heli'];

  /* ---------------- 站点（地图生成器按锚点找空位放置） ---------------- */
  D.STATIONS = [
    { id: 'fire_central', type: 'fire', name: '中央消防站', x: 24, y: 16, w: 5, h: 4, units: ['engine', 'engine', 'ladder'] },
    { id: 'fire_industrial', type: 'fire', name: '工业区消防站', x: 94, y: 16, w: 5, h: 4, units: ['engine', 'hazmat'] },
    { id: 'fire_airport', type: 'fire', name: '机场消防站', x: 122, y: 73, w: 4, h: 3, units: ['engine'] },
    { id: 'hospital_main', type: 'medical', name: '织雾市第一医院', x: 30, y: 30, w: 5, h: 4, units: ['ambulance', 'ambulance'], tag: 'hospital' },
    { id: 'ems_center', type: 'medical', name: '紧急医疗中心', x: 10, y: 38, w: 4, h: 3, units: ['ambulance', 'bike'] },
    { id: 'clinic_country', type: 'medical', name: '稻香乡卫生院', x: 11, y: 84, w: 4, h: 3, units: ['ambulance'] },
    { id: 'police_hq', type: 'police', name: '织雾市公安局', x: 16, y: 10, w: 5, h: 4, units: ['cruiser', 'cruiser', 'swat'], tag: 'police_hq' },
    { id: 'police_industrial', type: 'police', name: '工业区派出所', x: 94, y: 24, w: 4, h: 3, units: ['cruiser'] },
    { id: 'police_airport', type: 'police', name: '机场警务站', x: 96, y: 73, w: 3, h: 2, units: ['cruiser'] }
  ];

  /* ---------------- 建筑种类（尺寸、配色、数量与名字池） ---------------- */
  D.BUILDING_SPECS = {
    house: { w: [2, 3], h: [2, 3], floors: [1, 3], colors: ['#3a4250', '#413c39', '#3b4440', '#453f3a'], roof: '#2b313a', name: '住宅', pop: 8 },
    apartment: { w: [3, 4], h: [3, 4], floors: [8, 22], colors: ['#37424f', '#3d3f4a', '#333c46'], roof: '#262d36', name: '公寓', pop: 90 },
    office: { w: [3, 5], h: [3, 5], floors: [12, 36], colors: ['#2f3a45', '#343b44', '#2a353f'], roof: '#222a32', name: '写字楼', pop: 40 },
    shop: { w: [2, 3], h: [2, 3], floors: [1, 2], colors: ['#46413a', '#3f3b36', '#433d34'], roof: '#302c27', name: '商铺', pop: 15 },
    school: { w: [5, 6], h: [4, 5], floors: [3, 5], colors: ['#43483f', '#3f463d'], roof: '#2d332b', name: '学校', pop: 180 },
    factory: { w: [4, 5], h: [3, 5], floors: [1, 2], colors: ['#3c403e', '#443f3a', '#394041'], roof: '#272c2c', name: '厂房', pop: 30 },
    warehouse: { w: [4, 6], h: [3, 4], floors: [1, 2], colors: ['#3e4145', '#453f3c', '#3b3f43'], roof: '#292c2f', name: '仓库', pop: 12 },
    tank: { w: [2, 3], h: [2, 3], floors: [1, 1], colors: ['#5a5b47', '#57503f'], roof: '#3b3b2c', name: '储罐', pop: 0, round: true },
    chemical: { w: [6, 8], h: [4, 5], floors: [1, 2], colors: ['#4a463b', '#50483a'], roof: '#333026', name: '化工厂', pop: 45 },
    farmhouse: { w: [2, 3], h: [2, 3], floors: [1, 2], colors: ['#5a4f3f', '#54493b', '#5d5343'], roof: '#3b3328', name: '农舍', pop: 6 },
    barn: { w: [3, 4], h: [3, 4], floors: [1, 1], colors: ['#5c4638', '#554234'], roof: '#392a21', name: '谷仓', pop: 2 },
    field: { w: [3, 5], h: [2, 4], floors: [0, 0], colors: ['#3f4a2c'], roof: '#3f4a2c', name: '农田', pop: 0, flat: true },
    terminal: { w: [8, 10], h: [4, 5], floors: [2, 3], colors: ['#3a414b', '#39404a'], roof: '#252b33', name: '航站楼', pop: 320 },
    hangar: { w: [5, 6], h: [4, 4], floors: [1, 2], colors: ['#40454b', '#3b4147'], roof: '#292e34', name: '机库', pop: 20 },
    cargo: { w: [4, 5], h: [3, 4], floors: [1, 2], colors: ['#3e4242', '#443f3b'], roof: '#292c2c', name: '货运站', pop: 15 },
    tower: { w: [2, 2], h: [2, 2], floors: [6, 8], colors: ['#465059'], roof: '#2b333b', name: '塔台', pop: 8 },
    prison_block: { w: [6, 7], h: [4, 5], floors: [2, 3], colors: ['#3f4247', '#44484d'], roof: '#292c30', name: '监区', pop: 140 },
    prison_yard: { w: [4, 5], h: [4, 5], floors: [0, 0], colors: ['#3b3e3b'], roof: '#3b3e3b', name: '放风场', pop: 0, flat: true },
    police_hq: { w: [6, 6], h: [4, 4], floors: [4, 6], colors: ['#333f4d'], roof: '#242e3a', name: '公安局', pop: 60 },
    fire_station: { w: [4, 5], h: [3, 4], floors: [2, 2], colors: ['#4a3d37'], roof: '#302723', name: '消防站', pop: 20 },
    hospital: { w: [6, 7], h: [4, 5], floors: [6, 10], colors: ['#3b4652'], roof: '#28323d', name: '医院', pop: 220 },
    mall: { w: [5, 6], h: [5, 6], floors: [4, 6], colors: ['#3f3d46', '#3b4048'], roof: '#282a31', name: '商场', pop: 260 },
    runway: { w: [40, 40], h: [4, 4], floors: [0, 0], colors: ['#2c3238'], roof: '#2c3238', name: '跑道', pop: 0, flat: true },
    rail_station: { w: [6, 7], h: [4, 5], floors: [2, 3], colors: ['#3b424a', '#384048'], roof: '#262d34', name: '火车站', pop: 240 }
  };

  D.NAME_POOLS = {
    house: ['梧桐里', '青石巷', '望江新村', '河湾小院', '槐树胡同', '红砖楼', '铁西街', '船厂宿舍'],
    apartment: ['织雾公寓', '望江花园', '锦绣苑', '晨光小区', '滨河新村', '金桂家园', '江畔名居', '安康里'],
    office: ['织雾大厦', '城建大楼', '江城商务楼', '金穗金融中心', '航运大厦', '江北写字楼'],
    shop: ['老陈杂货', '织雾便利店', '巷口面馆', '晨光药房', '青禾超市', '惠民菜场', '发记五金', '转角咖啡'],
    school: ['织雾市第三中学', '城东小学', '织雾职业技术学院', '滨河小学'],
    factory: ['江城机械厂', '织雾纺织三厂', '宏远电子厂', '江北水泥厂', '远东涂装厂', '红光造纸厂'],
    warehouse: ['织雾物流仓库', '三号保税仓', '冷链仓储中心', '工业区配送仓', '建材堆场'],
    tank: ['危险品储罐区', '化工罐区', '液氨储罐'],
    chemical: ['织雾化工厂', '江东化工联合装置', '精细化工车间'],
    farmhouse: ['稻香村李家', '王家院', '河湾农舍', '张家老屋', '柳树屯'],
    barn: ['稻香谷仓', '农机库', '村办粮站', '秸秆收储点'],
    field: ['稻田', '油菜田', '麦田', '蔬菜大棚', '晒场'],
    terminal: ['T2 航站楼'],
    hangar: ['一号机库', '二号机库', '维修机库'],
    cargo: ['航空货运站', '保税仓库'],
    tower: ['机场塔台'],
    prison_block: ['白岩监狱 A 区', '白岩监狱 B 区', '白岩监狱 C 区', '监区综合楼'],
    prison_yard: ['白岩监狱放风场'],
    police_hq: ['织雾市公安局'],
    fire_station: ['消防站'],
    hospital: ['织雾市第一医院'],
    mall: ['织雾广场', '万象城', '滨江购物中心'],
    rail_station: ['织雾站', '织雾北站']
  };

  /* ---------------- 天气与光照 ---------------- */
  D.WEATHERS = {
    rain: { id: 'rain', name: '暴雨', rain: 1, fog: 0.18, lightning: 0, wind: 0.45, tint: '#0b1422' },
    storm: { id: 'storm', name: '雷暴', rain: 1.35, fog: 0.16, lightning: 1, wind: 0.9, tint: '#0a101c' },
    drizzle: { id: 'drizzle', name: '小雨', rain: 0.45, fog: 0.12, lightning: 0, wind: 0.2, tint: '#0d1622' },
    fog: { id: 'fog', name: '浓雾', rain: 0, fog: 0.55, lightning: 0, wind: 0.08, tint: '#141b22' },
    clear: { id: 'clear', name: '晴', rain: 0, fog: 0.04, lightning: 0, wind: 0.15, tint: '#0a1220' }
  };
  D.LIGHTS = {
    night: { id: 'night', name: '夜', alpha: 0.38, tint: '#07101c', lights: 1, ambient: 0.22 },
    dawn: { id: 'dawn', name: '黎明', alpha: 0.16, tint: '#13202c', lights: 0.5, ambient: 0.55 },
    dusk: { id: 'dusk', name: '黄昏', alpha: 0.24, tint: '#140f18', lights: 0.72, ambient: 0.5 },
    day: { id: 'day', name: '白天', alpha: 0.0, tint: '#0b1a20', lights: 0.1, ambient: 0.9 },
    storm: { id: 'storm', name: '风暴', alpha: 0.4, tint: '#050b14', lights: 0.8, ambient: 0.35 }
  };

  /* ---------------- 难度 ---------------- */
  // v2.0：删除难度选择，固定为“真实”。旧存档里的其它难度会在加载时迁移。
  D.DIFFICULTY = {
    real: {
      id: 'real', name: '真实', desc: '固定真实难度：窗口、伤亡与资源都按设计值，不提供轻松/硬核档。',
      windowScale: 1.0, spawnScale: 1.0, harmScale: 1.0, repBonus: 0, maxDeaths: null
    }
  };

  /* ---------------- 警情目录 ----------------
     数值含义：
       needs: 现场“持续覆盖”所需能力，未凑齐时倒计时不暂停
       window: 从接警到失控的秒数（会乘以班次与难度系数）
       work: 完全覆盖后处理完毕所需秒数
       harm: 失控时死亡人数
       damage: 失控时的财产损失（资金/评分）
       spread: 处置不及时会蔓延（每 spreadEvery 秒）
  ------------------------------------------- */
  D.INCIDENTS = [
    {
      id: 'house_fire', name: '住宅火灾', icon: '🔥', priority: 2, weight: 14,
      zones: ['city', 'country'], kinds: ['house', 'apartment', 'farmhouse'],
      needs: { fire: 2, medical: 1 }, window: 165, work: 44, harm: 1, damage: 180,
      spread: true, spreadEvery: 30, code: '火警',
      desc: '厨房明火引燃木质结构，浓烟已封住楼道。',
      tip: '两支灭火力量可压制火势，医疗组负责疏散伤员。'
    },
    {
      id: 'highrise_fire', name: '高层火灾', icon: '🔥', priority: 1, weight: 7,
      zones: ['city'], kinds: ['apartment', 'office', 'mall'],
      needs: { fire: 3, rescue: 1, medical: 1 }, window: 205, work: 58, harm: 3, damage: 520,
      spread: true, spreadEvery: 26, code: '火警',
      desc: '高层外墙起火，有多人被困在阳台，云梯是唯一登高手段。',
      tip: '必须同时有足够灭火力量与救援能力；云梯车兼顾两者。'
    },
    {
      id: 'gas_leak', name: '燃气泄漏', icon: '⚠️', priority: 3, weight: 8,
      zones: ['city'], kinds: ['house', 'apartment', 'shop'],
      needs: { fire: 1, hazmat: 1, engineering: 1 }, window: 175, work: 36, harm: 1, damage: 160,
      code: '泄漏',
      desc: '街区燃气管道破损，味道浓重，附近商户已自行疏散。',
      tip: '危化车负责侦检与堵漏，消防车负责稀释与警戒。'
    },
    {
      id: 'factory_leak', name: '化学品泄漏', icon: '☣️', priority: 2, weight: 10,
      zones: ['industrial'], kinds: ['factory', 'warehouse', 'chemical', 'tank'],
      needs: { hazmat: 1, fire: 1, medical: 1 }, window: 190, work: 46, harm: 2, damage: 360,
      code: '危化',
      desc: '反应釜阀门失效，刺激性气体向厂区扩散。',
      tip: '危化车降低扩散，医疗组准备洗消与急救。'
    },
    {
      id: 'tank_fire', name: '储罐起火', icon: '💥', priority: 1, weight: 5,
      zones: ['industrial'], kinds: ['tank', 'chemical'],
      needs: { fire: 3, hazmat: 1, medical: 1 }, window: 225, work: 62, harm: 3, damage: 900,
      spread: true, spreadEvery: 24, code: '火警',
      desc: '储罐顶部爆燃，火柱几十米高，随时可能沸溢。',
      tip: '需要足够消防力量持续冷却，同时危化组确认罐区风险。'
    },
    {
      id: 'car_crash', name: '交通事故', icon: '🚗', priority: 2, weight: 15,
      zones: ['city', 'country', 'industrial'], onRoad: true,
      needs: { police: 1, medical: 2 }, window: 140, work: 36, harm: 1, damage: 120,
      code: '车祸',
      desc: '两车迎面相撞，一名司机被困，现场车流仍在通过。',
      tip: '先由警力封控车道，医疗组才能安全施救。'
    },
    {
      id: 'cardiac', name: '心脏骤停', icon: '❤️', priority: 2, weight: 13,
      zones: ['city', 'country'], kinds: ['house', 'apartment', 'office', 'shop', 'school', 'farmhouse', 'hospital'],
      needs: { medical: 1 }, window: 95, work: 28, harm: 1, damage: 20,
      code: '急救',
      desc: '家属报称老人倒地无呼吸，调度员正在电话指导心肺复苏。',
      tip: '窗口极短，优先派最近的急救单元。摩托往往比救护车更快。'
    },
    {
      id: 'burglary', name: '入室盗窃', icon: '🏚️', priority: 3, weight: 12,
      zones: ['city', 'country'], kinds: ['house', 'apartment', 'shop', 'farmhouse'],
      needs: { police: 1 }, window: 200, work: 30, harm: 0, damage: 80,
      code: '治安',
      desc: '住户通过手机监控发现陌生男子翻窗入室，嫌疑人可能仍在屋内。',
      tip: '一辆巡逻车足以处置；别让重案单位空跑。'
    },
    {
      id: 'robbery', name: '持械抢劫', icon: '💰', priority: 2, weight: 8,
      zones: ['city'], kinds: ['shop', 'mall', 'office'],
      needs: { police: 2 }, window: 150, work: 38, harm: 1, damage: 300,
      code: '重案',
      desc: '便利店遭持刀抢劫，店员被控制，嫌疑人情绪激动。',
      tip: '需要两组警力同时封控与谈判；特警车一组顶三组。'
    },
    {
      id: 'fight', name: '街头斗殴', icon: '🥊', priority: 3, weight: 11,
      zones: ['city'], kinds: ['shop', 'mall', 'house', 'school'],
      needs: { police: 1, medical: 1 }, window: 145, work: 32, harm: 1, damage: 70,
      code: '治安',
      desc: '夜市口两伙人发生肢体冲突，已有人员头部受伤。',
      tip: '警力控制现场后，医疗组才能靠近伤员。'
    },
    {
      id: 'barn_fire', name: '谷仓火灾', icon: '🔥', priority: 2, weight: 10,
      zones: ['country'], kinds: ['barn', 'farmhouse', 'field'],
      needs: { fire: 2, medical: 1 }, window: 160, work: 42, harm: 1, damage: 220,
      spread: true, spreadEvery: 32, code: '火警',
      desc: '秸秆堆垛起火，火势正向相邻农舍蔓延。',
      tip: '乡下道路狭窄，消防车到位后优先切断蔓延方向。'
    },
    {
      id: 'food_poison', name: '集体食物中毒', icon: '🍲', priority: 2, weight: 7,
      zones: ['city', 'country'], kinds: ['shop', 'school', 'mall', 'farmhouse'],
      needs: { medical: 2 }, window: 185, work: 44, harm: 2, damage: 60,
      code: '急救',
      desc: '多人在同一餐馆就餐后出现呕吐、腹痛，人数还在增加。',
      tip: '至少两辆救护车；优先派大容量单元。'
    },
    {
      id: 'elevator', name: '电梯困人', icon: '🛗', priority: 3, weight: 8,
      zones: ['city'], kinds: ['apartment', 'office', 'mall', 'hospital'],
      needs: { fire: 1, rescue: 1 }, window: 165, work: 32, harm: 0, damage: 40,
      code: '救援',
      desc: '老楼电梯停在两层之间，轿厢内有老人和儿童。',
      tip: '云梯车提供专业破拆救援；单纯消防车无法满足“救援”需求。'
    },
    {
      id: 'suspicious_bag', name: '可疑行李', icon: '🧳', priority: 2, weight: 8,
      zones: ['airport'], kinds: ['terminal', 'cargo', 'hangar'],
      needs: { police: 2 }, window: 160, work: 34, harm: 2, damage: 260,
      code: '防爆',
      desc: '航站楼角落一只无人认领的行李箱，机场已划出警戒区。',
      tip: '需要两组警力封控并等待排爆；先清空周边旅客。'
    },
    {
      id: 'runway_fod', name: '跑道异物', icon: '✈️', priority: 3, weight: 6,
      zones: ['airport'], kinds: ['runway'], spotTags: ['runway'],
      needs: { police: 1, fire: 1 }, window: 150, work: 28, harm: 0, damage: 120,
      code: '航空',
      desc: '塔台报告跑道入口有金属构件，进近航班被迫复飞。',
      tip: '消防车负责快速清理，警力负责跑道封锁。'
    },
    {
      id: 'prison_fight', name: '监区冲突', icon: '🔒', priority: 3, weight: 8,
      zones: ['prison'], kinds: ['prison_block', 'prison_yard'],
      needs: { police: 2, medical: 1 }, window: 150, work: 38, harm: 1, damage: 90,
      code: '监狱',
      desc: '两个监室在放风时发生冲突，狱警人手不足，请求外援。',
      tip: '警力进入监区需要时间，别等冲突升级再派。'
    },
    {
      id: 'police_theft', name: '证物室失窃', icon: '🗄️', priority: 2, weight: 5,
      zones: ['city'], kinds: ['police_hq'], spotTags: ['police_hq'],
      needs: { police: 2 }, window: 180, work: 34, harm: 1, damage: 240,
      code: '重案',
      desc: '市公安局证物室警报触发，内部人员尚未确认入侵者位置。',
      tip: '这是特殊地点警情：市公安局位于中心城区。'
    },
    {
      id: 'plane_crash', name: '飞机失事', icon: '✈️', priority: 1, weight: 2,
      zones: ['airport'], spotTags: ['runway'],
      needs: { fire: 3, medical: 4, police: 2 }, window: 280, work: 68, harm: 4, damage: 1500,
      code: '空难',
      desc: '一架小型客机在跑道末端重着陆，机身断裂并起火，机上有多名伤员。',
      tip: '真正的空难：需要大量医疗与消防同时到场，警力负责封控跑道。'
    },
    {
      id: 'prison_escape', name: '越狱事件', icon: '🚨', priority: 1, weight: 3,
      zones: ['prison'], spotTags: ['prison_yard', 'prison_block'],
      needs: { police: 3, medical: 1 }, window: 240, work: 55, harm: 2, damage: 700,
      code: '越狱',
      desc: '白岩监狱围墙报警：至少两名囚犯趁换班时逃脱，狱警已封锁外围道路。',
      tip: '需要三组警力封控与搜捕；医疗组准备处理越狱过程中的伤员。'
    },
    {
      id: 'bank_robbery', name: '银行劫案', icon: '🏦', priority: 1, weight: 3,
      zones: ['city'], kinds: ['office', 'shop', 'mall'],
      needs: { police: 3 }, window: 200, work: 48, harm: 2, damage: 900,
      code: '重案',
      desc: '两名持枪劫匪闯入银行，柜台人员被扣为人质，现场传出枪声。',
      tip: '至少三组警力同时封控与谈判；不要只派一辆巡逻车。'
    },
    {
      id: 'drunk_drive', name: '酒驾肇事', icon: '🍺', priority: 2, weight: 9,
      zones: ['city', 'industrial', 'country'], onRoad: true,
      mobile: true, moveSpeed: 38, chaseStop: 'police',
      needs: { police: 1, medical: 1 }, window: 120, work: 30, harm: 1, damage: 180,
      code: '酒驾',
      desc: '一辆轿车在路口蛇形行驶后撞上护栏，司机满身酒气，拒绝下车。',
      tip: '先由警力控制驾驶人，医疗组检查伤情；短窗口，别拖。'
    },
    {
      id: 'hit_and_run', name: '肇事逃逸', icon: '🚗', priority: 2, weight: 7,
      zones: ['city', 'industrial', 'country'], onRoad: true,
      mobile: true, moveSpeed: 52, chaseStop: 'police',
      needs: { police: 2, medical: 2 }, window: 135, work: 36, harm: 2, damage: 260,
      code: '肇事',
      desc: '一名行人被撞倒在路边，肇事车辆沿主干道加速逃离，目击者记下了车牌。',
      tip: '警力追查与封控，医疗组先救人；两组医疗才够处理多名伤者。'
    },
    {
      id: 'suspect_flee', name: '持械逃窜', icon: '🏃', priority: 2, weight: 6,
      zones: ['city', 'industrial', 'country'], onRoad: true,
      mobile: true, moveSpeed: 58, chaseStop: 'police',
      needs: { police: 2 }, window: 145, work: 34, harm: 2, damage: 200,
      code: '追捕',
      desc: '一名持刀嫌疑人在盘查时突然逃跑，沿主干道向城外方向逃窜，可能劫持车辆。',
      tip: '需要两组警力前后夹击；窗口短，别只派一辆车。'
    },
    {
      id: 'missing_person', name: '人员失踪', icon: '🔍', priority: 3, weight: 7,
      zones: ['city', 'country'], kinds: ['house', 'apartment', 'farmhouse', 'field', 'shop'],
      needs: { police: 2 }, window: 300, work: 55, harm: 1, damage: 20,
      code: '失踪',
      desc: '家属报称一名老人清晨出门后失联，最后出现在河边步道附近。',
      tip: '窗口长但别忘掉：需要两组警力分头搜索与调监控。'
    },
    {
      id: 'train_derail', name: '列车脱轨', icon: '🚆', priority: 1, weight: 2,
      zones: ['city'], spotTags: ['train_station'], kinds: ['rail_station'],
      needs: { fire: 2, rescue: 2, medical: 2, police: 1 }, window: 260, work: 60, harm: 3, damage: 1000,
      code: '列车',
      desc: '一列货运列车在织雾站进站时脱轨，车厢倾覆并压住站台，有人员被困。',
      tip: '消防与救援必须同时到场破拆，医疗组在外围待命。'
    },
    {
      id: 'station_crowd', name: '车站踩踏', icon: '🧍', priority: 2, weight: 4,
      zones: ['city'], spotTags: ['train_station'], kinds: ['rail_station'],
      needs: { police: 2, medical: 2 }, window: 160, work: 38, harm: 2, damage: 150,
      code: '踩踏',
      desc: '织雾站候车厅因列车晚点发生拥挤，楼梯口有人摔倒，现场开始混乱。',
      tip: '警力分流人群，医疗组处理挤压伤；两组都要到。'
    },
    {
      id: 'airport_crash', name: '航班紧急迫降', icon: '✈️', priority: 1, weight: 0,
      zones: ['airport'], spotTags: ['runway'], finale: true,
      needs: { fire: 3, medical: 3, police: 2 }, window: 330, work: 74, harm: 4, damage: 1400,
      code: '空难',
      desc: '塔台通报一架客机起落架故障，将在 18 分钟后尝试迫降。',
      tip: '这是大事件：需要消防、医疗、警务同时到位，缺一组都无法开始处置。'
    },
    {
      id: 'prison_riot', name: '监狱暴动', icon: '🚨', priority: 1, weight: 0,
      zones: ['prison'], spotTags: ['prison_yard', 'prison_block'], finale: true,
      needs: { police: 3, medical: 2 }, window: 300, work: 66, harm: 3, damage: 800,
      code: '暴动',
      desc: '白岩监狱 C 区失控，囚犯占据放风场，狱警请求特警支援。',
      tip: '这是大事件：需要至少三组警力与两组医疗力量。'
    },
    {
      id: 'chem_explosion', name: '化工厂爆炸', icon: '☢️', priority: 1, weight: 0,
      zones: ['industrial'], spotTags: ['chemical', 'tank'], finale: true,
      needs: { hazmat: 2, fire: 3, medical: 2 }, window: 310, work: 70, harm: 3, damage: 1200,
      code: '危化',
      desc: '工业区传来连续爆响，厂区上空出现黄绿色烟云，周边居民正在撤离。',
      tip: '这是大事件：危化能力必须现场覆盖，否则无法推进处置。'
    }
  ];
  D.INCIDENT_BY_ID = {};
  D.INCIDENTS.forEach(function (it) { D.INCIDENT_BY_ID[it.id] = it; });

  /* ---------------- 班次 ---------------- */
  D.SHIFTS = [
    {
      index: 0, name: '第一班 · 风雨夜', short: '风雨夜', startMinutes: 23 * 60 + 40,
      light: 'night', clockScale: 1, weather: 'rain', weather2: 'storm', duration: 330, difficulty: 1.0,
      windowScale: 1.15, spawnMin: 27, spawnMax: 37, firstAt: 9, maxActive: 4,
      startFunds: 1800, startRep: 82, maxDeaths: 12, finale: null,
      intro: '暴雨压城，电台里全是杂音。今晚是你第一次独立值班。',
      next: '城区的灯还亮着。下一班，工业区会有麻烦。'
    },
    {
      index: 1, name: '第二班 · 工业区警报', short: '工业区警报', startMinutes: 15 * 60 + 10,
      light: 'dusk', clockScale: 1, weather: 'fog', weather2: 'drizzle', duration: 360, difficulty: 1.08,
      windowScale: 1.06, spawnMin: 25, spawnMax: 34, firstAt: 7, maxActive: 4,
      startFunds: 1800, startRep: 82, maxDeaths: 12,
      finale: { def: 'chem_explosion', at: 0.58 },
      intro: '雾从江面漫上来，工业区的储罐压力异常。',
      next: '监狱方面的电话越来越频繁。下一班，白岩监狱。'
    },
    {
      index: 2, name: '第三班 · 白岩之夜', short: '白岩之夜', startMinutes: 0 * 60 + 20,
      light: 'night', clockScale: 1.2, weather: 'clear', weather2: 'drizzle', duration: 390, difficulty: 1.2,
      windowScale: 0.99, spawnMin: 23, spawnMax: 32, firstAt: 6, maxActive: 5,
      startFunds: 1800, startRep: 82, maxDeaths: 11,
      finale: { def: 'prison_riot', at: 0.6 },
      intro: '白岩监狱的探照灯扫过围墙。今晚，里面不太平。',
      next: '机场塔台发来函件：明天有强对流。下一班，机场。'
    },
    {
      index: 3, name: '第四班 · 机场惊雷', short: '机场惊雷', startMinutes: 11 * 60 + 20,
      light: 'storm', clockScale: 1, weather: 'storm', weather2: 'fog', duration: 420, difficulty: 1.34,
      windowScale: 0.93, spawnMin: 22, spawnMax: 31, firstAt: 6, maxActive: 5,
      startFunds: 1800, startRep: 82, maxDeaths: 10,
      finale: { def: 'airport_crash', at: 0.62 },
      intro: '雷暴压过跑道，进近航班在云层里盘旋。',
      next: '所有频道同时亮起。最后一场考验，没有预兆。'
    },
    {
      index: 4, name: '第五班 · 临界时刻', short: '临界时刻', startMinutes: 18 * 60 + 50,
      light: 'night', clockScale: 1.5, weather: 'storm', weather2: 'rain', duration: 480, difficulty: 1.5,
      windowScale: 0.88, spawnMin: 21, spawnMax: 29, firstAt: 5, maxActive: 6,
      startFunds: 1800, startRep: 82, maxDeaths: 9,
      finale: { defs: ['airport_crash', 'prison_riot'], at: 0.58 },
      intro: '三个频段同时响起。今晚没有“以后”，只有“现在”。',
      next: '城市撑过了这一夜。但值班表还很长。'
    }
  ];

  D.ENDLESS = {
    name: '无尽值班', startMinutes: 21 * 60 + 10, light: 'night', clockScale: 1, weather: 'rain', weather2: 'storm',
    duration: null, difficulty: 1.0, windowScale: 1.0, spawnMin: 26, spawnMax: 36,
    firstAt: 8, maxActive: 5, startFunds: 0, startRep: 85, maxDeaths: 99,
    rampEvery: 75, rampIncidents: 0.02, rampMaxActive: 7
  };
  D.COOP = {
    name: '联合行动', startMinutes: 22 * 60 + 30, light: 'night', clockScale: 1, weather: 'rain', weather2: 'storm',
    duration: 600, difficulty: 1.12, windowScale: 1.0, spawnMin: 22, spawnMax: 31,
    firstAt: 6, maxActive: 5, startFunds: 0, startRep: 85, maxDeaths: 20
  };

  /* ---------------- 升级 / 补给 ---------------- */
  D.UPGRADES = [
    { id: 'up_engine', icon: '🚒', name: '增援 · 泵浦消防车', cost: 1000, kind: 'unit', unit: 'engine', station: 'fire_central', desc: '中央消防站增加 1 辆消防车（灭火 +2）。' },
    { id: 'up_ladder', icon: '🪜', name: '增援 · 云梯消防车', cost: 1450, kind: 'unit', unit: 'ladder', station: 'fire_central', desc: '增加高层救援与破拆能力（救援 +2）。' },
    { id: 'up_hazmat', icon: '☣️', name: '增援 · 危化救援车', cost: 1600, kind: 'unit', unit: 'hazmat', station: 'fire_industrial', desc: '危险品处置能力 +2，应对工业区泄漏。' },
    { id: 'up_ambulance', icon: '🚑', name: '增援 · 救护车', cost: 850, kind: 'unit', unit: 'ambulance', station: 'hospital_main', desc: '第一医院增加 1 辆救护车（医疗 +2）。' },
    { id: 'up_bike', icon: '🏍️', name: '增援 · 急救摩托', cost: 500, kind: 'unit', unit: 'bike', station: 'ems_center', desc: '最快的医疗单元，适合城区短窗口警情。' },
    { id: 'up_cruiser', icon: '🚓', name: '增援 · 巡逻车', cost: 700, kind: 'unit', unit: 'cruiser', station: 'police_hq', desc: '市公安局增加 1 辆巡逻车（警力 +1）。' },
    { id: 'up_swat', icon: '🚐', name: '增援 · 特警装甲车', cost: 1250, kind: 'unit', unit: 'swat', station: 'police_hq', desc: '重案与暴动的主力（警力 +3）。' },
    { id: 'up_heli', icon: '🚁', name: '增援 · 医疗直升机', cost: 3000, kind: 'unit', unit: 'heli', station: 'hospital_main', desc: '直飞现场，医疗 +2、救援 +1；整备时间长。' },
    { id: 'up_speed', icon: '🏁', name: '车队调度优化', cost: 750, kind: 'buff', buff: 'speed', desc: '所有车辆行驶速度 +12%。' },
    { id: 'up_firepower', icon: '💦', name: '现场处置手册 · 消防篇', cost: 950, kind: 'buff', buff: 'firepower', desc: '灭火、危化与救援效率 +15%。' },
    { id: 'up_medical', icon: '🩺', name: '现场处置手册 · 医疗篇', cost: 900, kind: 'buff', buff: 'medical', desc: '医疗处置效率 +15%。' },
    { id: 'up_restock', icon: '🔧', name: '快速整备流程', cost: 700, kind: 'buff', buff: 'restock', desc: '单位返回基地后的整备时间 -25%。' }
  ];
  D.UPGRADE_BY_ID = {};
  D.UPGRADES.forEach(function (u) { D.UPGRADE_BY_ID[u.id] = u; });

  /* ---------------- 站点类型展示 ---------------- */
  D.STATION_STYLE = {
    fire: { icon: '🚒', color: '#ff7a45', label: '消防站' },
    medical: { icon: '🚑', color: '#45e0c3', label: '医疗点' },
    police: { icon: '🚓', color: '#5aa9ff', label: '警务点' },
    engineering: { icon: '🚧', color: '#e0a83c', label: '工程抢险队' }
  };

  /* ---------------- 电台文案 ---------------- */
  D.RADIO = {
    spawn: [
      '接警：{place}发生{type}，{priority}。',
      '{place}报{type}，请附近单位留意。',
      '911 接警台转来警情：{place}，{type}。'
    ],
    dispatch: [
      '{unit} 出动，前往 {place}。',
      '{unit} 已离站，预计 {eta} 秒到达 {place}。',
      '指挥中心呼叫 {unit}，目标 {place}。'
    ],
    arrival: [
      '{unit} 到达 {place}，开始处置。',
      '{place} 现场：{unit} 已到位。'
    ],
    resolve: [
      '{place} 处置完毕，收队。',
      '{place} 现场移交完毕，各单位返回。'
    ],
    fail: [
      '{place} 失控！出现伤亡，请求增援！',
      '警报：{place} 处置失败，伤亡数字上升。'
    ],
    lowrep: [
      '市长办公室来电：市民对响应速度不满。',
      '投诉电话堆积，指挥中心需要更快的反应。'
    ],
    spread: [
      '火势蔓延至 {place}！',
      '注意：{place} 出现新的起火点。'
    ]
  };

  /* ---------------- 结算/提示文案 ---------------- */
  D.GRADES = [
    { grade: 'S', min: 0.92, note: '零失误的教科书级调度。' },
    { grade: 'A', min: 0.8, note: '城市记住了你的声音。' },
    { grade: 'B', min: 0.66, note: '完成了值班，但仍有遗憾。' },
    { grade: 'C', min: 0.5, note: '勉强撑过这一班，需要复盘。' },
    { grade: 'D', min: 0, note: '指挥中心亮了一整夜的红灯。' }
  ];

  D.SUMMARY_HINTS = [
    '提示：先派警力封控，再让医疗与消防进场，能显著减少伤亡。',
    '提示：云梯车同时提供灭火与救援，高层警情优先派它。',
    '提示：乡下距离远，别等火大了才想起工业区消防站。',
    '提示：一键派遣只是兜底。手动配对比“堆车”更快。',
    '提示：单位整备期间无法出动，轮换使用比一次梭哈更稳。'
  ];

  /* ---------------- 成就 ----------------
     全部是本机成就，不联网、不上传；progress 为可选计数器显示。 */
  D.ACHIEVEMENTS = [
    { id: 'first_call', icon: '📞', name: '第一次接警', desc: '完整处置第一起警情。', counter: 'resolved', target: 1 },
    { id: 'clean_shift', icon: '🕊️', name: '零伤亡交班', desc: '在一个成功的班次里没有平民死亡。' },
    { id: 's_grade', icon: '🏅', name: '教科书调度', desc: '获得一次 S 级行动评价。' },
    { id: 'flawless', icon: '🛡️', name: '滴水不漏', desc: '一个班次内所有警情全部成功。' },
    { id: 'campaign_clear', icon: '🌃', name: '临界之夜', desc: '完成全部五个班次。' },
    { id: 'final_shift', icon: '🔥', name: '撑过临界时刻', desc: '完成第五班 · 临界时刻。' },
    { id: 'endless_5k', icon: '♾️', name: '不眠之城', desc: '无尽值班单轮积分达到 5000。' },
    { id: 'coop_first', icon: '🤝', name: '并肩作战', desc: '完成一次联机联合行动。' },
    { id: 'auto_10', icon: '⚡', name: '一键指挥官', desc: '累计使用 10 次一键派遣。', counter: 'auto', target: 10 },
    { id: 'hazmat_3', icon: '☣️', name: '危化克星', desc: '成功处置 3 起危化 / 储罐类警情。', counter: 'hazmat', target: 3 },
    { id: 'quick_40', icon: '⏱️', name: '黄金四十秒', desc: '有一次警情在 40 秒内响应到场并处置成功。', counter: 'quick', target: 1 },
    { id: 'buyer_5', icon: '🛒', name: '未雨绸缪', desc: '累计采购 5 项补给 / 升级。', counter: 'buy', target: 5 }
  ];
  D.ACH_BY_ID = {};
  D.ACHIEVEMENTS.forEach(function (a) { D.ACH_BY_ID[a.id] = a; });

  /* ---------------- 默认设置 ---------------- */
  D.DEFAULT_SETTINGS = {
    quality: 'high',
    renderScale: 'auto',
    particles: 'high',
    weatherFx: true,
    screenShake: true,
    fpsCap: 60,
    scanlines: false,
    showLabels: true,
    edgePan: false,
    volumeMaster: 0.8,
    volumeMusic: 0.55,
    volumeSfx: 0.8,
    volumeAmbience: 0.5,
    muted: false,
    difficulty: 'real',
    speedDefault: 1,
    reducedMotion: false,
    colorblind: false,
    autoPauseOnCritical: false
  };

  D.QUALITY = {
    low: { id: 'low', name: '低', baseScale: 1, dprCap: 1, particles: 0.3, windows: 0.35, lights: false, traffic: 8, shadows: false, fog: false },
    medium: { id: 'medium', name: '中', baseScale: 1, dprCap: 1, particles: 0.6, windows: 0.7, lights: true, traffic: 16, shadows: true, fog: true },
    high: { id: 'high', name: '高', baseScale: 1, dprCap: 0.9, particles: 1, windows: 1, lights: true, traffic: 20, shadows: true, fog: true },
    ultra: { id: 'ultra', name: '极高', baseScale: 1, dprCap: 1.1, particles: 1.2, windows: 1.2, lights: true, traffic: 30, shadows: true, fog: true }
  };

  /* 给 UI 显示的按键表 */
  D.KEYS = [
    ['拖动地图 / WASD', '平移视角'],
    ['滚轮 / 双指缩放', '缩放地图'],
    ['点击警情卡片', '查看需求并派遣'],
    ['一键派遣', '自动选取最近单位补齐需求'],
    ['1 / 2 / 3', '1× / 2× / 4× 时间'],
    ['空格', '暂停 / 继续'],
    ['F', '看全图'],
    ['Esc', '暂停菜单 / 关闭弹层'],
    ['H', '玩法说明']
  ];

  /* 中文本地化的少量固定词 */
  D.TEXT = {
    noCalls: '暂无警情。保持频道畅通。',
    noCallsSub: '街道安静得不正常。',
    selectHint: '点击左侧警情，或在地图上选择标记。',
    unitHint: '点击单位再点警情可直接派遣。',
    ready: '待命',
    enroute: '出动中',
    scene: '现场处置',
    returning: '返回基地',
    resting: '整备中',
    idle: '待命',
    dispatch: '派遣',
    recall: '撤离',
    noUnits: '暂无可用单位',
    needMore: '还缺',
    allCovered: '能力已覆盖，正在处置',
    pause: '已暂停',
    coopWait: '正在等待房主…'
  };
})(window);
