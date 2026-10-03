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
    // 使用自适应阈值：基础绝对阈值 + 系数幅度相对阈值
    // 整数系数多项式在真实根处 polyEval 应精确为0，浮点误差远小于1e-3
    const coeffMax = Math.max(...intCoeffs.map(c => Math.abs(c)));
    const rootThreshold = Math.max(1e-6, 1e-8 * coeffMax);
    const roots = [];
    for (const c of candidates) {
        const val = polyEval(intCoeffs, c);
        if (Math.abs(val) < rootThreshold) {
            roots.push(c);
        }
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
            // 验证 r 是否确实是当前 remaining 的根
            const valAtR = polyEval(remaining, r);
            const leadingCoeff = Math.abs(remaining[remaining.length - 1]);
            if (Math.abs(valAtR) > 1e-6 * Math.max(1, leadingCoeff)) {
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
        // 验证扫描根：大系数多项式可能产生假根
        const leadingCoeff = Math.abs(remaining[remaining.length - 1]);
        for (const r of scanRoots) {
            const val = Math.abs(polyEval(remaining, r));
            if (val < 1e-3 * Math.max(1, leadingCoeff)) {
                roots.push(r);
            }
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
                    roots.push(mid);
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
                // 检查是否已经被精确根检测捕获
                let candidate = (lo + hi) / 2;
                // 牛顿精修提高精度（大系数多项式需要）
                for (let iter = 0; iter < 20; iter++) {
                    const f = polyEval(coeffs, candidate);
                    const df = polyDerivative(coeffs, candidate);
                    if (Math.abs(df) < 1e-12) break;
                    const newR = candidate - f / df;
                    if (Math.abs(newR - candidate) < tolerance) { candidate = newR; break; }
                    candidate = newR;
                }
                if (roots.length === 0 || Math.abs(roots[roots.length - 1] - candidate) > tolerance) {
                    roots.push(candidate);
                }
            }
        }

        // 检测精确根（val ≈ 0）
        if (Math.abs(val) < tolerance * 10) {
            // 牛顿精修
            let r = x;
            for (let iter = 0; iter < 20; iter++) {
                const f = polyEval(coeffs, r);
                const df = polyDerivative(coeffs, r);
                if (Math.abs(df) < 1e-12) break;
                const newR = r - f / df;
                if (Math.abs(newR - r) < tolerance) { r = newR; break; }
                r = newR;
            }
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
// 一元多项式在区间 [lo, hi] 内的**不同实根精确个数**。

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
