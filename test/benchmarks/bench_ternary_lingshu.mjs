// 三元系统：灵数(suan59 三元结式)侧。读取 sympy_ternary.json 保证严格同题。
// 口径：预热 3 轮 + 5 轮取 min（去 JIT 抖动）；解的正确性由第三方代回三式判定。
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const core = require('D:/Projects/genesis-plan/lingshu-solver/solver-core.js');
const sb = core.raw();
const P = s => sb.parse(sb.tokenize(s.replace(/\*\*/g, '^')));
const BOX = { x: [-20, 20], y: [-20, 20], z: [-20, 20] };

let J = [];
try { J = JSON.parse(fs.readFileSync('D:/Projects/genesis-plan/lingshu-solver/test/benchmarks/sympy_ternary.json', 'utf8')); }
catch (e) { console.log('sympy_ternary.json 尚未生成（SymPy 仍在跑）—— 先只跑灵数侧'); }

function runOnce(eqStrs) {
  return sb._suan59SolveTernaryPoly(eqStrs.map(P), ['x', 'y', 'z'], BOX, { maxOut: 100, valTol: 1e-6 });
}
function independentCheck(eqStrs, sols) {
  const nodes = eqStrs.map(P);
  let worst = 0;
  for (const s of sols) {
    const v = { x: s[0], y: s[1], z: s[2] };
    for (const nd of nodes) {
      let r; try { r = Math.abs(sb.evalAST(nd, v)); } catch (e) { r = Infinity; }
      worst = Math.max(worst, r);
    }
  }
  return worst;
}

const rows = [];
console.log('题名'.padEnd(24) + '灵数ms'.padStart(9) + 'n'.padStart(4) + '残差'.padStart(11) + ' | ' + 'SymPy ms'.padStart(11) + 'n'.padStart(4));
console.log('-'.repeat(76));
for (const c of J) {
  const eqStrs = c.eqs;
  for (let i = 0; i < 3; i++) runOnce(eqStrs);
  const ts = []; let r = null;
  for (let i = 0; i < 5; i++) { const t0 = performance.now(); r = runOnce(eqStrs); ts.push(performance.now() - t0); }
  const ms = Math.min(...ts);
  const sols = (r && r.solutions) || [];
  const worst = sols.length ? independentCheck(eqStrs, sols) : 0;
  rows.push({ name: c.name, ls: +ms.toFixed(3), lsN: sols.length, lsWorst: worst, sp: c.sympy_ms, spN: c.sympy_n });
  console.log(c.name.padEnd(24) + ms.toFixed(3).padStart(9) + String(sols.length).padStart(4)
    + worst.toExponential(1).padStart(11) + ' | ' + String(c.sympy_ms).padStart(11) + String(c.sympy_n).padStart(4));
}
if (rows.length) {
  const win = rows.filter(r => r.ls < r.sp).length;
  const totLs = rows.reduce((a, r) => a + r.ls, 0);
  const totSp = rows.reduce((a, r) => a + r.sp, 0);
  const allValid = rows.every(r => r.lsWorst < 1e-6);
  console.log('\n=== 汇总 ===');
  console.log('灵数更快: ' + win + '/' + rows.length + ' 题');
  console.log('总耗时: 灵数 ' + totLs.toFixed(2) + 'ms vs SymPy ' + totSp.toFixed(1) + 'ms ⇒ ' + (totSp / totLs).toFixed(1) + '×');
  console.log('灵数解全部通过三式独立回代: ' + (allValid ? '是 ✅' : '否 ❌'));
  fs.writeFileSync('D:/Projects/genesis-plan/lingshu-solver/test/benchmarks/ternary_vs_sympy.json', JSON.stringify(rows, null, 1));
}
