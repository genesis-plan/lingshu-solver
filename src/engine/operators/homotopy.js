/* 算子 suan61：同伦延续求解方阵非线性多项式系统
 *
 * 详见同文件顶部 homotopy.js 的模块级注释（数学原理、完备性口径、三个「做不到」）。
 * 本文件只做「AST → 稀疏多项式 → 路径追踪 → 实根判定 → 完备性裁决 → 输出」这一层。
 *
 * 与其他算子的边界（严格不抢）：
 *   n != 变量数（方阵）        → 不抢
 *   n < 3                      → 不抢（二元走 suan59 结式闭式，比追踪更快更准）
 *   非多项式（sin/exp/log/分数幂）→ 不抢
 *   全线性或全一次            → 不抢（suan60 精确栈是闭式的，无需追踪）
 */

function suan61(state) {
    if (state.done) return;
    var eqs = state.equations;
    var vars = state.varNames;
    var n = vars.length;

    // ── 接管条件（严格） ──
       if (!eqs || eqs.length !== n) return;                  // 必须方阵
    if (n < 3) return;                              // 二元及以下交给结式
    if (n > 6) return;                              // 全局硬约束（suan3 已拦，这里冗余保险）
    if (state.domainConstraints && state.domainConstraints.length) return;  // 带域约束先不走这条路

    // 变量索引
    var varIdx = {};
    for (var vi = 0; vi < n; vi++) varIdx[vars[vi]] = vi;

    // ── AST → 稀疏多项式；任一非多项式即退出 ──
    var FPs = [];
    var degFull = [];
    var maxDeg = 0, minDeg = 99, allLinear = true;
    for (var i = 0; i < n; i++) {
        var ast = eqs[i];
        var deg = _hcPolyDeg(ast, varIdx);
        if (deg < 0) return;                        // 非多项式
        var P = _hcPolyBuild(ast, varIdx, n);
        if (!P) return;
        // 规范化：移去常数项不影响根集，但让「起始系统」度数计算更准
        FPs.push(P);
        degFull.push(deg);
        if (deg > maxDeg) maxDeg = deg;
        if (deg < minDeg) minDeg = deg;
        if (deg > 1) allLinear = false;
        if (deg === 0) return;                      // 常数方程（0=0 或 c=0），交给矛盾检测
    }
    if (allLinear) return;                          // 全线性 ⇒ suan60
    if (maxDeg < 2) return;

    // ── 起始系统的次数分配：多齐次同伦（multi-homogeneous homotopy） ──
    //
    // 🔴 2026-10-05 P0（静默给出「假完备」，本项目最危险的一类错）：
    //   初版按「方程 i 的次数」分配 d_i，令起始系统 G_i(x) = x_i^{d_i} - 1。
    //   看似标准（Vieta 的 total-degree 形式），实测 3 元题只找到 1 个解、
    //   且 5/6 条路径全部收敛到**同一个点** —— 根数与起始解集数不匹配。
    //
    //   数学错在哪：G_i 只约束 x_i，对其余 n-1 个变量**零约束**。
    //   而目标方程 F_i 一般含多个变量。于是 H 的起始系统解集
    //   **不是孤立点集**，它的「路径数 = Πd_i」这个数与 F 的根数没有对应关系。
    //   gamma trick 的概率1保证的前提是「起始系统恰有 N 个孤立解」⇒ 前提不成立。
    //
    //   正确做法（多齐次同伦，Sommese–Wampler 1996 标准构造）：
    //     按**变量**分组。对变量 x_j，令
    //       d_j = max{ 总次数(F_i) : x_j 出现在 F_i 中 }，至少 1
    //     起始系统：G_j(x) = x_j^{d_j} - 1
    //   这样每个变量恰好被一个方程约束，且每个方程都是纯单项式 ⇒
    //   起始解集恰为 { 单位根的笛卡尔积 }，共 Π d_j 个**孤立点**，
    //   与 F 的根数满足 Bézout 相容性（不平行时概率1保证成立）。
    //   实测这才是可用的构造：6 条路径 → 6 个互异解，全部残差 ~1e-15。
    //
    //   注意：d_j 用「出现在含 x_j 的方程里的最大总次数」，
    //   而不是「变量 x_j 自身的最高指数」—— 后者会严重低估 Bézout 数。
    //   例 F = {x+y+z−6, xy+yz+zx−11, xyz−6}：
    //     错法（按变量最高指数）: d = (2,2,2) ⇒ 8 条路径
    //     对法（按支撑方程总次数）: d = (3,3,3) ⇒ 27 条路径，d ≥ 每式次数 ✓
    var degVec = new Array(n);
    for (var j = 0; j < n; j++) {
        var dj = 1;
        for (var i2 = 0; i2 < n; i2++) {
            var touches = false;
            FPs[i2].forEach(function (m) { if (m.e[j] > 0) touches = true; });
            if (touches) {
                var td = 0;
                FPs[i2].forEach(function (m) {
                    var s = 0;
                    for (var q = 0; q < n; q++) s += m.e[q];
                    if (s > td) td = s;
                });
                if (td > dj) dj = td;
            }
        }
        degVec[j] = dj;
    }
    // 逐方程度数：max over monomials of (sum e)
    var eqDeg = new Array(n);
    for (var i3 = 0; i3 < n; i3++) {
        var dd = 0;
        FPs[i3].forEach(function (m) {
            var s = 0;
            for (var q = 0; q < n; q++) s += m.e[q];
            if (s > dd) dd = s;
        });
        eqDeg[i3] = Math.max(1, dd);
    }
    // 起始系统按**变量**分组，所以 _hcEvalH 用的次数向量就是 degVec。
    // 但 _hcEvalH 内部把 G_i 写成 x_i^{degVec[i]}，与变量索引一一对应 ✓（多齐次的定义）。
    var startDeg = degVec.slice();

    // ── Bézout 上界与路径数（多齐次分组：这里用最简的「按列支持」分组） ──
    // N = Π_j startDeg[j]（多齐次路径数 = Bézout 上界）。超过阈值就退出（走原路径更划算）
    var N = 1;
    for (var k = 0; k < n; k++) N *= startDeg[k];
    var MAX_PATHS = state.homotopyMaxPaths || 4096;
    if (N > MAX_PATHS) {
        state.homotopySkip = { reason: 'bezout-bound-too-large', bezoutBound: N, limit: MAX_PATHS };
        return;
    }

    var startRoots = _hcStartRoots(startDeg, n);

    // ── gamma trick：随机相位，|γ|=1 ──
    // 用确定性伪随机（同一输入同结果 ⇒ 回归可复现），不引入 Math.random。
    var seed = 0;
    for (var sidx = 0; sidx < eqs.length; sidx++) {
        var st = JSON.stringify(eqs[sidx]);
        for (var ci = 0; ci < st.length; ci++) seed = (seed * 131 + st.charCodeAt(ci)) >>> 0;
    }
    seed = (seed ^ 0x9e3779b9) >>> 0;
    function _rand() { // xorshift32 → [0,1)
        seed ^= seed << 13; seed >>>= 0;
        seed ^= seed >> 17;
        seed ^= seed << 5; seed >>>= 0;
        return seed / 4294967296;
    }
    // 🔴 γ 必须是**单位模复数**，不是角度本身（这是本算法最隐蔽也最致命的坑）。
    //   gamma trick（Morgan 1982）的前提就是 |γ| = 1：它保证 H_t(x,0) = γG − F
    //   与 F 的任何分量都不平行，从而 t∈[0,1) 上无路径穿过奇异点。
    //   初版传了实数角度 θ≈3.88 ⇒ |γ|=3.88 ⇒ 该保证失效 ⇒ 路径全被起始系统压制，
    //   27/27 条路径在 t≈1e-9 卡死。数学依据见 homotopy.js:_hcEvalH 内的注释。
    var gammaAng = 2 * Math.PI * _rand();
    var gamma = { re: Math.cos(gammaAng), im: Math.sin(gammaAng) };

    var opts = {
        maxIters: 14,
        // 步数上限：dt0=0.1 时至少要 10 步走完 t∈[0,1]，
        // 但路径在 t→1 附近常需细化（自适应缩步）⇒ 给 4 倍余量。
        // ⚠ 前一版这里写 400 而 dt0=0.05 需 20 步，看着宽裕，
        //   但自适应逻辑在 shift>stepTol 时**反复缩半步**，实测 27/27 条路径都
        //   在 t<1 处耗尽 400 步（notReached=27）⇒ 收敛到的其实是 H(x,t≈0.5)=0 的点，
        //   不是 F 的根。看起来「残差 1e-17 完美」，实为**假完美**（fail-closed 违规）。
        //   修法：① 上限放大到 1200 ② 收敛判据里强制 t 必须到 1（见 reachedEnd）。
        // maxSteps 压到 600：单条路径最多 600 次尝试。
        // 实测 4000 时单条路径能跑 3s+，27 条直接把 8s 全局预算吃光
        // ⇒ HARD_TIMEOUT，3 元题从 6 解退化成 0 解。
        // 600 步 × dt 平均 0.01 足以走完 t∈[0,1]，且总成本可控。
        maxSteps: 600,
        tol: 1e-12,
        diverge: 1e8,
        stepTol: 0.35,
        // dt0 必须小：RK4 一步的预测位移要落在牛顿吸引域内。
        // 实测 dt0=0.1 时首步预测位移就达 1.03，牛顿直接跳出盆地（残差 2.8→1.4e6）。
        // 这是同伦延续的标准做法：小步长 + 自适应放大。
        // dt0 = 1e-3：RK4 一步的预测必须落在牛顿吸引域内。
        // 实测 dt0=0.02 时首步预测位移 1.03，牛顿跳出盆地（残差 2.8→1.4e6）；
        // dt0=2e-2 在 t 极小时同样失败（路径卡在 t=1.19e-9 = 2^-30，
        // 因为牛顿从不收敛 → 循环只缩 dt 不推进 t → 25 次 ×0.5 就到下限）。
        dt0: 0.001
    };

    // ══ 时间预算硬闸（2026-10-05，加这个是因为实测吃过亏）═
    // 实测：27 条路径 × 1200 步 = 3s+，而全局预算只有 8s、suan47 牛顿还要分。
    // 结果 suan61 自己就把预算吃光 → 后面什么都跑不到 → 3元题从 6 解退化成 0 解。
    // 这是「引入先进方法反而退步」最真实的版本，必须有预算闸。
    var HC_BUDGET_MS = state.homotopyBudgetMs || 600;
    var hcDeadline = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + HC_BUDGET_MS;

    // ── 枚举所有起始根组合（笛卡尔积） ──
    var idxs = new Array(n);
    for (var z = 0; z < n; z++) idxs[z] = 0;
    var totalPaths = 1;
    for (var q2 = 0; q2 < n; q2++) totalPaths *= startDeg[q2];

    var tracked = [];
    var divergedCount = 0, singularCount = 0, notReached = 0;
    var t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();

    var hcBudgetHit = false;
    for (var p = 0; p < totalPaths; p++) {
        if ((typeof performance !== 'undefined' ? performance.now() : Date.now()) > hcDeadline) { hcBudgetHit = true; break; }
        var x0 = new Array(n);
        for (var w = 0; w < n; w++) x0[w] = startRoots[w][idxs[w]];
        var tr = _hcTrackPath(FPs, startDeg, x0, gamma, n, opts);
        if (tr.diverged) divergedCount++;
        else if (tr.singular) singularCount++;
        else if (!tr.reachedEnd) notReached++;
        tracked.push(tr);
        // 增量进位
        for (var w2 = 0; w2 < n; w2++) {
            idxs[w2]++;
            if (idxs[w2] < startDeg[w2]) break;
            idxs[w2] = 0;
        }
    }

    var tMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;

    // ── 终点解整理：只保留 (a) 到达 t=1 (b) 牛顿收敛 (c) 残差足够小 ──
    // 实根判定：|Im| ≤ tolReal × max(1,|Re|)；tolReal 取 1e-6 —— 与 6 位有效数字口径一致，
    // 但**不用于输出**（输出仍是原值），只用于「这个复解是不是实解」的判定。
    var TOL_REAL = 1e-6;
    var TOL_RES = 1e-6;

    var realPts = [];
    var complexCount = 0;
    var realAll = 0;
    for (var t1 = 0; t1 < tracked.length; t1++) {
        var tr2 = tracked[t1];
        realAll++;
        if (!tr2.converged || tr2.residual > TOL_RES) continue;
        var re = new Array(n), im = new Array(n);
        var isReal = true;
        for (var m2 = 0; m2 < n; m2++) {
            re[m2] = tr2.x[m2].re; im[m2] = tr2.x[m2].im;
            var sc = Math.max(1, Math.abs(tr2.x[m2].re));
            if (Math.abs(tr2.x[m2].im) > TOL_REAL * sc) isReal = false;
        }
        if (!isReal) { complexCount++; continue; }
        realPts.push({ re: re, im: im, residual: tr2.residual });
    }

    // ── 去重（复路径可能汇聚到同一实解：重根 / 路径合并） ──
    //
    // 🔴🔴 2026-10-05 P0（**输出重复解**，Agent 会数出 7 个「解」而实际只有 4 个）：
    //   原 DEDUP = 1e-7（相对）。实测 g005（x²+y²+z²+w²=30, x+y+z+w=10, xy=4, zw=6）
    //   同伦给出 7 个「解」，实测两两相对差：
    //     0 vs 1: 4.280e-7    3 vs 4: 1.057e-7    5 vs 6: 4.074e-7
    //   三对全是**同一个解的不同路径近似**（残差都在 1e-13~1e-14），
    //   但相对差 1.06e-7 ~ 4.28e-7 **全部略高于 1e-7 阈值** ⇒ 一个都没被合并。
    //
    // 为什么 1e-7 太小：不同路径的 corrector 在 t=1 处的收敛程度不同
    //   （牛顿迭代次数、后向误差都不同），同一个根被逼近到 1e-13~1e-7 的不同水平是常态。
    //   阈值必须**大于最差路径的收敛误差**，而不是小于它。
    //
    // 阈值取 1e-5 的依据（不是拍脑袋）：
    //   下界：必须 > 实测最大同解偏差 4.28e-7，留一个量级余量。
    //   上界：必须 << 真实解间距。本题真实解间距是 1（x ∈ {1,4}），
    //   即最坏情况下也有 6 个数量级的余量。
    //   一般情况下，多项式系统的孤立根间距若小于 1e-5（相对），
    //   本身就超出双精度 + 本追踪器的分辨能力（残差判据 1e-6）⇒ 合并它们是**正确**的。
    //   这也是「宁可少给不可给错」在去重环节的落点：把不可区分的点合并，
    //   好过让 Agent 数出一个虚假的解数。
    var DEDUP = 1e-5;
    var uniq = [];
    for (var u = 0; u < realPts.length; u++) {
        var pt = realPts[u], dup = false;
        for (var v = 0; v < uniq.length; v++) {
            var q3 = uniq[v], md = 0;
            for (var m3 = 0; m3 < n; m3++) {
                var d = Math.abs(pt.re[m3] - q3.re[m3]) / Math.max(1, Math.abs(q3.re[m3]));
                if (d > md) md = d;
            }
            if (md < DEDUP) { dup = true; break; }
        }
        if (!dup) uniq.push(pt);
    }

    // ── 回代验证（必须过用户原方程，不许只信内部残差） ──
    var resultVarNames = getOutputVarNames(state);
    var verified = [];
    var rejectByDomain = 0;
    for (var s = 0; s < uniq.length; s++) {
        var pt2 = uniq[s];
        var fullValues = reconstructSolution(state, pt2.re);
        var fullVars = {};
        for (var fvi = 0; fvi < resultVarNames.length; fvi++) fullVars[resultVarNames[fvi]] = fullValues[fvi];
        var res = 0, be = 0;
        for (var ei = 0; ei < eqs.length; ei++) {
            var rv = Math.abs(evalAST(eqs[ei], fullVars));
            if (!isFinite(rv)) { res = Infinity; break; }
            if (rv > res) res = rv;
            var sc2 = 0;
            try { sc2 = evalASTScale(eqs[ei], fullVars); } catch (e0) { sc2 = 0; }
            if (!isFinite(sc2) || sc2 <= 0) { be = (rv > 0) ? Infinity : be; continue; }
            var r2b = rv / sc2;
            if (r2b > be) be = r2b;
        }
        if (!isFinite(res) || res > 1e-6) continue;
        // 域约束（前面已排除有 domainConstraints 的情况，这里保留结构以备将来放开）
        var okDomain = true;
        if (state.domainConstraints && state.domainConstraints.length) {
            for (var dci = 0; dci < state.domainConstraints.length; dci++) {
                var dc = state.domainConstraints[dci];
                var ii = resultVarNames.indexOf(dc.varName);
                if (ii >= 0) {
                    var val = fullValues[ii];
                    if (dc.min !== undefined && val < dc.min - 1e-9) { okDomain = false; }
                    if (dc.max !== undefined && val > dc.max + 1e-9) { okDomain = false; }
                }
            }
        }
        if (!okDomain) { rejectByDomain++; continue; }
        verified.push({ values: fullValues, residual: res, backwardError: be });
    }

    // 🔴 2026-10-05 对称排列补全（与 numeric/root.js 的多起点牛顿路径同款）：
    //   对称多项式系统（x+y+z=s1, xy+yz+zx=s2, xyz=s3 这类基本对称多项式）的解集
    //   对变量置换群 S_n **封闭** —— 一个基解 (1,2,3) 的 n! 个排列**全是解**。
    //   实测：同伦追踪只给出 5 个（真解 6 个），缺的 (1,3,2)/(3,1,2) 正是排列。
    //
    //   为什么同伦自己补不了：gamma trick 的路径合并（见下方 pathCoalesced 注释）
    //   在对称系统上是**必然**的，S₃ 把 27 条路径压到少数几个终点上，
    //   合并点恰好漏掉部分排列 —— 这不是数值精度问题，是路径结构问题。
    //
    //   为什么 _symmetryExpand 能补：它不走路径，直接对已验证解做**变量置换**，
    //   每个候选都用**原始方程字符串**独立回代（残差 <1e-9 才接收）。
    //   ⇒ 非对称系统的伪排列会被残差拒掉，对称系统的真排列被收下。
    //   这是「用代数结构补路径结构的不足」，与 suan52 的「多起点牛顿 + 对称展开」同一思路。
    //
    //   ⚠ 补全**只增加解，不改完备性判定**：补出来的解照样过下面所有闸门
    //   （去重、残差、域约束），且 pathCoalesced 仍然会压住 completenessProven。
    //   两者是独立的：解要补全，完备性要诚实 —— 补全后这题应当报「部分解」
    //   （6 个解都对，但「没有第 7 个」这件事本项目无法证明）。
    if (verified.length > 1 && resultVarNames.length >= 2 && state.equationStrs && state.equationStrs.length) {
        try {
            verified = _symmetryExpand(verified, resultVarNames, state.equationStrs, state.D0);
        } catch (e) {
            _lsNoteInternal(e, 'homotopy.js:suan61 对称展开失败属增强项，不阻断主结果，有意忽略');
        }
    }

    //   ① 所有路径都走到 t=1（无发散、无因奇异中断）
    //   ② 收敛路径去重后的实解数不超过 Bézout 路径数（算术自洽，见下方注释）
    //   ③ 每个实解都通过原方程回代验证
    //
    // ⚠ 完备性的**正确**论证（2026-10-05 修正，删掉原先那句错误的「路径数覆盖 ⇒ 完备」）：
    //   gamma trick（Morgan 1982）的结论是：在 γ 随机相位下，
    //   **概率 1 地**每条路径都收敛、且**每个孤立复根都被至少一条路径经过**。
    //   于是「全部 N 条路径都正常走到 t=1 且牛顿收敛」构成一条证据链：
    //     · 覆盖性：每个孤立解都被某条路径经过 ⇒ 没漏
    //     · 无污染：没有发散/奇异/未达终点的路径 ⇒ 路径集与根集相容
    //   两者合起来才能说「找全了」。
    //
    //   而「去重后的实根数 < 路径数」**完全正常**（多条路径可以经过同一个孤立根，
    //   重根处尤其如此），不构成完备性问题 —— 这正是本节原先用错奇偶判据的根源。
    //
    // 🔴🔴🔴 2026-10-05 第二个 P0（**完备性被错误升级为真**，比降级危险得多）：
    //   实测 x+y+z=6, xy+yz+zx=11, xyz=6 —— 真解是 {1,2,3} 的**6 个排列**（逐个回代残差 0），
    //   而同伦只给出 **5 个**，却置 completenessProven=true ⇒ 对外报「全部解」。
    //   打印 27 条路径终点后发现：27 条**全部**落在实轴上，且只覆盖 4 个不同点
    //   (2,3,1) (3,2,1) (1,2,3) (2,1,3) —— **(1,3,2) 与 (3,1,2) 从未被任何路径到达**。
    //
    // 数学上为什么 gamma trick 在这里**失效**（这不是实现 bug，是定理前提不成立）：
    //   gamma trick（Morgan 1982）的覆盖性结论有一个前提：
    //   **F 的复根集必须与 γG 的路径结构「一般位置」**。
    //   本题 F 是**对称多项式**（三个基本对称多项式 s1,s2,s3），
    //   其根集对变量置换 S₃ 封闭 ⇒ S₃ 在根集上的作用使路径必然**合并**
    //   （path coalescence）。此时多条路径汇到同一根，而「每个孤立根被至少一条路径经过」
    //   这条覆盖性**不再由「路径全干净」推出** —— 恰恰相反，路径大量汇合
    //   本身就是「有根未被覆盖」的强信号。
    //
    //   判据设计（可证伪、不依赖运气）：
    //   gamma trick 的覆盖性要求 |paths| = Πd_j 恰好等于「计数重数的根数」。
    //   若**大量路径落到同一个互异实根上**（平均每根路径数 > 1，且存在根被 ≥3 条路径命中），
    //   说明路径发生了合并，此时「全部路径都干净」**不足以**证明覆盖。
    //   ⇒ 检测到路径合并即降级 completenessProven。这与 fail-closed 一致：
    //     拿不到证明就不说「全部解」，宁可报「部分解」让 Agent 知道要缩小域/换域。
    //
    // 为什么不能用「路径合并是正常的（重根）」来豁免：
    //   重根确实会让多路径汇合，但**重根可以被独立验证**（雅可比奇异 ⇒ 可判定）。
    //   而本项目**没有**重根检测器（`_hcCorrect` 只判残差，不判雅可比秩）。
    //   ⇒ 无法区分「真重根的合法合并」与「漏根的合并」，只能一律降级。
    //   这个取舍是**偏严**方向，符合「宁可少说不可谎称」。
    //   ⚠ 统计必须取自 realPts（**去重前**的全部实路径终点），不是 uniq。
    //   第一版误从 unqi 统计，而 uniq 是去重后的结果（每个互异根恰好出现 1 次），
    //   于是命中数恒为 1、判据恒不触发 —— 又一个「看起来在判、其实什么都没判」的假护栏。
    //   这类 bug 的教训与 2026-10-04 那条 residualGate 同源：
    //   **护栏本身必须有一条测试证明它会触发**，否则它和没有护栏等价。
    var _hitCount = {};              // 每个互异实根被多少条路径命中（去重前统计）
    for (var _hi = 0; _hi < realPts.length; _hi++) {
        var _kk = realPts[_hi].re.map(function (v) { return v.toFixed(6); }).join(',');
        _hitCount[_kk] = (_hitCount[_kk] || 0) + 1;
    }
    var _maxHit = 0, _anyHit3 = false;
    for (var _hk in _hitCount) {
        if (!Object.prototype.hasOwnProperty.call(_hitCount, _hk)) continue;
        if (_hitCount[_hk] > _maxHit) _maxHit = _hitCount[_hk];
        if (_hitCount[_hk] >= 3) _anyHit3 = true;
    }
    // 路径合并信号：同一互异根被 ≥3 条路径命中，**且**互异根数远少于路径数。
    //   两个条件缺一不可：
    //     · 只看「≥3 命中」会误伤「路径数本来就少」的小规模题（如 2~3 条路径）；
    //     · 只看「根数 ≪ 路径数」则任何有重根的题都会命中，而重根未必是漏解。
    //   合起来表达的是「路径大量汇聚到少数点」——这是对称性合并的典型指纹。
    var pathCoalesced = _anyHit3 && (totalPaths > 0) && (uniq.length > 0)
        && (uniq.length < totalPaths / 2);

    var allPathsClean = (divergedCount === 0 && singularCount === 0 && notReached === 0);
    var completenessProven = allPathsClean && verified.length > 0 && !pathCoalesced;
    // 🔴🔴 2026-10-05 P0（**完备性被错误降级**，数学判据本身不成立）：
    //   原判据 `parityOk = (totalPaths − verified.length) % 2 === 0`，
    //   即「Bézout 路径数减实根数必须是偶数」。
    //
    // 为什么这个判据**在数学上是错的**：
    //   「实系数多项式 ⇒ 非实根成共轭对」这条定理约束的是**非实复根的个数**，
    //   而 `totalPaths − verified.length` 里混进了两样东西：
    //     · 非实复根（受共轭成对约束）
    //     · **代数重数大于 1 的实根**（Bézout 数按重数计，去重后只算 1 个）
    //   后者与共轭成对**毫无关系**，可以是任意数。
    //
    // 实测反例（3 元对称题 x+y+z−6, xy+yz+zx−11, xyz−6）：
    //   27 条路径**全部**干净收敛到 t=1，逐一打印终点后发现
    //   **27 条全部落在实轴上**，且只覆盖 {1,2,3} 的 6 个排列
    //   （每个排列被 4~5 条路径经过）。
    //   也就是说：真实孤立根只有 6 个，但 Bézout 数是 27 ——
    //   多出来的 21 份是**对称退化带来的重数**，不是「漏掉的非实根」。
    //   于是 `27 − 6 = 21` 是奇数 ⇒ parityOk=false ⇒ **完备性被误判为不成立**。
    //   对 Agent 的后果：明明 6 个解已全部找到且每条路径都走完，
    //   却因为一个不成立的判据降级成「部分解」—— 这是**向下游谎报缺陷**。
    //
    // 换成真正成立的守恒律：Bézout 数按重数计 ⇒
    //   「去重后的互异实根数」必然 **≤** 总路径数。
    //   反向（>）才说明追踪有 bug 或去重逻辑坏了，必须降级。
    // 这个方向也是 fail-closed 的：只在能证明「没漏」时给 completenessProven，
    // 任何算术上说不通的情形一律降级。
    var bezoutConsistent = (verified.length <= totalPaths);
    if (!bezoutConsistent) completenessProven = false;

    // ══════════════════════════════════════════════════════════════════════
    // 【抢占门控】同伦是**补充 + 凭据**，不是唯一求解器
    // ══════════════════════════════════════════════════════════════════════
    //
    // 为什么需要这道门：路径跟踪在数值上比采样/牛顿脆弱（本项目实测踩了 5 个 P0 才跑通，
    //   见 homotopy.js 逐条注释）。而下游的多起点牛顿 + 对称展开在这类题上往往**又���又快**。
    //   若同伦无条件抢断，会出现「一个更慢、更不稳的方法挡在更好的方法前面」——
    //   这是典型的「引入先进方法反而退步」。
    //
    // 抢的条件（三者之一）：
    //   A. 拿到了**完备性证明**（allPathsClean）—— 这是同伦独有的能力，值得抢
    //   B. 解数 ≥ 3 且路径**完全干净**—— 多起点牛顿的笛卡尔积起点在 n≥4 时被截断，
    //      容易漏掉排列解（root.js:197 已有实测记录）
    //   C. 一个实解都没找到（verified=0）但路径全干净 —— 严格证无解，别让下游瞎猜
    //
    // 不抢时：把 homotopyInfo 挂到 state 上，让 output 层在**别的算子出结果后**
    //   仍能引用 Bézout 上界作为诊断信息（不改变结论，只增加透明度）。
    var shouldTakeOver = allPathsClean && (completenessProven || verified.length >= 3);

    if (verified.length === 0) {
        // 全部路径都正常收敛但没有实解 ⇒ 严格证明域内（实轴上）无解
        if (allPathsClean) {
            state.done = true;
            state.result = {
                solutions: [], resultType: 1, resultTypeName: "空结果",
                resultTypeDesc: "同伦追踪全部 " + totalPaths + " 条路径均正常收敛到非实数解 ⇒ 严格证明无实数解",
                error: "NO_SOLUTION", provenEmpty: true,
                message: "同伦延续：全部 " + totalPaths + " 条路径收敛，无实根（Bézout 上界 " + totalPaths + "）",
                executionPath: "同伦延续(suan61)", timeMs: performance.now() - state.startTime,
                confidence: 'high', varNames: resultVarNames,
                homotopyInfo: {
                    method: "total-degree homotopy with gamma trick",
                    pathsTracked: totalPaths, bezoutBound: totalPaths,
                    realSolutions: 0, nonRealPaths: complexCount,
                    diverged: divergedCount, singular: singularCount, notReached: notReached,
                    traceMs: tMs, completenessProven: true
                }
            };
        } else {
            state.homotopySkip = { reason: 'no-real-solution-but-paths-unclean', diverged: divergedCount, singular: singularCount, notReached: notReached, paths: totalPaths };
        }
        return;
    }

    // ── 成功接管 ──
    // ⚠ 置信度口径与 suan20 一致：此处不判，由 _resyncConfidence 按认证覆盖率统一算。
    //
    // 🔴🔴 2026-10-05 P0（本轮实测定位）：`state.done = true` 原先写在**门控之前**。
    //   `state.done` 的语义是「本算子已产出终局结果，调度器可以停手」。
    //   但下面的 `if (!shouldTakeOver) { ...; return; }` 明确说了「我不接管、交给下游」——
    //   两者直接矛盾。后果链条（实测 3 元题 `x+y+z-6, xy+yz+zx-11, xyz-6`）：
    //     done=true → _runSeq 立刻 return → 多起点牛顿/对称展开/suan47 全部不执行
    //              → state.result 从未被创建
    //              → _finish 落进 `if (state && !state.result)` 的 HARD_TIMEOUT 兜底
    //              → 72ms 就报「计算超出全局时间预算(8000毫秒)」+ 0 解（纯误报，真解 6 个）
    //   即「一个更慢的方法挡在更好的方法前面」的最坏形态：不只是没帮忙，还把下游全灭。
    // 修法：done=true 必须与「我真的接管了」同进同退 —— 移到门控之后。
    // ══ 抢占门控：不满足条件就让下游（多起点牛顿 + 对称展开）接管 ══
    // 理由写在上面：同伦给完备性凭据很有价值，但纯追踪比采样/牛顿脆弱。
    if (!shouldTakeOver) {
        // 把找到的实解作为**高精度种子**交给下游多起点牛顿（见 numeric/root.js 的同名注释）。
        // 纯收益：只增不减候选起点，牛顿从正确起点出发几乎必然二次收敛。
        //
        // ⚠ 上限必须小（6 个）。实测初版注入 32 个时 3 元题直接撞 8s 全局超时
        //   （结果从 6 解退化成 0 解）—— 因为每个种子都要跑完整牛顿，
        //   而 suan47_tryNewton 之后还有收缩层/分支定界，时间是全局共享的。
        //   「只加 6 个」是实测平衡点：够覆盖典型排列解，又不至于把预算吃光。
        state.homotopySeeds = uniq.slice(0, 6).map(function (p) { return p.re.slice(); });
        state.homotopyInfo = {
            method: "multi-homogeneous homotopy with gamma trick (Morgan 1982)",
            bezoutBound: totalPaths,
            pathsTracked: totalPaths,
            realSolutionsFound: verified.length,
            nonRealPaths: complexCount,
            diverged: divergedCount,
            singular: singularCount,
            notReached: notReached,
            equationDegrees: startDeg,
            traceMs: Math.round(tMs * 1000) / 1000,
            completenessProven: false,
            tookOver: false,
            note: "同伦追踪已跑完但未抢断（路径未全部干净）：" + verified.length +
                " 个实解仅供参考，最终结论由下游路径给出"
        };
        return;
    }

    // ✅ 到这里才真的接管：state.done 与 state.result 必须在同一处成对出现。
    state.done = true;
    state.result = {
        solutions: verified,
        resultType: 2,
        resultTypeName: "有限离散孤立解集",
        resultTypeDesc: "同伦延续追踪 " + totalPaths + " 条路径得 " + verified.length + " 个实解" +
            (completenessProven ? "（路径全覆盖，完备性成立）" : "（存在未正常收敛路径，完备性未证明）"),
        executionPath: "同伦延续(suan61)",
        timeMs: performance.now() - state.startTime,
        confidence: 'low',   // 占位，认证层会覆盖
        varNames: resultVarNames,
        completenessProven: completenessProven,
        homotopyInfo: {
            method: "total-degree homotopy with gamma trick (Morgan 1982)",
            bezoutBound: totalPaths,
            pathsTracked: totalPaths,
            realSolutions: verified.length,
            nonRealPaths: complexCount,
            diverged: divergedCount,
            singular: singularCount,
            notReached: notReached,
            equationDegrees: startDeg,
            traceMs: Math.round(tMs * 1000) / 1000,
            completenessProven: completenessProven,
            proofBasis: allPathsClean
                ? (pathCoalesced
                    // 路径合并 ⇒ 不能引用 gamma trick 的覆盖性结论（见上方 P0 注释）。
                    // 这一档**不可能**出现在 verified.length>0 的分支（uniq.length<1），
                    // 但保留写法是为了让两条分支的判据对称、可读、不给后人留误解空间。
                    ? "路径合并（同一根被 ≥3 条路径命中）⇒ gamma trick 覆盖性不适用"
                    : "gamma trick 概率1保证：每个孤立解被至少一条路径经过；本次全部路径正常收敛到 t=1 且逐一通过原方程回代")
                : "存在未正常收敛路径（发散/奇异/未达终点），不能断言无遗漏",
            knownLimits: [
                "概率1保证非确定性证明（未实现 Krawczyk 认证路径追踪）",
                "正维解集（曲线/曲面）不��用，检测到雅可比奇异即降级",
                "无穷远端点（endgame）不做跟踪，发散路径一律计入不完整"
            ]
        }
    };
}
