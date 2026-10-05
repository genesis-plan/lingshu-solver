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
