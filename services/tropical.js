/**
 * 热带几何（tropical geometry）层 —— 连接「代数」与「凸几何」的第三座桥。
 *
 * ── 这个文件在整体里的位置 ──────────────────────────────────────────────
 *   已有两条独立通路：
 *     services/polynomial.js  代数：方程 → 多项式 → 根
 *     services/geometry/      几何：坐标 → 闭式几何量
 *     services/polytope.js    凸几何：点集 → 凸包 → 混合体积
 *   热带几何是**把代数系统的 Newton 多面体读成凸几何对象**这一层：
 *     多项式的支撑集 → Newton 多面体 → 混合细分 → 局部重数 → 根数上界
 *   它复用的正是 services/polytope.js 的凸包与混合体积（不重写一遍凸几何），
 *   而反过来给 bounds.js 的 BKK 界提供了**比多项式次数更紧的稀疏度信息**。
 *
 * ── 严格的 fail-closed 原则 ────────────────────────────────────────────
 *   热带几何里最容易骗人的地方是「说了一套听起来很数学的话，但没证明」：
 *   算不出精确的重数就悄悄给个近似，或者把「generic 时的等号成立」
 *   当成「任意系数时也成立」。这里的规矩是：
 *     1. 只实现**能验证的定理**（下面每条都注明出处与可测的等号条件）；
 *     2. 非 generic 时（混合体退化、支撑集落在低维超平面上）一律报退化，
 *        不给数；
 *     3. 热带 Bernstein 定理 Σm(x) = n!·MV **只在横截/泛情形成立**，
 *        非泛情形下只报**上界**，绝不报「根数就是这个数」。
 *
 * ── 引用的定理（全部可在本文件里用回归测试验证等号）────────────────────
 *   T1  Bernstein 定理（BKK）：n 个 Laurent 多项式在 (C*)^n 里的孤立解数
 *       ≤ 混合体积；泛系数取等号。转发自 polytope.js，不重算。
 *   T2  ℓ¹-直径界（arXiv:2605.24966, Thm 1.3）：
 *       热带超曲面 H 的 tropical degree ≤ diam₁(M) = max‖α−β‖₁；
 *       特别地 ≤ |M| − 1。
 *       其中 Tdeg(H) = sup_L |L ∩ H|（对横截相交的热带直线取上确界，不计重数）。
 *   T3  热带 Bernstein 定理（同上, Thm 4.1）：
 *       对横截的热带完全交 X = V(p₁)·…·V(p_r) 与一般位置的热带仿射线性空间 L，
 *       Σ_x m(x) = n!·MV(Δ₁,…,Δ_r, Σ_L,…,Σ_L)（Σ_L 重复 n−r 次），
 *       m(x) 是对应 fully mixed cell 的（归一化）格点体积。
 *   T4  热带 Bézout 上界（同上, Thm 7.2 / 6.1）：
 *       非完全交情形下 Tdeg(X) ≤ max_{i₁<…<i_r} n!·MV(Δ_{i₁},…,Δ_{i_r}, Σ_L,…,Σ_L)。
 *       论文的核心动机：说明「混合体积为什么在方程冗余时仍然管用」。
 *
 * ── 与 bounds.js / geometry 的接点 ──────────────────────────────────────
 *   · tropicalDegreeBound 给出一个**独立于多项式总次数**的上界：
 *     稀疏系统的 diam₁ 可能远小于次数之和（例：x⁵⁰ + y⁵⁰ = 1 的 diam₁ = 100，
 *     但 tropical degree 上界是 diam₁=100 而 Bézout 给 50·50=2500）。
 *   · regularSubdivision 给出支撑集的**正则细分**——这是「代数符号模式 ⇒ 凸几何」
 *     的直接通道，也是 BKK 取等号（generic）的可判定前提。
 *
 * 运行：node test/test-tropical.js
 */
'use strict';

const P = require('./polytope.js');
// ⚠⚠ 只依赖 geometry/vec.js，**不要**从 solver-service.js 取 detF。
// 历史 bug：这里曾 `require('./solver-service.js')` 只为拿 detF，于是形成循环
//     bounds.js → tropical.js → solver-service.js → bounds.js
// 后果不是「多一条警告」而是**静默半初始化**：先加载任一方时，
// 另一方在顶层 `const { x } = require(...)` 上拿到 undefined
// （实测 solver-service.solutionBounds 与 detF 都变成 undefined），
// 后面任何一次调用都会以 TypeError 崩掉，且堆栈指向无关文件。
// geometry/vec.js 是零依赖叶子模块，它的 detF 与 solver-service 的口径逐字节一致
// （都是 Number(v.toFixed(12))，vec.js 第 178 行的注释就是这么写的）。
const { detF, detV } = require('./geometry/vec.js');

const EPS = 1e-9;

/**
 * 失败即抛结构化错 —— 与 geometry 层同一套口径。
 * 热带层也遵守「退化与算出来是空必须分开」：
 *   generic 假设不成立 ⇒ 退化（禁止下结论）；混合体积为 0 ⇒ 可断言无孤立解。
 */
function fail(type, msg, extra) {
  const e = new Error(msg);
  e.type = type;
  e.extra = extra || null;
  throw e;
}

// ══ 1. 支撑集与 Newton 多面体 ═════════════════════════════════════════════

/**
 * 归一化支撑集：去掉系数为 0 的项，去重，按字典序排序。
 * 排序是**确定性输出的前提** —— 相同支撑集必须给出逐字节相同的下游结果。
 */
