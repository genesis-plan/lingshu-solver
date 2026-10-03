// 定位：二元多项式系统求解是瓶颈吗？
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const core = require('D:/Projects/genesis-plan/lingshu-solver/solver-core.js');
const sb = core.raw();

const T = [
  // [题, 变量, 真解]
  ['x*y = 6 , x + y = 5', ['x', 'y'], [[2, 3], [3, 2]]],
  ['x^2 + y^2 = 25 , x + y = 7', ['x', 'y'], [[3, 4], [4, 3]]],
  ['x*y*z = 6 , x + y + z = 6', ['x', 'y', 'z'], 'many'],
  ['4*tx*ty - tx^2*ty^2 - 0.5*tx^2 - 0.5*ty^2 - 0.5 = 0', ['tx', 'ty'], '?'],
  ['x^2 - y = 1 , y^2 - x = 1', ['x', 'y'], [[-0.618, 0.618], [1.618, 1.618]]],
  ['x + y = 3 , x*y = 2', ['x', 'y'], [[1, 2], [2, 1]]],
  ['x^2 + y^2 = 2 , x + y = 2', ['x', 'y'], [[1, 1]]],
  ['x*y = 1 , x + y = 2', ['x', 'y'], [[1, 1]]],
  ['x^2 - y^2 = 0 , x + y = 4', ['x', 'y'], [[2, 2]]],
  ['x*y - 1 = 0 , x^2 + y^2 - 5 = 0', ['x', 'y'], '2对'],
];

console.log('二元/三元多项式系统（数组两元素写法）');
console.log('题'.padEnd(52) + '解数  rt');
T.forEach(([eqs, vns, truth]) => {
  const arr = eqs.split(' , ');
  const t0 = performance.now();
  let r;
  try { r = core.solve(arr, vns, 6); } catch (e) { r = null; }
  const ms = performance.now() - t0;
  const s = r ? (r.solutions || []) : [];
  const tv = (truth === 'many' || truth === '?') ? '?' : (Array.isArray(truth) ? truth.length : truth);
  console.log('  ' + arr.join(' ; ').padEnd(50) + String(s.length).padStart(4) +
    '  ' + (r ? r.resultTypeName : 'THROW').slice(0, 18).padEnd(20) + ' (应 ' + tv + ')  ' + ms.toFixed(1) + 'ms');
  if (s.length && s.length <= 4) {
    console.log('       ' + JSON.stringify(s.map(x => x.values.map(v => +v.toFixed(6)))));
  }
});

console.log('');
console.log('=== 关键诊断：多元系统的消元能力 ===');
// 单变量消元能力实测
const cases = [
  ['4*tx*ty - tx^2*ty^2 - 0.5*tx^2 - 0.5*ty^2 - 0.5 = 0', ['tx', 'ty']],
  ['x*y - 6 = 0 , x + y - 5 = 0', ['x', 'y']],
];
cases.forEach(([eqs, vns]) => {
  const arr = eqs.split(' , ');
  const r = core.solve(arr, vns, 6);
  console.log('  ' + arr.join(' ; '));
  console.log('     解=' + (r.solutions || []).length + '  原方程数=' + arr.length + '  变量数=' + vns.length +
    '  （恰定? ' + (arr.length === vns.length) + '）');
  // state.equations 是否被消元
  console.log('     meta.operatorsFired: ' + JSON.stringify((r.meta || {}).operatorsFired || []).slice(0, 120));
});

console.log('');
console.log('=== 结式（resultant）消元的可行性探测 ===');
console.log('  理论：Res_y(f, g) 是关于 x 的一元多项式，其根恰为可解 x（f,g 有公共 y 根）');
console.log('  工具：Sylvester 矩阵行列式（对二元多项式，2n×2n 矩阵）');
console.log('  现状：灵数有无 Sylvester/resultant 实现？');
['resultant', 'sylvester', 'Sylvester', 'b resultant', 'polynomialGCD', 'gcdPoly', 'polyGCD', 'polynomialGcd']
  .forEach(k => console.log('    ' + k + ': ' + ((sb[k] !== undefined) ? '有' : '无')));
console.log('  可用的多项式工具：');
['extractPolynomialCoefficients', 'polynomialAllRoots', 'syntheticDivide', 'rationalRootTheorem',
 'scanRealRoots', 'realMatInv', 'gaussianSolve', 'realMatDet', 'realMatVec']
  .forEach(k => console.log('    ' + k + ': ' + ((typeof sb[k] === 'function') ? '有' : '无')));
