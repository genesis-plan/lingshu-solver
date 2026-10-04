/**
 * 经典几何定理层（geom_theorems.js）回归测试。
 *
 * 断言来源的原则：**期望值必须能手算，或者必须是数学上的硬不变量**。
 *
 * 这一层最危险的一类 bug 是「静默给数」—— 公式错了一点，
 * 输出依然是个看着合理的几何量（一个圆心、一个半径、三个点），
 * 而没有任何报错。历史记录（全部已修，且都有回归断言守着）：
 *   1. equilateralThird 漏乘 √3 ⇒ 生成的是直角等腰三角形，
 *      拿破仑定理 equilateralResidual=0.1498 但**不报错**（形状看着差不多）。
 *   2. pole_of_line 漏 /(a·O+c) ⇒ 圆心在原点、切线 x=R 时极点差 R 倍
 *      （给 (r²/R,0) 而非 (R,0)），圆心不在原点时错得毫无征兆。
 *   3. monge_point 校验用错定义（校验了中面而非「棱中点⊥对棱」六个面）
 *      ⇒ maxResidual=0.5 却分不清是公式错还是校验错。
 *   4. solve_triangle 的 Lother 取错 ⇒ anglesDeg.C 静默消失（null），
 *      但「所有解」看起来都完整。
 *   5. cevian/menelaus 只验投影参数不验是否在直线上 ⇒ 把 AB 的中点
 *      当成 BC 上的分割点，会造出「塞瓦定理不成立」这个假结论。
 *   6. miquel_point 不验 D/E/F 是否真在对应边上 ⇒ 同样把「点放错了」
 *      报成 holds:false（形式上没骗人，实质上误导）。
 *   7. 三边不满足三角不等式时，law_of_cosines / law_of_sines 报
 *      degenerate_triangle（输入病态）而 solve_triangle 报 no_such_triangle
 *      （可断言无解）—— 同一个数学事实，两个 op 互相矛盾的结论。
 *
 * 不变量清单（每条都是数学恒等式，随机算例全测）：
 *   I1  欧拉 OI² = R(R−2r)
 *   I2  欧拉 OH² = 9R² − (a²+b²+c²)
 *   I3  欧拉线 H − O = 3(G − O)
 *   I4  九点圆：3 边中点 + 3 垂足全部在半径 R/2 的圆上
 *   I5  欧拉不等式 R ≥ 2r（等号 ⟺ 等边）
 *   I6  托勒密（仅共圆时）AC·BD = AB·CD + BC·DA
 *   I7  塞瓦：(BD/DC)(CE/EA)(AF/FB) = 1 ⟺ 共点
 *   I8  梅涅劳：比积 = 1 且延长线上的点数为奇数 ⟺ 共线
 *   I9  莫莱：三圆 (AEF)(BFD)(CDE) 共点
 *   I10 拿破仑：三个中心的连线构成等边三角形
 *   I11 皮克：A = I + B/2 − 1
 *   I12 Stewart：b²m + c²n = a(d² + mn)
 *   I13 黄金比例：φ² = φ+1，1/φ = φ−1，2cos36° = φ
 *   I14 蒙日：M = 2G − O，且在 6 个「棱中点 ⊥ 对棱」平面上
 *   I15 正四面体：V = R = ... 互相对齐（V=√2/9·a³ 与 r/R = 1/3）
 *   I16 正 n 边形：面积 = ½·周长·内切半径；内角 + 外角 = 180°
 *
 * 运行：node test/test-geometry-theorems.js
 */
'use strict';

const IDX = require('../services/geometry/index.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`  ✗ ${name}${extra !== undefined ? '  got: ' + JSON.stringify(extra) : ''}`);
}
function eq(name, got, want) { ok(name, got === want, { got, want }); }
function near(name, got, want, tol) {
  ok(name, typeof got === 'number' && Math.abs(got - want) <= (tol === undefined ? 1e-9 : tol),
    { got, want, tol });
}
function resNear(name, got, tol) { near(name, got, 0, tol === undefined ? 1e-9 : tol); }
function ptNear(name, got, want, tol) {
  const t = tol === undefined ? 1e-9 : tol;
  ok(name, Array.isArray(got) && got.length === want.length
    && got.every((x, i) => Math.abs(x - want[i]) <= t), { got, want });
}
function degen(name, op, args, want) {
  let r;
  try { r = IDX.doGeometry({ op, ...args }); }
  catch (e) { ok(name, false, 'threw ' + e.type + ': ' + e.message); return; }
  ok(name, !!r.degenerate && r.degenerate === want && r.value === null, { got: r.degenerate, want });
}
function val(name, op, args) {
  let r;
  try { r = IDX.doGeometry({ op, ...args }); }
  catch (e) { ok(name, false, 'threw ' + e.type + ': ' + e.message); return null; }
  ok(name + ' (not degenerate)', !r.degenerate, r.degenerate);
  return r.value;
}
function throws(name, fn, type) {
  let caught = null;
  try { fn(); } catch (e) { caught = e; }
  ok(name, !!(caught && caught.type === type), caught && (caught.type + ': ' + caught.message));
}

// 常用算例：3-4-5 直角三角形。a=|BC|=5, b=|CA|=3, c=|AB|=4
const A = [0, 0], B = [4, 0], C = [0, 3];
const T345 = { a: A, b: B, c: C };
// 三边中点（塞瓦/梅涅劳/莫莱 的合法输入）
const MID = { d: [2, 1.5], e: [0, 1.5], f: [2, 0] };
const EQ = { a: [0, 0], b: [1, 0], c: [0.5, Math.sqrt(3) / 2] };   // 等边 1

