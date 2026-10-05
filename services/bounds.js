/**
 * 解数上界 —— 「几何 ↔ 代数」桥接的收口（任务 #82）。
 *
 * 这一层回答的是求解器最贵的一个问题：**我们找全了吗？**
 * 没有上界时，求解器只能说「我找到了 3 个解」；有了上界，它才能说
 * 「我找到了 3 个解，而定理保证最多就 3 个 —— 找全了」。
 * 这句话是整个产品从「采样器」升级成「求解器」的分界线。
 *
 * ── 五条定理，覆盖范围各不相同（混着取最小就是虚报）─────────────────
 *
 *  1. Bézout（总次数）            ∏ deg f_i
 *     覆盖：C^n（射影闭包）。计重数。对含零坐标的解也有效。
 *
 *  2. BKK（混合体积）             MV(newt f_1, …, newt f_n)
 *     覆盖：**只覆盖 (C*)^n —— 所有变量都非零的解**。
 *     ⚠ 这是最容易被误用的一条：解里只要有一个变量等于 0，它就不算在内。
 *     所以本文件单独算 zeroCoordinateRisk，一旦有风险就把 BKK 标成 partial。
 *     它的价值是**紧**：稀疏系统上比 Bézout 小几个数量级。
 *
 *  3. 多齐次 Bézout（按变量分块）  系数 [∏ z_j^{n_j}] ∏_i (Σ_j d_ij z_j)
 *     覆盖：∏ P^{n_j} ⊇ C^n。比总次数 Bézout 更紧（按各变量的次数分别算）。
 *     分块退化成「一块 = 全部变量」时它恰好等于 Bézout。
 *
 *  4. Milnor–Thom（拓扑不变量）    b_0(Z) ≤ D·(2D-1)^{n-1}
 *     覆盖：R^n 的**实**零集。用的是连通分支数这个拓扑不变量，
 *     不是解数 —— 但孤立解各自是一个连通分支，所以「孤立解个数 ≤ b_0」成立，
 *     而且**无论零集是否还有正维分支**都成立。这是「拓扑不变量 → 解数」的正桥。
 *
 *  5. Descartes / fewnomial（项数） 正根数 ≤ 系数符号变号数 ≤ 项数 - 1
 *     覆盖：R^n_{>0}（正卦限）。只需数项数，与次数**无关** ——
 *     这是唯一一条在高次稀疏系统上不会爆炸的界。
 *     Deng–Rojas–Russell (ISSAC'25, arXiv:2502.10590)：honest n 元 (n+3)-nomial
 *     的正零集**连通分支数 ≤ 3**（k=1,2 时分别为 1, 2），且是最优的。
 *     ⚠ 原文定理针对的是**单个多项式**的正零集（超曲面），不是方程组的解集。
 *       只有当 n=1 时「超曲面的连通分支」才恰好就是「正根」，
 *       所以本文件只在 nVars===1 时把它算进解数上界，其余情况只作信息给出。
 *       这是它的**真实适用范围**，不夸大。
 *
 * ── 为什么「取最小」还要带 scope ────────────────────────────────────
 *   一个 3 的正根数上界和一个 8 的 C^n 上界，谁更小？答：不可比。
 *   所以每条界都带 coversAllRealSolutions 布尔量，best 只从
 *   coversAllRealSolutions===true 的里面取最小，正根数界单独给 bestPositive。
 *
 * ── scopeKey：给 Agent 的闭集枚举（2026-10-04 加）────────────────────
 *   scope 是人类可读长句，scopeKey 是它对应的**短枚举**，只有五个取值：
 *     'C^n'     —— 全复空间（含零坐标解）
 *     '(C*)^n'  —— 环面：只含**所有变量都非零**的解（BKK / Kushnirenko）
 *     'R^n'     —— 实零集的连通分支数（Milnor–Thom，不计重数）
 *     'R'       —— 全部实根（Descartes 双侧）
 *     'R>0'     —— 只数正根 / 正卦限连通分支
 *   为什么要短：Agent 每轮都读整个返回体，字节即 token；而且闭集枚举比自由文本
 *   好解析 —— Agent 看到 '(C*)^n' 就知道「零坐标解不在这个界里」，
 *   看到长句反而要靠语义猜。scope / scopeKey 一一对应，改一个必须改另一个。
 *
 * ── ★ 本模块的界全部【域无关】（domainFree）—— 这是完备性判定的硬前提 ──────
 *
 *   🔴🔴 曾经踩过的坑（2026-10-04，实测 P0）：solver-service 的 buildCompleteness 用
 *   「搜索域是否被证明覆盖」门控 `found == bound ⇒ complete`。实测 `x^2=2` 域给 [-2,2]
 *   （**两个真解都在盒里，数学上确实完备**）却报 status=unknown + domainUnproven。
 *
 *   为什么那个门控在数学上站不住：本模块的 solutionBounds(equations, vars) **压根不接域参数** ——
 *   Bézout ∏d_i、BKK 混合体积、多齐次 Bézout、Milnor–Thom、Descartes 全都是
 *   **对整个 C^n / R^n 的全局断言**。「找到数 == 全局上界」本身就蕴含「没有更多解」，
 *   **与搜索盒无关**：若盒外真藏着解，找到数就会超过全局上界，与 found==bound 矛盾。
 *   ⇒ 对域无关的界，「盒外还有解」不是「可能」，而是**逻辑上不可能**。
 *
 *   ⇒ 因此每条界都带 `domainFree: true`，best 汇总后由 solutionBounds 顶层再带一次。
 *     下游要用域门控时**必须**先读这个标志，不许凭「界听起来像局部的」自行判断。
 *     （若将来真的引入**域内**的界，如固定步长扫描的交点数，那条界必须 domainFree:false，
 *       且必须换成独立的键名放进 bounds —— 混在同一份 best 里取最小就是虚报。）
 */