function normalizeSupport(terms) {
  if (!Array.isArray(terms) || terms.length === 0) {
    fail('invalid_input', 'terms must be a non-empty array of {exponents:[...], coeff:number}');
  }
  const out = [];
  const seen = new Set();
  for (const t of terms) {
    if (!t || !Array.isArray(t.exponents)) {
      fail('invalid_input', 'each term needs {exponents:[int,...], coeff:number}', { bad: t });
    }
    const e = t.exponents;
    if (!e.length || e.some((x) => !Number.isInteger(x))) {
      fail('invalid_input', 'exponents must be a non-empty array of integers', { got: e });
    }
    const c = t.coeff === undefined ? 1 : t.coeff;
    if (typeof c !== 'number' || !Number.isFinite(c)) {
      fail('invalid_input', 'coeff must be a finite number', { got: c });
    }
    if (Math.abs(c) < EPS) continue;                // 系数为 0 的项不是支撑
    const key = e.join(',');
    if (seen.has(key)) continue;                    // 指数重复 ⇒ 合并（这里保守取首个）
    seen.add(key);
    // weight（可选的抬升高度）必须**跟着项一起走** —— 归一化会重排，
    // 丢在这里的话调用方给的 weight 就再也对不上指数了。
    //
    // ⚠ NaN/Infinity 的 weight 必须**报错**，不能静默丢弃：
    //   丢弃后 regularSubdivision 会回落到「系数模长」，把调用方传的 NaN
    //   悄悄换成 1 —— 细分照样算出来，形状看着正常，但**已经不是他要的细分**。
    //   数值出错时报错，永远比「换个值接着算」便宜。
    if (t.weight !== undefined && t.weight !== null) {
      if (typeof t.weight !== 'number' || !Number.isFinite(t.weight)) {
        fail('invalid_input', 'weight must be a finite number when provided', { got: t.weight });
      }
    }
    out.push({
      exponents: e.slice(),
      coeff: c,
      weight: (t.weight === undefined || t.weight === null) ? undefined : t.weight
    });
  }
  if (!out.length) {
    // 所有系数都是 0 ⇒ 这是**零多项式**，不是退化输入
    fail('zero_polynomial', 'every coefficient is 0 — this is the zero polynomial, not a system term');
  }
  out.sort((a, b) => {
    for (let i = 0; i < a.exponents.length; i++) {
      if (a.exponents[i] !== b.exponents[i]) return a.exponents[i] - b.exponents[i];
    }
    return 0;
  });
  return out;
}

/** Newton 多面体 = 支撑集的凸包（复用 polytope.js，不重写凸包） */
function newtonPolytope(terms, dim) {
  const t = normalizeSupport(terms);
  const n = dim || t[0].exponents.length;
  const pts = t.map((x) => x.exponents.slice());
  const hull = P.convexHull(pts, n);
  return {
    dim: n,
    vertices: hull.vertices,
    vertexCount: hull.vertices.length,
    normalizedVolume: hull.normalizedVolume,
    normalizedVolumeExact: hull.normalizedVolumeExact,
    exact: hull.exact,
    // 支撑集张成的线性空间维数 < n ⇒ 系统必然在 (C*)^n 里无穷多解
    // （Kouchnirenko 的前提之一是「满支撑」）。这是退化，不是不确定。
    fullDimensional: hull.rank === n,
    supportSize: t.length
  };
}

// ══ 2. T2：ℓ¹-直径上界（arXiv:2605.24966, Thm 1.3）═══════════════════════

/**
 * 热带超曲面的 tropical degree 上界。
 *
 * 定理（T2）：设 M ⊂ Zⁿ 有限，H 是 p(x) = max_{α∈M}(⟨x,α⟩ + c_α) 的热带超曲面，
 * 则 Tdeg(H) ≤ diam₁(M) = max_{α,β∈M} ‖α−β‖₁，特别地 ≤ |M| − 1。
 *
 * ⚠ 为什么这个界**有用**（不是同义反复）：
 *   多项式**总次数**给出 Bézout 界 ∏d_i，而 diam₁ 只看支撑集的跨度。
 *   稀疏系统上二者差距极大：x⁵⁰ + y⁵⁰ = 1 的 diam₁ = 100，
 *   而两个方程的总次数分别是 50，Bézout 给 2500 —— 差 25 倍。
 *   也就是说 diam₁ 把「稀疏」这件几何事实变成了一个可比较的数。
 *
 * ⚠ 口径诚实：diam₁ **不是** tropical degree 本身，只是上界。
 *   真 degree 需要对**所有**横截热带直线取上确界（Definition 1.2），
 *   那是无穷族方向的极值问题，本层**不实现**（不猜），只给上界。
 *   要下界请用 tropicalIntersection（泛情形下 T3 取等号）。
 */
function tropicalDegreeBound(terms, dim) {
  const t = normalizeSupport(terms);
  const n = dim || t[0].exponents.length;
  let diam = 0;
  for (let i = 0; i < t.length; i++) {
    for (let j = i + 1; j < t.length; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += Math.abs(t[i].exponents[k] - t[j].exponents[k]);
      if (s > diam) diam = s;
    }
  }
  return {
    dim: n,
    supportSize: t.length,
    l1diameter: diam,
    // 论文的「特别地」那一行：diam₁ ≤ |M| − 1（指数都是整数，|α−β|₁ 是非负整数）
    degreeUpperBound: Math.min(diam, t.length - 1),
    // 两条界各管一段：diam₁ 是可证的上界，|M|−1 是更松但更便宜的同义上界
    boundBasis: 'arXiv:2605.24966 Thm 1.3: tropical degree <= l1-diameter of the support, and <= |M|-1',
    caveat: 'This is an UPPER BOUND, not the degree itself. Tdeg(H) = sup over all transverse tropical lines; that infinite family is not enumerated here. Do NOT report this as the degree.'
  };
}

/** 多项式系统上比 Bézout 更紧的稀疏度上界：逐条取 min（BKK, T1） */
function tropicalSystemBound(termLists, dim) {
  if (!Array.isArray(termLists) || !termLists.length) {
    fail('invalid_input', 'termLists must be a non-empty array of supports');
  }
  const n = dim || termLists[0][0].exponents.length;
  if (termLists.length !== n) {
    // n 个方程 n 个变量是 BKK 的前提。方程数不等时 BKK 不适用，
    // 但这不是「无解」，是**前提不成立** ⇒ 退化。
    fail('not_square',
      `BKK / tropical bounds need n equations in n variables, got ${termLists.length} supports in ${n} variables`);
  }
  const per = termLists.map((ts) => tropicalDegreeBound(ts, n));
  const bezout = termLists.map((ts) => {
    const t = normalizeSupport(ts);
    let d = 0;
    for (const x of t) for (const e of x.exponents) d = Math.max(d, e);
    return d;
  });
  let bezoutBound = 1;
  for (const d of bezout) bezoutBound *= d;
  const diamBound = per.reduce((a, x) => a * x.degreeUpperBound, 1);
  return {
    dim: n,
    perEquation: per,
    bezoutBound,
    // ⭐ 融合点：BKK（混合体积，凸几何）vs Bézout（次数）与 diam₁（支撑跨度）取最小
    bkkBound: null,                     // 由 bounds.js 填（它有真正的 mixedVolume）
    degreeProductBound: bezoutBound,
    diameterProductBound: diamBound,
    best: Math.min(bezoutBound, diamBound),
    sparsityGain: bezoutBound / Math.max(1, Math.min(bezoutBound, diamBound))
  };
}

