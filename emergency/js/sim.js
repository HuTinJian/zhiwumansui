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
    var need = { police: 0, fire: 0, medical: 0, hazmat: 0, rescue: 0 };
    var caps = { police: 0, fire: 0, medical: 0, hazmat: 0, rescue: 0 };
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

  Simulation.prototype.spawnRandom = function () {
    var rng = this._rng;
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
      spreadFrom: opt.spreadFrom || null
    };
    this.incidents.push(inc);
    this.incidentById[inc.id] = inc;
    this.stats.totalCalls++;
    this.pushEvent('spawn', { incidentId: inc.id, priority: inc.priority, label: inc.label, name: inc.name });
    var pr = D.PRIORITIES[inc.priority] || D.PRIORITIES[3];
    this.logRadio(fmt(pickLine(D.RADIO.spawn, this._rng), {
      place: inc.label, type: inc.name, priority: pr.label + ' ' + pr.name
    }), inc.priority === 1 ? 'alert' : 'warn');
    if (inc.priority === 1) this.pushEvent('critical', { label: inc.label });
    return inc;
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
      u.dispatchedAt = this.clock;
      if (inc.assigned.indexOf(u.id) < 0) inc.assigned.push(u.id);
      dispatched.push(u);
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
    var committed = { police: 0, fire: 0, medical: 0, hazmat: 0, rescue: 0 };
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
      var committed2 = { police: 0, fire: 0, medical: 0, hazmat: 0, rescue: 0 };
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

  /* ---------------- 覆盖与进度 ---------------- */
  Simulation.prototype.computeCoverage = function (inc) {
    var provided = { police: 0, fire: 0, medical: 0, hazmat: 0, rescue: 0 };
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
    var tag = u.flying ? 'air_fuel' : 'gas_station';
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
        if (u.flying) {
          var inc0 = u.incidentId ? this.incidentById[u.incidentId] : null;
          if (!inc0 || inc0.status !== 'active') { this.sendHome(u); continue; }
          var dx = inc0.access.x - u.x, dy = inc0.access.y - u.y;
          var dist = Math.sqrt(dx * dx + dy * dy);
          var sp = u.def.speed * this.buffs.speed;
          u.angle = Math.atan2(dy, dx);
          if (dist <= sp * dt) { u.x = inc0.access.x; u.y = inc0.access.y; u.pathIndex = 1; this.arriveAtScene(u); }
          else { u.x += (dx / dist) * sp * dt; u.y += (dy / dist) * sp * dt; }
        } else if (this.moveAlongPath(u, dt)) {
          this.arriveAtScene(u);
        }
      } else if (u.status === 'returning') {
        if (this.moveAlongPath(u, dt)) this.returnArrived(u);
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

    // 警情计时、覆盖、蔓延
    for (var i = this.incidents.length - 1; i >= 0; i--) {
      var inc = this.incidents[i];
      if (inc.status !== 'active') continue;
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
        path: null, pathIndex: 0, flying: !!def.flying
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
