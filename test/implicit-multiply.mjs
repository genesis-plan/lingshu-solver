// 隐式乘 + 保护表专项回归（P0，2026-10-03）
//
// 为什么必须独立成文件：
//   历史 P0 —— 声明变量后引擎把受保护标识符替换成 §§N§§ 占位符，而隐式乘规则的
//   字符类不含 §，于是 "2x" 插不进乘号 → 解析失败 → 0 解。Agent 最自然的写法全面失效。
//   现有 20 条 golden **一条都没覆盖到**（它们全用显式乘 * 或未声明变量），
//   所以这个 P0 能一路活到今天。回归必须专门锁这两条：
//     层 1  占位符必须对隐式乘「原子化」（补得进乘号，且幂运算 total^2 不能被插乘号）
//     层 2  保护表不得跨 solve 泄漏（solve 之后 fuzzyFix("2x") 必须仍是 "2*x"）
import { solve, fuzzyFix } from '../dist/lingshu.mjs';

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  实际: ' + JSON.stringify(extra) : '')); }
}
const S = (eqs, vars) => solve(eqs, vars, 6, undefined, false, {});
const vals = (r) => (r.solutions || []).map(s => s.values);

console.log('── 1. 层 1：声明变量后隐式乘必须存活（此前全部 0 解）──');
{
  const r = S(['2x=4'], ['x']);
  ok(vals(r).length === 1 && Math.abs(vals(r)[0][0] - 2) < 1e-6, '2x=4 ⇒ x=2', vals(r));
}
{
  const r = S(['2x+3y=13'], ['x', 'y']);
  const v = vals(r);
  ok(v.length >= 1, '2x+3y=13 有解（此前 NO_EQUATION）', { error: r.error, n: v.length });
  // 验算真值：2x+3y=13 的整数解是 x=2,y=3
  ok(v.length >= 1 && Math.abs(2 * v[0][0] + 3 * v[0][1] - 13) < 1e-6, '解满足 2x+3y=13', v[0]);
}
{
  const r = S(['2x^2=8'], ['x']);
  const v = vals(r);
  ok(v.length === 2, '2x^2=8 ⇒ x=±2 两根（幂不等于乘）', { error: r.error, n: v.length });
}

console.log('\n── 2. 层 1 边界：多字符变量名 + 占位符相邻 ──');
{
  const r = S(['2total=10'], ['total']);
  ok(vals(r).length === 1 && Math.abs(vals(r)[0][0] - 5) < 1e-6, '2total=10 ⇒ total=5（占位符原子化生效）', vals(r));
}
{
  // total^2 绝不能被插成 total*2 —— 这就是 golden 15/20 变红那个坑
  const r = S(['total^2=9'], ['total']);
  const v = vals(r);
  ok(v.length === 2, 'total^2=9 ⇒ 两根（占位符紧跟 ^ 不补乘号）', { error: r.error, n: v.length });
}

console.log('\n── 3. 层 2：保护表不得跨 solve 泄漏 ──');
{
  ok(fuzzyFix('2x') === '2*x', '初始 fuzzyFix("2x") = "2*x"');
  S(['2x=4'], ['x']);
  ok(fuzzyFix('2x') === '2*x', 'solve(声明 x) 之后仍是 "2*x"（此前永久变成 "2x" 且不可逆）', fuzzyFix('2x'));
  S(['2total=10'], ['total']);
  ok(fuzzyFix('2x') === '2*x', 'solve(声明 total) 之后仍不受污染（total 保护不串味到 x）', fuzzyFix('2x'));
}

console.log('\n── 4. 连续多次不同声明：每次都自洽 ──');
{
  const seq = [
    [['2x=4'], ['x'], 2],
    [['2y=8'], ['y'], 4],
    [['3z=9'], ['z'], 3],
  ];
  let allOk = true;
  const detail = [];
  for (const [eqs, vars, want] of seq) {
    const r = S(eqs, vars);
    const v = vals(r);
    const hit = v.length === 1 && Math.abs(v[0][0] - want) < 1e-6;
    if (!hit) { allOk = false; detail.push({ eqs, got: v, error: r.error }); }
  }
  ok(allOk, 'x/y/z 交替声明互不干扰（3/3 正确）', detail.length ? detail : undefined);
}

console.log('\n── 5. 显式乘与隐式乘必须给出相同答案（口径一致性）──');
{
  const a = vals(S(['2x+3y=13'], ['x', 'y']));
  const b = vals(S(['2*x+3*y=13'], ['x', 'y']));
  ok(a.length > 0 && b.length > 0, '两种写法都有解');
  ok(a.length > 0 && b.length > 0 && Math.abs(a[0][0] - b[0][0]) < 1e-6 && Math.abs(a[0][1] - b[0][1]) < 1e-6,
    '隐式乘解 == 显式乘解', { 隐式: a[0], 显式: b[0] });
}

console.log('\n── 6. 保护表不得把字面数字误当变量（回归护栏）──');
{
  // 占位符原子化规则里「数字 × 占位符」若写错（如 alternation 被转义成字面量），
  // 会退化成「每个数字后都插乘号」，把 13 变成 1*3。这是曾经真实发生过的失败。
  ok(fuzzyFix('x^2+13=17') === 'x^2+13=17', '常量 13 不被插乘号（无占位符时规则完全空转）', fuzzyFix('x^2+13=17'));
  const r = S(['x^2+13=17'], ['x']);
  const v = vals(r);
  // x^2+13=17 ⇒ x^2=4 ⇒ x=±2（两根）。关键不是根数，而是 13 没被拆成 1*3。
  ok(v.length === 2 && v.some(a => Math.abs(a[0] - 2) < 1e-6) && v.some(a => Math.abs(a[0] + 2) < 1e-6),
    'x^2+13=17 ⇒ x=±2 语义正确（13 未被拆成 1*3）', { error: r.error, v });
}

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
