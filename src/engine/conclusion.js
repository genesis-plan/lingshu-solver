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
