/**
 * 多元根界（root bound）—— **无界数值域的准入条件**。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────
 * 求解器原本的搜索域是「猜」出来的（constants.js：max(1e6, 最大常量×1000)）。
 * 「只放大不缩小」确实保证不漏解，但它只保证**不漏**，
 * 不保证**域够紧**，更不保证**「域是够的」这件事有依据**。
 * 改成 ±∞ 之后起点就是 R^n —— 区间算术在 [−∞,∞] 上恒等于 [−∞,∞]，
 * 分支定界的「排除」第一步失效。所以必须先用**定理**把 R^n 证成有限盒。
 *
 * ── 数学（log 空间 / 热带）──────────────────────────────────────────
 * x 是解，令 v_i = ln|x_i|，单项式 γ 的「量级对数」
 *
 *        A_γ = ln|c_γ| + ⟨γ, v⟩
 *
 * 由 Σ_γ c_γ x^γ = 0 得 **最大项必被其余项抵消**：取 α* = 最大项的指数，
 * β* = 除 α* 外最大的那个，则三条**必要**条件同时成立：
 *
 *   α* 支配： A_γ ≤ A_α*  ∀γ≠α*        （α* 是最大项）
 *   β* 支配： A_γ ≤ A_β*  ∀γ∉{α*,β*}   （β* 是次大项）
 *   平衡带：  A_α* ≤ A_β* + ln(k−1)     （e^{A_α*} ≤ Σ_{γ≠α*}e^{A_γ} ≤ (k−1)e^{A_β*}）
 *
 * 三条都写进 LP（全是**线性**不等式），解的对数模长 v 必落在某个区域里。
 * 真实解落在哪个 (α*,β*) 事先不知道 —— 所以把**所有** (α,β) 的组合都枚举成
 * 区域、各自跑 LP、最后**取 max**（上界的极大仍是上界；取 min 才是灾难）。
 *
 * ⚠ 四条必须钉死的纪律（每条都踩过）：
 *   ① **支配行方向**：A_α ≥ A_γ 写成 ⟨γ−α,v⟩ ≤ ln|c_α|−ln|c_γ|（γ 的指数减 α 的）。
 *      写反（第一版）⇒ 区域变成「α 不是最大项」⇒ 假紧界。
 *   ② **取 max 不取 min**：真实解在「真实支配对组合」里，谁真实事先未知 ⇒
 *      有效上界 = **所有组合上界的极大**。
 *   ③ **候选对必须穷举到不会漏**：α 必须能覆盖真实最大项。任何按启发式切片
 *      （只取 α_k 最大切片 / 只取前 2 个单项式）都会漏 ⇒ 那类界**不可用**。
 *      实测教训：x+y=3 在 x=2.618 处的真实最大项是**常数项 −3**（ln3=1.0986 >
 *      ln2.618=0.963），根本不在 α_k 的最大切片里。
 *   ④ **组合数超预算 ⇒ 直接判 proven=false（不硬造界）**。丢掉部分组合会让
 *      上界**变小**（极可能是假紧界），所以宁可「证不了」，也不给半个证据。
 *
 * ── 不覆盖（必须 fail-closed 说清）──────────────────────────────────
 *   · **非多项式**（sin / exp / 根号）：整个模块不适用，调用方回落。
 *   · **无穷远解**：某组合区域在 ±e_k 无界 ⇒ LP 真判 unbounded ⇒
 *     该变量标 unbounded，绝不硬造假界。
 *   · **零坐标解**：x_i=0 对应 v_i=−∞，log 推导不适用；但它满足 |x_i|=0 ≤ W_i
 *     **平凡成立** ⇒ 界作为「盒」仍然成立。故 zeroCoordinateRisk 只作提示，
 *     不参与 proven 判定（真正让 proven=false 的是无界 / 超预算）。
 */
'use strict';

const P = require('./polynomial.js');

