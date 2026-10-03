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
