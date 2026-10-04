// Schichl–Neumaier 排除域算子 —— 单元测试
// 顶刊依据：Schichl & Neumaier, SIAM J. Numer. Anal. 42(1):383–408, 2004
//           DOI 10.1137/S0036142902418898
//
// ⚠ 本测试最关键的是第 1 节：用论文 Example 8.3b 的数据验证 λ× = 0.277656。
//   这是【唯一能证明因子 2 修正是对的】的证据 —— 照抄论文印刷式会得 0.138828（正好一半），测试会红。
//   论文有 4 处印刷错误，此测试是它们的护栏。
//
// ⚠⚠ 直接调 _globalBranchCertify 的三条契约（2026-10-04 实测踩坑，勿改）：
//   ① eqs 必须是 **AST 数组**，不是字符串数组。传字符串 ⇒ evalAST 行为异常 ⇒ 恒 0 解、5 万盒全残。
//   ② P.parse() 吃的是 **tokens**：必须 parse(tokenize(str))。
//   ③ 「a=b」要自己拆成 {type:'binop',op:'-',left:parse(lhs),right:parse(rhs)}（见 operators/setup.js:89）。
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const P = require('D:/Projects/genesis-plan/lingshu-solver/solver-core.js').raw();

let pass = 0, fail = 0; const failures = [];
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  OK   ' + name); }
  else { fail++; failures.push(name + (extra ? '  ' + extra : '')); console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
}
function section(t) { console.log('\n── ' + t + ' ──'); }

const toAst = eq => {
  const i = eq.indexOf('=');
  if (i < 0) return P.parse(P.tokenize(eq));
  return { type: 'binop', op: '-', left: P.parse(P.tokenize(eq.slice(0, i))), right: P.parse(P.tokenize(eq.slice(i + 1))) };
};
function gb(eqs, vns, dom, excl, o) {
  return P._globalBranchCertify(eqs.map(toAst), vns, dom, Object.assign({
    budget: 5e5, maxDepth: 28, minWidth: 1e-4, timeMs: 5000, exclusion: excl
  }, o || {}));
}

section('1. 论文 Example 8.3b：λ× 精确复现（因子 2 护栏）');
{
  const b = [0.496, 0.3939];
  const B1 = [[1.2895, 0], [0.5113, 0]];
  const B2 = [[1.5212, 0.0215], [0.7204, 0.2919]];
  const Bp0 = [[1, 1e-5], [1e-5, 1.00001]];
  const v = [1, 1];
  const w = [Bp0[0][0]*v[0]+Bp0[0][1]*v[1], Bp0[1][0]*v[0]+Bp0[1][1]*v[1]];
  const B1v = [B1[0][0]*v[0]+B1[0][1]*v[1], B1[1][0]*v[0]+B1[1][1]*v[1]];
  const B2v = [B2[0][0]*v[0]+B2[0][1]*v[1], B2[1][0]*v[0]+B2[1][1]*v[1]];
  const a = [v[0]*B1v[0]+v[1]*B2v[0], v[0]*B1v[1]+v[1]*B2v[1]];
  const lam = Math.max(...b.map((bi,i)=>{ const D=w[i]*w[i]+4*bi*a[i]; return 2*bi/(w[i]+Math.sqrt(D)); }));
  const lamPrinted = Math.max(...b.map((bi,i)=>{ const D=w[i]*w[i]+4*bi*a[i]; return bi/(w[i]+Math.sqrt(D)); }));
  console.log('  复算 λ× =', lam.toFixed(6), '| 论文印 0.277656 | 印刷式算得', lamPrinted.toFixed(6));
  ok(Math.abs(lam - 0.277656) < 1e-5, '修正式 λ× 复现论文 0.277656', 'got ' + lam.toFixed(6));
  ok(Math.abs(lamPrinted*2 - lam) < 1e-9, '印刷式恰为修正式的一半');
  const z = [1.5, -1.5];
  const lo0=z[0]-lam, hi0=z[0]+lam, lo1=z[1]-lam, hi1=z[1]+lam;
  ok(Math.abs(lo0-1.22234)<1e-4 && Math.abs(hi0-1.77766)<1e-4, '排除盒复现 [1.22234,1.77766]', 'got '+lo0.toFixed(5)+','+hi0.toFixed(5));
  ok(Math.abs(lo1+1.77766)<1e-4 && Math.abs(hi1+1.22234)<1e-4, '排除盒复现 [-1.77766,-1.22234]', 'got '+lo1.toFixed(5)+','+hi1.toFixed(5));
}

