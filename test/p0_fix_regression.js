'use strict';
/**
 * 灵数求解器 · P0 缺陷修复回归测试
 * 验证 2026-09-04 修的两处 P0：
 *   P0-1: _newtonRefine 因点值喂入 intervalEval 致雅可比 NaN → 恒返 null（全局分支谎报 complete）
 *   P0-2: _affineEval 超越函数分支把合法区间宽度丢成 0 → intervalEval 对 sin/exp/... 塌成点（unsound）
 *
 * 运行：node test/p0_fix_regression.js
 * 含修3（2026-09-04）：顶层 solve() 对单变量超越方程（如 sin(x)-0.5）曾挂起 >110s，
 *     根因 suan22 网格扫描在宽域周期方程上穷举数十万根；现加根数/超时护栏，
 *     周期稠密解集如实标 rt=3 无限解集(代表解)，非周期稠密诚实截断。
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

console.log('===== E. 端到端 solve（多项式/多变量方阵，proven 且快速）=====');
for (const [eqs, vns, expect] of [[['x^2-4'], ['x'], 2], [['x^2+y^2-25', 'x-y-1'], ['x', 'y'], 2]]) {
  try {
    const r = sb.solve(eqs, vns, 6);
    const sols = (r.solutions || []).filter(s => s.values);
    chk(`solve(${eqs.join(';')})`, sols.length === expect && (sols[0] || {}).tier === 'proven', `→ ${sols.length}/${expect} 解, tier=${(sols[0] || {}).tier || '?'}`);
  } catch (e) { chk(`solve(${eqs.join(';')})`, false, '异常 ' + e.message); }
}

console.log('===== F. 修3：顶层 solve 超越单变量不再挂起（限时返回）=====');
function timedSolve(label, eqs, vns, dom, expectRt, expectMin) {
  const t0 = Date.now();
  let r, err = null;
  try { r = sb.solve(eqs, vns, 6, dom); } catch (e) { err = e.message; }
  const ms = Date.now() - t0;
  const ok = !err && ms <= 2000 && r && r.resultType === expectRt && (r.solutions || []).length >= (expectMin || 0);
  chk(`${label} → ≤2s 且 rt=${expectRt}`, ok, err ? ('异常 ' + err) : `${ms}ms, rt=${r.resultType}, n=${(r.solutions || []).length}, truncated=${!!r.truncated}`);
}
timedSolve('solve(sin(x)-0.5) 默认域', ['sin(x)-0.5'], ['x'], undefined, 3, 100);   // 周期无限 → rt=3
timedSolve('solve(sin(x)=0.5) 限域[0,4]', ['sin(x)=0.5'], ['x'], { x: [0, 4] }, 2, 2);  // 有限 2 根
timedSolve('solve(cos(x)=0.5) 限域[0,20]', ['cos(x)=0.5'], ['x'], { x: [0, 20] }, 2, 7); // 有限 7 根
// 2026-10-03 suan58：tan(x)=1 由符号通解接管 ⇒ rt=2（有限解·截断）+ 精确总数 636620。
// 旧断言 rt=3（无限解集）是**错误分类** —— 声明域有限 ⇒ 真解有限（tan 周期 π，±1e6 内 636620 个）。
timedSolve('solve(tan(x)=1) 默认域', ['tan(x)=1'], ['x'], undefined, 2, 10);       // suan58 通解 ⇒ rt=2
timedSolve('solve(sin(x)+2=0) 无根', ['sin(x)+2=0'], ['x'], undefined, 1, 0);      // 候选空集

console.log('===== G. 2026-10-05 彻底去网格化：输出全精度 + 后向误差判据 =====');
//
// 演化史（同一个坑连修三次，必须留痕）：
//   事故A（P0-3）：耦合线性系统 7x+y+z+u=7… 的精确解 (3/5, 23/30, 14/15, 11/10)
//     在 Q 上验证全过，却被 roundToGrid 量化到 6 位网格 ⇒ 残差 2.3e-6 > 1e-6
//     ⇒ 被残差闸门当伪解丢掉 ⇒ 对外 0 解 +「计算资源不足」。
//   事故B（P0-4）：`3*x=1` 返回 provenEmpty=true +「已严格证明：定义域内不存在
//     实数解」，而真解 x=1/3 就在那儿 ⇒ Agent 照原文断言无解（最恶劣的谎报档）。
//
//   修法1（已废）：给闸门加「量化格余量」L·h 通道（_gridQuantTol）。
//     x 为什么废：那是**用容差去补精度损失**。放宽判据只是让劣解混进来，
//     并不能让 23/30 本身更准；而且它永久放宽了闸门 —— 任何残差 < 1e-6 的
//     伪解都能混进来，纯矛盾检测也被永久放宽。
//   修法2（现在，2026-10-05 用户指令「去掉全部网格化」）：
//     ✅ 删掉量化本身。roundToGrid 改为「全精度 + ULP 去噪吸附」，
//     坐标不再被截到 6 位 ⇒ 真解残差自然回到机器精度量级（实测 0 ~ 1.8e-15），
//     根本不需要额外容差通道。_gridQuantTol / _valsOnGrid 已从引擎删除。
//
// 所以本段断言比旧版**更强**：旧版只要求「残差 <= 2e-5」（量化下界内），
// 新版要求「残差 <= 1e-12」（机器精度量级）—— 这才是去网格化真正的收益证明。

console.log('--- G1. 全精度解的残差必须回到机器精度量级（<=1e-12），不是 1e-6 量级---');
{
  const N = ['x', 'y', 'z', 'u', 'v', 'w'];
  // 对角占优 n 元方阵：唯一解必含循环小数（y=x+1/6 ⇒ 23/30 …）⇒ 旧网格必量化
  for (const n of [3, 4, 5, 6]) {
    const vs = N.slice(0, n), eqs = [];
    for (let r = 0; r < n; r++) {
      let e = '';
      for (let k = 0; k < n; k++) e += (k ? '+' : '') + (k === r ? (n + 3) : 1) + '*' + vs[k];
      eqs.push(e + ' = ' + (n + 3 + r));
    }
    const r = sb.solve(eqs, vs, 6);
    const sols = r.solutions || [];
    const s0 = sols[0];
    const vars = {}; vs.forEach((v, i) => vars[v] = s0 && s0.values[i]);
    const res = Math.max.apply(null, eqs.map(e => {
      const k = e.indexOf('=');
      const ast = { type: 'binop', op: '-', left: sb.parse(sb.tokenize(e.slice(0, k), vs)), right: sb.parse(sb.tokenize(e.slice(k + 1), vs)) };
      try { return Math.abs(sb.evalAST(ast, vars)); } catch (err) { return NaN; }
    }));
    chk(`n=${n} 耦合方阵 → 1 解且 proven`, sols.length === 1 && s0.tier === 'proven',
      `→ ${sols.length} 解, tier=${s0 && s0.tier}, 残差=${isFinite(res) ? res.toExponential(2) : '?'}`);
    // 核心断言：残差必须是机器精度量级。旧网格化下这一项是 2e-6~6e-6（会 FAIL）。
    chk(`n=${n} 残差 <= 1e-12（已无量化残差）`, isFinite(res) && res <= 1e-12,
      `残差=${isFinite(res) ? res.toExponential(2) : '?'}`);
    // 坐标必须保留超过 6 位小数的精度（旧实现一律截到 6 位）。
    // ⚠ 只在解**确实含循环小数**时才有意义：n=3 的解是 [0.675, 0.875, 1.075]
    //   本身就精确落在短小数上，roundToGrid 的 8 ULP 吸附会正确地把它规整回
    //   0.675（3 位）—— 那是**对的**，不是截断。对它断言「小数位 > 6」是
    //   我的判据写错（把「规整」当成「截断」），不是代码缺陷。
    // 正确判据：拿每个坐标的**双精度最优近似误差**做对照 —— 若解是循环小数，
    //   旧实现误差 ~1e-7，新实现误差 ≤ 1 ULP（~1e-16）。
    let maxUlpErr = 0, nonGrid = 0;
    for (const v of (s0.values || [])) {
      if (typeof v !== 'number' || !isFinite(v)) continue;
      // 该坐标若是短小数（<=6 位小数能精确表示），预期 ULP 吸附后误差≈0
      const d = Math.pow(10, 6);
      const isShort = Math.abs(v * d - Math.round(v * d)) < 1e-6;
      if (!isShort) {
        nonGrid++;
        // 非短小数 ⇒ 旧网格化必然改写它；现在必须原样保留（与自身 15 位表示一致）
        // ⚠ 别用 toPrecision(15) 当对照：它自己就丢到15 位，测出的是**测量误差**
        //   （实测 1.3e-15）而不是真实改写量。正确对照是「1/3 的双精度最优近似」，
        //   即拿一个已知循环小数喂给 roundToGrid，直接量它有没有被改写（见 G2）。
        //   这里改判「该坐标仍是 15~17 位有效数字的完整 double」（长度不变短）。
        maxUlpErr = Math.max(maxUlpErr, String(v).replace(/[^0-9]/g, '').length < 15 ? 1 : 0);
      }
    }
  chk(`n=${n} 非短小数坐标仍是完整 double（有效数字 ≥15 位）`, nonGrid === 0 || maxUlpErr === 0,
    `非短小数坐标 ${nonGrid} 个, 被截短坐标 ${maxUlpErr} 个`);
  }
}

// ── G1-bis. roundToGrid 本身的直接断言（2026-10-05 P0-B 的护栏）─────────────
//
// 为什么必须直接测它、不能只靠 G1 端到端：
//   P0-B 的形状是「constants.js 与文档都宣称 roundToGrid 已去网格化，
//   而函数体仍是 Math.round(x*1e6)/1e6」。端到端测试只看**最终对不对**，
//   于是 n=3（解恰好落在短小数上）通过、n≥4 全灭 —— 掩盖了整整一轮。
//   直接测函数体是唯一能挡住「文档说改了、代码没改」这类缺陷的手段。
{
  const rtg = sb.roundToGrid;
  chk('roundToGrid 已导出（否则下面的直接断言是空跑）', typeof rtg === 'function', `typeof=${typeof rtg}`);

  if (typeof rtg === 'function') {
    // ① 循环小数必须**原样保留**（这是 P0-B 的核心：23/30 被砍成 0.766667 就丢解）
    const third = 1 / 3;
    chk('roundToGrid(1/3) 原样保留（未被量化到 6 位小数）',
      rtg(third) === third, `1/3 → ${rtg(third)}`);

    // ② 23/30 = 0.7666666666666667 是本次 P0-B 的实际受害者
    const e2330 = 23 / 30;
    chk('roundToGrid(23/30) 原样保留（P0-B 的实际丢解点）',
      rtg(e2330) === e2330, `23/30 → ${rtg(e2330)}`);

    // ③ 浮点表示噪声**不再**被去噪 —— roundToGrid 已是恒等函数（2026-10-05 契约变更）。
    //   旧契约（ULP 级吸附）会把 0.1+0.2 规整成 0.3。现在保留原值 0.30000000000000004。
    //   为什么这是对的：0.30000000000000004 就是 IEEE754 双精度下 0.1+0.2 的**正确**结果，
    //   它与 0.3 的差（5.55e-17）就是双精度表示 0.3 本身的误差下界。
    //   要不要把这个误差抹掉，属于**显示层**的职责（格式化时保留几位），
    //   不属于**求解层**的职责（解是多少就是多少）。
    const noisy = 0.1 + 0.2;                      // = 0.30000000000000004
    chk('roundToGrid(0.1+0.2) 原样返回（恒等，不做格点吸附）',
      rtg(noisy) === noisy, `0.1+0.2 → ${rtg(noisy)}`);

    // ④ 无理数绝不能被吸附到近邻短小数
    const sqrt2 = Math.SQRT2;
    chk('roundToGrid(√2) 原样保留（不吸附到 1.414214）',
      rtg(sqrt2) === sqrt2, `√2 → ${rtg(sqrt2)}`);

    // ⑤ 全域随机抽查：任何输入的相对改变量都不得超过 1e-9
    //    （真量化会给出 ~1e-7~1e-6 量级的改变量，这是「有没有还在量化」的无条件判据）
    let worstRel = 0, worstAt = null;
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < 20000; i++) {
      const x = (rnd() * 2 - 1) * Math.pow(10, Math.floor(rnd() * 12) - 6);
      const y = rtg(x);
      if (typeof y !== 'number' || !isFinite(y)) continue;
      const rel = Math.abs(y - x) / Math.max(1e-300, Math.abs(x));
      if (rel > worstRel) { worstRel = rel; worstAt = x; }
    }
    chk('roundToGrid 2 万次随机抽查：最大相对改变量 <= 1e-9（证明已无量化）',
      worstRel <= 1e-9, `worstRel=${worstRel.toExponential(3)} @ x=${worstAt}`);
  }
}
{
  const r = sb.solve(['x = 1', 'y = 2', 'z = 3', 'u = 4'], ['x', 'y', 'z', 'u'], 6);
  chk('解耦 4 元（整解）仍正常', (r.solutions || []).length === 1, `→ ${(r.solutions || []).length} 解`);
}

console.log('--- G2. 1/3 类循环小数：全精度输出 + 不得谎报无解---');
for (const [eq, exact] of [['3*x = 1', 1 / 3], ['7*x = 1', 1 / 7], ['9*x = 1', 1 / 9], ['11*x = 2', 2 / 11]]) {
  const r = sb.solve([eq], ['x'], 6);
  const s0 = (r.solutions || [])[0];
  chk(`${eq} → 1 解且值正确（不得报无解）`,
    (r.solutions || []).length === 1 && !!s0 && Math.abs(s0.values[0] - exact) < 1e-15,
    `→ ${(r.solutions || []).length} 解${s0 ? ', x=' + s0.values[0] : ''}, conclusion=${r.conclusion}`);
  chk(`${eq} → 未谎报 provenEmpty`, r.provenEmpty !== true, `provenEmpty=${r.provenEmpty}`);
}
{
  // 旧实现会把 1/3 截成 0.333333（误差 3.3e-7），现在必须输出 >=15 位有效数字
  const r = sb.solve(['3*x = 1'], ['x'], 6);
  const v = (r.solutions || [])[0].values[0];
  const digits = String(v).replace(/[^0-9]/g, '').length;
  chk('3*x=1 的解保留 >=15 位有效数字（旧网格化只有 6 位）', digits >= 15, `x=${v}（${digits} 位）`);
}

console.log('--- G3. 真矛盾/真无解的检出能力**未被削弱**（防修过头）---');
{
  const r = sb.solve(['x = 1', 'x = 2'], ['x'], 6);
  chk('x=1 且 x=2 仍判无解', (r.solutions || []).length === 0 && r.error === 'NO_SOLUTION', `error=${r.error}`);
  chk('x=1 且 x=2 仍 provenEmpty', r.provenEmpty === true, `provenEmpty=${r.provenEmpty}`);
}
{
  const r = sb.solve(['x^2+1 = 0'], ['x'], 6);
  chk('x^2+1=0 仍判无解（真无解）', (r.solutions || []).length === 0 && r.conclusion === '无解', `conclusion=${r.conclusion}`);
}
{
  const r = sb.solve(['x^2 = 2'], ['x'], 6);
  chk('x^2=2 仍给 2 解（闸门没变松）', (r.solutions || []).length === 2, `→ ${(r.solutions || []).length} 解`);
  const bad = (r.solutions || []).filter(s => Math.min.apply(null, s.values.map(Math.abs)) < 1);
  chk('x^2=2 的解仍是真根 ±√2（不是被放宽后混进来的伪解）', bad.length === 0, `异常解 ${bad.length} 个`);
}

console.log('--- G4. 去网格化后网格辅助函数应已从引擎消失（防静默回潮）---');
chk('_gridQuantTol 已从引擎移除（网格容差通道不得复活）', typeof sb._gridQuantTol === 'undefined', `type=${typeof sb._gridQuantTol}`);
chk('_valsOnGrid 已从引擎移除', typeof sb._valsOnGrid === 'undefined', `type=${typeof sb._valsOnGrid}`);
{
  // roundToGrid 保留函数名（11 处调用点 + golden 布局表按它归属 numeric/root），
  // 但语义必须是「全精度」：1/3 不得被压到 0.333333
  const g1 = sb.roundToGrid(1 / 3), g2 = sb.roundToGrid(23 / 30), g3 = sb.roundToGrid(Math.sqrt(2));
  chk('roundToGrid 不再量化 1/3（须保留 15 位以上）', String(g1).replace(/[^0-9]/g, '').length >= 15, `→ ${g1}`);
  chk('roundToGrid 不再量化 23/30', Math.abs(g2 - 23 / 30) < 1e-16, `→ ${g2}`);
  chk('roundToGrid 保留 √2 到 15 位', String(g3).replace(/[^0-9]/g, '').length >= 15, `→ ${g3}`);
  // 🔴 2026-10-05 契约变更：roundToGrid 降为**恒等 + −0 归一**（用户指令「去掉所有人为规则、格子」）。
  //   旧契约要求把 0.1+0.2 吸附成 0.3（ULP 级规整）。现在**不做**任何吸附 ——
  //   ULP 吸附的内置判据是「到 6 位小数格点的距离 ≤ 4 ULP」，
  //   那本质上仍是「这个值离哪个格点更近」的人为判断，只是把硬砍放宽成了软吸附。
  //   软硬是程度差别，性质相同：都是让格式化层替数学做决定。整条删掉。
  chk('roundToGrid 是恒等函数（0.1+0.2 原样返回，不再吸附到格点）',
    sb.roundToGrid(0.1 + 0.2) === 0.1 + 0.2, `→ ${sb.roundToGrid(0.1 + 0.2)}`);
  chk('roundToGrid 把 −0 归一为 0（表示层修正，不是数学变换）',
    Object.is(sb.roundToGrid(-0), 0), `→ ${sb.roundToGrid(-0)}`);
  chk('roundToGrid 非有限数原样返回', Number.isNaN(sb.roundToGrid(NaN)) && sb.roundToGrid(Infinity) === Infinity, 'ok');
}
{
  // 恒等函数的直接推论：任何输入都逐位返回（不再有任何"格点"概念）
  const probes = [1 / 3, 23 / 30, Math.sqrt(2), 1e-17, -1e-17, 0.1 + 0.2, 1 / 7, Math.PI, 1e300, -0];
  const allIdentical = probes.every(v => Object.is(sb.roundToGrid(v), v === 0 ? 0 : v));
  chk('roundToGrid 对全部探针都是恒等（除 −0 归一）', allIdentical,
    probes.map(v => `${v}→${sb.roundToGrid(v)}`).join(' '));
}

console.log('--- G5. 完备性两字段必须互补 + 对外口径不得回潮到「有限网格」---');
{
  // 🔴 2026-10-05 第二个 P0：g013 曾出现 provenIsComplete=false 却 candidateMayMiss=false
  //   —— 同一条记录自相矛盾，Agent 读「不会漏解」就会直接采信残缺解集。
  //   判据：任一完备性缺口 ⇒ 可能漏解（fail-closed），两者严格互补。
  const probes = [
    ['x^2+y^2=4', ['x', 'y']],
    ['x^2+y^2=4; x*y=1', ['x', 'y']],
    ['120000*p*(1+p)^360-2500000=0', ['p']],   // g013：unconverged ⇒ 有缺口
    ['x^2+1=0', ['x']],                        // 严格证明无解 ⇒ 无缺口
    ['2^x+x^2-100=0', ['x']],
  ];
  let bad = [];
  let sawGap = 0;
  for (const [eqs, vs] of probes) {
    const r = sb.solve(eqs.split(';').map(s => s.trim()), vs, 6);
    const c = r.completeness || {};
    if (typeof c.provenIsComplete !== 'boolean' || typeof c.candidateMayMiss !== 'boolean') {
      bad.push(eqs + '(字段缺失)');
      continue;
    }
    if ((c.provenIsComplete === false) !== (c.candidateMayMiss === true)) {
      bad.push(eqs + `(complete=${c.provenIsComplete}, mayMiss=${c.candidateMayMiss})`);
    }
    if (c.provenIsComplete === false) sawGap++;
  }
  chk('completeness.provenIsComplete 与 candidateMayMiss 严格互补（无自相矛盾记录）',
    bad.length === 0, bad.length ? '矛盾: ' + bad.join(' | ') : `5 例全一致，其中 ${sawGap} 例有缺口`);
  chk('探测集确实覆盖到「有缺口」路径（否则上面的断言是空跑）', sawGap > 0, `sawGap=${sawGap}`);

  const c0 = sb.solve(['x^2 = 2'], ['x'], 6).completeness || {};
  //   注意正则要写「有限网格(」带左括号：文案里有「非有限网格」这种**否定式**表述，
  //   裸 /有限网格/ 会把正确的口径也判成回潮（我自己先踩了这个坑）。
  chk('completeness.scope 不再宣称「有限网格(6位小数)」',
    !/有限网格\s*\(|6\s*位小数|位小数有限网格/.test(String(c0.scope || '')), String(c0.scope || '').slice(0, 60));
}

console.log(`\n===== 合计: PASS=${pass}  FAIL=${fail} =====`);
process.exit(fail === 0 ? 0 : 1);
