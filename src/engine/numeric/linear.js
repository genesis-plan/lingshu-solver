/* 模块 numeric/linear：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function gaussianSolve(A, b) {
    const n = A.length;
    if (n === 0) return null;

    const aug = [];
    for (let i = 0; i < n; i++) {
        const row = A[i].slice();
        row.push(b[i]);
        aug.push(row);
    }

    let rank = 0;

    // 前向消元（部分选主元）
    for (let col = 0; col < n; col++) {
        // 找主元
        let maxRow = col;
        let maxVal = Math.abs(aug[col][col]);
        for (let row = col + 1; row < n; row++) {
            if (Math.abs(aug[row][col]) > maxVal) {
                maxVal = Math.abs(aug[row][col]);
                maxRow = row;
            }
        }

        // 主元为0，跳过此列
        if (maxVal < 1e-12) {
            continue;
        }

        if (maxRow !== col) {
            const temp = aug[col];
            aug[col] = aug[maxRow];
            aug[maxRow] = temp;
        }

        // 消去下方
        for (let row = col + 1; row < n; row++) {
            const factor = aug[row][col] / aug[col][col];
            for (let j = col; j <= n; j++) {
                aug[row][j] -= factor * aug[col][j];
            }
        }

        rank++;
    }

    // 检查一致性
    for (let row = rank; row < n; row++) {
        if (Math.abs(aug[row][n]) > 1e-10) {
            return null; // 不一致
        }
    }

    if (rank < n) {
        // 欠定系统，无法唯一求解
        return null;
    }

    // 回代求解
    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
        let sum = aug[i][n];
        for (let j = i + 1; j < n; j++) {
            sum -= aug[i][j] * x[j];
        }
        if (Math.abs(aug[i][i]) < 1e-12) {
            return null;
        }
        x[i] = sum / aug[i][i];
    }

    return { solution: x, rank: rank };
}


function gaussianSolveRect(A, b) {
    const m = A.length;
    if (m === 0) return null;
    const n = A[0].length;
    const EPS = 1e-9;
    // 构造增广矩阵 [A | b]
    const aug = A.map((row, i) => row.slice().concat([b[i]]));
    let rank = 0;
    const pivCol = [];
    for (let col = 0; col < n; col++) {
        // 部分选主元（在已确定秩以下的行中找最大绝对值）
        let sel = -1, maxVal = EPS;
        for (let r = rank; r < m; r++) {
            if (Math.abs(aug[r][col]) > maxVal) { maxVal = Math.abs(aug[r][col]); sel = r; }
        }
        if (sel === -1) continue;            // 本列在余下行全为 0，跳过
        if (sel !== rank) { const t = aug[rank]; aug[rank] = aug[sel]; aug[sel] = t; }
        const pv = aug[rank][col];
        // 消去其他所有行（含上方），使本列仅 pivot 行非零 → 直达行最简形
        for (let r = 0; r < m; r++) {
            if (r === rank) continue;
            const f = aug[r][col] / pv;
            if (Math.abs(f) < EPS) continue;
            for (let c = col; c <= n; c++) aug[r][c] -= f * aug[rank][c];
        }
        pivCol.push(col);
        rank++;
    }
    // 一致性：存在"A 全零但 b 非零"的行 → 不相容（无公共实解）
    for (let r = 0; r < m; r++) {
        let allZero = true;
        for (let c = 0; c < n; c++) { if (Math.abs(aug[r][c]) > EPS) { allZero = false; break; } }
        if (allZero && Math.abs(aug[r][n]) > 1e-7) return { consistent: false };
    }
    const x = new Array(n).fill(0);
    for (let r = 0; r < rank; r++) {
        const pc = pivCol[r];
        const coeff = aug[r][pc];
        if (Math.abs(coeff) < EPS) continue;
        x[pc] = aug[r][n] / coeff;
    }
    if (rank < n) {
        return { consistent: true, unique: false, solution: x };   // 欠定：无穷多解
    }
    return { consistent: true, unique: true, solution: x };        // 满列秩：唯一解
}


function isPolynomial(ast, varName) {
    switch (ast.type) {
        case 'num': return true;
        case 'var': return ast.name === varName;
        case 'unary': return isPolynomial(ast.operand, varName);
        case 'binop':
            if (ast.op === '+' || ast.op === '-')
                return isPolynomial(ast.left, varName) && isPolynomial(ast.right, varName);
            if (ast.op === '*')
                return isPolynomial(ast.left, varName) && isPolynomial(ast.right, varName);
            if (ast.op === '^') {
                // 支持 (多项式)^n 形式，如 (x-5)^4
                return isPolynomial(ast.left, varName) &&
                       ast.right.type === 'num' && Number.isInteger(ast.right.value) && ast.right.value >= 0 && ast.right.value <= 20;
            }
            if (ast.op === '/') {
                return !hasVariable(ast.right, [varName]) && isPolynomial(ast.left, varName);
            }
            return false;
        case 'func': return !getFuncChildrenAll(ast).some(function(child) { return hasVariable(child, [varName]); });
    }
    return false;
}


function extractPolynomialCoefficients(ast, varName) {
    if (!isPolynomial(ast, varName)) return null;

    // 递归提取子表达式的系数对象 {power: coeff, ...}
    function polyExtract(node) {
        const result = {};
        switch (node.type) {
            case 'num':
                result[0] = node.value;
                break;
            case 'var':
                if (node.name === varName) result[1] = 1;
                else result[0] = 0;
                break;
            case 'unary':
                const inner = polyExtract(node.operand);
                for (const [p, c] of Object.entries(inner)) {
                    result[Number(p)] = -c;
                }
                break;
            case 'binop':
                if (node.op === '+' || node.op === '-') {
                    const l = polyExtract(node.left);
                    const r = polyExtract(node.right);
                    for (const [p, c] of Object.entries(l)) {
                        result[Number(p)] = (result[Number(p)] || 0) + c;
                    }
                    const sign = node.op === '+' ? 1 : -1;
                    for (const [p, c] of Object.entries(r)) {
                        result[Number(p)] = (result[Number(p)] || 0) + sign * c;
                    }
                } else if (node.op === '*') {
                    const l = polyExtract(node.left);
                    const r = polyExtract(node.right);
                    // 多项式卷积
                    for (const [pi, ci] of Object.entries(l)) {
                        for (const [pj, cj] of Object.entries(r)) {
                            const pk = Number(pi) + Number(pj);
                            result[pk] = (result[pk] || 0) + ci * cj;
                        }
                    }
                } else if (node.op === '^') {
                    if (node.right.type === 'num' && Number.isInteger(node.right.value) && node.right.value >= 0) {
                        const exp = node.right.value;
                        if (exp === 0) {
                            result[0] = 1;
                        } else if (node.left.type === 'var' && node.left.name === varName) {
                            result[exp] = 1;
                        } else {
                            // 多项式幂运算：通过重复卷积计算 (如 (x-5)^4)
                            const base = polyExtract(node.left);
                            let power = { 0: 1 }; // x^0 = 1
                            for (let e = 0; e < exp; e++) {
                                const newPower = {};
                                for (const [pi, ci] of Object.entries(power)) {
                                    for (const [pj, cj] of Object.entries(base)) {
                                        const pk = Number(pi) + Number(pj);
                                        newPower[pk] = (newPower[pk] || 0) + ci * cj;
                                    }
                                }
                                power = newPower;
                            }
                            for (const [p, c] of Object.entries(power)) {
                                result[Number(p)] = c;
                            }
                        }
                    }
                } else if (node.op === '/') {
                    if (!hasVariable(node.right, [varName])) {
                        const c = evalAST(node.right, {});
                        const l = polyExtract(node.left);
                        for (const [p, coeff] of Object.entries(l)) {
                            result[Number(p)] = coeff / c;
                        }
                    }
                }
                break;
            case 'func':
                if (!getFuncChildrenAll(node).some(function(child) { return hasVariable(child, [varName]); })) {
                    result[0] = evalAST(node, {});
                }
                break;
        }
        return result;
    }

    const coeffs = polyExtract(ast);

    const maxPower = Math.max(...Object.keys(coeffs).map(Number));
    const result = new Array(maxPower + 1).fill(0);
    for (const [power, coeff] of Object.entries(coeffs)) {
        result[Number(power)] = coeff;
    }
    return result;
}


function collectVariableDenominators(ast, varNames) {
    const denoms = [];
    function walk(node) {
        if (!node) return;
        if (node.type === 'binop') {
            if (node.op === '/' && hasVariable(node.right, varNames)) {
                denoms.push(node.right);
            }
            walk(node.left);
            walk(node.right);
        } else if (node.type === 'unary') {
            walk(node.operand);
        } else if (node.type === 'func') {
            getFuncChildrenAll(node).forEach(function(child) { walk(child); });
        }
    }
    walk(ast);
    return denoms;
}


function tryRationalTransform(ast, varName) {
    if (ast.type !== 'binop' || ast.op !== '-') return null;

    const left = ast.left;
    const right = ast.right;
    const singularities = [];

    // 情况1: 左侧是 A/D，D 含变量
    if (left.type === 'binop' && left.op === '/' && hasVariable(left.right, [varName])) {
        const D = left.right;
        // 提取奇点：D = 0 的根
        const denomCoeffs = extractPolynomialCoefficients(D, varName);
        if (denomCoeffs && denomCoeffs.length > 1) {
            const singRoots = polynomialAllRoots(denomCoeffs, 1e-6);
            singularities.push(...singRoots);
        }
        // 变换: A - right * D = 0
        const newAST = {
            type: 'binop', op: '-',
            left: left.left,
            right: { type: 'binop', op: '*', left: right, right: D }
        };
        return { transformed: newAST, singularities: singularities };
    }

    // 情况2: 右侧是 A/D，D 含变量
    if (right.type === 'binop' && right.op === '/' && hasVariable(right.right, [varName])) {
        const D = right.right;
        const denomCoeffs = extractPolynomialCoefficients(D, varName);
        if (denomCoeffs && denomCoeffs.length > 1) {
            const singRoots = polynomialAllRoots(denomCoeffs, 1e-6);
            singularities.push(...singRoots);
        }
        // 变换: left * D - A = 0
        const newAST = {
            type: 'binop', op: '-',
            left: { type: 'binop', op: '*', left: left, right: D },
            right: right.left
        };
        return { transformed: newAST, singularities: singularities };
    }

    // 情况3: 两侧都有分母 — 收集所有分母，整体相乘
    const allDenoms = collectVariableDenominators(ast, [varName]);
    if (allDenoms.length === 0) return null;

    let transformed = ast;
    for (const d of allDenoms) {
        const denomCoeffs = extractPolynomialCoefficients(d, varName);
        if (denomCoeffs && denomCoeffs.length > 1) {
            const singRoots = polynomialAllRoots(denomCoeffs, 1e-6);
            singularities.push(...singRoots);
        }
        // 将 A/B 中的 B 替换为 1（因为整体乘以 B 后 B 被消去）
        transformed = replaceDivisionByOne(transformed, d);
    }
    if (transformed !== ast) {
        return { transformed: transformed, singularities: singularities };
    }

    return null;
}


function replaceDivisionByOne(ast, targetDenom) {
    function walk(node) {
        if (!node) return node;
        switch (node.type) {
            case 'num':
            case 'var':
                return node;
            case 'unary':
                return { type: 'unary', op: node.op, operand: walk(node.operand) };
            case 'binop':
                if (node.op === '/' && astEqual(node.right, targetDenom)) {
                    return walk(node.left);
                }
                return { type: 'binop', op: node.op, left: walk(node.left), right: walk(node.right) };
            case 'func':
                if (node.arg) {
                    return { type: 'func', name: node.name, arg: walk(node.arg) };
                }
                if (node.args) {
                    var walkedArgs = node.args.map(function(a, idx) {
                        if (node.name === 'int' && idx === 1) return JSON.parse(JSON.stringify(a));
                        if (node.name === 'ode' && idx <= 2) return JSON.parse(JSON.stringify(a));
                        return walk(a);
                    });
                    return { type: 'func', name: node.name, args: walkedArgs };
                }
                return node;
        }
        return node;
    }
    return walk(ast);
}


function _pointResidual(eq, vn, x) {
    try {
        var vm = {};
        vm[vn] = x;
        var v = evalAST(eq, vm);
        if (v === null || v !== v || !isFinite(v)) return null;
        return v;
    } catch (err) { return null; }
}
// 单变量二分定位：区间 [a,b] 无奇点且 f(a)·f(b)<0（异号），二分至宽度<1e-10（≤100 次）；

function _sturmCompletenessCheck(state) {
    if (!state || !state.result || !state.result.solutions) return;
    var eqs = state.equations;
    var vns = getOutputVarNames(state);
    if (!eqs || eqs.length !== 1 || vns.length !== 1) return;
    var vn = vns[0];
    var coeffs = null;
    try { coeffs = extractPolynomialCoefficients(eqs[0], vn); } catch (e) { return; }
    if (!coeffs || coeffs.length < 2) return;
    var dom = _domBoxOf(state, vns);
    var lo = (dom && dom[vn]) ? dom[vn].min : -1e6;
    var hi = (dom && dom[vn]) ? dom[vn].max : 1e6;
    var r = _sturmCountAsc(coeffs, lo, hi);
    var found = state.result.solutions.length;
    var info = state.result.sturmCompleteness || (state.result.sturmCompleteness = {});
    info.certified = r.ok;
    info.realRootCount = r.ok ? r.count : null;
    info.found = found;
    if (!r.ok) { info.why = r.why; info.complete = null; return; }
    info.complete = (r.count === found);
    if (!info.complete) info.missing = r.count - found;
    if (!info.complete) {
        state.result.sturmIncomplete = {
            provenRealRoots: r.count,
            found: found,
            missing: r.count - found
        };
    }
}
// —— suan50：多分式（有理方程）符号有理化 ——

function _rat50(node) {
    if (!node || !node.type) return null;
    var ONE = { type: 'num', value: 1 };
    if (node.type === 'num' || node.type === 'var') return { num: node, den: ONE };
    if (node.type === 'unary' && node.op === '-') {
        var r = _rat50(node.operand);
        if (!r) return null;
        return { num: { type: 'unary', op: '-', operand: r.num }, den: r.den };
    }
    if (node.type === 'binop') {
        var a = _rat50(node.left);
        var b = (node.op === '^') ? { num: node.right, den: { type: 'num', value: 1 } } : _rat50(node.right);
        if (!a || !b) return null;
        if (node.op === '+' || node.op === '-') {
            return {
                num: { type: 'binop', op: node.op,
                       left:  { type: 'binop', op: '*', left: a.num, right: b.den },
                       right: { type: 'binop', op: '*', left: b.num, right: a.den } },
                den: { type: 'binop', op: '*', left: a.den, right: b.den }
            };
        }
        if (node.op === '*') {
            return { num: { type: 'binop', op: '*', left: a.num, right: b.num },
                     den: { type: 'binop', op: '*', left: a.den, right: b.den } };
        }
        if (node.op === '/') {
            return { num: { type: 'binop', op: '*', left: a.num, right: b.den },
                     den: { type: 'binop', op: '*', left: a.den, right: b.num } };
        }
        return null;
    }
    return { num: node, den: { type: 'num', value: 1 } };
}