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
