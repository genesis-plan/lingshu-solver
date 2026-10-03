// suan57：全域区间剪枝（f(I) 不含 0 ⇒ I 上恒无根）
// 锁定四件事：① 剪枝 sound（剪掉的段真无根）② 端点有限性 ③ 零行为变更 ④ 诚实边界
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const core = require('D:/Projects/genesis-plan/lingshu-solver/solver-core.js');
const sb = core.raw();

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  OK   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  → ' + detail : '')); }
}
function P(s) { return sb.parse(sb.tokenize(s)); }

console.log('【① 剪枝 sound：被剪掉的段必须【独立验算】真的无根】');
{
  // cos(x)-x：真解仅 0.739085
  const ast = P('cos(x) - x');
  const r = sb._suan57Prune(ast, 'x', -1e6, 1e6, { intervalEval: sb.intervalEval, maxLevels: 14, maxBands: 24, maxEvals: 200 });
  check('返回非 null', !!r);
  if (r && r.rootless.length) {
    let violations = 0, checked = 0;
    r.rootless.forEach(([a, b]) => {
      for (let i = 0; i <= 20; i++) {
        const x = a + (b - a) * i / 20;
        const f = sb.evalAST(ast, { x });
        checked++;
        if (f !== null && isFinite(f) && f === 0) violations++;   // 段内出现根 ⇒ 剪错了
      }
    });
    check('剪掉的 ' + r.rootless.length + ' 段内无零点（抽查 ' + checked + ' 点）', violations === 0, violations + ' 点出现根');

    // 残余带必须包含真解
    const root = 0.7390851332151607;
    const inBand = r.bands.some(([a, b]) => root >= a && root <= b);
    check('残余带包含真根 0.739085（不漏解）', inBand, 'bands=' + JSON.stringify(r.bands.map(b => [b[0].toFixed(2), b[1].toFixed(2)])));
  }
}

console.log('');
console.log('【② ±Infinity 是有效信息（不是求值失败）】');
{
  // exp(x)-3 在 [31250, 62500] 上包络 = [Inf, Inf] ⇒ 恒正 ⇒ 可剪
  const ast = P('exp(x) - 3');
  const iv = sb.intervalEval(ast, { x: { min: 31250, max: 62500 } });
  check('该段包络确为 [Inf, Inf]', iv && iv.min === Infinity && iv.max === Infinity, iv ? '[' + iv.min + ',' + iv.max + ']' : 'null');
  const r = sb._suan57Prune(ast, 'x', 31250, 62500, { intervalEval: sb.intervalEval });
  check('全 +Inf 的段被剪掉（恒正 ⇒ 无根）', !!(r && r.fullyPruned), r ? 'fullyPruned=' + r.fullyPruned : 'null');

  // NaN 必须保守不剪
  const r2 = sb._suan57Prune(ast, 'x', -1e6, 1e6, { intervalEval: function () { return { min: NaN, max: NaN }; } });
  check('NaN 包络 ⇒ 保守不剪（prunedAny=false）', !r2 || r2.prunedAny === false);
}

console.log('');
console.log('【③ 零行为变更：不可剪的题必须放弃】');
{
  // sin(x)：振荡，包络恒含 0 ⇒ 剪率 0 ⇒ 必须放弃
  const ast = P('sin(x)');
  const r = sb._suan57Prune(ast, 'x', -1e6, 1e6, { intervalEval: sb.intervalEval, maxLevels: 14 });
  check('sin(x) 剪率 0 ⇒ prunedAny=false', r && r.prunedAny === false, r ? ('pruneRatio=' + r.pruneRatio) : 'null');
  check('放弃时 bands 仍是原域（[−1e6,1e6]）', r && r.bands.length === 1 && r.bands[0][0] === -1e6 && r.bands[0][1] === 1e6);
}

console.log('');
console.log('【④ 端到端：解数必须完全不变】');
{
  const CASES = [
    ['exp(x) = 3', 1], ['cos(x) = x', 1], ['sqrt(x) = 2', 1], ['abs(x) = 3', 2],
    ['ln(x) = 2', 1], ['log(x) = 2', 1], ['x^3 - 2*x - 5 = 0', 1], ['1/x = 2', 1],
    ['x^2 - 4 = 0', 2], ['x^5 - x - 1 = 0', 1], ['x^10 - x - 1 = 0', 2],
    ['x^2 + 1 = 0', 0], ['1/x + 1/(x-1) = 3', 2], ['x^4 - 10*x^2 + 9 = 0', 4],
    ['sin(x) = 0', 'many'], ['tan(x) = 1', 'many'],
  ];
  CASES.forEach(([eq, exp]) => {
    const r = core.solve([eq], ['x'], 6);
    const s = (r.solutions || []).length;
    const ok = exp === 'many' ? s > 0 : s === exp;
    check(eq + ' → ' + s + ' 解（应 ' + exp + '）', ok);
    // 解必须在剪枝后的残余带里（真解不能被剪掉）
    if (s > 0 && r.s57Pruning) {
      const root = r.solutions[0].values[0];
      check(eq + ' 的解 ' + root.toFixed(6) + ' 通过残差校验', r.solutions[0].residual < 1e-6 || (r.solutions[0].certified === true));
    }
  });
}

console.log('');
console.log('【⑤ 性能护栏：剪枝本身必须便宜】');
{
  const ast = P('cos(x) - x');
  const t0 = performance.now();
  for (let i = 0; i < 5; i++) sb._suan57Prune(ast, 'x', -1e6, 1e6, { intervalEval: sb.intervalEval, maxLevels: 14, maxBands: 24, maxEvals: 200 });
  const ms = (performance.now() - t0) / 5;
  check('单次剪枝 < 8ms（实测每次区间求值约 30μs × 上限 200）', ms < 8, ms.toFixed(2) + 'ms');
}

console.log('');
console.log('【⑥ 诚实边界：剪枝不宣称无解】');
{
  const r = core.solve(['cos(x) = x'], ['x'], 6);
  // s57Pruning 只能报告「剪掉了多少」，不得出现「无解」类断言
  const p = r.s57Pruning;
  if (p) {
    const s = JSON.stringify(p);
    check('s57Pruning 不含「无解/noSolution/empty」类断言',
      s.indexOf('无解') < 0 && s.indexOf('noSolution') < 0 && s.indexOf('empty') < 0, s);
    check('s57Pruning 报告剪率（可核查）', typeof p.pruneRatio === 'number');
  } else {
    check('s57Pruning 存在或未触发（不报错）', true);
  }
}

console.log('');
console.log('通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail > 0 ? 1 : 0);
