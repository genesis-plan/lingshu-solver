// 灵数求解器 PWA Service Worker —— 离线可用（App Store Guideline 4.2 的"原生信号"之一）
// v2 修复：HTML/导航请求改为「网络优先」，避免永久喂旧缓存页（曾导致示例全返回空集）。
const CACHE = "lingshu-pwa-v2";
const SHELL = ["index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (e) => {
  // skipWaiting 让新 SW 安装后立即接管，配合 index.html 的 controllerchange 自动刷新，
  // 用户无需手动关闭所有标签页即可脱离旧缓存。
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  // 删除所有旧版本缓存（含 v1），并立即声明对已有客户端的控制权
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const isHtml =
    req.mode === "navigate" ||
    url.pathname.endsWith(".html") ||
    url.pathname === "/" ||
    url.pathname.endsWith("/");

  if (isHtml) {
    // 网络优先：始终拉取最新页面；离线时才回退到缓存的壳
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("index.html")))
    );
    return;
  }

  // 其余静态资源（js/css/png/manifest）：缓存优先，离线可解本地题
  e.respondWith(
    caches.match(req).then((hit) =>
      hit ||
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match("index.html"))
    )
  );
});
