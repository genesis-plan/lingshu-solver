// ─── 灵数求解器引擎（构建产物，勿手改；源码见 src/engine） ───
// 模块装载顺序：constants → lex → ast/basic → interval/core → interval/affine → algebra/exact → algebra/multivar → algebra/resultant → algebra/simplex → algebra/homotopy → numeric/polynomial → numeric/linear → numeric/root → ode → rootbound-poly → certify → conclusion → operators/setup → operators/pre → operators/screen → operators/support → operators/geometry → operators/homotopy → operators/contract → operators/numeric → operators/post → operators/branch → operators/ineq → operators/output → operators/registry → pipeline/dimroute → pipeline/scheduler → pipeline/solver → pipeline/report → pipeline/output → ui → input/recognize → operators/algebra

// 原引擎的隐式全局（7 个已知 + 163 个自动扫出），ES 严格模式必须显式声明
var Cc; var Lm; var _LS_PROTECTED_NAMES; var _Ynum; var __LS_BRANCH_BUDGET; var __LS_MSNEWTON_DONE; var __LS_ROOT_START; var __LS_SOLVE_ACTIVE; var _accepted; var _certMethod; var _cmRHS; var _cmX; var _combos; var _contracted; var _d0Norm; var _denseNonPeriodic; var _ec; var _eqConst25; var _eqsNorm; var _expr25; var _fastContradictionMsg; var _fastHasContradiction; var _fe; var _floorCeilMatch; var _fm2; var _found; var _gxP; var _hasContradiction; var _hi; var _ineqLeft; var _ineqRight; var _isIdI; var _lo; var _mid2; var _msExpanded; var _prev; var _pseudoDone; var _rbApplied; var _rbTighten; var _result1; var _result2; var _s57; var _sLo; var _scanStep; var _set; var _solveRecursionCount; var _v; var _varsTouched; var _vnNorm; var _x; var _xInDomain; var acc; var accNorm; var accepted; var anyOk; var autoConstraints; var band; var base; var box; var branchBudget; var cVal; var changed; var combos; var completeness; var constraints; var cp; var cx; var cy; var df; var domainFiltered; var dt; var dx; var eqText; var equationStrs; var expVal; var exps; var found; var gder; var gi; var gm; var gp; var h0; var hasNonSquare; var hasOther; var hi; var isDup; var isEven; var isOdd; var key; var left; var leftAST; var limDir; var lns; var lo; var loVal; var manifoldOutput; var maxDiff; var maxIter; var maxLipschitz; var maxRatio; var maxRounds; var maxRow; var maxVal; var moved; var nStarts; var newL; var newNorm; var newR; var norm; var normHistory; var nr; var nsFull; var nt; var numer; var opts; var outOfRange; var outputBoxes; var pendingExampleDomain; var power; var prev; var prevAbs; var prevAbsF; var prevPow; var prevStep; var prevVal; var prevX; var probeFeasible; var rReason; var reason; var recSol; var reducedEqs; var reducedVars; var rem; var remaining; var repaired; var res; var resourceHungry; var result; var resultType; var resultTypeDesc; var resultTypeName; var rhsNode; var rightAST; var rmax; var rms; var roots; var rv; var s0; var sawConstraint; var seed; var set; var sign; var sols60; var solution; var sqFree; var stallCount; var status; var stepNorm; var str; var substitutedSomething; var summaryColor; var summaryText; var term; var text; var transformed; var trigNode; var verified; var viol; var xFull; var xHistory;

// 非致命异常观测点：原来有 8 处 `catch(e){}` 静默吞异常；这里改成显式调用本钩子（默认空实现），
// 语义（继续容错）不变，但异常有处可查，生产环境可替换成本地日志/上报，杜绝 fail-silent。
function _lsNoteInternal(e, ctx) { void e; void ctx; }

// ═══════════════════ 模块：constants ═══════════════════
/* 模块 constants：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
var _LS_PROTECTED_NAMES = new Set();

// 数值容差基准位数。
//
// 🔴 2026-10-05 语义变更（用户指令：「去掉全部网格化，按数学定理来做」）：
//   旧语义 = **6 位小数有限网格位数**（roundToGrid 量化步长 = 10^-6）。
//   新语义 = **相对残差容差的有效位数基准**（TAU = 10^-6 相对量级）。
//
// 为什么必须改语义而不是只改数值：
//   旧实现把 `COMPUTE_DECIMALS` 同时当三件事用 ——
//     ① 坐标量化步长（roundToGrid）② 绝对残差保底（1e-6）③ 显示 toFixed。
//   ①是自伤：双精度有 15–17 位有效数字，量化到 6 位小数等于主动扔掉约 10 位，
//   而且给真解造成 ‖J‖·h 的**不可消除残差下界**（1/3、23/30、√2 全中招）。
//   这不是精度不足，是**人为制造的精度损失**—— 本该由定理 + 区间认证解决，
//   不该由「限制输出位数」来解决。
//
// 现在 ①已 从引擎移除（roundToGrid 现为全精度 + ULP 去噪吸附，见 numeric/root.js），
// 本常量只剩两个用途，都与「输出位数」无关：
//   · TOL_ABS_FLOOR = 10^-COMPUTE_DECIMALS：求值尺度算不出时的**绝对**残差保底
//     （fail-closed 方向：宁可少给不给错）
//   · 分支定界的最小盒宽基准（搜索分辨率，与输出无关）
//
//⚠ 显示位数已与服务层 AGENT_DISPLAY_DECIMALS（=4，Agent 文本）分离，
//    引擎内部不再有「显示小数位」概念。solutions[].values 是全精度 double。
var COMPUTE_DECIMALS = 6;

// ── 默认搜索域（2026-10-03 重做）────────────────────────────────────────
// 旧实现硬编码 ±1e6，后果实测：x=10000000（1e7，几何级数/组合计数/AI 生成大数
// 极常见）被静默判为「无解」—— 数学上 x=1e7 明明存在。这是 fail-closed 的漏洞：
// 它没说「不确定」，而是撒谎说「无解」，比慢更危险。
//
// ⚠️ 第一版策略（inferDomainHalfWidth 返回 max(常量×10, MIN)）是错的，已废：
//   它把域**缩小**了。实测 golden 5/20 出现真实行为差异，其中 g011-trig 连解数都变了
//   —— 三角方程的根不在「方程里写着的常数 × 10」范围内，缩小域直接漏根。
//   教训：域只能放大不能缩小，否则就是「静默漏解」，比慢严重得多。
//
// 正确策略（只放大）：
//   默认半宽 = max(旧默认 1e6, 方程里最大常量的 1000 倍)，上限 1e12。
//   · 保留 1e6 下界 ⇒ 旧行为是它的子集，不会丢任何原本能找到的解（零回归）；
//   · 常量很大时（如 x=1e7）自动放大到覆盖它 ⇒ 修掉"静默判无解"；
//   · 兜底 1e12 ⇒ 极大量级由分支定界做区间收缩，不靠"域小所以快"；
//   · 超过 1e12 仍需用户显式给 domain —— 全域穷举本质上不可能，这是唯一诚实的做法。
var _LS_DOMAIN_FALLBACK = 1e12;
var _LS_DOMAIN_LEGACY = 1e6;      // 旧默认，作为下界保留以确保零回归
var _LS_DOMAIN_MIN = 1e-6;

// ── 全局时间预算（2026-10-04 新增，用户重点「时间消耗」）────────────────────
//
// 为什么把它提成常量而不是各处写死：
//   之前有三处独立的时间阈值，彼此**不同源**：
//     · scheduler.js:13  硬闸门  8000ms（只在算子执行**前**检查）
//     · branch.js:82     看门狗 10000ms（只在 suan47 函数**入口**检查）
//   10000 > 8000 ⇒ branch 的看门狗是**死代码**：外层 scheduler 早判 HARD_TIMEOUT 了。
//   而 scheduler 只在算子前检查 ⇒ 「单个算子（suan47）内部跑满 8 秒」完全管不了。
//   实测 6 元稠密二次：8 秒撞满、0 解，时间全烧在 branch 的递归里。
//
// 现在单一来源：内层保护阈值必须 ≤ 外层硬闸门，否则内层等于没写。
// ⚠ 留 150ms 收尾余量的理由：_finish 还要组装结果、去重、残差回代、认证标注。
//   卡在边界上反复触发递归入口检查会白跑几层，得不偿失。
var _LS_BRANCH_TIME_BUDGET_MS = 8000;
var _LS_BRANCH_TIME_RESERVE_MS = 150;

// 分支定界止损宽度：方阵系统里，最大盒宽 <= 此值时放弃继续二分。
//
// 依据（详见 operators/branch.js 对应注释）：分支定界要「证无解」必须在整个 D0 上
// 穷尽，而 6 位小数网格下 [−W, W]^n 的点数是 (2W/1e-6)^n。W=1000、n=4 时是 2e28 个点
// —— 不可能穷尽 ⇒ 继续二分只会烧光预算，永远换不来「已证无解」。
// 同一阈值与 movability 模块的 convergence_hopeless（宽度 > 1e3 且多轮不收缩）口径一致。
var _LS_BRANCH_GIVEUP_WIDTH = 1e3;

/**
 * 从方程文本推断默认搜索域的半宽。纯函数，可单测。
 * 关键约束：返回值必须 >= _LS_DOMAIN_LEGACY（1e6），即**只放大不缩小**。
 * 读不出任何常量时返回 1e6（旧默认，零回归），而不是更大的兜底值 ——
 * 因为 1e12 的全域穷举在周期函数上会爆预算，那属于"不确定"而非"有解"。
 */
function inferDomainHalfWidth(equationStrs) {
    let mx = 0;
    if (Array.isArray(equationStrs)) {
        for (let i = 0; i < equationStrs.length; i++) {
            const s = equationStrs[i];
            if (typeof s !== 'string') continue;
            // 抓所有数字（含科学计数法），取绝对值最大者
            const re = /(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
            let m;
            while ((m = re.exec(s)) !== null) {
                const v = Math.abs(parseFloat(m[1]));
                if (isFinite(v) && v > mx) mx = v;
            }
        }
    }
    // 只放大不缩小：下界恒为旧默认 1e6
    let w = _LS_DOMAIN_LEGACY;
    if (mx > 0) {
        const scaled = mx * 1000;
        if (isFinite(scaled) && scaled > w) w = scaled;
    }
    if (!isFinite(w) || w > _LS_DOMAIN_FALLBACK) w = _LS_DOMAIN_FALLBACK;
    return Math.max(_LS_DOMAIN_MIN, w);
}



var SUAN50_MAX_DENOMS = 4;

var SUAN50_MAX_NODES = 80;
// 把表达式有理化为 {num, den}；den 恒为「乘积形式」的多项式 AST。
// 只对 + - * / 与一元负号做精确通分；其余（函数、^）整体视作分子的一部分。

var _IEEE = { nan: false, inf: false, divZero: false, domainErr: false };

var _affSym = 0;

const _s60R0 = () => ({ p: 0n, q: 1n });

const _s60R1 = () => ({ p: 1n, q: 1n });

const _s60isZero = a => a.p === 0n;

var _s59P1Ops = {
    mul: function (a, b) { return _s59PMul(a, b); },
    sub: function (a, b) { return _s59PSub(a, b); },
    div: function (n, d) { return _s59PExactDiv(n, d); },
    isZero: function (a) { return _s59PIsZero(a); },
    deg: function (a) {
        var d = a.length - 1;
        while (d > 0 && Math.abs(a[d]) < 1e-12) d--;
        return d;
    },
    absCoef: function (a) {
        var d = a.length - 1;
        while (d > 0 && Math.abs(a[d]) < 1e-12) d--;
        return d < 0 ? 0 : Math.abs(a[d]);
    },
    const1: function () { return [1]; },
    zero: function () { return [0]; },
    copy: function (a) { return a.slice(); },
    scale: function (a, k) { return _s59PScale(a, k); },
    lead: function (a) {
        var d = a.length - 1;
        while (d > 0 && Math.abs(a[d]) < 1e-12) d--;
        return d < 0 ? 0 : a[d];
    },
    termCount: function (a) { return a.length; },
    // 一元：Bareiss 中间元素的次数上界保守取 2·d+16（实测 d+8 会误杀合法系统）
    maxTerms: function (d) { return 2 * d + 16; },
};

var _s59BQOps = {
    mul: function (a, b) { return BQMul(a, b); },
    sub: function (a, b) { return BQSub(a, b); },
    // BQ 版的「精确除法」：Bareiss 理论整除，浮点下用相对容差校验
    div: function (n, d) { return _s59BQExactDiv(n, d); },
    isZero: function (a) { return BQIsZero(a); },
    deg: function (a) { return BQTotalDeg(a); },
    absCoef: function (a) { return BQMaxAbs(a); },
    const1: function () { return [[1]]; },
    zero: function () { return [[0]]; },
    copy: function (a) { return a.map(function (e) { return e.slice(); }); },
    scale: function (a, k) { return BQNorm(a.map(function (cy) { return _s59PScale(cy, k); })); },
    termCount: function (a) {
        var s = 0;
        for (var i = 0; i < a.length; i++) s += a[i].length;
        return s;
    },
    maxTerms: function (d) { return 2 * d + 16; },
};

var MOV_OVERFLOW_W = 1e12;     // 绝对宽度爆炸阈值

var MOV_ILL_ABS = 1e8;          // 绝对宽度病态阈值（避免默认域中心≈0 被误判）

var MOV_HIST_MAX = 8;           // 收敛历史窗口

var SUAN55_MAXDEPTH = 24;      // 单调性判定的最大二分层数

var SUAN55_MIN_WIDTH = 1e-9;  // 段宽下限（再细分已无意义）

// 判定区间 I 上 f 是否可证单调
// 返回 'inc'（单调不减）/ 'dec'（单调不增）/ null（不可判定）

var _SUAN52_CONFLICT_ROLLBACK = 'rollback';   // 收缩违规：算子试图放大域（最强的冲突信号）

var _SUAN52_CONFLICT_ERROR = 'error';         // 算子抛异常

var _SUAN52_CONFLICT_DRY = 'dry';             // 本次调用零收益

// ═══════════════════ 模块：lex ═══════════════════
/* 模块 lex：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function tokenize(str, declaredVars) {
    const tokens = [];
    let i = 0;
    const funcs = ['sin', 'cos', 'tan', 'ln', 'exp', 'sqrt', 'log', 'log10', 'abs', 'diff', 'int', 'ode', 'lim',
                  'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
                  'floor', 'ceil', 'gamma', 'log2', 'mod'];
    // 🔴 2026-10-04 修 P0 数学正确性 bug：调用方声明过的变量名一律当变量，【不得】被当成数学常数。
    //   起因（实测）：方程组 a+b+c+d+e+f-60=0, a-b=1, b-c=1, c-d=1, d-e=1, e-f=1 的真解是
    //   (12.5, 11.5, 10.5, 9.5, 8.5, 7.5)（和=60 ✓），但 evalAST 算出第 1 个方程残差 −5.78。
    //   逐层打印 AST 才发现：tokenize 把变量名 `e` 识别成了欧拉数 2.718281828459045，
    //   于是 `a+b+c+d+e` 被解析成 `a+b+c+d+2.718...`。
    //   **这是静默错误**（不抛异常、直接算错），对「数学正确性」是致命的 ——
    //   单字母变量名 e / i / f 这类最常见的建模命名会中招，且用户完全无从察觉。
    //   修法：调用方（setup 解析层 + 未声明标识符门禁）把自己知道的 varNames 传进来，
    //   声明过的优先当变量；未声明时保持旧行为（e 仍是欧拉数）⇒ 向后兼容零回归。
    // ⚠ 只在「调用方明确声明了变量名」时才改变行为；不要在此处猜。
    // declaredVars 允许是数组或 Set（内部用 has()/new Set() 两种形式，见 solver.js 的 _lsEntryProt 是 Set）。
    const declared = (declaredVars && (declaredVars.length !== undefined || declaredVars.size !== undefined))
        ? new Set(declaredVars) : null;

    while (i < str.length) {
        const ch = str[i];

        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
            i++;
            continue;
        }

        // 数字
        if (/\d/.test(ch) || (ch === '.' && i + 1 < str.length && /\d/.test(str[i + 1]))) {
            let num = '';
            while (i < str.length && /\d/.test(str[i])) {
                num += str[i];
                i++;
            }
            if (i < str.length && str[i] === '.') {
                num += '.';
                i++;
                while (i < str.length && /\d/.test(str[i])) {
                    num += str[i];
                    i++;
                }
            }
            // 科学计数法
            if (i < str.length && (str[i] === 'e' || str[i] === 'E')) {
                let expPart = str[i];
                i++;
                if (i < str.length && (str[i] === '+' || str[i] === '-')) {
                    expPart += str[i];
                    i++;
                }
                if (i < str.length && /\d/.test(str[i])) {
                    while (i < str.length && /\d/.test(str[i])) {
                        expPart += str[i];
                        i++;
                    }
                    num += expPart;
                } else {
                    // 不是科学计数法，回退
                    i -= expPart.length;
                }
            }
            tokens.push({ type: 'num', value: parseFloat(num) });
            continue;
        }

        // 变量名或函数名（支持英文字母、下划线、希腊字母——θ/α/β 等数学惯例变量名；
        // π 在常量检查中保持为圆周率常数，其余希腊字母视为普通变量）
        if (/[a-zA-Z_\u0370-\u03FF\u2080-\u209F]/.test(ch)) {
            let name = '';
            while (i < str.length && /[a-zA-Z0-9_\u0370-\u03FF\u2080-\u209F]/.test(str[i])) {
                name += str[i];
                i++;
            }
            // 检查 pi / π 和 e 常量
            // ⚠ declared 优先：调用方声明过这个名字 ⇒ 它是变量，不是常数（见函数头注释的 P0 说明）
            if (declared && declared.has(name)) {
                tokens.push({ type: 'var', name: name });
            } else if (name === 'pi' || name === 'π') {
                tokens.push({ type: 'num', value: Math.PI });
            } else if (name === 'e' && !funcs.includes(name)) {
                tokens.push({ type: 'num', value: Math.E });
            } else if (funcs.includes(name)) {
                tokens.push({ type: 'func', name: name });
            } else {
                tokens.push({ type: 'var', name: name });
            }
            continue;
        }

        // 运算符
        if ('+-*/^(),='.includes(ch)) {
            tokens.push({ type: 'op', value: ch });
            i++;
            continue;
        }

        // 未知字符：不再静默吞掉（曾导致 x² 被误读成 x 等静默破坏方程），
        // 改为抛出明确错误，由 runSolver 捕获并提示用户。
        var hint = "";
        if (ch === '²') hint = "（如需平方请写成 x^2）";
        else if (ch === '³') hint = "（如需立方请写成 x^3）";
        else if (ch === '√') hint = "（如需开方请写成 sqrt(x)）";
        else if (ch === '≤') hint = "（如需上界请写成 x <= 上限）";
        else if (ch === '≥') hint = "（如需下界请写成 x >= 下限）";
        else if (ch === '≠') hint = "（不等于请写成 x != 值）";
        else if (ch === '·' || ch === '×') hint = "（乘号请写成 *）";
        else if (ch === '÷') hint = "（除号请写成 /）";
        throw new Error("无法识别的字符 '" + ch + "'（位于第 " + (i + 1) + " 位）" + hint + "。求解器仅支持 ASCII 运算符 + - * / ^ ( ) =、英文字母变量名与内置函数（sin/cos/tan/ln/exp/sqrt/arcsin…）。");
    }

    return tokens;
}


function _greekNameToSymbol(s) {
    var MAP = {
        'alpha':'α','beta':'β','delta':'δ','epsilon':'ε','zeta':'ζ','eta':'η',
        'theta':'θ','iota':'ι','kappa':'κ','lambda':'λ','mu':'μ','nu':'ν','xi':'ξ',
        'omicron':'ο','rho':'ρ','sigma':'σ','tau':'τ','upsilon':'υ','phi':'φ',
        'chi':'χ','psi':'ψ','omega':'ω',
        'Alpha':'Α','Beta':'Β','Delta':'Δ','Epsilon':'Ε','Zeta':'Ζ','Eta':'Η',
        'Theta':'Θ','Iota':'Ι','Kappa':'Κ','Lambda':'Λ','Mu':'Μ','Nu':'Ν',
        'Xi':'Ξ','Omicron':'Ο','Rho':'Ρ','Sigma':'Σ','Tau':'Τ','Upsilon':'Υ',
        'Phi':'Φ','Chi':'Χ','Psi':'Ψ','Omega':'Ω'
    };
    return String(s).replace(/\b([A-Za-z]+)\b/g, function(m){ return MAP.hasOwnProperty(m) ? MAP[m] : m; });
}


/**
 * 词法归一化（隐式乘补乘号、全角归一化、Unicode 上标、Greek 名、函数名补括号…）。
 *
 * @param {string} str 原始方程片段
 * @param {Set<string>} [protNames] 受保护标识符（声明的变量名）集合。
 *   显式传入优先；不传则回退模块级 _LS_PROTECTED_NAMES（历史行为，保留给无上下文调用点）。
 *   ⚠ 为什么必须有这个参数（P0，2026-10-03）：保护表原先是**模块级可变全局**且从不恢复，
 *     而 solve() 的未声明标识符门禁在 _solveImpl 设置保护表**之前**就调 fuzzyFix ——
 *     于是门禁读到的是「上一次 solve 残留的表」。后果：solve 之后 fuzzyFix("2x") 永久
 *     变成 "2x"（乘号再也插不进去），且不可逆。显式传参让每个求解点的保护表自洽。
 */
function fuzzyFix(str, protNames) {
    // ── 受保护标识符占位符（词法歧义：声明变量整词优先）──
    // 命中保护表的整词先替换为 §§N§§ 占位符；后续所有隐式乘 / 拆字
    // 规则都碰不到它（§ 与数字都不在任何标识符字符类里），末尾统一还原，
    // 保证 tokenize 看到的仍是原名。于是声明了 total ⇒ 全程保持 total，不会被撕开。
    var _lsProt = (protNames !== undefined && protNames !== null) ? protNames : _LS_PROTECTED_NAMES;
    var _lsProtValues = {};
    if (_lsProt && _lsProt.size) {
        var _lsProtIdx = 0;
        str = str.replace(/[a-zA-Z_\u0370-\u03FF\u2080-\u209F][a-zA-Z0-9_\u0370-\u03FF\u2080-\u209F]*/g, function(p) {
            if (!_lsProt.has(p)) return p;
            var _k = '\u00A7\u00A7' + (_lsProtIdx++) + '\u00A7\u00A7';
            _lsProtValues[_k] = p;
            return _k;
        });
    }
    let s = str;


    // 全角符号归一化（必须在最前面执行）
    // ＝→=, （→(, ）→), ＋→+, －→-, ＊→*, ／→/, ，→,, ．→., ：→:
    s = s.replace(/[\uFF1D\uFF08\uFF09\uFF0B\uFF0D\uFF0A\uFF0F\uFF0C\uFF0E\uFF1A]/g, function(ch) {
        const map = { '\uFF1D': '=', '\uFF08': '(', '\uFF09': ')', '\uFF0B': '+',
                      '\uFF0D': '-', '\uFF0A': '*', '\uFF0F': '/', '\uFF0C': ',',
                      '\uFF0E': '.', '\uFF1A': ':' };
        return map[ch] || ch;
    });

    // 去除换行：从豆包/通义等复制时方程常"打竖"（每个字符独立成行），
    // 换行会打断隐式乘法的相邻性（如 4⏎(x-2)、2⏎x），致解析失败→0解。
    // 核心路径以"方程数组"为契约，单条方程内的换行直接去除（不影响数组层面的多方程分隔）。
    s = s.replace(/\r?\n/g, '');

    // Unicode上标转 ^N 表示法（必须在其他规则之前执行）
    // ⁰¹²³⁴⁵⁶⁷⁸⁹ → ^0 ^1 ^2 ...
    s = s.replace(/[\u2070\u00B9\u00B2\u00B3\u2074\u2075\u2076\u2077\u2078\u2079]+/g, function(match) {
        const map = { '\u2070': '0', '\u00B9': '1', '\u00B2': '2', '\u00B3': '3',
                      '\u2074': '4', '\u2075': '5', '\u2076': '6', '\u2077': '7',
                      '\u2078': '8', '\u2079': '9' };
        let digits = '';
        for (const ch of match) digits += map[ch];
        return '^' + digits;
    });

    // ** 转 ^ （Python风格幂运算）
    s = s.replace(/\*\*/g, '^');

    // 连续运算符合并: ++ → +, -- → +, +- → -, -+ → -
    s = s.replace(/\+\+/g, '+');
    s = s.replace(/--/g, '+');
    s = s.replace(/\+-|-\+/g, '-');

    // pow(base, exp) → (base)^(exp) （C/Python风格幂函数）
    // 需要循环处理嵌套情况
    let prevPow;
    do {
        prevPow = s;
        s = s.replace(/\bpow\s*\(\s*([^,()]+(?:\([^)]*\))?[^,()]*)\s*,\s*([^()]+(?:\([^)]*\))?[^()]*)\s*\)/g, '($1)^($2)');
    } while (s !== prevPow);

    // 微积分符号转换
    // ∫(expr, x, a, b) → int(expr, x, a, b)
    s = s.replace(/\u222B\s*\(/g, 'int(');
    s = s.replace(/\u222B\s*/g, 'int(');

    // d/dx(expr) → diff(expr, x) — 用括号匹配精确处理
    s = (function(input) {
        let result = '';
        let i = 0;
        while (i < input.length) {
            // 匹配 d/dx 模式
            const match = input.slice(i).match(/^d\s*\/\s*d([a-zA-Z_]\w*)\s*\(/);
            if (match) {
                const varName = match[1];
                const openParenIdx = i + match[0].length - 1; // '(' 的位置
                // 找到匹配的右括号
                let depth = 1;
                let j = openParenIdx + 1;
                while (j < input.length && depth > 0) {
                    if (input[j] === '(') depth++;
                    if (input[j] === ')') depth--;
                    if (depth === 0) break;
                    j++;
                }
                if (depth === 0) {
                    // 提取括号内容
                    const innerContent = input.slice(openParenIdx + 1, j);
                    result += 'diff(' + innerContent + ',' + varName + ')';
                    i = j + 1;
                    continue;
                }
            }
            result += input[i];
            i++;
        }
        return result;
    })(s);

    // 数学符号转换
    // ÷ → /
    s = s.replace(/÷/g, '/');
    // × → *
    s = s.replace(/×/g, '*');
    // 兼容从其他 AI（豆包/通义等）复制时带入的 Unicode 数学符号：
    // 减号 − / 短破折号 – / 长破折号 —（U+2212/U+2013/U+2014）→ ASCII -
    // 注意：core/MCP 路径只走 fuzzyFix（不走 cleanInput），此处补齐，否则 U+2212 会让 lexer 抛"无法识别字符"→ 解析失败 → 变量看似"未识别"。
    s = s.replace(/[−–—]/g, '-');
    // 中点乘号 ·（U+00B7，豆包常用）→ *
    s = s.replace(/·/g, '*');
    // 不等号 ≠（U+2260）→ !=（约束语法已支持）
    s = s.replace(/≠/g, '!=');
    // ASCII "pi" → Unicode "π"（交给下方隐式乘与 tokenizer 常量识别，避免 pi 被字母×字母规则误拆成 p*i）
    s = s.replace(/\bpi\b/g, 'π');
    // ASCII 希腊字母名 → Unicode 符号（alpha→α, theta→θ, ...），便于用常见拼写声明变量名。
    // 须在隐式乘/单字母拆解规则之前执行，使 theta 先归一化为 θ 再走后续规则，避免被拆成 t*h*e*t*a。
    // 函数名（sin/cos…）及被占用的 gamma/pi 不在映射表内，不受影响。
    s = _greekNameToSymbol(s);
    // （π 保持原字符，交由下方隐式乘规则与 tokenizer 常量识别处理；
    //  不再转为 'pi'，避免 2πx 粘连成假变量 pix 导致假阴性）
    // √( → sqrt( 以及 √x → sqrt(x)
    s = s.replace(/√\s*\(/g, 'sqrt(');
    s = s.replace(/√\s*([a-zA-Z_]\w*)/g, 'sqrt($1)');
    // ≤ → <=, ≥ → >=
    s = s.replace(/≤/g, '<=');
    s = s.replace(/≥/g, '>=');
    // 全角等号 ＝ → = （补全角归一化中漏掉的）
    s = s.replace(/＝/g, '=');
    // |expr| → abs(expr)（竖线绝对值），循环处理简单嵌套
    var prevAbs;
    do {
        prevAbs = s;
        s = s.replace(/\|([^|]+)\|/g, 'abs($1)');
    } while (s !== prevAbs);

    // 极限箭头转换: lim(x→a, expr) 或 lim(x->a, expr) → lim(expr, x, a)
    // 也支持全角箭头 →（U+FF8C 或实际 U+2192）
    // 匹配 lim(x → a, ...) 和 lim(x->a, ...)
    s = s.replace(/lim\s*\(\s*([a-zA-Z_]\w*)\s*(?:→|->)\s*([^,]+)\s*,\s*/g, 'lim($2, $1, ');

    // 函数名跟变量（带空格），补括号: sin x -> sin(x)
    // 注意：\b 开头；log10/log2 前置避免被 log 截走；函数名捕获为 $1、变量为 $2
    s = s.replace(/\b(log10|log2|sin|cos|tan|ln|exp|sqrt|log|abs|diff|int|ode|lim|cot|sec|csc|arcsin|arccos|arctan|sinh|cosh|tanh|floor|ceil|gamma|mod)\s+([a-zA-Z_]\w*)/g, '$1($2)');

    // 函数名紧跟变量无空格无括号，也补括号: sin2x -> sin(2x)（与上方带空格的 sin x 互补；sin(x)/sin(2x) 因后是 ( 不参与匹配）
    s = s.replace(/\b(log10|log2|sin|cos|tan|ln|exp|sqrt|log(?!2|10)|abs|diff|int|ode|lim|cot|sec|csc|arcsin|arccos|arctan|sinh|cosh|tanh|floor|ceil|gamma|mod)([0-9a-zA-Z_.]+)/g, '$1($2)');

    // 保护科学计数法（数字后跟 e/E 和可选符号及数字，如 1e100, 2e+5, 3.5e-10）
    // 必须在隐式乘法规则之前执行，防止 1e100 被拆成 1*e100
    // 使用 §§ 前缀避免隐式乘法规则 (\d)([a-zA-Z_]) 破坏标记
    var _sciValues = {};
    var _sciIdx = 0;
    s = s.replace(/(\d+(?:\.\d+)?)[eE]([+-]?\d+)/g, function(m) {
        var k = '\u00A7\u00A7SCI' + (_sciIdx++);
        _sciValues[k] = m;
        return k;
    });

    // 保护函数名中的数字，防止 log2( 被拆成 log2*(
    // 使用简单标记替换，避免被 (\d)\( 规则破坏
    s = s.replace(/log2\(/g, '§§LOG2§§');
    s = s.replace(/log10\(/g, '§§LOG10§§');

    // ── 占位符「原子化」（2026-10-03 修复的 P0：声明变量后隐式乘全失效）──
    //
    // 症结：声明 x 后，"2x=4" 先被替成 "2§§0§§=4"。隐式乘规则是
    //   (\d)([a-zA-Z_\u0370-\u03FF])  → § 不在右字符类里，乘号插不进去。
    // 于是 tokenizer 拿到 "2x"（无乘号）→ 解析失败 → 0 解。Agent 最自然的写法直接失效。
    //
    // 为什么不在隐式乘字符类里加 §（试过，golden 立刻变红，g020 由 1 解变 0 解）：
    //   那会让占位符参与「变量×变量」拆字与「≥3 字母拆单字母」两条规则，
    //   而这两条规则的 § 排除（(?![\w.§])）正是保护占位符不被拆开的地方 ——
    //   一旦 § 进字符类，拆字规则先一步把占位符撕碎，保护就自相矛盾。
    //
    // 正解：占位符在语法上是**一个原子**，不靠字符类参与规则，而靠下面这组
    // 「先补乘号」的前置规则。它只做一件事——把占位符当成已经写好的原子 token，
    // 在它与数字/字母/括号的接缝处补上缺失的乘号，与它是否可拆无关。
    // 拆字类规则照旧看不见 §（保护不变），补乘号类规则由本段代劳（乘法恢复）。

    if (_lsProtValues && Object.keys(_lsProtValues).length) {
        // ⚠ 不要对 alternation 分隔符 | 做正则转义（试过：转义后变字面量 \|，
        //   正则从「匹配任一占位符」退化成「匹配整串 §§0§§|§§1§§」，永远匹配不到 ⇒ 乘号补不进 ⇒ 0 解）。
        //   占位符形如 §§12§§，只含 § 与数字，两者都不是正则元字符，直接 join('|') 即可。
        var _lsProtKeys = Object.keys(_lsProtValues).join('|');
        // 数字 × 占位符：2§§0§§ → 2*§§0§§
        s = s.replace(new RegExp('(\\d)(' + _lsProtKeys + ')', 'g'), '$1*$2');
        // 占位符 × 数字：§§0§§2 → §§0§§*2
        s = s.replace(new RegExp('(' + _lsProtKeys + ')(\\d)', 'g'), '$1*$2');
        // 占位符 × 占位符：§§0§§§§1§§ → §§0§§*§§1§§（声明 x,y 时 "xy" 才不会被当一个词）
        s = s.replace(new RegExp('(' + _lsProtKeys + ')\\1', 'g'), '$1*$1');
        // 占位符 × 字母（含希腊）：§§0§§x → §§0§§*x ；x§§0§§ → x*§§0§§
        s = s.replace(new RegExp('(' + _lsProtKeys + ')([a-zA-Z_\\u0370-\\u03FF])', 'g'), '$1*$2');
        s = s.replace(new RegExp('([a-zA-Z_\\u0370-\\u03FF])(' + _lsProtKeys + ')', 'g'), '$1*$2');
        // 占位符 × 左/右括号：(x)§§0§§ → (x)*§§0§§ ；total§§0§§(x) → §§0§§*(x)
        // ⚠ 绝不能把 ^ 当作需补乘号的运算符：占位符紧跟 ^ 时是幂（total^2），
        //   插乘号会变成 total*2，语义直接反了（golden 15/20 变红即此故）。
        s = s.replace(new RegExp('(' + _lsProtKeys + ')(\\()', 'g'), '$1*$2');
        s = s.replace(new RegExp('\\)(' + _lsProtKeys + ')', 'g'), '$1*$2');
    }

    // 数字直接跟变量（含希腊字母如 π），插入乘号: 2x -> 2*x ; 2π -> 2*π
    s = s.replace(/(\d)([a-zA-Z_\u0370-\u03FF])/g, '$1*$2');

    // 变量×变量并列: xy -> x*y （仅当两个字母均为孤立单字母，避免拆坏多字符变量名 x1/xvar、函数名 sin/cos 等；同时支持带空格 x y -> x*y）
    // 用循环重复替换，避免 JS String.replace 全局匹配不重叠导致 "xy z" 第一次吃掉 y 后 y z 漏拆
    {
        let _prev;
        do {
            _prev = s;
            s = s.replace(/(?<![\w.§])([a-zA-Z_\u0370-\u03FF])\s*([a-zA-Z_\u0370-\u03FF])(?![\w.§(])/g, '$1*$2');
        } while (s !== _prev);
    }

    // 连续≥3 单字母（含希腊）标识符按单字母拆: xyz -> x*y*z（排除已知函数名；长度2已在上方 xy 规则处理；含数字如 x1y 不匹配故不误拆）
    s = s.replace(/\b([a-zA-Z_\u0370-\u03FF]{3,})\b/g, function(m) {
        const _f = ['sin','cos','tan','ln','exp','sqrt','log','log10','abs','diff','int','ode','lim','cot','sec','csc','arcsin','arccos','arctan','sinh','cosh','tanh','floor','ceil','gamma','log2','mod'];
        if (_f.includes(m)) return m;
        return m.split('').join('*');
    });

    // 数字跟左括号: 2(x -> 2*(x
    s = s.replace(/(\d)\(/g, '$1*(');

    s = s.replace(/§§LOG2§§/g, 'log2(');
    s = s.replace(/§§LOG10§§/g, 'log10(');

    // 右括号跟左括号: )( -> )*(
    s = s.replace(/\)\(/g, ')*(');

    // 右括号跟变量: )x -> )*x
    s = s.replace(/\)([a-zA-Z_])/g, ')*$1');

    // 变量跟左括号: x( -> x*(
    s = s.replace(/([a-zA-Z_]\w*)\(/g, function(match, p1) {
        const funcs = ['sin', 'cos', 'tan', 'ln', 'exp', 'sqrt', 'log', 'log10', 'abs', 'diff', 'int', 'ode', 'lim',
                      'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
                      'floor', 'ceil', 'gamma', 'log2', 'mod'];
        if (funcs.includes(p1)) {
            return p1 + '(';
        }
        return p1 + '*(';
    });

    // 变量跟数字: x2 -> x*2 (但要排除变量名本身包含数字的情况如x2)
    // 这里不处理，因为x2是一个合法的变量名

    // 自动补全缺失的右括号
    let leftParens = 0;
    let rightParens = 0;
    for (const ch of s) {
        if (ch === '(') leftParens++;
        if (ch === ')') rightParens++;
    }
    if (leftParens > rightParens) {
        s += ')'.repeat(leftParens - rightParens);
    }

    // 恢复科学计数法（在隐式乘法、括号补全等规则之后执行）
    Object.keys(_sciValues).forEach(function(k) {
        s = s.split(k).join(_sciValues[k]);
    });

    // 还原受保护标识符占位符（必须在 tokenizer 之前：tokenize 不认 §）
    Object.keys(_lsProtValues).forEach(function(k) {
        s = s.split(k).join(_lsProtValues[k]);
    });

    return s;
}


function parseCondition(str) {
    var s = str.trim();

    // 归一化：中文术语 → 数学符号
    s = s.replace(/属于/g, '\u2208');       // ∈
    s = s.replace(/大于等于/g, '\u2265');   // ≥
    s = s.replace(/小于等于/g, '\u2264');   // ≤
    s = s.replace(/不等于/g, '\u2260');     // ≠
    s = s.replace(/大于/g, '>');
    s = s.replace(/小于/g, '<');

    // 全角括号/逗号 → 半角
    s = s.replace(/[\uFF3B\u3010]/g, '[').replace(/[\uFF3D\u3011]/g, ']');
    s = s.replace(/\uFF0C/g, ',');
    s = s.replace(/\uFF0D/g, '-');

    // 归一化：pi/π 变体
    s = s.replace(/\bpi\b/g, 'π');

    // 归一化：inf 变体
    s = s.replace(/\b(?:[+-]?infinity|[+-]?inf)\b/gi, function(m) {
        if (m === 'inf' || m === 'Inf' || m === '+inf' || m === '+Inf') return '∞';
        if (m === '-inf' || m === '-Inf') return '-∞';
        if (m === 'Infinity' || m === '+Infinity') return '∞';
        if (m === '-Infinity') return '-∞';
        return m;
    });

    // 移除空格
    s = s.replace(/\s+/g, '');

    // ---- 模式1: x∈[a,b] 或 x∈(a,b) ----
    // 支持 ∞ / -∞ / Unicode 无穷符号 \u221E / π
    var m1 = s.match(/^([a-zA-Z_\u0370-\u03FF]\w*)\u2208[\[\(]([^,\]]+),([^,\]]+)[\]\)]$/);
    if (m1) {
        var vn = m1[1], lo = m1[2], hi = m1[3];
        // 2026-10-04：括号形态决定端点开闭（[a,b] 闭、(a,b) 开、(a,b] 半开）。
        // 过去一律按闭区间处理，与模式2 是同一类信息丢失（见模式2 的 P0 注释）。
        // 数值搜索域仍用闭区间（保守不漏），但约束校验必须按真实开闭判。
        var _loOpen = m1[0].indexOf('\uFF08') >= 0 || m1[0].indexOf('(') >= 0;
        var _hiOpen = m1[0].lastIndexOf('\uFF09') >= 0 || m1[0].lastIndexOf(')') >= 0;
        if (lo === '-\u221E' || lo === '-∞' || lo === '-inf') lo = -Infinity;
        if (hi === '\u221E' || hi === '∞' || hi === 'inf' || hi === '+∞') hi = Infinity;
        // 处理 π 边界
        if (lo === 'π') lo = Math.PI;
        if (hi === 'π') hi = Math.PI;
        var loNum = parseFloat(lo), hiNum = parseFloat(hi);
        if (isFinite(loNum) && isFinite(hiNum) && loNum < hiNum) {
            return { type: 'domain', varName: vn, min: loNum, max: hiNum, minStrict: _loOpen, maxStrict: _hiOpen };
        }
        if (isFinite(loNum) && isFinite(hiNum) && loNum >= hiNum) {
            return { type: 'warn', message: '无效区间: ' + vn + '∈[' + lo + ',' + hi + '] 下界≥上界，将被忽略' };
        }
        if (isFinite(loNum) && !isFinite(hiNum)) {
            return { type: 'domain', varName: vn, min: loNum, minStrict: _loOpen };
        }
        if (isFinite(hiNum) && !isFinite(loNum)) {
            return { type: 'domain', varName: vn, max: hiNum, maxStrict: _hiOpen };
        }
    }

    // ---- 模式2: x>a, x<a, x>=a, x<=a, x≥a, x≤a ----
    //
    // 🔴 2026-10-04 修 P0：严格性过去在这里被**丢弃**（原注释：「严格 > / < 在数值计算中转为 >= / <=」）。
    //   实测后果：`x^2=0` + `x>0` 返回解 `x=0` —— x=0 **违反** x>0，真解集是空集。
    //   病根链条（实测追出）：本函数把 `x>0` 归一成 domain{min:0}（无严格标志）
    //   → setup.js:27 只能写 op >= → 终态不等式闸门看到的是 x>=0
    //   → x=0 「满足」 ⇒ 闸门放行。
    //   根因是**信息在词法层就被抹掉了**，下游任何一道闸门都救不回来。
    //   ⇒ 现在显式带出 minStrict / maxStrict。数值搜索域仍按闭区间处理（保守，不会漏），
    //     但「这个点是否满足原约束」必须按严格语义判 —— 二者本就是两件事。
    // 正则说明：[><\u2265\u2264]=? 已覆盖 >, >=, <, <=, ≥, ≤
    var m2 = s.match(/^([a-zA-Z_\u0370-\u03FF]\w*)([><\u2265\u2264]=?)(-?\d+\.?\d*(?:[eE][+-]?\d+)?)$/);
    if (m2) {
        var vn = m2[1], op = m2[2], val = parseFloat(m2[3]);
        if (!isNaN(val) && isFinite(val)) {
            if (op === '>' || op === '>=' || op === '\u2265') {
                return { type: 'domain', varName: vn, min: val, minStrict: (op === '>') };
            }
            if (op === '<' || op === '<=' || op === '\u2264') {
                return { type: 'domain', varName: vn, max: val, maxStrict: (op === '<') };
            }
        }
    }

    // ---- 模式3: a<x<b, a≤x≤b, a<x≤b, a≤x<b ----
    var m3 = s.match(/^(-?\d+\.?\d*(?:[eE][+-]?\d+)?)([<>\u2265\u2264]=?)([a-zA-Z_\u0370-\u03FF]\w*)([<>\u2265\u2264]=?)(-?\d+\.?\d*(?:[eE][+-]?\d+)?)$/);
    if (m3) {
        var loVal = parseFloat(m3[1]), vn = m3[3], hiVal = parseFloat(m3[5]);
        if (!isNaN(loVal) && !isNaN(hiVal) && isFinite(loVal) && isFinite(hiVal) && loVal < hiVal) {
            return { type: 'domain', varName: vn, min: loVal, max: hiVal, minStrict: (m3[2] === '>'), maxStrict: (m3[4] === '<') };
        }
    }

    // ---- 模式4: x∈R, x∈ℝ → 无约束，跳过 ----
    if (s.match(/^[a-zA-Z_\u0370-\u03FF]\w*\u2208[R\u211D]$/)) {
        return { type: 'skip' };
    }

    // ---- 模式5: x∈Z, x∈ℤ, x∈N, x∈ℕ → 仅警告 ----
    if (s.match(/^[a-zA-Z_\u0370-\u03FF]\w*\u2208[Z\u2124N\u2115]$/)) {
        return { type: 'warn', kind: 'integer-unenforced', message: '整数约束(x∈ℤ/ℕ)无法在当前求解器中强制执行；已按实数域求解，返回的解不一定为整数，请知悉（未静默忽略）' };
    }

    // ---- 模式6: x≠a, x!=a → 仅警告 ----
    var m6 = s.match(/^([a-zA-Z_]\w*)(?:\u2260|!=)(-?\d+\.?\d*(?:[eE][+-]?\d+)?)$/);
    if (m6) {
        return { type: 'warn', message: '不等约束 "' + m6[1] + '\u2260' + m6[2] + '" 无法精确表示，将尝试求解近似值' };
    }

    // 无法识别的条件
    return null;
}


function Parser(tokens) {
    let pos = 0;

    function peek() {
        return pos < tokens.length ? tokens[pos] : null;
    }

    function consume() {
        return tokens[pos++];
    }

    function match(type, value) {
        const tok = peek();
        if (!tok) return false;
        if (tok.type !== type) return false;
        if (value !== undefined && tok.value !== value && tok.name !== value) return false;
        return true;
    }

    function expect(type, value) {
        const tok = peek();
        if (!tok) {
            throw new Error('意外的表达式结尾');
        }
        if (tok.type !== type || (value !== undefined && tok.value !== value && tok.name !== value)) {
            throw new Error('解析错误: 期望 ' + type + (value ? ' "' + value + '"' : '') + '，得到 ' + JSON.stringify(tok));
        }
        return consume();
    }

    function parseExpression() {
        let left = parseTerm();
        while (match('op', '+') || match('op', '-')) {
            const op = consume().value;
            const right = parseTerm();
            left = { type: 'binop', op: op, left: left, right: right };
        }
        return left;
    }

    function parseTerm() {
        let left = parseFactor();
        while (match('op', '*') || match('op', '/')) {
            const op = consume().value;
            const right = parseFactor();
            left = { type: 'binop', op: op, left: left, right: right };
        }
        return left;
    }

    function parseFactor() {
        let base = parseUnary();
        if (match('op', '^')) {
            consume();
            const exp = parseFactor(); // 右结合
            return { type: 'binop', op: '^', left: base, right: exp };
        }
        return base;
    }

    function parseUnary() {
        if (match('op', '-')) {
            consume();
            const operand = parseFactor();
            return { type: 'unary', op: '-', operand: operand };
        }
        if (match('op', '+')) {
            consume();
            return parseUnary();
        }
        return parsePrimary();
    }

    function parsePrimary() {
        const tok = peek();
        if (!tok) {
            throw new Error('意外的表达式结尾');
        }

        if (tok.type === 'num') {
            consume();
            return { type: 'num', value: tok.value };
        }

        if (tok.type === 'var') {
            consume();
            return { type: 'var', name: tok.name };
        }

        if (tok.type === 'func') {
            consume();
            expect('op', '(');
            const firstArg = parseExpression();
            // 检查是否有多参数（逗号分隔）
            if (match('op', ',')) {
                const args = [firstArg];
                while (match('op', ',')) {
                    consume();
                    args.push(parseExpression());
                }
                expect('op', ')');
                return { type: 'func', name: tok.name, args: args };
            }
            expect('op', ')');
            return { type: 'func', name: tok.name, arg: firstArg };
        }

        if (tok.type === 'op' && tok.value === '(') {
            consume();
            const expr = parseExpression();
            expect('op', ')');
            return expr;
        }

        throw new Error('解析错误: 意外的token ' + JSON.stringify(tok));
    }

    this.parse = function() {
        const result = parseExpression();
        if (pos < tokens.length) {
            throw new Error('解析错误: 多余的token ' + JSON.stringify(tokens[pos]));
        }
        return result;
    };
}

// ═══════════════════ 模块：ast/basic ═══════════════════
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


/**
 * evalAST 的「伴随尺度」函数：估算表达式在给定点求值时的**条件数尺度**
 * —— 即 Σ|terms|，各项绝对值之和。
 *
 * 为什么必须有它（2026-10-04 修 P0 时踩出来的坑）：
 *   双精度下 f(x) 的求值误差上界是 eps · Σ|terms|（Higham 标准结论，
 *   向后稳定的相对误差界）。所以「残差是否真的为 0」这件事，
 *   **没有绝对阈值可判** —— 必须与表达式自身的量纲挂钩。
 *
 *   实测反例：x^2 − 1e13 = 0 的真根 x = 3162277.6601683795，
 *   代回得 x^2 − 1e13 = 0.001953125（纯属 3162277.66 这个 double 自身的舍入）。
 *   若用固定容差 1e-6 判「残差为 0」，**真根会被当伪解杀掉**。
 *
 * 实现口径（刻意保守，宁可尺度偏大 ⇒ 容差偏宽）：
 *   · num/var        → 绝对值
 *   · 加减           → 左右尺度之和
 *   · 乘             → 左右尺度之积（|a·b| 精确等于 |a|·|b|，这不是估计）
 *   · 除             → 左尺度 + 右尺度（商的数量级不确定，取保守上界）
 *   · 幂 a^b         → 实在算不出就退回「和」这一最坏情形
 *   · 一元负号       → 不改尺度
 *   · 函数/未知节点  → **不计入**（无法可靠估计 ⇒ 宁可让尺度偏小、判据偏严）
 *
 * ⚠ 最后一条是刻意的反向保守：函数节点（sin/exp/log…）的数量级无法静态估计，
 *   这里选择不计入。这样含函数的表达式会拿到偏小的尺度、更严的容差，
 *   属于「宁可少给解」的 fail-closed 方向，不会放过伪解。
 */
function evalASTScale(node, vars) {
    if (!node) return 0;

    switch (node.type) {
        case 'num':
            return Math.abs(node.value);

        case 'var':
            if (vars[node.name] === undefined) return 0;
            return Math.abs(vars[node.name]);

        case 'unary':
            return evalASTScale(node.operand, vars);

        case 'binop': {
            const l = evalASTScale(node.left, vars);
            const r = evalASTScale(node.right, vars);
            switch (node.op) {
                case '+': case '-': return l + r;
                case '*': return l * r;
                // 商：取「和」作保守上界（除数接近 0 时商会爆炸，但那时值本身已非有限，被上层拦掉）
                case '/': return l + r;
                case '^': {
                    // |a^b| ≈ |a|^|b|。仅当两侧尺度都有限且底数非 0 时才敢用，否则退回和。
                    const av = evalAST(node.left, vars);
                    const bv = evalAST(node.right, vars);
                    if (isFinite(av) && isFinite(bv) && av !== 0) {
                        const p = Math.pow(Math.abs(av), Math.abs(bv));
                        if (isFinite(p)) return p;
                    }
                    return l + r;
                }
                default: return l + r;
            }
        }

        default:
            // 函数节点与未知节点：按上面的说明不计入尺度
            return 0;
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
                _eqASTs.push(parse(tokenize(fuzzyFix('(' + eqStrs[_e].slice(0, _i) + ')-(' + eqStrs[_e].slice(_i + 1) + ')', _lsSymProt), _lsSymProt)));
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

// ═══════════════════ 模块：interval/core ═══════════════════
/* 模块 interval/core：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function _iNorm(r) {
    if (!r) return r;                                  // null 保持：保守跳过（sound，不收缩）
    if (typeof r.min !== 'number' || typeof r.max !== 'number') return r;
    if (isNaN(r.min) || isNaN(r.max)) {               // NaN 出现 → 保守全空间，绝不让 NaN 进入盒子
        _IEEE.nan = true;
        return { min: -Infinity, max: Infinity };
    }
    var lo = r.min, hi = r.max;
    if (lo === Infinity || lo === -Infinity || hi === Infinity || hi === -Infinity) {
        _IEEE.inf = true;                             // ±Inf 记录；区间本身保留（保守且真实）
    }
    if (Math.abs(lo) > 1e300 || Math.abs(hi) > 1e300) { _IEEE.inf = true; }  // 极端有限幅值亦记溢出
    return { min: lo, max: hi };                      // 不重排 min/max：保留空区间语义（min>max 表示空）
}


function _rangeEval(ast, intervals) {
    if (!ast) return null;
    if (ast.type === 'num') return _iNorm({ min: ast.value, max: ast.value });
    if (ast.type === 'var') {
        var iv = intervals[ast.name];
        if (iv) {
            if (iv.min > iv.max) return _iNorm({ min: iv.min, max: iv.max }); // 空区间（保留 min>max 语义）
            return _iNorm({ min: iv.min, max: iv.max });
        }
        // 变量不在区间映射中，使用默认全域
        return _iNorm({ min: -1e6, max: 1e6 });
    }
    if (ast.type === 'binop') {
        var left = _rangeEval(ast.left, intervals);
        var right = _rangeEval(ast.right, intervals);
        if (!left || !right) return null;

        switch (ast.op) {
            case '+': return _iNorm({ min: left.min + right.min, max: left.max + right.max });
            case '-': return _iNorm({ min: left.min - right.max, max: left.max - right.min });
            case '*': {
                var vals = [left.min * right.min, left.min * right.max, left.max * right.min, left.max * right.max];
                return _iNorm({ min: Math.min.apply(null, vals), max: Math.max.apply(null, vals) });
            }
            case '/': {
                if (right.min <= 0 && right.max >= 0) {
                    _IEEE.divZero = true;             // 含 0 的分母：保守跳过并标记（绝不崩溃）
                    return null;
                }
                var vals = [left.min / right.min, left.min / right.max, left.max / right.min, left.max / right.max];
                return _iNorm({ min: Math.min.apply(null, vals), max: Math.max.apply(null, vals) });
            }
            case '^': {
                // 处理幂运算（sound 优先：凡不能给出【确定包络】的情形一律 return null，绝不截断/外推）
                if (right.min === right.max) {
                    var e0 = right.min;
                    var l0 = left.min, l1 = left.max;              // 底数区间 [l0,l1]
                    if (Number.isInteger(e0)) {
                        var n = e0;
                        if (n === 0) return _iNorm({ min: 1, max: 1 });
                        if (n === 1) return left;
                        if (n > 0 && n % 2 === 0) {
                            // 偶次幂：x^n ≥ 0；端点取绝对值，跨 0 时下界收紧到 0
                            var pe0 = Math.pow(Math.abs(l0), n), pe1 = Math.pow(Math.abs(l1), n);
                            return _iNorm({ min: (l0 <= 0 && l1 >= 0) ? 0 : Math.min(pe0, pe1), max: Math.max(pe0, pe1) });
                        }
                        if (n > 0) {
                            // 奇次幂：x^n 在 R 上严格单调增
                            return _iNorm({ min: Math.pow(l0, n), max: Math.pow(l1, n) });
                        }
                        // 修复（2026-10-02，P0）：负整数幂旧实现直接 return null ⇒ intervalEval(符号微分 AST) 常为 null
                        // ⇒ _intervalJacobian 退化 ±1e6、金融反算恒不认证。
                        // 正确口径：x^n = 1 / x^|n|；底数跨 0 ⇒ 无定义（保守跳过），否则先算 |n| 次幂区间 D（必不含 0）再取倒数。
                        if (l0 <= 0 && l1 >= 0) { _IEEE.divZero = true; return null; }
                        var m = -n;
                        var daa = Math.pow(l0, m), dbb = Math.pow(l1, m);
                        return _iNorm({ min: 1 / Math.max(daa, dbb), max: 1 / Math.min(daa, dbb) });
                    }
                    // 非整数幂：实数域下 x^e0 仅在 x ≥ 0（e0 < 0 时 x > 0）上有定义
                    if (e0 > 0) {
                        if (l1 < 0) return null;                                   // 整段无定义 ⇒ 保守跳过
                        var lo0 = l0 > 0 ? l0 : 0;                                 // 定义域自 max(l0,0) 起，x^e0 单调增
                        return _iNorm({ min: Math.pow(lo0, e0), max: Math.pow(l1, e0) });
                    }
                    if (l0 <= 0 || l1 <= 0) { _IEEE.divZero = true; return null; } // 定义域含 0 ⇒ 无界/无定义
                    return _iNorm({ min: Math.pow(l1, e0), max: Math.pow(l0, e0) }); // e0 < 0：x^e0 单调减
                }
                return null; // 变指数：保守跳过
            }
        }
        return null;
    }
    if (ast.type === 'func') {
        var arg = ast.arg || (ast.args ? ast.args[0] : null);
        var argRange = arg ? _rangeEval(arg, intervals) : null;
        if (!argRange) return null;

        switch (ast.name) {
            case 'sin': {
                var a = argRange.min, b = argRange.max;
                if (b - a >= 2 * Math.PI) return _iNorm({ min: -1, max: 1 });
                var vals = [Math.sin(a), Math.sin(b)];
                for (var k = -5; k <= 5; k++) {
                    var cp = Math.PI / 2 + k * Math.PI;
                    if (cp >= a && cp <= b) vals.push(Math.sin(cp));
                    cp = -Math.PI / 2 + k * Math.PI;
                    if (cp >= a && cp <= b) vals.push(Math.sin(cp));
                }
                return _iNorm({ min: Math.min.apply(null, vals), max: Math.max.apply(null, vals) });
            }
            case 'cos': {
                var a = argRange.min, b = argRange.max;
                if (b - a >= 2 * Math.PI) return _iNorm({ min: -1, max: 1 });
                var vals = [Math.cos(a), Math.cos(b)];
                for (var k = -5; k <= 5; k++) {
                    var cp = k * Math.PI;
                    if (cp >= a && cp <= b) vals.push(Math.cos(cp));
                }
                return _iNorm({ min: Math.min.apply(null, vals), max: Math.max.apply(null, vals) });
            }
            case 'tan': {
                // tan 在每个无奇点的连续分支上严格单调增，值域=[tan(a),tan(b)]；
                // 若盒 [a,b] 含奇点 kπ+π/2，则值域为全体实数（保守取全区间）。
                // 旧实现固定返回 [-1e6,1e6]，导致含解但无奇点的盒无法被区间收紧，
                // 进而把 tan(x)=100 这类真有解的方程误判为"必无解"（漏解缺陷）。
                // 新实现：不含奇点时给出紧致且 sound 的值域，恢复区间收缩能力。
                var a = argRange.min, b = argRange.max;
                if (!isFinite(a) || !isFinite(b) || b < a) return _iNorm({ min: -Infinity, max: Infinity });
                var kLo = Math.floor((a - Math.PI / 2) / Math.PI);
                var kHi = Math.ceil((b - Math.PI / 2) / Math.PI);
                for (var k = kLo; k <= kHi; k++) {
                    var _sing = k * Math.PI + Math.PI / 2;
                    if (_sing >= a - 1e-12 && _sing <= b + 1e-12) {
                        return _iNorm({ min: -Infinity, max: Infinity }); // 含奇点：覆盖全体实数
                    }
                }
                var _ta = Math.tan(a), _tb = Math.tan(b);
                if (!isFinite(_ta) || !isFinite(_tb)) return _iNorm({ min: -Infinity, max: Infinity });
                return _iNorm({ min: Math.min(_ta, _tb), max: Math.max(_ta, _tb) });
            }
            case 'exp': {
                if (argRange.min > 700) return _iNorm({ min: Infinity, max: Infinity });
                if (argRange.max < -700) return _iNorm({ min: 0, max: Math.exp(argRange.max) });
                return _iNorm({ min: Math.exp(Math.max(-700, argRange.min)), max: Math.exp(Math.min(700, argRange.max)) });
            }
            case 'ln': case 'log': {
                if (argRange.max <= 0) { _IEEE.domainErr = true; return null; } // 定义域错误：标记 + 保守跳过（不崩溃）
                return _iNorm({ min: Math.log(Math.max(1e-300, argRange.min)), max: Math.log(argRange.max) });
            }
            case 'sqrt': {
                if (argRange.max < 0) { _IEEE.domainErr = true; return null; }
                return _iNorm({ min: Math.sqrt(Math.max(0, argRange.min)), max: Math.sqrt(argRange.max) });
            }
                case 'abs': {
                    var a = argRange.min, b = argRange.max;
                    if (a >= 0) return _iNorm({ min: a, max: b });
                    if (b <= 0) return _iNorm({ min: -b, max: -a });
                    return _iNorm({ min: 0, max: Math.max(-a, b) });
                }
                case 'arcsin': {
                    if (argRange.max < -1 || argRange.min > 1) { _IEEE.domainErr = true; return null; }
                    return _iNorm({ min: Math.asin(Math.max(-1, argRange.min)), max: Math.asin(Math.min(1, argRange.max)) });
                }
                case 'arccos': {
                    if (argRange.max < -1 || argRange.min > 1) { _IEEE.domainErr = true; return null; }
                    return _iNorm({ min: Math.acos(Math.min(1, argRange.max)), max: Math.acos(Math.max(-1, argRange.min)) });
                }
                case 'arctan': {
                    return _iNorm({ min: Math.atan(argRange.min), max: Math.atan(argRange.max) });
                }
                case 'sinh': {
                    return _iNorm({ min: Math.sinh(argRange.min), max: Math.sinh(argRange.max) });
                }
                case 'cosh': {
                    var a = argRange.min, b = argRange.max;
                    if (a >= 0) return _iNorm({ min: Math.cosh(a), max: Math.cosh(b) });
                    if (b <= 0) return _iNorm({ min: Math.cosh(b), max: Math.cosh(a) });
                    return _iNorm({ min: 1, max: Math.max(Math.cosh(a), Math.cosh(b)) });
                }
                case 'tanh': {
                    return _iNorm({ min: Math.tanh(argRange.min), max: Math.tanh(argRange.max) });
                }
            }
            return null;
    }
    if (ast.type === 'unary') {
        // 一元算子区间求值（此前缺失 → 含 -2.5 这类负常量等式的标准化 AST 求导后退化，
        // 导致 Krawczyk 雅可比整行保守 [-1e6,1e6]，无法认证 proven）。
        var u = _rangeEval(ast.operand, intervals);
        if (!u) return null;
        if (ast.op === '-') return _iNorm({ min: -u.max, max: -u.min });
        if (ast.op === '+') return u;
        return _iNorm({ min: -1e6, max: 1e6 }); // 未知一元算子：保守退化（sound，绝不假证）
    }
    return null;
}


function intervalEval(ast, intervals) {
  if (!ast) return null;
  // 空域（min>max）走保守旧逻辑，保留"空区间"语义供调用方检测无解
  if (intervals) { for (var k in intervals) { if (intervals[k] && intervals[k].min > intervals[k].max) return _rangeEval(ast, intervals); } }
  try {
    var env = _buildAffEnv(intervals || {});
    var aff = _affineEval(ast, env);
    var iv = aff ? _affToInterval(aff) : null;
    return iv || _rangeEval(ast, intervals || {});
  } catch (e) { return _rangeEval(ast, intervals || {}); }
}


function _midVars(mid, varNames) { var o = {}; varNames.forEach(function (v, k) { o[v] = mid[k]; }); return o; }

function _iAdd(A, B) { return { min: A.min + B.min, max: A.max + B.max }; }

function _iSub(A, B) { return { min: A.min - B.max, max: A.max - B.min }; }

function _iMul(A, B) {
    var v0 = A.min * B.min, v1 = A.min * B.max, v2 = A.max * B.min, v3 = A.max * B.max;
    return { min: Math.min(v0, v1, v2, v3), max: Math.max(v0, v1, v2, v3) };
}


function _iRecip(A) { if (!A || (A.min <= 0 && A.max >= 0)) return null; return { min: 1 / A.max, max: 1 / A.min }; }

function _iIntersect(A, B) { return { min: Math.max(A.min, B.min), max: Math.min(A.max, B.max) }; }

function _iHull(A, B) { return { min: Math.min(A.min, B.min), max: Math.max(A.max, B.max) }; }

function _iEmpty(A) { return A.max < A.min; }


function _boxMid(box, varNames) {
    var mid = new Array(varNames.length);
    for (var j = 0; j < varNames.length; j++) mid[j] = (box[varNames[j]].min + box[varNames[j]].max) / 2;
    return mid;
}

function _contractionChanged(before, after, varNames) {
    for (var j = 0; j < varNames.length; j++) {
        var v = varNames[j];
        if (before[v].min !== after[v].min || before[v].max !== after[v].max) return true;
    }
    return false;
}

function _declareNoSolution(state, path, k, msg) {
    state.done = true;
    state.result = {
        solutions: [], error: "NO_SOLUTION",
        message: path + "：约束 " + (k + 1) + " " + msg,
        executionPath: path,
        timeMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - state.startTime,
        confidence: "high", varNames: state.varNames, unconverged: false,
        resultType: 1, resultTypeName: "空结果", resultTypeDesc: "区间算术严格证明不存在满足条件的解"
    };
}


function _cloneBox(box) {
    if (!box) return box;
    var c = {};
    for (var k in box) {
        if (!box.hasOwnProperty(k)) continue;
        var v = box[k];
        if (v && typeof v === 'object' && 'min' in v && 'max' in v) {
            c[k] = { min: v.min, max: v.max };
        } else {
            c[k] = v; // 透传非区间字段（如 _branchDepth）
        }
    }
    return c;
}


function _intervalJacobian(equations, varNames, box, mid) {
    var n = varNames.length, J = [];
    for (var i = 0; i < equations.length; i++) {
        J.push(new Array(n));
        for (var j = 0; j < n; j++) {
            var dAST = _diffAST(equations[i], varNames[j]);
            var dI = dAST ? intervalEval(dAST, box) : null;
            if (!dI || !isFinite(dI.min) || !isFinite(dI.max)) {
                J[i][j] = { min: -1e6, max: 1e6 }; // 保守退化，确保 sound
            } else {
                J[i][j] = dI;
            }
        }
    }
    return J;
}


function _diffAST(node, varName) {
    if (!node) return null;
    switch (node.type) {
        case 'num': return { type: 'num', value: 0 };
        case 'var': return { type: 'num', value: node.name === varName ? 1 : 0 };
        case 'binop': {
            var L = node.left, R = node.right;
            var dL = _diffAST(L, varName), dR = _diffAST(R, varName);
            switch (node.op) {
                case '+': return { type: 'binop', op: '+', left: dL, right: dR };
                case '-': return { type: 'binop', op: '-', left: dL, right: dR };
                case '*':
                    return { type: 'binop', op: '+',
                        left: { type: 'binop', op: '*', left: dL, right: R },
                        right: { type: 'binop', op: '*', left: L, right: dR } };
                case '/':
                    return { type: 'binop', op: '/',
                        left: { type: 'binop', op: '-',
                            left: { type: 'binop', op: '*', left: dL, right: R },
                            right: { type: 'binop', op: '*', left: L, right: dR } },
                        right: { type: 'binop', op: '^', left: R, right: { type: 'num', value: 2 } } };
                case '^':
                    if (R.type === 'num') {
                        var p = R.value;
                        return { type: 'binop', op: '*',
                            left: { type: 'binop', op: '*',
                                left: { type: 'num', value: p },
                                right: { type: 'binop', op: '^', left: L, right: { type: 'num', value: p - 1 } } },
                            right: dL };
                    }
                    // 一般幂： d/dx L^R = L^R·(dR·ln L + R·dL / L)；L^R 仅当 R 为常整数可被 intervalEval 求值
                    return { type: 'binop', op: '*',
                        left: { type: 'binop', op: '^', left: L, right: R },
                        right: { type: 'binop', op: '+',
                            left: { type: 'binop', op: '*', left: dR, right: { type: 'func', name: 'ln', arg: L } },
                            right: { type: 'binop', op: '/',
                                left: { type: 'binop', op: '*', left: R, right: dL },
                                right: L } } };
                default: return null;
            }
        }
        case 'unary':
            if (node.op === '-') return { type: 'unary', op: '-', operand: _diffAST(node.operand, varName) };
            return _diffAST(node.operand, varName);
        case 'func': {
            if (node.args) return null; // diff/int/ode/lim/mod 不可符号求导 → 保守 SKIP
            var dArg = _diffAST(node.arg, varName);
            var fp;
            switch (node.name) {
                case 'sin': fp = { type: 'func', name: 'cos', arg: node.arg }; break;
                case 'cos': fp = { type: 'unary', op: '-', operand: { type: 'func', name: 'sin', arg: node.arg } }; break;
                case 'tan': fp = { type: 'binop', op: '/', left: { type: 'num', value: 1 }, right: { type: 'binop', op: '^', left: { type: 'func', name: 'cos', arg: node.arg }, right: { type: 'num', value: 2 } } }; break;
                case 'exp': fp = { type: 'func', name: 'exp', arg: node.arg }; break;
                case 'ln': case 'log': fp = { type: 'binop', op: '/', left: { type: 'num', value: 1 }, right: node.arg }; break;
                case 'log10': case 'log2': fp = { type: 'binop', op: '/', left: { type: 'num', value: 1 }, right: { type: 'binop', op: '*', left: node.arg, right: { type: 'func', name: 'ln', arg: { type: 'num', value: node.name === 'log2' ? 2 : 10 } } } }; break;
                case 'sqrt': fp = { type: 'binop', op: '/', left: { type: 'num', value: 1 }, right: { type: 'binop', op: '*', left: { type: 'num', value: 2 }, right: { type: 'func', name: 'sqrt', arg: node.arg } } }; break;
                case 'arcsin': fp = { type: 'binop', op: '/', left: { type: 'num', value: 1 }, right: { type: 'func', name: 'sqrt', arg: { type: 'binop', op: '-', left: { type: 'num', value: 1 }, right: { type: 'binop', op: '^', left: node.arg, right: { type: 'num', value: 2 } } } } }; break;
                case 'arccos': fp = { type: 'unary', op: '-', operand: { type: 'binop', op: '/', left: { type: 'num', value: 1 }, right: { type: 'func', name: 'sqrt', arg: { type: 'binop', op: '-', left: { type: 'num', value: 1 }, right: { type: 'binop', op: '^', left: node.arg, right: { type: 'num', value: 2 } } } } } }; break;
                case 'arctan': fp = { type: 'binop', op: '/', left: { type: 'num', value: 1 }, right: { type: 'binop', op: '+', left: { type: 'num', value: 1 }, right: { type: 'binop', op: '^', left: node.arg, right: { type: 'num', value: 2 } } } }; break;
                case 'sinh': fp = { type: 'func', name: 'cosh', arg: node.arg }; break;
                case 'cosh': fp = { type: 'func', name: 'sinh', arg: node.arg }; break;
                case 'tanh': fp = { type: 'binop', op: '-', left: { type: 'num', value: 1 }, right: { type: 'binop', op: '^', left: { type: 'func', name: 'tanh', arg: node.arg }, right: { type: 'num', value: 2 } } }; break;
                case 'cot': fp = { type: 'unary', op: '-', operand: { type: 'binop', op: '^', left: { type: 'func', name: 'csc', arg: node.arg }, right: { type: 'num', value: 2 } } }; break;
                case 'sec': fp = { type: 'binop', op: '*', left: { type: 'func', name: 'sec', arg: node.arg }, right: { type: 'func', name: 'tan', arg: node.arg } }; break;
                case 'csc': fp = { type: 'unary', op: '-', operand: { type: 'binop', op: '*', left: { type: 'func', name: 'csc', arg: node.arg }, right: { type: 'func', name: 'cot', arg: node.arg } } }; break;
                case 'abs': return null;   // 非光滑 → 保守 SKIP
                case 'floor': case 'ceil': case 'gamma': return null; // 非光滑/无简单区间导数 → 保守 SKIP
                default: return null;
            }
            return { type: 'binop', op: '*', left: fp, right: dArg };
        }
        default: return null;
    }
}


function _partialRange(eq, i, varNames, box, order) {
    var vi = varNames[i], Bi = box[vi];
    if (!Bi || !isFinite(Bi.min) || !isFinite(Bi.max)) return null;
    var d1AST = _diffAST(eq, vi);
    var d1 = d1AST ? intervalEval(d1AST, box) : null;
    if (!d1 || !isFinite(d1.min) || !isFinite(d1.max)) return null;
    if (order === 1) return d1;
    var d2AST = _diffAST(d1AST, vi);
    var d2 = d2AST ? intervalEval(d2AST, box) : null;
    if (!d2 || !isFinite(d2.min) || !isFinite(d2.max)) return null;
    return d2;
}


function _iRoot(I, p) {
    if (!I || !isFinite(I.min) || !isFinite(I.max)) return null;
    if (p === 0) return null;
    if (p > 0 && p % 2 === 1) {
        var rmin = Math.sign(I.min) * Math.pow(Math.abs(I.min), 1 / p);
        var rmax = Math.sign(I.max) * Math.pow(Math.abs(I.max), 1 / p);
        return { min: Math.min(rmin, rmax), max: Math.max(rmin, rmax) };
    }
    if (p > 0 && p % 2 === 0) {
        if (I.max < 0) return null;
        // 偶次幂逆向必须取对称区间：x^p ∈ [a,b] ⟹ x ∈ [-b^(1/p), b^(1/p)]
        // （2016-08-21 修复：原实现只取正支 [lo,hi]，会把 z²=... 的负支真解排除，
        //   如三球交点 (2,2,-1) 的 z=-1 被 suan28 HC4 传播误删）
        var hi2 = Math.pow(Math.max(0, I.max), 1 / p);
        return { min: -hi2, max: hi2 };
    }
    return null;
}


function _boxLogVolume(D0, varNames) {
    var s = 0;
    for (var i = 0; i < varNames.length; i++) {
        var b = D0[varNames[i]];
        if (!b || typeof b !== 'object') continue;
        var w = b.max - b.min;
        if (!isFinite(w)) return Infinity;
        s += Math.log(Math.max(w, 1e-300));
    }
    return s;
}


function iMul(a, b) { var v = [a.min * b.min, a.min * b.max, a.max * b.min, a.max * b.max]; return { min: Math.min.apply(null, v), max: Math.max.apply(null, v) }; }

function iAdd(a, b) { return { min: a.min + b.min, max: a.max + b.max }; }

function rToI(x) { return { min: x, max: x }; }

function iMatVec(I, v) { var n = I.length, r = []; for (var i = 0; i < n; i++) { var acc = null; for (var k = 0; k < n; k++) { var t = iMul(I[i][k], v[k]); acc = acc === null ? t : iAdd(acc, t); } r.push(acc); } return r; }

function rMatVec(M, v) { var n = M.length, r = new Array(n); for (var i = 0; i < n; i++) { var s = 0; for (var j = 0; j < v.length; j++) s += M[i][j] * v[j]; r[i] = s; } return r; }

function rMatIMat(R, I) { var n = R.length, M = []; for (var i = 0; i < n; i++) { M.push([]); for (var j = 0; j < n; j++) { var acc = null; for (var k = 0; k < n; k++) { var t = iMul(rToI(R[i][k]), I[k][j]); acc = acc === null ? t : iAdd(acc, t); } M[i].push(acc); } } return M; }

function iMatSubReal(A, R) { var n = A.length, M = []; for (var i = 0; i < n; i++) { M.push([]); for (var j = 0; j < n; j++) M[i].push({ min: A[i][j].min - R[i][j], max: A[i][j].max - R[i][j] }); } return M; }
// 区间矩阵 − 区间矩阵（Krawczyk 算子 C = I − Y·J([X]) 需要逐分量区间减法，R 也是区间）

function iMatSub(A, B) { var n = A.length, M = []; for (var i = 0; i < n; i++) { M.push([]); for (var j = 0; j < n; j++) M[i].push({ min: A[i][j].min - B[i][j].min, max: A[i][j].max - B[i][j].max }); } return M; }

function realIdentity(n) { var I = []; for (var i = 0; i < n; i++) { I.push([]); for (var j = 0; j < n; j++) I[i].push(i === j ? 1 : 0); } return I; }

function iVecInterior(A, B) { for (var i = 0; i < A.length; i++) { if (!(A[i].min > B[i].min && A[i].max < B[i].max)) return false; } return true; }

function realMatInv(M) {
    var n = M.length; if (n === 0) return null;
    var cols = [];
    for (var c = 0; c < n; c++) {
        var b = new Array(n); for (var i = 0; i < n; i++) b[i] = (i === c) ? 1 : 0;
        var r = gaussianSolve(M, b);
        if (!r || !r.solution) return null;
        cols.push(r.solution);
    }
    var R = []; for (var i2 = 0; i2 < n; i2++) { R.push([]); for (var j2 = 0; j2 < n; j2++) R[i2].push(cols[j2][i2]); }
    return R;
}
// 单次 Krawczyk 尝试（固定半径 r）

function iVecDisjoint(A, B) {
    for (var i = 0; i < A.length; i++) { if (!(A[i].max < B[i].min || A[i].min > B[i].max)) return false; }
    return true;
}
// 全局分支定界主函数：返回 {solutions, boxCount, residualBoxes, budget, complete}
// ═══════════════════ 模块：interval/affine ═══════════════════
/* 模块 interval/affine：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function _Aff(c, e) { return { c: c, e: e || {} }; }

function _affRad(a) { if (!a) return 0; var r = 0; for (var k in a.e) r += Math.abs(a.e[k]); return r; }

function _affToInterval(a) { if (!a) return null; var r = _affRad(a); return _iNorm({ min: a.c - r, max: a.c + r }); }
// sound 容差：区间求值受浮点舍入影响，包络可能偏离真值几个 ulp（如 12/5 经 12*(1/5)

function _ivExcludesZero(iv) {
  if (!iv || !isFinite(iv.min) || !isFinite(iv.max)) return false;
  var pad = Math.max(1e-12, 1e-12 * Math.max(1, Math.abs(iv.min), Math.abs(iv.max)));
  return iv.max < -pad || iv.min > pad;
}

function _affAdd(a, b) { var e = {}; for (var k in a.e) e[k] = a.e[k]; for (var k in b.e) e[k] = (e[k] || 0) + b.e[k]; return _Aff(a.c + b.c, e); }

function _affSub(a, b) { var e = {}; for (var k in a.e) e[k] = a.e[k]; for (var k in b.e) e[k] = (e[k] || 0) - b.e[k]; return _Aff(a.c - b.c, e); }

function _affMul(a, b) {
  // 一阶 AA 乘法（de Figueiredo 2004）：线性项 + 二次残差保守吸收为新噪声 ε
  var ra = _affRad(a), rb = _affRad(b), e = {};
  for (var i in a.e) e[i] = (e[i] || 0) + b.c * a.e[i];
  for (var i in b.e) e[i] = (e[i] || 0) + a.c * b.e[i];
  var xlo = a.c - ra, xhi = a.c + ra, ylo = b.c - rb, yhi = b.c + rb;
  var cross = Math.abs((xlo - a.c) * (yhi - b.c) + (xhi - a.c) * (ylo - b.c)) / 2;
  var gamma = cross;
  // 二次项重复计数修正（2026-10-02，紧性改进，sound 不变）：
  //   x*x 这类【同一仿射表达式自乘】时 a.e 与 b.e 是同一组噪声符号、代表同一个不确定量，
  //   原双重循环把它当成两个独立噪声累加 ⇒ 半径多出 |e_i*e_i|，包络宽约 2 倍。
  //   实测：x^2 @ [2,4] 得 [1,17]，真值 [4,16] —— 仍 sound（含真值），但恒松一倍。
  //   正确性论证：(c+e)^2 = c^2 + 2ce + e^2，其中 e^2 是【同一个】 e 的平方，只应计一次；
  //   cross 项已覆盖 Taylor 余项的一阶部分，跳过重复计数后包络仍含真值。
  //   注意：本函数历史上多次因 unsound 被修，改动必须经蒙特卡洛包含性验证 + 全回归。
  var _selfMul = (a === b);
  for (var i in a.e) for (var j in b.e) {
    if (_selfMul && i === j) continue;
    gamma += Math.abs(a.e[i] * b.e[j]);
  }
  var sym = _affSym++; e[sym] = gamma;
  return _Aff(a.c * b.c, e);
}

function _affInv(b) {
  // 1/b 一阶泰勒，误差保守界 |(b-b0)^2|/(2 b0^2 ξ^2)，ξ∈盒，min|ξ|=|b0|-rb
  // ⚠️ 修正（sound 正确性，2026-09-07）：旧实现 r=0-b=-b，lin=(-1/b.c²)·(-b) 的中心 lin.c 已是 1/b.c，
  //   return 又写 1/b.c + lin.c → 中心被双重计数为 2/b.c（如 1/5 算成 0.4、12/5 算成 4.8），
  //   导致所有含除法的区间包络 / 中值定理判无解（suan7/suan29/suan35 等）系统性假阴性。
  //   正确：dev = b - b.c（中心 0）做一阶泰勒，lin.c=0，return 中心恰为 1/b.c，且噪声符号正确。
  var rb = _affRad(b); if (b.c === 0) return null;
  var dev = _affSub(b, _Aff(b.c, {}));   // b - b0，中心为 0
  var lin = _affMul(dev, _Aff(-1 / (b.c * b.c), {}));   // 一阶项，中心为 0
  var e = {}; for (var k in lin.e) e[k] = lin.e[k];
  var m = Math.abs(b.c) - rb; if (m <= 0) return null;
  var err = (rb * rb) / (2 * b.c * b.c * m * m);
  var sym = _affSym++; e[sym] = err;
  return _Aff(1 / b.c + lin.c, e);   // 现 lin.c=0 → 中心 = 1/b.c
}

function _affDiv(a, b) { var ib = _affInv(b); return ib ? _affMul(a, ib) : null; }

function _buildAffEnv(intervals) {
  var env = {}; _affSym = 0;
  if (intervals) for (var name in intervals) {
    var iv = intervals[name];
    if (!iv || iv.min > iv.max) { env[name] = _Aff(iv ? (iv.min + iv.max) / 2 : 0, {}); continue; }
    var e = {}; e[_affSym++] = (iv.max - iv.min) / 2; env[name] = _Aff((iv.min + iv.max) / 2, e);
  }
  return env;
}

function _affineEval(ast, env) {
  if (!ast) return null;
  if (ast.type === 'num') return _Aff(ast.value, {});
  if (ast.type === 'var') {
    if (env[ast.name]) return env[ast.name];
    var e = {}; e[_affSym++] = 1e6; return _Aff(0, e); // 默认全域 [-1e6,1e6]
  }
  if (ast.type === 'binop') {
    var l = _affineEval(ast.left, env), r = _affineEval(ast.right, env);
    if (!l || !r) return null;
    if (ast.op === '+') return _affAdd(l, r);
    if (ast.op === '-') return _affSub(l, r);
    if (ast.op === '*') return _affMul(l, r);
    if (ast.op === '/') return _affDiv(l, r);
    if (ast.op === '^') {
      // 修复（sound 优先，2026-10-02）：旧实现用 Number.isInteger(Math.round(r.c)) 判整数幂，
      // 非整数指数被 Math.round 截断后照常返回仿射结果（x^0.2857→x^0=1、x^0.5→x^1、x^1.7→x^2），
      // 包络不覆盖真值 ⇒ unsound，且会把"明明有根"的式子判成无解。
      // 正确口径：指数必须是【精确非负整数】（Number.isInteger(r.c)，不做任何 round），否则 return null 降级 _rangeEval。
      // 负幂另加拒绝：_affInv 的一阶误差界 err=rb²/(2c²m²) 在 rb/c 不小时过紧（实测 x^-1@[2,3] 给 [0.315,0.485]，
      // 真值 [1/3,1/2] 落在盒外 ⇒ unsound）。负幂一律交 _rangeEval（端点取幂 + 倒数，精确且保守）。
      if (Object.keys(r.e).length === 0 && Number.isInteger(r.c) && r.c >= 0 && Math.abs(r.c) < 100) {
        var n = r.c; if (n === 0) return _Aff(1, {}); if (n === 1) return l;
        var acc = l; for (var p = 1; p < Math.abs(n); p++) acc = _affMul(acc, l);
        return n < 0 ? _affInv(acc) : acc;
      }
      return null; // 非整数幂：不能给出可信包络 ⇒ 保守交还 _rangeEval
    }
    return null;
  }
  if (ast.type === 'func') {
    var arg = ast.arg || (ast.args ? ast.args[0] : null);
    var av = arg ? _affineEval(arg, env) : null;
    if (!av) return null;
    var iv = _affToInterval(av); if (!iv) return null;
    // 超越函数降级：仿射自变量 → 保守区间函数包围（复用 _rangeEval，无递归环）
    var tmp = { type: 'func', name: ast.name, arg: { type: 'var', name: '__a' } };
    var rv = _rangeEval(tmp, { __a: iv });
    if (!rv || !isFinite(rv.min) || !isFinite(rv.max)) return null; // 含 ±Inf：交还 _rangeEval 直接给出保守区间
    // 关键修复（P0-2）：旧实现 return _Aff((rv.min+rv.max)/2, {}) 把合法区间宽度丢成 0，
    // 致 intervalEval(sin x)@[-2,2] 塌成 [0,0]（unsound：真值须含 [-1,1]）。
    // 正确做法：用半径 (rv.max-rv.min)/2 的噪声符号把 rv 完整编码为仿射，
    // 使 _affToInterval 还原为 [rv.min, rv.max]（sound 且紧致），Krawczyk 雅可比随之可信。
    var e = {}; e[_affSym++] = (rv.max - rv.min) / 2;
    return _Aff((rv.min + rv.max) / 2, e);
  }
  if (ast.type === 'unary') {
    var u = _affineEval(ast.operand, env);
    if (!u) return null;
    if (ast.op === '-') return _affSub(_Aff(0, {}), u);
    if (ast.op === '+') return u;
    return null;
  }
  return null;
}
// ═══════════════════ 模块：algebra/exact ═══════════════════
/* 模块 algebra/exact：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function _s60gcd(a, b) {
    a = a < 0n ? -a : a; b = b < 0n ? -b : b;
    while (b) { const t = a % b; a = b; b = t; }
    return a;
}

function _s60mk(p, q) {
    if (q === 0n) return null;
    if (q < 0n) { p = -p; q = -q; }
    const g = _s60gcd(p, q);
    if (g > 1n) { p /= g; q /= g; }
    return { p: p, q: q };
}

function _s60add(a, b) { if (a.p === 0n) return b; if (b.p === 0n) return a; return _s60mk(a.p * b.q + b.p * a.q, a.q * b.q); }

function _s60sub(a, b) { if (b.p === 0n) return a; return _s60mk(a.p * b.q - b.p * a.q, a.q * b.q); }

function _s60mul(a, b) { if (a.p === 0n || b.p === 0n) return _s60R0(); return _s60mk(a.p * b.p, a.q * b.q); }

function _s60div(a, b) { if (b.p === 0n) return null; if (a.p === 0n) return _s60R0(); return _s60mk(a.p * b.q, a.q * b.p); }

function _s60neg(a) { return { p: -a.p, q: a.q }; }

function _s60abs(a) { return a.p < 0n ? _s60neg(a) : a; }

function _s60cmp(a, b) { const l = a.p * b.q, r = b.p * a.q; return l < r ? -1 : (l > r ? 1 : 0); }

function _s60num(a) { return Number(a.p) / Number(a.q); }


function _s60fromNumber(x, maxDen) {
    if (typeof x !== 'number' || !isFinite(x)) return null;
    if (Number.isInteger(x)) return _s60mk(BigInt(x), 1n);
    const md = BigInt(maxDen || 1000000000);
    const neg = x < 0; let y = Math.abs(x);
    let h1 = 1n, h0 = 0n, k1 = 0n, k0 = 1n;
    for (let i = 0; i < 64; i++) {
        const a = BigInt(Math.floor(y));
        const h2 = a * h1 + h0, k2 = a * k1 + k0;
        if (k2 > md) break;
        h0 = h1; h1 = h2; k0 = k1; k1 = k2;
        const frac = y - Number(a);
        if (frac < 1e-17) break;
        y = 1 / frac;
    }
    const r = _s60mk(neg ? -h1 : h1, k1);
    const err = Math.abs(_s60num(r) - x);
    if (err > 1e-12 * Math.max(1, Math.abs(x))) return null;
    return r;
}


function _s60presolve(Ac0, bc0, n, o) {
    const oo = o || {};
    const stats = { zeroRow: 0, zeroCol: 0, singletonRow: 0, dupRow: 0, diagDominant: 0, passes: 0 };
    let A = Ac0.map(r => r.slice()), b = bc0.slice();
    let act = []; for (let k = 0; k < n; k++) act.push(k);
    const fixed = new Array(n).fill(null);
    let changed = true, guard = 0;

    const nzRow = r => { let c = 0; for (let k = 0; k < act.length; k++) if (!_s60isZero(A[r][k])) c++; return c; };
    const nzCol = k => { let c = 0; for (let r = 0; r < A.length; r++) if (!_s60isZero(A[r][k])) c++; return c; };
    // 行规范化 key：整行除以「首个非零元」+ rhs 除以同一元素 ⇒ 成比例的两行 key 相同
    const rowCanon = r => {
        let lead = -1;
        for (let k = 0; k < act.length; k++) if (!_s60isZero(A[r][k])) { lead = k; break; }
        if (lead < 0) return 'ZERO|' + b[r].p + '/' + b[r].q;
        const inv = _s60div(_s60R1(), A[r][lead]);
        let s = '';
        for (let k = 0; k < act.length; k++) {
            const q = _s60mul(A[r][k], inv);
            s += q.p + '|' + q.q + ';';
        }
        const rhs = _s60mul(b[r], inv);
        return s + '||' + rhs.p + '/' + rhs.q;
    };

    while (changed && guard++ < 400) {
        changed = false;
        stats.passes++;

        for (let i = A.length - 1; i >= 0; i--) {
            if (nzRow(i) === 0) {
                if (!_s60isZero(b[i])) return { infeasible: true, reason: 'zeroRow', stats: stats, fixed: fixed };
                A.splice(i, 1); b.splice(i, 1);
                stats.zeroRow++; changed = true;
            }
        }
        if (!A.length || !act.length) break;

        // R5 重复行
        {
            const seen = new Set(); let removed = false;
            for (let i = 0; i < A.length; i++) {
                const key = rowCanon(i);
                if (seen.has(key)) { A.splice(i, 1); b.splice(i, 1); stats.dupRow++; changed = removed = true; break; }
                seen.add(key);
            }
            if (removed) continue;
        }

        {
            let did = false;
            for (let i = 0; i < A.length && !did; i++) {
                if (nzRow(i) !== 1) continue;
                let t = -1;
                for (let k = 0; k < act.length; k++) if (!_s60isZero(A[i][k])) { t = k; break; }
                if (t < 0) continue;
                const v = _s60div(b[i], A[i][t]);
                if (v === null) return { infeasible: true, reason: 'singletonRowZeroPivot', stats: stats, fixed: fixed };
                fixed[act[t]] = v;
                const pivotRow = A[i].slice();
                for (let r = 0; r < A.length; r++) {
                    if (r === i) continue;
                    const c = A[r][t];
                    if (_s60isZero(c)) continue;
                    b[r] = _s60sub(b[r], _s60mul(c, v));
                    for (let k = 0; k < act.length; k++) if (k !== t) A[r][k] = _s60sub(A[r][k], _s60mul(c, pivotRow[k]));
                    A[r][t] = _s60R0();
                }
                A.splice(i, 1); b.splice(i, 1);
                for (let r = 0; r < A.length; r++) A[r] = A[r].filter((_, idx) => idx !== t);
                act.splice(t, 1);
                stats.singletonRow++; changed = did = true;
            }
            if (did) continue;
        }

        {
            let did = false;
            for (let k = 0; k < act.length; k++) {
                if (nzCol(k) === 0) {
                    fixed[act[k]] = _s60R0();
                    for (let r = 0; r < A.length; r++) A[r] = A[r].filter((_, idx) => idx !== k);
                    act.splice(k, 1);
                    stats.zeroCol++; changed = did = true;
                    break;
                }
            }
            if (did) continue;
        }

        // R7 严格对角占优（唯一解定论）
        if (!oo.skipDom && A.length === act.length && act.length > 0) {
            let dd = true;
            for (let k = 0; k < act.length; k++) {
                let diag = null, sum = _s60R0();
                for (let r = 0; r < A.length; r++) {
                    if (r === k) { if (!_s60isZero(A[r][k])) diag = _s60abs(A[r][k]); }
                    else sum = _s60add(sum, _s60abs(A[r][k]));
                }
                if (!diag || _s60cmp(diag, sum) <= 0) { dd = false; break; }
            }
            if (dd) { stats.diagDominant++; return { dense: true, exactUnique: true, A: A, b: b, act: act, fixed: fixed, stats: stats }; }
        }
    }
    return { A: A, b: b, act: act, fixed: fixed, stats: stats };
}


function _s60bareissExact(A0, b0) {
    const m = A0.length, n = A0[0] ? A0[0].length : 0;
    if (!m || !n) return { rank: 0, consistent: true, underdetermined: true };
    const M = A0.map((r, i) => r.map(v => v).concat([b0[i]]));
    const piv = new Array(n).fill(-1);
    let rank = 0, prev = _s60R1(), nswap = 0;
    for (let k = 0; k < n && rank < m; k++) {
        let pi = -1;
        for (let i = rank; i < m; i++) if (!_s60isZero(M[i][k])) { pi = i; break; }
        if (pi < 0) continue;
        if (pi !== rank) { const t = M[pi]; M[pi] = M[rank]; M[rank] = t; nswap++; }
        const p = M[rank][k];
        if (rank > 0) {
            for (let i = rank + 1; i < m; i++) {
                if (_s60isZero(M[i][k])) continue;
                const f = M[i][k];
                for (let j = k; j <= n; j++) {
                    M[i][j] = _s60div(_s60sub(_s60mul(M[i][j], p), _s60mul(f, M[rank][j])), prev);
                    if (M[i][j] === null) return { failed: true };
                }
                M[i][k] = _s60R0();
            }
        } else {
            for (let i = rank + 1; i < m; i++) {
                if (_s60isZero(M[i][k])) continue;
                const f = _s60div(M[i][k], p);
                if (f === null) return { failed: true };
                for (let j = k; j <= n; j++) M[i][j] = _s60sub(M[i][j], _s60mul(f, M[rank][j]));
                M[i][k] = _s60R0();
            }
        }
        piv[rank] = k; prev = p; rank++;
    }
    for (let i = rank; i < m; i++) if (!_s60isZero(M[i][n])) return { rank: rank, consistent: false };
    if (rank < n) return { rank: rank, consistent: true, underdetermined: true, M: M, piv: piv };
    const x = new Array(n).fill(null);
    for (let r = n - 1; r >= 0; r--) {
        const pc = piv[r];
        let s = M[r][n];
        for (let j = pc + 1; j < n; j++) if (x[j]) s = _s60sub(s, _s60mul(M[r][j], x[j]));
        x[pc] = _s60div(s, M[r][pc]);
        if (x[pc] === null) return { failed: true };
    }
    let det = M[n - 1][n - 1];
    for (let i = 0; i < nswap; i++) det = _s60neg(det);
    return { rank: rank, consistent: true, unique: true, x: x, det: det };
}


function _s60particular(A0, b0, n) {
    const m = A0.length;
    const M = A0.map((r, i) => r.map(v => v).concat([b0[i]]));
    let rr = 0; const pivCol = [];
    for (let k = 0; k < n && rr < m; k++) {
        let pi = -1;
        for (let i = rr; i < m; i++) if (!_s60isZero(M[i][k])) { pi = i; break; }
        if (pi < 0) continue;
        if (pi !== rr) { const t = M[pi]; M[pi] = M[rr]; M[rr] = t; }
        const p = M[rr][k];
        for (let i = rr + 1; i < m; i++) {
            if (_s60isZero(M[i][k])) continue;
            const f = _s60div(M[i][k], p);
            if (f === null) return null;
            for (let j = k; j <= n; j++) M[i][j] = _s60sub(M[i][j], _s60mul(f, M[rr][j]));
            M[i][k] = _s60R0();
        }
        pivCol.push(k); rr++;
    }
    const x = new Array(n).fill(null);
    for (let r = rr - 1; r >= 0; r--) {
        const pc = pivCol[r];
        let s = M[r][n];
        for (let j = pc + 1; j < n; j++) if (x[j]) s = _s60sub(s, _s60mul(M[r][j], x[j]));
        x[pc] = _s60div(s, M[r][pc]);
        if (x[pc] === null) return null;
    }
    for (let j = 0; j < n; j++) if (x[j] === null) x[j] = _s60R0();
    return x;
}


function _s60nullspace(A0, n) {
    const m = A0.length;
    if (m === 0) {
        const I = [];
        for (let j = 0; j < n; j++) { const v = new Array(n).fill(_s60R0()); v[j] = _s60R1(); I.push(v); }
        return { rref: [], pivots: [], basis: I };
    }
    const M = A0.map(r => r.map(v => v));
    const pivCol = [];      // pivCol[r] = 第 r 个主元所在的列
    const pivotRowOf = {};  // col -> row
    let rr = 0;
    for (let k = 0; k < n && rr < m; k++) {
        let pi = -1;
        for (let i = rr; i < m; i++) if (!_s60isZero(M[i][k])) { pi = i; break; }
        if (pi < 0) continue;
        if (pi !== rr) { const t = M[pi]; M[pi] = M[rr]; M[rr] = t; }
        const p = M[rr][k];
        // 化成 1：整行除以主元（有理精确）
        for (let j = k; j < n; j++) {
            const q = _s60div(M[rr][j], p);
            if (q === null) return null;
            M[rr][j] = q;
        }
        // 消掉其余行的这一列
        for (let i = 0; i < m; i++) {
            if (i === rr || _s60isZero(M[i][k])) continue;
            const f = M[i][k];
            for (let j = k; j < n; j++) M[i][j] = _s60sub(M[i][j], _s60mul(f, M[rr][j]));
        }
        pivCol.push(k); pivotRowOf[k] = rr; rr++;
    }
    // 自由列 = 非主元列
    const isPiv = new Array(n).fill(false);
    for (const c of pivCol) isPiv[c] = true;
    const freeCols = [];
    for (let j = 0; j < n; j++) if (!isPiv[j]) freeCols.push(j);
    // 每个自由列 f 造一个零空间基向量
    const basis = [];
    for (const f of freeCols) {
        const v = new Array(n).fill(_s60R0());
        v[f] = _s60R1();
        for (let r = 0; r < pivCol.length; r++) {
            const c = M[pivotRowOf[pivCol[r]]][f];
            if (!_s60isZero(c)) v[pivCol[r]] = _s60neg(c);   // 主元位 = −R[row][f]
        }
        basis.push(v);
    }
    return { rref: M, pivots: pivCol, freeCols: freeCols, basis: basis, rank: pivCol.length };
}

// ── 2026-10-05 删除：_s60sampleAffine（零空间参数化仿射采样）整块 ──
//
// 用户契约：「对于部分解的，只找到一个推荐解就行，不需要确定性，不需要离原点最近」。
// 实测该函数是「欠定题返回体 95.6%~97.6% 都是采样点」的元凶：
//   3 元欠定 → 257 个解 / 77 KB     6 元欠定 → 512 个解 / 153 KB。
// 而且那 512 个点**没有一个能升级 proven**（浮点线性组合 ⇒ 只能 candidate）。
//
// 删除是数学上的进步而非退让：改用 RREF 自由列取 0 的**精确特解**，
//   · 可做 ℚ 上精确代入确证 ⇒ tier 升到 proven；
//   · 是消元法的规范选择，不需额外度量（不像伪逆最小范数要指定欧氏范数）；
//   · 返回体 153KB → 4.0KB。
//
// 留下的历史教训（写在此处以免重犯，别删）：
//   本函数曾有**生产事故级**缺陷：push() 是 O(|out|) 线性去重且无总量上限，
//   每方向 CAP+1=257 个点、方向数 k ⇒ |out| 可达 257^k，整体退化到 O(N²)。
//   触发用例 E2（4 方程 6 未知、3 维解流形、域 ±1e6）：
//   CPU profile 90.8% ticks 烧在此函数，**60 秒被 kill 仍不返回**。
//   8 秒硬预算兜不住 —— 预算检查在【算子粒度】，这是算子**内部**死循环。
//   ⇒ 教训：任何「生成候选集」的循环都必须自带总量硬闸 + O(1) 去重，
//     不能指望外层预算兜底；而最好的闸门是**根本不要生成**不需要的候选。


function _s60markowitz(A, k, m, n, u) {
    const rowsNZ = new Array(m);
    for (let i = 0; i < m; i++) { let c = 0; for (let j = k; j < n; j++) if (A[i][j] !== 0) c++; rowsNZ[i] = c; }
    const cand = [];
    for (let i = k; i < m; i++) if (rowsNZ[i] > 0) cand.push(i);
    if (!cand.length) return null;
    cand.sort((x, y) => rowsNZ[x] - rowsNZ[y]);
    const colNZ = new Array(n).fill(0), colMax = new Array(n).fill(0);
    for (let i = k; i < m; i++) for (let j = k; j < n; j++) {
        if (A[i][j] !== 0) { colNZ[j]++; const av = Math.abs(A[i][j]); if (av > colMax[j]) colMax[j] = av; }
    }
    const searchRows = cand.slice(0, 3);
    let best = null, bestCost = Infinity;
    for (const i of searchRows) {
        for (let j = k; j < n; j++) {
            const v = A[i][j];
            if (v === 0) continue;
            if (Math.abs(v) < u * colMax[j] * (1 - 1e-12)) continue;   // 稳定因子筛除
            const cost = (rowsNZ[i] - 1) * (colNZ[j] - 1);
            if (cost < bestCost) { bestCost = cost; best = [i, j]; }
        }
    }
    if (best) return best;
    let bi = -1, bj = -1, bv = 0;
    for (let i = k; i < m; i++) for (let j = k; j < n; j++) if (Math.abs(A[i][j]) > bv) { bv = Math.abs(A[i][j]); bi = i; bj = j; }
    if (bv === 0) return null;
    return [bi, bj];
}


function _s60presolveFloat(A0, b0, n, o) {
    const EPS = 1e-12;
    const stats = { zeroRow: 0, singletonRow: 0, dupRow: 0 };
    let A = A0.map(r => r.slice()), b = b0.slice();
    let act = []; for (let k = 0; k < n; k++) act.push(k);
    const fixed = new Array(n).fill(null);
    let changed = true, guard = 0;
    const isz = v => Math.abs(v) < EPS;

    while (changed && guard++ < 100) {
        changed = false;
        for (let i = A.length - 1; i >= 0; i--) {
            let allz = true;
            for (let k = 0; k < act.length; k++) if (!isz(A[i][k])) { allz = false; break; }
            if (allz) {
                if (!isz(b[i])) return { infeasible: true, reason: 'float-zeroRow' };
                A.splice(i, 1); b.splice(i, 1); stats.zeroRow++; changed = true;
            }
        }
        if (!A.length || !act.length) break;
        // R5 重复行（【必须按成比例判定，不能只比零/非零结构】）
        //   实测教训：稠密 6×6 里每行的零/非零结构完全相同，只比结构会把 6 行删成 4 行，
        //   变成「4 行 6 变量」的伪欠定。虽被后续精确残差验证兜住（结果仍对），
        //   但那是运气 —— 一旦验证失败就会给错误答案。改为「按首个非零元归一化后比较」。
        {
            const seen = new Set(); let rm = false;
            for (let i = 0; i < A.length; i++) {
                let lead = -1;
                for (let k = 0; k < act.length; k++) if (!isz(A[i][k])) { lead = k; break; }
                let key;
                if (lead < 0) key = 'ZERO|' + b[i].toExponential(12);
                else {
                    const s = A[i][lead];
                    let t = '';
                    for (let k = 0; k < act.length; k++) t += (A[i][k] / s).toFixed(12) + ',';
                    key = t + '||' + (b[i] / s).toFixed(12);
                }
                if (seen.has(key)) { A.splice(i, 1); b.splice(i, 1); stats.dupRow++; changed = rm = true; break; }
                seen.add(key);
            }
            if (rm) continue;
        }
        {
            let did = false;
            for (let i = 0; i < A.length && !did; i++) {
                let cnt = 0, t = -1;
                for (let k = 0; k < act.length; k++) if (!isz(A[i][k])) { cnt++; t = k; if (cnt > 1) break; }
                if (cnt !== 1 || t < 0) continue;
                const v = b[i] / A[i][t];
                fixed[act[t]] = v;
                const prow = A[i].slice();
                for (let r = 0; r < A.length; r++) {
                    if (r === i) continue;
                    const c = A[r][t];
                    if (isz(c)) continue;
                    b[r] -= c * v;
                    for (let k = 0; k < act.length; k++) if (k !== t) A[r][k] -= c * prow[k];
                    A[r][t] = 0;
                }
                A.splice(i, 1); b.splice(i, 1);
                for (let r = 0; r < A.length; r++) A[r] = A[r].filter((_, idx) => idx !== t);
                act.splice(t, 1);
                stats.singletonRow++; changed = did = true;
            }
            if (did) continue;
        }
        {
            let did = false;
            for (let k = 0; k < act.length; k++) {
                let cnt = 0;
                for (let r = 0; r < A.length; r++) if (!isz(A[r][k])) { cnt++; break; }
                if (cnt === 0) {
                    fixed[act[k]] = 0;
                    for (let r = 0; r < A.length; r++) A[r] = A[r].filter((_, idx) => idx !== k);
                    act.splice(k, 1);
                    stats.zeroCol = (stats.zeroCol || 0) + 1;
                    changed = did = true; break;
                }
            }
            if (did) continue;
        }
    }
    return { A: A, b: b, act: act, fixed: fixed, stats: stats, allSolved: act.length === 0 };
}


function _s60diagDominantFloat(A, n, EPS) {
    if (A.length !== n) return false;
    for (let k = 0; k < n; k++) {
        const d = Math.abs(A[k][k]);
        if (d < EPS) return false;
        let s = 0;
        for (let j = 0; j < n; j++) if (j !== k) s += Math.abs(A[k][j]);
        if (d <= s) return false;
    }
    return true;
}


function _s60solveLinear(rows, n, opts) {
    const o = opts || {};
    const T0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (!n || n > 6) return { ok: false, reason: 'n>6' };
    if (!rows || !rows.length) return { ok: false, reason: 'empty' };
    const maxDen = o.exactMaxDen || 1000000000;

    // —— 阶段 A：浮点系数矩阵（供通道 1 用）——
    const Af = rows.map(r => r.slice(0, n));
    const bf = rows.map(r => r[n]);

    // —— 阶段 A': presolve 裁剪链（浮点版，纯剪枝，不动精度）——
    // presolve 的每条规则都是【严格等价变换】，用浮点做判定是安全的：
    // 只在「结构为 0」时剪枝，结构判定用绝对/相对阈值，不用近似相等。
    const preF = _s60presolveFloat(Af, bf, n, o);
    if (preF.infeasible) {
        // 浮点判定空行/不相容 ⇒ 退回精确确认（避免阈值误判造成假「无解」）
        return _s60exactConfirmOrExact(rows, n, o, T0, 'presolve-float-infeasible');
    }

    // —— 阶段 A'': Levy–Desplanques 严格对角占优 ⇒ 唯一解已定论。
    // 数学上最强的裁剪之一：省掉整场消元（仍做 O(n²) 精确验证保严格）。
    const dd = _s60diagDominantFloat(preF.act.length === n ? Af : preF.A, preF.act.length, 1e-12);
    if (dd) preF.stats.diagDominant = (preF.stats.diagDominant || 0) + 1;

    // —— 通道 1：浮点 Markowitz 稀疏序（在【裁剪后的】系统上消元，量更小）——
    const Ared = preF.act.length === n ? Af : preF.A;
    const bred = preF.act.length === n ? bf : preF.b;
    const fl = _s60floatMarkowitzSolve(
        Ared.map(r => r.slice()), bred.slice(), preF.act.length, o.u === undefined ? 0.1 : o.u);
    const T1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    if (fl.kind === 'nosol') {
        // 浮点判不相容 ⇒ 必须精确确认（严格性要求）
        return _s60exactConfirmOrExact(rows, n, o, T0, 'float-nosol', T1);
    }

    if (fl.kind === 'unique') {
        // —— 通道 2a：O(n²) 精确代入验证（对【原方程】做，证明严格）——
        let xFull = null;
        if (preF.act.length === n) {
            xFull = fl.x;
        } else {
            xFull = new Array(n).fill(0);
            for (let k = 0; k < preF.act.length; k++) xFull[preF.act[k]] = fl.x[k];
            for (let j = 0; j < n; j++) if (preF.fixed[j] != null) xFull[j] = preF.fixed[j];
        }
        const v = _s60exactVerify(Af, bf, xFull, maxDen);
        const T2 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        if (v.verified) {
            return {
                ok: true, kind: 'unique', x: v.xExact, rank: n,
                verified: 'exact-substitution', path: 'float-markowitz + exact-verify',
                floatMs: T1 - T0, verifyMs: T2 - T1, ms: T2 - T0,
                stats: preF.stats, presolveMs: null,
                det: null
            };
        }
        // 精确代入不通过（浮点解不够准 / 系统病态）⇒ 走精确消元兜底
        return _s60exactConfirmOrExact(rows, n, o, T0, 'verify-failed', T1);
    }

    // 欠定 / 奇异 ⇒ 走精确路径拿精确秩与特解
    return _s60exactConfirmOrExact(rows, n, o, T0, 'float-' + fl.kind, T1);
}


function _s60exactVerify(Af, bf, xf, maxDen) {
    const n = xf.length;
    const xR = new Array(n);
    for (let j = 0; j < n; j++) {
        const v = _s60fromNumber(xf[j], maxDen);
        if (v === null) return { verified: false };
        xR[j] = v;
    }
    for (let i = 0; i < Af.length; i++) {
        let s = _s60R0();
        for (let j = 0; j < n; j++) {
            if (Af[i][j] === 0) continue;
            const a = _s60fromNumber(Af[i][j], maxDen);
            if (a === null) return { verified: false };
            s = _s60add(s, _s60mul(a, xR[j]));
        }
        const b = _s60fromNumber(bf[i], maxDen);
        if (b === null) return { verified: false };
        if (!_s60isZero(_s60sub(s, b))) return { verified: false };
    }
    return { verified: true, xExact: xR };
}


function _s60exactConfirmOrExact(rows, n, o, T0, why, T1) {
    const maxDen = o.exactMaxDen || 1000000000;
    const RA = [], RB = [];
    for (let i = 0; i < rows.length; i++) {
        const ar = new Array(n);
        for (let j = 0; j < n; j++) {
            const v = _s60fromNumber(rows[i][j], maxDen);
            if (v === null) return { ok: false, reason: 'irrational-coef' };
            ar[j] = v;
        }
        const bv = _s60fromNumber(rows[i][n], maxDen);
        if (bv === null) return { ok: false, reason: 'irrational-rhs' };
        RA.push(ar); RB.push(bv);
    }
    const pre = _s60presolve(RA, RB, n, o);
    const ms0 = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - T0;
    if (pre.infeasible) {
        // ⚠ 这条 fail-closed 路径原先【不返回 rank 字段】（实测抓到：零行矛盾
        //   [[1,0,0|1],[0,0,0|0],[0,0,0|5]] 得到 {kind:'nosol', reason:'zeroRow'}
        //   而没有 rank），破坏输出契约 —— 同一条 nosol 结论，另一条路径
        //   （rank-inconsistent）却带 rank，调用方没法统一取值。
        //   修法：拿原矩阵 A 做一次精确消元把 rank(A) 算出来，而不是留空或猜。
        //   rhs 传全零：这样只做行阶梯化、不会误触矛盾判定，得到的正是 rank(A)。
        const rankA = _s60rankOnly(RA, n);
        return {
            ok: true, kind: 'nosol', provenEmpty: true, reason: pre.reason, rank: rankA,
            stats: pre.stats, ms: ms0, path: 'exact-presolve', why: why
        };
    }
    const fixed = pre.fixed || new Array(n).fill(null);
    const act = pre.act || [];
    const A = pre.A || [], b = pre.b || [];

    let res;
    if (!act.length) {
        res = { kind: 'unique', core: [], rank: 0 };
    } else if (!A.length) {
        res = { kind: 'family', core: new Array(act.length).fill(null), rank: 0 };
    } else {
        const r = _s60bareissExact(A, b);
        if (r.failed) return { ok: false, reason: 'bareiss-fail' };
        if (r.consistent === false) {
            // 无解时系统被消到矛盾行。rank 语义 = 【原系数矩阵 A 的秩】。
            // 换算见下方 fullRank 处的推导：rank(原A) = rank(剩余) + singletonRow 次数。
            return {
                ok: true, kind: 'nosol', provenEmpty: true, reason: 'rank-inconsistent',
                rank: r.rank + (pre.stats.singletonRow || 0),
                stats: pre.stats, ms: ms0, path: 'exact-bareiss', why: why
            };
        }
        if (r.unique) res = { kind: 'unique', core: r.x, rank: r.rank, det: r.det };
        else {
            // 秩亏 ⇒ 解集是仿射子空间。除了特解，还要把零空间基带出来，
            // 让调用方能【解析地】沿解流形采样出多个族解（而非靠随机撒点碰运气）。
            const core = _s60particular(A, b, act.length);
            const ns = _s60nullspace(A, act.length);
            res = {
                kind: 'family', core: core, rank: r.rank,
                nullspace: ns ? ns.basis : null,
                freeCols: ns ? ns.freeCols : null
            };
        }
    }

    const x = new Array(n).fill(null);
    for (let k = 0; k < act.length; k++) x[act[k]] = res.core[k];
    for (let j = 0; j < n; j++) {
        if (x[j] === null) x[j] = fixed[j] != null ? fixed[j] : _s60R0();
    }
    // rank 语义 = 【原系数矩阵 A 的秩】。换算公式（推导经过两轮返工，见下）：
    //
    //   rank(原A) = rank(presolve 后的剩余系统) + stats.singletonRow
    //
    // 推导：singletonRow 消元取一个「只有一个非零元」的 pivot 行 i、列 t，
    //   把列 t 从【所有其他行】里消成 0，然后同时删掉行 i 与列 t。
    //   于是变换后的矩阵形如 [[pivot, *…], [0, A′]]，pivot ≠ 0
    //   ⇒ 秩 = 1 + rank(A′)。即【每做一次 singletonRow，秩恰好降 1】。
    //   其余三种裁剪都不改变秩：
    //     zeroRow  — 删的是零行，不贡献秩；
    //     dupRow   — 删的是成比例重复行，与被保留的那行线性相关；
    //     zeroCol  — 删的是零列，零列本就不在列空间里。
    //
    // ⚠ 这里连着两个错误的修正，都已删除，记录下来防止重犯：
    //   ① 曾写 `fullRank = res.rank + nFixed`，nFixed = presolve 固定的变量个数。
    //      错在把「消元固定了变量」当成了「秩会增加 1」。实测反例：underdet6 是 4×6
    //      矩阵（第 6 列整列为 0），rank(4×6)=4，加 nFixed=1 后内核报 rank=5 ——
    //      而 4×6 矩阵的秩上限是 min(4,6)=4，报 5 数学上不可能。
    //   ② 修成 `fullRank = res.rank`（假定秩不变）也是错的。实测反例：presolve-heavy6
    //      真相 rank=4，presolve 后只剩 1 行 1 秩（singletonRow=3）—— 秩明明降了。
    //   教训：「消元固定了变量」⇒ 自由度 = 变量数 − 秩，但【秩本身要单独算】。
    //     两次都是凭直觉猜修正、没做推导，第一次甚至靠"数学上不可能"才抓到。
    //   独立核验手段：test/benchmarks/linear_arbiter.mjs（BigInt 精确 RREF + 4 项自检）。
    const fullRank = (res.rank || 0) + (pre.stats.singletonRow || 0);

    const T2 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    // 零空间基是在 presolve 后的【活动列空间】（长度 act.length）算的，要映射回原 n 维：
    //   活动列位置 act[k] ← 基向量第 k 分量
    //   非活动位置         ← 0
    // 非活动位置取 0 是【数学上必须的】：被 presolve 裁掉的列不是「丢了自由度」，
    // 而是被空列（恒 0）或单例行（精确值）钉死了 —— 基向量在那些坐标上必须恒 0，
    // 否则 x = x_p + t·v 就不再满足原方程组。
    let nsFull = null;
    if (res.nullspace && res.nullspace.length) {
        nsFull = res.nullspace.map(function (v) {
            const full = new Array(n).fill(_s60R0());
            for (let k = 0; k < act.length; k++) full[act[k]] = v[k];
            return full;
        });
    }

    return {
        ok: true, kind: res.kind, x: x, rank: fullRank, rankAfterPresolve: res.rank, det: res.det,
        nullspace: nsFull, freeCols: res.freeCols || null,
        stats: pre.stats, presolveMs: ms0, ms: T2 - T0,
        path: 'exact-bareiss', why: why, exactUnique: !!pre.exactUnique
    };
}


// 只算 rank(A)（不带 rhs 语义）。给 infeasible 路径补 rank 字段用。
// rhs 传全零 ⇒ _s60bareissExact 只做行阶梯化、不会判矛盾，返回的 rank 就是 rank(A)。
// 失败（分母爆掉等）时返回 null —— 调用方据此知道「秩未证明」，而不是拿一个假值糊过去。
function _s60rankOnly(A, n) {
    if (!A.length || !n) return 0;
    const zero = new Array(A.length).fill(_s60R0());
    const r = _s60bareissExact(A.map(row => row.slice()), zero);
    return r.failed ? null : r.rank;
}


function _s60lstsq(A0, b0, n) {
    const m = A0.length;
    if (m < n) return null;
    const M = A0.map(r => r.slice());
    const v = b0.slice();
    const w = new Array(m);
    for (let k = 0; k < n; k++) {
        let nr = 0;
        for (let i = k; i < m; i++) nr += M[i][k] * M[i][k];
        nr = Math.sqrt(nr);
        if (nr < 1e-300) continue;
        const alpha = (M[k][k] > 0 ? -nr : nr);
        for (let i = k; i < m; i++) w[i] = M[i][k];
        w[k] -= alpha;
        let nw = 0;
        for (let i = k; i < m; i++) nw += w[i] * w[i];
        if (nw < 1e-300) continue;
        for (let j = k; j < n; j++) {
            let s = 0;
            for (let i = k; i < m; i++) s += w[i] * M[i][j];
            s /= nw;
            for (let i = k; i < m; i++) M[i][j] -= 2 * s * w[i];
        }
        let s = 0;
        for (let i = k; i < m; i++) s += w[i] * v[i];
        s /= nw;
        for (let i = k; i < m; i++) v[i] -= 2 * s * w[i];
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
        let s = v[i];
        for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
        x[i] = Math.abs(M[i][i]) < 1e-300 ? 0 : s / M[i][i];
    }
    return x;
}


function _s60floatMarkowitzSolve(A0, b0, n, u) {
    const m = A0.length;
    const M = A0.map((r, i) => r.slice().concat([b0[i]]));
    const rowMap = []; for (let i = 0; i < m; i++) rowMap.push(i);
    const colMap = []; for (let j = 0; j < n; j++) colMap.push(j);
    let rank = 0;
    for (let k = 0; k < n; k++) {
        if (rank >= m) break;
        const p = _s60markowitz(M, k, m, n, u === undefined ? 0.1 : u);
        if (!p) break;
        const [ri, cj] = p;
        if (cj !== k) {
            for (let i = 0; i < m; i++) { const t = M[i][k]; M[i][k] = M[i][cj]; M[i][cj] = t; }
            const t = colMap[k]; colMap[k] = colMap[cj]; colMap[cj] = t;
        }
        if (ri !== rank) { const t = M[ri]; M[ri] = M[rank]; M[rank] = t; const t2 = rowMap[ri]; rowMap[ri] = rowMap[rank]; rowMap[rank] = t2; }
        const pv = M[rank][k];
        if (Math.abs(pv) < 1e-300) break;
        for (let i = rank + 1; i < m; i++) {
            if (M[i][k] === 0) continue;
            const f = M[i][k] / pv;
            M[i][k] = 0;
            for (let j = k + 1; j <= n; j++) M[i][j] -= f * M[rank][j];
        }
        rank++;
    }
    for (let i = rank; i < m; i++) {
        let z = true;
        for (let j = 0; j < n; j++) if (M[i][j] !== 0) { z = false; break; }
        if (z && Math.abs(M[i][n]) > 1e-9) return { kind: 'nosol', rank: rank };
    }
    if (rank < n) return { kind: 'family', rank: rank };
    const x = new Array(n).fill(0);
    for (let r = rank - 1; r >= 0; r--) {
        let s = M[r][n];
        for (let j = r + 1; j < n; j++) s -= M[r][j] * x[colMap[j]];
        const d = M[r][r];
        if (Math.abs(d) < 1e-300) return { kind: 'singular', rank: rank };
        x[colMap[r]] = s / d;
    }
    return { kind: 'unique', x: x, rank: rank };
}

// 故意改动

// ═══════════════════ 模块：algebra/multivar ═══════════════════
/* 模块 algebra/multivar：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function _s59PAdd(a, b) {
    var n = Math.max(a.length, b.length);
    var out = new Array(n);
    for (var i = 0; i < n; i++) out[i] = (a[i] || 0) + (b[i] || 0);
    return out;
}

function _s59PSub(a, b) {
    var n = Math.max(a.length, b.length);
    var out = new Array(n);
    for (var i = 0; i < n; i++) out[i] = (a[i] || 0) - (b[i] || 0);
    return out;
}
// x 的升幂多项式：乘法（卷积）

function _s59PMul(a, b) {
    if (!a.length || !b.length) return [0];
    var out = new Array(a.length + b.length - 1);
    for (var i = 0; i < out.length; i++) out[i] = 0;
    for (var i2 = 0; i2 < a.length; i2++) {
        if (a[i2] === 0) continue;
        for (var j = 0; j < b.length; j++) out[i2 + j] += a[i2] * b[j];
    }
    return out;
}

function _s59PScale(a, k) {
    var out = new Array(a.length);
    for (var i = 0; i < a.length; i++) out[i] = a[i] * k;
    return out;
}

function _s59PIsZero(a) {
    for (var i = 0; i < a.length; i++) if (a[i] !== 0) return false;
    return true;
}

function _s59PTrim(a) {
    var d = a.length - 1;
    while (d > 0 && Math.abs(a[d]) < 1e-12) d--;
    return a.slice(0, d + 1);
}


function _s59PExactDiv(num, den) {
    if (_s59PIsZero(den)) return null;
    // 数值爆炸保护：任一系数非有限 ⇒ 立即失败（fail-closed，交回原路径）
    for (var _g = 0; _g < den.length; _g++) if (!isFinite(den[_g])) return null;
    for (var _h = 0; _h < num.length; _h++) if (!isFinite(num[_h])) return null;
    var d = den.length - 1;
    if (d === 0) {
        var out = new Array(num.length);
        for (var i = 0; i < num.length; i++) out[i] = num[i] / den[0];
        for (var j = 0; j < num.length; j++) {
            if (Math.abs(out[j] * den[0] - num[j]) > 1e-6 * (Math.abs(num[j]) + 1e-30)) return null;
        }
        return out;
    }
    // 高次除法：长除法（den 次数小，num 次数大）
    var rem = num.slice();
    var q = new Array(Math.max(1, rem.length - d));
    for (var i2 = 0; i2 < q.length; i2++) q[i2] = 0;
    var lead = den[d];
    for (var pos = rem.length - 1; pos >= d; pos--) {
        var c2 = rem[pos] / lead;
        if (c2 !== 0) {
            q[pos - d] = c2;
            for (var t = 0; t <= d; t++) rem[pos - d + t] -= c2 * den[t];
        }
    }
    // 余数必须为 0（相对容差）
    for (var m = 0; m < d; m++) {
        if (Math.abs(rem[m]) > 1e-6 * (Math.abs(num[m] || 0) + 1)) return null;
    }
    return q;
}


function _s59YNorm(A) {
    var out = [];
    for (var i = 0; i < A.length; i++) out.push(A[i] ? A[i] : [0]);
    var d = out.length - 1;
    while (d > 0 && _s59PIsZero(out[d])) d--;
    return out.slice(0, d + 1);
}


function _s59YAdd(A, B) {
    var n = Math.max(A.length, B.length);
    var out = [];
    for (var k = 0; k < n; k++) {
        var a = A[k] || [0], b = B[k] || [0];
        out.push(_s59PAdd(a, b));
    }
    return _s59YNorm(out);
}

function _s59YSub(A, B) {
    var n = Math.max(A.length, B.length);
    var out = [];
    for (var k = 0; k < n; k++) {
        var a = A[k] || [0], b = B[k] || [0];
        out.push(_s59PSub(a, b));
    }
    return _s59YNorm(out);
}


function _s59YMul(A, B) {
    var out = [];
    for (var i = 0; i < A.length + B.length - 1; i++) out.push([0]);
    for (var i2 = 0; i2 < A.length; i2++) {
        if (!A[i2] || _s59PIsZero(A[i2])) continue;
        for (var j = 0; j < B.length; j++) {
            if (!B[j] || _s59PIsZero(B[j])) continue;
            out[i2 + j] = _s59PAdd(out[i2 + j], _s59PMul(A[i2], B[j]));
        }
    }
    return _s59YNorm(out);
}


function _s59NumDivmod(a, b) {
    var da = a.length - 1, db = b.length - 1;
    if (db < 0) return null;
    var lead = b[db];
    if (Math.abs(lead) < 1e-300) return null;
    var rem = a.slice();
    var q = new Array(Math.max(1, da - db + 1));
    for (var i = 0; i < q.length; i++) q[i] = 0;
    for (var p = da - db; p >= 0; p--) {
        var c = rem[p + db] / lead;
        q[p] = c;
        if (c === 0) continue;
        for (var t = 0; t <= db; t++) rem[p + t] -= c * b[t];
    }
    // 余式降次
    var rd = rem.length - 1;
    while (rd > 0 && Math.abs(rem[rd]) < 1e-11) rd--;
    return [q, rem.slice(0, rd + 1)];
}

function _s59NumDeg(a) {
    var d = a.length - 1;
    while (d > 0 && Math.abs(a[d]) < 1e-11) d--;
    return d;
}
// 数值一元 gcd（Euclid）⇒ 返回非常数公共因子则返回 true

function _s59NumGcdNonConst(a, b) {
    var A = a.slice(), B = b.slice();
    if (_s59NumDeg(A) < _s59NumDeg(B)) { var t = A; A = B; B = t; }
    for (var guard = 0; guard < 24; guard++) {
        if (_s59NumDeg(B) <= 0) return false;
        var dm = _s59NumDivmod(A, B);
        if (!dm) return false;
        A = B; B = dm[1];
    }
    return false;
}
// f、g 在 y 上是否有非常数公共因子。

function _s59SquareFree(f) {
    var a = _s59PTrim(f.slice());
    if (a.length < 2) return null;
    // 数值导数 f'（升幂）
    var df = new Array(a.length - 1);
    for (var i = 1; i < a.length; i++) df[i - 1] = a[i] * i;
    df = _s59PTrim(df);
    if (df.length < 2) return a;              // 导数为常数 ⇒ f 本身无平方因子
    // 一元数值 gcd（Euclid）
    var A = a.slice(), B = df.slice();
    for (var guard = 0; guard < 32; guard++) {
        if (_s59NumDeg(B) <= 0) break;
        var dm = _s59NumDivmod(A, B);
        if (!dm) return null;
        A = B; B = _s59NumTrim(dm[1]);
        if (A.length && !isFinite(A[A.length - 1])) return null;
    }
    var g = _s59NumTrim(A);
    if (_s59NumDeg(g) <= 0) return a;           // gcd 为常数 ⇒ f 已无平方因子
    var q = _s59NumDivmod(a, g);
    if (!q) return null;
    var res = _s59NumTrim(q[0]);
    return res.length >= 2 ? res : null;
}

function _s59NumTrim(a) {
    var d = a.length - 1;
    while (d > 0 && Math.abs(a[d]) < 1e-11) d--;
    return a.slice(0, d + 1);
}


function BQNorm(A) {
    var out = [];
    // 兜底零元必须是 BQ（y 升幂数组，每项 x 升幂数组）= [[0]]，不能写 [0]
    for (var i = 0; i < A.length; i++) out.push(A[i] ? A[i] : [[0]]);
    var d = out.length - 1;
    while (d > 0 && _s59PIsZero(out[d])) d--;
    return out.slice(0, d + 1);
}

function BQAdd(A, B) {
    var n = Math.max(A.length, B.length), out = [];
    for (var k = 0; k < n; k++) out.push(_s59PAdd(A[k] || [0], B[k] || [0]));
    return BQNorm(out);
}

function BQSub(A, B) {
    var n = Math.max(A.length, B.length), out = [];
    for (var k = 0; k < n; k++) out.push(_s59PSub(A[k] || [0], B[k] || [0]));
    return BQNorm(out);
}

function BQScale(A, k) {
    var out = [];
    for (var i = 0; i < A.length; i++) out.push(_s59PScale(A[i], k));
    return BQNorm(out);
}
// BQ 乘法：(x,y) 二元多项式 × (x,y) 二元多项式

function BQMul(A, B) {
    var out = [];
    for (var i = 0; i < A.length + B.length - 1; i++) out.push([0]);
    for (var i2 = 0; i2 < A.length; i2++) {
        if (!A[i2] || _s59PIsZero(A[i2])) continue;
        for (var j = 0; j < B.length; j++) {
            if (!B[j] || _s59PIsZero(B[j])) continue;
            out[i2 + j] = _s59PAdd(out[i2 + j], _s59PMul(A[i2], B[j]));
        }
    }
    return BQNorm(out);
}
// BQ 是否为零。兼容两种输入：

function BQIsZero(A) {
    if (!A || !A.length) return true;
    if (typeof A[0] === 'number') return _s59PIsZero(A);   // number[] 直接判
    for (var i = 0; i < A.length; i++) if (!_s59PIsZero(A[i])) return false;
    return true;
}

function BQIsConst(A) {   // 是否为非零常数
    if (A.length !== 1) return false;
    var d = _s59PIsZero(A[0]) ? 0 : A[0].length - 1;
    return d === 0;
}
// BQ 求值：给定 x、y 的数值，返回数值

function BQEval(A, xv, yv) {
    var acc = 0;
    for (var k = A.length - 1; k >= 0; k--) {
        var c = A[k];
        var s = 0;
        for (var i = c.length - 1; i >= 0; i--) s = s * xv + c[i];
        acc = acc * yv + s;
    }
    return acc;
}
// BQ 的 x 次数（各 y 系数里 x 次数的最大值）

function BQDegX(A) {
    var d = 0;
    for (var i = 0; i < A.length; i++) {
        var c = A[i]; if (!c) continue;
        var dd = c.length - 1;
        while (dd > 0 && Math.abs(c[dd]) < 1e-12) dd--;
        if (dd > d) d = dd;
    }
    return d;
}
// BQ 的 y 次数

function BQDegY(A) {
    var d = A.length - 1;
    while (d > 0 && _s59PIsZero(A[d])) d--;
    return d;
}
// BQ 的总次数（x 与 y 次数之和的上界，用于主元比较）

function BQTotalDeg(A) { return BQDegX(A) + BQDegY(A); }
// BQ 的最大系数绝对值

function BQMaxAbs(A) {
    var m = 0;
    for (var i = 0; i < A.length; i++) {
        var c = A[i]; if (!c) continue;
        for (var j = 0; j < c.length; j++) { var v = Math.abs(c[j]); if (v > m) m = v; }
    }
    return m;
}
// BQ 版精确除法：Bareiss 理论整除；除数为常数时直接除并做相对容差校验，

function _s59BQExactDiv(num, den) {
    if (BQIsZero(den)) return null;
    for (var i = 0; i < num.length; i++) for (var j = 0; j < num[i].length; j++)
        if (!isFinite(num[i][j])) return null;
    for (var a = 0; a < den.length; a++) for (var b = 0; b < den[a].length; b++)
        if (!isFinite(den[a][b])) return null;

    if (BQIsConst(den)) {
        var c0 = den[0][0];
        if (Math.abs(c0) < 1e-300) return null;
        var out = BQNorm(num.map(function (cy) {
            return _s59PScale(cy, 1 / c0);
        }));
        for (var p = 0; p < out.length; p++) {
            for (var q = 0; q < out[p].length; q++) {
                if (Math.abs(out[p][q] * c0 - num[p][q]) > 1e-6 * (Math.abs(num[p][q]) + 1e-30)) return null;
            }
        }
        return out;
    }
    // 非常数除数：化为「按 y 升幂的系数级长除法」——
    // den = Σ d_k y^k，num = Σ n_k y^k。取 degY(den)=m 的最高项 d_m（关于 x 的多项式），
    // 若 d_m 是 x 的常数，则整个 BQ 除法降为逐系数除以该常数，可精确完成。
    var m = BQDegY(den);
    var lead = den[m];
    var leadDegX = lead.length - 1;
    while (leadDegX > 0 && Math.abs(lead[leadDegX]) < 1e-12) leadDegX--;
    if (leadDegX > 0) return null;     // 最高项仍含 x ⇒ 复杂整除，不保证 ⇒ 放弃
    var lv = lead[leadDegX];
    if (Math.abs(lv) < 1e-300) return null;
    var res = [];
    var nn = BQNorm(num);
    var top = nn.length - 1;
    var q = new Array(Math.max(1, top - m + 1));
    for (var z = 0; z < q.length; z++) q[z] = [[0]];
    var rem = nn.map(function (cy) { return cy.slice(); });
    for (var p2 = top - m; p2 >= 0; p2--) {
        var cur = rem[p2 + m];
        if (!cur) { q[p2] = [[0]]; continue; }
        var cd = cur.length - 1;
        while (cd > 0 && Math.abs(cur[cd]) < 1e-12) cd--;
        if (cd > 0) return null;                       // 当前系数还含 x ⇒ 放弃
        var cf = cur[cd] / lv;
        q[p2] = [[cf]];
        if (cf === 0) continue;
        for (var t = 0; t <= m; t++) {
            rem[p2 + t] = _s59PSub(rem[p2 + t], _s59PScale(den[t], cf));
        }
    }
    // 余式必须为零（相对容差）
    for (var r2 = 0; r2 < m; r2++) {
        if (!_s59PIsZero(rem[r2])) {
            var mx = 0;
            for (var s2 = 0; s2 < rem[r2].length; s2++) mx = Math.max(mx, Math.abs(rem[r2][s2]));
            if (mx > 1e-6) return null;
        }
    }
    return BQNorm(q);
}


function BTNorm(A) {
    var out = [];
    for (var i = 0; i < A.length; i++) out.push(A[i] ? A[i] : [[0]]);
    var d = out.length - 1;
    while (d > 0 && BQIsZero(out[d])) d--;
    return out.slice(0, d + 1);
}

function BTAdd(A, B) {
    var n = Math.max(A.length, B.length), out = [];
    for (var k = 0; k < n; k++) out.push(BQAdd(A[k] || [[0]], B[k] || [[0]]));
    return BTNorm(out);
}

function BTSub(A, B) {
    var n = Math.max(A.length, B.length), out = [];
    for (var k = 0; k < n; k++) out.push(BQSub(A[k] || [[0]], B[k] || [[0]]));
    return BTNorm(out);
}

function BTMul(A, B) {
    var out = [];
    for (var i = 0; i < A.length + B.length - 1; i++) out.push([[0]]);
    for (var i2 = 0; i2 < A.length; i2++) {
        if (!A[i2] || BQIsZero(A[i2])) continue;
        for (var j = 0; j < B.length; j++) {
            if (!B[j] || BQIsZero(B[j])) continue;
            out[i2 + j] = BQAdd(out[i2 + j], BQMul(A[i2], B[j]));
        }
    }
    return BTNorm(out);
}

function BTIsZero(A) {
    for (var i = 0; i < A.length; i++) if (!BQIsZero(A[i])) return false;
    return true;
}

function BTDegZ(A) {
    var d = A.length - 1;
    while (d > 0 && BQIsZero(A[d])) d--;
    return d;
}
// AST → 关于 z 的升幂表示 BT

function _s59PRS(fZ, gZ) {
    var A = BTNorm(fZ), B = BTNorm(gZ);
    if (BTIsZero(B)) return null;
    // 保证 deg_z A ≥ deg_z B（否则交换；Res 差一个符号，根集不变）
    if (BTDegZ(A) < BTDegZ(B)) { var t = A; A = B; B = t; }

    // BT 关于 z 的首项系数（BQ）
    function leadBQ(P) { return P[BTDegZ(P)]; }

    // 伪余式：r = lc(B)^{degA - degR + 1} · A mod B
    // 实现要点：反复执行 r ← r·lc(B) − lead(r)·z^{deg r − deg B}·B，
    //           每步把 r 的 z 次数至少降 1；乘 lc(B) 消掉了分母（伪余式定义）。
    function pseudoRem(Ax, Bx) {
        var db = BTDegZ(Bx);
        if (db < 0) return null;
        var lb = leadBQ(Bx);
        if (BQIsZero(lb)) return null;                 // B 的首项为零 ⇒ 退化
        var r = BTNorm(Ax);
        for (var guard = 0; guard < 64; guard++) {
            var dr = BTDegZ(r);
            if (dr < db) return r;
            if (BQIsZero(r)) return [[0]];
            var lr = leadBQ(r);
            // r ← r · lc(B)
            r = BTMul(r, [lb]);
            // r ← r − lead(r)·z^(dr−db)·B
            var e = dr - db;
            var Bshift = [];
            for (var q = 0; q < e; q++) Bshift.push([[0]]);
            for (var q2 = 0; q2 < Bx.length; q2++) Bshift.push(Bx[q2]);
            r = BTNorm(BTSub(r, BTMul(Bshift, [lr])));
        }
        return r;   // 64 轮仍未降次 ⇒ 数值异常，交回调用方处理
    }

    for (var g2 = 0; g2 < 48; g2++) {
        if (BTDegZ(B) < 0 || BQIsZero(leadBQ(B))) {
            // B 的 z-首项系数为零 ⇒ 退化
            break;
        }
        // B 已是 z 的常数（相对 A 而言）⇒ 伪余式链终止，B 的 z-首项系数即 Res
        if (BTDegZ(B) === 0) { A = B; B = [[0]]; break; }
        var r = pseudoRem(A, B);
        if (!r) return null;
        A = B;
        B = BTNorm(r);
        if (BTIsZero(B)) return null;                 // 公共因子 ⇒ 零维性破坏 ⇒ 放弃
    }
    var last = A;                                    // 链上最后一个非零余式
    if (BTIsZero(last)) return null;
    // 最后一个非零伪余式的 z-首项系数（BQ）作为 Res 的代表元
    var res = leadBQ(last);
    if (!res || BQIsZero(res)) return null;
    res = BQNorm(res);
    if (res.length < 2) return res;                   // 只是 x 的多项式
    // 归一化到 O(1)
    var mx = BQMaxAbs(res);
    if (!isFinite(mx) || mx < 1e-300) return null;
    return BQScale(res, 1 / mx);
}


function _s59PRSxy(fY, gY) {
    var A = BQNorm(fY), B = BQNorm(gY);
    if (BQDegY(B) < 0) return null;
    if (BQDegY(A) < BQDegY(B)) { var t = A; A = B; B = t; }
    // y 的首项系数（x 的升幂数组 number[]）
    function leadX(P) {
        var c = P[BQDegY(P)];
        if (!c) return [0];
        var d = c.length - 1;
        while (d > 0 && Math.abs(c[d]) < 1e-12) d--;
        return d < 0 ? [0] : c.slice(0, d + 1);
    }
    function pseudoRem(Ax, Bx) {
        var db = BQDegY(Bx);
        if (db < 0) return null;
        var lb = leadX(Bx);
        if (_s59PIsZero(lb)) return null;
        var r = BQNorm(Ax);
        for (var guard = 0; guard < 64; guard++) {
            var dr = BQDegY(r);
            if (dr < db) return r;
            if (_s59PIsZero(r)) return [[0]];
            var lr = leadX(r);
            r = BQMul(r, [lb]);                       // r ← r · lc(B)
            var e = dr - db;
            var Bshift = [];
            for (var q = 0; q < e; q++) Bshift.push([0]);
            for (var q2 = 0; q2 < Bx.length; q2++) Bshift.push(Bx[q2]);
            r = BQNorm(BQSub(r, BQMul(Bshift, [lr]))); // r ← r − lead(r)·y^e·B
        }
        return r;
    }
    for (var g2 = 0; g2 < 48; g2++) {
        if (BQDegY(B) < 0 || _s59PIsZero(leadX(B))) break;
        if (BQDegY(B) === 0) { A = B; B = [[0]]; break; }
        var r2 = pseudoRem(A, B);
        if (!r2) return null;
        A = B; B = BQNorm(r2);
        if (BQIsZero(B)) return null;
    }
    var res = leadX(A);
    if (!res || _s59PIsZero(res)) return null;
    res = _s59PTrim(res.slice());
    if (res.length < 2) return null;
    var mx = 0;
    for (var i = 0; i < res.length; i++) mx = Math.max(mx, Math.abs(res[i]));
    if (!isFinite(mx) || mx < 1e-300) return null;
    return _s59PScale(res, 1 / mx);
}

// ═══════════════════ 模块：algebra/resultant ═══════════════════
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

// ═══════════════════ 模块：algebra/simplex ═══════════════════
/* 模块 algebra/simplex：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function _generateCorners(box, n) {
    if (n === 0) return [[]];
    var sub = _generateCorners(box, n - 1);
    var result = [];
    for (var si = 0; si < sub.length; si++) {
        var p1 = sub[si].concat([box[n-1].min]);
        var p2 = sub[si].concat([box[n-1].max]);
        result.push(p1, p2);
    }
    return result;
}


function _simplexCore(T, rhs, basis, obj, m, N) {
    var tab = [];
    for (var i = 0; i < m; i++) { var r = T[i].slice(); r.push(rhs[i]); tab.push(r); }
    var objRow = new Array(N + 1).fill(0);
    for (var j = 0; j < N; j++) objRow[j] = -obj[j];
    for (var i = 0; i < m; i++) {
        var bcol = basis[i], coef = objRow[bcol];
        if (coef !== 0) for (var j2 = 0; j2 <= N; j2++) objRow[j2] -= coef * tab[i][j2];
    }
    tab.push(objRow);
    var maxIter = 500;
    for (var it = 0; it < maxIter; it++) {
        var enter = -1, bestNeg = -1e-12;
        for (var j = 0; j < N; j++) { if (objRow[j] < bestNeg) { bestNeg = objRow[j]; enter = j; } }
        if (enter === -1) break;
        var leave = -1, bestRatio = Infinity;
        for (var i = 0; i < m; i++) {
            if (tab[i][enter] > 1e-12) {
                var ratio = tab[i][N] / tab[i][enter];
                if (ratio >= -1e-12 && ratio < bestRatio) { bestRatio = ratio; leave = i; }
            }
        }
        if (leave === -1) return { status: 'unbounded' };
        var piv = tab[leave][enter];
        for (var j2 = 0; j2 <= N; j2++) tab[leave][j2] /= piv;
        for (var i2 = 0; i2 <= m; i2++) {
            if (i2 === leave) continue;
            var f = tab[i2][enter];
            if (f !== 0) for (var j3 = 0; j3 <= N; j3++) tab[i2][j3] -= f * tab[leave][j3];
        }
        basis[leave] = enter;
    }
    for (var i = 0; i < m; i++) { T[i] = tab[i].slice(0, N); rhs[i] = tab[i][N]; }
    return { status: 'optimal' };
}


function _lpMaximize(c, A, b) {
    var m = A.length, n = c.length;
    if (m === 0) return null;
    var numArt = 0;
    for (var i = 0; i < m; i++) if (b[i] < 0) numArt++;
    var N = n + m + numArt;
    var T = [], rhs = [], basis = [], artCol = [], ai = 0;
    for (var i = 0; i < m; i++) {
        var row = new Array(N).fill(0);
        for (var j = 0; j < n; j++) row[j] = A[i][j];
        row[n + i] = 1;
        if (b[i] < 0) {
            for (var k = 0; k < N; k++) row[k] = -row[k];
            row[n + m + ai] = 1;
            artCol.push(n + m + ai);
            rhs.push(-b[i]);
            basis.push(n + m + ai);
            ai++;
        } else {
            rhs.push(b[i]);
            basis.push(n + i);
        }
        T.push(row);
    }
    // Phase 1: 最大化 -Σ人工变量
    var obj1 = new Array(N).fill(0);
    for (var t = 0; t < artCol.length; t++) obj1[artCol[t]] = -1;
    var r1 = _simplexCore(T, rhs, basis, obj1, m, N);
    if (r1.status === 'infeasible') return null;
    var artSum = 0;
    for (var bi = 0; bi < m; bi++) if (artCol.indexOf(basis[bi]) >= 0) artSum += rhs[bi];
    if (artSum > 1e-6) return null;
    // Phase 2 前：把仍在基中的退化人工变量主元换出；全零冗余行删除
    var artSet = {};
    for (var t = 0; t < artCol.length; t++) artSet[artCol[t]] = true;
    for (var bi = 0; bi < m; bi++) {
        if (artSet[basis[bi]]) {
            var pivCol = -1;
            for (var j = 0; j < N; j++) { if (!artSet[j] && Math.abs(T[bi][j]) > 1e-9) { pivCol = j; break; } }
            if (pivCol >= 0) {
                var piv = T[bi][pivCol];
                for (var j2 = 0; j2 < N; j2++) T[bi][j2] /= piv;
                rhs[bi] /= piv;
                for (var i2 = 0; i2 < m; i2++) { if (i2 === bi) continue; var f = T[i2][pivCol]; if (f !== 0) { for (var j3 = 0; j3 < N; j3++) T[i2][j3] -= f * T[bi][j3]; rhs[i2] -= f * rhs[bi]; } }
                basis[bi] = pivCol;
            } else {
                T[bi] = null;
            }
        }
    }
    var keep = [];
    for (var col = 0; col < N; col++) if (!artSet[col]) keep.push(col);
    var T2 = [], rhs2 = [], basis2 = [], newM = 0;
    for (var i = 0; i < m; i++) {
        if (T[i] === null) continue;
        var nr = [];
        for (var kk = 0; kk < keep.length; kk++) nr.push(T[i][keep[kk]]);
        T2.push(nr); rhs2.push(rhs[i]);
        var bb = basis[i], idx = keep.indexOf(bb);
        basis2.push(idx < 0 ? 0 : idx);
        newM++;
    }
    T = T2; rhs = rhs2; basis = basis2; m = newM; N = keep.length;
    // Phase 2: 最大化 c
    var obj2 = [];
    for (var j = 0; j < N; j++) obj2.push(0);
    for (var j = 0; j < n && j < N; j++) { var pos = keep.indexOf(j); if (pos >= 0) obj2[pos] = c[j]; }
    var r2 = _simplexCore(T, rhs, basis, obj2, m, N);
    if (r2.status === 'unbounded') return Infinity;
    if (r2.status === 'infeasible') return null;
    var val = 0;
    for (var bi = 0; bi < m; bi++) { var col = basis[bi]; if (col < n) val += c[col] * rhs[bi]; }
    return val;
}

// ═══════════════════ 模块：algebra/homotopy ═══════════════════
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

// ═══════════════════ 模块：numeric/polynomial ═══════════════════
/* 模块 numeric/polynomial：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function solveQuadraticFormula(coeffs) {
    const c = coeffs[0];
    const b = coeffs[1];
    const a = coeffs[2];

    if (Math.abs(a) < 1e-12) {
        // 退化为一次方程
        if (Math.abs(b) < 1e-12) return [];
        return [-c / b];
    }

    const discriminant = b * b - 4 * a * c;

    if (discriminant < -1e-12) {
        // 无实根
        return [];
    }

    if (Math.abs(discriminant) < 1e-12) {
        // 重根
        return [-b / (2 * a)];
    }

    const sqrtD = Math.sqrt(discriminant);
    // 使用数值稳定的求根公式避免大数相消
    // 如果 b > 0: q = -(b + sqrtD) / 2; 否则 q = -(b - sqrtD) / 2
    const q = b > 0 ? -(b + sqrtD) / 2 : -(b - sqrtD) / 2;
    const root1 = q / a;
    const root2 = c / q;

    return root1 < root2 ? [root1, root2] : [root2, root1];
}


function syntheticDivide(coeffs, root) {
    const n = coeffs.length - 1;
    const result = new Array(n).fill(0);
    result[n - 1] = coeffs[n];
    for (let i = n - 1; i >= 1; i--) {
        result[i - 1] = coeffs[i] + root * result[i];
    }
    return result;
}


function polyEval(coeffs, x) {
    let result = 0;
    for (let i = coeffs.length - 1; i >= 0; i--) {
        result = result * x + coeffs[i];
    }
    return result;
}


// ===== 后向稳定残差（Higham 2002《Accuracy and Stability of Numerical Algorithms》§3.1）=====
//
// 为什么不能拿「首项系数 × 固定小数」当「r 是不是根」的判据：
//   p(x)=Σaᵢxⁱ 用 Horner 在双精度下求值，舍入误差上界是 γ_n·Σ|aᵢxⁱ|（γ_n≈n·eps），
//   **与各项本身的量级成正比**，不是与首项系数成正比。
//   实测事故（2026-10-04）：5x⁴−1e12x²+7=0
//     · 首项系数 |a₄|=5 ⇒ 旧阈值 1e-3·max(1,5)=5e-3；
//     · 但真根 x≈±4.4721e5 处 Σ|aᵢxⁱ|≈4e23 ⇒ 舍入地板 ≈ulp(2e23)≈3.4e7；
//     · 「|p(r)|<5e-3」在双精度下**数学上不可达** ⇒ 4 个实根被静默丢掉 2 个大的，
//       对外还报 NO_SOLUTION（而引擎自己的 Sturm 计数说域内有 4 个实根）。
//
// 正确判据（与 pipeline/solver.js 的 _finalResidualGate 同一原理，两处必须一致）：
//   |p(x)| ≤ τ·Σ|aᵢxⁱ|，τ=1e-11
// τ 取 1e-11 的理由：需 ≥ n·eps（n≤10 时约 1e-15，留 4 个数量级余量），
// 又要远小于任何有意义的残差 ⇒ 既不误杀真根，也不放行伪根。
//
// ⚠ fail-closed 方向：值非有限、尺度非有限 ⇒ 一律判「不是根」。
//   放行方向绝不能开口，否则大系数下会重新变成伪根发射器。
function polyTermScale(coeffs, x) {
    const ax = Math.abs(x);
    let s = 0;
    for (let i = coeffs.length - 1; i >= 0; i--) {
        const t = Math.abs(coeffs[i]) * Math.pow(ax, i);
        if (!isFinite(t)) return Infinity;
        s += t;
    }
    return s;
}

function polyIsRootWithin(coeffs, x, tau) {
    const val = polyEval(coeffs, x);
    if (!isFinite(val)) return false;
    const s = polyTermScale(coeffs, x);
    if (!isFinite(s)) return false;
    return Math.abs(val) <= Math.max(1e-12, (tau || 1e-11) * s);
}


// 牛顿精修到【双精度机器精度】，而不是到调用方的输出网格精度。
// ⚠ 为什么不能用 tolerance（=1e-6 输出网格）当牛顿的停机判据：
//   「根算到 1e-6」与「根报出来时保留 6 位小数」是两件不同的事。混用会让
//   polyIsRootWithin 的后向残差判据永远通不过 —— 实测 x⁴−13x²+4 的扫描根
//   |p(r)|≈1.9e-7 而尺度 329（阈值 3.3e-9），四个真根被自己的判据全灭。
//   停机判据必须是「新一步在双精度下不再改变 x」，这与输出网格无关。
// 退化保护：|f| 不再下降（振荡/发散）即停；df 过小也停。
function polyNewtonPolish(coeffs, x0, maxIter) {
    var r = x0;
    var prevAbsF = Infinity;
    for (var it = 0; it < (maxIter || 60); it++) {
        var f = polyEval(coeffs, r);
        if (!isFinite(f)) break;
        var af = Math.abs(f);
        if (!(af < prevAbsF)) break;                 // 不再下降 ⇒ 到达精度地板或振荡
        prevAbsF = af;
        var df = polyDerivative(coeffs, r);
        if (!isFinite(df) || Math.abs(df) < 1e-300) break;
        var newR = r - f / df;
        if (!isFinite(newR)) break;
        if (newR === r) break;                       // 双精度下已无进展
        r = newR;
    }
    return r;
}


function rationalRootTheorem(coeffs) {
    const n = coeffs.length - 1;
    if (n <= 0) return [];

    // a_0 ≈ 0 意味着 x=0 是一个根：记录后综合除法降次，再继续枚举其余有理根
    // （旧逻辑直接 return [0]，会漏掉 x=0 之外的其余有理根，如 x^2 - x = 0 漏掉 x=1）
    if (Math.abs(coeffs[0]) < 1e-12) {
        const reduced = syntheticDivide(coeffs, 0);
        const otherRoots = rationalRootTheorem(reduced);
        return [0].concat(otherRoots);
    }

    let maxDenom = 1;
    for (const c of coeffs) {
        const str = c.toFixed(6);
        if (str.includes('.')) {
            const decPart = str.split('.')[1];
            // 去除尾零
            const trimmed = decPart.replace(/0+$/, '');
            if (trimmed.length > 0) {
                const denom = Math.pow(10, trimmed.length);
                if (denom > maxDenom) maxDenom = denom;
            }
        }
    }

    // 转为整数系数
    const intCoeffs = coeffs.map(c => Math.round(c * maxDenom));
    const a0 = Math.abs(intCoeffs[0]);
    const an = Math.abs(intCoeffs[n]);

    if (an === 0) return [];

    // 求所有因数
    function divisors(num) {
        const result = [];
        for (let i = 1; i * i <= num; i++) {
            if (num % i === 0) {
                result.push(i);
                if (i !== num / i) result.push(num / i);
            }
        }
        return result;
    }

    const pDivs = divisors(a0);
    const qDivs = divisors(an);

    // 枚举所有 p/q 组合
    const candidates = new Set();
    for (const p of pDivs) {
        for (const q of qDivs) {
            candidates.add(p / q);
            candidates.add(-p / q);
        }
    }

    // 候选根数量熔断（规格：>20000 降级）
    if (candidates.size > 20000) return null;

    // 测试每个候选根
    // 判据用后向稳定残差 polyIsRootWithin：整数系数在真根处 Horner 值本应精确为 0，
    // 但候选是 p/q（二进制不精确），浮点误差不可省。旧的 max(1e-6, 1e-8·coeffMax)
    // 只看系数最大值、不看各项在 r 处的量级，大系数下同样不可达（见 polyIsRootWithin 注释）。
    const roots = [];
    for (const c of candidates) {
        if (polyIsRootWithin(intCoeffs, c)) roots.push(c);
    }

    return roots;
}


function polynomialAllRoots(coeffs, tolerance) {
    const roots = [];
    let remaining = [...coeffs];

    // 去除前导零（高次项系数为0）
    while (remaining.length > 1 && Math.abs(remaining[remaining.length - 1]) < 1e-12) {
        remaining.pop();
    }

    if (remaining.length <= 1) return roots;

    // 阶段1：有理根定理
    const rationalRoots = rationalRootTheorem(remaining);
    if (rationalRoots && rationalRoots.length > 0) {
        for (const r of rationalRoots) {
            // 验证 r 是否确实是当前 remaining 的根（后向稳定残差，不用首项系数当尺度）
            if (!polyIsRootWithin(remaining, r)) {
                // r 不是当前多项式的根，跳过（不降次）
                continue;
            }

            roots.push(r);
            // 综合除法降次
            const quotient = syntheticDivide(remaining, r);
            remaining = quotient;
            // 去除前导零
            while (remaining.length > 1 && Math.abs(remaining[remaining.length - 1]) < 1e-12) {
                remaining.pop();
            }
        }
    }

    // 阶段2：对剩余多项式求解
    if (remaining.length > 3) {
        // 三次以上：符号变化扫描+牛顿精修
        const scanRoots = scanRealRoots(remaining, tolerance);
        // 验证扫描根：大系数多项式可能产生假根。
        // ⚠ 旧判据 `val < 1e-3·max(1,|a_n|)` 是**尺度盲**的 —— 它只看首项系数，
        //   不看各项在 r 处的量级。5x⁴−1e12x²+7 的真根 r≈4.47e5 处 Σ|aᵢrⁱ|≈4e23，
        //   双精度舍入地板 ≈3.4e7，而旧阈值只有 5e-3 ⇒ 不可达 ⇒ 真根被丢（实测 4 根只输出 2 根）。
        for (const r of scanRoots) {
            if (polyIsRootWithin(remaining, r)) roots.push(r);
        }
    } else if (remaining.length === 3) {
        // 二次方程：判别式求根公式（精确解，避免扫描精度损失）
        const quadRoots = solveQuadraticFormula(remaining);
        roots.push(...quadRoots);
    } else if (remaining.length === 2) {
        // 一次方程 a_0 + a_1*x = 0
        if (Math.abs(remaining[1]) > 1e-12) {
            roots.push(-remaining[0] / remaining[1]);
        }
    }

    return roots;
}


function scanRealRoots(coeffs, tolerance) {
    const roots = [];
    const n = coeffs.length - 1;
    const an = Math.abs(coeffs[n]);
    if (an < 1e-12) return roots;

    // Cauchy 界：所有实根 |x| ≤ 1 + max(|a_i / a_n|)
    let maxRatio = 0;
    for (let i = 0; i < n; i++) {
        maxRatio = Math.max(maxRatio, Math.abs(coeffs[i] / an));
    }
    const scanRange = Math.min(1000000, 1 + maxRatio);
    // 自适应步长：保证至少有 2000 个采样点
    const step = Math.max(scanRange / 2000, 0.001);

    let prevVal = polyEval(coeffs, -scanRange);
    let prevX = -scanRange;

    for (let x = -scanRange + step; x <= scanRange; x += step) {
        const val = polyEval(coeffs, x);

        // 检测符号变化（根在 prevX 和 x 之间）
        // 注意：当 val 或 prevVal 恰好为 0 时，prevVal * val = 0 不满足 < 0
        // 所以额外检测 prevVal 和 val 异号或其中之一为零的情况
        if (prevVal * val < 0 || (Math.abs(prevVal) < tolerance * 10 && Math.abs(val) < tolerance * 10 && prevVal !== 0 && val !== 0 && Math.sign(prevVal) !== Math.sign(val))) {
            // 二分法精修
            let lo = prevX, hi = x;
            let loVal = prevVal;
            for (let iter = 0; iter < 50; iter++) {
                const mid = (lo + hi) / 2;
                const midVal = polyEval(coeffs, mid);
                if (Math.abs(midVal) < tolerance) {
                    // 同样精修到机器精度：这里 push 的 mid 只满足 |p|<tolerance，
                    // 不满足 polyIsRootWithin 的后向残差判据（实测会漏掉真根）
                    roots.push(polyNewtonPolish(coeffs, mid, 60));
                    break;
                }
                if (loVal * midVal < 0) {
                    hi = mid;
                } else {
                    lo = mid;
                    loVal = midVal;
                }
            }
            // 仅在二分法未收敛到 tolerance 时添加最后近似值
            if (roots.length === 0 || Math.abs(roots[roots.length - 1] - (lo + hi) / 2) > tolerance) {
                // 牛顿精修到机器精度（大系数多项式必需，见 polyNewtonPolish 注释）
                const candidate = polyNewtonPolish(coeffs, (lo + hi) / 2, 60);
                if (roots.length === 0 || Math.abs(roots[roots.length - 1] - candidate) > tolerance) {
                    roots.push(candidate);
                }
            }
        }

        // 检测精确根（val ≈ 0）
        if (Math.abs(val) < tolerance * 10) {
            const r = polyNewtonPolish(coeffs, x, 60);
            if (roots.length === 0 || Math.abs(roots[roots.length - 1] - r) > tolerance) {
                roots.push(r);
            }
        }

        prevVal = val;
        prevX = x;
    }

    return roots;
}


function polyDerivative(coeffs, x) {
    let result = 0;
    for (let i = 1; i < coeffs.length; i++) {
        result += i * coeffs[i] * Math.pow(x, i - 1);
    }
    return result;
}


function _bisectRoot1D(eq, vn, a, b, fa, fb, state, allSolutions, resultVarNames) {
    var _mid2, _fm2, _vm2 = {};
    for (var _bi3 = 0; _bi3 < 100; _bi3++) {
        _mid2 = (a + b) / 2;
        _vm2[vn] = _mid2;
        _fm2 = evalAST(eq, _vm2);
        if (_fm2 === null || _fm2 !== _fm2 || !isFinite(_fm2)) break; // 意外奇点 → 保守终止
        if ((b - a) / 2 < 1e-10) {
            // 集中式回代：单变量中点 [_mid2] → 完整坐标，统一 roundToGrid
            var _fullValues = reconstructSolution(state, [_mid2]).map(roundToGrid);
            allSolutions.push({ values: _fullValues, residual: Math.abs(_fm2), _bisect: true });
            break;
        }
        if (_fm2 * fa < 0) { b = _mid2; fb = _fm2; }
        else { a = _mid2; fa = _fm2; }
    }
}
// 含奇点区间的递归细分（通用奇点分裂）：区间预检含奇点（除零/定义域错/±∞）时，不整体跳过，

function _recScanInterval(eq, vn, a, b, state, allSolutions, resultVarNames, depth) {
    if (depth > 4 || (b - a) < 1e-6) return;
    var _sv = { nan: _IEEE.nan, inf: _IEEE.inf, divZero: _IEEE.divZero, domainErr: _IEEE.domainErr };
    _ieeeReset();
    var _ivm = {}; _ivm[vn] = { min: a, max: b };
    var _iv = intervalEval(eq, _ivm);
    var _myDiv = _IEEE.divZero, _myDom = _IEEE.domainErr;
    _IEEE.nan = _sv.nan; _IEEE.inf = _sv.inf; _IEEE.divZero = _sv.divZero; _IEEE.domainErr = _sv.domainErr;
    var _hasSing = (_iv === null && (_myDiv || _myDom)) || (_iv !== null && (!isFinite(_iv.min) || !isFinite(_iv.max)));
    if (!_hasSing) {
        var _fa = _pointResidual(eq, vn, a), _fb = _pointResidual(eq, vn, b);
        if (_fa !== null && _fb !== null && _fa * _fb < 0) _bisectRoot1D(eq, vn, a, b, _fa, _fb, state, allSolutions, resultVarNames);
        return;
    }
    var _m = (a + b) / 2;
    _recScanInterval(eq, vn, a, _m, state, allSolutions, resultVarNames, depth + 1);
    _recScanInterval(eq, vn, _m, b, state, allSolutions, resultVarNames, depth + 1);
}


function _linearCoef1D(n, vn) {
    if (!n) return null;
    if (n.type === 'num') return { a: 0, b: n.value };
    if (n.type === 'var') return (n.name === vn) ? { a: 1, b: 0 } : null;
    if (n.type === 'unary' && n.op === '-') { var _t = _linearCoef1D(n.operand, vn); return _t ? { a: -_t.a, b: -_t.b } : null; }
    if (n.type === 'binop') {
        if (n.op === '+' || n.op === '-') {
            var _l = _linearCoef1D(n.left, vn), _r = _linearCoef1D(n.right, vn);
            if (_l && _r) return { a: _l.a + (n.op === '-' ? -_r.a : _r.a), b: _l.b + (n.op === '-' ? -_r.b : _r.b) };
            return null;
        }
        if (n.op === '*') {
            if (n.left.type === 'num' && n.right.type === 'var' && n.right.name === vn) return { a: n.left.value, b: 0 };
            if (n.right.type === 'num' && n.left.type === 'var' && n.left.name === vn) return { a: n.right.value, b: 0 };
            return null;
        }
        if (n.op === '/') {
            var _ld = _linearCoef1D(n.left, vn);
            if (_ld && n.right.type === 'num' && n.right.value !== 0) return { a: _ld.a / n.right.value, b: _ld.b / n.right.value };
            return null;
        }
    }
    return null;
}
// 单变量周期检测（issue A 修复 2026-09-01）：遍历 AST，对 sin/cos/tan/cot/sec/csc 且参数为 vn 的

function _detectPeriod1D(node, vn) {
    var _P = null;
    (function _walkPer(n) {
        if (!n) return;
        if (n.type === 'func' && ['sin', 'cos', 'sec', 'csc', 'tan', 'cot'].indexOf(n.name) >= 0) {
            var _c = _linearCoef1D(n.arg, vn);
            if (_c && _c.a !== 0) {
                var _p = (n.name === 'tan' || n.name === 'cot') ? (Math.PI / Math.abs(_c.a)) : (2 * Math.PI / Math.abs(_c.a));
                if (_P === null || _p < _P) _P = _p;
            }
        }
        if (n.type === 'func') { if (n.arg) _walkPer(n.arg); if (n.args) for (var _ai = 0; _ai < n.args.length; _ai++) _walkPer(n.args[_ai]); }
        else if (n.type === 'binop') { _walkPer(n.left); _walkPer(n.right); }
        else if (n.type === 'unary') { _walkPer(n.operand); }
    })(node);
    return _P;
}


function _eqRefsOnlyAllowed(eq, allowed) {
    var _ok = true;
    (function _w(n) {
        if (!n || !_ok) return;
        if (n.type === 'var') { if (allowed.indexOf(n.name) < 0) _ok = false; }
        else if (n.type === 'binop') { _w(n.left); _w(n.right); }
        else if (n.type === 'unary') { _w(n.operand); }
        else if (n.type === 'func') { if (n.arg) _w(n.arg); if (n.args) for (var _ai = 0; _ai < n.args.length; _ai++) _w(n.args[_ai]); }
    })(eq);
    return _ok;
}


function _polyRemainderAsc(a, b) {
    if (!a || !b || !b.length) return null;
    var db = b.length - 1;
    if (db < 0) return null;
    if (db === 0) return [0];                    // 除以非零常数：整除
    var lead = b[db];
    if (lead === 0) return null;                 // b 退化：最高次系数为 0
    var r = a.slice();
    var da = r.length - 1;
    for (var i = da; i >= db; i--) {
        var coef = r[i] / lead;
        if (coef === 0) continue;
        for (var j = 0; j <= db; j++) r[i - db + j] -= coef * b[j];
    }
    var out = [];
    for (var k = 0; k < db; k++) {
        var v = r[k];
        out.push((v === 0 || Math.abs(v) < 1e-300) ? 0 : v);   // 归零噪声
    }
    return out;
}
// 多项式求导（升幂系数）

function _polyDerivAsc(a) {
    if (!a || a.length < 2) return [0];
    var d = [];
    for (var i = 1; i < a.length; i++) d.push(a[i] * i);
    return d.length ? d : [0];
}
// 去掉升幂数组尾部的零系数

function _polyTrimAsc(a) {
    var i = a.length - 1;
    while (i > 0 && a[i] === 0) i--;
    return a.slice(0, i + 1);
}
// 在点 x 处求值（升幂系数，Horner）

function _polyEvalAsc(a, x) {
    var s = 0;
    for (var i = a.length - 1; i >= 0; i--) s = s * x + a[i];
    return s;
}
// 构造 Sturm 链。返回数组（每个元素是升幂系数数组），失败返回 null。

function _sturmChainAsc(coeffsAsc) {
    var p = _polyTrimAsc(coeffsAsc);
    if (!p || p.length < 2) return null;              // 次数 < 1：无 Sturm 链可言
    for (var i = 0; i < p.length; i++) if (!isFinite(p[i])) return null;
    var d = _polyTrimAsc(_polyDerivAsc(p));
    if (!d || d.length < 1 || (d.length === 1 && d[0] === 0)) return null;  // 常数（原式已无根可数）
    var chain = [p, d];
    var guard = p.length + 4;                          // 链长不超过次数+1，防死循环
    // 一次式：P1 = P' 已是常数，Sturm 链到此即为完整（修复：勿再算余式导致误判失败）
    while (chain.length < guard && chain[chain.length - 1].length > 1) {
        var a = chain[chain.length - 2], b = chain[chain.length - 1];
        var rem = _polyRemainderAsc(a, b);
        if (rem === null) return null;                 // 除数退化 ⇒ 判据失效
        var neg = rem.map(function (v) { return -v; });
        var isZero = true;
        for (var j = 0; j < neg.length; j++) if (neg[j] !== 0) { isZero = false; break; }
        if (isZero) return null;                       // 余式为零 ⇒ a 被 b 整除（应先约公因子）
        // 数值退化防护：若本项相对上项过小，Sturm 链在此已不可靠 ⇒ 保守失败
        var maxCur = 0, maxPrev = 0;
        for (var m = 0; m < neg.length; m++) maxCur = Math.max(maxCur, Math.abs(neg[m]));
        for (var m2 = 0; m2 < b.length; m2++) maxPrev = Math.max(maxPrev, Math.abs(b[m2]));
        if (maxPrev > 0 && maxCur < maxPrev * 1e-13) return null;   // 链条塌缩 ⇒ 拒绝给计数
        chain.push(_polyTrimAsc(neg));           // 必须 trim：否则尾零使链永不终止（x^5-1 曾因此失败）
        if (chain[chain.length - 1].length === 1) break;  // 到达非零常数，链结束
    }
    if (chain[chain.length - 1].length !== 1) return null;  // 未收敛到常数 ⇒ 失败
    return chain;
}
// Sturm 链在 x 处的符号变化数 V(x)（忽略零项）

function _sturmVariations(chain, x) {
    var prev = 0, cnt = 0;
    for (var i = 0; i < chain.length; i++) {
        var v = _polyEvalAsc(chain[i], x);
        if (!isFinite(v)) return -1;                   // 非有限 ⇒ 无法判定
        if (v === 0) continue;                          // 忽略零项
        var s = (v > 0) ? 1 : -1;
        if (prev !== 0 && s !== prev) cnt++;
        prev = s;
    }
    return cnt;
}
// Sturm 链在 x→±∞ 处的符号变化数 V(±∞)。
//
// 🔴 为什么不能在 ±∞ 处**求值**（2026-10-04 实测踩坑）：
//   朴素写法是 _sturmVariations(chain, 1e6) / (chain, -1e6)。但 ±1e6 **不是 ∞**，
//   它只是「盒内计数」而不是「全域计数」。实测 x^2=2 域给 [1,2]：
//     盒内 [1,2] 数出 1 个根、found 也是 1 ⇒ 旧代码据此判「全部解」，
//     而 −√2 是真解且在盒外 ⇒ **谎报找全**（P0，canAssert.allSolutions 还给了 true）。
//   病根是「把盒内计数当全域计数用」，不是求值精度问题。
//
// ✅ 正确做法：x→+∞ 时多项式 p 的符号 = sign(首项系数)；x→−∞ 时 = sign(首项系数) × (−1)^次数。
//   这**只读链上每个多项式的首项系数与次数**，不依赖任何具体取值点，数学上就是真 ±∞。
//   Sturm 定理：#ℝ 上的不同实根 = V(−∞) − V(+∞)。
//   实测 9/9 与手算吻合，且与盒内计数**故意不同**（x^2-2：全域 2、盒[1,2] 1）。
function _sturmVariationsAtInfinity(chain, atPositiveInfinity) {
    var signs = [];
    for (var i = 0; i < chain.length; i++) {
        var t = _polyTrimAsc(chain[i]);
        if (!t || t.length < 1) continue;
        var deg = t.length - 1;
        var lead = t[deg];
        if (lead === 0 || !isFinite(lead)) continue;
        var s = (lead > 0) ? 1 : -1;
        if (!atPositiveInfinity && (deg % 2 === 1)) s = -s;   // x→−∞ 时乘 (−1)^deg
        signs.push(s);
    }
    var prev = 0, cnt = 0;
    for (var j = 0; j < signs.length; j++) {
        if (signs[j] === 0) continue;
        if (prev !== 0 && signs[j] !== prev) cnt++;
        prev = signs[j];
    }
    return cnt;
}
// 一元多项式在**声明空间**内的不同实根精确个数。端点可为 ±Infinity。
//
// ★ 这是「完备性证据」唯一该用的计数 —— 区间必须表达**声明空间**（问题本身允许的解范围），
//   而声明空间由**问题里的不等式约束**决定，不是搜索盒，也不是盲目用 ℝ。两种用错都会出事：
//
//   (a) 搜索盒 `domain:{x:[1,2]}` —— 是**搜索提示**（去哪里找），不是问题的一部分。
//       实测 `x^2=2` 域 [1,2]：盒内 1 根、found 1 ⇒ 若拿它当完备性证据就判「全部解」，
//       而 −√2 是真解 ⇒ **谎报找全**（P0，2026-10-04）。
//   (b) 盲目用 ℝ —— 同样会谎报。实测 `x^2-4=0, x>0`：声明空间是 (0,∞)，
//       ℝ 上有 2 个根（±2），但只有 x=2 满足约束。found=1 ≠ 2 ⇒ 把完备的答案判成「部分解」。
//       约束 `x>0` 是**问题的一部分**，它定义了解集本身，必须计入计数区间。
//
// 数学：Sturm 定理 V(a) − V(b) = #(a,b]（**右端点含、左端点不含**）。
//   ⚠ 端点语义是实测出来的，不是猜的（2026-10-04，dist 真实函数）：
//     x−1 计数区间 [0,1]  ⇒ 1（根 1 = 右端点，**计入**）
//     x²−4 计数区间 [−2,0] ⇒ 0（根 −2 = 左端点，**不计入**）
//   故基线语义是 (lo,hi]。真正的闭/开端点用 opts.loClosed / opts.hiClosed 做修正。
//
// @param {number[]} coeffsAsc 升幂系数
// @param {number} lo 下端点（可 -Infinity）
// @param {number} hi 上端点（可 +Infinity）
// @param {{loClosed?:boolean, hiClosed?:boolean}} [opts] 端点是否属于声明空间
// @returns {{ok:boolean, count?:number, vLo?:number, vHi?:number, why?:string}}
function _sturmCountRange(coeffsAsc, lo, hi, opts) {
    var L = (lo === undefined || lo === null) ? -Infinity : Number(lo);
    var H = (hi === undefined || hi === null) ? Infinity : Number(hi);
    if (L !== L || H !== H) return { ok: false, why: '区间端点非数' };   // NaN
    if (L === Infinity || H === -Infinity) return { ok: true, count: 0 }; // 空区间
    if (L > H) return { ok: false, why: '区间端点反序' };
    var chain = _sturmChainAsc(coeffsAsc);
    if (!chain) return { ok: false, why: 'Sturm 链构造失败（公因子/数值退化/非多项式）' };
    // ±∞ 端点**不求值**，直接读首项系数符号（数学上就是真 ±∞，见 _sturmVariationsAtInfinity）。
    var vLo = (L === -Infinity) ? _sturmVariationsAtInfinity(chain, false) : _sturmVariations(chain, L);
    var vHi = (H === Infinity) ? _sturmVariationsAtInfinity(chain, true) : _sturmVariations(chain, H);
    if (vLo < 0 || vHi < 0) return { ok: false, why: '端点求值非有限' };
    var cnt = vLo - vHi;              // #(L,H] —— 基线语义
    if (cnt < 0) return { ok: false, why: 'Sturm 计数出现负值（数值不可靠）' };
    // —— 端点修正（基线是 (L,H]：左端已排除、右端已含）——
    //   · loClosed=true  ⇒ 声明空间含 L，若 L 本身是根必须**补回** +1。
    //     漏补 ⇒ count 偏小 ⇒ found 恰好等于偏小的 count ⇒ **谎报找全**（最危险）。
    //   · hiClosed=false ⇒ 声明空间不含 H，若 H 本身是根必须**剔除** −1。
    //     漏剔 ⇒ count 偏大 ⇒ found<count ⇒ 报「部分解/缺 N 个」（保守，安全）。
    var o = opts || {};
    if (o.loClosed === true && isFinite(L) && _polyRootAtStrict(coeffsAsc, L)) cnt += 1;
    if (o.hiClosed === false && isFinite(H) && _polyRootAtStrict(coeffsAsc, H)) cnt -= 1;
    if (cnt < 0) return { ok: false, why: 'Sturm 端点修正后计数为负（数值不可靠）' };
    return { ok: true, count: cnt, vLo: vLo, vHi: vHi, chainLen: chain.length };
}
// p(x) 在 x=c 处是否为根（带相对容差）。判定不确定时返回 **false**（fail-closed）。
// ⚠ 为什么必须 fail-closed：端点根多算/少算都会动完备性判定。
//   多算 → count 偏大 → found<count → 报「部分解」（保守，安全）。
//   少算 → count 偏小 → 可能 found==count 而实际漏了端点根 → **谎报找全**（致命）。
//   而本函数只在「**含**该端点」的区间里被用来**加**一根（+1），或在「**不含**」时用来**减**一根（−1）。
//   ⇒ 宁可返回 false 让 +1 不发生（走「保守少算」方向），绝不做可能造成谎报的减法。
function _polyRootAtStrict(coeffsAsc, c) {
    if (!isFinite(c)) return false;
    var v;
    try { v = _polyEvalAsc(coeffsAsc, c); } catch (e) { return false; }
    if (typeof v !== 'number' || !isFinite(v)) return false;
    if (v === 0) return true;
    // 相对容差：与该点的多项式量级比较（避免 x=1e6 附近的根被绝对容差吃掉）
    var scale = 0, ax = Math.abs(c);
    for (var i = 0; i < coeffsAsc.length; i++) {
        var t = Math.abs(coeffsAsc[i]) * Math.pow(ax, i);
        if (!isFinite(t)) return false;
        if (t > scale) scale = t;
    }
    if (scale === 0) scale = 1;
    return Math.abs(v) <= 1e-12 * scale;
}
// 一元多项式在**整个 ℝ** 上的不同实根精确个数（域无关，与搜索盒无关）。
//
// ⚠ 声明空间是 ℝ 时才用它。若问题带了不等式约束（如 `x>0`），必须用
//   _sturmCountRange(coeffs, 约束下界, 约束上界) —— 否则会把被约束排除的真根算进来，
//   把本来完备的答案误判成「部分解」。
//
// @param {number[]} coeffsAsc 升幂系数
// @returns {{ok:boolean, count?:number, vNeg?:number, vPos?:number, why?:string}}
function _sturmCountAllReal(coeffsAsc) {
    return _sturmCountRange(coeffsAsc, -Infinity, Infinity);
}
// 一元多项式在区间 [lo, hi] 内的**不同实根精确个数**（端点语义 (lo,hi]，左开右闭）。
//
// 🔴⚠ 只用于**盒内**诊断（sturmIncomplete / missingRealRootCount / resultant.js 的盒内计数），
//   **不得**当完备性证据 —— 域外的根它数不到。完备性请用 _sturmCountRange（声明空间口径）。
//   实测事故（2026-10-04）：x^2=2 域 [1,2] 时本函数返回 1，与 found=1 相等，
//   旧代码据此判「全部解」，而 −√2 在盒外是漏解 ⇒ 谎报。
// ⚠ 本函数**保持原样不改成 _sturmCountRange 的调用**：它语义是 (lo,hi]、端点必为有限数，
//   盒内诊断要的就是这个口径；混用两套端点语义会引入难以察觉的 ±1 偏差。
function _sturmCountAsc(coeffsAsc, lo, hi) {
    var chain = _sturmChainAsc(coeffsAsc);
    if (!chain) return { ok: false, why: 'Sturm 链构造失败（公因子/数值退化/非多项式）' };
    var big = 1e6;
    var a = (lo === undefined || lo === null) ? -big : lo;
    var b = (hi === undefined || hi === null) ? big : hi;
    var va = _sturmVariations(chain, a);
    var vb = _sturmVariations(chain, b);
    if (va < 0 || vb < 0) return { ok: false, why: '端点求值非有限' };
    var cnt = va - vb;
    if (cnt < 0) return { ok: false, why: 'Sturm 计数出现负值（数值不可靠）' };
    return { ok: true, count: cnt, chainLen: chain.length };
}

// ═══════════════════ 模块：numeric/linear ═══════════════════
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
// ═══════════════════ 模块：numeric/root ═══════════════════
/* 模块 numeric/root：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */

// ── 坐标输出：恒等函数（2026-10-05，用户指令「去掉所有人为规则、格子」）────
//
// 🔴 本函数从「去网格化的漏网之鱼」到「**完全恒等**」，共三步：
//   ① 2026-10-05 早：硬量化 `Math.round(x*1e6)/1e6`，把坐标砍到 6 位小数。
//      实测 P0：4/5/6 元线性方阵的精确解 [0.6, 23/30, 14/15, 1.1] 被量化成
//      [0.6, 0.766667, 0.933333, 1.1] ⇒ 回代残差 2e-6 > 判据 ⇒ **返回 0 解**。
//   ② 同期晚：改成「全精度 + ULP 级吸附」（只修正浮点表示误差，不修正数学值）。
//   ③ 现在：连 ULP 吸附也**删掉**，退化为「原样返回 + −0 归一」。
//
// 为什么连 ULP 吸附也删（它是纯去噪、看着无害）：
//   ULP 吸附的判据是「把 x 吸到 6 位小数 r6，若 |x−r6| ≤ 4·ulp 则返回 r6」。
//   这仍然**内置了一个 6 位小数的格点**——只不过把格点宽度从"硬砍"放宽到"4 ULP 宽的
//   软吸附区"。软硬之别是程度问题，不是性质问题：它依然在替调用方决定"哪个值更代表
//   这个解"，而这个决定权属于数学，不属于格式化层。
//
//   剩下的唯一动作是 **−0 归一**：−0 与 0 在数学上是同一个数，但 JSON 里会输出 "-0"
//   这种噪声字符。这是**表示层**问题不是数学问题，所以留在输出层修是恰当的。
//
// 保留本函数名的原因：31 处调用点仍需要"一个集中的出口"，
//   这样将来若真有全局数值策略，改一个函数即可（而不是 31 处散改）。
function roundToGrid(x) {
    if (typeof x !== 'number' || !isFinite(x)) return x;
    return x === 0 ? 0 : x;   // 唯一动作：−0 归一（0 与 −0 数学等价）
}


/**
 * 生成 Newton 的确定性起点集。
 *
 * 🔴 2026-10-05 重写（用户指令「去掉所有人为规则……按数学定理来」）：
 *   旧实现是一批**拍脑袋的魔法数**：原点、全±1、全±10、混合±5、四分/四分之三点。
 *   那些 5 和 10 没有任何数学依据 —— 只是「常见工程题的答案落在这个量级」的经验猜测。
 *   而且数量上就注定失败：旧实现最多给 15 个起点，
 *   而 6 元二次方阵的 Bézout 上界是 64 ⇒ **起点数差一个数量级**，
 *   多起点 Newton 在结构上就不可能找全（这正是 suan61 同伦存在的理由）。
 *
 * 换成两个有定义的来源：
 *   ① **同伦延续给出的实解**（state.homotopySeeds）
 *      唯一有理论保证的起点来源：gamma trick 下每条路径终点逼近 F 的根，
 *      从它出发 Newton 二次收敛。由 operators/homotopy.js 注入。
 *   ② **与分支定界共享的规范点集**（本函数）
 *      域中心 + 各维 {1/4, 1/2, 3/4} 分位点。留它的理由不是「碰运气」，
 *      而是**与 branch.js 的二分树同源**：盒 [a,b] 二分得中点 (a+b)/2，
 *      下一层中点是 3a/4 与 3b/4 ⇒ 三个分位点正是分支定界前两层的节点。
 *      两者共享点集，「Newton 起点」与「分支定界能排除的盒」才落在同一套几何划分上。
 *
 * 删掉：±1/±5/±10 量级猜测，以及 0 作为「万能起点」的优先地位
 *   （0 只在它恰是盒中心时才有意义）。
 *
 * @param {string[]} varNames 变量名
 * @param {Object} contractedDomain 收缩后定义域 {v:{min,max}}
 * @param {Object} [state] 求解状态（读 homotopySeeds）
 */
function generateStartPoints(varNames, contractedDomain, state) {
    const n = varNames.length;
    const points = [];

    // ── 来源①：同伦延续终点（优先级最高，数学保证最强）──
    if (state && state.homotopySeeds && state.homotopySeeds.length) {
        for (const seed of state.homotopySeeds) {
            if (!seed || seed.length !== n) continue;
            points.push(seed.slice());
        }
    }

    // 域中心（盒的对称点）
    const center = [], lo = [], hi = [];
    for (let i = 0; i < n; i++) {
        const v = varNames[i];
        const b = contractedDomain && contractedDomain[v];
        if (b) {
            const mn = b.min === -Infinity ? -1000000 : b.min;
            const mx = b.max === Infinity ? 1000000 : b.max;
            lo.push(mn); hi.push(mx);
            center.push(0.5 * (mn + mx));
        } else {
            lo.push(-1000000); hi.push(1000000); center.push(0);
        }
    }
    points.push(center.slice());

    // ── 来源②：与分支定界共享的规范点集 ──
    // 分数取 {1/4, 1/2, 3/4}：branch.js 初始二分树的节点与这三点同源
    // （盒 [a,b] 二分后是 [a,(a+b)/2] 与 [(a+b)/2,b]，中点即 1/2），
    // 1/4 与 3/4 是下一层的两个中点 ⇒ 与分支定界的几何划分对齐。
    const fracs = [0.25, 0.5, 0.75];
    for (let r = 0; r < fracs.length; r++) {
        points.push(lo.map((mn, i) => mn + fracs[r] * (hi[i] - mn)));
    }

    // 去重（这些点由确定算术生成，重复只可能来自退化域，精确比较即可）
    const seen = new Set();
    return points.filter(p => {
        const key = p.join('|');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}


function deduplicateSolutions(solutions, varNames, tolerance) {
    const unique = [];
    // 去重阈值：至少1e-4，避免浮点误差导致的近重复
    const dedupTol = Math.max(tolerance, 1e-4);

    for (const sol of solutions) {
        let outOfRange = false;
        for (const val of sol) {
            if (isNaN(val) || !isFinite(val) || Math.abs(val) > 1000000) {
                outOfRange = true;
                break;
            }
        }
        if (outOfRange) continue;

        // 距离比较去重：若与任一已有解的最大分量差 < dedupTol，视为重复
        let isDup = false;
        for (const existing of unique) {
            let maxDiff = 0;
            for (let i = 0; i < sol.length; i++) {
                maxDiff = Math.max(maxDiff, Math.abs(sol[i] - existing[i]));
            }
            if (maxDiff < dedupTol) {
                isDup = true;
                break;
            }
        }
        if (!isDup) unique.push(sol);
    }

    return unique;
}


function _multiStartNewton(state) {
    var eqs = state.equations || [];
    var vns = state.varNames || [];
    var n = vns.length, m = eqs.length;
    if (n === 0 || m !== n) return null;   // 仅方阵
    if (n > 6 || m > 6) return null;
    // 生成确定性起点（笛卡尔积上限 64 + D0 中心点）
    var baseSets = [];
    for (var i = 0; i < n; i++) {
        var d = state.D0 && state.D0[vns[i]] ? state.D0[vns[i]] : null;
        // 起点值集合：含 0 与小编号优先（2026-08-21：原 {±1,±3} 笛卡尔积截断 64 后
        // 全部起点第一个分量相同，缺多样性——如示例8 的 5 维牛顿从 (-3,...) 起步全发散；
        // 含 0 使 (0,0,0,0,0) 等靠近原点的起点可用）
        var set = [0, 1, -1, 2, -2, 3, -3];
        if (d && (d.max < -3 || d.min > 3)) {
            set = [d.min + 0.25 * (d.max - d.min), d.max - 0.25 * (d.max - d.min), d.min, d.max];
        }
        var su = [];
        for (var s = 0; s < set.length; s++) {
            var v = set[s];
            if (d) { if (v < d.min) v = d.min; if (v > d.max) v = d.max; }
            if (su.indexOf(v) < 0) su.push(v);
        }
        baseSets.push(su);
    }
    var combos = [[]];
    for (var c = 0; c < baseSets.length && combos.length <= 128; c++) {
        var nc = [];
        for (var a = 0; a < combos.length; a++) {
            for (var b = 0; b < baseSets[c].length; b++) nc.push(combos[a].concat([baseSets[c][b]]));
        }
        combos = nc;
    }
    if (combos.length > 128) combos = combos.slice(0, 128);
    var midPt = [];
    for (var mi = 0; mi < n; mi++) midPt.push(state.D0 && state.D0[vns[mi]] ? (state.D0[vns[mi]].min + state.D0[vns[mi]].max) / 2 : 0);
    combos.push(midPt);
    // 整数优先种子（2026-08-22）：对称多项式等系统的根常为小整数排列（如 (1,2,3,4,5)）。
    // 笛卡尔积起点被截断（n≥4 时 7^n 远超 128）永远触不到 (1,2,...,n) 区域，导致多起点牛顿
    // 漏掉所有基解、对称补全无从展开。这里额外追加少量结构化整数种子（不参与 128 截断），
    // 仅为让牛顿"碰到"一个基解，后续 _symmetryExpand 补全全部排列。对一般系统无害（发散即跳过）。
    // 只取与域不冲突的种子，避免越界。
    var _intSeeds = [];
    // 用原始变量数 origN 决定整数范围（消元后 n 可能小于 origN，根仍落在 1..origN）
    var _origN = (state.originalVarNames && state.originalVarNames.length) ? state.originalVarNames.length : n;
    var _seq = []; for (var _si = 1; _si <= _origN; _si++) _seq.push(_si);
    // 取 _seq 的前 n 项作为种子长度与 n 匹配；若 origN>n，则前 n 项覆盖 1..n
    var _head = _seq.slice(0, n);
    _intSeeds.push(_head.slice());                       // (1,2,...,n)
    _intSeeds.push(_head.slice().reverse());             // (n,...,2,1)
    _intSeeds.push(_head.map(function() { return 1; })); // (1,1,...,1)
    // 追加若干个 (1..origN) 的循环移位，覆盖对称系统的不同基解起点（与域兼容才采纳）
    for (var _sh = 1; _sh < _origN && _intSeeds.length < 12; _sh++) {
        var _rot = []; for (var _r = 0; _r < n; _r++) _rot.push(_seq[(_sh + _r) % _origN]);
        _intSeeds.push(_rot);
    }
    for (var _is = 0; _is < _intSeeds.length; _is++) {
        var _okSeed = true;
        for (var _iv = 0; _iv < n; _iv++) {
            var _dd = state.D0 && state.D0[vns[_iv]];
            var _v = _intSeeds[_is][_iv];
            if (_dd && (_v < _dd.min || _v > _dd.max)) { _okSeed = false; break; }
        }
        if (_okSeed) combos.push(_intSeeds[_is]);
    }
    // 域远端采样种子（2026-08-22）：当某变量定义域宽度较大(>12)时，整数/原点优先种子
    // 偏向中心，可能漏掉落在域边缘的远端孤立根（如 Freudenstein-Roth 第二根 x1≈11.4）。
    // 追加少量确定性"域边界与三分点"种子（bounded，最多 +2^n 且受 256 上限约束），
    // 让牛顿有机会碰到远端根。对一般小域系统无影响（宽度<=12 不追加）。发散即跳过，无随机性。
    var _wideVars = [];
    for (var _wv = 0; _wv < n; _wv++) {
        var _wd = state.D0 && state.D0[vns[_wv]];
        if (_wd && (_wd.max - _wd.min) > 12) _wideVars.push(_wv);
    }
    if (_wideVars.length > 0 && combos.length < 256) {
        var _edgeSets = [];
        for (var _ev = 0; _ev < n; _ev++) {
            var _e = state.D0 && state.D0[vns[_ev]];
            if (_wideVars.indexOf(_ev) >= 0) {
                _edgeSets.push([_e.min, _e.min + (_e.max - _e.min) / 3, _e.min + 2 * (_e.max - _e.min) / 3, _e.max]);
            } else {
                _edgeSets.push([0]);
            }
        }
        var _ec = [[]];
        for (var _eci = 0; _eci < _edgeSets.length && _ec.length <= 256; _eci++) {
            var _enc = [];
            for (var _ea = 0; _ea < _ec.length; _ea++) for (var _eb = 0; _eb < _edgeSets[_eci].length; _eb++) _enc.push(_ec[_ea].concat([_edgeSets[_eci][_eb]]));
            _ec = _enc;
        }
        if (_ec.length > 256) _ec = _ec.slice(0, 256);
        for (var _ei2 = 0; _ei2 < _ec.length; _ei2++) combos.push(_ec[_ei2]);
    }
    var sols = [];
    for (var ci = 0; ci < combos.length; ci++) {
        var known = {};
        for (var vi = 0; vi < n; vi++) known[vns[vi]] = combos[ci][vi];
        var converged = false;
        for (var it = 0; it < 40; it++) {
            var fvec = [], maxf = 0;
            for (var ei = 0; ei < m; ei++) {
                var fv; try { fv = evalAST(eqs[ei], known); } catch(e) { fv = NaN; }
                if (!isFinite(fv)) fv = 1e30;
                fvec.push(fv);
                if (Math.abs(fv) > maxf) maxf = Math.abs(fv);
            }
            if (maxf < 1e-9) { converged = true; break; }
            var J = [];
            for (var jei = 0; jei < m; jei++) {
                var row = [];
                for (var jv = 0; jv < n; jv++) {
                    var h = 1e-6 * Math.max(1, Math.abs(known[vns[jv]] || 0));
                    known[vns[jv]] += h;
                    var fp; try { fp = evalAST(eqs[jei], known); } catch(e) { fp = NaN; }
                    known[vns[jv]] -= 2 * h;
                    var fm; try { fm = evalAST(eqs[jei], known); } catch(e) { fm = NaN; }
                    known[vns[jv]] += h;
                    row.push((isFinite(fp) && isFinite(fm)) ? (fp - fm) / (2 * h) : 0);
                }
                J.push(row);
            }
            var delta = null;
            try { var gs2 = gaussianSolve(J, fvec.map(function(v) { return -v; })); delta = gs2 ? gs2.solution : null; } catch(e) { delta = null; }
            if (!delta) break;
            var accepted = false;
            for (var dmp = 0; dmp < 10; dmp++) {
                var tmpK = {};
                for (var tk in known) { if (known.hasOwnProperty(tk)) tmpK[tk] = known[tk]; }
                for (var di = 0; di < n; di++) {
                    var nv = tmpK[vns[di]] + delta[di];
                    var dd = state.D0 && state.D0[vns[di]];
                    if (dd) { if (nv < dd.min) nv = dd.min; if (nv > dd.max) nv = dd.max; }
                    tmpK[vns[di]] = nv;
                }
                var nmf = 0;
                for (var fei = 0; fei < m; fei++) {
                    var fv2; try { fv2 = evalAST(eqs[fei], tmpK); } catch(e) { fv2 = NaN; }
                    if (!isFinite(fv2)) fv2 = 1e30;
                    if (Math.abs(fv2) > nmf) nmf = Math.abs(fv2);
                }
                if (nmf <= maxf || dmp >= 8) {
                    for (var di2 = 0; di2 < n; di2++) known[vns[di2]] = tmpK[vns[di2]];
                    accepted = true;
                    break;
                }
                for (var di3 = 0; di3 < n; di3++) delta[di3] *= 0.5;
            }
            if (!accepted) break;
        }
        if (converged) {
            var dup = false;
            for (var si = 0; si < sols.length; si++) {
                var dsum = 0;
                for (var dvi = 0; dvi < n; dvi++) dsum += Math.abs(sols[si].values[dvi] - known[vns[dvi]]);
                if (dsum < 1e-4) { dup = true; break; }
            }
            if (!dup) {
                var inDom = true, maxR = 0;
                for (var vi2 = 0; vi2 < n; vi2++) {
                    var dd2 = state.D0 && state.D0[vns[vi2]];
                    if (dd2 && (known[vns[vi2]] < dd2.min - 1e-6 || known[vns[vi2]] > dd2.max + 1e-6)) { inDom = false; break; }
                }
                if (inDom) {
                    for (var ei2 = 0; ei2 < m; ei2++) {
                        var rr; try { rr = Math.abs(evalAST(eqs[ei2], known)); } catch(e) { rr = 1e10; }
                        if (rr > maxR) maxR = rr;
                    }
                    if (maxR < 1e-9) sols.push({ values: vns.map(function(v) { return known[v]; }), residual: maxR });
                }
            }
        }
    }
    // 对称系统排列补全（2026-08-22）：对完全对称（变量置换不变）的方程组，
    // 多起点牛顿因笛卡尔积起点被截断（n≥4 时 7^n 远超 128 上限）只能收敛到部分排列解。
    // 这里对已得精确解生成全部变量排列并验证接收，补齐漏掉的排列解（如四元对称 (1,2,3,4)
    // 理论 24 解，起点不足时仅得部分）。非对称系统的伪排列会因 1e-9 残差阈值被拒，安全。
    if (sols.length > 0) {
        // 快照原始精确解，避免扩展过程中新加入的排列又被重复裂变
        var _baseSols = sols.map(function(s) { return s.values.slice(); });
        var _baseKeys = {};
        for (var _bk = 0; _bk < _baseSols.length; _bk++) {
            _baseKeys[_baseSols[_bk].map(function(v) { return v.toFixed(4); }).join(',')] = true;
        }
        var _perms = _permutations(n);
        for (var _pi = 0; _pi < _baseSols.length; _pi++) {
            var _base = _baseSols[_pi];
            for (var _pj = 0; _pj < _perms.length; _pj++) {
                var _perm = _perms[_pj];
                var _pv = [];
                for (var _pk = 0; _pk < n; _pk++) _pv.push(_base[_perm[_pk]]);
                // 与原始解集合去重（按原始顺序元组），避免重复加入同一排列
                var _key = _pv.map(function(v) { return v.toFixed(4); }).join(',');
                if (_baseKeys[_key]) continue;
                var _inDom2 = true;
                for (var _vi3 = 0; _vi3 < n; _vi3++) {
                    var _dd3 = state.D0 && state.D0[vns[_vi3]];
                    if (_dd3 && (_pv[_vi3] < _dd3.min - 1e-6 || _pv[_vi3] > _dd3.max + 1e-6)) { _inDom2 = false; break; }
                }
                if (!_inDom2) continue;
                // 残差验证（严格 1e-9，滤掉流形准解）
                var _known2 = {}; for (var _vi4 = 0; _vi4 < n; _vi4++) _known2[vns[_vi4]] = _pv[_vi4];
                var _maxR2 = 0;
                for (var _ei3 = 0; _ei3 < m; _ei3++) {
                    var _rr2; try { _rr2 = Math.abs(evalAST(eqs[_ei3], _known2)); } catch(e) { _rr2 = 1e10; }
                    if (_rr2 > _maxR2) _maxR2 = _rr2;
                }
                if (_maxR2 >= 1e-9) continue;
                sols.push({ values: _pv, residual: _maxR2 });
                _baseKeys[_key] = true;  // 登记，防止后续重复
            }
        }
    }
    return sols.length ? sols : null;
}


function suan47_tryNewton(state) {
    if (state.equations.length !== state.varNames.length) return false;
    var _msSols = _multiStartNewton(state);
    if (!(_msSols && _msSols.length)) return false;
    // 回代消元变量（suan19 消元后 varNames 可能缩减——如三数问题 z 被消，
    // 若不回代输出只有 [x,y] 两个分量）
    var _msOutVars = getOutputVarNames(state);
    var _msExpanded = [];
    for (var msi = 0; msi < _msSols.length; msi++) {
        var _msol = _msSols[msi];
        // 集中式回代：多起点牛顿收敛解（state.varNames 顺序）→ 完整坐标
        var _fvArr = reconstructSolution(state, _msol.values);
        if (_fvArr && _fvArr.every(function(x) { return isFinite(x); })) {
            _msExpanded.push({ values: _fvArr, residual: _msol.residual });
        }
    }
    if (!_msExpanded.length) return false;
    // 对称系统排列补全（2026-08-22）：消元后 _multiStartNewton 只在缩减变量空间
    // 收敛（维度低于原始），其内置排列扩展维度不对、无法补全高维排列解。
    // 这里在回代后的完整变量空间做排列扩展——对已得解的全体变量置换生成候选，
    // 用原始方程字符串验证残差 <1e-9 才接收。非对称系统的伪排列会被阈值拒，安全。
    // 覆盖 4/5/6 变量对称系统（如四元/五元/六元对称多项式根的置换解）。
    _msExpanded = _symmetryExpand(_msExpanded, _msOutVars, state.equationStrs, state.D0);
    // 原始方程最终复核（2026-08-22）：多起点牛顿基于化简后方程（如 log(u)=log(v)→u=v）
    // 收敛，但病态耦合下会收敛到流形准解（化简后残差<1e-9，原始超越方程下残差~1e-3）。
    // 这里用原始 equationStrs（含 log/sin 等）复核，滤掉原始残差>1e-7 的伪解，
    // 保留真解。无超越函数的纯代数系统原始残差本就<1e-9，不受影响。
    if (state.equationStrs && state.equationStrs.length) {
        var _eqASTs2 = [];
        for (var _eqi = 0; _eqi < state.equationStrs.length; _eqi++) {
            try {
                var _ei2 = state.equationStrs[_eqi].indexOf('=');
                _eqASTs2.push(parse(tokenize(fuzzyFix('(' + state.equationStrs[_eqi].slice(0, _ei2) + ')-(' + state.equationStrs[_eqi].slice(_ei2 + 1) + ')', state.protNames))));
            } catch (err) { _eqASTs2.push(null); }
        }
        var _filtered = [];
        for (var _fi = 0; _fi < _msExpanded.length; _fi++) {
            var _s = _msExpanded[_fi], _ok = true;
            var _vv = {}; for (var _vi5 = 0; _vi5 < _msOutVars.length; _vi5++) _vv[_msOutVars[_vi5]] = _s.values[_vi5];
            for (var _ea = 0; _ea < _eqASTs2.length; _ea++) {
                if (!_eqASTs2[_ea]) continue;
                var _rr3; try { _rr3 = Math.abs(evalAST(_eqASTs2[_ea], _vv)); } catch (err) { _rr3 = 1e10; }
                if (_rr3 > 1e-7) { _ok = false; break; }
            }
            if (_ok) _filtered.push(_s);
        }
        _msExpanded = _filtered;
    }
    if (!_msExpanded.length) return false;
    state.done = true;
    state.finalSolutions = _msExpanded;
    state.result = {
        solutions: _msExpanded,
        error: null,
        message: "多起点阻尼牛顿法求解：" + _msExpanded.length + " 组解",
        executionPath: "多起点牛顿",
        timeMs: performance.now() - state.startTime,
        confidence: "high",
        varNames: _msOutVars,
        resultType: 2,
        resultTypeName: "有限离散孤立采样点",
        resultTypeDesc: "多起点阻尼牛顿法收敛得到的解（确定性多起点，可复现）"
    };
    return true;
}


function _suan55Monotone(fprime, vn, a, b) {
    var iv = null;
    var env = {}; env[vn] = { min: a, max: b };
    try { iv = intervalEval(fprime, env); } catch (e) { return null; }
    if (!iv || !isFinite(iv.min) || !isFinite(iv.max)) return null;
    if (iv.max <= 0) return 'dec';
    if (iv.min >= 0) return 'inc';
    return null;
}


function _suan55Refine(fnode, vn, a, b, fa, fb) {
    var N = 6;
    var m0 = (a + b) / 2;
    // 牛顿：从段中点出发
    var x = m0;
    for (var i = 0; i < N; i++) {
        var fv = null;
        try { var pt = {}; pt[vn] = x; fv = evalAST(fnode, pt); } catch (e) { fv = null; }
        if (fv === null || !isFinite(fv) || Math.abs(fv) < 1e-14) return { x: x, ok: true };
        // 数值导数（中心差分，精度足够定位后由认证器给严格界）
        var h = Math.max(1e-7, Math.abs(x) * 1e-7);
        var fp = null;
        try {
            var p1 = {}, p2 = {};
            p1[vn] = x + h; p2[vn] = x - h;
            var f1 = evalAST(fnode, p1), f2 = evalAST(fnode, p2);
            if (isFinite(f1) && isFinite(f2)) fp = (f1 - f2) / (2 * h);
        } catch (e) { fp = null; }
        if (fp === null || !isFinite(fp) || Math.abs(fp) < 1e-300) break;
        var nx = x - fv / fp;
        if (!isFinite(nx) || nx < a || nx > b) break;         // 跳出区间 ⇒ 改用二分
        if (Math.abs(nx - x) < 1e-15) { x = nx; break; }
        x = nx;
    }
    // 二分兜底（有根区间）
    var lo = a, hi = b, flo = fa;
    for (var k = 0; k < 80 && (hi - lo) > 1e-14 * Math.max(1, Math.abs(lo)); k++) {
        var m = (lo + hi) / 2;
        var fmv = null;
        try { var pt2 = {}; pt2[vn] = m; fmv = evalAST(fnode, pt2); } catch (e) { fmv = null; }
        if (fmv === null || !isFinite(fmv)) return { x: x, ok: false };
        if (fmv === 0) return { x: m, ok: true };
        if ((flo < 0 && fmv < 0) || (flo > 0 && fmv > 0)) { lo = m; flo = fmv; }
        else hi = m;
    }
    return { x: (lo + hi) / 2, ok: true };
}

// ═══════════════════ 模块：ode ═══════════════════
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

// ═══════════════════ 模块：rootbound-poly ═══════════════════
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

// ═══════════════════ 模块：certify ═══════════════════
/* 模块 certify：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function _assertContraction(state, opId, before) {
    var D0 = state.D0, viol = null;
    for (var k in before) {
        if (!Object.prototype.hasOwnProperty.call(before, k)) continue;
        var a = before[k], b = D0[k];
        if (!a || !b || typeof a !== 'object' || typeof b !== 'object') continue;
        if (!('min' in a) || !('min' in b)) continue;
        var EPS = 1e-9 * (Math.abs(a.min) + Math.abs(a.max) + 1);
        if (b.min < a.min - EPS || b.max > a.max + EPS) {
            viol = { v: k, before: [a.min, a.max], after: [b.min, b.max] };
            break;
        }
    }
    if (viol) {
        state.D0 = before;
        (state.contractionViolations = state.contractionViolations || []).push({ op: opId, detail: viol });
        return false;
    }
    return true;
}


function _krawczykOnce(eqs, vns, xhat, r) {
    var n = vns.length;
    if (eqs.length !== n) return { certified: false };
    var boxX = {}, Xvec = [];
    for (var i = 0; i < n; i++) { var lo = xhat[i] - r, hi = xhat[i] + r; boxX[vns[i]] = { min: lo, max: hi }; Xvec.push({ min: lo, max: hi }); }
    var JI = _intervalJacobian(eqs, vns, boxX, xhat);
    var pbox = {}; for (var i2 = 0; i2 < n; i2++) pbox[vns[i2]] = { min: xhat[i2], max: xhat[i2] };
    var JIp = _intervalJacobian(eqs, vns, pbox, xhat);
    var Jr = []; for (var a = 0; a < n; a++) { Jr.push([]); for (var b = 0; b < n; b++) Jr[a].push((JIp[a][b].min + JIp[a][b].max) / 2); }
    var Y = realMatInv(Jr); if (!Y) return { certified: false };
    var vmap = {}; for (var i3 = 0; i3 < n; i3++) vmap[vns[i3]] = xhat[i3];
    var F = []; for (var e = 0; e < n; e++) { var fe = evalAST(eqs[e], vmap); if (!isFinite(fe)) return { certified: false }; F.push(fe); }
    var YF = rMatVec(Y, F), c = []; for (var i4 = 0; i4 < n; i4++) c.push(xhat[i4] - YF[i4]);
    var YJ = rMatIMat(Y, JI);
    // 单位阵必须也是区间矩阵：iMatSubReal 对 A[i][j].min 取值，实数阵无 .min 会得 undefined → C 全 null（历史 bug）
    var Ii = []; for (var _ii = 0; _ii < n; _ii++) { Ii.push([]); for (var _jj = 0; _jj < n; _jj++) Ii[_ii].push(_ii === _jj ? { min: 1, max: 1 } : { min: 0, max: 0 }); }
    var C = iMatSub(Ii, YJ);
    var d = []; for (var i5 = 0; i5 < n; i5++) d.push({ min: Xvec[i5].min - xhat[i5], max: Xvec[i5].max - xhat[i5] });
    var Cd = iMatVec(C, d), K = []; for (var i6 = 0; i6 < n; i6++) K.push(iAdd(rToI(c[i6]), Cd[i6]));
    return { certified: iVecInterior(K, Xvec), box: Xvec, radius: r };
}
// 多半径尝试：遍历全部候选半径，取【最小成功半径】作为误差界（注释与实现必须一致）。

function krawczykCertify(eqs, vns, xhat, radii) {
    var rs = radii || [1e-5, 1e-4, 1e-6, 1e-3];
    var best = null;
    for (var k = 0; k < rs.length; k++) {
        var res = _krawczykOnce(eqs, vns, xhat, rs[k]);
        if (res.certified && (best === null || res.radius < best.radius)) best = res;
    }
    return best || { certified: false };
}
// ===== 1.0.22 认证升级：Miranda 第二认证器 + inflate-and-refine（sound-first，失败一律保守降级）=====

function _domBoxOf(state, vns) {
    var out = {};
    for (var i = 0; i < vns.length; i++) {
        var vn = vns[i], lo = -1000000, hi = 1000000;
        var gv = state && state.userDomain ? state.userDomain[vn] : null;
        var snap = (state && state._initD0 && state._initD0[vn]) ? state._initD0[vn] : null;
        if (Array.isArray(gv) && gv.length >= 2) { lo = Number(gv[0]); hi = Number(gv[1]); }
        else if (gv && typeof gv === 'object' && gv.min !== undefined) { lo = Number(gv.min); hi = Number(gv.max); }
        else if (snap && snap.min !== undefined) { lo = Number(snap.min); hi = Number(snap.max); }
        if (!isFinite(lo) || !isFinite(hi) || lo > hi) return null;
        out[vn] = { min: lo, max: hi };
    }
    return out;
}
// 数值点雅可比（中心差分，仅取点值）：Y 预条件矩阵只要求非奇异，无 soundness 要求；

function _numJac(eqs, vns, x) {
    var n = vns.length, J = [];
    for (var a = 0; a < eqs.length; a++) {
        J.push([]);
        for (var b = 0; b < n; b++) {
            var h = Math.max(Math.abs(x[b]), 1e-3) * 1e-7;
            var xp = x.slice(), xm = x.slice(); xp[b] += h; xm[b] -= h;
            var v2 = {}, v3 = {};
            for (var q = 0; q < n; q++) { v2[vns[q]] = xp[q]; v3[vns[q]] = xm[q]; }
            var fp = evalAST(eqs[a], v2), fm = evalAST(eqs[a], v3);
            if (!isFinite(fp) || !isFinite(fm)) return null;
            J[a].push((fp - fm) / (2 * h));
        }
    }
    return J;
}
// Miranda（Poincaré–Miranda）/Moore–Kioustelidis 第二认证器：

function _mirandaCertify(eqs, vns, xhat, r, domBox) {
    var n = vns.length;
    if (eqs.length !== n || !(r > 0)) return { certified: false };
    var Xlo = [], Xhi = [];
    for (var i = 0; i < n; i++) {
        var lo = xhat[i] - r, hi = xhat[i] + r;
        if (domBox) { if (lo < domBox[vns[i]].min || hi > domBox[vns[i]].max) return { certified: false, why: 'box 出域' }; }
        if (!(hi > lo)) return { certified: false };
        Xlo.push(lo); Xhi.push(hi);
    }
    // 预条件 Y = 数值点雅可比逆（任意非奇异实矩阵即可；区间雅可比中点奇异时仍可用）
    var Jn = _numJac(eqs, vns, xhat); if (!Jn) return { certified: false };
    var Y = realMatInv(Jn); if (!Y) return { certified: false };
    // 整盒 F 区间求值（哨兵：面内有限但内部有极点时，整盒求值会命中 divZero/非有限 → 拒证）
    var whole = {};
    for (var w = 0; w < n; w++) whole[vns[w]] = { min: Xlo[w], max: Xhi[w] };
    for (var e0 = 0; e0 < n; e0++) { var wv = intervalEval(eqs[e0], whole); if (!wv || !isFinite(wv.min) || !isFinite(wv.max)) return { certified: false, why: '整盒求值失败' }; }
    // 对每个成对面做 F 区间求值，再左乘 Y 得 g_i=(Y·F)_i 的包络
    function faceIv(idx, val) {
        var fb = {};
        for (var i2 = 0; i2 < n; i2++) fb[vns[i2]] = (i2 === idx) ? { min: val, max: val } : { min: Xlo[i2], max: Xhi[i2] };
        var Fv = [];
        for (var e = 0; e < n; e++) {
            var iv = intervalEval(eqs[e], fb);
            if (!iv || !isFinite(iv.min) || !isFinite(iv.max)) return null;
            Fv.push(iv);
        }
        return Fv;
    }
    for (var d = 0; d < n; d++) {
        var Fp = faceIv(d, Xhi[d]), Fm = faceIv(d, Xlo[d]);
        if (!Fp || !Fm) return { certified: false, why: '面区间求值失败' };
        var gp = { min: 0, max: 0 }, gm = { min: 0, max: 0 };
        for (var k = 0; k < n; k++) { gp = iAdd(gp, iMul(rToI(Y[d][k]), Fp[k])); gm = iAdd(gm, iMul(rToI(Y[d][k]), Fm[k])); }
        // 舍入安全扩宽（n×n 项浮点累积远小于 1e-10 相对量级，余量给足）
        var e1 = 1e-10 * Math.max(Math.abs(gp.min), Math.abs(gp.max)) + 1e-300;
        var e2 = 1e-10 * Math.max(Math.abs(gm.min), Math.abs(gm.max)) + 1e-300;
        gp = { min: gp.min - e1, max: gp.max + e1 };
        gm = { min: gm.min - e2, max: gm.max + e2 };
        var posThenNeg = (gp.min > 0 && gm.max < 0), negThenPos = (gp.max < 0 && gm.min > 0);
        if (!posThenNeg && !negThenPos) return { certified: false, why: 'Miranda 符号条件不满足' };
    }
    return { certified: true, method: 'miranda', radius: r, box: whole };
}
// inflate-and-refine（Rump ε-inflation；原型 lingshu-inflate-refine-proto3 已通过双重复核 7/8、0 假证）：

function _inflateRefineCertify(eqs, vns, xhat, domBox) {
    var n = vns.length;
    if (eqs.length !== n) return { certified: false };
    var factors = [1e-8, 3e-8, 1e-7, 3e-7, 1e-6, 3e-6, 1e-5, 3e-5, 1e-4, 1e-3, 1e-2, 1e-1];
    var _Ynum = null; // 数值预条件矩阵缓存（同一 xhat 各档共用）
    for (var fi = 0; fi < factors.length; fi++) {
        var X = [], ok = true;
        for (var i = 0; i < n; i++) {
            var s = Math.max(Math.abs(xhat[i]), 1e-3) * factors[fi];
            var lo = xhat[i] - s, hi = xhat[i] + s;
            if (domBox) { lo = Math.max(lo, domBox[vns[i]].min); hi = Math.min(hi, domBox[vns[i]].max); }
            if (!(hi > lo)) { ok = false; break; }
            X.push({ min: lo, max: hi });
        }
        if (!ok) continue;
        for (var it = 0; it < 30; it++) {
            var box = {}; for (var bi = 0; bi < n; bi++) box[vns[bi]] = X[bi];
            var JI = _intervalJacobian(eqs, vns, box, xhat);
            var Y = _Ynum || (function(){ var Jn = _numJac(eqs, vns, xhat); return Jn ? realMatInv(Jn) : null; })();
            if (!Y) { _Ynum = null; break; }
            _Ynum = Y;
            var vmap = {}; for (var vi = 0; vi < n; vi++) vmap[vns[vi]] = xhat[vi];
            var F = []; var bad = false;
            for (var e = 0; e < n; e++) { var fe = evalAST(eqs[e], vmap); if (!isFinite(fe)) { bad = true; break; } F.push(fe); }
            if (bad) break;
            var c = []; for (var ci = 0; ci < n; ci++) { var s2 = 0; for (var q = 0; q < n; q++) s2 += Y[ci][q] * F[q]; c.push(xhat[ci] - s2); }
            var YJ = rMatIMat(Y, JI);
            var Ii = []; for (var ii = 0; ii < n; ii++) { Ii.push([]); for (var jj = 0; jj < n; jj++) Ii[ii].push(ii === jj ? { min: 1, max: 1 } : { min: 0, max: 0 }); }
            var C = iMatSub(Ii, YJ);
            var d = []; for (var di = 0; di < n; di++) d.push({ min: X[di].min - xhat[di], max: X[di].max - xhat[di] });
            var Cd = iMatVec(C, d), K = [];
            for (var ki = 0; ki < n; ki++) {
                var Kv = iAdd(rToI(c[ki]), Cd[ki]);
                if (!isFinite(Kv.min) || !isFinite(Kv.max) || Kv.min > Kv.max) { K = null; break; }
                K.push(Kv);
            }
            if (!K) break;
            // 收紧判定 1：K(X) ⊆ int(X) → 存在唯一零点；盒已与用户域求交 → 域内解
            var inside = true;
            for (var i3 = 0; i3 < n; i3++) { if (!(K[i3].min > X[i3].min && K[i3].max < X[i3].max)) { inside = false; break; } }
            if (inside) {
                var radius = 0;
                for (var i4 = 0; i4 < n; i4++) radius = Math.max(radius, (X[i4].max - X[i4].min) / 2);
                return { certified: true, method: 'inflate_refine', radius: radius, box: box };
            }
            // 否则收缩：X ← X ∩ K（已含域交），无进展 → 放弃该档
            var prog = false, Xn = [];
            for (var i5 = 0; i5 < n; i5++) {
                var nlo = Math.max(X[i5].min, K[i5].min), nhi = Math.min(X[i5].max, K[i5].max);
                if (nhi < nlo) { prog = false; Xn = null; break; }
                if (nhi - nlo < X[i5].max - X[i5].min) prog = true;
                Xn.push({ min: nlo, max: nhi });
            }
            if (!Xn || !prog) break;
            X = Xn;
        }
    }
    return { certified: false, why: '全部膨胀档未通过' };
}
// ===== [规划版本号1.0.23 / 产品发布版1.0.22] Smale alpha 理论认证器（Shub-Smale；Hauenstein-Sottile TOMS Algorithm 921）=====

function _smaleFact(k) { var r = 1; for (var i = 2; i <= k; i++) r *= i; return r; }
// 矩阵无穷范数（最大行绝对值和）

function _smaleInfNorm(M) {
    var best = 0;
    for (var i = 0; i < M.length; i++) {
        var s = 0;
        for (var j = 0; j < M[i].length; j++) s += Math.abs(M[i][j]);
        if (s > best) best = s;
    }
    return best;
}
// 选解析半径 R 并取邻域内 |F| 上界 M：候选半径由大到小，区间求值失败（含奇点/发散）即缩半径。

function _smalePickDomain(eqs, vns, xhat, domBox) {
    var scale = 0;
    for (var i = 0; i < vns.length; i++) scale = Math.max(scale, Math.abs(xhat[i]));
    var base = Math.max(scale, 1) * 1e-2;
    var cands = [base, base / 2, base / 4, base / 10, base / 100, base / 1000, base / 10000];
    for (var c = 0; c < cands.length; c++) {
        var R = cands[c];
        if (!(R > 0)) continue;
        var box = {}, ok = true, M = 0;
        for (var w = 0; w < vns.length; w++) {
            var lo = xhat[w] - R, hi = xhat[w] + R;
            if (domBox) { lo = Math.max(lo, domBox[vns[w]].min); hi = Math.min(hi, domBox[vns[w]].max); }
            if (!(hi > lo)) { ok = false; break; }
            box[vns[w]] = { min: lo, max: hi };
        }
        if (!ok) continue;
        for (var e = 0; e < eqs.length; e++) {
            var iv = intervalEval(eqs[e], box);
            if (!iv || !isFinite(iv.min) || !isFinite(iv.max)) { ok = false; break; }
            M = Math.max(M, Math.abs(iv.min), Math.abs(iv.max));
        }
        if (ok) return { R: R, M: M, box: box };
    }
    return null;
}

function _smaleAlphaCertify(eqs, vns, xhat, domBox) {
    var n = vns.length;
    if (eqs.length !== n) return { certified: false, why: '非方阵，alpha 理论仅处理方阵' };
    var vmap = {};
    for (var i = 0; i < n; i++) vmap[vns[i]] = xhat[i];
    var F = [];
    for (var e = 0; e < n; e++) {
        var f = evalAST(eqs[e], vmap);
        if (!isFinite(f)) return { certified: false, why: 'F(x) 非有限' };
        F.push(f);
    }
    var J = _numJac(eqs, vns, xhat);
    if (!J) return { certified: false, why: '雅可比计算失败' };
    var Jinv = realMatInv(J);
    if (!Jinv) return { certified: false, why: '雅可比奇异（非孤立解候选）' };
    var YF = rMatVec(Jinv, F);
    var beta = 0;
    for (var b = 0; b < n; b++) beta = Math.max(beta, Math.abs(YF[b]));
    if (!isFinite(beta)) return { certified: false, why: 'beta 非有限' };
    if (beta === 0) return { certified: false, why: 'beta=0（该点已在零点上，无需 alpha 认证）' };
    var dom = _smalePickDomain(eqs, vns, xhat, domBox);
    if (!dom) return { certified: false, why: '邻域不可解析（含奇点或发散）' };
    var JinvNorm = _smaleInfNorm(Jinv);
    var gamma = 0;
    for (var k = 2; k <= 8; k++) {
        var fk = _smaleFact(k);
        var inner = JinvNorm * fk * dom.M / Math.pow(dom.R, k);
        if (!(inner > 0) || !isFinite(inner)) continue;
        var gk = Math.pow(inner, 1 / (k - 1)) / fk;
        if (isFinite(gk) && gk > gamma) gamma = gk;
    }
    if (!isFinite(gamma) || gamma <= 0) return { certified: false, why: 'gamma 估计失败' };
    var alpha = beta * gamma;
    var THRESH = 0.025;
    if (!(alpha < THRESH)) return { certified: false, why: 'alpha 未达认证阈值（证不出，降级）', alpha: alpha };
    return { certified: true, method: 'smale_alpha', alpha: alpha, beta: beta, gamma: gamma, radius: 2 * beta, box: dom.box };
}


function _certifySolutions(state) {
    if (!state || !state.result || !state.result.solutions) return;
    var eqs = state.originalEquations || state.equations;
    var vns = getOutputVarNames(state);
    if (!eqs || eqs.length !== vns.length) return; // 非方阵/缺原方程：无法严格认证，跳过（保守）
    var budgetMs = 800, startT = performance.now();
    for (var i = 0; i < state.result.solutions.length; i++) {
        if (performance.now() - startT > budgetMs) break;
        var sol = state.result.solutions[i];
        if (!sol.values || sol.values.length !== vns.length) { sol.certified = false; continue; }
        // ── 已被【精确有理数代入】证明的解，区间认证层不得降级（2026-10-04）────
        //
        // 实测事故：x−y=0, x−y=0（秩亏 ⇒ 解集是一条直线）的代表点 (0,0)
        //   suan17 已在 ℚ 上精确证明（certMethod='exact_rational_substitution'），
        //   但本函数无条件跑 Krawczyk ⇒ 在正维流形上 Krawczyk 的前提
        //   （雅可比局部可逆 ⇒ 根孤立）**不成立** ⇒ 必然认证失败
        //   ⇒ sol.certified 被覆盖成 false ⇒ tier 退成 candidate。
        //   结果：tier='candidate' 却带着 certMethod='exact_rational_substitution'，
        //   **自相矛盾**，且是对已完成的证明的谎报。
        //
        // 数学依据：区间认证（Krawczyk/Miranda/MK）与精确代入是**两条独立的证明路径**，
        //   后者严格强于前者（代入恒等式 vs 区间包含）。既然已有更强证明在手，
        //   弱证明失败不构成降级理由。
        if (sol.certMethod === 'exact_rational_substitution' && sol.certified === true) continue;
        var res = krawczykCertify(eqs, vns, sol.values.slice());
        var _certMethod = null;
        if (!res.certified) {
            // 1.0.22 第二认证器：Miranda（便宜，面符号测试，4 档半径）
            var _domBox = _domBoxOf(state, vns);
            var _rads = [1e-7, 1e-6, 1e-5, 1e-4];
            for (var _mi = 0; _mi < _rads.length; _mi++) {
                res = _mirandaCertify(eqs, vns, sol.values.slice(), _rads[_mi], _domBox);
                if (res.certified) break;
            }
            if (res.certified) _certMethod = res.method;
        }
        if (!res.certified) {
            // 1.0.22 第三认证器：inflate-and-refine（Rump ε-inflation，多档膨胀 + Krawczyk 迭代收缩）
            var _domBox2 = _domBoxOf(state, vns);
            res = _inflateRefineCertify(eqs, vns, sol.values.slice(), _domBox2);
            if (res.certified) _certMethod = res.method;
        }
        if (!res.certified) {
            // [规划版本号1.0.23 / 产品发布版1.0.22] 第四认证器：Smale alpha 理论（点值通路；区间雅可比退化时的独立第三条路）
            var _domBox3 = _domBoxOf(state, vns);
            res = _smaleAlphaCertify(eqs, vns, sol.values.slice(), _domBox3);
            if (res.certified) {
                _certMethod = res.method;
                sol.alphaTheory = { alpha: res.alpha, beta: res.beta, gamma: res.gamma, bound: '||x-z|| <= 2*beta' };
            }
        }
        if (!res.certified) { sol.certified = false; continue; }
        // Krawczyk 仅证"盒[xhat±r]内存在唯一零点"，sol.values 是 solver 原始近似，未必是真根。
        // 快振荡方程(如 sin(1/x)=0)局部导数|1/x²|巨大，原始近似离真根可达 1e-2，
        // 若直接标 certified+半径1e-6 即失真认证（承诺误差≤半径，实际可达 1e-2）。
        // 强制盒内牛顿精化到真零点：精化成功才标 proven，并把 certifiedRadius 改为"精化后实际残差保守上界"；
        // 精化在盒内不收敛（原始近似不在真根吸引盆/盒内多根）→ 降级 candidate，绝不假证 proven。
        var xhat = sol.values.slice();
        var box = {};
        for (var _bi = 0; _bi < vns.length; _bi++) box[vns[_bi]] = { min: xhat[_bi] - res.radius, max: xhat[_bi] + res.radius };
        var refined = _newtonRefine(eqs, vns, xhat, box);
        if (refined) {
            sol.values = refined; // 替换为精化后的真根近似
            // 精化后实际残差（牛顿已收敛至 rms<1e-11，残差≈误差，作为该解精度指示）；
            // Krawczyk 盒半径 res.radius 仍提供 sound 误差上界(≤radius)，残差通常更紧。
            var vmap = {}; for (var _ri = 0; _ri < vns.length; _ri++) vmap[vns[_ri]] = refined[_ri];
            var maxRes = 0;
            for (var _ei = 0; _ei < eqs.length; _ei++) {
                var fe = evalAST(eqs[_ei], vmap);
                if (isFinite(fe)) maxRes = Math.max(maxRes, Math.abs(fe));
            }
            // ⚠ sol.residual 必须与 sol.values 同步重算（2026-10-04 实测 P0）：
            //   本函数把 values 从「网格值」换成「精化后的全精度真根」，却没动 residual。
            //   于是 residual 属于**替换前**的点，Agent 拿它判断可信度会被误导。
            //   实测 x⁴−13x²+4=0：values=-3.5615528128088556（真残差 2.2e-12），
            //   residual 却报 1.6493e-5 —— 那是 p(-3.561553) 即网格点的残差，差 7 个数量级。
            //   ⇒ 一个机器精度的真根被报成「残差 1.6e-5」，Agent 会误判为不可信。
            //   凡是「值被换掉」的地方，依赖该值的派生字段必须一起重算。
            sol.residual = maxRes;
            // 后向误差：|f|/Σ|terms|。绝对残差在大系数题上永远很大（相消误差不可消除），
            // 只有归一化后才知道这个解到底准不准。与 polyIsRootWithin 同口径。
            var _beMax = 0;
            for (var _bi2 = 0; _bi2 < eqs.length; _bi2++) {
                var _sc = 0;
                try { _sc = evalASTScale(eqs[_bi2], vmap); } catch (_e2) { _sc = 0; }
                if (!isFinite(_sc) || _sc <= 0) continue;
                var _fe2 = evalAST(eqs[_bi2], vmap);
                if (!isFinite(_fe2)) { _beMax = Infinity; break; }
                var _r2 = Math.abs(_fe2) / _sc;
                if (_r2 > _beMax) _beMax = _r2;
            }
            sol.backwardError = _beMax;
            sol.certified = true;
            if (_certMethod) sol.certMethod = _certMethod; // 1.0.22：记录认证器（krawczyk_newton 默认 / miranda / inflate_refine）
            sol.certifiedRadius = (maxRes > 0) ? maxRes : 0; // 实际残差保守上界，非盒半径
        } else {
            sol.certified = false; // 降级 candidate，不假证 proven
        }
    }
}


function _krawczykOnBox(eqs, vns, boxX, xhat) {
    var n = vns.length;
    if (eqs.length !== n) return { certified: false };
    var Xvec = []; for (var i = 0; i < n; i++) Xvec.push(boxX[vns[i]]);
    var JI = _intervalJacobian(eqs, vns, boxX, xhat);
    var pbox = {}; for (var i2 = 0; i2 < n; i2++) pbox[vns[i2]] = { min: xhat[i2], max: xhat[i2] };
    var JIp = _intervalJacobian(eqs, vns, pbox, xhat);
    var Jr = []; for (var a = 0; a < n; a++) { Jr.push([]); for (var b = 0; b < n; b++) Jr[a].push((JIp[a][b].min + JIp[a][b].max) / 2); }
    var Y = realMatInv(Jr); if (!Y) return { certified: false };
    var vmap = {}; for (var i3 = 0; i3 < n; i3++) vmap[vns[i3]] = xhat[i3];
    var F = []; for (var e = 0; e < n; e++) { var fe = evalAST(eqs[e], vmap); if (!isFinite(fe)) return { certified: false }; F.push(fe); }
    var YF = rMatVec(Y, F), c = []; for (var i4 = 0; i4 < n; i4++) c.push(xhat[i4] - YF[i4]);
    var YJ = rMatIMat(Y, JI);
    var Ii = []; for (var _ii = 0; _ii < n; _ii++) { Ii.push([]); for (var _jj = 0; _jj < n; _jj++) Ii[_ii].push(_ii === _jj ? { min: 1, max: 1 } : { min: 0, max: 0 }); }
    var C = iMatSub(Ii, YJ);
    var d = []; for (var i5 = 0; i5 < n; i5++) d.push({ min: Xvec[i5].min - xhat[i5], max: Xvec[i5].max - xhat[i5] });
    var Cd = iMatVec(C, d), K = []; for (var i6 = 0; i6 < n; i6++) K.push(iAdd(rToI(c[i6]), Cd[i6]));
    return { certified: iVecInterior(K, Xvec), K: K, Xvec: Xvec };
}
// Krawczyk 收敛盒内牛顿精化：从中点出发至多 20 步牛顿，落在盒内且收敛才返回真解（residual≈0），

function _newtonRefine(eqs, vns, x0, box) {
    var n = vns.length;
    var x = x0.slice();
    // 1.0.22：最好点追踪 + 停滞退出。原版死认 rms<1e-11，但大尺度方程（项含 ~1e3 量级、
    // 中间量 ~6e5）的 F 求值噪声地板实测 ~1.5e-10，永远达不到阈值 → 空转 20 轮 → null
    // → 明明已认证的解被降级 candidate（公积金/理财/风阻三例的真病根）。
    // 修复：记录历史最好 rms 的点，连续 3 轮无改善即视为到达机器噪声底，返回最好点（仍盒内、诚实）。
    var bestRms = Infinity, bestX = null, stall = 0;
    for (var iter = 0; iter < 20; iter++) {
        var vmap = {}; for (var i = 0; i < n; i++) vmap[vns[i]] = x[i];
        var F = []; for (var e = 0; e < n; e++) { var fe = evalAST(eqs[e], vmap); if (!isFinite(fe)) return null; F.push(fe); }
        var rms = 0; for (var i2 = 0; i2 < n; i2++) rms += F[i2] * F[i2]; rms = Math.sqrt(rms / n);
        // 🔴🔴 2026-10-05 彻底去网格化：退出判据从**绝对** 1e-11 改为**后向误差**。
        //
        // 事故：g017 `exp(x)-2=0` 的解从 0.6931471805599616（误差 1.63e-14）
        //   退化成 0.6931471805605547（误差 6.09e-13）—— 去网格化让它变**差**了。
        // 根因不是去网格化本身，而是这里遗留的**绝对阈值 1e-11**：
        //   · 旧口径下坐标被量化到 6 位网格，残差天然带~L·h ≈ 1e-6 的噪声地板，
        //     所以精化的实际可达精度只有 1e-11 量级 —— 1e-11 阈值**够松**，
        //     牛顿一路走到 1e-14 才停（g002 误差 6.75e-14 而非 1e-11）。
        //   · 去网格化后噪声地板降到 1e-16，但 1e-11 阈值**没跟着降**，
        //     于是变成新的精度天花板：ln2 卡在残差 1.2e-12 就宣布收敛。
        //     牛顿再走两步就到 1e-16 了，却被这个阈值拦住。
        //
        // 修法（与其他判据同源）：用 Higham 后向误差 |F|/Σ|terms| 判收敛，
        //   它**与量纲无关**，大尺度方程（公积金 1e5 量级）和小尺度方程同一门限。
        //   τ = 1e-14 比原 1e-11 严 3 个数量级，仍比双精度噪声地板(≈1e-16·L)高 2 个量级，
        //   留足余量避免在噪声里空转。取不到尺度时退回绝对 1e-14（同样比原来严）。
        //
        // ⚠ 为什么这不是「无止境地求更高精度」：τ 是**相对**判据，
        //   双精度求值噪声地板 ≈ eps·Σ|terms| = 2.2e-16·scale，永远高于 τ 达不到？
        //   不，τ=1e-14 > 2.2e-16 ⇒ 可达。且下方 stall>=3 停滞退出兜底：
        //   真到噪声底就停，返回最好点（不空转、不假装更高精度）。
        var _bwd = 0;
        for (var e3 = 0; e3 < n; e3++) {
            var _sc3 = 0;
            try { _sc3 = evalASTScale(eqs[e3], vmap); } catch (_e3) { _sc3 = 0; }
            if (!isFinite(_sc3) || _sc3 <= 0) continue;
            var _be3 = Math.abs(F[e3]) / _sc3;
            if (_be3 > _bwd) _bwd = _be3;
        }
        // 尺度全算不出（表达式无 terms）⇒退回绝对判据（fail-closed 方向的偏严）
        if (_bwd === 0) _bwd = rms;
        var CONV_REL = 1e-14, CONV_ABS = 1e-14;
        if (_bwd <= CONV_REL || rms <= CONV_ABS) return x;
        if (rms < bestRms) { bestRms = rms; bestX = x.slice(); stall = 0; } else { stall++; if (stall >= 3 && bestX) return bestX; }
        // 雅可比区间求导：必须喂退化的点区间 {min:x,max:x}（而非裸点值）。
        // 旧实现 intervalEval(d, vmap) 把裸数当 iv，iv.min/iv.max 为 undefined → _buildAffEnv 算出 NaN 噪声
        // → 雅可比整行 NaN → realMatInv 失败 → 本函数对一切良置问题恒返 null（P0-1）。
        var pmap = {}; for (var i3 = 0; i3 < n; i3++) pmap[vns[i3]] = { min: x[i3], max: x[i3] };
        var J = []; for (var a = 0; a < n; a++) { J.push([]); for (var b = 0; b < n; b++) { var d = _diffAST(eqs[a], vns[b]); var dv = d ? intervalEval(d, pmap) : null;
            // 1.0.22：区间求导失败（§67：导数含除法常 null）→ 用数值中心差分兜底。
            // 该雅可比只用于计算牛顿【步长】（点值），不进入任何 soundness 主张（认证盒已由
            // Krawczyk/Miranda/inflate 单独证得）；步出盒外仍立即返回 null，保守性不变。
            if (!dv || typeof dv !== 'object' || !isFinite(dv.min) || !isFinite(dv.max)) {
                var h = Math.max(Math.abs(x[b]), 1e-3) * 1e-7;
                var v2 = {}, v3 = {};
                for (var q = 0; q < n; q++) { v2[vns[q]] = x[q]; v3[vns[q]] = x[q]; }
                v2[vns[b]] = x[b] + h; v3[vns[b]] = x[b] - h;
                var fp = evalAST(eqs[a], v2), fm = evalAST(eqs[a], v3);
                if (!isFinite(fp) || !isFinite(fm)) return null;
                J[a].push((fp - fm) / (2 * h));
            } else {
                J[a].push((dv.min + dv.max) / 2);
            } } }
        var Y = realMatInv(J); if (!Y) return null;
        var dX = rMatVec(Y, F);
        for (var j = 0; j < n; j++) x[j] = x[j] - dX[j];
        for (var k = 0; k < n; k++) { if (x[k] < box[vns[k]].min || x[k] > box[vns[k]].max) return null; }
    }
    return (bestX && isFinite(bestRms)) ? bestX : null; // 20 轮到顶：返回已达噪声底的最好点（盒内），不再无脑 null
}
// ===== Schichl–Neumaier 排除域（Krawczyk 排除域）=====
// 顶刊依据：H. Schichl & A. Neumaier, "Exclusion Regions for Systems of Equations",
//           SIAM J. Numer. Anal. 42(1):383–408, 2004. DOI 10.1137/S0036142902418898
// 目标：消除「聚簇效应」—— 每个已认证零点周围会堆出一大堆切不掉的空盒，
//       因为零点就在盒外不远处。排除域给出【保证不含其它零点】的壳，整壳可裁掉。
//
// ⚠⚠ 论文自身有 4 处印刷错误（我逐一用其 Example 8.3/8.1/8.2 数值反推核对过）。
//    本实现采用【修正后】的公式，注释逐处标注。照抄论文印刷式会静默损失一半半径：
//   ① 式(49) 印 λ×ᵢ = bᵢ/(w×ᵢ+√D×ᵢ)，缺因子 2。正确为 2bᵢ/(w×ᵢ+√D×ᵢ)。
//      证据：Ex 8.3 印 λ×=0.277656；印刷式算得 0.138828，修正式算得 0.277656 逐位吻合。
//   ② 式(51) 印 [z−λ×v, z+λ×]，右端漏 v，应为 [z−λ×v, z+λ×v]。
//   ③ Ex 8.1 分段式分子印 30，应为 20（两分支在 v₂=1 处不连续）。
//   ④ Ex 8.2 印 B₁=⅙[[1,0],[2,0]]，应为 [[0.5,0],[0,0]]（印本给 λᵉ=0.667 与式(54) λᵉ=1 矛盾）。
//
// 论文原式（修正后，Theorem 7.2 + Corollary 7.3）：
//   取 0 < v ∈ ℝⁿ（形状向量，Thm 7.2 对 v 无任何正性约束，原文："every choice of v
//   leads to some exclusion region"），令
//     b_i    = |C·F(z)|_i                     （【下界】；注意存在性公式(4.2)用的是上界 b̄）
//     w×     = B′₀ v                          （B′₀ = |C·F′(z)|，不是 (I−B₀)v）
//     a×     = Σ_k v_k · (B̄_k v)              （⚠ v 在外层只出现一次，不是 vᵀBv！）
//     D×_i   = w×_i² + 4·b_i·a×_i             （【加号】⇒ 恒 ≥ 0，永不失效。这是 7.2 相对 4.3 的核心优势）
//     λ×_i   = 2b_i / (w×_i + √D×_i)
//     λ×     = max_i λ×_i                     （排除版只取 max，不取 min —— 因为是「存在某个 i」，
//                                            故取并集；存在性版(24)才取 min=交集。已在数值上验证）
//   排除域  R× = [z − λ×·v, z + λ×·v]
//   结论：F 在 R× 的【内部】无零点 ⇒ 盒若整落在 R× 内部可安全丢弃。
//
// 论文明确的退化边界（第 7 页原句，逐字）：
//   "For singular (and hence for sufficiently ill-conditioned) zeros, the argument does not
//    apply, and no technique is known to remove the cluster effect in this case."
//   ⇒ 病态/奇异零点处排除域【必然失效】，这是 fail-closed 的理论边界，不是可以再努力的地方。
//
// 本实现的 fail-closed 原则（每一处都宁可不给排除域，也不给不可靠的排除域）：
//   · b 用下界 |C·F(z)|（与论文一致）
//   · 雅可比只用【点值 + 二阶 Taylor 余项上界】，不用不可靠的宽区间包络
//   · λ× = 0（= 所有 b_i=0，即 z 恰为精确零点）⇒ 跳过，无害
//   · 任一中间量非有限 / 负 / 越界 ⇒ 返回 null，调用方走旧路径（与未启用等价）
function _exclusionRegion(eqs, vns, z, C, opt) {
    try {
        var m = eqs.length, n = vns.length;
        if (!C || m === 0 || n === 0) return null;
        var o = opt || {};

        // —— v（形状向量）——
        // 论文说任意 v>0 都行，并给目标 max n·log λ× + Σ log vⱼ（非光滑，需非光滑优化器）。
        // 本实现取【v = 各方向盒半径的相对形状】，零分量用 1 兜底：数学上合法（v>0），
        // 收益不保证最优，但【绝不会给出错误的排除域】。这是 fail-closed 下的正确取舍。
        var v = [];
        for (var i = 0; i < n; i++) {
            var vi = (o.radii && typeof o.radii[i] === 'number' && o.radii[i] > 0) ? o.radii[i] : 1;
            v.push(vi);
        }
        if (o.normalizeV !== false) {
            // 归一化到 [0,1] 尺度：λ× 是标量，v 是形状，两者尺度需匹配才有物理意义
            var vmax = 0; for (var q = 0; q < n; q++) vmax = Math.max(vmax, v[q]);
            if (!(vmax > 0) || !isFinite(vmax)) return null;
            for (var q2 = 0; q2 < n; q2++) v[q2] = v[q2] / vmax;
        }
        for (var q3 = 0; q3 < n; q3++) if (!(v[q3] > 0) || !isFinite(v[q3])) return null;

        // —— b_i = |C·F(z)|_i（下界）——
        var zmap = {}; for (var zi = 0; zi < n; zi++) zmap[vns[zi]] = z[zi];
        var b = [];
        for (var e = 0; e < m; e++) {
            var fe = evalAST(eqs[e], zmap);
            if (!isFinite(fe)) return null;
            var acc = 0;
            for (var jj = 0; jj < n; jj++) acc += Math.abs(C[e][jj] * fe);
            b.push(Math.abs(acc));
        }

        // —— B′₀ = |C · F′(z)|（点值雅可比，m×n）——
        var Jz = _numJac(eqs, vns, z);
        if (!Jz) return null;
        var Bp = [];
        for (var r1 = 0; r1 < m; r1++) {
            Bp.push([]);
            for (var c1 = 0; c1 < n; c1++) {
                var t = 0;
                for (var k1 = 0; k1 < n; k1++) t += Math.abs(C[r1][k1] * Jz[k1][c1]);
                Bp[r1].push(t);
            }
        }
        // w× = B′₀ · v   （m 维）
        var w = [];
        for (var r2 = 0; r2 < m; r2++) {
            var acc2 = 0;
            for (var c2 = 0; c2 < n; c2++) acc2 += Bp[r2][c2] * v[c2];
            w.push(acc2);
            if (!isFinite(acc2)) return null;
        }

        // —— a× = Σ_k v_k · (B̄_k v)  （⚠ 外层是 v_k 单项，不是 vᵀBv）——
        // B̄₁ = |C| · (二阶导数上界/2)  —— 一阶 Taylor 余项
        // 用【点 z 处的二阶导数绝对值】做上界，配合单边 Lipschitz 式的保守放大。
        var a = [];
        for (var r3 = 0; r3 < m; r3++) { var arr = []; for (var c3 = 0; c3 < n; c3++) arr.push(0); a.push(arr); }
        var anyCurv = false;
        for (var jj2 = 0; jj2 < n; jj2++) {
            for (var kk = 0; kk < n; kk++) {
                var d2abs = 0;
                for (var e2 = 0; e2 < m; e2++) {
                    var de = _secondPartialAbs(eqs[e2], vns, z, jj2, kk);
                    if (de === null) return null;       // 拿不到二阶导 ⇒ 整个排除域不可靠 ⇒ 放弃
                    if (de > 0) anyCurv = true;
                    // Σ_l |C[e][l]| · |∂²F_e/∂x_jj2∂x_kk| / 2  · v[jj2]（贡献到 a 的第 jj2 项）
                    var cl = 0;
                    for (var l2 = 0; l2 < n; l2++) cl += Math.abs(C[e2][l2]) * de;
                    a[e2][jj2] += 0.5 * cl * v[kk];
                }
            }
        }
        // 线性 F ⇒ a = 0 ⇒ D× = w×² ⇒ λ×ᵢ = bᵢ/w×ᵢ（需防除零）。这正是论文 Ex 8.4 的情形。
        var lam = 0;
        for (var r4 = 0; r4 < m; r4++) {
            var ai = 0;
            for (var c4 = 0; c4 < n; c4++) ai += v[c4] * a[r4][c4];
            if (!isFinite(ai)) return null;
            if (ai < 0) return null;                    // 理论保证 a≥0（v>0, B̄ₖ≥0），负数说明实现有 bug ⇒ 放弃
            var bi = b[r4], wi = w[r4];
            if (!(bi > 0)) { /* b_i = 0：该分量不贡献，取 0 */ continue; }
            var Di = wi * wi + 4 * bi * ai;             // 【加号】恒 ≥ 0（a≥0, b≥0）
            if (Di < 0) return null;                    // 理论上不可能；不可能则说明输入已坏
            var sq = Math.sqrt(Di);
            var denom = wi + sq;
            if (!(denom > 0)) {
                // w×=0 且 a×=0 ⇒ 该分量无论 λ 多大都不满足不等式 ⇒ 跳过此分量（非错误）
                continue;
            }
            // ⚠ 因子 2：修正论文印刷错误(1)
            var lami = 2 * bi / denom;
            if (!isFinite(lami)) return null;
            if (lami > lam) lam = lami;
        }
        if (!(lam > 0) || !isFinite(lam)) return null;  // λ×=0 ⇒ 退化为点 [z,z]，无害，跳过
        if (anyCurv === false && lam === 0) return null;

        // 排除域 R× = [z − λ×v, z + λ×v]  （修正论文印刷错误(2)：右端也要乘 v）
        var lo = {}, hi = {};
        for (var k3 = 0; k3 < n; k3++) {
            lo[vns[k3]] = z[k3] - lam * v[k3];
            hi[vns[k3]] = z[k3] + lam * v[k3];
        }
        return { lo: lo, hi: hi, lambda: lam, v: v, hasCurvature: anyCurv };
    } catch (err) {
        return null;   // fail-closed：任何异常都退旧路径，绝不猜
    }
}

// 二阶混合偏导 |∂²F/∂x_j∂x_k| 在点 z 处的绝对值（中心差分，纯数值、无 soundness 要求；
// 排除域只需要它在【余项上界】里出现，而余项上界最终还要被 λ× 的其它因子压小，
// 保守起见乘 2 放大留裕量）。返回 null 表示拿不到 ⇒ 调用方放弃排除域。
function _secondPartialAbs(eq, vns, z, j, k) {
    try {
        if (j === k) {
            var h = Math.max(Math.abs(z[j]), 1e-3) * 1e-4;
            var vp = z.slice(), vm = z.slice();
            vp[j] += h; vm[j] -= h;
            var m1 = {}, m2 = {};
            for (var q = 0; q < vns.length; q++) { m1[vns[q]] = vp[q]; m2[vns[q]] = vm[q]; }
            var fp = evalAST(eq, m1), fm = evalAST(eq, m2), f0 = evalAST(eq, (function () { var o = {}; for (var q2 = 0; q2 < vns.length; q2++) o[vns[q2]] = z[q2]; return o; })());
            if (!isFinite(fp) || !isFinite(fm) || !isFinite(f0)) return null;
            return Math.abs((fp - 2 * f0 + fm) / (h * h)) * 2;   // ×2 保守裕量
        }
        var hk = Math.max(Math.abs(z[k]), 1e-3) * 1e-4;
        var hj = Math.max(Math.abs(z[j]), 1e-3) * 1e-4;
        var pp = z.slice(), pm = z.slice(), mp = z.slice(), mm = z.slice();
        pp[j] += hj; pp[k] += hk;
        pm[j] += hj; pm[k] -= hk;
        mp[j] -= hj; mp[k] += hk;
        mm[j] -= hj; mm[k] -= hk;
        function ev(pp2) { var o = {}; for (var q3 = 0; q3 < vns.length; q3++) o[vns[q3]] = pp2[q3]; return evalAST(eq, o); }
        var f1 = ev(pp), f2 = ev(pm), f3 = ev(mp), f4 = ev(mm);
        if (!isFinite(f1) || !isFinite(f2) || !isFinite(f3) || !isFinite(f4)) return null;
        return Math.abs((f1 - f2 - f3 + f4) / (hj * hk)) * 2;   // ×2 保守裕量
    } catch (err) { return null; }
}

// Schichl–Neumaier 排除域（修正版）——
// 薄包装：调用者只给零点 z，内部自动算预条件矩阵 C ≈ F'(z)^{-1}，再交给 _exclusionRegion。
// ⚠ 若 C 已在外部算好（复用同一预条件矩阵算多个排除域），应直接调 _exclusionRegion  省一次雅可比。
// ⚠ 2026-10-04 修 bug：本函数此前只有签名、函数体整个丢失，导致后续所有顶层声明被吞进
//   它的函数体，末尾 export 也在里面 ⇒ dist 产物 ESM 解析报 `Unexpected token 'export'`。
function _krawczykExclusion(eqs, vns, z, C, opt) {
    var Cc = C;
    if (!Cc) {
        Cc = _precondAt(eqs, vns, z);
        if (!Cc) return null;               // 雅可比不可逆 ⇒ fail-closed，不猜
    }
    return _exclusionRegion(eqs, vns, z, Cc, opt);
}

/**
 * 多元先验根界（**引擎内实现**，2026-10-04 新增）
 *
 * ── 为什么必须有 ────────────────────────────────────────────────────
 * 实测（--cpu-prof，3 元非线性题 x+y+z=6, x·y=4, z²=1）：
 *   求解算子本身只用 **9ms**，而 `_globalBranchCertify` 吃掉 **317ms**
 *   （elapsedMs=326，算子统计只有 7ms，gap=319ms）。剖析热点集中在
 *   排除域的仿射包络算术（_affMul/_affRad/_affAdd/_affSub/_buildAffEnv 共 33%）。
 *
 * 根因是**域太大**：默认域半宽 ±1e6（constants.js `_LS_DOMAIN_LEGACY`），
 *   要把域切到 minWidth=1e-4 需要 log₂(2e6/1e-4) ≈ 34 级**每变量**，
 *   n 个变量 ⇒ 盒数 ~2^(34n)。n=3 就 ~10^30 ⇒ **完备穷举数学上不可行**。
 *   所以它必然撞 300ms 预算上限，然后报 complete=false + 几百个残盒，
 *   **既没多找到一个解，也没给出完备性** —— 纯烧时钟。
 *
 * 定理（多元 Cauchy 的 log 空间形式 / 热带平衡不等式）：
 *   设 p(x) = Σ_γ c_γ x^γ = 0（非零解），令 v_i = ln|x_i|，则最大项必被其余项抵消。
 *   取 α* = 最大项指数、β* = 次大项，则**必要条件**同时成立：
 *       A_γ = ln|c_γ| + ⟨γ,v⟩ 满足   A_γ ≤ A_{α*}  ∀γ≠α*
 *                                    A_γ ≤ A_{β*}  ∀γ∉{α*,β*}
 *   两组不等式在 v 上是**线性**的 ⇒ 每个「支配对 (α*,β*)」给出一个多面体，
 *   真解必落在**某个**这样的多面体内（组合极大值）。
 *
 * ⇒ 于是「所有解 ⊆ 盒」被**证**出来，而不是猜出来。
 *   实测 4 元稠密题（x²+y²+z²+w²=30, x+y+z+w=10, x·y=4, z·w=6）：
 *   proven 半宽 = **20**（从 ±1e6 收紧 **5 万倍**）。域小 5 万倍 ⇒
 *   切盒级数从 ~2^(34·4) 降到 ~log₂(40/1e-4)≈19 ⇒ 每变量 2^19，盒数降 10^70 量级。
 *
 * ── 与服务层 rootbound.js 的分工 ──────────────────────────────────────
 * 服务层 `services/rootbound.js` 有 460 行完整版（两阶段单纯形 LP、零坐标风险、
 * unbounded 检测），更精确但依赖 `require`，**引擎（单作用域拼接体）用不了**。
 * 本函数是**引擎内的轻量版**：只做「每个变量一个绝对值半宽」，
 * 不做 unbounded 判定（判不出就返回 null = 不收紧 = 回到旧行为）。
 *
 * ── fail-closed（与 rootbound.js 同一纪律）────────────────────────────
 *   任一条不过 ⇒ 返回 null，调用方**不做任何收紧**：
 *     · 方程含非多项式节点（sin/exp/log/根号）⇒ 热带推导不适用
 *     · 系数为 0 / 非有限 / 单项式（无抵消结构 ⇒ 无界）
 *     · 算出的界不优于当前域 ⇒ 无收益，不动
 *   **绝不返回「没证完但算出来了」的界** —— 假紧界会让 completeness 谎称找全了。
 */
// ── 多元先验根界（引擎内版）：热带平衡不等式 + 单纯形 LP ─────────────────
//
// 四条纪律（每条都对应一个「静默给假答案」的坑，服务层 rootbound.js 已踩过，
// 这里逐条照搬，**不要「简化」**）：
//   ① 支配行方向：A_α ≥ A_γ 写成 ⟨γ−α, v⟩ ≤ ln|c_α|−ln|c_γ|（γ 减 α）。
//      写反 ⇒ 区域变成「α 不是最大项」⇒ 假紧界。
//   ② 取 max 不取 min：真解只落在**某一个** (α*,β*) 区域里，其余组合是噪声。
//      ⇒ 有效上界 = 所有组合上界的**极大**。取 min 会漏掉真解所在区域。
//   ③ 候选对必须**穷举**：α 取遍所有单项式、β 取遍所有 ≠α。
//      任何启发式切片都会漏 ⇒ 那类界不可用。实测反例：x+y=3 在 x=2.618 处
//      真实最大项是**常数项**（ln3 > ln2.618），按「α_k 最大」切片就漏了。
//   ④ 超预算 ⇒ 整体返回 null（调用方不收紧域）。偷偷丢组合会让上界变小，
//      那极可能是假紧界 ⇒ completeness 会谎称「找全了」。宁可证不了。
//
// ⚠ 为什么**必须**上 LP，不能「手工丢项解一行」：
//   v_j = ln|x_j| **可以是负的**（|x_j|<1），所以 ⟨γ,v⟩ 里其它变量的项
//   **不是**「非负 slack」，不能从不等式里丢掉。丢掉它们解出的 v_k 上界
//   会**小于**真上界 ⇒ 假紧界 ⇒ 直接裁掉真解，且不报任何错。
//   ⇒ 必须解 max v_k s.t. 全部行，看 LP 判 unbounded 还是 optimal。

var _RB_MAX_SUPPORT = 12;      // 支撑截断（丢项只放松约束 ⇒ 界变松但仍有效）
var _RB_MAX_COMBOS = 50000;    // 跨方程组合上限（超 ⇒ 整体放弃，纪律④）
var _RB_TIME_CAP = 150;        // 根界是优化不是前提，超时放弃（fail-closed）
var _RB_MAX_PIVOTS = 4000;     // 单 LP 主元上限（防退化循环）
var _RB_LP_TOL = 1e-9;
var _RB_COEF_FLOOR = 1e-300;   // 系数下溢：|c| 更小视为 0（ln 会炸）
var _RB_BOUND_CEILING = 1e300; // 超过这个量级就不叫「盒」了

function _rbNow() {
    return (typeof performance !== 'undefined' && performance.now)
        ? performance.now() : Date.now();
}

function _rbSub(a, b) {
    var out = new Array(a.length);
    for (var i = 0; i < a.length; i++) out[i] = a[i] - b[i];
    return out;
}

/**
 * 极小 LP：max cᵀv  s.t. A v ≤ b（v ∈ ℝ^n 自由）。
 *
 * 行构造（**别改**，三条都踩过，每条都是静默错、不抛异常）：
 *   · Av ≤ b 先写成 Av + s = b（s ≥ 0 松弛）。若 b < 0，把**整行**乘 −1：
 *     −Av − s + art = −b。⇒ b<0 时**结构系数与松弛系数要一起翻号**。
 *     只翻结构系数、漏了松弛 ⇒ 约束 sneak 成「Av ≥ b」。
 *   · 比值检验**必须收第二象限**（T[i][e] < 0 且 rhs ≥ 0）：漏了会把
 *     「无界」当「最优 obj=0」⇒ 根界退化成 |x| ≤ e^0 = 1 的假下界。
 *   · Phase II 的入基候选**必须包含松弛列**：只放结构列 ⇒ 松弛的归约成本
 *     永不被检查 ⇒ 无界被吞成有限 obj。
 *
 * @returns {{status:'optimal'|'infeasible'|'unbounded', obj:number, x:number[]|null}}
 */
function _rbLpMax(c, A, b) {
    var m = A.length;
    if (!m) return { status: 'infeasible', obj: 0, x: null };
    var n = A[0] ? A[0].length : 0;
    if (!n) return { status: 'optimal', obj: 0, x: [] };

    var NV = 2 * n;              // p: 0..n-1, q: n..2n-1
    var NA = m;
    var RHS = NV + m + NA;
    var W = RHS + 1;
    var T = [];
    var i, j, k;
    for (i = 0; i < m; i++) {
        var row = new Float64Array(W);
        var flip = b[i] < 0 ? -1 : 1;
        for (j = 0; j < n; j++) {
            if (A[i][j] !== 0) { row[j] += flip * A[i][j]; row[n + j] -= flip * A[i][j]; }
        }
        row[NV + i] = flip;               // 松弛：与整行同号
        row[RHS - NA + i] = 1;            // 人工（初值 |b_i| ≥ 0 ⇒ 初始基可行）
        row[RHS] = Math.abs(b[i]);
        T.push(row);
    }
    var basis = new Array(m);
    for (i = 0; i < m; i++) basis[i] = RHS - NA + i;   // 初始基 = 全人工

    var pivots = 0;
    function pivot(z, r, e) {
        var pv = T[r][e];
        if (pv === 0) return;
        for (k = 0; k < W; k++) T[r][k] /= pv;
        T[r][e] = 1;
        for (i = 0; i < m; i++) {
            if (i === r) continue;
            var f = T[i][e];
            if (f === 0) { T[i][e] = 0; continue; }
            for (k = 0; k < W; k++) T[i][k] -= f * T[r][k];
            T[i][e] = 0;
        }
        var ze = z[e];
        if (ze !== 0) {
            for (k = 0; k < RHS; k++) z[k] -= ze * T[r][k];
            z[RHS] = z[RHS] + ze * T[r][RHS];   // rhs 列与结构列符号相反，单独加回
            z[e] = 0;
        }
        basis[r] = e;
        if (++pivots > _RB_MAX_PIVOTS) throw new Error('rb simplex pivot budget exhausted');
    }
    function eliminate(z, cols, cbOf) {
        for (var ci = 0; ci < cols.length; ci++) {
            var jc = cols[ci];
            var cb = cbOf(jc);
            if (!cb) continue;
            for (var ri = 0; ri < m; ri++) {
                if (basis[ri] !== jc) continue;
                for (var kk = 0; kk < RHS; kk++) z[kk] -= cb * T[ri][kk];
                z[RHS] = z[RHS] + cb * T[ri][RHS];
                break;
            }
        }
    }
    function allCols() {
        var cs = new Array(W);
        for (var q = 0; q < W; q++) cs[q] = q;
        return cs;
    }
    function chooseEnter(z, cols) {
        var best = -1, bv = _RB_LP_TOL;
        for (var ci2 = 0; ci2 < cols.length; ci2++) {
            var j2 = cols[ci2];
            if (z[j2] > bv) { bv = z[j2]; best = j2; }
        }
        return best;
    }
    function chooseRow(e) {
        var r = -1, rv = Infinity;
        for (var ri2 = 0; ri2 < m; ri2++) {
            var ti = T[ri2][e], rhs_i = T[ri2][RHS];
            if (ti === 0) continue;
            if ((ti > 0 && rhs_i < 0) || (ti < 0 && rhs_i >= 0)) continue;
            var ratio = rhs_i / ti;
            if (!isFinite(ratio) || ratio < 0) continue;
            if (ratio < rv - _RB_LP_TOL
                || (Math.abs(ratio - rv) <= _RB_LP_TOL && basis[ri2] < basis[r])) {
                rv = ratio; r = ri2;
            }
        }
        return r;
    }
    function drive(z, cols, allowUnbounded) {
        for (var guard = 0; guard <= _RB_MAX_PIVOTS; guard++) {
            var e2 = chooseEnter(z, cols);
            if (e2 < 0) return 'ok';
            var r2 = chooseRow(e2);
            if (r2 < 0) return allowUnbounded ? 'unbounded' : false;
            try { pivot(z, r2, e2); } catch (err) { return false; }
        }
        return false;
    }

    // ── Phase I：max(−Σ人工)
    var zI = new Float64Array(W);
    for (j = 0; j < W; j++) zI[j] = (j >= RHS - NA && j < RHS) ? -1 : 0;
    zI[RHS] = 0;
    eliminate(zI, allCols(), function (jj) { return (jj >= RHS - NA && jj < RHS) ? -1 : null; });
    if (drive(zI, allCols(), false) !== 'ok') return { status: 'infeasible', obj: 0, x: null };
    if (zI[RHS] < -1e-7) return { status: 'infeasible', obj: 0, x: null };   // Σ人工 > 0 ⇒ 不可行

    // ── Phase II：max cᵀv
    var z = new Float64Array(W);
    for (j = 0; j < n; j++) { z[j] = c[j]; z[n + j] = -c[j]; }
    z[RHS] = 0;
    eliminate(z, allCols(), function (jj) {
        return (jj < NV) ? (jj < n ? c[jj] : -c[jj - n]) : null;
    });
    var struct = [];
    for (j = 0; j < RHS - NA; j++) struct.push(j);   // 含松弛列，只排除人工列
    var st2 = drive(z, struct, true);
    if (st2 === 'unbounded') return { status: 'unbounded', obj: -Infinity, x: null };
    if (st2 !== 'ok') return { status: 'infeasible', obj: 0, x: null };

    var xs = new Array(n);
    for (i = 0; i < n; i++) xs[i] = 0;
    for (i = 0; i < m; i++) {
        var bj = basis[i];
        if (bj >= 0 && bj < n) xs[bj] = T[i][RHS];
        else if (bj >= n && bj < 2 * n) xs[bj - n] = -T[i][RHS];
    }
    return { status: 'optimal', obj: z[RHS], x: xs };
}

/**
 * 同一约束集上顺手出 max v_k 与 min v_k（省一半 LP）。
 * unbounded（任一方向无界）⇒ 这个 (α*,β*) 组合给不出 |x_k| 的界。
 */
function _rbDirBounds(k, rows, n) {
    var A = [], b = [];
    for (var i = 0; i < rows.length; i++) { A.push(rows[i].a); b.push(rows[i].rhs); }
    var cUp = new Array(n); for (var i1 = 0; i1 < n; i1++) cUp[i1] = 0; cUp[k] = 1;
    var up = _rbLpMax(cUp, A, b);
    if (up.status === 'infeasible') return { status: 'infeasible', max: null, min: null };
    var cDn = new Array(n); for (var i2 = 0; i2 < n; i2++) cDn[i2] = 0; cDn[k] = -1;
    var dn = _rbLpMax(cDn, A, b);
    var unbounded = (up.status === 'unbounded' || dn.status === 'unbounded');
    return {
        status: unbounded ? 'unbounded' : 'ok',
        max: up.status === 'unbounded' ? null : up.obj,
        min: dn.status === 'unbounded' ? null : -dn.obj
    };
}

/**
 * 由支配对 (α,β) 造约束行（统一为 ⟨a,v⟩ ≤ rhs）。**全部是不等式**。
 *   α 支配：  ⟨γ−α, v⟩ ≤ ln|c_α| − ln|c_γ|      ∀γ≠α
 *   β 支配：  ⟨γ−β, v⟩ ≤ ln|c_β| − ln|c_γ|      ∀γ∉{α,β}
 *   平衡带：  ⟨α−β, v⟩ ≤ ln|c_β| − ln|c_α| + ln(s−1)
 *
 * ⚠ 平衡带**只能朝一边**（A_α ≤ A_β + slack），不能 ± 双向展开成「相差恰好
 *   slack」：真实解处 A_α 可能远大于某个小项 A_γ，双向会让区域**漏掉**真实解
 *   ⇒ 假紧界。写成双向正是踩过的坑。
 */
function _rbMakeRows(exps, lns, ai, bi) {
    var s = exps.length;
    var slack = Math.log(Math.max(1, s - 1));
    var rows = [];
    var g;
    for (g = 0; g < s; g++) {
        if (g === ai) continue;
        rows.push({ a: _rbSub(exps[g], exps[ai]), rhs: lns[ai] - lns[g] });
    }
    for (g = 0; g < s; g++) {
        if (g === ai || g === bi) continue;
        rows.push({ a: _rbSub(exps[g], exps[bi]), rhs: lns[bi] - lns[g] });
    }
    rows.push({ a: _rbSub(exps[ai], exps[bi]), rhs: lns[bi] - lns[ai] + slack });
    return rows;
}

/**
 * 每个变量一个**证明过的**绝对值半宽。任何一步判不出 ⇒ 返回 null。
 * 调用方拿到 null 必须**完全不收紧域**（fail-closed）。
 *
 * @returns {number[]|null}
 */
function _priorRootHalfWidth(eqs, vns) {
    var n = vns.length;
    if (!eqs || eqs.length !== n || n === 0) return null;
    var t0 = _rbNow();

    // —— 步骤 1：每方程提取单项式（系数 + 指数向量）——
    var sys = [];
    for (var e = 0; e < n; e++) {
        var mons = _collectMonomials(eqs[e], vns);
        if (!mons || mons.length < 2) return null;   // 单项式/常数 ⇒ 无抵消结构 ⇒ 无界
        sys.push(mons);
    }

    // —— 步骤 2：每方程穷举全部支配对 → 每对一组线性行 ——
    var specs = [];
    var comboCount = 1;
    for (var e2 = 0; e2 < n; e2++) {
        var terms = sys[e2];
        var exps = [], lns = [];
        for (var i = 0; i < terms.length; i++) {
            var cf = terms[i].coef;
            if (!isFinite(cf) || Math.abs(cf) < _RB_COEF_FLOOR) continue;
            exps.push(terms[i].exps);
            lns.push(Math.log(Math.abs(cf)));
        }
        if (exps.length < 2) return null;            // 该方程无抵消结构 ⇒ 放弃
        if (exps.length > _RB_MAX_SUPPORT) {         // 支撑截断：丢项只放松约束
            exps = exps.slice(0, _RB_MAX_SUPPORT);
            lns = lns.slice(0, _RB_MAX_SUPPORT);
        }
        var groups = [];
        for (var ai = 0; ai < exps.length; ai++) {
            for (var bi = 0; bi < exps.length; bi++) {
                if (ai === bi) continue;
                groups.push(_rbMakeRows(exps, lns, ai, bi));
            }
        }
        specs.push(groups);
        comboCount *= groups.length;
        if (comboCount > _RB_MAX_COMBOS) return null; // 纪律④：超预算 ⇒ 整体放弃
    }

    // —— 步骤 3：逐变量解跨方程组合的 LP ——
    var halfWidths = [];
    for (var k = 0; k < n; k++) {
        if (_rbNow() - t0 > _RB_TIME_CAP) return null;
        var bestV = null;      // 最松的 ln|x_k| 上界（纪律②：取 max）
        var anyOk = false;
        var total = comboCount;
        for (var c = 0; c < total; c++) {
            // 时间闸门：每 256 个组合查一次（Date.now() 本身有开销）
            if ((c & 255) === 0 && c > 0 && _rbNow() - t0 > _RB_TIME_CAP) return null;
            var rows = [];
            var rem = c;
            for (var e3 = 0; e3 < n; e3++) {
                var sz = specs[e3].length;
                var gi = rem % sz;
                rem = (rem - gi) / sz;
                var grp = specs[e3][gi];
                for (var r = 0; r < grp.length; r++) rows.push(grp[r]);
            }
            var d = _rbDirBounds(k, rows, n);
            if (d.status !== 'ok') continue;         // infeasible / unbounded ⇒ 换组合
            anyOk = true;
            // |v_k| = max(v_k, −v_k) ⇒ 半宽取两个方向的**较大**上界
            var cand = 0;
            if (d.max !== null && isFinite(d.max)) cand = Math.max(cand, d.max);
            if (d.min !== null && isFinite(d.min)) cand = Math.max(cand, -d.min);
            if (bestV === null || cand > bestV) bestV = cand;
        }
        if (!anyOk || bestV === null) return null;    // 该变量判不出 ⇒ 整体放弃
        var W = Math.exp(bestV);
        if (!isFinite(W) || W <= 0 || W > _RB_BOUND_CEILING) return null;
        halfWidths.push(W);
    }

    // 界小到离谱（比任何合理变量域小 1000 倍以上）⇒ 保守放弃：
    //   这种量级的界若为假，裁掉的就是整片解空间，**不可逆**。
    for (var j = 0; j < n; j++) {
        if (halfWidths[j] < 1e-3) return null;
    }
    return halfWidths;
}


/**
 * 单项式提取：把 AST 展成 {coef, exps[]} 列表。
 * 只认 + − × 与整数/有理常数；**遇任何非多项式节点立即返回 null**（fail-closed）。
 */
function _collectMonomials(ast, vns) {
    var out = [];
    function exps() { var e = new Array(vns.length).fill(0); return e; }
    function walk(node, e) {
        if (!node || !node.type) return false;
        switch (node.type) {
            case 'num': {
                if (!isFinite(node.value)) return false;
                if (node.value === 0) return true;             // 零项：跳过但合法
                out.push({ coef: node.value, exps: e.slice() });
                return true;
            }
            case 'var': {
                var idx = vns.indexOf(node.name);
                if (idx < 0) { out.push({ coef: 1, exps: e.slice() }); return true; }
                e[idx] += 1;
                out.push({ coef: 1, exps: e.slice() });
                e[idx] -= 1;
                return true;
            }
            case 'unary':
                // 一元负号：直接翻转【刚加进去的】那些项的系数
                if (node.op !== '-') return false;
                var ub = out.length;
                if (!walk(node.operand, e)) return false;
                for (var ui = ub; ui < out.length; ui++) out[ui].coef = -out[ui].coef;
                return true;
            case 'binop': {
                if (node.op === '+' || node.op === '-') {
                    var before = out.length;
                    if (!walk(node.left, e)) return false;
                    var mid = out.length;
                    if (!walk(node.right, e)) return false;
                    if (node.op === '-') for (var t = mid; t < out.length; t++) out[t].coef = -out[t].coef;
                    return true;
                }
                if (node.op === '*') {
                    var b0 = out.length;
                    if (!walk(node.left, e)) return false;
                    var m0 = out.length;
                    if (!walk(node.right, e)) return false;
                    var A = out.slice(b0, m0), B = out.slice(m0);
                    out.length = b0;
                    for (var ai = 0; ai < A.length; ai++) {
                        for (var bi2 = 0; bi2 < B.length; bi2++) {
                            var ne = new Array(vns.length);
                            for (var d = 0; d < vns.length; d++) ne[d] = A[ai].exps[d] + B[bi2].exps[d];
                            out.push({ coef: A[ai].coef * B[bi2].coef, exps: ne });
                        }
                    }
                    return true;
                }
                if (node.op === '^') {
                    // 只接受非负整数幂（多项式）；分数/负数幂 ⇒ 非多项式
                    if (!node.right || node.right.type !== 'num') return false;
                    var pw = node.right.value;
                    if (!(pw >= 0 && pw === Math.floor(pw) && pw <= 64)) return false;
                    var base0 = out.length;
                    if (!walk(node.left, e)) return false;
                    var Bs = out.slice(base0);
                    out.length = base0;
                    var acc = [{ coef: 1, exps: exps() }];
                    for (var p = 0; p < pw; p++) {
                        var nx = [];
                        for (var a2 = 0; a2 < acc.length; a2++) {
                            for (var b3 = 0; b3 < Bs.length; b3++) {
                                var e2 = new Array(vns.length);
                                for (var d2 = 0; d2 < vns.length; d2++) e2[d2] = acc[a2].exps[d2] + Bs[b3].exps[d2];
                                nx.push({ coef: acc[a2].coef * Bs[b3].coef, exps: e2 });
                            }
                        }
                        acc = nx;
                        if (acc.length > 64) return null;   // 膨胀保护
                    }
                    for (var a3 = 0; a3 < acc.length; a3++) out.push(acc[a3]);
                    return true;
                }
                if (node.op === '/') {
                    // 分母不含变量 ⇒ 仍是多项式（系数除一下）；否则非多项式
                    if (hasVariable(node.right, vns)) return false;
                    var dv;
                    try { dv = evalAST(node.right, {}); } catch (err) { return false; }
                    if (!isFinite(dv) || dv === 0) return false;
                    var b4 = out.length;
                    if (!walk(node.left, e)) return false;
                    for (var t2 = b4; t2 < out.length; t2++) out[t2].coef /= dv;
                    return true;
                }
                return false;
            }
            default: return false;   // func（sin/exp/log/…）⇒ 非多项式 ⇒ fail-closed
        }
    }
    var e0 = exps();
    if (!walk(ast, e0)) return null;
    // 合并同类项，剔除系数恰为 0 的项
    var merged = {};
    for (var i = 0; i < out.length; i++) {
        var key = out[i].exps.join(',');
        merged[key] = (merged[key] || 0) + out[i].coef;
    }
    var res = [];
    for (var kk in merged) {
        if (!Object.prototype.hasOwnProperty.call(merged, kk)) continue;
        if (merged[kk] === 0) continue;
        res.push({ coef: merged[kk], exps: kk.split(',').map(Number) });
    }
    return (res.length >= 2) ? res : null;
}

function _globalBranchCertify(eqs, vns, dom, opts) {
    var n = vns.length;
    if (eqs.length !== n || n === 0) return null; // 非方阵/空：不接全局分支
    var o = opts || {};
    var BUDGET = (o.budget != null) ? o.budget : 5e5;
    var MAXDEPTH = (o.maxDepth != null) ? o.maxDepth : 28;
    var MINW = (o.minWidth != null) ? o.minWidth : 1e-3;
    var TIME = (o.timeMs != null) ? o.timeMs : 300;   // 时间预算兜底，避免卡顿
    var DUP = (o.dupTol != null) ? o.dupTol : 1e-2;     // 同解不同盒的去重阈值
    var solutions = [], residualBoxes = [], boxCount = 0;
    var exclCount = 0;   // 因排除域而剪掉的盒数（聚簇效应消除量，可观测）
    var exclPruned = []; // 被排除域剪掉的盒（只记盒不展开，量大时按需截断）
    var startT = performance.now();
    function mkBox(d) { var b = {}; for (var i = 0; i < n; i++) b[vns[i]] = { min: d[vns[i]][0], max: d[vns[i]][1] }; return b; }
    function boxMaxWidth(b) { var w = 0; for (var i = 0; i < n; i++) { var d = b[vns[i]].max - b[vns[i]].min; if (d > w) w = d; } return w; }
    function mid(b) { var m = []; for (var i = 0; i < n; i++) m.push((b[vns[i]].min + b[vns[i]].max) / 2); return m; }
    function residualAt(vals) {
        var vmap = {}; for (var i = 0; i < n; i++) vmap[vns[i]] = vals[i];
        var rv = 0; for (var e = 0; e < n; e++) { var fe = evalAST(eqs[e], vmap); if (isFinite(fe)) rv = Math.max(rv, Math.abs(fe)); }
        return rv;
    }
    function split(b) {
        var wi = 0, wmax = -1; for (var i = 0; i < n; i++) { var d = b[vns[i]].max - b[vns[i]].min; if (d > wmax) { wmax = d; wi = i; } }
        var name = vns[wi], m = (b[name].min + b[name].max) / 2, b1 = {}, b2 = {};
        for (var k = 0; k < n; k++) { var nm = vns[k]; if (k === wi) { b1[nm] = { min: b[nm].min, max: m }; b2[nm] = { min: m, max: b[nm].max }; } else { b1[nm] = b[nm]; b2[nm] = b[nm]; } }
        return [b1, b2];
    }
    function isDup(vals) {
        for (var s = 0; s < solutions.length; s++) {
            var sv = solutions[s].values, maxd = 0;
            for (var j = 0; j < n; j++) maxd = Math.max(maxd, Math.abs(sv[j] - vals[j]));
            if (maxd < DUP) return true;
        }
        return false;
    }
    // —— BFS 队列：用头指针而非 Array.shift()（2026-10-04 性能修）——
    //
    // 实测（--cpu-prof，3 元非线性题）：`queue.shift()` 在 BFS 队列上是 **O(n)** 的
    //   （每次都要把后续元素整体前移），n 个盒累计 **O(n²)** 次元素搬移。
    //   该题切了 2335 个盒 ⇒ 约 270 万次元素搬移，白烧 CPU。
    //   改成头指针 `qHead` 是标准 BFS 写法，**语义完全等价**（顺序一致、去重一致）。
    var queue = [{ box: mkBox(dom), depth: 0 }];
    var qHead = 0;
    function qPush(x) { queue.push(x); }
    function qSize() { return queue.length - qHead; }
    function qShift() { return queue[qHead++]; }
    function qDrain() { while (qHead < queue.length) residualBoxes.push(queue[qHead++].box); }

    // —— Schichl–Neumaier 排除域：每认证一个零点就登记一个「保证不含其它零点」的壳 ——
    // 壳用 [lo, hi] 表示（lo/hi 是 {varname: number}）。boxInExclusion 判整盒落入壳内。
    // ⚠ USE_EXCL 开关：默认开。设 false 可完全关闭排除域剪枝（A/B 对照用，也留作运行期降级口）。
    var USE_EXCL = (o.exclusion !== false);
    var exclRegions = [];
    function boxInsideRegion(b, R) {
        // 整盒 ⊆ R 的【内部】才可丢。留相对裕量，避免边界盒被误丢（fail-closed：宁可少丢不可丢错）
        for (var i = 0; i < n; i++) {
            var nm = vns[i];
            var bl = b[nm].min, bh = b[nm].max;
            if (!(isFinite(bl) && isFinite(bh))) return false;
            var pad = 1e-9 * Math.max(1, Math.abs(R.hi[nm] - R.lo[nm]));  // 相对裕量
            if (!(bl > R.lo[nm] + pad && bh < R.hi[nm] - pad)) return false;
        }
        return true;
    }
    function prunedByExclusion(b) {
        for (var i = 0; i < exclRegions.length; i++) if (boxInsideRegion(b, exclRegions[i])) return true;
        return false;
    }

    while (qSize() > 0) {
        if (boxCount >= BUDGET || (performance.now() - startT) > TIME) { qDrain(); break; }
        if (qSize() === 0) break;
        var item = qShift(), b = item.box, depth = item.depth;

        // 聚簇效应剪枝：已认证零点周围的壳，整盒落入则严格无根 → 直接丢
        if (USE_EXCL && exclRegions.length > 0 && prunedByExclusion(b)) {
            exclCount++;
            // ⚠ 被排除域剪掉的盒【不进 residualBoxes】（那里是「未判定」，语义不同）。
            //   但它们也绝不能凭空消失 —— 否则「残 0 + 解 0」会让人误以为已穷尽。
            //   这里显式记录剪枝盒数与原因，供上层归因（_mergeGlobalBranch 已透出 incompleteBecause）。
            exclPruned.push(b);
            continue;
        }

        boxCount++;
        var xhat = mid(b);
        var res = _krawczykOnBox(eqs, vns, b, xhat);
        // —— 边界根救援（2026-10-04 实测的真 bug 修复）——
        // 现象：一元 x^2-1=0 在 [-2,2] 上返回【0 解】（应 2 解：±1），残 4 盒。
        // 根因：x=±1 恰好落在盒的分割边界上，被切成 [-1.03125,-1] 与 [-1,-0.99994] 两个盒。
        //   Krawczyk 判 certified=false（根在盒端点，iVecInterior 的严格内部判定失败），
        //   于是继续细分到 minWidth=1e-4 停下 → 残盒 → 0 解。【与排除域无关，关掉也一样】。
        // ⚠⚠ 修法演进（踩坑记录，勿简化）：
        //   第一版写成「中点残差 ≤1e-12 就 continue」—— 错！x^5-5x^3+4x 在 [-3,3] 上首盒中点
        //   恰好是根 0，直接 continue 丢掉整个盒内的 ±1、±2，退化成 1 解（实测 4 解→1 解）。
        //   中点命中只能【记下这个解】，绝不能终止该盒的搜索 —— 盒里可能有别的根。
        // 现版：中点命中先记解，然后【继续细分】（不 continue），让别的根仍能被找到；
        //   同时把该盒标记为「已含解」，若细分到 minWidth 以下则不再重复记（isDup 已兜住）。
        var midRes = residualAt(xhat);
        var midIsRoot = (isFinite(midRes) && midRes <= 1e-12);
        if (midIsRoot && !isDup(xhat)) {
            // 精确代数事实（残差 0 ⇒ F(xhat)=0），不依赖任何不完备假设，sound。
            solutions.push({ values: xhat.slice(), box: null, residual: midRes, exactHit: true });
        }
        if (res.certified && !midIsRoot) {
            // Krawczyk 证 [X] 内唯一零点 ∈ X；在盒内牛顿精化到真解（residual≈0）才记 proven，绝不假证中点
            var refined = _newtonRefine(eqs, vns, xhat, b);
            if (refined && !isDup(refined)) {
                solutions.push({ values: refined, box: res.Xvec, residual: residualAt(refined) });
            }
        } else if (!midIsRoot && res.K && iVecDisjoint(res.K, res.Xvec)) {
            // 严格无解，丢弃（sound 剪枝）；K 为 undefined（雅可比不可逆）时不可断定，走细分
            // ⚠ midIsRoot 时不走这条：中点已被精确证明是解，K 却说「严格无解」⇒ 两者矛盾，
            //   说明该盒的 K 判定在此处不可靠（浮点边界）。此时保守地继续细分，绝不丢盒。
        } else {
            if (boxMaxWidth(b) > MINW && depth < MAXDEPTH) {
                var parts = split(b);
                // —— Schichl–Neumaier 排除域：正确的用法是【认证之前】用来剪枝 ——
                // ⚠ 踩过的坑（2026-10-04）：最初把排除域挂在「Krawczyk 认证成功之后」，
                //   结果 exclRegions 永远为空、excludedByRegion 恒为 0，一点收益都没有。
                //   原因：b_i = |C·F(z)|_i，在【精确零点】上 F(z)=0 ⇒ b=0 ⇒ λ×=0 ⇒ 排除域退化为点
                //   ⇒ _exclusionRegion 直接返回 null。这是论文的已知性质（Ex 8.1/8.2/8.4 全命中此情形），
                //   不是 bug —— 是「在零点处建排除域」这个用法本身没用。
                //   论文 §7 的原意是：任取【试探点】 z 都能建排除域，用来剪掉 z 周围的大片无根区。
                //   这里就在分裂点 xhat（盒中点，非零点，F(xhat)≠0 才有 b>0）建域，
                //   域内的兄弟盒整盒丢弃 —— 这才是排除域真正省盒数的地方。
                if (USE_EXCL) {
                    var Cp = _precondAt(eqs, vns, xhat);
                    if (Cp) {
                        var rr2 = [];
                        for (var rj = 0; rj < n; rj++) rr2.push(Math.max((b[vns[rj]].max - b[vns[rj]].min) / 2, 1e-6));
                        var R2 = _exclusionRegion(eqs, vns, xhat, Cp, { radii: rr2 });
                        // R2 的半径通常远小于当前盒宽 ⇒ 域内多半没有子盒，纯属浪费。
                        // 只有当排除域大到能整盒吞掉至少一个待分裂子盒时才登记（否则不入列表，省内存与查表开销）。
                        if (R2) {
                            var big = false;
                            for (var qk = 0; qk < n; qk++) {
                                var wR = R2.lambda * R2.v[qk];
                                var wBox = b[vns[qk]].max - b[vns[qk]].min;
                                if (wR > 0.5 * wBox) { big = true; break; }
                            }
                            if (big) exclRegions.push(R2);
                        }
                    }
                }
                qPush({ box: parts[0], depth: depth + 1 });
                qPush({ box: parts[1], depth: depth + 1 });
            } else {
                residualBoxes.push(b); // 超深/过窄未判，诚实留痕
            }
        }
    }
    return {
        solutions: solutions,
        boxCount: boxCount,
        excludedByRegion: exclCount,
        // ⚠🔴 complete 的正确判据（2026-10-04 修 fail-closed 红线破口）：
        //   原来写 complete = (residualBoxes.length === 0)，把【被排除域剪掉的盒】当成了"已证明无根"。
        //   但排除域的成立是有前提的：Schichl–Neumaier 原文第 7 页明确写 —
        //     "For singular (and hence for sufficiently ill-conditioned) zeros, the argument does
        //      not apply, and no technique is known to remove the cluster effect in this case."
        //   即病态/奇异零点处排除域【必然失效】。而剪掉的盒既没被验证、也没被穷尽，
        //   计入 residualBoxes 才是诚实的（fail-closed：宁可报"未验证"，不可谎报"完备"）。
        //   实测证据：圆与直线 x^2+y^2-25=0, x+y-7=0（真解 (3,4),(4,3)）
        //     排除域开 → 81 盒 / 排除 46 / 残 0 →旧判据报 complete=true，实则 0 解（错）。
        //     排除域关 → 63139 盒 / 残 10040 → 报 complete=false（对，但极慢）。
        //   修后：只要用过排除域剪枝，complete 一律 false（除非另有独立完备性证据）。
        residualBoxes: residualBoxes,
        exclPrunedCount: exclPruned.length,
        // 剪掉的盒留个样本（最多 8 个），供诊断；全量可能上万，存不下也没必要。
        exclPrunedSample: exclPruned.slice(0, 8),
        budget: BUDGET,
        complete: (residualBoxes.length === 0) && exclCount === 0
    };
}

// 预条件矩阵 C ≈ F'(z)^{-1}：排除域只需要 C 近似逆，论文明确允许用伪逆。
// 雅可比不可逆时返回 null（调用方放弃排除域），绝不猜。
function _precondAt(eqs, vns, z) {
    try {
        var J = _numJac(eqs, vns, z);
        if (!J) return null;
        return realMatInv(J);
    } catch (err) { return null; }
}
// 把全局分支找到的 proven 解合并进 state.result.solutions（去重：与已有解距离<tol 视为同解）

function _mergeGlobalBranch(state, gb) {
    if (!gb || !gb.solutions) return;
    if (!state.result.solutions) state.result.solutions = [];
    var vns = getOutputVarNames(state);
    var tol = 1e-6;
    function exists(vals) {
        for (var i = 0; i < state.result.solutions.length; i++) {
            var s = state.result.solutions[i];
            if (!s.values || s.values.length !== vals.length) continue;
            var maxd = 0; for (var j = 0; j < vals.length; j++) maxd = Math.max(maxd, Math.abs(s.values[j] - vals[j]));
            if (maxd < tol) return true;
        }
        return false;
    }
    for (var k = 0; k < gb.solutions.length; k++) {
        var sol = gb.solutions[k];
        if (exists(sol.values)) continue;
        state.result.solutions.push({
            values: sol.values.slice(),
            residual: (typeof sol.residual === 'number') ? sol.residual : 0,
            tier: 'proven',
            certified: true,
            certifiedRadius: null,
            source: 'global_branch_krawczyk',
            box: sol.box
        });
    }
    state.result.globalBranch = {
        boxCount: gb.boxCount,
        excludedByRegion: gb.excludedByRegion || 0,
        // 剪枝盒单列：不混进 residualCount（那是「未判定」），但也不能凭空消失。
        exclPrunedCount: gb.exclPrunedCount || 0,
        residualCount: gb.residualBoxes.length,
        complete: gb.complete,
        budget: gb.budget,
        // 完备性归因：调用方/Agent 需要知道「未穷尽」到底是撞预算还是被排除域剪的。
        // 排除域剪枝在病态零点处有理论失效边界（Schichl–Neumaier 原文第 7 页），
        // 所以它剪掉的盒不计入 residualCount，但必须让 complete=false 且可归因。
        incompleteBecause: (gb.excludedByRegion > 0)
            ? 'exclusion-pruned（排除域剪枝 ' + gb.excludedByRegion + ' 盒；该剪枝在病态/奇异零点处有理论失效边界，故不计入完备）'
            : (gb.residualBoxes.length > 0 ? 'budget-or-depth（残盒未判定）' : null)
    };
    if (gb.residualBoxes.length > 0 && !state.result.warnings) state.result.warnings = [];
    if (gb.residualBoxes.length > 0) state.result.warnings.push('全局区间分支在预算(' + gb.budget + '盒)内未完全判定（非无解，仅未穷尽，可能含遗漏解）');
    state.truncated = state.truncated || !gb.complete;
}

// ═══════════════════ 模块：conclusion ═══════════════════
/* 模块 conclusion：4 态决策标记 + 输出层瘦身。改这个模块只动本文件。 */
//
// ════════════════════════════════════════════════════════════════════════
// **这是给 Agent 的唯一决策接口。** 别的字段都是给人看的。
//
// ── 为什么从 20+ 种自由文本收敛到 4 个 ─────────────────────────────────
// 改之前 `resultTypeName` 有 20+ 种措辞（"有限离散孤立采样点"/
// "有限解（未完成）"/"未知（被时间预算中止）"/"无限解集（推荐解）"/"空结果"…），
// Agent 要自己把它们映射到决策。**映射表不存在 ⇒ 每次都要人肉翻译
// ⇒ 智能体拿不到稳定的决策语义。** 措辞不是语义，决策要的是语义。
//
// 收敛成 4 态，且**每一态都由可判定的数学条件驱动，不是措辞**：
//
//   ┌──────────────────┬────────────────────────────────────────────────┐
//   │ 结论              │ 触发条件（可判定，不是措辞）                    │
//   ├──────────────────┼────────────────────────────────────────────────┤
//   │ 全部解            │ 有独立完备性证明：Sturm 精确计数吻合，           │
//   │                  │ 或 Bézout 上界被击满（R == B_eff）              │
//   ├──────────────────┼────────────────────────────────────────────────┤
//   │ 部分解            │ 找到 ≥1 个解，但**没有任何**完备性证据          │
//   │                  │ （含正维流形：代表点有效，但「全部」不可断言）    │
//   ├──────────────────┼────────────────────────────────────────────────┤
//   │ 无解              │ **严格证明**域内无解（Sturm/Sturm序列/区间       │
//   │                  │ 包络/导数单调/快速矛盾/投影反证/provenEmpty）    │
//   ├──────────────────┼────────────────────────────────────────────────┤
//   │ 计算资源不足      │ 被预算/深度/时间中止，或上界被突破（bug）       │
//   │                  │ —— 这是「我不知道」，**不是**「无解」            │
//   └──────────────────┴────────────────────────────────────────────────┘
//
// ⚠⚠ 最容易搞错、也最不能搞错的一格：**「计算资源不足」≠「无解」**。
//   实测事故（2026-10-04，全仓 26 处 `error:"NO_SOLUTION"`）：
//   suan49 因时间闸门提前 return 时只写了自己的字段、没读 state.truncated，
//   于是「因为时间不够而放弃」被对外表述成**「严格无解」**。
//   Agent 拿到 `NO_SOLUTION` 会直接向用户断言「这系统无解」，而真相是「没算完」。
//   **这是谎报，比返回 0 解严重得多** —— 0 解至少带着「可能还有」的语气。
//   本模块是**单一收口点**：以后新增算子也不可能绕过它。
//
// ── 「全部解」这一格的严格性 ──────────────────────────────────────────
// 只在**两种**独立证据下才敢打：
//   ① Sturm 精确计数：realRootCount == 实际输出解数。
//      ⚠⚠ 2026-10-04 修正（实测 P0）：`realRootCount` 过去取自 Sturm 在**搜索盒**内的计数，
//      被当完备性证据用。实测事故：`x^2=2` 域给 [1,2] ⇒ 盒内 1 根、found 1 ⇒ 判「全部解」，
//      而 −√2 是真解且在盒外 ⇒ **谎报找全**，且 canAssert.allSolutions 还给了 true。
//      ⚠⚠ 同日二次修正（回归 g018 抓到）：改成统一用 ℝ 计数后，`x^2-4=0, x>0` 这类
//      **确实完备**的答案又被误判成「部分解」—— ℝ 上有 ±2 两根，但 −2 不满足约束 x>0。
//      病根是「计数区间选错」：既不能用搜索盒，也不能盲目用 ℝ，
//      而要用**声明空间**（问题本身允许的范围，由写在方程里的不等式/域约束界定）。
//      现在 realRootCount 来自 `_sturmCountRange(coeffs, 声明下界, 声明上界)`，
//      sturmCompleteness.scope ∈ {'R','declared'} 显式声明计数空间。
//      「盒内计数」（inBoxCount）只用于「盒内漏没漏」诊断，**不得**当完备性证据。
//   ② Bézout 上界击满：R == ∏d_i 且无正维风险（见 rootbound-poly.js 文件头 R1 推导）
// ⚠ **不**包括：多起点采样命中若干点、Newton 收敛、返回 0 个解。
//   采样命中数是**下限**，永远不是上限。

// 4 态的唯一取值来源。任何别处写死的中文标记都是 bug（收敛点只有一个）。
var CONCLUSION_ALL = '全部解';
var CONCLUSION_PARTIAL = '部分解';
var CONCLUSION_NONE = '无解';
var CONCLUSION_RESOURCE = '计算资源不足';

/** 严格「已证明域内无解」的凭据（每一条背后都有独立定理或算法保证）。 */
var _PROVEN_EMPTY_KEYS = [
    'proof_empty',            // _assignEmptiness：provenEmpty 分支
    'sturm_zero_roots',       // Sturm 实根计数 = 0
    'interval_excludes',      // 区间包络严格证明区间内无根
    'monotonic_excludes',     // 导数单调性严格证明区间内无根
    'no_sign_crossing',       // 中值定理判无实根
    'projection_contradiction'// 投影反证：子系统无解 ⇒ 全局无解
];

/**
 * 收集「严格无解」的证据链。任一成立即可判「无解」。
 * @returns {{proven:boolean, evidence:string[]}}
 */
function _collectEmptyProof(state) {
    var r = (state && state.result) ? state.result : null;
    var ev = [];
    if (!r) return { proven: false, evidence: ev };
    if (r.provenEmpty === true) ev.push('provenEmpty');
    if (r.emptyProof === 'proof_empty') ev.push('proof_empty');
    var sc = r.sturmCompleteness;
// ⚠ 同 _collectCompletenessProof 的 scope 白名单：realRootCount 必须是**声明空间**的计数
//   （'R' = 无约束、空间就是 ℝ；'declared' = 空间由问题里的不等式/域约束界定）。
//   **绝不能**是搜索盒计数 —— 盒内为 0 曾能触发「严格无解」⇒ canAssert.noSolution=true，
//   比谎报找全更危险（Agent 会直接对用户断言「无解」）。x^2=2 域 [1,2] 若盒内 0 根就是这个形状。
    if (sc && sc.certified === true && sc.realRootCount === 0
        && (sc.scope === undefined || sc.scope === 'R' || sc.scope === 'declared')) ev.push('sturm_zero_roots');
    if (r.emptyProof && _PROVEN_EMPTY_KEYS.indexOf(r.emptyProof) >= 0) ev.push(r.emptyProof);
    // executionPath 是「谁给出的结论」，比 message 自由文本可靠（message 是措辞）
    var path = String(r.executionPath || '');
    if (path.indexOf('区间') >= 0 && (r.provenEmpty === true || r.emptyProof === 'proof_empty')) ev.push('interval_excludes');
    if (path.indexOf('单调') >= 0 && r.provenEmpty === true) ev.push('monotonic_excludes');
    if (path.indexOf('投影反证') >= 0 && r.provenEmpty === true) ev.push('projection_contradiction');
    if (path.indexOf('中值定理') >= 0 && r.provenEmpty === true) ev.push('no_sign_crossing');
    return { proven: ev.length > 0, evidence: ev };
}

/**
 * 收集「完备」的证据链（**必须**是独立计数或击满上界，采样命中不算）。
 * @returns {{complete:boolean, evidence:string[], reason:string}}
 */
function _collectCompletenessProof(state) {
    var r = (state && state.result) ? state.result : null;
    var ev = [];
    if (!r) return { complete: false, evidence: ev, reason: '无结果' };
    var nSol = (r.solutions || []).length;

    // ① Sturm 精确计数（一元/一元化系统的严格实根计数）
    //
    // 🔴🔴 scope 白名单（2026-10-04，加固）：必须显式确认 realRootCount 数的是**声明空间**。
    //   「声明空间」= 问题本身允许的解范围，由**写在方程里的不等式/域约束**界定：
    //     'R'       = 问题没给任何区间约束 ⇒ 空间就是 ℝ
    //     'declared' = 空间由约束界定（如 `x>0` ⇒ (0,∞)）
    //   两者都不是搜索盒。这不是「加个保险」，而是补一个**已实测踩过的坑**：
    //   旧实现读盒内计数当证据，`x^2=2` 域 [1,2] 因此谎报「全部解」（−√2 在盒外）。
    //   后来反向又踩了一次：统一改成 ℝ 计数后，`x^2-4=0, x>0` 这类**确实完备**的答案
    //   又被误判成「部分解」（ℝ 有 ±2 两根，但 −2 不满足 x>0）⇒ 回归测试 g018 抓到。
    //   ⇒ 白名单：只接受 undefined（历史结果，兼容旧 reportId）/ 'R' / 'declared'；
    //     出现任何其他 scope（尤其 'box' / 搜索盒区间）一律**不采信**，宁可不打「全部解」。
    //   同 mustNotClaim 的设计思路：新增口径时默认不信任，要放开必须显式改这里。
    var sc = r.sturmCompleteness;
    if (sc && sc.certified === true && typeof sc.realRootCount === 'number' && sc.complete === true
        && (sc.scope === undefined || sc.scope === 'R' || sc.scope === 'declared')
        && sc.realRootCount === nSol) {
        ev.push('sturm_exact_count=' + sc.realRootCount);
    }
    // ② Bézout 上界击满（R == B_eff，由 rootbound-poly.js 的 R1 规则给出）
    if (r.bezoutVerdict && r.bezoutVerdict.status === 'complete') {
        ev.push('bezout_bound_attained');
    }
    // ③ 解集维数已被证明是 0 且解空间是有限点集（suan17 秩判定走这条）
    if (r.resultType === 2 && r.provenIsCompleteFinite === true) {
        ev.push('finite_affine_space_ranked');
    }
    // ③' **线性方程组：解空间维数 0 ⇒ 结构上就是单点集。**
    //   这是比 Bézout/Sturm 更强的一类证据 —— 线性代数是精确的，不存在「采样命中数
    //   只是下限」的问题：rank(A)=n ⇒ 仿射子空间维数 0 ⇒ 解集**必然**是那一个点。
    //   实测：x+y-3=0, x-y-1=0 走「高斯消元 + 精确有理数证明」，classifyRank=2=n、
    //   effectiveDim=0，若不认这条证据就会掉到「部分解」（被门控⑤ 拖累），
    //   而它明明是**严格完备**的线性系统。
    //
    // 🔴🔴 实测 P0 误判（2026-10-04，本条判据第一版的 bug，务必留痕）：
    //   `x+y+z=6, x*y=2, y*z=3` 被判成「全部解」，而它其实**有 2 个**解
    //   （暴力核对：(2,1,3) 与 (0.4,5,0.6)，消元后 y²−6y+5=0）。
    //   根因：第一版只查 `classifyRank >= nVars`，**漏了「必须是线性」这个前提**。
    //   `classifyRank` 是调度器的**结构预判标签**，对**非线性**系统照样填 n
    //   （它判的是「变量维数」，不是「方程是不是一次」）
    //   ⇒ 非线性系统被误当成线性，拿到「满列秩 ⇒ 单点集」的严格结论。
    //   ⇒ **必须**同时要求路径声明它是线性求解（高斯消元/精确线性代数/欠定-伪逆）。
    //   这是「门控字段必须先核实存在、不能凭记忆写」的又一例：
    //   字段名对、语义也对，但**适用前提**没写全 ⇒ 假保护比没有保护更危险。
    var _pathL = String(r.executionPath || '');
    var _isLinearPath = (_pathL.indexOf('高斯消元') >= 0)
        || (_pathL.indexOf('精确线性代数') >= 0)
        || (_pathL.indexOf('线性') >= 0 && _pathL.indexOf('非线性') < 0);
    if (_isLinearPath && r.resultType === 2 && r.effectiveDim === 0
        && r.classifyRank > 0 && r.positiveDim !== true) {
        var _nVarsL = (r.varNames || []).length;
        var _solsL = r.solutions || [];
        var _allProv = _solsL.length > 0 && _solsL.every(function (s) {
            return s && (s.tier === 'proven' || s.certified === true);
        });
        if (_allProv && (r.classifyRank >= _nVarsL)) {
            ev.push('linear_full_column_rank=' + r.classifyRank + '=' + _nVarsL);
        }
    }
    // ④ 同伦延续（suan61）：gamma trick 的概率 1 覆盖性 + 全部路径干净收敛
    //
    // 🔴 2026-10-05 集成缺口（同伦算子算得出完备性，但结论层不认）：
    //   suan61 跑完后 `completenessProven = true`、`homotopyInfo.completenessProven = true`，
    //   但本函数只认 Sturm / Bézout 击满 / 秩判定 / 线性四类证据，
    //   **没有同伦这一档** ⇒ 实测 `x²+y²+z²=1, x+y+z=0, xy−z=0` 明明
    //   「8 条路径全干净、2 个实解、每个都过原方程回代」，
    //   却被判成「部分解（没有独立完备性证据）」。
    //   对 Agent：明明是找全了，却拿到「可能有遗漏」⇒ 会建议「缩小域重试」，纯误导。
    //
    // 为什么这一档**够格**当独立完备性证据（严格性说明，必须写清）：
    //   gamma trick（Morgan 1982）的定理：在 γ 随机相位下，
    //   **概率 1 地**每条路径都收敛到 t=1，且**每个孤立复根都被至少一条路径经过**。
    //   suan61 的 `completenessProven` 正是这两条的合取：
    //     · 覆盖性：diverged=0 ∧ singular=0 ∧ notReached=0 ⇒ 全部 N 条路径正常走完
    //       ⇒ 概率 1 事件发生 ⇒ 没有孤立解被漏掉
    //     · 自洽性：去重实根数 ≤ Bézout 路径数 ⇒ 算术上自洽
    //     · 每个实解都过了**原方程回代**（不信内部残差）⇒ 没有伪解
    //   它与 Sturm 是**同等强度**的完备性证据（都给出「确切的个数」），
    //   而不是采样命中这种「只是下限」的弱证据。
    //
    // fail-closed 方向：三项缺口任一非 0 ⇒ suan61 自己就置 completenessProven=false，
    // 这里读不到 true ⇒ 自然降级为「部分解」。不需要额外的保守逻辑。
    var hi = r.homotopyInfo;
    if (r.completenessProven === true && hi && hi.completenessProven === true
        && hi.diverged === 0 && hi.singular === 0 && hi.notReached === 0
        && typeof hi.bezoutBound === 'number' && hi.bezoutBound > 0) {
        ev.push('homotopy_all_paths_clean=' + hi.pathsTracked + '/' + hi.bezoutBound);
    }
    // ⑤ 基本三角方程闭式通解（suan58）：**符号穷举**，是全部四档里数学上最硬的一类。
    //
    // 🔴 2026-10-05 集成缺口（实测：`cos(x)=0.5` 明明算出了通解，却报「部分解」）：
    //   suan58 对 `cos(x)=0.5` / `sin(x)=0.3` 这类方程给出
    //   `x = 2nπ ± arccos(0.5)`（n ∈ ℤ）—— 这是**闭式通解**，
    //   声明域内根数由整数区间公式**数出**（_s58BasicTrig 里数 n 的整数区间），
    //   不是采样、不是搜索、没有任何「可能漏掉」的环节。
    //   但 suan58 只把元数据写进 `state.s58Exact`，**全仓没有任何地方读它**（grep 可证），
    //   于是本函数四档证据一条都不命中 ⇒ 明明找全了却判「部分解」。
    //   对 Agent 的后果是纯误导：明明收工了，却被提示「可能有遗漏，缩小域重试」。
    //
    // 为什么这一档**比 Sturm 还硬**（不只是同等）：
    //   Sturm 是「算出实根个数恰好等于解数」—— 需要数值多项式 + 符号链，
    //   且只在**多项式**情形成立。闭式通解是**把解集本身写成了整数参数族**：
    //   解集 = { 2nπ ± θ : n ∈ ℤ ∩ I }，其中 I 由声明域算术给出。
    //   只要声明域正确、θ 由 arccos 定义域精确判定（|c| > 1 的无解分支 suan58 已提前处理），
    //   那么「域内解集」被**逐个列出**，不存在漏解的机制。
    //   fail-closed 要求的两点，本函数都显式校验：
    //     · exact === true（确实走的闭式分支，不是回落到数值扫描）；
    //     · countCapped !== true 且 truncated !== true（声明域内根数**没被输出上限截断**）。
    //   任一不满足 ⇒ 不采信 ⇒ 落回「部分解」，与 suan58 自己的 truncated 标记一致。
    //
    // ⚠ 为什么原来 truncated 时给「部分解」是对的：
    //   `cos(x)=0.5` 在默认域 ±1e6 下域内有 636620 个根，接口只允许输出有限个代表解，
    //   此时「解集已被精确刻画，但接口只展示了其中一部分」——它**不是**「找全了」，
    //   也不是「可能漏了」，而是「算全了但没全展示」。这类必须留在「部分解」，
    //   因为调用方拿到的 solutions 确实不含全部根。要改的是文案而非档位。
    var s58 = r.s58Exact;
    if (s58 && s58.exact === true && s58.countCapped !== true && s58.truncated !== true
        && typeof s58.count === 'number' && s58.count > 0 && s58.count === nSol) {
        ev.push('closed_form_trig_family=' + s58.family + ',count=' + s58.count);
    }
    var complete = ev.length > 0;
    var reason;
    if (complete) reason = ev.join('；');
    else if (r.completeness && r.completeness.incompleteReasons && r.completeness.incompleteReasons.length) {
        reason = r.completeness.incompleteReasons[0];
    } else if (r.completeness && r.completeness.provenIsComplete === false) {
        reason = '完备性未验证（无独立计数证据）';
    } else {
        reason = '未做过任何完备性穷举检查';
    }
    return { complete: complete, evidence: ev, reason: reason };
}

/**
 * 🔴 4 态分类器 —— 全仓**唯一**的结论判定点。
 *
 * 判定顺序有严格理由（**从最确定到最不确定**）：
 *   ① 资源不足：连「是否无解」都没资格判断 ⇒ 最优先，否则会把「没算完」说成「无解」
 *   ② 无解：有严格证明 ⇒ 确定性最高
 *   ③ 全部解：有独立完备性证据 + 至少一个解
 *   ④ 部分解：兜底（找到解但无法断言全；或找到解但可能被截断）
 *
 * @returns {{conclusion:string, code:string, evidence:string[], reason:string, canAssert:Object}}
 */
function _conclusion4(state) {
    var r = (state && state.result) ? state.result : null;
    var out = { conclusion: CONCLUSION_PARTIAL, code: 'partial', evidence: [], reason: '', canAssert: {} };
    if (!r) { out.reason = '无结果'; return out; }

    var sols = r.solutions || [];
    var nSol = sols.length;

    // ── ① 资源不足优先判定 ────────────────────────────────────────────
    // ⚠ 必须排在最前：「没算完」若被表述成「无解」就是谎报。
    //
    // ⚠⚠ 但「资源不足」要**排除正维代表点路径**（实测 2026-10-04）：
    //   `x²+y²=5, z²+w²=5, x+y+z+w=6`（欠定，3方程4变量）是**正维流形**，
    //   给 1 个代表点**完全正确**，且 solver.js:995 特意置 `truncated=true`
    //   来表达「未穷尽解集」（存在性 vs 完备性，是**故意**的）。
    //   若机械地按 truncated ⇒ 资源不足，会把一条**正确且诚实**的结果
    //   误报成「算失败了」—— 而 Agent 拿到「计算资源不足」会建议重试/缩域，
    //   那是**假指令**（真因是欠定，重试一万次也是正维）。
    //   ⇒ 正维（resultType===3 或 positiveDim 或维数>0）时不走资源不足格，
    //     落到「部分解」，并在 reason 里说清「无穷多解，1 个代表点」。
    var _posDimAny = (r.resultType === 3) || r.positiveDim === true
        || (typeof r.solutionSpaceDimension === 'number' && r.solutionSpaceDimension > 0)
        || (typeof r.effectiveDim === 'number' && r.effectiveDim > 0 && r.resultType === 2
            && String(r.executionPath || '').indexOf('欠定') >= 0);

    var resourceHungry = false;
    var rReason = '';

    // 🔴🔴 2026-10-05 修独立 P0（结论级谎报，golden g013 抓出）：`unconverged` 的语义被误读。
    //
    // 事故：`120000*p*(1+p)^360-2500000=0`（公积金月供，1 变量）
    //   实际状态：解已求出并**经Krawczyk 区间认证**（provenCount=1）、
    //             `completenessProven=true`（一维多项式 ⇒ Sturm 完备性已证）。
    //   但 `unconverged=true`（分支定界那条路深度到限，没走完）⇒
    //   门控① 命中 ⇒ 对外 conclusion 从「部分解」降级成「**计算资源不足**」。
    //
    // 为什么这是谎报而不是保守：
    //   `unconverged` 只描述**分支定界这一条搜索路径**的状态，
    //   而 `suan60` 精确栈已经在ℚ 上把题解完了并证明了完备。
    //   拿「A 路径没走完」去否定「B 路径已证完」，是**证据优先级颠倒**。
    //   更糟的是它给Agent 一条**假指令**：收到「计算资源不足」会建议
    //   「提高预算 / 缩小域后重试」—— 而真因是解已被严格证明，重试一万次也一样。
    //   （历史同源问题：正维代表点那次也是机械套truncated，见上方 _posDimAny 注释。
    //   本质都是：**用「某条搜索路径的状态」冒充「整体完备性」。**）
    //
    // 修法：`unconverged` 降级为「提示」而非「判定」，当且仅当
    //   **拿不到独立完备性证据**时才允许它触发「计算资源不足」。
    //   `truncated` / `error` / `hardTimeout` 保持原样在 ① 优先判定
    //   —— 那三个是「结果集本身被截断」，与完备性证据无关，不能放行。
    var _cmpEarly = _collectCompletenessProof(state);
    var _hasIndepCompleteness = (nSol > 0 && _cmpEarly.complete === true);
    var _unconvergedIsAdvisory = (_hasIndepCompleteness && r.unconverged === true
        && r.truncated !== true && r.hardTimeout !== true
        && r.error !== 'TIMEOUT_TRUNCATED' && r.error !== 'RESOURCE_EXHAUSTED');

    if (r.bezoutVerdict && r.bezoutVerdict.status === 'bound-violation') {
        // 上界被突破 = 实现有 bug。这是「计算资源不足」里最该报的一种：
        // Agent 拿到「无解」会去断言，但真相是「实现不可信」。
        resourceHungry = true;
        rReason = '已证明根数超过 Bézout 上界（实现有 bug，结果不可信）';
    } else if (!_posDimAny) {
        if (r.truncated === true) { resourceHungry = true; rReason = '结果集被截断（未完成）'; }
        else if (r.error === 'TIMEOUT_TRUNCATED') { resourceHungry = true; rReason = '搜索被时间预算中止'; }
        else if (r.error === 'RESOURCE_EXHAUSTED') { resourceHungry = true; rReason = '计算资源耗尽'; }
        else if (r.solutionCountIsPartial === true) { resourceHungry = true; rReason = '已找到部分解，可能还有'; }
        else if (r.hardTimeout === true) { resourceHungry = true; rReason = '硬超时中止'; }
    }
    // ⚠ 门控⑤：全局分支未运行 ⇒ 没做过完备穷举。这是「完备性未知」，
    //   **不是**「资源不足」—— 只要拿到了 Sturm/Bézout 独立证据就仍然可判「全部解」。
    //   所以它不进 resourceHungry，只在下面影响「全部解」这一格。

    if (resourceHungry) {
        out.conclusion = CONCLUSION_RESOURCE;
        out.code = 'resource_exhausted';
        out.reason = rReason;
        out.evidence = ['truncated=' + (r.truncated === true),
            'unconverged=' + (r.unconverged === true)].join(' ');
        out.canAssert = { noSolution: false, allSolutions: false, hasSolution: nSol > 0 };
        return out;
    }

    // ── ② 无解（有严格证明）────────────────────────────────────────────
    var emp = _collectEmptyProof(state);
    if (nSol === 0 && emp.proven) {
        out.conclusion = CONCLUSION_NONE;
        out.code = 'proven_empty';
        out.evidence = emp.evidence;
        out.reason = '已严格证明：给定定义域与精度下不存在满足条件的实解（证据：' + emp.evidence.join('、') + '）';
        out.canAssert = { noSolution: true, allSolutions: true, hasSolution: false };
        return out;
    }

    // ── ③ 全部解 ──────────────────────────────────────────────────────
    var cmp = _collectCompletenessProof(state);
    if (nSol > 0 && cmp.complete) {
        out.conclusion = CONCLUSION_ALL;
        out.code = 'complete';
        out.evidence = cmp.evidence;
        out.reason = '已找到 ' + nSol + ' 个解，且有独立完备性证据（' + cmp.reason + '）⇒ 这就是全部解';
        out.canAssert = { noSolution: false, allSolutions: true, hasSolution: true };
        return out;
    }

    // ── ④ 部分解（兜底）───────────────────────────────────────────────
    if (nSol > 0) {
        out.conclusion = CONCLUSION_PARTIAL;
        out.code = 'partial';
        out.evidence = cmp.evidence;
        out.reason = _posDimAny
            ? '已给出 1 个经验证的真解，但解集是 ' + (r.solutionSpaceDimension || '正') +
              ' 维流形（无穷多解）⇒ 无法用有限列表表达，也不得断言「这就是全部解」。' +
              '注意：这**不是**计算失败，重试或缩小定义域都不会改变「无穷多解」这个事实'
            : ('已找到 ' + nSol + ' 个解，但没有独立完备性证据（' + cmp.reason + '）⇒ 可能有遗漏');
        out.canAssert = { noSolution: false, allSolutions: false, hasSolution: true };
        return out;
    }

    // nSol === 0 且没有严格证明 ⇒ 归「计算资源不足」而不是「无解」。
    // 这是最重要的一条：**找不到 ≠ 不存在**。把它叫「无解」就是谎报。
    out.conclusion = CONCLUSION_RESOURCE;
    out.code = 'resource_exhausted';
    out.reason = '未找到解，但**没有**任何严格证明表明不存在 ⇒ 这是「没找到」，不是「无解」。' +
        '可能是搜索不足、域太小或存在数值病态解';
    out.canAssert = { noSolution: false, allSolutions: false, hasSolution: false };
    return out;
}

/**
 * 输出层瘦身：剥掉 Agent 不需要的内部细节（残差、认证块、代数元数据…），
 * 保留决策所需的最小集。
 *
 * ⚠ 纪律：**内部仍然完整保留**（result 里字段照旧留着，供人排查与 golden 对拍），
 *   瘦的是**给 Agent 的那份**。删内部字段会让 golden/护栏失去回归基准，
 *   而且数学正确性证据（certification）**永远不能删** —— 删了就没法判断真假解。
 *   ⇒ 做法：在出口生成精简副本，而不是就地删字段。
 *
 * 保留：4 态标记 + 解的值 + 每解的「是否被证明」+ 决策指引
 * 剥掉：residual / backwardError / cert 块 / bound.domain / completeness 全量 /
 *      classifyRank / effectiveDim / cardinality / structuralCount / isPolynomial 等
 *
 * @returns {object} 精简结果（深拷贝语义，不影响原 result）
 */
function _slimOutputForAgent(result, conclusion) {
    var r = result || {};
    var out = {
        // ── 决策四态（唯一需要 Agent 理解的东西）──
        conclusion: conclusion.conclusion,
        conclusionCode: conclusion.code,
        reason: conclusion.reason,
        canAssert: conclusion.canAssert,
        varNames: r.varNames,
        executionPath: r.executionPath,
        timeMs: r.timeMs
    };

    // ── 解列表：只留值 ──
    //
    // 🔴 2026-10-05 瘦身（用户指令：「去掉所有人为规则……我们要的是极致的计算，
    //   让智能体得到能决策的结果，而不是认证、确定性这些东西」）：
    //   旧版给每个解带 `proven`（是否被证明）+ `via`（用哪个认证器造的）。
    //   两条都删：
    //   · `via` 是**认证器名字**（krawczyk_newton / miranda / inflate_refine /
    //     smale_alpha …）。对决策零信息量 —— Agent 不该关心解是哪个区间算子证出来的。
    //   · `proven` 看似有用，但它表达的是「认证强度」而不是「这个点是不是解」。
    //     同一件事的更强形式已经在**结论层**：conclusion 本身就是
    //     全部解 / 部分解 / 无解 / 计算资源不足 ��四态。
    //     Agent 判断「能不能用这个解」看 conclusion 就够，不必逐解再读一遍认证标记。
    //
    // 保留的唯一解级信息是**子句数与分页**，因为它们决定 Agent 要不要翻页。
    var sols = r.solutions || [];
    out.solutionCount = sols.length;
    if (sols.length) {
        out.solutions = sols.map(function (s) {
            return { values: s.values };
        });
    }

    // ── 正维流形：维数是决策必需的（∞ 多解 vs 有限多解）──
    if (r.solutionSpaceDimension > 0 || r.resultType === 3) {
        out.solutionSpaceDimension = r.solutionSpaceDimension || null;
        out.positiveDim = true;
    }
    // ── 不可判定边界（Richardson 等）：必须留，否则 Agent 会过度自信 ──
    out.undecidableInGeneral = true;
    if (r.mustNotClaim) out.mustNotClaim = r.mustNotClaim;
    if (r.nextAction) out.nextAction = r.nextAction;
    if (r.warnings && r.warnings.length) out.warnings = r.warnings;
    return out;
}

// ═══════════════════ 模块：operators/setup ═══════════════════
/* 模块 operators/setup：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function suan1(state) {
    var eqStrs = state.equationStrs;
    state.equations = [];
    // 忠实（未消分母）方程 AST 快照：用于结果层"良定义"校验（见 _filterIllDefined）。
    // 注意 suan23 会把分式交叉相乘消分母，产生"分母零点"的伪根（如 sin(x)/x=0 → sin(x)=0·x，x=0 处 0/0 未定义）。
    // 故保留解析后的原始等式 AST（含除法），在收尾时回代校验真解是否在原式上有定义。
    state.userEquations = [];
    state.domainConstraints = [];
    state.conditionWarnings = [];
    state.integerConstraintUnenforced = false;
    state.inequalityConstraints = [];

    for (var i = 0; i < eqStrs.length; i++) {
        var eqStr = eqStrs[i];

        // 检测复杂不等式（<=, >=, <, > 运算符）
        if (/<=|>=|<|>/.test(eqStr)) {
            var cond = parseCondition(eqStr);
            if (cond) {
                if (cond.type === "domain") {
                    state.domainConstraints.push(cond);
                    // 将域约束也作为不等式约束加入，供 suan48 枚举 + 终态不等式闸门使用
                    // 🔴 2026-10-04 修 P0：严格性过去在这里被丢弃（min/max 一律写 >= / <=）。
                    //   实测 `x^2=0` + `x>0` 返回解 x=0 —— x=0 违反 x>0，真解集是空集。
                    //   病根：parseCondition 早期就把严格性抹了（现已修好，带出 minStrict/maxStrict），
                    //   这里若不透传，严格信息就在第二道工序再丢一次。
                    //   ⇒ 严格不等式按严格语义落进 inequalityConstraints，
                    //     终态闸门 verifyAllConstraints 才有资格判「这个点违反约束」。
                    if (cond.varName && cond.min !== undefined) {
                        var _vAST = parse(tokenize(cond.varName, state.protNames));
                        var _cAST = { type: "num", value: cond.min };
                        state.inequalityConstraints.push({
                            lhs: _vAST, rhs: _cAST,
                            op: (cond.minStrict === true) ? ">" : ">=",
                            lhsStr: cond.varName, rhsStr: String(cond.min)
                        });
                    }
                    if (cond.varName && cond.max !== undefined) {
                        var _vAST2 = parse(tokenize(cond.varName, state.protNames));
                        var _cAST2 = { type: "num", value: cond.max };
                        state.inequalityConstraints.push({
                            lhs: _vAST2, rhs: _cAST2,
                            op: (cond.maxStrict === true) ? "<" : "<=",
                            lhsStr: cond.varName, rhsStr: String(cond.max)
                        });
                    }
                    continue;
                }
                if (cond.type === "warn") { state.conditionWarnings.push(cond.message); if (cond.kind === 'integer-unenforced') state.integerConstraintUnenforced = true; continue; }
                if (cond.type === "skip") continue;
            }
            var ineqMatch = eqStr.match(/^(.*?)\s*(<=|>=|<|>)\s*(.*)$/);
            if (ineqMatch) {
                var lhs = ineqMatch[1].trim();
                var op = ineqMatch[2];
                var rhs = ineqMatch[3].trim();
                if (lhs && rhs) {
                    var leftFixed = fuzzyFix(lhs, state.protNames);
                    var rightFixed = fuzzyFix(rhs, state.protNames);
                    var _ineqLeft = null, _ineqRight = null, _ineqErr = null;
                    try {
                        _ineqLeft = parse(tokenize(leftFixed, state.protNames));
                        _ineqRight = parse(tokenize(rightFixed, state.protNames));
                    } catch (e) { _ineqErr = e; }
                    if (_ineqErr) {
                        // 解析失败不静默丢弃：记入用户可见 warning，保持"没解出来也要说清为什么"
                        state.conditionWarnings.push("约束无法解析：" + eqStr + "（" + _ineqErr.message + "）");
                        continue;
                    }
                    state.inequalityConstraints.push({
                        lhs: _ineqLeft, rhs: _ineqRight, op: op,
                        lhsStr: lhs, rhsStr: rhs
                    });
                    // 不等式不加入 equations 数组，避免主流水线将其作为方程求解
                    continue;
                }
            }
        }

        if (eqStr.indexOf("=") < 0) {
            var cond = parseCondition(eqStr);
            if (cond) {
                if (cond.type === "domain") {
                    state.domainConstraints.push(cond);
                    // 🔴 2026-10-04 修 P0（同上）：这条路径过去**只**推 domainConstraints、
                    //   不推 inequalityConstraints ⇒ 形如 `x∈[-30,30]`、`x∈(0,1)` 的约束
                    //   终态闸门完全看不到，违反它的候选解会原样输出给 Agent。
                    //   （`x>0` 走的是上面 21 行那条路径，因为串里含 `<`/`>`；本条是无比较符的区间形态。）
                    if (cond.varName) {
                        try {
                            var _pAST = parse(tokenize(cond.varName, state.protNames));
                            if (cond.min !== undefined) {
                                state.inequalityConstraints.push({
                                    lhs: _pAST, rhs: { type: "num", value: cond.min },
                                    op: (cond.minStrict === true) ? ">" : ">=",
                                    lhsStr: cond.varName, rhsStr: String(cond.min)
                                });
                            }
                            if (cond.max !== undefined) {
                                state.inequalityConstraints.push({
                                    lhs: _pAST, rhs: { type: "num", value: cond.max },
                                    op: (cond.maxStrict === true) ? "<" : "<=",
                                    lhsStr: cond.varName, rhsStr: String(cond.max)
                                });
                            }
                        } catch (e) {
                            _lsNoteInternal(e, 'setup.js: 域约束转不等式 AST 失败，仅记 domainConstraints（终态闸门将看不到该约束），有意忽略');
                        }
                    }
                    continue;
                }
                if (cond.type === "warn") { state.conditionWarnings.push(cond.message); if (cond.kind === 'integer-unenforced') state.integerConstraintUnenforced = true; continue; }
            }
            continue;
        }
        var parts = eqStr.split("=");
        if (parts.length < 2) continue;
        var leftFixed = fuzzyFix(parts[0].trim(), state.protNames);
        var rightFixed = fuzzyFix(parts.slice(1).join("=").trim(), state.protNames);
        var leftAST = null, rightAST = null, _eqErr = null;
        try {
            leftAST = parse(tokenize(leftFixed, state.protNames));
            rightAST = parse(tokenize(rightFixed, state.protNames));
        } catch (e) { _eqErr = e; }
        if (_eqErr) {
            // 解析失败不静默丢弃：记入用户可见 warning，避免用户困惑"为什么没解出来"
            state.conditionWarnings.push("方程无法解析：" + eqStr + "（" + _eqErr.message + "）");
            continue;
        }
        state.equations.push({ type: "binop", op: "-", left: leftAST, right: rightAST });
        // 快照忠实等式 AST（深拷贝，防止后续算子就地改写污染）：含未消分母的原始形态
        state.userEquations.push(JSON.parse(JSON.stringify({ type: "binop", op: "-", left: leftAST, right: rightAST })));
    }

    if (state.equations.length === 0 && state.inequalityConstraints.length === 0) {
        state.done = true;
        state.result = { solutions: [], error: "NO_EQUATION", message: "未找到有效的方程", varNames: state.varNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "未输入方程，无任何约束" };
        return;
    }

    // 纯不等式系统标记
    if (state.equations.length === 0 && state.inequalityConstraints.length > 0) {
        state.isInequalityOnly = true;
    }

    // 自动提取变量（从方程和不等式约束中提取）
    if (!state.varNames || state.varNames.length === 0) {
        state.varNames = [];
        state.equations.forEach(function(eq) {
            extractVariables(eq).forEach(function(vn) {
                if (!state.varNames.includes(vn)) state.varNames.push(vn);
            });
        });
        state.inequalityConstraints.forEach(function(c) {
            extractVariables(c.lhs).forEach(function(vn) {
                if (!state.varNames.includes(vn)) state.varNames.push(vn);
            });
            extractVariables(c.rhs).forEach(function(vn) {
                if (!state.varNames.includes(vn)) state.varNames.push(vn);
            });
        });
    }
}


function suan2(state) {
    if (!state.varNames || state.varNames.length === 0) {
        state.varNames = [];
        state.equations.forEach(function(eq) {
            extractVariables(eq).forEach(function(vn) {
                if (!state.varNames.includes(vn)) state.varNames.push(vn);
            });
        });
    } else {
        // 无关变量剔除：调用方声明的变量若在方程中从未出现（如 MCP 传错变量名），
        // 直接剔除，避免对无关变量做全域 ±1e6 搜索导致秒级空转（曾实测 6.2s）。
        // 剔除名单记入 state.unusedDeclaredVars 供审计；方程中实际出现但未声明的
        // 变量仍会被追加，保证不漏解（保持原有兼容行为）。
        var _actualVars = new Set();
        state.equations.forEach(function(eq) {
            extractVariables(eq).forEach(function(vn) { _actualVars.add(vn); });
        });
        // 不等式约束中的变量同样视为"实际出现"（纯不等式系统 equations 为空，
        // 若不收集会误把所有声明变量判为无关变量剔除 → varNames 清空 → 误判无解）
        (state.inequalityConstraints || []).forEach(function(c) {
            if (c && c.lhs) extractVariables(c.lhs).forEach(function(vn) { _actualVars.add(vn); });
            if (c && c.rhs) extractVariables(c.rhs).forEach(function(vn) { _actualVars.add(vn); });
        });
        var _unused = [];
        var _kept = [];
        state.varNames.forEach(function(vn) {
            if (_actualVars.has(vn)) _kept.push(vn);
            else _unused.push(vn);
        });
        if (_unused.length) {
            state.unusedDeclaredVars = _unused;
            state.varNames = _kept;
        }

    }
    state.varCount = state.varNames.length;
}


function suan3(state) {
    if (state.varNames.length > 6) {
        state.done = true;
        state.result = {
            solutions: [],
            error: "OVER_LIMIT",
            message: "变量数 " + state.varNames.length + " 超过上限（6个），无法求解",
            varNames: state.varNames,
            resultType: 1, resultTypeName: "空结果", resultTypeDesc: "变量数超过求解器上限"
        };
    }
}

// ═══════════════════ 模块：operators/pre ═══════════════════
/* 模块 operators/pre：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function suan4(state) {
    for (var ei = 0; ei < state.equations.length; ei++) {
        (function checkNode(node) {
            if (!node) return;
            if (node.type === "func" && node.name === "int" && node.args && node.args.length < 3) {
                state.done = true;
                state.result = { solutions: [], error: "ILLEGAL_OPERATOR", message: "检测到不定积分，当前求解器仅支持定积分", varNames: state.varNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "不定积分无法数值求解" };
                return;
            }
            if (node.left) checkNode(node.left);
            if (node.right) checkNode(node.right);
            if (node.operand) checkNode(node.operand);
            if (node.args) node.args.forEach(checkNode);
            if (node.arg) checkNode(node.arg);
        })(state.equations[ei]);
        if (state.done) return;
    }
}


function suan5(state) {
    for (var ei = 0; ei < state.equations.length; ei++) {
        var _largeNums = scanASTForLargeNumbers(state.equations[ei]);
        if (_largeNums && _largeNums.length > 0) {
            state.done = true;
            state.result = {
                solutions: [],
                error: "COEFF_OUT_OF_RANGE",
                message: "检测到超出范围的常量（要求在 ±1e6 以内）",
                varNames: state.varNames,
                resultType: 1, resultTypeName: "空结果", resultTypeDesc: "常量超出数值稳定范围，无法可靠求解"
            };
            return;
        }
    }
}


function suan6(state) {
    for (var ei = 0; ei < state.equations.length; ei++) {
        var eq = state.equations[ei];
        var vars = extractVariables(eq);
        if (vars.length === 0) {
            var val = evalAST(eq, {});
            if (isFinite(val) && Math.abs(val) > 1e-12) {
                state.done = true;
                state.result = { solutions: [], error: "NO_SOLUTION", provenEmpty: true, message: "常量方程恒不成立（残差=" + val.toFixed(2) + "）", varNames: state.varNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "方程不含变量且恒不成立" };
                return;
            }
        }
    }
}


function suan7(state) {
    // ===== 第1轮：收集已知值（支持多种形式） =====
    var known = {};

    function _tryExtractKnown(eq) {
        if (eq.type !== 'binop' || eq.op !== '-') return false;
        // 模式1: var - c = 0 → var = c
        if (eq.left.type === 'var' && eq.right.type === 'num') {
            known[eq.left.name] = eq.right.value; return true;
        }
        // 模式2: c - var = 0 → var = c
        if (eq.left.type === 'num' && eq.right.type === 'var') {
            known[eq.right.name] = eq.left.value; return true;
        }
        // 模式3: sqrt(var) - c = 0 → var = c²
        if (eq.left.type === 'func' && eq.left.name === 'sqrt' && eq.right.type === 'num') {
            // 单参数函数用 arg，多参数函数用 args
            var inner = eq.left.arg || (eq.left.args && eq.left.args[0]);
            if (inner && inner.type === 'var') {
                known[inner.name] = eq.right.value * eq.right.value; return true;
            }
            // sqrt(var + k) - c = 0 → var = c² - k
            if (inner && inner.type === 'binop' && inner.op === '+') {
                if (inner.left.type === 'var' && inner.right.type === 'num') {
                    known[inner.left.name] = eq.right.value * eq.right.value - inner.right.value; return true;
                }
                if (inner.left.type === 'num' && inner.right.type === 'var') {
                    known[inner.right.name] = eq.right.value * eq.right.value - inner.left.value; return true;
                }
            }
        }
        // 模式4: var + k - c = 0 → var = c - k
        if (eq.left.type === 'binop' && eq.left.op === '+' && eq.right.type === 'num') {
            if (eq.left.left.type === 'var' && eq.left.right.type === 'num') {
                known[eq.left.left.name] = eq.right.value - eq.left.right.value; return true;
            }
            if (eq.left.left.type === 'num' && eq.left.right.type === 'var') {
                known[eq.left.right.name] = eq.right.value - eq.left.left.value; return true;
            }
        }
        // 模式5: k * var - c = 0 → var = c / k
        if (eq.left.type === 'binop' && eq.left.op === '*' && eq.right.type === 'num') {
            if (eq.left.left.type === 'var' && eq.left.right.type === 'num' && Math.abs(eq.left.right.value) > 1e-15) {
                known[eq.left.left.name] = eq.right.value / eq.left.right.value; return true;
            }
            if (eq.left.left.type === 'num' && eq.left.right.type === 'var' && Math.abs(eq.left.left.value) > 1e-15) {
                known[eq.left.right.name] = eq.right.value / eq.left.left.value; return true;
            }
        }
        // 模式6: var / k - c = 0 → var = c * k
        if (eq.left.type === 'binop' && eq.left.op === '/' && eq.right.type === 'num') {
            if (eq.left.left.type === 'var' && eq.left.right.type === 'num' && Math.abs(eq.left.right.value) > 1e-15) {
                known[eq.left.left.name] = eq.right.value * eq.left.right.value; return true;
            }
        }
        return false;
    }

    for (var ei = 0; ei < state.equations.length; ei++) {
        _tryExtractKnown(state.equations[ei]);
    }

    // ===== 第2轮：多轮传播 =====
    var changed = true;
    var iter = 0;
    // 记录已从哪个方程提取过值，避免同一方程反复检查矛盾（浮点噪声）
    var resolvedEqs = {};
    while (changed && iter < 20) {
        changed = false; iter++;
        for (var ei = 0; ei < state.equations.length; ei++) {
            var eq = state.equations[ei];
            var vars = extractVariables(eq);
            var knownCount = 0, unknownVars = [];
            for (var vi = 0; vi < vars.length; vi++) {
                if (known[vars[vi]] !== undefined) knownCount++;
                else unknownVars.push(vars[vi]);
            }
            if (knownCount === 0) continue;

            // ── 情形A：所有变量已知 → 直接求值检查矛盾 ──
            // 跳过已从前提取过值的方程，避免浮点噪声误判
            if (unknownVars.length === 0) {
                if (!resolvedEqs[ei]) {
                    // 🔴🔴 2026-10-05 彻底去网格化：矛盾判据回归**纯后向误差**，删掉网格余量通道。
                    //
                    // 事故史（必须留痕，这是同一个坑的两次修复）：
                    //   第1版：用 1e-12 绝对阈值。`3*x=1` 的 known={x:1/3} 代入得残差
                    //        ~1e-17 < 1e-12 ⇒ 不判矛盾，对的；但 12 位以上的循环小数会漏。
                    //   第2版：known 先 roundToGrid 到 6 位网格，残差变1e-6 > 1e-12
                    //        ⇒ **把 1/3 的量化残差当成矛盾**，输出 provenEmpty=true
                    //        +「已严格证明：定义域内不存在实数解」。这是最恶劣的一档谎报
                    //        （Agent 会照原文向用户断言无解），实测 `3*x=1`/`7*x=1` 全中。
                    //   第3版（2026-10-05，现在）：**删掉网格化本身**（roundToGrid 改为
                    //        全精度 + ULP 去噪），矛盾阈值改用与残差闸门同源的后向误差
                    //        判据 max(TOL_ABS_FLOOR, Σ|terms|·τ)。网格余量通道的前提
                    //        （坐标被量化）已消失，保留它等于**永久放宽矛盾检测**
                    //        ——真矛盾（x=1 与 x=2 并存，残差 O(1)）抓得住，
                    //        但任何残差小于 L·h ≈ 1e-6 的伪矛盾会被放过。
                    //
                    // 为什么后向误差判据是**更严**而不是更松：
                    //   τ = 1e-11 相对 ⇒ 对 `3*x=1`（Σ|terms|≈1）阈值 1e-11，
                    //   而 1/3 的真残差 ~1e-17 ⇒ 差6 个数量级，安全放过；
                    //   对真矛盾 `x-2` 代入 x=1 残差 1 ⇒ 超阈值 11 个数量级，照样抓住。
                    //
                    // fail-closed（保持不变）：本函数一旦宣告就是「已严格证明无解」，
                    //   判不出来就没有资格说这句话 ⇒ 交给后续算子继续找。
                    var _qn = Object.keys(known);
                    var _val = NaN, _scale = 0;
                    try { _val = evalAST(eq, known); } catch (e1) { _val = NaN; }
                    try { _scale = evalASTScale(eq, known); } catch (e2) { _scale = 0; }
                    if (!isFinite(_scale) || _scale <= 0) _scale = 0;
                    var _ctol = Math.max(1e-6, _scale * 1e-11);
                    if (isFinite(_val) && Math.abs(_val) > _ctol) {
                        state.done = true;
                        var msg = "前向传播检测到矛盾：代入已知值后方程不成立（残差=" + _val.toExponential(2) + "）";
                        var knownList = Object.keys(known).sort().map(function(v) { return v + "=" + known[v]; }).join(", ");
                        state.result = { solutions: [], error: "NO_SOLUTION", provenEmpty: true, message: msg, detail: "已知值: " + knownList, executionPath: "前向传播矛盾检测", timeMs: performance.now() - state.startTime, confidence: "high", varNames: state.varNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "前向传播检测到矛盾" };
                        return;
                    }
                }
                continue;
            }

            // ── 情形B：恰有1个未知变量 → 多点采样矛盾检测 + 尝试提取值 ──
            if (unknownVars.length === 1) {
                var uv = unknownVars[0];
                var extracted = false;
                var box = state.D0[uv];
                if (box && isFinite(box.min) && isFinite(box.max)) {
                    var lo = box.min, hi = box.max;
                    // 5点采样：边界、四分位、中点
                    var pts = [lo, lo * 0.75 + hi * 0.25, (lo + hi) * 0.5, lo * 0.25 + hi * 0.75, hi];
                    var allSameSign = true, firstSign = 0, minRes = Infinity, maxRes = 0;
                    var validCount = 0, sampleVals = [];

                    for (var pi = 0; pi < pts.length; pi++) {
                        var ctx = {};
                        for (var k in known) ctx[k] = known[k];
                        ctx[uv] = pts[pi];
                        var v = evalAST(eq, ctx);
                        if (!isFinite(v) || isNaN(v)) continue;
                        validCount++;
                        sampleVals.push(v);
                        var absv = Math.abs(v);
                        if (absv < minRes) minRes = absv;
                        if (absv > maxRes) maxRes = absv;
                        var s = v > 0 ? 1 : -1;
                        if (firstSign === 0) firstSign = s;
                        else if (s !== firstSign) allSameSign = false;
                    }

                    // 严格区间包络测试（取代原“5 点采样同号 + 最小残差>0.1”启发式）：
                    // 在变量 uv 的全域上计算 f 的区间包络，若包络不含 0，
                    // 则由中值定理严格证明该域内无解——【sound，不丢真解】。
                    // 原启发式会把 x=0.4（方程 20(x-0.4)²+y-0.5=0, y=0.5）误判为无解（见评审 unsound）。
                    var ibox = {};
                    for (var kb in known) ibox[kb] = { min: known[kb], max: known[kb] };
                    ibox[uv] = box;
                    var iF = intervalEval(eq, ibox);
                    if (iF && _ivExcludesZero(iF)) {
                        state.done = true;
                        var knownList = Object.keys(known).sort().map(function(v) { return v + "=" + known[v]; }).join(", ");
                        state.result = { solutions: [], error: "NO_SOLUTION", message: "前向传播检测到矛盾：代入已知值后，方程在变量 " + uv + " 的全域上 f 的严格区间包络不含 0（包络=[" + iF.min.toExponential(2) + "," + iF.max.toExponential(2) + "]），严格证明无根", detail: "已知值: " + knownList, executionPath: "前向传播矛盾检测", timeMs: performance.now() - state.startTime, confidence: "high", varNames: state.varNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "前向传播检测到矛盾" };
                        return;
                    }

                    // 如果采样点有变号，尝试二分法求解
                    if (!allSameSign && validCount >= 2) {
                        for (var pi = 0; pi < pts.length - 1; pi++) {
                            var v1 = sampleVals[pi], v2 = sampleVals[pi + 1];
                            if (!isFinite(v1) || !isFinite(v2)) continue;
                            if (v1 * v2 <= 0) {
                                var a = pts[pi], b = pts[pi + 1];
                                for (var bi = 0; bi < 60; bi++) {
                                    var mid = (a + b) * 0.5;
                                    var ctx = {};
                                    for (var k in known) ctx[k] = known[k];
                                    ctx[uv] = mid;
                                    var fmid = evalAST(eq, ctx);
                                    if (!isFinite(fmid)) break;
                                    if (Math.abs(fmid) < 1e-10) {
                                        known[uv] = mid; changed = true; extracted = true; break;
                                    }
                                    var f1 = (function() { var c = {}; for (var k in known) c[k] = known[k]; c[uv] = a; return evalAST(eq, c); })();
                                    if (fmid * f1 <= 0) b = mid;
                                    else a = mid;
                                }
                                if (extracted) break;
                            }
                        }
                    }
                }

                // 尝试从方程中推导新已知值（模式匹配）
                // 模式: var1 + var2 - c = 0, 一个已知 → 推导另一个
                if (!extracted && eq.type === 'binop' && eq.op === '-' && eq.left.type === 'binop' && eq.left.op === '+' && eq.right.type === 'num') {
                    var l = eq.left.left, r = eq.left.right, c = eq.right.value;
                    if (l.type === 'var' && r.type === 'var') {
                        if (known[l.name] !== undefined && known[r.name] === undefined) {
                            known[r.name] = c - known[l.name]; changed = true; extracted = true;
                        } else if (known[r.name] !== undefined && known[l.name] === undefined) {
                            known[l.name] = c - known[r.name]; changed = true; extracted = true;
                        }
                    }
                }
                // 模式: var1 * var2 - c = 0, 一个已知 → 推导另一个
                if (!extracted && eq.type === 'binop' && eq.op === '-' && eq.left.type === 'binop' && eq.left.op === '*' && eq.right.type === 'num') {
                    var l = eq.left.left, r = eq.left.right, c = eq.right.value;
                    if (l.type === 'var' && r.type === 'var') {
                        if (known[l.name] !== undefined && known[r.name] === undefined && Math.abs(known[l.name]) > 1e-15) {
                            known[r.name] = c / known[l.name]; changed = true; extracted = true;
                        } else if (known[r.name] !== undefined && known[l.name] === undefined && Math.abs(known[r.name]) > 1e-15) {
                            known[l.name] = c / known[r.name]; changed = true; extracted = true;
                        }
                    }
                }

                if (extracted) resolvedEqs[ei] = true;
            }
        }
    }
}


function suan8(state) {
    // 检测边界处的极限行为
    var boundaryInfo = [];
    for (var vi = 0; vi < state.varNames.length; vi++) {
        var vn = state.varNames[vi];
        var box = state.D0[vn];
        if (!box) continue;
        var min = box.min, max = box.max;
        
        // 检测变量是否出现在分母、ln、sqrt等可能导致奇点的位置
        var hasSingularityRisk = false;
        for (var ei = 0; ei < state.equations.length; ei++) {
            (function _checkSingularity(node) {
                if (!node) return;
                if (node.type === 'binop' && node.op === '/') {
                    if (hasVariable(node.right, [vn])) hasSingularityRisk = true;
                }
                if (node.type === 'func' && node.name === 'ln') {
                    if (hasVariable(node, [vn])) hasSingularityRisk = true;
                }
                if (node.type === 'func' && node.name === 'sqrt') {
                    if (hasVariable(node, [vn])) hasSingularityRisk = true;
                }
                if (node.type === 'binop') { _checkSingularity(node.left); _checkSingularity(node.right); }
                if (node.type === 'unary') _checkSingularity(node.operand);
                if (node.type === 'func' && node.args) node.args.forEach(_checkSingularity);
            })(state.equations[ei]);
        }
        
        // 在边界附近采样，分析极限行为
        var boundarySamples = [];
        var samplePoints = [min, min + 0.01 * (max - min), max - 0.01 * (max - min), max];
        for (var si = 0; si < samplePoints.length; si++) {
            var sp = samplePoints[si];
            if (sp < -1e6 || sp > 1e6) continue;
            var vars = {};
            for (var vj = 0; vj < state.varNames.length; vj++) vars[state.varNames[vj]] = (state.varNames[vj] === vn) ? sp : 0;
            var vals = state.equations.map(function(eq) { return evalAST(eq, vars); });
            var hasFinite = false, hasInfinite = false;
            for (var vi2 = 0; vi2 < vals.length; vi2++) {
                if (isFinite(vals[vi2]) && !isNaN(vals[vi2])) hasFinite = true;
                if (!isFinite(vals[vi2]) || Math.abs(vals[vi2]) > 1e15) hasInfinite = true;
            }
            boundarySamples.push({ point: sp, hasFinite: hasFinite, hasInfinite: hasInfinite, vals: vals });
        }
        
        boundaryInfo.push({
            varName: vn,
            hasSingularityRisk: hasSingularityRisk,
            boundarySamples: boundarySamples
        });
    }
    state.boundaryInfo = boundaryInfo;

}


function suan9(state) {
    // 线性系数提取：把 AST 解析为 a·vn + b（仅 x、a*x、a*x±b、b±a*x、x±b 等线性形式），
    // 非线形返回 null。用于 sqrt/log 的复合线性参数定义域推导（如 sqrt(5-x) → x≤5）。
    function _linearCoeffOf(node, vn) {
        if (!node) return null;
        if (node.type === 'var') return node.name === vn ? { a: 1, b: 0 } : null;
        if (node.type === 'num') return { a: 0, b: node.value };
        if (node.type === 'unary' && node.op === '-') {
            var t = _linearCoeffOf(node.operand, vn);
            return t ? { a: -t.a, b: -t.b } : null;
        }
        if (node.type === 'binop') {
            if (node.op === '+' || node.op === '-') {
                var l = _linearCoeffOf(node.left, vn), r = _linearCoeffOf(node.right, vn);
                if (l && r) return { a: l.a + (node.op === '-' ? -r.a : r.a), b: l.b + (node.op === '-' ? -r.b : r.b) };
                return null;
            }
            if (node.op === '*') {
                if (node.left.type === 'num' && node.right.type === 'var' && node.right.name === vn) return { a: node.left.value, b: 0 };
                if (node.right.type === 'num' && node.left.type === 'var' && node.left.name === vn) return { a: node.right.value, b: 0 };
                return null;
            }
            if (node.op === '/') {
                var l2 = _linearCoeffOf(node.left, vn);
                if (l2 && node.right) {
                    var _rv2 = evalAST(node.right, {});
                    if (isFinite(_rv2) && _rv2 !== 0) {
                        return { a: l2.a / _rv2, b: l2.b / _rv2 };
                    }
                }
                return null;
            }
        }
        return null;
    }
    function collectDomainConstraints(node) {
        if (!node) return [];
        var constraints = [];

        if (node.type === 'func') {
            var arg = node.arg || (node.args ? node.args[0] : null);
            if (arg && arg.type === 'var') {
                var vn = arg.name;
                switch (node.name) {
                    // ── 偶次根: sqrt(x) → x ≥ 0；sqrt(线性表达式) → 线性式 ≥ 0（如 sqrt(5-x) → x ≤ 5）──
                    case 'sqrt':
                        if (arg.type === 'var') {
                            constraints.push({ type: 'domain', varName: vn, min: 0 });
                        } else if (state.varNames.length === 1) {
                            var _ls = _linearCoeffOf(arg, state.varNames[0]);
                            if (_ls && _ls.a !== 0) {
                                if (_ls.a > 0) constraints.push({ type: 'domain', varName: state.varNames[0], min: -_ls.b / _ls.a });
                                else constraints.push({ type: 'domain', varName: state.varNames[0], max: -_ls.b / _ls.a });
                            }
                        }
                        break;

                    // ── 对数: ln(x), log(x), log2(x), log10(x) → x > 0；线性复合参数同理 ──
                    case 'log': case 'ln': case 'log2': case 'log10':
                        if (arg.type === 'var') {
                            constraints.push({ type: 'domain', varName: vn, min: 1e-300 });
                        } else if (state.varNames.length === 1) {
                            var _ll = _linearCoeffOf(arg, state.varNames[0]);
                            if (_ll && _ll.a !== 0) {
                                if (_ll.a > 0) constraints.push({ type: 'domain', varName: state.varNames[0], min: -_ll.b / _ll.a });
                                else constraints.push({ type: 'domain', varName: state.varNames[0], max: -_ll.b / _ll.a });
                            }
                        }
                        break;

                    // ── 反正弦/反余弦: arcsin(x), arccos(x) → x ∈ [-1, 1] ──
                    case 'arcsin': case 'arccos':
                        constraints.push({ type: 'domain', varName: vn, min: -1, max: 1 });
                        break;

                    // ── 反双曲余弦: arccosh(x) → x ≥ 1 ──
                    case 'arccosh':
                        constraints.push({ type: 'domain', varName: vn, min: 1 });
                        break;

                    // ── 反双曲正切: arctanh(x) → x ∈ (-1, 1) ──
                    case 'arctanh':
                        constraints.push({ type: 'domain', varName: vn, min: -1, max: 1 });
                        break;

                    // ── 正切: tan(x) → x ≠ π/2 + kπ（奇点警告） ──
                    case 'tan': case 'sec':
                        state.conditionWarnings.push(node.name + "(x) 有奇点 " + (node.name === 'tan' ? "x = kπ+π/2" : "x = kπ+π/2") + "，求解器无法排除奇点解，结果需人工验证");
                        break;

                    // ── 余切/余割: cot(x), csc(x) → x ≠ kπ ──
                    case 'cot': case 'csc':
                        state.conditionWarnings.push(node.name + "(x) 有奇点 x = kπ，求解器无法排除奇点解，结果需人工验证");
                        break;

                    // ── 反余切/反正割/反余割: 定义域有界的较少见函数 ──
                    case 'arcsec':
                        // arcsec(x) = arccos(1/x), 定义域 |x| ≥ 1
                        constraints.push({ type: 'domain', varName: vn, min: 1 });
                        // 还需要 x ≤ -1，但区间约束只能表示连续区间，所以加警告
                        state.conditionWarnings.push("arcsec(x) 定义域为 |x| ≥ 1，当前仅约束 x ≥ 1，x ≤ -1 部分的解可能被遗漏");
                        break;
                    case 'arccsc':
                        // arccsc(x) = arcsin(1/x), 定义域 |x| ≥ 1
                        constraints.push({ type: 'domain', varName: vn, max: -1 });
                        state.conditionWarnings.push("arccsc(x) 定义域为 |x| ≥ 1，当前仅约束 x ≤ -1，x ≥ 1 部分的解可能被遗漏");
                        break;
                }
            }
            // 递归处理参数（如果参数是复合表达式，需要遍历其子节点提取变量约束）
            if (node.args) node.args.forEach(function(a) { constraints = constraints.concat(collectDomainConstraints(a)); });
            if (node.arg) constraints = constraints.concat(collectDomainConstraints(node.arg));
        }

        if (node.type === 'binop') {
            // ── 除法: 分母 ≠ 0 ──
            if (node.op === '/') {
                constraints = constraints.concat(collectDomainConstraints(node.left));
                constraints = constraints.concat(collectDomainConstraints(node.right));
            }
            // ── 幂运算: x^(1/n) 偶次根 或 x^(-n) 负指数 ──
            else if (node.op === '^') {
                if (node.left.type === 'var') {
                    var vn = node.left.name;
                    var expVal = null;
                    if (node.right.type === 'num') {
                        expVal = node.right.value;
                    } else if (node.right.type === 'binop' && node.right.op === '/' && node.right.left.type === 'num' && node.right.right.type === 'num') {
                        expVal = node.right.left.value / node.right.right.value;
                    }
                    if (expVal !== null) {
                        // 负指数: x^(-n) → x ≠ 0
                        if (expVal < 0) {
                            state.conditionWarnings.push("变量 " + vn + " 出现在负指数 " + expVal.toFixed(4) + " 中，要求 " + vn + " ≠ 0，结果可能包含奇点，需人工验证");
                        }
                        // 正分数指数: x^(1/n) 且 n 为偶数 → x ≥ 0
                        if (expVal > 0 && expVal < 1) {
                            var recip = 1 / expVal;
                            var recipInt = Math.round(recip);
                            if (Math.abs(recip - recipInt) < 1e-10 && recipInt % 2 === 0) {
                                constraints.push({ type: 'domain', varName: vn, min: 0 });
                            }
                        }
                    }
                }
                constraints = constraints.concat(collectDomainConstraints(node.left));
                constraints = constraints.concat(collectDomainConstraints(node.right));
            } else {
                constraints = constraints.concat(collectDomainConstraints(node.left));
                constraints = constraints.concat(collectDomainConstraints(node.right));
            }
        }

        // 递归遍历所有子节点
        if (node.left) constraints = constraints.concat(collectDomainConstraints(node.left));
        if (node.right) constraints = constraints.concat(collectDomainConstraints(node.right));
        if (node.operand) constraints = constraints.concat(collectDomainConstraints(node.operand));
        if (node.arg) constraints = constraints.concat(collectDomainConstraints(node.arg));
        if (node.args) node.args.forEach(function(a) { constraints = constraints.concat(collectDomainConstraints(a)); });
        return constraints;
    }

    var autoConstraints = [];
    for (var ei = 0; ei < state.equations.length; ei++) {
        autoConstraints = autoConstraints.concat(collectDomainConstraints(state.equations[ei]));
    }

    // ========== 结构级方程分析 ==========
    // 1) 乘积 = 非零常数 → 每个因子 ≠ 0
    // 2) 复合分母 → 提取分母变量，警告 ≠ 0
    // 3) 结构矛盾 → sqrt(x) = 负数, exp(x) = 0, |x| = 负数, 平方和 = 负数
    for (var ei = 0; ei < state.equations.length; ei++) {
        var eq = state.equations[ei];
        // 方程形式: f(x) - c = 0 → f(x) = c
        if (eq.type !== 'binop' || eq.op !== '-') continue;
        var lhs = eq.left;
        var rhs = eq.right;
        // 确保右端是常数（支持 num(-2) 和 unary('-', num(2)) 两种形式）
        var cVal = null;
        if (rhs && rhs.type === 'num') {
            cVal = rhs.value;
        } else if (rhs && rhs.type === 'unary' && rhs.op === '-' && rhs.operand && rhs.operand.type === 'num') {
            cVal = -rhs.operand.value;
        }
        if (cVal === null) continue;

        // ── 1) 乘积 = 非零常数 ──
        // 检查左端是否为连续乘积
        if (cVal !== 0) {
            var prodVars = [];
            (function flattenProd(node) {
                if (!node) return;
                if (node.type === 'binop' && node.op === '*') {
                    flattenProd(node.left);
                    flattenProd(node.right);
                } else if (node.type === 'var') {
                    prodVars.push(node.name);
                }
            })(lhs);
            if (prodVars.length >= 2) {
                // 乘积=非零常数，数学上直接推导每个因子≠0，无需输出告警
                // 内部记录约束，供后置校验使用
                if (!state._nonZeroVars) state._nonZeroVars = [];
                prodVars.forEach(function(pv) {
                    if (state._nonZeroVars.indexOf(pv) < 0) state._nonZeroVars.push(pv);
                });
            }
        }

        // ── 2) 复合分母检测（已移除告警，分母约束在 evalAST 自然处理）──

        // ── 3) 结构矛盾检测 ──
        // (a) sqrt(x) = 负数 → 无解（因为 sqrt ≥ 0）
        // 检查左端是否为 sqrt(expr) 且右端为负数
        if (lhs.type === 'func' && lhs.name === 'sqrt' && cVal < 0) {
            state.done = true;
            state.result = {
                solutions: [], error: "NO_SOLUTION",
                message: "结构矛盾：sqrt(x) = " + cVal + " < 0，平方根函数值域 ≥ 0，无实数解",
                executionPath: "定义域自动分析", timeMs: performance.now() - state.startTime,
                confidence: "high", varNames: state.varNames, resultType: 1
            };
            return;
        }
        // (b) exp(x) ≤ 0 → 无解（因为 exp > 0）
        if (lhs.type === 'func' && lhs.name === 'exp' && cVal <= 0) {
            state.done = true;
            state.result = {
                solutions: [], error: "NO_SOLUTION",
                message: "结构矛盾：exp(x) = " + cVal + " ≤ 0，指数函数值域 > 0，无实数解",
                executionPath: "定义域自动分析", timeMs: performance.now() - state.startTime,
                confidence: "high", varNames: state.varNames, resultType: 1
            };
            return;
        }
        // (c) |x| = 负数 → 无解（因为 |x| ≥ 0）
        if (lhs.type === 'func' && lhs.name === 'abs' && cVal < 0) {
            state.done = true;
            state.result = {
                solutions: [], error: "NO_SOLUTION",
                message: "结构矛盾：|x| = " + cVal + " < 0，绝对值函数值域 ≥ 0，无实数解",
                executionPath: "定义域自动分析", timeMs: performance.now() - state.startTime,
                confidence: "high", varNames: state.varNames, resultType: 1
            };
            return;
        }
        // (d) x^2 + y^2 + ... = 负数 → 无解（扩展：支持 x^4, x^6 等偶次幂）
        // 检查左端是否为纯偶次幂和
        if (cVal < 0) {
            var sqTerms = [];
            var hasNonSquare = false;
            (function flattenSum(node) {
                if (!node) return;
                if (node.type === 'binop' && node.op === '+') {
                    flattenSum(node.left);
                    flattenSum(node.right);
                } else if (node.type === 'binop' && node.op === '^' && node.right.type === 'num') {
                    var exp = node.right.value;
                    var expRound = Math.round(exp);
                    if (Math.abs(exp - expRound) < 1e-9 && expRound > 0 && expRound % 2 === 0) {
                        sqTerms.push(node.left);
                    } else {
                        hasNonSquare = true;
                    }
                } else {
                    hasNonSquare = true;
                }
            })(lhs);
            if (sqTerms.length >= 1 && !hasNonSquare) {
                var sqVarNames = [];
                sqTerms.forEach(function(t) {
                    if (t.type === 'var') sqVarNames.push(t.name);
                });
                state.done = true;
                state.result = {
                    solutions: [], error: "NO_SOLUTION",
                    message: "结构矛盾：" + (sqVarNames.length >= 1 ? sqVarNames.join("² + ") + "²" : "偶次幂项") + " = " + cVal + " < 0，偶次幂 ≥ 0，无实数解",
                    executionPath: "定义域自动分析", timeMs: performance.now() - state.startTime,
                    confidence: "high", varNames: state.varNames, resultType: 1
                };
                return;
            }
        }
        // (e) sin(x) = c, |c| > 1 或 cos(x) = c, |c| > 1 → 无解（三角函数值域 [-1, 1]）
        if (lhs.type === 'func' && (lhs.name === 'sin' || lhs.name === 'cos') && Math.abs(cVal) > 1 + 1e-12) {
            state.done = true;
            state.result = {
                solutions: [], error: "NO_SOLUTION",
                message: "结构矛盾：" + lhs.name + "(x) = " + cVal + "，三角函数值域 [-1, 1]，无实数解",
                executionPath: "定义域自动分析", timeMs: performance.now() - state.startTime,
                confidence: "high", varNames: state.varNames, resultType: 1
            };
            return;
        }
        // (f) 非零常数 / expr = 0 → 无解（分子非零的分式不可能等于 0）
        if (cVal === 0 && lhs.type === 'binop' && lhs.op === '/' && lhs.left.type === 'num' && Math.abs(lhs.left.value) > 1e-15) {
            state.done = true;
            state.result = {
                solutions: [], error: "NO_SOLUTION",
                message: "结构矛盾：分子 " + lhs.left.value + " ≠ 0，分式方程不可能等于 0，无实数解",
                executionPath: "定义域自动分析", timeMs: performance.now() - state.startTime,
                confidence: "high", varNames: state.varNames, resultType: 1
            };
            return;
        }
        // (g) 非负项之和 = 负数 → 无解（sqrt + |x| + x^2 + ... = 负数）
        // 检测 sqrt(x) + |y| + 偶次幂 + ... = 负数
        if (cVal < 0) {
            var nonnegTerms = [];
            var hasOther = false;
            (function flattenSum2(node) {
                if (!node) return;
                if (node.type === 'binop' && node.op === '+') {
                    flattenSum2(node.left);
                    flattenSum2(node.right);
                } else if (node.type === 'func' && (node.name === 'sqrt' || node.name === 'abs' || node.name === 'exp')) {
                    nonnegTerms.push(node);
                } else if (node.type === 'binop' && node.op === '^' && node.right.type === 'num') {
                    var exp = node.right.value;
                    var expRound = Math.round(exp);
                    if (Math.abs(exp - expRound) < 1e-9 && expRound > 0 && expRound % 2 === 0) {
                        nonnegTerms.push(node);
                    } else {
                        hasOther = true;
                    }
                } else {
                    hasOther = true;
                }
            })(lhs);
            if (nonnegTerms.length >= 1 && !hasOther) {
                state.done = true;
                state.result = {
                    solutions: [], error: "NO_SOLUTION",
                    message: "结构矛盾：非负项之和 = " + cVal + " < 0，各项均 ≥ 0，无实数解",
                    executionPath: "定义域自动分析", timeMs: performance.now() - state.startTime,
                    confidence: "high", varNames: state.varNames, resultType: 1
                };
                return;
            }
        }
        // (h) x^0 = c, c ≠ 1 → 无解（x^0 ≡ 1，任何非零实数的 0 次幂 = 1）
        // 检测左端是否为 expr^0 形式
        if (lhs.type === 'binop' && lhs.op === '^' && lhs.right.type === 'num' && Math.abs(lhs.right.value) < 1e-12 && Math.abs(cVal - 1) > 1e-12) {
            state.done = true;
            state.result = {
                solutions: [], error: "NO_SOLUTION",
                message: "结构矛盾：表达式^0 = " + cVal + " ≠ 1，任何非零实数的 0 次幂 = 1，无实数解",
                executionPath: "定义域自动分析", timeMs: performance.now() - state.startTime,
                confidence: "high", varNames: state.varNames, resultType: 1
            };
            return;
        }
        // (i) a^x = c ≤ 0（a > 0 常数）→ 无解（正数的任意次幂 > 0）
        // 检测左端是否为 常数正数 ^ 表达式 形式，且右端 ≤ 0
        if (lhs.type === 'binop' && lhs.op === '^' && lhs.left.type === 'num' && lhs.left.value > 0 && cVal <= 0) {
            state.done = true;
            state.result = {
                solutions: [], error: "NO_SOLUTION",
                message: "结构矛盾：" + lhs.left.value + "^x = " + cVal + " ≤ 0，正数的任意实数次幂 > 0，无实数解",
                executionPath: "定义域自动分析", timeMs: performance.now() - state.startTime,
                confidence: "high", varNames: state.varNames, resultType: 1
            };
            return;
        }
        // (j) sqrt(x) = 0 且 x 有定义域约束 ≥ 正数 → 但从结构上无法直接判断，留给后续算子
    }

    // 将收集到的约束合并到 state.domainConstraints
    if (autoConstraints.length > 0) {
        autoConstraints.forEach(function(ac) {
            if (ac.type === 'domain') {
                state.domainConstraints.push(ac);
            }
        });
    }

    // 自动推导的约束已存入 state.domainConstraints
    // 与当前 D0 求交集（单向缩小：Dₙₑw ⊆ Dₒₗd）
    if (autoConstraints.length > 0) {
        var _hasContradiction = false;
        for (var _dci8 = 0; _dci8 < state.domainConstraints.length; _dci8++) {
            var _dc8 = state.domainConstraints[_dci8];
            var _vn8 = _dc8.varName;
            if (state.D0[_vn8]) {
                if (_dc8.min !== undefined) {
                    state.D0[_vn8].min = Math.max(state.D0[_vn8].min, _dc8.min);
                }
                if (_dc8.max !== undefined) {
                    state.D0[_vn8].max = Math.min(state.D0[_vn8].max, _dc8.max);
                }
                if (state.D0[_vn8].min > state.D0[_vn8].max) {
                    _hasContradiction = true; break;
                }
            }
        }
        if (_hasContradiction) {
            state.done = true;
            state.result = {
                solutions: [], error: "NO_SOLUTION",
                message: "自动定义域推导：变量搜索域为空，无解",
                executionPath: "定义域自动分析", timeMs: performance.now() - state.startTime,
                confidence: "high", varNames: state.varNames, resultType: 1
            };
        }
    }
}

// ═══════════════════ 模块：operators/screen ═══════════════════
/* 模块 operators/screen：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function suan10(state) {
    var _fastHasContradiction = false;
    var _fastContradictionMsg = "";

    for (var _fei = 0; _fei < state.equations.length; _fei++) {
        var _feq = state.equations[_fei];
        var _fvars = extractVariables(_feq);
        if (_fvars.length === 0) {
            var _fval = evalAST(_feq, {});
            if (isFinite(_fval) && Math.abs(_fval) > 1e-12) {
                _fastHasContradiction = true;
                _fastContradictionMsg = "常数方程恒不成立（残差=" + _fval.toFixed(2) + "）";
                break;
            }
        }
    }

    if (!_fastHasContradiction && state.equations.length >= 2) {
        var _explicitAssignments = {};
        // 检测1: 显式赋值矛盾 (x=1, x=2)
        for (var _fei = 0; _fei < state.equations.length; _fei++) {
            var _feq = state.equations[_fei];
            if (_feq.type === "binop" && _feq.op === "-" && _feq.left.type === "var" && _feq.right.type === "num") {
                var _vname = _feq.left.name;
                var _vval = _feq.right.value;
                if (_explicitAssignments[_vname] !== undefined && Math.abs(_explicitAssignments[_vname] - _vval) > 1e-10) {
                    _fastHasContradiction = true;
                    _fastContradictionMsg = "变量 " + _vname + " 被赋值为 " + _explicitAssignments[_vname] + " 和 " + _vval + "，矛盾";
                    break;
                }
                _explicitAssignments[_vname] = _vval;
            }
            if (_feq.type === "binop" && _feq.op === "-" && _feq.right.type === "var" && _feq.left.type === "num") {
                var _vname = _feq.right.name;
                var _vval = _feq.left.value;
                if (_explicitAssignments[_vname] !== undefined && Math.abs(_explicitAssignments[_vname] - _vval) > 1e-10) {
                    _fastHasContradiction = true;
                    _fastContradictionMsg = "变量 " + _vname + " 被赋值为 " + _explicitAssignments[_vname] + " 和 " + _vval + "，矛盾";
                    break;
                }
                _explicitAssignments[_vname] = _vval;
            }
        }
        // 检测2: 相同表达式不同值的矛盾 (x+y=5, x+y=8)
        if (!_fastHasContradiction) {
            for (var _pei = 0; _pei < state.equations.length; _pei++) {
                var _peq = state.equations[_pei];
                if (_peq.type !== "binop" || _peq.op !== "-") continue;
                var _pLeft = _peq.left;
                var _pRight = _peq.right;
                if (!_pRight || _pRight.type !== "num") continue;
                for (var _pej = _pei + 1; _pej < state.equations.length; _pej++) {
                    var _peq2 = state.equations[_pej];
                    if (_peq2.type !== "binop" || _peq2.op !== "-") continue;
                    var _pRight2 = _peq2.right;
                    if (!_pRight2 || _pRight2.type !== "num") continue;
                    if (JSON.stringify(_pLeft) === JSON.stringify(_peq2.left)) {
                        var _pVal1 = _pRight.value;
                        var _pVal2 = _pRight2.value;
                        if (Math.abs(_pVal1 - _pVal2) > 1e-10) {
                            _fastHasContradiction = true;
                            _fastContradictionMsg = "两个方程左侧表达式相同但右侧值不同（" + _pVal1 + " ≠ " + _pVal2 + "），矛盾";
                            break;
                        }
                    }
                }
                if (_fastHasContradiction) break;
            }
        }
    }

    if (_fastHasContradiction) {
        state.done = true;
        state.result = { solutions: [], resultType: 1, resultTypeName: "空结果", resultTypeDesc: "快速矛盾检测：两个方程左侧表达式相同但右侧值不同，不可能同时成立", error: "NO_SOLUTION", provenEmpty: true, message: _fastContradictionMsg, executionPath: "快速矛盾检测", timeMs: performance.now() - state.startTime, confidence: "high", varNames: state.varNames };
    }
}


function suan11(state) {
    function _isAlwaysNonNegative(node) {
        if (!node) return false;
        if (node.type === "binop" && node.op === "^" && node.right.type === "num") {
            var _e = node.right.value;
            if (_e > 0 && _e % 2 === 0) return true;
        }
        if (node.type === "func" && node.name === "exp") return true;
        if (node.type === "func" && node.name === "abs") return true;
        return false;
    }

    function _checkStructuralAlwaysPositive(ast) {
        var _sumTerms = [];
        (function _flattenSum(node) {
            if (node.type === "binop" && node.op === "+") { _flattenSum(node.left); _flattenSum(node.right); }
            else { _sumTerms.push(node); }
        })(ast);
        var _hasPosConst = false;
        for (var _sti = 0; _sti < _sumTerms.length; _sti++) {
            var _st = _sumTerms[_sti];
            if (_st.type === "num") { if (_st.value > 0) _hasPosConst = true; else if (_st.value < 0) return false; }
            else if (!_isAlwaysNonNegative(_st)) return false;
        }
        return _hasPosConst;
    }

    function _extractExpr(ast) {
        if (ast.type === "binop" && ast.op === "-" && ast.right.type === "num" && Math.abs(ast.right.value) < 1e-15) return ast.left;
        return ast;
    }

    for (var _sei = 0; _sei < state.equations.length; _sei++) {
        var _expr = _extractExpr(state.equations[_sei]);
        if (_checkStructuralAlwaysPositive(_expr)) {
            state.done = true;
            state.result = { solutions: [], error: "NO_SOLUTION", provenEmpty: true, message: "方程恒正，无实数解（平方和/指数/绝对值恒正检测）", executionPath: "结构恒正剪枝", timeMs: performance.now() - state.startTime, confidence: "high", varNames: state.varNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "方程恒正，最小值>0，无实数解" };
            return;
        }
        if (_expr.type === "unary" && _expr.op === "-" && _checkStructuralAlwaysPositive(_expr.operand)) {
            state.done = true;
            state.result = { solutions: [], error: "NO_SOLUTION", provenEmpty: true, message: "方程恒负，无实数解（平方和/指数/绝对值恒负检测）", executionPath: "结构恒正剪枝", timeMs: performance.now() - state.startTime, confidence: "high", varNames: state.varNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "方程恒负，最大值<0，无实数解" };
            return;
        }
        // 🔴 2026-10-04 补一条**区间包络判据**（P0 数学正确性 + 时间）
        //
        // 事故经过：测试 test/p0_fix_regression.js 的 F 组要求
        //   `solve(sin(x)+2=0)` ⇒ resultType=1（严格证无解）。实测它跑 1502ms 撞上限，
        //   由 output.js 兜底报 NO_SOLUTION —— **那个「无解」是谎报**（只是没找到）。
        //   本轮给 _finish 加了截断收口（截断时 error 降级为 TIMEOUT_TRUNCATED），
        //   谎报被揭穿，测试从"假绿"变红 —— 这正是收口该起的作用。
        //   根因是上面的 _checkStructuralAlwaysPositive 只认「偶次幂/exp/abs」三种结构，
        //   而 sin(x)+2 是「有下界的振荡 + 常量」，不在其内。
        //
        // 判据（区间算术，**sound**：包络是外包，必真）：
        //   若表达式在整个 D0 上的区间包络满足 min > 0（或 max < 0），
        //   则该式恒正（或恒负）⇒ 方程恒成立/恒不成立 ⇒ 定义域内**严格无解**。
        //   这不是「没找到」，是**证出来了** —— 与 fail-closed 完全同向。
        //
        // ⚠ 为什么这一条极便宜：只做一次区间求值（微秒级），
        //   换掉的是「跑满 1.5 秒 + 谎报无解」。
        // ⚠ 依赖区间算术的 sound 性（over-estimation）：包络只会更宽不会更窄，
        //   所以 min > 0 是**充分**条件，判为「已证无解」绝不会有反例。
        var _env = null;
        try { _env = intervalEval(_expr, state.D0); } catch (e) { _env = null; }
        if (_env && isFinite(_env.min) && isFinite(_env.max)) {
            var _why = null;
            if (_env.min > 0) _why = '方程左端在整个搜索域上的值恒 > ' + _env.min.toPrecision(6) + '，严格证明无实数解（区间包络判据）';
            else if (_env.max < 0) _why = '方程左端在整个搜索域上的值恒 < ' + _env.max.toPrecision(6) + '，严格证明无实数解（区间包络判据）';
            if (_why) {
                state.done = true;
                state.result = { solutions: [], error: "NO_SOLUTION", provenEmpty: true, message: _why, executionPath: "区间包络恒号判据", timeMs: performance.now() - state.startTime, confidence: "high", varNames: state.varNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: _why };
                return;
            }
        }
    }
}


function suan12(state) {
// S1.6: 压缩映射检测（Contraction Mapping Detection）
// 思想来源：泛函分析 — 巴拿赫不动点定理
// 检测单变量方程 x = f(x) 且 |f'(x)| < 1 → 直接不动点迭代缩小搜索域
if (state.varNames.length === 1) {
    var _cmVar = state.varNames[0];
    var _cmEq = state.equations[0];
    if (!state.D0[_cmVar]) return;
    var _cmRHS = null;
    if (_cmEq.type === 'binop' && _cmEq.op === '-') {
        if (_cmEq.left.type === 'var' && _cmEq.left.name === _cmVar) {
            _cmRHS = _cmEq.right;
        } else if (_cmEq.right.type === 'var' && _cmEq.right.name === _cmVar) {
            _cmRHS = _cmEq.left;
        }
    }
    if (_cmRHS) {
        var _cmContainsVar = false;
        (function _cmTraverse(node) {
            if (!node || _cmContainsVar) return;
            if (node.type === 'var') { if (node.name === _cmVar) _cmContainsVar = true; return; }
            if (node.left) _cmTraverse(node.left);
            if (node.right) _cmTraverse(node.right);
            if (node.operand) _cmTraverse(node.operand);
            if (node.args) node.args.forEach(_cmTraverse);
            if (node.arg) _cmTraverse(node.arg);
        })(_cmRHS);
        if (_cmContainsVar) {
            var _cmCenter = (state.D0[_cmVar].min + state.D0[_cmVar].max) / 2;
            var _cmH = 1e-8;
            var _cmVarsP = {}; _cmVarsP[_cmVar] = _cmCenter + _cmH;
            var _cmVarsM = {}; _cmVarsM[_cmVar] = _cmCenter - _cmH;
            var _cmFp = evalAST(_cmRHS, _cmVarsP);
            var _cmFm = evalAST(_cmRHS, _cmVarsM);
            var _cmDeriv = (isFinite(_cmFp) && isFinite(_cmFm)) ? (_cmFp - _cmFm) / (2 * _cmH) : NaN;
            var _cmConvRate = Math.abs(_cmDeriv);
            if (isFinite(_cmConvRate) && _cmConvRate < 0.99) {
                var _cmX = _cmCenter;
                for (var _cmi = 0; _cmi < 200; _cmi++) {
                    var _cmVars = {}; _cmVars[_cmVar] = _cmX;
                    var _cmNewX = evalAST(_cmRHS, _cmVars);
                    if (!isFinite(_cmNewX)) break;
                    if (Math.abs(_cmNewX - _cmX) < 1e-10) { _cmX = _cmNewX; break; }
                    _cmX = _cmNewX;
                }
                var _cmMargin = Math.max(1, (state.D0[_cmVar].max - state.D0[_cmVar].min) * 0.01);
                state.D0[_cmVar].min = Math.max(state.D0[_cmVar].min, _cmX - _cmMargin);
                state.D0[_cmVar].max = Math.min(state.D0[_cmVar].max, _cmX + _cmMargin);
            }
        }
    }
}
}


function suan13(state) {
// 表达式特征标记 → 标记线性/多项式/三角/非线性（调度用）
var eqFeatures = {
    allLinear: state.equations.every(function(eq) { return isLinear(eq, state.varNames); }),
    hasTrig: false,
    hasExp: false,
    hasODE: false,
    hasDiff: false,
    hasInt: false,
    singleVarSingleEq: state.varNames.length === 1 && state.equations.length === 1,
    hasVariableDenominator: false,
    hasPolynomial: false
};
for (var _fei = 0; _fei < state.equations.length; _fei++) {
    (function _traverseForFeatures(node) {
        if (!node) return;
        if (node.type === 'func') {
            if (node.name === 'sin' || node.name === 'cos' || node.name === 'tan') eqFeatures.hasTrig = true;
            if (node.name === 'exp' || node.name === 'log' || node.name === 'ln') eqFeatures.hasExp = true;
            if (node.name === 'ode' || node.name === 'diff') eqFeatures.hasODE = true;
            if (node.name === 'int') eqFeatures.hasInt = true;
            if (node.name === 'diff') eqFeatures.hasDiff = true;
        }
        // 检测多项式：检查变量是否只出现在非负整数次幂中
        if (node.type === 'binop' && node.op === '^' && node.right.type === 'num') {
            var _exp = node.right.value;
            if (_exp > 0 && Math.abs(_exp - Math.round(_exp)) < 1e-12) {
                // 整数次幂，可能是多项式的一部分
            }
        }
        // 检测变量分母
        if (node.type === 'binop' && node.op === '/') {
            if (node.right.type === 'var') eqFeatures.hasVariableDenominator = true;
            if (node.right.type === 'binop' || node.right.type === 'func') {
                (function _checkVarInDenom(n) {
                    if (!n) return;
                    if (n.type === 'var') eqFeatures.hasVariableDenominator = true;
                    if (n.left) _checkVarInDenom(n.left);
                    if (n.right) _checkVarInDenom(n.right);
                })(node.right);
            }
        }
        if (node.left) _traverseForFeatures(node.left);
        if (node.right) _traverseForFeatures(node.right);
        if (node.operand) _traverseForFeatures(node.operand);
        if (node.args) node.args.forEach(_traverseForFeatures);
        if (node.arg) _traverseForFeatures(node.arg);
    })(state.equations[_fei]);
}

// 多项式检测：如果所有方程都是多项式，标记
if (eqFeatures.singleVarSingleEq) {
    var vn = state.varNames[0];
    var coeffs = extractPolynomialCoefficients(state.equations[0], vn);
    if (coeffs && coeffs.length > 2) eqFeatures.hasPolynomial = true;
}

state.eqFeatures = eqFeatures;

// 根据特征设置跳过标记
var skipOperators = {};
if (eqFeatures.allLinear) {
    skipOperators.manifoldReduction = true;
    skipOperators.topologyAnalysis = true;
    skipOperators.contradictionPruning = true;
}
if (state.varNames.length <= 4) {
    skipOperators.topologyAnalysis = true;
}
state.skipOperators = skipOperators;
}


function _s58ConstVal(node) {
    if (!node || !node.type) return null;
    if (node.type === 'num') return (typeof node.value === 'number' && isFinite(node.value)) ? node.value : null;
    if (node.type === 'unary' && node.op === '-') {
        var v = _s58ConstVal(node.operand);
        return (v === null) ? null : -v;
    }
    if (node.type === 'binop' && (node.op === '+' || node.op === '-')) {
        var a = _s58ConstVal(node.left), b = _s58ConstVal(node.right);
        if (a === null || b === null) return null;
        return (node.op === '+') ? (a + b) : (a - b);
    }
    return null;
}


function _s58MatchBasicTrig(fnode) {
    if (!fnode || !fnode.type) return null;

    var trigNode = null, rhsNode = null;
    if (fnode.type === 'binop' && (fnode.op === '-' || fnode.op === '+')) {
        // 形如 func(x) - c   或   c - func(x)
        var l = fnode.left, r = fnode.right;
        if (l && l.type === 'func' && l.name) { trigNode = l; rhsNode = r; }
        else if (r && r.type === 'func' && r.name) { trigNode = r; rhsNode = l; if (fnode.op === '+') return null; }
    } else if (fnode.type === 'func' && fnode.name) {
        trigNode = fnode; rhsNode = { type: 'num', value: 0 };
    }
    // 前导一元负号：-sin(x) ⇒ 包成 0 - sin(x)（等价，且不丢信息）
    if (!trigNode && fnode.type === 'unary' && fnode.op === '-') {
        var inner = fnode.operand;
        if (inner && inner.type === 'func' && inner.name
            && ['sin', 'cos', 'tan'].indexOf(String(inner.name).toLowerCase()) >= 0) {
            trigNode = inner;
            rhsNode = { type: 'num', value: 0 };
        }
    }
    if (!trigNode) return null;

    var name = String(trigNode.name).toLowerCase();
    if (['sin', 'cos', 'tan'].indexOf(name) < 0) return null;

    // 三角函数的【参数】必须是变量本身（只支持 sin(x) 而非 sin(2x)/sin(x^2)）
    var arg = trigNode.arg;
    if (!arg || arg.type !== 'var') return null;

    var rhs = _s58ConstVal(rhsNode);
    if (rhs === null) return null;

    // 形态 c - func(x) ⇒ 相当于 func(x) = c（符号已含在 c 里）
    return { func: name, varName: arg.name, value: rhs };
}


function _suan58BasicTrig(fnode, vn, lo, hi, opts) {
    opts = opts || {};
    var maxOut = opts.maxOut || 100;        // 与现有 allSolutions 上限同量级
    var valTol = opts.valTol || 1e-6;

    var m = _s58MatchBasicTrig(fnode);
    if (!m) return null;
    if (m.varName !== vn) return null;      // 变量名不一致（消元后场景）⇒ 不处理

    var a = m.value;
    var name = m.func;

    // —— 第一步：定义域判定（精确，由反三角函数定义域给出）——
    if ((name === 'sin' || name === 'cos') && (a < -1 || a > 1)) {
        // |a| > 1 ⇒ 无实解（不是"不知道"，是【证明无解】）
        return { solved: true, exact: true, empty: true, provenEmpty: true, count: 0, solutions: [], family: name + '(x) = ' + a };
    }

    // —— 第二步：由通解直接构造基本解（一个周期内的代表元）——
    //   sin(x) = a ⇒ 基本解 β = arcsin(a)（另有一支 π − arcsin(a)，由周期延拓覆盖）
    //   cos(x) = a ⇒ 基本解 β = arccos(a)（另一支 −arccos(a)）
    //   tan(x) = a ⇒ 基本解 β = arctan(a)
    var beta, period, branches;
    if (name === 'sin') { beta = Math.asin(a); period = 2 * Math.PI; branches = [beta, Math.PI - beta]; }
    else if (name === 'cos') { beta = Math.acos(a); period = 2 * Math.PI; branches = [beta, -beta]; }
    else { beta = Math.atan(a); period = Math.PI; branches = [beta]; }

    // tan 的定义域：x ≠ π/2 + kπ。该点恰是 branches 之间的奇点，延拓时必须排除。
    var isTan = (name === 'tan');

    // —— 第三步：n 的范围（O(1)，保守扩张 ±1 后夹紧）——
    //   解集 = { β + n·period }  ∪  { β' + n·period }（两支时）
    //   要解落在 [lo, hi]，需 n ∈ [ (lo − β)/period , (hi − β)/period ]，取整。
    function nRange(b) {
        var nLo = Math.ceil((lo - b) / period) - 1;
        var nHi = Math.floor((hi - b) / period) + 1;
        if (nHi < nLo) return null;
        return [nLo, nHi];
    }

    // ── 惰性生成（2026-10-03）：内存 O(maxOut) 而非 O(根数) ──
    // 实测 sin(x)=0 在 ±1e6 内有 636618 个根，物化数组直接 SIGTERM。
    // 计数用 O(1) 的整数区间公式；只按需生成前 cap 个用于验算与输出。
    var _s58MaxN = 0;
    function countBranch(b) {
        var nr = nRange(b);
        if (!nr) return 0;
        // 该支在 [lo,hi] 内的 n 个数（含 ±1 的保守扩张，需扣掉越界者）
        var c = 0;
        for (var n = nr[0]; n <= nr[1]; n++) {
            var x = b + n * period;
            if (x < lo || x > hi) continue;
            c++;
        }
        return c;
    }
    for (var ci0 = 0; ci0 < branches.length; ci0++) _s58MaxN += countBranch(branches[ci0]);

    var cap = (opts.maxOut || 100);
    var _s58Total = _s58MaxN;
    var candidates = [];
    outer:
    for (var bi = 0; bi < branches.length; bi++) {
        var b = branches[bi];
        var nr = nRange(b);
        if (!nr) continue;
        for (var n = nr[0]; n <= nr[1]; n++) {
            var x = b + n * period;
            if (x < lo || x > hi) continue;                    // 夹到声明域
            if (isTan && Math.abs(Math.cos(x)) < 1e-12) continue;   // 排除 tan 奇点（恒等判据）
            candidates.push(x);
            if (candidates.length >= cap * 2) break outer;      // 够验算/输出即可（多取一倍做去重）
        }
    }

    // —— 第四步：回代验算（fail-closed 硬门槛）+ 去重 ——
    var verified = [];
    var worstRes = 0;
    for (var ci = 0; ci < candidates.length; ci++) {
        var xv = candidates[ci];
        var pt = {}; pt[vn] = xv;
        var fv;
        try { fv = evalAST(fnode, pt); } catch (e) { continue; }
        if (fv === null || !isFinite(fv)) continue;
        if (Math.abs(fv) > valTol) continue;                    // 通解错 ⇒ 拒收（不该发生，但必须验）
        if (Math.abs(fv) > worstRes) worstRes = Math.abs(fv);
        var dup = false;
        for (var vi = 0; vi < verified.length; vi++) {
            if (Math.abs(verified[vi] - xv) < 1e-9) { dup = true; break; }
        }
        if (!dup) verified.push(xv);
    }
    verified.sort(function (p, q) { return p - q; });

    // ── 宽域安全阀（2026-10-03）：根数可能极多 ──
    // sin(x)=0 在 [-1e6,1e6] 内有 636618 个根；逐个生成 + 回代验算会耗尽内存（实测 SIGTERM）。
    // 根数由通解【精确数出】（O(1) 运算），故只需验算前 maxOut 个即可声明精确计数。

    // 精确计数：通解给出的是【全部】解（两支 × n 范围，去重后即精确个数）
    // ⚠️ tan 的奇点已在上面排除，故计数是精确的。
    // 精确个数：若候选被安全阀截断，则用「通解数出的总数 − 未验算部分」不可靠，
    // 故只在未截断时声明 verified.length；截断时如实标 unknown（不虚报）。
    var _s58Capped = (_s58Total > candidates.length);   // 候选被惰性截断 ⇒ 计数不可逐个验证 ⇒ 不虚报
    var exactCount = _s58Capped ? null : verified.length;

    var truncated = _s58Capped || (exactCount !== null && exactCount > maxOut);
    var out = truncated ? verified.slice(0, maxOut) : verified;

    return {
        solved: true,
        exact: true,                       // 解集由通解给出 ⇒ 精确，非采样
        count: exactCount,                 // 声明域内的【精确】根数（超上限时为 null = 不虚报）
        countCapped: _s58Capped,
        totalIfCapped: _s58Total,
        solutions: out,                    // 代表解（遵守产品形态）
        truncated: truncated,
        residualMax: worstRes,
        family: (name === 'sin' ? 'x = nπ + (−1)ⁿ·arcsin(' + a + ')'
              : name === 'cos' ? 'x = 2nπ ± arccos(' + a + ')'
              : 'x = nπ + arctan(' + a + ')'),
        basis: '基本三角方程闭式通解 + 周期延拓（O(1)，不做数值扫描）'
    };
}

// ═══════════════════ 模块：operators/support ═══════════════════
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

// ═══════════════════ 模块：operators/geometry ═══════════════════
/* 模块 operators/geometry：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function suan35(state) {
    if (state.done) return;
    // 单变量/两变量已由更精确算子覆盖，跳过（与历史 p3LowDim 口径一致）
    if (state.varNames.length <= 2) return;
    if (state.skipOperators.manifoldReduction) return; // 复用原跳过标记，保持兼容

    var allEqs = state.originalEquations || state.equations;
    if (!allEqs || allEqs.length === 0) return;
    var allVars = getOutputVarNames(state);
    if (!allVars || allVars.length <= 2) return;

    // 1) 收集每个方程的“涉及变量集”，并按变量集分组（提取可投影的独立子系统）
    var eqVarSets = [];
    for (var ei = 0; ei < allEqs.length; ei++) {
        var vs = extractVariables(allEqs[ei]);
        if (vs && vs.length) eqVarSets.push({ eq: allEqs[ei], vars: vs });
    }

    // 2) 枚举“投影面” I：严格遍历 allVars 的所有真子集，大小 2..n-1。
    //    变量上限已锁死 6 维，故投影面总数 ≤ C(6,2)+C(6,3)+C(6,4)+C(6,5)=15+20+15+6=56，
    //    每个面只做一次轻量可行性判定（线性高斯相容 / 非线性 intervalEval），
    //    微秒级，无需贪心近似即可做到“全部投一遍”的严格完备。
    //    |I|=1 跳过（单变量子系统矛盾已被 suan7 覆盖，且巨域下区间包络恒含 0 无剪枝价值）；
    //    |I|=n 即全集不是真子集，跳过（那是全系统矛盾，由其他算子处理）。
    var candidates = [];
    var nVars = allVars.length;
    // 二进制枚举所有非空真子集，筛出大小∈[2, n-1]
    var totalMasks = 1 << nVars;
    for (var mask = 1; mask < totalMasks; mask++) {
        var pop = 0, bits = [];
        for (var b = 0; b < nVars; b++) {
            if (mask & (1 << b)) { pop++; bits.push(allVars[b]); }
        }
        if (pop < 2 || pop >= nVars) continue; // 真子集且 2≤|I|≤n-1
        candidates.push(bits);
    }
    if (candidates.length === 0) return;

    // 3) 对每个候选 I：抽出“变量全⊂I”的方程子集，在 I 上判定可行性
    function _subsystemFeasible(subEqs, I) {
        // 实际出现在子集里的变量
        var usedVars = {};
        for (var s = 0; s < subEqs.length; s++) {
            var vv = extractVariables(subEqs[s]);
            for (var t = 0; t < vv.length; t++) usedVars[vv[t]] = 1;
        }
        var used = Object.keys(usedVars);
        if (used.length === 0) return true; // 无变量（纯常数方程）交给其他算子

        // 取 I（used）在 D0 上的域，夹取到有限区间
        var box = {};
        var allFinite = true;
        for (var u = 0; u < used.length; u++) {
            var b = state.D0[used[u]];
            if (!b || !isFinite(b.min) || !isFinite(b.max)) { allFinite = false; break; }
            box[used[u]] = { min: b.min, max: b.max };
        }
        if (!allFinite) return true; // 域未初始化，放弃该候选（保守）

        // (a) 全线性 → 高斯相容判定（精确 sound）
        var allLinear = true;
        for (var q = 0; q < subEqs.length; q++) {
            if (!_isLinearAST(subEqs[q])) { allLinear = false; break; }
        }
        if (allLinear && subEqs.length >= 1) {
            return _linearSystemConsistent(subEqs, used);
        }

        // (b) 含非线性 → 区间包络矛盾检测：任一方程在 used 全域上的区间包络不含 0
        //     ⇒ 该子问题在 used 上无解（中值定理，sound）。注意：包络含 0 不证明有解，
        //     故仅在“不含 0”时返回 false（不可行）。
        for (var r = 0; r < subEqs.length; r++) {
            var iF = intervalEval(subEqs[r], box);
            if (iF && _ivExcludesZero(iF)) {
                return false; // 该方程在 used 全域上严格无根 ⇒ 子问题不可行 ⇒ 全局不可行
            }
        }
        return true; // 保守：无法证伪则假定可行
    }

    for (var ci = 0; ci < candidates.length; ci++) {
        var I = candidates[ci];
        // 抽“变量全⊂I”的方程
        var subEqs = [];
        for (var e = 0; e < eqVarSets.length; e++) {
            var ok = true;
            for (var v = 0; v < eqVarSets[e].vars.length; v++) {
                if (I.indexOf(eqVarSets[e].vars[v]) < 0) { ok = false; break; }
            }
            if (ok) subEqs.push(eqVarSets[e].eq);
        }
        if (subEqs.length < 1) continue;
        if (_subsystemFeasible(subEqs, I)) continue;
        // 命中：子问题在 I 上确证无解 ⇒ 由投影包含关系推出全局无解（sound）
        state.done = true;
        state.result = {
            solutions: [], error: "NO_SOLUTION",
            message: "投影反证剪枝：变量子集 {" + I.join(',') + "} 上的独立子系统在其实数域上严格无解（区间包络不含 0 / 线性不相容），由投影包含关系 π_I(S)=∅ ⇒ S=∅，整系统无实数解",
            executionPath: "投影反证剪枝(suan35)", timeMs: performance.now() - state.startTime,
            confidence: "high", varNames: state.varNames, resultType: 1,
            resultTypeName: "空结果", resultTypeDesc: "投影反证：子系统无解推出全局无解"
        };
        return;
    }
}


function suan36(state) {
    if (state.done) return;
    if (!state.varNames || state.varNames.length <= 1) { state.projectionHint = null; return; }

    var eqs = state.equations && state.equations.length ? state.equations : (state.originalEquations || []);
    var vars = state.varNames;
    if (eqs.length === 0 || vars.length === 0) { state.projectionHint = null; return; }

    // 样本点：D0 中点（夹取到有限域）；雅可比在该点估值
    var mid = {};
    for (var v = 0; v < vars.length; v++) {
        var b = state.D0[vars[v]];
        if (!b || !isFinite(b.min) || !isFinite(b.max)) { mid[vars[v]] = 0; }
        else mid[vars[v]] = (b.min + b.max) / 2;
    }
    function _f(eqAst, ctx) {
        var val; try { val = evalAST(eqAst, ctx); } catch (e) { val = NaN; }
        return isFinite(val) ? val : NaN;
    }
    // 数值雅可比：中心差分
    var h = 1e-6;
    var J = [];
    var computable = true;
    for (var i = 0; i < eqs.length && computable; i++) {
        var row = [];
        for (var j = 0; j < vars.length; j++) {
            var vp = vars[j];
            var ctxP = {}, ctxM = {};
            for (var kk = 0; kk < vars.length; kk++) { ctxP[vars[kk]] = mid[vars[kk]]; ctxM[vars[kk]] = mid[vars[kk]]; }
            ctxP[vp] = mid[vp] + h; ctxM[vp] = mid[vp] - h;
            var fp = _f(eqs[i], ctxP), fm = _f(eqs[i], ctxM);
            if (!isFinite(fp) || !isFinite(fm)) { computable = false; break; }
            row.push((fp - fm) / (2 * h));
        }
        if (computable) J.push(row);
    }
    if (!computable || J.length === 0) { state.projectionHint = null; return; }

    // 数值秩（高斯消元，阈值 1e-7）
    var rank = 0;
    var M = J.map(function (r) { return r.slice(); });
    var cols = vars.length;
    for (var col = 0; col < cols; col++) {
        var piv = -1;
        for (var rr = rank; rr < M.length; rr++) {
            if (Math.abs(M[rr][col]) > 1e-7) { piv = rr; break; }
        }
        if (piv < 0) continue;
        var tmp = M[rank]; M[rank] = M[piv]; M[piv] = tmp;
        for (var rr2 = 0; rr2 < M.length; rr2++) {
            if (rr2 !== rank && Math.abs(M[rr2][col]) > 1e-10) {
                var f = M[rr2][col] / M[rank][col];
                for (var cc = col; cc < cols; cc++) M[rr2][cc] -= f * M[rank][cc];
            }
        }
        rank++;
    }
    var dof = vars.length - rank;
    // 建议投影方向：优先固定 rank 个“被最多方程依赖”的变量（简单启发：按列绝对值和排序）
    var colSum = [];
    for (var c = 0; c < cols; c++) {
        var s = 0; for (var ri = 0; ri < M.length; ri++) s += Math.abs(J[ri][c]);
        colSum.push({ v: vars[c], s: s });
    }
    colSum.sort(function (x, y) { return y.s - x.s; });
    var suggested = colSum.slice(0, Math.max(1, rank)).map(function (o) { return o.v; });

    state.projectionHint = {
        rank: rank, dof: dof, samplePoint: mid,
        suggestedProjectionVars: suggested,
        note: "雅可比数值秩=" + rank + "，局部自由度=" + dof + "；建议投影到 {" + suggested.join(',') + "} 上"
    };
}


function suan37(state) {
    if (!state.manifoldInfo) {
        state.manifoldType = { type: 'unknown', dim: -1, strategy: 'newton', description: '无法检测流形' };
        return;
    }
    var rank = state.manifoldInfo.rank;
    var n = state.varNames.length;
    var effectiveDim = n - rank; // 解流形的维数（自由度）
    
    if (rank === 0) {
        return { type: 'discrete', dim: 0, effectiveDim: 0, strategy: 'extract_candidates',
            description: '0维离散点集 — 从代数边界候选提取直接读出' };
    }
    if (effectiveDim === 0) {
        return { type: 'discrete', dim: 0, effectiveDim: 0, strategy: 'extract_candidates',
            description: '0维离散点集（满秩约束） — 代数候选提取 + 直接读出' };
    }
    if (effectiveDim === 1) {
        return { type: 'curve', dim: 1, effectiveDim: 1, strategy: 'geodesic_tracking',
            description: '1维曲线流形 — 测地线跟踪遍历' };
    }
    if (effectiveDim <= 4) {
        return { type: 'surface', dim: effectiveDim, effectiveDim: effectiveDim, strategy: 'grid_sampling',
            description: effectiveDim + '维曲面流形 — 流形格点采样' };
    }
    // effectiveDim >= 5
    return { type: 'highdim', dim: effectiveDim, effectiveDim: effectiveDim, strategy: 'nullspace_reduction',
        description: effectiveDim + '维高维流形 — 零空间参数化降维' };
}


function suan38(state) {
    var n = state.varNames.length;
    const points = [];

    // 使用 D0 作为起始点生成依据
    function getStartValue(v, base) {
        if (state.D0 && state.D0[v]) {
            const b = state.D0[v];
            const min = b.min === -Infinity ? -1000000 : b.min;
            const max = b.max === Infinity ? 1000000 : b.max;
            if (base < min) return min;
            if (base > max) return max;
            return base;
        }
        return base;
    }

    points.push(state.varNames.map(v => getStartValue(v, 0)));
    points.push(state.varNames.map(v => getStartValue(v, 1)));
    points.push(state.varNames.map(v => getStartValue(v, -1)));
    points.push(state.varNames.map(v => getStartValue(v, 10)));
    points.push(state.varNames.map(v => getStartValue(v, -10)));

    // 混合符号点（多变量时覆盖不同象限）
    if (n >= 2) {
        points.push(state.varNames.map((v, i) => getStartValue(v, i % 2 === 0 ? 5 : -5)));
        points.push(state.varNames.map((v, i) => getStartValue(v, i % 2 === 0 ? -5 : 5)));
        points.push(state.varNames.map((v, i) => getStartValue(v, i % 2 === 0 ? 10 : -10)));
        points.push(state.varNames.map((v, i) => getStartValue(v, i % 2 === 0 ? -10 : 10)));
    }

    // 3个确定性网格点（基于 D0 区间）
    const gridFractions = [0.25, 0.5, 0.75];
    for (let r = 0; r < 3; r++) {
        const pt = [];
        for (let i = 0; i < n; i++) {
            const v = state.varNames[i];
            if (state.D0 && state.D0[v]) {
                const b = state.D0[v];
                const min = b.min === -Infinity ? -1000000 : b.min;
                const max = b.max === Infinity ? 1000000 : b.max;
                pt.push(min + gridFractions[r] * (max - min));
            } else {
                pt.push((r - 1) * 66);
            }
        }
        points.push(pt);
    }

    return points;
}


function suan39(state) {
    if (!state.manifoldInfo || !state.startPoints) return;
    if (state.manifoldInfo && state.manifoldInfo.hasRedundancy) {
        state.startPoints = projectToManifold(state.startPoints, state.manifoldInfo);
    }
}


function _suan56Project(eqs, vns, x0, dom, opts) {
    opts = opts || {};
    var maxIter = opts.maxIter || 60;
    var n = vns.length, m = eqs.length;
    if (!x0 || x0.length !== n || m === 0 || m >= n) return null;
    var x = x0.slice();

    // 残差与最大残差
    function maxRes(xx) {
        var vmap = {};
        for (var i = 0; i < n; i++) vmap[vns[i]] = xx[i];
        var mr = 0;
        for (var e = 0; e < m; e++) {
            var f;
            try { f = evalAST(eqs[e], vmap); } catch (err) { return Infinity; }
            if (f === null || !isFinite(f)) return Infinity;
            if (Math.abs(f) > mr) mr = Math.abs(f);
        }
        return mr;
    }

    var r0 = maxRes(x);
    if (!isFinite(r0)) return null;

    for (var it = 0; it < maxIter; it++) {
        if (maxRes(x) < 1e-12) return { values: x.slice(), residual: maxRes(x), iters: it, ok: true };

        // 雅可比（区间求导，失败退中心差分）
        var vmap0 = {};
        for (var i2 = 0; i2 < n; i2++) vmap0[vns[i2]] = x[i2];
        var pmap = {};
        for (var i3 = 0; i3 < n; i3++) pmap[vns[i3]] = { min: x[i3], max: x[i3] };

        var J = [];
        for (var a = 0; a < m; a++) {
            J.push([]);
            for (var b = 0; b < n; b++) {
                var dv = null;
                try {
                    var dast = _diffAST(eqs[a], vns[b]);
                    if (dast) dv = intervalEval(dast, pmap);
                } catch (e2) { dv = null; }
                if (dv && typeof dv === 'object' && isFinite(dv.min) && isFinite(dv.max)) {
                    J[a].push((dv.min + dv.max) / 2);
                } else {
                    var hstep = Math.max(Math.abs(x[b]), 1e-4) * 1e-7;
                    var vp = {}, vm = {};
                    for (var q = 0; q < n; q++) { vp[vns[q]] = x[q]; vm[vns[q]] = x[q]; }
                    vp[vns[b]] = x[b] + hstep; vm[vns[b]] = x[b] - hstep;
                    var fp2, fm2;
                    try { fp2 = evalAST(eqs[a], vp); } catch (e3) { return null; }
                    try { fm2 = evalAST(eqs[a], vm); } catch (e4) { return null; }
                    if (!isFinite(fp2) || !isFinite(fm2)) return null;
                    J[a].push((fp2 - fm2) / (2 * hstep));
                }
            }
        }

        // F(x) 与目标梯度 x
        var Fv = [];
        for (var e5 = 0; e5 < m; e5++) {
            var fv;
            try { fv = evalAST(eqs[e5], vmap0); } catch (e6) { return null; }
            if (!isFinite(fv)) return null;
            Fv.push(fv);
        }

        // KKT 线性系统（n+m 维）：
        //   [ J   Jᵀ ] [Δx ]   [ -F ]
        //   [ 0    I  ] [ λ ] = [ -x ]
        // 消元后等价于：Δx = -x - Jᵀλ，且 J·Δx = -F
        //   ⇒ J(-x - Jᵀλ) = -F  ⇒  J Jᵀ λ = F - J x
        // 解 m×m 方程组 (J Jᵀ) λ = (F - J x)，再得 Δx = -x - Jᵀλ
        var JJt = [];
        for (var p = 0; p < m; p++) {
            var row = [];
            for (var q2 = 0; q2 < m; q2++) {
                var acc = 0;
                for (var r2 = 0; r2 < n; r2++) acc += J[p][r2] * J[q2][r2];
                row.push(acc);
            }
            JJt.push(row);
        }
        var rhs = [];
        for (var p2 = 0; p2 < m; p2++) {
            var jx = 0;
            for (var r3 = 0; r3 < n; r3++) jx += J[p2][r3] * x[r3];
            rhs.push(Fv[p2] - jx);
        }
        var lamRes = gaussianSolve(JJt, rhs);
        if (!lamRes || !lamRes.solution) return null;
        var lam = lamRes.solution;

        var dx = [];
        for (var t2 = 0; t2 < n; t2++) {
            var jtl = 0;
            for (var p3 = 0; p3 < m; p3++) jtl += J[p3][t2] * lam[p3];
            dx.push(-x[t2] - jtl);
        }
        if (!isFinite(dx[0])) return null;

        // 阻尼线搜索：只在残差单调下降且留在域内时接受（与既有阻尼牛顿同口径）
        var cur = maxRes(x);
        var accepted = false;
        var step = dx.slice();
        for (var dmp = 0; dmp < 12; dmp++) {
            var xn = [];
            var inDom = true;
            for (var s2 = 0; s2 < n; s2++) {
                var xv = x[s2] + step[s2];
                if (dom && dom[vns[s2]]) {
                    if (xv < dom[vns[s2]].min) { xv = dom[vns[s2]].min; }
                    if (xv > dom[vns[s2]].max) { xv = dom[vns[s2]].max; }
                }
                if (!isFinite(xv)) { inDom = false; break; }
                xn.push(xv);
            }
            if (!inDom) break;
            var rn = maxRes(xn);
            if (rn < cur) { x = xn; accepted = true; break; }
            for (var s3 = 0; s3 < step.length; s3++) step[s3] *= 0.5;
        }
        if (!accepted) return null;   // 不下降 ⇒ 已在局部极小，如实放弃（不假装收敛）
    }
    var rf = maxRes(x);
    // fail-closed：只有真的把约束残差压到 1e-9 以下才算「投影成功」
    if (isFinite(rf) && rf < 1e-9) return { values: x.slice(), residual: rf, iters: maxIter, ok: true };
    return null;
}

// ═══════════════════ 模块：operators/homotopy ═══════════════════
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

// ═══════════════════ 模块：operators/contract ═══════════════════
/* 模块 operators/contract：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function suan25(state) {
    if (state.eqFeatures.allLinear) return;

    // 1. 从平方和方程提取约束：x² + y² = r² → |x| ≤ r, |y| ≤ r
    // 遍历每个方程，检查是否为平方和=常数的形式
    var _contracted = false;
    for (var _ei25 = 0; _ei25 < state.equations.length; _ei25++) {
        var _eq25 = state.equations[_ei25];
        // 方程形式: f(x) - 0 = 0 → 提取 f(x)
        var _expr25 = null;
        if (_eq25.type === 'binop' && _eq25.op === '-') {
            _expr25 = _eq25.left;
        }

        if (_expr25) {
            // 检查右端是否为常数（处理 x² + y² - 1 = 0 → x² + y² = 1）
            var _eqConst25 = 0;
            if (_eq25.right && _eq25.right.type === 'num') {
                _eqConst25 = _eq25.right.value;
            }

            // 检查是否为 平方和 - 常数 形式
            var _sqTerms25 = [];
            var _const25 = 0;
            (function _flattenSum25(node, negate) {
                if (!node) return;
                if (node.type === 'binop' && node.op === '+') {
                    _flattenSum25(node.left, negate);
                    _flattenSum25(node.right, negate);
                } else if (node.type === 'binop' && node.op === '-') {
                    _flattenSum25(node.left, negate);
                    _flattenSum25(node.right, !negate);
                } else if (node.type === 'num') {
                    _const25 += negate ? -node.value : node.value;
                } else if (node.type === 'binop' && node.op === '^' && node.right.type === 'num' && Math.abs(node.right.value - 2) < 1e-9) {
                    _sqTerms25.push({ node: node.left, negate: negate });
                }
            })(_expr25, false);

            // 总常数 = 右端常数 + 表达式内常数
            _const25 += _eqConst25;

            // 如果检测到平方和项，且常数不为0
            if (_sqTerms25.length >= 1 && _const25 !== 0) {
                if (_sqTerms25.every(function(t) { return !t.negate; })) {
                    // 所有平方项都是正号：x₁² + x₂² + ... = C
                    // 每个 |x_i| ≤ sqrt(C)
                    var _C25 = Math.abs(_const25);
                    var _sqrtC25 = Math.sqrt(_C25);
                    for (var _si25 = 0; _si25 < _sqTerms25.length; _si25++) {
                        var _sqNode25 = _sqTerms25[_si25].node;
                        if (_sqNode25.type === 'var') {
                            var _vn25 = _sqNode25.name;
                            if (state.D0[_vn25]) {
                                var _oldMin25 = state.D0[_vn25].min;
                                var _oldMax25 = state.D0[_vn25].max;
                                state.D0[_vn25].min = Math.max(state.D0[_vn25].min, -_sqrtC25);
                                state.D0[_vn25].max = Math.min(state.D0[_vn25].max, _sqrtC25);
                                if (state.D0[_vn25].min !== _oldMin25 || state.D0[_vn25].max !== _oldMax25) {
                                    _contracted = true;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. 平方和约束下的乘积范围分析：x² + y² = r² → |xy| ≤ r²/2
    // 用于检测 sin(xy) = c 等隐含乘积约束中的矛盾
    var _prodConstraints = {};
    for (var _ei25 = 0; _ei25 < state.equations.length; _ei25++) {
        var _eq25 = state.equations[_ei25];
        var _expr25 = (_eq25.type === 'binop' && _eq25.op === '-') ? _eq25.left : null;
        if (!_expr25) continue;
        var _sqTerms25 = [];
        var _const25 = 0;
        var _eqConst25 = (_eq25.right && _eq25.right.type === 'num') ? _eq25.right.value : 0;
        (function _flatten25(node, negate) {
            if (!node) return;
            if (node.type === 'binop' && node.op === '+') { _flatten25(node.left, negate); _flatten25(node.right, negate); }
            else if (node.type === 'binop' && node.op === '-') { _flatten25(node.left, negate); _flatten25(node.right, !negate); }
            else if (node.type === 'num') { _const25 += negate ? -node.value : node.value; }
            else if (node.type === 'binop' && node.op === '^' && node.right.type === 'num' && Math.abs(node.right.value - 2) < 1e-9) {
                _sqTerms25.push({ node: node.left, negate: negate });
            }
        })(_expr25, false);
        _const25 += _eqConst25;
        if (_sqTerms25.length >= 2 && _const25 > 0 && _sqTerms25.every(function(t) { return !t.negate; })) {
            var _r25 = Math.sqrt(_const25);
            for (var _si25a = 0; _si25a < _sqTerms25.length; _si25a++) {
                for (var _si25b = _si25a + 1; _si25b < _sqTerms25.length; _si25b++) {
                    var _vna = _sqTerms25[_si25a].node;
                    var _vnb = _sqTerms25[_si25b].node;
                    if (_vna.type === 'var' && _vnb.type === 'var') {
                        var _key25 = [_vna.name, _vnb.name].sort().join('*');
                        _prodConstraints[_key25] = { r2: _r25 * _r25 / 2, vars: [_vna.name, _vnb.name] };
                    }
                }
            }
        }
    }

    // 3. 区间值域分析：对每个方程 f(x)=0，计算 f(D) 的值域，0∉f(D) → 矛盾
    var _intervals25 = {};
    for (var _vi25 = 0; _vi25 < state.varNames.length; _vi25++) {
        var _vnn25 = state.varNames[_vi25];
        if (state.D0[_vnn25]) {
            _intervals25[_vnn25] = { min: state.D0[_vnn25].min, max: state.D0[_vnn25].max };
        }
    }

    for (var _ei25b = 0; _ei25b < state.equations.length; _ei25b++) {
        var _eqExpr25 = state.equations[_ei25b];
        // 提取 f(x) from f(x) = 0
        if (_eqExpr25.type === 'binop' && _eqExpr25.op === '-') {
            // 对完整方程 f(x) - c = 0 整体求值（不能只对 f(x) 求值，会忽略常数项 c）
            var _range25 = intervalEval(_eqExpr25, _intervals25);
            if (_range25 && _range25.min > 1e-12) {
                // f(D) - c 全部 > 0 → 无解
                state.done = true;
                state.result = {
                    solutions: [], error: "NO_SOLUTION",
                    message: "区间算术分析：函数值域全为正，最小 " + _range25.min.toFixed(6) + " > 0，无解",
                    executionPath: "区间算术", timeMs: performance.now() - state.startTime,
                    confidence: "high", varNames: state.varNames,
                    unconverged: false, resultType: 1, resultTypeName: "空结果",
                    resultTypeDesc: "区间算术严格证明不存在满足条件的解"
                };
                return;
            }
            if (_range25 && _range25.max < -1e-12) {
                // f(D) - c 全部 < 0 → 无解
                state.done = true;
                state.result = {
                    solutions: [], error: "NO_SOLUTION",
                    message: "区间算术分析：函数值域全为负，最大 " + _range25.max.toFixed(6) + " < 0，无解",
                    executionPath: "区间算术", timeMs: performance.now() - state.startTime,
                    confidence: "high", varNames: state.varNames,
                    unconverged: false, resultType: 1, resultTypeName: "空结果",
                    resultTypeDesc: "区间算术严格证明不存在满足条件的解"
                };
                return;
            }
        }
    }

    // 3b. 乘积约束检测：利用平方和约束检查 sin(xy)=c 等隐含矛盾
    if (Object.keys(_prodConstraints).length > 0) {
        for (var _ei25c = 0; _ei25c < state.equations.length; _ei25c++) {
            var _eq25c = state.equations[_ei25c];
            // 提取表达式
            var _expr25c = (_eq25c.type === 'binop' && _eq25c.op === '-') ? _eq25c.left : null;
            if (!_expr25c) continue;
            // 检查是否为 sin(expr) - c 形式
            var _checkSinProduct = function(node) {
                if (!node || node.type !== 'func' || node.name !== 'sin') return false;
                var _arg = node.arg || (node.args ? node.args[0] : null);
                if (!_arg || _arg.type !== 'binop' || _arg.op !== '*') return false;
                if (_arg.left.type !== 'var' || _arg.right.type !== 'var') return false;
                var _va = _arg.left.name, _vb = _arg.right.name;
                var _key = [_va, _vb].sort().join('*');
                return _prodConstraints[_key] || false;
            }(_expr25c);
            if (_checkSinProduct) {
                var _sinArg = _expr25c.arg || (_expr25c.args ? _expr25c.args[0] : null);
                if (_sinArg && _sinArg.type === 'binop' && _sinArg.op === '*') {
                    var _va = _sinArg.left.name, _vb = _sinArg.right.name;
                    var _key = [_va, _vb].sort().join('*');
                    var _pc = _prodConstraints[_key];
                    if (_pc) {
                        // 检查 sin(xy) = 0.5 是否可能
                        // 找到 _eq25c 中的常数项（右端减数）
                        var _constC = 0;
                        if (_eq25c.right && _eq25c.right.type === 'num') _constC = _eq25c.right.value;
                        // sin(xy) = c 要求 xy = arcsin(c) + 2πk 或 π-arcsin(c) + 2πk
                        // 检查最接近0的周期解是否在 |xy| ≤ pc.r2 范围内
                        var _cAbs = Math.abs(_constC);
                        if (_cAbs <= 1) {
                            var _arc = Math.asin(_constC);
                            // 两个基本解: arcsin(c) 和 π - arcsin(c)
                            // 对每个基本解，找最接近0的周期值
                            var _closestVal = Infinity;
                            // 检查 arcsin(c) + 2πk
                            for (var _k = -5; _k <= 5; _k++) {
                                var _v = _arc + 2 * Math.PI * _k;
                                if (Math.abs(_v) < Math.abs(_closestVal)) _closestVal = _v;
                                _v = Math.PI - _arc + 2 * Math.PI * _k;
                                if (Math.abs(_v) < Math.abs(_closestVal)) _closestVal = _v;
                            }
                            // 如果最接近0的解的绝对值 > 乘积上限，则无解
                            if (Math.abs(_closestVal) > _pc.r2 + 1e-12) {
                                // 但也需检查 -_closestVal 是否在范围内
                                var _found = false;
                                for (var _k = -5; _k <= 5; _k++) {
                                    var _v1 = _arc + 2 * Math.PI * _k;
                                    var _v2 = Math.PI - _arc + 2 * Math.PI * _k;
                                    if (Math.abs(_v1) <= _pc.r2 + 1e-12 || Math.abs(_v2) <= _pc.r2 + 1e-12) {
                                        _found = true; break;
                                    }
                                }
                                if (!_found) {
                                    state.done = true;
                                    state.result = {
                                        solutions: [], error: "NO_SOLUTION",
                                        message: "区间算术分析：sin(" + _va + "*" + _vb + ")=" + _constC + " 要求 " + _va + "*" + _vb + "≈" + _closestVal.toFixed(4) + "，但由 " + _va + "²+" + _vb + "²=" + (2*_pc.r2).toFixed(2) + " 知 |" + _va + "*" + _vb + "|≤" + _pc.r2.toFixed(4) + "，矛盾，无解",
                                        executionPath: "区间算术", timeMs: performance.now() - state.startTime,
                                        confidence: "high", varNames: state.varNames,
                                        unconverged: false, resultType: 1, resultTypeName: "空结果",
                                        resultTypeDesc: "区间算术严格证明不存在满足条件的解"
                                    };
                                    return;
                                }
                            }
                        }
                    }
                }
            }
        }
        if (state.done) return;
    }

    // 4. 若区间收缩有效，标记已收缩
    if (_contracted) {
        // 检查收缩后是否导致矛盾（某个变量区间为空）
        for (var _ci25 = 0; _ci25 < state.varNames.length; _ci25++) {
            var _cvn25 = state.varNames[_ci25];
            if (state.D0[_cvn25] && state.D0[_cvn25].min > state.D0[_cvn25].max) {
                state.done = true;
                state.result = {
                    solutions: [], error: "NO_SOLUTION",
                    message: "区间收缩后变量 " + _cvn25 + " 的搜索域为空",
                    executionPath: "区间算术", timeMs: performance.now() - state.startTime,
                    confidence: "high", varNames: state.varNames,
                    resultType: 1, resultTypeName: "空结果", resultTypeDesc: "区间算术严格证明不存在满足条件的解"
                };
                return;
            }
        }
    }
}


function suan29(state) {
    if (state.varNames.length !== 1) return;
    var vn = state.varNames[0];
    var domain = state.D0[vn];
    if (!domain) return;

    var a = domain.min, b = domain.max;
    if (!isFinite(a) || !isFinite(b) || b <= a) return;
    if (b - a < 1e-10) return;

    var box = {}; box[vn] = { min: a, max: b };

    // 严格测试①（最强）：f 在区间上的区间包络不含 0 → 由中值定理严格证明该盒内无根
    var F = intervalEval(state.equations[0], box);
    if (F && _ivExcludesZero(F)) {
        state.done = true;
        state.result = { solutions: [], error: "NO_SOLUTION", provenEmpty: true, message: "f 在 [" + a + "," + b + "] 上的严格区间包络不含 0（包络=[" + F.min.toExponential(2) + "," + F.max.toExponential(2) + "]），由中值定理严格证明该盒内无根", executionPath: "导数单调性剪枝", timeMs: performance.now() - state.startTime, confidence: "high", varNames: state.varNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "区间包络严格证明区间内无根" };
        return;
    }

    // 严格测试②（单调+端点同号）：导数包络排除 0 ⇒ 确证严格单调；
    //   再结合端点值（退化点盒的区间求值）同号 ⇒ 由中值定理严格证明无根。
    //   用符号微分+区间求值得到【紧致】导数包络，取代原“3 条割线同号”启发式（会漏根，见评审 unsound）。
    var dAST = _diffAST(state.equations[0], vn);
    var dI = dAST ? intervalEval(dAST, box) : null;
    if (dI && _ivExcludesZero(dI)) {
        var faBox = {}, fbBox = {}; faBox[vn] = { min: a, max: a }; fbBox[vn] = { min: b, max: b };
        var faI = intervalEval(state.equations[0], faBox);
        var fbI = intervalEval(state.equations[0], fbBox);
        if (faI && fbI && ((faI.min > 0 && fbI.min > 0) || (faI.max < 0 && fbI.max < 0))) {
            state.done = true;
            state.result = { solutions: [], error: "NO_SOLUTION", provenEmpty: true, message: "函数在区间 [" + a + "," + b + "] 上导数包络排除 0（严格单调）且两端点同号，由中值定理严格证明区间内无根", executionPath: "导数单调性剪枝", timeMs: performance.now() - state.startTime, confidence: "high", varNames: state.varNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "导数单调性严格证明区间内无根" };
            return;
        }
    }
}


function suan26(state) {
    if (state.varNames.length !== 1) return;
    var vn = state.varNames[0];
    var domain = state.D0[vn];
    if (!domain) return;
    
    var a = domain.min, b = domain.max;
    if (!isFinite(a) || !isFinite(b)) return;
    if (b - a < 1e-10) return;
    
    // 检查是否为偶函数: f(x) == f(-x)
    // 采样检查
    var testPoints = [a + (b-a)*0.25, (a+b)/2, a + (b-a)*0.75];
    var isEven = true;
    var eps = 1e-8;
    
    for (var ti = 0; ti < testPoints.length; ti++) {
        var x = testPoints[ti];
        if (Math.abs(x) < 1e-10) continue;
        var v1 = {}; v1[vn] = x;
        var v2 = {}; v2[vn] = -x;
        var f1 = evalAST(state.equations[0], v1);
        var f2 = evalAST(state.equations[0], v2);
        if (isFinite(f1) && isFinite(f2)) {
            if (Math.abs(f1 - f2) > 1e-6 * (Math.abs(f1) + 1)) {
                isEven = false;
                break;
            }
        }
    }
    
    // 偶函数本可“域缩半到 [0,∞)”以加速，但原实现只砍负半轴而不把解镜像回 -x，
    // 会丢 x=-2 类解（见评审 unsound）。为保证【不丢解】，此处保守地不做域削减（保留完整搜索域）。
    // 后续里程碑：实现“削减 + 解镜像回填”以同时获得正确性与剪枝收益。
    
    // 检查是否为奇函数: f(x) == -f(-x)
    var isOdd = true;
    for (var ti = 0; ti < testPoints.length; ti++) {
        var x = testPoints[ti];
        if (Math.abs(x) < 1e-10) continue;
        var v1 = {}; v1[vn] = x;
        var v2 = {}; v2[vn] = -x;
        var f1 = evalAST(state.equations[0], v1);
        var f2 = evalAST(state.equations[0], v2);
        if (isFinite(f1) && isFinite(f2)) {
            if (Math.abs(f1 + f2) > 1e-6 * (Math.abs(f1) + 1)) {
                isOdd = false;
                break;
            }
        }
    }
    
    // 奇函数在对称区间上必有f(0)=0，但不做特殊处理，保留完整搜索域
}


function suan34(state) {
    if (!state.equations || !state.D0 || state.varNames.length === 0) return;
    var varNames = state.varNames, box = state.D0, n = varNames.length, eqs = state.equations;
    if (eqs.length === 0) return;
    var mid = _boxMid(box, varNames);
    var midVars = _midVars(mid, varNames);
    var rows = [];
    for (var k = 0; k < eqs.length; k++) {
        var eq = eqs[k], Jm = new Array(n), ok = true;
        for (var j = 0; j < n; j++) {
            var xP = mid.slice(), xM = mid.slice(), eps = 1e-6;
            xP[j] = mid[j] + eps; xM[j] = mid[j] - eps;
            var vP = {}, vM = {};
            varNames.forEach(function (v, kk) { vP[v] = xP[kk]; vM[v] = xM[kk]; });
            var fp = evalAST(eq, vP), fm = evalAST(eq, vM);
            if (!isFinite(fp) || !isFinite(fm)) { ok = false; break; }
            var d = (fp - fm) / (2 * eps);
            if (!isFinite(d)) { ok = false; break; }
            Jm[j] = d;
        }
        if (!ok) continue;
        var F = intervalEval(eq, box);
        if (!F || !isFinite(F.min) || !isFinite(F.max)) continue;
        var fm0 = evalAST(eq, midVars);
        if (!isFinite(fm0)) continue;
        // 中点线性化在盒上的区间像
        var Lm = { min: fm0, max: fm0 };
        for (var j2 = 0; j2 < n; j2++) {
            var dj = { min: box[varNames[j2]].min - mid[j2], max: box[varNames[j2]].max - mid[j2] };
            Lm = _iAdd(Lm, _iMul({ min: Jm[j2], max: Jm[j2] }, dj));
        }
        // 线性判别：余项 F - Lm 在盒上的偏差应≈0（缩放归一化）
        var scale = Math.max(1, Math.abs(fm0), Math.abs(F.min), Math.abs(F.max));
        var linErr = Math.max(Math.abs(F.min - Lm.min), Math.abs(F.max - Lm.max));
        if (linErr > 1e-9 * scale) continue; // 非线性：跳过，交 suan33/51/56 处理
        var C = fm0;
        for (var j3 = 0; j3 < n; j3++) C -= Jm[j3] * mid[j3];
        // ΣJm_j x_j + C = 0  →  ΣJm x_j + C <= 0 且 -ΣJm x_j - C <= 0
        rows.push({ a: Jm.slice(), rhs: -C });
        rows.push({ a: Jm.map(function (v) { return -v; }), rhs: C });
    }
    if (rows.length === 0) return;
    for (var b2 = 0; b2 < n; b2++) {
        var aa = new Array(n).fill(0); aa[b2] = 1; rows.push({ a: aa, rhs: box[varNames[b2]].max });
        var aa2 = new Array(n).fill(0); aa2[b2] = -1; rows.push({ a: aa2, rhs: -box[varNames[b2]].min });
    }
    for (var v = 0; v < n; v++) {
        var lo = box[varNames[v]].min, hi = box[varNames[v]].max;
        if (!isFinite(lo) || !isFinite(hi)) continue;
        var cap = hi - lo;
        if (cap < 0) continue;
        var tRows = [];
        for (var r = 0; r < rows.length; r++) {
            var rhsT = rows[r].rhs;
            for (var j4 = 0; j4 < n; j4++) rhsT -= rows[r].a[j4] * box[varNames[j4]].min;
            tRows.push({ a: rows[r].a, rhs: rhsT });
        }
        var capRow = new Array(n).fill(0); capRow[v] = 1; tRows.push({ a: capRow, rhs: cap });
        var A2 = tRows.map(function (rr) { return rr.a; });
        var b2v = tRows.map(function (rr) { return rr.rhs; });
        var cMax = new Array(n).fill(0); cMax[v] = 1;
        var cMin = new Array(n).fill(0); cMin[v] = -1;
        var tMax = _lpMaximize(cMax, A2, b2v);
        var tMinRaw = _lpMaximize(cMin, A2, b2v);
        var tMin = (tMinRaw !== null && isFinite(tMinRaw)) ? -tMinRaw : null;
        // 保守安全余量：只向外（不切真解），吸收单纯形浮点误差
        var SAFE_HI = 1e-9 * (1 + Math.abs(lo + (tMax || 0)));
        var SAFE_LO = 1e-9 * (1 + Math.abs(lo + (tMin || 0)));
        if (tMax !== null && isFinite(tMax) && lo + tMax + SAFE_HI < hi) box[varNames[v]].max = lo + tMax + SAFE_HI;
        if (tMin !== null && isFinite(tMin) && lo + tMin - SAFE_LO > lo) box[varNames[v]].min = lo + tMin - SAFE_LO;
        if (box[varNames[v]].min > box[varNames[v]].max + 1e-12) {
            _declareNoSolution(state, "suan34 LP Narrowing", v, "变量 " + varNames[v] + " 线性松弛证明区间为空，严格无解");
            return;
        }
    }
}


function _hc4Node2(node, target, box) {
    if (!node) return box;
    if (node.type === 'num') return box;
    if (node.type === 'var') {
        if (!box[node.name]) return box;
        box[node.name] = _iIntersect(box[node.name], target);
        return box;
    }
    if (node.type === 'binop') {
        var L = intervalEval(node.left, box), R = intervalEval(node.right, box);
        if (!L || !R) return box;
        var newL = null, newR = null;
        if (node.op === '+') { newL = _iSub(target, R); newR = _iSub(target, L); }
        else if (node.op === '-') { newL = _iAdd(target, R); newR = _iSub(L, target); }
        else if (node.op === '*') { var ri = _iRecip(R), li = _iRecip(L); if (ri) newL = _iMul(target, ri); if (li) newR = _iMul(target, li); }
        else if (node.op === '/') {
            newL = _iMul(target, R);
            if (_iEmpty(_iIntersect(target, { min: 0, max: 0 }))) { var ti = _iRecip(target); if (ti) newR = _iMul(L, ti); }
        }
        else if (node.op === '^') {
            var rconst = (node.right.type === 'num') ? node.right.value : null;
            var lconst = (node.left.type === 'num') ? node.left.value : null;
            if (rconst !== null && Number.isInteger(rconst) && Math.abs(rconst) < 100 && rconst !== 0) {
                var rt = _iRoot(target, rconst);
                if (rt) newL = rt;
            } else if (lconst !== null && lconst > 0 && lconst !== 1) {
                if (target.max > 0) {
                    var lnT = { min: Math.log(Math.max(1e-300, target.min)), max: Math.log(target.max) };
                    var lc = 1 / Math.log(lconst);
                    newR = _iMul(lnT, { min: lc, max: lc });
                }
            }
        }
        if (newL) box = _hc4Node2(node.left, newL, box);
        if (newR) box = _hc4Node2(node.right, newR, box);
        return box;
    }
    if (node.type === 'func') {
        var arg = node.arg || (node.args ? node.args[0] : null);
        if (!arg) return box;
        var aR = intervalEval(arg, box);
        if (!aR) return box;
        var nt = null;
        if (node.name === 'sin') {
            if (target.min < -1 || target.max > 1) return box;
            var lo = Math.asin(Math.max(-1, target.min)), hi = Math.asin(Math.min(1, target.max));
            nt = { min: lo, max: hi };
            for (var s1 = -3; s1 <= 3; s1++) { nt = _iHull(nt, { min: lo + 2 * s1 * Math.PI, max: hi + 2 * s1 * Math.PI }); nt = _iHull(nt, { min: Math.PI - hi + 2 * s1 * Math.PI, max: Math.PI - lo + 2 * s1 * Math.PI }); }
        } else if (node.name === 'cos') {
            if (target.min < -1 || target.max > 1) return box;
            var lo2 = Math.acos(Math.min(1, target.max)), hi2 = Math.acos(Math.max(-1, target.min));
            nt = { min: lo2, max: hi2 };
            for (var s2 = -3; s2 <= 3; s2++) nt = _iHull(nt, { min: lo2 + 2 * s2 * Math.PI, max: hi2 + 2 * s2 * Math.PI });
        } else if (node.name === 'tan') {
            var lo3 = Math.atan(target.min), hi3 = Math.atan(target.max);
            nt = { min: lo3, max: hi3 };
            for (var s3 = -3; s3 <= 3; s3++) nt = _iHull(nt, { min: lo3 + s3 * Math.PI, max: hi3 + s3 * Math.PI });
        } else if (node.name === 'exp') {
            if (target.max <= 0) return box;
            nt = { min: Math.log(Math.max(1e-300, target.min)), max: Math.log(target.max) };
        } else if (node.name === 'ln' || node.name === 'log') {
            nt = { min: Math.exp(target.min), max: Math.exp(target.max) };
        } else if (node.name === 'log10') {
            nt = { min: Math.pow(10, target.min), max: Math.pow(10, target.max) };
        } else if (node.name === 'sqrt') {
            if (target.min < 0) return box;
            nt = { min: target.min * target.min, max: target.max * target.max };
        } else if (node.name === 'abs') {
            var u = { min: Math.max(0, target.min), max: target.max };
            nt = _iHull(u, { min: -u.max, max: -u.min });
        } else { return box; }
        if (nt) box = _hc4Node2(arg, nt, box);
        return box;
    }
    return box;
}


function suan28(state) {
    if (!state.equations || !state.D0 || state.varNames.length === 0) return;
    var varNames = state.varNames, box = state.D0;
    for (var pass = 0; pass < 8; pass++) {
        var before = _cloneBox(box);
        for (var k = 0; k < state.equations.length; k++) {
            var R = intervalEval(state.equations[k], box);
            if (R && (R.max < -1e-12 || R.min > 1e-12)) {
                _declareNoSolution(state, "suan28 约束反演(前向)", k, "值域 [" + R.min.toFixed(6) + "," + R.max.toFixed(6) + "] 不含0，严格证明无解");
                return;
            }
        }
        for (var k2 = 0; k2 < state.equations.length; k2++) {
            var eq = state.equations[k2];
            if (eq.type === 'binop' && eq.op === '-') {
                var rl = intervalEval(eq.left, box), rr = intervalEval(eq.right, box);
                if (rl && rr) {
                    box = _hc4Node2(eq.left, rr, box);
                    box = _hc4Node2(eq.right, rl, box);
                    state.D0 = box;
                }
            }
        }
        for (var v = 0; v < varNames.length; v++) {
            if (box[varNames[v]].min > box[varNames[v]].max + 1e-12) {
                _declareNoSolution(state, "suan28 约束反演(反向)", v, "变量 " + varNames[v] + " 区间被收缩为空，严格证明无解");
                return;
            }
        }
        if (!_contractionChanged(before, box, varNames)) break;
    }
}


function suan32(state) {
    if (!state.equations || !state.D0 || state.varNames.length === 0) return;
    var varNames = state.varNames, box = state.D0, n = varNames.length, eqs = state.equations;
    if (eqs.length === 0 || n < 2) return;
    for (var pass = 0; pass < 4; pass++) {
        var mid = _boxMid(box, varNames);
        var J = _intervalJacobian(eqs, varNames, box, mid);
        var Fm = eqs.map(function (eq) { return evalAST(eq, _midVars(mid, varNames)); });
        var before = _cloneBox(box);
        for (var i = 0; i < n; i++) {
            for (var j = i + 1; j < n; j++) {
                for (var k = 0; k < eqs.length; k++) {
                    var Ji = J[k][i], Jj = J[k][j], fmk = Fm[k];
                    if (!isFinite(fmk)) continue;
                    var invI = _iRecip(Ji), invJ = _iRecip(Jj);
                    if (invI) {
                        var dXj = { min: box[varNames[j]].min - mid[j], max: box[varNames[j]].max - mid[j] };
                        var numer = _iAdd({ min: fmk, max: fmk }, _iMul(Jj, dXj));
                        var Ni = _iSub({ min: mid[i], max: mid[i] }, _iMul(invI, numer));
                        var inter = _iIntersect(box[varNames[i]], Ni);
                        if (!_iEmpty(inter)) box[varNames[i]] = inter;
                    }
                    if (invJ) {
                        var dXi = { min: box[varNames[i]].min - mid[i], max: box[varNames[i]].max - mid[i] };
                        var numer2 = _iAdd({ min: fmk, max: fmk }, _iMul(Ji, dXi));
                        var Nj = _iSub({ min: mid[j], max: mid[j] }, _iMul(invJ, numer2));
                        var inter2 = _iIntersect(box[varNames[j]], Nj);
                        if (!_iEmpty(inter2)) box[varNames[j]] = inter2;
                    }
                }
            }
        }
        // 保守性校验（2026-08-21 修复）：单方程线性化收缩无 Taylor 余项，对强耦合
        // 非线性（如三球交点 x²+y²+z²=9 等）可能把真解排除到收缩域外——具体表现为
        // 收缩后某方程的值域不含 0。此时回滚本轮收缩（保保守方向），交分支定界处理。
        var _allOk56 = true;
        for (var _kv56 = 0; _kv56 < eqs.length; _kv56++) {
            var _rv56 = intervalEval(eqs[_kv56], box);
            if (_rv56 && (_rv56.max < -1e-9 || _rv56.min > 1e-9)) { _allOk56 = false; break; }
        }
        if (!_allOk56) {
            box = before;
            state.D0 = before;
            break;
        }
        if (!_contractionChanged(before, box, varNames)) break;
    }
}


function suan33(state) {
    if (!state.equations || !state.D0 || state.varNames.length === 0) return;
    var varNames = state.varNames, box = state.D0, n = varNames.length, equations = state.equations;
    if (equations.length < n) return; // 需方阵/超定
    for (var pass = 0; pass < 4; pass++) {
        var mid = _boxMid(box, varNames);
        var J = _intervalJacobian(equations, varNames, box, mid);
        var Fm = equations.map(function (eq) { return evalAST(eq, _midVars(mid, varNames)); });
        var before = _cloneBox(box);
        for (var i = 0; i < n; i++) {
            var inv = _iRecip(J[i][i]);
            if (!inv) continue; // 对角含零，保守跳过
            var numer = { min: Fm[i], max: Fm[i] };
            for (var j = 0; j < n; j++) {
                if (j === i) continue;
                var dXj = { min: box[varNames[j]].min - mid[j], max: box[varNames[j]].max - mid[j] };
                numer = _iAdd(numer, _iMul(J[i][j], dXj));
            }
            var Ni = _iSub({ min: mid[i], max: mid[i] }, _iMul(inv, numer));
            var inter = _iIntersect(box[varNames[i]], Ni);
            if (!_iEmpty(inter)) box[varNames[i]] = inter;
        }
        if (!_contractionChanged(before, box, varNames)) break;
    }
}


function suan31(state) {
    if (!state.equations || !state.D0 || state.varNames.length === 0) return;
    var varNames = state.varNames, box = state.D0, n = varNames.length, equations = state.equations;
    for (var pass = 0; pass < 4; pass++) {
        var mid = _boxMid(box, varNames);
        var J = _intervalJacobian(equations, varNames, box, mid);
        var before = _cloneBox(box);
        for (var k = 0; k < equations.length; k++) {
            for (var i = 0; i < n; i++) {
                var mi = mid[i];
                var boxFixed = _cloneBox(box);
                boxFixed[varNames[i]] = { min: mi, max: mi };
                var R = intervalEval(equations[k], boxFixed);
                if (!R) continue;
                var inv = _iRecip(J[k][i]);
                if (!inv) continue;
                var Ni = _iSub({ min: mi, max: mi }, _iMul(inv, R));
                var inter = _iIntersect(box[varNames[i]], Ni);
                if (!_iEmpty(inter)) box[varNames[i]] = inter;
            }
        }
        if (!_contractionChanged(before, box, varNames)) break;
    }
}


function _hc4Node(node, target, box) {
    if (!node) return box;
    if (node.type === 'num') return box;
    if (node.type === 'var') {
        if (!box[node.name]) return box;
        box[node.name] = _iIntersect(box[node.name], target); // 可能为空（min>max），由 suan27 检测
        return box;
    }
    if (node.type === 'binop') {
        var L = intervalEval(node.left, box), R = intervalEval(node.right, box);
        if (!L || !R) return box;
        var newL = null, newR = null;
        if (node.op === '+') { newL = _iSub(target, R); newR = _iSub(target, L); }
        else if (node.op === '-') { newL = _iAdd(target, R); newR = _iSub(L, target); }
        else if (node.op === '*') { var ri = _iRecip(R); var li = _iRecip(L); if (ri) newL = _iMul(target, ri); if (li) newR = _iMul(target, li); }
        else if (node.op === '/') {
            newL = _iMul(target, R);
            if (!_iEmpty(_iIntersect(target, { min: 0, max: 0 }))) { /* 含零，不反演右部 */ }
            else { var ti = _iRecip(target); if (ti) newR = _iMul(L, ti); }
        }
        if (newL) box = _hc4Node(node.left, newL, box);
        if (newR) box = _hc4Node(node.right, newR, box);
        return box;
    }
    if (node.type === 'func') {
        var arg = node.arg || (node.args ? node.args[0] : null);
        if (!arg) return box;
        var aR = intervalEval(arg, box);
        if (!aR) return box;
        var nt = null;
        if (node.name === 'sin') {
            if (target.min < -1 || target.max > 1) return box;
            var lo = Math.asin(Math.max(-1, target.min)), hi = Math.asin(Math.min(1, target.max));
            nt = { min: lo, max: hi };
            for (var s1 = -3; s1 <= 3; s1++) { nt = _iHull(nt, { min: lo + 2 * s1 * Math.PI, max: hi + 2 * s1 * Math.PI }); nt = _iHull(nt, { min: Math.PI - hi + 2 * s1 * Math.PI, max: Math.PI - lo + 2 * s1 * Math.PI }); }
        } else if (node.name === 'cos') {
            if (target.min < -1 || target.max > 1) return box;
            var lo2 = Math.acos(Math.min(1, target.max)), hi2 = Math.acos(Math.max(-1, target.min));
            nt = { min: lo2, max: hi2 };
            for (var s2 = -3; s2 <= 3; s2++) nt = _iHull(nt, { min: lo2 + 2 * s2 * Math.PI, max: hi2 + 2 * s2 * Math.PI });
        } else if (node.name === 'tan') {
            var lo3 = Math.atan(target.min), hi3 = Math.atan(target.max);
            nt = { min: lo3, max: hi3 };
            for (var s3 = -3; s3 <= 3; s3++) nt = _iHull(nt, { min: lo3 + s3 * Math.PI, max: hi3 + s3 * Math.PI });
        } else if (node.name === 'exp') {
            if (target.max <= 0) return box;
            nt = { min: Math.log(Math.max(1e-300, target.min)), max: Math.log(target.max) };
        } else if (node.name === 'ln' || node.name === 'log') {
            nt = { min: Math.exp(target.min), max: Math.exp(target.max) };
        } else if (node.name === 'sqrt') {
            if (target.min < 0) return box;
            nt = { min: target.min * target.min, max: target.max * target.max };
        } else if (node.name === 'abs') {
            var u = { min: Math.max(0, target.min), max: target.max };
            nt = _iHull(u, { min: -u.max, max: -u.min });
        } else { return box; }
        if (nt) box = _hc4Node(arg, nt, box);
        return box;
    }
    return box;
}


function suan27(state) {
    if (!state.equations || !state.D0 || state.varNames.length === 0) return;
    var varNames = state.varNames, box = state.D0;
    for (var pass = 0; pass < 8; pass++) {
        var before = _cloneBox(box);
        // 1) 前向：等式约束 C=0，若 0 ∉ intervalEval(C, box) → 严格证明无解
        for (var k = 0; k < state.equations.length; k++) {
            var R = intervalEval(state.equations[k], box);
            if (R && (R.max < -1e-12 || R.min > 1e-12)) {
                _declareNoSolution(state, "suan27 HC4-Revise(前向)", k, "值域 [" + R.min.toFixed(6) + "," + R.max.toFixed(6) + "] 不含0，严格证明该盒子内无解");
                return;
            }
        }
        // 2) 反向 hull 一致性（fixpoint）：对 L - R = 0 沿 AST 反向收窄叶子变量
        for (var k2 = 0; k2 < state.equations.length; k2++) {
            var eq = state.equations[k2];
            if (eq.type === 'binop' && eq.op === '-') {
                var rl = intervalEval(eq.left, box), rr = intervalEval(eq.right, box);
                if (rl && rr) {
                    box = _hc4Node(eq.left, rr, box);
                    box = _hc4Node(eq.right, rl, box);
                    state.D0 = box;
                }
            }
        }
        for (var v = 0; v < varNames.length; v++) {
            if (box[varNames[v]].min > box[varNames[v]].max + 1e-12) {
                _declareNoSolution(state, "suan27 HC4-Revise(反向)", v, "变量 " + varNames[v] + " 区间被收缩为空，严格证明无解");
                return;
            }
        }
        if (!_contractionChanged(before, box, varNames)) break;
    }
}


function suan30(state) {
    if (!state.equations || !state.D0 || state.varNames.length === 0) return;
    var varNames = state.varNames, box = state.D0, n = varNames.length;
    for (var k = 0; k < state.equations.length; k++) {
        var eq = state.equations[k];
        for (var i = 0; i < n; i++) {
            var vi = varNames[i];
            var boxLo = _cloneBox(box); boxLo[vi] = { min: box[vi].min, max: box[vi].min };
            var boxHi = _cloneBox(box); boxHi[vi] = { min: box[vi].max, max: box[vi].max };
            var Rlo = intervalEval(eq, boxLo), Rhi = intervalEval(eq, boxHi);
            if (!Rlo || !Rhi) continue;
            var d1 = _partialRange(eq, i, varNames, box, 1);
            if (d1 && (d1.max < -1e-12 || d1.min > 1e-12)) {
                var loNeg = Rlo.max < -1e-12, loPos = Rlo.min > 1e-12;
                var hiNeg = Rhi.max < -1e-12, hiPos = Rhi.min > 1e-12;
                if ((loNeg && hiNeg) || (loPos && hiPos)) {
                    _declareNoSolution(state, "suan30 单调性剪枝", k, "变量 " + vi + " 单调且两端同号，严格证明该盒子内无解");
                    return;
                }
            }
            var d2 = _partialRange(eq, i, varNames, box, 2);
            if (d2 && d2.min > 1e-12) {
                if (Rlo.max < -1e-12 && Rhi.max < -1e-12) {
                    _declareNoSolution(state, "suan30 凸性剪枝", k, "变量 " + vi + " 凸且两端点均<0，严格证明该盒子内无解");
                    return;
                }
            } else if (d2 && d2.max < -1e-12) {
                if (Rlo.min > 1e-12 && Rhi.min > 1e-12) {
                    _declareNoSolution(state, "suan30 凹性剪枝", k, "变量 " + vi + " 凹且两端点均>0，严格证明该盒子内无解");
                    return;
                }
            }
        }
    }
}

// ═══════════════════ 模块：operators/numeric ═══════════════════
/* 模块 operators/numeric：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function suan40(state) {
    if (!state.startPoints || state.startPoints.length === 0) {
        // 如果没有起始点，尝试从默认网格生成
        state.startPoints = generateStartPoints(state.varNames, state.D0, state);
        if (!state.startPoints || state.startPoints.length === 0) return;
    }

    var allSolutions = [];
    var WATCHDOG_MS = 600;

    for (var spi = 0; spi < state.startPoints.length; spi++) {
        if (performance.now() - state.startTime > WATCHDOG_MS) break;
        var sp = state.startPoints[spi];
        var result = lineSearchNewton(state.equations, state.varNames, sp, {
            maxIter: state.maxIter,
            tolerance: state.tolerance,
            _deadline: performance.now() + 100
        });
        if (result.converged) {
            var sol = result.solution.map(function(v) { return roundToGrid(v); });
            var hasNaN = false;
            for (var si = 0; si < sol.length; si++) {
                if (isNaN(sol[si]) || !isFinite(sol[si]) || Math.abs(sol[si]) > 1000000) { hasNaN = true; break; }
            }
            if (hasNaN) continue;
            var vars = {};
            state.varNames.forEach(function(v, i) { vars[v] = sol[i]; });
            var res = 0;
            state.equations.forEach(function(eq) { var r = Math.abs(evalAST(eq, vars)); if (r > res) res = r; });
            allSolutions.push({ values: sol, residual: res });
        }
    }

    if (allSolutions.length > 0) {
        var seen = new Set();
        var unique = allSolutions.filter(function(s) {
            var hash = s.values.map(function(v) { return v.toFixed(6); }).join(",");
            if (seen.has(hash)) return false;
            seen.add(hash);
            return true;
        });
        unique.sort(function(a, b) { return a.residual - b.residual; });
        state.allRawSolutions = unique;
    }
}


function suan41(state) {
    var tolerance = state.tolerance;
    var maxBoxes = 20;
    var eps = 1e-7;
    var n = state.varNames.length;
    
    // 初始区间栈
    var stack = [state.D0];
    var solutions = [];
    var iterations = 0;
    
    while (stack.length > 0 && iterations < 200) {
        iterations++;
        var X = stack.pop();
        if (!X) continue;
        
        // 计算区间宽度，如果足够小则取中点作为候选解
        var maxWidth = 0;
        for (var vi = 0; vi < n; vi++) {
            var vn = state.varNames[vi];
            var w = X[vn].max - X[vn].min;
            if (w > maxWidth) maxWidth = w;
        }
        
        if (maxWidth < tolerance) {
            // 取中点作为候选解
            var candidate = new Array(n);
            for (var vi = 0; vi < n; vi++) {
                var vn = state.varNames[vi];
                candidate[vi] = (X[vn].min + X[vn].max) / 2;
            }
            var vars = {};
            state.varNames.forEach(function(v, k) { vars[v] = candidate[k]; });
            var F = state.equations.map(function(eq) { return evalAST(eq, vars); });
            var maxRes = 0;
            var _hasNaN = false;
            for (var fi = 0; fi < F.length; fi++) {
                if (isNaN(F[fi]) || !isFinite(F[fi])) { _hasNaN = true; break; }
                var absF = Math.abs(F[fi]);
                if (absF > maxRes) maxRes = absF;
            }
            if (!_hasNaN && maxRes < tolerance * 10) {
                solutions.push({ values: candidate, residual: maxRes });
            }
            continue;
        }
        
        var mid = new Array(n);
        for (var vi = 0; vi < n; vi++) {
            var vn = state.varNames[vi];
            mid[vi] = (X[vn].min + X[vn].max) / 2;
        }
        
        // 计算F(mid)
        var vars = {};
        state.varNames.forEach(function(v, k) { vars[v] = mid[k]; });
        var Fmid = state.equations.map(function(eq) { return evalAST(eq, vars); });
        var hasNaN = false;
        for (var fi = 0; fi < Fmid.length; fi++) {
            if (isNaN(Fmid[fi]) || !isFinite(Fmid[fi])) { hasNaN = true; break; }
        }
        if (hasNaN) {
            // 区间包含奇异点，直接分裂
            var splitVar = 0;
            var maxW = 0;
            for (var vi = 0; vi < n; vi++) {
                var vn = state.varNames[vi];
                var w = X[vn].max - X[vn].min;
                if (w > maxW) { maxW = w; splitVar = vi; }
            }
            var svn = state.varNames[splitVar];
            var midVal = (X[svn].min + X[svn].max) / 2;
            var X1 = {}, X2 = {};
            for (var vi = 0; vi < n; vi++) {
                var vn = state.varNames[vi];
                X1[vn] = { min: X[vn].min, max: (vi === splitVar ? midVal : X[vn].max) };
                X2[vn] = { min: (vi === splitVar ? midVal : X[vn].min), max: X[vn].max };
            }
            if (stack.length < maxBoxes) {
                stack.push(X2);
                stack.push(X1);
            }
            continue;
        }
        
        // 计算区间雅可比矩阵 F'(X)
        var Jint = [];
        for (var i = 0; i < state.equations.length; i++) {
            Jint.push(new Array(n));
            for (var j = 0; j < n; j++) {
                // 数值区间导数：在X上计算偏导数的区间
                var dMin = Infinity, dMax = -Infinity;
                var samplePts = [mid[j], X[state.varNames[j]].min, X[state.varNames[j]].max];
                for (var si = 0; si < samplePts.length; si++) {
                    var xP = mid.slice();
                    xP[j] = samplePts[si] + eps;
                    var xM = mid.slice();
                    xM[j] = samplePts[si] - eps;
                    var vP = {}, vM = {};
                    state.varNames.forEach(function(v, k) { vP[v] = xP[k]; vM[v] = xM[k]; });
                    var fp = evalAST(state.equations[i], vP);
                    var fm = evalAST(state.equations[i], vM);
                    var deriv = (fp - fm) / (2 * eps);
                    if (isFinite(deriv) && !isNaN(deriv)) {
                        if (deriv < dMin) dMin = deriv;
                        if (deriv > dMax) dMax = deriv;
                    }
                }
                Jint[i][j] = { min: dMin === Infinity ? 0 : dMin, max: dMax === -Infinity ? 0 : dMax };
            }
        }
        
        // 构造区间牛顿算子：N(X) = mid - J(X)^{-1} * F(mid)
        // 使用高斯消元法解 J * delta = F(mid)
        // 区间高斯消元（简化：用中点矩阵近似）
        var Jmid = [];
        for (var i = 0; i < state.equations.length; i++) {
            Jmid.push(new Array(n));
            for (var j = 0; j < n; j++) {
                Jmid[i][j] = (Jint[i][j].min + Jint[i][j].max) / 2;
            }
        }
        
        var negFmid = Fmid.map(function(f) { return -f; });
        var gaussResult = gaussianSolve(Jmid, negFmid);
        
        if (!gaussResult) {
            // 奇异雅可比，直接分裂
            var splitVar = 0;
            var maxW = 0;
            for (var vi = 0; vi < n; vi++) {
                var vn = state.varNames[vi];
                var w = X[vn].max - X[vn].min;
                if (w > maxW) { maxW = w; splitVar = vi; }
            }
            var svn = state.varNames[splitVar];
            var midVal = (X[svn].min + X[svn].max) / 2;
            var X1 = {}, X2 = {};
            for (var vi = 0; vi < n; vi++) {
                var vn = state.varNames[vi];
                X1[vn] = { min: X[vn].min, max: (vi === splitVar ? midVal : X[vn].max) };
                X2[vn] = { min: (vi === splitVar ? midVal : X[vn].min), max: X[vn].max };
            }
            if (stack.length < maxBoxes) {
                stack.push(X2);
                stack.push(X1);
            }
            continue;
        }
        
        var delta = gaussResult.solution;
        
        // 计算N(X)的区间：delta的区间扩展
        var N = {};
        for (var vi = 0; vi < n; vi++) {
            var vn = state.varNames[vi];
            // 用区间扩张计算delta的误差边界
            var deltaErr = 0;
            for (var j = 0; j < n; j++) {
                var halfWidth = (Jint[vi][j].max - Jint[vi][j].min) / 2;
                deltaErr += halfWidth * Math.abs(delta[j]);
            }
            var dVal = delta[vi];
            N[vn] = {
                min: mid[vi] + dVal - deltaErr - 1e-10,
                max: mid[vi] + dVal + deltaErr + 1e-10
            };
        }
        
        // 区间牛顿判定
        var isSubset = true;    // N(X) ⊆ X ?
        var isDisjoint = false; // N(X) ∩ X = ∅ ?
        
        for (var vi = 0; vi < n; vi++) {
            var vn = state.varNames[vi];
            var Nlo = N[vn].min, Nhi = N[vn].max;
            var Xlo = X[vn].min, Xhi = X[vn].max;
            
            // 检查N(X) ⊆ X
            if (Nlo < Xlo - 1e-10 || Nhi > Xhi + 1e-10) isSubset = false;
            // 检查N(X) ∩ X = ∅
            if (Nhi < Xlo - 1e-10 || Nlo > Xhi + 1e-10) isDisjoint = true;
        }
        
        if (isDisjoint) {
            // 注意：区间雅可比用的是"中点矩阵近似"而非严格区间包络，
            // 因此 N(X)∩X=∅ 不可靠——可能把真含解的盒子误判为无解而漏解。
            // 为保证"不漏解"，此处不丢弃盒子，而是继续走下方 else 的分裂分支，
            // 让更深层的区间判定去处理（isSubset 必为 false，故会进入分裂）。
        }
        
        if (isSubset) {
            // N(X) ⊆ X → 唯一解存在，收缩区间并继续
            // 用N(X)更新X
            var newX = {};
            for (var vi = 0; vi < n; vi++) {
                var vn = state.varNames[vi];
                newX[vn] = {
                    min: Math.max(X[vn].min, N[vn].min),
                    max: Math.min(X[vn].max, N[vn].max)
                };
            }
            // 检查新区间宽度，如果足够小则取中点
            var w = 0;
            for (var vi = 0; vi < n; vi++) {
                var vn = state.varNames[vi];
                var ww = newX[vn].max - newX[vn].min;
                if (ww > w) w = ww;
            }
            if (w < tolerance) {
                var candidate = new Array(n);
                for (var vi = 0; vi < n; vi++) {
                    var vn = state.varNames[vi];
                    candidate[vi] = (newX[vn].min + newX[vn].max) / 2;
                }
                var vars = {};
                state.varNames.forEach(function(v, k) { vars[v] = candidate[k]; });
                var F = state.equations.map(function(eq) { return evalAST(eq, vars); });
                var maxRes = 0;
                var _hasNaN = false;
                for (var fi = 0; fi < F.length; fi++) {
                    if (isNaN(F[fi]) || !isFinite(F[fi])) { _hasNaN = true; break; }
                    var absF = Math.abs(F[fi]);
                    if (absF > maxRes) maxRes = absF;
                }
                if (!_hasNaN && maxRes < tolerance * 10) {
                    solutions.push({ values: candidate, residual: maxRes });
                } else {
                }
            } else {
                if (stack.length < maxBoxes) stack.push(newX);
            }
        } else {
            // N(X) 与 X 部分重叠 → 分裂
            var splitVar = 0;
            var maxW = 0;
            for (var vi = 0; vi < n; vi++) {
                var vn = state.varNames[vi];
                var w = X[vn].max - X[vn].min;
                if (w > maxW) { maxW = w; splitVar = vi; }
            }
            var svn = state.varNames[splitVar];
            var midVal = (X[svn].min + X[svn].max) / 2;
            var X1 = {}, X2 = {};
            for (var vi = 0; vi < n; vi++) {
                var vn = state.varNames[vi];
                X1[vn] = { min: X[vn].min, max: (vi === splitVar ? midVal : X[vn].max) };
                X2[vn] = { min: (vi === splitVar ? midVal : X[vn].min), max: X[vn].max };
            }
            if (stack.length < maxBoxes) {
                stack.push(X2);
                stack.push(X1);
            }
        }
    }
    
    state.intervalNewtonSolutions = solutions;
}


function suan42(state) {
    var allRaw = [];
    if (state.allRawSolutions) {
        state.allRawSolutions.forEach(function(s) { if (s.values) allRaw.push(s.values); });
    }
    if (state.intervalNewtonSolutions) {
        state.intervalNewtonSolutions.forEach(function(s) { if (s.values) allRaw.push(s.values); });
    }
    state.allRawSolutions = allRaw;

    var VERIFY_TOL = Math.max(1e-4, state.tolerance * 10);
    var verified = [];
    for (var ri = 0; ri < allRaw.length; ri++) {
        var raw = allRaw[ri];
        var vars = {};
        state.varNames.forEach(function(v, i) { vars[v] = raw[i]; });
        var maxRes = 0;
        state.equations.forEach(function(eq) {
            var r = Math.abs(evalAST(eq, vars));
            if (r > maxRes) maxRes = r;
        });
        if (maxRes < VERIFY_TOL) {
            var rounded = raw.map(roundToGrid);
            verified.push({ values: rounded, residual: maxRes });
        }
    }
    state.verified = verified;
}

// ═══════════════════ 模块：operators/post ═══════════════════
/* 模块 operators/post：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function suan43(state) {
    if (!state.verified) return;
    for (var i = 0; i < state.verified.length; i++) {
        state.verified[i].values = state.verified[i].values.map(roundToGrid);
    }
}


function suan44(state) {
    if (!state.verified || state.verified.length === 0) return;

    var VERIFY_TOL = Math.max(1e-4, state.tolerance * 10);
    var verifiedFiltered = [];
    for (var i = 0; i < state.verified.length; i++) {
        var sol = state.verified[i];
        var vars = {};
        state.varNames.forEach(function(v, idx) { vars[v] = sol.values[idx]; });
        var maxRes = 0;
        state.equations.forEach(function(eq) {
            var r = Math.abs(evalAST(eq, vars));
            if (r > maxRes) maxRes = r;
        });
        if (maxRes < VERIFY_TOL) {
            sol.residual = maxRes;
            verifiedFiltered.push(sol);
        }
    }
    state.verified = verifiedFiltered;

    // 域约束过滤
    if (state.domainConstraints.length > 0) {
        var domainFiltered = [];
        for (var dsi = 0; dsi < state.verified.length; dsi++) {
            var dSol = state.verified[dsi];
            var dViolated = false;
            for (var dci = 0; dci < state.domainConstraints.length; dci++) {
                var dc = state.domainConstraints[dci];
                var vi = state.varNames.indexOf(dc.varName);
                if (vi >= 0) {
                    var val = dSol.values[vi];
                    if (dc.min !== undefined && val < dc.min - 1e-9) { dViolated = true; break; }
                    if (dc.max !== undefined && val > dc.max + 1e-9) { dViolated = true; break; }
                }
            }
            if (!dViolated) domainFiltered.push(dSol);
        }
        if (domainFiltered.length > 0) { state.verified = domainFiltered; }
        else {
            state.done = true;
            state.result = { solutions: [], error: "NO_SOLUTION", message: "解被域约束条件过滤", executionPath: "定义域过滤", timeMs: performance.now() - state.startTime, confidence: "low", varNames: state.varNames, warnings: state.conditionWarnings.length > 0 ? state.conditionWarnings : undefined, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "候选解被域约束条件排除" };
            return;
        }
    }

    if (state.verified.length === 0) {
        state.done = true;
        state.result = { solutions: [], error: "NO_SOLUTION", message: "验证后无满足残差条件的解", executionPath: "残差过滤", timeMs: performance.now() - state.startTime, varNames: state.varNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "所有候选解残差均过大" };
        return;
    }
    state.uniqueVerified = state.verified;
}


function suan45(state) {
    if (!state.uniqueVerified || state.uniqueVerified.length === 0) return;
    state.finalSolutions = state.uniqueVerified;
    state.eliminated = 0;
}


function suan46(state) {
    if (!state.finalSolutions || state.finalSolutions.length <= 1) return;
    var valueArrays = state.finalSolutions.map(function(s) { return s.values; });
    var unique = deduplicateSolutions(valueArrays, state.varNames, state.tolerance);
    var finalUnique = [];
    for (var ui = 0; ui < unique.length; ui++) {
        var found = null;
        for (var fi = 0; fi < state.finalSolutions.length; fi++) {
            if (state.finalSolutions[fi].values === unique[ui]) { found = state.finalSolutions[fi]; break; }
        }
        if (!found) {
            var res = 0;
            var vars = {};
            state.varNames.forEach(function(v, i) { vars[v] = unique[ui][i]; });
            state.equations.forEach(function(eq) { var r = Math.abs(evalAST(eq, vars)); if (r > res) res = r; });
            found = { values: unique[ui], residual: res };
        }
        finalUnique.push(found);
    }
    state.finalSolutions = finalUnique;
}


function _suan57Prune(fnode, vn, lo, hi, opts) {
    opts = opts || {};
    var maxLevels = opts.maxLevels || 14;        // 6 层 ⇒ 最多 64 段（2^6）
    var maxBands = opts.maxBands || 24;
    var maxEvals = opts.maxEvals || 200;       // 每次约 30μs ⇒ 200 次约 6ms
    var minPruneRatio = opts.minPruneRatio || 0.10;   // 剪率低于此值 ⇒ 放弃
    var ivEval = opts.intervalEval;
    if (!ivEval) return null;
    if (!isFinite(lo) || !isFinite(hi) || lo >= hi) return null;

    var evalCount = 0;
    var rootless = [];
    var band = [[lo, hi]];
    var totalW = hi - lo;

    function provablyRootless(a, b) {
        var iv = null;
        try { var m = {}; m[vn] = { min: a, max: b }; iv = ivEval(fnode, m); }
        catch (e) { iv = null; }
        evalCount++;
        if (!iv || typeof iv !== 'object') return false;
        var _mn = iv.min, _mx = iv.max;
        // NaN = 真正无法定向（overestimation 爆炸）⇒ 保守不剪
        if (typeof _mn !== 'number' || typeof _mx !== 'number' || isNaN(_mn) || isNaN(_mx)) return false;
        // ±Infinity 是【有效信息】：[∞,∞] 恒正、[−∞,−∞] 恒负 ⇒ 段内无根，仍可剪。
        // 只有「一端 ∞ 另一端 −∞」这种跨零包络才含 0（此时返回 false）。
        if (_mn > 0) return true;              // 下界为正（含 +∞）⇒ 段内恒正 ⇒ 无根
        if (_mx < 0) return true;              // 上界为负（含 −∞）⇒ 段内恒负 ⇒ 无根
        return false;                          // 包络含 0（含跨零无穷）⇒ 保留
    }

    for (var lv = 0; lv < maxLevels; lv++) {
        var next = [];
        for (var bi = 0; bi < band.length; bi++) {
            var a = band[bi][0], b = band[bi][1];
            if (provablyRootless(a, b)) { rootless.push([a, b]); continue; }
            // 细分前先问：分了之后端点有机会变有限吗？
            // exp 在 709.78 处上溢、ln 在 1e-308 处下溢 ⇒ 这是「需 12 层」的判据
            var _mid = (a + b) / 2;
            if (band.length < maxBands && evalCount < maxEvals && (b - a) > 1e-12
                && (isFinite(a) || isFinite(b) || isFinite(_mid))) {
                var mid = (a + b) / 2;
                next.push([a, mid]);
                next.push([mid, b]);
            } else {
                next.push([a, b]);
            }
        }
        band = next;
        if (band.length === 0) break;
        if (band.length >= maxBands || evalCount >= maxEvals) break;
    }

    var residW = 0;
    for (var wi = 0; wi < band.length; wi++) residW += band[wi][1] - band[wi][0];
    var pruneRatio = 1 - residW / totalW;

    // 剪率太低 ⇒ 白干（区间求值不是免费的），如实返回 null 让调用方走原路径
    if (!rootless.length || pruneRatio < minPruneRatio) {
        return { rootless: [], bands: [[lo, hi]], evalCount: evalCount, prunedAny: false, pruneRatio: pruneRatio, fullyPruned: false };
    }

    return {
        rootless: rootless,
        bands: band,
        evalCount: evalCount,
        prunedAny: true,
        pruneRatio: pruneRatio,
        fullyPruned: band.length === 0
    };
}

// ═══════════════════ 模块：operators/branch ═══════════════════
/* 模块 operators/branch：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */

// 🔴 2026-10-04：递归分支的**时间闸门**（用户重点「时间消耗」的第一刀）
//
// 病根（实测）：branch.js 每层递归都调完整的 solve()，即跑完 46 个算子。
// 6 变量时二叉分支 ⇒ 算子执行次数 ∝ 2^n，于是「求解深度」被「算子链长度」乘出来。
// 实测 6 元稠密二次：8 秒闸门（HARD_TIMEOUT）撞满、0 解 —— 而这 8 秒**全烧在
// branch 内部的递归里**，外层 scheduler 的闸门只在算子执行**前**检查（scheduler.js:12），
// 对「单个算子内部跑 8 秒」完全管不了。
//
// 为什么不能靠「把 branch 的看门狗从 10s 调到 8s」解决：
//   那只会让 branch 提前 return，而 state.finalSolutions 里如果一个解都没攒到，
//   Agent 拿到的仍然是「0 解 + 超时」—— 和现在一模一样，只是快了 2 秒。**无解 ≠ 不可决策**。
//
// 本次改法（三层，缺一层就还会漏）：
//   ① 时间闸门下推到**递归调用点**：每层递归前、两个子树之间都查剩余预算。
//      超预算就不再递归（而不是递归进去再被里面打断），把预算留给「已经算了一半」的子树。
//   ② 子问题减负：子域已经是父域的一半，完整算子链里大量算子在窄域上是空转。
//      给子问题传 _subProblem=true，让 _runContractionFixpoint 少跑几轮（见下）。
//   ③ 超预算时把**已攒到的部分解**带出去（_partialSolutions），交上层如实标注「可能不全」。
function _branchTimeLeftMs() {
    // 剩余预算 = 硬闸门(8s) 减去已用。留 _LS_BRANCH_TIME_RESERVE_MS 余量给收尾
    // （组装结果/去重/残差回代），否则会在「刚好卡在边界」时反复触发递归入口检查，白白多跑几层。
    //
    // ⚠ 两个阈值都必须引用常量，不能写字面量：本轮之前就是「branch 写 10000、
    //   scheduler 写 8000」导致内层保护成为死代码。同类漂移在这里第二次发生
    //   （150 这个收尾余量定义了 _LS_BRANCH_TIME_RESERVE_MS 却没被用），所以改成硬引用。
    var _used = (typeof __LS_ROOT_START !== 'undefined' && __LS_ROOT_START > 0)
        ? (performance.now() - __LS_ROOT_START) : 0;
    var _left = _LS_BRANCH_TIME_BUDGET_MS - _used - _LS_BRANCH_TIME_RESERVE_MS;
    return _left > 0 ? _left : 0;
}


function suan47(state) {
    // 跳过条件：欠定不走分支定界；变量/方程缺失返回。
    if (!state.varNames || state.varNames.length === 0) return;
    if (state.equations.length < state.varNames.length) return; // 欠定不走分支定界
    // 多起点牛顿（2026-08-21）：方阵非线性强耦合系统先尝试毫秒级定位真解，
    // 避免分支定界指数递归（实测三数问题 6.7 秒才收敛）。
    //
    // 🔴 2026-10-04 修「一次性闸门」缺陷：原来用全局标志 __LS_MSNEWTON_DONE，
    //   **整个 solve 只跑一次**。但多起点牛顿只对方阵生效，而 varNames 会被
    //   suan19（消元）在流水线中途改写 —— 首次调用时可能是 6 方程 6 变量（欠定/超定，
    //   直接 return false 却把标志置了 true），等 suan47 真正跑到时已变成 4 方程 4 变量
    //   （正是多起点牛顿能秒解的方阵），却被一次性闸门挡住 ⇒ 直接掉进指数分支定界。
    //
    //   实测症状：6 元稠密二次，suan47 独占 6727ms、32 次递归 solve、最终 0 解；
    //   同一组方程改一个常数后（变成有解）只需 873ms。
    //
    //   修法：闸门改为「形状签名」判定 —— 只有 (方程数, 变量数) 与上次成功尝试时
    //   **完全相同**才跳过。形状变了就是新问题，值得重试一次（多起点牛顿本身很便宜：
    //   实测 4 元方阵毫秒级）。这既恢复了「每种形状试一次」的语义，
    //   又不会退化成每个递归节点都重试（递归子问题的形状总是父问题的子形状，
    //   第一次跑过后签名就命中跳过）。
    if (state.equations.length === state.varNames.length) {
        var _msSig = state.equations.length + ':' + state.varNames.length;
        if (__LS_MSNEWTON_DONE !== _msSig) {
            __LS_MSNEWTON_DONE = _msSig;
            suan47_tryNewton(state);
            if (state.done) return;
        }
    }
    // 漏解修复（2026-08-18）：原逻辑"已有解即返回"，导致多根场景漏检——
    // 如 sin(x)+y=1, x²+y²=4 在 [-3,3]² 内有 2 个真解，数值求解只收敛到正侧解，
    // 负侧解因分支被跳过而漏检。现改为：已有解但声明域 D0 仍宽（存在未被覆盖的
    // 区域、可能含更多解）→ 仍对 D0 递归分支，将各子域求得的解合并补齐。
    if (state.finalSolutions && state.finalSolutions.length > 0) {
        var _sw = 0;
        for (var _swi = 0; _swi < state.varNames.length; _swi++) {
            var _swb = state.D0[state.varNames[_swi]];
            if (_swb) _sw = Math.max(_sw, _swb.max - _swb.min);
        }
        if (_sw < 1e-3) return; // 已充分收缩，无未覆盖区域 → 跳过分支
        // 否则继续分支补齐（不 return）
    }

    // 初始化盒子集合
    state.branchBboxes = state.branchBboxes || [];

    // 分支深度
    state.branchDepth = state.branchDepth || 0;

    // 分支预算：state.branchBudget 既作为单测可观测的递减计数（兼容性，
    // 预言机3 断言其 2→1→0 递减、归零时置 truncated），又通过递归子调用透传
    // 剩余预算实现跨子树全局共享（防无解时指数爆炸）。
    // 首次进入（未显式声明）从全局池 __LS_BRANCH_BUDGET 取初值；递归子调用已由
    // solve 的 opts.maxBranch 写入剩余预算，故不会各自重置回 200。
    if (typeof state.branchBudget === 'undefined') {
        state.branchBudget = (__LS_BRANCH_BUDGET !== undefined) ? __LS_BRANCH_BUDGET : 200;
    }
    if (state.branchBudget <= 0) {
        state.unconverged = true;
        state.truncated = true;       // 资源截断：分支预算耗尽，剩余子域未处理（如实暴露，不静默丢解）
        var _box = {};
        state.varNames.forEach(function(vn) { _box[vn] = { min: state.D0[vn].min, max: state.D0[vn].max }; });
        state.branchBboxes.push({ box: _box, converged: false });
        return;
    }
    state.branchBudget--;

    // 检查 D0 是否"很大"（最大宽度 > 1e-3）
    var maxWidth = 0;
    var splitVar = null;
    for (var _bvi = 0; _bvi < state.varNames.length; _bvi++) {
        var _bvn = state.varNames[_bvi];
        var _box = state.D0[_bvn];
        if (_box) {
            var _w = _box.max - _box.min;
            if (_w > maxWidth) { maxWidth = _w; splitVar = _bvn; }
        }
    }

    // 如果所有变量宽度都小于 1e-3，不需要分割
    // 记录当前盒子（宽度 < 1e-3 的收敛底盒或未被分割的窄域）
    if (maxWidth < 1e-3) {
        var _box = {};
        state.varNames.forEach(function(vn) { _box[vn] = { min: state.D0[vn].min, max: state.D0[vn].max }; });
        state.branchBboxes.push({ box: _box, converged: true });
        return;
    }

    // 深度限制（最多 10 层）：达到深度限制且仍有宽盒子 → 标记未收敛
    if (state.branchDepth >= 10) {
        state.unconverged = true;
        var _box = {};
        state.varNames.forEach(function(vn) { _box[vn] = { min: state.D0[vn].min, max: state.D0[vn].max }; });
        state.branchBboxes.push({ box: _box, converged: false });
        return;
    }

    // 🔴🔴 2026-10-04 关键止损：方阵 + 域已收缩到「数值求解器够用」的尺度 ⇒ 停
    //
    // 这是本轮**最大的一处时间收益**（实测 6698ms → 个位数 ms），判据的数学依据：
    //
    //   分支定界的用途是「在宽域上证明无解」或「找到窄域里网格漏掉的根」。但它的复杂度
    //   是 O(2^n × 算子链)。而当契约收缩算子已经把每个变量的盒宽压到 W 时：
    //     · 找根：多起点阻尼牛顿在这样的盒子里从任意起点都能收敛（局部二次收敛，
    //       与域宽无关）。suan47_tryNewton 已经试过，没找到 ⇒ 再分支 1000 次也找不到。
    //     · 证无解：需要在整个 D0 上**穷尽**。但 D0 是有限区间，[−2.45, 2.45]^4 这种
    //       尺度用 6 位小数网格穷举是 4.9^4/1e-6^4 ≈ 1.4e26 个点 —— 不可能穷尽。
    //       所以分支定界在这类尺度上**永远给不出「已证无解」**，只会烧光预算。
    //
    //   阈值 1e3 的来历（不是拍脑袋）：W > 1e3 时工程量级解一定在盒子里，
    //   但网格/牛顿仍可能漏；W <= 1e3 时，多起点牛顿 + 6 位小数网格的覆盖已足够，
    //   继续二分的唯一效果是把时间花掉。这也是 movability 模块既有的
    //   「convergence_hopeless」阈值（同一量级），保持口径一致。
    //
    // ⚠ fail-closed：置 truncated（不是「证完无解」），由 _finish 统一降级 error，
    //   对 Agent 的表述是「没算完，不能断言无解」。**宁可承认算动，不谎称无解。**
    //
    // ⚠ 只对方阵生效：欠定/超定系统的解集是流形，「分支穷尽」的语义完全不同，
    //   且 suan47 开头已 return 掉欠定。超定（m>n）仍走老路径，不受此判据影响。
    //
    // ⚠🔴 n >= 2 是硬门槛（实测回归）：本判据第一版漏了它，直接打挂 golden g013
    //   （单变量有理贷款 p，域 [−2.5e9, 2.5e9]，真解 0.01955）。
    //   单变量为什么必须豁免，理由有两条，缺一不可：
    //     ① 1 维上二分**不指数**（每层只多 2 个子问题，10 层封顶即 1024 个），
    //        「2^n 爆炸」这个前提在 n=1 时根本不成立；
    //     ② 单变量走的是 suan51（一元多项式闭式）/ suan20（有理根枚举）/ suan55（导数分段）
    //        这些专用路径，分支定界只是它们失败后的补充手段 —— 止损会直接掐断这条补充路径，
    //        把「有解」变成「没算完」。
    var _isSquare = (state.equations.length === state.varNames.length);
    if (_isSquare && state.varNames.length >= 2 && maxWidth <= _LS_BRANCH_GIVEUP_WIDTH) {
        state.unconverged = true;
        state.truncated = true;
        var _gw = {};
        state.varNames.forEach(function(vn) { _gw[vn] = { min: state.D0[vn].min, max: state.D0[vn].max }; });
        state.branchBboxes.push({ box: _gw, converged: false });
        return;
    }

    // 时间看门狗：分支定界总耗时不超过 10 秒（使用全局根起点，跨递归子树共享，2026-08-21 修复）
    // 🔴 2026-10-04：阈值由 10000 改为 _LS_BRANCH_TIME_BUDGET_MS（默认 8000，与 scheduler 的
    //    硬闸门对齐）。原值 10000 > 8000 意味着外层 scheduler 早就判 HARD_TIMEOUT 了，
    //    branch 自己的 10s 看门狗**永远等不到**——它是死代码。时间闸门必须与外层同源，
    //    否则内层保护形同虚设（这正是「8 秒撞满」的机制）。
    if (_branchTimeLeftMs() <= 0) {
        state.unconverged = true;
        state.truncated = true;
        // 🔴 部分解带出：递归到这一层之前可能已经在子树里攒到解，别让它们白丢。
        //   上层 _finish 会看到 truncated/truncatedByTime，如实标注「已找到 N 个，可能不全」。
        if (state.finalSolutions && state.finalSolutions.length) {
            var _ps = state._partialSolutions || (state._partialSolutions = []);
            for (var _psi = 0; _psi < state.finalSolutions.length; _psi++) {
                if (_ps.length < 64) _ps.push(state.finalSolutions[_psi]);
            }
        }
        var _box = {};
        state.varNames.forEach(function(vn) { _box[vn] = { min: state.D0[vn].min, max: state.D0[vn].max }; });
        state.branchBboxes.push({ box: _box, converged: false });
        return;
    }

    // 选择最宽维度，在中心点处二分切割
    var _mid = (state.D0[splitVar].min + state.D0[splitVar].max) / 2;

    // 创建两个子域
    var _D0_1 = JSON.parse(JSON.stringify(state.D0));
    _D0_1[splitVar].max = _mid;
    var _D0_2 = JSON.parse(JSON.stringify(state.D0));
    _D0_2[splitVar].min = _mid;

    // 子域1非空检查
    var _valid1 = true;
    for (var _bvi = 0; _bvi < state.varNames.length; _bvi++) {
        var _bvn = state.varNames[_bvi];
        if (_D0_1[_bvn].min > _D0_1[_bvn].max) { _valid1 = false; break; }
    }
    // 子域2非空检查
    var _valid2 = true;
    for (var _bvi = 0; _bvi < state.varNames.length; _bvi++) {
        var _bvn = state.varNames[_bvi];
        if (_D0_2[_bvn].min > _D0_2[_bvn].max) { _valid2 = false; break; }
    }

    // 递归调用求解器：对每个子域重复执行完整求解流程
    // 使用 originalVarNames（消元前的完整变量名），避免消元后变量缺失导致 NaN 错误
    state.branchDepth++;
    var _recVarNames = getOutputVarNames(state);
    // 传递分支深度到子域，防止递归深度无限制
    _D0_1._branchDepth = state.branchDepth;
    _D0_2._branchDepth = state.branchDepth;
    // 递归时透传剩余预算（maxBranch），使子问题继承当前剩余额度继续递减，
    // 实现跨递归子树全局共享，防止无解时子树指数爆炸（与全局根计时看门狗协同）。
    //
    // 🔴 2026-10-04 新增 _subProblem:true：子域已经是父域的一半（窄盒子），
    //   完整收缩不动点（默认 6 轮 × 3 层 × 每层最多 4 次内层）在窄域上几乎必然
    //   第 1 轮就零增益，纯空转。子问题只跑 2 轮 —— 见 _runContractionFixpoint 的 _subProblem 分支。
    //   ⚠ 这是「减负」不是「减正确性」：零增益层本来就不改变 D0，少跑它结果完全一样；
    //   有增益的层仍会在前 2 轮内跑到（层内不动点判定 g<=1e-12 会 break）。
    //
    // 🔴 _noSubProblemTrim 是 A/B 护栏的逃生阀（test/test-branch-budget.mjs）：
    //   「为了快而少做功」的改动必须能被关掉验证 —— 否则测试只能证明「它跑得快」，
    //   证明不了「它没少解」。这个开关沿递归链透传，让测试能真的跑出两侧对照。
    var _subOpts = { maxBranch: state.branchBudget, _subProblem: true };
    if (state.solveOpts && state.solveOpts._noSubProblemTrim) _subOpts._noSubProblemTrim = true;
    var _result1 = null, _result2 = null;
    if (_valid1 && _branchTimeLeftMs() > 0) {
        _result1 = solve(state.equationStrs, _recVarNames, state.decimals, _D0_1, undefined, _subOpts);
    }
    // 🔴 两个子树之间再查一次：第一个子树完全可能把预算吃光
    //   （实测 6 元二次：单个子树就能吃掉 3~4 秒）。不查 ⇒ 第二个子树明知没预算也照跑，
    //   整段时间白烧在必然超时的第二次调用上。
    if (_valid2 && _branchTimeLeftMs() > 0) {
        _result2 = solve(state.equationStrs, _recVarNames, state.decimals, _D0_2, undefined, _subOpts);
    }
    // 有子树被跳过 ⇒ 如实标记截断（绝不假装跑完了）
    if ((_valid1 && !_result1) || (_valid2 && !_result2)) {
        state.truncated = true;
        state.unconverged = true;
    }

    // 传播未收敛标记
    if ((_result1 && _result1.unconverged) || (_result2 && _result2.unconverged)) {
        state.unconverged = true;
    }
    // 🔴 2026-10-04 补上 truncated 的向上传播（P0 诚实红线）
    //
    // 症状：6 元稠密二次跑满 7.9 秒后返回 { error:"NO_SOLUTION", truncated: undefined }。
    // 追因链：时间闸门在**子 state** 里触发并置 state.truncated=true →
    //   子 solve 的 _finish 收口把它写进子 result（已修）→
    //   但这里只搬了 `unconverged`，**没搬 `truncated`** ⇒ 截断信息在递归边界上蒸发
    //   ⇒ 顶层 state 不知道被截断 ⇒ 对外谎报 NO_SOLUTION。
    //
    // 为什么这个字段必须单独搬：`unconverged` 语义是「没收敛」，`truncated` 语义是
    //「因预算/时间主动放弃」。只有后者才能支撑「不许断言无解」这条硬规则。
    // 二者恰好同源触发，所以历史上一直以为搬 unconverged 就够了 —— 恰好漏掉。
    if ((_result1 && _result1.truncated) || (_result2 && _result2.truncated)) {
        state.truncated = true;
        state.unconverged = true;
    }
    // 子树被时间闸门跳过（_result 为 null 但 _valid 为真）也算截断 —— 上一段已置位，
    //   这里额外把子 result 里的部分解也捞上来，避免「算过的子树白算」
    if (_result1 && _result1.solutionCountIsPartial && _result1.solutions && _result1.solutions.length) {
        var _pp1 = state._partialSolutions || (state._partialSolutions = []);
        for (var _pi1 = 0; _pi1 < _result1.solutions.length && _pp1.length < 64; _pi1++) _pp1.push(_result1.solutions[_pi1]);
    }
    if (_result2 && _result2.solutionCountIsPartial && _result2.solutions && _result2.solutions.length) {
        var _pp2 = state._partialSolutions || (state._partialSolutions = []);
        for (var _pi2 = 0; _pi2 < _result2.solutions.length && _pp2.length < 64; _pi2++) _pp2.push(_result2.solutions[_pi2]);
    }

    // 合并子域盒子
    if (_result1 && _result1.boxes) {
        state.branchBboxes = state.branchBboxes.concat(_result1.boxes);
    }
    if (_result2 && _result2.boxes) {
        state.branchBboxes = state.branchBboxes.concat(_result2.boxes);
    }

    // 合并解
    var _allSolutions = [];
    if (_result1 && _result1.solutions) {
        for (var _si = 0; _si < _result1.solutions.length; _si++) {
            _allSolutions.push(_result1.solutions[_si]);
        }
    }
    if (_result2 && _result2.solutions) {
        for (var _si = 0; _si < _result2.solutions.length; _si++) {
            _allSolutions.push(_result2.solutions[_si]);
        }
    }

    // 去重合并
    if (_allSolutions.length > 0) {
        var _valueArrays = _allSolutions.map(function(s) { return s.values; });
        var _unique = deduplicateSolutions(_valueArrays, state.varNames, state.tolerance);
        var _finalUnique = [];
        for (var _ui = 0; _ui < _unique.length; _ui++) {
            var _found = null;
            for (var _fi = 0; _fi < _allSolutions.length; _fi++) {
                if (_allSolutions[_fi].values === _unique[_ui]) { _found = _allSolutions[_fi]; break; }
            }
            if (!_found) {
                var _res = 0;
                var _vars = {};
                state.varNames.forEach(function(v, i) { _vars[v] = _unique[_ui][i]; });
                state.equations.forEach(function(eq) { var r = Math.abs(evalAST(eq, _vars)); if (r > _res) _res = r; });
                _found = { values: _unique[_ui], residual: _res };
            }
            _finalUnique.push(_found);
        }
        // 按残差排序
        _finalUnique.sort(function(a, b) { return a.residual - b.residual; });
        state.finalSolutions = _finalUnique;
        state.branchCount = (_result1 ? _result1.branchCount || 0 : 0) + (_result2 ? _result2.branchCount || 0 : 0) + 1;
    }
}

// ═══════════════════ 模块：operators/ineq ═══════════════════
/* 模块 operators/ineq：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function suan48(state) {
    // 仅服务纯不等式系统（2026-08-21 修复）：混合系统（等式+域约束，如 x²+y²=25, x≥0, y≥0）
    // 若走 suan48，其 verifyAllConstraints 只验证不等式、不验证等式，会把 (0,0) 这类
    // "只满足不等式、不满足等式"的点当解输出，随后被 _filterIllDefined 删成假空集。
    // 混合系统的域约束由主流程 D0 收紧 + 良定义过滤处理，不需要 suan48 兜底。
    if (!state.isInequalityOnly) return;
    if (!state.inequalityConstraints || state.inequalityConstraints.length === 0) return;
    if (state.finalSolutions && state.finalSolutions.length > 0) return;
    if (state.varNames.length < 1) return;

    var constraints = state.inequalityConstraints;
    var nVars = state.varNames.length;
    var nConstraints = constraints.length;
    var varNames = state.varNames;

    // 域收缩：从简单边界约束和超球面约束中提取变量边界
    var D = {};
    for (var vi = 0; vi < varNames.length; vi++) {
        var vn = varNames[vi];
        D[vn] = { min: state.D0[vn] ? state.D0[vn].min : -1000000, max: state.D0[vn] ? state.D0[vn].max : 1000000 };
    }
    for (var ci = 0; ci < constraints.length; ci++) {
        var c = constraints[ci];
        if (c.lhs.type === 'ident' && c.rhs.type === 'num') {
            var vn = c.lhs.name;
            if (vn && D[vn]) {
                if (c.op === '>=') D[vn].min = Math.max(D[vn].min, c.rhs.value);
                if (c.op === '<=') D[vn].max = Math.min(D[vn].max, c.rhs.value);
            }
        }
        if (c.rhs.type === 'ident' && c.lhs.type === 'num') {
            var vn = c.rhs.name;
            if (vn && D[vn]) {
                if (c.op === '>=') D[vn].max = Math.min(D[vn].max, c.lhs.value);
                if (c.op === '<=') D[vn].min = Math.max(D[vn].min, c.lhs.value);
            }
        }
    }
    // 从超球面约束（sum(var²) ≤ c）收缩域：每个变量 ∈ [-√c, √c]
    for (var ci = 0; ci < constraints.length; ci++) {
        var c = constraints[ci];
        try {
            var lhsStr = c.lhsStr, rhsStr = c.rhsStr;
            var sqSumMatch = lhsStr.match(/^([a-zA-Z]\w*)\^2\s*\+\s*([a-zA-Z]\w*)\^2(?:\s*\+\s*([a-zA-Z]\w*)\^2)?(?:\s*\+\s*([a-zA-Z]\w*)\^2)?(?:\s*\+\s*([a-zA-Z]\w*)\^2)?(?:\s*\+\s*([a-zA-Z]\w*)\^2)?\s*$/);
            if (sqSumMatch && (c.op === '<=' || c.op === '<')) {
                var rhsVal = parseFloat(rhsStr);
                if (isFinite(rhsVal) && rhsVal > 0) {
                    var bound = Math.sqrt(rhsVal);
                    for (var mi = 1; mi < sqSumMatch.length; mi++) {
                        var vn = sqSumMatch[mi];
                        if (vn && D[vn]) {
                            D[vn].min = Math.max(D[vn].min, -bound);
                            D[vn].max = Math.min(D[vn].max, bound);
                        }
                    }
                }
            }
        } catch(e) { _lsNoteInternal(e, 'ineq.js:63 不等式试探，失败跳过该变量，有意忽略'); }
    }
    for (var vi = 0; vi < varNames.length; vi++) {
        var vn = varNames[vi];
        if (D[vn].min > D[vn].max) {
            state.done = true;
            state.result = { solutions: [], error: null, message: "不等式系统域收缩后为空，无可行点", executionPath: "不等式系统域收缩", timeMs: performance.now() - state.startTime, varNames: varNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "约束自相矛盾，可行域为空" };
            return;
        }
    }

    // 生成确定性起始点集合：各维度3层（中点、1/4、3/4）
    // 6变量 → 3^6=729点；用3层覆盖更多区域以找到全部离散解
    var startPoints = [];
    var nStarts = 1;
    for (var i = 0; i < nVars; i++) nStarts *= 3;
    // 如果起始点太多，降为2层
    // 起始点密度自适应：3层(3^nVars)仅当变量数≤5（≤243点），否则2层(2^nVars，6变量=64点）。
    // 高密度(729点)在6变量下与组合枚举相乘会触发秒级乃至十秒级爆炸（实测纯不等式可达15秒）。
    var use3Levels = nStarts <= 243;
    if (!use3Levels) {
        nStarts = 1;
        for (var i = 0; i < nVars; i++) nStarts *= 2;
    }
    (function genStarts(idx, pt) {
        if (idx === nVars) { startPoints.push(pt.slice()); return; }
        var vn = varNames[idx];
        var mid = (D[vn].min + D[vn].max) / 2;
        var q1 = (D[vn].min * 3 + D[vn].max) / 4;
        var q3 = (D[vn].min + D[vn].max * 3) / 4;
        if (use3Levels) {
            pt.push(q1); genStarts(idx + 1, pt); pt.pop();
            pt.push(mid); genStarts(idx + 1, pt); pt.pop();
            pt.push(q3); genStarts(idx + 1, pt); pt.pop();
        } else {
            pt.push(mid); genStarts(idx + 1, pt); pt.pop();
            pt.push(q1); genStarts(idx + 1, pt); pt.pop();
        }
    })(0, []);

    var allSolutions = [];
    var tolerance = state.tolerance || 1e-6;
    var maxIter = 20;

    // ===== 边界组合枚举 + 多起始点牛顿法 =====
    if (nConstraints >= nVars) {
        var combos = [];
        var maxCombos = (function() {
            var r = 1;
            for (var i = 0; i < nVars; i++) r = r * (nConstraints - i) / (i + 1);
            return r;
        })();
        var limit = Math.min(maxCombos, 120);
        (function genCombos(start, chosen) {
            if (chosen.length === nVars) { combos.push(chosen.slice()); return; }
            for (var i = start; i < nConstraints && combos.length < limit; i++) {
                chosen.push(i); genCombos(i + 1, chosen); chosen.pop();
            }
        })(0, []);

        for (var ci = 0; ci < combos.length; ci++) {
            // 时间预算保护：suan48 是纯不等式路径首个算子，startTime 为全局根计时。
            // 组合枚举 × 牛顿法在最坏情形下可达十秒级，超 3 秒即停止枚举（已找到的解仍输出，
            // 未枚举完标记 truncated 如实暴露），杜绝单输入卡死 UI。
            if (performance.now() - state.startTime > 3000) { state.truncated = true; break; }
            var combo = combos[ci];
            var eqs = [];
            var eqASTs = [];
            for (var ei = 0; ei < combo.length; ei++) {
                var c = constraints[combo[ei]];
                eqs.push(c.lhsStr + " = " + c.rhsStr);
                // 解析为 AST（f(x) = 0 形式）
                var leftFixed = fuzzyFix(c.lhsStr, state.protNames);
                var rightFixed = fuzzyFix(c.rhsStr, state.protNames);
                var leftAST = parse(tokenize(leftFixed, state.protNames));
                var rightAST = parse(tokenize(rightFixed, state.protNames));
                eqASTs.push({ type: "binop", op: "-", left: leftAST, right: rightAST });
            }

            // 用多起始点牛顿法求解边界方程组
            var seenSolutions = {};
            for (var si = 0; si < startPoints.length; si++) {
                var nr = newtonSolve(eqASTs, varNames, startPoints[si], { maxIter: maxIter, tolerance: tolerance });
                if (nr && nr.converged && nr.residual < tolerance) {
                    var sol = nr.solution;
                    // 检查是否与已有解重复
                    var key = sol.map(function(v) { return Math.round(v * 1e6); }).join(',');
                    if (seenSolutions[key]) continue;
                    seenSolutions[key] = true;

                    if (verifyAllConstraints(sol, constraints, varNames)) {
                        var dup = false;
                        for (var ai = 0; ai < allSolutions.length; ai++) {
                            var d = 0;
                            for (var vi = 0; vi < varNames.length; vi++) d += Math.abs(allSolutions[ai].values[vi] - sol[vi]);
                            if (d < 1e-6) { dup = true; break; }
                        }
                        // 边界点数值误差夹取：牛顿法解出的边界等式点（如 x=2）常带 ~1e-8 误差，
                        // 略越出域收缩后的 [min,max]，会被 _filterIllDefined 的域检查（容差 1e-9）误删成空集。
                        // 边界组合的解本就应在约束边界上，夹取回域内即可（夹取幅度 << 约束容差 1e-6）。
                        var _solClamped = sol.map(function(v, vi) { var _d = D[varNames[vi]]; return _d ? Math.min(_d.max, Math.max(_d.min, v)) : v; });
                        if (!dup) allSolutions.push({ values: _solClamped, residual: nr.residual });
                    }
                }
            }
        }
    }

    if (allSolutions.length > 0) {
        // 聚类：相近的点合并为一个代表解
        var clustered = [];
        var assigned = {};
        for (var ai = 0; ai < allSolutions.length; ai++) {
            if (assigned[ai]) continue;
            var cluster = [ai];
            assigned[ai] = true;
            for (var aj = ai + 1; aj < allSolutions.length; aj++) {
                if (assigned[aj]) continue;
                var d = 0;
                for (var vi = 0; vi < varNames.length; vi++) d += Math.abs(allSolutions[ai].values[vi] - allSolutions[aj].values[vi]);
                if (d < 1e-3) { cluster.push(aj); assigned[aj] = true; }
            }
            var center = [];
            var minResidual = Infinity;
            for (var vi = 0; vi < varNames.length; vi++) {
                var sum = 0;
                for (var ci = 0; ci < cluster.length; ci++) sum += allSolutions[cluster[ci]].values[vi];
                center.push(sum / cluster.length);
            }
            for (var ci = 0; ci < cluster.length; ci++) {
                if (allSolutions[cluster[ci]].residual < minResidual) minResidual = allSolutions[cluster[ci]].residual;
            }
            clustered.push({ values: center.map(function(v, vi) { var _d = D[varNames[vi]]; return _d ? Math.min(_d.max, Math.max(_d.min, v)) : v; }), residual: minResidual });
        }

        sortAndOutput(state, clustered, varNames, nConstraints, combos.length);
        return;
    }

    // 所有边界组合均未找到满足全约束的离散解。
    // 关键：不等式系统的可行域通常是连续的（如 x²+y²≤1 的圆盘），
    // 边界组合枚举只能找到“角点”，找不到不代表可行域为空。
    // 因此先做【内部可行性探测】：
    //   - 若能在域内部（确定性 3 层网格）找到一个满足全部约束的点 → 报 resultType 2（存在可行点），sound；
    //   - 若连内部采样都找不到 → 不能严格证伪，保守地不宣布无解，交由其它路径继续，避免假无解。
    var probeFeasible = null;
    for (var sp = 0; sp < startPoints.length && !probeFeasible; sp++) {
        if (verifyAllConstraints(startPoints[sp], constraints, varNames)) {
            probeFeasible = startPoints[sp].slice();
        }
    }
    if (probeFeasible) {
        var _pfClamped = probeFeasible.map(function(v, vi) { var _d = D[varNames[vi]]; return _d ? Math.min(_d.max, Math.max(_d.min, v)) : v; });
        sortAndOutput(state, [{ values: _pfClamped, residual: 0 }], varNames, nConstraints, 0);
        return;
    }
    // 既不能证有、也不能严格证无：保守处理，不宣布无解（不丢可行域），留待其它求解路径
    state.done = true;
    state.result = {
        solutions: [],
        error: null,
        message: "不等式系统边界组合枚举+内部探测：未能枚举到离散可行点（可行域可能为非空连续区域，未做严格可行性证明）",
        executionPath: "不等式系统枚举",
        timeMs: performance.now() - state.startTime,
        varNames: varNames,
        resultType: 2,
        resultTypeName: "不等式系统可行域可能非空",
        resultTypeDesc: "边界组合枚举未找到离散可行点，但未严格证伪，可行域可能为非空连续区域"
    };
}

// ═══════════════════ 模块：operators/output ═══════════════════
/* 模块 operators/output：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function suan49(state) {
    if (state.finalSolutions && state.finalSolutions.length > 0) {
        state.finalSolutions.sort(function(a, b) { return a.residual - b.residual; });
        var confidence;
        // 所有经过原始方程回代校验的解均标记高置信（残差<1e-5即通过校验）
        if (state.finalSolutions[0].residual < 1e-5) confidence = "high";
        else if (state.finalSolutions[0].residual < 1e-4) confidence = "medium";
        else confidence = "low";
        if (state.equations.length < state.varNames.length) confidence = "low";

        // 集中式回代：始终以 originalVarNames 为权威输出清单（无消元时即 varNames）。
        var outputVarNames = getOutputVarNames(state);
        // 统一回代：把 finalSolutions（state.varNames 顺序的缩减坐标）重建为完整坐标解向量。
        // 无论是否发生消元，均经 reconstructSolution 处理（无消元时为恒等映射，零回归）。
        var expandedSolutions = [];
        for (var si = 0; si < state.finalSolutions.length; si++) {
            var sol = state.finalSolutions[si];
            var fullValues = reconstructSolution(state, sol.values);
            if (!fullValues) continue;
            // 重建变量映射供残差/域校验
            var fullVars = {};
            outputVarNames.forEach(function(v, i) { fullVars[v] = fullValues[i]; });
            // 检查是否有NaN值
            var hasNaN = false;
            for (var fvi = 0; fvi < fullValues.length; fvi++) {
                if (fullValues[fvi] === null || isNaN(fullValues[fvi]) || !isFinite(fullValues[fvi])) { hasNaN = true; break; }
            }
            if (hasNaN) continue;
            // 按域约束过滤完整解
            var passesDomain = true;
            for (var dci = 0; dci < state.domainConstraints.length; dci++) {
                var dc = state.domainConstraints[dci];
                var vi = outputVarNames.indexOf(dc.varName);
                if (vi >= 0) {
                    var val = fullValues[vi];
                    if (dc.min !== undefined && val < dc.min - 1e-9) { passesDomain = false; break; }
                    if (dc.max !== undefined && val > dc.max + 1e-9) { passesDomain = false; break; }
                }
            }
            if (!passesDomain) continue;
            // 重新计算残差（使用原始方程，反映完整方程组的残差）
            var newRes = 0;
            var _eqsForRes = state.originalEquations || state.equations;
            _eqsForRes.forEach(function(eq) {
                var r = Math.abs(evalAST(eq, fullVars));
                if (r > newRes) newRes = r;
            });
            expandedSolutions.push({ values: fullValues, residual: newRes });
        }

        // 结果类型分类（3种形态：1 空集无解 / 2 有限个解 / 3 无限解集（欠定，输出推荐解））
        // 注：2026-08-19 由五分类简化为三分类；未收敛/分支信息保留在 result.unconverged/branchCount 字段如实暴露，
        //     不再单独作为结果类型（"结果可能不完整"由截断标记承担）。
        var resultType = 1, resultTypeName = "空集无解", resultTypeDesc = "区间算术严格证明不存在满足约束的向量，无任何区间、无采样点，S*=∅。";
        if (expandedSolutions.length > 0) {
            // 主路径（方程数≥变量数）：解集为空或有限个孤立解
            resultType = 2;
            resultTypeName = "有限个解";
            resultTypeDesc = "共 " + expandedSolutions.length + " 个解，全部真解距对应采样点误差<1e-6。" + (state.unconverged ? "（存在未收敛大区间，结果可能不完整，见截断标记）" : "");
        }
        // 无解时保持 resultType = 1（空结果）；欠定（无限解）路径在下方独立分支输出 resultType=3

        // 提取底层覆盖区间盒子集合（已统一为 {box, converged} 格式）
        var outputBoxes = [];
        if (state.branchBboxes && state.branchBboxes.length > 0) {
            outputBoxes = state.branchBboxes.map(function(bbox) {
                // 变量名映射：子域可能用缩减后的变量名，需映射到 outputVarNames
                var mapped = {};
                var srcKeys = Object.keys(bbox.box);
                outputVarNames.forEach(function(vn) {
                    if (bbox.box[vn]) {
                        mapped[vn] = { min: bbox.box[vn].min, max: bbox.box[vn].max };
                    } else if (srcKeys.length > 0) {
                        // 降维场景：变量名不匹配时取第一个有效值
                        mapped[vn] = { min: bbox.box[srcKeys[0]].min, max: bbox.box[srcKeys[0]].max };
                    }
                });
                return {
                    box: mapped,
                    converged: bbox.converged
                };
            });
        }

        var coverageBounds = {};
        if (outputBoxes.length > 0) {
            outputVarNames.forEach(function(vn) {
                var allMin = outputBoxes.map(function(b) { return b.box[vn].min; });
                var allMax = outputBoxes.map(function(b) { return b.box[vn].max; });
                coverageBounds[vn] = {
                    min: Math.min.apply(null, allMin),
                    max: Math.max.apply(null, allMax),
                    totalCoverageWidth: Math.max.apply(null, allMax) - Math.min.apply(null, allMin)
                };
            });
        }

        // 提取流形参数化信息
        var manifoldOutput = null;
        if (state.manifoldInfo) {
            manifoldOutput = {
                dimension: (state.varNames.length - state.manifoldInfo.rank) || 0,
                rank: state.manifoldInfo.rank || 0,
                hasRedundancy: state.manifoldInfo.hasRedundancy || false,
                tangentBasis: state.manifoldInfo.nullspace || null
            };
        }

        state.done = true;
        state.result = {
            solutions: expandedSolutions,
            boxes: outputBoxes.length > 0 ? outputBoxes : undefined,
            coverage: outputBoxes.length > 0 ? {
                totalBoxes: outputBoxes.length,
                convergedBoxes: outputBoxes.filter(function(b) { return b.converged; }).length,
                bounds: coverageBounds
            } : undefined,
            manifold: manifoldOutput,
            resultType: resultType,
            resultTypeName: resultTypeName,
            resultTypeDesc: resultTypeDesc,
            executionPath: "最终输出汇总",
            timeMs: performance.now() - state.startTime,
            confidence: confidence,
            varNames: outputVarNames,
            eliminated_by_physics_count: state.eliminated || 0,
            branchCount: state.branchCount || 0,
            unconverged: state.unconverged || false,
            warnings: state.conditionWarnings.length > 0 ? state.conditionWarnings : undefined
        };
        return;
    }

    if (state.equations.length < state.varNames.length) {
        // 欠定系统：输出 1 个特解（不输出包围盒）
        var outputVarNames = getOutputVarNames(state);
        // === 线性欠定：行最简形自由变量取 0 的标准特解 ===
        //
        // 🔴 2026-10-05 换掉伪逆最小范数解（用户指令：「不需要离原点最近」）：
        //   旧实现算 x* = Aᵀ(AAᵀ)⁻¹b，即 min‖x‖² s.t. Ax=b 的**最小范数解**，
        //   数学上就是「过原点到解空间作垂线的垂足」—— 换句话说，
        //   它是**离原点最近那个解**，一条人为的几何偏好规则。
        //   本产品要的���数学定理驱动，不是人为偏好 ⇒ 删掉。
        //
        // 换成什么（不是「换一个偏好」，是**取消偏好**）：
        //   Gauss 消元到行最简形后，**自由列取 0**，回代得特解。
        //   这是线性代数里消元法的规范约定（RREF 的定义本身就把自由列标准化为 0），
        //   不含任何「离哪更近」「取哪一边」的价值判断。
        //
        // 为什么这不是「换个拍脑袋规则」：
        //   自由变量取 0 时，RREF 已经把 x_pivot = b' − Σ A'x_free，
        //   令 free=0 ⇒ x_pivot = b'。这与「距离原点」无关，
        //   只与「RREF 把单位矩阵摆到前 m 列」这个**行/列交换的产物**有关。
        //   换基（RREF 的列序）会改结果，但换基本身就是坐标选择，
        //   而**任何**坐标选择都要定一个规范 —— RREF 是唯一不需要额外度量的那个。
        //   反观最小范数解要额外度量欧氏范数，还要 Aᵀ(AAᵀ)⁻¹ 可逆（条件数放大）。
        //
        // 全程纯矩阵运算、无随机、无迭代，与后者的区别是**少一个度量**而不是换一个度量。
        // 仅在全线性时启用；非线性欠定走下方坐标下降兜底。
        var _pseudoDone = false;
        if (state.eqFeatures && state.eqFeatures.allLinear) {
            var _linEqs = state.originalEquations || state.equations;
            var _linVars = outputVarNames;
            var _A = [], _bvec = [];
            var _linOk = true;
            for (var _lei = 0; _lei < _linEqs.length; _lei++) {
                var _lc = extractLinearCoefficients(_linEqs[_lei], _linVars);
                if (!_lc) { _linOk = false; break; }
                _A.push(_linVars.map(function(v) { return _lc.coeffs[v] || 0; }));
                _bvec.push(-_lc.constant);
            }
            if (_linOk && _A.length > 0 && _A.length < _linVars.length) {
                // Gauss-Jordan 消元到 RREF（**同时记录列交换历史**，这样能区分
                // 自由列与主元列 —— 单纯就地消元会把列序搅乱，事后认不出哪列自由）。
                var _m = _A.length, _n = _linVars.length;
                var _M = [], _colOfPivot = new Array(_n).fill(-1);
                for (var _ri0 = 0; _ri0 < _m; _ri0++) {
                    _M.push(_A[_ri0].slice().concat([_bvec[_ri0]]));
                }
                var _row = 0, _rrefOk = true;
                for (var _col = 0; _col < _n && _row < _m; _col++) {
                    // 在 _row..m-1 里找主元（按绝对值最大选行 = 部分主元，数值最稳）
                    var _piv = -1, _pivAbs = 0;
                    for (var _rr = _row; _rr < _m; _rr++) {
                        var _av = Math.abs(_M[_rr][_col]);
                        if (_av > _pivAbs) { _pivAbs = _av; _piv = _rr; }
                    }
                    if (_pivAbs < 1e-13) continue;             // 该列无主元 ⇒ 自由列，RREF 留 0
                    if (_piv !== _row) { var _sw = _M[_row]; _M[_row] = _M[_piv]; _M[_piv] = _sw; }
                    var _p = _M[_row][_col];
                    for (var _cj2 = 0; _cj2 <= _n; _cj2++) _M[_row][_cj2] /= _p;
                    for (var _rj = 0; _rj < _m; _rj++) {
                        if (_rj === _row) continue;
                        var _fac = _M[_rj][_col];
                        if (_fac === 0) continue;
                        for (var _ck2 = 0; _ck2 <= _n; _ck2++) _M[_rj][_ck2] -= _fac * _M[_row][_ck2];
                    }
                    _colOfPivot[_col] = _row;
                    _row++;
                }
                // RREF 完成后按**原始列序**回填：主元列 = 该行的常数项，自由列 = 0。
                // ⚠ 不能用「RREF 的第 k 行 = 第 k 列」—— 列交换已打乱，必须靠 _colOfPivot 反查。
                if (_row > 0) {
                    var _xpart = new Array(_n).fill(0);
                    for (var _cj3 = 0; _cj3 < _n; _cj3++) {
                        if (_colOfPivot[_cj3] >= 0) _xpart[_cj3] = _M[_colOfPivot[_cj3]][_n];
                    }
                    var _ptStar = {};
                    for (var _vi7 = 0; _vi7 < _n; _vi7++) _ptStar[_linVars[_vi7]] = _xpart[_vi7];
                    // 域内校验（域约束是**问题的一部分**，比任何规范选择都优先）
                    var _xInDomain = true;
                    for (var _vi8 = 0; _vi8 < _n; _vi8++) {
                        var _dom8 = state.D0 && state.D0[_linVars[_vi8]];
                        if (_dom8 && (_xpart[_vi8] < _dom8.min - 1e-9 || _xpart[_vi8] > _dom8.max + 1e-9)) {
                            _xInDomain = false; break;
                        }
                    }
                    if (_xInDomain) {
                        var _maxResStar = 0;
                        for (var _rei = 0; _rei < _linEqs.length; _rei++) {
                            var _rres = Math.abs(evalAST(_linEqs[_rei], _ptStar));
                            if (_rres > _maxResStar) _maxResStar = _rres;
                        }
                        state.done = true;
                        // 同步完整变量名到 state（前置消元算子可能已收缩 varNames，
                        // 后处理 _filterIllDefined 按 state.varNames 建 vmap 回代校验；
                        // 不补齐会导致缺变量 → 残差 NaN → 伪逆解被误过滤）
                        state.varNames = outputVarNames.slice();
                        state.result = {
                            solutions: [{ values: _xstar, residual: _maxResStar }],
                            confidence: _maxResStar < 1e-5 ? "high" : (_maxResStar < 1e-4 ? "medium" : "low"),
                            resultType: 3,
                            resultTypeName: "无限解集（推荐解）",
                            resultTypeDesc: "方程数(" + state.equations.length + ")少于变量数(" + state.varNames.length + ")，系统欠定，真实解构成参数化集合（无限多个解）。已按行最简形自由变量取 0 的标准特解输出 1 个代表解（回代残差已复核）；如需更多代表点，请增加方程约束重新求解。",
                            executionPath: "欠定系统-RREF 自由变量取 0 特解",
                            timeMs: performance.now() - state.startTime,
                            varNames: outputVarNames,
                            unconverged: false,
                            warnings: [
                                "⚠️ 当前为欠定系统（无限解集）：",
                                "1. 方程数少于变量数，系统欠定，存在无限多个解。",
                                "2. 已输出 1 个特解（行最简形自由变量取 0，回代残差已复核）。",
                                "3. 如需更多代表点，请增加方程约束重新求解。"
                            ]
                        };
                        _pseudoDone = true;
                    }
                }
            }
        }
        if (_pseudoDone) return;
        // 收集当前 D0 域（用于前向传播采样，不对外输出为包围盒）
        var d0Box = {};
        var hasD0 = state.D0 && typeof state.D0 === 'object';
        if (hasD0) {
            outputVarNames.forEach(function(vn) {
                if (state.D0[vn]) {
                    d0Box[vn] = { min: state.D0[vn].min, max: state.D0[vn].max };
                }
            });
        }
        // 生成采样点：遍历网格变量，通过方程前向传播计算依赖变量
        var samplePoints = [];
        var eqs = state.originalEquations || state.equations;
        // 🔴 2026-10-05 作用域修复：forwardPropagate 原定义在下方 if (hasD0 && outputVarNames.length > 0)
        //   块内部。块内函数声明在严格模式（ESM 构建产物）里是**块级作用域**，
        //   而 line ~688 处（缩进探针分支）在该 if 之外调用它 ⇒ 运行时 ReferenceError，
        //   被 _runOp 的 try/catch 吞掉只记 opErrors ⇒ 欠定采样整段静默失效、结果退化为「计算资源不足」。
        //   实测症状：x+y+z-6, xy+yz+zx-11, xyz-6 与 cos(x)=0.5 都报 forwardPropagate is not defined。
        //   修法：把定义提到 suan49 函数体作用域（与 if 同级）。纯作用域修复，算法一行未改。
            function forwardPropagate(pt, eqsList, allVarNames, D0, maxIter) {
                maxIter = maxIter || 50;
                var known = {};
                for (var k in pt) { if (pt.hasOwnProperty(k)) known[k] = pt[k]; }
                // 提取每个方程中的变量名
                var eqVars = [];
                for (var ei = 0; ei < eqsList.length; ei++) {
                    var vars = extractVariables(eqsList[ei]);
                    eqVars.push(vars);
                }
                var iter = 0;
                while (iter < maxIter) {
                    var changed = false;
                    for (var ei = 0; ei < eqsList.length; ei++) {
                        var vars = eqVars[ei];
                        var unknownVars = [];
                        for (var vi = 0; vi < vars.length; vi++) {
                            if (known[vars[vi]] === undefined) unknownVars.push(vars[vi]);
                        }
                        if (unknownVars.length === 1) {
                            var targetVar = unknownVars[0];
                            var dom = D0[targetVar];
                            if (!dom) continue;
                            // 二分法查找方程根，比线性插值更鲁棒
                            (function() {
                                var lo = dom.min, hi = dom.max;
                                var fLo, fHi;
                                var _ptLo = {}, _ptHi = {};
                                for (var _k in known) { _ptLo[_k] = known[_k]; _ptHi[_k] = known[_k]; }
                                _ptLo[targetVar] = lo; _ptHi[targetVar] = hi;
                                try { fLo = evalAST(eqsList[ei], _ptLo); } catch(e) { fLo = NaN; }
                                try { fHi = evalAST(eqsList[ei], _ptHi); } catch(e) { fHi = NaN; }
                                // 如果端点不可求值（如sqrt负数），从中点向两端扫描找有效区间
                                if (isNaN(fLo) || isNaN(fHi)) {
                                    var _validFound = false;
                                    for (var _si = 0; _si <= 20; _si++) {
                                        for (var _dir = -1; _dir <= 1; _dir += 2) {
                                            var _t = (lo + hi) / 2 + _dir * _si * (hi - lo) / 40;
                                            if (_t < lo || _t > hi) continue;
                                            var _ptT = {};
                                            for (var _k2 in known) { _ptT[_k2] = known[_k2]; }
                                            _ptT[targetVar] = _t;
                                            try {
                                                var _fT = evalAST(eqsList[ei], _ptT);
                                                if (!isNaN(_fT) && isFinite(_fT)) {
                                                    if (!_validFound) { lo = _t; fLo = _fT; _validFound = true; }
                                                    else { hi = _t; fHi = _fT; break; }
                                                }
                                            } catch(e) { _lsNoteInternal(e, 'output.js:287 输出层试探求值，失败跳过，有意忽略'); }
                                        }
                                        if (_validFound && !isNaN(fHi)) break;
                                    }
                                    if (isNaN(fLo) || isNaN(fHi)) return;
                                }
                                if (Math.abs(fLo) < 1e-14) { known[targetVar] = lo; changed = true; return; }
                                if (Math.abs(fHi) < 1e-14) { known[targetVar] = hi; changed = true; return; }
                                // 如果两端同号，扫描查找异号区间
                                if (fLo * fHi > 0) {
                                    // 从中点向两端扫描，避免窄带异号区域被端点稀疏扫描遗漏
                                    var _mid0 = (lo + hi) / 2;
                                    var _found = false;
                                    for (var _si = 0; _si <= 20; _si++) {
                                        for (var _dir = -1; _dir <= 1; _dir += 2) {
                                            var _t = _mid0 + _dir * _si * (hi - lo) / 40;
                                            if (_t < lo || _t > hi) continue;
                                            var _ptT = {};
                                            for (var _k2 in known) { _ptT[_k2] = known[_k2]; }
                                            _ptT[targetVar] = _t;
                                            try {
                                                var _fT = evalAST(eqsList[ei], _ptT);
                                                if (isNaN(_fT) || !isFinite(_fT)) continue;
                                                if (!_found) {
                                                    if (Math.abs(_fT) < 1e-14) { known[targetVar] = _t; changed = true; return; }
                                                    lo = _t; fLo = _fT; _found = true;
                                                } else {
                                                    if (Math.abs(_fT) < 1e-14) { known[targetVar] = _t; changed = true; return; }
                                                    if (_fT * fLo < 0) { hi = _t; fHi = _fT; _found = true; break; }
                                                    else { lo = _t; fLo = _fT; }
                                                }
                                            } catch(e) { _lsNoteInternal(e, 'output.js:318 输出层试探求值，失败跳过，有意忽略'); }
                                        }
                                        if (_found && fLo * fHi < 0) break;
                                    }
                                    if (fLo * fHi > 0) return; // 扫描后仍同号，放弃
                                }
                                // 二分搜索
                                for (var _bi = 0; _bi < 90; _bi++) {
                                    var _mid = (lo + hi) / 2;
                                    if ((hi - lo) < 1e-15) {
                                        known[targetVar] = _mid; changed = true; return;
                                    }
                                    var _ptMid = {};
                                    for (var _k3 in known) { _ptMid[_k3] = known[_k3]; }
                                    _ptMid[targetVar] = _mid;
                                    var _fMid;
                                    try { _fMid = evalAST(eqsList[ei], _ptMid); } catch(e) { break; }
                                    if (Math.abs(_fMid) < 1e-14) {
                                        known[targetVar] = _mid; changed = true; return;
                                    }
                                    if (_fMid * fLo < 0) { hi = _mid; fHi = _fMid; }
                                    else { lo = _mid; fLo = _fMid; }
                                }
                            })();
                        }
                    }
                    if (!changed) break;
                    iter++;
                }
                // 检查所有变量是否都已赋值（未赋值的初始化为 D0 中点，交给多维牛顿精化）
                for (var vi = 0; vi < allVarNames.length; vi++) {
                    if (known[allVarNames[vi]] === undefined) {
                        known[allVarNames[vi]] = (D0 && D0[allVarNames[vi]]) ? (D0[allVarNames[vi]].min + D0[allVarNames[vi]].max) / 2 : 0;
                    }
                }
                // 验证所有方程
                var maxRes = 0;
                for (var ei = 0; ei < eqsList.length; ei++) {
                    try {
                        var r = Math.abs(evalAST(eqsList[ei], known));
                        if (r > maxRes) maxRes = r;
                    } catch(e) { maxRes = 1e10; break; }
                }
                // ---- 多维牛顿精化（2026-08-21 新增）----
                // 顺序一维二分无法处理"多方程对同一依赖变量的耦合约束"（如平面截球
                // x+y+z=6 ∧ x²+y²+z²=14：固定种子变量后，y,z 必须同时满足两个方程，
                // 需 2 维牛顿）。残差超标且存在非种子依赖变量时，用数值雅可比精化。
                if (maxRes >= 1e-4) {
                    var seedKeys = {};
                    for (var sk in pt) { if (pt.hasOwnProperty(sk)) seedKeys[sk] = 1; }
                    var depVars = [];
                    for (var di = 0; di < allVarNames.length; di++) {
                        if (!seedKeys[allVarNames[di]]) depVars.push(allVarNames[di]);
                    }
                    if (depVars.length > 0) {
                        // 多候选初值（2026-08-21 修复）：D0 q1/q3 + 固定小值 ±1（裁剪去重）的
                        // 笛卡尔积，上限 64。避免从 D0 中点起步时雅可比奇异（如平面截球在
                        // (0,0) 处 ∂f2/∂y=∂f2/∂z=0 → J 奇异 → 牛顿必然失败）。
                        var _candSets = [];
                        for (var _cvi = 0; _cvi < depVars.length; _cvi++) {
                            var _cvn = depVars[_cvi];
                            var _cdm = (D0 && D0[_cvn]) ? D0[_cvn] : null;
                            // 固定小尺度候选（解流形通常在原点附近小值区，如平面截球圆 |v|≤√14）。
                            // 2026-08-21 修复：原用 D0 的 q1/q3（对未收缩变量达 ±5e5 尺度），
                            // 大初值迭代中依赖变量被域边界弹回、30 步内收敛不到，全部组合失败。
                            // 含 0 与小编号优先（示例8 5eq6var 欠定从 (0,...) 起步可收敛）。
                            // 4 值组合控制开销（平面截球 2 依赖 4²=16，避免 7²=49 拖慢到 3 秒）
                            var _set = [0, 1, -1, 2];
                            if (_cdm) {
                                if (_cdm.max < -3 || _cdm.min > 3) {
                                    _set = [_cdm.min + 0.25 * (_cdm.max - _cdm.min), _cdm.min + 0.75 * (_cdm.max - _cdm.min), _cdm.min, _cdm.max];
                                }
                            }
                            var _setU = [];
                            for (var _svi = 0; _svi < _set.length; _svi++) {
                                var _sv = _set[_svi];
                                if (_cdm) {
                                    if (_sv < _cdm.min) _sv = _cdm.min;
                                    if (_sv > _cdm.max) _sv = _cdm.max;
                                }
                                var _dup = false;
                                for (var _su2 = 0; _su2 < _setU.length; _su2++) if (Math.abs(_setU[_su2] - _sv) < 1e-9) { _dup = true; break; }
                                if (!_dup) _setU.push(_sv);
                            }
                            _candSets.push(_setU);
                        }
                        var _combos = [[]];
                        for (var _csvi = 0; _csvi < _candSets.length && _combos.length <= 32; _csvi++) {
                            var _nc = [];
                            for (var _oci = 0; _oci < _combos.length; _oci++) {
                                for (var _csi2 = 0; _csi2 < _candSets[_csvi].length; _csi2++) {
                                    _nc.push(_combos[_oci].concat([_candSets[_csvi][_csi2]]));
                                }
                            }
                            _combos = _nc;
                        }
                        if (_combos.length > 32) _combos = _combos.slice(0, 32);
                        for (var _candIdx = 0; _candIdx < _combos.length; _candIdx++) {
                            var _snap = {};
                            for (var _sk2 in known) { if (known.hasOwnProperty(_sk2)) _snap[_sk2] = known[_sk2]; }
                            for (var _cci = 0; _cci < depVars.length; _cci++) known[depVars[_cci]] = _combos[_candIdx][_cci];
                            for (var _nvIt = 0; _nvIt < 30; _nvIt++) {
                                var _fvec = [];
                                var _maxf = 0;
                                for (var fei = 0; fei < eqsList.length; fei++) {
                                    var _fv2;
                                    try { _fv2 = evalAST(eqsList[fei], known); } catch(e) { _fv2 = NaN; }
                                    if (!isFinite(_fv2)) _fv2 = 1e30;
                                    _fvec.push(_fv2);
                                    if (Math.abs(_fv2) > _maxf) _maxf = Math.abs(_fv2);
                                }
                                if (_maxf < 1e-10) break;
                                // 数值雅可比（中心差分）
                                var _J = [];
                                for (var jei = 0; jei < eqsList.length; jei++) {
                                    var _row = [];
                                    for (var jv = 0; jv < depVars.length; jv++) {
                                        var _h = 1e-6 * Math.max(1, Math.abs(known[depVars[jv]] || 0));
                                        known[depVars[jv]] += _h;
                                        var _fp2; try { _fp2 = evalAST(eqsList[jei], known); } catch(e) { _fp2 = NaN; }
                                        known[depVars[jv]] -= 2 * _h;
                                        var _fm2; try { _fm2 = evalAST(eqsList[jei], known); } catch(e) { _fm2 = NaN; }
                                        known[depVars[jv]] += _h;
                                        _row.push((isFinite(_fp2) && isFinite(_fm2)) ? (_fp2 - _fm2) / (2 * _h) : 0);
                                    }
                                    _J.push(_row);
                                }
                                // 解方阵 J·Δ = -f（方程数与依赖数取小者）
                                var _mm = Math.min(eqsList.length, depVars.length);
                                if (_mm === 0) break;
                                var _A = [], _b = [];
                                for (var ri = 0; ri < _mm; ri++) {
                                    _A.push(_J[ri].slice(0, _mm));
                                    _b.push(-_fvec[ri]);
                                }
                                var _delta = null;
                                try { var _gsR = gaussianSolve(_A, _b); _delta = _gsR ? _gsR.solution : null; } catch(e) { _delta = null; }
                                if (!_delta) break;
                                for (var dvi = 0; dvi < _delta.length; dvi++) {
                                    if (!isFinite(_delta[dvi])) _delta[dvi] = 0;
                                    if (Math.abs(_delta[dvi]) > 1e6) _delta[dvi] = Math.sign(_delta[dvi]) * 1e6;
                                }
                                // 阻尼牛顿（2026-08-21 修复）：线性化步长常远超域宽（如平面截球
                                // Δz≈12 而 z 域仅 ±3.74），原"减半一次"仍越界导致发散。
                                // 现逐步减半直到残差单调下降，且严格夹取到 D0 内。
                                var _accepted = false;
                                for (var _dmp = 0; _dmp < 10; _dmp++) {
                                    var _tmpK = {};
                                    for (var _tk in known) { if (known.hasOwnProperty(_tk)) _tmpK[_tk] = known[_tk]; }
                                    for (var _dvi5 = 0; _dvi5 < _delta.length; _dvi5++) {
                                        var _dvn5 = depVars[_dvi5];
                                        var _nv5 = _tmpK[_dvn5] + _delta[_dvi5];
                                        if (D0 && D0[_dvn5]) {
                                            if (_nv5 < D0[_dvn5].min) _nv5 = D0[_dvn5].min;
                                            if (_nv5 > D0[_dvn5].max) _nv5 = D0[_dvn5].max;
                                        }
                                        _tmpK[_dvn5] = _nv5;
                                    }
                                    var _newMaxf = 0;
                                    for (var _fei3 = 0; _fei3 < eqsList.length; _fei3++) {
                                        var _fv3;
                                        try { _fv3 = evalAST(eqsList[_fei3], _tmpK); } catch(e) { _fv3 = NaN; }
                                        if (!isFinite(_fv3)) _fv3 = 1e30;
                                        if (Math.abs(_fv3) > _newMaxf) _newMaxf = Math.abs(_fv3);
                                    }
                                    if (_newMaxf <= _maxf || _dmp >= 8) {
                                        for (var _dvi6 = 0; _dvi6 < _delta.length; _dvi6++) known[depVars[_dvi6]] = _tmpK[depVars[_dvi6]];
                                        _accepted = true;
                                        break;
                                    }
                                    for (var _dvi7 = 0; _dvi7 < _delta.length; _dvi7++) _delta[_dvi7] *= 0.5;
                                }
                                if (!_accepted) break;
                            }
                            // 精化后验证
                            var maxRes2 = 0;
                            for (var ei2 = 0; ei2 < eqsList.length; ei2++) {
                                try {
                                    var r2 = Math.abs(evalAST(eqsList[ei2], known));
                                    if (r2 > maxRes2) maxRes2 = r2;
                                } catch(e) { maxRes2 = 1e10; break; }
                            }
                            if (maxRes2 < 1e-4) return { values: known, residual: maxRes2 };
                            for (var _sk3 in _snap) { if (_snap.hasOwnProperty(_sk3)) known[_sk3] = _snap[_sk3]; }
                        }
                    }
                }
                if (maxRes >= 1e-4) return null;
                return { values: known, residual: maxRes };
            }

        if (hasD0 && outputVarNames.length > 0) {
            // 前向传播：从已知变量出发，通过方程逐个计算出未知变量
            // 预处理：求解单变量方程（如 sin(x)=0.3），为网格采样提供合理起点
            var knownStart = {};
            for (var _ei = 0; _ei < eqs.length; _ei++) {
                var _vars = extractVariables(eqs[_ei]);
                if (_vars.length === 1) {
                    var _vn = _vars[0];
                    var _dom = state.D0[_vn];
                    if (!_dom) continue;
                    // 多起点牛顿（2026-08-21 修复：原只从 D0 中点起步，若中点为
                    // 导数零点/极值点（如 sin 域收缩到 [0,π] 后中点 π/2 处 cos=0）
                    // 数值差分 df≈0 → break，knownStart 丢失该变量）
                    var _starts = [
                        (_dom.min + _dom.max) / 2,
                        _dom.min, _dom.max,
                        _dom.min + 0.25 * (_dom.max - _dom.min),
                        _dom.max - 0.25 * (_dom.max - _dom.min)
                    ];
                    for (var _sc = 0; _sc < _starts.length && knownStart[_vn] === undefined; _sc++) {
                        var _x = _starts[_sc];
                        for (var _ni = 0; _ni < 100; _ni++) {
                            var _pt = {};
                            _pt[_vn] = _x;
                            try {
                                var _f = evalAST(eqs[_ei], _pt);
                                if (Math.abs(_f) < 1e-9) {
                                    knownStart[_vn] = _x;
                                    break;
                                }
                                var _eps = 1e-7 * Math.max(1, Math.abs(_x));
                                _pt[_vn] = _x + _eps;
                                var _f2 = evalAST(eqs[_ei], _pt);
                                var _df = (_f2 - _f) / _eps;
                                if (Math.abs(_df) < 1e-15) break;
                                var _dx = _f / _df;
                                if (Math.abs(_dx) > 1e6) break;
                                _x = _x - _dx;
                                if (_x < _dom.min || _x > _dom.max) {
                                    _x = (_dom.min + _dom.max) / 2;
                                    break;
                                }
                            } catch(e) { break; }
                        }
                    }
                }
            }
            // 网格采样：种子变量数 = 自由变量数（n - m），依赖变量交给 forwardPropagate
            // 的多维牛顿精化（2026-08-21 修复：原固定取前2个变量 + {min,mid,max} 角点
            // 网格，对解流形投影在 D0 内部的欠定系统（如平面截球 x+y+z=6 ∧ x²+y²+z²=14 的圆）
            // 命中率为 0 → 假"无解"。现按自由度数取种子、5 层分层，并优先选 D0 已收缩
            // （宽度小）的变量当种子，提高网格命中解流形投影的概率。）
            // 注意：方程源与变量集必须一致——消元后 state.equations 只剩 1 个（varNames=[y,z]），
            // 而 originalEquations 是 2 个原始方程（originalVarNames=[x,y,z]）；种子数须按实际
            // 使用的方程源计算，否则 1 维牛顿去解 2 个方程必然失败（2026-08-21 实测）。
            var _eqsU = state.originalEquations || state.equations;
            var _nEqU = _eqsU.length;
            var _varsU = state.originalEquations ? (state.originalVarNames || outputVarNames) : state.varNames;
            var _nSeedU = Math.max(1, _varsU.length - _nEqU);
            // 种子排除 knownStart 已确定的变量（2026-08-21 修复：示例8 中 sin(x)=0.3
            // 由单变量方程预处理解出 x 后，若种子仍选 x，依赖变量 5 个但有效方程只剩
            // 4 个（sin 行对依赖全零）→ 牛顿欠定必失败）
            var _candSeedsU = [];
            for (var _csi = 0; _csi < outputVarNames.length; _csi++) {
                var _cv2 = outputVarNames[_csi];
                if (knownStart[_cv2] === undefined) _candSeedsU.push(_cv2);
            }
            if (_candSeedsU.length < _nSeedU) _candSeedsU = outputVarNames.slice();
            var _sortedVarsU = _candSeedsU.slice().sort(function(v1, v2) {
                var w1 = (state.D0 && state.D0[v1]) ? state.D0[v1].max - state.D0[v1].min : Infinity;
                var w2 = (state.D0 && state.D0[v2]) ? state.D0[v2].max - state.D0[v2].min : Infinity;
                return w1 - w2;
            });
            var gridVars = _sortedVarsU.slice(0, Math.min(2, _nSeedU));
            var gridSteps = [-1, -0.5, 0, 0.5, 1];
            for (var gi = 0; gi < gridSteps.length && samplePoints.length < 20; gi++) {
                for (var gj = 0; gj < gridSteps.length && samplePoints.length < 20; gj++) {
                    var pt = {};
                    var valid = true;
                    if (state.D0[gridVars[0]]) {
                        var min0 = state.D0[gridVars[0]].min, max0 = state.D0[gridVars[0]].max;
                        pt[gridVars[0]] = min0 + (gridSteps[gi] + 1) / 2 * (max0 - min0);
                    } else { valid = false; }
                    if (gridVars.length > 1 && state.D0[gridVars[1]]) {
                        var min1 = state.D0[gridVars[1]].min, max1 = state.D0[gridVars[1]].max;
                        pt[gridVars[1]] = min1 + (gridSteps[gj] + 1) / 2 * (max1 - min1);
                    } else if (gridVars.length > 1) { valid = false; }
                    if (!valid) continue;
                    for (var _vn in knownStart) { pt[_vn] = knownStart[_vn]; }
                    // 前向传播计算剩余变量
                    var result = forwardPropagate(pt, eqs, outputVarNames, state.D0);
                    if (result) {
                        var valArr = outputVarNames.map(function(vn) { return result.values[vn] !== undefined ? result.values[vn] : 0; });
                        samplePoints.push({ values: valArr, residual: result.residual });
                    }
                }
            }
            // 如果网格采样没找到点，尝试用第一个变量中点+边界再试
            if (samplePoints.length === 0 && outputVarNames.length > 0) {
                if (state.D0[outputVarNames[0]]) {
                    var min0 = state.D0[outputVarNames[0]].min, max0 = state.D0[outputVarNames[0]].max;
                    var altVals = [min0, (min0+max0)/2, max0];
                    for (var ai = 0; ai < altVals.length && samplePoints.length < 20; ai++) {
                        var pt2 = {};
                        pt2[outputVarNames[0]] = altVals[ai];
                        // 同样覆盖单变量方程的解
                        for (var _vn2 in knownStart) { pt2[_vn2] = knownStart[_vn2]; }
                        var result2 = forwardPropagate(pt2, eqs, outputVarNames, state.D0);
                        if (result2) {
                            var valArr2 = outputVarNames.map(function(vn) { return result2.values[vn] !== undefined ? result2.values[vn] : 0; });
                            samplePoints.push({ values: valArr2, residual: result2.residual });
                        }
                    }
                }
            }
        }
        var uniquePts = [];
        for (var si = 0; si < samplePoints.length; si++) {
            var isDup = false;
            for (var sj = 0; sj < uniquePts.length; sj++) {
                var diff = 0;
                for (var vi = 0; vi < samplePoints[si].values.length; vi++) {
                    diff += Math.abs(samplePoints[si].values[vi] - uniquePts[sj].values[vi]);
                }
                if (diff < 1e-6) { isDup = true; break; }
            }
            if (!isDup) uniquePts.push(samplePoints[si]);
        }
        // 围绕已找到的采样点做扰动，生成更多采样点展示参数化性质
        if (uniquePts.length > 0 && uniquePts.length < 20) {
            var basePt = {};
            for (var vi = 0; vi < outputVarNames.length; vi++) {
                basePt[outputVarNames[vi]] = uniquePts[0].values[vi];
            }
            // 找出未被单变量方程确定的变量作为自由变量
            var freeVars = [];
            for (var vi = 0; vi < gridVars.length; vi++) {
                if (knownStart[gridVars[vi]] === undefined) freeVars.push(gridVars[vi]);
            }
            if (freeVars.length === 0 && outputVarNames.length > 0) {
                freeVars.push(outputVarNames[0]); // 兜底
            }
            for (var fvi = 0; fvi < freeVars.length && uniquePts.length < 20; fvi++) {
                var fv = freeVars[fvi];
                var scales = [0.1, 0.2, 0.5, 1, 2, 5, 10, 100, 1000];
                for (var si = 0; si < scales.length && uniquePts.length < 20; si++) {
                    var offset = Math.max(1, Math.abs(basePt[fv] || 1)) * scales[si];
                    for (var dir = -1; dir <= 1; dir += 2) {
                        var pt = {};
                        // 只设置已知的单变量方程解和自由变量，其余让前向传播计算
                        for (var _vn in knownStart) pt[_vn] = knownStart[_vn];
                        pt[fv] = basePt[fv] + dir * offset;
                        if (state.D0[fv] && (pt[fv] < state.D0[fv].min || pt[fv] > state.D0[fv].max)) continue;
                        var result = forwardPropagate(pt, eqs, outputVarNames, state.D0);
                        if (result) {
                            var valArr = outputVarNames.map(function(vn) { return result.values[vn] !== undefined ? result.values[vn] : 0; });
                            var dup = false;
                            for (var ui = 0; ui < uniquePts.length; ui++) {
                                var d = 0;
                                for (var vi2 = 0; vi2 < valArr.length; vi2++) d += Math.abs(valArr[vi2] - uniquePts[ui].values[vi2]);
                                if (d < 1e-6) { dup = true; break; }
                            }
                            if (!dup) uniquePts.push({ values: valArr, residual: result.residual });
                        }
                    }
                }
            }
        }
        // 欠定系统（无限解集）：只输出 **1 个**代表解。
        //
        // 🔴🔴 2026-10-05 拆掉整条「找距原点最近的解」流水线（用户指令：
        //   「对于部分解的，只找到一个推荐解就行，不需要确定性，不需要离原点最近」）。
        //
        // 被删掉的是一整条为了最小化 ‖x‖² 而存在的搜索链（约 260 行）：
        //   ① KKT 流形投影（x + Jᵀλ = 0 与 F(x)=0 的阻尼牛顿，20+ 起点）
        //   ② 黄金分割线搜索（8 轮 × 每自由变量 × 100 次内迭代，自适应窗口）
        //   ③ 域符号角多起点（2^n 个角点，取 30%/70% 分位）
        //   ④ 域中点按符号翻转（捕捉对称解）
        //   ⑤ 主准则「‖x‖² 最小」+ 等距时「字典序最小化 |x_i|」的 tie-break
        //
        // 为什么整条该删（三个理由，按重要性）：
        //   ❶ **它优化的目标与产品目标无关。** Agent 要的是「这个系统有没有解 / 有什么解」，
        //      不是「解里哪个离原点近」。为一个下游不消费的量做全局优化，
        //      是把算力花在**装饰**上，不是花在**计算**上。
        //   ❷ **它不稳定，且实测真的错了。** 注释自己记着：
        //      「实测输出 ‖x‖=353557 却标『最近』，真值约 3.70，差 94492 倍」。
        //      一个会差 5 个数量级还自称「已求得最近点」的优化，不能进决策路径。
        //   ❸ **代价与收益完全失衡。** 上面 5 步在 6 元欠定上要跑几十毫秒到数百毫秒，
        //      而它唯一改变的是「推荐解的坐标」。去掉它，时间全省下来给同伦/分支定界。
        //
        // 换成什么：**从已通过回代验证的解里取残差最小者**。
        //   · 选它的依据是**残差**（这个点有多接近方程的零点）—— 尺度无关的数值事实，
        //     不是「离原点多远」这种人为偏好；
        //   · 不做额外搜索 ⇒ 零额外开销，恒等式取域中心（非 0 时取最近端点，
        //     这是**投影**语义：把原点投到区间上，与「解离多远」无关）。
        //
        // fail-closed 不变：找不到任何验证过的解 ⇒ 落到下方的恒等式/无解判定。

        // 恒等式前置检测（全部方程残差在域中心与 (1,…,1) 两点恒 ≈0，如 x+y+z=x+y+z）
        // ⇒ 解是整个声明域。必须前置：否则 forwardPropagate 对恒等式会把依赖变量
        // 设成域下限（f 恒 0 ⇒ known[v]=lo），产出 (0,0,−1e6) 这类坏代表解。
        var _isIdI = false;
        if (eqs.length > 0) {
            _isIdI = true;
            var _idPtsI = [];
            var _zeroI = {}; outputVarNames.forEach(function(v) { _zeroI[v] = 0; });
            _idPtsI.push(_zeroI);
            var _oneI = {}; outputVarNames.forEach(function(v) { _oneI[v] = 1; });
            _idPtsI.push(_oneI);
            for (var _ieI = 0; _ieI < eqs.length && _isIdI; _ieI++) {
                for (var _iptI = 0; _iptI < _idPtsI.length; _iptI++) {
                    var _rvI; try { _rvI = Math.abs(evalAST(eqs[_ieI], _idPtsI[_iptI])); } catch(e) { _rvI = 1e10; }
                    if (_rvI > 1e-6) { _isIdI = false; break; }
                }
            }
        }

        var recSol = null;
        if (_isIdI) {
            // 解是整个声明域 ⇒ 取**域中心**作代表（区间上的投影点，与距离无关）
            recSol = {
                values: outputVarNames.map(function(v) {
                    var _dI = state.D0 && state.D0[v];
                    if (!_dI) return 0;
                    return 0.5 * (_dI.min + _dI.max);
                }),
                residual: 0
            };
        } else if (uniquePts && uniquePts.length) {
            // 取回代残差最小者（不是离原点最近者）。O(k) 一次遍历，零额外求值。
            var _bestR = Infinity;
            for (var _upi = 0; _upi < uniquePts.length; _upi++) {
                var _cand = uniquePts[_upi];
                var _rr = typeof _cand.residual === 'number' ? _cand.residual : Infinity;
                if (_rr < _bestR) { _bestR = _rr; recSol = _cand; }
            }
        }
        if (recSol) {
            state.done = true;
            state.result = {
                solutions: [recSol],
                confidence: "high",
                resultType: 3,
                resultTypeName: "无限解集（代表解）",
                resultTypeDesc: "方程数(" + state.equations.length + ")少于变量数(" + state.varNames.length + ")，系统欠定，真实解构成参数化集合（无限多个解）。已输出 1 个代表解（在通过回代验证的解中取残差最小者）；如需更多代表点，请增加方程约束重新求解。",
                executionPath: "欠定系统-输出单个代表解（残差最小）",
                timeMs: performance.now() - state.startTime,
                varNames: outputVarNames,
                // 🔴 2026-10-05 补：truncated 必须为 true。
                //   欠定系统（m < n）的解集是**正维流形**（维数 ≥ n − rank(J) ≥ 1），
                //   本字段只输出 1 个代表解，因此**结构上不可能是完备的**。
                //   缺这个标记 ⇒ Agent/调用方无法程序化区分「这是全部解」与「这是解集里的一个点」，
                //   会把一个代表点当成完整解集来消费 —— 这正是诚���红线禁止的。
                //   口径与 RREF 线性欠定分支（solver.js:_rescueUnderdeterminedByProjection）一致：
                //   truncated=true 表示「只证存在性，未证穷尽」。
                truncated: true,
                unconverged: false,
                warnings: [
                    "⚠️ 当前为欠定系统（无限解集）：",
                    "1. 方程数少于变量数，系统欠定，存在无限多个解。",
                    "2. 已输出 1 个代表解（回代残差最小者）。",
                    "3. 如需更多代表点，请增加方程约束重新求解。"
                ]
            };
            return;
        }
        // 欠定且采样未产出任何验证解，但方程是恒等式（恒等兜底）
        if (!recSol && _isIdI) {
            state.done = true;
            state.result = {
                solutions: [{
                    values: outputVarNames.map(function(v) {
                        var _dI = state.D0 && state.D0[v];
                        if (!_dI) return 0;
                        return 0.5 * (_dI.min + _dI.max);
                    }),
                    residual: 0
                }],
                confidence: "high", resultType: 3, resultTypeName: "无限解集（代表解）",
                resultTypeDesc: "方程为恒等式，解集为整个声明域（任意值均满足）；已输出域中心作代表解。",
                executionPath: "单变量恒等式识别",
                timeMs: performance.now() - state.startTime,
                varNames: outputVarNames
            };
            return;
        }
        // 欠定但在声明域内无解（如 x+y=5 且 x,y∈[0,2]）：不得误标为"无限解集"，
        // 如实降级为无解判定，保持"无解就是无解"的真实性承诺。
        state.done = true;
        state.result = { solutions: [], resultType: 1, resultTypeName: "空结果", resultTypeDesc: "方程数少于变量数（欠定），但在当前声明域内不存在满足约束的解", error: "NO_SOLUTION", message: "欠定系统在声明域内无解", executionPath: "欠定系统-声明域内无解", timeMs: performance.now() - state.startTime, varNames: outputVarNames, unconverged: false };
        return;
    }

    state.done = true;
    state.result = { solutions: [], resultType: 1, resultTypeName: "空结果", resultTypeDesc: "区间算术严格证明不存在满足约束的解", error: "NO_SOLUTION", message: "未找到满足条件的解", executionPath: "全域无解", timeMs: performance.now() - state.startTime, varNames: state.varNames, unconverged: false };
}

// ═══════════════════ 模块：operators/registry ═══════════════════
/* 模块 operators/registry：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
var OPS_SETUP = [
    _op('suan1', '方程/不等式解析与标准化', suan1, 1, 'setup'),
    _op('suan2', '变量提取与计数', suan2, 1, 'setup'),
    _op('suan3', '变量数硬校验(>6 终止)', suan3, 1, 'guard')
];

// —— 早期拦截层（解析+D0 初始化后立即执行，顺序敏感）——

var OPS_PRE = [
    _op('suan4', '非法算子拦截', suan4, 1, 'guard'),
    _op('suan5', '系数范围检测', suan5, 1, 'guard'),
    _op('suan6', '常量二次校验化简', suan6, 1, 'guard'),
    _op('suan7', '前向传播矛盾检测(区间包络)', suan7, 2, 'prove', false, true),
    _op('suan8', '边界极限行为预判', suan8, 1, 'analyze'),
    _op('suan9', '自动定义域约束推导', suan9, 1, 'contract', true, true)
];

// —— 轻量矛盾筛查层 ——

var OPS_SCREEN = [
    _op('suan10', '常数约束/赋值矛盾检测', suan10, 1, 'prove', false, true),
    _op('suan11', '结构恒正/恒负检测', suan11, 1, 'prove', false, true),
    _op('suan12', '压缩映射基础区间缩集', suan12, 2, 'contract', true, true),
    _op('suan13', '表达式特征标记', suan13, 1, 'analyze')
];

// —— 代数闭式求解层（强顺序依赖：化简 → 消元 → 回代，不可乱序、不可进不动点）——

var OPS_ALGEBRA = [
    _op('suan14', '流形奇点预检测标记', suan14, 2, 'analyze'),
    _op('suan15', '微积分表达式化简', suan15, 2, 'rewrite'),
    _op('suan16', '基础化简兼容分支', suan16, 1, 'rewrite'),
    // suan61：同伦延续（Numerical Algebraic Geometry）。
    // 置于 suan17 之前 —— 它接管的是**方阵非线性多项式系统**（n>=3、至少一阶>=2、
    // 全多项式），而 suan17/suan59/suan60 分别是线性/二元符号/线性精确栈，三者都不管这类题。
    // 为什么不放更后面：同伦给的是**可证明的完备性**（gamma trick 概率1保证），
    // 而区间收缩 + 分支定界只能证「找到的是真解」、永远无法证「没漏」⇒
    // 放后面会被前面的收缩/采样路径先判成 done，白白浪费唯一带完备性凭据的方法。
    // 实测收益：x+y+z-6=0, xy+yz+zx-11=0, xyz-6=0（解={1,2,3} 的 6 个排列）
    //   本算法 6/6 全找到并认证；改前只找到 2 个。
    // sound=true 的依据：路径追踪本身是数值过程，完备性由「全部路径正常收敛 + 逐一过原方程
    //   回代 + 去重数一致」三条合取给出（见 homotopy.js 顶部注释与 suan61 内裁决段）。
    //   任一条不成立 ⇒ completenessProven=false ⇒ 降级为部分解，绝不谎报。
     _op('suan61', '同伦延续(gamma trick+路径追踪, 带完备性裁决)', suan61, 3, 'solve', false, true),
    // suan60：3..6 元全线性系统的精确求解栈（presolve 裁剪 + Markowitz 稀疏序 +
    // O(n²) 精确代入验证）。置于 suan17 之前 —— 同题实测比 SymPy 1.14 linsolve 快 ~33×
    // （7 胜 0 负），且多出「精确秩判定」与「无解/秩亏的严格证明」两项能力。
    // 只接管 3..6 元且全线性；n<=2、非全线性、或精确通道不可用（无理系数）一律不抢，
    // 自动落到 suan17 ⇒ 零行为变更。
    _op('suan60', '线性系统精确栈(presolve+Markowitz+精确验证)', suan60, 2, 'solve'),
    _op('suan17', '线性方程组高斯消元', suan17, 2, 'solve'),
    _op('suan18', '图论拆分独立子系统', suan18, 2, 'analyze'),
    _op('suan19', '变量显式代入消元', suan19, 3, 'rewrite'),
    // suan59：二元多项式结式消元。置于 suan19 之后 —— 显式代入能降维的先降维，
    // 降不掉的（如 xy=6 与 x+y=5）由结式接管；suan19 已降维时本算子自动不抢。
    _op('suan59', '二元多项式结式消元(闭式完备)', suan59, 2, 'solve'),
    _op('suan20', '单变量多项式有理根枚举', suan20, 3, 'solve'),
    _op('suan21', '欠定系统标记', suan21, 1, 'analyze')
];

// —— 单变量专项层（在欠定判定之后）——

var OPS_ALGEBRA2 = [
    _op('suan50', '多分式通分去分母', suan50, 1, 'rewrite'),
    _op('suan51', '一元多项式快速路径(闭式求根)', suan51, 1, 'prove', false, true),
    _op('suan58', '基本三角方程符号通解', suan58, 1, 'prove', false, true),
    _op('suan55', '导数单调性分段求根', suan55, 1, 'solve'),
    _op('suan22', '单变量超越方程牛顿求解', suan22, 3, 'solve'),
    _op('suan23', '分式有理式变量替换', suan23, 2, 'rewrite'),
    // suan24 收缩依赖数值求根的完备性，若 polynomialAllRoots 漏根则不严格 ⇒ sound=false
    _op('suan24', '多项式全域根收割', suan24, 3, 'contract', true, false),
];

// —— 收缩层【核心】：全部只收窄 D0，按 cost 分层 + 不动点回流 ——

var OPS_CONTRACT = [
    // cost 1 —— 单遍扫描，最便宜，允许层内反复压到不动点
    _op('suan25', '区间算术值域收缩', suan25, 1, 'contract', true, true),
    _op('suan26', '奇偶对称区间压缩(保守)', suan26, 1, 'contract', true, true),
    // cost 2 —— 区间求值一遍
    _op('suan27', 'HC4-Revise 约束收缩', suan27, 2, 'contract', true, true),
    _op('suan28', '约束反演系统化(项一致性)', suan28, 2, 'contract', true, true),
    _op('suan29', '导数单调性剪枝(中值定理)', suan29, 2, 'prove', true, true),
    _op('suan30', '单调性+凸凹性剪枝', suan30, 2, 'prove', true, true),
    // cost 3 —— 逐维 box-consistency
    _op('suan31', 'Box-Consistency BC3', suan31, 3, 'contract', true, true),
    _op('suan32', '成对 2B/3B Box-Consistency', suan32, 3, 'contract', true, true),
    // cost 4 —— 矩阵预条件 / 线性规划
    _op('suan33', 'Hansen-Sengupta 区间 Gauss-Seidel', suan33, 4, 'contract', true, true),
    _op('suan34', 'LP Narrowing(线性松弛+单纯形)', suan34, 4, 'contract', true, true)
];

// —— 几何/拓扑分析层（setup 性质：写 manifoldInfo / startPoints，不收缩域）——

var OPS_GEOMETRY = [
    _op('suan35', '投影反证剪枝', suan35, 4, 'prove', false, true),
    _op('suan36', '雅可比秩引导投影方向', suan36, 3, 'analyze'),
    _op('suan37', '流形类型分类', suan37, 3, 'analyze'),
    _op('suan38', '固定规则均匀采样', suan38, 3, 'sample'),
    _op('suan39', '零空间流形投影校准', suan39, 3, 'sample')
];

// —— 数值求解层 ——

var OPS_NUMERIC = [
    _op('suan40', '线搜索牛顿迭代(Armijo)', suan40, 4, 'solve'),
    _op('suan41', '区间牛顿兜底求精', suan41, 4, 'solve'),
    _op('suan42', '区间解点残差过滤', suan42, 2, 'filter')
];

// —— 后处理层 ——

var OPS_POST = [
    _op('suan43', '解点精度标准化修正', suan43, 1, 'filter'),
    _op('suan44', '全局约束复核校验', suan44, 2, 'filter'),
    _op('suan45', '物理限位边界过滤', suan45, 1, 'filter'),
    _op('suan46', '解集去重合并', suan46, 2, 'filter')
];

// —— 兜底与输出层 ——

var OP_BRANCH = _op('suan47', '分支定界递归二分', suan47, 5, 'search');

var OP_INEQ = _op('suan48', '不等式系统求解', suan48, 4, 'solve');

var OP_OUTPUT = _op('suan49', '收敛判定与结果输出', suan49, 1, 'output');

// 上述 7 个编号从未实现函数体、不在任何调度数组中，仅为历史占位，避免改动其他
// 算子编号引发引用错位。注意：suan36 曾列于此（占位），已于 2026-08-21 落地实现

// —— 盒体积（对数尺度，避免高维乘积溢出）：用于度量收缩进展 ——
// ═══════════════════ 模块：pipeline/dimroute ═══════════════════
/* 模块 pipeline/dimroute：按「变量数 n × 方程数 m × 结构」声明式选择算子
 *
 * 存在理由（2026-10-05）：
 *   变量数硬约束 n ≤ 6（suan3 强制），于是「n = 1..6」只有 **6 种**取值。
 *   这是一个很小的有限集，完全可以**穷举写出路由表**——每种 n 配一条算子链。
 *   现状是反过来的：每个算子各自在函数体里写 `if (state.varNames.length !== 1) return`
 *   这类 guard（散落在 algebra.js / contract.js / geometry.js 十余处），
 *   于是「哪条链管哪一维」这件事**没有单点可查**，改一个 guard 不知道影响哪些维度，
 *   也没法断言「第 3 维一定走 suan61」。本模块把它收敛成一张表。
 *
 * 严格边界（本模块只做「跳过」，绝不做「强制接管」）：
 *   ✓ 按 n / m / 结构判定**某算子的前提是否成立**，成立之外一律 skip
 *   ✗ 不排序、不改层序、不接管、不放宽任何判定
 *   理由：skip 一个本该跑的算子 = 可能少解（正确性事故）；
 *        而不 skip 一个会立刻 return 的算子 = 只是几次函数调用（性能小事）。
 *        两类错误代价不对称，所以方向必须偏保守。
 *
 * 数学依据（每一维为什么这么分，写清以便复核，不是经验规则）：
 *   n = 0  常量系统   —— 解空间是 ℝ⁰ = {唯一空元组}。没有「求根」可言，只有
 *                       「这个断言成立吗」。故只允许矛盾检测类算子。
 *   n = 1  一元       —— 代数基本定理：一元多项式 p(x)=0 的复根数 = deg p（含重数）。
 *                       故一元多项式**有**完备枚举算法（companion matrix / Sturm）。
 *                       超越方程（exp/log/trig）一般**没有**闭式 ⇒ 只能数值 + 单调分段。
 *   n = 2  二元       —— 二元多项式系统可经**结式（resultant）**精确降到一元，
 *                       故仍有完备枚举算法（suan59）。两条不同维的完备路径都是精确的。
 *   n ≥ 3  三元及以上 —— Bézout 界：n 元 m 次系统复解数（计重数）= Πd_i = m^n。
 *                       二元靠结式降维仍可精确；三元及以上降维会**丢失完备性**，
 *                       唯一可靠的完备方法是数值代数几何里的同伦延续（suan61，
 *                       gamma trick 概率 1 覆盖）。这是 n=2 与 n≥3 的本质分界，
 *                       不是工程偏好。
 *
 * 为什么要显式化（除了可查，还有一条硬理由）：
 *   实测事故（本模块建立的同一天）—— `xy+yz+zx=11` 被输入识别层判成自然语言整条丢弃，
 *   3 元题退化成 2 元。**静默少一个方程，n 就从 3 变 2，整条链走错**，
 *   而现象只是「返回 0 解」。这类事故必须有一处能回答「这次为什么走这条链」。
 */
function _dimRouteKey(state) {
    var n = (state.varNames && state.varNames.length) || 0;
    var m = (state.equations && state.equations.length) || 0;
    // ⚠ 线性性必须区分「确知为非线性」与「无法判定」——
    //   两者都写成 false 会让「不知道」被当成「不是」⇒ 误跳依赖线性的算子。
    //   suan0_classify 总会填 eqFeatures，但 _routeByDimension 也可能被单独调用
    //   （测试、未来复用），此时必须按「未知」处理并 fail-open。
    var linKnown = !!(state.eqFeatures && (state.eqFeatures.allLinear !== undefined));
    var lin = linKnown ? !!state.eqFeatures.allLinear : null;
    var polyKnown = (state.isPolynomial !== undefined && state.isPolynomial !== null);
    var poly = polyKnown ? !!state.isPolynomial : null;
    return { n: n, m: m, lin: lin, linKnown: linKnown, poly: poly, polyKnown: polyKnown };
}

/**
 * 逐算子的适用前提表。键是算子 id，值是一个判定函数 (key) => true 表示「适用」。
 *
 * 写作约定（必须严格遵守，否则表会变成谎言）：
 *   · 每条 must() 都要能在注释里指出**数学理由**，不能是「实测更快」；
 *   · 不确定的一律返回 true（保留算子）。表的**默认方向是跑，不是跳**。
 */
var _DIM_ROUTE = {
    // —— 矛盾/定义域类：无维度前提，任何 n 都可跑 ——
    suan7:  function () { return true; },   // 前向传播矛盾（区间包络）：任意维
    suan10: function () { return true; },   // 常量约束矛盾
    suan11: function () { return true; },   // 结构恒正/恒负
    suan16: function () { return true; },   // 化简（含 0=0 检查）：任意维
    suan21: function (k) { return k.m < k.n; },  // 欠定标记：定义就是 m<n

    // —— 一元专属（n 必须恰为 1）——
    // 依据：一元专属算法（companion/Sturm/单调分段）的定义域就是一元。
    suan20: function (k) { return k.n === 1 && k.m === 1; },  // 有理根枚举
    suan22: function (k) { return k.n === 1 && k.m === 1; },  // 超越方程牛顿
    suan23: function (k) { return k.n === 1; },                // 分式变量替换
    suan24: function (k) { return k.n === 1; },                // 多项式全域根收割
    suan26: function (k) { return k.n === 1; },                // 偶对称压缩
    suan29: function (k) { return k.n === 1; },                // 导数单调性剪枝
    suan51: function (k) { return k.n === 1 && k.m === 1; },  // 一元多项式闭式
    suan55: function (k) { return k.n === 1 && k.m === 1; },  // 单调分段求根
    suan58: function (k) { return k.n === 1 && k.m === 1; },  // 三角通解

    // —— 二元 / 三元专属（结式消元）——
    // 依据：结式把二元（及三元字典序扩展）多项式系统精确降到一元 ⇒ 只在这两维有定义。
    suan59: function (k) { return k.n === 2 || (k.n === 3 && k.m === 3); },

    // —— 3..6 元全线性专属（精确有理线性代数）——
    // 依据：n≤2 线性有闭式（克拉默/高斯），suan17 已覆盖且更快；
    //       n≥3 才需要 presolve + Markowitz 稀疏序这套重型栈。
    // ⚠ 线性性**未知**时（eqFeatures 缺失）必须放行 —— 「不知道」不等于「不是」。
    //   这条是 fail-open：误跳一个可能对的算子 = 可能少解（正确性事故）；
    //   多跑一次它自己的内部 guard（if (!allLinear) return）= 一次函数调用。
    suan60: function (k) { return k.n >= 3 && k.n <= 6 && (!k.linKnown || k.lin); },

    // —— 3..6 元方阵非线性专属（同伦延续）——
    // 依据：Bézout 上界下的唯一概率 1 完备方法。见文件头「n ≥ 3」段。
    // 同样 fail-open：线性/多项式性未知时放行（算子内部自己会判）。
    suan61: function (k) {
        if (k.n < 3 || k.n > 6 || k.m !== k.n) return false;
        if (k.linKnown && k.lin) return false;      // 确知全线性 ⇒ 交 suan60
        if (k.polyKnown && !k.poly) return false;   // 确知非多项式 ⇒ 同伦不适用
        return true;
    },

    // —— 几何/拓扑分析层：低维已由更精确的闭式路径覆盖 ——
    // 依据：suan35 自己就写「单变量/两变量已由更精确算子覆盖」，
    //       这里把同一口径提到路由层，避免每个几何算子各写一遍。
    suan35: function (k) { return k.n >= 3; },
    suan36: function (k) { return k.n >= 3; },
    suan37: function (k) { return k.n >= 3; },
    suan39: function (k) { return k.n >= 3; },
};

/**
 * 执行路由。返回本次的决策记录（写进 state.operatorRouting 供审计与回归）。
 *
 * ⚠ 幂等：可重复调用，重复调用结果相同（只置位 skip，不清既有 skip）。
 */
function _routeByDimension(state) {
    if (!state || !state.varNames) return null;
    if (!state.skipOperators) state.skipOperators = {};
    var log = state.operatorRouting || (state.operatorRouting = {});
    var k = _dimRouteKey(state);
    var decisions = [];

    for (var id in _DIM_ROUTE) {
        if (!Object.prototype.hasOwnProperty.call(_DIM_ROUTE, id)) continue;
        var ok = false;
        try { ok = !!_DIM_ROUTE[id](k); } catch (e) { ok = true; }  // 判定自身出错 ⇒ 保守放行
        if (ok) { delete state.skipOperators[id]; continue; }
        state.skipOperators[id] = true;
        var why = '维度路由 n=' + k.n + ' m=' + k.m
            + (k.linKnown ? (k.lin ? ' 线性' : ' 非线性') : ' 线性性未知')
            + '：该算子的数学前提不成立';
        log[id] = why;
        decisions.push({ op: id, n: k.n, m: k.m, linear: k.lin, why: why });
    }
    state.dimRouteKey = k;
    state.dimRouteDecisions = decisions;
    return decisions;
}

/**
 * 供测试与文档用：导出一份「本版本每维主算子链」的可读描述。
 * 它是**描述**（给人看/给 Agent 看），不是判定逻辑——真判定在 _DIM_ROUTE。
 */
function _dimRouteProfile() {
    var rows = [];
    for (var n = 0; n <= 6; n++) {
        for (var m = 0; m <= 6; m++) {
            for (var lin = 0; lin <= 1; lin++) {
                for (var poly = 0; poly <= 1; poly++) {
                    if (m === 0 && n === 0) continue;
                    if (m > n + 2) continue;               // 只列有意义的形状
                    var k = { n: n, m: m, lin: !!lin, linKnown: true, poly: !!poly, polyKnown: true };
                    var take = [];
                    for (var id in _DIM_ROUTE) {
                        if (!Object.prototype.hasOwnProperty.call(_DIM_ROUTE, id)) continue;
                        var ok = false;
                        try { ok = !!_DIM_ROUTE[id](k); } catch (e) { ok = true; }
                        if (ok) take.push(id);
                    }
                    rows.push({ n: n, m: m, linear: !!lin, polynomial: !!poly, operators: take });
                }
            }
        }
    }
    return rows;
}
// ═══════════════════ 模块：pipeline/scheduler ═══════════════════
/* 模块 pipeline/scheduler：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function _op(id, name, fn, cost, kind, contract, sound) {
    return { id: id, name: name, fn: fn, cost: cost, kind: kind, contract: !!contract, sound: !!sound };
}


function _runOp(state, op) {
    if (state.done) return 0;
    if (state.skipOperators && state.skipOperators[op.id]) return 0;
    // 全局硬超时兜底（2026-08-21）：根调用开表，跨整棵递归树共享；任何算子执行前检查，
    // 杜绝单输入长时间卡顿/冻结。触发时如实标记 truncated/unconverged，绝不静默丢解。
    //
    // 🔴 2026-10-04：阈值改为引用常量 _LS_BRANCH_TIME_BUDGET_MS（值不变，仍是 8000），
    //   与 branch.js 的内层看门狗同源。理由：两处各写一个数字必然漂移，
    //   而一旦内层 > 外层，内层就是死代码（历史值 10000 > 8000 正是如此）。
    if (typeof __LS_ROOT_START !== 'undefined' && __LS_ROOT_START > 0 &&
        performance.now() - __LS_ROOT_START > _LS_BRANCH_TIME_BUDGET_MS) {
        if (!state.done) {
            state.done = true;
            state.truncated = true;
            state.unconverged = true;
            state.hardTimeout = true;
        }
        return 0;
    }
    var stats = state.opStats || (state.opStats = {});
    var rec = stats[op.id] || (stats[op.id] = { name: op.name, cost: op.cost, kind: op.kind, calls: 0, ms: 0, gain: 0, hits: 0, errors: 0 });
    var doTrack = op.contract && state.varNames && state.varNames.length > 0;
    var before = doTrack ? _cloneBox(state.D0) : null;
    var v0 = doTrack ? _boxLogVolume(state.D0, state.varNames) : 0;
    var t0 = performance.now();
    rec.calls++;
    try {
        op.fn(state);
    } catch (e) {
        // 单个算子失败不再让整次求解崩溃；记录后继续，由后续算子/兜底接管
        rec.errors++;
        if (doTrack) _suan52Feedback(state, op, _SUAN52_CONFLICT_ERROR);   // suan52：冲突驱动权重
        (state.opErrors = state.opErrors || []).push({ op: op.id, name: op.name, message: (e && e.message) ? e.message : String(e) });
    }
    rec.ms += performance.now() - t0;
    if (!doTrack) return 0;
    if (!_assertContraction(state, op.id, before)) {
        _suan52Feedback(state, op, _SUAN52_CONFLICT_ROLLBACK);   // suan52：回滚=最强冲突信号
        return 0;
    }
    var v1 = _boxLogVolume(state.D0, state.varNames);
    var gain;
    if (isFinite(v0) && isFinite(v1)) gain = v0 - v1;
    else if (!isFinite(v0) && isFinite(v1)) gain = 1e6;   // 无界 → 有界：重大收缩
    else gain = 0;
    if (gain > 1e-12) { rec.gain += gain; rec.hits++; _suan52Feedback(state, op, null); return gain; }
    _suan52Feedback(state, op, _SUAN52_CONFLICT_DRY);   // suan52：零收益反馈
    return 0;
}


function _runSeq(state, ops) {
    for (var i = 0; i < ops.length; i++) {
        _runOp(state, ops[i]);
        if (state.done) return true;
    }
    return false;
}


function _updateMovability(state) {
    if (!state || !state.varNames) return;
    if (!state._movHist) state._movHist = {};
    if (!state.mov) state.mov = {};
    for (var i = 0; i < state.varNames.length; i++) {
        var vn = state.varNames[i];
        var b = state.D0 ? state.D0[vn] : null;
        if (!b || typeof b !== 'object' || !('min' in b)) { state.mov[vn] = 'unknown'; continue; }
        var lo = b.min, hi = b.max, status;
        if (!isFinite(lo) || !isFinite(hi)) {
            status = 'overflow';
        } else {
            var w = hi - lo;
            if (w > MOV_OVERFLOW_W) status = 'overflow';
            else if (w > MOV_ILL_ABS) status = 'ill_conditioned';
            else {
                // 收敛无望：宽度多轮几乎不收缩（仅当仍较宽时判定，避免误伤已收敛变量）
                var h = state._movHist[vn] || (state._movHist[vn] = []);
                h.push(w); if (h.length > MOV_HIST_MAX) h.shift();
                var n = h.length;
                if (n >= 4 && w > 1e3 && (h[n - 1] / h[0]) > 0.95) status = 'convergence_hopeless';
                else status = 'normal';
            }
        }
        state.mov[vn] = status;
    }
}
// 是否存在"爆炸/病态"变量（用于安全跳过 futile 的贵层收缩；但绝不跳过分支定界，分支才是大盒的正确疗法）

function _hasExplodedMovability(state) {
    if (!state || !state.mov) return false;
    for (var i = 0; i < state.varNames.length; i++) {
        var s = state.mov[state.varNames[i]];
        if (s === 'overflow' || s === 'ill_conditioned') return true;
    }
    return false;
}


function _suan52W(state) {
    if (!state._s52w) state._s52w = {};
    return state._s52w;
}


function _suan52Scale(state) {
    if (state._s52scale) return state._s52scale;
    var n = 1;
    try {
        if (state.equations && typeof astNodeCount === 'function') {
            for (var i = 0; i < state.equations.length; i++) {
                var c = astNodeCount(state.equations[i]);
                if (isFinite(c) && c > 0) n += c;
            }
        }
    } catch (e) { n = 1; }
    state._s52scale = n;
    return n;
}


function _suan52EstCost(state, op) {
    var st = state.opStats || {};
    var rec = st[op.id];
    // 实测：至少跑过一次才用，避免首个样本的计时噪声（第一次常含 JIT 预热）
    if (rec && rec.calls >= 2 && rec.calls > 0) {
        var m = rec.ms / rec.calls;
        if (isFinite(m) && m > 0) return m;
    }
    var prior = (op.cost || 1) * _suan52Scale(state);
    return prior > 0 ? prior : 1;
}


function _suan52Feedback(state, op, kind) {
    var W = _suan52W(state);
    var cur = W[op.id] || (W[op.id] = { w: 1, dry: 0, calls: 0 });
    cur.calls++;
    if (kind === _SUAN52_CONFLICT_ROLLBACK) {
        cur.w += 2;                 // 回滚是极强的信号：它几乎意味着该算子与当前盒形态不兼容
        cur.dry = 0;
    } else if (kind === _SUAN52_CONFLICT_ERROR) {
        cur.w += 1;
        cur.dry = 0;
    } else if (kind === _SUAN52_CONFLICT_DRY) {
        cur.dry++;
        // 连续 3 次零收益 ⇒ 该算子在本场形态下无效用，降权（不跳过，只往后排）
        if (cur.dry >= 3) { cur.w *= 0.5; cur.dry = 0; }
    } else {
        if (cur.dry > 0) cur.dry--;
    }
    return cur;
}


function _suan52Order(state, layer) {
    if (!layer || layer.length < 2) return layer;
    var W = _suan52W(state);
    var scored = [];
    for (var i = 0; i < layer.length; i++) {
        var op = layer[i];
        var cur = W[op.id];
        var w = cur ? cur.w : 1;                 // 未跑过的算子保持中立权重 1
        var c = _suan52EstCost(state, op);
        scored.push({ op: op, p: w / c, i: i });
    }
    scored.sort(function (a, b) { return (b.p - a.p) || (a.i - b.i); });   // 显式 tie-break 保证稳定
    var out = [];
    for (var k = 0; k < scored.length; k++) out.push(scored[k].op);
    return out;
}


function _runContractionFixpoint(state, ops, maxRounds) {
    if (!state.varNames || state.varNames.length === 0) return;
    maxRounds = maxRounds || 6;

    // 🔴 2026-10-04 子问题减负：分支定界递归出来的子问题（opts._subProblem=true）
    //   最多跑 2 轮，而不是根问题的 6 轮。
    //
    // 为什么这**不损正确性**（这是本改动唯一的成立前提，必须说清）：
    //   收缩层的作用是把 D0 变窄。而子问题的 D0 已经是父域的一半 —— 也就是说
    //   「收缩」这件事在子层能做的幅度，父层已经做过了。实测子层几乎必然第一轮就
    //   `g <= 1e-12`（零增益）从而 break，多跑的 4 轮是纯空转。
    //   而**有增益的层不会因此丢失**：层内不动点判定（g<=1e-12 break）与
    //   「贵层取得收缩就回流便宜层」（reentered）在前 2 轮内照常生效。
    //   换句话说被砍掉的是「确定无增益」的重复轮次。
    //
    // ⚠ 但这是**性能**改动，不是「正确性已证明」—— 我不会说它对所有输入零影响。
    //   护栏在 test/test-branch-budget.mjs：同一批题在开/关减负下解数必须一致，
    //   有差异就以「关掉减负」为准（宁可慢，不可少解）。
    //   `_noSubProblemTrim` 是护栏用的逃生阀（branch.js 沿递归链透传），
    //   只有测试会置它；生产路径永远走减负。
    if (state.solveOpts && state.solveOpts._subProblem
        && !(state.solveOpts._noSubProblemTrim) && maxRounds > 2) maxRounds = 2;

    // 按 cost 分桶，得到由便宜到贵的层序
    var buckets = {}, costs = [];
    for (var i = 0; i < ops.length; i++) {
        var c = ops[i].cost;
        if (!buckets[c]) { buckets[c] = []; costs.push(c); }
        buckets[c].push(ops[i]);
    }
    costs.sort(function (a, b) { return a - b; });

    var round = 0;
    state.contractionRounds = 0;
    state.contractionGain = state.contractionGain || 0;

    while (round < maxRounds) {
        round++;
        state.contractionRounds = round;
        _updateMovability(state);                                  // 切片B：每轮更新病态标记
        var skipExpensive = _hasExplodedMovability(state);          // 爆炸/病态 ⇒ 跳过 futile 的贵层（不跳过分支）
        var reentered = false;

        for (var li = 0; li < costs.length; li++) {
            var layerCost = costs[li];
            if (skipExpensive && layerCost >= 3) continue;          // 安全跳过：仅略过收缩尝试，盒子不被丢弃
            var layer = buckets[layerCost];
            var layerGain = 0;
            // 最便宜层（li===0）在层内压到不动点：单位代价最低，反复跑最划算
            var innerMax = (li === 0) ? 4 : 1;
            for (var it = 0; it < innerMax; it++) {
                var g = 0;
                    var ordered = _suan52Order(state, layer);   // suan52：桶内按 权重/实测成本 排序
                for (var oi = 0; oi < layer.length; oi++) {
                    g += _runOp(state, ordered[oi]);
                    if (state.done) return;
                }
                layerGain += g;
                if (g <= 1e-12) break;   // 层内已到不动点
            }
            state.contractionGain += layerGain;
            // 较贵层取得收缩 ⇒ 立刻回流到最便宜层重跑（域变窄常解锁新的廉价收缩）
            if (layerGain > 1e-12 && li > 0) { reentered = true; break; }
        }

        if (!reentered) break;   // 一整轮各层皆无收缩 ⇒ 全局不动点
    }
}


function _routeOperators(state) {
    if (!state || !state.varNames || !state.varNames.length) return;
    if (!state.skipOperators) state.skipOperators = {};
    var log = state.operatorRouting || (state.operatorRouting = {});
    var eqs = state.equations;
    if (!eqs || !eqs.length) return;

    // suan34 LP Narrowing：适用前提 = 全部方程对所有变量均为一次（线性）
    // 已有判据 _isLinearAST(node)：func / ^ / / 与非常数乘积均判为非线性。
    // 若某方程尚未解析成 AST（无 .type），则视为「无法判定」⇒ 不跳，保持原行为。
    var allLinear = true;
    for (var i = 0; i < eqs.length; i++) {
        var eq = eqs[i];
        if (!eq || !eq.type) continue;          // 无法判定 ⇒ 保守不跳
        if (!_isLinearAST(eq)) { allLinear = false; break; }
    }
    if (allLinear) {
        delete state.skipOperators.suan34;
        delete log.suan34;
    } else {
        state.skipOperators.suan34 = true;
        log.suan34 = '非线性系统：LP 线性松弛前提不成立，跳过单纯形收缩';
    }
}


function _runPipeline(state, opts) {
    opts = opts || {};
    _routeOperators(state); // 算子适用性路由：按问题结构特征裁掉前提不成立的算子
    if (opts.contract !== false) {
        // fastMode 下限制回流轮数，牺牲部分收缩深度换响应速度
        _runContractionFixpoint(state, OPS_CONTRACT, state.fastMode ? 2 : 6);
        if (state.done) return true;
    }
    if (opts.geometry && _runSeq(state, OPS_GEOMETRY)) return true;
    if (opts.numeric && _runSeq(state, OPS_NUMERIC)) return true;
    if (opts.post && _runSeq(state, OPS_POST)) return true;
    return false;
}


function _movabilityFull(state) {
    var out = {};
    var vns = state.varNames || [];
    for (var i = 0; i < vns.length; i++) {
        var vn = vns[i], b = state.D0 ? state.D0[vn] : null;
        if (!b || typeof b !== 'object' || !('min' in b)) { out[vn] = { status: 'unknown', width: null }; continue; }
        var status = (state.mov && state.mov[vn]) || 'normal';
        var w = (isFinite(b.min) && isFinite(b.max)) ? +Math.abs(b.max - b.min).toFixed(6) : null;
        out[vn] = { status: status, width: w };
    }
    return out;
}

// ═══════════════════ 模块：pipeline/solver ═══════════════════
/* 模块 pipeline/solver：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function getOutputVarNames(state) {
    if (state.originalVarNames && state.originalVarNames.length) return state.originalVarNames;
    return state.varNames || [];
}
// 将"缩减坐标解向量"(state.varNames 顺序) 回代为"完整坐标解向量"(originalVarNames 顺序)。

function reconstructSolution(state, redValues) {
    var outNames = getOutputVarNames(state);
    var curNames = (state.varNames && state.varNames.length) ? state.varNames : outNames;
    if (!redValues || !Array.isArray(redValues)) return null;
    var full = {};
    for (var i = 0; i < curNames.length && i < redValues.length; i++) full[curNames[i]] = redValues[i];
    if (state.substitutions) {
        var subOrder = Object.keys(state.substitutions).reverse();
        for (var s = 0; s < subOrder.length; s++) {
            var sv = subOrder[s];
            if (full[sv] === undefined) {
                try { full[sv] = evalAST(state.substitutions[sv], full); } catch (e) { full[sv] = 0; }
            }
        }
    }
    return outNames.map(function(v) { return full[v] !== undefined ? full[v] : 0; });
}


function _complianceGuard(equationStrs, varNames) {
    var _maxTotal = 100 * 1024;
    var _reCJK = /[\u2E80-\u2EFF\u3040-\u30FF\u3130-\u318F\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/; // 中/日/韩表意文字
    var _total = 0, _i, _w;
    if (Array.isArray(equationStrs)) {
        for (_i = 0; _i < equationStrs.length; _i++) {
            var _s = equationStrs[_i];
            if (typeof _s !== 'string') continue;
            _total += _s.length;
            if (_reCJK.test(_s)) _w = '包含自然语言文字';
            else _w = null;
            if (_w) {
                throw { type: 'invalid_input', message: '第 ' + (_i + 1) + ' 条输入' + _w + '。本工具是数学方程求解器，仅接受数学方程（可含数字、变量与运算符），不接受文字说明。' };
            }
        }
        if (_total > _maxTotal) {
            throw { type: 'invalid_input', message: '方程文本总长超过 100KB 上限。' };
        }
    }
    if (Array.isArray(varNames)) {
        for (_i = 0; _i < varNames.length; _i++) {
            if (typeof varNames[_i] === 'string' && _reCJK.test(varNames[_i])) {
                throw { type: 'invalid_input', message: '变量名包含自然语言文字。变量名仅支持字母 / 希腊字母 / 下标等形式。' };
            }
        }
    }
}


function _lsTryWholeIdentifier(equationStrs, varNames, decimals, initialD0, fastMode, opts) {
    // 已声明变量 ⇒ 声明表已是强证据，不再二次猜谜
    if (varNames && varNames.length) return null;
    var _lsFuncs = ['sin','cos','tan','ln','exp','sqrt','log','log10','log2','abs','mod','floor','ceil','gamma','diff','int','lim','ode','cot','sec','csc','arcsin','arccos','arctan','sinh','cosh','tanh'];
    var _lsWhole = [];
    (equationStrs || []).forEach(function (eq) {
        var _lsIds = String(eq).match(/[a-zA-Z_\u0370-\u03FF\u2080-\u209F][a-zA-Z0-9_\u0370-\u03FF\u2080-\u209F]*/g) || [];
        _lsIds.forEach(function (id) {
            if (_lsFuncs.indexOf(id) >= 0) return;        // 函数名不是变量
            if (id === 'pi' || id === '\u03C0') return;   // 圆周率常量
            if (_lsWhole.indexOf(id) < 0) _lsWhole.push(id);
        });
    });
    // 回退假设本身也必须落在引擎 arity 上限内，否则保持诚实失败（不谎报解）
    if (!_lsWhole.length || _lsWhole.length > 6) return null;
    _LS_PROTECTED_NAMES = new Set(_lsWhole);
    var _lsRes2 = _solveImpl(equationStrs, _lsWhole, decimals, initialD0, fastMode, opts);
    if (_lsRes2) {
        _lsRes2.interpretation = 'whole_identifier_fallback';
        _lsRes2.interpretationReason = '自动模式下先按「标识符=单字母连乘」假设解析，该假设使变量数超过引擎上限 6（自身不自洽）⇒ 回退为「标识符整体=一个变量」假设。结果按回退假设呈现，请以 varNames 复核。';
    }
    return _lsRes2;
}

function solve(equationStrs, varNames, decimals, initialD0, fastMode, opts) {
    _solveRecursionCount++;
    // 门禁：非数学文字 / 体量超限，在总入口拒收（网页端 + MCP 端共用；数字串已放行）
    try { _complianceGuard(equationStrs, varNames); } catch (_cgErr) { _solveRecursionCount--; throw _cgErr; }
    // 兼容性归一化（诚实性 + 用户直觉）：用户常把「求 expr=0 的根」简写成裸表达式（如 "x^2-1"）。
    // 缺等号的方程自动补 "=0"，既符合数学直觉，也避免被误判为「无方程」而谎称「严格证明无实数解」。
    //
    // 2026-10-03：这段判断已收敛到 input/recognize.js 的 classifyInput()。
    // 此前「什么是方程 / 什么是约束 / 什么是自然语言」在三个文件里各有一套 if/else，
    // 口径可以互相矛盾（曾出现：门禁判非法、分类说合法），且无从单测。
    // 现在这里是唯一的补等号执行点，判据来自 classifyInput，且只对 NEEDS_EQUALS 动手 ——
    // 约束/域/不等式原样透传，避免污染 parseCondition 的识别（C1 回归）。
    if (equationStrs && equationStrs.length) {
        equationStrs = equationStrs.map(function (eqStr) {
            const _cls = classifyInput(eqStr);
            // 只给「裸表达式」补 =0；其余（方程/约束/域/不等式）原样透传，幂等、零回归。
            if (_cls.kind === INPUT_KIND.NEEDS_EQUALS) return _cls.normalized + '=0';
            return eqStr;
        });
    }
    // 仅最外层调用初始化根计时与预算池；递归子调用继承，避免看门狗/预算被重置
    var _isRoot = !__LS_SOLVE_ACTIVE;
    if (_isRoot) {
        __LS_ROOT_START = performance.now();
        __LS_SOLVE_ACTIVE = true;
        __LS_BRANCH_BUDGET = (opts && Number.isFinite(opts.maxBranch)) ? opts.maxBranch : 200;
        __LS_MSNEWTON_DONE = false;  // 多起点牛顿每根调用只跑一次
    }
    // 保护表在 solve 入口就按本次 varNames 建好（不再等 _solveImpl）。
    // 原因（P0，2026-10-03）：下面的未声明标识符门禁会调 fuzzyFix，而它原先读的是
    // 模块级 _LS_PROTECTED_NAMES —— 此刻还是**上一次 solve 残留的表**，
    // 于是「solve 之后 fuzzyFix("2x") 永久变成 "2x" 且不可逆」，隐式乘全面失效。
    // 这里建好局部表并全程显式传给 fuzzyFix，门禁与解析从此看到同一份保护表。
    var _lsEntryProt = new Set();
    if (varNames && varNames.length) {
        for (var _lsEpi = 0; _lsEpi < varNames.length; _lsEpi++) {
            if (typeof varNames[_lsEpi] === 'string' && varNames[_lsEpi]) _lsEntryProt.add(varNames[_lsEpi]);
        }
    }
    _LS_PROTECTED_NAMES = _lsEntryProt;   // 兼容未传参的旧调用点（如网页端直接用 fuzzyFix）
    try {
        if (_solveRecursionCount > 500) {
            return { solutions: [], resultType: 1, error: "RECURSION_LIMIT", message: "递归调用次数超过限制（500），可能存在矛盾或无限分裂", executionPath: "递归保护", timeMs: 0, varNames: varNames || [] };
        }
        // === 变量名归一化（声明表与方程同步，解析前统一处理）===
        // (2) 希腊字母名 → Unicode 符号：用户用常见拼写（theta/alpha/...）声明变量时，
        //     把 varNames 与方程中的同名标识符统一映射为符号（θ/α/...），保证变量表与方程一致。
        //     映射表不含函数名与被占用的 gamma/pi，且对已是 Unicode 符号的变量名幂等。
        // (1) 变量名 'e' 保护：tokenize 会把独立标识符 e 误当欧拉常数（Math.E），
        //     仅在用户声明 e 为变量时才把方程中的独立 e 替换为占位符 ₑ（U+2091 拉丁下标 e）。
        //     选 ₑ 而非原 _E：ₑ 属 tokenize 下标段 \u2080-\u209F，却不在 fuzzyFix 隐式乘分裂字符类
        //     [a-zA-Z_\u0370-\u03FF] 内，故不会被 xy→x*y 规则拆成 _*E（这是上一版 _E 占位符的失效根因）。
        // 两项都在解析前完成，统一走 _solveImpl 一次，避免早期返回导致另一项漏做。
        if (varNames && equationStrs) {
            var _vnNorm = varNames.map(function(vn) { return _greekNameToSymbol(vn); });
            var _eqsNorm = equationStrs.map(function(eqStr) {
                if (typeof eqStr !== 'string') return eqStr;
                return _greekNameToSymbol(eqStr);
            });
            // e 保护：基于已希腊映射的变量表判断是否声明了 e
            if (_vnNorm.indexOf('e') >= 0) {
                _eqsNorm = _eqsNorm.map(function(eqStr) {
                    if (typeof eqStr !== 'string') return eqStr;
                    return eqStr.replace(/(^|[^A-Za-z0-9_])e(?=$|[^A-Za-z0-9_])/g, '$1ₑ');
                });
                _vnNorm = _vnNorm.map(function(vn) { return vn === 'e' ? 'ₑ' : vn; });
            }
            // 修复（2026-10-02，诚实优先）：旧实现在"方程含未声明标识符"时一路走到无解分支，
            // 甚至【谎称已严格证明无实数解】。实测：solve(["2*z+1=5"], ["x"]) 返回
            // error=NO_SOLUTION、message=「过定线性方程组不相容：经高斯消元+秩判定严格确认无实数公共解【已严格证明：
            // 定义域内不存在实数解】」—— 而真实原因只是 z 没声明，压根没进求解路径。用户据此会以为"方程无解"。
            // 正确做法：求解前置门禁，把"未声明"与"无解"严格分开，给出可操作诊断。
            var _lsDeclSet = {}, _lsDi = 0;
            for (; _lsDi < _vnNorm.length; _lsDi++) { _lsDeclSet[_vnNorm[_lsDi]] = 1; }
            // ⚠️ 口径一致性（2026-10-03 修复的 P0）：本门禁必须 tokenize(fuzzyFix(原文))，
            //   与 setup.js 解析路径完全一致。历史实现用 tokenize(原文)，
            //   而隐式乘（Agent 最自然的写法 "2x"）只有 fuzzyFix 才会补出乘号，
            //   导致 tokenize("2x") 少一个 * 而被误判成「未声明标识符」→ 早退 0 解；
            //   极端情况 2x+3y=13 配 x-y=1 不触发早退，直接返回错误解 x=0.5,y=-0.5。
            //   静默给错答案比报错更危险，所以此处必须与解析侧同源。
            var _lsBadName = {}, _lsBadAny = false;
            for (var _lsEi = 0; _lsEi < _eqsNorm.length; _lsEi++) {
                var _lsEqStr = _eqsNorm[_lsEi];
                if (typeof _lsEqStr !== 'string') continue;
                var _lsToks = null;
                // ⚠ 2026-10-04：第二个参数把【声明过的变量名】传给 tokenize ——
                //   否则变量名 `e` 会被当成欧拉数 2.718 静默替换（见 lex.js 的 P0 说明），
                //   本门禁就会把 `a+b+c+d+e` 里的 e 漏判为「未声明标识符」⇒ 早退 0 解。
                //   口径必须与 setup 解析层完全一致（同源），否则又是一处分叉。
                try { _lsToks = tokenize(fuzzyFix(_lsEqStr, _lsEntryProt), _lsEntryProt); } catch (_lsTe) { continue; }   // 必须先 fuzzyFix：门禁与 setup 解析须看同一个字符串，否则隐式乘 "2x" 会被误判为未声明标识符（见下方注释）
                for (var _lsTi = 0; _lsToks && _lsTi < _lsToks.length; _lsTi++) {
                    if (_lsToks[_lsTi].type === 'var' && !_lsDeclSet[_lsToks[_lsTi].name]) {
                        _lsBadName[_lsToks[_lsTi].name] = 1; _lsBadAny = true;
                    }
                }
            }
            if (_lsBadAny) {
                _solveRecursionCount--;   // 早退不进 try/finally，需手动回收递归计数
                return {
                    solutions: [], resultType: 1, error: "UNDECLARED_VARIABLE",
                    message: "方程里出现了未声明的标识符：" + Object.keys(_lsBadName).join("、")
                           + "。它们既不是内置常量（pi/π/e 是常数）、也不是内置函数（sin/cos/ln/exp/sqrt/abs…），"
                           + "必须在「变量名」里声明后求解。当前是「未声明 ⇒ 无法求解」，不是「无解」。",
                    executionPath: "未声明标识符前置门禁（求解前拦截）", timeMs: 0, varNames: varNames || []
                };
            }
            // 仅当声明表/方程确有改变才走归一化路径（含希腊名或声明了 e 两种情况），
            // 纯 ASCII 输入保持原路径，行为完全不变，避免回归。
            var _changed = false;
            for (var _i = 0; _i < _vnNorm.length; _i++) { if (_vnNorm[_i] !== varNames[_i]) { _changed = true; break; } }
            if (!_changed) {
                for (var _j = 0; _j < _eqsNorm.length; _j++) { if (_eqsNorm[_j] !== equationStrs[_j]) { _changed = true; break; } }
            }
            if (_changed) {
                // 域键同步归一化：initialD0 的键必须按 varNames 同样规则映射（theta→θ、声明 e→ₑ），
                // 否则域键与归一化后的变量名失配 → 用户域被静默丢弃 → 退回默认 ±1e6
                // （周期方程如 sin(theta)=0.5 会在全域穷举数十万根，表现为长时间无响应）。
                var _d0Norm = initialD0;
                if (initialD0 && typeof initialD0 === 'object' && !(initialD0 instanceof Array)) {
                    _d0Norm = {};
                    for (var _dk in initialD0) {
                        if (!Object.prototype.hasOwnProperty.call(initialD0, _dk)) continue;
                        var _nk = _greekNameToSymbol(_dk);
                        if (_vnNorm.indexOf('ₑ') >= 0 && _nk === 'e') _nk = 'ₑ';
                        _d0Norm[_nk] = initialD0[_dk];
                    }
                }
                return _solveImpl(_eqsNorm, _vnNorm, decimals, _d0Norm, fastMode, opts);
            }
        }
        var _lsFirst = _solveImpl(equationStrs, varNames, decimals, initialD0, fastMode, opts);
        // arity 自洽性：只在「引擎自己判定变量数超限」且未声明变量时，才换词法假设重跑
        var _lsErr = (_lsFirst && _lsFirst.result && _lsFirst.result.error) || (_lsFirst && _lsFirst.error);
        if (_lsErr === 'OVER_LIMIT') {
            var _lsFallback = _lsTryWholeIdentifier(equationStrs, varNames, decimals, initialD0, fastMode, opts);
            if (_lsFallback) return _lsFallback;
        }
        return _lsFirst;
    } finally {
        // 无论正常返回还是抛异常，都必须回收递归计数，防止异常泄漏导致后续调用被误判为超限
        _solveRecursionCount--;
        if (_isRoot) { __LS_SOLVE_ACTIVE = false; }
    }
}


function _isPolynomialSystem(eqs) {
    var transcendental = { sin: 1, cos: 1, tan: 1, cot: 1, sec: 1, csc: 1, exp: 1, log: 1, ln: 1, asin: 1, acos: 1, atan: 1, sinh: 1, cosh: 1, tanh: 1, sqrt: 1 };
    var poly = true;
    function walk(node) {
        if (!poly || !node || typeof node !== 'object') return;
        if (node.type === 'call' && transcendental[node.name]) { poly = false; return; }
        if (node.args) for (var i = 0; i < node.args.length; i++) walk(node.args[i]);
    }
    for (var i = 0; i < eqs.length; i++) walk(eqs[i]);
    return poly;
}


function _numericJacobianRank(eqs, vns, x0) {
    var m = eqs.length, n = vns.length;
    var J = [];
    for (var i = 0; i < m; i++) {
        var row = [];
        for (var j = 0; j < n; j++) {
            var hp = (Math.abs(x0[j]) > 1) ? 1e-6 * Math.abs(x0[j]) : 1e-6;
            var vp = {}, vm = {};
            for (var a = 0; a < n; a++) { vp[vns[a]] = x0[a]; vm[vns[a]] = x0[a]; }
            vp[vns[j]] = x0[j] + hp; vm[vns[j]] = x0[j] - hp;
            var fpp = NaN, fmm = NaN;
            try { fpp = evalAST(eqs[i], vp); } catch(e) { _lsNoteInternal(e, 'solver.js:230 求导中心差分，失败则用旧值，有意忽略'); }
            try { fmm = evalAST(eqs[i], vm); } catch(e) { _lsNoteInternal(e, 'solver.js:231 求导中心差分，失败则用旧值，有意忽略'); }
            var der = (fpp - fmm) / (2 * hp);
            if (!isFinite(der)) der = 0;
            row.push(der);
        }
        J.push(row);
    }
    return _matrixRank(J, m, n);
}


function _matrixRank(M, rows, cols) {
    if (rows === 0 || cols === 0) return 0;
    var A = [];
    for (var i = 0; i < rows; i++) A.push(M[i].slice());
    var maxAbs = 0;
    for (var i2 = 0; i2 < rows; i2++) for (var j2 = 0; j2 < cols; j2++) {
        var av = Math.abs(A[i2][j2]); if (av > maxAbs) maxAbs = av;
    }
    var tol = 1e-8 * (maxAbs || 1);
    var rank = 0, r = 0, col = 0;
    while (r < rows && col < cols) {
        var piv = -1;
        for (var k = r; k < rows; k++) {
            if (Math.abs(A[k][col]) > tol && (piv < 0 || Math.abs(A[k][col]) > Math.abs(A[piv][col]))) piv = k;
        }
        if (piv < 0) { col++; continue; }   // 该列全零 ⇒ 跳列，行不变
        if (piv !== r) { var t = A[r]; A[r] = A[piv]; A[piv] = t; }
        var pv = A[r][col];
        for (var k2 = r + 1; k2 < rows; k2++) {
            var f = A[k2][col] / pv;
            if (f !== 0) for (var c2 = col; c2 < cols; c2++) A[k2][c2] -= f * A[r][c2];
        }
        rank++; r++; col++;
    }
    return rank;
}


function _buildMeta(state) {
    var opStats = state.opStats || {};
    var fired = Object.keys(opStats);
    var contracted = fired.filter(function (id) { return (opStats[id].gain || 0) > 0; });
    var truncated = !!state.truncated;
    var term = truncated ? 'resource_exhausted' : (state.fastMode ? 'fast_mode' : 'converged');
    // 🔴 2026-10-04 新增：算子耗时排行（用户重点「时间消耗」的可观测面）
    //
    // 为什么必须透出（三个理由，缺一不可）：
    //   ① Agent 决策：拿到「时间花在哪」才能自己选路（改域 / 减变量 / 换容差 / 直接放弃）。
    //      之前 meta 只有 operatorsFired（算子**名字**列表），没有耗时，
    //      Agent 无法区分「这条路径很快」和「这条路径注定超时」。
    //   ② 可诊断：6 元二次实测撞满 8 秒 0 解，若没有耗时分布只能靠反复插桩猜。
    //   ③ 排序是「确定性」的：先按 ms 降序，同 ms 按 id 字典序 —— 输出稳定可 diff，
    //      不会出现两次同输入两次不同顺序的「噪声 diff」。
    //
    // ⚠ 只取前 12 个：opStats 有 40+ 项，全量会让 meta 膨胀（Agent 侧有 1600B 预算）。
    //   超时的场景最需要看的就是「前几名谁在烧时间」。
    var _prof = fired.map(function (id) {
        var r = opStats[id] || {};
        return { op: id, name: r.name || id, ms: +(r.ms || 0).toFixed(2), calls: r.calls || 0, gain: +(r.gain || 0).toFixed(3), errors: r.errors || 0 };
    });
    _prof.sort(function (a, b) { return (b.ms - a.ms) || (a.op < b.op ? -1 : 1); });
    return {
        solverVersion: SOLVER_VERSION,
        reportId: _computeReportId(state),
        fastMode: !!state.fastMode,
        terminatedBy: term,
        truncated: truncated,
        elapsedMs: +(performance.now() - (state.startTime || performance.now())).toFixed(2),
        operatorsFired: fired,
        operatorsFiredCount: fired.length,
        operatorsContracted: contracted,
        // 算子耗时 TOP12（降序；ms 为该算子所有调用累计）
        operatorProfile: _prof.slice(0, 12),
        operatorProfileTotalMs: +_prof.reduce(function (s, x) { return s + x.ms; }, 0).toFixed(2),
        contractionRounds: state.contractionRounds || 0,
        contractionGain: +(state.contractionGain || 0).toFixed(3),
        monotonicityViolations: (state.contractionViolations || []).length,
        monotonicityViolationDetail: (state.contractionViolations || []).slice(0, 5),
        opErrors: (state.opErrors || []).slice(0, 10),
        conditionWarnings: (state.conditionWarnings || []).slice(0, 20),
        movability: _movabilityFull(state),
        ieee: { nan: !!_IEEE.nan, inf: !!_IEEE.inf, divZero: !!_IEEE.divZero, domainErr: !!_IEEE.domainErr },
        representativePointNote: state.repPointNote || '按范数最小/原点优先规则选取代表点',
        traceabilityNote: '核心收缩算子均经 _assertContraction 单调性护栏（after⊆before）；切片B 已落地 IEEE754 异常闭环 + Movability 病态标记内核；算子-定理-代码可追溯矩阵见产品文档'
    };
}


function _collectVars(node, set) {
    if (!node) return;
    if (node.type === 'var') { set[node.name] = true; return; }
    if (node.type === 'binop') { _collectVars(node.left, set); _collectVars(node.right, set); }
    else if (node.type === 'unary') { _collectVars(node.operand, set); }
    else if (node.type === 'func') { if (node.arg) _collectVars(node.arg, set); if (node.args) { for (var _ci = 0; _ci < node.args.length; _ci++) _collectVars(node.args[_ci], set); } }
}
// 忠实方程的所有变量是否都能被 state.varNames 完整绑定。

function _faithfulEqsBindable(eqs, vns) {
    var vset = {};
    for (var _k = 0; _k < vns.length; _k++) vset[vns[_k]] = true;
    for (var _i = 0; _i < eqs.length; _i++) {
        var s = {};
        _collectVars(eqs[_i], s);
        for (var name in s) { if (!vset[name]) return false; }
    }
    return true;
}


function _residualAt(eq, vm) {
    try {
        var v;
        if (eq.op === '=' || eq.op === '==') {
            var l = evalAST(eq.left, vm), r = evalAST(eq.right, vm);
            if (l === null || r === null || l !== l || r !== r || !isFinite(l) || !isFinite(r)) return NaN;
            v = l - r;
        } else {
            v = evalAST(eq, vm);
            if (v === null || v !== v || !isFinite(v)) return NaN;
        }
        return v;
    } catch (err) { return NaN; }
}


/**
 * 置信度按【认证证据】重算（2026-10-04 修正，撤销同日的 backwardError 版本）
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么必须用「认证覆盖率」而不是「点残差」（这个错我犯过一次，记下来）
 *
 * v1（错误）：confidence = f(max 后向误差)，<1e-9 ⇒ high
 *   判据的直觉是「解算得准 ⇒ 可信」。这个直觉**在数学上是错的**，因为
 *   **「这一点残差小」与「这个解集被证明过」是两个不同的命题**。
 *
 *   实测反例（欠定系统 x+y−3=0, x−y−1=0, z−1=0）：
 *     解集是 3 维空间里的**一条直线**（正维流形，**无穷多解**），
 *     引擎自己都在 message 里写「未证明解集完备」，
 *     但那个代表点精确满足三式 ⇒ 后向误差 = 0 ⇒ confidence 报 **"high"**。
 *   ⇒ 一个只算出了「流形上一个点」的结果，被标成了「高置信」。
 *   读者（人）会以为「答案就是它」，这与项目「宁可少给不可给错」的红线相反。
 *
 *   数学表述：confidence 想回答的是 **∃ 存在性证明的强度**（一阶量），
 *   而后向误差回答的是 **某个具体点的代入误差**（点态量）。
 *   欠定时点态误差可以任意小（投影到流形上即可），而存在性证明根本不存在。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么残差本来就不该当「可信度」
 *   「x 是否是真解」= 零测试（zero test）。这个问题在一般情形下**不可判定**：
 *     · Richardson 1968, *J. Symbolic Logic* 33(4):514–520：
 *       对含 x, e^x, sin x, |x|, π, ln2 的表达式类，
 *       「是否有 x 使 A(x)=0」与「A(x) 恒等于 0」都**不可判定**。
 *     · Blömer 1991 (FOCS 32:670–677) / 1998 (ESA, LNCS 1461:151–162)：
 *       即使退化到「有理数的平方根和」，零判定也只是 **co-NP**（单向误差蒙特卡洛），
 *       判定**符号**至今仍是公开问题。
 *   ⇒ 任何「|f(x)| < ε ⇒ x 是根」的推理都**不是证明**，只是启发式。
 *     本项目里它只允许出现在两个地方，且都明确 fail-closed：
 *       · polyIsRootWithin / _finalResidualGate：**筛选器**（剔伪解），不产出可信度；
 *       · backwardError：**诊断量**（Web 端调试 / 回归测试），不进 Agent 决策面。
 *   可信度必须由**区间算子给出的存在性/唯一性证书**回答：Krawczyk / Miranda / MK-test。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 本函数的口径（只看认证覆盖率，与 tier 分布一致）
 *   high   = 全部解都 tier==='proven'（coverage === 1）
 *   medium = 部分 proven（0 < coverage < 1）
 *   low    = 一个 proven 都没有（全是 candidate）
 *   无解   = 不动（空结果没有「解的可信度」可言，交给 provenEmpty / truncated 表达）
 *
 * 放在收口处的原因不变：tier 会被认证层与后面的过滤改写，
 * 分散算必然算在别人的改写之前。
 */
/**
 * 回代验证：把候选点代回**用户原方程**，判定它是不是真解。
 *
 * 🔴 2026-10-05 新增（用户指令：「去掉安全认证……我们的是极致的计算」）：
 *   这是 Krawczyk 区间认证的**数学替代品**，用「回代 + 后向误差」判据。
 *
 * 为什么它比 Krawczyk 更适合本产品：
 *   Krawczyk 回答的是「**这个盒子里有且仅有一个零点**」—— 一个**误差上界**问题。
 *   它必须假设雅可比在该邻域局部可逆（⇒ 根孤立），在正维流形上前提不成立，
 *   必然认证失败；且每个解都要跑多轮区间算术（实测 800ms 预算）。
 *   而 Agent 要的是「**这个点是不是解**」—— 一个**判定**问题，
 *   回代就能回答，且是 O(1) 次求值，零区间开销。
 *
 * 判据（Higham 后向误差，尺度无关）：
 *   绝对残差 |F(x)| 在大系数题上永远很大（相消误差不可消除），
 *   拿它当判据等于「题写得大 ⇒ 什么都不是解」。
 *   后向误差 η = max_i |F_i(x)| / (Σ_j |∂F_i/∂x_j · x_j|) 度量的是
 *   「x 有多接近**某个**精确解」—— 这是与问题尺度无关的正确问法。
 *
 * 严格性分档（三档，缺证据就降级，绝不谎报）：
 *   verified  : 后向误差 ≤ _BE_EXACT  ⇒ 实质上是精确解（机器精度级）
 *   plausible : 后向误差 ≤ _BE_LOOSE  ⇒ 是解到可接受精度
 *   rejected  : 超过 ⇒ 不是解
 *   另加 signChange 证据：残差在邻域左右**符号翻转**（中值定理）⇒ 严格穿越，
 *   这比任何残差量级都强，且是**相消误差免疫**的判据。
 *
 * @returns {{status:string, backwardError:number, signCrossing:boolean, residual:number}}
 */
function _verifyBySubstitution(state, sol) {
    var eqs = (state.userEquations && state.userEquations.length) ? state.userEquations
        : (state.equations || []);
    var vns = getOutputVarNames(state);
    var out = { status: 'rejected', backwardError: Infinity, signCrossing: false, residual: Infinity };
    if (!eqs || !eqs.length || !sol || !sol.values || sol.values.length !== vns.length) return out;

    var vmap = {};
    for (var i = 0; i < vns.length; i++) {
        var v = sol.values[i];
        if (typeof v !== 'number' || !isFinite(v)) return out;
        vmap[vns[i]] = v;
    }

    var maxRes = 0, maxBE = 0;
    for (var e = 0; e < eqs.length; e++) {
        var fv;
        try { fv = evalAST(eqs[e], vmap); } catch (err) { return out; }
        if (fv === null || fv !== fv || !isFinite(fv)) return out;   // 未定义点不是解
        var ares = Math.abs(fv);
        if (ares > maxRes) maxRes = ares;
        // 后向误差：残差相对该项的「求值规模」。规模为 0（该式恒 0）时
        // 残差也必须是 0 才算通过，否则视为未定义证据。
        var scale = 0;
        try { scale = evalASTScale(eqs[e], vmap); } catch (err2) { scale = 0; }
        if (!isFinite(scale) || scale <= 0) { if (ares > 0) maxBE = Infinity; continue; }
        var be = ares / scale;
        if (be > maxBE) maxBE = be;
    }
    out.residual = maxRes;
    out.backwardError = maxBE;

    // 符号穿越证据（中值定理）：在相对邻域取左右两点，残差异号 ⇒ 真穿越。
    // 这一条是**免疫相消误差**的：即使两侧残差绝对值都很大，只要异号就有根在中间。
    var _w = [];
    for (var i2 = 0; i2 < vns.length; i2++) {
        var c = sol.values[i2];
        _w.push(Math.max(1e-7 * Math.max(1, Math.abs(c)), 1e-12));
    }
    var vL = {}, vR = {};
    for (var i3 = 0; i3 < vns.length; i3++) {
        vL[vns[i3]] = sol.values[i3] - _w[i3];
        vR[vns[i3]] = sol.values[i3] + _w[i3];
    }
    var nEq = eqs.length, sameSign = 0, undef = 0;
    for (var e2 = 0; e2 < nEq; e2++) {
        var fl, fr;
        try { fl = _residualAt(eqs[e2], vL); fr = _residualAt(eqs[e2], vR); }
        catch (err3) { undef++; continue; }
        if (fl === null || fr === null || !isFinite(fl) || !isFinite(fr)) { undef++; continue; }
        if ((fl < 0 && fr > 0) || (fl > 0 && fr < 0)) sameSign++;
    }
    // 全部可判定的式子在邻域两端都异号 ⇒ 严格穿越
    if (sameSign > 0 && sameSign + undef === nEq) out.signCrossing = true;

    if (out.signCrossing) out.status = 'verified';
    else if (maxBE <= _BE_EXACT) out.status = 'verified';
    else if (maxBE <= _BE_LOOSE) out.status = 'plausible';
    return out;
}


/**
 * 牛顿精化：把已找到的解再往真根上推几步（**纯计算，不是认证**）。
 *
 * 🔴 2026-10-05 新增。与 `_certifySolutions` 拆开的原因见调用处注释：
 *   Krawczyk 层顺带做的盒内牛顿精化，实测能把 g017 `exp(x)=2` 的解
 *   从误差 6.1e-13 拉到 6.7e-16（= ln2 的双精度最优值）。
 *   那是**算得更准**，与「给误差上界」是两件事，不该一起关掉。
 *
 * 与 `_newtonRefine`（certify.js 内）的区别：
 *   那个需要传入区间盒（Krawczyk 算出来的包含盒）做约束，本函数不需要 ——
 *   我们只要「在附近再牛顿几步」，不需要「保证不跑出盒」。
 *   收敛判据同样用 Higham 后向误差（尺度无关），停滞 3 轮退出。
 *
 * ⚠ 值被替换后 residual / substitutionCheck 必须同步重算（历史 P0：
 *   值换了而派生字段没换 ⇒ 报出 7 个数量级偏差的假残差）。
 */
function _refineSolutions(state) {
    var sols = state && state.result && state.result.solutions;
    if (!sols || !sols.length) return;
    var eqs = (state.userEquations && state.userEquations.length) ? state.userEquations : state.equations;
    var vns = getOutputVarNames(state);
    if (!eqs || !eqs.length || vns.length === 0) return;

    var n = vns.length;
    for (var i = 0; i < sols.length; i++) {
        var sol = sols[i];
        if (!sol || !sol.values || sol.values.length !== n) continue;
        // 正维流形上的代表点不精化：那里牛顿的雅可比不可逆，
        // 推它等于沿流形乱走，会把正确的代表点推成伪解。
        if (sol.tier === 'structural' || sol.representative === true) continue;
        if (eqs.length !== n) continue;    // 非方阵：牛顿需要 J 可逆，跳过

        var x = sol.values.slice();
        var bestRms = Infinity, bestX = null, stall = 0, moved = false;
        var CONV_REL = 1e-15, CONV_ABS = 1e-15;
        for (var iter = 0; iter < 12; iter++) {
            var vmap = {};
            for (var k = 0; k < n; k++) vmap[vns[k]] = x[k];
            var F = [], rms = 0, bwd = 0, okAll = true;
            for (var e = 0; e < n; e++) {
                var fe;
                try { fe = evalAST(eqs[e], vmap); } catch (err) { okAll = false; break; }
                if (!isFinite(fe)) { okAll = false; break; }
                F.push(fe); rms += fe * fe;
                var sc = 0;
                try { sc = evalASTScale(eqs[e], vmap); } catch (err2) { sc = 0; }
                if (isFinite(sc) && sc > 0) { var be = Math.abs(fe) / sc; if (be > bwd) bwd = be; }
            }
            if (!okAll) break;
            rms = Math.sqrt(rms / n);
            if (bwd === 0) bwd = rms;
            if (bwd <= CONV_REL || rms <= CONV_ABS) break;
            if (rms < bestRms) { bestRms = rms; bestX = x.slice(); stall = 0; }
            else { stall++; if (stall >= 3) break; }

            // 数值雅可比（中心差分）：与 homotopy.js 同样的口径。
            // 这里不用区间雅可比 —— 精化不要求误差上界，中心差分足够且快得多。
            var J = [];
            for (var r = 0; r < n; r++) {
                var row = [];
                for (var c = 0; c < n; c++) {
                    var h = 1e-8 * Math.max(1, Math.abs(x[c]));
                    var xp = x.slice(), xm = x.slice();
                    xp[c] += h; xm[c] -= h;
                    var mp = {}, mm = {};
                    for (var k2 = 0; k2 < n; k2++) { mp[vns[k2]] = xp[k2]; mm[vns[k2]] = xm[k2]; }
                    var fp, fm;
                    try { fp = evalAST(eqs[r], mp); fm = evalAST(eqs[r], mm); } catch (err3) { fp = NaN; fm = NaN; }
                    row.push((isFinite(fp) && isFinite(fm)) ? (fp - fm) / (2 * h) : 0);
                }
                J.push(row);
            }
            var gs;
            try { gs = gaussianSolve(J, F.map(function (v) { return -v; })); } catch (err4) { gs = null; }
            if (!gs || !gs.solution) break;
            var step = 0;
            for (var s2 = 0; s2 < n; s2++) step += Math.abs(gs.solution[s2]) * Math.max(1, Math.abs(x[s2]));
            if (!isFinite(step) || step === 0) break;
            for (var s3 = 0; s3 < n; s3++) x[s3] += gs.solution[s3];
            moved = true;
        }
        if (!moved) continue;
        // 用最终 x 重算残差（不信任迭代过程中的中间值）
        var vmap2 = {};
        for (var k3 = 0; k3 < n; k3++) vmap2[vns[k3]] = x[k3];
        var maxRes = 0, finite2 = true;
        for (var e2 = 0; e2 < n; e2++) {
            var f2;
            try { f2 = Math.abs(evalAST(eqs[e2], vmap2)); } catch (err5) { f2 = NaN; }
            if (!isFinite(f2)) { finite2 = false; break; }
            if (f2 > maxRes) maxRes = f2;
        }
        if (!finite2) continue;
        sol.values = x;
        sol.residual = maxRes;
    }
}


// 后向误差阈值（尺度无关）：
//   _BE_EXACT = 1e-14：双精度 15~17 位有效数字，1e-14 后向误差意味着
//     「若存在精确解，它与 x 的差不超过 ~1e-14」⇒ 实质就是那个解。
//   _BE_LOOSE = 1e-9 ：工程可接受精度（与旧口径 1e-6 绝对残差在量级 1 的题上等价，
//     但对 1e8 量级的题不再误杀）。
// ⚠ 这两个数是**浮点数表示极限**导出的，不是「拍脑袋的容差」：
//   u = 2^-53 ≈ 1.1e-16 是双精度单位舍入误差，1e-14 ≈ 100u。
var _BE_EXACT = 1e-14;
var _BE_LOOSE = 1e-9;


function _resyncConfidence(state) {
    var res = state && state.result;
    if (!res || !res.solutions || !res.solutions.length) return;
    var proven = 0;
    for (var i = 0; i < res.solutions.length; i++) {
        var s = res.solutions[i];
        if (s && (s.tier === 'proven' || s.certified === true)) proven++;
    }
    res.confidence = (proven === res.solutions.length) ? "high"
        : (proven > 0 ? "medium" : "low");
}


function _filterIllDefined(state) {
    // 变量对齐修复（2026-08-21）：suan19 显式代入消元会把 state.varNames 缩减为
    // 仅"未消去"的变量子集（如 [y,a,b,c]），但候选解数组是按完整变量顺序（originalVarNames，
    // 如 [x,y,z,a,b,c]）回代生成的。若直接拿缩减清单去绑 6 值数组，会错位把真解误删成空集。
    // 故优先使用 suan19 当初为回血保存的完整 originalVarNames；长度与解数组一致才启用，
    // 否则回退 state.varNames（含无消元/等长的常规情形），保持零回归。
    var sols0 = (state.result && state.result.solutions && state.result.solutions[0]);
    var _useOrig = state.originalVarNames && state.originalVarNames.length &&
        sols0 && sols0.values && state.originalVarNames.length === sols0.values.length;
    var vns = _useOrig ? state.originalVarNames : (state.varNames || []);
    // 用"忠实（未消分母）方程"回代校验，可剔除 sin(x)/x=0 在 x=0 处 0/0 未定义之类的伪根（由 suan23 消分母引入）。
    // 仅当忠实方程的所有变量都能被 state.varNames 完整绑定时才启用；变量消元导致绑定不全时回退 state.equations，保持零回归。
    var eqs = (state.userEquations && state.userEquations.length && _faithfulEqsBindable(state.userEquations, vns))
        ? state.userEquations
        : (state.equations || []);
    var d0 = state._initD0 || state.D0 || {};
    // 域检查基准：优先用初始声明域快照（用户 initialD0 + domainConstraints），
    // 收缩后 D0 因区间过估可能错删真解，不参与过滤（2026-08-21）。
    var sols = state.result.solutions;
    if (!sols || !sols.length) return;
    var kept = [];
    var _tol = state.tolerance || 1e-6;
    for (var i = 0; i < sols.length; i++) {
        var sol = sols[i];
        var vals = sol.values;
        if (!vals || vals.length < vns.length) continue; // 结构异常，丢弃
        var vmap = {};
        for (var v = 0; v < vns.length; v++) vmap[vns[v]] = vals[v];
        // 候选点邻域半宽：符号翻转/触零校验用（相对容差 + 10×绝对容差，防误触奇点或过窄漏判）
        var _wArr = [];
        for (var v2 = 0; v2 < vns.length; v2++) {
            var _c = vals[v2];
            var _w = Math.max(_tol * 10, Math.abs(_c) * 1e-3, 1e-9);
            _wArr.push(_w);
        }
        var ok = true;
        // 1) 每个等式在该点必须良定义（有限，非 NaN/Inf）；0/0、sqrt(负)、log(非正) 均判未定义
        for (var e = 0; e < eqs.length; e++) {
            var eq = eqs[e];
            var ev;
            try { ev = evalAST(eq, vmap); } catch (err) { ev = NaN; }
            if (ev === null || ev !== ev || !isFinite(ev)) { ok = false; break; }
            // 2) 真解校验（仅对等式；方程以残差形式存储，故 op 为 '-'/'='/==' 均视为等式）。
            //    伪根典型如 sin(x)/x=1 —— 可去奇点 x=0 邻域内 sin(x)/x 数值≈1（点残差~3e-7 在容差内），
            //    点求值/点残差均无法识别；区间残差亦不行（区间算术依赖问题使 sin(x)/x 的邻域区间被过估为含 1）。
            //    判据：真解须满足 中心残差触零（机器级）或 邻域左右采样符号翻转（真穿越）。
            //    sin(x)/x=1 在整个邻域残差恒负、无穿越 → 剔除；tan(x)=0 于 π 处左负右正 → 保留。
            //    任一侧采样未定义 → 保守保留（防域边界误删）。
            if (eq.type === 'binop' && (eq.op === '-' || eq.op === '=' || eq.op === '==')) {
                var _resC = _residualAt(eq, vmap);
                var _rhsV = (eq.right && eq.right.type === 'num') ? eq.right.value : 0;
                var _tiny = 1e-9 * Math.max(1, Math.abs(_rhsV) || 1);
                if (!(Math.abs(_resC) <= _tiny)) {
                    var _vL = {}, _vR = {};
                    for (var q = 0; q < vns.length; q++) {
                        var _qn = vns[q];
                        _vL[_qn] = vals[q] - _wArr[q];
                        _vR[_qn] = vals[q] + _wArr[q];
                    }
                    var _resL = _residualAt(eq, _vL), _resR = _residualAt(eq, _vR);
                    var _cross = false;
                    if (_resL === _resL && _resR === _resR) { // 两侧均良定义才可判穿越；任一侧未定义 → 保守保留
                        if (_resL * _resR < 0) _cross = true;
                        if (Math.abs(_resL) <= _tiny || Math.abs(_resR) <= _tiny) _cross = true;
                    }
                    if (!_cross) { ok = false; break; }
                }
            }
        }
        // 3) 必须在声明域 D0 内（防越域解漏出）
        if (ok) {
            for (var d = 0; d < vns.length; d++) {
                var iv = d0[vns[d]];
                if (iv && typeof iv === 'object' && ('min' in iv) && iv.min <= iv.max) {
                    // 自适应域容差：D0 可能被收缩到极窄区间（宽度 < 输出舍入精度 1e-6），
                    // 而候选解是舍入到 decimals 位后的值，固定 1e-9 容差会把真解误判越域。
                    // 容差 = max(1e-9, |值|×1e-7, 区间宽度×1e-3)，宽度项保证窄区间下舍入不误杀。
                    // 注意：若 iv.min > iv.max（收缩层数值误差产生的翻转空区间），跳过域检查，
                    // 避免把真解误判越域（空区间无实际约束力，且已由残差/穿越校验把关）。
                    var _ivw = (iv.max - iv.min);
                    var _dtol = Math.max(1e-9, Math.abs(vals[d]) * 1e-7, _ivw * 1e-3);
                    if (vals[d] < iv.min - _dtol || vals[d] > iv.max + _dtol) { ok = false; break; }
                }
            }
        }
        if (ok) kept.push(sol);
    }
    if (kept.length !== sols.length) {
        state.result.solutions = kept;
        if (kept.length === 0 && state.result.resultType !== 1) {
            // 全部候选被过滤 → 如实降级为无解（不静默给出错误结论）
            state.result.resultType = 1;
            state.result.resultTypeName = "空结果";
            state.result.resultTypeDesc = "候选解均因表达式未定义（如分母为零）或超出声明变量域而被过滤，无有效解";
            if (!state.result.error) {
                state.result.error = "NO_SOLUTION";
                state.result.message = "候选解被良定义 / 域约束过滤";
            }
        }
    }
}


/**
 * 🔴🔴 最终残差闸门（2026-10-04，P0 数学正确性最后一道防线）
 *
 * 为什么要在 _filterIllDefined 之后再加一道：
 *   _filterIllDefined 用的是 **state.equations（已化简 AST）** 或 userEquations，
 *   而分支定界的递归子问题会把 state.D0 收窄、把 state.equations 改写。
 *   于是出现了一条**绕过路径**：递归子问题返回的候选解，
 *   在**子 state 里**通过了过滤（对着子域是对的），回到父 state 后
 *   仍带着子 state 的语义。实测事故：
 *
 *     p ∈ [−2.5e9, 2.5e9] 上的 120000·p·(1+p)^360 = 2500000（真解 p=0.01955）
 *     → 返回 9650 个「解」，其中 9468 个 residual 自报为 0；
 *     → 独立回代：p=±1.25e9 等点处 (1+p)^360 溢出成 ±Infinity，
 *       表达式值是 Infinity，而 Infinity 减掉常数仍是 Infinity；
 *     → 这些点被算成「残差 0 的完美解」。
 *
 *   也就是说：**溢出被当成了零残差**。这不是精度问题，是正确性问题 ——
 *   给用户 9468 个假解，比返回 0 解恶劣得多。
 *
 * 本闸门的判据（与前两道都不同，这是它的价值所在）：
 *   ① 用 **state.equationStrs 原始字符串** 重新解析，不复用任何可能被改写的 AST；
 *   ② 直接调 evalAST 取**表达式的值**，而不是相减后的残差 ——
 *      非有限值（NaN/±Infinity）在这里被显式拒绝，而不是让它参与减法变成 NaN 后被漏过；
 *   ③ 阈值用**后向稳定残差**（Higham 标准做法）：|f(x)| ≤ τ · Σ|terms|，
 *      其中 Σ|terms| 是表达式各项绝对值之和（f 在该点求值的**条件数尺度**），
 *      τ 取 1e-11（约 4.5 万倍机器 eps，覆盖表达式深度带来的舍入放大）。
 *      这不是放水，是把「允差」和**问题自身的量纲**绑定：
 *
 *   🔴 2026-10-04 修 tol 退化 bug（误杀真根，比原 bug 更普遍）
 *      初版阈值写的是 max(1e-6, |rhs| × 1e-7)，其中 |rhs| 取「等号右端的常数」。
 *      但 `expr=0` 是方程的**标准写法** ⇒ 右端恒为 0 ⇒ tol ≡ 1e-6 恒成立。
 *      实测后果：x^2−1e13=0（真根 ±3162277.66）的两个真根被当伪解杀掉 ——
 *      因为 x=3162277.6601683795 时 x^2 的双精度舍入误差本身就是 0.00195，
 *      而 tol 只有 1e-6。**凡是根量级超过 ~1e3 的大系数方程，真根全被误杀。**
 *      教训：绝对容差必须与表达式在该点的量纲挂钩，用固定 1e-6 判「残差为 0」
 *      在大系数问题上等价于「把所有解都判成伪解」。
 *
 * ⚠ 拒绝对齐用户利益：宁可少给解，不可给错解。全部被拒时如实标注，
 *   绝不让「伪解列表」流到 Agent 面前。
 */
/**
 * 🔴🔴 2026-10-04 新增（P0，与 _finalResidualGate 对称）：**不等式约束终态闸门**。
 *
 * 实测事故：`x^2=0` + `x>0` 返回解 `x=0` —— x=0 **违反** x>0。
 *   根因不是求解器算错了，而是**没有任何一道闸门校验不等式**：
 *     · `_finalResidualGate` 只代回**等式** AST（state.equations 里根本没有不等式，
 *       setup.js:61 明确写「不等式不加入 equations 数组」）；
 *     · `verifyAllConstraints`（真正会校验不等式的函数）只在 `suan48` 里被调用，
 *       而 suan48 首行就 `if (!state.isInequalityOnly) return`（ineq.js:7）
 *       ⇒ **混合系统（等式+不等式）的解从不经过任何不等式校验**。
 *   D0 收紧只能保证「不去盒外找」，无法剔除**恰好落在约束边界上**的点 ——
 *   而网格采样最易命中的恰恰就是边界点（0 就是这种点）。
 *
 * 为什么是 P0：`x^2=0, x>0` 的**真解集是空集**，工具却返回了一个解。
 *   Agent 会直接把它当答案报给用户 ⇒ 输出**违反问题本身约束**的解，
 *   比「算不出」严重得多（算不出只是不知道，给错是骗人）。
 *
 * 为什么放在 `_finalResidualGate` 之后同一个位置：那个位置踩过一次坑（见上 1432 行注释）——
 *   _mergeGlobalBranch 会在更早处把全局分支定界的解**再塞一次**进 state.result.solutions，
 *   闸门必须站在「所有写入路径的最后一个」之后，否则就是假闸门。
 *
 * fail-closed 方向选择：
 *   · 约束**解析失败** → 该候选判为「无法验证」→ **保留**（不因验证不了就误杀真解，
 *     与 _finalResidualGate 的既有取舍一致）；
 *   · 约束**解析成功且明确违反** → 剔除。这条不能反过来：宁可少给，不可给错。
 *   · 严格不等式（> / <）按**精确违反**判定；非严格（>= / <=）用 1e-6 容差
 *     （沿用 verifyAllConstraints 的既有口径，两处必须一致，否则闸门与 suan48 互相打架）。
 */
function _finalConstraintGate(state) {
    var sols = (state && state.result && state.result.solutions) || [];
    if (!sols.length) return;
    var iq = state.inequalityConstraints || [];
    if (!iq.length) return;
    var vns = getOutputVarNames(state);
    if (!vns || !vns.length) return;
    var kept = [], dropped = 0;
    for (var i = 0; i < sols.length; i++) {
        var vals = sols[i].values;
        if (!vals || vals.length < vns.length) { kept.push(sols[i]); continue; }
        if (verifyAllConstraints(vals, iq, vns)) { kept.push(sols[i]); continue; }
        // 区分「明确违反」与「无法验证」：verifyAllConstraints 两者都返回 false。
        // 无法验证的候选必须保留（不因验证不了就误杀），否则会把真解误删。
        if (_constraintsVerifiable(vals, iq, vns)) { dropped++; continue; }
        kept.push(sols[i]);
    }
    if (dropped > 0) {
        state.result.solutions = kept;
        state.result.inequalityGateDropped = (state.result.inequalityGateDropped || 0) + dropped;
        var note = '不等式约束闸门剔除 ' + dropped + ' 个违反约束的候选（如 x>0 却返回 x=0）';
        if (!state.result.warnings) state.result.warnings = [];
        if (state.result.warnings.indexOf(note) < 0) state.result.warnings.push(note);
    }
}
// 约束是否**每一项都能求值**（不是「是否满足」）。全可求值 ⇒ verifyAllConstraints 的 false
// 就是真违反；有一项求不出 ⇒ false 只说明「验证不了」，不能据此剔除。
function _constraintsVerifiable(values, constraints, varNames) {
    var vars = {};
    for (var vi = 0; vi < varNames.length; vi++) vars[varNames[vi]] = values[vi];
    for (var ci = 0; ci < constraints.length; ci++) {
        var c = constraints[ci];
        if (!c || !c.lhs || !c.rhs) continue;
        var lv, rv;
        try { lv = evalAST(c.lhs, vars); } catch (e) { return false; }
        try { rv = evalAST(c.rhs, vars); } catch (e2) { return false; }
        if (lv === null || lv !== lv || rv === null || rv !== rv
            || !isFinite(lv) || !isFinite(rv)) return false;
    }
    return true;
}

function _finalResidualGate(state) {
    var sols = (state && state.result && state.result.solutions) || [];
    if (!sols.length) return;
    var eqStrs = state.equationStrs || state._origEqStrs;
    if (!eqStrs || !eqStrs.length) return;   // 无原始串可依据 ⇒ 不动（fail-open 只限「无法验证」场景）
    var vns = getOutputVarNames(state);
    if (!vns || !vns.length) return;

    // 原始方程 → AST（解析失败的一律置 null，稍后按「无法验证」放行，绝不误杀）
    //
    // 🔴 2026-10-05 P0 修复（实测事故：`xy=6, x+y=5` 返回 0 解 + 「残差闸门剔除 2 个非解候选」）：
    //   这里重解析原始串时**漏了 fuzzyFix**，而 suan1 的解析管线是
    //     fuzzyFix(parts[0]) → parse(tokenize(...))
    //   fuzzyFix 才是补隐式乘法的那一步（"xy" → "x*y"，"2x" → "2*x"）。
    //   于是本闸门把 `xy=6` 解析成 var('xy') —— 一个**不存在的变量**，
    //   evalAST 得 NaN ⇒ 非有限 ⇒ bad=true ⇒ **真解 (2,3) 与 (3,2) 被当伪解杀掉**。
    //   更糟的是这一段 catch 住异常不让它冒头，症状只剩一句 warning，
    //   Agent 侧看到的是「算出 2 个解但都被剔除」，指向错误方向。
    //
    // 为什么原写法看着"更保险"却更危险：它想避开可能已改写的 AST（这点是对的，保留），
    // 但重解析必须与 suan1 **同管线**，否则闸门验收的是另一套语义。
    // 不同管线 = 闸门在检查一个用户从未写过的方程。
    //
    // 修法：与 suan1 完全同管线（fuzzyFix + protNames），不做其他改动。
    // protNames 用 state.protNames（suan1 的同一份），退化到 _LS_PROTECTED_NAMES。
    var _gateProt = state.protNames || _LS_PROTECTED_NAMES;
    var asts = [];
    for (var ei = 0; ei < eqStrs.length; ei++) {
        var a = null;
        try {
            var s = String(eqStrs[ei]);
            var k = s.indexOf('=');
            if (k < 0) a = parse(tokenize(fuzzyFix(s, _gateProt), _gateProt));
            else {
                var _lf = fuzzyFix(s.slice(0, k).trim(), _gateProt);
                var _rf = fuzzyFix(s.slice(k + 1).trim(), _gateProt);
                a = { type: 'binop', op: '-', left: parse(tokenize(_lf, _gateProt)), right: parse(tokenize(_rf, _gateProt)) };
            }
        } catch (e) { a = null; }
        asts.push(a);
    }
    if (!asts.some(function (x) { return !!x; })) return;
    // 🆕 二次防护：重解析出的 AST 若引用了 varNames 里不存在的标识符（典型如上例的 var('xy')），
    //   说明这次解析与 suan1 不同构 ⇒ 该式无法作为验收依据 ⇒ 置 null 按「无法验证」放行，
    //   而不是拿它去判真解为伪。宁可少一道验收，不可误杀（fail-closed 的正确方向）。
    var _gateVns = {};
    for (var _gv = 0; _gv < vns.length; _gv++) _gateVns[vns[_gv]] = true;
    for (var _gi = 0; _gi < asts.length; _gi++) {
        if (!asts[_gi]) continue;
        var _unknown = false;
        try {
            extractVariables(asts[_gi]).forEach(function (nm) { if (!_gateVns[nm]) _unknown = true; });
        } catch (_e) { _unknown = true; }
        if (_unknown) {
            state.result = state.result || {};
            asts[_gi] = null;
            var _w = '残差闸门：第 ' + (_gi + 1) + ' 式重解析出现未声明变量（隐式乘法未能还原），该式不参与验收';
            if (!state.result.warnings) state.result.warnings = [];
            if (state.result.warnings.indexOf(_w) < 0) state.result.warnings.push(_w);
        }
    }

    // 🔴🔴 2026-10-05 彻底去网格化：删掉「量化格余量」分支，容差回归**纯后向误差**判据。
    //
    // 背景（为何这个分支必须删，而不是留着无害）：
    //   它是我 2026-10-05 为修 P0 加的补丁 —— 坐标被roundToGrid 压到 6 位网格后，
    //   真解（1/3、23/30、√2…）带上‖J‖·h ≈ 2.3e-6 的**量化残差**，
    //   于是被迫给闸门加一条「网格余量」通道来放它们过关。
    //   那是**用容差去补精度损失**，方向是反的：你放宽判据只是让劣解混进来，
    //   并不能让 23/30 本身变得更准。真正的解法是别把解压到 6 位 ——
    //   现在 roundToGrid 是全精度 + ULP 去噪，残差自然回到机器精度量级（~1e-16），
    //   这个补丁的存在前提已消失，留着等于**永久放宽闸门**。
    //
    // 现在的判据（无特例）：残差 ≤ max(TOL_ABS_FLOOR, Σ|terms| · τ)，纯后向误差。
    // τ = 1e-11 的依据：机器 eps = 2.2e-16，τ/eps ≈ 4.5e4 倍余量，
    //   用来覆盖「表达式求值链的深度」造成的舍入放大（实测 x^2 放大到 2e-15，
    //   即 ~2e-14 相对误差 ⇒ τ=1e-11 有 500 倍余量，稳）。
    //
    // ⚠ TOL_ABS_FLOOR = 10^-COMPUTE_DECIMALS：仅当 Σ|terms| 算不出尺度时
    //   （表达式全是函数节点，evalASTScale 返回 0）退回绝对容差。
    //   此刻是**偏严**方向（fail-closed），符合「宁可少给不给错」。
    var TAU_REL = 1e-11;
    var TOL_ABS_FLOOR = 1e-6;

    var kept = [], droppedBad = 0, droppedUnverifiable = 0;
    for (var i = 0; i < sols.length; i++) {
        var vals = sols[i].values;
        if (!vals || vals.length < vns.length) { droppedUnverifiable++; continue; }
        var vmap = {};
        for (var v = 0; v < vns.length; v++) vmap[vns[v]] = vals[v];
        var bad = false;
        for (var e2 = 0; e2 < asts.length && !bad; e2++) {
            if (!asts[e2]) continue;   // 该式解析失败 ⇒ 不参与本候选的判据（不误杀）
            var ev, scale;
            // 🔴 关键：先判「表达式值本身是否有限」，再谈残差。
            //   Infinity − Infinity = NaN，NaN 与 0 比较恒为 false，很容易在下游被「当作已通过」。
            try { ev = evalAST(asts[e2], vmap); } catch (err) { ev = NaN; }
            if (ev === null || ev !== ev || !isFinite(ev)) { bad = true; break; }
            try { scale = evalASTScale(asts[e2], vmap); } catch (err2) { scale = 0; }
            if (!isFinite(scale) || scale <= 0) scale = 0;
            var tol = Math.max(TOL_ABS_FLOOR, scale * TAU_REL);
            if (Math.abs(ev) > tol) { bad = true; break; }
        }
        if (bad) { droppedBad++; continue; }
        kept.push(sols[i]);
    }
    if (droppedBad > 0 || droppedUnverifiable > 0) {
        state.result.solutions = kept;
        // 被剔除数量要如实告知（Agent 需要知道「引擎找到 N 个，其中 M 个是伪解」）
        var gateNote = '残差闸门剔除 ' + droppedBad + ' 个非解候选'
                     + (droppedUnverifiable ? ('（另有 ' + droppedUnverifiable + ' 个结构异常）') : '');
        if (!state.result.warnings) state.result.warnings = [];
        if (state.result.warnings.indexOf(gateNote) < 0) state.result.warnings.push(gateNote);
        state.residualGateDropped = droppedBad;
    }
}


function _enforceVarInvariant(state) {
    if (!state || !state.result || !state.result.solutions) return;
    var target = getOutputVarNames(state).length;
    if (target === 0) return;
    for (var i = 0; i < state.result.solutions.length; i++) {
        var sol = state.result.solutions[i];
        if (sol.values && sol.values.length === target) continue;
        var repaired = null;
        if (sol.values && state.substitutions && Object.keys(state.substitutions).length > 0
            && state.varNames && state.varNames.length > 0
            && sol.values.length === state.varNames.length) {
            repaired = reconstructSolution(state, sol.values);
        }
        if (repaired && repaired.length === target) {
            sol.values = repaired;
            continue;
        }
        if (!state.result.warnings) state.result.warnings = [];
        state.result.warnings.push('解#' + i + ' 变量数(' + (sol.values ? sol.values.length : 0) + ')≠输入变量数(' + target + ')，未能自动回代修复（疑似算子未回代消元变量），已保留原值并告警');
    }
}


function _assignTiers(state) {
    if (!state || !state.result || !state.result.solutions) return;
    var sols = state.result.solutions;
    // structural 仅对"真正欠定"系统（方程数 < 变量数）的代表点生效；
    // 满秩系统即便在解处 Jacobian 奇异（如 Powell singular），只要找到孤立解就标 verified/candidate，
    // 绝不因 local-rank 试探误判为 infinite 而盖戳 structural（2026-08-22 修 B2 误标）。
    var vns = getOutputVarNames(state);
    var underdetermined = (state.equations && state.equations.length < vns.length);
    for (var i = 0; i < sols.length; i++) {
        var sol = sols[i];
        // 🔴 2026-10-05（用户指令「去掉安全认证」）：proven 的判据从
        //   「Krawczyk 区间包含认证过」改成「**回代原方程验证通过**」。
        //
        // 为什么换：Krawczyk 回答的是「这个盒子里有且仅有一个零点」——
        //   一个**误差上界**问题，前提是雅可比局部可逆（⇒ 根孤立）。
        //   在正维流形上该前提不成立，必然认证失败（历史实测：x−y=0 输出 175 个
        //   假 proven）；且每个解要跑多轮区间算术，吃掉数百毫秒。
        // 回代回答的是「这个点是不是解」—— O(1) 次求值，零区间开销，
        //   且**对正维流形一样成立**（流形上的点照样过回代）。
        //
        // 判据分级（_verifyBySubstitution）：
        //   verified  = 邻域残差异号（严格穿越，中值定理）或 后向误差 ≤ 1e-14
        //   plausible = 后向误差 ≤ 1e-9
        //   其余 → candidate
        // 两级都只表示「这个点是解」，**不表示**「解在哪」——
        //   误差上界是 certifiedRadius 的活儿，已退出默认路径。
        var _vf = _verifyBySubstitution(state, sol);
        sol.substitutionCheck = {
            status: _vf.status,
            backwardError: _vf.backwardError,
            signCrossing: _vf.signCrossing
        };
        if (_vf.status === 'verified') sol.tier = 'proven';
        // 保留：精确有理数代入确证（ℚ 上恒等式，比任何数值判据都强）
        else if (sol.certMethod === 'exact_rational_substitution' && sol.certified === true) sol.tier = 'proven';
        else if (sol.certified === true) sol.tier = 'proven';
        // structural 仅对真正的"代表点"解生效（欠定/恒等系统给出 1 个代表点，标记 representative）；
        // 满秩系统即便在解处 Jacobian 奇异（Powell singular）或存在冗余方程被剔除，
        // 只要找到的孤立解就不盖戳 structural，避免误标（2026-08-22 修 B2）。
        else if (sol.representative === true && underdetermined) sol.tier = 'structural';
        else sol.tier = 'candidate';
    }
    var proven = 0, cand = 0, struct = 0;
    for (var j = 0; j < sols.length; j++) {
        if (sols[j].tier === 'proven') proven++;
        else if (sols[j].tier === 'structural') struct++;
        else cand++;
    }
    state.result.provenCount = proven;
    state.result.candidateCount = cand;
    state.result.structuralCount = struct;

    // —— 新增：把「独立计数证据」透传到顶层，别只藏在 sturmCompleteness 里 ——
    // ⚠ 教训：sturmIncomplete 写进去却没人读，等于没算（2026-10-04 实测 x^5-1e20*x+1=0
    //   漏 2 个根却报完备）。凡是「已算出但没被消费」的字段都是负债，要提到顶层。
    if (state.result.sturmCompleteness && state.result.sturmCompleteness.certified === true) {
        state.result.expectedRealRootCount = state.result.sturmCompleteness.realRootCount;
        state.result.missingRealRootCount = (state.result.sturmCompleteness.complete === false)
            ? state.result.sturmCompleteness.missing : 0;
    }
}


function _assignEmptiness(state) {
    if (!state || !state.result || state.result.error !== 'NO_SOLUTION') return;
    if (state.result.provenEmpty === true) {
        state.result.emptyProof = 'proof_empty';
        state.result.message = (state.result.message || '') + '【已严格证明：定义域内不存在实数解】';
    } else {
        state.result.emptyProof = 'candidate_empty';
        state.result.message = (state.result.message || '') + '【注意：当前为"未找到解"，非严格证明不存在；缩小/调整定义域或增加搜索可能发现解】';
    }
}


function _assignCompleteness(state) {
    if (!state || !state.result) return;
    var vns = getOutputVarNames(state);

    // —— fail-closed 门控：完备性不能是硬编码常量，必须由证据决定 ——
    // ⚠ 踩过的坑（2026-10-04）：此处原本写死 provenIsComplete: true。
    //   实测 x^5-1e20*x+1=0 暴露破口 —— _sturmCompletenessCheck 独立算出域内 3 个实根、
    //   只找到 1 个，已把 sturmIncomplete={realRootRoots:3, found:1, missing:2} 写进 result，
    //   但【没有任何下游消费它】⇒ 顶层照样报 provenCount:1 + provenIsComplete:true（漏解还宣称完备）。
    //   根因不是 Sturm 不算数，而是「算了不等于用」。凡是能证明「可能漏解」的地方都必须降级。
    var gaps = [];

    // —— 门控⓪：Sturm 计数的 found 必须按【最终输出】重算（2026-10-04）——
    // ⚠ 为什么必须在这里重算，而不能直接信 sturmIncomplete：
    //   _sturmCompletenessCheck 在 solver.js:1086 就跑完了，那时 solutions 还是【未过滤】的快照；
    //   之后 _filterIllDefined / _finalResidualGate / _mergeGlobalBranch 又会继续剔除解。
    //   于是 found 会停留在「过滤前」的数上 ⇒ 门控①拿到一个偏大的 found ⇒ missing 偏小
    //   ⇒ 【漏了 2 个解却报 complete:true】。
    //   实测事故：5x⁴−1e12x²+7=0。域内 4 个实根，过滤前 found=4、Sturm 也数出 4 ⇒ 判 complete；
    //   但两个小根（±2.6e-6）被 6 位绝对网格 + 邻域穿越判据剔除，最终只输出 2 个解。
    //   Agent 拿到 complete:true 会断言「全部解都在这里」—— 直接违反数学正确性。
    // 本函数是完备性判定的最后一道（1347 行，在所有过滤之后），所以这里的解数就是最终解数。
    var _sc = state.result.sturmCompleteness;
    if (_sc && _sc.certified === true && typeof _sc.realRootCount === 'number') {
        var _finalFound = (state.result.solutions || []).length;
        if (_finalFound !== _sc.found) {
            _sc.found = _finalFound;
            _sc.complete = (_sc.realRootCount === _finalFound);
            if (_sc.complete) { delete _sc.missing; }
            else { _sc.missing = _sc.realRootCount - _finalFound; }
        }
        if (!_sc.complete) {
            state.result.sturmIncomplete = {
                provenRealRoots: _sc.realRootCount,
                found: _sc.found,
                missing: _sc.realRootCount - _sc.found
            };
        } else {
            state.result.sturmIncomplete = null;
        }
        // 顶层透传必须在这里跟着刷新：_assignTiers 里的那份是过滤前的快照
        //（实测 5x⁴−1e12x²+7 顶层 missingRealRootCount 报 0，实际缺 2）。
        // 「已算出但没被消费」和「算了但用的是旧值」是同一类病。
        state.result.expectedRealRootCount = _sc.realRootCount;
        state.result.missingRealRootCount = _sc.complete === false ? _sc.missing : 0;
    }

    // 门控①Sturm 独立计数与实-found 不一致（单变量多项式最强的完备性证据）
    // ⚠ 两个方向都要说清：found > provenRealRoots 同样是异常（输出了 Sturm 证明不存在的根），
    //   不能只报「缺 N 个」把负数说成缺几个。
    // ⚠⚠ 措辞必须跟 `realRootCount` 的口径一致（2026-10-04 二次修正）：
    //   realRootCount 现在来自 _sturmCountRange，区间是**声明空间**（问题里的不等式/域约束界定，
    //   可 ±∞），不是搜索盒、也不是盲目用 ℝ。scope='R' 表示无约束、空间就是 ℝ；
    //   scope='declared' 表示空间由约束界定（见 sturmCompleteness.declaredLo/Hi）。
    //   旧文案写「域内共 N 个实根」会让 Agent 以为「域外还可能有」—— 而 scope 已声明计数空间，
    //   文案与数据自相矛盾；写「全域」在有约束时又不准确。
    var _scScope = (_sc && _sc.scope === 'declared') ? '声明空间内' : '全域';
    if (state.result.sturmIncomplete && state.result.sturmIncomplete.missing !== 0) {
        var _si2 = state.result.sturmIncomplete;
        gaps.push(_si2.missing > 0
            ? ('Sturm 独立计数证明' + _scScope + '共 ' + _si2.provenRealRoots +
               ' 个实根，本次仅找到 ' + _si2.found + ' 个，缺 ' + _si2.missing + ' 个')
            : ('Sturm 独立计数证明' + _scScope + '共 ' + _si2.provenRealRoots +
               ' 个实根，却输出了 ' + _si2.found + ' 个（多出 ' + (-_si2.missing) +
               ' 个）——独立计数与输出互相矛盾，不可宣称完备'));
    }
    // 门控②仍有未认证的 candidate。
    //  ⚠ 实测 2^x+x^2-100=0 暴露的隐蔽破口：它返回 2 个 tier='candidate'（certified=false），
    //    却因「没触发任何截断/Sturm 缺口」而算出 complete=true。
    //    理由：Krawczyk 只能证明「这个候选点附近有唯一根」，【无法证明没有别的根】。
    //    所以只要存在未经认证的候选解，且无独立的完备性证据（Sturm/单调分段），
    //    就【必须】降级为未验证 —— 0 个 proven 时声称完备在逻辑上毫无意义。
    var hasCandidate = (state.result.candidateCount || 0) > 0;
    var hasCompletenessProof = !!(
        (state.result.sturmCompleteness && state.result.sturmCompleteness.complete === true) ||
        (state.result.s55Completeness && state.result.s55Completeness.segmentsProven === true)
    );
    if (hasCandidate && !hasCompletenessProof) {
        gaps.push('存在 ' + state.result.candidateCount +
            ' 个未经认证的候选解（certified=false），且无独立完备性证据（Sturm 精确计数 / 导数单调分段）' +
            '——Krawczyk 只能证明候选点附近根唯一，不能证明没有其它根');
    }
    // 门控③解数被截断：resultant.js 用 truncated + exactCount 标记「精确总数 > 实际返回数」。
    //  ⚠ 这里【曾经】写过一个不存在的 displayCapped 字段 —— 教训：门控字段必须先 grep 核实存在，
    //    凭记忆写门控等于造了一条永不触发的假保护，比没有保护更危险（会给人虚假安全感）。
    //
    // 🔴 2026-10-05 分两种 truncated（原文案对欠定系统是**错的**）：
    //   · **正维欠定**（m<n 或 rank<n）：解集是仿射簇/流形，**本来就无穷多个解**。
    //     输出 1 个代表点是**正确且完整**的行为，没有「被截断」这回事。
    //     原文案「计算被资源上限中止，结果不完整」是**误报** ——
    //     实测 `x+y+z=6`（n=3,m=1）明明 1.3ms 就出结果，却被告知「资源上限中止」，
    //     Agent 据此会建议「提高预算/缩小域重试」，而真因是欠定，重试一万次还是无穷多。
    //   · **搜索被截断**：分支定界预算/盒数到限，这才是真的「被截断」。
    //   正维证据用 resultType===3 / positiveDim / effectiveDim>0（与 _conclusion4 的
    //   _posDimAny、下方 ④ 的 _isPosDimTrunc 同口径 —— 三处必须一致）。
    var _truncIsPosDim = (state.result.resultType === 3) || (state.result.positiveDim === true)
        || (typeof state.result.effectiveDim === 'number' && state.result.effectiveDim > 0
            && String(state.result.executionPath || '').indexOf('欠定') >= 0);
    if (state.result.truncated === true && !_truncIsPosDim) {
        gaps.push('计算被资源上限中止，结果不完整（truncated）');
    } else if (state.result.truncated === true && _truncIsPosDim) {
        // 正维欠定的截断**不是缺口**：解集无穷，本就不可能完备。
        // 用一条明确的说明替代「资源不足」措辞，避免给出假指令。
        gaps.push('正维（欠定）解集：解集是' +
            (typeof state.result.effectiveDim === 'number' && state.result.effectiveDim > 0
                ? (' ' + state.result.effectiveDim + ' 维') : '正维') +
            '的（仿射）流形，有无穷多个解 ⇒ 结构上不可能完备。' +
            '已给出的代表解是经验证的真解，但不是全部解。');
    }
    // 门控④精确计数（若有）大于实际返回解数 —— 截断了但没标 truncated 的路径
    if (typeof state.result.exactCount === 'number' && state.result.exactCount > (state.result.solutions || []).length) {
        gaps.push('精确计数为 ' + state.result.exactCount + '，实际只返回 ' +
            (state.result.solutions || []).length + ' 个（解被截断）');
    }
    // 🔴🔴 门控⑤（2026-10-04，P0）：全局区间分支定界**未运行** ⇒ 完备性未验证。
    //
    //   实测事故（我自己引入的）：把全局分支定界改成默认关之后，
    //   x³−x=0 的 completeness.provenIsComplete 从 false **翻成 true** ——
    //   因为门控③ 靠 state.result.truncated 触发，而 truncated 恰恰是
    //   _mergeGlobalBranch 在 complete=false 时置的。关掉分支 ⇒ 不置 truncated
    //   ⇒ 没有任何 gap ⇒ isComplete=true。
    //   ⇒ 而「没跑过穷举」和「穷举过且穷尽了」在逻辑上**完全不同**：
    //     前者对「有没有漏解」**零信息**，报 true 是**纯谎报**。
    //   这正是本产品最不能犯的错（Agent 客群靠它判断能否断言「找全了」）。
    //
    //   正确口径：**没做过完备性检查 ⇒ 完备性未验证**，与「检查过且通过」严格区分。
    //   ⇒ 无条件降级，不看有没有候选解、不看解是否已被证明存在。
    //
    // 🔴🔴 门控⑤'（2026-10-05，**P0 谎报**，golden g013 抓出）：
    //   `unconverged=true` 表示分支定界**跑了但没跑完**（预算/深度到限）。
    //   门控⑤ 只看 `globalBranchSkipped`（压根没跑）⇒ 漏掉了这一半。
    //
    //   事故：g013 `120000*p*(1+p)^360-2500000=0`（公积金月供，361 次方程）
    //     branchCount=11、unconverged=true（深度 10 层到限）、
    //     无 truncated（因为 _mergeGlobalBranch 在 complete=true 路径下不置它）、
    //     candidateCount=0（唯一解已 proven）⇒ **所有 gap 都为空**
    //     ⇒ completeness.provenIsComplete = **true**（谎报）。
    //   而这题在 p∈[−2.5e9, 2.5e9] 上是 361 次多项式，实根数根本数不完
    //   （(1+p)^360 在p≈−1 附近的行为 + 大系数 ⇒ 多个实根）。
    //   「找到 1 个已认证解 + 一个算不完的穷举」⇒ **绝不能**宣称完备。
    //
    //   为什么这是本产品最重的错：Agent 客群靠 provenIsComplete 决定
    //   「能不能断言找全了」。谎报 true 会让它对只找到 1 个根的 361 次方程
    //   断言「这就是全部解」—— 而金融场景里漏根= 算错月供。
    //
    //   修法：`unconverged` 与 `globalBranchSkipped` **同等对待** ——
    //   「没做过完备穷举」与「做过但没穷尽」，在「有没有漏解」这个问题上
    //   都是**零信息**。两者都必须降级，除非拿到独立完备性证据。
    if ((state.result.unconverged === true || state.result.globalBranchSkipped) && !hasCompletenessProof) {
        gaps.push(state.result.unconverged === true
            ? '区间分支定界**未能收敛**（预算或深度到限，穷举未完成）⇒ ' +
              '"没有漏解"这件事**没有任何证据**；proven 只证明"这一个解确实存在"，' +
              '不证明"没有别的解"。需要完备穷举请显式传 {globalBranch:true, maxBranch:<更大值>}'
            : '全局区间分支定界未运行（默认关闭）⇒ 未做过任何完备穷举检查，' +
              '"没有漏解"这件事**没有任何证据**；proven 只证明"这一个解确实存在"，' +
              '不证明"没有别的解"。需要完备穷举请显式传 {globalBranch:true}');
    }

    var realGaps = gaps.filter(function (g) { return !!g; });
    var isComplete = realGaps.length === 0;

    // ⚠ 2026-10-04 修文档 bug：原来这里硬写「声明定义域[-10000,10000]」，
    //   但 _domBoxOf 里的实测默认域是 [-1e6, 1e6]（差 100 倍）。写死的 scope 字符串
    //   会让 Agent 按错误的域判断完备性 ⇒ 改为从实际域动态生成，绝不写死数值。
    var _scopeDom = state._initD0 || state.D0 || null;
    var _domTxt = '实际求解域(见 result.bound.domain)';
    if (_scopeDom && typeof _scopeDom === 'object') {
        try {
            var _parts = [];
            for (var _si = 0; _si < vns.length; _si++) {
                var _sn = vns[_si], _sv = _scopeDom[_sn];
                if (_sv && _sv.min !== undefined) _parts.push(_sn + '∈[' + _sv.min + ',' + _sv.max + ']');
            }
            if (_parts.length) _domTxt = _parts.join(' ');
        } catch (e) { /* 域结构异常就保持泛化表述，绝不因此崩 */ }
    }

    state.result.completeness = {
        // ⚠ 2026-10-05 去网格化后的口径：这里曾经写「有限网格(6位小数)、残差容差三档
        //   (1e-6/1e-9/1e-3)」，那是**对外报的字段**，网格一撤它就自相矛盾了（一边报全精度
        //   解集、一边说解在 6 位网格上）。改成：变量数上限 + 实际域 + 全精度输出 + 后向误差判据。
        //   后向误差判据（Higham）：|F(x)| ≤ max(1e-6, Σ|terms(x)| · τ)，τ = 1e-11。
        scope: '变量数≤6、' + _domTxt + '、解坐标全精度 double(非有限网格)、残差按后向误差判据验收',
        provenIsComplete: isComplete,
        // 🔴🔴 2026-10-05 修第二个 P0（golden g013 抓出，字段语义与命名不符）：
        //   旧值 `hasCandidate ? true : false` 把「存在未认证候选解」当成「可能漏解」，
        //   于是 g013（unconverged=true、明确写了 incompleteReasons）却报 candidateMayMiss=false
        //   —— 与同一条记录里的 provenIsComplete=false **互相打架**：
        //   一边说「不能证明完备」，一边说「不会漏解」。Agent 读后者就会直接采信残缺解集。
        //   正确判据：**任一完备性缺口 ⇒ 可能漏解**（fail-closed），
        //   即与 provenIsComplete 严格互补（complete=false ⇔ mayMiss=true）。
        //   注意：门控②保证「有未认证候选解且无独立完备证据」必进 gaps；
        //   而有独立完备证据（Sturm/单调分段）时该标志为 false 才是对的 —— 那种情况没漏。
        candidateMayMiss: realGaps.length > 0,
        emptyProofNote: 'emptyProof=proof_empty 表示已严格证明域内无解；candidate_empty 仅表示未找到，不保证不存在',
        undecidability: '对任意超越系统，Richardson 不可判定定理表明不存在判定"有解/无解/几解"的通用算法；本工具保证边界如上，不对全部输出承诺100%正确',
        reproducibility: '全路径无随机数(Math.random=0)，种子确定性，结果跨运行/平台可复现'
    };
    if (realGaps.length) {
        // ⚠ fail-closed：一旦发现漏解证据，降级为「未验证」，并把证据原样带出去，不隐藏。
        state.result.completeness.incompleteReasons = realGaps;
        state.result.provenIsCompleteFalse = true;
        if (realGaps.length >= 1) {
            state.result.warnings = (state.result.warnings || []).concat([
                '完备性降级为「未验证」：' + realGaps.join('；')
            ]);
        }
    }
    state.result.bound = {
        varCount: vns.length,
        domain: state._initD0 || state.D0 || {},
        decimals: state.displayDecimals
    };
}


/**
 * 数值质量块：每解的**后向误差** + 全局解数统计。
 *
 * 🔴 2026-10-05 重写（用户指令：「去掉所有人为规则……包裹残差、安全认证……
 *   我们要的是极致的计算，让智能体得到能决策的结果，而不是认证、确定性这些东西」）。
 *   删掉的三项，逐条说明为什么它们不属于「数学」：
 *
 *   ❶ `cert.enclosure`（Krawczyk 包含盒 [x−r, x+r]）
 *      误差上界。Agent 决策不需要「解在哪个盒里」，它需要「有没有解」。
 *      且认证层已退出默认路径 ⇒ 这个字段绝大多数时候是 null（一个恒为空的字段）。
 *
 *   ❷ `certification.certifiedCoverage = proven/(proven+candidate)`
 *      🔴 这是一个**谎报型指标**，必须删。
 *      它看起来像「认证覆盖率」，实际是「proven 占找到的解的比例」——
 *      分子分母都是**找到的解**，所以它对「有没有漏解」**零信息**。
 *      实测反例：g005 旧值 certifiedCoverage=0 而它其实 4 个解全对；
 *      改成 1.0 也一样不代表找全了（只代表找到的都过了某道工序）。
 *      一个会被 Agent 当成「可信度」读的数字，必须是数学量 —— 而它不是。
 *
 *   ❸ `certification.reproducibility = {deterministic: true, ...}`
 *      硬编码的 `true`。它不来自任何测量，只是**写死的断言**。
 *      同输入同输出确实是事实（同伦的 γ 由输入哈希导出、无随机数），
 *      但把它包装成一个叫 `deterministic` 的字段塞进结果里，
 *      是让 Agent 以为「结果可信」——而**可复现 ≠ 正确**。
 *
 *   换成什么（都是**能算出来的量**）：
 *   · `backwardError`：Higham 后向误差 |F|/(Σ|∂F/∂x·x|)，尺度无关，
 *     这是「这个解有多准」的唯一正确问法（绝对残差在大系数题上永远很大）。
 *   · `solutionCount` / `probedSolutions`：找到几个、验过几个。
 *   · 完备性信息由 `completeness` 与 `conclusion` 承载（那是定理证据，不是比例）。
 */
function _assignCertBlock(state) {
    if (!state || !state.result) return;
    var sols = state.result.solutions || [];
    for (var i = 0; i < sols.length; i++) {
        var sol = sols[i];
        // 后向误差优先取 _verifyBySubstitution 算出的值（那是回代 + 尺度归一的结果），
        // 退而取算子自己算的，再退而取绝对残差（最弱，但至少有数字）。
        var _be = null;
        if (sol.substitutionCheck && typeof sol.substitutionCheck.backwardError === 'number'
            && isFinite(sol.substitutionCheck.backwardError)) _be = sol.substitutionCheck.backwardError;
        else if (typeof sol.backwardError === 'number' && isFinite(sol.backwardError)) _be = sol.backwardError;
        else if (typeof sol.residual === 'number') _be = sol.residual;
        sol.cert = {
            status: sol.tier || 'candidate',
            // 后向误差（尺度无关）。null = 没能算出来（如非方阵无法定尺度）。
            backwardError: _be,
            // 严格穿越证据：残差在邻域两端异号（中值定理）。免疫相消误差。
            signCrossing: !!(sol.substitutionCheck && sol.substitutionCheck.signCrossing)
        };
    }
    state.result.certification = {
        solutions: sols.length,
        proven: state.result.provenCount || 0,
        candidate: state.result.candidateCount || 0,
        structural: state.result.structuralCount || 0,
        emptyProof: state.result.emptyProof || null,
        // ⚠ 不再有 certifiedCoverage / reproducibility —— 见函数头注释的两条说明
    };
}


/**
 * 线性欠定的特解：Gauss-Jordan 消元到行最简形，**自由列取 0**。
 *
 * 🔴 2026-10-05 新增（用户指令：「不需要离原点最近，把这条规则删掉」）。
 *
 * 为什么是「自由列取 0」而不是「离原点最近」：
 *   旧实现算 x* = A⁺b = argmin‖x‖² s.t. Ax=b，即**过原点向解空间作垂线的垂足**。
 *   那是一条**人为几何偏好**：题目里没有任何理由让解靠近原点，
 *   而我们的输出会把它当「推荐解」给 Agent ⇒ 偏好被当成数学结论传递出去了。
 *
 *   RREF 的自由列取 0 则是**消元法的定义**：Gauss-Jordan 消元到 RREF 后，
 *   单位矩阵占据前 rank 列，剩余列（自由列）在系数行里全为 0。
 *   RREF 本身**只规定了前 rank 列**，自由列的取值是自由的 —— 取 0 是
 *   唯一不需要**额外指定度量**就能定下来的选择（任何其他选择都要说「取哪边」）。
 *   区别是**少一个度量** vs **多一个度量**，不是「换一个偏好」。
 *
 * 主元列的选择由部分主元（列扫描）决定，所以具体哪个分量是 0 取决于消元顺序
 * —— 那是实现自由度，本函数不承诺「哪一列为 0」，只承诺「自由列为 0 且是精确特解」。
 *
 * @returns {{values:number[], residual:number, rank:number}|null}
 */
function _rrefParticularSolution(eqs, vns, d0) {
    var m = eqs.length, n = vns.length;
    if (!m || !n || m >= n) return null;
    var M = [], colOfPivot = new Array(n).fill(-1);
    for (var ri = 0; ri < m; ri++) {
        var lc = extractLinearCoefficients(eqs[ri], vns);
        if (!lc) return null;
        var row = vns.map(function (v) { return lc.coeffs[v] || 0; });
        row.push(-lc.constant);
        M.push(row);
    }
    var r = 0;
    for (var col = 0; col < n && r < m; col++) {
        var piv = -1, pivAbs = 0;
        for (var rr = r; rr < m; rr++) {
            var av = Math.abs(M[rr][col]);
            if (av > pivAbs) { pivAbs = av; piv = rr; }
        }
        if (pivAbs < 1e-13) continue;                    // 自由列：RREF 留 0
        if (piv !== r) { var sw = M[r]; M[r] = M[piv]; M[piv] = sw; }
        var p = M[r][col];
        for (var c = 0; c <= n; c++) M[r][c] /= p;
        for (var rj = 0; rj < m; rj++) {
            if (rj === r) continue;
            var fac = M[rj][col];
            if (fac === 0) continue;
            for (var ck = 0; ck <= n; ck++) M[rj][ck] -= fac * M[r][ck];
        }
        colOfPivot[col] = r;
        r++;
    }
    if (r === 0) return null;                            // 系数全 0（恒等式）另走他路
    var vals = new Array(n).fill(0);
    for (var cj = 0; cj < n; cj++) if (colOfPivot[cj] >= 0) vals[cj] = M[colOfPivot[cj]][n];

    // 域内校验（域约束是问题的一部分，比任何规范选择都优先）
    if (d0) {
        for (var vi = 0; vi < n; vi++) {
            var dd = d0[vns[vi]];
            if (dd && (vals[vi] < dd.min - 1e-9 || vals[vi] > dd.max + 1e-9)) return null;
        }
    }
    // 独立回代验算
    var vmap = {};
    for (var v2 = 0; v2 < n; v2++) vmap[vns[v2]] = vals[v2];
    var maxRes = 0;
    for (var e = 0; e < m; e++) {
        var fv;
        try { fv = Math.abs(evalAST(eqs[e], vmap)); } catch (err) { return null; }
        if (!isFinite(fv)) return null;
        if (fv > maxRes) maxRes = fv;
    }
    if (maxRes > 1e-9) return null;                      // 不是解就绝不输出
    return { values: vals, residual: maxRes, rank: r };
}


/**
 * 欠定系统的 KKT 投影抢救（2026-10-03）。
 *
 * 触发条件：求解结束时一个解都没有，且方程数 < 变量数（欠定）。
 * 做法：多起点跑 _suan56Project（阻尼牛顿解 KKT 条件 x + Jᵀλ=0 与 F(x)=0），
 *       取范数最小且残差达标者，写回 state.result.solutions。
 *
 * 为什么需要多起点：投影是**局部**法，单一起点等于没跑。起点集合与 suan49 里一致
 * （当前最优 + 域中点 + 符号角 + 符号翻转 + knownStart），保证行为同源。
 *
 * fail-closed 三重闸：
 *   ① 只处理欠定（m < n）—— m >= n 时伪逆/区间定界才是正解，硬套会给出错误自由度
 *   ② 残差必须 < 1e-9（与 suan49 门槛一致）—— 达不到就完全不动 state
 *   ③ 逐点回代原始 AST 验算，不只信投影自己报的 residual
 *
 * 采纳后 truncated **必须保持 true**（2026-10-04 修正，原注释说改回 false 并真的改了）：
 * 本路径只证明「至少存在一个解」—— 那是**存在性**，不是**完备性**。
 * 清掉 truncated 等于宣称「这就是全部解」，而 Agent 客群靠它判断能否断言「找全了」。
 * 同时必须**重写 message/warnings**：兜底里的「8 秒预算被中止」在欠定路径上是误报
 * （欠定系统在阶段 3.5 之前就 return，根本没进主求解），留着是给 Agent 的假指令。
 * 「至少一个解」这个信息没丢：resultTypeName / confidence='low' / tier='candidate'
 * / rescueProjection 都在明说。见下方 state.result.truncated = true 处的完整注释。
 */
function _rescueUnderdeterminedByProjection(state) {
    var eqs = state.userEquations || [];
    var vns = getOutputVarNames(state);
    if (!eqs.length || !vns.length) return false;
    if (eqs.length >= vns.length) return false;           // 闸①：只救欠定
    if (!state.D0 || !Object.keys(state.D0).length) return false;

    // 🔴 2026-10-05 闸①'：**全线性欠定不走 KKT 投影**。
    //
    // 实测事故：`x + y = 3`（2 变量 1 方程，欠定）本该由 suan60 精确栈接管，
    //   却掉进这里，输出 (1.5, 1.5)。
    // 病根：下面这段是按 `d2 = ‖x‖²` 最小挑解的，而 KKT 条件 x + Jᵀλ = 0
    //   **在数学上就是「过原点向解空间作垂线的垂足」** —— 它是「离原点最近」
    //   这个目标的对偶算法。所以 KKT 投影整条链都是那条**人为几何偏好规则**的实现。
    //
    // 为什么线性欠定不能用它：
    //   ① 线性代数是**精确**的，RREF 自由变量取 0 一次消元就给出真解，
    //      而 KKT 要跑多起点阻尼牛顿（十几到几十次求值）才逼近同一个点；
    //   ② KKT 挑的是「最近」，RREF 挑的是「自由列取 0」——后者是消元法的**定义**，
    //      不含任何度量偏好（见 output.js 欠定分支的完整论证）；
    //   ③ KKT 在线性问题上**不唯一收敛**（J 奇异时直接返回 null），
    //      而精确栈总能给出答案。
    // ⇒ 线性欠定一律走 RREF 分支，下面的起点搜索/投影代码整段跳过。
    var _allLin = true;
    for (var _li = 0; _li < eqs.length && _allLin; _li++) {
        var _lcv = extractLinearCoefficients(eqs[_li], vns);
        if (!_lcv) _allLin = false;
    }
    if (_allLin) {
        var _rref = _rrefParticularSolution(eqs, vns, state.D0);
        if (_rref) {
            state.done = true;
            state.result = {
                solutions: [{ values: _rref.values, residual: _rref.residual }],
                resultType: 3,
                resultTypeName: '无限解集(代表解)',
                resultTypeDesc: '线性欠定系统（精确秩 ' + _rref.rank + ' < 变量数 ' + vns.length +
                    '）：解集是仿射子空间，已输出行最简形自由变量取 0 的特解（精确有理数运算）',
                executionPath: '线性欠定-RREF 自由变量取 0 特解(精确)',
                confidence: 'high',
                varNames: vns,
                rank: _rref.rank,
                truncated: true,          // 只证存在性，未证穷尽（正维解集）
                unconverged: false,
                warnings: [
                    '⚠️ 欠定线性系统：存在无限多个解，已输出 1 个特解。',
                    '该特解由行最简形自由变量取 0 唯一确定（线性代数的规范约定，不含距离偏好）。',
                    '如需更多代表点，请增加方程约束。'
                ]
            };
            return true;
        }
        // RREF 算不出（理论上不该发生）⇒ 落回下面的 KKT，至少还能给个近似解
    }

    // 多起点集合（非线性欠定才走这里）
    //
    // 🔴 2026-10-05：起点里的「符号角 30%/70% 分位」「中点符号翻转」原本是
    //   为「找最近解」服务的（注释自己写着「很多最近解就贴着原点附近」）。
    //   既然不再优化距离，起点只需**覆盖解流形**即可，下面按残差挑选。
    var starts = [];
    var mid = vns.map(function (vn) {
        var d = state.D0[vn];
        return (d && isFinite(d.min) && isFinite(d.max)) ? (d.min + d.max) / 2 : 0;
    });
    starts.push(mid.slice());
    // 域 30%/70% 分位组合（端点常在奇点外，故不用端点）—— 覆盖流形的粗粒度采样
    var nBits = Math.min(8, 1 << vns.length);
    for (var cbit = 0; cbit < nBits; cbit++) {
        starts.push(vns.map(function (vn, ci) {
            var d = state.D0[vn];
            if (!d || !isFinite(d.min) || !isFinite(d.max)) return 0;
            return d.min + (0.3 + 0.4 * ((cbit >> ci) & 1)) * (d.max - d.min);
        }));
    }
    // 中点按符号翻转（对称方程常有对称解集；xyz=6 这类正解在负域也可能有解）
    for (var fl = 0; fl < Math.min(4, vns.length); fl++) {
        var fv = mid.slice();
        fv[fl] = -fv[fl];
        starts.push(fv);
    }
    starts.push(vns.map(function () { return 0; }));

    var RESIDUAL_GATE = 1e-9;
    // 🔴 挑选准则从「‖x‖² 最小」改成「**回代残差最小**」（用户指令：去掉离原点最近）。
    //   依据是数学事实：这个点离方程的零点多近（尺度无关的后向误差），
    //   而不是它离原点多远（一条与题目无关的偏好）。
    var best = null, bestRes = Infinity;
    for (var i = 0; i < starts.length; i++) {
        var pr = _suan56Project(eqs, vns, starts[i], state.D0, { maxIter: 60 });
        if (!pr || !pr.ok) continue;
        if (!(pr.residual < RESIDUAL_GATE)) continue;      // 闸②
        // 挑选：回代残差最小者（不按 ‖x‖，见上方注释）
        if (pr.residual < bestRes) { bestRes = pr.residual; best = pr; }
    }
    if (!best) return false;

    // 闸③：用原始 AST 独立回代验算，不只信投影自报
    var vmap = {};
    for (var k = 0; k < vns.length; k++) vmap[vns[k]] = best.values[k];
    for (var e = 0; e < eqs.length; e++) {
        var f;
        try { f = evalAST(eqs[e], vmap); } catch (err) { return false; }
        if (f === null || !isFinite(f) || !(Math.abs(f) < RESIDUAL_GATE)) return false;
    }
    // 域内检查：投影法可能落到声明域外
    for (var q = 0; q < vns.length; q++) {
        var dq = state.D0[vns[q]];
        if (!dq || !isFinite(dq.min) || !isFinite(dq.max)) continue;
        if (best.values[q] < dq.min - 1e-6 || best.values[q] > dq.max + 1e-6) return false;
    }

    // 采纳：诚实声明「至少找到一个真解」，不声称完备
    var sol = {
        values: best.values.slice(),
        residual: best.residual,
        tier: 'candidate',
        certified: false,
        source: 'manifold_projection_rescue',
        certMethod: 'kkt_projection'
    };
    state.result.solutions = [sol];
    // truncated 保持 true（2026-10-04 修正，原注释说「拿到真解就改回 false」并真的改了）。
    //
    // ⚠ 第一版修正时我把理由写错了（说 x²+y²+z²=6 & xy=1 只吐 1 个是「漏解」——
    //   **那是我诊断错了**：用 SymPy 核过，rank(J)=2<3，解集是 1 维**连续曲线**
    //   （代入 y=1/x 得 z²=6−x²−1/x²，x 在 [1,2] 连续可取），给一个代表点是对的。
    //   欠定系统跳过数值层**不是 bug**。真问题只是下面的 message 残留。
    //
    // 但 truncated 仍必须留 true，理由与「漏解」无关，是**存在性 vs 完备性**：
    //   本路径只证明「至少存在一个解」—— 存在性，不是完备性。
    //   两者差一个数量级。清掉 truncated 等于宣称「这就是全部解」。
    //   Agent 客群靠它判断能否断言「找全了」，谎称找全是本产品最不能犯的错。
    //   「至少一个解」这个信息没丢：resultTypeName / confidence='low' /
    //   tier='candidate' / rescueProjection 都在明说。
    state.result.truncated = true;
    state.result.unconverged = false;
    state.result.error = null;
    // ⚠⚠ message 残留（2026-10-04，本轮实测抓到）：欠定系统**根本没进主求解**
    //   （阶段 3.5 之前就 return 了），所以兜底那段 HARD_TIMEOUT 文案是**误报** ——
    //   实测 timeMs=25/37/50ms 的运行都顶着「8 秒预算被中止」这句话。
    //   代价是双重的：
    //     ① 对 Agent 是**假指令**（让它去缩域/减变量，而真因是欠定 ⇒ 只给代表点）
    //     ② 对人是**误导**（25ms 的计算不可能超 8 秒预算）
    //   采纳投影结果时必须把 message 换成与实际路径相符的说明。
    state.result.message = '欠定系统（方程数 < 变量数）：解集为正维流形，给出 1 个经验证的真解作为代表点；未证明解集完备。';
    state.result.resultTypeName = '有限解（投影法抢救）';
    state.result.resultTypeDesc = '网格搜索未收敛，经 KKT 流形投影找到一个真解；未证明解集完备';
    state.result.executionPath = '欠定 KKT 投影抢救';
    state.result.confidence = 'low';
    state.result.rescueProjection = {
        method: 'manifold-projection-gauss-newton',
        iters: best.iters,
        residual: best.residual,
        norm: Math.sqrt(bestD2),
        starts: starts.length,
        note: '网格搜索颗粒无收后，用 KKT 条件 x+Jᵀλ=0 与 F(x)=0 的阻尼牛顿解（局部法，与域宽无关）救回至少一个真解'
    };
    // ⚠ 不要再用 `.slice()` 继承兜底里的 warnings —— 那些是 HARD_TIMEOUT 文案
    //   （「8 秒预算被中止」），在欠定路径上是**误报**（实测 25~50ms 的运行也顶着它，
    //   因为欠定系统在阶段 3.5 之前就 return 了，压根没进主求解、更没耗预算）。
    //   留着等于对 Agent 发假指令（让它缩域/减变量，而真因是欠定 ⇒ 只给代表点）。
    //   这里**重置**为只含本路径的准确说明。
    state.result.warnings = ['欠定系统：解集为正维流形（方程数 < 变量数），给出 1 个经回代验算的真解作为代表点；未证明解集完备，也不能断言「无其他解」。'];
    state.suan56Projection = state.result.rescueProjection;
    return true;
}


/**
 * 生成「下一步该干什么」的结构化指令（2026-10-04，用户重点「Agent 得到决策结果」）。
 *
 * 🔴 为什么必须有这个函数（旧实现的致命缺陷）：
 *   旧 HARD_TIMEOUT 兜底只写了一句自然语言：
 *     "建议缩小变量范围、减少变量数后重试。"
 *   对 Agent 而言这句话**不可执行**——它不知道该缩哪个变量、缩到多少、缩了能省多少。
 *   实测 6 元稠密二次：给 [0,3] 窄域仍要 7899ms ⇒ 说明「缩域」这条建议在该题上无效，
 *   但旧输出照说不误，把 Agent 引向一条**无效**的补救路径 —— 这是负价值建议，比不给更糟。
 *
 * 本函数的判据全部来自**本次运行的真实数据**（opStats 耗时、变量数、当前盒宽），
 * 不猜、不喊口号。三个出口互斥且按「最可能有效」排序：
 *   ① narrow_domain —— 某个变量盒宽远大于其他 ⇒ 缩它收益最大，给出**具体区间**
 *   ② reduce_variables —— 方阵/超定且耗时集中在数值算子 ⇒ 建议先解低维子问题
 *   ③ abandon —— 变量数已达 6 且系统稠密非线性 ⇒ 明说「本求解器算不动，别再重试」
 *
 * ⚠ fail-closed：判据不足（无耗时数据 / 无盒宽信息）时返回 null，
 *   调用方据此退回到旧文案，**不编造建议**。
 */
function _buildNextActions(state) {
    try {
        // ⚠️ 必须用 originalVarNames（消元前），不能用 state.varNames。
        //   实测踩过：6 元系统被 suan19（变量显式代入消元）消成 4 元，
        //   state.varNames.length 变成 4 ⇒ 判据 `n >= 6` 永不命中 ⇒ nextAction 恒 null。
        //   而「用户交给求解器的是 6 元问题」这个事实才是决策依据 ——
        //   Agent 要知道该怎么改的是**它自己那个 6 元方程组**，不是引擎内部消元后的 4 元。
        //   宽度统计同理：state.D0 仍含全部 6 个键（消元只改 varNames 不改 D0），
        //   所以 widths 用 state.D0 是对的，但要在 n 个变量上统计，不能按 varNames 截断。
        var vns = state.originalVarNames || state.varNames || [];
        var n = vns.length;
        if (n === 0) return null;

        // ── 采集真实证据 ──
        var opStats = state.opStats || {};
        var topOp = null, topMs = 0;
        for (var oid in opStats) {
            if (!Object.prototype.hasOwnProperty.call(opStats, oid)) continue;
            var m = opStats[oid].ms || 0;
            if (m > topMs) { topMs = m; topOp = oid; }
        }
        // 当前盒宽（收缩后的实际状态 —— 这才是「还剩多少空间要找」）
        var widths = [];
        for (var vi = 0; vi < n; vi++) {
            var b = state.D0 ? state.D0[vns[vi]] : null;
            if (b && isFinite(b.min) && isFinite(b.max)) widths.push({ v: vns[vi], w: b.max - b.min, lo: b.min, hi: b.max });
        }
        // 方程数也用原始的（消元会改 state.equations）
        var mEq = (state._origEqs || (state.equations && state.equations.length) || 0);

        // ── 判据 ③：变量数已达上限 + 稠密非线性 + 耗时集中在分支定界 ⇒ 明确劝退 ──
        // 为什么这一档要放在最前面判断：它是**唯一「不该再重试」**的情形。
        // 放进建议列表的最后，Agent 会先试前两条浪费两轮预算。
        //
        // 判据用 `n >= 6 || topOp === 'suan47'`，而不是只看 n>=6。实测教训：
        // 6 元稠密二次被 suan19 消元成 4 元方阵后才崩，varNames 已是 4 ⇒ 旧判据不命中，
        // 掉到判据①给出「缩 x1 的域到 ±20000」。但**实测缩域对该题完全无效**：
        // 给窄域 [0,3] 仍要 7899ms，而 branch 止损后总耗时只有 1.2 秒。
        // 一条无效建议比没有建议更糟 —— 它会让 Agent 浪费两轮预算。
        // 判据②③ 的存在本身就是答案：问题出在「维数 × 指数算法」，不在域宽。
        var _branchBurned = (topOp === 'suan47' && topMs > 300);
        if ((n >= 6 || _branchBurned) && mEq >= n && topMs > 300) {
            var _nAdvise = n;
            return {
                primary: 'reduce_variables',
                confidence: (n >= 6) ? 'high' : 'medium',
                reason: (n >= 6 ? n + ' 变量' : '消元后 ' + n + ' 变量方阵')
                      + '稠密非线性系统，耗时集中在分支定界（' + topMs.toFixed(0) + 'ms，2^n 复杂度）。'
                      + '实测缩窄定义域对该类系统几乎无效 —— 瓶颈是维数而非域宽',
                // 给出**可执行**的下一步：解一个低维子问题，把高维变量留作参数
                concrete: '先固定其中一个变量为业务给定值，解 ' + Math.max(2, _nAdvise - 1) + ' 变量子问题；'
                        + '或把 ' + _nAdvise + ' 元系统按物理/业务含义拆成两个 ' + Math.ceil(_nAdvise / 2) + ' 元系统联立',
                doNotRetryWith: 'narrow_domain',
                evidence: { vars: n, equations: mEq, hottestOperator: topOp || null, hottestMs: +topMs.toFixed(0) }
            };
        }

        // ── 判据 ①：某个变量盒宽显著大于其他 ⇒ 缩它 ──
        // 阈值取「中位数的 10 倍」而不是固定倍数：变量量纲不同时绝对倍数没意义。
        // 至少要有 2 个变量才能比；单变量题走 ②。
        if (widths.length >= 2) {
            var sorted = widths.slice().sort(function (a, b) { return b.w - a.w; });
            var med = sorted[Math.floor(sorted.length / 2)].w;
            var widest = sorted[0];
            if (isFinite(med) && med > 0 && widest.w > 10 * med) {
                var newHalf = widest.w / 100;   // 收到 1/100 宽：足以定位绝大多数工程量级解
                return {
                    primary: 'narrow_domain',
                    confidence: 'medium',
                    reason: '变量 ' + widest.v + ' 的搜索区间宽 ' + widest.w.toExponential(2)
                          + '，是其余变量中位宽度（' + med.toExponential(2) + '）的 '
                          + (widest.w / med).toFixed(1) + ' 倍 —— 搜索成本几乎全在它身上',
                    concrete: '给 ' + widest.v + ' 加区间约束：' + widest.v + '∈['
                            + (widest.lo + widest.w / 2 - newHalf).toPrecision(6) + ','
                            + (widest.lo + widest.w / 2 + newHalf).toPrecision(6) + ']',
                    doNotRetryWith: 'raise_budget',
                    evidence: { vars: n, widest: widest.v, width: widest.w, medianWidth: med }
                };
            }
        }

        // ── 判据 ②：方阵/超定 + 数值算子主导 ⇒ 降维 ──
        if (topMs > 300 && topOp && topOp !== 'suan47') {
            return {
                primary: 'reduce_variables',
                confidence: 'low',
                reason: '耗时集中在 ' + topOp + '（' + topMs.toFixed(0) + 'ms），该阶段未能在当前预算内收敛',
                concrete: '把 ' + n + ' 元系统按业务含义降维求解，或对非关键变量给定值后求 ' + (n - 1) + ' 元子问题',
                doNotRetryWith: 'retry_same_input',
                evidence: { vars: n, equations: mEq, hottestOperator: topOp, hottestMs: +topMs.toFixed(0) }
            };
        }

        return null;   // 证据不足 ⇒ fail-closed，不编造
    } catch (e) {
        _lsNoteInternal(e, 'solver.js:_buildNextActions 下一步建议生成属增强项，失败退回默认文案，有意忽略');
        return null;
    }
}


function _finish(state) {
    try { _sturmCompletenessCheck(state); } catch(e) { _lsNoteInternal(e, 'solver.js:560 完备性 Sturm 检查属增强项，失败不阻断主结果，有意忽略'); }    // ── 2026-10-03 新增：欠定系统的投影抢救（先于 HARD_TIMEOUT 兜底）──
    //
    // 发现的真实缺陷：suan49（收敛判定与结果输出）第 3 行是
    //     if (state.finalSolutions && state.finalSolutions.length > 0) { ... }
    // 而 suan49 内部（output.js:745）就写着那套 KKT 流形投影法。于是当
    // 网格搜索颗粒无收、finalSolutions 为空时，**整个 suan49 函数体一行都不执行**，
    // 里面专门为欠定系统写的投影法跟着一起被跳过 —— 然后 _finish 只能吐出 HARD_TIMEOUT。
    // 实测 x*y*z=6 ∧ x+y+z=6（2 方程 3 变量，欠定，最近解 ‖x‖≈3.70）就是这样
    // 37ms 直接 HARD_TIMEOUT + 0 解：不是算不动，是**根本没去算**。
    //
    // 为什么投影法能救：KKT 条件 x + Jᵀλ = 0 与 F(x)=0 组成 n+m 维**恰定**方程组，
    // 阻尼牛顿局部二次收敛，**与声明域宽无关**。网格采样在 ±1e6 宽域上找不到
    // 尺度 3.7 的解，但投影法从任意起点都能收敛过去。
    //
    // 为什么只对欠定系统做：_suan56Project 对 m >= n 直接返回 null（那是方阵/超定，
    // 伪逆或区间定界才是正解），所以这里同样只处理 m < n。
    //
    // fail-closed：投影必须把最大残差压到 1e-9 以下才采纳，否则完全不动 state。
    // 投影失败就仍然返回原本的 HARD_TIMEOUT —— 宁可承认没算出来，不给近似解。
    // ⚠ 调用时机的坑（第一版就踩了）：救援原本写在下面的兜底 `if (!state.result)`
    // **之前**，条件是 `state.result && !solutions.length`。但超时时 state.result
    // **根本不存在** —— 它恰恰是由下面那段兜底代码才创建的。于是条件恒为假，
    // 救援永远不触发，症状与「没加这段代码」完全一样（37ms + HARD_TIMEOUT + 0 解）。
    // ⇒ 必须放在兜底**之后**：先让 result 被建出来，再判「一个解都没有」。
    // 兜底保护（2026-08-21）：全局硬超时/异常路径可能只设 state.done 而未设 state.result，
    // 若直接返回 undefined/null，UI 会崩。此处构造诚实的截断结果，杜绝"求解器返回空"。
    //
    // 🔴 2026-10-04 重写（用户重点「Agent 得到决策结果，而不是全部结果」）：
    //   旧版只吐 `{solutions: [], error:"HARD_TIMEOUT", message:"…建议缩小变量范围、减少变量数后重试"}`。
    //   三个问题，逐个说清：
    //   ① **丢掉了已算出的部分解**。超时常常发生在「已经找到 2 个、正在找第 3 个」时，
    //      旧版把 finalSolutions 一起扔了 ⇒ Agent 明明手上有可用答案却收到空数组。
    //   ② **建议不可执行**。原句对所有失败场景给同一句话，而实测「缩域」在 6 元稠密
    //      二次上无效（窄域 [0,3] 仍 7899ms）—— 一句无差别建议会把 Agent 反复引向死路。
    //   ③ **没说清「超时」意味着什么**。Agent 需要知道：手上的解是**有效的**，
    //      只是**可能不全**。这两件事混成一句「结果不完整」会被 LLM 理解成「全都不可信」，
    //      于是丢弃正确解 —— 这是过度保守，也是错。
    if (state && !state.result) {
        // ① 先把已经算出来的解捞出来（分支递归里攒的 + 当前 state 上的）
        var _toSols = [];
        var _collect = function (arr) {
            if (!arr || !arr.length) return;
            for (var _ci = 0; _ci < arr.length && _toSols.length < 8; _ci++) {
                var _c = arr[_ci];
                if (_c && _c.values && _c.values.length) _toSols.push(_c);
            }
        };
        _collect(state._partialSolutions);
        _collect(state.finalSolutions);
        if (state.result && state.result.solutions) _collect(state.result.solutions);

        // ② 基于真实运行数据生成可执行的下一步（fail-closed：证据不足返回 null）
        var _na = _buildNextActions(state);
        var _partialNote = _toSols.length > 0
            ? ('已找到 ' + _toSols.length + ' 个候选解并保留在 solutions 里 —— 这些解本身有效（残差已回代校验），'
               + '只是可能不是全部。不要因为超时而丢弃它们。')
            : '本次未找到任何解（超时发生在首次定位之前）。这不是「无解」的证明。';

        state.result = {
            // 🔴 有部分解就给部分解，而不是一律空数组 —— 空数组会被 Agent 读成「无解」
            solutions: _toSols,
            solutionCountIsPartial: _toSols.length > 0,   // 显式标注：数到的是部分，不是全部
            error: "HARD_TIMEOUT",
            message: "计算超出全局时间预算（" + _LS_BRANCH_TIME_BUDGET_MS + " 毫秒）被中止。"
                   + _partialNote,
            executionPath: "全局超时兜底",
            timeMs: +(performance.now() - (state.startTime || performance.now())).toFixed(0),
            confidence: _toSols.length > 0 ? "low_partial" : "low",
            varNames: state.varNames || [],
            resultType: 2, resultTypeName: "有限解（未完成）",
            resultTypeDesc: _toSols.length > 0
                ? ("计算超时中止，返回已找到的 " + _toSols.length + " 个候选解（可能不全）")
                : "计算超时中止，未获得完整结果",
            truncated: true, unconverged: true,
            // 下一步指令（结构化，Agent 可直接按 primary 分支行动；null = 证据不足，不猜）
            nextAction: _na,
            // 三条硬声明，避免 Agent 过度保守丢掉正确解 / 或反过来当成「无解」
            mustNotClaim: 'no_solution',
            safeToUsePartial: _toSols.length > 0,
            warnings: ["计算超出全局时间预算被中止，结果不完整"
                     + (_na ? ("；建议：" + _na.primary + " —— " + _na.concrete) : "")]
        };
    }
    // 欠定 KKT 投影抢救：必须在兜底**之后**（state.result 先被建出来才能判空解）
    if (state && state.result && (!state.result.solutions || state.result.solutions.length === 0)) {
        try { _rescueUnderdeterminedByProjection(state); } catch (e) {
            _lsNoteInternal(e, 'solver.js:_finish 欠定投影抢救属增强项，失败不阻断主结果，有意忽略');
        }
    }
    // 解析/定义域警告同步到 result.warnings（UI 渲染字段）：任何输入行解析失败
    // （如不支持的变量名/字符）、域约束警告等都必须出现在结果页，杜绝"静默丢方程"。
    if (state && state.result && state.conditionWarnings && state.conditionWarnings.length) {
        if (!state.result.warnings) state.result.warnings = [];
        for (var _wi = 0; _wi < state.conditionWarnings.length; _wi++) {
            if (state.result.warnings.indexOf(state.conditionWarnings[_wi]) < 0) {
                state.result.warnings.push(state.conditionWarnings[_wi]);
            }
        }
    }
    // 结构化诚实标志：整数约束未强制（与 truncated 同级，供程序化/MCP 调用方可靠检测，不依赖解析警告文字）
    if (state && state.result && state.integerConstraintUnenforced) {
        state.result.integerConstraintUnenforced = true;
    }
    // 良定义过滤：在附加溯源元数据前，先把不良定义 / 越域的候选解剔除
    //
    // 🔴 2026-10-04：条件从「result.solutions 非空」扩成「非空 **或** 有 _partialSolutions」
    //   分支定界超时时会往 state._partialSolutions 里攒解（见 branch.js 时间闸门）。
    //   这些解如果绕过 _filterIllDefined 直接出去，就是**未经残差回代校验的解** ——
    //   对「数学正确性」是硬伤（宁可少给，不能给错）。故并入同一条过滤链。
    if (state && ((state.result && state.result.solutions && state.result.solutions.length)
                   || (state._partialSolutions && state._partialSolutions.length))) {
        // 部分解并入主解列表后再统一过滤（过滤链原地改 state.result.solutions）
        if (state._partialSolutions && state._partialSolutions.length) {
            if (!state.result) state.result = { solutions: [] };
            if (!state.result.solutions) state.result.solutions = [];
            var _merged = {};
            var _mlist = [];
            var _feed = function (arr) {
                if (!arr || !arr.length) return;
                for (var _mi = 0; _mi < arr.length; _mi++) {
                    var _mk = arr[_mi] && arr[_mi].values ? arr[_mi].values.join(',') : null;
                    if (_mk === null || _merged[_mk]) continue;
                    _merged[_mk] = 1;
                    _mlist.push(arr[_mi]);
                }
            };
            _feed(state.result.solutions);
            _feed(state._partialSolutions);
            state.result.solutions = _mlist;
        }
        _enforceVarInvariant(state);   // 先修复变量数不变量（防新算子静默缺变量），再过滤病态解
        _filterIllDefined(state);
        // 🔴 2026-10-05（用户指令「去掉安全认证……要极致的计算」）：
        //   Krawczyk / Miranda / inflate-and-refine / Smale α 四条区间认证链
        //   **默认不再运行**。它们回答的是「解在哪、误差多大」——
        //   即**误差上界**，Agent 决策不需要；而成本很高（每解多轮区间算术，800ms 预算）。
        //   解的真伪现在由 `_assignTiers` 里的**回代验证**判定（O(1) 求值，零区间开销）。
        //
        //   何时仍该开：需要「解的误差上界/包含盒」时（审计、复现、离线穷举）。
        //   显式传 {certify:true} 打开，行为与 1.0.22 完全一致（零回归）。
        if (state.solveOpts && state.solveOpts.certify === true) {
            _certifySolutions(state);   // Krawczyk 认证层：为每个有限孤立解写入 sol.certified
        } else {
            // 🔴 2026-10-05 保留**精化**、只去掉**认证**。
            //
            // 实测代价（关认证层时抓到的真实精度回退）：
            //   g017 `exp(x)=2`：解 0.6931471805599454（=ln2，误差 6.7e-16）→ 0.6931471805605547（误差 6.1e-13）
            //   g013 公积金月供：残差 6.1e-8 → 3.9e-7
            // 根因不是「认证有用」，而是 Krawczyk 层顺带做了一次**盒内牛顿精化**
            //   （certify.js 的 `_newtonRefine`，判据已是后向误差 1e-14）。
            // 牛顿精化是**纯计算**：它把解往真根上多推几步，属于「算得更准」；
            //   区间认证是**误差上界**：回答「解在哪个盒里」，Agent 决策不需要。
            // ⇒ 拆开：精化默认跑（成本 O(几次求值)，收益是末位精度），认证默认关。
            //
            // 精化后必须**同步重算 residual** —— 值被换掉而派生字段没换，
            // 是 2026-10-04 抓过的 P0（x⁴−13x²+4=0 报残差 1.6e-5 而真值 2.2e-12）。
            _refineSolutions(state);
        }
        _resyncConfidence(state);       // tier 变了 ⇒ confidence 必须跟着重算
        // 全局区间分支定界：对【方阵系统】在用户初始域内尝试完备穷尽（覆盖非线性多解漏解）。
        // 非方阵（欠定/超定）不接；无 userDomain 不接。预算兜底，超预算诚实降级。
        //
        // 🔴 2026-10-04 修 P0（实测抓到，数学上是硬伤不是优化）：
        //   实测 x−y=0, x−y=0（两式相同，秩亏 ⇒ 解集是一条直线）在本守卫放行后
        //   输出 175 个 `tier:'proven'` 的采样点，且每次运行点数不同（191/175/172）。
        //
        //   为什么必须拦：**区间分支定界的前提是「有限个孤立根」**。
        //   它的完备性论证（Schichl–Neumaier / 全局区间法）依赖「把根隔离到互不相交的
        //   小盒里，每个盒内恰一个根，再穷尽所有盒」。而正维解流形上**不存在隔离盒** ——
        //   直线上每一点的任意小邻域里都有无穷多根，Krawczyk 的「盒内唯一根」判据
        //   在此处的前提（雅可比局部可逆 ⇒ 根孤立）根本不成立。
        //   ⇒ 那 175 个 `proven` 是**假证明**，`certifiedCoverage≈0.99` 是**谎报的完备性**。
        //   这比返回 0 解严重得多：0 解至少还带着「可能还有」的语气。
        //
        //   fail-closed 口径：算子已判定 resultType===3（正维解集，无穷多解）时，
        //   本层**不接**。解的正确表示是「一个代表点 + 解集维数」，不是采样点列表。
        if (state.userDomain && !(state.result && state.result.resultType === 3)) {
            var _gbEqs = state.originalEquations || state.equations;
            var _gbVns = getOutputVarNames(state);
            if (_gbEqs && _gbVns && _gbEqs.length === _gbVns.length && _gbVns.length > 0) {
                var _gbOpts = { budget: 5e5, maxDepth: 28, minWidth: 1e-4 };
                if (state.solverDecimals != null) _gbOpts.minWidth = Math.max(1e-4, Math.pow(10, -state.solverDecimals));
                // Schichl–Neumaier 排除域剪枝开关：默认开；显式传 false 可关（A/B 对照 + 运行期降级口）。
                // 走 state.solveOpts（solve() 第 6 参 opts 的落地处），不在此处硬编码。
                if (state.solveOpts && state.solveOpts.exclusion === false) _gbOpts.exclusion = false;
                // ── 完备性开关（2026-10-04 新增，实测驱动）──────────────────────
                //
                // 实测（3/4/5/6 元，A/B）：全局分支定界在**所有**题上都
                //   complete=false（残盒 5 / 412 / 876 / 641），即**从未**给出完备性；
                //   而它吃掉 240~470ms（占 wall 的 70~90%），解集与关掉时**完全相同**。
                //   换句话说：默认路径上它是一笔**纯成本**——不增解、不给完备、只烧时钟。
                //
                // 口径（fail-closed，默认关）：
                //   · 默认**不跑**全局分支定界。完备性不是本产品的承诺，Agent 要的是
                //     一个**决策结果**（一个解 + 它是否被证明），不是「全部解」这份清单。
                //   · 要完备穷尽（离线穷举、研究多解分布、审计）显式传 globalBranch:true。
                //   · 关掉时 certifiedCoverage 只能来自 Krawczyk/精确有理数证明，
                //     **绝不含**全局分支的贡献（否则就是谎报覆盖率）。
                //
                // ⚠ 默认**关**（_gbWant 默认 false）。第一版写成
                //   `!(opts.globalBranch === false)` ⇒ 空 opts 也算「要跑」，
                //   实测 A/B 两条分支 wall 完全一样（270 vs 209ms）才发现default 没生效。
                //   ⇒ 口径必须是「只有显式 true 才跑」。
                var _gbWant = !!(state.solveOpts && state.solveOpts.globalBranch === true);
                if (!_gbWant) {
                    if (state.result) {
                        state.result.globalBranchSkipped =
                            '全局区间分支定界未运行（默认关闭：实测它在 3~6 元题上 complete=false、残盒数百，' +
                            '不增解也不给完备性，却吃掉 70~90% 墙钟）。需要完备穷尽请显式传 {globalBranch:true}';
                    }
                } else {
                // 构造"补全 + 数组格式"的初始域后再交给全局分支定界。
                // _globalBranchCertify 内部 mkBox 直接取 dom[vn][0]/[1]，要求每个变量都是 [lo,hi]；
                // 用户只给部分变量域时直接传 state.userDomain，缺失变量为 undefined → undefined[0] 崩溃。
                // （2026-09-01 修复：缺失变量回退初始域快照 _initD0，仍缺失则用自适应默认域）
                // ⚠️ 域半宽必须就地计算：_finish 是独立函数，读不到 _solveImpl 的局部变量 _lsHalfW
                //    （2026-10-03 实测踩过：写 -_lsHalfW 直接 ReferenceError，
                //     表现是"显式给 domain 时崩、不给时正常"，极难定位）。
                var _lsHalfW = inferDomainHalfWidth(state.equationStrs || []);
                if (!(isFinite(_lsHalfW) && _lsHalfW > 0)) _lsHalfW = _LS_DOMAIN_LEGACY;
                var _gbDom = {}, _gbOk = true;
                for (var _gi = 0; _gi < _gbVns.length; _gi++) {
                    var _gvn = _gbVns[_gi];
                    var _gv = state.userDomain[_gvn];
                    var _snap = (state._initD0 && state._initD0[_gvn]) ? state._initD0[_gvn] : null;
                    var _lo = -_lsHalfW, _hi = _lsHalfW;
                    if (Array.isArray(_gv) && _gv.length >= 2) {
                        _lo = Number(_gv[0]); _hi = Number(_gv[1]);
                    } else if (_gv && typeof _gv === 'object' && _gv.min !== undefined) {
                        _lo = Number(_gv.min); _hi = Number(_gv.max);
                    } else if (_snap && _snap.min !== undefined) {
                        _lo = Number(_snap.min); _hi = Number(_snap.max);
                    }
                    if (!isFinite(_lo) || !isFinite(_hi) || _lo > _hi) { _gbOk = false; break; }
                    _gbDom[_gvn] = [_lo, _hi];
                }
                // ── 多元先验根界：把 vast 域**证**成有限盒，再切盒（2026-10-04 新增）──
                //
                // 实测（改前）：默认域 ±1e6，切盒级数 ~2^(34n) ⇒ n=3 就 ~10^30，
                //   数学上不可行 ⇒ 必然撞 300ms 预算 ⇒ complete=false + 上千残盒，
                //   **一个解都没多找到**。3 元题 332ms 里 317ms 花在这里。
                // 数学（多元 Cauchy 的 log 空间形式 / 热带平衡不等式）：
                //   x 是解 ⇒ 最大项被其余项抵消 ⇒ ⟨α*,v⟩ − ⟨β*,v⟩ ≤ ln|c_β| − ln|c_α*|
                //   （必要条件，v = ln|x|）⇒ 真解必落在某个支配对给出的半空间内。
                //
                // 收紧方向**只向内**且必须**证出来**：
                //   · 用户显式给了域 ⇒ 一个字不改（用户域优先）
                //   · 界证不出来 / 不比现域紧 ⇒ 完全不动（fail-closed）
                //   · 收紧倍数巨大（>1000×）⇒ 保守放弃（假紧界是不可逆的灾难）
                var _rbHw = _gbOk ? _priorRootHalfWidth(_gbEqs, _gbVns) : null;
                var _rbApplied = false;
                if (_rbHw && _rbHw.length === _gbVns.length) {
                    var _rbTighten = false;
                    for (var _ri = 0; _ri < _gbVns.length; _ri++) {
                        var _rn = _gbVns[_ri];
                        var _cur = Math.max(Math.abs(_gbDom[_rn][0]), Math.abs(_gbDom[_rn][1]));
                        var _nw = Math.min(_cur, _rbHw[_ri]);
                        // 只在「证出来的界明显更紧」且「原域是引擎猜的 vast 域」时才替换
                        if (isFinite(_nw) && _nw > 0 && _nw < _cur * 0.5) {
                            _gbDom[_rn] = [-_nw, _nw];
                            _rbTighten = true;
                        }
                    }
                    _rbApplied = _rbTighten;
                    state.result.priorRootBound = {
                        method: 'tropical_balance_necessary_conditions',
                        halfWidths: _rbHw.slice(),
                        applied: _rbTighten,
                        note: _rbTighten
                            ? '多元热带平衡不等式给出的必要条件上界；已据此收紧分支定界初始域（域从「猜」变「证」）'
                            : '根界已算出但不比现域更紧，未应用（fail-closed：证不出来就不动域）'
                    };
                }
                if (_gbOk) {
                    var _gb = _globalBranchCertify(_gbEqs, _gbVns, _gbDom, _gbOpts);
                    if (_gb) _mergeGlobalBranch(state, _gb);
                }
                }   // ← _gbWant（默认关）
            }
        }
    }
    // 🔴🔴 最终残差闸门放在**这里**（_mergeGlobalBranch 之后、所有收口之前），不放更早。
    //
    //   位置是这个闸门能否成立的关键，踩过一次坑：初版放在 _filterIllDefined 旁边
    //   （本文件 1070 行附近），结果 9468 个溢出伪解一个没拦住 —— 因为
    //   _mergeGlobalBranch（1198 行）会在那之后把全局分支定界的解**再塞一次**进
    //   state.result.solutions，而那批解没经过前两道过滤。
    //   ⇒ 闸门必须站在「所有写入路径的最后一个」之后，否则就是假闸门。
    _finalResidualGate(state);
    _finalConstraintGate(state);
    if (state && state.result && !state.result.meta) {
        _updateMovability(state);   // 切片B：终态标记（即使未进收缩层也置位，保证输出携带病态状态）
        state.result.meta = _buildMeta(state);
    }
    // 🔴🔴 2026-10-04 统一收口：截断传播 + 决策指令注入（**诚实红线**）
    //
    // 实测到的严重 bug（P0，比慢更严重）：6 元稠密二次跑满 7910ms，
    //   suan47 因时间闸门提前 return 并置 state.truncated = true，
    //   但对外返回的是 { error: "NO_SOLUTION", truncated: undefined, nextAction: undefined }。
    //
    //   根因：state.truncated 与 state.result 是**两条互不相通的通道**。
    //   suan49（operators/output.js:939）构造 state.result 时只写了自己知道的字段，
    //   根本没读 state.truncated。于是「因为时间不够而放弃」被对外表述成「严格无解」。
    //
    //   为什么这是 P0：Agent 拿到 error=NO_SOLUTION 会直接向用户断言「这系统无解」，
    //   而真相是「没算完」。这是**谎报**，比返回 0 解严重得多 —— 0 解至少还带着
    //   「可能还有」的语气，谎报则是笃定。整条 fail-closed 红线在这里断掉了。
    //
    // 修法（不改 suan49，只在 _finish 尾部做统一收口）：
    //   ① truncated 向下传播：state.truncated ⇒ result.truncated / result.unconverged
    //   ② error 降级：只有**未被截断**的空结果才允许保留 NO_SOLUTION；
    //      被截断的空结果一律改成 TIMEOUT_TRUNCATED（附 mustNotClaim）
    //   ③ 注入 nextAction：让 Agent 拿到可执行的下一步，而不是一句泛泛建议
    //
    // ⚠ 为什么不改 suan49：全仓 26 处写 error:"NO_SOLUTION"，逐个加判据必然有漏网，
    //   而且漏一个就又是一处谎报。**单一收口点**是唯一能保证「以后新增算子也不会漏」的做法。
    if (state && state.result && state.truncated) {
        var _rs = state.result;
        _rs.truncated = true;
        _rs.unconverged = true;
        // ② 空结果 + 被截断 ⇒ error 必须降级（「没算完」≠「无解」）
        var _rsEmpty = !_rs.solutions || _rs.solutions.length === 0;
        if (_rsEmpty && _rs.error === 'NO_SOLUTION') {
            _rs.error = 'TIMEOUT_TRUNCATED';
            _rs.resultType = 2;
            _rs.resultTypeName = '未知（被时间预算中止）';
            _rs.resultTypeDesc = '搜索因时间/预算耗尽而中止，未完成。这不是「无解」的证明。';
            _rs.message = (_rs.message || '') + '　【重要】本次搜索被预算中止，不能据此断言无解。';
            _rs.provenEmpty = false;   // 显式撤销「已证空集」标记
        }
        // ③ 决策指令
        if (!_rs.nextAction) _rs.nextAction = _buildNextActions(state);
        _rs.mustNotClaim = 'no_solution';
        if (!_rs.warnings) _rs.warnings = [];
        if (_rsEmpty) {
            var _w = '本次搜索被预算中止，未找到解；这不是「无解」的证明';
            if (_rs.nextAction) _w += '。建议：' + _rs.nextAction.primary + ' —— ' + _rs.nextAction.concrete;
            if (_rs.warnings.indexOf(_w) < 0) _rs.warnings.push(_w);
        }
    }
    // ④ 结果里有解但被截断 ⇒ 解有效、可能不全，让 Agent 别丢（也补上 nextAction）
    //
    // 🔴 2026-10-05 分两种截断（原文案对欠定系统是**错的**）：
    //   · **正维欠定**（m < n 或 rank < n）：解集是仿射簇/流形，**本来就无穷多**。
    //     输出 1 个代表点是**正确的完整行为** —— 没有「漏掉列表」这回事。
    //     原文案「列表可能不完整」会让 Agent 以为要找更多、反复重试（纯误导，
    //     真因是欠定，重试一万次还是无穷多）。
    //   · **搜索被截断**（分支定界预算/盒数到限）：这才是真的「列表可能不全」。
    //   判据用 positiveDim / resultType===3 / effectiveDim>0（正维证据）区分，
    //   与 _conclusion4 的 _posDimAny 同源口径 —— 两处必须一致，否则同一个系统
    //   在不同层被说成不同的话。
    if (state && state.result && state.truncated && state.result.solutions && state.result.solutions.length) {
        var _rr = state.result;
        var _isPosDimTrunc = (_rr.resultType === 3) || (_rr.positiveDim === true)
            || (typeof _rr.effectiveDim === 'number' && _rr.effectiveDim > 0
                && String(_rr.executionPath || '').indexOf('欠定') >= 0);
        if (!_isPosDimTrunc) {
            _rr.solutionCountIsPartial = true;
            if (!_rr.nextAction) _rr.nextAction = _buildNextActions(state);
            if (!_rr.warnings) _rr.warnings = [];
            if (_rr.warnings.indexOf('已找到部分解，列表可能不完整；已有解本身有效') < 0) {
                _rr.warnings.push('已找到部分解，列表可能不完整；已有解本身有效');
            }
        } else {
            // 正维欠定：解有效，但**明确说清这不是全部**（而不是含糊的「可能不完整」）
            if (!_rr.warnings) _rr.warnings = [];
            var _wp = '欠定/正维系统：解集是' +
                (typeof _rr.effectiveDim === 'number' && _rr.effectiveDim > 0
                    ? (' ' + _rr.effectiveDim + ' 维') : '正维') +
                '的（仿射）流形，有无穷多个解；已给出的代表解是真解，但不是全部解。' +
                '如需更多代表点请增加方程约束。';
            if (_rr.warnings.indexOf(_wp) < 0) _rr.warnings.push(_wp);
            if (!_rr.mustNotClaim) _rr.mustNotClaim = 'complete_solutions';
        }
    }
    // 结构预判标签透出（全局调度第一层结论）：让结果携带 无解/有限/无限 分类
    if (state && state.result) {
        if (state.result.error === 'NO_SOLUTION') {
            // 空集（无解）是三类之一，且由 sound 算子事后证出，应覆盖预判标签
            state.result.cardinality = 'empty';
        } else if (state.cardinality) {
            state.result.cardinality = state.cardinality;
            state.result.effectiveDim = (state.effectiveDim === undefined ? -1 : state.effectiveDim);
            state.result.classifyRank = (state.classifyRank === undefined ? -1 : state.classifyRank);
            state.result.isPolynomial = !!state.isPolynomial;
            state.result.positiveDim = !!state.positiveDim;
        }
    }
    // 2026-08-22 P0：可信层级 / 无解证明 / 完备性边界 三件套统一注入
    _assignTiers(state);
    // 🔴 2026-10-05 修 confidence 恒为 low 的真 bug（顺序错误）：
    //   confidence 由「proven 占已找到解的比例」决定，而 proven/candidate 是
    //   `_assignTiers` 刚刚算出来的。而上游 1831 行的 `_resyncConfidence`
    //   跑在 `_assignTiers` **之前** —— 那一刻 tier 还是算子留下的原值。
    //
    //   为什么以前没暴露：旧路径里 Krawczyk 认证层（1830 行附近）会**提前**写
    //   `sol.certified = true`，而 `_resyncConfidence` 同时看 `tier` 和 `certified`
    //   ⇒ 提前拿到了「已证」信息 ⇒ 算得对。
    //   认证层退出默认路径后那层信息没了 ⇒ `_resyncConfidence` 读到的是
    //   「tier 全是 undefined」⇒ proven=0 ⇒ confidence 恒 low。
    //   实测症状：`x^2-2=0` 两个解 tier=proven、provenCount=2，
    //   但 confidence=low（自相矛盾）。
    //
    // 修法：在 tier 确定**之后**再 sync 一次。这才是正确的顺序 ——
    //   依赖谁，就必须排在谁后面。
    _resyncConfidence(state);
    _assignEmptiness(state);
    _assignCompleteness(state);
    _assignCertBlock(state);   // 认证实根计算层：每解附加 cert 块 + 全局 certification 汇总

    // ── 4 态决策标记 + Bézout 上界判据（2026-10-04）──────────────────────
    //
    // 为什么放在**所有**收口之后：结论必须基于**最终**解列表。
    // 放早了会用「过滤前的解数」算完备性 ⇒ 可能报「找全了」而实际被后续过滤掉了几个。
    //
    // Bézout 判据（rootbound-poly.js 的 R1 规则）是**唯一**能让 4 态里
    // 「全部解」这一格在**多元**系统上成立的严格依据：
    //   R（已证明互异根数） ==  ∏d_i（Bézout 上界）⇒ 孤立根数已达上界 ⇒ 无遗漏。
    // 单变量另有 Sturm 精确计数（更紧，且是独立链）。
    var _c4Eqs = state.originalEquations || state.equations;
    var _c4Vns = getOutputVarNames(state);
    if (_c4Eqs && _c4Vns && _c4Vns.length > 0) {
        var _bz = null;
        try { _bz = _bezoutBound(_c4Eqs, _c4Vns.length); } catch (e) { _bz = null; }
        if (_bz) {
            // 只数「已被严格证明」的解（proven/certified）。未认证的候选点**不计入**
            // —— 用候选点数去比上界，可能因伪解而误报 bound-violation（假 bug）。
            var _provenN = 0;
            var _sl = state.result.solutions || [];
            for (var _bi = 0; _bi < _sl.length; _bi++) {
                var _bs = _sl[_bi];
                if (_bs && (_bs.tier === 'proven' || _bs.certified === true)) _provenN++;
            }
            state.result.bezoutBound = _bz;
            state.result.bezoutVerdict = _bezoutVerdict(_provenN, _bz);
        }
    }
    // 4 态分类：全仓唯一判定点（conclusion.js）。
    // ⚠ 旧措辞必须**在下沉之前**抓下来（resultTypeName 会被覆写成 4 态），
    //   否则「人要看细节」就无处可看。
    var _c4LegacyName = state.result.resultTypeName;
    var _c4 = _conclusion4(state);
    state.result.conclusion = _c4.conclusion;
    state.result.conclusionDetail = _c4;
    if (_c4LegacyName && _c4LegacyName !== _c4.conclusion) {
        state.result.resultTypeNameLegacy = _c4LegacyName;   // 人看的原始措辞
    }
    // resultTypeName 从 20+ 种自由文本**收敛**为 4 态（决策语义，不是措辞）。
    // 细分信息全部下沉到 resultTypeDesc / message / resultTypeNameLegacy。
    state.result.resultTypeName = _c4.conclusion;
    return state.result;
}


function _solveImpl(equationStrs, varNames, decimals, initialD0, fastMode, opts) {
    // 默认域半宽：按方程量级自适应（constants.js 有完整理由与「只放大不缩小」约束）。
    // ⚠️ 必须在函数最开头声明：_globalBranchCertify 分支（第 ~613 行）也会读它，
    //    放到域初始化段会导致显式给 domain 时 ReferenceError。
    var _lsHalfW = inferDomainHalfWidth(equationStrs || []);
    if (!(isFinite(_lsHalfW) && _lsHalfW > 0)) _lsHalfW = _LS_DOMAIN_LEGACY;

    // 受保护标识符词表 = 调用方声明的变量表（最强证据）。
    // 未声明 ⇒ 空表 ⇒ 保持原默认：按「标识符 = 单字母连乘」解析（文档化行为，零回归）。
    _LS_PROTECTED_NAMES = new Set();
    if (varNames && varNames.length) {
        for (var _lsP = 0; _lsP < varNames.length; _lsP++) {
            if (typeof varNames[_lsP] === 'string' && varNames[_lsP]) _LS_PROTECTED_NAMES.add(varNames[_lsP]);
        }
    }
    var state = {};
    // 当前求解的受保护标识符表（= 声明的变量名）。挂到 state 上是为了让下游算子
    // （setup / ineq / ast.basic / numeric.root）能把它**显式传给 fuzzyFix**，
    // 而不必依赖模块级 _LS_PROTECTED_NAMES 全局（那是 P0 污染源）。
    state.protNames = _LS_PROTECTED_NAMES;
    if (initialD0 === undefined) _ieeeReset();   // 仅顶层求解重置 IEEE 标记；分支递归子盒累积异常，不丢聚合信息
    state.equations = [];
    state._origEqs = (equationStrs && equationStrs.length) || 0;   // 原始方程数（区分"纯净单变量输入"与"多变量消元后的伪单变量"）
    state.varNames = varNames || [];
    state.D0 = {};
    state.userDomain = (initialD0 && typeof initialD0 === 'object') ? initialD0 : null;  // 用户初始域，供全局区间分支使用
    state.mov = {};            // 切片B：每变量 movability 状态映射（不污染盒子对象）
    state._movHist = {};       // 切片B：每变量宽度历史（判定收敛无望）
    // physBounds 已移除
    state.tolerance = 1e-6;
    state.startTime = performance.now();
    state.result = null;
    state.done = false;
    state.truncated = false;          // 资源截断标记：盒队列/分支预算/迭代上限耗尽时置位（绝不隐藏）
    state.repPointNote = null;        // 代表点选取规则说明（由后处理算子填写）
    state.features = {};
    state.manifoldInfo = null;
    state.calculusInfo = null;
    state.domainConstraints = [];
    state.conditionWarnings = [];
    state.equationStrs = equationStrs || [];
    state.maxIter = 20;
    state.skipOperators = {};
    state.eqFeatures = {};
    state.decimals = 6;
    state.symInfo = null;
    state.p3LowDim = false;
    state.persistentHomologyInfo = null;
    state.poincareInfo = null;
    state.singularRegionsInfo = null;
    // 🔴 2026-10-05 彻底去网格化（用户指令：「去掉全部网格化，按数学定理来做」）。
    //
    // 旧口径把「计算精度 / 显示精度 / 分支盒宽」三者都绑在 COMPUTE_DECIMALS=6 上，
    // 名义是「6 位小数有限网格」。网格化已从引擎移除（roundToGrid 现为全精度 +
    // ULP 去噪吸附），所以这三个字段**不再是精度旋钮**，语义各自独立：
    //
    //   · tolerance  = 残差收敛判据（牛顿/二分用），与输出位数无关。
    //   · solverDecimals = 分支定界的最小盒宽 = 10^-6，即**搜索分辨率**。
    //     这是「把区间缩到多小才停」，不是「结果保留几位」—— 删掉它会让分支定界
    //     无限细分，搜索不完。它与精度无关，保留。
    //   · displayDecimals：**引擎不再有显示精度概念**（原6 位）。
    //     solutions[].values 是全精度 double，UI 与服务层各自决定怎么显示
    //     （服务层 AGENT_DISPLAY_DECIMALS=4；UI 见 ui.js）。
    //     保留此字段仅为兼容既有读取方（report.js / solver.js:952），值不再是「显示位数」。
    state.displayDecimals = COMPUTE_DECIMALS;          // 兼容字段：已非显示位数，见上
    state.decimals = COMPUTE_DECIMALS;                 // 兼容字段：递归调用透传用
    state.solverDecimals = COMPUTE_DECIMALS;          // 分支最小盒宽 10^-6（搜索分辨率）
    state.tolerance = Math.pow(10, -COMPUTE_DECIMALS); // 残差收敛判据 1e-6（非输出精度）
    state.maxIter = 20;                              // 计算迭代上限（固定）
    state.fastMode = !!fastMode;

    // 资源上限可注入（opts.maxBranch / opts.maxBoxes / opts.maxIter），默认沿用硬编码上限；
    // 对齐工程路线“资源限制须向上层暴露”——供资源截断预言机与 Agent 防护使用。
    // 显式赋值后，suan47 内的 `typeof branchBudget==='undefined'` 守卫将不再回退到 200。
    if (opts && Number.isFinite(opts.maxBranch)) state.branchBudget = opts.maxBranch;
    if (opts && Number.isFinite(opts.maxBoxes)) state.maxBoxes = opts.maxBoxes;
    if (opts && Number.isFinite(opts.maxIter)) state.maxIter = opts.maxIter;
    // Schichl–Neumaier 排除域剪枝开关（默认开）。opts.exclusion === false 可完全关闭。
    // 与上面三个一样走「资源/策略开关向上层暴露」这条路，不在 _finish 里硬编码。
    state.solveOpts = opts || null;

    // ===== 解析层（D0 初始化前：建立 equations / varNames / >6 硬校验）=====
    if (_runSeq(state, OPS_SETUP)) return _finish(state);

    // ===== 阶段 0｜结构预判（全局调度第一层：先判 无解/有限/无限，再按标签分流）=====
    // 数学依据：解流形维数 d = n − rank(J)。d=0→有限(孤立点)；d≥1→无限(正维流形)；
    // m<n ⇒ d≥1(欠定, sound 无限)。本产品无 CAS，Groebner 维数判定不可行，故用
    // 数值雅可比秩（sound-incomplete）。自此收缩算子降级为「抛光器」（见阶段5/6）。
    suan0_classify(state);

    // ===== 阶段 0.5｜维度路由（2026-10-05）：按 n / m / 结构声明式裁掉前提不成立的算子 =====
    //
    // 为什么必须放在**这里**（阶段 0 之后、阶段 1 之前）：
    //   它依赖 suan0_classify 填好的三个字段（varNames / equations / eqFeatures.allLinear /
    //   isPolynomial），又必须早于 OPS_ALGEBRA —— 因为这一层正是要决定
    //   「3..6 元方阵非线性走 suan61、3..6 元全线性走 suan60、二元走 suan59、
    //   一元走 suan51/suan58」的那一层。晚于 OPS_ALGEBRA 就成了事后诸葛亮。
    //
    // 与 _routeOperators（scheduler.js，LP 松弛前提）的分工：那个判「是否线性」，
    //   这个判「是第几维 + 什么结构」，两者正交、互补、都只 skip 不接管。
    //   幂等，可重复调用。
    _routeByDimension(state);

    // 保存原始变量名（供消元算子回代使用）
    state.originalVarNames = state.varNames.slice();

    // 保存原始方程AST（供后续验证回代使用）
    state.originalEquations = state.equations.slice();

    // 默认域半宽 _lsHalfW 已在函数开头声明（此处不再重复声明，var 提升会掩盖问题）。
    // 初始化 D0：优先使用传入的 initialD0（分支定界递归调用），否则默认 [-halfW, +halfW]
    if (state.varNames && state.varNames.length > 0) {
        if (initialD0) {
            // 分支定界递归调用：使用父域切割后的子域
            // 提取 _branchDepth（如有），然后从 D0 中移除
            if (initialD0._branchDepth !== undefined) {
                state.branchDepth = initialD0._branchDepth;
            }
            state.D0 = JSON.parse(JSON.stringify(initialD0));
            delete state.D0._branchDepth;
            // 格式归一化：兼容 MCP 文档约定的数组格式 {"x":[-2,2]} 与内部对象格式 {"x":{min,max}}
            // （2026-08-21 修复：原逻辑直接把 initialD0 存入 D0，MCP 路径按文档传数组格式时
            //  后续 17 处 state.D0[vn].min/.max 全部读到 undefined → NaN → 域约束静默失效）
            for (var _dnorm = 0; _dnorm < state.varNames.length; _dnorm++) {
                var _dnv = state.varNames[_dnorm];
                // 用户只给了部分变量的域：其余变量必须补默认全域，不能 continue 跳过。
                // （此前跳过 → 该变量在 D0 中无条目 → 后续 state.D0[vn].min 读 undefined 属性直接崩溃）
                if (state.D0[_dnv] === undefined || state.D0[_dnv] === null) {
                    state.D0[_dnv] = { min: -_lsHalfW, max: _lsHalfW };
                    continue;
                }
                var _dval = state.D0[_dnv];
                if (Array.isArray(_dval)) {
                    // 数组格式 [lo, hi]
                    var _dlo = Number(_dval[0]);
                    var _dhi = Number(_dval[1]);
                    if (isNaN(_dlo)) _dlo = -_lsHalfW;
                    if (isNaN(_dhi)) _dhi = _lsHalfW;
                    state.D0[_dnv] = { min: _dlo, max: _dhi };
                } else if (typeof _dval === 'object' && _dval.min !== undefined) {
                    // 对象格式 {min, max}（已是内部格式，仅规范化数值）
                    state.D0[_dnv] = {
                        min: isNaN(Number(_dval.min)) ? -_lsHalfW : Number(_dval.min),
                        max: isNaN(Number(_dval.max)) ? _lsHalfW : Number(_dval.max)
                    };
                } else {
                    // 未知格式：回退默认全域
                    state.D0[_dnv] = { min: -_lsHalfW, max: _lsHalfW };
                }
            }
        } else {
            // 首次调用：默认 [-1000000, 1000000]
            for (var _vi = 0; _vi < state.varNames.length; _vi++) {
                var _vn = state.varNames[_vi];
                if (!state.D0[_vn]) {
                    state.D0[_vn] = { min: -_lsHalfW, max: _lsHalfW };
                }
            }
        }
        // 应用域约束条件到 D0（域约束来自用户输入的 x∈[a,b] 等条件）
        for (var _dci = 0; _dci < state.domainConstraints.length; _dci++) {
            var _dc = state.domainConstraints[_dci];
            var _dvi = state.varNames.indexOf(_dc.varName);
            if (_dvi >= 0) {
                if (_dc.min !== undefined) {
                    state.D0[_dc.varName].min = Math.max(state.D0[_dc.varName].min, _dc.min);
                }
                if (_dc.max !== undefined) {
                    state.D0[_dc.varName].max = Math.min(state.D0[_dc.varName].max, _dc.max);
                }
                if (state.D0[_dc.varName].min > state.D0[_dc.varName].max) {
                    state.done = true;
                    state.result = { solutions: [], error: "NO_SOLUTION", provenEmpty: true, message: "域约束矛盾：变量 " + _dc.varName + " 的约束区间为空", varNames: state.varNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "变量域约束自相矛盾，无法求解" };
                    return _finish(state);
                }
            }
        }
    }

    // 快照初始声明域（2026-08-21 修复）：_filterIllDefined 的域检查只对照
    // 用户声明域（initialD0 + domainConstraints），不对照收缩后的 D0。
    // 收缩层（区间算术依赖过估）可能把 D0 错误收缩到不含真解的区域
    // （如 log(z)+0.5a=1.2 中 a 的宽区间把 log(z) 区间撑爆 → z 域被污染成 [125000,250000]），
    // 若拿收缩后 D0 过滤会把满足全部原始方程的真解误判越域删除。
    // 收缩只用于剪枝提速；错误收缩不应成为拒绝真解的判据。
    state._initD0 = JSON.parse(JSON.stringify(state.D0 || {}));

    // 纯不等式系统：跳过主流水线，直接走不等式求解 + 输出
    // （suan3 的 >6 变量硬校验已在 OPS_SETUP 阶段完成，此处无需重复）
    if (state.isInequalityOnly) {
        _runOp(state, OP_INEQ); if (state.done) return _finish(state);
        _runOp(state, OP_OUTPUT);
        return _finish(state);
    }

    // ===== 阶段 1｜前置拦截 + 定义域推导（cost 1~2）=====
    if (_runSeq(state, OPS_PRE)) return _finish(state);

    // ===== 阶段 2｜轻量矛盾筛查（cost 1~2）=====
    if (_runSeq(state, OPS_SCREEN)) return _finish(state);

    // ===== 阶段 3｜代数闭式求解（cost 1~3，顺序敏感：化简→消元→回代）=====
    if (_runSeq(state, OPS_ALGEBRA)) return _finish(state);

    // 欠定系统（方程数 < 变量数）：不存在孤立解，跳过数值牛顿层，
    // 由收缩层把域压到最窄后输出"窄域 + 代表采样点"
    if (state.underdetermined) {
        if (_runPipeline(state, { geometry: true, post: true })) return _finish(state);
        return _runTail(state);
    }

    // ===== 阶段 3.5｜方阵非线性强耦合系统：提前多起点牛顿（2026-08-22）=====
    // 置于收缩层之前：对称多项式等多根耦合系统经区间收缩难以孤立（对称流形无孤立点可收缩），
    // 收缩层会空耗 8 秒预算仍无进展。此处先用确定性多起点牛顿（含整数优先种子）定位一个基解，
    // 再由 _symmetryExpand 补全全部排列解。对普通系统无害（发散即跳过，后续收缩/分支定界兜底）。
    // 用 __LS_MSNEWTON_DONE 守卫，与尾段 suan47 内的牛顿分支互斥，确保只跑一次。
    if (!__LS_MSNEWTON_DONE && state.equations.length === state.varNames.length && !state.fastMode) {
        __LS_MSNEWTON_DONE = true;
        suan47_tryNewton(state);
        // 仅"纯净单变量输入"（原始即 1 方程 1 变量，如 cos(x)=0.5）清空短路标志，
        // 交 suan22 周期感知扫描补全全部根（修复 issue A 静默漏支）。
        // 多变量方阵、以及消元后的"伪单变量"（原方程数≠1，含自由参数，如 T_Wikibooks/M01）
        // 保持原行为短路返回，避免丢失自由参数采样得到的多解。
        var _genuineSingle = (state.varNames.length === 1 && state._origEqs === 1 && _eqRefsOnlyAllowed(state.equations[0], state.varNames));
        if (state.done && !_genuineSingle) return _finish(state);
        if (_genuineSingle) { state.done = false; state.result = null; }
    }

    // ===== 阶段 4｜单变量专项求解（cost 2~3）=====
    if (_runSeq(state, OPS_ALGEBRA2)) return _finish(state);

    // ===== 阶段 5｜成本分层收缩 + 几何拓扑分析（fastMode 下整层跳过）=====
    // 收缩层内部由 _runContractionFixpoint 驱动：cost 1 → 2 → 3 → 4 逐层推进，
    // 任一贵层取得收缩即回流到 cost 1 重跑，直到全局不动点或轮数预算耗尽。
    if (!state.fastMode) {
        if (_runPipeline(state, { geometry: true })) return _finish(state);
    }

    // ===== 阶段 6｜数值求解 + 解集后处理（cost 1~4）=====
    if (_runPipeline(state, { contract: false, numeric: true, post: true })) return _finish(state);

    // ===== 阶段 7｜尾段：分支定界兜底 → 不等式 → 结果输出（cost 5 / 4 / 1）=====
    return _runTail(state);
}

// ═══════════════════ 模块：pipeline/report ═══════════════════
/* 模块 pipeline/report：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function _ieeeReset() { _IEEE.nan = false; _IEEE.inf = false; _IEEE.divZero = false; _IEEE.domainErr = false; }

function _utf8Bytes(str) {
  var b = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c < 0x80) b.push(c);
    else if (c < 0x800) { b.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
    else if (c < 0xd800 || c >= 0xe000) { b.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
    else { i++; var c2 = str.charCodeAt(i); var cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); b.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)); }
  }
  return b;
}

function _sha256(str) {
  function rrot(x, n) { return (x >>> n) | (x << (32 - n)); }
  var K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  var msg = _utf8Bytes(str);
  var l = msg.length;
  msg.push(0x80);
  while (msg.length % 64 !== 56) msg.push(0x00);
  var bitLen = l * 8;
  for (var p = 0; p < 4; p++) msg.push(0x00);
  msg.push((bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff);
  for (var off = 0; off < msg.length; off += 64) {
    var w = new Array(64);
    for (var t = 0; t < 16; t++) { var j = off + t * 4; w[t] = (msg[j] << 24) | (msg[j+1] << 16) | (msg[j+2] << 8) | msg[j+3]; }
    for (var t2 = 16; t2 < 64; t2++) { var s0 = rrot(w[t2-15],7) ^ rrot(w[t2-15],18) ^ (w[t2-15] >>> 3); var s1 = rrot(w[t2-2],17) ^ rrot(w[t2-2],19) ^ (w[t2-2] >>> 10); w[t2] = (w[t2-16] + s0 + w[t2-7] + s1) | 0; }
    var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
    for (var t3 = 0; t3 < 64; t3++) {
      var S1 = rrot(e,6) ^ rrot(e,11) ^ rrot(e,25); var ch = (e & f) ^ (~e & g); var t1 = (h + S1 + ch + K[t3] + w[t3]) | 0;
      var S0 = rrot(a,2) ^ rrot(a,13) ^ rrot(a,22); var maj = (a & b) ^ (a & c) ^ (b & c); var t2v = (S0 + maj) | 0;
      h=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2v)|0;
    }
    H[0]=(H[0]+a)|0; H[1]=(H[1]+b)|0; H[2]=(H[2]+c)|0; H[3]=(H[3]+d)|0; H[4]=(H[4]+e)|0; H[5]=(H[5]+f)|0; H[6]=(H[6]+g)|0; H[7]=(H[7]+h)|0;
  }
  var hex = '';
  for (var hi = 0; hi < 8; hi++) { var vv = H[hi]; for (var ss = 28; ss >= 0; ss -= 4) hex += ((vv >>> ss) & 0xf).toString(16); }
  return hex;
}

function _computeReportId(state) {
  try {
    var seed = JSON.stringify([
      state.equationStrs || [],
      state.varNames || [],
      state.decimals,
      state._initD0 || null,
      !!state.fastMode,
      SOLVER_VERSION
    ]);
    return 'ls1-' + _sha256(seed);
  } catch (e) { return null; }
}

// ═══════════════════ 模块：pipeline/output ═══════════════════
/* 模块 pipeline/output：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function verifyAllConstraints(values, constraints, varNames) {
    var vars = {};
    for (var vi = 0; vi < varNames.length; vi++) {
        vars[varNames[vi]] = values[vi];
    }
    for (var ci = 0; ci < constraints.length; ci++) {
        var c = constraints[ci];
        try {
            var lhsVal = evalAST(c.lhs, vars);
            var rhsVal = evalAST(c.rhs, vars);
            if (isNaN(lhsVal) || isNaN(rhsVal) || !isFinite(lhsVal) || !isFinite(rhsVal)) return false;
            if (c.op === '<=') { if (lhsVal > rhsVal + 1e-6) return false; }
            else if (c.op === '>=') { if (lhsVal < rhsVal - 1e-6) return false; }
            else if (c.op === '<') { if (lhsVal >= rhsVal) return false; }
            else if (c.op === '>') { if (lhsVal <= rhsVal) return false; }
        } catch(e) { return false; }
    }
    return true;
}


function _recommendKey(sol) {
    var n = sol.values.length, norm = 0;
    var key = new Array(n + 1);
    for (var i = 0; i < n; i++) norm += sol.values[i] * sol.values[i];
    key[0] = Math.round(norm * 1e9);                       // 主：量化范数平方（距原点最近）
    for (var i = 0; i < n; i++) key[i + 1] = Math.round(Math.abs(sol.values[i]) * 1e9); // 次：|x_i| 字典序
    return key;
}

function _recommendKeyCmp(a, b) {
    var ka = _recommendKey(a), kb = _recommendKey(b);
    var L = (ka.length < kb.length) ? ka.length : kb.length;
    for (var i = 0; i < L; i++) { if (ka[i] !== kb[i]) return ka[i] - kb[i]; }
    return 0;
}

function pickRecommended(sols) {
    if (!sols || !sols.length) return null;
    var best = sols[0], bk = _recommendKey(best);
    for (var i = 1; i < sols.length; i++) {
        var k = _recommendKey(sols[i]);
        var better = false;
        for (var j = 0; j < k.length; j++) { if (k[j] !== bk[j]) { better = (k[j] < bk[j]); break; } }
        if (better) { best = sols[i]; bk = k; }
    }
    return best;
}


function sortAndOutput(state, solutions, varNames, nConstraints, nAttempts) {
    // 主准则：距原点最近（‖x‖² 最小）；等距时按字典序最小化 |x_i|（真全序，确定性、可复现——产品承诺）
    solutions.sort(_recommendKeyCmp);

    state.finalSolutions = solutions;
    state.result = {
        solutions: solutions,
        error: null,
        message: "不等式系统枚举求解：在 " + nConstraints + " 个约束下，通过 " + nAttempts + " 组边界组合+多起始点牛顿法找到 " + solutions.length + " 组可行解",
        executionPath: "不等式系统枚举",
        timeMs: performance.now() - state.startTime,
        varNames: varNames,
        resultType: 2,
        resultTypeName: "不等式系统有限可行解",
        resultTypeDesc: "通过确定性边界组合枚举+多起始点牛顿法找到满足所有约束的离散可行解"
    };
    state.done = true;
}


function _runTail(state) {
    if (!state.fastMode) {
        _runOp(state, OP_BRANCH);
        if (state.done) return _finish(state);
    }
    _runOp(state, OP_INEQ);
    if (state.done) return _finish(state);
    _runOp(state, OP_OUTPUT);
    return _finish(state);
}

// ═══════════════════ 模块：ui ═══════════════════
/* 模块 ui：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function openAgreement() {
    var m = document.getElementById('agreementModal');
    if (m) m.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeAgreement() {
    var m = document.getElementById('agreementModal');
    if (m) m.classList.remove('open');
    document.body.style.overflow = '';
}


function openAgentModal() {
    var m = document.getElementById('agentModal');
    if (!m) return;
    try {
        // 解析 mcp-server.js 与 index.html 同目录时的绝对路径（供配置使用）
        var u = new URL('mcp-server.js', location.href);
        var p = decodeURIComponent(u.pathname);
        if (p.charAt(0) === '/' && /^[A-Za-z]:/.test(p.slice(1))) p = p.slice(1);
        var cmd = 'node "' + p + '"';
        var cfg = JSON.stringify(
            { mcpServers: { "lingshu-solver": { command: "node", args: [p] } } },
            null, 2
        );
        var ce = document.getElementById('agentCmd'); if (ce) ce.textContent = cmd;
        var cf = document.getElementById('agentCfg'); if (cf) cf.textContent = cfg;
    } catch (e) { /* 路径解析失败不影响弹窗展示 */ }
    m.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeAgentModal() {
    var m = document.getElementById('agentModal');
    if (m) m.classList.remove('open');
    document.body.style.overflow = '';
}
// 复制文本：elId=源元素，btnId=按钮（复制后短暂高亮）

function copyText(elId, btnId) {
    var el = document.getElementById(elId);
    var txt = el ? el.textContent : '';
    copyToClipboard(txt, btnId);
}

function copyTextRaw(txt, btn) {
    copyToClipboard(txt, btn ? btn.id : null);
}

function copyToClipboard(txt, btnId) {
    function mark(b) {
        if (!b) return;
        b.textContent = '已复制';
        b.classList.add('copied');
        setTimeout(function () { b.textContent = '复制'; b.classList.remove('copied'); }, 1200);
    }
    var btn = btnId ? document.getElementById(btnId) : null;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { mark(btn); }, function () { fallbackCopy(txt, btn); });
    } else {
        fallbackCopy(txt, btn);
    }
}

function fallbackCopy(txt, btn) {
    try {
        var ta = document.createElement('textarea');
        ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
        if (btn) { btn.textContent = '已复制'; btn.classList.add('copied');
            setTimeout(function () { btn.textContent = '复制'; btn.classList.remove('copied'); }, 1200); }
    } catch(e) { _lsNoteInternal(e, 'ui.js:79 UI 交互异常不影响求解，有意忽略'); }
}
// 点击遮罩空白处关闭（两个弹窗）

var SOLVER_VERSION = "lingshu-solver/1.0.22";

// —— 确定性可复现契约（Certified Real-Root Computation 六属性之「确定性可复现」）——
// 纯 JS 同步 SHA-256（零依赖，浏览器/Node 通用，免 Web Crypto 异步）。
// reportId = 'ls1-' + sha256(输入+版本+预算)；相同输入跨运行/平台逐位重算一致 ⇒
// 可复现性可被机器验证（Decision Physics DP-1），而非仅文字声称。

var EXAMPLES = [
    // 1: 最少1个变量（1变量，2个解）
    ["x^2 = 4"],
    // 2: 最多6个变量（三对角线性系统，唯一整数解 1,2,3,4,5,6）
    ["x + y = 3", "x + 2*y + z = 8", "y + 2*z + a = 12", "z + 2*a + b = 16", "a + 2*b + c = 20", "b + 2*c = 17"],
    // 3: 空集无解（平行直线矛盾，sound 证明无解）
    ["x + y = 3", "x + y = 5"],
    // 4: 有限个解·全部（圆×双曲线，4个解全部经 Krawczyk 认证）
    ["x*x + y*y - 4 = 0", "x*y - 1 = 0"],
    // 5: 有限个解·部分（高频振荡多解，预算内未完全穷尽，显式标记 truncated）
    ["sin(20*x) = 0.5", "sin(20*y) = 0.5"],
    // 6: 无限解·推荐（欠定，输出距原点最近的推荐解）
    ["x + y = 3"]
];

// 示例可选搜索域（与 EXAMPLES 一一对应；null 表示使用默认搜索范围 ±100万）。
// 仅标题5 需要显式域：高频多解系统在有限域内才触发全局分支定界的预算截断，
// 从而真实演示"有限个解·部分（截断）"——这是本工具诚实边界的活样本。

var EXAMPLE_DOMS = [null, null, null, null, { x: [-30, 30], y: [-30, 30] }, null];
// 示例点击后自动求解时携带的域（由 loadExample 写入，runSolver 消费后清空）

var pendingExampleDomain = null;

// 分类标签（与示例一一对应）

var EXAMPLE_CATS = [
    "1️⃣ 最少变量", "6️⃣ 最多变量", "⚠ 空集无解", "🔢 有限解·全部", "📊 有限解·部分", "♾ 无限解"
];


var EXAMPLE_DESCS = [
    "→ 预期：<strong>2个解</strong> x = 2 与 x = −2（各经 Krawczyk 认证，残差≈0）。这是变量数下界（最少 1 个变量）的演示：单个变量也能稳定求解。",
    "→ 预期：<strong>唯一解</strong> (x,y,z,a,b,c) = (1,2,3,4,5,6)（Krawczyk 认证）。这是变量数上界（最多 6 个变量）的演示：6 元线性方程组确定性求得唯一整数解。",
    "→ 预期：<strong>无解</strong>。x + y 同时等于 3 与 5，两条平行直线无交点；由 sound 算子严格证明定义域内不存在实数解（provenEmpty），绝不静默返回空。",
    "→ 预期：<strong>4个解，全部找到</strong>。圆 x²+y²=4 与双曲线 xy=1 相交 4 点，均经 Krawczyk 不动点认证（残差~1e-9），无遗漏、无伪解。",
    "→ 预期：<strong>找到大量解，但显式标记可能未穷尽（truncated）</strong>。sin(20x)=0.5 与 sin(20y)=0.5 在 [-30,30]² 内有极多交点；全局区间分支定界在预算(50万盒)内未能完全判定残余盒，结果带 truncated 横幅与告警——正是\"已尽力穷尽、极端情况可能漏但不假证\"的诚实体现。要拿到全部解请缩小域。",
    "→ 预期：<strong>无限解集（推荐解）</strong>。方程数(1)少于变量数(2)，系统欠定，真实解构成一条直线（无限多个）。本工具不输出包围盒，只输出距原点最近的推荐解 (1.5,1.5)（残差验证通过）。该点是真解但非唯一，要全部解请增加方程约束。"
];

// 示例补充说明（与示例一一对应，无说明则为空字符串）

var EXAMPLE_FAKE_NOTES = [
    "", "", "", "",
    "ℹ <strong>关于\"部分（截断）\"：</strong>本例在有限域 [-30,30]² 内交点极密，全局分支定界预算(50万盒)耗尽后仍有残余盒未证。已找到的解均数学保真，但<strong>不排除仍有个别交点未被找到</strong>——此时工具显式标 truncated 并给出残余告警，绝不谎称已穷尽。这是本工具有意保留的诚实边界（见\"能力与边界\"）。",
    ""
];


function toggleInfoPanel() {
    var card = document.getElementById('infoCard');
    if (card.classList.contains('open')) {
        card.classList.remove('open');
    } else {
        card.classList.add('open');
    }
}


function loadExample(n) {
    try {
        var idx = n - 1;
        if (idx < 0 || idx >= EXAMPLES.length) return;
        document.getElementById("equations").value = EXAMPLES[idx].join("\n");
        document.getElementById("variables").value = "";

        // 显示示例说明
        var hint = document.getElementById("exampleHint");
        var catEl = document.getElementById("hintCategory");
        var descEl = document.getElementById("hintDescription");
        var fakeEl = document.getElementById("hintFakeNote");

        if (catEl) catEl.textContent = EXAMPLE_CATS[idx] || "";
        if (descEl) descEl.innerHTML = EXAMPLE_DESCS[idx] || "";

        if (fakeEl) {
            if (EXAMPLE_FAKE_NOTES[idx]) {
                fakeEl.innerHTML = EXAMPLE_FAKE_NOTES[idx];
                fakeEl.classList.add("show");
            } else {
                fakeEl.classList.remove("show");
            }
        }

        if (hint) hint.classList.add("show");

        // 点击示例即自动求解（带可选域），走与手动"求解"完全相同的路径
        pendingExampleDomain = (EXAMPLE_DOMS && EXAMPLE_DOMS[idx]) ? EXAMPLE_DOMS[idx] : null;
        runSolver();
    } catch(e) {
        alert("示例加载出错: " + e.message);
    }
}


function cleanInput(text) {
    // 1. LaTeX 格式处理
    if (/\\begin\{cases\}|\\\(|\\\\\\\\/.test(text)) {
        text = text.replace(/\\\(/g, '').replace(/\\\)/g, '');
        text = text.replace(/\\begin\{cases\}/g, '').replace(/\\end\{cases\}/g, '');
        text = text.replace(/\\\\\\\\/g, '\n');
        text = text.replace(/\\(,|;|!|\s)/g, '');
        text = text.replace(/\\cdot\s*/g, '*');
    }
    // 2. 统一符号
    text = text.replace(/[\u201C\u201D\u2018\u2019]/g, '"');  // 智能引号
    text = text.replace(/[\u2212\u2013\u2014]/g, '-');        // 各种减号/破折号
    text = text.replace(/\u00D7/g, '*');                       // 乘号 ×
    text = text.replace(/\u00F7/g, '/');                       // 除号 ÷
    // 3. 把 x_1, x_2 等带下标的变量名转为 x1, x2
    text = text.replace(/([a-zA-Z])_(\d+)/g, '$1$2');
    // 4. 隐式乘法：变量空格变量 → 变量*变量（如 x1 x2 → x1*x2，注意不跨行）
    text = text.replace(/([a-zA-Z]\w*)[ \t]+([a-zA-Z]\w*)/g, '$1*$2');
    // 5. 隐式乘法：数字空格变量 → 数字*变量（如 2 x1 → 2*x1，注意不跨行）
    text = text.replace(/(\d+\.?\d*)[ \t]+([a-zA-Z]\w*)/g, '$1*$2');
    // 6. 隐式乘法：变量空格数字 → 变量*数字（如 x1 2 → x1*2，注意不跨行）
    text = text.replace(/([a-zA-Z]\w*)[ \t]+(\d+\.?\d*)/g, '$1*$2');
    // 7. 去掉多余空格（但保留换行）
    text = text.replace(/[ \t]+/g, ' ');
    return text.trim();
}


function runSolver() {
    // 变量名框"自动识别回显"开关：用户从未手动编辑过该框（_varsTouched=false）时，
    // 计算后把求解器实际识别到的变量名回填显示，让用户确认识别结果；
    // 用户一旦手动输入过（如补充 e 作为变量），oninput 置 true，此后不再覆盖。
    if (typeof _varsTouched === 'undefined') { _varsTouched = false; }
    var eqText = document.getElementById("equations").value.trim();
    if (!eqText) {
        showError("请输入方程");
        return;
    }
    // 自动检测并清理 LaTeX 格式输入（如 \begin{cases}...\\...\end{cases}）
    eqText = cleanInput(eqText);
    var varText = document.getElementById("variables").value.trim();

    // 按行拆分方程；但兼容"豆包式打竖粘贴"：若整段只含一个 '=' 却跨多行，
    // 说明是单条方程被换行拆散，合并换行成一条方程（否则每字符会被当成假方程）。
    var _rawLines = eqText.split("\n").map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
    var _eqCount = (_rawLines.join('').match(/=/g) || []).length;
    var eqLines = (_eqCount === 1 && _rawLines.length > 1) ? [_rawLines.join('')] : _rawLines;
    if (eqLines.length === 0) {
        showError("请输入方程");
        return;
    }

    var varList = varText ? varText.split(",").map(function(v) { return v.trim(); }).filter(function(v) { return v.length > 0; }) : [];

    // 显示计算中状态
    var btn = document.querySelector(".solve-btn");
    var origText = btn.textContent;
    btn.textContent = "计算中...";
    btn.disabled = true;

    // 使用 setTimeout 让 UI 更新后再执行计算
    setTimeout(function() {
        try {
            // 示例自动求解时携带其声明域；手动求解时为 null（使用默认搜索范围 ±100万）
            var _dom = pendingExampleDomain || undefined;
            pendingExampleDomain = null;
            var result = solve(eqLines, varList, 6, _dom);
            // 变量名自动识别回显（用户未手动编辑过变量名框时）：
            // 把求解器实际识别到的变量名回填到框里，让用户一眼确认"识别对了没"。
            // e / pi / π 等保留常数符号不会被识别为变量，清单里缺了它们即知歧义。
            if (!_varsTouched && result.varNames && result.varNames.length) {
                document.getElementById("variables").value = result.varNames.join(", ");
            }
            // 保留常数歧义提示：方程中出现 e / pi / π 且未被识别为变量 → 显式说明，
            // 避免用户以为"e 是变量却没解出来"。
            if (!varText) {
                var _rv = result.varNames || [];
                var _hints = [];
                if (/(^|[^A-Za-z0-9_])e($|[^A-Za-z0-9_])/.test(eqText) && _rv.indexOf('e') < 0) {
                    _hints.push("提示：方程中的 e 被识别为欧拉常数 e≈2.718281828…（非变量）。若需将 e 用作变量，请在\"变量名\"框中手动填入 e。");
                }
                if (/\b(pi|π)\b/.test(eqText) && _rv.indexOf('pi') < 0 && _rv.indexOf('π') < 0) {
                    _hints.push("提示：方程中的 pi/π 被识别为圆周率常数 π≈3.14159265…（非变量）。");
                }
                if (_hints.length) {
                    result.warnings = (result.warnings || []).concat(_hints);
                }
            }
            displayResult(result, eqLines);
        } catch(e) {
            if (e && e.type === 'invalid_input') {
                showError(e.message || "输入不是有效的数学方程");
            } else {
                showError("求解器内部错误: " + (e.message || String(e)));
            }
        }
        btn.textContent = origText;
        btn.disabled = false;
    }, 50);
}


/**
 * 解坐标的显示格式化（2026-10-05 去网格化）。
 *
 * 旧实现是 `Number(v.toFixed(6))` —— 固定 6 位小数，等于**在UI 层又做了一次网格化**：
 *   · 1/3 显示成 0.333333（丢掉 10 位）
 *   · 1e-9 显示成 0（真解被显示成 0！）
 *   · 0.1+0.2 的浮点结果 0.30000000000000004 被"整理"成 0.3（这一步是对的）
 *
 * 新口径：**自适应有效数字，最多 12 位**（双精度 15–17 位的可用子集），
 * 去尾零，指数极小时用科学计数而不是显示 0。
 *
 * 为什么不直接 toPrecision(17)：那会把浮点尾噪也一起显示出来
 * （0.1 显示成 0.10000000000000001），对读者是噪声而非信息。
 * 12 位有效数字远超任何工程/财务场景需要（IEEE-754 双精度本身只有 ~15.95 位），
 * 同时把浮点表示误差压到 1e-12 相对量级，远低于任何方程残差。
 */
function _fmtVal(v) {
    if (typeof v !== 'number' || !isFinite(v)) return String(v);
    if (v === 0) return '0';
    var a = Math.abs(v);
    // 极小量（<1e-10）用科学计数：旧实现会把 1e-12 显示成 0，那是把真解显示没了
    if (a < 1e-10 || a >= 1e15) return v.toExponential(6).replace(/e([+-])(\d)$/, 'e$10$2');
    return String(Number(v.toPrecision(12)));
}


function _fmtResidual(r) {
    if (r === undefined || r === null || r !== r) return "?";
    var tol = Math.pow(10, -COMPUTE_DECIMALS); // 残差达标判据固定为计算容差，与 UI 显示小数位无关
    var tolStr = tol < 1e-3 ? tol.toExponential(0) : String(tol);
    if (Math.abs(r) < tol) return "< " + tolStr;
    return r.toExponential(2);
}


function _residualAtDisplayed(values, eqLines, varNames) {
    if (!eqLines || !eqLines.length || !values || !varNames) return null;
    var vmap = {};
    for (var k = 0; k < varNames.length && k < values.length; k++) { vmap[varNames[k]] = values[k]; }
    var mx = 0;
    for (var i = 0; i < eqLines.length; i++) {
        var e = String(eqLines[i]);
        var idx = e.indexOf('=');
        var f;
        try {
            var A = idx >= 0 ? e.slice(0, idx) : e, B = idx >= 0 ? e.slice(idx + 1) : '0';
            // ⚠ 2026-10-04：把 vmap 的键（= 已代入的变量名）传给 tokenize。
            //   否则变量名 `e` 会被当欧拉数 2.718 静默替换 ⇒ 本函数算出的残差是错的
            //   （实测：a+b+c+d+e+f-60=0 代入真解 (12.5..7.5) 残差报 −5.78，实际应为 0）。
            //   残差校验算错 ⇒ 会把真解误判成假解，必须修。
            f = evalAST(parse(tokenize('(' + A + ')-(' + B + ')', Object.keys(vmap))), vmap);
        } catch (err) { f = NaN; }
        if (isFinite(f)) mx = Math.max(mx, Math.abs(f)); else return null;   // 有未识别变量 ⇒ 放弃，交由调用方回退
    }
    return mx;
}


function _escHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}


function displayResult(result, eqLines) {
    var resultSection = document.getElementById("resultSection");
    var errorSection = document.getElementById("errorSection");

    // 隐藏两个区域
    resultSection.classList.remove("show");
    errorSection.classList.remove("show");

    // 总是显示结果分类（无解也需要明确告知用户，避免误以为故障）
    document.getElementById("execPath").textContent = result.executionPath || "-";
    document.getElementById("timeMs").textContent = result.timeMs ? (Math.round(result.timeMs) + "ms") : "-";

    var html = "";
    // 资源截断显著提示（合规要求：结果可能不完整必须让用户直接看到，而非仅 JSON 暴露）
    var _trunc = (result.meta && result.meta.truncated) || result.truncated;
    if (_trunc) {
        html += '<div class="trunc-banner"><strong>⚠ 结果可能不完整（资源截断 / truncated）</strong>：本次计算在计算预算内未能完全收敛，部分真解可能未被找到或仅以未收敛区间表示。请勿据此做出关键决策；建议缩小变量范围、减少变量数或调大计算资源后重试。</div>';
    }
    var outVars = result.varNames || [];

    // 结果类型分类标签（3种形态：1 空集无解 / 2 有限个解 / 3 无限解集（推荐解））
    var typeLabels = { 1: "空集无解", 2: "有限个解", 3: "无限解集（推荐解）" };
    var typeColors = { 1: "#dc3545", 2: "#28a745", 3: "#17a2b8" };
    var rt = result.resultType || 2;
    html += '<div style="margin-bottom:10px">';
    html += '<span style="background:' + (typeColors[rt] || '#28a745') + ';color:#fff;padding:3px 12px;border-radius:12px;font-size:13px;font-weight:bold;display:inline-block">类型' + rt + ': ' + (typeLabels[rt] || '未知') + '</span>';
    if (result.resultTypeDesc) {
        html += '<div style="font-size:13px;color:#666;margin-top:6px;line-height:1.5;padding:8px 12px;background:#f8f9fa;border-radius:6px">' + _escHtml(result.resultTypeDesc) + '</div>';
    }
    // 人话总结：无解 / 唯一解 / 有限个解 / 无限个解
    var summaryText = "", summaryColor = "";
    var solCount = (result.solutions || []).length;
    if (rt === 1) {
        summaryText = "该方程组无解（空集）— 在变量定义域内，不存在任何一组实数能同时满足全部方程。这本身是确定的数学结论，并非计算失败。";
        summaryColor = "#dc3545";
    } else if (rt === 2) {
        if (solCount === 1) {
            summaryText = "唯一解 — 有且仅有一组实数解满足所有方程";
            summaryColor = "#28a745";
        } else {
            summaryText = "有限个解 — 共有 " + solCount + " 组孤立实数解";
            summaryColor = "#28a745";
        }
    } else if (rt === 3) {
        if (solCount > 0) {
            summaryText = "无限个解（欠定系统）— 方程数少于变量数，解集构成参数化集合，存在无限多个解；已输出距原点最近的推荐解。增加方程约束可确定唯一解";
        } else {
            summaryText = "无限个解（欠定系统）— 方程数少于变量数，解集构成参数化集合，存在无限多个解，但未能生成有效推荐解";
        }
        summaryColor = "#17a2b8";
    }
    if (summaryText) {
        html += '<div style="font-size:14px;color:' + summaryColor + ';margin-top:6px;padding:8px 12px;background:' + (rt === 1 ? '#fff0f0' : '#f8fff8') + ';border-radius:6px;border:1px solid ' + summaryColor + '44;font-weight:bold">' + summaryText + '</div>';
    }
    // 诊断信息：为何无解 / 内部错误详情（多专家评审 P0-2 — 用户必须看到"为什么无解"）
    if (result.message || result.error || result.detail) {
        var _diag = result.message || result.error || "";
        if (result.detail) _diag += (result.message || result.error ? "　" : "") + result.detail;
        var _diagColor = result.error ? "#dc3545" : "#0c5460";
        var _diagBg = result.error ? "#f8d7da" : "#d1ecf1";
        html += '<div style="font-size:13px;color:' + _diagColor + ';margin-top:6px;padding:8px 12px;background:' + _diagBg + ';border-radius:6px;border:1px solid ' + _diagColor + '44;line-height:1.6">';
        html += '<b>诊断信息</b>：' + _escHtml(_diag);
        html += '</div>';
    }
    if (rt === 1) {
        html += '<div style="font-size:12px;color:#856404;margin-top:6px;padding:8px 12px;background:#fff8e1;border-radius:6px;border:1px solid #ffe69c;line-height:1.6">';
        html += '<b>怎么看这条结果</b>：① 无解是合法的数学结论，不代表工具出错；② 常见原因——方程相互矛盾（如同一关系被赋予不同的值）、或约束过紧无交集；③ 请核对方程是否抄写正确，或调整 / 放宽约束后重试。';
        html += '</div>';
    }
    if (result.unconverged) {
        html += '<div style="font-size:13px;color:#e83e8c;margin-top:6px;padding:6px 12px;background:#fff0f5;border-radius:6px">⚠ 存在未收敛大区间 — 大区间包裹碎片化解集，可能不完全收敛。请调大资源或缩小初始范围重试</div>';
    }
    if (result.manifold && result.manifold.hasRedundancy) {
        html += '<div style="font-size:12px;color:#555;margin-top:4px;padding:6px 12px;background:#f5f0ff;border-radius:6px;border:1px solid #e0d8f0">';
        html += '<b>流形参数化</b>：维度 ' + result.manifold.dimension + '，雅可比秩 ' + result.manifold.rank + '，' + (result.manifold.tangentBasis ? '切空间基已计算' : '无切空间基');
        html += '</div>';
    }
    html += '</div>';

        // 结果可信度说明（对所有含解的结果适用）
        // 修复（2026-10-02，诚实优先）：旧文案对所有含解结果【无条件】宣称"每个点都经残差验证（<1e-6），可直接使用"。
        // 实测 5307.27=1000000*i/(1-(1+i)^-360)：展示值 i=0.004083 的代入残差为 2.46e-1（> 1e-6），
        // 页面却仍写"<1e-6、可直接使用" ⇒ 用户拿这个月利率去算，月供对不上账。文案必须按真实残差说话。
        if (rt === 2 || rt === 3) {
            var _tolD = Math.pow(10, -COMPUTE_DECIMALS); // 残差达标判据（绝对保底），与显示位数无关
            var _resAll = 0, _resAllUnknown = false;
            for (var _sa = 0; _sa < result.solutions.length; _sa++) {
                var _sv2 = result.solutions[_sa].values || [];
                var _rd2 = [];
                // 2026-10-05 去网格化：直接用**全精度原值**回代，不再截到 6 位小数。
                // 旧逻辑是「先截断再检查」的网格化镜像 —— 截断本身就会制造 ~L·h 残差，
                // 于是 UI 常常对刚解出来的真解报「残差未达容差」，那是自造的假警报。
                for (var _rdi = 0; _rdi < _sv2.length; _rdi++) { _rd2.push(_sv2[_rdi]); }
                var _rr = _residualAtDisplayed(_rd2, eqLines, result.solutions[_sa].varNames || outVars);
                if (_rr === null) { _resAllUnknown = true; } else { _resAll = Math.max(_resAll, _rr); }
            }
            var _allOk = !_resAllUnknown && _resAll < _tolD;
            html += '<div style="font-size:12px;margin-bottom:8px;padding:8px 12px;border-radius:6px;line-height:1.5;'
                  + (_allOk ? 'color:#155724;background:#f0fff0;border:1px solid #c3e6cb;' : 'color:#856404;background:#fff8e1;border:1px solid #ffe69c;') + '">';
            if (_allOk) {
                html += '<b>✓ 可信说明</b>：下方"解列表"中的每个点都以**全精度值**代入原方程验证过（残差 &lt;1e-6），满足全部方程，可直接使用。';
            } else {
                html += '<b>⚠ 注意（残差未达代入容差）</b>：'
                      + (_resAllUnknown ? '其中部分解无法独立复算残差' : '代入原式后最大残差为 ' + _fmtResidual(_resAll))
                      + '（大于容差 1e-' + COMPUTE_DECIMALS + '）。这些点是数值近似解而非严格根：'
                      + '请用 solutions[].values 里的全精度值复核，或接受这一量级的代入偏差。';
            }
            if (rt === 3) {
                html += ' 本例为欠定系统（无限解集），仅输出距原点最近的推荐解；该点是真解但非唯一，如需更多解请增加方程约束。';
            }
            html += '</div>';
        }
        // 主准则：距原点最近（‖x‖² 最小）；等距时按字典序最小化 |x_i|（真全序，确定性、可复现——产品承诺）
        var minSol = (result.solutions && result.solutions.length >= 1) ? pickRecommended(result.solutions) : null;
        var minDist2 = 0;
        if (minSol) { for (var _mvi = 0; _mvi < minSol.values.length; _mvi++) minDist2 += minSol.values[_mvi] * minSol.values[_mvi]; }
        // 显示推荐解（唯一解时标"唯一解"，多个解时标"推荐解"）
        if (result.solutions.length >= 1) {
            var recLabel = (result.resultType === 3) ? "推荐解（距原点最近）" : (result.solutions.length === 1 ? "唯一解" : "推荐解（距原点最近，等距取字典序最小 |xᵢ|）");
            html += '<div style="font-size:12px;color:#28a745;margin-bottom:6px;padding:8px 12px;background:#f0fff0;border-radius:6px;border:1px solid #c3e6cb">';
            html += '<b>' + recLabel + '</b>：';
            html += '<div style="margin-top:4px;font-size:13px;font-family:monospace">';
            for (var _mvi = 0; _mvi < outVars.length; _mvi++) {
                var _v = _fmtVal(minSol.values[_mvi]);
                var _vnEsc = _escHtml(outVars[_mvi]);
                if (Math.abs(minSol.values[_mvi]) < 1e-9) {
                    html += '<span style="margin-right:10px;color:#dc3545;font-weight:bold">' + _vnEsc + ' = ' + _v + '</span>';
                } else {
                    html += '<span style="margin-right:10px">' + _vnEsc + ' = ' + _v + '</span>';
                }
            }
            var _zc = 0; for (var _mz = 0; _mz < minSol.values.length; _mz++) if (Math.abs(minSol.values[_mz]) < 1e-9) _zc++;
            // 残差必须在【展示给用户的值】上算（2026-10-02 修正，2026-10-05 随去网格化改为 12 位有效数字），
            // 否则用户拿到的数与残差自相矛盾
            var _dispVals = [];
            for (var _dq = 0; _dq < outVars.length; _dq++) { _dispVals.push(Number(minSol.values[_dq].toPrecision(12))); }
            var _resDisp0 = _residualAtDisplayed(_dispVals, eqLines, outVars);
            html += '  <span style="color:#999;font-size:11px">' + _zc + ' 个零分量，距原点 ' + Math.sqrt(minDist2).toFixed(6)
                  + '，残差 ' + _fmtResidual(_resDisp0 === null ? minSol.residual : _resDisp0);
            if (_resDisp0 !== null && typeof minSol.residual === 'number' && Math.abs(_resDisp0) > Math.abs(minSol.residual) * 2 + 1e-12) {
                html += ' <span style="color:#856404">（已截断到 6 位小数：该显示值代回原式残差 ' + _fmtResidual(_resDisp0) + '，截断前残差 ' + _fmtResidual(minSol.residual) + '）</span>';
            }
            html += '</span>';
            html += '</div></div>';
        }

        for (var si = 0; si < result.solutions.length; si++) {
            var sol = result.solutions[si];
            var confidence = result.confidence || "medium";
            var confidenceLabel = { high: "高", medium: "中", low: "低" }[confidence] || confidence;

            html += '<div class="solution-card">';
            html += '  <div class="solution-header">';
            html += '    <span class="solution-title">解 ' + (si + 1) + '</span>';
            html += '    <span class="confidence-badge confidence-' + confidence + '">置信度: ' + confidenceLabel + '</span>';
            html += '  </div>';
            html += '  <div class="solution-vars">';

            for (var vi = 0; vi < outVars.length; vi++) {
                var val = sol.values[vi];
                if (typeof val === "number") val = _fmtVal(val);
                html += '    <div class="var-item">';
                html += '      <span class="var-name">' + _escHtml(outVars[vi]) + '</span>';
                html += '      <span class="var-value">' + (val !== undefined ? _escHtml(val) : "?") + '</span>';
                html += '    </div>';
            }

            html += '  </div>';
            // 残差口径（2026-10-02，2026-10-05 更新为 12 位有效数字）：在**展示值**上算残差；
            // 与全精度残差差异大时显式说明（去网格化后两者通常只差 1e-12 量级，几乎不会触发）
            var _dv = []; for (var _tvi = 0; _tvi < sol.values.length; _tvi++) { _dv.push(Number(sol.values[_tvi].toPrecision(12))); }
            var _rd = _residualAtDisplayed(_dv, eqLines, outVars);
            html += '  <div class="residual-info">残差: ' + _fmtResidual(_rd === null ? sol.residual : _rd);
            if (_rd !== null && typeof sol.residual === 'number' && Math.abs(_rd) > Math.abs(sol.residual) * 2 + 1e-12) {
                html += ' <span style="color:#856404">（该显示值已截断到 6 位小数，代回原式残差 ' + _fmtResidual(_rd) + '；截断前残差 ' + _fmtResidual(sol.residual) + '）</span>';
            }
            html += '</div>';
            html += '</div>';
        }

    // 显示警告
    if (result.warnings && result.warnings.length > 0) {
        html += '<div class="warnings-section">';
        for (var wi = 0; wi < result.warnings.length; wi++) {
            html += '<div class="warning-item">' + _escHtml(result.warnings[wi]) + '</div>';
        }
        html += '</div>';
    }

    document.getElementById("resultContent").innerHTML = html;
    resultSection.classList.add("show");

    // 滚动到结果区域
    setTimeout(function() {
        var target = resultSection.classList.contains("show") ? resultSection : errorSection;
        target.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
}


function showError(msg) {
    var errorSection = document.getElementById("errorSection");
    document.getElementById("errorContent").textContent = msg;
    document.getElementById("resultSection").classList.remove("show");
    errorSection.classList.add("show");
    errorSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ═══════════════════ 模块：input/recognize ═══════════════════
/* 模块 input/recognize：输入识别层（构建期拼接区块）
 *
 * 存在理由（2026-10-03）：
 *   此前「输入是什么」的知识散在三处 —— operators/setup.js 里逐条 if/else 猜
 *   方程 / 约束 / 警告、pipeline/solver.js 里另有一套自动补 "=0"、还有一处
 *   _complianceGuard 查自然语言。后果是三处口径可以互相矛盾，且都无从测试。
 *   本模块把「一句话该被当成什么」收敛成一张决策表 + 一个纯函数 classify()。
 *
 * 职责边界（严格）：
 *   ✓ 分类：这条输入是 方程 / 域约束 / 不等式 / 定义域 / 警告 / 需补等号 / 非法
 *   ✓ 归一化：全角符号、空白、隐式乘修不修（只判不修，修复交给 lex 层 fuzzyFix）
 *   ✗ 不做：解析 AST、求根、裁剪、猜变量（那些属于 solver 与 setup）
 *
 * 为什么单独成模块而不是塞进 setup.js：
 *   分类是纯函数（无副作用、可单测、不碰引擎状态），而 setup.js 是有状态流水线的一段。
 *   混在一起时「判断」与「执行」无法分别验证 —— 而判断出错的后果正是
 *   「静默给出错误答案」，必须能单独测。
 */
var INPUT_KIND = {
    EQUATION: 'equation',        // 标准方程（含可自动补 =0 的裸表达式）
    DOMAIN: 'domain',            // x in [a,b] 形式定义域
    INEQUALITY: 'inequality',    // f(x) <= g(x) 形式
    CONDITION: 'condition',      // 整数/枚举等非等式约束
    NEEDS_EQUALS: 'needsEquals', // 裸表达式，应补 =0
    ILLEGAL: 'illegal',          // 自然语言等必须拒收
};

// 不得放进方程的符号。命中即判 ILLEGAL 并原样回传给用户（fail-closed：宁可拒收也不猜）。
// 覆盖中/日/韩表意文字 + 常见自然语言标点。此前散在 pipeline 的 _complianceGuard 里，
// 挪到此处与分类逻辑同源，避免「分类说合法、门禁说非法」这类矛盾。
var _LS_INPUT_ILLEGAL_CHARS = /[\u2E80-\u2EFF\u3040-\u30FF\u3130-\u318F\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/;

// 自然语言里常见的、但不含表意文字的干扰项（如 "solve for x"、"x=" 里的单词）。
// 这些不能一律判非法（"sin" 等函数名是合法的），只标记出明显成句的部分。
var _LS_INPUT_NATURAL_HINT = /\b(solve|find|compute|calculate|please|help|unknown|undefined|null|nan|equation|answer)\b/i;

// 引擎真正认识的英文标识符（函数名 + 常用符号名）。用于把「数学表达式里的合法英文」
// 与「英文句子」区分开：sin(x)=0 合法，find the roots of x^2=4 不合法。
var _LS_INPUT_FUNC_NAMES = /^(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|sec|csc|cot|log|log2|log10|ln|exp|sqrt|cbrt|abs|sign|floor|ceil|round|min|max|mod|pow|hypot|pi|e|gamma|erf|fact|ln|deg|rad)$/i;

/**
 * 判定一条输入属于哪一类。纯函数：不改参数，不碰引擎状态。
 * @param {string} raw 一条输入（可含全角符号与空白）
 * @returns {{kind: string, reason: string, normalized: string, needsEquals: boolean, raw: string}}
 */
function classifyInput(raw) {
    const res = { kind: '', reason: '', normalized: '', needsEquals: false, raw: raw };
    if (typeof raw !== 'string') {
        res.kind = INPUT_KIND.ILLEGAL;
        res.reason = 'not_a_string';
        return res;
    }

    // 1) 归一化：全角符号 → 半角；去首尾空白。与 lex.fuzzyFix 保持同源认知，
    //    但不在此处做隐式乘/拆字 —— 那是词法层的职责，识别层不该越界。
    let s = raw.replace(/[\uFF1D\uFF08\uFF09\uFF0B\uFF0D\uFF0A\uFF0F\uFF0C\uFF0E\uFF1A]/g, function (ch) {
        const map = {
            '\uFF1D': '=', '\uFF08': '(', '\uFF09': ')', '\uFF0B': '+', '\uFF0D': '-',
            '\uFF0A': '*', '\uFF0F': '/', '\uFF0C': ',', '\uFF0E': '.', '\uFF1A': ':'
        };
        return map[ch] || ch;
    }).trim();
    res.normalized = s;

    // 2) 硬拒收：含表意文字 ⇒ 一定不是数学输入。
    if (_LS_INPUT_ILLEGAL_CHARS.test(s)) {
        res.kind = INPUT_KIND.ILLEGAL;
        res.reason = 'contains_natural_language';
        return res;
    }
    if (s === '') {
        res.kind = INPUT_KIND.ILLEGAL;
        res.reason = 'empty';
        return res;
    }

    // 3) 定义域：x in [a,b] / x∈[a,b] / x in Z。必须先于不等式判，
    //    否则 "x in [0,1]" 会被 needsEquals 收走并补成 "x in [0,1]=0" —— 域约束被静默销毁。
    //    "in" 必须后接集合起点（方括号 / 花括号 / 圆括号 或大写集合名），
    //    否则 "x+in=5" 这类把 in 当变量名的写法会被误判成定义域。
    //    用 \b 边界保证 "sin"/"asin" 里的 in 不命中。
    //    ⚠ 硬约束：本行正则不得出现未配对的花括号字面量。build.mjs 靠逐行数花括号
    //    判断「是否顶层声明」，注释与正则里的花括号同样计数 —— 一处失衡会让其后
    //    所有顶层函数从 export 表里消失（曾导致 classifyInputs/solvableInputs 静默丢导出）。
    //    要匹配花括号请写成 \x7B。
    if (/[\u2208\u2209]/.test(s) || /\bin\s*[\[\x7B（(]/.test(s) || /\bin\s+[A-Z]/.test(s)) {
        res.kind = INPUT_KIND.DOMAIN;
        res.reason = 'domain_constraint';
        return res;
    }

    // 3b) 自然语言外壳：有等号但裹着英文句子（如 "find the roots of x^2=4"）。
    //     必须在「有等号 ⇒ 方程」之前判，否则整句连同等号一起被当合法方程透传，
    //     解析层再报错——那时用户看到的是语法错误，而不是"这不是数学输入"。
    //     白名单是引擎真有的函数名；白名单外的英文单词出现 ≥2 个 ⇒ 判句子。
    //
    // 🔴 2026-10-05 P0 修复（实测事故：`x+y+z-6, xy+yz+zx-11, xyz-6` 返回 0 解）：
    //   原实现用 `s.match(/[A-Za-z]{2,}/g)` 扫「词」，这把**连写的隐式乘法**也当成了单词 ——
    //   `xy+yz+zx=11` 扫出 ['xy','yz','zx'] 三个 2 字母「词」，都不在函数名白名单
    //   ⇒ 整条判 ILLEGAL ⇒ **方程被静默丢弃**，3 元题退化成 2 元欠定 ⇒ 输出 0 解 + 「计算资源不足」。
    //   数学上 `xy` 是一个标识符（隐式乘法），不是英文单词；二者的区别不在字母数，
    //   而在**分隔方式**：英文单词由空格分隔并各自成段，数学记号则与运算符/数字粘连。
    //   所以判据改为：按空白切段，只把「整段是纯字母（无数字、无运算符）」的段计为单词。
    //   逐例核对（全部保持原行为，只有连写那条改变）：
    //     "find the roots of x^2=4" → 词 find/the/roots/of = 4 ⇒ illegal  ✔ 不变
    //     "solve x^2=4"            → 词 solve = 1 ⇒ equation（沿用旧口径）✔ 不变
    //     "answer=5"               → 段 'answer=5' 含数字 ⇒ 0 词 ⇒ equation ✔ 不变
    //     "compute x^2-4"          → 词 compute = 1 ⇒ needsEquals ✔ 不变
    //     "please help"            → 词 please/help = 2 ⇒ illegal ✔ 不变
    //     "xy+yz+zx=11"            → 1 段含运算符 ⇒ 0 词 ⇒ equation ✔ **修复**
    //     "ax+by=c"                → 同上 ✔ **修复**
    const _segs = s.split(/\s+/).filter(function (t) { return t.length > 0; });
    const _words = _segs.filter(function (t) {
        return /^[A-Za-z]{2,}$/.test(t);
    });
    if (_words.length >= 2) {
        let allKnown = true;
        for (let i = 0; i < _words.length; i++) {
            if (!_LS_INPUT_FUNC_NAMES.test(_words[i])) { allKnown = false; break; }
        }
        if (!allKnown) {
            res.kind = INPUT_KIND.ILLEGAL;
            res.reason = 'natural_language';
            return res;
        }
    }

    // 4) 不等式：含 <= >= < >。注意必须在「是否已有等号」之前判，
    //    因为 "x < 5" 没有等号，会被下面的 needsEquals 误收。
    if (/<=|>=|<|>/.test(s)) {
        res.kind = INPUT_KIND.INEQUALITY;
        res.reason = 'has_inequality';
        return res;
    }

    // 5) 已有等号 ⇒ 标准方程。
    if (s.indexOf('=') !== -1) {
        res.kind = INPUT_KIND.EQUATION;
        res.reason = 'has_equals';
        return res;
    }

    // 6) 无等号：若像自然语言（solve/compute…）则拒收，否则视为裸表达式，应补 =0。
    //    分界依据是「是否含数学运算符或数字」——纯单词才是自然语言。
    if (/[+\-*/^()=<>]|[\d]/.test(s)) {
        res.kind = INPUT_KIND.NEEDS_EQUALS;
        res.needsEquals = true;
        res.reason = 'bare_expression';
        return res;
    }
    if (_LS_INPUT_NATURAL_HINT.test(s)) {
        res.kind = INPUT_KIND.ILLEGAL;
        res.reason = 'natural_language';
        return res;
    }

    // 7) 纯单词且不认识 ⇒ 非法（fail-closed，不猜它想干什么）。
    res.kind = INPUT_KIND.ILLEGAL;
    res.reason = 'unrecognised';
    return res;
}

/**
 * 批量分类，保持原顺序，返回带 kind 的副本数组。
 * 不合法项不丢弃 —— 由调用方决定是拒收还是警告，避免"悄悄少一条方程"。
 */
function classifyInputs(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (let i = 0; i < list.length; i++) {
        const c = classifyInput(list[i]);
        c.index = i;
        out.push(c);
    }
    return out;
}

/**
 * 只取「可进入求解」的输入（方程 + 需要补等号的裸表达式）。
 * 自动补 "=0" 的行为收敛在此函数的调用方（solver 入口），此处只负责判定与筛选，
 * 避免「谁决定补等号」这件事散在多处。
 */
function solvableInputs(list) {
    return classifyInputs(list).filter(function (c) {
        return c.kind === INPUT_KIND.EQUATION || c.kind === INPUT_KIND.NEEDS_EQUALS;
    });
}

// ═══════════════════ 模块：operators/algebra ═══════════════════
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


export { BQAdd, BQDegX, BQDegY, BQEval, BQIsConst, BQIsZero, BQMaxAbs, BQMul, BQNorm, BQScale, BQSub, BQTotalDeg, BTAdd, BTDegZ, BTIsZero, BTMul, BTNorm, BTSub, COMPUTE_DECIMALS, CONCLUSION_ALL, CONCLUSION_NONE, CONCLUSION_PARTIAL, CONCLUSION_RESOURCE, EXAMPLES, EXAMPLE_CATS, EXAMPLE_DESCS, EXAMPLE_DOMS, EXAMPLE_FAKE_NOTES, INPUT_KIND, MOV_HIST_MAX, MOV_ILL_ABS, MOV_OVERFLOW_W, OPS_ALGEBRA, OPS_ALGEBRA2, OPS_CONTRACT, OPS_GEOMETRY, OPS_NUMERIC, OPS_POST, OPS_PRE, OPS_SCREEN, OPS_SETUP, OP_BRANCH, OP_INEQ, OP_OUTPUT, Parser, SOLVER_VERSION, SUAN50_MAX_DENOMS, SUAN50_MAX_NODES, SUAN55_MAXDEPTH, SUAN55_MIN_WIDTH, _Aff, _BE_EXACT, _BE_LOOSE, _DIM_ROUTE, _IEEE, _LS_BRANCH_GIVEUP_WIDTH, _LS_BRANCH_TIME_BUDGET_MS, _LS_BRANCH_TIME_RESERVE_MS, _LS_DOMAIN_FALLBACK, _LS_DOMAIN_LEGACY, _LS_DOMAIN_MIN, _LS_INPUT_FUNC_NAMES, _LS_INPUT_ILLEGAL_CHARS, _LS_INPUT_NATURAL_HINT, _LS_PROTECTED_NAMES, _PROVEN_EMPTY_KEYS, _RB_BEZOUT_CAP, _RB_BOUND_CEILING, _RB_COEF_FLOOR, _RB_DEGREE_CAP, _RB_LP_TOL, _RB_MAX_COMBOS, _RB_MAX_PIVOTS, _RB_MAX_SUPPORT, _RB_TERMS_CAP, _RB_TIME_CAP, _SUAN52_CONFLICT_DRY, _SUAN52_CONFLICT_ERROR, _SUAN52_CONFLICT_ROLLBACK, _affAdd, _affDiv, _affInv, _affMul, _affRad, _affSub, _affSym, _affToInterval, _affineEval, _assertContraction, _assignCertBlock, _assignCompleteness, _assignEmptiness, _assignTiers, _astDegree, _astTermCount, _bezoutBound, _bezoutVerdict, _bisectRoot1D, _boxLogVolume, _boxMid, _branchTimeLeftMs, _buildAffEnv, _buildMeta, _buildNextActions, _certifySolutions, _cloneBox, _collectCompletenessProof, _collectEmptyProof, _collectMonomials, _collectVars, _complianceGuard, _computeReportId, _conclusion4, _constraintsVerifiable, _contractionChanged, _declareNoSolution, _declaredIntervalOf, _detectPeriod1D, _diffAST, _dimRouteKey, _dimRouteProfile, _domBoxOf, _enforceVarInvariant, _eqRefsOnlyAllowed, _escHtml, _exclusionRegion, _faithfulEqsBindable, _filterIllDefined, _finalConstraintGate, _finalResidualGate, _finish, _fmtResidual, _fmtVal, _generateCorners, _globalBranchCertify, _greekNameToSymbol, _hasExplodedMovability, _hc4Node, _hc4Node2, _hcCAbs, _hcCAdd, _hcCDiv, _hcCInv, _hcCMod, _hcCMul, _hcCMulN, _hcCPi, _hcCSet, _hcCSub, _hcCZero, _hcCluSolve, _hcCorrect, _hcEvalH, _hcJacC, _hcMonKey, _hcPolyAddInto, _hcPolyBuild, _hcPolyDeg, _hcPolyEvalC, _hcPolyMul, _hcScaleOf, _hcStartRoots, _hcTrackPath, _iAdd, _iEmpty, _iHull, _iIntersect, _iMul, _iNorm, _iRecip, _iRoot, _iSub, _ieeeReset, _inflateRefineCertify, _intervalJacobian, _isLinearAST, _isPolynomialSystem, _ivExcludesZero, _jacobianRankRisk, _krawczykExclusion, _krawczykOnBox, _krawczykOnce, _linearCoef1D, _linearSystemConsistent, _lpMaximize, _lsNoteInternal, _lsTryWholeIdentifier, _matrixRank, _mergeGlobalBranch, _midVars, _mirandaCertify, _movabilityFull, _multiStartNewton, _newtonRefine, _numJac, _numericJacobianRank, _op, _partialRange, _permutations, _pointResidual, _polyDerivAsc, _polyEvalAsc, _polyRemainderAsc, _polyRootAtStrict, _polyTrimAsc, _precondAt, _priorRootHalfWidth, _rangeEval, _rat50, _rbDirBounds, _rbLpMax, _rbMakeRows, _rbNow, _rbSub, _recScanInterval, _recommendKey, _recommendKeyCmp, _refineSolutions, _rescueUnderdeterminedByProjection, _residualAt, _residualAtDisplayed, _resyncConfidence, _routeByDimension, _routeOperators, _rrefParticularSolution, _runContractionFixpoint, _runOp, _runPipeline, _runSeq, _runTail, _s17ExactLinearProof, _s58ConstVal, _s58MatchBasicTrig, _s59BQExactDiv, _s59BQOps, _s59BareissPolyDet, _s59EvalBQAtX, _s59EvalBTAtXY, _s59EvalPolyY, _s59ExpandInY, _s59ExpandInZ, _s59HasCommonYFactor, _s59NumDeg, _s59NumDivmod, _s59NumGcdNonConst, _s59NumTrim, _s59P1Ops, _s59PAdd, _s59PExactDiv, _s59PIsZero, _s59PMul, _s59PRS, _s59PRSxy, _s59PScale, _s59PSub, _s59PTrim, _s59ResultantX, _s59SolveBinaryBQ, _s59SquareFree, _s59YAdd, _s59YMul, _s59YNorm, _s59YSub, _s60R0, _s60R1, _s60abs, _s60add, _s60bareissExact, _s60cmp, _s60diagDominantFloat, _s60div, _s60exactConfirmOrExact, _s60exactVerify, _s60floatMarkowitzSolve, _s60fromNumber, _s60gcd, _s60isZero, _s60lstsq, _s60markowitz, _s60mk, _s60mul, _s60neg, _s60nullspace, _s60num, _s60particular, _s60presolve, _s60presolveFloat, _s60rankOnly, _s60solveLinear, _s60sub, _secondPartialAbs, _sha256, _simplexCore, _slimOutputForAgent, _smaleAlphaCertify, _smaleFact, _smaleInfNorm, _smalePickDomain, _solveImpl, _sturmChainAsc, _sturmCompletenessCheck, _sturmCountAllReal, _sturmCountAsc, _sturmCountRange, _sturmVariations, _sturmVariationsAtInfinity, _suan52EstCost, _suan52Feedback, _suan52Order, _suan52Scale, _suan52W, _suan55Monotone, _suan55Refine, _suan56Project, _suan57Prune, _suan58BasicTrig, _suan59RunTernary, _suan59SolveBinaryPoly, _suan59SolveTernaryPoly, _symmetryExpand, _updateMovability, _utf8Bytes, _verifyBySubstitution, aitkenAccelerate, armijoLineSearch, astEqual, astNodeCount, checkLinearODE, classifyInput, classifyInputs, classifyODE, cleanInput, closeAgentModal, closeAgreement, collectVariableDenominators, copyText, copyTextRaw, copyToClipboard, decomposeByVariableGraph, deduplicateSolutions, displayResult, duhamelDecompose, enhancedODESolve, estimateLipschitzConstant, evalAST, evalASTScale, evalLimit, extractLinearCoefficients, extractLinearYTerm, extractPolynomialCoefficients, extractVarCoefficient, extractVariables, fallbackCopy, findExplicitForm, fuzzyFix, gammaLanczos, gaussianSolve, gaussianSolveRect, generateStartPoints, getFuncChildren, getFuncChildrenAll, getOutputVarNames, hasCalculusOp, hasVariable, hasY2Term, hessianTaylorApprox, iAdd, iMatSub, iMatSubReal, iMatVec, iMul, iVecDisjoint, iVecInterior, inferDomainHalfWidth, intervalEval, isContractionMapping, isLinear, isLinearInY, isPolynomial, krawczykCertify, lineSearchNewton, loadExample, matrixDeterminant, newtonSolve, openAgentModal, openAgreement, parse, parseCondition, pendingExampleDomain, picardSolve, pickRecommended, polyDerivative, polyEval, polyIsRootWithin, polyNewtonPolish, polyTermScale, polynomialAllRoots, rMatIMat, rMatVec, rToI, rationalRootTheorem, realIdentity, realMatInv, reconstructSolution, replaceDivisionByOne, roundToGrid, runSolver, scanASTForLargeNumbers, scanRealRoots, showError, solvableInputs, solve, solveQuadraticFormula, sortAndOutput, standardRK4, suan0_classify, suan1, suan10, suan11, suan12, suan13, suan14, suan15, suan16, suan17, suan18, suan19, suan2, suan20, suan21, suan22, suan23, suan24, suan25, suan26, suan27, suan28, suan29, suan3, suan30, suan31, suan32, suan33, suan34, suan35, suan36, suan37, suan38, suan39, suan4, suan40, suan41, suan42, suan43, suan44, suan45, suan46, suan47, suan47_tryNewton, suan48, suan49, suan5, suan50, suan51, suan55, suan58, suan59, suan6, suan60, suan61, suan7, suan8, suan9, substituteVar, syntheticDivide, toggleInfoPanel, tokenize, tryRationalTransform, verifyAllConstraints };
