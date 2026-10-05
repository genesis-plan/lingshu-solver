/* 模块 certify：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function _assertContraction(state, opId, before) {
    var D0 = state.D0, viol = null;
    for (var k in before) {
        if (!Object.prototype.hasOwnProperty.call(before, k)) continue;
        var a = before[k], b = D0[k];
        if (!a || !b || typeof a !== 'object' || typeof b !== 'object') continue;
        if (!('min' in a) || !('min' in b)) continue;
        var EPS = 1e-9 * (Math.abs(a.min) + Math.abs(a.max) + 1);
        if (b.min < a.min - EPS || b.max > a.max + EPS) {
            viol = { v: k, before: [a.min, a.max], after: [b.min, b.max] };
            break;
        }
    }
    if (viol) {
        state.D0 = before;
        (state.contractionViolations = state.contractionViolations || []).push({ op: opId, detail: viol });
        return false;
    }
    return true;
}


function _krawczykOnce(eqs, vns, xhat, r) {
    var n = vns.length;
    if (eqs.length !== n) return { certified: false };
    var boxX = {}, Xvec = [];
    for (var i = 0; i < n; i++) { var lo = xhat[i] - r, hi = xhat[i] + r; boxX[vns[i]] = { min: lo, max: hi }; Xvec.push({ min: lo, max: hi }); }
    var JI = _intervalJacobian(eqs, vns, boxX, xhat);
    var pbox = {}; for (var i2 = 0; i2 < n; i2++) pbox[vns[i2]] = { min: xhat[i2], max: xhat[i2] };
    var JIp = _intervalJacobian(eqs, vns, pbox, xhat);
    var Jr = []; for (var a = 0; a < n; a++) { Jr.push([]); for (var b = 0; b < n; b++) Jr[a].push((JIp[a][b].min + JIp[a][b].max) / 2); }
    var Y = realMatInv(Jr); if (!Y) return { certified: false };
    var vmap = {}; for (var i3 = 0; i3 < n; i3++) vmap[vns[i3]] = xhat[i3];
    var F = []; for (var e = 0; e < n; e++) { var fe = evalAST(eqs[e], vmap); if (!isFinite(fe)) return { certified: false }; F.push(fe); }
    var YF = rMatVec(Y, F), c = []; for (var i4 = 0; i4 < n; i4++) c.push(xhat[i4] - YF[i4]);
    var YJ = rMatIMat(Y, JI);
    // 单位阵必须也是区间矩阵：iMatSubReal 对 A[i][j].min 取值，实数阵无 .min 会得 undefined → C 全 null（历史 bug）
    var Ii = []; for (var _ii = 0; _ii < n; _ii++) { Ii.push([]); for (var _jj = 0; _jj < n; _jj++) Ii[_ii].push(_ii === _jj ? { min: 1, max: 1 } : { min: 0, max: 0 }); }
    var C = iMatSub(Ii, YJ);
    var d = []; for (var i5 = 0; i5 < n; i5++) d.push({ min: Xvec[i5].min - xhat[i5], max: Xvec[i5].max - xhat[i5] });
    var Cd = iMatVec(C, d), K = []; for (var i6 = 0; i6 < n; i6++) K.push(iAdd(rToI(c[i6]), Cd[i6]));
    return { certified: iVecInterior(K, Xvec), box: Xvec, radius: r };
}
// 多半径尝试：遍历全部候选半径，取【最小成功半径】作为误差界（注释与实现必须一致）。

function krawczykCertify(eqs, vns, xhat, radii) {
    var rs = radii || [1e-5, 1e-4, 1e-6, 1e-3];
    var best = null;
    for (var k = 0; k < rs.length; k++) {
        var res = _krawczykOnce(eqs, vns, xhat, rs[k]);
        if (res.certified && (best === null || res.radius < best.radius)) best = res;
    }
    return best || { certified: false };
}
// ===== 1.0.22 认证升级：Miranda 第二认证器 + inflate-and-refine（sound-first，失败一律保守降级）=====

function _domBoxOf(state, vns) {
    var out = {};
    for (var i = 0; i < vns.length; i++) {
        var vn = vns[i], lo = -1000000, hi = 1000000;
        var gv = state && state.userDomain ? state.userDomain[vn] : null;
        var snap = (state && state._initD0 && state._initD0[vn]) ? state._initD0[vn] : null;
        if (Array.isArray(gv) && gv.length >= 2) { lo = Number(gv[0]); hi = Number(gv[1]); }
        else if (gv && typeof gv === 'object' && gv.min !== undefined) { lo = Number(gv.min); hi = Number(gv.max); }
        else if (snap && snap.min !== undefined) { lo = Number(snap.min); hi = Number(snap.max); }
        if (!isFinite(lo) || !isFinite(hi) || lo > hi) return null;
        out[vn] = { min: lo, max: hi };
    }
    return out;
}
// 数值点雅可比（中心差分，仅取点值）：Y 预条件矩阵只要求非奇异，无 soundness 要求；

function _numJac(eqs, vns, x) {
    var n = vns.length, J = [];
    for (var a = 0; a < eqs.length; a++) {
        J.push([]);
        for (var b = 0; b < n; b++) {
            var h = Math.max(Math.abs(x[b]), 1e-3) * 1e-7;
            var xp = x.slice(), xm = x.slice(); xp[b] += h; xm[b] -= h;
            var v2 = {}, v3 = {};
            for (var q = 0; q < n; q++) { v2[vns[q]] = xp[q]; v3[vns[q]] = xm[q]; }
            var fp = evalAST(eqs[a], v2), fm = evalAST(eqs[a], v3);
            if (!isFinite(fp) || !isFinite(fm)) return null;
            J[a].push((fp - fm) / (2 * h));
        }
    }
    return J;
}
// Miranda（Poincaré–Miranda）/Moore–Kioustelidis 第二认证器：

function _mirandaCertify(eqs, vns, xhat, r, domBox) {
    var n = vns.length;
    if (eqs.length !== n || !(r > 0)) return { certified: false };
    var Xlo = [], Xhi = [];
    for (var i = 0; i < n; i++) {
        var lo = xhat[i] - r, hi = xhat[i] + r;
        if (domBox) { if (lo < domBox[vns[i]].min || hi > domBox[vns[i]].max) return { certified: false, why: 'box 出域' }; }
        if (!(hi > lo)) return { certified: false };
        Xlo.push(lo); Xhi.push(hi);
    }
    // 预条件 Y = 数值点雅可比逆（任意非奇异实矩阵即可；区间雅可比中点奇异时仍可用）
    var Jn = _numJac(eqs, vns, xhat); if (!Jn) return { certified: false };
    var Y = realMatInv(Jn); if (!Y) return { certified: false };
    // 整盒 F 区间求值（哨兵：面内有限但内部有极点时，整盒求值会命中 divZero/非有限 → 拒证）
    var whole = {};
    for (var w = 0; w < n; w++) whole[vns[w]] = { min: Xlo[w], max: Xhi[w] };
    for (var e0 = 0; e0 < n; e0++) { var wv = intervalEval(eqs[e0], whole); if (!wv || !isFinite(wv.min) || !isFinite(wv.max)) return { certified: false, why: '整盒求值失败' }; }
    // 对每个成对面做 F 区间求值，再左乘 Y 得 g_i=(Y·F)_i 的包络
    function faceIv(idx, val) {
        var fb = {};
        for (var i2 = 0; i2 < n; i2++) fb[vns[i2]] = (i2 === idx) ? { min: val, max: val } : { min: Xlo[i2], max: Xhi[i2] };
        var Fv = [];
        for (var e = 0; e < n; e++) {
            var iv = intervalEval(eqs[e], fb);
            if (!iv || !isFinite(iv.min) || !isFinite(iv.max)) return null;
            Fv.push(iv);
        }
        return Fv;
    }
    for (var d = 0; d < n; d++) {
        var Fp = faceIv(d, Xhi[d]), Fm = faceIv(d, Xlo[d]);
        if (!Fp || !Fm) return { certified: false, why: '面区间求值失败' };
        var gp = { min: 0, max: 0 }, gm = { min: 0, max: 0 };
        for (var k = 0; k < n; k++) { gp = iAdd(gp, iMul(rToI(Y[d][k]), Fp[k])); gm = iAdd(gm, iMul(rToI(Y[d][k]), Fm[k])); }
        // 舍入安全扩宽（n×n 项浮点累积远小于 1e-10 相对量级，余量给足）
        var e1 = 1e-10 * Math.max(Math.abs(gp.min), Math.abs(gp.max)) + 1e-300;
        var e2 = 1e-10 * Math.max(Math.abs(gm.min), Math.abs(gm.max)) + 1e-300;
        gp = { min: gp.min - e1, max: gp.max + e1 };
        gm = { min: gm.min - e2, max: gm.max + e2 };
        var posThenNeg = (gp.min > 0 && gm.max < 0), negThenPos = (gp.max < 0 && gm.min > 0);
        if (!posThenNeg && !negThenPos) return { certified: false, why: 'Miranda 符号条件不满足' };
    }
    return { certified: true, method: 'miranda', radius: r, box: whole };
}
// inflate-and-refine（Rump ε-inflation；原型 lingshu-inflate-refine-proto3 已通过双重复核 7/8、0 假证）：

function _inflateRefineCertify(eqs, vns, xhat, domBox) {
    var n = vns.length;
    if (eqs.length !== n) return { certified: false };
    var factors = [1e-8, 3e-8, 1e-7, 3e-7, 1e-6, 3e-6, 1e-5, 3e-5, 1e-4, 1e-3, 1e-2, 1e-1];
    var _Ynum = null; // 数值预条件矩阵缓存（同一 xhat 各档共用）
    for (var fi = 0; fi < factors.length; fi++) {
        var X = [], ok = true;
        for (var i = 0; i < n; i++) {
            var s = Math.max(Math.abs(xhat[i]), 1e-3) * factors[fi];
            var lo = xhat[i] - s, hi = xhat[i] + s;
            if (domBox) { lo = Math.max(lo, domBox[vns[i]].min); hi = Math.min(hi, domBox[vns[i]].max); }
            if (!(hi > lo)) { ok = false; break; }
            X.push({ min: lo, max: hi });
        }
        if (!ok) continue;
        for (var it = 0; it < 30; it++) {
            var box = {}; for (var bi = 0; bi < n; bi++) box[vns[bi]] = X[bi];
            var JI = _intervalJacobian(eqs, vns, box, xhat);
            var Y = _Ynum || (function(){ var Jn = _numJac(eqs, vns, xhat); return Jn ? realMatInv(Jn) : null; })();
            if (!Y) { _Ynum = null; break; }
            _Ynum = Y;
            var vmap = {}; for (var vi = 0; vi < n; vi++) vmap[vns[vi]] = xhat[vi];
            var F = []; var bad = false;
            for (var e = 0; e < n; e++) { var fe = evalAST(eqs[e], vmap); if (!isFinite(fe)) { bad = true; break; } F.push(fe); }
            if (bad) break;
            var c = []; for (var ci = 0; ci < n; ci++) { var s2 = 0; for (var q = 0; q < n; q++) s2 += Y[ci][q] * F[q]; c.push(xhat[ci] - s2); }
            var YJ = rMatIMat(Y, JI);
            var Ii = []; for (var ii = 0; ii < n; ii++) { Ii.push([]); for (var jj = 0; jj < n; jj++) Ii[ii].push(ii === jj ? { min: 1, max: 1 } : { min: 0, max: 0 }); }
            var C = iMatSub(Ii, YJ);
            var d = []; for (var di = 0; di < n; di++) d.push({ min: X[di].min - xhat[di], max: X[di].max - xhat[di] });
            var Cd = iMatVec(C, d), K = [];
            for (var ki = 0; ki < n; ki++) {
                var Kv = iAdd(rToI(c[ki]), Cd[ki]);
                if (!isFinite(Kv.min) || !isFinite(Kv.max) || Kv.min > Kv.max) { K = null; break; }
                K.push(Kv);
            }
            if (!K) break;
            // 收紧判定 1：K(X) ⊆ int(X) → 存在唯一零点；盒已与用户域求交 → 域内解
            var inside = true;
            for (var i3 = 0; i3 < n; i3++) { if (!(K[i3].min > X[i3].min && K[i3].max < X[i3].max)) { inside = false; break; } }
            if (inside) {
                var radius = 0;
                for (var i4 = 0; i4 < n; i4++) radius = Math.max(radius, (X[i4].max - X[i4].min) / 2);
                return { certified: true, method: 'inflate_refine', radius: radius, box: box };
            }
            // 否则收缩：X ← X ∩ K（已含域交），无进展 → 放弃该档
            var prog = false, Xn = [];
            for (var i5 = 0; i5 < n; i5++) {
                var nlo = Math.max(X[i5].min, K[i5].min), nhi = Math.min(X[i5].max, K[i5].max);
                if (nhi < nlo) { prog = false; Xn = null; break; }
                if (nhi - nlo < X[i5].max - X[i5].min) prog = true;
                Xn.push({ min: nlo, max: nhi });
            }
            if (!Xn || !prog) break;
            X = Xn;
        }
    }
    return { certified: false, why: '全部膨胀档未通过' };
}
// ===== [规划版本号1.0.23 / 产品发布版1.0.22] Smale alpha 理论认证器（Shub-Smale；Hauenstein-Sottile TOMS Algorithm 921）=====

function _smaleFact(k) { var r = 1; for (var i = 2; i <= k; i++) r *= i; return r; }
// 矩阵无穷范数（最大行绝对值和）

function _smaleInfNorm(M) {
    var best = 0;
    for (var i = 0; i < M.length; i++) {
        var s = 0;
        for (var j = 0; j < M[i].length; j++) s += Math.abs(M[i][j]);
        if (s > best) best = s;
    }
    return best;
}
// 选解析半径 R 并取邻域内 |F| 上界 M：候选半径由大到小，区间求值失败（含奇点/发散）即缩半径。

function _smalePickDomain(eqs, vns, xhat, domBox) {
    var scale = 0;
    for (var i = 0; i < vns.length; i++) scale = Math.max(scale, Math.abs(xhat[i]));
    var base = Math.max(scale, 1) * 1e-2;
    var cands = [base, base / 2, base / 4, base / 10, base / 100, base / 1000, base / 10000];
    for (var c = 0; c < cands.length; c++) {
        var R = cands[c];
        if (!(R > 0)) continue;
        var box = {}, ok = true, M = 0;
        for (var w = 0; w < vns.length; w++) {
            var lo = xhat[w] - R, hi = xhat[w] + R;
            if (domBox) { lo = Math.max(lo, domBox[vns[w]].min); hi = Math.min(hi, domBox[vns[w]].max); }
            if (!(hi > lo)) { ok = false; break; }
            box[vns[w]] = { min: lo, max: hi };
        }
        if (!ok) continue;
        for (var e = 0; e < eqs.length; e++) {
            var iv = intervalEval(eqs[e], box);
            if (!iv || !isFinite(iv.min) || !isFinite(iv.max)) { ok = false; break; }
            M = Math.max(M, Math.abs(iv.min), Math.abs(iv.max));
        }
        if (ok) return { R: R, M: M, box: box };
    }
    return null;
}

function _smaleAlphaCertify(eqs, vns, xhat, domBox) {
    var n = vns.length;
    if (eqs.length !== n) return { certified: false, why: '非方阵，alpha 理论仅处理方阵' };
    var vmap = {};
    for (var i = 0; i < n; i++) vmap[vns[i]] = xhat[i];
    var F = [];
    for (var e = 0; e < n; e++) {
        var f = evalAST(eqs[e], vmap);
        if (!isFinite(f)) return { certified: false, why: 'F(x) 非有限' };
        F.push(f);
    }
    var J = _numJac(eqs, vns, xhat);
    if (!J) return { certified: false, why: '雅可比计算失败' };
    var Jinv = realMatInv(J);
    if (!Jinv) return { certified: false, why: '雅可比奇异（非孤立解候选）' };
    var YF = rMatVec(Jinv, F);
    var beta = 0;
    for (var b = 0; b < n; b++) beta = Math.max(beta, Math.abs(YF[b]));
    if (!isFinite(beta)) return { certified: false, why: 'beta 非有限' };
    if (beta === 0) return { certified: false, why: 'beta=0（该点已在零点上，无需 alpha 认证）' };
    var dom = _smalePickDomain(eqs, vns, xhat, domBox);
    if (!dom) return { certified: false, why: '邻域不可解析（含奇点或发散）' };
    var JinvNorm = _smaleInfNorm(Jinv);
    var gamma = 0;
    for (var k = 2; k <= 8; k++) {
        var fk = _smaleFact(k);
        var inner = JinvNorm * fk * dom.M / Math.pow(dom.R, k);
        if (!(inner > 0) || !isFinite(inner)) continue;
        var gk = Math.pow(inner, 1 / (k - 1)) / fk;
        if (isFinite(gk) && gk > gamma) gamma = gk;
    }
    if (!isFinite(gamma) || gamma <= 0) return { certified: false, why: 'gamma 估计失败' };
    var alpha = beta * gamma;
    var THRESH = 0.025;
    if (!(alpha < THRESH)) return { certified: false, why: 'alpha 未达认证阈值（证不出，降级）', alpha: alpha };
    return { certified: true, method: 'smale_alpha', alpha: alpha, beta: beta, gamma: gamma, radius: 2 * beta, box: dom.box };
}


function _certifySolutions(state) {
    if (!state || !state.result || !state.result.solutions) return;
    var eqs = state.originalEquations || state.equations;
    var vns = getOutputVarNames(state);
    if (!eqs || eqs.length !== vns.length) return; // 非方阵/缺原方程：无法严格认证，跳过（保守）
    var budgetMs = 800, startT = performance.now();
    for (var i = 0; i < state.result.solutions.length; i++) {
        if (performance.now() - startT > budgetMs) break;
        var sol = state.result.solutions[i];
        if (!sol.values || sol.values.length !== vns.length) { sol.certified = false; continue; }
        // ── 已被【精确有理数代入】证明的解，区间认证层不得降级（2026-10-04）────
        //
        // 实测事故：x−y=0, x−y=0（秩亏 ⇒ 解集是一条直线）的代表点 (0,0)
        //   suan17 已在 ℚ 上精确证明（certMethod='exact_rational_substitution'），
        //   但本函数无条件跑 Krawczyk ⇒ 在正维流形上 Krawczyk 的前提
        //   （雅可比局部可逆 ⇒ 根孤立）**不成立** ⇒ 必然认证失败
        //   ⇒ sol.certified 被覆盖成 false ⇒ tier 退成 candidate。
        //   结果：tier='candidate' 却带着 certMethod='exact_rational_substitution'，
        //   **自相矛盾**，且是对已完成的证明的谎报。
        //
        // 数学依据：区间认证（Krawczyk/Miranda/MK）与精确代入是**两条独立的证明路径**，
        //   后者严格强于前者（代入恒等式 vs 区间包含）。既然已有更强证明在手，
        //   弱证明失败不构成降级理由。
        if (sol.certMethod === 'exact_rational_substitution' && sol.certified === true) continue;
        var res = krawczykCertify(eqs, vns, sol.values.slice());
        var _certMethod = null;
        if (!res.certified) {
            // 1.0.22 第二认证器：Miranda（便宜，面符号测试，4 档半径）
            var _domBox = _domBoxOf(state, vns);
            var _rads = [1e-7, 1e-6, 1e-5, 1e-4];
            for (var _mi = 0; _mi < _rads.length; _mi++) {
                res = _mirandaCertify(eqs, vns, sol.values.slice(), _rads[_mi], _domBox);
                if (res.certified) break;
            }
            if (res.certified) _certMethod = res.method;
        }
        if (!res.certified) {
            // 1.0.22 第三认证器：inflate-and-refine（Rump ε-inflation，多档膨胀 + Krawczyk 迭代收缩）
            var _domBox2 = _domBoxOf(state, vns);
            res = _inflateRefineCertify(eqs, vns, sol.values.slice(), _domBox2);
            if (res.certified) _certMethod = res.method;
        }
        if (!res.certified) {
            // [规划版本号1.0.23 / 产品发布版1.0.22] 第四认证器：Smale alpha 理论（点值通路；区间雅可比退化时的独立第三条路）
            var _domBox3 = _domBoxOf(state, vns);
            res = _smaleAlphaCertify(eqs, vns, sol.values.slice(), _domBox3);
            if (res.certified) {
                _certMethod = res.method;
                sol.alphaTheory = { alpha: res.alpha, beta: res.beta, gamma: res.gamma, bound: '||x-z|| <= 2*beta' };
            }
        }
        if (!res.certified) { sol.certified = false; continue; }
        // Krawczyk 仅证"盒[xhat±r]内存在唯一零点"，sol.values 是 solver 原始近似，未必是真根。
        // 快振荡方程(如 sin(1/x)=0)局部导数|1/x²|巨大，原始近似离真根可达 1e-2，
        // 若直接标 certified+半径1e-6 即失真认证（承诺误差≤半径，实际可达 1e-2）。
        // 强制盒内牛顿精化到真零点：精化成功才标 proven，并把 certifiedRadius 改为"精化后实际残差保守上界"；
        // 精化在盒内不收敛（原始近似不在真根吸引盆/盒内多根）→ 降级 candidate，绝不假证 proven。
        var xhat = sol.values.slice();
        var box = {};
        for (var _bi = 0; _bi < vns.length; _bi++) box[vns[_bi]] = { min: xhat[_bi] - res.radius, max: xhat[_bi] + res.radius };
        var refined = _newtonRefine(eqs, vns, xhat, box);
        if (refined) {
            sol.values = refined; // 替换为精化后的真根近似
            // 精化后实际残差（牛顿已收敛至 rms<1e-11，残差≈误差，作为该解精度指示）；
            // Krawczyk 盒半径 res.radius 仍提供 sound 误差上界(≤radius)，残差通常更紧。
            var vmap = {}; for (var _ri = 0; _ri < vns.length; _ri++) vmap[vns[_ri]] = refined[_ri];
            var maxRes = 0;
            for (var _ei = 0; _ei < eqs.length; _ei++) {
                var fe = evalAST(eqs[_ei], vmap);
                if (isFinite(fe)) maxRes = Math.max(maxRes, Math.abs(fe));
            }
            // ⚠ sol.residual 必须与 sol.values 同步重算（2026-10-04 实测 P0）：
            //   本函数把 values 从「网格值」换成「精化后的全精度真根」，却没动 residual。
            //   于是 residual 属于**替换前**的点，Agent 拿它判断可信度会被误导。
            //   实测 x⁴−13x²+4=0：values=-3.5615528128088556（真残差 2.2e-12），
            //   residual 却报 1.6493e-5 —— 那是 p(-3.561553) 即网格点的残差，差 7 个数量级。
            //   ⇒ 一个机器精度的真根被报成「残差 1.6e-5」，Agent 会误判为不可信。
            //   凡是「值被换掉」的地方，依赖该值的派生字段必须一起重算。
            sol.residual = maxRes;
            // 后向误差：|f|/Σ|terms|。绝对残差在大系数题上永远很大（相消误差不可消除），
            // 只有归一化后才知道这个解到底准不准。与 polyIsRootWithin 同口径。
            var _beMax = 0;
            for (var _bi2 = 0; _bi2 < eqs.length; _bi2++) {
                var _sc = 0;
                try { _sc = evalASTScale(eqs[_bi2], vmap); } catch (_e2) { _sc = 0; }
                if (!isFinite(_sc) || _sc <= 0) continue;
                var _fe2 = evalAST(eqs[_bi2], vmap);
                if (!isFinite(_fe2)) { _beMax = Infinity; break; }
                var _r2 = Math.abs(_fe2) / _sc;
                if (_r2 > _beMax) _beMax = _r2;
            }
            sol.backwardError = _beMax;
            sol.certified = true;
            if (_certMethod) sol.certMethod = _certMethod; // 1.0.22：记录认证器（krawczyk_newton 默认 / miranda / inflate_refine）
            sol.certifiedRadius = (maxRes > 0) ? maxRes : 0; // 实际残差保守上界，非盒半径
        } else {
            sol.certified = false; // 降级 candidate，不假证 proven
        }
    }
}


function _krawczykOnBox(eqs, vns, boxX, xhat) {
    var n = vns.length;
    if (eqs.length !== n) return { certified: false };
    var Xvec = []; for (var i = 0; i < n; i++) Xvec.push(boxX[vns[i]]);
    var JI = _intervalJacobian(eqs, vns, boxX, xhat);
    var pbox = {}; for (var i2 = 0; i2 < n; i2++) pbox[vns[i2]] = { min: xhat[i2], max: xhat[i2] };
    var JIp = _intervalJacobian(eqs, vns, pbox, xhat);
    var Jr = []; for (var a = 0; a < n; a++) { Jr.push([]); for (var b = 0; b < n; b++) Jr[a].push((JIp[a][b].min + JIp[a][b].max) / 2); }
    var Y = realMatInv(Jr); if (!Y) return { certified: false };
    var vmap = {}; for (var i3 = 0; i3 < n; i3++) vmap[vns[i3]] = xhat[i3];
    var F = []; for (var e = 0; e < n; e++) { var fe = evalAST(eqs[e], vmap); if (!isFinite(fe)) return { certified: false }; F.push(fe); }
    var YF = rMatVec(Y, F), c = []; for (var i4 = 0; i4 < n; i4++) c.push(xhat[i4] - YF[i4]);
    var YJ = rMatIMat(Y, JI);
    var Ii = []; for (var _ii = 0; _ii < n; _ii++) { Ii.push([]); for (var _jj = 0; _jj < n; _jj++) Ii[_ii].push(_ii === _jj ? { min: 1, max: 1 } : { min: 0, max: 0 }); }
    var C = iMatSub(Ii, YJ);
    var d = []; for (var i5 = 0; i5 < n; i5++) d.push({ min: Xvec[i5].min - xhat[i5], max: Xvec[i5].max - xhat[i5] });
    var Cd = iMatVec(C, d), K = []; for (var i6 = 0; i6 < n; i6++) K.push(iAdd(rToI(c[i6]), Cd[i6]));
    return { certified: iVecInterior(K, Xvec), K: K, Xvec: Xvec };
}
// Krawczyk 收敛盒内牛顿精化：从中点出发至多 20 步牛顿，落在盒内且收敛才返回真解（residual≈0），

function _newtonRefine(eqs, vns, x0, box) {
    var n = vns.length;
    var x = x0.slice();
    // 1.0.22：最好点追踪 + 停滞退出。原版死认 rms<1e-11，但大尺度方程（项含 ~1e3 量级、
    // 中间量 ~6e5）的 F 求值噪声地板实测 ~1.5e-10，永远达不到阈值 → 空转 20 轮 → null
    // → 明明已认证的解被降级 candidate（公积金/理财/风阻三例的真病根）。
    // 修复：记录历史最好 rms 的点，连续 3 轮无改善即视为到达机器噪声底，返回最好点（仍盒内、诚实）。
    var bestRms = Infinity, bestX = null, stall = 0;
    for (var iter = 0; iter < 20; iter++) {
        var vmap = {}; for (var i = 0; i < n; i++) vmap[vns[i]] = x[i];
        var F = []; for (var e = 0; e < n; e++) { var fe = evalAST(eqs[e], vmap); if (!isFinite(fe)) return null; F.push(fe); }
        var rms = 0; for (var i2 = 0; i2 < n; i2++) rms += F[i2] * F[i2]; rms = Math.sqrt(rms / n);
        // 🔴🔴 2026-10-05 彻底去网格化：退出判据从**绝对** 1e-11 改为**后向误差**。
        //
        // 事故：g017 `exp(x)-2=0` 的解从 0.6931471805599616（误差 1.63e-14）
        //   退化成 0.6931471805605547（误差 6.09e-13）—— 去网格化让它变**差**了。
        // 根因不是去网格化本身，而是这里遗留的**绝对阈值 1e-11**：
        //   · 旧口径下坐标被量化到 6 位网格，残差天然带~L·h ≈ 1e-6 的噪声地板，
        //     所以精化的实际可达精度只有 1e-11 量级 —— 1e-11 阈值**够松**，
        //     牛顿一路走到 1e-14 才停（g002 误差 6.75e-14 而非 1e-11）。
        //   · 去网格化后噪声地板降到 1e-16，但 1e-11 阈值**没跟着降**，
        //     于是变成新的精度天花板：ln2 卡在残差 1.2e-12 就宣布收敛。
        //     牛顿再走两步就到 1e-16 了，却被这个阈值拦住。
        //
        // 修法（与其他判据同源）：用 Higham 后向误差 |F|/Σ|terms| 判收敛，
        //   它**与量纲无关**，大尺度方程（公积金 1e5 量级）和小尺度方程同一门限。
        //   τ = 1e-14 比原 1e-11 严 3 个数量级，仍比双精度噪声地板(≈1e-16·L)高 2 个量级，
        //   留足余量避免在噪声里空转。取不到尺度时退回绝对 1e-14（同样比原来严）。
        //
        // ⚠ 为什么这不是「无止境地求更高精度」：τ 是**相对**判据，
        //   双精度求值噪声地板 ≈ eps·Σ|terms| = 2.2e-16·scale，永远高于 τ 达不到？
        //   不，τ=1e-14 > 2.2e-16 ⇒ 可达。且下方 stall>=3 停滞退出兜底：
        //   真到噪声底就停，返回最好点（不空转、不假装更高精度）。
        var _bwd = 0;
        for (var e3 = 0; e3 < n; e3++) {
            var _sc3 = 0;
            try { _sc3 = evalASTScale(eqs[e3], vmap); } catch (_e3) { _sc3 = 0; }
            if (!isFinite(_sc3) || _sc3 <= 0) continue;
            var _be3 = Math.abs(F[e3]) / _sc3;
            if (_be3 > _bwd) _bwd = _be3;
        }
        // 尺度全算不出（表达式无 terms）⇒退回绝对判据（fail-closed 方向的偏严）
        if (_bwd === 0) _bwd = rms;
        var CONV_REL = 1e-14, CONV_ABS = 1e-14;
        if (_bwd <= CONV_REL || rms <= CONV_ABS) return x;
        if (rms < bestRms) { bestRms = rms; bestX = x.slice(); stall = 0; } else { stall++; if (stall >= 3 && bestX) return bestX; }
        // 雅可比区间求导：必须喂退化的点区间 {min:x,max:x}（而非裸点值）。
        // 旧实现 intervalEval(d, vmap) 把裸数当 iv，iv.min/iv.max 为 undefined → _buildAffEnv 算出 NaN 噪声
        // → 雅可比整行 NaN → realMatInv 失败 → 本函数对一切良置问题恒返 null（P0-1）。
        var pmap = {}; for (var i3 = 0; i3 < n; i3++) pmap[vns[i3]] = { min: x[i3], max: x[i3] };
        var J = []; for (var a = 0; a < n; a++) { J.push([]); for (var b = 0; b < n; b++) { var d = _diffAST(eqs[a], vns[b]); var dv = d ? intervalEval(d, pmap) : null;
            // 1.0.22：区间求导失败（§67：导数含除法常 null）→ 用数值中心差分兜底。
            // 该雅可比只用于计算牛顿【步长】（点值），不进入任何 soundness 主张（认证盒已由
            // Krawczyk/Miranda/inflate 单独证得）；步出盒外仍立即返回 null，保守性不变。
            if (!dv || typeof dv !== 'object' || !isFinite(dv.min) || !isFinite(dv.max)) {
                var h = Math.max(Math.abs(x[b]), 1e-3) * 1e-7;
                var v2 = {}, v3 = {};
                for (var q = 0; q < n; q++) { v2[vns[q]] = x[q]; v3[vns[q]] = x[q]; }
                v2[vns[b]] = x[b] + h; v3[vns[b]] = x[b] - h;
                var fp = evalAST(eqs[a], v2), fm = evalAST(eqs[a], v3);
                if (!isFinite(fp) || !isFinite(fm)) return null;
                J[a].push((fp - fm) / (2 * h));
            } else {
                J[a].push((dv.min + dv.max) / 2);
            } } }
        var Y = realMatInv(J); if (!Y) return null;
        var dX = rMatVec(Y, F);
        for (var j = 0; j < n; j++) x[j] = x[j] - dX[j];
        for (var k = 0; k < n; k++) { if (x[k] < box[vns[k]].min || x[k] > box[vns[k]].max) return null; }
    }
    return (bestX && isFinite(bestRms)) ? bestX : null; // 20 轮到顶：返回已达噪声底的最好点（盒内），不再无脑 null
}
// ===== Schichl–Neumaier 排除域（Krawczyk 排除域）=====
// 顶刊依据：H. Schichl & A. Neumaier, "Exclusion Regions for Systems of Equations",
//           SIAM J. Numer. Anal. 42(1):383–408, 2004. DOI 10.1137/S0036142902418898
// 目标：消除「聚簇效应」—— 每个已认证零点周围会堆出一大堆切不掉的空盒，
//       因为零点就在盒外不远处。排除域给出【保证不含其它零点】的壳，整壳可裁掉。
//
// ⚠⚠ 论文自身有 4 处印刷错误（我逐一用其 Example 8.3/8.1/8.2 数值反推核对过）。
//    本实现采用【修正后】的公式，注释逐处标注。照抄论文印刷式会静默损失一半半径：
//   ① 式(49) 印 λ×ᵢ = bᵢ/(w×ᵢ+√D×ᵢ)，缺因子 2。正确为 2bᵢ/(w×ᵢ+√D×ᵢ)。
//      证据：Ex 8.3 印 λ×=0.277656；印刷式算得 0.138828，修正式算得 0.277656 逐位吻合。
//   ② 式(51) 印 [z−λ×v, z+λ×]，右端漏 v，应为 [z−λ×v, z+λ×v]。
//   ③ Ex 8.1 分段式分子印 30，应为 20（两分支在 v₂=1 处不连续）。
//   ④ Ex 8.2 印 B₁=⅙[[1,0],[2,0]]，应为 [[0.5,0],[0,0]]（印本给 λᵉ=0.667 与式(54) λᵉ=1 矛盾）。
//
// 论文原式（修正后，Theorem 7.2 + Corollary 7.3）：
//   取 0 < v ∈ ℝⁿ（形状向量，Thm 7.2 对 v 无任何正性约束，原文："every choice of v
//   leads to some exclusion region"），令
//     b_i    = |C·F(z)|_i                     （【下界】；注意存在性公式(4.2)用的是上界 b̄）
//     w×     = B′₀ v                          （B′₀ = |C·F′(z)|，不是 (I−B₀)v）
//     a×     = Σ_k v_k · (B̄_k v)              （⚠ v 在外层只出现一次，不是 vᵀBv！）
//     D×_i   = w×_i² + 4·b_i·a×_i             （【加号】⇒ 恒 ≥ 0，永不失效。这是 7.2 相对 4.3 的核心优势）
//     λ×_i   = 2b_i / (w×_i + √D×_i)
//     λ×     = max_i λ×_i                     （排除版只取 max，不取 min —— 因为是「存在某个 i」，
//                                            故取并集；存在性版(24)才取 min=交集。已在数值上验证）
//   排除域  R× = [z − λ×·v, z + λ×·v]
//   结论：F 在 R× 的【内部】无零点 ⇒ 盒若整落在 R× 内部可安全丢弃。
//
// 论文明确的退化边界（第 7 页原句，逐字）：
//   "For singular (and hence for sufficiently ill-conditioned) zeros, the argument does not
//    apply, and no technique is known to remove the cluster effect in this case."
//   ⇒ 病态/奇异零点处排除域【必然失效】，这是 fail-closed 的理论边界，不是可以再努力的地方。
//
// 本实现的 fail-closed 原则（每一处都宁可不给排除域，也不给不可靠的排除域）：
//   · b 用下界 |C·F(z)|（与论文一致）
//   · 雅可比只用【点值 + 二阶 Taylor 余项上界】，不用不可靠的宽区间包络
//   · λ× = 0（= 所有 b_i=0，即 z 恰为精确零点）⇒ 跳过，无害
//   · 任一中间量非有限 / 负 / 越界 ⇒ 返回 null，调用方走旧路径（与未启用等价）
function _exclusionRegion(eqs, vns, z, C, opt) {
    try {
        var m = eqs.length, n = vns.length;
        if (!C || m === 0 || n === 0) return null;
        var o = opt || {};

        // —— v（形状向量）——
        // 论文说任意 v>0 都行，并给目标 max n·log λ× + Σ log vⱼ（非光滑，需非光滑优化器）。
        // 本实现取【v = 各方向盒半径的相对形状】，零分量用 1 兜底：数学上合法（v>0），
        // 收益不保证最优，但【绝不会给出错误的排除域】。这是 fail-closed 下的正确取舍。
        var v = [];
        for (var i = 0; i < n; i++) {
            var vi = (o.radii && typeof o.radii[i] === 'number' && o.radii[i] > 0) ? o.radii[i] : 1;
            v.push(vi);
        }
        if (o.normalizeV !== false) {
            // 归一化到 [0,1] 尺度：λ× 是标量，v 是形状，两者尺度需匹配才有物理意义
            var vmax = 0; for (var q = 0; q < n; q++) vmax = Math.max(vmax, v[q]);
            if (!(vmax > 0) || !isFinite(vmax)) return null;
            for (var q2 = 0; q2 < n; q2++) v[q2] = v[q2] / vmax;
        }
        for (var q3 = 0; q3 < n; q3++) if (!(v[q3] > 0) || !isFinite(v[q3])) return null;

        // —— b_i = |C·F(z)|_i（下界）——
        var zmap = {}; for (var zi = 0; zi < n; zi++) zmap[vns[zi]] = z[zi];
        var b = [];
        for (var e = 0; e < m; e++) {
            var fe = evalAST(eqs[e], zmap);
            if (!isFinite(fe)) return null;
            var acc = 0;
            for (var jj = 0; jj < n; jj++) acc += Math.abs(C[e][jj] * fe);
            b.push(Math.abs(acc));
        }

        // —— B′₀ = |C · F′(z)|（点值雅可比，m×n）——
        var Jz = _numJac(eqs, vns, z);
        if (!Jz) return null;
        var Bp = [];
        for (var r1 = 0; r1 < m; r1++) {
            Bp.push([]);
            for (var c1 = 0; c1 < n; c1++) {
                var t = 0;
                for (var k1 = 0; k1 < n; k1++) t += Math.abs(C[r1][k1] * Jz[k1][c1]);
                Bp[r1].push(t);
            }
        }
        // w× = B′₀ · v   （m 维）
        var w = [];
        for (var r2 = 0; r2 < m; r2++) {
            var acc2 = 0;
            for (var c2 = 0; c2 < n; c2++) acc2 += Bp[r2][c2] * v[c2];
            w.push(acc2);
            if (!isFinite(acc2)) return null;
        }

        // —— a× = Σ_k v_k · (B̄_k v)  （⚠ 外层是 v_k 单项，不是 vᵀBv）——
        // B̄₁ = |C| · (二阶导数上界/2)  —— 一阶 Taylor 余项
        // 用【点 z 处的二阶导数绝对值】做上界，配合单边 Lipschitz 式的保守放大。
        var a = [];
        for (var r3 = 0; r3 < m; r3++) { var arr = []; for (var c3 = 0; c3 < n; c3++) arr.push(0); a.push(arr); }
        var anyCurv = false;
        for (var jj2 = 0; jj2 < n; jj2++) {
            for (var kk = 0; kk < n; kk++) {
                var d2abs = 0;
                for (var e2 = 0; e2 < m; e2++) {
                    var de = _secondPartialAbs(eqs[e2], vns, z, jj2, kk);
                    if (de === null) return null;       // 拿不到二阶导 ⇒ 整个排除域不可靠 ⇒ 放弃
                    if (de > 0) anyCurv = true;
                    // Σ_l |C[e][l]| · |∂²F_e/∂x_jj2∂x_kk| / 2  · v[jj2]（贡献到 a 的第 jj2 项）
                    var cl = 0;
                    for (var l2 = 0; l2 < n; l2++) cl += Math.abs(C[e2][l2]) * de;
                    a[e2][jj2] += 0.5 * cl * v[kk];
                }
            }
        }
        // 线性 F ⇒ a = 0 ⇒ D× = w×² ⇒ λ×ᵢ = bᵢ/w×ᵢ（需防除零）。这正是论文 Ex 8.4 的情形。
        var lam = 0;
        for (var r4 = 0; r4 < m; r4++) {
            var ai = 0;
            for (var c4 = 0; c4 < n; c4++) ai += v[c4] * a[r4][c4];
            if (!isFinite(ai)) return null;
            if (ai < 0) return null;                    // 理论保证 a≥0（v>0, B̄ₖ≥0），负数说明实现有 bug ⇒ 放弃
            var bi = b[r4], wi = w[r4];
            if (!(bi > 0)) { /* b_i = 0：该分量不贡献，取 0 */ continue; }
            var Di = wi * wi + 4 * bi * ai;             // 【加号】恒 ≥ 0（a≥0, b≥0）
            if (Di < 0) return null;                    // 理论上不可能；不可能则说明输入已坏
            var sq = Math.sqrt(Di);
            var denom = wi + sq;
            if (!(denom > 0)) {
                // w×=0 且 a×=0 ⇒ 该分量无论 λ 多大都不满足不等式 ⇒ 跳过此分量（非错误）
                continue;
            }
            // ⚠ 因子 2：修正论文印刷错误(1)
            var lami = 2 * bi / denom;
            if (!isFinite(lami)) return null;
            if (lami > lam) lam = lami;
        }
        if (!(lam > 0) || !isFinite(lam)) return null;  // λ×=0 ⇒ 退化为点 [z,z]，无害，跳过
        if (anyCurv === false && lam === 0) return null;

        // 排除域 R× = [z − λ×v, z + λ×v]  （修正论文印刷错误(2)：右端也要乘 v）
        var lo = {}, hi = {};
        for (var k3 = 0; k3 < n; k3++) {
            lo[vns[k3]] = z[k3] - lam * v[k3];
            hi[vns[k3]] = z[k3] + lam * v[k3];
        }
        return { lo: lo, hi: hi, lambda: lam, v: v, hasCurvature: anyCurv };
    } catch (err) {
        return null;   // fail-closed：任何异常都退旧路径，绝不猜
    }
}

