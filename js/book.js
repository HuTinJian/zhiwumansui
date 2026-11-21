/* ============================================================
   织雾满穗 · 书卷层（book.js）
   ------------------------------------------------------------
   把整站按「一本书」来摆，做五件事：
     ① 设置面板：主题（亮 / 暗 / 跟随）、动效（完整 / 轻柔 / 关闭）、
        宣纸颗粒（开 / 关）、字号（标准 / 大一号）。
        导航右上角原来那颗切主题的小太阳，就是现在打开设置的地方。
     ② 章节题签：每页正文开头一条「第一章 · 雾起」，带朱砂小印。
     ③ 目录：导航里的「目录」拉出全书五章，当前章用朱砂标出。
     ④ 幕号：页面里的板块标题前加「第一幕」，跟章号凑成「第1章 第1幕」。
     ⑤ 阅读指示：左下角一小条，随滚动显示读到第几章第几幕，点它开目录。

   性能：
     · 只用 IntersectionObserver，不挂 scroll 监听，滚动时零 JS 计算；
     · 设置面板点开才创建 DOM（首屏不多一个节点）；
     · 动效关掉时整页动画停摆（CSS 里 data-fx="off" 一段），最省电。

   偏好保存：localStorage 的 zm_prefs；主题同时写旧 key zm_theme，
   因为每个页面的 <head> 里都有一小段内联脚本靠它「首屏不闪」。

   【回退】删掉本文件和各页那一行 <script src="js/book.js" defer>，
   再 git checkout -- css/style.css js/common.js（把新增样式和 applyTheme 的守卫一起撤掉）。
   ============================================================ */