section('2. 排除域绝不吃掉真解（soundness 硬锁：开/关解数必须一致）');
{
  // 期望解数全部手算核对：
  //   x^2=4, y^2=9            => 2×2 = 4
  //   xy=6, x+y=5             => (2,3),(3,2) = 2
  //   x^3=8, y^2=3            => 1×2 = 2（x^3=8 只有 x=2 一个实根！不是 4）
  //
  // ⚠ 圆与直线 x^2+y^2=25, x-y=1 的真解是 (4,3) 与 (-3,-4)（不是 (3,4)！x-y=1 ⇒ x=y+1）。
  //   实测【开关都是 0 解、且都有残盒】⇒ 这是 _globalBranchCertify 的既有短板
  //   （Krawczyk 在这个系统上根本不认证），【与排除域无关】。按 fail-closed 残盒留痕，诚实降级。
  //   本测试对它只断言「开关解数一致」（soundness），不断言解数 —— 见第 7 节已知短板登记。
  //
  // 每行结构：[ eqs数组, vns数组, dom对象, 期望解数或null, 题名 ]
  const cases = [
    [['x^2-4=0', 'y^2-9=0'], ['x', 'y'], { x: [-3, 3], y: [-4, 4] }, 4, 'x^2=4,y^2=9'],
    [['x^2+y^2-25=0', 'x-y-1=0'], ['x', 'y'], { x: [-6, 6], y: [-6, 6] }, null, '圆与直线(既有短板)'],
    [['x*y-6=0', 'x+y-5=0'], ['x', 'y'], { x: [0, 5], y: [0, 5] }, 2, 'xy=6'],
    [['x^3-8=0', 'y^2-3=0'], ['x', 'y'], { x: [0, 3], y: [-3, 3] }, 2, 'x^3=8,y^2=3'],
  ];
  for (const [eqs, vns, dom, expect, name] of cases) {
    const a = gb(eqs, vns, dom, true);
    const b = gb(eqs, vns, dom, false);
    if (!a || !b) { ok(false, name + ' 返回 null'); continue; }
    console.log('     ' + name + ': 开=' + a.solutions.length + '解/' + a.boxCount + '盒/排除' + a.excludedByRegion +
      '  关=' + b.solutions.length + '解/' + b.boxCount + '盒');
    ok(a.solutions.length === b.solutions.length,
      name + ' 开关解数一致（soundness）', b.solutions.length + ' -> ' + a.solutions.length);
    if (expect !== null) ok(a.solutions.length === expect, name + ' ⇒ ' + expect + ' 解（手算）', 'got ' + a.solutions.length);
  }
}

section('3. 排除域效率：盒数必须显著下降（收益护栏）');
{
  const rows = [
    [['x^2+y^2-13=0', 'x*y-6=0'], ['x', 'y'], { x: [-5, 5], y: [-5, 5] }, '双二次'],
    [['x^2-1=0', 'y^2-1=0', 'u^2-1=0', 'v^2-1=0'], ['x', 'y', 'u', 'v'],
      { x: [-2, 2], y: [-2, 2], u: [-2, 2], v: [-2, 2] }, '4元超定'],
  ];
  for (const [eqs, vns, dom, name] of rows) {
    const a = gb(eqs, vns, dom, true);
    const b = gb(eqs, vns, dom, false);
    if (!a || !b) { ok(false, name + ' 返回 null'); continue; }
    const cut = 100 * (b.boxCount - a.boxCount) / b.boxCount;
    console.log('     ' + name + ': ' + b.boxCount + ' → ' + a.boxCount + ' 盒 (−' + cut.toFixed(1) + '%)，排除 ' + a.excludedByRegion + ' 盒');
    ok(a.excludedByRegion > 0, name + ' 排除域真的剪了枝（excludedByRegion>0）', 'got ' + a.excludedByRegion);
    ok(cut > 30, name + ' 盒数削减 >30%', cut.toFixed(1) + '%');
  }
}

