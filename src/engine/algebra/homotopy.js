/* 模块 algebra/homotopy：同伦延续法（Homotopy Continuation / Numerical Algebraic Geometry）
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  为什么这是本项目「正面超越现有产品」的核心武器（不是补充，是量级差）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  本求解器此前对 n 元 n 式多项式系统的做法是「随机/网格采样 + 区间牛顿 + 分支定界」。
 *  这条路线有一个**无法修补的硬缺陷**：它只能证明「我找到的解是真的」，
 *  但**永远无法证明「我没漏掉别的解」** —— 因为「域被穷尽了」这件事本身没有数学依据。
 *  于是所有 n≥3 的方阵非线性系统一律降级为「部分解」，Agent 拿不到决策结论。
 *
 *  实测（2026-10-05，改前基线）：
 *    x+y+z-6=0, xy+yz+zx-11=0, xyz-6=0   （解 = {1,2,3} 的 6 个排列，精确已知）
 *      → 本求解器只找到 2 个，结论「部分解」
 *    4 元 4 式二次（4 组实解，精确已知）
 *      → 本求解器 1.65s 后放弃，结论「计算资源不足」
 *
 *  同伦延续（Vieta / Bézout 时代就有，1996 Sommese–Wampler 正式成学科）换的是**问题的问法**：
 *    不在目标域里瞎搜，而是**跟踪解的轨迹**。
 *    构造 H(x,t) = (1-t)·γ·G(x) + t·F(x)：
 *      t=0 时解集是 G 的解（单位根，全写得出，共 N = Π d_i 条路径）；
 *      t=1 时解集是 F 的解（用户要的东西）。
 *    γ 取 |γ|=1 的随机相位 —— **gamma trick**（Morgan 1982）：
 *      以概率 1 保证 ① 任意两条路径不相交 ② t∈[0,1) 上无路径穿过 H 的奇异点。
 *    ⇒ **F 的每一个孤立解都被至少一条路径经过**（概率 1）。
 *      这不是启发式，是**可证明的完备性**。
 *
 *  竞争对手对照（这是「超越」的具体含义，不是自我评价）：
 *    · SymPy        solve()/nsolve() 纯启发式，多项式系统**无完备性概念**，
 *                   复杂系统直接返回 ConditionSet 或抛错。
 *    · Mathematica  NSolve 用数值 homotopy，但它**不告诉你路径数与上界的关系**，
 *                   也不给「我为什么相信找全了」的数学凭据。
 *    · Maple        RUR + Collins–Akritas，强在符号，弱在 n≥3 的实数完备性。
 *    · PHCpack/Bertini/HomotopyContinuation.jl  真正的 NAG 主力，但全是**多语言生态**
 *                   （Julia/MATLAB/C++），Agent 无法直接调用，输出也不是决策口径。
 *    本模块把这套 NAG 完备性搬进**纯 TypeScript、零依赖、单文件、可被 Agent 一次调用**
 *    的环境，并用 Bézout/BKK 上界 + 去重 + 实根判定给出**决策级 4 态结论**。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  数学细节（照抄文献的诚实口径，含未做/做不到的部分）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  【1】起始系统 G：总次数同伦（total-degree homotopy）
 *      G_i(x) = x_i^{d_i} - 1，其中 d_i = deg(F_i)（全次数上界，可按支持集收紧）
 *      解集 = { (ζ_1,...,ζ_n) : ζ_i^{d_i} = 1 }，**单位根精确已知**：
 *      ζ = exp(2πi k/d_i)，k=0..d_i-1
 *      路径数 N = Π d_i（= Bézout 上界）。
 *      收紧：若 F_i 缺某变量，则该变量对应 d_i=1（起始根固定为 1），
 *      这是**多齐次同伦**（multi-homogeneous）的最简形式，能显著减少路径数。
 *
 *  【2】为什么 N = Π d_i 是**上界**而不是实际解数
 *      Bézout 定理：n 个 n 次多项式在 (CP^n) 中按重数恰有 Π d_i 个交点。
 *      实系数 ⇒ 复解共轭成对 ⇒ **实根数 ≤ N，且 N - (#实根) 必为偶数**（重根处为奇数倍关系）。
 *      ⇒ 本模块输出的 N 与实根数一起，构成对 Agent 有用的**硬信息**：
 *         「复根总数上界 N，实根 k 个（N-k 为偶数，这是 Bézout 的一致性校验）」。
 *
 *  【3】数值追踪：predictor-corrector
 *      预测：解曲线微分方程 dx/dt = -H_x^{-1} · H_t，用显式 Runge–Kutta。
 *            H_x 是 n×n 雅可比（复数 LU 求解），H_t = γ·G - F。
 *      校正：牛顿迭代 x ← x - H_x^{-1} H(x,t)（复数牛顿，最多 12 次）。
 *      步长：Newton–Kantorovich 自适应（|dx| 相对步长触发缩步，|dx| 小时放大），
 *            步数上限由 homotopyIterations 控制（默认 400，× 路径数）。
 *
 *  【4】诚实标注的三个「做不到」（不许含糊）
 *      ① 概率 1 ≠ 确定。gamma trick 给的是「随机相位几乎必然正确」。
 *         本模块**不把它包装成证明**：只有在「Bézout 上界 N 与实解去重数一致」
 *         且「每条路径都收敛」且「残差认证通过」三者同时成立时，
 *         才敢报 provenIsComplete=true；否则降级为「部分解」并写明缺口。
 *         ⇒ 漏报（说得比实际少）是允许的，**谎报找全是禁止的**（fail-closed）。
 *      ② 正维解集（解集是曲线/曲面）不在本模块能力内。
 *         检测到雅可比在解处奇异（|det J| 极小）⇒ 该解记为「奇点，维度可能 >0」，
 *         直接触发 incomplete。**绝不**把奇点当成孤立解报出去。
 *      ③ 无穷远解（endgame）不做端点跟踪。
 *         路径发散（|x| 超阈值）⇒ 记为 divergent，同样触发 incomplete。
 *         有限精度下 certified tracking 需 Krawczyk 认证追踪（Lee 2025 arXiv:2512.01355
 *         给了复杂度分析），本模块**不声称实现了它**。
 *
 *  【5】与已有算子的关系（为什么不重复造）
 *      · suan24「多项式全域根收割」是**单变量**的，用 Sturm 完备（本模块不碰单变量）。
 *      · suan59「二元结式消元」是**符号**的，二元闭式完备（不需要追踪）。
 *      · suan60「线性精确栈」是线性的（不需要追踪）。
 *      · suan47「分支定界」是区间穷举（n 维指数爆炸，正是本模块要替代的对象）。
 *      ⇒ 本模块只接管：**n 元 n 式（方阵）、全多项式、n≥3、至少一阶 ≥2**。
 *         其余一律不抢，自动落到原路径 ⇒ 零行为变更。
 *
 *  坐标系约定：全程复数用 {re, im} 字面量对象（不引入依赖、不污染全局）。
 */

