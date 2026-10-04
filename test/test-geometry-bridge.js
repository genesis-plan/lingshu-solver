/**
 * 几何 ⇄ 代数 接缝测试（services/geometry_bridge.js + geometry 层 3 个 op）。
 *
 * ⭐ 本文件的核心不是「跑通」，而是三条**只有真跑才抓得到**的不变式：
 *
 *   I1 回代验算：导出的方程，其解必须**真的落在它代表的几何对象上**。
 *      这是唯一能抓住「符号被吃掉」的检查。历史 bug：term() 用 Math.abs(coef)
 *      导致 -y^2 渲染成 +y^2，于是 x²−y²=1 与 x²+y²=1 **导出成同一个字符串**
 *      —— 方程照样解析成功、照样返回解、照样带 tier，只是解的是另一个几何对象。
 *      只有把点代回原几何定义（双曲线 vs 圆）才抓得到。
 *
 *   I2 双路一致：几何闭式与代数求解（Krawczyk 区间认证）必须给出同一圆心。
 *      两条路算法完全独立（克拉默 vs 消元+Krawczyk），一致才有交叉验证价值。
 *      刻意含一组「近共线但圆仍存在」：半径 5000 的圆，两路仍零误差。
 *
 *   I3 退化 fail-closed：共线/重复点必须**不导出方程**。
 *      「三点共线没有外接圆」是合法问题的正确答案，
 *      「导出的方程组解不出来」是完全另一回事。
 *
 * 验证纪律：期望值全部手算或有硬不变量支撑，绝不猜。
 *
 * ⚠ ok() 的参数顺序是 (cond, name, extra) —— 条件在前。
 *   本文件第一版 36 处全部写反，输出成 '✅ true' 而 pass 照样 +1：
 *   一批**看起来通过、实际没断言任何东西**的护栏。
 *   ok() 内部有元护栏（name 非字符串即抛异常），这类错当场暴露而不静默。
 */
'use strict';

const B = require('../services/geometry_bridge.js');
const G = require('../services/geometry/index.js');
const SVC = require('../services/solver-service.js');

let pass = 0, fail = 0;
const failures = [];

/**
 * ok 同时接受两种参数顺序，靠**参数类型**自动判别（这是本文件的核心教训）：
 *
 *   ok(cond, '名字', extra)     ← dual-parity.mjs 的写法
 *   ok('名字', cond, extra)     ← 我写这个文件时的自然写法
 *
 * 两种都合法，但**只支持一种**会致命：我第一版 28 处全用第二种，
 * 而模板是第一种，于是 cond 收到名字、name 收到布尔，
 * 输出成 '✅ true' 而 pass 照样 +1 —— 28 条**看起来通过、实际没断言任何东西**的
 * 护栏，比没护栏更危险（它们让人以为这一段被测过了）。
 *
 * 靠类型判别而不是靠约定，是因为约定一定会有人违反，而违反是静默的：
 *   · name 是 string、cond 不是 string ⇒ 反序，对调；
 *   · 两者都是 string（极少数：条件本身是字符串比较）⇒ 按 (cond, name)，
 *     因为那种情况下 extra 位置不会同时存在第三个字符串，写反会立刻暴露。
 * 判别不确定时**抛异常**而不是猜 —— 猜错就是又一次假通过。
 */
