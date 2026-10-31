/* ============================================================================
 * 临界 · 紧急调度 · Service Worker（离线缓存）
 * ----------------------------------------------------------------------------
 * 作用域：本文件放在 emergency/ 根下，默认作用域就是 emergency/ 目录，
 *         所以站点部署在 /emergency/ 子路径时不需要改任何路径。
 *
 * 策略：
 *   1. install  —— 逐个预缓存静态资源；单个失败只 warn，不拖垮整个安装。
 *   2. activate —— 删除旧版本缓存目录，并接管已打开的页面。
 *   3. fetch    —— 导航请求 network-first（断网回退缓存的 index.html）；
 *                  同源静态资源 cache-first + 网络回填；
 *                  非 GET / 跨域 / /api/ / range 一律不接管，直接走网络。
 *
 * 回退办法（要完全撤掉离线能力时）：
 *   · 删除本文件 emergency/sw.js；
 *   · 删除 emergency/index.html 里的 <script src="js/pwa.js"></script> 那一行；
 *   · 删除 emergency/js/pwa.js、emergency/manifest.webmanifest、emergency/icons/；
 *   · 已经被旧缓存"粘住"的浏览器，可在 DevTools → Application → Service Workers
 *     点 Unregister，或清空站点数据即可恢复成纯联网模式。
 * ========================================================================== */

'use strict';

// 缓存版本号：改动任何静态资源后把这里 +1，旧缓存会在下次 activate 时被清掉。
const VERSION = 'v3';
const CACHE_PREFIX = 'linjie112-';
const CACHE_NAME = CACHE_PREFIX + VERSION;

// 以 sw.js 所在目录为基准拼绝对地址，避免相对路径在不同部署路径下解析歧义。
const BASE_URL = new URL('./', self.location.href);
const toURL = function (path) { return new URL(path, BASE_URL).href; };

// 需要离线可用的静态资源（全部在 emergency/ 目录内）。
const INDEX_URL = toURL('./index.html');
const PRECACHE_PATHS = [
  './index.html',
  './manifest.webmanifest',
  './css/game.css',
  './js/util.js',
  './js/data.js',
  './js/map.js',
  './js/sim.js',
  './js/render.js',
  './js/audio.js',
  './js/net.js',
  './js/ui.js',
  './js/main.js',
  './js/pwa.js',
  './vendor/peerjs.min.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];
const PRECACHE_URLS = PRECACHE_PATHS.map(toURL);

// 作用域路径（形如 /emergency/），用来判断请求是否归本 SW 管。
const SCOPE_PATH = BASE_URL.pathname;

/* ---------------------------- 安装：逐个预缓存 ---------------------------- */
self.addEventListener('install', function (event) {
  event.waitUntil((async function () {
    const cache = await caches.open(CACHE_NAME);

    // 逐条独立处理：任何一条 404 / 网络错误都只记录 warn，
    // 不让 Promise.all 整体 reject —— 否则一个缺失文件就会让整个 SW 装不上。
    const results = await Promise.allSettled(PRECACHE_URLS.map(async function (url) {
      const response = await fetch(url, { cache: 'reload' }); // 绕过 HTTP 缓存拿最新文件
      if (!response || !response.ok) {
        throw new Error('HTTP ' + (response ? response.status : 'no response'));
      }
      await cache.put(url, response.clone());
      return url;
    }));

    let ok = 0;
    const failed = [];
    results.forEach(function (result, index) {
      if (result.status === 'fulfilled') {
        ok += 1;
      } else {
        const reason = result.reason && result.reason.message ? result.reason.message : String(result.reason);
        failed.push(PRECACHE_PATHS[index] + ' (' + reason + ')');
        console.warn('[临界调度 SW] 预缓存跳过：' + PRECACHE_PATHS[index] + ' → ' + reason);
      }
    });
    console.info('[临界调度 SW] 预缓存完成 ' + ok + '/' + PRECACHE_URLS.length +
      (failed.length ? '，跳过 ' + failed.length + ' 项' : ''));

    // 故意不调用 skipWaiting()：避免新版在游戏进行中顶替旧版、把资源换掉。
    // 新版会在所有旧页面关闭后自然接管；首次安装没有旧版，会立刻 activate。
  })());
});

/* ------------------------- 激活：清旧缓存 + 接管页面 ------------------------ */
self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    const keys = await caches.keys();
    await Promise.all(keys.map(function (key) {
      // 只清本 SW 名下的旧版本缓存，别的站点模块的缓存不碰。
      if (key.indexOf(CACHE_PREFIX) === 0 && key !== CACHE_NAME) {
        return caches.delete(key);
      }
      return null;
    }));

    // 首次安装后立刻接管已打开的页面，这样刷新前 controller 也能就位。
    if (self.clients && self.clients.claim) {
      await self.clients.claim();
    }
  })());
});

/* ------------------------------ 请求分流 ------------------------------ */
self.addEventListener('fetch', function (event) {
  const request = event.request;

  // 1) 只处理 GET；POST/PUT 等一律放行。
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (err) {
    return;
  }

  // 2) 跨域请求（PeerJS 信令、CDN 等）不接管。
  if (url.origin !== self.location.origin) return;

  // 3) 后端接口必须走网络，缓存会产生假数据。
  if (url.pathname.indexOf('/api/') !== -1) return;

  // 4) Range 请求（音频/视频分段）交给浏览器，缓存整段响应会出错。
  if (request.headers.has('range')) return;

  // 5) 作用域外的资源不归本 SW 管。
  if (url.pathname.indexOf(SCOPE_PATH) !== 0) return;

  // 6) 页面导航：network-first，断网回退缓存的 index.html。
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // 7) 其余同源静态资源：cache-first + 网络回填。
  event.respondWith(cacheFirst(request));
});

/* --------------------------- 导航：network-first --------------------------- */
async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    // 网络正常时顺手把最新页面写进缓存，下次断网就有新版本可用。
    if (response && response.ok && response.type === 'basic') {
      const cache = await caches.open(CACHE_NAME);
      cache.put(INDEX_URL, response.clone()).catch(function () { /* 写缓存失败不影响返回 */ });
    }
    return response;
  } catch (err) {
    const cached = await caches.match(INDEX_URL);
    if (cached) return cached;
    return new Response('当前处于离线状态，页面缓存尚未就绪，请联网刷新一次。', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

/* ------------------------ 静态资源：cache-first + 回填 ------------------------ */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    // 只缓存同源、状态正常的响应；404/opaque 不写，免得把错误页长期钉住。
    if (response && response.ok && response.type === 'basic') {
      cache.put(request, response.clone()).catch(function () { /* 配额满等写入失败忽略 */ });
    }
    return response;
  } catch (err) {
    // 断网且没命中精确缓存时，再尝试忽略查询串匹配一次（例如 ?v=2 之类的版本参数）。
    const loose = await cache.match(request, { ignoreSearch: true });
    if (loose) return loose;
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

/* --------------------- 可选：外部消息触发立即更新（当前未使用） --------------------- */
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING' && self.skipWaiting) {
    self.skipWaiting();
  }
});
