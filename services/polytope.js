/**
 * 凸多胞形引擎 —— 把「几何体积」变成「代数解数」的地基（任务 #81）。
 *
 * 为什么单独一层（不塞进 services/geometry/）：
 *   geometry/ 里的 op 是**闭式解**：给点/线/圆，一步算出数，失败模式只有两种
 *   （算错 / 输入退化）。这里不是 —— 这里要的是**组合结构**（凸包的面格、
 *   Minkowski 和、混合体积），失败模式多一种且最危险：**组合爆炸**。
 *   混进闭式解层会把「算错」和「跑到天荒地老」混成一类，护栏就没法分开定。
 *
 * ── 为什么体积必须精确（BigInt + Bareiss）───────────────────────────
 *   本模块的唯一用途是给 BKK 定理供一个数：**混合体积 = 方程组在 (C*)^n 中的
 *   孤立解数上界**。格多胞形的混合体积**必为整数**（这是定理，不是经验）。
 *   这条性质是整个模块最强的自检 —— 混合体积只要算错，整数性几乎必然被破坏，
 *   而且是「差很远」那种破坏，不是末位抖动。
 *
 *   但如果体积用浮点算，整数性会被 1e-10 级误差抹平，自检就退化成
 *   「它离整数很近，所以我猜它是整数」—— 那是自欺，不是验证。
 *   所以：坐标全为整数时，行列式一律走 BigInt + Bareiss 分数无关消去
 *   （全程整数除法，不产生一个舍入误差）。
 *
 * ── 归一化体积（normalized volume）──────────────────────────────────
 *   内部一律用 nvol(P) := dim! · vol(P)，不用 vol(P)。
 *   理由：格多胞形的 nvol 是**整数**，vol 是有理数（要除以 dim!）。
 *   锥分解、包含-排除、混合体积整条链路都停在整数域，只在**最后一步**才转
 *   Number 给用户看。这样「整数自检」是硬断言，不是浮点近似。
 *
 * ── 凸包算法：beneath-beyond（增量 + 单纯形面枚举）──────────────────
 *   选它而不是 quickhull / gift wrapping，因为混合体积要的是**面**（锥分解
 *   按面拆），而 beneath-beyond 天然产出面格。
 *
 *   一个关键简化：**不做共面合并**。教科书版会把新生成的共面小面并成一个
 *   大面；这里保留单纯形分解。正确性不丢：
 *     · 一个几何面被拆成若干共面小面时，新点在它外侧 ⇒ 在**所有**小面外侧
 *       ⇒ 全部被删，一个不漏；
 *     · 位于几何面内部的小面边（ridge）被两个可见小面共享 ⇒ 计数为 2 ⇒
 *       正确地**不**进入地平线；只有几何面边界上的 ridge 计数为 1 ⇒ 进地平线。
 *   也就是说不合并反而让「地平线」判定变成纯计数，少一整类边界 bug。
 *
 *   另一个关键简化：**新面定向用旧包的顶点重心**。教科书版要维护 ridge→
 *   相邻面的映射来找内侧参考点。这里直接取「加入 p 之前」的顶点集重心：
 *   p 在旧包外，旧包整个落在新面内侧，重心是旧包的内点，必在新面内侧。
 *   严格不等（旧包满维，不可能整块躺在一个超平面上），不会取等。
 *   代价：少维护一张映射表；收益：少一处「取等」的隐性退化。
 */
'use strict';

const EPS = 1e-9;

// ── 规模闸（全部 fail-closed：超闸就报错，绝不静默给个错数）─────────────
const MAX_DIM = 8;              // 维数上限（产品硬约束是 6，这里留 2 维余量）
const MAX_POINTS = 20000;       // 单个输入点集去重后的上限
const MAX_MINK_POINTS = 400000; // 一次成对 Minkowski 和产出的点数上限
const MAX_VERTICES = 40000;     // 单个凸包的面片数上限
const MAX_HULL_WORK = 4e7;      // 单个凸包主循环的「点 × 面」工作量上限
// 实测标定（d=6、6 变量稠密二次：work 430377 → 2915ms；d=5 fewnomial：
// work 228722 → 432ms）。每个 work 单位在**高维更贵**（面片有 d 个顶点），
// 所以预算按维数摊：max = BASE / d。这样 d≤5 的常规系统都能算出来，
// 6 变量的重例子在 ~0.5s 内早退，交给 Bézout 兜底。
const MV_WORK_BASE = 2e6;       // 一次 mixedVolume 跨全部 2^n 个包共享的工作量预算
const MV_SUM_PROBE_STOP = 60000;// 预检求和的提前终止阈（反正已经知道要超闸）
// 预检规模闸：Minkowski 和的点数上界。按维数递减，因为「同样点数，维数越高
// 凸包越贵」（实测：6 维 729 点 → 16s；5 维 243 点 → 429ms；4 维 81 点 → 39ms）。
// 超闸 = BKK 这条界拿不到，调用方退回 Bézout，**不是**算出个错数。
const MV_SUM_CAP = { 2: 60000, 3: 20000, 4: 5000, 5: 1200, 6: 400, 7: 200, 8: 100 };

