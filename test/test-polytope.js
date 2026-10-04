/**
 * 凸多胞形引擎（polytope.js）回归测试。
 *
 * 断言来源的原则：**期望值必须能手算，或者必须是数学上的硬不变量**。
 *
 * 这里最危险的一类 bug 是「静默算错」—— 体积算出来是个看着很合理的整数，
 * 但和真值差一个常数因子。历史记录：第一版用重心做扇形三角化的锥顶，
 * 重心不是格点，detBig 里 BigInt(Math.round()) 把 -0.6 截成 -1、2.4 截成 2，
 * 3·Δ₄ 的真值 nvol=81 被算成 **135**，不报错、看着像整数。
 * 固定算例挡不住这一类（当初固定算例全过），只有**不变量**挡得住。
 *
 * 不变量清单（每条都对应混合体积的一条公理，随机 365 例全测）：
 *   1. 整数性     lattice 多胞形的混合体积必为整数
 *   2. 非负性     MV ≥ 0
 *   3. 未混合     MV(P,...,P) = nvol(P)
 *   4. 平移不变   MV(P_i + t_i) = MV(P_i)
 *   5. 置换对称   MV 与 P_i 的排列顺序无关
 *   6. 包含单调   P_i ⊆ Q_i ⇒ MV(P) ≤ MV(Q)
 *   7. 多线性     MV(P+Q, R...) = MV(P,R...) + MV(Q,R...)   ← 最强的一条
 *   8. Bézout 上界 MV ≤ 各「外接单形」次数之积
 *
 * 运行：node test/test-polytope.js
 */
'use strict';

const P = require('../services/polytope.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`  ✗ ${name}${extra !== undefined ? '  got: ' + JSON.stringify(extra) : ''}`);
}
function eq(name, got, want) { ok(name, got === want, { got, want }); }
function throws(name, fn, type) {
  let caught = null;
  try { fn(); } catch (e) { caught = e; }
  ok(name, !!(caught && caught.type === type), caught && (caught.type + ': ' + caught.message));
}
const nvol = (pts, d) => P.convexHull(pts, d).normalizedVolume;
const mv = (polys) => P.mixedVolume(polys).mixedVolume;

// ══ 1. 归一化体积：真值可手算 ════════════════════════════════════════
console.log('归一化体积 nvol = d!·vol（真值可手算）:');
eq('单位三角形 (d=2)', nvol([[0, 0], [1, 0], [0, 1]], 2), 1);
eq('单位正方形 (d=2)', nvol([[0, 0], [1, 0], [1, 1], [0, 1]], 2), 2);
eq('2×2 正方形 (d=2)', nvol([[0, 0], [2, 0], [2, 2], [0, 2]], 2), 8);
eq('单位立方体 (d=3)', nvol([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1]], 3), 6);
eq('标准单形 (d=3)', nvol([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], 3), 1);
eq('标准单形 (d=4)', nvol([[0, 0, 0, 0], [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]], 4), 1);
// 冗余点不得改变体积，也不得污染顶点集
{
  // 三角形 (0,0),(2,0),(0,2) + 边内点 (1,0),(0,1) + 斜边上的 (1,1)
  // ⇒ 包还是那个三角形，nvol = 2·2/2 · 2! = 4，(1,1) 落在斜边上不算顶点
  const h = P.convexHull([[0, 0], [2, 0], [0, 2], [1, 0], [1, 1], [0, 1]], 2);
  eq('冗余点：体积不变', h.normalizedVolume, 4);
  eq('冗余点：顶点数=3', h.vertices.length, 3);
}

// k·Δ₄ 的全部格点：nvol = k^4（这条专门挡「锥顶取错」那类静默错误）
console.log('k·Δ_n 膨胀（真值 k^n）:');
{
  const lat = (n, k) => {
    const out = [];
    const rec = (prefix, left) => {
      if (prefix.length === n) { if (left >= 0) out.push(prefix.slice()); return; }
      for (let a = 0; a <= left; a++) rec(prefix.concat([a]), left - a);
    };
    rec([], k);
    return out;
  };
  for (let k = 1; k <= 5; k++) eq(`k·Δ₄ k=${k}`, nvol(lat(4, k), 4), Math.pow(k, 4));
  for (let k = 1; k <= 3; k++) eq(`k·Δ₅ k=${k}`, nvol(lat(5, k), 5), Math.pow(k, 5));
}

