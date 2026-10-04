/* 模块 constants：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
var _LS_PROTECTED_NAMES = new Set();

var COMPUTE_DECIMALS = 6; // 求解与显示固定网格位数（产品规格：6位小数有限网格）。roundToGrid、内部残差容差、显示 toFixed 均据此，恒为 6，不提供位数切换

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
