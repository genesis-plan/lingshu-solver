#!/usr/bin/env node
/**
 * test/rootbound-value.mjs — 量化「根界预算」的真实价值/成本比
 *
 * 待回答的问题（用数据回答，不靠推断）：
 *   Q1. rootBounds 在真实题集上**实际**花多久？（MAX_MS=300 是不是常态吃满？）
 *   Q2. 它产出的 proven=true 比例是多少？（真给到价值了吗）
 *   Q3. 把预算从 300ms 降到 30ms，proven 掉多少？端到端快多少？
 *   Q4. 端到端结论（4 态）会不会退化？
 *
 * 决策依据：如果 Q3 显示「降预算几乎不损失 proven，但端到端快一个量级」，
 *         那 300ms 就是纯浪费；如果 proven 掉了，就说明这钱花得值。
 */
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = 'D:/Projects/genesis-plan/lingshu-solver';
const WORKER = path.join(ROOT, 'test', '_rb-value-worker.cjs');

let _seed = 0x2f6e2b1 >>> 0;
function rnd() { _seed ^= _seed << 13; _seed >>>= 0; _seed ^= _seed >>> 17; _seed ^= _seed << 5; _seed >>>= 0; return _seed / 4294967296; }
function ri(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }
const NAMES = ['x', 'y', 'z', 'w', 'v', 't'];

// 题集覆盖：线性 / 多项式 / 混合 / 稠密多变量（真实 Agent 会问的形状）
const CASES = [];
for (let i = 0; i < 150; i++) {
  const n = ri(2, 6); const vs = NAMES.slice(0, n);
  const kind = ri(1, 4);
  let eqs;
  if (kind === 1) {           // 线性
    const rows = ri(1, 20) <= 3 ? ri(1, n - 1) : n;
    eqs = [];
    for (let r = 0; r < rows; r++) {
      let e = '';
      for (let k = 0; k < n; k++) e += (k ? '+' : '') + ri(1, 9) + '*' + vs[k];
      eqs.push(e + ' = ' + ri(-50, 50));
    }
  } else if (kind === 2) {     // 每变量一个二次
    eqs = vs.map((v, k) => `${v}^2 + ${vs[(k + 1) % n]} = ${ri(2, 20)}`);
  } else if (kind === 3) {     // 混合乘积 + 和
    eqs = [];
    let e = '';
    for (let k = 0; k < n; k++) e += (k ? '+' : '') + vs[k] + '*' + vs[(k + 1) % n];
    eqs.push(e + ' = ' + ri(3, 40));
    eqs.push(vs.join(' + ') + ' = ' + ri(3, 30));
  } else {                     // 稠密二���式
    eqs = [];
    for (let r = 0; r < Math.min(4, n); r++) {
      let e = '';
      for (let k = 0; k < n; k++) e += (k ? '+' : '') + ri(1, 6) + '*' + vs[k] + '*' + vs[(k + 1) % n];
      eqs.push(e + ' = ' + ri(5, 60));
    }
  }
  CASES.push({ eqs, vars: vs });
}

const CASES_PATH = path.join(ROOT, 'test', '_rb-value-cases.json');
require('fs').writeFileSync(CASES_PATH, JSON.stringify(CASES), 'utf8');

function run(maxMs) {
  const r = spawnSync(process.execPath, [WORKER, CASES_PATH, String(maxMs)],
    { env: { ...process.env, LS_RB_MAX_MS: String(maxMs) }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('worker 失败: ' + (r.stderr || r.stdout).slice(0, 600));
  return JSON.parse(r.stdout);
}

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

console.log(`题集 ${CASES.length} 道（线性/二次/混合/稠密，2~6 元）\n`);
console.log('  预算      rootBounds mean   p50     p95     max    proven   端到端 mean   4态分布');
const rows = [];
for (const ms of [300, 100, 50, 30, 10, 0]) {
  const r = run(ms);
  const dist = r.dist;
  rows.push([ms, r]);
  console.log(`  ${String(ms + 'ms').padStart(7)}`
    + `${mean(r.rbMs).toFixed(1).padStart(15)}ms`
    + `${pct(r.rbMs, 0.5).toFixed(1).padStart(8)}`
    + `${pct(r.rbMs, 0.95).toFixed(1).padStart(8)}`
    + `${Math.max(...r.rbMs).toFixed(0).padStart(8)}ms`
    + `${String(r.proven + '/' + CASES.length).padStart(9)}`
    + `${mean(r.e2eMs).toFixed(1).padStart(14)}ms`
    + `   ${JSON.stringify(dist)}`);
}
require('fs').unlinkSync(CASES_PATH);

console.log('\n【读法】proven = 拿到「已证明的根界」的题数（域被收紧、proven=true）。');
console.log('  · 若 300ms → 30ms 时 proven 几乎不掉、端到端快一个量级 ⇒ 300ms 是纯浪费');
console.log('  · 若 proven 掉很多 ⇒ 这钱花得值（域收紧了求解器少切很多盒）');
const a = rows[0][1], z = rows[4][1];
console.log(`\n实测结论：300ms→10ms 端到端 mean ${mean(a.e2eMs).toFixed(1)}→${mean(z.e2eMs).toFixed(1)}ms`
  + `（${(mean(a.e2eMs) / mean(z.e2eMs)).toFixed(2)}×），proven ${a.proven}→${z.proven}`
  + `（${a.proven === z.proven ? '无损失' : '损失 ' + (a.proven - z.proven) + ' 题'}）`);
