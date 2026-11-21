/* ============================================================
   织雾满穗 · 书卷层（book.js）
   ------------------------------------------------------------
   把整站按「一本书」摆。文件按「工具 → 偏好 → 书 → 章 → 目录 →
   设置 → 导航 → 键盘 → 启动」排，新增功能照着段落下手即可。

   模块
     0  小工具        $ / $$ / el / 读写存储 / 汉字数字 / 浮层开关
     1  阅读偏好      主题、动效、宣纸颗粒、字号（存 zm_prefs）
     2  书的结构      章表 CHAPTERS、目录 TOC、当前页、读到哪
     3  章            题签 / 幕号 / 章末翻章 / 页脚藏书印 / 返回第一章
     4  目录抽屉
     5  设置面板
     6  导航按钮      目录 + 设置
     7  键盘          ← → 翻章、T 目录、Esc 关闭
     8  启动

   约定
     · 只用原生 DOM，ES5 写法（与 js/common.js 保持一致），不引依赖；
     · 动效只碰 transform / opacity；滚动只用 IntersectionObserver，
       不挂 scroll 监听；
     · 浮层（目录 / 设置）点开才建 DOM，首屏不多一个节点；
     · 所有文案集中在「章表 / 目录表 / SETTING_ROWS」，改字不用翻逻辑。

   回退：删掉本文件与各页的 <script src="js/book.js" defer>，
   再 git checkout -- css/style.css js/common.js。
   ============================================================ */
