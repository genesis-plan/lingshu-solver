// 线性对测的【第三方独立裁决器】——纯 BigInt 精确分数算术。
//
// 存在的理由（这是本轮抓到的最重要方法论问题）：
//   速度对测的两侧都只报「我算出了什么」，谁也没资格说「正确答案是什么」。
//   本文件用与灵数、SymPy 都无共享代码的方式，把每题的数学事实定死：
//     rank(A)、rank([A|b])、相容性、解集维数、一组精确特解。
//   有了它才能判「谁对谁错」；否则只是比谁跑得快。
//   ⚠ 教训：判「某一方算错了」之前，必须先有独立第三方基准 —— 本轮若没有这个文件，
//     就会把「灵数 nosol」误判成 bug（实际是 JS 侧题面与 Python 侧不同题）。
import fs from 'fs';

const CASES = JSON.parse(fs.readFileSync('D:/Projects/genesis-plan/lingshu-solver/test/benchmarks/linear_cases.json', 'utf8'));

// ---- 精确有理数 {n, d}，d 恒正 ----
function gcd(a, b) { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) { [a, b] = [b, a % b]; } return a; }
function F(n, d) {
    d = d === undefined ? 1n : d;
    if (d === 0n) throw new Error('除零');
    if (d < 0n) { n = -n; d = -d; }
    const g = gcd(n, d) || 1n;
    return { n: n / g, d: d / g };
}
const fmul = (p, q) => F(p.n * q.n, p.d * q.d);
const fsub = (p, q) => F(p.n * q.d - q.n * p.d, p.d * q.d);
const fdiv = (p, q) => F(p.n * q.d, p.d * q.n);
const fzero = p => p.n === 0n;
const fstr = p => p.d === 1n ? p.n.toString() : p.n + '/' + p.d;
// 解析题面编码：数字 → 整数；字符串 "p/q" → 有理数
function parseCell(v) {
    if (typeof v === 'number') { if (!Number.isInteger(v)) throw new Error('题面出现非整数数字：' + v); return F(BigInt(v)); }
    const parts = String(v).split('/');
    return parts.length === 2 ? F(BigInt(parts[0]), BigInt(parts[1])) : F(BigInt(parts[0]));
}

// ---- Gauss-Jordan 消元（精确分数，完整选主元）⇒ 同时得 RREF 与 rank ----
// ⚠ 自踩的坑（已修）：初版漏了【主元行归一化】—— 直接拿 f = M[i][k] 去减 M[r][j]，
//   相当于假设主元已是 1，于是消元系数错，把相容系统判成不相容
//   （presolve-heavy6 被误判 rankAug=5 ⇒ 差点冤枉灵数「谎报有解」）。
//   教训：第三方裁判自己也是代码，也会有 bug；裁判给出的结论必须先用手算小例验证，
//   否则「独立第三方」只是换了个地方出错。归一化后 f = M[i][k] 才是正确消元系数。
function rref(cells) {
    const m = cells.length, n = cells[0].length;
    const M = cells.map(r => r.map(c => ({ ...c })));
    const piv = [];      // piv[i] = 第 i 个主元所在列
    let r = 0;
    for (let k = 0; k < n && r < m; k++) {
        let p = -1;
        for (let i = r; i < m; i++) if (!fzero(M[i][k])) { p = i; break; }
        if (p < 0) continue;
        [M[r], M[p]] = [M[p], M[r]];
        // ① 主元行归一化：M[r][k] → 1（这是初版漏掉的关键一步）
        const inv0 = fdiv(F(1n), M[r][k]);
        for (let j = k; j < n; j++) M[r][j] = fmul(M[r][j], inv0);
        // ② 用 f = M[i][k]（此刻主元为 1，f 才是正确系数）消去其余行
        for (let i = 0; i < m; i++) {
            if (i === r || fzero(M[i][k])) continue;
            const f = M[i][k];
            for (let j = k; j < n; j++) M[i][j] = fsub(M[i][j], fmul(f, M[r][j]));
        }
        piv.push(k); r++;
    }
    return { M, piv, rank: piv.length };
}

const out = { arbiter: 'independent-bigint-rref', selfTest: null, cases: [] };