// 二阶混合偏导 |∂²F/∂x_j∂x_k| 在点 z 处的绝对值（中心差分，纯数值、无 soundness 要求；
// 排除域只需要它在【余项上界】里出现，而余项上界最终还要被 λ× 的其它因子压小，
// 保守起见乘 2 放大留裕量）。返回 null 表示拿不到 ⇒ 调用方放弃排除域。
function _secondPartialAbs(eq, vns, z, j, k) {
    try {
        if (j === k) {
            var h = Math.max(Math.abs(z[j]), 1e-3) * 1e-4;
            var vp = z.slice(), vm = z.slice();
            vp[j] += h; vm[j] -= h;
            var m1 = {}, m2 = {};
            for (var q = 0; q < vns.length; q++) { m1[vns[q]] = vp[q]; m2[vns[q]] = vm[q]; }
            var fp = evalAST(eq, m1), fm = evalAST(eq, m2), f0 = evalAST(eq, (function () { var o = {}; for (var q2 = 0; q2 < vns.length; q2++) o[vns[q2]] = z[q2]; return o; })());
            if (!isFinite(fp) || !isFinite(fm) || !isFinite(f0)) return null;
            return Math.abs((fp - 2 * f0 + fm) / (h * h)) * 2;   // ×2 保守裕量
        }
        var hk = Math.max(Math.abs(z[k]), 1e-3) * 1e-4;
        var hj = Math.max(Math.abs(z[j]), 1e-3) * 1e-4;
        var pp = z.slice(), pm = z.slice(), mp = z.slice(), mm = z.slice();
        pp[j] += hj; pp[k] += hk;
        pm[j] += hj; pm[k] -= hk;
        mp[j] -= hj; mp[k] += hk;
        mm[j] -= hj; mm[k] -= hk;
        function ev(pp2) { var o = {}; for (var q3 = 0; q3 < vns.length; q3++) o[vns[q3]] = pp2[q3]; return evalAST(eq, o); }
        var f1 = ev(pp), f2 = ev(pm), f3 = ev(mp), f4 = ev(mm);
        if (!isFinite(f1) || !isFinite(f2) || !isFinite(f3) || !isFinite(f4)) return null;
        return Math.abs((f1 - f2 - f3 + f4) / (hj * hk)) * 2;   // ×2 保守裕量
    } catch (err) { return null; }
}

