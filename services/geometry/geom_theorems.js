/**
 * 经典几何定理层 —— 「定理」不是公式，是**可判定的断言**。
 *
 * ── 这一层存在的理由 ────────────────────────────────────────────────
 *   前面几层给的是「构造量」：交点、面积、体积。这一层给的是**判定量**：
 *   「这三线是否共点」「这个四边形是否共圆」「这个格点多边形里有多少个格点」。
 *   判定量才是几何真正难的那一半 —— 构造量闭式一算就对，判定量一旦退化或超预算，
 *   绝大多数几何库会**默默给一个数**（0 / false / 某个近零的交点），
 *   而那个数往往是错的。本层的每个 op 在无法判定时**必须**报 degenerate 或
 *   definitely_none，绝不返回猜测值。
 *
 * ── 三条硬口径（与 geom1/2/3 一致，这里压力最大）─────────────────────
 *   1. 退化显式：共线三点谈「外心」是**无定义**，不是「外心在无穷远」。
 *      三角形退化的判据一律用**有向面积是否为 0**，不用「长度是否接近某常数」。
 *   2. 判定类 op 必须把「算出来是否成立」和「输入是否退化」分开：
 *      cevian_concurrent({退化三角形}) ⇒ degenerate，不是 concurrent:false。
 *      「不共点」和「问错了」在几何证明里是完全不同的两件事。
 *   3. 所有闭式，无迭代。塞瓦/梅涅劳/托勒密/皮克全部是恒等式，闭式即精确。
 *
 * ── 这一层与代数求解器的接口（这就是「几何 ⇄ 代数」的桥）────────────
 *   law_of_cosines / law_of_sines / solve_triangle / regular_polygon /
 *   golden_ratio 都是**把几何条件翻译成代数约束**：
 *   已知两边夹角求第三边，就是解一个二次方程；
 *   已知两边及对角（SSA），解的个数可能是 1 也可能是 2 —— 这个「二义性」正是
 *   代数求解器最核心的那个现象，而它在几何里有个名字叫「SSA 二义」。
 *   两边说的是同一件事，这正是「融为一体」。
 *
 * ── op 命名与分层约定（踩过坑，务必照抄）────────────────────────────
 *   · 点类 op 用固定 dim（2 或 3）；纯标量 op（只吃 number）必须标 `scalar: true`，
 *     否则会被当成「dim=0 ⇒ 从点推断维度」而直接抛错 —— dim:0 在本层的含义是
 *     「任意维、靠点推断」，不是「无维度」。
 *   · layer 由 dim 推导（见 index.js），本文件不写 layer。
 *   · pole/polar 拆成两个 op 而不是一个带 mode 字符串的 op：模式字符串是
 *     LLM 最容易传错的参数之一，拆开后签名是空的，不需要它做判断。
 */
'use strict';

const V = require('./vec.js');
const { EPS } = V;

/** 判定「相对偏差」的阈值：闭式解的浮点舍入噪声量级 */
const REL = 1e-9;

/** 有向面积 ×2（三点），符号表示绕向 */
function signedArea2(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/** 三角形三边：a 边 = |BC| 对 A，b 边 = |CA| 对 B，c 边 = |AB| 对 C */
function sideLengths(a, b, c) {
  return { a: V.dist(b, c), b: V.dist(c, a), c: V.dist(a, b) };
}

/** 三角形合法性：面积 0（退化）或违反三角不等式都算不可用 */
function triState(a, b, c) {
  const ar2 = signedArea2(a, b, c);
  if (!(Math.abs(ar2) > EPS)) return { ok: false, degenerate: 'degenerate_triangle' };
  const s = sideLengths(a, b, c);
  const eps = EPS * Math.max(1, s.a, s.b, s.c);
  if (!(s.a + s.b > s.c - eps) || !(s.b + s.c > s.a - eps) || !(s.c + s.a > s.b - eps)) {
    return { ok: false, degenerate: 'degenerate_triangle' };
  }
  return { ok: true, area: Math.abs(ar2) / 2, area2: ar2, sides: s };
}

/** 外心：解 |O-a|²=|O-b|²=|O-c|²（两个线性方程）。共线返回 null */
function circumcenter(a, b, c) {
  const ar2 = signedArea2(a, b, c);
  if (!(Math.abs(ar2) > EPS)) return null;
  const bx = b[0] - a[0], by = b[1] - a[1];
  const cx = c[0] - a[0], cy = c[1] - a[1];
  const d1 = (b[0] * b[0] + b[1] * b[1]) - (a[0] * a[0] + a[1] * a[1]);
  const d2 = (c[0] * c[0] + c[1] * c[1]) - (a[0] * a[0] + a[1] * a[1]);
  const det = 2 * (bx * cy - by * cx);
  if (!(Math.abs(det) > EPS)) return null;
  return [(d1 * cy - by * d2) / det, (bx * d2 - d1 * cx) / det];
}

/** 三点定圆。共线返回 null */
function circleFrom3(a, b, c) {
  const o = circumcenter(a, b, c);
  if (!o) return null;
  return { center: o, radius: V.dist(a, o) };
}

/** 两圆关系：two / touch / separate / contained / concentric / same */
function circleCircle(c1, c2) {
  const d = V.dist(c1.center, c2.center);
  if (!(d > EPS)) {
    if (Math.abs(c1.radius - c2.radius) <= EPS) return { kind: 'same', points: [] };
    return { kind: 'concentric', points: [] };
  }
  if (d > c1.radius + c2.radius + EPS) return { kind: 'separate', points: [] };
  if (d < Math.abs(c1.radius - c2.radius) - EPS) return { kind: 'contained', points: [] };
  const a = (c1.radius * c1.radius - c2.radius * c2.radius + d * d) / (2 * d);
  const hsq = c1.radius * c1.radius - a * a;
  const h = hsq > 0 ? Math.sqrt(hsq) : 0;
  const ux = (c2.center[0] - c1.center[0]) / d;
  const uy = (c2.center[1] - c1.center[1]) / d;
  const base = [c1.center[0] + a * ux, c1.center[1] + a * uy];
  if (h <= EPS) return { kind: 'touch', points: [base] };
  return {
    kind: 'two',
    points: [[base[0] - h * uy, base[1] + h * ux], [base[0] + h * uy, base[1] - h * ux]]
  };
}

/**
 * 正三角形第三顶点（sign=+1 取 a→b 的左侧）。
 * ⚠ 系数是 √3 而不是 1：等边三角形的高是边长·√3/2，也就是中点到顶点的距离。
 * 写成 (−dy, dx)（漏掉 √3）得到的是**直角等腰**三角形 —— 形状看着差不多，
 * 但拿破仑定理立刻失效且不报错。第一版就踩了这个坑。
 */
function equilateralThird(p, q, sign) {
  const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
  const dx = (q[0] - p[0]) / 2, dy = (q[1] - p[1]) / 2;
  const k = Math.sqrt(3) * sign;
  return [mx - k * dy, my + k * dx];
}

function gcdInt(a, b) {
  let x = Math.abs(a), y = Math.abs(b);
  while (y > 0) { const t = y; y = x % y; x = t; }
  return x;
}

/** 点是否在多边形严格内部（整数格点 ⇒ 整数叉积，判据精确） */
function pointStrictlyInside(P, x, y) {
  for (let i = 0, n = P.length; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n];
    const cross = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (cross === 0 && x >= Math.min(a[0], b[0]) && x <= Math.max(a[0], b[0])
      && y >= Math.min(a[1], b[1]) && y <= Math.max(a[1], b[1])) return false;
  }
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i], b = P[j];
    if ((a[1] > y) !== (b[1] > y)) {
      const xint = (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0];
      if (x < xint) inside = !inside;
    }
  }
  return inside;
}

/** 由三边求三角（余弦定理），角用 acos 闭式 */
function anglesFromSides(a, b, c) {
  const ang = (x, y, z) => Math.acos(Math.max(-1, Math.min(1, (y * y + z * z - x * x) / (2 * y * z))));
  return { A: ang(a, b, c), B: ang(b, c, a), C: ang(c, a, b) };
}

/**
 * 三个正数能不能当三角形的三边（严格三角不等式）。
 *
 * ⚠ 判据的**分类**比判据本身重要。不能成立时有三类，必须分开报：
 *   传入的是坐标且三点共线  → degenerate_triangle（输入病态，禁止下结论）
 *   传入的是三个正数边长    → no_such_triangle  （问题合法，答案确实为空，可断言「没有」）
 * 早先把两者混用同一个码，于是 law_of_cosines(1,1,5) 报「三角形退化」，
 * 而 solve_triangle(1,1,5) 报「无此三角形」—— 同一个数学事实，
 * 两个 op 给出互相矛盾的结论。Agent 拿到哪句取决于它调了哪个函数。
 */
function sidesFormTriangle(a, b, c) {
  return (a + b > c - EPS) && (b + c > a - EPS) && (c + a > b - EPS);
}

/**
 * 长度参数的合法性判定 —— 返回退化码而不是布尔值。
 *
 * ⚠ 早期一律写 `if (!(a > EPS)) return zero_length_side`，把**负数**也报成
 *   「零长度」。Agent 拿到 zero 会去查「是不是漏传了一个 0」，
 *   而实际上它传了 −5 —— 修法完全不同。名字与事实不符比报错更贵。
 *   现在把三态分开：正 / 零 / 负。
 */