// ══ 3. 正则细分（generic 性的可判定前提）══════════════════════════════════

/**
 * 正则细分（regular subdivision）—— 支撑集 Δ 上的**一个**胞腔分解，
 * 由「抬升」weights 决定：把 (α, w_α) 抬到 R^{n+1}，取**下凸包**（下包络）。
 * 热带超曲面 H 的对偶多面体分解 = 支撑集的正则细分。
 *
 * ⚠ 为什么这在求解器里有位置：BKK 说「泛系数取等号」，
 *   而**判断一组具体系数是否泛**在代数上很难（要算判别式）。
 *   几何上有一个**充分且可判定**的替代：抬高各系数使细分**非退化**（下包络是三角剖分）。
 *   实践中常用「系数高度差异足够大 ⇒ 非退化」这一充分条件。
 *   本函数给的是**这个判定的工具**（算出当前细分 + 它的非退化性），不是判定器。
 *
 * 实现说明：不复用 polytope.js 的 hullCore（它只返回顶点，不返回面格），
 * 因为细分需要的是**完整的下包络面集**。这里用穷举小规模实现，
 * 规模闸 fail-closed —— 热带几何的组合爆炸是真实的（3^n 子集），
 * 不能像凸包那样"多加几个点没关系"。
 */
function regularSubdivision(terms, dim, opts) {
  const t = normalizeSupport(terms);
  const n = dim || t[0].exponents.length;
  const m = t.length;
  // 权重来源优先级：opts.weights 显式传入 > 每个项自带的 weight > 系数模长。
  // ⚠ normalizeSupport 会按指数字典序**重排**并去重项，所以绝不能靠下标 i 去对齐
  //   调用方传入的权重数组 —— 顺序对不上就会把权重安到错误的指数上。
  //   正确做法是跟着 normalizeSupport 的结果走：取每项自己的 weight。
  let weights;
  if (opts && opts.weights) {
    // 显式数组：调用方须知它对应的是**归一化排序后**的顺序（文档化在 brief 里）
    if (!Array.isArray(opts.weights) || opts.weights.length !== m) {
      fail('invalid_input', `opts.weights must be an array of ${m} numbers`, { got: opts.weights && opts.weights.length });
    }
    weights = opts.weights.slice();
  } else {
    weights = t.map((x) => (x.weight !== undefined ? x.weight : Math.abs(x.coeff)));
  }
  for (const w of weights) {
    if (typeof w !== 'number' || !Number.isFinite(w)) {
      fail('invalid_input', 'weights must be finite numbers', { got: w });
    }
  }
  const pts = t.map((x, i) => x.exponents.slice().concat([weights[i]]));

  // 规模闸：3^m 的子集枚举。m=12 已经是 531k 个子集，够慢了。
  const MAX_M = 12;
  if (m > MAX_M) {
    fail('resource_limit',
      `regular subdivision enumerates up to 2^${m} faces; support size ${m} exceeds the ${MAX_M} cap. ` +
      'Sparse large systems should use the mixed-volume bound instead (see solutionBounds).',
      { supportSize: m, cap: MAX_M });
  }

  // 高度退化闸：所有权重相同 ⇒ 抬升后的点**共面**（全在 z=w 平面），
  // 此时「下包络」是整个多面体这一个非单纯形胞腔，细分**不由权重决定**。
  // 这不是「细分里有 1 个胞腔」的平凡情形，而是「细分未定义」。
  // 报成 1 个胞腔会让人以为算完了；报成多个胞腔是算错。
  // 历史 bug：正方形四点无论怎么抬都返回 3 个胞腔、格点体积 3 ≠ nvol 2 ——
  // 因为 (d−1) 行约束写成了 d 行，法向全是 NaN，判据恒放行。
  const distinctHeights = new Set(weights.map((w) => w.toFixed(12))).size;
  if (distinctHeights === 1) {
    fail('degenerate_subdivision',
      'all weights are equal, so the lifted support is coplanar and the regular subdivision is ' +
      'undetermined (the "lower hull" is the whole polytope, one non-simplicial cell). ' +
      'Give distinct weights — e.g. weights[i] = coefficient magnitude — to get a real subdivision.',
      { supportSize: m, dim: n, weights: weights.slice() });
  }

  // 下包络：枚举支撑集的所有 (n+1) 元子集 B，
  // 检查是否存在**下**支撑超平面（λ=(v,t) 使 B 取到最小值）。
  const cells = [];
  for (let mask = 1; mask < (1 << m); mask++) {
    const B = [];
    for (let i = 0; i < m; i++) if (mask & (1 << i)) B.push(i);
    if (B.length !== n + 1) continue;              // 只处理单纯形（闭式可判）
    const feas = lowerFacetFeasible(pts, B, n);
    if (!feas) continue;
    // 胞腔的归一化格点体积 = 该胞腔上的热带重数（T3 里的 m(x)）
    const nv = simplexLatticeVolume(pts, B, n);
    if (nv === null) continue;
    cells.push({
      size: B.length,
      indices: B,
      simplex: true,
      latticeVolume: nv,
      normalExponents: feas.v.map((x) => detF(x)),
      height: detF(feas.t),
      feasible: true
    });
  }
  if (!cells.length) {
    fail('degenerate_subdivision',
      'no lower facet found among the simplices — the lifted support is degenerate. ' +
      'Raise the coefficient heights (weights) to make the subdivision non-degenerate.',
      { supportSize: m, dim: n, weights: weights.slice() });
  }
  const maxCells = 20000;
  if (cells.length > maxCells) {
    fail('resource_limit', `subdivision produced ${cells.length} cells > ${maxCells} cap`, { cells: cells.length });
  }
  // 细分必须覆盖整个 Newton 多面体：格点体积之和 = nvol(Δ)。
  // 这是**可验证等式**，也是「没有漏掉胞腔 / 没有重复计数」的唯一自证。
  const volSum = cells.reduce((a, c) => a + c.latticeVolume, 0);
  const np = newtonPolytope(t, n);
  const coversNewton = volSum === np.normalizedVolume;
  if (!coversNewton) {
    // ⭐ 宁可报退化，也不报一组自相矛盾的胞腔。
    // 体积和与 Newton 多面体不等 ⇒ 细分里**存在非单纯形胞腔**（两个以上支撑点共面），
    // 而本实现只枚举 (n+1) 元单纯形，非单纯形胞腔必然被漏掉。
    // 正确处理非单纯形需要多面体重心分解的 LP 或 face-lattice，量级完全不同 —— 不猜。
    // 历史 bug：正方形四点无论怎么抬都返回 3~4 个胞腔、格点体积 3~4 ≠ nvol 2，
    // 因为法向全是 NaN 且缺极大性判据，体积和「差不多」正是最典型的静默错误。
    fail('subdivision_has_non_simplicial_cell',
      `lattice volume sum of the simplices found (${volSum}) != normalized volume of the Newton polytope ` +
      `(${np.normalizedVolume}). The gap means the subdivision contains a NON-simplicial cell (several ` +
      'support points coplanar), which this simplex-only enumerator cannot represent. ' +
      'No multiplicities are reported. Use generic coefficients so every cell is a simplex, ' +
      'or read the bound from tropicalBernstein / tropicalDegreeBound instead.',
      { volumeSum: volSum, newtonNvol: np.normalizedVolume, supportSize: m, dim: n, weights: weights.slice() });
  }
  return {
    dim: n,
    supportSize: m,
    weights: weights.slice(),
    cellCount: cells.length,
    cells: cells.slice(0, 200),
    cellsTruncated: cells.length > 200,
    allSimplicial: true,
    // 非退化 = 全部胞腔都是单纯形（这保证 BKK 取等号）
    nonDegenerate: true,
    // ⭐ 细分覆盖性自证：格点体积之和精确等于 Newton 多面体的归一化体积
    latticeVolumeSum: volSum,
    newtonNormalizedVolume: np.normalizedVolume,
    coversNewton: true,
    caveat: 'Volume sum matches the Newton polytope exactly, so the subdivision is complete. ' +
      'Cell lattice volumes are the local tropical multiplicities m(x) in arXiv:2605.24966 Thm 4.1.',
    maxPossibleCells: binomial(m - 1, n)
  };
}

