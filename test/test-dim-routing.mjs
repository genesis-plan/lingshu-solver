// 维度路由专项（2026-10-05）
//
// 背景：变量数硬约束 n ≤ 6（suan3 强制），「n=1..6」只有 6 种取值。
//   本测试锁死 pipeline/dimroute.js 那张声明式路由表的行为，分两半：
//     ① 表本身：每种 (n, m, 线性?) 形状下哪些算子被保留 —— 纯表断言，快；
//     ② 端到端：真实求解题在每维下走通、结论合法、解是真解 —— 慢但防回归。
//
// 为什么要单独写这个测试（而不是靠现有 17 阶段隐式覆盖）：
//   路由表做的是**减法**（skip）。skip 掉一个本该跑的算子 = 可能少解 =
//   数学正确性事故，而这类事故**不抛异常、只表现为「解变少了」**。
//   现有测试大多只看单题结果，看不到「哪个算子被跳了」，
//   所以路由表的一处误改可能悄悄让某个维度少解而没人发现。
//   本测试把「跳过清单」变成显式可断言的事实。

import * as sb from '../dist/lingshu.mjs';

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (typeof name !== 'string') throw new Error('ok(cond, name) 参数顺序被破坏：name=' + String(name));
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
};

// ─────────────────────────────────────────────────────────────
// 1. 路由表本身：每维的主算子链
// ─────────────────────────────────────────────────────────────
console.log('── 1. 维度路由表：n=0..6 每维保留的算子 ──');

const prof = sb._dimRouteProfile();
const shape = (n, m, lin, poly) => prof.find(r => r.n === n && r.m === m && r.linear === !!lin && r.polynomial === !!poly);

ok(Array.isArray(prof) && prof.length > 0, 'profile 可导出且非空', String(prof && prof.length));

// ① 一元专属算子必须**只**在 n=1 出现（这是「按变量数选算子」最核心的断言）
{
  const univ = ['suan20', 'suan22', 'suan51', 'suan55', 'suan58'];
  let leak = 0;
  const s11 = shape(1, 1, false, false);
  let appearAtN1 = 0;
  for (const r of prof) {
    for (const id of univ) {
      const inList = r.operators.includes(id);
      if (inList && r.n !== 1) leak++;
      if (inList && r.n === 1 && r.m === 1) appearAtN1++;
    }
  }
  ok(leak === 0, '一元专属算子绝不出现在 n≠1 的形状里', '泄漏 ' + leak + ' 处');
  // 断言用「n=1,m=1 这一行是否 5 个全在」而不是「累计出现次数 = 5」
  //   （原写法数的是 (n=1,m=1) × (lin∈{0,1}) × (poly∈{0,1}) = 4 行的出现次数，
  //    所以期望值写成 5 永远对不上——这是断言自身的计数错误，不是引擎问题）
  const missingIn11 = univ.filter(id => !(s11 && s11.operators.includes(id)));
  ok(missingIn11.length === 0,
    'n=1,m=1 时一元专属算子全部保留（5/5）',
    '缺 ' + missingIn11.join(','));
}

// ② suan59（结式）只在 n=2 / (n=3 且 m=3)
{
  const bad = prof.filter(r => r.operators.includes('suan59')
    && !(r.n === 2 || (r.n === 3 && r.m === 3)));
  ok(bad.length === 0, 'suan59 只在 n=2 或三元方阵出现', '越界 ' + bad.length + ' 个形状');
  const s2 = shape(2, 2, false, true);
  ok(!!s2 && s2.operators.includes('suan59'), 'n=2,m=2 保留 suan59');
}

// ③ suan60（精确线性栈）只在 3..6 元且线性
{
  const bad = prof.filter(r => r.operators.includes('suan60') && !(r.n >= 3 && r.n <= 6 && r.linear));
  ok(bad.length === 0, 'suan60 只在 3≤n≤6 且线性时出现', '越界 ' + bad.length + ' 个形状');
  const okLin = shape(4, 4, true, false);
  const badLin = shape(4, 4, false, true);
  ok(okLin && okLin.operators.includes('suan60'), 'n=4 线性 ⇒ 保留 suan60');
  ok(badLin && !badLin.operators.includes('suan60'), 'n=4 非线性 ⇒ 跳过 suan60');
}