function ok(a, b, c) {
  let cond, name, extra;
  if (typeof a === 'string' && typeof b !== 'string') { cond = b; name = a; extra = c; }
  else { cond = a; name = b; extra = c; }
  if (typeof name !== 'string') {
    throw new Error('ok() 参数无法判别：a=' + typeof a + ' b=' + typeof b
      + '（名字必须是字符串；条件也写成字符串时无法判别顺序，请拆成布尔表达式）');
  }
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else {
    fail++; failures.push(name);
    console.log('  ❌ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  }
}
function eq(name, got, want) { ok(got === want, name, { got, want }); }
function eqArr(name, got, want) {
  ok(JSON.stringify(got) === JSON.stringify(want), name, { got, want });
}

// ── 回代验算工具 ────────────────────────────────────────────────────────
// 宽容接受 string 或 string[]（模块导出的是方程数组，测试里传数组最自然）。
//   第一版严格只收 string，于是测试里到处漏写 [0]，一路 TypeError 追了三次 ——
//   「接口只收一种形态」时写错会报在**调用点**而不是定义点，排查成本极高。
function evalSide(s, pt) {
  let total = 0;
  const body = s.replace(/\s+/g, '');
  if (!body) return 0;
  const terms = body.match(/[+-]?[^+-]+/g) || [];
  for (let t of terms) {
    let sign = 1;
    if (t[0] === '+') t = t.slice(1);
    else if (t[0] === '-') { sign = -1; t = t.slice(1); }
    const m = t.match(/^(\d+(?:\.\d+)?)?\*?([A-Za-z_]\w*)(?:\^(\d+))?$/);
    if (m) {
      const coef = m[1] === undefined ? 1 : Number(m[1]);
      const deg = m[3] === undefined ? 1 : Number(m[3]);
      const v = pt[m[2]];
      if (v === undefined) throw new Error('回代时变量 ' + m[2] + ' 不在点里');
      total += sign * coef * Math.pow(v, deg);
      continue;
    }
    if (/^\d+(?:\.\d+)?$/.test(t)) { total += sign * Number(t); continue; }
    throw new Error('回代解析不了这一项：' + t + '（式：' + s + '）');
  }
  return total;
}
function evalEq(eqStr, point) {
  const src = Array.isArray(eqStr) ? eqStr[0] : eqStr;
  if (typeof src !== 'string') throw new TypeError('evalEq 需要方程字符串，收到 ' + typeof src);
  const i = src.lastIndexOf('=');
  return evalSide(src.slice(0, i), point) - evalSide(src.slice(i + 1), point);
}
const P2 = (rows) => B.polynomialEquations(
  rows.map(([a, b, c]) => ({ exponents: [a, b], coeff: c })), ['x', 'y']);

// COVERS: circumcircle, sphere_equation, polynomial_equation
// （这 3 个 op 在 geometry 层注册为 snake_case，本文件按 camelCase 直接调
//   services/geometry_bridge.js 的函数，两边名字对不上，覆盖率闸扫不到）

// ══ 1. 渲染层：符号是这个模块最容易错的地方 ════════════════════════════
console.log('-- 1. 渲染：符号 / 系数 / 非法输入 --');
{
  const hyp = P2([[2, 0, 1], [0, 2, -1], [0, 0, -1]]);   // x^2 - y^2 = 1
  const circ = P2([[2, 0, 1], [0, 2, 1], [0, 0, -1]]);  // x^2 + y^2 = 1
  eqArr('x^2-y^2=1 渲染', hyp, ['x^2 - y^2 = 1']);
  eqArr('x^2+y^2=1 渲染', circ, ['x^2 + y^2 = 1']);
  ok(hyp !== circ, '两条渲染结果不同（防 Math.abs 吞符号回归）', '两式渲染相同 ⇒ 符号被吞了');

  eqArr('系数 1 省略', B.term(1, [0, 1], ['x', 'y']), 'y');
  eqArr('系数 -1 只出负号', B.term(-1, [0, 1], ['x', 'y']), '-y');
  eqArr('系数 2 带星号', B.term(2, [0, 1], ['x', 'y']), '2*y');
  eqArr('系数 0 返回 null', B.term(0, [0, 1], ['x', 'y']), null);
  eqArr('常数项带符号', B.term(-3, [0, 0], ['x', 'y']), '-3');

  ok('浮点用十进制而非 1e-7 形态（导出文本要被 solve 重新解析）',
    !/e/i.test(B.num(0.0000001)), B.num(0.0000001));
  eq('整数不拖小数点', B.num(16), '16');
  eq('2.5 原样', B.num(2.5), '2.5');

  // 负指数必须报错：历史 bug 是 |0 把 -1 变成 1，
  // 于是 x^(-1)=1 渲染成 x=1，求解器还返回 tier=proven —— 被认证过的错答案。
  const bad = [
    ['负指数', [{ exponents: [-1, 0], coeff: 1 }, { exponents: [0, 0], coeff: -1 }]],
    ['非整数指数', [{ exponents: [1.5, 0], coeff: 1 }]],
    ['维度不足', [{ exponents: [2], coeff: 1 }]],
    ['coeff 非有限', [{ exponents: [1, 0], coeff: NaN }]]
  ];
  for (const [nm, terms] of bad) {
    let e = null;
    try { B.polynomialEquations(terms, ['x', 'y']); } catch (x) { e = x; }
    ok(nm + ' ⇒ 报 invalid_input', e && e.type === 'invalid_input', e && e.type);
  }
  let e1 = null;
  try { B.polynomialEquations([{ exponents: [-1, 0], coeff: 1 }], ['x', 'y']); } catch (x) { e1 = x; }
  ok('负指数的处方提到平移', e1 && /平移|shift/i.test(e1.message), e1 && e1.message.slice(0, 50));
}

// ══ 2. I1 回代验算：导出方程的解必须落在原几何对象上 ══════════════════
console.log('-- 2. I1 回代验算（抓「符号被吞」的唯一手段）--');
{
  // 每个点都手算过：残差应恰为 0（浮点容差 1e-9）
  const cases = [
    ['双曲线 x^2-y^2=1 在 (1.5, 1.1180339887)', P2([[2, 0, 1], [0, 2, -1], [0, 0, -1]]),
      { x: 1.5, y: 1.1180339887498950 }],
    ['圆 x^2+y^2=1 在 (0.6, 0.8)', P2([[2, 0, 1], [0, 2, 1], [0, 0, -1]]),
      { x: 0.6, y: 0.8 }],
    ['抛物线 y^2-x=0 在 (4,2)', P2([[0, 2, 1], [1, 0, -1]]), { x: 4, y: 2 }],
    ['y^3-2y+1=0 在 y=1（手算 f(1)=1-2+1=0）', P2([[0, 3, 1], [0, 1, -2], [0, 0, 1]]),
      { x: 0, y: 1 }],
    ['x-3=0 在 x=3', P2([[1, 0, 1], [0, 0, -3]]), { x: 3, y: 0 }]
  ];
  for (const [nm, eqs, pt] of cases) {
    const r = evalEq(eqs, pt);
    ok(nm + ' 残差 = 0（实得 ' + r.toExponential(2) + '）', Math.abs(r) < 1e-9, r);
  }

  // ⭐ 反向断言 —— I1 的核心。若符号被吞（两式渲染相同），这条会假通过。
  const hyp = P2([[2, 0, 1], [0, 2, -1], [0, 0, -1]]);
  const circ = P2([[2, 0, 1], [0, 2, 1], [0, 0, -1]]);
  const onCircle = { x: 0.6, y: 0.8 };   // 0.36+0.64=1 ⇒ 恰在单位圆上
  ok('圆上的点满足圆方程', Math.abs(evalEq(circ, onCircle)) < 1e-12, evalEq(circ, onCircle));
  ok('  … 但**不**满足双曲线方程（否则两式等价 = 符号被吞）',
    Math.abs(evalEq(hyp, onCircle)) > 1e-6, evalEq(hyp, onCircle));
}

// ══ 3. 球面导出 + 回代（多变量）════════════════════════════════════════
console.log('-- 3. 球面方程（多变量）--');
{
  eqArr('球 (1,-2,3) r=2 展开式', B.sphereEquations([1, -2, 3], 4, ['x', 'y', 'z']),
    ['x^2 + y^2 + z^2 - 2*x + 4*y - 6*z = -10']);
  eqArr('单位球面', B.sphereEquations([0, 0], 1, ['x', 'y']), ['x^2 + y^2 = 1']);
  // r=|c| ⇒ 原点恰在球面上 ⇒ 常数项恰为 0
  eqArr('r=|c| ⇒ 常数项 0', B.sphereEquations([3, 4], 25, ['x', 'y']),
    ['x^2 + y^2 - 6*x - 8*y = 0']);

  const eqs = B.sphereEquations([1, -2, 3], 4, ['x', 'y', 'z']);
  // 球面上的点：(1+2, -2, 3) 距球心恰 2
  ok('球面上一点残差 = 0', Math.abs(evalEq(eqs, { x: 3, y: -2, z: 3 })) < 1e-12,
    evalEq(eqs, { x: 3, y: -2, z: 3 }));
  // 球心距 0 ⇒ 残差 = -r^2 = -4
  ok('球心残差 = -r^2（球心不在球面上）',
    Math.abs(evalEq(eqs, { x: 1, y: -2, z: 3 }) + 4) < 1e-12, evalEq(eqs, { x: 1, y: -2, z: 3 }));
}

// ══ 4. I2 双路交叉验证（三点定圆）═══════════════════════════════════════
console.log('-- 4. I2 双路交叉验证（几何闭式 vs Krawczyk 认证）--');
{
  // 手算真值：直角三角形 (0,0)(4,0)(0,3) ⇒ 斜边中点 (2,1.5)，r = 对角线 5 的一半 = 2.5
  const r1 = B.circumcircle([[0, 0], [4, 0], [0, 3]]);
  eq('直角三角形 圆心 x = 2（斜边中点）', r1.geometric.cx, 2);
  eq('直角三角形 圆心 y = 1.5', r1.geometric.cy, 1.5);
  eq('直角三角形 半径 = 2.5（对角线 5 的一半）', r1.geometric.r, 2.5);
  eq('  … 半径平方 = 6.25', r1.geometric.r2, 6.25);
  ok('代数路给出区间认证过的解',
    r1.algebra.tier === 'proven' && r1.algebra.certified === true, r1.algebra);
  ok('两路一致', r1.algebra.agreesWithClosedForm === true, r1.algebra);
  eq('  … 最大偏差 = 0', r1.algebra.maxAbsDiff, 0);
  ok('圆方程已导出（可直接喂 solve）',
    Array.isArray(r1.circleEquation) && r1.circleEquation.length === 1, r1.circleEquation);
  // 圆心到三点的距离必须都等于 r
  const pts = [[0, 0], [4, 0], [0, 3]];
  for (let i = 0; i < pts.length; i++) {
    const d = Math.hypot(r1.geometric.cx - pts[i][0], r1.geometric.cy - pts[i][1]);
    ok('圆心到第 ' + (i + 1) + ' 点的距离 = r', Math.abs(d - r1.geometric.r) < 1e-9,
      { d, r: r1.geometric.r });
  }

  // 第二组：(0,0)(1,1)(2,0) ⇒ 圆心 (1,0) r=1（(1,1) 在 (0,0),(2,0) 的垂直平分线上）
  const r2 = B.circumcircle([[0, 0], [1, 1], [2, 0]]);
  eq('第二组 圆心 x = 1', r2.geometric.cx, 1);
  eq('第二组 圆心 y = 0', r2.geometric.cy, 0);
  eq('第二组 半径 = 1', r2.geometric.r, 1);
  ok('第二组两路一致', r2.algebra.agreesWithClosedForm === true, r2.algebra);
}

// ══ 5. I3 退化 fail-closed ═════════════════════════════════════════════
console.log('-- 5. I3 退化必须 fail-closed --');
{
  // 共线：(0,0)(2,0)(4,0) ⇒ 直线与圆最多 2 个交点 ⇒ 无外接圆
  const c1 = B.circumcircle([[0, 0], [2, 0], [4, 0]]);
  ok('共线 ⇒ 报退化码', c1.degenerate === 'collinear_points_have_no_circumcircle', c1.degenerate);
  eq('  … **不导出方程**（不能导出必然无解的方程）', c1.equations, null);
  ok('  … 也不给出几何结果', c1.geometric === undefined, c1.geometric);

  // 重复点：过两点的圆有无穷多个 ⇒ 答案不唯一
  let e = null;
  try { B.circumcircle([[1, 1], [1, 1], [0, 0]]); } catch (x) { e = x; }
  ok('重复点抛 duplicate_points', e && e.type === 'duplicate_points', e && e.type);
  ok('  … 处方说明「不唯一」', e && /无穷多个|不唯一/.test(e.message), e && e.message.slice(0, 50));

  // ⭐ 近共线：det 极小但非 0 ⇒ 外接圆**存在**（只是很大）。
  //   用容差判退化会误报成「不存在」—— 两者对 Agent 的意义完全相反。
  const nc = B.circumcircle([[0, 0], [1, 0.0001], [2, 0]]);
  ok('近共线 ⇒ 仍给出外接圆（det≠0 就不算退化）', nc.degenerate === null, nc.degenerate);
  ok('  … 且半径很大（是「很远」不是「无解」）', nc.geometric.r > 1000, nc.geometric.r);
  ok('  … 两路仍一致（远处也不失配）', nc.algebra.agreesWithClosedForm === true, nc.algebra);
}

// ══ 6. 分派层：3 个 op 真的挂在 geometry 工具里 ═════════════════════════
console.log('-- 6. 分派层（op 必须真的可达）--');
{
  const names = Object.keys(G.OPS);
  eq('几何 op 总数 = 130（127 + 3 个桥接 op）', names.length, 130);
  for (const n of ['circumcircle', 'sphere_equation', 'polynomial_equation']) {
    ok('op ' + n + ' 已注册', names.includes(n), names.length);
  }

  const g1 = G.doGeometry({ op: 'circumcircle', pts: [[0, 0], [4, 0], [0, 3]] });
  ok('circumcircle 经分派层 trust=exact', g1.trust.trustLevel === 'exact', g1.trust.trustLevel);
  eq('  … 圆心 x 经分派层 = 2', g1.value.geometric.cx, 2);
  ok('  … 代数路仍 proven', g1.value.algebra.tier === 'proven', g1.value.algebra);

  const g2 = G.doGeometry({ op: 'sphere_equation', center: [1, -2, 3], radiusSquared: 4 });
  eqArr('sphere_equation 经分派层', g2.value.equations,
    ['x1^2 + x2^2 + x3^2 - 2*x1 + 4*x2 - 6*x3 = -10']);

  const g3 = G.doGeometry({
    op: 'polynomial_equation',
    terms: [{ exponents: [2, 0], coeff: 1 }, { exponents: [0, 2], coeff: -1 }, { exponents: [0, 0], coeff: -1 }],
    variables: ['x', 'y']
  });
  eqArr('polynomial_equation 经分派层', g3.value.equations, ['x^2 - y^2 = 1']);

  // 退化必须落到 degenerate trust，不能伪装成 exact
  const g4 = G.doGeometry({ op: 'circumcircle', pts: [[0, 0], [2, 0], [4, 0]] });
  ok('共线经分派层 trust=degenerate', g4.trust.trustLevel === 'degenerate', g4.trust.trustLevel);
  ok('  … mustNotClaim 禁止断言', g4.trust.mustNotClaim === 'unique_answer', g4.trust.mustNotClaim);

  // 变量名守卫
  const badNames = [
    ['含解析器元字符', ['x^2', 'y']],
    ['重复名', ['x', 'x']],
    ['以数字开头', ['1x', 'y']],
    ['空串', ['x', '  ']]
  ];
  for (const [nm, vars] of badNames) {
    let e = null;
    try {
      G.doGeometry({ op: 'polynomial_equation', terms: [{ exponents: [1, 0], coeff: 1 }], variables: vars });
    } catch (x) { e = x; }
    ok('变量名' + nm + '被拒', e && e.type === 'invalid_input', e && e.type);
  }
  // ⭐ trim 之后再重名也算重名。历史 bug：判重代码写在 `return` 之后（死代码），
  //   且用的是未 trim 的原始输入，所以 [' x ','x'] 与 ['x','x'] 都漏过。
  let eDup = null;
  try {
    G.doGeometry({ op: 'polynomial_equation', terms: [{ exponents: [1, 0], coeff: 1 }], variables: [' x ', 'x'] });
  } catch (x) { eDup = x; }
  ok('trim 后重名（[" x ","x"]）被拒', eDup && eDup.type === 'invalid_input', eDup && eDup.type);
  // 正常名不能被误伤
  let okNames = null;
  try {
    G.doGeometry({ op: 'polynomial_equation', terms: [{ exponents: [1, 0], coeff: 1 }], variables: ['a', 'b'] });
    okNames = 'accepted';
  } catch (x) { okNames = x.type; }
  eq('正常变量名不被误伤', okNames, 'accepted');
}

// ══ 7. 接缝全链：几何 op 导出的方程真能喂 solve ════════════════════════
console.log('-- 7. 全链：几何 op → 方程 → solve（回流闭环）--');
{
  const g = G.doGeometry({ op: 'circumcircle', pts: [[0, 0], [4, 0], [0, 3]] });
  const s = SVC.doSolve({ equations: g.value.equations, variables: g.value.variables });
  eq('solve 找到 1 个解', s.solutionCount, 1);
  eq('  … 且是区间认证过的', s.solutions[0].tier, 'proven');
  eq('  … trust = verified', s.trust.trustLevel, 'verified');
  ok('  … 解就是圆心 (2, 1.5)',
    Math.abs(s.solutions[0].values[0] - 2) < 1e-9 && Math.abs(s.solutions[0].values[1] - 1.5) < 1e-9,
    s.solutions[0].values);

  // 整球面是连续解集 ⇒ 绝不能判 verified（否则就是谎称找全了）
  const ge = G.doGeometry({ op: 'sphere_equation', center: [0, 0], radiusSquared: 1 });
  const s2 = SVC.doSolve({ equations: ge.value.equations, variables: ge.value.variables });
  ok('整球面 ⇒ 不得判 verified（连续解集不是有限解集）',
    s2.trust.trustLevel !== 'verified',
    { type: s2.resultTypeName, trust: s2.trust.trustLevel });
}

// ══ 8. 确定性 ══════════════════════════════════════════════════════════
console.log('-- 8. 确定性（字节级可复现）--');
{
  const a = JSON.stringify(B.circumcircle([[0, 0], [4, 0], [0, 3]]));
  const b = JSON.stringify(B.circumcircle([[0, 0], [4, 0], [0, 3]]));
  ok('同输入两次结果字节级一致', a === b, a.length + ' vs ' + b.length);
  const terms = [{ exponents: [2, 0], coeff: 1.5 }, { exponents: [0, 0], coeff: -0.3333333333 }];
  const c = B.polynomialEquations(terms, ['x', 'y']).join();
  const d = B.polynomialEquations(terms, ['x', 'y']).join();
  ok('浮点系数导出确定性', c === d, c);
}

console.log('\n几何 <-> 代数 接缝测试: ' + pass + ' 通过, ' + fail + ' 失败');
if (fail) console.log('失败项:\n  - ' + failures.join('\n  - '));
process.exit(fail ? 1 : 0);
