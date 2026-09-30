/* ============================================================
 * 音乐 ID 抓取器（控制台版 / Console Grabber）  v1.0
 * ------------------------------------------------------------
 * 用法：在目标网页按 F12 打开开发者工具 → Console → 粘贴本文件
 *      全部内容 → 回车（首次需先输入 allow pasting 再回车）
 *
 * 说明：
 *   - 数据只存在你自己浏览器的 localStorage 里，不会上传到任何地方
 *   - 不读取密码、不读取 cookie、不修改网页内容
 *   - 关掉页面/清空浏览器数据即消失；面板里有「清空」按钮
 *   - 不依赖任何第三方库，不联网（除了「自动翻页」去取同一个站点的下一页）
 * ============================================================ */
(function () {
  'use strict';

  var ID_MIN = 6, ID_MAX = 12;
  var ID_SRC = '\\b\\d{6,12}\\b';
  var STORE_PREFIX = 'midgrab:';

  /* ================= 纯逻辑区（浏览器 / node 都能跑，可单测） ================= */

  // 判断一个数字串像不像素材 ID（尽量少误伤、少漏抓）
  function okNumber(num, line, strict) {
    if (!/^\d+$/.test(num)) return false;
    if (num.length < ID_MIN || num.length > ID_MAX) return false;
    if (/^1[3-9]\d{9}$/.test(num)) return false;               // 手机号
    if (/^(19|20)\d{2}[01]\d[0-3]\d$/.test(num)) return false; // 20240315 这种日期
    if (!strict) return true;
    var i = line.indexOf(num);
    var around = line.slice(Math.max(0, i - 4), i + num.length + 4);
    if (/(万|次|赞|播放|阅读|关注|粉丝|评论|回复|积分|经验|金币|小时|分钟|秒|天前|个月前|年前|楼)/.test(around)) return false;
    return true;
  }

  // 从一行文字里抠出 {id, name}
  function extractFromLine(line, strict) {
    var out = [];
    if (!line || line.length > 400) return out;
    var re = new RegExp(ID_SRC, 'g'), m, ids = [];
    while ((m = re.exec(line)) !== null) {
      if (okNumber(m[0], line, strict)) ids.push(m[0]);
    }
    if (!ids.length) return out;

    var name = line
      .replace(new RegExp(ID_SRC, 'g'), ' ')
      .replace(/[|｜,，、:：;；\-–—_()（）\[\]【】<>《》]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (/^https?:\/\//i.test(name)) name = '';
    name = name.slice(0, 60);

    for (var k = 0; k < ids.length; k++) out.push({ id: ids[k], name: name });
    return out;
  }

  // 一组行 → 去重后的 [{id, name}]（同名 ID 保留更长的那个名字）
  function extractFromLines(lines, strict) {
    var map = {}, i, j, h, cur;
    for (i = 0; i < lines.length; i++) {
      var hits = extractFromLine(lines[i], strict);
      for (j = 0; j < hits.length; j++) {
        h = hits[j];
        cur = map[h.id];
        if (!cur || (h.name && h.name.length > (cur.name || '').length)) map[h.id] = h;
      }
    }
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  // 识别 URL 里的翻页参数；识别不到就返回 null
  function detectPager(href) {
    var u;
    try { u = new URL(href); } catch (e) { return null; }
    var sp = u.searchParams;

    if (sp.has('pn')) {
      var v = parseInt(sp.get('pn'), 10);
      if (isNaN(v) || v < 0) v = 0;
      // 贴吧两种情况：吧列表 pn=0/50/100（步长 50）；帖子页 pn=1/2/3（步长 1）
      return { key: 'pn', base: v, step: (v % 50 === 0) ? 50 : 1 };
    }
    var keys = [['page', 1], ['pageNo', 1], ['pageNum', 1], ['p', 1], ['offset', 20], ['start', 20]];
    for (var i = 0; i < keys.length; i++) {
      if (sp.has(keys[i][0])) {
        var b = parseInt(sp.get(keys[i][0]), 10);
        if (isNaN(b)) b = 0;
        return { key: keys[i][0], base: b, step: keys[i][1] };
      }
    }
    return null;
  }

  // index 从 0 开始：0 = 当前这一页的 URL
  function buildPageUrl(href, cfg, index) {
    var u = new URL(href);
    u.searchParams.set(cfg.key, String(cfg.base + cfg.step * index));
    return u.toString();
  }

  var PURE = {
    okNumber: okNumber,
    extractFromLine: extractFromLine,
    extractFromLines: extractFromLines,
    detectPager: detectPager,
    buildPageUrl: buildPageUrl
  };

  /* ============================ 浏览器部分 ============================ */

  function boot() {
    if (document.getElementById('__mid_grabber__')) {
      document.getElementById('__mid_grabber__').remove();   // 重复粘贴 = 重置面板，数据保留
    }

    var KEY = STORE_PREFIX + location.host;
    var data = loadData();
    var running = false;
    var followTimer = null;
    var strict = true;

    function loadData() {
      try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; }
    }
    function saveData() {
      try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
    }
    function total() { return Object.keys(data).length; }

    /* ---------- 把一页 DOM 变成一行行文字 ---------- */
    function linesOf(root) {
      // 注意：document.cloneNode(true) 拿到的是没有子节点的空文档，
      // 所以必须先落到 body（或 documentElement）再克隆。
      var src = root.body || root.documentElement || root;
      var c = src.cloneNode(true);
      var doc = c.ownerDocument || document;
      var kill = c.querySelectorAll('script,style,noscript,template,iframe');
      for (var i = 0; i < kill.length; i++) kill[i].remove();
      var brs = c.querySelectorAll('br');
      for (var j = 0; j < brs.length; j++) brs[j].replaceWith('\n');
      var blocks = c.querySelectorAll('p,div,li,tr,h1,h2,h3,h4,h5,dt,dd,section,article,pre,blockquote');
      for (var k = 0; k < blocks.length; k++) blocks[k].appendChild(doc.createTextNode('\n'));
      return (c.textContent || '').split('\n')
        .map(function (s) { return s.replace(/\s+/g, ' ').trim(); })
        .filter(Boolean);
    }

    /* ---------- 抓一页 ---------- */
    function harvest(root, url, pageNo) {
      var hits = extractFromLines(linesOf(root), strict);

      // 顺带把 /library/数字 这种链接也算进来
      var as = root.querySelectorAll('a[href*="/library/"]');
      for (var i = 0; i < as.length; i++) {
        var m = (as[i].getAttribute('href') || '').match(/library\/(\d{6,12})/);
        if (m) hits.push({ id: m[1], name: (as[i].textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) });
      }

      var now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      var added = 0;
      for (var j = 0; j < hits.length; j++) {
        var h = hits[j];
        if (!data[h.id]) {
          added++;
          data[h.id] = { id: h.id, name: h.name || '', url: url, page: pageNo, ts: now };
        } else if (h.name && h.name.length > (data[h.id].name || '').length) {
          data[h.id].name = h.name;
        }
      }
      saveData();
      return added;
    }

    /* ---------- 导出 CSV ---------- */
    function exportCsv() {
      var keys = Object.keys(data);
      if (!keys.length) { setStatus('还没有数据，先抓一页或开跟随模式'); return; }
      var rows = [['ID', '歌名/上下文', '来源URL', '页号', '抓取时间']];
      keys.forEach(function (k) {
        var d = data[k];
        rows.push([d.id, d.name || '', d.url || '', d.page || '', d.ts || '']);
      });
      var csv = rows.map(function (r) {
        return r.map(function (c) {
          return '"' + String(c === null || c === undefined ? '' : c).replace(/"/g, '""') + '"';
        }).join(',');
      }).join('\r\n');

      var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'music-ids-' + location.host.replace(/[^\w.-]/g, '') + '-' + Date.now() + '.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
      setStatus('已导出 ' + keys.length + ' 条 → 去「下载」文件夹看 CSV');
    }

    /* ---------- 自动翻页 ---------- */
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    function autoPages() {
      if (running) { setStatus('正在跑，别重复点'); return; }
      var cfg = detectPager(location.href);
      if (!cfg) {
        setStatus('本页没识别到翻页参数 → 请改用「跟随模式」，自己翻页我自动记');
        return;
      }
      running = true;
      var MAX = 200, i = 0, emptyStreak = 0;

      (async function () {
        while (running && i < MAX) {
          i++;
          var url = (i === 1) ? location.href : buildPageUrl(location.href, cfg, i - 1);
          var root = null;

          if (i === 1) {
            root = document;
          } else {
            var html = null;
            try {
              var res = await fetch(url, { credentials: 'include' });
              if (res && res.ok) html = await res.text();
            } catch (e) { html = null; }
            if (html === null) { setStatus('第 ' + i + ' 页请求失败，已停止（共 ' + total() + ' 条）'); break; }
            if (/安全验证|请输入验证码|访问过于频繁|操作太频繁|Security Verification|captcha/i.test(html.slice(0, 5000))) {
              setStatus('第 ' + i + ' 页被要求验证 → 已停止。请改用「跟随模式」自己翻页');
              break;
            }
            root = new DOMParser().parseFromString(html, 'text/html');
          }

          var added = harvest(root, url, i);
          emptyStreak = added === 0 ? emptyStreak + 1 : 0;
          setStatus('第 ' + i + ' 页：新增 ' + added + ' 条，累计 ' + total() + ' 条');
          if (emptyStreak >= 3) { setStatus('连续 3 页没新 ID，已停（累计 ' + total() + ' 条）'); break; }

          await sleep(1200 + Math.random() * 800);   // 慢一点，别把人家站点搞崩
        }
        running = false;
      })();
    }

    /* ---------- 跟随模式（适合滚动加载的页面） ---------- */
    function toggleFollow() {
      if (followTimer) {
        clearInterval(followTimer); followTimer = null;
        setStatus('跟随模式已停，累计 ' + total() + ' 条');
        return;
      }
      harvest(document, location.href, 0);
      setStatus('跟随模式已开：你正常滚动/翻页，我每 2.5 秒自动记一次');
      followTimer = setInterval(function () {
        harvest(document, location.href, 0);
        setStatus('跟随中… 已记录 ' + total() + ' 条');
      }, 2500);
    }

    /* ---------- 面板 ---------- */
    var box = document.createElement('div');
    box.id = '__mid_grabber__';
    box.style.cssText = [
      'position:fixed', 'right:14px', 'bottom:14px', 'z-index:2147483647',
      'width:240px', 'padding:11px 12px', 'border-radius:12px',
      'background:#15171c', 'color:#e8e8ea', 'border:1px solid #2b303a',
      'font:12px/1.7 system-ui,"Microsoft YaHei",sans-serif',
      'box-shadow:0 8px 28px rgba(0,0,0,.45)'
    ].join(';');

    var title = document.createElement('div');
    title.textContent = '🎵 音乐ID抓取器';
    title.style.cssText = 'font-weight:600;font-size:13px;margin-bottom:6px';
    box.appendChild(title);

    var stat = document.createElement('div');
    stat.style.cssText = 'min-height:36px;color:#9fd3ff;margin-bottom:8px;word-break:break-all';
    box.appendChild(stat);
    function setStatus(t) { stat.textContent = t; }
    setStatus('已就绪，当前累计 ' + total() + ' 条');

    function mkBtn(label, fn) {
      var b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'display:block;width:100%;margin:4px 0;padding:6px 8px;border-radius:8px;border:1px solid #3a414d;background:#20242c;color:#e8e8ea;font:12px system-ui,"Microsoft YaHei",sans-serif;cursor:pointer';
      b.onmouseenter = function () { b.style.background = '#2a303a'; };
      b.onmouseleave = function () { b.style.background = '#20242c'; };
      b.onclick = fn;
      box.appendChild(b);
      return b;
    }

    mkBtn('① 抓这一页', function () {
      var n = harvest(document, location.href, 0);
      setStatus('本页新增 ' + n + ' 条，累计 ' + total() + ' 条');
    });
    mkBtn('② 自动翻页（列表页用）', autoPages);
    mkBtn('③ 跟随模式（滚动页用）', toggleFollow);
    mkBtn('④ 导出 CSV', exportCsv);
    mkBtn('⑤ 清空全部数据', function () {
      if (confirm('确定清空这 ' + total() + ' 条？')) {
        data = {}; saveData(); setStatus('已清空');
      }
    });

    var chkRow = document.createElement('label');
    chkRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:8px;color:#a8b0bd;cursor:pointer';
    var chk = document.createElement('input');
    chk.type = 'checkbox'; chk.checked = true;
    chk.onchange = function () { strict = chk.checked; setStatus(strict ? '严格模式（过滤点赞/日期等噪声）' : '宽松模式（什么都抓，可能混入噪声）'); };
    chkRow.appendChild(chk);
    chkRow.appendChild(document.createTextNode('过滤噪声（推荐）'));
    box.appendChild(chkRow);

    var close = document.createElement('div');
    close.textContent = '✕ 关闭面板（数据保留）';
    close.style.cssText = 'text-align:center;margin-top:8px;color:#6f7784;cursor:pointer';
    close.onclick = function () {
      if (followTimer) { clearInterval(followTimer); followTimer = null; }
      box.remove();
    };
    box.appendChild(close);

    document.body.appendChild(box);

    window.__MIDG__ = {
      data: data,
      exportCsv: exportCsv,
      harvestNow: function () { return harvest(document, location.href, 0); },
      total: total
    };
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    if (document.body) boot();
    else window.addEventListener('DOMContentLoaded', boot);
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = PURE;
})();
