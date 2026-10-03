/* 模块 pipeline/output：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function verifyAllConstraints(values, constraints, varNames) {
    var vars = {};
    for (var vi = 0; vi < varNames.length; vi++) {
        vars[varNames[vi]] = values[vi];
    }
    for (var ci = 0; ci < constraints.length; ci++) {
        var c = constraints[ci];
        try {
            var lhsVal = evalAST(c.lhs, vars);
            var rhsVal = evalAST(c.rhs, vars);
            if (isNaN(lhsVal) || isNaN(rhsVal) || !isFinite(lhsVal) || !isFinite(rhsVal)) return false;
            if (c.op === '<=') { if (lhsVal > rhsVal + 1e-6) return false; }
            else if (c.op === '>=') { if (lhsVal < rhsVal - 1e-6) return false; }
            else if (c.op === '<') { if (lhsVal >= rhsVal) return false; }
            else if (c.op === '>') { if (lhsVal <= rhsVal) return false; }
        } catch(e) { return false; }
    }
    return true;
}


function _recommendKey(sol) {
    var n = sol.values.length, norm = 0;
    var key = new Array(n + 1);
    for (var i = 0; i < n; i++) norm += sol.values[i] * sol.values[i];
    key[0] = Math.round(norm * 1e9);                       // 主：量化范数平方（距原点最近）
    for (var i = 0; i < n; i++) key[i + 1] = Math.round(Math.abs(sol.values[i]) * 1e9); // 次：|x_i| 字典序
    return key;
}

function _recommendKeyCmp(a, b) {
    var ka = _recommendKey(a), kb = _recommendKey(b);
    var L = (ka.length < kb.length) ? ka.length : kb.length;
    for (var i = 0; i < L; i++) { if (ka[i] !== kb[i]) return ka[i] - kb[i]; }
    return 0;
}

function pickRecommended(sols) {
    if (!sols || !sols.length) return null;
    var best = sols[0], bk = _recommendKey(best);
    for (var i = 1; i < sols.length; i++) {
        var k = _recommendKey(sols[i]);
        var better = false;
        for (var j = 0; j < k.length; j++) { if (k[j] !== bk[j]) { better = (k[j] < bk[j]); break; } }
        if (better) { best = sols[i]; bk = k; }
    }
    return best;
}


function sortAndOutput(state, solutions, varNames, nConstraints, nAttempts) {
    // 主准则：距原点最近（‖x‖² 最小）；等距时按字典序最小化 |x_i|（真全序，确定性、可复现——产品承诺）
    solutions.sort(_recommendKeyCmp);

    state.finalSolutions = solutions;
    state.result = {
        solutions: solutions,
        error: null,
        message: "不等式系统枚举求解：在 " + nConstraints + " 个约束下，通过 " + nAttempts + " 组边界组合+多起始点牛顿法找到 " + solutions.length + " 组可行解",
        executionPath: "不等式系统枚举",
        timeMs: performance.now() - state.startTime,
        varNames: varNames,
        resultType: 2,
        resultTypeName: "不等式系统有限可行解",
        resultTypeDesc: "通过确定性边界组合枚举+多起始点牛顿法找到满足所有约束的离散可行解"
    };
    state.done = true;
}


function _runTail(state) {
    if (!state.fastMode) {
        _runOp(state, OP_BRANCH);
        if (state.done) return _finish(state);
    }
    _runOp(state, OP_INEQ);
    if (state.done) return _finish(state);
    _runOp(state, OP_OUTPUT);
    return _finish(state);
}
