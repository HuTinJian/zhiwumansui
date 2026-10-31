/* =========================================================================
   临界 · 紧急调度 — 织雾市地图生成器（确定性、零依赖）
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

  // 区域编号 → 名称。大世界扩展由 world-expansion.js 提供 D.ZONE_NAMES（含 gov/mountain/coast）；
  // 这里保留旧表兜底，防止单独加载 map.js 时崩掉。
  var ZONE_NAMES = D.ZONE_NAMES || { 0: '', 1: 'city', 2: 'industrial', 3: 'country', 4: 'prison', 5: 'airport' };
  // 区域 id → zone 编号；同样优先用 world-expansion.js 的 D.ZONE_IDS。
  var ZONE_IDS = D.ZONE_IDS || { city: 1, industrial: 2, country: 3, prison: 4, airport: 5 };

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
    this.tunnel = new Uint8Array(N); // 隧道格（道路仍在 road 上，渲染层可叠隧道顶棚）
    this.tunnels = [];   // 隧道区段：[{x,y,w,h,cx,cy,label}]（格子坐标 + 世界中心）
    this.bridges = [];   // 跨江/跨湖/码头桥区段（由 bridge 格连通分量自动汇总）
    this.beaches = [];   // 海湾沙滩区段
    this.sea = [];       // 海面区段
    this.lake = null;    // 山间湖（格子矩形 + 世界中心）
    this.tagPoints = {}; // 区域型警情落点：tag → [{x,y,cx,cy,zone,access,label}]（不是建筑）
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
    // ground 类型约定（旧值不动）：0 空地 / 1 城市铺装 / 2 工业地 / 3 草地 / 4 建筑基座 /
    // 5 林地 / 6 水面 / 7 河岸沙地·海湾沙滩（复用旧沙地色） / 8 政务混凝土（新增，渲染层未适配时按区域底色处理）
    var zones = D.DISTRICTS;
    // 各区域地面：新增 gov/mountain/coast 直接在这里给出，渲染层无需知道区域 id
    var districtGround = {
      city: 1, industrial: 1, prison: 4, airport: 4,
      country: 3, gov: 8, mountain: 5, coast: 1
    };
    for (i = 0; i < zones.length; i++) {
      var d = zones[i];
      var zid = ZONE_IDS[d.id];
      if (!zid) continue; // 未登记的区域（比如 world-expansion.js 没加载）直接跳过，保持旧行为
      var dg = districtGround[d.id] != null ? districtGround[d.id] : 3;
      for (y = d.y; y < d.y + d.h; y++) {
        for (x = d.x; x < d.x + d.w; x++) {
          if (!self.inb(x, y)) continue;
          var idx = self.idx(x, y);
          self.zone[idx] = zid;
          self.ground[idx] = dg;
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

    /* ===== 大世界扩展地形（只改动新区，旧河道/旧地形公式原样保留） ===== */
    // 1) 河口：主河在 x≈196 后向南拐，穿过政务区东侧外缘汇入海湾。
    //    旧规律（x<140）完全不变；这里只画 x>=196 的南向汊道。
    for (y = 56; y < 106; y++) {
      var ex = 200 + (y - 56) * 0.16;
      var eh = 4.2 + Math.sin(y * 0.31) * 0.8;
      for (x = Math.floor(ex - eh); x <= Math.ceil(ex + eh); x++) {
        if (!self.inb(x, y)) continue;
        var ei = self.idx(x, y);
        self.water[ei] = 1;
        self.ground[ei] = 6;
        self.occ[ei] = 1;
      }
    }
    // 2) 山间湖：织雾山里的椭圆湖，供溺水/取水类警情；桥从湖上跨过（见 buildRoads）。
    var lx = 31, ly = 130, lrx = 5.5, lry = 6.5;
    for (y = Math.floor(ly - lry) - 1; y <= Math.ceil(ly + lry) + 1; y++) {
      for (x = Math.floor(lx - lrx) - 1; x <= Math.ceil(lx + lrx) + 1; x++) {
        if (!self.inb(x, y)) continue;
        var ddx = (x + 0.5 - lx) / lrx, ddy = (y + 0.5 - ly) / lry;
        if (ddx * ddx + ddy * ddy > 1) continue;
        var li = self.idx(x, y);
        self.water[li] = 1;
        self.ground[li] = 6;
        self.occ[li] = 1;
      }
    }
    this.lake = { x: 26, y: 124, w: 11, h: 13, cx: lx * TILE, cy: ly * TILE };
    // 3) 海湾：海面在 x>=204（y>=106），沙滩 x196..203。
    //    海面标记 water+occ，渲染层与旧河流共用；沙滩用沙地色并占位，防止普通建筑压到沙滩上。
    for (y = 106; y < H; y++) {
      for (x = 196; x < 204; x++) {
        if (!self.inb(x, y)) continue;
        var bi = self.idx(x, y);
        if (self.water[bi]) continue;
        self.ground[bi] = 7;
        self.occ[bi] = 1;
      }
      for (x = 204; x < W; x++) {
        var si = self.idx(x, y);
        self.water[si] = 1;
        self.ground[si] = 6;
        self.occ[si] = 1;
      }
    }
    // 4) 南部新区域补齐 zone：DISTRICTS 只到 y155 / x215，边界外仍归属相邻区域，
    //    否则 zoneAt 会把这些地方误判成城区，警情按区域取点会落空。
    var zMountain = ZONE_IDS.mountain || 7, zCoast = ZONE_IDS.coast || 8;
    for (y = 106; y < H; y++) {
      for (x = 0; x < W; x++) {
        var zi = self.idx(x, y);
        if (!self.zone[zi]) self.zone[zi] = x < 96 ? zMountain : zCoast;
      }
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

  // 标记隧道区段：道路本身仍在 road 数组里（车辆照常通行），tunnel 只用于渲染顶棚与警情落点。
  // 回退办法：删除 tunnel 数组与相关调用即可，不影响旧地图。
  MapGen.prototype.markTunnel = function (x1, y1, x2, y2) {
    var vertical = x1 === x2;
    var a = vertical ? Math.min(y1, y2) : Math.min(x1, x2);
    var b = vertical ? Math.max(y1, y2) : Math.max(x1, x2);
    for (var t = a; t <= b; t++) {
      var cx = vertical ? x1 : t, cy = vertical ? t : y1;
      if (!this.inb(cx, cy)) continue;
      this.tunnel[this.idx(cx, cy)] = 1;
    }
    this.tunnels.push({
      x: Math.min(x1, x2), y: Math.min(y1, y2),
      w: vertical ? 1 : (b - a + 1), h: vertical ? (b - a + 1) : 1,
      cx: x1 * TILE + TILE / 2, cy: y1 * TILE + TILE / 2, label: '盘山隧道'
    });
  };

  MapGen.prototype.buildRoads = function () {
    var s = this;
    // 城区主干 + 支路
    var cityV = [[8, '望江路'], [22, '中山路'], [36, '和平路'], [50, '建设路'], [64, '城东大道']];
    var cityH = [[8, '环城北路'], [22, '织雾大道'], [36, '人民路'], [47, '滨江路']];
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
    s.stamp(6, 22, 138, 22, 3, 3, '织雾大道');
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
    // 环城高速：贴着地图北缘，带三条匝道接入城区/工业区
    s.stamp(4, 3, 136, 3, 3, 3, '环城高速');
    [22, 64, 106].forEach(function (x) { s.stamp(x, 3, x, 8, 1, 2, ''); });
    this.highwayY = 3;

    /* ===== 大世界道路扩展（全部接到既有路网上，保证 A* 连通） ===== */
    // 环城高速东延到 x=214，并在政务区加两处出口匝道
    s.stamp(136, 3, 214, 3, 3, 3, '环城高速');
    s.stamp(152, 3, 152, 8, 1, 2, '政务出口');
    s.stamp(192, 3, 192, 8, 1, 2, '东环出口');

    // 政务区：四条东西向主干（y=8/22/36/47）+ 五条南北支路 + 东西外环，形成环线接工业区
    s.stamp(138, 8, 206, 8, 3, 3, '政务大道');
    s.stamp(138, 22, 206, 22, 3, 3, '织雾大道东段');
    s.stamp(144, 36, 206, 36, 2, 2, '人民大道东段');
    s.stamp(144, 47, 206, 47, 2, 2, '滨河大道');
    s.stamp(144, 3, 144, 47, 2, 2, '政务西街');
    s.stamp(152, 8, 152, 47, 1, 1, '');
    s.stamp(168, 8, 168, 47, 1, 1, '');
    s.stamp(184, 8, 184, 47, 1, 1, '');
    s.stamp(200, 8, 200, 47, 1, 1, '');
    s.stamp(206, 8, 206, 47, 1, 1, '政务东环路');

    // 南北大通道：工业区/政务区 → 海湾；x=138 与 x=170 跨过织雾河，自动成为桥（bridge 格）
    s.stamp(138, 3, 138, 118, 2, 2, '临港大道');
    s.stamp(170, 47, 170, 118, 2, 2, '江湾大道');

    // 海湾：海滨大道（贯穿山区与海湾）、滨海路、港区路、渔人码头（伸入海面）
    s.stamp(96, 118, 196, 118, 3, 3, '海滨大道');
    s.stamp(100, 136, 186, 136, 2, 2, '滨海路');
    s.stamp(100, 127, 190, 127, 1, 2, '湾畔路');     // 海滨街区支路
    s.stamp(100, 145, 186, 145, 1, 2, '');           // 滨海街区支路
    s.stamp(120, 118, 120, 145, 1, 2, '');           // 海滨南北支路
    s.stamp(150, 118, 150, 152, 2, 2, '港区路');
    s.stamp(190, 118, 190, 150, 1, 2, '');
    s.stamp(190, 150, 210, 150, 2, 2, '渔人码头');

    // 山区：山门路（稻香路南延）、山南路、盘山路、跨湖小桥、盘山隧道、山脚路
    s.stamp(22, 97, 22, 150, 2, 2, '山门路');
    s.stamp(22, 118, 96, 118, 2, 2, '山南路');
    s.stamp(10, 118, 22, 118, 2, 2, '');             // 山南路西延
    s.stamp(10, 118, 10, 150, 1, 2, '西山林道');
    s.stamp(76, 118, 76, 150, 1, 2, '东山林道');
    s.stamp(40, 118, 40, 140, 1, 2, '盘山路');
    s.stamp(22, 132, 40, 132, 1, 2, '');           // 跨湖小桥（跨过山间湖，stamp 自动标 bridge）
    s.stamp(64, 118, 64, 140, 1, 2, '盘山隧道');
    s.stamp(40, 140, 88, 140, 1, 2, '');
    s.stamp(22, 150, 88, 150, 1, 2, '山脚路');
    s.stamp(88, 118, 88, 150, 1, 2, '');
    this.markTunnel(64, 120, 64, 136);             // 隧道段（道路照走，另记隧道顶棚）

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
    // 新区域按 id 取，避免依赖 DISTRICTS 数组下标（world-expansion.js 会追加条目）
    function districtById(id) {
      for (var i = 0; i < D.DISTRICTS.length; i++) if (D.DISTRICTS[i].id === id) return D.DISTRICTS[i];
      return null;
    }

    /* ---- 城区地标 ---- */
    // 市公安局（也作为警力站点）
    this.placeLandmark(16, 10, 5, 4, { kind: 'police_hq', name: '织雾市公安局', tag: 'police_hq', stationId: 'police_hq' });
    // 中央消防站
    this.placeLandmark(24, 16, 5, 4, { kind: 'fire_station', name: '中央消防站', stationId: 'fire_central', color: '#4a3a33', roof: '#2e231f' });
    // 第一医院
    this.placeLandmark(30, 30, 5, 4, { kind: 'hospital', name: '织雾市第一医院', tag: 'hospital', stationId: 'hospital_main' });
    // 紧急医疗中心
    this.placeLandmark(10, 38, 4, 3, { kind: 'hospital', name: '紧急医疗中心', stationId: 'ems_center', color: '#39444f', roof: '#27313a' });
    // 织雾广场（商场）
    this.placeLandmark(44, 24, 5, 5, { kind: 'mall', name: '织雾广场', tag: 'mall' });
    // 第三中学
    this.placeLandmark(52, 30, 5, 4, { kind: 'school', name: '织雾市第三中学', tag: 'school' });
    // 织雾大厦
    this.placeLandmark(10, 24, 4, 4, { kind: 'office', name: '织雾大厦' });
    // 中心广场（视觉公园）
    var plaza = { kind: 'park', x: 30, y: 10, w: 4, h: 4, name: '中心广场' };
    this.props.push(plaza); this.markProp(plaza);
    // 织雾站：城市与工业区之间的铁路客运站
    this.placeLandmark(67, 27, 6, 4, { kind: 'rail_station', name: '织雾站', tag: 'train_station' });
    this.rail = { x: 70, y1: 8, y2: 47 };

    /* ---- 工业区 ---- */
    this.placeLandmark(94, 16, 5, 4, { kind: 'fire_station', name: '工业区消防站', stationId: 'fire_industrial', color: '#443a33', roof: '#2b2420' });
    this.placeLandmark(94, 24, 4, 3, { kind: 'police_hq', name: '工业区派出所', stationId: 'police_industrial', tag: 'police_sub', color: '#343f4b', roof: '#242d37' });
    // 化工厂与罐区
    this.placeLandmark(122, 10, 5, 4, { kind: 'chemical', name: '织雾化工厂', tag: 'chemical' });
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

    /* ===== 大世界新增地标（按 content-expansion.js 约定的站点 id / tag 放置） ===== */
    // 说明：kind 只决定渲染样式；尺寸/名称/配色/标签都在这里显式给出，
    // 因此不依赖 D.BUILDING_SPECS 是否已扩展（未知 kind 会回退成普通楼）。
    // 新区域用独立随机流，避免新增地标打乱旧城区普通建筑的布局（旧 rng 顺序保持不变）。
    var oldRng = this.rng;
    this.rng = U.mulberry32((this.seed ^ 0x5bd1e995) >>> 0);
    // ---- 政务区：最高警察/消防/医院，同时是 D.STATIONS 的站点建筑（stationId 必须一致） ----
    this.placeLandmark(160, 12, 6, 4, {
      kind: 'police_hq', name: '最高人民警察局', tag: 'top_police', stationId: 'top_police',
      color: '#2f3d4d', roof: '#1f2a36'
    });
    this.placeLandmark(174, 12, 5, 4, {
      kind: 'fire_station', name: '最高人民消防局', tag: 'top_fire', stationId: 'top_fire',
      color: '#4a3a33', roof: '#2e231f'
    });
    this.placeLandmark(186, 12, 6, 4, {
      kind: 'hospital', name: '最高人民医院', tag: 'top_hospital', stationId: 'top_hospital',
      color: '#39454f', roof: '#27313a'
    });
    // ---- 政务区：中央人民政府 / 最高法 / 最高检 / 监察委 ----
    // kind 用 content-expansion.js 扩展出的 gov_office/court/procuratorate/supervision，
    // 让渲染样式与名字池统一；尺寸仍按建筑重要性显式给。
    this.placeLandmark(172, 26, 10, 6, {
      kind: 'gov_office', name: '中央人民政府', tag: 'central_gov', color: '#333c4a', roof: '#222a34', floors: 8
    });
    this.placeLandmark(155, 26, 7, 5, {
      kind: 'court', name: '最高人民法院', tag: 'supreme_court', color: '#313a45', roof: '#212830', floors: 6
    });
    this.placeLandmark(186, 26, 7, 5, {
      kind: 'procuratorate', name: '最高人民检察院', tag: 'procuratorate', color: '#343b46', roof: '#232a33', floors: 6
    });
    this.placeLandmark(186, 39, 6, 4, {
      kind: 'supervision', name: '监察委员会', tag: 'supervision', color: '#363d47', roof: '#242b33', floors: 5
    });
    // 政务广场：铺装空地，作为 'gov' 区域警情落点（occ=3 占位，普通建筑不会压上来）
    var govPlaza = { kind: 'plaza', x: 170, y: 38, w: 11, h: 7, name: '政务广场' };
    this.props.push(govPlaza); this.markProp(govPlaza);
    // 政务区其余街区铺装：避免大片空地显得太空
    [{ kind: 'plaza', x: 153, y: 38, w: 6, h: 6, name: '政务东广场' },
      { kind: 'plaza', x: 196, y: 38, w: 4, h: 6, name: '政务西广场' },
      { kind: 'parking', x: 147, y: 39, w: 4, h: 5, name: '政务停车场' }].forEach(function (p) {
        self.props.push(p); self.markProp(p);
      });

    // ---- 加油站：城区 / 工业区 / 高速服务区 各一座；机场另设航空加油站 ----
    // 城区/工业区/机场这三座落在旧城区，安排到旧建筑生成之后（见下方“旧城区新增设施”），
    // 用新的随机流定位，避免占用旧街区原有建筑格、打乱旧地图布局。
    this.placeLandmark(156, 5, 3, 3, {
      kind: 'gas_station', name: '高速服务区加油站', tag: 'gas_station', color: '#4a4136', roof: '#322b23', floors: 1
    });

    // ---- 山区消防站（站 id 与 content-expansion.js 的 D.STATIONS 对应） ----
    this.placeLandmark(42, 121, 5, 4, {
      kind: 'fire_station', name: '山区消防站', tag: 'fire_mountain', stationId: 'fire_mountain',
      color: '#443a33', roof: '#2b2420'
    });

    // ---- 海湾救援站与海滨地标 ----
    this.placeLandmark(154, 130, 5, 4, {
      kind: 'fire_station', name: '海岸救援站', tag: 'coast_guard', stationId: 'coast_guard',
      color: '#33424d', roof: '#233039'
    });
    this.placeLandmark(108, 122, 8, 5, {
      kind: 'beach_hotel', name: '织雾湾大酒店', tag: 'beach_hotel', color: '#3b4450', roof: '#29313a', floors: 12
    });
    this.placeLandmark(184, 124, 4, 3, {
      kind: 'dock_warehouse', name: '海湾码头仓库', tag: 'dock_warehouse', color: '#3e4145', roof: '#292c2f'
    });
    this.placeLandmark(185, 146, 4, 2, {
      kind: 'pier', name: '海湾码头', tag: 'pier', color: '#3a3f41', roof: '#3a3f41', floors: 0, flat: true
    });
    this.placeLandmark(193, 114, 2, 2, {
      kind: 'tower', name: '海湾灯塔', tag: 'lighthouse', floors: 4
    });
    // 新区域地标放完，恢复旧随机流：下面的城区/工业区/乡下普通建筑与改版前一致
    this.rng = oldRng;

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

    // ---- 旧城区新增设施：放在旧建筑之后定位，使用独立随机流，尽量不改变原有街区布局 ----
    var oldRng3 = this.rng;
    this.rng = U.mulberry32((this.seed ^ 0x165667b1) >>> 0);
    this.placeLandmark(56, 42, 3, 3, {
      kind: 'gas_station', name: '城区加油站', tag: 'gas_station', color: '#4b4338', roof: '#332c24', floors: 1, radius: 16
    });
    this.placeLandmark(116, 37, 3, 3, {
      kind: 'gas_station', name: '工业区加油站', tag: 'gas_station', color: '#49443a', roof: '#332e26', floors: 1, radius: 16
    });
    this.placeLandmark(114, 76, 4, 3, {
      kind: 'tank', name: '机场航空加油站', tag: 'air_fuel', color: '#4b4a3a', roof: '#333226', floors: 1, radius: 16
    });
    this.rng = oldRng3;

    /* ---- 新区域普通建筑（政务办公 / 山村小屋 / 海滨酒店仓库） ---- */
    // 同样用独立随机流：新区域的填充不影响旧城区/工业区/乡下的既有建筑结果。
    var oldRng2 = this.rng;
    this.rng = U.mulberry32((this.seed ^ 0x27d4eb2f) >>> 0);
    var govD = districtById('gov'), mountainD = districtById('mountain'), coastD = districtById('coast');
    if (govD) {
      this.addGeneric('gov_office', 16, govD, {});
      this.addGeneric('apartment', 6, govD, {});
      this.addGeneric('school', 1, govD, {});
    }
    if (mountainD) {
      this.addGeneric('mountain_lodge', 16, mountainD, { margin: 0 });
      this.addGeneric('forest_station', 8, mountainD, { margin: 0 });
      this.addGeneric('barn', 6, mountainD, { margin: 0 });
    }
    if (coastD) {
      // 海湾：海滨酒店、码头仓库、商铺；沙滩与海面已占位，不会被压上建筑
      this.addGeneric('beach_hotel', 10, coastD, {});
      this.addGeneric('dock_warehouse', 10, coastD, {});
      this.addGeneric('shop', 6, coastD, {});
      this.addGeneric('apartment', 4, coastD, {});
    }
    this.rng = oldRng2; // 恢复旧随机流，后面的小公园/停车场仍按原序列生成

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

  /* ---------------- 水系地标：桥 / 隧道 / 沙滩 / 海面 ----------------
     这些数组给渲染层与警情落点用：
     world.bridges / world.tunnels / world.beaches / world.sea / world.lake
     每项统一带格子矩形 (x,y,w,h) 与世界中心 (cx,cy)，方便 UI 画标注或取点。
     回退办法：删掉本方法调用与数组即可，旧地图不依赖它们。 */
  MapGen.prototype.buildWaterAreas = function () {
    var self = this;
    function info(x, y, w, h, label) {
      return { x: x, y: y, w: w, h: h, cx: (x + w / 2) * TILE, cy: (y + h / 2) * TILE, label: label };
    }
    // 沙滩 / 海面：与 paintTerrain 的取法保持一致（沙滩 x196..203，海面 x>=204，y>=106）
    this.beaches = [info(196, 106, 8, H - 106, '织雾湾沙滩')];
    this.sea = [info(204, 106, W - 204, H - 106, '织雾湾海面')];
    if (!this.lake) this.lake = { x: 26, y: 124, w: 11, h: 13, cx: 31 * TILE, cy: 130 * TILE };

    // 桥：对 bridge 格做连通分量 BFS，每一段桥单独成一个地标（跨江大桥 / 跨湖小桥 / 码头栈桥）
    var seen = new Uint8Array(N), dirs = [1, -1, W, -W];
    for (var i = 0; i < N; i++) {
      if (!this.bridge[i] || seen[i]) continue;
      var q = [i], head = 0, minX = W, maxX = 0, minY = H, maxY = 0;
      seen[i] = 1;
      while (head < q.length) {
        var cur = q[head++];
        var cx = cur % W, cy = (cur / W) | 0;
        if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
        for (var d = 0; d < 4; d++) {
          var nx = cx + (d === 0 ? 1 : d === 1 ? -1 : 0);
          var ny = cy + (d === 2 ? 1 : d === 3 ? -1 : 0);
          if (!self.inb(nx, ny)) continue;
          var ni = self.idx(nx, ny);
          if (!self.bridge[ni] || seen[ni]) continue;
          seen[ni] = 1; q.push(ni);
        }
      }
      var inLake = minX >= self.lake.x - 2 && maxX <= self.lake.x + self.lake.w + 2 &&
        minY >= self.lake.y - 2 && maxY <= self.lake.y + self.lake.h + 2;
      var label = inLake ? '跨湖小桥' : (minY > 140 ? '码头栈桥' : '跨江大桥');
      this.bridges.push(info(minX, minY, maxX - minX + 1, maxY - minY + 1, label));
    }
  };

  /* 区域型警情落点：山火、溺水、海面、隧道、大桥、政务广场这些“不是建筑”的位置。
     落点挂到 tagPoints[tag]，pickSpot 在找不到同名建筑标签时会回退到这里。
     每个点都配一个最近道路格作为 access，保证车辆能开到附近。 */
  MapGen.prototype.addTagPoint = function (tag, cx, cy, label) {
    if (!this.inb(cx, cy)) return null;
    var acc = this.nearestRoadCell(cx * TILE + TILE / 2, cy * TILE + TILE / 2, 12);
    if (!acc) acc = this.nearestRoadCell(cx * TILE + TILE / 2, cy * TILE + TILE / 2, 24);
    if (!acc) return null;
    var world = this.cw(acc.x, acc.y);
    // 桥面/岸边格可能落在区域边界外（zone=0），向外找最近的 DISTRICTS，避免落点 zone 变成空
    var zid = this.zone[this.idx(acc.x, acc.y)];
    var zoneName = ZONE_NAMES[zid];
    if (!zoneName) {
      for (var r = 1; r <= 12 && !zoneName; r++) {
        for (var dy = -r; dy <= r && !zoneName; dy++) {
          for (var dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
            var dd = this.districtAt(U.clamp(cx + dx, 0, W - 1), U.clamp(cy + dy, 0, H - 1));
            if (dd) { zoneName = dd.id; break; }
          }
        }
      }
    }
    var p = {
      tag: tag, cx: cx, cy: cy,
      x: cx * TILE + TILE / 2, y: cy * TILE + TILE / 2,
      zone: zoneName || 'city',
      access: { x: world.x, y: world.y, cx: acc.x, cy: acc.y },
      label: label
    };
    if (!this.tagPoints[tag]) this.tagPoints[tag] = [];
    this.tagPoints[tag].push(p);
    return p;
  };

  MapGen.prototype.buildTagPoints = function () {
    var i;
    // 山林：多点撒在山区里（山火/搜救）
    [[30, 124], [52, 126], [70, 130], [38, 144], [80, 140], [60, 148]].forEach(function (p) {
      this.addTagPoint('mountain', p[0], p[1], '织雾山林');
    }, this);
    // 山间湖（溺水/取水）——点落在湖心，access 取最近的桥/岸路
    [[31, 130], [29, 126], [34, 133]].forEach(function (p) {
      this.addTagPoint('lake', p[0], p[1], '山间湖');
    }, this);
    // 沙滩 / 海面（溺水、鲨鱼、海啸）
    [[199, 110], [199, 126], [199, 140], [197, 148]].forEach(function (p) {
      this.addTagPoint('beach', p[0], p[1], '织雾湾沙滩');
    }, this);
    [[210, 112], [212, 132], [208, 148]].forEach(function (p) {
      this.addTagPoint('sea', p[0], p[1], '织雾湾海面');
    }, this);
    // 隧道：取隧道段中点
    for (i = 0; i < this.tunnels.length; i++) {
      var tn = this.tunnels[i];
      this.addTagPoint('tunnel', Math.floor(tn.x + tn.w / 2), Math.floor(tn.y + tn.h / 2), tn.label || '隧道');
    }
    // 大桥：每段桥取中点；跨江桥/跨湖桥/码头栈桥都进 bridge 标签
    for (i = 0; i < this.bridges.length; i++) {
      var br = this.bridges[i];
      this.addTagPoint('bridge', Math.floor(br.x + br.w / 2), Math.floor(br.y + br.h / 2), br.label || '大桥');
    }
    // 政务广场（gov 区域警情落点；central_gov 等建筑标签另有 building.tag）
    this.addTagPoint('gov', 175, 41, '政务广场');
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
    // 区域落点同理：接不通主路网的落点直接失效，避免派车后无路可走
    Object.keys(this.tagPoints).forEach(function (tag) {
      self.tagPoints[tag] = self.tagPoints[tag].filter(function (p) {
        return p.access && self.reachable[self.idx(p.access.cx, p.access.cy)];
      });
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
        buildingId: null, label: (d ? d.name : '织雾市') + ' · ' + (rn || '主路'), onRoad: true
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
    // 区域型标签（mountain/lake/beach/sea/tunnel/bridge/gov 等）不是建筑，走 tagPoints；
    // 放在“严格匹配建筑”之后、“按区域兜底”之前，保证山火/溺水/隧道类警情能落到真实地貌。
    if (!candidates.length && def.spotTags) {
      var pool = [], poolAny = [];
      for (var pi = 0; pi < def.spotTags.length; pi++) {
        var pts = this.tagPoints[def.spotTags[pi]] || [];
        for (var pj = 0; pj < pts.length; pj++) {
          if (!pts[pj].access) continue;
          poolAny.push(pts[pj]);
          if (def.zones && def.zones.indexOf(pts[pj].zone) < 0) continue;
          pool.push(pts[pj]);
        }
      }
      // 区域过滤太严时放宽到只按 tag 取点（地貌/地物比行政区更重要，避免大桥/海面警情落空）
      if (!pool.length) pool = poolAny;
      if (pool.length) {
        var tp = pool[Math.floor(rng() * pool.length)];
        return {
          x: tp.x, y: tp.y, zone: tp.zone, access: tp.access,
          buildingId: null, label: tp.label, onRoad: false
        };
      }
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
      m.buildWaterAreas();   // 汇总桥/隧道/沙滩/海面（依赖 road/bridge/water 已画完）
      m.buildTagPoints();    // 区域型警情落点（依赖道路、隧道、桥梁数组）
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
        reachable: m.reachable ? m.reachable.reduce(function (a, b) { return a + b; }, 0) : 0,
        tags: Object.keys(m.landmarks).length,
        tagPoints: Object.keys(m.tagPoints).reduce(function (a, k) { return a + m.tagPoints[k].length; }, 0),
        bridges: m.bridges.length,
        tunnels: m.tunnels.length
      };
      return m;
    },
    TILE: TILE
  };
})(window);
