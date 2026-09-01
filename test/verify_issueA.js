'use strict';
// issue A 回归：周期/高频单变量方程不得静默漏支（假阴性）。
// 用生产加载器 solver-core.js 驱动真实 index.html。
// 若本应多根却仅 1 根且未标 truncated -> 即 A 修复前的假阴性，判 FAIL。
const { solve } = require('../solver-core');

const TAU = Math.PI * 2;
// [方程, 变量, 域或null, 期望根数]
const cases = [
  ['cos(x)=0.5', ['x'], { x: [0, TAU] }, 2],
  ['cos(x)=0.5', ['x'], { x: [0, 20] }, 7],
  ['sin(x)=0.5', ['x'], { x: [0, 20] }, 7],
  ['sin(100*x)=0', ['x'], { x: [0, 1] }, 32],
  ['cos(x)=x', ['x'], { x: [0, 20] }, 1],
  ['tan(x)=1', ['x'], { x: [0, 20] }, 7],
  ['cos(2*x)=0.5', ['x'], { x: [0, 2 * TAU] }, 8],
  ['sin(x)=0', ['x'], { x: [-TAU, TAU] }, 5],
  ['x^2=4', ['x'], null, 2],
  ['x^2=4', ['x'], { x: [0, 10] }, 1],
  ['x^3-2*x=0', ['x'], { x: [-3, 3] }, 3],
  ['sin(x)+x=0', ['x'], { x: [-10, 10] }, 1],
  ['cos(x)=2', ['x'], { x: [0, 20] }, 0],
  ['sin(x^2)=0', ['x'], { x: [0, 10] }, 32],
  ['x^2-1=0', ['x'], { x: [-1e6, 1e6] }, 2],
];

let pass = 0, fail = 0;
for (const [eq, vars, dom, exp] of cases) {
  let res, threw = null;
  try { res = solve([eq], vars, 6, dom, false, null); }
  catch (e) { threw = e.message; }
  if (threw) { console.log('XX ' + eq.padEnd(16) + ' THREW ' + threw); fail++; continue; }
  const n = (res && res.solutions) ? res.solutions.length : 0;
  const ok = (n === exp);
  const silentNeg = (exp > 1 && n <= 1 && !res.truncated);
  const tag = (ok ? 'OK ' : 'XX ') + (silentNeg ? '[SILENT-FALSE-NEG]' : '');
  console.log(tag + ' ' + eq.padEnd(16) + ' dom=' + (dom ? JSON.stringify(dom.x) : 'def') +
    ' => n=' + n + ' (exp ' + exp + ') trunc=' + !!res.truncated);
  if (ok) pass++; else fail++;
}
console.log('\n=== issue A 回归（真实 index.html）===');
console.log('PASS=' + pass + ' FAIL=' + fail + ' / ' + cases.length);
process.exit(fail === 0 ? 0 : 1);