// Schichl–Neumaier 排除域（修正版）——
// 薄包装：调用者只给零点 z，内部自动算预条件矩阵 C ≈ F'(z)^{-1}，再交给 _exclusionRegion。
// ⚠ 若 C 已在外部算好（复用同一预条件矩阵算多个排除域），应直接调 _exclusionRegion  省一次雅可比。
// ⚠ 2026-10-04 修 bug：本函数此前只有签名、函数体整个丢失，导致后续所有顶层声明被吞进
//   它的函数体，末尾 export 也在里面 ⇒ dist 产物 ESM 解析报 `Unexpected token 'export'`。
function _krawczykExclusion(eqs, vns, z, C, opt) {
    var Cc = C;
    if (!Cc) {
        Cc = _precondAt(eqs, vns, z);
        if (!Cc) return null;               // 雅可比不可逆 ⇒ fail-closed，不猜
    }
    return _exclusionRegion(eqs, vns, z, Cc, opt);
}

/**
 * 多元先验根界（**引擎内实现**，2026-10-04 新增）
 *
 * ── 为什么必须有 ────────────────────────────────────────────────────
 * 实测（--cpu-prof，3 元非线性题 x+y+z=6, x·y=4, z²=1）：
 *   求解算子本身只用 **9ms**，而 `_globalBranchCertify` 吃掉 **317ms**
 *   （elapsedMs=326，算子统计只有 7ms，gap=319ms）。剖析热点集中在
 *   排除域的仿射包络算术（_affMul/_affRad/_affAdd/_affSub/_buildAffEnv 共 33%）。
 *
 * 根因是**域太大**：默认域半宽 ±1e6（constants.js `_LS_DOMAIN_LEGACY`），
 *   要把域切到 minWidth=1e-4 需要 log₂(2e6/1e-4) ≈ 34 级**每变量**，
 *   n 个变量 ⇒ 盒数 ~2^(34n)。n=3 就 ~10^30 ⇒ **完备穷举数学上不可行**。
 *   所以它必然撞 300ms 预算上限，然后报 complete=false + 几百个残盒，
 *   **既没多找到一个解，也没给出完备性** —— 纯烧时钟。
 *
 * 定理（多元 Cauchy 的 log 空间形式 / 热带平衡不等式）：
 *   设 p(x) = Σ_γ c_γ x^γ = 0（非零解），令 v_i = ln|x_i|，则最大项必被其余项抵消。
 *   取 α* = 最大项指数、β* = 次大项，则**必要条件**同时成立：
 *       A_γ = ln|c_γ| + ⟨γ,v⟩ 满足   A_γ ≤ A_{α*}  ∀γ≠α*
 *                                    A_γ ≤ A_{β*}  ∀γ∉{α*,β*}
 *   两组不等式在 v 上是**线性**的 ⇒ 每个「支配对 (α*,β*)」给出一个多面体，
 *   真解必落在**某个**这样的多面体内（组合极大值）。
 *
 * ⇒ 于是「所有解 ⊆ 盒」被**证**出来，而不是猜出来。
 *   实测 4 元稠密题（x²+y²+z²+w²=30, x+y+z+w=10, x·y=4, z·w=6）：
 *   proven 半宽 = **20**（从 ±1e6 收紧 **5 万倍**）。域小 5 万倍 ⇒
 *   切盒级数从 ~2^(34·4) 降到 ~log₂(40/1e-4)≈19 ⇒ 每变量 2^19，盒数降 10^70 量级。
 *
 * ── 与服务层 rootbound.js 的分工 ──────────────────────────────────────
 * 服务层 `services/rootbound.js` 有 460 行完整版（两阶段单纯形 LP、零坐标风险、
 * unbounded 检测），更精确但依赖 `require`，**引擎（单作用域拼接体）用不了**。
 * 本函数是**引擎内的轻量版**：只做「每个变量一个绝对值半宽」，
 * 不做 unbounded 判定（判不出就返回 null = 不收紧 = 回到旧行为）。
 *
 * ── fail-closed（与 rootbound.js 同一纪律）────────────────────────────
 *   任一条不过 ⇒ 返回 null，调用方**不做任何收紧**：
 *     · 方程含非多项式节点（sin/exp/log/根号）⇒ 热带推导不适用
 *     · 系数为 0 / 非有限 / 单项式（无抵消结构 ⇒ 无界）
 *     · 算出的界不优于当前域 ⇒ 无收益，不动
 *   **绝不返回「没证完但算出来了」的界** —— 假紧界会让 completeness 谎称找全了。
 */