const MAX_SUPPORT_TERMS = 12;     // 界计算用的支撑截断（只放宽 slack，不影响有效性）
const MAX_COMBOS = 50000;         // 跨方程组合枚举上限（超预算 ⇒ proven=false）
// 单次 rootBounds 的墙钟预算（ms）。实测 6 元稠密题 14112 combos 要 6.5s，
// 而求解本身只要 40ms —— 根界是优化不是前提，超时就诚实降级（同 MAX_COMBOS 处置）。
//
// ⚠ 2026-10-05：改为**可注入**，理由是可测性 ——
//   它是「花多少算力换一个 proven」的**定价旋钮**，必须有办法在多个取值上实测
//   「proven 掉多少 / 端到端快多少」，否则就只能凭感觉定这个数。
//   见 test/rootbound-value.mjs（用真实题集扫 300/100/50/30/10/0ms）。
const DEFAULT_MAX_MS = 300;
const MAX_MS = (() => {
  const v = parseInt(process.env.LS_RB_MAX_MS ?? '', 10);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_MAX_MS;
})();
const MAX_PIVOTS = 4000;          // 单 LP 主元上限（防退化循环）

// ── 2026-10-05 优化开关（仅供 test/rootbound-parity.mjs 做等价性校验）──
//
// 为什么要留这个开关：下面三处优化（「组合枚举提到循环外」/「预拼行」/
// 「Phase I 快照复用」）理论上**只改何时算、不改算什么**，但根界变松只会让域变大、
// 仍报 proven ⇒ 若快照复用写错半行，**现有测试可能照样全绿而结果已不可信**。
// ⇒ 必须有一条「关掉全部优化」的参照路径，逐位比对输出。
//
// 用法：ROOTBOUND_NO_OPT=1 时全部退回原始的重复计算路径。
// ⚠ 这是测试专用开关，**不得**在生产路径设置（会退回 6 倍慢）。
const NO_OPT = process.env.ROOTBOUND_NO_OPT === '1';
const COEF_FLOOR = 1e-300;        // 系数下溢：|c| 更小视为 0（ln 会炸）
const BOUND_CEILING = 1e300;      // 超过这个量级就不叫「盒」了，直接判 unbounded
const LP_TOL = 1e-9;

function fail(type, msg, extra) {
  const e = new Error(msg);
  e.type = type;
  Object.assign(e, extra || {});
  return e;
}

function allCols(W) {
  const out = new Array(W);
  for (let j = 0; j < W; j++) out[j] = j;
  return out;
}

// ── 极小 LP：max cᵀv  s.t. A v ≤ b（v 自由）──────────────────────────

/**
 * 两阶段单纯形。v 自由 ⇒ 拆 v = p − q（p,q ≥ 0）。
 * 返回 { status: 'optimal'|'infeasible'|'unbounded', obj, x }。
 *
 * 行构造（**别改**，这里踩过两次）：
 *   约束 Av ≤ b 先写成 Av + s = b（s ≥ 0 松弛）。若 b < 0，初始松弛是负的，
 *   于是把整行乘 −1：−Av − s = −b，再补人工变量 art：−Av − s + art = −b。
 *   ⇒ b<0 时 **结构系数和松弛系数要一起翻号**。
 *   ⚠ 第一版只翻结构系数、漏了松弛 ⇒ 约束 sneak 成「Av ≥ b」：
 *     max v s.t. −v ≤ −3（= v ≥ 3，无界）被算成 obj=3；
 *     max v s.t. v ≤ −3（不可行）被算成 obj=−3。两例都静默错、不报任何错。
 */
