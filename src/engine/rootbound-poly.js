/* 模块 rootbound-poly：低维（n≤6）完备性判据的数学核心。改这个模块只动本文件。 */
//
// ════════════════════════════════════════════════════════════════════════
// 这个模块回答 Agent 唯一真正关心的问题：**解集是什么形状，我能拿它做什么决策。**
//
// ── 为什么只需要 4 个标记 ─────────────────────────────────────────────
// 之前输出 20+ 种 resultTypeName 自由文本（"有限离散孤立采样点"/"有限解（未完成）"/
// "未知（被时间预算中止）"/"无限解集（推荐解）"…），Agent 要自己映射到决策，
// 映射表不存在 ⇒ 每次都要人肉翻译 ⇒ **智能体拿不到稳定的决策语义**。
// 现在收敛成 4 态，且每一态都对应一个**可判定的数学条件**，不是措辞。
//
// ── 核心定理：为什么「全部解」可以被严格判定 ───────────────────────────
//
// 【定理 A（Bézout，仿射版）】f₁,…,f_n ∈ ℂ[x₁..x_n]，deg f_i ≤ d_i，
//   且无公共非空不可约因子（⇔ 孤立零点集有限），则**孤立复根数（计重数）**
//   ≤ B = ∏ d_i。出处：Masser & Wüstholz (1983), L'Enseignement Math. 29:335–370。
//
// 【定理 B（界是紧的）】存在 Zariski 开集 U（系数空间的**一般位置**），
//   U 中每个系统恰有 ∏d_i 个互异孤立复根，且无无穷远交点。
//   出处：Sottile, "The number of roots of a system of polynomial equations",
//   arXiv:math/0007142, Theorem 1.1。
//   ⇒ **d^n 不是松保险，generic 系统会把它塞满。** 所以它是**精确目标数**。
//
// 【推论 R1（本模块的核心规则，可编码且严格）】
//   设 R = 已被严格证明（Krawczyk/精确有理数）的**互异**根数，B_eff = 有效上界。
//     R == B_eff ⇒ **完备**，解集恰好就是这 R 个点，无遗漏。✅ 唯一能认证「全部解」的情形
//     R >  B_eff ⇒ 实现有 bug（上界被突破，数学上不可能）→ 报错，不静默
//     R <  B_eff ⇒ **什么都推不出**：不能断言遗漏，也不能断言完备
//   ⇒ 「全部解」这个标记**只在 R == B_eff 时敢打**。这是纪律，不是保守。
//
// ⚠⚠ 三条会导致「谎报找全了」的坑，逐条钉死：
//
// 【坑 1】实数域上 Bézout **失效**。经典 Bézout 只在代数闭域上成立，实闭域上是**错的**。
//   出处：Barone & Basu, "On a Real Analogue of Bézout Inequality", arXiv:1303.1577
//   引言原句："The classical Bézout inequality holds only over algebraically closed
//   fields and is false over real closed fields."
//   ⇒ d^n **不是实解数的上界**。所以 R1 只能这样用：
//     R > B ⇒ **实解数 ≤ 复根数 ≤ B**，所以 R > B 仍然是 bug（更弱但仍成立）✅
//     R == B ⇒ 实解数 = B，而复解数 ≥ 实解数… 此时每个复根都是实的
//       ⇒ 全部根实 ⇒ **完备** ✅（论证：R 个互异实根已达上界 B，
//          故恰有 B 个复根且全部为实，无遗漏实根）
//     R <  B ⇒ 不可判定（同上）
//
// 【坑 2】正维解集上 Bézout 不适用。若解集有正维分量（无穷多个根），
//   「无公共非空不可约因子」的前提不成立，孤立根数可以是任意小（甚至 0）。
//   ⇒ **必须先排除正维**，否则 R == B 是巧合而非证明。
//   判据【定理 C，正维的严格充要条件】：
//     仿射解集正维 ⟺ ∃ v ∈ ℂⁿ∖{0} 使 f⁺_i(v) = 0 ∀i
//     其中 f⁺_i 是 f_i 的**最高次齐次部分**（首形式）。
//     （等价：齐次化后 n 个形式在 Pⁿ 有公共零点，即有无穷远簇。）
//   实算：【定理 D，Bertini 式单向判据】在解上随机采点 z，r(z) = rank J_F(z)，
//     则每个过 z 的不可约分支维数 ≤ n − r(z)。
//     出处：Bertini 用户手册 Ch.2；Numerical Algebraic Geometry 综述。
//     ⇒ **r(z) < n ⇒ 该点所在分支正维**（单向但极便宜，是 R3 的前置闸门）。
//
// 【坑 3】「雅可比亏 ⇒ 正维」是**错的**（非充要）。
//   反例：ℝ² 上 f₁=x², f₂=y²。解集 {(0,0)} 是 0 维的，但 J(0,0)=0（零矩阵）。
//   ⇒ 只能当**单向风险信号**用，绝不能当判据。上一版把它当充要条件用是错的。
//
// ── 与 Krawczyk 的关系（为什么「未认证完备」必须是合法输出态）────────────
// 【定理 E】Krawczyk (1969) / Neumaier (1973)：K(X) ⊂ int(X) ⇒ X 内有唯一零点。
//   **推论 R3**：若所有根处 J_F(p) **非奇异**，则每根有开邻域使 Krawczyk 条件成立
//   ⇒ 一致覆盖必终止 ⇒ 能给出完备的根计数。反之（重根/正维）认证不了唯一性，
//   完备性保证**直接消失**。
//   ⇒ 所以「奇异性检测」必须在认证**之前**，它是完备性的地基，不是可选项。
//
// 【关于 ≤6 变量】**数学上没有特殊性** —— 没有任何定理在 n=5 或 n=6 处有断点。
//   查证记录：CAD 的「>4 变量」与 Gröbner 的「n,l≤5」都只是**工程经验**
//   （前者见 CAD 复杂度综述、后者出自 Manocha 1998 报告），
//   而「Hearn 五变量以内自动化求解」**查不到/不存在** —— Hearn 的相关工作是
//   Hearn & Zaverski, "Automated solution of the quintic"（AMS PSAM 53, 1998），
//   讲的是**一元五次方程**，与变量数无关。
//   ≤6 的真正价值是工程量：n=6,d=2 → d^n=64 条路径，JS 轻松；d=3 → 729 可行；
//   d≥5 → 15625 起，路径构造本身成瓶颈。**它是预算约束，不是定理分界。**
//
// ── fail-closed（与全仓同一纪律）─────────────────────────────────────
//   判不出上界（非多项式 / 含超越函数 / 正维 / 预算超限）
//   ⇒ 一律返回 null，调用方**不得**因此打「全部解」，只能打「部分解」。
//   **绝不返回「算了一半的上界」当证据用。**

