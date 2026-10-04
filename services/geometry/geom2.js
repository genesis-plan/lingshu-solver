/**
 * 2D 几何 —— 点 / 直线 / 线段 / 圆 / 多边形。
 *
 * 全部走**解析闭式解**，不迭代、不搜索。理由：闭式解是 O(1) 且误差只来自浮点
 * 舍入（~1e-16 相对），而迭代解还要多一份收敛误差。能用闭式解的几何问题
 * 拿去喂通用求解器是浪费 —— 求解器的价值在于**没有闭式解**的问题。
 *
 * 三条硬口径（与 vec.js 一致，这里是它们真正起作用的地方）：
 *
 * 1. **退化必须显式报出，不许静默给数**。
 *    两直线平行时「交点」不存在，返回 degenerate:'parallel' 而不是某个
 *    数值上碰巧算出来的点 —— 平行时克拉默分母≈0，算出来的点可以是任意远处
 *    的垃圾值，Agent 拿到它会当成真交点写进结论里。
 *
 * 2. **「在边界上」与「在内部」分开报**。
 *    点在圆上 / 点在多边形边上 / 两圆相切 —— 这些是同一类边界语义。
 *    统一用 touch|onBoundary 布尔量附在结果里，而不是让 Agent 自己去比大小。
 *
 * 3. **共线重叠不算失败**。
 *    两线段共线且重叠时，答案是**一个区间**，不是「不相交」。
 *    返回 degenerate:'collinear_overlap' + 重叠段，Agent 才知道该报重叠而不是报错。
 */
'use strict';

const V = require('./vec.js');
const { EPS } = V;

/** 直线的一般式 ax+by+c=0（法向已单位化，便于距离直接取 |a x + b y + c|） */
function lineFromPoints(a, b) {
  const d = V.sub(b, a);
  if (V.normSq(d) <= EPS * EPS) return null;       // 两点重合 ⇒ 直线未定义
  const n = V.unit([-d[1], d[0]]);
  if (!n) return null;
  return { a: n[0], b: n[1], c: -V.dot(n, a) };
}

/** 点到直线的垂足（直线由两点给出） */
function footOnLine(p, a, b) {
  const d = V.sub(b, a);
  const dd = V.normSq(d);
  if (!(dd > EPS)) return null;
  const t = V.dot(V.sub(p, a), d) / dd;
  return { foot: V.add(a, V.scale(d, t)), t };
}

/** 有向面积（鞋带公式的一半），符号表示绕向 */
function signedArea(poly) {
  let s = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return s / 2;
}