function lpMax(c, A, b, reuse, sink) {
  const m = A.length;
  if (!m) return { status: 'infeasible', obj: 0, x: null };
  const n = A[0] ? A[0].length : 0;
  if (!n) return { status: 'optimal', obj: 0, x: [] };

  const NV = 2 * n;            // p: 0..n-1, q: n..2n-1
  const NA = m;
  const RHS = NV + m + NA;     // 最后一列存 rhs
  const W = RHS + 1;

  // ── 2026-10-05 复用路径（性能，不改数学）───────────────────────────────
  // 实测 CPU profile：rootbound.js 占服务端 **89.7%**，其中 pivot 21.7%。
  // 原因：dirBounds(k, rows, n) 对**同一组 rows** 调 2 次 lpMax（up/dn），
  // 而 n 个变量 ⇒ 同一个 rows 的「建表 + Phase I（可行性）」被算了 **2n 次**。
  //   n=6 ⇒ 12 次，其中 11 次的结果被完全丢弃。
  // 而 Phase I 只依赖 A、b，**与目标 c 无关** ⇒ 可以只跑一次。
  //
  // 实现：reuse = { m, n, T, basis, allCols } 是 Phase I 跑完后的可行基快照。
  // ⚠ 纪律：必须**深拷贝** T —— 否则第一次 Phase II 的 pivot 会污染快照，
  //   第二次拿到的是被上一次改过的表 ⇒ 结果错且静默（正是这类 bug 最难查）。
  const T = [];
  let basis;
  if (reuse && reuse.T && reuse.basis) {
    for (let i = 0; i < m; i++) T.push(new Float64Array(reuse.T[i]));
    basis = reuse.basis.slice();
  } else {
    for (let i = 0; i < m; i++) {
      const row = new Float64Array(W);
      const flip = b[i] < 0 ? -1 : 1;
      for (let j = 0; j < n; j++) {
        if (A[i][j] !== 0) { row[j] += flip * A[i][j]; row[n + j] -= flip * A[i][j]; }
      }
      row[NV + i] = flip;           // 松弛：与整行同号
      row[RHS - NA + i] = 1;        // 人工（初值 |b_i| ≥ 0 ⇒ 初始基可行）
      row[RHS] = Math.abs(b[i]);
      T.push(row);
    }
    basis = new Array(m);
    for (let i = 0; i < m; i++) basis[i] = RHS - NA + i;   // 初始基 = 全人工
  }

  // 目标行 z 的约定（教科书版）：
  //   z[j] = 列 j 的归约成本；**z[rhs] = 当前 max 值**；入基 ⇔ z[e] > 0。
  // ⚠ 第一版符号推反 ⇒ 可行/无界**两个方向全错**且静默给假答案，所以逐条单测。
  let pivots = 0;
  const pivot = (z, r, e) => {
    const pv = T[r][e];
    for (let k = 0; k < W; k++) T[r][k] /= pv;
    T[r][e] = 1;
    for (let i = 0; i < m; i++) {
      if (i === r) continue;
      const f = T[i][e];
      if (f === 0) { T[i][e] = 0; continue; }
      for (let k = 0; k < W; k++) T[i][k] -= f * T[r][k];
      T[i][e] = 0;
    }
    const ze = z[e];
    if (ze !== 0) {
      for (let k = 0; k < RHS; k++) z[k] -= ze * T[r][k];
      z[RHS] = z[RHS] + ze * T[r][RHS];      // rhs 列与结构列符号相反，单独加回
      z[e] = 0;
    }
    basis[r] = e;
    if (++pivots > MAX_PIVOTS) throw fail('resource_limit', 'simplex pivot budget exhausted');
  };
  const eliminate = (z, cols, cbOf) => {
    for (const j of cols) {
      const cb = cbOf(j);
      if (!cb) continue;
      for (let i = 0; i < m; i++) {
        if (basis[i] !== j) continue;
        for (let k = 0; k < RHS; k++) z[k] -= cb * T[i][k];
        z[RHS] = z[RHS] + cb * T[i][RHS];
        break;
      }
    }
  };
  const chooseEnter = (z, cols) => {
    let best = -1, bv = LP_TOL;
    for (const j of cols) if (z[j] > bv) { bv = z[j]; best = j; }
    return best;
  };
  // ⚠ 比值检验的第二象限（T[i][e] < 0 且 rhs < 0）**必须收进来**：
  //   第一版漏了 ⇒「无界」被当「最优 obj=0」⇒ 根界退化成 |x| ≤ e^0 = 1 的假下界。
  const chooseRow = (e) => {
    let r = -1, rv = Infinity;
    for (let i = 0; i < m; i++) {
      const ti = T[i][e], ri = T[i][RHS];
      if (ti === 0) continue;
      if ((ti > 0 && ri < 0) || (ti < 0 && ri >= 0)) continue;
      const ratio = ri / ti;
      if (!isFinite(ratio) || ratio < 0) continue;
      if (ratio < rv - LP_TOL || (Math.abs(ratio - rv) <= LP_TOL && basis[i] < basis[r])) {
        rv = ratio; r = i;
      }
    }
    return r;
  };
  /** @returns 'ok' | 'unbounded' | false（false = 主元耗尽） */
  const drive = (z, cols, allowUnbounded) => {
    for (let guard = 0; guard <= MAX_PIVOTS; guard++) {
      const e = chooseEnter(z, cols);
      if (e < 0) return 'ok';
      const r = chooseRow(e);
      if (r < 0) return allowUnbounded ? 'unbounded' : false;
      pivot(z, r, e);
    }
    return false;
  };

  // ── Phase I：max(−Σ人工)
  //
  // 2026-10-05：只有「从零建表」时才跑。带 reuse 时表已是 Phase I 后的可行基，
  // 直接进 Phase II（标准两阶段单纯形的第二阶段就是从第一阶段的可行基启动）。
  // ⚠ 这不是近似：Phase I 的作用就是「把初始全人工基变成可行基」，
  //   既然快照里存的就是那个可行基，重跑一遍只会得到同一个基。
  //
  // 若传了 sink（调用方持有的 box），把 Phase I 后的可行基**深拷贝**进去，
  // 供同一 (A,b) 的下一个目标复用（见 dirBounds 的说明）。
  // ⚠ 必须在 Phase II 之前快照 —— Phase II 的 pivot 会就地改写 T。
  if (!reuse) {
    const zI = new Float64Array(W);
    for (let j = 0; j < W; j++) zI[j] = (j >= RHS - NA && j < RHS) ? -1 : 0;
    zI[RHS] = 0;
    eliminate(zI, allCols(W), (j) => (j >= RHS - NA && j < RHS ? -1 : null));
    if (drive(zI, allCols(W), false) !== 'ok') return { status: 'infeasible', obj: 0, x: null };
    if (zI[RHS] < -1e-7) return { status: 'infeasible', obj: 0, x: null };   // Σ人工 > 0 ⇒ 不可行
    if (sink) sink.ctx = { T: T.map((r) => new Float64Array(r)), basis: basis.slice() };
  }

  // ── Phase II：max cᵀv
  const z = new Float64Array(W);
  for (let j = 0; j < n; j++) { z[j] = c[j]; z[n + j] = -c[j]; }
  z[RHS] = 0;
  eliminate(z, allCols(W), (j) => (j < NV ? (j < n ? c[j] : -c[j - n]) : null));
  // ⚠ Phase II 的入基候选必须包含**松弛列**。
  //   第一版只放结构列（0..NV−1）⇒ 松弛的归约成本永远不被检查 ⇒
  //   「无界」被吞成 obj=3（x+y≤4,−x+y≤0,y≤2 那类还看不出来，一遇负右端就翻）。
  //   只排除人工列（否则会把人工变量重新请回基里，解就不属于原问题了）。
  const struct = [];
  for (let j = 0; j < RHS - NA; j++) struct.push(j);
  const st2 = drive(z, struct, true);
  if (st2 === 'unbounded') return { status: 'unbounded', obj: -Infinity, x: null };
  if (st2 !== 'ok') return { status: 'infeasible', obj: 0, x: null };

  const x = new Array(n).fill(0);
  for (let i = 0; i < m; i++) {
    const bj = basis[i];
    if (bj >= 0 && bj < n) x[bj] = T[i][RHS];
    else if (bj >= n && bj < 2 * n) x[bj - n] = -T[i][RHS];
  }
  return { status: 'optimal', obj: z[RHS], x };
}

