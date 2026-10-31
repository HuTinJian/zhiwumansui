/* =========================================================================
   临界 · 紧急调度 — 临江市地图生成器（确定性、零依赖）
   内容：地形 / 河流 / 道路网 / 建筑 / 站点 / 地标 / 道路寻路 A* / 警情落点
   回退办法：删除 emergency/ 目录或 revert；不会改动网站其它文件。
   说明：地图由种子完全确定，联机客户端用同一 seed 生成相同城市，只同步动态状态。
   ========================================================================= */
(function (root) {
  'use strict';
  var EM = root.EM = root.EM || {};
  var U = EM.util;
  var D = EM.data;

  var W = D.WORLD.W, H = D.WORLD.H, TILE = D.WORLD.TILE;
  var N = W * H;

  var ZONE_NAMES = { 0: '', 1: 'city', 2: 'industrial', 3: 'country', 4: 'prison', 5: 'airport' };

  function MapGen(seed) {
    this.seed = seed >>> 0;
    this.rng = U.mulberry32(this.seed || 112112);
    this.W = W; this.H = H; this.TILE = TILE;
    this.road = new Uint8Array(N);
    this.bridge = new Uint8Array(N);
    this.water = new Uint8Array(N);
    this.occ = new Uint8Array(N);
    this.ground = new Uint8Array(N);
    this.zone = new Uint8Array(N);
    this.roadName = new Array(N);
    this.roadNameKind = new Uint8Array(N);
    this.buildings = [];
    this.buildingsById = {};
    this.stations = [];
    this.landmarks = {};
    this.props = [];
    this.trees = [];
    this.lamps = [];
    this.parkedCars = [];
    this.specials = {};
    this.roadCells = [];
    this.trafficCells = [];
    this.nameUsed = {};
    this._bid = 0;
    this.bounds = {};
  }
  MapGen.prototype.idx = function (x, y) { return y * W + x; };
  MapGen.prototype.inb = function (x, y) { return x >= 0 && y >= 0 && x < W && y < H; };
  MapGen.prototype.cw = function (cx, cy) { return { x: cx * TILE + TILE / 2, y: cy * TILE + TILE / 2 }; };
  MapGen.prototype.zoneAtCell = function (x, y) { return this.inb(x, y) ? this.zone[this.idx(x, y)] : 0; };

  /* ---------------- 基础地形 ---------------- */
  MapGen.prototype.paintTerrain = function () {
    var self = this, rng = this.rng, i, x, y;
    this.ground.fill(0);
    // 底色：草地的细微色差在地图渲染时做，这里只存类型
    var zones = D.DISTRICTS;
    for (i = 0; i < zones.length; i++) {
      var d = zones[i];
      var zid = { city: 1, industrial: 2, country: 3, prison: 4, airport: 5 }[d.id];
      for (y = d.y; y < d.y + d.h; y++) {
        for (x = d.x; x < d.x + d.w; x++) {
          if (!self.inb(x, y)) continue;
          var idx = self.idx(x, y);
          self.zone[idx] = zid;
          self.ground[idx] = (d.id === 'city' || d.id === 'industrial') ? 1 : (d.id === 'airport' || d.id === 'prison') ? 4 : 3;
        }
      }
    }
    // 工业区地面更深、更脏
    for (y = 3; y < 48; y++) for (x = 72; x < 137; x++) if (self.zone[self.idx(x, y)] === 2) self.ground[self.idx(x, y)] = 2;

    // 河流：正弦带状，穿过地图
    for (x = -3; x < W + 4; x++) {
      var cy = 54.3 + Math.sin(x * 0.083) * 2.2;
      var half = 3.1 + Math.sin(x * 0.21 + 1.1) * 0.7;
      for (y = Math.floor(cy - half); y <= Math.ceil(cy + half); y++) {
        if (!self.inb(x, y)) continue;
        var ii = self.idx(x, y);
        self.water[ii] = 1;
        self.ground[ii] = 6;
        self.occ[ii] = 1;
      }
    }
    // 河岸沙地
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      var ix = self.idx(x, y);
      if (self.water[ix]) continue;
      var near = false;
      for (var dy = -1; dy <= 1 && !near; dy++) for (var dx = -1; dx <= 1; dx++) {
        if (self.water[self.idx(U.clamp(x + dx, 0, W - 1), U.clamp(y + dy, 0, H - 1))]) { near = true; break; }
      }
      if (near && self.ground[ix] !== 4) self.ground[ix] = 7;
    }
    // 乡下树林与田块
    for (i = 0; i < 450; i++) {
      var tx = U.randInt(rng, 3, 58), ty = U.randInt(rng, 60, 96);
      var ti = self.idx(tx, ty);
      if (self.water[ti] || self.ground[ti] === 1 || self.ground[ti] === 2) continue;
      if (rng() < 0.72) self.ground[ti] = 5;
    }
    // 城外沿江林地
    for (i = 0; i < 160; i++) {
      var fx = U.randInt(rng, 2, 136), fy = U.randInt(rng, 56, 60);
      var fi = self.idx(fx, fy);
      if (!self.water[fi] && self.ground[fi] !== 4) self.ground[fi] = 5;
    }
    // 城区少量街心绿地
    for (i = 0; i < 40; i++) {
      var gx = U.randInt(rng, 10, 62), gy = U.randInt(rng, 10, 46);
      var gi = self.idx(gx, gy);
      if (self.ground[gi] === 1 && rng() < 0.5) self.ground[gi] = 3;
    }
  };

  /* ---------------- 道路 ---------------- */
  MapGen.prototype.stamp = function (x1, y1, x2, y2, width, kind, name) {
    var self = this;
    var offs;
    if (width <= 1) offs = [0];
    else if (width === 2) offs = [-1, 0];
    else offs = [-1, 0, 1];
    var vertical = x1 === x2;
    var a = vertical ? Math.min(y1, y2) : Math.min(x1, x2);
    var b = vertical ? Math.max(y1, y2) : Math.max(x1, x2);
    for (var t = a; t <= b; t++) {
      for (var oi = 0; oi < offs.length; oi++) {
        var o = offs[oi];
        var cx = vertical ? x1 + o : t;
        var cy = vertical ? t : y1 + o;
        if (!self.inb(cx, cy)) continue;
        var idx = self.idx(cx, cy);
        if (self.water[idx]) self.bridge[idx] = 1;
        if (kind > self.road[idx]) self.road[idx] = kind;
        self.occ[idx] = 1;
        if (name && kind >= self.roadNameKind[idx]) {
          self.roadName[idx] = name;
          self.roadNameKind[idx] = kind;
        }
      }
    }
  };

  MapGen.prototype.buildRoads = function () {
    var s = this;
    // 城区主干 + 支路
    var cityV = [[8, '望江路'], [22, '中山路'], [36, '和平路'], [50, '建设路'], [64, '城东大道']];
    var cityH = [[8, '环城北路'], [22, '临江大道'], [36, '人民路'], [47, '滨江路']];
    cityV.forEach(function (r) { s.stamp(r[0], 5, r[0], 50, 3, 3, r[1]); });
    cityH.forEach(function (r) { s.stamp(6, r[0], 66, r[0], 3, 3, r[1]); });
    [15, 29, 43, 57].forEach(function (x) { s.stamp(x, 8, x, 47, 1, 1, ''); });
    [15, 29, 41].forEach(function (y) { s.stamp(8, y, 64, y, 1, 1, ''); });
    // 工业区
    var indV = [[78, '工业大道'], [92, '兴业路'], [106, '机场快速路'], [120, '化工路'], [134, '临港路']];
    var indH = [[8, '北环路'], [22, '工业二路'], [34, '沿江路'], [45, '港区路']];
    indV.forEach(function (r) { s.stamp(r[0], 5, r[0], 47, 3, 3, r[1]); });
    indH.forEach(function (r) { s.stamp(74, r[0], 138, r[0], 3, 3, r[1]); });
    [85, 99, 113, 127].forEach(function (x) { s.stamp(x, 8, x, 45, 1, 1, ''); });
    [15, 28, 40].forEach(function (y) { s.stamp(74, y, 138, y, 1, 1, ''); });
    // 横贯城市与工业区的两条大动脉
    s.stamp(6, 8, 138, 8, 3, 3, '环城北路');
    s.stamp(6, 22, 138, 22, 3, 3, '临江大道');
    // 跨江与南部路网
    s.stamp(22, 47, 22, 97, 3, 3, '稻香路');
    s.stamp(50, 47, 50, 72, 2, 2, '河堤路');
    s.stamp(106, 45, 106, 70, 3, 3, '机场快速路');
    s.stamp(6, 62, 136, 62, 3, 3, '南环路');
    s.stamp(6, 76, 58, 76, 1, 1, '稻香街');
    s.stamp(6, 90, 58, 90, 1, 1, '新村路');
    [10, 34, 46].forEach(function (x) { s.stamp(x, 62, x, 92, 1, 1, ''); });
    [70, 84].forEach(function (y) { s.stamp(6, y, 58, y, 1, 4, ''); }); // 土路
    s.stamp(16, 62, 16, 92, 1, 4, '');
    s.stamp(40, 62, 40, 92, 1, 4, '');
    // 监狱支路 + 环形通道
    s.stamp(72, 62, 72, 77, 2, 2, '白岩路');
    s.stamp(64, 77, 80, 77, 1, 1, '');
    s.stamp(64, 94, 80, 94, 1, 1, '');
    s.stamp(64, 77, 64, 94, 1, 1, '');
    s.stamp(80, 77, 80, 94, 1, 1, '');
    // 机场道路
    s.stamp(88, 70, 136, 70, 2, 2, '机场路');
    s.stamp(90, 70, 90, 92, 1, 1, '');
    s.stamp(134, 70, 134, 92, 1, 1, '');
    s.stamp(90, 80, 134, 80, 1, 1, '');
    s.stamp(90, 92, 136, 92, 1, 1, '');
    s.stamp(120, 70, 120, 80, 1, 1, '');

    // 汇总道路单元（供寻路和车流使用）
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var idx = this.idx(x, y);
      if (this.road[idx]) {
        this.roadCells.push(idx);
        if (this.road[idx] >= 2) this.trafficCells.push(idx);
      }
    }
  };

  /* ---------------- 建筑与地标 ---------------- */
  MapGen.prototype.freeRect = function (x, y, w, h, margin) {
    margin = margin || 0;
    for (var yy = y - margin; yy < y + h + margin; yy++) {
      for (var xx = x - margin; xx < x + w + margin; xx++) {
        if (!this.inb(xx, yy)) return false;
        if (this.occ[this.idx(xx, yy)]) return false;
      }
    }
    return true;
  };

  MapGen.prototype.roadNearRect = function (x, y, w, h, radius) {
    radius = radius == null ? 4 : radius;
    var best = null, bd = 1e9;
    var cx = x + w / 2, cy = y + h / 2;
    for (var yy = y - radius; yy < y + h + radius; yy++) {
      for (var xx = x - radius; xx < x + w + radius; xx++) {
        if (!this.inb(xx, yy)) continue;
        // 只接受建筑外部的道路
        if (xx >= x && xx < x + w && yy >= y && yy < y + h) continue;
        var idx = this.idx(xx, yy);
        if (!this.road[idx]) continue;
        var d = (xx + 0.5 - cx) * (xx + 0.5 - cx) + (yy + 0.5 - cy) * (yy + 0.5 - cy);
        if (d < bd) { bd = d; best = { cx: xx, cy: yy }; }
      }
    }
    if (!best) return null;
    var world = this.cw(best.cx, best.cy);
    return { x: world.x, y: world.y, cx: best.cx, cy: best.cy };
  };

  MapGen.prototype.nameFor = function (kind) {
    var pool = D.NAME_POOLS[kind] || D.NAME_POOLS.house;
    var base = U.pick(this.rng, pool);
    var name = base;
    if (this.nameUsed[name]) {
      var n = 2;
      while (this.nameUsed[base + ' ' + n]) n++;
      name = base + ' ' + n;
    }
    this.nameUsed[name] = true;
    return name;
  };

  MapGen.prototype.addBuilding = function (opt) {
    var x = opt.x, y = opt.y, w = opt.w, h = opt.h;
    if (!this.freeRect(x, y, w, h, 0)) return null;
    var access = this.roadNearRect(x, y, w, h, opt.radius == null ? 4 : opt.radius);
    if (opt.needRoad !== false && !access) return null;
    var spec = D.BUILDING_SPECS[opt.kind] || D.BUILDING_SPECS.house;
    var color = opt.color || spec.colors[Math.floor(this.rng() * spec.colors.length)];
    var b = {
      id: 'b' + (++this._bid),
      x: x, y: y, w: w, h: h,
      cx: (x + w / 2) * TILE,
      cy: (y + h / 2) * TILE,
      kind: opt.kind,
      name: opt.name || this.nameFor(opt.kind),
      zone: ZONE_NAMES[this.zoneAtCell(Math.floor(x + w / 2), Math.floor(y + h / 2))] || 'city',
      floors: opt.floors != null ? opt.floors : U.randInt(this.rng, spec.floors[0], spec.floors[1]),
      color: color,
      roof: opt.roof || spec.roof,
      pop: spec.pop || 0,
      access: access,
      tag: opt.tag || null,
      landmark: !!opt.landmark,
      stationId: opt.stationId || null,
      flat: opt.flat != null ? !!opt.flat : (!!spec.flat || opt.kind === 'field'),
      round: !!spec.round,
      seed: Math.floor(this.rng() * 1e9)
    };
    for (var yy = y; yy < y + h; yy++) for (var xx = x; xx < x + w; xx++) {
      this.occ[this.idx(xx, yy)] = 2;
      this.ground[this.idx(xx, yy)] = 4;
    }
    this.buildings.push(b);
    this.buildingsById[b.id] = b;
    if (b.tag) {
      if (!this.landmarks[b.tag]) this.landmarks[b.tag] = [];
      this.landmarks[b.tag].push(b);
    }
    return b;
  };

  MapGen.prototype.findFreeNear = function (ax, ay, w, h, radius) {
    for (var r = 0; r <= (radius || 10); r++) {
      for (var dy = -r; dy <= r; dy++) {
        for (var dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          var x = ax + dx, y = ay + dy;
          if (this.freeRect(x, y, w, h, 0)) return { x: x, y: y };
        }
      }
    }
    return null;
  };

  MapGen.prototype.placeLandmark = function (ax, ay, w, h, opt) {
    var pos = this.findFreeNear(Math.round(ax), Math.round(ay), w, h, opt.radius || 12);
    if (!pos) {
      console.warn('[map] landmark placement failed:', opt.name || opt.kind, ax, ay);
      return null;
    }
    return this.addBuilding(Object.assign({ x: pos.x, y: pos.y, w: w, h: h, landmark: true }, opt));
  };

  MapGen.prototype.markProp = function (p) {
    for (var y = p.y; y < p.y + p.h; y++) for (var x = p.x; x < p.x + p.w; x++) {
      if (!this.inb(x, y)) continue;
      var idx = this.idx(x, y);
      if (!this.road[idx] && this.occ[idx] === 0) this.occ[idx] = 3;
    }
  };

  MapGen.prototype.addGeneric = function (kind, count, district, opts) {
    var spec = D.BUILDING_SPECS[kind];
    if (!spec) return 0;
    var placed = 0, attempts = 0;
    while (placed < count && attempts < count * 120) {
      attempts++;
      var w = U.randInt(this.rng, spec.w[0], spec.w[1]);
      var h = U.randInt(this.rng, spec.h[0], spec.h[1]);
      var x = U.randInt(this.rng, district.x + 1, district.x + district.w - w - 2);
      var y = U.randInt(this.rng, district.y + 1, district.y + district.h - h - 2);
      if (!this.freeRect(x, y, w, h, opts && opts.margin || 0)) continue;
      var access = this.roadNearRect(x, y, w, h, 4);
      if (!access) continue;
      var b = this.addBuilding({
        x: x, y: y, w: w, h: h, kind: kind,
        floors: U.randInt(this.rng, spec.floors[0], spec.floors[1]),
        color: spec.colors[Math.floor(this.rng() * spec.colors.length)]
      });
      if (b) placed++;
    }
    return placed;
  };

  MapGen.prototype.buildPlaces = function () {
    var self = this, rng = this.rng;
    var city = D.DISTRICTS[0], ind = D.DISTRICTS[1], country = D.DISTRICTS[2];

    /* ---- 城区地标 ---- */
    // 市公安局（也作为警力站点）
    this.placeLandmark(16, 10, 5, 4, { kind: 'police_hq', name: '临江市公安局', tag: 'police_hq', stationId: 'police_hq' });
    // 中央消防站
    this.placeLandmark(24, 16, 5, 4, { kind: 'fire_station', name: '中央消防站', stationId: 'fire_central', color: '#4a3a33', roof: '#2e231f' });
    // 第一医院
    this.placeLandmark(30, 30, 5, 4, { kind: 'hospital', name: '临江市第一医院', tag: 'hospital', stationId: 'hospital_main' });
    // 紧急医疗中心
    this.placeLandmark(10, 38, 4, 3, { kind: 'hospital', name: '紧急医疗中心', stationId: 'ems_center', color: '#39444f', roof: '#27313a' });
    // 临江广场（商场）
    this.placeLandmark(44, 24, 5, 5, { kind: 'mall', name: '临江广场', tag: 'mall' });
    // 第三中学
    this.placeLandmark(52, 30, 5, 4, { kind: 'school', name: '临江市第三中学', tag: 'school' });
    // 临江大厦
    this.placeLandmark(10, 24, 4, 4, { kind: 'office', name: '临江大厦' });
    // 中心广场（视觉公园）
    var plaza = { kind: 'park', x: 30, y: 10, w: 4, h: 4, name: '中心广场' };
    this.props.push(plaza); this.markProp(plaza);

    /* ---- 工业区 ---- */
    this.placeLandmark(94, 16, 5, 4, { kind: 'fire_station', name: '工业区消防站', stationId: 'fire_industrial', color: '#443a33', roof: '#2b2420' });
    this.placeLandmark(94, 24, 4, 3, { kind: 'police_hq', name: '工业区派出所', stationId: 'police_industrial', tag: 'police_sub', color: '#343f4b', roof: '#242d37' });
    // 化工厂与罐区
    this.placeLandmark(122, 10, 5, 4, { kind: 'chemical', name: '临江化工厂', tag: 'chemical' });
    this.placeLandmark(122, 16, 3, 3, { kind: 'tank', name: '化工罐区 · 一号罐', tag: 'tank', color: '#5b5a45' });
    this.placeLandmark(128, 10, 3, 3, { kind: 'tank', name: '化工罐区 · 二号罐', tag: 'tank', color: '#5d5643' });
    this.placeLandmark(128, 16, 3, 3, { kind: 'tank', name: '液氨储罐', tag: 'tank', color: '#5a5d46' });
    var chemApron = { kind: 'apron', x: 121, y: 20, w: 10, h: 6, name: '化工装卸区' };
    this.props.push(chemApron); this.markProp(chemApron);

    /* ---- 乡下 ---- */
    this.placeLandmark(11, 84, 4, 3, { kind: 'hospital', name: '稻香乡卫生院', stationId: 'clinic_country', color: '#3d4742', roof: '#29312d' });
    this.placeLandmark(26, 70, 4, 4, { kind: 'barn', name: '稻香谷仓', tag: 'barn_large' });
    this.placeLandmark(38, 86, 4, 3, { kind: 'farmhouse', name: '河湾农舍' });

    /* ---- 白岩监狱 ---- */
    var prison = { x: 63, y: 76, w: 19, h: 19 };
    this.specials.prison = prison;
    this.placeLandmark(66, 79, 6, 4, { kind: 'prison_block', name: '白岩监狱 A 区', tag: 'prison_block', floors: 2 });
    this.placeLandmark(66, 85, 6, 4, { kind: 'prison_block', name: '白岩监狱 B 区', tag: 'prison_block', floors: 2 });
    this.placeLandmark(73, 79, 6, 4, { kind: 'prison_block', name: '白岩监狱 C 区', tag: 'prison_block', floors: 2 });
    this.placeLandmark(73, 85, 5, 5, { kind: 'prison_yard', name: '白岩监狱放风场', tag: 'prison_yard', needRoad: true });
    this.placeLandmark(65, 78, 2, 2, { kind: 'tower', name: '一号瞭望塔', tag: 'guard_tower', needRoad: false, floors: 6 });
    this.placeLandmark(78, 92, 2, 2, { kind: 'tower', name: '二号瞭望塔', tag: 'guard_tower', needRoad: false, floors: 6 });

    /* ---- 机场 ---- */
    this.placeLandmark(102, 73, 10, 4, { kind: 'terminal', name: 'T2 航站楼', tag: 'terminal' });
    this.placeLandmark(99, 72, 2, 2, { kind: 'tower', name: '机场塔台', tag: 'tower', floors: 8 });
    this.placeLandmark(126, 73, 6, 4, { kind: 'hangar', name: '一号机库', tag: 'hangar' });
    this.placeLandmark(91, 73, 5, 4, { kind: 'cargo', name: '航空货运站', tag: 'cargo' });
    this.placeLandmark(96, 73, 3, 2, { kind: 'police_hq', name: '机场警务站', stationId: 'police_airport', color: '#343f4b', roof: '#242d37' });
    this.placeLandmark(122, 73, 4, 3, { kind: 'fire_station', name: '机场消防站', stationId: 'fire_airport', color: '#443a33', roof: '#2b2420' });
    var runway = this.addBuilding({
      x: 94, y: 87, w: 40, h: 4, kind: 'runway', name: '机场跑道 09', tag: 'runway',
      floors: 0, flat: true, needRoad: false, color: '#2c3238', roof: '#2c3238'
    });
    this.specials.airport = { runway: runway ? { x: 94, y: 87, w: 40, h: 4 } : null };
    [{ kind: 'apron', x: 92, y: 81, w: 44, h: 5, name: '停机坪' },
      { kind: 'taxiway', x: 94, y: 85, w: 40, h: 2, name: '滑行道' },
      { kind: 'apron', x: 90, y: 70, w: 46, h: 2, name: '机场前场' }].forEach(function (p) {
        self.props.push(p); self.markProp(p);
      });

    /* ---- 城区 / 工业区 / 乡下的普通建筑 ---- */
    this.addGeneric('house', 40, city, { margin: 0 });
    this.addGeneric('apartment', 26, city, {});
    this.addGeneric('shop', 22, city, {});
    this.addGeneric('office', 15, city, {});
    this.addGeneric('warehouse', 3, city, {});
    this.addGeneric('school', 1, city, {});
    this.addGeneric('factory', 16, ind, {});
    this.addGeneric('warehouse', 18, ind, {});
    this.addGeneric('office', 5, ind, {});
    this.addGeneric('house', 4, ind, {});
    this.addGeneric('farmhouse', 22, country, { margin: 0 });
    this.addGeneric('barn', 12, country, { margin: 0 });
    this.addGeneric('field', 20, country, { margin: 0 });

    // 小公园 / 停车场：挑空位填充城市细节；用 occ=3 占位避免互相重叠
    var self2 = this;
    function fillProps(kind, count) {
      for (var i = 0; i < count; i++) {
        for (var t = 0; t < 100; t++) {
          var w = U.randInt(rng, 3, 6), h = U.randInt(rng, 3, 6);
          var x = U.randInt(rng, 10, 62 - w), y = U.randInt(rng, 10, 46 - h);
          if (!self2.freeRect(x, y, w, h, 1)) continue;
          for (var yy = y; yy < y + h; yy++) for (var xx = x; xx < x + w; xx++) {
            self2.occ[self2.idx(xx, yy)] = 3;
          }
          self2.props.push({ kind: kind, x: x, y: y, w: w, h: h });
          break;
        }
      }
    }
    fillProps('park', 10);
    fillProps('parking', 12);

    // 地标缺失时的兜底：避免警情找不到落点
    if (!this.landmarks.terminal) {
      this.placeLandmark(102, 73, 8, 4, { kind: 'terminal', name: 'T2 航站楼', tag: 'terminal' });
    }
  };

  /* ---------------- 站点与停车位 ---------------- */
  MapGen.prototype.buildStations = function () {
    var self = this;
    D.STATIONS.forEach(function (st) {
      var b = self.buildings.find(function (x) { return x.stationId === st.id; });
      if (!b) {
        // 兜底：在锚点附近强行找位置（可能会挪动一点）
        var pos = self.findFreeNear(st.x, st.y, st.w, st.h, 14);
        if (!pos) { console.warn('[map] station anchor unavailable:', st.id); return; }
        b = self.addBuilding({ x: pos.x, y: pos.y, w: st.w, h: st.h, kind: st.type === 'fire' ? 'fire_station' : st.type === 'police' ? 'police_hq' : 'hospital', name: st.name, stationId: st.id });
        if (!b) {
          console.warn('[map] station building failed, retrying without road requirement:', st.id);
          b = self.addBuilding({ x: pos.x, y: pos.y, w: st.w, h: st.h, kind: st.type === 'fire' ? 'fire_station' : st.type === 'police' ? 'police_hq' : 'hospital', name: st.name, stationId: st.id, needRoad: false });
        }
        if (!b) { console.warn('[map] station dropped:', st.id); return; }
      }
      b.floors = st.type === 'fire' ? 2 : (b.floors || 3);
      var access = b.access || self.roadNearRect(b.x, b.y, b.w, b.h, 5);
      if (!access) { console.warn('[map] station has no road access:', st.id); return; }
      var station = {
        id: st.id, type: st.type, name: st.name, building: b,
        access: access, x: access.x, y: access.y,
        bays: [], units: st.units.slice(), zone: b.zone
      };
      var dx = b.cx - access.x, dy = b.cy - access.y;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var ux = dx / len, uy = dy / len;
      var px = -uy, py = ux;
      for (var i = 0; i < station.units.length; i++) {
        var off = (i - (station.units.length - 1) / 2) * 15;
        station.bays.push({
          x: access.x + ux * 22 + px * off,
          y: access.y + uy * 22 + py * off,
          angle: Math.atan2(-uy, -ux)
        });
      }
      self.stations.push(station);
    });
  };

  /* ---------------- 道路连通性 / 寻路 ---------------- */
  MapGen.prototype.nearestRoadCell = function (wx, wy, maxR) {
    var cx = Math.floor(wx / TILE), cy = Math.floor(wy / TILE);
    maxR = maxR || 10;
    if (this.inb(cx, cy) && this.road[this.idx(cx, cy)]) return { x: cx, y: cy };
    for (var r = 1; r <= maxR; r++) {
      var best = null, bd = 1e9;
      for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        var x = cx + dx, y = cy + dy;
        if (!this.inb(x, y)) continue;
        var idx = this.idx(x, y);
        if (!this.road[idx]) continue;
        var d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = { x: x, y: y }; }
      }
      if (best) return best;
    }
    return null;
  };

  MapGen.prototype.computeReach = function () {
    this.reachable = new Uint8Array(N);
    if (!this.roadCells.length) return;
    var start = this.roadCells[0];
    var q = [start], head = 0;
    this.reachable[start] = 1;
    var dirs = [1, -1, W, -W];
    while (head < q.length) {
      var cur = q[head++];
      var cx = cur % W, cy = (cur / W) | 0;
      for (var d = 0; d < 4; d++) {
        var nx = cx + (d === 0 ? 1 : d === 1 ? -1 : 0);
        var ny = cy + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (!this.inb(nx, ny)) continue;
        var ni = this.idx(nx, ny);
        if (!this.road[ni] || this.reachable[ni]) continue;
        this.reachable[ni] = 1; q.push(ni);
      }
    }
    // 只保留与主路网相连的建筑落点
    var self = this;
    this.buildings.forEach(function (b) {
      if (!b.access) return;
      if (!self.reachable[self.idx(b.access.cx, b.access.cy)]) b.access = null;
    });
    this.stations.forEach(function (st) {
      if (!st.access || !self.reachable[self.idx(st.access.cx, st.access.cy)]) st.broken = true;
    });
  };

  /* A*：在道路格上找路，返回世界坐标折线 */
  MapGen.prototype.findPath = function (fromX, fromY, toX, toY) {
    var a = this.nearestRoadCell(fromX, fromY, 8);
    var b = this.nearestRoadCell(toX, toY, 8);
    if (!a || !b) return null;
    var start = this.idx(a.x, a.y), goal = this.idx(b.x, b.y);
    if (start === goal) {
      var p0 = this.cw(a.x, a.y);
      return [{ x: p0.x, y: p0.y }];
    }
    var gScore = new Float32Array(N);
    gScore.fill(Infinity);
    gScore[start] = 0;
    var came = new Int32Array(N).fill(-1);
    var open = [start];
    var fScore = new Float32Array(N);
    fScore.fill(Infinity);
    var gx = goal % W, gy = (goal / W) | 0;
    fScore[start] = Math.abs(a.x - gx) + Math.abs(a.y - gy);
    var closed = new Uint8Array(N);
    var found = false;
    var costOf = [0, 1.2, 1.08, 1, 1.4]; // local / secondary / arterial / dirt
    while (open.length) {
      // 简易二叉堆
      var bi = 0;
      for (var i = 1; i < open.length; i++) if (fScore[open[i]] < fScore[open[bi]]) bi = i;
      var cur = open.splice(bi, 1)[0];
      if (cur === goal) { found = true; break; }
      if (closed[cur]) continue;
      closed[cur] = 1;
      var cx = cur % W, cy = (cur / W) | 0;
      var neigh = [
        cx > 0 ? cur - 1 : -1, cx < W - 1 ? cur + 1 : -1,
        cy > 0 ? cur - W : -1, cy < H - 1 ? cur + W : -1
      ];
      for (var k = 0; k < 4; k++) {
        var ni = neigh[k];
        if (ni < 0 || !this.road[ni] || closed[ni]) continue;
        var step = costOf[this.road[ni]] || 1.2;
        var tentative = gScore[cur] + step;
        if (tentative < gScore[ni] - 1e-6) {
          gScore[ni] = tentative;
          came[ni] = cur;
          var nx = ni % W, ny = (ni / W) | 0;
          fScore[ni] = tentative + Math.abs(nx - gx) + Math.abs(ny - gy);
          open.push(ni);
        }
      }
    }
    if (!found) return null;
    var cells = [];
    var c = goal;
    var guard = 0;
    while (c !== -1 && guard++ < N) { cells.push(c); if (c === start) break; c = came[c]; }
    cells.reverse();
    var pts = cells.map(function (idx) {
      return self_pt(this, idx);
    }, this);
    // 去掉共线的中间点，让车辆走得更自然
    var out = [];
    for (var j = 0; j < pts.length; j++) {
      if (j > 0 && j < pts.length - 1) {
        var p1 = pts[j - 1], p2 = pts[j], p3 = pts[j + 1];
        var cross = (p2.x - p1.x) * (p3.y - p2.y) - (p2.y - p1.y) * (p3.x - p2.x);
        if (Math.abs(cross) < 0.01) continue;
      }
      out.push(pts[j]);
    }
    return out;
  };

  function self_pt(world, idx) {
    var x = idx % W, y = (idx / W) | 0;
    return { x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 };
  }

  /* ---------------- 装饰物 ---------------- */
  MapGen.prototype.buildDecor = function () {
    var rng = this.rng, self = this, i, x, y, idx;
    // 树：优先乡下、公园、江边
    var tries = 0;
    while (this.trees.length < 430 && tries < 3000) {
      tries++;
      x = U.randInt(rng, 2, W - 3); y = U.randInt(rng, 2, H - 3);
      idx = this.idx(x, y);
      if (this.occ[idx] || this.water[idx]) continue;
      var g = this.ground[idx];
      var p = 0.06;
      if (g === 5) p = 0.85;
      else if (g === 3) p = 0.25;
      else if (g === 0) p = 0.18;
      else if (g === 1) p = 0.03;
      if (rng() > p) continue;
      this.trees.push({
        x: x * TILE + U.randInt(rng, 4, 28),
        y: y * TILE + U.randInt(rng, 4, 28),
        r: U.randInt(rng, 7, 14),
        shade: rng()
      });
    }
    // 街灯：主干道每隔几格放一盏
    for (i = 0; i < this.roadCells.length; i++) {
      var ci = this.roadCells[i];
      if (this.road[ci] < 3) continue;
      if (i % 7 !== 0) continue;
      var cx = ci % W, cy = (ci / W) | 0;
      if (this.bridge[ci]) continue;
      this.lamps.push({ x: cx * TILE + TILE / 2, y: cy * TILE + TILE / 2, seed: i });
    }
    // 停车场里的车
    this.props.forEach(function (pr) {
      if (pr.kind !== 'parking') return;
      for (var yy = pr.y; yy < pr.y + pr.h; yy++) for (var xx = pr.x; xx < pr.x + pr.w; xx++) {
        if (!self.inb(xx, yy) || self.occ[self.idx(xx, yy)]) continue;
        if (rng() < 0.28) {
          self.parkedCars.push({
            x: xx * TILE + TILE / 2 + U.randInt(rng, -6, 6),
            y: yy * TILE + TILE / 2 + U.randInt(rng, -6, 6),
            a: rng() < 0.5 ? 0 : Math.PI / 2,
            c: ['#7d8894', '#8a7f72', '#66727e', '#9b8d7a', '#59636e'][Math.floor(rng() * 5)]
          });
        }
      }
    });
  };

  /* ---------------- 外部接口 ---------------- */
  MapGen.prototype.zoneAt = function (wx, wy) {
    var x = U.clamp(Math.floor(wx / TILE), 0, W - 1);
    var y = U.clamp(Math.floor(wy / TILE), 0, H - 1);
    return ZONE_NAMES[this.zone[this.idx(x, y)]] || 'city';
  };

  MapGen.prototype.districtAt = function (x, y) {
    for (var i = 0; i < D.DISTRICTS.length; i++) {
      var d = D.DISTRICTS[i];
      if (x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h) return d;
    }
    return null;
  };

  MapGen.prototype.roadNameAt = function (wx, wy) {
    var x = Math.floor(wx / TILE), y = Math.floor(wy / TILE);
    if (!this.inb(x, y)) return '';
    return this.roadName[this.idx(x, y)] || '';
  };

  MapGen.prototype.pickSpot = function (def, rng, exclude) {
    var self = this, i, tried = 0;
    exclude = exclude || {};
    if (def.onRoad) {
      var zones = def.zones || [];
      var picked = null;
      for (var t = 0; t < 250 && !picked; t++) {
        var ci = this.trafficCells[Math.floor(rng() * this.trafficCells.length)];
        if (ci == null) break;
        var cx = ci % W, cy = (ci / W) | 0;
        var z = ZONE_NAMES[this.zone[ci]];
        if (zones.indexOf(z) < 0) continue;
        if (this.road[ci] < 2) continue;
        picked = { cx: cx, cy: cy };
      }
      if (!picked) {
        for (var t2 = 0; t2 < 120 && !picked; t2++) {
          var ci2 = this.roadCells[Math.floor(rng() * this.roadCells.length)];
          var cx2 = ci2 % W, cy2 = (ci2 / W) | 0;
          if (zones.indexOf(ZONE_NAMES[this.zone[ci2]]) >= 0) picked = { cx: cx2, cy: cy2 };
        }
      }
      if (!picked) return null;
      var c = this.cw(picked.cx, picked.cy);
      var d = this.districtAt(picked.cx, picked.cy);
      var rn = this.roadName[this.idx(picked.cx, picked.cy)];
      return {
        x: c.x, y: c.y, zone: ZONE_NAMES[this.zone[this.idx(picked.cx, picked.cy)]],
        access: { x: c.x, y: c.y, cx: picked.cx, cy: picked.cy },
        buildingId: null, label: (d ? d.name : '临江市') + ' · ' + (rn || '主路'), onRoad: true
      };
    }
    var candidates = [];
    for (i = 0; i < this.buildings.length; i++) {
      var b = this.buildings[i];
      if (!b.access || exclude[b.id]) continue;
      if (def.zones && def.zones.indexOf(b.zone) < 0) continue;
      if (def.kinds && def.kinds.indexOf(b.kind) < 0) continue;
      if (def.spotTags && def.spotTags.indexOf(b.tag) < 0) continue;
      candidates.push(b);
    }
    // 首轮严格匹配；若找不到（例如地标没生成），退一步按区域找
    if (!candidates.length) {
      for (i = 0; i < this.buildings.length; i++) {
        var b2 = this.buildings[i];
        if (!b2.access || exclude[b2.id]) continue;
        if (def.zones && def.zones.indexOf(b2.zone) < 0) continue;
        candidates.push(b2);
      }
    }
    if (!candidates.length) return null;
    var b3 = candidates[Math.floor(rng() * candidates.length)];
    return {
      x: b3.cx, y: b3.cy, zone: b3.zone,
      access: b3.access, buildingId: b3.id, label: b3.name, onRoad: false
    };
  };

  /* ---------------- 主入口 ---------------- */
  EM.map = {
    generate: function (seed) {
      var t0 = (root.performance && performance.now) ? performance.now() : Date.now();
      var m = new MapGen(seed);
      m.paintTerrain();
      m.buildRoads();
      m.buildPlaces();
      m.buildStations();
      m.computeReach();
      m.buildDecor();
      // 只保留可用的站点
      m.stations = m.stations.filter(function (s) { return !s.broken && s.access; });
      m.cellAt = function (wx, wy) {
        var x = U.clamp(Math.floor(wx / TILE), 0, W - 1);
        var y = U.clamp(Math.floor(wy / TILE), 0, H - 1);
        return { x: x, y: y, idx: y * W + x };
      };
      m.isRoad = function (wx, wy) {
        var c = this.cellAt(wx, wy);
        return this.road[c.idx] > 0;
      };
      m.worldToCell = function (wx, wy) {
        return { x: U.clamp(Math.floor(wx / TILE), 0, W - 1), y: U.clamp(Math.floor(wy / TILE), 0, H - 1) };
      };
      m.genMs = Math.round(((root.performance && performance.now) ? performance.now() : Date.now()) - t0);
      m.stats = {
        buildings: m.buildings.length,
        stations: m.stations.length,
        roads: m.roadCells.length,
        reachable: m.reachable ? m.reachable.reduce(function (a, b) { return a + b; }, 0) : 0
      };
      return m;
    },
    TILE: TILE
  };
})(window);
