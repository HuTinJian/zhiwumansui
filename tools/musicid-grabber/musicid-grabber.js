(function () {
  'use strict';

  var ID_MIN = 6, ID_MAX = 12;
  var ID_SRC = '\\b\\d{6,12}\\b';
  var STORE_PREFIX = 'midgrab:';

  var NOISE_SRC = '[\\u4e07\\u6b21\\u8d5e\\u64ad\\u653e\\u9605\\u8bfb\\u5173\\u6ce8' +
                  '\\u7c89\\u4e1d\\u8bc4\\u8bba\\u56de\\u590d\\u79ef\\u5206\\u7ecf' +
                  '\\u9a8c\\u91d1\\u5e01\\u5c0f\\u65f6\\u5206\\u949f\\u79d2\\u5929' +
                  '\\u524d\\u4e2a\\u6708\\u5e74\\u697c]';

  var TIME_KEY_SRC = '(create_?time|update_?time|modify_?time|post_?time|send_?time|' +
                     'publish_?time|timestamp|ts|ctime|mtime|utime|expire[sd]?|_at|date|time)';

  var ASSET_KEY_SRC = '(asset_?id|audio_?id|music_?id|song_?id|sound_?id|' +
                      'audioid|musicid|assetid|soundid|songid)';

  function okNumber(num, line, strict) {
    if (!/^\d+$/.test(num)) return false;
    if (num.length < ID_MIN || num.length > ID_MAX) return false;
    if (/^1[3-9]\d{9}$/.test(num)) return false;
    if (/^(19|20)\d{2}[01]\d[0-3]\d$/.test(num)) return false;
    if (!strict) return true;
    var i = line.indexOf(num);
    var around = line.slice(Math.max(0, i - 4), i + num.length + 4);
    if (new RegExp(NOISE_SRC).test(around)) return false;
    return true;
  }

  function hasTimeKey(before) {
    return new RegExp(TIME_KEY_SRC + '["\']?\\s*[:=]\\s*["\']?\\s*$', 'i').test(before.slice(-40));
  }

  function hasAssetKey(before) {
    return new RegExp(ASSET_KEY_SRC + '["\']?\\s*[:=]\\s*["\']?\\s*$', 'i').test(before.slice(-40));
  }

  function nameFromContext(ctx) {
    return ctx
      .replace(new RegExp(ID_SRC, 'g'), ' ')
      .replace(/["',:{}[\]\\|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
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
    if (/^https?:\/\//i.test(line.trim()) || /^https?\s*\/\//i.test(name) || /^www\./i.test(name)) name = '';
    name = name.slice(0, 60);

    for (var k = 0; k < ids.length; k++) out.push({ id: ids[k], name: name, key: false });
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

  function extractFromBlob(text, strict) {
    var out = [], seen = {};
    if (!text || typeof text !== 'string') return out;
    var re = new RegExp(ID_SRC, 'g'), m;
    while ((m = re.exec(text)) !== null) {
      var id = m[0], i = m.index;
      if (seen[id]) continue;
      var before = text.slice(Math.max(0, i - 40), i);
      if (hasTimeKey(before)) continue;
      var ctx = text.slice(Math.max(0, i - 80), i + id.length + 80).replace(/\s+/g, ' ');
      if (!okNumber(id, ctx, strict)) continue;
      seen[id] = 1;
      out.push({ id: id, name: nameFromContext(ctx), key: hasAssetKey(before) });
    }
    return out;
  }

  function detectPager(href) {
    var u;
    try { u = new URL(href); } catch (e) { return null; }
    var sp = u.searchParams;

    if (sp.has('pn')) {
      var v = parseInt(sp.get('pn'), 10);
      if (isNaN(v) || v < 0) v = 0;
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

  function buildPageUrl(href, cfg, index) {
    var u = new URL(href);
    u.searchParams.set(cfg.key, String(cfg.base + cfg.step * index));
    return u.toString();
  }

  var PURE = {
    okNumber: okNumber,
    hasTimeKey: hasTimeKey,
    hasAssetKey: hasAssetKey,
    extractFromLine: extractFromLine,
    extractFromLines: extractFromLines,
    extractFromBlob: extractFromBlob,
    detectPager: detectPager,
    buildPageUrl: buildPageUrl,
    NOISE_SRC: NOISE_SRC
  };

  function boot() {
    var old = document.getElementById('__mid_grabber__');
    if (old) old.remove();

    var KEY = STORE_PREFIX + location.host;
    var data = loadData();
    var running = false;
    var followTimer = null;
    var scrollTimer = null;
    var strict = true;
    var sniffOn = true;
    var apiLog = {};
    var jsonCalls = 0;

    function loadData() {
      try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; }
    }
    function saveData() {
      try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
    }
    function total() { return Object.keys(data).length; }
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function now() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
    function absUrl(u) { try { return new URL(u, location.href).href; } catch (e) { return String(u); } }

    function linesOf(root) {
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

    function put(hit, src, url, pageNo) {
      if (!data[hit.id]) {
        data[hit.id] = { id: hit.id, name: hit.name || '', src: src, url: url, page: pageNo, ts: now() };
        return 1;
      }
      if (hit.name && hit.name.length > (data[hit.id].name || '').length) data[hit.id].name = hit.name;
      return 0;
    }

    function harvest(root, url, pageNo) {
      var hits = extractFromLines(linesOf(root), strict);

      var as = root.querySelectorAll('a[href*="/library/"]');
      for (var i = 0; i < as.length; i++) {
        var m = (as[i].getAttribute('href') || '').match(/library\/(\d{6,12})/);
        if (m) hits.push({ id: m[1], name: (as[i].textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60), key: false });
      }

      var added = 0;
      for (var j = 0; j < hits.length; j++) added += put(hits[j], 'page', url, pageNo);
      saveData();
      return added;
    }

    function noteResponse(info) {
      var text = info.text;
      if (!text || typeof text !== 'string') return;
      if (text.length > 400000) text = text.slice(0, 400000);
      jsonCalls++;
      if (!sniffOn) return;

      var hits = extractFromBlob(text, strict);
      var url = absUrl(info.url);
      var path;
      try {
        var u = new URL(url);
        path = (u.protocol === 'data:') ? 'data:url' : u.origin + u.pathname;
      } catch (e) { path = String(info.url).split('?')[0]; }

      var rec = apiLog[path];
      if (!rec) {
        rec = apiLog[path] = { method: info.method, url: url, calls: 0, hits: 0, status: info.status, keyed: 0 };
      }
      rec.calls++;
      rec.status = info.status;
      if (url.length > rec.url.length) rec.url = url;

      if (!hits.length) { saveData(); return; }
      rec.hits += hits.length;
      var added = 0;
      for (var i = 0; i < hits.length; i++) {
        if (hits[i].key) rec.keyed++;
        added += put(hits[i], hits[i].key ? 'api-key' : 'api', url.slice(0, 200), 0);
      }
      saveData();
      if (added) setStatus('Sniffer: +' + added + ' new from ' + info.method + ' ' + path.slice(-40) + ' (total ' + total() + ')');
    }

    function installHooks() {
      if (window.__MIDG_HOOKS__) return;
      window.__MIDG_HOOKS__ = true;

      var origFetch = window.fetch;
      if (typeof origFetch === 'function') {
        window.fetch = function (input, init) {
          var url = (typeof input === 'string') ? input : ((input && input.url) || '');
          var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
          var p = origFetch.apply(this, arguments);
          try {
            p.then(function (res) {
              try {
                var ct = (res.headers && res.headers.get('content-type')) || '';
                if (/json|text|xml|javascript/i.test(ct)) {
                  res.clone().text().then(function (t) {
                    noteResponse({ method: method, url: url, status: res.status, text: t });
                  })['catch'](function () {});
                }
              } catch (e) {}
              return res;
            })['catch'](function () {});
          } catch (e) {}
          return p;
        };
      }

      var XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (m, u) {
        this.__midg = { method: String(m || 'GET').toUpperCase(), url: String(u || '') };
        return XO.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function () {
        var xhr = this;
        try {
          xhr.addEventListener('load', function () {
            try {
              var ct = xhr.getResponseHeader('content-type') || '';
              if (/json|text|xml/i.test(ct)) {
                noteResponse({
                  method: (xhr.__midg && xhr.__midg.method) || 'GET',
                  url: (xhr.__midg && xhr.__midg.url) || '',
                  status: xhr.status,
                  text: xhr.responseText
                });
              }
            } catch (e) {}
          });
        } catch (e) {}
        return XS.apply(this, arguments);
      };
    }

    function apiList() {
      return Object.keys(apiLog)
        .map(function (k) { return apiLog[k]; })
        .sort(function (a, b) { return b.hits - a.hits || b.calls - a.calls; });
    }

    function showApis() {
      var list = apiList();
      if (!list.length) {
        setStatus('No JSON response captured yet. Keep the sniffer ON and scroll.');
        return;
      }
      var lines = list.slice(0, 25).map(function (r) {
        return r.hits + ' ids / ' + r.calls + ' calls / ' + r.status + '  ' + r.method + '  ' + r.url;
      });
      try { console.log('[MIDG] captured endpoints:\n' + lines.join('\n')); } catch (e) {}
      try { if (navigator.clipboard) navigator.clipboard.writeText(lines.join('\n')); } catch (e) {}
      setStatus('Top: ' + list[0].method + ' ' + list[0].url.slice(0, 70) + '  -> ' + list[0].hits +
                ' ids. Full list printed in Console and copied to clipboard.');
    }

    function exportCsv() {
      var keys = Object.keys(data);
      if (!keys.length) { setStatus('No data yet. Grab a page or turn on follow mode.'); return; }
      var rows = [['ID', 'Name/Context', 'Source', 'SourceURL', 'Page', 'CapturedAt']];
      keys.forEach(function (k) {
        var d = data[k];
        rows.push([d.id, d.name || '', d.src || 'page', d.url || '', d.page || '', d.ts || '']);
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

    function autoPages() {
      if (running) { setStatus('Already running, please wait.'); return; }
      var cfg = detectPager(location.href);
      if (!cfg) {
        setStatus('No paging parameter found -> use follow mode or auto-scroll.');
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
              setStatus('Page ' + i + ' wants verification -> stopped. Use follow mode.');
              break;
            }
            root = new DOMParser().parseFromString(html, 'text/html');
          }

          var added = harvest(root, url, i);
          emptyStreak = added === 0 ? emptyStreak + 1 : 0;
          setStatus('Page ' + i + ': +' + added + ' new, total ' + total());
          if (emptyStreak >= 3) { setStatus('3 empty pages in a row. Stopped. Total ' + total()); break; }
          await sleep(1200 + Math.random() * 800);
        }
        running = false;
      })();
    }

    function toggleFollow() {
      if (followTimer) {
        clearInterval(followTimer); followTimer = null;
        setStatus('Follow mode stopped. Total ' + total());
        return;
      }
      harvest(document, location.href, 0);
      setStatus('Follow mode ON: browse normally, I record every 2.5s.');
      followTimer = setInterval(function () {
        harvest(document, location.href, 0);
        setStatus('Following... recorded ' + total());
      }, 2500);
    }

    function toggleAutoScroll() {
      if (scrollTimer) {
        clearInterval(scrollTimer); scrollTimer = null;
        setStatus('Auto-scroll stopped. Total ' + total());
        return;
      }
      var lastH = 0, still = 0, rounds = 0;
      setStatus('Auto-scrolling... keep this tab in front.');
      scrollTimer = setInterval(function () {
        rounds++;
        var h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
        window.scrollBy(0, Math.round((window.innerHeight || 600) * 0.9));
        harvest(document, location.href, 0);
        if (h <= lastH + 5) still++; else still = 0;
        lastH = h;
        setStatus('Auto-scroll round ' + rounds + ': total ' + total());
        if (still >= 5 || rounds >= 400) {
          clearInterval(scrollTimer); scrollTimer = null;
          setStatus('Auto-scroll finished (' + rounds + ' rounds). Total ' + total());
        }
      }, 1600);
    }

    var box = document.createElement('div');
    box.id = '__mid_grabber__';
    box.style.cssText = [
      'position:fixed', 'right:14px', 'bottom:14px', 'z-index:2147483647',
      'width:250px', 'padding:11px 12px', 'border-radius:12px',
      'background:#15171c', 'color:#e8e8ea', 'border:1px solid #2b303a',
      'font:12px/1.7 system-ui,"Microsoft YaHei",sans-serif',
      'box-shadow:0 8px 28px rgba(0,0,0,.45)'
    ].join(';');

    var title = document.createElement('div');
    title.textContent = 'Music ID Grabber v1.3';
    title.style.cssText = 'font-weight:600;font-size:13px;margin-bottom:6px';
    box.appendChild(title);

    var stat = document.createElement('div');
    stat.style.cssText = 'min-height:52px;color:#9fd3ff;margin-bottom:8px;word-break:break-word';
    box.appendChild(stat);
    function setStatus(t) { stat.textContent = t; }
    setStatus('Ready. Sniffer is ON. Total ' + total());

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
    mkBtn('4) Auto-scroll to load all', toggleAutoScroll);
    var sniffBtn = mkBtn('5) Sniffer: ON', function () {
      sniffOn = !sniffOn;
      sniffBtn.textContent = '5) Sniffer: ' + (sniffOn ? 'ON' : 'OFF');
      setStatus(sniffOn ? 'Sniffer ON: every JSON response is scanned.' : 'Sniffer OFF.');
    });
    mkBtn('6) Show captured APIs', showApis);
    mkBtn('7) Export CSV', exportCsv);
    mkBtn('8) Clear all data', function () {
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
      if (scrollTimer) { clearInterval(scrollTimer); scrollTimer = null; }
      box.remove();
    };
    box.appendChild(close);

    document.body.appendChild(box);

    installHooks();

    window.__MIDG__ = {
      data: data,
      exportCsv: exportCsv,
      harvestNow: function () { return harvest(document, location.href, 0); },
      total: total,
      apis: apiList,
      apiLog: apiLog,
      jsonCalls: function () { return jsonCalls; },
      setSniff: function (v) { sniffOn = !!v; sniffBtn.textContent = '5) Sniffer: ' + (sniffOn ? 'ON' : 'OFF'); },
      autoScroll: toggleAutoScroll
    };

    console.log('[MIDG] Music ID Grabber v1.3 ready. Panel is at the bottom-right. Total ' + total());
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    if (document.body) boot();
    else window.addEventListener('DOMContentLoaded', boot);
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = PURE;
})();
