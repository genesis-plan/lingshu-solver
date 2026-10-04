/**
 * 几何域共享层 —— op 分派、参数校验、Agent 决策块。
 *
 * 与 services/solver-service.js 同一个思路：stdio 端与 HTTP 端共用一份实现，
 * 任何结果整形口径只在本文件改一次。
 *
 * ── 为什么是「一个工具 + op 分派」，而不是 70 个独立 MCP 工具 ────────────
 *   MCP 的 tools/list 结果**每轮对话都在上下文里**。70 个工具 × 每个约 200 字符
 *   的 description + schema ≈ 14000 字符 ≈ 4000 token/轮，纯固定开销。
 *   一个 geometry 工具 + op 字段：固定开销降到约 800 字符。
 *
 *   代价是 Agent 一开始不知道每个 op 的参数签名。应对写在下面的 catalog 机制里：
 *   op 名清单常驻（便宜），完整签名**按需**在报错时返回（一次性）。
 *   这是把「每轮都付」换成「第一次错才付」。
 *
 * ── 三条硬口径 ──────────────────────────────────────────────────────────
 *   1. 维度混用直接报 undecidable，绝不静默补零（见 vec.js 原则 1）。
 *   2. 退化与「算出来是空」必须分开：
 *        degenerate（平行/共线/重合）⇒ 问题本身无通常答案，禁止下结论；
 *        definitely_none（算出来确实没有交点）⇒ 这是答案，可以断言「没有」。
 *      这两类混在一起是 3D 几何最常见的幻觉源。
 *   3. 所有返回体确定性：数值走 detF（12 位定点），同输入字节级可复现。
 */
'use strict';

const g1 = require('./geom1.js');
const g2 = require('./geom2.js');
const g3 = require('./geom3.js');
const gc = require('./common.js');
const gt = require('./geom_theorems.js');
// 热带几何 / 凸几何桥：把代数系统的 Newton 多面体读成凸几何对象。
// 必须是惰性 require —— tropical.js 顶层会 require solver-service.js，
// 而 solver-service.js 又可能反过来引用几何层，直接 require 会形成环。
let TROP = null;
function trop() { if (!TROP) TROP = require('../tropical.js'); return TROP; }

// ── 合并全部 op，并做重名硬闸 ──────────────────────────────
// 重名会静默覆盖（后加载的赢），这是「加了新 op 却没生效」最难查的一类 bug。
// ⚠ layer 一律**由 dim 推导**，不给单个文件自己写 layer 的余地 ——
//   写错 layer 的后果是 op 出现在错误的清单里（例如把 2D 定理列进 3D 段），
//   而 tools/parity 全绿，属于最难自己发现的一类漂移。
//   dim===0 有两种含义，必须靠 scalar 区分：
//     common.js 的任意维 op（dim:0，靠点推断维度）
//     纯标量 op（dim:0 + scalar:true，只吃 number，没有点可推断）
const ALL = Object.create(null);
const DUP = [];
for (const mod of [g1, g2, g3, gc, gt]) {
  for (const [name, spec] of Object.entries(mod.OPS)) {
    if (Object.prototype.hasOwnProperty.call(ALL, name)) DUP.push(name);
    const layer = spec.scalar ? 'any' : (spec.dim === 0 ? 'any' : (spec.dim + 'D'));
    ALL[name] = Object.assign({ layer }, spec);
  }
}
if (DUP.length) {
  throw new Error('几何 op 重名（会静默覆盖，必须修）: ' + DUP.join(', '));
}

/**
 * 「算出来确实没有」的退化码 —— 这些是**确定答案**，Agent 可以断言「无解」。
 * 与下面 DEGENERATE 的区别是本类问题问得合法，答案就是空集。
 */
const DEFINITE_NONE = new Set([
  'no_intersection', 'separate', 'contained', 'disjoint', 'disconnected',
  'parallel_no_intersection',
  // ── 定理层新增（geom_theorems.js）──────────────────────────────────
  // 这一类是「输入完全合法，但数学上证明这样的对象不存在」：
  //   no_such_triangle     —— 算下来没有这个三角形（真·无解，可以断言）
  //   no_such_cevian       —— Stewart 解出 d²<0，即这条 cevian 不存在
  //   no_radical_axis      —— 两圆同心不等径 ⇒ 幂相等无处可求
  'no_such_triangle', 'no_such_cevian', 'no_radical_axis'
]);

