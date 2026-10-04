/* ============================================================
   织雾满穗 · Cloudflare Turnstile 客户端小工具（2026-10-05 新增）
   ------------------------------------------------------------
   作用：在「登录 / 无效上报 / 撤销 / 渠道上报」这几个动作前，先向
   Cloudflare 要一张一次性通行证（token），随请求一起发给后端校验。
   脚本连通行证都拿不到，就刷不动接口。

   ★ 怎么启用（三步，缺任何一步都等于「不启用」，不会影响站点）：
     1) Cloudflare 面板 → Turnstile → Add widget
        · Hostnames 里填 zhiwumansui.pages.dev（本地测试再加 localhost）
        · Widget Mode 选 Non-interactive 或 Invisible（体验最好）
        拿到 Site Key（公开）和 Secret Key（保密）。
     2) 把下面 SITE_KEY 填成 Site Key —— 这是公开值，可以进仓库。
     3) Pages 项目 → Settings → Variables and Secrets，加两个变量：
        · TURNSTILE_SECRET = Secret Key（选 Secret/加密，绝不进仓库）
        · TURNSTILE_MODE   = soft   ← 先观察几天，日志里确认没有正常访客被误伤
        确认没问题后再把 TURNSTILE_MODE 改成 strict（正式拦截）。

   ★ 怎么关掉（不用改代码、不用重新部署）：
     把 TURNSTILE_MODE 删掉或改成 soft，或者删掉 TURNSTILE_SECRET，
     下一次请求立刻恢复成「不检查」。

   ★ 大陆网络的注意点：Turnstile 的脚本来自 challenges.cloudflare.com，
     部分地区可能加载慢或失败（Cloudflare 官方状态页出现过「China visitors
     cannot complete Cloudflare challenges」）。加载失败时本文件会静默降级
     （不带 token 发请求）：soft 模式下一切照常，strict 模式下会被服务端拒绝。
     所以务必先 soft 观察、确认访客能正常上报，再切 strict。
   ============================================================ */

(function () {
  'use strict';

  /* ★ 把你的 Turnstile Site Key 填在这里（公开值，可以提交到仓库） */
  var SITE_KEY = '';

  var SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

  /* token 有效期 300 秒，这里留点余量；过期就重新要一张 */
  var TOKEN_TTL = 280 * 1000;

  var state = {};        /* action -> { id, token, at, waiters } */
  var loadPromise = null;
  var styleReady = false;

  function enabled() {
    return typeof SITE_KEY === 'string' && SITE_KEY.length > 0;
  }

  function injectStyle() {
    if (styleReady) return;
    styleReady = true;
    var style = document.createElement('style');
    style.textContent =
      '.zm-ts-host{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);' +
      'z-index:4000;max-width:100%;}' +
      '.zm-ts-slot{margin:10px 0;}';
    document.head.appendChild(style);
  }

  function loadScript() {
    if (window.turnstile) return Promise.resolve(true);
    if (loadPromise) return loadPromise;

    loadPromise = new Promise(function (resolve) {
      var done = false;
      function finish(ok) {
        if (done) return;
        done = true;
        resolve(ok && !!window.turnstile);
      }

      var script = document.createElement('script');
      script.src = SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.onload = function () { finish(true); };
      script.onerror = function () { finish(false); };
      document.head.appendChild(script);

      /* 兜底：某些网络下 onload 迟迟不来，最多等 6 秒 */
      setTimeout(function () { finish(!!window.turnstile); }, 6000);
    });

    return loadPromise;
  }

  function ensureHost(action) {
    var explicit = document.querySelector('[data-zm-turnstile="' + action + '"]');
    if (explicit) return explicit;

    var host = document.getElementById('zm-ts-' + action);
    if (host) return host;

    host = document.createElement('div');
    host.id = 'zm-ts-' + action;
    host.className = 'zm-ts-host';
    host.setAttribute('aria-hidden', 'true');
    document.body.appendChild(host);
    return host;
  }

  function bucket(action) {
    if (!state[action]) {
      state[action] = { id: null, token: '', at: 0, waiters: [] };
    }
    return state[action];
  }

  /* 一张 token 只能用一次：交给第一个等待者，其余的人拿空串
     （soft 模式不受影响；strict 模式由 postJson 重新取一张再试一次） */
  function settle(action, token) {
    var st = bucket(action);
    var waiters = st.waiters.slice();
    st.waiters.length = 0;
    if (token) {
      st.token = token;
      st.at = Date.now();
    }
    if (waiters.length === 0) return;

    var first = waiters.shift();
    if (first) first(token || '');
    waiters.forEach(function (fn) { fn(''); });
  }

  function renderWidget(action) {
    var st = bucket(action);
    if (st.id !== null) return;

    injectStyle();
    var host = ensureHost(action);

    try {
      st.id = window.turnstile.render(host, {
        sitekey: SITE_KEY,
        action: action,
        /* 只在需要人机互动时才把验证框显示出来，平时不占地方 */
        appearance: 'interaction-only',
        callback: function (token) { settle(action, token); },
        'error-callback': function () { settle(action, ''); },
        'timeout-callback': function () { settle(action, ''); },
        'expired-callback': function () { bucket(action).token = ''; }
      });
    } catch (err) {
      st.id = null;
    }
  }

  /* 取一张通行证；拿不到就返回空串（绝不抛错、绝不阻塞页面） */
  function getToken(action, timeoutMs) {
    if (!enabled()) return Promise.resolve('');

    action = action || 'default';
    var st = bucket(action);

    if (st.token && (Date.now() - st.at) < TOKEN_TTL) {
      var fresh = st.token;
      st.token = '';
      return Promise.resolve(fresh);
    }

    return loadScript().then(function (ok) {
      if (!ok) return '';

      return new Promise(function (resolve) {
        var settled = false;
        function finish(token) {
          if (settled) return;
          settled = true;
          var index = st.waiters.indexOf(finish);
          if (index >= 0) st.waiters.splice(index, 1);
          resolve(token || '');
        }

        st.waiters.push(finish);
        renderWidget(action);

        /* invisible 模式的 widget 需要主动触发一次 */
        try {
          if (window.turnstile && st.id !== null) window.turnstile.execute(st.id);
        } catch (err) {}

        setTimeout(function () { finish(''); }, Math.max(2000, timeoutMs || 8000));
      });
    });
  }

  function reset(action) {
    var st = state[action || 'default'];
    if (!st) return;
    st.token = '';
    try {
      if (window.turnstile && st.id !== null) window.turnstile.reset(st.id);
    } catch (err) {}
  }

  /* 带通行证的 POST。服务端在 strict 模式下以 turnstile_* 为由拒了，
     就换一张新 token 自动重试一次（只重试一次，避免死循环）。 */
  function postJson(url, payload, action) {
    var base = (payload && typeof payload === 'object') ? payload : {};

    function send() {
      return getToken(action).then(function (token) {
        var body = Object.assign({}, base);
        if (token) body.turnstileToken = token;
        return fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
      });
    }

    return send().then(function (res) {
      if (res.status !== 403) return res;
      return res.clone().json().catch(function () { return null; }).then(function (data) {
        var code = data && data.error ? String(data.error) : '';
        if (code.indexOf('turnstile') !== 0) return res;
        reset(action);
        return send();
      });
    });
  }

  window.ZMTurnstile = {
    enabled: enabled,
    token: getToken,
    reset: reset,
    postJson: postJson
  };
})();