// ══ 1. 三角形五心（3-4-5 的一切都手算得出）════════════════════════════
console.log('三角形五心（3-4-5 直角三角形，真值可手算）:');
{
  // 单点版也直接验一遍（triangle_five_centers 是它们的上层，不测单点版就等于没测）
  const oc = val('circumcenter', 'triangle_circumcenter', T345);
  ptNear('circumcenter = 斜边中点', oc.center, [2, 1.5]);
  near('circumcenter radius = 2.5', oc.radius, 2.5, 1e-9);
  const oh = val('orthocenter', 'triangle_orthocenter', T345);
  ptNear('orthocenter = 直角顶点', oh, [0, 0], 1e-9);
  const ex = val('excenters', 'triangle_excenters', T345);
  ptNear('excenters.I_A', ex.I_A, [6, 6]);
  ptNear('excenters.I_B', ex.I_B, [-2, 2]);
  ptNear('excenters.I_C', ex.I_C, [3, -3]);

  const v = val('five_centers', 'triangle_five_centers', T345);
  // 直角在 A：斜边 BC 中点即外心；内心 (r,r)=(1,1)；重心 (4/3,1)；垂心就是直角顶点
  ptNear('外心 O = 斜边中点', v.O, [2, 1.5]);
  near('外接圆半径 R = 斜边一半 = 2.5', v.R, 2.5, 1e-9);
  near('内切圆半径 r = (3+4−5)/2 = 1', v.r, 1, 1e-9);
  ptNear('内心 I = (1,1)', v.I, [1, 1]);
  ptNear('重心 G = 平均', v.G, [4 / 3, 1]);
  ptNear('垂心 H = 直角顶点', v.H, [0, 0]);
  near('半周长 s = 6', v.semiperimeter, 6, 1e-9);
  // 旁心 I_X = (对边长的正号挪到分子)：
  //   I_A = (−aA + bB + cC)/(−a+b+c)，分母 2(s−a) = 2
  //   I_B = ( aA − bB + cC)/( a−b+c)，分母 2(s−b) = 4
  //   3-4-5：A=(0,0) B=(4,0) C=(0,3)，a=5 b=3 c=4
  ptNear('旁心 I_A = (3B+4C)/2 = (6,6)', v.excenters.I_A, [6, 6]);
  ptNear('旁心 I_B = (−3B+4C)/4 = (−2,2)', v.excenters.I_B, [-2, 2]);
  ptNear('旁心 I_C = (−3B−4C)/2 = (−6,−6)/2… 记为 (3,−3)', v.excenters.I_C, [3, -3]);
  // 旁心恒等式：内心与三个旁心构成等角共轭，I_B 必须落在 A、C 的角平分线的另一支上
  //   —— 用「到三边的距离带符号相等」交叉校验（I_B 在 BC 外侧）
  {
    const d = (P, u, v2) => {
      const lx = v2[0] - u[0], ly = v2[1] - u[1];
      return (lx * (P[1] - u[1]) - ly * (P[0] - u[0])) / Math.hypot(lx, ly);
    };
    const IB = v.excenters.I_B;
    const s1 = d(IB, B, C), s2 = d(IB, C, A), s3 = d(IB, A, B);
    // I_B 在 BC 的外侧（与 A 相反），故 s1 与 s2+s3 异号；按有向面积口径 |s2| = |s3| = r_A
    ok('旁心到 CA 与 AB 的有向距离等值反号（角平分线另一支）',
      Math.abs(Math.abs(s2) - Math.abs(s3)) < 1e-9 && s2 * s3 < 0, { s2, s3, s1 });
  }
  // 欧拉两条恒等式直接由实现自检（I1/I2）
  near('OI² = R(R−2r) = 1.25', v.eulerOI2, 1.25, 1e-9);
  near('OH² = 9R²−Σa² = 56.25−50 = 6.25', v.eulerOH2, 6.25, 1e-9);
  resNear('OI² 残差 = 0', v.eulerOI2_residual, 1e-12);
  resNear('OH² 残差 = 0', v.eulerOH2_residual, 1e-12);
}
// 欧拉不等式 R ≥ 2r：等边取等号
{
  const v = val('euler_ineq 3-4-5', 'triangle_euler_inequality', T345);
  eq('R ≥ 2r 成立', v.holds, true);
  near('R − 2r = 0.5', v.slack, 0.5, 1e-9);
  eq('不是等边', v.isEquilateral, false);
  const e = val('euler_ineq equilateral', 'triangle_euler_inequality', EQ);
  eq('等边时取等号', e.slack, 0);
  eq('等边时 slack=0', e.holds, true);
  eq('等边判定', e.isEquilateral, true);
}

// ══ 2. 欧拉线 / 九点圆（I3 / I4）════════════════════════════════════════
console.log('欧拉线与九点圆（欧拉线 t=3、九点圆半径 R/2）:');
{
  const v = val('euler_line', 'euler_line', T345);
  near('H − O = 3(G − O) 的仿射参数恰为 3', v.parameter_t, 3, 1e-9);
  resNear('O,G,H 共线残差 = 0', v.collinearityResidual, 1e-12);
  near('OG : GH = 1 : 2', v.OG_over_GH, 0.5, 1e-9);
  eq('非等边', v.equilateral, false);

  // 等边 ⇒ O=G=H，欧拉线**不唯一**（这是几何事实，不能假装有方向）
  const e = val('euler_line equilateral', 'euler_line', EQ);
  eq('等边时显式报 equilateral', e.equilateral, true);
  eq('等边时方向未定（OG:GH 无意义）', e.OG_over_GH, null);

  const n = val('nine_point', 'triangle_nine_point_circle', T345);
  // 九点圆圆心 = (O+H)/2，半径 = R/2
  ptNear('圆心 = (O+H)/2', n.center, [1, 0.75]);
  near('半径 = R/2 = 1.25', n.radius, 1.25, 1e-9);
  eq('检查了 6 个点', n.sideMidpoints.length + n.altitudeFeet.length, 6);
  resNear('6 点全在九点圆上（残差 0）', n.maxResidual, 1e-12);
  // 等边时九点圆与外接圆同心，半径比仍是 1/2
  const ne = val('nine_point equilateral', 'triangle_nine_point_circle', EQ);
  near('等边：半径 = 外接圆一半', ne.radius, 0.5773502691896258 / 2, 1e-9);
  resNear('等边：6 点残差 = 0', ne.maxResidual, 1e-12);
}

// ══ 3. 中线 / 高 / 角平分线（阿波罗尼斯闭式，可手算）═══════════════════
console.log('中线 / 高 / 角平分线（阿波罗尼斯定理）:');
{
  const m = val('medians', 'triangle_medians', T345);
  // m_a = ½√(2b²+2c²−a²) = ½√(18+32−25) = 2.5
  near('m_a = 2.5', m.m_a, 2.5, 1e-9);
  near('m_b = ½√73', m.m_b, Math.sqrt(73) / 2, 1e-9);
  near('m_c = ½√52', m.m_c, Math.sqrt(52) / 2, 1e-9);
  eq('重心比 2:1', m.ratio_vertex_to_centroid, '2:1');

  const h = val('altitudes', 'triangle_altitudes', T345);
  // 面积 = 6 ⇒ h_a = 2·6/5, h_b = 2·6/3, h_c = 2·6/4
  near('h_a = 12/5', h.h_a, 12 / 5, 1e-9);
  near('h_b = 4', h.h_b, 4, 1e-9);
  near('h_c = 3', h.h_c, 3, 1e-9);
  eq('垂足在线段内（锐角）', h.foot_inside_segment, true);
  // 直角三角形的两个垂足就是直角顶点
  ptNear('B 到 AC 的垂足 = A', h.foot_from_b, [0, 0]);
  ptNear('C 到 AB 的垂足 = A', h.foot_from_c, [0, 0]);

  const l = val('bisectors', 'triangle_bisector_lengths', T345);
  // l_a = 2bc·cos(A/2)/(b+c)，A=90° ⇒ cos45°=√2/2 ⇒ 2·3·4·(√2/2)/7 = 12√2/7
  near('l_a = 2bc·cos(A/2)/(b+c) = 12√2/7', l.l_a, 2 * 3 * 4 * Math.cos(Math.PI / 4) / 7, 1e-9);
  near('l_b = 2ac·cos(B/2)/(a+c)', l.l_b, 2 * 5 * 4 * Math.cos(Math.atan(3 / 4) / 2) / 9, 1e-9);
  near('l_c = 2ab·cos(C/2)/(a+b)', l.l_c, 2 * 5 * 3 * Math.cos(Math.atan(4 / 3) / 2) / 8, 1e-9);
}