// 非单纯形多胞形（面高度非单纯形 —— 三角剖分最容易在这里虚高）
console.log('非单纯形多胞形:');
{
  const cube = [];
  for (let m = 0; m < 64; m++) { const p = []; for (let k = 0; k < 6; k++) p.push((m >> k) & 1); cube.push(p); }
  eq('{0,1}^6 立方体', nvol(cube, 6), 720);
  const box = [];
  for (let a = 0; a <= 2; a++) for (let b = 0; b <= 2; b++) for (let c = 0; c <= 2; c++)
    for (let x = 0; x <= 1; x++) for (let y = 0; y <= 1; y++) for (let z = 0; z <= 1; z++)
      box.push([a, b, c, x, y, z]);
  eq('[0,2]^3×[0,1]^3 全部格点', nvol(box, 6), 5760);
  const box4 = [];
  for (let a = 0; a <= 3; a++) for (let b = 0; b <= 3; b++) for (let c = 0; c <= 2; c++) for (let e = 0; e <= 2; e++)
    box4.push([a, b, c, e]);
  eq('[0,3]^2×[0,2]^2 全部格点', nvol(box4, 4), 864);
  // 交叉多胞形 ±e_i：vol = 2^6/6! ⇒ nvol = 64
  const cross = [];
  for (let i = 0; i < 6; i++) {
    const a = new Array(6).fill(0), b = new Array(6).fill(0);
    a[i] = 1; b[i] = -1; cross.push(a, b);
  }
  eq('6 维交叉多胞形', nvol(cross, 6), 64);
  // Δ₂ × Δ₃：vol = 1/(2!·3!) ⇒ nvol = 5!/12 = 10
  {
    const A = [[0, 0], [1, 0], [0, 1]], B = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const pts = []; for (const a of A) for (const b of B) pts.push(a.concat(b));
    eq('Δ₂ × Δ₃', nvol(pts, 5), 10);
  }
}

// 顶点还原（法锥判据）
console.log('顶点还原:');
eq('盒体顶点数（216 格点 → 64 顶点）', P.convexHull(
  (() => { const o = []; for (let a = 0; a <= 2; a++) for (let b = 0; b <= 2; b++) for (let c = 0; c <= 2; c++) for (let x = 0; x <= 1; x++) for (let y = 0; y <= 1; y++) for (let z = 0; z <= 1; z++) o.push([a, b, c, x, y, z]); return o; })(), 6
).vertices.length, 64);
eq('2·Δ₅ 格点（21 点 → 6 顶点）', P.convexHull(
  (() => { const o = []; for (let a = 0; a <= 2; a++) for (let b = 0; b + a <= 2; b++) for (let c = 0; c + b + a <= 2; c++) for (let e = 0; e + c + b + a <= 2; e++) for (let f = 0; f + e + c + b + a <= 2; f++) o.push([a, b, c, e, f]); return o; })(), 5
).vertices.length, 6);

// ══ 2. 混合体积：真值可手算 ══════════════════════════════════════════
console.log('混合体积（真值可手算）:');
eq('两坐标轴线段 (d=2)', mv([[[0, 0], [1, 0]], [[0, 0], [0, 1]]]), 1);
{
  const D2 = [[0, 0], [1, 0], [0, 1]];
  eq('MV(Δ₂,Δ₂) = nvol(Δ₂)', mv([D2, D2]), 1);
  const kD2 = (k) => { const p = []; for (let a = 0; a <= k; a++) for (let b = 0; b + a <= k; b++) p.push([a, b]); return p; };
  eq('MV(2Δ₂,3Δ₂) = 2·3·1', mv([kD2(2), kD2(3)]), 6);
  eq('MV(4Δ₂,5Δ₂) = 20', mv([kD2(4), kD2(5)]), 20);
}
eq('三坐标轴线段 (d=3)', mv([[[0, 0, 0], [1, 0, 0]], [[0, 0, 0], [0, 1, 0]], [[0, 0, 0], [0, 0, 1]]]), 1);
eq('三根长度 2 的线段 (d=3) = 8', mv([[[0, 0, 0], [2, 0, 0]], [[0, 0, 0], [0, 2, 0]], [[0, 0, 0], [0, 0, 2]]]), 8);
for (let n = 2; n <= 5; n++) {
  const sup = [];
  for (let i = 0; i < n; i++) {
    const e = new Array(n).fill(0); e[i] = 1;
    sup.push([new Array(n).fill(0), e]);
  }
  eq(`n 个坐标轴线段 (d=${n})`, mv(sup), 1);
}
{
  // 两条平行线段 ⇒ 混合体积 0（BKK 语义：孤立解数上界为 0 ⇒ 无孤立解）
  const r = P.mixedVolume([[[0, 0], [1, 0]], [[0, 0], [2, 0]]]);
  eq('平行线段 ⇒ MV=0', r.mixedVolume, 0);
  ok('MV=0 明确标注为「无孤立解」而非「算不出来」', r.zeroMeansNoIsolatedSolution === true, r.zeroMeansNoIsolatedSolution);
}

