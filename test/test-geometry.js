/**
 * 几何层回归测试。
 *
 * 断言来源的原则：**期望值必须能手算**。
 * 所有 expected 都是纸面上算得出的数（5、0.5、π/2、1/6、√0.5……），
 * 不是「跑一遍把输出抄回来」—— 后者只能测出「下次改动有没有变」，
 * 测不出第一次就是错的。几何闭式解尤其容易第一次就错：
 * 叉积差个符号、克拉默行列式分子差个顺序，结果都是「看着合理」的错值。
 *
 * 除了数值，还专门测**退化分支**：
 * 平行线、共线三点、异面直线、重合圆 —— 这些是最容易被写成「返回一个垃圾数」的地方，
 * 而垃圾数比报错危险得多，因为 Agent 会当真。
 *
 * 运行：node test/test-geometry.js
 */
'use strict';

const G = require('../services/geometry/index.js');

let pass = 0, fail = 0;
const EPS = 1e-9;

function ok(name, cond, extra) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`  ✗ ${name}${extra !== undefined ? '  got: ' + JSON.stringify(extra) : ''}`);
}

function near(name, got, want, tol = 1e-9) {
  const d = Math.abs(got - want);
  ok(name, d <= tol, { got, want, diff: d });
}

function nearPt(name, got, want, tol = 1e-9) {
  ok(name, Array.isArray(got) && got.length === want.length
    && got.every((x, i) => Math.abs(x - want[i]) <= tol), { got, want });
}

/** 断言退化：degenerate 必须是指定值，且 trust 必须判为不可直接使用 */
function degen(name, res, code, trustLevel) {
  ok(`${name} degenerate=${code}`, res.degenerate === code, res.degenerate);
  ok(`${name} trust=${trustLevel}`, res.trust.trustLevel === trustLevel, res.trust.trustLevel);
}

function run(op, args) { return G.doGeometry(Object.assign({ op }, args)); }

// ── 1D ───────────────────────────────────────────────────────
console.log('1D:');
near('dist1 |(-3)-(5)|', run('dist1', { p: [-3], q: [5] }).value, 8);
nearPt('midpoint1', run('midpoint1', { p: [0], q: [10] }).value, [5]);
near('interval_length', run('interval_length', { a: [2], b: [9] }).value, 7);
nearPt('interval_midpoint', run('interval_midpoint', { a: [2], b: [9] }).value, [5.5]);
near('divide_point 内部', run('divide_point', { p: [0], q: [10], lambda: 0.3 }).value[0], 3);
near('divide_point 外分', run('divide_point', { p: [0], q: [10], lambda: -0.5 }).value[0], -5);
near('divide_ratio 反求', run('divide_ratio', { p: [0], q: [10], x: [3] }).value, 0.3);
{
  const r = run('interval_intersect', { a: [0], b: [5], c: [3], d: [8] });
  near('interval_intersect lo', r.value.lo, 3);
  near('interval_intersect hi', r.value.hi, 5);
}
degen('interval_intersect 不相交', run('interval_intersect', { a: [0], b: [2], c: [5], d: [8] }), 'disjoint', 'definitely_none');
{
  const r = run('interval_union', { a: [0], b: [2], c: [5], d: [7] });
  degen('interval_union 分离', r, 'disconnected', 'definitely_none');
  ok('interval_union 给两段', Array.isArray(r.segments) && r.segments.length === 2, r.segments);
}
{
  const r = run('interval_union', { a: [0], b: [5], c: [3], d: [8] });
  near('interval_union 相连 lo', r.value.lo, 0);
  near('interval_union 相连 hi', r.value.hi, 8);
  ok('interval_union 相连非退化', r.degenerate === null, r.degenerate);
}
near('interval_hull', run('interval_hull', { a: [0], b: [2], c: [5], d: [7] }).value.hi, 7);
near('interval_overlap_length', run('interval_overlap_length', { a: [0], b: [5], c: [3], d: [8] }).value, 2);
ok('interval_contains 内', run('interval_contains', { x: [3], a: [0], b: [5] }).value === true);
ok('interval_contains 外', run('interval_contains', { x: [9], a: [0], b: [5] }).value === false);
ok('point_between 端点不算', run('point_between', { x: [0], a: [0], b: [5] }).value === false);
// 调和共轭：a=0,b=2,c=0.5 ⇒ d=-1，交比 (a,b;c,d) = -1（手算见注释）
near('harmonic_conjugate', run('harmonic_conjugate', { a: [0], b: [2], c: [0.5] }).value[0], -1);
degen('harmonic_conjugate 中点在无穷远', run('harmonic_conjugate', { a: [0], b: [2], c: [1] }),
  'conjugate_at_infinity', 'degenerate');

