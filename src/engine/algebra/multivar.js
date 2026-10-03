/* 模块 algebra/multivar：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function _s59PAdd(a, b) {
    var n = Math.max(a.length, b.length);
    var out = new Array(n);
    for (var i = 0; i < n; i++) out[i] = (a[i] || 0) + (b[i] || 0);
    return out;
}

function _s59PSub(a, b) {
    var n = Math.max(a.length, b.length);
    var out = new Array(n);
    for (var i = 0; i < n; i++) out[i] = (a[i] || 0) - (b[i] || 0);
    return out;
}
// x 的升幂多项式：乘法（卷积）

function _s59PMul(a, b) {
    if (!a.length || !b.length) return [0];
    var out = new Array(a.length + b.length - 1);
    for (var i = 0; i < out.length; i++) out[i] = 0;
    for (var i2 = 0; i2 < a.length; i2++) {
        if (a[i2] === 0) continue;
        for (var j = 0; j < b.length; j++) out[i2 + j] += a[i2] * b[j];
    }
    return out;
}

function _s59PScale(a, k) {
    var out = new Array(a.length);
    for (var i = 0; i < a.length; i++) out[i] = a[i] * k;
    return out;
}

function _s59PIsZero(a) {
    for (var i = 0; i < a.length; i++) if (a[i] !== 0) return false;
    return true;
}

function _s59PTrim(a) {
    var d = a.length - 1;
    while (d > 0 && Math.abs(a[d]) < 1e-12) d--;
    return a.slice(0, d + 1);
}


function _s59PExactDiv(num, den) {
    if (_s59PIsZero(den)) return null;
    // 数值爆炸保护：任一系数非有限 ⇒ 立即失败（fail-closed，交回原路径）
    for (var _g = 0; _g < den.length; _g++) if (!isFinite(den[_g])) return null;
    for (var _h = 0; _h < num.length; _h++) if (!isFinite(num[_h])) return null;
    var d = den.length - 1;
    if (d === 0) {
        var out = new Array(num.length);
        for (var i = 0; i < num.length; i++) out[i] = num[i] / den[0];
        for (var j = 0; j < num.length; j++) {
            if (Math.abs(out[j] * den[0] - num[j]) > 1e-6 * (Math.abs(num[j]) + 1e-30)) return null;
        }
        return out;
    }
    // 高次除法：长除法（den 次数小，num 次数大）
    var rem = num.slice();
    var q = new Array(Math.max(1, rem.length - d));
    for (var i2 = 0; i2 < q.length; i2++) q[i2] = 0;
    var lead = den[d];
    for (var pos = rem.length - 1; pos >= d; pos--) {
        var c2 = rem[pos] / lead;
        if (c2 !== 0) {
            q[pos - d] = c2;
            for (var t = 0; t <= d; t++) rem[pos - d + t] -= c2 * den[t];
        }
    }
    // 余数必须为 0（相对容差）
    for (var m = 0; m < d; m++) {
        if (Math.abs(rem[m]) > 1e-6 * (Math.abs(num[m] || 0) + 1)) return null;
    }
    return q;
}


function _s59YNorm(A) {
    var out = [];
    for (var i = 0; i < A.length; i++) out.push(A[i] ? A[i] : [0]);
    var d = out.length - 1;
    while (d > 0 && _s59PIsZero(out[d])) d--;
    return out.slice(0, d + 1);
}


function _s59YAdd(A, B) {
    var n = Math.max(A.length, B.length);
    var out = [];
    for (var k = 0; k < n; k++) {
        var a = A[k] || [0], b = B[k] || [0];
        out.push(_s59PAdd(a, b));
    }
    return _s59YNorm(out);
}

function _s59YSub(A, B) {
    var n = Math.max(A.length, B.length);
    var out = [];
    for (var k = 0; k < n; k++) {
        var a = A[k] || [0], b = B[k] || [0];
        out.push(_s59PSub(a, b));
    }
    return _s59YNorm(out);
}


function _s59YMul(A, B) {
    var out = [];
    for (var i = 0; i < A.length + B.length - 1; i++) out.push([0]);
    for (var i2 = 0; i2 < A.length; i2++) {
        if (!A[i2] || _s59PIsZero(A[i2])) continue;
        for (var j = 0; j < B.length; j++) {
            if (!B[j] || _s59PIsZero(B[j])) continue;
            out[i2 + j] = _s59PAdd(out[i2 + j], _s59PMul(A[i2], B[j]));
        }
    }
    return _s59YNorm(out);
}


function _s59NumDivmod(a, b) {
    var da = a.length - 1, db = b.length - 1;
    if (db < 0) return null;
    var lead = b[db];
    if (Math.abs(lead) < 1e-300) return null;
    var rem = a.slice();
    var q = new Array(Math.max(1, da - db + 1));
    for (var i = 0; i < q.length; i++) q[i] = 0;
    for (var p = da - db; p >= 0; p--) {
        var c = rem[p + db] / lead;
        q[p] = c;
        if (c === 0) continue;
        for (var t = 0; t <= db; t++) rem[p + t] -= c * b[t];
    }
    // 余式降次
    var rd = rem.length - 1;
    while (rd > 0 && Math.abs(rem[rd]) < 1e-11) rd--;
    return [q, rem.slice(0, rd + 1)];
}

function _s59NumDeg(a) {
    var d = a.length - 1;
    while (d > 0 && Math.abs(a[d]) < 1e-11) d--;
    return d;
}
// 数值一元 gcd（Euclid）⇒ 返回非常数公共因子则返回 true

function _s59NumGcdNonConst(a, b) {
    var A = a.slice(), B = b.slice();
    if (_s59NumDeg(A) < _s59NumDeg(B)) { var t = A; A = B; B = t; }
    for (var guard = 0; guard < 24; guard++) {
        if (_s59NumDeg(B) <= 0) return false;
        var dm = _s59NumDivmod(A, B);
        if (!dm) return false;
        A = B; B = dm[1];
    }
    return false;
}
// f、g 在 y 上是否有非常数公共因子。

function _s59SquareFree(f) {
    var a = _s59PTrim(f.slice());
    if (a.length < 2) return null;
    // 数值导数 f'（升幂）
    var df = new Array(a.length - 1);
    for (var i = 1; i < a.length; i++) df[i - 1] = a[i] * i;
    df = _s59PTrim(df);
    if (df.length < 2) return a;              // 导数为常数 ⇒ f 本身无平方因子
    // 一元数值 gcd（Euclid）
    var A = a.slice(), B = df.slice();
    for (var guard = 0; guard < 32; guard++) {
        if (_s59NumDeg(B) <= 0) break;
        var dm = _s59NumDivmod(A, B);
        if (!dm) return null;
        A = B; B = _s59NumTrim(dm[1]);
        if (A.length && !isFinite(A[A.length - 1])) return null;
    }
    var g = _s59NumTrim(A);
    if (_s59NumDeg(g) <= 0) return a;           // gcd 为常数 ⇒ f 已无平方因子
    var q = _s59NumDivmod(a, g);
    if (!q) return null;
    var res = _s59NumTrim(q[0]);
    return res.length >= 2 ? res : null;
}

function _s59NumTrim(a) {
    var d = a.length - 1;
    while (d > 0 && Math.abs(a[d]) < 1e-11) d--;
    return a.slice(0, d + 1);
}


function BQNorm(A) {
    var out = [];
    // 兜底零元必须是 BQ（y 升幂数组，每项 x 升幂数组）= [[0]]，不能写 [0]
    for (var i = 0; i < A.length; i++) out.push(A[i] ? A[i] : [[0]]);
    var d = out.length - 1;
    while (d > 0 && _s59PIsZero(out[d])) d--;
    return out.slice(0, d + 1);
}

function BQAdd(A, B) {
    var n = Math.max(A.length, B.length), out = [];
    for (var k = 0; k < n; k++) out.push(_s59PAdd(A[k] || [0], B[k] || [0]));
    return BQNorm(out);
}

function BQSub(A, B) {
    var n = Math.max(A.length, B.length), out = [];
    for (var k = 0; k < n; k++) out.push(_s59PSub(A[k] || [0], B[k] || [0]));
    return BQNorm(out);
}

function BQScale(A, k) {
    var out = [];
    for (var i = 0; i < A.length; i++) out.push(_s59PScale(A[i], k));
    return BQNorm(out);
}
// BQ 乘法：(x,y) 二元多项式 × (x,y) 二元多项式

function BQMul(A, B) {
    var out = [];
    for (var i = 0; i < A.length + B.length - 1; i++) out.push([0]);
    for (var i2 = 0; i2 < A.length; i2++) {
        if (!A[i2] || _s59PIsZero(A[i2])) continue;
        for (var j = 0; j < B.length; j++) {
            if (!B[j] || _s59PIsZero(B[j])) continue;
            out[i2 + j] = _s59PAdd(out[i2 + j], _s59PMul(A[i2], B[j]));
        }
    }
    return BQNorm(out);
}
// BQ 是否为零。兼容两种输入：

function BQIsZero(A) {
    if (!A || !A.length) return true;
    if (typeof A[0] === 'number') return _s59PIsZero(A);   // number[] 直接判
    for (var i = 0; i < A.length; i++) if (!_s59PIsZero(A[i])) return false;
    return true;
}

function BQIsConst(A) {   // 是否为非零常数
    if (A.length !== 1) return false;
    var d = _s59PIsZero(A[0]) ? 0 : A[0].length - 1;
    return d === 0;
}
// BQ 求值：给定 x、y 的数值，返回数值

function BQEval(A, xv, yv) {
    var acc = 0;
    for (var k = A.length - 1; k >= 0; k--) {
        var c = A[k];
        var s = 0;
        for (var i = c.length - 1; i >= 0; i--) s = s * xv + c[i];
        acc = acc * yv + s;
    }
    return acc;
}
// BQ 的 x 次数（各 y 系数里 x 次数的最大值）

function BQDegX(A) {
    var d = 0;
    for (var i = 0; i < A.length; i++) {
        var c = A[i]; if (!c) continue;
        var dd = c.length - 1;
        while (dd > 0 && Math.abs(c[dd]) < 1e-12) dd--;
        if (dd > d) d = dd;
    }
    return d;
}
// BQ 的 y 次数

function BQDegY(A) {
    var d = A.length - 1;
    while (d > 0 && _s59PIsZero(A[d])) d--;
    return d;
}
// BQ 的总次数（x 与 y 次数之和的上界，用于主元比较）

function BQTotalDeg(A) { return BQDegX(A) + BQDegY(A); }
// BQ 的最大系数绝对值

function BQMaxAbs(A) {
    var m = 0;
    for (var i = 0; i < A.length; i++) {
        var c = A[i]; if (!c) continue;
        for (var j = 0; j < c.length; j++) { var v = Math.abs(c[j]); if (v > m) m = v; }
    }
    return m;
}
// BQ 版精确除法：Bareiss 理论整除；除数为常数时直接除并做相对容差校验，

function _s59BQExactDiv(num, den) {
    if (BQIsZero(den)) return null;
    for (var i = 0; i < num.length; i++) for (var j = 0; j < num[i].length; j++)
        if (!isFinite(num[i][j])) return null;
    for (var a = 0; a < den.length; a++) for (var b = 0; b < den[a].length; b++)
        if (!isFinite(den[a][b])) return null;

    if (BQIsConst(den)) {
        var c0 = den[0][0];
        if (Math.abs(c0) < 1e-300) return null;
        var out = BQNorm(num.map(function (cy) {
            return _s59PScale(cy, 1 / c0);
        }));
        for (var p = 0; p < out.length; p++) {
            for (var q = 0; q < out[p].length; q++) {
                if (Math.abs(out[p][q] * c0 - num[p][q]) > 1e-6 * (Math.abs(num[p][q]) + 1e-30)) return null;
            }
        }
        return out;
    }
    // 非常数除数：化为「按 y 升幂的系数级长除法」——
    // den = Σ d_k y^k，num = Σ n_k y^k。取 degY(den)=m 的最高项 d_m（关于 x 的多项式），
    // 若 d_m 是 x 的常数，则整个 BQ 除法降为逐系数除以该常数，可精确完成。
    var m = BQDegY(den);
    var lead = den[m];
    var leadDegX = lead.length - 1;
    while (leadDegX > 0 && Math.abs(lead[leadDegX]) < 1e-12) leadDegX--;
    if (leadDegX > 0) return null;     // 最高项仍含 x ⇒ 复杂整除，不保证 ⇒ 放弃
    var lv = lead[leadDegX];
    if (Math.abs(lv) < 1e-300) return null;
    var res = [];
    var nn = BQNorm(num);
    var top = nn.length - 1;
    var q = new Array(Math.max(1, top - m + 1));
    for (var z = 0; z < q.length; z++) q[z] = [[0]];
    var rem = nn.map(function (cy) { return cy.slice(); });
    for (var p2 = top - m; p2 >= 0; p2--) {
        var cur = rem[p2 + m];
        if (!cur) { q[p2] = [[0]]; continue; }
        var cd = cur.length - 1;
        while (cd > 0 && Math.abs(cur[cd]) < 1e-12) cd--;
        if (cd > 0) return null;                       // 当前系数还含 x ⇒ 放弃
        var cf = cur[cd] / lv;
        q[p2] = [[cf]];
        if (cf === 0) continue;
        for (var t = 0; t <= m; t++) {
            rem[p2 + t] = _s59PSub(rem[p2 + t], _s59PScale(den[t], cf));
        }
    }
    // 余式必须为零（相对容差）
    for (var r2 = 0; r2 < m; r2++) {
        if (!_s59PIsZero(rem[r2])) {
            var mx = 0;
            for (var s2 = 0; s2 < rem[r2].length; s2++) mx = Math.max(mx, Math.abs(rem[r2][s2]));
            if (mx > 1e-6) return null;
        }
    }
    return BQNorm(q);
}


function BTNorm(A) {
    var out = [];
    for (var i = 0; i < A.length; i++) out.push(A[i] ? A[i] : [[0]]);
    var d = out.length - 1;
    while (d > 0 && BQIsZero(out[d])) d--;
    return out.slice(0, d + 1);
}

function BTAdd(A, B) {
    var n = Math.max(A.length, B.length), out = [];
    for (var k = 0; k < n; k++) out.push(BQAdd(A[k] || [[0]], B[k] || [[0]]));
    return BTNorm(out);
}

function BTSub(A, B) {
    var n = Math.max(A.length, B.length), out = [];
    for (var k = 0; k < n; k++) out.push(BQSub(A[k] || [[0]], B[k] || [[0]]));
    return BTNorm(out);
}

function BTMul(A, B) {
    var out = [];
    for (var i = 0; i < A.length + B.length - 1; i++) out.push([[0]]);
    for (var i2 = 0; i2 < A.length; i2++) {
        if (!A[i2] || BQIsZero(A[i2])) continue;
        for (var j = 0; j < B.length; j++) {
            if (!B[j] || BQIsZero(B[j])) continue;
            out[i2 + j] = BQAdd(out[i2 + j], BQMul(A[i2], B[j]));
        }
    }
    return BTNorm(out);
}

function BTIsZero(A) {
    for (var i = 0; i < A.length; i++) if (!BQIsZero(A[i])) return false;
    return true;
}

function BTDegZ(A) {
    var d = A.length - 1;
    while (d > 0 && BQIsZero(A[d])) d--;
    return d;
}
// AST → 关于 z 的升幂表示 BT

function _s59PRS(fZ, gZ) {
    var A = BTNorm(fZ), B = BTNorm(gZ);
    if (BTIsZero(B)) return null;
    // 保证 deg_z A ≥ deg_z B（否则交换；Res 差一个符号，根集不变）
    if (BTDegZ(A) < BTDegZ(B)) { var t = A; A = B; B = t; }

    // BT 关于 z 的首项系数（BQ）
    function leadBQ(P) { return P[BTDegZ(P)]; }

    // 伪余式：r = lc(B)^{degA - degR + 1} · A mod B
    // 实现要点：反复执行 r ← r·lc(B) − lead(r)·z^{deg r − deg B}·B，
    //           每步把 r 的 z 次数至少降 1；乘 lc(B) 消掉了分母（伪余式定义）。
    function pseudoRem(Ax, Bx) {
        var db = BTDegZ(Bx);
        if (db < 0) return null;
        var lb = leadBQ(Bx);
        if (BQIsZero(lb)) return null;                 // B 的首项为零 ⇒ 退化
        var r = BTNorm(Ax);
        for (var guard = 0; guard < 64; guard++) {
            var dr = BTDegZ(r);
            if (dr < db) return r;
            if (BQIsZero(r)) return [[0]];
            var lr = leadBQ(r);
            // r ← r · lc(B)
            r = BTMul(r, [lb]);
            // r ← r − lead(r)·z^(dr−db)·B
            var e = dr - db;
            var Bshift = [];
            for (var q = 0; q < e; q++) Bshift.push([[0]]);
            for (var q2 = 0; q2 < Bx.length; q2++) Bshift.push(Bx[q2]);
            r = BTNorm(BTSub(r, BTMul(Bshift, [lr])));
        }
        return r;   // 64 轮仍未降次 ⇒ 数值异常，交回调用方处理
    }

    for (var g2 = 0; g2 < 48; g2++) {
        if (BTDegZ(B) < 0 || BQIsZero(leadBQ(B))) {
            // B 的 z-首项系数为零 ⇒ 退化
            break;
        }
        // B 已是 z 的常数（相对 A 而言）⇒ 伪余式链终止，B 的 z-首项系数即 Res
        if (BTDegZ(B) === 0) { A = B; B = [[0]]; break; }
        var r = pseudoRem(A, B);
        if (!r) return null;
        A = B;
        B = BTNorm(r);
        if (BTIsZero(B)) return null;                 // 公共因子 ⇒ 零维性破坏 ⇒ 放弃
    }
    var last = A;                                    // 链上最后一个非零余式
    if (BTIsZero(last)) return null;
    // 最后一个非零伪余式的 z-首项系数（BQ）作为 Res 的代表元
    var res = leadBQ(last);
    if (!res || BQIsZero(res)) return null;
    res = BQNorm(res);
    if (res.length < 2) return res;                   // 只是 x 的多项式
    // 归一化到 O(1)
    var mx = BQMaxAbs(res);
    if (!isFinite(mx) || mx < 1e-300) return null;
    return BQScale(res, 1 / mx);
}


function _s59PRSxy(fY, gY) {
    var A = BQNorm(fY), B = BQNorm(gY);
    if (BQDegY(B) < 0) return null;
    if (BQDegY(A) < BQDegY(B)) { var t = A; A = B; B = t; }
    // y 的首项系数（x 的升幂数组 number[]）
    function leadX(P) {
        var c = P[BQDegY(P)];
        if (!c) return [0];
        var d = c.length - 1;
        while (d > 0 && Math.abs(c[d]) < 1e-12) d--;
        return d < 0 ? [0] : c.slice(0, d + 1);
    }
    function pseudoRem(Ax, Bx) {
        var db = BQDegY(Bx);
        if (db < 0) return null;
        var lb = leadX(Bx);
        if (_s59PIsZero(lb)) return null;
        var r = BQNorm(Ax);
        for (var guard = 0; guard < 64; guard++) {
            var dr = BQDegY(r);
            if (dr < db) return r;
            if (_s59PIsZero(r)) return [[0]];
            var lr = leadX(r);
            r = BQMul(r, [lb]);                       // r ← r · lc(B)
            var e = dr - db;
            var Bshift = [];
            for (var q = 0; q < e; q++) Bshift.push([0]);
            for (var q2 = 0; q2 < Bx.length; q2++) Bshift.push(Bx[q2]);
            r = BQNorm(BQSub(r, BQMul(Bshift, [lr]))); // r ← r − lead(r)·y^e·B
        }
        return r;
    }
    for (var g2 = 0; g2 < 48; g2++) {
        if (BQDegY(B) < 0 || _s59PIsZero(leadX(B))) break;
        if (BQDegY(B) === 0) { A = B; B = [[0]]; break; }
        var r2 = pseudoRem(A, B);
        if (!r2) return null;
        A = B; B = BQNorm(r2);
        if (BQIsZero(B)) return null;
    }
    var res = leadX(A);
    if (!res || _s59PIsZero(res)) return null;
    res = _s59PTrim(res.slice());
    if (res.length < 2) return null;
    var mx = 0;
    for (var i = 0; i < res.length; i++) mx = Math.max(mx, Math.abs(res[i]));
    if (!isFinite(mx) || mx < 1e-300) return null;
    return _s59PScale(res, 1 / mx);
}
