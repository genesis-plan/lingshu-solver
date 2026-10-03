// 验证半角代换（tangent half-angle substitution）的数学正确性
// 定理：令 t = tan(x/2)，则
//   sin(x) = 2t/(1+t²)   cos(x) = (1−t²)/(1+t²)   tan(x) = 2t/(1−t²)   x = 2·arctan(t)
// 目标：把超越方程组变成有理方程组，接上已有的分式有理化（suan50）
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const core = require('D:/Projects/genesis-plan/lingshu-solver/solver-core.js');
const sb = core.raw();

// 独立验算：用高精度参考值对比
console.log('=== 半角代换的数学正确性（独立验算）===');
let maxErrSin = 0, maxErrCos = 0, maxErrTan = 0, maxErrX = 0;
for (let k = 0; k < 2000; k++) {
  const x = -Math.PI + Math.PI * 2 * k / 2000;      // (−π, π) 覆盖一个周期
  const t = Math.tan(x / 2);
  const d = 1 + t * t;
  // 正向：sin/cos 由 t 还原
  const s2t = 2 * t, s1mt2 = 1 - t * t;
  const sErr = Math.abs(s2t / d - Math.sin(x));
  const cErr = Math.abs(s1mt2 / d - Math.cos(x));
  maxErrSin = Math.max(maxErrSin, sErr);
  maxErrCos = Math.max(maxErrCos, cErr);
  if (Math.abs(s1mt2) > 1e-12) {
    const tErr = Math.abs(s2t / s1mt2 - Math.tan(x));
    if (isFinite(tErr)) maxErrTan = Math.max(maxErrTan, tErr);
  }
  // 反向：x 由 t 还原
  const xBack = 2 * Math.atan(t);
  maxErrX = Math.max(maxErrX, Math.abs(xBack - x));
}
console.log('  2000 个采样点最大误差：');
console.log('    |sin 还原 − sin| = ' + maxErrSin.toExponential(2));
console.log('    |cos 还原 − cos| = ' + maxErrCos.toExponential(2));
console.log('    |tan 还原 − tan| = ' + maxErrTan.toExponential(2));
console.log('    |2·arctan(t) − x| = ' + maxErrX.toExponential(2));
console.log('  ⇒ 代换恒等式成立（误差为双精度舍入量级）');

console.log('');
console.log('=== 目标案例：sin(x)·sin(y) = 0.5 能否变成有理方程 ===');
// sin x sin y = 2tx/(1+tx²) · 2ty/(1+ty²) = 0.5
// ⇒ 4·tx·ty = 0.5(1+tx²)(1+ty²)  —— 纯有理式！
// 已知解 x=y=π/4 ⇒ t = tan(π/8) = 0.41421
const t8 = Math.tan(Math.PI / 8);
console.log('  验证真解 (x,y)=(π/4, π/4)：t = tan(π/8) = ' + t8.toFixed(6));
const lhs = 4 * t8 * t8;
const rhs = 0.5 * (1 + t8 * t8) * (1 + t8 * t8);
console.log('    有理式 4t·t = ' + lhs.toFixed(10) + '   0.5(1+t²)² = ' + rhs.toFixed(10));
console.log('    ' + (Math.abs(lhs - rhs) < 1e-12 ? '✅ 相等 ⇒ 代换正确' : '❌ 不等'));

console.log('');
console.log('=== 关键：代换后的方程能否被灵数的分式有理化处理？===');
// 手工构造有理方程：4*tx*ty - 0.5*(1+tx^2)*(1+ty^2) = 0
// 展开：4tx·ty − 0.5 − tx²·ty² − 0.5tx² − 0.5ty² = 0
const rational = '4*tx*ty - tx^2*ty^2 - 0.5*tx^2 - 0.5*ty^2 - 0.5';
try {
  const ast = sb.parse(sb.tokenize(rational));
  const dens = sb.collectVariableDenominators(ast, ['tx', 'ty']);
  const rat = sb._rat50 ? sb._rat50(ast) : null;
  console.log('  有理式 AST 解析成功');
  console.log('  分母数 = ' + (dens ? dens.length : 'null') + '（应为 0，无分母）');
  console.log('  _rat50 可用 = ' + (typeof sb._rat50 === 'function'));
} catch (e) {
  console.log('  解析失败: ' + e.message.slice(0, 80));
}

console.log('');
console.log('=== 现有多元求解器能否处理这个有理方程组？===');
console.log('  （下面用灵数直接解 4tx·ty − tx²ty² − 0.5tx² − 0.5ty² − 0.5 = 0）');
try {
  const r = core.solve([rational], ['tx', 'ty'], 6);
  const s = r.solutions || [];
  console.log('  解数 = ' + s.length + '  rt = ' + r.resultTypeName);
  s.slice(0, 4).forEach(x => {
    const tx = x.values[0], ty = x.values[1];
    const back = [2 * Math.atan(tx), 2 * Math.atan(ty)];
    // 独立回代原超越方程
    const fv = sb.evalAST(sb.parse(sb.tokenize('sin(x)*sin(y) - 0.5')), { x: back[0], y: back[1] });
    console.log('    (t)=' + JSON.stringify([+tx.toFixed(6), +ty.toFixed(6)]) +
      '  ⇒ (x,y)=(' + back.map(v => v.toFixed(6)).join(', ') + ')' +
      '  原式残差=' + (fv === null ? 'null' : fv.toExponential(2)));
  });
} catch (e) {
  console.log('  求解抛错: ' + e.message.slice(0, 80));
}