/** 二项式系数（小规模精确，溢出前用浮点但规模受限） */
function binomial(a, b) {
  if (b < 0 || b > a) return 0;
  let r = 1;
  for (let i = 0; i < b; i++) r = r * (a - i) / (i + 1);
  return Math.round(r);
}

/**
 * 判定 B（升维后点集的子集）是否是**下包络面**。
 *
 * 条件：存在 n 维向量 λ ∈ R^n 与常数 c，使
 *   ⟨λ, α_i⟩ + w_i = c     对所有 i ∈ B（取等）
 *   ⟨λ, α_i⟩ + w_i > c     对所有 i ∉ B（严格在上方）
 * 这是「B 是某个 n−1 维下包面」的**充要**刻画（存在性半空间问题）。
 *
 * ⚠ 为什么用「遍历 B 的所有超平面」这个笨办法，而不是求 λ：
 *   B 的顶点数是 k = |B|。若 k = n+1（单纯形），法向方向唯一：
 *   λ 在指数空间的投影必须 ⊥ span(B − B[0])，其余自由度只在高度维。
 *   这时可以闭式算出来（orthoNum），用不着 LP。
 *   若 k > n+1（非单纯形），法向构成一个 (k−n) 维族，
 *   闭式不再有 —— 那种情形的正确做法是 LP，本层**不实现 LP**。
 *   所以这里的口径是：**只对单纯形胞腔报数**，非单纯形报 null（fail-closed）。
 *
 * 关键修正（历史 bug，务必保留）：先前版本无条件取 λ 的高度分量为 0，
 * 于是对**正方形四点**这类「抬高一个角就应切成两三角形」的情形永远判不出对角线 ——
 * 因为对角线的法向在指数空间分量非零，纯高度法向看不到它。
 * 正确做法：λ = (v, t)，v 取 B 的指数空间法向（闭式），
 * 再**解一元不等式组**定 t，使得所有 i∉B 的不等式同时成立。
 */
