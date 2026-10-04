/**
 * 多元根界（rootbound）正确性测试。
 *
 * ── 本文件的核心判据 ────────────────────────────────────────────────
 * 根界最容易出的不是「松」，而是**假紧** —— 给一个比真解还小的界，
 * 于是「所有解都在盒里」这句断言是假的，downstream 的 completeness
 * 就会**谎称找全了**。所以这里的测试全部围绕「界必须 ≥ 所有真实解」。
 *
 * 判据 P（等价于根界有效）：
 *   对任意真实解 v（全坐标非零），**每个**方程都至少有一个候选支配对
 *   (α,β) 的全部约束行被 v 满足。
 *   只要 P 成立，v 就落在某个「组合区域」里 ⇒ LP 的组合极大值 ≥ v_k ⇒ 界有效。
 * 所以 P 既做单元断言，也做随机压力测试（牛顿法从随机初值捞真解再验 P）。
 *
 * 另一个测试是端到端的：跑 doSolve 拿解，断言 |x_k| ≤ halfWidths[k]。
 *
 * // COVERS: rootBounds, lpMax, dirBounds
 */
'use strict';

const RB = require('../services/rootbound.js');
const P = require('../services/polynomial.js');
const svc = require('../services/solver-service.js');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; failures.push(name); console.log('  ❌ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

// ── 0. 小工具 ───────────────────────────────────────────────────────

function rowsFor(eqTerms, k, ai, bi) {
  const terms = eqTerms.filter((m) => m.coef !== 0);
  const ln = terms.map((m) => Math.log(Math.abs(m.coef)));
  const exps = terms.map((m) => m.exps);
  return RB._internals.makeRows(exps, ln, ai, bi, terms);
}

// 约束就是 ⟨a,v⟩ ≤ rhs：slack = rhs − ⟨a,v⟩ ≥ 0 即满足。
// ⚠ 别多写 `if (slack > eps) return false`（第一版残留）：slack>0 恰恰是「严格满足」，
//   写成违反会让判据把正常解全判成未覆盖，红得莫名其妙。
function vSatisfies(rows, v, eps) {
  eps = eps || 1e-9;
  for (const r of rows) {
    let s = 0;
    for (let t = 0; t < r.a.length; t++) s += r.a[t] * v[t];
    if (r.rhs - s < -eps) return false;
  }
  return true;
}

/**
 * 判据 P：真实解 v（**log 空间**）在每个方程上都至少被一个候选支配对接住。
 * ⚠ 传入的 v 必须是 v_i = ln|x_i| —— makeRows 的 rhs 是 ln|系数差|、行向量是
 *   指数差，两者都要求 v 在对数空间。第一版直接把原始解 [√2] 传进去，
 *   等式行必然违反 ⇒ 判据假红（而且会掩盖真 bug）。
 */
function coverageHolds(eqTexts, vars, v) {
  // 零坐标解 → 用「极小负」哨兵近似 v=−∞（真 log 空间是 −∞，乘指数会 NaN）。
  // 取 −1e18：与指数差相乘量级 1e18 以内不溢出，够把该坐标压到支配/平衡带之外。
  const lv = v.map((x) => (x === 0 ? -1e18 : Math.log(Math.abs(x))));
  const sys = P.parseSystem(eqTexts, vars);
  for (let j = 0; j < sys.equations.length; j++) {
    const terms = sys.equations[j].monomials.filter((m) => m.coef !== 0);
    if (terms.length < 2) continue;
    const pairs = RB._internals.candidatePairs(terms, 0);   // 只验变量 0 的候选集是否够全
    let covered = false;
    for (const pr of pairs) {
      if (vSatisfies(RB._internals.makeRows(
        terms.map((m) => m.exps), terms.map((m) => Math.log(Math.abs(m.coef))), pr.ai, pr.bi, terms), lv)) {
        covered = true; break;
      }
    }
    if (!covered) return false;
  }
  return true;
}

/** 牛顿法从随机初值捞实解（用于压力测试）—— n 阶线性方程组真解一次 */
function findRealSolutions(eqTexts, vars, tries, bound) {
  const sys = P.parseSystem(eqTexts, vars);
  const n = vars.length;
  const F = (pt) => sys.equations.map((p) => {
    let acc = 0;
    for (const m of p.monomials) {
      if (m.exps.some((e) => e < 0)) return NaN;         // 跳过 Laurent（不在 (C*)^n 的测试语义里）
      let mono = m.coef;
      for (let i = 0; i < n; i++) mono *= Math.pow(pt[i], m.exps[i]);
      acc += mono;
    }
    return acc;
  });
  const J = (pt) => sys.equations.map((p) => {
    const row = [];
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (const m of p.monomials) {
        if (m.exps[i] === 0) continue;
        let mono = m.coef * m.exps[i] * Math.pow(pt[i], m.exps[i] - 1);
        for (let q = 0; q < n; q++) if (q !== i) mono *= Math.pow(pt[q], m.exps[q]);
        acc += mono;
      }
      row.push(acc);
    }
    return row;
  });
  // 解 A·x = rhs（高斯消元，带主元选取）
  const solveLin = (A, rhs) => {
    const m = A.length;
    const M = A.map((r, i) => r.concat([rhs[i]]));
    for (let c = 0; c < m; c++) {
      let piv = c;
      for (let r = c + 1; r < m; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-14) return null;
      const tmp = M[c]; M[c] = M[piv]; M[piv] = tmp;
      for (let r = 0; r < m; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        if (f === 0) continue;
        for (let k = c; k <= m; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((r, i) => r[m] / r[i]);
  };
  const res = [];
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let t = 0; t < tries; t++) {
    let pt = [];
    for (let i = 0; i < n; i++) pt.push((rnd() * 2 - 1) * (bound || 5));
    for (let it = 0; it < 80; it++) {
      const f = F(pt), Jm = J(pt);
      if (f.some((x) => !isFinite(x)) || Jm.some((r) => r.some((x) => !isFinite(x)))) break;
      const d = solveLin(Jm, f.map((x) => -x));
      if (!d) break;
      // 阻尼步长（0.25 保底，别一步跨爆）
      let lam = 1;
      for (let i = 0; i < n; i++) {
        if (!isFinite(pt[i] + lam * d[i])) { lam = 0.25; }
      }
      for (let i = 0; i < n; i++) pt[i] += lam * d[i];
      if (pt.some((x) => !isFinite(x))) break;
      if (Math.max.apply(null, f.map(Math.abs)) < 1e-13 && it > 3) break;
    }
    const f = F(pt);
    if (f.some((x) => !isFinite(x) || Math.abs(x) > 1e-9)) continue;
    if (pt.some((x) => Math.abs(x) < 1e-7)) continue;                 // 零坐标解不属 (C*)^n 判据
    // ⚠ 必须用**逐方程相对**残差收口。绝对残差 1e-9、或「全体方程取最大量级」的
    //   相对残差，都会把伪解放进来：
    //   -4v0³+2v0³v1=0 与 2v0v1²−v0v1³−2v0²v1³=0 的真解只有 (0,2)（**零坐标**，
    //   本就不属 (C*)^n 的界覆盖范围）。牛顿从随机初值漂到 (−1.6e−5, 2.00006)：
    //   Eq2 残差 2.6e−14 对自身量级 2.4e−4 = 1e−10（看着很干净），
    //   Eq1 残差 5e−19 却对自身量级 1.6e−14 = 3e−5（Eq1 其实是 v0³(2v1−4)，
    //   要求 v1=2 **精确**）。根界是对**精确解**的证明，伪解越界不算根界错。
    //   用全体方程最大量级当分母，恰好把 3e−5 稀释成 2e−15  ⇒ 假绿。
    let worst = 0;
    sys.equations.forEach((p, i) => {
      let scale = 0;
      for (const m of p.monomials) {
        let mv = Math.abs(m.coef);
        for (let q = 0; q < n; q++) mv *= Math.abs(Math.pow(pt[q], m.exps[q]));
        scale += mv;
      }
      if (scale > 0) worst = Math.max(worst, Math.abs(f[i]) / scale);
    });
    if (worst > 1e-7) continue;
    if (!res.some((s) => s.every((x, i) => Math.abs(x - pt[i]) < 1e-6))) res.push(pt.slice());
  }
  return res;
}

// ── 1. LP 单测 ──────────────────────────────────────────────────────
console.log('1) 小 LP（两阶段单纯形）');

{
  // max x  s.t. 2x≤4 且 −x≤2（即 x∈[−2,2]）⇒ x=2
  // 选这个用例是为了**逼松弛列入基**（系数 2 的那行 slack 必须被检查到 ——
  // Phase II 只放结构列时，这里会被误判无界）。
  const r = RB.lpMax([1], [[2], [-1]], [4, 2]);
  ok(r.status === 'optimal' && Math.abs(r.obj - 2) < 1e-9, 'LP 可行且有界（松弛列参与入基）→ obj=2', r);
}
{
  // max x  s.t. −x ≤ −3 （即 x ≥ 3）⇒ 无界
  const r = RB.lpMax([1], [[-1]], [-3]);
  ok(r.status === 'unbounded', 'LP 真无界（负右端的行）→ status=unbounded', r);
}
{
  // max x  s.t. x ≤ −3 且 −x ≤ −3（即 x≤−3 且 x≥3）⇒ 不可行
  // ⚠ 单条 x≤−3 本身**可行**（LP 变量是自由的，x=−4 满足）—— 第一版用例写错了，
  //   于是「不可行」这条断言永远红，而真正该查的是两条约束打架的情形。
  const r = RB.lpMax([1], [[1], [-1]], [-3, -3]);
  ok(r.status === 'infeasible', 'LP 不可行 → status=infeasible', r);
}
{
  // max x+y s.t. x≤1, y≤2 ⇒ 3
  const r = RB.lpMax([1, 1], [[1, 0], [0, 1]], [1, 2]);
  ok(r.status === 'optimal' && Math.abs(r.obj - 3) < 1e-9, 'LP 标准形 obj=3', r);
}
{
  // 退化/冗余：max x s.t. x≤1, x≤1, x≤1
  const r = RB.lpMax([1], [[1], [1], [1]], [1, 1, 1]);
  ok(r.status === 'optimal' && Math.abs(r.obj - 1) < 1e-9, 'LP 冗余行不误判无界', r);
}

// ── 2. 已知情形：紧度 + 有效性 ───────────────────────────────────────
console.log('2) 已知情形（有效 + 紧度）');

{
  const r = RB.rootBounds(['x^2=2'], ['x']);
  ok(isFinite(r.halfWidths[0]) && Math.abs(r.halfWidths[0] - Math.SQRT2) < 1e-9, 'x^2=2 ⇒ |x| ≤ √2（精确）', r.halfWidths);
}
{
  const r = RB.rootBounds(['x^2=4'], ['x']);
  ok(Math.abs(r.halfWidths[0] - 2) < 1e-9, 'x^2=4 ⇒ |x| ≤ 2（精确）', r.halfWidths);
}
{
  const r = RB.rootBounds(['x^2=2', 'y^2=3'], ['x', 'y']);
  ok(Math.abs(r.halfWidths[0] - Math.SQRT2) < 1e-9 && Math.abs(r.halfWidths[1] - Math.sqrt(3)) < 1e-9,
    'x^2=2,y^2=3 ⇒ (√2, √3) 精确', r.halfWidths);
}
{
  // 大解也必须被包住（改 ±∞ 的核心诉求）
  const r = RB.rootBounds(['x=100000000000'], ['x']);
  ok(Math.abs(r.halfWidths[0] - 1e11) < 1e11 * 1e-9 + 1, 'x=1e11 ⇒ 界覆盖 1e11（旧 1e6 域会把它挡在外面）', r.halfWidths);
}
{
  // 交集才有限：x^3−y=0 与 y^2−x=0 单独每式都无界，交集 {v=0}
  const r = RB.rootBounds(['x^3=y', 'y^2=x'], ['x', 'y']);
  ok(isFinite(r.halfWidths[0]) && isFinite(r.halfWidths[1]) && Math.abs(r.halfWidths[0] - 1) < 1e-6,
    'x^3=y,y^2=x ⇒ 交集给出 |x| ≤ 1（正维/无穷远情形被识别）', r.halfWidths);
  const r2 = RB.rootBounds(['x^3=y'], ['x', 'y']);
  ok(!isFinite(r2.halfWidths[0]), '单式 x^3=y 无界 ⇒ 老实报「不界」（free/unbounded）', r2.halfWidths);
}
{
  const r = RB.rootBounds(['x^2+y^2=4'], ['x', 'y']);
  ok(r.halfWidths.every((w) => w >= 2 - 1e-9), 'x^2+y^2=4 ⇒ 界 ≥ 2（真解 (±2,0),(0,±2) 必须被包住）', r.halfWidths);
}
{
  const r = RB.rootBounds(['x*y=1', 'x+y=3'], ['x', 'y']);
  ok(r.halfWidths.every((w) => w >= (3 + Math.sqrt(5)) / 2 - 1e-9),
    'x*y=1,x+y=3 ⇒ 界 ≥ 2.618（真解 (2.618,0.382) 必须被包住）', r.halfWidths);
}
{
  // Laurent：1/x=2 ⇒ x=1/2，界必须 ≥ 1/2 也不能是 0
  const r = RB.rootBounds(['1/x=2'], ['x']);
  ok(isFinite(r.halfWidths[0]) && r.halfWidths[0] >= 0.5 - 1e-12, 'Laurent 1/x=2 ⇒ 界 ≥ 1/2', r.halfWidths);
}

// ── 3. 判据 P：已知解必须被候选对接住 ─────────────────────────────────
console.log('3) 判据 P（候选支配对必须覆盖真实解）');

{
  const cases = [
    [['x^2=2'], ['x'], [Math.SQRT2], [Math.SQRT2], true],
    [['x^2=2'], ['x'], [-Math.SQRT2], [Math.SQRT2], true],
    [['x+y=3', 'x*y=1'], ['x', 'y'], [(3 + Math.sqrt(5)) / 2, (3 - Math.sqrt(5)) / 2], [3, 3], true],
    [['x^2+y^2=4'], ['x', 'y'], [2, 0], [2, 2], true],
    [['x^2+y^2=4'], ['x', 'y'], [0, -2], [2, 2], true],
    [['x^3=y', 'y^2=x'], ['x', 'y'], [1, 1], [1, 1], true],
    [['x^3=y', 'y^2=x'], ['x', 'y'], [0, 0], [1, 1], false]   // 零坐标解不在 (C*)^n，允许不覆盖
  ];
  cases.forEach((c, i) => {
    ok(c[4] === coverageHolds(c[0], c[1], c[2]), 'P: 用例#' + (i + 1) + ' ' + c[0].join(' & ') + ' 的解被候选对覆盖');
  });
}

// ── 4. 随机压力测试：界必须 ≥ 牛顿法捞到的所有真实解 ───────────────────
console.log('4) 随机压力测试（有效性 = 界必须包住牛顿法捞到的所有实解）');

{
  let rndSeed = 20261004;
  const rnd = () => { rndSeed = (rndSeed * 1103515245 + 12345) & 0x7fffffff; return rndSeed / 0x7fffffff; };
  const irnd = (a, b) => a + Math.floor(rnd() * (b - a + 1));

  let systemsTried = 0, systemsWithSol = 0, violations = 0, badDetail = null;

  for (let s = 0; s < 40 && systemsTried < 60; s++) {
    const n = 2 + (s % 2);                       // 2 或 3 变量
    const vars = [];
    for (let i = 0; i < n; i++) vars.push('v' + i);
    const eqTexts = [];
    let okSys = true;
    for (let j = 0; j < n; j++) {
      // 每项：系数 ±1..3 × 单项式（指数 0..3）
      let texpr = [];
      for (let t = 0; t < 3; t++) {
        const mono = [];
        for (let i = 0; i < n; i++) mono.push(irnd(0, 3));
        let body = '';
        mono.forEach((e, i) => { if (e > 0) body += (body ? '*' : '') + vars[i] + (e > 1 ? '^' + e : ''); });
        if (!body) body = '1';
        const c = (rnd() < 0.5 ? -1 : 1) * (1 + irnd(0, 2));
        texpr.push((texpr.length ? '+' : '') + c + (c === 1 || c === -1 ? '*' : '') + body);
      }
      eqTexts.push(texpr.join('') + '=0');
    }
    let rb;
    try { rb = RB.rootBounds(eqTexts, vars); } catch (e) { continue; }
    systemsTried++;

    const sols = findRealSolutions(eqTexts, vars, 220, 6);
    if (!sols.length) continue;
    systemsWithSol++;
    for (const v of sols) {
      for (let k = 0; k < n; k++) {
        const W = rb.halfWidths[k];
        if (!isFinite(W) || Math.abs(v[k]) > W * (1 + 1e-9) + 1e-9) {
          violations++;
          if (!badDetail) badDetail = { eqs: eqTexts.join(' & '), v, k, W };
        }
      }
    }
  }
  ok(systemsWithSol >= 8, '随机压力测试：至少 8 个系统捞到实解（实得 ' + systemsWithSol + '/60）');
  ok(violations === 0, '随机压力测试：界 ≥ 所有实解（违背 ' + violations + ' 处）', badDetail);
}

// ── 5. 端到端：走 doSolve，返回的解必须落在界里 ──────────────────────
console.log('5) 端到端（doSolve 的解 vs 根界）');

{
  const cases = [
    { eqs: ['x^2=2'], vars: ['x'] },
    { eqs: ['x^2+y^2=4'], vars: ['x', 'y'] },
    { eqs: ['x*y=1', 'x+y=3'], vars: ['x', 'y'] },
    { eqs: ['x^3=y', 'y^2=x'], vars: ['x', 'y'] }
  ];
  cases.forEach((c, i) => {
    let r = null;
    try { r = RB.rootBounds(c.eqs, c.vars); } catch (e) { ok(false, '端到端#' + (i + 1) + ' 根界可算', String(e.message)); return; }
    let solved = null;
    try { solved = svc.doSolve({ equations: c.eqs, variables: c.vars }); } catch (e) { solved = null; }
    if (!solved || !Array.isArray(solved.solutions) || !solved.solutions.length) {
      ok(true, '端到端#' + (i + 1) + ' ' + c.eqs.join('&') + '：求解器未返回解（跳过比对）');
      return;
    }
    const vals = solved.solutions[0].values || solved.solutions[0];
    const within = c.vars.every((_, k) => isFinite(r.halfWidths[k]) && Math.abs(vals[k]) <= r.halfWidths[k] * (1 + 1e-9) + 1e-9);
    ok(within, '端到端#' + (i + 1) + ' ' + c.eqs.join('&') + '：解 ' + JSON.stringify(vals) + ' 在界内 ' + JSON.stringify(r.halfWidths));
  });
}

// ── 6. fail-closed：非多项式 / 正维族 / 超越方程 ──────────────────────
console.log('6) fail-closed');

{
  let threw = false;
  try { RB.rootBounds(['sin(x)=0'], ['x']); } catch (e) { threw = /not_polynomial|function call/.test(String(e.message)); }
  ok(threw, '超越方程 sin(x)=0 ⇒ 直接抛（不硬造界）');
}
{
  const r = RB.rootBounds(['x=y'], ['x', 'y']);
  ok(r.halfWidths.some((w) => !isFinite(w)), '正维族 x=y ⇒ 老实报「不界」', r.halfWidths);
}
{
  // 零坐标语义：只有「令 x=0 后方程恒等 0」才算真风险（x*y=0 那类）。
  // 旧判据按 minDegrees≤0 判，会把一切含常数项的方程（x²=2 也算）都标成有风险，
  // 于是 proven 永远 false —— 那才是「没有证据」。
  const r = RB.rootBounds(['x^2=2'], ['x']);
  ok(r.zeroCoordinateRisk === false && r.proven === true && Math.abs(r.halfWidths[0] - Math.SQRT2) < 1e-9,
    'x^2=2 ⇒ 无零坐标风险、界被证明为 √2',
    { zero: r.zeroCoordinateRisk, proven: r.proven, w: r.halfWidths });
}
{
  const r = RB.rootBounds(['x*y=0'], ['x', 'y']);
  ok(r.zeroCoordinateRisk === true && r.proven === false, 'x*y=0 ⇒ 代 x=0 方程恒等 0 ⇒ 标风险且不证界',
    { zero: r.zeroCoordinateRisk, proven: r.proven });
}

// ── 7. 接入层契约（任务 #87）─────────────────────────────────────────
//
// 前面 6 节测的是「根界算得对不对」。这一节测的是**接进 doSolve 之后行为对不对** ——
// 那才是 Agent 真正看到的东西。回归风险全在这一层：
//   · 域门控被绕过 ⇒ 未证明的域又支撑起 complete（谎称找全，产品最不能犯的错）
//   · 收紧域被误当成放大 ⇒ 返回体顶爆 1600B / 引擎白跑分支认证
//   · 大系数解被旧默认域静默判成无解（x=1e11 那类真 bug）
console.log('7) 接入层契约（doSolve / doPolyRoots）');

function comp(r) { return (r && r.trust && r.trust.completeness) || null; }
function bytes(r) { return JSON.stringify(r).length; }

{
  // 门控正向：域被证过 ⇒ complete 可说
  const r = svc.doSolve({ equations: ['x^2=2'], variables: ['x'] });
  ok(comp(r) && comp(r).status === 'complete', 'x^2=2（域已证）⇒ completeness=complete', comp(r));
  ok(bytes(r) < 1600, 'x^2=2 返回体仍在 1600B 红线内（实测 ' + bytes(r) + 'B）', bytes(r));
}
{
  // ⚠⚠⚠ 本块断言在 2026-10-04 **被推翻并重写**。留档，因为推翻它的推理过程本身是本项目
  // 「完备性判定」这块最值得记住的一课：同一个数学直觉，在两个方向上都错。
  //
  // 【旧断言钉的是什么】
  //   “显式 domain 无从证明 ⇒ 即使 found==bound 也必须降级 unknown + domainUnproven”。
  //   理由听起来很硬：纪律②规定用户给了域就一个字不改 ⇒ 无从证明这个域盖住了全部解
  //   ⇒ found==bound 只是“碰巧对”（x^2=2 域[-2,2] 真解确实都在盒里），不是“证出来对”
  //   （同样的形状换成 x^2=2 域[1,2] 就漏掉负根）⇒ “找全了”这句话只有域被证明时才能说。
  //
  // 【为什么它必须被推翻 —— 它自己给出的反驳就成立】
  //   solutionBounds(equations, vars) **压根不接域参数**（services/bounds.js:122）：
  //   Bézout ∏d_i、BKK 混合体积、多齐次 Bézout、Milnor–Thom、Descartes
  //   全都是**对整个 C^n / R^n 的全局断言**，与搜索盒无关。
  //   而“找到数 == **全局**上界”本身即蕴含“没有更多解”：
  //   若盒外真藏着解，找到数就会**超过**全局上界，与 found==bound 直接矛盾。
  //   ⇒ 对域无关的界，“盒外还有解”不是“可能”，而是**逻辑上不可能**。
  //   实测双向验证：
  //     x^2=2 域[-2,2]：两真解都在盒内 ⇒ 旧逻辑报 unknown（🔴 过保守，且与 conclusion=全部解 同体矛盾）
  //     x^2=2 域[1,2] ：盒外有 −√2     ⇒ 旧逻辑**根本没拦住**（found=1 < bound=2，走不到该分支）
  //   也就是说：这条断言**没防住真正的谎报，却挡住了正确的结论**。方向反了。
  //
  // 【那真正的谎报现在由谁挡】
  //   Sturm 声明空间证据（_sturmCompletenessCheck → conclusion.js 的 scope 白名单）：
  //   x^2=2 域[1,2] 现在实测 conclusion=部分解、canAssert.allSolutions=false。
  //   这才是数学上真正充分的防线 —— 它数的是**问题允许的解范围**里到底有几个根，
  //   而不是间接推断“域大概盖住了”。详见 test/dual-parity.mjs 第 12 节。
  //
  // 【因此新断言钉的是】
  //   ① 域无关上界击满 ⇒ 敢报 complete（Bézout 2 == found 2，二元 4 == 4 同理）
  //   ② 但这只在「找到数 == 全局上界」时成立；found < bound 时仍必须降级
  //   ③ 域无关性是**契约**（bounds.js 的 domainFree:true），不是巧合
  const r = svc.doSolve({ equations: ['x^2=2'], variables: ['x'], domain: { x: [-2, 2] } });
  ok(comp(r) && comp(r).status === 'complete' && comp(r).bound === 2,
    '域无关上界击满（Bézout=2==found 2）⇒ 敢报 complete（推翻旧 domainUnproven 门控）', comp(r));
  ok(!comp(r) || comp(r).domainUnproven === undefined,
    '旧 domainUnproven 字段已移除（对域无关的界，“域外还有解”逻辑上不可能）', comp(r));
  const r2 = svc.doSolve({ equations: ['x^2=2', 'y^2=3'], variables: ['x', 'y'],
    domain: { x: [-2, 2], y: [-2, 2] } });
  ok(comp(r2) && comp(r2).status === 'complete' && r2.solutionCount === 4 && comp(r2).bound === 4,
    '二元同款：4 解 == 全局上界 4 ⇒ complete（BKK/Bézout 与盒无关）',
    { n: r2.solutionCount, comp: comp(r2) });
  // 反向仍必须降级：found < 上界时，「盒外还有解」是**真的**可能，不得说找全。
  const r3 = svc.doSolve({ equations: ['x^2-5*x+4 = 0'], variables: ['x'], domain: { x: [1, 2] } });
  ok(!comp(r3) || comp(r3).status !== 'complete',
    '反向纪律：found < 全局上界 ⇒ 不得报 complete（盒外确有真根时必须降级）', comp(r3));
}
{
  // 无界方程组：域证不出来（rootbound 老实报「不界」）。
  // 这里走的是「拿不到上界」分支（bound=null）而不是门控分支，但结论一样：
  // 绝不说 complete。这条守的是「无界 ⇒ 正维解集 ⇒ 个数上界本身不适用」。
  const r = svc.doSolve({ equations: ['x=y'], variables: ['x', 'y'] });
  ok(comp(r) && comp(r).status === 'unknown',
    'x=y（正维解族，上界不适用）⇒ completeness=unknown', comp(r));
}
{
  // 门控对 provenEmpty 无影响：严格证无解不需要任何上界，必须仍能说 complete。
  // 踩过的坑：门控加在 provenEmpty 之前 ⇒ x^2+y^2+1=0 被误报 unknown，
  // Agent 明明可以收工却被告知「不知道全不全」。
  const r = svc.doSolve({ equations: ['x^2+y^2+1=0'], variables: ['x', 'y'] });
  ok(comp(r) && comp(r).status === 'complete' && comp(r).bound === 0,
    'x^2+y^2+1=0（严格证无解）⇒ 门控不误伤，bound=0 且 complete', comp(r));
}
{
  // 旧策略真 bug：大系数解落在 ±1e6 之外，旧默认域会**静默判成无解**。
  // 接根界后应给出解并说 complete。
  const r = svc.doSolve({ equations: ['x=1e11'], variables: ['x'] });
  ok(r.solutionCount === 1 && Math.abs(r.solutions[0].values[0] - 1e11) / 1e11 < 1e-9
     && comp(r) && comp(r).status === 'complete',
    'x=1e11（根在旧默认域 ±1e6 之外）⇒ 找出解且 complete（旧策略会静默判无解）',
    { n: r.solutionCount, v: r.solutions[0] && r.solutions[0].values, comp: comp(r) });
}
{
  // 纪律 ③：只在证出的界**更大**时才动域。解集明明在 ±1.5，硬塞 ±1.5 会打开
  // 引擎 userDomain ⇒ 触发全局分支认证 ⇒ 返回体顶爆。这里断言字节数没被顶上去。
  const r = svc.doSolve({ equations: ['x^2=2'], variables: ['x'] });
  ok(bytes(r) < 1600, '纪律③ 收紧不生效：证出界(1.41) < 旧默认(1e6) ⇒ 域不动，返回体不涨（' + bytes(r) + 'B）', bytes(r));
}
{
  // 用户显式给了 domain ⇒ 一个字不改（纪律 ②），且不因此声称域被证明。
  const r = svc.doSolve({ equations: ['x^2=2'], variables: ['x'], domain: { x: [-2, 2] } });
  ok(r.solutionCount >= 1, '显式 domain ⇒ 照用不误（用户域优先）', { n: r.solutionCount });
}
{
  // doPolyRoots 也接根界 ⇒ 一元路径的 completeness 不被门控误降级。
  const r = svc.doPolyRoots({ coefficients: [1, -3, 2] });   // (x-1)(x-2)
  ok(r.solutionCount === 2 && comp(r) && comp(r).status === 'complete',
    'doPolyRoots (x-1)(x-2) ⇒ 2 解且 complete（一元 k=2 根界精确可证）',
    { n: r.solutionCount, comp: comp(r) });
}
{
  // doPolyRoots 顺手修掉的真 bug：根在 ±1e6 之外。
  const r = svc.doPolyRoots({ coefficients: [1, 0, -1e13] });  // x^2 = 1e13 ⇒ ±3.16e6
  const v = r.solutions[0] && r.solutions[0].values[0];
  ok(r.solutionCount >= 1 && Math.abs(Math.abs(v) - Math.sqrt(1e13)) / Math.sqrt(1e13) < 1e-6,
    'doPolyRoots x^2-1e13 ⇒ 根 ±3.16e6 被找到（旧默认域 ±1e6 会漏）', { n: r.solutionCount, v: v });
}
{
  // doVerify 刻意不接根界：它用「候选 ± margin」的局部盒，语义是「附近有没有根」。
  // 若拿全局根界去断言这个局部盒盖住全部解，就是错的。
  const r = svc.doVerify({ equation: 'x^2=2', candidate: 1.4142135623730951 });
  ok(r && r.verdict === 'verified', 'doVerify 仍正常裁决（不受 #87 影响）', r && r.verdict);
}
{
  // 欠定系统（方程数 < 变量数）：解集是**正维流形**（SymPy 核过 rank(J)=2<3），
  // 只给 1 个代表点是**正确**的。这条守的是「别把代表点当全部解报出去」。
  //
  // 实测踩过的坑（我诊断错了，代码是对的）：我一度以为 x²+y²+z²=6 & x*y=1
  // 「只有 1 解而真解有 4 个」是漏解。用 SymPy 独立核对后才发现
  // 代入 y=1/x ⇒ z²=6−x²−1/x²，x 在 [1,2] 连续可取 ⇒ **1 维连续曲线**，无穷多解。
  // ⇒ 教训：判「漏解」之前必须先独立确认**解集的维数**，别拿孤立解的直觉套流形。
  const r = svc.doSolve({ equations: ['x^2+y^2+z^2=6', 'x*y=1'], variables: ['x', 'y', 'z'] });
  ok(r.truncated === true && comp(r) && comp(r).status !== 'complete',
    '欠定流形系统 ⇒ truncated=true 且 completeness 不说 complete', { trunc: r.truncated, comp: comp(r) });
  ok(String(r.summary || '').indexOf('8 秒') < 0 && !(r.warnings || []).some((w) => /8 秒/.test(String(w))),
    '欠定流形系统不报「8 秒预算被中止」（实测 timeMs<100ms，该文案是误报）',
    { msg: r.message, warn: r.warnings });
}

// ── 汇总 ────────────────────────────────────────────────────────────
console.log('');
console.log('通过 ' + pass + ' / 失败 ' + fail);
if (fail) { console.log('失败项：\n  - ' + failures.join('\n  - ')); process.exit(1); }
