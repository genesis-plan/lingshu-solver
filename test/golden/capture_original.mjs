// 从 git HEAD（重构前、index.html 里还是原始 solver-core 引擎的版本）抽 <script id="solver-core">，
// 用 vm 实跑原始引擎，抓一份与 ./norm.mjs 口径完全一致的黄金基线。
//
// 为什么必须走 git HEAD：
//   重构后 index.html 的该区块已被 scripts/build.mjs 的构建产物替换，
//   solver-core.js 现在读到的也是新产物 —— 再拿 capture.mjs 抓就等于「用新引擎给新引擎当基线」，
//   那叫自证清白，没意义。基准必须来自「重构前的原始引擎」。
//
// 用法: node test/golden/capture_original.mjs test/golden/baseline.json
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { CASES, norm } from './norm.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dest = process.argv[2] || path.join(ROOT, 'test/golden/baseline.json');

// 拿 git HEAD 版 index.html
// 注意：不能在 node 里 execFileSync('git ...')（本机沙箱会 EBUSY），
//       先由 shell 跑 `git show HEAD:index.html > test/golden/_orig_index.html`，这里只读文件。
const origHtmlPath = process.argv[3] || path.join(ROOT, 'test/golden/_orig_index.html');
if (!fs.existsSync(origHtmlPath)) {
  console.error('缺少原始 index.html，请先：git show HEAD:index.html > ' + origHtmlPath);
  process.exit(1);
}
const html = fs.readFileSync(origHtmlPath, 'utf8');
console.log('原始 index.html 字节:', Buffer.byteLength(html));
const re = /<script id="solver-core">([\s\S]*?)<\/script>/;
const m = re.exec(html);
if (!m) { console.error('git HEAD 的 index.html 里找不到 <script id="solver-core">'); process.exit(1); }
const script = m[1];
console.log('原始引擎（git HEAD）行数:', script.split('\n').length);

// 用 vm 原始跑一遍（原引擎是宽松模式脚本，顶层 function 会挂到 context 上）
// 原引擎是浏览器脚本，第 18 行就 `if (navigator.serviceWorker)`，得补浏览器全局垫片，
// 否则 vm 里直接 ReferenceError（这跟引擎逻辑无关，纯粹是环境差异）。
// 通用假 DOM 节点：任意属性/方法都不炸（原来浏览器里操作真实 DOM 的那些调用全是 UI 层，与求解无关）
const fakeEl = () => {
  const el = {
    style: {}, dataset: {}, children: [], value: '', textContent: '', innerHTML: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {}, appendChild(c) { el.children.push(c); return c; },
    removeChild() {}, setAttribute() {}, getAttribute: () => null, focus() {}, click() {},
    querySelector: () => fakeEl(), querySelectorAll: () => [],
  };
  return el;
};
const sandbox = {
  console,
  performance,                       // 原引擎用 performance.now()；vm 上下文里 Node 的全局不自动带
  navigator: { serviceWorker: null, userAgent: 'node' },
  window: { addEventListener() {}, removeEventListener() {}, location: { href: '' }, navigator: { serviceWorker: null, userAgent: 'node' } },
  document: {
    addEventListener() {}, removeEventListener() {},
    getElementById: () => fakeEl(), querySelector: () => fakeEl(), querySelectorAll: () => [],
    createElement: () => fakeEl(), createTextNode: () => fakeEl(),
    body: fakeEl(), documentElement: fakeEl(), head: fakeEl(), title: '',
  },
};
vm.createContext(sandbox);
vm.runInContext(script, sandbox, { filename: 'orig-solver-core.js' });
const solve = sandbox.solve || (sandbox.globalThis && sandbox.globalThis.solve);
if (typeof solve !== 'function') {
  console.error('原始引擎未暴露 solve()，context 前 20 个键：', Object.keys(sandbox).slice(0, 20));
  process.exit(1);
}

const out = [];
for (const [name, eqs, vs] of CASES) {
  const rec = { name, eqs, varNames: vs };
  try {
    rec.result = norm(solve(eqs, vs, 6));
  } catch (e) {
    rec.throw = String(e && e.message ? e.message : e);
  }
  out.push(rec);
  process.stdout.write('.');
}
process.stdout.write('\n');

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out, null, 1));
console.log('写出', dest, out.length, '用例（源=git HEAD 重构前原始引擎）');
