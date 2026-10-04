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
        // 欠定：无穷多解。**必须带上 rank** —— 解集维数 = n − rank，
        // 调用方（suan17 的 resultType=3 分支）要靠它告诉 Agent「这是几维流形」。
        return { consistent: true, unique: false, solution: x, rank: rank, freeDim: n - rank };
    }
    return { consistent: true, unique: true, solution: x, rank: rank, freeDim: 0 };  // 满列秩：唯一解
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

// 🔴🔴 完备性计数的区间必须是**声明空间**（问题本身允许的解范围），由**问题里的不等式约束**决定。
//
// 三种区间，三种数学地位，混用必出事（2026-10-04 两个方向都实测踩过）：
//
//   (a) 搜索盒 lo/hi（来自 _domBoxOf / userDomain）—— 是**搜索提示**（去哪里找），
//       **不是问题的一部分**。实测 `x^2=2` 域 [1,2]：盒内 1 根、found 1，
//       若拿它当完备性证据就判「全部解」+ canAssert.allSolutions=true，
//       而 −√2 是真解且在盒外 ⇒ **谎报找全**。⇒ 只能进 inBoxCount 诊断，绝不当证据。
//
//   (b) 问题约束（如 `x>0`、`x∈[-30,30]`，写在方程串里的不等式）—— 是**问题的一部分**，
//       它**定义解集本身**。实测 `x^2-4=0, x>0`：声明空间 (0,∞) 内**恰好 1 个**解 x=2，
//       found=1 ⇒ 这里**确实完备**，应该打「全部解」。
//       ⇒ 必须用它当计数区间，否则会把被约束排除的真根（−2）算进来 ⇒ 完备答案被误判成「部分解」。
//
//   (c) ℝ（无任何约束时）—— 这才是 `_sturmCountAllReal` 的合法场景。
//
// 实测确认的端点语义（dist 真实函数，勿猜）：Sturm 的 V(a)−V(b) 数的是 **(a,b]**
//   （右端点含、左端点不含）。x−1 在 [0,1] 得 1（根 1 = 右端点计入）；
//   x²−4 在 [−2,0] 得 0（根 −2 = 左端点不计入）。
// ⇒ 开闭端点通过 opts.loClosed / opts.hiClosed 显式传给 _sturmCountRange 做修正。
function _declaredIntervalOf(state, vn) {
    var lo = -Infinity, hi = Infinity;
    var loClosed = false, hiClosed = false;
    var sawConstraint = false, unparsed = 0;
    function tightenL(v, closed) {
        sawConstraint = true;
        if (v > lo) { lo = v; loClosed = closed; }
        else if (v === lo && !closed) { /* 已有的更宽，保持 */ }
        else if (v === lo && closed) { loClosed = true; }
    }
    function tightenR(v, closed) {
        sawConstraint = true;
        if (v < hi) { hi = v; hiClosed = closed; }
        else if (v === hi && closed) { hiClosed = true; }
    }
    // —— 区间型域约束 x∈[a,b]（parseCondition 的 type:'domain'）——
    var dcs = state.domainConstraints || [];
    for (var i = 0; i < dcs.length; i++) {
        var dc = dcs[i];
        if (!dc || dc.varName !== vn) continue;
        if (dc.min !== undefined) {
            var mn = Number(dc.min);
            if (!isFinite(mn)) { unparsed++; continue; }
            tightenL(mn, true);
        }
        if (dc.max !== undefined) {
            var mx = Number(dc.max);
            if (!isFinite(mx)) { unparsed++; continue; }
            tightenR(mx, true);
        }
    }
    // —— 一般不等式约束 lhs OP rhs ——
    // ⚠ 只认「一元线性比较」：形如 `x > 0`、`3 <= x`、`x <= -7`。
    //   这类约束在 parseCondition 里被归一为 domain（进 domainConstraints），
    //   但也可能有没被 parseCondition 覆盖的写法落进 inequalityConstraints（如 `x ≠ 0`、
    //   `x^2 < 4`）⇒ 那些**解析不出边界**，记 unparsed ⇒ 计数区间退回 ℝ（保守方向：
    //   count 偏大 ⇒ found<count ⇒ 报「部分解」，不会谎报找全）。
    var iq = state.inequalityConstraints || [];
    for (var j = 0; j < iq.length; j++) {
        var c = iq[j];
        if (!c) continue;
        var lIsVar = !!(c.lhs && (c.lhs.type === 'var' || c.lhs.type === 'ident') && c.lhs.name === vn);
        var rIsVar = !!(c.rhs && (c.rhs.type === 'var' || c.rhs.type === 'ident') && c.rhs.name === vn);
        var lIsNum = !!(c.lhs && c.lhs.type === 'num' && isFinite(Number(c.lhs.value)));
        var rIsNum = !!(c.rhs && c.rhs.type === 'num' && isFinite(Number(c.rhs.value)));
        if (lIsVar && rIsNum) {
            var a = Number(c.rhs.value);
            if (c.op === '>') tightenL(a, false);
            else if (c.op === '>=') tightenL(a, true);
            else if (c.op === '<') tightenR(a, false);
            else if (c.op === '<=') tightenR(a, true);
            else unparsed++;
        } else if (rIsVar && lIsNum) {
            var b = Number(c.lhs.value);
            // c OP x  ⇒  反向
            if (c.op === '>') tightenR(b, false);
            else if (c.op === '>=') tightenR(b, true);
            else if (c.op === '<') tightenL(b, false);
            else if (c.op === '<=') tightenL(b, true);
            else unparsed++;
        } else {
            unparsed++;
        }
    }
    // lo > hi ⇒ 约束本身矛盾（声明空间为空）⇒ 交由「无解」判定，不在这里下结论
    return {
        lo: lo, hi: hi, loClosed: loClosed, hiClosed: hiClosed,
        sawConstraint: sawConstraint, unparsed: unparsed,
        isEmpty: (lo > hi)
    };
}

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
    // 🔴🔴 两个计数**必须分开**，混用会造成谎报（2026-10-04 实测 P0）：
    //
    //   decl  = Sturm 在**声明空间**（问题约束界定的区间，可 ±∞）内的实根数
    //           ⇒ 这一份才是完备性证据
    //   inBox = Sturm 在**搜索盒 [lo,hi]** 内的实根数
    //           ⇒ 只能用于「盒内漏没漏」诊断
    //
    //   旧代码把 inBox 当证据，实测事故：`x^2=2` 域给 [1,2] ⇒ inBox=1、found=1 ⇒
    //   判「全部解」+ canAssert.allSolutions=true，而 −√2 是真解且在盒外 ⇒ **谎报找全**。
    //   这是本产品最不能犯的错。
    //
    //   inBox 只配用于「盒内应该有几个而没找到」，这正是过滤链剔除解时要报的数。
    var decl = _declaredIntervalOf(state, vn);
    var rDecl = _sturmCountRange(coeffs, decl.lo, decl.hi,
        { loClosed: decl.loClosed, hiClosed: decl.hiClosed });
    var rBox = _sturmCountAsc(coeffs, lo, hi);
    var found = state.result.solutions.length;
    var info = state.result.sturmCompleteness || (state.result.sturmCompleteness = {});
    // ⚠ certified/realRootCount/complete 三个字段是**声明空间**语义（2026-10-04 起）。
    //   下游 conclusion.js 的 sturm_exact_count 证据就读这三个字段 ⇒ 它必须来自问题约束，
    //   既不能是搜索盒（谎报找全），也不能在有约束时盲目用 ℝ（把完备答案误判成部分解）。
    info.certified = rDecl.ok;
    info.realRootCount = rDecl.ok ? rDecl.count : null;
    // 计数空间显式声明，防再被误当盒内计数或盲目全域计数。
    //   'R'   = 声明空间就是 ℝ（问题没给任何区间约束）
    //   'declared' = 由问题里的不等式/域约束界定（区间见 declaredLo/Hi）
    info.scope = decl.sawConstraint ? 'declared' : 'R';
    if (decl.sawConstraint) {
        info.declaredLo = decl.lo; info.declaredHi = decl.hi;
        info.declaredLoClosed = decl.loClosed; info.declaredHiClosed = decl.hiClosed;
    }
    // 有约束但解析不出边界（x≠0 / x^2<4 之类）⇒ 计数区间退回 ℝ，count 偏大 ⇒ 保守降级。
    // 这不是缺陷，是「诚实地说不出全部解」；记下来供审计。
    if (decl.unparsed > 0) info.unparsedConstraints = decl.unparsed;
    if (decl.isEmpty) { info.why = '约束互相矛盾，声明空间为空'; info.complete = null; return; }
    info.inBoxCount = rBox.ok ? rBox.count : null;
    info.found = found;
    if (!rDecl.ok) { info.why = rDecl.why; info.complete = null; return; }
    info.complete = (rDecl.count === found);
    if (!info.complete) info.missing = rDecl.count - found;
    if (!info.complete) {
        state.result.sturmIncomplete = {
            provenRealRoots: rDecl.count,
            found: found,
            missing: rDecl.count - found
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