// ══ 3. 随机不变量（挡「第一次就错」的那类 bug）════════════════════════
console.log('随机不变量（每条对应混合体积的一条公理）:');
{
  let seed = 20260830;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const ri = (m) => Math.floor(rnd() * m);

  /** 随机格点多胞形：坐标在 0..span，点数 cnt */
  const randPoly = (d, cnt, span) => {
    const out = [], seen = new Set();
    let guard = 0;
    while (out.length < cnt && guard++ < cnt * 40) {
      const p = [];
      for (let k = 0; k < d; k++) p.push(ri(span + 1));
      const key = p.join(',');
      if (seen.has(key)) continue;
      seen.add(key); out.push(p);
    }
    return out;
  };
  const shift = (ps, t) => ps.map((p) => p.map((x, i) => x + t[i]));
  const mink = (A, B) => {
    const out = [], seen = new Set();
    for (const a of A) for (const b of B) {
      const p = a.map((x, i) => x + b[i]);
      const key = p.join(',');
      if (!seen.has(key)) { seen.add(key); out.push(p); }
    }
    return out;
  };

  let checked = 0;
  const bad = { integral: 0, nonneg: 0, unmixed: 0, translate: 0, permute: 0, monotone: 0, multilinear: 0, bezout: 0 };

  // 每条不变量都跑一遍。维数分布 2/3 为主、4 为小批：d=4 的多线性验证
  // 单次能到 500~800ms，全量跑会把测试拖到几分钟（实测 500 例全 d≤4 ≈ 170s）。
  const plan = [];
  for (let t = 0; t < 350; t++) plan.push(2 + ri(2));
  for (let t = 0; t < 15; t++) plan.push(4);

  const T0 = Date.now();
  for (const d of plan) {                       // 2..4 维（高维随机包太慢，另测）
    const polys = [];
    for (let i = 0; i < d; i++) polys.push(randPoly(d, 2 + ri(5), 2));
    let r;
    try { r = P.mixedVolume(polys); } catch (e) { continue; }
    const V = r.mixedVolume;

    // 1. 整数性
    if (!Number.isInteger(V)) bad.integral++;
    // 2. 非负
    if (!(V >= 0)) bad.nonneg++;
    // 3. 未混合：MV(Q,...,Q) = nvol(Q)
    {
      const Q = polys[0];
      let u;
      try { u = P.mixedVolume(new Array(d).fill(0).map(() => Q)).mixedVolume; } catch (e) { u = null; }
      if (u !== null && u !== nvol(Q, d)) bad.unmixed++;
    }
    // 4. 平移不变
    {
      const t2 = new Array(d).fill(0).map(() => ri(7) - 3);
      const moved = polys.map((ps, i) => shift(ps, new Array(d).fill(0).map((_, k) => t2[k] * (i === 0 ? 1 : 0))));
      let v2;
      try { v2 = P.mixedVolume(moved).mixedVolume; } catch (e) { v2 = null; }
      if (v2 !== null && v2 !== V) bad.translate++;
    }
    // 5. 置换对称
    {
      const perm = polys.slice().reverse();
      let v2;
      try { v2 = P.mixedVolume(perm).mixedVolume; } catch (e) { v2 = null; }
      if (v2 !== null && v2 !== V) bad.permute++;
    }
    // 6. 包含单调：P_0 ⊆ P_0 ∪ {远点} ⇒ MV 不减
    {
      const far = new Array(d).fill(0).map(() => 9);
      const grown = polys.slice();
      grown[0] = polys[0].concat([far]);
      let v2;
      try { v2 = P.mixedVolume(grown).mixedVolume; } catch (e) { v2 = null; }
      if (v2 !== null && v2 < V) bad.monotone++;
    }
    // 7. 多线性：MV(A+B, 其余) = MV(A,其余) + MV(B,其余)
    {
      const A = randPoly(d, 2 + ri(3), 1);
      const B = randPoly(d, 2 + ri(3), 1);
      const rest = polys.slice(1);
      let ab, av, bv;
      try {
        ab = P.mixedVolume([mink(A, B)].concat(rest)).mixedVolume;
        av = P.mixedVolume([A].concat(rest)).mixedVolume;
        bv = P.mixedVolume([B].concat(rest)).mixedVolume;
      } catch (e) { ab = null; }
      if (ab !== null && ab !== av + bv) bad.multilinear++;
    }
    // 8. Bézout 上界：P_i ⊆ deg_i·Δ ⇒ MV ≤ ∏ deg_i
    {
      let prod = 1;
      for (const ps of polys) {
        let deg = 0;
        for (const p of ps) { let s = 0; for (const x of p) s += x; if (s > deg) deg = s; }
        prod *= deg;
      }
      // 只在所有 P_i 都含原点、且坐标非负时成立（此时 P_i ⊆ deg_i·Δ_d）
      const okShape = polys.every((ps) => ps.every((p) => p.every((x) => x >= 0)))
        && polys.every((ps) => ps.some((p) => p.every((x) => x === 0)));
      if (okShape && V > prod) bad.bezout++;
    }
    checked++;
  }
  console.log(`  （实际完成 ${checked} 例，${Date.now() - T0}ms）`);
  ok('随机不变量：整数性', bad.integral === 0, bad.integral);
  ok('随机不变量：非负性', bad.nonneg === 0, bad.nonneg);
  ok('随机不变量：未混合 MV(P,…,P)=nvol(P)', bad.unmixed === 0, bad.unmixed);
  ok('随机不变量：平移不变', bad.translate === 0, bad.translate);
  ok('随机不变量：置换对称', bad.permute === 0, bad.permute);
  ok('随机不变量：包含单调', bad.monotone === 0, bad.monotone);
  ok('随机不变量：多线性（最强的一条）', bad.multilinear === 0, bad.multilinear);
  ok('随机不变量：MV ≤ Bézout ∏deg', bad.bezout === 0, bad.bezout);
}

