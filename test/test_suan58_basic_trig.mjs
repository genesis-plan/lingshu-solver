// suan58：基本三角方程的符号通解 + 周期延拓
// 这是「剪枝之外的第二种数学方法」：剪枝受根密度下界限制，符号通解 O(1) 与密度无关。
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const core = require('D:/Projects/genesis-plan/lingshu-solver/solver-core.js');
const sb = core.raw();
const P = s => sb.parse(sb.tokenize(s));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  OK   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  → ' + detail : '')); }
}
function solve58(expr, lo, hi, maxOut) {
  return sb._suan58BasicTrig(P(expr), 'x', lo, hi, { maxOut: maxOut || 100, valTol: 1e-6 });
}

console.log('【① 通解正确性：每个解必须【独立回代验算】通过】');
{
  const CASES = [
    ['sin(x)', -20, 20], ['sin(x) - 0.5', -20, 20], ['sin(x) + 0.5', -20, 20],
    ['cos(x)', -20, 20], ['cos(x) - 0.5', -20, 20], ['cos(x) + 0.5', -20, 20],
    ['tan(x) - 1', -20, 20], ['tan(x)', -20, 20], ['-sin(x)', -20, 20],
  ];
  CASES.forEach(([expr, lo, hi]) => {
    const r = solve58(expr, lo, hi);
    if (!r) { check(expr + ' 匹配成功', false, '返回 null'); return; }
    // 独立回代（不走实现自报）
    let allOk = true, worst = 0;
    r.solutions.forEach(x => {
      const f = sb.evalAST(P(expr), { x });
      if (f === null || !isFinite(f) || Math.abs(f) > 1e-6) allOk = false;
      else worst = Math.max(worst, Math.abs(f));
    });
    check(expr + ' 的 ' + r.solutions.length + ' 个解全部回代通过（max|f|=' + worst.toExponential(1) + '）', allOk);
  });
}

console.log('');
console.log('【② |常数| > 1 ⇒ 数学证明无解（不是"不知道"）】');
{
  ['sin(x) - 2', 'cos(x) - 5', 'sin(x) + 3', 'cos(x) + 1.0001'].forEach(expr => {
    const r = solve58(expr, -20, 20);
    check(expr + ' ⇒ provenEmpty', r && r.provenEmpty === true, r ? 'provenEmpty=' + r.provenEmpty : 'null');
  });
}

console.log('');
console.log('【③ 不匹配的形态必须安全返回 null（不猜）】');
{
  ['sin(2*x)', 'sin(x) + cos(x)', 'sin(x) - x', 'cos(x)*x', 'x^2 - 4', 'exp(x) - 3', 'ln(x) - 1']
    .forEach(expr => {
      const r = solve58(expr, -20, 20);
      check(expr + ' ⇒ null', r === null, r ? '返回了结果' : '');
    });
}

console.log('');
console.log('【④ 精确根数：通解数出的个数必须与暴力枚举一致（窄域）】');
{
  // sin(x)=0 在 [-20,20]：x = nπ ⇒ n ∈ [-6, 6] ⇒ 13 个
  const r = solve58('sin(x)', -20, 20);
  check('sin(x)=0 在 [-20,20] 精确 13 个根', r.count === 13, 'count=' + r.count);
  // tan(x)=0 同理：13 个
  const r2 = solve58('tan(x)', -20, 20);
  check('tan(x)=0 在 [-20,20] 精确 13 个根', r2.count === 13, 'count=' + r2.count);
  // cos(x)=0：x = π/2 + nπ ⇒ n ∈ [-6,5] ⇒ 12 个
  const r3 = solve58('cos(x)', -20, 20);
  check('cos(x)=0 在 [-20,20] 精确 12 个根', r3.count === 12, 'count=' + r3.count);
}

console.log('');
console.log('【⑤ 宽域：不得 SIGTERM / 不得爆内存（惰性生成）】');
{
  const t0 = performance.now();
  const r = solve58('sin(x)', -1e6, 1e6, 100);
  const ms = performance.now() - t0;
  check('sin(x)=0 在 ±1e6 内 < 200ms（曾 SIGTERM）', ms < 200, ms.toFixed(1) + 'ms');
  check('输出受上限约束（≤100）', r.solutions.length <= 100, '输出 ' + r.solutions.length);
  check('超出上限时 countCapped=true（不虚报逐个验证过的个数）', r.countCapped === true);
  check('但给出精确总数（通解数出）', r.totalIfCapped > 600000, 'total=' + r.totalIfCapped);
  check('标记 truncated', r.truncated === true);
}

console.log('');
console.log('【⑥ 端到端：产品行为 + fail-closed】');
{
  const r = core.solve(['sin(x) = 0'], ['x'], 6);
  check('sin(x)=0 端到端 < 300ms（修前 649ms）', (r.timeMs || 0) < 300, ((r.timeMs || 0)).toFixed(0) + "ms");
  check('截断时 result.truncated=true（fail-closed 硬要求）', r.truncated === true, 'truncated=' + r.truncated);
  check('截断时给出精确总数', r.exactSolutionCount > 600000, 'exactCount=' + r.exactSolutionCount);
  check('s58Exact 元数据可读', !!r.s58Exact && r.s58Exact.exact === true);
  check('所有输出解都 certified 或残差达标',
    (r.solutions || []).every(x => x.residual < 1e-6 || x.certified === true));

  // 注意：sin(x)=2 在端到端被【上游 suan1 定义域自动分析】抢先（既有行为，
  // 原本就走它、耗时 1502ms），故 suan58 不会执行。suan58 的 provenEmpty 分支
  // 在「上游未抢先」的情形下生效，故此处直接验证算子层，并在端到端只要求「判无解」。
  const peDirect = solve58('sin(x) - 2', -20, 20);
  check('算子层 sin(x)=2 ⇒ provenEmpty（精确证明无解）', !!(peDirect && peDirect.provenEmpty));

  const pe = core.solve(['sin(x) = 2'], ['x'], 6);
  check('端到端 sin(x)=2 判 0 解', (pe.solutions || []).length === 0, '解=' + (pe.solutions || []).length);

  const nf = core.solve(['sin(2*x) = 0'], ['x'], 6);
  check('sin(2x)=0 不走 suan58（形态不匹配 ⇒ 交回原路径）', nf.s58Exact === undefined || nf.s58Exact === null);
}

console.log('');
console.log('【⑦ 零行为变更：非三角方程不受影响】');
{
  [['x^2 - 4 = 0', 2], ['1/x = 2', 1], ['x^2 + 1 = 0', 0], ['cos(x) = x', 1]].forEach(([eq, exp]) => {
    const r = core.solve([eq], ['x'], 6);
    const n = (r.solutions || []).length;
    check(eq + ' → ' + n + ' 解（应 ' + exp + '）', n === exp);
    check(eq + ' 不带 s58Exact（未被 suan58 接管）', !r.s58Exact);
  });
}

console.log('');
console.log('通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail > 0 ? 1 : 0);
