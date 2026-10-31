/* =========================================================================
   临界 · 紧急调度 — 通用工具（无依赖，经典脚本，挂在 window.EM.util）
   回退办法：整个 emergency/ 目录可独立删除；本文件不影响站内其它页面。
   ========================================================================= */
(function (root) {
  'use strict';
  var EM = root.EM = root.EM || {};
  var U = EM.util = {};

  U.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  U.lerp = function (a, b, t) { return a + (b - a) * t; };
  U.invLerp = function (a, b, v) { return b === a ? 0 : (v - a) / (b - a); };
  U.easeOutCubic = function (t) { t = U.clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); };
  U.dist = function (x1, y1, x2, y2) { var dx = x2 - x1, dy = y2 - y1; return Math.sqrt(dx * dx + dy * dy); };
  U.dist2 = function (x1, y1, x2, y2) { var dx = x2 - x1, dy = y2 - y1; return dx * dx + dy * dy; };
  U.normAngle = function (a) {
    a = a % (Math.PI * 2);
    if (a > Math.PI) a -= Math.PI * 2;
    if (a < -Math.PI) a += Math.PI * 2;
    return a;
  };
  U.angleLerp = function (a, b, t) {
    var d = U.normAngle(b - a);
    return a + d * U.clamp(t, 0, 1);
  };
  U.angleTo = function (x1, y1, x2, y2) { return Math.atan2(y2 - y1, x2 - x1); };

  /* 确定性随机数：mulberry32。地图、装饰、客户端都靠它保持一致。 */
  U.mulberry32 = function (seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  U.hashString = function (str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };
  U.randInt = function (rng, a, b) { return a + Math.floor(rng() * (b - a + 1)); };
  U.pick = function (rng, arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; };
  U.shuffle = function (rng, arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  };
  U.weightedPick = function (rng, items, weightFn) {
    var total = 0, i;
    for (i = 0; i < items.length; i++) total += Math.max(0, weightFn(items[i]));
    if (total <= 0) return items.length ? items[Math.floor(rng() * items.length)] : null;
    var r = rng() * total;
    for (i = 0; i < items.length; i++) {
      r -= Math.max(0, weightFn(items[i]));
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  };

  /* 时间：班次开始时刻 + 已过秒数 → HH:MM */
  U.clockFromMinutes = function (startMinutes, seconds) {
    var m = Math.floor(startMinutes + seconds / 60) % 1440;
    if (m < 0) m += 1440;
    var hh = Math.floor(m / 60), mm = m % 60;
    return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  };
  U.fmtTimer = function (sec) {
    sec = Math.max(0, Math.ceil(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  };
  U.fmtDuration = function (sec) {
    sec = Math.max(0, Math.round(sec));
    if (sec < 60) return sec + ' 秒';
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ' 分' + (s ? ' ' + s + ' 秒' : '');
  };
  U.fmtMoney = function (n) {
    n = Math.round(n);
    return '¥' + n.toLocaleString('zh-CN');
  };
  U.fmtPct = function (v) { return Math.round(v * 100) + '%'; };
  U.pad2 = function (n) { return (n < 10 ? '0' : '') + n; };

  U.$ = function (sel, el) { return (el || document).querySelector(sel); };
  U.$$ = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };
  U.make = function (tag, cls, html) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (html != null) el.innerHTML = html;
    return el;
  };
  U.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  };
  U.clampText = function (s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  /* 本地存储：任何异常都不允许影响游戏启动 */
  var store = {
    get: function (key, fallback) {
      try {
        var raw = root.localStorage.getItem(key);
        if (raw == null) return fallback;
        return JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { root.localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch (e) { return false; }
    },
    remove: function (key) { try { root.localStorage.removeItem(key); } catch (e) { } }
  };
  U.store = store;

  U.deepMerge = function (base, patch) {
    var out = {};
    Object.keys(base).forEach(function (k) { out[k] = base[k]; });
    if (!patch || typeof patch !== 'object') return out;
    Object.keys(patch).forEach(function (k) {
      var v = patch[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
        out[k] = U.deepMerge(base[k], v);
      } else if (v !== undefined) {
        out[k] = v;
      }
    });
    return out;
  };

  /* 颜色：十六进制 → rgba，用于动态透明度 */
  U.alpha = function (hex, a) {
    if (!hex || hex[0] !== '#') return hex;
    var h = hex.length === 4
      ? '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3]
      : hex;
    var n = parseInt(h.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  };
  U.mixHex = function (a, b, t) {
    function p(h) {
      h = h.replace('#', '');
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      var n = parseInt(h, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    var A = p(a), B = p(b), c = [0, 0, 0];
    for (var i = 0; i < 3; i++) c[i] = Math.round(U.lerp(A[i], B[i], t));
    return '#' + c.map(function (v) { return (v < 16 ? '0' : '') + v.toString(16); }).join('');
  };

  /* 把秒数变成 2× / 4× 之类的显示 */
  U.speedLabel = function (v) { return v === 0 ? '暂停' : v + '×'; };

  /* 简易限频器，给 UI 局部刷新用 */
  U.throttle = function (fn, ms) {
    var last = 0, timer = null, lastArgs = null;
    return function () {
      lastArgs = arguments;
      var now = Date.now();
      if (now - last >= ms) { last = now; fn.apply(null, lastArgs); }
      else if (!timer) {
        timer = setTimeout(function () { timer = null; last = Date.now(); fn.apply(null, lastArgs); }, ms - (now - last));
      }
    };
  };

  /* 判断点是否在矩形里 */
  U.inRect = function (px, py, x, y, w, h) { return px >= x && py >= y && px <= x + w && py <= y + h; };

  /* 设备判断：给 UI 和渲染器做轻量适配 */
  U.isTouch = function () { return ('ontouchstart' in root) || (navigator.maxTouchPoints > 0); };
  U.isMobileLayout = function () { return root.innerWidth <= 900; };

  /* 生成房间编号：去掉容易混淆的 0/O/1/I */
  U.roomCode = function () {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var s = '';
    var buf = new Uint32Array(6);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(buf);
    for (var i = 0; i < 6; i++) s += chars[(buf[i] || Math.floor(Math.random() * 1e9)) % chars.length];
    return s;
  };

  /* 数字缩写：1240 → 1.2k */
  U.fmtShort = function (n) {
    n = Math.round(n);
    if (n < 1000) return String(n);
    if (n < 1000000) return (n / 1000).toFixed(n < 10000 ? 1 : 0) + 'k';
    return (n / 1000000).toFixed(1) + 'm';
  };
})(window);