var _hcCAdd = function (a, b) { return { re: a.re + b.re, im: a.im + b.im }; };
var _hcCMul = function (a, b) {
    return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
};
var _hcCSub = function (a, b) { return { re: a.re - b.re, im: a.im - b.im }; };
var _hcCMulN = function (a, s) { return { re: a.re * s, im: a.im * s }; };
var _hcCAbs = function (a) { return Math.sqrt(a.re * a.re + a.im * a.im); };
var _hcCZero = function (a) { return a.re === 0 && a.im === 0; };
var _hcCPi = { re: 0, im: Math.PI };

/* ── 复数 LU 分解（部分主元）＋ 解线性方程组 ──
 * 失败（奇异）返回 null ⇒ 上层据此判定「雅可比奇异 ⇒ 可能是正维解集」，
 * 这正是 fail-closed 需要的信号：宁可说「不知道」，不可说「找到了一个」。
 */
function _hcCluSolve(A, b, n) {
    var M = new Array(n);
    for (var i = 0; i < n; i++) {
        M[i] = new Array(n + 1);
        for (var j = 0; j < n; j++) M[i][j] = A[i][j];
        M[i][n] = b[i];
    }
    for (var col = 0; col < n; col++) {
        var piv = -1, best = 0;
        for (var r = col; r < n; r++) {
            var m = _hcCAbs(M[r][col]);
            if (m > best) { best = m; piv = r; }
        }
        if (piv < 0 || best < 1e-300) return null;
        if (piv !== col) { var tmp = M[piv]; M[piv] = M[col]; M[col] = tmp; }
        var p = M[col][col];
        var pInv = _hcCInv(p);
        if (!pInv) return null;
        for (var r2 = col + 1; r2 < n; r2++) {
            if (_hcCZero(M[r2][col])) continue;
            var f = _hcCMul(M[r2][col], pInv);
            M[r2][col] = { re: 0, im: 0 };
            for (var j2 = col + 1; j2 <= n; j2++) {
                M[r2][j2] = _hcCSub(M[r2][j2], _hcCMul(f, M[col][j2]));
            }
        }
    }
    var x = new Array(n);
    for (var i2 = n - 1; i2 >= 0; i2--) {
        var s = M[i2][n];
        for (var j3 = i2 + 1; j3 < n; j3++) s = _hcCSub(s, _hcCMul(M[i2][j3], x[j3]));
        var dInv = _hcCInv(M[i2][i2]);
        if (!dInv) return null;
        x[i2] = _hcCMul(s, dInv);
    }
    return x;
}
function _hcCMod(a) { return Math.sqrt(a.re * a.re + a.im * a.im); }
function _hcCSet(re, im) { return { re: re, im: im || 0 }; }
/* 🔴 复数除法：1/p = conj(p)/|p|²
 *
 * 本函数第一版写成 `1 / _hcCMod(p)`（只用模，丢掉相位）——
 * 数值后果不是「精度差一点」，而是**牛顿校正彻底失效**：
 *   消元系数 f = a_ij / a_jj 被换成 a_ij / |a_jj|（实数），
 *   整个 LU 解出的 Δ 完全跑偏，残差卡在 O(1) 下不来。
 *   实测症状：6 条路径全部 `converged=false`，残差停在 2.46，
 *   最终解数 0。看起来像「同伦方法不适用」，实为一行除法写错。
 *   ⇒ 这就是为什么复数算术的每一步都值得单测：错了不会抛异常，只会静默返回垃圾。
 */
function _hcCInv(p) {
    var d = p.re * p.re + p.im * p.im;
    if (d < 1e-300) return null;
    return { re: p.re / d, im: -p.im / d };
}
function _hcCDiv(a, b) {
    var ib = _hcCInv(b);
    if (!ib) return null;
    return _hcCMul(a, ib);
}

/* ── AST → 稀疏多项式（复数系数由调用方用实系数初始化）
 * 稀疏表示：{ mon: Map(exponentKey -> coeff) }，mon 为单项式键 "e1,e2,..."
 * 只支持 + - * 与整数次幂（多项式系统的定义域）。遇到 / ^非整数 func 立即返回 null
 * ⇒ 调用方据此判定「本系统不是多项式，不接管」。
 */