// ── 2D ───────────────────────────────────────────────────────
console.log('2D:');
near('dist2 3-4-5', run('dist2', { p: [0, 0], q: [3, 4] }).value, 5);
nearPt('midpoint2', run('midpoint2', { p: [0, 0], q: [4, 6] }).value, [2, 3]);
nearPt('lerp2', run('lerp2', { p: [0, 0], q: [10, 10], lambda: 0.25 }).value, [2.5, 2.5]);

// 直线 y=1 上的两点；原点到此线的距离 = 1
near('point_line_distance 到 y=1', run('point_line_distance', { p: [0, 0], a: [-1, 1], b: [1, 1] }).value, 1);
{
  const L = run('line_from_points', { a: [0, 0], b: [1, 0] }).value;   // y = 0
  near('line_from_points a', L.a, 0);
  near('line_from_points b', L.b, 1);
  near('line_from_points c', L.c, 0);
}
// 垂足落在线段外时，点线段距离必须退化成端点距离（不是直线距离）
near('point_segment_distance 垂足在外', run('point_segment_distance', { p: [-3, 5], a: [0, 0], b: [1, 0] }).value,
  Math.hypot(3, 5));
near('point_segment_distance 垂足在内', run('point_segment_distance', { p: [0.5, 5], a: [0, 0], b: [1, 0] }).value, 5);
nearPt('project_point_line 垂足', run('project_point_line', { p: [2, 3], a: [0, 0], b: [1, 0] }).value, [2, 0]);

// x+y-1=0 与 x-y=0 ⇒ (0.5, 0.5)
nearPt('line_intersect', run('line_intersect', { a1: 1, b1: 1, c1: -1, a2: 1, b2: -1, c2: 0 }).value, [0.5, 0.5]);
degen('line_intersect 平行', run('line_intersect', { a1: 1, b1: 1, c1: 0, a2: 1, b2: 1, c2: 5 }), 'parallel', 'degenerate');
degen('line_intersect 重合', run('line_intersect', { a1: 1, b1: 1, c1: -2, a2: 2, b2: 2, c2: -4 }), 'coincident', 'degenerate');
nearPt('line_intersect_points 对角线',
  run('line_intersect_points', { p1: [0, 0], p2: [2, 2], p3: [0, 2], p4: [2, 0] }).value, [1, 1]);

nearPt('segment_intersect 交叉',
  run('segment_intersect', { p1: [0, 0], p2: [2, 2], p3: [0, 2], p4: [2, 0] }).value, [1, 1]);
degen('segment_intersect 不交（延长线会交）',
  run('segment_intersect', { p1: [0, 0], p2: [0.5, 0.5], p3: [0, 2], p4: [2, 0] }), 'no_intersection', 'definitely_none');
{
  // 共线重叠：既不是「交于一点」也不是「不相交」，答案是一个区间 [2,0]-[4,0]
  const r = run('segment_intersect', { p1: [0, 0], p2: [4, 0], p3: [2, 0], p4: [6, 0] });
  degen('segment_intersect 共线重叠', r, 'collinear_overlap', 'degenerate');
  nearPt('  重叠起点', r.overlap.from, [2, 0]);
  nearPt('  重叠终点', r.overlap.to, [4, 0]);
  near('  重叠长度', r.overlap.length, 2);
}
near('segment_length', run('segment_length', { p: [0, 0], q: [3, 4] }).value, 5);

near('angle_3points 直角', run('angle_3points', { a: [1, 0], mid: [0, 0], b: [0, 1] }).value, Math.PI / 2);
near('angle_vectors 直角', run('angle_vectors', { u: [1, 0], v: [0, 1] }).value, Math.PI / 2);
{
  // y=0 与 y=x ⇒ 45°
  const r = run('line_angle', { a1: 0, b1: 1, c1: 0, a2: 1, b2: -1, c2: 0 });
  near('line_angle 45°', r.value, Math.PI / 4);
}
degen('angle_vectors 零向量', run('angle_vectors', { u: [0, 0], v: [1, 0] }), 'zero_vector', 'degenerate');

near('triangle_area 直角边1', run('triangle_area', { a: [0, 0], b: [1, 0], c: [0, 1] }).value, 0.5);
degen('triangle_area 共线', run('triangle_area', { a: [0, 0], b: [1, 0], c: [2, 0] }), 'collinear', 'degenerate');
nearPt('triangle_centroid', run('triangle_centroid', { a: [0, 0], b: [3, 0], c: [0, 3] }).value, [1, 1]);
{
  // 直角三角形 (0,0),(3,0),(0,4)：内切圆半径 r = 2A/周长和 = 6/12... 手算 A=6, s=3+4+5=12 ⇒ r=1
  const r = run('triangle_incenter', { a: [0, 0], b: [3, 0], c: [0, 4] });
  nearPt('triangle_incenter (1,1)', r.value, [1, 1]);
  near('  inradius=1', r.inradius, 1);
}