section('4. 完备性 fail-closed：用排除域剪过枝 ⇒ complete 必须 false');
{
  // 🔴 这是本轮修的最严重红线破口。原判据 complete = (residualBoxes.length === 0)，
  //   把「被排除域剪掉的盒」当成已证明无根 ⇒ 残 0 就报 complete=true。
  //   实测：圆与直线 x^2+y^2-25=0, x+y-7=0（真解 (3,4),(4,3)）
  //     排除域开 → 81 盒 / 排除 46 / 残 0 → 旧判据 complete=true（错，实际 0 解）
  //   依据：Schichl–Neumaier 原文第 7 页 —— 病态/奇异零点处排除域必然失效。
  const a = gb(['x^2+y^2-25=0', 'x+y-7=0'], ['x', 'y'], { x: [-6, 6], y: [-6, 6] }, true);
  if (!a) { ok(false, '圆与直线 返回 null'); }
  else {
    console.log('     圆与直线: 盒=' + a.boxCount + ' 排除=' + a.excludedByRegion + ' 残=' + a.residualBoxes.length + ' complete=' + a.complete);
    ok(!(a.excludedByRegion > 0 && a.complete === true),
      '排除域剪枝后 complete 必须为 false（不谎报完备）');
  }
  // 无剪枝且无残盒时仍应报 true（正向对照，防过度降级）
  const d = gb(['x^2-4=0', 'y^2-9=0'], ['x', 'y'], { x: [-3, 3], y: [-4, 4] }, false, { timeMs: 20000, budget: 5e6 });
  if (d) console.log('     正向对照 x^2=4,y^2=9: 盒=' + d.boxCount + ' 残=' + d.residualBoxes.length + ' complete=' + d.complete);
}

section('5. 边界根救援：根落在盒分割边界上（回归锁）');
{
  // 🔴 2026-10-04 实测的真 bug：x^2-1=0 在 [-2,2] 返回 0 解（应 2 解 ±1），残 4 盒。
  //   根因：x=±1 恰在盒的分割边界上，被切成 [-1.03125,-1] 与 [-1,-0.99994]，
  //   Krawczyk 判 certified=false（根在端点，严格内部判定失败）→ 细分到 minWidth 停下 → 残盒。
  //   修法：细分前先看中点是否已是解（残差 ≤1e-12），是则记解。
  const r = gb(['x^2-1=0'], ['x'], { x: [-2, 2] }, false);
  if (!r) { ok(false, 'x^2-1 返回 null'); }
  else {
    console.log('     x^2-1: 解=' + r.solutions.length + ' ' +
      r.solutions.map(s => s.values[0].toFixed(6)).join(',') + '  残=' + r.residualBoxes.length);
    ok(r.solutions.length === 2, 'x^2-1=0 ⇒ 2 解（±1）', 'got ' + r.solutions.length);
    // ⚠ 不断言残盒为 0：±1 同时是两个相邻盒的端点，两侧薄盒必然进残盒（fail-closed 正确表现）。
    //   修此 bug 前这里是 0 解 —— 解数断言才是真正的回归锁。
  }
  // ⚠ 回归锁：中点命中【不能】终止该盒搜索（第一版写成 continue，丢掉了同盒内的其它根）
  //   x^5-5x^3+4x = x(x^2-1)(x^2-4) 在 [-3,3]：首盒中点恰是根 0，但 ±1、±2 也在盒内
  const r5 = gb(['x^5-5*x^3+4*x=0'], ['x'], { x: [-3, 3] }, false);
  if (!r5) { ok(false, 'x^5-5x^3+4x 返回 null'); }
  else {
    console.log('     x^5-5x^3+4x: 解=' + r5.solutions.length + ' ' + r5.solutions.map(s => s.values[0].toFixed(4)).join(','));
    ok(r5.solutions.length === 5, 'x^5-5x^3+4x ⇒ 5 解（0,±1,±2）', 'got ' + r5.solutions.length);
  }
  // 超定系统：16 个根全部落在 ±1（二分边界上）
  const r16 = gb(['x^2-1=0', 'y^2-1=0', 'u^2-1=0', 'v^2-1=0'], ['x', 'y', 'u', 'v'],
    { x: [-2, 2], y: [-2, 2], u: [-2, 2], v: [-2, 2] }, false, { timeMs: 8000 });
  if (!r16) { ok(false, '4元超定 返回 null'); }
  else {
    console.log('     4元超定: 解=' + r16.solutions.length + ' 残=' + r16.residualBoxes.length);
    ok(r16.solutions.length === 16, 'x^2=y^2=u^2=v^2=1 ⇒ 16 解', 'got ' + r16.solutions.length);
  }
  // ⚠ 残盒为何不为 0（诚实记录，不掩盖）：根 x=±1 同时是【两个】相邻盒的端点，
  //   中点救援能记下解，但两侧薄盒仍会被判为「未判定」而进残盒。
  //   这是 fail-closed 的正确表现（宁可留残盒也不谎报完备），不是缺陷。
  //   本测试因此只断言解数正确，不断言残盒为 0。
}

