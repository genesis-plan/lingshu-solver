// 维度路由实测探针：跑 n=0..6 各维度代表题，记录真实触发的算子/耗时/结论。
// 用途：为「按变量数自动选算子」提供改动前的基线，改完后逐位比对。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mod = await import(pathToFileURL(path.join(ROOT, 'dist/lingshu.mjs')).href);
const { solve } = mod;

const CASES = [
  // n=0（纯常量）
  { t: 'n0-true',  eq: ['1=1'] },
  { t: 'n0-false', eq: ['1=2'] },
  // n=1
  { t: 'n1-poly3', eq: ['x^3-6x^2+11x-6=0'] },
  { t: 'n1-trans', eq: ['exp(x)=2'] },
  { t: 'n1-trig', eq: ['cos(x)=0.5'] },
  { t: 'n1-rat',  eq: ['1/x=2'] },
  // n=2
  { t: 'n2-lin',   eq: ['2x+3y=13', 'x-y=1'] },
  { t: 'n2-poly',  eq: ['xy=6', 'x+y=5'] },
  { t: 'n2-sym',   eq: ['x+y=6', 'x-y=2'] },
  // n=3
  { t: 'n3-lin',   eq: ['2x+y-z=1', 'x+2y+z=5', 'x-y+z=3'] },
  { t: 'n3-poly',  eq: ['x+y+z-6', 'xy+yz+zx-11', 'xyz-6'] },
  { t: 'n3-under', eq: ['x+y+z=6'] },
  // n=4
  { t: 'n4-lin',   eq: ['x+y+z+w=10', 'x-y+z-w=0', 'x+2y-z+w=3', '2x-y+z-2w=-1'] },
  { t: 'n4-under', eq: ['x+y+z+w=10', 'x-y+z-w=0'] },
  // n=5
  { t: 'n5-lin',   eq: ['x+y+z+w+v=15', 'x-y+z-w+v=1', 'x+2y-z+w-v=4', '2x-y+z-2w+v=0', 'x+y-z+w-v=3'] },
  // n=6
  { t: 'n6-lin',   eq: ['x+y+z+w+v+u=21', 'x-y+z-w+v-u=0', 'x+2y-z+w-v+u=5', '2x-y+z-2w+v-u=1', 'x+y-z+w-v+u=7', '3x-2y+z-w+v-2u=2'] },
  { t: 'n6-under', eq: ['x+y+z+w+v+u=21'] },
];

const out = [];
for (const c of CASES) {
  const t0 = performance.now();
  let r;
  try { r = solve(c.eq, null, 6, null, false, null); }
  catch (e) { r = { error: 'THROW: ' + e.message }; }
  const ms = +(performance.now() - t0).toFixed(2);
  const meta = (r && r.meta) || {};
  const ops = meta.operators || [];
  const row = {
    t: c.t, ms,
    conclusion: r && r.conclusion,
    n: (r && r.varNames && r.varNames.length) || 0,
    sols: r && r.solutions ? r.solutions.length : 0,
    fired: ops.map(o => o.id).join(','),
  };
  out.push(row);
  console.log(`${c.t.padEnd(12)} ${String(ms).padStart(8)}ms  n=${row.n}  ${String(row.conclusion || '').padEnd(8)}  sols=${row.sols}  fired=[${row.fired}]`);
}
fs.writeFileSync(path.join(ROOT, 'test/benchmarks/dim-routing-baseline.json'), JSON.stringify(out, null, 1));
console.log('\nWROTE test/benchmarks/dim-routing-baseline.json');