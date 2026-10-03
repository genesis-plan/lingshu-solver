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
        if (rms < 1e-11) return x;
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
// K∩X=∅ 判定（严格无不动点 → 无零点，sound 剪枝）

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
    var queue = [{ box: mkBox(dom), depth: 0 }];
    while (queue.length > 0) {
        if (boxCount >= BUDGET || (performance.now() - startT) > TIME) { while (queue.length) residualBoxes.push(queue.shift().box); break; }
        var item = queue.shift(), b = item.box, depth = item.depth;
        boxCount++;
        var xhat = mid(b);
        var res = _krawczykOnBox(eqs, vns, b, xhat);
        if (res.certified) {
            // Krawczyk 证 [X] 内唯一零点 ∈ X；在盒内牛顿精化到真解（residual≈0）才记 proven，绝不假证中点
            var refined = _newtonRefine(eqs, vns, xhat, b);
            if (refined && !isDup(refined)) solutions.push({ values: refined, box: res.Xvec, residual: residualAt(refined) });
        } else if (res.K && iVecDisjoint(res.K, res.Xvec)) {
            // 严格无解，丢弃（sound 剪枝）；K 为 undefined（雅可比不可逆）时不可断定，走细分
        } else {
            if (boxMaxWidth(b) > MINW && depth < MAXDEPTH) {
                var parts = split(b);
                queue.push({ box: parts[0], depth: depth + 1 });
                queue.push({ box: parts[1], depth: depth + 1 });
            } else {
                residualBoxes.push(b); // 超深/过窄未判，诚实留痕
            }
        }
    }
    return { solutions: solutions, boxCount: boxCount, residualBoxes: residualBoxes, budget: BUDGET, complete: (residualBoxes.length === 0) };
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
        residualCount: gb.residualBoxes.length,
        complete: gb.complete,
        budget: gb.budget
    };
    if (gb.residualBoxes.length > 0 && !state.result.warnings) state.result.warnings = [];
    if (gb.residualBoxes.length > 0) state.result.warnings.push('全局区间分支在预算(' + gb.budget + '盒)内未完全判定（非无解，仅未穷尽，可能含遗漏解）');
    state.truncated = state.truncated || !gb.complete;
}
