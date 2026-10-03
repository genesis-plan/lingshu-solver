/* 模块 ast/basic：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function parse(tokens) {
    const parser = new Parser(tokens);
    return parser.parse();
}


function getFuncChildren(node) {
    if (node.args) {
        if (node.name === 'diff' && node.args.length >= 2) {
            // diff(expr, varName) → 跳过 varName
            return [node.args[0]];
        }
        if (node.name === 'int' && node.args.length >= 2) {
            // int(expr, varName, a, b) → 跳过 varName
            return [node.args[0], ...node.args.slice(2)];
        }
        if (node.name === 'ode' && node.args.length >= 3) {
            // ode(expr, xVar, yVar, x0, y0, x1) → 跳过 xVar, yVar
            return [node.args[0], ...node.args.slice(3)];
        }
        if (node.name === 'lim' && node.args.length >= 3) {
            // lim(expr, var, target) → 跳过 var
            var limChildren = [node.args[0], node.args[2]];
            // 如果有方向参数也包含
            if (node.args.length >= 4) limChildren.push(node.args[3]);
            return limChildren;
        }
        return node.args;
    }
    return node.arg ? [node.arg] : [];
}


function getFuncChildrenAll(node) {
    if (node.args) {
        if (node.name === 'diff' && node.args.length >= 2) {
            // diff 的求导变量是局部变量，不应提取
            return [node.args[0]];
        }
        if (node.name === 'int' && node.args.length >= 2) {
            // int 的积分变量是局部变量，不应提取
            return [node.args[0], ...node.args.slice(2)];
        }
        if (node.name === 'ode' && node.args.length >= 3) {
            // ode 的 xVar/yVar 是局部变量，表达式也用局部变量
            // 只从数值参数中提取全局变量
            return node.args.slice(3);
        }
        if (node.name === 'lim' && node.args.length >= 3) {
            // lim 的极限变量是局部变量，不应提取
            var limAllChildren = [node.args[0], node.args[2]];
            if (node.args.length >= 4) limAllChildren.push(node.args[3]);
            return limAllChildren;
        }
        return node.args;
    }
    return node.arg ? [node.arg] : [];
}


function gammaLanczos(z) {
    if (z < 0.5) {
        // 反射公式
        return Math.PI / (Math.sin(Math.PI * z) * gammaLanczos(1 - z));
    }
    z -= 1;
    var g = 7;
    var c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
             771.32342877765313, -176.61502916214059, 12.507343278686905,
             -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    var x = c[0];
    for (var i = 1; i < g + 2; i++) {
        x += c[i] / (z + i);
    }
    var t = z + g + 0.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}


function evalAST(node, vars) {
    if (!node) return NaN;

    switch (node.type) {
        case 'num':
            return node.value;

        case 'var':
            if (vars[node.name] === undefined) {
                return NaN;
            }
            return vars[node.name];

        case 'binop': {
            const left = evalAST(node.left, vars);
            const right = evalAST(node.right, vars);
            switch (node.op) {
                case '+': return left + right;
                case '-': return left - right;
                case '*': return left * right;
                case '/':
                    if (Math.abs(right) < 1e-300) return NaN;
                    return left / right;
                case '^':
                    return Math.pow(left, right);
                default: return NaN;
            }
        }

        case 'unary': {
            const val = evalAST(node.operand, vars);
            if (node.op === '-') return -val;
            return val;
        }

        case 'func': {
            // 多参数函数：diff（导数）和 int（积分）
            if (node.args) {
                switch (node.name) {
                    case 'diff': {
                        // diff(expr, varName) — 中心差分法数值导数
                        // 在当前 varName 值处计算 d(expr)/d(varName)
                        if (node.args.length < 2) return NaN;
                        const varName = node.args[1].name;
                        if (!varName) return NaN;
                        const x0 = vars[varName];
                        if (x0 === undefined || !isFinite(x0)) return NaN;
                        const h = 1e-6;
                        const varsP = Object.assign({}, vars);
                        const varsM = Object.assign({}, vars);
                        varsP[varName] = x0 + h;
                        varsM[varName] = x0 - h;
                        const fp = evalAST(node.args[0], varsP);
                        const fm = evalAST(node.args[0], varsM);
                        if (isNaN(fp) || isNaN(fm)) return NaN;
                        return (fp - fm) / (2 * h);
                    }
                    case 'int': {
                        // int(expr, varName, a, b) — 复合辛普森积分
                        // 计算 ∫[a,b] expr d(varName)
                        if (node.args.length < 4) return NaN;
                        const varName = node.args[1].name;
                        if (!varName) return NaN;
                        const a = evalAST(node.args[2], vars);
                        const b = evalAST(node.args[3], vars);
                        if (isNaN(a) || isNaN(b) || !isFinite(a) || !isFinite(b)) return NaN;
                        const n = 100; // 偶数区间数
                        const hh = (b - a) / n;
                        let sum = 0;
                        for (let k = 0; k <= n; k++) {
                            const xk = a + k * hh;
                            const vk = Object.assign({}, vars);
                            vk[varName] = xk;
                            const fk = evalAST(node.args[0], vk);
                            if (isNaN(fk)) return NaN;
                            if (k === 0 || k === n) {
                                sum += fk;
                            } else if (k % 2 === 1) {
                                sum += 4 * fk;
                            } else {
                                sum += 2 * fk;
                            }
                        }
                        return (hh / 3) * sum;
                    }
                    case 'ode': {
                        // ode(expr, xVar, yVar, x0, y0, x1)
                        // 求解一阶常微分方程 dy/dx = expr, y(x0) = y0, 返回 y(x1)
                        if (node.args.length < 6) return NaN;
                        var xVarName = node.args[1].name;
                        var yVarName = node.args[2].name;
                        if (!xVarName || !yVarName) return NaN;
                        var ox0 = evalAST(node.args[3], vars);
                        var oy0 = evalAST(node.args[4], vars);
                        var ox1 = evalAST(node.args[5], vars);
                        if (isNaN(ox0) || isNaN(oy0) || isNaN(ox1)) return NaN;
                        if (!isFinite(ox0) || !isFinite(oy0) || !isFinite(ox1)) return NaN;
                        return enhancedODESolve(node.args[0], xVarName, yVarName, ox0, oy0, ox1, vars, null);
                    }
                    case 'lim': {
                        // lim(expr, var, target) — 数值极限
                        // lim(expr, var, target, dir) — 方向极限：1=左, -1=右
                        // 例：lim(sin(x)/x, x, 0) → 1
                        // 例：lim(1/x, x, 0, 1) → +∞,  lim(1/x, x, 0, -1) → -∞
                        if (node.args.length < 3) return NaN;
                        var limVarName = node.args[1].name;
                        if (!limVarName) return NaN;
                        var limTarget = evalAST(node.args[2], vars);
                        if (isNaN(limTarget) || !isFinite(limTarget)) return NaN;
                        var limDir = 0; // 0=双侧, 1=左, -1=右
                        if (node.args.length >= 4) {
                            var dirVal = evalAST(node.args[3], vars);
                            if (!isNaN(dirVal) && isFinite(dirVal)) {
                                limDir = dirVal > 0 ? 1 : -1;
                            }
                        }
                        return evalLimit(node.args[0], limVarName, limTarget, limDir, vars);
                    }
                    case 'mod': {
                        // mod(a, b) — 取模（正数模）
                        if (node.args.length < 2) return NaN;
                        const a = evalAST(node.args[0], vars);
                        const b = evalAST(node.args[1], vars);
                        if (isNaN(a) || isNaN(b) || Math.abs(b) < 1e-300) return NaN;
                        return ((a % b) + b) % b;
                    }
                    default: return NaN;
                }
            }
            // 单参数函数（原有逻辑）
            const arg = evalAST(node.arg, vars);
            switch (node.name) {
                case 'sin': return Math.sin(arg);
                case 'cos': return Math.cos(arg);
                case 'tan': return Math.tan(arg);
                case 'ln': return Math.log(arg);
                case 'exp': return Math.exp(arg);
                case 'sqrt':
                    if (arg < 0) return NaN;
                    return Math.sqrt(arg);
                case 'log': return Math.log10(arg);
                case 'abs': return Math.abs(arg);
                case 'cot': {
                    const t = Math.tan(arg);
                    if (Math.abs(t) < 1e-300) return NaN;
                    return 1 / t;
                }
                case 'sec': {
                    const c = Math.cos(arg);
                    if (Math.abs(c) < 1e-300) return NaN;
                    return 1 / c;
                }
                case 'csc': {
                    const s = Math.sin(arg);
                    if (Math.abs(s) < 1e-300) return NaN;
                    return 1 / s;
                }
                case 'arcsin': return Math.asin(arg);
                case 'arccos': return Math.acos(arg);
                case 'arctan': return Math.atan(arg);
                case 'sinh': return Math.sinh(arg);
                case 'cosh': return Math.cosh(arg);
                case 'tanh': return Math.tanh(arg);
                case 'floor': return Math.floor(arg);
                case 'ceil': return Math.ceil(arg);
                case 'gamma': return gammaLanczos(arg);
                case 'log2': return Math.log2(arg);
                case 'log10': return Math.log10(arg);
                default: return NaN;
            }
        }

        default:
            return NaN;
    }
}


function evalLimit(expr, varName, target, direction, vars) {
    // 策略1: 短路检测 — 已知极限模式
    // 这些模式在极限计算中频繁出现，且数值逼近精度有限
    function detectLimitPattern(expr, varName, target) {
        // 检查是否为 sin(x)/x 形式，x→0
        // 数学：lim_{x→0} sin(x)/x = 1
        if (expr.type === 'binop' && expr.op === '/') {
            // sin(var)/var 模式
            if (expr.left.type === 'func' && expr.left.name === 'sin' &&
                expr.right.type === 'var' && expr.right.name === varName &&
                expr.left.arg && expr.left.arg.type === 'var' && expr.left.arg.name === varName) {
                // 确认 target 为 0
                if (Math.abs(target) < 1e-10) return 1.0;
            }
            // var/sin(var) 模式（倒数）
            if (expr.left.type === 'var' && expr.left.name === varName &&
                expr.right.type === 'func' && expr.right.name === 'sin' &&
                expr.right.arg && expr.right.arg.type === 'var' && expr.right.arg.name === varName) {
                if (Math.abs(target) < 1e-10) return 1.0;
            }
            // tan(var)/var 模式，x→0
            if (expr.left.type === 'func' && expr.left.name === 'tan' &&
                expr.right.type === 'var' && expr.right.name === varName &&
                expr.left.arg && expr.left.arg.type === 'var' && expr.left.arg.name === varName) {
                if (Math.abs(target) < 1e-10) return 1.0;
            }
            // (1-cos(var))/var² 模式，x→0
            if (expr.left.type === 'binop' && expr.left.op === '-' &&
                expr.left.left.type === 'num' && Math.abs(expr.left.left.value - 1) < 1e-10 &&
                expr.left.right.type === 'func' && expr.left.right.name === 'cos' &&
                expr.left.right.arg && expr.left.right.arg.type === 'var' && expr.left.right.arg.name === varName &&
                expr.right.type === 'binop' && expr.right.op === '^' &&
                expr.right.left.type === 'var' && expr.right.left.name === varName &&
                expr.right.right.type === 'num' && Math.abs(expr.right.right.value - 2) < 1e-10) {
                if (Math.abs(target) < 1e-10) return 0.5;
            }
            // ln(1+var)/var 模式，x→0
            if (expr.left.type === 'func' && expr.left.name === 'ln' &&
                expr.left.arg && expr.left.arg.type === 'binop' && expr.left.arg.op === '+' &&
                expr.left.arg.left.type === 'num' && Math.abs(expr.left.arg.left.value - 1) < 1e-10 &&
                expr.left.arg.right.type === 'var' && expr.left.arg.right.name === varName &&
                expr.right.type === 'var' && expr.right.name === varName) {
                if (Math.abs(target) < 1e-10) return 1.0;
            }
            // (exp(var)-1)/var 模式，x→0
            if (expr.left.type === 'binop' && expr.left.op === '-' &&
                expr.left.left.type === 'func' && expr.left.left.name === 'exp' &&
                expr.left.left.arg && expr.left.left.arg.type === 'var' && expr.left.left.arg.name === varName &&
                expr.left.right.type === 'num' && Math.abs(expr.left.right.value - 1) < 1e-10 &&
                expr.right.type === 'var' && expr.right.name === varName) {
                if (Math.abs(target) < 1e-10) return 1.0;
            }
        }
        // (1+var)^(1/var) 模式，x→0 → e
        if (expr.type === 'binop' && expr.op === '^' &&
            expr.left.type === 'binop' && expr.left.op === '+' &&
            expr.left.left.type === 'num' && Math.abs(expr.left.left.value - 1) < 1e-10 &&
            expr.left.right.type === 'var' && expr.left.right.name === varName &&
            expr.right.type === 'binop' && expr.right.op === '/' &&
            expr.right.left.type === 'num' && Math.abs(expr.right.left.value - 1) < 1e-10 &&
            expr.right.right.type === 'var' && expr.right.right.name === varName) {
            if (Math.abs(target) < 1e-10) return Math.E;
        }
        return null;
    }
    
    var patternResult = detectLimitPattern(expr, varName, target);
    if (patternResult !== null) return patternResult;

    // 策略2: 直接代入 — 若函数在目标点连续，直接求值
    var subVars = Object.assign({}, vars);
    subVars[varName] = target;
    var directVal = evalAST(expr, subVars);
    if (isFinite(directVal) && !isNaN(directVal)) return directVal;

    // 策略3: L'Hôpital法则 — 分子分母同时求导后再求极限
    // 严格仅当 0/0 或 ∞/∞ 不定式时适用
    // 使用现有 diff 函数计算导数
    // 仅当表达式为 f(x)/g(x) 形式时适用
    if (expr.type === 'binop' && expr.op === '/') {
        // 先检查是否为 0/0 或 ∞/∞ 不定式
        var numAtTarget = evalAST(expr.left, subVars);
        var denAtTarget = evalAST(expr.right, subVars);
        var is00Form = (Math.abs(numAtTarget) < 1e-10 || !isFinite(numAtTarget)) && 
                       (Math.abs(denAtTarget) < 1e-10 || !isFinite(denAtTarget));
        var isInfInfForm = (!isFinite(numAtTarget) || Math.abs(numAtTarget) > 1e15) && 
                           (!isFinite(denAtTarget) || Math.abs(denAtTarget) > 1e15);
        if (is00Form || isInfInfForm) {
            var numDiff = { type: 'func', name: 'diff', args: [expr.left, { type: 'var', name: varName }] };
            var denDiff = { type: 'func', name: 'diff', args: [expr.right, { type: 'var', name: varName }] };
            var numPrime = evalAST(numDiff, subVars);
            var denPrime = evalAST(denDiff, subVars);
            if (isFinite(numPrime) && isFinite(denPrime) && Math.abs(denPrime) > 1e-15) {
                return numPrime / denPrime;
            }
            // 如果一阶导仍为0/0，尝试二阶导
            if (isFinite(numPrime) && isFinite(denPrime) && Math.abs(denPrime) < 1e-15 && Math.abs(numPrime) < 1e-15) {
                var numDiff2 = { type: 'func', name: 'diff', args: [numDiff, { type: 'var', name: varName }] };
                var denDiff2 = { type: 'func', name: 'diff', args: [denDiff, { type: 'var', name: varName }] };
                var numPrime2 = evalAST(numDiff2, subVars);
                var denPrime2 = evalAST(denDiff2, subVars);
                if (isFinite(numPrime2) && isFinite(denPrime2) && Math.abs(denPrime2) > 1e-15) {
                    return numPrime2 / denPrime2;
                }
            }
        }
    }

    // 策略4: 数值逼近 — 双侧逼近 + Richardson外推
    // 使用固定衰减序列 h_k = 10^{-k}，k=1..8
    // direction: 0=双侧, 1=左极限(从左侧趋近, x=target-h), -1=右极限(从右侧趋近, x=target+h)
    var hValues = [1e-1, 1e-2, 1e-3, 1e-4, 1e-5, 1e-6, 1e-7, 1e-8];
    var leftVals = [], rightVals = [];
    var approachLeft = (direction === 1 || direction === 0);
    var approachRight = (direction === -1 || direction === 0);
    
    for (var hi = 0; hi < hValues.length; hi++) {
        var h = hValues[hi];
        // 左逼近（从左侧接近目标：x = target - h）
        if (approachLeft && target - h > -1e6) {
            var lv = Object.assign({}, vars);
            lv[varName] = target - h;
            var lVal = evalAST(expr, lv);
            if (isFinite(lVal) && !isNaN(lVal)) leftVals.push(lVal);
        }
        // 右逼近（从右侧接近目标：x = target + h）
        if (approachRight && target + h < 1e6) {
            var rv = Object.assign({}, vars);
            rv[varName] = target + h;
            var rVal = evalAST(expr, rv);
            if (isFinite(rVal) && !isNaN(rVal)) rightVals.push(rVal);
        }
    }

    // 估算极限值
    // 双侧极限（direction === 0）：左右均值
    if (leftVals.length > 0 && rightVals.length > 0 && direction === 0) {
        var lLast = leftVals[leftVals.length - 1];
        var rLast = rightVals[rightVals.length - 1];
        var avg = (lLast + rLast) / 2;
        if (leftVals.length >= 3 && rightVals.length >= 3) {
            var lDiff = Math.abs(leftVals[leftVals.length - 1] - leftVals[leftVals.length - 2]);
            var rDiff = Math.abs(rightVals[rightVals.length - 1] - rightVals[rightVals.length - 2]);
            if (lDiff < 1e-6 && rDiff < 1e-6) return avg;
            if (leftVals.length >= 4 && rightVals.length >= 4) {
                var lExtrap = (4 * leftVals[leftVals.length - 1] - leftVals[leftVals.length - 2]) / 3;
                var rExtrap = (4 * rightVals[rightVals.length - 1] - rightVals[rightVals.length - 2]) / 3;
                return (lExtrap + rExtrap) / 2;
            }
            return avg;
        }
        return avg;
    }
    // 左极限（direction === 1，仅从左侧逼近）
    if (leftVals.length > 0 && direction === 1 && rightVals.length === 0) {
        if (leftVals.length >= 3) {
            var lDiff = Math.abs(leftVals[leftVals.length - 1] - leftVals[leftVals.length - 2]);
            if (lDiff < 1e-6) return leftVals[leftVals.length - 1];
            if (leftVals.length >= 4) {
                return (4 * leftVals[leftVals.length - 1] - leftVals[leftVals.length - 2]) / 3;
            }
        }
        return leftVals[leftVals.length - 1];
    }
    // 右极限（direction === -1，仅从右侧逼近）
    if (rightVals.length > 0 && direction === -1 && leftVals.length === 0) {
        if (rightVals.length >= 3) {
            var rDiff = Math.abs(rightVals[rightVals.length - 1] - rightVals[rightVals.length - 2]);
            if (rDiff < 1e-6) return rightVals[rightVals.length - 1];
            if (rightVals.length >= 4) {
                return (4 * rightVals[rightVals.length - 1] - rightVals[rightVals.length - 2]) / 3;
            }
        }
        return rightVals[rightVals.length - 1];
    }

    // 所有策略失败，返回 NaN
    return NaN;
}


function aitkenAccelerate(x0, x1, x2) {
    if (x0.length !== x1.length || x1.length !== x2.length) return null;
    var n = x0.length;
    
    var dx1 = new Array(n);
    var dx2 = new Array(n);
    var ddx = new Array(n);
    var result = new Array(n);
    
    for (var i = 0; i < n; i++) {
        dx1[i] = x1[i] - x0[i];
        dx2[i] = x2[i] - x1[i];
        ddx[i] = dx2[i] - dx1[i];
    }
    
    // 检查是否满足线性收敛条件：|Δ²x| < |Δx| 且 Δ²x 与 Δx 同号（近似线性）
    var validCount = 0;
    for (var i = 0; i < n; i++) {
        if (Math.abs(ddx[i]) > 1e-15 && Math.abs(ddx[i]) < Math.abs(dx1[i]) * 10) {
            // 应用 Aitken 加速：x* = x_k - (Δx_k)² / Δ²x_k
            result[i] = x2[i] - (dx2[i] * dx2[i]) / ddx[i];
            validCount++;
        } else {
            result[i] = x2[i]; // 不加速，保持原值
        }
    }
    
    // 至少一半的变量满足加速条件才返回加速结果
    if (validCount >= n / 2) {
        return result;
    }
    return null;
}


function hessianTaylorApprox(equations, varNames, x, F, J) {
    var n = varNames.length;
    var m = equations.length;
    if (n < 2 || m < 1) return null;
    
    var eps = 1e-6;
    
    var norm = 0;
    for (var fi = 0; fi < F.length; fi++) norm += F[fi] * F[fi];
    norm = Math.sqrt(norm);
    if (norm < 1e-10) return null; // 已经收敛，不需要
    
    // 构造目标函数 g(x) = ½||F(x)||² 的梯度
    var grad = new Array(n);
    for (var j = 0; j < n; j++) {
        grad[j] = 0;
        for (var i = 0; i < m; i++) {
            grad[j] += F[i] * J[i][j];
        }
    }
    
    // 近似Hessian: H ≈ JᵀJ + Σ F_i · H_i（忽略二阶项，仅用JᵀJ近似）
    // 这是 Gauss-Newton 近似，在残差较小时足够精确
    var H = [];
    for (var i = 0; i < n; i++) {
        H.push(new Array(n));
        for (var j = 0; j < n; j++) {
            var sum = 0;
            for (var k = 0; k < m; k++) {
                sum += J[k][i] * J[k][j];
            }
            H[i][j] = sum;
        }
        // 添加正则化项
        H[i][i] += 1e-8;
    }
    
    // 添加部分二阶项（仅对角线，用有限差分估算）
    for (var j = 0; j < n; j++) {
        var xP = x.slice();
        xP[j] += eps;
        var vP = {};
        varNames.forEach(function(v, k) { vP[v] = xP[k]; });
        var FP = equations.map(function(eq) { return evalAST(eq, vP); });
        
        var xM = x.slice();
        xM[j] -= eps;
        var vM = {};
        varNames.forEach(function(v, k) { vM[v] = xM[k]; });
        var FM = equations.map(function(eq) { return evalAST(eq, vM); });
        
        for (var i = 0; i < m; i++) {
            // 二阶导数（中心差分）
            var d2 = (FP[i] - 2 * F[i] + FM[i]) / (eps * eps);
            if (isFinite(d2) && !isNaN(d2)) {
                H[j][j] += F[i] * d2;
            }
        }
    }
    
    // 求解 H·Δx = -grad
    var negGrad = grad.map(function(g) { return -g; });
    var result = gaussianSolve(H, negGrad);
    if (!result) {
        // 如果H奇异，加更大正则化
        for (var i = 0; i < n; i++) H[i][i] += 1e-4;
        result = gaussianSolve(H, negGrad);
    }
    
    if (result) {
        // 对步长做阻尼（二阶步长通常较大）
        var step = result.solution;
        var stepNorm = 0;
        for (var i = 0; i < n; i++) stepNorm += step[i] * step[i];
        stepNorm = Math.sqrt(stepNorm);
        
        var maxStep = 1.0;
        if (stepNorm > maxStep) {
            for (var i = 0; i < n; i++) step[i] *= maxStep / stepNorm;
        }
        
        return {
            step: step,
            method: 'hessian_taylor',
            gradNorm: Math.sqrt(grad.reduce(function(s, g) { return s + g*g; }, 0))
        };
    }
    
    return null;
}


function matrixDeterminant(M) {
    var n = M.length;
    if (n === 0) return 0;
    // 检查是否为方阵
    if (n !== M[0].length) return NaN;
    if (n === 1) return M[0][0];
    if (n === 2) return M[0][0] * M[1][1] - M[0][1] * M[1][0];
    
    // 复制矩阵
    var A = [];
    for (var i = 0; i < n; i++) {
        A.push(M[i].slice());
    }
    
    var det = 1;
    var sign = 1;
    
    for (var col = 0; col < n; col++) {
        // 寻找主元
        var maxRow = col;
        var maxVal = Math.abs(A[col][col]);
        for (var row = col + 1; row < n; row++) {
            if (Math.abs(A[row][col]) > maxVal) {
                maxVal = Math.abs(A[row][col]);
                maxRow = row;
            }
        }
        if (maxVal < 1e-15) return 0;
        
        if (maxRow !== col) {
            // 交换行
            var temp = A[col];
            A[col] = A[maxRow];
            A[maxRow] = temp;
            sign = -sign;
        }
        
        det *= A[col][col];
        
        // 消元
        for (var row = col + 1; row < n; row++) {
            var factor = A[row][col] / A[col][col];
            for (var j = col; j < n; j++) {
                A[row][j] -= factor * A[col][j];
            }
        }
    }
    
    return sign * det;
}


function extractVariables(node) {
    const vars = new Set();
    const funcs = ['sin', 'cos', 'tan', 'ln', 'exp', 'sqrt', 'log', 'abs', 'diff', 'int', 'ode', 'lim',
                  'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
                  'floor', 'ceil', 'gamma', 'log2', 'mod'];

    function walk(n) {
        if (!n) return;
        if (n.type === 'var') {
            vars.add(n.name);
        } else if (n.type === 'binop') {
            walk(n.left);
            walk(n.right);
        } else if (n.type === 'unary') {
            walk(n.operand);
        } else if (n.type === 'func') {
            // 多参数函数：遍历所有子节点（int 跳过积分变量名）
            var children = getFuncChildrenAll(n);
            if (n.name === 'int' && n.args && n.args.length >= 2) {
                // int 的积分变量是局部变量，遍历子节点时排除它
                var localVar = n.args[1].name;
                if (localVar) {
                    children.forEach(function(child) {
                        walkSkippingVar(child, localVar);
                    });
                } else {
                    children.forEach(function(child) { walk(child); });
                }
            } else {
                children.forEach(function(child) { walk(child); });
            }
        }
    }

    function walkSkippingVar(n, skipVar) {
        if (!n) return;
        if (n.type === 'var') {
            if (n.name !== skipVar) vars.add(n.name);
        } else if (n.type === 'binop') {
            walkSkippingVar(n.left, skipVar);
            walkSkippingVar(n.right, skipVar);
        } else if (n.type === 'unary') {
            walkSkippingVar(n.operand, skipVar);
        } else if (n.type === 'func') {
            // 对嵌套函数同样处理：如果内部也有局部变量，继续传递
            var ch = getFuncChildrenAll(n);
            if (n.name === 'int' && n.args && n.args.length >= 2) {
                var innerLocal = n.args[1].name;
                if (innerLocal) {
                    ch.forEach(function(c) { walkSkippingVarWithTwo(c, skipVar, innerLocal); });
                } else {
                    ch.forEach(function(c) { walkSkippingVar(c, skipVar); });
                }
            } else if (n.name === 'diff' && n.args && n.args.length >= 2) {
                var diffVar = n.args[1].name;
                if (diffVar) {
                    ch.forEach(function(c) { walkSkippingVarWithTwo(c, skipVar, diffVar); });
                } else {
                    ch.forEach(function(c) { walkSkippingVar(c, skipVar); });
                }
            } else {
                ch.forEach(function(c) { walkSkippingVar(c, skipVar); });
            }
        }
    }

    function walkSkippingVarWithTwo(n, skipVar1, skipVar2) {
        if (!n) return;
        if (n.type === 'var') {
            if (n.name !== skipVar1 && n.name !== skipVar2) vars.add(n.name);
        } else if (n.type === 'binop') {
            walkSkippingVarWithTwo(n.left, skipVar1, skipVar2);
            walkSkippingVarWithTwo(n.right, skipVar1, skipVar2);
        } else if (n.type === 'unary') {
            walkSkippingVarWithTwo(n.operand, skipVar1, skipVar2);
        } else if (n.type === 'func') {
            var ch = getFuncChildrenAll(n);
            ch.forEach(function(c) { walkSkippingVarWithTwo(c, skipVar1, skipVar2); });
        }
    }

    walk(node);
    return Array.from(vars);
}


function decomposeByVariableGraph(equations, varNames) {
    var n = equations.length;
    if (n <= 1) return null;
    
    // 提取每个方程涉及的变量
    var eqVarList = [];
    for (var i = 0; i < n; i++) {
        eqVarList.push(extractVariables(equations[i]));
    }
    
    // 构建邻接图：方程i和j共享变量则相连
    var adj = new Array(n);
    for (var i = 0; i < n; i++) adj[i] = [];
    for (var i = 0; i < n; i++) {
        var viSet = eqVarList[i];
        for (var j = i + 1; j < n; j++) {
            var vjSet = eqVarList[j];
            // 检查是否共享变量
            var shared = false;
            for (var vi = 0; vi < viSet.length && !shared; vi++) {
                if (vjSet.indexOf(viSet[vi]) >= 0) shared = true;
            }
            if (shared) {
                adj[i].push(j);
                adj[j].push(i);
            }
        }
    }
    
    // BFS寻找连通分量
    var visited = new Array(n);
    for (var i = 0; i < n; i++) visited[i] = false;
    var components = [];
    for (var i = 0; i < n; i++) {
        if (visited[i]) continue;
        var comp = [];
        var queue = [i];
        visited[i] = true;
        while (queue.length > 0) {
            var node = queue.shift();
            comp.push(node);
            for (var ni = 0; ni < adj[node].length; ni++) {
                var nb = adj[node][ni];
                if (!visited[nb]) {
                    visited[nb] = true;
                    queue.push(nb);
                }
            }
        }
        components.push(comp);
    }
    
    if (components.length <= 1) return null; // 只有一个分量，无需分解
    
    // 构建每个分量的方程和变量列表
    var result = [];
    for (var ci = 0; ci < components.length; ci++) {
        var compEqs = [];
        for (var ei = 0; ei < components[ci].length; ei++) {
            compEqs.push(equations[components[ci][ei]]);
        }
        var compVars = [];
        var varSet = {};
        for (var ei = 0; ei < compEqs.length; ei++) {
            var vars = extractVariables(compEqs[ei]);
            for (var vi = 0; vi < vars.length; vi++) {
                if (!varSet[vars[vi]]) {
                    varSet[vars[vi]] = true;
                    compVars.push(vars[vi]);
                }
            }
        }
        // 只保留在 varNames 中的变量
        var filteredVars = [];
        for (var vi = 0; vi < compVars.length; vi++) {
            if (varNames.indexOf(compVars[vi]) >= 0) {
                filteredVars.push(compVars[vi]);
            }
        }
        result.push({
            equations: compEqs,
            variables: filteredVars,
            eqCount: compEqs.length,
            varCount: filteredVars.length
        });
    }
    
    return result;
}


function hasVariable(node, varNames) {
    if (!node) return false;
    if (node.type === 'var') {
        return varNames.includes(node.name);
    }
    if (node.type === 'num') {
        return false;
    }
    if (node.type === 'binop') {
        return hasVariable(node.left, varNames) || hasVariable(node.right, varNames);
    }
    if (node.type === 'unary') {
        return hasVariable(node.operand, varNames);
    }
    if (node.type === 'func') {
        return getFuncChildrenAll(node).some(function(child) { return hasVariable(child, varNames); });
    }
    return false;
}


function isLinear(node, varNames) {
    if (!node) return true;

    switch (node.type) {
        case 'num':
            return true;

        case 'var':
            return varNames.includes(node.name);

        case 'unary':
            return isLinear(node.operand, varNames);

        case 'binop':
            if (node.op === '+' || node.op === '-') {
                return isLinear(node.left, varNames) && isLinear(node.right, varNames);
            }
            if (node.op === '*') {
                // 至少一侧不含任何变量（常数乘法）
                const leftHasVar = hasVariable(node.left, varNames);
                const rightHasVar = hasVariable(node.right, varNames);
                if (leftHasVar && rightHasVar) return false;
                if (!leftHasVar && !rightHasVar) return true;
                // 一侧有变量，检查那一侧是否线性
                if (leftHasVar) return isLinear(node.left, varNames);
                return isLinear(node.right, varNames);
            }
            if (node.op === '/') {
                // 右子树不含变量，左子树线性
                if (hasVariable(node.right, varNames)) return false;
                return isLinear(node.left, varNames);
            }
            if (node.op === '^') {
                // 仅允许 var^1 或 常数^常数
                if (node.left.type === 'var' && node.right.type === 'num') {
                    return node.right.value === 1;
                }
                if (!hasVariable(node.left, varNames) && !hasVariable(node.right, varNames)) {
                    return true;
                }
                return false;
            }
            return false;

        case 'func':
            // 微积分函数含变量时非线性；普通函数参数不含变量时为常数（线性）
            return !getFuncChildrenAll(node).some(function(child) { return hasVariable(child, varNames); });

        default:
            return false;
    }
}


function extractLinearCoefficients(node, varNames) {
    const coeffs = {};
    varNames.forEach(v => coeffs[v] = 0);
    let constant = 0;

    function isConstantExpr(n) {
        return !hasVariable(n, varNames);
    }

    function evalConstant(n) {
        return evalAST(n, {});
    }

    function walk(n, sign) {
        if (!n) return;

        if (n.type === 'num') {
            constant += sign * n.value;
            return;
        }

        if (n.type === 'var') {
            if (coeffs[n.name] !== undefined) {
                coeffs[n.name] += sign * 1;
            }
            return;
        }

        if (n.type === 'unary') {
            walk(n.operand, -sign);
            return;
        }

        if (n.type === 'binop') {
            if (n.op === '+') {
                walk(n.left, sign);
                walk(n.right, sign);
                return;
            }
            if (n.op === '-') {
                walk(n.left, sign);
                walk(n.right, -sign);
                return;
            }
            if (n.op === '*') {
                // 一侧是常数
                if (isConstantExpr(n.left)) {
                    const c = evalConstant(n.left);
                    if (n.right.type === 'var' && coeffs[n.right.name] !== undefined) {
                        coeffs[n.right.name] += sign * c;
                    } else {
                        // 常数乘以更复杂的线性表达式
                        walk(n.right, sign * c);
                    }
                    return;
                }
                if (isConstantExpr(n.right)) {
                    const c = evalConstant(n.right);
                    if (n.left.type === 'var' && coeffs[n.left.name] !== undefined) {
                        coeffs[n.left.name] += sign * c;
                    } else {
                        walk(n.left, sign * c);
                    }
                    return;
                }
                return;
            }
            if (n.op === '/') {
                // 右子树是常数
                if (isConstantExpr(n.right)) {
                    const c = evalConstant(n.right);
                    if (c === 0) return;
                    if (n.left.type === 'var' && coeffs[n.left.name] !== undefined) {
                        coeffs[n.left.name] += sign * (1 / c);
                    } else {
                        walk(n.left, sign * (1 / c));
                    }
                    return;
                }
                return;
            }
            if (n.op === '^') {
                // 常数幂运算（如 2^10, 1.05^10）
                if (isConstantExpr(n)) {
                    constant += sign * evalConstant(n);
                }
                return;
            }
            return;
        }

        if (n.type === 'func') {
            // 常数函数调用（含微积分函数：如果所有子表达式都不含变量，则为常数）
            var allConst = getFuncChildrenAll(n).every(function(child) { return !hasVariable(child, varNames); });
            if (allConst) {
                constant += sign * evalConstant(n);
            }
            return;
        }
    }

    walk(node, 1);
    return { coeffs: coeffs, constant: constant };
}


function extractVarCoefficient(node, varName) {
    if (!hasVariable(node, [varName])) {
        return { coeff: { type: 'num', value: 0 }, rest: node };
    }

    if (node.type === 'var' && node.name === varName) {
        return { coeff: { type: 'num', value: 1 }, rest: { type: 'num', value: 0 } };
    }

    if (node.type === 'unary' && node.op === '-') {
        const inner = extractVarCoefficient(node.operand, varName);
        if (!inner) return null;
        return {
            coeff: { type: 'unary', op: '-', operand: inner.coeff },
            rest: { type: 'unary', op: '-', operand: inner.rest }
        };
    }

    if (node.type === 'binop') {
        if (node.op === '+' || node.op === '-') {
            const l = extractVarCoefficient(node.left, varName);
            const r = extractVarCoefficient(node.right, varName);
            if (!l || !r) return null;
            if (node.op === '+') {
                return {
                    coeff: { type: 'binop', op: '+', left: l.coeff, right: r.coeff },
                    rest: { type: 'binop', op: '+', left: l.rest, right: r.rest }
                };
            } else {
                return {
                    coeff: { type: 'binop', op: '-', left: l.coeff, right: r.coeff },
                    rest: { type: 'binop', op: '-', left: l.rest, right: r.rest }
                };
            }
        }
        if (node.op === '*') {
            if (!hasVariable(node.left, [varName])) {
                const r = extractVarCoefficient(node.right, varName);
                if (!r) return null;
                return {
                    coeff: { type: 'binop', op: '*', left: node.left, right: r.coeff },
                    rest: { type: 'binop', op: '*', left: node.left, right: r.rest }
                };
            }
            if (!hasVariable(node.right, [varName])) {
                const l = extractVarCoefficient(node.left, varName);
                if (!l) return null;
                return {
                    coeff: { type: 'binop', op: '*', left: l.coeff, right: node.right },
                    rest: { type: 'binop', op: '*', left: l.rest, right: node.right }
                };
            }
            return null; // 两侧都含变量 → 非线性
        }
        if (node.op === '/') {
            if (hasVariable(node.right, [varName])) return null;
            const l = extractVarCoefficient(node.left, varName);
            if (!l) return null;
            return {
                coeff: { type: 'binop', op: '/', left: l.coeff, right: node.right },
                rest: { type: 'binop', op: '/', left: l.rest, right: node.right }
            };
        }
        if (node.op === '^') {
            if (node.left.type === 'var' && node.left.name === varName &&
                node.right.type === 'num' && node.right.value === 1) {
                return { coeff: { type: 'num', value: 1 }, rest: { type: 'num', value: 0 } };
            }
            if (!hasVariable(node, [varName])) {
                return { coeff: { type: 'num', value: 0 }, rest: node };
            }
            return null; // var^n (n>1) → 非线性
        }
    }

    if (node.type === 'func') {
        if (!getFuncChildrenAll(node).some(function(child) { return hasVariable(child, [varName]); })) {
            return { coeff: { type: 'num', value: 0 }, rest: node };
        }
        return null; // func(var) → 非线性
    }

    return null;
}


function findExplicitForm(node, varNames) {
    if (!node) return null;

    // 原始检测：var - expr 或 expr - var
    if (node.type === 'binop' && node.op === '-') {
        // 情况1: {binop, -, {var, name}, expr} → var = expr
        if (node.left.type === 'var' && varNames.includes(node.left.name) && !hasVariable(node.right, [node.left.name])) {
            return {
                var: node.left.name,
                expr: node.right
            };
        }
        // 情况2: {binop, -, expr, {var, name}}
        if (node.right.type === 'var' && varNames.includes(node.right.name) && !hasVariable(node.left, [node.right.name])) {
            return {
                var: node.right.name,
                expr: node.left
            };
        }
    }

    // 增强：线性变量隔离
    // 对于 F = a*v + rest（a为常数），可得 v = -rest / a
    for (const v of varNames) {
        if (!hasVariable(node, [v])) continue;

        const result = extractVarCoefficient(node, v);
        if (!result) continue; // 非线性

        // 检查系数是否为非零常数
        const coeffVal = evalAST(result.coeff, {});
        if (isNaN(coeffVal) || Math.abs(coeffVal) < 1e-12) continue;

        // 构造 v = -rest / coeff
        const expr = {
            type: 'binop',
            op: '/',
            left: { type: 'unary', op: '-', operand: result.rest },
            right: result.coeff
        };

        return { var: v, expr: expr };
    }

    return null;
}


function astNodeCount(ast) {
    if (!ast) return 0;
    switch (ast.type) {
        case 'num': return 1;
        case 'var': return 1;
        case 'binop': return 1 + astNodeCount(ast.left) + astNodeCount(ast.right);
        case 'unary': return 1 + astNodeCount(ast.operand);
        case 'func': return 1 + getFuncChildren(ast).reduce(function(sum, child) { return sum + astNodeCount(child); }, 0);
        default: return 1;
    }
}


function substituteVar(ast, varName, expr) {
    if (!ast) return ast;

    switch (ast.type) {
        case 'num':
            return { type: 'num', value: ast.value };

        case 'var':
            if (ast.name === varName) {
                return JSON.parse(JSON.stringify(expr));
            }
            return { type: 'var', name: ast.name };

        case 'binop':
            return {
                type: 'binop',
                op: ast.op,
                left: substituteVar(ast.left, varName, expr),
                right: substituteVar(ast.right, varName, expr)
            };

        case 'unary':
            return {
                type: 'unary',
                op: ast.op,
                operand: substituteVar(ast.operand, varName, expr)
            };

        case 'func':
            if (ast.arg) {
                return {
                    type: 'func',
                    name: ast.name,
                    arg: substituteVar(ast.arg, varName, expr)
                };
            }
            // 多参数函数（diff, int, ode, lim）
            if (ast.args) {
                var newArgs = ast.args.map(function(a, idx) {
                    // diff 的第2个参数（idx=1）是求导变量名，不替换
                    if (ast.name === 'diff' && idx === 1) {
                        return JSON.parse(JSON.stringify(a));
                    }
                    // int 的第2个参数（idx=1）是积分变量名，不替换
                    if (ast.name === 'int' && idx === 1) {
                        return JSON.parse(JSON.stringify(a));
                    }
                    // ode 的第2,3个参数（idx=1,2）是变量名标签，不替换
                    // ode 的表达式（idx=0）使用局部变量，也不替换
                    if (ast.name === 'ode' && idx <= 2) {
                        return JSON.parse(JSON.stringify(a));
                    }
                    // lim 的第2个参数（idx=1）是极限变量名，不替换
                    if (ast.name === 'lim' && idx === 1) {
                        return JSON.parse(JSON.stringify(a));
                    }
                    return substituteVar(a, varName, expr);
                });
                return { type: 'func', name: ast.name, args: newArgs };
            }
            return ast;

        default:
            return ast;
    }
}


function astEqual(a, b) {
    if (!a || !b) return false;
    if (a.type !== b.type) return false;
    switch (a.type) {
        case 'num': return a.value === b.value;
        case 'var': return a.name === b.name;
        case 'unary': return a.op === b.op && astEqual(a.operand, b.operand);
        case 'binop': return a.op === b.op && astEqual(a.left, b.left) && astEqual(a.right, b.right);
        case 'func':
            if (a.name !== b.name) return false;
            if (a.arg && b.arg) return astEqual(a.arg, b.arg);
            // 多参数函数
            if (a.args && b.args) {
                if (a.args.length !== b.args.length) return false;
                return a.args.every(function(ai, i) { return astEqual(ai, b.args[i]); });
            }
            return false;
    }
    return false;
}


function hasCalculusOp(ast) {
    if (!ast) return false;
    if (ast.type === 'func') {
        if (ast.name === 'ode' || ast.name === 'diff' || ast.name === 'int') return true;
        return getFuncChildrenAll(ast).some(function(child) { return hasCalculusOp(child); });
    }
    if (ast.type === 'binop') return hasCalculusOp(ast.left) || hasCalculusOp(ast.right);
    if (ast.type === 'unary') return hasCalculusOp(ast.operand);
    return false;
}


function scanASTForLargeNumbers(ast) {
    if (!ast) return [];
    switch (ast.type) {
        case 'num':
            return Math.abs(ast.value) > 1e200 ? [ast.value] : [];
        case 'var':
            return [];
        case 'unary':
            return scanASTForLargeNumbers(ast.operand);
        case 'binop':
            return [...scanASTForLargeNumbers(ast.left), ...scanASTForLargeNumbers(ast.right)];
        case 'func':
            return getFuncChildren(ast).reduce(function(acc, child) {
                return acc.concat(scanASTForLargeNumbers(child));
            }, []);
        default:
            return [];
    }
}


function _isLinearAST(node) {
    if (!node) return false;
    if (node.type === 'var' || node.type === 'num') return true;
    if (node.type === 'unary') return node.op === '-' ? _isLinearAST(node.operand) : false;
    if (node.type === 'binop') {
        if (node.op === '+' || node.op === '-') return _isLinearAST(node.left) && _isLinearAST(node.right);
        if (node.op === '*') {
            var lL = (node.left.type === 'num'), lR = (node.right.type === 'num');
            // 允许 常数*变量 或 变量*常数
            return (lL && _isLinearAST(node.right)) || (lR && _isLinearAST(node.left));
        }
        return false;
    }
    return false; // func / ^ / / 等视为非线性
}


function _linearSystemConsistent(eqs, vars) {
    var n = vars.length, m = eqs.length;
    if (m === 0) return true;
    // 把每个方程写成  Σ a_k·var_k - c = 0  → 提取系数向量与常数
    function _coeffOf(eqAst, vn) {
        // 返回 {a, c} 使 eqAst 等价于 a·vn + c'（仅当 eqAst 对 vn 线性且其他量为常数时有效）
        // 通用做法：在 vn 上做符号线性提取（仅支持 + - * 常数 与 常数*变量）
        function _extract(node, target) {
            if (!node) return { a: 0, c: 0 };
            if (node.type === 'num') return { a: 0, c: node.value };
            if (node.type === 'var') return node.name === target ? { a: 1, c: 0 } : { a: 0, c: 0 };
            if (node.type === 'unary' && node.op === '-') { var t = _extract(node.operand, target); return { a: -t.a, c: -t.c }; }
            if (node.type === 'binop') {
                if (node.op === '+' || node.op === '-') {
                    var L = _extract(node.left, target), R = _extract(node.right, target);
                    return { a: L.a + (node.op === '-' ? -R.a : R.a), c: L.c + (node.op === '-' ? -R.c : R.c) };
                }
                if (node.op === '*') {
                    var cl = (node.left.type === 'num') ? node.left.value : null;
                    var cr = (node.right.type === 'num') ? node.right.value : null;
                    if (cl !== null && node.right.type === 'var' && node.right.name === target) return { a: cl, c: 0 };
                    if (cr !== null && node.left.type === 'var' && node.left.name === target) return { a: cr, c: 0 };
                    return { a: 0, c: 0 }; // 含非常数积（如 var*var）→ 非目标线性（上层已判 _isLinearAST 拦截）
                }
            }
            return { a: 0, c: 0 };
        }
        // eqAst 形如 LHS - RHS = 0 ；先取 LHS-RHS 的整体线性提取
        // 这里 eqAst 已是 (LHS)-(RHS) 的 AST（suan 内部方程统一减式）
        return _extract(eqAst, vn);
    }
    var A = [], B = [];
    for (var i = 0; i < m; i++) {
        // 方程约定为 binop('-', lhs, rhs) ≡ lhs - rhs = 0
        var lhs = eqs[i].left, rhs = eqs[i].right;
        var lcoef = {}, rcoef = {};
        for (var v = 0; v < n; v++) {
            lcoef[vars[v]] = _coeffOf(lhs, vars[v]).a;
            rcoef[vars[v]] = _coeffOf(rhs, vars[v]).a;
        }
        var row = [];
        for (var v2 = 0; v2 < n; v2++) row.push(lcoef[vars[v2]] - rcoef[vars[v2]]);
        // 常数：lhs 常数 - rhs 常数（移到右侧）
        var lc = _coeffOf(lhs, '__none__').c, rc = _coeffOf(rhs, '__none__').c;
        B.push(lc - rc);
        A.push(row);
    }
    // 高斯消元算 rank(A) 与 rank([A|B])
    function _rank(mat, withB) {
        var M = [];
        for (var r = 0; r < mat.length; r++) {
            var row = mat[r].slice();
            if (withB) row.push(B[r]);
            M.push(row);
        }
        var rows = M.length, cols = withB ? n + 1 : n;
        var rank = 0;
        for (var col = 0; col < cols; col++) {
            var piv = -1;
            for (var rr = rank; rr < rows; rr++) {
                if (Math.abs(M[rr][col]) > 1e-9) { piv = rr; break; }
            }
            if (piv < 0) continue;
            var tmp = M[rank]; M[rank] = M[piv]; M[piv] = tmp;
            for (var rr2 = 0; rr2 < rows; rr2++) {
                if (rr2 !== rank && Math.abs(M[rr2][col]) > 1e-12) {
                    var f = M[rr2][col] / M[rank][col];
                    for (var cc = col; cc < cols; cc++) M[rr2][cc] -= f * M[rank][cc];
                }
            }
            rank++;
        }
        return rank;
    }
    var rA = _rank(A, false);
    var rAB = _rank(A, true);
    return rA === rAB; // 相容 ⇔ 有解
}
// suan36: 雅可比秩引导投影方向（分析算子，不收缩/不剪枝，sound 中性）

function _permutations(n) {
    if (n <= 1) return [[0]];
    var res = [], used = new Array(n).fill(false), path = [];
    (function rec() {
        if (path.length === n) { res.push(path.slice()); return; }
        for (var i = 0; i < n; i++) {
            if (!used[i]) { used[i] = true; path.push(i); rec(); path.pop(); used[i] = false; }
        }
    })();
    return res;
}


function _symmetryExpand(sols, varNames, eqStrs, D0) {
    // 本函数无 state，按 varNames 现场派生保护表（与 _solveImpl 同口径），避免依赖模块级全局（P0 污染源）
    var _lsSymProt = new Set();
    for (var _spi = 0; varNames && _spi < varNames.length; _spi++) {
        if (typeof varNames[_spi] === 'string' && varNames[_spi]) _lsSymProt.add(varNames[_spi]);
    }
    if (!sols || !sols.length || !varNames || varNames.length < 2) return sols;
    // ⚠️ 必须先 fuzzyFix 再 tokenize（2026-10-03 修复的 P0）：
    //   隐式乘（"2x"）只有 fuzzyFix 会补出乘号；跳过它会让 "2x" 少一个 *，
    //   导致解析失败 → 0 解，或更糟：静默给出错误答案。口径须与 setup.js 一致。
    // 预编译原始方程 AST（在完整变量空间验证）
    var _eqASTs = [];
    if (eqStrs) {
        for (var _e = 0; _e < eqStrs.length; _e++) {
            try {
                var _i = eqStrs[_e].indexOf('=');
                _eqASTs.push(parse(tokenize(fuzzyFix('(' + eqStrs[_e].slice(0, _i) + ')-(' + eqStrs[_e].slice(_i + 1) + ')', _lsSymProt))));
            } catch (err) { _eqASTs.push(null); }
        }
    }
    if (!_eqASTs.length) return sols;
    var n = varNames.length;
    var _baseKeys = {};
    for (var _bk = 0; _bk < sols.length; _bk++) {
        _baseKeys[sols[_bk].values.map(function(v) { return v.toFixed(4); }).join(',')] = true;
    }
    var _perms = _permutations(n);
    for (var _pi = 0; _pi < sols.length; _pi++) {
        var _base = sols[_pi].values;
        for (var _pj = 0; _pj < _perms.length; _pj++) {
            var _perm = _perms[_pj];
            var _pv = [];
            for (var _pk = 0; _pk < n; _pk++) _pv.push(_base[_perm[_pk]]);
            var _key = _pv.map(function(v) { return v.toFixed(4); }).join(',');
            if (_baseKeys[_key]) continue;
            // 域内检查
            var _inDom = true;
            for (var _vi = 0; _vi < n; _vi++) {
                var _dd = D0 && D0[varNames[_vi]];
                if (_dd && (_pv[_vi] < _dd.min - 1e-6 || _pv[_vi] > _dd.max + 1e-6)) { _inDom = false; break; }
            }
            if (!_inDom) continue;
            // 完整空间残差验证（严格 1e-9）
            var _known = {}; for (var _vk = 0; _vk < n; _vk++) _known[varNames[_vk]] = _pv[_vk];
            var _maxR = 0;
            for (var _ei = 0; _ei < _eqASTs.length; _ei++) {
                if (!_eqASTs[_ei]) continue;
                var _rr; try { _rr = Math.abs(evalAST(_eqASTs[_ei], _known)); } catch (err) { _rr = 1e10; }
                if (_rr > _maxR) _maxR = _rr;
            }
            if (_maxR >= 1e-9) continue;
            sols.push({ values: _pv, residual: _maxR });
            _baseKeys[_key] = true;
        }
    }
    return sols;
}
