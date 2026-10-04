// 6 变量线性对测汇总：灵数 vs SymPy vs 【独立精确裁决】
//
// 这个文件存在的意义：三方对照。
//   · 灵数（lingshu_linear.json）—— 被测方
//   · SymPy 1.14.0（sympy_linear.json）—— 被测方
//   · 独立裁决（linear_truth.json）—— 【裁判】，BigInt 精确 RREF，与内核无共享代码
// 没有裁判就只能比谁快，没法判谁对。本轮就是靠裁判抓出灵数两个 rank bug。
//
// ⚠ 口径纪律：题面单一来源 linear_cases.json。两侧曾各造各的随机题
//   （Python random vs JS 手写 LCG），导致 sparse-rand6 根本不是同一道题。
import fs from 'fs';

const B = 'D:/Projects/genesis-plan/lingshu-solver/test/benchmarks/';
const L = JSON.parse(fs.readFileSync(B + 'lingshu_linear.json', 'utf8'));
const S = JSON.parse(fs.readFileSync(B + 'sympy_linear.json', 'utf8'));
const T = JSON.parse(fs.readFileSync(B + 'linear_truth.json', 'utf8'));
const sm = {}; S.cases.forEach(c => sm[c.name] = c);
const tm = {}; T.cases.forEach(c => tm[c.name] = c);

const out = { generated: 'linear_compare.mjs', arbiter: T.arbiter, arbiterSelfTest: T.selfTest, rows: [] };

console.log('题'.padEnd(23) + '灵ms'.padStart(8) + 'SymPy ms'.padStart(10) + '倍数'.padStart(8) +
    '  | 灵kind'.padEnd(9) + 'SymPy kind'.padEnd(11) + '真相'.padEnd(8) + 'rankA'.padStart(6) + '  裁决');
console.log('─'.repeat(112));

let tl = 0, ts = 0, win = 0, loss = 0, agreeL = 0, agreeS = 0, agreeRank = 0;
for (const c of L.cases) {
    const s = sm[c.name], t = tm[c.name];
    const ms = s && s.linsolve_ms != null ? s.linsolve_ms : null;
    let ratio = '—';
    if (ms != null && c.ms > 0) {
        ratio = (ms / c.ms).toFixed(1) + 'x';
        tl += c.ms; ts += ms;
        if (c.ms < ms) win++; else loss++;
    }
    const sk = s && s.linsolve_ok ? s.linsolve_kind : 'FAIL';
    const kindOk = c.kind_result === t.truth;
    const sKindOk = sk === t.truth;
    const rankOk = c.rank === t.rankA;
    if (kindOk) agreeL++;
    if (sKindOk) agreeS++;
    if (rankOk) agreeRank++;
    out.rows.push({
        name: c.name, kind: c.kind, n: c.n, m: c.m,
        lingshu_ms: c.ms, lingshu_kind: c.kind_result, lingshu_rank: c.rank, lingshu_resid: c.resid,
        sympy_ms: ms, sympy_kind: sk, sympy_resid: s ? s.linsolve_resid : null,
        truth: t.truth, truth_rankA: t.rankA, truth_dim: t.dim,
        speedup: ms != null && c.ms > 0 ? ms / c.ms : null,
        arbiter_agrees: { lingshu: kindOk && rankOk, sympy: sKindOk }
    });
    console.log(c.name.padEnd(23) + c.ms.toFixed(4).padStart(8) +
        (ms != null ? ms.toFixed(3) : '—').padStart(10) + ratio.padStart(8) + '  | ' +
        c.kind_result.padEnd(9) + sk.padEnd(11) + t.truth.padEnd(8) + String(t.rankA).padStart(6) +
        '  ' + (kindOk && rankOk ? '灵✅' : '灵❌') + ' ' + (sKindOk ? 'Sym✅' : 'Sym❌'));
}

console.log('\n' + '═'.repeat(112));
console.log('【裁判自检】' + (T.selfTest ? T.selfTest.passed + '/' + T.selfTest.total : 'n/a') +
    '（裁判自己先过手算小例，才配裁决别人）');
console.log('【速度】灵数更快 ' + win + '/' + (win + loss) + ' 题；累计 ' +
    tl.toFixed(4) + 'ms vs SymPy ' + ts.toFixed(3) + 'ms ⇒ ' + (ts / tl).toFixed(1) + '×');
console.log('【正确性】灵数 kind 一致 ' + agreeL + '/' + L.cases.length +
    '，rank 一致 ' + agreeRank + '/' + L.cases.length);
console.log('          SymPy kind 一致 ' + agreeS + '/' + L.cases.length +
    '（linsolve 对欠定系统返回参数化表达式，不是数值向量）');
out.summary = { win, loss, total: L.cases.length, lingshu_ms_total: tl, sympy_ms_total: ts, speedup: ts / tl, agreeL, agreeRank, agreeS };
fs.writeFileSync(B + 'linear_compare.json', JSON.stringify(out, null, 1));