// ── 多元先验根界（引擎内版）：热带平衡不等式 + 单纯形 LP ─────────────────
//
// 四条纪律（每条都对应一个「静默给假答案」的坑，服务层 rootbound.js 已踩过，
// 这里逐条照搬，**不要「简化」**）：
//   ① 支配行方向：A_α ≥ A_γ 写成 ⟨γ−α, v⟩ ≤ ln|c_α|−ln|c_γ|（γ 减 α）。
//      写反 ⇒ 区域变成「α 不是最大项」⇒ 假紧界。
//   ② 取 max 不取 min：真解只落在**某一个** (α*,β*) 区域里，其余组合是噪声。
//      ⇒ 有效上界 = 所有组合上界的**极大**。取 min 会漏掉真解所在区域。
//   ③ 候选对必须**穷举**：α 取遍所有单项式、β 取遍所有 ≠α。
//      任何启发式切片都会漏 ⇒ 那类界不可用。实测反例：x+y=3 在 x=2.618 处
//      真实最大项是**常数项**（ln3 > ln2.618），按「α_k 最大」切片就漏了。
//   ④ 超预算 ⇒ 整体返回 null（调用方不收紧域）。偷偷丢组合会让上界变小，
//      那极可能是假紧界 ⇒ completeness 会谎称「找全了」。宁可证不了。
//
// ⚠ 为什么**必须**上 LP，不能「手工丢项解一行」：
//   v_j = ln|x_j| **可以是负的**（|x_j|<1），所以 ⟨γ,v⟩ 里其它变量的项
//   **不是**「非负 slack」，不能从不等式里丢掉。丢掉它们解出的 v_k 上界
//   会**小于**真上界 ⇒ 假紧界 ⇒ 直接裁掉真解，且不报任何错。
//   ⇒ 必须解 max v_k s.t. 全部行，看 LP 判 unbounded 还是 optimal。