(function () {
  'use strict';

  /* ============================================================
     0. 小工具
     ============================================================ */
  var D = document;
  var root = D.documentElement;

  function $(sel, ctx) { return (ctx || D).querySelector(sel); }
  function $$(sel, ctx) { return (ctx || D).querySelectorAll(sel); }

  /* 建节点：el('span', 'bc-title', '雾起') */
  function el(tag, cls, html) {
    var node = D.createElement(tag);
    if (cls) node.className = cls;
    if (html != null) node.innerHTML = html;
    return node;
  }

  /* 读写 localStorage：store(k) 读、store(k, v) 写、store(k, null) 删。
     隐私模式下读不到/写不进也不抛错，页面照常。 */
  function store(key, val) {
    try {
      if (arguments.length === 1) return localStorage.getItem(key);
      if (val === null) localStorage.removeItem(key);
      else localStorage.setItem(key, val);
    } catch (e) {}
    return null;
  }

  /* 浮层：先显示再加 .open，才有过渡；关的时候等动画完再 hidden */
  function openLayer(node) {
    if (!node) return;
    node.hidden = false;
    requestAnimationFrame(function () { node.classList.add('open'); });
  }
  function closeLayer(node, ms) {
    if (!node || node.hidden) return;
    node.classList.remove('open');
    setTimeout(function () {
      if (!node.classList.contains('open')) node.hidden = true;
    }, ms);
  }

  /* 数字转汉字：只到 99，够用于「第一章 / 第几幕」 */
  function han(n) {
    var s = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    if (n <= 10) return s[n];
    if (n < 20) return '十' + s[n - 10];
    return String(n);
  }

  /* ============================================================
     1. 阅读偏好
     ============================================================ */
  var PREF_KEY = 'zm_prefs';
  var THEME_KEY = 'zm_theme';

  /* 默认值：跟随系统 + 完整动效 + 宣纸颗粒 + 标准字号 */
  var PREFS = { theme: 'auto', fx: 'full', texture: 'on', font: 'std' };

  /* 合法值表：既能校验读进来的数据，也方便以后加一项 */
  var PREFS_VALID = {
    theme: ['light', 'dark', 'auto'],
    fx: ['full', 'lite', 'off'],
    texture: ['on', 'off'],
    font: ['std', 'lg']
  };

  function readPrefs() {
    var raw = store(PREF_KEY);
    if (!raw) return;
    var p;
    try { p = JSON.parse(raw); } catch (e) { return; }
    if (!p || typeof p !== 'object') return;
    Object.keys(PREFS_VALID).forEach(function (k) {
      if (PREFS_VALID[k].indexOf(p[k]) >= 0) PREFS[k] = p[k];
    });
  }

  function savePrefs() { store(PREF_KEY, JSON.stringify(PREFS)); }

  function resetPrefs() {
    PREFS.theme = 'auto';
    PREFS.fx = 'full';
    PREFS.texture = 'on';
    PREFS.font = 'std';
    savePrefs();
    applyPrefs();
  }

  /* 老访客迁移：以前只有 zm_theme（小太阳写的），没有 zm_prefs。
     只认新 key 的话，这些人会被当成「没选过」而回落系统主题 ——
     等于把他们的选择弄丢了。第一次见到旧 key 就顺手记进新偏好。 */
  function migrateLegacyTheme() {
    if (store(PREF_KEY)) return;
    var old = store(THEME_KEY);
    if (old === 'light' || old === 'dark') {
      PREFS.theme = old;
      savePrefs();
    }
  }

  function systemDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  /* 主题：auto 时把 zm_theme 清掉，让各页 <head> 的内联脚本按系统走；
     选亮/暗则写两份（localStorage + cookie），手机上的怪毛病也是这么修的。 */
  function applyTheme() {
    var t = PREFS.theme;
    if (t === 'auto') {
      store(THEME_KEY, null);
      try { D.cookie = THEME_KEY + '=; path=/; max-age=0; SameSite=Lax'; } catch (e) {}
      t = systemDark() ? 'dark' : 'light';
    } else {
      store(THEME_KEY, t);
      try { D.cookie = THEME_KEY + '=' + t + '; path=/; max-age=31536000; SameSite=Lax'; } catch (e) {}
    }
    root.setAttribute('data-theme', t);
    root.style.colorScheme = t;
    var meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#14110E' : '#F5F0E6');
  }

  /* 动效档位：full 摘掉 lite，lite/off 挂上（粒子层与持续动画都靠这个类关掉）；
     同时告诉 common.js「用户手动选过」，别再按设备自动降级覆盖。 */
  function applyFx() {
    root.setAttribute('data-fx', PREFS.fx);
    root.classList.toggle('lite', PREFS.fx !== 'full');
    window.__ZM_FX_LOCK = PREFS.fx;
  }

  function applyLook() {
    root.setAttribute('data-texture', PREFS.texture);
    root.setAttribute('data-font', PREFS.font);
  }

  function applyPrefs() {
    applyTheme();
    applyFx();
    applyLook();
  }

  /* ============================================================
     2. 书的结构
     ============================================================ */

  /* 本地是 file:// 或 xxx.html 预览时，链接要带 .html；
     线上走 Cloudflare Pages 的干净 URL，不带后缀。 */
  var IS_FILE = /\.html?$/i.test(location.pathname);

  /* 页脚的「藏书印」用它。改版本时和 data/updates.json 一起改。 */
  var BOOK_VERSION = '3.6.0';

  /* 章表：key = 文件名（不含扩展名）。加一章 = 这里加一条 + TOC 加一行。 */
  var CHAPTERS = {
    'index': { no: '第一章', seal: '一', title: '雾起', note: '开篇 · 一个小而认真的个人站点' },
    'roblox_music': { no: '第二章', seal: '二', title: '拾穗', note: '宝库 · 游戏里能用的音乐与音效' },
    'law': { no: '第三章', seal: '三', title: '立规', note: '法度 · 与音乐使用有关的条文' },
    'thanks': { no: '第四章', seal: '四', title: '结草', note: '鸣谢 · 这本书靠谁撑着' },
    'support': { no: '第五章', seal: '五', title: '投桃', note: '登记 · 赞助与回礼' },
    'admin': { no: '案牍', seal: '案', title: '掌灯', note: '后台 · 替人守夜的地方' },
    '404': { no: '外篇', seal: '外', title: '迷途', note: '雾里的岔路' }
  };

  /* 目录只列公开的五章；后台不进目录。顺序 = 翻章顺序 = 目录顺序。 */
  var TOC = [
    { file: '', key: 'index' },
    { file: 'roblox_music.html', key: 'roblox_music' },
    { file: 'law.html', key: 'law' },
    { file: 'thanks.html', key: 'thanks' },
    { file: 'support.html', key: 'support' }
  ];

  function currentKey() {
    var seg = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    seg = seg.replace(/\.html?$/i, '');
    return seg || 'index';
  }

  function hrefFor(file) {
    if (!file) return IS_FILE ? 'index.html' : './';
    return IS_FILE ? file : file.replace(/\.html?$/i, '');
  }

  var CURRENT = currentKey();
  var CH = CHAPTERS[CURRENT] || null;

  /* 读到哪了：只记「哪一章、第几幕」。下次开目录时，那一章会多标一行。 */
  var READ_KEY = 'zm_read';
  var LAST_READ = { page: '', act: 0 };

  function readLastRead() {
    var raw = store(READ_KEY);
    if (!raw) return;
    var r;
    try { r = JSON.parse(raw); } catch (e) { return; }
    if (!r || typeof r !== 'object') return;
    if (typeof r.page === 'string') LAST_READ.page = r.page;
    if (typeof r.act === 'number') LAST_READ.act = r.act;
  }

  function saveLastRead() { store(READ_KEY, JSON.stringify(LAST_READ)); }

  /* ============================================================
     3. 章：题签 / 幕号 / 翻章 / 藏书印 / 返回第一章
     ============================================================ */

  /* 题签内部结构，普通页与后台共用一套 */
  function chapterInner() {
    return '<span class="bc-seal" aria-hidden="true">' + CH.seal + '</span>' +
      '<span class="bc-body">' +
        '<span class="bc-no">' + CH.no + '</span>' +
        '<span class="bc-title">' + CH.title + '</span>' +
        '<span class="bc-note">' + CH.note + '</span>' +
      '</span>';
  }

  function buildChapterBar() {
    if (!CH) return;
    var existing = $('.book-chapter');
    if (existing) return;

    var bar = el('header', 'book-chapter', chapterInner());
    bar.setAttribute('aria-label', '章节');

    /* 后台没有 <main>：题签插在顶栏下面，别把工具条顶下去 */
    var main = D.getElementById('main') || $('main');
    var adminTop = $('.admin-topbar');
    if (!main && adminTop) {
      bar.className = 'book-chapter is-admin';
      adminTop.insertAdjacentElement('afterend', bar);
      return;
    }
    if (!main) return;
    main.insertBefore(bar, main.firstChild);
  }

  /* 幕号：正文里每个 .section-head 依次加「第一幕」；加 data-no-act 可跳过 */
  function numberActs() {
    var list = [];
    $$('main .section-head').forEach(function (head) {
      if (head.closest('.modal') || head.hasAttribute('data-no-act')) return;
      if (!head.querySelector('h1, h2') || head.querySelector('.act-no')) return;
      var tag = el('span', 'act-no', '第' + han(list.length + 1) + '幕');
      tag.setAttribute('aria-hidden', 'true');
      head.insertBefore(tag, head.firstChild);
      list.push(head);
    });
    return list;
  }

  /* 章末翻章：没有上一章 / 下一章时给灰字，不造假链接 */
  function buildPager() {
    if (!CH || CURRENT === 'admin') return;
    var main = D.getElementById('main') || $('main');
    if (!main || $('.book-pager')) return;

    var idx = -1;
    TOC.forEach(function (it, i) { if (it.key === CURRENT) idx = i; });
    if (idx < 0) return;

    function jump(it, cls, empty) {
      if (!it) return '<span class="bp-void">' + empty + '</span>';
      var c = CHAPTERS[it.key];
      if (!c) return '';
      var text = cls === 'bp-prev' ? '← 上一章 · ' + c.title : '下一章 · ' + c.title + ' →';
      return '<a class="' + cls + '" href="' + hrefFor(it.file) + '">' + text + '</a>';
    }

    var nav = el('nav', 'book-pager',
      jump(TOC[idx - 1], 'bp-prev', '已是卷首') +
      '<button type="button" class="bp-toc">目录</button>' +
      jump(TOC[idx + 1], 'bp-next', '已至卷末')
    );
    nav.setAttribute('aria-label', '翻章');
    main.appendChild(nav);

    var tocBtn = $('.bp-toc', nav);
    if (tocBtn) tocBtn.addEventListener('click', openToc);

    /* 键盘 ← / → 用这两个地址 */
    PAGER.prev = TOC[idx - 1] ? hrefFor(TOC[idx - 1].file) : '';
    PAGER.next = TOC[idx + 1] ? hrefFor(TOC[idx + 1].file) : '';
  }

  /* 页脚藏书印：一句「全书五章 · 第 3.x 版」 */
  function buildColophon() {
    var footer = $('.footer');
    if (!footer || $('.book-colophon', footer)) return;
    footer.appendChild(el('p', 'book-colophon',
      '<span class="cc-seal" aria-hidden="true">穗</span>' +
      '<span class="cc-text">全书五章 · 第 ' + BOOK_VERSION + ' 版</span>'
    ));
  }

  var PAGER = { prev: '', next: '' };

  /* 读到第几幕：只记不发。目录里那行「上次读到第 N 幕」靠它。
     一个 IntersectionObserver 盯住板块标题，不做任何 scroll 计算。 */
  function trackReading(acts) {
    if (!acts.length || !('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var idx = acts.indexOf(en.target);
        if (idx < 0) return;
        LAST_READ.page = CURRENT;
        LAST_READ.act = idx + 1;
        saveLastRead();
      });
    }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });
    acts.forEach(function (node) { io.observe(node); });
  }

  /* 左下角「← 返回第一章」：不在第一页、也不在后台时出现 */
  function buildBackLink() {
    if (!CH || CURRENT === 'index' || CURRENT === 'admin') return;
    var a = el('a', 'chapter-back',
      '<span class="cb-ico" aria-hidden="true">←</span>返回第一章 · 雾起'
    );
    a.href = hrefFor('');
    a.setAttribute('title', '回到第一章 · 雾起');
    D.body.appendChild(a);
  }

  /* ============================================================
     4. 目录抽屉
     ============================================================ */
  var tocEl = null;

  function tocRow(it) {
    var ch = CHAPTERS[it.key];
    if (!ch) return '';

    var isNow = it.key === CURRENT;
    var last = '';
    if (LAST_READ.page === it.key && LAST_READ.act > 0) {
      last = '<span class="bt-last">上次读到第 ' + han(LAST_READ.act) + ' 幕</span>';
    }

    return '<li>' +
      '<a class="bt-row' + (isNow ? ' is-now' : '') + '" href="' + hrefFor(it.file) + '"' +
        (isNow ? ' aria-current="page"' : '') + '>' +
        '<span class="bt-no">' + ch.no + '</span>' +
        '<span class="bt-title">' + ch.title + '</span>' +
        '<span class="bt-note">' + ch.note + last + '</span>' +
      '</a>' +
    '</li>';
  }

  function buildToc() {
    if (tocEl) return tocEl;

    tocEl = el('div', 'book-toc',
      '<div class="bt-scrim" data-toc-close></div>' +
      '<aside class="bt-panel" role="dialog" aria-modal="true" aria-label="目录">' +
        '<div class="bt-head">' +
          '<span class="bt-kicker">织雾满穗</span>' +
          '<h2 class="bt-h">目录</h2>' +
          '<button type="button" class="bt-x" data-toc-close aria-label="关闭目录">×</button>' +
        '</div>' +
        '<ol class="bt-list">' + TOC.map(tocRow).join('') + '</ol>' +
        '<p class="bt-foot">全书五章 · 读到哪一章，左上角的印会告诉你</p>' +
      '</aside>'
    );
    tocEl.hidden = true;
    D.body.appendChild(tocEl);

    tocEl.addEventListener('click', function (e) {
      if (e.target.closest('[data-toc-close]')) closeToc();
    });
    return tocEl;
  }

  function openToc() {
    buildToc();
    openLayer(tocEl);
    root.classList.add('toc-open');
    var first = $('.bt-row', tocEl);
    if (first && first.focus) first.focus({ preventScroll: true });
  }

  function closeToc() {
    closeLayer(tocEl, 240);
    root.classList.remove('toc-open');
  }

  /* ============================================================
     5. 设置面板
     ============================================================ */

  /* 一行 = 一个开关：key 进 PREFS，opts 是 [值, 标签]，demo 选小样 */
  var SETTING_ROWS = [
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

  /* 每行右边的小样：直接反映当前真实状态（CSS 用 html 上的属性判断） */
  function demoHtml(kind) {
    if (kind === 'theme') return '<span class="dm-paper"></span><span class="dm-ink"></span>';
    if (kind === 'fx') return '<span class="dm-fx"><i></i><i></i><i></i></span>';
    if (kind === 'texture') return '<span class="dm-tex"></span>';
    return '<span class="dm-font">字</span>';
  }

  function settingRow(r) {
    var opts = r.opts.map(function (o) {
      var on = PREFS[r.key] === o[0];
      return '<button type="button" class="set-opt' + (on ? ' is-on' : '') + '"' +
        ' data-set-key="' + r.key + '" data-set-val="' + o[0] + '"' +
        ' aria-pressed="' + (on ? 'true' : 'false') + '">' + o[1] + '</button>';
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

    setEl = el('div', 'set-overlay',
      '<div class="set-scrim" data-set-close></div>' +
      '<div class="set-sheet" role="dialog" aria-modal="true" aria-label="设置">' +
        '<div class="set-head">' +
          '<div>' +
            '<p class="set-kicker">织雾满穗 · 阅读设置</p>' +
            '<h2 class="set-title">怎么读这本书</h2>' +
          '</div>' +
          '<button type="button" class="set-x" data-set-close aria-label="关闭设置">×</button>' +
        '</div>' +
        '<div class="set-body">' + SETTING_ROWS.map(settingRow).join('') + '</div>' +
        '<div class="set-foot">' +
          '<p>设置只存在你这台设备的浏览器里，换个设备要重新选一次。</p>' +
          '<p class="set-keys">键盘：← → 翻章 · T 目录 · Esc 关闭</p>' +
          '<button type="button" class="set-reset" data-set-reset>恢复默认</button>' +
        '</div>' +
      '</div>'
    );
    setEl.hidden = true;
    D.body.appendChild(setEl);

    setEl.addEventListener('click', function (e) {
      if (e.target.closest('[data-set-reset]')) { resetPrefs(); syncSettings(); return; }
      if (e.target.closest('[data-set-close]')) { closeSettings(); return; }

      var opt = e.target.closest('.set-opt');
      if (!opt) return;
      var key = opt.getAttribute('data-set-key');
      var val = opt.getAttribute('data-set-val');
      if (!key || !val) return;

      PREFS[key] = val;
      savePrefs();
      applyPrefs();
      syncSettings();
      /* 主题换完重排一次：部分手机浏览器只改变量时会「只变一半」 */
      if (key === 'theme') void D.body.offsetHeight;
    });
    return setEl;
  }

  function syncSettings() {
    if (!setEl) return;
    SETTING_ROWS.forEach(function (r) {
      var row = $('[data-row="' + r.key + '"]', setEl);
      if (!row) return;
      $$('.set-opt', row).forEach(function (b) {
        var on = b.getAttribute('data-set-val') === PREFS[r.key];
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    });
  }

  function openSettings() {
    buildSettings();
    syncSettings();
    openLayer(setEl);
    root.classList.add('set-open');
    var first = $('.set-opt.is-on', setEl) || $('.set-opt', setEl);
    if (first && first.focus) first.focus({ preventScroll: true });
  }

  function closeSettings() {
    closeLayer(setEl, 220);
    root.classList.remove('set-open');
  }

  /* ============================================================
     6. 导航按钮：目录 + 设置
     ============================================================ */
  function navSlot() {
    var nav = $('.navbar .nav-links');
    if (nav) return { node: nav, li: true };
    var admin = $('.admin-topbar .actions');
    if (admin) return { node: admin, li: false };
    /* 宝库页没有 navbar，只有一个 [data-theme-slot] 落点（common.js 也认这个） */
    var slot = $('[data-theme-slot]');
    if (slot) return { node: slot, li: false };
    return null;
  }

  function addToSlot(slot, node) {
    if (slot.li) {
      var li = D.createElement('li');
      li.appendChild(node);
      slot.node.appendChild(li);
    } else {
      slot.node.appendChild(node);
    }
  }

  function injectButtons() {
    var slot = navSlot();
    if (!slot) return;

    /* 有了「目录」，导航栏就不再重复「首页 / 鸣谢 / 法律」：
       清空后只放 目录 + 设置，品牌 logo 本身就是回首页的入口。
       渐进增强 —— JS 没跑起来时旧链接还在，不会走丢。 */
    if (slot.li) slot.node.innerHTML = '';

    /* 目录：后台是干活的地方，不放 */
    if (CURRENT !== 'admin' && !$('.book-toc-open')) {
      var tocBtn = el('button', 'book-toc-open',
        '<span class="toc-ico" aria-hidden="true">☰</span><span>目录</span>'
      );
      tocBtn.type = 'button';
      tocBtn.setAttribute('aria-label', '目录');
      tocBtn.setAttribute('title', '目录');
      tocBtn.addEventListener('click', openToc);
      addToSlot(slot, tocBtn);
    }

    /* 设置：沿用 .theme-toggle 类复用全站圆钮样式；
       common.js 的 injectThemeToggle 看到已有 .theme-toggle 就不会再造一颗。
       万一别的脚本先造了，也把它改成「打开设置」。 */
    var existing = $('.theme-toggle');
    if (existing && existing.getAttribute('data-settings') === '1') {
      if (!existing._zmSettingsBound) {
        existing._zmSettingsBound = true;
        existing.addEventListener('click', openSettings);
      }
      return;
    }
    if (existing) return;

    var setBtn = el('button', 'theme-toggle settings-btn', '⚙');
    setBtn.type = 'button';
    setBtn.setAttribute('data-settings', '1');
    setBtn.setAttribute('aria-label', '设置');
    setBtn.setAttribute('title', '设置：主题 / 动效 / 字号');
    setBtn._zmSettingsBound = true;
    setBtn.addEventListener('click', openSettings);
    addToSlot(slot, setBtn);
  }

  /* ============================================================
     7. 键盘：← → 翻章、T 目录、Esc 关闭
     ============================================================ */
  function bindKeys() {
    D.addEventListener('keydown', function (e) {
      /* Esc：先关设置，再关目录 */
      if (e.key === 'Escape') {
        if (setEl && !setEl.hidden) { closeSettings(); return; }
        closeToc();
        return;
      }

      /* 输入框打字、按着修饰键、开着设置时都不抢键 */
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
                t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (setEl && !setEl.hidden) return;

      if (e.key === 'ArrowLeft') {
        if (PAGER.prev) location.href = PAGER.prev;
      } else if (e.key === 'ArrowRight') {
        if (PAGER.next) location.href = PAGER.next;
      } else if ((e.key === 't' || e.key === 'T') && CURRENT !== 'admin') {
        if (tocEl && !tocEl.hidden) closeToc(); else openToc();
      }
    });
  }

  /* ============================================================
     8. 启动
     ============================================================ */
  function boot() {
    readPrefs();
    migrateLegacyTheme();
    readLastRead();
    applyPrefs();

    /* 系统主题变了：只有「跟随」模式才跟着变 */
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onScheme = function () { if (PREFS.theme === 'auto') applyTheme(); };
      if (mq.addEventListener) mq.addEventListener('change', onScheme);
      else if (mq.addListener) mq.addListener(onScheme);
    }

    bindKeys();

    buildChapterBar();
    trackReading(numberActs());
    buildBackLink();
    injectButtons();
    buildPager();
    buildColophon();
  }

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
