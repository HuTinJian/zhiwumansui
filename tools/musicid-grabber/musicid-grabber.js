/* ============================================================
 * Music ID Grabber (console edition)  v1.1
 * ------------------------------------------------------------
 * HOW TO USE
 *   1. Open the target page in Chrome / Edge.
 *   2. Press F12 and switch to the Console tab.
 *   3. Type this and press Enter (first time only, Chrome/Edge):
 *          allow pasting
 *   4. Copy this WHOLE file, paste it into the Console, press Enter.
 *
 * WHAT IT DOES
 *   Scans the page text for numeric asset IDs, dedupes them, and can
 *   export everything as a CSV (Excel-friendly, UTF-8 with BOM).
 *
 * SAFETY
 *   - Results live in your own browser localStorage. Nothing is uploaded.
 *   - No password / cookie access, no page modification.
 *   - No third-party library. Only "Auto pages" uses the network, and
 *     only to request the next page of the SAME site you are already on.
 *
 * ENCODING
 *   This file is intentionally pure ASCII. The Chinese noise words used
 *   by the strict filter are written as \uXXXX escapes, so the file stays
 *   ASCII while still matching Chinese text found on real pages.
 * ============================================================ */
(function () {
  'use strict';

  var ID_MIN = 6, ID_MAX = 12;
  var ID_SRC = '\\b\\d{6,12}\\b';
  var STORE_PREFIX = 'midgrab:';

  /* Noise words (escaped, keeps this file ASCII):
     wan ci zan bo fang yue du guan zhu fen si ping lun hui fu
     ji fen jing yan jin bi xiao shi fen zhong miao tian qian
     ge yue nian lou  */
  var NOISE_SRC = '[\\u4e07\\u6b21\\u8d5e\\u64ad\\u653e\\u9605\\u8bfb\\u5173\\u6ce8' +
                  '\\u7c89\\u4e1d\\u8bc4\\u8bba\\u56de\\u590d\\u79ef\\u5206\\u7ecf' +
                  '\\u9a8c\\u91d1\\u5e01\\u5c0f\\u65f6\\u5206\\u949f\\u79d2\\u5929' +
                  '\\u524d\\u4e2a\\u6708\\u5e74\\u697c]';

  /* ============ pure logic (runs in browser AND in node) ============ */

  function okNumber(num, line, strict) {
    if (!/^\d+$/.test(num)) return false;
    if (num.length < ID_MIN || num.length > ID_MAX) return false;
    if (/^1[3-9]\d{9}$/.test(num)) return false;               // phone number
    if (/^(19|20)\d{2}[01]\d[0-3]\d$/.test(num)) return false; // date 20240315
    if (!strict) return true;
    var i = line.indexOf(num);
    var around = line.slice(Math.max(0, i - 4), i + num.length + 4);
    if (new RegExp(NOISE_SRC).test(around)) return false;      // likes / views / floor ...
    return true;
  }

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
      .replace(/[|\uff5c,\uff0c\u3001:\uff1a;\uff1b\-\u2013\u2014_()\uff08\uff09\[\]\u3010\u3011<>\u300a\u300b]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // A bare URL line is not a song name. Note the separators are already gone
    // by now, so "https://..." has become "https //...", hence both patterns.
    if (/^https?:\/\//i.test(line.trim()) || /^https?\s*\/\//i.test(name) || /^www\./i.test(name)) name = '';
    name = name.slice(0, 60);

    for (var k = 0; k < ids.length; k++) out.push({ id: ids[k], name: name });
    return out;
  }

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

  function detectPager(href) {
    var u;
    try { u = new URL(href); } catch (e) { return null; }
    var sp = u.searchParams;

    if (sp.has('pn')) {
      var v = parseInt(sp.get('pn'), 10);
      if (isNaN(v) || v < 0) v = 0;
      // Two common cases: pn=0/50/100 (step 50) vs pn=1/2/3 (step 1)
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

  // index is 0-based: 0 means the URL you are currently on
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
    buildPageUrl: buildPageUrl,
    NOISE_SRC: NOISE_SRC
  };

  /* ========================= browser only ========================= */

  function boot() {
    var old = document.getElementById('__mid_grabber__');
    if (old) old.remove();   // pasting again resets the panel, keeps the data

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
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    /* ---------- DOM -> array of text lines ---------- */
    function linesOf(root) {
      // Note: document.cloneNode(true) returns an EMPTY document (no children),
      // so we must drop to body (or documentElement) before cloning.
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

    /* ---------- grab one page ---------- */
    function harvest(root, url, pageNo) {
      var hits = extractFromLines(linesOf(root), strict);

      // also accept /library/<id> links
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

    /* ---------- export ---------- */
    function exportCsv() {
      var keys = Object.keys(data);
      if (!keys.length) { setStatus('No data yet. Grab a page or start follow mode.'); return; }
      var rows = [['ID', 'Name/Context', 'SourceURL', 'Page', 'CapturedAt']];
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
      setStatus('Exported ' + keys.length + ' rows -> check your Downloads folder');
    }

    /* ---------- auto pagination ---------- */
    function autoPages() {
      if (running) { setStatus('Already running, please wait.'); return; }
      var cfg = detectPager(location.href);
      if (!cfg) {
        setStatus('No paging parameter found -> use Follow mode and scroll manually.');
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
            if (html === null) { setStatus('Page ' + i + ' request failed. Stopped. Total ' + total()); break; }
            if (/Security Verification|captcha|robot|verify you are human/i.test(html.slice(0, 5000))) {
              setStatus('Page ' + i + ' wants verification -> stopped. Use Follow mode instead.');
              break;
            }
            root = new DOMParser().parseFromString(html, 'text/html');
          }

          var added = harvest(root, url, i);
          emptyStreak = added === 0 ? emptyStreak + 1 : 0;
          setStatus('Page ' + i + ': +' + added + ' new, total ' + total());
          if (emptyStreak >= 3) { setStatus('3 empty pages in a row. Stopped. Total ' + total()); break; }

          await sleep(1200 + Math.random() * 800);   // stay polite
        }
        running = false;
      })();
    }

    /* ---------- follow mode (for infinite-scroll pages) ---------- */
    function toggleFollow() {
      if (followTimer) {
        clearInterval(followTimer); followTimer = null;
        setStatus('Follow mode stopped. Total ' + total());
        return;
      }
      harvest(document, location.href, 0);
      setStatus('Follow mode ON: scroll normally, I record every 2.5s.');
      followTimer = setInterval(function () {
        harvest(document, location.href, 0);
        setStatus('Following... recorded ' + total());
      }, 2500);
    }

    /* ---------- panel ---------- */
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
    title.textContent = 'Music ID Grabber v1.1';
    title.style.cssText = 'font-weight:600;font-size:13px;margin-bottom:6px';
    box.appendChild(title);

    var stat = document.createElement('div');
    stat.style.cssText = 'min-height:36px;color:#9fd3ff;margin-bottom:8px;word-break:break-all';
    box.appendChild(stat);
    function setStatus(t) { stat.textContent = t; }
    setStatus('Ready. Total ' + total());

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

    mkBtn('1) Grab this page', function () {
      var n = harvest(document, location.href, 0);
      setStatus('This page: +' + n + ' new, total ' + total());
    });
    mkBtn('2) Auto pages (list pages)', autoPages);
    mkBtn('3) Follow mode (scroll pages)', toggleFollow);
    mkBtn('4) Export CSV', exportCsv);
    mkBtn('5) Clear all data', function () {
      if (confirm('Clear all ' + total() + ' records?')) {
        data = {}; saveData(); setStatus('Cleared.');
      }
    });

    var chkRow = document.createElement('label');
    chkRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:8px;color:#a8b0bd;cursor:pointer';
    var chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = true;
    chk.onchange = function () {
      strict = chk.checked;
      setStatus(strict ? 'Strict mode (filters noise)' : 'Loose mode (grabs everything)');
    };
    chkRow.appendChild(chk);
    chkRow.appendChild(document.createTextNode('Filter noise (recommended)'));
    box.appendChild(chkRow);

    var close = document.createElement('div');
    close.textContent = 'Close panel (keep data)';
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
