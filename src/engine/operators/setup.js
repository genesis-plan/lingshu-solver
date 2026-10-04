/* 模块 operators/setup：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function suan1(state) {
    var eqStrs = state.equationStrs;
    state.equations = [];
    // 忠实（未消分母）方程 AST 快照：用于结果层"良定义"校验（见 _filterIllDefined）。
    // 注意 suan23 会把分式交叉相乘消分母，产生"分母零点"的伪根（如 sin(x)/x=0 → sin(x)=0·x，x=0 处 0/0 未定义）。
    // 故保留解析后的原始等式 AST（含除法），在收尾时回代校验真解是否在原式上有定义。
    state.userEquations = [];
    state.domainConstraints = [];
    state.conditionWarnings = [];
    state.integerConstraintUnenforced = false;
    state.inequalityConstraints = [];

    for (var i = 0; i < eqStrs.length; i++) {
        var eqStr = eqStrs[i];

        // 检测复杂不等式（<=, >=, <, > 运算符）
        if (/<=|>=|<|>/.test(eqStr)) {
            var cond = parseCondition(eqStr);
            if (cond) {
                if (cond.type === "domain") {
                    state.domainConstraints.push(cond);
                    // 将域约束也作为不等式约束加入，供 suan48 枚举 + 终态不等式闸门使用
                    // 🔴 2026-10-04 修 P0：严格性过去在这里被丢弃（min/max 一律写 >= / <=）。
                    //   实测 `x^2=0` + `x>0` 返回解 x=0 —— x=0 违反 x>0，真解集是空集。
                    //   病根：parseCondition 早期就把严格性抹了（现已修好，带出 minStrict/maxStrict），
                    //   这里若不透传，严格信息就在第二道工序再丢一次。
                    //   ⇒ 严格不等式按严格语义落进 inequalityConstraints，
                    //     终态闸门 verifyAllConstraints 才有资格判「这个点违反约束」。
                    if (cond.varName && cond.min !== undefined) {
                        var _vAST = parse(tokenize(cond.varName, state.protNames));
                        var _cAST = { type: "num", value: cond.min };
                        state.inequalityConstraints.push({
                            lhs: _vAST, rhs: _cAST,
                            op: (cond.minStrict === true) ? ">" : ">=",
                            lhsStr: cond.varName, rhsStr: String(cond.min)
                        });
                    }
                    if (cond.varName && cond.max !== undefined) {
                        var _vAST2 = parse(tokenize(cond.varName, state.protNames));
                        var _cAST2 = { type: "num", value: cond.max };
                        state.inequalityConstraints.push({
                            lhs: _vAST2, rhs: _cAST2,
                            op: (cond.maxStrict === true) ? "<" : "<=",
                            lhsStr: cond.varName, rhsStr: String(cond.max)
                        });
                    }
                    continue;
                }
                if (cond.type === "warn") { state.conditionWarnings.push(cond.message); if (cond.kind === 'integer-unenforced') state.integerConstraintUnenforced = true; continue; }
                if (cond.type === "skip") continue;
            }
            var ineqMatch = eqStr.match(/^(.*?)\s*(<=|>=|<|>)\s*(.*)$/);
            if (ineqMatch) {
                var lhs = ineqMatch[1].trim();
                var op = ineqMatch[2];
                var rhs = ineqMatch[3].trim();
                if (lhs && rhs) {
                    var leftFixed = fuzzyFix(lhs, state.protNames);
                    var rightFixed = fuzzyFix(rhs, state.protNames);
                    var _ineqLeft = null, _ineqRight = null, _ineqErr = null;
                    try {
                        _ineqLeft = parse(tokenize(leftFixed, state.protNames));
                        _ineqRight = parse(tokenize(rightFixed, state.protNames));
                    } catch (e) { _ineqErr = e; }
                    if (_ineqErr) {
                        // 解析失败不静默丢弃：记入用户可见 warning，保持"没解出来也要说清为什么"
                        state.conditionWarnings.push("约束无法解析：" + eqStr + "（" + _ineqErr.message + "）");
                        continue;
                    }
                    state.inequalityConstraints.push({
                        lhs: _ineqLeft, rhs: _ineqRight, op: op,
                        lhsStr: lhs, rhsStr: rhs
                    });
                    // 不等式不加入 equations 数组，避免主流水线将其作为方程求解
                    continue;
                }
            }
        }

        if (eqStr.indexOf("=") < 0) {
            var cond = parseCondition(eqStr);
            if (cond) {
                if (cond.type === "domain") {
                    state.domainConstraints.push(cond);
                    // 🔴 2026-10-04 修 P0（同上）：这条路径过去**只**推 domainConstraints、
                    //   不推 inequalityConstraints ⇒ 形如 `x∈[-30,30]`、`x∈(0,1)` 的约束
                    //   终态闸门完全看不到，违反它的候选解会原样输出给 Agent。
                    //   （`x>0` 走的是上面 21 行那条路径，因为串里含 `<`/`>`；本条是无比较符的区间形态。）
                    if (cond.varName) {
                        try {
                            var _pAST = parse(tokenize(cond.varName, state.protNames));
                            if (cond.min !== undefined) {
                                state.inequalityConstraints.push({
                                    lhs: _pAST, rhs: { type: "num", value: cond.min },
                                    op: (cond.minStrict === true) ? ">" : ">=",
                                    lhsStr: cond.varName, rhsStr: String(cond.min)
                                });
                            }
                            if (cond.max !== undefined) {
                                state.inequalityConstraints.push({
                                    lhs: _pAST, rhs: { type: "num", value: cond.max },
                                    op: (cond.maxStrict === true) ? "<" : "<=",
                                    lhsStr: cond.varName, rhsStr: String(cond.max)
                                });
                            }
                        } catch (e) {
                            _lsNoteInternal(e, 'setup.js: 域约束转不等式 AST 失败，仅记 domainConstraints（终态闸门将看不到该约束），有意忽略');
                        }
                    }
                    continue;
                }
                if (cond.type === "warn") { state.conditionWarnings.push(cond.message); if (cond.kind === 'integer-unenforced') state.integerConstraintUnenforced = true; continue; }
            }
            continue;
        }
        var parts = eqStr.split("=");
        if (parts.length < 2) continue;
        var leftFixed = fuzzyFix(parts[0].trim(), state.protNames);
        var rightFixed = fuzzyFix(parts.slice(1).join("=").trim(), state.protNames);
        var leftAST = null, rightAST = null, _eqErr = null;
        try {
            leftAST = parse(tokenize(leftFixed, state.protNames));
            rightAST = parse(tokenize(rightFixed, state.protNames));
        } catch (e) { _eqErr = e; }
        if (_eqErr) {
            // 解析失败不静默丢弃：记入用户可见 warning，避免用户困惑"为什么没解出来"
            state.conditionWarnings.push("方程无法解析：" + eqStr + "（" + _eqErr.message + "）");
            continue;
        }
        state.equations.push({ type: "binop", op: "-", left: leftAST, right: rightAST });
        // 快照忠实等式 AST（深拷贝，防止后续算子就地改写污染）：含未消分母的原始形态
        state.userEquations.push(JSON.parse(JSON.stringify({ type: "binop", op: "-", left: leftAST, right: rightAST })));
    }

    if (state.equations.length === 0 && state.inequalityConstraints.length === 0) {
        state.done = true;
        state.result = { solutions: [], error: "NO_EQUATION", message: "未找到有效的方程", varNames: state.varNames, resultType: 1, resultTypeName: "空结果", resultTypeDesc: "未输入方程，无任何约束" };
        return;
    }

    // 纯不等式系统标记
    if (state.equations.length === 0 && state.inequalityConstraints.length > 0) {
        state.isInequalityOnly = true;
    }

    // 自动提取变量（从方程和不等式约束中提取）
    if (!state.varNames || state.varNames.length === 0) {
        state.varNames = [];
        state.equations.forEach(function(eq) {
            extractVariables(eq).forEach(function(vn) {
                if (!state.varNames.includes(vn)) state.varNames.push(vn);
            });
        });
        state.inequalityConstraints.forEach(function(c) {
            extractVariables(c.lhs).forEach(function(vn) {
                if (!state.varNames.includes(vn)) state.varNames.push(vn);
            });
            extractVariables(c.rhs).forEach(function(vn) {
                if (!state.varNames.includes(vn)) state.varNames.push(vn);
            });
        });
    }
}


function suan2(state) {
    if (!state.varNames || state.varNames.length === 0) {
        state.varNames = [];
        state.equations.forEach(function(eq) {
            extractVariables(eq).forEach(function(vn) {
                if (!state.varNames.includes(vn)) state.varNames.push(vn);
            });
        });
    } else {
        // 无关变量剔除：调用方声明的变量若在方程中从未出现（如 MCP 传错变量名），
        // 直接剔除，避免对无关变量做全域 ±1e6 搜索导致秒级空转（曾实测 6.2s）。
        // 剔除名单记入 state.unusedDeclaredVars 供审计；方程中实际出现但未声明的
        // 变量仍会被追加，保证不漏解（保持原有兼容行为）。
        var _actualVars = new Set();
        state.equations.forEach(function(eq) {
            extractVariables(eq).forEach(function(vn) { _actualVars.add(vn); });
        });
        // 不等式约束中的变量同样视为"实际出现"（纯不等式系统 equations 为空，
        // 若不收集会误把所有声明变量判为无关变量剔除 → varNames 清空 → 误判无解）
        (state.inequalityConstraints || []).forEach(function(c) {
            if (c && c.lhs) extractVariables(c.lhs).forEach(function(vn) { _actualVars.add(vn); });
            if (c && c.rhs) extractVariables(c.rhs).forEach(function(vn) { _actualVars.add(vn); });
        });
        var _unused = [];
        var _kept = [];
        state.varNames.forEach(function(vn) {
            if (_actualVars.has(vn)) _kept.push(vn);
            else _unused.push(vn);
        });
        if (_unused.length) {
            state.unusedDeclaredVars = _unused;
            state.varNames = _kept;
        }

    }
    state.varCount = state.varNames.length;
}


function suan3(state) {
    if (state.varNames.length > 6) {
        state.done = true;
        state.result = {
            solutions: [],
            error: "OVER_LIMIT",
            message: "变量数 " + state.varNames.length + " 超过上限（6个），无法求解",
            varNames: state.varNames,
            resultType: 1, resultTypeName: "空结果", resultTypeDesc: "变量数超过求解器上限"
        };
    }
}