// ── 单变量方向界（同一约束集上顺手出 max / min，省一半 LP）────────────

/**
 * 单变量方向界（同一约束集上顺手出 max / min，省一半 LP）
 *
 * 2026-10-05 性能修正（CPU profile：rootbound.js 占服务端 89.7%）：
 *   原实现对 (k, rows) 调 2 次**独立的** lpMax(up) + lpMax(dn)，
 *   而 n 个变量各自又要重来一遍 ⇒ 同一组 (A,b) 的建表 + Phase I 被算 **2n 次**。
 *   改法：第一次调用时把「建表 + Phase I 后」的可行基快照存进 `box`，
 *        第二次（dn）直接复用 ⇒ 建表与 Phase I 各只做 1 次。
 *   ⚠ 复用时 lpMax 会**深拷贝**快照（见 lpMax 内注释），不会污染。
 *      这是标准的「多目标共享可行基」两阶段单纯形用法，数学上等价。
 *
 * @returns {{status:'infeasible'|'unbounded'|'ok', max:number|null, min:number|null}}
 */
function dirBounds(k, rows, n, box) {
  const A = [], b = [];
  for (const rw of rows) { A.push(rw.a); b.push(rw.rhs); }

  const cUp = new Array(n).fill(0); cUp[k] = 1;
  const up = lpMax(cUp, A, b, null, NO_OPT ? null : box);
  if (up.status === 'infeasible') return { status: 'infeasible', max: null, min: null };
  const reuse = (!NO_OPT && box && box.ctx) ? box.ctx : null;
  const cDn = new Array(n).fill(0); cDn[k] = -1;
  const dn = lpMax(cDn, A, b, reuse, null);
  const status = (up.status === 'unbounded' || dn.status === 'unbounded') ? 'unbounded' : 'ok';
  return {
    status,
    max: up.status === 'unbounded' ? null : up.obj,
    min: dn.status === 'unbounded' ? null : -dn.obj
  };
}

