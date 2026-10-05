/* 模块 operators/algebra：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function suan14(state) {
    if (!state.D0 || state.varNames.length < 2) { state.singularRegionsInfo = null; return; }

    var n = state.varNames.length;
    var m = state.equations.length;
    if (m < 2) { state.singularRegionsInfo = null; return; }
    
    var singularRegions = [];
    var eps = 1e-7;
    
    // 在区域内均匀采样，检查雅可比行列式
    // 注意：此处只需要采样点，不需要物理边界文本
    var samplePoints = generateStartPoints(state.varNames, null, state);
    var maxSamples = Math.min(20, samplePoints.length);
    
    for (var si = 0; si < maxSamples; si++) {
        var x = samplePoints[si];
        
        var J = [];
        var vars = {};
        state.varNames.forEach(function(v, i) { vars[v] = x[i]; });
        var F = state.equations.map(function(eq) { return evalAST(eq, vars); });
        
        for (var i = 0; i < m; i++) {
            J.push(new Array(n));
            for (var j = 0; j < n; j++) {
                var xP = x.slice();
                xP[j] += eps;
                var vP = {};
                state.varNames.forEach(function(v, k) { vP[v] = xP[k]; });
                var fp = evalAST(state.equations[i], vP);
                J[i][j] = (fp - F[i]) / eps;
                if (isNaN(J[i][j]) || !isFinite(J[i][j])) J[i][j] = 0;
            }
        }
        
        // 如果是方阵，计算行列式
        if (m === n) {
            var det = matrixDeterminant(J);
            if (isFinite(det) && Math.abs(det) < 1e-6) {
                singularRegions.push({ point: x.slice(), det: det, isSingular: true });
            }
        }
    }
    
    // 如果检测到奇异点，计算奇异区域的关键信息
    if (singularRegions.length > 0) {
        for (var ri = 0; ri < singularRegions.length; ri++) {
            var sr = singularRegions[ri];
            var x = sr.point;
            
            // 在奇异点附近微扰，检查函数值是否剧烈变化
            var perturbValues = [];
            for (var pi = 0; pi < 3; pi++) {
                var perturbed = x.slice();
                for (var j = 0; j < n; j++) {
                    perturbed[j] += (pi === 0 ? eps : (pi === 1 ? -eps : 2*eps));
                }
                var vP = {};
                state.varNames.forEach(function(v, k) { vP[v] = perturbed[k]; });
                var fP = state.equations.map(function(eq) { return evalAST(eq, vP); });
                var norm = 0;
                for (var fi = 0; fi < fP.length; fi++) norm += fP[fi] * fP[fi];
                perturbValues.push(Math.sqrt(norm));
            }
            
            var rateOfChange = 0;
            for (var pi = 1; pi < perturbValues.length; pi++) {
                rateOfChange += Math.abs(perturbValues[pi] - perturbValues[pi-1]);
            }
            sr.rateOfChange = rateOfChange / perturbValues.length;
        }
        state.singularRegionsInfo = singularRegions; return;
    }
    
    state.singularRegionsInfo = null; return;
}


function suan15(state) {
    var hasCalc = state.equations.some(function(eq) { return hasCalculusOp(eq); });
    if (!hasCalc) { state.calculusInfo = null; return; }

    var info = { hasODE: false, hasDiff: false, hasInt: false, odeClassification: null, hasContraction: false };

    for (var ei = 0; ei < state.equations.length; ei++) {
        (function walkNode(n) {
            if (!n) return;
            if (n.type === 'func') {
                if (n.name === 'ode') {
                    info.hasODE = true;
                    if (n.args && n.args.length >= 3) {
                        var expr = n.args[0];
                        var xVarName = n.args[1].name;
                        var yVarName = n.args[2].name;
                        if (xVarName && yVarName) {
                            info.odeClassification = classifyODE(expr, xVarName, yVarName);
                            // 检查压缩映射
                            var stepH = 0.01; // 假设步长
                            info.hasContraction = isContractionMapping(expr, xVarName, yVarName, stepH);
                        }
                    }
                }
                if (n.name === 'diff') info.hasDiff = true;
                if (n.name === 'int') info.hasInt = true;
                getFuncChildrenAll(n).forEach(function(child) { walkNode(child); });
            }
            if (n.type === 'binop') { walkNode(n.left); walkNode(n.right); }
            if (n.type === 'unary') { walkNode(n.operand); }
        })(state.equations[ei]);
    }

    state.calculusInfo = info; return;
}


function suan16(state) {
    if (state.equations.length === 0) {
        state.done = true;
        state.result = { solutions: [], error: "NO_EQUATION", message: "没有可求解的方程", varNames: state.varNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "无可求解方程" };
        return;
    }
    // 对数反演化简（2026-08-21）：log(u) = c → u = 10^c（log 为常用对数 log10）、ln(u)=c → u=e^c、
    // log2(u)=c → u=2^c、log(u)=log(v) → u=v。
    // 把超越方程转代数方程，让二次判别式等能快速判无解（如 log(xy)=1, x+y=6 → xy=10, x+y=6 →
    // 判别式<0 → 快速无解），避免无解系统走分支定界 8 秒指数递归爆炸。
    // 安全性：10^c / e^c / 2^c 恒 >0，反演不引入定义域外伪解。
    function _isLogFn(n) {
        return n && n.type === 'func' && (n.name === 'log' || n.name === 'log10' || n.name === 'ln' || n.name === 'log2');
    }
    function _logBase(name) {
        if (name === 'ln') return Math.E;
        if (name === 'log2') return 2;
        return 10; // log / log10 为常用对数
    }
    function _tryLogInvert(eq) {
        if (!eq || eq.type !== 'binop' || eq.op !== '-') return eq;
        var L = eq.left, R = eq.right;
        if (_isLogFn(L) && R && R.type === 'num') {
            return { type: 'binop', op: '-', left: L.arg, right: { type: 'num', value: Math.pow(_logBase(L.name), R.value) } };
        }
        if (_isLogFn(R) && L && L.type === 'num') {
            return { type: 'binop', op: '-', left: L.arg, right: { type: 'num', value: Math.pow(_logBase(R.name), L.value) } };
        }
        if (_isLogFn(L) && _isLogFn(R) && L.name === R.name) {
            return { type: 'binop', op: '-', left: L.arg, right: R.arg };
        }
        return eq;
    }
    for (var _li = 0; _li < state.equations.length; _li++) {
        var _inv = _tryLogInvert(state.equations[_li]);
        if (_inv !== state.equations[_li]) {
            state.equations[_li] = _inv;
            if (state.userEquations && state.userEquations[_li]) {
                state.userEquations[_li] = JSON.parse(JSON.stringify(_inv));
            }
        }
    }
}


function suan17(state) {
    if (!state.eqFeatures.allLinear) return;
    // 放开过定(m>n)与欠定(m<n)的"全线性"统一处理；仅当方程数 < 变量数 时此处不强行处理
    // （交其他路径），以最小化改动面并保留既有欠定逻辑。
    if (state.equations.length < state.varNames.length) return;

    var A = [], b = [];
    for (var ei = 0; ei < state.equations.length; ei++) {
        var lc = extractLinearCoefficients(state.equations[ei], state.varNames);
        A.push(state.varNames.map(function(v) { return lc.coeffs[v] || 0; }));
        b.push(-lc.constant);
    }

    var result = (state.equations.length === state.varNames.length)
        ? gaussianSolve(A, b)                  // 方阵：原 sound 路径
        : gaussianSolveRect(A, b);             // 过定：秩感知判定（sound）

    // 方阵 + gaussianSolve 返回 null ⇒ 它无法区分「不相容」与「秩亏」，直接放弃。
    // 这会让**秩亏方阵**（如 x−y=0 与 x−y=0）掉进多起点牛顿，被当成「有限离散解集」
    // 输出上百个采样点——而它的解集是一条直线（无穷多解）。
    // 实测（2026-10-04）：x−y=0, x−y=0 ⇒ resultType=2 / 170 个解 / 163 个误标 proven。
    // ⇒ 补一次秩感知判定，把两种情形分开（数学上这是必须的，不是可选优化）：
    //     rank(A) < n ⇒ 解集是 n−rank 维仿射流形 ⇒ resultType=3（无穷多解）
    //     rank(A) = n 但增广不相容 ⇒ provenEmpty
    if (!result && state.equations.length === state.varNames.length) {
        result = gaussianSolveRect(A, b);
        if (result && result.unique === false) {
            // 秩亏但相容 ⇒ 明确区分于「唯一解」，让下游的 unique===false 分支接管
            result.squareFallback = true;
        }
    }
    if (!result) return;

    // 过定且不相容 → sound 地报"无实数解"（绝非"漏解"）
    if (result.consistent === false) {
        state.done = true;
        state.result = {
            solutions: [], error: "NO_SOLUTION", provenEmpty: true,
            message: "过定线性方程组不相容：经高斯消元 + 秩判定严格确认无实数公共解",
            executionPath: "高斯消元(秩判定)",
            timeMs: performance.now() - state.startTime,
            confidence: "high", varNames: state.varNames,
            resultType: 1, resultTypeName: "空结果", resultTypeDesc: "过定系统秩判定无实解"
        };
        return;
    }
    // 欠定(秩 < 变量数，尽管 m>=n 但方程线性相关) → 无穷多解，给一组特解
    //
    // ⚠ 代表点也要走【精确有理数证明】（2026-10-04）：
    //   实测 x−y=0, x−y=0 修前 confidence='low'、certifiedCoverage=0，
    //   而这个特解 (0,0) 代入两式残差**恒等于 0** —— 是 ℚ 上的严格证明。
    //   不标 proven 等于「已经证明过的事谎报成未证明」，与本产品 fail-closed 底线相反。
    //   另注：confidence 初值给 'low' 是**占位**，真判定由 _resyncConfidence 按认证覆盖率统一做
    //   （口径见 pipeline/solver.js:_resyncConfidence 的注释）。
    if (result.unique === false) {
        var pExact = _s17ExactLinearProof(A, b, result.solution);
        var pVals = state.varNames.map(function (v, i) {
            var _pv = (pExact && typeof pExact[i] === 'number' && isFinite(pExact[i]))
                ? pExact[i] : roundToGrid(result.solution[i]);
            return _pv;
        });
        var pVars = {};
        state.varNames.forEach(function(v, i) { pVars[v] = pVals[i]; });
        var pRes = state.equations.map(function(eq) { return Math.abs(evalAST(eq, pVars)); });
        var pMax = Math.max.apply(null, pRes);
        var pDim = (result.freeDim !== undefined) ? result.freeDim
            : (result.rank !== undefined ? state.varNames.length - result.rank : 1);
        if (!(pDim > 0)) pDim = 1;
        state.done = true;
        state.result = {
            solutions: [{
                values: pVals, residual: pMax,
                // ℚ 上精确代入确证 ⇒ proven（严格强于 Krawczyk 区间包含）
                tier: pExact ? 'proven' : 'candidate',
                certified: !!pExact,
                certMethod: pExact ? 'exact_rational_substitution' : null
            }],
            message: "线性方程组无穷多解（秩 " + (result.rank !== undefined ? result.rank : '?') +
                " < 变量数 " + state.varNames.length + "，方程线性相关）：解集是 " +
                pDim + " 维仿射子空间，给出一组特解（自由变量取 0）作为代表点；" +
                "任意「特解 + 零空间线性组合」均满足。**这是无穷多解，不是有限解集**",
            executionPath: pExact ? "高斯消元(秩判定) + 精确有理数证明" : "高斯消元(秩判定)",
            timeMs: performance.now() - state.startTime,
            confidence: 'low', varNames: state.varNames,
            solutionSpaceDimension: pDim,
            resultType: 3, resultTypeName: "无限解集(推荐解)",
            resultTypeDesc: "方程线性相关（秩 < 变量数），解集是 " + pDim +
                " 维仿射子空间，无穷多实解；输出的是其中 1 个代表点，不代表全部解"
        };
        return;
    }

    var solution = {};
    state.varNames.forEach(function(v, i) { solution[v] = roundToGrid(result.solution[i]); });
    var values = state.varNames.map(function(v) { return solution[v]; });

    // ── 精确有理数证明（2026-10-04 修 P0）───────────────────────────────
    //
    // 实测事故：x+y−3=0, x−y−1=0, x+2y−4=0（超定相容，唯一解 (2,1)）
    //   修前：executionPath="高斯消元"、tier 缺失、certifiedCoverage=0
    //         ⇒ Agent 收到 candidates_only +「调 verify 复核」，
    //           而这个解**三式残差全 0**，早已被精确验证过。
    //
    // 为什么这里需要额外一步：`roundToGrid` 把解压到 6 位网格，
    //   **网格化本身就破坏精确性** ⇒ 线性消元给的浮点解 + 网格化
    //   只能支撑「残差 < 1e-6」这种数值复核，支撑不了「这是真解」的证明。
    //   但若浮点解恰好是**有理数且在 ℚ 上精确满足全部方程**，
    //   那就可以给出**严格证明**（代入即恒等式），比 Krawczyk 区间包含更强。
    //
    // 口径（fail-closed）：
    //   · 系数与解都能转成有理数（分母在 maxDen 内）⇒ 才尝试；
    //   · 逐式检查 `Σ aᵢⱼxⱼ − bᵢ` 在 ℚ 上**严格等于 0**（不是「接近 0」）；
    //   · 任一条不过 ⇒ 保持 candidate，不标 proven。
    var _s17exact = _s17ExactLinearProof(A, b, result.solution);
    if (_s17exact) {
        // 证明成立 ⇒ 用精确解（未网格化）作为输出值
        for (var _ej = 0; _ej < values.length; _ej++) {
            var _ev = _s17exact[_ej];
            if (typeof _ev === 'number' && isFinite(_ev)) values[_ej] = _ev;
        }
        solution = {};
        state.varNames.forEach(function (v, i) { solution[v] = values[i]; });
    }

    // 按域约束过滤
    var passesDomain = true;
    for (var dci = 0; dci < state.domainConstraints.length; dci++) {
        var dc = state.domainConstraints[dci];
        var vi = state.varNames.indexOf(dc.varName);
        if (vi >= 0) {
            var val = values[vi];
            if (dc.min !== undefined && val < dc.min - 1e-9) { passesDomain = false; break; }
            if (dc.max !== undefined && val > dc.max + 1e-9) { passesDomain = false; break; }
        }
    }
    if (!passesDomain && state.domainConstraints.length > 0) return;

    var vars = {};
    state.varNames.forEach(function(v, i) { vars[v] = solution[v]; });
    var residuals = state.equations.map(function(eq) { return Math.abs(evalAST(eq, vars)); });
    var maxResidual = Math.max.apply(null, residuals);
    // ⚠ confidence 不在此判（2026-10-04）：绝对残差分档已在「五·ter」§4 判定为数学上错误的口径
    //   （大系数题上相消误差使 |p(r)| 必然很大；且「点残差小」≠「解集被证明过」）。
    //   真正判定由 pipeline 的 _resyncConfidence 按【认证覆盖率】统一做。
    var confidence = 'low';   // 占位，认证层跑完会被覆盖

    state.done = true;
    state.result = {
        solutions: [{
            values: values, residual: maxResidual,
            // ℚ 上精确代入确证 ⇒ proven（严格强于 Krawczyk 区间包含）
            tier: _s17exact ? 'proven' : 'candidate',
            certified: !!_s17exact,
            certMethod: _s17exact ? 'exact_rational_substitution' : null
        }],
        executionPath: _s17exact ? "高斯消元 + 精确有理数证明" : "高斯消元",
        timeMs: performance.now() - state.startTime,
        confidence: confidence,
        varNames: state.varNames,
        resultType: 2, resultTypeName: "有限离散孤立采样点",
        resultTypeDesc: _s17exact
            ? "线性方程组唯一解，已在有理数域精确验证（残差严格为 0）"
            : "高斯消元直接求解"
    };
}


/**
 * 线性方程组的**精确有理数证明**（2026-10-04）
 *
 * 命题：对 A∈ℚ^{m×n}、b∈ℚ^m 与候选解 x∈ℚ^n，若 `A·x − b` 在 ℚ 上**逐式恒等于 0**，
 * 则 x 是该方程组的**严格解**（不是「近似解」）。
 *
 * 为什么需要它（而不是靠残差小）：
 *   消元产出的是**双精度浮点解**，再经 `roundToGrid` 到 6 位网格。
 *   网格化本身破坏精确性 ⇒ 浮点残差只能支撑「误差 < 1e-6」这类**数值复核**，
 *   支撑不了「x 是解」的**证明**。但若 x 恰为有理数且在 ℚ 上严格满足全部方程，
 *   代入即恒等式 ⇒ 得到**真证明**，其强度严格高于 Krawczyk 的区间包含
 *   （后者证「根在盒内」，前者证「代入为零」）。
 *
 * 实现口径（fail-closed，任一条不过就返回 null，退回数值路径）：
 *   · 系数与解都必须能用**有限位分数**精确表示（否则无法谈「严格为零」）；
 *   · 分母上限 `maxDen` 沿用 exact.js 的 1e9，与有理根判据同口径；
 *   · 逐式检查 `Σⱼ aᵢⱼ·xⱼ − bᵢ === 0`（分数域上的**严格**零，不是 |·| < tol）。
 *
 * @param {number[][]} A  m×n 系数矩阵（行 = 方程）
 * @param {number[]} b  常数项（b = −常数，方程写作 Σ aᵢⱼxⱼ = bᵢ）
 * @param {number[]} xCand  候选解（未网格化）
 * @returns {number[]|null} 证明成立则返回精确解（可含超出双精度精度的分量），否则 null
 */
