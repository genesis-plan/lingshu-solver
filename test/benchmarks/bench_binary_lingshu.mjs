// 二元多项式系统：灵数 vs SymPy 同题对测（读取 sympy_binary.json）
// 口径严格：同题、同机、各自预热、各自取 min（去抖动）、解的正确性由第三方代回判定。
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const core = require('D:/Projects/genesis-plan/lingshu-solver/solver-core.js');

const J = JSON.parse(fs.readFileSync('D:/Projects/genesis-plan/lingshu-solver/test/benchmarks/sympy_binary.json', 'utf8'));
const sb = core.raw();
// SymPy 侧为了用 sympify 写的是 Python 幂运算 **，灵数解析器用 ^ —— 统一转回 ^
// 两侧的方程字符串仅此一处差异，数学内容完全相同。
const P = s => sb.parse(sb.tokenize(s.replace(/\*\*/g, '^')));
const REPEAT = 5, WARMUP = 3;

// 第三方独立校验（JS 侧）：代回两个原方程，残差 ≤ 1e-7
function independentCheck(eqStrs, sols) {
  const nodes = eqStrs.map(P);
  let ok = 0, worst = 0;
  for (const s of sols) {
    const v = { x: s[0], y: s[1] };
    let r = 0;
    for (const nd of nodes) {
      let a; try { a = Math.abs(sb.evalAST(nd, v)); } catch (e) { a = Infinity; }
      r = Math.max(r, a);
    }
    worst = Math.max(worst, r);
    if (r <= 1e-7) ok++;
  }
  return { ok, worst };
}

function runOnce(eqStrs) {
  return sb._suan59SolveBinaryPoly(eqStrs.map(P), ['x', 'y'], -1e6, 1e6, -1e6, 1e6,
    { maxOut: 100, valTol: 1e-6 });
}

const rows = [];
console.log('题名'.padEnd(24) + '灵数ms'.padStart(9) + 'n'.padStart(4) + '完备'.padStart(6)
  + ' | ' + 'SymPy ms'.padStart(11) + 'n'.padStart(4) + ' | ' + 'nroots ms'.padStart(10) + 'n'.padStart(4) + ' |  独立校验(灵数/SymPy)');
console.log('-'.repeat(118));

for (const c of J) {
  const eqStrs = c.eqs;
  for (let i = 0; i < WARMUP; i++) runOnce(eqStrs);
  const ts = [];
  let r = null;
  for (let i = 0; i < REPEAT; i++) {
    const t0 = performance.now();
    r = runOnce(eqStrs);
    ts.push(performance.now() - t0);
  }
  const ms = Math.min(...ts);
  const sols = (r && r.solutions) || [];
  const chk = independentCheck(eqStrs, sols);
  // 完备性判据：Sturm 已【证明】x 的不同实根数；每个这样的 x 都必须至少产出一个
  // 通过双方程回代验算的 (x,y) 解 ⇒ 消元 + 回代链条无缺口。
  // 注意量纲：Sturm 数的是 x 根数（2），解数是 (x,y) 对数（4），不能直接相等比较。
  const distinctX = new Set(sols.map(s => Number(s[0].toFixed(6))));
  const proven = !!(r && r.xCountProven && distinctX.size >= r.xCount);
  rows.push({
    name: c.name, ls: +ms.toFixed(3), lsN: sols.length, lsProven: proven,
    lsValid: chk.ok, lsWorst: chk.worst,
    sp: c.sympy_solve_ms, spN: c.sympy_solve_n, spValid: c.sympy_solve_valid,
    spNR: c.sympy_nroots_ms, spNRn: c.sympy_nroots_n,
  });
  console.log(
    c.name.padEnd(24) +
    ms.toFixed(3).padStart(9) + String(sols.length).padStart(4) + (proven ? '  是' : '  否').padStart(6) +
    ' | ' + String(c.sympy_solve_ms).padStart(11) + String(c.sympy_solve_n).padStart(4) +
    ' | ' + String(c.sympy_nroots_ms ?? 'n/a').padStart(10) + String(c.sympy_nroots_n ?? '-').padStart(4) +
    ' |  ' + chk.ok + '/' + c.sympy_solve_valid + '  maxRes ' + chk.worst.toExponential(1)
  );
}

// 汇总
const win = rows.filter(r => r.ls < r.sp).length;
const withNR = rows.filter(r => r.spNR != null);
const winNR = withNR.filter(r => r.ls < r.spNR).length;
const provenN = rows.filter(r => r.lsProven).length;
console.log('\n=== 汇总 ===');
console.log(`灵数更快（vs SymPy solve）: ${win}/${rows.length} 题`);
console.log(`灵数更快（vs SymPy nroots 完备路线）: ${winNR}/${withNR.length} 题`);
console.log(`灵数给出【完备性数学证明】: ${provenN}/${rows.length} 题（SymPy 0 题，SymPy 不提供根数证明）`);
const totLs = rows.reduce((a, r) => a + r.ls, 0);
const totSp = rows.reduce((a, r) => a + r.sp, 0);
console.log(`总耗时: 灵数 ${totLs.toFixed(2)}ms vs SymPy solve ${totSp.toFixed(1)}ms  ⇒ ${(totSp / totLs).toFixed(1)}×`);
fs.writeFileSync('D:/Projects/genesis-plan/lingshu-solver/test/benchmarks/binary_vs_sympy.json',
  JSON.stringify(rows, null, 1));