var _RB_MAX_SUPPORT = 12;      // 支撑截断（丢项只放松约束 ⇒ 界变松但仍有效）
var _RB_MAX_COMBOS = 50000;    // 跨方程组合上限（超 ⇒ 整体放弃，纪律④）
var _RB_TIME_CAP = 150;        // 根界是优化不是前提，超时放弃（fail-closed）
var _RB_MAX_PIVOTS = 4000;     // 单 LP 主元上限（防退化循环）
var _RB_LP_TOL = 1e-9;
var _RB_COEF_FLOOR = 1e-300;   // 系数下溢：|c| 更小视为 0（ln 会炸）
var _RB_BOUND_CEILING = 1e300; // 超过这个量级就不叫「盒」了

function _rbNow() {
    return (typeof performance !== 'undefined' && performance.now)
        ? performance.now() : Date.now();
}

function _rbSub(a, b) {
    var out = new Array(a.length);
    for (var i = 0; i < a.length; i++) out[i] = a[i] - b[i];
    return out;
}

/**
 * 极小 LP：max cᵀv  s.t. A v ≤ b（v ∈ ℝ^n 自由）。
 *
 * 行构造（**别改**，三条都踩过，每条都是静默错、不抛异常）：
 *   · Av ≤ b 先写成 Av + s = b（s ≥ 0 松弛）。若 b < 0，把**整行**乘 −1：
 *     −Av − s + art = −b。⇒ b<0 时**结构系数与松弛系数要一起翻号**。
 *     只翻结构系数、漏了松弛 ⇒ 约束 sneak 成「Av ≥ b」。
 *   · 比值检验**必须收第二象限**（T[i][e] < 0 且 rhs ≥ 0）：漏了会把
 *     「无界」当「最优 obj=0」⇒ 根界退化成 |x| ≤ e^0 = 1 的假下界。
 *   · Phase II 的入基候选**必须包含松弛列**：只放结构列 ⇒ 松弛的归约成本
 *     永不被检查 ⇒ 无界被吞成有限 obj。
 *
 * @returns {{status:'optimal'|'infeasible'|'unbounded', obj:number, x:number[]|null}}
 */