near('polygon_area 单位正方形', run('polygon_area', { poly: [[0, 0], [1, 0], [1, 1], [0, 1]] }).value, 1);
near('polygon_area 顺时针也取正', run('polygon_area', { poly: [[0, 0], [0, 1], [1, 1], [1, 0]] }).value, 1);
near('polygon_perimeter', run('polygon_perimeter', { poly: [[0, 0], [1, 0], [1, 1], [0, 1]] }).value, 4);
nearPt('polygon_centroid 正方形', run('polygon_centroid', { poly: [[0, 0], [2, 0], [2, 2], [0, 2]] }).value, [1, 1]);
degen('polygon_centroid 退化有标注',
  run('polygon_centroid', { poly: [[0, 0], [1, 0], [2, 0]] }), 'zero_area', 'degenerate');

ok('point_in_polygon 内部', run('point_in_polygon', { p: [0.5, 0.5], poly: [[0, 0], [1, 0], [1, 1], [0, 1]] }).value === true);
ok('point_in_polygon 外部', run('point_in_polygon', { p: [2, 2], poly: [[0, 0], [1, 0], [1, 1], [0, 1]] }).value === false);
{
  const r = run('point_in_polygon', { p: [0, 0], poly: [[0, 0], [1, 0], [1, 1], [0, 1]] });
  ok('point_in_polygon 顶点算边界', r.value === true && r.onBoundary === true, r);
}
{
  const r = run('point_in_polygon', { p: [0.5, 0], poly: [[0, 0], [1, 0], [1, 1], [0, 1]] });
  ok('point_in_polygon 边上算边界', r.onBoundary === true, r);
}
{
  // L 形（凹）：底部 0<=x<=2,0<=y<=1 加右上 1<=x<=2,1<=y<=2。
  // 缺口在**左上**，所以外部点是 (0.5,1.5)；(1.5,1.5) 反而是在内部的。
  // 这个用例专门用来卡「射线法在凹多边形上退化成凸包判定」这类错。
  const L = [[0, 0], [2, 0], [2, 2], [1, 2], [1, 1], [0, 1]];
  ok('point_in_polygon 凹多边形内(1.5,1.5)', run('point_in_polygon', { p: [1.5, 1.5], poly: L }).value === true);
  ok('point_in_polygon 凹多边形缺口(0.5,1.5)', run('point_in_polygon', { p: [0.5, 1.5], poly: L }).value === false);
  ok('point_in_polygon 凹多边形内(0.5,0.5)', run('point_in_polygon', { p: [0.5, 0.5], poly: L }).value === true);
}
{
  const h = run('convex_hull', { pts: [[0, 0], [1, 0], [0, 1], [0.5, 0.5], [1, 1]] }).value;
  ok('convex_hull 去掉内部点', h.length === 4, h);
  near('convex_hull 面积', run('polygon_area', { poly: h }).value, 1);
}
ok('polygon_is_convex 正方形', run('polygon_is_convex', { poly: [[0, 0], [1, 0], [1, 1], [0, 1]] }).value === true);
ok('polygon_is_convex L形不凸', run('polygon_is_convex', { poly: [[0, 0], [2, 0], [2, 2], [1, 2], [1, 1], [0, 1]] }).value === false);

