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

// ★ 2026-10-05 修：本机 Node spawn 子进程**全部返回 EBUSY**（已知机器限制，
//   2026-10-03 实测多次，cmd.exe 与 node.exe 都不行），而 Bash 工具里一切正常。
//   原实现只走 spawnSync，于是 r.status=null、r.stderr 与 r.stdout 都是 undefined，
//   报错停在 `String(...).slice` —— 一个跟数学校验毫无关系的假失败，
//   但它让整个 verify 链红掉，很有欺骗性。
//   正解：仍优先 spawnSync（别的机器上是对的）；一旦 EBUSY 则回落到
//   「Bash 预先把两遍结果写成文件、Node 只读文件比对」。
//   用法（EBUSY 时）：
//     node test/_rootbound-worker.cjs test/_rb-cases.json > test/_rb-A.json
//     ROOTBOUND_NO_OPT=1 node test/_rootbound-worker.cjs test/_rb-cases.json > test/_rb-B.json
//     node test/rootbound-parity.mjs --pre-generated
function runPass(noOpt) {
  const r = spawnSync(process.execPath, [WORKER, path.join(ROOT, 'test', '_rb-cases.json')],
    { env: { ...process.env, ROOTBOUND_NO_OPT: noOpt ? '1' : '0' }, encoding: 'utf8' });
  if (r.error) {
    const pre = path.join(ROOT, 'test', noOpt ? '_rb-B.json' : '_rb-A.json');
    if (fs.existsSync(pre)) {
      console.error('  （spawn EBUSY ⇒ 改读预生成结果 ' + path.basename(pre) + '）');
      return JSON.parse(fs.readFileSync(pre, 'utf8'));
    }
    throw new Error('worker 失败(noOpt=' + noOpt + '): ' + r.error.message
      + '；且没有预生成的 ' + path.basename(pre) + '，请先在 Bash 里跑两遍 worker。');
  }
  if (r.status !== 0) throw new Error('worker 失败(noOpt=' + noOpt + '): ' + (r.stderr || r.stdout || '(无输出)').slice(0, 800));
  return JSON.parse(r.stdout);
}

import fs from 'node:fs';
fs.writeFileSync(path.join(ROOT, 'test', '_rb-cases.json'), JSON.stringify(CASES), 'utf8');

console.log('【rootbound 优化路径 vs 参照路径：逐位比对（toPrecision(17)）】\n');
let A, B;
try {
  A = runPass(false); B = runPass(true);
} catch (e) { console.error(String(e.message || e)); process.exit(1); }

// ⚠⚠ 题集硬闸（2026-10-05 加，防「读到错位数组而假绿」）：
//   走 EBUSY 回落时，A/B 是从预生成 JSON 文件读的。**若那个文件是用别���题集
//   生成的**（或题集改过但没重新生成），A[i]/B[i] 与 CASES[i] 就会错位 ——
//   循环里 a.snap 是 undefined 直接崩；更坏的情况是恰好长度够、
//   错位比对却"通过"，那就是**假绿**，比假红危险得多。
//   正解：比对**长度 + 每条的 combos/proven**（worker 输出的 snap 字段，
//   与题集结构一一对应且确定），不对就中止。
//   ⚠不能用 tag 做指纹：worker 的输出对象里**没有 tag 字段**
//   （第一版就踩了这个坑：期望 "14|x2-4,..."，实际 "14|,," ⇒ 每次都误报）。
const _fp = arr => arr.length + '|' + arr.map(x =>
  x && x.snap ? x.snap.combos + '/' + x.snap.proven : '?').join(',');
const _want = _fp(CASES.map(c => ({ snap: { combos: NaN, proven: null } })));
// 题集侧的期望指纹不能凭空造——直接用 worker 跑一次当前题集当作基准不可行
//（那正是要比对的东西）。改为：只校验长度 + 每项确实是对象且有 snap，
// 真正的内容一致性由下面的 A/B 逐位比对负责。
for (const [name, got] of [['A', A], ['B', B]]) {
  if (!Array.isArray(got)) { console.error(`❌ ${name} 不是数组`); process.exit(1); }
  if (got.length !== CASES.length) {
    console.error(`❌ ${name} 的结果条数 ${got.length} ≠ 题集 ${CASES.length}`
      + '（多半是预生成文件过期了）');
    console.error('   ⇒ 请在 Bash 里重跑两遍 worker 重新生成 _rb-A.json / _rb-B.json');
    process.exit(1);
  }
  const bad = got.map((x, i) => (x && x.snap ? null : i)).filter(x => x !== null);
  if (bad.length) {
    console.error(`❌ ${name} 第 [${bad.join(',')}] 条缺 snap 字段（预生成文件与题集不对应）`);
    console.error('   ⇒ 请在 Bash 里重跑两遍 worker 重新生成 _rb-A.json / _rb-B.json');
    process.exit(1);
  }
}

let pass = 0, fail = 0;
for (let i = 0; i < CASES.length; i++) {
  const c = CASES[i];
  const a = A[i], b = B[i];
  if (!a || !b || !a.snap || !b.snap) {
    console.error(`❌ 第 ${i} 条（${c.tag}）缺结果，长度对不上`);
    process.exit(1);
  }
  const ja = JSON.stringify(a.snap), jb = JSON.stringify(b.snap);
  const ok = ja === jb;
  if (ok) {
    pass++;
    // ⚠ halfWidths 可能缺失（如变量未被界住时），String(undefined).slice 也会炸 ——
    //   同样是个与数学无关的假失败点。显式兜底。
    const hw = Array.isArray(a.snap.halfWidths) && a.snap.halfWidths.length
      ? String(a.snap.halfWidths[0]).slice(0, 12) : 'n/a';
    console.log(`   PASS  ${c.tag.padEnd(16)} n=${c.vars.length} combos=${a.snap.combos}`
      + ` proven=${a.snap.proven} |W|首项=${hw}`
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