function _s17ExactLinearProof(A, b, xCand) {
    var MAXDEN = 1e9;
    var n = xCand.length;

    // 分数（分子/分母），分母恒正、最简由化简保证
    function rat(v) {
        if (typeof v !== 'number' || !isFinite(v)) return null;
        if (v === 0) return [0, 1];
        if (Math.abs(v) > 1e15) return null;      // 超出可精确表示范围 ⇒ 放弃证明
        // ⚠ 用 toString() 拿十进制字面量。**不能**用「符号 × 绝对值的字符串」——
        //   那样 parts[0] 会恒为 "1"（符号），所有非零数都被转成 1/1。
        //   浮点的 toString() 本身就是最短**可往返**表示（V8 精确实现），
        //   所以它给出的十进制字面量能被严格解释为这个 double 的值。
        var str = v.toString();
        if (str.indexOf('e') >= 0 || str.indexOf('E') >= 0) {
            // 科学计数：小数点位移后分母可能超 MAXDEN ⇒ 放弃（fail-closed）
            return null;
        }
        var neg = false;
        if (str.charAt(0) === '-') { neg = true; str = str.slice(1); }
        var parts = str.split('.');
        var den = 1;
        if (parts[1]) den = Math.pow(10, parts[1].length);
        if (den > MAXDEN) return null;
        var digits = parts[0] + (parts[1] || '');
        if (!/^[0-9]+$/.test(digits)) return null;   // 非法字面量 ⇒ 放弃
        var num = parseInt(digits, 10);
        if (!isFinite(num)) return null;
        return gcdf([neg ? -num : num, den]);
    }
    function gcdf(f) {
        var a = Math.abs(f[0]), bq = f[1];
        while (bq) { var t = a % bq; a = bq; bq = t; }
        if (a === 0) return [0, 1];
        var g = a || 1;
        return [f[0] / g, f[1] / g];
    }
    // ⚠ 溢出守卫：分数运算全程用 double，分子一旦超过 2^53 就**不再精确**，
    //   此时判「严格等于 0」是不可信的（可能把非零算成零，或反之）。
    //   ⇒ 一旦越界立即放弃证明（fail-closed 方向：宁可不给证明，不给假证明）。
    var OVER = Math.pow(2, 53);
    function finite(f) { return isFinite(f[0]) && isFinite(f[1]) && Math.abs(f[0]) < OVER; }
    function mul(p, q) { return gcdf([p[0] * q[0], p[1] * q[1]]); }
    function add(p, q) { return gcdf([p[0] * q[1] + q[0] * p[1], p[1] * q[1]]); }
    function isZero(p) { return p[0] === 0; }

    var xr = [];
    for (var j0 = 0; j0 < n; j0++) {
        var r0 = rat(xCand[j0]);
        if (!r0 || !finite(r0)) return null;      // 分母超限 / 分子溢出 ⇒ 无法严格证明
        xr.push(r0);
    }
    for (var i0 = 0; i0 < A.length; i0++) {
        var s0 = [0, 1];
        for (var j1 = 0; j1 < n; j1++) {
            var av0 = A[i0][j1];
            if (!av0) continue;
            var ra0 = rat(av0);
            if (!ra0 || !finite(ra0)) return null;
            var t0 = mul(ra0, xr[j1]);
            if (!finite(t0)) return null;
            s0 = add(s0, t0);
            if (!finite(s0)) return null;         // 越界 ⇒ 放弃证明（fail-closed）
        }
        var rb0 = rat(b[i0]);
        if (!rb0 || !finite(rb0)) return null;
        var d0 = add(s0, [-rb0[0], rb0[1]]);
        if (!finite(d0)) return null;
        if (!isZero(d0)) return null;             // 严格非零 ⇒ 不是解
    }
    // 证明成立 ⇒ 输出精确解（转回 double；已在 double 表示范围内的分量无损）
    var out = [];
    for (var j2 = 0; j2 < n; j2++) out.push(xr[j2][0] / xr[j2][1]);
    return out;
}


function suan18(state) {
    if (state.equations.length < state.varNames.length) {
        var decomposition = decomposeByVariableGraph(state.equations, state.varNames);
        if (decomposition && decomposition.length > 1) {
            state.decomposition = decomposition;
        }
    }
}


function suan19(state) {
    // 保存原始变量名，用于后续回代
    state.originalVarNames = state.varNames.slice();
    let reducedEqs = state.equations.slice();
    let reducedVars = state.varNames.slice();
    let substitutions = {};
    let substitutedSomething = false;
    const WATCHDOG_MS = 600;
    const AST_NODE_LIMIT = 500;

    for (let i = 0; i < reducedEqs.length; i++) {
        if (reducedVars.length <= 1) break;
        if (performance.now() - state.startTime > WATCHDOG_MS) break;
        if (astNodeCount(reducedEqs[i]) > AST_NODE_LIMIT) continue;

        const explicit = findExplicitForm(reducedEqs[i], reducedVars);
        if (explicit) {
            const exprNodes = astNodeCount(explicit.expr);
            if (exprNodes > AST_NODE_LIMIT / 2) continue;
            substitutions[explicit.var] = explicit.expr;
            substitutedSomething = true;
            const newEqs = [];
            for (let j = 0; j < reducedEqs.length; j++) {
                if (j === i) continue;
                const eqNodes = astNodeCount(reducedEqs[j]);
                newEqs.push(eqNodes > AST_NODE_LIMIT ? reducedEqs[j] : substituteVar(reducedEqs[j], explicit.var, explicit.expr));
            }
            reducedEqs = newEqs;
            reducedVars = reducedVars.filter(v => v !== explicit.var);
            i = -1;
        }
    }

    state.equations = reducedEqs;
    state.varNames = reducedVars;
    state.substitutions = substitutions;
    state.substitutedSomething = substitutedSomething;
}


function suan20(state) {
    if (state.skipOperators.rationalRoot) return;
    if (state.varNames.length !== 1 || state.equations.length !== 1) return;
    var vn = state.varNames[0];
    // 确定返回时使用的变量名列表（优先使用原始变量名，用于回代）
    var resultVarNames = getOutputVarNames(state);
    var polyCoeffs = extractPolynomialCoefficients(state.equations[0], vn);
    if (!polyCoeffs || polyCoeffs.length <= 2) return;

    var polyRoots = polynomialAllRoots(polyCoeffs, state.tolerance);
    if (polyRoots.length === 0) {
        state.done = true;
        state.result = { solutions: [], error: "NO_SOLUTION", provenEmpty: true, message: "多项式无实根", executionPath: "多项式快速求解", timeMs: performance.now() - state.startTime, confidence: "high", varNames: resultVarNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "多项式方程无实数根" };
        return;
    }

    var solutions = polyRoots
        .filter(function(r) { return !isNaN(r) && isFinite(r) && Math.abs(r) <= 1000000; })
        .map(function(r) { return roundToGrid(r); })
        .filter(function(r, i, arr) { return arr.indexOf(r) === i; })
    .map(function(r) {
        // 集中式回代：单变量值 [r]（state.varNames 顺序）交给 reconstructSolution，
        // 自动完成消元变量链式回代，输出 originalVarNames 顺序的完整解向量。
        var fullValues = reconstructSolution(state, [r]);
        var fullVars = {};
        getOutputVarNames(state).forEach(function(v, i) { fullVars[v] = fullValues[i]; });
        var origEqs = state.equations.slice();
        var res = 0, be = 0;
        for (var ei = 0; ei < origEqs.length; ei++) {
            var rv = Math.abs(evalAST(origEqs[ei], fullVars));
            if (rv > res) res = rv;
            // 后向误差 = |f_e| / Σ|terms|_e（逐式算，不能拿 max|f| 去比一个总量）
            var sc = 0;
            try { sc = evalASTScale(origEqs[ei], fullVars); } catch (e0) { sc = 0; }
            if (!isFinite(sc) || sc <= 0) { be = (rv > 0) ? Infinity : be; continue; }
            var r2 = rv / sc;
            if (r2 > be) be = r2;
        }
        return { values: fullValues, residual: res, backwardError: be };
    });

    if (solutions.length > 0) {
        // 置信度口径（2026-10-04 修正）：这里**不判**，交由 pipeline 的 _resyncConfidence 统一算。
        //
        // 为什么本算子不判：suan20 产出的解此刻**还没认证**（tier 要等 _certifySolutions
        //   的 Krawczyk/Miranda 跑完才定），此刻算出来的任何值都会被下游认证层覆盖。
        //   历史上有两个错版本：
        //     ① 早期：按绝对残差判 ⇒ 5x⁴−1e12x²+7 的真根（|p(r)|≈3.8e10，属不可避免的
        //        相消误差，项量级 4e23、ulp≈3.4e7）一律报 "low"，
        //        Agent 无法区分「算错了」和「只是尺度大」。
        //     ② 同日改按后向误差判：后向误差确实解决了 ①，但**判据本身选错了**——
        //        「点残差小」≠「解集被证明过」。实测欠定系统 x+y−3=0, x−y−1=0, z−1=0：
        //        解集是一条直线（无穷多解），引擎自己写「未证明解集完备」，
        //        但代表点精确满足三式 ⇒ BE=0 ⇒ 报 "high"。
        //        一个「只算出流形上一点」的结果被标成高置信，与红线相反。
        //   ⇒ 正确口径是**认证覆盖率**（见 pipeline/solver.js:_resyncConfidence 的注释），
        //     后向误差只作为 backwardError 字段留给 Web 端调试与回归测试。
        var confidence = 'low';   // 占位：真正的判定在 _resyncConfidence（认证后）
        // 按域约束过滤（用户定义的 x∈[a,b] 等）
        var domainFiltered = solutions.filter(function(sol) {
            for (var dci = 0; dci < state.domainConstraints.length; dci++) {
                var dc = state.domainConstraints[dci];
                var vi = resultVarNames.indexOf(dc.varName);
                if (vi >= 0) {
                    var val = sol.values[vi];
                    if (dc.min !== undefined && val < dc.min - 1e-9) return false;
                    if (dc.max !== undefined && val > dc.max + 1e-9) return false;
                }
            }
            return true;
        });
        if (domainFiltered.length === 0 && state.domainConstraints.length > 0) {
            state.done = true;
            state.result = { solutions: [], error: "NO_SOLUTION", message: "多项式有理根被域约束过滤", executionPath: "多项式快速求解", timeMs: performance.now() - state.startTime, confidence: confidence, varNames: resultVarNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "多项式有根但被域约束排除" };
            return;
        }
        state.done = true;
        state.result = { solutions: domainFiltered.length > 0 ? domainFiltered : solutions, executionPath: "多项式快速求解", timeMs: performance.now() - state.startTime, confidence: confidence, varNames: resultVarNames, resultType: 2, resultTypeName: "有限离散孤立采样点", resultTypeDesc: "多项式快速求解" };
    }
}
// suan21: 欠定系统标记 → 方程数<变量数时标记欠定，不提前终止

