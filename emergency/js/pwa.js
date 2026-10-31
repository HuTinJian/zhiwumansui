/* ============================================================================
 * 临界 · 紧急调度 · PWA 注册脚本
 * ----------------------------------------------------------------------------
 * 职责只有一件事：在 http/https 环境下静默注册同目录下的 sw.js。
 *
 * 硬性纪律：
 *   · file:// 打开（直接双击 index.html）完全跳过，不注册、不报错；
 *   · scope 用相对路径 './'，站点部署在 /emergency/ 子路径时自动正确；
 *   · 注册失败只在 console.warn 记一笔，不弹窗、不阻塞、不影响游戏逻辑；
 *   · updatefound 只做静默记录，不打断玩家。
 *
 * 回退办法：
 *   在 emergency/index.html 里删掉 </body> 前的
 *   <script src="js/pwa.js"></script> 这一行即可停止注册；
 *   再删掉本文件、sw.js、manifest.webmanifest、icons/ 即完全还原成纯静态站。
 *   已经被缓存的浏览器：DevTools → Application → Service Workers → Unregister。
 * ========================================================================== */

(function () {
  'use strict';

  // 只读诊断对象：给自动化测试/排查用，游戏逻辑不读取它。
  var pwaState = {
    supported: false,
    registered: false,
    scope: null,
    error: null,
    updatefound: false
  };
  try { window.__PWA = pwaState; } catch (err) { /* 极端环境忽略 */ }

  // 1) file:// 与其它非 http(s) 协议直接跳过。
  var protocol = window.location.protocol;
  if (protocol !== 'http:' && protocol !== 'https:') return;

  // 2) 浏览器不支持 Service Worker 时也安静退出。
  if (!('serviceWorker' in navigator)) {
    console.info('[临界调度] 当前浏览器不支持 Service Worker，跳过 PWA 注册（游戏可继续）。');
    return;
  }
  pwaState.supported = true;

  // 记录注册失败：只 warn，绝不弹窗、不改游戏状态。
  function warnFail(reason) {
    pwaState.error = String(reason && reason.message ? reason.message : reason);
    console.warn('[临界调度] Service Worker 注册失败，离线能力不可用（游戏可继续）：', reason);
  }

  // 静默观察更新：新版装好后不动界面，玩家下次打开页面自然生效。
  function watchUpdate(registration) {
    try {
      registration.addEventListener('updatefound', function () {
        pwaState.updatefound = true;
        var worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', function () {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            console.info('[临界调度] 发现新版本，已缓存，下次打开页面生效。');
          }
        });
      });
    } catch (err) {
      console.warn('[临界调度] 监听 Service Worker 更新失败（可忽略）：', err);
    }
  }

  function register() {
    // sw.js 相对 index.html 解析：/emergency/index.html → /emergency/sw.js，
    // 子路径部署（如 https://host/emergency/）也能命中。
    var swUrl = new URL('sw.js', document.baseURI);

    try {
      navigator.serviceWorker
        .register(swUrl, {
          // scope 用相对路径；浏览器按文档基准 URL 解析为游戏所在目录。
          scope: './',
          // 让浏览器不走 HTTP 缓存检查 sw.js，更新能及时被发现。
          updateViaCache: 'none'
        })
        .then(function (registration) {
          pwaState.registered = true;
          pwaState.scope = registration.scope;
          watchUpdate(registration);
        })
        .catch(warnFail);
    } catch (err) {
      // register 在参数非法时可能同步抛错，同样只 warn。
      warnFail(err);
    }
  }

  // 3) 等页面加载完成再注册，避免和游戏首帧抢带宽。
  if (document.readyState === 'complete') {
    register();
  } else {
    window.addEventListener('load', register, { once: true });
  }
})();