const POS = {};
function lengthCode(x) {
  if (x > EPS) return POS;
  return x < -EPS ? 'negative_length_side' : 'zero_length_side';
}
/** 全部为正则返回 null，否则返回第一个失败者的退化码 */
function lengthsOk(...xs) {
  for (const x of xs) { const c = lengthCode(x); if (c !== POS) return c; }
  return null;
}

const LETTERS = ['A', 'B', 'C'];
const SIDES = ['a', 'b', 'c'];

/**
 * 点 x 相对线段 u→v 的位置。
 *
 * ⚠ 必须同时验「参数范围」和「在直线上」。只验投影参数 k∈[0,1] 是不够的：
 *   k 是投影参数，(0.32) 对任何落在两端垂线之间的点都成立，
 *   包括完全不在该直线上的点。早期只查 k∈[0,1]，于是
 *   「把 AB 的中点当成 BC 上的分割点」会安静地算出一个比值 8/17 并
 *   报 concurrent:false —— 一个由非法输入造出来的「定理不成立」结论。
 *   塞瓦/梅涅劳/莫莱的结论都是定理，喂错点不该得到「不成立」，
 *   该得到「你点放错了」。
 *
 * 返回 {place, k}：place ∈ inside | endpoint | extension | off_line | null(退化)
 */
function whereOnSide(u, x, v) {
  const L = V.sub(v, u), LL = V.normSq(L);
  if (!(LL > EPS)) return { place: null, k: null };
  const k = V.dot(V.sub(x, u), L) / LL;
  if (k <= REL || Math.abs(k - 1) <= REL) return { place: 'endpoint', k };
  if (k < -REL || k > 1 + REL) return { place: 'extension', k };
  const perp = Math.abs(L[0] * (x[1] - u[1]) - L[1] * (x[0] - u[0])) / Math.sqrt(LL);
  if (perp > REL * Math.max(1, Math.sqrt(LL))) return { place: 'off_line', k };
  return { place: 'inside', k };
}

/**
 * 边内比值 BD/DC（无向长度）。点必须在**线段内部**：
 *   off_line / endpoint / null 都返回 null，由调用方决定报哪个退化码。
 */
function sideRatio(u, x, v) {
  const w = whereOnSide(u, x, v);
  if (w.place !== 'inside') return null;
  return w.k / (1 - w.k);
}

/** 角 A 的两条邻边是 b、c —— 用来判「已知角是不是夹角」 */
const ADJACENT = { A: ['b', 'c'], B: ['a', 'c'], C: ['a', 'b'] };
const opposite = (L) => SIDES[LETTERS.indexOf(L)];