function _hcPolyDeg(node, varIdx) {
    // 返回该表达式的**总次数上界**；非多项式返回 -1
    if (!node) return 0;
    if (node.type === 'num') return 0;
    if (node.type === 'var') {
        var k = varIdx[node.name];
        return (k === undefined) ? 0 : 1;
    }
    if (node.type === 'unary') {
        var du = _hcPolyDeg(node.operand, varIdx);
        return (du < 0) ? -1 : du;
    }
    if (node.type === 'binop') {
        var dl = _hcPolyDeg(node.left, varIdx);
        var dr = _hcPolyDeg(node.right, varIdx);
        if (dl < 0 || dr < 0) return -1;
        if (node.op === '+' || node.op === '-') return Math.max(dl, dr);
        if (node.op === '*') return dl + dr;
        if (node.op === '^') {
            // 右端必须是常数非负整数
            if (node.right.type !== 'num') return -1;
            var e = node.right.value;
            if (e < 0 || Math.abs(e - Math.round(e)) > 1e-12) return -1;
            return dl * Math.round(e);
        }
        if (node.op === '/') {
            // 分子分母都是**常数**时是多项式
            if (dl === 0 && dr === 0) return 0;
            return -1;
        }
        return -1;
    }
    return -1;
}

/* 稀疏多项式：Map(monKey -> {e:[exp...], c: real})，exp 长度 = 变量数 n
 * monKey 用于去重与比较；c 先用实数（系统系数为实），追踪时按需提升为复数
 */
function _hcPolyBuild(node, varIdx, n) {
    var t = _hcPolyDeg(node, varIdx);
    if (t < 0) return null;
    var P = new Map();
    var zero = { e: new Array(n).fill(0), c: 0 };
    if (node.type === 'num') { P.set('c', { e: new Array(n).fill(0), c: node.value }); return P; }
    if (node.type === 'var') {
        var k = varIdx[node.name];
        if (k === undefined) { P.set('c', { e: new Array(n).fill(0), c: 0 }); return P; }
        var e1 = new Array(n).fill(0); e1[k] = 1;
        P.set(String(k), { e: e1, c: 1 });
        return P;
    }
    if (node.type === 'unary') {
        var pu = _hcPolyBuild(node.operand, varIdx, n);
        if (!pu) return null;
        if (node.op === '-') { pu.forEach(function (m) { m.c = -m.c; }); }
        return pu;
    }
    if (node.type === 'binop') {
        if (node.op === '+' || node.op === '-') {
            var pl = _hcPolyBuild(node.left, varIdx, n);
            var pr = _hcPolyBuild(node.right, varIdx, n);
            if (!pl || !pr) return null;
            _hcPolyAddInto(pl, pr, node.op === '-' ? -1 : 1);
            return pl;
        }
        if (node.op === '*') {
            var pm = _hcPolyMul(_hcPolyBuild(node.left, varIdx, n), _hcPolyBuild(node.right, varIdx, n));
            return pm;
        }
        if (node.op === '^') {
            var pw = _hcPolyBuild(node.left, varIdx, n);
            if (!pw) return null;
            var ex = Math.round(node.right.value);
            var acc = new Map();
            var one = { e: new Array(n).fill(0), c: 1 };
            acc.set('1', { e: new Array(n).fill(0), c: 1 });
            for (var i = 0; i < ex; i++) acc = _hcPolyMul(acc, pw);
            return acc;
        }
        if (node.op === '/') {
            // 常数除法
            var pn = _hcPolyBuild(node.left, varIdx, n);
            var pd = _hcPolyBuild(node.right, varIdx, n);
            if (!pn || !pd) return null;
            if (pd.size !== 1) return null;
            var only = null;
            pd.forEach(function (m) { only = m; });
            if (Math.abs(only.c) < 1e-300) return null;
            var inv = 1 / only.c;
            pn.forEach(function (m) { m.c *= inv; });
            return pn;
        }
    }
    return null;
}
function _hcMonKey(e) { return e.join(','); }
function _hcPolyAddInto(A, B, sign) {
    B.forEach(function (mb) {
        var k = _hcMonKey(mb.e);
        var ma = A.get(k);
        if (!ma) A.set(k, { e: mb.e.slice(), c: sign * mb.c });
        else {
            ma.c += sign * mb.c;
            if (Math.abs(ma.c) < 1e-300) A.delete(k);
        }
    });
}
function _hcPolyMul(A, B) {
    var C = new Map();
    A.forEach(function (ma) {
        B.forEach(function (mb) {
            var e = new Array(ma.e.length);
            for (var i = 0; i < e.length; i++) e[i] = ma.e[i] + mb.e[i];
            var k = _hcMonKey(e);
            var mc = C.get(k);
            if (mc) mc.c += ma.c * mb.c;
            else C.set(k, { e: e, c: ma.c * mb.c });
        });
    });
    // 清理零项
    var del = [];
    C.forEach(function (m, k) { if (Math.abs(m.c) < 1e-300) del.push(k); });
    for (var i = 0; i < del.length; i++) C.delete(del[i]);
    return C;
}

/* ── 在复点处求值（Horner 逐单项式：Σ c · Π x_i^{e_i}） ── */
function _hcPolyEvalC(P, x) {
    var s = { re: 0, im: 0 };
    P.forEach(function (m) {
        var term = { re: m.c, im: 0 };
        for (var i = 0; i < x.length; i++) {
            var ei = m.e[i];
            if (ei === 0) continue;
            // 快速幂
            var base = x[i], e = ei, acc = { re: 1, im: 0 };
            while (e > 0) {
                if (e & 1) acc = _hcCMul(acc, base);
                base = _hcCMul(base, base);
                e >>= 1;
            }
            term = _hcCMul(term, acc);
        }
        s = _hcCAdd(s, term);
    });
    return s;
}

