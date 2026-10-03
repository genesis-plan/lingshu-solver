/* 模块 operators/geometry：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function suan35(state) {
    if (state.done) return;
    // 单变量/两变量已由更精确算子覆盖，跳过（与历史 p3LowDim 口径一致）
    if (state.varNames.length <= 2) return;
    if (state.skipOperators.manifoldReduction) return; // 复用原跳过标记，保持兼容

    var allEqs = state.originalEquations || state.equations;
    if (!allEqs || allEqs.length === 0) return;
    var allVars = getOutputVarNames(state);
    if (!allVars || allVars.length <= 2) return;

    // 1) 收集每个方程的“涉及变量集”，并按变量集分组（提取可投影的独立子系统）
    var eqVarSets = [];
    for (var ei = 0; ei < allEqs.length; ei++) {
        var vs = extractVariables(allEqs[ei]);
        if (vs && vs.length) eqVarSets.push({ eq: allEqs[ei], vars: vs });
    }

    // 2) 枚举“投影面” I：严格遍历 allVars 的所有真子集，大小 2..n-1。
    //    变量上限已锁死 6 维，故投影面总数 ≤ C(6,2)+C(6,3)+C(6,4)+C(6,5)=15+20+15+6=56，
    //    每个面只做一次轻量可行性判定（线性高斯相容 / 非线性 intervalEval），
    //    微秒级，无需贪心近似即可做到“全部投一遍”的严格完备。
    //    |I|=1 跳过（单变量子系统矛盾已被 suan7 覆盖，且巨域下区间包络恒含 0 无剪枝价值）；
    //    |I|=n 即全集不是真子集，跳过（那是全系统矛盾，由其他算子处理）。
    var candidates = [];
    var nVars = allVars.length;
    // 二进制枚举所有非空真子集，筛出大小∈[2, n-1]
    var totalMasks = 1 << nVars;
    for (var mask = 1; mask < totalMasks; mask++) {
        var pop = 0, bits = [];
        for (var b = 0; b < nVars; b++) {
            if (mask & (1 << b)) { pop++; bits.push(allVars[b]); }
        }
        if (pop < 2 || pop >= nVars) continue; // 真子集且 2≤|I|≤n-1
        candidates.push(bits);
    }
    if (candidates.length === 0) return;

    // 3) 对每个候选 I：抽出“变量全⊂I”的方程子集，在 I 上判定可行性
    function _subsystemFeasible(subEqs, I) {
        // 实际出现在子集里的变量
        var usedVars = {};
        for (var s = 0; s < subEqs.length; s++) {
            var vv = extractVariables(subEqs[s]);
            for (var t = 0; t < vv.length; t++) usedVars[vv[t]] = 1;
        }
        var used = Object.keys(usedVars);
        if (used.length === 0) return true; // 无变量（纯常数方程）交给其他算子

        // 取 I（used）在 D0 上的域，夹取到有限区间
        var box = {};
        var allFinite = true;
        for (var u = 0; u < used.length; u++) {
            var b = state.D0[used[u]];
            if (!b || !isFinite(b.min) || !isFinite(b.max)) { allFinite = false; break; }
            box[used[u]] = { min: b.min, max: b.max };
        }
        if (!allFinite) return true; // 域未初始化，放弃该候选（保守）

        // (a) 全线性 → 高斯相容判定（精确 sound）
        var allLinear = true;
        for (var q = 0; q < subEqs.length; q++) {
            if (!_isLinearAST(subEqs[q])) { allLinear = false; break; }
        }
        if (allLinear && subEqs.length >= 1) {
            return _linearSystemConsistent(subEqs, used);
        }

        // (b) 含非线性 → 区间包络矛盾检测：任一方程在 used 全域上的区间包络不含 0
        //     ⇒ 该子问题在 used 上无解（中值定理，sound）。注意：包络含 0 不证明有解，
        //     故仅在“不含 0”时返回 false（不可行）。
        for (var r = 0; r < subEqs.length; r++) {
            var iF = intervalEval(subEqs[r], box);
            if (iF && _ivExcludesZero(iF)) {
                return false; // 该方程在 used 全域上严格无根 ⇒ 子问题不可行 ⇒ 全局不可行
            }
        }
        return true; // 保守：无法证伪则假定可行
    }

    for (var ci = 0; ci < candidates.length; ci++) {
        var I = candidates[ci];
        // 抽“变量全⊂I”的方程
        var subEqs = [];
        for (var e = 0; e < eqVarSets.length; e++) {
            var ok = true;
            for (var v = 0; v < eqVarSets[e].vars.length; v++) {
                if (I.indexOf(eqVarSets[e].vars[v]) < 0) { ok = false; break; }
            }
            if (ok) subEqs.push(eqVarSets[e].eq);
        }
        if (subEqs.length < 1) continue;
        if (_subsystemFeasible(subEqs, I)) continue;
        // 命中：子问题在 I 上确证无解 ⇒ 由投影包含关系推出全局无解（sound）
        state.done = true;
        state.result = {
            solutions: [], error: "NO_SOLUTION",
            message: "投影反证剪枝：变量子集 {" + I.join(',') + "} 上的独立子系统在其实数域上严格无解（区间包络不含 0 / 线性不相容），由投影包含关系 π_I(S)=∅ ⇒ S=∅，整系统无实数解",
            executionPath: "投影反证剪枝(suan35)", timeMs: performance.now() - state.startTime,
            confidence: "high", varNames: state.varNames, resultType: 1,
            resultTypeName: "空结果", resultTypeDesc: "投影反证：子系统无解推出全局无解"
        };
        return;
    }
}


function suan36(state) {
    if (state.done) return;
    if (!state.varNames || state.varNames.length <= 1) { state.projectionHint = null; return; }

    var eqs = state.equations && state.equations.length ? state.equations : (state.originalEquations || []);
    var vars = state.varNames;
    if (eqs.length === 0 || vars.length === 0) { state.projectionHint = null; return; }

    // 样本点：D0 中点（夹取到有限域）；雅可比在该点估值
    var mid = {};
    for (var v = 0; v < vars.length; v++) {
        var b = state.D0[vars[v]];
        if (!b || !isFinite(b.min) || !isFinite(b.max)) { mid[vars[v]] = 0; }
        else mid[vars[v]] = (b.min + b.max) / 2;
    }
    function _f(eqAst, ctx) {
        var val; try { val = evalAST(eqAst, ctx); } catch (e) { val = NaN; }
        return isFinite(val) ? val : NaN;
    }
    // 数值雅可比：中心差分
    var h = 1e-6;
    var J = [];
    var computable = true;
    for (var i = 0; i < eqs.length && computable; i++) {
        var row = [];
        for (var j = 0; j < vars.length; j++) {
            var vp = vars[j];
            var ctxP = {}, ctxM = {};
            for (var kk = 0; kk < vars.length; kk++) { ctxP[vars[kk]] = mid[vars[kk]]; ctxM[vars[kk]] = mid[vars[kk]]; }
            ctxP[vp] = mid[vp] + h; ctxM[vp] = mid[vp] - h;
            var fp = _f(eqs[i], ctxP), fm = _f(eqs[i], ctxM);
            if (!isFinite(fp) || !isFinite(fm)) { computable = false; break; }
            row.push((fp - fm) / (2 * h));
        }
        if (computable) J.push(row);
    }
    if (!computable || J.length === 0) { state.projectionHint = null; return; }

    // 数值秩（高斯消元，阈值 1e-7）
    var rank = 0;
    var M = J.map(function (r) { return r.slice(); });
    var cols = vars.length;
    for (var col = 0; col < cols; col++) {
        var piv = -1;
        for (var rr = rank; rr < M.length; rr++) {
            if (Math.abs(M[rr][col]) > 1e-7) { piv = rr; break; }
        }
        if (piv < 0) continue;
        var tmp = M[rank]; M[rank] = M[piv]; M[piv] = tmp;
        for (var rr2 = 0; rr2 < M.length; rr2++) {
            if (rr2 !== rank && Math.abs(M[rr2][col]) > 1e-10) {
                var f = M[rr2][col] / M[rank][col];
                for (var cc = col; cc < cols; cc++) M[rr2][cc] -= f * M[rank][cc];
            }
        }
        rank++;
    }
    var dof = vars.length - rank;
    // 建议投影方向：优先固定 rank 个“被最多方程依赖”的变量（简单启发：按列绝对值和排序）
    var colSum = [];
    for (var c = 0; c < cols; c++) {
        var s = 0; for (var ri = 0; ri < M.length; ri++) s += Math.abs(J[ri][c]);
        colSum.push({ v: vars[c], s: s });
    }
    colSum.sort(function (x, y) { return y.s - x.s; });
    var suggested = colSum.slice(0, Math.max(1, rank)).map(function (o) { return o.v; });

    state.projectionHint = {
        rank: rank, dof: dof, samplePoint: mid,
        suggestedProjectionVars: suggested,
        note: "雅可比数值秩=" + rank + "，局部自由度=" + dof + "；建议投影到 {" + suggested.join(',') + "} 上"
    };
}


function suan37(state) {
    if (!state.manifoldInfo) {
        state.manifoldType = { type: 'unknown', dim: -1, strategy: 'newton', description: '无法检测流形' };
        return;
    }
    var rank = state.manifoldInfo.rank;
    var n = state.varNames.length;
    var effectiveDim = n - rank; // 解流形的维数（自由度）
    
    if (rank === 0) {
        return { type: 'discrete', dim: 0, effectiveDim: 0, strategy: 'extract_candidates',
            description: '0维离散点集 — 从代数边界候选提取直接读出' };
    }
    if (effectiveDim === 0) {
        return { type: 'discrete', dim: 0, effectiveDim: 0, strategy: 'extract_candidates',
            description: '0维离散点集（满秩约束） — 代数候选提取 + 直接读出' };
    }
    if (effectiveDim === 1) {
        return { type: 'curve', dim: 1, effectiveDim: 1, strategy: 'geodesic_tracking',
            description: '1维曲线流形 — 测地线跟踪遍历' };
    }
    if (effectiveDim <= 4) {
        return { type: 'surface', dim: effectiveDim, effectiveDim: effectiveDim, strategy: 'grid_sampling',
            description: effectiveDim + '维曲面流形 — 流形格点采样' };
    }
    // effectiveDim >= 5
    return { type: 'highdim', dim: effectiveDim, effectiveDim: effectiveDim, strategy: 'nullspace_reduction',
        description: effectiveDim + '维高维流形 — 零空间参数化降维' };
}


function suan38(state) {
    var n = state.varNames.length;
    const points = [];

    // 使用 D0 作为起始点生成依据
    function getStartValue(v, base) {
        if (state.D0 && state.D0[v]) {
            const b = state.D0[v];
            const min = b.min === -Infinity ? -1000000 : b.min;
            const max = b.max === Infinity ? 1000000 : b.max;
            if (base < min) return min;
            if (base > max) return max;
            return base;
        }
        return base;
    }

    points.push(state.varNames.map(v => getStartValue(v, 0)));
    points.push(state.varNames.map(v => getStartValue(v, 1)));
    points.push(state.varNames.map(v => getStartValue(v, -1)));
    points.push(state.varNames.map(v => getStartValue(v, 10)));
    points.push(state.varNames.map(v => getStartValue(v, -10)));

    // 混合符号点（多变量时覆盖不同象限）
    if (n >= 2) {
        points.push(state.varNames.map((v, i) => getStartValue(v, i % 2 === 0 ? 5 : -5)));
        points.push(state.varNames.map((v, i) => getStartValue(v, i % 2 === 0 ? -5 : 5)));
        points.push(state.varNames.map((v, i) => getStartValue(v, i % 2 === 0 ? 10 : -10)));
        points.push(state.varNames.map((v, i) => getStartValue(v, i % 2 === 0 ? -10 : 10)));
    }

    // 3个确定性网格点（基于 D0 区间）
    const gridFractions = [0.25, 0.5, 0.75];
    for (let r = 0; r < 3; r++) {
        const pt = [];
        for (let i = 0; i < n; i++) {
            const v = state.varNames[i];
            if (state.D0 && state.D0[v]) {
                const b = state.D0[v];
                const min = b.min === -Infinity ? -1000000 : b.min;
                const max = b.max === Infinity ? 1000000 : b.max;
                pt.push(min + gridFractions[r] * (max - min));
            } else {
                pt.push((r - 1) * 66);
            }
        }
        points.push(pt);
    }

    return points;
}


function suan39(state) {
    if (!state.manifoldInfo || !state.startPoints) return;
    if (state.manifoldInfo && state.manifoldInfo.hasRedundancy) {
        state.startPoints = projectToManifold(state.startPoints, state.manifoldInfo);
    }
}


function _suan56Project(eqs, vns, x0, dom, opts) {
    opts = opts || {};
    var maxIter = opts.maxIter || 60;
    var n = vns.length, m = eqs.length;
    if (!x0 || x0.length !== n || m === 0 || m >= n) return null;
    var x = x0.slice();

    // 残差与最大残差
    function maxRes(xx) {
        var vmap = {};
        for (var i = 0; i < n; i++) vmap[vns[i]] = xx[i];
        var mr = 0;
        for (var e = 0; e < m; e++) {
            var f;
            try { f = evalAST(eqs[e], vmap); } catch (err) { return Infinity; }
            if (f === null || !isFinite(f)) return Infinity;
            if (Math.abs(f) > mr) mr = Math.abs(f);
        }
        return mr;
    }

    var r0 = maxRes(x);
    if (!isFinite(r0)) return null;

    for (var it = 0; it < maxIter; it++) {
        if (maxRes(x) < 1e-12) return { values: x.slice(), residual: maxRes(x), iters: it, ok: true };

        // 雅可比（区间求导，失败退中心差分）
        var vmap0 = {};
        for (var i2 = 0; i2 < n; i2++) vmap0[vns[i2]] = x[i2];
        var pmap = {};
        for (var i3 = 0; i3 < n; i3++) pmap[vns[i3]] = { min: x[i3], max: x[i3] };

        var J = [];
        for (var a = 0; a < m; a++) {
            J.push([]);
            for (var b = 0; b < n; b++) {
                var dv = null;
                try {
                    var dast = _diffAST(eqs[a], vns[b]);
                    if (dast) dv = intervalEval(dast, pmap);
                } catch (e2) { dv = null; }
                if (dv && typeof dv === 'object' && isFinite(dv.min) && isFinite(dv.max)) {
                    J[a].push((dv.min + dv.max) / 2);
                } else {
                    var hstep = Math.max(Math.abs(x[b]), 1e-4) * 1e-7;
                    var vp = {}, vm = {};
                    for (var q = 0; q < n; q++) { vp[vns[q]] = x[q]; vm[vns[q]] = x[q]; }
                    vp[vns[b]] = x[b] + hstep; vm[vns[b]] = x[b] - hstep;
                    var fp2, fm2;
                    try { fp2 = evalAST(eqs[a], vp); } catch (e3) { return null; }
                    try { fm2 = evalAST(eqs[a], vm); } catch (e4) { return null; }
                    if (!isFinite(fp2) || !isFinite(fm2)) return null;
                    J[a].push((fp2 - fm2) / (2 * hstep));
                }
            }
        }

        // F(x) 与目标梯度 x
        var Fv = [];
        for (var e5 = 0; e5 < m; e5++) {
            var fv;
            try { fv = evalAST(eqs[e5], vmap0); } catch (e6) { return null; }
            if (!isFinite(fv)) return null;
            Fv.push(fv);
        }

        // KKT 线性系统（n+m 维）：
        //   [ J   Jᵀ ] [Δx ]   [ -F ]
        //   [ 0    I  ] [ λ ] = [ -x ]
        // 消元后等价于：Δx = -x - Jᵀλ，且 J·Δx = -F
        //   ⇒ J(-x - Jᵀλ) = -F  ⇒  J Jᵀ λ = F - J x
        // 解 m×m 方程组 (J Jᵀ) λ = (F - J x)，再得 Δx = -x - Jᵀλ
        var JJt = [];
        for (var p = 0; p < m; p++) {
            var row = [];
            for (var q2 = 0; q2 < m; q2++) {
                var acc = 0;
                for (var r2 = 0; r2 < n; r2++) acc += J[p][r2] * J[q2][r2];
                row.push(acc);
            }
            JJt.push(row);
        }
        var rhs = [];
        for (var p2 = 0; p2 < m; p2++) {
            var jx = 0;
            for (var r3 = 0; r3 < n; r3++) jx += J[p2][r3] * x[r3];
            rhs.push(Fv[p2] - jx);
        }
        var lamRes = gaussianSolve(JJt, rhs);
        if (!lamRes || !lamRes.solution) return null;
        var lam = lamRes.solution;

        var dx = [];
        for (var t2 = 0; t2 < n; t2++) {
            var jtl = 0;
            for (var p3 = 0; p3 < m; p3++) jtl += J[p3][t2] * lam[p3];
            dx.push(-x[t2] - jtl);
        }
        if (!isFinite(dx[0])) return null;

        // 阻尼线搜索：只在残差单调下降且留在域内时接受（与既有阻尼牛顿同口径）
        var cur = maxRes(x);
        var accepted = false;
        var step = dx.slice();
        for (var dmp = 0; dmp < 12; dmp++) {
            var xn = [];
            var inDom = true;
            for (var s2 = 0; s2 < n; s2++) {
                var xv = x[s2] + step[s2];
                if (dom && dom[vns[s2]]) {
                    if (xv < dom[vns[s2]].min) { xv = dom[vns[s2]].min; }
                    if (xv > dom[vns[s2]].max) { xv = dom[vns[s2]].max; }
                }
                if (!isFinite(xv)) { inDom = false; break; }
                xn.push(xv);
            }
            if (!inDom) break;
            var rn = maxRes(xn);
            if (rn < cur) { x = xn; accepted = true; break; }
            for (var s3 = 0; s3 < step.length; s3++) step[s3] *= 0.5;
        }
        if (!accepted) return null;   // 不下降 ⇒ 已在局部极小，如实放弃（不假装收敛）
    }
    var rf = maxRes(x);
    // fail-closed：只有真的把约束残差压到 1e-9 以下才算「投影成功」
    if (isFinite(rf) && rf < 1e-9) return { values: x.slice(), residual: rf, iters: maxIter, ok: true };
    return null;
}
