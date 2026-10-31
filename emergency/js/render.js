/* =========================================================================
   临界 · 紧急调度 — Canvas 渲染层
   内容：静态城市底图（地形/道路/建筑/机场/监狱/植被）+ 动态灯光/车辆/雨雾/
        警情标记/单位/粒子/天气。全部用矢量绘制，无外部图片素材。
   回退办法：删除 emergency/ 目录或 revert；不影响站内其它页面。
   ========================================================================= */
(function (root) {
  'use strict';
  var EM = root.EM = root.EM || {};
  var U = EM.util, D = EM.data;
  var W = D.WORLD.W, H = D.WORLD.H, TILE = D.WORLD.TILE;
  var WORLD_W = W * TILE, WORLD_H = H * TILE;

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function hash(n) {
    n = (n ^ 61) ^ (n >>> 16);
    n = n + (n << 3);
    n = n ^ (n >>> 4);
    n = Math.imul(n, 0x27d4eb2d);
    n = n ^ (n >>> 15);
    return (n >>> 0) / 4294967296;
  }

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 1; this.h = 1; this.dpr = 1;
    this.world = null;
    this.base = null;
    this.settings = D.DEFAULT_SETTINGS;
    this.quality = D.QUALITY.high;
    this.time = 0;
    this.cam = { x: WORLD_W / 2, y: WORLD_H / 2, zoom: 0.35, tx: WORLD_W / 2, ty: WORLD_H / 2, tz: 0.35 };
    this.minZoom = 0.2; this.maxZoom = 2.4;
    this.traffic = [];
    this.particles = [];
    this.rain = [];
    this.ripples = [];
    this.lightning = 0;
    this.lightningCooldown = 8;
    this.flash = 0;
    this.shake = 0;
    this.menuT = 0;
    this.menuIdx = 0;
    this.lightningFired = false;
    this.windows = [];
    this.beacons = [];
    this.lightCanvas = null;
    this._glows = {};
    this._lastW = 0; this._lastH = 0;
    this.onLightning = null;
    this.hover = null;
    this.selected = null;
    this.selectedIncident = null;
    this._dash = 0;
    this._tmp = {};
  }

  Renderer.prototype.setSettings = function (settings) {
    var oldQ = this.settings.quality;
    this.settings = settings;
    this.quality = D.QUALITY[settings.quality] || D.QUALITY.high;
    // 底图固定 1x，切换画质不再重建，避免设置面板卡顿
    if (this.world && !this.base) this.buildBase();
    if (this.world && this.quality.lights && !this.lightCanvas) this.buildLights();
    this.resize();
    if (oldQ !== settings.quality) this.initTraffic();
    this.initRain();
  };

  Renderer.prototype.resize = function () {
    var c = this.canvas;
    var w = Math.max(1, c.clientWidth || root.innerWidth);
    var h = Math.max(1, c.clientHeight || root.innerHeight);
    var dpr = root.devicePixelRatio || 1;
    dpr = Math.min(dpr, this.quality.dprCap || 1.5);
    if (this.settings.renderScale !== 'auto') {
      var s = parseFloat(this.settings.renderScale) || 1;
      dpr = Math.min(2, Math.max(0.5, s));
    }
    if (w === this._lastW && h === this._lastH && dpr === this.dpr) {
      return;
    }
    this._lastW = w; this._lastH = h;
    this.w = w; this.h = h; this.dpr = dpr;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    this.initRain();
  };

  Renderer.prototype.setWorld = function (world) {
    this.world = world;
    this.base = null;
    this.lightCanvas = null;
    this.buildBase();
    this.prepareWorld();
    this.buildLights();
    this.initTraffic();
    this.initRain();
    var d = D.DISTRICTS[0];
    this.focusOn((d.x + d.w / 2) * TILE, (d.y + d.h / 2) * TILE, Math.max(0.5, this.fitZoom() * 1.55), true);
  };

  Renderer.prototype.fitZoom = function (padding) {
    padding = padding || 40;
    var z = Math.min((this.w - padding * 2) / WORLD_W, (this.h - padding * 2) / WORLD_H);
    return Math.max(0.16, Math.min(1.4, z));
  };

  /* ============================ 相机 ============================ */
  Renderer.prototype.updateCamera = function (dt) {
    var k = 1 - Math.exp(-(dt || 0.016) * 7.5);
    this.cam.x = U.lerp(this.cam.x, this.cam.tx, k);
    this.cam.y = U.lerp(this.cam.y, this.cam.ty, k);
    this.cam.zoom = U.lerp(this.cam.zoom, this.cam.tz, Math.min(1, k * 1.4));
    this.minZoom = this.fitZoom(20) * 0.85;
    this.maxZoom = this.w < 700 ? 2.9 : 2.4;
    this.cam.zoom = U.clamp(this.cam.zoom, this.minZoom, this.maxZoom);
    // 边界约束
    var halfW = this.w / (2 * this.cam.zoom), halfH = this.h / (2 * this.cam.zoom);
    // 允许视野越出地图边缘 45%：否则地图最边的警情会被侧栏挡住，无法居中
    var padX = halfW * 0.45, padY = halfH * 0.45;
    if (WORLD_W <= halfW * 2) { this.cam.tx = WORLD_W / 2; this.cam.x = WORLD_W / 2; }
    else {
      var minX = halfW - padX, maxX = WORLD_W - halfW + padX;
      this.cam.tx = U.clamp(this.cam.tx, minX, maxX);
      this.cam.x = U.clamp(this.cam.x, minX, maxX);
    }
    if (WORLD_H <= halfH * 2) { this.cam.ty = WORLD_H / 2; this.cam.y = WORLD_H / 2; }
    else {
      var minY = halfH - padY, maxY = WORLD_H - halfH + padY;
      this.cam.ty = U.clamp(this.cam.ty, minY, maxY);
      this.cam.y = U.clamp(this.cam.y, minY, maxY);
    }
  };

  Renderer.prototype.focusOn = function (x, y, zoom, instant) {
    this.cam.tx = x; this.cam.ty = y;
    if (zoom) this.cam.tz = U.clamp(zoom, 0.2, 2.9);
    if (instant) {
      this.cam.x = this.cam.tx; this.cam.y = this.cam.ty; this.cam.zoom = this.cam.tz;
    }
  };

  Renderer.prototype.fitMap = function (instant) {
    this.cam.tz = this.fitZoom(46);
    this.cam.tx = WORLD_W / 2;
    this.cam.ty = WORLD_H / 2;
    if (instant) this.focusOn(this.cam.tx, this.cam.ty, this.cam.tz, true);
  };

  Renderer.prototype.screenToWorld = function (sx, sy) {
    return {
      x: this.cam.x + (sx - this.w / 2) / this.cam.zoom,
      y: this.cam.y + (sy - this.h / 2) / this.cam.zoom
    };
  };
  Renderer.prototype.worldToScreen = function (wx, wy) {
    return {
      x: (wx - this.cam.x) * this.cam.zoom + this.w / 2,
      y: (wy - this.cam.y) * this.cam.zoom + this.h / 2
    };
  };
  Renderer.prototype.panBy = function (dx, dy) {
    this.cam.tx -= dx / this.cam.zoom;
    this.cam.ty -= dy / this.cam.zoom;
  };
  Renderer.prototype.zoomAt = function (sx, sy, factor) {
    var before = this.screenToWorld(sx, sy);
    var z = U.clamp(this.cam.tz * factor, this.minZoom, this.maxZoom);
    if (z === this.cam.tz) return;
    this.cam.zoom = z;
    this.cam.tz = z;
    this.cam.tx = before.x - (sx - this.w / 2) / z;
    this.cam.ty = before.y - (sy - this.h / 2) / z;
    this.cam.x = this.cam.tx; this.cam.y = this.cam.ty;
  };

  /* ============================ 静态底图 ============================ */
  Renderer.prototype.buildBase = function () {
    if (!this.world) return;
    // 220×160 大图固定 0.5x：画布 3520×2560，避免超过 GPU 纹理上限；
    // 清晰度由动态图层补足，切换画质不重建底图。
    var scale = 0.5;
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(WORLD_W * scale));
    c.height = Math.max(1, Math.round(WORLD_H * scale));
    var g = c.getContext('2d');
    g.scale(scale, scale);
    g.lineJoin = 'round';
    this.drawTerrain(g);
    this.drawWater(g);
    this.drawProps(g);
    this.drawRail(g);
    this.drawRoads(g);
    this.drawBridges(g);
    this.drawTunnels(g);
    this.drawTrees(g);
    this.drawBuildings(g);
    this.drawParkedCars(g);
    this.drawLampPoles(g);
    this.drawPrisonWall(g);
    this.base = c;
    this.baseScale = scale;
  };

  Renderer.prototype.drawTerrain = function (g) {
    var rng = U.mulberry32(this.world.seed ^ 0x9e3779b9);
    g.fillStyle = '#17221b';
    g.fillRect(0, 0, WORLD_W, WORLD_H);
    // 区域底色
    var tones = {
      city: '#26313b', industrial: '#302e27', country: '#223522', prison: '#2b2e33', airport: '#29313a',
      gov: '#2b3240', mountain: '#1e2c21', coast: '#23323b'
    };
    D.DISTRICTS.forEach(function (d) {
      g.fillStyle = tones[d.id] || '#1b2a1f';
      g.fillRect(d.x * TILE, d.y * TILE, d.w * TILE, d.h * TILE);
    });
    // 大块颜色扰动
    for (var i = 0; i < 260; i++) {
      var x = rng() * WORLD_W, y = rng() * WORLD_H;
      var r = 30 + rng() * 150;
      g.fillStyle = 'rgba(' + (rng() < 0.5 ? '80,110,80' : '20,30,24') + ',' + (0.025 + rng() * 0.03) + ')';
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    // 林地
    for (var y2 = 0; y2 < H; y2++) for (var x2 = 0; x2 < W; x2++) {
      var gi = y2 * W + x2;
      if (this.world.ground[gi] === 5) {
        g.fillStyle = 'rgba(25,46,31,0.65)';
        g.fillRect(x2 * TILE, y2 * TILE, TILE, TILE);
      } else if (this.world.ground[gi] === 7) {
        g.fillStyle = 'rgba(112,100,76,0.34)';
        g.fillRect(x2 * TILE, y2 * TILE, TILE, TILE);
      } else if (this.world.ground[gi] === 8) {
        // 政务区混凝土广场
        g.fillStyle = 'rgba(125,132,140,0.1)';
        g.fillRect(x2 * TILE, y2 * TILE, TILE, TILE);
      }
    }
    // 城区道路之间隐约的街区铺装
    g.fillStyle = 'rgba(60,70,80,0.08)';
    g.fillRect(6 * TILE, 8 * TILE, 60 * TILE, 39 * TILE);
  };

  Renderer.prototype.drawWater = function (g) {
    var w = this.world;
    // 水面（按行合并连续水格）
    for (var y = 0; y < H; y++) {
      var x = 0;
      while (x < W) {
        if (!w.water[y * W + x]) { x++; continue; }
        var s = x;
        while (x < W && w.water[y * W + x]) x++;
        g.fillStyle = '#0e2631';
        g.fillRect(s * TILE, y * TILE, (x - s) * TILE, TILE);
      }
    }
    // 水面纹理与反光
    for (var i = 0; i < 34; i++) {
      var px = U.randInt(U.mulberry32(w.seed + 7 + i), 0, W - 1) * TILE;
      var yy = 54 * TILE + Math.sin(px * 0.0026) * 2.2 * TILE;
      g.strokeStyle = 'rgba(120,190,205,' + (0.035 + (i % 4) * 0.012) + ')';
      g.lineWidth = 1 + (i % 3);
      g.beginPath();
      g.moveTo(px, yy + (i % 5) * TILE * 0.38);
      g.bezierCurveTo(px + 60, yy - 8, px + 120, yy + 10, px + 200, yy - 2);
      g.stroke();
    }
    // 河岸浅水
    g.fillStyle = 'rgba(110,160,170,0.08)';
    for (var y2 = 0; y2 < H; y2++) for (var x2 = 0; x2 < W; x2++) {
      var idx = y2 * W + x2;
      if (!w.water[idx]) continue;
      var up = w.water[(y2 - 1) * W + x2], dn = w.water[(y2 + 1) * W + x2];
      var lf = w.water[y2 * W + x2 - 1], rt = w.water[y2 * W + x2 + 1];
      if (!up || !dn || !lf || !rt) g.fillRect(x2 * TILE, y2 * TILE, TILE, TILE);
    }
  };

  Renderer.prototype.drawProps = function (g) {
    var w = this.world;
    var self = this;
    w.props.forEach(function (p) {
      var x = p.x * TILE, y = p.y * TILE, ww = p.w * TILE, hh = p.h * TILE;
      if (p.kind === 'park') {
        g.fillStyle = '#223423';
        g.fillRect(x, y, ww, hh);
        g.strokeStyle = 'rgba(180,190,160,0.18)';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(x + ww * 0.1, y + hh * 0.7);
        g.quadraticCurveTo(x + ww * 0.4, y + hh * 0.35, x + ww * 0.92, y + hh * 0.5);
        g.stroke();
        var rng = U.mulberry32(p.x * 31 + p.y * 17 + 5);
        for (var i = 0; i < 5; i++) {
          var tx = x + 20 + rng() * (ww - 40), ty = y + 20 + rng() * (hh - 40);
          self.drawTree(g, tx, ty, 10 + rng() * 6, rng());
        }
      } else if (p.kind === 'parking') {
        g.fillStyle = '#232930';
        g.fillRect(x, y, ww, hh);
        g.strokeStyle = 'rgba(200,220,230,0.11)';
        g.lineWidth = 1;
        for (var sx = x + 14; sx < x + ww; sx += 28) {
          g.beginPath(); g.moveTo(sx, y + 8); g.lineTo(sx, y + hh - 8); g.stroke();
        }
      } else if (p.kind === 'apron') {
        g.fillStyle = '#2b3036';
        g.fillRect(x, y, ww, hh);
        g.strokeStyle = 'rgba(220,210,140,0.18)';
        g.lineWidth = 2;
        g.setLineDash([12, 10]);
        g.strokeRect(x + 18, y + 18, ww - 36, hh - 36);
        g.setLineDash([]);
        g.strokeStyle = 'rgba(220,210,140,0.25)';
        for (var ax = x + 40; ax < x + ww - 30; ax += 90) {
          g.beginPath(); g.moveTo(ax, y + 20); g.lineTo(ax, y + hh - 20); g.stroke();
        }
        g.fillStyle = 'rgba(255,255,255,0.06)';
        g.fillRect(x, y, ww, 2);
      } else if (p.kind === 'taxiway') {
        g.fillStyle = '#282e34';
        g.fillRect(x, y, ww, hh);
        g.strokeStyle = 'rgba(245,205,80,0.5)';
        g.lineWidth = 2;
        g.setLineDash([18, 14]);
        g.beginPath(); g.moveTo(x + 6, y + hh / 2); g.lineTo(x + ww - 6, y + hh / 2); g.stroke();
        g.setLineDash([]);
      } else if (p.kind === 'plaza') {
        g.fillStyle = '#333a3c';
        g.fillRect(x, y, ww, hh);
        g.strokeStyle = 'rgba(255,255,255,0.05)';
        for (var lx = x; lx < x + ww; lx += 24) {
          g.beginPath(); g.moveTo(lx, y); g.lineTo(lx, y + hh); g.stroke();
        }
      }
    });
  };

  Renderer.prototype.drawRail = function (g) {
    var r = this.world && this.world.rail;
    if (!r) return;
    var x = r.x * TILE + TILE / 2;
    var y1 = r.y1 * TILE, y2 = r.y2 * TILE;
    g.fillStyle = '#302d27';
    g.fillRect(x - 15, y1, 30, y2 - y1);
    g.strokeStyle = 'rgba(140,145,150,0.45)';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(x - 7, y1); g.lineTo(x - 7, y2); g.stroke();
    g.beginPath(); g.moveTo(x + 7, y1); g.lineTo(x + 7, y2); g.stroke();
    g.strokeStyle = 'rgba(90,80,65,0.8)';
    g.lineWidth = 3;
    for (var y = y1; y < y2; y += 8) {
      g.beginPath(); g.moveTo(x - 12, y); g.lineTo(x + 12, y); g.stroke();
    }
    // 站台边缘
    g.fillStyle = 'rgba(190,190,170,0.12)';
    g.fillRect(x - 42, 27 * TILE, 84, 4);
  };

  Renderer.prototype.drawRoads = function (g) {
    var w = this.world;
    var kinds = { 1: '#2b333d', 2: '#2e3741', 3: '#303a45', 4: '#5b4b35' };
    // 人行道/路基（土路不铺硬质路肩）
    for (var y = 0; y < H; y++) {
      var x = 0;
      while (x < W) {
        var idx = y * W + x;
        if (!w.road[idx] || w.bridge[idx] || w.road[idx] === 4) { x++; continue; }
        var s = x;
        while (x < W && w.road[y * W + x] && !w.bridge[y * W + x] && w.road[y * W + x] !== 4) x++;
        g.fillStyle = '#1b222b';
        g.fillRect(s * TILE - 4, y * TILE - 4, (x - s) * TILE + 8, TILE + 8);
      }
    }
    for (var x2 = 0; x2 < W; x2++) {
      var y2 = 0;
      while (y2 < H) {
        var idx2 = y2 * W + x2;
        if (!w.road[idx2] || w.bridge[idx2] || w.road[idx2] === 4) { y2++; continue; }
        var s2 = y2;
        while (y2 < H && w.road[y2 * W + x2] && !w.bridge[y2 * W + x2]) y2++;
        // 只给纵向连续段两侧加路缘，避免与横向重叠过多
        g.fillStyle = 'rgba(15,20,26,0.9)';
        g.fillRect(x2 * TILE - 4, s2 * TILE, 8, (y2 - s2) * TILE);
      }
    }
    // 路面
    for (var y3 = 0; y3 < H; y3++) {
      var x3 = 0;
      while (x3 < W) {
        var i3 = y3 * W + x3;
        if (!w.road[i3] || w.bridge[i3]) { x3++; continue; }
        var kind = w.road[i3];
        var start = x3;
        while (x3 < W && w.road[y3 * W + x3] === kind && !w.bridge[y3 * W + x3]) x3++;
        var baseColor = kinds[kind] || kinds[1];
        var wear = hash(start * 13 + y3 * 7 + 1);
        if (kind !== 4) {
          g.fillStyle = wear < 0.33 ? U.mixHex(baseColor, '#3a444e', 0.08) : (wear > 0.7 ? U.mixHex(baseColor, '#20262d', 0.07) : baseColor);
          g.fillRect(start * TILE, y3 * TILE, (x3 - start) * TILE, TILE);
        }
      }
    }
    // 土路单独用弯曲的乡间小路画，不再铺成方方正正的柏油块。
    // 分三遍画（路肩 → 路面 → 车辙），否则后画的横路会把竖路切成一节一节的。
    g.save();
    g.lineCap = 'round'; g.lineJoin = 'round';
    var dirtRuns = [];
    for (var dy = 0; dy < H; dy++) {
      var dx = 0;
      while (dx < W) {
        var di = dy * W + dx;
        if (w.road[di] !== 4 || w.bridge[di]) { dx++; continue; }
        var ds = dx;
        while (dx < W && w.road[dy * W + dx] === 4 && !w.bridge[dy * W + dx]) dx++;
        if (dx - ds < 1) continue;
        dirtRuns.push({ hor: true, a: ds, b: dx, c: dy, seed: di });
      }
    }
    for (var dx2 = 0; dx2 < W; dx2++) {
      var dy2 = 0;
      while (dy2 < H) {
        var dj = dy2 * W + dx2;
        if (w.road[dj] !== 4 || w.bridge[dj]) { dy2++; continue; }
        var dstart = dy2;
        while (dy2 < H && w.road[dy2 * W + dx2] === 4 && !w.bridge[dy2 * W + dx2]) dy2++;
        if (dy2 - dstart < 1) continue;
        dirtRuns.push({ hor: false, a: dstart, b: dy2, c: dx2, seed: dj });
      }
    }
    function dirtPath(run, extra) {
      extra = extra || 0;
      g.beginPath();
      if (run.hor) {
        var yc = run.c * TILE + TILE / 2;
        for (var px = run.a * TILE; px <= run.b * TILE; px += 9) {
          var off = Math.sin(px * 0.075 + run.seed * 0.31) * 2.4 + extra;
          if (px === run.a * TILE) g.moveTo(px, yc + off); else g.lineTo(px, yc + off);
        }
      } else {
        var xc = run.c * TILE + TILE / 2;
        for (var py = run.a * TILE; py <= run.b * TILE; py += 9) {
          var off2 = Math.sin(py * 0.075 + run.seed * 0.27) * 2.4 + extra;
          if (py === run.a * TILE) g.moveTo(xc + off2, py); else g.lineTo(xc + off2, py);
        }
      }
    }
    g.strokeStyle = 'rgba(36,30,23,0.5)'; g.lineWidth = TILE * 0.92;
    dirtRuns.forEach(function (run) { dirtPath(run, 0); g.stroke(); });
    g.strokeStyle = '#5b4b35'; g.lineWidth = TILE * 0.64;
    dirtRuns.forEach(function (run) { dirtPath(run, 0); g.stroke(); });
    g.strokeStyle = 'rgba(40,32,24,0.4)'; g.lineWidth = 1.2;
    dirtRuns.forEach(function (run) { dirtPath(run, 4); g.stroke(); });
    g.restore();
    // 车道虚线（仅主干道）
    g.save();
    g.strokeStyle = 'rgba(225,240,245,0.24)';
    g.lineWidth = 1;
    g.setLineDash([14, 18]);
    for (var y4 = 0; y4 < H; y4++) {
      var x4 = 0;
      while (x4 < W) {
        var i4 = y4 * W + x4;
        if (w.road[i4] < 3 || w.bridge[i4]) { x4++; continue; }
        var s4 = x4;
        while (x4 < W && w.road[y4 * W + x4] >= 3 && !w.bridge[y4 * W + x4]) x4++;
        g.beginPath();
        g.moveTo(s4 * TILE + 8, y4 * TILE + TILE / 2);
        g.lineTo(x4 * TILE - 8, y4 * TILE + TILE / 2);
        g.stroke();
      }
    }
    for (var x5 = 0; x5 < W; x5++) {
      var y5 = 0;
      while (y5 < H) {
        var i5 = y5 * W + x5;
        if (w.road[i5] < 3 || w.bridge[i5]) { y5++; continue; }
        var s5 = y5;
        while (y5 < H && w.road[y5 * W + x5] >= 3 && !w.bridge[y5 * W + x5]) y5++;
        g.beginPath();
        g.moveTo(x5 * TILE + TILE / 2, s5 * TILE + 8);
        g.lineTo(x5 * TILE + TILE / 2, y5 * TILE - 8);
        g.stroke();
      }
    }
    g.restore();
    // 斑马线：只挑一部分大型路口，避免画面过碎
    g.save();
    g.strokeStyle = 'rgba(225,240,245,0.13)';
    g.lineWidth = 2;
    for (var ci = 0; ci < w.roadCells.length; ci++) {
      var cell = w.roadCells[ci];
      if (w.road[cell] < 3 || w.bridge[cell]) continue;
      var cxx = cell % W, cyy = (cell / W) | 0;
      if (cxx <= 0 || cyy <= 0 || cxx >= W - 1 || cyy >= H - 1) continue;
      var hasV = w.road[cell - 1] >= 3 && w.road[cell + 1] >= 3;
      var hasH = w.road[cell - W] >= 3 && w.road[cell + W] >= 3;
      if (!hasV || !hasH) continue;
      if ((cxx * 7 + cyy * 3) % 5 !== 0) continue;
      var bx = cxx * TILE, by = cyy * TILE;
      for (var k = 0; k < 3; k++) {
        g.beginPath(); g.moveTo(bx + 4, by + 5 + k * 4); g.lineTo(bx + TILE - 4, by + 5 + k * 4); g.stroke();
        g.beginPath(); g.moveTo(bx + 4, by + TILE - 13 + k * 4); g.lineTo(bx + TILE - 4, by + TILE - 13 + k * 4); g.stroke();
        g.beginPath(); g.moveTo(bx + 5 + k * 4, by + 4); g.lineTo(bx + 5 + k * 4, by + TILE - 4); g.stroke();
        g.beginPath(); g.moveTo(bx + TILE - 13 + k * 4, by + 4); g.lineTo(bx + TILE - 13 + k * 4, by + TILE - 4); g.stroke();
      }
    }
    g.restore();
    // 交叉口深色补丁
    g.fillStyle = 'rgba(18,24,30,0.35)';
    for (var i = 0; i < w.roadCells.length; i++) {
      var ci = w.roadCells[i];
      var cx = ci % W, cy = (ci / W) | 0;
      if (w.road[ci] >= 3 && !w.bridge[ci] && hash(ci) < 0.06) {
        g.fillRect(cx * TILE, cy * TILE, TILE, TILE);
      }
    }
    // 道路磨损/补丁/裂缝：让网格路不再像塑料板
    g.save();
    for (var wi = 0; wi < w.roadCells.length; wi++) {
      var wc = w.roadCells[wi];
      if (w.bridge[wc]) continue;
      var wx = (wc % W) * TILE, wy = ((wc / W) | 0) * TILE;
      var h1 = hash(wc * 5 + 11), h2 = hash(wc * 9 + 4);
      if (h1 < 0.05) {
        g.fillStyle = 'rgba(16,20,24,0.4)';
        g.beginPath(); g.ellipse(wx + 8 + h2 * 16, wy + 8 + h1 * 300, 3 + h2 * 6, 2 + h2 * 4, h1 * 3, 0, Math.PI * 2); g.fill();
      } else if (h1 < 0.085) {
        g.strokeStyle = 'rgba(12,16,20,0.45)';
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(wx + h2 * 24, wy + 4); g.lineTo(wx + 8 + h2 * 16, wy + 20); g.lineTo(wx + 4 + h2 * 22, wy + 30);
        g.stroke();
      } else if (h1 < 0.105) {
        g.fillStyle = 'rgba(110,100,80,0.22)';
        g.fillRect(wx + h2 * 18, wy + 3, 6 + h2 * 8, 3 + h2 * 5);
      }

    }
    g.restore();
    // 高速护栏与黄色边线
    if (w.highwayY != null) {
      var hy = w.highwayY * TILE;
      g.save();
      g.strokeStyle = 'rgba(240,200,90,0.35)';
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(4 * TILE, hy - TILE + 4); g.lineTo(136 * TILE, hy - TILE + 4); g.stroke();
      g.strokeStyle = 'rgba(180,195,200,0.3)';
      g.lineWidth = 3;
      g.setLineDash([10, 14]);
      g.beginPath(); g.moveTo(4 * TILE, hy + TILE * 2 - 4); g.lineTo(136 * TILE, hy + TILE * 2 - 4); g.stroke();
      g.restore();
    }
  };

  Renderer.prototype.drawTunnels = function (g) {
    if (!this.world || !this.world.tunnels) return;
    this.world.tunnels.forEach(function (t) {
      var x = t.x * TILE, y = t.y * TILE, ww = t.w * TILE, hh = t.h * TILE;
      // 隧道顶棚
      g.fillStyle = 'rgba(15,20,26,0.82)';
      g.fillRect(x - 2, y - 2, ww + 4, hh + 4);
      g.strokeStyle = 'rgba(120,145,155,0.22)';
      g.lineWidth = 2;
      g.strokeRect(x, y, ww, hh);
      // 顶灯
      g.strokeStyle = 'rgba(255,210,130,0.28)';
      g.lineWidth = 1;
      g.setLineDash([4, 10]);
      g.beginPath();
      if (t.w === 1) {
        g.moveTo(x + ww / 2, y + 4); g.lineTo(x + ww / 2, y + hh - 4);
      } else {
        g.moveTo(x + 4, y + hh / 2); g.lineTo(x + ww - 4, y + hh / 2);
      }
      g.stroke();
      g.setLineDash([]);
      // 两端洞口
      g.fillStyle = 'rgba(6,10,14,0.9)';
      if (t.w === 1) {
        g.fillRect(x - 5, y - 5, ww + 10, 7);
        g.fillRect(x - 5, y + hh - 2, ww + 10, 7);
      } else {
        g.fillRect(x - 5, y - 5, 7, hh + 10);
        g.fillRect(x + ww - 2, y - 5, 7, hh + 10);
      }
    }, this);
  };

  Renderer.prototype.drawBridges = function (g) {
    var w = this.world;
    for (var y = 0; y < H; y++) {
      var x = 0;
      while (x < W) {
        if (!w.bridge[y * W + x]) { x++; continue; }
        var s = x;
        while (x < W && w.bridge[y * W + x]) x++;
        g.fillStyle = '#44403a';
        g.fillRect(s * TILE - 2, y * TILE - 2, (x - s) * TILE + 4, TILE + 4);
        g.strokeStyle = 'rgba(230,220,190,0.22)';
        g.lineWidth = 2;
        g.beginPath(); g.moveTo(s * TILE, y * TILE + 4); g.lineTo(x * TILE, y * TILE + 4); g.stroke();
        g.beginPath(); g.moveTo(s * TILE, y * TILE + TILE - 4); g.lineTo(x * TILE, y * TILE + TILE - 4); g.stroke();
      }
    }
    for (var x2 = 0; x2 < W; x2++) {
      var y2 = 0;
      while (y2 < H) {
        if (!w.bridge[y2 * W + x2]) { y2++; continue; }
        var s2 = y2;
        while (y2 < H && w.bridge[y2 * W + x2]) y2++;
        if (y2 - s2 <= 1) continue;
        g.fillStyle = '#44403a';
        g.fillRect(x2 * TILE - 2, s2 * TILE - 2, TILE + 4, (y2 - s2) * TILE + 4);
        g.strokeStyle = 'rgba(230,220,190,0.22)';
        g.lineWidth = 2;
        g.beginPath(); g.moveTo(x2 * TILE + 4, s2 * TILE); g.lineTo(x2 * TILE + 4, y2 * TILE); g.stroke();
        g.beginPath(); g.moveTo(x2 * TILE + TILE - 4, s2 * TILE); g.lineTo(x2 * TILE + TILE - 4, y2 * TILE); g.stroke();
      }
    }
  };

  Renderer.prototype.drawTrees = function (g) {
    var self = this;
    this.world.trees.forEach(function (t) { self.drawTree(g, t.x, t.y, t.r, t.shade); });
  };
  Renderer.prototype.drawTree = function (g, x, y, r, shade) {
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.beginPath(); g.ellipse(x + 3, y + 4, r * 0.9, r * 0.65, 0, 0, Math.PI * 2); g.fill();
    var greens = ['#2b4a31', '#31553a', '#26422c', '#375c3b'];
    g.fillStyle = greens[Math.floor(shade * greens.length) % greens.length];
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(150,200,140,0.10)';
    g.beginPath(); g.arc(x - r * 0.3, y - r * 0.35, r * 0.55, 0, Math.PI * 2); g.fill();
  };

  Renderer.prototype.drawLampPoles = function (g) {
    this.world.lamps.forEach(function (l) {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(l.x - 1, l.y + 2, 3, 2);
      g.fillStyle = '#3d444b';
      g.fillRect(l.x - 1, l.y - 5, 2, 6);
    });
  };

  Renderer.prototype.drawParkedCars = function (g) {
    this.world.parkedCars.forEach(function (c) {
      g.save();
      g.translate(c.x, c.y); g.rotate(c.a);
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(-7, -3, 15, 7);
      g.fillStyle = c.c;
      g.fillRect(-7, -3, 14, 6);
      g.fillStyle = 'rgba(200,230,240,0.3)';
      g.fillRect(-3, -2, 4, 4);
      g.restore();
    });
  };

  Renderer.prototype.drawBuildings = function (g) {
    var self = this;
    var list = this.world.buildings.slice().sort(function (a, b) {
      var fa = (a.kind === 'field' || a.kind === 'runway' || a.kind === 'prison_yard') ? 0 : 1;
      var fb = (b.kind === 'field' || b.kind === 'runway' || b.kind === 'prison_yard') ? 0 : 1;
      return fa - fb || a.y - b.y;
    });
    list.forEach(function (b) { self.drawBuilding(g, b); });
  };

  Renderer.prototype.drawBuilding = function (g, b) {
    var x = b.x * TILE, y = b.y * TILE, w = b.w * TILE, h = b.h * TILE;
    if (b.kind === 'field') {
      g.fillStyle = '#33432b';
      g.fillRect(x, y, w, h);
      var rng = U.mulberry32(b.seed + 3);
      g.strokeStyle = 'rgba(170,180,90,0.22)';
      g.lineWidth = 2;
      for (var fy = y + 8; fy < y + h; fy += 9) {
        g.beginPath(); g.moveTo(x + 4, fy); g.lineTo(x + w - 4, fy); g.stroke();
      }
      g.strokeStyle = 'rgba(0,0,0,0.2)';
      g.strokeRect(x + 1, y + 1, w - 2, h - 2);
      return;
    }
    if (b.kind === 'runway') {
      this.drawRunway(g, b);
      return;
    }
    if (b.kind === 'prison_yard') {
      g.fillStyle = '#34383a';
      g.fillRect(x, y, w, h);
      g.strokeStyle = 'rgba(220,220,200,0.18)';
      g.lineWidth = 2;
      g.strokeRect(x + 10, y + 10, w - 20, h - 20);
      g.beginPath(); g.moveTo(x + w / 2, y + 10); g.lineTo(x + w / 2, y + h - 10); g.stroke();
      g.beginPath(); g.arc(x + w / 2, y + h / 2, Math.min(w, h) * 0.17, 0, Math.PI * 2); g.stroke();
      return;
    }
    // 投影
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.fillRect(x + 6, y + 8, w, h);
    // 主体：夜色里稍微提亮，避免整张图糊成黑块
    var bodyColor = U.mixHex(b.color || '#3a4652', '#93a2af', 0.28);
    var roofColor = U.mixHex(b.roof || '#2b323b', '#8896a2', 0.22);
    g.fillStyle = bodyColor;
    g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 2;
    g.strokeRect(x + 1, y + 1, w - 2, h - 2);
    // 屋顶
    var inset = 3;
    g.fillStyle = roofColor;
    g.fillRect(x + inset, y + inset, w - inset * 2, h - inset * 2);
    g.strokeStyle = 'rgba(190,225,240,0.1)';
    g.lineWidth = 1;
    g.strokeRect(x + inset + 1, y + inset + 1, w - inset * 2 - 2, h - inset * 2 - 2);
    // 顶部高光，让建筑从地面里浮出来
    g.fillStyle = 'rgba(180,215,235,0.14)';
    g.fillRect(x + inset + 2, y + inset + 2, w - inset * 2 - 4, 2);
    // 楼层线（暗示高度）
    var floors = Math.min(26, b.floors || 1);
    if (floors > 1) {
      g.strokeStyle = 'rgba(0,0,0,0.18)';
      for (var f = 1; f < Math.min(floors, 8); f++) {
        var ly = y + inset + 2 + (h - inset * 2 - 4) * f / Math.min(floors, 8);
        g.beginPath(); g.moveTo(x + inset + 2, ly); g.lineTo(x + w - inset - 2, ly); g.stroke();
      }
    }
    // 屋顶细节
    this.drawRoofDetail(g, b, x, y, w, h);
    // 站点标识：让玩家一眼看出这是消防/警务/医疗基地
    if (b.stationId) {
      var stDef = D.STATIONS.find(function (s) { return s.id === b.stationId; });
      if (stDef) {
        var svc = D.STATION_STYLE[stDef.type];
        g.strokeStyle = U.alpha(svc.color, 0.65);
        g.lineWidth = 2;
        g.strokeRect(x + 2, y + 2, w - 4, h - 4);
        g.fillStyle = U.alpha(svc.color, 0.16);
        g.fillRect(x + 4, y + 4, w - 8, 5);
        g.font = '15px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(svc.icon, x + w / 2, y + h / 2);
      }
    }
  };

  Renderer.prototype.drawRoofDetail = function (g, b, x, y, w, h) {
    var rng = U.mulberry32(b.seed + 11);
    var k = b.kind;
    g.save();
    if (b.tag === 'gas_station' || b.tag === 'air_fuel') {
      // 加油站：顶棚 + 两台加油机；航空加油站额外画 H 停机标
      g.fillStyle = 'rgba(240,200,80,0.22)';
      g.fillRect(x + 3, y + 4, w - 6, h - 8);
      g.strokeStyle = 'rgba(245,225,150,0.55)';
      g.lineWidth = 1.5;
      g.strokeRect(x + 5, y + 5, w - 10, h - 10);
      g.fillStyle = 'rgba(30,38,45,0.8)';
      g.fillRect(x + w * 0.3, y + h * 0.35, 6, 10);
      g.fillRect(x + w * 0.62, y + h * 0.35, 6, 10);
      g.fillStyle = 'rgba(255,220,100,0.65)';
      g.fillRect(x + w * 0.3, y + h * 0.33, 6, 2);
      g.fillRect(x + w * 0.62, y + h * 0.33, 6, 2);
      if (b.tag === 'air_fuel') {
        g.strokeStyle = 'rgba(180,235,255,0.5)';
        g.beginPath(); g.arc(x + w * 0.5, y + h * 0.5, Math.min(w, h) * 0.18, 0, Math.PI * 2); g.stroke();
        g.fillStyle = 'rgba(180,235,255,0.5)';
        g.font = 'bold 10px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('H', x + w * 0.5, y + h * 0.5);
      }
      g.restore();
      return;
    }
    if (k === 'hospital') {
      g.fillStyle = '#e8eeee';
      g.fillRect(x + w * 0.5 - 12, y + h * 0.5 - 3, 24, 6);
      g.fillRect(x + w * 0.5 - 3, y + h * 0.5 - 12, 6, 24);
      g.fillStyle = '#d64545';
      g.fillRect(x + w * 0.5 - 8, y + h * 0.5 - 2, 16, 4);
      g.fillRect(x + w * 0.5 - 2, y + h * 0.5 - 8, 4, 16);
      // 停机坪 H
      g.strokeStyle = 'rgba(245,245,240,0.5)';
      g.lineWidth = 2;
      g.beginPath(); g.arc(x + w * 0.22, y + h * 0.3, 11, 0, Math.PI * 2); g.stroke();
      g.fillStyle = 'rgba(245,245,240,0.55)';
      g.font = 'bold 11px ' + FONT;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('H', x + w * 0.22, y + h * 0.3);
    } else if (k === 'police_hq') {
      g.fillStyle = 'rgba(70,140,230,0.5)';
      g.fillRect(x + 5, y + h - 12, w - 10, 3);
      g.fillStyle = 'rgba(230,240,250,0.18)';
      g.fillRect(x + 8, y + 8, w - 16, 6);
    } else if (k === 'fire_station') {
      g.fillStyle = 'rgba(160,50,38,0.7)';
      for (var d = 0; d < 3; d++) {
        g.fillRect(x + 8 + d * ((w - 16) / 3), y + h - 17, (w - 20) / 3 - 3, 12);
      }
    } else if (k === 'mall') {
      g.strokeStyle = 'rgba(230,220,180,0.2)';
      g.lineWidth = 1;
      for (var mx = x + 10; mx < x + w - 8; mx += 12) {
        g.beginPath(); g.moveTo(mx, y + 10); g.lineTo(mx, y + h - 10); g.stroke();
      }
      g.fillStyle = 'rgba(255,210,120,0.18)';
      g.fillRect(x + w * 0.3, y + h * 0.4, w * 0.4, h * 0.15);
    } else if (k === 'terminal' || k === 'hangar') {
      g.strokeStyle = 'rgba(210,230,240,0.14)';
      g.lineWidth = 1;
      for (var tx = x + 8; tx < x + w - 6; tx += 11) {
        g.beginPath(); g.moveTo(tx, y + 6); g.lineTo(tx - 4, y + h - 6); g.stroke();
      }
    } else if (k === 'tower') {
      g.fillStyle = '#3c4752';
      g.beginPath(); g.arc(x + w / 2, y + h / 2, Math.min(w, h) * 0.3, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(220,240,250,0.22)';
      g.lineWidth = 2;
      g.beginPath(); g.arc(x + w / 2, y + h / 2, Math.min(w, h) * 0.2, 0, Math.PI * 2); g.stroke();
    } else if (k === 'tank') {
      g.fillStyle = b.color || '#5c5c47';
      g.beginPath(); g.ellipse(x + w / 2, y + h / 2, w / 2 - 2, h / 2 - 2, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.lineWidth = 2;
      g.beginPath(); g.ellipse(x + w / 2, y + h / 2, w / 2 - 8, h / 2 - 8, 0, 0, Math.PI * 2); g.stroke();
      g.fillStyle = 'rgba(240,220,100,0.3)';
      g.beginPath(); g.arc(x + w / 2, y + h / 2, 4, 0, Math.PI * 2); g.fill();
    } else if (k === 'chemical') {
      g.strokeStyle = 'rgba(200,220,230,0.14)';
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(x + 10, y + h * 0.3); g.lineTo(x + w - 10, y + h * 0.3); g.stroke();
      g.beginPath(); g.moveTo(x + w * 0.7, y + h * 0.3); g.lineTo(x + w * 0.7, y + h - 10); g.stroke();
      g.fillStyle = 'rgba(210,190,80,0.22)';
      g.beginPath(); g.arc(x + w * 0.35, y + h * 0.55, 8, 0, Math.PI * 2); g.fill();
    } else if (k === 'factory' || k === 'warehouse') {
      g.strokeStyle = 'rgba(0,0,0,0.2)';
      g.lineWidth = 2;
      for (var fy = y + 10; fy < y + h - 8; fy += 13) {
        g.beginPath(); g.moveTo(x + 6, fy); g.lineTo(x + w - 6, fy); g.stroke();
      }
      g.fillStyle = 'rgba(220,215,190,0.08)';
      g.fillRect(x + 10, y + 8, 12, 8);
    } else if (k === 'prison_block') {
      g.strokeStyle = 'rgba(200,210,220,0.12)';
      g.lineWidth = 1;
      for (var px = x + 8; px < x + w - 6; px += 6) {
        g.beginPath(); g.moveTo(px, y + 8); g.lineTo(px, y + h - 8); g.stroke();
      }
      g.fillStyle = 'rgba(180,190,200,0.12)';
      g.fillRect(x + 6, y + 5, w - 12, 3);
    } else if (k === 'school') {
      g.strokeStyle = 'rgba(230,220,180,0.2)';
      g.lineWidth = 2;
      g.beginPath(); g.arc(x + w * 0.5, y + h * 0.5, Math.min(w, h) * 0.25, 0, Math.PI * 2); g.stroke();
    } else if (k === 'rail_station') {
      // 站台雨棚 + 时钟
      g.strokeStyle = 'rgba(205,220,230,0.16)';
      g.lineWidth = 1;
      for (var rx = x + 10; rx < x + w - 8; rx += 10) {
        g.beginPath(); g.moveTo(rx, y + 8); g.lineTo(rx - 3, y + h - 8); g.stroke();
      }
      g.fillStyle = 'rgba(230,240,245,0.22)';
      g.beginPath(); g.arc(x + w / 2, y + h / 2, Math.min(w, h) * 0.13, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(10,20,28,0.8)';
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(x + w / 2, y + h / 2); g.lineTo(x + w / 2, y + h / 2 - 8); g.stroke();
    } else {
      // 普通建筑：水塔/空调机组
      var n = 1 + Math.floor(rng() * 2);
      for (var i = 0; i < n; i++) {
        var bx = x + 8 + rng() * (w - 22), by = y + 8 + rng() * (h - 22);
        g.fillStyle = 'rgba(190,205,210,0.12)';
        g.fillRect(bx, by, 7 + rng() * 5, 6 + rng() * 4);
      }
      if (b.floors > 8) {
        g.fillStyle = 'rgba(190,210,220,0.15)';
        g.fillRect(x + w * 0.5 - 1, y + 6, 2, h - 12);
      }
    }
    g.restore();
  };

  Renderer.prototype.drawRunway = function (g, b) {
    var x = b.x * TILE, y = b.y * TILE, w = b.w * TILE, h = b.h * TILE;
    g.fillStyle = '#2b3138';
    g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.4)';
    g.strokeRect(x, y, w, h);
    // 中线
    g.save();
    g.strokeStyle = 'rgba(235,240,235,0.42)';
    g.lineWidth = 3;
    g.setLineDash([26, 22]);
    g.beginPath(); g.moveTo(x + 40, y + h / 2); g.lineTo(x + w - 40, y + h / 2); g.stroke();
    g.setLineDash([]);
    // 端部斑马线
    g.lineWidth = 4;
    for (var i = 0; i < 8; i++) {
      g.beginPath(); g.moveTo(x + 18 + i * 8, y + 12); g.lineTo(x + 18 + i * 8, y + h - 12); g.stroke();
      g.beginPath(); g.moveTo(x + w - 18 - i * 8, y + 12); g.lineTo(x + w - 18 - i * 8, y + h - 12); g.stroke();
    }
    g.fillStyle = 'rgba(235,240,235,0.5)';
    g.font = 'bold 26px ' + FONT;
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('09', x + 80, y + h * 0.5);
    g.textAlign = 'right';
    g.fillText('27', x + w - 80, y + h * 0.5);
    g.restore();
    // 边灯
    for (var lx = x + 20; lx < x + w; lx += 64) {
      g.fillStyle = 'rgba(230,240,255,0.5)';
      g.fillRect(lx, y + 2, 3, 2);
      g.fillRect(lx, y + h - 4, 3, 2);
    }
  };

  Renderer.prototype.drawPrisonWall = function (g) {
    var p = this.world.specials && this.world.specials.prison;
    if (!p) return;
    var x = p.x * TILE, y = p.y * TILE, w = p.w * TILE, h = p.h * TILE;
    g.save();
    g.strokeStyle = '#383d42';
    g.lineWidth = 12;
    g.strokeRect(x + 18, y + 18, w - 36, h - 36);
    g.strokeStyle = 'rgba(160,180,190,0.2)';
    g.lineWidth = 2;
    g.setLineDash([4, 6]);
    g.strokeRect(x + 18, y + 18, w - 36, h - 36);
    g.setLineDash([]);
    // 大门
    g.fillStyle = '#1d2329';
    g.fillRect(x + w / 2 - 22, y + 8, 44, 20);
    g.fillStyle = 'rgba(200,220,230,0.3)';
    g.fillRect(x + w / 2 - 16, y + 12, 32, 3);
    g.restore();
  };

  /* ============================ 世界准备 ============================ */
  Renderer.prototype.prepareWorld = function () {
    var w = this.world, windows = [], beacons = [];
    w.buildings.forEach(function (b) {
      if (b.kind === 'field' || b.kind === 'runway' || b.kind === 'prison_yard') return;
      var rng = U.mulberry32(b.seed + 21);
      var count = Math.min(42, Math.max(4, Math.round((b.w * b.h) * 1.05 + (b.floors || 1) * 1.3)));
      for (var i = 0; i < count; i++) {
        var wx = (b.x + 0.14 + rng() * (b.w - 0.28)) * TILE;
        var wy = (b.y + 0.14 + rng() * (b.h - 0.28)) * TILE;
        windows.push({
          x: wx, y: wy,
          s: 1 + Math.floor(rng() * 2),
          a: 0.32 + rng() * 0.62,
          warm: rng() < 0.7
        });
      }
      if ((b.floors || 0) > 8 || b.kind === 'tower' || b.kind === 'terminal') {
        beacons.push({ x: b.cx, y: b.cy, phase: rng() * Math.PI * 2, kind: b.kind });
      }
    });
    this.windows = windows;
    this.beacons = beacons;
  };

  /* 将窗灯/路灯/城市环境光一次性烘焙到低分辨率光照画布，之后每帧只贴一张图。
     这是本次性能优化的核心：原来每帧要画数千个小矩形和上百个光晕。 */
  Renderer.prototype.buildLights = function () {
    if (!this.world) return;
    if (!this.quality.lights) { this.lightCanvas = null; return; }
    var scale = 0.25;
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(WORLD_W * scale));
    c.height = Math.max(1, Math.round(WORLD_H * scale));
    var g = c.getContext('2d');
    g.scale(scale, scale);
    g.globalCompositeOperation = 'lighter';
    // 城市环境光
    var cityGlow = this.glowSprite('#ff9a55');
    g.globalAlpha = 0.16;
    g.drawImage(cityGlow, 10 * TILE, 10 * TILE, 50 * TILE, 32 * TILE);
    g.globalAlpha = 0.1;
    g.drawImage(this.glowSprite('#7bd7ff'), 78 * TILE, 10 * TILE, 46 * TILE, 26 * TILE);
    // 路灯
    var lampSprite = this.glowSprite('#ffb570');
    for (var i = 0; i < this.world.lamps.length; i++) {
      var l = this.world.lamps[i];
      var r = 46 + (i % 5) * 5;
      g.globalAlpha = 0.3;
      g.drawImage(lampSprite, l.x - r, l.y - r, r * 2, r * 2);
    }
    // 窗灯
    g.globalAlpha = 1;
    for (var j = 0; j < this.windows.length; j++) {
      var win = this.windows[j];
      g.fillStyle = win.warm ? 'rgba(255,190,110,' + win.a + ')' : 'rgba(140,205,240,' + win.a * 0.7 + ')';
      g.fillRect(win.x, win.y, win.s, win.s * 0.8);
    }
    this.lightCanvas = c;
  };

  Renderer.prototype.drawStaticLights = function (light) {
    var night = this.nightFactor(light);
    var ctx = this.ctx;
    if (night > 0.12 && this.quality.lights && this.lightCanvas) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, night);
      ctx.drawImage(this.lightCanvas, 0, 0, WORLD_W, WORLD_H);
      ctx.restore();
    }
    // 高楼航空障碍灯保持动态
    if (night > 0.3 && light.alpha > 0.1) {
      this.beacons.forEach(function (b) {
        if (!this.isVisible(b.x, b.y, 30)) return;
        var on = (Math.sin(this.time * 2.2 + b.phase) + 1) * 0.5 > 0.55;
        if (!on) return;
        ctx.fillStyle = 'rgba(255,70,70,0.75)';
        ctx.beginPath(); ctx.arc(b.x, b.y, 2.2, 0, Math.PI * 2); ctx.fill();
      }, this);
    }
  };

  Renderer.prototype.initTraffic = function () {
    this.traffic = [];
    if (!this.world) return;
    var n = this.quality.traffic || 30;
    var cells = this.world.trafficCells;
    if (!cells || !cells.length) return;
    var rng = U.mulberry32(this.world.seed + 555);
    var colors = ['#9aa6b1', '#8b7d6d', '#c3c8cc', '#6a7883', '#b09a7c', '#7f8f9b', '#a34d43', '#4d6e8a'];
    for (var i = 0; i < n; i++) {
      var cell = cells[Math.floor(rng() * cells.length)];
      var cx = cell % W, cy = (cell / W) | 0;
      var dirs = this.trafficDirs(cx, cy);
      if (!dirs.length) continue;
      var dir = dirs[Math.floor(rng() * dirs.length)];
      this.traffic.push({
        x: cx * TILE + TILE / 2, y: cy * TILE + TILE / 2,
        cx: cx, cy: cy, tx: cx + dir[0], ty: cy + dir[1],
        speed: 34 + rng() * 26, color: colors[Math.floor(rng() * colors.length)],
        wait: 0
      });
    }
  };
  Renderer.prototype.trafficDirs = function (cx, cy) {
    var dirs = [], w = this.world;
    var opts = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var i = 0; i < opts.length; i++) {
      var nx = cx + opts[i][0], ny = cy + opts[i][1];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (w.road[ny * W + nx] >= 2) dirs.push(opts[i]);
    }
    return dirs;
  };

  Renderer.prototype.initRain = function () {
    this.rain = [];
    var count = this.settings.weatherFx ? Math.round((this.w * this.h) / 18000 * (this.quality.particles || 1) * 2) : 0;
    count = Math.min(120, count);
    for (var i = 0; i < count; i++) {
      this.rain.push({
        x: Math.random() * this.w, y: Math.random() * this.h,
        len: 6 + Math.random() * 16, sp: 260 + Math.random() * 360,
        a: 0.08 + Math.random() * 0.16
      });
    }
  };

  /* ============================ 动态绘制 ============================ */
  Renderer.prototype.isVisible = function (x, y, pad) {
    pad = pad || 80;
    var halfW = this.w / (2 * this.cam.zoom), halfH = this.h / (2 * this.cam.zoom);
    return x > this.cam.x - halfW - pad && x < this.cam.x + halfW + pad &&
      y > this.cam.y - halfH - pad && y < this.cam.y + halfH + pad;
  };

  Renderer.prototype.drawBase = function (ctx) {
    if (!this.base) {
      ctx.fillStyle = '#0a1017';
      ctx.fillRect(0, 0, WORLD_W, WORLD_H);
      return;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.base, 0, 0, WORLD_W, WORLD_H);
  };

  Renderer.prototype.nightFactor = function (light) {
    return (light || D.LIGHTS.night).lights || 0;
  };

  Renderer.prototype.drawNightMask = function (light) {
    var L = light || D.LIGHTS.night;
    if (!L.alpha) return;
    var ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = U.alpha(L.tint || '#050b16', L.alpha);
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    ctx.restore();
  };

  Renderer.prototype.glowSprite = function (color) {
    if (this._glows[color]) return this._glows[color];
    var c = document.createElement('canvas');
    c.width = 96; c.height = 96;
    var g = c.getContext('2d');
    var gr = g.createRadialGradient(48, 48, 2, 48, 48, 46);
    gr.addColorStop(0, U.alpha(color, 0.7));
    gr.addColorStop(0.35, U.alpha(color, 0.28));
    gr.addColorStop(1, U.alpha(color, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, 96, 96);
    this._glows[color] = c;
    return c;
  };

  Renderer.prototype.drawWindows = function (sim, light) {
    var night = this.nightFactor(light);
    if (night < 0.15 || !this.quality.lights) return;
    var ctx = this.ctx;
    var maxZ = this.cam.zoom;
    var quality = this.quality.windows || 1;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var count = 0;
    var limit = Math.round(this.windows.length * Math.min(1, quality));
    for (var i = 0; i < this.windows.length; i++) {
      var win = this.windows[i];
      if (!this.isVisible(win.x, win.y, 20)) continue;
      if (count++ > limit) break;
      if (maxZ < 0.4 && (i % 2)) continue;
      var a = win.a * night;
      ctx.fillStyle = win.warm ? 'rgba(255,190,110,' + a + ')' : 'rgba(140,205,240,' + a * 0.7 + ')';
      ctx.fillRect(win.x, win.y, win.s, win.s * 0.8);
    }
    ctx.restore();
    // 高楼航空障碍灯
    if (light === D.LIGHTS.night || light === D.LIGHTS.dusk) {
      this.beacons.forEach(function (b) {
        if (!this.isVisible(b.x, b.y, 30)) return;
        var on = (Math.sin(this.time * 2.2 + b.phase) + 1) * 0.5 > 0.55;
        if (!on) return;
        ctx.fillStyle = 'rgba(255,70,70,0.75)';
        ctx.beginPath(); ctx.arc(b.x, b.y, 2.4, 0, Math.PI * 2); ctx.fill();
      }, this);
    }
  };

  Renderer.prototype.drawLamps = function (light) {
    var night = this.nightFactor(light);
    if (night < 0.12 || !this.quality.lights) return;
    var ctx = this.ctx;
    var sprite = this.glowSprite('#ffb570');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < this.world.lamps.length; i++) {
      var l = this.world.lamps[i];
      if (!this.isVisible(l.x, l.y, 40)) continue;
      var r = 30 + (i % 5) * 4;
      ctx.globalAlpha = 0.08 * night;
      ctx.drawImage(sprite, l.x - r, l.y - r, r * 2, r * 2);
    }
    // 城市整体环境光
    var cityGlow = this.glowSprite('#ff9a55');
    ctx.globalAlpha = 0.07 * night;
    ctx.drawImage(cityGlow, 10 * TILE, 10 * TILE, 50 * TILE, 32 * TILE);
    ctx.globalAlpha = 0.05 * night;
    ctx.drawImage(this.glowSprite('#7bd7ff'), 78 * TILE, 10 * TILE, 46 * TILE, 26 * TILE);
    ctx.restore();
  };

  Renderer.prototype.drawStations = function (light) {
    var night = this.nightFactor(light);
    var ctx = this.ctx;
    this.world.stations.forEach(function (st) {
      var b = st.building;
      if (!b || !this.isVisible(b.cx, b.cy, 80)) return;
      var svc = D.STATION_STYLE[st.type];
      var sprite = this.glowSprite(svc.color);
      var r = 24;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.1 + night * 0.12;
      ctx.drawImage(sprite, b.cx - r, b.cy - r, r * 2, r * 2);
      ctx.restore();
      ctx.save();
      ctx.font = '12px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(svc.icon, b.cx, b.cy);
      ctx.restore();
    }, this);
  };

  Renderer.prototype.drawIncidentGround = function (sim) {
    if (!sim) return;
    var ctx = this.ctx;
    var t = this.time;
    sim.incidents.forEach(function (inc) {
      if (inc.status !== 'active') return;
      var color = D.PRIORITIES[inc.priority].color;
      var b = inc.buildingId ? this.world.buildingsById[inc.buildingId] : null;
      if (b) {
        ctx.save();
        ctx.strokeStyle = U.alpha(color, 0.5);
        ctx.lineWidth = 2;
        ctx.setLineDash([7, 7]);
        ctx.lineDashOffset = -t * 14;
        ctx.strokeRect(b.x * TILE - 5, b.y * TILE - 5, b.w * TILE + 10, b.h * TILE + 10);
        ctx.restore();
      }
      // 火焰 / 危化 / 警灯氛围
      var isFire = inc.icon === '🔥' || inc.defId === 'chem_explosion' || inc.defId === 'tank_fire';
      if (isFire) {
        var sprite = this.glowSprite('#ff7a2f');
        var rr = 62 + Math.sin(t * 5 + inc.x) * 8;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.22;
        ctx.drawImage(sprite, inc.x - rr, inc.y - rr, rr * 2, rr * 2);
        ctx.restore();
      }
      if (inc.defId === 'factory_leak' || inc.defId === 'chem_explosion' || inc.defId === 'gas_leak') {
        ctx.save();
        ctx.fillStyle = 'rgba(160,210,80,0.08)';
        for (var i = 0; i < 5; i++) {
          var a = t * 0.35 + i * 1.7 + inc.x * 0.01;
          var rr2 = 30 + i * 13;
          ctx.beginPath();
          ctx.arc(inc.x + Math.cos(a) * 16, inc.y + Math.sin(a * 1.3) * 12, rr2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      if (inc.defId === 'prison_riot' || inc.defId === 'suspicious_bag' || inc.defId === 'robbery') {
        ctx.save();
        var flash = (Math.sin(t * 9 + inc.y) + 1) * 0.5;
        ctx.fillStyle = 'rgba(90,150,255,' + (0.05 + flash * 0.05) + ')';
        ctx.beginPath(); ctx.arc(inc.x, inc.y, 38, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }, this);
  };

  Renderer.prototype.drawRoutes = function (sim) {
    if (!sim || !this.selectedIncident) return;
    var inc = sim.incidentById[this.selectedIncident];
    if (!inc || inc.status !== 'active') return;
    var ctx = this.ctx;
    var color = D.PRIORITIES[inc.priority].color;
    ctx.save();
    ctx.strokeStyle = U.alpha(color, 0.4);
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 7]);
    ctx.lineDashOffset = -this.time * 24;
    inc.assigned.forEach(function (uid) {
      var u = sim.unitById[uid];
      if (!u || u.status === 'returning' || u.status === 'resting' || u.status === 'idle') return;
      ctx.beginPath();
      ctx.moveTo(u.x, u.y);
      ctx.lineTo(inc.access.x, inc.access.y);
      ctx.stroke();
    });
    ctx.restore();
  };

  Renderer.prototype.drawTraffic = function (light) {
    var ctx = this.ctx;
    var night = this.nightFactor(light);
    var t = this.time;
    for (var i = 0; i < this.traffic.length; i++) {
      var c = this.traffic[i];
      if (!this.isVisible(c.x, c.y, 30)) continue;
      var ang = Math.atan2(c.ty * TILE + TILE / 2 - c.y, c.tx * TILE + TILE / 2 - c.x);
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(ang || 0);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(-7, 2, 15, 5);
      ctx.fillStyle = c.color;
      ctx.fillRect(-7, -3, 14, 6);
      ctx.fillStyle = 'rgba(20,30,40,0.6)';
      ctx.fillRect(-3, -2, 5, 4);
      if (night > 0.2) {
        ctx.fillStyle = 'rgba(255,230,170,' + (0.5 * night) + ')';
        ctx.fillRect(6, -3, 2, 2);
        ctx.fillRect(6, 1, 2, 2);
      }
      ctx.restore();
    }
  };

  Renderer.prototype.updateTraffic = function (dt) {
    for (var i = 0; i < this.traffic.length; i++) {
      var c = this.traffic[i];
      var tx = c.tx * TILE + TILE / 2, ty = c.ty * TILE + TILE / 2;
      var dx = tx - c.x, dy = ty - c.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      var step = c.speed * dt;
      if (step >= d) {
        var fromX = c.cx, fromY = c.cy;
        c.x = tx; c.y = ty; c.cx = c.tx; c.cy = c.ty;
        var dirs = this.trafficDirs(c.cx, c.cy);
        // 尽量不原地掉头
        var backX = fromX - c.cx, backY = fromY - c.cy;
        var forward = dirs.filter(function (dd) { return !(dd[0] === backX && dd[1] === backY); });
        var pick = forward.length ? forward[Math.floor(Math.random() * forward.length)] : (dirs.length ? dirs[Math.floor(Math.random() * dirs.length)] : [1, 0]);
        c.tx = c.cx + pick[0]; c.ty = c.cy + pick[1];
        if (c.tx < 0 || c.ty < 0 || c.tx >= W || c.ty >= H) { c.tx = c.cx; c.ty = c.cy; }
      } else {
        c.x += (dx / d) * step;
        c.y += (dy / d) * step;
      }
    }
  };

  Renderer.prototype.drawUnits = function (sim) {
    if (!sim) return;
    var ctx = this.ctx;
    var t = this.time;
    sim.units.forEach(function (u) {
      if (!this.isVisible(u.x, u.y, 80)) return;
      var def = u.def || D.UNITS[u.type] || D.UNITS.cruiser;
      var selected = this.selected && this.selected.kind === 'unit' && this.selected.id === u.id;
      var angle = u.angle || 0;
      var L = def.size.len * 1.16, Wd = def.size.wid * 1.16;
      var active = u.status === 'enroute' || u.status === 'scene';
      // 阴影
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      if (u.flying) {
        ctx.beginPath(); ctx.ellipse(u.x + 26, u.y + 34, L * 0.3, Wd * 0.48, 0, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.beginPath(); ctx.ellipse(u.x + 3, u.y + 5, L * 0.44, Wd * 0.52, angle, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      // 远景 LOD：地图缩小时只画色块+灯条，避免 28 辆车逐辆画细节拖慢帧率
      if (this.cam.zoom < 0.7 && !u.flying) {
        ctx.save();
        ctx.translate(u.x, u.y);
        ctx.rotate(angle);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        rr(ctx, -L / 2 + 2, -Wd / 2 + 3, L, Wd, 3); ctx.fill();
        ctx.fillStyle = def.color;
        rr(ctx, -L / 2, -Wd / 2, L, Wd, 3); ctx.fill();
        ctx.fillStyle = def.accent;
        ctx.fillRect(-L * 0.22, -Wd / 2 + 2, L * 0.34, Wd - 4);
        if (active) {
          ctx.fillStyle = def.service === 'medical' ? '#ff6b7a' : def.service === 'fire' ? '#ffb15c' : '#5aaaff';
          ctx.fillRect(-4, -Wd / 2 - 1.5, 8, 3);
        }
        ctx.restore();
        if (selected) {
          ctx.save(); ctx.strokeStyle = 'rgba(103,220,255,0.9)'; ctx.lineWidth = 1.6; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.arc(u.x, u.y, Math.max(12, L * 0.62), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        }
        return;
      }
      // 车顶警灯的地面光晕
      if (active) {
        var flash = (Math.sin(t * 7.5 + u.id.charCodeAt(1) * 1.7) + 1) * 0.5;
        var sprite = this.glowSprite(def.beacon || '#ff6a3d');
        var gr = 34 + flash * 12;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.14 + flash * 0.1;
        ctx.drawImage(sprite, u.x - gr, u.y - gr, gr * 2, gr * 2);
        ctx.restore();
      }
      ctx.save();
      ctx.translate(u.x, u.y);
      ctx.rotate(angle);

      // ---------- 通用零件 ----------
      function wheels(inset) {
        ctx.fillStyle = '#0b1015';
        [-1, 1].forEach(function (side) {
          ctx.fillRect(-L * 0.30, side * (Wd * 0.5 + 0.8) - 1.2, 5, 2.8);
          ctx.fillRect(L * 0.20, side * (Wd * 0.5 + 0.8) - 1.2, 5, 2.8);
        });
      }
      function body(color) {
        var grad = ctx.createLinearGradient(0, -Wd / 2, 0, Wd / 2);
        grad.addColorStop(0, U.mixHex(color, '#ffffff', 0.16));
        grad.addColorStop(0.5, color);
        grad.addColorStop(1, U.mixHex(color, '#000000', 0.22));
        ctx.fillStyle = grad;
        rr(ctx, -L / 2, -Wd / 2, L, Wd, 3.2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(5,10,15,0.6)';
        ctx.lineWidth = 0.8;
        rr(ctx, -L / 2, -Wd / 2, L, Wd, 3.2);
        ctx.stroke();
      }
      function lightbar(y, wide) {
        var on = active && Math.sin(t * 10 + L) > -0.2;
        ctx.fillStyle = 'rgba(10,15,20,0.85)';
        ctx.fillRect(-6, y, 12, 3);
        if (on) {
          ctx.fillStyle = def.service === 'medical' ? '#ff4d5e' : '#ff3b45';
          ctx.fillRect(-6, y, 5, 3);
          ctx.fillStyle = def.service === 'medical' ? '#ffffff' : '#3b8bff';
          ctx.fillRect(1, y, 5, 3);
        } else {
          ctx.fillStyle = 'rgba(120,140,150,0.5)';
          ctx.fillRect(-6, y, 12, 3);
        }
      }
      function headlights(front) {
        ctx.fillStyle = 'rgba(255,244,200,0.9)';
        ctx.fillRect(front - 2.5, -Wd / 2 + 2, 2, 2.2);
        ctx.fillRect(front - 2.5, Wd / 2 - 4.2, 2, 2.2);
        ctx.fillStyle = 'rgba(255,80,70,0.7)';
        ctx.fillRect(-front - 0.5, -Wd / 2 + 2, 1.5, 2);
        ctx.fillRect(-front - 0.5, Wd / 2 - 4, 1.5, 2);
      }
      function windshield(x, width) {
        ctx.fillStyle = 'rgba(38,58,72,0.9)';
        rr(ctx, x, -Wd / 2 + 2, width, Wd - 4, 1.5);
        ctx.fill();
        ctx.strokeStyle = 'rgba(160,205,230,0.25)';
        ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(x + width * 0.25, -Wd / 2 + 3); ctx.lineTo(x + width * 0.18, Wd / 2 - 3); ctx.stroke();
      }
      function compartments(count) {
        ctx.strokeStyle = 'rgba(20,28,34,0.5)';
        ctx.lineWidth = 0.7;
        for (var i = 0; i < count; i++) {
          var yy = -Wd / 2 + 3 + i * (Wd - 6) / count;
          ctx.beginPath(); ctx.moveTo(-L * 0.38, yy); ctx.lineTo(L * 0.08, yy); ctx.stroke();
        }
      }

      if (u.flying) {
        // 直升机：机身 + 尾梁 + 旋翼 + 起落橇
        ctx.rotate(-angle);
        ctx.strokeStyle = 'rgba(170,215,235,0.22)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(0, 0, 28, 9, t * 8, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(0, 0, 28, 9, t * 8 + Math.PI / 2, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(20,30,40,0.5)';
        ctx.fillRect(-2, 8, 4, 12);
        var fireHeli = u.type === 'heli_fire';
        var hg = ctx.createLinearGradient(0, -Wd * 0.4, 0, Wd * 0.4);
        hg.addColorStop(0, fireHeli ? '#ffb15c' : '#f4f8f9');
        hg.addColorStop(1, fireHeli ? '#b94a2e' : '#b9c9cf');
        ctx.fillStyle = hg;
        rr(ctx, -L * 0.32, -Wd * 0.32, L * 0.5, Wd * 0.64, 7); ctx.fill();
        ctx.fillStyle = def.accent;
        ctx.fillRect(-L * 0.30, -Wd * 0.08, L * 0.16, Wd * 0.16);
        ctx.fillStyle = '#28343c';
        ctx.beginPath(); ctx.ellipse(L * 0.12, 0, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(30,45,55,0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-L * 0.32, 0); ctx.lineTo(-L * 0.62, 0); ctx.stroke();
        ctx.fillStyle = '#cfdce1';
        ctx.fillRect(-L * 0.68, -2, 7, 4);
        ctx.strokeStyle = 'rgba(40,60,70,0.6)';
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(-L * 0.12, Wd * 0.32); ctx.lineTo(-L * 0.18, Wd * 0.5); ctx.lineTo(L * 0.18, Wd * 0.5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-L * 0.12, -Wd * 0.32); ctx.lineTo(-L * 0.18, -Wd * 0.5); ctx.lineTo(L * 0.18, -Wd * 0.5); ctx.stroke();
        ctx.restore();
        if (selected) {
          ctx.save(); ctx.strokeStyle = 'rgba(103,220,255,0.9)'; ctx.lineWidth = 1.6; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.arc(u.x, u.y, Math.max(20, L * 0.7), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        }
        return;
      }

      if (u.type === 'boat') {
        // 救援艇：尖头船体 + 舷外机
        ctx.beginPath();
        ctx.moveTo(L * 0.5, 0);
        ctx.quadraticCurveTo(L * 0.1, -Wd * 0.55, -L * 0.42, -Wd * 0.38);
        ctx.lineTo(-L * 0.42, Wd * 0.38);
        ctx.quadraticCurveTo(L * 0.1, Wd * 0.55, L * 0.5, 0);
        ctx.closePath();
        ctx.fillStyle = '#eaf4f7'; ctx.fill();
        ctx.strokeStyle = 'rgba(20,40,55,0.7)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = '#d63b4f'; ctx.fillRect(-L * 0.28, -Wd * 0.05, L * 0.30, Wd * 0.1);
        ctx.fillStyle = '#2f6f94'; ctx.fillRect(-L * 0.36, -Wd * 0.3, L * 0.10, Wd * 0.6);
        ctx.fillStyle = '#1a2a36'; ctx.fillRect(-L * 0.5, -2.5, 4, 5);
        ctx.restore();
        if (selected) { ctx.save(); ctx.strokeStyle = 'rgba(103,220,255,0.9)'; ctx.lineWidth = 1.6; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(u.x, u.y, Math.max(16, L * 0.5), 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
        return;
      }

      if (u.type === 'bike') {
        // 急救摩托：骑手 + 车身
        ctx.strokeStyle = 'rgba(15,20,25,0.9)'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(-L * 0.36, 0); ctx.lineTo(L * 0.34, 0); ctx.stroke();
        ctx.fillStyle = def.color;
        rr(ctx, -L * 0.18, -Wd * 0.32, L * 0.4, Wd * 0.64, 3); ctx.fill();
        ctx.fillStyle = '#22303a';
        ctx.beginPath(); ctx.arc(-L * 0.04, 0, 4.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(235,245,250,0.8)';
        ctx.beginPath(); ctx.arc(-L * 0.04, 0, 2.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,240,200,0.85)'; ctx.fillRect(L * 0.3, -1.5, 2, 3);
        ctx.restore();
        if (selected) { ctx.save(); ctx.strokeStyle = 'rgba(103,220,255,0.9)'; ctx.lineWidth = 1.6; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(u.x, u.y, 15, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
        return;
      }

      wheels();
      if (u.type === 'cruiser') {
        // 巡逻车：白蓝涂装、引擎盖、车顶灯条
        body(def.color);
        ctx.fillStyle = U.mixHex(def.color, '#1b4f9c', 0.65);
        ctx.fillRect(-L * 0.42, -Wd / 2 + 2, L * 0.5, Wd - 4);
        ctx.fillStyle = 'rgba(235,245,250,0.9)';
        ctx.fillRect(L * 0.10, -Wd / 2 + 2, L * 0.3, Wd - 4);
        windshield(L * 0.02, L * 0.12);
        ctx.fillStyle = 'rgba(20,30,40,0.5)';
        ctx.fillRect(-L * 0.06, -Wd / 2 + 2, L * 0.08, Wd - 4);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillRect(-L * 0.30, -Wd / 2 + 2.5, L * 0.12, 1.5);
        lightbar(-Wd * 0.34, true);
        headlights(L / 2);
      } else if (u.type === 'interceptor') {
        // 高速追捕车：低矮车身、推杆、双色警灯
        body(def.color);
        ctx.fillStyle = '#1e3b65'; ctx.fillRect(-L * 0.44, -Wd / 2 + 2, L * 0.58, Wd - 4);
        ctx.fillStyle = 'rgba(245,250,252,0.9)'; ctx.fillRect(L * 0.08, -Wd / 2 + 2, L * 0.28, Wd - 4);
        windshield(L * 0.0, L * 0.10);
        ctx.fillStyle = '#0d141b'; ctx.fillRect(L / 2 - 1, -Wd * 0.38, 3, Wd * 0.76);
        lightbar(-Wd * 0.36, true);
        headlights(L / 2);
      } else if (u.type === 'command') {
        // 应急指挥车：方舱 + 天线 + 卫星锅
        body(def.color);
        ctx.fillStyle = 'rgba(225,235,240,0.55)'; ctx.fillRect(-L * 0.40, -Wd / 2 + 2, L * 0.56, Wd - 4);
        windshield(L * 0.17, L * 0.12);
        ctx.strokeStyle = 'rgba(230,240,245,0.8)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(-L * 0.12, 0); ctx.lineTo(-L * 0.12, -Wd * 0.45); ctx.stroke();
        ctx.beginPath(); ctx.arc(-L * 0.12, -Wd * 0.45, 3, 0, Math.PI * 2); ctx.stroke();
        lightbar(-Wd * 0.34, true);
        headlights(L / 2);
      } else if (u.type === 'forest') {
        // 森林消防车：军绿车身 + 大水箱
        body('#4d5d36');
        ctx.fillStyle = '#c96a32'; ctx.fillRect(L * 0.16, -Wd / 2, L * 0.34, Wd);
        windshield(L * 0.22, L * 0.12);
        ctx.fillStyle = 'rgba(210,220,205,0.55)'; ctx.fillRect(-L * 0.40, -Wd / 2 + 2, L * 0.52, Wd - 4);
        ctx.strokeStyle = 'rgba(25,35,25,0.6)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-L * 0.30, -Wd / 2 + 4); ctx.lineTo(-L * 0.30, Wd / 2 - 4); ctx.stroke();
        compartments(2);
        lightbar(-Wd * 0.34, true);
        headlights(L / 2);
      } else if (u.type === 'swat') {
        body('#3c4655');
        ctx.strokeStyle = 'rgba(160,190,210,0.18)'; ctx.lineWidth = 1;
        ctx.strokeRect(-L * 0.36, -Wd / 2 + 3, L * 0.55, Wd - 6);
        windshield(L * 0.14, L * 0.12);
        ctx.fillStyle = 'rgba(30,40,52,0.8)'; ctx.fillRect(-L * 0.15, -Wd / 2 + 2, L * 0.1, Wd - 4);
        lightbar(-Wd * 0.32, true);
        headlights(L / 2);
      } else if (u.type === 'engine') {
        body(def.color);
        // 驾驶室
        ctx.fillStyle = '#cf3a2a';
        ctx.fillRect(L * 0.16, -Wd / 2, L * 0.34, Wd);
        windshield(L * 0.22, L * 0.12);
        // 银色卷帘仓
        ctx.fillStyle = 'rgba(220,225,225,0.65)';
        ctx.fillRect(-L * 0.40, -Wd / 2 + 2, L * 0.52, Wd - 4);
        compartments(3);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-L * 0.40, -Wd / 2 + 3); ctx.lineTo(L * 0.12, -Wd / 2 + 3); ctx.stroke();
        // 车顶梯子
        ctx.strokeStyle = 'rgba(210,220,225,0.7)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-L * 0.34, -Wd * 0.18); ctx.lineTo(-L * 0.02, -Wd * 0.18); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-L * 0.34, Wd * 0.18); ctx.lineTo(-L * 0.02, Wd * 0.18); ctx.stroke();
        for (var lr = 0; lr < 4; lr++) { ctx.beginPath(); ctx.moveTo(-L * 0.30 + lr * L * 0.07, -Wd * 0.18); ctx.lineTo(-L * 0.30 + lr * L * 0.07, Wd * 0.18); ctx.stroke(); }
        lightbar(-Wd * 0.36, true);
        headlights(L / 2);
      } else if (u.type === 'ladder') {
        body(def.color);
        ctx.fillStyle = '#b53a2b'; ctx.fillRect(L * 0.10, -Wd / 2, L * 0.4, Wd);
        windshield(L * 0.17, L * 0.12);
        // 车顶长梯
        ctx.strokeStyle = 'rgba(220,220,210,0.8)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(-L * 0.42, -Wd * 0.24); ctx.lineTo(L * 0.04, -Wd * 0.24); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-L * 0.42, Wd * 0.24); ctx.lineTo(L * 0.04, Wd * 0.24); ctx.stroke();
        for (var rung = 0; rung < 6; rung++) {
          ctx.beginPath(); ctx.moveTo(-L * 0.40 + rung * L * 0.07, -Wd * 0.24); ctx.lineTo(-L * 0.40 + rung * L * 0.07, Wd * 0.24); ctx.stroke();
        }
        ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fillRect(-L * 0.42, -Wd / 2 + 2, L * 0.5, 2);
        lightbar(-Wd * 0.36, true);
        headlights(L / 2);
      } else if (u.type === 'hazmat') {
        body(def.color);
        ctx.fillStyle = '#9fae3c'; ctx.fillRect(-L * 0.40, -Wd / 2 + 2, L * 0.52, Wd - 4);
        compartments(2);
        // 危险品菱形
        ctx.save(); ctx.translate(-L * 0.16, 0); ctx.rotate(Math.PI / 4);
        ctx.fillStyle = 'rgba(240,220,80,0.75)'; ctx.fillRect(-3.5, -3.5, 7, 7); ctx.restore();
        windshield(L * 0.16, L * 0.12);
        lightbar(-Wd * 0.34, true);
        headlights(L / 2);
      } else if (u.type === 'ambulance') {
        body(def.color);
        // 白色车厢 + 红色生命线
        ctx.fillStyle = 'rgba(245,248,248,0.9)'; ctx.fillRect(-L * 0.40, -Wd / 2 + 2, L * 0.52, Wd - 4);
        ctx.fillStyle = '#d63b4f'; ctx.fillRect(-L * 0.40, -1.2, L * 0.52, 2.4);
        ctx.fillStyle = '#d63b4f';
        ctx.fillRect(-L * 0.18, -4, 3, 8); ctx.fillRect(-L * 0.20, -2, 7, 3);
        windshield(L * 0.14, L * 0.12);
        compartments(2);
        lightbar(-Wd * 0.34, true);
        headlights(L / 2);
      } else {
        body(def.color);
        lightbar(-Wd * 0.34, true);
        headlights(L / 2);
      }
      ctx.restore();
      // 选中
      if (selected) {
        ctx.save();
        ctx.strokeStyle = 'rgba(103,220,255,0.9)';
        ctx.lineWidth = 1.6;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(u.x, u.y, Math.max(16, L * 0.68), 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      if (this.cam.zoom > 1.05) {
        ctx.save();
        ctx.fillStyle = 'rgba(225,238,248,0.6)';
        ctx.font = '500 ' + (9 / this.cam.zoom) + 'px ' + FONT;
        ctx.textAlign = 'center';
        ctx.fillText(def.short, u.x, u.y + Wd / 2 + 12 / this.cam.zoom);
        ctx.restore();
      }
    }, this);
  };

  Renderer.prototype.emitFireParticles = function (sim, dt) {
    if (!sim || !this.settings.particles || this.quality.particles <= 0) return;
    var q = this.quality.particles;
    sim.incidents.forEach(function (inc) {
      if (inc.status !== 'active') return;
      if (inc.icon !== '🔥') return;
      if (!this.isVisible(inc.x, inc.y, 100)) return;
      inc._fx = (inc._fx || 0) + dt * 18 * q;
      var n = Math.floor(inc._fx);
      inc._fx -= n;
      if (this.particles.length > 260 * q) n = Math.min(n, 1);
      for (var i = 0; i < Math.min(n, 3); i++) {
        this.particles.push({
          type: 'fire',
          x: inc.x + (Math.random() - 0.5) * 26,
          y: inc.y + (Math.random() - 0.5) * 16,
          vx: (Math.random() - 0.5) * 8,
          vy: -14 - Math.random() * 18,
          life: 0.7 + Math.random() * 0.7,
          max: 1.2, size: 2 + Math.random() * 4
        });
        if (i % 2 === 0 && this.particles.length < 220 * q) {
          this.particles.push({
            type: 'smoke',
            x: inc.x + (Math.random() - 0.5) * 24,
            y: inc.y - 4,
            vx: 6 + Math.random() * 8,
            vy: -18 - Math.random() * 12,
            life: 2 + Math.random() * 2.4,
            max: 4.4, size: 8 + Math.random() * 12
          });
        }
      }
    }, this);
  };

  Renderer.prototype.explode = function (x, y, power) {
    power = power || 1;
    var n = Math.round(26 * power * (this.quality.particles || 1));
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, sp = 50 + Math.random() * 160 * power;
      this.particles.push({
        type: i % 4 === 0 ? 'smoke' : 'spark',
        x: x, y: y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20,
        life: 0.6 + Math.random() * 1.1, max: 1.7,
        size: 2 + Math.random() * 4
      });
    }
    this.addShake(8 * power);
    this.flash = Math.max(this.flash, 0.25 * power);
  };

  Renderer.prototype.addShake = function (n) {
    if (!this.settings.screenShake || this.settings.reducedMotion) return;
    this.shake = Math.min(22, this.shake + n);
  };

  Renderer.prototype.updateFx = function (dt, sim) {
    this.time += dt;
    this._dash += dt;
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 26);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.4);
    this.lightning = Math.max(0, this.lightning - dt * 2.8);
    this.lightningCooldown -= dt;
    var weather = sim ? this.weatherOf(sim) : (this.menuWeather || D.WEATHERS.rain);
    if (weather.lightning && this.lightningCooldown <= 0 && this.settings.weatherFx) {
      this.lightningCooldown = 7 + Math.random() * 14;
      this.lightning = 1;
      this.lightningFired = true;
      if (this.onLightning) this.onLightning();
    }
    var q = this.quality.particles || 1;
    var i = this.particles.length - 1;
    for (; i >= 0; i--) {
      var p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.type === 'smoke') { p.vy -= 5 * dt; p.vx *= 1 + dt * 0.2; }
      else if (p.type === 'spark') { p.vy += 120 * dt; }
      else if (p.type === 'fire') { p.vy -= 10 * dt; }
    }
    if (this.particles.length > 300 * q) this.particles.splice(0, this.particles.length - 300 * q);

    this.emitFireParticles(sim, dt);
    this.updateTraffic(dt);

    if (this.settings.weatherFx) {
      var rain = weather.rain || 0;
      var wind = weather.wind || 0.3;
      if (rain > 0) {
        for (var r = 0; r < this.rain.length; r++) {
          var drop = this.rain[r];
          drop.y += drop.sp * dt;
          drop.x += drop.sp * wind * dt * 0.55;
          if (drop.y > this.h + 20 || drop.x > this.w + 20) {
            drop.y = -20 - Math.random() * 80;
            drop.x = Math.random() * (this.w + 100) - 50;
          }
        }
        if (Math.random() < dt * rain * 8) {
          this.ripples.push({ x: Math.random() * this.w, y: this.h * (0.35 + Math.random() * 0.6), life: 0.5, max: 0.5, r: 2 });
        }
      }
      for (var k = this.ripples.length - 1; k >= 0; k--) {
        this.ripples[k].life -= dt;
        this.ripples[k].r += dt * 26;
        if (this.ripples[k].life <= 0) this.ripples.splice(k, 1);
      }
    }
  };

  /* 天气渐变：班次开始时一种天气，推进过程中平滑过渡到第二种 */
  Renderer.prototype.weatherOf = function (sim) {
    if (!sim || !sim.config) return this.menuWeather || D.WEATHERS.rain;
    var cfg = sim.config;
    var a = D.WEATHERS[cfg.weather] || D.WEATHERS.rain;
    var b = cfg.weather2 ? D.WEATHERS[cfg.weather2] : null;
    if (!b) return a;
    var progress;
    if (cfg.duration) progress = U.clamp(sim.clock / (cfg.duration * 0.95), 0, 1);
    else progress = (sim.clock % 420) / 420;
    var t = U.easeOutCubic(progress);
    return {
      id: 'blend', name: a.name,
      rain: U.lerp(a.rain, b.rain, t),
      fog: U.lerp(a.fog, b.fog, t),
      lightning: U.lerp(a.lightning, b.lightning, t),
      wind: U.lerp(a.wind, b.wind, t),
      tint: U.mixHex(a.tint, b.tint, t)
    };
  };

  /* 昼夜：按“城市时间”算，HUD 时钟与光照保持一致（班次内时间加速） */
  Renderer.prototype.lightOf = function (sim) {
    if (!sim || !sim.config) return D.LIGHTS.night;
    var cfg = sim.config;
    var scale = cfg.clockScale || 1;
    var mins = ((cfg.startMinutes || 0) + sim.clock * scale) % 1440;
    if (mins < 0) mins += 1440;
    var L = D.LIGHTS;
    var from = L.night, to = L.night, t = 0;
    if (mins < 270) { from = L.night; to = L.night; t = 0; }            // 00:00-04:30
    else if (mins < 330) { from = L.night; to = L.dawn; t = (mins - 270) / 60; } // 04:30-05:30
    else if (mins < 420) { from = L.dawn; to = L.day; t = (mins - 330) / 90; }    // 05:30-07:00
    else if (mins < 1020) { from = L.day; to = L.day; t = 0; }           // 07:00-17:00
    else if (mins < 1140) { from = L.day; to = L.dusk; t = (mins - 1020) / 120; } // 17:00-19:00
    else if (mins < 1260) { from = L.dusk; to = L.night; t = (mins - 1140) / 120; } // 19:00-21:00
    else { from = L.night; to = L.night; t = 0; }
    var light = {
      id: 'blend',
      alpha: U.lerp(from.alpha, to.alpha, t),
      lights: U.lerp(from.lights, to.lights, t),
      tint: U.mixHex(from.tint, to.tint, t),
      name: t < 0.5 ? from.name : to.name
    };
    var w = this.weatherOf(sim);
    if (w && w.lightning > 0.15) {
      light.alpha = U.clamp(light.alpha + 0.12 * w.lightning, 0, 0.62);
      light.lights = Math.max(0.35, light.lights * 0.82);
      light.tint = U.mixHex(light.tint, '#040812', 0.35);
    }
    return light;
  };

  Renderer.prototype.drawParticles = function () {
    var ctx = this.ctx;
    for (var i = 0; i < this.particles.length; i++) {
      var p = this.particles[i];
      if (!this.isVisible(p.x, p.y, 40)) continue;
      var t = p.life / p.max;
      if (p.type === 'smoke') {
        ctx.fillStyle = 'rgba(70,76,84,' + (0.18 * t) + ')';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.6 - t * 0.5), 0, Math.PI * 2); ctx.fill();
      } else if (p.type === 'spark') {
        ctx.strokeStyle = 'rgba(255,190,90,' + Math.min(1, t * 1.4) + ')';
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(255,' + Math.round(90 + t * 100) + ',40,' + (0.7 * t) + ')';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.5 + t * 0.8), 0, Math.PI * 2); ctx.fill();
      }
    }
  };

  /* ============================ 屏幕层 ============================ */
  Renderer.prototype.drawWeather = function (sim) {
    if (!this.settings.weatherFx) return;
    var weather = sim ? this.weatherOf(sim) : (this.menuWeather || D.WEATHERS.rain);
    var ctx = this.ctx;
    ctx.save();
    if (weather.fog && this.quality.fog) {
      var fg = ctx.createLinearGradient(0, 0, this.w, this.h);
      fg.addColorStop(0, 'rgba(190,205,210,0)');
      fg.addColorStop(0.5, 'rgba(190,205,210,' + (weather.fog * 0.16) + ')');
      fg.addColorStop(1, 'rgba(190,205,210,0)');
      ctx.fillStyle = fg;
      ctx.fillRect(0, 0, this.w, this.h);
      for (var i = 0; i < 3; i++) {
        var cx = (i * 0.37 + 0.1) * this.w + Math.sin(this.time * 0.05 + i) * 40;
        var cy = this.h * (0.35 + i * 0.18);
        var gr = ctx.createRadialGradient(cx, cy, 10, cx, cy, this.w * 0.35);
        gr.addColorStop(0, 'rgba(190,205,210,' + (weather.fog * 0.05) + ')');
        gr.addColorStop(1, 'rgba(190,205,210,0)');
        ctx.fillStyle = gr;
        ctx.fillRect(0, 0, this.w, this.h);
      }
    }
    var rain = weather.rain || 0;
    if (rain > 0) {
      ctx.strokeStyle = 'rgba(180,215,235,0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var r = 0; r < this.rain.length; r++) {
        var d = this.rain[r];
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - d.len * 0.28, d.y + d.len);
      }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(200,225,240,0.12)';
      for (var k = 0; k < this.ripples.length; k++) {
        var rp = this.ripples[k];
        ctx.beginPath(); ctx.ellipse(rp.x, rp.y, rp.r, rp.r * 0.28, 0, 0, Math.PI * 2); ctx.stroke();
      }
    }
    if (this.lightning > 0) {
      ctx.fillStyle = 'rgba(200,225,255,' + (this.lightning * 0.24) + ')';
      ctx.fillRect(0, 0, this.w, this.h);
    }
    if (this.flash > 0) {
      ctx.fillStyle = 'rgba(255,225,180,' + (this.flash * 0.18) + ')';
      ctx.fillRect(0, 0, this.w, this.h);
    }
    ctx.restore();
  };

  Renderer.prototype.drawMarkers = function (sim) {
    if (!sim) return;
    var ctx = this.ctx;
    var t = this.time;
    sim.incidents.forEach(function (inc) {
      if (inc.status !== 'active') return;
      if (!this.isVisible(inc.x, inc.y, 60)) return;
      var p = this.worldToScreen(inc.x, inc.y);
      var pr = D.PRIORITIES[inc.priority];
      var pulse = 0.5 + 0.5 * Math.sin(t * 3.2 + inc.x * 0.01);
      var selected = this.selectedIncident === inc.id;
      var R = selected ? 22 : 18;
      // 外圈
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = pr.color;
      ctx.lineWidth = selected ? 2.4 : 1.4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, R + 4 + pulse * 3, 0, Math.PI * 2);
      ctx.stroke();
      // 底盘
      ctx.fillStyle = 'rgba(6,12,20,0.9)';
      ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = U.alpha(pr.color, 0.6);
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.stroke();
      // 倒计时弧
      var frac = U.clamp(inc.timeLeft / Math.max(1, inc.maxTime), 0, 1);
      ctx.strokeStyle = pr.color;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, R + 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.stroke();
      // 图标
      ctx.font = (R * 1.02) + 'px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(inc.icon, p.x, p.y + 1);
      // 优先标签
      ctx.font = '700 8px ' + FONT;
      ctx.fillStyle = pr.color;
      ctx.fillText(pr.label, p.x, p.y - R - 7);
      ctx.restore();
      // 名称
      if (selected || inc.priority === 1 || this.cam.zoom > 0.8) {
        var label = inc.label;
        ctx.save();
        ctx.font = '600 10px ' + FONT;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(235,245,250,0.9)';
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 3;
        var tx = p.x, ty = p.y + R + 14;
        ctx.strokeText(label, tx, ty);
        ctx.fillText(label, tx, ty);
        ctx.restore();
      }
      // 选中框
      if (selected) {
        ctx.save();
        ctx.strokeStyle = 'rgba(103,220,255,0.8)';
        ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = -t * 16;
        ctx.beginPath(); ctx.arc(p.x, p.y, R + 10, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    }, this);
  };

  Renderer.prototype.drawLabels = function (sim) {
    var ctx = this.ctx;
    var zoom = this.cam.zoom;
    if (zoom < 0.72) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      D.DISTRICTS.forEach(function (d) {
        var p = this.worldToScreen((d.x + d.w / 2) * TILE, (d.y + d.h / 2) * TILE);
        if (p.x < -100 || p.x > this.w + 100 || p.y < -50 || p.y > this.h + 50) return;
        ctx.font = '700 24px ' + FONT;
        ctx.fillStyle = 'rgba(210,230,240,0.16)';
        ctx.fillText(d.name, p.x, p.y);
        ctx.font = '500 10px ' + FONT;
        ctx.fillStyle = 'rgba(160,190,205,0.2)';
        var en = {
          airport: 'ZHIMU AIRPORT', prison: 'BAIYAN PRISON', country: 'DAOXIANG',
          industrial: 'INDUSTRIAL ZONE', gov: 'GOVERNMENT DISTRICT',
          mountain: 'ZHIMU MOUNTAIN', coast: 'ZHIMU BAY'
        }[d.id] || 'DOWNTOWN';
        ctx.fillText(en, p.x, p.y + 18);
      }, this);
      ctx.restore();
    }
    if (zoom > 0.9 && this.settings.showLabels) {
      ctx.save();
      var shown = 0;
      for (var i = 0; i < this.world.buildings.length && shown < 26; i++) {
        var b = this.world.buildings[i];
        if (!b.landmark) continue;
        var p = this.worldToScreen(b.cx, b.cy);
        if (p.x < 0 || p.x > this.w || p.y < 0 || p.y > this.h) continue;
        shown++;
        ctx.font = '500 9px ' + FONT;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(220,235,245,0.46)';
        ctx.fillText(b.name, p.x, p.y);
      }
      ctx.restore();
    }
  };

  Renderer.prototype.drawFlashOverlay = function () {
    if (this.flash <= 0) return;
    var ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(255,235,190,' + this.flash * 0.18 + ')';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.restore();
  };

  /* ============================ 总绘制 ============================ */
  Renderer.prototype.drawGame = function (sim, opts) {
    opts = opts || {};
    var dt = opts.dt || 0.016;
    this.settings = opts.settings || this.settings;
    this.resize();
    this.updateCamera(dt);
    // 暂停时冻结所有动态：车流、雨、粒子、警灯闪烁、屏幕震动
    if (!opts.paused) this.updateFx(dt, sim);
    this.selected = opts.selected || null;
    this.selectedIncident = opts.selectedIncident || null;
    var ctx = this.ctx;
    var shake = this.shake;
    var ox = shake ? (Math.random() - 0.5) * shake : 0;
    var oy = shake ? (Math.random() - 0.5) * shake : 0;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = '#060b11';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.save();
    ctx.translate(this.w / 2 + ox, this.h / 2 + oy);
    ctx.scale(this.cam.zoom, this.cam.zoom);
    ctx.translate(-this.cam.x, -this.cam.y);
    this.drawBase(ctx);
    var light = this.lightOf(sim);
    this.drawNightMask(light);
    this.drawStaticLights(light);
    this.drawTraffic(light);
    this.drawStations(light);
    this.drawIncidentGround(sim);
    this.drawRoutes(sim);
    this.drawParticles();
    this.drawUnits(sim);
    ctx.restore();
    this.drawWeather(sim);
    this.drawLabels(sim);
    this.drawMarkers(sim);
    this.drawFlashOverlay();
  };

  Renderer.prototype.drawMenu = function (dt) {
    if (!this.world) return;
    this.settings = this.settings || D.DEFAULT_SETTINGS;
    this.resize();
    this.menuT += dt;
    this.menuWeather = D.WEATHERS.rain;
    this.menuLight = D.LIGHTS.night;
    this.updateCamera(dt);
    this.updateFx(dt, null);
    // 缓慢移动的展示镜头
    if (this.menuT > 16) {
      this.menuT = 0;
      this.menuIdx = (this.menuIdx + 1) % 3;
      var spots = [
        { x: 32 * TILE, y: 27 * TILE, z: 0.52 },
        { x: 104 * TILE, y: 22 * TILE, z: 0.48 },
        { x: 110 * TILE, y: 78 * TILE, z: 0.44 }
      ];
      var s = spots[this.menuIdx];
      this.cam.tx = s.x; this.cam.ty = s.y; this.cam.tz = s.z;
    }
    var ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = '#05090f';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.save();
    ctx.translate(this.w / 2, this.h / 2);
    ctx.scale(this.cam.zoom, this.cam.zoom);
    ctx.translate(-this.cam.x, -this.cam.y);
    this.drawBase(ctx);
    this.drawNightMask(this.menuLight);
    this.drawStaticLights(this.menuLight);
    this.drawTraffic(this.menuLight);
    ctx.restore();
    this.drawWeather(null);
    this.drawLabels(null);
  };

  Renderer.prototype.pick = function (sx, sy, sim) {
    var best = null, bestD = 1e9;
    if (sim) {
      for (var i = 0; i < sim.incidents.length; i++) {
        var inc = sim.incidents[i];
        if (inc.status !== 'active') continue;
        var p = this.worldToScreen(inc.x, inc.y);
        var d = U.dist(sx, sy, p.x, p.y);
        if (d < 24 && d < bestD) { bestD = d; best = { kind: 'incident', id: inc.id }; }
      }
      for (var j = 0; j < sim.units.length; j++) {
        var u = sim.units[j];
        var p2 = this.worldToScreen(u.x, u.y);
        var d2 = U.dist(sx, sy, p2.x, p2.y);
        if (d2 < 18 && d2 < bestD) { bestD = d2; best = { kind: 'unit', id: u.id }; }
      }
    }
    return best;
  };

  /* 音频层每帧询问是否打雷；读取后复位，避免重复播放 */
  Renderer.prototype.consumeLightning = function () {
    if (!this.lightningFired) return false;
    this.lightningFired = false;
    return true;
  };

  var FONT = '"Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif';
  EM.render = { Renderer: Renderer };
})(window);