// ④ suan61（同伦）只在 3..6 元方阵非线���多项式
{
  const bad = prof.filter(r => r.operators.includes('suan61')
    && !(r.n >= 3 && r.n <= 6 && r.m === r.n && !r.linear && r.polynomial));
  ok(bad.length === 0, 'suan61 只在 3≤n≤6 方阵非线性多项式出现', '越界 ' + bad.length + ' 个形状');
  const p3 = shape(3, 3, false, true);
  const notSquare = shape(3, 2, false, true);
  ok(p3 && p3.operators.includes('suan61'), 'n=3,m=3 非线性多项式 ⇒ 保留 suan61');
  ok(notSquare && !notSquare.operators.includes('suan61'), 'n=3,m=2（非方阵）⇒ 跳过 suan61');
}

// ⑤ n=0 只允许矛盾检测类，不允许任何求解类
{
  const s0 = shape(0, 1, false, false);
  const solvers = (s0 ? s0.operators : []).filter(id => ['suan20','suan22','suan51','suan55','suan58','suan59','suan60','suan61'].includes(id));
  ok(solvers.length === 0, 'n=0 时不含任何求解类算子', '泄漏 ' + solvers.join(','));
  ok(s0 && s0.operators.includes('suan10'), 'n=0 保留常量矛盾检测 suan10');
}

// ⑥ 表的默认方向是「跑」不是「跳」：任一形状保留的算子数不应为 0
{
  const empty = prof.filter(r => r.operators.length === 0);
  ok(empty.length === 0, '没有任何形状被裁成空算子集（表的方向是保守的）', '空集 ' + empty.length + ' 个');
}

// ─────────────────────────────────────────────────────────────
// 2. 幂等性：重复调用结果必须相同（路由表可能被多处触发）
// ─────────────────────────────────────────────────────────────
console.log('\n── 2. 幂等性与 fail-open ──');
{
  const st = {
    varNames: ['x', 'y', 'z'],
    equations: [{ type: 'num', value: 1 }],
    eqFeatures: { allLinear: false },
    isPolynomial: true,
  };
  const a = sb._routeByDimension(st);
  const snap1 = JSON.stringify(st.skipOperators);
  const b = sb._routeByDimension(st);
  const snap2 = JSON.stringify(st.skipOperators);
  ok(snap1 === snap2, '重复调用不改变 skipOperators（幂等）', snap1 + ' vs ' + snap2);
  ok(Array.isArray(a) && Array.isArray(b) && a.length === b.length, '两次决策条目数一致');
  ok(!!st.dimRouteKey && st.dimRouteKey.n === 3, 'state.dimRouteKey 记录了 n=3', JSON.stringify(st.dimRouteKey));

  // fail-open：eqFeatures 缺失（无法判定线性）时不得误跳
  const st2 = { varNames: ['x', 'y', 'z'], equations: [{ type: 'num', value: 1 }] };
  sb._routeByDimension(st2);
  ok(st2.dimRouteKey.linKnown === false, 'eqFeatures 缺失时 linKnown=false（区分「未知」与「非线性」）');
  ok(!st2.skipOperators.suan60, '线性性未知时不跳 suan60（fail-open，不误杀）', JSON.stringify(st2.skipOperators));
  // 而「确知为非线性」时必须跳（这才是路由表的正作用）
  const st3 = {
    varNames: ['x', 'y', 'z'], equations: [{ type: 'binop', op: '-', left: { type: 'num', value: 0 }, right: { type: 'num', value: 0 } }],
    eqFeatures: { allLinear: false }, isPolynomial: true,
  };
  sb._routeByDimension(st3);
  ok(!!st3.skipOperators.suan60, '确知非线性时跳 suan60（交给同伦/其他路径）');
  // suan61 的前提是**方阵**（m === n）。这里必须给 3 个方程，否则它跳掉是对的
  const st4 = {
    varNames: ['x', 'y', 'z'], equations: [0, 1, 2].map(() => ({ type: 'num', value: 1 })),
    eqFeatures: { allLinear: false }, isPolynomial: true,
  };
  sb._routeByDimension(st4);
  ok(!st4.skipOperators.suan61, 'n=3,m=3 方阵非线性多项式 ⇒ 不跳 suan61', JSON.stringify(st4.skipOperators));
  // 反例：非方阵时必须跳（m=2 ≠ n=3）
  const st5 = {
    varNames: ['x', 'y', 'z'], equations: [0, 1].map(() => ({ type: 'num', value: 1 })),
    eqFeatures: { allLinear: false }, isPolynomial: true,
  };
  sb._routeByDimension(st5);
  ok(!!st5.skipOperators.suan61, 'n=3,m=2（非方阵）⇒ 跳 suan61');
}

