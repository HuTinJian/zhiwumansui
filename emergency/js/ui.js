/* =========================================================================
   临界 · 紧急调度 — 界面层（DOM / HUD / 弹层 / 设置 / 结算 / 补给站 / 联机大厅）
   说明：所有动态内容均通过 textContent 或 U.esc 转义，不做远程 HTML 注入。
   回退办法：删除 emergency/ 目录或 revert；不影响网站既有页面。
   ========================================================================= */
(function (root) {
  'use strict';
  var EM = root.EM = root.EM || {};
  var U = EM.util, D = EM.data;
  var UI = EM.ui = {};
  var app = null;
  var el = {};
  var acc = 0, listAcc = 0;
  var lastSigs = { queue: '', detail: '', units: '', radio: '' };
  var modalReturn = null;
  var modalPausedGame = false;

  function sfx(name) { try { EM.audio.play(name); } catch (e) { } }

  function isCoop() { return app && app.mode === 'coop'; }
  function isGuest() { return isCoop() && app.netRole === 'guest'; }
  function sim() { return app ? app.getSim() : null; }
  function cfg() { return app ? (app.shift || null) : null; }
  function esc(s) { return U.esc(s); }
  function prio(inc) { return D.PRIORITIES[inc.priority] || D.PRIORITIES[3]; }

  function statusText(st) {
    return ({ idle: '待命', enroute: '出动中', scene: '现场处置', returning: '返回基地', resting: '整备中' })[st] || st;
  }
  function statusClass(st) {
    return st === 'enroute' ? 'enroute' : st === 'scene' ? 'scene' : (st === 'returning' || st === 'resting') ? 'returning' : '';
  }
  function playerColor(pid) {
    if (!app || !app.lobbyPlayers) return '#67dcff';
    var p = app.lobbyPlayers.find(function (x) { return x.id === pid; });
    return p ? p.color : '#67dcff';
  }
  function committed(inc) {
    var s = sim(); if (!s) return { police: 0, fire: 0, medical: 0, hazmat: 0, rescue: 0 };
    var out = { police: 0, fire: 0, medical: 0, hazmat: 0, rescue: 0 };
    (inc.assigned || []).forEach(function (uid) {
      var u = s.unitById[uid];
      if (!u || (u.status !== 'enroute' && u.status !== 'scene')) return;
      Object.keys(u.def.caps).forEach(function (k) { out[k] += u.def.caps[k]; });
    });
    return out;
  }
  function needChips(inc) {
    var cm = committed(inc);
    return Object.keys(inc.needs).map(function (k) {
      var cap = D.CAPS[k]; if (!cap) return '';
      var need = inc.needs[k], got = cm[k] || 0;
      var cls = got >= need ? 'ok' : got > 0 ? 'partial' : 'missing';
      return '<span class="req-chip svc-' + k + ' ' + cls + '">' + cap.icon + ' ' + got + '/' + need + '</span>';
    }).join('');
  }

  UI.init = function (appRef) {
    app = appRef;
    var ids = ['app', 'world', 'topbar', 'queue-panel', 'queue-list', 'queue-count', 'detail-panel', 'detail-title', 'detail-body',
      'bottom-bar', 'unit-strip', 'unit-summary', 'radio-log', 'coop-badge', 'mobile-dock', 'dock-calls', 'dock-ready',
      'shift-name', 'shift-clock', 'stat-funds', 'stat-money-label', 'stat-rep', 'stat-rep-bar', 'stat-calls',
      'menu', 'btn-continue', 'continue-label', 'btn-campaign', 'btn-endless', 'btn-coop', 'btn-menu-achievements', 'btn-menu-settings', 'btn-menu-help', 'btn-menu-about',
      'menu-save-info', 'menu-scene', 'summary', 'summary-grade', 'summary-kicker', 'summary-title', 'summary-sub', 'summary-stats',
      'summary-calls', 'summary-calls-count', 'summary-note', 'btn-summary-next', 'btn-summary-retry', 'btn-summary-menu',
      'shop', 'shop-funds', 'shop-shop-sub', 'shop-next-brief', 'shop-grid', 'btn-shop-next', 'btn-shop-menu',
      'lobby', 'lobby-entry', 'lobby-host-view', 'lobby-guest-view', 'lobby-code', 'guest-code', 'lobby-status', 'guest-status',
      'lobby-player-count', 'lobby-players', 'btn-create-room', 'btn-join-room', 'btn-copy-code', 'btn-lobby-start',
      'btn-lobby-leave', 'coop-difficulty', 'lobby-error', 'host-name', 'join-code', 'join-name', 'join-status',
      'modal-root', 'toast-root', 'loading', 'loading-text', 'map-tooltip', 'critical-flash', 'btn-fit', 'btn-help', 'btn-settings',
      'btn-pause', 'btn-auto-dispatch', 'btn-queue-close', 'btn-detail-close', 'queue-panel'];
    ids.forEach(function (id) {
      var node = document.getElementById(id);
      if (node) el[id] = node;
    });
    bindEvents();
    if (el['coop-difficulty']) el['coop-difficulty'].value = (app && app.coopDifficulty) || 'normal';
    var hn = localStorage.getItem('emergency112.name');
    if (hn && el['host-name']) el['host-name'].value = hn;
    if (hn && el['join-name']) el['join-name'].value = hn;
    refreshMenu();
  };

  /* ============================== 事件绑定 ============================== */
  function bindEvents() {
    var click = function (node, fn) { if (node) node.addEventListener('click', function (e) { e.preventDefault(); sfx('click'); fn(e); }); };

    click(el['btn-continue'], function () { app.startCampaign(false); });
    click(el['btn-campaign'], function () {
      if (app.campaign && !app.campaign.completed) {
        confirmBox('重新开始生涯？', '现有生涯进度（第 ' + (app.campaign.shiftIndex + 1) + ' 班、资金 ' + U.fmtMoney(app.campaign.funds) + '）会被覆盖。', '重新开始', true, function () { app.startCampaign(true); });
      } else app.startCampaign(true);
    });
    click(el['btn-endless'], function () { app.startEndless(); });
    click(el['btn-coop'], function () { app.openCoop(); });
    click(el['btn-menu-achievements'], function () { UI.openAchievements('career'); });
    click(el['btn-menu-settings'], function () { UI.openSettings('video'); });
    click(el['btn-menu-help'], function () { UI.openHelp(); });
    click(el['btn-menu-about'], function () { UI.openAbout(); });

    if (el['btn-fit']) el['btn-fit'].addEventListener('click', function () { app.fitMap(); sfx('click'); });
    if (el['btn-help']) el['btn-help'].addEventListener('click', function () { UI.openHelp(); sfx('click'); });
    if (el['btn-settings']) el['btn-settings'].addEventListener('click', function () { UI.openSettings('video'); sfx('click'); });
    if (el['btn-pause']) el['btn-pause'].addEventListener('click', function () { UI.openPause(); });
    U.$$('#topbar [data-speed]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var v = parseInt(btn.getAttribute('data-speed'), 10);
        if (v === 0) app.setPaused(!app.paused);
        else { app.setPaused(false); app.setSpeed(v); }
        sfx('click');
      });
    });
    if (el['btn-auto-dispatch']) el['btn-auto-dispatch'].addEventListener('click', function () {
      var s = sim();
      if (!s) return;
      var id = app.selectedIncident;
      if (!id) {
        var list = s.activeIncidents ? s.activeIncidents() : [];
        if (list.length) id = list[0].id;
      }
      if (!id) return;
      var res = app.autoDispatch(id);
      if (res && !res.ok) toast(res.reason || '没有可派遣的单位', 'warn');
      else { toast('已派遣增援', 'good'); sfx('dispatch'); }
    });
    if (el['queue-list']) el['queue-list'].addEventListener('click', function (e) {
      var card = e.target.closest('[data-incident]');
      if (!card) return;
      app.selectIncident(card.getAttribute('data-incident'));
      sfx('click');
      if (U.isMobileLayout()) openSheet('detail');
    });
    if (el['detail-body']) el['detail-body'].addEventListener('click', function (e) {
      var t = e.target.closest('[data-act]');
      if (!t) return;
      handleAction(t.getAttribute('data-act'), t);
    });
    if (el['unit-strip']) el['unit-strip'].addEventListener('click', function (e) {
      var chip = e.target.closest('[data-unit]');
      if (!chip) return;
      var uid = chip.getAttribute('data-unit');
      var s = sim();
      var u = s && s.unitById[uid];
      if (app.selectedIncident && u && u.status === 'idle') {
        var res = app.dispatch([uid], app.selectedIncident);
        if (res && !res.ok) toast(res.reason, 'warn'); else sfx('dispatch');
      } else {
        app.selectUnit(uid);
        if (U.isMobileLayout()) openSheet('detail');
      }
      sfx('click');
    });
    if (el['btn-queue-close']) el['btn-queue-close'].addEventListener('click', function () { closeSheets(); });
    if (el['btn-detail-close']) el['btn-detail-close'].addEventListener('click', function () { closeSheets(); });
    if (el['mobile-dock']) el['mobile-dock'].addEventListener('click', function (e) {
      var btn = e.target.closest('[data-dock]');
      if (!btn) return;
      var k = btn.getAttribute('data-dock');
      if (k === 'queue') openSheet('queue');
      else if (k === 'units') { app.clearSelection(); openSheet('detail'); }
      else openSheet('detail');
      sfx('click');
    });

    // 设置 / 帮助 / 确认框：统一事件委托
    if (el['modal-root']) {
      el['modal-root'].addEventListener('click', onModalClick);
      el['modal-root'].addEventListener('input', onModalInput);
      el['modal-root'].addEventListener('change', onModalChange);
    }
    // 结算
    click(el['btn-summary-next'], function () { app.afterSummary('next'); });
    click(el['btn-summary-retry'], function () { app.afterSummary('retry'); });
    click(el['btn-summary-menu'], function () { app.afterSummary('menu'); });
    // 补给站
    if (el['shop-grid']) el['shop-grid'].addEventListener('click', function (e) {
      var b = e.target.closest('[data-buy]');
      if (!b) return;
      var res = app.buyUpgrade(b.getAttribute('data-buy'));
      if (res && res.ok) { toast('已采购：' + res.name, 'good'); sfx('upgrade'); renderShop(); }
      else if (res) toast(res.reason || '无法采购', 'warn');
    });
    click(el['btn-shop-next'], function () { app.beginNextShift(); });
    click(el['btn-shop-menu'], function () { app.saveAndMenu(); });
    // 联机
    click(el['btn-create-room'], function () {
      var name = (el['host-name'] && el['host-name'].value || '').trim() || '指挥官';
      localStorage.setItem('emergency112.name', name);
      app.createRoom(name);
    });
    click(el['btn-join-room'], function () { doJoin(); });
    click(el['btn-copy-code'], function () {
      var code = (app.lobbyState && app.lobbyState.code) || '';
      copyText(code);
    });
    click(el['btn-lobby-start'], function () { app.startCoop(); });
    click(el['btn-lobby-leave'], function () {
      if (app.lobbyState && app.lobbyState.role) app.leaveLobby();
      else app.backToMenuFromLobby();
    });
    if (el['coop-difficulty']) el['coop-difficulty'].addEventListener('change', function () {
      app.coopDifficulty = el['coop-difficulty'].value;
      if (app.lobbyState && app.lobbyState.role === 'host') app.setCoopDifficulty(el['coop-difficulty'].value);
    });
    if (el['join-code']) {
      el['join-code'].addEventListener('input', function () {
        var v = el['join-code'].value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
        el['join-code'].value = v;
      });
      el['join-code'].addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(); });
    }
    if (el['join-name']) el['join-name'].addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(); });
    if (el['host-name']) el['host-name'].addEventListener('keydown', function (e) { if (e.key === 'Enter') el['btn-create-room'].click(); });
    // 防止输入框里按空格触发游戏快捷键
    ['host-name', 'join-name', 'join-code'].forEach(function (id) {
      var n = el[id]; if (!n) return;
      n.addEventListener('keydown', function (e) { e.stopPropagation(); });
    });
  }

  function doJoin() {
    var code = (el['join-code'] && el['join-code'].value || '').toUpperCase().trim();
    var name = (el['join-name'] && el['join-name'].value || '').trim() || '调度员';
    if (!/^[A-Z0-9]{6}$/.test(code)) { setLobbyError('请输入 6 位房间编号。'); return; }
    localStorage.setItem('emergency112.name', name);
    app.joinRoom(code, name);
  }

  function handleAction(act, node) {
    var s = sim();
    if (act === 'select-unit') { app.selectUnit(node.getAttribute('data-id')); sfx('click'); return; }
    if (act === 'select-incident') { app.selectIncident(node.getAttribute('data-incident')); sfx('click'); return; }
    if (act === 'dispatch') {
      var uid = node.getAttribute('data-unit');
      var iid = node.getAttribute('data-incident');
      if (!uid || !iid) return;
      var res = app.dispatch([uid], iid);
      if (res && !res.ok) toast(res.reason, 'warn'); else { sfx('dispatch'); toast('已下达派遣指令', 'good'); }
      return;
    }
    if (act === 'auto' && s) {
      var id = node.getAttribute('data-incident') || app.selectedIncident;
      var r = app.autoDispatch(id);
      if (r && !r.ok) toast(r.reason, 'warn');
      else { sfx('dispatch'); toast(r && r.missing ? '已派出可用单位，力量仍不足' : '一键派遣完成', r && r.missing ? 'warn' : 'good'); }
      return;
    }
    if (act === 'recall') {
      var rr = app.recall(node.getAttribute('data-unit'));
      if (rr && !rr.ok) toast(rr.reason, 'warn'); else toast('单位正在返回基地', 'good');
      return;
    }
    if (act === 'recall-all') {
      var inc = app.selectedIncident;
      if (inc && s) {
        var list = (s.findIncident(inc) || {}).assigned || [];
        list.slice().forEach(function (u) { app.recall(u); });
      }
      return;
    }
    if (act === 'focus-unit') {
      var u = s && s.unitById[node.getAttribute('data-unit')];
      if (u) app.focusWorld(u.x, u.y);
      return;
    }
    if (act === 'focus-incident') {
      var ii = s && s.incidentById[node.getAttribute('data-incident')];
      if (ii) app.focusWorld(ii.x, ii.y);
      return;
    }
  }

  /* ============================== 屏幕 / 主菜单 ============================== */
  UI.showScreen = function (name) {
    ['menu', 'summary', 'shop', 'lobby'].forEach(function (id) {
      if (el[id]) el[id].classList.toggle('hidden', id !== name && !(id === 'menu' && name === 'menu'));
    });
    var game = name === 'game';
    var menu = name === 'menu';
    if (el['menu']) el['menu'].classList.toggle('hidden', !menu);
    ['summary', 'shop', 'lobby'].forEach(function (id) {
      if (el[id]) el[id].classList.toggle('hidden', id !== name);
    });
    if (el.app) {
      el.app.classList.toggle('mode-menu', menu);
      el.app.classList.toggle('in-game', game);
    }
    [el['topbar'], el['queue-panel'], el['detail-panel'], el['bottom-bar'], el['mobile-dock']].forEach(function (n) {
      if (!n) return;
      n.classList.toggle('hidden', !game);
    });
    if (!game) closeSheets();
    if (menu) refreshMenu();
    if (el['modal-root'] && !game && name !== 'summary' && name !== 'shop' && name !== 'lobby') closeModal();
  };

  UI.refreshMenu = refreshMenu;
  function refreshMenu() {
    if (!el['menu-save-info']) return;
    var camp = app && app.campaign;
    var has = camp && !camp.completed && camp.shiftIndex < D.SHIFTS.length;
    if (has) {
      el['btn-continue'].classList.remove('hidden');
      el['continue-label'].textContent = '继续生涯 · 第 ' + (camp.shiftIndex + 1) + ' 班';
      el['btn-campaign'].querySelector('.mb-text b').textContent = '新的生涯';
      el['btn-campaign'].querySelector('.mb-text small').textContent = '覆盖现有进度，从第一班重新开始';
      el['menu-save-info'].textContent = '本地存档：第 ' + (camp.shiftIndex + 1) + ' 班 · ' + U.fmtMoney(camp.funds);
    } else if (camp && camp.completed) {
      el['btn-continue'].classList.add('hidden');
      el['btn-campaign'].querySelector('.mb-text b').textContent = '生涯模式';
      el['btn-campaign'].querySelector('.mb-text small').textContent = '已完成全部班次，可重新开始';
      el['menu-save-info'].textContent = '生涯已通关 · 总分 ' + (camp.totals && camp.totals.score || 0);
    } else {
      el['btn-continue'].classList.add('hidden');
      el['btn-campaign'].querySelector('.mb-text b').textContent = '生涯模式';
      el['btn-campaign'].querySelector('.mb-text small').textContent = '五个班次 · 从暴雨夜到临界时刻';
      el['menu-save-info'].textContent = '本地存档：无';
    }
    var stats = U.store.get(D.STATS_KEY, {});
    if (el['menu-scene']) {
      var w = has ? D.SHIFTS[camp.shiftIndex] : D.SHIFTS[0];
      el['menu-scene'].textContent = (D.WEATHERS[w.weather] ? D.WEATHERS[w.weather].name : '暴雨') + ' · ' + U.clockFromMinutes(w.startMinutes, 0);
    }
    if (stats.bestEndless) {
      var foot = el['menu-save-info'].parentElement;
      if (foot && !foot.querySelector('.best-endless')) {
        var sp = document.createElement('span');
        sp.className = 'best-endless';
        sp.textContent = '无尽最佳：' + stats.bestEndless;
        foot.appendChild(sp);
      }
    }
  }

  UI.updateMenuInfo = refreshMenu;

  /* ============================== HUD 更新 ============================== */
  UI.update = function (dt) {
    if (!app) return;
    acc += dt; listAcc += dt;
    var screen = app.screen;
    if (screen !== 'game') return;
    var s = sim();
    if (!s) return;
    if (acc >= 0.12) { acc = 0; updateTopbar(s); }
    if (listAcc >= 0.28) { listAcc = 0; updateLists(s); }
  };

  function updateTopbar(s) {
    var c = cfg() || {};
    if (el['shift-name']) el['shift-name'].textContent = c.name || '行动中';
    if (el['shift-clock']) el['shift-clock'].textContent = U.clockFromMinutes(c.startMinutes || 0, s.clock);
    var money = app.mode === 'campaign';
    if (el['stat-money-label']) el['stat-money-label'].textContent = money ? '资金' : '积分';
    if (el['stat-funds']) el['stat-funds'].textContent = money ? U.fmtMoney(s.funds) : U.fmtShort(s.score);
    if (el['stat-rep']) el['stat-rep'].textContent = Math.round(s.reputation);
    if (el['stat-rep-bar']) {
      el['stat-rep-bar'].style.width = U.clamp(s.reputation, 0, 100) + '%';
      el['stat-rep-bar'].classList.toggle('low', s.reputation <= 35);
    }
    if (el['stat-calls']) el['stat-calls'].textContent = s.phase === 'active' ? s.activeIncidents().length : 0;
    U.$$('#topbar [data-speed]').forEach(function (b) {
      var v = parseInt(b.getAttribute('data-speed'), 10);
      b.classList.toggle('active', v === 0 ? app.paused : (!app.paused && v === app.speed));
    });
    if (el['coop-badge']) {
      if (isCoop()) {
        el['coop-badge'].classList.remove('hidden');
        var code = (app.lobbyState && app.lobbyState.code) || app.roomCode || '----';
        var ping = app.netPing || 0;
        el['coop-badge'].textContent = code + ' · ' + (ping ? ping + 'ms' : 'P2P');
      } else el['coop-badge'].classList.add('hidden');
    }
    if (el['dock-calls']) el['dock-calls'].textContent = s.activeIncidents().length;
    if (el['dock-ready']) el['dock-ready'].textContent = s.readyCount();
  }

  function updateLists(s) {
    var incs = s.activeIncidents();
    var qsig = incs.map(function (i) { return i.id + ':' + i.priority + ':' + i.assigned.length + ':' + Math.round(i.coverage * 8) + ':' + i.status; }).join('|') + '#' + (app.selectedIncident || '');
    if (qsig !== lastSigs.queue) { lastSigs.queue = qsig; renderQueue(s, incs); }
    else updateQueueLive(s, incs);
    var dsig = detailSignature(s);
    if (dsig !== lastSigs.detail) { lastSigs.detail = dsig; renderDetail(s); }
    else updateDetailLive(s);
    var usig = s.units.map(function (u) { return u.id + ':' + u.status + ':' + Math.ceil(u.cooldown); }).join('|') + '#' + (app.selectedUnit || '');
    if (usig !== lastSigs.units) { lastSigs.units = usig; renderUnits(s); }
    if (el['queue-count']) el['queue-count'].textContent = incs.length;
    if (el['unit-summary']) {
      var ready = 0, busy = 0;
      s.units.forEach(function (u) { if (u.status === 'idle') ready++; else busy++; });
      el['unit-summary'].textContent = '待命 ' + ready + ' / ' + s.units.length + ' · 在场 ' + busy;
    }
    if (el['btn-auto-dispatch']) el['btn-auto-dispatch'].disabled = incs.length === 0;
    var radioSig = s.radio.slice(-5).map(function (r) { return r.t + r.text; }).join('|');
    if (radioSig !== lastSigs.radio) { lastSigs.radio = radioSig; renderRadio(s); }
  }

  function renderQueue(s, incs) {
    if (!el['queue-list']) return;
    var scroll = el['queue-list'].scrollTop;
    if (!incs.length) {
      el['queue-list'].innerHTML = '<div class="queue-empty"><b>频道安静。</b><br>' + D.TEXT.noCallsSub + '<br>保持监听，别让下一通电话等太久。</div>';
    } else {
      el['queue-list'].innerHTML = incs.map(function (inc) {
        var p = prio(inc);
        var selected = app.selectedIncident === inc.id;
        var timer = Math.max(0, inc.timeLeft);
        return '<div class="queue-card p' + inc.priority + (selected ? ' selected' : '') + (inc.priority === 1 ? ' critical' : '') + '" data-incident="' + inc.id + '">' +
          '<div class="qc-top">' +
          '<span class="qc-ico">' + inc.icon + '</span>' +
          '<div class="qc-main"><div class="qc-title">' + esc(inc.name) + ' <span style="opacity:.42;font-weight:400">' + esc(inc.code) + '</span></div>' +
          '<div class="qc-loc">' + esc(inc.label) + '</div></div>' +
          '<div class="qc-time' + (timer < 30 ? ' overdue' : '') + '" data-timer="' + inc.id + '">' + U.fmtTimer(timer) + '</div>' +
          '</div>' +
          '<div class="qc-needs">' + needChips(inc) + '</div>' +
          '<div class="qc-bottom">' +
          '<div class="qc-progress"><i data-prog="' + inc.id + '" style="width:' + U.clamp(inc.progress, 0, 100) + '%"></i></div>' +
          '<span class="qc-meta">' + (inc.assigned.length ? '已派 ' + inc.assigned.length : '未派遣') + '</span>' +
          '</div></div>';
      }).join('');
    }
    el['queue-list'].scrollTop = scroll;
    if (el['btn-auto-dispatch']) {
      el['btn-auto-dispatch'].disabled = incs.length === 0;
      el['btn-auto-dispatch'].textContent = app.selectedIncident ? '一键派遣 · 已选警情' : '一键派遣 · 最高优先';
    }
  }

  function updateQueueLive(s, incs) {
    incs.forEach(function (inc) {
      var t = el['queue-list'] && el['queue-list'].querySelector('[data-timer="' + inc.id + '"]');
      if (t) { t.textContent = U.fmtTimer(inc.timeLeft); t.classList.toggle('overdue', inc.timeLeft < 30); }
      var p = el['queue-list'] && el['queue-list'].querySelector('[data-prog="' + inc.id + '"]');
      if (p) p.style.width = U.clamp(inc.progress, 0, 100) + '%';
    });
    U.$$('#queue-list .queue-card').forEach(function (card) {
      card.classList.toggle('selected', card.getAttribute('data-incident') === app.selectedIncident);
    });
  }

  function detailSignature(s) {
    var inc = app.selectedIncident ? s.findIncident(app.selectedIncident) : null;
    var u = app.selectedUnit ? s.unitById[app.selectedUnit] : null;
    var a = inc ? (inc.id + ':' + inc.assigned.join(',') + ':' + Math.round(inc.coverage * 10) + ':' + Math.ceil(inc.timeLeft / 4) + ':' + Math.round(inc.progress / 3) + ':' + inc.status) : '';
    var b = u ? (u.id + ':' + u.status + ':' + Math.ceil(u.cooldown)) : '';
    var avail = inc ? s.units.filter(function (x) { return x.status === 'idle'; }).map(function (x) { return x.id; }).join(',') : '';
    // 未选中警情/单位时，总览也会随单位到来/返航而变化，必须纳入签名
    var overview = s.units.map(function (x) { return x.id + '.' + x.status; }).join(',');
    return a + '#' + b + '#' + avail + '#' + overview + '#' + (app.selectedIncident || '') + '#' + (app.selectedUnit || '');
  }

  function renderDetail(s) {
    if (!el['detail-body']) return;
    var scroll = el['detail-body'].scrollTop;
    var inc = app.selectedIncident ? s.findIncident(app.selectedIncident) : null;
    if (inc && inc.status !== 'active') { app.selectedIncident = null; inc = null; }
    var unit = app.selectedUnit ? s.unitById[app.selectedUnit] : null;
    if (app.selectedIncident && inc) {
      el['detail-title'].textContent = '现场调度';
      el['detail-body'].innerHTML = incidentDetailHtml(s, inc);
    } else if (unit) {
      el['detail-title'].textContent = '单位详情';
      el['detail-body'].innerHTML = unitDetailHtml(s, unit);
    } else {
      el['detail-title'].textContent = '调度台';
      el['detail-body'].innerHTML = overviewHtml(s);
    }
    el['detail-body'].scrollTop = scroll;
  }

  function updateDetailLive(s) {
    var inc = app.selectedIncident ? s.findIncident(app.selectedIncident) : null;
    if (!inc) return;
    var t = el['detail-body'] && el['detail-body'].querySelector('[data-inc-timer]');
    if (t) {
      t.textContent = U.fmtTimer(inc.timeLeft);
      t.classList.toggle('urgent', inc.timeLeft < 30);
    }
    var list = el['detail-body'] && el['detail-body'].querySelector('#detail-needbars');
    if (list) {
      Object.keys(inc.needs).forEach(function (k) {
        var need = inc.needs[k], got = (inc.provided && inc.provided[k]) || 0;
        var bar = list.querySelector('[data-need-bar="' + k + '"]');
        if (bar) bar.style.width = U.clamp(got / need, 0, 1) * 100 + '%';
        var n = list.querySelector('[data-need-n="' + k + '"]');
        if (n) n.textContent = got + '/' + need;
      });
    }
  }

  function incidentDetailHtml(s, inc) {
    var p = prio(inc);
    var needs = Object.keys(inc.needs).map(function (k) {
      var cap = D.CAPS[k]; if (!cap) return '';
      var need = inc.needs[k], got = (inc.provided && inc.provided[k]) || 0;
      var ratio = U.clamp(got / need, 0, 1);
      return '<div class="need-row' + (ratio >= 1 ? ' complete' : '') + '">' +
        '<span class="svc-pill svc-' + k + '">' + cap.icon + ' ' + cap.name + '</span>' +
        '<div class="need-bar"><i data-need-bar="' + k + '" style="width:' + ratio * 100 + '%;background:' + cap.color + '"></i></div>' +
        '<span class="need-n" data-need-n="' + k + '">' + got + '/' + need + '</span></div>';
    }).join('');
    var assigned = (inc.assigned || []).map(function (uid) {
      var u = s.unitById[uid]; if (!u) return '';
      return '<div class="unit-row"><span class="ur-ico">' + u.def.icon + '</span>' +
        '<div class="ur-main"><div class="ur-name">' + esc(u.def.name) + ' <span style="color:' + playerColor(u.ownerId) + '">●</span></div>' +
        '<div class="ur-meta">' + statusText(u.status) + ' · ' + esc(u.homeStationName || '') + '</div></div>' +
        '<button class="btn ghost small" data-act="recall" data-unit="' + u.id + '">撤离</button></div>';
    }).join('');
    var ready = s.units.filter(function (u) { return u.status === 'idle'; });
    ready.sort(function (a, b) { return s.etaApprox(a, inc) - s.etaApprox(b, inc); });
    var dispatchRows = ready.slice(0, 12).map(function (u) {
      var eta = Math.max(1, Math.round(s.etaApprox(u, inc)));
      var caps = Object.keys(u.def.caps).map(function (k) { return D.CAPS[k].icon + u.def.caps[k]; }).join(' ');
      return '<div class="unit-row"><span class="ur-ico">' + u.def.icon + '</span>' +
        '<div class="ur-main"><div class="ur-name">' + esc(u.def.name) + '</div><div class="ur-meta">' + caps + ' · ' + esc(u.homeStationName) + '</div></div>' +
        '<span class="ur-eta ready">' + eta + 's</span>' +
        '<button class="btn primary small" data-act="dispatch" data-unit="' + u.id + '" data-incident="' + inc.id + '">派遣</button></div>';
    }).join('');
    var coverTxt = inc.coverage >= 0.999 ? '<span style="color:var(--green)">已覆盖，正在处置</span>' :
      inc.coverage > 0 ? '<span style="color:var(--amber)">部分覆盖，倒计时减速</span>' : '<span style="color:var(--red)">力量不足，倒计时继续</span>';
    return '<div class="incident-hero p' + inc.priority + '">' +
      '<div class="ih-top"><span class="ih-ico">' + inc.icon + '</span>' +
      '<div class="ih-title"><b>' + esc(inc.name) + (inc.finale ? ' · 大事件' : '') + '</b><small>' + esc(inc.label) + ' · ' + p.label + ' ' + p.name + '</small></div>' +
      '<span class="ih-timer' + (inc.timeLeft < 30 ? ' urgent' : '') + '" data-inc-timer>' + U.fmtTimer(inc.timeLeft) + '</span></div>' +
      '<div class="ih-desc">' + esc(inc.desc) + '</div>' +
      '<div class="ih-needs" id="detail-needbars">' + needs + '</div>' +
      '<div class="qc-progress" style="margin-top:10px"><i style="width:' + U.clamp(inc.progress, 0, 100) + '%;background:linear-gradient(90deg,var(--cyan-2),var(--cyan))"></i></div>' +
      '<div class="dispatch-note">' + coverTxt + ' · 处置进度 ' + Math.round(inc.progress) + '%</div>' +
      '</div>' +
      '<div class="detail-sec"><div class="detail-sec-head"><h3>已在现场 / 途中</h3><span>' + inc.assigned.length + '</span></div>' +
      (assigned || '<div class="detail-empty">还没有派出单位。时间不等人。</div>') +
      (inc.assigned.length ? '<div class="detail-actions"><button class="btn ghost small" data-act="recall-all">全部撤离</button><button class="btn ghost small" data-act="focus-incident" data-incident="' + inc.id + '">定位现场</button></div>' : '') +
      '</div>' +
      '<div class="detail-sec"><div class="detail-sec-head"><h3>可派遣单位</h3><span>' + ready.length + ' 待命</span></div>' +
      (dispatchRows || '<div class="detail-empty">所有单位都在任务或整备中。留意整备倒计时。</div>') +
      '</div>' +
      '<button class="btn primary wide" data-act="auto" data-incident="' + inc.id + '">一键派遣 · 自动补齐</button>' +
      '<p class="dispatch-note">' + esc(inc.tip) + '</p>';
  }

  function unitDetailHtml(s, u) {
    var caps = Object.keys(u.def.caps).map(function (k) {
      return '<span class="svc-pill svc-' + k + '">' + D.CAPS[k].icon + ' ' + D.CAPS[k].name + ' +' + u.def.caps[k] + '</span>';
    }).join(' ');
    var inc = u.incidentId ? s.findIncident(u.incidentId) : null;
    var html = '<div class="incident-hero">' +
      '<div class="ih-top"><span class="ih-ico">' + u.def.icon + '</span><div class="ih-title"><b>' + esc(u.def.name) + ' · ' + u.id.slice(1) + '</b>' +
      '<small>' + statusText(u.status) + ' · ' + esc(u.homeStationName || '') + '</small></div></div>' +
      '<div class="ih-desc">' + esc(u.def.desc) + '</div>' +
      '<div style="margin-top:9px;display:flex;gap:5px;flex-wrap:wrap">' + caps + '</div>' +
      (u.status === 'resting' ? '<div class="dispatch-note">整备剩余 ' + Math.ceil(u.cooldown) + ' 秒。</div>' : '') +
      '</div>';
    if (inc) {
      html += '<div class="detail-sec"><div class="detail-sec-head"><h3>当前任务</h3></div>' +
        '<div class="unit-row"><span class="ur-ico">' + inc.icon + '</span><div class="ur-main"><div class="ur-name">' + esc(inc.name) + '</div><div class="ur-meta">' + esc(inc.label) + '</div></div>' +
        '<button class="btn ghost small" data-act="select-incident" data-incident="' + inc.id + '">查看</button></div>' +
        '<div class="detail-actions"><button class="btn ghost small" data-act="recall" data-unit="' + u.id + '">撤离返回</button>' +
        '<button class="btn ghost small" data-act="focus-unit" data-unit="' + u.id + '">定位单位</button></div></div>';
      if (u.status === 'scene' && inc.status === 'active') {
        var lacking = Object.keys(inc.needs).filter(function (k) { return ((inc.provided && inc.provided[k]) || 0) < inc.needs[k]; });
        if (lacking.length) html += '<div class="summary-note">现场仍缺少：' + lacking.map(function (k) { return D.CAPS[k].name; }).join('、') + '。只靠这辆车无法开始推进。</div>';
      }
    } else if (u.status === 'idle') {
      var list = s.activeIncidents().slice(0, 6);
      html += '<div class="detail-sec"><div class="detail-sec-head"><h3>派遣到警情</h3><span>' + list.length + '</span></div>' +
        (list.length ? list.map(function (i) {
          return '<div class="unit-row"><span class="ur-ico">' + i.icon + '</span><div class="ur-main"><div class="ur-name">' + esc(i.name) + '</div><div class="ur-meta">' + esc(i.label) + ' · ' + U.fmtTimer(i.timeLeft) + '</div></div>' +
            '<button class="btn primary small" data-act="dispatch" data-unit="' + u.id + '" data-incident="' + i.id + '">派往</button></div>';
        }).join('') : '<div class="detail-empty">当前没有进行中的警情。</div>') + '</div>';
      html += '<p class="dispatch-note">也可以先在左侧选警情，再点单位。' + D.TEXT.unitHint + '</p>';
    } else {
      html += '<p class="dispatch-note">单位正在执行任务，抵达现场后会自动开始处置。若警情已结束，它会自动返回基地。</p>';
    }
    html += '<div class="detail-actions"><button class="btn ghost small" data-act="focus-unit" data-unit="' + u.id + '">定位单位</button><button class="btn ghost small" data-act="select-unit" data-id="">返回单位总览</button></div>';
    return html;
  }

  function overviewHtml(s) {
    var groups = { police: [], fire: [], medical: [] };
    s.units.forEach(function (u) { (groups[u.def.service] || groups.fire).push(u); });
    var total = s.units.length, ready = s.units.filter(function (u) { return u.status === 'idle'; }).length;
    var html = '<div class="dispatch-note" style="margin-top:0">本单位 ' + ready + ' / ' + total + ' 处于待命。' + D.TEXT.selectHint + '</div>';
    Object.keys(groups).forEach(function (svc) {
      var sv = D.SERVICES[svc];
      html += '<div class="detail-sec"><div class="detail-sec-head"><h3>' + sv.icon + ' ' + sv.name + '</h3><span>' + groups[svc].filter(function (u) { return u.status === 'idle'; }).length + '/' + groups[svc].length + '</span></div>' +
        groups[svc].map(function (u) {
          return '<div class="unit-row" data-act="select-unit" data-id="' + u.id + '" style="cursor:pointer">' +
            '<span class="ur-ico">' + u.def.icon + '</span><div class="ur-main"><div class="ur-name">' + esc(u.def.name) + ' <span class="u-state ' + statusClass(u.status) + '" style="display:inline-block;vertical-align:middle"></span></div>' +
            '<div class="ur-meta">' + statusText(u.status) + (u.cooldown > 0 ? ' ' + Math.ceil(u.cooldown) + 's' : '') + ' · ' + esc(u.homeStationName) + (u.ownerId ? ' · <span style="color:' + playerColor(u.ownerId) + '">●</span>' : '') + '</div></div>' +
            '<span class="ur-eta ' + (u.status === 'idle' ? 'ready' : 'busy') + '">' + statusText(u.status) + '</span></div>';
        }).join('') + '</div>';
    });
    html += '<p class="dispatch-note">点击单位可以查看详情；先选警情再点待命单位，或使用“一键派遣”。</p>';
    return html;
  }

  function renderUnits(s) {
    if (!el['unit-strip']) return;
    var html = s.units.map(function (u) {
      var selected = app.selectedUnit === u.id;
      return '<div class="unit-chip' + (selected ? ' selected' : '') + (u.status !== 'idle' ? ' busy' : '') + '" data-unit="' + u.id + '" title="' + esc(u.def.name + ' · ' + statusText(u.status)) + '">' +
        '<span class="u-ico">' + u.def.icon + '</span><span>' + esc(u.def.short) + '</span>' +
        '<span class="u-state ' + statusClass(u.status) + '"></span>' +
        (u.cooldown > 0 ? '<span style="font-family:var(--mono);font-size:9px;color:var(--muted)">' + Math.ceil(u.cooldown) + '</span>' : '') +
        '</div>';
    }).join('');
    el['unit-strip'].innerHTML = html;
  }

  function renderRadio(s) {
    if (!el['radio-log']) return;
    var lines = s.radio.slice(-5);
    el['radio-log'].innerHTML = lines.map(function (r) {
      var t = U.clockFromMinutes((cfg() && cfg().startMinutes) || 0, r.t);
      var cls = r.kind === 'alert' ? 'alert' : r.kind === 'warn' ? 'warn' : r.kind === 'ok' ? 'ok' : '';
      return '<div class="radio-line ' + cls + '"><span class="rt">' + t + '</span>' + esc(r.text) + '</div>';
    }).join('');
  }

  /* ============================== 状态提示 ============================== */
  UI.toast = function (text, kind) {
    if (!el['toast-root']) return;
    var t = U.make('div', 'toast ' + (kind || ''), esc(text));
    el['toast-root'].appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2800);
    while (el['toast-root'].children.length > 4) el['toast-root'].removeChild(el['toast-root'].firstChild);
  };
  function toast(text, kind) { UI.toast(text, kind); }

  UI.flashCritical = function () {
    if (!el['critical-flash']) return;
    el['critical-flash'].classList.remove('on');
    void el['critical-flash'].offsetWidth;
    el['critical-flash'].classList.add('on');
  };

  UI.setTooltip = function (html, x, y) {
    if (!el['map-tooltip']) return;
    el['map-tooltip'].innerHTML = html;
    el['map-tooltip'].classList.remove('hidden');
    var w = el['map-tooltip'].offsetWidth || 200;
    var left = Math.min(window.innerWidth - w - 12, Math.max(8, x + 14));
    var top = Math.min(window.innerHeight - 60, Math.max(8, y + 12));
    el['map-tooltip'].style.left = left + 'px';
    el['map-tooltip'].style.top = top + 'px';
  };
  UI.hideTooltip = function () { if (el['map-tooltip']) el['map-tooltip'].classList.add('hidden'); };

  UI.loading = function (on, text) {
    if (!el['loading']) return;
    el['loading'].classList.toggle('hidden', !on);
    if (text && el['loading-text']) el['loading-text'].textContent = text;
  };

  /* ============================== 设置 ============================== */
  UI.openSettings = function (tab) {
    var wasPaused = app.screen === 'game' && app.paused;
    if (!wasPaused && app.screen === 'game' && !(app.mode === 'coop' && app.netRole === 'guest')) {
      app.setPaused(true);
      modalPausedGame = true;
    }
    modalReturn = wasPaused ? 'pause' : null;
    closeSheets();
    var st = app.settings;
    var panes = {
      video: '<div class="set-group"><h3>画面</h3>' +
        seg('quality', '画质预设', [['low', '低'], ['medium', '中'], ['high', '高'], ['ultra', '极高']], st.quality) +
        selectRow('renderScale', '渲染缩放', [['auto', '自动'], ['0.75', '75%'], ['1', '100%'], ['1.25', '125%']], st.renderScale) +
        seg('particles', '粒子效果', [['low', '低'], ['medium', '中'], ['high', '高']], st.particles) +
        selectRow('fpsCap', '帧率上限', [['30', '30 FPS'], ['60', '60 FPS'], ['120', '120 FPS'], ['0', '不限制']], String(st.fpsCap)) +
        switchRow('weatherFx', '天气效果', '雨、雾、闪电等动态天气', st.weatherFx) +
        switchRow('screenShake', '画面震动', '爆炸和巨响时震动镜头', st.screenShake) +
        switchRow('scanlines', '终端扫描线', '轻微 CRT 质感', st.scanlines) +
        switchRow('minimap', '显示小地图', '右下角态势图，M 键切换', st.minimap) +
        switchRow('showLabels', '显示地名标签', '地标建筑名称', st.showLabels) +
        switchRow('reducedMotion', '减少动态效果', '降低闪烁与动画', st.reducedMotion) +
        switchRow('colorblind', '色弱辅助', '警情优先级改用蓝/橙/黄', st.colorblind) +
        '</div>',
      audio: '<div class="set-group"><h3>音量</h3>' +
        rangeRow('volumeMaster', '主音量', st.volumeMaster) +
        rangeRow('volumeMusic', '音乐', st.volumeMusic) +
        rangeRow('volumeSfx', '音效', st.volumeSfx) +
        rangeRow('volumeAmbience', '环境 / 雨声', st.volumeAmbience) +
        switchRow('muted', '全部静音', '关闭所有声音', st.muted) +
        '</div><p class="dispatch-note">声音在第一次点击/触摸后才会启动；切到后台会自动压低。</p>',
      game: '<div class="set-group"><h3>玩法</h3>' +
        seg('difficulty', '默认难度', [['easy', '轻松'], ['normal', '标准'], ['hard', '硬核']], st.difficulty) +
        seg('speedDefault', '开局速度', [['1', '1×'], ['2', '2×'], ['4', '4×']], String(st.speedDefault)) +
        switchRow('edgePan', '鼠标边缘拖屏', '把鼠标移到屏幕边缘平移视角', st.edgePan) +
        switchRow('autoPauseOnCritical', '大事件自动暂停', '接到 P1 / 大事件时暂停，给你时间判断', st.autoPauseOnCritical) +
        '</div><p class="dispatch-note">难度在下一局/新生涯生效；生涯中途不会改变已保存的难度。</p>',
      help: '<div class="set-group"><h3>操作与帮助</h3>' +
        '<div class="help-block">' + keyTable() + '</div>' +
        '<div class="set-row"><div class="set-label"><b>玩法说明</b><small>目标、机制与联机说明</small></div><button class="btn ghost small" data-open-help>打开</button></div>' +
        '<div class="set-row"><div class="set-label"><b>恢复默认设置</b><small>不会清除生涯存档</small></div><button class="btn ghost small" data-reset-settings>恢复</button></div>' +
        '<div class="set-row"><div class="set-label"><b>清除所有存档</b><small>生涯进度、战绩、设置全部重置</small></div><button class="btn danger small" data-reset-save>清除</button></div>' +
        '</div><p class="dispatch-note">本地存档只在这台设备的浏览器里，换设备不会同步。</p>'
    };
    var active = tab || 'video';
    var tabs = [['video', '画面'], ['audio', '音频'], ['game', '玩法'], ['help', '操作/其他']];
    var html = '<div class="modal-card wide" data-modal="settings">' +
      '<div class="modal-head"><div><h2>设置</h2><span class="sub">修改立即生效并保存到本机</span></div><button class="modal-close" data-close="1">×</button></div>' +
      '<div class="modal-body">' +
      '<div class="tabs">' + tabs.map(function (t) { return '<button class="' + (t[0] === active ? 'active' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>' +
      Object.keys(panes).map(function (k) { return '<div class="set-pane" data-pane="' + k + '"' + (k === active ? '' : ' style="display:none"') + '>' + panes[k] + '</div>'; }).join('') +
      '</div>' +
      '<div class="modal-foot"><span class="set-reset" data-close="1" style="margin-right:auto;cursor:pointer">关闭</span><button class="btn primary" data-close="1">完成</button></div>' +
      '</div>';
    showModal(html);
  };

  UI.openHelp = function () {
    var wasPaused = app.screen === 'game' && app.paused;
    if (!wasPaused && app.screen === 'game' && !(app.mode === 'coop' && app.netRole === 'guest')) {
      app.setPaused(true);
      modalPausedGame = true;
    }
    modalReturn = wasPaused ? 'pause' : null;
    showModal('<div class="modal-card wide" data-modal="help">' +
      '<div class="modal-head"><div><h2>玩法说明</h2><span class="sub">临界 · 紧急调度</span></div><button class="modal-close" data-close="1">×</button></div>' +
      '<div class="modal-body"><div class="help-grid">' +
      '<div class="help-block"><h3>你在做什么</h3><p>你是临江市 112 指挥中心的值班长。接警、判断、派车、盯住倒计时。单位到达现场且能力覆盖需求后，处置进度才会推进；凑不齐能力，倒计时不会停。</p><p>警情失败会带来伤亡、财产损失与声望下降。声望降到 0，或单班伤亡超过上限，行动失败。</p></div>' +
      '<div class="help-block"><h3>能力与单位</h3><p>警力：封控、谈判、防暴；灭火：压制火势；医疗：急救与转运；危化：泄漏与毒气；救援：破拆、云梯、高空。</p><p>云梯车同时提供灭火与救援；危化车提供危化 + 少量灭火；直升机无视道路直飞现场。</p></div>' +
      '<div class="help-block"><h3>五个区域</h3><p>中心城区：警情最密；临江工业区：危化与储罐；稻香乡：农舍、谷仓与农田；白岩监狱：监区冲突与暴动；临江机场：航站楼、跑道与航班迫降。</p></div>' +
      '<div class="help-block"><h3>联机合作</h3><p>房主创建房间拿到六位编号，队友输入编号加入同一座城市。房主主持模拟与时间，所有调度员共享城市和分数。P2P 直连，不需要服务器；网络受限时可能连不上。</p></div>' +
      '<div class="help-block"><h3>按键</h3>' + keyTable() + '</div>' +
      '<div class="help-block"><h3>建议</h3><p>先派警力封控，再让医疗/消防进场；高层优先云梯；乡下先看距离。一键派遣是兜底，手动搭配更快。</p></div>' +
      '</div><div class="help-note">本作为虚构城市与虚构警情，仅用于娱乐；玩法是调度管理，不是真实救援指南。所有图形与音效均由代码实时生成。</div></div>' +
      '<div class="modal-foot"><button class="btn primary" data-close="1">知道了</button></div></div>');
  };

  UI.openAchievements = function (tab) {
    tab = tab || 'career';
    var prog = app.achievements || { unlocked: [], counters: {} };
    var unlocked = prog.unlocked || [];
    var counters = prog.counters || {};
    var camp = app.campaign;
    var totals = (camp && camp.totals) || {};
    var stats = app.stats || {};
    var careerStats = [
      ['生涯完成班次', (totals.shifts || 0) + '<small> / 5</small>'],
      ['生涯总积分', U.fmtShort(totals.score || 0)],
      ['生涯处置成功', (totals.resolved || 0) + '<small> 起</small>'],
      ['生涯处置失败', (totals.failed || 0) + '<small> 起</small>'],
      ['生涯累计伤亡', (totals.deaths || 0) + '<small> 人</small>'],
      ['无尽最佳积分', U.fmtShort(stats.bestEndless || 0)],
      ['无尽轮数', (stats.runs || 0) + '<small> 轮</small>'],
      ['联机行动', (stats.coopRuns || 0) + '<small> 次</small>'],
      ['累计成功处置', (counters.resolved || 0) + '<small> 起</small>']
    ];
    var careerHtml = '<div class="career-grid">' + careerStats.map(function (s) {
      return '<div class="sum-stat"><div class="k">' + s[0] + '</div><div class="v">' + s[1] + '</div></div>';
    }).join('') + '</div><p class="dispatch-note">生涯统计只累计成功完成的班次；累计成功处置包含生涯、无尽与联机的全部成功警情。</p>';
    var achCards = D.ACHIEVEMENTS.map(function (a) {
      var got = unlocked.indexOf(a.id) >= 0;
      var progTxt = got ? '已解锁' : (a.counter ? '进度 ' + (counters[a.counter] || 0) + ' / ' + a.target : '未解锁');
      return '<div class="ach-card ' + (got ? 'unlocked' : 'locked') + '">' +
        '<span class="ach-ico">' + (got ? a.icon : '🔒') + '</span>' +
        '<div class="ach-main"><div class="ach-name">' + esc(a.name) + '</div>' +
        '<div class="ach-desc">' + esc(a.desc) + '</div>' +
        '<div class="ach-progress">' + progTxt + '</div></div></div>';
    }).join('');
    var board = (app.leaderboard || []).slice().sort(function (a, b) { return b.score - a.score || (a.ts || 0) - (b.ts || 0); }).slice(0, 10);
    var boardHtml = board.length ? board.map(function (e, i) {
      var rank = i + 1;
      var date = new Date(e.ts || Date.now());
      var ds = (date.getMonth() + 1) + '/' + date.getDate();
      return '<div class="board-row' + (rank <= 3 ? ' top' : '') + '">' +
        '<span class="board-rank">#' + rank + '</span>' +
        '<div class="board-main"><div class="board-score">' + e.score + '<small> 分</small></div>' +
        '<div class="board-meta">' + esc(e.label || '行动') + ' · ' + ds + '</div></div>' +
        '<span class="board-grade grade-' + esc(e.grade || 'D') + '">' + esc(e.grade || 'D') + '</span>' +
        '<span class="board-deaths">' + (e.deaths || 0) + ' 死</span></div>';
    }).join('') : '<div class="queue-empty">还没有成绩。完成一次值班就会出现在这里。</div>';
    var html = '<div class="modal-card wide" data-modal="achievements">' +
      '<div class="modal-head"><div><h2>战绩 · 成就 · 排行榜</h2><span class="sub">全部保存在本机浏览器，不会上传</span></div><button class="modal-close" data-close="1">×</button></div>' +
      '<div class="modal-body">' +
      '<div class="tabs">' +
      '<button class="' + (tab === 'career' ? 'active' : '') + '" data-ach-tab="career">战绩</button>' +
      '<button class="' + (tab === 'ach' ? 'active' : '') + '" data-ach-tab="ach">成就 · ' + unlocked.length + ' / ' + D.ACHIEVEMENTS.length + '</button>' +
      '<button class="' + (tab === 'board' ? 'active' : '') + '" data-ach-tab="board">排行榜 · 本机 Top 10</button>' +
      '</div>' +
      '<div class="ach-pane" data-ach-pane="career"' + (tab === 'career' ? '' : ' style="display:none"') + '>' + careerHtml + '</div>' +
      '<div class="ach-pane" data-ach-pane="ach"' + (tab === 'ach' ? '' : ' style="display:none"') + '>' +
      '<div class="ach-grid">' + achCards + '</div>' +
      '<p class="dispatch-note">成就随游戏进程自动解锁；联机合作与无尽值班也会记录。清除全部存档会同时清空成就。</p>' +
      '</div>' +
      '<div class="ach-pane" data-ach-pane="board"' + (tab === 'board' ? '' : ' style="display:none"') + '>' +
      '<div class="board-list">' + boardHtml + '</div>' +
      '<div class="set-row" style="margin-top:12px"><div class="set-label"><b>清空本机排行榜</b><small>只清成绩，不影响生涯存档</small></div>' +
      '<button class="btn ghost small" data-clear-board="1">清空</button></div>' +
      '<p class="dispatch-note">排行榜按单次行动积分排序，最多保留 10 条；联机成绩只记录在你自己的设备上。</p>' +
      '</div>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn primary" data-close="1">关闭</button></div></div>';
    showModal(html);
  };

  UI.openAbout = function () {
    modalReturn = null;
    showModal('<div class="modal-card" data-modal="about">' +
      '<div class="modal-head"><div><h2>关于</h2><span class="sub">临界 · 紧急调度 v' + D.VERSION + '</span></div><button class="modal-close" data-close="1">×</button></div>' +
      '<div class="modal-body"><p class="dispatch-note" style="font-size:12px;line-height:1.9">一款在浏览器里运行的城市应急调度游戏：单人五班生涯、无尽值班、六位编号联机合作，以及本机成就与 Top 10 排行榜。地图、建筑、车辆、火焰与音效全部由 Canvas / WebAudio 实时生成，没有外部图片和音频素材。</p>' +
      '<p class="dispatch-note" style="font-size:12px;line-height:1.9">联机使用 PeerJS 公共信令 + WebRTC 直连，房间编号只是临时房间名，不会上传存档。感谢 PeerJS（MIT）提供的开源客户端。</p>' +
      '<p class="dispatch-note" style="font-size:12px;line-height:1.9">临江市、白岩监狱、临江机场与所有人物/警情均为虚构。若你正在经历真实紧急情况，请拨打当地紧急电话。</p></div>' +
      '<div class="modal-foot"><button class="btn primary" data-close="1">关闭</button></div></div>');
  };

  function seg(key, label, opts, value) {
    return '<div class="set-row"><div class="set-label"><b>' + label + '</b></div><div class="set-control"><div class="segmented">' +
      opts.map(function (o) { return '<button data-setting="' + key + '" data-value="' + o[0] + '" class="' + (String(value) === String(o[0]) ? 'active' : '') + '">' + o[1] + '</button>'; }).join('') +
      '</div></div></div>';
  }
  function selectRow(key, label, opts, value) {
    return '<div class="set-row"><div class="set-label"><b>' + label + '</b></div><div class="set-control"><select class="select" data-setting="' + key + '">' +
      opts.map(function (o) { return '<option value="' + o[0] + '"' + (String(value) === String(o[0]) ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
      '</select></div></div>';
  }
  function switchRow(key, label, desc, value) {
    return '<div class="set-row"><div class="set-label"><b>' + label + '</b><small>' + desc + '</small></div><div class="set-control">' +
      '<div class="switch ' + (value ? 'on' : '') + '" data-switch="' + key + '" role="switch" aria-checked="' + !!value + '"></div></div></div>';
  }
  function rangeRow(key, label, value) {
    var v = Math.round(value * 100);
    return '<div class="set-row"><div class="set-label"><b>' + label + '</b></div><div class="set-control">' +
      '<input type="range" min="0" max="100" value="' + v + '" data-range="' + key + '"><span class="range-val" data-range-val="' + key + '">' + v + '</span></div></div>';
  }
  function keyTable() {
    return '<table class="key-table">' + D.KEYS.map(function (k) {
      return '<tr><td>' + k[0].split(' / ').map(function (s) { return '<kbd>' + esc(s) + '</kbd>'; }).join(' ') + '</td><td>' + k[1] + '</td></tr>';
    }).join('') + '</table>';
  }

  function setSetting(key, value) {
    if (!app) return;
    app.settings[key] = value;
    if (key === 'scanlines' && el.app) el.app.classList.toggle('no-scanlines', !value);
    if (key === 'reducedMotion' && el.app) el.app.classList.toggle('reduced-motion', !!value);
    if (key === 'colorblind' && el.app) el.app.classList.toggle('cb', !!value);
    app.applySettings();
  }

  function onModalClick(e) {
    var close = e.target.closest('[data-close]');
    if (close) { closeModal(); return; }
    var tab = e.target.closest('[data-tab]');
    if (tab) {
      var name = tab.getAttribute('data-tab');
      U.$$('.tabs [data-tab]').forEach(function (b) { b.classList.toggle('active', b === tab); });
      U.$$('.set-pane').forEach(function (p) { p.style.display = p.getAttribute('data-pane') === name ? '' : 'none'; });
      return;
    }
    var sw = e.target.closest('[data-switch]');
    if (sw) {
      var key = sw.getAttribute('data-switch');
      var val = !sw.classList.contains('on');
      sw.classList.toggle('on', val);
      sw.setAttribute('aria-checked', String(val));
      setSetting(key, val);
      return;
    }
    var segBtn = e.target.closest('[data-setting][data-value]');
    if (segBtn) {
      var k = segBtn.getAttribute('data-setting');
      var v = segBtn.getAttribute('data-value');
      var parsed = (k === 'speedDefault') ? parseInt(v, 10) : (k === 'fpsCap' ? parseInt(v, 10) : v);
      var parent = segBtn.parentElement;
      U.$$('[data-setting]', parent).forEach(function (b) { b.classList.toggle('active', b === segBtn); });
      setSetting(k, parsed);
      return;
    }
    var achTab = e.target.closest('[data-ach-tab]');
    if (achTab) {
      var paneName = achTab.getAttribute('data-ach-tab');
      U.$$('[data-ach-tab]').forEach(function (b) { b.classList.toggle('active', b === achTab); });
      U.$$('[data-ach-pane]').forEach(function (p) { p.style.display = p.getAttribute('data-ach-pane') === paneName ? '' : 'none'; });
      return;
    }
    var clearBoard = e.target.closest('[data-clear-board]');
    if (clearBoard) {
      confirmBox('清空本机排行榜？', '只清掉成绩记录，不影响生涯存档与成就。', '清空', true, function () {
        app.clearLeaderboard();
        UI.openAchievements('board');
        toast('排行榜已清空', 'warn');
      });
      return;
    }
    var openHelp = e.target.closest('[data-open-help]');
    if (openHelp) { closeModal(); openHelpModalFromSettings(); return; }
    var resetSet = e.target.closest('[data-reset-settings]');
    if (resetSet) {
      confirmBox('恢复默认设置？', '音量、画质等会回到初始值，但不会清除生涯存档。', '恢复', false, function () {
        app.settings = U.deepMerge(D.DEFAULT_SETTINGS, {});
        app.applySettings();
        U.store.set(D.SETTINGS_KEY, app.settings);
        closeModal(); UI.openSettings('video');
        toast('设置已恢复默认', 'good');
      });
      return;
    }
    var resetSave = e.target.closest('[data-reset-save]');
    if (resetSave) {
      confirmBox('清除所有存档？', '生涯进度、统计与设置都会删除，无法恢复。', '全部清除', true, function () {
        app.resetSave();
        closeModal();
        toast('存档已清除', 'warn');
      });
      return;
    }
  }

  function onModalInput(e) {
    var r = e.target.closest('input[data-range]');
    if (!r) return;
    var key = r.getAttribute('data-range');
    var v = U.clamp(parseInt(r.value, 10) / 100, 0, 1);
    var label = el['modal-root'].querySelector('[data-range-val="' + key + '"]');
    if (label) label.textContent = Math.round(v * 100);
    setSetting(key, v);
  }
  function onModalChange(e) {
    var sel = e.target.closest('select[data-setting]');
    if (!sel) return;
    var key = sel.getAttribute('data-setting');
    var v = sel.value;
    if (key === 'fpsCap') v = parseInt(v, 10);
    setSetting(key, v);
  }

  function showModal(html) {
    if (!el['modal-root']) return;
    el['modal-root'].classList.remove('hidden');
    el['modal-root'].innerHTML = html;
    document.body.classList.add('modal-open');
  }
  function closeModal() {
    if (!el['modal-root']) return;
    el['modal-root'].classList.add('hidden');
    el['modal-root'].innerHTML = '';
    document.body.classList.remove('modal-open');
    var ret = modalReturn;
    var resume = modalPausedGame;
    modalReturn = null;
    modalPausedGame = false;
    if (ret === 'pause' && app.screen === 'game' && app.paused) { UI.openPause(true); return; }
    if (resume && app.screen === 'game' && app.paused) app.setPaused(false);
  }
  UI.closeModal = closeModal;

  function confirmBox(title, text, okLabel, danger, onOk) {
    showModal('<div class="modal-card" data-modal="confirm" style="max-width:460px">' +
      '<div class="modal-head"><div><h2>' + esc(title) + '</h2></div><button class="modal-close" data-close="1">×</button></div>' +
      '<div class="modal-body"><p class="dispatch-note" style="font-size:12px;line-height:1.85;margin:0">' + esc(text) + '</p></div>' +
      '<div class="modal-foot"><button class="btn ghost" data-close="1">取消</button><button class="btn ' + (danger ? 'danger' : 'primary') + '" data-confirm-ok="1">' + esc(okLabel) + '</button></div></div>');
    var ok = el['modal-root'].querySelector('[data-confirm-ok]');
    if (ok) ok.addEventListener('click', function () {
      closeModal();
      setTimeout(onOk, 20);
    });
  }
  UI.confirm = confirmBox;

  function openHelpModalFromSettings() {
    modalReturn = app.screen === 'game' && app.paused ? 'pause' : null;
    UI.openHelp();
  }

  /* ============================== 暂停 ============================== */
  UI.openPause = function (fromReturn) {
    if (!app || app.screen !== 'game') return;
    if (!fromReturn) app.setPaused(true);
    var coop = isCoop();
    var guest = isGuest();
    var room = app.lobbyState && app.lobbyState.code;
    showModal('<div class="modal-card" data-modal="pause" style="max-width:520px">' +
      '<div class="modal-head"><div><h2>' + (app.paused ? '行动暂停' : '值班中') + '</h2><span class="sub">' + esc(app.shift ? app.shift.name : '') + (coop ? ' · 房间 ' + esc(room || '----') : '') + '</span></div><button class="modal-close" data-pause-act="resume">×</button></div>' +
      '<div class="modal-body"><div class="pause-actions">' +
      '<button class="btn primary" data-pause-act="resume">继续值班</button>' +
      '<button class="btn" data-pause-act="settings">设置</button>' +
      '<button class="btn" data-pause-act="help">玩法说明</button>' +
      (guest ? '<button class="btn danger" data-pause-act="leave">离开联机行动</button>' :
        (coop ? '<button class="btn danger" data-pause-act="endcoop">结束联合行动</button>' :
          (app.mode === 'campaign' ? '<button class="btn ghost" data-pause-act="restart">重新开始本班</button>' : '<button class="btn ghost" data-pause-act="restart">重新开始值班</button>'))) +
      (!coop ? '<button class="btn ghost" data-pause-act="menu">放弃并返回主菜单</button>' : '') +
      '</div>' +
      (coop && guest ? '<p class="pause-hint">你是加入者：暂停只影响你的界面，房主仍在推进时间。</p>' : '<p class="pause-hint">按 Esc 也可以继续。暂停时不会推进警情倒计时。</p>') +
      (coop ? '<div class="dispatch-note">' + (guest ? '联机行动由房主主持时间与模拟。' : '你是房主：暂停会冻结所有调度员的模拟。') + '</div>' : '') +
      '</div></div>');
    var root = el['modal-root'];
    if (root) {
      root.querySelectorAll('[data-pause-act]').forEach(function (b) {
        b.addEventListener('click', function () {
          var act = b.getAttribute('data-pause-act');
          sfx('click');
          if (act === 'resume') { closeModal(); app.setPaused(false); return; }
          if (act === 'settings') { closeModal(); setTimeout(function () { UI.openSettings('video'); }, 30); return; }
          if (act === 'help') { closeModal(); setTimeout(function () { UI.openHelp(); }, 30); return; }
          if (act === 'restart') {
            confirmBox('重新开始本班？', '本班已经产生的进度不会保存；采购的升级仍然保留。', '重新开始', true, function () {
              closeModal(); app.restartShift();
            });
            return;
          }
          if (act === 'menu') {
            confirmBox('放弃本班并返回？', '本班进度不会保存。', '返回主菜单', true, function () {
              closeModal(); app.abandonToMenu();
            });
            return;
          }
          if (act === 'leave') {
            confirmBox('离开联机行动？', '你会断开与房主的连接，回到主菜单。', '离开', true, function () {
              closeModal(); app.leaveRoom(); app.backToMenuFromLobby(true);
            });
            return;
          }
          if (act === 'endcoop') {
            confirmBox('结束联合行动？', '房间会被关闭，所有调度员返回主菜单。', '结束', true, function () {
              closeModal(); app.endCoop();
            });
            return;
          }
        });
      });
    }
  };

  /* ============================== 简报 ============================== */
  UI.showBriefing = function (shift, opts) {
    opts = opts || {};
    var diff = D.DIFFICULTY[shift.difficultyId || app.settings.difficulty] || D.DIFFICULTY.normal;
    var weather = D.WEATHERS[shift.weather] || D.WEATHERS.rain;
    var tips = shift.index === 0 ? [
      '先看警情，再派车：警情卡片上写着需要的能力。',
      '凑齐需求，处置才会开始；只派一辆车往往不够。',
      '单位返回后会整备，短时间无法再出动。',
      '按空格暂停，按 1/2/3 切换速度。'
    ] : [];
    var html = '<div class="modal-card" data-modal="briefing">' +
      '<div class="modal-head"><div><div class="kicker">行动简报</div><h2 style="margin-top:5px">' + esc(shift.name) + '</h2><span class="sub">' + weather.name + ' · ' + U.clockFromMinutes(shift.startMinutes, 0) + ' · ' + diff.name + '难度</span></div></div>' +
      '<div class="modal-body">' +
      '<p class="dispatch-note" style="font-size:13px;line-height:1.9;margin-top:0">' + esc(shift.intro || '') + '</p>' +
      '<div class="summary-stats" style="grid-template-columns:repeat(3,1fr);padding:8px 0 14px">' +
      '<div class="sum-stat"><div class="k">值班时长</div><div class="v">' + (shift.duration ? Math.round(shift.duration / 60) + '<small> 分钟</small>' : '∞') + '</div></div>' +
      '<div class="sum-stat"><div class="k">伤亡上限</div><div class="v">' + Math.min(shift.maxDeaths || 12, diff.maxDeaths) + '<small> 人</small></div></div>' +
      '<div class="sum-stat"><div class="k">初始声望</div><div class="v">' + U.clamp((shift.startRep || 82) + diff.repBonus, 1, 100) + '</div></div>' +
      '</div>' +
      (tips.length ? '<div class="summary-note" style="border-color:var(--cyan)"><b>值班提示</b><br>' + tips.map(function (t) { return '· ' + esc(t); }).join('<br>') + '</div>' : '') +
      (shift.finale ? '<div class="summary-note" style="border-color:var(--amber)"><b>情报</b>：本班预计会出现一起大事件，提前留意特殊地点的警情。</div>' : '') +
      '</div>' +
      '<div class="modal-foot"><button class="btn ghost" data-close="1" data-brief-skip="1">返回</button><button class="btn primary" data-brief-start="1">开始值班 →</button></div></div>';
    showModal(html);
    var root = el['modal-root'];
    if (root) {
      var start = root.querySelector('[data-brief-start]');
      if (start) start.addEventListener('click', function () {
        closeModal(); app.onBriefingDone();
      });
      var close = root.querySelector('[data-close]');
      if (close) close.addEventListener('click', function () { closeModal(); app.onBriefingDone(); });
    }
  };

  /* ============================== 结算 ============================== */
  UI.showSummary = function (summary) {
    if (!summary) return;
    var ctx = app.summaryContext || {};
    var won = summary.phase === 'ended' && !summary.failed;
    var grade = summary.grade || 'D';
    var mode = app.mode;
    if (el['summary-grade']) { el['summary-grade'].textContent = grade; el['summary-grade'].className = 'summary-grade grade-' + grade; }
    if (el['summary-kicker']) el['summary-kicker'].textContent = mode === 'coop' ? '联合行动结束' : mode === 'endless' ? '无尽值班结束' : won ? '班次结束' : '行动失败';
    if (el['summary-title']) el['summary-title'].textContent = (app.shift ? app.shift.name : '行动总结') + (won ? '' : ' · 未完成');
    if (el['summary-sub']) {
      if (mode === 'endless') el['summary-sub'].textContent = won ? '这一轮的记录已经写入值班日志。' : '无尽值班到此为止，分数会记入本机纪录。';
      else if (mode === 'coop') el['summary-sub'].textContent = won ? '联合行动完成，所有调度员共享这次的处置记录。' : '联合行动失败，城市没有撑过这一轮。';
      else el['summary-sub'].textContent = won ? '城市撑过了这一班，交班记录已经归档。' : (summary.phase === 'failed' ? '伤亡与声望已经越过承受线。' : '还有太多电话没接完。');
    }
    var total = summary.stats.resolved + summary.stats.failed;
    if (el['summary-stats']) {
      el['summary-stats'].innerHTML =
        '<div class="sum-stat"><div class="k">处置完成</div><div class="v">' + summary.stats.resolved + '<small> / ' + total + '</small></div></div>' +
        '<div class="sum-stat"><div class="k">平均响应</div><div class="v">' + (summary.avgResponse != null ? Math.round(summary.avgResponse) + '<small> 秒</small>' : '--') + '</div></div>' +
        '<div class="sum-stat ' + (summary.deaths ? 'bad' : 'good') + '"><div class="k">伤亡</div><div class="v">' + summary.deaths + '<small> 人</small></div></div>' +
        '<div class="sum-stat bad"><div class="k">财产损失</div><div class="v">' + U.fmtShort(summary.damage) + '</div></div>' +
        '<div class="sum-stat"><div class="k">' + (mode === 'campaign' ? '本班收入' : '行动积分') + '</div><div class="v">' + (mode === 'campaign' ? U.fmtMoney((app.summaryContext && app.summaryContext.earnedFunds) || 0) : U.fmtShort(summary.score)) + '</div></div>';
    }
    if (el['summary-calls']) {
      var calls = (summary.calls || []).slice().sort(function (a, b) { return (b.time || 0) - (a.time || 0); });
      el['summary-calls'].innerHTML = calls.length ? calls.map(function (c) {
        var tag = c.status === 'resolved' ? '<span class="call-tag ok">成功</span>' : '<span class="call-tag fail">失败</span>';
        return '<div class="call-row"><span class="ci">' + c.icon + '</span><span class="cn">' + esc(c.name) + ' · ' + esc(c.label) + '</span>' +
          '<span class="ct">' + (c.response != null ? c.response + 's 响应' : '未到场') + '</span>' + tag + '</div>';
      }).join('') : '<div class="queue-empty">没有记录。</div>';
      if (el['summary-calls-count']) el['summary-calls-count'].textContent = calls.length + ' 起';
    }
    if (el['summary-note']) {
      var note = '';
      if (won && mode === 'campaign') {
        var hasNext = app.campaign && app.campaign.shiftIndex < D.SHIFTS.length;
        note = hasNext ? '本班收入已计入资金。前往补给站，为下一班做准备。' : '五个班次全部完成。临江市记住了你的声音。';
      } else if (won && mode === 'endless') {
        note = '本轮积分 ' + summary.score + '。' + (ctx.newBest ? '新纪录！' : '继续挑战更高分。');
      } else if (won && mode === 'coop') {
        note = '联合行动完成。所有调度员共享这次的处置记录。';
      } else if (summary.phase === 'failed') {
        note = '伤亡与声望已经越过城市能承受的线。复盘一下：是不是把重车派去了小警情、或者让单位在整备时空转？';
      } else {
        note = D.SUMMARY_HINTS[Math.floor(Math.random() * D.SUMMARY_HINTS.length)];
      }
      if (ctx.boardRank) note += ' 本机排行榜第 ' + ctx.boardRank + ' 名。';
      el['summary-note'].textContent = note;
    }
    var next = el['btn-summary-next'], retry = el['btn-summary-retry'], menu = el['btn-summary-menu'];
    if (next) next.classList.remove('hidden');
    if (retry) retry.classList.add('hidden');
    if (menu) menu.classList.remove('hidden');
    if (mode === 'campaign') {
      if (won) {
        var hasNext2 = app.campaign && app.campaign.shiftIndex < D.SHIFTS.length;
        next.textContent = hasNext2 ? '进入补给站 →' : '完成生涯';
      } else {
        next.classList.add('hidden');
        retry.classList.remove('hidden');
      }
    } else if (mode === 'endless') {
      next.textContent = '再来一轮';
      retry.classList.remove('hidden');
      retry.textContent = '再试一次';
    } else {
      next.textContent = isGuest() ? '离开房间' : '结束联合行动';
      retry.classList.add('hidden');
    }
    UI.showScreen('summary');
  };

  /* ============================== 补给站 ============================== */
  UI.showShop = function () {
    renderShop();
    UI.showScreen('shop');
  };

  function renderShop() {
    if (!app.campaign) return;
    var camp = app.campaign;
    if (el['shop-funds']) el['shop-funds'].textContent = U.fmtMoney(camp.funds);
    var nextShift = D.SHIFTS[camp.shiftIndex];
    if (el['shop-next-brief'] && nextShift) {
      el['shop-next-brief'].innerHTML = '<span class="snext-tag">下一班</span><b>' + esc(nextShift.name) + '</b> · ' +
        esc(D.WEATHERS[nextShift.weather].name) + ' · 预计 ' + Math.round(nextShift.duration / 60) + ' 分钟 · 难度系数 ' + nextShift.difficulty.toFixed(2) +
        '<br><span style="color:var(--muted)">' + esc(nextShift.intro || '') + '</span>';
    }
    if (el['shop-shop-sub']) el['shop-shop-sub'].textContent = '采购立即生效，资金会保留到下一班。当前难度：' + (D.DIFFICULTY[camp.difficulty] || D.DIFFICULTY.normal).name;
    if (el['shop-grid']) {
      el['shop-grid'].innerHTML = D.UPGRADES.map(function (up) {
        var owned = camp.upgrades.indexOf(up.id) >= 0;
        var can = camp.funds >= up.cost;
        return '<div class="shop-item' + (owned ? ' owned' : '') + '">' +
          '<div class="si-top"><span class="si-ico">' + up.icon + '</span><span class="si-name">' + esc(up.name) + '</span></div>' +
          '<div class="si-desc">' + esc(up.desc) + '</div>' +
          '<div class="si-foot"><span class="price">' + (owned ? '已拥有' : U.fmtMoney(up.cost)) + '</span>' +
          (owned ? '<span class="call-tag ok">已装备</span>' : '<button class="btn primary small" data-buy="' + up.id + '"' + (can ? '' : ' disabled') + '>采购</button>') +
          '</div></div>';
      }).join('');
    }
    if (el['btn-shop-next']) {
      var last = camp.shiftIndex >= D.SHIFTS.length - 1;
      el['btn-shop-next'].textContent = last ? '开始最终班次 →' : '开始下一班 →';
    }
  }
  UI.renderShop = renderShop;

  /* ============================== 联机大厅 ============================== */
  UI.openLobby = function () {
    UI.showScreen('lobby');
    renderLobby();
  };

  UI.setLobbyState = function (st) {
    app.lobbyState = st;
    renderLobby();
  };

  function renderLobby() {
    if (!el['lobby']) return;
    var st = app.lobbyState || {};
    var role = st.role || (app.netRole || null);
    var joining = app.lobbyJoining;
    if (el['lobby-entry']) el['lobby-entry'].classList.toggle('hidden', !!role || !!joining);
    if (el['lobby-host-view']) el['lobby-host-view'].classList.toggle('hidden', role !== 'host');
    if (el['lobby-guest-view']) el['lobby-guest-view'].classList.toggle('hidden', role !== 'guest');
    if (el['btn-lobby-start']) {
      el['btn-lobby-start'].classList.toggle('hidden', role !== 'host');
      el['btn-lobby-start'].disabled = role !== 'host' || (st.players || []).length < 1;
    }
    if (el['lobby-code']) el['lobby-code'].textContent = st.code || app.roomCode || '------';
    if (el['guest-code']) el['guest-code'].textContent = st.code || app.roomCode || '------';
    if (el['lobby-status']) {
      if (role === 'host') el['lobby-status'].textContent = st.code ? '把编号发给队友。至少 1 人即可开始，也可以单人先试。' : '正在创建房间…';
      else el['lobby-status'].textContent = '正在创建房间…';
    }
    if (el['guest-status']) el['guest-status'].textContent = st.error ? st.error : '等待房主开始行动…';
    if (el['join-status']) el['join-status'].textContent = joining ? '正在连接房主…' : (st.error || '');
    if (el['lobby-player-count']) el['lobby-player-count'].textContent = ((st.players || []).length) + ' / ' + D.MAX_PLAYERS;
    if (el['lobby-players']) {
      var players = st.players || [];
      var html = '';
      for (var i = 0; i < D.MAX_PLAYERS; i++) {
        var p = players[i];
        if (p) {
          html += '<div class="lobby-player"><span class="avatar" style="background:' + p.color + '">' + esc((p.name || '?').slice(0, 1)) + '</span>' +
            '<div><div class="lp-name">' + esc(p.name) + (p.id === app.myPlayerId ? '（你）' : '') + '</div>' +
            '<div class="lp-role">' + (p.isHost ? '房主 / 指挥官' : '调度员 · 共享指挥权') + '</div></div></div>';
        } else {
          html += '<div class="lobby-player empty"><span class="avatar" style="background:#1b2836;color:#5c7185">+</span><div><div class="lp-name">等待加入</div><div class="lp-role">—</div></div></div>';
        }
      }
      el['lobby-players'].innerHTML = html;
    }
    if (el['lobby-error']) {
      if (st.error) { el['lobby-error'].textContent = st.error; el['lobby-error'].classList.remove('hidden'); }
      else { el['lobby-error'].classList.add('hidden'); el['lobby-error'].textContent = ''; }
    }
    if (el['coop-difficulty']) {
      el['coop-difficulty'].value = st.difficulty || app.coopDifficulty || 'normal';
      el['coop-difficulty'].disabled = role !== 'host';
    }
    if (el['btn-create-room']) el['btn-create-room'].disabled = !!joining;
    if (el['btn-join-room']) el['btn-join-room'].disabled = !!joining;
    if (el['btn-copy-code']) el['btn-copy-code'].disabled = !st.code;
  }

  function setLobbyError(msg) {
    app.lobbyError = msg;
    if (app.lobbyState) app.lobbyState.error = msg;
    if (el['join-status']) el['join-status'].textContent = msg;
    if (el['lobby-error']) { el['lobby-error'].textContent = msg; el['lobby-error'].classList.remove('hidden'); }
  }
  UI.setLobbyError = setLobbyError;

  UI.copy = function (text) { copyText(text); };
  function copyText(text) {
    if (!text) return;
    var done = function () { toast('已复制：' + text, 'good'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text, done); });
    } else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); done();
    } catch (e) { toast('复制失败，请手动记下编号', 'warn'); }
  }

  UI.refreshLobby = renderLobby;

  /* ============================== 移动端抽屉 ============================== */
  UI.openSheet = openSheet;
  function openSheet(name) {
    if (!app || !U.isMobileLayout()) return;
    if (el.app) {
      el.app.classList.toggle('sheet-queue', name === 'queue');
      el.app.classList.toggle('sheet-detail', name === 'detail');
    }
  }
  function closeSheets() {
    if (el.app) { el.app.classList.remove('sheet-queue'); el.app.classList.remove('sheet-detail'); }
  }
  UI.closeSheets = closeSheets;

  UI.onKeyEscape = function () {
    if (el['modal-root'] && !el['modal-root'].classList.contains('hidden')) {
      var modal = el['modal-root'].querySelector('[data-modal]');
      if (modal && modal.getAttribute('data-modal') === 'briefing') return false;
      closeModal(); return true;
    }
    if (el.app && (el.app.classList.contains('sheet-queue') || el.app.classList.contains('sheet-detail'))) { closeSheets(); return true; }
    return false;
  };

  /* 让设置变化后 UI 立刻同步画质开关 */
  UI.syncSettingsClasses = function () {
    if (!el.app || !app) return;
    el.app.classList.toggle('no-scanlines', !app.settings.scanlines);
    el.app.classList.toggle('reduced-motion', !!app.settings.reducedMotion);
    el.app.classList.toggle('cb', !!app.settings.colorblind);
  };
})(window);
