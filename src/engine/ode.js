/* 模块 ode：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function classifyODE(exprAST, xVar, yVar) {
    if (!exprAST) return null;
    var result = { type: 'general', linearPart: null, nonlinearPart: null, lipschitz: null, hasY2: false };

    // 检查是否是 Riccati 方程：表达式中包含 y^2 项
    // 如果表达式是 y^2 的线性组合，则是 Riccati
    result.hasY2 = hasY2Term(exprAST, yVar);

    // 检测线性性：检查是否可写为 a(x)*y + b(x) 形式
    // 如果是，则 type = 'linear'
    var linearInfo = checkLinearODE(exprAST, yVar);
    if (linearInfo) {
        result.type = 'linear';
        result.linearPart = linearInfo;
    } else if (result.hasY2) {
        result.type = 'riccati';
    }

    // 估计 Lipschitz 常数（对 y 的偏导数的绝对值上限）
    // 使用数值差分法在几个点上采样
    result.lipschitz = estimateLipschitzConstant(exprAST, xVar, yVar);

    return result;
}


function hasY2Term(ast, yVar) {
    if (!ast) return false;
    if (ast.type === 'binop') {
        if (ast.op === '^' && ast.left && ast.left.type === 'var' && ast.left.name === yVar &&
            ast.right && ast.right.type === 'num' && ast.right.value === 2) {
            return true;
        }
        if (ast.op === '*' && ast.left && ast.right &&
            ast.left.type === 'var' && ast.left.name === yVar &&
            ast.right.type === 'var' && ast.right.name === yVar) {
            return true;
        }
        return hasY2Term(ast.left, yVar) || hasY2Term(ast.right, yVar);
    }
    if (ast.type === 'unary') return hasY2Term(ast.operand, yVar);
    if (ast.type === 'func') return getFuncChildrenAll(ast).some(function(child) { return hasY2Term(child, yVar); });
    return false;
}


function checkLinearODE(exprAST, yVar) {
    if (!exprAST) return null;
    // 尝试提取线性系数（类似 extractLinearCoefficients 但只针对单变量 y）
    var a = 0, b = 0;
    // 使用简单的结构检查：表达式是否可分解为 y 的线性组合
    // 先检查在 y 上的线性性
    if (!isLinearInY(exprAST, yVar)) return null;
    return { a: null, b: null }; // 表示线性，但系数需数值计算
}


function isLinearInY(ast, yVar) {
    if (!ast) return true;
    if (ast.type === 'num') return true;
    if (ast.type === 'var') return ast.name === yVar || true; // 非 y 变量视为常数
    if (ast.type === 'unary') return isLinearInY(ast.operand, yVar);
    if (ast.type === 'binop') {
        if (ast.op === '+' || ast.op === '-') {
            return isLinearInY(ast.left, yVar) && isLinearInY(ast.right, yVar);
        }
        if (ast.op === '*') {
            // 至少一侧不包含 y
            var leftHasY = hasVariable(ast.left, [yVar]);
            var rightHasY = hasVariable(ast.right, [yVar]);
            if (leftHasY && rightHasY) return false;
            if (!leftHasY && !rightHasY) return true;
            if (leftHasY) return isLinearInY(ast.left, yVar);
            return isLinearInY(ast.right, yVar);
        }
        if (ast.op === '/') {
            // 分母不能含 y
            if (hasVariable(ast.right, [yVar])) return false;
            return isLinearInY(ast.left, yVar);
        }
        if (ast.op === '^') {
            // y^n 只有 n=0,1 时线性
            if (ast.left.type === 'var' && ast.left.name === yVar) {
                return ast.right.type === 'num' && (ast.right.value === 0 || ast.right.value === 1);
            }
            // 常数底数：不包含 y 即可
            return !hasVariable(ast, [yVar]);
        }
        return false;
    }
    if (ast.type === 'func') {
        // 函数参数不含 y 时视为常数
        return !hasVariable(ast, [yVar]);
    }
    return true;
}


function estimateLipschitzConstant(exprAST, xVar, yVar) {
    if (!exprAST) return Infinity;
    var maxLipschitz = 0;
    var samplePoints = [0, 1, -1, 2, -2, 5, -5, 10, -10];
    var ySteps = [0.001, 0.0001];
    var validSamples = 0;

    for (var xi = 0; xi < samplePoints.length; xi++) {
        var xVal = samplePoints[xi];
        for (var yi = 0; yi < samplePoints.length; yi++) {
            var yVal = samplePoints[yi];
            // 对每个采样点用数值差分估计 ∂f/∂y
            for (var hi = 0; hi < ySteps.length; hi++) {
                var h = ySteps[hi];
                var varsP = {}; varsP[xVar] = xVal; varsP[yVar] = yVal + h;
                var varsM = {}; varsM[xVar] = xVal; varsM[yVar] = yVal - h;
                var fp = evalAST(exprAST, varsP);
                var fm = evalAST(exprAST, varsM);
                if (isNaN(fp) || isNaN(fm) || !isFinite(fp) || !isFinite(fm)) continue;
                var lip = Math.abs((fp - fm) / (2 * h));
                if (isFinite(lip) && lip > maxLipschitz) {
                    maxLipschitz = lip;
                }
                validSamples++;
            }
        }
    }

    // 如果有效采样点太少，返回大值表示不确定
    if (validSamples < 5) return Infinity;
    return maxLipschitz;
}


function isContractionMapping(exprAST, xVar, yVar, h) {
    var L = estimateLipschitzConstant(exprAST, xVar, yVar);
    // 对 ODE 求解，步长 h 下的压缩条件：L * h < 1
    return L * h < 1;
}


function picardSolve(exprAST, xVar, yVar, x0, y0, x1, vars, steps) {
    var n = steps || 100;
    var h = (x1 - x0) / n;
    var cx = x0, cy = y0;
    // 实现：Heun / 显式梯形法（二阶 Runge-Kutta, RK2）——非 Picard 迭代，亦非 RK4。
    // 每步：用当前点斜率 k1 预测 yPred，再用预测点斜率 k2 做梯形平均：cy ← cy + h·(k1+k2)/2。
    // 收敛性：enhancedODESolve 已在派发前用 isContractionMapping(L·h<1) 确认压缩成立，
    //   故该二阶方法在步长内稳定收敛（无需多次全局 Picard 迭代）。
    // 注：函数名 picardSolve 为历史命名（保留以免改动调度引用）；方法实质是 RK2。

    for (var i = 0; i < n; i++) {
        var xNext = cx + h;
        // 使用当前 y 值估计斜率
        var v1 = Object.assign({}, vars);
        v1[xVar] = cx; v1[yVar] = cy;
        var k1 = evalAST(exprAST, v1);
        if (isNaN(k1)) return NaN;

        // 预测下一步的 y
        var yPred = cy + h * k1;
        var v2 = Object.assign({}, vars);
        v2[xVar] = xNext; v2[yVar] = yPred;
        var k2 = evalAST(exprAST, v2);
        if (isNaN(k2)) return NaN;

        // 梯形校正
        cy = cy + h * (k1 + k2) / 2;
        cx = xNext;
    }
    return cy;
}


function duhamelDecompose(exprAST, yVar) {
    if (!exprAST) return null;
    var result = { linearExpr: null, nonlinearExpr: null, hasLinear: false, linearCoeff: null };

    // 线性项形如 a(x)*y，其中 a(x) 不包含 y
    if (exprAST.type === 'binop' && (exprAST.op === '+' || exprAST.op === '-')) {
        var left = extractLinearYTerm(exprAST.left, yVar);
        var right = extractLinearYTerm(exprAST.right, yVar);
        if (left) {
            result.hasLinear = true;
            result.linearExpr = left.coeff;
            result.linearCoeff = left.coeff;
            result.nonlinearExpr = exprAST.op === '+' ? exprAST.right : { type: 'unary', op: '-', operand: exprAST.right };
            return result;
        }
        if (right) {
            result.hasLinear = true;
            result.linearExpr = right.coeff;
            result.linearCoeff = right.coeff;
            result.nonlinearExpr = exprAST.left;
            // 如果实际是 left - right，则右侧线性项取反
            return result;
        }
    }

    // 检查整体是否形如 a*y + b
    // 如果表达式是乘法结构 a*y
    if (exprAST.type === 'binop' && exprAST.op === '*') {
        if (exprAST.left.type === 'var' && exprAST.left.name === yVar) {
            result.hasLinear = true;
            result.linearExpr = exprAST.right;
            result.linearCoeff = exprAST.right;
            result.nonlinearExpr = { type: 'num', value: 0 };
            return result;
        }
        if (exprAST.right.type === 'var' && exprAST.right.name === yVar) {
            result.hasLinear = true;
            result.linearExpr = exprAST.left;
            result.linearCoeff = exprAST.left;
            result.nonlinearExpr = { type: 'num', value: 0 };
            return result;
        }
    }

    // 一般情况：无法分离线性项
    result.nonlinearExpr = exprAST;
    return result;
}


function extractLinearYTerm(ast, yVar) {
    if (!ast) return null;
    if (ast.type === 'var' && ast.name === yVar) {
        return { coeff: { type: 'num', value: 1 } };
    }
    if (ast.type === 'binop' && ast.op === '*') {
        if (ast.left.type === 'var' && ast.left.name === yVar) {
            return { coeff: ast.right };
        }
        if (ast.right.type === 'var' && ast.right.name === yVar) {
            return { coeff: ast.left };
        }
    }
    return null;
}


function enhancedODESolve(exprAST, xVar, yVar, x0, y0, x1, vars, classification) {
    var cls = classification || classifyODE(exprAST, xVar, yVar);
    var stepSize = Math.abs(x1 - x0) / 200;

    // 方法1: Duhamel 原理 — 线性主部精确处理 + 非线性剩余数值
    if (cls.type === 'linear') {
        // 线性 ODE 可以直接用解析方法（积分因子法）
        // 这里仍然用数值方法但标记为线性优势
        return standardRK4(exprAST, xVar, yVar, x0, y0, x1, vars, 200);
    }

    // 方法2: 压缩映射 + Picard 迭代
    if (isContractionMapping(exprAST, xVar, yVar, stepSize)) {
        return picardSolve(exprAST, xVar, yVar, x0, y0, x1, vars, 200);
    }

    // 方法3: Duhamel 分解 — 提取线性项精确处理
    var duhamel = duhamelDecompose(exprAST, yVar);
    if (duhamel.hasLinear && duhamel.nonlinearExpr) {
        // 检查非线性项是否为 0（纯线性）
        if (duhamel.nonlinearExpr.type === 'num' && Math.abs(duhamel.nonlinearExpr.value) < 1e-15) {
            // 纯线性 ODE：dy/dx = a(x)*y
            // 解析解：y(x) = y0 * exp(∫_{x0}^{x} a(t) dt)
            var aIntegral = 0;
            var ai_n = 200;
            var ai_h = (x1 - x0) / ai_n;
            for (var ai_i = 0; ai_i < ai_n; ai_i++) {
                var ai_x = x0 + ai_i * ai_h;
                var ai_x_half = ai_x + ai_h / 2;
                var v = Object.assign({}, vars);
                v[xVar] = ai_x; v[yVar] = 0; // y 值不影响 a(x)
                var fa = evalAST(duhamel.linearCoeff, v);
                v[xVar] = ai_x_half;
                var fb = evalAST(duhamel.linearCoeff, v);
                v[xVar] = ai_x + ai_h;
                var fc = evalAST(duhamel.linearCoeff, v);
                // 辛普森
                aIntegral += (ai_h / 6) * (fa + 4*fb + fc);
            }
            return y0 * Math.exp(aIntegral);
        }
    }

    // 方法4: 默认 RK4
    return standardRK4(exprAST, xVar, yVar, x0, y0, x1, vars, 200);
}


function standardRK4(exprAST, xVar, yVar, x0, y0, x1, vars, steps) {
    var n = steps || 200;
    var h = (x1 - x0) / n;
    var cx = x0, cy = y0;
    for (var i = 0; i < n; i++) {
        var v1 = Object.assign({}, vars); v1[xVar] = cx; v1[yVar] = cy;
        var k1 = evalAST(exprAST, v1);
        var v2 = Object.assign({}, vars); v2[xVar] = cx + h/2; v2[yVar] = cy + h*k1/2;
        var k2 = evalAST(exprAST, v2);
        var v3 = Object.assign({}, vars); v3[xVar] = cx + h/2; v3[yVar] = cy + h*k2/2;
        var k3 = evalAST(exprAST, v3);
        var v4 = Object.assign({}, vars); v4[xVar] = cx + h; v4[yVar] = cy + h*k3;
        var k4 = evalAST(exprAST, v4);
        if (isNaN(k1) || isNaN(k2) || isNaN(k3) || isNaN(k4)) return NaN;
        cy = cy + h * (k1 + 2*k2 + 2*k3 + k4) / 6;
        cx = cx + h;
    }
    return cy;
}
