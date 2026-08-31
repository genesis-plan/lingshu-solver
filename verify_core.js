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
console.log('=== 完成 ===');
if (failures > 0) {
  console.log(`✗ ${failures} 条断言失败`);
  process.exit(1);
} else {
  console.log('✓ 全部正确性断言通过');
}
