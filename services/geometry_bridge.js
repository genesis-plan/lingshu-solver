/**
 * 几何 ⇄ 代数 桥：把几何对象翻译成**多变量方程组**，回流 doSolve。
 *
 * ── 为什么要有这一层 ────────────────────────────────────────────────
 * 第一条接缝（completeness 的 boundsConsidered）是「代数系统的几何上界回流代数」。
 * 这一条是**反方向**：几何构造 ⇒ 方程组 ⇒ 求解器。
 *
 * 动机不是「多一个功能」，而是**双路交叉验证**：
 * 同一个几何量有两条独立算法路 ——
 *   · 几何路：闭式公式（垂直平分线交点、线性代数）
 *   · 代数路：导出的方程组交给 doSolve，用 Krawczyk 区间认证
 * 两条路的结果一致 ⇒ 结论的可信度远高于任一条路单独给出。
 * 这也是本产品「可审计、确定性」定位的落点：不是「我算出一个数」，
 * 而是「两条互相独立的路给出同一个数，且其中一条带形式化认证」。
 *
 * ── 三条硬纪律 ──────────────────────────────────────────────────────
 * 1. **导出的方程组必须是 solve 真能吃的语法**。不是「看起来像」——
 *    每个 op 都有回归测试跑通 doSolve 拿到 tier=proven。
 *    导出格式与 doSolve 的解析器漂移过一次就会静默变成「0 解」或
 *    「未声明变量」，两者都不是数学结论。
 * 2. **退化必须 fail-closed**。共线/重合点给不出外接圆，
 *    此时**不导出方程组**（而不是导出一组必然无解的方程）——
 *    「问题本身无解」与「方程组解不出来」是两件事（口径见 geometry/index.js 硬口径 2）。
 * 3. **不得在本层下代数结论**。本层只产出方程与「代数侧怎么说」，
 *    一律透传 doSolve 的 tier/trust，不自己编一句「所以答案是…」。
 */
'use strict';

const { detF, detV } = require('./geometry/vec.js');

/**
 * ⭐ 惰性 require solver-service —— 绝不能顶层 require。
 *
 * 历史 bug（2026-10-04，tropical.js 上踩过同一个坑）：
 *   solver-service.js 顶层 require geometry 层（为了算 bound 时看几何），
 *   若本模块顶层再 require solver-service，就成环。
 * 成环的后果**不是一条警告**，而是静默半初始化：先加载任一方时，
 * 另一方在顶层 `const { x } = require(...)` 上拿到 undefined，
 * 后续调用 TypeError，而**堆栈指向完全无关的文件**。
 * 惰性 require 把环的时机推到调用点，此时两方都已初始化完。
 */
let _svc = null;
function svc() { if (!_svc) _svc = require('./solver-service.js'); return _svc; }

function fail(type, message, extra) {
  const e = { type, message };
  if (extra) Object.assign(e, extra);
  throw e;
}