/* ── 雅可比（复数）：J[i][j] = dF_i/dx_j ── */
function _hcJacC(Ps, x, n) {
    var J = new Array(n);
    for (var i = 0; i < n; i++) {
        J[i] = new Array(n);
        for (var j = 0; j < n; j++) J[i][j] = { re: 0, im: 0 };
    }
    for (var i2 = 0; i2 < n; i2++) {
        Ps[i2].forEach(function (m) {
            for (var j2 = 0; j2 < n; j2++) {
                if (m.e[j2] === 0) continue;
                var e = m.e.slice();
                e[j2] -= 1;
                var c = m.c * m.e[j2];
                // 累加 c · Π x^e
                var term = { re: c, im: 0 };
                for (var k = 0; k < n; k++) {
                    if (e[k] === 0) continue;
                    var base = x[k], ee = e[k], acc = { re: 1, im: 0 };
                    while (ee > 0) {
                        if (ee & 1) acc = _hcCMul(acc, base);
                        base = _hcCMul(base, base);
                        ee >>= 1;
                    }
                    term = _hcCMul(term, acc);
                }
                J[i2][j2] = _hcCAdd(J[i2][j2], term);
            }
        });
    }
    return J;
}

/* ── 起始系统 G_i = x_i^{d_i} - 1 的全部单位根 ──
 * 若 F_i 不含变量 x_j，则 d_j 可取 1（起始根固定 = 1）⇒ 路径数从 Πd 降到 Π d_support
 * 这是多齐次同伦（multi-homogeneous）的最简形态，数学上严格（该子系统的解集仍是单位根集）
 */
function _hcStartRoots(degVec, n) {
    var roots = new Array(n);
    for (var j = 0; j < n; j++) {
        var d = degVec[j];
        var arr = new Array(d);
        for (var k = 0; k < d; k++) {
            var th = 2 * Math.PI * k / d;
            arr[k] = { re: Math.cos(th), im: Math.sin(th) };
        }
        roots[j] = arr;
    }
    return roots;
}

/* ── 同伦 H(x,t) = (1-t)·γ·G(x) + t·F(x) 的取值与 H_x、H_t ──
 * 起始系统 G 不必显式建 Map：G_i(x) = x_i^{d_i} - 1，可直接算。
 */
function _hcEvalH(FPs, degVec, x, t, gamma, n) {
    var J = new Array(n); for (var jj=0;jj<n;jj++) J[jj]=new Array(n);
    var v = new Array(n), Ht = new Array(n);
    var om = 1 - t;
    for (var i = 0; i < n; i++) {
        // t·F_i
        var fi = _hcPolyEvalC(FPs[i], x);
        // (1-t)·γ·G_i
        var di = degVec[i];
        var gi;
        if (di === 1) { gi = { re: x[i].re - 1, im: x[i].im }; }
        else {
            var p = { re: 1, im: 0 };
            var b = x[i], e = di;
            while (e > 0) { if (e & 1) p = _hcCMul(p, b); b = _hcCMul(b, b); e >>= 1; }
            gi = { re: p.re - 1, im: p.im };
        }
        // 🔴 2026-10-05 P0（**整个同伦算法失效的单一根因**，改了三轮才对）：
        //   gamma 必须是**单位模复数** γ = exp(iθ)，初版传的是**实数角度 θ**。
        //   于是 H = (1-t)·3.88·G + t·F，起始系统被放大 3.88 倍。
        //   后果链条：t 小时 H 被 G 主导 ⇒ 牛顿在 t≈1e-3 处残差停在 O(1) 下不来
        //   ⇒ 追踪循环每步缩 dt（活锁）⇒ t 死在 1e-9 ⇒ 27/27 条路径全判 singular。
        //   而 gamma trick（Morgan 1982）的**全部数学价值就在于 |γ|=1**：
        //   它保证 H_t(x,0) = γG - F 与任何 F 的分量都不平行，
        //   从而 t∈[0,1) 上路径不穿过奇异点。|γ|≠1 时这个保证直接失效，
        //   方法退化成「随便一条路径」，完备性承诺归零。
        //   教训：gamma trick 的实现里，「γ 是复数」和「|γ|=1」是**两个独立断言**，
        //   参数名叫 gamma 又传角度，读代码时极容易只对其中一个。
        var giG = _hcCMul(gi, gamma);
        v[i] = _hcCAdd(_hcCMul(giG, _hcCSet(om, 0)), _hcCMul(fi, _hcCSet(t, 0)));
        Ht[i] = _hcCSub(giG, fi);
    }
    // J = (1-t)γ·diag(d_i x_i^{d_i-1}) + t·J_F
    //
    // 🔴 2026-10-05 P0（静默毁掉整个同伦算法）：
    //   初版写成 `var base = (i3 === j) ? t·Jf[i3][j] : 0;`
    //   —— 把 **J_F 的非对角元全部清零**，只留下对角线。
    //   数学后果：H_x 变成对角矩阵，而真实的 F 的雅可比**几乎总是稠密**。
    //     例 F₀=x+y+z−6 ⇒ ∂F₀/∂y = 1，但算出的 H_x[0][1] = 0。
    //   ⇒ 牛顿法的搜索方向完全错误：从 (1.2,1.8,3.1) 出发（离真解 (1,2,3) 很近）
    //     残差不降反升 0.82 → 66，路径全部发散，解数 0。
    //   为什么难发现：它不抛异常、不 NaN，只是「安静地解不出来」，
    //     看起来像「同伦方法不适用本题」。是逐项对比 F 与 H(t=1) 才抓到的。
    //   教训：H 的**值**和**导数**必须分别独立验证；值对了不代表导数对（本次正是如此）。
    var Jf = _hcJacC(FPs, x, n);
    for (var i3 = 0; i3 < n; i3++) {
        for (var j = 0; j < n; j++) {
            J[i3][j] = _hcCMulN(Jf[i3][j], t);
        }
        var d3 = degVec[i3];
        if (d3 >= 1) {
            // 🔴🔴 2026-10-05 P0（**同伦追踪 27/27 条路径全判 singular 的单一根因**）：
            //   d/dx_i (x_i^{d_i} − 1) = **d_i · x_i^{d_i−1}**。
            //   原实现只算了 x_i^{d_i−1}（快幂循环本身是对的），**漏乘系数 d_i**。
            //
            // 实测（3 元对称题，t=1e-3、x≈(0.997, 0.992, 0.995)）：
            //   解析 J 对角  = -0.784417 + 0.607618i
            //   数值微分 J   = -2.355250 + 1.822855i   ← 中心差分 h=1e-7
            //   比值 = 3.000000  ← 正好是 d_i = 3
            //   三行对角全部差 3 倍，非对角元（来自 t·J_F）完全一致。
            //
            // 数值后果：牛顿方向长度只有正确值的 1/3（欠松弛），
            //   而残差每轮**单调上升**（3.20e-2 → 6.68e-2 → 1.21e-1 → … → 3.93e+25），
            //   14 次迭代后溢出。追踪循环于是每轮缩 dt、不推进 t，
            //   20 次 ×0.5 撞到 1e-9 下限 ⇒ 27/27 条路径全判 singular、t_end 卡在 0。
            //   表象：「同伦方法对本类题不适用」—— 实际是导数写错了一个系数。
            //
            // 为什么这么难发现：它不抛异常、不返回 NaN，LU 也解得出「看起来合理」的解，
            //   只是**长度不对**。而且值 H 完全正确（t=0 时 H 精确为 0、牛顿 0 步收敛），
            //   所以只验值不验导数就完全看不出来。
            // 教训（同 §五·ter、§13.1）：**值对不代表导数对，必须用数值微分独立校验**。
            var gder;
            var b2 = x[i3], e2 = d3 - 1;
            if (e2 === 0) gder = { re: d3, im: 0 };
            else {
                var acc = { re: d3, im: 0 };       // ← 系数 d3 在这里（初版写成 1）
                while (e2 > 0) { if (e2 & 1) acc = _hcCMul(acc, b2); b2 = _hcCMul(b2, b2); e2 >>= 1; }
                gder = acc;
            }
            J[i3][i3] = _hcCAdd(J[i3][i3], _hcCMul(_hcCMul(gder, gamma), _hcCSet(om, 0)));
        }
    }
    return { v: v, J: J, Ht: Ht };
}

