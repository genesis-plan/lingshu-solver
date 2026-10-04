// 静默错误探针（P0 数学正确性专项）
//
// 思路：对每个「可能被当成数学常数/函数」的标识符，声明它为变量，
//       解一个手算可核对的问题，然后独立回代算残差。
//       残差 != 0 ⇒ 静默错误（引擎把变量当常数/函数了）。
// 不依赖引擎自报 residual，全部自己算。
//
// 为什么值得固化成回归测试（不是一次性探针）：
//   2026-10-03 抓到的 P0 是 `tokenize` 把单字母变量 `e` 静默替换成欧拉数 ——
//   用户声明 e 是变量，引擎当它是常数，且**不报错、不降级**，直接给错解。
//   这类 bug 的特征是「一次修复只覆盖一个字母」，必须用「扫全部 26 个字母」
//   的方式把整类问题钉死，否则下次重构又会从别的字母漏出来。
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const P = require('../solver-core.js').raw();

// ── 独立残差回代：完全用引擎的 parse/tokenize/evalAST，但把声明表显式传进去 ──
function resid(eqs, vns, vals) {
  const vmap = {};
  vns.forEach((v, i) => { vmap[v] = vals[i]; });
  let worst = 0;
  for (const e of eqs) {
    const i = e.indexOf('=');
    let ast;
    if (i < 0) ast = P.parse(P.tokenize(e, vns));
    else ast = { type: 'binop', op: '-', left: P.parse(P.tokenize(e.slice(0, i), vns)), right: P.parse(P.tokenize(e.slice(i + 1), vns)) };
    const v = Math.abs(P.evalAST(ast, vmap));
    if (!isFinite(v)) return Infinity;
    if (v > worst) worst = v;
  }
  return worst;
}

// 统一失败收集（探针 1/2 用局部 bad1/bad2，探针 3~7 直接往这里塞）
const failures = [];
// bad2 必须声明在顶层：探针 2 的求解循环包在自己的 {} 里，
// 但汇总段要读它 —— 放块内会在汇总处 ReferenceError（踩过一次）。
const bad2 = [];

// ═══ 探针 1：单字母变量名 t^2 = 9 ⇒ 真解 t=±3 ═══
// 若 t 被当常数（e/pi）或函数（sin/cos…），残差必然 != 0
console.log('══ 探针1：26 个单字母变量名，t^2-9=0，真解 ±3 ══');
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const bad1 = [];
for (const L of LETTERS) {
  const eqs = [L + '^2-9=0'];
  let r;
  try { r = P.solve(eqs.slice(), [L], 6, null, false, {}); }
  catch (e) { console.log(`  ${L}  CRASH ${e.message.slice(0, 60)}`); bad1.push(L + ':CRASH'); continue; }
  const sols = r.solutions || [];
  let worst = 0, has = false;
  for (const s of sols) {
    const d = resid(eqs, [L], s.values);
    if (isFinite(d) && Math.abs(Math.abs(s.values[0]) - 3) < 1e-6) has = true;
    if (d > worst) worst = d;
  }
  const ok = (sols.length === 2 && has && worst < 1e-9);
  if (!ok) { bad1.push(L); console.log(`  ✗ ${L}: 解数=${sols.length} 含±3=${has} 最大残差=${worst.toExponential(2)} err=${r.error || '-'}`); }
}
console.log(bad1.length === 0 ? '  ✓ 26/26 全通过' : `  ✗ 失败 ${bad1.length} 个: ${bad1.join(' ')}`);