// ── 支配对 → 约束行（行格式统一为 ⟨a,v⟩ ≤ rhs）──────────────────────────

function sub(a, b) {
  const out = new Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] - b[i];
  return out;
}

/**
 * 由支配对 (α,β) 造约束行。全部是不等式（不再有「取等行」）。
 *
 *   α 支配：⟨γ−α, v⟩ ≤ ln|c_α| − ln|c_γ|      ∀γ≠α
 *   β 支配：⟨γ−β, v⟩ ≤ ln|c_β| − ln|c_γ|      ∀γ∉{α,β}
 *   平衡带：⟨α−β, v⟩ ≤ ln|c_β| − ln|c_α| + ln(k−1)
 *
 * ⚠ 平衡带**只能朝一边**（A_α ≤ A_β + slack），不能 ± 双向展开成「相差恰好
 *   slack」：真实解处 A_α 可能远大于某个小项 A_γ，双向 + α/β 支配会让区域
 *   漏掉真实解 ⇒ 假紧界。第一版写成双向，正是这样漏的。
 */
function makeRows(exps, ln, ai, bi, terms) {
  const s = terms.length;
  const n = exps[0].length;
  const slack = Math.log(Math.max(1, s - 1));
  const rows = [];
  for (let g = 0; g < s; g++) {
    if (g === ai) continue;
    rows.push({ a: sub(exps[g], exps[ai]), rhs: ln[ai] - ln[g] });        // α 支配
  }
  for (let g = 0; g < s; g++) {
    if (g === ai || g === bi) continue;
    rows.push({ a: sub(exps[g], exps[bi]), rhs: ln[bi] - ln[g] });        // β 支配
  }
  rows.push({ a: sub(exps[ai], exps[bi]), rhs: ln[bi] - ln[ai] + slack }); // 平衡带
  return rows;
}

/**
 * 方程在变量 k 上的**全部**候选支配对（α 取遍所有单项式，β 取遍所有 ≠α 的）。
 *
 * ⚠ 不做启发式切片（纪律③）。排序只影响 LP 找到多快，不影响有效性 ——
 *   有效性来自「真实支配对必在集合里」。实测反例：x+y=3 在 x=2.618 处真实
 *   支配单项式是常数项，按 α_k 排序它排最后，切片就漏了 ⇒ 假紧界。
 */
