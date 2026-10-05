/* 模块 algebra/exact：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function _s60gcd(a, b) {
    a = a < 0n ? -a : a; b = b < 0n ? -b : b;
    while (b) { const t = a % b; a = b; b = t; }
    return a;
}

function _s60mk(p, q) {
    if (q === 0n) return null;
    if (q < 0n) { p = -p; q = -q; }
    const g = _s60gcd(p, q);
    if (g > 1n) { p /= g; q /= g; }
    return { p: p, q: q };
}

function _s60add(a, b) { if (a.p === 0n) return b; if (b.p === 0n) return a; return _s60mk(a.p * b.q + b.p * a.q, a.q * b.q); }

function _s60sub(a, b) { if (b.p === 0n) return a; return _s60mk(a.p * b.q - b.p * a.q, a.q * b.q); }

function _s60mul(a, b) { if (a.p === 0n || b.p === 0n) return _s60R0(); return _s60mk(a.p * b.p, a.q * b.q); }

function _s60div(a, b) { if (b.p === 0n) return null; if (a.p === 0n) return _s60R0(); return _s60mk(a.p * b.q, a.q * b.p); }

function _s60neg(a) { return { p: -a.p, q: a.q }; }

function _s60abs(a) { return a.p < 0n ? _s60neg(a) : a; }

function _s60cmp(a, b) { const l = a.p * b.q, r = b.p * a.q; return l < r ? -1 : (l > r ? 1 : 0); }

function _s60num(a) { return Number(a.p) / Number(a.q); }


function _s60fromNumber(x, maxDen) {
    if (typeof x !== 'number' || !isFinite(x)) return null;
    if (Number.isInteger(x)) return _s60mk(BigInt(x), 1n);
    const md = BigInt(maxDen || 1000000000);
    const neg = x < 0; let y = Math.abs(x);
    let h1 = 1n, h0 = 0n, k1 = 0n, k0 = 1n;
    for (let i = 0; i < 64; i++) {
        const a = BigInt(Math.floor(y));
        const h2 = a * h1 + h0, k2 = a * k1 + k0;
        if (k2 > md) break;
        h0 = h1; h1 = h2; k0 = k1; k1 = k2;
        const frac = y - Number(a);
        if (frac < 1e-17) break;
        y = 1 / frac;
    }
    const r = _s60mk(neg ? -h1 : h1, k1);
    const err = Math.abs(_s60num(r) - x);
    if (err > 1e-12 * Math.max(1, Math.abs(x))) return null;
    return r;
}


function _s60presolve(Ac0, bc0, n, o) {
    const oo = o || {};
    const stats = { zeroRow: 0, zeroCol: 0, singletonRow: 0, dupRow: 0, diagDominant: 0, passes: 0 };
    let A = Ac0.map(r => r.slice()), b = bc0.slice();
    let act = []; for (let k = 0; k < n; k++) act.push(k);
    const fixed = new Array(n).fill(null);
    let changed = true, guard = 0;

    const nzRow = r => { let c = 0; for (let k = 0; k < act.length; k++) if (!_s60isZero(A[r][k])) c++; return c; };
    const nzCol = k => { let c = 0; for (let r = 0; r < A.length; r++) if (!_s60isZero(A[r][k])) c++; return c; };
    // 行规范化 key：整行除以「首个非零元」+ rhs 除以同一元素 ⇒ 成比例的两行 key 相同
    const rowCanon = r => {
        let lead = -1;
        for (let k = 0; k < act.length; k++) if (!_s60isZero(A[r][k])) { lead = k; break; }
        if (lead < 0) return 'ZERO|' + b[r].p + '/' + b[r].q;
        const inv = _s60div(_s60R1(), A[r][lead]);
        let s = '';
        for (let k = 0; k < act.length; k++) {
            const q = _s60mul(A[r][k], inv);
            s += q.p + '|' + q.q + ';';
        }
        const rhs = _s60mul(b[r], inv);
        return s + '||' + rhs.p + '/' + rhs.q;
    };

    while (changed && guard++ < 400) {
        changed = false;
        stats.passes++;

        for (let i = A.length - 1; i >= 0; i--) {
            if (nzRow(i) === 0) {
                if (!_s60isZero(b[i])) return { infeasible: true, reason: 'zeroRow', stats: stats, fixed: fixed };
                A.splice(i, 1); b.splice(i, 1);
                stats.zeroRow++; changed = true;
            }
        }
        if (!A.length || !act.length) break;

        // R5 重复行
        {
            const seen = new Set(); let removed = false;
            for (let i = 0; i < A.length; i++) {
                const key = rowCanon(i);
                if (seen.has(key)) { A.splice(i, 1); b.splice(i, 1); stats.dupRow++; changed = removed = true; break; }
                seen.add(key);
            }
            if (removed) continue;
        }

        {
            let did = false;
            for (let i = 0; i < A.length && !did; i++) {
                if (nzRow(i) !== 1) continue;
                let t = -1;
                for (let k = 0; k < act.length; k++) if (!_s60isZero(A[i][k])) { t = k; break; }
                if (t < 0) continue;
                const v = _s60div(b[i], A[i][t]);
                if (v === null) return { infeasible: true, reason: 'singletonRowZeroPivot', stats: stats, fixed: fixed };
                fixed[act[t]] = v;
                const pivotRow = A[i].slice();
                for (let r = 0; r < A.length; r++) {
                    if (r === i) continue;
                    const c = A[r][t];
                    if (_s60isZero(c)) continue;
                    b[r] = _s60sub(b[r], _s60mul(c, v));
                    for (let k = 0; k < act.length; k++) if (k !== t) A[r][k] = _s60sub(A[r][k], _s60mul(c, pivotRow[k]));
                    A[r][t] = _s60R0();
                }
                A.splice(i, 1); b.splice(i, 1);
                for (let r = 0; r < A.length; r++) A[r] = A[r].filter((_, idx) => idx !== t);
                act.splice(t, 1);
                stats.singletonRow++; changed = did = true;
            }
            if (did) continue;
        }

        {
            let did = false;
            for (let k = 0; k < act.length; k++) {
                if (nzCol(k) === 0) {
                    fixed[act[k]] = _s60R0();
                    for (let r = 0; r < A.length; r++) A[r] = A[r].filter((_, idx) => idx !== k);
                    act.splice(k, 1);
                    stats.zeroCol++; changed = did = true;
                    break;
                }
            }
            if (did) continue;
        }

        // R7 严格对角占优（唯一解定论）
        if (!oo.skipDom && A.length === act.length && act.length > 0) {
            let dd = true;
            for (let k = 0; k < act.length; k++) {
                let diag = null, sum = _s60R0();
                for (let r = 0; r < A.length; r++) {
                    if (r === k) { if (!_s60isZero(A[r][k])) diag = _s60abs(A[r][k]); }
                    else sum = _s60add(sum, _s60abs(A[r][k]));
                }
                if (!diag || _s60cmp(diag, sum) <= 0) { dd = false; break; }
            }
            if (dd) { stats.diagDominant++; return { dense: true, exactUnique: true, A: A, b: b, act: act, fixed: fixed, stats: stats }; }
        }
    }
    return { A: A, b: b, act: act, fixed: fixed, stats: stats };
}


function _s60bareissExact(A0, b0) {
    const m = A0.length, n = A0[0] ? A0[0].length : 0;
    if (!m || !n) return { rank: 0, consistent: true, underdetermined: true };
    const M = A0.map((r, i) => r.map(v => v).concat([b0[i]]));
    const piv = new Array(n).fill(-1);
    let rank = 0, prev = _s60R1(), nswap = 0;
    for (let k = 0; k < n && rank < m; k++) {
        let pi = -1;
        for (let i = rank; i < m; i++) if (!_s60isZero(M[i][k])) { pi = i; break; }
        if (pi < 0) continue;
        if (pi !== rank) { const t = M[pi]; M[pi] = M[rank]; M[rank] = t; nswap++; }
        const p = M[rank][k];
        if (rank > 0) {
            for (let i = rank + 1; i < m; i++) {
                if (_s60isZero(M[i][k])) continue;
                const f = M[i][k];
                for (let j = k; j <= n; j++) {
                    M[i][j] = _s60div(_s60sub(_s60mul(M[i][j], p), _s60mul(f, M[rank][j])), prev);
                    if (M[i][j] === null) return { failed: true };
                }
                M[i][k] = _s60R0();
            }
        } else {
            for (let i = rank + 1; i < m; i++) {
                if (_s60isZero(M[i][k])) continue;
                const f = _s60div(M[i][k], p);
                if (f === null) return { failed: true };
                for (let j = k; j <= n; j++) M[i][j] = _s60sub(M[i][j], _s60mul(f, M[rank][j]));
                M[i][k] = _s60R0();
            }
        }
        piv[rank] = k; prev = p; rank++;
    }
    for (let i = rank; i < m; i++) if (!_s60isZero(M[i][n])) return { rank: rank, consistent: false };
    if (rank < n) return { rank: rank, consistent: true, underdetermined: true, M: M, piv: piv };
    const x = new Array(n).fill(null);
    for (let r = n - 1; r >= 0; r--) {
        const pc = piv[r];
        let s = M[r][n];
        for (let j = pc + 1; j < n; j++) if (x[j]) s = _s60sub(s, _s60mul(M[r][j], x[j]));
        x[pc] = _s60div(s, M[r][pc]);
        if (x[pc] === null) return { failed: true };
    }
    let det = M[n - 1][n - 1];
    for (let i = 0; i < nswap; i++) det = _s60neg(det);
    return { rank: rank, consistent: true, unique: true, x: x, det: det };
}


function _s60particular(A0, b0, n) {
    const m = A0.length;
    const M = A0.map((r, i) => r.map(v => v).concat([b0[i]]));
    let rr = 0; const pivCol = [];
    for (let k = 0; k < n && rr < m; k++) {
        let pi = -1;
        for (let i = rr; i < m; i++) if (!_s60isZero(M[i][k])) { pi = i; break; }
        if (pi < 0) continue;
        if (pi !== rr) { const t = M[pi]; M[pi] = M[rr]; M[rr] = t; }
        const p = M[rr][k];
        for (let i = rr + 1; i < m; i++) {
            if (_s60isZero(M[i][k])) continue;
            const f = _s60div(M[i][k], p);
            if (f === null) return null;
            for (let j = k; j <= n; j++) M[i][j] = _s60sub(M[i][j], _s60mul(f, M[rr][j]));
            M[i][k] = _s60R0();
        }
        pivCol.push(k); rr++;
    }
    const x = new Array(n).fill(null);
    for (let r = rr - 1; r >= 0; r--) {
        const pc = pivCol[r];
        let s = M[r][n];
        for (let j = pc + 1; j < n; j++) if (x[j]) s = _s60sub(s, _s60mul(M[r][j], x[j]));
        x[pc] = _s60div(s, M[r][pc]);
        if (x[pc] === null) return null;
    }
    for (let j = 0; j < n; j++) if (x[j] === null) x[j] = _s60R0();
    return x;
}


function _s60nullspace(A0, n) {
    const m = A0.length;
    if (m === 0) {
        const I = [];
        for (let j = 0; j < n; j++) { const v = new Array(n).fill(_s60R0()); v[j] = _s60R1(); I.push(v); }
        return { rref: [], pivots: [], basis: I };
    }
    const M = A0.map(r => r.map(v => v));
    const pivCol = [];      // pivCol[r] = 第 r 个主元所在的列
    const pivotRowOf = {};  // col -> row
    let rr = 0;
    for (let k = 0; k < n && rr < m; k++) {
        let pi = -1;
        for (let i = rr; i < m; i++) if (!_s60isZero(M[i][k])) { pi = i; break; }
        if (pi < 0) continue;
        if (pi !== rr) { const t = M[pi]; M[pi] = M[rr]; M[rr] = t; }
        const p = M[rr][k];
        // 化成 1：整行除以主元（有理精确）
        for (let j = k; j < n; j++) {
            const q = _s60div(M[rr][j], p);
            if (q === null) return null;
            M[rr][j] = q;
        }
        // 消掉其余行的这一列
        for (let i = 0; i < m; i++) {
            if (i === rr || _s60isZero(M[i][k])) continue;
            const f = M[i][k];
            for (let j = k; j < n; j++) M[i][j] = _s60sub(M[i][j], _s60mul(f, M[rr][j]));
        }
        pivCol.push(k); pivotRowOf[k] = rr; rr++;
    }
    // 自由列 = 非主元列
    const isPiv = new Array(n).fill(false);
    for (const c of pivCol) isPiv[c] = true;
    const freeCols = [];
    for (let j = 0; j < n; j++) if (!isPiv[j]) freeCols.push(j);
    // 每个自由列 f 造一个零空间基向量
    const basis = [];
    for (const f of freeCols) {
        const v = new Array(n).fill(_s60R0());
        v[f] = _s60R1();
        for (let r = 0; r < pivCol.length; r++) {
            const c = M[pivotRowOf[pivCol[r]]][f];
            if (!_s60isZero(c)) v[pivCol[r]] = _s60neg(c);   // 主元位 = −R[row][f]
        }
        basis.push(v);
    }
    return { rref: M, pivots: pivCol, freeCols: freeCols, basis: basis, rank: pivCol.length };
}

// ── 2026-10-05 删除：_s60sampleAffine（零空间参数化仿射采样）整块 ──
//
// 用户契约：「对于部分解的，只找到一个推荐解就行，不需要确定性，不需要离原点最近」。
// 实测该函数是「欠定题返回体 95.6%~97.6% 都是采样点」的元凶：
//   3 元欠定 → 257 个解 / 77 KB     6 元欠定 → 512 个解 / 153 KB。
// 而且那 512 个点**没有一个能升级 proven**（浮点线性组合 ⇒ 只能 candidate）。
//
// 删除是数学上的进步而非退让：改用 RREF 自由列取 0 的**精确特解**，
//   · 可做 ℚ 上精确代入确证 ⇒ tier 升到 proven；
//   · 是消元法的规范选择，不需额外度量（不像伪逆最小范数要指定欧氏范数）；
//   · 返回体 153KB → 4.0KB。
//
// 留下的历史教训（写在此处以免重犯，别删）：
//   本函数曾有**生产事故级**缺陷：push() 是 O(|out|) 线性去重且无总量上限，
//   每方向 CAP+1=257 个点、方向数 k ⇒ |out| 可达 257^k，整体退化到 O(N²)。
//   触发用例 E2（4 方程 6 未知、3 维解流形、域 ±1e6）：
//   CPU profile 90.8% ticks 烧在此函数，**60 秒被 kill 仍不返回**。
//   8 秒硬预算兜不住 —— 预算检查在【算子粒度】，这是算子**内部**死循环。
//   ⇒ 教训：任何「生成候选集」的循环都必须自带总量硬闸 + O(1) 去重，
//     不能指望外层预算兜底；而最好的闸门是**根本不要生成**不需要的候选。


function _s60markowitz(A, k, m, n, u) {
    const rowsNZ = new Array(m);
    for (let i = 0; i < m; i++) { let c = 0; for (let j = k; j < n; j++) if (A[i][j] !== 0) c++; rowsNZ[i] = c; }
    const cand = [];
    for (let i = k; i < m; i++) if (rowsNZ[i] > 0) cand.push(i);
    if (!cand.length) return null;
    cand.sort((x, y) => rowsNZ[x] - rowsNZ[y]);
    const colNZ = new Array(n).fill(0), colMax = new Array(n).fill(0);
    for (let i = k; i < m; i++) for (let j = k; j < n; j++) {
        if (A[i][j] !== 0) { colNZ[j]++; const av = Math.abs(A[i][j]); if (av > colMax[j]) colMax[j] = av; }
    }
    const searchRows = cand.slice(0, 3);
    let best = null, bestCost = Infinity;
    for (const i of searchRows) {
        for (let j = k; j < n; j++) {
            const v = A[i][j];
            if (v === 0) continue;
            if (Math.abs(v) < u * colMax[j] * (1 - 1e-12)) continue;   // 稳定因子筛除
            const cost = (rowsNZ[i] - 1) * (colNZ[j] - 1);
            if (cost < bestCost) { bestCost = cost; best = [i, j]; }
        }
    }
    if (best) return best;
    let bi = -1, bj = -1, bv = 0;
    for (let i = k; i < m; i++) for (let j = k; j < n; j++) if (Math.abs(A[i][j]) > bv) { bv = Math.abs(A[i][j]); bi = i; bj = j; }
    if (bv === 0) return null;
    return [bi, bj];
}


function _s60presolveFloat(A0, b0, n, o) {
    const EPS = 1e-12;
    const stats = { zeroRow: 0, singletonRow: 0, dupRow: 0 };
    let A = A0.map(r => r.slice()), b = b0.slice();
    let act = []; for (let k = 0; k < n; k++) act.push(k);
    const fixed = new Array(n).fill(null);
    let changed = true, guard = 0;
    const isz = v => Math.abs(v) < EPS;

    while (changed && guard++ < 100) {
        changed = false;
        for (let i = A.length - 1; i >= 0; i--) {
            let allz = true;
            for (let k = 0; k < act.length; k++) if (!isz(A[i][k])) { allz = false; break; }
            if (allz) {
                if (!isz(b[i])) return { infeasible: true, reason: 'float-zeroRow' };
                A.splice(i, 1); b.splice(i, 1); stats.zeroRow++; changed = true;
            }
        }
        if (!A.length || !act.length) break;
        // R5 重复行（【必须按成比例判定，不能只比零/非零结构】）
        //   实测教训：稠密 6×6 里每行的零/非零结构完全相同，只比结构会把 6 行删成 4 行，
        //   变成「4 行 6 变量」的伪欠定。虽被后续精确残差验证兜住（结果仍对），
        //   但那是运气 —— 一旦验证失败就会给错误答案。改为「按首个非零元归一化后比较」。
        {
            const seen = new Set(); let rm = false;
            for (let i = 0; i < A.length; i++) {
                let lead = -1;
                for (let k = 0; k < act.length; k++) if (!isz(A[i][k])) { lead = k; break; }
                let key;
                if (lead < 0) key = 'ZERO|' + b[i].toExponential(12);
                else {
                    const s = A[i][lead];
                    let t = '';
                    for (let k = 0; k < act.length; k++) t += (A[i][k] / s).toFixed(12) + ',';
                    key = t + '||' + (b[i] / s).toFixed(12);
                }
                if (seen.has(key)) { A.splice(i, 1); b.splice(i, 1); stats.dupRow++; changed = rm = true; break; }
                seen.add(key);
            }
            if (rm) continue;
        }
        {
            let did = false;
            for (let i = 0; i < A.length && !did; i++) {
                let cnt = 0, t = -1;
                for (let k = 0; k < act.length; k++) if (!isz(A[i][k])) { cnt++; t = k; if (cnt > 1) break; }
                if (cnt !== 1 || t < 0) continue;
                const v = b[i] / A[i][t];
                fixed[act[t]] = v;
                const prow = A[i].slice();
                for (let r = 0; r < A.length; r++) {
                    if (r === i) continue;
                    const c = A[r][t];
                    if (isz(c)) continue;
                    b[r] -= c * v;
                    for (let k = 0; k < act.length; k++) if (k !== t) A[r][k] -= c * prow[k];
                    A[r][t] = 0;
                }
                A.splice(i, 1); b.splice(i, 1);
                for (let r = 0; r < A.length; r++) A[r] = A[r].filter((_, idx) => idx !== t);
                act.splice(t, 1);
                stats.singletonRow++; changed = did = true;
            }
            if (did) continue;
        }
        {
            let did = false;
            for (let k = 0; k < act.length; k++) {
                let cnt = 0;
                for (let r = 0; r < A.length; r++) if (!isz(A[r][k])) { cnt++; break; }
                if (cnt === 0) {
                    fixed[act[k]] = 0;
                    for (let r = 0; r < A.length; r++) A[r] = A[r].filter((_, idx) => idx !== k);
                    act.splice(k, 1);
                    stats.zeroCol = (stats.zeroCol || 0) + 1;
                    changed = did = true; break;
                }
            }
            if (did) continue;
        }
    }
    return { A: A, b: b, act: act, fixed: fixed, stats: stats, allSolved: act.length === 0 };
}


function _s60diagDominantFloat(A, n, EPS) {
    if (A.length !== n) return false;
    for (let k = 0; k < n; k++) {
        const d = Math.abs(A[k][k]);
        if (d < EPS) return false;
        let s = 0;
        for (let j = 0; j < n; j++) if (j !== k) s += Math.abs(A[k][j]);
        if (d <= s) return false;
    }
    return true;
}


function _s60solveLinear(rows, n, opts) {
    const o = opts || {};
    const T0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (!n || n > 6) return { ok: false, reason: 'n>6' };
    if (!rows || !rows.length) return { ok: false, reason: 'empty' };
    const maxDen = o.exactMaxDen || 1000000000;

    // —— 阶段 A：浮点系数矩阵（供通道 1 用）——
    const Af = rows.map(r => r.slice(0, n));
    const bf = rows.map(r => r[n]);

    // —— 阶段 A': presolve 裁剪链（浮点版，纯剪枝，不动精度）——
    // presolve 的每条规则都是【严格等价变换】，用浮点做判定是安全的：
    // 只在「结构为 0」时剪枝，结构判定用绝对/相对阈值，不用近似相等。
    const preF = _s60presolveFloat(Af, bf, n, o);
    if (preF.infeasible) {
        // 浮点判定空行/不相容 ⇒ 退回精确确认（避免阈值误判造成假「无解」）
        return _s60exactConfirmOrExact(rows, n, o, T0, 'presolve-float-infeasible');
    }

    // —— 阶段 A'': Levy–Desplanques 严格对角占优 ⇒ 唯一解已定论。
    // 数学上最强的裁剪之一：省掉整场消元（仍做 O(n²) 精确验证保严格）。
    const dd = _s60diagDominantFloat(preF.act.length === n ? Af : preF.A, preF.act.length, 1e-12);
    if (dd) preF.stats.diagDominant = (preF.stats.diagDominant || 0) + 1;

    // —— 通道 1：浮点 Markowitz 稀疏序（在【裁剪后的】系统上消元，量更小）——
    const Ared = preF.act.length === n ? Af : preF.A;
    const bred = preF.act.length === n ? bf : preF.b;
    const fl = _s60floatMarkowitzSolve(
        Ared.map(r => r.slice()), bred.slice(), preF.act.length, o.u === undefined ? 0.1 : o.u);
    const T1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    if (fl.kind === 'nosol') {
        // 浮点判不相容 ⇒ 必须精确确认（严格性要求）
        return _s60exactConfirmOrExact(rows, n, o, T0, 'float-nosol', T1);
    }

    if (fl.kind === 'unique') {
        // —— 通道 2a：O(n²) 精确代入验证（对【原方程】做，证明严格）——
        let xFull = null;
        if (preF.act.length === n) {
            xFull = fl.x;
        } else {
            xFull = new Array(n).fill(0);
            for (let k = 0; k < preF.act.length; k++) xFull[preF.act[k]] = fl.x[k];
            for (let j = 0; j < n; j++) if (preF.fixed[j] != null) xFull[j] = preF.fixed[j];
        }
        const v = _s60exactVerify(Af, bf, xFull, maxDen);
        const T2 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        if (v.verified) {
            return {
                ok: true, kind: 'unique', x: v.xExact, rank: n,
                verified: 'exact-substitution', path: 'float-markowitz + exact-verify',
                floatMs: T1 - T0, verifyMs: T2 - T1, ms: T2 - T0,
                stats: preF.stats, presolveMs: null,
                det: null
            };
        }
        // 精确代入不通过（浮点解不够准 / 系统病态）⇒ 走精确消元兜底
        return _s60exactConfirmOrExact(rows, n, o, T0, 'verify-failed', T1);
    }

    // 欠定 / 奇异 ⇒ 走精确路径拿精确秩与特解
    return _s60exactConfirmOrExact(rows, n, o, T0, 'float-' + fl.kind, T1);
}


function _s60exactVerify(Af, bf, xf, maxDen) {
    const n = xf.length;
    const xR = new Array(n);
    for (let j = 0; j < n; j++) {
        const v = _s60fromNumber(xf[j], maxDen);
        if (v === null) return { verified: false };
        xR[j] = v;
    }
    for (let i = 0; i < Af.length; i++) {
        let s = _s60R0();
        for (let j = 0; j < n; j++) {
            if (Af[i][j] === 0) continue;
            const a = _s60fromNumber(Af[i][j], maxDen);
            if (a === null) return { verified: false };
            s = _s60add(s, _s60mul(a, xR[j]));
        }
        const b = _s60fromNumber(bf[i], maxDen);
        if (b === null) return { verified: false };
        if (!_s60isZero(_s60sub(s, b))) return { verified: false };
    }
    return { verified: true, xExact: xR };
}


function _s60exactConfirmOrExact(rows, n, o, T0, why, T1) {
    const maxDen = o.exactMaxDen || 1000000000;
    const RA = [], RB = [];
    for (let i = 0; i < rows.length; i++) {
        const ar = new Array(n);
        for (let j = 0; j < n; j++) {
            const v = _s60fromNumber(rows[i][j], maxDen);
            if (v === null) return { ok: false, reason: 'irrational-coef' };
            ar[j] = v;
        }
        const bv = _s60fromNumber(rows[i][n], maxDen);
        if (bv === null) return { ok: false, reason: 'irrational-rhs' };
        RA.push(ar); RB.push(bv);
    }
    const pre = _s60presolve(RA, RB, n, o);
    const ms0 = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - T0;
    if (pre.infeasible) {
        // ⚠ 这条 fail-closed 路径原先【不返回 rank 字段】（实测抓到：零行矛盾
        //   [[1,0,0|1],[0,0,0|0],[0,0,0|5]] 得到 {kind:'nosol', reason:'zeroRow'}
        //   而没有 rank），破坏输出契约 —— 同一条 nosol 结论，另一条路径
        //   （rank-inconsistent）却带 rank，调用方没法统一取值。
        //   修法：拿原矩阵 A 做一次精确消元把 rank(A) 算出来，而不是留空或猜。
        //   rhs 传全零：这样只做行阶梯化、不会误触矛盾判定，得到的正是 rank(A)。
        const rankA = _s60rankOnly(RA, n);
        return {
            ok: true, kind: 'nosol', provenEmpty: true, reason: pre.reason, rank: rankA,
            stats: pre.stats, ms: ms0, path: 'exact-presolve', why: why
        };
    }
    const fixed = pre.fixed || new Array(n).fill(null);
    const act = pre.act || [];
    const A = pre.A || [], b = pre.b || [];

    let res;
    if (!act.length) {
        res = { kind: 'unique', core: [], rank: 0 };
    } else if (!A.length) {
        res = { kind: 'family', core: new Array(act.length).fill(null), rank: 0 };
    } else {
        const r = _s60bareissExact(A, b);
        if (r.failed) return { ok: false, reason: 'bareiss-fail' };
        if (r.consistent === false) {
            // 无解时系统被消到矛盾行。rank 语义 = 【原系数矩阵 A 的秩】。
            // 换算见下方 fullRank 处的推导：rank(原A) = rank(剩余) + singletonRow 次数。
            return {
                ok: true, kind: 'nosol', provenEmpty: true, reason: 'rank-inconsistent',
                rank: r.rank + (pre.stats.singletonRow || 0),
                stats: pre.stats, ms: ms0, path: 'exact-bareiss', why: why
            };
        }
        if (r.unique) res = { kind: 'unique', core: r.x, rank: r.rank, det: r.det };
        else {
            // 秩亏 ⇒ 解集是仿射子空间。除了特解，还要把零空间基带出来，
            // 让调用方能【解析地】沿解流形采样出多个族解（而非靠随机撒点碰运气）。
            const core = _s60particular(A, b, act.length);
            const ns = _s60nullspace(A, act.length);
            res = {
                kind: 'family', core: core, rank: r.rank,
                nullspace: ns ? ns.basis : null,
                freeCols: ns ? ns.freeCols : null
            };
        }
    }

    const x = new Array(n).fill(null);
    for (let k = 0; k < act.length; k++) x[act[k]] = res.core[k];
    for (let j = 0; j < n; j++) {
        if (x[j] === null) x[j] = fixed[j] != null ? fixed[j] : _s60R0();
    }
    // rank 语义 = 【原系数矩阵 A 的秩】。换算公式（推导经过两轮返工，见下）：
    //
    //   rank(原A) = rank(presolve 后的剩余系统) + stats.singletonRow
    //
    // 推导：singletonRow 消元取一个「只有一个非零元」的 pivot 行 i、列 t，
    //   把列 t 从【所有其他行】里消成 0，然后同时删掉行 i 与列 t。
    //   于是变换后的矩阵形如 [[pivot, *…], [0, A′]]，pivot ≠ 0
    //   ⇒ 秩 = 1 + rank(A′)。即【每做一次 singletonRow，秩恰好降 1】。
    //   其余三种裁剪都不改变秩：
    //     zeroRow  — 删的是零行，不贡献秩；
    //     dupRow   — 删的是成比例重复行，与被保留的那行线性相关；
    //     zeroCol  — 删的是零列，零列本就不在列空间里。
    //
    // ⚠ 这里连着两个错误的修正，都已删除，记录下来防止重犯：
    //   ① 曾写 `fullRank = res.rank + nFixed`，nFixed = presolve 固定的变量个数。
    //      错在把「消元固定了变量」当成了「秩会增加 1」。实测反例：underdet6 是 4×6
    //      矩阵（第 6 列整列为 0），rank(4×6)=4，加 nFixed=1 后内核报 rank=5 ——
    //      而 4×6 矩阵的秩上限是 min(4,6)=4，报 5 数学上不可能。
    //   ② 修成 `fullRank = res.rank`（假定秩不变）也是错的。实测反例：presolve-heavy6
    //      真相 rank=4，presolve 后只剩 1 行 1 秩（singletonRow=3）—— 秩明明降了。
    //   教训：「消元固定了变量」⇒ 自由度 = 变量数 − 秩，但【秩本身要单独算】。
    //     两次都是凭直觉猜修正、没做推导，第一次甚至靠"数学上不可能"才抓到。
    //   独立核验手段：test/benchmarks/linear_arbiter.mjs（BigInt 精确 RREF + 4 项自检）。
    const fullRank = (res.rank || 0) + (pre.stats.singletonRow || 0);

    const T2 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    // 零空间基是在 presolve 后的【活动列空间】（长度 act.length）算的，要映射回原 n 维：
    //   活动列位置 act[k] ← 基向量第 k 分量
    //   非活动位置         ← 0
    // 非活动位置取 0 是【数学上必须的】：被 presolve 裁掉的列不是「丢了自由度」，
    // 而是被空列（恒 0）或单例行（精确值）钉死了 —— 基向量在那些坐标上必须恒 0，
    // 否则 x = x_p + t·v 就不再满足原方程组。
    let nsFull = null;
    if (res.nullspace && res.nullspace.length) {
        nsFull = res.nullspace.map(function (v) {
            const full = new Array(n).fill(_s60R0());
            for (let k = 0; k < act.length; k++) full[act[k]] = v[k];
            return full;
        });
    }

    return {
        ok: true, kind: res.kind, x: x, rank: fullRank, rankAfterPresolve: res.rank, det: res.det,
        nullspace: nsFull, freeCols: res.freeCols || null,
        stats: pre.stats, presolveMs: ms0, ms: T2 - T0,
        path: 'exact-bareiss', why: why, exactUnique: !!pre.exactUnique
    };
}


// 只算 rank(A)（不带 rhs 语义）。给 infeasible 路径补 rank 字段用。
// rhs 传全零 ⇒ _s60bareissExact 只做行阶梯化、不会判矛盾，返回的 rank 就是 rank(A)。
// 失败（分母爆掉等）时返回 null —— 调用方据此知道「秩未证明」，而不是拿一个假值糊过去。
function _s60rankOnly(A, n) {
    if (!A.length || !n) return 0;
    const zero = new Array(A.length).fill(_s60R0());
    const r = _s60bareissExact(A.map(row => row.slice()), zero);
    return r.failed ? null : r.rank;
}


function _s60lstsq(A0, b0, n) {
    const m = A0.length;
    if (m < n) return null;
    const M = A0.map(r => r.slice());
    const v = b0.slice();
    const w = new Array(m);
    for (let k = 0; k < n; k++) {
        let nr = 0;
        for (let i = k; i < m; i++) nr += M[i][k] * M[i][k];
        nr = Math.sqrt(nr);
        if (nr < 1e-300) continue;
        const alpha = (M[k][k] > 0 ? -nr : nr);
        for (let i = k; i < m; i++) w[i] = M[i][k];
        w[k] -= alpha;
        let nw = 0;
        for (let i = k; i < m; i++) nw += w[i] * w[i];
        if (nw < 1e-300) continue;
        for (let j = k; j < n; j++) {
            let s = 0;
            for (let i = k; i < m; i++) s += w[i] * M[i][j];
            s /= nw;
            for (let i = k; i < m; i++) M[i][j] -= 2 * s * w[i];
        }
        let s = 0;
        for (let i = k; i < m; i++) s += w[i] * v[i];
        s /= nw;
        for (let i = k; i < m; i++) v[i] -= 2 * s * w[i];
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
        let s = v[i];
        for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
        x[i] = Math.abs(M[i][i]) < 1e-300 ? 0 : s / M[i][i];
    }
    return x;
}


function _s60floatMarkowitzSolve(A0, b0, n, u) {
    const m = A0.length;
    const M = A0.map((r, i) => r.slice().concat([b0[i]]));
    const rowMap = []; for (let i = 0; i < m; i++) rowMap.push(i);
    const colMap = []; for (let j = 0; j < n; j++) colMap.push(j);
    let rank = 0;
    for (let k = 0; k < n; k++) {
        if (rank >= m) break;
        const p = _s60markowitz(M, k, m, n, u === undefined ? 0.1 : u);
        if (!p) break;
        const [ri, cj] = p;
        if (cj !== k) {
            for (let i = 0; i < m; i++) { const t = M[i][k]; M[i][k] = M[i][cj]; M[i][cj] = t; }
            const t = colMap[k]; colMap[k] = colMap[cj]; colMap[cj] = t;
        }
        if (ri !== rank) { const t = M[ri]; M[ri] = M[rank]; M[rank] = t; const t2 = rowMap[ri]; rowMap[ri] = rowMap[rank]; rowMap[rank] = t2; }
        const pv = M[rank][k];
        if (Math.abs(pv) < 1e-300) break;
        for (let i = rank + 1; i < m; i++) {
            if (M[i][k] === 0) continue;
            const f = M[i][k] / pv;
            M[i][k] = 0;
            for (let j = k + 1; j <= n; j++) M[i][j] -= f * M[rank][j];
        }
        rank++;
    }
    for (let i = rank; i < m; i++) {
        let z = true;
        for (let j = 0; j < n; j++) if (M[i][j] !== 0) { z = false; break; }
        if (z && Math.abs(M[i][n]) > 1e-9) return { kind: 'nosol', rank: rank };
    }
    if (rank < n) return { kind: 'family', rank: rank };
    const x = new Array(n).fill(0);
    for (let r = rank - 1; r >= 0; r--) {
        let s = M[r][n];
        for (let j = r + 1; j < n; j++) s -= M[r][j] * x[colMap[j]];
        const d = M[r][r];
        if (Math.abs(d) < 1e-300) return { kind: 'singular', rank: rank };
        x[colMap[r]] = s / d;
    }
    return { kind: 'unique', x: x, rank: rank };
}

// 故意改动
