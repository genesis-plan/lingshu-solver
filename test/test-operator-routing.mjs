// 算子适用性路由测试：验证「只跳数学前提明确不成立者」
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const core = require('D:/Projects/genesis-plan/lingshu-solver/solver-core.js');
const sb = core.raw();

let pass = 0, fail = 0;
const ok = (c, n, e) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } };
const P = (s) => sb.parse(sb.tokenize(s));

console.log('=== 算子适用性路由 ===\n');

// T1 线性 → 必须照跑 LP Narrowing
{
  const st = { varNames: ['x', 'y'], equations: [P('x + y - 3'), P('x - y - 1')], skipOperators: {} };
  sb._routeOperators(st);
  ok(!st.skipOperators.suan34, '全线性系统：suan34 不跳过（照跑单纯形）', st.skipOperators);
  ok(!st.operatorRouting || !st.operatorRouting.suan34, '全线性：无跳过记录', st.operatorRouting);
}

// T2 非线性 → 必须跳过
{
  const st = { varNames: ['x', 'y'], equations: [P('x * y - 6'), P('x + y - 5')], skipOperators: {} };
  sb._routeOperators(st);
  ok(st.skipOperators.suan34 === true, '非线性系统：suan34 跳过', st.skipOperators);
  ok(st.operatorRouting && /非线性/.test(st.operatorRouting.suan34), '跳过原因如实记录', st.operatorRouting);
}

// T3 混合（线性+非线性）→ 跳过
{
  const st = { varNames: ['x', 'y'], equations: [P('x + y - 3'), P('x * y - 6')], skipOperators: {} };
  sb._routeOperators(st);
  ok(st.skipOperators.suan34 === true, '线性+非线性混合：suan34 跳过', st.skipOperators);
}

// T4 含超越函数 → 跳过（^ 判非线性）
{
  const st = { varNames: ['x'], equations: [P('cos(x) - x')], skipOperators: {} };
  sb._routeOperators(st);
  ok(st.skipOperators.suan34 === true, '超越方程：suan34 跳过', st.skipOperators);
}

// T5 无法判定（方程非 AST）→ 保守不跳
{
  const st = { varNames: ['x'], equations: ['x^2 = 4'], skipOperators: {} }; // 字符串而非 AST
  sb._routeOperators(st);
  ok(!st.skipOperators.suan34, '无法判定（字符串方程）⇒ 保守不跳（宁浪费不丢解）', st.skipOperators);
}

// T6 幂等：重复调用结果一致（分支定界递归会多次进入 _runPipeline）
{
  const st = { varNames: ['x'], equations: [P('x^2 - 4')], skipOperators: {} };
  sb._routeOperators(st); const a = st.skipOperators.suan34;
  sb._routeOperators(st); const b = st.skipOperators.suan34;
  ok(a === b, '路由幂等（递归重入结果一致）', { a, b });
}

// T7 关键回归：解的正确性完全不变
console.log('\n--- 端到端：解的正确性不受路由影响 ---');
{
  const r = core.solve(['x + y = 3', 'x - y = 1'], null, 6);
  const s = (r.solutions || []);
  const hit = s.some(v => Math.abs(v.values[0] - 2) < 1e-6 && Math.abs(v.values[1] - 1) < 1e-6);
  ok(hit, '线性系统 x+y=3,x-y=1 ⇒ (2,1) 仍解出', s.map(v => v.values));
}
{
  const r = core.solve(['x * y = 6', 'x + y = 5'], null, 6);
  const s = (r.solutions || []);
  const hit = s.some(v => Math.abs(v.values[0] - 3) < 1e-6 && Math.abs(v.values[1] - 2) < 1e-6)
           && s.some(v => Math.abs(v.values[0] - 2) < 1e-6 && Math.abs(v.values[1] - 3) < 1e-6);
  ok(hit, '非线性 x*y=6,x+y=5 ⇒ (3,2),(2,3) 仍解出', s.map(v => v.values));
}
{
  const r = core.solve(['x^2 + y^2 = 4', 'x + y = 2'], null, 6);
  const s = (r.solutions || []);
  ok(s.length === 2, 'circle+line 仍得 2 解（未被 LP 跳过误伤）', s.length);
}
{
  const r = core.solve(['cos(x) = x'], null, 6);
  const s = (r.solutions || []);
  ok(s.length >= 1 && Math.abs(s[0].values[0] - 0.7390851332) < 1e-6, 'cos(x)=x ⇒ 0.7390851332 仍解出', s.map(v => v.values));
}
{
  const r = core.solve(['x^2 = 4'], null, 6);
  const s = (r.solutions || []);
  const n2 = s.filter(v => Math.abs(Math.abs(v.values[0]) - 2) < 1e-6).length;
  ok(n2 === 2, 'x^2=4 ⇒ ±2 两解仍都在（分流定界未丢解）', s.map(v => v.values));
}

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