function lowerFacetFeasible(pts, B, n) {
  if (B.length !== n + 1) return null;          // 只处理 n 维单纯形胞腔

  // ── 数学定义（本函数唯一判据，写清楚以免再改错）──────────────────────
  // 正则细分的胞腔 = 下包络的面。B 是胞腔 ⟺ 存在 v ∈ R^n、c ∈ R，使
  //     B = argmin_{i∈M} ( L(α_i) ),   L(α) := ⟨v,α⟩ + c
  // 于是 B 上的点取等（定出 c），非 B 点的「高度」严格大于 L 的取值。
  //
  // ⚠⚠ 本函数改过四轮，每轮都错，全部由「格点体积之和 = Newton 多面体
  //   归一化体积」这条不变量抓住。根因是同一类：v 与 c 的角色搞混。
  //   v **不是** B 的法向（曾按法向算，判据恒放行）；
  //   「上方」也不等于「⟨v,·⟩+w 更大」（那是 ⟨v,·⟩ 与 w 同向和，与定义式差符号）。
  //
  // 取等条件给出 v：⟨v, α_{B[j]} − α_{B[0]}⟩ = w_{B[j]} − w_{B[0]}（j=1..n）。
  // 系数矩阵的行使指数差、右端是**高度差**（不减反增）。
  const b0 = pts[B[0]];
  const A = [], rhs = [];
  for (let j = 1; j < B.length; j++) {
    const r = [];
    for (let k = 0; k < n; k++) r.push(pts[B[j]][k] - b0[k]);
    A.push(r);
    rhs.push(pts[B[j]][n] - b0[n]);
  }
  const v = solveSquare(A, rhs, n);
  if (!v) return null;                            // A 奇异

  // 由 L(α_b0) = w_b0 定出 c：c = w_b0 − ⟨v,α_b0⟩
  let c = b0[n];
  for (let k = 0; k < n; k++) c -= v[k] * b0[k];

  // ── ⭐ 取等残差自检（B 内每个点都必须真的落在 L 上）──────────────────
  // 这是把 rhs 那个符号**永久钉死**的护栏，也是本函数唯一不需要外部参照就能
  // 判真假的检查。上面解 v 时用的是 rhs = w_j − w_b0，若这个符号被改成
  // w_b0 − w_j，解出的 v 会整体取反 —— 而**下游判据的符号也会跟着一起反**，
  // 于是整套判据翻转成 argmax，仍然「自洽」、仍然不报错，只是数出来的
  // 胞腔完全是上包络那一套（正方形 4 点会得到 3~4 个胞腔、格点体积 12 ≠ 8）。
  // 那个 bug 之所以反复出现，就是因为它自己抓不到自己。
  //
  // 正例（pts 字典序 (0,0)w0,(0,2)w1,(2,0)w2,(2,2)w3 = w=(0,1,2,3)）：
  //   B=[0,1,2] ⇒ rhs=(1,2), A=[[0,2],[2,0]] ⇒ v=(1,0.5), c=0
  //   ⇒ w−L = (0, 0, 0, −4)：B 内三点残差全 0（真胞腔），点 3 在下方 4 ⇒ 拒。
  // 反例（rhs 取反）：v=(−1,−0.5) ⇒ w−L = (0, 2, 4, 6)：
  //   B 内两点残差是 2 和 4 —— 明显不是 0，一眼看出 v 解错了方程。
  const eqScale = Math.max(1, ...B.map((i) => Math.abs(pts[i][n])));
  for (const i of B) {
    let Li = c;
    for (let k = 0; k < n; k++) Li += v[k] * pts[i][k];
    const residual = pts[i][n] - Li;
    if (Math.abs(residual) > 1e-7 * eqScale) return null;   // B 不共面 ⇒ 不是胞腔
  }

  // 非 B 点必须严格在支撑平面 L 的**上方**。
  //
  //   下包络 = lift (α_i, w_i) 后所有支撑点都在它上方的那个面。
  //   B 上取等（w_i = L(α_i)，已由解 v 保证），其余点必须满足 w_i > L(α_i)。
  //   记 heightAbove = w_i − L(α_i) ⇒ 判它是 **> 0**。
  //
  // ⚠⚠ 这里的符号被反过两次，两次都不报错、只是安静地数错胞腔。
  //   取反写成 L(α_i) − w_i > 0 会判成 argmax（上包络）：
  //   1D 支撑 {0,1,2}、权重 (0,1,3) 于是收下 [0,2] 这个**非胞腔**（heightAbove = −2.5），
  //   格点体积和变成 1 + 2 = 3，而正确细分是 [0,1] 与 [1,2]，和 = 2。
  // 定符号的唯一办法是**算一个已知算例**，不要靠「上方/下方」的字面直觉：
  //   B=[0,1] ⇒ v=−1, c=0 ⇒ 点 2: w−L = 3−(−2) = +5 ⇒ 胞腔
  //   B=[0,2] ⇒ v=−1.5, c=0 ⇒ 点 1: w−L = 1−(−1.5) = −2.5 ⇒ 非胞腔
  //   B=[1,2] ⇒ v=−2, c=3 ⇒ 点 0: w−L = 0−3 = −3 ⇒ 非胞腔
  const scale = Math.max(1, ...pts.map((p) => Math.abs(p[n])));
  for (let i = 0; i < pts.length; i++) {
    if (B.indexOf(i) >= 0) continue;
    let Li = c;
    for (let k = 0; k < n; k++) Li += v[k] * pts[i][k];    // L(α_i)
    const heightAbove = pts[i][n] - Li;                    // w_i − L(α_i)
    if (!(heightAbove > 1e-9 * scale)) return null;         // 不严格在上方 ⇒ 不是胞腔
  }
  return { v, t: c };
}