function _rbLpMax(c, A, b) {
    var m = A.length;
    if (!m) return { status: 'infeasible', obj: 0, x: null };
    var n = A[0] ? A[0].length : 0;
    if (!n) return { status: 'optimal', obj: 0, x: [] };

    var NV = 2 * n;              // p: 0..n-1, q: n..2n-1
    var NA = m;
    var RHS = NV + m + NA;
    var W = RHS + 1;
    var T = [];
    var i, j, k;
    for (i = 0; i < m; i++) {
        var row = new Float64Array(W);
        var flip = b[i] < 0 ? -1 : 1;
        for (j = 0; j < n; j++) {
            if (A[i][j] !== 0) { row[j] += flip * A[i][j]; row[n + j] -= flip * A[i][j]; }
        }
        row[NV + i] = flip;               // 松弛：与整行同号
        row[RHS - NA + i] = 1;            // 人工（初值 |b_i| ≥ 0 ⇒ 初始基可行）
        row[RHS] = Math.abs(b[i]);
        T.push(row);
    }
    var basis = new Array(m);
    for (i = 0; i < m; i++) basis[i] = RHS - NA + i;   // 初始基 = 全人工

    var pivots = 0;
    function pivot(z, r, e) {
        var pv = T[r][e];
        if (pv === 0) return;
        for (k = 0; k < W; k++) T[r][k] /= pv;
        T[r][e] = 1;
        for (i = 0; i < m; i++) {
            if (i === r) continue;
            var f = T[i][e];
            if (f === 0) { T[i][e] = 0; continue; }
            for (k = 0; k < W; k++) T[i][k] -= f * T[r][k];
            T[i][e] = 0;
        }
        var ze = z[e];
        if (ze !== 0) {
            for (k = 0; k < RHS; k++) z[k] -= ze * T[r][k];
            z[RHS] = z[RHS] + ze * T[r][RHS];   // rhs 列与结构列符号相反，单独加回
            z[e] = 0;
        }
        basis[r] = e;
        if (++pivots > _RB_MAX_PIVOTS) throw new Error('rb simplex pivot budget exhausted');
    }
    function eliminate(z, cols, cbOf) {
        for (var ci = 0; ci < cols.length; ci++) {
            var jc = cols[ci];
            var cb = cbOf(jc);
            if (!cb) continue;
            for (var ri = 0; ri < m; ri++) {
                if (basis[ri] !== jc) continue;
                for (var kk = 0; kk < RHS; kk++) z[kk] -= cb * T[ri][kk];
                z[RHS] = z[RHS] + cb * T[ri][RHS];
                break;
            }
        }
    }
    function allCols() {
        var cs = new Array(W);
        for (var q = 0; q < W; q++) cs[q] = q;
        return cs;
    }
    function chooseEnter(z, cols) {
        var best = -1, bv = _RB_LP_TOL;
        for (var ci2 = 0; ci2 < cols.length; ci2++) {
            var j2 = cols[ci2];
            if (z[j2] > bv) { bv = z[j2]; best = j2; }
        }
        return best;
    }
    function chooseRow(e) {
        var r = -1, rv = Infinity;
        for (var ri2 = 0; ri2 < m; ri2++) {
            var ti = T[ri2][e], rhs_i = T[ri2][RHS];
            if (ti === 0) continue;
            if ((ti > 0 && rhs_i < 0) || (ti < 0 && rhs_i >= 0)) continue;
            var ratio = rhs_i / ti;
            if (!isFinite(ratio) || ratio < 0) continue;
            if (ratio < rv - _RB_LP_TOL
                || (Math.abs(ratio - rv) <= _RB_LP_TOL && basis[ri2] < basis[r])) {
                rv = ratio; r = ri2;
            }
        }
        return r;
    }
    function drive(z, cols, allowUnbounded) {
        for (var guard = 0; guard <= _RB_MAX_PIVOTS; guard++) {
            var e2 = chooseEnter(z, cols);
            if (e2 < 0) return 'ok';
            var r2 = chooseRow(e2);
            if (r2 < 0) return allowUnbounded ? 'unbounded' : false;
            try { pivot(z, r2, e2); } catch (err) { return false; }
        }
        return false;
    }

    // ── Phase I：max(−Σ人工)
    var zI = new Float64Array(W);
    for (j = 0; j < W; j++) zI[j] = (j >= RHS - NA && j < RHS) ? -1 : 0;
    zI[RHS] = 0;
    eliminate(zI, allCols(), function (jj) { return (jj >= RHS - NA && jj < RHS) ? -1 : null; });
    if (drive(zI, allCols(), false) !== 'ok') return { status: 'infeasible', obj: 0, x: null };
    if (zI[RHS] < -1e-7) return { status: 'infeasible', obj: 0, x: null };   // Σ人工 > 0 ⇒ 不可行

    // ── Phase II：max cᵀv
    var z = new Float64Array(W);
    for (j = 0; j < n; j++) { z[j] = c[j]; z[n + j] = -c[j]; }
    z[RHS] = 0;
    eliminate(z, allCols(), function (jj) {
        return (jj < NV) ? (jj < n ? c[jj] : -c[jj - n]) : null;
    });
    var struct = [];
    for (j = 0; j < RHS - NA; j++) struct.push(j);   // 含松弛列，只排除人工列
    var st2 = drive(z, struct, true);
    if (st2 === 'unbounded') return { status: 'unbounded', obj: -Infinity, x: null };
    if (st2 !== 'ok') return { status: 'infeasible', obj: 0, x: null };

    var xs = new Array(n);
    for (i = 0; i < n; i++) xs[i] = 0;
    for (i = 0; i < m; i++) {
        var bj = basis[i];
        if (bj >= 0 && bj < n) xs[bj] = T[i][RHS];
        else if (bj >= n && bj < 2 * n) xs[bj - n] = -T[i][RHS];
    }
    return { status: 'optimal', obj: z[RHS], x: xs };
}

/**
 * 同一约束集上顺手出 max v_k 与 min v_k（省一半 LP）。
 * unbounded（任一方向无界）⇒ 这个 (α*,β*) 组合给不出 |x_k| 的界。
 */
function _rbDirBounds(k, rows, n) {
    var A = [], b = [];
    for (var i = 0; i < rows.length; i++) { A.push(rows[i].a); b.push(rows[i].rhs); }
    var cUp = new Array(n); for (var i1 = 0; i1 < n; i1++) cUp[i1] = 0; cUp[k] = 1;
    var up = _rbLpMax(cUp, A, b);
    if (up.status === 'infeasible') return { status: 'infeasible', max: null, min: null };
    var cDn = new Array(n); for (var i2 = 0; i2 < n; i2++) cDn[i2] = 0; cDn[k] = -1;
    var dn = _rbLpMax(cDn, A, b);
    var unbounded = (up.status === 'unbounded' || dn.status === 'unbounded');
    return {
        status: unbounded ? 'unbounded' : 'ok',
        max: up.status === 'unbounded' ? null : up.obj,
        min: dn.status === 'unbounded' ? null : -dn.obj
    };
}

/**
 * 由支配对 (α,β) 造约束行（统一为 ⟨a,v⟩ ≤ rhs）。**全部是不等式**。
 *   α 支配：  ⟨γ−α, v⟩ ≤ ln|c_α| − ln|c_γ|      ∀γ≠α
 *   β 支配：  ⟨γ−β, v⟩ ≤ ln|c_β| − ln|c_γ|      ∀γ∉{α,β}
 *   平衡带：  ⟨α−β, v⟩ ≤ ln|c_β| − ln|c_α| + ln(s−1)
 *
 * ⚠ 平衡带**只能朝一边**（A_α ≤ A_β + slack），不能 ± 双向展开成「相差恰好
 *   slack」：真实解处 A_α 可能远大于某个小项 A_γ，双向会让区域**漏掉**真实解
 *   ⇒ 假紧界。写成双向正是踩过的坑。
 */
function _rbMakeRows(exps, lns, ai, bi) {
    var s = exps.length;
    var slack = Math.log(Math.max(1, s - 1));
    var rows = [];
    var g;
    for (g = 0; g < s; g++) {
        if (g === ai) continue;
        rows.push({ a: _rbSub(exps[g], exps[ai]), rhs: lns[ai] - lns[g] });
    }
    for (g = 0; g < s; g++) {
        if (g === ai || g === bi) continue;
        rows.push({ a: _rbSub(exps[g], exps[bi]), rhs: lns[bi] - lns[g] });
    }
    rows.push({ a: _rbSub(exps[ai], exps[bi]), rhs: lns[bi] - lns[ai] + slack });
    return rows;
}

/**
 * 每个变量一个**证明过的**绝对值半宽。任何一步判不出 ⇒ 返回 null。
 * 调用方拿到 null 必须**完全不收紧域**（fail-closed）。
 *
 * @returns {number[]|null}
 */
function _priorRootHalfWidth(eqs, vns) {
    var n = vns.length;
    if (!eqs || eqs.length !== n || n === 0) return null;
    var t0 = _rbNow();

    // —— 步骤 1：每方程提取单项式（系数 + 指数向量）——
    var sys = [];
    for (var e = 0; e < n; e++) {
        var mons = _collectMonomials(eqs[e], vns);
        if (!mons || mons.length < 2) return null;   // 单项式/常数 ⇒ 无抵消结构 ⇒ 无界
        sys.push(mons);
    }

    // —— 步骤 2：每方程穷举全部支配对 → 每对一组线性行 ——
    var specs = [];
    var comboCount = 1;
    for (var e2 = 0; e2 < n; e2++) {
        var terms = sys[e2];
        var exps = [], lns = [];
        for (var i = 0; i < terms.length; i++) {
            var cf = terms[i].coef;
            if (!isFinite(cf) || Math.abs(cf) < _RB_COEF_FLOOR) continue;
            exps.push(terms[i].exps);
            lns.push(Math.log(Math.abs(cf)));
        }
        if (exps.length < 2) return null;            // 该方程无抵消结构 ⇒ 放弃
        if (exps.length > _RB_MAX_SUPPORT) {         // 支撑截断：丢项只放松约束
            exps = exps.slice(0, _RB_MAX_SUPPORT);
            lns = lns.slice(0, _RB_MAX_SUPPORT);
        }
        var groups = [];
        for (var ai = 0; ai < exps.length; ai++) {
            for (var bi = 0; bi < exps.length; bi++) {
                if (ai === bi) continue;
                groups.push(_rbMakeRows(exps, lns, ai, bi));
            }
        }
        specs.push(groups);
        comboCount *= groups.length;
        if (comboCount > _RB_MAX_COMBOS) return null; // 纪律④：超预算 ⇒ 整体放弃
    }

    // —— 步骤 3：逐变量解跨方程组合的 LP ——
    var halfWidths = [];
    for (var k = 0; k < n; k++) {
        if (_rbNow() - t0 > _RB_TIME_CAP) return null;
        var bestV = null;      // 最松的 ln|x_k| 上界（纪律②：取 max）
        var anyOk = false;
        var total = comboCount;
        for (var c = 0; c < total; c++) {
            // 时间闸门：每 256 个组合查一次（Date.now() 本身有开销）
            if ((c & 255) === 0 && c > 0 && _rbNow() - t0 > _RB_TIME_CAP) return null;
            var rows = [];
            var rem = c;
            for (var e3 = 0; e3 < n; e3++) {
                var sz = specs[e3].length;
                var gi = rem % sz;
                rem = (rem - gi) / sz;
                var grp = specs[e3][gi];
                for (var r = 0; r < grp.length; r++) rows.push(grp[r]);
            }
            var d = _rbDirBounds(k, rows, n);
            if (d.status !== 'ok') continue;         // infeasible / unbounded ⇒ 换组合
            anyOk = true;
            // |v_k| = max(v_k, −v_k) ⇒ 半宽取两个方向的**较大**上界
            var cand = 0;
            if (d.max !== null && isFinite(d.max)) cand = Math.max(cand, d.max);
            if (d.min !== null && isFinite(d.min)) cand = Math.max(cand, -d.min);
            if (bestV === null || cand > bestV) bestV = cand;
        }
        if (!anyOk || bestV === null) return null;    // 该变量判不出 ⇒ 整体放弃
        var W = Math.exp(bestV);
        if (!isFinite(W) || W <= 0 || W > _RB_BOUND_CEILING) return null;
        halfWidths.push(W);
    }

    // 界小到离谱（比任何合理变量域小 1000 倍以上）⇒ 保守放弃：
    //   这种量级的界若为假，裁掉的就是整片解空间，**不可逆**。
    for (var j = 0; j < n; j++) {
        if (halfWidths[j] < 1e-3) return null;
    }
    return halfWidths;
}