/** 病态退化 —— 输入本身使问题无唯一解，禁止下任何几何结论 */
const DEGENERATE = new Set([
  'parallel', 'collinear', 'coplanar', 'coincident', 'coincident_points',
  'degenerate_segment', 'degenerate_line', 'degenerate_ray', 'degenerate_triangle',
  'collinear_overlap', 'collinear_vertices', 'line_in_plane', 'zero_vector',
  'zero_axis', 'zero_area', 'zero_direction', 'conjugate_at_infinity',
  'unsupported_dimension', 'numerically_degenerate', 'touch', 'need_3_points',
  'too_few_points',
  // ── 定理层新增（geom_theorems.js）──────────────────────────────────
  // 全部是「输入越界 / 前提被破坏 / 问法不良」，不是「算出来没有」。
  'point_not_on_side',       // 塞瓦/梅涅劳的分割点不在对应边上 ⇒ 比值无意义
  'point_at_vertex',         // 分割点落在顶点 ⇒ 比值 0 或无穷
  'zero_length_side', 'zero_radius', 'negative_radius',
  'negative_length_side', // 长度参数为负（与 zero_length_side 分开：修法不同）
  'split_out_of_range',      // Stewart 的 m 不在 [0,a]
  'angle_out_of_range', 'angles_exceed_pi',
  'non_positive_input', 'need_exactly_three_given', 'need_two_sides',
  'scale_undetermined',    // 只给 AAA ⇒ 相似而不全等，边长未定（数量其实给够了）
  'identical_circles',       // 两圆完全相同 ⇒ 根轴是整个平面，问题不良
  'pole_at_center',          // P=O ⇒ 极线在无穷远
  'miquel_precondition_violated',  // 莫莱三圆不相交 ⇒ D/E/F 前提被破坏
  'degenerate_quadrilateral', 'degenerate_face', 'degenerate_edge', 'pole_at_infinity',
  'non_integer_coordinate',  // 皮克定理要求格点
  'non_integer_n', 'n_too_small', 'n_too_large'
]);

function err(type, message, extra) {
  const e = new Error(message);
  e.type = type;
  Object.assign(e, extra || {});
  return e;
}

// ── 参数校验 ────────────────────────────────────────────────

function checkNum(v, name) {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw err('invalid_input', `${name} must be a finite number, got ${JSON.stringify(v)}`);
  }
  return v;
}

function checkPoint(v, name, dim) {
  if (!Array.isArray(v) || v.length === 0) {
    throw err('invalid_input', `${name} must be a non-empty coordinate array, e.g. [1,2] or [1,2,3]`);
  }
  for (const x of v) {
    if (typeof x !== 'number' || !isFinite(x)) {
      throw err('invalid_input', `${name}: every coordinate must be a finite number, got ${JSON.stringify(v)}`);
    }
  }
  if (dim > 0 && v.length !== dim) {
    throw err('invalid_input', `${name} must be ${dim}D for this op, got ${v.length}D: ${JSON.stringify(v)}`);
  }
  return v;
}

function checkPoints(v, name, dim, min) {
  if (!Array.isArray(v)) throw err('invalid_input', `${name} must be an array of points`);
  if (!v.length) throw err('invalid_input', `${name} must contain at least one point`);
  if (typeof min === 'number' && v.length < min) {
    throw err('invalid_input', `${name} needs at least ${min} point(s), got ${v.length}`);
  }
  const out = v.map((p, i) => checkPoint(p, `${name}[${i}]`, dim));
  // 组内维度一致（跨维度的错由 op.dim 或 inferDim 兜住，这里是第二道闸）
  for (const p of out) if (p.length !== out[0].length) {
    throw err('invalid_input', `${name}: mixed dimensions (${out[0].length}D and ${p.length}D)`);
  }
  return out;
}