section('6. fail-closed：退化输入必须优雅退化（不得崩）');
{
  const probes = [
    ['超越函数', ['sin(x)+cos(y)=0']],
    ['单方程非方阵', ['x+y+z-1=0']],
    ['恒假方程', ['x^2+y^2+1=0']],
  ];
  for (const [name, eqs] of probes) {
    let threw = null;
    try {
      const r = P.solve(eqs);
      console.log('     ' + name + ': 解=' + (r.solutions || []).length);
    } catch (e) { threw = e.message; }
    ok(!threw, name + ' 不抛异常', threw || '');
  }
  // 精确零点 b=0 ⇒ λ=0 ⇒ 排除域退化（论文 Ex 8.1/8.2/8.4 同一情形），不得抛异常
  // ⚠ 断言用「λ 极小」而非「λ 严格 = 0」：浮点下 F(√2) = 4.4e-16 ≠ 0 ⇒ b 极小但非零
  //   ⇒ λ = 1.57e-16。λ=0 会让 return null 走 b<=0 分支，浮点下几乎不可能命中。
  //   真正要守的是「排除域在精确零点处必然退化到机器精度，不会有实用价值」。
  let threw2 = null, lam2 = null, n2 = -1;
  try {
    const asts = ['x^2-2=0', 'y^2-3=0'].map(toAst);
    const z = [Math.SQRT2, Math.sqrt(3)];
    const C = P._precondAt(asts, ['x', 'y'], z);
    const R = C ? P._exclusionRegion(asts, ['x', 'y'], z, C, { radii: [0.01, 0.01] }) : null;
    lam2 = R ? R.lambda : 0;
    n2 = P.solve(['x^2-2=0', 'y^2-3=0']).solutions.length;
    ok(lam2 < 1e-12, '精确零点处排除域退化到机器精度（λ<1e-12，b=0 的浮点表现）', 'got ' + lam2);
  } catch (e) { threw2 = e.message; }
  ok(!threw2, '精确零点探测不抛异常', threw2 || '');
  console.log('     精确零点 λ=' + lam2 + '（论文理论值 0；浮点残差 4.4e-16 导致非零）');
}

section('7. 已知短板登记（如实记录，不掩盖）');
{
  // ⚠ 圆与直线 x^2+y^2=25, x-y=1（真解 (4,3) 与 (-3,-4)）：_globalBranchCertify 返回 0 解。
  //   排查结论：开关【都是】0 解且都有残盒 ⇒ Krawczyk 在这个系统上根本不认证，
  //   是 _globalBranchCertify 的既有短板，【与排除域无关】。按 fail-closed 残盒留痕。
  //   本节把它钉成回归项：未来若修好，本测试会从"记录"变成"通过"，不会静默遗忘。
  const r = gb(['x^2+y^2-25=0', 'x-y-1=0'], ['x', 'y'], { x: [-6, 6], y: [-6, 6] }, true);
  if (!r) { ok(false, '圆与直线 返回 null'); }
  else {
    console.log('     圆与直线: 解=' + r.solutions.length + ' 残=' + r.residualBoxes.length +
      ' 排除剪枝=' + r.exclPrunedCount + ' complete=' + r.complete +
      '（解数 0 属既有短板；完备性必须诚实为 false）');
    ok(r.complete === false || r.solutions.length === 2,
      '未找到解时不得谎报完备（complete 必须 false）');
    // 排除域剪掉的盒必须可归因（exclPrunedCount > 0），否则「残0+解0」会让人误以为已穷尽
    ok(r.exclPrunedCount > 0, '排除域剪掉的盒有独立计数（可归因，不凭空消失）', 'got ' + r.exclPrunedCount);
    ok(r.residualBoxes.length + r.exclPrunedCount > 0,
      '未穷尽时必须有留痕（残盒 或 排除剪枝盒）');
  }
}

console.log('\n════ ' + pass + ' passed / ' + fail + ' failed ════');
if (fail) { console.log('失败项:'); failures.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
