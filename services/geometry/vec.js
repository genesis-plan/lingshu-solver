/**
 * 向量 / 矩阵基础 —— 1D / 2D / 3D 几何共用。
 *
 * 设计原则（三条，都是被数值坑逼出来的）：
 *
 * 1. **维度自携带，不猜**。每个向量都带 dim，混合维度运算直接抛错。
 *    早期版本允许 [1,2] 与 [1,2,3] 相加（自动补零），结果在 3D 里算出来的
 *    「距离」是错的，而且**不报错** —— 静默的错比报错危险得多。
 *
 * 2. **零向量不参与归一化**。叉积/角度/法向遇到零向量是**退化**，
 *    必须让调用方知道，而不是返回 NaN 让它流到下游。
 *    所有这类函数返回 null 表示退化，由上层决定是报 degenerate 还是换路径。
 *
 * 3. **数值比较用容差，不用 ===**。几何里的「相等」全是浮点近似：
 *    dot===0 判定垂直在 cos≈1e-17 时会漏判。统一走 EPS。
 */

'use strict';

// 几何判定容差。1e-9 是「比求解器残差门槛 1e-6 严三个数量级」，
// 目的：几何判定（共线/垂直/点在圆上）不应该比求解精度更宽松，
// 否则会出现「求解器说有交点，几何层说不相交」的自相矛盾。
const EPS = 1e-9;

// ── 构造 / 校验 ──────────────────────────────────────────────
function vec(a) {
  if (!Array.isArray(a) || a.length === 0) return null;
  for (const x of a) if (typeof x !== 'number' || !isFinite(x)) return null;
  return a.slice();
}

function dim(a) { return Array.isArray(a) ? a.length : 0; }

// 维度一致性闸门：混合维度一律抛错（见原则 1）
function sameDim(a, b) {
  if (dim(a) !== dim(b)) throw new Error(`维度不一致：${dim(a)}D 与 ${dim(b)}D`);
  return true;
}

// ── 基本运算 ────────────────────────────────────────────────
function add(a, b) { sameDim(a, b); return a.map((x, i) => x + b[i]); }
function sub(a, b) { sameDim(a, b); return a.map((x, i) => x - b[i]); }
function scale(a, k) { return a.map(x => x * k); }
function neg(a) { return a.map(x => -x); }

function dot(a, b) {
  sameDim(a, b);
  return a.reduce((s, x, i) => s + x * b[i], 0);
}

function norm(a) { return Math.sqrt(dot(a, a)); }
function normSq(a) { return dot(a, a); }

function dist(a, b) { return norm(sub(a, b)); }
function distSq(a, b) { return normSq(sub(a, b)); }

// 归一化：零向量返回 null（退化，见原则 2）
function unit(a) {
  const n = norm(a);
  if (!(n > EPS)) return null;
  return scale(a, 1 / n);
}

// 线性组合：c1*a + c2*b
function lin(c1, a, c2, b) {
  sameDim(a, b);
  return a.map((x, i) => c1 * x + c2 * b[i]);
}

// 投影：a 在 b 方向上的分量向量
function projVec(a, b) {
  const bb = normSq(b);
  if (!(bb > EPS)) return null;      // b 是零向量 ⇒ 方向未定义
  return scale(b, dot(a, b) / bb);
}

// 垂直分量（a 减去其在 b 上的投影）
function perpVec(a, b) {
  const p = projVec(a, b);
  if (!p) return null;
  return sub(a, p);
}

// ── 2D / 3D 特有 ────────────────────────────────────────────

// 2D 叉积（标量）：>0 表示 b 在 a 的逆时针侧
function cross2(a, b) {
  if (dim(a) !== 2 || dim(b) !== 2) throw new Error('cross2 只接受 2D');
  return a[0] * b[1] - a[1] * b[0];
}

// 3D 叉积（向量）：垂直于 a、b 张成的平面
function cross3(a, b) {
  if (dim(a) !== 3 || dim(b) !== 3) throw new Error('cross3 只接受 3D');
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

// 3D 混合积 a·(b×c)：绝对值是三个向量张成的平行六面体体积
function triple(a, b, c) { return dot(a, cross3(b, c)); }

// ── 角度 / 方向关系 ─────────────────────────────────────────

// 夹角（弧度，[0, π]）。零向量 ⇒ null（退化）
function angle(a, b) {
  const u = unit(a), v = unit(b);
  if (!u || !v) return null;
  // clamp 是必须的：浮点误差会让 dot 略超 ±1，Math.acos 直接返回 NaN
  return Math.acos(Math.max(-1, Math.min(1, dot(u, v))));
}

// 有向角（2D，弧度，(-π, π]）：从 a 转到 b
function angle2Signed(a, b) {
  if (dim(a) !== 2 || dim(b) !== 2) throw new Error('angle2Signed 只接受 2D');
  const u = unit(a), v = unit(b);
  if (!u || !v) return null;
  return Math.atan2(cross2(u, v), dot(u, v));
}

function isZero(a) { return normSq(a) <= EPS * EPS; }

// 平行：叉积模长 ≈ 0
function isParallel(a, b) {
  if (dim(a) !== dim(b)) return false;
  if (dim(a) === 2) return Math.abs(cross2(a, b)) <= EPS;
  if (dim(a) === 3) return normSq(cross3(a, b)) <= EPS * EPS;
  return false;
}

// 垂直：点积 ≈ 0
function isPerp(a, b) {
  if (dim(a) !== dim(b)) return false;
  return Math.abs(dot(a, b)) <= EPS;
}

// 共线（三点）：ab 与 ac 平行
function isCollinear(p, q, r) {
  try {
    return isParallel(sub(q, p), sub(r, p));
  } catch { return false; }
}

// ── 3×3 行列式与线性方程组（几何里的小规模专用）─────────────
function det3(m) {
  return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
}

// 解 3×3 线性方程组（克拉默法则）。奇异 ⇒ null（退化，不是 0）
function solve3(m, rhs) {
  const D = det3(m);
  if (Math.abs(D) <= EPS) return null;    // 奇异/近奇异：平行平面、共线约束等
  const col = j => [m[0][j], m[1][j], m[2][j]];
  const rep = j => m.map((row, i) => {
    const r = row.slice(); r[j] = rhs[i]; return r;
  });
  return [
    det3(rep(0)) / D,
    det3(rep(1)) / D,
    det3(rep(2)) / D
  ];
}

// 解 2×2 线性方程组
function solve2(m, rhs) {
  const D = m[0][0] * m[1][1] - m[0][1] * m[1][0];
  if (Math.abs(D) <= EPS) return null;
  return [
    (rhs[0] * m[1][1] - m[0][1] * rhs[1]) / D,
    (m[0][0] * rhs[1] - rhs[0] * m[1][0]) / D
  ];
}

// ── 数值整理（与 solver-service.js 的 detF 口径一致）─────────
// 消除 IEEE-754 末位 ULP 抖动，保证同输入输出字节级可复现
function detF(v) {
  return (typeof v === 'number' && isFinite(v)) ? Number(v.toFixed(12)) : null;
}
function detV(a) { return Array.isArray(a) ? a.map(detF) : null; }

module.exports = {
  EPS, vec, dim, sameDim,
  add, sub, scale, neg, dot, norm, normSq, dist, distSq, unit, lin,
  projVec, perpVec, cross2, cross3, triple,
  angle, angle2Signed, isZero, isParallel, isPerp, isCollinear,
  det3, solve3, solve2, detF, detV
};
