// 6 变量线性系统：灵数(suan60 精确有理 + presolve 裁剪 + Markowitz) 同题对测
// 口径与 bench_linear_sympy.py 严格一致：
//   · 同一批题、同一台机、同样 WARMUP 预热、同样 REPEAT 次取均值
//   · 残差由本脚本独立算（不采信被测方自报）
//   · 内存用 process.memoryUsage().heapUsed 前后差（标注口径与 Python tracemalloc 不同）
import { createRequire } from 'module';
import { performance } from 'perf_hooks';
const require = createRequire(import.meta.url);
const P = require('D:/Projects/genesis-plan/lingshu-solver/_p60_proto.cjs');

const WARMUP = 3;
const REPEAT = 20;

function buildCases() {
    const C = [];
    // ① 稀疏带状 6×6
    const A1 = [];
    for (let i = 0; i < 6; i++) {
        const r = new Array(6).fill(0);
        r[i] = 4 + i;
        if (i + 1 < 6) r[i + 1] = -1;
        if (i > 0) r[i - 1] = -1;
        A1.push(r);
    }
    C.push({ name: 'banded6', kind: 'sparse-banded', A: A1, b: [1, 1, 1, 1, 1, 1] });

    // ② 下三角 6×6
    const L = [[2, 0, 0, 0, 0, 0], [1, 3, 0, 0, 0, 0], [2, -1, 4, 0, 0, 0],
    [0, 1, 2, 5, 0, 0], [0, 0, 1, -1, 6, 0], [0, 0, 0, 1, 2, 7]];
    const x0 = [1, 2, 3, 4, 5, 6];
    C.push({
        name: 'triangular6', kind: 'triangular', A: L,
        b: L.map(r => r.reduce((s, a, j) => s + a * x0[j], 0))
    });

    // ③ 稠密整数 6×6
    const A3 = [[3, -1, 2, 0, 1, -2], [1, 4, 0, 2, -1, 1], [2, 0, -3, 1, 2, 0],
    [0, 1, 1, 5, -2, 1], [1, -1, 0, 2, 3, 1], [2, 1, 1, 0, -1, 4]];
    C.push({ name: 'dense-int6', kind: 'dense-int', A: A3, b: [5, 6, 7, 8, 9, 10] });

    // ④ 过定不相容 6×6
    C.push({
        name: 'overdet-incon6', kind: 'overdet-inconsistent',
        A: [...A3, A3[0].slice(), A3[1].slice()], b: [5, 6, 7, 8, 9, 10, 99, 98]
    });

    // ⑤ 循环对角占优 6×6
    const A5 = [];
    for (let i = 0; i < 6; i++) { const r = new Array(6).fill(-1); r[i] = 12; A5.push(r); }
    C.push({ name: 'cyc-dom6', kind: 'diag-dominant', A: A5, b: [1, 1, 1, 1, 1, 1] });

    // ⑥ 稀疏随机（与 Python 侧同一 LCG，保证题目一致）
    let s = 20261003;
    const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const A6 = [];
    for (let i = 0; i < 6; i++) {
        const r = new Array(6).fill(0);
        for (let j = 0; j < 6; j++) r[j] = rnd() < 0.45 ? Math.floor(rnd() * 17 - 8) : 0;
        if (r.every(v => v === 0)) r[i] = 5;
        A6.push(r);
    }
    const b6 = []; for (let i = 0; i < 6; i++) b6.push(Math.floor(rnd() * 41 - 20));
    C.push({ name: 'sparse-rand6', kind: 'sparse-rand', A: A6, b: b6 });

    // ⑦ 对角阵
    const A7 = []; for (let i = 0; i < 6; i++) { const r = new Array(6).fill(0); r[i] = 10; A7.push(r); }
    C.push({ name: 'diagonal6', kind: 'diagonal', A: A7, b: [1, 1, 1, 1, 1, 1] });

    // ⑧ 有理系数
    C.push({
        name: 'rational6', kind: 'rational',
        A: [[1 / 3, 1 / 7, 0, 0, 0, 0], [0, 2 / 3, 1 / 5, 0, 0, 0], [0, 0, 3 / 7, 1 / 3, 0, 0],
        [0, 0, 0, 4 / 9, 1 / 5, 0], [0, 0, 0, 0, 5 / 3, 1 / 7], [1 / 5, 0, 0, 0, 0, 6 / 11]],
        b: [1, 1, 1, 1, 1, 1]
    });

    // ⑨ 欠定 4×6
    C.push({
        name: 'underdet6', kind: 'underdetermined',
        A: [[1, 2, 0, 0, 0, 0], [0, 1, 3, 0, 0, 0], [0, 0, 1, 4, 0, 0], [0, 0, 0, 1, 5, 0]],
        b: [1, 2, 3, 4]
    });

    // ⑩ presolve 重灾
    C.push({
        name: 'presolve-heavy6', kind: 'presolve-heavy',
        A: [[1, 0, 0, 0, 0, 0], [0, 2, 0, 0, 0, 0], [0, 0, 3, 0, 0, 0],
        [1, 0, 0, 0, 0, 0], [2, 4, 0, 0, 0, 0], [0, 0, 0, 7, 1, 1]],
        b: [2, 4, 6, 2, 12, 5]
    });

    return C;
}

function residual(A, b, x) {
    if (!x) return null;
    let w = 0;
    for (let i = 0; i < A.length; i++) {
        let s = 0;
        for (let j = 0; j < x.length; j++) s += A[i][j] * x[j];
        w = Math.max(w, Math.abs(s - b[i]));
    }
    return w;
}

// 预热
for (let i = 0; i < WARMUP; i++) P._s60solveLinear([[2, 1, 1], [1, 3, 1], [1, 1, 4]], 3);

const out = { tool: 'lingshu-suan60', cases: [] };
for (const c of buildCases()) {
    const n = c.A[0].length;
    const rows = c.A.map((r, i) => r.concat([c.b[i]]));
    const rec = { name: c.name, kind: c.kind, n: n, m: c.A.length };
    const h0 = process.memoryUsage().heapUsed;
    const t0 = performance.now();
    let r = null;
    for (let k = 0; k < REPEAT; k++) r = P._s60solveLinear(rows, n);
    const dt = (performance.now() - t0) / REPEAT;
    const h1 = process.memoryUsage().heapUsed;
    rec.ms = dt;   // performance.now() 返回毫秒，勿再乘 1000
    rec.ok = !!r.ok;
    rec.kind_result = r.kind;
    rec.stats = r.stats || null;
    rec.reason = r.reason || null;
    rec.path = r.path || null;
    rec.why = r.why || null;
    rec.verified = r.verified || null;
    rec.floatMs = r.floatMs != null ? r.floatMs : null;
    rec.verifyMs = r.verifyMs != null ? r.verifyMs : null;
    rec.presolveMs = r.presolveMs != null ? r.presolveMs : null;
    rec.heapDeltaBytes = h1 - h0;
    if (r.ok && r.kind !== 'nosol') {
        const x = r.x.map(P._s60num);
        rec.x = x;
        rec.resid = residual(c.A, c.b, x);
        rec.rank = r.rank;
    } else if (r.ok) {
        rec.resid = 0;
        rec.rank = r.rank;
    }
    out.cases.push(rec);
}
console.log(JSON.stringify(out));