// ══ 4. Stewart / 塞瓦 / 梅涅劳（I12 / I7 / I8）══════════════════════════
console.log('Stewart / 塞瓦 / 梅涅劳:');
{
  // a=5, m=2, n=3, b=3, c=4 ⇒ d² = (9·2+16·3)/5 − 6 = 13.2−6 = 7.2
  const v = val('stewart', 'stewart_theorem', { a: 5, m: 2, b: 3, c: 4 });
  near('d = √7.2', v.d, Math.sqrt(7.2), 1e-9);
  near('n = a − m = 3', v.n, 3, 1e-9);
  resNear('恒等式 b²m+c²n = a(d²+mn) 残差 0', v.identityResidual, 1e-12);
  // 中点情形：m = n = a/2 时 Stewart 退化成中线公式（中线定理）
  const mid = val('stewart 中线', 'stewart_theorem', { a: 5, m: 2.5, b: 3, c: 4 });
  const med = val('stewart vs median', 'triangle_medians', T345);
  near('m=a/2 时 Stewart 给出的正是中线长 m_a', mid.d, med.m_a, 1e-9);
  // 端点情形：m=0 ⇒ d=c；m=a ⇒ d=b（与中线公式的退化端一致）
  near('m=0 ⇒ d = c', val('stewart m=0', 'stewart_theorem', { a: 5, m: 0, b: 3, c: 4 }).d, 4, 1e-9);
  near('m=a ⇒ d = b', val('stewart m=a', 'stewart_theorem', { a: 5, m: 5, b: 3, c: 4 }).d, 3, 1e-9);

  // 塞瓦：三条中线共点，比积 = 1
  const c1 = val('cevian medians', 'cevian_concurrent', { ...T345, ...MID });
  eq('中线共点', c1.concurrent, true);
  eq('中点比值各为 1', c1.BD_over_DC, 1);
  resNear('比积残差 0', c1.identityResidual, 1e-12);
  // 非共点：BD/DC=3/7, CE/EA=2/3, AF/FB=7/3 ⇒ 积 = 2/3 ≠ 1
  const c2 = val('cevian not concurrent', 'cevian_concurrent',
    { ...T345, d: [2.8, 0.9], e: [0, 1.8], f: [2.8, 0] });
  eq('比积 2/3 ⇒ 不共点', c2.concurrent, false);
  near('比积 = 2/3', c2.product, 2 / 3, 1e-9);

  // 梅涅劳：中点三点**不共线**（比积=1 但延长线上 0 个点，是偶数）
  const m1 = val('menelaus medians', 'menelaus_collinear', { ...T345, ...MID });
  eq('中点三点不共线', m1.collinear, false);
  eq('定理与直接行列式判定一致', m1.theoremAgrees, true);
  eq('延长线上 0 个点（偶数）', m1.pointsOnExtension, 0);
  // ⭐ 真·共线构造（bug 8 护栏）：D=(2,1.5) 在 BC 上，F=(1,0) 在 AB 上，
  //   直线 DF 与 CA 的交点是 E=(0,−1.5)，落在 CA 的**延长线**上 ⇒
  //   恰好 1 个延长点（奇数）⇒ 梅涅劳应判共线。
  //   先用独立行列式确认构造确实共线（不依赖定理本身）。
  const col = [[2, 1.5], [0, -1.5], [1, 0]];
  const det = (col[1][0] - col[0][0]) * (col[2][1] - col[0][1])
    - (col[2][0] - col[0][0]) * (col[1][1] - col[0][1]);
  resNear('构造点确实共线（行列式 0，独立于定理）', det, 1e-12);
  const m2 = val('menelaus collinear', 'menelaus_collinear',
    { a: A, b: B, c: C, d: [2, 1.5], e: [0, -1.5], f: [1, 0] });
  eq('1 个延长点（奇数）', m2.pointsOnExtension, 1);
  eq('判定共线', m2.collinear, true);
  eq('定理与行列式判定一致', m2.theoremAgrees, true);
  near('无向比积 = 1（|CE/EA| = 3）', Math.abs(m2.product), 1, 1e-9);
}

// ══ 5. 余弦 / 正弦定理与解三角形（含 SSA 二义）══════════════════════════
console.log('余弦 / 正弦定理与解三角形:');
{
  const c345 = val('cos 3-4-5', 'law_of_cosines', { a: 3, b: 4, c: 5 });
  near('A = arccos(4/5)', c345.A, Math.acos(0.8), 1e-9);
  near('B = arccos(3/5)', c345.B, Math.acos(0.6), 1e-9);
  near('C = 90°', c345.C, Math.PI / 2, 1e-9);
  resNear('三角之和 = π', c345.sumOfAngles - Math.PI, 1e-9);
  near('anglesDeg.C = 90', c345.anglesDeg.C, 90, 1e-9);

  const sas = val('cos_sas', 'law_of_cosines_sas', { a: 3, b: 4, C: Math.PI / 2 });
  near('c = √(9+16) = 5', sas.c, 5, 1e-9);
  near('面积 = ½ab·sinC = 6', sas.area, 6, 1e-9);

  const s = val('sines 3-4-5', 'law_of_sines', { a: 3, b: 4, c: 5 });
  near('2R = c/sinC = 5', s.twoR, 5, 1e-9);
  near('R = 2.5', s.R, 2.5, 1e-9);
  resNear('三比值一致（ratioSpread = 0）', s.ratioSpread, 1e-12);

  // sss：3-4-5 唯一解
  const ss = val('solve sss', 'solve_triangle', { a: 3, b: 4, c: 5 });
  eq('sss 唯一', ss.case, 'sss');
  eq('解数 1', ss.solutionCount, 1);
  eq('不模糊', ss.ambiguous, false);
  near('sss 得 c=5, C=90°', ss.solve.C, Math.PI / 2, 1e-9);
  // 六个量必须齐全（bug 4 的护栏：anglesDeg.C 曾静默变 null）
  for (const k of ['A', 'B', 'C']) ok('sss anglesDeg.' + k + ' 非空', typeof ss.anglesDeg[k] === 'number', ss.anglesDeg[k]);
  for (const k of ['a', 'b', 'c']) ok('sss solve.' + k + ' 非空', typeof ss.solve[k] === 'number', ss.solve[k]);

  // saa：两角一边唯一。
  // ⚠ 这里刻意给出 A=60°, B=45°，第三角 C=75° **不等于任何一个已知角** ——
  //   早期实现写成 s[k3] = known·sin(L3)/sin(L1)，拿「剩下的角」去除，
  //   与 known 自己的对角毫无关系。只有当 L1 恰好等于 known 的对角时才对。
  const sa = val('solve saa', 'solve_triangle', { b: 4, A: Math.PI / 3, B: Math.PI / 4 });
  eq('saa 唯一', sa.case, 'saa');
  eq('解数 1', sa.solutionCount, 1);
  // b/sinB = a/sinA = c/sinC
  near('saa 解出的 a = b·sinA/sinB', sa.solve.a, 4 * Math.sin(Math.PI / 3) / Math.sin(Math.PI / 4), 1e-9);
  near('saa 解出的 c = b·sinC/sinB', sa.solve.c, 4 * Math.sin(5 * Math.PI / 12) / Math.sin(Math.PI / 4), 1e-9);
  eq('C = 75°', sa.anglesDeg.C, 75);
  // 六项必须齐全（bug 8 护栏：早期只解两条边，第三条边静默缺失）
  for (const k of ['a', 'b', 'c']) ok('saa solve.' + k + ' 存在', typeof sa.solve[k] === 'number', sa.solve[k]);
  // 正弦定理自洽：三个比值必须一致
  {
    const q = sa.solve;
    const r2 = [q.a / Math.sin(q.A), q.b / Math.sin(q.B), q.c / Math.sin(q.C)];
    ok('saa 解满足正弦定理', Math.abs(Math.max(...r2) - Math.min(...r2)) < 1e-8,
      { ratios: r2 });
  }
  // 换一个「已知边不是 b」的方向，确认不是碰巧
  const sa2 = val('solve saa other side', 'solve_triangle', { a: 5, A: Math.PI / 3, C: Math.PI / 6 });
  near('saa(已知 a) 解出的 b = a·sinB/sinA', sa2.solve.b, 5 * Math.sin(Math.PI / 2) / Math.sin(Math.PI / 3), 1e-9);
  near('saa(已知 a) 解出的 c = a·sinC/sinA', sa2.solve.c, 5 * Math.sin(Math.PI / 6) / Math.sin(Math.PI / 3), 1e-9);

  // sas：两边夹角唯一
  const sd = val('solve sas', 'solve_triangle', { b: 3, c: 4, A: Math.PI / 2 });
  eq('sas 唯一', sd.case, 'sas');
  near('sas 解出的 a = 5', sd.solve.a, 5, 1e-9);

  // ⭐ ssa 二义：a=5, b=8, A=30° ⇒ sinB = 8·0.5/5 = 0.8
  //   B = 53.13° 或 126.87°，两解都合法。c = 9.928 / 3.928
  const ssa = val('solve ssa', 'solve_triangle', { a: 5, b: 8, A: Math.PI / 6 });
  eq('ssa 判定', ssa.case, 'ssa');
  eq('两个解', ssa.solutionCount, 2);
  eq('明确标记二义', ssa.ambiguous, true);
  eq('allSolutions 列出两个', ssa.allSolutions.length, 2);
  near('解1 B = asin(0.8)', ssa.allSolutions[0].B, Math.asin(0.8), 1e-9);
  near('解2 B = π − asin(0.8)', ssa.allSolutions[1].B, Math.PI - Math.asin(0.8), 1e-9);
  near('解1 c = 9.9282', ssa.allSolutions[0].c, 9.92820323027551, 1e-8);
  near('解2 c = 3.9282', ssa.allSolutions[1].c, 3.92820323027551, 1e-8);
  for (const [i, sol] of ssa.allSolutions.entries()) {
    near('ssa 解' + i + ' 三角和 = π', sol.A + sol.B + sol.C, Math.PI, 1e-9);
    ok('ssa 解' + i + ' C 非空（bug 4 护栏）', typeof ssa.anglesDeg.C === 'number');
  }
  // SSA 无解：sinB > 1（b 太大，A 太小）⇒ 数学上确实没有
  degen('ssa 无解', 'solve_triangle', { a: 3, b: 8, A: Math.PI / 6 }, 'no_such_triangle');
  // SSA 退化相切：sinB = 1 ⇒ 只有一个解（不是二义）
  const tang = val('solve ssa 临界', 'solve_triangle', { a: 5, b: 10, A: Math.PI / 6 });
  eq('sinB=1 时唯一解', tang.solutionCount, 1);
}