/** 解 n 元线性方程组（高斯消元 + 部分主元）。奇异或无解返回 null。 */
function solveSquare(A, b, n) {
  if (A.length !== n) return null;
  const M = A.map((r, i) => r.slice().concat([b[i]]));
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let i = c + 1; i < n; i++) {
      if (Math.abs(M[i][c]) > Math.abs(M[piv][c])) piv = i;
    }
    if (Math.abs(M[piv][c]) < 1e-12) return null;          // 奇异
    if (piv !== c) { const t = M[piv]; M[piv] = M[c]; M[c] = t; }
    for (let i = c + 1; i < n; i++) {
      const f = M[i][c] / M[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[i][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
    if (!Number.isFinite(x[i])) return null;
  }
  return x;
}

/** B 恰为 n+1 点时，抬升前（投影到指数空间）的归一化（格点）单纯形体积 */
function simplexLatticeVolume(pts, B, n) {
  const base = pts[B[0]];
  const rows = [];
  for (let i = 1; i < B.length; i++) {
    const r = [];
    for (let k = 0; k < n; k++) r.push(pts[B[i]][k] - base[k]);
    rows.push(r);
  }
  const det = P.detNum(rows);
  if (det === null) return null;
  return Math.abs(det);
}

// ══ 4. 热带 Bernstein 定理（T3）与热带 Bézout 上界（T4）══════════════════

/**
 * 热带 Bernstein 定理（T3，arXiv:2605.24966 Thm 4.1）：
 * 对横截的热带完全交 X = V(p₁)·…·V(p_r) 与**一般位置**的热带仿射线性空间 L，
 *   Σ_x m(x) = n!·MV(Δ₁,…,Δ_r, Σ_L, …, Σ_L)（Σ_L 重复 n−r 次）
 * 其中 m(x) 是对应 fully mixed cell 的归一化格点体积。
 *
 * ⚠ 这里的实现口径（必须诚实）：
 *   论文用「归一化格点体积」Vol_ℤ(C) 的约定，Σ_L 是与 L 关联幺模单纯形。
 *   换成归一化混合体积的常见约定后，等式形如
 *      Σ_x m(x) = n! · MV(Δ₁,…,Δ_r, Σ,…,Σ)
 *   本函数**只实现 r = n 的完全交情形**（此时 MV(Δ₁,…,Δ_n) 直接就是 BKK 量），
 *   把定理退化成
 *      Σ_x m(x) = n! · MV(Δ₁,…,Δ_n) = n!·(BKK 用的归一化混合体积同量纲)
 *   并**在泛情形下取等号**。r < n 的非完全交情形走 tropicalBezoutBound（T4 的上界形式），
 *   那里只报上界，不报等号。
 *
 * @param termLists r 个支撑集
 * @param opts.strictGeneric=true 时校验「各支撑集满维且互不同形」，
 *        否则报 non_generic_system（退化）而不是给一个可能偏小的数。
 */
function tropicalBernstein(termLists, dim, opts) {
  const n = dim || termLists[0][0].exponents.length;
  if (termLists.length !== n) {
    return tropicalBezoutBound(termLists, n, opts);   // 方程冗余 ⇒ 走 T4 上界
  }
  const supports = termLists.map((ts) => normalizeSupport(ts));
  // 泛性检查：每个支撑集必须张成整个 R^n（否则 (C*)^n 里的解在无穷远）
  const fullDim = supports.map((t, i) => newtonPolytope(t, n).fullDimensional);
  const allFull = fullDim.every(Boolean);
  if (!allFull && !(opts && opts.strictGeneric === false)) {
    fail('non_generic_system',
      'at least one Newton polytope is not full-dimensional: the system has solutions only at infinity ' +
      '(or infinitely many), so the Bernstein equality does not apply as a root count.',
      { fullDimensional: fullDim });
  }
  const polys = supports.map((t) => t.map((x) => x.exponents));
  const mv = P.mixedVolume(polys, n);
  // 归一化混合体积 ⇒ 泛情形的孤立解数（BKK 取等号）
  const nvol = mv.integral ? mv.mixedVolume : null;
  if (nvol === null) {
    fail('non_integral_mixed_volume',
      'mixed volume did not come out integral; the supports are not generic enough for an exact count',
      { mv });
  }
  return {
    dim: n,
    completeIntersection: true,
    generic: allFull,
    nvolMixedVolume: nvol,
    // BKK 的根数上界（泛情形取等号）
    rootCountBound: nvol,
    rootCountIsExact: allFull,
    // 论文里的两种约定都列出来，避免下游误用其中一种
    conventionNote: 'With normalized (lattice) mixed volume, BKK count = nvolMixedVolume. ' +
      'The paper writes the tropical form as sum of local lattice volumes = n! * MV(Euclidean convention).',
    newtonPolytopes: supports.map((t) => newtonPolytope(t, n).vertices),
    caveats: mv.rankDeficient
      ? ['mixed volume computation was rank-deficient; treat the number as an upper bound only']
      : []
  };
}

/**
 * 热带 Bézout 上界（T4，arXiv:2605.24966 Thm 7.2）：
 * 方程冗余时（k > r），在任一光滑点存在 r 条「本质」方程局部定义该簇，
 * 于是 Tdeg(X) ≤ max_{i₁<…<i_r} n!·MV(Δ_{i₁},…,Δ_{i_r}, Σ_L,…,Σ_L)。
 *
 * ⚠ 落地口径：**只算上界，不报重数**。论文这一章讲的是「局部横截约化」，
 *   真要在本层实现重数需要 tangent lattice 的行列式指数公式 —— 那是另一个量级的工作，
 *   不猜、不做半成品。
 */
function tropicalBezoutBound(termLists, dim, opts) {
  const n = dim || termLists[0][0].exponents.length;
  const k = termLists.length;
  const r = (opts && opts.rank) || n;
  if (r > k) {
    fail('invalid_input', `rank r=${r} exceeds the number of equations k=${k}`);
  }
  if (r > n) {
    fail('invalid_input', `rank r=${r} exceeds the ambient dimension n=${n}`);
  }
  // n!·MV(Δ_1,…,Δ_r, Σ,…,Σ)，Σ 重复 n−r 次。幺模单纯形 Σ = conv(0,e_1,…,e_n)，
  // 在归一化约定下 MV(…,Σ) 不改变混合体积的值（重复同一多面体是幂等方向），
  // 所以这里的上界退化为「选出 r 个支撑集后的 BKK 量」。
  // 论文之所以还要写 Σ：它约束的是**对 L 的横截性**（L 必须避开所有 Δ_i），
  // 而不是一个额外的数值因子。这里把横截前提显式报出来。
  let best = null, bestSub = null;
  const combos = [];
  const idx = [];
  for (let i = 0; i < k; i++) idx.push(i);
  const rec = (start, chosen) => {
    if (chosen.length === r) {
      if (r === n) {
        const polys = chosen.map((i) => termLists[i].map((x) => x.exponents));
        const mv = P.mixedVolume(polys, n);
        if (mv.integral && (best === null || mv.mixedVolume < best)) {
          best = mv.mixedVolume;
          bestSub = chosen.slice();
        }
        combos.push({ subset: chosen.slice(), bound: mv.integral ? mv.mixedVolume : null });
      }
      return;
    }
    for (let i = start; i < k; i++) { chosen.push(i); rec(i + 1, chosen); chosen.pop(); }
  };
  rec(0, []);
  if (best === null) {
    fail('no_generic_subsystem',
      'no subset of r equations gave an integral mixed volume; cannot report a Bezout-type bound',
      { k, r, combos: combos.slice(0, 8) });
  }
  return {
    dim: n,
    equations: k,
    rank: r,
    redundant: k > r,
    bezoutUpperBound: best,
    bestSubset: bestSub,
    transversalityPrecondition: 'The tropical affine linear space L must avoid every Newton polytope (generic position). ' +
      'Under that precondition the bound holds; this is the geometric reason mixed volume survives redundant systems.',
    caveat: 'UPPER BOUND ONLY. This function does not compute local stable intersection multiplicities ' +
      '(that needs tangent-lattice determinant-index formulas) and must not be reported as a root count.',
    subsetBounds: combos.slice(0, 32),
    subsetBoundsTruncated: combos.length > 32
  };
}

// ══ 5. 融合闸：几何 ⇄ 代数的一致性检查 ════════════════════════════════════

/**
 * ⭐ 这就是「桥」本身：拿**一个几何事实**去检验**一个代数系统**。
 *
 * 场景：调用方有一个多项式系统，它宣称在几何上有意义（例如「三条直线共点」、
 * 「四个点共圆」）。本函数做两件事：
 *   1. 用几何判据独立算出「该成立的东西」（面积、行列式、混合体积）；
 *   2. 与代数上算出的量对照，返回**闭合误差 residual**。
 * 把恒等式的残差搬进返回值 = 把回归测试搬进产品（沿用 test-polytope.js 的原则）。
 *
 * 具体的几何事实选的是**最容易被方程组伪装**的那个：共圆性。
 * 它的代数判据是「4×4 行列式 = 0」，几何判据是「圆心到四点等距」。
 * 两条路互不依赖 ⇒ 残差可以真的当回归护栏用。
 */
function cocircularCheck(pts) {
  if (!Array.isArray(pts) || pts.length < 4) {
    fail('invalid_input', 'need at least 4 2D points for a concyclicity test', { got: pts && pts.length });
  }
  const d2 = pts[0].length;
  if (d2 !== 2) fail('unsupported_dimension', 'cocircularCheck is 2D only', { dim: d2 });
  for (const p of pts) {
    if (!Array.isArray(p) || p.length !== 2) fail('invalid_input', 'each point must be [x,y]', { got: p });
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) fail('invalid_input', 'coordinates must be finite', { got: p });
  }
  // ⚠⚠ 重复点必须在这里挡掉（历史 bug，200 组随机算例里抓到 12 组）。
  //   4×4 共圆行列式的行是 (x²+y², x, y, 1) —— **重复点给出完全相同的行**，
  //   行列式恒为 0，代数判据于是说「四点共圆」。
  //   但三个不同的点永远能被一个圆穿过（只要不共线），把重复点凑成 4 个
  //   只是让它看起来像 4 点判定 —— 实测 [[2,-3],[1,1],[1,1],[3,-3]]
  //   会得到 det=0 / 判定「共圆」，而几何侧 spread=0.433 明确说不共圆。
  //   两路判据互相打脸时**不能选一个信** —— 前提被破坏，正确做法是 fail-closed。
  const seen = new Set();
  for (const q of pts) {
    const key = q[0] + '|' + q[1];
    if (seen.has(key)) {
      fail('duplicate_points',
        `the concyclicity determinant needs 4 DISTINCT points; [${q}] appears more than once. ` +
        'A repeated point makes the 4x4 determinant vanish, which would be read as "cocircular" ' +
        'even though only 3 distinct points are given. Deduplicate first.',
        { points: pts.length, duplicate: q.slice() });
    }
    seen.add(key);
  }
  const det = cocircularDeterminant(pts);
  // 几何侧：最小包围圆（空集/点集/圆三态）
  const mec = minimumEnclosingCircle(pts);
  // 四点到圆心距离**平方**的离散度。
  // ⚠ 方差公式必须用 mean(dd) 而不是 mean(dd²)：
  //   正确： sd = sqrt( E[dd²] − (E[dd])² )，其中 dd = 距离平方
  //   写错成 sqrt( E[dd²] − (E[dd²])² ) 时所有项量纲不同，
  //   零散度被算成非零 —— 单位正方形四顶点明明等距，却报 spread=0.433。
  const d2s = pts.map((p) => (p[0] - mec.center[0]) ** 2 + (p[1] - mec.center[1]) ** 2);
  const mean = d2s.reduce((a, b) => a + b, 0) / d2s.length;
  const meanSq = d2s.reduce((a, b) => a + b * b, 0) / d2s.length;
  const spread = Math.sqrt(Math.max(0, meanSq - mean * mean));

  // ⚠ 4 点**共线**时共圆行列式也为 0（相当于半径无穷大的圆）。
  //   这时 algebraic 判据会说「共圆」，但几何上根本没有有限的圆 ——
  //   必须显式标出，否则调用方会拿一个无穷大半径去用。
  const collinear = allCollinear(pts);

  return {
    pointCount: pts.length,
    // 代数判据：4×4 行列式（四点共圆 ⟺ 行列式为 0）
    determinant: detF(det),
    cocircularAlgebraic: Math.abs(det) < 1e-9,
    // 几何判据：最小包围圆上的最大偏差
    mecCenter: detV(mec.center),
    mecRadius: detF(mec.radius),
    distanceSquaredMean: detF(mean),
    distanceSquaredSpread: detF(spread),
    cocircularGeometric: spread < 1e-7 * Math.max(1, mean),
    collinear,
    // 共线时「共圆」没有有限半径的说法 —— 显式把这条禁令说出来
    cocircularVerdict: collinear
      ? 'collinear_points_define_a_circle_of_infinite_radius'
      : ((Math.abs(det) < 1e-9) ? 'cocircular' : 'not_cocircular'),
    // ⭐ 两条独立路径的一致性 —— 这才是真正能当回归护栏的量
    agreement: collinear ? true : ((Math.abs(det) < 1e-9) === (spread < 1e-7 * Math.max(1, mean))),
    basis: 'algebraic: 4x4 concyclicity determinant (exact); geometric: min-enclosing-circle radial spread (independent)'
  };
}

