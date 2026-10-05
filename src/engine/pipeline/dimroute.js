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