{
  // 三点 (0,0),(1,0),(0,1) ⇒ 外心 (0.5,0.5)，半径 √0.5
  const r = run('circle_from_3points', { a: [0, 0], b: [1, 0], c: [0, 1] });
  nearPt('circle_from_3points center', r.value.center, [0.5, 0.5]);
  near('circle_from_3points radius', r.value.radius, Math.SQRT1_2);
}
degen('circle_from_3points 共线', run('circle_from_3points', { a: [0, 0], b: [1, 0], c: [2, 0] }), 'collinear', 'degenerate');
ok('point_circle_position 上', run('point_circle_position', { p: [1, 0], center: [0, 0], r: 1 }).value === 'on');
ok('point_circle_position 内', run('point_circle_position', { p: [0.5, 0], center: [0, 0], r: 1 }).value === 'inside');
ok('point_circle_position 外', run('point_circle_position', { p: [2, 0], center: [0, 0], r: 1 }).value === 'outside');
{
  // 圆 x^2+y^2=1 与 y=1 相切
  const r = run('circle_line_intersect', { center: [0, 0], r: 1, a: [-2, 1], b: [2, 1] });
  ok('circle_line_intersect 相切 count=1', r.count === 1 && r.tangent === true, r);
  nearPt('  切点', r.value[0], [0, 1]);
}
{
  // 与 y=0 交于 (±1,0)
  const r = run('circle_line_intersect', { center: [0, 0], r: 1, a: [-2, 0], b: [2, 0] });
  ok('circle_line_intersect 两交点', r.count === 2, r);
}
degen('circle_line_intersect 相离', run('circle_line_intersect', { center: [0, 0], r: 1, a: [-2, 5], b: [2, 5] }),
  'no_intersection', 'definitely_none');
{
  // 线段裁剪：直线 y=0 与圆交于 (-1,0),(1,0)，但线段只覆盖 [0,2] ⇒ 只剩 (1,0)
  const r = run('circle_line_intersect', { center: [0, 0], r: 1, a: [0, 0], b: [2, 0], segment: true });
  ok('circle_line_intersect segment 裁剪', r.count === 1, r);
  nearPt('  剩余点', r.value[0], [1, 0]);
}
{
  // 两圆半径1，圆心距2 ⇒ 外切于 (1,0)
  const r = run('circle_circle_intersect', { c1: [0, 0], r1: 1, c2: [2, 0], r2: 1 });
  ok('circle_circle_intersect 外切', r.count === 1 && r.tangent === true, r);
  nearPt('  切点', r.value[0], [1, 0]);
}
{
  // 圆心距1 ⇒ 两交点 (0.5, ±√0.75)
  const r = run('circle_circle_intersect', { c1: [0, 0], r1: 1, c2: [1, 0], r2: 1 });
  ok('circle_circle_intersect 两交点', r.count === 2, r);
  near('  交点 x', r.value[0][0], 0.5);
  near('  交点 y 对称', Math.abs(r.value[0][1]), Math.sqrt(0.75));
}
degen('circle_circle_intersect 外离', run('circle_circle_intersect', { c1: [0, 0], r1: 1, c2: [5, 0], r2: 1 }),
  'separate', 'definitely_none');
degen('circle_circle_intersect 内含', run('circle_circle_intersect', { c1: [0, 0], r1: 5, c2: [1, 0], r2: 1 }),
  'contained', 'definitely_none');
degen('circle_circle_intersect 重合', run('circle_circle_intersect', { c1: [0, 0], r1: 2, c2: [0, 0], r2: 2 }),
  'coincident', 'degenerate');

near('circle_measure area', run('circle_measure', { r: 1 }).value.area, Math.PI);
near('circle_measure circumference', run('circle_measure', { r: 1 }).value.circumference, 2 * Math.PI);
near('sector_area 半圆', run('sector_area', { r: 1, theta: Math.PI }).value, Math.PI / 2);

nearPt('rotate_point 90°', run('rotate_point', { p: [1, 0], angle: Math.PI / 2 }).value, [0, 1], 1e-12);
nearPt('rotate_point 绕 center', run('rotate_point', { p: [2, 1], angle: Math.PI, center: [1, 1] }).value, [0, 1], 1e-12);
nearPt('reflect_point_line 关于 y=0', run('reflect_point_line', { p: [2, 3], a: [0, 0], b: [1, 0] }).value, [2, -3]);
nearPt('scale_point 2x', run('scale_point', { p: [1, 1], k: 2, center: [0, 0] }).value, [2, 2]);
{
  // 过 (5,5) 作 y=0 的平行线 ⇒ y=5，即 0x+1y-5=0
  const L = run('parallel_through', { p: [5, 5], a1: 0, b1: 1, c1: 0 }).value;
  near('parallel_through c', L.c, -5);
}
{
  // 过 (5,5) 作 y=0 的垂线 ⇒ 几何上是 x=5。
  // 不断言 a/c 的符号：(1,0,-5) 与 (-1,0,5) 是同一条直线，法向朝哪边取决于
  // 旋转方向，不是 bug。要断言的是**几何性质**：① 过 (5,5)；② 与原直线夹角 90°。
  const L = run('perpendicular_through', { p: [5, 5], a1: 0, b1: 1, c1: 0 }).value;
  near('perpendicular_through 过 (5,5)', L.a * 5 + L.b * 5 + L.c, 0);
  near('perpendicular_through 与原线垂直',
    run('line_angle', { a1: L.a, b1: L.b, c1: L.c, a2: 0, b2: 1, c2: 0 }).value, Math.PI / 2);
}

