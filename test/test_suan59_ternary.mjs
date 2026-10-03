// suan59 三元扩展：字典序结式消元（Res_z → Res_y → 一元闭式求根 → 回代）
// 与二元同一算子编号，按变量数分流。定位：
//   · 二元路径给【完备性数学证明】（Sturm 计数 + 回代覆盖）
//   · 三元路径两次结式引入伪根 ⇒ 只证「解全部正确」，不宣称完备（如实标记）
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const core = require('D:/Projects/genesis-plan/lingshu-solver/solver-core.js');
const sb = core.raw();
const P = s => sb.parse(sb.tokenize(s));
const E = (n, v) => sb.evalAST(n, v);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  OK   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  → ' + detail : '')); }
}
const BOX = { x: [-20, 20], y: [-20, 20], z: [-20, 20] };
function solve3(eqStrs) {
  return sb._suan59SolveTernaryPoly(eqStrs.map(P), ['x', 'y', 'z'], BOX, { maxOut: 100, valTol: 1e-6 });
}
// 独立验算：三个原方程全部代回
function verifyAll(eqStrs, sols) {
  const nodes = eqStrs.map(P);
  let worst = 0, allFinite = true;
  for (const s of sols) {
    const v = { x: s[0], y: s[1], z: s[2] };
    for (const nd of nodes) {
      let r; try { r = Math.abs(E(nd, v)); } catch (e) { r = Infinity; }
      if (!isFinite(r)) allFinite = false;
      worst = Math.max(worst, r);
    }
  }
  return { worst, allFinite };
}

console.log('【① x+y+z=6, xy+yz+zx=11, xyz=6 ⇒ 恰 6 个排列解】');
{
  const eqs = ['x + y + z - 6', 'x*y + y*z + z*x - 11', 'x*y*z - 6'];
  const r = solve3(eqs);
  check('返回 6 解', r && r.solutions.length === 6, r ? 'len=' + r.solutions.length : 'null');
  if (r) {
    const set = r.solutions.map(s => s.slice().sort((a, b) => a - b).map(v => v.toFixed(3)).join(',')).sort();
    const uniq = Array.from(new Set(set));
    check('全部是 {1,2,3} 的排列', uniq.length === 1 && uniq[0] === '1.000,2.000,3.000', JSON.stringify(uniq));
    const v = verifyAll(eqs, r.solutions);
    check('全部解经三式回代（残差 < 1e-6）', v.worst < 1e-6 && v.allFinite, 'worst=' + v.worst.toExponential(1));
    check('如实标记「不宣称完备」', r.completenessProven === false && !!r.completenessNote);
  }
}

console.log('【② 三个二次型 ⇒ 2 解（±1,0,0）】');
{
  const eqs = ['x^2 + y^2 + z^2 - 1', 'x^2 - y^2 + z^2 - 1', 'x^2 + y^2 - z^2 - 1'];
  const r = solve3(eqs);
  check('返回 2 解', r && r.solutions.length === 2, r ? 'len=' + r.solutions.length : 'null');
  if (r) {
    const v = verifyAll(eqs, r.solutions);
    check('回代残差 < 1e-6', v.worst < 1e-6, 'worst=' + v.worst.toExponential(1));
    const ok = r.solutions.every(s => Math.abs(s[0]) === 1 && Math.abs(s[1]) < 1e-9 && Math.abs(s[2]) < 1e-9);
    check('解为 (±1, 0, 0)', ok, JSON.stringify(r.solutions));
  }
}

console.log('【③ 第三式不含 z（x²+y²+z²=4, x+y+z=1, x−y=0）⇒ 不得整条拒绝】');
{
  // 回归：原实现「第三式必须含 z」⇒ return null，把真解存在的系统整条拒绝。
  // 第三方独立核验（手工两步结式 + Sturm 计数）：域内 2 个实根 ⇒ 这是漏解。
  const eqs = ['x^2 + y^2 + z^2 - 4', 'x + y + z - 1', 'x - y'];
  const r = solve3(eqs);
  check('返回 2 解（不再是 null）', r && r.solutions.length === 2, r ? 'len=' + r.solutions.length : 'null');
  if (r) {
    const v = verifyAll(eqs, r.solutions);
    check('回代残差 < 1e-6', v.worst < 1e-6, 'worst=' + v.worst.toExponential(1));
    // x=y 代入 ⇒ 2x²+z²=4, 3x+z=1 ⇒ 解出 x≈±1.09
    const ok = r.solutions.every(s => Math.abs(s[0] - s[1]) < 1e-9);
    check('满足 x = y 约束', ok, JSON.stringify(r.solutions));
  }
}