function candidatePairs(terms, k) {
  const out = [];
  const s = terms.length;
  const kd = terms.map((m) => (m.exps ? m.exps[k] : 0));
  const order = kd.map((e, i) => i).sort((p, q) => ((kd[p] - kd[q]) || (terms[p].coef >= 0 ? -1 : 1)));
  for (let ai = 0; ai < s; ai++) {
    for (let bi = 0; bi < s; bi++) { if (ai !== bi) out.push({ ai, bi }); }
  }
  void order;
  return out;
}

/** 每个方程：{pairs, groups}；groups[i] = pairs[i] 对应的约束行 */
function buildEquationSpecs(sys) {
  const specs = [];
  for (const eq of sys.equations) {
    const terms = eq.monomials
      .filter((m) => m.coef !== 0 && Math.abs(m.coef) >= COEF_FLOOR)
      .slice(0, MAX_SUPPORT_TERMS);
    if (terms.length < 2) continue;                 // 单项式/常数方程不携带结构
    const exps = terms.map((m) => m.exps);
    const ln = terms.map((m) => Math.log(Math.abs(m.coef)));
    const pairs = candidatePairs(terms, 0);
    const groups = pairs.map((p) => makeRows(exps, ln, p.ai, p.bi, terms));
    specs.push({ pairs, groups, terms });
  }
  return specs.length ? specs : null;
}

/**
 * 组合枚举（笛卡尔积）。**超预算返回 null**（调用方必须据此判 proven=false；
 * 偷偷丢组合会让上界变小 ⇒ 那才是假紧界，宁可证不了）。
 */
function enumerateCombos(specs, cap) {
  let combos = [[]];
  for (const spec of specs) {
    const next = [];
    for (const pre of combos) {
      for (const rows of spec.groups) {
        next.push(pre.concat([rows]));
        if (next.length > cap) return null;
      }
    }
    combos = next;
    if (combos.length > cap) return null;
  }
  return combos;
}

// ── 零坐标风险（信息性，不参与 proven）────────────────────────────────

/**
 * 「令某个变量 = 0 后，某个方程是否恒等于 0」—— 恒等 0 才是真风险：
 * x*y=0 这类（代进去整个方程塌成 0）零坐标解必然存在。
 * x²=2 代进 x=0 得 −2≠0 ⇒ 没有风险（此前按 minDegrees≤0 判会把一切含常数项的
 * 方程都标成有风险，等于让 proven 永远 false，那才叫没证据）。
 */
function zeroCoordinateRisks(sys) {
  const out = [];
  const n = sys.variables.length;
  for (let i = 0; i < n; i++) {
    let risky = false;
    for (const eq of sys.equations) {
      // 把 x_i = 0 代进去：只剩「x_i 指数为 0」的项还活着；它们系数和恰为 0
      // ⇒ 整个方程恒等 0 ⇒ 零坐标解必然存在（x*y=0 那类）
      let val = 0;
      for (const m of eq.monomials) if (m.exps[i] === 0) val += m.coef;
      if (val === 0) { risky = true; break; }
    }
    out.push(risky);
  }
  return out;
}

// ── 根界主入口 ───────────────────────────────────────────────────────

/**
 * @param {string[]} equations
 * @param {string[]} [vars]
 * @returns {{
 *   proven:boolean, method:string, reason:string, truncated:boolean,
 *   halfWidths:number[], perVar:Array<{name:string,pairs:number,minAbs:number,maxAbs:number}>
 *   unbounded:string[], free:string[], zeroCoordinateRisk:boolean,
 *   zeroCoordinateIndices:boolean[], supportTermTotal:number, combos:number
 * }}
 * halfWidths[k] 是**证明过的**界：任何解都满足 |x_k| ≤ halfWidths[k]。
 * free / unbounded 里的变量对应 halfWidths = Infinity。
 */
