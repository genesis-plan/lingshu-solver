/**
 * 真题目端到端测试（不是玩具）。
 *
 * 与 test/ 下的断言式回归不同，这里跑的是**有标准答案的真实题目**，
 * 覆盖 Agent 客群最可能遇到的几类：
 *   A. 代数无理根（可手算真值）
 *   B. 超越方程（SymPy 给不出根，只能给 RootOf / 区间）
 *   C. 无解 / 严格证无解（诚实三档）
 *   D. 正维解族（域没证 ⇒ completeness 只能 unknown）
 *   E. 6 变量硬顶（边界）
 *   F. 大系数（根界救场：旧默认域 ±1e6 会静默判无解）
 *   G. 区间认证（能不能证明找到的解是真的）
 *
 * 每题都记：解数 / 数值 / tier / 认证 / completeness / 耗时 / 返回体字节。
 */
'use strict';

const svc = require('../services/solver-service.js');

const rows = [];
function rec(id, tag, note, fn) {
  const t0 = process.hrtime.bigint();
  let out;
  try {
    out = fn();
  } catch (e) {
    out = { error: (e && e.message) ? e.message : String(e), errorType: e && e.type };
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const r = out.result;
  const c = (r && r.trust && r.trust.completeness) || null;
  // ⚠ verify 路径返回体**形状不同**（verdict/candidate/corrected，没有 solutions/trust）。
  //   这里统一用可选链，写完一题才发现 Array.isArray(undefined).filter 炸了 ——
  //   教训：跨路径汇总的脚本必须先分清「有 solutions」与「无 solutions」两类返回体。
  const hasSols = !!(r && Array.isArray(r.solutions));
  rows.push({
    id, tag, note,
    error: out.error || null,
    errorType: out.errorType || null,
    shape: hasSols ? 'solve' : (r ? (r.verdict ? 'verify' : 'other') : 'none'),
    n: hasSols ? r.solutionCount : null,
    vals: hasSols ? r.solutions.map((s) => s.values) : null,
    tiers: hasSols ? r.solutions.map((s) => s.tier) : null,
    proven: hasSols ? r.solutions.filter((s) => s.tier === 'proven').length : null,
    trust: r && r.trust ? r.trust.trustLevel : null,
    comp: c ? c.status : null,
    du: c ? c.domainUnproven === true : null,
    verdict: r && r.verdict ? r.verdict : null,
    corrected: r && r.corrected ? r.corrected : null,
    ms: Math.round(ms * 1000) / 1000,
    bytes: r ? JSON.stringify(r).length : null,
  });
  return out;
}

const S = (eqs, vars, extra) => svc.doSolve(Object.assign({ equations: eqs, variables: vars }, extra || {}));

// ── A. 代数无理根（手算真值）────────────────────────────────────
rec('A1', '无理根', 'x^2=2 ⇒ ±1.41421356', () => ({ result: S(['x^2=2'], ['x']) }));
// ⚠ 题面注记要写对（A2 我自己写错过一次）：
//   x^2+y^2+z^2=6 & x*y=1 的解集**不是** 4 个孤立点。用 SymPy 核过
//   rank(J)=2<3 ⇒ 1 维连续曲线（代入 y=1/x 得 z²=6−x²−1/x²，x 在 [1,2] 连续可取）。
//   我一度以为「只给 1 解 = 漏解」，改代码前才发现是**我诊断错了**。
//   欠定系统只给 1 个代表点 + truncated=true + unknown 是**正确且诚实**的行为。
rec('A2', '正维流形', 'x²+y²+z²=6 & xy=1 ⇒ 1 维曲线（rank 2<3），给 1 代表点 + truncated', () => ({ result: S(['x^2+y^2+z^2=6', 'x*y=1'], ['x', 'y', 'z']) }));
rec('A3', '高次', 'x^5-x-1=0 ⇒ 唯一实根≈1.1673（SymPy 只能 RootOf）', () => ({ result: S(['x^5-x-1=0'], ['x']) }));
rec('A4', '分式', '1/x=2 ⇒ x=0.5（零次幂=负指数）', () => ({ result: S(['1/x=2'], ['x']) }));
rec('A5', '交叉', 'x^2+y^2=1, x*y=0 ⇒ 4 解（轴上四点）', () => ({ result: S(['x^2+y^2=1', 'x*y=0'], ['x', 'y']) }));

// ── B. 超越方程（SymPy 闭式给不出）─────────────────────────────
rec('B1', '超越', 'sin(x)=x ⇒ x=0（唯一实根，|x|≤1 可证）', () => ({ result: S(['sin(x)=x'], ['x']) }));
rec('B2', '超越', 'x*cos(x)-x=0', () => ({ result: S(['x*cos(x)-x=0'], ['x']) }));
rec('B3', '超越', 'x^2-sin(x)=0', () => ({ result: S(['x^2-sin(x)=0'], ['x']) }));
rec('B4', '超越', 'exp(x)-x^2-2=0', () => ({ result: S(['exp(x)-x^2-2=0'], ['x']) }));

// ── C. 无解 / 严格证无解 ───────────────────────────────────────
rec('C1', '无解', 'x^2+y^2+1=0 ⇒ 严格证无实解', () => ({ result: S(['x^2+y^2+1=0'], ['x', 'y']) }));
rec('C2', '无解', 'x^2+1=0 ⇒ 严格证无实解（univariate）', () => ({ result: S(['x^2+1=0'], ['x']) }));
rec('C3', '无解', 'x^2+y^2=1, x^2+y^2=2 ⇒ 矛盾', () => ({ result: S(['x^2+y^2=1', 'x^2+y^2=2'], ['x', 'y']) }));

// ── D. 正维解族（域证不出来）───────────────────────────────────
rec('D1', '正维', 'x=y ⇒ 无限解集（completeness 必须 unknown）', () => ({ result: S(['x=y'], ['x', 'y']) }));
rec('D2', '正维', 'x^3=y ⇒ 无界（域证不出）', () => ({ result: S(['x^3=y'], ['x', 'y']) }));
rec('D3', '显式域', 'x^2=2 + domain[1,2] ⇒ 漏负根（只找到 1 个）', () => ({ result: S(['x^2=2'], ['x'], { domain: { x: [1, 2] } }) }));

// ── E. 6 变量硬顶（n>6 必须 fail-closed）────────────────────────
rec('E1', '边界-已知超限', '6 变量 6 稠密二次（超出能力天花板：8s 预算耗尽 ⇒ 0 解 + truncated，须诚实）', () => ({
  result: S(['x+y+z+u+v+w=6', 'x*y+z*u+v*w=5', 'x*z+y*v+u*w=4', 'x*u+y*w+z*v=3', 'x*v+y*z+u*w=2', 'x*w+y*v+z*u=1'], ['x', 'y', 'z', 'u', 'v', 'w']),
}));
// 6 变量的**可达**形状：稀疏（每式 1 个乘积）164ms 就能解，稠密才爆。
// 记这一条是为了别把「6 变量」笼统说成不行 —— 差别在稀疏度。
rec('E1b', '边界-稀疏6元', '6 变量但稀疏（x*y=1 链式）⇒ 164ms 解出，不是所有 6 变量都超时', () => ({
  result: S(['x+y+z+u+v+w=6', 'x*y=1', 'y*z=1', 'z*u=1', 'u*v=1', 'v*w=1'], ['x', 'y', 'z', 'u', 'v', 'w']),
}));
rec('E2', '超限', '7 变量 ⇒ 必须 fail-closed（抛错不给近似）', () => ({
  result: S(['a+b+c+d+e+f+g=7', 'a*b+c*d+e*f+g*a=6'], ['a', 'b', 'c', 'd', 'e', 'f', 'g']),
}));

// ── F. 大系数（根界救场；旧默认域 ±1e6 会静默判无解）──────────
rec('F1', '大系数', 'x=1e11 ⇒ 根在旧域外（真 bug 回归）', () => ({ result: S(['x=1e11'], ['x']) }));
rec('F2', '大系数', 'x^2=1e13 ⇒ ±3162277.66', () => ({ result: S(['x^2=1e13'], ['x']) }));
rec('F3', '大系数', '100000*x=1 ⇒ x=1e-5（小系数也证）', () => ({ result: S(['100000*x=1'], ['x']) }));
rec('F4', '大系数', 'x^2-2*1e8*x+1e16=0 ⇒ (x-1e8)^2', () => ({ result: S(['x^2-2*1e8*x+1e16=0'], ['x']) }));

// ── G. 认证强度（tier 分层）────────────────────────────────────
rec('G1', '认证', 'x^3-2=0 ⇒ 立方根，Krawczyk 应能证', () => ({ result: S(['x^3-2=0'], ['x']) }));
rec('G2', '认证', 'x^6-1=0 ⇒ ±1 各 2 重根', () => ({ result: S(['x^6-1=0'], ['x']) }));
rec('G3', '认证', 'x^4+x+1=0 ⇒ 无实根', () => ({ result: S(['x^4+x+1=0'], ['x']) }));
rec('G4', '认证', 'x^5-1=0 ⇒ 唯一实根 x=1（应能证）', () => ({ result: S(['x^5-1=0'], ['x']) }));

// ── poly_roots 路径 ────────────────────────────────────────────
rec('P1', 'poly_roots', '[1,0,-2] ⇒ ±1.4142', () => ({ result: svc.doPolyRoots({ coefficients: [1, 0, -2] }) }));
rec('P2', 'poly_roots', '[1,-3,2] ⇒ 1,2', () => ({ result: svc.doPolyRoots({ coefficients: [1, -3, 2] }) }));
rec('P3', 'poly_roots', '[1,0,0,-1] ⇒ x=1', () => ({ result: svc.doPolyRoots({ coefficients: [1, 0, 0, -1] }) }));
rec('P4', 'poly_roots', '4 阶 [1,-10,35,-50,24] ⇒ 1,2,3,4（4 个实根）', () => ({ result: svc.doPolyRoots({ coefficients: [1, -10, 35, -50, 24] }) }));
rec('P5', 'poly_roots', '4 阶 [1,0,0,0,-1] ⇒ x=1（其余 3 个复根）', () => ({ result: svc.doPolyRoots({ coefficients: [1, 0, 0, 0, -1] }) }));

// ── verify 路径 ────────────────────────────────────────────────
function verdict(id, note, eq, cand) {
  rec(id, 'verify', note, () => ({ result: svc.doVerify({ equation: eq, candidate: cand }) }));
}
verdict('V1', '√2 正确值 ⇒ verified', 'x^2=2', 1.4142135623730951);
verdict('V2', '√2 错值 ⇒ refuted + 给纠正值', 'x^2=2', 1.5);
verdict('V3', '1 确是 x^2-1 根 ⇒ verified', 'x^2-1=0', 1);
verdict('V4', '2 不是 x^2-1 根 ⇒ refuted', 'x^2-1=0', 2);

// ── 打印 ───────────────────────────────────────────────────────
const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - String(s).length));
console.log('题号  类别      题面/说明');
console.log('─'.repeat(100));
let i = 0;
for (const r of rows) {
  i++;
  console.log(pad(r.id, 5) + pad(r.tag, 10) + r.note);
  if (r.error) {
    console.log('      ⇒ ❌ 抛错 ' + r.errorType + ': ' + r.error);
  } else if (r.shape === 'verify') {
    console.log('      ⇒ verdict=' + r.verdict
      + (r.corrected ? '  corrected=' + JSON.stringify(r.corrected) : '')
      + '  ' + r.ms + 'ms ' + r.bytes + 'B');
  } else if (r.shape === 'solve') {
    console.log('      ⇒ n=' + r.n + ' proven=' + r.proven + ' trust=' + r.trust
      + ' comp=' + r.comp + (r.du ? '(domainUnproven)' : '')
      + '  ' + r.ms + 'ms ' + r.bytes + 'B');
    if (r.vals) console.log('        vals=' + JSON.stringify(r.vals.map((v) => v.map((q) => typeof q === 'number' ? +q.toFixed(6) : q))));
  } else {
    console.log('      ⇒ ' + JSON.stringify(r).slice(0, 240));
  }
  console.log('');
}

require('fs').writeFileSync(__dirname + '/quiz_results.json', JSON.stringify(rows, null, 2));
console.log('共 ' + rows.length + ' 题；明细写入 test/benchmarks/quiz_results.json');