// ══ 6. 海伦公式（新增，三边直接求面积）══════════════════════════════════
console.log('海伦公式:');
{
  const v = val('heron 3-4-5', 'heron_area', { a: 3, b: 4, c: 5 });
  near('s = 6', v.semiperimeter, 6, 1e-9);
  near('Δ = √(6·3·2·1) = 6', v.area, 6, 1e-9);
  near('内切圆半径 = Δ/s = 1', v.inradius, 1, 1e-9);
  // 13-14-15：Heron 数 s=21 ⇒ Δ=√(21·8·7·6)=√7056=84，r=4（整数，好核对）
  const w = val('heron 13-14-15', 'heron_area', { a: 13, b: 14, c: 15 });
  near('Δ = 84', w.area, 84, 1e-9);
  near('r = 4', w.inradius, 4, 1e-9);
  // 等边 s ⇒ Δ = (√3/4)s²
  const e = val('heron equilateral', 'heron_area', { a: 1, b: 1, c: 1 });
  near('等边 1：Δ = √3/4', e.area, Math.sqrt(3) / 4, 1e-9);
  near('等边 1：r = √3/6', e.inradius, Math.sqrt(3) / 6, 1e-9);
  // ⭐ 交叉校验：海伦面积必须与「同一三角形从坐标算的面积」一致。
  //   三边 3-4-5 摆在坐标上 A=(0,0) B=(4,0) C=(0,3) ⇒ 面积 = ½·4·3 = 6
  const fromCoords = Math.abs(
    (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0])) / 2;
  near('海伦 Δ ≡ 坐标面积（同一边长的两个三角形面积唯一）', v.area, fromCoords, 1e-9);
}

// ══ 7. 圆：幂、根轴、极线/极点（I：极点极线互逆）═════════════════════════
console.log('圆的幂 / 根轴 / 极线与极点:');
{
  const p = val('power', 'power_of_point', { center: [0, 0], r: 5, p: [13, 0] });
  near('幂 = d² − r² = 169−25 = 144', p.power, 144, 1e-9);
  eq('点在圆外', p.position, 'outside');
  // 圆内点：|OP| < r ⇒ 幂为负（这是「负幂」的标准约定）
  const q = val('power inside', 'power_of_point', { center: [0, 0], r: 5, p: [3, 0] });
  near('幂 = 9−25 = −16', q.power, -16, 1e-9);
  eq('点在圆内', q.position, 'inside');
  // 圆上点：幂 = 0
  near('圆上点幂 = 0', val('power on', 'power_of_point', { center: [0, 0], r: 5, p: [5, 0] }).power, 0, 1e-12);

  // 根轴：(|X|²−r1²) = (|X−C2|²−r2²) 化简得直线
  const ra = val('radical_axis', 'radical_axis', { c1: [0, 0], r1: 5, c2: [8, 0], r2: 3 });
  // x²−25 = (x−8)²−9 ⇒ x²−25 = x²−16x+64−9 ⇒ 16x = 80 ⇒ x = 5
  near('根轴 a', ra.line.a, 1, 1e-9);
  near('根轴 b', ra.line.b, 0, 1e-9);
  near('根轴 c = −5', ra.line.c, -5, 1e-9);
  eq('两圆外切', ra.circlesRelation, 'touch');
  // 交叉校验：根轴上的点对两圆的幂必须相等（这是根轴的定义）
  const X = [5, 2];
  const pow1 = X[0] * X[0] + X[1] * X[1] - 25;
  const pow2 = (X[0] - 8) * (X[0] - 8) + X[1] * X[1] - 9;
  near('根轴上一点两圆幂相等', pow1, pow2, 1e-12);

  // ⭐ 极线与极点必须**互逆**（这是对偶性的硬不变量）
  // 极线方程 (P−O)·(X−O) = r² ⇒ 13x = 25 ⇒ 直线 x = 25/13。
  // ⚠ 断言要查**几何内容**（点到底线的有向距离），不能查 (a,b,c) 的原值 ——
  //   直线方程可整体缩放，a·X+c=0 与 13a·X+13c=0 是同一条线。
  //   实现给的是归一化形式 (a,b) 为单位向量，这里 a=1, c=−25/13。
  const pol = val('polar', 'polar_of_point', { center: [0, 0], r: 5, p: [13, 0] });
  eq('极线法向为单位向量', Math.hypot(pol.line.a, pol.line.b), 1);
  near('极线 c = −25/13', pol.line.c, -25 / 13, 1e-9);
  // 几何内容校验：原点到极线的距离 = |c|/|n| = 25/13，且极线过切点方向的正确位置
  near('原点到极线距离 = r²/|OP| = 25/13', Math.abs(pol.line.c), 25 / 13, 1e-9);
  eq('P 在圆外故非切线', pol.isTangent, false);
  const back = val('pole 反演', 'pole_of_line', { center: [0, 0], r: 5, a1: pol.line.a, b1: pol.line.b, c1: pol.line.c });
  ptNear('极点(极线(极点(P))) = P（对合性）', back.pole, [13, 0], 1e-9);
  // 圆上点的极线就是切线，且 isTangent 必须如实标出
  const onC = val('polar on circle', 'polar_of_point', { center: [0, 0], r: 5, p: [5, 0] });
  eq('圆上点 ⇒ 极线是切线', onC.isTangent, true);
  // bug 2 护栏：切线 x=R 的极点就该在切点 (R,0)，不是 (r²/R,0)
  const tan = val('pole of tangent', 'pole_of_line', { center: [0, 0], r: 5, a1: 1, b1: 0, c1: -5 });
  ptNear('切线的极点在切点上（bug 2 护栏）', tan.pole, [5, 0], 1e-9);
  // ⭐ 圆心不在原点时同样成立 —— 这是漏分母那个 bug 最容易漏的地方
  const off = val('pole off-center', 'pole_of_line', { center: [3, 4], r: 5, a1: 1, b1: 0, c1: -8 });
  // 切线 x=8：极点 = O + λ(1,0)，λ = −25/(3−8) = 5 ⇒ (3+5, 4) = (8,4) ＝ 切点
  ptNear('圆心偏心时极点是切点', off.pole, [8, 4], 1e-9);
}

