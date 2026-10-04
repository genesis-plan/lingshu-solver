/**
 * 热带几何层回归测试 —— services/tropical.js
 *
 * 纪律（与 test-geometry-theorems.js 同源）：
 *   1. 期望值必须**能手算**或必须是**数学硬不变量**，不许抄产品的输出。
 *   2. 每条真 bug 都留一条断言当护栏，注释写清「错的时候长什么样」。
 *   3. fail-closed 退化码逐条测，且断言 **e.type**（不是断言「抛错了」）。
 *   4. 确定性：同输入两次调用必须逐字节相同。
 *
 * 运行：node test/test-tropical.js
 */
'use strict';

const T = require('../services/tropical.js');

let pass = 0;
const fails = [];
const groups = [];

function group(name) { groups.push(name); process.stdout.write(`\n── ${name} ──\n`); }
function ok(name, cond, extra) {
  if (cond) { pass++; process.stdout.write(`  ok  ${name}\n`); }
  else { fails.push(name); process.stdout.write(`  FAIL ${name}${extra !== undefined ? '  ← ' + extra : ''}\n`); }
}
function eq(name, got, want) { ok(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
function near(name, got, want, tol) {
  ok(name, typeof got === 'number' && Number.isFinite(got) && Math.abs(got - want) <= (tol || 1e-9),
    `got ${got} want ${want}`);
}
function degen(name, fn, type) {
  try { fn(); ok(name, false, '没有抛错'); }
  catch (e) { ok(name, e && e.type === type, `got ${e && e.type} want ${type}`); }
}
function eqArr(name, got, want) {
  ok(name, Array.isArray(got) && got.length === want.length && got.every((x, i) => x === want[i]),
    `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}

// COVERS: tropical_degree_bound, tropical_system_bound, regular_subdivision,
// COVERS: tropical_bezout_bound, minimum_enclosing_circle, newton_polytope,
// COVERS: bernstein_bound, cocircular_check
//
// ↑ 显式登记：这些 op 在 services/geometry/index.js 里以 snake_case 注册（几何层
//   的工具入口），而本文件按 camelCase 直接调 services/tropical.js 的函数。
//   两者名字不一致，test-geometry.js 的覆盖率闸按名字匹配 ⇒ 光靠调用写法扫不到。
//   闸本身留了 `// COVERS:` 这条显式登记通道（只做加法不做减法，绝不会漏掉真未测的）。

// ─────────────────────────────────────────────────────────────────────────
group('solveSquare：支撑平面判据的地基');

{
  // 2x2 已知解：2x+3y=5, -x+y=1  ⇒ x=1, y=1（代入：2+3=5 ✓，-1+1=0 ✗）——换一组
  const v = T.solveSquare([[2, 3], [-1, 4]], [8, 7], 2);
  near('2x+3y=8, -x+4y=7 ⇒ x=1', v[0], 1, 1e-9);
  near('2x+3y=8, -x+4y=7 ⇒ y=2', v[1], 2, 1e-9);

  eq('奇异的 A 返回 null', T.solveSquare([[1, 1], [2, 2]], [1, 2], 2), null);
  eq('A 行数不等于 n 返回 null', T.solveSquare([[1, 1]], [1], 2), null);

  // 3x3：单位阵 ⇒ 解就是 b
  const b3 = [5, -7, 11];
  const u3 = T.solveSquare([[1, 0, 0], [0, 1, 0], [0, 0, 1]], b3, 3);
  eqArr('3x3 单位阵解 = 右端', u3, b3);

  // 对角占优的行交换（部分主元存在的意义）
  const sw = T.solveSquare([[0, 1], [1, 0]], [3, 7], 2);
  near('行交换 x = 7', sw[0], 7, 1e-12);
  near('行交换 y = 3', sw[1], 3, 1e-12);
}

// ─────────────────────────────────────────────────────────────────────────
group('T2 ℓ¹-直径界（arXiv:2605.24966 Thm 1.3）');

{
  const t = (e, w) => ({ exponents: e, coeff: 1, weight: w });

  // (0,0),(5,0),(0,50)：
  //   |(0,0)-(5,0)|₁ = 5
  //   |(0,0)-(0,50)|₁ = 50
  //   |(5,0)-(0,50)|₁ = 5+50 = 55  ← 最大
  const d = T.tropicalDegreeBound([t([0, 0], 0), t([5, 0], 1), t([0, 50], 2)], 2);
  eq('l1diameter = 55（手算）', d.l1diameter, 55);
  // 定理给两条：diam₁ = 55 与 |M|−1 = 2，取小者
  eq('degreeUpperBound = min(55, |M|-1=2) = 2', d.degreeUpperBound, 2);

  // 1D：{0, 3} ⇒ diam₁ = 3，|M|−1 = 1 ⇒ 取 1
  const d1 = T.tropicalDegreeBound([t([0], 0), t([3], 1)], 1);
  eq('1D l1diameter = 3', d1.l1diameter, 3);
  eq('1D 上界取 min(3, 1) = 1', d1.degreeUpperBound, 1);

  // 单点支撑：diam₁ = 0，|M|−1 = 0
  const d0 = T.tropicalDegreeBound([t([2], 0)], 1);
  eq('单点 l1diameter = 0', d0.l1diameter, 0);
  eq('单点上界 = 0', d0.degreeUpperBound, 0);

  ok('必须声明这是上界而非 degree', /UPPER BOUND/.test(d0.caveat), d0.caveat);
}

// ─────────────────────────────────────────────────────────────────────────
group('T1 vs T2：稀疏度上界的实际价值');

{
  const t = (e, w) => ({ exponents: e, coeff: 1, weight: w });
  // x^50 + y^50 = 1 与 x^50 + y^50 = 2（两个方程）—— Bézout 给 50·50 = 2500，
  // 而每条方程的支撑 {50,0},{0,50},{0,0} 的 diam₁ = 100、|M|−1 = 2 ⇒ 上界 2，
  // 逐条取 min 给出 diam₁ 积 = 4，比 Bézout 紧 625 倍。
  const s = T.tropicalSystemBound([
    [t([50, 0], 0), t([0, 50], 1), t([0, 0], 2)],
    [t([0, 0], 3), t([50, 0], 4), t([0, 50], 5)]
  ], 2);
  eq('bezoutBound = 50·50 = 2500', s.bezoutBound, 2500);
  eq('diameterProductBound = 2·2 = 4', s.diameterProductBound, 4);
  eq('best 取 min = 4', s.best, 4);
  eq('sparsityGain = 2500/4 = 625', s.sparsityGain, 625);
  // ⚠ 融合接口：bkkBound 现在是 null，由 bounds.js 填真实混合体积。
  //   这一条断言会**主动失败**，直到有人把它接上 —— 这是有意的。
  eq('bkkBound 仍为 null（待融合接线）', s.bkkBound, null);

  degen('方程数≠变量数报 not_square', () => T.tropicalSystemBound([[t([1, 0], 0)]], 2), 'not_square');
  degen('空支撑列表报 invalid_input', () => T.tropicalSystemBound([], 2), 'invalid_input');
}

// ─────────────────────────────────────────────────────────────────────────
group('正则细分（核心不变量：格点体积之和 = Newton 多面体归一化体积）');

{
  const t = (e, w) => ({ exponents: e, coeff: 1, weight: w });

  // ① 1D：支撑 {0,1,2}、权重 (0,1,3) ⇒ 正确细分是 [0,1] 与 [1,2] 两段
  //    （[0,2] 不是胞腔：点 1 在平面下方）
  //    这条断言是三轮符号错误的护栏 —— 错判会收下 [0,2]，
  //    格点体积和变成 1+2 = 3 ≠ nvol 2。
  const l1 = T.regularSubdivision([t([0], 0), t([1], 1), t([2], 3)], 1);
  eq('1D 细分切成 2 段', l1.cellCount, 2);
  eq('1D 格点体积和 = 2', l1.latticeVolumeSum, 2);
  eq('1D nvol = 2', l1.newtonNormalizedVolume, 2);
  ok('1D 覆盖 Newton 多面体', l1.coversNewton, true);
  ok('1D 非退化', l1.nonDegenerate, true);
  eqArr('1D 两段格点体积各 1', l1.cells.map((c) => c.latticeVolume), [1, 1]);

  // ② 1D 权重单调（0,3,1 不单调 ⇒ (0,0,1),(1,3),(2,1) 下包络不分段）
  //    手算：过 (0,0) 与 (2,1) 的直线 y = x/2；点 (1,3) 在其**上方** 2.5 ⇒ 被切开？
  //    不 —— 下包络取最小，(1,3) 在上方意味着它**不**迫使分段：
  //    整段 [0,2] 可以用一条直线穿过 (0,0) 和 (2,1) 且让 (1,3) 在上方 ⇒ 单胞腔。
  const l2 = T.regularSubdivision([t([0], 0), t([1], 3), t([2], 1)], 1);
  eq('1D 权重 (0,3,1) 不分段', l2.cellCount, 1);
  eq('单胞腔格点体积 = 2（整段长度）', l2.latticeVolumeSum, 2);

  // ③ 2D 正方形 2×2，抬高对角顶点 ⇒ 切成 2 个三角形，各 lv = 4
  //    nvol([0,2]²) = 2! · 面积 = 2 · 4 = 8
  const sq = (w) => [t([0, 0], w[0]), t([0, 2], w[1]), t([2, 0], w[2]), t([2, 2], w[3])];
  for (const w of [[0, 0, 0, 1], [0, 0, 0, 5], [0, 0, 0, -1], [0, 1, 2, 10], [0, 1, 2, -5]]) {
    const r = T.regularSubdivision(sq(w), 2);
    eq(`正方形 w=${JSON.stringify(w)} 切 2 个三角`, r.cellCount, 2);
    eq(`正方形 w=${JSON.stringify(w)} 体积和 = nvol`, r.latticeVolumeSum, r.newtonNormalizedVolume);
    eq(`正方形 w=${JSON.stringify(w)} nvol = 8`, r.newtonNormalizedVolume, 8);
    eqArr(`正方形 w=${JSON.stringify(w)} 各 lv = 4`, r.cells.map((c) => c.latticeVolume), [4, 4]);
  }

  // ④ 共面 ⇒ 细分未定义，必须 fail-closed 而不是「报 1 个胞腔」
  //    w = (0,2,1,3)：(0,0)w0,(0,2)w2,(2,0)w1,(2,2)w3 四点共面（w 是 α 的仿射函数）
  degen('共面权重报 degenerate_subdivision', () => T.regularSubdivision(sq([0, 2, 1, 3]), 2), 'degenerate_subdivision');
  // 全部权重相同 ⇒ 完全共面
  degen('权重全等报 degenerate_subdivision', () => T.regularSubdivision(sq([1, 1, 1, 1]), 2), 'degenerate_subdivision');

  // ⑤ 3D 单位立方体抬高一个顶点 ⇒ 切出 5 个四面体
  //    经典结果：抬一个顶点会把立方体的三面剖分成 5 个四面体
  //    体积 1+1+2+1+1 = 6 = 3! · 体积([0,1]³) = 6 · 1 = 6
  const cube = (w) => {
    const o = [];
    for (let i = 0; i < 8; i++) o.push(t([i & 1, (i >> 1) & 1, (i >> 2) & 1], w[i]));
    return o;
  };
  const cu = T.regularSubdivision(cube([0, 1, 1, 1, 1, 1, 1, 2]), 3);
  eq('立方体抬顶点切 5 个四面体', cu.cellCount, 5);
  eq('立方体格点体积和 = nvol = 6', cu.latticeVolumeSum, 6);
  eq('立方体 nvol = 6', cu.newtonNormalizedVolume, 6);
  ok('立方体覆盖 Newton 多面体', cu.coversNewton, true);
  // 5 个四面体的格点体积之和必须等于 6，且每个 ≥ 1 ⇒ 必有一个 2
  const sum = cu.cells.reduce((a, c) => a + c.latticeVolume, 0);
  eq('立方体 5 个胞腔体积和自洽', sum, 6);
  ok('存在格点体积为 2 的胞腔（其余为 1）', cu.cells.some((c) => c.latticeVolume === 2),
    JSON.stringify(cu.cells.map((c) => c.latticeVolume)));

  // 立方体抬两个对角顶点 ⇒ 仍共面（x+y+z 上是线性的）⇒ 退化
  degen('立方体抬对角顶点（仍共面）报退化', () => T.regularSubdivision(cube([0, 1, 2, 3, 4, 5, 6, 7]), 3), 'degenerate_subdivision');

  // ⑥ 单个四面体抬高一个顶点 ⇒ 仍是 1 个胞腔（nvol = 6·(1/6) = 1）
  const tet = T.regularSubdivision([
    t([0, 0, 0], 0), t([0, 0, 1], 0), t([0, 1, 0], 0), t([1, 0, 0], 1)
  ], 3);
  eq('四面体抬顶点后仍 1 个胞腔', tet.cellCount, 1);
  eq('四面体格点体积 = 1', tet.latticeVolumeSum, 1);
  eq('四面体 nvol = 1', tet.newtonNormalizedVolume, 1);

  // ⑦ 规模闸：支撑集 > 12 项不做 2^m 枚举
  const big = [];
  for (let i = 0; i < 13; i++) big.push(t([i, i], i));
  degen('支撑集 13 项报 resource_limit', () => T.regularSubdivision(big, 2), 'resource_limit');
}

// ─────────────────────────────────────────────────────────────────────────
group('正则细分的 fail-closed 护栏（每条对应一次真实 bug）');

{
  const t = (e, w) => ({ exponents: e, coeff: 1, weight: w });

  degen('零多项式报 zero_polynomial',
    () => T.regularSubdivision([{ exponents: [0, 0], coeff: 0 }], 2), 'zero_polynomial');
  degen('非整数指数报 invalid_input',
    () => T.regularSubdivision([{ exponents: [0.5, 0], coeff: 1 }], 2), 'invalid_input');
  degen('NaN 权重报 invalid_input',
    () => T.regularSubdivision([t([0, 0], 0), t([1, 0], NaN)], 2), 'invalid_input');
  degen('空项集报 invalid_input', () => T.regularSubdivision([], 2), 'invalid_input');
  degen('opts.weights 长度不符报 invalid_input',
    () => T.regularSubdivision([t([0, 0], 0), t([1, 0], 1), t([0, 1], 2)], 2, { weights: [1, 2] }),
    'invalid_input');

  // 指数全相同的项会被去重成一个支撑 ⇒ 支撑集只有 1 点且权重唯一 ⇒ 退化
  degen('重复指数去重后共面报退化',
    () => T.regularSubdivision([
      { exponents: [0, 0], coeff: 1 }, { exponents: [0, 0], coeff: 2 },
      { exponents: [1, 0], coeff: 1 }
    ], 2), 'degenerate_subdivision');
}

// ─────────────────────────────────────────────────────────────────────────
group('T3 热带 Bernstein（泛情形 BKK 取等号）');

{
  const t = (e, w) => ({ exponents: e, coeff: 1, weight: w });

  // 1D x²−1：Δ = [0,2]，归一化混合体积 = 2 ⇒ 2 个根（±1）✓ 手算可验
  const b1 = T.tropicalBernstein([[t([2], 0), t([0], 1)]], 1);
  eq('x²−1 根数界 = 2', b1.nvolMixedVolume, 2);
  eq('x²−1 报泛性', b1.generic, true);
  eq('x²−1 完全交', b1.completeIntersection, true);
  ok('x²−1 等号成立', b1.rootCountIsExact, true);

  // 2D 完全交 x+y=1 与 x+y=−1：两个 Δ 都是标准单位三角形，
  //   nvol 混合体积 = 1 ⇒ 1 个孤立解（(1/2,1/2)，手算可验）
  const b2 = T.tropicalBernstein([
    [t([1, 0], 0), t([0, 1], 1), t([0, 0], 2)],
    [t([1, 0], 3), t([0, 1], 4), t([0, 0], 5)]
  ], 2);
  eq('两平行直线交 1 点 ⇒ 根数界 1', b2.nvolMixedVolume, 1);
  eq('报完全交', b2.completeIntersection, true);
  ok('报等号成立', b2.rootCountIsExact, true);

  // 非满维 Newton 多面体 ⇒ BKK 等号不适用，必须报退化而不是给个数
  degen('非满维支撑报 non_generic_system', () => T.tropicalBernstein([
    [t([1, 0], 0), t([0, 0], 1)],
    [t([0, 1], 2), t([0, 0], 3)]
  ], 2), 'non_generic_system');

  // 方程数 > 变量数 ⇒ 自动降级到 T4 上界
  const b3 = T.tropicalBernstein([
    [t([1, 0], 0), t([0, 1], 1), t([0, 0], 2)],
    [t([1, 0], 3), t([0, 1], 4), t([0, 0], 5)],
    [t([2, 0], 6), t([0, 2], 7), t([0, 0], 8)]
  ], 2);
  ok('冗余方程走 T4 上界（不给等号）', b3.rootCountIsExact !== true, JSON.stringify(b3));
  ok('冗余时报 caveat', Array.isArray(b3.caveats) || typeof b3.caveat === 'string', JSON.stringify(b3.caveats));
}

// ─────────────────────────────────────────────────────────────────────────
group('T4 热带 Bézout 上界（方程冗余时混合体积为何仍管用）');

{
  const t = (e, w) => ({ exponents: e, coeff: 1, weight: w });
  // 三个方程里前两个支撑完全相同 ⇒ 秩 2、冗余
  const r = T.tropicalBezoutBound([
    [t([1, 0], 0), t([0, 1], 1), t([0, 0], 2)],
    [t([1, 0], 3), t([0, 1], 4), t([0, 0], 5)],
    [t([2, 0], 6), t([0, 2], 7), t([0, 0], 8)]
  ], 2);
  eq('方程数 = 3', r.equations, 3);
  eq('有效秩 = 2', r.rank, 2);
  eq('判定为冗余', r.redundant, true);
  eqArr('最优子集 = 前两个（支撑相同 ⇒ 界更小）', r.bestSubset, [0, 1]);
  eq('上界 = 1（两个相同 Δ 的混合体积）', r.bezoutUpperBound, 1);
  ok('必须声明只是上界', /UPPER BOUND/.test(r.caveat), r.caveat);
  eq('三个子集的界全部列出', r.subsetBounds.length, 3);

  // 非冗余：三个不同支撑，但环境维数 n=2 ⇒ 秩**最多**是 2（不是 3）。
  // ⚠ 秩不可能超过环境维数：方程再多也只在 n 维空间里定义 X。
  //   传 rank=3 会被 fail-closed 挡下（rank > n 是输入错误），
  //   而缺省时 r = min(n, k) = 2 —— 这才是「三条方程、局部只需两条」。
  const r2 = T.tropicalBezoutBound([
    [t([1, 0], 0), t([0, 0], 1)],
    [t([0, 1], 2), t([0, 0], 3)],
    [t([1, 1], 4), t([0, 0], 5)]
  ], 2);
  eq('缺省秩 = min(n,k) = 2（不是 k=3）', r2.rank, 2);
  eq('k=3 > r=2 ⇒ 冗余', r2.redundant, true);
  // 秩超过环境维数 ⇒ 输入错误，必须 fail-closed
  degen('rank > n 报 invalid_input',
    () => T.tropicalBezoutBound([
      [t([1, 0], 0), t([0, 0], 1)],
      [t([0, 1], 2), t([0, 0], 3)],
      [t([1, 1], 4), t([0, 0], 5)]
    ], 2, { rank: 3 }), 'invalid_input');
  // rank < k 但 rank ≤ n ⇒ 真的冗余，且界由 rank 个方程给出
  const r3 = T.tropicalBezoutBound([
    [t([1, 0], 0), t([0, 0], 1)],
    [t([0, 1], 2), t([0, 0], 3)],
    [t([1, 1], 4), t([0, 0], 5)]
  ], 2, { rank: 2 });
  eq('显式 rank=2 冗余', r3.redundant, true);
  eq('显式 rank=2 时界为 1', r3.bezoutUpperBound, 1);
}

// ─────────────────────────────────────────────────────────────────────────
group('共圆判定：代数判据 × 几何判据 双路交叉验证');

{
  // 单位正方形四点：圆心 (1/2,1/2)，r = √2/2，四个距离平方都 = 1/2
  const u = T.cocircularCheck([[0, 0], [1, 0], [1, 1], [0, 1]]);
  eq('单位正方形 4×4 行列式 = 0', u.determinant, 0);
  eq('代数判据：共圆', u.cocircularAlgebraic, true);
  eq('几何判据：距离平方离散度 = 0', u.distanceSquaredSpread, 0);
  near('圆心 x = 1/2', u.mecCenter[0], 0.5, 1e-12);
  near('圆心 y = 1/2', u.mecCenter[1], 0.5, 1e-12);
  near('半径 = √2/2', u.mecRadius, Math.SQRT1_2, 1e-12);
  eq('两路判据一致', u.agreement, true);
  eq('结论 = 共圆', u.cocircularVerdict, 'cocircular');

  // 2×2 正方形：圆心 (1,1)，r = √2
  const b = T.cocircularCheck([[0, 0], [2, 0], [2, 2], [0, 2]]);
  near('2×2 圆心 x = 1', b.mecCenter[0], 1, 1e-12);
  near('2×2 半径 = √2', b.mecRadius, Math.SQRT2, 1e-12);
  eq('2×2 共圆', b.cocircularVerdict, 'cocircular');

  // 不共圆：平行四边形 [[0,0],[1,1],[2,2],[3,1]]，行列式 = −8（手算）
  const n = T.cocircularCheck([[0, 0], [1, 1], [2, 2], [3, 1]]);
  eq('非共圆 4 点行列式 = −8', n.determinant, -8);
  eq('代数判据：非共圆', n.cocircularAlgebraic, false);
  ok('几何判据：离散度 > 0', n.distanceSquaredSpread > 0, n.distanceSquaredSpread);
  eq('两路一致（都不认为共圆）', n.agreement, true);
  eq('结论 = 不共圆', n.cocircularVerdict, 'not_cocircular');

  // 共线四点：4×4 行列式也为 0，但那是「半径无穷大的圆」
  //   —— 必须显式区分，否则会把「点放成一条线」说成「四点共圆」。
  const col = T.cocircularCheck([[0, 0], [1, 0], [2, 0], [3, 0]]);
  eq('共线：判定为共线', col.collinear, true);
  eq('共线：结论标注无穷大半径', col.cocircularVerdict, 'collinear_points_define_a_circle_of_infinite_radius');
  eq('共线时两路强制一致', col.agreement, true);
  eq('共线：代数判据仍为 true（行列式为 0）', col.cocircularAlgebraic, true);

  // 点数不为 4 ⇒ 判据本身未定义，必须 fail-closed。
  // ⚠ 两种退化码含义不同，别混：
  //   n > 4：判据**数学上存在**（所有 4 元子集都共圆），但本层不实现子集枚举
  //          ⇒ unsupported_point_count（不是「算不出来」，是「没实现」）
  //   n < 4：3 个点**永远**共圆（过三点必有圆），判据无意义 ⇒ invalid_input
  //          （连「该问什么」都不成立）
  degen('5 点报 unsupported_point_count（判据存在但本层未实现）',
    () => T.cocircularCheck([[0, 0], [1, 0], [1, 1], [0, 1], [2, 2]]), 'unsupported_point_count');
  degen('3 点报 invalid_input（三点必共圆，判据无意义）',
    () => T.cocircularCheck([[0, 0], [1, 0], [1, 1]]), 'invalid_input');

  // 随机不变量：任意 4 点两路判据必须一致（共线时强制一致）
  let agree = 0;
  let N = 0;
  let seed = 20261005;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let k = 0; k < 200; k++) {
    const pts = [];
    for (let i = 0; i < 4; i++) pts.push([Math.round(rnd() * 8 - 4), Math.round(rnd() * 8 - 4)]);
    let res;
    try { res = T.cocircularCheck(pts); } catch (e) { continue; }
    N++;
    if (res.agreement) agree++;
  }
  eq('200 组随机 4 点：两路判据全部一致', agree, N);
}

// ─────────────────────────────────────────────────────────────────────────
group('最小包围圆（Welzl 增量法）');

{
  const eqPt = (a, b) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-9);

  // 单位正方形 ⇒ 圆心 (1/2,1/2)，r = √2/2，4 点都在边界上
  const s = T.minimumEnclosingCircle([[0, 0], [1, 0], [1, 1], [0, 1]]);
  ok('单位正方形圆心 (1/2,1/2)', eqPt(s.center, [0.5, 0.5]), JSON.stringify(s.center));
  near('单位正方形半径 = √2/2', s.radius, Math.SQRT1_2, 1e-12);
  eq('四点都在圆周上', s.boundary, 4);

  // 钝角三角形 ⇒ 最小圆由最长边（直径）确定，不是外接圆
  //   (0,0),(10,0),(5,1) 的钝角在 (5,1)，MEC 是直径圆：心 (5,0)，r = 5
  const o = T.minimumEnclosingCircle([[0, 0], [10, 0], [5, 1]]);
  ok('钝角三角形圆心 (5,0)', eqPt(o.center, [5, 0]), JSON.stringify(o.center));
  near('钝角三角形半径 = 5（直径）', o.radius, 5, 1e-12);
  eq('直径圆只有 2 点在圆周上', o.boundary, 2);

  // 单点 ⇒ r = 0
  const one = T.minimumEnclosingCircle([[3, 4]]);
  ok('单点圆心 = 该点', eqPt(one.center, [3, 4]), JSON.stringify(one.center));
  eq('单点半径 = 0', one.radius, 0);

  // 两点 ⇒ 直径圆
  const two = T.minimumEnclosingCircle([[0, 0], [3, 4]]);
  ok('两点圆心 = 中点 (1.5,2)', eqPt(two.center, [1.5, 2]), JSON.stringify(two.center));
  near('两点半径 = 2.5（3-4-5 的一半）', two.radius, 2.5, 1e-12);

  // fail-closed：空集 / 非二维点
  degen('空点集报 empty_point_set', () => T.minimumEnclosingCircle([]), 'empty_point_set');
  degen('三维点报 invalid_input', () => T.minimumEnclosingCircle([[1, 2, 3]]), 'invalid_input');
  degen('含非数报 invalid_input', () => T.minimumEnclosingCircle([[0, 0], [1, 'x']]), 'invalid_input');

  // 不变量：MEC 半径 ≥ 最大两两距离的一半，且所有点都在圆内
  let seed = 20261006;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let okCover = 0, okTight = 0, cnt = 0;
  for (let k = 0; k < 60; k++) {
    const n = 2 + Math.floor(rnd() * 6);
    const pts = [];
    for (let i = 0; i < n; i++) pts.push([Math.round(rnd() * 20 - 10), Math.round(rnd() * 20 - 10)]);
    let r;
    try { r = T.minimumEnclosingCircle(pts); } catch (e) { continue; }
    cnt++;
    let covered = true;
    for (const p of pts) {
      if (Math.hypot(p[0] - r.center[0], p[1] - r.center[1]) > r.radius + 1e-9) covered = false;
    }
    if (covered) okCover++;
    let maxD = 0;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      maxD = Math.max(maxD, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]));
    }
    if (r.radius >= maxD / 2 - 1e-9) okTight++;
  }
  ok('60 组随机点集：全部点都在 MEC 内', okCover === cnt, `${okCover}/${cnt}`);
  ok('60 组随机点集：r ≥ 最大两两距离/2', okTight === cnt, `${okTight}/${cnt}`);
}

