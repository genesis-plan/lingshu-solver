#!/usr/bin/env node
/**
 * test/rootbound-parity.mjs — rootbound 三处性能优化的【数学等价性硬校验】
 *
 * 为什么必须专门写这个（不是过度谨慎）：
 *   2026-10-05 优化了 rootbound 的三处重复劳动：
 *     ❶ enumerateCombos 提到变量循环外（原来每变量算一次）
 *     ❷ comboRows 预拼一次
 *     ❸ lpMax 加「建表 + Phase I 快照复用」，同一 (A,b) 只跑一次 Phase I
 *   ❸ 那处是真正的算法改动 —— 复用错了，根界会变。
 *   而**根界变松只会让域更大、仍然报 proven** ⇒ 现有测试极可能照样全绿，
 *   界已经不可信却没人发现。这是最危险的一类静默退化。
 *
 * 做法：同一批题跑两遍 —— 优化路径 vs ROOTBOUND_NO_OPT=1 参照路径（回到原始
 *       重复计算），逐项比对 halfWidths / perVar 的**每一个浮点数逐位相同**
 *       （toPrecision(17)，即 IEEE-754 双精度的完整表示）。
 *
 * 两遍在**两个独立进程**里跑（NO_OPT 是进程级环境变量，同进程无法切换）。
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = path.join(ROOT, 'test', '_rootbound-worker.cjs');

// ── 题集：覆盖各种结构 ──
const CASES = [
  { tag: 'x2-4', eqs: ['x^2 = 4'], vars: ['x'] },
  { tag: 'x3-2', eqs: ['x^3 = 2'], vars: ['x'] },
  { tag: '2eq-1var', eqs: ['x^2 = 4', 'x^3 = 8'], vars: ['x'] },
  { tag: 'linear-2', eqs: ['2*x + 3*y = 13'], vars: ['x', 'y'] },
  { tag: 'linear-3', eqs: ['2*x + 3*y - z = 13', 'x - y + z = 2'], vars: ['x', 'y', 'z'] },
  { tag: 'quad-cancel', eqs: ['x^2 - y^2 = 1'], vars: ['x', 'y'] },
  { tag: 'cubic-sys-3var', eqs: ['x^2 + y + z = 6', 'y^2 + z + x = 6', 'z^2 + x + y = 6'], vars: ['x', 'y', 'z'] },
  { tag: 'mixed-4var', eqs: ['x*y*z*w = 1', 'x + y + z + w = 8'], vars: ['x', 'y', 'z', 'w'] },
  { tag: 'chain-5var', eqs: ['a^2 + b = 3', 'b^2 + c = 4', 'c^2 + d = 5', 'd^2 + e = 6'], vars: ['a', 'b', 'c', 'd', 'e'] },
  { tag: 'dense-6var', eqs: [
    'x*y + y*z + z*w + w*v + v*t = 7', 'x*z + y*w + z*v + w*t = 11',
    'x*y*z + w*v*t = 5'], vars: ['x', 'y', 'z', 'w', 'v', 't'] },
  { tag: 'neg-coef', eqs: ['-3*x^2 + 5*y = -7'], vars: ['x', 'y'] },
  { tag: 'many-term', eqs: ['x^3 + x^2*y + x*y^2 + y^3 - 10 = 0'], vars: ['x', 'y'] },
  { tag: 'vanish', eqs: ['x*y = 0'], vars: ['x', 'y'] },
  { tag: 'big-coef', eqs: ['1000000*x^2 + 3*y = 12'], vars: ['x', 'y'] },
];

function runPass(noOpt) {
  const r = spawnSync(process.execPath, [WORKER, path.join(ROOT, 'test', '_rb-cases.json')],
    { env: { ...process.env, ROOTBOUND_NO_OPT: noOpt ? '1' : '0' }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('worker 失败(noOpt=' + noOpt + '): ' + (r.stderr || r.stdout).slice(0, 800));
  return JSON.parse(r.stdout);
}

import fs from 'node:fs';
fs.writeFileSync(path.join(ROOT, 'test', '_rb-cases.json'), JSON.stringify(CASES), 'utf8');

console.log('【rootbound 优化路径 vs 参照路径：逐位比对（toPrecision(17)）】\n');
let A, B;
try {
  A = runPass(false); B = runPass(true);
} catch (e) { console.error(String(e.message || e)); process.exit(1); }

let pass = 0, fail = 0;
for (let i = 0; i < CASES.length; i++) {
  const c = CASES[i];
  const a = A[i], b = B[i];
  const ja = JSON.stringify(a.snap), jb = JSON.stringify(b.snap);
  const ok = ja === jb;
  if (ok) {
    pass++;
    console.log(`   PASS  ${c.tag.padEnd(16)} n=${c.vars.length} combos=${a.snap.combos}`
      + ` proven=${a.snap.proven} |W|首项=${String(a.snap.halfWidths[0]).slice(0, 12)}`
      + `  优化耗时=${a.ms}ms 参照=${b.ms}ms`);
  } else {
    fail++;
    console.log(`   FAIL  ${c.tag}`);
    // 指出第一处不同的字段
    for (const k of Object.keys(a.snap)) {
      const x = JSON.stringify(a.snap[k]), y = JSON.stringify(b.snap[k]);
      if (x !== y) console.log(`         字段 ${k}:\n           优化: ${x}\n           参照: ${y}`);
    }
  }
}
fs.unlinkSync(path.join(ROOT, 'test', '_rb-cases.json'));
console.log('\n———— ' + pass + ' passed / ' + fail + ' failed ————');
process.exit(fail ? 1 : 0);
