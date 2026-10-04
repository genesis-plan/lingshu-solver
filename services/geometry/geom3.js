/**
 * 3D 几何 —— 点 / 直线 / 平面 / 球 / 多面体。
 *
 * 3D 比 2D 多出来的核心难度是**自由度**：
 *   2D 里「两直线不平行 ⇒ 必交于一点」，3D 里两直线既不平行也不相交才是常态（异面）。
 *   所以 3D 的每个「求交」算子都必须先回答「是否存在唯一交点」，
 *   异面直线的「最短距离」不是失败，是这个问题的正确答案。
 *
 * 口径（沿用 1D/2D 层）：
 *   - 退化显式报（平行 / 共线 / 共面 / 重合 / 奇异），不静默返回垃圾坐标。
 *   - 「无交点」与「无穷多交点」是两件不同的事，degenerate 里分开写：
 *       no_intersection（0 个）vs coincident / line_in_plane（无穷多个）。
 *     这两者对 Agent 的下游分支完全不同，混在一起是最常见的 3D 幻觉源。
 *   - 涉及方向的量（法向、旋转轴）都单位化，让距离可直接取点积。
 */
'use strict';

const V = require('./vec.js');
const { EPS } = V;

/**
 * 三点定平面，返回单位法向 n 与常数 d：n·x + d = 0。
 * 共线 ⇒ 平面未定义（真退化，不是「任意平面」）。
 */
function planeFrom3(a, b, c) {
  const n = V.cross3(V.sub(b, a), V.sub(c, a));
  const nn = V.norm(n);
  if (!(nn > EPS)) return null;
  const u = V.scale(n, 1 / nn);
  return { n: u, d: -V.dot(u, a) };
}