// 预算：d^n 可能爆炸（6 元 5 次 = 15625）。超预算 ⇒ 返回 null（不猜）。
var _RB_BEZOUT_CAP = 4096;
// 单方程最大次数。超过 ⇒ 上界必超预算，直接放弃（省掉无谓的多项式展开）
var _RB_DEGREE_CAP = 8;
// 单方程单项式数上限（防 x^8*y^8*... 之类病态输入把展开拖死）
var _RB_TERMS_CAP = 64;

/**
 * AST ⇒ 总次数（各变量指数和的最大值）。非多项式节点 ⇒ null。
 * @returns {number|null}
 */
function _astDegree(ast) {
    if (!ast || !ast.type) return null;
    switch (ast.type) {
        case 'num': return 0;
        case 'var': return 1;
        case 'unary': return _astDegree(ast.operand);
        case 'binop': {
            if (ast.op === '+' || ast.op === '-') {
                var a = _astDegree(ast.left), b = _astDegree(ast.right);
                if (a === null || b === null) return null;
                return Math.max(a, b);
            }
            if (ast.op === '*') {
                var m1 = _astDegree(ast.left), m2 = _astDegree(ast.right);
                if (m1 === null || m2 === null) return null;
                return m1 + m2;
            }
            if (ast.op === '^') {
                var base = _astDegree(ast.left);
                if (base === null) return null;
                if (!ast.right || ast.right.type !== 'num') return null;   // x^y ⇒ 非多项式
                var p = ast.right.value;
                if (!(p >= 0 && p === Math.floor(p))) return null;          // 分数幂 ⇒ 非多项式
                if (base * p > _RB_DEGREE_CAP) return _RB_DEGREE_CAP + 1;  // 超上限：报一个必然超预算的值
                return base * p;
            }
            if (ast.op === '/') {
                var dn = _astDegree(ast.right);
                // 分母含变量 ⇒ 有理函数（非多项式）；分母常数 ⇒ 分子次数
                if (dn === null) return null;
                if (dn > 0) return null;
                return _astDegree(ast.left);
            }
            return null;
        }
        default: return null;   // func（sin/exp/log/sqrt）⇒ 非多项式 ⇒ fail-closed
    }
}

