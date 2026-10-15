// 输出契约回归：result.varNames 必须在每条返回路径上都存在
//
// 2026-10-15 实测缺陷（网页「标题4」圆×双曲线，用户报"例子4出错、没给解"）：
//   二元 Sylvester 结式消元闭式路径组装 state.result 时漏写 varNames
//   ⇒ result.varNames === undefined ⇒ 页面两处可见故障：
//     ① `var outVars = result.varNames || []` 得空数组 ⇒ 渲染解值的循环一次都不跑
//        ⇒ 页面只显示"解1/解2/解3/解4"标签而没有数值（用户读作"没给解"）；
//     ② 残差复算 _residualAtDisplayed(values, eqLines, []) 因 varNames 为空回代出 NaN
//        ⇒ 返回 null ⇒ 页面误报"无法独立复算残差/这些点不是严格根"的假警报，
//           而这批解的 backwardError 实为 ~1e-16（引擎已认证 proven）。
//
// 本测试锁的是**输出契约**（不是某个路径的实现）：只要有任一路径漏写 varNames 就红。
// 运行：node test/test-result-varnames.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const core = require('../solver-core.js');
const sb = core.raw();

let pass = 0, fail = 0;
const chk = (name, ok, detail) => {
  ok ? pass++ : fail++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? '  ' + detail : ''}`);
};

// 六个网页示例 + 两个专门打「结式消元/三元结式」路径的用例
const CASES = [
  { id: '例1 x^2=4', eq: ['x^2 = 4'], vars: ['x'] },
  { id: '例2 6元三对角线性', eq: ['x + y = 3', 'x + 2*y + z = 8', 'y + 2*z + a = 12', 'z + 2*a + b = 16', 'a + 2*b + c = 20', 'b + 2*c = 17'], vars: ['x', 'y', 'z', 'a', 'b', 'c'] },
  { id: '例3 平行矛盾无解', eq: ['x + y = 3', 'x + y = 5'], vars: ['x', 'y'] },
  { id: '例4 圆×双曲线（本次缺陷）', eq: ['x*x + y*y - 4 = 0', 'x*y - 1 = 0'], vars: ['x', 'y'] },
  { id: '例5 高频多解', eq: ['sin(20*x) = 0.5', 'sin(20*y) = 0.5'], vars: ['x', 'y'], dom: { x: [-30, 30], y: [-30, 30] } },
  { id: '例6 欠定推荐解', eq: ['x + y = 3'], vars: ['x', 'y'] },
  { id: '附加 三元结式消元', eq: ['x + y + z = 6', 'x*y + y*z + z*x = 11', 'x*y*z = 6'], vars: ['x', 'y', 'z'] },
];

console.log('===== A. varNames 必须在每条路径存在且非空 =====');
for (const c of CASES) {
  const r = sb.solve(c.eq, [], 6, c.dom);
  const vn = r && r.varNames;
  chk(`${c.id}：result.varNames 存在且非空`, Array.isArray(vn) && vn.length > 0, JSON.stringify(vn));
  if (Array.isArray(vn) && vn.length) {
    chk(`${c.id}：varNames 与方程实际变量一致`, JSON.stringify(vn) === JSON.stringify(c.vars), `got=${JSON.stringify(vn)} want=${JSON.stringify(c.vars)}`);
  }
  // 解向量的长度必须与 varNames 对齐（否则页面按下标渲染会越界/错位）
  if (r && Array.isArray(r.solutions) && r.solutions.length && Array.isArray(vn)) {
    const bad = r.solutions.filter(s => !Array.isArray(s.values) || s.values.length !== vn.length);
    chk(`${c.id}：每个解的 values 长度 == varNames 长度`, bad.length === 0, bad.length ? `异常解数=${bad.length}` : `${r.solutions.length} 个解 × ${vn.length} 变量`);
  }
}

console.log('\n===== B. 页面残差复算契约（varNames 为空会导致假警报，必须不发生）=====');
{
  // 页面 displayResult 用的就是这条：_residualAtDisplayed(全精度值, eqLines, varNames)
  const eq = ['x*x + y*y - 4 = 0', 'x*y - 1 = 0'];
  const r = sb.solve(eq, [], 6, undefined);
  const vn = r.varNames || [];
  const rrs = r.solutions.map(s => sb._residualAtDisplayed(s.values, eq, s.varNames || vn));
  chk('例4：残差复算不得返回 null（null ⇒ 页面误报"不是严格根"）', rrs.every(v => typeof v === 'number' && isFinite(v)), JSON.stringify(rrs));
  const mx = Math.max(...rrs.filter(v => typeof v === 'number' && isFinite(v)));
  chk('例4：全精度复算残差 < 1e-6（页面可信说明判据）', mx < 1e-6, 'max=' + mx);
}

console.log(`\n通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);