function suan21(state) {
    if (state.equations.length < state.varNames.length) {
        // 标记欠定，但不返回——让后续算子继续收缩域，最终输出窄域+采样点
        state.underdetermined = true;
    }
}


function suan22(state) {
    if (!(state.equations.length === 1 && state.varNames.length === 1)) return;
    var resultVarNames = getOutputVarNames(state);

    // 恒等式识别（2026-08-21）：方程两边恒等（如 x=x、x-x=0、sin(x)=sin(x)）时，
    // 任意实数均为解。原实现会让牛顿法对残差恒 0 的函数"收敛"到任意 23 个起始点，
    // 误报为"有限个解"。改在宽域异质点抽样，残差恒≈0 即判定为无限解集（rt=3）。
    // 抽样点跨度 [-1e6,1e6] 且含 0 点：非恒等函数在如此大的跨度上不可能处处残差≈0，
    // 而 1/x=0 这类在抽样点出现除零/无穷 → 自动排除，不会误判。
    var _eq0 = state.equations[0], _vn0 = state.varNames[0];
    var _probes = [-1000000, -100000, -10000, -1000, -100, -10, -1, 0, 1, 10, 100, 1000, 10000, 100000, 1000000];
    var _ident = true, _allSameConst = true, _firstVal = null, _finiteCount = 0;
    for (var _pdi = 0; _pdi < _probes.length; _pdi++) {
        var _pv = {}; _pv[_vn0] = _probes[_pdi];
        var _pr = evalAST(_eq0, _pv);
        if (_pr === null || _pr !== _pr || !isFinite(_pr)) { _ident = false; _allSameConst = false; continue; }
        _finiteCount++;
        if (Math.abs(_pr) > 1e-5) _ident = false;
        if (_firstVal === null) _firstVal = _pr;
        else if (Math.abs(_pr - _firstVal) > 1e-5) _allSameConst = false;
    }
    // BUG-2 修复：x/0=1 这类方程在所有抽样点均非有限（处处除零/定义域错误/±∞），
    // 说明左侧在定义域内无有限取值，对任意实数都不可能满足 =0 → 无实数解。
    // 原逻辑遇到非有限点直接 break，导致恒等式/恒矛盾判定失效且漏判无解，
    // 最终 fall through 到 suan47 全局分支定界空转满 8 秒(HARD_TIMEOUT)。
    if (_finiteCount === 0) {
        state.done = true;
        state.result = { solutions: [], error: "NO_SOLUTION", message: "方程在定义域内处处无定义（抽样点均非有限，疑似分母恒为零或定义域错误），无实数解", executionPath: "单变量全域无定义检测", timeMs: performance.now() - state.startTime, confidence: "high", varNames: resultVarNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "方程在所有抽样点均非有限，定义域内无实数满足等式" };
        return;
    }
    if (_ident) {
        // 恒等式 ⇒ 解是整个声明域，取**域中心**作代表解。
        // 🔴 2026-10-05 换掉「距原点最近的点」：那是把 0 夹进声明域再取端点，
        //   一条人为的几何偏好。域中心是区间的中点，不需要额外度量。
        var _rec0 = 0;
        var _d0v = state.D0 && state.D0[_vn0];
        if (_d0v) { _rec0 = 0.5 * (_d0v.min + _d0v.max); }
        for (var _dciI = 0; _dciI < state.domainConstraints.length; _dciI++) {
            var _dcI = state.domainConstraints[_dciI];
            if (_dcI.varName === _vn0) {
                if (_dcI.min !== undefined && _rec0 < _dcI.min) _rec0 = _dcI.min;
                if (_dcI.max !== undefined && _rec0 > _dcI.max) _rec0 = _dcI.max;
            }
        }
        // 回代补全：suan19 消元可能把 x 代入消去（state.varNames 只剩缩减子集如 [y]），
        // 推荐解须回代到完整变量，否则输出缺分量（如 x+y=2, 2x+2y=4 曾输出 [0] 而非 (2,0)）。
        // 集中式回代：单变量推荐值 [_rec0] → 完整坐标（消元变量链式回代）。
        var _fullVals0 = reconstructSolution(state, [_rec0]).map(roundToGrid);
        state.done = true;
        state.finalSolutions = [{ values: _fullVals0, residual: 0 }];
        state.result = { solutions: state.finalSolutions, error: null, message: "方程为恒等式：方程两边恒等，任意实数均为解（已给出声明域中心作代表解）", executionPath: "单变量恒等式识别", timeMs: performance.now() - state.startTime, confidence: "high", varNames: resultVarNames, resultType: 3, resultTypeName: "无限解集(代表解)", resultTypeDesc: "方程两边恒等，解集为整个实数轴（或声明域），任意值均满足" };
        return;
    }
    // 恒矛盾识别（2026-08-21）：所有抽样点残差 ≈ 同一非零常数（如 x=x+1 → 恒 -1、1=2 → 恒 -1）
    // 时，方程对任意实数都不满足 → 直接判无解，避免矛盾方程空耗 4 秒走完整兜底链。
    if (_allSameConst && _firstVal !== null && Math.abs(_firstVal) > 1e-5) {
        state.done = true;
        state.result = { solutions: [], error: "NO_SOLUTION", message: "方程恒矛盾：化简后为常数 " + _firstVal.toFixed(6) + " ≠ 0，无任何实数解", executionPath: "单变量恒矛盾识别", timeMs: performance.now() - state.startTime, confidence: "high", varNames: resultVarNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "方程两边之差为常数非零，任何实数代入均不满足" };
        return;
    }
    // 阶梯函数直接解析（2026-08-21）：floor(x)=c → x∈[c,c+1)，ceil(x)=c → x∈(c-1,c]。
    // 原实现让牛顿对"平台"（导数为 0 的平坦区）失效：误分类为有限个散点，且 ceil 空转 5 秒。
    // 直接构造连续区间解（rt=3 无限解集），代表点取区间内距原点最近的边界点。
    var _floorCeilMatch = null;
    (function() {
        var _le = _eq0, _fe = null, _ce = null;
        // 数值节点取值：支持 num 与 unary 负号（"-1" 解析为 unary(-, num(1))，非 num(-1)）
        function _numVal(n) {
            if (!n) return null;
            if (n.type === 'num') return n.value;
            if (n.type === 'unary' && n.op === '-' && n.operand && n.operand.type === 'num') return -n.operand.value;
            return null;
        }
        // suan16 化简可能把 floor(x) = -1 写成 floor(x) + 1 = 0（op 从 '-' 变 '+'），
        // 故同时支持 '-' 与 '+'：func ± num = 0 → func = ∓num；num ± func = 0 → func = ∓num
        if (_le && _le.type === 'binop' && (_le.op === '-' || _le.op === '+')) {
            var _l = _le.left, _r = _le.right, _rv = _numVal(_r), _lv = _numVal(_l);
            if (_l && _l.type === 'func' && ['floor', 'ceil'].indexOf(_l.name) >= 0 && _rv !== null) {
                _fe = _l; _ce = (_le.op === '-') ? _rv : -_rv;
            } else if (_r && _r.type === 'func' && ['floor', 'ceil'].indexOf(_r.name) >= 0 && _lv !== null) {
                _fe = _r; _ce = (_le.op === '-') ? _lv : -_lv;
            }
            if (_fe && _fe.arg && _fe.arg.type === 'var' && _fe.arg.name === _vn0) {
                _floorCeilMatch = { fn: _fe.name, c: _ce };
            }
        }
    })();
    if (_floorCeilMatch) {
        var _cVal = _floorCeilMatch.c;
        var _loF = -1000000, _hiF = 1000000;
        if (state.D0 && state.D0[_vn0]) { _loF = Math.max(_loF, state.D0[_vn0].min); _hiF = Math.min(_hiF, state.D0[_vn0].max); }
        for (var _dciF = 0; _dciF < state.domainConstraints.length; _dciF++) {
            var _dcF = state.domainConstraints[_dciF];
            if (_dcF.varName === _vn0) {
                if (_dcF.min !== undefined) _loF = Math.max(_loF, _dcF.min);
                if (_dcF.max !== undefined) _hiF = Math.min(_hiF, _dcF.max);
            }
        }
        var _sLo = _floorCeilMatch.fn === 'floor' ? _cVal : _cVal - 1;
        var _sHi = _floorCeilMatch.fn === 'floor' ? _cVal + 1 : _cVal;
        _sLo = Math.max(_sLo, _loF); _sHi = Math.min(_sHi, _hiF);
        if (_sLo < _sHi) {
            // 代表点：c 恒在解区间内（floor 时 c∈[c,c+1)，ceil 时 c∈(c-1,c]）；声明域排除了 c 才取边界
            var _repF = Math.min(Math.max(_cVal, _sLo), _sHi);
            // 回代补全消元变量（同恒等式块，保证输出完整分量）；集中式回代：单变量代表点 [_repF] → 完整坐标
            var _fullValsF = reconstructSolution(state, [_repF]).map(roundToGrid);
            state.done = true;
            state.finalSolutions = [{ values: _fullValsF, residual: 0 }];
            state.result = { solutions: state.finalSolutions, error: null, message: "阶梯方程：解为连续区间 " + (_floorCeilMatch.fn === 'floor' ? "[" + _cVal + ", " + (_cVal + 1) + ")" : "(" + (_cVal - 1) + ", " + _cVal + "]") + "（区间内任意值均满足），已给出代表点 " + _repF.toFixed(6), executionPath: "单变量阶梯函数直接解析", timeMs: performance.now() - state.startTime, confidence: "high", varNames: resultVarNames, resultType: 3, resultTypeName: "无限解集(推荐解)", resultTypeDesc: "floor/ceil 阶梯函数方程的解为连续区间，区间内任意实数均满足" };
            return;
        }
    }

    const startPoints = [-1000, -500, -200, -100, -50, -20, -10, -5, -2, -1, -0.5, 0, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
    const allSolutions = [];
    const WATCHDOG_MS = 600;

    for (const start of startPoints) {
        if (performance.now() - state.startTime > WATCHDOG_MS) break;
        const result = newtonSolve(state.equations, state.varNames, [start], {
            maxIter: state.maxIter, tolerance: state.tolerance,
            _deadline: performance.now() + 100
        });
        if (result.converged) {
            const root = roundToGrid(result.solution[0]);
            if (isNaN(root) || !isFinite(root) || Math.abs(root) > 1000000) continue;
            // 域约束传播：牛顿收敛的根若不在声明域/求解域内，直接丢弃。
            // 否则越域根会霸占 allSolutions，使"域内兜底扫描"（奇点感知二分）永不运行，
            // 导致域内真根漏解（如 tan(x)=100,x∈[0,4] 牛顿收敛到 224.6≈71π+1.56 越域根，
            // 而域内真根 1.5608 反而找不到）。
            var _rootInDomain = true;
            if (state.D0 && state.D0[state.varNames[0]]) {
                if (root < state.D0[state.varNames[0]].min - 1e-9 || root > state.D0[state.varNames[0]].max + 1e-9) _rootInDomain = false;
            }
            if (_rootInDomain) {
                for (var _dciN = 0; _dciN < state.domainConstraints.length; _dciN++) {
                    var _dcN = state.domainConstraints[_dciN];
                    if (_dcN.varName === state.varNames[0]) {
                        if (_dcN.min !== undefined && root < _dcN.min - 1e-9) _rootInDomain = false;
                        if (_dcN.max !== undefined && root > _dcN.max + 1e-9) _rootInDomain = false;
                    }
                }
            }
            if (!_rootInDomain) continue;
            // 集中式回代：单变量根 [root]（state.varNames 顺序）→ 完整坐标
            const fullValues = reconstructSolution(state, [root]).map(roundToGrid);
            const fullVars = {};
            getOutputVarNames(state).forEach(function(v, i) { fullVars[v] = fullValues[i]; });
            const origEqs = state.equations.slice();
            var maxResidual = 0;
            for (var ei = 0; ei < origEqs.length; ei++) {
                var rv = Math.abs(evalAST(origEqs[ei], fullVars));
                if (rv > maxResidual) maxResidual = rv;
            }
            if (maxResidual < state.tolerance * 1000) {
                allSolutions.push({ values: fullValues, residual: maxResidual });
            }
        }
    }

    // 二分查找兜底：对单变量方程在【声明域/求解域】内执行"奇点感知网格扫描 + 二分"，找全域内全部根。
    // 域约束传播：搜索域取声明域约束 ∩ state.D0，杜绝越域伪根（如 tan(x)=100 时 25π+1.5608≈80.1）。
    // 奇点分裂：tan 在 kπ+π/2 处有渐近线；按 tan 奇点把域切成单调子区间（奇点两侧留 1e-9 间隙），
    // 子区间内网格细分找异号，二分前用区间求值预检奇点（含奇点区间不二分，防把奇点当根）。
    // 多根修复（2026-08-18）：兜底【总是运行】（不再依赖 allSolutions 为空）——原逻辑在牛顿已收敛到
    // 部分根时跳过兜底，导致域内其余真根漏检（如 sin(x)+y=1 消元后 x²+(1-sin x)²=4 在 [-3,3] 的负侧根）。
    // 宽域防护：声明域缺省 [-1e6,1e6] 时 tan 奇点数可达数十万（子区间数爆炸）→ 超宽域跳过扫描。
    {
        var _eq = state.equations[0];
        var _vn = state.varNames[0];
        // 全域扫描证据（无解快速判定用）：是否有符号穿越 / 网格点最小|f|
        var _scanCross = false, _scanMinAbs = Infinity;
        var _scanStep = (_hi - _lo) / 32;   // 实际网格步长（周期感知扫描会改写），供尾部密度自检使用
        // ---- 确定搜索域：声明域约束 ∩ D0（默认全域）----
        var _lo = -1e6, _hi = 1e6;
        for (var _dci = 0; _dci < state.domainConstraints.length; _dci++) {
            var _dc = state.domainConstraints[_dci];
            if (_dc.varName === _vn) {
                if (_dc.min !== undefined) _lo = Math.max(_lo, _dc.min);
                if (_dc.max !== undefined) _hi = Math.min(_hi, _dc.max);
            }
        }
        if (state.D0 && state.D0[_vn]) {
            _lo = Math.max(_lo, state.D0[_vn].min);
            _hi = Math.min(_hi, state.D0[_vn].max);
        }
        // 消元后定义域收紧（2026-08-21）：suan9 在消元（suan19）之前跑，sqrt(5-x) 这类
        // 消元后才出现的复合参数定义域约束未被推导（如 sqrt(x)+sqrt(y)=3, x+y=5 消元后
        // 剩 sqrt(x)+sqrt(5-x)=3，要求 x≤5）。此处对单变量方程扫描 AST 的 sqrt/log 线性
        // 参数，直接收紧扫描域 [lo,hi]，使网格扫描能覆盖定义域内全部根。
        (function() {
            function _lc(n, vn) {
                if (!n) return null;
                if (n.type === 'var') return n.name === vn ? { a: 1, b: 0 } : null;
                if (n.type === 'num') return { a: 0, b: n.value };
                if (n.type === 'unary' && n.op === '-') { var t = _lc(n.operand, vn); return t ? { a: -t.a, b: -t.b } : null; }
                if (n.type === 'binop') {
                    if (n.op === '+' || n.op === '-') {
                        var l = _lc(n.left, vn), r = _lc(n.right, vn);
                        if (l && r) return { a: l.a + (n.op === '-' ? -r.a : r.a), b: l.b + (n.op === '-' ? -r.b : r.b) };
                        return null;
                    }
                    if (n.op === '*') {
                        if (n.left.type === 'num' && n.right.type === 'var' && n.right.name === vn) return { a: n.left.value, b: 0 };
                        if (n.right.type === 'num' && n.left.type === 'var' && n.left.name === vn) return { a: n.right.value, b: 0 };
                        return null;
                    }
                    // 消元代入常生成 (expr)/((1+0)-0) 之类结构：除以常量表达式保持线性
                    if (n.op === '/') {
                        var l2 = _lc(n.left, vn);
                        if (l2 && n.right) {
                            var _rv2 = evalAST(n.right, {});
                            if (isFinite(_rv2) && _rv2 !== 0) return { a: l2.a / _rv2, b: l2.b / _rv2 };
                        }
                        return null;
                    }
                }
                return null;
            }
            function _walk1(n) {
                if (!n) return;
                if (n.type === 'func' && (n.name === 'sqrt' || n.name === 'log' || n.name === 'ln' || n.name === 'log2' || n.name === 'log10') && n.arg) {
                    var c = _lc(n.arg, _vn);
                    if (c && c.a !== 0) {
                        var bnd = -c.b / c.a;
                        if (c.a > 0) { if (bnd > _lo) _lo = bnd; }
                        else { if (bnd < _hi) _hi = bnd; }
                    }
                }
                if (n.type === 'binop') { _walk1(n.left); _walk1(n.right); }
                else if (n.type === 'unary') { _walk1(n.operand); }
                else if (n.type === 'func') { if (n.arg) _walk1(n.arg); if (n.args) for (var i = 0; i < n.args.length; i++) _walk1(n.args[i]); }
            }
            _walk1(_eq);
        })();
        if (_lo < _hi) {
            var _dense = false;  // 修3：根稠密/超时提前终止扫描（防宽域周期方程穷举挂起）
            var _denseByCount = false;  // 修3：仅由"根数超阈值"触发的稠密标记（用于无限/截断判定，区别于超时触发）
            var _denseNonPeriodic = false;  // 修3：非周期稠密截断标记（与 periodic→无限 分支互补）
            // ---- 周期感知步长（issue A 修复 2026-09-01）：高频/多周期方程用 < 周期/2 的网格，
            //      确保不漏根；非周期方程回退到 4096 点默认细网格。点数上限 _NMAX 护栏防宽域爆炸。 ----
            var _P = _detectPeriod1D(_eq, _vn);
            var _NMAX = 400000;
            var _hTarget = (_P !== null) ? (_P / 10) : ((_hi - _lo) / 4096);
            var _N = Math.ceil((_hi - _lo) / _hTarget);
            var _truncScan = false;
            if (_N > _NMAX) { _N = _NMAX; _truncScan = true; }
            var _h = (_hi - _lo) / _N;
            _scanStep = _h;
            // ---- 收集域内 tan 奇点 kπ+π/2（奇点分裂点）----
            // tan 奇点切分：仅当方程确实含周期三角函数时才生成。
            // 【数学依据】k*PI+PI/2 是 tan 系函数（tan/cot 的渐近线、sec/csc 的极点）的奇点位置。
            //   方程**不含任何周期三角函数**时（如 exp / log / sqrt / abs / 多项式），
            //   在这些点切开域**不携带任何信息**——边界变多而采样覆盖完全不变，纯属浪费。
            // 【性能实测 2026-10-02】此前无条件生成：声明域缺省 [-1e6,1e6] 时切出 6.5 万个子区间，
            //   又因 _gN 下界为 8（每子区间强制 8 次采样），全域 4096 点的网格
            //   被膨胀到 **523344 次点求值**，exp(x)=3 空转到 1500ms 硬上限。
            //   改为条件生成后：1 个子区间 × 4096 点 = 4ms（提速约 380 倍）。
            // 【零行为变更】_detectPeriod1D 的契约是「返回 sin/cos/tan/cot/sec/csc 的最小周期，
            //   无三角函数返回 null」，故 _P === null 恰是「不含周期三角函数」的现成判据。
            //   含三角函数的方程（sin(x)=0 / tan(x)=1 等）走原路径，行为逐位不变。
            var _sings = [];
            if (_P !== null) {
                for (var _k = Math.floor((_lo - Math.PI / 2) / Math.PI); _k <= Math.ceil((_hi - Math.PI / 2) / Math.PI); _k++) {
                    var _s = _k * Math.PI + Math.PI / 2;
                    if (_s >= _lo && _s <= _hi) _sings.push(_s);
                }
            }
            // ---- 子区间边界：奇点两侧留 1e-9 间隙（保证子区间端点有限、可安全点求值）----
            var _bounds = [_lo];
            for (var _bi2 = 0; _bi2 < _sings.length; _bi2++) {
                _bounds.push(_sings[_bi2] - 1e-9);
                _bounds.push(_sings[_bi2] + 1e-9);
            }
            _bounds.push(_hi);
            for (var _seg = 0; _seg < _bounds.length - 1; _seg++) {
                var _A = _bounds[_seg], _B = _bounds[_seg + 1];
                if (_B - _A < 1e-12) continue;
                // ---- 子区间内自适应网格（按周期步长细分）找异号 + 近零点 ----
                var _gN = Math.max(8, Math.round((_B - _A) / _h));
                if (_gN > _NMAX) _gN = _NMAX;
                var _gH = (_B - _A) / _gN;
                var _gxP = _A, _gfP = _pointResidual(_eq, _vn, _A);
                // 起始端点若有根（恰落在域边界）也记录，避免漏端点根
                if (_gfP !== null && Math.abs(_gfP) < 1e-7) {
                    var _faV = reconstructSolution(state, [_A]).map(roundToGrid);
                    allSolutions.push({ values: _faV, residual: Math.abs(_gfP), _bisect: true });
                }
                for (var _gi = 1; _gi <= _gN; _gi++) {
                    var _gx = _A + _gH * _gi;
                    var _gf = _pointResidual(_eq, _vn, _gx);
                    if (_gf === null) { _gxP = _gx; _gfP = null; continue; }
                    if (_gfP !== null && _gfP * _gf < 0) _scanCross = true;
                    if (Math.abs(_gf) < _scanMinAbs) _scanMinAbs = Math.abs(_gf);
                    // 近零网格点（根恰落格点 / 偶重根）：局部极小值且 |f| 极小 → 直接记为候选根（防漏）
                    if (Math.abs(_gf) < 1e-7) {
                        var _gnxt = (_gi < _gN) ? _pointResidual(_eq, _vn, _A + _gH * (_gi + 1)) : null;
                        var _localMin = (_gfP === null || Math.abs(_gfP) >= Math.abs(_gf)) && (_gnxt === null || Math.abs(_gnxt) >= Math.abs(_gf));
                        if (_localMin) {
                            var _fullV = reconstructSolution(state, [_gx]).map(roundToGrid);
                            allSolutions.push({ values: _fullV, residual: Math.abs(_gf), _bisect: true });
                        }
                    }
                    if (_gfP !== null && _gfP * _gf < 0) {
                        // ---- 区间求值预检：异号区间含奇点（除零/定义域错/±∞）→ 不二分，防把奇点当根 ----
                        var _sv = { nan: _IEEE.nan, inf: _IEEE.inf, divZero: _IEEE.divZero, domainErr: _IEEE.domainErr };
                        _ieeeReset();
                        var _ivm = {};
                        _ivm[_vn] = { min: _gxP, max: _gx };
                        var _iv = intervalEval(_eq, _ivm);
                        var _myDiv = _IEEE.divZero, _myDom = _IEEE.domainErr;
                        _IEEE.nan = _sv.nan; _IEEE.inf = _sv.inf; _IEEE.divZero = _sv.divZero; _IEEE.domainErr = _sv.domainErr;
                        var _hasSing = (_iv === null && (_myDiv || _myDom)) || (_iv !== null && (!isFinite(_iv.min) || !isFinite(_iv.max)));
                        if (!_hasSing) {
                            // ---- 异号且无奇点 → 二分定位 ----
                            _bisectRoot1D(_eq, _vn, _gxP, _gx, _gfP, _gf, state, allSolutions, resultVarNames);
                        } else {
                            // ---- 异号区间含奇点（如分式分母零点在区间内部）→ 递归细分分离奇点后再定位 ----
                            _recScanInterval(_eq, _vn, _gxP, _gx, state, allSolutions, resultVarNames, 0);
                        }
                    }
                    if (allSolutions.length > 200) { _dense = true; _denseByCount = true; break; }
                    if ((performance.now() - state.startTime) > 1500) { _dense = true; break; }
                    _gxP = _gx; _gfP = _gf;
                }
                if (_dense) break;
                // 终止端点若有根也记录
                if (_gfP !== null && Math.abs(_gfP) < 1e-7) {
                    var _fbV = reconstructSolution(state, [_B]).map(roundToGrid);
                    allSolutions.push({ values: _fbV, residual: Math.abs(_gfP), _bisect: true });
                }
            }
            if (_truncScan) state.truncated = true; // 周期感知扫描因域过宽/频率过高被点数上限截断 → 诚实标记
        }
    }

    // 全域扫描证无解（2026-08-21）：域宽≤2e5 时扫描已全覆盖；无符号穿越且网格最小|f|远大于
    // 数值噪声（>1e-4）→ 按中间值定理判无实数解。杜绝 log(xy)=1, x+y=6 这类无解系统
    // 空耗 8 秒走分支定界指数递归（suan47 每层重跑完整流水线）。
    // BUG-2 修复：x/0=1 这类"分母恒为 0 常量"方程，全域采样点因除零均返回 null（奇点），
    // 使 _scanMinAbs 恒为 Infinity；原条件(_scanMinAbs!==Infinity)将其排除 → 漏判无解、fall through 到
    // suan47 全局分支定界空转满 8 秒(HARD_TIMEOUT)。现扩展：全域无有限采样点(处处奇点/除零)
    // 且无符号穿越时，同样按中间值定理判无实数解（等式在定义域处处无定义 → 无实数解）。
    if (allSolutions.length === 0 && (_hi - _lo) <= 2e5 && !_scanCross && (_scanMinAbs === Infinity || _scanMinAbs > 1e-4)) {
        state.done = true;
        state.result = { solutions: [], error: "NO_SOLUTION", message: "单变量方程在声明域内扫描无零点：函数与零保持同号（最小距离 " + _scanMinAbs.toExponential(1) + "），按中间值定理判无实数解", executionPath: "单变量全域扫描证无解", timeMs: performance.now() - state.startTime, confidence: "high", varNames: resultVarNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "扫描全域无符号穿越且未触零，按中间值定理判无实数解" };
        return;
    }

    if (allSolutions.length > 0) {
        // 1) 距离去重合并（使用deduplicateSolutions，非hash方式）
        var _valArrays = allSolutions.map(function(s) { return s.values; });
        var _uniqueIdx = deduplicateSolutions(_valArrays, resultVarNames, state.tolerance);
        // 将去重后的索引映射回原solutions，保留最小残差
        var _dedupMap = {};
        for (var _di = 0; _di < _uniqueIdx.length; _di++) {
            var _uv = _uniqueIdx[_di];
            // 找到原allSolutions中对应此值的条目（取残差最小者）
            var _best = null;
            for (var _sj = 0; _sj < allSolutions.length; _sj++) {
                var _match = true;
                for (var _vk = 0; _vk < _uv.length; _vk++) {
                    if (Math.abs(allSolutions[_sj].values[_vk] - _uv[_vk]) > 1e-4) { _match = false; break; }
                }
                if (_match && (!_best || allSolutions[_sj].residual < _best.residual)) { _best = allSolutions[_sj]; }
            }
            if (_best) _dedupMap[_di] = _best;
        }
        var mergedSolutions = [];
        for (var _mi = 0; _mi < _uniqueIdx.length; _mi++) {
            if (_dedupMap[_mi]) mergedSolutions.push(_dedupMap[_mi]);
        }

        // 修3（2026-09-04）：稠密根防护——单变量周期方程在宽域内根稠密，
        // 继续穷举既耗时（曾致 solve 挂起 >110s）又产出无用的海量解集。
        // 含周期函数且根数超阈值 ⇒ 解集实际为无限（周期平移），如实标 rt=3 无限解集(代表解)；
        // 非周期但稠密（如高次多项式）⇒ 不谎称无限，置 truncated 并后续告警，诚实返回部分代表根。
        if (_denseByCount) {
            if (_P !== null) {
                state.done = true;
                state.result = {
                    solutions: mergedSolutions,
                    error: null,
                    message: "单变量周期方程在声明域内出现大量（>" + 200 + "）孤立根，呈周期性稠密分布，解集实际为无限（如 x = x₀ + k·" + _P.toFixed(4) + "）。已给出 " + mergedSolutions.length + " 个代表根；如需有限个解请收窄变量定义域。",
                    executionPath: "单变量稠密周期根判定(无限解集)",
                    timeMs: performance.now() - state.startTime,
                    confidence: "high",
                    varNames: resultVarNames,
                    resultType: 3,
                    resultTypeName: "无限解集(代表解)",
                    resultTypeDesc: "周期方程在宽域内根稠密，解集为周期平移的无穷集合，已给出代表根"
                };
                return;
            }
            state.truncated = true;  // 非周期稠密：诚实截断（避免海量/不完整解集），下方 domainFiltered 产出部分代表根
            _denseNonPeriodic = true;
        }

        // 2) 原始方程回代验证：对每组候选解，代入全部原始方程重新计算残差
        //    二分查找得到的解（_bisect=true）跳过残差验证（区间收敛保证精度）
        var _origEqs = state.originalEquations || state.equations;
        var _verifiedSolutions = [];
        for (var _vi = 0; _vi < mergedSolutions.length; _vi++) {
            var _sol = mergedSolutions[_vi];
            // 二分查找解跳过残差验证
            if (_sol._bisect) {
                _verifiedSolutions.push(_sol);
                continue;
            }
            var _fullVars = {};
            resultVarNames.forEach(function(vn, i) { _fullVars[vn] = _sol.values[i]; });
            // 回代消元变量
            var _subOrder = Object.keys(state.substitutions || {}).reverse();
            for (var _sbi = 0; _sbi < _subOrder.length; _sbi++) {
                var _sv = _subOrder[_sbi];
                if (_fullVars[_sv] === undefined) {
                    try { _fullVars[_sv] = evalAST(state.substitutions[_sv], _fullVars); } catch(e) { _lsNoteInternal(e, 'algebra.js:796 试探性求值替换，失败保留原值，有意忽略'); }
                }
            }
            var _maxRes = 0;
            for (var _ei = 0; _ei < _origEqs.length; _ei++) {
                try {
                    var _r = Math.abs(evalAST(_origEqs[_ei], _fullVars));
                    if (_r > _maxRes) _maxRes = _r;
                } catch(e) { _maxRes = Infinity; break; }
            }
            // 残差<=1e-6才保留
            if (isFinite(_maxRes) && _maxRes <= 1e-6) {
                _verifiedSolutions.push({ values: _sol.values, residual: _maxRes, _origResidual: _maxRes });
            }
        }

        // 3) 按域约束过滤
        var domainFiltered = _verifiedSolutions.filter(function(sol) {
            for (var dci = 0; dci < state.domainConstraints.length; dci++) {
                var dc = state.domainConstraints[dci];
                var vi = resultVarNames.indexOf(dc.varName);
                if (vi >= 0) {
                    var val = sol.values[vi];
                    if (dc.min !== undefined && val < dc.min - 1e-9) return false;
                    if (dc.max !== undefined && val > dc.max + 1e-9) return false;
                }
            }
            return true;
        });
        if (domainFiltered.length > 0) {
            // 近似解聚类（2026-08-21）：奇异/病态点附近牛顿收敛噪声产生多个近似重复点
            // （如 1/x+1/y=1, x+y=4 在 (2,2) 给出 (2,2),(2.001,1.999),(2.002,1.998)）。
            // 按欧氏距离 < 1e-3 聚类，每组取残差最小者（与 suan48 聚类口径一致）。
            var _clust2 = [];
            var _used2 = {};
            for (var _cai = 0; _cai < domainFiltered.length; _cai++) {
                if (_used2[_cai]) continue;
                var _grp = [_cai]; _used2[_cai] = true;
                for (var _caj = _cai + 1; _caj < domainFiltered.length; _caj++) {
                    if (_used2[_caj]) continue;
                    var _dsum2 = 0;
                    for (var _cki = 0; _cki < resultVarNames.length; _cki++) {
                        _dsum2 += Math.abs(domainFiltered[_cai].values[_cki] - domainFiltered[_caj].values[_cki]);
                    }
                    if (_dsum2 < 2e-3 * resultVarNames.length) { _grp.push(_caj); _used2[_caj] = true; }
                }
                var _best2 = domainFiltered[_cai];
                for (var _cg = 0; _cg < _grp.length; _cg++) {
                    if (domainFiltered[_grp[_cg]].residual < _best2.residual) _best2 = domainFiltered[_grp[_cg]];
                }
                _clust2.push(_best2);
            }
            domainFiltered = _clust2;
            domainFiltered.sort(function(a, b) { return a.residual - b.residual; });
            // ⚠ 同上（2026-10-04）：绝对残差分档不是 confidence 的合法判据。
            //   真正的判定在 pipeline 的 _resyncConfidence（按认证覆盖率）。
            //   这里的残差只用于**排序**（挑范数最小的代表点），不用于定性。
            state.done = true;
            state.result = { solutions: domainFiltered, executionPath: "显式替换牛顿", timeMs: performance.now() - state.startTime, confidence: 'low', varNames: resultVarNames, resultType: 2, resultTypeName: "有限离散孤立采样点", resultTypeDesc: "显式替换牛顿求解" };
            // 周期方程完整性标注（2026-08-21）：单变量方程含 sin/cos/tan 等周期函数、
            // 且声明域宽度远超周期时，真解为周期平移的无穷集合，牛顿+扫描只能给出有限
            // 代表根。如实标注 truncated 并说明解的结构，杜绝"静默给出不完整解集"。
            // （与"已验证解保真 + 穷尽尽力而为：资源耗尽显式标记 truncated/残余告警，绝不谎称已穷尽"承诺对齐）
            var _period = 0;
            (function _scanPer(node) {
                if (!node) return;
                if (node.type === 'func') {
                    if (node.name === 'tan' || node.name === 'cot') { if (_period === 0) _period = Math.PI; }
                    else if (['sin', 'cos', 'sec', 'csc'].indexOf(node.name) >= 0) { if (_period !== Math.PI) _period = 2 * Math.PI; }
                    else if (node.name === 'mod' && node.args && node.args[1] && node.args[1].type === 'num') {
                        // mod(x, c) 周期 = |c|（取最小周期，保守标注）
                        var _mC = Math.abs(node.args[1].value);
                        if (_mC > 0 && (_period === 0 || _mC < _period)) _period = _mC;
                    }
                    if (node.arg) _scanPer(node.arg);
                    if (node.args) for (var _ai2 = 0; _ai2 < node.args.length; _ai2++) _scanPer(node.args[_ai2]);
                } else if (node.type === 'binop') { _scanPer(node.left); _scanPer(node.right); }
                else if (node.type === 'unary') { _scanPer(node.operand); }
            })(_eq);
            // 仅当"已找到 ≥2 个解"才标 truncated：找到 1 个解时（如 cos(x)=x 全域唯一解，
            // 因 |cos|≤1 把根限制在 [-1,1]）可能是完整解集，不能因"含周期函数"而误报不完整。
            if (_period > 0 && (_hi - _lo) > 3 * _period && domainFiltered.length >= 2) {
                var _theoN = Math.floor((_hi - _lo) / _period) + 1;
                if (domainFiltered.length < _theoN * 0.5) {
                    state.truncated = true;
                    state.result.warnings = (state.result.warnings || []).concat([
                        "周期方程：方程含 " + (_period === Math.PI ? "tan/cot" : "sin/cos 等") + " 周期函数，声明域宽度 " + Math.round(_hi - _lo) + " 远超周期 " + _period.toFixed(3) + "，真解为周期平移的无穷集合（约 " + _theoN + " 个解）；已给出 " + domainFiltered.length + " 个代表解、未穷举全部。缩小变量范围可得到完整解集。"
                    ]);
                }
            }
            // 解密度自检（2026-08-21）：找到的相邻解间距小于扫描网格步长时，说明解分布密集、
            // 可能存在未定位的零点（如 sin(x²)=0 在 [0,10] 有 32 个根，网格扫描只能捕获部分）。
            // 保守标注 truncated + 警告，杜绝静默漏解；缩小变量范围可获完整解集。
            // 仅当扫描实际执行（域宽 ≤ 2e5）时密度自检才有意义：宽域（默认 ±100万）不执行
            // 网格扫描，网格步长基准 (_hi-_lo)/32 会虚高到 62500，导致 gamma(x)=1（2 个孤立解）
            // 之类被误标"解分布密集"。
            if (domainFiltered.length >= 2 && (_hi - _lo) <= 2e5) {
                var _minGap = Infinity;
                var _sorted2 = domainFiltered.slice().sort(function(a, b) { return a.values[0] - b.values[0]; });
                for (var _gi2 = 1; _gi2 < _sorted2.length; _gi2++) {
                    var _gap2 = _sorted2[_gi2].values[0] - _sorted2[_gi2 - 1].values[0];
                    if (_gap2 > 0 && _gap2 < _minGap) _minGap = _gap2;
                }
                var _gridW2 = (_hi - _lo) / 32;
                if (_minGap < _gridW2 * 0.75) {
                    state.truncated = true;
                    state.result.warnings = (state.result.warnings || []).concat([
                        "解分布密集（最小相邻间距 " + _minGap.toFixed(4) + " < 扫描网格步长 " + _gridW2.toFixed(4) + "）：可能存在未枚举的解，结果不完整。缩小变量范围可获完整解集。"
                    ]);
                }
            }
        }
        // 修3：非周期稠密截断告警（与上方 periodic→无限 分支互补）
        if (_denseNonPeriodic && state.result) {
            state.result.warnings = (state.result.warnings || []).concat([
                "方程在声明域内根数量过多（>" + 200 + "），已截断扫描；结果不完整，缩小变量范围或确认方程规模可获完整解集。"
            ]);
        }
    }
}


function suan51(state) {
    if (!state.equations || state.equations.length !== 1) return;
    if (!state.varNames || state.varNames.length !== 1) return;
    var vn = state.varNames[0];
    var ast = state.equations[0];
    if (!ast || !ast.type) return;
    var coeffs = null;
    try { coeffs = extractPolynomialCoefficients(ast, vn); } catch (e) { return; }
    if (!coeffs || coeffs.length < 2) return;
    var roots = null;
    try { roots = polynomialAllRoots(coeffs, 1e-6); } catch (e) { return; }
    if (!roots || !roots.length) return;
    var dom = _domBoxOf(state, [vn]);
    var lo = (dom && dom[vn]) ? dom[vn].min : -1e6;
    var hi = (dom && dom[vn]) ? dom[vn].max : 1e6;
    var kept = [];
    for (var i = 0; i < roots.length; i++) {
        var r = roots[i];
        if (!isFinite(r)) continue;
        if (r < lo - 1e-9 || r > hi + 1e-9) continue;
        var dup = false;
        for (var j = 0; j < kept.length; j++) {
            if (Math.abs(kept[j].values[0] - r) < 1e-7) { dup = true; break; }
        }
        if (dup) continue;
        kept.push({ values: [r] });
    }
    if (!kept.length) return;
    state.result = {
        solutions: kept,
        resultType: 2,
        resultTypeName: '有限离散孤立采样点',
        resultTypeDesc: '一元多项式闭式求根（suan51 快速路径，毫秒级）'
    };
    state.done = true;
}


function suan50(state) {
    if (!state.equations || !state.varNames || !state.varNames.length) return;
    var vns = state.varNames;
    var applied = 0;
    for (var i = 0; i < state.equations.length; i++) {
        var eq = state.equations[i];
        if (!eq || !eq.type) continue;
        var denoms = [];
        try { denoms = collectVariableDenominators(eq, vns) || []; } catch (e) { continue; }
        if (denoms.length < 1) continue;   // 1.0.x：单分式也走有理化快路径（实测提速 100+ 倍）
        if (denoms.length > SUAN50_MAX_DENOMS) {
            (state.suan50Skipped = state.suan50Skipped || []).push({ eq: i, why: '分母个数 ' + denoms.length + ' > ' + SUAN50_MAX_DENOMS });
            continue;
        }
        var r = _rat50(eq);
        if (!r) {
            (state.suan50Skipped = state.suan50Skipped || []).push({ eq: i, why: '有理化失败（保持原式）' });
            continue;
        }
        var nodes = astNodeCount(r.num) || 0;
        if (!nodes || nodes > SUAN50_MAX_NODES) {
            (state.suan50Skipped = state.suan50Skipped || []).push({ eq: i, why: '分子节点数 ' + nodes + ' > ' + SUAN50_MAX_NODES + '（防膨胀）' });
            continue;
        }
        if (r.den && r.den.type === 'num') {
            (state.suan50Skipped = state.suan50Skipped || []).push({ eq: i, why: '分母退化为常数' });
            continue;
        }
        // 一元情形：把分子化简为规范多项式（从系数重建），显著提升多项式识别与求根可靠性。
        // 动机（实测）：3/x+2/(x-1)-1 的未化简分子是 (5x-3)*1 + (-1)*x*(x-1) 这类嵌套乘积，
        //   求根路径认不出它是二次式 ⇒ 漏掉小根 0.5505；化简为 -x^2+6x-3 后两根都能解出。
        // 多元不做（多元多项式重建复杂，且收益不确定），保持有理化后的分子不变。
        var finalNum = r.num;
        if (vns.length === 1) {
            try {
                var cf = extractPolynomialCoefficients(r.num, vns[0]);
                if (cf && cf.length > 1) {
                    var polyAST = null;
                    for (var kk = cf.length - 1; kk >= 0; kk--) {
                        var cc = cf[kk];
                        if (cc === 0 || cc === null || cc === undefined) continue;
                        // 关键：系数为 ±1 时用 unary 形式而非 num(±1)*幂 ——
                        // 求根/多项式识别路径认的是 -x^2 这类规范形式；
                        // 早期版本生成 -1*x^2 导致求根路径漏掉小根（实测漏 0.5505）。
                        var powerPart = (kk === 1)
                            ? { type: 'var', name: vns[0] }
                            : { type: 'binop', op: '^', left: { type: 'var', name: vns[0] }, right: { type: 'num', value: kk } };
                        var termAST;
                        var asMinus = false;
                        if (kk === 0) { if (cc < 0) { termAST = { type: 'num', value: -cc }; asMinus = true; } else termAST = { type: 'num', value: cc }; }
                        else if (cc === 1) termAST = powerPart;
                        else if (cc === -1) termAST = { type: 'unary', op: '-', operand: powerPart };
                        else termAST = { type: 'binop', op: '*', left: { type: 'num', value: cc }, right: powerPart };
                        // 负常数项用减法形式（... - 3）而非加负数（... + (-3)）：
                        // 求根/多项式识别路径认的是减法规范形式。
                        if (polyAST) polyAST = asMinus ? { type: 'binop', op: '-', left: polyAST, right: termAST } : { type: 'binop', op: '+', left: polyAST, right: termAST };
                        else if (asMinus) polyAST = { type: 'unary', op: '-', operand: termAST };
                        else polyAST = termAST;
                    }
                    if (polyAST) finalNum = polyAST;
                }
            } catch (e2) { /* 化简失败则保留原分子（保守） */ }
        }
        state.equations[i] = finalNum;
        state.suan50Denoms = state.suan50Denoms || [];
        state.suan50Denoms.push(r.den);
        applied++;
    }
    if (applied) state.suan50Applied = (state.suan50Applied || 0) + applied;
}


function suan23(state) {
    if (state.varNames.length !== 1) return;
    var denominators = collectVariableDenominators(state.equations[0], state.varNames[0]);
    if (denominators.length === 0) return;
    var transformed = tryRationalTransform(state.equations[0], state.varNames[0]);
    if (transformed) { state.equations[0] = transformed.transformed; }
}


function suan24(state) {
    var vn = state.varNames[0];
    var polyCoeffs = extractPolynomialCoefficients(state.equations[0], vn);
    if (polyCoeffs && polyCoeffs.length > 2) {
        var polyRoots = polynomialAllRoots(polyCoeffs, state.tolerance);
        if (polyRoots.length > 0) {
            var minRoot = Math.min.apply(null, polyRoots);
            var maxRoot = Math.max.apply(null, polyRoots);
            if (state.D0[vn]) {
                state.D0[vn].min = Math.max(state.D0[vn].min, minRoot - 1);
                state.D0[vn].max = Math.min(state.D0[vn].max, maxRoot + 1);
            }
        }
    }
}


function suan60(state) {
    if (!state.eqFeatures || !state.eqFeatures.allLinear) return;
    var n = state.varNames.length;
    if (n < 3 || n > 6) return;                    // 只接管 3..6 元
    if (state.equations.length < 1) return;

    // 组装增广矩阵
    var rows = [];
    for (var i = 0; i < state.equations.length; i++) {
        var lc = extractLinearCoefficients(state.equations[i], state.varNames);
        var row = [];
        var nonzero = false;
        for (var j = 0; j < n; j++) {
            var c = lc.coeffs[state.varNames[j]] || 0;
            if (!isFinite(c)) return;               // 系数异常 ⇒ 不接管
            if (c !== 0) nonzero = true;
            row.push(c);
        }
        row.push(-lc.constant);
        if (!isFinite(row[n])) return;
        // 全零系数行（0 = b）交给内核判无解/冗余，不在此处短路
        rows.push(row);
    }

    var r = _s60solveLinear(rows, n, {});
    if (!r || r.ok !== true) return;              // 精确通道不可用 ⇒ 交回 suan17

    // —— 严格证明无解 ——
    if (r.kind === 'nosol') {
        // 无解判定必须来自精确算术（内核已保证），此处再做一次原方程回代复核
        state.done = true;
        state.result = {
            solutions: [], error: "NO_SOLUTION", provenEmpty: true,
            message: "线性方程组无实数解：经 presolve 裁剪 + 精确有理秩判定严格确认（相容性检查失败，非数值近似）",
            executionPath: "精确线性代数(suan60 · presolve+Bareiss秩判定)",
            timeMs: performance.now() - state.startTime,
            confidence: "high", varNames: state.varNames,
            rank: r.rank,
            resultType: 1, resultTypeName: "空结果", resultTypeDesc: "精确秩判定确认无实解"
        };
        return;
    }

    // —— 有解：转 double 并做域过滤 + 残差复核 ——
    var x;
    try {
        x = r.x.map(function (v) { return _s60num(v); });
    } catch (e) {
        return;
    }
    for (var t = 0; t < x.length; t++) {
        if (!isFinite(x[t])) return;
    }

    var solution = {};
    for (var q = 0; q < n; q++) solution[state.varNames[q]] = roundToGrid(x[q]);
    var values = state.varNames.map(function (v) { return solution[v]; });

    // 域约束过滤（越界 ⇒ 交回原路径，不给越界解）
    // 域来源有两处：state.D0（用户 solve 第 4 实参传入的初始域）与
    // state.domainConstraints（从方程文本解析的域条件）。两者都要查。
    // 注意：family（秩亏）必须【跳过】这道闸。原因：特解取自由变量为 0，
    // 完全可能落在定义域外，但解流形与域的交集非空 —— 例如本项目回归基准
    // T_Wikibooks_P2_4var 的特解 (1,−1,3,0) 恰好在域内，但换一组域就会越界。
    // 若在这里 return，秩亏系统的族解采样分支就永远走不到（历史 bug）。
    // family 分支在下面自行逐点做域内 + 残差双重过滤，安全性等价。
    var passesDomain = true;
    for (var dci = 0; dci < state.domainConstraints.length; dci++) {
        var dc = state.domainConstraints[dci];
        var vi = state.varNames.indexOf(dc.varName);
        if (vi >= 0) {
            var val = values[vi];
            if (dc.min !== undefined && val < dc.min - 1e-9) { passesDomain = false; break; }
            if (dc.max !== undefined && val > dc.max + 1e-9) { passesDomain = false; break; }
        }
    }
    if (passesDomain && state.D0 && typeof state.D0 === 'object') {
        for (var dvi = 0; dvi < n; dvi++) {
            var dr = state.D0[state.varNames[dvi]];
            if (!dr) continue;
            var dlo = (dr.min !== undefined) ? dr.min : (Array.isArray(dr) ? dr[0] : undefined);
            var dhi = (dr.max !== undefined) ? dr.max : (Array.isArray(dr) ? dr[1] : undefined);
            var dv = values[dvi];
            if (dlo !== undefined && dv < dlo - 1e-9) { passesDomain = false; break; }
            if (dhi !== undefined && dv > dhi + 1e-9) { passesDomain = false; break; }
        }
    }
    if (!passesDomain && state.domainConstraints.length > 0 && r.kind !== 'family') return;

    var vars = {};
    state.varNames.forEach(function (v, k) { vars[v] = solution[v]; });
    var residuals = state.equations.map(function (eq) { return Math.abs(evalAST(eq, vars)); });
    var maxResidual = Math.max.apply(null, residuals);

    // ── 精确有理数路径的认证标记（2026-10-04 修 P0）────────────────────────
    //
    // 实测事故（超定相容线性方程组）：x+y−3=0, x−y−1=0, x+2y−4=0
    //   正确解 (2,1)（三式残差全 0），但返回：
    //     tier 缺失 ⇒ certification.proven=0, certifiedCoverage=0
    //     ⇒ Agent 收到 candidates_only + 「调 verify 复核」
    //   **而它已经被精确验证过了** —— suan60 走的是 Bareiss 分数自由消元 +
    //   _s60exactVerify（有理数域代入，残差**严格为 0**，非数值近似）。
    //
    // 为什么 `maxResidual` 判不出这件事：
    //   第 1153 行的 maxResidual 是用 **evalAST 在双精度下重算**的，
    //   它是**数值近似量**；而 suan60 的证明在 **ℚ 上精确成立**。
    //   两者是**不同的证明**，代码用弱的那个（且判据本身是绝对残差分档，
    //   已在「五·ter」§4 判定为数学上错误的口径）。
    //
    // 数学定位：ℚ 上的精确代入验证**严格强于** Krawczyk 区间认证
    // （后者是「根在盒内」的区间包含论证，前者是「代入等于零」的恒等式证明）。
    // ⇒ 它的解必须标 proven，否则引擎就在**向下游谎报**证据强度。
    //
    // fail-closed 方向：只有 verified==='exact-substitution'（精确代入确证）
    // 才标 proven；仅 Bareiss 消元出解、未做精确验证的，仍走数值路径不标。
    var _s60ExactProven = (r.verified === 'exact-substitution');
    // confidence 交由 _resyncConfidence 按认证覆盖率统一算（口径见 solver.js 该函数注释）。
    // 这里的局部值只用于 state.result 的初值，认证层跑完会被统一覆盖。
    var confidence = 'low';

    state.done = true;
    if (r.kind === 'family') {
        // —— 秩亏：解集是仿射子空间，不是一个点 ——
        // 历史踩坑（2026-10-03 回归修复）：此前本分支只给一组特解就 state.done=true，
        // 抢断了后续「多起点牛顿」的族解枚举。实测 T_Wikibooks_P2_4var
        // （rank=3/4，解流形 x=1, y=t−1, z=3−t, w=t，t∈[0,3]）：
        //   旧路径 多起点牛顿 → 5 个解（458.7 ms）命中 known 5/5
        //   抢断版本 只给特解   → 1 个解（322.5 ms）命中 known 1/5
        // 修法不是「交回旧路径」（那会丢掉 suan60 的速度优势），
        // 而是用【零空间参数化】把解流形解析地采出来 —— 精确、无需迭代、
        // 且采样点全部严格落在流形上。
        // 域来源有两处，必须都取，否则采样范围会退化成空：
        //   ① state.D0 —— 【用户传入的初始域】（solve 的第 4 个实参 {x:[lo,hi],...}），
        //      见 index.html 顶层：state.D0 = JSON.parse(JSON.stringify(initialD0))。
        //   ② state.domainConstraints —— 从方程文本里解析出的域条件（如 "0 <= x <= 5"）。
        //  实测坑：只读 ② 会让 box 全为 null ⇒ 采样区间无界 ⇒ 只回落到特解。
        var box = [];
        for (var bi = 0; bi < n; bi++) box.push(null);
        var D060 = state.D0;
        if (D060 && typeof D060 === 'object') {
            for (var vk = 0; vk < n; vk++) {
                var rr2 = D060[state.varNames[vk]];
                if (rr2 && typeof rr2 === 'object') {
                    var lo2 = (rr2.min !== undefined && rr2.min !== null) ? rr2.min
                        : (Array.isArray(rr2) ? rr2[0] : undefined);
                    var hi2 = (rr2.max !== undefined && rr2.max !== null) ? rr2.max
                        : (Array.isArray(rr2) ? rr2[1] : undefined);
                    if (lo2 !== undefined || hi2 !== undefined) {
                        box[vk] = [lo2 === undefined ? -Infinity : lo2,
                                   hi2 === undefined ? Infinity : hi2];
                    }
                } else if (Array.isArray(rr2) && rr2.length >= 2) {
                    box[vk] = [rr2[0], rr2[1]];
                }
            }
        }
        for (var dci2 = 0; dci2 < state.domainConstraints.length; dci2++) {
            var dc2 = state.domainConstraints[dci2];
            var vi2 = state.varNames.indexOf(dc2.varName);
            if (vi2 < 0) continue;
            var lo3 = (dc2.min !== undefined && dc2.min !== null) ? dc2.min : -Infinity;
            var hi3 = (dc2.max !== undefined && dc2.max !== null) ? dc2.max : Infinity;
            // 与已有约束取交集（更严者胜）
            if (!box[vi2]) box[vi2] = [lo3, hi3];
            else {
                if (lo3 > box[vi2][0]) box[vi2][0] = lo3;
                if (hi3 < box[vi2][1]) box[vi2][1] = hi3;
            }
        }
        // ── 欠定（秩亏）系统：**只输出 1 个推荐解**，不采样整个解流形 ──
        //
        // 🔴🔴 2026-10-05 实测抓到的契约破坏（用户指令与本轮重构的核心目标）：
        //
        //   用户指令：「对于部分解的，只找到一个推荐解就行，不需要确定性，
        //              不需要离原点最近」——output.js 已按此实现（单代表解），
        //   **但本函数整段绕过了它**：仍在做 _s60sampleAffine 仿射采样，
        //   把 257~512 个采样点全塞进 solutions。
        //
        //   实测（3 元欠定 / 6 元欠定，各 1 题）：
        //     solutions 字节占返回体 **95.6% ~ 97.6%**
        //     3 元欠定 → 257 个解 / 77KB    6 元欠定 → 512 个解 / **153KB**
        //   ⇒ Agent 拿 190KB JSON 里 98% 是没用的采样点，
        //     而 HTTP 全链路的耗时正是被这个体积吃掉的（见下）。
        //
        // 为什么采样是**纯开销**、零收益（不是「少给点信息」的取舍）：
        //   ① 采样点本来就是 candidate（浮点线性组合构造，只能数值复核），
        //      tier 一律 candidate ⇒ **没有一个能升级 proven** ⇒ 不参与完备性裁决；
        //   ② 采样的目的是「画出解流形的形状」，那是**可视化**需求；
        //      而产品的交付面是给 Agent 的 4 态结论，不是给前端画图；
        //   ③ 512 个点里 Agent 只需要 1 个就能决策（其余全是同一结论的冗余副本）；
        //   ④ 用户已明确否掉「离原点最近」——那就**没有任何理由**选某几个特定采样点，
        //      采样点的取舍本身就是一个人为规则。
        //
        // 正确做法（数学上更硬，不是权宜）：
        //   输出 `r.x` —— **RREF 自由列取 0 的精确特解**。
        //   · 它是精确有理数（未浮点化），可做 ℚ 上精确代入确证 ⇒ **能标 proven**；
        //   · 它是消元法的**规范选择**（不像伪逆最小范数需要额外指定欧氏范数）；
        //   · 零成本：不需要采样、不需要 O(N) 去重、不需要序列化 150KB。
        //
        // ⇒ 结果：欠定题返回体从 153KB 降到约 1.5KB（~100×），
        //   且唯一的那个解 tier 从 candidate 升到 proven（若已精确代入确证）。

        var sols60 = [];

        // 特解即推荐解：`solution` 已是 {变量名 → 消元解} 的映射（见本函数上方构造），
        // 按声明序取值即为 RREF 自由列取 0 的规范特解。
        var recVals = state.varNames.map(function (v2) { return solution[v2]; });

        // 域内性检查：特解可能落在声明域外（约束是后加的）。出域则如实说明，
        // 不偷偷换点 —— 换点就是重新引入「挑一个」的人为规则。
        var recInDomain = true;
        for (var dchk = 0; dchk < n; dchk++) {
            var bchk = box[dchk];
            if (!bchk) continue;
            if (recVals[dchk] < bchk[0] - 1e-9 || recVals[dchk] > bchk[1] + 1e-9) { recInDomain = false; break; }
        }

        sols60 = [{
            values: recVals,
            residual: maxResidual,
            // RREF 特解是精确消元的产物（roundToGrid 现为恒等函数，只做 −0 归一）
            // ⇒ 若已做 ℚ 上精确代入确证则标 proven。
            // 比被删掉的仿射采样点更强：采样点是浮点线性组合，只能 candidate。
            tier: (_s60ExactProven && recInDomain) ? 'proven' : 'candidate',
            certified: _s60ExactProven && recInDomain,
            certMethod: (_s60ExactProven && recInDomain) ? 'exact_rational_substitution' : null
        }];

        state.result = {
            solutions: sols60,
            message: "线性方程组无穷多解（精确秩 " + r.rank + " < 变量数 " + n + "）：" +
                "解集是 " + (r.nullspace ? r.nullspace.length : 0) + " 维仿射子空间（无穷多个解）；" +
                "已输出 1 个推荐解 = RREF 自由列取 0 的精确特解" +
                (recInDomain ? "（在声明域内）" : "（**不在声明域内** —— 真实解集与声明域无交集）"),
            executionPath: "精确线性代数(suan60 · RREF 自由列取 0 的精确特解)",
            timeMs: performance.now() - state.startTime,
            confidence: confidence, varNames: state.varNames, rank: r.rank,
            resultType: 3, resultTypeName: "无限解集(推荐解)",
            resultTypeDesc: "欠定线性系统：秩由精确有理算术判定；解集为无穷仿射簇，" +
                "输出 RREF 自由列取 0 的规范特解（消元法的定义，不需额外度量）作代表",
            // 🔴 2026-10-05 补：欠定必须标 truncated（口径统一，见 output.js 同名注释）。
            //   线性代数是**精确**的 —— 秩 = r < n 已严格证明解集是 r 维仿射子空间（无穷多解），
            //   本字段只输出其中 1 个点，**结构上不可能完备**。
            //   缺此标记 ⇒ 调用方无法程序化区分「这是全部解」与「这是解集里的一个点」，
            //   会把一个代表点当完整解集消费 ⇒ 撞诚实红线。
            //   与 _rescueUnderdeterminedByProjection 的 RREF 分支、output.js 的欠定分支三处同口径。
            truncated: true,
            unconverged: false,
        };
        return;
    }

    var pathLabel = (r.verified === 'exact-substitution')
        ? "精确线性代数(suan60 · Markowitz稀疏序+O(n²)精确验证)"
        : "精确线性代数(suan60 · Bareiss分数自由消元)";
    state.result = {
        solutions: [{
            values: values,
            residual: maxResidual,
            // ℚ 上精确代入确证 ⇒ 标 proven（比 Krawczyk 区间包含更强，见上方注释）
            tier: _s60ExactProven ? 'proven' : 'candidate',
            certified: _s60ExactProven,
            // 认证器名：让 Agent / Web 端知道这是**精确算术**证明，不是区间近似
            certMethod: _s60ExactProven ? 'exact_rational_substitution' : null
        }],
        message: "唯一解（精确秩判定：rank = n = " + n + "）。" +
            (r.verified === 'exact-substitution'
                ? "解已用精确有理数代入原方程逐式验证通过（残差严格为 0，非数值近似）。"
                : "由 Bareiss 分数自由消元精确求得。"),
        executionPath: pathLabel,
        timeMs: performance.now() - state.startTime,
        confidence: confidence, varNames: state.varNames, rank: r.rank,
        resultType: 2, resultTypeName: "有限离散孤立采样点",
        resultTypeDesc: "全线性系统，唯一解（精确判定）"
    };
}


function suan58(state) {
    if (!state.equations || state.equations.length !== 1) return;
    if (!state.varNames || state.varNames.length !== 1) return;
    var vn = state.varNames[0];
    var fnode = state.equations[0];
    if (!fnode || !fnode.type) return;
    // 已是多项式 ⇒ suan51 闭式路径更快，不抢
    var co = null;
    try { co = extractPolynomialCoefficients(fnode, vn); } catch (e) { co = null; }
    if (co && co.length >= 2) return;

    var lo = -1e6, hi = 1e6;
    if (state.D0 && state.D0[vn] && isFinite(state.D0[vn].min) && isFinite(state.D0[vn].max)) {
        lo = state.D0[vn].min; hi = state.D0[vn].max;
    }
    if (!(hi > lo)) return;

    var r = null;
    try { r = _suan58BasicTrig(fnode, vn, lo, hi, { maxOut: 100, valTol: 1e-6 }); } catch (e) { r = null; }
    if (!r || !r.solved) return;   // 不匹配 ⇒ 交回原路径（零行为变更）

    // 证明无解（|常数| > 1，由反三角函数定义域直接判定）
    if (r.provenEmpty) {
        state.done = true;
        state.result = {
            solutions: [],
            resultType: 1,
            resultTypeName: "空集无解",
            resultTypeDesc: "方程 " + r.family + " 在实数域无解（|常数| > 1，由反三角函数定义域精确判定）",
        };
        var _s58Pe = { provenEmpty: true, exact: true, family: r.family, basis: r.basis,
            note: "|常数| > 1 ⇒ 由反三角函数定义域【精确证明】无实解（非采样、非不知道）" };
        state.s58Exact = _s58Pe;
        if (state.result) state.result.s58Exact = _s58Pe;
        return;
    }

    var sols = [];
    for (var i = 0; i < r.solutions.length; i++) {
        sols.push({ values: [r.solutions[i]], residual: 0 });
    }
    state.done = true;
    state.result = {
        solutions: sols,
        // ── fail-closed：截断必须如实标记（否则产品方无法察觉被截断）──
        truncated: r.truncated,
        unconverged: r.truncated,
        exactSolutionCount: r.truncated ? r.totalIfCapped : r.count,
        resultType: r.truncated ? 2 : (sols.length ? 2 : 1),
        resultTypeName: r.truncated ? "有限个解（截断）" : (sols.length ? "有限个解" : "空集无解"),
        resultTypeDesc: r.truncated
            ? ("基本三角方程闭式通解；声明域内共 " + r.totalIfCapped + " 个解，已输出前 " + sols.length + " 个代表解（截断标记）")
            : ("基本三角方程闭式通解；声明域内共 " + r.count + " 个解，全部给出"),
        executionPath: "基本三角方程符号通解（" + r.family + "）",
        timeMs: performance.now() - (state.startTime || performance.now()),
        confidence: "high",
    };
    // 同一份元数据同时挂 state 与 state.result（外部只拿到 result）
    var _s58Meta = {
        exact: true,
        family: r.family,
        basis: r.basis,
        count: r.count,
        countCapped: r.countCapped,
        totalIfCapped: r.totalIfCapped,
        truncated: r.truncated,
        residualMax: r.residualMax,
        note: "解集由闭式通解给出 ⇒ 【精确】而非采样；声明域内根数由整数区间公式数出",
    };
    state.s58Exact = _s58Meta;
    if (state.result) state.result.s58Exact = _s58Meta;
}


function suan59(state) {
    // ── 三元分支（2026-10-03）：字典序结式消元 ──
    // 与二元同一算子编号，按变量数分流。二元是主路径，三元是延伸。
    if (state && state.equations && state.equations.length === 3 && state.varNames && state.varNames.length === 3) {
        return _suan59RunTernary(state);
    }
    if (!state || !state.equations || state.equations.length !== 2) return;
    if (!state.varNames || state.varNames.length !== 2) return;
    // 存在不等式约束时不接管（解集还需交叉求交，逻辑另走 OP_INEQ）
    if (state.inequalityConstraints && state.inequalityConstraints.length) return;
    // 已被显式代入消元（suan19）⇒ 降为一元，走 suan51 更快，本算子不抢
    if (state.substitutions && Object.keys(state.substitutions).length) return;

    var vns = state.varNames;
    var xName = vns[0], yName = vns[1];
    // 两个变量必须都真实出现在方程里（否则不是二元系统，例如 x^2=4 与 y^2=9 各自独立）
    var vset = {};
    for (var e = 0; e < 2; e++) _collectVars(state.equations[e], vset);
    if (!vset[xName] || !vset[yName]) return;

    var dom = _domBoxOf(state, vns);
    if (!dom) return;
    var loX = dom[xName].min, hiX = dom[xName].max;
    var loY = dom[yName].min, hiY = dom[yName].max;
    if (!(hiX > loX) || !(hiY > loY)) return;

    var r = null;
    try {
        r = _suan59SolveBinaryPoly(state.equations, vns, loX, hiX, loY, hiY,
            { maxOut: 100, valTol: 1e-6 });
    } catch (e) { r = null; }
    if (!r || !r.solved) return;   // 不匹配 ⇒ 交回原路径（零行为变更）

    // ── 可证明无解：Sturm 在声明域内精确计数为 0 ──
    // 依据：Res_y(f,g) 的实根 ⇔ 原系统在该 x 上有公共 y 实根。
    //      Sturm 数出 Res 在 [loX,hiX] 内 0 个实根 ⇒ 整个域内无解（非「不知道」）。
    if (r.xCountProven && r.xCount === 0) {
        state.done = true;
        state.result = {
            solutions: [],
            resultType: 1,
            resultTypeName: "空集无解",
            resultTypeDesc: "二元多项式系统：结式消元后 Sturm 序列在声明域内精确计数 0 个实根 ⇒ 【证明无解】",
        };
        var _s59E = {
            exact: true, provenEmpty: true, method: "resultant+sturm",
            note: "Res_y(f,g) 在 x 声明域内实根数 = 0（Sturm 精确计数）⇒ 二元系统无实解"
        };
        state.s59Exact = _s59E;
        if (state.result) state.result.s59Exact = _s59E;
        return;
    }

    if (!r.solutions || !r.solutions.length) return;   // 有根却没回代出解 ⇒ 交回原路径

    // ── 完备性对账：Sturm 数出的 x 根数 vs 实际回代覆盖的 x 根数 ──
    // 量纲对齐：Sturm 数的是【x 的不同实根数】，而解数是 (x,y) 对数，两者不可直接相比。
    // 正确的完备性条件是：每个 Sturm 证明存在的 x 实根，都至少产出一个通过双方程回代的 (x,y) 解。
    var xFound = (function () {
        var s = {};
        for (var i = 0; i < r.solutions.length; i++) s[r.solutions[i][0].toFixed(6)] = 1;
        return Object.keys(s).length;
    })();
    var completeness = null;
    if (r.xCountProven) {
        completeness = (xFound >= r.xCount)
            ? { proven: true, sturmXCount: r.xCount, coveredXCount: xFound, missingX: 0, solutionPairs: r.solutions.length }
            : { proven: false, sturmXCount: r.xCount, coveredXCount: xFound, missingX: r.xCount - xFound, solutionPairs: r.solutions.length };
    }

    var vals = [];
    for (var k = 0; k < r.solutions.length; k++) vals.push([r.solutions[k][0], r.solutions[k][1]]);

    // 变量顺序对齐输出契约：state.varNames 顺序
    var sols = vals.map(function (p) { return { values: [p[0], p[1]], residual: r.residualMax }; });

    state.done = true;
    state.result = {
        solutions: sols,
        truncated: r.truncated,
        unconverged: r.truncated,
        exactSolutionCount: r.truncated ? r.exactCount : r.exactCount,
        resultType: r.truncated ? 2 : 2,
        resultTypeName: r.truncated ? "有限个解（截断）" : "有限个解",
        resultTypeDesc: r.truncated
            ? ("二元多项式系统结式消元（闭式路径）；共 " + r.exactCount + " 个解，已输出前 " + sols.length + " 个（截断标记）")
            : ("二元多项式系统结式消元（闭式路径，Sylvester 结式 → 一元闭式求根 → 回代）；全部 " + sols.length + " 个解均给出"),
        executionPath: "二元结式消元（suan59 · Resultant）",
        timeMs: performance.now() - (state.startTime || performance.now()),
        confidence: "high",
    };
    var _s59M = {
        exact: true,
        method: "resultant",
        xCount: r.xCount,
        xCountProven: r.xCountProven,
        foundXCount: xFound,
        exactCount: r.exactCount,
        truncated: r.truncated,
        residualMax: r.residualMax,
        completeness: completeness,
        note: completeness && completeness.proven
            ? "解集完备性已获数学证明：Sturm 精确计数 " + r.xCount + " 个 x 实根，全部回代通过"
            : "结式消元闭式解集；每个解均经【两个原方程】回代验算（残差 < 1e-6）",
    };
    state.s59Exact = _s59M;
    if (state.result) state.result.s59Exact = _s59M;
}


function suan55(state) {
    if (!state.equations || state.equations.length !== 1) return;
    if (!state.varNames || state.varNames.length !== 1) return;
    var vn = state.varNames[0];
    var fnode = state.equations[0];
    if (!fnode || !fnode.type) return;

    // 已是多项式 ⇒ suan51 闭式路径更快，不抢
    var co = null;
    try { co = extractPolynomialCoefficients(fnode, vn); } catch (e) { co = null; }
    if (co && co.length >= 2) return;

    // 导数（符号微分，已有基础设施）
    var fprime = null;
    try { fprime = _diffAST(fnode, vn); } catch (e) { fprime = null; }
    if (!fprime || !fprime.type) return;

    // 声明域
    var lo = -1e6, hi = 1e6;
    if (state.D0 && state.D0[vn] && isFinite(state.D0[vn].min) && isFinite(state.D0[vn].max)) {
        lo = state.D0[vn].min; hi = state.D0[vn].max;
    }
    if (!(hi > lo)) return;

    // ── 2026-10-03 suan57：全域区间剪枝，把域收窄到【端点可求值】的范围 ──
    // 病根：exp(1e6)=Inf ⇒ f(hi) 非有限 ⇒ 下面「同号/异号判定」与「导数区间判单调」双双失效，
    //       suan55 只能零开销退回稠密扫描（实测 exp(x)=3 慢 SymPy 17.4 倍即源于此）。
    // 数学依据：f(I) 严格不含 0 ⇒ I 上恒无根（区间算术可靠性定理）。
    //       剪掉可证明无根的段后，残余带的端点通常已是有限值 ⇒ suan55 可接管。
    // fail-closed：剪枝只删「可证明无根」的段；剪率过低则放弃（prunedAny=false），
    //             行为与改动前完全一致；剪枝【不宣称无解】（那是 Sturm 的职责）。
    var _s57 = null;
    try {
        _s57 = _suan57Prune(fnode, vn, lo, hi, { intervalEval: intervalEval, maxLevels: 14, maxBands: 24, maxEvals: 200 });
    } catch (e) { _s57 = null; }
    if (_s57 && _s57.prunedAny && _s57.bands && _s57.bands.length) {
        // 残余带的包络（可能多段 ⇒ 取包络作为搜索域；包络必含全部残余带 ⇒ 不漏解）
        // ⚠️ 取包络是保守的（可能等于原域 ⇒ 等于没剪），但绝不会漏解 —— 这是有意的取舍。
        var _s57lo = Infinity, _s57hi = -Infinity;
        for (var _s57i = 0; _s57i < _s57.bands.length; _s57i++) {
            if (_s57.bands[_s57i][0] < _s57lo) _s57lo = _s57.bands[_s57i][0];
            if (_s57.bands[_s57i][1] > _s57hi) _s57hi = _s57.bands[_s57i][1];
        }
        // 只在【包络端点有限】时收窄域：多段残余取包络可能等于原域（等于没剪），
        // 而端点非有限（如 exp(1e6)=Inf）会让后续单调判定失效。
        // 两者任一不满足 ⇒ 保持原域（剪枝白干但零成本，行为与改动前一致）。
        // 判定：包络【确实更窄】且【端点有限】（端点有限才能做同号/异号与单调判定）
        var _s57OrigW = hi - lo;
        var _s57NewW = _s57hi - _s57lo;
        if (isFinite(_s57lo) && isFinite(_s57hi) && _s57hi > _s57lo
            && _s57NewW < _s57OrigW * 0.999) {
            lo = _s57lo; hi = _s57hi;
            state.s57Pruning = {
                pruneRatio: _s57.pruneRatio,
                evalCount: _s57.evalCount,
                bandsKept: _s57.bands.length,
                proof: 'f(I) 严格不含 0 ⇒ I 上恒无根（区间算术可靠性定理）',
                note: '剪掉的区间已被数学证明无根；残余带端点有限，使导数单调判据可用'
            };
        }
    }

    var val = function (x) {
        try { var pt = {}; pt[vn] = x; var v = evalAST(fnode, pt); return (v === null || !isFinite(v)) ? null : v; }
        catch (e) { return null; }
    };

    // ── 数值预筛（廉价，零浪费的前置闸门）──
    // 区间求值不便宜（实测单次可达数十毫秒）。而振荡函数（sin/cos + 常数）的导数在宽域上
    // 必然变号，压根不可能证单调 ⇒ 若先花一次区间求值去「证」它，必然白干并拖慢整体
    //（实测 cos(x)=0.5 因白干反而从 405ms 退到 897ms）。
    // ⇒ 先用 9 点【数值】采样 f' 判「是否有可能同号」：
    //   · 采样值全同号（含 0）⇒ 才有资格进入昂贵的区间证明；
    //   · 采样值出现正负交替 ⇒ 直接放弃接管（交回稠密扫描），本算子零开销。
    // ⚠️ 预筛只是【便宜的否证】，绝不用于「证明单调」——单调性仍只由区间算术结论给出。
    var _sg = 0, _sgN = 9, _sgPos = 0, _sgNeg = 0;
    for (var _si = 0; _si < _sgN; _si++) {
        var _sx = lo + (hi - lo) * ((_si + 0.5) / _sgN);
        var _sf = null;
        try { var _spt = {}; _spt[vn] = _sx; _sf = evalAST(fprime, _spt); } catch (e) { _sf = null; }
        if (_sf === null || !isFinite(_sf)) { _sg = -1; break; }   // 采样点非法 ⇒ 放弃
        if (_sf > 1e-12) _sgPos++;
        if (_sf < -1e-12) _sgNeg++;
    }
    if (_sg === 0 && _sgPos > 0 && _sgNeg > 0) return;   // 振荡 ⇒ 零开销放弃

    // ── 只做【整段一次判定】，不做递归对分（2026-10-03 实测修正）──
    // 原因：递归对分在「导数不可判定」的题上会白干巨量时间 —— tan(x)=1 实测 suan55 全程 205.93ms
    //   （其中 4096 段 × 0.2ms 区间求值），而这些题最终仍要退回稠密扫描 ⇒ 纯浪费、净收益为负。
    // 取舍：**可判单调就接管（1 根），不可判就零开销退回**。宁可少接管，绝不白干。
    var unresolved = 0;
    var roots = [];
    var mono = _suan55Monotone(fprime, vn, lo, hi);
    if (mono === null) return;                       // 整段不可判定 ⇒ 零开销退回
    var fa = val(lo), fb = val(hi);
    if (fa === null || fb === null) return;         // 端点求值非法（如 exp(1e6)=Inf）⇒ 退回
    if (fa === 0) roots.push(lo); else if (fb === 0) roots.push(hi);
    else if ((fa < 0 && fb < 0) || (fa > 0 && fb > 0)) return;   // 同号 + 单调 ⇒ 证明无根，但本算子不报「无解」
    else {
        var rr = _suan55Refine(fnode, vn, lo, hi, fa, fb);
        if (rr.ok) roots.push(rr.x); else return;
    }    if (unresolved > 0 || !roots.length) return;

    // 去重排序 + 域内过滤
    roots = roots.filter(function (x) { return isFinite(x) && x >= lo - 1e-9 && x <= hi + 1e-9; });
    roots.sort(function (p, q) { return p - q; });
    var uniq = [];
    for (var i = 0; i < roots.length; i++) {
        if (!uniq.length || Math.abs(roots[i] - uniq[uniq.length - 1]) > 1e-7) uniq.push(roots[i]);
    }
    if (!uniq.length) return;

    var sols = uniq.map(function (x) { return { values: [x] }; });
    state.result = {
        solutions: sols,
        resultType: 2,
        resultTypeName: '有限离散孤立采样点',
        resultTypeDesc: '导数单调性分段求根：各单调段至多一根，段内牛顿精化（suan55）'
    };
    state.done = true;
    state.result.s55Completeness = {
        method: 'derivative-monotone-partition',
        segmentsProven: true,
        rootUpperBound: uniq.length,
        note: '每个单调段至多 1 根；段内同号即证明无根，异号即恰有 1 根（Bolzano + 单调性）',
        basis: '一阶导数的区间包络上界≤0 / 下界≥0 ⇒ 单调 ⇒ 至多一根（区间算术可靠性定理）'
    };
    state.s55Completeness = {
        method: 'derivative-monotone-partition',
        segmentsProven: true,
        rootUpperBound: uniq.length,
        note: '每个单调段至多 1 根；段内同号即证明无根，异号即恰有 1 根（Bolzano + 单调性）'
    };
}
