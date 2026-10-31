/* =========================================================================
   临界 · 紧急调度 — 内容扩展（新单位 / 新站点 / 新建筑 / 新警情）
   说明：本文件在 data.js、world-expansion.js 之后，map.js 之前加载。
         它只往现有数据对象上「追加」条目，不覆盖 data.js 的旧内容：
           · D.UNITS / D.UNIT_ORDER      —— 5 个新单位
           · D.STATIONS                  —— 5 个新站点（坐标是锚点，map.js 会找空位）
           · D.BUILDING_SPECS            —— 新区域的建筑规格
           · D.NAME_POOLS                —— 新建筑的名字池
           · D.INCIDENTS / D.INCIDENT_BY_ID —— 23 个新警情（含 1 个 finale）
         区域与尺寸来自 world-expansion.js：gov / mountain / coast 三个新区域。
         地图会放置这些 tag 供警情落点使用：
           central_gov、top_police、top_fire、top_hospital、supreme_court、
           procuratorate、supervision、gov、gas_station、air_fuel、
           mountain、lake、beach、sea、tunnel、bridge。

   【回退办法】
   1) 删除本文件 emergency/js/content-expansion.js；
   2) 打开 emergency/index.html，删掉这一行：
        <script src="js/content-expansion.js"></script>
      并同时删掉 world-expansion.js 的引用（若也要回退大世界）；
   3) 刷新页面即可。本文件不写 localStorage、不联网、不改动任何 DOM，
      删除后游戏回到 data.js 的原始内容，无残留状态。
   4) 若已提交 git，直接 revert 对应提交即可。
   ========================================================================= */
