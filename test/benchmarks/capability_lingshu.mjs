// 能力扫描 · 灵数侧。读 capability_scan.json（由 capability_scan.py 产出）跑【同一批题】。
// 口径与线性对测一致：题面只读不造、预热后计时、残差独立算、答案正确性不采信自报。
//
// 这一轮的对比维度不是纯速度，而是【能力格子】：
//   找「SymPy / NumPy 做不了或做得很慢、而灵数能严格做」的位置。
//   严格 = 给完备性判定 + 认证等级，不是「给了一个看起来对的浮点数」。
import { createRequire } from 'module';
import fs from 'fs';
import { performance } from 'perf_hooks';
const require = createRequire(import.meta.url);
const core = require('D:/Projects/genesis-plan/lingshu-solver/solver-core.js');
const S = core.solve;   // 走公开接入层（含 8 秒预算、fail-closed、返回体整形）

const CASES = JSON.parse(fs.readFileSync('D:/Projects/genesis-plan/lingshu-solver/test/benchmarks/capability_scan.json', 'utf8'));
// WARMUP / REPEAT 定义在下方计时段（与 capability_scan.py 的常量成对，改一处必须改两处）

// 独立残差：把解代回每条方程（用灵数自己的 evaluator，但【不采信求解器自报的 residual】）
function independentResidual(eqsSrc, vars, vals) {
    let worst = 0;
    for (const src of eqsSrc) {
        let v;
        try {
            v = evalExpr(src, vars, vals);
        } catch (e) { return null; }
        if (!isFinite(v)) return null;
        worst = Math.max(worst, Math.abs(v));
    }
    return worst;
}

// 极简表达式求值（支持 + - * / ^ 与括号、变量、数字）
// 为什么自己写而不复用内核：这是【第三方校验器】，必须与求解路径独立，
// 否则「求解器算错但校验器跟着算错」就测不出来（自证）。
function evalExpr(src, vars, vals) {
    const idx = {}; vars.forEach((v, i) => idx[v] = vals[i]);
    let p = 0;
    const s = src;
    function ws() { while (p < s.length && s[p] === ' ') p++; }
    function peek() { ws(); return s[p]; }
    function expr() {
        let v = term();
        for (; ;) {
            const c = peek();
            if (c === '+') { p++; v += term(); }
            else if (c === '-') { p++; v -= term(); }
            else return v;
        }
    }
    function term() {
        let v = unary();
        for (; ;) {
            const c = peek();
            if (c === '*') { p++; v *= unary(); }
            else if (c === '/') { p++; v /= unary(); }
            else return v;
        }
    }
    function unary() {
        const c = peek();
        if (c === '-') { p++; return -unary(); }
        if (c === '+') { p++; return unary(); }
        return power();
    }
    function power() {
        const base = atom();
        if (peek() === '^') { p++; return Math.pow(base, unary()); }
        return base;
    }
    function atom() {
        ws();
        const c = s[p];
        if (c === '(') { p++; const v = expr(); ws(); if (s[p] === ')') p++; return v; }
        if (c === '-' || c === '+') { p++; return c === '-' ? -atom() : atom(); }
        // 数字
        if (/[0-9.]/.test(c)) {
            let t = '';
            while (p < s.length && /[0-9.]/.test(s[p])) t += s[p++];
            // 处理 a/b 形式（SymPy sstr 对 Rational 输出 x/7）
            if (s[p] === '/' && /[0-9.]/.test(s[p + 1] || '')) {
                p++; let d = '';
                while (p < s.length && /[0-9.]/.test(s[p])) d += s[p++];
                return parseFloat(t) / parseFloat(d);
            }
            return parseFloat(t);
        }
        // 变量
        let t = '';
        while (p < s.length && /[A-Za-z_]/.test(s[p])) t += s[p++];
        if (t in idx) return idx[t];
        throw new Error('未知符号: ' + t);
    }
    const r = expr();
    return r;
}

