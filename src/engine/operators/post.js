/* 模块 operators/post：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function suan43(state) {
    if (!state.verified) return;
    for (var i = 0; i < state.verified.length; i++) {
        state.verified[i].values = state.verified[i].values.map(roundToGrid);
    }
}


function suan44(state) {
    if (!state.verified || state.verified.length === 0) return;

    var VERIFY_TOL = Math.max(1e-4, state.tolerance * 10);
    var verifiedFiltered = [];
    for (var i = 0; i < state.verified.length; i++) {
        var sol = state.verified[i];
        var vars = {};
        state.varNames.forEach(function(v, idx) { vars[v] = sol.values[idx]; });
        var maxRes = 0;
        state.equations.forEach(function(eq) {
            var r = Math.abs(evalAST(eq, vars));
            if (r > maxRes) maxRes = r;
        });
        if (maxRes < VERIFY_TOL) {
            sol.residual = maxRes;
            verifiedFiltered.push(sol);
        }
    }
    state.verified = verifiedFiltered;

    // 域约束过滤
    if (state.domainConstraints.length > 0) {
        var domainFiltered = [];
        for (var dsi = 0; dsi < state.verified.length; dsi++) {
            var dSol = state.verified[dsi];
            var dViolated = false;
            for (var dci = 0; dci < state.domainConstraints.length; dci++) {
                var dc = state.domainConstraints[dci];
                var vi = state.varNames.indexOf(dc.varName);
                if (vi >= 0) {
                    var val = dSol.values[vi];
                    if (dc.min !== undefined && val < dc.min - 1e-9) { dViolated = true; break; }
                    if (dc.max !== undefined && val > dc.max + 1e-9) { dViolated = true; break; }
                }
            }
            if (!dViolated) domainFiltered.push(dSol);
        }
        if (domainFiltered.length > 0) { state.verified = domainFiltered; }
        else {
            state.done = true;
            state.result = { solutions: [], error: "NO_SOLUTION", message: "解被域约束条件过滤", executionPath: "定义域过滤", timeMs: performance.now() - state.startTime, confidence: "low", varNames: state.varNames, warnings: state.conditionWarnings.length > 0 ? state.conditionWarnings : undefined, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "候选解被域约束条件排除" };
            return;
        }
    }

    if (state.verified.length === 0) {
        state.done = true;
        state.result = { solutions: [], error: "NO_SOLUTION", message: "验证后无满足残差条件的解", executionPath: "残差过滤", timeMs: performance.now() - state.startTime, varNames: state.varNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "所有候选解残差均过大" };
        return;
    }
    state.uniqueVerified = state.verified;
}


function suan45(state) {
    if (!state.uniqueVerified || state.uniqueVerified.length === 0) return;
    state.finalSolutions = state.uniqueVerified;
    state.eliminated = 0;
}


function suan46(state) {
    if (!state.finalSolutions || state.finalSolutions.length <= 1) return;
    var valueArrays = state.finalSolutions.map(function(s) { return s.values; });
    var unique = deduplicateSolutions(valueArrays, state.varNames, state.tolerance);
    var finalUnique = [];
    for (var ui = 0; ui < unique.length; ui++) {
        var found = null;
        for (var fi = 0; fi < state.finalSolutions.length; fi++) {
            if (state.finalSolutions[fi].values === unique[ui]) { found = state.finalSolutions[fi]; break; }
        }
        if (!found) {
            var res = 0;
            var vars = {};
            state.varNames.forEach(function(v, i) { vars[v] = unique[ui][i]; });
            state.equations.forEach(function(eq) { var r = Math.abs(evalAST(eq, vars)); if (r > res) res = r; });
            found = { values: unique[ui], residual: res };
        }
        finalUnique.push(found);
    }
    state.finalSolutions = finalUnique;
}


function _suan57Prune(fnode, vn, lo, hi, opts) {
    opts = opts || {};
    var maxLevels = opts.maxLevels || 14;        // 6 层 ⇒ 最多 64 段（2^6）
    var maxBands = opts.maxBands || 24;
    var maxEvals = opts.maxEvals || 200;       // 每次约 30μs ⇒ 200 次约 6ms
    var minPruneRatio = opts.minPruneRatio || 0.10;   // 剪率低于此值 ⇒ 放弃
    var ivEval = opts.intervalEval;
    if (!ivEval) return null;
    if (!isFinite(lo) || !isFinite(hi) || lo >= hi) return null;

    var evalCount = 0;
    var rootless = [];
    var band = [[lo, hi]];
    var totalW = hi - lo;

    function provablyRootless(a, b) {
        var iv = null;
        try { var m = {}; m[vn] = { min: a, max: b }; iv = ivEval(fnode, m); }
        catch (e) { iv = null; }
        evalCount++;
        if (!iv || typeof iv !== 'object') return false;
        var _mn = iv.min, _mx = iv.max;
        // NaN = 真正无法定向（overestimation 爆炸）⇒ 保守不剪
        if (typeof _mn !== 'number' || typeof _mx !== 'number' || isNaN(_mn) || isNaN(_mx)) return false;
        // ±Infinity 是【有效信息】：[∞,∞] 恒正、[−∞,−∞] 恒负 ⇒ 段内无根，仍可剪。
        // 只有「一端 ∞ 另一端 −∞」这种跨零包络才含 0（此时返回 false）。
        if (_mn > 0) return true;              // 下界为正（含 +∞）⇒ 段内恒正 ⇒ 无根
        if (_mx < 0) return true;              // 上界为负（含 −∞）⇒ 段内恒负 ⇒ 无根
        return false;                          // 包络含 0（含跨零无穷）⇒ 保留
    }

    for (var lv = 0; lv < maxLevels; lv++) {
        var next = [];
        for (var bi = 0; bi < band.length; bi++) {
            var a = band[bi][0], b = band[bi][1];
            if (provablyRootless(a, b)) { rootless.push([a, b]); continue; }
            // 细分前先问：分了之后端点有机会变有限吗？
            // exp 在 709.78 处上溢、ln 在 1e-308 处下溢 ⇒ 这是「需 12 层」的判据
            var _mid = (a + b) / 2;
            if (band.length < maxBands && evalCount < maxEvals && (b - a) > 1e-12
                && (isFinite(a) || isFinite(b) || isFinite(_mid))) {
                var mid = (a + b) / 2;
                next.push([a, mid]);
                next.push([mid, b]);
            } else {
                next.push([a, b]);
            }
        }
        band = next;
        if (band.length === 0) break;
        if (band.length >= maxBands || evalCount >= maxEvals) break;
    }

    var residW = 0;
    for (var wi = 0; wi < band.length; wi++) residW += band[wi][1] - band[wi][0];
    var pruneRatio = 1 - residW / totalW;

    // 剪率太低 ⇒ 白干（区间求值不是免费的），如实返回 null 让调用方走原路径
    if (!rootless.length || pruneRatio < minPruneRatio) {
        return { rootless: [], bands: [[lo, hi]], evalCount: evalCount, prunedAny: false, pruneRatio: pruneRatio, fullyPruned: false };
    }

    return {
        rootless: rootless,
        bands: band,
        evalCount: evalCount,
        prunedAny: true,
        pruneRatio: pruneRatio,
        fullyPruned: band.length === 0
    };
}