function rootBounds(equations, vars) {
  const sys = P.parseSystem(equations, vars);
  const V = sys.variables;
  const n = V.length;

  const zIdx = zeroCoordinateRisks(sys);
  const zeroCoordinateRisk = zIdx.some((x) => x);

  const specs = buildEquationSpecs(sys);
  const perVar = [];
  const unbounded = [];
  const free = [];
  let truncated = false;
  let maxCombos = 0;

  // 没有方程携带结构（全是单项式/常数）：整块报「证不了」，绝不硬造 0 界
  if (!specs) {
    const half = new Array(n).fill(Infinity);
    return {
      proven: false, method: 'tropical_log_space', truncated: false,
      reason: 'no equation carries a cancellation structure (monomial/constant only)',
      halfWidths: half,
      perVar: V.map((nm) => ({ name: nm, pairs: 0, minAbs: null, maxAbs: null })),
      unbounded: [], free: V.slice(),
      zeroCoordinateRisk, zeroCoordinateIndices: zIdx,
      supportTermTotal: sys.equations.reduce((s, p) => s + p.monomials.length, 0),
      combos: 0
    };
  }

  // 计时器在【变量循环之外】起：预算是「整次 rootBounds 的墙钟」，
  // 不是「每个变量各一份」。n 个变量串行累加，per-variable 计时会漏算 n−1 倍。
  const tAll = Date.now();

  // ── 2026-10-05 性能修正（CPU profile 实测）────────────────────────────
  //
  // 实测（同进程 profile，300 道 2~6 元线性/多项式题）：
  //   rootbound.js 占 **89.7%** 的 CPU（lpMax 47.5% + pivot 21.7%
  //   + enumerateCombos 13.8%），而内核 solve 只占 3.0%。
  //   ⇒ 真正的瓶颈不是求解器，是「求根的界」。用户要的「极致计算」，
  //     90% 的算力花在一个**优化**（收紧域）上，不是计算本身。
  //
  // 本次修正两处**纯粹是重复劳动**的浪费（不改变任何数学输出）：
  //
  //   ❶ 原实现在 `for (k)` 变量循环**内**调用 enumerateCombos(specs, …)，
  //      而组合枚举只依赖 specs（= 方程结构），**与变量 k 完全无关**
  //      ⇒ 同一个笛卡尔积被算了 n 遍（n≤6 ⇒ 白白最多 6 倍）。
  //      改法：提到循环外，只算一次。
  //
  //   ❷ 原实现在每个 combo 上 `const rows = []` 重新拼数组。
  //      combo 的内容只依赖 (specs, 组选择)，也与 k 无关。
  //      改法：提到循环外预拼一次，n 个变量共用。
  //
  // ⚠ 纪律：这两处只改**何时算**，不改**算什么**。
  //   enumerateCombos 超预算 ⇒ truncated ⇒ proven=false 的降级路径，
  //   仍在循环外**一次**判定，语义与原来「每个 k 都判一次」完全一致
  //   （原来每次判的结果必然相同，因为输入相同）。
  const combosAll = enumerateCombos(specs, MAX_COMBOS);
  if (!combosAll) {
    // 组合爆炸 ⇒ 整体降级：halfWidths 一律 Infinity，绝不给「没证完的界」。
    const halfInf = new Array(n).fill(Infinity);
    return {
      proven: false, method: 'tropical_log_space', truncated: true,
      reason: 'candidate combination budget exceeded → refusing to claim a bound',
      halfWidths: halfInf,
      perVar: V.map((nm) => ({ name: nm, pairs: 0, minAbs: null, maxAbs: null })),
      unbounded: [], free: V.slice(),
      zeroCoordinateRisk, zeroCoordinateIndices: zIdx,
      supportTermTotal: sys.equations.reduce((s, p) => s + p.monomials.length, 0),
      combos: 0
    };
  }
  maxCombos = combosAll.length;

  // 预拼每个 combo 的行（一次），供全部 n 个变量复用。
  const comboRows = combosAll.map((combo) => {
    const rows = [];
    for (const grp of combo) for (const r of grp) rows.push(r);
    return rows;
  });

  for (let k = 0; k < n; k++) {
    let bestMaxAbs = null;     // 最松的 e^{U}（取 max = 最坏组合）
    let bestMinAbs = null;
    let combosTried = 0;
    let anyOk = false;

    // —— 时间闸门（2026-10-04 新增）——
    // 实测（MAX_COMBOS=50000）：6 元稠密题 14112 combos 需 **6584ms**，
    // 而整个求解只要 ~40ms —— 根界成了**唯一的时间黑洞**，比它要优化的对象还贵 100 倍。
    // 根界是**优化**（收紧域 ⇒ 少切盒），不是**正确性前提**。
    // ⇒ 超过预算就停手，走与超 combos 完全相同的降级路径：truncated ⇒ proven=false。
    //   纪律一致：宁可不给界，不给算了一半的界。
    for (let ci = 0; ci < comboRows.length; ci++) {
      if (Date.now() - tAll > MAX_MS) { truncated = true; break; }
      combosTried++;
      const rows = comboRows[ci];
      // ⚠ box 每次调用**新建**，绝不能跨变量/跨 combo 复用 ——
      //   快照对应的是这一组 (A,b) 的可行基；换一组约束就是另一个单纯形问题。
      //   复用错的对象会拿到别人的基 ⇒ 结果错且静默（这正是最危险的一类 bug）。
      const d = dirBounds(k, rows, n, {});
      if (d.status === 'infeasible') continue;
      if (d.status === 'unbounded') continue;           // 该组合仍无界 ⇒ 换组合
      anyOk = true;
      // ⚠ 这里取 max（最坏组合），不是 min（纪律②）
      if (d.max !== null) {
        const w = Math.exp(d.max);
        if (isFinite(w) && w > 0 && w < BOUND_CEILING && (bestMaxAbs === null || w > bestMaxAbs)) bestMaxAbs = w;
      }
      if (d.min !== null) {
        const w = Math.exp(-d.min);
        if (isFinite(w) && w > 0 && w < BOUND_CEILING && (bestMinAbs === null || w > bestMinAbs)) bestMinAbs = w;
      }
    }
    if (truncated) break;   // 时间闸门触发 ⇒ 整体降级（与 combos 超限同处置）

    const name = V[k];
    if (!anyOk) { free.push(name); perVar.push({ name, pairs: combosTried, minAbs: null, maxAbs: null }); continue; }
    const maxAbs = Math.max(bestMaxAbs || 0, bestMinAbs || 0);
    perVar.push({ name, pairs: combosTried, minAbs: bestMinAbs, maxAbs: bestMaxAbs, halfWidth: maxAbs });
    if (!isFinite(maxAbs) || maxAbs <= 0) unbounded.push(name);
  }

  // ⚠ 截断时 halfWidths **一律给 Infinity**，绝不返回「没证完但算出来了」的界。
  //   那类界很可能是假紧的（漏掉的组合才是真实解所在的区域），一旦被当成证明用，
  //   downstream 的 completeness 就会谎称「找全了」。算出来的值只在
  //   probeHalfWidths 里留作诊断，名字里带 unproven，谁都别当证据用。
  const probeHalfWidths = truncated
    ? perVar.map((p) => (p.halfWidth !== undefined && isFinite(p.halfWidth) ? p.halfWidth : Infinity))
    : null;
  const halfWidths = truncated
    ? new Array(n).fill(Infinity)
    : perVar.map((p) => (p.halfWidth !== undefined && isFinite(p.halfWidth) ? p.halfWidth : Infinity));

  const proven = !truncated && halfWidths.every((w) => isFinite(w));

  return {
    proven,
    method: 'tropical_log_space',
    truncated,
    probeHalfWidths,
    reason: truncated ? 'candidate combination budget exceeded → refusing to claim a bound'
      : (proven ? 'every variable bounded by log-space tropical balance inequalities'
        : (unbounded.length ? 'unbounded along some variable (positive-dimensional family or root at infinity)'
          : 'variable constrained by no equation bounding its magnitude')),
    halfWidths,
    perVar,
    unbounded, free,
    zeroCoordinateRisk,
    zeroCoordinateIndices: zIdx,
    supportTermTotal: sys.equations.reduce((s, p) => s + p.monomials.length, 0),
    combos: maxCombos
  };
}

module.exports = { rootBounds, lpMax, dirBounds, _internals: { makeRows, candidatePairs, enumerateCombos } };