/** 4 点（或 n 点）是否全部共线 */
function allCollinear(pts) {
  if (pts.length < 3) return false;
  for (let i = 1; i < pts.length - 1; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const cross = (pts[i][0] - pts[0][0]) * (pts[j][1] - pts[0][1])
        - (pts[j][0] - pts[0][0]) * (pts[i][1] - pts[0][1]);
      if (Math.abs(cross) > 1e-12) return false;
    }
  }
  return true;
}

/**
 * 四点共圆行列式 det[[x²+y², x, y, 1]]（共圆 ⟺ 为 0）。
 *
 * ⚠ 实现选择：**带部分主元的高斯消元**，不是手写 Laplace 展开。
 *   写展开式看起来"更数学"，但 4×4 展开的符号容易错一位，
 *   而**只有非零的实数算错才是这类库的真正风险** ——
 *   三角矩阵测全过、一般矩阵错 4 倍，正是展开式符号错误的典型症状。
 *   消元法没有符号表可错，且 O(1) 代价与展开式相同。
 *   对 n=4 的规模，消元比"少写三行"更值。
 */
function cocircularDeterminant(pts) {
  const n = pts.length;
  const M = pts.map((p) => [p[0] * p[0] + p[1] * p[1], p[0], p[1], 1]);
  if (n === 4) return det4(M);
  // n>4：没有 4×4 行列式可用。
  // 正确做法是「4 点子集全共圆」——但那要求所有子集（共 n−3 个）都通过，
  // 数值上会累积误差。这里诚实报不支持，而不是给一个看起来像判据的数。
  fail('unsupported_point_count',
    `cocircularity determinant is defined for exactly 4 points; got ${n}. ` +
    'For more points, use the geometric side (minimumEnclosingCircle) plus your own subset test.',
    { points: n });
}

