/* 模块 operators/support：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function newtonSolve(equations, varNames, initialGuess, options) {
    const maxIter = options.maxIter;
    const tolerance = options.tolerance;
    const n = varNames.length;
    let x = initialGuess.slice();
    const eps = 1e-8;

    for (let iter = 0; iter < maxIter; iter++) {
        // 时间看门狗：单次牛顿求解不超过 200ms
        if (performance.now() - (options._deadline || Infinity) > 0) {
            return { solution: x, iterations: iter, converged: false, residual: Infinity, error: 'deadline_exceeded' };
        }

        const vars = {};
        varNames.forEach((v, i) => vars[v] = x[i]);

        const F = equations.map(eq => evalAST(eq, vars));

        // 检查收敛
        let norm = 0;
        for (let i = 0; i < F.length; i++) {
            if (isNaN(F[i]) || !isFinite(F[i])) {
                return { solution: x, iterations: iter, converged: false, residual: Infinity, error: 'NaN encountered' };
            }
            norm += F[i] * F[i];
        }
        norm = Math.sqrt(norm);

        if (norm < tolerance) {
            return { solution: x, iterations: iter, converged: true, residual: norm };
        }

        // 数值雅可比矩阵
        const J = [];
        for (let i = 0; i < equations.length; i++) {
            J.push(new Array(n));
            for (let j = 0; j < n; j++) {
                const xP = x.slice();
                xP[j] += eps;
                const vP = {};
                varNames.forEach((v, k) => vP[v] = xP[k]);
                const fp = evalAST(equations[i], vP);
                J[i][j] = (fp - F[i]) / eps;
                if (isNaN(J[i][j]) || !isFinite(J[i][j])) {
                    J[i][j] = 0;
                }
            }
        }

        // 解 J*dx = -F （使用最小二乘思路：J^T * J * dx = J^T * (-F)）
        let dx = null;

        if (equations.length === n) {
            // 方阵，直接高斯消元
            const negF = F.map(f => -f);
            const result = gaussianSolve(J, negF);
            if (result) {
                dx = result.solution;
            }
        }

        if (!dx && equations.length !== n) {
            // 最小二乘（仅超定系统）：J^T * J * dx = J^T * (-F)
            const JT = [];
            for (let j = 0; j < n; j++) {
                JT.push(new Array(equations.length));
                for (let i = 0; i < equations.length; i++) {
                    JT[j][i] = J[i][j];
                }
            }

            const JTJ = [];
            for (let i = 0; i < n; i++) {
                JTJ.push(new Array(n));
                for (let j = 0; j < n; j++) {
                    let sum = 0;
                    for (let k = 0; k < equations.length; k++) {
                        sum += JT[i][k] * J[k][j];
                    }
                    JTJ[i][j] = sum;
                }
            }

            // 添加正则化
            for (let i = 0; i < n; i++) {
                JTJ[i][i] += 1e-10;
            }

            const JTF = new Array(n);
            for (let i = 0; i < n; i++) {
                let sum = 0;
                for (let k = 0; k < equations.length; k++) {
                    sum += JT[i][k] * (-F[k]);
                }
                JTF[i] = sum;
            }

            const result = gaussianSolve(JTJ, JTF);
            if (result) {
                dx = result.solution;
            }
        }

        if (!dx) {
            return { solution: x, iterations: iter, converged: false, residual: norm, error: '雅可比奇异' };
        }

        // 阻尼更新（步长限制）
        let alpha = 1.0;
        let maxStep = 0;
        for (let i = 0; i < n; i++) {
            if (Math.abs(dx[i]) > maxStep) maxStep = Math.abs(dx[i]);
        }
        if (maxStep > 100) alpha = 100 / maxStep;

        for (let i = 0; i < n; i++) {
            x[i] += alpha * dx[i];
            // 边界约束
            if (Math.abs(x[i]) > 1000000) {
                x[i] = Math.sign(x[i]) * 1000000;
            }
        }
    }

    const vars = {};
    varNames.forEach((v, i) => vars[v] = x[i]);
    const F = equations.map(eq => evalAST(eq, vars));
    let norm = 0;
    for (let i = 0; i < F.length; i++) {
        if (isNaN(F[i]) || !isFinite(F[i])) {
            return { solution: x, iterations: maxIter, converged: false, residual: Infinity };
        }
        norm += F[i] * F[i];
    }
    norm = Math.sqrt(norm);

    return {
        solution: x,
        iterations: maxIter,
        converged: norm < tolerance,
        residual: norm
    };
}


function armijoLineSearch(x, dx, equations, varNames, F0, grad_dot_dx) {
    var alpha = 1.0;
    var tau = 0.5;      // 回溯衰减因子
    var c1 = 1e-4;      // Armijo常数
    var minAlpha = 1e-12;
    var n = x.length;
    
    var norm0Sq = 0;
    for (var fi = 0; fi < F0.length; fi++) norm0Sq += F0[fi] * F0[fi];
    
    while (alpha > minAlpha) {
        // 试探点
        var trialX = new Array(n);
        for (var i = 0; i < n; i++) {
            trialX[i] = x[i] + alpha * dx[i];
            if (Math.abs(trialX[i]) > 1000000) {
                trialX[i] = Math.sign(trialX[i]) * 1000000;
            }
        }
        
        var tvars = {};
        varNames.forEach(function(v, k) { tvars[v] = trialX[k]; });
        var F_trial = equations.map(function(eq) { return evalAST(eq, tvars); });
        
        var hasNaN = false;
        for (var fi = 0; fi < F_trial.length; fi++) {
            if (isNaN(F_trial[fi]) || !isFinite(F_trial[fi])) { hasNaN = true; break; }
        }
        if (hasNaN) { alpha *= tau; continue; }
        
        var trialNormSq = 0;
        for (var fi = 0; fi < F_trial.length; fi++) trialNormSq += F_trial[fi] * F_trial[fi];
        
        // Armijo条件：F(x+α·dx)² ≤ F(x)² + c1·α·∇(F²)·dx
        // 即 trialNormSq ≤ norm0Sq + c1 * alpha * (2 * grad_dot_dx)
        var armijoRHS = norm0Sq + c1 * alpha * 2 * grad_dot_dx;
        
        if (trialNormSq <= armijoRHS) {
            return { alpha: alpha, F_trial: F_trial, trialNormSq: trialNormSq, armijoSatisfied: true };
        }
        
        alpha *= tau;
    }
    
    // Armijo失败，返回最小步长
    var trialX = new Array(n);
    for (var i = 0; i < n; i++) {
        trialX[i] = x[i] + minAlpha * dx[i];
        if (Math.abs(trialX[i]) > 1000000) {
            trialX[i] = Math.sign(trialX[i]) * 1000000;
        }
    }
    var tvars = {};
    varNames.forEach(function(v, k) { tvars[v] = trialX[k]; });
    var F_trial = equations.map(function(eq) { return evalAST(eq, tvars); });
    return { alpha: minAlpha, F_trial: F_trial, trialNormSq: -1, armijoFailed: true, armijoSatisfied: false };
}


function lineSearchNewton(equations, varNames, initialGuess, options) {
    var maxIter = options.maxIter || 20;
    var tolerance = options.tolerance || 1e-6;
    var n = varNames.length;
    var x = initialGuess.slice();
    var eps = 1e-8;
    
    // 模块3: 迭代收敛极限判定与加速
    // 存储最近3步迭代值用于Aitken加速
    var xHistory = [];
    var normHistory = [];
    var stallCount = 0; // 连续无下降步数
    
    for (var iter = 0; iter < maxIter; iter++) {
        // 时间看门狗
        if (options._deadline && performance.now() - options._deadline > 0) {
            return { solution: x, iterations: iter, converged: false, residual: Infinity, error: 'deadline_exceeded' };
        }
        
        var vars = {};
        varNames.forEach(function(v, i) { vars[v] = x[i]; });
        var F = equations.map(function(eq) { return evalAST(eq, vars); });
        
        var hasNaN = false;
        for (var fi = 0; fi < F.length; fi++) {
            if (isNaN(F[fi]) || !isFinite(F[fi])) { hasNaN = true; break; }
        }
        if (hasNaN) {
            return { solution: x, iterations: iter, converged: false, residual: Infinity, error: 'NaN encountered' };
        }
        
        var norm = 0;
        for (var fi = 0; fi < F.length; fi++) norm += F[fi] * F[fi];
        norm = Math.sqrt(norm);
        
        if (norm < tolerance) {
            return { solution: x, iterations: iter, converged: true, residual: norm };
        }
        
        xHistory.push(x.slice());
        normHistory.push(norm);
        if (xHistory.length > 3) xHistory.shift();
        if (normHistory.length > 3) normHistory.shift();
        
        // 模块3: Aitken Δ² 加速检测
        // 如果连续3步呈现线性收敛模式，应用加速
        if (xHistory.length === 3 && normHistory.length === 3) {
            // 检查是否线性收敛：|Δnorm| 递减但速度慢（线性收敛特征）
            var d1 = normHistory[1] / normHistory[0];
            var d2 = normHistory[2] / normHistory[1];
            // 线性收敛意味着残差比约等于常数（0.3 < d ≈ d2 < 0.9）
            if (d1 > 0.1 && d1 < 0.95 && d2 > 0.1 && d2 < 0.95 && Math.abs(d1 - d2) < 0.3) {
                var accelerated = aitkenAccelerate(xHistory[0], xHistory[1], xHistory[2]);
                if (accelerated) {
                    var accVars = {};
                    varNames.forEach(function(v, i) { accVars[v] = accelerated[i]; });
                    var accF = equations.map(function(eq) { return evalAST(eq, accVars); });
                    var accNorm = 0;
                    for (var fi = 0; fi < accF.length; fi++) accNorm += accF[fi] * accF[fi];
                    accNorm = Math.sqrt(accNorm);
                    
                    // 如果加速后的残差显著降低，直接采纳加速结果
                    if (accNorm < norm * 0.5 && accNorm < normHistory[0] * 0.5) {
                        x = accelerated;
                        // 重置历史，避免重复加速
                        xHistory = [x.slice()];
                        normHistory = [accNorm];
                        stallCount = 0;
                        if (accNorm < tolerance) {
                            return { solution: x, iterations: iter, converged: true, residual: accNorm };
                        }
                        continue; // 跳过本步的牛顿迭代
                    }
                }
            }
        }
        
        // 数值雅可比矩阵（提前计算：供牛顿步与二阶停滞恢复共用，避免 recovery 分支误用尚未定义的 J）
        var J = [];
        for (var i = 0; i < equations.length; i++) {
            J.push(new Array(n));
            for (var j = 0; j < n; j++) {
                var xP = x.slice();
                xP[j] += eps;
                var vP = {};
                varNames.forEach(function(v, k) { vP[v] = xP[k]; });
                var fp = evalAST(equations[i], vP);
                J[i][j] = (fp - F[i]) / eps;
                if (isNaN(J[i][j]) || !isFinite(J[i][j])) J[i][j] = 0;
            }
        }

        // 模块6: 高阶泰勒极限逼近 — 检测停滞
        // 若连续3步残差无下降，启用 Hessian 二阶近似恢复（J 已就绪）
        if (stallCount >= 3 && n >= 2) {
            // 当前 J 和 F 已计算，尝试 Hessian 近似
            var hessianResult = hessianTaylorApprox(equations, varNames, x, F, J);
            if (hessianResult && hessianResult.step) {
                var hsResult = armijoLineSearch(x, hessianResult.step, equations, varNames, F, -hessianResult.gradNorm);
                var hsAlpha = hsResult.alpha;
                if (hsResult.armijoSatisfied && hsAlpha > 1e-8) {
                    for (var hi = 0; hi < n; hi++) {
                        x[hi] += hsAlpha * hessianResult.step[hi];
                        if (Math.abs(x[hi]) > 1000000) x[hi] = Math.sign(x[hi]) * 1000000;
                    }
                    stallCount = 0;
                    continue;
                }
            }
        }

        // 解 J*dx = -F
        var dx = null;
        if (equations.length === n) {
            var negF = F.map(function(f) { return -f; });
            var result = gaussianSolve(J, negF);
            if (result) dx = result.solution;
        }
        
        if (!dx && equations.length !== n) {
            // 最小二乘（仅超定系统）
            var JT = [];
            for (var j = 0; j < n; j++) {
                JT.push(new Array(equations.length));
                for (var i = 0; i < equations.length; i++) JT[j][i] = J[i][j];
            }
            var JTJ = [];
            for (var i = 0; i < n; i++) {
                JTJ.push(new Array(n));
                for (var j = 0; j < n; j++) {
                    var sum = 0;
                    for (var k = 0; k < equations.length; k++) sum += JT[i][k] * J[k][j];
                    JTJ[i][j] = sum;
                }
            }
            for (var i = 0; i < n; i++) JTJ[i][i] += 1e-10;
            var JTF = new Array(n);
            for (var i = 0; i < n; i++) {
                var sum = 0;
                for (var k = 0; k < equations.length; k++) sum += JT[i][k] * (-F[k]);
                JTF[i] = sum;
            }
            var result = gaussianSolve(JTJ, JTF);
            if (result) dx = result.solution;
        }
        
        if (!dx) {
            return { solution: x, iterations: iter, converged: false, residual: norm, error: '雅可比奇异' };
        }
        
        // 计算梯度·方向乘积（用于Armijo条件）
        var grad_dot_dx = 0;
        for (var i = 0; i < n; i++) {
            var grad_i = 0;
            for (var j = 0; j < equations.length; j++) {
                grad_i += 2 * F[j] * J[j][i];
            }
            grad_dot_dx += grad_i * dx[i];
        }
        
        // Armijo线搜索
        var lsResult = armijoLineSearch(x, dx, equations, varNames, F, grad_dot_dx);
        var alpha = lsResult.alpha;
        
        // 更新前记录旧残差，用于判断是否停滞
        var oldNorm = norm;
        
        for (var i = 0; i < n; i++) {
            x[i] += alpha * dx[i];
            if (Math.abs(x[i]) > 1000000) x[i] = Math.sign(x[i]) * 1000000;
        }
        
        // 如果Armijo失败且步长极小，提前终止
        if (lsResult.armijoFailed && alpha < 1e-10) {
            break;
        }
        
        // 模块3: 迭代收敛极限判定 — 检测停滞/发散/振荡
        // 重新计算更新后的残差
        var newVars = {};
        varNames.forEach(function(v, i) { newVars[v] = x[i]; });
        var newF = equations.map(function(eq) { return evalAST(eq, newVars); });
        var newNorm = 0;
        for (var fi = 0; fi < newF.length; fi++) newNorm += newF[fi] * newF[fi];
        newNorm = Math.sqrt(newNorm);
        
        if (newNorm < oldNorm * 0.999) {
            // 残差下降正常
            stallCount = 0;
        } else if (newNorm > oldNorm * 1.5) {
            // 发散检测 — 残差剧增，放弃当前初值
            if (stallCount >= 2) {
                return { solution: x, iterations: iter, converged: false, residual: newNorm, error: 'diverging' };
            }
            stallCount++;
        } else {
            // 停滞 — 残差无下降
            stallCount++;
        }
    }
    
    var vars = {};
    varNames.forEach(function(v, i) { vars[v] = x[i]; });
    var F = equations.map(function(eq) { return evalAST(eq, vars); });
    var norm = 0;
    for (var fi = 0; fi < F.length; fi++) {
        if (isNaN(F[fi]) || !isFinite(F[fi])) {
            return { solution: x, iterations: maxIter, converged: false, residual: Infinity };
        }
        norm += F[fi] * F[fi];
    }
    norm = Math.sqrt(norm);
    
    return {
        solution: x,
        iterations: maxIter,
        converged: norm < tolerance,
        residual: norm
    };
}


function suan0_classify(state) {
    if (!state || !state.equations || !state.varNames) return;
    var eqs = state.equations, vns = state.varNames;
    var m = eqs.length, n = vns.length;
    state.cardinality = 'unknown';
    state.effectiveDim = -1;
    state.classifyRank = -1;
    state.positiveDim = false;
    state.isPolynomial = _isPolynomialSystem(eqs);

    // 采样点：3 组通用正数种子（避开 log/sqrt 定义域，且非解点）。
    // 取「跨采样点的最大秩」= 通用秩（generic rank），规避奇异位点导致的秩亏误判。
    var seeds = [
        vns.map(function (_, i) { return i + 1; }),
        vns.map(function (_, i) { return 0.7 + i * 0.6; }),
        vns.map(function (_, i) { return [2, 5, 7, 11, 13, 17, 19, 23][i % 7]; })
    ];
    var maxRank = 0;
    for (var si = 0; si < seeds.length; si++) {
        var r = _numericJacobianRank(eqs, vns, seeds[si]);
        if (r > maxRank) maxRank = r;
    }
    state.classifyRank = maxRank;
    var effDim = n - maxRank;
    state.effectiveDim = effDim;

    // 判定（sound-incomplete）
    if (m < n) {
        // 方程少于变量且秩 ≤ m < n ⇒ 有效维 ≥ 1 ⇒ 正维流形 ⇒ 无限（sound）
        state.cardinality = 'infinite';
        state.underdetermined = true;   // 复用既有无限解集分支，跳过无意义的高斯/牛顿硬搜
    } else if (effDim > 0) {
        // 方阵/超定但出现秩亏（独立约束少于变量）⇒ 正维 ⇒ 无限（sound）
        state.cardinality = 'infinite';
        state.positiveDim = true;
    } else if (maxRank >= n) {
        // 满秩 ⇒ 孤立点 ⇒ 有限（局部 sound；全局完备性依赖枚举）
        state.cardinality = 'finite';
    } else {
        state.cardinality = 'unknown';
    }
}
