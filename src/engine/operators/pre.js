/* 模块 operators/pre：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function suan4(state) {
    for (var ei = 0; ei < state.equations.length; ei++) {
        (function checkNode(node) {
            if (!node) return;
            if (node.type === "func" && node.name === "int" && node.args && node.args.length < 3) {
                state.done = true;
                state.result = { solutions: [], error: "ILLEGAL_OPERATOR", message: "检测到不定积分，当前求解器仅支持定积分", varNames: state.varNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "不定积分无法数值求解" };
                return;
            }
            if (node.left) checkNode(node.left);
            if (node.right) checkNode(node.right);
            if (node.operand) checkNode(node.operand);
            if (node.args) node.args.forEach(checkNode);
            if (node.arg) checkNode(node.arg);
        })(state.equations[ei]);
        if (state.done) return;
    }
}


function suan5(state) {
    for (var ei = 0; ei < state.equations.length; ei++) {
        var _largeNums = scanASTForLargeNumbers(state.equations[ei]);
        if (_largeNums && _largeNums.length > 0) {
            state.done = true;
            state.result = {
                solutions: [],
                error: "COEFF_OUT_OF_RANGE",
                message: "检测到超出范围的常量（要求在 ±1e6 以内）",
                varNames: state.varNames,
                resultType: 1, resultTypeName: "空结果", resultTypeDesc: "常量超出数值稳定范围，无法可靠求解"
            };
            return;
        }
    }
}


function suan6(state) {
    for (var ei = 0; ei < state.equations.length; ei++) {
        var eq = state.equations[ei];
        var vars = extractVariables(eq);
        if (vars.length === 0) {
            var val = evalAST(eq, {});
            if (isFinite(val) && Math.abs(val) > 1e-12) {
                state.done = true;
                state.result = { solutions: [], error: "NO_SOLUTION", provenEmpty: true, message: "常量方程恒不成立（残差=" + val.toFixed(2) + "）", varNames: state.varNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "方程不含变量且恒不成立" };
                return;
            }
        }
    }
}


function suan7(state) {
    // ===== 第1轮：收集已知值（支持多种形式） =====
    var known = {};

    function _tryExtractKnown(eq) {
        if (eq.type !== 'binop' || eq.op !== '-') return false;
        // 模式1: var - c = 0 → var = c
        if (eq.left.type === 'var' && eq.right.type === 'num') {
            known[eq.left.name] = eq.right.value; return true;
        }
        // 模式2: c - var = 0 → var = c
        if (eq.left.type === 'num' && eq.right.type === 'var') {
            known[eq.right.name] = eq.left.value; return true;
        }
        // 模式3: sqrt(var) - c = 0 → var = c²
        if (eq.left.type === 'func' && eq.left.name === 'sqrt' && eq.right.type === 'num') {
            // 单参数函数用 arg，多参数函数用 args
            var inner = eq.left.arg || (eq.left.args && eq.left.args[0]);
            if (inner && inner.type === 'var') {
                known[inner.name] = eq.right.value * eq.right.value; return true;
            }
            // sqrt(var + k) - c = 0 → var = c² - k
            if (inner && inner.type === 'binop' && inner.op === '+') {
                if (inner.left.type === 'var' && inner.right.type === 'num') {
                    known[inner.left.name] = eq.right.value * eq.right.value - inner.right.value; return true;
                }
                if (inner.left.type === 'num' && inner.right.type === 'var') {
                    known[inner.right.name] = eq.right.value * eq.right.value - inner.left.value; return true;
                }
            }
        }
        // 模式4: var + k - c = 0 → var = c - k
        if (eq.left.type === 'binop' && eq.left.op === '+' && eq.right.type === 'num') {
            if (eq.left.left.type === 'var' && eq.left.right.type === 'num') {
                known[eq.left.left.name] = eq.right.value - eq.left.right.value; return true;
            }
            if (eq.left.left.type === 'num' && eq.left.right.type === 'var') {
                known[eq.left.right.name] = eq.right.value - eq.left.left.value; return true;
            }
        }
        // 模式5: k * var - c = 0 → var = c / k
        if (eq.left.type === 'binop' && eq.left.op === '*' && eq.right.type === 'num') {
            if (eq.left.left.type === 'var' && eq.left.right.type === 'num' && Math.abs(eq.left.right.value) > 1e-15) {
                known[eq.left.left.name] = eq.right.value / eq.left.right.value; return true;
            }
            if (eq.left.left.type === 'num' && eq.left.right.type === 'var' && Math.abs(eq.left.left.value) > 1e-15) {
                known[eq.left.right.name] = eq.right.value / eq.left.left.value; return true;
            }
        }
        // 模式6: var / k - c = 0 → var = c * k
        if (eq.left.type === 'binop' && eq.left.op === '/' && eq.right.type === 'num') {
            if (eq.left.left.type === 'var' && eq.left.right.type === 'num' && Math.abs(eq.left.right.value) > 1e-15) {
                known[eq.left.left.name] = eq.right.value * eq.left.right.value; return true;
            }
        }
        return false;
    }

    for (var ei = 0; ei < state.equations.length; ei++) {
        _tryExtractKnown(state.equations[ei]);
    }

    // ===== 第2轮：多轮传播 =====
    var changed = true;
    var iter = 0;
    // 记录已从哪个方程提取过值，避免同一方程反复检查矛盾（浮点噪声）
    var resolvedEqs = {};
    while (changed && iter < 20) {
        changed = false; iter++;
        for (var ei = 0; ei < state.equations.length; ei++) {
            var eq = state.equations[ei];
            var vars = extractVariables(eq);
            var knownCount = 0, unknownVars = [];
            for (var vi = 0; vi < vars.length; vi++) {
                if (known[vars[vi]] !== undefined) knownCount++;
                else unknownVars.push(vars[vi]);
            }
            if (knownCount === 0) continue;

            // ── 情形A：所有变量已知 → 直接求值检查矛盾 ──
            // 跳过已从前提取过值的方程，避免浮点噪声误判
            if (unknownVars.length === 0) {
                if (!resolvedEqs[ei]) {
                    // 🔴🔴 2026-10-05 彻底去网格化：矛盾判据回归**纯后向误差**，删掉网格余量通道。
                    //
                    // 事故史（必须留痕，这是同一个坑的两次修复）：
                    //   第1版：用 1e-12 绝对阈值。`3*x=1` 的 known={x:1/3} 代入得残差
                    //        ~1e-17 < 1e-12 ⇒ 不判矛盾，对的；但 12 位以上的循环小数会漏。
                    //   第2版：known 先 roundToGrid 到 6 位网格，残差变1e-6 > 1e-12
                    //        ⇒ **把 1/3 的量化残差当成矛盾**，输出 provenEmpty=true
                    //        +「已严格证明：定义域内不存在实数解」。这是最恶劣的一档谎报
                    //        （Agent 会照原文向用户断言无解），实测 `3*x=1`/`7*x=1` 全中。
                    //   第3版（2026-10-05，现在）：**删掉网格化本身**（roundToGrid 改为
                    //        全精度 + ULP 去噪），矛盾阈值改用与残差闸门同源的后向误差
                    //        判据 max(TOL_ABS_FLOOR, Σ|terms|·τ)。网格余量通道的前提
                    //        （坐标被量化）已消失，保留它等于**永久放宽矛盾检测**
                    //        ——真矛盾（x=1 与 x=2 并存，残差 O(1)）抓得住，
                    //        但任何残差小于 L·h ≈ 1e-6 的伪矛盾会被放过。
                    //
                    // 为什么后向误差判据是**更严**而不是更松：
                    //   τ = 1e-11 相对 ⇒ 对 `3*x=1`（Σ|terms|≈1）阈值 1e-11，
                    //   而 1/3 的真残差 ~1e-17 ⇒ 差6 个数量级，安全放过；
                    //   对真矛盾 `x-2` 代入 x=1 残差 1 ⇒ 超阈值 11 个数量级，照样抓住。
                    //
                    // fail-closed（保持不变）：本函数一旦宣告就是「已严格证明无解」，
                    //   判不出来就没有资格说这句话 ⇒ 交给后续算子继续找。
                    var _qn = Object.keys(known);
                    var _val = NaN, _scale = 0;
                    try { _val = evalAST(eq, known); } catch (e1) { _val = NaN; }
                    try { _scale = evalASTScale(eq, known); } catch (e2) { _scale = 0; }
                    if (!isFinite(_scale) || _scale <= 0) _scale = 0;
                    var _ctol = Math.max(1e-6, _scale * 1e-11);
                    if (isFinite(_val) && Math.abs(_val) > _ctol) {
                        state.done = true;
                        var msg = "前向传播检测到矛盾：代入已知值后方程不成立（残差=" + _val.toExponential(2) + "）";
                        var knownList = Object.keys(known).sort().map(function(v) { return v + "=" + known[v]; }).join(", ");
                        state.result = { solutions: [], error: "NO_SOLUTION", provenEmpty: true, message: msg, detail: "已知值: " + knownList, executionPath: "前向传播矛盾检测", timeMs: performance.now() - state.startTime, confidence: "high", varNames: state.varNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "前向传播检测到矛盾" };
                        return;
                    }
                }
                continue;
            }

            // ── 情形B：恰有1个未知变量 → 多点采样矛盾检测 + 尝试提取值 ──
            if (unknownVars.length === 1) {
                var uv = unknownVars[0];
                var extracted = false;
                var box = state.D0[uv];
                if (box && isFinite(box.min) && isFinite(box.max)) {
                    var lo = box.min, hi = box.max;
                    // 5点采样：边界、四分位、中点
                    var pts = [lo, lo * 0.75 + hi * 0.25, (lo + hi) * 0.5, lo * 0.25 + hi * 0.75, hi];
                    var allSameSign = true, firstSign = 0, minRes = Infinity, maxRes = 0;
                    var validCount = 0, sampleVals = [];

                    for (var pi = 0; pi < pts.length; pi++) {
                        var ctx = {};
                        for (var k in known) ctx[k] = known[k];
                        ctx[uv] = pts[pi];
                        var v = evalAST(eq, ctx);
                        if (!isFinite(v) || isNaN(v)) continue;
                        validCount++;
                        sampleVals.push(v);
                        var absv = Math.abs(v);
                        if (absv < minRes) minRes = absv;
                        if (absv > maxRes) maxRes = absv;
                        var s = v > 0 ? 1 : -1;
                        if (firstSign === 0) firstSign = s;
                        else if (s !== firstSign) allSameSign = false;
                    }

                    // 严格区间包络测试（取代原“5 点采样同号 + 最小残差>0.1”启发式）：
                    // 在变量 uv 的全域上计算 f 的区间包络，若包络不含 0，
                    // 则由中值定理严格证明该域内无解——【sound，不丢真解】。
                    // 原启发式会把 x=0.4（方程 20(x-0.4)²+y-0.5=0, y=0.5）误判为无解（见评审 unsound）。
                    var ibox = {};
                    for (var kb in known) ibox[kb] = { min: known[kb], max: known[kb] };
                    ibox[uv] = box;
                    var iF = intervalEval(eq, ibox);
                    if (iF && _ivExcludesZero(iF)) {
                        state.done = true;
                        var knownList = Object.keys(known).sort().map(function(v) { return v + "=" + known[v]; }).join(", ");
                        state.result = { solutions: [], error: "NO_SOLUTION", message: "前向传播检测到矛盾：代入已知值后，方程在变量 " + uv + " 的全域上 f 的严格区间包络不含 0（包络=[" + iF.min.toExponential(2) + "," + iF.max.toExponential(2) + "]），严格证明无根", detail: "已知值: " + knownList, executionPath: "前向传播矛盾检测", timeMs: performance.now() - state.startTime, confidence: "high", varNames: state.varNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "前向传播检测到矛盾" };
                        return;
                    }

                    // 如果采样点有变号，尝试二分法求解
                    if (!allSameSign && validCount >= 2) {
                        for (var pi = 0; pi < pts.length - 1; pi++) {
                            var v1 = sampleVals[pi], v2 = sampleVals[pi + 1];
                            if (!isFinite(v1) || !isFinite(v2)) continue;
                            if (v1 * v2 <= 0) {
                                var a = pts[pi], b = pts[pi + 1];
                                for (var bi = 0; bi < 60; bi++) {
                                    var mid = (a + b) * 0.5;
                                    var ctx = {};
                                    for (var k in known) ctx[k] = known[k];
                                    ctx[uv] = mid;
                                    var fmid = evalAST(eq, ctx);
                                    if (!isFinite(fmid)) break;
                                    if (Math.abs(fmid) < 1e-10) {
                                        known[uv] = mid; changed = true; extracted = true; break;
                                    }
                                    var f1 = (function() { var c = {}; for (var k in known) c[k] = known[k]; c[uv] = a; return evalAST(eq, c); })();
                                    if (fmid * f1 <= 0) b = mid;
                                    else a = mid;
                                }
                                if (extracted) break;
                            }
                        }
                    }
                }

                // 尝试从方程中推导新已知值（模式匹配）
                // 模式: var1 + var2 - c = 0, 一个已知 → 推导另一个
                if (!extracted && eq.type === 'binop' && eq.op === '-' && eq.left.type === 'binop' && eq.left.op === '+' && eq.right.type === 'num') {
                    var l = eq.left.left, r = eq.left.right, c = eq.right.value;
                    if (l.type === 'var' && r.type === 'var') {
                        if (known[l.name] !== undefined && known[r.name] === undefined) {
                            known[r.name] = c - known[l.name]; changed = true; extracted = true;
                        } else if (known[r.name] !== undefined && known[l.name] === undefined) {
                            known[l.name] = c - known[r.name]; changed = true; extracted = true;
                        }
                    }
                }
                // 模式: var1 * var2 - c = 0, 一个已知 → 推导另一个
                if (!extracted && eq.type === 'binop' && eq.op === '-' && eq.left.type === 'binop' && eq.left.op === '*' && eq.right.type === 'num') {
                    var l = eq.left.left, r = eq.left.right, c = eq.right.value;
                    if (l.type === 'var' && r.type === 'var') {
                        if (known[l.name] !== undefined && known[r.name] === undefined && Math.abs(known[l.name]) > 1e-15) {
                            known[r.name] = c / known[l.name]; changed = true; extracted = true;
                        } else if (known[r.name] !== undefined && known[l.name] === undefined && Math.abs(known[r.name]) > 1e-15) {
                            known[l.name] = c / known[r.name]; changed = true; extracted = true;
                        }
                    }
                }

                if (extracted) resolvedEqs[ei] = true;
            }
        }
    }
}


function suan8(state) {
    // 检测边界处的极限行为
    var boundaryInfo = [];
    for (var vi = 0; vi < state.varNames.length; vi++) {
        var vn = state.varNames[vi];
        var box = state.D0[vn];
        if (!box) continue;
        var min = box.min, max = box.max;
        
        // 检测变量是否出现在分母、ln、sqrt等可能导致奇点的位置
        var hasSingularityRisk = false;
        for (var ei = 0; ei < state.equations.length; ei++) {
            (function _checkSingularity(node) {
                if (!node) return;
                if (node.type === 'binop' && node.op === '/') {
                    if (hasVariable(node.right, [vn])) hasSingularityRisk = true;
                }
                if (node.type === 'func' && node.name === 'ln') {
                    if (hasVariable(node, [vn])) hasSingularityRisk = true;
                }
                if (node.type === 'func' && node.name === 'sqrt') {
                    if (hasVariable(node, [vn])) hasSingularityRisk = true;
                }
                if (node.type === 'binop') { _checkSingularity(node.left); _checkSingularity(node.right); }
                if (node.type === 'unary') _checkSingularity(node.operand);
                if (node.type === 'func' && node.args) node.args.forEach(_checkSingularity);
            })(state.equations[ei]);
        }
        
        // 在边界附近采样，分析极限行为
        var boundarySamples = [];
        var samplePoints = [min, min + 0.01 * (max - min), max - 0.01 * (max - min), max];
        for (var si = 0; si < samplePoints.length; si++) {
            var sp = samplePoints[si];
            if (sp < -1e6 || sp > 1e6) continue;
            var vars = {};
            for (var vj = 0; vj < state.varNames.length; vj++) vars[state.varNames[vj]] = (state.varNames[vj] === vn) ? sp : 0;
            var vals = state.equations.map(function(eq) { return evalAST(eq, vars); });
            var hasFinite = false, hasInfinite = false;
            for (var vi2 = 0; vi2 < vals.length; vi2++) {
                if (isFinite(vals[vi2]) && !isNaN(vals[vi2])) hasFinite = true;
                if (!isFinite(vals[vi2]) || Math.abs(vals[vi2]) > 1e15) hasInfinite = true;
            }
            boundarySamples.push({ point: sp, hasFinite: hasFinite, hasInfinite: hasInfinite, vals: vals });
        }
        
        boundaryInfo.push({
            varName: vn,
            hasSingularityRisk: hasSingularityRisk,
            boundarySamples: boundarySamples
        });
    }
    state.boundaryInfo = boundaryInfo;

}


function suan9(state) {
    // 线性系数提取：把 AST 解析为 a·vn + b（仅 x、a*x、a*x±b、b±a*x、x±b 等线性形式），
    // 非线形返回 null。用于 sqrt/log 的复合线性参数定义域推导（如 sqrt(5-x) → x≤5）。
    function _linearCoeffOf(node, vn) {
        if (!node) return null;
        if (node.type === 'var') return node.name === vn ? { a: 1, b: 0 } : null;
        if (node.type === 'num') return { a: 0, b: node.value };
        if (node.type === 'unary' && node.op === '-') {
            var t = _linearCoeffOf(node.operand, vn);
            return t ? { a: -t.a, b: -t.b } : null;
        }
        if (node.type === 'binop') {
            if (node.op === '+' || node.op === '-') {
                var l = _linearCoeffOf(node.left, vn), r = _linearCoeffOf(node.right, vn);
                if (l && r) return { a: l.a + (node.op === '-' ? -r.a : r.a), b: l.b + (node.op === '-' ? -r.b : r.b) };
                return null;
            }
            if (node.op === '*') {
                if (node.left.type === 'num' && node.right.type === 'var' && node.right.name === vn) return { a: node.left.value, b: 0 };
                if (node.right.type === 'num' && node.left.type === 'var' && node.left.name === vn) return { a: node.right.value, b: 0 };
                return null;
            }
            if (node.op === '/') {
                var l2 = _linearCoeffOf(node.left, vn);
                if (l2 && node.right) {
                    var _rv2 = evalAST(node.right, {});
                    if (isFinite(_rv2) && _rv2 !== 0) {
                        return { a: l2.a / _rv2, b: l2.b / _rv2 };
                    }
                }
                return null;
            }
        }
        return null;
    }
    function collectDomainConstraints(node) {
        if (!node) return [];
        var constraints = [];

        if (node.type === 'func') {
            var arg = node.arg || (node.args ? node.args[0] : null);
            if (arg && arg.type === 'var') {
                var vn = arg.name;
                switch (node.name) {
                    // ── 偶次根: sqrt(x) → x ≥ 0；sqrt(线性表达式) → 线性式 ≥ 0（如 sqrt(5-x) → x ≤ 5）──
                    case 'sqrt':
                        if (arg.type === 'var') {
                            constraints.push({ type: 'domain', varName: vn, min: 0 });
                        } else if (state.varNames.length === 1) {
                            var _ls = _linearCoeffOf(arg, state.varNames[0]);
                            if (_ls && _ls.a !== 0) {
                                if (_ls.a > 0) constraints.push({ type: 'domain', varName: state.varNames[0], min: -_ls.b / _ls.a });
                                else constraints.push({ type: 'domain', varName: state.varNames[0], max: -_ls.b / _ls.a });
                            }
                        }
                        break;

                    // ── 对数: ln(x), log(x), log2(x), log10(x) → x > 0；线性复合参数同理 ──
                    case 'log': case 'ln': case 'log2': case 'log10':
                        if (arg.type === 'var') {
                            constraints.push({ type: 'domain', varName: vn, min: 1e-300 });
                        } else if (state.varNames.length === 1) {
                            var _ll = _linearCoeffOf(arg, state.varNames[0]);
                            if (_ll && _ll.a !== 0) {
                                if (_ll.a > 0) constraints.push({ type: 'domain', varName: state.varNames[0], min: -_ll.b / _ll.a });
                                else constraints.push({ type: 'domain', varName: state.varNames[0], max: -_ll.b / _ll.a });
                            }
                        }
                        break;

                    // ── 反正弦/反余弦: arcsin(x), arccos(x) → x ∈ [-1, 1] ──
                    case 'arcsin': case 'arccos':
                        constraints.push({ type: 'domain', varName: vn, min: -1, max: 1 });
                        break;

                    // ── 反双曲余弦: arccosh(x) → x ≥ 1 ──
                    case 'arccosh':
                        constraints.push({ type: 'domain', varName: vn, min: 1 });
                        break;

                    // ── 反双曲正切: arctanh(x) → x ∈ (-1, 1) ──
                    case 'arctanh':
                        constraints.push({ type: 'domain', varName: vn, min: -1, max: 1 });
                        break;

                    // ── 正切: tan(x) → x ≠ π/2 + kπ（奇点警告） ──
                    case 'tan': case 'sec':
                        state.conditionWarnings.push(node.name + "(x) 有奇点 " + (node.name === 'tan' ? "x = kπ+π/2" : "x = kπ+π/2") + "，求解器无法排除奇点解，结果需人工验证");
                        break;

                    // ── 余切/余割: cot(x), csc(x) → x ≠ kπ ──
                    case 'cot': case 'csc':
                        state.conditionWarnings.push(node.name + "(x) 有奇点 x = kπ，求解器无法排除奇点解，结果需人工验证");
                        break;

                    // ── 反余切/反正割/反余割: 定义域有界的较少见函数 ──
                    case 'arcsec':
                        // arcsec(x) = arccos(1/x), 定义域 |x| ≥ 1
                        constraints.push({ type: 'domain', varName: vn, min: 1 });
                        // 还需要 x ≤ -1，但区间约束只能表示连续区间，所以加警告
                        state.conditionWarnings.push("arcsec(x) 定义域为 |x| ≥ 1，当前仅约束 x ≥ 1，x ≤ -1 部分的解可能被遗漏");
                        break;
                    case 'arccsc':
                        // arccsc(x) = arcsin(1/x), 定义域 |x| ≥ 1
                        constraints.push({ type: 'domain', varName: vn, max: -1 });
                        state.conditionWarnings.push("arccsc(x) 定义域为 |x| ≥ 1，当前仅约束 x ≤ -1，x ≥ 1 部分的解可能被遗漏");
                        break;
                }
            }
            // 递归处理参数（如果参数是复合表达式，需要遍历其子节点提取变量约束）
            if (node.args) node.args.forEach(function(a) { constraints = constraints.concat(collectDomainConstraints(a)); });
            if (node.arg) constraints = constraints.concat(collectDomainConstraints(node.arg));
        }

        if (node.type === 'binop') {
            // ── 除法: 分母 ≠ 0 ──
            if (node.op === '/') {
                constraints = constraints.concat(collectDomainConstraints(node.left));
                constraints = constraints.concat(collectDomainConstraints(node.right));
            }
            // ── 幂运算: x^(1/n) 偶次根 或 x^(-n) 负指数 ──
            else if (node.op === '^') {
                if (node.left.type === 'var') {
                    var vn = node.left.name;
                    var expVal = null;
                    if (node.right.type === 'num') {
                        expVal = node.right.value;
                    } else if (node.right.type === 'binop' && node.right.op === '/' && node.right.left.type === 'num' && node.right.right.type === 'num') {
                        expVal = node.right.left.value / node.right.right.value;
                    }
                    if (expVal !== null) {
                        // 负指数: x^(-n) → x ≠ 0
                        if (expVal < 0) {
                            state.conditionWarnings.push("变量 " + vn + " 出现在负指数 " + expVal.toFixed(4) + " 中，要求 " + vn + " ≠ 0，结果可能包含奇点，需人工验证");
                        }
                        // 正分数指数: x^(1/n) 且 n 为偶数 → x ≥ 0
                        if (expVal > 0 && expVal < 1) {
                            var recip = 1 / expVal;
                            var recipInt = Math.round(recip);
                            if (Math.abs(recip - recipInt) < 1e-10 && recipInt % 2 === 0) {
                                constraints.push({ type: 'domain', varName: vn, min: 0 });
                            }
                        }
                    }
                }
                constraints = constraints.concat(collectDomainConstraints(node.left));
                constraints = constraints.concat(collectDomainConstraints(node.right));
            } else {
                constraints = constraints.concat(collectDomainConstraints(node.left));
                constraints = constraints.concat(collectDomainConstraints(node.right));
            }
        }

        // 递归遍历所有子节点
        if (node.left) constraints = constraints.concat(collectDomainConstraints(node.left));
        if (node.right) constraints = constraints.concat(collectDomainConstraints(node.right));
        if (node.operand) constraints = constraints.concat(collectDomainConstraints(node.operand));
        if (node.arg) constraints = constraints.concat(collectDomainConstraints(node.arg));
        if (node.args) node.args.forEach(function(a) { constraints = constraints.concat(collectDomainConstraints(a)); });
        return constraints;
    }

    var autoConstraints = [];
    for (var ei = 0; ei < state.equations.length; ei++) {
        autoConstraints = autoConstraints.concat(collectDomainConstraints(state.equations[ei]));
    }

    // ========== 结构级方程分析 ==========
    // 1) 乘积 = 非零常数 → 每个因子 ≠ 0
    // 2) 复合分母 → 提取分母变量，警告 ≠ 0
    // 3) 结构矛盾 → sqrt(x) = 负数, exp(x) = 0, |x| = 负数, 平方和 = 负数
    for (var ei = 0; ei < state.equations.length; ei++) {
        var eq = state.equations[ei];
        // 方程形式: f(x) - c = 0 → f(x) = c
        if (eq.type !== 'binop' || eq.op !== '-') continue;
        var lhs = eq.left;
        var rhs = eq.right;
        // 确保右端是常数（支持 num(-2) 和 unary('-', num(2)) 两种形式）
        var cVal = null;
        if (rhs && rhs.type === 'num') {
            cVal = rhs.value;
        } else if (rhs && rhs.type === 'unary' && rhs.op === '-' && rhs.operand && rhs.operand.type === 'num') {
            cVal = -rhs.operand.value;
        }
        if (cVal === null) continue;

        // ── 1) 乘积 = 非零常数 ──
        // 检查左端是否为连续乘积
        if (cVal !== 0) {
            var prodVars = [];
            (function flattenProd(node) {
                if (!node) return;
                if (node.type === 'binop' && node.op === '*') {
                    flattenProd(node.left);
                    flattenProd(node.right);
                } else if (node.type === 'var') {
                    prodVars.push(node.name);
                }
            })(lhs);
            if (prodVars.length >= 2) {
                // 乘积=非零常数，数学上直接推导每个因子≠0，无需输出告警
                // 内部记录约束，供后置校验使用
                if (!state._nonZeroVars) state._nonZeroVars = [];
                prodVars.forEach(function(pv) {
                    if (state._nonZeroVars.indexOf(pv) < 0) state._nonZeroVars.push(pv);
                });
            }
        }

        // ── 2) 复合分母检测（已移除告警，分母约束在 evalAST 自然处理）──

        // ── 3) 结构矛盾检测 ──
        // (a) sqrt(x) = 负数 → 无解（因为 sqrt ≥ 0）
        // 检查左端是否为 sqrt(expr) 且右端为负数
        if (lhs.type === 'func' && lhs.name === 'sqrt' && cVal < 0) {
            state.done = true;
            state.result = {
                solutions: [], error: "NO_SOLUTION",
                message: "结构矛盾：sqrt(x) = " + cVal + " < 0，平方根函数值域 ≥ 0，无实数解",
                executionPath: "定义域自动分析", timeMs: performance.now() - state.startTime,
                confidence: "high", varNames: state.varNames, resultType: 1
            };
            return;
        }
        // (b) exp(x) ≤ 0 → 无解（因为 exp > 0）
        if (lhs.type === 'func' && lhs.name === 'exp' && cVal <= 0) {
            state.done = true;
            state.result = {
                solutions: [], error: "NO_SOLUTION",
                message: "结构矛盾：exp(x) = " + cVal + " ≤ 0，指数函数值域 > 0，无实数解",
                executionPath: "定义域自动分析", timeMs: performance.now() - state.startTime,
                confidence: "high", varNames: state.varNames, resultType: 1
            };
            return;
        }
        // (c) |x| = 负数 → 无解（因为 |x| ≥ 0）
        if (lhs.type === 'func' && lhs.name === 'abs' && cVal < 0) {
            state.done = true;
            state.result = {
                solutions: [], error: "NO_SOLUTION",
                message: "结构矛盾：|x| = " + cVal + " < 0，绝对值函数值域 ≥ 0，无实数解",
                executionPath: "定义域自动分析", timeMs: performance.now() - state.startTime,
                confidence: "high", varNames: state.varNames, resultType: 1
            };
            return;
        }
        // (d) x^2 + y^2 + ... = 负数 → 无解（扩展：支持 x^4, x^6 等偶次幂）
        // 检查左端是否为纯偶次幂和
        if (cVal < 0) {
            var sqTerms = [];
            var hasNonSquare = false;
            (function flattenSum(node) {
                if (!node) return;
                if (node.type === 'binop' && node.op === '+') {
                    flattenSum(node.left);
                    flattenSum(node.right);
                } else if (node.type === 'binop' && node.op === '^' && node.right.type === 'num') {
                    var exp = node.right.value;
                    var expRound = Math.round(exp);
                    if (Math.abs(exp - expRound) < 1e-9 && expRound > 0 && expRound % 2 === 0) {
                        sqTerms.push(node.left);
                    } else {
                        hasNonSquare = true;
                    }
                } else {
                    hasNonSquare = true;
                }
            })(lhs);
            if (sqTerms.length >= 1 && !hasNonSquare) {
                var sqVarNames = [];
                sqTerms.forEach(function(t) {
                    if (t.type === 'var') sqVarNames.push(t.name);
                });
                state.done = true;
                state.result = {
                    solutions: [], error: "NO_SOLUTION",
                    message: "结构矛盾：" + (sqVarNames.length >= 1 ? sqVarNames.join("² + ") + "²" : "偶次幂项") + " = " + cVal + " < 0，偶次幂 ≥ 0，无实数解",
                    executionPath: "定义域自动分析", timeMs: performance.now() - state.startTime,
                    confidence: "high", varNames: state.varNames, resultType: 1
                };
                return;
            }
        }
        // (e) sin(x) = c, |c| > 1 或 cos(x) = c, |c| > 1 → 无解（三角函数值域 [-1, 1]）
        if (lhs.type === 'func' && (lhs.name === 'sin' || lhs.name === 'cos') && Math.abs(cVal) > 1 + 1e-12) {
            state.done = true;
            state.result = {
                solutions: [], error: "NO_SOLUTION",
                message: "结构矛盾：" + lhs.name + "(x) = " + cVal + "，三角函数值域 [-1, 1]，无实数解",
                executionPath: "定义域自动分析", timeMs: performance.now() - state.startTime,
                confidence: "high", varNames: state.varNames, resultType: 1
            };
            return;
        }
        // (f) 非零常数 / expr = 0 → 无解（分子非零的分式不可能等于 0）
        if (cVal === 0 && lhs.type === 'binop' && lhs.op === '/' && lhs.left.type === 'num' && Math.abs(lhs.left.value) > 1e-15) {
            state.done = true;
            state.result = {
                solutions: [], error: "NO_SOLUTION",
                message: "结构矛盾：分子 " + lhs.left.value + " ≠ 0，分式方程不可能等于 0，无实数解",
                executionPath: "定义域自动分析", timeMs: performance.now() - state.startTime,
                confidence: "high", varNames: state.varNames, resultType: 1
            };
            return;
        }
        // (g) 非负项之和 = 负数 → 无解（sqrt + |x| + x^2 + ... = 负数）
        // 检测 sqrt(x) + |y| + 偶次幂 + ... = 负数
        if (cVal < 0) {
            var nonnegTerms = [];
            var hasOther = false;
            (function flattenSum2(node) {
                if (!node) return;
                if (node.type === 'binop' && node.op === '+') {
                    flattenSum2(node.left);
                    flattenSum2(node.right);
                } else if (node.type === 'func' && (node.name === 'sqrt' || node.name === 'abs' || node.name === 'exp')) {
                    nonnegTerms.push(node);
                } else if (node.type === 'binop' && node.op === '^' && node.right.type === 'num') {
                    var exp = node.right.value;
                    var expRound = Math.round(exp);
                    if (Math.abs(exp - expRound) < 1e-9 && expRound > 0 && expRound % 2 === 0) {
                        nonnegTerms.push(node);
                    } else {
                        hasOther = true;
                    }
                } else {
                    hasOther = true;
                }
            })(lhs);
            if (nonnegTerms.length >= 1 && !hasOther) {
                state.done = true;
                state.result = {
                    solutions: [], error: "NO_SOLUTION",
                    message: "结构矛盾：非负项之和 = " + cVal + " < 0，各项均 ≥ 0，无实数解",
                    executionPath: "定义域自动分析", timeMs: performance.now() - state.startTime,
                    confidence: "high", varNames: state.varNames, resultType: 1
                };
                return;
            }
        }
        // (h) x^0 = c, c ≠ 1 → 无解（x^0 ≡ 1，任何非零实数的 0 次幂 = 1）
        // 检测左端是否为 expr^0 形式
        if (lhs.type === 'binop' && lhs.op === '^' && lhs.right.type === 'num' && Math.abs(lhs.right.value) < 1e-12 && Math.abs(cVal - 1) > 1e-12) {
            state.done = true;
            state.result = {
                solutions: [], error: "NO_SOLUTION",
                message: "结构矛盾：表达式^0 = " + cVal + " ≠ 1，任何非零实数的 0 次幂 = 1，无实数解",
                executionPath: "定义域自动分析", timeMs: performance.now() - state.startTime,
                confidence: "high", varNames: state.varNames, resultType: 1
            };
            return;
        }
        // (i) a^x = c ≤ 0（a > 0 常数）→ 无解（正数的任意次幂 > 0）
        // 检测左端是否为 常数正数 ^ 表达式 形式，且右端 ≤ 0
        if (lhs.type === 'binop' && lhs.op === '^' && lhs.left.type === 'num' && lhs.left.value > 0 && cVal <= 0) {
            state.done = true;
            state.result = {
                solutions: [], error: "NO_SOLUTION",
                message: "结构矛盾：" + lhs.left.value + "^x = " + cVal + " ≤ 0，正数的任意实数次幂 > 0，无实数解",
                executionPath: "定义域自动分析", timeMs: performance.now() - state.startTime,
                confidence: "high", varNames: state.varNames, resultType: 1
            };
            return;
        }
        // (j) sqrt(x) = 0 且 x 有定义域约束 ≥ 正数 → 但从结构上无法直接判断，留给后续算子
    }

    // 将收集到的约束合并到 state.domainConstraints
    if (autoConstraints.length > 0) {
        autoConstraints.forEach(function(ac) {
            if (ac.type === 'domain') {
                state.domainConstraints.push(ac);
            }
        });
    }

    // 自动推导的约束已存入 state.domainConstraints
    // 与当前 D0 求交集（单向缩小：Dₙₑw ⊆ Dₒₗd）
    if (autoConstraints.length > 0) {
        var _hasContradiction = false;
        for (var _dci8 = 0; _dci8 < state.domainConstraints.length; _dci8++) {
            var _dc8 = state.domainConstraints[_dci8];
            var _vn8 = _dc8.varName;
            if (state.D0[_vn8]) {
                if (_dc8.min !== undefined) {
                    state.D0[_vn8].min = Math.max(state.D0[_vn8].min, _dc8.min);
                }
                if (_dc8.max !== undefined) {
                    state.D0[_vn8].max = Math.min(state.D0[_vn8].max, _dc8.max);
                }
                if (state.D0[_vn8].min > state.D0[_vn8].max) {
                    _hasContradiction = true; break;
                }
            }
        }
        if (_hasContradiction) {
            state.done = true;
            state.result = {
                solutions: [], error: "NO_SOLUTION",
                message: "自动定义域推导：变量搜索域为空，无解",
                executionPath: "定义域自动分析", timeMs: performance.now() - state.startTime,
                confidence: "high", varNames: state.varNames, resultType: 1
            };
        }
    }
}