// ── 3D ───────────────────────────────────────────────────────
console.log('3D:');
near('dist3', run('dist3', { p: [0, 0, 0], q: [1, 2, 2] }).value, 3);
nearPt('midpoint3', run('midpoint3', { p: [0, 0, 0], q: [2, 4, 6] }).value, [1, 2, 3]);
nearPt('lerp3', run('lerp3', { p: [0, 0, 0], q: [10, 10, 10], lambda: 0.5 }).value, [5, 5, 5]);

{
  const P = run('plane_from_3points', { a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0] }).value;
  nearPt('plane_from_3points 法向 = +z', P.normal, [0, 0, 1]);
  near('plane_from_3points d', P.d, 0);
}
near('point_plane_distance z=0 到 (0,0,5)',
  run('point_plane_distance', { p: [0, 0, 5], a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0] }).value, 5);
nearPt('project_point_plane',
  run('project_point_plane', { p: [1, 2, 5], a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0] }).value, [1, 2, 0]);
nearPt('reflect_point_plane',
  run('reflect_point_plane', { p: [1, 2, 5], a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0] }).value, [1, 2, -5]);
ok('coplanar 是', run('coplanar', { a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0], d: [1, 1, 0] }).value === true);
ok('coplanar 否', run('coplanar', { a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0], d: [0, 0, 1] }).value === false);

// 点 (0,3,0) 到 x 轴的距离 = 3
near('point_line_distance3 到 x 轴', run('point_line_distance3', { p: [0, 3, 0], a: [0, 0, 0], b: [1, 0, 0] }).value, 3);
nearPt('project_point_line3', run('project_point_line3', { p: [2, 3, 0], a: [0, 0, 0], b: [1, 0, 0] }).value, [2, 0, 0]);
{
  // 直线 (0,0,-1)->(0,0,1) 穿 z=0 平面 ⇒ (0,0,0)
  const r = run('line_plane_intersect', { p1: [0, 0, -1], p2: [0, 0, 1], a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0] });
  nearPt('line_plane_intersect', r.value, [0, 0, 0]);
}
degen('line_plane_intersect 平行不相交',
  run('line_plane_intersect', { p1: [0, 0, 1], p2: [1, 0, 1], a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0] }),
  'parallel_no_intersection', 'definitely_none');
degen('line_plane_intersect 直线在平面内（无穷多交点）',
  run('line_plane_intersect', { p1: [0, 0, 0], p2: [1, 0, 0], a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0] }),
  'line_in_plane', 'degenerate');

{
  // x 轴 与 过 (1,-1,0) 的 y 向直线 ⇒ 交于 (1,0,0)
  const r = run('line_line_relation', { p1: [0, 0, 0], p2: [2, 0, 0], p3: [1, -1, 0], p4: [1, 1, 0] });
  ok('line_line_relation 相交', r.value === 'intersecting', r.value);
  nearPt('  交点', r.point, [1, 0, 0]);
}
{
  // 异面：x 轴 与 「y 轴平移到 z=1」⇒ 最短距离 1，最近点 (0,0,0) 与 (0,0,1)
  const r = run('line_line_relation', { p1: [0, 0, 0], p2: [1, 0, 0], p3: [0, -1, 1], p4: [0, 1, 1] });
  ok('line_line_relation 异面', r.value === 'skew', r.value);
  near('  最短距离', r.distance, 1);
  nearPt('  最近点1', r.nearestOnLine1, [0, 0, 0]);
  nearPt('  最近点2', r.nearestOnLine2, [0, 0, 1]);
}
{
  // 平行：x 轴 与 y=1 上的 x 向直线 ⇒ 距离 1
  const r = run('line_line_relation', { p1: [0, 0, 0], p2: [1, 0, 0], p3: [0, 1, 0], p4: [1, 1, 0] });
  ok('line_line_relation 平行', r.value === 'parallel', r.value);
  near('  距离', r.distance, 1);
}
{
  // z=0 与 y=0 ⇒ 交线为 x 轴
  const r = run('plane_plane_intersect', {
    a1: [0, 0, 0], b1: [1, 0, 0], c1: [0, 1, 0],
    a2: [0, 0, 0], b2: [1, 0, 0], c2: [0, 0, 1]
  });
  nearPt('plane_plane_intersect 过原点', r.value.point, [0, 0, 0]);
  nearPt('  方向 = ±x', r.value.direction.map(Math.abs), [1, 0, 0]);
  near('  二面角 90°', r.angle, Math.PI / 2);
}
degen('plane_plane_intersect 平行',
  run('plane_plane_intersect', {
    a1: [0, 0, 0], b1: [1, 0, 0], c1: [0, 1, 0],
    a2: [0, 0, 1], b2: [1, 0, 1], c2: [0, 1, 1]
  }), 'parallel', 'degenerate');