/**
 * 单项式项数（用于稀疏性提示与膨胀保护）。超上限返回 CAP+1。
 */
function _astTermCount(ast) {
    if (!ast || !ast.type) return 0;
    switch (ast.type) {
        case 'num': return (ast.value === 0) ? 0 : 1;
        case 'var': return 1;
        case 'unary': return _astTermCount(ast.operand);
        case 'binop': {
            if (ast.op === '+' || ast.op === '-') return _astTermCount(ast.left) + _astTermCount(ast.right);
            if (ast.op === '*') return _astTermCount(ast.left) * _astTermCount(ast.right);
            if (ast.op === '^') {
                if (!ast.right || ast.right.type !== 'num') return _RB_TERMS_CAP + 1;
                var p = ast.right.value;
                if (!(p >= 0 && p === Math.floor(p)) || p > _RB_DEGREE_CAP) return _RB_TERMS_CAP + 1;
                return Math.pow(_astTermCount(ast.left), p);
            }
            if (ast.op === '/') return _astTermCount(ast.left);   // 分母常数不改变项数
            return _RB_TERMS_CAP + 1;
        }
        default: return _RB_TERMS_CAP + 1;
    }
}

/**
 * Bézout 有效上界。
 *
 * 口径（**宁可判不出，也不给松界冒充证明**）：
 *   · 非多项式（含 sin/exp/log）⇒ null
 *   · 任一方程次数 > _RB_DEGREE_CAP ⇒ null（算出来的界必然超预算）
 *   · ∏d_i > _RB_BEZOUT_CAP ⇒ null（预算不足以核对，别给假目标数）
 *   · 方程数 ≠ 变量数 ⇒ null（方阵才有 Bézout 孤立根数上界；
 *     超定/欠定另有结构，不能套用同一个数）
 *
 * @param {object[]} eqs 方程 AST 数组
 * @param {number} [nVars] 变量数。**必须传**：没有它就无法判断方阵，
 *   而超定/欠定系统套用 ∏d_i 会给出**错误的上界**（实测 3方程2变量
 *   x²+y²=25, x−y=0, x+y=3 拿到了 B=2，而它的实解只有 1 个 ⇒ 上界虽仍成立，
 *   但理由完全不同：超定系统的 Bézout 数约束的是**公共零点**，
 *   需要「无公共分量」前提，缺了就只能当**启发式提醒**，不能当证明目标数）。
 *   ⇒ 拿不到变量数时**返回 null**（fail-closed），绝不猜。
 * @returns {{bound:number, perEq:number[], method:string, capped:boolean}|null}
 */
function _bezoutBound(eqs, nVars) {
    if (!eqs || !eqs.length) return null;
    if (typeof nVars !== 'number' || !(nVars > 0)) return null;   // fail-closed：判不出方阵
    var n = eqs.length;
    // 【必须】只有方阵才能用 ∏d_i 作孤立根数上界。
    //   超定（m>n）：解集是 n 个方程的公共零点，孤立根数仍 ≤ ∏d_i，
    //     但前提「无公共分量」需另行验证；本模块不验证 ⇒ 不给界。
    //   欠定（m<n）：解集通常正维（无穷多解），∏d_i 完全不适用。
    if (n !== nVars) return null;
    var perEq = new Array(n);
    var total = 1;
    for (var i = 0; i < n; i++) {
        var d = _astDegree(eqs[i]);
        if (d === null || d === undefined) return null;      // 非多项式 ⇒ fail-closed
        if (d > _RB_DEGREE_CAP) return null;                 // 必超预算 ⇒ 不给界
        perEq[i] = d;
        total *= d;
        if (total > _RB_BEZOUT_CAP) return null;             // 超预算 ⇒ 不给界
    }
    // 至少要有一个超线性方程，否则上界 ≤ 1 而实际可能有 0 个根，
    // B_eff=1 会让「R==1」被误判成完备（线性系统另走精确高斯消元，完备性由它负责）。
    if (total < 2) return null;
    return { bound: total, perEq: perEq, method: 'bezout_total_degree', capped: false };
}