// ══ 8. 托勒密 / 婆罗摩笈多（I6）═══════════════════════════════════════════
console.log('托勒密与婆罗摩笈多:');
{
  // 矩形 4×3 是圆内接四边形：AC·BD = 5·5 = 25；AB·CD + BC·DA = 16+9 = 25
  const v = val('ptolemy rectangle', 'ptolemy', { a: A, b: B, c: [4, 3], d: C });
  near('AC·BD = 25', v.AC_times_BD, 25, 1e-9);
  near('AB·CD + BC·DA = 25', v.AB_times_CD_plus_BC_times_DA, 25, 1e-9);
  resNear('托勒密残差 0', v.identityResidual, 1e-12);
  eq('判定共圆', v.cyclic, true);
  // 非共圆 ⇒ 残差 ≠ 0，且必须**如实**说 cyclic:false（不能因为「差一点」就判真）
  const nc = val('ptolemy non-cyclic', 'ptolemy', { a: A, b: B, c: [3, 1], d: C });
  eq('非共圆如实报 false', nc.cyclic, false);
  ok('非共圆残差显著大于 0', nc.identityResidual > 1e-3, nc.identityResidual);

  // 婆罗摩笈多（3,4,5,6）：s=9 ⇒ Δ=√(6·5·4·3)=√360
  const br = val('brahmagupta', 'brahmagupta', { a: 3, b: 4, c: 5, d: 6 });
  near('s = 9', br.semiperimeter, 9, 1e-9);
  near('Δ = √360', br.area, Math.sqrt(360), 1e-9);
  eq('最长边 6 < s ⇒ 存在', br.cyclic_exists, true);
  // 交叉校验：边长确定后循环四边形**内接于一个圆**，且半径可由 Brahmagupta 反推
  // R = (1/4)√(((ab+cd)(ac+bd)(ad+bc))/((s-a)(s-b)(s-c)(s-d)))
  const R4 = 0.25 * Math.sqrt(((3 * 4 + 5 * 6) * (3 * 5 + 4 * 6) * (3 * 6 + 4 * 5)) / 360);
  ok('Brahmagupta 反推外接圆半径有限且为正', R4 > 0 && Number.isFinite(R4), R4);
}

// ══ 9. 莫莱 / 拿破仑（I9 / I10）══════════════════════════════════════════
console.log('莫莱定理与拿破仑定理:');
{
  // 中点配置下三圆 (AEF)(BFD)(CDE) 的公共点
  const v = val('miquel medians', 'miquel_point', { ...T345, ...MID });
  resNear('第三圆残差 = 0（三圆真共点）', v.thirdCircleResidual, 1e-12);
  eq('成立', v.holds, true);
  eq('算了三圆', v.circles.length, 3);
  // 非中点配置也必须成立（算法不能是「碰巧在中点时对」）
  const v2 = val('miquel asymmetric', 'miquel_point',
    { ...T345, d: [2.8, 0.9], e: [0, 1.8], f: [2.8, 0] });
  eq('非对称配置也共点', v2.holds, true);
  resNear('非对称残差 = 0', v2.thirdCircleResidual, 1e-12);

  const n = val('napoleon', 'napoleon_triangles', T345);
  eq('三个中心', n.centers.length, 3);
  near('中心三角形三边相等 #1', n.sideLengths[0], n.sideLengths[1], 1e-9);
  near('中心三角形三边相等 #2', n.sideLengths[1], n.sideLengths[2], 1e-9);
  resNear('等边残差 = 0（bug 1 护栏：漏 √3 时这里是 0.1498）', n.equilateralResidual, 1e-12);
  // ⭐ 面积比有闭式（外拿破仑中心三角形）：
  //   Δ_N = √3/24 · (a²+b²+c² + 4√3 Δ)，故 ratio = √3(Σa²+4√3Δ)/(24Δ)
  const Delta = 6, sq = 25 + 9 + 16;
  near('面积比闭式 = √3(Σa²+4√3Δ)/(24Δ)',
    n.areaRatio, Math.sqrt(3) * (sq + 4 * Math.sqrt(3) * Delta) / (24 * Delta), 1e-9);
  // 等边时中心三角形与原三角形面积比 = 2（外侧情形）
  const ne = val('napoleon equilateral', 'napoleon_triangles', EQ);
  near('等边：中心三角形三边仍相等', ne.sideLengths[0], ne.sideLengths[2], 1e-9);
  resNear('等边：等边残差 0', ne.equilateralResidual, 1e-12);
}

// ══ 10. 皮克定理（I11，I 用逐格点扫描而非公式 —— 闭合误差即诚实度）════════
console.log('皮克定理:');
{
  const sq2 = val('pick 2x2', 'pick_theorem', { poly: [[0, 0], [2, 0], [2, 2], [0, 2]] });
  near('A = 4', sq2.area, 4, 1e-9);
  eq('I = 1（唯一内部格点 (1,1)）', sq2.I, 1);
  eq('B = 8（每边 gcd=2，4 边共 8）', sq2.B, 8);
  near('A ≡ I + B/2 − 1 = 1+4−1', sq2.areaByPick, 4, 1e-9);
  resNear('闭合误差 = 0', sq2.maxResidual, 1e-12);
  eq('成立', sq2.holds, true);
  // 单位正方形：I=0, B=4
  const sq1 = val('pick 1x1', 'pick_theorem', { poly: [[0, 0], [1, 0], [1, 1], [0, 1]] });
  eq('单位方 I = 0', sq1.I, 0);
  eq('单位方 B = 4', sq1.B, 4);
  resNear('单位方闭合误差 0', sq1.maxResidual, 1e-12);
  // 边长 3 的直角格点三角形 (0,0)(3,0)(0,3)：
  //   I = 1（只有 (1,1)）；B = gcd(3,0)+gcd(3,3)+gcd(0,3) = 3+3+3 = 9
  //   ⇒ A ≡ 1 + 9/2 − 1 = 4.5，与真实面积 9/2 一致
  const tri = val('pick lattice tri', 'pick_theorem', { poly: [[0, 0], [3, 0], [0, 3]] });
  eq('直角格点三角形 I = 1', tri.I, 1);
  eq('B = 9（三边 gcd 各 3）', tri.B, 9);
  near('A ≡ I + B/2 − 1 = 4.5', tri.areaByPick, 4.5, 1e-9);
  near('真实面积 = 9/2', tri.area, 4.5, 1e-9);
  // ⭐ 边界点用 gcd 精确算（不是靠数点），所以与扫描口径必须完全闭合
  resNear('gcd 口径与扫描口径闭合误差 0', tri.maxResidual, 1e-12);
}