(function () {
  'use strict';

  var D = document;
  var root = D.documentElement;

  /* ============================================================
     1. 偏好（主题 / 动效 / 颗粒 / 字号）
     ============================================================ */
  var PREF_KEY = 'zm_prefs';
  var THEME_KEY = 'zm_theme';

  var PREFS = { theme: 'auto', fx: 'full', texture: 'on', font: 'std' };

  function readPrefs() {
    try {
      var raw = localStorage.getItem(PREF_KEY);
      if (!raw) return;
      var p = JSON.parse(raw);
      if (!p || typeof p !== 'object') return;
      if (p.theme === 'light' || p.theme === 'dark' || p.theme === 'auto') PREFS.theme = p.theme;
      if (p.fx === 'full' || p.fx === 'lite' || p.fx === 'off') PREFS.fx = p.fx;
      if (p.texture === 'on' || p.texture === 'off') PREFS.texture = p.texture;
      if (p.font === 'std' || p.font === 'lg') PREFS.font = p.font;
    } catch (e) { /* 隐私模式读不到就当没设过 */ }
  }

  /* 老访客迁移：以前只有一个 zm_theme（小太阳写的），没有 zm_prefs。
     如果只认新 key，这些人会被当成「没选过」而回落到系统主题 ——
     等于把他们的选择弄丢了。所以第一次见到旧 key 就顺手记进新偏好。 */
  function migrateLegacyTheme() {
    try {
      if (localStorage.getItem(PREF_KEY)) return;
      var old = localStorage.getItem(THEME_KEY);
      if (old === 'light' || old === 'dark') {
        PREFS.theme = old;
        savePrefs();
      }
    } catch (e) {}
  }

  function savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(PREFS)); } catch (e) {}
  }

  function systemDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  /* 主题：auto 时把 zm_theme 清掉，让各页 <head> 的内联脚本按系统走；
     选亮/暗则写两份（localStorage + cookie），手机上的怪毛病也是这么修的。 */
  function applyThemePref() {
    var t = PREFS.theme;
    if (t === 'auto') {
      try { localStorage.removeItem(THEME_KEY); } catch (e) {}
      try { D.cookie = THEME_KEY + '=; path=/; max-age=0; SameSite=Lax'; } catch (e) {}
      t = systemDark() ? 'dark' : 'light';
    } else {
      try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
      try { D.cookie = THEME_KEY + '=' + t + '; path=/; max-age=31536000; SameSite=Lax'; } catch (e) {}
    }
    root.setAttribute('data-theme', t);
    root.style.colorScheme = t;
    var meta = D.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#14110E' : '#F5F0E6');
  }

  function applyFxPref() {
    root.setAttribute('data-fx', PREFS.fx);
    /* full 时把 lite 摘掉；lite/off 时挂上，粒子层与持续动画都靠这个类关掉 */
    root.classList.toggle('lite', PREFS.fx !== 'full');
    /* 告诉 common.js：用户已经手动选了档位，别再按设备自动降级覆盖 */
    window.__ZM_FX_LOCK = PREFS.fx;
  }

  function applyLookPref() {
    root.setAttribute('data-texture', PREFS.texture);
    root.setAttribute('data-font', PREFS.font);
  }

  function applyAll() {
    applyThemePref();
    applyFxPref();
    applyLookPref();
  }

  /* ============================================================
     2. 书的结构：章 / 幕 / 目录
     ============================================================ */
  var IS_FILE = /\.html?$/i.test(location.pathname);

  function hrefFor(file) {
    if (!file) return IS_FILE ? 'index.html' : './';
    return IS_FILE ? file : file.replace(/\.html?$/i, '');
  }

  var CHAPTERS = {
    'index': { no: '第一章', seal: '一', title: '雾起', note: '开篇 · 一个小而认真的个人站点' },
    'roblox_music': { no: '第二章', seal: '二', title: '拾穗', note: '宝库 · 游戏里能用的音乐与音效' },
    'law': { no: '第三章', seal: '三', title: '立规', note: '法度 · 与音乐使用有关的条文' },
    'thanks': { no: '第四章', seal: '四', title: '结草', note: '鸣谢 · 这本书靠谁撑着' },
    'support': { no: '第五章', seal: '五', title: '投桃', note: '登记 · 赞助与回礼' },
    'admin': { no: '案牍', seal: '案', title: '掌灯', note: '后台 · 替人守夜的地方' },
    '404': { no: '外篇', seal: '外', title: '迷途', note: '雾里的岔路' }
  };

  /* 全书目录只列公开的五章；后台不进目录。 */
  var TOC = [
    { file: '', key: 'index' },
    { file: 'roblox_music.html', key: 'roblox_music' },
    { file: 'law.html', key: 'law' },
    { file: 'thanks.html', key: 'thanks' },
    { file: 'support.html', key: 'support' }
  ];

  function pageKey() {
    var seg = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    seg = seg.replace(/\.html?$/i, '');
    if (!seg || seg === 'index' || seg === '') return 'index';
    return seg;
  }

  var CURRENT = pageKey();
  var CH = CHAPTERS[CURRENT] || null;

  function han(n) {
    var s = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    if (n <= 10) return s[n];
    if (n < 20) return '十' + s[n - 10];
    return String(n);
  }

  /* ============================================================
     3. 题签：正文最前面一条「第一章 · 雾起」
     ============================================================ */
  function buildChapterBlock() {
    if (!CH) return;
    var main = D.getElementById('main') || D.querySelector('main');
    /* 后台没有 <main>：题签插在顶栏下面，别把工具条顶下去 */
    var adminTop = D.querySelector('.admin-topbar');
    if (!main && adminTop) {
      if (D.querySelector('.book-chapter')) return;
      var slim = D.createElement('header');
      slim.className = 'book-chapter is-admin';
      slim.setAttribute('aria-label', '章节');
      slim.innerHTML =
        '<span class="bc-seal" aria-hidden="true">' + CH.seal + '</span>' +
        '<span class="bc-body">' +
          '<span class="bc-no">' + CH.no + '</span>' +
          '<span class="bc-title">' + CH.title + '</span>' +
          '<span class="bc-note">' + CH.note + '</span>' +
        '</span>';
      adminTop.insertAdjacentElement('afterend', slim);
      return;
    }
    if (!main || main.querySelector('.book-chapter')) return;

    var el = D.createElement('header');
    el.className = 'book-chapter';
    el.setAttribute('aria-label', '章节');

    el.innerHTML =
      '<span class="bc-seal" aria-hidden="true">' + CH.seal + '</span>' +
      '<span class="bc-body">' +
        '<span class="bc-no">' + CH.no + '</span>' +
        '<span class="bc-title">' + CH.title + '</span>' +
        '<span class="bc-note">' + CH.note + '</span>' +
      '</span>' +
      '<span class="bc-rule" aria-hidden="true"></span>';

    main.insertBefore(el, main.firstChild);
  }

  /* ============================================================
     4. 幕号：板块标题前加「第一幕」
     ============================================================ */
  function numberActs() {
    var heads = D.querySelectorAll('main .section-head');
    var list = [];
    for (var i = 0; i < heads.length; i++) {
      var head = heads[i];
      if (head.closest('.modal') || head.hasAttribute('data-no-act')) continue;
      var title = head.querySelector('h1, h2');
      if (!title || head.querySelector('.act-no')) continue;
      var tag = D.createElement('span');
      tag.className = 'act-no';
      tag.setAttribute('aria-hidden', 'true');
      tag.textContent = '第' + han(list.length + 1) + '幕';
      head.insertBefore(tag, head.firstChild);
      list.push(head);
    }
    return list;
  }

  /* ============================================================
     5. 阅读指示：左下角「第一章 · 第一幕」
     ============================================================ */
  function buildMarker(acts) {
    if (!CH) return null;
    var btn = D.createElement('button');
    btn.type = 'button';
    btn.className = 'chapter-marker';
    btn.setAttribute('aria-label', '打开目录');
    btn.setAttribute('title', '打开目录');
    btn.innerHTML =
      '<span class="cm-ch">' + CH.no + '</span>' +
      '<span class="cm-sep" aria-hidden="true">·</span>' +
      '<span class="cm-act">卷首</span>';
    D.body.appendChild(btn);

    var actEl = btn.querySelector('.cm-act');

    if (!acts.length || !('IntersectionObserver' in window)) {
      btn.classList.add('is-static');
      return btn;
    }

    /* 只观察板块标题：滚到哪一幕就把标签换掉；不做任何 scroll 计算 */
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var idx = acts.indexOf(en.target);
        if (idx < 0) return;
        actEl.textContent = '第' + han(idx + 1) + '幕';
      });
    }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });

    acts.forEach(function (el) { io.observe(el); });
    return btn;
  }

  /* ============================================================
     6. 目录抽屉
     ============================================================ */
  var tocEl = null;

  function buildToc() {
    if (tocEl) return tocEl;

    tocEl = D.createElement('div');
    tocEl.className = 'book-toc';
    tocEl.hidden = true;

    var rows = TOC.map(function (it) {
      var ch = CHAPTERS[it.key];
      if (!ch) return '';
      var now = it.key === CURRENT ? ' is-now' : '';
      return '<li>' +
        '<a class="bt-row' + now + '" href="' + hrefFor(it.file) + '">' +
          '<span class="bt-no">' + ch.no + '</span>' +
          '<span class="bt-title">' + ch.title + '</span>' +
          '<span class="bt-note">' + ch.note + '</span>' +
        '</a>' +
      '</li>';
    }).join('');

    tocEl.innerHTML =
      '<div class="bt-scrim" data-toc-close></div>' +
      '<aside class="bt-panel" role="dialog" aria-modal="true" aria-label="目录">' +
        '<div class="bt-head">' +
          '<span class="bt-kicker">织雾满穗</span>' +
          '<h2 class="bt-h">目录</h2>' +
          '<button type="button" class="bt-x" data-toc-close aria-label="关闭目录">×</button>' +
        '</div>' +
        '<ol class="bt-list">' + rows + '</ol>' +
        '<p class="bt-foot">全书五章 · 读到哪一章，左上角的印会告诉你</p>' +
      '</aside>';

    D.body.appendChild(tocEl);

    tocEl.addEventListener('click', function (e) {
      if (e.target.closest('[data-toc-close]')) closeToc();
    });

    return tocEl;
  }

  function openToc() {
    buildToc();
    tocEl.hidden = false;
    /* 先显示再加类，才能吃到过渡动画 */
    requestAnimationFrame(function () { tocEl.classList.add('open'); });
    D.documentElement.classList.add('toc-open');
    var first = tocEl.querySelector('.bt-row');
    if (first && first.focus) first.focus({ preventScroll: true });
  }

  function closeToc() {
    if (!tocEl || tocEl.hidden) return;
    tocEl.classList.remove('open');
    D.documentElement.classList.remove('toc-open');
    setTimeout(function () { if (!tocEl.classList.contains('open')) tocEl.hidden = true; }, 240);
  }

  /* ============================================================
     7. 设置面板
     ============================================================ */
  var ROWS = [
    {
      key: 'theme', title: '主题', demo: 'theme',
      hint: '亮 = 宣纸底、墨字；暗 = 墨夜底、宣纸字；跟随 = 系统怎么变它就怎么变。',
      opts: [['light', '亮'], ['dark', '暗'], ['auto', '跟随']]
    },
    {
      key: 'fx', title: '动效', demo: 'fx',
      hint: '完整 = 纸屑微光与极光都在；轻柔 = 去掉一直在跑的动画，只留淡入；关闭 = 全部静止，最省电。',
      opts: [['full', '完整'], ['lite', '轻柔'], ['off', '关闭']]
    },
    {
      key: 'texture', title: '宣纸颗粒', demo: 'texture',
      hint: '开 = 底纹带纸的颗粒与两团极淡的光；关 = 纯色底，滚动最省。',
      opts: [['on', '开'], ['off', '关']]
    },
    {
      key: 'font', title: '字号', demo: 'font',
      hint: '大一号会把正文、标题一起放大（手机上更好读，一行字会变少）。',
      opts: [['std', '标准'], ['lg', '大一号']]
    }
  ];

  var setEl = null;

  function demoHtml(kind) {
    if (kind === 'theme') {
      return '<span class="dm-paper" title="宣纸底"></span><span class="dm-ink" title="墨夜底"></span>';
    }
    if (kind === 'fx') {
      return '<span class="dm-fx"><i></i><i></i><i></i></span>';
    }
    if (kind === 'texture') {
      return '<span class="dm-tex"></span>';
    }
    return '<span class="dm-font">字</span>';
  }

  function rowHtml(r) {
    var opts = r.opts.map(function (o) {
      var on = PREFS[r.key] === o[0] ? ' is-on' : '';
      return '<button type="button" class="set-opt' + on + '" data-set-key="' + r.key +
        '" data-set-val="' + o[0] + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + o[1] + '</button>';
    }).join('');

    return '<div class="set-row" data-row="' + r.key + '">' +
      '<div class="set-info">' +
        '<h3>' + r.title + '</h3>' +
        '<p>' + r.hint + '</p>' +
      '</div>' +
      '<div class="set-side">' +
        '<div class="set-ctl" role="group" aria-label="' + r.title + '">' + opts + '</div>' +
        '<div class="set-demo dm-' + r.demo + '" aria-hidden="true">' + demoHtml(r.demo) + '</div>' +
      '</div>' +
    '</div>';
  }

  function buildSettings() {
    if (setEl) return setEl;

    setEl = D.createElement('div');
    setEl.className = 'set-overlay';
    setEl.hidden = true;

    setEl.innerHTML =
      '<div class="set-scrim" data-set-close></div>' +
      '<div class="set-sheet" role="dialog" aria-modal="true" aria-label="设置">' +
        '<div class="set-head">' +
          '<div>' +
            '<p class="set-kicker">织雾满穗 · 阅读设置</p>' +
            '<h2 class="set-title">怎么读这本书</h2>' +
          '</div>' +
          '<button type="button" class="set-x" data-set-close aria-label="关闭设置">×</button>' +
        '</div>' +
        '<div class="set-body">' + ROWS.map(rowHtml).join('') + '</div>' +
        '<p class="set-foot">设置只存在你这台设备的浏览器里，换个设备要重新选一次。</p>' +
      '</div>';

    D.body.appendChild(setEl);

    setEl.addEventListener('click', function (e) {
      if (e.target.closest('[data-set-close]')) { closeSettings(); return; }
      var opt = e.target.closest('.set-opt');
      if (!opt) return;
      var key = opt.getAttribute('data-set-key');
      var val = opt.getAttribute('data-set-val');
      if (!key || !val) return;
      PREFS[key] = val;
      savePrefs();
      applyAll();
      syncSettings();
      /* 主题换完要重画一次，手机浏览器只改变量时会「只变一半」 */
      if (key === 'theme' && D.body) void D.body.offsetHeight;
    });

    return setEl;
  }

  function syncSettings() {
    if (!setEl) return;
    ROWS.forEach(function (r) {
      var row = setEl.querySelector('[data-row="' + r.key + '"]');
      if (!row) return;
      row.querySelectorAll('.set-opt').forEach(function (b) {
        var on = b.getAttribute('data-set-val') === PREFS[r.key];
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    });
    setEl.setAttribute('data-theme-preview', PREFS.theme);
    setEl.setAttribute('data-fx-preview', PREFS.fx);
  }

  function openSettings() {
    buildSettings();
    syncSettings();
    setEl.hidden = false;
    requestAnimationFrame(function () { setEl.classList.add('open'); });
    D.documentElement.classList.add('set-open');
    var first = setEl.querySelector('.set-opt.is-on') || setEl.querySelector('.set-opt');
    if (first && first.focus) first.focus({ preventScroll: true });
  }

  function closeSettings() {
    if (!setEl || setEl.hidden) return;
    setEl.classList.remove('open');
    D.documentElement.classList.remove('set-open');
    setTimeout(function () { if (!setEl.classList.contains('open')) setEl.hidden = true; }, 220);
  }

  /* ============================================================
     8. 导航按钮：目录 + 设置
     ============================================================ */
  function navSlot() {
    var nav = D.querySelector('.navbar .nav-links');
    if (nav) return { node: nav, li: true };
    var admin = D.querySelector('.admin-topbar .actions');
    if (admin) return { node: admin, li: false };
    /* 宝库页没有 navbar，只有一个 [data-theme-slot] 落点（common.js 也认这个） */
    var slot = D.querySelector('[data-theme-slot]');
    if (slot) return { node: slot, li: false };
    return null;
  }

  function injectButtons() {
    var slot = navSlot();
    if (!slot) return;

    var isAdmin = CURRENT === 'admin';

    /* 目录：只在公开页面出现，后台是干活的地方，不做目录 */
    if (!isAdmin && !D.querySelector('.book-toc-open')) {
      var tbtn = D.createElement('button');
      tbtn.type = 'button';
      tbtn.className = 'book-toc-open';
      tbtn.setAttribute('aria-label', '目录');
      tbtn.setAttribute('title', '目录');
      tbtn.innerHTML = '<span class="toc-ico" aria-hidden="true">☰</span><span>目录</span>';
      tbtn.addEventListener('click', openToc);
      if (slot.li) {
        var li1 = D.createElement('li');
        li1.appendChild(tbtn);
        slot.node.appendChild(li1);
      } else {
        slot.node.appendChild(tbtn);
      }
    }

    /* 设置：沿用 .theme-toggle 这个类，位置与圆钮外观直接复用全站样式；
       common.js 的 injectThemeToggle 看到已有 .theme-toggle 就不会再造一颗。 */
    if (!D.querySelector('.theme-toggle')) {
      var sbtn = D.createElement('button');
      sbtn.type = 'button';
      sbtn.className = 'theme-toggle settings-btn';
      sbtn.setAttribute('data-settings', '1');
      sbtn.setAttribute('aria-label', '设置');
      sbtn.setAttribute('title', '设置：主题 / 动效 / 字号');
      sbtn.textContent = '⚙';
      sbtn.addEventListener('click', openSettings);
      if (slot.li) {
        var li2 = D.createElement('li');
        li2.appendChild(sbtn);
        slot.node.appendChild(li2);
      } else {
        slot.node.appendChild(sbtn);
      }
    } else {
      /* 万一别的脚本先造了一颗，也把它改成「打开设置」 */
      D.querySelectorAll('.theme-toggle').forEach(function (b) {
        if (b.getAttribute('data-settings') === '1') {
          if (!b._zmSetBound) { b._zmSetBound = 1; b.addEventListener('click', openSettings); }
          return;
        }
      });
    }
  }

  /* ============================================================
     9. 启动
     ============================================================ */
  function boot() {
    readPrefs();
    migrateLegacyTheme();
    applyAll();

    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onScheme = function () { if (PREFS.theme === 'auto') applyThemePref(); };
      if (mq.addEventListener) mq.addEventListener('change', onScheme);
      else if (mq.addListener) mq.addListener(onScheme);
    }

    /* ESC：先关设置，再关目录 */
    D.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (setEl && !setEl.hidden) { closeSettings(); return; }
      closeToc();
    });

    buildChapterBlock();
    var acts = numberActs();
    buildMarker(acts);
    injectButtons();

    var marker = D.querySelector('.chapter-marker');
    if (marker) marker.addEventListener('click', openToc);
  }

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