// ── 数值格式化：与几何层 detF 同口径（12 位定点）──────────────────────
// ⚠ 为什么不直接 String(x)：方程组是要被 doSolve **重新解析**的文本。
//   `1.4142135623730951e0` 这种指数记数法在部分解析路径下会被截断，
//   导出的方程与原值不等 ⇒ 交叉验证变成自欺。
//   用 toFixed(12) 展开成十进制，解析回来误差 < 1e-12，远小于几何判定容差。
function num(x) {
  if (!Number.isFinite(x)) fail('invalid_input', '导出方程组时遇到非有限数：' + x);
  // 整数值不带小数点，省字节也免得解析器做多余的浮点化
  if (Number.isInteger(x) && Math.abs(x) < 1e15) return String(x);
  const s = x.toFixed(12);
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * 单个单项式渲染，**不带前导正负号之外的任何符号**。
 *
 * 契约（与 renderSystem 的拼接逻辑配对，改一处必须改另一处）：
 *   返回值以 '-' 开头 ⇔ 系数为负。renderSystem 见到前导 '-' 就用 ' - ' 拼接，
 *   于是这里**必须**把负号保留在返回值里。
 *
 * ⚠⚠ 历史 bug（2026-10-04，写完 20 分钟内被探针抓到）：
 *   这里原本写 `const mag = Math.abs(coef)` 然后只输出 mag，
 *   负号被**彻底丢弃** —— term(-1, [0,2]) 返回 "y^2" 而不是 "-y^2"，
 *   renderSystem 把它当正项拼进去，于是
 *     x^2 - y^2 = 1   与   x^2 + y^2 = 1
 *   **导出成完全相同的字符串**。
 *   而且这个 bug 全程不报错：方程照样解析、照样返回解、照样带 tier，
 *   只是解的是另一个几何对象 —— 双曲线静默变成了圆。
 *   ⇒ Math.abs 在「符号由调用方拼」的设计里是错的选择，别再写回去。
 */
function term(coef, exps, vars) {
  if (coef === 0) return null;
  const sign = coef < 0 ? '-' : '';
  const mag = Math.abs(coef);
  let body = '';
  for (let i = 0; i < vars.length; i++) {
    const e = exps[i] | 0;
    if (!e) continue;
    if (body) body += '*';
    body += e === 1 ? vars[i] : vars[i] + '^' + e;
  }
  if (!body) return sign + num(mag);                              // 常数项
  return sign + (mag === 1 ? '' : num(mag) + '*') + body;        // 系数 1 省略
}

/**
 * 把 { exps: [[次数向量], ...], coefs: [系数, ...] } 的稀疏多项式渲染成
 * doSolve 能解析的 "a + b*x = 0" 形态（常数项归到等号右边）。
 *
 * 变量名用 vars，指数必须是非负整数。
 */
function renderSystem(rows, vars) {
  const n = vars.length;
  const lines = [];
  for (const r of rows) {
    if (!r || !Array.isArray(r.exps) || !Array.isArray(r.coefs)) {
      fail('internal_error', 'renderSystem 收到形状不对的行：' + JSON.stringify(r));
    }
    if (r.exps.length !== r.coefs.length) {
      fail('internal_error',
        `renderSystem 指数项数(${r.exps.length}) ≠ 系数项数(${r.coefs.length})`);
    }
    // 拆成「非常数项」与「常数项」两堆；常数项最终归到等号右边
    const lhsTerms = [];
    let constSum = 0;
    for (let i = 0; i < r.exps.length; i++) {
      const c = r.coefs[i];
      if (!Number.isFinite(c) || c === 0) continue;
      const e = r.exps[i];
      if (!Array.isArray(e) || e.length !== n) {
        fail('internal_error',
          `renderSystem 指数向量维度不符：期望 ${n}，实得 ${Array.isArray(e) ? e.length : typeof e}`);
      }
      const isConst = e.every((x) => (x | 0) === 0);
      if (isConst) { constSum += c; continue; }
      const t = term(c, e, vars);
      if (t) lhsTerms.push(t);
    }
    const rhs = -constSum;
    if (!lhsTerms.length) {
      // 纯常数方程：0 = c。solve 对此有明确语义（c=0 恒真 / c≠0 无解），
      // 不写成别的形态是为了让退化语义在解析层就可见。
      lines.push('0 = ' + num(rhs));
      continue;
    }
    // ⭐ 这里绝不能再剥负号。
    //   term() 返回的已经是**带完整符号**的项：系数为负时它就带前导 '-'。
    //   历史 bug（2026-10-04，写完当场被探针抓到）：
    //   这里按 startsWith('-') 把负号 slice 掉「好让它以 ' - ' 形式拼接」，
    //   结果 -y^2 被拼成 ' + y^2' ⇒ x^2 - y^2 = 1 与 x^2 + y^2 = 1
    //   **导出成完全相同的字符串**。
    //   而这个 bug 不会报错：方程照样解析成功、照样返回解、照样带 tier，
    //   只是解的是另一个几何对象 —— 双曲线悄悄变成了圆。
    //
    //   这类 bug 只能靠「导出后跑一遍 doSolve 并回代验算」抓到，
    //   见 test/test-geometry-bridge.js 的回代不变式。
    let s = '';
    for (const t of lhsTerms) {
      const isNeg = t.startsWith('-');
      const body = isNeg ? t.slice(1) : t;
      s += s === '' ? (isNeg ? '-' : '') + body : (isNeg ? ' - ' : ' + ') + body;
    }
    lines.push(s + ' = ' + num(rhs));
  }
  return lines;
}

/**
 * 圆/球的一般方程（多变量，2 次）—— 几何对象的**定义方程**。
 * d 维球面：(x−a₁)² + … + (x−a_d)² = r²
 * 展开：Σx_i² − 2Σa_i x_i + (Σa_i² − r²) = 0
 */
function sphereEquations(center, radius2, vars) {
  const d = vars.length;
  const exps = [];
  const coefs = [];
  // 平方项
  for (let i = 0; i < d; i++) {
    const e = new Array(d).fill(0); e[i] = 2;
    exps.push(e); coefs.push(1);
  }
  // 一次项
  for (let i = 0; i < d; i++) {
    if (!center[i]) continue;
    const e = new Array(d).fill(0); e[i] = 1;
    exps.push(e); coefs.push(-2 * center[i]);
  }
  // 常数项
  const c0 = center.reduce((a, v) => a + v * v, 0) - radius2;
  exps.push(new Array(d).fill(0)); coefs.push(c0);
  return renderSystem([{ exps, coefs }], vars);
}

/** 多项式（给定项表）→ solve 方程。多变量。 */
function polynomialEquations(terms, vars) {
  const d = vars.length;
  const rows = new Map();   // 指数元组 -> 系数
  for (const t of terms) {
    if (!t || !Array.isArray(t.exponents)) {
      fail('invalid_input', '每个项必须含 exponents 数组');
    }
    if (!Number.isFinite(t.coeff)) {
      fail('invalid_input', '项的 coeff 必须是有限数（实得 ' + t.coeff + '）');
    }
    if (t.exponents.length !== d) {
      fail('invalid_input',
        `exponents 维度不符：期望 ${d}（变量 ${vars.join(',')}），实得 ${t.exponents.length}`);
    }
    const e = new Array(d).fill(0);
    for (let i = 0; i < d; i++) {
      const raw = t.exponents[i];
      const v = typeof raw === 'number' ? raw : NaN;
      // ⚠⚠ 负指数与非法指数必须**报错**，不能 `|0` 悄悄吃掉。
      //   历史 bug（2026-10-04）：这里写的是 `t.exponents[i] | 0`，
      //   于是 -1 变成 1 —— 指数的**符号被抹掉**，
      //   x^(-1) = 1 被导出成 x^1 = 1，求解器照样返回 x=1 且 tier=proven，
      //   一个**被形式化认证过的错误答案**。
      //   负指数（Laurent 项）要参与求解必须先乘一个幂次做平移，
      //   那是另一个明确的操作，不该由「渲染」偷偷替用户做。
      if (!Number.isInteger(v) || v < 0) {
        fail('invalid_input',
          `exponents[${i}] 必须是**非负整数**（实得 ${JSON.stringify(t.exponents[i])}）。`
          + '负指数（Laurent 项）不能直接渲染：先乘以某个变量的适当幂次做平移，'
          + '把负指数消掉，再交给本函数。',
          { variable: vars[i], got: t.exponents[i] });
      }
      e[i] = v;
    }
    const key = e.join(',');
    rows.set(key, (rows.get(key) || 0) + t.coeff);
  }
  const exps = [], coefs = [];
  for (const [key, c] of rows) {
    if (c === 0) continue;
    exps.push(key.split(',').map(Number));
    coefs.push(c);
  }
  return renderSystem([{ exps, coefs }], vars);
}

// ══ 几何 ⇄ 代数 接缝的核心：三点定外接圆（2D）═════════════════════════
//
// 为什么选它当接缝的第一件事：
//   · 几何上是最基本的构造（垂直平分线交点），人人能手算核对；
//   · 代数上是**三个一次方程三个未知数** —— 恰好落在 doSolve 的强项
//     （线性系统能拿到 tier=proven 的区间认证），不是拿弱项硬碰；
//   · 两条路的算法**完全独立**：闭式用克拉默法则，代数用消元 + Krawczyk。
//     独立才有交叉验证的价值，共用中间步骤就只是同一份代码跑两遍。
//
// 退化必须 fail-closed（纪律 2）：
//   三点共线 ⇒ 不存在外接圆（圆与直线最多两个交点，三个就超了）。
//   此时**不导出方程组** —— 导出一组必然无解的方程会让 Agent
//   把「问题本身无解」误读成「方程组解不出来」，这是两件事。

/**
 * 外接圆：几何闭式（克拉默法则）
 * @returns {null|{cx:number, cy:number, r:number, r2:number, det:number}}
 *   null = 三点退化（重复或共线），调用方必须据此 fail-closed
 */
function circumcircleClosed(p) {
  const [p1, p2, p3] = p;
  const [x1, y1] = p1, [x2, y2] = p2, [x3, y3] = p3;
  const det = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
  // ⚠ 判退化要看 det **精确为 0**，不能设容差：
  //   三个非常接近共线的点 det 会很小但非 0，此时外接圆**存在**，
  //   只是圆心极远、半径极大。按容差判会把「存在但很大」误报成「不存在」，
  //   而这两者对 Agent 的意义完全相反。
  //   这里用严格 === 0；det 的量级问题交给调用方通过半径大小判断。
  if (det === 0) return null;
  const s1 = x1 * x1 + y1 * y1, s2 = x2 * x2 + y2 * y2, s3 = x3 * x3 + y3 * y3;
  const cx = (s1 * (y2 - y3) + s2 * (y3 - y1) + s3 * (y1 - y2)) / det;
  const cy = (s1 * (x3 - x2) + s2 * (x1 - x3) + s3 * (x2 - x1)) / det;
  const r2 = (cx - x1) * (cx - x1) + (cy - y1) * (cy - y1);
  return { cx, cy, r: Math.sqrt(r2), r2, det };
}

/**
 * 外接圆的**代数导出**：把「圆心 (a,b) 到三点等距」翻译成三个一次方程。
 *   2(x₂−x₁)a + 2(y₂−y₁)b = x₂²+y₂² − x₁²−y₁²
 *   2(x₃−x₁)a + 2(y₃−y₁)b = x₃²+y₃² − x₁²−y₁²
 * 两条方程两个未知数 ⇒ 线性系统（doSolve 对它给区间认证）。
 */
function circumcircleEquations(p, vars) {
  const [a, b] = vars;
  const mk = (p0, p1) => {
    const lhs = `2*(${num(p1[0] - p0[0])})*${a} + 2*(${num(p1[1] - p0[1])})*${b}`;
    const rhs = num((p1[0] * p1[0] + p1[1] * p1[1]) - (p0[0] * p0[0] + p0[1] * p0[1]));
    return lhs + ' = ' + rhs;
  };
  return [mk(p[0], p[1]), mk(p[0], p[2])];
}

/**
 * 完整接缝：几何闭式 + 代数导出 + 双路交叉验证。
 *
 * @param {number[][]} p 三个 2D 点
 * @param {object} opts { variables: [aName,bName], runAlgebra: bool=true }
 * @returns {object} 接缝结果（含退化码与两路的一致性判定）
 */
function circumcircle(p, opts) {
  const o = opts || {};
  const vars = Array.isArray(o.variables) && o.variables.length === 2
    ? o.variables : ['a', 'b'];

  // ── 退化守卫：先查重复点（比共线更常见，且是更明确的错误）──────
  const seen = new Set();
  for (const q of p) {
    const k = q[0] + '|' + q[1];
    if (seen.has(k)) {
      fail('duplicate_points',
        '三点定圆需要 3 个**互不相同**的点；收到重复点。'
        + '重复点让外接圆不唯一（过两点的圆有无穷多个），不能给答案。',
        { duplicate: q.slice() });
    }
    seen.add(k);
  }

  const closed = circumcircleClosed(p);
  if (!closed) {
    // ⭐ fail-closed：共线 ⇒ 外接圆不存在。这里**返回**退化码而不是抛错，
    //   因为「三点共线没有外接圆」是一个**合法问题的正确答案**，
    //   不是输入非法。调用方据此置 degenerate，禁止 Agent 下结论。
    return {
      degenerate: 'collinear_points_have_no_circumcircle',
      equations: null,
      variables: vars,
      note: 'Three collinear points admit no circle (a line meets a circle in at most 2 points). '
        + 'No equations were exported: exporting a system that cannot be satisfied would '
        + 'blur "the problem has no answer" with "the system had no solution".'
    };
  }

  const equations = circumcircleEquations(p, vars);
  const out = {
    degenerate: null,
    // 几何路结果
    geometric: { cx: detF(closed.cx), cy: detF(closed.cy), r: detF(closed.r), r2: detF(closed.r2) },
    // 代数路：导出的方程组（Agent 可直接喂给 solve 工具）
    equations,
    variables: vars,
    // 圆的定义方程（几何对象自己的方程，多变量二次）
    circleEquation: sphereEquations([closed.cx, closed.cy], closed.r2, ['x', 'y'])
  };

  if (o.runAlgebra === false) return out;

  // ── 代数路：真跑 doSolve（惰性 require，避免与 solver-service 成环）────
  let algebra = null;
  try {
    const r = svc().doSolve({ equations, variables: vars });
    const s = r.solutions && r.solutions[0];
    algebra = {
      solutionCount: r.solutionCount,
      trustLevel: r.trust && r.trust.trustLevel,
      tier: s ? s.tier : null,
      certified: s ? !!s.certified : false,
      values: s ? s.values : null
    };
    // 交叉验证：两条路的圆心必须一致。
    // ⚠ 只在**都拿到有限值**时才判；代数侧没解出来不等于几何路错，
    //   那是「代数路在预算内失败」，两者是不同的信息，不能混成「不一致」。
    if (algebra.values && Number.isFinite(algebra.values[0]) && Number.isFinite(algebra.values[1])) {
      const dx = Math.abs(algebra.values[0] - closed.cx);
      const dy = Math.abs(algebra.values[1] - closed.cy);
      const scale = Math.max(1, Math.abs(closed.cx), Math.abs(closed.cy));
      algebra.maxAbsDiff = Number(Math.max(dx, dy).toFixed(12));
      algebra.agreesWithClosedForm = Math.max(dx, dy) <= 1e-9 * scale;
    } else {
      algebra.maxAbsDiff = null;
      algebra.agreesWithClosedForm = null;   // null = 无法判定，不是不一致
    }
  } catch (e) {
    algebra = { error: e.type || 'unknown', message: String(e.message || e).slice(0, 200),
      agreesWithClosedForm: null };
  }
  out.algebra = algebra;
  return out;
}

module.exports = {
  num,
  term,
  renderSystem,
  sphereEquations,
  polynomialEquations,
  circumcircleClosed,
  circumcircleEquations,
  circumcircle,
  // svc 暴露给需要跑 doSolve 的调用方（测试与 op 层都用它做交叉验证）
  _svc: svc
};