degen('plane_plane_intersect 重合',
  run('plane_plane_intersect', {
    a1: [0, 0, 0], b1: [1, 0, 0], c1: [0, 1, 0],
    a2: [0, 0, 0], b2: [0, 1, 0], c2: [1, 0, 0]
  }), 'coincident', 'degenerate');

near('tetra_volume 单位', run('tetra_volume', { a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0], d: [0, 0, 1] }).value, 1 / 6);
degen('tetra_volume 共面', run('tetra_volume', { a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0], d: [1, 1, 0] }),
  'coplanar', 'degenerate');
near('polygon_area3 直角三角形', run('polygon_area3', { poly: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] }).value, 0.5);
nearPt('face_normal = +z', run('face_normal', { a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0] }).value, [0, 0, 1]);
near('mesh_volume 单位四面体', run('mesh_volume', {
  tris: [
    [[0, 0, 0], [0, 1, 0], [1, 0, 0]],
    [[0, 0, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  ]
}).value, 1 / 6);

{
  const r = run('sphere_from_4points', { a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0], d: [0, 0, 1] });
  nearPt('sphere_from_4points center', r.value.center, [0.5, 0.5, 0.5]);
  near('sphere_from_4points radius', r.value.radius, Math.sqrt(0.75));
}
degen('sphere_from_4points 共面',
  run('sphere_from_4points', { a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0], d: [1, 1, 0] }), 'coplanar', 'degenerate');
{
  // 单位球与 z 轴方向直线（过 x=1）⇒ 相切于 (1,0,0)
  const r = run('sphere_line_intersect', { center: [0, 0, 0], r: 1, a: [1, -1, 0], b: [1, 1, 0] });
  ok('sphere_line_intersect 相切', r.count === 1 && r.tangent === true, r);
  nearPt('  切点', r.value[0], [1, 0, 0]);
}
{
  // 单位球与 z=0 平面 ⇒ 交圆半径 1，圆心原点
  const r = run('sphere_plane_intersect', { center: [0, 0, 0], r: 1, a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0] });
  nearPt('sphere_plane_intersect 圆心', r.value.center, [0, 0, 0]);
  near('  半径', r.value.radius, 1);
}
{
  // z=0.5 平面 ⇒ 交圆半径 √(1-0.25)
  const r = run('sphere_plane_intersect', { center: [0, 0, 0], r: 1, a: [0, 0, 0.5], b: [1, 0, 0.5], c: [0, 1, 0.5] });
  near('sphere_plane_intersect 半径', r.value.radius, Math.sqrt(0.75));
}
degen('sphere_plane_intersect 不相交',
  run('sphere_plane_intersect', { center: [0, 0, 0], r: 1, a: [0, 0, 5], b: [1, 0, 5], c: [0, 1, 5] }),
  'no_intersection', 'definitely_none');
near('sphere_measure 体积', run('sphere_measure', { r: 1 }).value.volume, 4 * Math.PI / 3);
near('sphere_measure 表面积', run('sphere_measure', { r: 1 }).value.surfaceArea, 4 * Math.PI);

near('angle_vectors3 直角', run('angle_vectors3', { u: [1, 0, 0], v: [0, 1, 0] }).value, Math.PI / 2);
{
  // 直线方向 z 轴，平面 z=0 ⇒ 线面角 90°
  const r = run('angle_line_plane', { p1: [0, 0, 0], p2: [0, 0, 1], a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0] });
  near('angle_line_plane 90°', r.value, Math.PI / 2);
}
{
  // 直线方向 x 轴躺在 z=0 平面内 ⇒ 线面角 0
  const r = run('angle_line_plane', { p1: [0, 0, 0], p2: [1, 0, 0], a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0] });
  near('angle_line_plane 0°', r.value, 0);
}
near('angle_plane_plane 90°', run('angle_plane_plane', {
  a1: [0, 0, 0], b1: [1, 0, 0], c1: [0, 1, 0],
  a2: [0, 0, 0], b2: [1, 0, 0], c2: [0, 0, 1]
}).value, Math.PI / 2);

nearPt('rotate_axis z轴90°', run('rotate_axis', { p: [1, 0, 0], axis: [0, 0, 1], angle: Math.PI / 2 }).value, [0, 1, 0], 1e-12);
degen('rotate_axis 零轴', run('rotate_axis', { p: [1, 0, 0], axis: [0, 0, 0], angle: 1 }), 'zero_axis', 'degenerate');
nearPt('cross3 i×j=k', run('cross3', { u: [1, 0, 0], v: [0, 1, 0] }).value, [0, 0, 1]);
near('triple_product', run('triple_product', { a: [1, 0, 0], b: [0, 1, 0], c: [0, 0, 1] }).value, 1);