// ═══ 探针 2：多变量方程组里含危险字母（线性，可手算）═══
// a+b=10, a-b=2  => a=6, b=4
console.log('\n══ 探针2：二元线性组 a+b-10=0, a-b-2=0，真解 (6,4) ══');
{
  const pairs = [['a','b'],['e','f'],['i','j'],['pi','q'],['theta','x'],['x','y'],['p','q'],['sin','cos']];
  for (const [u, v] of pairs) {
    const eqs = [u + '+' + v + '-10=0', u + '-' + v + '-2=0'];
    let r;
    try { r = P.solve(eqs.slice(), [u, v], 6, null, false, {}); }
    catch (e) { bad2.push(`${u},${v}:CRASH`); console.log(`  ✗ ${u},${v} CRASH ${e.message.slice(0, 50)}`); continue; }
    const sols = r.solutions || [];
    let worst = 0, ok = false;
    for (const s of sols) {
      const d = resid(eqs, [u, v], s.values);
      if (d > worst) worst = d;
      if (Math.abs(s.values[0] - 6) < 1e-6 && Math.abs(s.values[1] - 4) < 1e-6) ok = true;
    }
    if (!(sols.length >= 1 && ok && worst < 1e-9)) {
      bad2.push(`${u},${v}`);
      console.log(`  ✗ ${u},${v}: 解数=${sols.length} 含(6,4)=${ok} 最大残差=${worst.toExponential(2)} err=${r.error || '-'}`);
    }
  }
  console.log(bad2.length === 0 ? '  ✓ 8/8 全通过' : `  ✗ 失败 ${bad2.length} 组: ${bad2.join(' ')}`);
}

// ═══ 探针 3：欧拉数 e 未声明时必须仍是欧拉数（向后兼容）═══
// 这条是探针 1 的**反向**约束：修了「声明 e 就是变量」之后，
// 不能把「没声明 e 时按常数用」的能力一起改坏。
console.log('\n══ 探针3：未声明 e 时 e 仍应是欧拉数（exp(x)-e=0 ⇒ x=1）═══');
{
  const eqs = ['exp(x)-e=0'];
  let r, crashed = null;
  try { r = P.solve(eqs.slice(), ['x'], 6, null, false, {}); }
  catch (e) { crashed = String(e && e.message || e); }
  const sols = (r && r.solutions) || [];
  let ok = false, worst = 0;
  for (const s of sols) {
    const v = Math.abs(Math.exp(s.values[0]) - Math.E);   // 独立算，不信引擎自报
    if (v > worst) worst = v;
    if (Math.abs(s.values[0] - 1) < 1e-6) ok = true;
  }
  const pass = !crashed && ok && worst < 1e-9;
  if (!pass) failures.push('探针3');
  console.log(`  ${pass ? '✓' : '✗'} 解数=${sols.length} 含x=1=${ok} 独立残差=${worst.toExponential(2)}`
    + (crashed ? ' CRASH=' + crashed.slice(0, 60) : ''));
}

// ═══ 探针 4：希腊字母名 vs 符号（声明 theta，方程写 theta）═══
console.log('\n══ 探针4：声明 theta，theta^2-4=0 ⇒ 真解 ±2 ══');
{
  const eqs = ['theta^2-4=0'];
  let r, crashed = null;
  try { r = P.solve(eqs.slice(), ['theta'], 6, null, false, {}); }
  catch (e) { crashed = String(e && e.message || e); }
  const sols = (r && r.solutions) || [];
  let worst = 0, has = false;
  for (const s of sols) {
    const v = Math.abs(s.values[0] * s.values[0] - 4);
    if (v > worst) worst = v;
    if (Math.abs(Math.abs(s.values[0]) - 2) < 1e-6) has = true;
  }
  const pass = !crashed && sols.length === 2 && has && worst < 1e-9;
  if (!pass) failures.push('探针4');
  console.log(`  ${pass ? '✓' : '✗'} 解数=${sols.length} 含±2=${has} 残差=${worst.toExponential(2)}`
    + (crashed ? ' CRASH=' + crashed.slice(0, 60) : ''));
}