// ─────────────────────────────────────────────────────────────────────────
group('确定性（同输入必须逐字节相同）');

{
  const t = (e, w) => ({ exponents: e, coeff: 1, weight: w });
  const sq = (w) => [t([0, 0], w[0]), t([0, 2], w[1]), t([2, 0], w[2]), t([2, 2], w[3])];
  const J = (x) => JSON.stringify(x);

  eq('regularSubdivision 两次一致',
    J(T.regularSubdivision(sq([0, 0, 0, 1]), 2)),
    J(T.regularSubdivision(sq([0, 0, 0, 1]), 2)));
  eq('tropicalBernstein 两次一致',
    J(T.tropicalBernstein([[t([2], 0), t([0], 1)]], 1)),
    J(T.tropicalBernstein([[t([2], 0), t([0], 1)]], 1)));
  eq('cocircularCheck 两次一致',
    J(T.cocircularCheck([[0, 0], [1, 0], [1, 1], [0, 1]])),
    J(T.cocircularCheck([[0, 0], [1, 0], [1, 1], [0, 1]])));

  // 输入顺序无关：normalizeSupport 按指数字典序重排 ⇒ 输出必须逐字节相同
  const a = T.regularSubdivision([
    t([0, 0], 0), t([0, 2], 0), t([2, 0], 0), t([2, 2], 1)
  ], 2);
  const b = T.regularSubdivision([
    t([2, 2], 1), t([2, 0], 0), t([0, 2], 0), t([0, 0], 0)
  ], 2);
  eq('输入项顺序不同 ⇒ 输出逐字节相同', J(a), J(b));
}