// ─────────────────────────────────────────────────────────────
// 3. 端到端：每维真跑一遍，验证解是真解（不是「跑通就算」）
// ─────────────────────────────────────────────────────────────
console.log('\n── 3. 端到端：n=1..6 每维都能出真解 ──');

const residualOf = (eqs, vals) => {
  // 独立回代：绕开引擎内部的 residual 字段，用文本重新解析求值
  const P = sb._LS_PROTECTED_NAMES;
  const f = (s) => {
    const k = s.indexOf('=');
    const a = k < 0 ? s : s.slice(0, k);
    const b = k < 0 ? '0' : s.slice(k + 1);
    return sb.evalAST(sb.parse(sb.tokenize(sb.fuzzyFix(a, P), P)), vals);
  };
  let worst = 0;
  for (const e of eqs) {
    const k = e.indexOf('=');
    const lhs = sb.evalAST(sb.parse(sb.tokenize(sb.fuzzyFix(k < 0 ? e : e.slice(0, k), P), P)), vals);
    const rhs = k < 0 ? 0 : sb.evalAST(sb.parse(sb.tokenize(sb.fuzzyFix(e.slice(k + 1), P), P)), vals);
    const d = Math.abs(lhs - rhs);
    if (isFinite(d) && d > worst) worst = d;
  }
  void f;
  return worst;
};

const E2E = [
  { n: 1, eqs: ['x^3-6x^2+11x-6=0'], want: 3 },
  { n: 1, eqs: ['x^2-4=0'], want: 2 },
  { n: 2, eqs: ['xy=6', 'x+y=5'], want: 2 },
  { n: 2, eqs: ['2x+3y=13', 'x-y=1'], want: 1 },
  { n: 3, eqs: ['x+y+z=6', 'xy+yz+zx=11', 'xyz=6'], want: 6 },
  { n: 3, eqs: ['2x+y-z=1', 'x+2y+z=5', 'x-y+z=3'], want: 1 },
  { n: 4, eqs: ['x+y+z+w=10', 'x-y+z-w=0', 'x+2y-z+w=3', '2x-y+z-2w=-1'], want: 1 },
  // ⚠ n=5 这组**不是随手编的**：5 个随机方程在 5 个未知数上相容的概率极低
  //   （实测前两版随机系数都被 SymPy linsolve 判为 EmptySet，rank(A)=4 < rank([A|b])=5）。
  //   本组是「先定真解 (1,2,3,4,5)，再反解系数」构造出来的相容组，
  //   SymPy 核验：rank(A)=5=rank([A|b])、linsolve = {(1,2,3,4,5)}。
  { n: 5, eqs: ['x+y+z+w+v=15', 'x+2y+z+w+v=17', '2x+y+3z+w+2v=27', 'x-y+z-w+v=3', '3x+2y+z-w+2v=16'], want: 1 },
  // 反例护栏：相容性差一行的 5 元组必须被**精确秩判定**判成无解（不是给近似解）
  { n: 5, eqs: ['x+y+z+w+v=20', 'x-y+z-w+v=4', 'x+2y-z+w-v=6', '2x-y+z-2w+v=8', 'x+y-z+w-v=9'], want: 0, noSolution: true },
];

for (const c of E2E) {
  const r = sb.solve(c.eqs);
  const vn = r.varNames || [];
  const sols = r.solutions || [];
  const tag = 'n=' + c.n + ' ' + JSON.stringify(c.eqs[0]).slice(0, 28);
  ok(vn.length === c.n, tag + ' ⇒ 变量数正确', 'got ' + vn.length);
  ok(sols.length === c.want, tag + ' ⇒ 解个数 = ' + c.want, 'got ' + sols.length);
  // 每个解独立回代过原方程（这是「是真解」的判据，不是引擎自报）
  let worst = 0, allFinite = true;
  for (const s of sols) {
    const vals = {};
    vn.forEach((v, i) => { vals[v] = s.values[i]; if (!isFinite(s.values[i])) allFinite = false; });
    const d = residualOf(c.eqs, vals);
    if (isFinite(d) && d > worst) worst = d;
  }
  ok(allFinite, tag + ' ⇒ 所有解坐标有限');
  ok(worst < 1e-8, tag + ' ⇒ 每个解回代原方程残差 < 1e-8', 'worst=' + worst.toExponential(2));
  ok(['全部解', '部分解', '无解', '计算资源不足'].includes(r.conclusion),
    tag + ' ⇒ 结论是四态之一', String(r.conclusion));
  if (c.noSolution) {
    // 无解必须**带严格证明标记**才允许这么说（fail-closed 的核心）
    ok(r.conclusion === '无解', tag + ' ⇒ 矛盾组判「无解」', String(r.conclusion));
    ok(r.provenEmpty === true || r.certification && r.certification.emptyProof,
      tag + ' ⇒ 无解带严格证明标记（非「没找到」）',
      'provenEmpty=' + String(r.provenEmpty));
  }
}

