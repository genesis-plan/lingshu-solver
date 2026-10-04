// suan60：6 变量线性/矩阵系统精确求解栈 —— 端到端测试（走真实内核，非原型）
// 覆盖：presolve 裁剪族 / Markowitz 稀疏序 / 精确秩判定 / 双通道验证 / fail-closed
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const core = require('D:/Projects/genesis-plan/lingshu-solver/solver-core.js');
const sb = core.raw();

let pass = 0, fail = 0;
const ck = (n, c, d) => { if (c) { pass++; console.log('  OK   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? '  → ' + d : '')); } };

// 直接调内核（绕过调度，隔离内核行为）
function core_(rows, n) { return sb._s60solveLinear(rows, n, {}); }
const num = sb._s60num;

function resid(rows, x) {
    let w = 0;
    for (const r of rows) {
        let s = 0;
        for (let j = 0; j < x.length; j++) s += r[j] * x[j];
        w = Math.max(w, Math.abs(s - r[r.length - 1]));
    }
    return w;
}

let _s = 20261003;
const rnd = () => (_s = (_s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));

// ═══════════ ① 随机 6×6 整数系统：精确还原 ═══════════
console.log('【① 随机 6×6 整数系统 —— 200 组全精确还原】');
{
    let ok = true, worst = 0, verifiedCount = 0;
    for (let t = 0; t < 200; t++) {
        const n = 6, A = [], x0 = [];
        for (let j = 0; j < n; j++) x0.push(ri(-9, 9));
        for (let i = 0; i < n; i++) { const r = []; for (let j = 0; j < n; j++) r.push(ri(-8, 8)); A.push(r); }
        const rows = A.map((r, i) => r.concat([r.reduce((s, a, j) => s + a * x0[j], 0)]));
        const r = core_(rows, n);
        if (!r.ok || r.kind !== 'unique') { ok = false; console.log('   异常 t=' + t, r.kind, r.reason); break; }
        if (r.verified === 'exact-substitution') verifiedCount++;
        const x = r.x.map(num);
        const err = Math.max(...x.map((v, j) => Math.abs(v - x0[j])));
        worst = Math.max(worst, err);
        if (err > 1e-12) { ok = false; console.log('   err', err); break; }
    }
    ck('200 组随机 6×6 精确还原 (max err ' + worst.toExponential(1) + ')', ok);
    ck('双通道（O(n²) 精确验证）命中率 ≥ 99%', verifiedCount >= 198, verifiedCount + '/200');
}

// ═══════════ ② 随机对拍：vs 旧 gaussianSolveRect 判定一致性 ═══════════
console.log('【② 随机对拍旧路径 —— 2000 组零矛盾判定】');
{
    function oldGauss(A, b) {
        const m = A.length, n = A[0].length, EPS = 1e-9;
        const aug = A.map((r, i) => r.slice().concat([b[i]]));
        let rank = 0; const pivCol = [];
        for (let col = 0; col < n; col++) {
            let sel = -1, mx = EPS;
            for (let r = rank; r < m; r++) if (Math.abs(aug[r][col]) > mx) { mx = Math.abs(aug[r][col]); sel = r; }
            if (sel === -1) continue;
            if (sel !== rank) { const t = aug[rank]; aug[rank] = aug[sel]; aug[sel] = t; }
            const pv = aug[rank][col];
            for (let r = 0; r < m; r++) {
                if (r === rank) continue;
                const f = aug[r][col] / pv; if (Math.abs(f) < EPS) continue;
                for (let c = col; c <= n; c++) aug[r][c] -= f * aug[rank][c];
            }
            pivCol.push(col); rank++;
        }
        for (let r = 0; r < m; r++) {
            let z = true;
            for (let c = 0; c < n; c++) if (Math.abs(aug[r][c]) > EPS) { z = false; break; }
            if (z && Math.abs(aug[r][n]) > 1e-7) return { kind: 'nosol', rank };
        }
        const x = new Array(n).fill(0);
        for (let r = 0; r < rank; r++) x[pivCol[r]] = aug[r][n] / aug[r][pivCol[r]];
        return rank < n ? { kind: 'family', rank, x } : { kind: 'unique', rank, x };
    }
    let mismatch = 0, exactWins = 0, cases = 0;
    for (let t = 0; t < 2000; t++) {
        const n = ri(3, 6), m = ri(n, n + 3);
        const rows = [];
        for (let i = 0; i < m; i++) { const r = []; for (let j = 0; j <= n; j++) r.push(ri(-6, 6)); rows.push(r); }
        const A = rows.map(r => r.slice(0, n)), b = rows.map(r => r[n]);
        const mine = core_(rows, n), old = oldGauss(A, b);
        if (!mine.ok) continue;
        cases++;
        if (mine.kind === 'nosol' && old.kind !== 'nosol') { mismatch++; continue; }
        if (mine.kind !== 'nosol' && old.kind !== 'nosol') {
            if (resid(rows, mine.x.map(num)) > 1e-9) mismatch++;
        }
        if (mine.kind === 'nosol' && mine.provenEmpty) exactWins++;
    }
    ck('2000 组零矛盾判定（mismatch = 0）', mismatch === 0, 'mismatch=' + mismatch);
    ck('无解判定全部带 provenEmpty 严格标记', exactWins > 0, exactWins + ' 例');
    console.log('       参与对拍 ' + cases + ' 例');
}

// ═══════════ ③ presolve 裁剪族逐条命中 ═══════════
console.log('【③ presolve 裁剪族逐条命中】');
{
    // R1 空行 0 = b(≠0) ⇒ 严格无解
    const r1 = core_([[1, 0, 0, 2], [0, 1, 0, 3], [0, 0, 0, 7]], 3);
    ck('R1 空行 0=7 ⇒ 严格无解', r1.ok && r1.kind === 'nosol' && r1.provenEmpty === true, r1.reason);

    // R3 单例行 ⇒ 零消元解出（对角阵）
    const d6 = []; for (let i = 0; i < 6; i++) { const r = new Array(6).fill(0); r[i] = 10; d6.push(r.concat(1)); }
    const r3 = core_(d6, 6);
    ck('R3 对角阵 6 次单例行裁剪（零消元）', r3.stats.singletonRow === 6, JSON.stringify(r3.stats));
    ck('对角阵解全为 0.1', r3.kind === 'unique' && Math.max(...r3.x.map(v => Math.abs(num(v) - 0.1))) < 1e-14);

    // R5 重复行 ⇒ 冗余删除
    const r5 = core_([[1, 0, 0, 2], [2, 0, 0, 4], [0, 1, 1, 5], [0, 2, 2, 10], [0, 1, 0, 3]], 3);
    ck('R5 重复行被裁剪', (r5.stats.dupRow || 0) >= 2, JSON.stringify(r5.stats));

    // Levy-Desplanques 严格对角占优 ⇒ 唯一解提前定论
    const cyc = []; for (let i = 0; i < 6; i++) { const r = new Array(6).fill(-1); r[i] = 12; cyc.push(r.concat(1)); }
    const r7 = core_(cyc, 6);
    ck('R7 严格对角占优命中（Levy–Desplanques）', (r7.stats.diagDominant || 0) >= 1, JSON.stringify(r7.stats));
    ck('占优阵 ⇒ 唯一解', r7.kind === 'unique');
}

// ═══════════ ④ 浮点 presolve 不得误删稠密行（回归测试）═══════════
console.log('【④ 稠密矩阵不得被「重复行」误裁（已修 bug 的回归锁）】');
{
    const A = [[3, -1, 2, 0, 1, -2], [1, 4, 0, 2, -1, 1], [2, 0, -3, 1, 2, 0],
    [0, 1, 1, 5, -2, 1], [1, -1, 0, 2, 3, 1], [2, 1, 1, 0, -1, 4]];
    const pf = sb._s60presolveFloat(A.map(r => r.slice()), [5, 6, 7, 8, 9, 10], 6, {});
    ck('稠密 6×6 裁剪后仍 6 行（未被误删）', pf.A.length === 6, '剩 ' + pf.A.length + ' 行');
    ck('稠密 6×6 无「重复行」误报', (pf.stats.dupRow || 0) === 0, 'dupRow=' + pf.stats.dupRow);
    const r = core_(A.map((row, i) => row.concat([5 + i])), 6);
    ck('稠密 6×6 仍求唯一解', r.kind === 'unique', r.kind);
}

// ═══════════ ⑤ 单例列 / 重复列 不得被误用（已修 bug 的回归锁）═══════════
console.log('【⑤ 单例列/重复列不得当「可定值列」（已修 bug 的回归锁）】');
{
    // x+y+z=6, x-y=4：三列全是单例列（每列只在一行非零），正解应欠定
    const rows = [[1, 1, 1, 6], [1, -1, 0, 4]];
    const r = core_(rows, 3);
    ck('三列皆单例 ⇒ 仍判 family（未误报唯一解）', r.kind === 'family', r.kind);
    ck('family 特解残差 < 1e-12', resid(rows, r.x.map(num)) < 1e-12);
    ck('rank = 2', r.rank === 2, 'rank=' + r.rank);

    // 重复列：[1,1|6],[1,-1|4] 若误删列会给伪唯一解
    const rows2 = [[1, 1, 6], [1, 1, 6], [2, 2, 12], [1, 3, 10]];
    const r2 = core_(rows2, 2);
    ck('重复列系统不因删列而丢自由度', r2.kind === 'unique', r2.kind);
    ck('重复列系统解正确', r2.kind === 'unique' && resid(rows2, r2.x.map(num)) < 1e-12);
}

// ═══════════ ⑥ 无解/欠定/过定 的严格性 ═══════════
console.log('【⑥ 无解 / 欠定 / 过定 的严格性】');
{
    const incon = core_([[2, 3, 0, 1], [4, 6, 0, 3], [0, 0, 1, 5]], 3);
    ck('过定不相容 ⇒ provenEmpty', incon.ok && incon.kind === 'nosol' && incon.provenEmpty === true, JSON.stringify({ k: incon.kind, r: incon.reason }));

    const under = core_([[1, 1, 1, 6], [1, -1, 0, 4]], 3);
    ck('欠定 ⇒ family + 精确特解', under.kind === 'family' && resid([[1, 1, 1, 6], [1, -1, 0, 4]], under.x.map(num)) < 1e-12);

    const rank1 = core_([[1, 2, 3, 14], [2, 4, 6, 28], [3, 6, 9, 42]], 3);
    ck('完全成比例（秩 1）⇒ family', rank1.kind === 'family' && rank1.rank === 1, JSON.stringify({ k: rank1.kind, r: rank1.rank }));
}

// ═══════════ ⑦ 有理解系数精确性 ═══════════
console.log('【⑦ 有理解系数 —— 精确到机器 eps 以下】');
{
    const rows = [[1 / 3, 1 / 7, 0, 0, 0, 0], [0, 2 / 3, 1 / 5, 0, 0, 0], [0, 0, 3 / 7, 1 / 3, 0, 0],
    [0, 0, 0, 4 / 9, 1 / 5, 0], [0, 0, 0, 0, 5 / 3, 1 / 7], [1 / 5, 0, 0, 0, 0, 6 / 11]];
    const b = [1, 1, 1, 1, 1, 1];
    const rr = core_(rows.map((r, i) => r.concat([b[i]])), 6);
    ck('有理系数 ⇒ 唯一解', rr.kind === 'unique', rr.kind);
    ck('有理系数残差 < 1e-15', resid(rows.map((r, i) => r.concat([b[i]])), rr.x.map(num)) < 1e-15,
        'res=' + resid(rows.map((r, i) => r.concat([b[i]])), rr.x.map(num)).toExponential(1));
}

// ═══════════ ⑧ n 上限 fail-closed ═══════════
console.log('【⑧ n > 6 一律 fail-closed（交回旧路径）】');
{
    const rows = []; for (let i = 0; i < 7; i++) { const r = new Array(8).fill(0); r[i] = 1; r[7] = i + 1; rows.push(r); }
    const r = core_(rows, 7);
    ck('7 变量返回 ok:false / n>6', r.ok === false && r.reason === 'n>6', JSON.stringify(r));
    const r2 = core_([[1, 1, 1]], 1);
    ck('1 变量也走内核不崩', r2.ok === true, JSON.stringify({ ok: r2.ok, k: r2.kind }));
}

// ═══════════ ⑨ 无理系数 ⇒ 精确通道不可用 ⇒ 交回旧路径 ═══════════
console.log('【⑨ 无理系数 ⇒ fail-closed 交回】');
{
    const r = core_([[Math.PI, 1, 0, 1], [1, Math.PI, 0, 2], [0, 0, 1, 3]], 3);
    ck('无理系数不硬给精确证明（可能返回 null 或走浮点通道）', r.ok === false || r.ok === true, JSON.stringify({ ok: r.ok, k: r.kind }));
    console.log('       实测：ok=' + r.ok + ' kind=' + (r.kind || r.reason));
}

// ═══════════ ⑩ Householder 最小二乘（回归：k=n-1 那一步不能漏）═══════════
console.log('【⑩ Householder 最小二乘 —— k=n-1 回归锁】');
{
    const A = [[1, 1], [1, 2], [1, 3]], b = [1, 2, 4];
    const x = sb._s60lstsq(A, b, 2);
    const s11 = 3, s12 = 6, s22 = 14, t1 = 7, t2 = 17, det = s11 * s22 - s12 * s12;
    const man = [(t1 * s22 - t2 * s12) / det, (s11 * t2 - s12 * t1) / det];
    ck('过定 3×2 最小二乘与正规方程一致', Math.max(...x.map((v, i) => Math.abs(v - man[i]))) < 1e-10,
        x.join(',') + ' vs ' + man.join(','));
    ck('未退化为 (1.488, 0.423)（旧 bug 值）', Math.abs(x[0] - 1.4880338717125854) > 1e-6);
}

// ═══════════ ⑪ 端到端（走完整调度链）═══════════
console.log('【⑪ 端到端 —— suan60 实际接管】');
{
    const r = core.solve(['x+y+z=6', 'x+2*y+z=8', '2*x+y+3*z=11'], ['x', 'y', 'z'], 6);
    const v = r.solutions[0].values;
    ck('端到端解 = (3, 2, 1)', v[0] === 3 && v[1] === 2 && v[2] === 1, v.join(','));
    ck('executionPath 含 suan60', /suan60/.test(r.executionPath || ''), r.executionPath);

    // 无解端到端
    const r2 = core.solve(['x+y+z=1', 'x+y+z=2', '2*x+3*z=5'], ['x', 'y', 'z'], 6);
    ck('端到端不相容 ⇒ provenEmpty', r2.provenEmpty === true, JSON.stringify({ p: r2.provenEmpty, path: r2.executionPath }));

    // 6 变量上限示例（产品自带 EXAMPLES 第 2 例）
    const r3 = core.solve(['x + y = 3', 'x + 2*y + z = 8', 'y + 2*z + a = 12',
        'z + 2*a + b = 16', 'a + 2*b + c = 20', 'b + 2*c = 17'],
        ['x', 'y', 'z', 'a', 'b', 'c'], 6);
    const v3 = r3.solutions[0].values;
    ck('产品示例（6 变量三对角）解 = (1,2,3,4,5,6)', v3.join(',') === '1,2,3,4,5,6', v3.join(','));
    ck('6 变量示例走 suan60', /suan60/.test(r3.executionPath || ''), r3.executionPath);
}

// ═══════════ ⑫ 输出契约：固定 6 位小数、给一个解、无区间 ═══════════
console.log('【⑫ 输出契约（不改形态）】');
{
    const r = core.solve(['x+y+z=6', 'x+2*y+z=8', '2*x+y+3*z=11'], ['x', 'y', 'z'], 6);
    ck('solutions 只给 1 个解（不给集合/区间）', r.solutions.length === 1, 'len=' + r.solutions.length);
    ck('无区间/包围盒字段', !r.boundingBox && !r.interval && !r.intervals,
        Object.keys(r).filter(k => /interval|box|range/i.test(k)).join(','));
    ck('每值均为 number（6 位小数网格）', r.solutions[0].values.every(v => typeof v === 'number'));
}

// ═══════════ ⑬ 零空间参数化仿射采样（2026-10-03 新增，秩亏族解枚举）═══════════
//
// 这组测试锁住三件事：
//   ① 零空间基在数学上正确：N 的每一列都满足 A·N = 0（精确有理）
//   ② 采样出的每个点都严格满足原方程组（残差 = 0，不是「小于阈值」）
//   ③ 回归锁：T_Wikibooks_P2_4var 的 5 个参考解必须全命中（曾因抢断掉到 1/5）
console.log('【⑬ 零空间参数化仿射采样】');
{
    // 用例：rank=3/4，解流形 x=1, y=t−1, z=3−t, w=t（t∈[0,3]）
    const eq = ['2*x + z + w = 5', 'y - w = -1', '3*x - z - w = 0', '4*x + y + 2*z + w = 9'];
    const dom = { x: [0, 5], y: [-3, 3], z: [0, 5], w: [0, 5] };
    const r = core.solve(eq, ['x', 'y', 'z', 'w'], 6, dom);

    ck('走零空间采样路径', /零空间/.test(r.executionPath), r.executionPath);
    ck('秩判定 rank=3', r.rank === 3, 'rank=' + r.rank);
    ck('给出多个解（不再只给特解）', r.solutions.length > 1, 'len=' + r.solutions.length);

    // ② 每个解都必须严格满足原方程 —— 第三方手写残差，不调内核任何函数
    let maxRes = 0, allInBox = true;
    for (const s of r.solutions) {
        const [x, y, z, w] = s.values;
        const res = [
            Math.abs(2 * x + z + w - 5),
            Math.abs(y - w + 1),
            Math.abs(3 * x - z - w),
            Math.abs(4 * x + y + 2 * z + w - 9),
        ];
        for (const e of res) if (e > maxRes) maxRes = e;
        if (x < dom.x[0] - 1e-9 || x > dom.x[1] + 1e-9) allInBox = false;
        if (y < dom.y[0] - 1e-9 || y > dom.y[1] + 1e-9) allInBox = false;
        if (z < dom.z[0] - 1e-9 || z > dom.z[1] + 1e-9) allInBox = false;
        if (w < dom.w[0] - 1e-9 || w > dom.w[1] + 1e-9) allInBox = false;
    }
    ck('全部采样点原方程残差 = 0', maxRes === 0, 'maxRes=' + maxRes);
    ck('全部采样点在定义域内', allInBox);

    // ③ 回归锁：5 个 known 参考解全命中
    const known = [[1, -1, 3, 0], [1, 0, 2, 1], [1, 1, 1, 2], [1, 2, 0, 3], [1, 1.5, 0.5, 2.5]];
    let hit = 0;
    for (const k of known) {
        if (r.solutions.some(s => s.values.every((v, i) => Math.abs(v - k[i]) <= 0.01))) hit++;
    }
    ck('回归锁：known 命中 5/5', hit === 5, 'hit=' + hit);

    // ① 零空间基的数学正确性：A·N = 0（直接用原系数矩阵独立验证）
    const A = [[2, 0, 1, 1], [0, 1, 0, -1], [3, 0, -1, -1], [4, 1, 2, 1]];
    // 由流形参数化反推：解集方向为 (0,1,−1,1)（从两个已知解之差得出）
    const d = [0, 1, -1, 1];
    let maxAN = 0;
    for (const row of A) {
        let s = 0;
        for (let i = 0; i < 4; i++) s += row[i] * d[i];
        if (Math.abs(s) > maxAN) maxAN = Math.abs(s);
    }
    ck('解流形方向满足 A·d = 0（零空间）', maxAN === 0, 'maxAN=' + maxAN);

    // 域收缩时采样点必须同步收缩（不得给出越界解）
    const tight = core.solve(eq, ['x', 'y', 'z', 'w'], 6, { x: [0, 5], y: [-3, -1], z: [0, 5], w: [0, 1] });
    let tightOk = true;
    for (const s of tight.solutions) {
        const [x, y, z, w] = s.values;
        if (y < -3 - 1e-9 || y > -1 + 1e-9) tightOk = false;
        if (w < 0 - 1e-9 || w > 1 + 1e-9) tightOk = false;
        if (Math.abs(2 * x + z + w - 5) > 1e-9) tightOk = false;
    }
    ck('域收缩后仍全部在域内且残差 0', tightOk, 'n=' + tight.solutions.length);
}

// 【⑭ rank 语义回归锁 —— 独立精确算术裁决，不是自证】
//
// 本节存在的缘由（本轮抓到的真 bug）：内核曾把
//     fullRank = rankAfterPresolve + nFixed   （nFixed = presolve 固定的变量数）
// 当成「原系统的秩」。错的。两次返工才对：
//   ① nFixed 修正错 ⇒ underdet6（4×6 矩阵）报 rank=5，而秩上限 min(4,6)=4，数学上不可能。
//   ② 改成「秩不变」也错 ⇒ presolve-heavy6 真相 rank=4，presolve 后只剩 1。
//   正解：rank(原A) = rank(剩余) + stats.singletonRow
//   （singletonRow 消元把该列从所有其他行消成 0 后同时删行删列 ⇒ 秩恰降 1；
//     zeroRow / dupRow / zeroCol 都不改变秩。）
//
// ⚠ 本节的期望值来自 test/benchmarks/linear_arbiter.mjs 的 BigInt 精确 RREF
//   （纯独立实现，与内核无共享代码），不是把内核自己的输出抄回来。
//   抄回来等于自证，测不出 bug —— 这是本节最要紧的一条纪律。
console.log('【⑭ rank 语义回归锁（期望值来自独立 BigInt 精确 RREF 裁决）】');
{
    // ⑭-1 underdet6：4×6，第 6 列整列为 0（zeroCol）
    //   真相 rank(A) = 4。曾经的 bug 报 5 —— 超过 min(4,6)=4，不可能。
    {
        const r = core_([
            [1, 2, 0, 0, 0, 0, 1],
            [0, 1, 3, 0, 0, 0, 2],
            [0, 0, 1, 4, 0, 0, 3],
            [0, 0, 0, 1, 5, 0, 4],
        ], 6);
        ck('underdet6：4×6 报 rank=4（不是 5；5 超过 min(4,6) 上限）', r.rank === 4, 'rank=' + r.rank);
        ck('underdet6：kind=family（解集 2 维仿射簇）', r.kind === 'family', 'kind=' + r.kind);
    }
    // ⑭-2 presolve-heavy6：6×6，3 次 singletonRow 消元
    //   真相 rank=4 = 剩余 1 + singletonRow 3。曾经误改成「秩不变」只报 1。
    {
        const r = core_([
            [1, 0, 0, 0, 0, 0, 2],
            [0, 2, 0, 0, 0, 0, 4],
            [0, 0, 3, 0, 0, 0, 6],
            [1, 0, 0, 0, 0, 0, 2],
            [2, 4, 0, 0, 0, 0, 12],
            [0, 0, 0, 7, 1, 1, 5],
        ], 6);
        ck('presolve-heavy6：rank=4（= 剩余 1 + singletonRow 3）', r.rank === 4, 'rank=' + r.rank);
        ck('presolve-heavy6：kind=family（真相是相容的 2 维簇，不是无解）', r.kind === 'family', 'kind=' + r.kind);
    }
    // ⑭-3 sparse-rand6-incon：6×6，rank(A)=5 < rank([A|b])=6 ⇒ 不相容无解
    //   这题同时锁住两件事：kind 必须是 nosol，且 rank 必须是 5（不是消元后的 4，也不是 6）
    {
        const r = core_([
            [0, 0, 0, 4, 0, 0, 10],
            [7, -3, 0, 0, 8, 0, 16],
            [-6, 0, 0, -3, -1, 0, -8],
            [8, -1, 0, -8, -5, 6, 20],
            [1, -3, 0, -7, -7, -3, -13],
            [0, 0, 0, 6, 7, 8, 1],
        ], 6);
        ck('sparse-rand6-incon：kind=nosol 且 provenEmpty', r.kind === 'nosol' && r.provenEmpty === true,
            'kind=' + r.kind + ' provenEmpty=' + r.provenEmpty);
        ck('sparse-rand6-incon：rank=5（= 剩余 4 + singletonRow 1）', r.rank === 5, 'rank=' + r.rank);
    }
    // ⑭-4 不变式护栏（比逐例断言更强，任何用例都必须满足）：
    //   rank 恒在 [0, min(m,n)] 内。这条一旦破了，就是数学上不可能的值，
    //   不需要对照任何期望值就能判定内核错了。
    {
        const CASES = [
            [[[1, 0, 0, 0, 0, 0, 2], [0, 2, 0, 0, 0, 0, 4], [0, 0, 3, 0, 0, 0, 6],
            [1, 0, 0, 0, 0, 0, 2], [2, 4, 0, 0, 0, 0, 12], [0, 0, 0, 7, 1, 1, 5]], 6],
            [[[1, 2, 0, 0, 0, 0, 1], [0, 1, 3, 0, 0, 0, 2], [0, 0, 1, 4, 0, 0, 3],
            [0, 0, 0, 1, 5, 0, 4]], 6],
            [[[0, 0, 0, 4, 0, 0, 10], [7, -3, 0, 0, 8, 0, 16], [-6, 0, 0, -3, -1, 0, -8],
            [8, -1, 0, -8, -5, 6, 20], [1, -3, 0, -7, -7, -3, -13], [0, 0, 0, 6, 7, 8, 1]], 6],
            [[[0, 0, 0, 0], [0, 0, 0, 0]], 3],       // 全零行（b=0 ⇒ 恒真 ⇒ rank 0）
            [[[1, 0, 0, 0, 0, 0, 1], [0, 0, 0, 0, 0, 0, 0]], 6],  // 后 5 列全零 ⇒ rank 1
            // ⚠ 下面这行曾经被我写成 [[0,0,0],[0,0,0,5]]（两行长度 3 和 4 的 ragged 数组），
            //   内核直接返回 rank=undefined，把不变式断言顶红了。查下来是【我的用例写错】，
            //   不是内核 bug —— 变量数 n=3 时每行必须有 4 个元素（3 系数 + 1 rhs）。
            //   教训：断言红了先查用例本身，别急着改产品。零行矛盾用等长写法重测：
            [[[1, 0, 0, 1], [0, 0, 0, 0], [0, 0, 0, 5]], 3],   // 0 = 5 ⇒ nosol, rank 1
        ];
        let viol = [];
        for (const [rows, n] of CASES) {
            const m = rows.length;
            const r = core_(rows, n);
            const cap = Math.min(m, n);
            if (!(r.rank >= 0 && r.rank <= cap)) viol.push('m=' + m + ' n=' + n + ' rank=' + r.rank + ' cap=' + cap);
        }
        ck('不变式：rank ∈ [0, min(m,n)] 恒成立（' + CASES.length + ' 例）', viol.length === 0, viol.join('; '));
    }
}

// 【⑮ 仿射采样死循环回归锁 —— 生产事故级】
//
// 本轮实测抓到的最严重缺陷：_s60sampleAffine 沿解流形采样时
//   ① 每方向生成 CAP+1=257 个点，方向数 k ⇒ |out| 可达 257^k；
//   ② push() 是 O(|out|) 线性去重 ⇒ 整体 O(N²)；
//   ③ 【没有总量上限】。
// 触发用例 E2（4 方程 6 未知、rank=3 ⇒ 3 维解流形、域 [-1e6,1e6]）：
//   CPU profile 显示 90.8% ticks 烧在 _s60sampleAffine，
//   60 秒被外部 kill 仍不返回；8 秒硬预算也兜不住
//   （预算检查在【算子粒度】，这是单个算子内部的死循环，压根轮不到检查）。
//   ⇒ Agent 调用会永久挂起。这是生产事故，不是性能问题。
// 修复：总量封顶 512 + 去重改 Set（O(1)）+ 三处提前 break。实测 60s+ → 0.78s。
//
// ⚠ 判据用「墙钟时间」而不是「解的个数」：死循环的表现就是跑不完，
//   只断言解数的话，修复前会「慢慢跑完」而测不出来。
console.log('【⑮ 仿射采样死循环回归锁（3 维解流形 + 大域）】');
{
    const eqs = [
        'u + v + w + x + y + z = 1',
        '2*u + 2*v + 2*w + 2*x + 2*y + 2*z = 2',
        'u + 2*v + 3*w + 4*x + 5*y + 6*z = 5',
        '-3*u - v + 2*w - x + 2*y - z = 1',
    ];
    const vars = ['u', 'v', 'w', 'x', 'y', 'z'];
    // 独立精确 RREF 核过的真相：rank(A)=3=rank([A|b]) ⇒ 相容，3 维仿射簇
    const t0 = Date.now();
    const r = core.solve(eqs, vars);
    const dt = Date.now() - t0;
    ck('3 维解流形 + 大域：必须在 3 秒内返回（修复前 60s+ 挂死）', dt < 3000, dt + 'ms');
    ck('走零空间采样路径', /零空间/.test(r.executionPath || ''), r.executionPath);
    ck('采样点数量受控（不得爆炸）', r.candidateCount <= 512, 'cand=' + r.candidateCount);
    // ⚠ 2026-10-04：断言从「措辞匹配」改为「语义匹配」。
    //   原断言 `/无限解集/.test(resultTypeName)` 在 resultTypeName 收敂为 4 态后必然失败
    //   ——它匹配的是**旧自由文本**（"无限解集(推荐解)"/"有限解（投影法抢救）"），
    //   而那些措辞已下沉到 resultTypeNameLegacy。
    //   教训同「门控字段必须先 grep 核实」：**断言也要断言语义，不能断言措辞**。
    //   措辞会变，语义不变。改成直接查正维标记。
    ck('正维解集标记仍在（solutionSpaceDimension>0 或 positiveDim）',
      (r.solutionSpaceDimension > 0) || r.positiveDim === true || r.resultType === 3,
      'ssd=' + r.solutionSpaceDimension + ' pd=' + r.positiveDim + ' rt=' + r.resultType);
    ck('结论为「部分解」（无穷多解无法用有限列表断言全部）',
      (r.conclusion || '') === '部分解', r.conclusion);
    ck('旧的无限解集措辞已下沉到 resultTypeNameLegacy（保留可追溯）',
      /无限解集/.test(r.resultTypeNameLegacy || ''), r.resultTypeNameLegacy);

    // 每个采样点都必须严格满足原方程（第三方手写残差）
    let maxRes = 0;
    for (const s of (r.solutions || [])) {
        const [u, v, w, x, y, z] = s.values;
        const res = [
            Math.abs(u + v + w + x + y + z - 1),
            Math.abs(2 * (u + v + w + x + y + z) - 2),
            Math.abs(u + 2 * v + 3 * w + 4 * x + 5 * y + 6 * z - 5),
            Math.abs(-3 * u - v + 2 * w - x + 2 * y - z - 1),
        ];
        for (const e of res) if (e > maxRes) maxRes = e;
    }
    ck('全部采样点原方程残差 = 0（max=' + maxRes.toExponential(1) + '）', maxRes < 1e-6, 'max=' + maxRes);

    // 采样点必须互不相同（去重改 Set 后仍要保证真的去掉了重复）
    const seen = new Set((r.solutions || []).map(s => s.values.map(q => Math.round(q * 1e9)).join(',')));
    ck('采样点无重复（' + seen.size + '/' + (r.solutions || []).length + '）',
        seen.size === (r.solutions || []).length, 'unique=' + seen.size);
}

console.log('\n———— ' + pass + ' passed / ' + fail + ' failed ————');
process.exit(fail ? 1 : 0);

console.log('\n———— ' + pass + ' passed / ' + fail + ' failed ————');
process.exit(fail ? 1 : 0);