function fail(type, msg, extra) {
  const e = new Error(msg);
  e.type = type;
  Object.assign(e, extra || {});
  return e;
}

// ── 精确整数行列式：Bareiss 分数无关消去 ──────────────────────────────
/**
 * 为什么是 Bareiss 而不是普通高斯消元：
 *   高斯消元要除法，整数矩阵立刻变浮点，精确性当场丢失。Bareiss 的每一步
 *   除法都是**整除**（a[i][j]*pivot - a[i][k]*a[k][j]) / prev，代数上恒等于
 *   一个余子式），全程停在整数域，最后一步就是行列式本身。
 * 输入必须是整数矩阵（调用方保证）。
 */
function detBig(mat) {
  const n = mat.length;
  if (n === 0) return 1n;
  for (let i = 0; i < n; i++) {
    if (!mat[i] || mat[i].length !== n) throw fail('internal_error', 'detBig needs a square matrix');
  }
  // 允许调用方直接传 BigInt（gramDetBig 构造的 Gram 矩阵就是 BigInt 的）
  const toB = (v) => (typeof v === 'bigint' ? v : BigInt(Math.round(v)));
  const A = mat.map((row) => row.map(toB));
  let sign = 1n;
  let prev = 1n;
  for (let k = 0; k < n - 1; k++) {
    if (A[k][k] === 0n) {
      let swap = -1;
      for (let i = k + 1; i < n; i++) if (A[i][k] !== 0n) { swap = i; break; }
      if (swap < 0) return 0n;
      const t = A[k]; A[k] = A[swap]; A[swap] = t;
      sign = -sign;
    }
    const pivot = A[k][k];
    for (let i = k + 1; i < n; i++) {
      const aik = A[i][k];
      for (let j = k + 1; j < n; j++) {
        A[i][j] = (A[i][j] * pivot - aik * A[k][j]) / prev;
      }
    }
    prev = pivot;
  }
  return sign * A[n - 1][n - 1];
}

/** 浮点行列式（部分选主元高斯消元）—— 仅当坐标非整数时走这条路 */
function detNum(mat) {
  const n = mat.length;
  if (n === 0) return 1;
  const A = mat.map((r) => r.slice());
  let det = 1;
  for (let k = 0; k < n; k++) {
    let piv = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(A[i][k]) > Math.abs(A[piv][k])) piv = i;
    if (Math.abs(A[piv][k]) < EPS) return 0;
    if (piv !== k) { const t = A[k]; A[k] = A[piv]; A[piv] = t; det = -det; }
    det *= A[k][k];
    for (let i = k + 1; i < n; i++) {
      const f = A[i][k] / A[k][k];
      for (let j = k + 1; j < n; j++) A[i][j] -= f * A[k][j];
    }
  }
  return det;
}

/** BigInt → Number，越界直接抛（宁可报错，不可静默丢精度） */
function toNum(b) {
  const v = Number(b);
  if (!Number.isFinite(v) || Math.abs(v) > Number.MAX_SAFE_INTEGER) {
    throw fail('out_of_range',
      'polytope coordinates are too large for exact integer orientation tests; '
      + 'refuse to guess. Reduce exponents or dimension.');
  }
  return v;
}

/**
 * 广义叉积：给 d-1 个 d 维向量，返回一个与它们全部正交的非零向量。
 * n_j = (-1)^j · det(删去第 j 列的余子式)。
 * 正确性：Σ_j (-1)^j r_ij det(M_j) 正是「以 r_i 为第一行、其余向量为后续行」
 * 的行列式按第一行展开 —— 有两行相同 ⇒ 恒为 0 ⇒ 正交。
 */
function orthoBig(rows, d) {
  const out = [];
  for (let j = 0; j < d; j++) {
    const minor = rows.map((r) => {
      const row = [];
      for (let k = 0; k < d; k++) if (k !== j) row.push(BigInt(Math.round(r[k])));
      return row;
    });
    let v = detBig(minor);
    if (j % 2 === 1) v = -v;
    out.push(v);
  }
  return out;
}

