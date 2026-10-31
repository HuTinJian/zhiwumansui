/* =========================================================================
   临界 · 紧急调度 — 核心模拟（接警 / 派遣 / 到场 / 处置 / 伤亡 / 评分 / 联机快照）
   说明：这是纯数据与逻辑层，不直接碰 DOM；单人与联机房主都跑它，客户端只替换快照。
   回退办法：删除 emergency/ 目录或 revert 提交；不涉及站内其它功能。
   ========================================================================= */
(function (root) {
  'use strict';
  var EM = root.EM = root.EM || {};
  var U = EM.util;
  var D = EM.data;
  var TILE = D.WORLD.TILE;

  function pickLine(lines, rng) { return lines[Math.floor(rng() * lines.length) % lines.length]; }

  function fmt(str, map) {
    return String(str).replace(/\{(\w+)\}/g, function (m, k) { return map[k] != null ? map[k] : m; });
  }

  function Simulation(opts) {
    opts = opts || {};
    this.world = opts.world;
    this.config = opts.config;
    this.mode = opts.mode || 'campaign';
    this.difficulty = opts.difficulty || D.DIFFICULTY.real;
    this.upgrades = opts.upgrades || [];
    this.players = opts.players || [{ id: 'p1', name: '指挥官', color: '#67dcff' }];
    this.remote = !!opts.remote;
    this.seed = opts.seed || this.world.seed || 112112;

    this.clock = 0;
    this.phase = 'active';       // active | ended | failed
    this.failed = false;
    this.funds = opts.funds != null ? opts.funds : (this.config.startFunds || 0);
    this.startFunds = this.funds;
    this.reputation = U.clamp((this.config.startRep || 80) + this.difficulty.repBonus, 1, 100);
    this.deaths = 0;
    this.score = 0;
    this.damage = 0;
    this.wave = 1;
    this.waveTimer = this.config.rampEvery || 75;
    this.spawnTimer = 0;
    this.finaleSpawned = false;
    this._lowRepWarned = false;

    this.incidents = [];
    this.units = [];
    this.unitById = {};
    this.incidentById = {};
    this.nextUnitId = 1;
    this.nextIncidentId = 1;

    this.radio = [];
    this.events = [];
    this.eventSeq = 0;
    this.summaryCalls = [];
    this.stats = {
      resolved: 0, failed: 0, dispatched: 0, totalCalls: 0,
      responseSum: 0, responseCount: 0, deaths: 0, damage: 0
    };

    this.buffs = {
      speed: this.hasUpgrade('up_speed') ? 1.12 : 1,
      firepower: this.hasUpgrade('up_firepower') ? 1.15 : 1,
      medical: this.hasUpgrade('up_medical') ? 1.15 : 1,
      restock: this.hasUpgrade('up_restock') ? 0.75 : 1
    };

    this._rng = U.mulberry32((U.hashString(String(this.seed)) ^ (this.config.index || 0) * 9973) >>> 0);
    if (!this.remote) {
      this.buildUnits();
      this.logRadio('指挥中心上线。' + (this.mode === 'coop' ? '联合作战频道已接入。' : '今晚由你值班。'), 'sys');
    }
  }

  Simulation.prototype.hasUpgrade = function (id) { return this.upgrades.indexOf(id) >= 0; };

  /* ---------------- 初始单位 ---------------- */
  Simulation.prototype.buildUnits = function () {
    var self = this;
    var stationByBuildingId = {};
    this.world.stations.forEach(function (st) { stationByBuildingId[st.id] = st; });
    this.world.stations.forEach(function (st) {
      st.units.forEach(function (type, i) {
        self.addUnit(type, st, i);
      });
    });
    // 补给站购买的增援
    this.upgrades.forEach(function (upId) {
      var up = D.UPGRADE_BY_ID[upId];
      if (!up || up.kind !== 'unit') return;
      var st = stationByBuildingId[up.station];
      if (!st) return;
      var extra = self.units.filter(function (u) { return u.homeStationId === st.id; }).length - st.units.length;
      self.addUnit(up.unit, st, Math.max(0, st.units.length + extra));
    });
  };

  Simulation.prototype.addUnit = function (type, station, slot) {
    var def = D.UNITS[type];
    if (!def) return null;
    var bay = station.bays[slot % Math.max(1, station.bays.length)] || station.bays[0] || { x: station.x, y: station.y, angle: 0 };
    var id = 'u' + (this.nextUnitId++);
    var unit = {
      id: id, type: type, def: def,
      x: bay.x, y: bay.y, angle: bay.angle || 0,
      status: 'idle', incidentId: null,
      path: null, pathIndex: 0,
      cooldown: 0,
      homeStationId: station.id,
      homeStationName: station.name,
      ownerId: null,
      rx: bay.x, ry: bay.y,
      flying: !!def.flying,
      dispatchedAt: 0
    };
    this.units.push(unit);
    this.unitById[id] = unit;
    return unit;
  };

  /* ---------------- 电台 / 事件 ---------------- */
  Simulation.prototype.logRadio = function (text, kind) {
    this.radio.push({ t: this.clock, text: text, kind: kind || 'info' });
    if (this.radio.length > 40) this.radio.shift();
  };
  Simulation.prototype.pushEvent = function (type, data) {
    var ev = Object.assign({ id: ++this.eventSeq, type: type, t: this.clock }, data || {});
    this.events.push(ev);
    if (this.events.length > 80) this.events.shift();
    return ev;
  };
  Simulation.prototype.drainEvents = function (afterId) {
    var out = [];
    for (var i = 0; i < this.events.length; i++) {
      if (this.events[i].id > afterId) out.push(this.events[i]);
    }
    return out;
  };
  Simulation.prototype.getLastEventId = function () {
    return this.events.length ? this.events[this.events.length - 1].id : 0;
  };

  /* ---------------- 警情生成 ---------------- */
  Simulation.prototype.canAfford = function (def) {
    var need = { police: 0, fire: 0, medical: 0, hazmat: 0, rescue: 0, engineering: 0 };
    var caps = { police: 0, fire: 0, medical: 0, hazmat: 0, rescue: 0, engineering: 0 };
    this.units.forEach(function (u) {
      Object.keys(u.def.caps).forEach(function (k) { caps[k] += u.def.caps[k]; });
    });
    this.incidents.forEach(function (inc) {
      if (inc.status !== 'active') return;
      Object.keys(inc.needs).forEach(function (k) { need[k] += inc.needs[k]; });
    });
    Object.keys(def.needs).forEach(function (k) { need[k] += def.needs[k]; });
    for (var i = 0; i < D.CAP_ORDER.length; i++) {
      var k = D.CAP_ORDER[i];
      if (need[k] > caps[k] * 1.15 + 2) return false;
    }
    return true;
  };

  /* 建筑级随机任务：从还没出事的建筑里选一栋，按建筑类别抽模板。
     这样住宅、商铺、工厂、学校、车站、码头等每一类建筑都能出事，而不是只有固定警情。 */
  Simulation.prototype.spawnBuildingIncident = function () {
    if (!D.BUILDING_TASK_TEMPLATES || !this.world) return null;
    var rng = this._rng;
    var excluded = this.activeBuildingIds();
    var candidates = this.world.buildings.filter(function (b) {
      return b && b.access && !excluded[b.id] && b.kind !== 'field' && b.kind !== 'runway';
    });
    if (!candidates.length) return null;
    for (var tries = 0; tries < 16; tries++) {
      var b = candidates[Math.floor(rng() * candidates.length)];
      var cat = (D.BUILDING_TASK_CATEGORIES && D.BUILDING_TASK_CATEGORIES[b.kind]) || 'generic';
      var templates = D.BUILDING_TASK_TEMPLATES[cat] || D.BUILDING_TASK_TEMPLATES.generic;
      var tpl = templates[Math.floor(rng() * templates.length)];
      if (!tpl || this.incidents.some(function (i) { return i.status === 'active' && i.defId === tpl.id; })) continue;
      var def = Object.assign({}, tpl);
      def.id = 'dyn_' + (this._dynSeq = (this._dynSeq || 0) + 1) + '_' + tpl.id;
      def.name = tpl.name;
      def.desc = String(tpl.desc || '').replace('{place}', b.name || '现场');
      def.zones = [b.zone];
      def.kinds = [b.kind];
      def.weight = 1;
      def.dynamic = true;
      if (!this.canAfford(def)) continue;
      var spot = {
        x: b.cx, y: b.cy, zone: b.zone, access: b.access,
        buildingId: b.id, label: b.name || (b.kind + '现场'), onRoad: false
      };
      var inc = this.spawnIncident(def, spot, {});
      if (inc) {
        this.lastDefId = def.id;
        return inc;
      }
    }
    return null;
  };

  Simulation.prototype.spawnRandom = function () {
    var rng = this._rng;
    // 45% 概率走“建筑级随机任务”，让所有建筑类型都有机会出任务
    if (rng() < 0.45) {
      var dyn = this.spawnBuildingIncident();
      if (dyn) return dyn;
    }
    var pool = D.INCIDENTS.filter(function (d) { return !d.finale && d.weight > 0; });
    var tries = 0;
    while (tries++ < 10) {
      var def = U.weightedPick(rng, pool, function (d) {
        var w = d.weight;
        if (d.id === this.lastDefId) w *= 0.22;
        return w;
      }.bind(this));
      if (!def) return null;
      if (this.incidents.some(function (inc) { return inc.status === 'active' && inc.defId === def.id; }) && def.priority === 1) continue;
      if (!this.canAfford(def)) continue;
      var spot = this.world.pickSpot(def, rng, this.activeBuildingIds());
      if (!spot) continue;
      this.lastDefId = def.id;
      return this.spawnIncident(def, spot, {});
    }
    // 实在找不到就下次再试
    return null;
  };

  Simulation.prototype.activeBuildingIds = function () {
    var ex = {};
    this.incidents.forEach(function (inc) { if (inc.status === 'active' && inc.buildingId) ex[inc.buildingId] = true; });
    return ex;
  };

  Simulation.prototype.spawnFinale = function () {
    var f = this.config.finale;
    if (!f || this.finaleSpawned) return;
    this.finaleSpawned = true;
    var defs = f.defs || (f.def ? [f.def] : []);
    var self = this;
    defs.forEach(function (defId, i) {
      var def = D.INCIDENT_BY_ID[defId];
      if (!def) return;
      var spot = self.world.pickSpot(def, self._rng, {});
      if (!spot) return;
      var inc = self.spawnIncident(def, spot, { finale: true });
      if (inc) {
        self.logRadio('【大事件】' + inc.label + '：' + def.name + '！所有单位注意。', 'alert');
        self.pushEvent('finale', { label: inc.label, name: def.name, priority: 1 });
      }
    });
  };

  Simulation.prototype.spawnIncident = function (def, spot, opt) {
    opt = opt || {};
    var diff = this.difficulty || D.DIFFICULTY.real;
    var windowScale = (this.config.windowScale || 1) * diff.windowScale * (opt.windowScale || 1);
    var inc = {
      id: 'i' + (this.nextIncidentId++),
      defId: def.id,
      name: def.name, icon: def.icon,
      priority: def.priority,
      code: def.code || '',
      desc: def.desc || '',
      tip: def.tip || '',
      needs: Object.assign({}, def.needs),
      zones: def.zones,
      x: spot.x, y: spot.y,
      access: spot.access,
      buildingId: spot.buildingId || null,
      label: spot.label,
      zone: spot.zone,
      onRoad: !!spot.onRoad,
      status: 'active',
      progress: 0,
      timeLeft: def.window * windowScale,
      maxTime: def.window * windowScale,
      work: def.work,
      harm: Math.max(0, Math.round((def.harm || 0) * diff.harmScale * (opt.harmScale || 1))),
      damage: Math.round((def.damage || 0) * (0.75 + (this.config.difficulty || 1) * 0.25)),
      spread: !!def.spread,
      spreadEvery: def.spreadEvery || 30,
      spreads: 0,
      lastSpread: this.clock,
      assigned: [],
      coverage: 0,
      provided: {},
      createdAt: this.clock,
      firstArrivalAt: null,
      endAt: null,
      finale: !!opt.finale,
      spreadFrom: opt.spreadFrom || null,
      // 追逐类警情：真实移动，不是原地假动画
      mobile: !!def.mobile,
      moveMode: def.moveMode || 'road',
      moveSpeed: def.moveSpeed || 48,
      chaseStop: def.chaseStop || 'police',
      stopped: false,
      chaseState: def.mobile ? 'moving' : '',
      heading: 0,
      movePath: null,
      moveIndex: 0,
      // 酒驾专属：拦下后先吹气检测，再决定配合还是突然逃跑
      drunkAttempts: 0,
      negotiating: false,
      testEndsAt: 0,
      drunkOutcome: '',
      drunkRetestAt: 0,
      // 现实模拟表：记录现场人员与单位的行为，随警情推进更新
      behavior: [],
      behaviorCategory: this.behaviorCategory(def),
      behaviorTick: 0,
      // 现场人物：平民/工人/旅客/伤者等，任务完成后也要显示去向
      people: []
    };
    this.incidents.push(inc);
    this.incidentById[inc.id] = inc;
    this.seedBehavior(inc, def);
    this.seedPeople(inc, def);
    if (inc.mobile) this.initChase(inc);
    this.stats.totalCalls++;
    this.pushEvent('spawn', { incidentId: inc.id, priority: inc.priority, label: inc.label, name: inc.name });
    var pr = D.PRIORITIES[inc.priority] || D.PRIORITIES[3];
    this.logRadio(fmt(pickLine(D.RADIO.spawn, this._rng), {
      place: inc.label, type: inc.name, priority: pr.label + ' ' + pr.name
    }), inc.priority === 1 ? 'alert' : 'warn');
    if (inc.priority === 1) this.pushEvent('critical', { label: inc.label });
    return inc;
  };

  /* ---------------- 现实模拟表（人物/单位行为日志） ---------------- */
  var BEHAVIOR = {
    fire: [
      { who: '被困居民', text: '浓烟从门缝灌进来，屋里有人在敲窗呼救。' },
      { who: '邻居', text: '邻居们退到街对面，有人试图提水但被热浪逼退。' },
      { who: '现场消防员', text: '消防员铺设水带，先搜救被困人员，再压制蔓延方向。' },
      { who: '围观者', text: '围观人群被警戒线挡在外侧，现场车辆开始让出通道。' }
    ],
    medical: [
      { who: '伤者', text: '伤者意识模糊，呼吸急促，家属在旁反复呼唤。' },
      { who: '家属', text: '家属情绪激动，急救员一边安抚一边询问病史。' },
      { who: '急救员', text: '急救员检查脉搏并建立临时处置区，准备转运。' },
      { who: '围观者', text: '周围群众被疏散，现场留出救护车通道。' }
    ],
    police: [
      { who: '报警人', text: '报警人躲在安全位置，压低声音说明现场情况。' },
      { who: '嫌疑人', text: '嫌疑人情绪不稳，正在观察周围警力部署。' },
      { who: '现场警员', text: '警员拉设警戒线，封锁出入口并疏散无关人员。' },
      { who: '目击者', text: '目击者交出手机录像，描述嫌疑人的体貌特征。' }
    ],
    water: [
      { who: '落水者', text: '落水者在浪里起伏，体力正在快速下降。' },
      { who: '岸边群众', text: '岸边群众把救生圈抛出去，但风浪把救生圈吹偏了。' },
      { who: '救援艇驾驶员', text: '救援艇顶着浪靠近，驾驶员不断修正方向。' },
      { who: '医护', text: '医护在岸边铺开保温毯，准备接手失温伤员。' }
    ],
    disaster: [
      { who: '居民', text: '居民拖家带口往高处转移，有人回头寻找失联的邻居。' },
      { who: '社区干部', text: '社区干部用扩音器喊话，组织人员逐栋排查。' },
      { who: '救援队', text: '救援队分成搜救和疏散两组，先处理被困人员。' },
      { who: '气象联络员', text: '气象联络员报告风力还在增强，现场作业窗口在缩短。' }
    ],
    traffic: [
      { who: '驾驶员', text: '驾驶员从变形的车门里探出手，后排乘客仍在呼救。' },
      { who: '路过司机', text: '路过司机把车停在事故点后方，打开双闪提醒后车。' },
      { who: '交警', text: '交警在来车方向摆开锥桶，开始临时交通管制。' },
      { who: '消防员', text: '消防员用破拆工具扩张车门，同时检查是否漏油。' }
    ],
    infra: [
      { who: '现场工人', text: '现场工人清点人数，确认还有人员没有撤出。' },
      { who: '路人', text: '路人被掉落的碎块逼退，现场灰尘很大。' },
      { who: '工程人员', text: '工程人员查看结构裂缝，要求所有人先撤到安全距离。' },
      { who: '救援队', text: '救援队从侧面开出一条通道，准备进入搜救。' }
    ],
    default: [
      { who: '报警人', text: '报警人留在现场附近，持续向指挥中心补充情况。' },
      { who: '现场群众', text: '现场群众被疏散到安全区域，等待进一步消息。' },
      { who: '处置人员', text: '处置人员到达后先评估现场，再展开具体行动。' }
    ]
  };

  Simulation.prototype.behaviorCategory = function (def) {
    var s = ((def && def.id) || '') + ' ' + ((def && def.name) || '') + ' ' + ((def && def.code) || '');
    if (/drown|shark|flood|tsunami|typhoon|tornado|wave|溺水|鲨鱼|洪涝|海啸|台风|龙卷风/.test(s)) return 'water';
    if (/fire|explosion|tank|chem|gas_|leak|火灾|爆炸|危化|泄漏/.test(s)) return 'fire';
    if (/crash|car_|highway|train|tunnel|bridge|viaduct|electrical|lightning|车祸|列车|隧道|桥|漏电|雷击/.test(s)) return 'traffic';
    if (/theft|robbery|fight|flee|drunk|hit_and_run|assault|jumper|bullying|corruption|argument|prison|police|盗|抢劫|冲突|逃|酒驾|跳楼|欺凌|腐败|争吵|监狱|警/.test(s)) return 'police';
    if (/poison|medical|injury|disease|food|食物|中毒|伤/.test(s)) return 'medical';
    if (/mountain|forest|山火|山林/.test(s)) return 'disaster';
    return 'default';
  };

  Simulation.prototype.addBehavior = function (inc, who, text, kind) {
    if (!inc || !inc.behavior) return;
    inc.behavior.push({ t: Math.round(this.clock * 10) / 10, who: who, text: text, kind: kind || 'person' });
    if (inc.behavior.length > 28) inc.behavior.shift();
  };

  Simulation.prototype.seedPeople = function (inc, def) {
    var zone = inc.zone || 'city';
    var roles = {
      city: ['居民', '路人', '店员'],
      industrial: ['工人', '技术员', '保安'],
      country: ['村民', '农户', '路人'],
      airport: ['旅客', '地勤'],
      prison: ['狱警', '囚犯'],
      gov: ['工作人员', '访客'],
      mountain: ['游客', '护林员'],
      coast: ['游客', '渔民']
    }[zone] || ['居民', '路人'];
    var n = 2 + Math.floor(this._rng() * 3);
    for (var i = 0; i < n; i++) {
      var ang = this._rng() * Math.PI * 2, rad = 18 + this._rng() * 34;
      var role = roles[Math.floor(this._rng() * roles.length) % roles.length];
      var state = '等待救援';
      if (role === '囚犯') state = '被控制';
      else if (/工人|地勤|狱警/.test(role)) state = '在岗';
      else if (i === 0) state = '等待救援';
      inc.people.push({
        id: 'p' + i,
        role: role,
        state: state,
        x: inc.x + Math.cos(ang) * rad,
        y: inc.y + Math.sin(ang) * rad
      });
    }
    var first = inc.people[0];
    if (first) this.addBehavior(inc, first.role, '在现场等待救援，情绪紧张，时不时朝路口张望。', 'person');
  };

  Simulation.prototype.setPeopleState = function (inc, resolved) {
    (inc.people || []).forEach(function (p) {
      if (/囚犯|嫌疑人/.test(p.role)) p.state = resolved ? '已被控制' : '趁乱脱离';
      else if (/伤|游客|旅客|居民|村民|路人|店员|工人/.test(p.role)) p.state = resolved ? '已安全转移 / 送医' : '伤亡或失联';
      else p.state = resolved ? '安全撤离' : '被困';
    });
  };

  Simulation.prototype.seedBehavior = function (inc, def) {
    var cat = inc.behaviorCategory || 'default';
    var pool = BEHAVIOR[cat] || BEHAVIOR.default;
    var rng = this._rng;
    var first = pool[Math.floor(rng() * pool.length) % pool.length];
    this.addBehavior(inc, first.who, first.text, 'person');
    this.addBehavior(inc, '指挥中心', '已接警，正在核对位置并调派最近的可用单位。', 'dispatch');
    inc.behaviorTick = 2 + rng() * 3;
  };

  Simulation.prototype.tickBehavior = function (inc, dt) {
    if (!inc.behavior) return;
    inc.behaviorTick -= dt;
    if (inc.behaviorTick > 0) return;
    inc.behaviorTick = 8 + this._rng() * 6;
    var cat = inc.behaviorCategory || 'default';
    var pool = BEHAVIOR[cat] || BEHAVIOR.default;
    var line = pool[Math.floor(this._rng() * pool.length) % pool.length];
    this.addBehavior(inc, line.who, line.text, 'person');
  };

  /* ---------------- 追逐类警情 ---------------- */
  Simulation.prototype.initChase = function (inc) {
    if (!inc.mobile || !this.world) { inc.mobile = false; return; }
    var w = this.world.W * TILE, h = this.world.H * TILE;
    var path = null;
    if (inc.moveMode === 'air') {
      // 飞行目标：向对角方向的地图边缘逃逸，单位用直升机/地面警力追
      var tx = inc.x < w / 2 ? w - 8 * TILE : 8 * TILE;
      var ty = inc.y < h / 2 ? h - 8 * TILE : 8 * TILE;
      path = [{ x: tx, y: ty }];
    } else {
      var cells = this.world.roadCells || [];
      var dest = null;
      for (var tries = 0; tries < 80 && cells.length; tries++) {
        var cell = cells[Math.floor(this._rng() * cells.length)];
        var p = this.world.cw(cell % this.world.W, (cell / this.world.W) | 0);
        if (U.dist(p.x, p.y, inc.x, inc.y) > TILE * 30) { dest = p; break; }
      }
      if (dest && inc.access) {
        path = this.world.findPath(inc.access.x, inc.access.y, dest.x, dest.y);
        if (path && path.length > 1) path = path.slice(1);
      }
    }
    if (!path || !path.length) { inc.mobile = false; inc.chaseState = ''; return; }
    inc.movePath = path;
    inc.moveIndex = 0;
    inc.stopped = false;
    inc.chaseState = 'moving';
    this.addBehavior(inc, inc.name + '目标', '突然加速离开原地，沿道路继续移动。', 'person');
    this.logRadio(inc.name + ' 正在移动，指挥中心持续追踪目标。', 'alert');
    this.pushEvent('chaseStart', { incidentId: inc.id, label: inc.label });
  };

  Simulation.prototype.moveChase = function (inc, dt) {
    if (!inc.mobile || inc.stopped || !inc.movePath) return;
    var remain = inc.moveSpeed * dt;
    while (remain > 0 && inc.moveIndex < inc.movePath.length) {
      var target = inc.movePath[inc.moveIndex];
      var dx = target.x - inc.x, dy = target.y - inc.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < 0.5) { inc.moveIndex++; continue; }
      inc.heading = Math.atan2(dy, dx);
      var step = Math.min(remain, d);
      inc.x += (dx / d) * step;
      inc.y += (dy / d) * step;
      remain -= step;
      if (d - step < 0.6) inc.moveIndex++;
    }
    // 道路追逐实时刷新“最近道路入口”，单位据此重新寻路
    if (this.world.nearestRoadCell) {
      var nr = this.world.nearestRoadCell(inc.x, inc.y, 14);
      if (nr) inc.access = this.world.cw(nr.x, nr.y);
    }
    if (inc.moveIndex >= inc.movePath.length) {
      inc.stopped = true;
      inc.chaseState = 'cornered';
      inc.movePath = null;
      this.logRadio(inc.name + ' 被逼入死角，等待拦截。', 'warn');
      this.pushEvent('chaseCornered', { incidentId: inc.id, label: inc.label });
    }
  };

  /* 酒驾：第一次拦停先做吹气检测；司机的心理反应决定被捕还是再次逃跑 */
  Simulation.prototype.startDrunkTest = function (inc, u) {
    inc.drunkAttempts = (inc.drunkAttempts || 0) + 1;
    inc.negotiating = true;
    inc.stopped = true;
    inc.movePath = null;
    inc.drunkOutcome = '';
    inc.chaseState = 'testing';
    inc.testEndsAt = this.clock + (inc.drunkAttempts === 1 ? 9 : 4);
    this.addBehavior(inc, '酒驾嫌疑人', '摇下车窗，手一直在抖，反复说“我就喝了一点，真没醉”。', 'person');
    this.addBehavior(inc, this.unitLabel(u), '拿出呼气式酒精检测仪，要求驾驶员配合吹气。', 'unit');
    this.logRadio('酒驾嫌疑人被 ' + this.unitLabel(u) + ' 拦下，正在吹气检测。司机手在抖，反复说“我就喝了一点”。', 'warn');
    this.pushEvent('drunkTest', { incidentId: inc.id, attempt: inc.drunkAttempts });
  };

  Simulation.prototype.resolveDrunkTest = function (inc) {
    inc.negotiating = false;
    var fled = inc.drunkAttempts <= 1 && this._rng() < 0.38;
    if (fled) {
      inc.stopped = false;
      inc.drunkOutcome = 'fled';
      inc.chaseState = 'fled';
      inc.drunkRetestAt = this.clock + 3.5;
      inc.moveSpeed = Math.max(inc.moveSpeed || 38, 64);
      this.addBehavior(inc, '酒驾嫌疑人', '吹到一半突然挂挡，猛打方向冲出去，现场警员被带得一个趔趄。', 'person');
      this.addBehavior(inc, '现场警员', '立即呼叫前方卡点，同时上车追击。', 'unit');
      this.logRadio('吹气到一半，司机突然挂挡冲了出去——他知道结果不会轻。目标再次逃窜。', 'alert');
      this.pushEvent('drunkFled', { incidentId: inc.id });
      this.initChase(inc);
      if (inc.mobile) { inc.chaseState = 'fled'; }
    } else {
      inc.stopped = true;
      inc.drunkOutcome = 'arrested';
      inc.chaseState = 'arrested';
      this.addBehavior(inc, '酒驾嫌疑人', '看到检测数值后沉默了几秒，最终低头承认喝了酒。', 'person');
      this.addBehavior(inc, '现场警员', '宣读检测结果，控制驾驶人并联系拖车。', 'unit');
      this.logRadio('吹气结果远超标准，司机低头承认。酒驾嫌疑人已被控制。', 'good');
      this.pushEvent('drunkArrested', { incidentId: inc.id });
    }
  };

  Simulation.prototype.setTactic = function (u, tactic, inc) {
    if (!u || !tactic || u.tactic === tactic) return;
    u.tactic = tactic;
    if (!inc) return;
    if (tactic === 'intercept') {
      this.addBehavior(inc, this.unitLabel(u), '判断目标前方有路口，提前脱离尾随，绕到前方设伏。', 'unit');
      this.logRadio(this.unitLabel(u) + ' 正在前方路口设伏。', 'warn');
      this.pushEvent('intercept', { incidentId: inc.id, unitId: u.id });
    } else if (tactic === 'pit') {
      this.addBehavior(inc, this.unitLabel(u), '贴近目标侧后方，寻找执行 PIT 的角度。', 'unit');
      this.logRadio(this.unitLabel(u) + ' 已贴近目标，准备 PIT。', 'alert');
      this.pushEvent('pitPrep', { incidentId: inc.id, unitId: u.id });
    } else if (tactic === 'chase') {
      this.addBehavior(inc, this.unitLabel(u), '保持在目标后方跟随，等待拦截时机。', 'unit');
    }
  };

  Simulation.prototype.tryPit = function (u, inc) {
    if (!u || !inc || !inc.mobile || inc.stopped) return false;
    if (!u.def.caps || !(u.def.caps.police > 0)) return false;
    // 酒驾第一次被拦：先让警员靠近做吹气，不要直接 PIT 跳过心理检测
    if (inc.defId === 'drunk_drive' && (inc.drunkAttempts || 0) === 0) return false;
    inc.stopped = true;
    inc.chaseState = 'pit';
    inc.movePath = null;
    inc.pitBy = u.id;
    this.addBehavior(inc, this.unitLabel(u), '从侧后方轻撞目标后翼子板，执行 PIT，目标车辆旋转失控。', 'unit');
    this.addBehavior(inc, '嫌疑人', '车辆被撞后打滑，试图反打方向失败，最终停在路边。', 'person');
    // 酒驾逃跑后被 PIT 撞停：按“被控制”收尾，不再显示成仍在逃
    if (inc.defId === 'drunk_drive') {
      inc.drunkOutcome = 'arrested';
      this.addBehavior(inc, '酒驾嫌疑人', '被撞停后仍想推门逃跑，被现场警员按住。', 'person');
    }
    this.logRadio(this.unitLabel(u) + ' 执行 PIT，目标被截停！', 'good');
    this.pushEvent('pit', { incidentId: inc.id, unitId: u.id });
    return true;
  };

  Simulation.prototype.repathChase = function (u, inc, force) {
    if (!inc) return;
    if (!force && this.clock - (u._chaseRepathAt || 0) < 1.1) return;
    u._chaseRepathAt = this.clock;
    var path;
    if (u.flying) {
      path = [{ x: inc.x, y: inc.y }];
      if (u.def.caps && u.def.caps.police) this.setTactic(u, U.dist(u.x, u.y, inc.x, inc.y) < TILE * 3 ? 'pit' : 'chase', inc);
    } else {
      var target = inc.access || this.world.cw(0, 0);
      // 警车 AI：如果目标前方的路点比当前位置更近，就去前方设伏；否则尾随。
      if (u.def.caps && u.def.caps.police && inc.movePath && inc.movePath.length && inc.moveMode !== 'air') {
        var ahead = inc.movePath[Math.min(inc.moveIndex + 4, inc.movePath.length - 1)];
        if (ahead) {
          var dAhead = U.dist(u.x, u.y, ahead.x, ahead.y);
          var dNow = U.dist(u.x, u.y, inc.x, inc.y);
          if (dAhead < dNow * 0.92) {
            target = ahead;
            this.setTactic(u, 'intercept', inc);
          } else {
            this.setTactic(u, 'chase', inc);
          }
        }
      }
      if (u.def.caps && u.def.caps.police && U.dist(u.x, u.y, inc.x, inc.y) < TILE * 1.7) {
        this.setTactic(u, 'pit', inc);
      }
      path = this.world.findPath(u.x, u.y, target.x, target.y);
    }
    if (path && path.length) { u.path = path; u.pathIndex = 0; }
  };

  /* ---------------- 派遣 ---------------- */
  Simulation.prototype.unitCaps = function (u) { return u.def.caps || {}; };

  Simulation.prototype.etaApprox = function (unit, incident) {
    var d = U.dist(unit.x, unit.y, incident.access.x, incident.access.y);
    if (unit.flying) return d / unit.def.speed;
    return d / (unit.def.speed * this.buffs.speed) * 1.24 + 1.2;
  };

  Simulation.prototype.dispatch = function (unitIds, incidentId, playerId) {
    var inc = this.incidentById[incidentId];
    if (!inc || inc.status !== 'active') return { ok: false, reason: '警情已经结束' };
    if (this.phase !== 'active') return { ok: false, reason: '行动已结束' };
    var dispatched = [], failed = [];
    for (var i = 0; i < unitIds.length; i++) {
      var u = this.unitById[unitIds[i]];
      if (!u) continue;
      if (u.status !== 'idle') { failed.push(u.id); continue; }
      var path;
      if (u.flying) {
        path = [{ x: inc.access.x, y: inc.access.y }];
      } else {
        path = this.world.findPath(u.x, u.y, inc.access.x, inc.access.y);
      }
      if (!path || !path.length) { failed.push(u.id); continue; }
      u.status = 'enroute';
      u.incidentId = inc.id;
      u.ownerId = playerId || u.ownerId || this.players[0].id;
      u.path = path;
      u.pathIndex = 0;
      u._chaseRepathAt = 0;
      u.tactic = inc.mobile ? 'chase' : '';
      u.dispatchedAt = this.clock;
      if (inc.assigned.indexOf(u.id) < 0) inc.assigned.push(u.id);
      dispatched.push(u);
      this.addBehavior(inc, this.unitLabel(u), '接到指令，出动前往现场。', 'unit');
      this.stats.dispatched++;
      var eta = Math.max(1, Math.round(this.etaApprox(u, inc)));
      this.logRadio(fmt(pickLine(D.RADIO.dispatch, this._rng), {
        unit: this.unitLabel(u), place: inc.label, eta: eta
      }), 'info');
      this.pushEvent('dispatch', { unitId: u.id, unitType: u.type, incidentId: inc.id });
    }
    if (!dispatched.length) {
      return { ok: false, reason: failed.length ? '选中的单位正在任务或整备中' : '没有可派遣的单位' };
    }
    return { ok: true, count: dispatched.length, failed: failed.length };
  };

  Simulation.prototype.unitLabel = function (u) {
    return (u.def.short || u.def.name) + ' ' + u.id.slice(1);
  };

  Simulation.prototype.recall = function (unitId) {
    var u = this.unitById[unitId];
    if (!u) return { ok: false, reason: '单位不存在' };
    if (u.status !== 'enroute' && u.status !== 'scene') return { ok: false, reason: '单位尚未出动' };
    var inc = u.incidentId ? this.incidentById[u.incidentId] : null;
    if (inc && inc.status === 'active') {
      var idx = inc.assigned.indexOf(u.id);
      if (idx >= 0) inc.assigned.splice(idx, 1);
    }
    this.sendHome(u);
    this.logRadio(this.unitLabel(u) + ' 撤离现场，返回基地。', 'warn');
    this.pushEvent('recall', { unitId: u.id });
    return { ok: true };
  };

  Simulation.prototype.recallAll = function (incidentId) {
    var inc = this.incidentById[incidentId];
    if (!inc) return 0;
    var n = 0;
    var self = this;
    inc.assigned.slice().forEach(function (uid) {
      if (self.recall(uid).ok) n++;
    });
    return n;
  };

  Simulation.prototype.sendHome = function (u) {
    u.incidentId = null;
    var st = this.world.stations.find(function (s) { return s.id === u.homeStationId; });
    var target = st ? st.access : { x: u.x, y: u.y };
    if (u.flying) {
      u.path = [{ x: target.x, y: target.y }];
    } else {
      var path = this.world.findPath(u.x, u.y, target.x, target.y);
      if (!path) {
        // 极端情况下先回到最近的道路，再沿路网返回；仍失败才退化为直线
        var nr = this.world.nearestRoadCell(u.x, u.y, 8);
        if (nr) {
          var nw = this.world.cw(nr.x, nr.y);
          path = this.world.findPath(nw.x, nw.y, target.x, target.y);
        }
      }
      u.path = path || [{ x: target.x, y: target.y }];
    }
    u.pathIndex = 0;
    u.status = 'returning';
  };

  /* 一键派遣：优先补齐当前缺口，按“贡献 / 预计到达”排序选单位 */
  Simulation.prototype.autoDispatch = function (incidentId, playerId) {
    var inc = this.incidentById[incidentId];
    if (!inc || inc.status !== 'active') return { ok: false, reason: '警情已经结束' };
    var committed = { police: 0, fire: 0, medical: 0, hazmat: 0, rescue: 0, engineering: 0 };
    inc.assigned.forEach(function (uid) {
      var u = this.unitById[uid];
      if (!u) return;
      if (u.status === 'enroute' || u.status === 'scene') {
        Object.keys(u.def.caps).forEach(function (k) { committed[k] += u.def.caps[k]; });
      }
    }, this);
    var remaining = {};
    Object.keys(inc.needs).forEach(function (k) {
      remaining[k] = Math.max(0, inc.needs[k] - (committed[k] || 0));
    });
    var chosen = [];
    var guard = 0;
    while (guard++ < 12) {
      var best = null, bestScore = 0;
      for (var i = 0; i < this.units.length; i++) {
        var u = this.units[i];
        if (u.status !== 'idle' || chosen.indexOf(u) >= 0) continue;
        var gain = 0;
        Object.keys(remaining).forEach(function (k) {
          if (remaining[k] > 0) gain += Math.min(remaining[k], (u.def.caps[k] || 0));
        });
        if (gain <= 0) continue;
        var eta = this.etaApprox(u, inc) + 1;
        var score = gain / eta;
        if (score > bestScore) { bestScore = score; best = u; }
      }
      if (!best) break;
      chosen.push(best);
      Object.keys(remaining).forEach(function (k) {
        remaining[k] = Math.max(0, remaining[k] - (best.def.caps[k] || 0));
      });
    }
    if (!chosen.length) {
      var anyReady = this.units.some(function (u) { return u.status === 'idle'; });
      return { ok: false, reason: anyReady ? '当前力量已覆盖需求或单位不匹配' : '没有待命单位，先等整备完成' };
    }
    var res = this.dispatch(chosen.map(function (u) { return u.id; }), inc.id, playerId);
    res.auto = true;
    // 按实际成功出发的单位重算缺口，避免“说已补齐、实际有人没出发”
    if (res.ok) {
      var committed2 = { police: 0, fire: 0, medical: 0, hazmat: 0, rescue: 0, engineering: 0 };
      inc.assigned.forEach(function (uid) {
        var u = this.unitById[uid];
        if (!u || (u.status !== 'enroute' && u.status !== 'scene')) return;
        Object.keys(u.def.caps).forEach(function (k) { committed2[k] = (committed2[k] || 0) + u.def.caps[k]; });
      }, this);
      var missing = false;
      Object.keys(inc.needs).forEach(function (k) {
        if ((committed2[k] || 0) < inc.needs[k]) missing = true;
      });
      res.missing = missing;
    }
    return res;
  };

  /* 一键派遣全部：按优先级给所有未结警情补齐缺口，不再要求先选中一条 */
  Simulation.prototype.autoDispatchAll = function (playerId) {
    var list = this.activeIncidents();
    var total = 0, handled = 0, details = [];
    for (var i = 0; i < list.length; i++) {
      var inc = list[i];
      var r = this.autoDispatch(inc.id, playerId);
      details.push({ id: inc.id, name: inc.name, ok: !!(r && r.ok), count: (r && r.count) || 0 });
      if (r && r.ok) { total += r.count || 0; handled++; }
    }
    return {
      ok: total > 0,
      count: total,
      incidents: handled,
      details: details,
      reason: total > 0 ? '' : '没有可派遣的单位，先等整备完成'
    };
  };

  /* ---------------- 覆盖与进度 ---------------- */
  Simulation.prototype.computeCoverage = function (inc) {
    var provided = { police: 0, fire: 0, medical: 0, hazmat: 0, rescue: 0, engineering: 0 };
    inc.assigned.forEach(function (uid) {
      var u = this.unitById[uid];
      if (!u || u.status !== 'scene') return;
      Object.keys(u.def.caps).forEach(function (k) { provided[k] += u.def.caps[k]; });
    }, this);
    var overall = 1;
    Object.keys(inc.needs).forEach(function (k) {
      var need = inc.needs[k];
      var got = provided[k] || 0;
      overall = Math.min(overall, need > 0 ? Math.min(1, got / need) : 1);
    });
    inc.provided = provided;
    inc.coverage = overall;
    return overall;
  };

  Simulation.prototype.efficiency = function (inc) {
    var eff = 0, n = 0;
    if (inc.needs.fire || inc.needs.hazmat || inc.needs.rescue) { eff += this.buffs.firepower; n++; }
    if (inc.needs.medical) { eff += this.buffs.medical; n++; }
    if (inc.needs.police) { eff += 1; n++; }
    return n ? eff / n : 1;
  };

  Simulation.prototype.resolveIncident = function (inc) {
    if (inc.status !== 'active') return;
    inc.status = 'resolved';
    inc.endAt = this.clock;
    this.addBehavior(inc, '现场负责人', '险情排除，现场移交，警戒逐步解除。', 'end');
    this.setPeopleState(inc, true);
    this.addBehavior(inc, '获救人员', '被转移到安全区域，有人披着保温毯回头看向现场。', 'end');
    var base = [0, 900, 520, 260][inc.priority] || 200;
    var speedRatio = Math.max(0, Math.min(1, inc.timeLeft / Math.max(1, inc.maxTime)));
    var gain = Math.round(base * (0.75 + speedRatio * 0.5));
    this.score += gain;
    inc.score = gain;
    this.stats.resolved++;
    var repGain = inc.priority === 1 ? 4 : inc.priority === 2 ? 2.5 : 1.5;
    this.reputation = U.clamp(this.reputation + repGain, 0, 100);
    var reward = Math.round(gain * 0.38);
    this.funds += reward;
    inc.reward = reward;
    if (inc.firstArrivalAt != null) {
      this.stats.responseSum += Math.max(0, inc.firstArrivalAt - inc.createdAt);
      this.stats.responseCount++;
    }
    this.summaryCalls.push({
      id: inc.id, name: inc.name, icon: inc.icon, label: inc.label,
      priority: inc.priority, status: 'resolved', time: inc.endAt,
      response: inc.firstArrivalAt != null ? Math.round(inc.firstArrivalAt - inc.createdAt) : null,
      score: gain, deaths: 0, damage: 0
    });
    // 现场单位收队
    var self = this;
    inc.assigned.slice().forEach(function (uid) {
      var u = self.unitById[uid];
      if (u && (u.status === 'scene' || u.status === 'enroute')) self.sendHome(u);
    });
    inc.assigned = [];
    this.logRadio(fmt(pickLine(D.RADIO.resolve, this._rng), { place: inc.label }), 'ok');
    this.pushEvent('resolve', { incidentId: inc.id, score: gain, label: inc.label });
    this.checkPhase();
  };

  Simulation.prototype.failIncident = function (inc) {
    if (inc.status !== 'active') return;
    inc.status = 'failed';
    inc.endAt = this.clock;
    this.addBehavior(inc, '现场负责人', '现场失控，救援窗口关闭，开始善后。', 'end');
    this.setPeopleState(inc, false);
    this.stats.failed++;
    this.deaths += inc.harm;
    this.stats.deaths = this.deaths;
    this.damage += inc.damage;
    this.stats.damage = this.damage;
    this.reputation = U.clamp(this.reputation - (inc.priority === 1 ? 14 : inc.priority === 2 ? 10 : 6), 0, 100);
    this.summaryCalls.push({
      id: inc.id, name: inc.name, icon: inc.icon, label: inc.label,
      priority: inc.priority, status: 'failed', time: inc.endAt,
      response: inc.firstArrivalAt != null ? Math.round(inc.firstArrivalAt - inc.createdAt) : null,
      score: 0, deaths: inc.harm, damage: inc.damage
    });
    var self = this;
    inc.assigned.slice().forEach(function (uid) {
      var u = self.unitById[uid];
      if (u && (u.status === 'scene' || u.status === 'enroute')) self.sendHome(u);
    });
    inc.assigned = [];
    this.logRadio(fmt(pickLine(D.RADIO.fail, this._rng), { place: inc.label }), 'alert');
    this.pushEvent('fail', {
      incidentId: inc.id, label: inc.label, harm: inc.harm,
      explosive: inc.defId === 'tank_fire' || inc.defId === 'chem_explosion' || inc.defId === 'highrise_fire'
    });
    this.checkPhase();
    if (this.reputation <= 30 && !this._lowRepWarned) {
      this._lowRepWarned = true;
      this.logRadio(pickLine(D.RADIO.lowrep, this._rng), 'warn');
    }
    if (this.reputation <= 0) {
      this.failed = true;
      this.phase = 'failed';
      this.pushEvent('defeat', { reason: 'reputation' });
    }
  };

  Simulation.prototype.checkPhase = function () {
    if (this.failed || this.phase !== 'active') return;
    var maxDeaths = this.config.maxDeaths != null ? this.config.maxDeaths : (this.difficulty.maxDeaths || 12);
    if (this.deaths >= maxDeaths) {
      this.failed = true;
      this.phase = 'failed';
      this.pushEvent('defeat', { reason: 'deaths', deaths: this.deaths });
      this.logRadio('伤亡数字超过城市承受上限，行动终止。', 'alert');
      return;
    }
    if (this.config.duration && this.clock >= this.config.duration && !this.incidents.some(function (i) { return i.status === 'active'; })) {
      this.phase = 'ended';
      this.pushEvent('shiftEnd', {});
      this.logRadio('交班时间到。指挥中心移交值班记录。', 'ok');
    }
  };

  /* ---------------- 单位移动 ---------------- */
  Simulation.prototype.moveAlongPath = function (u, dt) {
    if (!u.path || !u.path.length) return true;
    var speed = u.def.speed * this.buffs.speed;
    var remain = speed * dt;
    var guard = 0;
    while (remain > 0 && u.pathIndex < u.path.length && guard++ < 24) {
      var target = u.path[u.pathIndex];
      var dx = target.x - u.x, dy = target.y - u.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < 0.3) {
        u.x = target.x; u.y = target.y; u.pathIndex++;
        continue;
      }
      var ang = Math.atan2(dy, dx);
      u.angle = U.angleLerp(u.angle, ang, Math.min(1, dt * 8.5));
      var step = Math.min(remain, d);
      u.x += (dx / d) * step;
      u.y += (dy / d) * step;
      remain -= step;
      if (d - step < 0.4) { u.x = target.x; u.y = target.y; u.pathIndex++; }
    }
    return u.pathIndex >= u.path.length;
  };

  Simulation.prototype.arriveAtScene = function (u) {
    var inc = u.incidentId ? this.incidentById[u.incidentId] : null;
    if (!inc || inc.status !== 'active') { this.sendHome(u); return; }
    u.status = 'scene';
    u.path = null;
    u.pathIndex = 0;
    // 在入口点旁边错开停车，避免多辆车叠在一起
    var idx = inc.assigned.filter(function (uid) {
      var x = this.unitById[uid];
      return x && x.status === 'scene';
    }, this).length;
    var dx = inc.x - inc.access.x, dy = inc.y - inc.access.y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var px = -dy / len, py = dx / len;
    var off = (idx - 1) * 9;
    u.x = inc.access.x + px * off;
    u.y = inc.access.y + py * off;
    u.angle = Math.atan2(dy, dx);
    // 追逐类：第一个具备拦截能力的单位到达即“截停”，之后转为现场处置
    if (inc.mobile && !inc.stopped && u.def.caps && (u.def.caps[inc.chaseStop] || 0) > 0) {
      if (inc.defId === 'drunk_drive' && !inc.negotiating && inc.drunkOutcome !== 'arrested') {
        // 第一次逃跑后给驾驶员几秒“跑起来”的时间，不能原地立刻第二次吹气
        if (this.clock >= (inc.drunkRetestAt || 0)) this.startDrunkTest(inc, u);
      } else {
        inc.stopped = true;
        inc.chaseState = 'stopped';
        inc.movePath = null;
        this.addBehavior(inc, this.unitLabel(u), '在路口前完成拦截，目标车辆被逼停。', 'unit');
        this.logRadio(inc.name + ' 已被 ' + this.unitLabel(u) + ' 截停。', 'good');
        this.pushEvent('chaseStop', { incidentId: inc.id, unitId: u.id });
      }
    }
    this.addBehavior(inc, this.unitLabel(u), '到达现场，开始接管/警戒。', 'unit');
    if (inc.firstArrivalAt == null) {
      inc.firstArrivalAt = this.clock;
      this.logRadio(fmt(pickLine(D.RADIO.arrival, this._rng), {
        unit: this.unitLabel(u), place: inc.label
      }), 'info');
    }
    this.pushEvent('arrive', { unitId: u.id, incidentId: inc.id });
  };

  Simulation.prototype.returnArrived = function (u) {
    var st = this.world.stations.find(function (s) { return s.id === u.homeStationId; });
    if (st) {
      var bay = st.bays[u.id.charCodeAt(u.id.length - 1) % Math.max(1, st.bays.length)] || st.bays[0] || st.access;
      u.x = bay.x; u.y = bay.y; u.angle = bay.angle || 0;
    }
    u.status = 'resting';
    u.path = null;
    // 加油站/空中加油站加成：返场整备时间缩短，靠近油站的站点受益。
    var refuel = this.fuelBoost(u);
    u.cooldown = (u.def.restock || 12) * this.buffs.restock * (refuel ? (u.flying ? 0.55 : 0.68) : 1);
    u.refueled = refuel;
    u.incidentId = null;
  };

  Simulation.prototype.fuelBoost = function (u) {
    if (!this.world) return false;
    // 直升机只能在所属单位/基地整备补给，不能去外部加油站或航空油料库“顺手加油”
    if (u.flying) return false;
    var tag = 'gas_station';
    var list = [];
    if (this.world.buildings) list = list.concat(this.world.buildings);
    if (this.world.props) list = list.concat(this.world.props);
    var home = this.world.stations.find(function (s) { return s.id === u.homeStationId; });
    var hx = home && home.building ? home.building.cx : u.x;
    var hy = home && home.building ? home.building.cy : u.y;
    var maxD = 40 * (this.world.TILE || 32);
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (!b || b.tag !== tag) continue;
      var bx = b.cx != null ? b.cx : (b.x + (b.w || 1) / 2) * (this.world.TILE || 32);
      var by = b.cy != null ? b.cy : (b.y + (b.h || 1) / 2) * (this.world.TILE || 32);
      if (Math.sqrt((bx - hx) * (bx - hx) + (by - hy) * (by - hy)) <= maxD) return true;
    }
    return false;
  };

  Simulation.prototype.updateUnits = function (dt) {
    for (var i = 0; i < this.units.length; i++) {
      var u = this.units[i];
      if (u.status === 'enroute') {
        var chase = u.incidentId ? this.incidentById[u.incidentId] : null;
        if (chase && chase.mobile && !chase.stopped) {
          // 追逐目标在动：单位定期重新寻路，不能停在旧目标点
          this.repathChase(u, chase, false);
          if (u.tactic === 'pit' && U.dist(u.x, u.y, chase.x, chase.y) < TILE * 1.25) {
            if (this.tryPit(u, chase)) continue;
          }
        }
        if (u.flying) {
          var inc0 = chase;
          if (!inc0 || inc0.status !== 'active') { this.sendHome(u); continue; }
          var tx = (inc0.mobile && inc0.moveMode === 'air') ? inc0.x : inc0.access.x;
          var ty = (inc0.mobile && inc0.moveMode === 'air') ? inc0.y : inc0.access.y;
          var dx = tx - u.x, dy = ty - u.y;
          var dist = Math.sqrt(dx * dx + dy * dy);
          var sp = u.def.speed * this.buffs.speed;
          u.angle = Math.atan2(dy, dx);
          if (dist <= sp * dt) { u.x = tx; u.y = ty; u.pathIndex = 1; this.arriveAtScene(u); }
          else { u.x += (dx / dist) * sp * dt; u.y += (dy / dist) * sp * dt; }
        } else if (this.moveAlongPath(u, dt)) {
          var movedInc = u.incidentId ? this.incidentById[u.incidentId] : null;
          if (movedInc && movedInc.mobile) {
            // 到达的是旧位置：如果目标已经跑开，就继续追；截停后也要赶到最终位置
            var ax = movedInc.access ? movedInc.access.x : movedInc.x;
            var ay = movedInc.access ? movedInc.access.y : movedInc.y;
            if (U.dist(u.x, u.y, ax, ay) > TILE * 1.1) {
              this.repathChase(u, movedInc, true);
            } else {
              this.arriveAtScene(u);
            }
          } else {
            this.arriveAtScene(u);
          }
        }
      } else if (u.status === 'returning') {
        if (this.moveAlongPath(u, dt)) this.returnArrived(u);
      } else if (u.status === 'scene') {
        var ch = u.incidentId ? this.incidentById[u.incidentId] : null;
        if (ch && ch.mobile && !ch.stopped) {
          // 目标继续逃窜：现场单位重新上车追
          u.status = 'enroute';
          this.repathChase(u, ch, true);
        }
      } else if (u.status === 'resting') {
        u.cooldown -= dt;
        if (u.cooldown <= 0) { u.cooldown = 0; u.status = 'idle'; }
      }
      u.rx = u.x; u.ry = u.y;
    }
  };

  /* ---------------- 主更新 ---------------- */
  Simulation.prototype.step = function (dt) {
    if (this.remote) return;
    if (this.phase !== 'active') return;
    dt = Math.min(dt, 0.25);
    this.clock += dt;

    this.updateUnits(dt);

    // 追逐目标移动：先移动，再结算覆盖/倒计时
    for (var k = 0; k < this.incidents.length; k++) {
      var mi = this.incidents[k];
      if (mi.status === 'active' && mi.mobile && !mi.stopped) this.moveChase(mi, dt);
    }

    // 警情计时、覆盖、蔓延
    for (var i = this.incidents.length - 1; i >= 0; i--) {
      var inc = this.incidents[i];
      if (inc.status !== 'active') continue;
      this.tickBehavior(inc, dt);
      if (inc.defId === 'drunk_drive' && inc.negotiating && this.clock >= inc.testEndsAt) {
        this.resolveDrunkTest(inc);
      }
      if (inc.negotiating) {
        // 吹气检测期间不推进处置，但警情窗口仍在走
        inc.timeLeft -= dt;
        if (inc.timeLeft <= 0) { this.failIncident(inc); continue; }
        continue;
      }
      var cov = this.computeCoverage(inc);
      if (cov >= 0.999) {
        inc.progress = Math.min(100, inc.progress + (100 / inc.work) * this.efficiency(inc) * dt);
      } else {
        inc.timeLeft -= dt * (1 - cov * 0.72);
      }
      if (inc.progress >= 100) { this.resolveIncident(inc); continue; }
      if (inc.timeLeft <= 0) { this.failIncident(inc); continue; }
      if (inc.spread && cov < 0.999 && this.clock - inc.lastSpread > inc.spreadEvery && inc.spreads < 2) {
        inc.lastSpread = this.clock;
        this.trySpread(inc);
      }
    }

    this.updateSpawn(dt);
    this.checkPhase();
  };

  Simulation.prototype.trySpread = function (src) {
    // 交班后不再新增警情；力量预算不够时也不硬塞，避免制造“必然失败”的警情
    if (this.config.duration && this.clock >= this.config.duration) return;
    var activeCount = this.incidents.filter(function (i) { return i.status === 'active'; }).length;
    if (activeCount >= (this.config.maxActive || 4) + 2) return;
    var def = D.INCIDENT_BY_ID[src.zone === 'country' ? 'barn_fire' : 'house_fire'];
    if (!def || !this.canAfford(def)) return;
    // 寻找附近的建筑
    var self = this;
    var exclude = this.activeBuildingIds();
    var best = null, bd = 1e9;
    var rng = this._rng;
    this.world.buildings.forEach(function (b) {
      if (!b.access || exclude[b.id] || b.zone !== src.zone) return;
      var d = U.dist(b.cx, b.cy, src.x, src.y);
      if (d < TILE * 7 && d > TILE * 0.8 && d < bd) { bd = d; best = b; }
    });
    if (!best) return;
    var spot = {
      x: best.cx, y: best.cy, zone: best.zone, access: best.access,
      buildingId: best.id, label: best.name, onRoad: false
    };
    var inc = this.spawnIncident(def, spot, { windowScale: 0.62, spreadFrom: src.id, harmScale: 0.6 });
    if (!inc) return;
    src.spreads++;
    this.logRadio(fmt(pickLine(D.RADIO.spread, this._rng), { place: best.name }), 'alert');
    this.pushEvent('spread', { from: src.id, incidentId: inc.id, label: best.name });
  };

  Simulation.prototype.updateSpawn = function (dt) {
    var cfg = this.config;
    // 无尽波次：每帧计时，和是否刷出警情无关
    if (this.mode === 'endless') {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) {
        this.wave++;
        this.waveTimer = cfg.rampEvery || 75;
        this.logRadio('值班强度上升：第 ' + this.wave + ' 波警情。', 'warn');
        this.pushEvent('wave', { wave: this.wave });
      }
    }
    // 大事件
    if (cfg.finale && !this.finaleSpawned && cfg.duration && this.clock >= cfg.duration * (cfg.finale.at || 0.6)) {
      this.spawnFinale();
    }
    if (cfg.duration && this.clock >= cfg.duration) return;
    // 交班前 45 秒停止普通接警，给最后几单留出收尾时间
    if (cfg.duration && this.clock >= cfg.duration - 45) return;
    var active = this.incidents.filter(function (i) { return i.status === 'active'; }).length;
    var maxActive = cfg.maxActive || 4;
    if (this.mode === 'endless') {
      maxActive = Math.min(cfg.rampMaxActive || 7, (cfg.maxActive || 5) + Math.floor((this.wave - 1) / 3));
    }
    if (this.clock < (cfg.firstAt || 8)) return;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    if (active >= maxActive) { this.spawnTimer = 3; return; }
    var inc = this.spawnRandom();
    var base = U.randInt(this._rng, cfg.spawnMin || 24, cfg.spawnMax || 36);
    var scale = (this.difficulty.spawnScale || 1) / Math.sqrt(cfg.difficulty || 1);
    if (this.mode === 'endless') scale *= Math.pow(0.975, this.wave - 1);
    this.spawnTimer = Math.max(9, base * scale * (inc ? 1 : 0.4));
  };

  /* ---------------- 查询 ---------------- */
  Simulation.prototype.activeIncidents = function () {
    return this.incidents.filter(function (i) { return i.status === 'active'; })
      .sort(function (a, b) { return a.priority - b.priority || a.timeLeft - b.timeLeft; });
  };
  Simulation.prototype.incidentList = function () {
    return this.incidents.filter(function (i) { return i.status === 'active'; });
  };
  Simulation.prototype.readyCount = function () {
    return this.units.filter(function (u) { return u.status === 'idle'; }).length;
  };
  Simulation.prototype.findUnit = function (id) { return this.unitById[id]; };
  Simulation.prototype.findIncident = function (id) { return this.incidentById[id]; };

  Simulation.prototype.needLabels = function (inc) {
    var out = [];
    Object.keys(inc.needs).forEach(function (k) {
      if (D.CAPS[k]) out.push({ key: k, name: D.CAPS[k].name, need: inc.needs[k], got: (inc.provided && inc.provided[k]) || 0, icon: D.CAPS[k].icon, color: D.CAPS[k].color });
    });
    return out;
  };

  /* ---------------- 快照 / 联机 ---------------- */
  Simulation.prototype.snapshot = function () {
    var self = this;
    return {
      t: this.clock, phase: this.phase, failed: this.failed,
      funds: this.funds, reputation: this.reputation, deaths: this.deaths,
      score: this.score, damage: this.damage, wave: this.wave,
      stats: this.stats,
      incidents: this.incidents.map(function (inc) {
        return {
          id: inc.id, defId: inc.defId, name: inc.name, icon: inc.icon, priority: inc.priority,
          code: inc.code, desc: inc.desc, tip: inc.tip, needs: inc.needs,
          x: Math.round(inc.x), y: Math.round(inc.y),
          access: { x: Math.round(inc.access.x), y: Math.round(inc.access.y), cx: inc.access.cx, cy: inc.access.cy },
          buildingId: inc.buildingId, label: inc.label, zone: inc.zone, onRoad: inc.onRoad,
          status: inc.status, progress: Math.round(inc.progress * 10) / 10,
          timeLeft: Math.round(inc.timeLeft * 10) / 10, maxTime: inc.maxTime,
          harm: inc.harm, damage: inc.damage, assigned: inc.assigned.slice(),
          mobile: !!inc.mobile, stopped: !!inc.stopped, chaseState: inc.chaseState || '', heading: inc.heading || 0,
          drunkAttempts: inc.drunkAttempts || 0, negotiating: !!inc.negotiating,
          drunkOutcome: inc.drunkOutcome || '', testEndsAt: inc.testEndsAt || 0,
          behavior: (inc.behavior || []).slice(-20),
          people: (inc.people || []).map(function (p) { return { role: p.role, state: p.state, x: Math.round(p.x), y: Math.round(p.y) }; }),
          coverage: Math.round(inc.coverage * 100) / 100, provided: inc.provided,
          createdAt: inc.createdAt, firstArrivalAt: inc.firstArrivalAt, endAt: inc.endAt,
          finale: inc.finale
        };
      }),
      units: this.units.map(function (u) {
        return {
          id: u.id, type: u.type, x: Math.round(u.x * 10) / 10, y: Math.round(u.y * 10) / 10,
          angle: Math.round(u.angle * 100) / 100, status: u.status,
          incidentId: u.incidentId, cooldown: Math.round(u.cooldown * 10) / 10,
          ownerId: u.ownerId, homeStationId: u.homeStationId, homeStationName: u.homeStationName
        };
      }),
      radio: this.radio.slice(-9),
      events: this.events.slice(-25),
      summaryCalls: this.summaryCalls
    };
  };

  Simulation.prototype.applySnapshot = function (snap) {
    this.clock = snap.t;
    this.phase = snap.phase;
    this.failed = snap.failed;
    this.funds = snap.funds;
    this.reputation = snap.reputation;
    this.deaths = snap.deaths;
    this.score = snap.score;
    this.damage = snap.damage;
    this.wave = snap.wave;
    this.stats = snap.stats;
    this.radio = snap.radio || [];
    this.events = snap.events || [];
    this.summaryCalls = snap.summaryCalls || [];
    // 事件去重由上层用 lastEventId 处理
    var units = [];
    var unitById = {};
    (snap.units || []).forEach(function (s) {
      var def = D.UNITS[s.type] || D.UNITS.cruiser;
      var prev = this.unitById ? this.unitById[s.id] : null;
      var u = {
        id: s.id, type: s.type, def: def,
        // rx/ry 是本机显示位置，tx/ty 是服务器目标；主循环负责平滑
        x: prev ? prev.x : s.x, y: prev ? prev.y : s.y,
        tx: s.x, ty: s.y, ta: s.angle,
        angle: prev ? prev.angle : s.angle, status: s.status,
        incidentId: s.incidentId, cooldown: s.cooldown,
        ownerId: s.ownerId, homeStationId: s.homeStationId, homeStationName: s.homeStationName,
        rx: prev ? prev.rx : s.x, ry: prev ? prev.ry : s.y,
        path: null, pathIndex: 0, flying: !!def.flying,
        tactic: s.tactic || ''
      };
      units.push(u); unitById[u.id] = u;
    }, this);
    this.units = units;
    this.unitById = unitById;
    var incidents = [];
    var incidentById = {};
    (snap.incidents || []).forEach(function (s) {
      var inc = Object.assign({}, s);
      incidents.push(inc); incidentById[inc.id] = inc;
    });
    this.incidents = incidents;
    this.incidentById = incidentById;
  };

  Simulation.prototype.getSummary = function () {
    var grade = 'D';
    var ratio = 0;
    var total = this.stats.resolved + this.stats.failed;
    if (total > 0) ratio = this.stats.resolved / total;
    // 伤亡会压低评级：每死 1 人扣 3%，最多扣 35%
    ratio = Math.max(0, ratio - Math.min(0.35, this.deaths * 0.03));
    if (this.failed) { grade = 'D'; }
    else {
      var thresholds = D.GRADES;
      for (var i = 0; i < thresholds.length; i++) {
        if (ratio >= thresholds[i].min) { grade = thresholds[i].grade; break; }
      }
    }
    return {
      mode: this.mode, phase: this.phase, failed: this.failed,
      clock: this.clock, funds: this.funds, startFunds: this.startFunds,
      score: this.score, reputation: this.reputation, deaths: this.deaths,
      damage: this.damage, stats: this.stats, calls: this.summaryCalls,
      resolvedRatio: ratio, grade: grade,
      avgResponse: this.stats.responseCount ? this.stats.responseSum / this.stats.responseCount : null,
      wave: this.wave
    };
  };

  EM.sim = {
    Simulation: Simulation,
    create: function (opts) { return new Simulation(opts); }
  };
})(window);
