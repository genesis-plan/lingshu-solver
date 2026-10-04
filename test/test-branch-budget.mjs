// 分支定界预算护栏 · A/B 对照（2026-10-04）
//
// 为什么需要这个文件：
//   本轮给「子问题」加了减负 —— _subProblem 时把收缩不动点轮次从 6 砍到 2。
//   这类「为了快而少做功」的改动天然有风险：**快了，但可能少解**。
//   而「少解」是本项目最不可接受的失败模式（宁可慢，不可少解）。
//   所以必须有 A/B 护栏：同一批题在开/关减负下解数必须一致，有差异以「关掉减负」为准。
//
// 怎么做到「开关」可控：
//   减负的判据在 scheduler.js 里读 state.solveOpts._subProblem，
//   而 branch.js:228 硬编码给子问题传 `_subProblem:true`。
//   ⇒ 光在 solve() 顶层传参**测不到**（顶层本来就不是子问题），会得到假绿。
//   所以引擎侧加了一个逃生阀 `_noSubProblemTrim`：
//     scheduler.js:  if (_subProblem && !(_noSubProblemTrim) && maxRounds>2) maxRounds=2;
//     branch.js:     沿递归链把 _noSubProblemTrim 透传下去。
//   只有本测试会置它；生产路径永远走减负。
//
// ⚠ 本文件在编写过程中踩到过一次「假失败」，记录在此以免重蹈：
//   五元线性那题一开始断言「应有唯一解 (1.5,−2,8,9,−1.5)」，实测返回 0 解，
//   看着像 suan60 的 P0。真查后发现是【我的题自相矛盾】：
//   第 2 式 a−b+c−d+e−1=0 与第 5 式 a−b+c−d+e−4=0 系数向量完全相同、rhs 不同。
//   我手算时把第 5 式末尾读成了 −e，凭空造了个矛盾系统又"解"出了值。
//   python Fraction 高斯消元（带矛盾行检测）与引擎独立给出同一结论 INCONSISTENT。
//   ⇒ 那题现在留作**负样本**（expectNoSolution），守住「矛盾系统必须仍报 provenEmpty」。
//
// 判定标准（硬）：
//   ① trimOff 的解必须全部出现在 trimOn 里（不许多解 —— 多解是「更全」，不阻塞）
//   ② 若 trimOn 少了任何一个解 ⇒ FAIL，且必须在输出里点名缺哪个
//   ③ 标 expect 的题两侧都要真解出该值（防「都错成 0 解还算一致」）
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const CORE = require.resolve('../solver-core.js');
const P = require(CORE).raw();

// ── 测试批：覆盖会走分支定界的形状（方阵 / 非方阵 / 欠定 / 单变量）──
const CASES = [
  { name: '一元二次（大系数）', eqs: ['x^2-10000000000000=0'], vns: ['x'] },
  { name: '一元三次', eqs: ['x^3-2x-5=0'], vns: ['x'] },
  { name: '二元线性', eqs: ['a+b-10=0', 'a-b-2=0'], vns: ['a', 'b'] },
  { name: '二元非线性（圆与直线）', eqs: ['x^2+y^2-25=0', 'x-y-1=0'], vns: ['x', 'y'] },
  { name: '三元非线性', eqs: ['a+b+c-6=0', 'a*b+b*c+c*a-11=0', 'a*b*c-6=0'], vns: ['a', 'b', 'c'] },
  { name: '四元非线性（对称）', eqs: [
      'a+b+c+d-4=0', 'a*b+b*c+c*d+d*a-4=0',
      'a*b*c+b*c*d+c*d*a+d*a*b-4=0', 'a*b*c*d-1=0'], vns: ['a', 'b', 'c', 'd'] },
  { name: '五元线性', eqs: [
      'a+b+c+d+e-15=0', 'a-b+c-d+e-1=0', 'a+b-c+d-e-2=0',
      'a-b-c+d+e-3=0', 'a-b+c-d+e-4=0'], vns: ['a', 'b', 'c', 'd', 'e'],
    // ⚠⚠ 这组方程是**自相矛盾**的，不是唯一解！第 2 式与第 5 式：
    //     a-b+c-d+e-1=0  和  a-b+c-d+e-4=0
    //   系数向量完全相同（[1,-1,1,-1,1]），常数一个 1 一个 4 ⇒ 互斥 ⇒ 无解。
    //   python Fraction 高斯消元（带矛盾行检测）与引擎独立得出同一结论：
    //   INCONSISTENT / rank=4。引擎报 provenEmpty 是**正确**的。
    //
    //   我第一版把它当「有唯一解 (1.5,-2,8,9,-1.5)」，是因为手算时把第 5 式末尾
    //   读成了 −e（实际是 +e），于是凭空造出一个矛盾系统又"解"出了值。
    //   ⇒ 教训与 2026-10-04 那次「以为 6 元二次漏解」同源：
    //   **断言之前必须先自证测量工具正确**，否则会去"修"一个不存在的问题。
    //
    //   这条留在这里当负样本：引擎对矛盾系统的判定必须【继续是】provenEmpty，
    //   哪天它改成"给个近似解"，本行会红。
    expectNoSolution: true },
  { name: '六元线性', eqs: [
      'x1+x2+x3+x4+x5+x6-21=0',
      'x1-x2+x3-x4+x5-x6-1=0',
      'x1+x2-x3-x4+x5+x6-2=0',
      'x1-x2-x3+x4-x5+x6-3=0',
      'x1-x2+x3-x4-x5+x6-4=0',
      'x1+x2+x3+x4-x5-x6-5=0'], vns: ['x1', 'x2', 'x3', 'x4', 'x5', 'x6'],
    // 非奇异，唯一解 (2.75, 0.75, 5, 4.5, 3.25, 4.75)（python Fraction 核对过）。
    expect: [2.75, 0.75, 5, 4.5, 3.25, 4.75] },
  { name: '欠定（流形，应 truncated）', eqs: ['x-y=0', 'x+y-2=0'], vns: ['x', 'y'], underdetermined: true },
];