function orthoNum(rows, d) {
  const out = [];
  for (let j = 0; j < d; j++) {
    const minor = rows.map((r) => {
      const row = [];
      for (let k = 0; k < d; k++) if (k !== j) row.push(r[k]);
      return row;
    });
    let v = detNum(minor);
    if (j % 2 === 1) v = -v;
    out.push(v);
  }
  return out;
}

// ── 小工具 ──────────────────────────────────────────────────────────

const sub = (a, b) => a.map((x, i) => x - b[i]);
const addP = (a, b) => a.map((x, i) => x + b[i]);
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

function keyOf(p) {
  return p.map((x) => {
    const v = Math.round(x * 1e9) / 1e9;
    return (v === 0 ? '0' : String(v));
  }).join('|');
}

function dedupe(pts) {
  const seen = new Set();
  const out = [];
  for (const p of pts) {
    const k = keyOf(p);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/** 坐标是否全为整数（且量级可控） */
function allInteger(pts) {
  for (const p of pts) {
    for (const x of p) {
      if (!Number.isFinite(x) || Math.abs(x) > 1e9) return false;
      if (x !== Math.round(x)) return false;
    }
  }
  return true;
}

/** Gram 行列式 > 0 ⇔ 向量组线性无关（整数输入 ⇒ 精确判定，零容错） */
function gramDetBig(vecs) {
  const k = vecs.length;
  if (k === 0) return 1n;
  const G = [];
  for (let i = 0; i < k; i++) {
    const row = [];
    for (let j = 0; j < k; j++) {
      let s = 0n;
      for (let t = 0; t < vecs[i].length; t++) s += BigInt(Math.round(vecs[i][t])) * BigInt(Math.round(vecs[j][t]));
      row.push(s);
    }
    G.push(row);
  }
  return detBig(G);
}

/**
 * 仿射基：贪心挑出极多个仿射无关的点。
 * 返回 { indices, rank }，rank = 点集的仿射维数。
 */
function affineBasis(pts, d) {
  const chosen = [0];
  const rows = [];
  for (let i = 1; i < pts.length && rows.length < d; i++) {
    const cand = rows.concat([sub(pts[i], pts[0])]);
    if (gramDetBig(cand) !== 0n) { rows.push(cand[cand.length - 1]); chosen.push(i); }
  }
  return { indices: chosen, rank: rows.length };
}

function centroid(pts) {
  const d = pts[0].length;
  const c = new Array(d).fill(0);
  for (const p of pts) for (let i = 0; i < d; i++) c[i] += p[i];
  return c.map((x) => x / pts.length);
}

// ── 凸包核心 ────────────────────────────────────────────────────────
/**
 * @param pts 已校验 + 去重的点数组（全部 d 维）
 * @param d   维数（d >= 2）
 * @param arith { ortho, det, integer }
 */
function hullCore(pts, d, arith, work) {
  const base = affineBasis(pts, d);
  if (base.rank < d) return null;   // 非满维：调用方改走投影路径

  let V = base.indices.map((i) => pts[i].slice());
  const F = [];

  /** 由 d 个顶点的下标造一个面；inside 是任一严格内点，用来定向 */
  function makeFacet(vs, inside) {
    const b0 = V[vs[0]];
    const rows = vs.slice(1).map((i) => sub(V[i], b0));
    let n = arith.ortho(rows, d).map((x) => (arith.integer ? toNum(x) : x));
    let nn = Math.sqrt(dot(n, n));
    if (!(nn > EPS)) return null;                 // 退化小面（p 落在 ridge 的仿射包里）⇒ 不建
    n = n.map((x) => x / nn);                     // 单位化：让「外侧」判定有统一量纲
    let c = dot(n, b0);
    if (dot(n, inside) > c) { n = n.map((x) => -x); c = -c; }
    return { v: vs.slice(), n, c };
  }

  const inside0 = centroid(V);
  for (let omit = 0; omit <= d; omit++) {
    const vs = [];
    for (let i = 0; i <= d; i++) if (i !== omit) vs.push(i);
    const f = makeFacet(vs, inside0);
    if (f) F.push(f);
  }
  if (F.length !== d + 1) return null;            // 初始单纯形退化（理论上不该发生）

  const used = new Set(base.indices);
  for (let pi = 0; pi < pts.length; pi++) {
    if (used.has(pi)) continue;
    const p = pts[pi];

    // 共享预算：一次 mixedVolume 要跑 2^n 个包，闸必须跨包累计，
    // 否则每个包都在闸内、合起来照样跑爆（实测：稀疏 6 变量 64 个包，
    // 单独看每个都不超闸，总耗时直接把 120s 超时打穿）。
    // 记账放在**可见性扫描之前**：扫描每个点都要走一遍全部面片，
    // 这才是真正的成本项；只在「点可见」时记账会严重低估，闸形同虚设。
    if (work) {
      work.used += F.length;
      if (work.used > work.max) {
        throw fail('resource_limit',
          `convex hull budget exhausted (${work.used} > ${work.max}); BKK bound not available for this system`);
      }
    }

    // 可见面：点在面外侧（整数情形 dot 与 c 都是整数，EPS 足够安全）
    const vis = [];
    for (let fi = 0; fi < F.length; fi++) {
      const f = F[fi];
      if (dot(f.n, p) > f.c + EPS) vis.push(fi);
    }
    if (!vis.length) continue;                    // 在包内 ⇒ 不是顶点，跳过

    if (vis.length * pts.length > MAX_HULL_WORK) {
      throw fail('resource_limit', `convex hull work exceeded (${vis.length} facets x ${pts.length} points)`);
    }

    // 地平线 ridge：只被**一个**可见面包含的 (d-2) 面
    const ridgeCount = new Map();
    for (const fi of vis) {
      const vs = F[fi].v;
      for (let k = 0; k < vs.length; k++) {
        const ridge = vs.slice(0, k).concat(vs.slice(k + 1));
        ridge.sort((a, b) => a - b);
        const key = ridge.join(',');
        ridgeCount.set(key, (ridgeCount.get(key) || 0) + 1);
      }
    }

    const insideOld = centroid(V);   // 注意：加 p 之前的重心，必在新面内侧
    const newIdx = V.length;
    V.push(p.slice());

    const visSet = new Set(vis);
    const kept = [];
    for (let fi = 0; fi < F.length; fi++) if (!visSet.has(fi)) kept.push(F[fi]);
    F.length = 0;
    for (const f of kept) F.push(f);

    for (const [key, cnt] of ridgeCount) {
      if (cnt !== 1) continue;
      const ridge = key.split(',').map(Number);
      const f = makeFacet(ridge.concat([newIdx]), insideOld);
      if (f) F.push(f);
    }
    if (V.length > MAX_VERTICES || F.length > MAX_VERTICES) {
      throw fail('resource_limit', `convex hull grew past ${MAX_VERTICES} vertices/facets`);
    }
  }

  return { V, F };
}

/**
 * 归一化体积 nvol = d! · vol，按**顶点扇形三角化**求和：
 *   nvol = Σ_{面 F 不含 v0} |det[ v_i - v0 ]_{v_i ∈ F}|
 *
 * ⚠ 为什么锥顶必须取**顶点 v0** 而不是重心（真 bug 记录）：
 *   第一版取的是顶点集重心。重心一般不是格点（如 4 维单纯形的重心是 (0.6,...)），
 *   于是 det 的输入出现非整数，而 detBig 里 BigInt(Math.round(v)) 会把
 *   -0.6 截成 -1、2.4 截成 2 —— 单个面的「体积」当场失真。实测 3·Δ₄：
 *   真值 nvol = 3^4 = 81，重心版给出 **135**，且不报错、看着像个合理整数 ——
 *   这正是最难发现的一类错。
 *   取顶点 v0 做锥顶：① 差向量 v_i - v0 全是整数，行列式全程精确；
 *   ② 「不含 v0 的面 + v0」本来就是凸多胞形的标准扇形三角化，不会漏也不会重。
 */
function coneVolume(V, F, d, arith) {
  const ref = V[0];
  let total = arith.integer ? 0n : 0;
  for (const f of F) {
    if (f.v.indexOf(0) >= 0) continue;   // 与锥顶关联的面 ⇒ 锥退化，体积贡献 0
    const rows = f.v.map((i) => sub(V[i], ref));   // d 行 d 列，元素全整数
    const det = arith.integer ? detBig(rows) : detNum(rows);
    const abs = arith.integer ? (det < 0n ? -det : det) : Math.abs(det);
    total = arith.integer ? total + abs : total + abs;
  }
  return total;
}

function factorial(n) {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

// ══════════════════════════════════════════════════════════════════════
//  顶点还原：从增量法的单纯形面片里取回**真正的顶点集**
//
// ⚠ 为什么必须做（实测数据，不是推测）：
//   增量法把「曾经在包外」的点全部留在 V 里，但一个点被加进来之后，
//   后面加入的点可能把它变成内部点 / 边内点。实测 [0,2]^3×[0,1]^3 的
//   全部格点（216 个点，真顶点只有 64 个）：不还原就报 **216 个顶点**。
//   冗余顶点会进 Minkowski 和，逐级相乘直接把规模闸顶爆。
//
//   判据（法锥）：v 是顶点 ⟺ 所有含 v 的面的**法向量**张成 R^d。
//   若 v 落在某个 j 维面的内部，则它只躺在那 d-j 张面平面上，
//   法向的秩 ≤ d-j < d ⇒ 判掉。真顶点处法锥满维 ⇒ 秩恰为 d。
//   ⚠ 别用「与 v 共面的点张成 R^d」当判据：三角剖分里有大量跨面对角线，
//     面上的内点照样能凑满秩 —— 实测 2·Δ₅ 的 21 个格点一个都判不掉。
//   信息不足 / 法向算不出来时一律**保守保留** —— 多留一个点只是慢一点，
//   漏掉真顶点会让 Minkowski 和缺角，体积当场算错。
// ══════════════════════════════════════════════════════════════════════

/** 整数向量组的线性秩（贪心 + 精确整数 Gram 行列式，零浮点） */
function linearRankBig(vecs) {
  const rows = [];
  for (const v of vecs) {
    const cand = rows.concat([v]);
    if (gramDetBig(cand) !== 0n) rows.push(v);
  }
  return rows.length;
}

function gcdInt(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { const t = a % b; a = b; b = t; } return a; }
function gcdArr(arr) {
  let g = 0;
  for (const x of arr) { g = gcdInt(g, x); if (g === 1) break; }
  return g || 1;
}

/**
 * 从 { V, F }（F 是单纯形面片，f.v 为 V 的下标）还原真正的顶点下标集合。
 * 判据是法锥满维（见上），全部在整数域里做，判不了就保守全留。
 * @returns {number[]} 升序
 */
function trueVertices(V, F, d) {
  const seen = new Set();
  for (const f of F) for (const v of f.v) seen.add(v);
  const all = [...seen].sort((a, b) => a - b);
  if (d <= 1) return all;

  let ok = allInteger(V);
  const normals = new Array(F.length).fill(null);
  for (let i = 0; ok && i < F.length; i++) {
    const vs = F[i].v;
    let n;
    try {
      n = orthoBig(vs.slice(1).map((j) => sub(V[j], V[vs[0]])), d).map(toNum);
    } catch (e) { ok = false; break; }
    const g = gcdArr(n);
    if (g > 1) n = n.map((x) => x / g);
    for (const x of n) if (!Number.isFinite(x) || Math.abs(x) > 1e13) { ok = false; break; }
    if (!ok) break;
    normals[i] = n;
  }
  if (!ok) return all;                       // 非整数坐标 / 量级超限 ⇒ 保守全留

  const byVert = new Map();
  for (let i = 0; i < F.length; i++) {
    for (const v of F[i].v) {
      let arr = byVert.get(v);
      if (!arr) { arr = []; byVert.set(v, arr); }
      arr.push(normals[i]);
    }
  }
  const out = [];
  for (const v of all) {
    const ns = byVert.get(v);
    if (!ns || ns.length < d) out.push(v);   // 面片信息不足 ⇒ 保守保留
    else if (linearRankBig(ns) >= d) out.push(v);
  }
  return out;
}
/**
 * 凸包主入口。
 * @param {number[][]} points
 * @param {number} dim
 * @param {{work?: {used:number, max:number}}} [opts] 共享工作量预算（mixedVolume 用）
 * @returns { dim, vertices, facets, rank, volume, normalizedVolume, exact, degenerate }
 */
function convexHull(points, dim, opts) {
  if (!Array.isArray(points) || points.length === 0) {
    throw fail('invalid_input', 'points must be a non-empty array of coordinate arrays');
  }
  const d = Number(dim);
  if (!Number.isInteger(d) || d < 0 || d > MAX_DIM) {
    throw fail('invalid_input', `dimension must be an integer in 0..${MAX_DIM}, got ${JSON.stringify(dim)}`);
  }
  const clean = [];
  for (const p of points) {
    if (!Array.isArray(p) || p.length !== d) {
      throw fail('invalid_input', `every point must have exactly ${d} coordinate(s)`);
    }
    for (const x of p) if (typeof x !== 'number' || !Number.isFinite(x)) {
      throw fail('invalid_input', 'coordinates must be finite numbers');
    }
    clean.push(p.slice());
  }
  const pts = dedupe(clean);
  if (pts.length > MAX_POINTS) {
    throw fail('resource_limit', `too many points: ${pts.length} > ${MAX_POINTS}`);
  }

  // dim 0 / 1 单独处理：广义叉积在这两维没有意义（0 行向量组）
  if (d === 0) {
    return { dim: 0, vertices: [pts[0].slice()], facets: [], rank: 0, volume: 0, normalizedVolume: 0, exact: true, degenerate: null };
  }
  if (d === 1) {
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) { if (p[0] < lo) lo = p[0]; if (p[0] > hi) hi = p[0]; }
    const span = hi - lo;
    const verts = (hi - lo <= EPS) ? [[lo]] : [[lo], [hi]];
    const facets = (hi - lo <= EPS)
      ? [{ v: [0], n: [1], c: lo }]
      : [{ v: [0], n: [-1], c: -lo }, { v: [1], n: [1], c: hi }];
    return {
      dim: 1, vertices: verts, facets, rank: (hi - lo <= EPS ? 0 : 1),
      volume: span, normalizedVolume: span, exact: true,
      degenerate: (hi - lo <= EPS) ? 'not_full_dimensional' : null
    };
  }

  const integer = allInteger(pts);
  const work = (opts && opts.work) || null;

  const arith = integer
    ? { ortho: orthoBig, det: detBig, integer: true }
    : { ortho: orthoNum, det: detNum, integer: false };

  let core = null;
  try {
    core = hullCore(pts, d, arith, work);
  } catch (e) {
    if (e && e.type === 'out_of_range' && integer) {
      // 整数量级超出精确判定范围 ⇒ 退化到浮点，但**明确标记 exact:false**，
      // 绝不假装还是精确的（整数自检在 exact:false 时不再作为硬断言）
      const fa = { ortho: orthoNum, det: detNum, integer: false };
      core = hullCore(pts, d, fa, work);
      return pack(core, d, fa, false, pts);
    }
    throw e;
  }

  if (core) return pack(core, d, arith, integer, pts);

  // ── 非满维：投影到仿射包里算，环境体积记 0（BKK 要的就是这个 0）──
  const base = affineBasis(pts, d);
  const b0 = pts[base.indices[0]];
  const dirs = base.indices.slice(1).map((i) => sub(pts[i], b0));
  const U = orthonormalize(dirs);
  const r = U.length;
  const proj = pts.map((p) => {
    const w = sub(p, b0);
    return U.map((u) => dot(u, w));
  });
  const fa = { ortho: orthoNum, det: detNum, integer: false };
  if (r <= 1) {
    // 仿射维 0 或 1：包就是一个点或一条线段，顶点直接取端点
    let lo = Infinity, hi = -Infinity, loI = 0, hiI = 0;
    for (let i = 0; i < proj.length; i++) {
      const t = r === 0 ? 0 : proj[i][0];
      if (t < lo) { lo = t; loI = i; }
      if (t > hi) { hi = t; hiI = i; }
    }
    const verts = (r === 0 || hi - lo <= EPS) ? [pts[loI].slice()] : [pts[loI].slice(), pts[hiI].slice()];
    return {
      dim: d, vertices: verts, facets: [], rank: r,
      volume: 0, normalizedVolume: 0, intrinsicVolume: (r === 1 ? hi - lo : 0),
      exact: false, degenerate: 'not_full_dimensional'
    };
  }
  const sub2 = hullCore(proj, r, fa, work);
  if (!sub2) throw fail('internal_error', 'projected hull failed');
  const verts = sub2.V.map((p) => {
    let idx = 0;
    for (let i = 0; i < proj.length; i++) {
      let same = true;
      for (let k = 0; k < r; k++) if (Math.abs(proj[i][k] - p[k]) > EPS) { same = false; break; }
      if (same) { idx = i; break; }
    }
    return pts[idx].slice();
  });
  const nvolR = coneVolume(sub2.V, sub2.F, r, fa);
  const volR = nvolR / factorial(r);
  return {
    dim: d, vertices: verts, facets: sub2.F, rank: r,
    volume: 0, normalizedVolume: 0,          // 环境维体积：真 0，不是「算不出来」
    intrinsicVolume: volR, intrinsicNormalizedVolume: nvolR,
    exact: false, degenerate: 'not_full_dimensional'
  };
}

function pack(core, d, arith, integer, pts) {
  const nvol = coneVolume(core.V, core.F, d, arith);
  const nvolNum = integer ? toNum(nvol) : nvol;
  const vi = trueVertices(core.V, core.F, d);
  return {
    dim: d,
    vertices: vi.map((i) => core.V[i].slice()),
    vertexIndices: vi,
    facets: core.F,
    facetCount: core.F.length,
    rank: d,
    volume: nvolNum / factorial(d),
    normalizedVolume: nvolNum,
    normalizedVolumeExact: integer ? nvol.toString() : null,
    exact: !!integer,
    degenerate: null
  };
}

function orthonormalize(vecs) {
  const out = [];
  for (const v of vecs) {
    let u = v.slice();
    for (const w of out) {
      const t = dot(u, w);
      u = u.map((x, i) => x - t * w[i]);
    }
    const nn = Math.sqrt(dot(u, u));
    if (!(nn > EPS)) continue;
    out.push(u.map((x) => x / nn));
  }
  return out;
}

// ── Minkowski 和 ────────────────────────────────────────────────────
/**
 * P + Q = conv({p + q})。朴素做法是 |P|·|Q| 个点再求包，逐次累加会指数爆炸，
 * 所以**每加一个就先求一次包**把顶点数压回去（凸包的 Minkowski 和 = 和的凸包，
 * 中间求包不改变最终结果，只削掉非极点）。
 */
function minkowskiSum(polys, dim, opts) {
  if (!Array.isArray(polys) || polys.length === 0) {
    throw fail('invalid_input', 'minkowskiSum needs a non-empty array of point sets');
  }
  let acc = dedupe(polys[0].map((p) => p.slice()));
  for (let i = 1; i < polys.length; i++) {
    const next = [];
    if (acc.length * polys[i].length > MAX_MINK_POINTS) {
      throw fail('resource_limit',
        `Minkowski sum would produce ${acc.length * polys[i].length} points > ${MAX_MINK_POINTS}`);
    }
    for (const a of acc) for (const b of polys[i]) next.push(addP(a, b));
    acc = convexHull(dedupe(next), dim, opts).vertices;
    if (acc.length === 0) acc = [next[0]];
  }
  return acc;
}

/**
 * 估 Minkowski 和的规模上界：逐级配对求和 + 去重，不碰凸包。
 * 一旦超过 PROBE_STOP 就提前返回（反正已经知道要超闸了）。
 */
function estimateSumSize(reduced, n) {
  let acc = reduced[0];
  let worst = acc.length;
  for (let i = 1; i < n; i++) {
    const seen = new Set();
    const next = [];
    for (const a of acc) for (const b of reduced[i]) {
      const p = a.map((x, k) => x + b[k]);
      const key = p.join(',');
      if (!seen.has(key)) { seen.add(key); next.push(p); }
    }
    acc = next;
    if (acc.length > worst) worst = acc.length;
    if (worst > MV_SUM_PROBE_STOP) return worst;
  }
  return worst;
}

// ── 混合体积（BKK 解数上界）──────────────────────────────────────────
/**
 * Bernstein–Kushnirenko–Khovanskii 定理：
 *   n 个 Laurent 多项式在 (C*)^n 中的孤立解数（计重数）≤ 混合体积 MV。
 *   泛型系数下取等。
 *
 * 计算走包含-排除：
 *   vol(λ1P1 + ... + λnPn) 是 λ 的 n 次齐次多项式，λ1λ2...λn 的系数等于
 *       Σ_{S ⊆ [n]} (-1)^{n-|S|} · vol(Σ_{i∈S} P_i)
 *   （含真子集的项在交替求和里恰好消成 (1-1)^{n-|supp|} = 0）
 *   而该系数 = n! · MV。故
 *       **MV = [ Σ_S (-1)^{n-|S|} · nvol(Σ_{i∈S} P_i) ] / n!**
 *   其中 nvol = n!·vol。分子分母都在整数域 ⇒ 结果是整数 ⇒ 整数自检成立。
 */
function mixedVolume(polys, opts) {
  if (!Array.isArray(polys) || polys.length === 0) {
    throw fail('invalid_input', 'mixedVolume needs a non-empty array of point sets');
  }
  const n = polys.length;
  if (n > MAX_DIM) throw fail('resource_limit', `mixedVolume supports at most ${MAX_DIM} polytopes, got ${n}`);
  // 预算必须**跨 2^n 个子集包共享**：单独看每个包都不超闸，合起来照样能把
  // 一次调用拖到几十秒（实测稀疏 6 变量：64 个包，打穿 120s 超时）。
  // 超预算就 resource_limit —— 调用方（bounds.js）据此把 BKK 标成 unavailable，
  // 而不是假装算出来了。
  const work = (opts && opts.work) || { used: 0, max: Math.round(MV_WORK_BASE / Math.max(1, n)) };
  for (let i = 0; i < n; i++) {
    if (!Array.isArray(polys[i]) || polys[i].length === 0) {
      throw fail('invalid_input', `polytope #${i} must be a non-empty array of points`);
    }
    for (const p of polys[i]) {
      if (!Array.isArray(p) || p.length !== n) {
        throw fail('invalid_input', `polytope #${i}: every point must have exactly ${n} coordinates (ambient dimension)`);
      }
      for (const x of p) if (typeof x !== 'number' || !Number.isFinite(x)) {
        throw fail('invalid_input', `polytope #${i}: coordinates must be finite numbers`);
      }
    }
  }
  if (n === 1) {
    // 一维特例（也是自检基准）：MV = 牛顿线段长度
    const h = convexHull(polys[0], 1);
    return {
      dim: 1,
      mixedVolume: h.normalizedVolume,
      integral: true,
      exact: true,
      rankDeficient: h.rank < 1,
      terms: [{ subset: [0], normalizedVolume: h.normalizedVolume }],
      basis: 'Bernstein–Kushnirenko–Khovanskii (n=1: MV = length of the Newton segment)'
    };
  }

  const integer = polys.every((ps) => allInteger(ps));

  // ── 先把每个输入压到它自己的顶点集 ──
  // conv(A+B) = conv(A) + conv(B)，所以格点内部的点一个都不用带进 Minkowski 和。
  // 这是整条链路上性价比最高的一步：k·Δ₆ 有 C(k+6,6) 个格点，但只有 7 个顶点。
  const reduced = polys.map((ps) => {
    const h = convexHull(ps, n, { work });
    return h.rank < n ? ps.map((p) => p.slice()) : h.vertices;
  });

  // ── 预检：先估规模，超闸就一个凸包都不跑 ──
  // 逐级求和只做去重，不求包，所以估的是真实规模的**上界**（求包只会更少）。
  // 实测：预检本身 ≤5ms，而一个 729 点的 6 维凸包要 16s、924 点要 2.9s ——
  // 早退省下的时间是四个数量级。没有这一步，超闸的例子要白白烧掉几秒才报错。
  const est = estimateSumSize(reduced, n);
  const cap = MV_SUM_CAP[n] || MV_SUM_CAP[8];
  if (est > cap) {
    throw fail('resource_limit',
      `BKK mixed volume: Minkowski sum of the ${n} Newton polytopes has ~${est} points ` +
      `> cap ${cap} for dimension ${n}; bound not available for this system`);
  }

  // 子集和 DP：sum[m] = hull(sum[m 去掉最低位] + P[该位])，共 2^n - 1 个非空子集
  const hulls = new Array(1 << n).fill(null);
  let rankDeficient = false;
  for (let m = 1; m < (1 << n); m++) {
    const low = m & (-m);
    const i = Math.round(Math.log2(low));
    const rest = m ^ low;
    let pts;
    if (rest === 0) {
      pts = reduced[i].map((p) => p.slice());
    } else {
      pts = minkowskiSum([hulls[rest].vertices, reduced[i]], n, { work });
    }
    const h = convexHull(pts, n, { work });
    hulls[m] = h;
    if (h.rank < n) rankDeficient = true;
  }

  const terms = [];
  let num = integer ? 0n : 0;
  for (let m = 1; m < (1 << n); m++) {
    const bits = [];
    for (let i = 0; i < n; i++) if (m & (1 << i)) bits.push(i);
    const sign = ((n - bits.length) % 2 === 0) ? 1 : -1;
    const nvol = hulls[m].normalizedVolume;
    const nv = integer ? BigInt(Math.round(nvol)) : nvol;
    const signed = integer ? (sign > 0 ? nv : -nv) : sign * nv;
    num = integer ? num + signed : num + signed;
    terms.push({
      subset: bits,
      normalizedVolume: integer ? toNum(nv) : nv,
      sign
    });
  }

  const fact = factorial(n);
  let mvNum;
  let integral = true;
  if (integer) {
    const f = BigInt(fact);
    if (num % f !== 0n) integral = false;
    mvNum = Number(num / f) + (num % f === 0n ? 0 : Number(num % f) / fact);
  } else {
    mvNum = num / fact;
    integral = Math.abs(mvNum - Math.round(mvNum)) < 1e-6;
    if (integral) mvNum = Math.round(mvNum);
  }

  return {
    dim: n,
    mixedVolume: mvNum,
    integral,
    exact: !!integer,
    rankDeficient,
    /** 混合体积为 0 ⇒ 定理给出「(C*)^n 中没有孤立解」，不是「算不出来」 */
    zeroMeansNoIsolatedSolution: mvNum === 0,
    terms,
    basis: 'Bernstein–Kushnirenko–Khovanskii: #isolated solutions in (C*)^n (with multiplicity) <= mixed volume'
  };
}

module.exports = {
  convexHull,
  mixedVolume,
  minkowskiSum,
  detBig,
  detNum,
  orthoBig,
  orthoNum,
  affineBasis,
  gramDetBig,
  orthonormalize,
  allInteger,
  dedupe,
  LIMITS: { MAX_DIM, MAX_POINTS, MAX_MINK_POINTS, MAX_VERTICES }
};