const OPS = {
  // ── 点与点 ────────────────────────────────────────────────

  'dist3': {
    dim: 3,
    brief: 'Euclidean distance between two 3D points.',
    args: { p: 'point', q: 'point' },
    run: ({ p, q }) => ({ value: V.detF(V.dist(p, q)) })
  },

  'midpoint3': {
    dim: 3,
    brief: 'Midpoint of two 3D points.',
    args: { p: 'point', q: 'point' },
    run: ({ p, q }) => ({ value: V.detV(V.scale(V.add(p, q), 0.5)) })
  },

  'lerp3': {
    dim: 3,
    brief: 'Point p + lambda*(q-p) in 3D.',
    args: { p: 'point', q: 'point', lambda: 'number' },
    run: ({ p, q, lambda }) => ({ value: V.detV(V.add(p, V.scale(V.sub(q, p), lambda))) })
  },

  // ── 平面 ──────────────────────────────────────────────────

  'plane_from_3points': {
    dim: 3,
    brief: 'Plane through three points as unit normal n and offset d (n.x + d = 0). Collinear input is degenerate.',
    args: { a: 'point', b: 'point', c: 'point' },
    run: ({ a, b, c }) => {
      const P = planeFrom3(a, b, c);
      if (!P) return { value: null, degenerate: 'collinear' };
      return { value: { normal: V.detV(P.n), d: V.detF(P.d) }, equation: `n.x + ${V.detF(P.d)} = 0` };
    }
  },

  /** 点到平面距离（平面由三点给出） */
  'point_plane_distance': {
    dim: 3,
    brief: 'Distance from point p to the plane through a,b,c.',
    args: { p: 'point', a: 'point', b: 'point', c: 'point' },
    run: ({ p, a, b, c }) => {
      const P = planeFrom3(a, b, c);
      if (!P) return { value: null, degenerate: 'collinear' };
      return { value: V.detF(Math.abs(V.dot(P.n, p) + P.d)), signed: V.detF(V.dot(P.n, p) + P.d) };
    }
  },

  /** 点在平面上的投影（垂足） */
  'project_point_plane': {
    dim: 3,
    brief: 'Perpendicular projection of point p onto the plane through a,b,c.',
    args: { p: 'point', a: 'point', b: 'point', c: 'point' },
    run: ({ p, a, b, c }) => {
      const P = planeFrom3(a, b, c);
      if (!P) return { value: null, degenerate: 'collinear' };
      const s = V.dot(P.n, p) + P.d;
      return { value: V.detV(V.sub(p, V.scale(P.n, s))), signedDistance: V.detF(s) };
    }
  },

  /** 关于平面反射 */
  'reflect_point_plane': {
    dim: 3,
    brief: 'Mirror point p across the plane through a,b,c.',
    args: { p: 'point', a: 'point', b: 'point', c: 'point' },
    run: ({ p, a, b, c }) => {
      const P = planeFrom3(a, b, c);
      if (!P) return { value: null, degenerate: 'collinear' };
      const s = V.dot(P.n, p) + P.d;
      return { value: V.detV(V.sub(p, V.scale(P.n, 2 * s))) };
    }
  },

  'coplanar': {
    dim: 3,
    brief: 'Whether four points lie in one plane.',
    args: { a: 'point', b: 'point', c: 'point', d: 'point' },
    run: ({ a, b, c, d }) => ({
      value: Math.abs(V.triple(V.sub(b, a), V.sub(c, a), V.sub(d, a))) <= EPS
    })
  },

  // ── 直线 ──────────────────────────────────────────────────

  /** 点到（无限）直线距离 */
  'point_line_distance3': {
    dim: 3,
    brief: 'Distance from point p to the infinite line through a and b (3D).',
    args: { p: 'point', a: 'point', b: 'point' },
    run: ({ p, a, b }) => {
      const d = V.sub(b, a), w = V.sub(p, a);
      const dd = V.normSq(d);
      if (!(dd > EPS)) return { value: V.detF(V.norm(w)), degenerate: 'degenerate_line' };
      return { value: V.detF(V.norm(V.cross3(d, w)) / Math.sqrt(dd)) };
    }
  },

  'project_point_line3': {
    dim: 3,
    brief: 'Perpendicular projection of point p onto the line through a and b (3D).',
    args: { p: 'point', a: 'point', b: 'point' },
    run: ({ p, a, b }) => {
      const d = V.sub(b, a), dd = V.normSq(d);
      if (!(dd > EPS)) return { value: null, degenerate: 'degenerate_line' };
      const t = V.dot(V.sub(p, a), d) / dd;
      return { value: V.detV(V.add(a, V.scale(d, t))), t: V.detF(t) };
    }
  },

  /**
   * 直线与平面交点。三种真结果：
   *   交于一点 / 平行不相交 / 直线在平面内（无穷多交点）。
   * 「直线在平面内」必须单独报 —— 它是无穷多解，不是零解。
   */
  'line_plane_intersect': {
    dim: 3,
    brief: 'Intersection of the line through p1,p2 with the plane through a,b,c. Reports parallel vs line_in_plane separately.',
    args: { p1: 'point', p2: 'point', a: 'point', b: 'point', c: 'point' },
    run: ({ p1, p2, a, b, c }) => {
      const P = planeFrom3(a, b, c);
      if (!P) return { value: null, degenerate: 'collinear' };
      const d = V.sub(p2, p1);
      if (V.normSq(d) <= EPS * EPS) return { value: null, degenerate: 'degenerate_line' };
      const den = V.dot(P.n, d);
      const num = -(V.dot(P.n, p1) + P.d);
      if (Math.abs(den) <= EPS) {
        const inPlane = Math.abs(num) <= EPS;
        return { value: null, degenerate: inPlane ? 'line_in_plane' : 'parallel_no_intersection' };
      }
      const t = num / den;
      return { value: V.detV(V.add(p1, V.scale(d, t))), t: V.detF(t) };
    }
  },

  /**
   * 两直线关系：相交 / 平行 / 异面。
   * 异面时给出最短距离与最近点对 —— 这才是 Agent 真正要的答案，
   * 只回一句「不相交」等于没算。
   */
  'line_line_relation': {
    dim: 3,
    brief: 'Relation of two 3D lines: intersecting (with point), parallel, or skew (with shortest distance and nearest point pair).',
    args: { p1: 'point', p2: 'point', p3: 'point', p4: 'point' },
    run: ({ p1, p2, p3, p4 }) => {
      const d1 = V.sub(p2, p1), d2 = V.sub(p4, p3);
      const l1 = V.normSq(d1), l2 = V.normSq(d2);
      if (!(l1 > EPS) || !(l2 > EPS)) return { value: null, degenerate: 'degenerate_line' };

      const cr = V.cross3(d1, d2);
      const w = V.sub(p3, p1);

      if (V.normSq(cr) <= EPS * EPS) {
        // 平行（或共线）
        const collinear = V.normSq(V.cross3(d1, w)) <= EPS * EPS;
        const dist = V.norm(V.cross3(d1, w)) / Math.sqrt(l1);
        return {
          value: 'parallel',
          distance: V.detF(dist),
          collinear,
          degenerate: null
        };
      }

      const sep = Math.abs(V.dot(w, cr));                 // 混合积 ≠ 0 ⇒ 异面
      if (sep > EPS) {
        // 最近点对：最小化 |(p1 + t1 d1) - (p3 + t2 d2)|^2。
        // 正规方程（注意第二式是 -C，法方程矩阵是 [[A,-B],[B,-C]]）：
        //   A t1 - B t2 = Dd
        //   B t1 - C t2 = E
        // 克拉默解出（分母为 AC-B^2，符号已在下面两式里抵消）：
        //   t1 = (C*Dd - B*E) / (A*C - B*B)
        //   t2 = (B*Dd - A*E) / (A*C - B*B)
        //
        // ⚠ 这里踩过一次符号坑：最初写成 t2 = (A*E - B*Dd)/den（差一个负号），
        // 结果最近点跑到线段外侧（实测 x 轴与「z=1 上的 y 向直线」本该距离 1，
        // 实测给出 √5）。异面直线的距离**看起来仍然是个正数**，不会报错、
        // 不会 NaN，所以这类错只有拿手算用例对才能发现 —— 已加进测试。
        const A = V.dot(d1, d1), B = V.dot(d1, d2), C = V.dot(d2, d2);
        const Dd = V.dot(d1, w), E = V.dot(d2, w);
        const den = A * C - B * B;
        if (Math.abs(den) <= EPS) return { value: 'skew', degenerate: 'numerically_degenerate' };
        const t1 = (C * Dd - B * E) / den;
        const t2 = (B * Dd - A * E) / den;
        const c1 = V.add(p1, V.scale(d1, t1)), c2 = V.add(p3, V.scale(d2, t2));
        return {
          value: 'skew',
          distance: V.detF(V.dist(c1, c2)),
          nearestOnLine1: V.detV(c1),
          nearestOnLine2: V.detV(c2),
          t1: V.detF(t1), t2: V.detF(t2)
        };
      }

      // 共面且不平行 ⇒ 相交。t 由「w 在公法向上的分量」解出：
      // (p1 + t d1 - p3) 必须同时垂直 cr 的两个生成方向，取 t = (w×d2)·cr / |cr|^2
      const t = V.dot(V.cross3(w, d2), cr) / V.normSq(cr);
      return { value: 'intersecting', point: V.detV(V.add(p1, V.scale(d1, t))), t: V.detF(t) };
    }
  },

  /**
   * 两平面交线。平行 ⇒ 无；重合 ⇒ 无穷多（平面本身），必须与「平行不相交」分开报。
   */
  'plane_plane_intersect': {
    dim: 3,
    brief: 'Intersection line of two planes (each given by 3 points). Parallel and coincident are reported separately.',
    args: { a1: 'point', b1: 'point', c1: 'point', a2: 'point', b2: 'point', c2: 'point' },
    run: ({ a1, b1, c1, a2, b2, c2 }) => {
      const P = planeFrom3(a1, b1, c1), Q = planeFrom3(a2, b2, c2);
      if (!P || !Q) return { value: null, degenerate: 'collinear' };
      const dir = V.cross3(P.n, Q.n);
      if (V.normSq(dir) <= EPS * EPS) {
        const coincident = Math.abs(P.d - Q.d) <= EPS;
        return { value: null, degenerate: coincident ? 'coincident' : 'parallel' };
      }
      // 交线上一点：解 [n1; n2; dir] x = [-d1; -d2; 0]
      const m = [P.n.slice(), Q.n.slice(), dir.slice()];
      const rhs = [-P.d, -Q.d, 0];
      const o = V.solve3(m, rhs);
      if (!o) return { value: null, degenerate: 'numerically_degenerate' };
      return {
        value: { point: V.detV(o), direction: V.detV(V.unit(dir)) },
        angle: V.detF(Math.acos(Math.max(-1, Math.min(1, V.dot(P.n, Q.n)))))
      };
    }
  },

  // ── 体积与面积 ────────────────────────────────────────────

  /** 四面体体积 = |混合积| / 6 */
  'tetra_volume': {
    dim: 3,
    brief: 'Volume of the tetrahedron a,b,c,d: |triple product| / 6.',
    args: { a: 'point', b: 'point', c: 'point', d: 'point' },
    run: ({ a, b, c, d }) => {
      const v = Math.abs(V.triple(V.sub(b, a), V.sub(c, a), V.sub(d, a))) / 6;
      return { value: V.detF(v), degenerate: (v <= EPS) ? 'coplanar' : null };
    }
  },

  /**
   * 空间多边形面积（用向量面积求和再取模，对非平面多边形也有定义，
   * 结果是「最小曲面面积的向量和模」，即投影面积的上界 —— 这里如实标注）。
   */
  'polygon_area3': {
    dim: 3,
    brief: 'Area of a 3D polygon via the vector area sum. For non-planar input this is the magnitude of the vector area, not the true surface area.',
    args: { poly: 'points' },
    minPoints: 3,
    run: ({ poly }) => {
      const n = poly.length;
      if (n < 3) return { value: null, degenerate: 'need_3_points' };
      let s = [0, 0, 0];
      for (let i = 0; i < n; i++) s = V.add(s, V.cross3(poly[i], poly[(i + 1) % n]));
      return { value: V.detF(V.norm(s) / 2), vectorArea: V.detV(V.scale(s, 0.5)) };
    }
  },

  /** 三角面片法向（单位化，右手定则） */
  'face_normal': {
    dim: 3,
    brief: 'Unit normal of triangle a,b,c (right-hand rule). Degenerate when the triangle is collinear.',
    args: { a: 'point', b: 'point', c: 'point' },
    run: ({ a, b, c }) => {
      const u = V.unit(V.cross3(V.sub(b, a), V.sub(c, a)));
      if (!u) return { value: null, degenerate: 'collinear' };
      return { value: V.detV(u) };
    }
  },

  /**
   * 闭合三角网格的体积（散度定理：V = |Σ (a · (b×c)) / 6|）。
   * 网格不闭合时结果无意义 —— 如实标注 assumption。
   */
  'mesh_volume': {
    dim: 3,
    brief: 'Volume of a closed triangle mesh (divergence theorem). Input must be a closed surface; result is meaningless otherwise.',
    args: { tris: 'triangles' },
    run: ({ tris }) => {
      let s = 0;
      for (const t of tris) s += V.triple(t[0], t[1], t[2]);
      return { value: V.detF(Math.abs(s) / 6), assumption: 'closed_oriented_surface' };
    }
  },

  // ── 球 ────────────────────────────────────────────────────

  /** 四点定球（外接球）。共面 ⇒ 退化 */
  'sphere_from_4points': {
    dim: 3,
    brief: 'Sphere through four points: center and radius. Coplanar input is degenerate.',
    args: { a: 'point', b: 'point', c: 'point', d: 'point' },
    run: ({ a, b, c, d }) => {
      const m = [
        [2 * (b[0] - a[0]), 2 * (b[1] - a[1]), 2 * (b[2] - a[2])],
        [2 * (c[0] - a[0]), 2 * (c[1] - a[1]), 2 * (c[2] - a[2])],
        [2 * (d[0] - a[0]), 2 * (d[1] - a[1]), 2 * (d[2] - a[2])]
      ];
      const rhs = [
        V.normSq(b) - V.normSq(a),
        V.normSq(c) - V.normSq(a),
        V.normSq(d) - V.normSq(a)
      ];
      const o = V.solve3(m, rhs);
      if (!o) return { value: null, degenerate: 'coplanar' };
      const r = V.dist(o, a);
      return {
        value: { center: V.detV(o), radius: V.detF(r) },
        volume: V.detF(4 * Math.PI * r * r * r / 3),
        surfaceArea: V.detF(4 * Math.PI * r * r)
      };
    }
  },

  /** 球与直线交点（0/1/2），segment=true 裁到线段 */
  'sphere_line_intersect': {
    dim: 3,
    brief: 'Intersections of sphere (center,r) with the line through a,b. segment=true restricts to the finite segment.',
    args: { center: 'point', r: 'number', a: 'point', b: 'point', segment: 'boolean?' },
    run: ({ center, r, a, b, segment }) => {
      const d = V.sub(b, a), dd = V.normSq(d);
      if (!(dd > EPS)) return { value: null, degenerate: 'degenerate_line' };
      const f = V.sub(a, center);
      const B = V.dot(f, d), C = V.normSq(f) - r * r;
      const disc = B * B - dd * C;
      if (disc < -EPS) return { value: [], count: 0, degenerate: 'no_intersection' };
      const sq = Math.sqrt(Math.max(0, disc));
      let ts = (Math.abs(disc) <= EPS) ? [-B / dd] : [(-B - sq) / dd, (-B + sq) / dd];
      if (segment) ts = ts.filter(t => t >= -EPS && t <= 1 + EPS);
      const pts = ts.map(t => V.detV(V.add(a, V.scale(d, t))));
      return { value: pts, count: pts.length, tangent: pts.length === 1 };
    }
  },

  /** 球与平面交圆 */
  'sphere_plane_intersect': {
    dim: 3,
    brief: 'Intersection circle of sphere (center,r) with the plane through a,b,c. Reports no_intersection when the plane misses the sphere.',
    args: { center: 'point', r: 'number', a: 'point', b: 'point', c: 'point' },
    run: ({ center, r, a, b, c }) => {
      const P = planeFrom3(a, b, c);
      if (!P) return { value: null, degenerate: 'collinear' };
      const s = V.dot(P.n, center) + P.d;
      const dist = Math.abs(s);
      if (dist > r + EPS) return { value: null, degenerate: 'no_intersection', distance: V.detF(dist) };
      const foot = V.sub(center, V.scale(P.n, s));
      const rr = Math.sqrt(Math.max(0, r * r - s * s));
      return {
        value: { center: V.detV(foot), radius: V.detF(rr) },
        tangent: rr <= EPS
      };
    }
  },

  'sphere_measure': {
    dim: 3,
    brief: 'Volume and surface area of a sphere of radius r.',
    args: { r: 'number' },
    run: ({ r }) => ({
      value: { volume: V.detF(4 * Math.PI * r * r * r / 3), surfaceArea: V.detF(4 * Math.PI * r * r) }
    })
  },

  // ── 角度 ──────────────────────────────────────────────────

  'angle_vectors3': {
    dim: 3,
    brief: 'Angle (radians) between two 3D vectors.',
    args: { u: 'point', v: 'point' },
    run: ({ u, v }) => {
      const r = V.angle(u, v);
      if (r === null) return { value: null, degenerate: 'zero_vector' };
      return { value: V.detF(r), degrees: V.detF(r * 180 / Math.PI) };
    }
  },

  /** 线面角：asin(|d·n| / (|d||n|))，取 [0, π/2] */
  'angle_line_plane': {
    dim: 3,
    brief: 'Angle (radians) between the line p1->p2 and the plane through a,b,c.',
    args: { p1: 'point', p2: 'point', a: 'point', b: 'point', c: 'point' },
    run: ({ p1, p2, a, b, c }) => {
      const P = planeFrom3(a, b, c);
      if (!P) return { value: null, degenerate: 'collinear' };
      const d = V.sub(p2, p1);
      const nd = V.norm(d);
      if (!(nd > EPS)) return { value: null, degenerate: 'degenerate_line' };
      const s = Math.abs(V.dot(d, P.n)) / nd;
      const r = Math.asin(Math.max(-1, Math.min(1, s)));
      return { value: V.detF(r), degrees: V.detF(r * 180 / Math.PI) };
    }
  },

  /** 两平面夹角（取锐角） */
  'angle_plane_plane': {
    dim: 3,
    brief: 'Acute dihedral angle (radians) between the planes through a1,b1,c1 and a2,b2,c2.',
    args: { a1: 'point', b1: 'point', c1: 'point', a2: 'point', b2: 'point', c2: 'point' },
    run: ({ a1, b1, c1, a2, b2, c2 }) => {
      const P = planeFrom3(a1, b1, c1), Q = planeFrom3(a2, b2, c2);
      if (!P || !Q) return { value: null, degenerate: 'collinear' };
      const c = Math.abs(V.dot(P.n, Q.n));
      const r = Math.acos(Math.max(-1, Math.min(1, c)));
      return { value: V.detF(r), degrees: V.detF(r * 180 / Math.PI) };
    }
  },

  // ── 变换 ──────────────────────────────────────────────────

  /**
   * Rodrigues 旋转：绕轴 axis（过 center）旋转 angle。
   * v' = v cosθ + (k×v) sinθ + k (k·v)(1-cosθ)
   */
  'rotate_axis': {
    dim: 3,
    brief: 'Rotate point p about the axis (direction axis through center) by angle radians, Rodrigues formula. center defaults to origin.',
    args: { p: 'point', axis: 'point', angle: 'number', center: 'point?' },
    run: ({ p, axis, angle, center }) => {
      const k = V.unit(axis);
      if (!k) return { value: null, degenerate: 'zero_axis' };
      const c = center || [0, 0, 0];
      const v = V.sub(p, c);
      const co = Math.cos(angle), si = Math.sin(angle);
      const part1 = V.scale(v, co);
      const part2 = V.scale(V.cross3(k, v), si);
      const part3 = V.scale(k, V.dot(k, v) * (1 - co));
      return { value: V.detV(V.add(c, V.add(V.add(part1, part2), part3))) };
    }
  },

  /** 叉积（3D，垂直于两向量张成的平面） */
  'cross3': {
    dim: 3,
    brief: 'Cross product of two 3D vectors; magnitude is the area of the parallelogram they span.',
    args: { u: 'point', v: 'point' },
    run: ({ u, v }) => {
      const c = V.cross3(u, v);
      return { value: V.detV(c), magnitude: V.detF(V.norm(c)) };
    }
  },

  /** 混合积：平行六面体有向体积 */
  'triple_product': {
    dim: 3,
    brief: 'Scalar triple product a.(b x c): signed volume of the parallelepiped.',
    args: { a: 'point', b: 'point', c: 'point' },
    run: ({ a, b, c }) => ({ value: V.detF(V.triple(a, b, c)) })
  }
};

module.exports = { OPS, planeFrom3 };