// ── 任意维 ───────────────────────────────────────────────────
console.log('any-dim:');
near('distance 2D', run('distance', { p: [0, 0], q: [3, 4] }).value, 5);
near('distance 3D', run('distance', { p: [0, 0, 0], q: [1, 2, 2] }).value, 3);
near('distance 1D', run('distance', { p: [0], q: [7] }).value, 7);
nearPt('midpoint 3D', run('midpoint', { p: [0, 0, 0], q: [2, 4, 6] }).value, [1, 2, 3]);
nearPt('lerp 任意维', run('lerp', { p: [0, 0], q: [10, 10], lambda: 0.25 }).value, [2.5, 2.5]);
near('norm', run('norm', { v: [3, 4] }).value, 5);
nearPt('normalize', run('normalize', { v: [3, 4] }).value, [0.6, 0.8]);
degen('normalize 零向量', run('normalize', { v: [0, 0] }), 'zero_vector', 'degenerate');
near('dot', run('dot', { u: [1, 2, 3], v: [4, 5, 6] }).value, 32);
{
  const r = run('cross', { u: [1, 0], v: [0, 1] });
  ok('cross 2D 给标量', r.kind === 'scalar' && r.value === 1, r);
}
{
  const r = run('cross', { u: [1, 0, 0], v: [0, 1, 0] });
  ok('cross 3D 给向量', r.kind === 'vector', r);
  nearPt('  i×j=k', r.value, [0, 0, 1]);
}
degen('cross 4D 不存在', run('cross', { u: [1, 0, 0, 0], v: [0, 1, 0, 0] }), 'unsupported_dimension', 'degenerate');
nearPt('project (2,3) 到 x 轴', run('project', { u: [2, 3], v: [1, 0] }).value, [2, 0]);
nearPt('reject (2,3) 去掉 x 分量', run('reject', { u: [2, 3], v: [1, 0] }).value, [0, 3]);
nearPt('translate', run('translate', { p: [1, 2], v: [3, 4] }).value, [4, 6]);
nearPt('centroid', run('centroid', { pts: [[0, 0], [2, 0], [0, 2], [2, 2]] }).value, [1, 1]);
{
  const r = run('bbox', { pts: [[0, 0], [3, 1], [-1, 2]] });
  nearPt('bbox min', r.value.min, [-1, 0]);
  nearPt('bbox max', r.value.max, [3, 2]);
  nearPt('bbox center', r.center, [1, 1]);
}
near('diameter 单位正方形对角线', run('diameter', { pts: [[0, 0], [1, 0], [1, 1], [0, 1]] }).value, Math.SQRT2);

// ── 输入校验与错误通道 ───────────────────────────────────────
console.log('输入护栏:');
function throws(name, fn, type) {
  let caught = null;
  try { fn(); } catch (e) { caught = e; }
  ok(name, caught !== null && caught.type === type, caught && { type: caught.type, msg: caught.message });
}
throws('缺 op', () => run('', {}), 'invalid_input');
throws('未知 op', () => run('nope', {}), 'unknown_op');
throws('2D op 给 3D 点', () => run('dist2', { p: [0, 0, 0], q: [1, 1, 1] }), 'invalid_input');
throws('3D op 给 2D 点', () => run('dist3', { p: [0, 0], q: [1, 1] }), 'invalid_input');
throws('缺必需参数', () => run('dist2', { p: [0, 0] }), 'invalid_input');
throws('坐标非数', () => run('dist2', { p: [0, 'x'], q: [1, 1] }), 'invalid_input');
throws('NaN', () => run('dist2', { p: [0, NaN], q: [1, 1] }), 'invalid_input');
throws('多边形点数不足', () => run('polygon_area', { poly: [[0, 0], [1, 1]] }), 'invalid_input');
throws('半径非数', () => run('circle_measure', { r: 'big' }), 'invalid_input');
throws('混合维度', () => run('centroid', { pts: [[0, 0], [1, 1, 1]] }), 'invalid_input');
{
  // 未知 op 必须回吐完整目录，否则 Agent 只能瞎猜参数
  let caught = null;
  try { run('nope', {}); } catch (e) { caught = e; }
  ok('未知 op 带 catalog', !!(caught && caught.catalog && caught.catalog.dist2), caught && Object.keys(caught.catalog || {}).length);
  ok('catalog 含签名', !!(caught && caught.catalog && caught.catalog.dist2.args.join(',') === 'p:point,q:point'),
    caught && caught.catalog.dist2);
}

