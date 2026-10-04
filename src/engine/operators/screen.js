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