function checkTriangles(v, name, dim) {
  if (!Array.isArray(v) || !v.length) throw err('invalid_input', `${name} must be a non-empty array of [p1,p2,p3]`);
  return v.map((t, i) => {
    if (!Array.isArray(t) || t.length !== 3) {
      throw err('invalid_input', `${name}[${i}] must be exactly 3 points, got ${Array.isArray(t) ? t.length : typeof t}`);
    }
    return t.map((p, k) => checkPoint(p, `${name}[${i}][${k}]`, dim));
  });
}

function coerce(raw, name, type, dim, min) {
  switch (type) {
    case 'point': return checkPoint(raw, name, dim);
    case 'points': return checkPoints(raw, name, dim, min || 1);
    case 'triangles': return checkTriangles(raw, name, dim);
    case 'number': return checkNum(raw, name);
    // ── 热带层专用类型（见 TROPICAL_OPS 的注释）──────────────────────
    // 之所以给它们独立的类型名而不是复用 points：指数向量是**整数**，
    // 坐标是**浮点**。混用会让 −0 与 0 在支撑集去重时行为诡异。
    case 'terms': return coerceTerms(raw);
    case 'termLists': return coerceTermLists(raw);
    case 'numbers': return coerceNumbers(raw);
    // 变量名是**字符串**，绝不能复用 numbers：numbers 只接受有限数，
    // 而 'x' 传进去会被 coerceNumbers 拒掉。两者混用会得到
    // 「变量名必须有限数」这种完全指错方向的报错。
    case 'strings': return coerceStrings(raw);
    case 'boolean':
      if (typeof raw !== 'boolean') throw err('invalid_input', `${name} must be true or false`);
      return raw;
    default: throw err('internal_error', `unknown arg type ${type}`);
  }
}

// ── Agent 决策块（几何版）────────────────────────────────────
/**
 * 与 solver-service.js 的 buildTrust 同一套设计哲学：
 * trustLevel 是**行动指令**不是形容词；mustNotClaim 用**正向枚举**而不是自然语言，
 * 这样新增 trustLevel 时默认落在「禁止断言」，要放开必须显式改这里，漏不掉。
 */
function buildTrust(res) {
  const deg = res.degenerate || null;

  if (deg && DEFINITE_NONE.has(deg)) {
    return {
      trustLevel: 'definitely_none',
      safeToUse: true,
      agentAction: `Computed, not guessed: there is NO ${deg === 'disjoint' || deg === 'disconnected'
        ? 'overlap' : 'intersection'}. Safe to state that as a conclusion.`,
      mustNotClaim: null
    };
  }

  if (deg && DEGENERATE.has(deg)) {
    return {
      trustLevel: 'degenerate',
      safeToUse: false,
      agentAction: `Input is degenerate (${deg}): the question has no ordinary unique answer here. `
        + 'Do NOT invent a value. Rephrase the problem with non-degenerate input, or report the degeneracy itself.',
      mustNotClaim: 'unique_answer'
    };
  }

  if (deg) {
    // 未在两张表里登记的退化码 —— fail-closed：按病态处理，不按「算出来了」处理。
    // 宁可让 Agent 少说一句，也不能让它拿着未分类的退化去下结论。
    return {
      trustLevel: 'degenerate',
      safeToUse: false,
      agentAction: `Unclassified degenerate case (${deg}). Treated as unsafe; do not report a value.`,
      mustNotClaim: 'unique_answer'
    };
  }

  return {
    trustLevel: 'exact',
    safeToUse: true,
    agentAction: 'Closed-form result, exact up to floating-point rounding. Safe to use directly.',
    mustNotClaim: null
  };
}

// ── 目录（按需返回，不常驻上下文）───────────────────────────

function buildCatalog() {
  const out = {};
  for (const [name, spec] of Object.entries(ALL)) {
    const req = [], opt = [];
    for (const [k, t] of Object.entries(spec.args)) {
      (t.endsWith('?') ? opt : req).push(`${k}:${t}`);
    }
    out[name] = { dim: spec.scalar ? 'scalar' : (spec.dim === 0 ? 'any' : spec.dim), args: req, optional: opt, brief: spec.brief };
  }
  return out;
}

/** op 清单（常驻工具描述，紧凑：只给名字，不给签名） */
function opList() {
  const by = { '1D': [], '2D': [], '3D': [], any: [] };
  for (const [name, spec] of Object.entries(ALL)) by[spec.layer].push(name);
  return by;
}

