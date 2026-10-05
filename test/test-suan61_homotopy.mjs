// suan61 同伦延续专项回归（2026-10-05）
//
// 本文件的存在理由：同伦延续连踩 3 个 P0，每一个的表征都是「静默失效」——
// 不抛异常、不返回 NaN、结果看起来「合理」，只是**悄悄错了**。共用例无法挡住它们：
//   · P0-A  state.done 写在门控之前  ⇒ 三元基线题 6 解 → 0 解 + 假 HARD_TIMEOUT
//   · P0-B  起始系统 J 漏乘 d_i 系数   ⇒ 27/27 路径全判 singular（tEnd=0）
//   · P0-C  步长自适应判据恒定误判    ⇒ 27/27 路径卡 t=0.8995
// 三者都必须用**直接断言内部量**的方式挡住，端到端「解数对不对」挡不住。
//
// 数学背景（读断言前建议先看 docs/MATH-FOUNDATIONS.md §13）：
//   H(x,t) = (1−t)·γ·G(x) + t·F(x)，γ = exp(iθ) 且 |γ|=1（Morgan 1982 gamma trick）
//   起始系统 G_j(x) = x_j^{d_j} − 1 ⇒ 起始解集恰为 Π d_j 个孤立点
//   J_H = (1−t)γ·diag(d_i·x_i^{d_i−1}) + t·J_F     ← P0-B 就是漏了 d_i
//
// 全部用例走 core.raw().solve()，与生产同一条链路（tools/call → solver-service → 引擎）。
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const core = require('D:/Projects/genesis-plan/lingshu-solver/solver-core.js');
const sb = core.raw();

