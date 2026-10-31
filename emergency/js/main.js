/* =========================================================================
   临界 · 紧急调度 — 主程序（应用状态机 / 游戏循环 / 输入 / 生涯存档 / 联机编排）
   说明：本文件把地图、模拟、渲染、界面、音频与联机层接起来。
   回退办法：删除 emergency/ 目录或 revert 提交；网站其它页面不受影响。
   ========================================================================= */
(function (root) {
  'use strict';
  var EM = root.EM = root.EM || {};
  var D = EM.data, U = EM.util;
  var App = EM.app = {
    version: D.VERSION,
    screen: 'menu',
    mode: 'campaign',
    settings: null,
    campaign: null,
    stats: {},
    world: null,
    menuWorld: null,
    sim: null,
    shift: null,
    renderer: null,
    selectedIncident: null,
    selectedUnit: null,
    paused: false,
    speed: 1,
    ending: false,
    busy: false,
    lastEventId: 0,
    lastSummary: null,
    summaryContext: null,
    // 联机
    net: null,
    netRole: null,
    roomCode: null,
    lobbyState: null,
    lobbyPlayers: [],
    lobbyJoining: false,
    lobbyError: '',
    myPlayerId: 'p1',
    coopDifficulty: 'normal',
    netPing: 0,
    netSynced: false,
    _closingNet: false,
    // 渲染/输入
    pointer: { x: 0, y: 0, down: false, dragging: false, startX: 0, startY: 0, lastX: 0, lastY: 0, inside: false, pinching: false, dist: 0 },
    _loopStarted: false,
    _lastFrame: 0,
    _lastRender: 0,
    _snapAcc: 0,
    _saveTimer: null
  };

  /* ---------------------------------------------------------------------
     启动
     --------------------------------------------------------------------- */
  App.boot = function () {
    App.settings = loadSettings();
    App.campaign = loadCampaign();
    App.stats = U.store.get(D.STATS_KEY, {}) || {};
    App.achievements = loadAchievements();
    App.leaderboard = loadLeaderboard();
    App.coopDifficulty = App.settings.difficulty || 'normal';
    App.renderer = new EM.render.Renderer(document.getElementById('world'));
    App.renderer.setSettings(App.settings);
    EM.ui.init(App);
    EM.ui.syncSettingsClasses();
    EM.ui.showScreen('menu');
    EM.ui.loading(true, '正在建立临江市…');
    bindInput();
    bindVisibility();
    // 延迟一帧，让加载层先绘制出来
    requestAnimationFrame(function () {
      setTimeout(function () {
        try {
          App.menuWorld = EM.map.generate(112112);
          App.world = App.menuWorld;
          App.renderer.setWorld(App.menuWorld);
          App.renderer.focusOn(34 * D.WORLD.TILE, 26 * D.WORLD.TILE, menuZoom(), true);
          EM.ui.loading(false);
          App.showMenu();
          startLoop();
        } catch (e) {
          console.error(e);
          EM.ui.loading(false, '地图生成失败：' + e.message);
        }
      }, 40);
    });
  };

  function menuZoom() {
    var z = App.renderer.fitZoom(40) * 1.7;
    return Math.max(0.42, Math.min(1, z));
  }

  function loadSettings() {
    var saved = U.store.get(D.SETTINGS_KEY, null);
    var s = U.deepMerge(D.DEFAULT_SETTINGS, saved || {});
    if (!D.QUALITY[s.quality]) s.quality = 'high';
    if (!D.DIFFICULTY[s.difficulty]) s.difficulty = 'normal';
    if (!['auto', '0.75', '1', '1.25'].includes(s.renderScale)) s.renderScale = 'auto';
    if (!['low', 'medium', 'high'].includes(s.particles)) s.particles = 'high';
    if (![30, 60, 120, 0].includes(Number(s.fpsCap))) s.fpsCap = 60;
    if (![1, 2, 4].includes(Number(s.speedDefault))) s.speedDefault = 1;
    ['volumeMaster', 'volumeMusic', 'volumeSfx', 'volumeAmbience'].forEach(function (k) {
      s[k] = U.clamp(Number(s[k]), 0, 1);
      if (isNaN(s[k])) s[k] = D.DEFAULT_SETTINGS[k];
    });
    return s;
  }

  function loadCampaign() {
    var c = U.store.get(D.SAVE_KEY, null);
    if (!c || typeof c !== 'object') return null;
    if (typeof c.shiftIndex !== 'number' || c.shiftIndex < 0) return null;
    if (!Array.isArray(c.upgrades)) c.upgrades = [];
    if (!c.totals) c.totals = { score: 0, deaths: 0, resolved: 0, failed: 0, shifts: 0 };
    if (!c.difficulty || !D.DIFFICULTY[c.difficulty]) c.difficulty = 'normal';
    if (!c.seed) c.seed = (U.hashString(String(Date.now())) >>> 0);
    c.version = c.version || 1;
    return c;
  }

  function saveCampaign() {
    if (!App.campaign) return;
    App.campaign.lastPlayed = Date.now();
    U.store.set(D.SAVE_KEY, App.campaign);
  }

  /* ---------------- 本机成就 / 排行榜 ----------------
     存储结构：
       achievements = { unlocked:[id], counters:{resolved,auto,hazmat,quick,buy} }
       leaderboard  = [{score, mode, label, grade, deaths, wave, ts}]
     回退办法：清空浏览器 localStorage 的 emergency112.achievements.v1 /
              emergency112.leaderboard.v1 即可，不影响生涯存档。
  ------------------------------------------------------- */
  function loadAchievements() {
    var p = U.store.get(D.ACH_KEY, null);
    if (!p || typeof p !== 'object') p = {};
    if (!Array.isArray(p.unlocked)) p.unlocked = [];
    var def = { resolved: 0, auto: 0, hazmat: 0, quick: 0, buy: 0 };
    p.counters = Object.assign(def, p.counters || {});
    return p;
  }
  function saveAchievements() {
    U.store.set(D.ACH_KEY, App.achievements || { unlocked: [], counters: {} });
  }
  function loadLeaderboard() {
    var b = U.store.get(D.BOARD_KEY, []);
    return Array.isArray(b) ? b.filter(function (x) { return x && typeof x.score === 'number'; }) : [];
  }
  function saveLeaderboard() {
    U.store.set(D.BOARD_KEY, (App.leaderboard || []).slice(0, 10));
  }

  App.unlockAchievement = function (id) {
    var ach = D.ACH_BY_ID[id];
    if (!ach || !App.achievements) return false;
    if (App.achievements.unlocked.indexOf(id) >= 0) return false;
    App.achievements.unlocked.push(id);
    saveAchievements();
    if (EM.ui) EM.ui.toast('成就解锁 · ' + ach.name, 'good');
    if (EM.audio) EM.audio.play('upgrade');
    return true;
  };

  App.checkProgressAchievements = function () {
    if (!App.achievements) return;
    var c = App.achievements.counters;
    if (c.resolved >= 1) App.unlockAchievement('first_call');
    if (c.auto >= 10) App.unlockAchievement('auto_10');
    if (c.hazmat >= 3) App.unlockAchievement('hazmat_3');
    if (c.quick >= 1) App.unlockAchievement('quick_40');
    if (c.buy >= 5) App.unlockAchievement('buyer_5');
  };

  App.evaluateShiftAchievements = function (ctx) {
    if (!ctx) return;
    if (ctx.won && ctx.total > 0 && ctx.deaths === 0) App.unlockAchievement('clean_shift');
    if (ctx.grade === 'S') App.unlockAchievement('s_grade');
    if (ctx.won && ctx.total > 0 && ctx.failed === 0) App.unlockAchievement('flawless');
    if (ctx.completed) App.unlockAchievement('campaign_clear');
    if (ctx.won && ctx.shiftIndex === 4) App.unlockAchievement('final_shift');
    if (ctx.mode === 'endless' && ctx.score >= 5000) App.unlockAchievement('endless_5k');
    if (ctx.mode === 'coop' && ctx.won) App.unlockAchievement('coop_first');
    App.checkProgressAchievements();
  };

  App.addLeaderboard = function (summary, ctx) {
    if (!summary) return;
    var label = '本机行动';
    if (ctx.mode === 'campaign') label = App.shift ? App.shift.name : '生涯班次';
    else if (ctx.mode === 'endless') label = '无尽值班 · 第 ' + (summary.wave || 1) + ' 波';
    else if (ctx.mode === 'coop') label = '联合行动';
    var entry = {
      score: Math.round(summary.score || 0),
      mode: ctx.mode,
      label: label,
      grade: summary.grade || 'D',
      deaths: summary.deaths || 0,
      wave: summary.wave || 0,
      ts: Date.now()
    };
    App.leaderboard = (App.leaderboard || []).concat([entry]);
    App.leaderboard.sort(function (a, b) { return b.score - a.score || (a.ts || 0) - (b.ts || 0); });
    App.leaderboard = App.leaderboard.slice(0, 10);
    saveLeaderboard();
    var rank = App.leaderboard.indexOf(entry);
    ctx.boardRank = rank >= 0 ? rank + 1 : null;
  };

  App.applySettings = function () {
    if (!App.settings) return;
    App.settings = U.deepMerge(D.DEFAULT_SETTINGS, App.settings);
    App.renderer.setSettings(App.settings);
    if (EM.audio) EM.audio.applySettings(App.settings);
    EM.ui.syncSettingsClasses();
    U.store.set(D.SETTINGS_KEY, App.settings);
  };

  App.setSetting = function (k, v) {
    App.settings[k] = v;
    App.applySettings();
  };

  /* ---------------------------------------------------------------------
     屏幕切换
     --------------------------------------------------------------------- */
  App.showMenu = function () {
    App.screen = 'menu';
    App.paused = false;
    App.ending = false;
    App.selectedIncident = null;
    App.selectedUnit = null;
    App.sim = null;
    App.world = App.menuWorld;
    App.mode = 'campaign';
    App.netRole = null;
    EM.ui.hideTooltip();
    if (App.renderer && App.menuWorld) {
      App.renderer.setWorld(App.menuWorld);
      App.renderer.focusOn(34 * D.WORLD.TILE, 26 * D.WORLD.TILE, menuZoom(), true);
    }
    EM.ui.closeSheets();
    EM.ui.showScreen('menu');
    EM.ui.refreshMenu();
  };

  App.getSim = function () { return App.sim; };
  App.fitMap = function () { App.renderer.fitMap(); };

  /* ---------------------------------------------------------------------
     生涯 / 无尽
     --------------------------------------------------------------------- */
  App.startCampaign = function (fresh) {
    if (App.busy) return;
    if (fresh || !App.campaign || App.campaign.completed) {
      App.campaign = {
        version: 1,
        shiftIndex: 0,
        funds: D.SHIFTS[0].startFunds,
        upgrades: [],
        difficulty: App.settings.difficulty,
        seed: (Math.random() * 1e9) >>> 0,
        totals: { score: 0, deaths: 0, resolved: 0, failed: 0, shifts: 0 },
        completed: false,
        createdAt: Date.now()
      };
      saveCampaign();
    }
    App.startShift(App.campaign.shiftIndex);
  };

  App.startEndless = function () {
    if (App.busy) return;
    App.closeNet();
    App.mode = 'endless';
    App.netRole = null;
    App.lobbyState = null;
    var config = Object.assign({}, D.ENDLESS, {
      difficultyId: App.settings.difficulty,
      seed: (Math.random() * 1e9) >>> 0,
      name: '无尽值班',
      intro: '没有交班时间。警情会一波比一波密，撑得越久，分数越高。',
      duration: null
    });
    App.launchShift(config, {
      mode: 'endless',
      funds: 0,
      upgrades: [],
      difficulty: D.DIFFICULTY[App.settings.difficulty] || D.DIFFICULTY.normal,
      seed: config.seed,
      players: [{ id: 'p1', name: '指挥官', color: EM.net ? EM.net.COLORS[0] : '#67dcff' }]
    });
  };

  App.startShift = function (index) {
    if (App.busy) return;
    var camp = App.campaign;
    if (!camp) return;
    if (index >= D.SHIFTS.length) {
      App.showMenu();
      return;
    }
    var base = Object.assign({}, D.SHIFTS[index]);
    base.difficultyId = camp.difficulty;
    base.seed = ((camp.seed >>> 0) + index * 7919 + 17) >>> 0;
    App.mode = 'campaign';
    App.closeNet();
    App.launchShift(base, {
      mode: 'campaign',
      funds: camp.funds,
      upgrades: camp.upgrades.slice(),
      difficulty: D.DIFFICULTY[camp.difficulty] || D.DIFFICULTY.normal,
      seed: base.seed,
      players: [{ id: 'p1', name: '指挥官', color: EM.net ? EM.net.COLORS[0] : '#67dcff' }],
      brief: true
    });
  };

  App.launchShift = function (config, opts) {
    if (App.busy) return;
    App.busy = true;
    EM.ui.closeModal();
    EM.ui.loading(true, '正在接入 ' + (D.WORLD_NAME) + '…');
    setTimeout(function () {
      try {
        var seed = opts.seed >>> 0;
        var world = EM.map.generate(seed);
        var sim = new EM.sim.Simulation({
          world: world,
          config: config,
          mode: opts.mode,
          difficulty: opts.difficulty,
          funds: opts.funds,
          upgrades: opts.upgrades,
          players: opts.players,
          remote: false
        });
        App.sim = sim;
        App.shift = config;
        App.world = world;
        App.mode = opts.mode;
        App.netRole = null;
        App.selectedIncident = null;
        App.selectedUnit = null;
        App.paused = true;
        App.speed = U.clamp(Number(App.settings.speedDefault) || 1, 1, 4);
        App.ending = false;
        App.lastEventId = sim.getLastEventId();
        App.lastSummary = null;
        App.summaryContext = null;
        App._lastFrame = performance.now();
        App._snapAcc = 0;
        App.netSynced = false;
        App.renderer.setWorld(world);
        focusStartArea(config);
        App.screen = 'game';
        EM.ui.showScreen('game');
        EM.ui.loading(false);
        EM.ui.showBriefing(Object.assign({}, config, { difficultyId: config.difficultyId || (opts.difficulty && opts.difficulty.id) }), { mode: opts.mode });
      } catch (e) {
        console.error(e);
        EM.ui.loading(false);
        EM.ui.toast('启动失败：' + e.message, 'bad');
      } finally {
        App.busy = false;
      }
    }, 30);
  };

  function focusStartArea(config) {
    var city = D.DISTRICTS[0];
    var x = (city.x + city.w / 2) * D.WORLD.TILE;
    var y = (city.y + city.h / 2) * D.WORLD.TILE;
    var mobile = App.renderer.w < 700;
    var z = mobile
      ? Math.max(0.2, Math.min(0.34, App.renderer.fitZoom(16) * 3.4))
      : Math.max(0.56, Math.min(0.68, App.renderer.fitZoom(30) * 1.6));
    App.renderer.focusOn(x, y, z, true);
  }

  App.onBriefingDone = function () {
    App.paused = false;
    App._lastFrame = performance.now();
    EM.ui.toast('值班开始 · 保持频道畅通', 'good');
    EM.audio.play('alert');
  };

  App.setPaused = function (v) {
    if (App.screen !== 'game') return;
    if (App.mode === 'coop' && App.netRole === 'guest') {
      // 加入者不能暂停房主的模拟，只记录本地遮罩状态
      App.paused = !!v;
      return;
    }
    App.paused = !!v;
    if (!v) App._lastFrame = performance.now();
  };
  App.setSpeed = function (v) {
    if (App.mode === 'coop' && App.netRole === 'guest') {
      EM.ui.toast('联机行动的时间由房主控制', 'warn');
      return;
    }
    App.speed = U.clamp(Number(v) || 1, 1, 4);
  };

  /* ---------------------------------------------------------------------
     选择 / 派遣
     --------------------------------------------------------------------- */
  App.selectIncident = function (id) {
    var s = App.sim;
    if (!s) return;
    var inc = s.findIncident ? s.findIncident(id) : null;
    if (!inc || inc.status !== 'active') return;
    App.selectedIncident = id;
    App.selectedUnit = null;
    App.renderer.focusOn(inc.x, inc.y, Math.max(App.renderer.cam.tz, U.isMobileLayout() ? 0.5 : 0.72));
  };
  App.selectUnit = function (id) {
    if (!id) { App.selectedUnit = null; return; }
    var s = App.sim;
    var u = s && s.unitById[id];
    if (!u) return;
    App.selectedUnit = id;
    App.selectedIncident = null;
    App.renderer.focusOn(u.x, u.y, Math.max(App.renderer.cam.tz, U.isMobileLayout() ? 0.6 : 0.95));
  };
  App.clearSelection = function () {
    App.selectedIncident = null;
    App.selectedUnit = null;
  };
  App.focusWorld = function (x, y) {
    App.renderer.focusOn(x, y, Math.max(App.renderer.cam.tz, 0.95));
  };

  App.dispatch = function (unitIds, incidentId) {
    var s = App.sim;
    if (!s) return { ok: false, reason: '还没有开始值班' };
    if (App.mode === 'coop' && App.netRole === 'guest') {
      if (!App.net) return { ok: false, reason: '连接已断开' };
      App.net.sendCommand({ cmd: 'dispatch', units: unitIds, incidentId: incidentId });
      return { ok: true, queued: true };
    }
    return s.dispatch(unitIds, incidentId, App.myPlayerId);
  };
  App.autoDispatch = function (incidentId) {
    var s = App.sim;
    if (!s) return { ok: false, reason: '还没有开始值班' };
    var res;
    if (App.mode === 'coop' && App.netRole === 'guest') {
      if (!App.net) return { ok: false, reason: '连接已断开' };
      App.net.sendCommand({ cmd: 'auto', incidentId: incidentId });
      res = { ok: true, queued: true };
    } else {
      res = s.autoDispatch(incidentId, App.myPlayerId);
    }
    if (res && res.ok && App.achievements && App.achievements.counters) {
      App.achievements.counters.auto = (App.achievements.counters.auto || 0) + 1;
      saveAchievements();
      App.checkProgressAchievements();
    }
    return res;
  };
  App.recall = function (unitId) {
    var s = App.sim;
    if (!s) return { ok: false, reason: '还没有开始值班' };
    if (App.mode === 'coop' && App.netRole === 'guest') {
      if (!App.net) return { ok: false, reason: '连接已断开' };
      App.net.sendCommand({ cmd: 'recall', unitId: unitId });
      return { ok: true, queued: true };
    }
    return s.recall(unitId);
  };

  /* ---------------------------------------------------------------------
     事件 / 结算
     --------------------------------------------------------------------- */
  function drainEvents() {
    var s = App.sim;
    if (!s || !s.events) return;
    var last = App.lastEventId || 0;
    var evs = s.events.filter(function (e) { return e.id > last; });
    for (var i = 0; i < evs.length; i++) {
      var ev = evs[i];
      App.lastEventId = Math.max(App.lastEventId, ev.id);
      handleEvent(ev);
    }
  }

  function handleEvent(ev) {
    switch (ev.type) {
      case 'spawn':
        EM.audio.play(ev.priority === 1 ? 'critical' : 'alert');
        if (ev.priority === 1) {
          EM.ui.flashCritical();
          EM.ui.toast('紧急警情：' + (ev.label || ev.name), 'bad');
          maybeAutoPause(ev);
        }
        break;
      case 'finale':
        EM.audio.play('critical');
        EM.ui.flashCritical();
        EM.ui.toast('大事件：' + (ev.name || '') + ' · ' + (ev.label || ''), 'bad');
        EM.ui.flashCritical();
        maybeAutoPause(ev);
        break;
      case 'dispatch':
        EM.audio.play('dispatch');
        break;
      case 'arrive':
        EM.audio.play('arrive');
        break;
      case 'resolve':
        EM.audio.play('resolve');
        if (App.achievements && App.achievements.counters) {
          var rc = App.achievements.counters;
          rc.resolved = (rc.resolved || 0) + 1;
          var rinc = App.sim && App.sim.incidentById ? App.sim.incidentById[ev.incidentId] : null;
          if (rinc) {
            if (rinc.needs && (rinc.needs.hazmat || rinc.defId === 'chem_explosion' || rinc.defId === 'tank_fire')) rc.hazmat = (rc.hazmat || 0) + 1;
            if (rinc.firstArrivalAt != null && (rinc.firstArrivalAt - rinc.createdAt) <= 40) rc.quick = (rc.quick || 0) + 1;
          }
          saveAchievements();
          App.checkProgressAchievements();
        }
        break;
      case 'fail':
        EM.audio.play('fail');
        if (ev.explosive) {
          var s = App.sim;
          var inc = s && s.incidentById[ev.incidentId];
          if (inc) {
            App.renderer.explode(inc.x, inc.y, inc.priority === 1 ? 1.7 : 1.1);
            EM.audio.play('explosion');
          }
        }
        EM.ui.flashCritical();
        EM.ui.toast('处置失败：' + (ev.label || ''), 'bad');
        break;
      case 'spread':
        EM.audio.play('alert');
        EM.ui.toast('火势蔓延：' + (ev.label || ''), 'warn');
        break;
      case 'defeat':
        EM.audio.play('defeat');
        break;
      case 'shiftEnd':
        EM.audio.play('victory');
        break;
      case 'wave':
        EM.audio.play('alert');
        EM.ui.toast('值班强度上升 · 第 ' + ev.wave + ' 波', 'warn');
        break;
      case 'recall':
        break;
    }
  }

  function maybeAutoPause(ev) {
    if (!App.settings.autoPauseOnCritical) return;
    if (App.mode === 'coop' && App.netRole === 'guest') return;
    if (App.paused) return;
    App.setPaused(true);
    EM.ui.toast('已按设置自动暂停。按空格继续。', 'warn');
  }

  function checkPhaseEnd() {
    if (!App.sim || App.screen !== 'game' || App.ending) return;
    if (App.sim.phase === 'active') return;
    App.ending = true;
    var delay = App.sim.phase === 'failed' ? 1000 : 700;
    setTimeout(function () {
      if (App.screen === 'game') App.finishShift();
    }, delay);
  }

  App.finishShift = function () {
    var s = App.sim;
    if (!s || App.screen !== 'game') return;
    var summary = s.getSummary();
    summary.earnedFunds = Math.max(0, summary.funds - summary.startFunds);
    var won = summary.phase === 'ended' && !summary.failed;
    var shiftIndexBefore = App.campaign ? App.campaign.shiftIndex : 0;
    App.paused = true;
    App.lastSummary = summary;
    App.summaryContext = { mode: App.mode, won: won, earnedFunds: summary.earnedFunds, newBest: false };
    if (App.mode === 'campaign' && App.campaign) {
      if (won) {
        App.campaign.funds = Math.max(0, Math.round(summary.funds));
        App.campaign.totalScore = (App.campaign.totalScore || 0) + summary.score;
        App.campaign.totals.score += summary.score;
        App.campaign.totals.deaths += summary.deaths;
        App.campaign.totals.resolved += summary.stats.resolved;
        App.campaign.totals.failed += summary.stats.failed;
        App.campaign.totals.shifts++;
        App.campaign.shiftIndex++;
        if (App.campaign.shiftIndex >= D.SHIFTS.length) App.campaign.completed = true;
        saveCampaign();
      }
    } else if (App.mode === 'endless') {
      App.stats = App.stats || {};
      App.stats.runs = (App.stats.runs || 0) + 1;
      if (summary.score > (App.stats.bestEndless || 0)) {
        App.stats.bestEndless = summary.score;
        App.summaryContext.newBest = !won ? false : true;
      }
      App.stats.lastScore = summary.score;
      U.store.set(D.STATS_KEY, App.stats);
    }
    if (App.mode === 'coop' && App.netRole === 'host' && App.net) {
      // 让加入者一定收到最终状态
      App.net.broadcastSnapshot(s.snapshot());
    }
    // 成就与本机排行榜：无论胜负都记录一次，方便复盘
    var actx = {
      mode: App.mode, won: won, grade: summary.grade,
      deaths: summary.deaths || 0,
      total: (summary.stats.resolved || 0) + (summary.stats.failed || 0),
      failed: summary.stats.failed || 0,
      score: summary.score || 0,
      shiftIndex: shiftIndexBefore,
      completed: !!(App.campaign && App.campaign.completed),
      wave: summary.wave || 0
    };
    App.evaluateShiftAchievements(actx);
    App.addLeaderboard(summary, actx);
    App.summaryContext.boardRank = actx.boardRank || null;
    App.screen = 'summary';
    EM.ui.showSummary(summary);
  };

  App.afterSummary = function (action) {
    if (App.mode === 'campaign') {
      if (action === 'retry') {
        App.startShift(App.campaign ? App.campaign.shiftIndex : 0);
        return;
      }
      if (action === 'menu') { App.showMenu(); return; }
      if (action === 'next') {
        if (!App.campaign) { App.showMenu(); return; }
        if (App.campaign.completed) { App.showMenu(); return; }
        App.screen = 'shop';
        EM.ui.showShop();
        return;
      }
      return;
    }
    if (App.mode === 'endless') {
      if (action === 'menu') { App.showMenu(); return; }
      App.startEndless();
      return;
    }
    if (App.mode === 'coop') {
      if (action === 'menu') { App.leaveRoom(); App.showMenu(); return; }
      if (App.netRole === 'host') App.endCoop();
      else { App.leaveRoom(); App.showMenu(); }
    }
  };

  App.beginNextShift = function () {
    if (!App.campaign) { App.showMenu(); return; }
    if (App.campaign.completed) { App.showMenu(); return; }
    App.startShift(App.campaign.shiftIndex);
  };

  App.retryShift = function () {
    if (App.mode === 'campaign') App.startShift(App.campaign ? App.campaign.shiftIndex : 0);
    else App.startEndless();
  };

  App.abandonToMenu = function () {
    if (App.mode === 'coop') { App.endCoop(); return; }
    App.showMenu();
  };

  App.buyUpgrade = function (id) {
    var up = D.UPGRADE_BY_ID[id];
    if (!up || !App.campaign) return { ok: false, reason: '没有可采购的项目' };
    if (App.campaign.upgrades.indexOf(id) >= 0) return { ok: false, reason: '已经拥有这个升级' };
    if (App.campaign.funds < up.cost) return { ok: false, reason: '资金不足' };
    App.campaign.funds -= up.cost;
    App.campaign.upgrades.push(id);
    saveCampaign();
    if (App.achievements && App.achievements.counters) {
      App.achievements.counters.buy = (App.achievements.counters.buy || 0) + 1;
      saveAchievements();
      App.checkProgressAchievements();
    }
    return { ok: true, name: up.name };
  };

  App.saveAndMenu = function () { saveCampaign(); App.showMenu(); };

  App.clearLeaderboard = function () {
    App.leaderboard = [];
    U.store.set(D.BOARD_KEY, []);
    saveLeaderboard();
  };

  App.restartShift = function () {
    App.screen = 'menu';
    if (App.mode === 'endless') App.startEndless();
    else App.startShift(App.campaign ? App.campaign.shiftIndex : 0);
  };

  App.resetSave = function () {
    U.store.remove(D.SAVE_KEY);
    U.store.remove(D.STATS_KEY);
    U.store.remove(D.SETTINGS_KEY);
    U.store.remove(D.ACH_KEY);
    U.store.remove(D.BOARD_KEY);
    App.campaign = null;
    App.stats = {};
    App.achievements = { unlocked: [], counters: { resolved: 0, auto: 0, hazmat: 0, quick: 0, buy: 0 } };
    App.leaderboard = [];
    App.settings = U.deepMerge(D.DEFAULT_SETTINGS, {});
    App.applySettings();
    App.showMenu();
    EM.ui.refreshMenu();
  };

  /* ---------------------------------------------------------------------
     联机
     --------------------------------------------------------------------- */
  App.openCoop = function () {
    App.closeNet();
    App.mode = 'coop';
    App.netRole = null;
    App.lobbyState = null;
    App.lobbyPlayers = [];
    App.lobbyJoining = false;
    App.lobbyError = '';
    App.myPlayerId = 'p1';
    App.screen = 'lobby';
    EM.ui.showScreen('lobby');
    EM.ui.setLobbyState({ role: null, code: null, players: [], error: '' });
    EM.ui.setLobbyError('');
  };

  App.createRoom = function (name) {
    App.closeNet();
    App.mode = 'coop';
    App.netRole = 'host';
    App.myPlayerId = 'p1';
    App.lobbyJoining = true;
    App.lobbyError = '';
    App.lobbyStats = null;
    App.lobbyState = { role: 'host', code: null, players: [], error: '' };
    App.lobbyPlayers = [];
    EM.ui.openLobby();
    EM.ui.setLobbyState(App.lobbyState);
    var self = App;
    App.net = EM.net.createHost({
      name: name,
      onLobby: function (players, meta) {
        self.lobbyPlayers = players;
        self.lobbyJoining = false;
        self.lobbyState = {
          role: 'host',
          code: meta.code,
          players: players,
          state: meta.state,
          difficulty: self.coopDifficulty,
          error: self.lobbyError || ''
        };
        self.roomCode = meta.code;
        if (self.screen === 'lobby') EM.ui.setLobbyState(self.lobbyState);
      },
      onStart: function (config) {
        self.beginCoopGame(config, false);
      },
      onCommand: function (playerId, msg) {
        self.handleNetCommand(playerId, msg);
      },
      onPlayerLeave: function (p) {
        EM.ui.toast((p.name || '队友') + ' 离开了行动', 'warn');
      },
      onClose: function (reason) {
        if (self._closingNet) return;
        self.cleanupNet();
        if (self.screen === 'game' || self.screen === 'lobby' || self.screen === 'summary') {
          EM.ui.toast(reason || '房间已关闭', 'bad');
          self.showMenu();
        }
      },
      onError: function (msg) {
        self.lobbyJoining = false;
        self.lobbyError = msg;
        if (self.lobbyState) self.lobbyState.error = msg;
        if (self.screen === 'lobby') {
          EM.ui.setLobbyState(self.lobbyState || { role: 'host', players: [], error: msg });
        }
        EM.ui.toast(msg, 'bad');
      }
    });
  };

  App.joinRoom = function (code, name) {
    App.closeNet();
    App.mode = 'coop';
    App.netRole = 'guest';
    App.lobbyJoining = true;
    App.lobbyError = '';
    App.lobbyState = { role: 'guest', code: code, players: [], error: '' };
    App.lobbyPlayers = [];
    EM.ui.openLobby();
    EM.ui.setLobbyState(App.lobbyState);
    var self = App;
    App.net = EM.net.join({
      code: code,
      name: name,
      onLobby: function (players, meta) {
        self.lobbyJoining = false;
        self.lobbyPlayers = players;
        self.lobbyState = { role: 'guest', code: meta.code || code, players: players, state: 'lobby', error: self.lobbyError || '' };
        self.roomCode = meta.code || code;
        self.myPlayerId = self.net ? self.net.playerId : 'p2';
        if (self.screen === 'lobby') EM.ui.setLobbyState(self.lobbyState);
      },
      onStart: function (config) {
        self.beginCoopGame(config, true);
      },
      onSnapshot: function (snap) {
        self.applyCoopSnapshot(snap);
      },
      onNotice: function (text) {
        if (text) EM.ui.toast(text, 'warn');
      },
      onClose: function (reason) {
        if (self._closingNet) return;
        self.cleanupNet();
        EM.ui.toast(reason || '与房主的连接已断开', 'bad');
        self.showMenu();
      },
      onError: function (msg) {
        self.lobbyJoining = false;
        self.lobbyError = msg;
        if (self.lobbyState) self.lobbyState.error = msg;
        if (self.screen === 'lobby') {
          self.lobbyState.role = null;
          EM.ui.setLobbyState(self.lobbyState);
          EM.ui.setLobbyError(msg);
        }
        EM.ui.toast(msg, 'bad');
      }
    });
  };

  App.setCoopDifficulty = function (v) {
    App.coopDifficulty = v;
    if (App.lobbyState && App.lobbyState.role === 'host') {
      App.lobbyState.difficulty = v;
      if (App.net && App.net.broadcast) {
        App.net.broadcast({ t: 'notice', text: '房主把难度改为：' + (D.DIFFICULTY[v] || D.DIFFICULTY.normal).name });
      }
    }
  };

  App.startCoop = function () {
    if (!App.net || App.net.role !== 'host' || App.net.state !== 'lobby') return;
    var players = App.net.publicPlayers();
    var difficultyId = App.coopDifficulty || App.settings.difficulty || 'normal';
    var shift = Object.assign({}, D.COOP, {
      name: '联合行动',
      difficultyId: difficultyId,
      startRep: 85,
      startFunds: 0,
      maxDeaths: 20,
      duration: 600,
      intro: '共享同一座临江市。房主主持时间与模拟，所有调度员共享分数与警情。'
    });
    var payload = {
      seed: (Math.random() * 1e9) >>> 0,
      difficultyId: difficultyId,
      players: players,
      shift: shift
    };
    if (App.net.start(payload)) {
      App.lobbyJoining = true;
    }
  };

  App.beginCoopGame = function (payload, remote) {
    if (!payload || !payload.seed || !payload.shift) {
      EM.ui.toast('联机行动参数无效', 'bad');
      return;
    }
    App.busy = true;
    EM.ui.closeModal();
    EM.ui.loading(true, remote ? '正在同步临江市…' : '正在布置联合行动…');
    setTimeout(function () {
      try {
        var world = EM.map.generate(payload.seed >>> 0);
        var difficulty = D.DIFFICULTY[payload.difficultyId] || D.DIFFICULTY.normal;
        var players = payload.players && payload.players.length ? payload.players : [{ id: 'p1', name: '指挥官', color: '#67dcff' }];
        var sim = new EM.sim.Simulation({
          world: world,
          config: payload.shift,
          mode: 'coop',
          difficulty: difficulty,
          funds: payload.shift.startFunds || 0,
          upgrades: [],
          players: players,
          remote: !!remote
        });
        App.sim = sim;
        App.shift = payload.shift;
        App.world = world;
        App.mode = 'coop';
        App.netRole = remote ? 'guest' : 'host';
        App.myPlayerId = remote && App.net ? (App.net.playerId || 'p2') : 'p1';
        App.lobbyPlayers = players;
        App.lobbyState = { role: App.netRole, code: App.roomCode, players: players, state: 'playing', difficulty: payload.difficultyId };
        App.selectedIncident = null;
        App.selectedUnit = null;
        App.paused = false;
        App.speed = 1;
        App.ending = false;
        App.lastEventId = 0;
        App.netSynced = false;
        App._lastFrame = performance.now();
        App._snapAcc = 0;
        App.renderer.setWorld(world);
        focusStartArea(payload.shift);
        App.screen = 'game';
        EM.ui.showScreen('game');
        EM.ui.loading(false);
        EM.ui.toast(remote ? '已加入联合行动' : '联合行动开始 · 房间 ' + (App.roomCode || ''), 'good');
        EM.audio.play('alert');
      } catch (e) {
        console.error(e);
        EM.ui.loading(false);
        EM.ui.toast('联机行动启动失败：' + e.message, 'bad');
      } finally {
        App.busy = false;
      }
    }, 30);
  };

  App.applyCoopSnapshot = function (snap) {
    if (!App.sim) return;
    var wasFresh = !App.netSynced;
    App.sim.applySnapshot(snap);
    if (wasFresh) {
      App.netSynced = true;
      App.lastEventId = (snap.events && snap.events.length) ? snap.events[snap.events.length - 1].id : 0;
    } else {
      drainEvents();
    }
    App.netPing = App.net ? (App.net.ping || 0) : 0;
    checkPhaseEnd();
  };

  App.handleNetCommand = function (playerId, msg) {
    var s = App.sim;
    if (!s || App.screen !== 'game' || App.mode !== 'coop' || App.netRole !== 'host') return;
    var res = null;
    if (msg.cmd === 'dispatch' && Array.isArray(msg.units)) {
      res = s.dispatch(msg.units.slice(0, 6), msg.incidentId, playerId);
    } else if (msg.cmd === 'auto') {
      res = s.autoDispatch(msg.incidentId, playerId);
    } else if (msg.cmd === 'recall') {
      res = s.recall(msg.unitId);
    }
    if (res && !res.ok && App.net) {
      App.net.broadcast({ t: 'notice', text: res.reason || '指令无效' });
    }
    if (App.net) App.net.broadcastSnapshot(s.snapshot());
  };

  App.leaveRoom = function () {
    App.closeNet();
    App.cleanupNet();
  };

  App.endCoop = function () {
    App.closeNet();
    App.cleanupNet();
    App.showMenu();
  };

  App.backToMenuFromLobby = function (silent) {
    App.closeNet();
    App.cleanupNet();
    App.showMenu();
  };

  App.closeNet = function () {
    if (!App.net) return;
    App._closingNet = true;
    try { App.net.close(); } catch (e) { }
    App.net = null;
    setTimeout(function () { App._closingNet = false; }, 300);
  };

  App.cleanupNet = function () {
    App.net = null;
    App.netRole = null;
    App.roomCode = null;
    App.lobbyState = null;
    App.lobbyPlayers = [];
    App.lobbyJoining = false;
    App.lobbyError = '';
    App.netPing = 0;
    App.myPlayerId = 'p1';
  };

  /* ---------------------------------------------------------------------
     主循环
     --------------------------------------------------------------------- */
  function startLoop() {
    if (App._loopStarted) return;
    App._loopStarted = true;
    App._lastFrame = performance.now();
    requestAnimationFrame(frame);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.05, Math.max(0, (now - App._lastFrame) / 1000));
    App._lastFrame = now;
    if (!App.renderer) return;

    var isHostSim = App.sim && (App.mode !== 'coop' || App.netRole === 'host');

    if (App.screen === 'game' && App.sim) {
      if (isHostSim && !App.paused && App.sim.phase === 'active') {
        var speed = U.clamp(App.speed || 1, 1, 4);
        var acc = App._simAcc || 0;
        acc += dt * speed;
        var steps = 0;
        while (acc >= 1 / 30 && steps < 12) {
          App.sim.step(1 / 30);
          acc -= 1 / 30;
          steps++;
        }
        App._simAcc = acc;
      } else if (App.paused) {
        App._simAcc = 0;
      }
      if (isHostSim) drainEvents();
      // 联机加入者：把服务器目标位置平滑到显示位置，避免 7Hz 快照的跳帧
      if (App.mode === 'coop' && App.netRole === 'guest' && App.sim.units) {
        var k = 1 - Math.exp(-dt * 14);
        App.sim.units.forEach(function (u) {
          if (u.tx == null) return;
          u.x += (u.tx - u.x) * k;
          u.y += (u.ty - u.y) * k;
          if (u.ta != null) u.angle = U.angleLerp(u.angle, u.ta, Math.min(1, dt * 10));
        });
      }
      if (App.mode === 'coop' && App.netRole === 'host' && App.net) {
        App._snapAcc += dt;
        if (App._snapAcc >= 0.14) {
          App._snapAcc = 0;
          App.net.broadcastSnapshot(App.sim.snapshot());
        }
      }
      checkPhaseEnd();
      if (App.settings.fpsCap && now - App._lastRender < 1000 / App.settings.fpsCap - 2) {
        return;
      }
      App._lastRender = now;
      App.renderer.drawGame(App.sim, {
        dt: dt,
        settings: App.settings,
        selected: App.selectedUnit ? { kind: 'unit', id: App.selectedUnit } : null,
        selectedIncident: App.selectedIncident
      });
    } else if (App.screen === 'menu' || App.screen === 'lobby') {
      if (App.settings.fpsCap && now - App._lastRender < 1000 / App.settings.fpsCap - 2) return;
      App._lastRender = now;
      App.renderer.drawMenu(dt);
    } else if (App.screen === 'summary' || App.screen === 'shop') {
      if (App.settings.fpsCap && now - App._lastRender < 1000 / App.settings.fpsCap - 2) return;
      App._lastRender = now;
      if (App.sim) {
        App.renderer.drawGame(App.sim, { dt: dt, settings: App.settings, selected: null, selectedIncident: null });
      } else {
        App.renderer.drawMenu(dt);
      }
    }

    EM.ui.update(dt);
    if (EM.audio) EM.audio.update(dt, App.screen === 'game' ? App.sim : (App.screen === 'summary' ? App.sim : null), App.renderer);
    if (App.net) App.netPing = App.net.ping || 0;
  }

  /* ---------------------------------------------------------------------
     输入
     --------------------------------------------------------------------- */
  function canvasPoint(e) { return { x: e.clientX, y: e.clientY }; }
  function isModalOpen() {
    var m = document.getElementById('modal-root');
    return m && !m.classList.contains('hidden');
  }

  function bindInput() {
    var canvas = document.getElementById('world');
    if (!canvas) return;

    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvas.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (isModalOpen()) return;
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      var p = App.pointer;
      if (e.pointerType === 'touch') {
        App._touches = App._touches || {};
        App._touches[e.pointerId] = { x: e.clientX, y: e.clientY };
        var ids = Object.keys(App._touches);
        if (ids.length === 2) {
          p.pinching = true;
          p.dragging = true;
          App._pinchDist = touchDist(App._touches);
          App._pinchMid = touchMid(App._touches);
        }
      }
      p.down = true;
      p.dragging = false;
      p.startX = p.lastX = e.clientX;
      p.startY = p.lastY = e.clientY;
      p.inside = true;
      EM.ui.hideTooltip();
    });
    canvas.addEventListener('pointermove', function (e) {
      var p = App.pointer;
      p.inside = true;
      p.x = e.clientX; p.y = e.clientY;
      if (e.pointerType === 'touch' && App._touches && App._touches[e.pointerId]) {
        App._touches[e.pointerId] = { x: e.clientX, y: e.clientY };
        if (p.pinching && Object.keys(App._touches).length >= 2) {
          var d = touchDist(App._touches);
          var mid = touchMid(App._touches);
          if (App._pinchDist > 5) {
            App.renderer.zoomAt(mid.x, mid.y, d / App._pinchDist);
            if (App._pinchMid) App.renderer.panBy(mid.x - App._pinchMid.x, mid.y - App._pinchMid.y);
          }
          App._pinchDist = d;
          App._pinchMid = mid;
          return;
        }
      }
      if (!p.down) {
        if (App.screen === 'game') updateHover(e.clientX, e.clientY);
        return;
      }
      var dx = e.clientX - p.lastX, dy = e.clientY - p.lastY;
      if (Math.abs(e.clientX - p.startX) + Math.abs(e.clientY - p.startY) > 6) p.dragging = true;
      if (p.dragging) {
        App.renderer.panBy(dx, dy);
        EM.ui.hideTooltip();
      }
      p.lastX = e.clientX; p.lastY = e.clientY;
    });
    function endPointer(e) {
      var p = App.pointer;
      if (e.pointerType === 'touch' && App._touches) {
        delete App._touches[e.pointerId];
        if (Object.keys(App._touches).length < 2) p.pinching = false;
      }
      if (!p.down) return;
      p.down = false;
      var moved = Math.abs(e.clientX - p.startX) + Math.abs(e.clientY - p.startY);
      if (!p.dragging && moved < 8 && App.screen === 'game') onMapClick(e.clientX, e.clientY);
      p.dragging = false;
    }
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('pointerleave', function () { App.pointer.inside = false; EM.ui.hideTooltip(); });
    canvas.addEventListener('wheel', function (e) {
      if (App.screen !== 'game' && App.screen !== 'menu') return;
      e.preventDefault();
      var f = e.deltaY > 0 ? 0.9 : 1.1;
      App.renderer.zoomAt(e.clientX, e.clientY, f);
      EM.ui.hideTooltip();
    }, { passive: false });

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', function () { EM.ui.hideTooltip(); });
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });
  }

  function touchDist(t) {
    var ids = Object.keys(t); if (ids.length < 2) return 0;
    var a = t[ids[0]], b = t[ids[1]];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  function touchMid(t) {
    var ids = Object.keys(t); if (ids.length < 2) return null;
    var a = t[ids[0]], b = t[ids[1]];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function unlockAudio() {
    try {
      EM.audio.init(App.settings);
      EM.audio.applySettings(App.settings);
      EM.audio.unlock();
    } catch (e) { }
  }

  function onMapClick(x, y) {
    var s = App.sim;
    if (!s) return;
    var pick = App.renderer.pick(x, y, s);
    if (!pick) {
      App.clearSelection();
      if (U.isMobileLayout()) EM.ui.closeSheets();
      return;
    }
    if (pick.kind === 'minimap') {
      App.renderer.focusOn(pick.wx, pick.wy, Math.max(App.renderer.cam.tz, 0.8));
      return;
    }
    if (pick.kind === 'incident') {
      App.selectIncident(pick.id);
      if (U.isMobileLayout()) EM.ui.openSheet('detail');
      sfxClick();
      return;
    }
    if (pick.kind === 'unit') {
      App.selectUnit(pick.id);
      if (U.isMobileLayout()) EM.ui.openSheet('detail');
      sfxClick();
    }
  }

  function updateHover(x, y) {
    var s = App.sim;
    if (!s) return;
    var pick = App.renderer.pick(x, y, s);
    if (!pick || pick.kind === 'minimap') { EM.ui.hideTooltip(); return; }
    if (pick.kind === 'incident') {
      var inc = s.incidentById[pick.id];
      if (!inc) return;
      var p = D.PRIORITIES[inc.priority];
      EM.ui.setTooltip('<b>' + inc.icon + ' ' + U.esc(inc.name) + '</b><small>' + U.esc(inc.label) + '</small><small style="color:' + p.color + '">' + p.label + ' · 剩余 ' + U.fmtTimer(inc.timeLeft) + ' · 进度 ' + Math.round(inc.progress) + '%</small>', x, y);
    } else {
      var u = s.unitById[pick.id];
      if (!u) return;
      EM.ui.setTooltip('<b>' + u.def.icon + ' ' + U.esc(u.def.name) + '</b><small>' + U.esc(u.homeStationName) + ' · ' + ({ idle: '待命', enroute: '出动中', scene: '现场处置', returning: '返回基地', resting: '整备中' }[u.status] || u.status) + '</small>', x, y);
    }
  }
  function sfxClick() { EM.audio.play('click'); }

  function onKeyDown(e) {
    var tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (e.key === 'Escape') {
      if (isModalOpen()) {
        var m = document.getElementById('modal-root').querySelector('[data-modal]');
        if (m && m.getAttribute('data-modal') === 'pause') { EM.ui.closeModal(); App.setPaused(false); return; }
        EM.ui.onKeyEscape();
        e.preventDefault();
        return;
      }
      if (App.screen === 'game') { EM.ui.openPause(); e.preventDefault(); return; }
      if (App.screen === 'summary') { EM.ui.toast('使用下方按钮继续', 'warn'); return; }
      if (App.screen === 'shop') { App.saveAndMenu(); return; }
      if (App.screen === 'lobby') { App.backToMenuFromLobby(); return; }
      return;
    }
    if (App.screen !== 'game' || isModalOpen()) return;
    if (e.code === 'Space') {
      e.preventDefault();
      App.setPaused(!App.paused);
      return;
    }
    if (e.key === '1' || e.key === '2' || e.key === '3') {
      App.setPaused(false);
      App.setSpeed(e.key === '1' ? 1 : e.key === '2' ? 2 : 4);
      return;
    }
    if (e.key === 'f' || e.key === 'F') { App.fitMap(); return; }
    if (e.key === 'h' || e.key === 'H') { EM.ui.openHelp(); return; }
    if (e.key === 'm' || e.key === 'M') {
      App.setSetting('minimap', !App.settings.minimap);
      EM.ui.toast('小地图：' + (App.settings.minimap ? '开' : '关'), 'good');
      return;
    }
    var pan = 150 / App.renderer.cam.zoom;
    if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') { App.renderer.cam.tx -= pan; e.preventDefault(); }
    else if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') { App.renderer.cam.tx += pan; e.preventDefault(); }
    else if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') { App.renderer.cam.ty -= pan; e.preventDefault(); }
    else if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') { App.renderer.cam.ty += pan; e.preventDefault(); }
  }

  function bindVisibility() {
    document.addEventListener('visibilitychange', function () {
      var hidden = document.hidden;
      if (EM.audio) EM.audio.setActive(!hidden);
      if (hidden && App.screen === 'game' && !App.paused && !(App.mode === 'coop' && App.netRole === 'guest')) {
        App.setPaused(true);
      }
    });
  }

  /* ---------------------------------------------------------------------
     调试接口（自动化测试用，不影响正常玩家）
     --------------------------------------------------------------------- */
  App.debug = {
    state: function () {
      return {
        screen: App.screen, mode: App.mode, paused: App.paused, speed: App.speed,
        clock: App.sim ? App.sim.clock : 0, phase: App.sim ? App.sim.phase : null,
        incidents: App.sim ? App.sim.activeIncidents().map(function (i) { return { id: i.id, name: i.name, label: i.label, timeLeft: i.timeLeft, assigned: i.assigned.length }; }) : [],
        units: App.sim ? App.sim.units.map(function (u) { return { id: u.id, type: u.type, status: u.status, cooldown: u.cooldown }; }) : [],
        funds: App.sim ? App.sim.funds : 0,
        rep: App.sim ? App.sim.reputation : 0,
        deaths: App.sim ? App.sim.deaths : 0,
        campaign: App.campaign,
        error: App.lobbyError
      };
    },
    spawn: function (defId) {
      if (!App.sim) return false;
      var def = D.INCIDENT_BY_ID[defId];
      if (!def) return false;
      var spot = App.sim.world.pickSpot(def, Math.random, {});
      if (!spot) return false;
      App.sim.spawnIncident(def, spot, {});
      drainEvents();
      return true;
    },
    fastForward: function (seconds) {
      if (!App.sim) return null;
      var steps = Math.min(30000, Math.ceil(seconds * 30));
      for (var i = 0; i < steps; i++) {
        if (App.sim.phase !== 'active') break;
        App.sim.step(1 / 30);
        // 自动派车，便于跑完整流程
        if (i % 150 === 0) {
          var list = App.sim.activeIncidents();
          for (var j = 0; j < list.length; j++) App.sim.autoDispatch(list[j].id, 'p1');
        }
      }
      drainEvents();
      checkPhaseEnd();
      return App.debug.state();
    },
    forceEnd: function () {
      if (!App.sim) return;
      App.sim.clock = App.shift.duration || App.sim.clock;
      App.sim.incidents.forEach(function (i) { if (i.status === 'active') App.sim.resolveIncident(i); });
      App.sim.phase = 'ended';
      App.finishShift();
    },
    addFunds: function (n) { if (App.sim) App.sim.funds += n; },
    win: function () { App.debug.forceEnd(); },
    lose: function () { if (App.sim) { App.sim.deaths = 99; App.sim.failed = true; App.sim.phase = 'failed'; App.finishShift(); } },
    auto: function () { var s = App.sim; if (!s) return; s.activeIncidents().forEach(function (i) { s.autoDispatch(i.id, 'p1'); }); }
  };

  root.__GAME = App;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { App.boot(); });
  } else {
    App.boot();
  }
})(window);