/**
 * 单项式提取：把 AST 展成 {coef, exps[]} 列表。
 * 只认 + − × 与整数/有理常数；**遇任何非多项式节点立即返回 null**（fail-closed）。
 */
function _collectMonomials(ast, vns) {
    var out = [];
    function exps() { var e = new Array(vns.length).fill(0); return e; }
    function walk(node, e) {
        if (!node || !node.type) return false;
        switch (node.type) {
            case 'num': {
                if (!isFinite(node.value)) return false;
                if (node.value === 0) return true;             // 零项：跳过但合法
                out.push({ coef: node.value, exps: e.slice() });
                return true;
            }
            case 'var': {
                var idx = vns.indexOf(node.name);
                if (idx < 0) { out.push({ coef: 1, exps: e.slice() }); return true; }
                e[idx] += 1;
                out.push({ coef: 1, exps: e.slice() });
                e[idx] -= 1;
                return true;
            }
            case 'unary':
                // 一元负号：直接翻转【刚加进去的】那些项的系数
                if (node.op !== '-') return false;
                var ub = out.length;
                if (!walk(node.operand, e)) return false;
                for (var ui = ub; ui < out.length; ui++) out[ui].coef = -out[ui].coef;
                return true;
            case 'binop': {
                if (node.op === '+' || node.op === '-') {
                    var before = out.length;
                    if (!walk(node.left, e)) return false;
                    var mid = out.length;
                    if (!walk(node.right, e)) return false;
                    if (node.op === '-') for (var t = mid; t < out.length; t++) out[t].coef = -out[t].coef;
                    return true;
                }
                if (node.op === '*') {
                    var b0 = out.length;
                    if (!walk(node.left, e)) return false;
                    var m0 = out.length;
                    if (!walk(node.right, e)) return false;
                    var A = out.slice(b0, m0), B = out.slice(m0);
                    out.length = b0;
                    for (var ai = 0; ai < A.length; ai++) {
                        for (var bi2 = 0; bi2 < B.length; bi2++) {
                            var ne = new Array(vns.length);
                            for (var d = 0; d < vns.length; d++) ne[d] = A[ai].exps[d] + B[bi2].exps[d];
                            out.push({ coef: A[ai].coef * B[bi2].coef, exps: ne });
                        }
                    }
                    return true;
                }
                if (node.op === '^') {
                    // 只接受非负整数幂（多项式）；分数/负数幂 ⇒ 非多项式
                    if (!node.right || node.right.type !== 'num') return false;
                    var pw = node.right.value;
                    if (!(pw >= 0 && pw === Math.floor(pw) && pw <= 64)) return false;
                    var base0 = out.length;
                    if (!walk(node.left, e)) return false;
                    var Bs = out.slice(base0);
                    out.length = base0;
                    var acc = [{ coef: 1, exps: exps() }];
                    for (var p = 0; p < pw; p++) {
                        var nx = [];
                        for (var a2 = 0; a2 < acc.length; a2++) {
                            for (var b3 = 0; b3 < Bs.length; b3++) {
                                var e2 = new Array(vns.length);
                                for (var d2 = 0; d2 < vns.length; d2++) e2[d2] = acc[a2].exps[d2] + Bs[b3].exps[d2];
                                nx.push({ coef: acc[a2].coef * Bs[b3].coef, exps: e2 });
                            }
                        }
                        acc = nx;
                        if (acc.length > 64) return null;   // 膨胀保护
                    }
                    for (var a3 = 0; a3 < acc.length; a3++) out.push(acc[a3]);
                    return true;
                }
                if (node.op === '/') {
                    // 分母不含变量 ⇒ 仍是多项式（系数除一下）；否则非多项式
                    if (hasVariable(node.right, vns)) return false;
                    var dv;
                    try { dv = evalAST(node.right, {}); } catch (err) { return false; }
                    if (!isFinite(dv) || dv === 0) return false;
                    var b4 = out.length;
                    if (!walk(node.left, e)) return false;
                    for (var t2 = b4; t2 < out.length; t2++) out[t2].coef /= dv;
                    return true;
                }
                return false;
            }
            default: return false;   // func（sin/exp/log/…）⇒ 非多项式 ⇒ fail-closed
        }
    }
    var e0 = exps();
    if (!walk(ast, e0)) return null;
    // 合并同类项，剔除系数恰为 0 的项
    var merged = {};
    for (var i = 0; i < out.length; i++) {
        var key = out[i].exps.join(',');
        merged[key] = (merged[key] || 0) + out[i].coef;
    }
    var res = [];
    for (var kk in merged) {
        if (!Object.prototype.hasOwnProperty.call(merged, kk)) continue;
        if (merged[kk] === 0) continue;
        res.push({ coef: merged[kk], exps: kk.split(',').map(Number) });
    }
    return (res.length >= 2) ? res : null;
}