// ---- 裁判自检（必须先过，才配裁决别人）----
// 初版 rref 漏了主元行归一化，把相容的 presolve-heavy6 判成不相容，
// 差点冤枉灵数「谎报有解」。教训：第三方裁判自己也是代码，也会有 bug。
// 所以这里用 4 个手算可验证的小例做门禁，任何一项不过就直接退出，不产出结论。
function selfTest() {
    const I = n => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? F(1n) : F(0n))));
    const checks = [];
    // ① 单位阵：满秩唯一解 x = 任意 b
    {
        const t = rref(I(3).map((r, i) => r.concat([F(BigInt(i + 1))])));
        checks.push({ name: 'identity3', want: 3, got: t.rank, ok: t.rank === 3 && F(0n) === null ? false : t.rank === 3 });
    }
    // ② 相容且欠秩：x1=1, x2=2, x1=1(重复) ⇒ rank=1, rankAug=1 ⇒ 相容
    {
        const A = [[F(1n), F(0n)], [F(2n), F(0n)], [F(1n), F(0n)]];
        const b = [F(1n), F(2n), F(1n)];
        const r1 = rref(A), r2 = rref(A.map((r, i) => r.concat([b[i]])));
        checks.push({ name: 'dup-row-consistent', want: 'rank1/rank1/consistent', got: r1.rank + '/' + r2.rank + '/' + (r1.rank === r2.rank), ok: r1.rank === 1 && r2.rank === 1 });
    }
    // ③ 不相容：x1=1 与 x1=2 ⇒ rank=1, rankAug=2
    {
        const A = [[F(1n)], [F(1n)]];
        const b = [F(1n), F(2n)];
        const r1 = rref(A), r2 = rref(A.map((r, i) => r.concat([b[i]])));
        checks.push({ name: 'contradictory', want: 'rank1/rank2/inconsistent', got: r1.rank + '/' + r2.rank + '/' + (r1.rank === r2.rank), ok: r1.rank === 1 && r2.rank === 2 });
    }
    // ④ presolve-heavy6 真实矩阵（初版 bug 的回归靶）：rank=4, rankAug=4, 相容
    {
        const A = [[1, 0, 0, 0, 0, 0], [0, 2, 0, 0, 0, 0], [0, 0, 3, 0, 0, 0],
        [1, 0, 0, 0, 0, 0], [2, 4, 0, 0, 0, 0], [0, 0, 0, 7, 1, 1]].map(r => r.map(v => F(BigInt(v))));
        const b = [2, 4, 6, 2, 12, 5].map(v => F(BigInt(v)));
        const r1 = rref(A), r2 = rref(A.map((r, i) => r.concat([b[i]])));
        checks.push({ name: 'presolve-heavy6-regression', want: 'rank4/rank4/consistent', got: r1.rank + '/' + r2.rank + '/' + (r1.rank === r2.rank), ok: r1.rank === 4 && r2.rank === 4 });
    }
    return checks;
}
const st = selfTest();
const stFailed = st.filter(c => !c.ok);
out.selfTest = { passed: st.length - stFailed.length, total: st.length, checks: st };
if (stFailed.length) {
    console.error('❌ 裁判自检未过 ' + stFailed.length + '/' + st.length + ' 项 —— 拒绝产出结论（裁判自己不可信时不能裁决别人）');
    st.forEach(c => console.error('   ' + (c.ok ? 'OK  ' : 'FAIL') + ' ' + c.name + '  期望 ' + c.want + '  实得 ' + c.got));
    process.exit(1);
}
console.log('裁判自检 ' + (st.length) + '/' + st.length + ' 通过（含 presolve-heavy6 回归靶）\n');

for (const c of CASES.cases) {
    const A = c.A.map(row => row.map(parseCell));
    const b = c.b.map(parseCell);
    const n = c.A[0].length, m = c.A.length;
    const aug = A.map((row, i) => row.concat([b[i]]));

    const rA = rref(A);
    const rAug = rref(aug);
    const consistent = rA.rank === rAug.rank;
    // 解集维数 = n - rank(A)（相容时）；不相容时为 -1（空集）
    const dim = consistent ? n - rA.rank : -1;

    // 零行右端非零 ⇒ 该行形如 0 = c (c≠0) ⇒ 矛盾方程
    let contradictionRow = -1;
    for (let i = 0; i < rAug.M.length; i++) {
        let allZero = true;
        for (let j = 0; j < n; j++) if (!fzero(rAug.M[i][j])) { allZero = false; break; }
        if (allZero && !fzero(rAug.M[i][n])) { contradictionRow = i; break; }
    }

    // 一组精确特解（自由列置 0）
    let sol = null;
    if (consistent) {
        const x = new Array(n).fill(F(0n));
        rAug.piv.forEach((k, i) => { x[k] = rAug.M[i][n]; });
        sol = x;
    }
    // 独立残差：max |Ax - b|，全精确
    let resid = null;
    if (sol) {
        resid = F(0n);
        for (let i = 0; i < m; i++) {
            let acc = F(0n);
            for (let j = 0; j < n; j++) acc = fadd(acc, fmul(A[i][j], sol[j]));
            const e = fsub(acc, b[i]);
            if (e.n < 0n ? -e.n > resid.n : e.n > resid.n) resid = e;
        }
    }
    // 精确 x（转成可比较的 "num/den" 字符串，避免两侧 float 位数差导致误判）
    const solStr = sol ? sol.map(fstr) : null;
    const solNum = sol ? sol.map(f => Number(f.n) / Number(f.d)) : null;

    out.cases.push({
        name: c.name, kind: c.kind, n, m,
        rankA: rA.rank, rankAug: rAug.rank,
        consistent, dim, contradictionRow,
        pivots: rAug.piv, freeCols: [...Array(n).keys()].filter(k => !rAug.piv.includes(k)),
        solStr, solNum,
        residExact: resid ? fstr(resid) : null,
        truth: consistent ? (dim === 0 ? 'unique' : 'family') : 'nosol'
    });

    function fadd(p, q) { return F(p.n * q.d + q.n * p.d, p.d * q.d); }
}

const path = 'D:/Projects/genesis-plan/lingshu-solver/test/benchmarks/linear_truth.json';
fs.writeFileSync(path, JSON.stringify(out, null, 1));
console.log('独立裁决结果（' + out.cases.length + ' 题）→ linear_truth.json\n');
console.log('题目'.padEnd(24) + 'm×n'.padStart(6) + 'rankA'.padStart(7) + 'rankAug'.padStart(8) +
    'dim'.padStart(5) + '  真相'.padEnd(9) + '特解（自由列=0）');
for (const c of out.cases) {
    console.log(c.name.padEnd(24) + (c.m + '×' + c.n).padStart(6) + String(c.rankA).padStart(7) +
        String(c.rankAug).padStart(8) + String(c.dim).padStart(5) + '  ' + c.truth.padEnd(9) +
        (c.solStr ? c.solStr.slice(0, 5).map(s => s.length > 12 ? s.slice(0, 12) + '…' : s).join(', ') : '—'));
}
