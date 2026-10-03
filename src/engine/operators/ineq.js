/* 模块 operators/ineq：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function suan48(state) {
    // 仅服务纯不等式系统（2026-08-21 修复）：混合系统（等式+域约束，如 x²+y²=25, x≥0, y≥0）
    // 若走 suan48，其 verifyAllConstraints 只验证不等式、不验证等式，会把 (0,0) 这类
    // "只满足不等式、不满足等式"的点当解输出，随后被 _filterIllDefined 删成假空集。
    // 混合系统的域约束由主流程 D0 收紧 + 良定义过滤处理，不需要 suan48 兜底。
    if (!state.isInequalityOnly) return;
    if (!state.inequalityConstraints || state.inequalityConstraints.length === 0) return;
    if (state.finalSolutions && state.finalSolutions.length > 0) return;
    if (state.varNames.length < 1) return;

    var constraints = state.inequalityConstraints;
    var nVars = state.varNames.length;
    var nConstraints = constraints.length;
    var varNames = state.varNames;

    // 域收缩：从简单边界约束和超球面约束中提取变量边界
    var D = {};
    for (var vi = 0; vi < varNames.length; vi++) {
        var vn = varNames[vi];
        D[vn] = { min: state.D0[vn] ? state.D0[vn].min : -1000000, max: state.D0[vn] ? state.D0[vn].max : 1000000 };
    }
    for (var ci = 0; ci < constraints.length; ci++) {
        var c = constraints[ci];
        if (c.lhs.type === 'ident' && c.rhs.type === 'num') {
            var vn = c.lhs.name;
            if (vn && D[vn]) {
                if (c.op === '>=') D[vn].min = Math.max(D[vn].min, c.rhs.value);
                if (c.op === '<=') D[vn].max = Math.min(D[vn].max, c.rhs.value);
            }
        }
        if (c.rhs.type === 'ident' && c.lhs.type === 'num') {
            var vn = c.rhs.name;
            if (vn && D[vn]) {
                if (c.op === '>=') D[vn].max = Math.min(D[vn].max, c.lhs.value);
                if (c.op === '<=') D[vn].min = Math.max(D[vn].min, c.lhs.value);
            }
        }
    }
    // 从超球面约束（sum(var²) ≤ c）收缩域：每个变量 ∈ [-√c, √c]
    for (var ci = 0; ci < constraints.length; ci++) {
        var c = constraints[ci];
        try {
            var lhsStr = c.lhsStr, rhsStr = c.rhsStr;
            var sqSumMatch = lhsStr.match(/^([a-zA-Z]\w*)\^2\s*\+\s*([a-zA-Z]\w*)\^2(?:\s*\+\s*([a-zA-Z]\w*)\^2)?(?:\s*\+\s*([a-zA-Z]\w*)\^2)?(?:\s*\+\s*([a-zA-Z]\w*)\^2)?(?:\s*\+\s*([a-zA-Z]\w*)\^2)?\s*$/);
            if (sqSumMatch && (c.op === '<=' || c.op === '<')) {
                var rhsVal = parseFloat(rhsStr);
                if (isFinite(rhsVal) && rhsVal > 0) {
                    var bound = Math.sqrt(rhsVal);
                    for (var mi = 1; mi < sqSumMatch.length; mi++) {
                        var vn = sqSumMatch[mi];
                        if (vn && D[vn]) {
                            D[vn].min = Math.max(D[vn].min, -bound);
                            D[vn].max = Math.min(D[vn].max, bound);
                        }
                    }
                }
            }
        } catch(e) { _lsNoteInternal(e, 'ineq.js:63 不等式试探，失败跳过该变量，有意忽略'); }
    }
    for (var vi = 0; vi < varNames.length; vi++) {
        var vn = varNames[vi];
        if (D[vn].min > D[vn].max) {
            state.done = true;
            state.result = { solutions: [], error: null, message: "不等式系统域收缩后为空，无可行点", executionPath: "不等式系统域收缩", timeMs: performance.now() - state.startTime, varNames: varNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "约束自相矛盾，可行域为空" };
            return;
        }
    }

    // 生成确定性起始点集合：各维度3层（中点、1/4、3/4）
    // 6变量 → 3^6=729点；用3层覆盖更多区域以找到全部离散解
    var startPoints = [];
    var nStarts = 1;
    for (var i = 0; i < nVars; i++) nStarts *= 3;
    // 如果起始点太多，降为2层
    // 起始点密度自适应：3层(3^nVars)仅当变量数≤5（≤243点），否则2层(2^nVars，6变量=64点）。
    // 高密度(729点)在6变量下与组合枚举相乘会触发秒级乃至十秒级爆炸（实测纯不等式可达15秒）。
    var use3Levels = nStarts <= 243;
    if (!use3Levels) {
        nStarts = 1;
        for (var i = 0; i < nVars; i++) nStarts *= 2;
    }
    (function genStarts(idx, pt) {
        if (idx === nVars) { startPoints.push(pt.slice()); return; }
        var vn = varNames[idx];
        var mid = (D[vn].min + D[vn].max) / 2;
        var q1 = (D[vn].min * 3 + D[vn].max) / 4;
        var q3 = (D[vn].min + D[vn].max * 3) / 4;
        if (use3Levels) {
            pt.push(q1); genStarts(idx + 1, pt); pt.pop();
            pt.push(mid); genStarts(idx + 1, pt); pt.pop();
            pt.push(q3); genStarts(idx + 1, pt); pt.pop();
        } else {
            pt.push(mid); genStarts(idx + 1, pt); pt.pop();
            pt.push(q1); genStarts(idx + 1, pt); pt.pop();
        }
    })(0, []);

    var allSolutions = [];
    var tolerance = state.tolerance || 1e-6;
    var maxIter = 20;

    // ===== 边界组合枚举 + 多起始点牛顿法 =====
    if (nConstraints >= nVars) {
        var combos = [];
        var maxCombos = (function() {
            var r = 1;
            for (var i = 0; i < nVars; i++) r = r * (nConstraints - i) / (i + 1);
            return r;
        })();
        var limit = Math.min(maxCombos, 120);
        (function genCombos(start, chosen) {
            if (chosen.length === nVars) { combos.push(chosen.slice()); return; }
            for (var i = start; i < nConstraints && combos.length < limit; i++) {
                chosen.push(i); genCombos(i + 1, chosen); chosen.pop();
            }
        })(0, []);

        for (var ci = 0; ci < combos.length; ci++) {
            // 时间预算保护：suan48 是纯不等式路径首个算子，startTime 为全局根计时。
            // 组合枚举 × 牛顿法在最坏情形下可达十秒级，超 3 秒即停止枚举（已找到的解仍输出，
            // 未枚举完标记 truncated 如实暴露），杜绝单输入卡死 UI。
            if (performance.now() - state.startTime > 3000) { state.truncated = true; break; }
            var combo = combos[ci];
            var eqs = [];
            var eqASTs = [];
            for (var ei = 0; ei < combo.length; ei++) {
                var c = constraints[combo[ei]];
                eqs.push(c.lhsStr + " = " + c.rhsStr);
                // 解析为 AST（f(x) = 0 形式）
                var leftFixed = fuzzyFix(c.lhsStr, state.protNames);
                var rightFixed = fuzzyFix(c.rhsStr, state.protNames);
                var leftAST = parse(tokenize(leftFixed));
                var rightAST = parse(tokenize(rightFixed));
                eqASTs.push({ type: "binop", op: "-", left: leftAST, right: rightAST });
            }

            // 用多起始点牛顿法求解边界方程组
            var seenSolutions = {};
            for (var si = 0; si < startPoints.length; si++) {
                var nr = newtonSolve(eqASTs, varNames, startPoints[si], { maxIter: maxIter, tolerance: tolerance });
                if (nr && nr.converged && nr.residual < tolerance) {
                    var sol = nr.solution;
                    // 检查是否与已有解重复
                    var key = sol.map(function(v) { return Math.round(v * 1e6); }).join(',');
                    if (seenSolutions[key]) continue;
                    seenSolutions[key] = true;

                    if (verifyAllConstraints(sol, constraints, varNames)) {
                        var dup = false;
                        for (var ai = 0; ai < allSolutions.length; ai++) {
                            var d = 0;
                            for (var vi = 0; vi < varNames.length; vi++) d += Math.abs(allSolutions[ai].values[vi] - sol[vi]);
                            if (d < 1e-6) { dup = true; break; }
                        }
                        // 边界点数值误差夹取：牛顿法解出的边界等式点（如 x=2）常带 ~1e-8 误差，
                        // 略越出域收缩后的 [min,max]，会被 _filterIllDefined 的域检查（容差 1e-9）误删成空集。
                        // 边界组合的解本就应在约束边界上，夹取回域内即可（夹取幅度 << 约束容差 1e-6）。
                        var _solClamped = sol.map(function(v, vi) { var _d = D[varNames[vi]]; return _d ? Math.min(_d.max, Math.max(_d.min, v)) : v; });
                        if (!dup) allSolutions.push({ values: _solClamped, residual: nr.residual });
                    }
                }
            }
        }
    }

    if (allSolutions.length > 0) {
        // 聚类：相近的点合并为一个代表解
        var clustered = [];
        var assigned = {};
        for (var ai = 0; ai < allSolutions.length; ai++) {
            if (assigned[ai]) continue;
            var cluster = [ai];
            assigned[ai] = true;
            for (var aj = ai + 1; aj < allSolutions.length; aj++) {
                if (assigned[aj]) continue;
                var d = 0;
                for (var vi = 0; vi < varNames.length; vi++) d += Math.abs(allSolutions[ai].values[vi] - allSolutions[aj].values[vi]);
                if (d < 1e-3) { cluster.push(aj); assigned[aj] = true; }
            }
            var center = [];
            var minResidual = Infinity;
            for (var vi = 0; vi < varNames.length; vi++) {
                var sum = 0;
                for (var ci = 0; ci < cluster.length; ci++) sum += allSolutions[cluster[ci]].values[vi];
                center.push(sum / cluster.length);
            }
            for (var ci = 0; ci < cluster.length; ci++) {
                if (allSolutions[cluster[ci]].residual < minResidual) minResidual = allSolutions[cluster[ci]].residual;
            }
            clustered.push({ values: center.map(function(v, vi) { var _d = D[varNames[vi]]; return _d ? Math.min(_d.max, Math.max(_d.min, v)) : v; }), residual: minResidual });
        }

        sortAndOutput(state, clustered, varNames, nConstraints, combos.length);
        return;
    }

    // 所有边界组合均未找到满足全约束的离散解。
    // 关键：不等式系统的可行域通常是连续的（如 x²+y²≤1 的圆盘），
    // 边界组合枚举只能找到“角点”，找不到不代表可行域为空。
    // 因此先做【内部可行性探测】：
    //   - 若能在域内部（确定性 3 层网格）找到一个满足全部约束的点 → 报 resultType 2（存在可行点），sound；
    //   - 若连内部采样都找不到 → 不能严格证伪，保守地不宣布无解，交由其它路径继续，避免假无解。
    var probeFeasible = null;
    for (var sp = 0; sp < startPoints.length && !probeFeasible; sp++) {
        if (verifyAllConstraints(startPoints[sp], constraints, varNames)) {
            probeFeasible = startPoints[sp].slice();
        }
    }
    if (probeFeasible) {
        var _pfClamped = probeFeasible.map(function(v, vi) { var _d = D[varNames[vi]]; return _d ? Math.min(_d.max, Math.max(_d.min, v)) : v; });
        sortAndOutput(state, [{ values: _pfClamped, residual: 0 }], varNames, nConstraints, 0);
        return;
    }
    // 既不能证有、也不能严格证无：保守处理，不宣布无解（不丢可行域），留待其它求解路径
    state.done = true;
    state.result = {
        solutions: [],
        error: null,
        message: "不等式系统边界组合枚举+内部探测：未能枚举到离散可行点（可行域可能为非空连续区域，未做严格可行性证明）",
        executionPath: "不等式系统枚举",
        timeMs: performance.now() - state.startTime,
        varNames: varNames,
        resultType: 2,
        resultTypeName: "不等式系统可行域可能非空",
        resultTypeDesc: "边界组合枚举未找到离散可行点，但未严格证伪，可行域可能为非空连续区域"
    };
}
