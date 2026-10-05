/* 模块 operators/numeric：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function suan40(state) {
    if (!state.startPoints || state.startPoints.length === 0) {
        // 如果没有起始点，尝试从默认网格生成
        state.startPoints = generateStartPoints(state.varNames, state.D0, state);
        if (!state.startPoints || state.startPoints.length === 0) return;
    }

    var allSolutions = [];
    var WATCHDOG_MS = 600;

    for (var spi = 0; spi < state.startPoints.length; spi++) {
        if (performance.now() - state.startTime > WATCHDOG_MS) break;
        var sp = state.startPoints[spi];
        var result = lineSearchNewton(state.equations, state.varNames, sp, {
            maxIter: state.maxIter,
            tolerance: state.tolerance,
            _deadline: performance.now() + 100
        });
        if (result.converged) {
            var sol = result.solution.map(function(v) { return roundToGrid(v); });
            var hasNaN = false;
            for (var si = 0; si < sol.length; si++) {
                if (isNaN(sol[si]) || !isFinite(sol[si]) || Math.abs(sol[si]) > 1000000) { hasNaN = true; break; }
            }
            if (hasNaN) continue;
            var vars = {};
            state.varNames.forEach(function(v, i) { vars[v] = sol[i]; });
            var res = 0;
            state.equations.forEach(function(eq) { var r = Math.abs(evalAST(eq, vars)); if (r > res) res = r; });
            allSolutions.push({ values: sol, residual: res });
        }
    }

    if (allSolutions.length > 0) {
        var seen = new Set();
        var unique = allSolutions.filter(function(s) {
            var hash = s.values.map(function(v) { return v.toFixed(6); }).join(",");
            if (seen.has(hash)) return false;
            seen.add(hash);
            return true;
        });
        unique.sort(function(a, b) { return a.residual - b.residual; });
        state.allRawSolutions = unique;
    }
}


function suan41(state) {
    var tolerance = state.tolerance;
    var maxBoxes = 20;
    var eps = 1e-7;
    var n = state.varNames.length;
    
    // 初始区间栈
    var stack = [state.D0];
    var solutions = [];
    var iterations = 0;
    
    while (stack.length > 0 && iterations < 200) {
        iterations++;
        var X = stack.pop();
        if (!X) continue;
        
        // 计算区间宽度，如果足够小则取中点作为候选解
        var maxWidth = 0;
        for (var vi = 0; vi < n; vi++) {
            var vn = state.varNames[vi];
            var w = X[vn].max - X[vn].min;
            if (w > maxWidth) maxWidth = w;
        }
        
        if (maxWidth < tolerance) {
            // 取中点作为候选解
            var candidate = new Array(n);
            for (var vi = 0; vi < n; vi++) {
                var vn = state.varNames[vi];
                candidate[vi] = (X[vn].min + X[vn].max) / 2;
            }
            var vars = {};
            state.varNames.forEach(function(v, k) { vars[v] = candidate[k]; });
            var F = state.equations.map(function(eq) { return evalAST(eq, vars); });
            var maxRes = 0;
            var _hasNaN = false;
            for (var fi = 0; fi < F.length; fi++) {
                if (isNaN(F[fi]) || !isFinite(F[fi])) { _hasNaN = true; break; }
                var absF = Math.abs(F[fi]);
                if (absF > maxRes) maxRes = absF;
            }
            if (!_hasNaN && maxRes < tolerance * 10) {
                solutions.push({ values: candidate, residual: maxRes });
            }
            continue;
        }
        
        var mid = new Array(n);
        for (var vi = 0; vi < n; vi++) {
            var vn = state.varNames[vi];
            mid[vi] = (X[vn].min + X[vn].max) / 2;
        }
        
        // 计算F(mid)
        var vars = {};
        state.varNames.forEach(function(v, k) { vars[v] = mid[k]; });
        var Fmid = state.equations.map(function(eq) { return evalAST(eq, vars); });
        var hasNaN = false;
        for (var fi = 0; fi < Fmid.length; fi++) {
            if (isNaN(Fmid[fi]) || !isFinite(Fmid[fi])) { hasNaN = true; break; }
        }
        if (hasNaN) {
            // 区间包含奇异点，直接分裂
            var splitVar = 0;
            var maxW = 0;
            for (var vi = 0; vi < n; vi++) {
                var vn = state.varNames[vi];
                var w = X[vn].max - X[vn].min;
                if (w > maxW) { maxW = w; splitVar = vi; }
            }
            var svn = state.varNames[splitVar];
            var midVal = (X[svn].min + X[svn].max) / 2;
            var X1 = {}, X2 = {};
            for (var vi = 0; vi < n; vi++) {
                var vn = state.varNames[vi];
                X1[vn] = { min: X[vn].min, max: (vi === splitVar ? midVal : X[vn].max) };
                X2[vn] = { min: (vi === splitVar ? midVal : X[vn].min), max: X[vn].max };
            }
            if (stack.length < maxBoxes) {
                stack.push(X2);
                stack.push(X1);
            }
            continue;
        }
        
        // 计算区间雅可比矩阵 F'(X)
        var Jint = [];
        for (var i = 0; i < state.equations.length; i++) {
            Jint.push(new Array(n));
            for (var j = 0; j < n; j++) {
                // 数值区间导数：在X上计算偏导数的区间
                var dMin = Infinity, dMax = -Infinity;
                var samplePts = [mid[j], X[state.varNames[j]].min, X[state.varNames[j]].max];
                for (var si = 0; si < samplePts.length; si++) {
                    var xP = mid.slice();
                    xP[j] = samplePts[si] + eps;
                    var xM = mid.slice();
                    xM[j] = samplePts[si] - eps;
                    var vP = {}, vM = {};
                    state.varNames.forEach(function(v, k) { vP[v] = xP[k]; vM[v] = xM[k]; });
                    var fp = evalAST(state.equations[i], vP);
                    var fm = evalAST(state.equations[i], vM);
                    var deriv = (fp - fm) / (2 * eps);
                    if (isFinite(deriv) && !isNaN(deriv)) {
                        if (deriv < dMin) dMin = deriv;
                        if (deriv > dMax) dMax = deriv;
                    }
                }
                Jint[i][j] = { min: dMin === Infinity ? 0 : dMin, max: dMax === -Infinity ? 0 : dMax };
            }
        }
        
        // 构造区间牛顿算子：N(X) = mid - J(X)^{-1} * F(mid)
        // 使用高斯消元法解 J * delta = F(mid)
        // 区间高斯消元（简化：用中点矩阵近似）
        var Jmid = [];
        for (var i = 0; i < state.equations.length; i++) {
            Jmid.push(new Array(n));
            for (var j = 0; j < n; j++) {
                Jmid[i][j] = (Jint[i][j].min + Jint[i][j].max) / 2;
            }
        }
        
        var negFmid = Fmid.map(function(f) { return -f; });
        var gaussResult = gaussianSolve(Jmid, negFmid);
        
        if (!gaussResult) {
            // 奇异雅可比，直接分裂
            var splitVar = 0;
            var maxW = 0;
            for (var vi = 0; vi < n; vi++) {
                var vn = state.varNames[vi];
                var w = X[vn].max - X[vn].min;
                if (w > maxW) { maxW = w; splitVar = vi; }
            }
            var svn = state.varNames[splitVar];
            var midVal = (X[svn].min + X[svn].max) / 2;
            var X1 = {}, X2 = {};
            for (var vi = 0; vi < n; vi++) {
                var vn = state.varNames[vi];
                X1[vn] = { min: X[vn].min, max: (vi === splitVar ? midVal : X[vn].max) };
                X2[vn] = { min: (vi === splitVar ? midVal : X[vn].min), max: X[vn].max };
            }
            if (stack.length < maxBoxes) {
                stack.push(X2);
                stack.push(X1);
            }
            continue;
        }
        
        var delta = gaussResult.solution;
        
        // 计算N(X)的区间：delta的区间扩展
        var N = {};
        for (var vi = 0; vi < n; vi++) {
            var vn = state.varNames[vi];
            // 用区间扩张计算delta的误差边界
            var deltaErr = 0;
            for (var j = 0; j < n; j++) {
                var halfWidth = (Jint[vi][j].max - Jint[vi][j].min) / 2;
                deltaErr += halfWidth * Math.abs(delta[j]);
            }
            var dVal = delta[vi];
            N[vn] = {
                min: mid[vi] + dVal - deltaErr - 1e-10,
                max: mid[vi] + dVal + deltaErr + 1e-10
            };
        }
        
        // 区间牛顿判定
        var isSubset = true;    // N(X) ⊆ X ?
        var isDisjoint = false; // N(X) ∩ X = ∅ ?
        
        for (var vi = 0; vi < n; vi++) {
            var vn = state.varNames[vi];
            var Nlo = N[vn].min, Nhi = N[vn].max;
            var Xlo = X[vn].min, Xhi = X[vn].max;
            
            // 检查N(X) ⊆ X
            if (Nlo < Xlo - 1e-10 || Nhi > Xhi + 1e-10) isSubset = false;
            // 检查N(X) ∩ X = ∅
            if (Nhi < Xlo - 1e-10 || Nlo > Xhi + 1e-10) isDisjoint = true;
        }
        
        if (isDisjoint) {
            // 注意：区间雅可比用的是"中点矩阵近似"而非严格区间包络，
            // 因此 N(X)∩X=∅ 不可靠——可能把真含解的盒子误判为无解而漏解。
            // 为保证"不漏解"，此处不丢弃盒子，而是继续走下方 else 的分裂分支，
            // 让更深层的区间判定去处理（isSubset 必为 false，故会进入分裂）。
        }
        
        if (isSubset) {
            // N(X) ⊆ X → 唯一解存在，收缩区间并继续
            // 用N(X)更新X
            var newX = {};
            for (var vi = 0; vi < n; vi++) {
                var vn = state.varNames[vi];
                newX[vn] = {
                    min: Math.max(X[vn].min, N[vn].min),
                    max: Math.min(X[vn].max, N[vn].max)
                };
            }
            // 检查新区间宽度，如果足够小则取中点
            var w = 0;
            for (var vi = 0; vi < n; vi++) {
                var vn = state.varNames[vi];
                var ww = newX[vn].max - newX[vn].min;
                if (ww > w) w = ww;
            }
            if (w < tolerance) {
                var candidate = new Array(n);
                for (var vi = 0; vi < n; vi++) {
                    var vn = state.varNames[vi];
                    candidate[vi] = (newX[vn].min + newX[vn].max) / 2;
                }
                var vars = {};
                state.varNames.forEach(function(v, k) { vars[v] = candidate[k]; });
                var F = state.equations.map(function(eq) { return evalAST(eq, vars); });
                var maxRes = 0;
                var _hasNaN = false;
                for (var fi = 0; fi < F.length; fi++) {
                    if (isNaN(F[fi]) || !isFinite(F[fi])) { _hasNaN = true; break; }
                    var absF = Math.abs(F[fi]);
                    if (absF > maxRes) maxRes = absF;
                }
                if (!_hasNaN && maxRes < tolerance * 10) {
                    solutions.push({ values: candidate, residual: maxRes });
                } else {
                }
            } else {
                if (stack.length < maxBoxes) stack.push(newX);
            }
        } else {
            // N(X) 与 X 部分重叠 → 分裂
            var splitVar = 0;
            var maxW = 0;
            for (var vi = 0; vi < n; vi++) {
                var vn = state.varNames[vi];
                var w = X[vn].max - X[vn].min;
                if (w > maxW) { maxW = w; splitVar = vi; }
            }
            var svn = state.varNames[splitVar];
            var midVal = (X[svn].min + X[svn].max) / 2;
            var X1 = {}, X2 = {};
            for (var vi = 0; vi < n; vi++) {
                var vn = state.varNames[vi];
                X1[vn] = { min: X[vn].min, max: (vi === splitVar ? midVal : X[vn].max) };
                X2[vn] = { min: (vi === splitVar ? midVal : X[vn].min), max: X[vn].max };
            }
            if (stack.length < maxBoxes) {
                stack.push(X2);
                stack.push(X1);
            }
        }
    }
    
    state.intervalNewtonSolutions = solutions;
}


function suan42(state) {
    var allRaw = [];
    if (state.allRawSolutions) {
        state.allRawSolutions.forEach(function(s) { if (s.values) allRaw.push(s.values); });
    }
    if (state.intervalNewtonSolutions) {
        state.intervalNewtonSolutions.forEach(function(s) { if (s.values) allRaw.push(s.values); });
    }
    state.allRawSolutions = allRaw;

    var VERIFY_TOL = Math.max(1e-4, state.tolerance * 10);
    var verified = [];
    for (var ri = 0; ri < allRaw.length; ri++) {
        var raw = allRaw[ri];
        var vars = {};
        state.varNames.forEach(function(v, i) { vars[v] = raw[i]; });
        var maxRes = 0;
        state.equations.forEach(function(eq) {
            var r = Math.abs(evalAST(eq, vars));
            if (r > maxRes) maxRes = r;
        });
        if (maxRes < VERIFY_TOL) {
            var rounded = raw.map(roundToGrid);
            verified.push({ values: rounded, residual: maxRes });
        }
    }
    state.verified = verified;
}