// ── 热带几何 / 凸几何桥（services/tropical.js）───────────────────────────
// 为什么要挂在 geometry 工具下面而不是新开一个工具：
//   MCP 的 tools/list 每轮都在上下文里。**每个工具都要每轮付费**，
//   而 op 名清单只是几个 token。新开一个 tropical 工具会多付一整份
//   description + schema（约 800~4000 字符/轮），换来的只是 op 名。
//   挂进 geometry 之后，桥接能力对 Agent 立刻可见，成本几乎为零。
//
// ⚠ 这一层与几何层的**诚实口径差异**（必须在返回体里说清，不能混）：
//   geometry 层给的是**具体几何量**（一个圆心、一个半径）；
//   tropical 层给的是**上界与结构**（混合体积、格点体积、重数）——
//   「上界」绝不能当「答案」用，trust.trustLevel 也因此不同。

/**
 * 热带层 op 表。dim 字段填 0 且 scalar:true ⇒ 走标量通道（不吃点）。
 * 每个 op 的 run 都自己 fail-closed，抛出的 e.type 直接透传给 Agent。
 */
const TROPICAL_OPS = {
  newton_polytope: {
    dim: 0, scalar: true,
    brief: 'Newton polytope of a sparse polynomial given by its support: convex hull of the exponent vectors. Returns the vertices, the normalized (lattice) volume, and whether the support is full-dimensional (not full-dimensional => solutions at infinity, so BKK does not apply as a root count).',
    args: { terms: 'terms' },
    run: ({ terms }) => ({ value: trop().newtonPolytope(terms) })
  },
  tropical_degree_bound: {
    dim: 0, scalar: true,
    brief: 'Tropical-degree UPPER BOUND from the l1-diameter of the support: Tdeg(H) <= max||alpha-beta||_1, and <= |M|-1 (arXiv:2605.24966 Thm 1.3). Useful on sparse systems where the Bezout bound is far looser. This is a BOUND, not the degree.',
    args: { terms: 'terms', dim: 'number?' },
    run: ({ terms, dim }) => ({ value: trop().tropicalDegreeBound(terms, dim) })
  },
  tropical_system_bound: {
    dim: 0, scalar: true,
    brief: 'For an n-equations-in-n-variables system: compare the Bezout bound (product of total degrees) with the sparsity bound (product of l1-diameters) and report the smaller, with the gain factor. BKK (the mixed-volume bound) is tighter still and lives in the solve tool\'s trust.completeness.',
    args: { termLists: 'termLists', dim: 'number?' },
    run: ({ termLists, dim }) => ({ value: trop().tropicalSystemBound(termLists, dim) })
  },
  regular_subdivision: {
    dim: 0, scalar: true,
    brief: 'Regular subdivision of the Newton polytope induced by lifting weights (default: coefficient magnitudes). Cell lattice volumes are the local tropical multiplicities. Reports a coverage invariant: the sum of cell volumes MUST equal the Newton polytope volume, and if it does not the subdivision contains a non-simplicial cell and no multiplicities are reported.',
    args: { terms: 'terms', dim: 'number?', weights: 'numbers?' },
    run: ({ terms, dim, weights }) => ({
      value: trop().regularSubdivision(terms, dim, weights ? { weights } : undefined)
    })
  },
  bernstein_bound: {
    dim: 0, scalar: true,
    brief: 'Bernstein-Kushnirenko-Khovanskii bound via the mixed volume of the Newton polytopes: the number of isolated solutions in (C*)^n with multiplicity is <= this, and EQUALS it for generic coefficients. Requires n equations in n variables; redundant systems are redirected to the Bezout-type upper bound.',
    args: { termLists: 'termLists', dim: 'number?' },
    run: ({ termLists, dim }) => ({ value: trop().tropicalBernstein(termLists, dim) })
  },
  tropical_bezout_bound: {
    dim: 0, scalar: true,
    brief: 'Tropical Bezout-type UPPER BOUND when the system is redundant (k equations, rank r < k): pick the r essential equations with the smallest mixed volume (arXiv:2605.24966 Thm 7.2). UPPER BOUND ONLY — local stable intersection multiplicities are not computed.',
    args: { termLists: 'termLists', dim: 'number?', rank: 'number?' },
    run: ({ termLists, dim, rank }) => ({
      value: trop().tropicalBezoutBound(termLists, dim, rank ? { rank } : undefined)
    })
  },
  cocircular_check: {
    dim: 2,
    brief: 'Concyclicity of 4 planar points, decided TWICE by independent methods: the exact 4x4 determinant, and the radial spread of the minimum enclosing circle. The agreement flag is the regression guard. Collinear points are reported separately (their circle has infinite radius).',
    args: { pts: 'points' },
    minPoints: 4,
    run: ({ pts }) => ({ value: trop().cocircularCheck(pts) })
  },
  minimum_enclosing_circle: {
    dim: 2,
    brief: 'Minimum enclosing circle of up to 64 planar points (Welzl incremental). Returns the center, the radius, and how many points lie on the boundary.',
    args: { pts: 'points' },
    run: ({ pts }) => ({ value: trop().minimumEnclosingCircle(pts) })
  }
};

