/**
 * 1D 几何 —— 数轴上的区间代数与定比分点。
 *
 * 为什么 1D 也要单独一层（而不是「2D 把 y 置 0 就行了」）：
 *   1D 的核心对象不是点，是**区间**。区间的交/并/覆盖在 2D 没有对应物
 *   （2D 的对应物是矩形族，不是单个矩形）。强行用 2D 表达会让「两区间不相交」
 *   和「两区间相切」这类边界语义丢掉。
 *
 * 口径（与 vec.js 一致）：
 *   - 退化返回 degenerate 字符串，不返回 NaN、不静默给 0。
 *   - 空集不等于「长度为 0 的区间」：前者 degenerate='disjoint'，
 *     后者 value={lo:5,hi:5}。这两件事对 Agent 的下游判断完全不同。
 */
'use strict';

const V = require('./vec.js');
const { EPS } = V;

/** 规范化区间：允许调用方给反序端点 */
function normIv(a, b) {
  return a <= b ? { lo: a, hi: b } : { lo: b, hi: a };
}

const OPS = {
  // ── 距离与分点 ────────────────────────────────────────────

  'dist1': {
    dim: 1,
    brief: 'Distance between two points on a line.',
    args: { p: 'point', q: 'point' },
    run: ({ p, q }) => ({ value: Math.abs(q[0] - p[0]) })
  },

  'midpoint1': {
    dim: 1,
    brief: 'Midpoint of two points on a line.',
    args: { p: 'point', q: 'point' },
    run: ({ p, q }) => ({ value: [V.detF((p[0] + q[0]) / 2)] })
  },

  /**
   * 定比分点：x = p + lambda*(q - p)。
   * lambda ∈ (0,1) 内分；lambda<0 或 >1 外分。这是 AP/CS 类几何的主力算子。
   */
  'divide_point': {
    dim: 1,
    brief: 'Point dividing segment p->q by ratio lambda: x = p + lambda*(q-p). lambda in (0,1) is internal, outside is external.',
    args: { p: 'point', q: 'point', lambda: 'number' },
    run: ({ p, q, lambda }) => ({ value: [V.detF(p[0] + lambda * (q[0] - p[0]))] })
  },

  /**
   * 反求分比：已知 x 在 pq 上，求 lambda。
   * p==q 时方向未定义 —— 这不是「lambda=0」，是**问题本身退化**。
   */
  'divide_ratio': {
    dim: 1,
    brief: 'Inverse of divide_point: find lambda such that x = p + lambda*(q-p).',
    args: { p: 'point', q: 'point', x: 'point' },
    run: ({ p, q, x }) => {
      const d = q[0] - p[0];
      if (Math.abs(d) <= EPS) return { value: null, degenerate: 'degenerate_segment' };
      return { value: V.detF((x[0] - p[0]) / d) };
    }
  },

  /**
   * 调和共轭：给定 a,b 与 c，求 d 使交比 (a,b;c,d) = -1。
   * 公式 d = [(c-a)b + (c-b)a] / (2c-a-b)。
   * c 恰为 ab 中点时分母为 0 ⇒ d 在无穷远，这是真退化（不是 d=0）。
   */
  'harmonic_conjugate': {
    dim: 1,
    brief: 'Harmonic conjugate d of c w.r.t. a,b: cross-ratio (a,b;c,d) = -1.',
    args: { a: 'point', b: 'point', c: 'point' },
    run: ({ a, b, c }) => {
      const den = 2 * c[0] - a[0] - b[0];
      if (Math.abs(den) <= EPS) {
        return { value: null, degenerate: 'conjugate_at_infinity' };
      }
      return { value: [V.detF(((c[0] - a[0]) * b[0] + (c[0] - b[0]) * a[0]) / den)] };
    }
  },

  // ── 区间代数 ──────────────────────────────────────────────

  'interval_length': {
    dim: 1,
    brief: 'Length of interval [a,b] (order-insensitive).',
    args: { a: 'point', b: 'point' },
    run: ({ a, b }) => ({ value: V.detF(Math.abs(b[0] - a[0])) })
  },

  'interval_midpoint': {
    dim: 1,
    brief: 'Midpoint of interval [a,b].',
    args: { a: 'point', b: 'point' },
    run: ({ a, b }) => ({ value: [V.detF((a[0] + b[0]) / 2)] })
  },

  /**
   * 两区间之交。空集用 degenerate='disjoint' 表示，
   * **不**返回一个假的长度为 0 的区间 —— 后者会让下游把「不相交」误读成「交于一点」。
   */
  'interval_intersect': {
    dim: 1,
    brief: 'Intersection of [a,b] and [c,d]. Empty set is reported as degenerate=disjoint, not as a zero-length interval.',
    args: { a: 'point', b: 'point', c: 'point', d: 'point' },
    run: ({ a, b, c, d }) => {
      const A = normIv(a[0], b[0]), B = normIv(c[0], d[0]);
      const lo = Math.max(A.lo, B.lo), hi = Math.min(A.hi, B.hi);
      if (lo > hi + EPS) return { value: null, degenerate: 'disjoint' };
      const touch = Math.abs(lo - hi) <= EPS;
      return { value: { lo: V.detF(lo), hi: V.detF(hi) }, touch };
    }
  },

  /**
   * 两区间之并。不相连时不是错误，返回两段（degenerate='disconnected'），
   * 因为「两个分离区间」是这个问题的**真实答案**，不是失败。
   */
  'interval_union': {
    dim: 1,
    brief: 'Union of [a,b] and [c,d]. If they are disjoint the result is two segments (degenerate=disconnected).',
    args: { a: 'point', b: 'point', c: 'point', d: 'point' },
    run: ({ a, b, c, d }) => {
      const A = normIv(a[0], b[0]), B = normIv(c[0], d[0]);
      if (Math.max(A.lo, B.lo) <= Math.min(A.hi, B.hi) + EPS) {
        // 相交或相切 ⇒ 并是一个区间
        return {
          value: { lo: V.detF(Math.min(A.lo, B.lo)), hi: V.detF(Math.max(A.hi, B.hi)) },
          segments: null
        };
      }
      const segs = A.lo <= B.lo ? [A, B] : [B, A];
      return {
        value: null,
        degenerate: 'disconnected',
        segments: segs.map(s => ({ lo: V.detF(s.lo), hi: V.detF(s.hi) }))
      };
    }
  },

  /** 最小覆盖区间（凸包在 1D 的形式） */
  'interval_hull': {
    dim: 1,
    brief: 'Smallest interval covering [a,b] and [c,d].',
    args: { a: 'point', b: 'point', c: 'point', d: 'point' },
    run: ({ a, b, c, d }) => {
      const A = normIv(a[0], b[0]), B = normIv(c[0], d[0]);
      return { value: { lo: V.detF(Math.min(A.lo, B.lo)), hi: V.detF(Math.max(A.hi, B.hi)) } };
    }
  },

  'interval_overlap_length': {
    dim: 1,
    brief: 'Length of overlap between [a,b] and [c,d]; 0 when disjoint.',
    args: { a: 'point', b: 'point', c: 'point', d: 'point' },
    run: ({ a, b, c, d }) => {
      const A = normIv(a[0], b[0]), B = normIv(c[0], d[0]);
      const ov = Math.min(A.hi, B.hi) - Math.max(A.lo, B.lo);
      return { value: V.detF(ov > 0 ? ov : 0) };
    }
  },

  'interval_contains': {
    dim: 1,
    brief: 'Whether point x lies inside [a,b] (endpoints included).',
    args: { x: 'point', a: 'point', b: 'point' },
    run: ({ x, a, b }) => {
      const I = normIv(a[0], b[0]);
      return { value: x[0] >= I.lo - EPS && x[0] <= I.hi + EPS };
    }
  },

  'point_between': {
    dim: 1,
    brief: 'Whether x lies strictly between a and b (endpoints excluded).',
    args: { x: 'point', a: 'point', b: 'point' },
    run: ({ x, a, b }) => {
      const I = normIv(a[0], b[0]);
      return { value: x[0] > I.lo + EPS && x[0] < I.hi - EPS };
    }
  }
};

module.exports = { OPS };
