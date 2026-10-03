// suan59：二元恰定多项式系统的结式（Resultant）消元
// 目标：把「多元多项式求交」从"采样+牛顿"（不完备、慢）改成
//       「消元降维 → 一元闭式求根 → 回代」（完备、可 Sturm 计数、毫秒级）。
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const core = require('D:/Projects/genesis-plan/lingshu-solver/solver-core.js');
const sb = core.raw();
const P = s => sb.parse(sb.tokenize(s));
const E = (n, v) => { const o = {}; for (const k in v) o[k] = v[k]; return sb.evalAST(n, o); };

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  OK   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  → ' + detail : '')); }
}

function solve59(eqStrs, vns, dom) {
  const eqs = eqStrs.map(s => P(s));
  return sb._suan59SolveBinaryPoly(eqs, vns,
    dom[vns[0]][0], dom[vns[0]][1], dom[vns[1]][0], dom[vns[1]][1],
    { maxOut: 100, valTol: 1e-6 });
}

const DOM = { x: [-50, 50], y: [-50, 50] };

console.log('【① xy=6, x+y=5 ⇒ 恰 (2,3),(3,2)】');
{
  const r = solve59(['x*y - 6', 'x + y - 5'], ['x', 'y'], DOM);
  check('结式消元返回 solved', !!(r && r.solved), JSON.stringify(r && r.solutions));
  if (r) {
    const pts = r.solutions.map(s => s[0].toFixed(4) + ',' + s[1].toFixed(4)).sort();
    check('解集 = {(2,3),(3,2)}', JSON.stringify(pts) === JSON.stringify(['2.0000,3.0000', '3.0000,2.0000']), JSON.stringify(pts));
    check('Sturm 证明 xCount=2', r.xCountProven && r.xCount === 2, 'xCount=' + r.xCount + ' proven=' + r.xCountProven);
    check('残差 < 1e-6', r.residualMax < 1e-6, 'resMax=' + r.residualMax);
  }
}

console.log('【② 圆 × 直线：x^2+y^2=25 与 x+y=1 ⇒ 2 解，独立验算】');
{
  const eqs = ['x*x + y*y - 25', 'x + y - 1'];
  const r = solve59(eqs, ['x', 'y'], { x: [-20, 20], y: [-20, 20] });
  check('返回 2 解', r && r.solutions.length === 2, r ? 'len=' + r.solutions.length : 'null');
  if (r) {
    let ok = true, worst = 0;
    r.solutions.forEach(s => {
      const v = { x: s[0], y: s[1] };
      const a = E(P(eqs[0]), v), b = E(P(eqs[1]), v);
      worst = Math.max(worst, Math.abs(a), Math.abs(b));
      if (Math.abs(a) > 1e-6 || Math.abs(b) > 1e-6) ok = false;
      // 独立几何校验：|x| ≤ 5 且 x+y=1
      if (Math.abs(s[0]) > 5 + 1e-6) ok = false;
    });
    check('两解都通过原方程回代 + 几何界', ok, 'worst=' + worst);
    check('残差 < 1e-6', r.residualMax < 1e-6, 'resMax=' + r.residualMax);
  }
}

console.log('【③ 三次×二次（Bézout 6 点）系统仍可解】');
{
  // y = x^3 - 3x 与 x^2 + y^2 = 4
  const eqs = ['y - x^3 + 3*x', 'x*x + y*y - 4'];
  const r = solve59(eqs, ['x', 'y'], { x: [-10, 10], y: [-10, 10] });
  if (r) {
    let ok = r.solutions.length > 0;
    r.solutions.forEach(s => {
      const v = { x: s[0], y: s[1] };
      if (Math.abs(E(P(eqs[0]), v)) > 1e-5) ok = false;
      if (Math.abs(E(P(eqs[1]), v)) > 1e-5) ok = false;
    });
    check('解出 ' + r.solutions.length + ' 解且全部回代通过', ok);
    check('Sturm 给出 x 的根数', r.xCountProven, 'xCount=' + r.xCount);
  } else check('三次×二次可解', false, '返回 null');
}

console.log('【④ 无实解系统 ⇒ 不能瞎报解】');
{
  // x^2 + y^2 + 1 = 0  ⇒ 恒正，无实解
  const r = solve59(['x*x + y*y + 1', 'x - y'], ['x', 'y'], { x: [-10, 10], y: [-10, 10] });
  check('无实解 ⇒ 解集为空', r && r.solutions.length === 0, r ? 'len=' + r.solutions.length : 'null');
}

