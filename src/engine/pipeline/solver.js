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
                try { _lsToks = tokenize(fuzzyFix(_lsEqStr, _lsEntryProt)); } catch (_lsTe) { continue; }   // 必须先 fuzzyFix：门禁与 setup 解析须看同一个字符串，否则隐式乘 "2x" 会被误判为未声明标识符（见下方注释）
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
    // 满秩系统即便在解处 Jacobian 奇异（如 Powell singular），只要找到孤立解就标 proven/candidate，
    // 绝不因 local-rank 试探误判为 infinite 而盖戳 structural（2026-08-22 修 B2 误标）。
    var vns = getOutputVarNames(state);
    var underdetermined = (state.equations && state.equations.length < vns.length);
    for (var i = 0; i < sols.length; i++) {
        var sol = sols[i];
        if (sol.certified === true) sol.tier = 'proven';
        // structural 仅对真正的"代表点"解生效（欠定/恒等系统由伪逆推荐产生，标记 representative）；
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
    state.result.completeness = {
        scope: '变量数≤6、声明定义域[-10000,10000]、有限网格(6位小数)、残差容差三档(1e-6/1e-9/1e-3)',
        provenIsComplete: true,        // proven 解（certified）在本网格/定义域下经 Krawczyk 唯一性证明，已完备
        candidateMayMiss: true,        // candidate 解未经证明，可能存在漏解/伪根
        emptyProofNote: 'emptyProof=proof_empty 表示已严格证明域内无解；candidate_empty 仅表示未找到，不保证不存在',
        undecidability: '对任意超越系统，Richardson 不可判定定理表明不存在判定"有解/无解/几解"的通用算法；本工具保证边界如上，不对全部输出承诺100%正确',
        reproducibility: '全路径无随机数(Math.random=0)，种子确定性，结果跨运行/平台可复现'
    };
    state.result.bound = {
        varCount: vns.length,
        domain: state._initD0 || state.D0 || {},
        decimals: state.displayDecimals
    };
}


