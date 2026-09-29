// 灵数求解器 · 原生桥（仅在 Capacitor 容器内生效；Web/PWA 自动 no-op）
(function () {
  if (!window.Capacitor || !window.Capacitor.Plugins) return;
  var P = window.Capacitor.Plugins;

  // 给页面按钮调用：window.lingshuShare(text)
  window.lingshuShare = function (text) {
    if (P.Share) return P.Share.share({ title: '灵数求解器', text: text || '', url: location.href });
    return Promise.resolve();
  };
  // 生物识别：window.lingshuAuth() -> Promise<boolean>
  window.lingshuAuth = function () {
    if (P.BiometricAuth) {
      return P.BiometricAuth.authenticate({ reason: '解锁你的题历史' })
        .then(function (r) { return !!r.success; })
        .catch(function () { return false; });
    }
    return Promise.resolve(false);
  };
  // 自动给带 data-share 的元素绑原生分享
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-share]').forEach(function (el) {
      el.addEventListener('click', function () { window.lingshuShare(el.getAttribute('data-share')); });
    });
  });
})();
