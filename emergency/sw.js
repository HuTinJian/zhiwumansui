/* ============================================================================
 * 临界 · 紧急调度 · Service Worker 清理器（PWA 已移除）
 * ----------------------------------------------------------------------------
 * 背景：上一版曾注册 PWA/离线缓存。现在不再需要安装与离线能力，
 *       但旧浏览器里可能还留着 Service Worker 和缓存目录。
 * 本文件的作用 = 自杀式清理：
 *   1. install 立即接管；
 *   2. activate 删除本游戏旧缓存（linjie112-*），再 unregister 自己；
 *   3. 不做任何 fetch 拦截，资源全部走网络，避免旧版本卡住。
 *
 * 注意：部署后旧页面会被旧 SW 缓存“粘住”一次；新 sw.js 会在后台更新并清理，
 *       用户下一次刷新/重新打开就会恢复纯联网。新版页面已不再注册 SW。
 * 回退：无需回退；删除本文件即可。已安装浏览器在 DevTools → Application →
 *       Service Workers 点 Unregister 也能立即恢复。
 * ========================================================================== */
'use strict';

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    try {
      var keys = await caches.keys();
      await Promise.all(keys.filter(function (k) {
        return k.indexOf('linjie112-') === 0 || k.indexOf('linjie-') === 0;
      }).map(function (k) { return caches.delete(k); }));
    } catch (e) { /* 清缓存失败不影响页面 */ }
    try { await self.registration.unregister(); } catch (e) { }
    try { await self.clients.claim(); } catch (e) { }
  })());
});