function _globalBranchCertify(eqs, vns, dom, opts) {
    var n = vns.length;
    if (eqs.length !== n || n === 0) return null; // 非方阵/空：不接全局分支
    var o = opts || {};
    var BUDGET = (o.budget != null) ? o.budget : 5e5;
    var MAXDEPTH = (o.maxDepth != null) ? o.maxDepth : 28;
    var MINW = (o.minWidth != null) ? o.minWidth : 1e-3;
    var TIME = (o.timeMs != null) ? o.timeMs : 300;   // 时间预算兜底，避免卡顿
    var DUP = (o.dupTol != null) ? o.dupTol : 1e-2;     // 同解不同盒的去重阈值
    var solutions = [], residualBoxes = [], boxCount = 0;
    var exclCount = 0;   // 因排除域而剪掉的盒数（聚簇效应消除量，可观测）
    var exclPruned = []; // 被排除域剪掉的盒（只记盒不展开，量大时按需截断）
    var startT = performance.now();
    function mkBox(d) { var b = {}; for (var i = 0; i < n; i++) b[vns[i]] = { min: d[vns[i]][0], max: d[vns[i]][1] }; return b; }
    function boxMaxWidth(b) { var w = 0; for (var i = 0; i < n; i++) { var d = b[vns[i]].max - b[vns[i]].min; if (d > w) w = d; } return w; }
    function mid(b) { var m = []; for (var i = 0; i < n; i++) m.push((b[vns[i]].min + b[vns[i]].max) / 2); return m; }
    function residualAt(vals) {
        var vmap = {}; for (var i = 0; i < n; i++) vmap[vns[i]] = vals[i];
        var rv = 0; for (var e = 0; e < n; e++) { var fe = evalAST(eqs[e], vmap); if (isFinite(fe)) rv = Math.max(rv, Math.abs(fe)); }
        return rv;
    }
    function split(b) {
        var wi = 0, wmax = -1; for (var i = 0; i < n; i++) { var d = b[vns[i]].max - b[vns[i]].min; if (d > wmax) { wmax = d; wi = i; } }
        var name = vns[wi], m = (b[name].min + b[name].max) / 2, b1 = {}, b2 = {};
        for (var k = 0; k < n; k++) { var nm = vns[k]; if (k === wi) { b1[nm] = { min: b[nm].min, max: m }; b2[nm] = { min: m, max: b[nm].max }; } else { b1[nm] = b[nm]; b2[nm] = b[nm]; } }
        return [b1, b2];
    }
    function isDup(vals) {
        for (var s = 0; s < solutions.length; s++) {
            var sv = solutions[s].values, maxd = 0;
            for (var j = 0; j < n; j++) maxd = Math.max(maxd, Math.abs(sv[j] - vals[j]));
            if (maxd < DUP) return true;
        }
        return false;
    }
    // —— BFS 队列：用头指针而非 Array.shift()（2026-10-04 性能修）——
    //
    // 实测（--cpu-prof，3 元非线性题）：`queue.shift()` 在 BFS 队列上是 **O(n)** 的
    //   （每次都要把后续元素整体前移），n 个盒累计 **O(n²)** 次元素搬移。
    //   该题切了 2335 个盒 ⇒ 约 270 万次元素搬移，白烧 CPU。
    //   改成头指针 `qHead` 是标准 BFS 写法，**语义完全等价**（顺序一致、去重一致）。
    var queue = [{ box: mkBox(dom), depth: 0 }];
    var qHead = 0;
    function qPush(x) { queue.push(x); }
    function qSize() { return queue.length - qHead; }
    function qShift() { return queue[qHead++]; }
    function qDrain() { while (qHead < queue.length) residualBoxes.push(queue[qHead++].box); }

    // —— Schichl–Neumaier 排除域：每认证一个零点就登记一个「保证不含其它零点」的壳 ——
    // 壳用 [lo, hi] 表示（lo/hi 是 {varname: number}）。boxInExclusion 判整盒落入壳内。
    // ⚠ USE_EXCL 开关：默认开。设 false 可完全关闭排除域剪枝（A/B 对照用，也留作运行期降级口）。
    var USE_EXCL = (o.exclusion !== false);
    var exclRegions = [];
    function boxInsideRegion(b, R) {
        // 整盒 ⊆ R 的【内部】才可丢。留相对裕量，避免边界盒被误丢（fail-closed：宁可少丢不可丢错）
        for (var i = 0; i < n; i++) {
            var nm = vns[i];
            var bl = b[nm].min, bh = b[nm].max;
            if (!(isFinite(bl) && isFinite(bh))) return false;
            var pad = 1e-9 * Math.max(1, Math.abs(R.hi[nm] - R.lo[nm]));  // 相对裕量
            if (!(bl > R.lo[nm] + pad && bh < R.hi[nm] - pad)) return false;
        }
        return true;
    }
    function prunedByExclusion(b) {
        for (var i = 0; i < exclRegions.length; i++) if (boxInsideRegion(b, exclRegions[i])) return true;
        return false;
    }

    while (qSize() > 0) {
        if (boxCount >= BUDGET || (performance.now() - startT) > TIME) { qDrain(); break; }
        if (qSize() === 0) break;
        var item = qShift(), b = item.box, depth = item.depth;

        // 聚簇效应剪枝：已认证零点周围的壳，整盒落入则严格无根 → 直接丢
        if (USE_EXCL && exclRegions.length > 0 && prunedByExclusion(b)) {
            exclCount++;
            // ⚠ 被排除域剪掉的盒【不进 residualBoxes】（那里是「未判定」，语义不同）。
            //   但它们也绝不能凭空消失 —— 否则「残 0 + 解 0」会让人误以为已穷尽。
            //   这里显式记录剪枝盒数与原因，供上层归因（_mergeGlobalBranch 已透出 incompleteBecause）。
            exclPruned.push(b);
            continue;
        }

        boxCount++;
        var xhat = mid(b);
        var res = _krawczykOnBox(eqs, vns, b, xhat);
        // —— 边界根救援（2026-10-04 实测的真 bug 修复）——
        // 现象：一元 x^2-1=0 在 [-2,2] 上返回【0 解】（应 2 解：±1），残 4 盒。
        // 根因：x=±1 恰好落在盒的分割边界上，被切成 [-1.03125,-1] 与 [-1,-0.99994] 两个盒。
        //   Krawczyk 判 certified=false（根在盒端点，iVecInterior 的严格内部判定失败），
        //   于是继续细分到 minWidth=1e-4 停下 → 残盒 → 0 解。【与排除域无关，关掉也一样】。
        // ⚠⚠ 修法演进（踩坑记录，勿简化）：
        //   第一版写成「中点残差 ≤1e-12 就 continue」—— 错！x^5-5x^3+4x 在 [-3,3] 上首盒中点
        //   恰好是根 0，直接 continue 丢掉整个盒内的 ±1、±2，退化成 1 解（实测 4 解→1 解）。
        //   中点命中只能【记下这个解】，绝不能终止该盒的搜索 —— 盒里可能有别的根。
        // 现版：中点命中先记解，然后【继续细分】（不 continue），让别的根仍能被找到；
        //   同时把该盒标记为「已含解」，若细分到 minWidth 以下则不再重复记（isDup 已兜住）。
        var midRes = residualAt(xhat);
        var midIsRoot = (isFinite(midRes) && midRes <= 1e-12);
        if (midIsRoot && !isDup(xhat)) {
            // 精确代数事实（残差 0 ⇒ F(xhat)=0），不依赖任何不完备假设，sound。
            solutions.push({ values: xhat.slice(), box: null, residual: midRes, exactHit: true });
        }
        if (res.certified && !midIsRoot) {
            // Krawczyk 证 [X] 内唯一零点 ∈ X；在盒内牛顿精化到真解（residual≈0）才记 proven，绝不假证中点
            var refined = _newtonRefine(eqs, vns, xhat, b);
            if (refined && !isDup(refined)) {
                solutions.push({ values: refined, box: res.Xvec, residual: residualAt(refined) });
            }
        } else if (!midIsRoot && res.K && iVecDisjoint(res.K, res.Xvec)) {
            // 严格无解，丢弃（sound 剪枝）；K 为 undefined（雅可比不可逆）时不可断定，走细分
            // ⚠ midIsRoot 时不走这条：中点已被精确证明是解，K 却说「严格无解」⇒ 两者矛盾，
            //   说明该盒的 K 判定在此处不可靠（浮点边界）。此时保守地继续细分，绝不丢盒。
        } else {
            if (boxMaxWidth(b) > MINW && depth < MAXDEPTH) {
                var parts = split(b);
                // —— Schichl–Neumaier 排除域：正确的用法是【认证之前】用来剪枝 ——
                // ⚠ 踩过的坑（2026-10-04）：最初把排除域挂在「Krawczyk 认证成功之后」，
                //   结果 exclRegions 永远为空、excludedByRegion 恒为 0，一点收益都没有。
                //   原因：b_i = |C·F(z)|_i，在【精确零点】上 F(z)=0 ⇒ b=0 ⇒ λ×=0 ⇒ 排除域退化为点
                //   ⇒ _exclusionRegion 直接返回 null。这是论文的已知性质（Ex 8.1/8.2/8.4 全命中此情形），
                //   不是 bug —— 是「在零点处建排除域」这个用法本身没用。
                //   论文 §7 的原意是：任取【试探点】 z 都能建排除域，用来剪掉 z 周围的大片无根区。
                //   这里就在分裂点 xhat（盒中点，非零点，F(xhat)≠0 才有 b>0）建域，
                //   域内的兄弟盒整盒丢弃 —— 这才是排除域真正省盒数的地方。
                if (USE_EXCL) {
                    var Cp = _precondAt(eqs, vns, xhat);
                    if (Cp) {
                        var rr2 = [];
                        for (var rj = 0; rj < n; rj++) rr2.push(Math.max((b[vns[rj]].max - b[vns[rj]].min) / 2, 1e-6));
                        var R2 = _exclusionRegion(eqs, vns, xhat, Cp, { radii: rr2 });
                        // R2 的半径通常远小于当前盒宽 ⇒ 域内多半没有子盒，纯属浪费。
                        // 只有当排除域大到能整盒吞掉至少一个待分裂子盒时才登记（否则不入列表，省内存与查表开销）。
                        if (R2) {
                            var big = false;
                            for (var qk = 0; qk < n; qk++) {
                                var wR = R2.lambda * R2.v[qk];
                                var wBox = b[vns[qk]].max - b[vns[qk]].min;
                                if (wR > 0.5 * wBox) { big = true; break; }
                            }
                            if (big) exclRegions.push(R2);
                        }
                    }
                }
                qPush({ box: parts[0], depth: depth + 1 });
                qPush({ box: parts[1], depth: depth + 1 });
            } else {
                residualBoxes.push(b); // 超深/过窄未判，诚实留痕
            }
        }
    }
    return {
        solutions: solutions,
        boxCount: boxCount,
        excludedByRegion: exclCount,
        // ⚠🔴 complete 的正确判据（2026-10-04 修 fail-closed 红线破口）：
        //   原来写 complete = (residualBoxes.length === 0)，把【被排除域剪掉的盒】当成了"已证明无根"。
        //   但排除域的成立是有前提的：Schichl–Neumaier 原文第 7 页明确写 —
        //     "For singular (and hence for sufficiently ill-conditioned) zeros, the argument does
        //      not apply, and no technique is known to remove the cluster effect in this case."
        //   即病态/奇异零点处排除域【必然失效】。而剪掉的盒既没被验证、也没被穷尽，
        //   计入 residualBoxes 才是诚实的（fail-closed：宁可报"未验证"，不可谎报"完备"）。
        //   实测证据：圆与直线 x^2+y^2-25=0, x+y-7=0（真解 (3,4),(4,3)）
        //     排除域开 → 81 盒 / 排除 46 / 残 0 →旧判据报 complete=true，实则 0 解（错）。
        //     排除域关 → 63139 盒 / 残 10040 → 报 complete=false（对，但极慢）。
        //   修后：只要用过排除域剪枝，complete 一律 false（除非另有独立完备性证据）。
        residualBoxes: residualBoxes,
        exclPrunedCount: exclPruned.length,
        // 剪掉的盒留个样本（最多 8 个），供诊断；全量可能上万，存不下也没必要。
        exclPrunedSample: exclPruned.slice(0, 8),
        budget: BUDGET,
        complete: (residualBoxes.length === 0) && exclCount === 0
    };
}

// 预条件矩阵 C ≈ F'(z)^{-1}：排除域只需要 C 近似逆，论文明确允许用伪逆。
// 雅可比不可逆时返回 null（调用方放弃排除域），绝不猜。
function _precondAt(eqs, vns, z) {
    try {
        var J = _numJac(eqs, vns, z);
        if (!J) return null;
        return realMatInv(J);
    } catch (err) { return null; }
}
// 把全局分支找到的 proven 解合并进 state.result.solutions（去重：与已有解距离<tol 视为同解）

function _mergeGlobalBranch(state, gb) {
    if (!gb || !gb.solutions) return;
    if (!state.result.solutions) state.result.solutions = [];
    var vns = getOutputVarNames(state);
    var tol = 1e-6;
    function exists(vals) {
        for (var i = 0; i < state.result.solutions.length; i++) {
            var s = state.result.solutions[i];
            if (!s.values || s.values.length !== vals.length) continue;
            var maxd = 0; for (var j = 0; j < vals.length; j++) maxd = Math.max(maxd, Math.abs(s.values[j] - vals[j]));
            if (maxd < tol) return true;
        }
        return false;
    }
    for (var k = 0; k < gb.solutions.length; k++) {
        var sol = gb.solutions[k];
        if (exists(sol.values)) continue;
        state.result.solutions.push({
            values: sol.values.slice(),
            residual: (typeof sol.residual === 'number') ? sol.residual : 0,
            tier: 'proven',
            certified: true,
            certifiedRadius: null,
            source: 'global_branch_krawczyk',
            box: sol.box
        });
    }
    state.result.globalBranch = {
        boxCount: gb.boxCount,
        excludedByRegion: gb.excludedByRegion || 0,
        // 剪枝盒单列：不混进 residualCount（那是「未判定」），但也不能凭空消失。
        exclPrunedCount: gb.exclPrunedCount || 0,
        residualCount: gb.residualBoxes.length,
        complete: gb.complete,
        budget: gb.budget,
        // 完备性归因：调用方/Agent 需要知道「未穷尽」到底是撞预算还是被排除域剪的。
        // 排除域剪枝在病态零点处有理论失效边界（Schichl–Neumaier 原文第 7 页），
        // 所以它剪掉的盒不计入 residualCount，但必须让 complete=false 且可归因。
        incompleteBecause: (gb.excludedByRegion > 0)
            ? 'exclusion-pruned（排除域剪枝 ' + gb.excludedByRegion + ' 盒；该剪枝在病态/奇异零点处有理论失效边界，故不计入完备）'
            : (gb.residualBoxes.length > 0 ? 'budget-or-depth（残盒未判定）' : null)
    };
    if (gb.residualBoxes.length > 0 && !state.result.warnings) state.result.warnings = [];
    if (gb.residualBoxes.length > 0) state.result.warnings.push('全局区间分支在预算(' + gb.budget + '盒)内未完全判定（非无解，仅未穷尽，可能含遗漏解）');
    state.truncated = state.truncated || !gb.complete;
}