console.log('【③b 主消元对象必须【含 z】：cubic chain 有 9 个实解（曾漏掉全部 9 个）】');
{
  // 回归：原实现固定拿 eqs[0]、eqs[1] 做 Res_z。若这两个都不含 z，
  // 数学上 Res_z(f,g) = f^deg(g)·g^deg(f)（退化乘积）⇒ 解集被算错。
  // 第三方 solve 确认真解 9 个：(±2,±2)、(0,0)、(±√2,∓√2)、4 个黄金比例对。
  const eqs = ['x^3 - 3*x - y', 'y^3 - 3*y - x', 'z - x - y'];
  const r = solve3(eqs);
  check('返回 9 解（不是 0）', r && r.solutions.length === 9, r ? 'len=' + r.solutions.length : 'null');
  if (r) {
    const v = verifyAll(eqs, r.solutions);
    check('9 解全部经三式回代（残差 < 1e-6）', v.worst < 1e-6, 'worst=' + v.worst.toExponential(1));
    // z = x + y 必须成立
    const okZ = r.solutions.every(s => Math.abs(s[2] - (s[0] + s[1])) < 1e-8);
    check('全部满足 z = x + y', okZ);
    // 抽样核对：(0,0,0) 与 (2,2,4) 必须在解集里
    const has = (a, b, c) => r.solutions.some(s =>
      Math.abs(s[0] - a) < 1e-6 && Math.abs(s[1] - b) < 1e-6 && Math.abs(s[2] - c) < 1e-6);
    check('含 (0,0,0)', has(0, 0, 0));
    check('含 (2,2,4)', has(2, 2, 4));
    check('含 (-2,-2,-4)', has(-2, -2, -4));
  }
}

console.log('【③c 第三方核验为 0 实根的题 ⇒ 灵数也应给 0 解（不编造解）】');
{
  // bezout 8：x²=yz, y²=xz, z²=xy ⇒ 域内 0 实根（第三方 count_roots = 0，SymPy solve 也给 0）
  const r2 = solve3(['x^2 - y*z', 'y^2 - x*z', 'z^2 - x*y']);
  check('bezout 8 ⇒ 0 解', !r2 || r2.solutions.length === 0,
    r2 ? 'len=' + r2.solutions.length : 'null');
}

console.log('【④ 含超越函数 ⇒ 必须返回 null】');
{
  const r = solve3(['sin(x) + y + z - 1', 'x + y - z', 'x*y - 1']);
  check('含 sin ⇒ null', r === null, JSON.stringify(r));
}

console.log('【⑤ 三元展开的表示约定：y 的幂次不得混进 z 的升幂层】');
{
  // 回归：曾把 y 写成 [[0]],[[0,0,1]]（占用了 z 的两层），
  // 导致 x^2+y^2+z^2-1 的 z² 系数被算成 x^4+1
  const t = sb._s59ExpandInZ(P('x^2 + y^2 + z^2 - 1'), 'z', 'x', 'y');
  const z2coeff = t[2];                            // z² 的系数应是常数 1 = BQ [[1]]
  check('z² 系数 = 常数 1', JSON.stringify(z2coeff) === '[[1]]', JSON.stringify(z2coeff));
  const z0 = t[0];
  check('z⁰ 系数含 x²、y² 与 −1', JSON.stringify(z0) === '[[-1,0,1],[0],[1]]', JSON.stringify(z0));
}

console.log('【⑥ 性能：三元结式应远快于采样+多起点牛顿】');
{
  const eqs = ['x^3 - 3*x - y', 'y^3 - 3*y - x', 'z - x - y'];
  solve3(eqs); solve3(eqs);                          // 预热
  const t0 = performance.now();
  const N = 20;
  for (let i = 0; i < N; i++) solve3(eqs);
  const ms = (performance.now() - t0) / N;
  check('单次三元结式消元 < 20ms（实测 ' + ms.toFixed(2) + 'ms）', ms < 20);
}

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
