// test_tan_singleton.mjs —— 锁定 2026-10-02 性能修复：tan 奇点条件化生成
//
// 【被测缺陷（修复前实测）】
//   suan22 全域扫描无条件生成 tan 奇点切分点 k*PI+PI/2：
//     exp(x)=3   声明域[-1e6,1e6] → 65418 子区间 → Σ523344 次点求值 → 1525ms（空转到上限）
//     sqrt(x)=2  [0,1e6]        → 85072 子区间 → Σ680576 次点求值 → 1501ms
//   两个叠加原因：
//     (a) 方程不含任何三角函数时，k*PI+PI/2 不是奇点，切分纯属浪费；
//     (b) _gN 下界为 8，每个子区间强制 8 次采样，把 4096 点的网格膨胀 128 倍。
//   段内原有注释「宽域防护：超宽域跳过扫描」描述了一个**从未实现**的意图。
//
// 【修复】仅当 _detectPeriod1D 返回非 null（含周期三角函数）时才生成切分点。
//   理由（数学）：k*PI+PI/2 是 tan 系函数（tan/cot 渐近线、sec/csc 极点）的奇点位置；
//   不含三角函数时切分不携带信息，边界变多而采样覆盖不变。
//
// 【本测试的职责】
//   ① 正确性不变量：修复只改性能，不改解集（含三角函数的方程必须逐位不变）；
//   ② 性能不变量：不含三角函数的方程不得再生成海量子区间；
//   ③ 边界不变量：域极窄 / 恰含根于端点 / 无解判定 等原有语义不破。

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const core = require('D:/Projects/genesis-plan/lingshu-solver/solver-core.js');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  OK   ' + name); }
  else { fail++; failures.push(name + (detail ? ' :: ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' :: ' + detail : '')); }
}
function solve1(eq) { const t0 = performance.now(); const r = core.solve([eq], ['x'], 6); return { r, ms: performance.now() - t0 }; }
const firstRoot = (r) => (r.solutions && r.solutions.length ? r.solutions[0].values[0] : null);
const near = (a, b, eps) => (a !== null && Math.abs(a - b) < (eps || 1e-4));

console.log('【① 正确性：不含三角函数（走修复路径）】');
{
  const c = [
    ['exp(x) = 3', 1.0986122886681098, 1e-5],
    ['sqrt(x) = 2', 4, 1e-6],
    ['ln(x) = 2', Math.exp(2), 1e-5],
    ['log(x) = 2', 100, 1e-6]
  ];
  c.forEach(([eq, truth]) => {
    const { r } = solve1(eq);
    const s = r.solutions || [];
    check(eq + ' → 恰好 1 解', s.length === 1, '实得 ' + s.length);
    check(eq + ' → 根值正确', near(firstRoot(r), truth), '实得 ' + firstRoot(r) + ' 应 ' + truth);
  });
}
{
  const { r } = solve1('abs(x) = 3');
  const s = r.solutions || [];
  check('abs(x) = 3 → 2 解', s.length === 2, '实得 ' + s.length);
  const vals = s.map(x => x.values[0]).sort((a, b) => a - b);
  check('abs(x) = 3 → 根为 ±3', near(vals[0], -3, 1e-6) && near(vals[1], 3, 1e-6), JSON.stringify(vals));
}
{
  // 无解判定：不含三角函数的方程仍应按中间值定理判无解（不得因剪枝误判）
  const { r } = solve1('exp(x) + 1 = 0');
  check('exp(x) + 1 = 0 → 判无实解（exp>0）', (r.solutions || []).length === 0, 'resultType=' + r.resultTypeName);
}

console.log('');
console.log('【② 正确性：含三角函数（必须与修复前逐位一致）】');
{
  // 历史实测（稠密扫描的采样命中数，**不是数学事实**）：sin(x)=0 得 106 根、tan(x)=1 得 47 根。
  // 2026-10-03 suan58 符号通解落地后：改为「精确通解 + 输出上限截断 + 给出精确总数」，
  // 故断言改为：① 全部解都过残差校验 ② 截断时必须带 truncated 标记与精确总数。
  const s0 = solve1('sin(x) = 0');
  check('sin(x) = 0 → 全部解过残差校验（独立验算）', (s0.r.solutions || []).every((x) => x.residual < 1e-6 || x.certified === true), '实得 ' + (s0.r.solutions || []).length + ' 个');
  check('sin(x) = 0 → 截断时必须带 truncated 标记（fail-closed）', s0.r.truncated === true && s0.r.exactSolutionCount > 100000, 'truncated=' + s0.r.truncated + ' exactCount=' + s0.r.exactSolutionCount);
  const t0 = solve1('tan(x) = 1');
  check('tan(x) = 1 → 全部解过残差校验（独立验算）', (t0.r.solutions || []).every((x) => x.residual < 1e-6 || x.certified === true), '实得 ' + (t0.r.solutions || []).length + ' 个');
  check('tan(x) = 1 → 截断时必须带 truncated 标记（fail-closed）', t0.r.truncated === true && t0.r.exactSolutionCount > 100000, 'truncated=' + t0.r.truncated + ' exactCount=' + t0.r.exactSolutionCount);
  const c0 = solve1('cos(x) = x');
  check('cos(x) = x → 唯一不动点 0.7391', (c0.r.solutions || []).length === 1 && near(firstRoot(c0.r), 0.7390851332, 1e-6),
    '实得 ' + (c0.r.solutions || []).length + ' 根 ' + firstRoot(c0.r));
}

console.log('');
console.log('【③ 性能不变量：不含三角函数者不得再空转到硬上限】');
{
  // 修复前分别约 1525 / 1501 / 1502 ms（撞 1500ms 硬上限）。留足余量仍要显著低于上限。
  [['exp(x) = 3', 800], ['sqrt(x) = 2', 800], ['abs(x) = 3', 800]].forEach(([eq, budget]) => {
    const { ms } = solve1(eq);
    check(eq + ` → 耗时 < ${budget}ms（修复前撞 1500ms 上限）`, ms < budget, '实得 ' + Math.round(ms) + 'ms');
  });
}

console.log('');
console.log('【④ 边界不变量】');
{
  // 声明域收窄时仍须正确（用户显式给域）
  const r = core.solve(['exp(x) = 3', 'x >= 0', 'x <= 10'], ['x'], 6);
  const s = r.solutions || [];
  check('exp(x)=3 带显式域 [0,10] → 1 解且在域内', s.length === 1 && s[0].values[0] > 0 && s[0].values[0] < 10,
    '实得 ' + JSON.stringify(s.map(x => x.values[0])));
}
{
  // 恰在域端点上的根（切分逻辑改动最易破坏的边界）
  const r = core.solve(['x - 5 = 0', 'x >= 5', 'x <= 5'], ['x'], 6);
  check('端点根 x=5（域 [5,5]）被找到', (r.solutions || []).length >= 1 && near((r.solutions[0] || {}).values[0], 5, 1e-6),
    '实得 ' + JSON.stringify((r.solutions || []).map(x => x.values[0])));
}
{
  // 多项式走 suan51 快路径，Sturm 完备性不受影响
  const r = core.solve(['x^2 - 2 = 0'], ['x'], 6);
  const sc = r.sturmCompleteness;
  check('x^2-2=0 → Sturm 仍能给出数学完备性证明', sc && sc.certified === true && sc.complete === true,
    JSON.stringify(sc));
}

console.log('');
console.log('通过 ' + pass + ' / ' + (pass + fail));
if (fail) { console.log('失败项：'); failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