// ── 几何 ⇄ 代数 桥（第二条接缝，见 services/geometry_bridge.js 头注）──
//
// 方向与 TROPICAL_OPS 相反：TROPICAL 是「代数系统的几何上界 → 显形」，
// 这里是「几何对象 → **多变量方程组** → 回流 solve」。核心价值不是多一个功能，
// 而是**双路交叉验证**：同一几何量用闭式公式与 Krawczyk 区间认证各算一次，
// 两条独立路一致时结论的可信度远高于任一条单独给出。
//
// 同样挂进 geometry 工具而不是新开工具：tools/list 每轮都在上下文里，
// 新开一个工具是每轮固定成本，挂在已有工具下几乎为零。
let BRIDGE = null;
function bridge() { if (!BRIDGE) BRIDGE = require('../geometry_bridge.js'); return BRIDGE; }

const BRIDGE_OPS = {
  circumcircle: {
    dim: 2,
    brief: 'Circumcircle of 3 planar points, computed TWICE by independent methods: (1) closed form via Cramer on the perpendicular bisectors, (2) the equivalent 2x2 LINEAR system handed to the Krawczyk-certified solver, which returns tier=proven. The agreement flag is the cross-validation result (maxAbsDiff). Collinear points admit no circumcircle: that is reported as a degeneracy and NO equations are exported, because exporting an unsatisfiable system would blur "no such circle exists" with "the system had no solution". Also returns circleEquation: the circle as a 2-variable quadratic you can pass straight to solve.',
    args: { pts: 'points' },
    minPoints: 3,
    run: ({ pts }) => {
      const r = bridge().circumcircle(pts.slice(0, 3));
      if (r.degenerate) return { value: r, degenerate: r.degenerate };
      return { value: r };
    }
  },
  sphere_equation: {
    dim: 0, scalar: true,
    brief: 'Export a sphere (center + squared radius) or a general multivariate quadratic as a polynomial equation STRING that the solve tool accepts. This is the geometry-to-algebra bridge in its purest form: it defines no solution method, it only translates. Exponents must be non-negative integers; negative exponents (Laurent terms) are rejected rather than silently rounded.',
    args: { center: 'point', radiusSquared: 'number', variables: 'strings?' },
    run: ({ center, radiusSquared, variables }) => ({
      value: {
        dim: center.length,
        radiusSquared,
        equations: bridge().sphereEquations(center, radiusSquared,
          (variables && variables.length === center.length) ? variables.map(String)
            : center.map((_, i) => 'x' + (i + 1))),
        note: 'Pass equations straight to solve as {equations, variables}.'
      }
    })
  },
  polynomial_equation: {
    dim: 0, scalar: true,
    brief: 'Export a multivariate sparse polynomial (terms of exponents+coeff) as an equation string for the solve tool. Supports n variables. Exponents must be non-negative integers — a negative exponent is rejected with a fix prescription (shift by a power of a variable) rather than silently rounded, because rounding x^-1 to x^1 yields a wrong answer that the solver would happily certify.',
    args: { terms: 'terms', variables: 'strings?' },
    run: ({ terms, variables }) => {
      const vs = (variables && variables.length) ? variables.map(String)
        : terms[0].exponents.map((_, i) => 'x' + (i + 1));
      return {
        value: {
          variables: vs,
          equations: bridge().polynomialEquations(terms, vs),
          note: 'Pass equations straight to solve as {equations, variables}.'
        }
      };
    }
  }
};

