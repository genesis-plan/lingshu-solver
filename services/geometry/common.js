/**
 * 任意维几何 —— 与维度无关的那部分算子。
 *
 * 单独成层的理由：距离、质心、包围盒这些在 1D/2D/3D 上公式完全相同，
 * 写三遍必然漂移。反过来，把它们硬塞进某一维的模块会让「这个 op 支持几维」
 * 变成要靠读代码才知道的隐式约定 —— Agent 侧无法预判，只能试错。
 *
 * 约定：本层 op 的 dim = 0，含义是**任意维**，由输入的第一个点决定维度，
 * 其余点必须与它同维（vec.sameDim 会抛错）。
 */
'use strict';

const V = require('./vec.js');
const { EPS } = V;

/** 从点集推断维度：全部点必须同维，否则抛错（不静默补零，见 vec.js 原则 1） */
function inferDim(lists) {
  let d = 0;
  for (const p of lists) {
    if (!Array.isArray(p)) continue;
    if (d === 0) d = p.length;
    else if (p.length !== d) throw new Error(`维度不一致：${d}D 与 ${p.length}D`);
  }
  return d;
}

const OPS = {
  'distance': {
    dim: 0,
    brief: 'Euclidean distance between two points of any dimension (1D/2D/3D).',
    args: { p: 'point', q: 'point' },
    run: ({ p, q }) => ({ value: V.detF(V.dist(p, q)) })
  },

  'midpoint': {
    dim: 0,
    brief: 'Midpoint of two points of any dimension.',
    args: { p: 'point', q: 'point' },
    run: ({ p, q }) => ({ value: V.detV(V.scale(V.add(p, q), 0.5)) })
  },

  'lerp': {
    dim: 0,
    brief: 'Point p + lambda*(q-p) in any dimension. lambda in (0,1) is internal, outside is external.',
    args: { p: 'point', q: 'point', lambda: 'number' },
    run: ({ p, q, lambda }) => ({ value: V.detV(V.add(p, V.scale(V.sub(q, p), lambda))) })
  },

  'norm': {
    dim: 0,
    brief: 'Euclidean length of a vector of any dimension.',
    args: { v: 'point' },
    run: ({ v }) => ({ value: V.detF(V.norm(v)) })
  },

  'normalize': {
    dim: 0,
    brief: 'Unit vector in the same direction. Zero vector is degenerate (no direction), reported as such.',
    args: { v: 'point' },
    run: ({ v }) => {
      const u = V.unit(v);
      if (!u) return { value: null, degenerate: 'zero_vector' };
      return { value: V.detV(u) };
    }
  },

  'dot': {
    dim: 0,
    brief: 'Dot product of two vectors of any dimension.',
    args: { u: 'point', v: 'point' },
    run: ({ u, v }) => ({ value: V.detF(V.dot(u, v)) })
  },

  /**
   * 叉积。2D 给标量（有向面积），3D 给向量。
   * 其他维度**没有**叉积（不是「返回 0」，是数学上不存在）—— 这是真退化。
   */
  'cross': {
    dim: 0,
    brief: 'Cross product: scalar for 2D (signed area), vector for 3D. Other dimensions have no cross product.',
    args: { u: 'point', v: 'point' },
    run: ({ u, v }) => {
      if (u.length === 2 && v.length === 2) return { value: V.detF(V.cross2(u, v)), kind: 'scalar' };
      if (u.length === 3 && v.length === 3) {
        const c = V.cross3(u, v);
        return { value: V.detV(c), kind: 'vector', magnitude: V.detF(V.norm(c)) };
      }
      return { value: null, degenerate: 'unsupported_dimension' };
    }
  },

  /** 投影：u 在 v 方向上的分量向量 */
  'project': {
    dim: 0,
    brief: 'Vector projection of u onto v. Zero v is degenerate (direction undefined).',
    args: { u: 'point', v: 'point' },
    run: ({ u, v }) => {
      const p = V.projVec(u, v);
      if (!p) return { value: null, degenerate: 'zero_direction' };
      return { value: V.detV(p), scalar: V.detF(V.dot(u, v) / V.norm(v)) };
    }
  },

  /** 剔除 v 方向后的垂直分量 */
  'reject': {
    dim: 0,
    brief: 'Component of u perpendicular to v (u minus its projection onto v).',
    args: { u: 'point', v: 'point' },
    run: ({ u, v }) => {
      const p = V.perpVec(u, v);
      if (!p) return { value: null, degenerate: 'zero_direction' };
      return { value: V.detV(p), magnitude: V.detF(V.norm(p)) };
    }
  },

  'translate': {
    dim: 0,
    brief: 'Translate point p by vector v.',
    args: { p: 'point', v: 'point' },
    run: ({ p, v }) => ({ value: V.detV(V.add(p, v)) })
  },

  /** 点集质心（等权平均） */
  'centroid': {
    dim: 0,
    brief: 'Centroid (unweighted average) of a point set of any dimension.',
    args: { pts: 'points' },
    minPoints: 1,
    run: ({ pts }) => {
      const d = pts[0].length;
      const c = new Array(d).fill(0);
      for (const p of pts) for (let i = 0; i < d; i++) c[i] += p[i];
      return { value: V.detV(c.map(x => x / pts.length)), count: pts.length };
    }
  },

  /** 轴对齐包围盒 */
  'bbox': {
    dim: 0,
    brief: 'Axis-aligned bounding box of a point set: min, max, size, center and diagonal length.',
    args: { pts: 'points' },
    minPoints: 1,
    run: ({ pts }) => {
      const d = pts[0].length;
      const lo = pts[0].slice(), hi = pts[0].slice();
      for (const p of pts) for (let i = 0; i < d; i++) {
        if (p[i] < lo[i]) lo[i] = p[i];
        if (p[i] > hi[i]) hi[i] = p[i];
      }
      const size = lo.map((x, i) => hi[i] - x);
      return {
        value: { min: V.detV(lo), max: V.detV(hi) },
        size: V.detV(size),
        center: V.detV(lo.map((x, i) => (x + hi[i]) / 2)),
        diagonal: V.detF(Math.sqrt(size.reduce((s, x) => s + x * x, 0)))
      };
    }
  },

  /** 点集直径（最远两点距离）。O(n^2)，点多了会慢 —— 如实标 complexity */
  'diameter': {
    dim: 0,
    brief: 'Diameter of a point set (max pairwise distance). O(n^2): fine for hundreds of points, slow for tens of thousands.',
    args: { pts: 'points' },
    minPoints: 2,
    run: ({ pts }) => {
      let best = 0, bp = null;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const d = V.distSq(pts[i], pts[j]);
          if (d > best) { best = d; bp = [pts[i], pts[j]]; }
        }
      }
      return { value: V.detF(Math.sqrt(best)), pair: bp ? bp.map(V.detV) : null };
    }
  }
};

module.exports = { OPS, inferDim };