const OPS = {
  // ══ A. 三角形五心与心线 ═══════════════════════════════════════════

  'triangle_circumcenter': {
    dim: 2,
    brief: 'Circumcenter O of triangle (a,b,c): the unique point equidistant from all three, plus the circumradius R.',
    args: { a: 'point', b: 'point', c: 'point' },
    run: ({ a, b, c }) => {
      const t = triState(a, b, c);
      if (!t.ok) return { value: null, degenerate: t.degenerate };
      const o = circumcenter(a, b, c);
      if (!o) return { value: null, degenerate: 'degenerate_triangle' };
      return { value: { center: V.detV(o), radius: V.detF(V.dist(a, o)) } };
    }
  },

  /** 垂心走恒等式 H = A+B+C-2O，而不是解三条直线：一步闭式，且是 O 的仿射像 */
  'triangle_orthocenter': {
    dim: 2,
    brief: 'Orthocenter H = A+B+C-2O (O = circumcenter) of triangle (a,b,c). Intersection of the three altitudes.',
    args: { a: 'point', b: 'point', c: 'point' },
    run: ({ a, b, c }) => {
      const t = triState(a, b, c);
      if (!t.ok) return { value: null, degenerate: t.degenerate };
      const o = circumcenter(a, b, c);
      if (!o) return { value: null, degenerate: 'degenerate_triangle' };
      return { value: V.detV([a[0] + b[0] + c[0] - 2 * o[0], a[1] + b[1] + c[1] - 2 * o[1]]) };
    }
  },

  /**
   * 三个旁心。I_A = (−a·A + b·B + c·C)/(−a+b+c)：
   * 分母是 b+c−a = 2(s−a)，退化（a=b+c）时分母为 0、旁心跑向无穷远，故必须先挡。
   */
  'triangle_excenters': {
    dim: 2,
    brief: 'Three excenters I_A, I_B, I_C of triangle (a,b,c) — weight -opposite side length, + the other two.',
    args: { a: 'point', b: 'point', c: 'point' },
    run: ({ a, b, c }) => {
      const t = triState(a, b, c);
      if (!t.ok) return { value: null, degenerate: t.degenerate };
      const s = t.sides;
      const mk = (wa, wb, wc, denom) => {
        if (!(Math.abs(denom) > EPS)) return null;
        return V.detV([(wa * a[0] + wb * b[0] + wc * c[0]) / denom,
          (wa * a[1] + wb * b[1] + wc * c[1]) / denom]);
      };
      const out = {
        I_A: mk(-s.a, s.b, s.c, -s.a + s.b + s.c),
        I_B: mk(s.a, -s.b, s.c, s.a - s.b + s.c),
        I_C: mk(s.a, s.b, -s.c, s.a + s.b - s.c)
      };
      for (const k of ['I_A', 'I_B', 'I_C']) {
        if (!out[k]) return { value: null, degenerate: 'degenerate_triangle' };
      }
      return { value: out };
    }
  },

  /**
   * 五心一次算齐，并**当场校验两条欧拉恒等式**。
   * 为什么带校验：这些心都是闭式算出来的，平时没有测试盯着。把
   * identityResidual 放进返回值 ⇒ 实现哪天写错，残差立刻变大 ——
   * 这是把回归测试搬进 API。eulerOI2_residual 与 eulerOH2_residual 应当 ≈ 0。
   */
  'triangle_five_centers': {
    dim: 2,
    brief: 'All five classical centers of triangle (a,b,c) — centroid G, incenter I, circumcenter O, orthocenter H, three excenters — plus R, r, and the residuals of the Euler identities OI^2=R(R-2r) and OH^2=9R^2-(a^2+b^2+c^2) (both ~ 0).',
    args: { a: 'point', b: 'point', c: 'point' },
    run: ({ a, b, c }) => {
      const t = triState(a, b, c);
      if (!t.ok) return { value: null, degenerate: t.degenerate };
      const s = t.sides;
      const P = s.a + s.b + s.c;
      const O = circumcenter(a, b, c);
      if (!O) return { value: null, degenerate: 'degenerate_triangle' };
      const R = V.dist(a, O);
      const G = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
      const I = [(s.a * a[0] + s.b * b[0] + s.c * c[0]) / P,
        (s.a * a[1] + s.b * b[1] + s.c * c[1]) / P];
      const H = [a[0] + b[0] + c[0] - 2 * O[0], a[1] + b[1] + c[1] - 2 * O[1]];
      const r = 2 * t.area / P;
      const oi2 = V.distSq(I, O);
      const oh2 = V.distSq(H, O);
      const sq = s.a * s.a + s.b * s.b + s.c * s.c;
      const scale = Math.max(1, R * R);
      return {
        value: {
          G: V.detV(G), I: V.detV(I), O: V.detV(O), H: V.detV(H),
          R: V.detF(R), r: V.detF(r), semiperimeter: V.detF(P / 2),
          excenters: {
            I_A: V.detV([(-s.a * a[0] + s.b * b[0] + s.c * c[0]) / (-s.a + s.b + s.c),
              (-s.a * a[1] + s.b * b[1] + s.c * c[1]) / (-s.a + s.b + s.c)]),
            I_B: V.detV([(s.a * a[0] - s.b * b[0] + s.c * c[0]) / (s.a - s.b + s.c),
              (s.a * a[1] - s.b * b[1] + s.c * c[1]) / (s.a - s.b + s.c)]),
            I_C: V.detV([(s.a * a[0] + s.b * b[0] - s.c * c[0]) / (s.a + s.b - s.c),
              (s.a * a[1] + s.b * b[1] - s.c * c[1]) / (s.a + s.b - s.c)])
          },
          eulerOI2: V.detF(oi2),
          eulerOI2_expected: V.detF(R * (R - 2 * r)),
          eulerOI2_residual: V.detF(Math.abs(oi2 - R * (R - 2 * r)) / scale),
          eulerOH2: V.detF(oh2),
          eulerOH2_expected: V.detF(9 * R * R - sq),
          eulerOH2_residual: V.detF(Math.abs(oh2 - (9 * R * R - sq)) / scale)
        }
      };
    }
  },

  /**
   * 欧拉线：O、G、H 共线且 H−O = 3(G−O)（即 OG:GH = 1:2）。
   * 判据不靠「看起来在一条线上」，而是解出 H 关于 (O,G) 的仿射参数 t，
   * 要求 t = 3；t 的偏差就是共线性残差。正三角形时 O=G=H，
   * 欧拉线**不唯一** —— 必须显式说，不能默默给一条。
   */
  'euler_line': {
    dim: 2,
    brief: 'Euler line of triangle (a,b,c): the line through circumcenter O and centroid G, which also contains the orthocenter H. Reports the affine parameter t in H=O+t(G-O) (theory: exactly 3) and the collinearity residual. For an equilateral triangle O=G=H and the line is not unique — equilateral:true says so.',
    args: { a: 'point', b: 'point', c: 'point' },
    run: ({ a, b, c }) => {
      const t = triState(a, b, c);
      if (!t.ok) return { value: null, degenerate: t.degenerate };
      const O = circumcenter(a, b, c);
      if (!O) return { value: null, degenerate: 'degenerate_triangle' };
      const G = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
      const H = [a[0] + b[0] + c[0] - 2 * O[0], a[1] + b[1] + c[1] - 2 * O[1]];
      const d = V.sub(G, O);
      const dd = V.normSq(d);
      if (!(dd > EPS * EPS)) {
        return {
          value: {
            O: V.detV(O), G: V.detV(G), H: V.detV(H),
            equilateral: true,
            OG_over_GH: null,
            note: 'O=G=H (equilateral triangle): the Euler line is NOT unique; any line through the common point qualifies.'
          }
        };
      }
      const tt = V.dot(V.sub(H, O), d) / dd;
      const proj = V.add(O, V.scale(d, tt));
      const scale = Math.max(1, V.norm(V.sub(G, O)));
      return {
        value: {
          O: V.detV(O), G: V.detV(G), H: V.detV(H),
          equilateral: false,
          parameter_t: V.detF(tt),
          parameter_t_expected: 3,
          OG_over_GH: V.detF(1 / 2),
          collinearityResidual: V.detF(V.dist(proj, H) / scale)
        }
      };
    }
  },

  /** 九点圆：圆心 N=(O+H)/2，半径 R/2。验证 3 个边中点与 3 个垂足都在上面 */
  'triangle_nine_point_circle': {
    dim: 2,
    brief: 'Nine-point circle of triangle (a,b,c): center = midpoint(O,H), radius = R/2. Verifies the 3 side midpoints and the 3 altitude feet all lie on it (maxResidual ~ 0).',
    args: { a: 'point', b: 'point', c: 'point' },
    run: ({ a, b, c }) => {
      const t = triState(a, b, c);
      if (!t.ok) return { value: null, degenerate: t.degenerate };
      const O = circumcenter(a, b, c);
      if (!O) return { value: null, degenerate: 'degenerate_triangle' };
      const R = V.dist(a, O);
      const H = [a[0] + b[0] + c[0] - 2 * O[0], a[1] + b[1] + c[1] - 2 * O[1]];
      const N = [(O[0] + H[0]) / 2, (O[1] + H[1]) / 2];
      const r9 = R / 2;
      const mids = [[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
        [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2],
        [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2]];
      const foot = (p, u, v) => {
        const d = V.sub(v, u), dd = V.normSq(d);
        if (!(dd > EPS)) return null;
        return V.add(u, V.scale(d, V.dot(V.sub(p, u), d) / dd));
      };
      const feet = [foot(a, b, c), foot(b, c, a), foot(c, a, b)].filter(Boolean);
      let maxRes = 0;
      for (const p of mids.concat(feet)) maxRes = Math.max(maxRes, Math.abs(V.dist(p, N) - r9));
      return {
        value: {
          center: V.detV(N), radius: V.detF(r9),
          sideMidpoints: mids.map(V.detV),
          altitudeFeet: feet.map(V.detV),
          maxResidual: V.detF(maxRes / Math.max(1, r9))
        }
      };
    }
  },

  /** 欧拉不等式 R >= 2r，等号当且仅当正三角形 */
  'triangle_euler_inequality': {
    dim: 2,
    brief: 'Euler inequality R >= 2r for triangle (a,b,c). Equality holds if and only if the triangle is equilateral (isEquilateral:true).',
    args: { a: 'point', b: 'point', c: 'point' },
    run: ({ a, b, c }) => {
      const t = triState(a, b, c);
      if (!t.ok) return { value: null, degenerate: t.degenerate };
      const s = t.sides;
      const O = circumcenter(a, b, c);
      if (!O) return { value: null, degenerate: 'degenerate_triangle' };
      const R = V.dist(a, O);
      const r = 2 * t.area / (s.a + s.b + s.c);
      const slack = R - 2 * r;
      const scale = Math.max(1, R);
      return {
        value: {
          R: V.detF(R), r: V.detF(r),
          holds: slack >= -REL * scale,
          slack: V.detF(slack),
          isEquilateral: Math.abs(slack) <= REL * scale
        }
      };
    }
  },

  // ══ B. 边、线与 Ceva / Menelaus / Stewart ══════════════════════════

  'triangle_medians': {
    dim: 2,
    brief: 'Median lengths of triangle (a,b,c): m_a = 0.5*sqrt(2b^2+2c^2-a^2) etc., plus the centroid, which divides every median in ratio 2:1 from the vertex.',
    args: { a: 'point', b: 'point', c: 'point' },
    run: ({ a, b, c }) => {
      const t = triState(a, b, c);
      if (!t.ok) return { value: null, degenerate: t.degenerate };
      const s = t.sides;
      const med = (x, y, z) => 0.5 * Math.sqrt(Math.max(0, 2 * y * y + 2 * z * z - x * x));
      return {
        value: {
          m_a: V.detF(med(s.a, s.b, s.c)),
          m_b: V.detF(med(s.b, s.c, s.a)),
          m_c: V.detF(med(s.c, s.a, s.b)),
          centroid: V.detV([(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3]),
          ratio_vertex_to_centroid: '2:1'
        }
      };
    }
  },

  /**
   * 高。钝角三角形有两个垂足落在边的**延长线**上 —— 那是合法三角形，不是退化。
   * 所以 foot_inside_segment 是独立布尔量，不能因为它为 false 就报 degenerate。
   */
  'triangle_altitudes': {
    dim: 2,
    brief: 'Altitude lengths of triangle (a,b,c): h_a = 2*area/a etc., plus the 3 feet and foot_inside_segment flags. In an obtuse triangle two feet fall OUTSIDE their side — that is valid, not a degeneracy.',
    args: { a: 'point', b: 'point', c: 'point' },
    run: ({ a, b, c }) => {
      const t = triState(a, b, c);
      if (!t.ok) return { value: null, degenerate: t.degenerate };
      const s = t.sides;
      const foot = (p, u, v) => {
        const d = V.sub(v, u), dd = V.normSq(d);
        if (!(dd > EPS)) return null;
        const k = V.dot(V.sub(p, u), d) / dd;
        return { point: V.add(u, V.scale(d, k)), inside: k >= -REL && k <= 1 + REL };
      };
      const fa = foot(a, b, c), fb = foot(b, c, a), fc = foot(c, a, b);
      return {
        value: {
          h_a: V.detF(2 * t.area / s.a),
          h_b: V.detF(2 * t.area / s.b),
          h_c: V.detF(2 * t.area / s.c),
          foot_from_a: fa ? V.detV(fa.point) : null,
          foot_from_b: fb ? V.detV(fb.point) : null,
          foot_from_c: fc ? V.detV(fc.point) : null,
          foot_inside_segment: fa ? fa.inside : null
        }
      };
    }
  },

  /** 内角平分线长：l_a = 2bc·cos(A/2)/(b+c) = sqrt(bc(1−a²/(b+c)²)) */
  'triangle_bisector_lengths': {
    dim: 2,
    brief: 'Internal angle-bisector lengths of triangle (a,b,c): l_a = 2bc*cos(A/2)/(b+c) = sqrt(bc(1-a^2/(b+c)^2)) and cyclically.',
    args: { a: 'point', b: 'point', c: 'point' },
    run: ({ a, b, c }) => {
      const t = triState(a, b, c);
      if (!t.ok) return { value: null, degenerate: t.degenerate };
      const s = t.sides;
      const bis = (x, y, z) => {
        const p = y + z;
        if (!(p > EPS)) return 0;
        const inner = y * z * (1 - (x * x) / (p * p));
        return inner > 0 ? Math.sqrt(inner) : 0;
      };
      return {
        value: {
          l_a: V.detF(bis(s.a, s.b, s.c)),
          l_b: V.detF(bis(s.b, s.c, s.a)),
          l_c: V.detF(bis(s.c, s.a, s.b))
        }
      };
    }
  },

  /**
   * Stewart 定理。a = 边长，被 cevian 分成 m 与 n（a = m+n），d = 对顶点到分点的距离。
   * 恒等式：b²m + c²n = a(d² + mn)，其中 b 是**与 m 段相对**的那条边。
   * ⚠ 约定容易搞反，所以返回体把四个输入和算出的 d 都列出来，
   *   另给 identityResidual 让调用方直接看到这条恒等式闭合了多少。
   */
  'stewart_theorem': {
    dim: 0,
    scalar: true,
    brief: "Stewart's theorem as a closed-form solve. Side a is split into m and n (a = m+n); given the two other sides b (opposite the m segment) and c (opposite the n segment), the cevian length is d = sqrt((b^2*m + c^2*n)/a - m*n). Reports the identity residual of b^2*m + c^2*n = a*(d^2 + m*n).",
    args: { a: 'number', m: 'number', b: 'number', c: 'number' },
    run: ({ a, m, b, c }) => {
      { const e = lengthsOk(a); if (e) return { value: null, degenerate: e }; }
      if (!(m >= -EPS && m <= a + EPS)) return { value: null, degenerate: 'split_out_of_range' };
      const n = a - m;
      if (!(n > -EPS)) return { value: null, degenerate: 'split_out_of_range' };
      if (!(b + c >= a - EPS) || !(Math.abs(b - c) <= a + EPS)) {
        // 边长模式下这属于「问题合法但无解」，不是输入病态 —— 见 sidesFormTriangle
        return { value: null, degenerate: 'no_such_triangle' };
      }
      const d2 = (b * b * m + c * c * n) / a - m * n;
      if (d2 < -EPS) return { value: null, degenerate: 'no_such_cevian' };
      const d = Math.sqrt(Math.max(0, d2));
      const lhs = b * b * m + c * c * n;
      return {
        value: {
          a: V.detF(a), m: V.detF(m), n: V.detF(n), b: V.detF(b), c: V.detF(c),
          d: V.detF(d),
          identity: 'b^2*m + c^2*n = a*(d^2 + m*n)',
          identityResidual: V.detF(Math.abs(lhs - a * (d * d + m * n)) / Math.max(1, Math.abs(lhs)))
        }
      };
    }
  },

  /**
   * 塞瓦：AD、BE、CF 共点 ⟺ (BD/DC)(CE/EA)(AF/FB) = 1。
   * 传的是**边上的点**而不是比值 —— 几何库里给点比给比值更不容易搞反方向。
   * product 与 1 的偏差就是判定结果。
   */
  'cevian_concurrent': {
    dim: 2,
    brief: "Ceva's theorem: with D on BC, E on CA, F on AB, the cevians AD, BE, CF are concurrent iff (BD/DC)(CE/EA)(AF/FB) = 1. Pass the three POINTS, not the ratios — the ratios are derived, so you cannot flip a direction by accident.",
    args: { a: 'point', b: 'point', c: 'point', d: 'point', e: 'point', f: 'point' },
    run: ({ a, b, c, d, e, f }) => {
      const t = triState(a, b, c);
      if (!t.ok) return { value: null, degenerate: t.degenerate };
      // 前提校验（见模块级 whereOnSide 的注释）：点不在对应边上 ⇒
      // 比值无意义，报 point_not_on_side，绝不报 concurrent:false。
      const wd = whereOnSide(b, d, c), we = whereOnSide(c, e, a), wf = whereOnSide(a, f, b);
      for (const w of [wd, we, wf]) {
        if (w.place === null) return { value: null, degenerate: 'degenerate_segment' };
        if (w.place === 'off_line') return { value: null, degenerate: 'point_not_on_side' };
        if (w.place === 'endpoint') return { value: null, degenerate: 'point_at_vertex' };
      }
      const bd = sideRatio(b, d, c), ce = sideRatio(c, e, a), af = sideRatio(a, f, b);
      if (bd === null || ce === null || af === null) return { value: null, degenerate: 'point_not_on_side' };
      const prod = bd * ce * af;
      return {
        value: {
          BD_over_DC: V.detF(bd), CE_over_EA: V.detF(ce), AF_over_FB: V.detF(af),
          product: V.detF(prod),
          concurrent: Math.abs(prod - 1) <= 1e-7,
          identityResidual: V.detF(Math.abs(prod - 1))
        }
      };
    }
  },

  /**
   * 梅涅劳：D、E、F 共线 ⟺ 无向比之积为 1，且三点中落在延长线上的个数为**奇数**。
   * 不用有向比 —— 引入符号约定后 LLM 极易搞错方向，而「奇偶性」是纯几何事实。
   * 另给 collinear（直接算行列式）作为**独立**交叉校验，不依赖定理本身；
   * theoremAgrees 检查两者是否一致 —— 不一致就说明输入越界了。
   */
  'menelaus_collinear': {
    dim: 2,
    brief: "Menelaus' theorem: D on BC, E on CA, F on AB are collinear iff (BD/DC)(CE/EA)(AF/FB) = 1 in unsigned lengths AND an odd number of the three points lie on an extension. collinear is computed independently (a 3x3 determinant), so theoremAgrees=false means the points are outside the sides.",
    args: { a: 'point', b: 'point', c: 'point', d: 'point', e: 'point', f: 'point' },
    run: ({ a, b, c, d, e, f }) => {
      const t = triState(a, b, c);
      if (!t.ok) return { value: null, degenerate: t.degenerate };
      // 同样要验是否真在直线上（见模块级 whereOnSide）
      const sd = whereOnSide(b, d, c), se = whereOnSide(c, e, a), sf = whereOnSide(a, f, b);
      for (const w of [sd, se, sf]) {
        if (w.place === null) return { value: null, degenerate: 'degenerate_segment' };
        if (w.place === 'off_line') return { value: null, degenerate: 'point_not_on_side' };
        if (w.place === 'endpoint') return { value: null, degenerate: 'point_at_vertex' };
      }
      const rd = sd.k / (1 - sd.k), re = se.k / (1 - se.k), rf = sf.k / (1 - sf.k);
      const prod = Math.abs(rd * re * rf);
      const outside = (sd.place === 'extension' ? 1 : 0) + (se.place === 'extension' ? 1 : 0)
        + (sf.place === 'extension' ? 1 : 0);
      const productOne = Math.abs(prod - 1) <= 1e-7;
      const collinear = Math.abs(signedArea2(d, e, f)) <= EPS * Math.max(1, V.normSq(V.sub(e, d)));
      const theoremSays = productOne && (outside === 1 || outside === 3);
      return {
        value: {
          BD_over_DC: V.detF(rd), CE_over_EA: V.detF(re), AF_over_FB: V.detF(rf),
          product: V.detF(prod),
          pointsOnExtension: outside,
          collinear,
          theoremAgrees: collinear === theoremSays
        }
      };
    }
  },

  // ══ C. 三角函数定理（几何 ⇄ 代数最直接的一座桥）═══════════════════

  'law_of_cosines': {
    dim: 0,
    scalar: true,
    brief: 'Law of cosines given three sides a,b,c: returns angles A,B,C in radians (plus anglesDeg). sumOfAngles should be exactly pi. To solve for a side from two sides and the included angle use law_of_cosines_sas instead.',
    args: { a: 'number', b: 'number', c: 'number' },
    run: ({ a, b, c }) => {
      { const e = lengthsOk(a, b, c); if (e) return { value: null, degenerate: e }; }
      if (!sidesFormTriangle(a, b, c)) {
        // 三个正数不满足三角不等式 ⇒ 这个三角形不存在（可断言「没有」），
        // 而不是「输入使问题病态」。见 sidesFormTriangle 的分类说明。
        return { value: null, degenerate: 'no_such_triangle' };
      }
      const g = anglesFromSides(a, b, c);
      return {
        value: {
          A: V.detF(g.A), B: V.detF(g.B), C: V.detF(g.C),
          anglesDeg: { A: V.detF(g.A * 180 / Math.PI), B: V.detF(g.B * 180 / Math.PI), C: V.detF(g.C * 180 / Math.PI) },
          sumOfAngles: V.detF(g.A + g.B + g.C),
          sumOfAngles_expected: V.detF(Math.PI)
        }
      };
    }
  },

  'law_of_cosines_sas': {
    dim: 0,
    scalar: true,
    brief: 'Law of cosines solving for the third side: c = sqrt(a^2 + b^2 - 2ab*cos(C)) for sides a,b enclosing angle C (radians). Also returns the area = 0.5*a*b*sin(C).',
    args: { a: 'number', b: 'number', C: 'number' },
    run: ({ a, b, C }) => {
      { const e = lengthsOk(a, b); if (e) return { value: null, degenerate: e }; }
      if (!(C > -EPS && C < Math.PI + EPS)) return { value: null, degenerate: 'angle_out_of_range' };
      return {
        value: {
          c: V.detF(Math.sqrt(Math.max(0, a * a + b * b - 2 * a * b * Math.cos(C)))),
          area: V.detF(0.5 * a * b * Math.sin(C))
        }
      };
    }
  },

  'law_of_sines': {
    dim: 0,
    scalar: true,
    brief: 'Law of sines given three sides a,b,c: returns angles A,B,C (radians, plus anglesDeg) and the circumradius R from a/sin A = 2R. ratioSpread is the relative spread of the three ratios and should be ~ 0; a large value means the inputs are inconsistent.',
    args: { a: 'number', b: 'number', c: 'number' },
    run: ({ a, b, c }) => {
      { const e = lengthsOk(a, b, c); if (e) return { value: null, degenerate: e }; }
      if (!sidesFormTriangle(a, b, c)) {
        // 三个正数不满足三角不等式 ⇒ 这个三角形不存在（可断言「没有」），
        // 而不是「输入使问题病态」。见 sidesFormTriangle 的分类说明。
        return { value: null, degenerate: 'no_such_triangle' };
      }
      const g = anglesFromSides(a, b, c);
      const ratios = [a / Math.sin(g.A), b / Math.sin(g.B), c / Math.sin(g.C)];
      const mn = Math.min.apply(null, ratios), mx = Math.max.apply(null, ratios);
      return {
        value: {
          A: V.detF(g.A), B: V.detF(g.B), C: V.detF(g.C),
          anglesDeg: { A: V.detF(g.A * 180 / Math.PI), B: V.detF(g.B * 180 / Math.PI), C: V.detF(g.C * 180 / Math.PI) },
          twoR: V.detF(mn), R: V.detF(mn / 2),
          ratioSpread: V.detF((mx - mn) / Math.max(1e-12, mn))
        }
      };
    }
  },

  /**
   * 解三角形 —— 几何 ⇄ 代数：把几何条件翻译成方程再解。
   * 任选 3 个已知量（{a,b,c,A,B,C}），按「几角几边」分类：
   *   sss（3 边）唯一 / saa（2 角 1 边）唯一 / sas（1 角且为夹角）唯一
   *   / ssa（1 角且非夹角）**可能 1 解也可能 2 解**。
   * SSA 二义是这一层与代数求解器的共同现象：同一个二次方程有两根，
   * 几何上就是「已知两边及对角可以画出两个三角形」。
   * 这里**显式返回 solutionCount 与 allSolutions**，绝不悄悄只给一个。
   */
  'solve_triangle': {
    dim: 0,
    scalar: true,
    brief: 'Solve a triangle from any 3 of {a,b,c,A,B,C} (angles in radians). Handles sss / saa / sas / ssa and REPORTS the SSA ambiguity explicitly: solutionCount is 1 or 2 and allSolutions lists every valid triangle. AAA is rejected (scale undetermined).',
    args: {
      a: 'number?', b: 'number?', c: 'number?',
      A: 'number?', B: 'number?', C: 'number?'
    },
    run: (raw) => {
      const given = SIDES.concat(LETTERS).filter((k) => raw[k] !== undefined && raw[k] !== null);
      if (given.length !== 3) return { value: null, degenerate: 'need_exactly_three_given' };
      for (const k of given) {
        if (!(raw[k] > 0)) return { value: null, degenerate: 'non_positive_input' };
      }
      const gAngles = given.filter((k) => LETTERS.indexOf(k) >= 0);
      const gSides = given.filter((k) => SIDES.indexOf(k) >= 0);
      for (const k of gAngles) {
        if (!(raw[k] < Math.PI - EPS)) return { value: null, degenerate: 'angle_out_of_range' };
      }
      const pack = (s, i) => {
        const o = {};
        for (const L of LETTERS) if (s[L] !== undefined) o[L] = V.detF(s[L]);
        for (const K of SIDES) if (s[K] !== undefined) o[K] = V.detF(s[K]);
        const deg = {};
        for (const L of LETTERS) deg[L] = s[L] === undefined ? null : V.detF(s[L] * 180 / Math.PI);
        return { solution: i, solve: o, anglesDeg: deg };
      };
      // ── sss：余弦定理，三个角唯一 ──
      if (gAngles.length === 0) {
        const a = raw.a, b = raw.b, c = raw.c;
        if (!sidesFormTriangle(a, b, c)) {
          return { value: null, degenerate: 'no_such_triangle' };
        }
        const g = anglesFromSides(a, b, c);
        const s = { a, b, c, A: g.A, B: g.B, C: g.C };
        return {
          value: Object.assign(pack(s, 1), {
            solutionCount: 1, ambiguous: false, allSolutions: [pack(s, 1).solve], case: 'sss', note: 'unique solution'
          })
        };
      }
      // ── saa：两角一边，唯一 ──
      if (gAngles.length === 2) {
        const L1 = gAngles[0], L2 = gAngles[1];
        const known = gSides[0];
        const sum = raw[L1] + raw[L2];
        if (!(sum < Math.PI - EPS)) return { value: null, degenerate: 'angles_exceed_pi' };
        const L3 = LETTERS.find((k) => k !== L1 && k !== L2);
        const s = {};
        s[known] = raw[known]; s[L1] = raw[L1]; s[L2] = raw[L2];
        s[L3] = Math.PI - sum;
        // ⚠ 正弦定理：**每条边都必须配它自己的对角**：
        //     x / sin(对角 x) = known / sin(对角 known)
        //   第一版写成 s[k3] = known·sin(L3)/sin(L1)，其中 L1/L3 只是
        //   「两个已知角里的第一个」和「剩下的那个」—— 与 known 毫无关系。
        //   实测 b=4, A=60°, B=45°：错版给 a = 4·sin75/sin60 = 4.4614，
        //   正解是 a = 4·sin60/sin45 = 4.8990。差 9%，不报错。
        //   更糟的是它只解了**两个未知边中的一个**，另一个从未赋值 ——
        //   输出里少一个键（症状：solve 里没有 c，但 anglesDeg 三项齐全，
        //   看上去「只是没给那个量」，实际是三角形没解完）。
        //   现在按 LETTERS↔SIDES 的对位关系逐边解，两条都算。
        const knownAngle = LETTERS[SIDES.indexOf(known)];
        for (const k of SIDES) {
          if (s[k] !== undefined) continue;
          s[k] = raw[known] * Math.sin(s[LETTERS[SIDES.indexOf(k)]]) / Math.sin(raw[knownAngle]);
        }
        return {
          value: Object.assign(pack(s, 1), {
            solutionCount: 1, ambiguous: false, allSolutions: [pack(s, 1).solve], case: 'saa', note: 'unique solution'
          })
        };
      }
      // ── 一角两边：分「夹角」(sas) 与「非夹角」(ssa，二义) ──
      if (gAngles.length === 3) {
        // ⚠ 必须排在下面「数量不对」那一支**之前**：给了 3 个角（AAA）时数量是对的，
        //   但三角形**相似而不全等** —— 任意缩放都满足，于是边长完全未定。
        //   落到底下的 need_exactly_three_given 会说「你没给够三个量」，
        //   而调用方明明给了三个 —— 这是事实性错误，会让人以为参数名写错了。
        return { value: null, degenerate: 'scale_undetermined' };
      }
      if (gAngles.length !== 1 || gSides.length !== 2) {
        return { value: null, degenerate: 'need_exactly_three_given' };
      }
      const L = gAngles[0];
      const known = opposite(L);                    // 已知角的对边（SSA 那个已知边）
      const adj = ADJACENT[L];                     // 已知角的两条邻边
      const isIncluded = adj.every((x) => gSides.indexOf(x) >= 0);
      if (isIncluded) {
        // sas：两邻边已知 ⇒ 第三边由余弦定理唯一确定
        const s = {};
        s[adj[0]] = raw[adj[0]]; s[adj[1]] = raw[adj[1]]; s[L] = raw[L];
        const third = SIDES.find((k) => k !== adj[0] && k !== adj[1]);
        s[third] = Math.sqrt(Math.max(0, s[adj[0]] * s[adj[0]] + s[adj[1]] * s[adj[1]]
          - 2 * s[adj[0]] * s[adj[1]] * Math.cos(raw[L])));
        const g = anglesFromSides(s.a, s.b, s.c);
        s.A = g.A; s.B = g.B; s.C = g.C;
        return {
          value: Object.assign(pack(s, 1), {
            solutionCount: 1, ambiguous: false, allSolutions: [pack(s, 1).solve], case: 'sas', note: 'unique solution: the given angle is the included angle'
          })
        };
      }
      // ssa：正弦定理 sin(其余角) = 边·sin(已知角)/已知对边
      const other = gSides.find((k) => k !== known);
      // ⚠ 这里要的是**角字母**：边 other 的对角是同下标的字母。
      //   第一版写成 opposite(other)（那个函数收角字母、返边字母），
      //   于是拿到 undefined，后面 s[undefined]=Bv 凭空多一个键，
      //   而 s.C 一直没赋值 —— 输出里 C 静默消失，B 位置放的是 rest。
      //   症状：返回 anglesDeg.C=null，但「所有解」看起来都完整。
      const Lother = LETTERS[SIDES.indexOf(other)];
      if (!Lother) return { value: null, degenerate: 'need_exactly_three_given' };
      const sinB = raw[other] * Math.sin(raw[L]) / raw[known];
      if (sinB > 1 + REL) return { value: null, degenerate: 'no_such_triangle' };
      const clamped = Math.max(-1, Math.min(1, sinB));
      const B1 = Math.asin(clamped);
      const cands = (B1 <= EPS || Math.abs(clamped - 1) <= REL) ? [B1] : [B1, Math.PI - B1];
      const sols = [];
      for (const Bv of cands) {
        const rest = Math.PI - raw[L] - Bv;
        if (rest <= EPS) continue;                 // 第三个角为 0 ⇒ 退化，丢弃
        const s = {};
        s[L] = raw[L]; s[other] = raw[other]; s[known] = raw[known];
        s[Lother] = Bv; s[LETTERS.find((k) => k !== L && k !== Lother)] = rest;
        const unknownSide = SIDES.find((k) => k !== known && k !== other);
        s[unknownSide] = raw[known] * Math.sin(rest) / Math.sin(raw[L]);
        sols.push(s);
      }
      if (!sols.length) return { value: null, degenerate: 'no_such_triangle' };
      const packed = sols.map((s, i) => pack(s, i + 1));
      const base = packed[0];
      base.case = 'ssa';
      base.solutionCount = sols.length;
      base.ambiguous = sols.length > 1;
      base.allSolutions = packed.map((p) => p.solve);
      base.note = sols.length > 1
        ? 'SSA ambiguous: two distinct triangles share the three given values. Both are valid — return both or say the answer is not unique.'
        : 'unique solution';
      return { value: base };
    }
  },

  // ══ D. 圆：幂、根轴、极点极线 ═════════════════════════════════════

  /** 圆的幂：|PO|² − r²。正 = 圆外，0 = 圆上，负 = 圆内 */
  'power_of_point': {
    dim: 2,
    brief: 'Power of a point p w.r.t. circle (center,r): |PO|^2 - r^2. Positive outside, 0 on the circle, negative inside. Equals PA*PB for any secant through p.',
    args: { center: 'point', r: 'number', p: 'point' },
    run: ({ center, r, p }) => {
      if (!(r > -EPS)) return { value: null, degenerate: 'negative_radius' };
      const pow = V.distSq(p, center) - r * r;
      const scale = Math.max(1, r * r);
      return {
        value: {
          power: V.detF(pow),
          position: Math.abs(pow) <= REL * scale ? 'on_circle' : (pow > 0 ? 'outside' : 'inside')
        }
      };
    }
  },

  /**
   * 根轴：power₁ = power₂ 的轨迹，写成 (O₂−O₁)·X = (|O₂|²−|O₁|²+r₁²−r₂²)/2。
   * 同心且半径不同 ⇒ 根轴**不存在**（无解）；两圆完全相同 ⇒ 根轴是整个平面
   * （问题本身不良）。这两种必须分开报，不能都糊成「一条平行线」。
   */
  'radical_axis': {
    dim: 2,
    brief: 'Radical axis of circles (c1,r1) and (c2,r2): the line where the two powers are equal, as normalized ax+by+c=0. Also reports the circlesRelation (two/touch/separate/contained/concentric/same) and their intersection points. Concentric circles with different radii have NO radical axis; identical circles make the question ill-posed.',
    args: { c1: 'point', r1: 'number', c2: 'point', r2: 'number' },
    run: ({ c1, r1, c2, r2 }) => {
      if (!(r1 > -EPS) || !(r2 > -EPS)) return { value: null, degenerate: 'negative_radius' };
      const inter = circleCircle({ center: c1, radius: r1 }, { center: c2, radius: r2 });
      const n = V.sub(c2, c1);
      const nn = V.norm(n);
      if (!(nn > EPS)) {
        if (inter.kind === 'same') return { value: null, degenerate: 'identical_circles' };
        return { value: null, degenerate: 'no_radical_axis' };
      }
      const k = (V.normSq(c2) - V.normSq(c1) + r1 * r1 - r2 * r2) / 2;
      const u = V.scale(n, 1 / nn);
      return {
        value: {
          line: { a: V.detF(u[0]), b: V.detF(u[1]), c: V.detF(-k / nn) },
          offsetFromC1: V.detF((V.dot(n, c1) - k) / nn),
          circlesRelation: inter.kind,
          intersectionPoints: (inter.points || []).map(V.detV)
        }
      };
    }
  },

  /**
   * 极线：圆 (O,r) 下点 P 的极线是 (P−O)·(X−O) = r²。
   * P 在圆上 ⇒ 极线就是该点处的切线；P = O ⇒ 极线在无穷远（退化）。
   * 与 pole_of_line 拆成两个 op：模式字符串是 LLM 最容易传错的参数之一。
   */
  'polar_of_point': {
    dim: 2,
    brief: 'Polar of point p w.r.t. circle (center,r): the line (p-O).(X-O) = r^2, as normalized ax+by+c=0. Equals the tangent at p when p is on the circle (isTangent:true), otherwise the chord of contact. p at the center is degenerate (polar at infinity).',
    args: { center: 'point', r: 'number', p: 'point' },
    run: ({ center, r, p }) => {
      if (!(r > -EPS)) return { value: null, degenerate: 'negative_radius' };
      const d = V.sub(p, center);
      const nn = V.normSq(d);
      if (!(nn > EPS * EPS)) return { value: null, degenerate: 'pole_at_center' };
      const m = Math.sqrt(nn);
      const u = V.scale(d, 1 / m);
      const isTangent = Math.abs(nn - r * r) <= REL * Math.max(1, r * r);
      return {
        value: {
          line: { a: V.detF(u[0]), b: V.detF(u[1]), c: V.detF(-V.dot(u, center) - r * r / m) },
          pole: V.detV(p),
          isTangent
        }
      };
    }
  },

  /**
   * 极：给定直线 a·X + c = 0 与圆 (O,r)，求其极点 P。
   * 解法：极线方程 (P−O)·(X−O) = r² 展开成一般式，与目标直线对齐：
   *   令 u = P−O = λa，则 λ(a·X − a·O) = r²；
   *   目标直线上 a·X = −c，所以 λ(−c − a·O) = r² ⇒ λ = −r²/(a·O + c)。
   * ⚠ 第一版写成 O + r²·n/|n|²，漏掉了 /(a·O+c)。对圆心在原点、
   *   直线 x=R 的切线，直觉上极点就该在切点 (R,0)，而那版给出 (r²/R, 0) ——
   *   圆心不在原点时更是错得毫无征兆。实测 r=5、切线 x=5：错版给 (25,0)，
   *   正确值 (5,0)，差 5 倍。
   * 直线过圆心 ⇒ 极点在无穷远 ⇒ 退化，必须报，不能给一个有限点。
   */
  'pole_of_line': {
    dim: 2,
    brief: 'Pole of the line a1*x + b1*y + c1 = 0 w.r.t. circle (center,r): the point P with (P-O).(X-O) = r^2 on that line, i.e. P = O - r^2*(a1,b1)/(a1*Ox + b1*Oy + c1). A line through the center has its pole at infinity and is rejected.',
    args: { center: 'point', r: 'number', a1: 'number', b1: 'number', c1: 'number' },
    run: ({ center, r, a1, b1, c1 }) => {
      if (!(r > -EPS)) return { value: null, degenerate: 'negative_radius' };
      const nn = a1 * a1 + b1 * b1;
      if (!(nn > EPS)) return { value: null, degenerate: 'degenerate_line' };
      const denom = a1 * center[0] + b1 * center[1] + c1;
      if (!(Math.abs(denom) > EPS)) return { value: null, degenerate: 'pole_at_infinity' };
      const lam = -(r * r) / denom;
      return {
        value: {
          pole: V.detV([center[0] + lam * a1, center[1] + lam * b1]),
          line: { a: V.detF(a1 / Math.sqrt(nn)), b: V.detF(b1 / Math.sqrt(nn)), c: V.detF(c1 / Math.sqrt(nn)) }
        }
      };
    }
  },

  // ══ E. 四边形：托勒密、婆罗摩笈多、莫莱、拿破仑 ═══════════════════

  /**
   * 托勒密：四点共圆 ⟺ AC·BD = AB·CD + BC·DA（按顺序给出的凸四边形）。
   * 顺带把「三条边 + 一条对角线求另一条对角线」变成一个闭式解 —— 那是个二次方程。
   */
  'ptolemy': {
    dim: 2,
    brief: "Ptolemy's theorem for quadrilateral (a,b,c,d) given in order: cyclic iff AC*BD = AB*CD + BC*DA. Reports both products, their residual, whether the points form a convex quadrilateral (convex), and cyclic. Non-convex input makes the claim ill-posed and is reported as such.",
    args: { a: 'point', b: 'point', c: 'point', d: 'point' },
    run: ({ a, b, c, d }) => {
      const P = [a, b, c, d];
      for (let i = 0; i < 4; i++) {
        if (V.normSq(V.sub(P[i], P[(i + 1) % 4])) <= EPS) {
          return { value: null, degenerate: 'coincident_points' };
        }
      }
      const signs = P.map((_, i) => Math.sign(signedArea2(P[i], P[(i + 1) % 4], P[(i + 2) % 4])) || 1);
      const convex = signs.every((s) => s === signs[0]);
      const AC = V.dist(a, c), BD = V.dist(b, d);
      const AB = V.dist(a, b), BC = V.dist(b, c), CD = V.dist(c, d), DA = V.dist(d, a);
      const lhs = AC * BD, rhs = AB * CD + BC * DA;
      const scale = Math.max(1, lhs, rhs);
      // 求另一条对角线：设 BD 未知，AB*CD + BC*DA = AC*BD ⇒ 需 AD 已知；此处给通用式
      return {
        value: {
          AC_times_BD: V.detF(lhs),
          AB_times_CD_plus_BC_times_DA: V.detF(rhs),
          identityResidual: V.detF(Math.abs(lhs - rhs) / scale),
          convex,
          cyclic: convex && Math.abs(lhs - rhs) <= 1e-7 * scale
        }
      };
    }
  },

  /** 婆罗摩笈多：圆内接四边形面积 = √((s−a)(s−b)(s−c)(s−d))，s = 半周长 */
  /**
   * 海伦公式：已知三边求面积 Δ = sqrt(s(s−a)(s−b)(s−c))，s = (a+b+c)/2。
   *
   * 为什么单列一个 op：`solve_triangle` 的 sss 分支与 `law_of_cosines` 都能间接
   * 给出面积（后者是 ½bc·sin A），但那是**绕一圈**：先把边转成角再乘回边。
   * 「三边求面积」是极常见的问法，值得一条直达路径。
   *
   * ✓ 三角不等式在 §1 已隐含成立（海伦公式对不成立的三边会开出负数开根）。
   *   这里不重复判 —— 统一由调用方先过 no_such_triangle，避免同一个数学事实
   *   在两个 op 里给出不同说法。
   * ✓ incircle 半径 R_in = Δ/s 也一并给：它是海伦公式最常用的推论，
   *   而 triangle_euler_inequality 需要从坐标现算 r —— 有了三边就不必绕坐标。
   */
  'heron_area': {
    dim: 0,
    scalar: true,
    brief: "Heron's formula: given the three sides a,b,c, returns the area sqrt(s(s-a)(s-b)(s-c)) with s=(a+b+c)/2, plus the inradius area/s. The sides must satisfy the triangle inequality; otherwise you get no_such_triangle.",
    args: { a: 'number', b: 'number', c: 'number' },
    run: ({ a, b, c }) => {
      { const e = lengthsOk(a, b, c); if (e) return { value: null, degenerate: e }; }
      if (!sidesFormTriangle(a, b, c)) return { value: null, degenerate: 'no_such_triangle' };
      const s = (a + b + c) / 2;
      const area = Math.sqrt(Math.max(0, s * (s - a) * (s - b) * (s - c)));
      return {
        value: {
          a: V.detF(a), b: V.detF(b), c: V.detF(c),
          semiperimeter: V.detF(s),
          area: V.detF(area),
          inradius: V.detF(area / s)
        }
      };
    }
  },

  'brahmagupta': {
    dim: 0,
    scalar: true,
    brief: 'Brahmagupta: the area of a cyclic quadrilateral with sides a,b,c,d is sqrt((s-a)(s-b)(s-c)(s-d)) with s=(a+b+c+d)/2. Such a quadrilateral exists iff the longest side is < s. For a non-cyclic quadrilateral this is only an upper bound (Bretschneider adds a term).',
    args: { a: 'number', b: 'number', c: 'number', d: 'number' },
    run: ({ a, b, c, d }) => {
      { const e = lengthsOk(a, b, c, d); if (e) return { value: null, degenerate: e }; }
      const s = (a + b + c + d) / 2;
      const longest = Math.max(a, b, c, d);
      if (!(longest < s - EPS)) {
        return { value: { semiperimeter: V.detF(s), area: V.detF(0), cyclic_exists: false, maxSide: V.detF(longest) }, degenerate: 'degenerate_quadrilateral' };
      }
      const prod = (s - a) * (s - b) * (s - c) * (s - d);
      return {
        value: {
          semiperimeter: V.detF(s),
          area: V.detF(Math.sqrt(Math.max(0, prod))),
          cyclic_exists: true,
          maxSide: V.detF(longest)
        }
      };
    }
  },

  /**
   * 莫莱定理：D∈BC, E∈CA, F∈AB，则三圆 (AEF)、(BFD)、(CDE) 共过一点 M。
   * 闭式做法：取 (AEF) 与 (BFD) 的交点中**不是 F** 的那个（两组圆都过 F），
   * 再验它在第三圆上 ⇒ thirdCircleResidual。定理在 D/E/F 严格位于边内时恒成立，
   * 所以「三圆不相交」说明输入破坏了前提 ⇒ 报 degenerate，不给点。
   */
  'miquel_point': {
    dim: 2,
    brief: "Miquel point: for D on BC, E on CA, F on AB, the circles (AEF), (BFD), (CDE) all pass through one point M. Computes M in closed form from the first two circles and verifies it lies on the third (thirdCircleResidual ~ 0, holds:true). D/E/F must lie on their sides (extensions allowed) — otherwise the theorem does not apply and you get point_not_on_side, not a misleading holds:false.",
    args: { a: 'point', b: 'point', c: 'point', d: 'point', e: 'point', f: 'point' },
    run: ({ a, b, c, d, e, f }) => {
      const t = triState(a, b, c);
      if (!t.ok) return { value: null, degenerate: t.degenerate };
      // ⚠ 定理前提是「D 在 BC 上、E 在 CA 上、F 在 AB 上」（含延长线）。
      //   不验就往下算，会给出一个**看起来像数值结果**的 holds:false ——
      //   形式上「我没骗你说它成立」，实质上是把「你点放错了」说成「莫莱定理不成立」。
      //   定理的结论是恒真的，前提被破坏时唯一正确的回答是「输入不合法」。
      for (const [u, x, v] of [[b, d, c], [c, e, a], [a, f, b]]) {
        const w = whereOnSide(u, x, v);
        if (w.place === null) return { value: null, degenerate: 'degenerate_segment' };
        if (w.place === 'off_line') return { value: null, degenerate: 'point_not_on_side' };
        if (w.place === 'endpoint') return { value: null, degenerate: 'point_at_vertex' };
      }
      const cs = [circleFrom3(a, e, f), circleFrom3(b, f, d), circleFrom3(c, d, e)];
      if (!cs[0] || !cs[1] || !cs[2]) return { value: null, degenerate: 'degenerate_triangle' };
      const hit = circleCircle(cs[0], cs[1]);
      if (hit.kind !== 'two') {
        // 定理保证（三点严格在边内时）必有两个交点；不相交 ⇒ 前提被破坏
        return { value: null, degenerate: 'miquel_precondition_violated' };
      }
      const M = hit.points.find((p) => V.dist(p, f) > EPS) || hit.points[0];
      const res = Math.abs(V.dist(M, cs[2].center) - cs[2].radius);
      return {
        value: {
          M: V.detV(M),
          circles: cs.map((x) => ({ center: V.detV(x.center), radius: V.detF(x.radius) })),
          thirdCircleResidual: V.detF(res / Math.max(1, cs[2].radius)),
          holds: res <= 1e-7 * Math.max(1, cs[2].radius)
        }
      };
    }
  },

  /**
   * 拿破仑定理：在三边**外侧**各作等边三角形，三角形中心构成等边三角形。
   * 外侧方向由有向面积的符号决定（CCW 时外侧在边的右边）。
   * 返回三心、三边长（应相等 ⇒ equilateralResidual ≈ 0）与面积比。
   */
  'napoleon_triangles': {
    dim: 2,
    brief: "Napoleon's theorem: equilateral triangles erected OUTWARD on the three sides of (a,b,c) have centers forming an equilateral triangle. Returns the 3 centers, the 3 pairwise side lengths (equal in theory — see equilateralResidual) and the area ratio to the original triangle.",
    args: { a: 'point', b: 'point', c: 'point' },
    run: ({ a, b, c }) => {
      const t = triState(a, b, c);
      if (!t.ok) return { value: null, degenerate: t.degenerate };
      const sgn = signedArea2(a, b, c) > 0 ? 1 : -1;   // 外侧 = -sgn
      const P = equilateralThird(a, b, -sgn);
      const Q = equilateralThird(b, c, -sgn);
      const R = equilateralThird(c, a, -sgn);
      const ctr = (u, v, w) => [(u[0] + v[0] + w[0]) / 3, (u[1] + v[1] + w[1]) / 3];
      const n1 = ctr(a, b, P), n2 = ctr(b, c, Q), n3 = ctr(c, a, R);
      const ds = [V.dist(n1, n2), V.dist(n2, n3), V.dist(n3, n1)];
      const mn = Math.min.apply(null, ds), mx = Math.max.apply(null, ds);
      const aNap = Math.abs(signedArea2(n1, n2, n3)) / 2;
      return {
        value: {
          centers: [V.detV(n1), V.detV(n2), V.detV(n3)],
          outerVertices: [V.detV(P), V.detV(Q), V.detV(R)],
          sideLengths: ds.map(V.detF),
          equilateralResidual: V.detF((mx - mn) / Math.max(1, mn)),
          centerTriangleArea: V.detF(aNap),
          originalArea: V.detF(t.area),
          areaRatio: V.detF(aNap / t.area)
        }
      };
    }
  },

  // ══ F. 格点几何：皮克定理 ═════════════════════════════════════════

  /**
   * 皮克定理：A = I + B/2 − 1（I = 内部格点数，B = 边界格点数）。
   * 本 op **两个数都独立算法**再比：
   *   B 由各边 gcd(|dx|,|dy|) 求和（精确）；
   *   I 逐格点扫描（严格内部）—— 慢但**不依赖皮克公式**。
   * 于是 maxResidual 就是皮克定理在本例上的闭合误差：把回归测试搬进返回值。
   * 坐标必须是非负整数，否则「格点」概念无意义 ⇒ 报 non_integer_coordinate。
   */
  'pick_theorem': {
    dim: 2,
    minPoints: 3,
    brief: "Pick's theorem for a lattice polygon: Area = I + B/2 - 1. B is counted exactly as sum(gcd(|dx|,|dy|)) over edges and I by a direct lattice scan that does NOT use the formula, so maxResidual is an honest measure of how well the identity closes. All coordinates must be integers.",
    args: { poly: 'points' },
    run: ({ poly }) => {
      const P = [];
      for (const p of poly) {
        if (!Number.isInteger(p[0]) || !Number.isInteger(p[1])) {
          return { value: null, degenerate: 'non_integer_coordinate' };
        }
        const last = P[P.length - 1];
        if (!last || last[0] !== p[0] || last[1] !== p[1]) P.push(p);
      }
      if (P.length > 1 && P[0][0] === P[P.length - 1][0] && P[0][1] === P[P.length - 1][1]) P.pop();
      if (P.length < 3) return { value: null, degenerate: 'too_few_points' };
      let area2 = 0, B = 0;
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (let i = 0; i < P.length; i++) {
        const p = P[i], q = P[(i + 1) % P.length];
        area2 += p[0] * q[1] - q[0] * p[1];
        B += Math.abs(gcdInt(Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1])));
        minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]);
        miny = Math.min(miny, p[1]); maxy = Math.max(maxy, p[1]);
      }
      if (area2 === 0) return { value: null, degenerate: 'zero_area' };
      const area = Math.abs(area2) / 2;
      let I = 0;
      for (let x = minx; x <= maxx; x++) {
        for (let y = miny; y <= maxy; y++) if (pointStrictlyInside(P, x, y)) I++;
      }
      const byPick = I + B / 2 - 1;
      return {
        value: {
          area: V.detF(area), I, B,
          areaByPick: V.detF(byPick),
          maxResidual: V.detF(Math.abs(area - byPick) / Math.max(1, area)),
          holds: Math.abs(area - byPick) < 1e-12,
          vertices: P.length
        }
      };
    }
  },

  // ══ G. 构造：黄金比例、正多边形 ═══════════════════════════════════

  'golden_ratio': {
    dim: 0,
    scalar: true,
    brief: 'Golden ratio phi=(1+sqrt5)/2 with powers up to 12 and three self-consistency residuals: phi^2=phi+1, 1/phi=phi-1, 2cos(36deg)=phi. The last one is the geometric content: diagonal/side of a regular pentagon equals phi exactly.',
    args: {},
    run: () => {
      const phi = (1 + Math.sqrt(5)) / 2;
      const powers = [];
      let p = 1;
      for (let i = 0; i <= 12; i++) { powers.push(V.detF(p)); p *= phi; }
      return {
        value: {
          phi: V.detF(phi),
          inverse: V.detF(1 / phi),
          conjugate: V.detF(1 - phi),
          powers,
          identityResiduals: {
            phi2_minus_phi_minus_1: V.detF(Math.abs(phi * phi - phi - 1)),
            inv_phi_minus_phi_minus_1: V.detF(Math.abs(1 / phi - (phi - 1))),
            two_cos36deg_minus_phi: V.detF(Math.abs(2 * Math.cos(Math.PI / 5) - phi))
          }
        }
      };
    }
  },

  'regular_polygon': {
    dim: 0,
    scalar: true,
    brief: 'Regular n-gon (3<=n<=60) with circumradius R: side, apothem, perimeter, area, interior/exterior angle and optionally its vertices (ccw, default true). Closed form; n out of range is rejected, not approximated. For n=5 the diagonal/side ratio is exactly the golden ratio; for n=6 the side equals the circumradius.',
    args: { n: 'number', R: 'number', ccw: 'boolean?' },
    run: ({ n, R, ccw }) => {
      if (!Number.isInteger(n)) return { value: null, degenerate: 'non_integer_n' };
      if (n < 3) return { value: null, degenerate: 'n_too_small' };
      if (n > 60) return { value: null, degenerate: 'n_too_large' };
      if (!(R > EPS)) return { value: null, degenerate: 'zero_radius' };
      const s = 2 * R * Math.sin(Math.PI / n);
      const ap = R * Math.cos(Math.PI / n);
      const dir = ccw === undefined ? true : !!ccw;
      const verts = [];
      for (let i = 0; i < n; i++) {
        const th = (dir ? 1 : -1) * 2 * Math.PI * i / n;
        verts.push(V.detV([R * Math.cos(th), R * Math.sin(th)]));
      }
      return {
        value: {
          n, R: V.detF(R),
          side: V.detF(s),
          apothem: V.detF(ap),
          perimeter: V.detF(n * s),
          area: V.detF(0.5 * n * R * R * Math.sin(2 * Math.PI / n)),
          interiorAngleDeg: V.detF((n - 2) * 180 / n),
          exteriorAngleDeg: V.detF(360 / n),
          vertices: verts
        }
      };
    }
  },

  // ══ H. 3D：四面体与蒙日点 ═════════════════════════════════════════

  /** 四面体：6 棱长 + 体积（三重积）+ 4 面心 + 表面积。共面必须报，绝不返回体积 0 */
  'tetrahedron_geometry': {
    dim: 3,
    brief: 'Tetrahedron (a,b,c,d): 6 edge lengths, volume via the scalar triple product, the 4 face areas and centroids, and total surface area. Coplanar input is reported as degenerate, never as volume 0.',
    args: { a: 'point', b: 'point', c: 'point', d: 'point' },
    run: ({ a, b, c, d }) => {
      const t = V.triple(V.sub(b, a), V.sub(c, a), V.sub(d, a));
      if (!(Math.abs(t) > EPS)) return { value: null, degenerate: 'coplanar' };
      const triArea = (p, q, r) => V.norm(V.cross3(V.sub(q, p), V.sub(r, p))) / 2;
      const faces = [[a, b, c], [a, b, d], [a, c, d], [b, c, d]];
      const areas = faces.map((f) => triArea(f[0], f[1], f[2]));
      const ctr = (f) => [(f[0][0] + f[1][0] + f[2][0]) / 3,
        (f[0][1] + f[1][1] + f[2][1]) / 3, (f[0][2] + f[1][2] + f[2][2]) / 3];
      return {
        value: {
          edges: {
            ab: V.detF(V.dist(a, b)), ac: V.detF(V.dist(a, c)), ad: V.detF(V.dist(a, d)),
            bc: V.detF(V.dist(b, c)), bd: V.detF(V.dist(b, d)), cd: V.detF(V.dist(c, d))
          },
          volume: V.detF(Math.abs(t) / 6),
          faceAreas: areas.map(V.detF),
          surfaceArea: V.detF(areas.reduce((x, y) => x + y, 0)),
          faceCentroids: faces.map((f) => V.detV(ctr(f)))
        }
      };
    }
  },

  /**
   * 蒙日点：过**每条棱的中点、垂直于对棱**的六个平面的公共点。
   * 闭式走恒等式 M = 2G − O（G 重心，O 外心）—— 外心由四点定球解线性方程组。
   *
   * ⚠ 第一版的校验用错了定义（写成「过顶点处三棱中点、垂直于对面」的中面），
   *   那种平面确实也共点，但共的是**另一个点**。用错定义校验 ⇒ maxResidual=0.5
   *   却看不出是校验错还是公式错。正确的六个平面是「棱中点 × 对棱方向」。
   *   现在按正确定义逐个校验，maxResidual 才有资格当回归护栏。
   */
  'monge_point': {
    dim: 3,
    brief: 'Monge point of tetrahedron (a,b,c,d): the common point of the six planes that pass through the midpoint of each edge and are perpendicular to the opposite edge. Computed in closed form as M = 2*centroid - circumcenter, then verified against all six mid-planes (maxResidual ~ 0).',
    args: { a: 'point', b: 'point', c: 'point', d: 'point' },
    run: ({ a, b, c, d }) => {
      const rows = [], rhs = [];
      for (const q of [b, c, d]) {
        rows.push([2 * (q[0] - a[0]), 2 * (q[1] - a[1]), 2 * (q[2] - a[2])]);
        rhs.push((q[0] * q[0] + q[1] * q[1] + q[2] * q[2]) - (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]));
      }
      const O = V.solve3(rows, rhs);
      if (!O || O.some((x) => !isFinite(x))) return { value: null, degenerate: 'coplanar' };
      const G = [(a[0] + b[0] + c[0] + d[0]) / 4,
        (a[1] + b[1] + c[1] + d[1]) / 4,
        (a[2] + b[2] + c[2] + d[2]) / 4];
      const M = [2 * G[0] - O[0], 2 * G[1] - O[1], 2 * G[2] - O[2]];
      const mid = (u, v) => [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2, (u[2] + v[2]) / 2];
      const R = V.dist(a, O);
      // 六对「棱 ↔ 对棱」：边 e 与不含 e 两端点的另外两点连成的对棱
      const V4 = { a, b, c, d };
      const KEYS = ['a', 'b', 'c', 'd'];
      let maxRes = 0;
      for (let i = 0; i < 4; i++) {
        for (let j = i + 1; j < 4; j++) {
          const others = KEYS.filter((k) => k !== KEYS[i] && k !== KEYS[j]);
          if (others.length !== 2) continue;
          const u = V4[KEYS[i]], v = V4[KEYS[j]];
          const dir = V.sub(V4[others[1]], V4[others[0]]);
          if (!(V.norm(dir) > EPS)) return { value: null, degenerate: 'degenerate_edge' };
          maxRes = Math.max(maxRes, Math.abs(V.dot(dir, V.sub(M, mid(u, v)))));
        }
      }
      return {
        value: {
          M: V.detV(M), centroid: V.detV(G), circumcenter: V.detV(O),
          circumradius: V.detF(R),
          maxResidual: V.detF(maxRes / Math.max(1, R))
        }
      };
    }
  },

  /** 正四面体：全部量闭式（height、R、r、体积、二面角） */
  'regular_tetrahedron': {
    dim: 0,
    scalar: true,
    brief: 'Regular tetrahedron with edge s: height s*sqrt(2/3), circumradius s*sqrt(6)/4, inradius s*sqrt(6)/12, volume s^3/(6*sqrt2), dihedral angle arccos(1/3), and one concrete vertex embedding.',
    args: { s: 'number' },
    run: ({ s }) => {
      { const e = lengthsOk(s); if (e) return { value: null, degenerate: e }; }
      const r3 = Math.sqrt(3);
      return {
        value: {
          edge: V.detF(s),
          height: V.detF(s * Math.sqrt(2 / 3)),
          circumradius: V.detF(s * Math.sqrt(6) / 4),
          inradius: V.detF(s * Math.sqrt(6) / 12),
          volume: V.detF(s * s * s / (6 * Math.SQRT2)),
          dihedralAngleDeg: V.detF(Math.acos(1 / 3) * 180 / Math.PI),
          faceCount: 4, edgeCount: 6, vertexCount: 4,
          vertices: [[0, 0, 0], [s, 0, 0], [s / 2, s * r3 / 2, 0],
            [s / 2, s * r3 / 6, s * Math.sqrt(2 / 3)]].map(V.detV)
        }
      };
    }
  }
};

module.exports = {
  OPS,
  circumcenter, circleFrom3, circleCircle, sideLengths, signedArea2, triState, anglesFromSides
};