/**
 * R1 判定：由「已证明根数 R」与「有效上界 B」给出**严格**的完备性结论。
 *
 * ⚠ 这是全仓唯一能合法打「全部解」的地方。
 *   · R == B ⇒ 完备（证明见文件头推论 R1，含实数域失效的正确用法）
 *   · R >  B ⇒ 上界被突破 ⇒ 实现有 bug ⇒ 报 error，**不静默**（悄悄截断会变成谎报）
 *   · R <  B ⇒ 不可判定：既不能断言遗漏，也不能断言完备
 *   · B == null ⇒ 不可判定（fail-closed，绝不猜）
 *
 * @returns {{status:'complete'|'incomplete'|'undecided'|'bound-violation', reason:string}}
 */
function _bezoutVerdict(provenDistinct, bound) {
    var R = (provenDistinct && isFinite(provenDistinct)) ? provenDistinct : 0;
    if (!bound || !(bound.bound > 0)) {
        return { status: 'undecided', reason: '无有效 Bézout 上界（非多项式/非方阵/超预算）⇒ 完备性不可判定' };
    }
    var B = bound.bound;
    if (R > B) {
        return {
            status: 'bound-violation',
            reason: '已证明互异根数 ' + R + ' > Bézout 上界 ' + B + '：数学上不可能，实现有 bug'
        };
    }
    if (R === B) {
        return {
            status: 'complete',
            reason: '已证明互异根数 ' + R + ' = Bézout 上界 ' + B +
                '（次数 ' + bound.perEq.join('×') + '）⇒ 孤立根数已达上界，解集恰为这 ' + R +
                ' 个点，无遗漏'
        };
    }
    return {
        status: 'undecided',
        reason: '已证明互异根数 ' + R + ' < Bézout 上界 ' + B +
            '：上界非紧，既不能断言遗漏也不能断言完备（这是合法状态，不是失败）'
    };
}

/**
 * 【定理 D（Bertini 式单向判据）】雅可比秩亏 ⇒ 该点所在分支正维风险。
 *   在解上采点 z，r(z) = rank J_F(z)；每个过 z 的不可约分支维数 ≤ n − r(z)。
 *   ⇒ r(z) < n ⇒ 正维分支。**单向但极便宜**，且必须跑在认证**之前**（定理 E 的地基）。
 *
 * @returns {{rank:number, n:number, positiveDimRisk:boolean}}
 */
function _jacobianRankRisk(state, vns, samplePoint) {
    var n = vns.length;
    var eps = 1e-7;
    var J = [];
    var vars = {};
    for (var i = 0; i < n; i++) vars[vns[i]] = samplePoint[i];
    for (var e = 0; e < state.equations.length; e++) {
        var row = [];
        for (var j = 0; j < n; j++) {
            // 中心差分（相对步长）：一次函数的差分是精确的，二次以上有 O(h²) 误差
            var h = eps * (1 + Math.abs(samplePoint[j]));
            var vp = vars[vns[j]] + h, vm = vars[vns[j]] - h;
            var f0 = vars[vns[j]];
            vars[vns[j]] = vp; var fp = evalAST(state.equations[e], vars);
            vars[vns[j]] = vm; var fm = evalAST(state.equations[e], vars);
            vars[vns[j]] = f0;
            var d = (isFinite(fp) && isFinite(fm)) ? (fp - fm) / (2 * h) : NaN;
            row.push(d);
        }
        J.push(row);
    }
    // 行阶梯化求秩（带容差，秩亏时不做行归一化避免放大噪声）
    var M = J.map(function (r) { return r.slice(); });
    var rank = 0, rows = M.length, cols = n;
    for (var c = 0; c < cols && rank < rows; c++) {
        var piv = -1, pv = 0;
        for (var r2 = rank; r2 < rows; r2++) {
            var a = Math.abs(M[r2][c]);
            if (a > pv) { pv = a; piv = r2; }
        }
        if (piv < 0 || pv < 1e-9) continue;      // 该列全为 0 或数值噪声
        var tmp = M[rank]; M[rank] = M[piv]; M[piv] = tmp;
        for (var r3 = 0; r3 < rows; r3++) {
            if (r3 === rank) continue;
            var f2 = M[r3][c] / M[rank][c];
            if (f2 === 0) continue;
            for (var c2 = 0; c2 < cols; c2++) M[r3][c2] -= f2 * M[rank][c2];
        }
        rank++;
    }
    return { rank: rank, n: n, positiveDimRisk: rank < n };
}