/** Andrew monotone chain 凸包 */
function convexHull(pts) {
  const P = pts.slice().sort((u, v) => (u[0] - v[0]) || (u[1] - v[1]));
  // 去重（输入常带重复点，不去重会让 cross=0 扰动 hull 的形状判定）
  const uniq = [];
  for (const p of P) {
    const last = uniq[uniq.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > EPS || Math.abs(last[1] - p[1]) > EPS) uniq.push(p);
  }
  if (uniq.length < 3) return uniq.slice();

  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of uniq) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= EPS) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = uniq.length - 1; i >= 0; i--) {
    const p = uniq[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= EPS) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

const OPS = {
  // ── 点与点 ────────────────────────────────────────────────

  'dist2': {
    dim: 2,
    brief: 'Euclidean distance between two 2D points.',
    args: { p: 'point', q: 'point' },
    run: ({ p, q }) => ({ value: V.detF(V.dist(p, q)) })
  },

  'midpoint2': {
    dim: 2,
    brief: 'Midpoint of two 2D points.',
    args: { p: 'point', q: 'point' },
    run: ({ p, q }) => ({ value: V.detV(V.scale(V.add(p, q), 0.5)) })
  },

  /** 定比分点（向量形式，2D/3D 通用语义） */
  'lerp2': {
    dim: 2,
    brief: 'Point p + lambda*(q-p) in 2D.',
    args: { p: 'point', q: 'point', lambda: 'number' },
    run: ({ p, q, lambda }) => ({ value: V.detV(V.add(p, V.scale(V.sub(q, p), lambda))) })
  },

  // ── 直线与线段 ────────────────────────────────────────────

  /**
   * 两点定直线，返回单位法向的一般式。
   * 法向单位化后 |a x + b y + c| 直接就是点到直线距离，省一次除法也省一处误差。
   */
  'line_from_points': {
    dim: 2,
    brief: 'Line through two points, as normalized ax+by+c=0 (unit normal, so |a*x+b*y+c| is the distance).',
    args: { a: 'point', b: 'point' },
    run: ({ a, b }) => {
      const L = lineFromPoints(a, b);
      if (!L) return { value: null, degenerate: 'coincident_points' };
      return { value: { a: V.detF(L.a), b: V.detF(L.b), c: V.detF(L.c) } };
    }
  },

  /** 点到（无限）直线距离 */
  'point_line_distance': {
    dim: 2,
    brief: 'Distance from point p to the infinite line through a and b.',
    args: { p: 'point', a: 'point', b: 'point' },
    run: ({ p, a, b }) => {
      const L = lineFromPoints(a, b);
      if (!L) return { value: null, degenerate: 'coincident_points' };
      return { value: V.detF(Math.abs(L.a * p[0] + L.b * p[1] + L.c)) };
    }
  },

  /** 点到线段距离（垂足落在线段外时取端点距离 —— 与直线距离的区别就在这里） */
  'point_segment_distance': {
    dim: 2,
    brief: 'Distance from point p to the finite segment [a,b] (clamps to endpoints, unlike point_line_distance).',
    args: { p: 'point', a: 'point', b: 'point' },
    run: ({ p, a, b }) => {
      const f = footOnLine(p, a, b);
      if (!f) return { value: V.detF(V.dist(p, a)), degenerate: 'degenerate_segment' };
      const t = Math.max(0, Math.min(1, f.t));
      const near = V.add(a, V.scale(V.sub(b, a), t));
      return { value: V.detF(V.dist(p, near)), nearest: V.detV(near), t: V.detF(t) };
    }
  },

  /** 投影点（垂足） */
  'project_point_line': {
    dim: 2,
    brief: 'Perpendicular projection (foot) of point p onto the line through a and b.',
    args: { p: 'point', a: 'point', b: 'point' },
    run: ({ p, a, b }) => {
      const f = footOnLine(p, a, b);
      if (!f) return { value: null, degenerate: 'coincident_points' };
      return { value: V.detV(f.foot), t: V.detF(f.t) };
    }
  },

  /**
   * 两直线交点（一般式）。平行时**必须**返回 degenerate，
   * 而不是返回克拉默分母≈0 时算出的巨大坐标。
   */
  'line_intersect': {
    dim: 2,
    brief: 'Intersection of lines a1*x+b1*y+c1=0 and a2*x+b2*y+c2=0. Parallel or coincident is reported as degenerate.',
    args: { a1: 'number', b1: 'number', c1: 'number', a2: 'number', b2: 'number', c2: 'number' },
    run: ({ a1, b1, c1, a2, b2, c2 }) => {
      const D = a1 * b2 - a2 * b1;
      if (Math.abs(D) <= EPS) {
        // 平行。再判是否重合：法向成比例且常数项也成同一比例
        const k = (Math.abs(a2) > EPS || Math.abs(b2) > EPS)
          ? ((Math.abs(a1) > Math.abs(b1)) ? a1 / a2 : b1 / b2) : null;
        const coincident = k !== null && Math.abs(c1 - k * c2) <= EPS;
        return { value: null, degenerate: coincident ? 'coincident' : 'parallel' };
      }
      return {
        value: V.detV([
          (b1 * c2 - b2 * c1) / D,
          (c1 * a2 - a1 * c2) / D
        ])
      };
    }
  },

  /** 一般式 ↔ 两点式的桥：先由四点取两条直线再求交 */
  'line_intersect_points': {
    dim: 2,
    brief: 'Intersection of the line through p1,p2 with the line through p3,p4 (infinite lines).',
    args: { p1: 'point', p2: 'point', p3: 'point', p4: 'point' },
    run: ({ p1, p2, p3, p4 }) => {
      const L1 = lineFromPoints(p1, p2), L2 = lineFromPoints(p3, p4);
      if (!L1 || !L2) return { value: null, degenerate: 'coincident_points' };
      const D = L1.a * L2.b - L2.a * L1.b;
      if (Math.abs(D) <= EPS) return { value: null, degenerate: 'parallel' };
      return {
        value: V.detV([
          (L1.b * L2.c - L2.b * L1.c) / D,
          (L1.c * L2.a - L2.c * L1.a) / D
        ])
      };
    }
  },

  /**
   * 两线段交点。三种真结果：
   *   相交于一点 / 不相交 / 共线重叠（答案是一个区间）。
   * 共线重叠单独分出来，是因为它既不是「交于一点」也不是「不相交」。
   */
  'segment_intersect': {
    dim: 2,
    brief: 'Intersection of segments [p1,p2] and [p3,p4]. Returns the point, or degenerate=no_intersection / collinear_overlap.',
    args: { p1: 'point', p2: 'point', p3: 'point', p4: 'point' },
    run: ({ p1, p2, p3, p4 }) => {
      const d1 = V.sub(p2, p1), d2 = V.sub(p4, p3), w = V.sub(p3, p1);
      const den = V.cross2(d1, d2);
      const l1 = V.normSq(d1), l2 = V.normSq(d2);

      if (Math.abs(den) <= EPS) {
        if (!(l1 > EPS) || !(l2 > EPS)) return { value: null, degenerate: 'degenerate_segment' };
        // 平行。共线判据：p3 也在第一条直线上
        if (Math.abs(V.cross2(d1, w)) > EPS) return { value: null, degenerate: 'no_intersection', parallel: true };
        // 共线 ⇒ 投影到 d1 上做 1D 区间求交
        const t3 = V.dot(w, d1) / l1, t4 = t3 + V.dot(d2, d1) / l1;
        const lo = Math.max(0, Math.min(t3, t4)), hi = Math.min(1, Math.max(t3, t4));
        if (lo > hi + EPS) return { value: null, degenerate: 'no_intersection', collinear: true };
        const A = V.add(p1, V.scale(d1, lo)), B = V.add(p1, V.scale(d1, hi));
        return {
          value: null,
          degenerate: (Math.abs(hi - lo) <= EPS) ? 'touch' : 'collinear_overlap',
          overlap: { from: V.detV(A), to: V.detV(B), length: V.detF(V.dist(A, B)) }
        };
      }
      const t = V.cross2(w, d2) / den;
      const s = V.cross2(w, d1) / den;
      if (t < -EPS || t > 1 + EPS || s < -EPS || s > 1 + EPS) {
        return { value: null, degenerate: 'no_intersection' };
      }
      const P = V.add(p1, V.scale(d1, t));
      return { value: V.detV(P), t: V.detF(t), s: V.detF(s) };
    }
  },

  'segment_length': {
    dim: 2,
    brief: 'Length of segment [p,q].',
    args: { p: 'point', q: 'point' },
    run: ({ p, q }) => ({ value: V.detF(V.dist(p, q)) })
  },

  // ── 角度 ──────────────────────────────────────────────────

  /** 三点夹角（顶点在 mid） */
  'angle_3points': {
    dim: 2,
    brief: 'Angle (radians) at vertex mid between rays mid->a and mid->b.',
    args: { a: 'point', mid: 'point', b: 'point' },
    run: ({ a, mid, b }) => {
      const u = V.sub(a, mid), v = V.sub(b, mid);
      if (V.isZero(u) || V.isZero(v)) return { value: null, degenerate: 'degenerate_ray' };
      return { value: V.detF(V.angle(u, v)), degrees: V.detF(V.angle(u, v) * 180 / Math.PI) };
    }
  },

  /** 两向量夹角 */
  'angle_vectors': {
    dim: 2,
    brief: 'Angle (radians) between two 2D vectors.',
    args: { u: 'point', v: 'point' },
    run: ({ u, v }) => {
      const r = V.angle(u, v);
      if (r === null) return { value: null, degenerate: 'zero_vector' };
      return { value: V.detF(r), degrees: V.detF(r * 180 / Math.PI) };
    }
  },

  /** 两直线夹角（取锐角，[0, π/2]） */
  'line_angle': {
    dim: 2,
    brief: 'Acute angle (radians) between lines a1*x+b1*y+c1=0 and a2*x+b2*y+c2=0.',
    args: { a1: 'number', b1: 'number', c1: 'number', a2: 'number', b2: 'number', c2: 'number' },
    run: ({ a1, b1, c1, a2, b2, c2 }) => {
      const n1 = Math.hypot(a1, b1), n2 = Math.hypot(a2, b2);
      if (!(n1 > EPS) || !(n2 > EPS)) return { value: null, degenerate: 'degenerate_line' };
      const c = Math.abs(a1 * a2 + b1 * b2) / (n1 * n2);
      const r = Math.acos(Math.max(-1, Math.min(1, c)));
      return { value: V.detF(r), degrees: V.detF(r * 180 / Math.PI) };
    }
  },

  // ── 三角形 ────────────────────────────────────────────────

  'triangle_area': {
    dim: 2,
    brief: 'Area of triangle a,b,c (always non-negative).',
    args: { a: 'point', b: 'point', c: 'point' },
    run: ({ a, b, c }) => {
      const s = Math.abs(V.cross2(V.sub(b, a), V.sub(c, a))) / 2;
      // 面积≈0 意味着三点共线 —— 是退化三角形，不是「面积很小的三角形」
      return { value: V.detF(s), degenerate: (s <= EPS) ? 'collinear' : null };
    }
  },

  'triangle_centroid': {
    dim: 2,
    brief: 'Centroid of triangle a,b,c.',
    args: { a: 'point', b: 'point', c: 'point' },
    run: ({ a, b, c }) => ({ value: V.detV(V.scale(V.add(V.add(a, b), c), 1 / 3)) })
  },

  /** 内心：按对边长度加权 */
  'triangle_incenter': {
    dim: 2,
    brief: 'Incenter of triangle a,b,c.',
    args: { a: 'point', b: 'point', c: 'point' },
    run: ({ a, b, c }) => {
      const la = V.dist(b, c), lb = V.dist(a, c), lc = V.dist(a, b);
      const s = la + lb + lc;
      if (!(s > EPS)) return { value: null, degenerate: 'degenerate_triangle' };
      return {
        value: V.detV([
          (la * a[0] + lb * b[0] + lc * c[0]) / s,
          (la * a[1] + lb * b[1] + lc * c[1]) / s
        ]),
        // 内切圆半径 r = 2*Area / 周长和 = |cross| / s
        inradius: V.detF(Math.abs(V.cross2(V.sub(b, a), V.sub(c, a))) / s)
      };
    }
  },

  // ── 多边形 ────────────────────────────────────────────────

  'polygon_area': {
    dim: 2,
    brief: 'Area of a simple polygon (shoelace formula). Absolute value; signedArea carries vertex orientation.',
    args: { poly: 'points' },
    minPoints: 3,
    run: ({ poly }) => {
      if (poly.length < 3) return { value: null, degenerate: 'need_3_points' };
      const s = signedArea(poly);
      return { value: V.detF(Math.abs(s)), signedArea: V.detF(s), orientation: s > EPS ? 'ccw' : (s < -EPS ? 'cw' : 'degenerate') };
    }
  },

  'polygon_perimeter': {
    dim: 2,
    brief: 'Perimeter of a polygon (closed: last vertex connects back to the first).',
    args: { poly: 'points' },
    minPoints: 2,
    run: ({ poly }) => {
      let s = 0;
      for (let i = 0, n = poly.length; i < n; i++) s += V.dist(poly[i], poly[(i + 1) % n]);
      return { value: V.detF(s) };
    }
  },

  /**
   * 多边形面积质心。退化（面积≈0）时返回顶点平均 —— 但**同时标 degenerate**，
   * 因为面积质心在退化多边形上无定义，顶点平均只是个可用的替代值，不是答案。
   */
  'polygon_centroid': {
    dim: 2,
    brief: 'Area centroid of a polygon. Falls back to the vertex average only when the area is degenerate, and says so.',
    args: { poly: 'points' },
    minPoints: 3,
    run: ({ poly }) => {
      const s = signedArea(poly);
      if (Math.abs(s) <= EPS) {
        const n = poly.length;
        const avg = [0, 1].map(k => poly.reduce((t, p) => t + p[k], 0) / n);
        return { value: V.detV(avg), degenerate: 'zero_area', note: 'area centroid undefined; vertex average returned' };
      }
      let cx = 0, cy = 0;
      for (let i = 0, n = poly.length; i < n; i++) {
        const p = poly[i], q = poly[(i + 1) % n];
        const cr = p[0] * q[1] - q[0] * p[1];
        cx += (p[0] + q[0]) * cr;
        cy += (p[1] + q[1]) * cr;
      }
      return { value: V.detV([cx / (6 * s), cy / (6 * s)]) };
    }
  },

  /**
   * 点在多边形内（射线法）。边界单独判定并报 onBoundary。
   * 边界必须单独报：Agent 拿到 true/false 会直接写进结论，
   * 而「在边上」和「在内部」在多数下游语义里不是一回事（如碰撞检测、区域归属）。
   */
  'point_in_polygon': {
    dim: 2,
    brief: 'Whether point p is inside a polygon. onBoundary is reported separately from inside.',
    args: { p: 'point', poly: 'points' },
    minPoints: 3,
    run: ({ p, poly }) => {
      const n = poly.length;
      if (n < 3) return { value: null, degenerate: 'need_3_points' };
      // 先在边上？
      for (let i = 0; i < n; i++) {
        const a = poly[i], b = poly[(i + 1) % n];
        const d = V.sub(b, a), w = V.sub(p, a);
        const dd = V.normSq(d);
        if (dd <= EPS) continue;
        if (Math.abs(V.cross2(d, w)) <= EPS) {
          const t = V.dot(w, d) / dd;
          if (t >= -EPS && t <= 1 + EPS) return { value: true, onBoundary: true, edge: i };
        }
      }
      // 射线法
      let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const a = poly[i], b = poly[j];
        if ((a[1] > p[1]) !== (b[1] > p[1])) {
          const x = a[0] + (p[1] - a[1]) / (b[1] - a[1]) * (b[0] - a[0]);
          if (p[0] < x) inside = !inside;
        }
      }
      return { value: inside, onBoundary: false };
    }
  },

  'convex_hull': {
    dim: 2,
    brief: 'Convex hull of a point set, returned in counter-clockwise order.',
    args: { pts: 'points' },
    minPoints: 1,
    run: ({ pts }) => {
      if (pts.length < 3) return { value: V.detV(pts), degenerate: 'too_few_points' };
      const h = convexHull(pts);
      return { value: h.map(V.detV), size: h.length };
    }
  },

  /** 凸性判定：所有相邻叉积同号 */
  'polygon_is_convex': {
    dim: 2,
    brief: 'Whether a polygon is convex (strict: no collinear runs allowed).',
    args: { poly: 'points' },
    minPoints: 3,
    run: ({ poly }) => {
      const n = poly.length;
      if (n < 3) return { value: null, degenerate: 'need_3_points' };
      let sign = 0;
      for (let i = 0; i < n; i++) {
        const a = poly[i], b = poly[(i + 1) % n], c = poly[(i + 2) % n];
        const cr = V.cross2(V.sub(b, a), V.sub(c, b));
        if (Math.abs(cr) <= EPS) return { value: false, degenerate: 'collinear_vertices' };
        const s = cr > 0 ? 1 : -1;
        if (sign === 0) sign = s;
        else if (s !== sign) return { value: false };
      }
      return { value: true };
    }
  },

  // ── 圆 ────────────────────────────────────────────────────

  /** 三点定圆。共线 ⇒ 无（有限半径）圆，这是真退化 */
  'circle_from_3points': {
    dim: 2,
    brief: 'Circle through three points: center and radius. Collinear input is reported as degenerate.',
    args: { a: 'point', b: 'point', c: 'point' },
    run: ({ a, b, c }) => {
      const m = [
        [2 * (b[0] - a[0]), 2 * (b[1] - a[1])],
        [2 * (c[0] - a[0]), 2 * (c[1] - a[1])]
      ];
      const rhs = [
        V.normSq(b) - V.normSq(a),
        V.normSq(c) - V.normSq(a)
      ];
      const o = V.solve2(m, rhs);
      if (!o) return { value: null, degenerate: 'collinear' };
      const r = V.dist(o, a);
      return {
        value: { center: V.detV(o), radius: V.detF(r) },
        area: V.detF(Math.PI * r * r),
        circumference: V.detF(2 * Math.PI * r)
      };
    }
  },

  /** 点在圆内/上/外 */
  'point_circle_position': {
    dim: 2,
    brief: 'Whether point p is inside, on, or outside the circle (center, r).',
    args: { p: 'point', center: 'point', r: 'number' },
    run: ({ p, center, r }) => {
      const d = V.dist(p, center);
      if (Math.abs(d - r) <= EPS) return { value: 'on', distance: V.detF(d) };
      if (d < r) return { value: 'inside', distance: V.detF(d) };
      return { value: 'outside', distance: V.detF(d) };
    }
  },

  /**
   * 圆与直线交点（0/1/2）。segment=true 时先裁到线段再判。
   * 相切返回 1 个点并标 tangent，不返回两个重合点 —— 后者会让 Agent 以为有两个交点。
   */
  'circle_line_intersect': {
    dim: 2,
    brief: 'Intersections of circle (center,r) with line through a,b. 0, 1 (tangent) or 2 points. segment=true restricts to the finite segment.',
    args: { center: 'point', r: 'number', a: 'point', b: 'point', segment: 'boolean?' },
    run: ({ center, r, a, b, segment }) => {
      const d = V.sub(b, a);
      const dd = V.normSq(d);
      if (!(dd > EPS)) return { value: null, degenerate: 'degenerate_line' };
      const f = V.sub(a, center);
      const B = V.dot(f, d);
      const C = V.normSq(f) - r * r;
      const disc = B * B - dd * C;

      if (disc < -EPS) return { value: [], count: 0, degenerate: 'no_intersection' };
      const sq = Math.sqrt(Math.max(0, disc));
      let ts = (Math.abs(disc) <= EPS) ? [-B / dd] : [(-B - sq) / dd, (-B + sq) / dd];
      if (segment) ts = ts.filter(t => t >= -EPS && t <= 1 + EPS);
      const pts = ts.map(t => V.detV(V.add(a, V.scale(d, t))));
      return { value: pts, count: pts.length, tangent: pts.length === 1 };
    }
  },

  /**
   * 两圆交点。五种情形：外离 / 内含 / 重合 / 相切（内切或外切）/ 两交点。
   * 重合是退化（无穷多交点），必须单独报，不能当成「两交点」。
   */
  'circle_circle_intersect': {
    dim: 2,
    brief: 'Intersections of two circles. Coincident circles (infinitely many) are reported as degenerate, not as two points.',
    args: { c1: 'point', r1: 'number', c2: 'point', r2: 'number' },
    run: ({ c1, r1, c2, r2 }) => {
      const dv = V.sub(c2, c1), d = V.norm(dv);
      if (d <= EPS && Math.abs(r1 - r2) <= EPS) {
        return { value: null, degenerate: 'coincident' };
      }
      if (d > r1 + r2 + EPS) return { value: [], count: 0, degenerate: 'separate' };
      if (d < Math.abs(r1 - r2) - EPS) return { value: [], count: 0, degenerate: 'contained' };
      // 相切（外切或内切）
      if (Math.abs(d - (r1 + r2)) <= EPS || Math.abs(d - Math.abs(r1 - r2)) <= EPS) {
        const t = (d <= Math.abs(r1 - r2) + EPS && Math.abs(d - Math.abs(r1 - r2)) <= EPS) ? -r1 / d : r1 / d;
        const P = V.add(c1, V.scale(dv, t));
        return { value: [V.detV(P)], count: 1, tangent: true };
      }
      const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
      const h2 = r1 * r1 - a * a;
      const h = Math.sqrt(Math.max(0, h2));
      const base = V.add(c1, V.scale(dv, a / d));
      const perp = V.scale([-dv[1], dv[0]], 1 / d);
      return {
        value: [V.detV(V.add(base, V.scale(perp, h))), V.detV(V.sub(base, V.scale(perp, h)))],
        count: 2
      };
    }
  },

  /** 圆的基本量 */
  'circle_measure': {
    dim: 2,
    brief: 'Area and circumference of a circle of radius r.',
    args: { r: 'number' },
    run: ({ r }) => ({ value: { area: V.detF(Math.PI * r * r), circumference: V.detF(2 * Math.PI * r) } })
  },

  'sector_area': {
    dim: 2,
    brief: 'Area of a circular sector of radius r and central angle theta (radians): r^2*theta/2.',
    args: { r: 'number', theta: 'number' },
    run: ({ r, theta }) => ({ value: V.detF(r * r * theta / 2), arcLength: V.detF(r * theta) })
  },

  // ── 变换 ──────────────────────────────────────────────────

  /** 绕 center 逆时针旋转 angle */
  'rotate_point': {
    dim: 2,
    brief: 'Rotate point p about center by angle radians (counter-clockwise). center defaults to origin.',
    args: { p: 'point', angle: 'number', center: 'point?' },
    run: ({ p, angle, center }) => {
      const c = center || [0, 0];
      const w = V.sub(p, c);
      const co = Math.cos(angle), si = Math.sin(angle);
      return { value: V.detV(V.add(c, [w[0] * co - w[1] * si, w[0] * si + w[1] * co])) };
    }
  },

  /** 关于直线反射 */
  'reflect_point_line': {
    dim: 2,
    brief: 'Mirror point p across the line through a and b.',
    args: { p: 'point', a: 'point', b: 'point' },
    run: ({ p, a, b }) => {
      const f = footOnLine(p, a, b);
      if (!f) return { value: null, degenerate: 'coincident_points' };
      return { value: V.detV(V.sub(V.scale(f.foot, 2), p)) };
    }
  },

  /** 关于 center 缩放 */
  'scale_point': {
    dim: 2,
    brief: 'Scale point p about center by factor k. center defaults to origin.',
    args: { p: 'point', k: 'number', center: 'point?' },
    run: ({ p, k, center }) => {
      const c = center || [0, 0];
      return { value: V.detV(V.add(c, V.scale(V.sub(p, c), k))) };
    }
  },

  /** 过定点作已知直线的平行线 / 垂线 —— 几何作图的高频需求 */
  'parallel_through': {
    dim: 2,
    brief: 'Line through point p parallel to the line a1*x+b1*y+c1=0.',
    args: { p: 'point', a1: 'number', b1: 'number', c1: 'number' },
    run: ({ p, a1, b1, c1 }) => {
      const n = Math.hypot(a1, b1);
      if (!(n > EPS)) return { value: null, degenerate: 'degenerate_line' };
      const A = a1 / n, B = b1 / n;
      return { value: { a: V.detF(A), b: V.detF(B), c: V.detF(-(A * p[0] + B * p[1])) } };
    }
  },

  'perpendicular_through': {
    dim: 2,
    brief: 'Line through point p perpendicular to the line a1*x+b1*y+c1=0.',
    args: { p: 'point', a1: 'number', b1: 'number', c1: 'number' },
    run: ({ p, a1, b1, c1 }) => {
      const n = Math.hypot(a1, b1);
      if (!(n > EPS)) return { value: null, degenerate: 'degenerate_line' };
      // 原法向 (a1,b1) 旋转 90° ⇒ 新法向 (-b1, a1)
      const A = -b1 / n, B = a1 / n;
      return { value: { a: V.detF(A), b: V.detF(B), c: V.detF(-(A * p[0] + B * p[1])) } };
    }
  }
};

module.exports = { OPS, lineFromPoints, footOnLine, signedArea, convexHull };
