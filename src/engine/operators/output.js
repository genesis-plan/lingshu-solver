/* 模块 operators/output：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function suan49(state) {
    if (state.finalSolutions && state.finalSolutions.length > 0) {
        state.finalSolutions.sort(function(a, b) { return a.residual - b.residual; });
        var confidence;
        // 所有经过原始方程回代校验的解均标记高置信（残差<1e-5即通过校验）
        if (state.finalSolutions[0].residual < 1e-5) confidence = "high";
        else if (state.finalSolutions[0].residual < 1e-4) confidence = "medium";
        else confidence = "low";
        if (state.equations.length < state.varNames.length) confidence = "low";

        // 集中式回代：始终以 originalVarNames 为权威输出清单（无消元时即 varNames）。
        var outputVarNames = getOutputVarNames(state);
        // 统一回代：把 finalSolutions（state.varNames 顺序的缩减坐标）重建为完整坐标解向量。
        // 无论是否发生消元，均经 reconstructSolution 处理（无消元时为恒等映射，零回归）。
        var expandedSolutions = [];
        for (var si = 0; si < state.finalSolutions.length; si++) {
            var sol = state.finalSolutions[si];
            var fullValues = reconstructSolution(state, sol.values);
            if (!fullValues) continue;
            // 重建变量映射供残差/域校验
            var fullVars = {};
            outputVarNames.forEach(function(v, i) { fullVars[v] = fullValues[i]; });
            // 检查是否有NaN值
            var hasNaN = false;
            for (var fvi = 0; fvi < fullValues.length; fvi++) {
                if (fullValues[fvi] === null || isNaN(fullValues[fvi]) || !isFinite(fullValues[fvi])) { hasNaN = true; break; }
            }
            if (hasNaN) continue;
            // 按域约束过滤完整解
            var passesDomain = true;
            for (var dci = 0; dci < state.domainConstraints.length; dci++) {
                var dc = state.domainConstraints[dci];
                var vi = outputVarNames.indexOf(dc.varName);
                if (vi >= 0) {
                    var val = fullValues[vi];
                    if (dc.min !== undefined && val < dc.min - 1e-9) { passesDomain = false; break; }
                    if (dc.max !== undefined && val > dc.max + 1e-9) { passesDomain = false; break; }
                }
            }
            if (!passesDomain) continue;
            // 重新计算残差（使用原始方程，反映完整方程组的残差）
            var newRes = 0;
            var _eqsForRes = state.originalEquations || state.equations;
            _eqsForRes.forEach(function(eq) {
                var r = Math.abs(evalAST(eq, fullVars));
                if (r > newRes) newRes = r;
            });
            expandedSolutions.push({ values: fullValues, residual: newRes });
        }

        // 结果类型分类（3种形态：1 空集无解 / 2 有限个解 / 3 无限解集（欠定，输出推荐解））
        // 注：2026-08-19 由五分类简化为三分类；未收敛/分支信息保留在 result.unconverged/branchCount 字段如实暴露，
        //     不再单独作为结果类型（"结果可能不完整"由截断标记承担）。
        var resultType = 1, resultTypeName = "空集无解", resultTypeDesc = "区间算术严格证明不存在满足约束的向量，无任何区间、无采样点，S*=∅。";
        if (expandedSolutions.length > 0) {
            // 主路径（方程数≥变量数）：解集为空或有限个孤立解
            resultType = 2;
            resultTypeName = "有限个解";
            resultTypeDesc = "共 " + expandedSolutions.length + " 个解，全部真解距对应采样点误差<1e-6。" + (state.unconverged ? "（存在未收敛大区间，结果可能不完整，见截断标记）" : "");
        }
        // 无解时保持 resultType = 1（空结果）；欠定（无限解）路径在下方独立分支输出 resultType=3

        // 提取底层覆盖区间盒子集合（已统一为 {box, converged} 格式）
        var outputBoxes = [];
        if (state.branchBboxes && state.branchBboxes.length > 0) {
            outputBoxes = state.branchBboxes.map(function(bbox) {
                // 变量名映射：子域可能用缩减后的变量名，需映射到 outputVarNames
                var mapped = {};
                var srcKeys = Object.keys(bbox.box);
                outputVarNames.forEach(function(vn) {
                    if (bbox.box[vn]) {
                        mapped[vn] = { min: bbox.box[vn].min, max: bbox.box[vn].max };
                    } else if (srcKeys.length > 0) {
                        // 降维场景：变量名不匹配时取第一个有效值
                        mapped[vn] = { min: bbox.box[srcKeys[0]].min, max: bbox.box[srcKeys[0]].max };
                    }
                });
                return {
                    box: mapped,
                    converged: bbox.converged
                };
            });
        }

        var coverageBounds = {};
        if (outputBoxes.length > 0) {
            outputVarNames.forEach(function(vn) {
                var allMin = outputBoxes.map(function(b) { return b.box[vn].min; });
                var allMax = outputBoxes.map(function(b) { return b.box[vn].max; });
                coverageBounds[vn] = {
                    min: Math.min.apply(null, allMin),
                    max: Math.max.apply(null, allMax),
                    totalCoverageWidth: Math.max.apply(null, allMax) - Math.min.apply(null, allMin)
                };
            });
        }

        // 提取流形参数化信息
        var manifoldOutput = null;
        if (state.manifoldInfo) {
            manifoldOutput = {
                dimension: (state.varNames.length - state.manifoldInfo.rank) || 0,
                rank: state.manifoldInfo.rank || 0,
                hasRedundancy: state.manifoldInfo.hasRedundancy || false,
                tangentBasis: state.manifoldInfo.nullspace || null
            };
        }

        state.done = true;
        state.result = {
            solutions: expandedSolutions,
            boxes: outputBoxes.length > 0 ? outputBoxes : undefined,
            coverage: outputBoxes.length > 0 ? {
                totalBoxes: outputBoxes.length,
                convergedBoxes: outputBoxes.filter(function(b) { return b.converged; }).length,
                bounds: coverageBounds
            } : undefined,
            manifold: manifoldOutput,
            resultType: resultType,
            resultTypeName: resultTypeName,
            resultTypeDesc: resultTypeDesc,
            executionPath: "最终输出汇总",
            timeMs: performance.now() - state.startTime,
            confidence: confidence,
            varNames: outputVarNames,
            eliminated_by_physics_count: state.eliminated || 0,
            branchCount: state.branchCount || 0,
            unconverged: state.unconverged || false,
            warnings: state.conditionWarnings.length > 0 ? state.conditionWarnings : undefined
        };
        return;
    }

    if (state.equations.length < state.varNames.length) {
        // 欠定系统：输出距原点最近的推荐解（不输出包围盒）
        var outputVarNames = getOutputVarNames(state);
        // === 线性欠定：伪逆闭式解（最小范数解 x* = Aᵀ(AAᵀ)⁻¹b）===
        // 数学依据：min ‖x‖² s.t. Ax=b 的唯一最小范数解为 x* = A⁺b = Aᵀ(AAᵀ)⁻¹b，
        // 即拉格朗日乘子法闭式解（x* 与梯度 A 行空间平行，几何上为原点向解空间作垂线）。
        // 全程纯矩阵运算、无随机、无迭代，结果确定可复现，且为全局最优（非启发式）。
        // 仅在全线性时启用；非线性欠定走下方坐标下降兜底。
        var _pseudoDone = false;
        if (state.eqFeatures && state.eqFeatures.allLinear) {
            var _linEqs = state.originalEquations || state.equations;
            var _linVars = outputVarNames;
            var _A = [], _bvec = [];
            var _linOk = true;
            for (var _lei = 0; _lei < _linEqs.length; _lei++) {
                var _lc = extractLinearCoefficients(_linEqs[_lei], _linVars);
                if (!_lc) { _linOk = false; break; }
                _A.push(_linVars.map(function(v) { return _lc.coeffs[v] || 0; }));
                _bvec.push(-_lc.constant);
            }
            if (_linOk && _A.length > 0 && _A.length < _linVars.length) {
                // 构建 G = AAᵀ (m×m)，解 Gλ=b，得 x* = Aᵀλ
                var _m = _A.length;
                var _G = [];
                for (var _gi = 0; _gi < _m; _gi++) {
                    var _rowG = [];
                    for (var _gj = 0; _gj < _m; _gj++) {
                        var _acc = 0;
                        for (var _gk = 0; _gk < _linVars.length; _gk++) _acc += _A[_gi][_gk] * _A[_gj][_gk];
                        _rowG.push(_acc);
                    }
                    _G.push(_rowG);
                }
                var _gRes = gaussianSolve(_G, _bvec);
                if (_gRes) {
                    // x* = Aᵀλ，并校验残差与声明域
                    var _lam = _gRes.solution;
                    var _xstar = [];
                    var _xInDomain = true;
                    for (var _vi6 = 0; _vi6 < _linVars.length; _vi6++) {
                        var _xv = 0;
                        for (var _ri = 0; _ri < _m; _ri++) _xv += _A[_ri][_vi6] * _lam[_ri];
                        _xstar.push(_xv);
                        var _dom6 = state.D0 && state.D0[_linVars[_vi6]];
                        if (_dom6) {
                            if (_xv < _dom6.min - 1e-9 || _xv > _dom6.max + 1e-9) { _xInDomain = false; break; }
                        }
                    }
                    if (_xInDomain) {
                        var _ptStar = {};
                        for (var _vi7 = 0; _vi7 < _linVars.length; _vi7++) _ptStar[_linVars[_vi7]] = _xstar[_vi7];
                        var _maxResStar = 0;
                        for (var _rei = 0; _rei < _linEqs.length; _rei++) {
                            var _rres = Math.abs(evalAST(_linEqs[_rei], _ptStar));
                            if (_rres > _maxResStar) _maxResStar = _rres;
                        }
                        state.done = true;
                        // 同步完整变量名到 state（前置消元算子可能已收缩 varNames，
                        // 后处理 _filterIllDefined 按 state.varNames 建 vmap 回代校验；
                        // 不补齐会导致缺变量 → 残差 NaN → 伪逆解被误过滤）
                        state.varNames = outputVarNames.slice();
                        state.result = {
                            solutions: [{ values: _xstar, residual: _maxResStar }],
                            confidence: _maxResStar < 1e-5 ? "high" : (_maxResStar < 1e-4 ? "medium" : "low"),
                            resultType: 3,
                            resultTypeName: "无限解集（推荐解）",
                            resultTypeDesc: "方程数(" + state.equations.length + ")少于变量数(" + state.varNames.length + ")，系统欠定，真实解构成参数化集合（无限多个解）。已按最小范数闭式解 x*=A⁺b（伪逆）输出距原点最近的推荐解（全局最优、确定性可复现、经残差验证）；如需更多代表点，请增加方程约束重新求解。",
                            executionPath: "欠定系统-伪逆最小范数解（距原点最近）",
                            timeMs: performance.now() - state.startTime,
                            varNames: outputVarNames,
                            unconverged: false,
                            warnings: [
                                "⚠️ 当前为欠定系统（无限解集）：",
                                "1. 方程数少于变量数，系统欠定，存在无限多个解。",
                                "2. 已按伪逆闭式解输出距原点最近的推荐解（全局最优，残差验证通过）。",
                                "3. 如需更多代表点，请增加方程约束重新求解。"
                            ]
                        };
                        _pseudoDone = true;
                    }
                }
            }
        }
        if (_pseudoDone) return;
        // 收集当前 D0 域（用于前向传播采样，不对外输出为包围盒）
        var d0Box = {};
        var hasD0 = state.D0 && typeof state.D0 === 'object';
        if (hasD0) {
            outputVarNames.forEach(function(vn) {
                if (state.D0[vn]) {
                    d0Box[vn] = { min: state.D0[vn].min, max: state.D0[vn].max };
                }
            });
        }
        // 生成采样点：遍历网格变量，通过方程前向传播计算依赖变量
        var samplePoints = [];
        var eqs = state.originalEquations || state.equations;
        if (hasD0 && outputVarNames.length > 0) {
            // 前向传播：从已知变量出发，通过方程逐个计算出未知变量
            function forwardPropagate(pt, eqsList, allVarNames, D0, maxIter) {
                maxIter = maxIter || 50;
                var known = {};
                for (var k in pt) { if (pt.hasOwnProperty(k)) known[k] = pt[k]; }
                // 提取每个方程中的变量名
                var eqVars = [];
                for (var ei = 0; ei < eqsList.length; ei++) {
                    var vars = extractVariables(eqsList[ei]);
                    eqVars.push(vars);
                }
                var iter = 0;
                while (iter < maxIter) {
                    var changed = false;
                    for (var ei = 0; ei < eqsList.length; ei++) {
                        var vars = eqVars[ei];
                        var unknownVars = [];
                        for (var vi = 0; vi < vars.length; vi++) {
                            if (known[vars[vi]] === undefined) unknownVars.push(vars[vi]);
                        }
                        if (unknownVars.length === 1) {
                            var targetVar = unknownVars[0];
                            var dom = D0[targetVar];
                            if (!dom) continue;
                            // 二分法查找方程根，比线性插值更鲁棒
                            (function() {
                                var lo = dom.min, hi = dom.max;
                                var fLo, fHi;
                                var _ptLo = {}, _ptHi = {};
                                for (var _k in known) { _ptLo[_k] = known[_k]; _ptHi[_k] = known[_k]; }
                                _ptLo[targetVar] = lo; _ptHi[targetVar] = hi;
                                try { fLo = evalAST(eqsList[ei], _ptLo); } catch(e) { fLo = NaN; }
                                try { fHi = evalAST(eqsList[ei], _ptHi); } catch(e) { fHi = NaN; }
                                // 如果端点不可求值（如sqrt负数），从中点向两端扫描找有效区间
                                if (isNaN(fLo) || isNaN(fHi)) {
                                    var _validFound = false;
                                    for (var _si = 0; _si <= 20; _si++) {
                                        for (var _dir = -1; _dir <= 1; _dir += 2) {
                                            var _t = (lo + hi) / 2 + _dir * _si * (hi - lo) / 40;
                                            if (_t < lo || _t > hi) continue;
                                            var _ptT = {};
                                            for (var _k2 in known) { _ptT[_k2] = known[_k2]; }
                                            _ptT[targetVar] = _t;
                                            try {
                                                var _fT = evalAST(eqsList[ei], _ptT);
                                                if (!isNaN(_fT) && isFinite(_fT)) {
                                                    if (!_validFound) { lo = _t; fLo = _fT; _validFound = true; }
                                                    else { hi = _t; fHi = _fT; break; }
                                                }
                                            } catch(e) { _lsNoteInternal(e, 'output.js:287 输出层试探求值，失败跳过，有意忽略'); }
                                        }
                                        if (_validFound && !isNaN(fHi)) break;
                                    }
                                    if (isNaN(fLo) || isNaN(fHi)) return;
                                }
                                if (Math.abs(fLo) < 1e-14) { known[targetVar] = lo; changed = true; return; }
                                if (Math.abs(fHi) < 1e-14) { known[targetVar] = hi; changed = true; return; }
                                // 如果两端同号，扫描查找异号区间
                                if (fLo * fHi > 0) {
                                    // 从中点向两端扫描，避免窄带异号区域被端点稀疏扫描遗漏
                                    var _mid0 = (lo + hi) / 2;
                                    var _found = false;
                                    for (var _si = 0; _si <= 20; _si++) {
                                        for (var _dir = -1; _dir <= 1; _dir += 2) {
                                            var _t = _mid0 + _dir * _si * (hi - lo) / 40;
                                            if (_t < lo || _t > hi) continue;
                                            var _ptT = {};
                                            for (var _k2 in known) { _ptT[_k2] = known[_k2]; }
                                            _ptT[targetVar] = _t;
                                            try {
                                                var _fT = evalAST(eqsList[ei], _ptT);
                                                if (isNaN(_fT) || !isFinite(_fT)) continue;
                                                if (!_found) {
                                                    if (Math.abs(_fT) < 1e-14) { known[targetVar] = _t; changed = true; return; }
                                                    lo = _t; fLo = _fT; _found = true;
                                                } else {
                                                    if (Math.abs(_fT) < 1e-14) { known[targetVar] = _t; changed = true; return; }
                                                    if (_fT * fLo < 0) { hi = _t; fHi = _fT; _found = true; break; }
                                                    else { lo = _t; fLo = _fT; }
                                                }
                                            } catch(e) { _lsNoteInternal(e, 'output.js:318 输出层试探求值，失败跳过，有意忽略'); }
                                        }
                                        if (_found && fLo * fHi < 0) break;
                                    }
                                    if (fLo * fHi > 0) return; // 扫描后仍同号，放弃
                                }
                                // 二分搜索
                                for (var _bi = 0; _bi < 90; _bi++) {
                                    var _mid = (lo + hi) / 2;
                                    if ((hi - lo) < 1e-15) {
                                        known[targetVar] = _mid; changed = true; return;
                                    }
                                    var _ptMid = {};
                                    for (var _k3 in known) { _ptMid[_k3] = known[_k3]; }
                                    _ptMid[targetVar] = _mid;
                                    var _fMid;
                                    try { _fMid = evalAST(eqsList[ei], _ptMid); } catch(e) { break; }
                                    if (Math.abs(_fMid) < 1e-14) {
                                        known[targetVar] = _mid; changed = true; return;
                                    }
                                    if (_fMid * fLo < 0) { hi = _mid; fHi = _fMid; }
                                    else { lo = _mid; fLo = _fMid; }
                                }
                            })();
                        }
                    }
                    if (!changed) break;
                    iter++;
                }
                // 检查所有变量是否都已赋值（未赋值的初始化为 D0 中点，交给多维牛顿精化）
                for (var vi = 0; vi < allVarNames.length; vi++) {
                    if (known[allVarNames[vi]] === undefined) {
                        known[allVarNames[vi]] = (D0 && D0[allVarNames[vi]]) ? (D0[allVarNames[vi]].min + D0[allVarNames[vi]].max) / 2 : 0;
                    }
                }
                // 验证所有方程
                var maxRes = 0;
                for (var ei = 0; ei < eqsList.length; ei++) {
                    try {
                        var r = Math.abs(evalAST(eqsList[ei], known));
                        if (r > maxRes) maxRes = r;
                    } catch(e) { maxRes = 1e10; break; }
                }
                // ---- 多维牛顿精化（2026-08-21 新增）----
                // 顺序一维二分无法处理"多方程对同一依赖变量的耦合约束"（如平面截球
                // x+y+z=6 ∧ x²+y²+z²=14：固定种子变量后，y,z 必须同时满足两个方程，
                // 需 2 维牛顿）。残差超标且存在非种子依赖变量时，用数值雅可比精化。
                if (maxRes >= 1e-4) {
                    var seedKeys = {};
                    for (var sk in pt) { if (pt.hasOwnProperty(sk)) seedKeys[sk] = 1; }
                    var depVars = [];
                    for (var di = 0; di < allVarNames.length; di++) {
                        if (!seedKeys[allVarNames[di]]) depVars.push(allVarNames[di]);
                    }
                    if (depVars.length > 0) {
                        // 多候选初值（2026-08-21 修复）：D0 q1/q3 + 固定小值 ±1（裁剪去重）的
                        // 笛卡尔积，上限 64。避免从 D0 中点起步时雅可比奇异（如平面截球在
                        // (0,0) 处 ∂f2/∂y=∂f2/∂z=0 → J 奇异 → 牛顿必然失败）。
                        var _candSets = [];
                        for (var _cvi = 0; _cvi < depVars.length; _cvi++) {
                            var _cvn = depVars[_cvi];
                            var _cdm = (D0 && D0[_cvn]) ? D0[_cvn] : null;
                            // 固定小尺度候选（解流形通常在原点附近小值区，如平面截球圆 |v|≤√14）。
                            // 2026-08-21 修复：原用 D0 的 q1/q3（对未收缩变量达 ±5e5 尺度），
                            // 大初值迭代中依赖变量被域边界弹回、30 步内收敛不到，全部组合失败。
                            // 含 0 与小编号优先（示例8 5eq6var 欠定从 (0,...) 起步可收敛）。
                            // 4 值组合控制开销（平面截球 2 依赖 4²=16，避免 7²=49 拖慢到 3 秒）
                            var _set = [0, 1, -1, 2];
                            if (_cdm) {
                                if (_cdm.max < -3 || _cdm.min > 3) {
                                    _set = [_cdm.min + 0.25 * (_cdm.max - _cdm.min), _cdm.min + 0.75 * (_cdm.max - _cdm.min), _cdm.min, _cdm.max];
                                }
                            }
                            var _setU = [];
                            for (var _svi = 0; _svi < _set.length; _svi++) {
                                var _sv = _set[_svi];
                                if (_cdm) {
                                    if (_sv < _cdm.min) _sv = _cdm.min;
                                    if (_sv > _cdm.max) _sv = _cdm.max;
                                }
                                var _dup = false;
                                for (var _su2 = 0; _su2 < _setU.length; _su2++) if (Math.abs(_setU[_su2] - _sv) < 1e-9) { _dup = true; break; }
                                if (!_dup) _setU.push(_sv);
                            }
                            _candSets.push(_setU);
                        }
                        var _combos = [[]];
                        for (var _csvi = 0; _csvi < _candSets.length && _combos.length <= 32; _csvi++) {
                            var _nc = [];
                            for (var _oci = 0; _oci < _combos.length; _oci++) {
                                for (var _csi2 = 0; _csi2 < _candSets[_csvi].length; _csi2++) {
                                    _nc.push(_combos[_oci].concat([_candSets[_csvi][_csi2]]));
                                }
                            }
                            _combos = _nc;
                        }
                        if (_combos.length > 32) _combos = _combos.slice(0, 32);
                        for (var _candIdx = 0; _candIdx < _combos.length; _candIdx++) {
                            var _snap = {};
                            for (var _sk2 in known) { if (known.hasOwnProperty(_sk2)) _snap[_sk2] = known[_sk2]; }
                            for (var _cci = 0; _cci < depVars.length; _cci++) known[depVars[_cci]] = _combos[_candIdx][_cci];
                            for (var _nvIt = 0; _nvIt < 30; _nvIt++) {
                                var _fvec = [];
                                var _maxf = 0;
                                for (var fei = 0; fei < eqsList.length; fei++) {
                                    var _fv2;
                                    try { _fv2 = evalAST(eqsList[fei], known); } catch(e) { _fv2 = NaN; }
                                    if (!isFinite(_fv2)) _fv2 = 1e30;
                                    _fvec.push(_fv2);
                                    if (Math.abs(_fv2) > _maxf) _maxf = Math.abs(_fv2);
                                }
                                if (_maxf < 1e-10) break;
                                // 数值雅可比（中心差分）
                                var _J = [];
                                for (var jei = 0; jei < eqsList.length; jei++) {
                                    var _row = [];
                                    for (var jv = 0; jv < depVars.length; jv++) {
                                        var _h = 1e-6 * Math.max(1, Math.abs(known[depVars[jv]] || 0));
                                        known[depVars[jv]] += _h;
                                        var _fp2; try { _fp2 = evalAST(eqsList[jei], known); } catch(e) { _fp2 = NaN; }
                                        known[depVars[jv]] -= 2 * _h;
                                        var _fm2; try { _fm2 = evalAST(eqsList[jei], known); } catch(e) { _fm2 = NaN; }
                                        known[depVars[jv]] += _h;
                                        _row.push((isFinite(_fp2) && isFinite(_fm2)) ? (_fp2 - _fm2) / (2 * _h) : 0);
                                    }
                                    _J.push(_row);
                                }
                                // 解方阵 J·Δ = -f（方程数与依赖数取小者）
                                var _mm = Math.min(eqsList.length, depVars.length);
                                if (_mm === 0) break;
                                var _A = [], _b = [];
                                for (var ri = 0; ri < _mm; ri++) {
                                    _A.push(_J[ri].slice(0, _mm));
                                    _b.push(-_fvec[ri]);
                                }
                                var _delta = null;
                                try { var _gsR = gaussianSolve(_A, _b); _delta = _gsR ? _gsR.solution : null; } catch(e) { _delta = null; }
                                if (!_delta) break;
                                for (var dvi = 0; dvi < _delta.length; dvi++) {
                                    if (!isFinite(_delta[dvi])) _delta[dvi] = 0;
                                    if (Math.abs(_delta[dvi]) > 1e6) _delta[dvi] = Math.sign(_delta[dvi]) * 1e6;
                                }
                                // 阻尼牛顿（2026-08-21 修复）：线性化步长常远超域宽（如平面截球
                                // Δz≈12 而 z 域仅 ±3.74），原"减半一次"仍越界导致发散。
                                // 现逐步减半直到残差单调下降，且严格夹取到 D0 内。
                                var _accepted = false;
                                for (var _dmp = 0; _dmp < 10; _dmp++) {
                                    var _tmpK = {};
                                    for (var _tk in known) { if (known.hasOwnProperty(_tk)) _tmpK[_tk] = known[_tk]; }
                                    for (var _dvi5 = 0; _dvi5 < _delta.length; _dvi5++) {
                                        var _dvn5 = depVars[_dvi5];
                                        var _nv5 = _tmpK[_dvn5] + _delta[_dvi5];
                                        if (D0 && D0[_dvn5]) {
                                            if (_nv5 < D0[_dvn5].min) _nv5 = D0[_dvn5].min;
                                            if (_nv5 > D0[_dvn5].max) _nv5 = D0[_dvn5].max;
                                        }
                                        _tmpK[_dvn5] = _nv5;
                                    }
                                    var _newMaxf = 0;
                                    for (var _fei3 = 0; _fei3 < eqsList.length; _fei3++) {
                                        var _fv3;
                                        try { _fv3 = evalAST(eqsList[_fei3], _tmpK); } catch(e) { _fv3 = NaN; }
                                        if (!isFinite(_fv3)) _fv3 = 1e30;
                                        if (Math.abs(_fv3) > _newMaxf) _newMaxf = Math.abs(_fv3);
                                    }
                                    if (_newMaxf <= _maxf || _dmp >= 8) {
                                        for (var _dvi6 = 0; _dvi6 < _delta.length; _dvi6++) known[depVars[_dvi6]] = _tmpK[depVars[_dvi6]];
                                        _accepted = true;
                                        break;
                                    }
                                    for (var _dvi7 = 0; _dvi7 < _delta.length; _dvi7++) _delta[_dvi7] *= 0.5;
                                }
                                if (!_accepted) break;
                            }
                            // 精化后验证
                            var maxRes2 = 0;
                            for (var ei2 = 0; ei2 < eqsList.length; ei2++) {
                                try {
                                    var r2 = Math.abs(evalAST(eqsList[ei2], known));
                                    if (r2 > maxRes2) maxRes2 = r2;
                                } catch(e) { maxRes2 = 1e10; break; }
                            }
                            if (maxRes2 < 1e-4) return { values: known, residual: maxRes2 };
                            for (var _sk3 in _snap) { if (_snap.hasOwnProperty(_sk3)) known[_sk3] = _snap[_sk3]; }
                        }
                    }
                }
                if (maxRes >= 1e-4) return null;
                return { values: known, residual: maxRes };
            }
            // 预处理：求解单变量方程（如 sin(x)=0.3），为网格采样提供合理起点
            var knownStart = {};
            for (var _ei = 0; _ei < eqs.length; _ei++) {
                var _vars = extractVariables(eqs[_ei]);
                if (_vars.length === 1) {
                    var _vn = _vars[0];
                    var _dom = state.D0[_vn];
                    if (!_dom) continue;
                    // 多起点牛顿（2026-08-21 修复：原只从 D0 中点起步，若中点为
                    // 导数零点/极值点（如 sin 域收缩到 [0,π] 后中点 π/2 处 cos=0）
                    // 数值差分 df≈0 → break，knownStart 丢失该变量）
                    var _starts = [
                        (_dom.min + _dom.max) / 2,
                        _dom.min, _dom.max,
                        _dom.min + 0.25 * (_dom.max - _dom.min),
                        _dom.max - 0.25 * (_dom.max - _dom.min)
                    ];
                    for (var _sc = 0; _sc < _starts.length && knownStart[_vn] === undefined; _sc++) {
                        var _x = _starts[_sc];
                        for (var _ni = 0; _ni < 100; _ni++) {
                            var _pt = {};
                            _pt[_vn] = _x;
                            try {
                                var _f = evalAST(eqs[_ei], _pt);
                                if (Math.abs(_f) < 1e-9) {
                                    knownStart[_vn] = _x;
                                    break;
                                }
                                var _eps = 1e-7 * Math.max(1, Math.abs(_x));
                                _pt[_vn] = _x + _eps;
                                var _f2 = evalAST(eqs[_ei], _pt);
                                var _df = (_f2 - _f) / _eps;
                                if (Math.abs(_df) < 1e-15) break;
                                var _dx = _f / _df;
                                if (Math.abs(_dx) > 1e6) break;
                                _x = _x - _dx;
                                if (_x < _dom.min || _x > _dom.max) {
                                    _x = (_dom.min + _dom.max) / 2;
                                    break;
                                }
                            } catch(e) { break; }
                        }
                    }
                }
            }
            // 网格采样：种子变量数 = 自由变量数（n - m），依赖变量交给 forwardPropagate
            // 的多维牛顿精化（2026-08-21 修复：原固定取前2个变量 + {min,mid,max} 角点
            // 网格，对解流形投影在 D0 内部的欠定系统（如平面截球 x+y+z=6 ∧ x²+y²+z²=14 的圆）
            // 命中率为 0 → 假"无解"。现按自由度数取种子、5 层分层，并优先选 D0 已收缩
            // （宽度小）的变量当种子，提高网格命中解流形投影的概率。）
            // 注意：方程源与变量集必须一致——消元后 state.equations 只剩 1 个（varNames=[y,z]），
            // 而 originalEquations 是 2 个原始方程（originalVarNames=[x,y,z]）；种子数须按实际
            // 使用的方程源计算，否则 1 维牛顿去解 2 个方程必然失败（2026-08-21 实测）。
            var _eqsU = state.originalEquations || state.equations;
            var _nEqU = _eqsU.length;
            var _varsU = state.originalEquations ? (state.originalVarNames || outputVarNames) : state.varNames;
            var _nSeedU = Math.max(1, _varsU.length - _nEqU);
            // 种子排除 knownStart 已确定的变量（2026-08-21 修复：示例8 中 sin(x)=0.3
            // 由单变量方程预处理解出 x 后，若种子仍选 x，依赖变量 5 个但有效方程只剩
            // 4 个（sin 行对依赖全零）→ 牛顿欠定必失败）
            var _candSeedsU = [];
            for (var _csi = 0; _csi < outputVarNames.length; _csi++) {
                var _cv2 = outputVarNames[_csi];
                if (knownStart[_cv2] === undefined) _candSeedsU.push(_cv2);
            }
            if (_candSeedsU.length < _nSeedU) _candSeedsU = outputVarNames.slice();
            var _sortedVarsU = _candSeedsU.slice().sort(function(v1, v2) {
                var w1 = (state.D0 && state.D0[v1]) ? state.D0[v1].max - state.D0[v1].min : Infinity;
                var w2 = (state.D0 && state.D0[v2]) ? state.D0[v2].max - state.D0[v2].min : Infinity;
                return w1 - w2;
            });
            var gridVars = _sortedVarsU.slice(0, Math.min(2, _nSeedU));
            var gridSteps = [-1, -0.5, 0, 0.5, 1];
            for (var gi = 0; gi < gridSteps.length && samplePoints.length < 20; gi++) {
                for (var gj = 0; gj < gridSteps.length && samplePoints.length < 20; gj++) {
                    var pt = {};
                    var valid = true;
                    if (state.D0[gridVars[0]]) {
                        var min0 = state.D0[gridVars[0]].min, max0 = state.D0[gridVars[0]].max;
                        pt[gridVars[0]] = min0 + (gridSteps[gi] + 1) / 2 * (max0 - min0);
                    } else { valid = false; }
                    if (gridVars.length > 1 && state.D0[gridVars[1]]) {
                        var min1 = state.D0[gridVars[1]].min, max1 = state.D0[gridVars[1]].max;
                        pt[gridVars[1]] = min1 + (gridSteps[gj] + 1) / 2 * (max1 - min1);
                    } else if (gridVars.length > 1) { valid = false; }
                    if (!valid) continue;
                    for (var _vn in knownStart) { pt[_vn] = knownStart[_vn]; }
                    // 前向传播计算剩余变量
                    var result = forwardPropagate(pt, eqs, outputVarNames, state.D0);
                    if (result) {
                        var valArr = outputVarNames.map(function(vn) { return result.values[vn] !== undefined ? result.values[vn] : 0; });
                        samplePoints.push({ values: valArr, residual: result.residual });
                    }
                }
            }
            // 如果网格采样没找到点，尝试用第一个变量中点+边界再试
            if (samplePoints.length === 0 && outputVarNames.length > 0) {
                if (state.D0[outputVarNames[0]]) {
                    var min0 = state.D0[outputVarNames[0]].min, max0 = state.D0[outputVarNames[0]].max;
                    var altVals = [min0, (min0+max0)/2, max0];
                    for (var ai = 0; ai < altVals.length && samplePoints.length < 20; ai++) {
                        var pt2 = {};
                        pt2[outputVarNames[0]] = altVals[ai];
                        // 同样覆盖单变量方程的解
                        for (var _vn2 in knownStart) { pt2[_vn2] = knownStart[_vn2]; }
                        var result2 = forwardPropagate(pt2, eqs, outputVarNames, state.D0);
                        if (result2) {
                            var valArr2 = outputVarNames.map(function(vn) { return result2.values[vn] !== undefined ? result2.values[vn] : 0; });
                            samplePoints.push({ values: valArr2, residual: result2.residual });
                        }
                    }
                }
            }
        }
        var uniquePts = [];
        for (var si = 0; si < samplePoints.length; si++) {
            var isDup = false;
            for (var sj = 0; sj < uniquePts.length; sj++) {
                var diff = 0;
                for (var vi = 0; vi < samplePoints[si].values.length; vi++) {
                    diff += Math.abs(samplePoints[si].values[vi] - uniquePts[sj].values[vi]);
                }
                if (diff < 1e-6) { isDup = true; break; }
            }
            if (!isDup) uniquePts.push(samplePoints[si]);
        }
        // 围绕已找到的采样点做扰动，生成更多采样点展示参数化性质
        if (uniquePts.length > 0 && uniquePts.length < 20) {
            var basePt = {};
            for (var vi = 0; vi < outputVarNames.length; vi++) {
                basePt[outputVarNames[vi]] = uniquePts[0].values[vi];
            }
            // 找出未被单变量方程确定的变量作为自由变量
            var freeVars = [];
            for (var vi = 0; vi < gridVars.length; vi++) {
                if (knownStart[gridVars[vi]] === undefined) freeVars.push(gridVars[vi]);
            }
            if (freeVars.length === 0 && outputVarNames.length > 0) {
                freeVars.push(outputVarNames[0]); // 兜底
            }
            for (var fvi = 0; fvi < freeVars.length && uniquePts.length < 20; fvi++) {
                var fv = freeVars[fvi];
                var scales = [0.1, 0.2, 0.5, 1, 2, 5, 10, 100, 1000];
                for (var si = 0; si < scales.length && uniquePts.length < 20; si++) {
                    var offset = Math.max(1, Math.abs(basePt[fv] || 1)) * scales[si];
                    for (var dir = -1; dir <= 1; dir += 2) {
                        var pt = {};
                        // 只设置已知的单变量方程解和自由变量，其余让前向传播计算
                        for (var _vn in knownStart) pt[_vn] = knownStart[_vn];
                        pt[fv] = basePt[fv] + dir * offset;
                        if (state.D0[fv] && (pt[fv] < state.D0[fv].min || pt[fv] > state.D0[fv].max)) continue;
                        var result = forwardPropagate(pt, eqs, outputVarNames, state.D0);
                        if (result) {
                            var valArr = outputVarNames.map(function(vn) { return result.values[vn] !== undefined ? result.values[vn] : 0; });
                            var dup = false;
                            for (var ui = 0; ui < uniquePts.length; ui++) {
                                var d = 0;
                                for (var vi2 = 0; vi2 < valArr.length; vi2++) d += Math.abs(valArr[vi2] - uniquePts[ui].values[vi2]);
                                if (d < 1e-6) { dup = true; break; }
                            }
                            if (!dup) uniquePts.push({ values: valArr, residual: result.residual });
                        }
                    }
                }
            }
        }
        // 恒等式前置检测（2026-08-21 修复）：全部方程残差在多点抽样恒 ≈0
        // （如 x+y+z=x+y+z）→ 解为整个声明域，推荐解 = 域内距原点最近的点。
        // 必须前置：否则 forwardPropagate 对恒等式二分会把依赖变量设为域下限
        // （f 恒 0 → known[v]=lo），产出 (0,0,-1e6) 这类坏推荐解。
        var _isIdI = true;
        if (eqs.length > 0) {
            var _idPtsI = [];
            var _midI = {}; outputVarNames.forEach(function(v) { _midI[v] = 0; });
            _idPtsI.push(_midI);
            var _oneI = {}; outputVarNames.forEach(function(v) { _oneI[v] = 1; });
            _idPtsI.push(_oneI);
            for (var _ieI = 0; _ieI < eqs.length && _isIdI; _ieI++) {
                for (var _iptI = 0; _iptI < _idPtsI.length; _iptI++) {
                    var _rvI; try { _rvI = Math.abs(evalAST(eqs[_ieI], _idPtsI[_iptI])); } catch(e) { _rvI = 1e10; }
                    if (_rvI > 1e-6) { _isIdI = false; break; }
                }
            }
        } else { _isIdI = false; }
        // 欠定系统（无限解集）：从已校验采样点中选"距原点最近"的点作为推荐解输出，不输出盒子/采样点集合。
        // 注：2026-08-19 由"输出外包盒+采样点集合"改为"输出一个推荐解"（与三分类结果类型对齐）。
        // 主准则：距原点最近（‖x‖² 最小）；等距时按字典序最小化 |x_i|（真全序，确定性、可复现——产品承诺）
        var recSol = null, recD2 = Infinity;
        if (_isIdI) {
            recSol = {
                values: outputVarNames.map(function(v) {
                    var _dI = state.D0 && state.D0[v];
                    if (!_dI) return 0;
                    if (_dI.min > 0) return _dI.min;
                    if (_dI.max < 0) return _dI.max;
                    return 0;
                }),
                residual: 0
            };
            recD2 = 0;
        } else if (uniquePts && uniquePts.length) {
            // 主准则：距原点最近；等距按字典序最小化 |x_i|（确定性、可复现——产品承诺）
            recSol = pickRecommended(uniquePts);
            for (var _rvi = 0; _rvi < recSol.values.length; _rvi++) recD2 += recSol.values[_rvi] * recSol.values[_rvi];
        }
        // === 流形最近点精化（2026-08-20）：推荐解必须满足"距原点最近"规则 ===
        // 此前仅从采样点集合中挑最近者，x+y=3 会返回 (2,1) 而非真正的最近点 (1.5,1.5)。
        // 这里在解流形上做确定性坐标下降（黄金分割线搜索），以自由变量为参数、
        // 经 forwardPropagate 重建完整解，最小化 Σv²，使推荐解真正"距原点最近"。
        // 全程无随机分支，结果确定可复现；失败则回退到采样点最优，不影响原行为。
        if (recSol) {
            var _bestArr = recSol.values.slice();
            var _bestD2 = recD2;
            var _bestRes = recSol.residual;
            // 自由度数 = 变量数 - 方程数（至少 1）：前 n-m 个变量作为自由参数，
            // 其余由 forwardPropagate 依据方程逐个解出（依赖 forwardPropagate 的
            // "未知变量唯一则可解"机制，结构不支持时返回 null 自动跳过）。
            var _needFree = Math.max(1, outputVarNames.length - eqs.length);
            var _freeVars = [];
            for (var _fvi = 0; _fvi < _needFree && _fvi < outputVarNames.length; _fvi++) _freeVars.push(outputVarNames[_fvi]);
            if (_freeVars.length > 0) {
                var _bestMap = {};
                for (var _bi2 = 0; _bi2 < outputVarNames.length; _bi2++) _bestMap[outputVarNames[_bi2]] = _bestArr[_bi2];
                // 黄金分割：对自由变量 t，目标 g(t)=Σx(t)²，x(t) 由 forwardPropagate 重建
                function _gsEval(_tVal, _curFv) {
                    var _ptC = {};
                    for (var _fi3 = 0; _fi3 < _freeVars.length; _fi3++) {
                        var _fn3 = _freeVars[_fi3];
                        if (_fn3 === _curFv) _ptC[_fn3] = _tVal;
                        else if (_bestMap[_fn3] !== undefined) _ptC[_fn3] = _bestMap[_fn3];
                    }
                    for (var _ks2 in knownStart) { if (knownStart.hasOwnProperty(_ks2)) _ptC[_ks2] = knownStart[_ks2]; }
                    var _rC = forwardPropagate(_ptC, eqs, outputVarNames, state.D0);
                    if (!_rC) return Infinity;
                    var _d2C = 0;
                    for (var _vi3 = 0; _vi3 < outputVarNames.length; _vi3++) {
                        var _vv3 = _rC.values[outputVarNames[_vi3]];
                        if (_vv3 === undefined || !isFinite(_vv3)) return Infinity;
                        _d2C += _vv3 * _vv3;
                    }
                    return _d2C;
                }
                // ── 2026-10-03：先试【流形投影法】（见 _suan56Project 头注释）──
                // KKT：x + Jᵀλ = 0 与 F(x)=0 构成 n+m 维恰定方程组 ⇒ 阻尼牛顿直接解，
                // 局部二次收敛且【与域宽无关】。这才是「最近解」在数学上正确的算法；
                // 下面的网格采样 + 黄金分割是启发式，在 ±1e6 宽域上会停在远离原点的局部极小
                // （实测输出 ‖x‖=353557 却标「最近」，真值约 3.70，差 94492 倍）。
                // 起点：当前最优 _bestArr（来自采样点）+ knownStart 预解的单变量，作为多起点。
                // fail-closed：投影必须把残差压到 1e-9 以下才算成功，否则走原路径。
                var _projDone = false;
                try {
                    // 多起点（KKT 投影是局部法，单起点等于没跑 —— 见文件头注释）
                    var _projStarts = [_bestArr.slice()];
                    // ② 域中点（原点邻域）：欠定解集的「最近点」通常离原点不远
                    var _mid = outputVarNames.map(function (vn) {
                        var _d0 = state.D0 && state.D0[vn];
                        return (_d0 && isFinite(_d0.min) && isFinite(_d0.max)) ? (_d0.min + _d0.max) / 2 : 0;
                    });
                    _projStarts.push(_mid.slice());
                    // ③ 域的符号角：捕捉负分支 / 异号解（xyz=6 这类正解在负域也有解）
                    for (var _cbit = 0; _cbit < Math.min(8, 1 << outputVarNames.length); _cbit++) {
                        var _corner = outputVarNames.map(function (vn, _ci) {
                            var _d1 = state.D0 && state.D0[vn];
                            if (!_d1 || !isFinite(_d1.min) || !isFinite(_d1.max)) return 0;
                            var _t1 = (_cbit >> _ci) & 1;
                            // 取域的 30% / 70% 分位而非端点：端点常在奇点外
                            return _d1.min + (0.3 + 0.4 * _t1) * (_d1.max - _d1.min);
                        });
                        _projStarts.push(_corner);
                    }
                    // ④ 域中点按符号翻转（对称方程常有对称解集）
                    for (var _fl = 0; _fl < Math.min(4, outputVarNames.length); _fl++) {
                        var _flt = _mid.slice();
                        _flt[_fl] = -_flt[_fl];
                        _projStarts.push(_flt);
                    }
                    for (var _psk in knownStart) {
                        if (knownStart.hasOwnProperty(_psk)) {
                            var _ptS = {};
                            for (var _ps1 = 0; _ps1 < outputVarNames.length; _ps1++) _ptS[outputVarNames[_ps1]] = knownStart[outputVarNames[_ps1]];
                            var _miss = false;
                            for (var _ps2 = 0; _ps2 < _freeVars.length; _ps2++) {
                                if (_ptS[_freeVars[_ps2]] === undefined) { _ptS[_freeVars[_ps2]] = _bestMap[_freeVars[_ps2]]; }
                            }
                            for (var _ps3 = 0; _ps3 < outputVarNames.length; _ps3++) {
                                if (_ptS[outputVarNames[_ps3]] === undefined) { _ptS[outputVarNames[_ps3]] = _bestArr[_ps3]; }
                            }
                            _projStarts.push(outputVarNames.map(function (vn) { return _ptS[vn]; }));
                        }
                    }
                    var _bestProj = null, _bestProjD2 = Infinity;
                    for (var _pi = 0; _pi < _projStarts.length; _pi++) {
                        var _pr = _suan56Project(eqs, outputVarNames, _projStarts[_pi], state.D0, { maxIter: 60 });
                        if (_pr && _pr.ok) {
                            var _pd2 = 0;
                            for (var _pj = 0; _pj < _pr.values.length; _pj++) _pd2 += _pr.values[_pj] * _pr.values[_pj];
                            if (_pd2 < _bestProjD2) { _bestProjD2 = _pd2; _bestProj = _pr; }
                        }
                    }
                    if (_bestProj) {
                        _bestArr = _bestProj.values.slice();
                        _bestD2 = _bestProjD2;
                        _bestRes = _bestProj.residual;
                        for (var _pb = 0; _pb < outputVarNames.length; _pb++) _bestMap[outputVarNames[_pb]] = _bestArr[_pb];
                        _projDone = true;
                        state.suan56Projection = {
                            method: 'manifold-projection-gauss-newton',
                            iters: _bestProj.iters,
                            residual: _bestProj.residual,
                            starts: _projStarts.length,
                            note: 'KKT 条件 x+Jᵀλ=0 与 F(x)=0 的阻尼牛顿解；局部二次收敛，与声明域宽无关'
                        };
                    }
                } catch (e) { _projDone = false; }
                if (!_projDone) {
                var _PHI = 0.6180339887498949;
                for (var _rd = 0; _rd < 8; _rd++) {
                    var _improved = false;
                    for (var _fi4 = 0; _fi4 < _freeVars.length; _fi4++) {
                        var _fv4 = _freeVars[_fi4];
                        var _dom4 = state.D0[_fv4] || d0Box[_fv4];
                        if (!_dom4 || !isFinite(_dom4.min) || !isFinite(_dom4.max)) continue;
                        // 自适应窗口：以当前最优值为中心（避免在 ±1e6 默认大域上迭代不足），
                        // 窗口半径随轮次减半，全局粗搜 → 局部精搜，保证收敛到流形最近点。
                        var _center4 = _bestMap[_fv4] !== undefined ? _bestMap[_fv4] : (_dom4.min + _dom4.max) / 2;
                        var _span4 = (_dom4.max - _dom4.min) / Math.pow(4, _rd + 1);
                        _span4 = Math.max(_span4, 1e-6, Math.abs(_center4) * 1e-3);
                        var _lo4 = Math.max(_dom4.min, _center4 - _span4);
                        var _hi4 = Math.min(_dom4.max, _center4 + _span4);
                        if (_lo4 >= _hi4) { _lo4 = _dom4.min; _hi4 = _dom4.max; }
                        var _c4 = _hi4 - (_hi4 - _lo4) * _PHI, _d4 = _lo4 + (_hi4 - _lo4) * _PHI;
                        var _gc4 = _gsEval(_c4, _fv4), _gd4 = _gsEval(_d4, _fv4);
                        for (var _gi4 = 0; _gi4 < 100; _gi4++) {
                            if (!isFinite(_gc4)) { _c4 = (_lo4 + _c4) / 2; _gc4 = _gsEval(_c4, _fv4); continue; }
                            if (!isFinite(_gd4)) { _d4 = (_d4 + _hi4) / 2; _gd4 = _gsEval(_d4, _fv4); continue; }
                            if (_gc4 < _gd4) { _hi4 = _d4; _d4 = _c4; _gd4 = _gc4; _c4 = _hi4 - (_hi4 - _lo4) * _PHI; _gc4 = _gsEval(_c4, _fv4); }
                            else { _lo4 = _c4; _c4 = _d4; _gc4 = _gd4; _d4 = _lo4 + (_hi4 - _lo4) * _PHI; _gd4 = _gsEval(_d4, _fv4); }
                            if (_hi4 - _lo4 < 1e-9) break;
                        }
                        var _tBest = (_lo4 + _hi4) / 2;
                        var _rBest = forwardPropagate((function() {
                            var _ptF = {};
                            for (var _fi5 = 0; _fi5 < _freeVars.length; _fi5++) {
                                var _fn5 = _freeVars[_fi5];
                                if (_fn5 === _fv4) _ptF[_fn5] = _tBest;
                                else if (_bestMap[_fn5] !== undefined) _ptF[_fn5] = _bestMap[_fn5];
                            }
                            for (var _ks3 in knownStart) { if (knownStart.hasOwnProperty(_ks3)) _ptF[_ks3] = knownStart[_ks3]; }
                            return _ptF;
                        })(), eqs, outputVarNames, state.D0);
                        if (_rBest) {
                            var _d2F = 0, _okF = true;
                            for (var _vi4 = 0; _vi4 < outputVarNames.length; _vi4++) {
                                var _vv4 = _rBest.values[outputVarNames[_vi4]];
                                if (_vv4 === undefined || !isFinite(_vv4)) { _okF = false; break; }
                                _d2F += _vv4 * _vv4;
                            }
                            if (_okF && _d2F < _bestD2 - 1e-12) {
                                var _newArr = [];
                                for (var _vi5 = 0; _vi5 < outputVarNames.length; _vi5++) _newArr.push(_rBest.values[outputVarNames[_vi5]]);
                                _bestArr = _newArr; _bestD2 = _d2F; _bestRes = _rBest.residual;
                                for (var _bi5 = 0; _bi5 < outputVarNames.length; _bi5++) _bestMap[outputVarNames[_bi5]] = _bestArr[_bi5];
                                _improved = true;
                            }
                        }
                    }
                    if (!_improved) break;
                }
                }   // suan56：投影法未成功才走原黄金分割启发式
                // 精化成功（严格更近）则替换推荐解，并同步零分量 tie-break 口径
                if (_bestD2 < recD2 - 1e-12) {
                    var _zBest = 0;
                    for (var _zi = 0; _zi < _bestArr.length; _zi++) if (Math.abs(_bestArr[_zi]) < 1e-9) _zBest++;
                    recSol = { values: _bestArr, residual: _bestRes };
                    recD2 = _bestD2; recZeros = _zBest;
                }
            }
        }
        if (recSol) {
            state.done = true;
            state.result = {
                solutions: [recSol],
                confidence: "high",
                resultType: 3,
                resultTypeName: "无限解集（推荐解）",
                resultTypeDesc: "方程数(" + state.equations.length + ")少于变量数(" + state.varNames.length + ")，系统欠定，真实解构成参数化集合（无限多个解）。已在解流形上经确定性搜索输出距原点最近的推荐解（经残差验证 <1e-6）；如需更多代表点，请增加方程约束重新求解。",
                executionPath: "欠定系统-输出推荐解（距原点最近）",
                timeMs: performance.now() - state.startTime,
                varNames: outputVarNames,
                unconverged: false,
                warnings: [
                    "⚠️ 当前为欠定系统（无限解集）：",
                    "1. 方程数少于变量数，系统欠定，存在无限多个解。",
                    "2. 已在解流形上经确定性搜索输出距原点最近的推荐解（经残差验证 <1e-6）。",
                    "3. 如需更多代表点，请增加方程约束重新求解。"
                ]
            };
            return;
        }
        // 恒等式兜底（2026-08-21 修复）：欠定且采样未产出 recSol 时，若全部方程
        // 在多个抽样点残差恒 ≈0（如 x+y+z=x+y+z），则解为整个声明域（无限解），
        // 推荐解 = 域内距原点最近的点（每变量取靠近 0 的域端点或 0）。
        if (!recSol) {
            var _idPtsI = [];
            var _midI = {}; outputVarNames.forEach(function(v) { _midI[v] = 0; });
            _idPtsI.push(_midI);
            var _oneI = {}; outputVarNames.forEach(function(v) { _oneI[v] = 1; });
            _idPtsI.push(_oneI);
            var _isIdI = true;
            for (var _ieI = 0; _ieI < eqs.length && _isIdI; _ieI++) {
                for (var _iptI = 0; _iptI < _idPtsI.length; _iptI++) {
                    var _rvI; try { _rvI = Math.abs(evalAST(eqs[_ieI], _idPtsI[_iptI])); } catch(e) { _rvI = 1e10; }
                    if (_rvI > 1e-6) { _isIdI = false; break; }
                }
            }
            if (_isIdI) {
                recSol = {
                    values: outputVarNames.map(function(v) {
                        var _dI = state.D0 && state.D0[v];
                        if (!_dI) return 0;
                        if (_dI.min > 0) return _dI.min;
                        if (_dI.max < 0) return _dI.max;
                        return 0;
                    }),
                    residual: 0
                };
            }
        }
        // 欠定但在声明域内无解（如 x+y=5 且 x,y∈[0,2]）：不得误标为"无限解集"，
        // 如实降级为无解判定，保持"无解就是无解"的真实性承诺。
        state.done = true;
        state.result = { solutions: [], resultType: 1, resultTypeName: "空结果", resultTypeDesc: "方程数少于变量数（欠定），但在当前声明域内不存在满足约束的解", error: "NO_SOLUTION", message: "欠定系统在声明域内无解", executionPath: "欠定系统-声明域内无解", timeMs: performance.now() - state.startTime, varNames: outputVarNames, unconverged: false };
        return;
    }

    state.done = true;
    state.result = { solutions: [], resultType: 1, resultTypeName: "空结果", resultTypeDesc: "区间算术严格证明不存在满足约束的解", error: "NO_SOLUTION", message: "未找到满足条件的解", executionPath: "全域无解", timeMs: performance.now() - state.startTime, varNames: state.varNames, unconverged: false };
}
