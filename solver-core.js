/**
 * 灵数求解器 · 引擎加载器（零依赖）
 *
 * 【2026-10-03 生产级大改】单一事实来源改为 **构建产物 dist/lingshu.mjs**：
 *   - 旧做法：正则从 index.html 抠 <script id="solver-core"> 再用 vm.runInContext 实跑。
 *     问题：① 把「已构建好的产物」当源码解析，构建链一改就漏改；② vm 沙箱无 timeout、
 *           无隔离策略，引擎若死循环无法中断；③ 每次启动重新解析 700KB HTML，白付开销。
 *   - 新做法：直接 require 构建产物（ESM 真·入口，strict 模式、显式 var、零隐式全局）。
 *     回退：仅当 dist/ 缺失时才走旧 vm 路径（兼容「clone 后没跑 npm run build」的旧部署）。
 *
 * 对外契约不变：solve() / raw() / _reset()。
 * 用法：
 *   const { solve } = require('./solver-core');
 *   const r = solve(['x^2 = 4'], [], 6);
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let _mod = null;
let _sandbox = null;

// ── 主路径：构建产物 ESM ─────────────────────────────────────────
function loadDist() {
  const candidates = [
    path.resolve(__dirname, 'dist', 'lingshu.mjs'),
    path.resolve(__dirname, '..', 'dist', 'lingshu.mjs')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return require(c);
  }
  return null;
}

// ── 回退路径：vm 跑 index.html 里的 solver-core（生产默认走不到） ──
function makeNoop() {
  const fn = function () { return p; };
  const p = new Proxy(fn, {
    get(_t, prop) {
      if (prop === 'value' || prop === 'textContent' || prop === 'innerHTML') return '';
      if (prop === 'style' || prop === 'classList') return {};
      if (prop === Symbol.toPrimitive) return function () { return ''; };
      if (prop === 'length') return 0;
      return p;
    },
    set() { return true; },
    apply() { return p; },
    construct() { return p; }
  });
  return p;
}
const { performance } = require('perf_hooks');

function loadLegacyVm() {
  let htmlPath = null;
  const envPath = process.env.LINGSHU_HTML;
  if (envPath && fs.existsSync(envPath)) htmlPath = envPath;
  if (!htmlPath) {
    for (const c of [path.resolve(__dirname, 'index.html'), path.resolve(__dirname, '..', 'index.html')]) {
      if (fs.existsSync(c)) { htmlPath = c; break; }
    }
  }
  if (!htmlPath) throw new Error('灵数求解器 index.html 未找到（且 dist/ 缺失）；请先 npm run build。');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const m = html.match(/<script id="solver-core">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('未在 index.html 中找到 <script id="solver-core">。');

  const sandbox = {};
  const noop = makeNoop();
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.document = noop;
  sandbox.navigator = { serviceWorker: null, userAgent: 'node-lingshu' };
  sandbox.localStorage = {
    _d: {},
    getItem(k) { return this._d[k] != null ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; }
  };
  sandbox.location = { href: 'file://' + htmlPath };
  sandbox.performance = performance;
  sandbox.console = console;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.addEventListener = function () {};
  sandbox.removeEventListener = function () {};
  sandbox.requestAnimationFrame = function (cb) { return setTimeout(cb, 0); };
  sandbox.cancelAnimationFrame = function () {};

  vm.createContext(sandbox);
  vm.runInContext(m[1], sandbox, { filename: 'solver-core.js' });
  if (typeof sandbox.solve !== 'function') throw new Error('核心脚本中未找到 solve() 函数。');
  return sandbox;
}

function getSandbox() {
  if (!_sandbox) {
    _mod = loadDist();
    if (_mod && typeof _mod.solve === 'function') {
      _sandbox = _mod;                                  // ✅ 生产路径：ESM 产物
    } else {
      console.warn('[lingshu] 未找到 dist/lingshu.mjs，回退到 vm 读 index.html 的旧路径；请先执行 `npm run build`。');
      _sandbox = loadLegacyVm();                          // ⚠️ 兼容回退
    }
  }
  return _sandbox;
}

module.exports = {
  /** @returns {Function} 求解入口 solve(equationStrs, varNames, decimals, initialD0, fastMode, opts) */
  solve: function () {
    const sb = getSandbox();
    return sb.solve.apply(sb, arguments);
  },
  /** 取引擎命名空间（高级用法 / 测试直接访问内部符号） */
  raw: function () { return getSandbox(); },
  /** 仅用于测试：重置缓存，强制重新加载 */
  _reset: function () { _mod = null; _sandbox = null; }
};