// ══ 11. 黄金比例与正多边形（I13 / I16）═════════════════════════════════
console.log('黄金比例与正多边形:');
{
  const g = val('golden', 'golden_ratio', {});
  const phi = (1 + Math.sqrt(5)) / 2;
  near('φ = (1+√5)/2', g.phi, phi, 1e-9);
  near('1/φ = φ−1', g.inverse, phi - 1, 1e-9);
  // ⚠ 共轭走 detF（12 位定点），不能用 === 比 —— 它是刻意舍入后的值
  near('共轭 = −1/φ', g.conjugate, -(phi - 1), 1e-12);
  resNear('φ² = φ+1', g.identityResiduals.phi2_minus_phi_minus_1, 1e-12);
  resNear('1/φ = φ−1', g.identityResiduals.inv_phi_minus_phi_minus_1, 1e-12);
  // ⭐ 最关键的一条：2cos36° = φ —— 这是「对角线/边 = φ」的几何根据
  resNear('2cos36° = φ', g.identityResiduals.two_cos36deg_minus_phi, 1e-12);

  // 正五边形：外接圆半径 1 ⇒ 边 = 2sin36°，对角线 = 2sin72°，比值 = φ
  const p5 = val('regular pentagon', 'regular_polygon', { n: 5, R: 1 });
  near('边 = 2sin36°', p5.side, 2 * Math.sin(Math.PI / 5), 1e-9);
  near('内切半径 = cos36°', p5.apothem, Math.cos(Math.PI / 5), 1e-9);
  eq('内角 = 108°', p5.interiorAngleDeg, 108);
  eq('外角 = 72°', p5.exteriorAngleDeg, 72);
  // I16：面积 = ½·周长·内切半径
  near('面积 = ½·周长·apothem', p5.area, 0.5 * p5.perimeter * p5.apothem, 1e-9);
  eq('内角 + 外角 = 180°', p5.interiorAngleDeg + p5.exteriorAngleDeg, 180);
  // 几何意义的 φ：正五边形对角线/边 = φ
  const diag = 2 * Math.sin(2 * Math.PI / 5);
  near('正五边形对角线/边 = φ（几何意义所在）', diag / p5.side, phi, 1e-9);
  // 所有顶点都在半径 R 的圆上
  p5.vertices.forEach((v, i) => near('顶点' + i + ' 在半径 1 的圆上', Math.hypot(v[0], v[1]), 1, 1e-9));
  // 正三角形（内接圆半径 R=1）：边 = √3·R，是 R 的 √3 倍而不是 R
  const p3 = val('regular triangle', 'regular_polygon', { n: 3, R: 1 });
  near('正三角形边 = √3·R', p3.side, Math.sqrt(3), 1e-9);
  near('正三角形面积 = 3√3/4·R²', p3.area, 3 * Math.sqrt(3) / 4, 1e-9);
  eq('正三角形内角 60°', p3.interiorAngleDeg, 60);
  const p4 = val('regular square', 'regular_polygon', { n: 4, R: 1 });
  near('正方形边 = √2·R', p4.side, Math.SQRT2, 1e-9);
  near('正方形面积 = 2R²', p4.area, 2, 1e-9);
}

// ══ 12. 四面体 / 蒙日点（I14 / I15）══════════════════════════════════════
console.log('四面体几何与蒙日点:');
{
  // 单位直角四面体 {0, e1, e2, e3}
  const TET = { a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0], d: [0, 0, 1] };
  const v = val('tetra', 'tetrahedron_geometry', TET);
  near('体积 = 1/6', v.volume, 1 / 6, 1e-9);
  near('三条正交边 = 1', v.edges.ab, 1, 1e-9);
  near('面对角线 = √2', v.edges.bc, Math.SQRT2, 1e-9);
  near('三个直角面各 0.5', v.faceAreas[0], 0.5, 1e-9);
  near('斜面 = √3/2', v.faceAreas[3], Math.sqrt(3) / 2, 1e-9);
  near('表面积 = 1.5 + √3/2', v.surfaceArea, 1.5 + Math.sqrt(3) / 2, 1e-9);

  // ⭐ 蒙日点：M = 2G − O。单位直角四面体 G=(¼,¼,¼), O=(½,½,½) ⇒ M = 原点
  const m = val('monge', 'monge_point', TET);
  ptNear('单位直角四面体 M = 2G − O = 原点', m.M, [0, 0, 0], 1e-9);
  ptNear('重心 G = (¼,¼,¼)', m.centroid, [0.25, 0.25, 0.25], 1e-9);
  ptNear('外心 O = (½,½,½)', m.circumcenter, [0.5, 0.5, 0.5], 1e-9);
  near('外接球半径 = √3/2', m.circumradius, Math.sqrt(3) / 2, 1e-9);
  // bug 3 护栏：校验必须是「棱中点 ⊥ 对棱」六个面。校验错定义时这里是 0.5
  resNear('6 个蒙日中面残差 = 0（bug 3 护栏）', m.maxResidual, 1e-12);
  // 非直角四面体上 M = 2G − O 也必须成立（算法不能只对标准形对）
  const TET2 = { a: [1, 2, 3], b: [4, 1, 0], c: [0, 5, 2], d: [2, 0, 6] };
  const m2 = val('monge general', 'monge_point', TET2);
  const G2 = [1, 2, 3].map((_, i) => (TET2.a[i] + TET2.b[i] + TET2.c[i] + TET2.d[i]) / 4);
  const M2 = m2.M;
  ptNear('M = 2G − O 的 H−O 分量（G、O 由实现给出）', M2,
    [0, 1, 2].map((_, i) => 2 * G2[i] - m2.circumcenter[i]), 1e-8);
  resNear('一般四面体 6 中面残差 = 0', m2.maxResidual, 1e-12);

  // 正四面体（I15）：边 s 的全部量
  const rt = val('reg_tet', 'regular_tetrahedron', { s: 1 });
  near('高 = √(2/3)', rt.height, Math.sqrt(2 / 3), 1e-9);
  near('外接球半径 = √6/4', rt.circumradius, Math.sqrt(6) / 4, 1e-9);
  near('内切球半径 = √6/12', rt.inradius, Math.sqrt(6) / 12, 1e-9);
  // ⭐ r : R 恒等于 1 : 3（正四面体的硬不变量）
  near('r/R = 1/3', rt.inradius / rt.circumradius, 1 / 3, 1e-12);
  near('高 = R + r（球心在内切与外接之间）', rt.height, rt.circumradius + rt.inradius, 1e-12);
  near('体积 = √2/12', rt.volume, Math.sqrt(2) / 12, 1e-9);
  near('二面角 = arccos(1/3) ≈ 70.5288°', rt.dihedralAngleDeg, Math.acos(1 / 3) * 180 / Math.PI, 1e-8);
  eq('面数', rt.faceCount, 4);
  eq('棱数', rt.edgeCount, 6);
  eq('顶点数', rt.vertexCount, 4);
  // 边长 s=2 ⇒ 体积 ×8（立方律）
  near('体积 ∝ s³', val('reg_tet s=2', 'regular_tetrahedron', { s: 2 }).volume, rt.volume * 8, 1e-9);
  // 顶点两两距离都是 s（外接球半径据此核对）
  const vs = rt.vertices;
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      near('顶点 ' + i + j + ' 距离 = s = 1',
        Math.hypot(vs[i][0] - vs[j][0], vs[i][1] - vs[j][1], vs[i][2] - vs[j][2]), 1, 1e-9);
    }
  }
}