// ══ 分派层：8 个热带 op 已挂进 geometry 工具（Agent 实际看到的入口）════════
// 覆盖率硬闸扫的是 **op 名**（snake_case），而本文件其余各处用的是
// camelCase 的 JS 函数名。这里把 op 名集中列一次，两边都对得上：
//   - 覆盖率闸扫到 op 名 ⇒ 不再误报「未测」
//   - 分派层可用性得到验证（op 真的注册进了 geometry 工具）
// COVERS: newton_polytope, tropical_degree_bound, tropical_system_bound,
// COVERS: regular_subdivision, bernstein_bound, tropical_bezout_bound,
// COVERS: cocircular_check, minimum_enclosing_circle
group('分派层：op 挂在 geometry 工具下（snake_case 入口）');
{
  const IDX = require('../services/geometry/index.js');
  const OPS = [
    ['newton_polytope', { terms: [[0, 0], [2, 0], [0, 2]] }, (v) => v.normalizedVolume, 4],
    ['tropical_degree_bound', { terms: [[0, 0], [1, 0]] }, (v) => v.l1diameter, 1],
    ['tropical_system_bound', { termLists: [[[0, 0], [2, 0], [0, 2]], [[0, 0], [1, 0], [0, 1]]] }, (v) => v.bezoutBound, 2],
    ['regular_subdivision', { terms: [[0, 0], [1, 0], [0, 1], [1, 1]], weights: [0, 0, 1, 0] }, (v) => v.cellCount, 2],
    ['bernstein_bound', { termLists: [[[0, 0], [2, 0], [0, 2]], [[0, 0], [2, 0], [0, 2]]] }, (v) => v.nvolMixedVolume, 4],
    ['tropical_bezout_bound', { termLists: [[[0, 0], [2, 0], [0, 2]], [[0, 0], [1, 0], [0, 1]], [[0, 0], [3, 0]]] }, (v) => v.redundant, true],
    ['cocircular_check', { pts: [[1, 0], [0, 1], [-1, 0], [0, -1]] }, (v) => v.cocircularVerdict, 'cocircular'],
    ['minimum_enclosing_circle', { pts: [[0, 0], [4, 0], [0, 3]] }, (v) => v.radius, 2.5]
  ];
  for (const [op, args, pick, want] of OPS) {
    const r = IDX.doGeometry(Object.assign({ op }, args));
    const got = pick(r.value);
    // 浮点用容差，其余用严格相等
    if (typeof want === 'number' && typeof got === 'number') {
      ok('op ' + op, Math.abs(got - want) < 1e-9, { got, want });
    } else {
      eq('op ' + op, got, want);
    }
    ok('op ' + op + ' 不报退化', !r.degenerate, r.degenerate);
  }
  // op 必须出现在 op 清单里，否则 Agent 看不见（tools/parity 也查这一条）
  const by = IDX.opList();
  const all = [].concat(by['1D'], by['2D'], by['3D'], by.any);
  for (const [op] of OPS) ok('op 在清单里：' + op, all.indexOf(op) >= 0, all.length);
  // 数组形态与对象形态都要能用（LLM 两种都会写）
  eq('数组形态 terms', IDX.doGeometry({ op: 'newton_polytope', terms: [[0, 0], [2, 0], [0, 2]] }).value.normalizedVolume, 4);
  eq('对象形态 terms', IDX.doGeometry({
    op: 'newton_polytope',
    terms: [{ exponents: [0, 0], coeff: 1 }, { exponents: [2, 0], coeff: 1 }, { exponents: [0, 2], coeff: -1 }]
  }).value.normalizedVolume, 4);
  // 非法输入必须点名参数
  degen('terms 形态非法报 invalid_input',
    () => IDX.doGeometry({ op: 'newton_polytope', terms: [{ foo: 1 }] }), 'invalid_input');
  degen('共圆点数不足报 invalid_input',
    () => IDX.doGeometry({ op: 'cocircular_check', pts: [[0, 0], [1, 0]] }), 'invalid_input');
  // 确定性：经分派层两次调用字节级一致
  eq('分派层确定性', JSON.stringify(IDX.doGeometry({ op: 'bernstein_bound', termLists: [[[0, 0], [2, 0], [0, 2]], [[0, 0], [2, 0], [0, 2]]] })),
    JSON.stringify(IDX.doGeometry({ op: 'bernstein_bound', termLists: [[[0, 0], [2, 0], [0, 2]], [[0, 0], [2, 0], [0, 2]]] })));
}

// ─────────────────────────────────────────────────────────────────────────
process.stdout.write(`\n${'═'.repeat(60)}\n`);
if (fails.length) {
  process.stdout.write(`失败 ${fails.length} / 共 ${pass + fails.length}\n`);
  for (const f of fails) process.stdout.write(`  ✗ ${f}\n`);
  process.exit(1);
}
process.stdout.write(`热带几何层：全部通过 ${pass} / ${pass}\n`);