/**
 * 把 terms / termLists / weights 从「Agent 传来的 JSON」规整成内部结构。
 * 宽容接受两种写法（LLM 常犯的错就在这里）：
 *   exponents 形态：[{exponents:[..], coeff:c, weight:w}, ...]
 *   数组形态：     [[..],[..]]  或  [[[..],..],[[..],..]]（系统级）
 */
function coerceTerms(raw) {
  if (!Array.isArray(raw) || !raw.length) {
    throw err('invalid_input', 'terms must be a non-empty array, e.g. [{exponents:[2,0],coeff:1},{exponents:[0,0],coeff:-1}]');
  }
  return raw.map((t, i) => {
    if (Array.isArray(t)) {
      return { exponents: t.slice(), coeff: 1 };            // 数组形态：系数默认 1
    }
    if (t && typeof t === 'object' && Array.isArray(t.exponents)) {
      const o = { exponents: t.exponents.slice() };
      if (typeof t.coeff === 'number') o.coeff = t.coeff;
      if (typeof t.weight === 'number') o.weight = t.weight;
      return o;
    }
    throw err('invalid_input', `terms[${i}] must be {exponents:[int,...], coeff:number} or [int,...]`);
  });
}
function coerceTermLists(raw) {
  if (!Array.isArray(raw) || !raw.length) {
    throw err('invalid_input', 'termLists must be a non-empty array of supports, e.g. [[[2,0],[0,0]],[[1,1],[0,0]]]');
  }
  return raw.map(coerceTerms);
}
function coerceNumbers(raw) {
  if (!Array.isArray(raw)) throw err('invalid_input', 'expected an array of numbers');
  return raw.map((x) => {
    if (typeof x !== 'number' || !Number.isFinite(x)) throw err('invalid_input', 'expected finite numbers');
    return x;
  });
}

/**
 * 变量名数组。必须是**非空字符串且不重复**。
 *
 * 为什么严格到「不重复」：变量名重复（["x","x"]）会让后面的方程
 * 在解析层被理解成同一变量的二次项，于是
 *   x + y = 1  与  x + x = 1  渲染成同一句话
 * —— 又是「导出成功、结果全错、还不报错」的那一类。宁可当场拒。
 *
 * 另外挡掉含解析器元字符的名字：`x^2` / `a*b` / `x-1` 这类作为「变量名」
 * 会让导出的方程与调用方的意图脱节（名字是 `x^2` 时，求解器把它读成 x 的平方）。
 */
function coerceStrings(raw) {
  if (!Array.isArray(raw) || !raw.length) {
    throw err('invalid_input', 'expected a non-empty array of variable-name strings');
  }
  const names = raw.map((x) => {
    if (typeof x !== 'string' || !x.trim()) {
      throw err('invalid_input', 'variable names must be non-empty strings');
    }
    const name = x.trim();
    if (/[^A-Za-z0-9_]/.test(name)) {
      throw err('invalid_input',
        `variable name "${name}" contains characters the solver cannot treat as an identifier. `
        + 'Use plain letters/digits/underscore, e.g. "x", "y", "theta_1".',
        { got: name });
    }
    if (/^[0-9]/.test(name)) {
      throw err('invalid_input', `variable name "${name}" must not start with a digit`, { got: name });
    }
    return name;
  });
  // 重复名守卫：在**trim 之后**的名字上判，且必须在 return 之前。
  // ⚠⚠ 历史 bug（2026-10-04，写完当场被测试抓到）：这个检查原本写在
  //   `return raw.map(...)` 的**后面** —— 那是**死代码**，从来没执行过。
  //   而它的注释明确声称「重复名会被挡」，于是测试跑出「未被拒」时
  //   第一反应是怀疑测试、怀疑 coerce 的判空逻辑，而不是「注释在撒谎」。
  //   教训：注释里承诺的守卫，必须有一行可执行代码与之对应；
  //   写在 return 之后的检查 = 一句谎话。
  const dup = names.filter((x, i, a) => a.indexOf(x) < i);
  if (dup.length) {
    throw err('invalid_input',
      `variable names must be distinct; got duplicates: ${[...new Set(dup)].join(', ')}. `
      + 'A repeated name makes two different variables render as the same one, so the '
      + 'exported equation silently means something else than you asked for.',
      { duplicates: [...new Set(dup)] });
  }
  return names;
}