function keyOf(r) {
  return (r.solutions || []).map(s => (s.values || []).map(v => (typeof v === 'number' ? v.toPrecision(9) : String(v))).join(','))
    .sort().join(' | ');
}

function run(c, trim) {
  const opts = {};
  if (!trim) opts._noSubProblemTrim = true;    // 见文件头说明：branch.js 沿递归链透传此开关
  const t0 = Date.now();
  let r;
  try {
    r = P.solve(c.eqs.slice(), c.vns.slice(), 6, null, false, opts);
  } catch (e) {
    return { keys: '', ms: Date.now() - t0, thrown: String(e && e.message || e), sols: [] };
  }
  return { keys: keyOf(r), ms: Date.now() - t0, n: (r.solutions || []).length, sols: r.solutions || [], truncated: !!r.truncated, provenEmpty: !!r.provenEmpty };
}

let fail = 0, pass = 0;
console.log('分支定界预算 A/B 护栏（trimOn vs trimOff）');
console.log('判据①：trimOff 的每个解必须在 trimOn 里出现（不许少解）');
console.log('判据②：标了 expect 的题，两侧都必须真解出该值（不许都错成 0 解还"一致"）\n');

for (const c of CASES) {
  // 先跑 off（更贵、更全），再跑 on（减负）
  const off = run(c, false);
  const on = run(c, true);
  const offSet = new Set(off.keys ? off.keys.split(' | ').filter(Boolean) : []);
  const onSet = new Set(on.keys ? on.keys.split(' | ') : []);
  const missing = [...offSet].filter(k => !onSet.has(k));

  let expectBad = '';
  if (c.expect) {
    // 两侧都要命中真解（9 位有效数字比对）
    for (const [tag, r] of [['off', off], ['on', on]]) {
      const hit = r.sols.some(s => c.expect.every((v, i) => Math.abs(s.values[i] - v) < 1e-8));
      if (!hit) expectBad += ` ${tag}未命中真解`;
    }
  }
  if (c.expectNoSolution) {
    // 负样本：矛盾系统必须【继续】被判定为无解。
    //   这类题放进本文件的目的不是测性能，是防「哪天为了少返 0 解而改成瞎给近似解」。
    for (const [tag, r] of [['off', off], ['on', on]]) {
      if (r.sols.length !== 0) expectBad += ` ${tag}对矛盾系统给出了 ${r.sols.length} 个解`;
      if (!r.provenEmpty) expectBad += ` ${tag}未标 provenEmpty`;
    }
  }

  if (missing.length || expectBad) {
    fail++;
    console.log(`  ❌ ${c.name}`);
    if (missing.length) {
      console.log(`     少解 ${missing.length} 个：off 解数=${offSet.size} / on 解数=${onSet.size}`);
      missing.slice(0, 3).forEach(k => console.log(`       缺失: ${k}`));
    }
    if (expectBad) console.log(`     真解断言失败:${expectBad}`);
  } else {
    pass++;
    const same = off.keys === on.keys;
    console.log(`  ✅ ${c.name}：off ${offSet.size} 解 / on ${onSet.size} 解 ${same ? '（完全一致）' : '（on 为 off 的超集，可接受）'}`);
  }
  console.log(`       时间 off=${off.ms}ms on=${on.ms}ms`
    + (on.ms > 0 && off.ms > 0 ? `（on 快 ${(off.ms / on.ms).toFixed(2)}×）` : ''));
}

console.log(`\n通过 ${pass} / 失败 ${fail}`);
if (fail) {
  console.log('\n🔴 若有失败：减负导致了少解。按项目取舍「宁可慢，不可少解」，');
  console.log('   请把 scheduler.js 里的 _subProblem 减负去掉（或收窄到只在 D0 很大时启用）。');
}
process.exit(fail ? 1 : 0);