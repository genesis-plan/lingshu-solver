// 能力矩阵对比：灵数 vs SymPy 1.14.0 vs NumPy
// 读两侧 JSON，输出对齐的对比表。数据全部来自本轮实测，无估算。
//
// 口径（踩过的坑都写在这）：
//  · 题面单一事实来源：两侧都读 capability_scan.json（由 capability_scan.py 导出）。
//    曾因两侧各造各的题导致对测全废。
//  · 「严格」的定义：给出【完备性/无解的数学判定】。SymPy 与 NumPy 都不提供这个字段
//    —— 它们给的是「我算出了这些点」，不是「这些就是全部，且其余无解」。
//  · 速度不可直接相减内存（tracemalloc 峰值 vs V8 heapUsed），只在同侧内可比。
import fs from 'fs';

const B = 'D:/Projects/genesis-plan/lingshu-solver/test/benchmarks/';
const SP = JSON.parse(fs.readFileSync(B + 'capability_scan.json', 'utf8'));
const LS = JSON.parse(fs.readFileSync(B + 'lingshu_capability.json', 'utf8'));
const lsm = {}; LS.cases.forEach(c => lsm[c.id] = c);

const rows = SP.map(c => {
    const l = lsm[c.id] || {};
    const s = c.sympy || {}, np_ = c.numpy || {};
    return {
        id: c.id, group: c.group, desc: c.desc, n: c.n, m: c.m,
        ls_ms: l.ms != null ? l.ms : null,
        ls_cand: l.candidateCount, ls_proven: l.provenCount,
        ls_complete: l.provenIsComplete, ls_path: l.executionPath,
        ls_bytes: l.bytes,
        sp_ms: s.ms, sp_ok: s.ok, sp_route: s.route, sp_nsol: s.n_sol, sp_err: s.err,
        np_ms: np_.ms, np_ok: np_.ok, np_rank: np_.rank, np_err: np_.err,
    };
});

const out = {
    generated: 'capability_compare.mjs',
    tools: { lingshu: LS.version, sympy: '1.14.0', numpy: 'lstsq route' },
    note: '题面单一来源 capability_scan.json；两侧独立计时；严格性指是否给出完备性数学判定',
    rows,
};
fs.writeFileSync(B + 'capability_compare.json', JSON.stringify(out, null, 1));

// ---- 打印对齐表 ----
const f = (v, w) => String(v == null ? '—' : typeof v === 'number' ? (v < 10 ? v.toFixed(2) : v.toFixed(0)) : v).padStart(w);
console.log('ID   组别    n×m   灵数ms  灵数解  灵数proven  灵数完备  | SymPy ms  SymPy解  路线            | NumPy ms rank');
console.log('─'.repeat(120));
for (const r of rows) {
    console.log(
        r.id.padEnd(4) + r.group.padEnd(8) + (r.n + '×' + r.m).padEnd(6) +
        f(r.ls_ms, 8) + f(r.ls_cand, 8) + f(r.ls_proven, 12) +
        (r.ls_complete === true ? '   是' : r.ls_complete === false ? '   否' : '   —').padEnd(10) + '| ' +
        f(r.sp_ms, 8) + f(r.sp_nsol, 8) + ' ' + String(r.sp_route || '—').padEnd(14) + ' | ' +
        f(r.np_ms, 8) + f(r.np_rank, 5));
}
console.log('\n' + '═'.repeat(120));

// ---- 汇总 ----
const lsWin = rows.filter(r => r.sp_ms != null && r.ls_ms != null && r.ls_ms < r.sp_ms).length;
const cmp = rows.filter(r => r.sp_ms != null && r.ls_ms != null);
const tl = cmp.reduce((s, r) => s + r.ls_ms, 0), ts = cmp.reduce((s, r) => s + r.sp_ms, 0);
console.log('【速度】可比 ' + cmp.length + ' 题：灵数更快 ' + lsWin + ' 题；累计 ' +
    tl.toFixed(2) + 'ms vs SymPy ' + ts.toFixed(2) + 'ms ⇒ ' + (ts / tl).toFixed(1) + '×');
const lsStrict = rows.filter(r => r.ls_complete === true).length;
const spStrict = rows.filter(r => r.sp_ok && r.sp_route === 'linsolve' && r.sp_nsol != null).length;
console.log('【严格性】灵数给出完备性数学判定 ' + lsStrict + '/' + rows.length +
    ' 题；SymPy 0/' + rows.length + ' 题（linsolve/solve 都不返回完备性字段）');
const spFail = rows.filter(r => r.sp_ok === false);
const npSkip = rows.filter(r => r.np_ok === null);
console.log('【能力边界】SymPy 报错 ' + spFail.length + ' 题' + (spFail.length ? '：' + spFail.map(r => r.id + '(' + r.group + ')').join('、') : ''));
console.log('           NumPy 不适用 ' + npSkip.length + ' 题（非线性，只能 lstsq）');
const lsBig = rows.filter(r => (r.sp_ms || 0) > 100 || (r.ls_ms || 0) < 50 && (r.sp_ms || 0) > 20);
console.log('【差距最大】' + rows.filter(r => r.sp_ms != null && r.ls_ms != null)
    .sort((a, b) => (b.sp_ms / Math.max(b.ls_ms, 1e-6)) - (a.sp_ms / Math.max(a.ls_ms, 1e-6)))
    .slice(0, 4).map(r => r.id + ' ' + (r.sp_ms / Math.max(r.ls_ms, 1e-6)).toFixed(0) + '×').join('、'));
