// 验证 _s59ResultantX：二元多项式系统消元成 x 的一元多项式
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const core = require('D:/Projects/genesis-plan/lingshu-solver/solver-core.js');
const sb = core.raw();

// 手工构造：f = xy − 6, g = x + y − 5  （真解 (2,3),(3,2)）
// Res_y(f,g) 应为 (x−2)(x−3) = x² − 5x + 6（升幂 [6,−5,1]）
console.log('=== 结式正确性（构造已知答案的例题）===');
{
  // f = x·y − 6  ⇒ 关于 y： [ −6, x ]（y^0·(−6) + y^1·x）
  // g = x + y − 5 ⇒ 关于 y： [ x−5, 1 ]
  const fY = [[-6], [1]];           // 占位，稍后用真实系数
  // 手工：f 的 y^0 系数是 −6（常数），y^1 系数是 x ⇒ x 的升幂 [−6] 与 [0,1]
  const f = [[[-6], [0]], [0, 0, 1] === 0 ? [] : [0, 0, 1]];
  console.log('  手工构造较繁，改用程序化构造：');
  function mkConst(v) { return [v]; }
  function mkX() { return [0, 1]; }          // 多项式 x（升幂 [0,1]）
  function mk1() { return [1]; }              // 多项式 1
  // f = x*y − 6
  const fY2 = [[-6], [0, 1]];                // y^0: −6 ; y^1: x
  // g = x + y − 5
  const gY2 = [[-5, 1], [1]];                // y^0: x−5 ; y^1: 1
  const R = sb._s59ResultantX(fY2, gY2, 8);
  console.log('  Res_y(xy−6, x+y−5) 升幂系数 = ' + JSON.stringify(R));
  console.log('  期望 (x−2)(x−3) = [6,−5,1]');
  console.log('  ' + (R && Math.abs(R[0] - 6) < 1e-6 && Math.abs(R[1] + 5) < 1e-6 && Math.abs(R[2] - 1) < 1e-6 ? '✅ 一致' : '❌ 不一致'));
}

console.log('');
console.log('=== 用 Sturm 验证结式根恰为系统解的 x 坐标 ===');
if (typeof sb._sturmCountAsc === 'function' && typeof sb.polynomialAllRoots === 'function') {
  const fY2 = [[-6], [0, 1]];
  const gY2 = [[-5, 1], [1]];
  const R = sb._s59ResultantX(fY2, gY2, 8);
  if (R) {
    const roots = sb.polynomialAllRoots(R, 1e-8);
    console.log('  结式根 = ' + JSON.stringify((roots || []).map(v => +v.toFixed(9))));
    console.log('  期望   = [2, 3]');
    const ok = roots && roots.length === 2 &&
      Math.abs(roots[0] - 2) < 1e-6 && Math.abs(roots[1] - 3) < 1e-6;
    console.log('  ' + (ok ? '✅ 精确匹配' : '❌ 不匹配'));
    const c = sb._sturmCountAsc(R, -1e6, 1e6);
    console.log('  Sturm 计数 = ' + (c.ok ? c.count : 'FAIL') + '（期望 2）');
  }
}

console.log('');
console.log('=== 更复杂的例：x² + y² = 25, x + y = 7（真解 (3,4),(4,3)）===');
{
  // f = x² + y² − 25 ⇒ 关于 y: y^0: x²−25 = [−25,0,1] ; y^1: 0 ; y^2: 1 = [1]
  const fY = [[-25, 0, 1], [0], [1]];
  // g = x + y − 7 ⇒ y^0: x−7 = [−7,1] ; y^1: 1 = [1]
  const gY = [[-7, 1], [1]];
  const R = sb._s59ResultantX(fY, gY, 8);
  console.log('  Res 升幂 = ' + JSON.stringify(R));
  console.log('  期望 (x−3)(x−4) = [12,−7,1]');
  if (R) {
    const roots = sb.polynomialAllRoots(R, 1e-8);
    console.log('  结式根 = ' + JSON.stringify((roots || []).map(v => +v.toFixed(9))) + '（期望 [3,4]）');
  }
}

console.log('');
console.log('=== 公共因子退化检测：f=(x−1)(x−2), g=(x−1)(x−3) ===');
{
  // f = x²−3x+2 ⇒ 关于 y 是常数多项式（deg_y = 0）⇒ 结构上不适合结式，这里改测
  // f = (x−1)y, g = (x−1)(y−1) 共享因子 (x−1)
  const fY = [[0], [-1, 1]];              // y^0: 0 ; y^1: x−1
  const gY = [[1, -1], [-1, 1]];          // y^0: 1−x = −(x−1) ; y^1: x−1
  const R = sb._s59ResultantX(fY, gY, 8);
  console.log('  Res = ' + JSON.stringify(R));
  console.log('  期望：共享因子 ⇒ 结式退化（应接近 0 或常数）');
}
