/* 模块 operators/branch：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function suan47(state) {
    // 跳过条件：欠定不走分支定界；变量/方程缺失返回。
    if (!state.varNames || state.varNames.length === 0) return;
    if (state.equations.length < state.varNames.length) return; // 欠定不走分支定界
    // 多起点牛顿（2026-08-21）：方阵非线性强耦合系统先尝试毫秒级定位真解，
    // 避免分支定界指数递归（实测三数问题 6.7 秒才收敛）。全局标志保证每根调用只跑一次。
    if (!__LS_MSNEWTON_DONE && state.equations.length === state.varNames.length) {
        __LS_MSNEWTON_DONE = true;
        suan47_tryNewton(state);
        if (state.done) return;
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

    // 时间看门狗：分支定界总耗时不超过 10 秒（使用全局根起点，跨递归子树共享，2026-08-21 修复）
    if (performance.now() - __LS_ROOT_START > 10000) {
        state.unconverged = true;
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
    var _result1 = _valid1 ? solve(state.equationStrs, _recVarNames, state.decimals, _D0_1, undefined, { maxBranch: state.branchBudget }) : null;
    var _result2 = _valid2 ? solve(state.equationStrs, _recVarNames, state.decimals, _D0_2, undefined, { maxBranch: state.branchBudget }) : null;

    // 传播未收敛标记
    if ((_result1 && _result1.unconverged) || (_result2 && _result2.unconverged)) {
        state.unconverged = true;
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