// ══ 4. 退化与 fail-closed ═════════════════════════════════════════════
console.log('退化与规模闸（全部 fail-closed，绝不静默给数）:');
{
  const h = P.convexHull([[0, 0], [1, 1], [2, 2]], 2);
  eq('共线三点：环境体积=0', h.normalizedVolume, 0);
  eq('共线三点：degenerate', h.degenerate, 'not_full_dimensional');
  ok('共线三点：rank=1', h.rank === 1, h.rank);
}
eq('重合点集 (d=2)', P.convexHull([[1, 1], [1, 1]], 2).degenerate, 'not_full_dimensional');
eq('单点 (d=3)', P.convexHull([[0, 0, 0]], 3).normalizedVolume, 0);
eq('d=1 线段长度', P.convexHull([[2], [7]], 1).normalizedVolume, 5);
eq('d=1 退化点', P.convexHull([[3], [3]], 1).degenerate, 'not_full_dimensional');
throws('空点集', () => P.convexHull([], 2), 'invalid_input');
throws('维数越界', () => P.convexHull([[0, 0]], 99), 'invalid_input');
throws('维数非整数', () => P.convexHull([[0, 0]], 1.5), 'invalid_input');
throws('坐标个数不符', () => P.convexHull([[0, 0], [1]], 2), 'invalid_input');
throws('坐标非有限数', () => P.convexHull([[0, NaN]], 2), 'invalid_input');
throws('mixedVolume 空', () => P.mixedVolume([]), 'invalid_input');
throws('mixedVolume 维数不符', () => P.mixedVolume([[[0, 0]], [[0]]]), 'invalid_input');
{
  // 规模闸：6 维稠密二次必然超闸，且必须**快速**报错（预检 ≤ 几十 ms）
  const sup = [];
  for (let i = 0; i < 6; i++) {
    const s = [new Array(6).fill(0)];
    for (let a = 0; a < 6; a++) for (let b = a; b < 6; b++) {
      const e = new Array(6).fill(0); e[a] += 1; e[b] += 1; s.push(e);
    }
    for (let a = 0; a < 6; a++) { const e = new Array(6).fill(0); e[a] = 1; s.push(e); }
    sup.push(s);
  }
  const t0 = Date.now();
  let caught = null;
  try { P.mixedVolume(sup); } catch (e) { caught = e; }
  const ms = Date.now() - t0;
  ok('6 维稠密二次：超闸报 resource_limit', !!(caught && caught.type === 'resource_limit'), caught && caught.type);
  ok(`6 维稠密二次：早退够快（${ms}ms < 1500ms）`, ms < 1500, ms);
}

// ── 确定性 ────────────────────────────────────────────────────────────
console.log('确定性:');
{
  const pts = [[0, 0], [3, 1], [1, 3], [2, 2], [0, 3], [3, 0]];
  const a = JSON.stringify(P.convexHull(pts, 2));
  const b = JSON.stringify(P.convexHull(pts, 2));
  ok('同输入输出字节级可复现', a === b);
  ok('exact=true 时 normalizedVolume 是整数', Number.isInteger(P.convexHull(pts, 2).normalizedVolume));
}

console.log(`\n多胞形测试: ${pass} 通过, ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
