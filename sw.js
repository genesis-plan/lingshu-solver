// 灵数求解器 Service Worker —— 销毁开关（2026-10-16）
// 目的：清除任何已安装 / 卡死的旧 SW（v1~v4），使页面回到纯网络取最新，彻底杜绝陈旧缓存。
// 机制：安装即 skipWaiting 接管；激活时删除全部缓存并注销自身（unregister）；
//       随后强制刷新所有受控页面，使其脱离 SW、改走网络加载最新页。
// 之后 index.html 不再注册任何 SW（纯网络），陈旧缓存问题永久消失。

const KILL = "lingshu-pwa-kill";

self.addEventListener("install", function (event) {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    (async function () {
      // 1) 删除所有缓存（旧 HTML / 旧壳不再被喂出）
      var keys = await caches.keys();
      await Promise.all(keys.map(function (k) { return caches.delete(k); }));
      // 2) 注销自身：彻底移除 SW
      try { await self.registration.unregister(); } catch (e) {}
      // 3) 强制刷新所有受控页面 → 改走网络加载最新页
      var clients = await self.clients.matchAll({ includeUncontrolled: true });
      clients.forEach(function (c) { c.navigate(c.url).catch(function () {}); });
    })()
  );
});

// 不拦截 fetch：浏览器直接走网络（保险，确保不缓存任何响应）