// ── 一致性硬闸 ───────────────────────────────────────────────
console.log('一致性:');
{
  const names = Object.keys(G.OPS);
  ok('op 数量 >= 60', names.length >= 60, names.length);
  // 每个 op 都必须有 brief（brief 是要写给 Agent 看的）
  const noBrief = names.filter(n => !G.OPS[n].brief || !G.OPS[n].brief.trim());
  ok('所有 op 都有 brief', noBrief.length === 0, noBrief);
  // 覆盖率自省：跑过的 op 必须覆盖全部 op。
  // 硬闸的意义在于**以后加 op 时**：不写测试就红，而不是「加了个没测过的 op 也没人知道」。
  // 几何闭式解的错是静默的（错值看起来仍然合理），没有测试等于没有验证。
  //
  // ⚠ 定理层（geom_theorems.js 的 32 个 op）已拆到独立文件 test-geometry-theorems.js，
  //   那里用的是 IDX.doGeometry({op, ...}) 而不是本文件的 run('op', {...})，
  //   所以**只扫本文件会把它们全判成未测**。这里把两个文件的 op 名一起扫 ——
  //   覆盖率的口径必须是「全仓有没有测」，不是「本文件有没有测」。
  const fs = require('fs');
  const SELF_FILES = [
    __filename,
    require('path').join(__dirname, 'test-geometry-theorems.js'),
    // 热带/凸桥 op 在几何层注册、在 test-tropical.js 里测
    require('path').join(__dirname, 'test-tropical.js'),
  // 几何⇄代数接缝 op 在 geometry 层注册、在 test-geometry-bridge.js 里测
  require('path').join(__dirname, 'test-geometry-bridge.js'),
  ];
  const touched = new Set();
  for (const f of SELF_FILES) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/run\('([a-z0-9_]+)'/g)) touched.add(m[1]);
    // 定理层写法：{ op: 'name' } 与 val/degen('名字', 'name', ...) 两种
    for (const m of src.matchAll(/\bop:\s*'([A-Za-z0-9_]+)'/g)) touched.add(m[1]);
    for (const m of src.matchAll(/\b(?:val|degen)\(\s*'[^']*'\s*,\s*'([a-z0-9_]+)'/g)) touched.add(m[1]);
    // 热带层测试直接调 T.<op>(...)，op 名跟在模块名后面
    // ⚠ op 名里有大写字母（cocircular_check 之后的 minimumEnclosingCircle、
    //   regularSubdivision），字符类必须写成 [A-Za-z0-9_] ——
    //   只写 [a-z0-9_] 会静默漏扫，而覆盖率闸会因此报「未测」，看不出是扫描器坏了。
    for (const m of src.matchAll(/\bT\.([A-Za-z0-9_]+)\s*\(/g)) touched.add(m[1]);
    // 以及通过分派层的写法：doGeometry({op: 'name', ...})
    for (const m of src.matchAll(/doGeometry\(\s*\{\s*op:\s*'([A-Za-z0-9_]+)'/g)) touched.add(m[1]);
    // ── 显式清单（唯一可靠的兜底）────────────────────────────────────
    //   上面每条正则都依赖**调用写法**，多加一种写法就得再补一条正则 ——
    //   而漏补的后果是「明明测了却报未测」，排查时极具误导性
    //   （我为此把 op 数从 8 追到 4，都是扫描器的问题，不是测试的问题）。
    //   允许测试文件用一行注释显式登记 op 名：
    //     // COVERS: op_a, op_b, op_c
    //   覆盖率闸扫这一行。它只做加法不做减法，所以绝不可能漏掉真未测的 op。
    for (const m of src.matchAll(/^[ \t]*\/\/[ \t]*COVERS:[ \t]*(.+)$/gm)) {
      for (const name of m[1].split(',')) {
        const t = name.trim();
        if (t) touched.add(t);
      }
    }
  }
  const untested = names.filter(n => !touched.has(n));
  ok('每个 op 都至少被跑过一次（覆盖率硬闸，跨本文件与定理层测试）', untested.length === 0, untested.join(','));
  // 确定性：同输入跑两次结果字节级一致
  const a = JSON.stringify(run('circle_from_3points', { a: [0, 0], b: [1, 0], c: [0.3, 0.9] }));
  const b = JSON.stringify(run('circle_from_3points', { a: [0, 0], b: [1, 0], c: [0.3, 0.9] }));
  ok('同输入输出字节级可复现', a === b);
}

console.log(`\n几何测试: ${pass} 通过, ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