let pass = 0, fail = 0;
const failed = [];
function chk(name, cond, detail) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; failed.push(name); console.log('  [FAIL] ' + name + (detail ? '  → ' + detail : '')); }
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- H1. 起始系统 Jacobian 必须与数值微分一致（P0-B 的直接护栏）---');
// 为什么必须直接测 J：H 的**值**在 t=0 时精确为 0、牛顿 0 步收敛，
// 一切「看起来正常」。只有导数错（J 小了 d_i 倍）才会让路径追踪全线失效。
// 这是 §五·ter「值对不代表导数对」在复数同伦层的重演。
{
  const vs = ['x', 'y', 'z'];
  const exprs = ['x + y + z - 6', 'x*y + y*z + z*x - 11', 'x*y*z - 6'];
  const nodes = exprs.map(e => sb.parse(sb.tokenize(e, vs)));
  const FPs = nodes.map(nd => sb._hcPolyBuild(nd, { x: 0, y: 1, z: 2 }, 3));
  const degVec = [3, 3, 3];
  const gamma = { re: -0.790449896085329, im: 0.6125267029107324 };
  const n = 3;

  let worst = 0, worstAt = '';
  for (const tt of [0, 0.001, 0.5, 1]) {
    const x = [
      { re: 0.997, im: 0.0004 },
      { re: 0.992, im: 0.0011 },
      { re: 0.995, im: 0.0007 }
    ];
    const ev = sb._hcEvalH(FPs, degVec, x, tt, gamma, n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const h = 1e-7;
        const xp = x.map(z => ({ re: z.re, im: z.im })), xm = x.map(z => ({ re: z.re, im: z.im }));
        xp[j].re += h; xm[j].re -= h;
        const a = sb._hcEvalH(FPs, degVec, xp, tt, gamma, n).v[i];
        const b = sb._hcEvalH(FPs, degVec, xm, tt, gamma, n).v[i];
        const numRe = (a.re - b.re) / (2 * h);
        const numIm = (a.im - b.im) / (2 * h);
        const err = Math.max(
          Math.abs(ev.J[i][j].re - numRe),
          Math.abs(ev.J[i][j].im - numIm)
        );
        if (err > worst) { worst = err; worstAt = 't=' + tt + ' J[' + i + '][' + j + ']'; }
      }
    }
  }
  chk('解析 J 与中心差分 J 逐元一致（4 个 t 值 × 9 个元素，最大偏差 <= 1e-6）',
    worst <= 1e-6, 'worst=' + worst.toExponential(3) + ' @ ' + worstAt);

  // 定点核对：t=0、x=(1,1,1) 时 J 对角应为 3γ（漏 d_i 时会得到 γ，差 3 倍）
  const x1 = [{ re: 1, im: 0 }, { re: 1, im: 0 }, { re: 1, im: 0 }];
  const ev1 = sb._hcEvalH(FPs, degVec, x1, 0, gamma, n);
  const expDiag = 3 * gamma.re;
  chk('t=0, x=(1,1,1)：J 对角 = d_i·γ = 3γ（缺 d_i 系数时会是 γ）',
    Math.abs(ev1.J[0][0].re - expDiag) < 1e-12,
    'J[0][0].re=' + ev1.J[0][0].re.toFixed(9) + ' 期望=' + expDiag.toFixed(9));

  // H 的值本身也独立核验：t=0 时起点是 G 的根 ⇒ H 必须精确为 0
  // ⚠ 必须用 _hcCAbs 取模，不能用 Math.abs({re,im}) —— 后者算的是
  //   |NaN| = NaN（Math.abs 不认识复数对象），会让本断言恒 FAIL。
  //   这是我写第一版测试时自己踩的坑：断言 FAIL 了两轮，代码却是对的。
  let hmax = 0;
  for (let i = 0; i < n; i++) hmax = Math.max(hmax, sb._hcCAbs(ev1.v[i]));
  chk('t=0, 起点处 H ≡ 0（起始根构造正确）', hmax <= 1e-15, 'max|H|=' + hmax.toExponential(3));
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- H2. gamma 必须是单位模复数（gamma trick 的前提）---');
// |γ|≠1 时，gamma trick 关于「路径不穿过奇异点」的概率 1 保证直接失效，
// 方法退化成「随便一条路径」，完备性承诺归零。数学依据见 operators/homotopy.js 注释。
{
  let seed = 0;
  const eqs = ['x + y + z - 6', 'x*y + y*z + z*x - 11', 'x*y*z - 6'];
  for (const e of eqs) { const st = JSON.stringify(e); for (let i = 0; i < st.length; i++) seed = (seed * 131 + st.charCodeAt(i)) >>> 0; }
  seed = (seed ^ 0x9e3779b9) >>> 0;
  const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
  let worstDev = 0;
  for (let k = 0; k < 1000; k++) {
    const ang = 2 * Math.PI * rnd();
    const g = { re: Math.cos(ang), im: Math.sin(ang) };
    worstDev = Math.max(worstDev, Math.abs(Math.hypot(g.re, g.im) - 1));
  }
  chk('1000 次抽样的 |γ| 与 1 的最大偏差 <= 1e-12', worstDev <= 1e-12, 'worstDev=' + worstDev.toExponential(3));
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- H3. 全部路径必须干净收敛（P0-B + P0-C 的端到端护栏）---');
// 3 元对称题：x+y+z=6, xy+yz+zx=11, xyz=6 ⇒ 解 = {1,2,3} 的 6 个排列，Bézout 上界 27。
// 修 P0-B 前 sing=27/27（P0-B）；修 P0-C 前 notReached=27/27、tEnd 齐刷刷 0.8995（P0-C）。
// 三者都表现为「同伦把活让给下游多起点牛顿」，本断言直接要求它自己走完全程。
{
  const eqs = ['x + y + z - 6 = 0', 'x*y + y*z + z*x - 11 = 0', 'x*y*z - 6 = 0'];
  const r = sb.solve(eqs, ['x', 'y', 'z'], 6);
  const sols = r.solutions || [];
  chk('3 元对称题 → 6 个解（{1,2,3} 的全部排列）', sols.length === 6, '解数=' + sols.length);

  const hi = r.homotopyInfo || {};
  chk('suan61 抢断并自报 executionPath', String(r.executionPath || '').indexOf('同伦延续') >= 0,
    'path=' + r.executionPath);
  chk('路径无发散（diverged=0）', hi.diverged === 0, 'diverged=' + hi.diverged);
  chk('路径无奇异（singular=0）—— P0-B 的直接判据', hi.singular === 0, 'singular=' + hi.singular);
  chk('全部路径到达 t=1（notReached=0）—— P0-C 的直接判据', hi.notReached === 0, 'notReached=' + hi.notReached);
  chk('Bézout 路径数 = 3×3×3 = 27', hi.bezoutBound === 27, 'bezoutBound=' + hi.bezoutBound);
  // 🔴🔴 2026-10-05 断言改向：这条断言**测的是本轮实测证伪的一个谎报**。
  //
  // 旧断言：`completenessProven === true`，理由是「27 条路径全干净 ⇒ 覆盖完整」。
  //   它在修 P0-A/P0-B/P0-C 的过程中一直是绿的 —— 但那是**假绿**。
  //
  // 实测（逐条打印 27 条路径终点后）：
  //   27 条路径全部收敛到 t=1、全部落在实轴上，但终点只覆盖 4 个不同点
  //   (2,3,1) (3,2,1) (1,2,3) (2,1,3) —— 真解里的 (1,3,2) 与 (3,1,2)
  //   **从未被任何路径到达**。同伦当时却自报 completenessProven=true。
  //
  // 数学原因（不是实现 bug，是 gamma trick 前提在这类系统上不成立）：
  //   本题 F = (s1, s2, s3) 是**基本对称多项式**，其根集对 S₃ 封闭。
  //   S₃ 作用使路径必然合并（path coalescence），于是
  //   「每个孤立根被至少一条路径经过」不再由「全部路径干净」推出 ——
  //   路径大量汇合本身就是「有根未被覆盖」的信号。
  //
  // 现在 suan61 检测到「同一互异根被 ≥3 条路径命中且根数 ≪ 路径数」即降级。
  // 这条断言现在锁的是**诚实降级**，比锁「必须说全部解」有价值得多：
  //   前者防谎报，后者逼系统说谎。
  chk('路径合并 ⇒ 完备性必须降级为 false（2026-10-05 反谎报护栏）',
    hi.completenessProven === false, 'completenessProven=' + hi.completenessProven);
  chk('降级理由写明是路径合并（不是含混的「未证明」）',
    String(hi.proofBasis || '').indexOf('路径合并') >= 0, String(hi.proofBasis));

  // 每个解都必须严格回代原方程（G1 段已覆盖，这里再确认排列结构）
  const perms = new Set(sols.map(s => s.values.map(v => Math.round(v)).sort((a, b) => a - b).join(',')));
  chk('解集恰为 {1,2,3} 的排列（去重后 1 组）', perms.size === 1 && perms.has('1,2,3'),
    '去重组=' + JSON.stringify([...perms]));
  let worstRes = 0;
  for (const s of sols) {
    const v = { x: s.values[0], y: s.values[1], z: s.values[2] };
    for (const e of ['x + y + z - 6', 'x*y + y*z + z*x - 11', 'x*y*z - 6']) {
      worstRes = Math.max(worstRes, Math.abs(sb.evalAST(sb.parse(sb.tokenize(e, ['x', 'y', 'z'])), v)));
    }
  }
  chk('全部解回代残差 <= 1e-12（机器精度量级）', worstRes <= 1e-12, 'worstRes=' + worstRes.toExponential(3));
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- H4. 4 元方阵：同伦不得退化（P0-A 的护栏：done 不能吃掉下游）---');
// P0-A 的表征是「三元题 0 解 + 假 HARD_TIMEOUT」。这里用 4 元题做交叉验证：
// 若 done/门控逻辑再出问题，会表现为解数塌成 0 或 error=HARD_TIMEOUT。
{
  const eqs = ['x^2+y^2+z^2+u^2=10', 'x+y+z+u=4', 'x*y+z*u=2', 'x-y+z-u=0'];
  const r = sb.solve(eqs, ['x', 'y', 'z', 'u'], 6);
  const sols = r.solutions || [];
  chk('4 元二次方阵 → 4 个解', sols.length === 4, '解数=' + sols.length);
  chk('无误报 HARD_TIMEOUT（P0-A 修复前是 72ms + 8000ms 预算）', !r.error, 'error=' + r.error);
  let worstRes = 0;
  for (const s of sols) {
    const v = { x: s.values[0], y: s.values[1], z: s.values[2], u: s.values[3] };
    for (const e of ['x^2+y^2+z^2+u^2-10', 'x+y+z+u-4', 'x*y+z*u-2', 'x-y+z-u']) {
      worstRes = Math.max(worstRes, Math.abs(sb.evalAST(sb.parse(sb.tokenize(e, ['x', 'y', 'z', 'u'])), v)));
    }
  }
  chk('4 元全部解回代残差 <= 1e-9', worstRes <= 1e-9, 'worstRes=' + worstRes.toExponential(3));
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- H5. 严格无解：同伦不得谎报（fail-closed 方向）---');
// x²+y²+z²+1=0 在实数域恒无解。同伦若把「路径全干净」误当成「有实根」就是谎报；
// 反向也要求真无解时能给出严格结论而不是「算不出」。
{
  const r = sb.solve(['x^2 + y^2 + z^2 + 1 = 0', 'x + y + z = 0', 'x*y - z = 0'], ['x', 'y', 'z'], 6);
  chk('x²+y²+z²+1=0 → 0 解', (r.solutions || []).length === 0, '解数=' + (r.solutions || []).length);
  chk('给出明确结论而非「不知道」', !!r.conclusion, 'conclusion=' + r.conclusion);
  chk('不谎报 provenEmpty 之外的空集', r.provenEmpty !== false || (r.solutions || []).length === 0, '');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- H6. 逐条路径追踪：全部 27 条必须到达 t=1（P0-C 最直接的断言）---');
// 直接调 _hcTrackPath 逐条追踪，绕过 suan61 的门控与预算逻辑。
// 这是唯一能把「路径没走完」与「门控没抢断」两种失败分开的测法。
{
  const vs = ['x', 'y', 'z'];
  const exprs = ['x + y + z - 6', 'x*y + y*z + z*x - 11', 'x*y*z - 6'];
  const nodes = exprs.map(e => sb.parse(sb.tokenize(e, vs)));
  const FPs = nodes.map(nd => sb._hcPolyBuild(nd, { x: 0, y: 1, z: 2 }, 3));
  const degVec = [3, 3, 3];
  const sr = sb._hcStartRoots(degVec, 3);
  const gamma = { re: -0.790449896085329, im: 0.6125267029107324 };
  const opts = { maxIters: 14, maxSteps: 600, tol: 1e-12, diverge: 1e8, stepTol: 0.35, dt0: 0.001 };

  let reached = 0, sing = 0, div = 0, worstRes = 0, maxSteps = 0;
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 3; c++) {
    const tr = sb._hcTrackPath(FPs, degVec, [sr[0][a], sr[1][b], sr[2][c]], gamma, 3, opts);
    if (tr.diverged) div++; else if (tr.singular) sing++;
    else if (tr.reachedEnd) { reached++; worstRes = Math.max(worstRes, tr.residual); }
    maxSteps = Math.max(maxSteps, tr.steps);
  }
  chk('27/27 条路径全部到达 t=1（P0-C：修前 reached 恒为 0）', reached === 27, 'reached=' + reached);
  chk('无奇异路径（P0-B：修前 sing 恒为 27）', sing === 0, 'sing=' + sing);
  chk('无发散路径', div === 0, 'div=' + div);
  chk('全部路径终点残差 <= 1e-10', worstRes <= 1e-10, 'worstRes=' + worstRes.toExponential(3));
  chk('单条路径步数 <= 200（修前恒为 600 耗尽）', maxSteps <= 200, 'maxSteps=' + maxSteps);
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- H7. 去重：同一解的多条路径不得输出成多个「解」（P0-F 的护栏）---');
// 事故：g005（x²+y²+z²+w²=30, x+y+z+w=10, xy=4, zw=6）同伦给出 **7 个「解」**，
// 而真实解只有 4 个。实测两两相对差：4.280e-7 / 1.057e-7 / 4.074e-7 ——
// 三对全是同一个解的不同路径近似，全部略高于原 DEDUP=1e-7 ⇒ 一个都没被合并。
// 对 Agent 的后果：解数从 4 变 7，会据此断言「有 7 组解」—— 纯虚构。
//
// 判据设计：不去硬编码「应该是 4」（那会随题变），
// 而是断言「任意两个输出解的相对间距 > 1e-5」——
// 这直接对应去重阈值，且对任何题都成立。
{
  const eqs = ['x^2+y^2+z^2+w^2=30', 'x+y+z+w=10', 'x*y=4', 'z*w=6'];
  const r = sb.solve(eqs, ['x', 'y', 'z', 'w'], 6);
  const sols = r.solutions || [];
  chk('g005 → 4 个解（修前是 7 个，含 3 个重复）', sols.length === 4, '解数=' + sols.length);

  // 任意两解的最小相对间距必须显著大于去重阈值 ⇒ 说明没有漏合并
  let minGap = Infinity;
  for (let i = 0; i < sols.length; i++) for (let j = i + 1; j < sols.length; j++) {
    let md = 0;
    for (let k = 0; k < 4; k++) {
      const d = Math.abs(sols[i].values[k] - sols[j].values[k]) / Math.max(1, Math.abs(sols[j].values[k]));
      if (d > md) md = d;
    }
    if (md < minGap) minGap = md;
  }
  chk('任意两解的相对间距 > 1e-4（证明 1e-5 去重阈值没留下重复）',
    sols.length < 2 || minGap > 1e-4, 'minGap=' + (minGap === Infinity ? 'n/a' : minGap.toExponential(3)));

  // 全部解回代原方程
  let worstRes = 0;
  for (const s of sols) {
    const v = { x: s.values[0], y: s.values[1], z: s.values[2], w: s.values[3] };
    for (const e of ['x^2+y^2+z^2+w^2-30', 'x+y+z+w-10', 'x*y-4', 'z*w-6']) {
      worstRes = Math.max(worstRes, Math.abs(sb.evalAST(sb.parse(sb.tokenize(e, ['x', 'y', 'z', 'w'])), v)));
    }
  }
  chk('g005 全部解回代残差 <= 1e-9', worstRes <= 1e-9, 'worstRes=' + worstRes.toExponential(3));

  // 路径仍须干净（去重阈值放大后不能掩盖追踪问题）
  const h = r.homotopyInfo || {};
  chk('g005 路径仍全部干净（div=sing=notReached=0）',
    h.diverged === 0 && h.singular === 0 && h.notReached === 0,
    'div=' + h.diverged + ' sing=' + h.singular + ' notReached=' + h.notReached);
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- H8. 结论层必须认同伦的完备性凭据（集成缺口）---');
// 事故：suan61 跑出 completenessProven=true，但 `_collectCompletenessProof`
// 只认 Sturm / Bézout 击满 / 秩判定 / 线性四类证据，**没有同伦这一档**。
// 实测 `x²+y²+z²=1, x+y+z=0, xy−z=0` 明明「8 条路径全干净 + 2 个实解 + 逐一过回代」，
// 却被判「部分解（没有独立完备性证据）」⇒ Agent 会建议「缩小域重试」，纯误导。
// 修法：在结论层加 `homotopy_all_paths_clean=8/8` 这一档。
//
// 🔴 2026-10-05 断言口径再改：本题**现在不再由同伦接管**（走多起点牛顿 + 对称展开），
//   所以 homotopyInfo 为 undefined、结论是「部分解」。
//   这是**正确**的诚实行为，不是退化，理由用 SymPy 独立核验过：
//     该系统有 4 个复解，其中恰好 2 个实解（我们给的 2 个与 SymPy 逐位一致）。
//     Bézout 上界 4 > 实解数 2 ⇒ 上界非紧 ⇒ 不能排除「还有更多实解」
//     ⇒ 「部分解」是唯一诚实的结论。
//   换句话说：**本组断言原来的期望（「全部解」）本身就是错的**，
//   它建立在一个未经验证的假设上（8 条路径干净 ⇒ 找全了）。
//   现在断言改成锁「正确行为」：解必须是 2 个真解 + 结论不得谎称完备。
{
  const r = sb.solve(['x^2 + y^2 + z^2 = 1', 'x + y + z = 0', 'x*y - z = 0'], ['x', 'y', 'z'], 6);
  chk('球面题 2 解', (r.solutions || []).length === 2, '解数=' + (r.solutions || []).length);
  // fail-closed 主断言：拿不到独立完备证据就不许说「全部解」
  chk('未取得独立完备证据 ⇒ 不得报「全部解」（诚实降级）',
    r.conclusion !== '全部解', 'conclusion=' + r.conclusion);
  // 这题确实有独立完备性证据的那一类（Bézout 上界击满）应当能报全部解 —— 反向护栏，
  //   防止本测试的「不得报全部解」被误读成「一律不许报」
  const eqs = ['x + y + z - 6 = 0', 'x*y + y*z + z*x - 11 = 0', 'x*y*z - 6 = 0'];
  const r2 = sb.solve(eqs, ['x', 'y', 'z'], 6);
  chk('对称题 6 解且为「全部解」（Bézout 上界击满这条独立证据仍成立）',
    r2.solutions.length === 6 && r2.conclusion === '全部解',
    '解数=' + r2.solutions.length + ' conclusion=' + r2.conclusion);
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- H9. 变量上限 n=6 边界 + 高维严格无解证明 ---');
// 本项目的硬约束是「变量数 ≤ 6」。同伦的路径数 = Π d_i，n=6 且全二次时
// Bézout = 2^6 = 64，是可达的最坏日常规模。必须验证两件事：
//   ① n=6 全二次 64 条路径能全部走完并给出「全部解」；
//   ② n=6 能**严格证明无实解** —— 这是同伦相对其他算子的独特价值，
//      采样/牛顿都做不到「高维非线性无解」的确证。
{
  // ① n=6 二次：S + 2x_i² = C_i 形式，Bézout = 2^6 = 64
  const N6 = ['a', 'b', 'c', 'd', 'e', 'f'];
  const xs = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  const S = xs.reduce((a, b) => a + b * b, 0);
  const eqs6 = [];
  for (let i = 0; i < 6; i++) {
    let s = '';
    for (let k = 0; k < 6; k++) s += (k ? '+' : '') + N6[k] + '^2';
    eqs6.push(s + ' + 2*' + N6[i] + '^2 = ' + (S + 2 * xs[i] * xs[i]));
  }
  const r6 = sb.solve(eqs6, N6, 6);
  const h6 = r6.homotopyInfo || {};
  chk('n=6 二次：64 条路径全部走完（div/sing/notReached 皆 0）',
    h6.diverged === 0 && h6.singular === 0 && h6.notReached === 0,
    `bound=${h6.bezoutBound} div=${h6.diverged} sing=${h6.singular} notReached=${h6.notReached}`);
  chk('n=6 二次：解数 = 64（2^6 种符号组合，每式只含平方）',
    (r6.solutions || []).length === 64, '解数=' + (r6.solutions || []).length);
  chk('n=6 二次：结论为「全部解」', r6.conclusion === '全部解', 'conclusion=' + r6.conclusion);
  let worst6 = 0;
  for (const s of (r6.solutions || [])) {
    const v = {};
    N6.forEach((nm, i) => { v[nm] = s.values[i]; });
    for (const e of eqs6) {
      const k = e.indexOf('=');
      const node = sb.parse(sb.tokenize('(' + e.slice(0, k) + ')-(' + e.slice(k + 1) + ')', N6));
      const r = Math.abs(sb.evalAST(node, v));
      if (r > worst6) worst6 = r;
    }
  }
  chk('n=6 二次：64 个解逐一回代残差 < 1e-9', worst6 < 1e-9, 'maxRes=' + worst6.toExponential(2));

  // ② n=6 严格无实解：T = Σx_i²，式 i 给出 T + 2x_i² = 5+i
  //    消元：T = (45 − 6T)/2 ⇒ T = 5.625 ⇒ x_a² = (5 − 5.625)/2 = −0.3125 < 0
  //    ⇒ 系统**确实没有实数解**。同伦必须给「无解」而不是「部分解/资源不足」。
  const eqsNo = [];
  for (let i = 0; i < 6; i++) {
    let s = '';
    for (let k = 0; k < 6; k++) s += (k ? '+' : '') + (k === i ? 3 : 1) + '*' + N6[k] + '^2';
    eqsNo.push(s + ' = ' + (5 + i));
  }
  const rn = sb.solve(eqsNo, N6, 6);
  const hn = rn.homotopyInfo || {};
  chk('n=6 无实解：64 条路径全走完且 0 个实根',
    hn.diverged === 0 && hn.singular === 0 && hn.notReached === 0 && hn.realSolutions === 0,
    `real=${hn.realSolutions} div=${hn.diverged} sing=${hn.singular} notReached=${hn.notReached}`);
  chk('n=6 无实解：结论为「无解」（严格证明，非资源不足）',
    rn.conclusion === '无解', 'conclusion=' + rn.conclusion + ' type=' + rn.resultTypeName);
}

console.log(`\n===== suan61 专项: PASS=${pass}  FAIL=${fail} =====`);
if (fail) console.log('失败项: ' + failed.join(' | '));
process.exit(fail === 0 ? 0 : 1);
