/**
 * 灵数求解器 · 引擎加载器（零依赖）
 *
 * 单一事实来源：桌面真源 index.html 里的 <script id="solver-core">。
 * 本文件不重写任何求解逻辑——它把那段已验证的脚本在 vm 沙箱里实跑，
 * 取出其中的 solve() 暴露给 Node / MCP 服务端复用，从而保证
 * 「浏览器内 UI」与「MCP 服务端」调用的是同一份核心代码（同源、零分叉、零新 bug）。
 *
 * 用法：
 *   const { solve } = require('./solver-core');
 *   const r = solve(['x^2 = 4'], [], 6);
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { performance } = require('perf_hooks');

/**
 * 递归 no-op 桩：任意属性访问 / 调用 / 赋值都安全。
 * 用于顶层的 document / window 等浏览器对象，避免 UI 初始化代码在 Node 下崩溃。
 */
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

function resolveHtmlPath() {
  if (process.env.LINGSHU_HTML && fs.existsSync(process.env.LINGSHU_HTML)) {
    return process.env.LINGSHU_HTML;
  }
  const candidates = [
    path.resolve(__dirname, 'index.html'),
    path.resolve(__dirname, '..', 'index.html'),
    'C:/Users/Administrator/Desktop/灵数求解器/index.html'
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('灵数求解器 index.html 未找到；请设置环境变量 LINGSHU_HTML 指向它。');
}

let _sandbox = null;

function loadSandbox() {
  const htmlPath = resolveHtmlPath();
  const html = fs.readFileSync(htmlPath, 'utf8');
  const m = html.match(/<script id="solver-core">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('未在 index.html 中找到 <script id="solver-core">。');
  const code = m[1];

  const sandbox = {};
  const noop = makeNoop();

  // 让 window/self/globalThis 都指向 sandbox 自身，
  // 这样顶层 function solve(){} 与 window.xxx= 赋值都落到 sandbox，可被取到。
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;

  // 浏览器对象桩
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
  // 实跑整段核心脚本（顶层 UI 初始化靠 noop 桩安全通过）
  vm.runInContext(code, sandbox, { filename: 'solver-core.js' });

  if (typeof sandbox.solve !== 'function') {
    throw new Error('核心脚本中未找到 solve() 函数；可能 index.html 结构已变更。');
  }
  return sandbox;
}

function getSandbox() {
  if (!_sandbox) _sandbox = loadSandbox();
  return _sandbox;
}

module.exports = {
  /** @returns {Function} 求解入口 solve(equationStrs, varNames, decimals, initialD0, fastMode, opts) */
  solve: function () {
    const sb = getSandbox();
    return sb.solve.apply(sb, arguments);
  },
  /** 取原始沙箱（高级用法：访问 EXAMPLES 等） */
  raw: function () { return getSandbox(); },
  /** 仅用于测试：重置缓存，强制重新加载 */
  _reset: function () { _sandbox = null; }
};