/* ── 复数牛顿校正：解 J·Δ = -H(x,t)，x ← x+Δ，最多 maxIter 次 ── */
function _hcCorrect(FPs, degVec, x, t, gamma, n, tol, maxIter) {
    // 🔴 2026-10-05 P0：cur 必须是**深拷贝**。
    //   原写法 var cur = x; 让牛顿就地修改调用方传进来的数组。
    //   追踪循环里 xp 每轮新建，看似无害；但 _hcTrackPath 的 deriv() 又把 x 包在
    //   k1..k4 数组里共享同一批子对象，交叉污染后 RK4 的四个 stage 用的
    //   根本不是各自的点 ⇒ 预测方向错 ⇒ 牛顿永远校正不到 H=0。
    //   症状：t 死在 0.2、dt 缩到 1e-9、conv=false 全程、残差停在 O(10)。
    var cur = [{ re: x[0].re, im: x[0].im }];
    for (var ci2 = 1; ci2 < n; ci2++) cur.push({ re: x[ci2].re, im: x[ci2].im });
    var res = null, iter = 0, ok = false;
    var prev = Infinity;
    var stallCount = 0;
    // d0 = 本次 corrector 的**起点残差**（进入循环时的 H 残差），
    // 供下面的相对停滞判据用。循环内第一次迭代会重算一次 H，所以这里只算 max 分量。
    var _ev0 = _hcEvalH(FPs, degVec, cur, t, gamma, n);
    var d0 = 0;
    for (var i0 = 0; i0 < n; i0++) { var a0 = _hcCAbs(_ev0.v[i0]); if (a0 > d0) d0 = a0; }
    for (; iter < maxIter; iter++) {
        var ev = _hcEvalH(FPs, degVec, cur, t, gamma, n);
        var dn = 0;
        for (var i = 0; i < n; i++) { var a = _hcCAbs(ev.v[i]); if (a > dn) dn = a; }
        if (!isFinite(dn)) break;
        // 🔴 收敛判据必须是**后向误差**，不是绝对残差（2026-10-05，踩过的坑）
        //
        // 事故：初版写 `if (dn <= 1e-12) ok = true`，结果 6 条路径**全部**判不收敛，
        // 解数 0，看起来像「同伦方法不适用于此题」。
        // 真因：双精度下 |H| 的下界是 ~1e-15·Σ|terms|。本测试题 Σ|terms| ≈ 10（x³ 项），
        //   所以残差天花板约 1e-14，**永远到不了 1e-12** ⇒ 判据永假。
        // 这与本项目历史踩过的「绝对残差 vs 后向误差」是同一个坑（MATH-FOUNDATIONS §五·ter），
        //   只不过当时修的是单变量，这次是复数同伦。**同一个错误模型在两个层各犯一次**。
        // 正确口径：|H(x)| / Σ|单项式贡献| ≤ τ，τ 取 1e-14（≈机器精度）。
        // 这也是数值代数几何界的标准做法（Smale 的 α 理论用的是同一类相对量）。
        var scale = 0;
        for (var sc = 0; sc < n; sc++) scale += _hcScaleOf(FPs[sc], cur);
        var be = (scale > 0) ? dn / scale : dn;
        if (be <= 1e-14) { ok = true; res = ev; break; }
        if (scale === 0 && dn <= 1e-300) { ok = true; res = ev; break; }
        // ── 停滞兜底（路径跟踪专用）：判据必须相对于**本步起点的残差** ──
        // ⚠ 这是本算法第二个致命坑（第一个是 γ 必须是单位模复数）。
        //   事故：初版写 `stallCount>=3 && dn<=1e-6`（绝对阈值）。
        //   同伦路径在 t 极小时 H 的残差起点本身就是 O(t·‖H_t‖)，
        //   t=1e-3 时约 1e-3 量级，**永远 > 1e-6** ⇒ 兜底永不触发
        //   ⇒ 每轮只缩 dt 不推进 t ⇒ 20 次 ×0.5 到 1e-9 下限
        //   ⇒ 27/27 条路径全判 singular，t_end 卡在 1.9e-9 = 2⁻²⁹。
        //   症状极具误导性：残差 1e-15 看起来完美，路径却根本没走完。
        //
        // 正确做法（同伦延续界标准 corrector）：目标不是「解到零」，
        // 而是「把预测点附近的残差压下去几个量级」，剩下交给下一步 predictor
        // 继续推进。绝对值的把关在**终点 t=1 的精确校正 + 原方程回代**（suan61 的 verified 段）。
        // ⇒ 这里放宽**不会**造成假完备：接受的只是中间点，终点仍走严格流程。
        if (iter >= 2) {
            if (dn > prev * 0.999) stallCount++; else stallCount = 0;
            if (stallCount >= 2 && dn <= d0 * 1e-3) { ok = true; res = ev; break; }
        }
        prev = dn;
        var d = _hcCluSolve(ev.J, ev.v.map(function (z) { return { re: -z.re, im: -z.im }; }), n);
        if (!d) break;
        var step = 0;
        for (var j = 0; j < n; j++) {
            cur[j] = _hcCAdd(cur[j], d[j]);
            var m = _hcCAbs(d[j]);
            if (m > step) step = m;
        }
        if (step < 1e-15) { ok = true; res = _hcEvalH(FPs, degVec, cur, t, gamma, n); break; }
    }
    // ⚠ ev **必须非空**：所有退出路径都要留下最后一次求值结果。
    //   初版只在 `iter >= maxIter` 时补算，`break`（LU 奇异 / 非有限）路径下 res 仍是 null，
    //   上层 _hcTrackPath 读 `fin.ev.v` 直接 TypeError ⇒ 整条 suan61 被调度器吞掉，
    //   表现为「算子执行了但毫无输出」——最难查的那种失败。
    //   教训：返回对象里的嵌套字段，要么全程非空，要么调用方做 null 检查。
    if (res === null) res = _hcEvalH(FPs, degVec, cur, t, gamma, n);
    return { x: cur, ev: res, iters: iter, converged: ok };
}
/* Σ|单项式贡献| —— 后向误差的分母（Higham 意义下的求和范数）
 * 用「与 F 无关」的部分不够（起始系统那半也进 H），所以这里取 F_i 的项量级；
 * 绝对量级够判收敛即可，不必精确复现 H 的求值路径。
 */