for (const [name, spec] of Object.entries(TROPICAL_OPS)) {
  if (Object.prototype.hasOwnProperty.call(ALL, name)) {
    throw new Error('几何 op 重名（会静默覆盖，必须修）: ' + name);
  }
  ALL[name] = Object.assign({ layer: spec.dim === 2 ? '2D' : 'any' }, spec);
}

// 几何 ⇄ 代数桥的 op。与上面一样走重名硬闸。
for (const [name, spec] of Object.entries(BRIDGE_OPS)) {
  if (Object.prototype.hasOwnProperty.call(ALL, name)) {
    throw new Error('几何 op 重名（会静默覆盖，必须修）: ' + name);
  }
  ALL[name] = Object.assign({ layer: spec.dim === 2 ? '2D' : 'any' }, spec);
}

// ── 主入口 ──────────────────────────────────────────────────

/**
 * @param {object} args { op, ...opArgs }
 * @returns {object} { op, dim, value, degenerate, ..., trust }
 */
function doGeometry(args) {
  const a = (args && typeof args === 'object') ? args : {};
  const op = typeof a.op === 'string' ? a.op.trim() : '';

  if (!op) {
    throw err('invalid_input',
      'op is required. Pass {op:"<name>", ...args}. Call with an unknown op to receive the full catalog with signatures.',
      { opList: opList() });
  }

  const spec = ALL[op];
  if (!spec) {
    throw err('unknown_op',
      `Unknown geometry op "${op}". Full catalog below: pick one and call again.`,
      { opList: opList(), catalog: buildCatalog() });
  }

  // 任意维 op：先用已给的点推断维度，再按该维度校验其余点。
  // ⚠ 纯标量 op（scalar:true）没有点可推断，直接放行 —— 不要对它报
  //   "needs at least one point"，那是把「这个 op 不吃坐标」误当成「调用者漏传参数」。
  let dim = spec.dim;
  if (dim === 0 && !spec.scalar) {
    const probe = Object.entries(spec.args)
      .filter(([k, t]) => (t === 'point' || t === 'points') && a[k] !== undefined)
      .map(([k]) => a[k]);
    let inferred = 0;
    for (const v of probe) {
      const one = Array.isArray(v) && Array.isArray(v[0]) ? v[0] : v;
      if (Array.isArray(one) && one.length) { inferred = one.length; break; }
    }
    if (!inferred) throw err('invalid_input', `op "${op}" needs at least one point to infer the dimension`);
    dim = inferred;
  }

  const bound = {};
  for (const [k, t] of Object.entries(spec.args)) {
    const optional = t.endsWith('?');
    const base = optional ? t.slice(0, -1) : t;
    const raw = a[k];
    if (raw === undefined || raw === null) {
      if (optional) continue;
      throw err('invalid_input',
        `op "${op}" requires argument "${k}" (${base})`,
        { expectedArgs: spec.args, brief: spec.brief });
    }
    // minPoints 是每个 op 自己声明的（如凸包 >=1、多边形面积 >=3），
    // 必须传下去 —— 否则「给 2 个点求多边形面积」会静默返回 0 而不是报错。
    bound[k] = coerce(raw, k, base, dim, spec.minPoints);
  }

  let res;
  try {
    res = spec.run(bound);
  } catch (e) {
    // run 内部抛的维度错（vec.sameDim）转成结构化错误，不让堆栈漏给 Agent
    throw err((e && e.type) || 'invalid_input', (e && e.message) || String(e));
  }

  const out = { op, dim };
  for (const [k, v] of Object.entries(res || {})) {
    if (k === 'degenerate') continue;
    if (v !== undefined) out[k] = v;
  }
  out.degenerate = (res && res.degenerate) || null;
  out.trust = buildTrust(out);
  return out;
}

module.exports = {
  doGeometry,
  OPS: ALL,
  opList,
  buildCatalog,
  DEFINITE_NONE,
  DEGENERATE
};
