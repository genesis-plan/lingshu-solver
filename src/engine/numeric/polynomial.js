/* 模块 numeric/polynomial：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function solveQuadraticFormula(coeffs) {
    const c = coeffs[0];
    const b = coeffs[1];
    const a = coeffs[2];

    if (Math.abs(a) < 1e-12) {
        // 退化为一次方程
        if (Math.abs(b) < 1e-12) return [];
        return [-c / b];
    }

    const discriminant = b * b - 4 * a * c;

    if (discriminant < -1e-12) {
        // 无实根
        return [];
    }

    if (Math.abs(discriminant) < 1e-12) {
        // 重根
        return [-b / (2 * a)];
    }

    const sqrtD = Math.sqrt(discriminant);
    // 使用数值稳定的求根公式避免大数相消
    // 如果 b > 0: q = -(b + sqrtD) / 2; 否则 q = -(b - sqrtD) / 2
    const q = b > 0 ? -(b + sqrtD) / 2 : -(b - sqrtD) / 2;
    const root1 = q / a;
    const root2 = c / q;

    return root1 < root2 ? [root1, root2] : [root2, root1];
}


function syntheticDivide(coeffs, root) {
    const n = coeffs.length - 1;
    const result = new Array(n).fill(0);
    result[n - 1] = coeffs[n];
    for (let i = n - 1; i >= 1; i--) {
        result[i - 1] = coeffs[i] + root * result[i];
    }
    return result;
}


function polyEval(coeffs, x) {
    let result = 0;
    for (let i = coeffs.length - 1; i >= 0; i--) {
        result = result * x + coeffs[i];
    }
    return result;
}


// ===== 后向稳定残差（Higham 2002《Accuracy and Stability of Numerical Algorithms》§3.1）=====
//
// 为什么不能拿「首项系数 × 固定小数」当「r 是不是根」的判据：
//   p(x)=Σaᵢxⁱ 用 Horner 在双精度下求值，舍入误差上界是 γ_n·Σ|aᵢxⁱ|（γ_n≈n·eps），
//   **与各项本身的量级成正比**，不是与首项系数成正比。
//   实测事故（2026-10-04）：5x⁴−1e12x²+7=0
//     · 首项系数 |a₄|=5 ⇒ 旧阈值 1e-3·max(1,5)=5e-3；
//     · 但真根 x≈±4.4721e5 处 Σ|aᵢxⁱ|≈4e23 ⇒ 舍入地板 ≈ulp(2e23)≈3.4e7；
//     · 「|p(r)|<5e-3」在双精度下**数学上不可达** ⇒ 4 个实根被静默丢掉 2 个大的，
//       对外还报 NO_SOLUTION（而引擎自己的 Sturm 计数说域内有 4 个实根）。
//
// 正确判据（与 pipeline/solver.js 的 _finalResidualGate 同一原理，两处必须一致）：
//   |p(x)| ≤ τ·Σ|aᵢxⁱ|，τ=1e-11
// τ 取 1e-11 的理由：需 ≥ n·eps（n≤10 时约 1e-15，留 4 个数量级余量），
// 又要远小于任何有意义的残差 ⇒ 既不误杀真根，也不放行伪根。
//
// ⚠ fail-closed 方向：值非有限、尺度非有限 ⇒ 一律判「不是根」。
//   放行方向绝不能开口，否则大系数下会重新变成伪根发射器。
function polyTermScale(coeffs, x) {
    const ax = Math.abs(x);
    let s = 0;
    for (let i = coeffs.length - 1; i >= 0; i--) {
        const t = Math.abs(coeffs[i]) * Math.pow(ax, i);
        if (!isFinite(t)) return Infinity;
        s += t;
    }
    return s;
}

function polyIsRootWithin(coeffs, x, tau) {
    const val = polyEval(coeffs, x);
    if (!isFinite(val)) return false;
    const s = polyTermScale(coeffs, x);
    if (!isFinite(s)) return false;
    return Math.abs(val) <= Math.max(1e-12, (tau || 1e-11) * s);
}


// 牛顿精修到【双精度机器精度】，而不是到调用方的输出网格精度。
// ⚠ 为什么不能用 tolerance（=1e-6 输出网格）当牛顿的停机判据：
//   「根算到 1e-6」与「根报出来时保留 6 位小数」是两件不同的事。混用会让
//   polyIsRootWithin 的后向残差判据永远通不过 —— 实测 x⁴−13x²+4 的扫描根
//   |p(r)|≈1.9e-7 而尺度 329（阈值 3.3e-9），四个真根被自己的判据全灭。
//   停机判据必须是「新一步在双精度下不再改变 x」，这与输出网格无关。
// 退化保护：|f| 不再下降（振荡/发散）即停；df 过小也停。
function polyNewtonPolish(coeffs, x0, maxIter) {
    var r = x0;
    var prevAbsF = Infinity;
    for (var it = 0; it < (maxIter || 60); it++) {
        var f = polyEval(coeffs, r);
        if (!isFinite(f)) break;
        var af = Math.abs(f);
        if (!(af < prevAbsF)) break;                 // 不再下降 ⇒ 到达精度地板或振荡
        prevAbsF = af;
        var df = polyDerivative(coeffs, r);
        if (!isFinite(df) || Math.abs(df) < 1e-300) break;
        var newR = r - f / df;
        if (!isFinite(newR)) break;
        if (newR === r) break;                       // 双精度下已无进展
        r = newR;
    }
    return r;
}


function rationalRootTheorem(coeffs) {
    const n = coeffs.length - 1;
    if (n <= 0) return [];

    // a_0 ≈ 0 意味着 x=0 是一个根：记录后综合除法降次，再继续枚举其余有理根
    // （旧逻辑直接 return [0]，会漏掉 x=0 之外的其余有理根，如 x^2 - x = 0 漏掉 x=1）
    if (Math.abs(coeffs[0]) < 1e-12) {
        const reduced = syntheticDivide(coeffs, 0);
        const otherRoots = rationalRootTheorem(reduced);
        return [0].concat(otherRoots);
    }

    let maxDenom = 1;
    for (const c of coeffs) {
        const str = c.toFixed(6);
        if (str.includes('.')) {
            const decPart = str.split('.')[1];
            // 去除尾零
            const trimmed = decPart.replace(/0+$/, '');
            if (trimmed.length > 0) {
                const denom = Math.pow(10, trimmed.length);
                if (denom > maxDenom) maxDenom = denom;
            }
        }
    }

    // 转为整数系数
    const intCoeffs = coeffs.map(c => Math.round(c * maxDenom));
    const a0 = Math.abs(intCoeffs[0]);
    const an = Math.abs(intCoeffs[n]);

    if (an === 0) return [];

    // 求所有因数
    function divisors(num) {
        const result = [];
        for (let i = 1; i * i <= num; i++) {
            if (num % i === 0) {
                result.push(i);
                if (i !== num / i) result.push(num / i);
            }
        }
        return result;
    }

    const pDivs = divisors(a0);
    const qDivs = divisors(an);

    // 枚举所有 p/q 组合
    const candidates = new Set();
    for (const p of pDivs) {
        for (const q of qDivs) {
            candidates.add(p / q);
            candidates.add(-p / q);
        }
    }

    // 候选根数量熔断（规格：>20000 降级）
    if (candidates.size > 20000) return null;

    // 测试每个候选根
    // 判据用后向稳定残差 polyIsRootWithin：整数系数在真根处 Horner 值本应精确为 0，
    // 但候选是 p/q（二进制不精确），浮点误差不可省。旧的 max(1e-6, 1e-8·coeffMax)
    // 只看系数最大值、不看各项在 r 处的量级，大系数下同样不可达（见 polyIsRootWithin 注释）。
    const roots = [];
    for (const c of candidates) {
        if (polyIsRootWithin(intCoeffs, c)) roots.push(c);
    }

    return roots;
}


function polynomialAllRoots(coeffs, tolerance) {
    const roots = [];
    let remaining = [...coeffs];

    // 去除前导零（高次项系数为0）
    while (remaining.length > 1 && Math.abs(remaining[remaining.length - 1]) < 1e-12) {
        remaining.pop();
    }

    if (remaining.length <= 1) return roots;

    // 阶段1：有理根定理
    const rationalRoots = rationalRootTheorem(remaining);
    if (rationalRoots && rationalRoots.length > 0) {
        for (const r of rationalRoots) {
            // 验证 r 是否确实是当前 remaining 的根（后向稳定残差，不用首项系数当尺度）
            if (!polyIsRootWithin(remaining, r)) {
                // r 不是当前多项式的根，跳过（不降次）
                continue;
            }

            roots.push(r);
            // 综合除法降次
            const quotient = syntheticDivide(remaining, r);
            remaining = quotient;
            // 去除前导零
            while (remaining.length > 1 && Math.abs(remaining[remaining.length - 1]) < 1e-12) {
                remaining.pop();
            }
        }
    }

    // 阶段2：对剩余多项式求解
    if (remaining.length > 3) {
        // 三次以上：符号变化扫描+牛顿精修
        const scanRoots = scanRealRoots(remaining, tolerance);
        // 验证扫描根：大系数多项式可能产生假根。
        // ⚠ 旧判据 `val < 1e-3·max(1,|a_n|)` 是**尺度盲**的 —— 它只看首项系数，
        //   不看各项在 r 处的量级。5x⁴−1e12x²+7 的真根 r≈4.47e5 处 Σ|aᵢrⁱ|≈4e23，
        //   双精度舍入地板 ≈3.4e7，而旧阈值只有 5e-3 ⇒ 不可达 ⇒ 真根被丢（实测 4 根只输出 2 根）。
        for (const r of scanRoots) {
            if (polyIsRootWithin(remaining, r)) roots.push(r);
        }
    } else if (remaining.length === 3) {
        // 二次方程：判别式求根公式（精确解，避免扫描精度损失）
        const quadRoots = solveQuadraticFormula(remaining);
        roots.push(...quadRoots);
    } else if (remaining.length === 2) {
        // 一次方程 a_0 + a_1*x = 0
        if (Math.abs(remaining[1]) > 1e-12) {
            roots.push(-remaining[0] / remaining[1]);
        }
    }

    return roots;
}


function scanRealRoots(coeffs, tolerance) {
    const roots = [];
    const n = coeffs.length - 1;
    const an = Math.abs(coeffs[n]);
    if (an < 1e-12) return roots;

    // Cauchy 界：所有实根 |x| ≤ 1 + max(|a_i / a_n|)
    let maxRatio = 0;
    for (let i = 0; i < n; i++) {
        maxRatio = Math.max(maxRatio, Math.abs(coeffs[i] / an));
    }
    const scanRange = Math.min(1000000, 1 + maxRatio);
    // 自适应步长：保证至少有 2000 个采样点
    const step = Math.max(scanRange / 2000, 0.001);

    let prevVal = polyEval(coeffs, -scanRange);
    let prevX = -scanRange;

    for (let x = -scanRange + step; x <= scanRange; x += step) {
        const val = polyEval(coeffs, x);

        // 检测符号变化（根在 prevX 和 x 之间）
        // 注意：当 val 或 prevVal 恰好为 0 时，prevVal * val = 0 不满足 < 0
        // 所以额外检测 prevVal 和 val 异号或其中之一为零的情况
        if (prevVal * val < 0 || (Math.abs(prevVal) < tolerance * 10 && Math.abs(val) < tolerance * 10 && prevVal !== 0 && val !== 0 && Math.sign(prevVal) !== Math.sign(val))) {
            // 二分法精修
            let lo = prevX, hi = x;
            let loVal = prevVal;
            for (let iter = 0; iter < 50; iter++) {
                const mid = (lo + hi) / 2;
                const midVal = polyEval(coeffs, mid);
                if (Math.abs(midVal) < tolerance) {
                    // 同样精修到机器精度：这里 push 的 mid 只满足 |p|<tolerance，
                    // 不满足 polyIsRootWithin 的后向残差判据（实测会漏掉真根）
                    roots.push(polyNewtonPolish(coeffs, mid, 60));
                    break;
                }
                if (loVal * midVal < 0) {
                    hi = mid;
                } else {
                    lo = mid;
                    loVal = midVal;
                }
            }
            // 仅在二分法未收敛到 tolerance 时添加最后近似值
            if (roots.length === 0 || Math.abs(roots[roots.length - 1] - (lo + hi) / 2) > tolerance) {
                // 牛顿精修到机器精度（大系数多项式必需，见 polyNewtonPolish 注释）
                const candidate = polyNewtonPolish(coeffs, (lo + hi) / 2, 60);
                if (roots.length === 0 || Math.abs(roots[roots.length - 1] - candidate) > tolerance) {
                    roots.push(candidate);
                }
            }
        }

        // 检测精确根（val ≈ 0）
        if (Math.abs(val) < tolerance * 10) {
            const r = polyNewtonPolish(coeffs, x, 60);
            if (roots.length === 0 || Math.abs(roots[roots.length - 1] - r) > tolerance) {
                roots.push(r);
            }
        }

        prevVal = val;
        prevX = x;
    }

    return roots;
}


function polyDerivative(coeffs, x) {
    let result = 0;
    for (let i = 1; i < coeffs.length; i++) {
        result += i * coeffs[i] * Math.pow(x, i - 1);
    }
    return result;
}


function _bisectRoot1D(eq, vn, a, b, fa, fb, state, allSolutions, resultVarNames) {
    var _mid2, _fm2, _vm2 = {};
    for (var _bi3 = 0; _bi3 < 100; _bi3++) {
        _mid2 = (a + b) / 2;
        _vm2[vn] = _mid2;
        _fm2 = evalAST(eq, _vm2);
        if (_fm2 === null || _fm2 !== _fm2 || !isFinite(_fm2)) break; // 意外奇点 → 保守终止
        if ((b - a) / 2 < 1e-10) {
            // 集中式回代：单变量中点 [_mid2] → 完整坐标，统一 roundToGrid
            var _fullValues = reconstructSolution(state, [_mid2]).map(roundToGrid);
            allSolutions.push({ values: _fullValues, residual: Math.abs(_fm2), _bisect: true });
            break;
        }
        if (_fm2 * fa < 0) { b = _mid2; fb = _fm2; }
        else { a = _mid2; fa = _fm2; }
    }
}
// 含奇点区间的递归细分（通用奇点分裂）：区间预检含奇点（除零/定义域错/±∞）时，不整体跳过，

function _recScanInterval(eq, vn, a, b, state, allSolutions, resultVarNames, depth) {
    if (depth > 4 || (b - a) < 1e-6) return;
    var _sv = { nan: _IEEE.nan, inf: _IEEE.inf, divZero: _IEEE.divZero, domainErr: _IEEE.domainErr };
    _ieeeReset();
    var _ivm = {}; _ivm[vn] = { min: a, max: b };
    var _iv = intervalEval(eq, _ivm);
    var _myDiv = _IEEE.divZero, _myDom = _IEEE.domainErr;
    _IEEE.nan = _sv.nan; _IEEE.inf = _sv.inf; _IEEE.divZero = _sv.divZero; _IEEE.domainErr = _sv.domainErr;
    var _hasSing = (_iv === null && (_myDiv || _myDom)) || (_iv !== null && (!isFinite(_iv.min) || !isFinite(_iv.max)));
    if (!_hasSing) {
        var _fa = _pointResidual(eq, vn, a), _fb = _pointResidual(eq, vn, b);
        if (_fa !== null && _fb !== null && _fa * _fb < 0) _bisectRoot1D(eq, vn, a, b, _fa, _fb, state, allSolutions, resultVarNames);
        return;
    }
    var _m = (a + b) / 2;
    _recScanInterval(eq, vn, a, _m, state, allSolutions, resultVarNames, depth + 1);
    _recScanInterval(eq, vn, _m, b, state, allSolutions, resultVarNames, depth + 1);
}


function _linearCoef1D(n, vn) {
    if (!n) return null;
    if (n.type === 'num') return { a: 0, b: n.value };
    if (n.type === 'var') return (n.name === vn) ? { a: 1, b: 0 } : null;
    if (n.type === 'unary' && n.op === '-') { var _t = _linearCoef1D(n.operand, vn); return _t ? { a: -_t.a, b: -_t.b } : null; }
    if (n.type === 'binop') {
        if (n.op === '+' || n.op === '-') {
            var _l = _linearCoef1D(n.left, vn), _r = _linearCoef1D(n.right, vn);
            if (_l && _r) return { a: _l.a + (n.op === '-' ? -_r.a : _r.a), b: _l.b + (n.op === '-' ? -_r.b : _r.b) };
            return null;
        }
        if (n.op === '*') {
            if (n.left.type === 'num' && n.right.type === 'var' && n.right.name === vn) return { a: n.left.value, b: 0 };
            if (n.right.type === 'num' && n.left.type === 'var' && n.left.name === vn) return { a: n.right.value, b: 0 };
            return null;
        }
        if (n.op === '/') {
            var _ld = _linearCoef1D(n.left, vn);
            if (_ld && n.right.type === 'num' && n.right.value !== 0) return { a: _ld.a / n.right.value, b: _ld.b / n.right.value };
            return null;
        }
    }
    return null;
}
// 单变量周期检测（issue A 修复 2026-09-01）：遍历 AST，对 sin/cos/tan/cot/sec/csc 且参数为 vn 的

function _detectPeriod1D(node, vn) {
    var _P = null;
    (function _walkPer(n) {
        if (!n) return;
        if (n.type === 'func' && ['sin', 'cos', 'sec', 'csc', 'tan', 'cot'].indexOf(n.name) >= 0) {
            var _c = _linearCoef1D(n.arg, vn);
            if (_c && _c.a !== 0) {
                var _p = (n.name === 'tan' || n.name === 'cot') ? (Math.PI / Math.abs(_c.a)) : (2 * Math.PI / Math.abs(_c.a));
                if (_P === null || _p < _P) _P = _p;
            }
        }
        if (n.type === 'func') { if (n.arg) _walkPer(n.arg); if (n.args) for (var _ai = 0; _ai < n.args.length; _ai++) _walkPer(n.args[_ai]); }
        else if (n.type === 'binop') { _walkPer(n.left); _walkPer(n.right); }
        else if (n.type === 'unary') { _walkPer(n.operand); }
    })(node);
    return _P;
}


function _eqRefsOnlyAllowed(eq, allowed) {
    var _ok = true;
    (function _w(n) {
        if (!n || !_ok) return;
        if (n.type === 'var') { if (allowed.indexOf(n.name) < 0) _ok = false; }
        else if (n.type === 'binop') { _w(n.left); _w(n.right); }
        else if (n.type === 'unary') { _w(n.operand); }
        else if (n.type === 'func') { if (n.arg) _w(n.arg); if (n.args) for (var _ai = 0; _ai < n.args.length; _ai++) _w(n.args[_ai]); }
    })(eq);
    return _ok;
}


function _polyRemainderAsc(a, b) {
    if (!a || !b || !b.length) return null;
    var db = b.length - 1;
    if (db < 0) return null;
    if (db === 0) return [0];                    // 除以非零常数：整除
    var lead = b[db];
    if (lead === 0) return null;                 // b 退化：最高次系数为 0
    var r = a.slice();
    var da = r.length - 1;
    for (var i = da; i >= db; i--) {
        var coef = r[i] / lead;
        if (coef === 0) continue;
        for (var j = 0; j <= db; j++) r[i - db + j] -= coef * b[j];
    }
    var out = [];
    for (var k = 0; k < db; k++) {
        var v = r[k];
        out.push((v === 0 || Math.abs(v) < 1e-300) ? 0 : v);   // 归零噪声
    }
    return out;
}
// 多项式求导（升幂系数）

function _polyDerivAsc(a) {
    if (!a || a.length < 2) return [0];
    var d = [];
    for (var i = 1; i < a.length; i++) d.push(a[i] * i);
    return d.length ? d : [0];
}
// 去掉升幂数组尾部的零系数

function _polyTrimAsc(a) {
    var i = a.length - 1;
    while (i > 0 && a[i] === 0) i--;
    return a.slice(0, i + 1);
}
// 在点 x 处求值（升幂系数，Horner）

function _polyEvalAsc(a, x) {
    var s = 0;
    for (var i = a.length - 1; i >= 0; i--) s = s * x + a[i];
    return s;
}
// 构造 Sturm 链。返回数组（每个元素是升幂系数数组），失败返回 null。

function _sturmChainAsc(coeffsAsc) {
    var p = _polyTrimAsc(coeffsAsc);
    if (!p || p.length < 2) return null;              // 次数 < 1：无 Sturm 链可言
    for (var i = 0; i < p.length; i++) if (!isFinite(p[i])) return null;
    var d = _polyTrimAsc(_polyDerivAsc(p));
    if (!d || d.length < 1 || (d.length === 1 && d[0] === 0)) return null;  // 常数（原式已无根可数）
    var chain = [p, d];
    var guard = p.length + 4;                          // 链长不超过次数+1，防死循环
    // 一次式：P1 = P' 已是常数，Sturm 链到此即为完整（修复：勿再算余式导致误判失败）
    while (chain.length < guard && chain[chain.length - 1].length > 1) {
        var a = chain[chain.length - 2], b = chain[chain.length - 1];
        var rem = _polyRemainderAsc(a, b);
        if (rem === null) return null;                 // 除数退化 ⇒ 判据失效
        var neg = rem.map(function (v) { return -v; });
        var isZero = true;
        for (var j = 0; j < neg.length; j++) if (neg[j] !== 0) { isZero = false; break; }
        if (isZero) return null;                       // 余式为零 ⇒ a 被 b 整除（应先约公因子）
        // 数值退化防护：若本项相对上项过小，Sturm 链在此已不可靠 ⇒ 保守失败
        var maxCur = 0, maxPrev = 0;
        for (var m = 0; m < neg.length; m++) maxCur = Math.max(maxCur, Math.abs(neg[m]));
        for (var m2 = 0; m2 < b.length; m2++) maxPrev = Math.max(maxPrev, Math.abs(b[m2]));
        if (maxPrev > 0 && maxCur < maxPrev * 1e-13) return null;   // 链条塌缩 ⇒ 拒绝给计数
        chain.push(_polyTrimAsc(neg));           // 必须 trim：否则尾零使链永不终止（x^5-1 曾因此失败）
        if (chain[chain.length - 1].length === 1) break;  // 到达非零常数，链结束
    }
    if (chain[chain.length - 1].length !== 1) return null;  // 未收敛到常数 ⇒ 失败
    return chain;
}
// Sturm 链在 x 处的符号变化数 V(x)（忽略零项）

function _sturmVariations(chain, x) {
    var prev = 0, cnt = 0;
    for (var i = 0; i < chain.length; i++) {
        var v = _polyEvalAsc(chain[i], x);
        if (!isFinite(v)) return -1;                   // 非有限 ⇒ 无法判定
        if (v === 0) continue;                          // 忽略零项
        var s = (v > 0) ? 1 : -1;
        if (prev !== 0 && s !== prev) cnt++;
        prev = s;
    }
    return cnt;
}
// Sturm 链在 x→±∞ 处的符号变化数 V(±∞)。
//
// 🔴 为什么不能在 ±∞ 处**求值**（2026-10-04 实测踩坑）：
//   朴素写法是 _sturmVariations(chain, 1e6) / (chain, -1e6)。但 ±1e6 **不是 ∞**，
//   它只是「盒内计数」而不是「全域计数」。实测 x^2=2 域给 [1,2]：
//     盒内 [1,2] 数出 1 个根、found 也是 1 ⇒ 旧代码据此判「全部解」，
//     而 −√2 是真解且在盒外 ⇒ **谎报找全**（P0，canAssert.allSolutions 还给了 true）。
//   病根是「把盒内计数当全域计数用」，不是求值精度问题。
//
// ✅ 正确做法：x→+∞ 时多项式 p 的符号 = sign(首项系数)；x→−∞ 时 = sign(首项系数) × (−1)^次数。
//   这**只读链上每个多项式的首项系数与次数**，不依赖任何具体取值点，数学上就是真 ±∞。
//   Sturm 定理：#ℝ 上的不同实根 = V(−∞) − V(+∞)。
//   实测 9/9 与手算吻合，且与盒内计数**故意不同**（x^2-2：全域 2、盒[1,2] 1）。
function _sturmVariationsAtInfinity(chain, atPositiveInfinity) {
    var signs = [];
    for (var i = 0; i < chain.length; i++) {
        var t = _polyTrimAsc(chain[i]);
        if (!t || t.length < 1) continue;
        var deg = t.length - 1;
        var lead = t[deg];
        if (lead === 0 || !isFinite(lead)) continue;
        var s = (lead > 0) ? 1 : -1;
        if (!atPositiveInfinity && (deg % 2 === 1)) s = -s;   // x→−∞ 时乘 (−1)^deg
        signs.push(s);
    }
    var prev = 0, cnt = 0;
    for (var j = 0; j < signs.length; j++) {
        if (signs[j] === 0) continue;
        if (prev !== 0 && signs[j] !== prev) cnt++;
        prev = signs[j];
    }
    return cnt;
}
// 一元多项式在**声明空间**内的不同实根精确个数。端点可为 ±Infinity。
//
// ★ 这是「完备性证据」唯一该用的计数 —— 区间必须表达**声明空间**（问题本身允许的解范围），
//   而声明空间由**问题里的不等式约束**决定，不是搜索盒，也不是盲目用 ℝ。两种用错都会出事：
//
//   (a) 搜索盒 `domain:{x:[1,2]}` —— 是**搜索提示**（去哪里找），不是问题的一部分。
//       实测 `x^2=2` 域 [1,2]：盒内 1 根、found 1 ⇒ 若拿它当完备性证据就判「全部解」，
//       而 −√2 是真解 ⇒ **谎报找全**（P0，2026-10-04）。
//   (b) 盲目用 ℝ —— 同样会谎报。实测 `x^2-4=0, x>0`：声明空间是 (0,∞)，
//       ℝ 上有 2 个根（±2），但只有 x=2 满足约束。found=1 ≠ 2 ⇒ 把完备的答案判成「部分解」。
//       约束 `x>0` 是**问题的一部分**，它定义了解集本身，必须计入计数区间。
//
// 数学：Sturm 定理 V(a) − V(b) = #(a,b]（**右端点含、左端点不含**）。
//   ⚠ 端点语义是实测出来的，不是猜的（2026-10-04，dist 真实函数）：
//     x−1 计数区间 [0,1]  ⇒ 1（根 1 = 右端点，**计入**）
//     x²−4 计数区间 [−2,0] ⇒ 0（根 −2 = 左端点，**不计入**）
//   故基线语义是 (lo,hi]。真正的闭/开端点用 opts.loClosed / opts.hiClosed 做修正。
//
// @param {number[]} coeffsAsc 升幂系数
// @param {number} lo 下端点（可 -Infinity）
// @param {number} hi 上端点（可 +Infinity）
// @param {{loClosed?:boolean, hiClosed?:boolean}} [opts] 端点是否属于声明空间
// @returns {{ok:boolean, count?:number, vLo?:number, vHi?:number, why?:string}}
function _sturmCountRange(coeffsAsc, lo, hi, opts) {
    var L = (lo === undefined || lo === null) ? -Infinity : Number(lo);
    var H = (hi === undefined || hi === null) ? Infinity : Number(hi);
    if (L !== L || H !== H) return { ok: false, why: '区间端点非数' };   // NaN
    if (L === Infinity || H === -Infinity) return { ok: true, count: 0 }; // 空区间
    if (L > H) return { ok: false, why: '区间端点反序' };
    var chain = _sturmChainAsc(coeffsAsc);
    if (!chain) return { ok: false, why: 'Sturm 链构造失败（公因子/数值退化/非多项式）' };
    // ±∞ 端点**不求值**，直接读首项系数符号（数学上就是真 ±∞，见 _sturmVariationsAtInfinity）。
    var vLo = (L === -Infinity) ? _sturmVariationsAtInfinity(chain, false) : _sturmVariations(chain, L);
    var vHi = (H === Infinity) ? _sturmVariationsAtInfinity(chain, true) : _sturmVariations(chain, H);
    if (vLo < 0 || vHi < 0) return { ok: false, why: '端点求值非有限' };
    var cnt = vLo - vHi;              // #(L,H] —— 基线语义
    if (cnt < 0) return { ok: false, why: 'Sturm 计数出现负值（数值不可靠）' };
    // —— 端点修正（基线是 (L,H]：左端已排除、右端已含）——
    //   · loClosed=true  ⇒ 声明空间含 L，若 L 本身是根必须**补回** +1。
    //     漏补 ⇒ count 偏小 ⇒ found 恰好等于偏小的 count ⇒ **谎报找全**（最危险）。
    //   · hiClosed=false ⇒ 声明空间不含 H，若 H 本身是根必须**剔除** −1。
    //     漏剔 ⇒ count 偏大 ⇒ found<count ⇒ 报「部分解/缺 N 个」（保守，安全）。
    var o = opts || {};
    if (o.loClosed === true && isFinite(L) && _polyRootAtStrict(coeffsAsc, L)) cnt += 1;
    if (o.hiClosed === false && isFinite(H) && _polyRootAtStrict(coeffsAsc, H)) cnt -= 1;
    if (cnt < 0) return { ok: false, why: 'Sturm 端点修正后计数为负（数值不可靠）' };
    return { ok: true, count: cnt, vLo: vLo, vHi: vHi, chainLen: chain.length };
}
// p(x) 在 x=c 处是否为根（带相对容差）。判定不确定时返回 **false**（fail-closed）。
// ⚠ 为什么必须 fail-closed：端点根多算/少算都会动完备性判定。
//   多算 → count 偏大 → found<count → 报「部分解」（保守，安全）。
//   少算 → count 偏小 → 可能 found==count 而实际漏了端点根 → **谎报找全**（致命）。
//   而本函数只在「**含**该端点」的区间里被用来**加**一根（+1），或在「**不含**」时用来**减**一根（−1）。
//   ⇒ 宁可返回 false 让 +1 不发生（走「保守少算」方向），绝不做可能造成谎报的减法。
function _polyRootAtStrict(coeffsAsc, c) {
    if (!isFinite(c)) return false;
    var v;
    try { v = _polyEvalAsc(coeffsAsc, c); } catch (e) { return false; }
    if (typeof v !== 'number' || !isFinite(v)) return false;
    if (v === 0) return true;
    // 相对容差：与该点的多项式量级比较（避免 x=1e6 附近的根被绝对容差吃掉）
    var scale = 0, ax = Math.abs(c);
    for (var i = 0; i < coeffsAsc.length; i++) {
        var t = Math.abs(coeffsAsc[i]) * Math.pow(ax, i);
        if (!isFinite(t)) return false;
        if (t > scale) scale = t;
    }
    if (scale === 0) scale = 1;
    return Math.abs(v) <= 1e-12 * scale;
}
// 一元多项式在**整个 ℝ** 上的不同实根精确个数（域无关，与搜索盒无关）。
//
// ⚠ 声明空间是 ℝ 时才用它。若问题带了不等式约束（如 `x>0`），必须用
//   _sturmCountRange(coeffs, 约束下界, 约束上界) —— 否则会把被约束排除的真根算进来，
//   把本来完备的答案误判成「部分解」。
//
// @param {number[]} coeffsAsc 升幂系数
// @returns {{ok:boolean, count?:number, vNeg?:number, vPos?:number, why?:string}}
function _sturmCountAllReal(coeffsAsc) {
    return _sturmCountRange(coeffsAsc, -Infinity, Infinity);
}
// 一元多项式在区间 [lo, hi] 内的**不同实根精确个数**（端点语义 (lo,hi]，左开右闭）。
//
// 🔴⚠ 只用于**盒内**诊断（sturmIncomplete / missingRealRootCount / resultant.js 的盒内计数），
//   **不得**当完备性证据 —— 域外的根它数不到。完备性请用 _sturmCountRange（声明空间口径）。
//   实测事故（2026-10-04）：x^2=2 域 [1,2] 时本函数返回 1，与 found=1 相等，
//   旧代码据此判「全部解」，而 −√2 在盒外是漏解 ⇒ 谎报。
// ⚠ 本函数**保持原样不改成 _sturmCountRange 的调用**：它语义是 (lo,hi]、端点必为有限数，
//   盒内诊断要的就是这个口径；混用两套端点语义会引入难以察觉的 ±1 偏差。
function _sturmCountAsc(coeffsAsc, lo, hi) {
    var chain = _sturmChainAsc(coeffsAsc);
    if (!chain) return { ok: false, why: 'Sturm 链构造失败（公因子/数值退化/非多项式）' };
    var big = 1e6;
    var a = (lo === undefined || lo === null) ? -big : lo;
    var b = (hi === undefined || hi === null) ? big : hi;
    var va = _sturmVariations(chain, a);
    var vb = _sturmVariations(chain, b);
    if (va < 0 || vb < 0) return { ok: false, why: '端点求值非有限' };
    var cnt = va - vb;
    if (cnt < 0) return { ok: false, why: 'Sturm 计数出现负值（数值不可靠）' };
    return { ok: true, count: cnt, chainLen: chain.length };
}