// ─────────────────────────────────────────────────────────────
// 4. 欠定维（m < n）：必须标 truncated，绝不谎称完备
// ─────────────────────────────────────────────────────────────
console.log('\n── 4. 欠定维（m<n）：只给代表解必须标 truncated ──');
{
  const cases = [
    ['x+y=3'],
    ['x+y+z=6'],
    ['x+y+z+w+v+u=21'],
    ['x+y+z+w=10', 'x-y+z-w=0'],
  ];
  for (const eqs of cases) {
    const r = sb.solve(eqs);
    const n = (r.varNames || []).length, m = eqs.length;
    if (m >= n) continue;
    ok(r.truncated === true,
      'n=' + n + ',m=' + m + ' ⇒ truncated=true（正维解集不可完备）', String(r.truncated));
    ok(r.conclusion !== '全部解',
      'n=' + n + ',m=' + m + ' ⇒ 不得报「全部解」', String(r.conclusion));
    // fail-closed 的文案纪律：不得给「资源不足」这种假指令（重试无用）
    const warnTxt = JSON.stringify(r.warnings || []);
    ok(warnTxt.indexOf('资源上限中止') < 0,
      'n=' + n + ',m=' + m + ' ⇒ 不得误报「资源上限中止」（真因是欠定，重试无用）', warnTxt.slice(0, 160));
    ok(warnTxt.indexOf('无穷') >= 0 || warnTxt.indexOf('正维') >= 0 || warnTxt.indexOf('无限') >= 0,
      'n=' + n + ',m=' + m + ' ⇒ warning 说清「解集无穷」', warnTxt.slice(0, 160));
  }
}

// ─────────────────────────────────────────────────────────────
// 4b. fail-closed 交叉核对：矛盾组必须说「无解」，欠定组必须说「部分解」
//     这两条混起来就是最危险的谎报（把没算完说成无解 / 把无穷解说成算完了）
// ─────────────────────────────────────────────────────────────
console.log('\n── 4b. 交叉核对：矛盾≠欠定（防最危险的谎报）──');
{
  // 矛盾组（SymPy 核验 rank 4 < 5，linsolve = EmptySet）
  const c = sb.solve(['x+y+z+w+v=20', 'x-y+z-w+v=4', 'x+2y-z+w-v=6', '2x-y+z-2w+v=8', 'x+y-z+w-v=9']);
  ok(c.conclusion === '无解', '矛盾的 5 元方阵 ⇒ 「无解」', String(c.conclusion));
  // 欠定组
  const u = sb.solve(['x+y+z=6']);
  ok(u.conclusion !== '无解', '欠定 3 元 ⇒ 不得说「无解」', String(u.conclusion));
  ok(u.solutions.length === 1 && isFinite(u.solutions[0].values[0]), '欠定 3 元仍给出真代表解');
}

// ─────────────────────────────────────────────────────────────
// 5. 维度上限：n>6 必须硬拒（suan3），不得静默降维
// ─────────────────────────────────────────────────────────────
console.log('\n── 5. 硬上限 n>6 必须拒收 ──');
{
  // 契约口径：dist 层 solve **返回**错误对象（error=OVER_LIMIT）而非抛异常，
  //   抛异常的是 MCP 服务层（对外协议）。两条路径都要守住「拒收」语义。
  const r = sb.solve(['a+b+c+d+e+f+g=10'], ['a','b','c','d','e','f','g'], 6);
  ok(r && r.error === 'OVER_LIMIT', '7 变量被拒（error=OVER_LIMIT）', JSON.stringify(r && r.error));
  ok(/7/.test(String(r.message || '')) && /6/.test(String(r.message || '')),
    '拒收提示同时含实际变量数 7 与上限 6', String(r.message));
  ok((r.solutions || []).length === 0, '拒收时不得给出任何解');
  ok(r.conclusion === '计算资源不足',
    '拒收结论落在四态内的「计算资源不足」（无资格判断有解/无解）', String(r.conclusion));
}

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail === 0 ? 0 : 1);