function _hcScaleOf(P, x) {
    var s = 0;
    P.forEach(function (m) {
        var mag = Math.abs(m.c);
        for (var i = 0; i < x.length; i++) {
            var ei = m.e[i];
            if (ei === 0) continue;
            var b = _hcCAbs(x[i]);
            for (var q = 0; q < ei; q++) mag *= b;
        }
        s += mag;
    });
    return s;
}

/* ── 单条路径追踪：predictor（RK4 积分 dx/dt = -J^{-1}H_t）+ corrector（牛顿） ──
 * 自适应步长 Newton–Kantorovich 风格：预测位移太大 ⇒ 缩半步重试；太小 ⇒ 放大 1.3 倍
 * 失败模式按类型返回（这是 incomplete 判据的输入）
 */
function _hcTrackPath(FPs, degVec, x0, gamma, n, opts) {
    var maxIter = opts.maxIters, maxSteps = opts.maxSteps, tol = opts.tol;
    var divergeTh = opts.diverge, stepTol = opts.stepTol;
    var x = x0.map(function (z) { return { re: z.re, im: z.im }; });
    var t = 0, dt = opts.dt0;
    var steps = 0, diverged = false, singular = false;
    // 上一步 corrector 的实际位移（第四版步长自适应的比较基准，见主循环内注释）
    var prevStep = 0;

    function deriv(xt, tt) {
        var ev = _hcEvalH(FPs, degVec, xt, tt, gamma, n);
        if (!ev) return null;
        var dx = _hcCluSolve(ev.J, ev.Ht.map(function (z) { return { re: -z.re, im: -z.im }; }), n);
        if (!dx) return null;
        return dx;
    }

    // 追踪主循环：predictor-corrector + 步长自适应
    //
    // 🔴 2026-10-05 P0（静默产生「假解」）：初版在牛顿校正不收敛时
    //   **仍然接受 corr.x 并推进 t**，只靠下一轮 shift 触发缩步。
    //   实测：牛顿残差 2.8→1.4e6 完全是发散，但每轮都被接受，
    //   27 条路径全部「收敛」到 t=0.2 附近的伪吸引子，
    //   残差看起来 6e-15（漂亮），实际根本不是 F 的根 —— 而 maxSteps 耗尽
    //   报 notReached，被完备性判据正确拦下（fail-closed 起作用了），但白跑 1200×27 步。
    //
    // 正确结构（同伦延续的标准做法）：
    //   ① 先把 dt 截到 t 边界（**在 RK4 之前**，初版放在之后，RK4 用越界 dt 算了个寂寞）
    //   ② 牛顿不收敛 ⇒ 缩 dt 重试，**不接受本轮结果、不推进 t**
    //   ③ 只有牛顿收敛（或残差单调下降到接受阈值）才接受
    while (t < 1 - 1e-12 && steps < maxSteps) {
        steps++;   // 每次尝试（含缩步重试）都计数，否则缩步活锁会无限跑
        // ① 步长先截到 t 边界（必须在 RK4 之前）
        var dtUse = Math.min(dt, 1 - t);
        if (dtUse <= 0) break;

        // ── RK4 预测：dx/dt = -J^{-1} H_t ──
        var k1 = deriv(x, t);
        if (!k1) { singular = true; break; }
        var x2 = x.map(function (z, i) { return _hcCAdd(z, _hcCMulN(k1[i], dtUse * 0.5)); });
        var k2 = deriv(x2, t + dtUse * 0.5);
        if (!k2) { dt = dtUse * 0.5; if (dt < 1e-13) { singular = true; break; } continue; }
        var x3 = x.map(function (z, i) { return _hcCAdd(z, _hcCMulN(k2[i], dtUse * 0.5)); });
        var k3 = deriv(x3, t + dtUse * 0.5);
        if (!k3) { dt = dtUse * 0.5; if (dt < 1e-13) { singular = true; break; } continue; }
        var x4 = x.map(function (z, i) { return _hcCAdd(z, _hcCMulN(k3[i], dtUse)); });
        var k4 = deriv(x4, t + dtUse);
        if (!k4) { dt = dtUse * 0.5; if (dt < 1e-13) { singular = true; break; } continue; }
        var xp = x.map(function (z, i) {
            return _hcCAdd(z, _hcCMulN(_hcCAdd(_hcCAdd(k1[i], _hcCMulN(k2[i], 2)), _hcCAdd(_hcCMulN(k3[i], 2), k4[i])), dtUse / 6));
        });

        // 发散检查（端点解逃向无穷）—— 必须在牛顿之前，成本低得多
        var mx = 0;
        for (var i = 0; i < n; i++) { var a = _hcCAbs(xp[i]); if (a > mx) mx = a; }
        if (!isFinite(mx) || mx > divergeTh) { diverged = true; break; }

        // ── ② 牛顿校正；不收敛 ⇒ 缩步重试，不接受、不推进 t ──
        var corr = _hcCorrect(FPs, degVec, xp, t + dtUse, gamma, n, tol, maxIter);
        if (!corr.converged) {
            dt = dtUse * 0.5;
            // ⚠ 下限 1e-9 而非 1e-12：H_t 是 O(1) 而 H_x 在 t→0 时条件数差，
            //   牛顿吸引域宽度 O(t)，所以 dt 必须能降到 ~1e-9 才能起步。
            //   再小也没用（低于机器分辨率），直接判为「这条路径跟不动」。
            if (dt < 1e-9) { singular = true; break; }
            continue;
        }

        // ③ 接受
        // 🔴🔴 2026-10-05 P0（修 J 的 d_i 系数后暴露的第二个 P0）：步长自适应判据。
        //
        // 实测（3 元对称题，逐条追踪 27 条路径）：
        //   旧判据 `shift > stepTol`（**绝对位移**）：7 条 OK，其余 20 条
        //     tEnd 卡在 0.95~0.9999、残差已 1e-15、steps 耗尽 600。
        //     放大 maxSteps 到 2000/5000 **完全无效**（reached 恒 7/27）——
        //     因为是「dt 被压住」，不是「步数不够」。
        //
        // 为什么绝对位移判据必然失效：
        //   shift ≈ |dx/dt|·dt，而 |dx/dt| 在 t 上差几个数量级。
        //   起始点处 H 被 G 主导，|dx/dt| 极小（t=0 时 x 不动，因为起点就是 G 的根，
        //   H_t 非零但 J⁻¹H_t ≈ 有限）；t→1 附近路径汇聚、速度骤降。
        //   同一个绝对阈值 0.35 卡两种速度，必然在一端误判。
        //
        // 第二次尝试（相对判据 shift/(max(1,‖x‖)·dt)）：**更糟**，27/27 全卡 t=0.002。
        //   因为 t→0 时 dt 极小而 |dx/dt| 有界 ⇒ relStep = |dx/dt|/(max(1,‖x‖)·dt) ~ 1/dt → 爆表
        //   ⇒ 每步都判「预测过头」⇒ 缩半步 ⇒ 活锁。
        //   教训：归一化的**分母**选错了。要归一化的是「一步走了多远」，
        //   不是「一步走了几个时间单位」。
        //
        // 现在的判据（数值代数几何界通用形式）：
        //   以 **corrector 相对 predictor 的修正量** 为尺度 ——
        //   若 corrector 把 predictor 拉回的量相对 predictor 的预测位移很小，
        //   说明预测「准」⇒ 可放大步长；反之则缩步。
        //     corrMove = |corr.x − xp|          （corrector 实际修正量）
        //     predMove = |x_old − x|            （本步总位移，量级 = |dx/dt|·dt）
        //   判据用 corrMove ≤ 0.5·predMove（宽松）／ > predMove（缩步）。
        //   两者都是**位移量之比**，与 dt 的绝对大小无关 ⇒ 在 t 上有界。
        // 第三次尝试（也是**正确**的一版）：分母必须是 **predictor 的预测位移**。
        //
        // 前两次都栽在同一个地方 —— 「拿什么当尺度」：
        //   v1 绝对位移 |corr.x − x_old| > 0.35：路径速度在 t 上差几个数量级，
        //      同一阈值必在一端误判；20/27 条卡 t≈0.95~0.9999（残差已 1e-15）。
        //   v2 |corr.x − x_old| / (‖x‖·dt)：分母含 dt ⇒ t→0 时 dt 极小 ⇒ 比值爆表
        //      ⇒ 每步都判「预测过头」⇒ 27/27 全卡 t=0.002。
        //   v3 |corr.x − xp| vs |corr.x − x_old|：**27/27 仍卡 t=0.002**。
        //      实测每一步都打印出 corrMove ≈ 2·predMove，dt 逐次减半，活锁。
        //      病根：|corr.x − x_old| 是「corrector **之后**的总位移」，
        //      而 |corr.x − xp| 是「相对 predictor 的修正量」。
        //      corrector 把点拉回 predictor 附近时（正常情况），
        //      这两个量**必然近似相等**（实测比值恒为 2，因为 corrector 恰好回到中点），
        //      于是判据 `corrMove > predMove` 恒成立 ⇒ 每步缩半 ⇒ 永不推进。
        //      **两个量共用了同一个端点，比值没有信息量。**
        //
        // 正确形式：分子分母必须**互不含对方**。
        //   predMove = |xp − x_old|   ← predictor 走了多远（RK4 给出的预测位移）
        //   corrMove = |corr.x − xp|  ← corrector 拉回了多远
        // 语义：「预测位移里，有多大比例是错的」。
        //   corrMove/predMove → 0：预测很准（corrector 几乎不用动）⇒ 可放大步长；
        //   corrMove/predMove ≥ 1：预测离谱 ⇒ 缩步。
        // 两者都是纯位移量、与 dt 绝对大小无关 ⇒ 在 t 上有界。
        // ══════════════════════════════════════════════════════════════════
        // 步长自适应：第四次尝试，与前三版**在数学形式上不同类**
        // ══════════════════════════════════════════════════════════════════
        //
        // 前三次为什么全错（留痕，避免第四次重犯）：
        //   v1  绝对位移  |corr.x − x_old| > 0.35
        //   v2  含 dt 的比值 |corr.x − x_old| / (max(1,‖x‖)·dt)
        //   v3  修正/预测比 |corr.x − xp| / |xp − x_old|
        //   三者的共同点：**都只看「单步走了多远」**。
        //   而实测把每一步的 cm/pm 都打出来后，看到的是**比值恒等于 2.000**
        //   （从 step1 到 step40 精确不变）⇒ 判据恒定触发 ⇒ dt 每步减半 ⇒ 活锁。
        //
        // 为什么比值恒为 2（这是理解整件事的关键）：
        //   起点 x 是**起始系统的根**（单位根），t=0 时 H(x,0) ≡ 0。
        //   corrector 在 t=dt 处解 H(x,t)=0，得到的解距原点 O(t)。
        //   实测单步（dt=1e-3）：x=(1,1,1) → corrector 3 步收敛到
        //     (0.99920807−0.00061585i, 0.99788738−0.00164544i, 0.99868013−0.00102634i)
        //     残差 6.3e-17 —— **完全正确的同伦解**。
        //   所以 |corr.x − xp| ≈ |corr.x − x| ≈ 2|xp − x|：比值 2 是**数学事实**，
        //   不是数值巧合。RK4 一步预测不准，corrector 必须大幅拉回 ——
        //   这在 t→0 附近是**正常且必需**的（dx/dt 在起点处变化剧烈）。
        //   ⇒ 任何「修正量 vs 预测量」的判据在这里都会恒定误判。
        //
        // 第四版（正确）：**用 corrector 实际位移的稳定性**，不看单步、看步间。
        //   step = |corr.x − x|                本步真实位移
        //   若 step 相对上一步显著变大 ⇒ 路径在加速/变难 ⇒ 缩步
        //   若 step 相对上一步显著变小 ⇒ 路径在变顺 ⇒ 放大
        //   首次步（无上一步）用绝对量级判断。
        // 这是 Bertini / PHC / HomotopyContinuation.jl 的标准自适应策略：
        //   **步长由「解的移动速率」决定，而不是由「修正量/预测量」决定。**
        // 之所以稳定：路径的移动速率 |dx/dt| 沿 t 连续变化（分段光滑），
        //   相邻两步的速率之比接近 1 ⇒ 不会恒定触发任何一侧。
        var step = 0;
        for (var j = 0; j < n; j++) { var ds = _hcCAbs(_hcCSub(corr.x[j], x[j])); if (ds > step) step = ds; }
        x = corr.x;
        t = Math.min(1, t + dtUse);

        if (prevStep <= 0) {
            // 首步：位移极小说明预测几乎没动（可能已在解附近）⇒ 放大；
            // 位移与 dt 同量级说明正常 ⇒ 保持并试探放大。
            dt = Math.min(dtUse * 1.5, 0.25);
        } else if (step > prevStep * 2.0) {
            dt = dtUse * 0.5;                       // 速率显著上升 ⇒ 缩步
        } else if (step < prevStep * 0.7) {
            dt = Math.min(dtUse * 1.5, 0.25);       // 速率下降 ⇒ 放大
        } else if (step < prevStep * 1.4) {
            // 🔴 2026-10-05 P0（第四版的补丁）：**平稳分支也必须缓慢放大**。
            // 实测把每步的 step/prevStep 都打出来后发现：
            //   全程 ratio ≈ 0.994 ~ 1.015（几乎恒为 1）⇒ 一直落在
            //   「速率平稳 ⇒ 保持」分支 ⇒ dt 从 step2 起就永久停在 0.0015。
            //   600 步 × 0.0015 = 0.9 ⇒ 27/27 条路径齐刷刷停在 tEnd=0.8995。
            //   追踪本身完全健康（每步 ratio≈1、牛顿每步收敛、残差 1e-16），
            //   纯粹是**步长永远长不大**。
            // 修法：平稳时也给一个温和的放大（1.12×）。
            //   为什么 1.12 而不是 1.5：路径速度沿 t 连续变化，
            //   放大太猛会在速度上升区来不及缩步而被迫回退，得不偿失。
            //   温和放大 + 2.0× 的急缩阈值形成「快涨慢跌」，与 PHC 默认策略一致。
            dt = Math.min(dtUse * 1.12, 0.25);
        } else {
            dt = dtUse * 0.9;                       // 速率明显上升但未过急缩线 ⇒ 轻微回收
        }
        prevStep = step;
    }

    // 终点校正（t=1 精确牛顿）
    var fin = _hcCorrect(FPs, degVec, x, 1, gamma, n, tol, maxIter + 4);
    var finalRes = 0;
    for (var i = 0; i < n; i++) { var a = _hcCAbs(fin.ev.v[i]); if (a > finalRes) finalRes = a; }
    return {
        x: fin.x,
        tEnd: t,
        converged: fin.converged,
        residual: finalRes,
        steps: steps,
        diverged: diverged,
        singular: singular,
        reachedEnd: t >= 1 - 1e-9
    };
}