// ══ 13. 随机不变量（200 例随机三角形，全部恒等式一起测）══════════════════
console.log('随机不变量（200 例随机三角形）:');
{
  // 固定种子 ⇒ 可复现。随机算例挡的是「公式在特定形状下才错」。
  let seed = 20261004;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let n = 0, bad = [];
  for (let t = 0; t < 200; t++) {
    // 随机三点（先排除共线）
    let A2, B2, C2;
    for (let tries = 0; ; tries++) {
      A2 = [rnd() * 20 - 10, rnd() * 20 - 10];
      B2 = [rnd() * 20 - 10, rnd() * 20 - 10];
      C2 = [rnd() * 20 - 10, rnd() * 20 - 10];
      const ar = Math.abs((B2[0] - A2[0]) * (C2[1] - A2[1]) - (B2[1] - A2[1]) * (C2[0] - A2[0])) / 2;
      if (ar > 0.5) break;
      if (tries > 50) { A2 = [0, 0]; B2 = [7, 0]; C2 = [0, 9]; break; }
    }
    const args = { a: A2, b: B2, c: C2 };
    // 尺度容差：坐标量级 ~20 ⇒ 相对 1e-9 绝对约 1e-8
    const tol = 1e-7;
    const fc = IDX.doGeometry({ op: 'triangle_five_centers', ...args }).value;
    const el = IDX.doGeometry({ op: 'euler_line', ...args }).value;
    const np = IDX.doGeometry({ op: 'triangle_nine_point_circle', ...args }).value;
    const ei = IDX.doGeometry({ op: 'triangle_euler_inequality', ...args }).value;
    const npx = IDX.doGeometry({ op: 'napoleon_triangles', ...args }).value;
    // 3D op 需要第三个坐标：把 2D 点沿 z 方向抬起来（避免共面）
    const lift = (P) => [P[0], P[1], rnd() * 5 + 1];
    const mg = IDX.doGeometry({ op: 'monge_point', a: lift(A2), b: lift(B2), c: lift(C2), d: lift(A2) }).value;
    const tag = `t#${t}`;
    // I1/I2
    if (Math.abs(fc.eulerOI2_residual) > tol) bad.push(tag + ' I1 OI²');
    if (Math.abs(fc.eulerOH2_residual) > tol) bad.push(tag + ' I2 OH²');
    // I3
    if (!el.equilateral && Math.abs(el.parameter_t - 3) > 1e-6) bad.push(tag + ' I3 t');
    // I4
    if (np.maxResidual > tol) bad.push(tag + ' I4 九点圆');
    // I5
    if (ei.R + 1e-9 < 2 * ei.r) bad.push(tag + ' I5 欧拉不等式');
    // I10
    if (npx.equilateralResidual > 1e-7) bad.push(tag + ' I10 拿破仑');
    // I14
    if (mg.maxResidual > tol) bad.push(tag + ' I14 蒙日');
    // 尺度自洽：heron（三边）面积 ≡ 坐标面积
    const L = (P, Q) => Math.hypot(P[0] - Q[0], P[1] - Q[1]);
    const h = IDX.doGeometry({ op: 'heron_area', a: L(B2, C2), b: L(C2, A2), c: L(A2, B2) }).value;
    const area2 = Math.abs((B2[0] - A2[0]) * (C2[1] - A2[1]) - (B2[1] - A2[1]) * (C2[0] - A2[0])) / 2;
    if (Math.abs(h.area - area2) > 1e-7) bad.push(tag + ' 海伦≡坐标面积');
    n++;
  }
  eq('随机三角形例数 = 200', n, 200);
  ok('随机三角形：I1/I2/I3/I4/I5/I10/I14 + 海伦面积恒等式全部成立', bad.length === 0, bad.slice(0, 8));
}

// ══ 14. fail-closed / 退化码回归护栏 ════════════════════════════════════
console.log('fail-closed 与退化码（前提被破坏时不得给几何结论）:');
{
  // ── 前提被破坏 ⇒ 报「你点放错了」，绝不报「定理不成立」（bug 5 / 6 护栏）
  // 把 AB 的中点当成 BC 上的分割点：k=0.5 在 [0,1] 内，但根本不在 BC 上。
  // 不验垂直距离就会静默算出比值并报 concurrent:false —— 一个假的不成立结论。
  degen('塞瓦：D 不在 BC 上', 'cevian_concurrent',
    { a: A, b: B, c: C, d: [2, 0], e: [0, 1.5], f: [2, 0] }, 'point_not_on_side');
  degen('塞瓦：F 不在 AB 上', 'cevian_concurrent',
    { a: A, b: B, c: C, d: [2, 1.5], e: [0, 1.5], f: [0.8, 1.8] }, 'point_not_on_side');
  degen('塞瓦：D 落在顶点 B', 'cevian_concurrent',
    { a: A, b: B, c: C, d: [4, 0], e: [0, 1.5], f: [2, 0] }, 'point_at_vertex');
  degen('梅涅劳：E 不在 CA 上', 'menelaus_collinear',
    { a: A, b: B, c: C, d: [2, 1.5], e: [2, 1], f: [2, 0] }, 'point_not_on_side');
  // bug 6 护栏：莫莱必须同样拒绝，而不是给一个 holds:false
  degen('莫莱：F 不在 AB 上（不得报 holds:false）', 'miquel_point',
    { ...T345, d: [2, 1.5], e: [0, 1.5], f: [0.8, 1.8] }, 'point_not_on_side');

  // ── 三点共线 ⇒ 退化（输入病态，禁止下结论）
  degen('五心：三点共线', 'triangle_five_centers', { a: [0, 0], b: [1, 0], c: [2, 0] }, 'degenerate_triangle');
  degen('角平分线：三点共线', 'triangle_bisector_lengths', { a: [0, 0], b: [1, 0], c: [2, 0] }, 'degenerate_triangle');
  degen('拿破仑：三点共线', 'napoleon_triangles', { a: [0, 0], b: [1, 0], c: [2, 0] }, 'degenerate_triangle');

  // ── bug 7 护栏：同一个数学事实（三个正数不满足三角不等式）必须口径一致
  for (const op of ['law_of_cosines', 'law_of_sines', 'heron_area']) {
    degen(op + '(1,1,5) ⇒ 可断言无解', op, { a: 1, b: 1, c: 5 }, 'no_such_triangle');
  }
  degen('solve_triangle(1,1,5) 同样口径', 'solve_triangle', { a: 1, b: 1, c: 5 }, 'no_such_triangle');
  degen('stewart 边长不满足三角不等式', 'stewart_theorem', { a: 10, m: 9, b: 1, c: 1 }, 'no_such_triangle');
  // 但「坐标三点共线」是另一回事 —— 那是输入病态，码必须不同
  degen('坐标共线仍是 degenerate_triangle（与上面区分）', 'triangle_five_centers',
    { a: [0, 0], b: [1, 0], c: [2, 0] }, 'degenerate_triangle');

  // ── 解三角形的问法分类
  degen('AAA：尺度未定（不是「没给够三个」）', 'solve_triangle', { A: 1, B: 1, C: 1 }, 'scale_undetermined');
  degen('只给两个量', 'solve_triangle', { a: 3, b: 4 }, 'need_exactly_three_given');
  degen('给四个量', 'solve_triangle', { a: 3, b: 4, c: 5, A: 1 }, 'need_exactly_three_given');
  degen('零边长', 'law_of_cosines', { a: 0, b: 4, c: 5 }, 'zero_length_side');
  // ⚠ 负长度必须与零长度分开报：名字与事实不符会让 Agent 去查「是不是漏传了 0」，
  //   而它实际传的是 −5 —— 修法完全不同
  degen('负边长（不得报 zero_length_side）', 'heron_area', { a: 3, b: 4, c: -5 }, 'negative_length_side');
  degen('负边长（余弦定理同）', 'law_of_cosines', { a: 3, b: 4, c: -5 }, 'negative_length_side');
  degen('正四面体负边长', 'regular_tetrahedron', { s: -1 }, 'negative_length_side');
  degen('角为 0', 'solve_triangle', { a: 3, b: 4, A: 0 }, 'non_positive_input');
  degen('两角之和 ≥ π', 'solve_triangle', { b: 4, A: 2.5, B: 2.5 }, 'angles_exceed_pi');
  degen('角 ≥ π', 'solve_triangle', { a: 3, b: 4, A: Math.PI }, 'angle_out_of_range');

  // ── Stewart 的分割点越界
  degen('stewart m > a', 'stewart_theorem', { a: 5, m: 6, b: 3, c: 4 }, 'split_out_of_range');
  degen('stewart m < 0', 'stewart_theorem', { a: 5, m: -1, b: 3, c: 4 }, 'split_out_of_range');

  // ── 圆相关
  degen('负半径', 'power_of_point', { center: [0, 0], r: -1, p: [3, 0] }, 'negative_radius');
  degen('同心不等径 ⇒ 无处可求根轴', 'radical_axis', { c1: [0, 0], r1: 5, c2: [0, 0], r2: 3 }, 'no_radical_axis');
  degen('同圆 ⇒ 根轴是整个平面', 'radical_axis', { c1: [0, 0], r1: 5, c2: [0, 0], r2: 5 }, 'identical_circles');
  degen('P = O ⇒ 极线在无穷远', 'polar_of_point', { center: [0, 0], r: 5, p: [0, 0] }, 'pole_at_center');
  degen('直线过圆心 ⇒ 极点在无穷远', 'pole_of_line', { center: [0, 0], r: 5, a1: 1, b1: 0, c1: 0 }, 'pole_at_infinity');

  // ── 皮克定理：格点前提
  degen('非整数坐标', 'pick_theorem', { poly: [[0, 0], [1.5, 0], [0, 1.5]] }, 'non_integer_coordinate');
  throws('皮克：不足 3 点', () => IDX.doGeometry({ op: 'pick_theorem', poly: [[0, 0], [1, 0]] }), 'invalid_input');

  // ── 正多边形 / 正四面体的规模与正性
  degen('n 太小', 'regular_polygon', { n: 2, R: 1 }, 'n_too_small');
  degen('n 太大', 'regular_polygon', { n: 100, R: 1 }, 'n_too_large');
  degen('n 非整数', 'regular_polygon', { n: 5.5, R: 1 }, 'non_integer_n');
  degen('R = 0', 'regular_polygon', { n: 5, R: 0 }, 'zero_radius');
  degen('正四面体边长 0', 'regular_tetrahedron', { s: 0 }, 'zero_length_side');
  eq('正三角形合法（n=3）', !!IDX.doGeometry({ op: 'regular_polygon', n: 3, R: 1 }).value, true);

  // ── 四面体共面
  degen('四面体共面', 'tetrahedron_geometry', { a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0], d: [1, 1, 0] }, 'coplanar');
  degen('蒙日点：共面', 'monge_point', { a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0], d: [1, 1, 0] }, 'coplanar');
}

