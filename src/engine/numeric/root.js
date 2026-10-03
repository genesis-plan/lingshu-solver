/* 模块 numeric/root：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function roundToGrid(x) {
    if (!isFinite(x)) return x;
    var scale = Math.pow(10, COMPUTE_DECIMALS);
    var scaled = x * scale;
    var nearest = Math.round(scaled);
    // 如果已在网格点上（浮点误差范围内），直接返回该网格点
    if (Math.abs(scaled - nearest) < 1e-6) {
        return nearest / scale;
    }
    // 四舍五入到最近的网格点
    return Math.round(scaled) / scale;
}


function generateStartPoints(varNames, contractedDomain) {
    const n = varNames.length;
    const points = [];

    // 使用 D0（传入的收缩后域）作为起始点生成依据
    // 当 D0 为空时，默认使用 [-1000000, 1000000]
    // 根据边界调整起始值
    function getStartValue(v, base) {
        if (contractedDomain && contractedDomain[v]) {
            const b = contractedDomain[v];
            const min = b.min === -Infinity ? -1000000 : b.min;
            const max = b.max === Infinity ? 1000000 : b.max;
            if (base < min) return min;
            if (base > max) return max;
            return base;
        }
        return base;
    }

    // 原点
    points.push(varNames.map(v => getStartValue(v, 0)));
    // 全+1
    points.push(varNames.map(v => getStartValue(v, 1)));
    // 全-1
    points.push(varNames.map(v => getStartValue(v, -1)));
    // 全+10
    points.push(varNames.map(v => getStartValue(v, 10)));
    // 全-10
    points.push(varNames.map(v => getStartValue(v, -10)));

    // 混合符号点（多变量时覆盖不同象限）
    if (n >= 2) {
        points.push(varNames.map((v, i) => getStartValue(v, i % 2 === 0 ? 5 : -5)));
        points.push(varNames.map((v, i) => getStartValue(v, i % 2 === 0 ? -5 : 5)));
        points.push(varNames.map((v, i) => getStartValue(v, i % 2 === 0 ? 10 : -10)));
        points.push(varNames.map((v, i) => getStartValue(v, i % 2 === 0 ? -10 : 10)));
    }

    // 3个确定性网格点（基于 D0 区间）
    const gridFractions = [0.25, 0.5, 0.75];
    for (let r = 0; r < 3; r++) {
        const pt = [];
        for (let i = 0; i < n; i++) {
            const v = varNames[i];
            if (contractedDomain && contractedDomain[v]) {
                const b = contractedDomain[v];
                const min = b.min === -Infinity ? -1000000 : b.min;
                const max = b.max === Infinity ? 1000000 : b.max;
                pt.push(min + gridFractions[r] * (max - min));
            } else {
                pt.push((r - 1) * 66);
            }
        }
        points.push(pt);
    }

    return points;
}


function deduplicateSolutions(solutions, varNames, tolerance) {
    const unique = [];
    // 去重阈值：至少1e-4，避免浮点误差导致的近重复
    const dedupTol = Math.max(tolerance, 1e-4);

    for (const sol of solutions) {
        let outOfRange = false;
        for (const val of sol) {
            if (isNaN(val) || !isFinite(val) || Math.abs(val) > 1000000) {
                outOfRange = true;
                break;
            }
        }
        if (outOfRange) continue;

        // 距离比较去重：若与任一已有解的最大分量差 < dedupTol，视为重复
        let isDup = false;
        for (const existing of unique) {
            let maxDiff = 0;
            for (let i = 0; i < sol.length; i++) {
                maxDiff = Math.max(maxDiff, Math.abs(sol[i] - existing[i]));
            }
            if (maxDiff < dedupTol) {
                isDup = true;
                break;
            }
        }
        if (!isDup) unique.push(sol);
    }

    return unique;
}


function _multiStartNewton(state) {
    var eqs = state.equations || [];
    var vns = state.varNames || [];
    var n = vns.length, m = eqs.length;
    if (n === 0 || m !== n) return null;   // 仅方阵
    if (n > 6 || m > 6) return null;
    // 生成确定性起点（笛卡尔积上限 64 + D0 中心点）
    var baseSets = [];
    for (var i = 0; i < n; i++) {
        var d = state.D0 && state.D0[vns[i]] ? state.D0[vns[i]] : null;
        // 起点值集合：含 0 与小编号优先（2026-08-21：原 {±1,±3} 笛卡尔积截断 64 后
        // 全部起点第一个分量相同，缺多样性——如示例8 的 5 维牛顿从 (-3,...) 起步全发散；
        // 含 0 使 (0,0,0,0,0) 等靠近原点的起点可用）
        var set = [0, 1, -1, 2, -2, 3, -3];
        if (d && (d.max < -3 || d.min > 3)) {
            set = [d.min + 0.25 * (d.max - d.min), d.max - 0.25 * (d.max - d.min), d.min, d.max];
        }
        var su = [];
        for (var s = 0; s < set.length; s++) {
            var v = set[s];
            if (d) { if (v < d.min) v = d.min; if (v > d.max) v = d.max; }
            if (su.indexOf(v) < 0) su.push(v);
        }
        baseSets.push(su);
    }
    var combos = [[]];
    for (var c = 0; c < baseSets.length && combos.length <= 128; c++) {
        var nc = [];
        for (var a = 0; a < combos.length; a++) {
            for (var b = 0; b < baseSets[c].length; b++) nc.push(combos[a].concat([baseSets[c][b]]));
        }
        combos = nc;
    }
    if (combos.length > 128) combos = combos.slice(0, 128);
    var midPt = [];
    for (var mi = 0; mi < n; mi++) midPt.push(state.D0 && state.D0[vns[mi]] ? (state.D0[vns[mi]].min + state.D0[vns[mi]].max) / 2 : 0);
    combos.push(midPt);
    // 整数优先种子（2026-08-22）：对称多项式等系统的根常为小整数排列（如 (1,2,3,4,5)）。
    // 笛卡尔积起点被截断（n≥4 时 7^n 远超 128）永远触不到 (1,2,...,n) 区域，导致多起点牛顿
    // 漏掉所有基解、对称补全无从展开。这里额外追加少量结构化整数种子（不参与 128 截断），
    // 仅为让牛顿"碰到"一个基解，后续 _symmetryExpand 补全全部排列。对一般系统无害（发散即跳过）。
    // 只取与域不冲突的种子，避免越界。
    var _intSeeds = [];
    // 用原始变量数 origN 决定整数范围（消元后 n 可能小于 origN，根仍落在 1..origN）
    var _origN = (state.originalVarNames && state.originalVarNames.length) ? state.originalVarNames.length : n;
    var _seq = []; for (var _si = 1; _si <= _origN; _si++) _seq.push(_si);
    // 取 _seq 的前 n 项作为种子长度与 n 匹配；若 origN>n，则前 n 项覆盖 1..n
    var _head = _seq.slice(0, n);
    _intSeeds.push(_head.slice());                       // (1,2,...,n)
    _intSeeds.push(_head.slice().reverse());             // (n,...,2,1)
    _intSeeds.push(_head.map(function() { return 1; })); // (1,1,...,1)
    // 追加若干个 (1..origN) 的循环移位，覆盖对称系统的不同基解起点（与域兼容才采纳）
    for (var _sh = 1; _sh < _origN && _intSeeds.length < 12; _sh++) {
        var _rot = []; for (var _r = 0; _r < n; _r++) _rot.push(_seq[(_sh + _r) % _origN]);
        _intSeeds.push(_rot);
    }
    for (var _is = 0; _is < _intSeeds.length; _is++) {
        var _okSeed = true;
        for (var _iv = 0; _iv < n; _iv++) {
            var _dd = state.D0 && state.D0[vns[_iv]];
            var _v = _intSeeds[_is][_iv];
            if (_dd && (_v < _dd.min || _v > _dd.max)) { _okSeed = false; break; }
        }
        if (_okSeed) combos.push(_intSeeds[_is]);
    }
    // 域远端采样种子（2026-08-22）：当某变量定义域宽度较大(>12)时，整数/原点优先种子
    // 偏向中心，可能漏掉落在域边缘的远端孤立根（如 Freudenstein-Roth 第二根 x1≈11.4）。
    // 追加少量确定性"域边界与三分点"种子（bounded，最多 +2^n 且受 256 上限约束），
    // 让牛顿有机会碰到远端根。对一般小域系统无影响（宽度<=12 不追加）。发散即跳过，无随机性。
    var _wideVars = [];
    for (var _wv = 0; _wv < n; _wv++) {
        var _wd = state.D0 && state.D0[vns[_wv]];
        if (_wd && (_wd.max - _wd.min) > 12) _wideVars.push(_wv);
    }
    if (_wideVars.length > 0 && combos.length < 256) {
        var _edgeSets = [];
        for (var _ev = 0; _ev < n; _ev++) {
            var _e = state.D0 && state.D0[vns[_ev]];
            if (_wideVars.indexOf(_ev) >= 0) {
                _edgeSets.push([_e.min, _e.min + (_e.max - _e.min) / 3, _e.min + 2 * (_e.max - _e.min) / 3, _e.max]);
            } else {
                _edgeSets.push([0]);
            }
        }
        var _ec = [[]];
        for (var _eci = 0; _eci < _edgeSets.length && _ec.length <= 256; _eci++) {
            var _enc = [];
            for (var _ea = 0; _ea < _ec.length; _ea++) for (var _eb = 0; _eb < _edgeSets[_eci].length; _eb++) _enc.push(_ec[_ea].concat([_edgeSets[_eci][_eb]]));
            _ec = _enc;
        }
        if (_ec.length > 256) _ec = _ec.slice(0, 256);
        for (var _ei2 = 0; _ei2 < _ec.length; _ei2++) combos.push(_ec[_ei2]);
    }
    var sols = [];
    for (var ci = 0; ci < combos.length; ci++) {
        var known = {};
        for (var vi = 0; vi < n; vi++) known[vns[vi]] = combos[ci][vi];
        var converged = false;
        for (var it = 0; it < 40; it++) {
            var fvec = [], maxf = 0;
            for (var ei = 0; ei < m; ei++) {
                var fv; try { fv = evalAST(eqs[ei], known); } catch(e) { fv = NaN; }
                if (!isFinite(fv)) fv = 1e30;
                fvec.push(fv);
                if (Math.abs(fv) > maxf) maxf = Math.abs(fv);
            }
            if (maxf < 1e-9) { converged = true; break; }
            var J = [];
            for (var jei = 0; jei < m; jei++) {
                var row = [];
                for (var jv = 0; jv < n; jv++) {
                    var h = 1e-6 * Math.max(1, Math.abs(known[vns[jv]] || 0));
                    known[vns[jv]] += h;
                    var fp; try { fp = evalAST(eqs[jei], known); } catch(e) { fp = NaN; }
                    known[vns[jv]] -= 2 * h;
                    var fm; try { fm = evalAST(eqs[jei], known); } catch(e) { fm = NaN; }
                    known[vns[jv]] += h;
                    row.push((isFinite(fp) && isFinite(fm)) ? (fp - fm) / (2 * h) : 0);
                }
                J.push(row);
            }
            var delta = null;
            try { var gs2 = gaussianSolve(J, fvec.map(function(v) { return -v; })); delta = gs2 ? gs2.solution : null; } catch(e) { delta = null; }
            if (!delta) break;
            var accepted = false;
            for (var dmp = 0; dmp < 10; dmp++) {
                var tmpK = {};
                for (var tk in known) { if (known.hasOwnProperty(tk)) tmpK[tk] = known[tk]; }
                for (var di = 0; di < n; di++) {
                    var nv = tmpK[vns[di]] + delta[di];
                    var dd = state.D0 && state.D0[vns[di]];
                    if (dd) { if (nv < dd.min) nv = dd.min; if (nv > dd.max) nv = dd.max; }
                    tmpK[vns[di]] = nv;
                }
                var nmf = 0;
                for (var fei = 0; fei < m; fei++) {
                    var fv2; try { fv2 = evalAST(eqs[fei], tmpK); } catch(e) { fv2 = NaN; }
                    if (!isFinite(fv2)) fv2 = 1e30;
                    if (Math.abs(fv2) > nmf) nmf = Math.abs(fv2);
                }
                if (nmf <= maxf || dmp >= 8) {
                    for (var di2 = 0; di2 < n; di2++) known[vns[di2]] = tmpK[vns[di2]];
                    accepted = true;
                    break;
                }
                for (var di3 = 0; di3 < n; di3++) delta[di3] *= 0.5;
            }
            if (!accepted) break;
        }
        if (converged) {
            var dup = false;
            for (var si = 0; si < sols.length; si++) {
                var dsum = 0;
                for (var dvi = 0; dvi < n; dvi++) dsum += Math.abs(sols[si].values[dvi] - known[vns[dvi]]);
                if (dsum < 1e-4) { dup = true; break; }
            }
            if (!dup) {
                var inDom = true, maxR = 0;
                for (var vi2 = 0; vi2 < n; vi2++) {
                    var dd2 = state.D0 && state.D0[vns[vi2]];
                    if (dd2 && (known[vns[vi2]] < dd2.min - 1e-6 || known[vns[vi2]] > dd2.max + 1e-6)) { inDom = false; break; }
                }
                if (inDom) {
                    for (var ei2 = 0; ei2 < m; ei2++) {
                        var rr; try { rr = Math.abs(evalAST(eqs[ei2], known)); } catch(e) { rr = 1e10; }
                        if (rr > maxR) maxR = rr;
                    }
                    if (maxR < 1e-9) sols.push({ values: vns.map(function(v) { return known[v]; }), residual: maxR });
                }
            }
        }
    }
    // 对称系统排列补全（2026-08-22）：对完全对称（变量置换不变）的方程组，
    // 多起点牛顿因笛卡尔积起点被截断（n≥4 时 7^n 远超 128 上限）只能收敛到部分排列解。
    // 这里对已得精确解生成全部变量排列并验证接收，补齐漏掉的排列解（如四元对称 (1,2,3,4)
    // 理论 24 解，起点不足时仅得部分）。非对称系统的伪排列会因 1e-9 残差阈值被拒，安全。
    if (sols.length > 0) {
        // 快照原始精确解，避免扩展过程中新加入的排列又被重复裂变
        var _baseSols = sols.map(function(s) { return s.values.slice(); });
        var _baseKeys = {};
        for (var _bk = 0; _bk < _baseSols.length; _bk++) {
            _baseKeys[_baseSols[_bk].map(function(v) { return v.toFixed(4); }).join(',')] = true;
        }
        var _perms = _permutations(n);
        for (var _pi = 0; _pi < _baseSols.length; _pi++) {
            var _base = _baseSols[_pi];
            for (var _pj = 0; _pj < _perms.length; _pj++) {
                var _perm = _perms[_pj];
                var _pv = [];
                for (var _pk = 0; _pk < n; _pk++) _pv.push(_base[_perm[_pk]]);
                // 与原始解集合去重（按原始顺序元组），避免重复加入同一排列
                var _key = _pv.map(function(v) { return v.toFixed(4); }).join(',');
                if (_baseKeys[_key]) continue;
                var _inDom2 = true;
                for (var _vi3 = 0; _vi3 < n; _vi3++) {
                    var _dd3 = state.D0 && state.D0[vns[_vi3]];
                    if (_dd3 && (_pv[_vi3] < _dd3.min - 1e-6 || _pv[_vi3] > _dd3.max + 1e-6)) { _inDom2 = false; break; }
                }
                if (!_inDom2) continue;
                // 残差验证（严格 1e-9，滤掉流形准解）
                var _known2 = {}; for (var _vi4 = 0; _vi4 < n; _vi4++) _known2[vns[_vi4]] = _pv[_vi4];
                var _maxR2 = 0;
                for (var _ei3 = 0; _ei3 < m; _ei3++) {
                    var _rr2; try { _rr2 = Math.abs(evalAST(eqs[_ei3], _known2)); } catch(e) { _rr2 = 1e10; }
                    if (_rr2 > _maxR2) _maxR2 = _rr2;
                }
                if (_maxR2 >= 1e-9) continue;
                sols.push({ values: _pv, residual: _maxR2 });
                _baseKeys[_key] = true;  // 登记，防止后续重复
            }
        }
    }
    return sols.length ? sols : null;
}


function suan47_tryNewton(state) {
    if (state.equations.length !== state.varNames.length) return false;
    var _msSols = _multiStartNewton(state);
    if (!(_msSols && _msSols.length)) return false;
    // 回代消元变量（suan19 消元后 varNames 可能缩减——如三数问题 z 被消，
    // 若不回代输出只有 [x,y] 两个分量）
    var _msOutVars = getOutputVarNames(state);
    var _msExpanded = [];
    for (var msi = 0; msi < _msSols.length; msi++) {
        var _msol = _msSols[msi];
        // 集中式回代：多起点牛顿收敛解（state.varNames 顺序）→ 完整坐标
        var _fvArr = reconstructSolution(state, _msol.values);
        if (_fvArr && _fvArr.every(function(x) { return isFinite(x); })) {
            _msExpanded.push({ values: _fvArr, residual: _msol.residual });
        }
    }
    if (!_msExpanded.length) return false;
    // 对称系统排列补全（2026-08-22）：消元后 _multiStartNewton 只在缩减变量空间
    // 收敛（维度低于原始），其内置排列扩展维度不对、无法补全高维排列解。
    // 这里在回代后的完整变量空间做排列扩展——对已得解的全体变量置换生成候选，
    // 用原始方程字符串验证残差 <1e-9 才接收。非对称系统的伪排列会被阈值拒，安全。
    // 覆盖 4/5/6 变量对称系统（如四元/五元/六元对称多项式根的置换解）。
    _msExpanded = _symmetryExpand(_msExpanded, _msOutVars, state.equationStrs, state.D0);
    // 原始方程最终复核（2026-08-22）：多起点牛顿基于化简后方程（如 log(u)=log(v)→u=v）
    // 收敛，但病态耦合下会收敛到流形准解（化简后残差<1e-9，原始超越方程下残差~1e-3）。
    // 这里用原始 equationStrs（含 log/sin 等）复核，滤掉原始残差>1e-7 的伪解，
    // 保留真解。无超越函数的纯代数系统原始残差本就<1e-9，不受影响。
    if (state.equationStrs && state.equationStrs.length) {
        var _eqASTs2 = [];
        for (var _eqi = 0; _eqi < state.equationStrs.length; _eqi++) {
            try {
                var _ei2 = state.equationStrs[_eqi].indexOf('=');
                _eqASTs2.push(parse(tokenize(fuzzyFix('(' + state.equationStrs[_eqi].slice(0, _ei2) + ')-(' + state.equationStrs[_eqi].slice(_ei2 + 1) + ')', state.protNames))));
            } catch (err) { _eqASTs2.push(null); }
        }
        var _filtered = [];
        for (var _fi = 0; _fi < _msExpanded.length; _fi++) {
            var _s = _msExpanded[_fi], _ok = true;
            var _vv = {}; for (var _vi5 = 0; _vi5 < _msOutVars.length; _vi5++) _vv[_msOutVars[_vi5]] = _s.values[_vi5];
            for (var _ea = 0; _ea < _eqASTs2.length; _ea++) {
                if (!_eqASTs2[_ea]) continue;
                var _rr3; try { _rr3 = Math.abs(evalAST(_eqASTs2[_ea], _vv)); } catch (err) { _rr3 = 1e10; }
                if (_rr3 > 1e-7) { _ok = false; break; }
            }
            if (_ok) _filtered.push(_s);
        }
        _msExpanded = _filtered;
    }
    if (!_msExpanded.length) return false;
    state.done = true;
    state.finalSolutions = _msExpanded;
    state.result = {
        solutions: _msExpanded,
        error: null,
        message: "多起点阻尼牛顿法求解：" + _msExpanded.length + " 组解",
        executionPath: "多起点牛顿",
        timeMs: performance.now() - state.startTime,
        confidence: "high",
        varNames: _msOutVars,
        resultType: 2,
        resultTypeName: "有限离散孤立采样点",
        resultTypeDesc: "多起点阻尼牛顿法收敛得到的解（确定性多起点，可复现）"
    };
    return true;
}


function _suan55Monotone(fprime, vn, a, b) {
    var iv = null;
    var env = {}; env[vn] = { min: a, max: b };
    try { iv = intervalEval(fprime, env); } catch (e) { return null; }
    if (!iv || !isFinite(iv.min) || !isFinite(iv.max)) return null;
    if (iv.max <= 0) return 'dec';
    if (iv.min >= 0) return 'inc';
    return null;
}


function _suan55Refine(fnode, vn, a, b, fa, fb) {
    var N = 6;
    var m0 = (a + b) / 2;
    // 牛顿：从段中点出发
    var x = m0;
    for (var i = 0; i < N; i++) {
        var fv = null;
        try { var pt = {}; pt[vn] = x; fv = evalAST(fnode, pt); } catch (e) { fv = null; }
        if (fv === null || !isFinite(fv) || Math.abs(fv) < 1e-14) return { x: x, ok: true };
        // 数值导数（中心差分，精度足够定位后由认证器给严格界）
        var h = Math.max(1e-7, Math.abs(x) * 1e-7);
        var fp = null;
        try {
            var p1 = {}, p2 = {};
            p1[vn] = x + h; p2[vn] = x - h;
            var f1 = evalAST(fnode, p1), f2 = evalAST(fnode, p2);
            if (isFinite(f1) && isFinite(f2)) fp = (f1 - f2) / (2 * h);
        } catch (e) { fp = null; }
        if (fp === null || !isFinite(fp) || Math.abs(fp) < 1e-300) break;
        var nx = x - fv / fp;
        if (!isFinite(nx) || nx < a || nx > b) break;         // 跳出区间 ⇒ 改用二分
        if (Math.abs(nx - x) < 1e-15) { x = nx; break; }
        x = nx;
    }
    // 二分兜底（有根区间）
    var lo = a, hi = b, flo = fa;
    for (var k = 0; k < 80 && (hi - lo) > 1e-14 * Math.max(1, Math.abs(lo)); k++) {
        var m = (lo + hi) / 2;
        var fmv = null;
        try { var pt2 = {}; pt2[vn] = m; fmv = evalAST(fnode, pt2); } catch (e) { fmv = null; }
        if (fmv === null || !isFinite(fmv)) return { x: x, ok: false };
        if (fmv === 0) return { x: m, ok: true };
        if ((flo < 0 && fmv < 0) || (flo > 0 && fmv > 0)) { lo = m; flo = fmv; }
        else hi = m;
    }
    return { x: (lo + hi) / 2, ok: true };
}
