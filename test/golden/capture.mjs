// 抓黄金基线（重构零行为变更的唯一判据）。
//
// 口径说明（重要）：
//   基线 ≠ git HEAD 的原始 index.html —— HEAD 是「没 suan61/suan62 增强」的老引擎，
//   拿它当基线会把「功能增量」误判成「重构 regression」。
//   正确的基线 = **重构前那个单作用域引擎本体**，也就是 build 出来的拼接体：
//   dist/lingshu.mjs 去掉末尾 `export { ... };` 剩下的部分（它就是所有 src/engine 区块的零改写拼接）。
//   拿到 vm（宽松模式，和原引擎运行时一致）里实跑，和 ESM 产物（严格模式 + 显式 var）逐字段比。
//   这样两边跑的是**同一份代码**，任何差异都只应来自「执行环境/严格模式包装」，
//   能真实反映重构有没有动到行为。
//
// 用法: node test/golden/capture.mjs [outfile]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { CASES, norm } from './norm.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dest = process.argv[2] || path.join(ROOT, 'test/golden/baseline.json');

const esm = fs.readFileSync(path.join(ROOT, 'dist/lingshu.mjs'), 'utf8');
const idx = esm.lastIndexOf('\nexport { ');
if (idx < 0) { console.error('dist/lingshu.mjs 里找不到 export { 分段，先跑 node scripts/build.mjs'); process.exit(1); }
const body = esm.slice(0, idx);          // 去掉 ESM 导出包装，回到「单作用域引擎本体」
console.log('拼接体（基线源）字节:', Buffer.byteLength(body), '行数:', body.split('\n').length);

// 浏览器全局垫片（原引擎是浏览器脚本， servicing/UI 层会碰 navigator/document）
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
  performance,
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
vm.runInContext(body, sandbox, { filename: 'engine-body.js' });
const solve = sandbox.solve || (sandbox.globalThis && sandbox.globalThis.solve);
if (typeof solve !== 'function') {
  console.error('拼接体未暴露 solve()，context 前 20 个键：', Object.keys(sandbox).slice(0, 20));
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
console.log('写出', dest, out.length, '用例（源=dist 拼接体去掉 export 包装，vm 宽松模式实跑）');