(function (root) {
  'use strict';
  var EM = root.EM = root.EM || {};
  var D = EM.data;

  // 数据层缺失时安静退出：避免在别的页面误引用本文件时报错。
  if (!D || !D.WORLD || !D.UNITS || !D.INCIDENTS) {
    if (root.console) root.console.warn('[content-expansion] 未找到 EM.data，已跳过内容扩展。');
    return;
  }

  /* =======================================================================
     一、新单位（追加到 D.UNITS，并把 id 追加到 D.UNIT_ORDER）
     caps 只能用 D.CAPS 里的键：police / fire / medical / hazmat / rescue。
     说明：command 投放在最高人民消防局（政务区多部门联动现场），
           heli_fire 投放在山区消防站（山地没有公路可走，直升机是唯一能快速抵达的力量）；
           两者开局即可实际出动，不再只是数据备胎。
     ======================================================================= */
  var NEW_UNITS = [
    {
      id: 'forest', name: '森林消防车', short: '森防车', service: 'fire', icon: '🚙',
      caps: { fire: 2, rescue: 1 }, speed: 60, restock: 16, crew: 4, flying: false,
      size: { len: 32, wid: 15 }, color: '#7c8a3a', accent: '#d8d27a', beacon: '#ffb03d',
      desc: '带水炮与风力灭火机的山林消防车，爬坡越野强，但在平原干道上跑不快。'
    },
    {
      id: 'boat', name: '水上救援艇', short: '救援艇', service: 'fire', icon: '🚤',
      caps: { rescue: 2, medical: 1 }, speed: 105, restock: 14, crew: 3, flying: false,
      size: { len: 26, wid: 11 }, color: '#e8eef2', accent: '#d9633c', beacon: '#ff8a3d',
      desc: '从海岸救援站下水的水上单元，能贴近落水者与礁石区，同时提供基础急救。'
    },
    {
      id: 'interceptor', name: '高速追捕车', short: '追捕车', service: 'police', icon: '🚔',
      caps: { police: 1 }, speed: 165, restock: 8, crew: 2, flying: false,
      size: { len: 27, wid: 13 }, color: '#e7edf4', accent: '#1f2f45', beacon: '#3b8bff',
      desc: '大马力追捕车，直线速度全场最快；单车警戒能力有限，适合配合设卡合围。'
    },
    {
      id: 'command', name: '应急指挥车', short: '指挥车', service: 'police', icon: '📡',
      caps: { police: 1, fire: 1, medical: 1, rescue: 1 }, speed: 82, restock: 18, crew: 5, flying: false,
      size: { len: 34, wid: 16 }, color: '#2f3b4a', accent: '#8fd3ff', beacon: '#8fd3ff',
      desc: '联合指挥单元：每种能力都只有一点，但能同时补上多个缺口，适合多部门联动现场。'
    },
    {
      id: 'heli_fire', name: '消防直升机', short: '消防直升机', service: 'fire', icon: '🚁',
      caps: { fire: 2, rescue: 1 }, speed: 160, restock: 26, crew: 3, flying: true,
      size: { len: 34, wid: 18 }, color: '#d9583f', accent: '#f0e6d2', beacon: '#ff6a3d',
      desc: '吊桶灭火的直升机，无视道路直飞山区与海湾；整备时间长，不能连续出动。'
    }
  ];

  D.UNITS = D.UNITS || {};
  D.UNIT_ORDER = D.UNIT_ORDER || [];
  NEW_UNITS.forEach(function (u) {
    if (!D.UNITS[u.id]) D.UNITS[u.id] = u;          // 已存在则不覆盖，保证幂等
    if (D.UNIT_ORDER.indexOf(u.id) < 0) D.UNIT_ORDER.push(u.id);
  });

  /* =======================================================================
     二、新站点（追加到 D.STATIONS）
     · 坐标只是「锚点」：map.js 的 buildStations 会在附近找空位，找不到就跳过；
     · type 只能是 police / fire / medical（map.js 用它决定建筑外观与图标）；
     · units 里引用的单位必须存在于 D.UNITS（含上面新增的 5 个）。
     ======================================================================= */
  var NEW_STATIONS = [
    {
      id: 'top_police', type: 'police', name: '最高人民警察局',
      x: 164, y: 16, w: 5, h: 4, units: ['interceptor', 'swat'], tag: 'top_police'
    },
    {
      id: 'top_fire', type: 'fire', name: '最高人民消防局',
      // command 随消防局首发：四种能力各 1 点，用于政务区多部门联动现场。
      x: 176, y: 16, w: 5, h: 4, units: ['forest', 'engine', 'command'], tag: 'top_fire'
    },
    {
      id: 'top_hospital', type: 'medical', name: '最高人民医院',
      x: 188, y: 16, w: 6, h: 4, units: ['ambulance', 'heli'], tag: 'top_hospital'
    },
    {
      id: 'fire_mountain', type: 'fire', name: '山区消防站',
      // heli_fire 常驻山区：盘山公路太慢，消防直升机是山火的第一响应。
      x: 40, y: 120, w: 4, h: 3, units: ['forest', 'engine', 'heli_fire']
    },
    {
      id: 'coast_guard', type: 'fire', name: '海岸救援站',
      x: 150, y: 132, w: 5, h: 3, units: ['boat', 'ambulance']
    }
  ];

  D.STATIONS = D.STATIONS || [];
  NEW_STATIONS.forEach(function (st) {
    var exists = D.STATIONS.some(function (s) { return s.id === st.id; });
    if (!exists) D.STATIONS.push(st);               // 幂等：重复加载不会重复加站点
  });

  /* =======================================================================
     三、新建筑规格（D.BUILDING_SPECS）
     字段与 data.js 现有规格保持一致：w/h 范围、层数、配色、屋顶、显示名、人口。
     地图在政务区 / 山区 / 海湾生成通用建筑时会按 kind 取这里的规格。
     ======================================================================= */
  function spec(w, h, floors, colors, roof, name, pop, extra) {
    var s = { w: w, h: h, floors: floors, colors: colors, roof: roof, name: name, pop: pop };
    if (extra) {
      // 只合并额外字段（例如 flat:true），别把 undefined 写进规格
      Object.keys(extra).forEach(function (k) { s[k] = extra[k]; });
    }
    return s;
  }

  var NEW_SPECS = {
    // —— 政务区 ——
    gas_station: spec([3, 4], [2, 3], [1, 1], ['#3d4a52', '#414549'], '#2a2f33', '加油站', 10),
    gov_office: spec([5, 7], [4, 5], [6, 12], ['#33404f', '#384353', '#2f3a47'], '#222c38', '政务办公楼', 120),
    court: spec([5, 6], [4, 5], [3, 4], ['#3c4450', '#39414c'], '#262e38', '法院', 80),
    procuratorate: spec([4, 5], [3, 4], [4, 5], ['#39424e', '#364049'], '#242c36', '检察院', 60),
    supervision: spec([4, 5], [4, 4], [5, 6], ['#363f4a', '#333c47'], '#232a33', '监察委', 50),
    // —— 山区 ——
    mountain_lodge: spec([2, 3], [2, 3], [1, 2], ['#4c443a', '#544a3e'], '#332c24', '山林小屋', 4),
    forest_station: spec([3, 4], [3, 4], [1, 2], ['#3f4a38', '#3a4535'], '#283024', '护林站', 10),
    // —— 海湾 ——
    beach_hotel: spec([5, 6], [4, 5], [8, 14], ['#404a56', '#3b4652', '#37414d'], '#28313c', '海滨酒店', 160),
    pier: spec([4, 5], [2, 3], [0, 0], ['#3a3f41'], '#3a3f41', '码头', 0, { flat: true }),
    dock_warehouse: spec([4, 6], [3, 4], [1, 2], ['#3f4347', '#45403a'], '#2a2d30', '码头仓', 14)
  };

  D.BUILDING_SPECS = D.BUILDING_SPECS || {};
  Object.keys(NEW_SPECS).forEach(function (k) {
    if (!D.BUILDING_SPECS[k]) D.BUILDING_SPECS[k] = NEW_SPECS[k];  // 不覆盖已有规格
  });

  /* =======================================================================
     四、新建筑名字池（D.NAME_POOLS）
     地图的 nameFor(kind) 会从池子里挑名字；缺失时回退到 house 池，所以必须补。
     ======================================================================= */
  var NEW_POOLS = {
    gas_station: ['青石路加油站', '工业区加油站', '绕城高速加油站', '滨海公路加油站', '织雾山加油站'],
    gov_office: ['政务服务中心', '织雾市政务楼', '财政局办公楼', '城建局办公楼', '审计局办公楼'],
    court: ['最高人民法院', '织雾市中级人民法院', '城区人民法院'],
    procuratorate: ['最高人民检察院', '织雾市人民检察院'],
    supervision: ['监察委员会', '织雾市监察委'],
    mountain_lodge: ['山腰驿站', '松涛小屋', '护林人家', '半山茶棚'],
    forest_station: ['织雾山护林站', '北坡林场', '山火瞭望站'],
    beach_hotel: ['织雾湾海景酒店', '听涛度假酒店', '银滩宾馆'],
    pier: ['织雾湾码头', '渔人码头', '客运码头'],
    dock_warehouse: ['码头一号仓', '海湾冷库', '渔获转运仓']
  };

  D.NAME_POOLS = D.NAME_POOLS || {};
  Object.keys(NEW_POOLS).forEach(function (k) {
    if (!D.NAME_POOLS[k]) D.NAME_POOLS[k] = NEW_POOLS[k];
  });

  /* =======================================================================
     五、新警情（追加到 D.INCIDENTS，并同步索引 D.INCIDENT_BY_ID）
     约束：
       · needs 的键只能是 D.CAPS 的键：police / fire / medical / hazmat / rescue；
       · zones 只能是 D.DISTRICTS 的 id：city / industrial / country / prison /
         airport / gov / mountain / coast；
       · spotTags 只能用上面约定的地图 tag（或用 onRoad:true 落到道路格）；
       · finale 警情 weight:0 且 finale:true，普通随机池不会刷出它。
     数值口径沿用 data.js：window/work 秒，harm 死亡人数，damage 财产损失。
     全部为原创虚构游戏内容，不对应任何现实事件或人物。
     注意：任务清单里的 car_crash（交通事故）在 data.js 里已经存在，
     这里不再重复添加同名 id，否则会覆盖索引或产生重复警情。
     ======================================================================= */
  var NEW_INCIDENTS = [
    {
      id: 'mountain_fire', name: '山中大火', icon: '🔥', priority: 1, weight: 4,
      zones: ['mountain'], spotTags: ['mountain'],
      needs: { fire: 3, rescue: 1 }, window: 270, work: 64, harm: 2, damage: 650,
      spread: true, spreadEvery: 36, code: '山火',
      desc: '山脊上的松林起火了，风把火线往谷底村落方向推。进山只有一条盘山公路，隧道口已经被烟封住。',
      tip: '消防直升机不受路况限制，但整备慢；地面森林消防车要算上盘山时间。火线会持续蔓延。'
    },
    {
      id: 'drowning', name: '有人溺水', icon: '🌊', priority: 2, weight: 7,
      zones: ['mountain', 'coast'], spotTags: ['lake', 'beach', 'sea'],
      needs: { rescue: 2, medical: 2 }, window: 110, work: 30, harm: 2, damage: 40,
      code: '溺水',
      desc: '一名游客被离岸流带离浅水区，同伴在岸边呼救，救生圈已经抛出去但没抓住。',
      tip: '窗口很短。水上救援艇与医疗单元要同时到场——人救上来之后还需要现场急救。'
    },
    {
      id: 'police_car_theft', name: '警车被盗', icon: '🚓', priority: 1, weight: 3,
      zones: ['city', 'industrial'], onRoad: true,
      needs: { police: 3 }, window: 190, work: 48, harm: 1, damage: 520,
      code: '重案',
      desc: '一辆停在路边待修的警车被人开走。警车拉着警笛，路人下意识让行，追捕反而更难。',
      tip: '需要多组警力设卡与合围；追捕车速度最快，但单车警力只有 1 点。'
    },
    {
      id: 'shark_attack', name: '鲨鱼袭击', icon: '🦈', priority: 1, weight: 3,
      zones: ['coast'], spotTags: ['beach', 'sea'],
      needs: { rescue: 2, medical: 2 }, window: 120, work: 32, harm: 2, damage: 60,
      code: '海险',
      desc: '近岸泳区有人被大型鱼类咬伤，救生员已清空海面，伤者还在水里挣扎。',
      tip: '先由水上救援把人带回来，医疗组在沙滩上接手；不要派普通车辆冲进沙滩。'
    },
    {
      id: 'heli_theft', name: '直升机被盗', icon: '🚁', priority: 1, weight: 2,
      zones: ['airport'], spotTags: ['air_fuel', 'hangar'],
      needs: { police: 3, fire: 1 }, window: 200, work: 46, harm: 2, damage: 800,
      code: '航空',
      desc: '机场空中加油站旁，一架轻型直升机被人强行启动，旋翼已经开始转动，塔台反复呼叫无人应答。',
      tip: '警力先封住机坪与油料区，消防车在旁待命；一旦升空，追捕窗口就只剩几分钟。'
    },
    {
      id: 'plane_theft', name: '飞机被盗', icon: '✈️', priority: 1, weight: 2,
      zones: ['airport'], spotTags: ['runway', 'air_fuel'],
      needs: { police: 4, fire: 2 }, window: 235, work: 56, harm: 3, damage: 1200,
      code: '航空',
      desc: '一架停场的小型飞机滑出停机位，塔台发现驾驶舱里是没有授权的人，跑道灯被临时点亮。',
      tip: '警力封跑道、消防车守机位；如果飞机开始加速，处置时间只剩不到一分钟。'
    },
    {
      id: 'gas_station_fire', name: '加油站火灾', icon: '⛽', priority: 1, weight: 4,
      zones: ['city', 'industrial'], spotTags: ['gas_station'],
      needs: { fire: 3, hazmat: 1, medical: 2, police: 1 }, window: 185, work: 54, harm: 2, damage: 720,
      spread: true, spreadEvery: 35, code: '火警',
      desc: '一台加油机在加注时突然起火，火苗顺着油枪管路烧到雨棚，站里还有两辆车没有开走。',
      tip: '必须先断油断电再灭火，危化组确认油气浓度；人群疏散交给警力。'
    },
    {
      id: 'tunnel_collapse', name: '隧道坍塌', icon: '🚧', priority: 1, weight: 3,
      zones: ['mountain'], spotTags: ['tunnel'],
      needs: { fire: 3, rescue: 3, medical: 2, police: 1 }, window: 235, work: 62, harm: 3, damage: 850,
      code: '坍塌',
      desc: '盘山隧道顶部塌落，几辆车被堵在洞内，通风机停转，烟尘让能见度降到几乎为零。',
      tip: '破拆救援与灭火必须同时进入；隧道只有两个口，警力要先把两侧封住。'
    },
    {
      id: 'viaduct_tilt', name: '高架桥倾斜', icon: '🌉', priority: 1, weight: 2,
      zones: ['city', 'industrial'], onRoad: true,
      needs: { fire: 2, rescue: 2, police: 2 }, window: 200, work: 50, harm: 2, damage: 900,
      code: '结构',
      desc: '高架桥一段桥墩出现沉降，桥面肉眼可见地倾斜，双向车流还在往上开。',
      tip: '先把车流截断再谈处置；消防与救援负责固定与破拆，警力负责封路。'
    },
    {
      id: 'bridge_tilt', name: '大桥倾斜', icon: '🌉', priority: 1, weight: 2,
      zones: ['industrial', 'airport', 'coast'], spotTags: ['bridge'],
      needs: { fire: 2, rescue: 2, police: 2 }, window: 210, work: 52, harm: 2, damage: 1000,
      code: '结构',
      desc: '跨江大桥主跨出现异常位移，桥面接缝张开，桥上还有车辆在通行。',
      tip: '封桥是第一优先级，需要两组警力分流；消防与救援准备应对落水与被困。'
    },
    {
      id: 'corruption', name: '贪污腐败案', icon: '📁', priority: 1, weight: 2,
      zones: ['gov'], spotTags: ['central_gov', 'supervision', 'procuratorate', 'supreme_court'],
      needs: { police: 3 }, window: 320, work: 60, harm: 0, damage: 900,
      code: '调查',
      desc: '审计人员在例行核查时发现一笔采购款对不上账，线索指向政务区两处办公楼的合同附件。这是一起调查事件：需要警力协助调取账目、保全证据，而不是追捕。',
      tip: '窗口很长，但别让它冷掉：证据保全需要足够警力同时封存多处档案室。'
    },
    {
      id: 'argument', name: '邻里争吵', icon: '🗣️', priority: 3, weight: 12,
      zones: ['city', 'country'], kinds: ['shop', 'house', 'apartment', 'farmhouse'],
      needs: { police: 1 }, window: 85, work: 22, harm: 0, damage: 30,
      code: '治安',
      desc: '楼道里两户人家因为漏水问题吵起来，声音越来越大，已经有人开始推搡。',
      tip: '窗口很短但风险低，一辆巡逻车足够；别把重案单位派到这里。'
    },
    {
      id: 'supermarket_robbery', name: '超市抢劫', icon: '🛒', priority: 2, weight: 7,
      zones: ['city'], kinds: ['shop', 'mall'],
      needs: { police: 2 }, window: 150, work: 36, harm: 1, damage: 240,
      code: '重案',
      desc: '一名男子在超市收银台掏出器械抢走现金，逃跑时撞翻货架，店员被推倒受伤。',
      tip: '两组警力分别封控出入口与后仓；医疗需求很小，但别忘了被打伤的店员。'
    },
    {
      id: 'flood', name: '洪涝', icon: '🌧️', priority: 1, weight: 4,
      zones: ['coast', 'country'], kinds: ['farmhouse', 'field', 'warehouse', 'dock_warehouse', 'house'],
      needs: { fire: 2, rescue: 3, medical: 2, police: 1 }, window: 250, work: 58, harm: 2, damage: 520,
      spread: true, spreadEvery: 42, code: '洪涝',
      desc: '连续暴雨让低洼地带积水上涨，几处民房一层被淹，还有人站在屋顶等待转移。',
      tip: '救援能力是关键，水位每小时都在涨；消防与医疗负责排水后的次生处置。'
    },
    {
      id: 'tsunami', name: '海啸', icon: '🌊', priority: 1, weight: 0, finale: true,
      zones: ['coast'], spotTags: ['beach', 'sea'],
      needs: { fire: 3, rescue: 4, medical: 3, police: 2 }, window: 300, work: 70, harm: 4, damage: 1800,
      code: '海啸',
      desc: '海啸预警中心发出最高级别警报，织雾湾沿岸需要在一个潮周期内完成撤离与搜救准备。',
      tip: '这是大事件：四类力量必须同时到场，缺一组就无法推进处置。'
    },
    {
      id: 'tornado', name: '龙卷风', icon: '🌪️', priority: 1, weight: 3,
      zones: ['country', 'industrial'], kinds: ['farmhouse', 'barn', 'field', 'factory', 'warehouse'],
      needs: { fire: 3, rescue: 2, medical: 2 }, window: 210, work: 54, harm: 3, damage: 850,
      code: '风灾',
      desc: '一股龙卷擦过稻田与厂区，屋顶被掀开，输电线路倒伏在路面上。',
      tip: '先切断倒伏线路附近的通行，再处理被困人员；救援与灭火要同时进场。'
    },
    {
      id: 'typhoon', name: '台风', icon: '🌀', priority: 1, weight: 4,
      zones: ['coast', 'city'], kinds: ['apartment', 'office', 'shop', 'house', 'beach_hotel', 'dock_warehouse'],
      needs: { fire: 3, rescue: 2, medical: 3 }, window: 265, work: 60, harm: 2, damage: 950,
      spread: true, spreadEvery: 45, code: '风灾',
      desc: '台风正面登陆，广告牌与脚手架不断坠落，沿海几个小区停电，求救电话在排队。',
      tip: '需求点多但窗口较长；医疗要留出余量，风眼过后往往还有第二波。'
    },
    {
      id: 'lightning_strike', name: '雷击起火', icon: '⚡', priority: 2, weight: 7,
      zones: ['city', 'country'], kinds: ['house', 'apartment', 'office', 'farmhouse', 'barn'],
      needs: { fire: 2, medical: 1 }, window: 150, work: 36, harm: 1, damage: 220,
      code: '雷击',
      desc: '雷暴中一栋建筑的阁楼被击中起火，屋内有人被震倒，邻居正在敲门。',
      tip: '两辆消防力量能控制阁楼火，医疗组检查被震伤的人员；注意二次雷击。'
    },
    {
      id: 'electrical_leak', name: '漏电事故', icon: '🔌', priority: 2, weight: 8,
      zones: ['city', 'industrial'], kinds: ['house', 'apartment', 'shop', 'factory', 'warehouse'],
      needs: { fire: 1, rescue: 1 }, window: 140, work: 30, harm: 1, damage: 140,
      code: '电力',
      desc: '积水漫过配电箱，一段路面带电，已经有行人被击倒在台阶旁。',
      tip: '先断电再靠近；灭火与救援各一份即可，派云梯车反而浪费。'
    },
    {
      id: 'jumper', name: '有人跳楼', icon: '🆘', priority: 1, weight: 4,
      zones: ['city'], kinds: ['office', 'apartment', 'tower', 'mall'],
      needs: { police: 2, rescue: 2, medical: 2 }, window: 130, work: 40, harm: 2, damage: 40,
      code: '救援',
      desc: '一名男子坐在写字楼天台边缘，情绪激动，楼下已经围了很多人。',
      tip: '谈判与地面处置要同时进行：警力封控与谈判，救援组铺设救生气垫，医疗组待命。'
    },
    {
      id: 'school_bullying', name: '校园欺凌', icon: '🎒', priority: 3, weight: 8,
      zones: ['city', 'country'], kinds: ['school'],
      needs: { police: 1, medical: 1 }, window: 165, work: 28, harm: 0, damage: 20,
      code: '治安',
      desc: '放学后操场角落有几名学生围住一名同学，值班老师已经赶到但压不住场面。',
      tip: '警力到场先分开双方，医疗组检查是否受伤；低风险，别派重案单位。'
    },
    {
      id: 'highway_crash', name: '高速车祸', icon: '🚗', priority: 1, weight: 4,
      zones: ['city', 'industrial', 'country'], onRoad: true,
      needs: { police: 2, medical: 3, fire: 2 }, window: 170, work: 48, harm: 2, damage: 420,
      code: '车祸',
      desc: '绕城高速上一辆货车追尾前车后横在车道中间，后方车流还在高速接近。',
      tip: '警力先截流，消防负责破拆与防燃油起火，医疗组不够就调两辆救护车。'
    },
    {
      id: 'chem_spill_crash', name: '化学品泄漏车祸', icon: '☣️', priority: 1, weight: 2,
      zones: ['industrial', 'city'], onRoad: true,
      needs: { hazmat: 2, fire: 2, medical: 2, police: 1 }, window: 215, work: 56, harm: 2, damage: 950,
      code: '危化',
      desc: '一辆槽罐车在路口侧翻，罐体阀门渗漏，白色雾气顺着下风向飘向临街商铺。',
      tip: '必须先在上风向侦检并封路，再谈救人；危化 2 点只有危化车能凑齐。'
    }
  ];

  // data.js 已经建好 D.INCIDENT_BY_ID，这里只追加，不重建索引。
  D.INCIDENTS = D.INCIDENTS || [];
  D.INCIDENT_BY_ID = D.INCIDENT_BY_ID || {};
  var added = 0, skipped = [];
  NEW_INCIDENTS.forEach(function (inc) {
    if (D.INCIDENT_BY_ID[inc.id]) { skipped.push(inc.id); return; }   // 幂等：旧 id 绝不覆盖
    D.INCIDENTS.push(inc);
    D.INCIDENT_BY_ID[inc.id] = inc;
    added++;
  });

  /* =======================================================================
     六、完成标记
     Lead 的启动自检可以读这个标记，判断内容扩展是否成功加载。
     ======================================================================= */
  EM.data.CONTENT_EXPANSION_READY = true;

  if (root.console) {
    root.console.log('[content-expansion] 内容扩展已加载：单位 +' + NEW_UNITS.length +
      '，站点 +' + NEW_STATIONS.length + '，警情 +' + added +
      (skipped.length ? '（跳过重复 id：' + skipped.join(',') + '）' : '') + '。');
  }
})(typeof window !== 'undefined' ? window : this);