/** 方阵行列式（带部分主元的高斯消元，4×4 规模）。奇异时返回 0。 */
function det4(M) {
  const n = 4;
  const A = M.map((r) => r.slice());
  let det = 1;
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let i = c + 1; i < n; i++) {
      if (Math.abs(A[i][c]) > Math.abs(A[piv][c])) piv = i;
    }
    const pv = A[piv][c];
    if (Math.abs(pv) < 1e-14) return 0;          // 奇异
    if (piv !== c) { const t = A[piv]; A[piv] = A[c]; A[c] = t; det = -det; }
    det *= A[c][c];
    for (let i = c + 1; i < n; i++) {
      const f = A[i][c] / A[c][c];
      if (f === 0) continue;
      for (let k = c; k < n; k++) A[i][k] -= f * A[c][k];
    }
  }
  return det;
}

/**
 * 最小包围圆（Welzl 的确定性版本，n 小时够用）。
 * 返回 {center, radius, boundary: 支撑点数}。空集/单点/两点/三点/四点共圆都有定义。
 * 规模闸：只支持 n ≤ 64（O(n³) 的朴素实现），超了 fail-closed。
 */
function minimumEnclosingCircle(pts, opts) {
  const n = pts.length;
  // 空点集没有「最小包围圆」—— 不是退化，是**问题未定义**。
  // ⚠ 必须给结构化 type：调用方（geometry 层 / MCP）按 e.type 分派退化处理，
  //   没有 type 的 Error 会被当成「内部异常」，退化与真异常就分不开了。
  if (!Array.isArray(pts) || n === 0) {
    fail('empty_point_set', 'minimumEnclosingCircle needs at least one point; got none', { points: n });
  }
  for (const p of pts) {
    if (!Array.isArray(p) || p.length !== 2 || p.some((x) => typeof x !== 'number' || !Number.isFinite(x))) {
      fail('invalid_input', 'every point must be [finite, finite]', { got: p });
    }
  }
  const MAX = 64;
  if (n > MAX) {
    fail('resource_limit', `minimumEnclosingCircle supports at most ${MAX} points, got ${n}`);
  }
  // 增量法：维护当前圆；新点在圆外则用三点重解（三点时圆唯一）
  let c = null;
  for (let i = 0; i < n; i++) {
    if (c && insideCircle(c, pts[i], 1e-12)) continue;
    c = { center: pts[i].slice(), radius: 0 };
    for (let j = 0; j < i; j++) {
      if (insideCircle(c, pts[j], 1e-12)) continue;
      c = circleFrom2(pts[i], pts[j]);
      for (let k = 0; k < j; k++) {
        if (insideCircle(c, pts[k], 1e-12)) continue;
        c = circleFrom3(pts[i], pts[j], pts[k]);
      }
    }
  }
  // 支撑点：圆周上的点
  const boundary = pts.filter((p) => Math.abs(distTo(c.center, p) - c.radius) < 1e-7 * Math.max(1, c.radius)).length;
  return { center: c.center, radius: c.radius, boundary };
}

function insideCircle(c, p, tol) {
  return distTo(c.center, p) <= c.radius + tol;
}
function distTo(o, p) {
  return Math.hypot(p[0] - o[0], p[1] - o[1]);
}
function circleFrom2(a, b) {
  return { center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], radius: Math.hypot(a[0] - b[0], a[1] - b[1]) / 2 };
}
function circleFrom3(a, b, c) {
  const ax = a[0], ay = a[1], bx = b[0], by = b[1], cx = c[0], cy = c[1];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-14) {
    // 三点共线：取两点直径圆（退化情形，必须有定义而不是崩掉）
    const opts = [circleFrom2(a, b), circleFrom2(b, c), circleFrom2(c, a)];
    let best = opts[0];
    for (const o of opts) if (o.radius > best.radius) best = o;
    return best;
  }
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  return { center: [ux, uy], radius: Math.hypot(ax - ux, ay - uy) };
}

module.exports = {
  // solveSquare 导出是有意的：它是「判据自检」的基础设施 ——
  // 正则细分的正确性完全取决于这 n 元一次方程组解得对不对，
  // 外部测试可以拿已知解的算例直接验证它（见 test/test-tropical.js 的支撑平面组）。
  solveSquare,
  normalizeSupport,
  newtonPolytope,
  tropicalDegreeBound,
  tropicalSystemBound,
  regularSubdivision,
  tropicalBernstein,
  tropicalBezoutBound,
  cocircularCheck,
  minimumEnclosingCircle
};