// ═══ 探针 5：双字母变量名（隐式乘拆字风险）═══
console.log('\n══ 探针5：双字母变量名 ab/xy/tot/va，nm-6=0 ⇒ 真解 6 ══');
{
  const cases = [['ab', 'ab-6=0'], ['xy', 'xy-6=0'], ['tot', 'tot-6=0'], ['va', 'va-6=0']];
  let bad5 = 0;
  for (const [nm, eq] of cases) {
    const eqs = [eq];
    let r, crashed = null;
    try { r = P.solve(eqs.slice(), [nm], 6, null, false, {}); }
    catch (e) { crashed = String(e && e.message || e); }
    const sols = (r && r.solutions) || [];
    let ok = false, worst = 0;
    for (const s of sols) {
      const d = resid(eqs, [nm], s.values);
      if (d > worst) worst = d;
      if (Math.abs(s.values[0] - 6) < 1e-6) ok = true;
    }
    const pass = !crashed && ok && worst < 1e-9;
    if (!pass) bad5++;
    console.log(`  ${pass ? '✓' : '✗'} ${nm}: 解数=${sols.length} 含6=${ok} 残差=${worst.toExponential(2)}`
      + (crashed ? ' CRASH=' + crashed.slice(0, 50) : ''));
  }
  if (bad5) failures.push('探针5(' + bad5 + '个)');
  console.log(`  ${bad5 ? '✗' : '✓'} 小结：${cases.length - bad5}/${cases.length} 通过（拆字不能误伤已声明的双字母名）`);
}

// ═══ 探针 6：6 元线性含 e/f（2026-10-03 P0 的原始现场）═══
console.log('\n══ 探针6：6元线性 a+b+c+d+e+f-60 与 5 个差分方程 ══');
console.log('    手算真解 (12.5,11.5,10.5,9.5,8.5,7.5)，和=60 ══');
{
  const eqs = ['a+b+c+d+e+f-60=0', 'a-b-1=0', 'b-c-1=0', 'c-d-1=0', 'd-e-1=0', 'e-f-1=0'];
  const vns = ['a', 'b', 'c', 'd', 'e', 'f'];
  let r, crashed = null;
  try { r = P.solve(eqs.slice(), vns, 6, null, false, {}); }
  catch (e) { crashed = String(e && e.message || e); }
  const sols = (r && r.solutions) || [];
  let worst = 0, hit = false;
  for (const s of sols) {
    const d = resid(eqs, vns, s.values);
    if (d > worst) worst = d;
    if (Math.abs(s.values.reduce((p, c) => p + c, 0) - 60) < 1e-9) hit = true;
  }
  const pass = !crashed && hit && worst < 1e-9;
  if (!pass) failures.push('探针6');
  console.log(`  ${pass ? '✓' : '✗'} 解数=${sols.length} 和=60:${hit} 最大残差=${worst.toExponential(3)}`
    + (crashed ? ' CRASH=' + crashed.slice(0, 60) : ''));
  if (sols.length) console.log('  首解 = [' + sols[0].values.join(', ') + ']');
}