// 预热 + 重复次数。
// ⚠ 口径纪律（本轮踩的坑）：初版只跑 1 次就计时 ⇒ 灵数侧量到的是【冷启动】
//   （首次 parse + JIT + 模块初始化），而 SymPy 侧的 import 在脚本开头就付掉了。
//   两边口径不对称，得出「灵数在线性题上比 SymPy 慢」的假结论
//   （实测 19ms vs 0.79ms，而同题同口径的线性专项对测是灵数快 28×）。
//   现在两侧口径对齐：都预热、都取多次均值。
const WARMUP = 3;
const REPEAT = 5;

// 预热（不计入计时）：跑几道代表性题，把 JIT/初始化成本挪到计时之外
for (let i = 0; i < WARMUP; i++) {
    try { S(['x + y - 3', 'x - y - 1'], ['x', 'y']); } catch (e) { }
    try { S(['x^2 + y^2 - 4', 'x*y - 1'], ['x', 'y']); } catch (e) { }
}

const out = { tool: 'lingshu', version: require('D:/Projects/genesis-plan/lingshu-solver/package.json').version, cases: [] };
for (const c of CASES) {
    const rec = {
        id: c.id, group: c.group, desc: c.desc, n: c.n, m: c.m
    };
    const t0 = performance.now();
    let r = null, err = null;
    // REPEAT 次取均值（口径与 SymPy 侧对齐：那边也是循环 REPEAT 次）
    for (let k = 0; k < REPEAT; k++) {
        try {
            r = S(c.eqs_src, c.vars);
        } catch (e) {
            err = String(e && e.message || e).slice(0, 120);
            r = null;
            break;
        }
    }
    rec.ms = (performance.now() - t0) / REPEAT;
    rec.msTotal = performance.now() - t0;
    rec.repeat = REPEAT;
    if (r) {
        rec.ok = !!r.ok;
        // ⚠ 字段名是照着 core.solve 的【真实返回体】写的，不是猜的。
        //   第一次写成了 solutionCount / tier / certified，读回来全是 undefined
        //   （真相字段是 candidateCount / provenCount / 每解的 tier）。
        //   教训：跨语言/跨层取字段，先 dump 一次真实结构再写映射。
        rec.solutionCount = r.candidateCount != null ? r.candidateCount : null;
        rec.provenCount = r.provenCount != null ? r.provenCount : null;
        rec.n_sol_shown = Array.isArray(r.solutions) ? r.solutions.length : 0;
        rec.tier = Array.isArray(r.solutions) && r.solutions[0] ? r.solutions[0].tier : null;
        rec.allCertified = r.solutions.length ? r.solutions.every(s => s.certified === true) : null;
        rec.executionPath = r.executionPath || null;
        rec.terminatedBy = r.meta ? r.meta.terminatedBy : null;
        // 完备性判定（灵数独有输出：SymPy/NumPy 都不给这个字段）
        // ⚠ completeness 是【对象】不是字符串，dump 过一次真实结构才写映射：
        //   { scope, provenIsComplete, candidateMayMiss, emptyProofNote, undecidability, reproducibility }
        rec.provenIsComplete = r.completeness ? !!r.completeness.provenIsComplete : null;
        rec.candidateMayMiss = r.completeness ? !!r.completeness.candidateMayMiss : null;
        rec.bound = r.bound ? r.bound.varCount : null;
        rec.cardinality = r.cardinality || null;
        rec.truncated = r.meta ? !!r.meta.truncated : null;
        rec.timeMsInternal = r.timeMs != null ? r.timeMs : null;
        const sols = Array.isArray(r.solutions) ? r.solutions : [];
        rec.indep_resid = sols.length
            ? independentResidual(c.eqs_src, c.vars, sols[0].values)
            : (r.candidateCount === 0 ? 0 : null);
        rec.bytes = Buffer.byteLength(JSON.stringify(r), 'utf8');
    }
    out.cases.push(rec);
}

fs.writeFileSync('D:/Projects/genesis-plan/lingshu-solver/test/benchmarks/lingshu_capability.json',
    JSON.stringify(out, null, 1));
console.log(JSON.stringify(out));