function _assignCertBlock(state) {
    if (!state || !state.result) return;
    var sols = state.result.solutions || [];
    for (var i = 0; i < sols.length; i++) {
        var sol = sols[i];
        var enclosure = null;
        if (sol.certified === true && typeof sol.certifiedRadius === 'number') {
            enclosure = (sol.values || []).map(function (v) {
                var r = sol.certifiedRadius;
                return [+(v - r).toFixed(12), +(v + r).toFixed(12)];
            });
        }
        sol.cert = {
            status: sol.tier || (sol.certified ? 'proven' : 'candidate'),
            method: sol.certMethod || sol.source || (sol.certified ? 'krawczyk_newton' : 'numeric_newton'),
            enclosure: enclosure,
            backwardError: (typeof sol.residual === 'number') ? sol.residual : null,
            krawczykRadius: (typeof sol.certifiedRadius === 'number') ? sol.certifiedRadius : null
        };
    }
    var pc = state.result.provenCount || 0, cc = state.result.candidateCount || 0;
    state.result.certification = {
        proven: pc,
        candidate: cc,
        structural: state.result.structuralCount || 0,
        emptyProof: state.result.emptyProof || null,
        certifiedCoverage: (pc + cc) > 0 ? +(pc / (pc + cc)).toFixed(4) : null,
        reproducibility: {
            method: 'SHA-256(reportId)',
            deterministic: true,
            note: 'reportId 由「输入+版本+预算」逐位可重算；相同输入跨运行/平台产出相同 reportId 即证明可复现（Decision Physics DP-1）'
        }
    };
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
 * 采纳后**必须**把 truncated 语义改回：拿到了真解就不是「没算完」。
 * 但完备性仍不声称（可能有别的解没找到），故 truncated 由 true 改为 false 并
 * 写入 warning 说明「只证明了至少一个解存在」。这是诚实的最小声明。
 */
function _rescueUnderdeterminedByProjection(state) {
    var eqs = state.userEquations || [];
    var vns = getOutputVarNames(state);
    if (!eqs.length || !vns.length) return false;
    if (eqs.length >= vns.length) return false;           // 闸①：只救欠定
    if (!state.D0 || !Object.keys(state.D0).length) return false;

    // 起点集合（与 suan49/output.js:754-792 同源）
    var starts = [];
    var mid = vns.map(function (vn) {
        var d = state.D0[vn];
        return (d && isFinite(d.min) && isFinite(d.max)) ? (d.min + d.max) / 2 : 0;
    });
    starts.push(mid.slice());
    // 域 30%/70% 分位组合（端点常在奇点外，故不用端点）
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
    // 零起点（很多「最近解」就贴着原点附近）
    starts.push(vns.map(function () { return 0; }));

    var RESIDUAL_GATE = 1e-9;
    var best = null, bestD2 = Infinity;
    for (var i = 0; i < starts.length; i++) {
        var pr = _suan56Project(eqs, vns, starts[i], state.D0, { maxIter: 60 });
        if (!pr || !pr.ok) continue;
        if (!(pr.residual < RESIDUAL_GATE)) continue;      // 闸②
        var d2 = 0;
        for (var j = 0; j < pr.values.length; j++) d2 += pr.values[j] * pr.values[j];
        if (d2 < bestD2) { bestD2 = d2; best = pr; }
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
    state.result.truncated = false;
    state.result.unconverged = false;
    state.result.error = null;
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
    state.result.warnings = (state.result.warnings || []).slice();
    state.result.warnings.push('投影法抢救：已找到并验证至少一个解，但未证明解集完备（可能还有其他解未被找到）');
    state.suan56Projection = state.result.rescueProjection;
    return true;
}


function _finish(state) {
    try { _sturmCompletenessCheck(state); } catch(e) { _lsNoteInternal(e, 'solver.js:560 完备性 Sturm 检查属增强项，失败不阻断主结果，有意忽略'); }
    // ── 2026-10-03 新增：欠定系统的投影抢救（先于 HARD_TIMEOUT 兜底）──
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
    if (state && !state.result) {
        state.result = {
            solutions: [], error: "HARD_TIMEOUT",
            message: "计算超出全局时间预算（8 秒）被中止，结果不完整（truncated）。建议缩小变量范围、减少变量数后重试。",
            executionPath: "全局超时兜底",
            timeMs: +(performance.now() - (state.startTime || performance.now())).toFixed(0),
            confidence: "low", varNames: state.varNames || [],
            resultType: 2, resultTypeName: "有限解（未完成）",
            resultTypeDesc: "计算超时中止，未获得完整结果",
            truncated: true, unconverged: true, warnings: ["计算超出全局时间预算被中止，结果不完整"]
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
    if (state && state.result && state.result.solutions && state.result.solutions.length) {
        _enforceVarInvariant(state);   // 先修复变量数不变量（防新算子静默缺变量），再过滤病态解
        _filterIllDefined(state);
        _certifySolutions(state);      // Krawczyk 认证层：为每个有限孤立解写入 sol.certified
        // 全局区间分支定界：对【方阵系统】在用户初始域内尝试完备穷尽（覆盖非线性多解漏解）。
        // 非方阵（欠定/超定）不接；无 userDomain 不接。预算兜底，超预算诚实降级。
        if (state.userDomain) {
            var _gbEqs = state.originalEquations || state.equations;
            var _gbVns = getOutputVarNames(state);
            if (_gbEqs && _gbVns && _gbEqs.length === _gbVns.length && _gbVns.length > 0) {
                var _gbOpts = { budget: 5e5, maxDepth: 28, minWidth: 1e-4 };
                if (state.solverDecimals != null) _gbOpts.minWidth = Math.max(1e-4, Math.pow(10, -state.solverDecimals));
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
                if (_gbOk) {
                    var _gb = _globalBranchCertify(_gbEqs, _gbVns, _gbDom, _gbOpts);
                    if (_gb) _mergeGlobalBranch(state, _gb);
                }
            }
        }
    }
    if (state && state.result && !state.result.meta) {
        _updateMovability(state);   // 切片B：终态标记（即使未进收缩层也置位，保证输出携带病态状态）
        state.result.meta = _buildMeta(state);
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
    _assignEmptiness(state);
    _assignCompleteness(state);
    _assignCertBlock(state);   // 认证实根计算层：每解附加 cert 块 + 全局 certification 汇总
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
    // 计算网格固定为 6 位小数（产品规格：6位小数有限网格）。
    // 显示精度同样固定为 COMPUTE_DECIMALS（=6）：求解精度与显示精度同源恒定，
    // 不做位数切换，既避免「选 0 位出现整数假解」的误导，也对齐行业范式
    //（Mathematica 默认显示 6 位、Matlab format 仅改显示不改计算）。
    state.displayDecimals = COMPUTE_DECIMALS;          // 仅供显示层 toFixed 使用（固定 6）
    state.decimals = COMPUTE_DECIMALS;                // 计算用小数位（固定）
    state.solverDecimals = COMPUTE_DECIMALS;          // 分支最小盒宽 10^-6（固定）
    state.tolerance = Math.pow(10, -COMPUTE_DECIMALS); // 计算残差容差（固定，与显示精度无关）
    state.maxIter = 20;                              // 计算迭代上限（固定）
    state.fastMode = !!fastMode;

    // 资源上限可注入（opts.maxBranch / opts.maxBoxes / opts.maxIter），默认沿用硬编码上限；
    // 对齐工程路线“资源限制须向上层暴露”——供资源截断预言机与 Agent 防护使用。
    // 显式赋值后，suan47 内的 `typeof branchBudget==='undefined'` 守卫将不再回退到 200。
    if (opts && Number.isFinite(opts.maxBranch)) state.branchBudget = opts.maxBranch;
    if (opts && Number.isFinite(opts.maxBoxes)) state.maxBoxes = opts.maxBoxes;
    if (opts && Number.isFinite(opts.maxIter)) state.maxIter = opts.maxIter;

    // ===== 解析层（D0 初始化前：建立 equations / varNames / >6 硬校验）=====
    if (_runSeq(state, OPS_SETUP)) return _finish(state);

    // ===== 阶段 0｜结构预判（全局调度第一层：先判 无解/有限/无限，再按标签分流）=====
    // 数学依据：解流形维数 d = n − rank(J)。d=0→有限(孤立点)；d≥1→无限(正维流形)；
    // m<n ⇒ d≥1(欠定, sound 无限)。本产品无 CAS，Groebner 维数判定不可行，故用
    // 数值雅可比秩（sound-incomplete）。自此收缩算子降级为「抛光器」（见阶段5/6）。
    suan0_classify(state);

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