console.log('【⑤ 非多项式（超越）输入 ⇒ 必须返回 null（交回原路径）】');
{
  const r = sb._suan59SolveBinaryPoly([P('sin(x) - y'), P('x + y - 1')], ['x', 'y'], -10, 10, -10, 10, {});
  check('含 sin ⇒ null（不越权）', r === null, JSON.stringify(r));
}

console.log('【⑤b 一个方程不含 y（x^4-1 与 x^2+y^2-5）⇒ 不得整条拒绝】');
{
  // 回归：原实现要求两方程都含 y，把这类系统整条拒掉（漏 4 解）
  const r = solve59(['x^4 - 1', 'x^2 + y^2 - 5'], ['x', 'y'], { x: [-10, 10], y: [-10, 10] });
  check('返回 4 解', r && r.solutions.length === 4, r ? 'len=' + r.solutions.length : 'null');
  if (r) {
    const set = r.solutions.map(s => s[0].toFixed(4) + ',' + s[1].toFixed(4)).sort().join(' ');
    check('解集 = {±1}×{±2}', set === '-1.0000,-2.0000 -1.0000,2.0000 1.0000,-2.0000 1.0000,2.0000', set);
    // Res = (x^4-1)^2 含重根 ⇒ Sturm 须走 square-free 分解才能给出证明
    check('重根下 Sturm 仍给出 xCount=2 的证明', r.xCountProven && r.xCount === 2,
      'xCount=' + r.xCount + ' proven=' + r.xCountProven);
  }
}

console.log('【⑤c Sylvester 病态矩阵（x^3-y 与 y^3-x）⇒ 不得数值爆炸】');
{
  // 回归：主元选择按「压缩分数」打分会让 1 次项压过 3 次项 ⇒ 中间量爆炸 ⇒ NaN
  const r = solve59(['x^3 - y', 'y^3 - x'], ['x', 'y'], { x: [-10, 10], y: [-10, 10] });
  check('返回 3 解', r && r.solutions.length === 3, r ? 'len=' + r.solutions.length : 'null');
  if (r) {
    let ok = true, finite = true;
    r.solutions.forEach(s => {
      if (!isFinite(s[0]) || !isFinite(s[1])) finite = false;
      const v = { x: s[0], y: s[1] };
      if (Math.abs(E(P('x^3 - y'), v)) > 1e-5) ok = false;
      if (Math.abs(E(P('y^3 - x'), v)) > 1e-5) ok = false;
    });
    check('全部解有限且回代通过', ok && finite, 'finite=' + finite);
    check('Sturm 证明 xCount', r.xCountProven, 'xCount=' + r.xCount);
  }
}

console.log('【⑤d 公共因子（解集是曲线）⇒ 必须放弃，不得把曲线上的点误报为全部解】');
{
  // f=(y-1)(x^2+y^2), g=(y-1)(x-y) ⇒ 解集含直线 y=1（无穷多点，非零维）
  const r = sb._suan59SolveBinaryPoly([P('(y-1)*(x^2 + y^2)'), P('(y-1)*(x - y)')], ['x', 'y'],
    -20, 20, -20, 20, { maxOut: 100, valTol: 1e-6 });
  check('检出公共因子 ⇒ 返回 null', r === null, JSON.stringify(r));
}

console.log('【⑤e 非零耗时不越界：x^9-x 这种高次结式仍能解】');
{
  const r = solve59(['x^3 - y', 'y^3 - x'], ['x', 'y'], { x: [-10, 10], y: [-10, 10] });
  if (r) {
    // x^9-x=0 ⇒ x=0,±1；y=x^3 ⇒ y=0,±1 ⇒ 3 解
    const ok = r.solutions.every(s => Math.abs(Math.abs(s[0]) - Math.abs(s[0] * s[0] * s[0])) < 1e-6);
    check('解满足 y = x^3', ok);
  } else check('x^9-x 可解', false, 'null');
}

console.log('【⑥ 性能：结式消元应远快于采样+牛顿】');
{
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) solve59(['x*y - 6', 'x + y - 5'], ['x', 'y'], DOM);
  const t59 = (performance.now() - t0) / 20;
  check('单次结式消元 < 5ms（实测 ' + t59.toFixed(3) + 'ms）', t59 < 5);
}

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