'use strict';

const { parseSystem } = require('./polynomial.js');
const { convexHull, mixedVolume } = require('./polytope.js');
// ⚠ 这里曾经 require 了 tropicalDegreeBound，用「逐方程相乘」当解数上界 ——
//   那是个范畴错误（Tdeg 是热带超曲面的次数，不是代数解数），
//   会**低估**，进而让 completeness 谎称找全。已于 2026-10-04 移除，
//   详见下方 §2c 的完整说明。热带层仍作为**独立几何出口**存在
//   （services/tropical.js + geometry 工具的 tropical_degree_bound op），
//   但不再喂给完备性判定。
// 反向依赖也刻意避免：tropical.js 会 require solver-service.js，
//   bounds.js ← solver-service.js，若这里再 require tropical.js 就成环。

function fail(type, msg, extra) {
  const e = new Error(msg);
  e.type = type;
  Object.assign(e, extra || {});
  return e;
}

function factorial(n) { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }

/** 永久式（n ≤ 6，暴力枚举够用，720 次） */
function permanent(M) {
  const n = M.length;
  if (n === 0) return 1;
  let total = 0;
  const perm = new Array(n).fill(0).map((_, i) => i);
  const used = new Array(n).fill(false);
  function rec(i, prod) {
    if (i === n) { total += prod; return; }
    for (let j = 0; j < n; j++) {
      if (used[j]) continue;
      used[j] = true;
      rec(i + 1, prod * M[i][j]);
      used[j] = false;
    }
  }
  rec(0, 1);
  void perm;
  return total;
}

/** 组合数枚举：从 m 个里取 n 个的下标组合（m ≤ 12，n ≤ 6，上限可控） */
function combinations(m, n) {
  const out = [];
  if (n > m) return out;
  const cur = [];
  (function rec(start) {
    if (cur.length === n) { out.push(cur.slice()); return; }
    for (let i = start; i < m; i++) { cur.push(i); rec(i + 1); cur.pop(); }
  })(0);
  return out;
}

/** 系数按指数升序的符号变号数（Descartes） */
function signVariations(coefs) {
  const seq = coefs.filter((c) => c !== 0);
  let v = 0;
  for (let i = 1; i < seq.length; i++) if ((seq[i] > 0) !== (seq[i - 1] > 0)) v++;
  return v;
}

/**
 * @param equations 方程文本数组
 * @param vars      变量名有序数组（可选；不给就推断）
 */
