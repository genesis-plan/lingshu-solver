/* 模块 algebra/simplex：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function _generateCorners(box, n) {
    if (n === 0) return [[]];
    var sub = _generateCorners(box, n - 1);
    var result = [];
    for (var si = 0; si < sub.length; si++) {
        var p1 = sub[si].concat([box[n-1].min]);
        var p2 = sub[si].concat([box[n-1].max]);
        result.push(p1, p2);
    }
    return result;
}


function _simplexCore(T, rhs, basis, obj, m, N) {
    var tab = [];
    for (var i = 0; i < m; i++) { var r = T[i].slice(); r.push(rhs[i]); tab.push(r); }
    var objRow = new Array(N + 1).fill(0);
    for (var j = 0; j < N; j++) objRow[j] = -obj[j];
    for (var i = 0; i < m; i++) {
        var bcol = basis[i], coef = objRow[bcol];
        if (coef !== 0) for (var j2 = 0; j2 <= N; j2++) objRow[j2] -= coef * tab[i][j2];
    }
    tab.push(objRow);
    var maxIter = 500;
    for (var it = 0; it < maxIter; it++) {
        var enter = -1, bestNeg = -1e-12;
        for (var j = 0; j < N; j++) { if (objRow[j] < bestNeg) { bestNeg = objRow[j]; enter = j; } }
        if (enter === -1) break;
        var leave = -1, bestRatio = Infinity;
        for (var i = 0; i < m; i++) {
            if (tab[i][enter] > 1e-12) {
                var ratio = tab[i][N] / tab[i][enter];
                if (ratio >= -1e-12 && ratio < bestRatio) { bestRatio = ratio; leave = i; }
            }
        }
        if (leave === -1) return { status: 'unbounded' };
        var piv = tab[leave][enter];
        for (var j2 = 0; j2 <= N; j2++) tab[leave][j2] /= piv;
        for (var i2 = 0; i2 <= m; i2++) {
            if (i2 === leave) continue;
            var f = tab[i2][enter];
            if (f !== 0) for (var j3 = 0; j3 <= N; j3++) tab[i2][j3] -= f * tab[leave][j3];
        }
        basis[leave] = enter;
    }
    for (var i = 0; i < m; i++) { T[i] = tab[i].slice(0, N); rhs[i] = tab[i][N]; }
    return { status: 'optimal' };
}


function _lpMaximize(c, A, b) {
    var m = A.length, n = c.length;
    if (m === 0) return null;
    var numArt = 0;
    for (var i = 0; i < m; i++) if (b[i] < 0) numArt++;
    var N = n + m + numArt;
    var T = [], rhs = [], basis = [], artCol = [], ai = 0;
    for (var i = 0; i < m; i++) {
        var row = new Array(N).fill(0);
        for (var j = 0; j < n; j++) row[j] = A[i][j];
        row[n + i] = 1;
        if (b[i] < 0) {
            for (var k = 0; k < N; k++) row[k] = -row[k];
            row[n + m + ai] = 1;
            artCol.push(n + m + ai);
            rhs.push(-b[i]);
            basis.push(n + m + ai);
            ai++;
        } else {
            rhs.push(b[i]);
            basis.push(n + i);
        }
        T.push(row);
    }
    // Phase 1: 最大化 -Σ人工变量
    var obj1 = new Array(N).fill(0);
    for (var t = 0; t < artCol.length; t++) obj1[artCol[t]] = -1;
    var r1 = _simplexCore(T, rhs, basis, obj1, m, N);
    if (r1.status === 'infeasible') return null;
    var artSum = 0;
    for (var bi = 0; bi < m; bi++) if (artCol.indexOf(basis[bi]) >= 0) artSum += rhs[bi];
    if (artSum > 1e-6) return null;
    // Phase 2 前：把仍在基中的退化人工变量主元换出；全零冗余行删除
    var artSet = {};
    for (var t = 0; t < artCol.length; t++) artSet[artCol[t]] = true;
    for (var bi = 0; bi < m; bi++) {
        if (artSet[basis[bi]]) {
            var pivCol = -1;
            for (var j = 0; j < N; j++) { if (!artSet[j] && Math.abs(T[bi][j]) > 1e-9) { pivCol = j; break; } }
            if (pivCol >= 0) {
                var piv = T[bi][pivCol];
                for (var j2 = 0; j2 < N; j2++) T[bi][j2] /= piv;
                rhs[bi] /= piv;
                for (var i2 = 0; i2 < m; i2++) { if (i2 === bi) continue; var f = T[i2][pivCol]; if (f !== 0) { for (var j3 = 0; j3 < N; j3++) T[i2][j3] -= f * T[bi][j3]; rhs[i2] -= f * rhs[bi]; } }
                basis[bi] = pivCol;
            } else {
                T[bi] = null;
            }
        }
    }
    var keep = [];
    for (var col = 0; col < N; col++) if (!artSet[col]) keep.push(col);
    var T2 = [], rhs2 = [], basis2 = [], newM = 0;
    for (var i = 0; i < m; i++) {
        if (T[i] === null) continue;
        var nr = [];
        for (var kk = 0; kk < keep.length; kk++) nr.push(T[i][keep[kk]]);
        T2.push(nr); rhs2.push(rhs[i]);
        var bb = basis[i], idx = keep.indexOf(bb);
        basis2.push(idx < 0 ? 0 : idx);
        newM++;
    }
    T = T2; rhs = rhs2; basis = basis2; m = newM; N = keep.length;
    // Phase 2: 最大化 c
    var obj2 = [];
    for (var j = 0; j < N; j++) obj2.push(0);
    for (var j = 0; j < n && j < N; j++) { var pos = keep.indexOf(j); if (pos >= 0) obj2[pos] = c[j]; }
    var r2 = _simplexCore(T, rhs, basis, obj2, m, N);
    if (r2.status === 'unbounded') return Infinity;
    if (r2.status === 'infeasible') return null;
    var val = 0;
    for (var bi = 0; bi < m; bi++) { var col = basis[bi]; if (col < n) val += c[col] * rhs[bi]; }
    return val;
}
