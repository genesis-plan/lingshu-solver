// 重构后「零行为变更」判据：跑新构建产物，与 test/golden/baseline.json 逐字段对拍。
// 任一字段不一致 ⇒ 重构引入了行为漂移，必须回退查因。
// 用法: node test/golden/diff.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runAll } from './suite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const entry = process.env.LINGSHU_ENTRY || path.join(ROOT, 'dist/lingshu.mjs');

const sb = await import(pathToFileURL(entry).href);
const { CASES, norm } = await import('./suite.mjs');

// suite.mjs 内部用的是旧 solver-core；这里跑的是「新构建产物」
function runAgainst(mod) {
  const out = [];
  for (const [name, eqs, vs] of CASES) {
    // ⚠️ 只对比 {name,result,throw}：eqs/varNames 是输入常量（两边必然一致），
    //    留在 rec 里会让 JSON.stringify 在很早的位置就 diverge，
    //    造成「result 其实一模一样」却被误判成字段漂移的假失败。
    const rec = { name };
    try {
      rec.result = norm(mod.solve(eqs, vs, 6));
    } catch (e) {
      rec.throw = String((e && e.message) || e);
    }
    out.push(rec);
    process.stdout.write('.');
  }
  process.stdout.write('\n');
  return out;
}

const baseRaw = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/golden/baseline.json'), 'utf8'));
const base = baseRaw.map((r) => ({ name: r.name, result: r.result, throw: r.throw }));
const cur = runAgainst(sb);

let pass = 0; const fails = [];
for (let i = 0; i < base.length; i++) {
  const b = base[i], c = cur[i];
  if (b.name !== c.name) { fails.push({ name: b.name, why: '用例顺序不一致' }); continue; }
  const a = JSON.stringify(b), z = JSON.stringify(c);
  if (a === z) pass++;
  else {
    // 定位第一个差异
    let k = 0; while (k < Math.min(a.length, z.length) && a[k] === z[k]) k++;
    fails.push({
      name: b.name,
      why: '字段漂移',
      at: a.slice(Math.max(0, k - 60), k + 60).replace(/\n\s*/g, ' '),
      base: b.throw || '解=' + (b.result && b.result.nSolutions),
      cur: c.throw || '解=' + (c.result && c.result.nSolutions),
    });
  }
}
console.log('── ' + path.relative(ROOT, entry) + ' vs baseline ──');
console.log('pass=' + pass + ' fail=' + fails.length + ' / ' + base.length);
for (const f of fails) {
  console.log('  ✗ ' + f.name + '  ' + f.why);
  if (f.at) console.log('      ...' + f.at + '...');
  if (f.base !== undefined) console.log('      基线: ' + f.base + '  现值: ' + f.cur);
}
process.exit(fails.length ? 1 : 0);
