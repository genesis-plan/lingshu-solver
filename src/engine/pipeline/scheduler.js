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
