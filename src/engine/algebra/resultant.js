/* 模块 algebra/resultant：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function _s59BareissPolyDet(Ain, maxTerms, ops) {
    var O = ops || _s59P1Ops;
    var n = Ain.length;
    if (n === 0) return O.const1();
    if (n === 1) return O.copy(Ain[0][0]);
    var A = [];
    for (var i = 0; i < n; i++) A.push(Ain[i].map(function (e) { return O.copy(e); }));
    var prev = O.const1();
    var maxLen = maxTerms || 64;

    for (var k = 0; k < n - 1; k++) {
        // 选主元：优先选【最高次数】最大且非零的行。
        // 【2026-10-03 修正】原打分用「从最高次往低次按 1e-3 权压缩求和」，
        // 该分数对低次项惩罚过重：Sylvester 矩阵首列常有 `-x`（1 次）与 `x^3`（3 次）并存，
        // 打分会让 1 次项压过 3 次项（实测 x^3-y 与 y^3-x 选错主元 ⇒ 中间量指数爆炸 ⇒ NaN）。
        // 正确准则：先比最高非零次数（高次优先），同次数再比该系数绝对值。
        var piv = -1, pivDeg = -1, pivAbs = -1;
        for (var r = k; r < n; r++) {
            if (O.isZero(A[r][k])) continue;
            var dg = O.deg(A[r][k]);
            if (dg < 0) continue;
            var ab = O.absCoef(A[r][k]);
            if (dg > pivDeg || (dg === pivDeg && ab > pivAbs)) { pivDeg = dg; pivAbs = ab; piv = r; }
        }
        if (piv < 0) return null;                  // 该列全零 ⇒ 行列式为 0（退化）
        if (piv !== k) { var t = A[k]; A[k] = A[piv]; A[piv] = t; }

        var akk = A[k][k];
        for (var r2 = k + 1; r2 < n; r2++) {
            var ark = A[r2][k];
            for (var c = k + 1; c < n; c++) {
                // A[r2][c] = (A[r2][c]*A[k][k] - A[r2][k]*A[k][c]) / prev
                var t1 = O.mul(A[r2][c], akk);
                var t2 = O.mul(ark, A[k][c]);
                var num = O.sub(t1, t2);
                if (O.termCount(num) > maxLen) return null;         // 系数爆炸 ⇒ 放弃
                A[r2][c] = O.div(num, prev);
                if (A[r2][c] === null) return null;          // 整除失败（浮点误差）⇒ 放弃
            }
            A[r2][k] = O.zero();
        }
        prev = akk;
    }
    return A[n - 1][n - 1];
}


function _s59ResultantX(fY, gY, maxDegX, ops) {
    var O = ops || _s59P1Ops;
    var nf = fY.length - 1, ng = gY.length - 1;
    if (nf < 0 || ng < 0) return null;
    if (nf === 0 && ng === 0) return null;              // 两个都常数 ⇒ 无意义
    var n = nf + ng;
    if (n <= 0 || n > 10) return null;                  // 阶数过大（系数爆炸）⇒ 放弃

    // 矩阵元素：系数域元素。
    // 【2026-10-03 修正】不再补齐到 maxDegX+1 —— 补零会让每个矩阵元都带上
    // 一长串尾部零，Bareiss 每次乘法都把数组长度顶到上限，num.length > maxLen
    // 误判「系数爆炸」而返回 null（实测 x^2+y^2-25 与 x+y-1 被误拒）。
    // Bareiss 允许变长多项式，直接用 trim 后的紧凑形式即可。
    function cell(p) {
        if (!p) return O.zero();
        return O.copy(p);
    }

    var M = [];
    for (var r = 0; r < n; r++) {
        M.push([]);
        for (var c2 = 0; c2 < n; c2++) M[r].push(O.zero());
    }
    // 标准 Sylvester 布局：
    //   行 0..ng−1：f 的系数右移 0..ng−1（列 k 放 f_{k−r}）
    //   行 ng..n−1：g 的系数右移 0..nf−1（列 k 放 g_{k−(r−ng)}）
    for (var r2 = 0; r2 < ng; r2++) {
        for (var k = 0; k <= nf; k++) {
            var col = r2 + k;
            if (col < n) M[r2][col] = cell(fY[k]);
        }
    }
    for (var r3 = ng; r3 < n; r3++) {
        for (var k2 = 0; k2 <= ng; k2++) {
            var col2 = (r3 - ng) + k2;
            if (col2 < n) M[r3][col2] = cell(gY[k2]);
        }
    }

    // Bareiss 分数自由消元：中间元素的次数上界 = Σ 各步 (a_ii + a_ij) - …，
    // 保守取 2·maxTerms 已足；上限放宽到 2·maxDegX+16，避免误杀合法系统。
    var R = _s59BareissPolyDet(M, O.maxTerms(maxDegX), O);
    if (!R) return null;
    R = O.copy(R);
    if (O.isZero(R)) return null;
    // 归一化：一元按最高次项（保持 Sturm 原有尺度行为不变）；
    //         多元（BQ）最高次「项」不是数，改按最大系数绝对值缩放到 O(1)。
    var lead = O.lead ? O.lead(R) : null;
    var sc = (lead !== null && lead !== undefined) ? Math.abs(lead) : O.absCoef(R);
    if (!isFinite(sc) || sc < 1e-300) return null;
    return O.scale(R, 1 / sc);
}


function _s59ExpandInY(node, yName, xName) {
    var xn = (xName === undefined || xName === null) ? 'x' : xName;
    if (!node || !node.type) return null;
    if (node.type === 'var') {
        if (node.name === yName) return [[0], [1]];      // y = y^1 · 1
        if (node.name === xn) return [[0, 1]];             // x = y^0 · x
        return null;                                       // 出现第三个变量 ⇒ 本层不适用
    }
    if (node.type === 'num') return [[node.value]];
    if (node.type === 'unary') {
        var inner = _s59ExpandInY(node.operand, yName, xn);
        if (!inner) return null;
        if (node.op === '-') {
            var neg = [];
            for (var i = 0; i < inner.length; i++) neg.push(_s59PScale(inner[i], -1));
            return _s59YNorm(neg);
        }
        return inner;
    }
    if (node.type === 'binop') {
        var a = _s59ExpandInY(node.left, yName, xn);
        var b = _s59ExpandInY(node.right, yName, xn);
        if (!a || !b) return null;
        if (node.op === '+') return _s59YAdd(a, b);
        if (node.op === '-') return _s59YSub(a, b);
        if (node.op === '*') return _s59YMul(a, b);
        if (node.op === '^') {
            var e = node.right;
            if (!e || e.type !== 'num' || !isFinite(e.value) || e.value < 0
                || Math.abs(e.value - Math.round(e.value)) > 1e-12) return null;
            var p = Math.round(e.value);
            var acc = [[1]];
            for (var i3 = 0; i3 < p; i3++) acc = _s59YMul(acc, a);
            return acc;
        }
        return null;   // 除法等含分母 ⇒ 不属本算子（交给 suan50 有理化）
    }
    return null;       // func / abs 等超越或非多项式
}


function _suan59SolveBinaryPoly(eqs, vns, loX, hiX, loY, hiY, opts) {
    opts = opts || {};
    var maxOut = opts.maxOut || 100;
    var valTol = opts.valTol || 1e-6;
    var xName = vns[0], yName = vns[1];

    var fY = _s59ExpandInY(eqs[0], yName, xName);
    var gY = _s59ExpandInY(eqs[1], yName, xName);
    if (!fY || !gY) return null;
    if (fY.length < 2 && gY.length < 2) return null;   // 两个都不含 y ⇒ 不是二元系统

    // ── 角色选择（2026-10-03 修正）──
    // 病根：原实现要求【两个方程都含 y】，于是「x^4-1 与 x^2+y^2-5」这类
    //       一个方程纯 x、一个方程含 y 的系统被整条拒绝（实测漏 4 解）。
    // 数学上不需要这样：只要【至少一个】含 y，就能以 y 为解变量消元；
    // 另一个方程（可能不含 y）退化为对 x 的额外约束，在回代验算时把关即可。
    // 另外把【含 y 次数较高】的方程当 f，使 Sylvester 矩阵行数 = min(deg_y) 较小、Bareiss 更省。
    var swap = (gY.length > fY.length);
    if (swap) { var _t = fY; fY = gY; gY = _t; }

    // Res 关于 x 的次数上界 = (deg_y f)·(deg_x g) + (deg_y g)·(deg_x f)
    // 【2026-10-03 修正】原式把两项都乘同一个 maxDx（f、g 的最大 x 次数），
    // 系统性虚高 n·2·maxDx，把许多低次系统误判为「次数太高」而放弃。
    // 正确公式需分别取 deg_x f 与 deg_x g。
    var nf = fY.length - 1, ng = gY.length - 1;
    var maxDxf = 0, maxDxg = 0;
    for (var i = 0; i < fY.length; i++) if (fY[i]) maxDxf = Math.max(maxDxf, fY[i].length - 1);
    for (var j = 0; j < gY.length; j++) if (gY[j]) maxDxg = Math.max(maxDxg, gY[j].length - 1);
    var resDegBound = nf * maxDxg + ng * maxDxf;
    if (resDegBound > 16) return null;                 // 次数太高（Bézout 上界大）⇒ 放弃

    var R = _s59ResultantX(fY, gY, resDegBound);
    if (!R || R.length < 2) return null;               // 一次以内 ⇒ 不是有效的降维多项式

    // ── 公共因子检测（fail-closed，不猜）──
    // 不能用「Res 次数 < 理论上界」当判据：消元本身就会降次
    // （x²+y²-25 与 x+y-1 的 Res 关于 x 只有 2 次，而理论上界是 4 次，属正常）。
    // 真正的零维性破坏信号是：f、g 在 y 上有【非常数公共因子】h(y)，
    // 此时解集含整条曲线 y=h 的零点集（无穷多点），不是孤立解集。
    // 判据：把 x 代入任意代表值（如 x=0 与 x=1），若两次得到的一元 y 多项式
    //       的 gcd 次数 > 0 ⇒ 存在公共因子 ⇒ 放弃。
    if (_s59HasCommonYFactor(fY, gY)) return null;

    // Sturm 精确计数（x 的实根个数）⇒ 完备性证明
    var cnt = _sturmCountAsc(R, loX, hiX);
    // ── 重根 fallback：square-free 分解（2026-10-03）──
    // 病根：Res 可能有重根（如 f=x^4-1 与 g=x^2+y^2-5 的 Res = (x^4-1)^2 含重根），
    //       此时 Sturm 链因公因子构造失败，完备性证明白白丢失。
    // 数学依据：实根的【个数】只取决于 square-free 部分 R/gcd(R,R')（重数不影响计数），
    //       故对 R 的无平方因子部分做 Sturm 计数，得到的正是【不同实根数】。
    var sqFree = null;
    if (!cnt || !cnt.ok) {
        sqFree = _s59SquareFree(R);
        if (sqFree) {
            var cnt2 = _sturmCountAsc(sqFree, loX, hiX);
            if (cnt2 && cnt2.ok) cnt = cnt2;
        }
    }
    var xCountProven = !!(cnt && cnt.ok);
    var xCount = xCountProven ? cnt.count : null;

    // 求 x 的候选根
    var xRoots = null;
    try { xRoots = polynomialAllRoots(R, 1e-8); } catch (e) { xRoots = null; }
    if (!xRoots) return null;

    var sols = [];
    var worstRes = 0;
    var truncated = false;
    for (var xi = 0; xi < xRoots.length; xi++) {
        var xv = xRoots[xi];
        if (!isFinite(xv) || xv < loX - 1e-9 || xv > hiX + 1e-9) continue;
        // 固定 x，把两个方程都变成关于 y 的一元多项式
        var vy1 = _s59EvalPolyY(fY, xv);
        var vy2 = _s59EvalPolyY(gY, xv);
        if (!vy1 || !vy2) continue;
        if (vy1.length < 2 && vy2.length < 2) continue;      // 两方程都不含 y ⇒ 无穷多解（非零维）
        // 公共 y 根：取次数较高者的根，逐个验第二个方程
        var useFirst = (vy1.length >= vy2.length);
        var cand = useFirst ? vy1 : vy2;
        var other = useFirst ? vy2 : vy1;
        var yRoots = null;
        try { yRoots = polynomialAllRoots(_s59PTrim(cand), 1e-9); } catch (e) { yRoots = null; }
        if (!yRoots) continue;
        for (var yi = 0; yi < yRoots.length; yi++) {
            var yv = yRoots[yi];
            if (!isFinite(yv) || yv < loY - 1e-9 || yv > hiY + 1e-9) continue;
            // fail-closed 硬门槛：回代【两个原方程】
            var pt = {}; pt[xName] = xv; pt[yName] = yv;
            var r1, r2;
            try { r1 = evalAST(eqs[0], pt); } catch (e) { r1 = null; }
            try { r2 = evalAST(eqs[1], pt); } catch (e) { r2 = null; }
            if (r1 === null || r2 === null || !isFinite(r1) || !isFinite(r2)) continue;
            if (Math.abs(r1) > valTol || Math.abs(r2) > valTol) continue;   // 伪根（公共因子/无穷远根）⇒ 丢弃
            var res2 = Math.max(Math.abs(r1), Math.abs(r2));
            if (res2 > worstRes) worstRes = res2;
            // 去重
            var dup = false;
            for (var d2 = 0; d2 < sols.length; d2++) {
                if (Math.abs(sols[d2][0] - xv) < 1e-7 && Math.abs(sols[d2][1] - yv) < 1e-7) { dup = true; break; }
            }
            if (!dup) sols.push([xv, yv]);
        }
    }

    var exactCount = sols.length;
    if (sols.length > maxOut) { sols = sols.slice(0, maxOut); truncated = true; }

    return {
        solved: true,
        solutions: sols,
        xCount: xCount,
        xCountProven: xCountProven,
        exactCount: exactCount,
        truncated: truncated,
        residualMax: worstRes
    };
}


function _s59EvalPolyY(fY, xv) {
    var out = [];
    for (var k = 0; k < fY.length; k++) {
        var c = fY[k];
        var s = 0;
        if (c) { for (var i = c.length - 1; i >= 0; i--) s = s * xv + c[i]; }   // Horner on x-升幂
        out.push(s);
    }
    while (out.length > 1 && Math.abs(out[out.length - 1]) < 1e-12) out.pop();
    return out;
}


function _suan59RunTernary(state) {
    if (state.inequalityConstraints && state.inequalityConstraints.length) return;
    if (state.substitutions && Object.keys(state.substitutions).length) return;
    var vns = state.varNames;
    var vset = {};
    for (var e = 0; e < 3; e++) _collectVars(state.equations[e], vset);
    for (var v = 0; v < 3; v++) if (!vset[vns[v]]) return;   // 三变量都须真实出现

    var dom = _domBoxOf(state, vns);
    if (!dom) return;
    var box = {};
    for (var i = 0; i < 3; i++) {
        var b = dom[vns[i]];
        if (!(b.max > b.min)) return;
        box[vns[i]] = [b.min, b.max];
    }

    var r = null;
    try {
        r = _suan59SolveTernaryPoly(state.equations, vns, box, { maxOut: 100, valTol: 1e-6 });
    } catch (err) { r = null; }
    if (!r || !r.solved) return;
    if (!r.solutions || !r.solutions.length) return;    // 未解出 ⇒ 交回原路径（不谎报无解）

    var sols = r.solutions.map(function (p) {
        return { values: [p[0], p[1], p[2]], residual: r.residualMax };
    });
    state.done = true;
    state.result = {
        solutions: sols,
        truncated: r.truncated,
        unconverged: r.truncated,
        exactSolutionCount: r.exactCount,
        resultType: 2,
        resultTypeName: r.truncated ? "有限个解（截断）" : "有限个解",
        resultTypeDesc: r.truncated
            ? ("三元多项式系统字典序结式消元（闭式路径）；共 " + r.exactCount + " 个解，已输出前 " + sols.length + " 个（截断标记）")
            : ("三元多项式系统字典序结式消元（闭式路径：Res_z → Res_y → 一元闭式求根 → 回代）；全部 " + sols.length + " 个解均给出"),
        executionPath: "三元结式消元（suan59 · Lexicographic Resultant）",
        timeMs: performance.now() - (state.startTime || performance.now()),
        confidence: "high",
    };
    var meta = {
        exact: false,               // 解正确性已证；解集完备性未证（见 note）
        method: "lexicographic-resultant",
        exactCount: r.exactCount,
        truncated: r.truncated,
        residualMax: r.residualMax,
        completenessProven: false,
        completenessNote: r.completenessNote,
        note: "全部解均经【三个原方程】独立回代验算（残差 < 1e-6）；" +
            "结式消元引入伪根，故不宣称完备性（二元路径可给出 Sturm 完备性证明）",
    };
    state.s59Exact = meta;
    if (state.result) state.result.s59Exact = meta;
}


function _s59HasCommonYFactor(fY, gY) {
    var probes = [0.37, 2.11, -1.73];
    var votes = 0, judged = 0;
    for (var i = 0; i < probes.length; i++) {
        var a = _s59EvalPolyY(fY, probes[i]);
        var b = _s59EvalPolyY(gY, probes[i]);
        if (!a || !b) continue;
        if (_s59NumDeg(a) <= 0 || _s59NumDeg(b) <= 0) continue;   // 该 x 退化 ⇒ 跳过该探针
        judged++;
        if (_s59NumGcdNonConst(a, b)) votes++;
    }
    // 至少 2 个探针可判定，且其中 ≥2 个判有公共因子 ⇒ 认定有公共因子
    return (judged >= 2 && votes >= 2);
}


function _s59ExpandInZ(node, zName, xName, yName) {
    if (!node || !node.type) return null;
    if (node.type === 'var') {
        if (node.name === zName) return [[[0]], [[1]]];        // z = z^1 · 1
        if (node.name === yName) return [[[0], [1]]];          // y = z^0 · y
        if (node.name === xName) return [[[0, 1]]];             // x = z^0 · x
        return null;
    }
    if (node.type === 'num') return [[[node.value]]];
    if (node.type === 'unary') {
        var inner = _s59ExpandInZ(node.operand, zName, xName, yName);
        if (!inner) return null;
        if (node.op === '-') {
            var neg = [];
            for (var i = 0; i < inner.length; i++) neg.push(BQScale(inner[i], -1));
            return BTNorm(neg);
        }
        return inner;
    }
    if (node.type === 'binop') {
        var a = _s59ExpandInZ(node.left, zName, xName, yName);
        var b = _s59ExpandInZ(node.right, zName, xName, yName);
        if (!a || !b) return null;
        if (node.op === '+') return BTAdd(a, b);
        if (node.op === '-') return BTSub(a, b);
        if (node.op === '*') return BTMul(a, b);
        if (node.op === '^') {
            var e = node.right;
            if (!e || e.type !== 'num' || !isFinite(e.value) || e.value < 0
                || Math.abs(e.value - Math.round(e.value)) > 1e-12) return null;
            var p = Math.round(e.value);
            var acc = [[[1]]];
            for (var i3 = 0; i3 < p; i3++) acc = BTMul(acc, a);
            return acc;
        }
        return null;
    }
    return null;
}


function _suan59SolveTernaryPoly(eqs, vns, box, opts) {
    opts = opts || {};
    var maxOut = opts.maxOut || 100;
    var valTol = opts.valTol || 1e-6;
    var xN = vns[0], yN = vns[1], zN = vns[2];

    // ── 1) 选【含 z 的方程】做主消元，取 z 的结式 ⇒ R(x,y) ──
    // 用 PRS（伪余式链）而非 Bareiss：二元系数域 (x,y) 上 Bareiss 的精确整除常失败
    // （Sylvester 首列主元含 x、prev 含 x），PRS 只需乘方与减法，数值稳定。
    // 【2026-10-03 修正 · 漏解 9 个的真缺陷】主消元对象的选取原则：
    //   Res_z(f,g) 只在【至少一个含 z】时才是有效约束。若 f、g 都不含 z，
    //   数学上 Res_z(f,g) = f^deg(g)·g^deg(f)（退化乘积），会把「f=0 或 g=0」
    //   当成合取条件 ⇒ 解集被错误放大或缩小。
    //   实证：x³−3x=y, y³−3y=x, z=x+y 的真解有 9 个（第三方 solve 确认），
    //         原实现（拿两个不含 z 的式子做 Res_z）给出 0 个 ⇒ 漏解。
    //   正确做法：优先选【含 z 的方程】做主消元。
    var zIn = [false, false, false];
    var e3 = [
        _s59ExpandInZ(eqs[0], zN, xN, yN),
        _s59ExpandInZ(eqs[1], zN, xN, yN),
        _s59ExpandInZ(eqs[2], zN, xN, yN),
    ];
    if (!e3[0] || !e3[1] || !e3[2]) return null;
    for (var q = 0; q < 3; q++) zIn[q] = (e3[q].length >= 2);
    var nz = zIn[0] ? 0 : (zIn[1] ? 1 : (zIn[2] ? 2 : -1));
    if (nz < 0) return null;                   // 三个都不含 z ⇒ z 完全自由 ⇒ 非零维 ⇒ 放弃
    // 主消元对：含 z 的那个 + 另一个含 z 的（若有）；否则含 z 的 + 第一个不含 z 的
    var other = -1;
    for (var q2 = 0; q2 < 3; q2++) { if (q2 !== nz) { other = q2; break; } }
    var fZ = e3[nz], gZ = e3[other];
    if (!fZ || !gZ) return null;
    var R = _s59PRS(fZ, gZ);
    if (!R || R.length < 2) return null;      // R 不含 y ⇒ 无法构成 (x,y) 二元系统 ⇒ 放弃

    // ── 2) 第三个方程给出第二个 (x,y) 约束 H ──
    // (a) 含 z：H = Res_z(hZ, fZ)（z 公共根的存在性条件）
    // (b) 不含 z：它本身就是 (x,y) 的约束，直接取其 z⁰ 系数。
    //     【2026-10-03 修正】原实现对 (b) 一律 return null，把
    //     「x²+y²+z²=4, x+y+z=1, x−y=0」这类【真解存在】的系统整条拒绝
    //     （第三方 Sturm 计数确认域内 2 个实根 ⇒ 漏解，不是「无解」）。
    var third = 3 - nz - other;           // 0+1+2=3 ⇒ 剩下的那个索引（不是 nz 也不是 other）
    var hZ = e3[third];
    if (!hZ) return null;
    var H;
    if (hZ.length >= 2) {
        H = _s59PRS(hZ, fZ);
        if (!H || H.length < 2) return null;
    } else {
        var h0 = null;
        for (var k2 = 0; k2 < hZ.length; k2++) if (hZ[k2] && !BQIsZero(hZ[k2])) { h0 = hZ[k2]; break; }
        if (!h0 || BQIsZero(h0)) return null;   // 恒为 0 ⇒ 不构成约束
        H = BQNorm(h0);
        if (H.length < 2) return null;          // 只是 x 的多项式 ⇒ 需另一个含 y 的约束
    }

    // ── 3) 解二元系统 R(x,y)=0 与 H(x,y)=0 ──
    var bin = _s59SolveBinaryBQ(R, H, xN, yN, box, opts);
    if (!bin || !bin.solved || !bin.solutions.length) return bin;

    // ── 4) 逐 (x,y) 对 fZ 求 z 的根，并回代验算全部三式 ──
    var sols = [];
    var worstRes = 0;
    var truncated = false;
    for (var s = 0; s < bin.solutions.length; s++) {
        var xv = bin.solutions[s][0], yv = bin.solutions[s][1];
        var zPoly = _s59EvalBTAtXY(fZ, xv, yv);
        if (!zPoly || zPoly.length < 2) continue;
        var zRoots = null;
        try { zRoots = polynomialAllRoots(_s59PTrim(zPoly), 1e-9); } catch (e) { zRoots = null; }
        if (!zRoots) continue;
        for (var zi = 0; zi < zRoots.length; zi++) {
            var zv = zRoots[zi];
            if (!isFinite(zv)) continue;
            if (zv < box[zN][0] - 1e-9 || zv > box[zN][1] + 1e-9) continue;
            var pt = {}; pt[xN] = xv; pt[yN] = yv; pt[zN] = zv;
            var okAll = true, rmax = 0;
            for (var e2 = 0; e2 < 3; e2++) {
                var rv; try { rv = evalAST(eqs[e2], pt); } catch (err) { rv = null; }
                if (rv === null || !isFinite(rv) || Math.abs(rv) > valTol) { okAll = false; break; }
                rmax = Math.max(rmax, Math.abs(rv));
            }
            if (!okAll) continue;                 // 伪根（无穷远根 / 公共因子）⇒ 丢弃
            if (rmax > worstRes) worstRes = rmax;
            var dup = false;
            for (var d3 = 0; d3 < sols.length; d3++) {
                if (Math.abs(sols[d3][0] - xv) < 1e-7 && Math.abs(sols[d3][1] - yv) < 1e-7
                    && Math.abs(sols[d3][2] - zv) < 1e-7) { dup = true; break; }
            }
            if (!dup) sols.push([xv, yv, zv]);
        }
    }
    var exactCount = sols.length;
    if (sols.length > maxOut) { sols = sols.slice(0, maxOut); truncated = true; }
    // 【完备性 · 诚实话语】三元降维链是「z 结式 → (x,y) 结式 → x 一元式」，
    // 两次结式都会引入【伪根】（公共因子、无穷远根），伪根已在回代三式时剔除。
    // 因此 Sturm 数出的 x 根数【不能】直接当作三元解的完备性证明 ——
    // 它数的是消元后 x-多项式的根，而真解集是其中通过三式回代的那部分。
    // 结论：三元路径只保证「给出的解全部正确」，不宣称「解集完备」。
    //       完备性证明目前只在二元路径（一层结式 + Sturm）上可给出。
    return {
        solved: true, solutions: sols, exactCount: exactCount, truncated: truncated,
        residualMax: worstRes,
        // xCount 仅作诊断信息透出，不作为完备性依据
        diagXCount: bin.xCount, diagXCountProven: bin.xCountProven,
        completenessProven: false,
        completenessNote: "三元两次结式消元：解全部经三式回代验算（正确性已证）；" +
            "结式引入的伪根使 Sturm 计数不能直接充当完备性证明，故本路径不宣称完备",
    };
}
// 把 BT（三元 z 升幂，元素 BQ）在固定 (x,y) 下求值 ⇒ z 的一元升幂系数（数值数组）

function _s59EvalBTAtXY(fZ, xv, yv) {
    var out = [];
    for (var k = 0; k < fZ.length; k++) {
        out.push(BQEval(fZ[k], xv, yv));
    }
    while (out.length > 1 && Math.abs(out[out.length - 1]) < 1e-12) out.pop();
    return out;
}


function _s59SolveBinaryBQ(fYg, gYg, xName, yName, box, opts) {
    opts = opts || {};
    var maxOut = opts.maxOut || 100;
    var valTol = opts.valTol || 1e-6;
    var loX = box[xName][0], hiX = box[xName][1];
    var loY = box[yName][0], hiY = box[yName][1];

    var fY = fYg, gY = gYg;
    if (fY.length < 2 && gY.length < 2) return null;
    var swap = (gY.length > fY.length);
    if (swap) { var _t = fY; fY = gY; gY = _t; }

    var nf = fY.length - 1, ng = gY.length - 1;
    // BQ 的每个 y 系数是 x 的升幂数组（number[]），直接取 trim 后的长度减一。
    // 【2026-10-03 修正】原调 BQDegX(fY[i])（参数是 BQ，不是 number[]）恒返回 0，
    //   导致次数上界算成 0、结式被误判退化。
    function coeffDegX(cy) {
        if (!cy) return 0;
        var d = cy.length - 1;
        while (d > 0 && Math.abs(cy[d]) < 1e-12) d--;
        return d < 0 ? 0 : d;
    }
    var maxDxf = 0, maxDxg = 0;
    for (var i = 0; i < fY.length; i++) if (fY[i]) maxDxf = Math.max(maxDxf, coeffDegX(fY[i]));
    for (var j = 0; j < gY.length; j++) if (gY[j]) maxDxg = Math.max(maxDxg, coeffDegX(gY[j]));
    var resDegBound = nf * maxDxg + ng * maxDxf;
    if (resDegBound > 24) return null;

    // 结式：Bareiss 优先（已验证、快），失败则 PRS 兜底（只需乘减，数值更稳）。
    // 【2026-10-03】实测三元降维产生的 BQ 常含 x 的一次因式，Bareiss 的精确整除
    //   在这种系数域上会失败 ⇒ 必须有 PRS 这条退路，否则整类系统被误拒。
    var R = _s59ResultantX(fY, gY, resDegBound);
    if (!R || R.length < 2) {
        var R2 = _s59PRSxy(fY, gY);
        if (R2 && R2.length >= 2) R = R2;
    }
    if (!R || R.length < 2) return null;              // R 是 x 的一元多项式

    // Sturm 计数（+ 重根 square-free fallback）
    var cnt = _sturmCountAsc(R, loX, hiX);
    if (!cnt || !cnt.ok) {
        var sf = _s59SquareFree(R);
        if (sf) { var c2 = _sturmCountAsc(sf, loX, hiX); if (c2 && c2.ok) cnt = c2; }
    }
    var xCountProven = !!(cnt && cnt.ok);
    var xCount = xCountProven ? cnt.count : null;

    var xRoots = null;
    try { xRoots = polynomialAllRoots(R, 1e-8); } catch (e) { xRoots = null; }
    if (!xRoots) return null;

    var sols = [];
    var worstRes = 0;
    for (var xi = 0; xi < xRoots.length; xi++) {
        var xv = xRoots[xi];
        if (!isFinite(xv) || xv < loX - 1e-9 || xv > hiX + 1e-9) continue;
        // 固定 x，把两式都变成 y 的一元多项式（数值系数）
        var vy1 = _s59EvalBQAtX(fY, xv);
        var vy2 = _s59EvalBQAtX(gY, xv);
        if (!vy1 || !vy2) continue;
        if (vy1.length < 2 && vy2.length < 2) continue;
        var useFirst = (vy1.length >= vy2.length);
        var cand = useFirst ? vy1 : vy2;
        var yRoots = null;
        try { yRoots = polynomialAllRoots(cand, 1e-9); } catch (e) { yRoots = null; }
        if (!yRoots) continue;
        for (var yi = 0; yi < yRoots.length; yi++) {
            var yv = yRoots[yi];
            if (!isFinite(yv) || yv < loY - 1e-9 || yv > hiY + 1e-9) continue;
            // 回代 f、g 验算
            var r1 = BQEval(fY, xv, yv), r2 = BQEval(gY, xv, yv);
            if (!isFinite(r1) || !isFinite(r2)) continue;
            if (Math.abs(r1) > valTol || Math.abs(r2) > valTol) continue;
            var m = Math.max(Math.abs(r1), Math.abs(r2));
            if (m > worstRes) worstRes = m;
            var dup = false;
            for (var d = 0; d < sols.length; d++) {
                if (Math.abs(sols[d][0] - xv) < 1e-7 && Math.abs(sols[d][1] - yv) < 1e-7) { dup = true; break; }
            }
            if (!dup) sols.push([xv, yv]);
        }
    }
    var exactCount = sols.length;
    var truncated = false;
    if (sols.length > maxOut) { sols = sols.slice(0, maxOut); truncated = true; }
    return { solved: true, solutions: sols, xCount: xCount, xCountProven: xCountProven,
             exactCount: exactCount, truncated: truncated, residualMax: worstRes };
}
// BQ 在固定 x 下求值 ⇒ y 的一元升幂系数（数值数组）

function _s59EvalBQAtX(A, xv) {
    var out = [];
    for (var k = 0; k < A.length; k++) {
        var c = A[k], s = 0;
        if (c) for (var i = c.length - 1; i >= 0; i--) s = s * xv + c[i];
        out.push(s);
    }
    while (out.length > 1 && Math.abs(out[out.length - 1]) < 1e-12) out.pop();
    return out;
}
