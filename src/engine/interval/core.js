/* 模块 interval/core：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function _iNorm(r) {
    if (!r) return r;                                  // null 保持：保守跳过（sound，不收缩）
    if (typeof r.min !== 'number' || typeof r.max !== 'number') return r;
    if (isNaN(r.min) || isNaN(r.max)) {               // NaN 出现 → 保守全空间，绝不让 NaN 进入盒子
        _IEEE.nan = true;
        return { min: -Infinity, max: Infinity };
    }
    var lo = r.min, hi = r.max;
    if (lo === Infinity || lo === -Infinity || hi === Infinity || hi === -Infinity) {
        _IEEE.inf = true;                             // ±Inf 记录；区间本身保留（保守且真实）
    }
    if (Math.abs(lo) > 1e300 || Math.abs(hi) > 1e300) { _IEEE.inf = true; }  // 极端有限幅值亦记溢出
    return { min: lo, max: hi };                      // 不重排 min/max：保留空区间语义（min>max 表示空）
}


function _rangeEval(ast, intervals) {
    if (!ast) return null;
    if (ast.type === 'num') return _iNorm({ min: ast.value, max: ast.value });
    if (ast.type === 'var') {
        var iv = intervals[ast.name];
        if (iv) {
            if (iv.min > iv.max) return _iNorm({ min: iv.min, max: iv.max }); // 空区间（保留 min>max 语义）
            return _iNorm({ min: iv.min, max: iv.max });
        }
        // 变量不在区间映射中，使用默认全域
        return _iNorm({ min: -1e6, max: 1e6 });
    }
    if (ast.type === 'binop') {
        var left = _rangeEval(ast.left, intervals);
        var right = _rangeEval(ast.right, intervals);
        if (!left || !right) return null;

        switch (ast.op) {
            case '+': return _iNorm({ min: left.min + right.min, max: left.max + right.max });
            case '-': return _iNorm({ min: left.min - right.max, max: left.max - right.min });
            case '*': {
                var vals = [left.min * right.min, left.min * right.max, left.max * right.min, left.max * right.max];
                return _iNorm({ min: Math.min.apply(null, vals), max: Math.max.apply(null, vals) });
            }
            case '/': {
                if (right.min <= 0 && right.max >= 0) {
                    _IEEE.divZero = true;             // 含 0 的分母：保守跳过并标记（绝不崩溃）
                    return null;
                }
                var vals = [left.min / right.min, left.min / right.max, left.max / right.min, left.max / right.max];
                return _iNorm({ min: Math.min.apply(null, vals), max: Math.max.apply(null, vals) });
            }
            case '^': {
                // 处理幂运算（sound 优先：凡不能给出【确定包络】的情形一律 return null，绝不截断/外推）
                if (right.min === right.max) {
                    var e0 = right.min;
                    var l0 = left.min, l1 = left.max;              // 底数区间 [l0,l1]
                    if (Number.isInteger(e0)) {
                        var n = e0;
                        if (n === 0) return _iNorm({ min: 1, max: 1 });
                        if (n === 1) return left;
                        if (n > 0 && n % 2 === 0) {
                            // 偶次幂：x^n ≥ 0；端点取绝对值，跨 0 时下界收紧到 0
                            var pe0 = Math.pow(Math.abs(l0), n), pe1 = Math.pow(Math.abs(l1), n);
                            return _iNorm({ min: (l0 <= 0 && l1 >= 0) ? 0 : Math.min(pe0, pe1), max: Math.max(pe0, pe1) });
                        }
                        if (n > 0) {
                            // 奇次幂：x^n 在 R 上严格单调增
                            return _iNorm({ min: Math.pow(l0, n), max: Math.pow(l1, n) });
                        }
                        // 修复（2026-10-02，P0）：负整数幂旧实现直接 return null ⇒ intervalEval(符号微分 AST) 常为 null
                        // ⇒ _intervalJacobian 退化 ±1e6、金融反算恒不认证。
                        // 正确口径：x^n = 1 / x^|n|；底数跨 0 ⇒ 无定义（保守跳过），否则先算 |n| 次幂区间 D（必不含 0）再取倒数。
                        if (l0 <= 0 && l1 >= 0) { _IEEE.divZero = true; return null; }
                        var m = -n;
                        var daa = Math.pow(l0, m), dbb = Math.pow(l1, m);
                        return _iNorm({ min: 1 / Math.max(daa, dbb), max: 1 / Math.min(daa, dbb) });
                    }
                    // 非整数幂：实数域下 x^e0 仅在 x ≥ 0（e0 < 0 时 x > 0）上有定义
                    if (e0 > 0) {
                        if (l1 < 0) return null;                                   // 整段无定义 ⇒ 保守跳过
                        var lo0 = l0 > 0 ? l0 : 0;                                 // 定义域自 max(l0,0) 起，x^e0 单调增
                        return _iNorm({ min: Math.pow(lo0, e0), max: Math.pow(l1, e0) });
                    }
                    if (l0 <= 0 || l1 <= 0) { _IEEE.divZero = true; return null; } // 定义域含 0 ⇒ 无界/无定义
                    return _iNorm({ min: Math.pow(l1, e0), max: Math.pow(l0, e0) }); // e0 < 0：x^e0 单调减
                }
                return null; // 变指数：保守跳过
            }
        }
        return null;
    }
    if (ast.type === 'func') {
        var arg = ast.arg || (ast.args ? ast.args[0] : null);
        var argRange = arg ? _rangeEval(arg, intervals) : null;
        if (!argRange) return null;

        switch (ast.name) {
            case 'sin': {
                var a = argRange.min, b = argRange.max;
                if (b - a >= 2 * Math.PI) return _iNorm({ min: -1, max: 1 });
                var vals = [Math.sin(a), Math.sin(b)];
                for (var k = -5; k <= 5; k++) {
                    var cp = Math.PI / 2 + k * Math.PI;
                    if (cp >= a && cp <= b) vals.push(Math.sin(cp));
                    cp = -Math.PI / 2 + k * Math.PI;
                    if (cp >= a && cp <= b) vals.push(Math.sin(cp));
                }
                return _iNorm({ min: Math.min.apply(null, vals), max: Math.max.apply(null, vals) });
            }
            case 'cos': {
                var a = argRange.min, b = argRange.max;
                if (b - a >= 2 * Math.PI) return _iNorm({ min: -1, max: 1 });
                var vals = [Math.cos(a), Math.cos(b)];
                for (var k = -5; k <= 5; k++) {
                    var cp = k * Math.PI;
                    if (cp >= a && cp <= b) vals.push(Math.cos(cp));
                }
                return _iNorm({ min: Math.min.apply(null, vals), max: Math.max.apply(null, vals) });
            }
            case 'tan': {
                // tan 在每个无奇点的连续分支上严格单调增，值域=[tan(a),tan(b)]；
                // 若盒 [a,b] 含奇点 kπ+π/2，则值域为全体实数（保守取全区间）。
                // 旧实现固定返回 [-1e6,1e6]，导致含解但无奇点的盒无法被区间收紧，
                // 进而把 tan(x)=100 这类真有解的方程误判为"必无解"（漏解缺陷）。
                // 新实现：不含奇点时给出紧致且 sound 的值域，恢复区间收缩能力。
                var a = argRange.min, b = argRange.max;
                if (!isFinite(a) || !isFinite(b) || b < a) return _iNorm({ min: -Infinity, max: Infinity });
                var kLo = Math.floor((a - Math.PI / 2) / Math.PI);
                var kHi = Math.ceil((b - Math.PI / 2) / Math.PI);
                for (var k = kLo; k <= kHi; k++) {
                    var _sing = k * Math.PI + Math.PI / 2;
                    if (_sing >= a - 1e-12 && _sing <= b + 1e-12) {
                        return _iNorm({ min: -Infinity, max: Infinity }); // 含奇点：覆盖全体实数
                    }
                }
                var _ta = Math.tan(a), _tb = Math.tan(b);
                if (!isFinite(_ta) || !isFinite(_tb)) return _iNorm({ min: -Infinity, max: Infinity });
                return _iNorm({ min: Math.min(_ta, _tb), max: Math.max(_ta, _tb) });
            }
            case 'exp': {
                if (argRange.min > 700) return _iNorm({ min: Infinity, max: Infinity });
                if (argRange.max < -700) return _iNorm({ min: 0, max: Math.exp(argRange.max) });
                return _iNorm({ min: Math.exp(Math.max(-700, argRange.min)), max: Math.exp(Math.min(700, argRange.max)) });
            }
            case 'ln': case 'log': {
                if (argRange.max <= 0) { _IEEE.domainErr = true; return null; } // 定义域错误：标记 + 保守跳过（不崩溃）
                return _iNorm({ min: Math.log(Math.max(1e-300, argRange.min)), max: Math.log(argRange.max) });
            }
            case 'sqrt': {
                if (argRange.max < 0) { _IEEE.domainErr = true; return null; }
                return _iNorm({ min: Math.sqrt(Math.max(0, argRange.min)), max: Math.sqrt(argRange.max) });
            }
                case 'abs': {
                    var a = argRange.min, b = argRange.max;
                    if (a >= 0) return _iNorm({ min: a, max: b });
                    if (b <= 0) return _iNorm({ min: -b, max: -a });
                    return _iNorm({ min: 0, max: Math.max(-a, b) });
                }
                case 'arcsin': {
                    if (argRange.max < -1 || argRange.min > 1) { _IEEE.domainErr = true; return null; }
                    return _iNorm({ min: Math.asin(Math.max(-1, argRange.min)), max: Math.asin(Math.min(1, argRange.max)) });
                }
                case 'arccos': {
                    if (argRange.max < -1 || argRange.min > 1) { _IEEE.domainErr = true; return null; }
                    return _iNorm({ min: Math.acos(Math.min(1, argRange.max)), max: Math.acos(Math.max(-1, argRange.min)) });
                }
                case 'arctan': {
                    return _iNorm({ min: Math.atan(argRange.min), max: Math.atan(argRange.max) });
                }
                case 'sinh': {
                    return _iNorm({ min: Math.sinh(argRange.min), max: Math.sinh(argRange.max) });
                }
                case 'cosh': {
                    var a = argRange.min, b = argRange.max;
                    if (a >= 0) return _iNorm({ min: Math.cosh(a), max: Math.cosh(b) });
                    if (b <= 0) return _iNorm({ min: Math.cosh(b), max: Math.cosh(a) });
                    return _iNorm({ min: 1, max: Math.max(Math.cosh(a), Math.cosh(b)) });
                }
                case 'tanh': {
                    return _iNorm({ min: Math.tanh(argRange.min), max: Math.tanh(argRange.max) });
                }
            }
            return null;
    }
    if (ast.type === 'unary') {
        // 一元算子区间求值（此前缺失 → 含 -2.5 这类负常量等式的标准化 AST 求导后退化，
        // 导致 Krawczyk 雅可比整行保守 [-1e6,1e6]，无法认证 proven）。
        var u = _rangeEval(ast.operand, intervals);
        if (!u) return null;
        if (ast.op === '-') return _iNorm({ min: -u.max, max: -u.min });
        if (ast.op === '+') return u;
        return _iNorm({ min: -1e6, max: 1e6 }); // 未知一元算子：保守退化（sound，绝不假证）
    }
    return null;
}


function intervalEval(ast, intervals) {
  if (!ast) return null;
  // 空域（min>max）走保守旧逻辑，保留"空区间"语义供调用方检测无解
  if (intervals) { for (var k in intervals) { if (intervals[k] && intervals[k].min > intervals[k].max) return _rangeEval(ast, intervals); } }
  try {
    var env = _buildAffEnv(intervals || {});
    var aff = _affineEval(ast, env);
    var iv = aff ? _affToInterval(aff) : null;
    return iv || _rangeEval(ast, intervals || {});
  } catch (e) { return _rangeEval(ast, intervals || {}); }
}


function _midVars(mid, varNames) { var o = {}; varNames.forEach(function (v, k) { o[v] = mid[k]; }); return o; }

function _iAdd(A, B) { return { min: A.min + B.min, max: A.max + B.max }; }

function _iSub(A, B) { return { min: A.min - B.max, max: A.max - B.min }; }

function _iMul(A, B) {
    var v0 = A.min * B.min, v1 = A.min * B.max, v2 = A.max * B.min, v3 = A.max * B.max;
    return { min: Math.min(v0, v1, v2, v3), max: Math.max(v0, v1, v2, v3) };
}


function _iRecip(A) { if (!A || (A.min <= 0 && A.max >= 0)) return null; return { min: 1 / A.max, max: 1 / A.min }; }

function _iIntersect(A, B) { return { min: Math.max(A.min, B.min), max: Math.min(A.max, B.max) }; }

function _iHull(A, B) { return { min: Math.min(A.min, B.min), max: Math.max(A.max, B.max) }; }

function _iEmpty(A) { return A.max < A.min; }


function _boxMid(box, varNames) {
    var mid = new Array(varNames.length);
    for (var j = 0; j < varNames.length; j++) mid[j] = (box[varNames[j]].min + box[varNames[j]].max) / 2;
    return mid;
}

function _contractionChanged(before, after, varNames) {
    for (var j = 0; j < varNames.length; j++) {
        var v = varNames[j];
        if (before[v].min !== after[v].min || before[v].max !== after[v].max) return true;
    }
    return false;
}

function _declareNoSolution(state, path, k, msg) {
    state.done = true;
    state.result = {
        solutions: [], error: "NO_SOLUTION",
        message: path + "：约束 " + (k + 1) + " " + msg,
        executionPath: path,
        timeMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - state.startTime,
        confidence: "high", varNames: state.varNames, unconverged: false,
        resultType: 1, resultTypeName: "空结果", resultTypeDesc: "区间算术严格证明不存在满足条件的解"
    };
}


function _cloneBox(box) {
    if (!box) return box;
    var c = {};
    for (var k in box) {
        if (!box.hasOwnProperty(k)) continue;
        var v = box[k];
        if (v && typeof v === 'object' && 'min' in v && 'max' in v) {
            c[k] = { min: v.min, max: v.max };
        } else {
            c[k] = v; // 透传非区间字段（如 _branchDepth）
        }
    }
    return c;
}


function _intervalJacobian(equations, varNames, box, mid) {
    var n = varNames.length, J = [];
    for (var i = 0; i < equations.length; i++) {
        J.push(new Array(n));
        for (var j = 0; j < n; j++) {
            var dAST = _diffAST(equations[i], varNames[j]);
            var dI = dAST ? intervalEval(dAST, box) : null;
            if (!dI || !isFinite(dI.min) || !isFinite(dI.max)) {
                J[i][j] = { min: -1e6, max: 1e6 }; // 保守退化，确保 sound
            } else {
                J[i][j] = dI;
            }
        }
    }
    return J;
}


function _diffAST(node, varName) {
    if (!node) return null;
    switch (node.type) {
        case 'num': return { type: 'num', value: 0 };
        case 'var': return { type: 'num', value: node.name === varName ? 1 : 0 };
        case 'binop': {
            var L = node.left, R = node.right;
            var dL = _diffAST(L, varName), dR = _diffAST(R, varName);
            switch (node.op) {
                case '+': return { type: 'binop', op: '+', left: dL, right: dR };
                case '-': return { type: 'binop', op: '-', left: dL, right: dR };
                case '*':
                    return { type: 'binop', op: '+',
                        left: { type: 'binop', op: '*', left: dL, right: R },
                        right: { type: 'binop', op: '*', left: L, right: dR } };
                case '/':
                    return { type: 'binop', op: '/',
                        left: { type: 'binop', op: '-',
                            left: { type: 'binop', op: '*', left: dL, right: R },
                            right: { type: 'binop', op: '*', left: L, right: dR } },
                        right: { type: 'binop', op: '^', left: R, right: { type: 'num', value: 2 } } };
                case '^':
                    if (R.type === 'num') {
                        var p = R.value;
                        return { type: 'binop', op: '*',
                            left: { type: 'binop', op: '*',
                                left: { type: 'num', value: p },
                                right: { type: 'binop', op: '^', left: L, right: { type: 'num', value: p - 1 } } },
                            right: dL };
                    }
                    // 一般幂： d/dx L^R = L^R·(dR·ln L + R·dL / L)；L^R 仅当 R 为常整数可被 intervalEval 求值
                    return { type: 'binop', op: '*',
                        left: { type: 'binop', op: '^', left: L, right: R },
                        right: { type: 'binop', op: '+',
                            left: { type: 'binop', op: '*', left: dR, right: { type: 'func', name: 'ln', arg: L } },
                            right: { type: 'binop', op: '/',
                                left: { type: 'binop', op: '*', left: R, right: dL },
                                right: L } } };
                default: return null;
            }
        }
        case 'unary':
            if (node.op === '-') return { type: 'unary', op: '-', operand: _diffAST(node.operand, varName) };
            return _diffAST(node.operand, varName);
        case 'func': {
            if (node.args) return null; // diff/int/ode/lim/mod 不可符号求导 → 保守 SKIP
            var dArg = _diffAST(node.arg, varName);
            var fp;
            switch (node.name) {
                case 'sin': fp = { type: 'func', name: 'cos', arg: node.arg }; break;
                case 'cos': fp = { type: 'unary', op: '-', operand: { type: 'func', name: 'sin', arg: node.arg } }; break;
                case 'tan': fp = { type: 'binop', op: '/', left: { type: 'num', value: 1 }, right: { type: 'binop', op: '^', left: { type: 'func', name: 'cos', arg: node.arg }, right: { type: 'num', value: 2 } } }; break;
                case 'exp': fp = { type: 'func', name: 'exp', arg: node.arg }; break;
                case 'ln': case 'log': fp = { type: 'binop', op: '/', left: { type: 'num', value: 1 }, right: node.arg }; break;
                case 'log10': case 'log2': fp = { type: 'binop', op: '/', left: { type: 'num', value: 1 }, right: { type: 'binop', op: '*', left: node.arg, right: { type: 'func', name: 'ln', arg: { type: 'num', value: node.name === 'log2' ? 2 : 10 } } } }; break;
                case 'sqrt': fp = { type: 'binop', op: '/', left: { type: 'num', value: 1 }, right: { type: 'binop', op: '*', left: { type: 'num', value: 2 }, right: { type: 'func', name: 'sqrt', arg: node.arg } } }; break;
                case 'arcsin': fp = { type: 'binop', op: '/', left: { type: 'num', value: 1 }, right: { type: 'func', name: 'sqrt', arg: { type: 'binop', op: '-', left: { type: 'num', value: 1 }, right: { type: 'binop', op: '^', left: node.arg, right: { type: 'num', value: 2 } } } } }; break;
                case 'arccos': fp = { type: 'unary', op: '-', operand: { type: 'binop', op: '/', left: { type: 'num', value: 1 }, right: { type: 'func', name: 'sqrt', arg: { type: 'binop', op: '-', left: { type: 'num', value: 1 }, right: { type: 'binop', op: '^', left: node.arg, right: { type: 'num', value: 2 } } } } } }; break;
                case 'arctan': fp = { type: 'binop', op: '/', left: { type: 'num', value: 1 }, right: { type: 'binop', op: '+', left: { type: 'num', value: 1 }, right: { type: 'binop', op: '^', left: node.arg, right: { type: 'num', value: 2 } } } }; break;
                case 'sinh': fp = { type: 'func', name: 'cosh', arg: node.arg }; break;
                case 'cosh': fp = { type: 'func', name: 'sinh', arg: node.arg }; break;
                case 'tanh': fp = { type: 'binop', op: '-', left: { type: 'num', value: 1 }, right: { type: 'binop', op: '^', left: { type: 'func', name: 'tanh', arg: node.arg }, right: { type: 'num', value: 2 } } }; break;
                case 'cot': fp = { type: 'unary', op: '-', operand: { type: 'binop', op: '^', left: { type: 'func', name: 'csc', arg: node.arg }, right: { type: 'num', value: 2 } } }; break;
                case 'sec': fp = { type: 'binop', op: '*', left: { type: 'func', name: 'sec', arg: node.arg }, right: { type: 'func', name: 'tan', arg: node.arg } }; break;
                case 'csc': fp = { type: 'unary', op: '-', operand: { type: 'binop', op: '*', left: { type: 'func', name: 'csc', arg: node.arg }, right: { type: 'func', name: 'cot', arg: node.arg } } }; break;
                case 'abs': return null;   // 非光滑 → 保守 SKIP
                case 'floor': case 'ceil': case 'gamma': return null; // 非光滑/无简单区间导数 → 保守 SKIP
                default: return null;
            }
            return { type: 'binop', op: '*', left: fp, right: dArg };
        }
        default: return null;
    }
}


function _partialRange(eq, i, varNames, box, order) {
    var vi = varNames[i], Bi = box[vi];
    if (!Bi || !isFinite(Bi.min) || !isFinite(Bi.max)) return null;
    var d1AST = _diffAST(eq, vi);
    var d1 = d1AST ? intervalEval(d1AST, box) : null;
    if (!d1 || !isFinite(d1.min) || !isFinite(d1.max)) return null;
    if (order === 1) return d1;
    var d2AST = _diffAST(d1AST, vi);
    var d2 = d2AST ? intervalEval(d2AST, box) : null;
    if (!d2 || !isFinite(d2.min) || !isFinite(d2.max)) return null;
    return d2;
}


function _iRoot(I, p) {
    if (!I || !isFinite(I.min) || !isFinite(I.max)) return null;
    if (p === 0) return null;
    if (p > 0 && p % 2 === 1) {
        var rmin = Math.sign(I.min) * Math.pow(Math.abs(I.min), 1 / p);
        var rmax = Math.sign(I.max) * Math.pow(Math.abs(I.max), 1 / p);
        return { min: Math.min(rmin, rmax), max: Math.max(rmin, rmax) };
    }
    if (p > 0 && p % 2 === 0) {
        if (I.max < 0) return null;
        // 偶次幂逆向必须取对称区间：x^p ∈ [a,b] ⟹ x ∈ [-b^(1/p), b^(1/p)]
        // （2016-08-21 修复：原实现只取正支 [lo,hi]，会把 z²=... 的负支真解排除，
        //   如三球交点 (2,2,-1) 的 z=-1 被 suan28 HC4 传播误删）
        var hi2 = Math.pow(Math.max(0, I.max), 1 / p);
        return { min: -hi2, max: hi2 };
    }
    return null;
}


function _boxLogVolume(D0, varNames) {
    var s = 0;
    for (var i = 0; i < varNames.length; i++) {
        var b = D0[varNames[i]];
        if (!b || typeof b !== 'object') continue;
        var w = b.max - b.min;
        if (!isFinite(w)) return Infinity;
        s += Math.log(Math.max(w, 1e-300));
    }
    return s;
}


function iMul(a, b) { var v = [a.min * b.min, a.min * b.max, a.max * b.min, a.max * b.max]; return { min: Math.min.apply(null, v), max: Math.max.apply(null, v) }; }

function iAdd(a, b) { return { min: a.min + b.min, max: a.max + b.max }; }

function rToI(x) { return { min: x, max: x }; }

function iMatVec(I, v) { var n = I.length, r = []; for (var i = 0; i < n; i++) { var acc = null; for (var k = 0; k < n; k++) { var t = iMul(I[i][k], v[k]); acc = acc === null ? t : iAdd(acc, t); } r.push(acc); } return r; }

function rMatVec(M, v) { var n = M.length, r = new Array(n); for (var i = 0; i < n; i++) { var s = 0; for (var j = 0; j < v.length; j++) s += M[i][j] * v[j]; r[i] = s; } return r; }

function rMatIMat(R, I) { var n = R.length, M = []; for (var i = 0; i < n; i++) { M.push([]); for (var j = 0; j < n; j++) { var acc = null; for (var k = 0; k < n; k++) { var t = iMul(rToI(R[i][k]), I[k][j]); acc = acc === null ? t : iAdd(acc, t); } M[i].push(acc); } } return M; }

function iMatSubReal(A, R) { var n = A.length, M = []; for (var i = 0; i < n; i++) { M.push([]); for (var j = 0; j < n; j++) M[i].push({ min: A[i][j].min - R[i][j], max: A[i][j].max - R[i][j] }); } return M; }
// 区间矩阵 − 区间矩阵（Krawczyk 算子 C = I − Y·J([X]) 需要逐分量区间减法，R 也是区间）

function iMatSub(A, B) { var n = A.length, M = []; for (var i = 0; i < n; i++) { M.push([]); for (var j = 0; j < n; j++) M[i].push({ min: A[i][j].min - B[i][j].min, max: A[i][j].max - B[i][j].max }); } return M; }

function realIdentity(n) { var I = []; for (var i = 0; i < n; i++) { I.push([]); for (var j = 0; j < n; j++) I[i].push(i === j ? 1 : 0); } return I; }

function iVecInterior(A, B) { for (var i = 0; i < A.length; i++) { if (!(A[i].min > B[i].min && A[i].max < B[i].max)) return false; } return true; }

function realMatInv(M) {
    var n = M.length; if (n === 0) return null;
    var cols = [];
    for (var c = 0; c < n; c++) {
        var b = new Array(n); for (var i = 0; i < n; i++) b[i] = (i === c) ? 1 : 0;
        var r = gaussianSolve(M, b);
        if (!r || !r.solution) return null;
        cols.push(r.solution);
    }
    var R = []; for (var i2 = 0; i2 < n; i2++) { R.push([]); for (var j2 = 0; j2 < n; j2++) R[i2].push(cols[j2][i2]); }
    return R;
}
// 单次 Krawczyk 尝试（固定半径 r）

function iVecDisjoint(A, B) {
    for (var i = 0; i < A.length; i++) { if (!(A[i].max < B[i].min || A[i].min > B[i].max)) return false; }
    return true;
}
// 全局分支定界主函数：返回 {solutions, boxCount, residualBoxes, budget, complete}