function solutionBounds(equations, vars) {
  if (!Array.isArray(equations) || equations.length === 0) {
    throw fail('invalid_input', 'equations must be a non-empty array of strings');
  }

  let parsed;
  try {
    parsed = parseSystem(equations, vars);
  } catch (e) {
    return {
      available: false,
      reason: e.type || 'parse_failed',
      detail: e.message,
      // ⚠ 2026-10-04 修正：早退分支原来只给 available/reason/detail，
      // best 是 **undefined**（键根本不存在），而其它所有分支都给 best:null。
      // 键在不在值上是 null，会让下游写出的 JSON 少一个字段 ——
      // 对 Agent 来说「字段缺失」和「字段为 null」不是一回事，前者容易读成
      // 「这版没这个字段」，后者才是「这版没给出上界」。schema 稳定优先。
      bounds: [],
      best: null,
      bestPositive: null,
      unavailable: [],
      caveats: [],
      note: 'No solution-count bound can be derived. The solver result stands on its own (unproven completeness).'
    };
  }

  const V = parsed.variables;
  const n = V.length;
  const m = parsed.equations.length;
  const bounds = [];
  const caveats = [];

  // ── 先排除两类「根本不用算」的情形 ────────────────────────────────
  const zeroEqs = [];
  const constEqs = [];
  parsed.equations.forEach((p, i) => {
    if (p.zero) zeroEqs.push(i);
    else if (p.monomials.length === 1 && p.monomials[0].exps.every((e) => e === 0)) constEqs.push(i);
  });
  if (constEqs.length) {
    return {
      available: true,
      variables: V,
      nVars: n,
      nEqs: m,
      definitelyInconsistent: true,
      bounds: [{
        name: 'constant_equation',
        value: 0,
        scope: 'all',
        scopeKey: 'C^n',
        coversAllRealSolutions: true,
        countsMultiplicity: false,
        basis: `Equation #${constEqs[0]} reduces to a non-zero constant, so the system has NO solutions at all.`,
        optimal: true
      }],
      best: { name: 'constant_equation', value: 0, scope: 'all', scopeKey: 'C^n' },
      bestPositive: null,
      unavailable: [],
      caveats: [],
      note: 'Proven inconsistent by reduction to a nonzero constant — zero solutions, no search needed.'
    };
  }
  if (zeroEqs.length) {
    caveats.push(`Equation(s) ${zeroEqs.join(',')} reduce to 0 identically — they impose no constraint, `
      + 'so the effective system has fewer equations than stated.');
  }
  const active = parsed.equations.filter((p) => !p.zero);
  const mEff = active.length;
  if (mEff === 0) {
    return { available: false, reason: 'all_zero', detail: 'Every equation reduces to 0.', bounds: [], best: null, bestPositive: null, unavailable: [], caveats };
  }
  if (n === 0) {
    return { available: false, reason: 'no_variables', detail: 'No variables found.', bounds: [], best: null, bestPositive: null, unavailable: [], caveats };
  }
  if (mEff < n) {
    caveats.push(`Only ${mEff} independent equation(s) for ${n} variable(s): the solution set is generically `
      + 'positive-dimensional, so no finite bound on isolated solutions exists (underdetermined).');
    return {
      available: false,
      reason: 'underdetermined',
      detail: caveats[caveats.length - 1],
      variables: V, nVars: n, nEqs: mEff,
      bounds: [], best: null, bestPositive: null, unavailable: [], caveats
    };
  }

  const laurent = active.some((p) => p.laurent);
  if (laurent) caveats.push('Negative exponents present: bounds are stated on (C*)^n / the domain where the '
    + 'expressions are defined; solutions with a zero coordinate in a denominator are outside scope.');

  // ── 零坐标风险：某方程在某变量上所有项的次数都 > 0 ⇒ 该方程在该超平面上恒为零 ──
  let zeroCoordinateRisk = false;
  const riskyPairs = [];
  active.forEach((p, i) => {
    const mins = parsed.minDegrees[parsed.equations.indexOf(p)];
    mins.forEach((mn, j) => {
      if (mn !== null && mn > 0) { zeroCoordinateRisk = true; riskyPairs.push(`eq#${i} vanishes on ${V[j]}=0`); }
    });
  });
  if (zeroCoordinateRisk) {
    caveats.push('Some equation vanishes identically on a coordinate hyperplane '
      + `(${riskyPairs.slice(0, 3).join('; ')}). Solutions sitting on such a hyperplane are NOT counted `
      + 'by the torus-scoped BKK bound.');
  }

  // 超定系统：解集 ⊆ 任一方子系统的解集 ⇒ 取所有 n 元子集里最小的界
  const subsets = mEff === n ? [[...Array(n).keys()]] : combinations(mEff, n);
  if (subsets.length > 500) {
    return { available: false, reason: 'resource_limit', detail: `too many equation subsets (${subsets.length})`, bounds: [], best: null, bestPositive: null, unavailable: [], caveats };
  }

  const unavailable = [];

  // ── 0. 全线性方阵短路：Bézout = 1 已是**可证的最紧界** ──────────────
  //
  // 🔴 2026-10-05 P0-H（实测 2000 题真实调用压测发现）：
  //   随机系数线性方阵的 HTTP 全链路 **233ms**，而内核求解只要 **2ms**。
  //   逐段插桩定位：97% 的时间花在 `solutionBounds` 的 BKK 段（303ms/次）。
  //
  // 数学上这段计算**必然是浪费**：
  //   若每个方程的每个单项式总次数都 ≤ 1，则 deg f_i = 1 ⇒
  //   Bézout = ∏ 1 = 1。而**非空解集至少含 1 个解** ⇒ 上界 1 已取到下界，
  //   任何别的界都不可能更小。
  //   BKK / Kushnirenko / 多齐次 Bézout 三条全是**收紧** Bézout 的工具，
  //   对线性系统一条都收紧不了 ⇒ 纯耗时，零信息增益。
  //
  // 为什么这条短路比「加缓存」更根本：
  //   缓存只能对重复题生效，而线性方阵是**一次性**的（系数每次都不同）。
  //   要砍掉这 200ms，必须承认「这个规模档根本不需要紧界」。
  //
  // ⚠ 只在 `bezout === 1` 时短路，不是一见线性就跳：
  //   欠定/超定的线性系统已在上面被 underdetermined 拦掉；
  //   若将来出现「有效方程数 > 变量数」的线性情形，Bézout 仍可能是 min over
  //   subsets 的 1，但那种情形走的是另一条路，此处不覆盖。
  //
  // 🔴🔴 2026-10-05 P0-I（**这条短路自己引入的回归，verify 当场抓住**）：
  //   必须**排除 Laurent（负指数）系统**。
  //   反例（test-bounds §4 的护栏算例）：x^-1 + y - 1 = 0 , x + y^-1 - 1 = 0
  //   两式各自最高指数都是 1 ⇒ degree ≤ 1 ⇒ 误入本短路；
  //   而 Bézout 对 Laurent 系统**不成立**（乘以 x·y 后次数变 2，Bézout=2 才是对的；
  //   直接用原始次数算出 1）。
  //   真实解：消元得 y² − y + 1 = 0 ⇒ (C*)² 里 2 个解。
  //   HEAD 上 best = bkk = 2（正确）；加了短路后 best = bezout = 1 ⇒ **上界低估**。
  //
  // 为什么这是最危险的一类缺陷：上界低估 + 找到数恰好等于上界
  //   ⇒ 判定层输出「找全了」⇒ **谎报**。比慢严重得多。
  //   也就是说：这个 P0 修得越「成功」，埋的谎报越深。
  //
  // 教训可推广：**任何「跳过计算」的短路，都必须逐条核对被跳过的工具所依赖的前提**。
  //   BKK / Kushnirenko 的前提是「多项式（非负指数）」，短路时必须显式确认这一点。
  const allLinear = active.every((p) => p.degree <= 1);
  let bezoutVal = Infinity;
  for (const S of subsets) {
    let prod = 1;
    for (const i of S) prod *= Math.max(0, active[i].degree);
    if (prod < bezoutVal) bezoutVal = prod;
  }
  if (allLinear && !laurent && bezoutVal === 1) {
    return {
      available: true,
      variables: V, nVars: n, nEqs: mEff,
      definitelyInconsistent: false,
      bounds: [{
        name: 'bezout_total_degree',
        value: 1,
        scope: 'C^n (projective closure)',
        scopeKey: 'C^n',
        coversAllRealSolutions: true,
        countsMultiplicity: true,
        laurentSafe: false,
        optimal: true,
        basis: 'Bézout: every equation is affine (total degree <= 1), so the product of degrees is 1. '
          + 'A nonempty solution set contains at least one point, hence the bound 1 is tight and no '
          + 'refinement (BKK / Kushnirenko / multihomogeneous) can improve it.',
        skippedRefinements: ['bkk_mixed_volume', 'kushnirenko', 'multihomogeneous_bezout'],
        skipReason: 'linear system: Bézout=1 is already the tight bound (refinements cannot beat it)'
      }],
      best: { name: 'bezout_total_degree', value: 1, scope: 'C^n', scopeKey: 'C^n' },
      bestPositive: { name: 'bezout_total_degree', value: 1, scope: 'C^n', scopeKey: 'C^n' },
      unavailable: [],
      caveats,
      note: 'Affine square system — Bézout gives the tight bound 1; tighter tools are skipped by design '
        + '(they provably cannot improve on 1 for a degree-1 system).'
    };
  }

  // ── 1. Bézout（总次数）────────────────────────────────────────────
  {
    let best = Infinity;
    for (const S of subsets) {
      let prod = 1;
      for (const i of S) prod *= Math.max(0, active[i].degree);
      if (prod < best) best = prod;
    }
    bounds.push({
      name: 'bezout_total_degree',
      value: best,
      scope: 'C^n (projective closure)',
      scopeKey: 'C^n',
      coversAllRealSolutions: true,
      countsMultiplicity: true,
      laurentSafe: false,
      basis: `Bézout: #isolated solutions in C^n counted with multiplicity <= product of total degrees `
        + `(${subsets.length > 1 ? 'min over all ' + subsets.length + ' square subsystems' : 'product'}).`
    });
  }

  // ── 2. BKK（混合体积）─────────────────────────────────────────────
  let bkkVal = null;
  {
    let best = Infinity;
    let ok = false;
    let skipReason = null;
    // 🔴🔴 2026-10-05 P0-G：共享工作量预算（此前完全缺失 ⇒ 预算被放大 2^n 倍）
    //
    // polytope.js 的注释白纸黑字写着：
    //   「预算必须**跨 2^n 个子集包共享**：单独看每个包都不超闸，合起来照样能把
    //     一次调用拖到几十秒（实测稀疏 6 变量：64 个包，打穿 120s 超时）」
    //   「const work = (opts && opts.work) || { used: 0, max: MV_WORK_BASE / n }」
    // 而 `mixedVolume` 的缺省 work 是**每次调用新建**的。
    // 本循环对 subsets（2^n 个方阵子集）逐个调 `mixedVolume(polys)` 且**不传 opts.work**
    // ⇒ 每个子集包都拿到一份满额 `MV_WORK_BASE / n` 预算
    // ⇒ 实际总预算是设计值的 **2^n 倍**，共享闸形同虚设。
    //
    // 实测代价（2000 题真实调用压测，random 方阵线性）：
    //   n=3 → 113ms   n=4 → 31ms   n=5 → **224ms**   n=6 → 5.6ms
    // 而内核求解本身只要 1~2ms，5 元线性题的 HTTP 全链路却是 **233ms**
    // ⇒ 端到端里 96% 的时间花在算一条**根本用不上的 BKK 界**上
    // （线性系统的 BKK 值恒为 1，而 Bézout 已经给了 1，取 min 毫无变化）。
    //
    // 为什么这不只是「慢」：
    //   解数上界是 fail-closed 的核心输入（「找到数 == 上界 ⇒ 找全了」）。
    //   一条界的**可得性**若取决于机器快慢，就会出现
    //   「快机器给 BKK、慢机器不给 BKK」⇒ 同题不同结论 ⇒ 结论不可复现。
    //   时间预算必须与规模预算一样，是**确定性**的资源闸。
    //
    // 修法：与 polytope.js 的设计口径完全一致 —— 建**一个** work 对象，
    // 跨全部 subsets 循环共享；超预算即 break（后续包必然也超），
    // 且走既有的 `skipReason` 分支把 BKK 标为 unavailable（不假装算出来了）。
    const work = { used: 0, max: Math.round(2e6 / Math.max(1, active.length)) };
    for (const S of subsets) {
      const polys = S.map((i) => active[i].monomials.map((mo) => mo.exps.slice()));
      try {
        const r = mixedVolume(polys, { work });
        if (r.mixedVolume < best) best = r.mixedVolume;
        ok = true;
      } catch (e) {
        // 规模闸 / 输入不支持：这条界**不给出**，但绝不假装算出来了。
        // 把原因带出去，让上层 trust 块能明说「BKK 未给出」，而不是静默少一条。
        if (!skipReason) skipReason = (e && e.type) || 'unknown';
        // 共享预算耗尽 ⇒ 剩下的包只会再撞同一道墙，直接收手。
        // （不回 break 的话，n=6 的 64 个包会把同一条墙再撞 63 次，
        //   每次都重新走一遍输入校验与预检 —— 纯浪费。）
        if ((e && e.type) === 'resource_limit') break;
      }
    }
    if (ok) {
      bkkVal = best;
      bounds.push({
        name: 'bkk_mixed_volume',
        value: best,
        scope: '(C*)^n — all variables non-zero',
        scopeKey: '(C*)^n',
        coversAllRealSolutions: !zeroCoordinateRisk,
        countsMultiplicity: true,
        laurentSafe: true,
        partialCoverage: skipReason ? `some square subsystems skipped (${skipReason}); value is a min over the rest` : null,
        basis: 'Bernstein–Kushnirenko–Khovanskii: #isolated solutions in (C*)^n counted with multiplicity '
          + '<= mixed volume of the Newton polytopes. Tight (equality for generic coefficients).',
        partialBecause: zeroCoordinateRisk ? 'solutions with a zero coordinate are outside (C*)^n' : null
      });
    } else if (skipReason) {
      unavailable.push({
        name: 'bkk_mixed_volume',
        reason: skipReason,
        basis: 'BKK needs the mixed volume of the Newton polytopes; the computation hit its '
          + 'size budget for this system. Bézout / Milnor–Thom / fewnomial bounds still apply.'
      });
    }
  }

  // ── 2b. Kushnirenko（未混合特例，同时充当 BKK 的一致性交叉校验）──────
  if (bkkVal !== null && n >= 1 && mEff === n) {
    const sup = active.map((p) => p.monomials.map((mo) => mo.exps.slice()));
    const same = sup.every((s) => JSON.stringify(s.slice().sort()) === JSON.stringify(sup[0].slice().sort()));
    if (same) {
      const h = convexHull(sup[0], n);
      const kush = h.normalizedVolume;   // n! · vol(conv S)
      bounds.push({
        name: 'kushnirenko',
        value: kush,
        scope: '(C*)^n — all variables non-zero',
        scopeKey: '(C*)^n',
        coversAllRealSolutions: !zeroCoordinateRisk,
        countsMultiplicity: true,
        laurentSafe: true,
        basis: 'Kushnirenko: for a system with a common support S, #isolated solutions in (C*)^n <= n!·vol(conv S). '
          + 'Must agree with bkk_mixed_volume here (same-support case) — disagreement would be a bug.',
        agreesWithBKK: kush === bkkVal
      });
    }
  }
  // ── 2c. 热带 ℓ¹-直径界：**已移除，不作为解数上界** ──────────────
  //
  // ⚠⚠⚠ 这里曾经有一个真实且危险的 bug，务必读完再改（2026-10-04）。
  //
  // 当时的写法：Thm 1.3（arXiv:2605.24966）说单个 Laurent 多项式的
  // **热带次数**满足 Tdeg ≤ diam₁(M)，特别地 Tdeg ≤ |M|−1；
  // 于是「逐方程取该界再相乘」当作 (C*)^n 里解数的上界。
  //
  // 那是一个**范畴错误**：Tdeg 约束的是热带超曲面 H 的次数，
  // 而 H 是「系数被 tropicalize 之后」的几何对象 —— 它的次数与
  // **代数解的个数**之间没有「逐条相乘」这种关系。
  //
  // 实测反例（test-bounds.js 有回归断言）：
  //   x² − 2 = 0,  y² − 3 = 0  ⇒ 4 个实解。
  //   每条方程的支撑是 {0, 2}，|M|−1 = 1，相乘得 **1**。
  //   ⇒ 界把 4 压成 1，**低估**。
  //   同样 x²+y²=25, xy=12 有 4 个实解，界给 2。
  //
  // 为什么必须移除而不是调参：
  //   低估的上界比没有上界**更危险** —— 它会让 completeness 判成
  //   complete，于是求解器**谎称找全了**。宁可 unknown。
  //
  // 正确的位置：diam₁ 是**支撑集跨度的几何量**，作为独立信息有价值
  //   （services/tropical.js 的 tropical_degree_bound / tropical_system_bound
  //   仍在暴露它，语义是「热带次数的上界」，不是「解数的上界」）。
  //   要给解数上界，用 BKK（bkk_mixed_volume）—— 那才是正确的定理。

  // ── 3. 多齐次 Bézout（按变量分块）──────────────────────────────────
  if (!laurent) {
    let best = Infinity;
    let ok = false;
    for (const S of subsets) {
      const M = S.map((i) => {
        const row = new Array(n).fill(0);
        for (const mo of active[i].monomials) {
          for (let k = 0; k < n; k++) if (mo.exps[k] > row[k]) row[k] = mo.exps[k];
        }
        return row;
      });
      try {
        const v = permanent(M);
        if (v < best) best = v;
        ok = true;
      } catch (e) { /* ignore */ }
    }
    if (ok) {
      bounds.push({
        name: 'multihomogeneous_bezout',
        value: best,
        scope: 'product of projective spaces (⊇ C^n)',
        scopeKey: 'C^n',
        coversAllRealSolutions: true,
        countsMultiplicity: true,
        laurentSafe: false,
        basis: 'Multi-homogeneous Bézout: coefficient of z_1…z_n in ∏_i (Σ_j d_ij z_j) with one block per variable '
          + '(= permanent of the per-variable degree matrix). Can be far tighter than total-degree Bézout '
          // ⚠ 2026-10-04 修正：原写 "Never worse than total-degree Bézout" —— 假的。
          // 反例 x^2+y^2-1 = 0 , x-y = 0：分块次数矩阵 [[2,2],[1,1]]，
          // 永久式 = 2·1 + 2·1 = 4，而总次数 Bézout = 2·1 = 2。
          // 原因是它数的是 P^1×P^1 上的解，那里比 P^2 多一族「无穷远」解，
          // 分块越细，无穷远处被数进来的解越多。只有分块退化为「一块 = 全部变量」时
          // 才回到总次数 Bézout，两者**没有**一般的谁优谁劣关系，所以取 min 而不是选一个。
          + 'or worse — the two are NOT ordered in general (see code comment), which is why this module takes '
          + 'the minimum over all applicable bounds rather than trusting any single one.'
      });
    }
  }

  // ── 4. Milnor–Thom（拓扑不变量：连通分支数）─────────────────────────
  if (!laurent) {
    let D = 0;
    for (const p of active) if (p.degree > D) D = p.degree;
    if (D >= 1) {
      const mt = D * Math.pow(2 * D - 1, n - 1);
      bounds.push({
        name: 'milnor_thom_components',
        value: mt,
        scope: 'R^n — real zero set, connected components',
        scopeKey: 'R^n',
        coversAllRealSolutions: true,
        countsMultiplicity: false,
        laurentSafe: false,
        basis: `Milnor–Thom / Oleĭnik–Petrovskiĭ: for Z ⊂ R^${n} cut out by polynomials of degree <= ${D}, `
          + `Σ β_i(Z) <= D(2D-1)^{n-1} = ${mt}. Isolated real solutions are components, so they are counted. `
          + 'Holds even if Z also has positive-dimensional pieces.'
      });
    }
  }

  // ── 5. Descartes / fewnomial（只看项数，不看次数）────────────────────
  if (n === 1 && mEff === 1) {
    const p = active[0];
    if (!p.laurent && !p.zero) {
      let minE = Infinity;
      for (const mo of p.monomials) if (mo.exps[0] < minE) minE = mo.exps[0];
      const byDeg = new Map();
      for (const mo of p.monomials) byDeg.set(mo.exps[0], (byDeg.get(mo.exps[0]) || 0) + mo.coef);
      const keys = [...byDeg.keys()].sort((a, b) => a - b);
      const coefsAsc = keys.map((k) => byDeg.get(k));
      const coefsAtNegX = keys.map((k) => byDeg.get(k) * (k % 2 === 0 ? 1 : -1));
      const pos = signVariations(coefsAsc);
      const neg = signVariations(coefsAtNegX);
      const zeroIsRoot = minE > 0 ? 1 : 0;
      bounds.push({
        name: 'descartes_positive',
        value: pos,
        scope: 'R_{>0} — positive roots only',
        scopeKey: 'R>0',
        coversAllRealSolutions: false,
        countsMultiplicity: false,
        laurentSafe: false,
        basis: "Descartes' rule of signs: #positive roots <= #sign changes of the coefficient sequence "
          + `ordered by degree (${pos} here). Independent of degree — the only bound that does not blow up on sparse high-degree input.`
      });
      bounds.push({
        name: 'descartes_real',
        value: pos + neg + zeroIsRoot,
        scope: 'R — all real roots',
        scopeKey: 'R',
        coversAllRealSolutions: true,
        countsMultiplicity: true,
        laurentSafe: false,
        basis: "Descartes applied to f(x) and f(-x): #real roots <= (#positive) + (#negative) + (1 if 0 is a root) "
          + `= ${pos} + ${neg} + ${zeroIsRoot}. Counts multiplicity.`
      });
    }
  }

  // Deng–Rojas–Russell：单个 (n+k)-nomial 的正零集连通分支数
  {
    const single = (mEff === 1) ? active[0] : null;
    if (single && !single.zero) {
      const t = single.terms;
      const k = t - n;
      if (k >= 1 && k <= 3) {
        const sup = single.monomials.map((mo) => mo.exps.slice());
        let honest = false;
        try {
          const h = convexHull(sup, n);
          honest = (h.rank === n);   // 支撑集不在任何仿射超平面里
        } catch (e) { honest = false; }
        if (honest) {
          const val = k;   // k=1,2,3 ⇒ 1,2,3
          bounds.push({
            name: 'fewnomial_deng_rojas_russell',
            value: val,
            scope: 'R^n_{>0} — connected components of the positive zero set',
            scopeKey: 'R>0',
            // 只有当 n=1 时「超曲面的连通分支」才恰好就是「正根」
            coversAllRealSolutions: false,
            appliesToSolutionCount: (n === 1),
            countsMultiplicity: false,
            basis: `Deng–Rojas–Russell (ISSAC 2025, arXiv:2502.10590): an honest n-variate (n+k)-nomial has at most `
              + `${val} connected component(s) in the positive orthant for k=${k} (optimal; k=1,2 give 1,2). `
              + (n === 1
                ? 'Here n=1, so components of the positive zero set ARE the positive roots — this is a valid root-count bound (and agrees with Descartes).'
                : 'The theorem is about a SINGLE hypersurface, not about the solution set of a system — '
                  + 'here it bounds components of one equation, NOT the number of solutions. Reported as information only.')
          });
        }
      }
    }
  }

  // ── 汇总 ──────────────────────────────────────────────────────────
  // ⚠ 真 bug 修复（2026-10-04）：Bézout 界在 **Laurent**（含负指数）系统上会**低估**，
  //   低估的上界比没有上界更危险 —— 它会让 completeness 判成 complete，
  //   于是求解器**谎称找全了**。实测反例：
  //     x^-1 + y - 1 = 0 , x + y^-1 - 1 = 0
  //   两个方程各自「最高指数」都是 1 ⇒ Bézout = 1·1 = 1；
  //   但消元得 y² - y + 1 = 0，(C*)^2 里实打实有 **2** 个解。
  //   根因：Laurent 多项式的「次数」不是最高指数。乘一个单项式清掉负指数后，
  //   f1 变成 1 + xy - x（总次数 2），正确的 Bézout 是 2·2 = 4 ≥ 2。
  //   修法放在**筛选处**而不是生成处：只要一条界标了 laurentSafe:false，
  //   遇到 Laurent 系统就一律不进 best。这样将来新增的界哪怕忘了写 if(!laurent)，
  //   也会被这道闸拦住 —— 跟 mustNotClaim 用白名单同一个道理。
  const full = bounds.filter((b) => b.coversAllRealSolutions && (!laurent || b.laurentSafe));
  let best = null;
  for (const b of full) if (!best || b.value < best.value) best = b;
  const positiveOnly = bounds.filter(
    (b) => (b.scope.indexOf('>0') >= 0 || b.scope.indexOf('positive') >= 0) && (!laurent || b.laurentSafe));
  let bestPositive = null;
  for (const b of positiveOnly) if (!bestPositive || b.value < bestPositive.value) bestPositive = b;

  return {
    available: true,
    variables: V,
    extraVariables: parsed.extraVariables,
    nVars: n,
    nEqs: mEff,
    overdetermined: mEff > n,
    zeroCoordinateRisk,
    // ★ 域无关性契约（见文件头「本模块的界全部【域无关】」段）：
    //   true ⇒ best 是对整个 C^n/R^n 的全局断言，「found==best ⇒ 找全」与搜索域无关。
    //   下游 completeness 判定**必须**读它，不要再凭「域有没有被证明」去猜。
    domainFree: true,
    bounds,
    unavailable,
    best: best
      ? { name: best.name, value: best.value, scope: best.scope, scopeKey: best.scopeKey || null, basis: best.basis }
      : null,
    bestPositive: bestPositive
      ? { name: bestPositive.name, value: bestPositive.value, scope: bestPositive.scope, scopeKey: bestPositive.scopeKey || null }
      : null,
    caveats,
    equations: active.map((p) => ({
      source: p.source, terms: p.terms, degree: p.degree, laurent: p.laurent,
      support: p.monomials.map((mo) => mo.exps)
    }))
  };
}

module.exports = { solutionBounds, permanent, signVariations, combinations, factorial };
