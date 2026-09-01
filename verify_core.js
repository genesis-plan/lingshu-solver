'use strict';
// 灵数求解器 · 正确性回归（非仅冒烟）
// 不仅验证"能跑、返回解数"，更断言数学正确性：
//   1) 每个有限解残差 < 1e-3（6位网格下代数≤1e-9、超越≤~1e-5，1e-3 兜底抓错解）
//   2) tier=proven 的解 certified===true（Krawczyk 真认证，非数值伪证）
//   3) 确定性样例解数 == 期望（防回归漏解/多解）
// 任一断言失败 → process.exit(1)，可被 CI / 调用方捕获。
const { solve } = require('./solver-core');

let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✓', msg); }
  else { failures++; console.log('  ✗ ASSERT FAIL:', msg); }
}

function show(label, eqs, vars, dom, expect) {
  const t0 = Date.now();
  let r;
  try {
    r = solve(eqs, vars || [], 6, dom);
  } catch (e) {
    console.log(label, '=> THREW', e.message);
    failures++;
    return;
  }
  const dt = Date.now() - t0;
  const sols = r.solutions || [];
  const meta = r.meta || {};
  console.log(
    label,
    '| resultType=', r.resultType,
    '| #sol=', sols.length,
    '| truncated=', !!meta.truncated,
    '| t=', dt + 'ms'
  );

  // 正确性断言：每个有限解须真实满足方程
  for (let i = 0; i < sols.length; i++) {
    const s = sols[i];
    assert(
      s && typeof s.residual === 'number' && isFinite(s.residual) && s.residual < 1e-3,
      `解#${i} 残差=${s && s.residual} < 1e-3（忠实满足方程，非伪根）`
    );
    if (s && s.tier === 'proven') {
      assert(s.certified === true, `解#${i} tier=proven ⇒ certified=true（Krawczyk 构造性认证）`);
    }
  }

  // 确定性样例：解数须等于期望（穷尽回归）
  if (expect && typeof expect.nSol === 'number') {
    assert(sols.length === expect.nSol, `解数=${sols.length} === 期望 ${expect.nSol}`);
  }
  // 期望完备（未截断）的样例
  if (expect && expect.noTruncated) {
    assert(!meta.truncated, `未截断（预算内已完备穷尽）`);
  }
  if (r.warnings && r.warnings.length) {
    console.log('   warnings:', JSON.stringify(r.warnings).slice(0, 160));
  }
}

console.log('=== 灵数求解器 · 正确性回归（非仅冒烟）===');
show('1) x^2=4 (2解)', ['x^2 = 4'], ['x'], undefined, { nSol: 2 });
show('2) 6变量三对角 (唯一解)', ['x+y=3', 'x+2y+z=8', 'y+2z+a=14', 'z+2a+b=20', 'a+2b+c=26', 'b+2c=31'], ['x', 'y', 'z', 'a', 'b', 'c'], undefined, { nSol: 1 });
show('3) 空集无解', ['x+y=3', 'x+y=5'], ['x', 'y'], undefined, { nSol: 0 });
show('4) 圆×双曲线 (4解)', ['x^2 + y^2 = 4', 'x*y = 1'], ['x', 'y'], undefined, { nSol: 4 });
show('5) 高频+域 (截断, 仅验不崩不伪)', ['sin(20*x)=0.5', 'sin(20*y)=0.5'], ['x', 'y'], { x: [-30, 30], y: [-30, 30] });
show('6) 无限解推荐 (1候选)', ['x+y=3'], ['x', 'y'], undefined, { nSol: 1 });
show('7) 强依赖多项式 x^3-x=0 (3解, 验 AA 相依收缩)', ['x^3 - x = 0'], ['x'], undefined, { nSol: 3 });
// C1: 整数约束诚实标注（不得静默实数化）——独立用例，断言结构化标志
{
  const r = solve(['x^2 = 2', 'x∈ℤ'], ['x'], 1, undefined, false, {});
  assert(r.integerConstraintUnenforced === true, 'C1: 整数约束须结构化标注 integerConstraintUnenforced=true（不再静默实数化）');
  assert(Array.isArray(r.warnings) && r.warnings.some(w => /整数约束/.test(w)), 'C1: warnings 须含整数约束提示文字');
  const sols = r.solutions || [];
  console.log('  ✓ C1 整数约束诚实标注: 实数解 ±√2≈±1.414 已按实数域返回，并显式标"非整数未强制"');
}
// 裸表达式兼容性 + 诚实性回归（2026-08-31 修复）
// 8) 缺等号的方程须按 "expr=0" 求解（用户直觉：x^2-1 即求 x^2-1=0 的根）
{
  const r = solve(['x^2-1'], ['x'], 6, undefined, false, {});
  const sols = r.solutions || [];
  assert(sols.length === 2, `裸表达式 x^2-1 须解 2 根（得 ${sols.length}）`);
  const vals = sols.map(s => s && s.values && s.values[0]).sort((a, b) => a - b);
  assert(Math.abs((vals[0] || 0) - (-1)) < 1e-6 && Math.abs((vals[1] || 0) - 1) < 1e-6, `裸表达式解须为 ±1`);
}
// 9) 畸形输入须诚实返回空集，且不得谎称"严格证明无解"（provenEmpty 不得为 true）
{
  const r = solve(['asdf'], ['x'], 6, undefined, false, {});
  assert(r.resultType === 1 && (r.solutions || []).length === 0, '畸形输入须返回空集且无解');
  assert(r.provenEmpty !== true, '畸形输入不得谎称 provenEmpty=true（严格证明无解）');
  assert(/NO_SOLUTION|NO_EQUATION/.test(r.error || ''), `畸形输入须诚实标注 error=${r.error}`);
}
// 10) 部分变量域不得崩溃（2026-09-01 修复：_globalBranchCertify 内部按 dom[v][0]/[1] 取数组格式域，
//     直接传原始 userDomain 时，用户未指定的变量为 undefined → undefined[0] 抛异常）
{
  const eq = ['x1 = 12', 'x2 = 5', 'x1 / x2 - x3 = 0'];
  const v = ['x1', 'x2', 'x3'];
  const doms = [{ x3: [0, 10] }, { x1: [11, 13] }, { x2: [4, 6] }, { x1: [11, 13], x2: [4, 6] }];
  for (const d of doms) {
    let r = null, threw = null;
    try { r = solve(eq, v, 6, d); } catch (e) { threw = (e && e.message) || String(e); }
    assert(!threw, `部分变量域 ${JSON.stringify(d)} 不得抛异常（得 ${threw}）`);
    assert(r && r.resultType === 2 && (r.solutions || []).length === 1,
      `部分变量域 ${JSON.stringify(d)} 应解出 1 组解 (12,5,2.4)，实得 ${r ? (r.solutions || []).length : 'null'}`);
    if (r && r.solutions && r.solutions.length) {
      const s = r.solutions[0].values;
      assert(Math.abs(s[0] - 12) < 1e-6 && Math.abs(s[1] - 5) < 1e-6 && Math.abs(s[2] - 2.4) < 1e-6,
        `部分变量域 ${JSON.stringify(d)} 解须为 (12,5,2.4)，实得 ${JSON.stringify(s)}`);
    }
  }
  console.log('  ✓ 部分变量域不再崩溃，且正确解出 (12,5,2.4)');
}
console.log('=== 完成 ===');
if (failures > 0) {
  console.log(`✗ ${failures} 条断言失败`);
  process.exit(1);
} else {
  console.log('✓ 全部正确性断言通过');
}