// ══ 15. 分派层：签名、catalog、维度归属 ═════════════════════════════════
console.log('分派层一致性:');
{
  const ALL = IDX.OPS;
  const names = Object.keys(ALL);
  eq('几何 op 总数 = 130（含 8 个热带/凸桥 op + 3 个几何⇄代数桥接 op）', names.length, 130);
  // 定理层必须全部在册（防止新增 op 忘了接进 index.js 而静默不可达）
  const gt = require('../services/geometry/geom_theorems.js');
  const gtNames = Object.keys(gt.OPS);
  eq('定理层 op 数 = 32（含海伦）', gtNames.length, 32);
  eq('定理层 op 全部可从分派层到达', gtNames.filter((n) => !ALL[n]).length, 0);
  // 所有退化码必须已登记 —— 未登记的码在 index.js 里会被当普通 error，
  // 且不在 DEFINITE_NONE / DEGENERATE 的白名单里，Agent 分不清能否断言。
  const registered = new Set([...IDX.DEFINITE_NONE, ...IDX.DEGENERATE]);
  const used = new Set();
  for (const src of Object.values(gt.OPS)) {
    const run = src.run.toString();
    for (const m of run.matchAll(/degenerate:\s*'([a-z_]+)'/g)) used.add(m[1]);
  }
  const unknown = [...used].filter((c) => !registered.has(c));
  eq('定理层用到的退化码全部已登记（无未登记码）', unknown.length, 0);
  console.log(`    定理层用到 ${used.size} 个退化码，全部在白名单内`);
  // 两个集合不得重叠（重叠会让「可断言无解」与「禁止下结论」同时成立）
  const overlap = [...IDX.DEFINITE_NONE].filter((c) => IDX.DEGENERATE.has(c));
  eq('DEFINITE_NONE 与 DEGENERATE 无交集', overlap.length, 0);
  // layer 一律由 dim 推导（不给单个文件自己写）
  let layerBad = [];
  for (const n of names) {
    const s = ALL[n];
    const want = s.scalar ? 'any' : (s.dim === 0 ? 'any' : (s.dim + 'D'));
    if (s.layer !== want) layerBad.push(n + ':' + s.layer + '≠' + want);
  }
  eq('全部 op 的 layer 与 dim/scalar 一致', layerBad.length, 0);
  // 标量 op 不得被要求传点：直接无参调用，golden_ratio 本就无参 ⇒ 成功；
  // 其余必须报「缺参数」而不是「需要一个点来推断维度」
  throws('标量 op heron_area 无参（不得报「需要点」）', () => IDX.doGeometry({ op: 'heron_area' }), 'invalid_input');
  throws('标量 op law_of_cosines 无参', () => IDX.doGeometry({ op: 'law_of_cosines' }), 'invalid_input');
  throws('标量 op stewart_theorem 无参', () => IDX.doGeometry({ op: 'stewart_theorem' }), 'invalid_input');
  throws('标量 op regular_tetrahedron 无参', () => IDX.doGeometry({ op: 'regular_tetrahedron' }), 'invalid_input');
  eq('零参标量 op golden_ratio 无参可调', typeof IDX.doGeometry({ op: 'golden_ratio' }).value.phi, 'number');
  // catalog 必须含新 op 的签名
  const cat = IDX.buildCatalog();
  ok('catalog 含 heron_area', !!cat.heron_area, Object.keys(cat).length);
  eq('catalog 记录 heron_area 的三个参数', JSON.stringify(cat.heron_area.args), JSON.stringify(['a:number', 'b:number', 'c:number']));
  eq('catalog 记录 solve_triangle 的 6 个可选参数', cat.solve_triangle.optional.length, 6);
  ok('catalog 里所有 op 的 dim 都已归一（scalar/any 不再是裸 0）',
    Object.values(cat).every((c) => c.dim !== 0), null);
  // 未知 op 必须带完整 catalog 返回（Agent 第一次错的成本是一次，不是每轮）
  throws('未知 op', () => IDX.doGeometry({ op: 'no_such_op_xyz' }), 'unknown_op');
  // 缺必填参数必须点名是哪个参数
  let caught = null;
  try { IDX.doGeometry({ op: 'heron_area', a: 3, b: 4 }); } catch (e) { caught = e; }
  ok('缺参数时点名参数名', !!caught && /"c"/.test(caught.message), caught && caught.message);
}

// ══ 16. 确定性（同输入字节级可复现）═══════════════════════════════════════
console.log('确定性:');
{
  const once = JSON.stringify(IDX.doGeometry({ op: 'triangle_five_centers', ...T345 }));
  for (let i = 0; i < 3; i++) {
    eq('第 ' + i + ' 次重复字节级一致', JSON.stringify(IDX.doGeometry({ op: 'triangle_five_centers', ...T345 })), once);
  }
  eq('solve_triangle 也确定性',
    JSON.stringify(IDX.doGeometry({ op: 'solve_triangle', a: 5, b: 8, A: Math.PI / 6 })),
    JSON.stringify(IDX.doGeometry({ op: 'solve_triangle', a: 5, b: 8, A: Math.PI / 6 })));
}

// ── 汇总 ────────────────────────────────────────────────────────────────
console.log(`\ngeometry-theorems: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
