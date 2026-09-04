'use strict';
/**
 * 灵数求解器 · P0 缺陷修复回归测试
 * 验证 2026-09-04 修的两处 P0：
 *   P0-1: _newtonRefine 因点值喂入 intervalEval 致雅可比 NaN → 恒返 null（全局分支谎报 complete）
 *   P0-2: _affineEval 超越函数分支把合法区间宽度丢成 0 → intervalEval 对 sin/exp/... 塌成点（unsound）
 *
 * 运行：node test/p0_fix_regression.js
 * 注：顶层 solve() 对单变量超越方程（如 sin(x)-0.5）会挂起，属独立于本修复的既有缺陷（见报告），
 *     故本回归只测受 P0 影响的底层原语与终止的 solve 用例。
 */
const core = require('../solver-core');
const sb = core.raw();
const P = s => sb.parse(sb.tokenize(s));
const fx = iv => (iv ? '[' + iv.min.toFixed(4) + ', ' + iv.max.toFixed(4) + ']' : 'null');
let pass = 0, fail = 0;
function chk(name, ok, detail) {
  ok ? pass++ : fail++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? '  ' + detail : ''}`);
}
// 区间包含性（soundness）：got 必须包围 [lo, hi]
function contains(got, lo, hi) { return got && got.min <= lo + 1e-9 && got.max >= hi - 1e-9; }
const near = (v, t, eps) => Math.abs(v - t) < eps;

console.log('===== A. intervalEval 一元包络（sound + tight）=====');
chk('intervalEval(sin x) @[-2,2] ⊇ [-1,1]', contains(sb.intervalEval(P('sin(x)'), { x: { min: -2, max: 2 } }), -1, 1), fx(sb.intervalEval(P('sin(x)'), { x: { min: -2, max: 2 } })));
chk('intervalEval(cos x) @[-2,2] ⊇ [-cos2,1]', contains(sb.intervalEval(P('cos(x)'), { x: { min: -2, max: 2 } }), -Math.cos(2), 1), fx(sb.intervalEval(P('cos(x)'), { x: { min: -2, max: 2 } })));
chk('intervalEval(exp x) @[-1,1] ⊇ [e^-1,e^1]', contains(sb.intervalEval(P('exp(x)'), { x: { min: -1, max: 1 } }), Math.exp(-1), Math.exp(1)), fx(sb.intervalEval(P('exp(x)'), { x: { min: -1, max: 1 } })));
chk('intervalEval(sqrt x) @[1,4] ⊇ [1,2]', contains(sb.intervalEval(P('sqrt(x)'), { x: { min: 1, max: 4 } }), 1, 2), fx(sb.intervalEval(P('sqrt(x)'), { x: { min: 1, max: 4 } })));
chk('intervalEval(x^2-2) @[-3,3] 仍 sound(⊇[-2,7])', contains(sb.intervalEval(P('x^2-2'), { x: { min: -3, max: 3 } }), -2, 7), fx(sb.intervalEval(P('x^2-2'), { x: { min: -3, max: 3 } })));

console.log('===== B. 区间雅可比（Krawczyk 认证的输入）=====');
{
  const J = sb._intervalJacobian([P('x^2-2')], ['x'], { x: { min: -3, max: 3 } }, [0]);
  const c = J && J[0] && J[0][0];
  chk('d/dx[x^2-2] @[-3,3] == [-6,6]（多项式）', c && Math.abs(c.min + 6) < 1e-6 && Math.abs(c.max - 6) < 1e-6, fx(c));
}
{
  const J = sb._intervalJacobian([P('sin(x)-0.5')], ['x'], { x: { min: -2, max: 2 } }, [0]);
  const c = J && J[0] && J[0][0];
  chk('d/dx[sin(x)-0.5]=cos(x) @[-2,2] ⊇ [-cos2,1]（超越，P0-2 修复）', contains(c, -Math.cos(2), 1), fx(c));
}

console.log('===== C. _newtonRefine（P0-1 修复）=====');
{
  const r = sb._newtonRefine([P('x^2-2')], ['x'], [1.5], { x: { min: -3, max: 3 } });
  chk('_newtonRefine(x^2-2, 1.5)→√2', !!r && Math.abs(r[0] - Math.SQRT2) < 1e-6, r ? '[' + r.map(v => v.toFixed(6)).join(', ') + ']' : 'null(旧BUG)');
}
{
  const r = sb._newtonRefine([P('sin(x)')], ['x'], [3.0], { x: { min: -4, max: 4 } });
  chk('_newtonRefine(sin x, 3.0)→π', !!r && Math.abs(r[0] - Math.PI) < 1e-6, r ? '[' + r.map(v => v.toFixed(6)).join(', ') + ']' : 'null(旧BUG)');
}

console.log('===== D. _globalBranchCertify（全局穷尽性，P0-1 让 complete 可信）=====');
{
  const g = sb._globalBranchCertify([P('x^2-2')], ['x'], { x: [-3, 3] }, { timeMs: 4000, budget: 2e5, minWidth: 1e-6 });
  const n = g ? g.solutions.length : 0;
  chk('_globalBranchCertify(x^2-2): 2 解且 complete=true（旧BUG: 0解却 complete=true）', n === 2 && g.complete, `${n} 解, complete=${g ? g.complete : '?'}, residual=${g ? g.residualBoxes.length : '?'}`);
}
{
  // sin(x)=0 在 [-4,4] 有 3 根(-π,0,π)。0 根恰落在二分中点 → 退化盒残余（sound 诚实，不假证）。
  const g = sb._globalBranchCertify([P('sin(x)')], ['x'], { x: [-4, 4] }, { timeMs: 4000, budget: 5e5, minWidth: 1e-6 });
  const vals = g ? g.solutions.map(s => s.values[0]).sort((a, b) => a - b) : [];
  const hasPi = vals.some(v => near(v, Math.PI, 1e-3));
  const hasNegPi = vals.some(v => near(v, -Math.PI, 1e-3));
  chk('_globalBranchCertify(sin x): 至少含 -π、π 两根且诚实 complete=false', g && vals.length >= 2 && hasPi && hasNegPi && g.complete === false,
      `解=${vals.map(v => v.toFixed(4))}, complete=${g ? g.complete : '?'}, residual=${g ? g.residualBoxes.length : '?'}`);
}

console.log('===== E. 端到端 solve（仅终止用例；超越单变量 solve 挂起为独立既有缺陷）=====');
for (const [eqs, vns, expect] of [[['x^2-4'], ['x'], 2], [['x^2+y^2-25', 'x-y-1'], ['x', 'y'], 2]]) {
  try {
    const r = sb.solve(eqs, vns, 6);
    const sols = (r.solutions || []).filter(s => s.values);
    chk(`solve(${eqs.join(';')})`, sols.length === expect && (sols[0] || {}).tier === 'proven', `→ ${sols.length}/${expect} 解, tier=${(sols[0] || {}).tier || '?'}`);
  } catch (e) { chk(`solve(${eqs.join(';')})`, false, '异常 ' + e.message); }
}

console.log(`\n===== 合计: PASS=${pass}  FAIL=${fail} =====`);
process.exit(fail === 0 ? 0 : 1);