// ═══ 探针 7（2026-10-04 新增）：残差闸门的两道防线必须同时成立 ═══
// 闸门 (_finalResidualGate) 是本轮为「数学正确性」加的最后一道过滤。
// 它改过一次判据，这里把**两道防线各自的边界**都钉住：
//
//   防线 A「有限性」：表达式值算出 NaN/±Infinity ⇒ 拒。
//     实测事故：p∈[±2.5e9] 上的 120000·p·(1+p)^360=2500000 曾返回 9468 个
//     residual 自报为 0 的伪解 —— 溢出成 Infinity，而 Infinity 参与减法仍是 Infinity。
//     ⇒ 大系数 + 巨域场景下，伪解必须全部被剔、真解必须留下。
//
//   防线 B「量纲挂钩的容差」：|f(x)| > τ·Σ|terms| ⇒ 拒（τ=1e-11）。
//     这条是 2026-10-04 修 bug 时换进来的：初版用固定容差 1e-6，
//     而 `expr=0` 是方程标准写法 ⇒ 容差恒为 1e-6 ⇒
//     x^2−1e13=0 的真根（±3162277.66，代回残差 0.00195 是 double 自身舍入）被误杀。
//     ⇒ 大系数一元二次必须仍能找到 2 个真根。
console.log('\n══ 探针7：残差闸门两道防线 ══');
{
  // 防线 A：溢出伪解必须被剔，真解必须留
  const eqA = '120000*p*(1+p)^360-2500000 = 0';
  const rA = P.solve([eqA], ['p'], 6, { p: [-2500000000, 2500000000] }, false, {});
  const solsA = rA.solutions || [];
  const wantP = 0.01955308479666175;
  let hitA = false, worstA = 0;
  for (const s of solsA) {
    const d = resid([eqA], ['p'], s.values);
    if (isFinite(d) && Math.abs(s.values[0] - wantP) < 1e-9) hitA = true;
    if (d > worstA) worstA = d;
  }
  const passA = solsA.length === 1 && hitA && worstA < 1e-6;
  if (!passA) failures.push('探针7A(溢出伪解)');
  console.log(`  ${passA ? '✓' : '✗'} 防线A 溢出：解数=${solsA.length}（应恰为 1）含真解=${hitA} 残差=${worstA.toExponential(2)}`);
  console.log(`     警告链: ${JSON.stringify(rA.warnings || []).slice(0, 200)}`);

  // 防线 B：大系数一元二次的真根不能被容差误杀
  const w = Math.sqrt(1e13) * 1.0000001;
  const eqB = 'x^2-10000000000000=0';
  const rB = P.solve([eqB], ['x'], 6, { x: [-w, w] }, false, {});
  const solsB = rB.solutions || [];
  let wantB = 0;
  for (const s of solsB) if (Math.abs(Math.abs(s.values[0]) - Math.sqrt(1e13)) < 1e-3) wantB++;
  // 独立回代残差用「相对」判据：真根的双精度舍入本就在 1e-2 量级
  let worstB = 0;
  for (const s of solsB) {
    const v = Math.abs(s.values[0] * s.values[0] - 1e13);
    if (v > worstB) worstB = v;
  }
  const passB = solsB.length === 2 && wantB === 2 && worstB < 0.01;
  if (!passB) failures.push('探针7B(容差误杀)');
  console.log(`  ${passB ? '✓' : '✗'} 防线B 容差：解数=${solsB.length}（应 2）命中 ±√1e13=${wantB} 独立残差=${worstB.toExponential(2)}`);
  console.log(`     解=${JSON.stringify(solsB.map(s => s.values))}`);

  // 防线 B 的反向：容差放宽后**不能**因此放过明显错的解
  //   x^2=1 的域给到 ±1e6 ⇒ 期望解仍在 ±1 附近，绝不能冒出 |x|=1e5 之类的伪解
  const rC = P.solve(['x^2-1=0'], ['x'], 6, { x: [-1000000, 1000000] }, false, {});
  const solsC = rC.solutions || [];
  let far = 0;
  for (const s of solsC) if (Math.abs(Math.abs(s.values[0]) - 1) > 1e-3) far++;
  const passC = far === 0 && solsC.length >= 2;
  if (!passC) failures.push('探针7C(容差过宽)');
  console.log(`  ${passC ? '✓' : '✗'} 防线B反向：x^2=1 在 ±1e6 域上解数=${solsC.length} 偏离真根的=${far}（应 0）`);
  console.log(`     解=${JSON.stringify(solsC.map(s => s.values))}`);
}

// ═══ 汇总 ═══
console.log('\n══ 汇总 ══');
console.log(`探针1（26 个单字母）失败 ${bad1.length}/26`);
console.log(`探针2（二元线性）失败 ${bad2.length}/8`);
if (bad1.length) failures.push('探针1(' + bad1.length + '个)');
if (bad2.length) failures.push('探针2(' + bad2.length + '个)');
console.log(`失败组: ${failures.length ? failures.join(', ') : '无'}`);
console.log(`\n失败组数: ${failures.length}`);
if (failures.length) {
  console.log('\n🔴 有探针失败。静默错误的特征是「不报错、不降级、直接给错解」，');
  console.log('   所以这里只认独立回代的残差与解数，不看引擎自己声称什么。');
}
process.exit(failures.length ? 1 : 0);