// 6 变量线性系统：灵数(suan60 精确有理 + presolve 裁剪 + Markowitz) 同题对测
// 口径与 bench_linear_sympy.py 严格一致：
//   · 同一批题（读共享的 linear_cases.json —— 单一事实来源，两侧绝不各自造题）
//   · 同一台机、同样 WARMUP 预热、同样 REPEAT 次取均值
//   · 残差由本脚本独立算（不采信被测方自报）
//   · 内存用 process.memoryUsage().heapUsed 前后差（标注口径与 Python tracemalloc 不同）
//
// ⚠ 口径纪律（踩过的两个坑，都写在这里防止重犯）：
//   ① 必须打【现役内核】solver-core.js → dist/lingshu.mjs，不能打 prototypes/_p60_proto.cjs
//      —— 原型可能已与 src 漂移，量出来的数不是产品的数。
//   ② 题面必须读 linear_cases.json。曾经两侧各造各的随机题（Python random vs JS LCG），
//      结果「sparse-rand6」根本不是同一道题，对测结论全是废的。
import { createRequire } from 'module';
import fs from 'fs';
import { performance } from 'perf_hooks';
const require = createRequire(import.meta.url);
const core = require('D:/Projects/genesis-plan/lingshu-solver/solver-core.js');
const P = core.raw();

const WARMUP = 3;
const REPEAT = 20;

const CASES = JSON.parse(fs.readFileSync('D:/Projects/genesis-plan/lingshu-solver/test/benchmarks/linear_cases.json', 'utf8')).cases;
// 题面编码：数字 → 整数；字符串 "p/q" → 有理数。灵数内核吃数字，故字符串先转 float。
// ⚠ 精度说明：rational6 的 1/3 转成 float 是 0.333…，内核内部会再有理化恢复，
//   所以两侧面对的仍是同一个有理数（裁决器已独立核过残差为 0）。
const toNum = v => (typeof v === 'number' ? v : (() => {
    const [p, q] = String(v).split('/');
    return Number(p) / Number(q);
})());

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

const out = { tool: 'lingshu-suan60', engine: 'dist/lingshu.mjs (via solver-core.js)', cases: [] };
for (const c of CASES) {
    const A = c.A.map(r => r.map(toNum));
    const b = c.b.map(toNum);
    const n = c.A[0].length;
    const rows = c.A.map((r, i) => r.map(toNum).concat([toNum(c.b[i])]));
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
    if (r.ok && r.kind !== 'nosol' && r.x) {
        const x = r.x.map(P._s60num);
        rec.x = x;
        rec.resid = residual(A, b, x);
        rec.rank = r.rank;
    } else {
        rec.resid = 0;
        rec.rank = r.rank;
    }
    out.cases.push(rec);
}
console.log(JSON.stringify(out));
