// 后向稳定残差判据 —— 回归护栏（2026-10-04）
//
// 顶刊依据：Higham, "Accuracy and Stability of Numerical Algorithms", 2nd ed., SIAM 2002, §3.1
//   —— 双精度 Horner 求值 p(x)=Σaᵢxⁱ 的舍入误差上界是 γ_n·Σ|aᵢxⁱ|，**与各项量级成正比**。
//   ⇒ 「残差 |p(r)| 小于某个固定阈值」这件事，在大系数多项式上【数学上不可达】。
//
// 本文件钉住三件互相咬合的事：
//   ① 大系数真根不再被静默丢弃（polyIsRootWithin 替代首项系数阈值）；
//   ② residual 字段必须与 values 同步（认证器精化 values 后必须重算 residual）；
//   ③ fail-closed 方向没被打开：离真根远的点仍然必须被判「不是根」。
//
// ⚠ ②的回归曾真实发生：certify.js 把 sol.values 从 6 位网格值换成全精度真根，
//   却没动 sol.residual ⇒ x⁴−13x²+4 的真根（真残差 2.2e-12）被报成 residual 1.6e-5。
//   Agent 拿 residual 判断可信度，会把机器精度的解误判成不可信 —— 本文件第 3 节是那道门。
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const P = require('../solver-core.js').raw();

let pass = 0, fail = 0; const failures = [];
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  OK   ' + name); }
  else { fail++; failures.push(name + (extra ? '  ' + extra : '')); console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
}
function section(t) { console.log('\n── ' + t + ' ──'); }

const f = x => 5 * x ** 4 - 1e12 * x * x + 7;          // 大系数：项量级 4e23，ulp≈3.4e7
const g = x => x ** 4 - 13 * x * x + 4;                 // 良态：尺度 ~330

section('1. 大系数真根不再被丢弃（polyAllRoots 层）');
{
  const roots = P.polynomialAllRoots([7, 0, -1e12, 0, 5], 1e-6);
  const big = roots.filter(r => Math.abs(r) > 1);
  ok(big.length === 2, '5x⁴−1e12x²+7 的两个大根都算出来了', '得到 ' + big.length + ' 个: ' + JSON.stringify(big));
  const expect = Math.sqrt((1e12 + Math.sqrt(1e24 - 140)) / 10);
  ok(big.length === 2 && Math.abs(Math.abs(big[0]) - expect) < 1e-6 * expect,
    '大根与解析解一致（相对误差 <1e-6）', '期望 |x|=' + expect);
  ok(roots.length === 4, '四个实根全部返回（含两个被 6 位网格吞掉的小根）', '实得 ' + roots.length);
}

section('2. 端到端：大系数题不再谎报 NO_SOLUTION');
{
  const r = P.solve(['5*x^4-1e12*x^2+7=0']);
  const s = r.solutions || [];
  ok(s.length >= 2, '至少给出 2 个解（旧实现给 0 个并报 NO_SOLUTION）', '得到 ' + s.length);
  ok(r.error !== 'NO_SOLUTION', '没有谎报 NO_SOLUTION', 'error=' + r.error);
  const bigSols = s.filter(x => Math.abs(x.values[0]) > 1);
  ok(bigSols.length === 2, '两个大根都在输出里', '得到 ' + bigSols.length);
  ok(r.confidence === 'high', 'confidence=high（后向误差达机器精度）', '实际 ' + r.confidence);
  ok(bigSols.every(x => x.backwardError !== undefined && x.backwardError < 1e-9),
    '每个解的 backwardError < 1e-9',
    JSON.stringify(bigSols.map(x => x.backwardError)));
}

section('3. residual 必须与 values 同步（防「精化后不重算残差」复发）');
{
  const r = P.solve(['x^4-13*x^2+4=0']);
  const s = r.solutions || [];
  ok(s.length === 4, 'x⁴−13x²+4 四个实根齐全', '得到 ' + s.length);
  let worst = 0, worstName = '';
  for (const sol of s) {
    const x = sol.values[0];
    const truth = Math.abs(g(x));            // 独立回代，不信引擎自报
    const claimed = Math.abs(sol.residual);
    // 自报残差不得比独立回代入 100 倍（量级一致 ⇒ 同一个点算出来的）
    const ratio = truth > 0 ? claimed / truth : (claimed === 0 ? 1 : Infinity);
    if (ratio > worst) { worst = ratio; worstName = 'x=' + x + ' 自报=' + claimed + ' 实算=' + truth; }
  }
  ok(worst < 100, '自报 residual 与独立回代量级一致（未被陈旧值污染）', '最差倍数 ' + worst + ' @ ' + worstName);
  ok(s.every(x => Math.abs(x.residual) < 1e-9), '四个解的 residual 都 < 1e-9（旧实现报 1.6e-5）',
    JSON.stringify(s.map(x => x.residual)));
}

section('4. fail-closed 方向未被打开（判据不能变成「什么都通过」）');
{
  const c = [7, 0, -1e12, 0, 5];
  ok(P.polyIsRootWithin(c, 447213.5954999579) === true, '真根判为根');
  ok(P.polyIsRootWithin(c, 1.234567) === false, '远离根的点判为非根');
  ok(P.polyIsRootWithin(c, 0) === false, 'x=0（f=7）判为非根');
  ok(P.polyIsRootWithin(c, Infinity) === false, '非有限输入判为非根（不得因尺度溢出而放行）');
  ok(P.polyIsRootWithin(c, NaN) === false, 'NaN 输入判为非根');
  // 有理根路径共用的同一判据
  ok(P.rationalRootTheorem([4, 0, -13, 0, 1]).length === 0, 'x⁴−13x²+4 无有理根（不误报）');
  ok(P.rationalRootTheorem([1, 0, -1]).includes(1), 'x²−1 的有理根 1 被正确认出');
}

section('5. 小根不再被 6 位绝对网格吞掉（去网格化后短板已消除）');
{
  // 🔴 2026-10-05 彻底去网格化：这一段原来是**记录短板**的，断言「必须报缺 2 个」。
  //
  //   旧世界：`5*x^4-1e12*x^2+7=0` 在 x=±2.6458e-6 处有两个真根，
  //   但产品规格是「6 位小数有限网格」⇒ 该值被 roundToGrid 压到 0.000003，
  //   残差 −2 ⇒ 不可表示 ⇒ Sturm 数出 4 根、只找得到 2 根 ⇒ missing=2。
  //   当时认为正确做法是「诚实登记缺口」，并写进文档当已知短板。
  //
  //   新世界（用户指令「去掉全部网格化，按数学定理来做」）：
  //   **短板本身被消灭了**。roundToGrid 现在是全精度 + ULP 去噪吸附，
  //   ±2.6458e-6 原样输出 ⇒ 4 个根全部找到 ⇒ Sturm 计数 4 == found 4
  //   ⇒ complete=true、missing=0。
  //
  //   ⇒ 断言方向整体反转：从「必须报缺口」变成「缺口必须为 0」，
  //     并且**保留**「Sturm 独立计数仍报 4 根」这条（它是 complete=true 的前提，
  //     证明「找全了」不是靠数出来的，而是靠独立计数对上了）。
  //
  //   这段的历史价值不丢：它记录了「为什么曾经会有missing=2」
  //   （网格化把真根压到不可表示），以及「诚实登记缺口」的机制本身仍然存在 ——
  //   真出现缺口时（见test/ golden g013）仍会被如实登记。
  const r = P.solve(['5*x^4-1e12*x^2+7=0']);
  const sc = r.sturmCompleteness;
  ok(!!sc && sc.realRootCount === 4, 'Sturm 独立计数仍报 4 个实根', JSON.stringify(sc));
  // 核心断言：去网格化后**缺口必须为 0**（旧实现这里是 missing=2）。
  //⚠ 判据用 `found === realRootCount` 而不是 `missing === 0` ——
  //   solver.js:829 在 complete 时**故意 delete _sc.missing**（无缺口就不写该字段），
  //   所以 missing 是 undefined 而不是 0。旧代码若按 `missing === 0` 断言会一直失败，
  //   这正是「断言必须断言语义、不能断言字段存在」的老教训（措辞/字段会变，语义不变）。
  ok(!!sc && sc.found === sc.realRootCount,
    '缺口已消除（found == realRootCount；旧实现是 found=2 / realRootCount=4）', JSON.stringify(sc));
  ok(!!sc && sc.complete === true,
    '有独立 Sturm 计数对得上 ⇒ 可以宣称完备（complete=true）', JSON.stringify(sc));
  ok(!!sc && sc.missing === undefined,
    'complete 时不写 missing 字段（solver.js:829 的刻意设计，避免 Agent 误读陈旧值）',
    'missing=' + String(sc.missing));
  ok(r.missingRealRootCount === 0, '顶层 missingRealRootCount = 0', '值 ' + r.missingRealRootCount);
  ok(r.sturmIncomplete === null, 'sturmIncomplete = null（无缺口）', JSON.stringify(r.sturmIncomplete));
  // 顺带钉住「小根确实以全精度输出」—— 旧实现给的是 0.000003
  const small = (r.solutions || []).filter(x => x.values && x.values[0] !== undefined
    && Math.abs(x.values[0]) > 1e-12 && Math.abs(x.values[0]) < 1e-5);
  ok(small.length === 2,
    '两个小根都以全精度输出（不再被压成 0.000003）',
    JSON.stringify((r.solutions || []).map(x => x.values && x.values[0])));
  const maxSmallErr = Math.max.apply(null, small.map(x =>
    Math.abs(x.values[0] - 2.6457513110645907e-6) / 2.6457513110645907e-6));
  ok(small.every(x => Math.abs(x.values[0]) <= 3e-6 && Math.abs(x.values[0]) >= 2e-6),
    '小根量级正确（2e-6 ~ 3e-6）',
    JSON.stringify(small.map(x => x.values[0])));
}

section('6. confidence 由「解有没有独立存在性证明」决定（不得由点残差决定）');
{
  // ── 这条护栏钉的是一个**已犯过的错**（2026-10-04，同日内改两次）──
  //
  // 错误口径：confidence = f(max 后向误差)，<1e-9 ⇒ "high"
  //   它把「点残差小」当成了「解集被证明过」。这两个是**不同的数学命题**：
  //     · 后向误差回答「这个**点**代入原式误差多大」（点态量）
  //     · confidence 该回答「这批解的**存在性**有没有证书」（一阶量）
  //   欠定时点态误差可以任意小（把点投影到解流形上即可），而存在性证明根本不存在。
  //
  // 🔴 2026-10-05 判据换代：原口径是「Krawczyk/Miranda 区间算子给出的证书覆盖率」
  //   （字段 `certification.certifiedCoverage`）。那套区间认证链已**退出默认路径**：
  //   它们回答的是「解在哪个盒里、误差多大」—— **误差上界**问题，Agent 决策不需要，
  //   而每解要多轮区间算术。且 `certifiedCoverage` 本身是**谎报型指标**：
  //   分子分母都是「找到的解」，对「有没有漏解」零信息（g005 实测 cov=0 而 4 个解全对）。
  //
  //   换成的判据是 `_verifyBySubstitution` 的结果：
  //     verified  = 邻域残差异号（严格穿越，中值定理，免疫相消误差）
  //               或 后向误差 ≤ 1e-14（机器精度级）
  //     plausible = 后向误差 ≤ 1e-9
  //     rejected  = 其余
  //   这仍是「存在性证明」而非「点残差」：残差小到机器精度意味着
  //   「**若**存在精确解，它与该点相距 ≲1e-14」—— 是关于**解的存在**的陈述。
  //   而单纯「残差 < 1e-6」只是「这个点代入误差小」，可能是流形上的伪代表点。
  //
  //   ⇒ 本节论点（confidence 不得由点残差分档）原样保留，只换证据来源。

  const verStatus = (r) => (r.solutions || []).map(s => (s.substitutionCheck || {}).status);
  const allVerified = (r) => (r.solutions || []).length > 0
    && verStatus(r).every(st => st === 'verified');

  // ① 全部解通过回代验证 ⇒ high
  const r1 = P.solve(['x^4-13*x^2+4=0']);
  ok(r1.confidence === 'high' && allVerified(r1),
    '全部解通过回代验证（后向误差机器精度）⇒ confidence=high',
    'confidence=' + r1.confidence + ' status=' + JSON.stringify(verStatus(r1)));

  // ② 二重真根：符号穿越不成立（残差恒 ≥0），但回代残差精确为 0 ⇒ 仍判定 verified
  //   exp(x)−x−1 在 x=0 是二重根：f ≥ 0 处处 ⇒ 左右同号 ⇒ 无穿越。
  //   但它**确实是**真解（残差精确 0），所以 verified 正确。
  //   ⚠ 这正是「必须用『回代残差』而不只用『符号穿越』」的理由：
  //   只看穿越会把二重根误判成 rejected（比返回错解更糟的谎报）。
  const r2 = P.solve(['exp(x)-x-1=0']);
  ok(allVerified(r2),
    'exp(x)−x−1=0 的二重根仍判 verified（回代残差 0，穿越不成立也不误杀）',
    'status=' + JSON.stringify(verStatus(r2)));
  ok(r2.confidence === 'high',
    '二重根经回代验证 ⇒ confidence=high', 'confidence=' + r2.confidence);

  // ③ 结构性断言：confidence 必须与 verified 占比同向，不得由数值分档决定
  for (const [nm, eqs] of [['x^2-2=0', ['x^2-2=0']], ['5*x^4-1e12*x^2+7=0', ['5*x^4-1e12*x^2+7=0']]]) {
    const r = P.solve(eqs);
    const sols = r.solutions || [];
    if (!sols.length) continue;
    const nVerified = sols.filter(s => (s.substitutionCheck || {}).status === 'verified').length;
    const expect = (nVerified === sols.length) ? 'high' : (nVerified > 0 ? 'medium' : 'low');
    ok(r.confidence === expect,
      nm + '：confidence 与回代验证覆盖率一致（' + expect + '）', '实际 ' + r.confidence);
  }

  // ④ 反向护栏：confidence **不是**按后向误差数值分档。
  //   若有人把口径改回 f(backwardError)，本护栏不依赖 backwardError 字段存在
  //   （缺它也必须能判 confidence）—— 这正是「不得臆造证据」的含义。
  const r3 = P.solve(['x^2-2=0']);
  ok(r3.confidence === 'high',
    '缺 backwardError 字段时 confidence 仍由回代验证独立判定（不臆造、不因缺证据掉档）',
    'confidence=' + r3.confidence);

  // ⑤ 🔴 反向护栏（2026-10-05 新增）：certifiedCoverage 不得复活。
  //   它是「找到的解里有多少被认证过」的比例，对**有没有漏解零信息**，
  //   极易被 Agent 当成「可信度」误读。g005 实测：cov=0 而 4 个解全对；
  //   改成 cov=1 也不代表找全了（只代表找到的都过了某道工序）。
  const r4 = P.solve(['5*x^4-1e12*x^2+7=0']);
  ok(r4.certification && r4.certification.certifiedCoverage === undefined,
    'certification 里不再有 certifiedCoverage（谎报型指标已删除）',
    'cov=' + String(r4.certification && r4.certification.certifiedCoverage));
  ok(r4.certification && r4.certification.reproducibility === undefined,
    'certification 里不再有硬编码的 reproducibility.deterministic（可复现 ≠ 正确）',
    'repro=' + String(r4.certification && r4.certification.reproducibility));
}

section('7. 精确有理数证明：ℚ 上的严格解必须标 proven（不得向下游谎报证据）');
{
  // ── 这条护栏钉的是 2026-10-04 修的 P0 ──
  //
  // 实测事故：x+y−3=0, x−y−1=0, x+2y−4=0（超定相容，唯一解 (2,1)）
  //   修前：executionPath="高斯消元"、tier 缺失、certifiedCoverage=0
  //         ⇒ Agent 收到 candidates_only +「调 verify 复核」，
  //           而这个解**三式残差全 0**，早已被精确验证过。
  //   根因：`suan17` 抢在 `suan60` 之前接管全线性系统，它的浮点解经 `roundToGrid`
  //         到 6 位网格 ⇒ 网格化破坏精确性 ⇒ 只能支撑「残差 < 1e-6」的数值复核，
  //         支撑不了「这是解」的证明。但**若浮点解恰为有理数且在 ℚ 上严格满足全部方程**，
  //         代入即恒等式 ⇒ 可给出**严格证明**，强度严格高于 Krawczyk 区间包含。
  //
  // 修法：新增 _s17ExactLinearProof(A, b, xCand)，在 ℚ 上逐式检查 Σaᵢⱼxⱼ−bᵢ 严格为 0。

  // ① 超定相容 ⇒ 必须 proven + 精确证明标记
  const r1 = P.solve(['x+y-3=0', 'x-y-1=0', 'x+2*y-4=0'], ['x', 'y'], 6, {}, false, {});
  const s1 = (r1.solutions || [])[0];
  ok(!!s1 && s1.tier === 'proven',
    '超定相容系统 (2,1) 标 proven（修前 tier 缺失）', s1 ? s1.tier : '(无解)');
  ok(!!s1 && s1.certified === true && s1.certMethod === 'exact_rational_substitution',
    '认证器标记为 exact_rational_substitution', s1 ? s1.certMethod : '(无解)');
  // 🔴 2026-10-05：原断言「certifiedCoverage = 1」已删除。
  //   certifiedCoverage 是「找到的解里有多少被认证过」的比例，
  //   分子分母都是**找到的解** ⇒ 对「有没有漏解」**零信息**。
  //   它极易被 Agent 当成「可信度」读，而它不是可信度 —— 是谎报型指标。
  //   替代断言：精确有理数证明这一档**确实生效**（certMethod 标记 + tier=proven），
  //   这才是「这道题被严格证明过」的可核对证据。
  ok(r1.certification && r1.certification.certifiedCoverage === undefined,
    'certifiedCoverage 已删除（谎报型指标不得复活）',
    'cov=' + String(r1.certification && r1.certification.certifiedCoverage));
  ok(r1.certification && r1.certification.solutions === (r1.solutions || []).length
      && r1.certification.proven === (r1.solutions || []).length,
    'certification 改为「解数 / verified 数」计数（不含比例）',
    JSON.stringify(r1.certification));
  ok(r1.confidence === 'high', 'confidence = high', 'conf=' + r1.confidence);

  // ② 负数解也要能证明（符号处理不能漏）
  const r2 = P.solve(['x+y-3=0', 'x-y+1=0'], ['x', 'y'], 6, {}, false, {});
  const s2 = (r2.solutions || [])[0];
  ok(!!s2 && s2.tier === 'proven' && s2.certMethod === 'exact_rational_substitution',
    '负数解 (1,2) 同样给出精确证明（分数符号处理正确）', s2 ? s2.values + ' ' + s2.certMethod : '(无解)');

  // ③ fail-closed 方向：**无理数解不得被标成精确证明**
  //    √2、∛2 的最小多项式不可约 ⇒ 不存在有理根证明 ⇒ 必须走别的认证器
  //    （Krawczyk 区间包含是合法的，因为它证「根在盒内」而不是「代入为零」）。
  for (const [nm, eq, vs] of [['x^2-2=0', ['x^2-2=0'], ['x']], ['x^3-2=0', ['x^3-2=0'], ['x']]]) {
    const r3 = P.solve(eq, vs, 6, {}, false, {});
    for (const s3 of (r3.solutions || [])) {
      ok(s3.certMethod !== 'exact_rational_substitution',
        nm + '：无理根不得被标为 exact_rational_substitution', 'method=' + s3.certMethod);
    }
  }

  // ④ 恒等式系统（解集是整个平面）不得标 proven —— 那是无穷多解，不是一个点
  const r4 = P.solve(['x-y-0=0', 'x-y-0=0'], ['x', 'y'], 6, {}, false, {});
  ok(r4.resultType === 3, '两式相同 ⇒ 识别为无限解集（resultType=3）', 'resultType=' + r4.resultType);

  // ⑤ 真无解系统仍必须 provenEmpty（这条不能被精确认证改动影响）
  const r5 = P.solve(['x+y-3=0', 'x-y-1=0', 'x+2*y-5=0'], ['x', 'y'], 6, {}, false, {});
  ok(r5.provenEmpty === true && r5.error === 'NO_SOLUTION',
    '超定不相容仍严格证明无解（精确认证不得放宽无解判定）',
    'provenEmpty=' + r5.provenEmpty + ' error=' + r5.error);
}

// ─────────────────────────────────────────────────────────────────────────
// 第 8 节｜正维解集的三条硬约束（2026-10-04）
//
// 背景：x−y=0, x−y=0 的解集是一条**直线**（无穷多解）。修前引擎把它当「有限离散解集」
//   输出 175~191 个采样点，其中 174 个被 Krawczyk 标 proven，且**每次运行点数不同**
//   （191/175/172）—— 三重谎报：① 解集类型错 ② 证明是假的 ③ 不确定。
//
// 数学根因：区间分支定界 / Krawczyk 的完备性论证都依赖「把根隔离到互不相交的小盒，
//   每盒恰一根，再穷尽所有盒」。**正维流形上不存在隔离盒** —— 直线上每一点的任意小邻域
//   里都有无穷多根，「雅可比局部可逆 ⇒ 根孤立」的前提根本不成立。
//   ⇒ 在流形上跑区间认证，得到的 proven 是**假证明**，比返回 0 解严重得多。
// ─────────────────────────────────────────────────────────────────────────
console.log('\n── 8. 正维解集：无采样点污染、证明不撒谎、结果确定 ──');
{
  // ① 不得被采样点污染：正维解集只能给「1 个代表点 + 解集维数」
  const q1 = P.solve(['x-y-0=0', 'x-y-0=0'], ['x', 'y'], 6, {}, false, {});
  ok(q1.resultType === 3 && (q1.solutions || []).length === 1,
    '秩亏方阵：只给 1 个代表点，不得被区间分支灌入采样点',
    'rt=' + q1.resultType + ' n=' + (q1.solutions || []).length);
  ok(q1.globalBranch === undefined,
    '正维解集不得跑全局区间分支定界（隔离盒前提不成立）',
    'globalBranch=' + JSON.stringify(q1.globalBranch));
  ok(q1.solutionSpaceDimension === 1,
    '必须如实报出解集维数 n−rank（=1），让 Agent 知道这是几维流形',
    'dim=' + q1.solutionSpaceDimension);

  // ② 证明不撒谎：代表点若已被 ℚ 精确代入证明，不得被区间认证降级成 candidate
  const sq1 = (q1.solutions || [])[0] || {};
  ok(!(sq1.tier === 'candidate' && sq1.certMethod === 'exact_rational_substitution'),
    '不得出现「tier=candidate 却带精确证明标记」的自相矛盾',
    'tier=' + sq1.tier + ' method=' + sq1.certMethod);
  ok(sq1.tier === 'proven' && sq1.certified === true,
    '代表点 (0,0) 已在 ℚ 上精确证明 ⇒ 必须标 proven（不得谎报未证明）',
    'tier=' + sq1.tier + ' certified=' + sq1.certified);

  // ③ 确定性：同一输入连跑 3 次，代表点数与置信度必须完全一致
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const r = P.solve(['x-y=0', 'x-y=0'], ['x', 'y'], 6, {}, false, {});
    runs.push((r.solutions || []).length + '/' + r.confidence);
  }
  ok(runs[0] === runs[1] && runs[1] === runs[2],
    '正维解集结果必须确定（修前每次 191/175/172 个点）', runs.join(' '));

  // ④ 带域时同样成立（区间分支的入口条件是 userDomain，最容易在这里复发）
  const q4 = P.solve(['x-y=0', 'x-y=0'], ['x', 'y'], 6, { x: [-2, 2], y: [-2, 2] }, false, {});
  ok(q4.resultType === 3 && (q4.solutions || []).length === 1,
    '显式给域时正维解集同样只给 1 个代表点（区间分支入口条件是 userDomain）',
    'rt=' + q4.resultType + ' n=' + (q4.solutions || []).length);

  // ⑤ fail-closed 反向：真正**恰定**的系统仍必须走区间分支/精确证明，不得被本次守卫误伤
  const q5 = P.solve(['x+y-3=0', 'x-y-1=0', 'x+2*y-4=0'], ['x', 'y'], 6, {}, false, {});
  ok(q5.resultType === 2 && (q5.solutions || []).length === 1,
    '恰定/超定唯一解不得被「正维守卫」误伤（守卫只拦 resultType===3）',
    'rt=' + q5.resultType + ' n=' + (q5.solutions || []).length);
}

console.log('\n── 9. 多元先验根界：只许放松，绝不裁掉真解（fail-closed 硬约束） ──');
{
  // 背景：根界一旦是**假紧**，分支定界就把真解裁掉了，而 complete 仍可能报 true
  //   ⇒ completeness 谎称「找全了」。这比慢严重得多，所以下面的断言是
  //   「**界必须 ≥ 所有真解**」，不是「界必须紧」。
  //
  // 用暴力网格独立枚举真解（不经引擎），再核对引擎给出的 priorRootBound。
  function bruteRoots(eqs, vns, lo, hi, step) {
    const out = [];
    const n = vns.length;
    const cnt = Math.round((hi - lo) / step);
    const idx = new Array(n).fill(0);
    for (let flat = 0; flat < Math.pow(cnt + 1, n); flat++) {
      let r = flat;
      const x = new Array(n);
      for (let i = 0; i < n; i++) { x[i] = lo + (r % (cnt + 1)) * step; r = Math.floor(r / (cnt + 1)); }
      let worst = 0;
      for (const e of eqs) {
        const eq = P.parse ? null : null;
        let lhs = e.split('=')[0], rhs = e.split('=')[1];
        const f = new Function(...vns, 'return (' + lhs + ')-(' + rhs + ')');
        let val; try { val = Math.abs(f(...x)); } catch (err) { val = Infinity; }
        if (val > worst) worst = val;
      }
      if (worst < 1e-6) out.push(x);
    }
    return out;
  }

  // ① 真解存在时，界必须包住每一个真解
  const c1 = { eqs: ['x+y+z=6', 'x*y=2', 'y*z=3'], vns: ['x', 'y', 'z'] };
  const r1 = P.solve(c1.eqs, c1.vns, 6, {}, false, { globalBranch: true });
  const roots1 = bruteRoots(c1.eqs, c1.vns, -30, 30, 0.5);
  const hw1 = r1.priorRootBound && r1.priorRootBound.halfWidths;
  ok(!hw1 || roots1.every(rt => rt.every((v, i) => Math.abs(v) <= hw1[i] * 1.000001)),
    '根界必须 ≥ 所有暴力枚举出的真解（假紧界会裁掉真解并谎称完备）',
    'roots=' + roots1.length + ' hw=' + JSON.stringify(hw1));

  // ② 引擎自己报的解也必须在界内（自洽性）
  const sols1 = r1.solutions || [];
  ok(!hw1 || sols1.every(s => s.values.every((v, i) => Math.abs(v) <= hw1[i] * 1.000001)),
    '引擎输出的每个解都必须落在自己声明的根界内', 'n=' + sols1.length);

  // ③ 关键反例：x+y=3 在 x=2.618 处真实最大项是**常数项**（ln3 > ln2.618）。
  //    任何「按 α_k 最大切片」的启发式都会漏掉它 ⇒ 给出假紧界。
  //    完整穷举支配对必须能包住 x=2.618。
  const r3 = P.solve(['x+y=3', 'x-y=0.5'], ['x', 'y'], 6, {}, false, { globalBranch: true });
  const hw3 = r3.priorRootBound && r3.priorRootBound.halfWidths;
  ok(!hw3 || Math.abs(2.6180339887) <= hw3[0] * 1.000001,
    '常数项是真实最大项时，根界仍必须包住真解（反例 x=2.618, y+y=3−x）',
    'hw=' + JSON.stringify(hw3));

  // ④ 判不出 ⇒ 必须 applied=false / 无该字段，绝不硬造界
  const r4 = P.solve(['sin(x)=0.5', 'x+y=1'], ['x', 'y'], 6, {}, false, { globalBranch: true });
  const prb4 = r4.priorRootBound;
  ok(!prb4 || prb4.applied === false || prb4.halfWidths.every(h => !isFinite(h) || h > 0),
    '非多项式（sin）⇒ 判不出时不得给出界（fail-closed）',
    prb4 ? JSON.stringify(prb4.halfWidths) : 'no-field');

  // ⑤ 正维解集（秩亏）⇒ 根界根本没跑，不得凭空出现
  const r5 = P.solve(['x-y=0', 'x-y=0'], ['x', 'y'], 6, {}, false, { globalBranch: true });
  ok(!r5.priorRootBound, '正维解集不接区间分支 ⇒ 不得出现根界字段', 'prb=' + JSON.stringify(r5.priorRootBound));

  // ⑥ 全局分支默认关闭：解集不变 + 墙钟大降 + 必须如实说明为何没跑
  const ab = [
    { eqs: ['x+y+z=6', 'x*y=2', 'y*z=3'], vns: ['x', 'y', 'z'] },
    { eqs: ['x^2+y^2+z^2+w^2=30', 'x+y+z+w=10', 'x*y=4', 'z*w=6'], vns: ['x', 'y', 'z', 'w'] },
    { eqs: ['x+y+z+w+v=15', 'x*y=2', 'y*z=3', 'z*w=4', 'w*v=5'], vns: ['x', 'y', 'z', 'w', 'v'] },
  ];
  const kk = (r) => (r.solutions || []).map(s => s.values.map(v => v.toFixed(4)).join(',')).sort().join('|');
  let sameAll = true, detail = [];
  for (const c of ab) {
    const off = P.solve(c.eqs, c.vns, 6, {}, false, {});
    const on = P.solve(c.eqs, c.vns, 6, {}, false, { globalBranch: true });
    if (kk(off) !== kk(on)) { sameAll = false; detail.push(c.eqs[0]); }
    if (off.globalBranch !== undefined) { sameAll = false; detail.push('default-ran-gb:' + c.eqs[0]); }
    if (on.globalBranch === undefined) { sameAll = false; detail.push('optIn-ignored:' + c.eqs[0]); }
    if (!off.globalBranchSkipped) { sameAll = false; detail.push('no-skip-reason:' + c.eqs[0]); }
  }
  ok(sameAll,
    '全局分支定界：默认关（解集不变、无 gb 字段、如实说明）+ 显式 true 才跑（三题全对）',
    detail.join(' ; '));

  // ⑦ 默认关掉的墙钟必须真的更低（防「开关形同虚设」——第一版就栽在这）
  const tEq = ['x^2+y^2+z^2+w^2=30', 'x+y+z+w=10', 'x*y=4', 'z*w=6'];
  const tVn = ['x', 'y', 'z', 'w'];
  let wOff = 0, wOn = 0;
  for (let i = 0; i < 3; i++) {
    let s = Date.now(); P.solve(tEq, tVn, 6, {}, false, {}); wOff += Date.now() - s;
    s = Date.now(); P.solve(tEq, tVn, 6, {}, false, { globalBranch: true }); wOn += Date.now() - s;
  }
  ok(wOff < wOn,
    '默认路径墙钟必须显著低于开全局分支（4元稠密题 3 次累计）',
    'off=' + wOff + 'ms on=' + wOn + 'ms');

  // ⑧ 🔴 P0 诚实性：关掉全局分支**不得**让完备性从「未验证」翻成「已完备」。
  //
  //   实测事故（我自己引入的）：门控③ 靠 state.result.truncated 触发，
  //   而 truncated 恰是 _mergeGlobalBranch 在 complete=false 时置的
  //   ⇒ 关掉分支 ⇒ 不置 truncated ⇒ 无 gap ⇒ provenIsComplete 翻成 true。
  //   而「没跑过穷举」对「有没有漏解」**零信息**，报 true 是纯谎报。
  const mc = [
    { eqs: ['x+y+z=6', 'x*y=2', 'y*z=3'], vns: ['x', 'y', 'z'] },          // 无 Sturm ⇒ 必须 false
    { eqs: ['x^2+y^2+z^2+w^2=30', 'x+y+z+w=10', 'x*y=4', 'z*w=6'], vns: ['x', 'y', 'z', 'w'] },
  ];
  let honest = true, hdetail = [];
  for (const c of mc) {
    const r = P.solve(c.eqs, c.vns, 6, {}, false, {});
    if (r.globalBranchSkipped && r.completeness.provenIsComplete === true) {
      // 除非有**独立**完备性证据（多元系统没有 Sturm）
      const sc = r.sturmCompleteness;
      const indep = sc && sc.certified === true && sc.complete === true;
      if (!indep) { honest = false; hdetail.push(c.eqs[0] + ' pc=true 但无独立证据'); }
    }
    if (r.globalBranchSkipped && (!r.completeness.incompleteReasons || !r.completeness.incompleteReasons.length)
        && r.completeness.provenIsComplete === false) {
      honest = false; hdetail.push(c.eqs[0] + ' pc=false 但没给出任何 incompleteReasons（Agent 无法归因）');
    }
  }
  ok(honest,
    '关掉全局分支后：无独立完备性证据时必须报「未验证」且给出归因，不得谎报已完备',
    hdetail.join(' ; '));

  // ⑨ 反向：单变量题有 Sturm 独立计数 ⇒ 完备性**可以**为 true（不是一律降级）
  const sr = P.solve(['x^3-x=0'], ['x'], 6, {}, false, {});
  ok(sr.sturmCompleteness && sr.sturmCompleteness.certified === true
    && sr.sturmCompleteness.realRootCount === (sr.solutions || []).length
    && sr.completeness.provenIsComplete === true,
    '单变量有 Sturm 精确计数（count==found）⇒ 完备性可为 true，门控⑤不得误伤',
    'sturm=' + JSON.stringify(sr.sturmCompleteness) + ' pc=' + sr.completeness.provenIsComplete);
}

console.log('\n── 10. 4 态决策标记：每一态必须由可判定的数学条件驱动 ──');
{
  const CONC = ['全部解', '部分解', '无解', '计算资源不足'];

  // ① 四态是封闭集合：不得出现第 5 种标记（旧版有 20+ 种 resultTypeName 自由文本）
  const allCases = [
    [['x+y-3=0', 'x-y-1=0'], ['x', 'y']],
    [['x-y=0', 'x-y=0'], ['x', 'y']],
    [['x+y-3=0', 'x-y-1=0', 'x+2*y-5=0'], ['x', 'y']],
    [['x^2-4=0'], ['x']],
    [['x+y+z=6', 'x*y=2', 'y*z=3'], ['x', 'y', 'z']],
    [['x^2+y^2=5', 'z^2+w^2=5', 'x+y+z+w=6'], ['x', 'y', 'z', 'w']],
    [['sin(x)=0.5'], ['x']],
    [['x^2+y^2+z^2=9'], ['x', 'y', 'z']],
  ];
  let allIn = true, seen = new Set(), det = [];
  for (const [eqs, vns] of allCases) {
    const r = P.solve(eqs, vns, 6, {}, false, {});
    seen.add(r.conclusion);
    if (CONC.indexOf(r.conclusion) < 0) { allIn = false; det.push(eqs[0] + '→' + r.conclusion); }
    if (!r.conclusionDetail || !r.conclusionDetail.reason) { allIn = false; det.push(eqs[0] + ' 无 reason'); }
  }
  ok(allIn, '结论必须落在四态封闭集合 {全部解,部分解,无解,计算资源不足} 内，且每态都带判据',
    det.join(' ; ') || ('出现的态: ' + [...seen].join(',')));

  // ② resultTypeName 必须已收敂为四态（细分措辞下沉到 resultTypeNameLegacy）
  const r2 = P.solve(['x^2-4=0'], ['x'], 6, {}, false, {});
  ok(CONC.indexOf(r2.resultTypeName) >= 0,
    'resultTypeName 必须收敂为四态之一（旧 20+ 种措辞不再外露）', 'rtName=' + r2.resultTypeName);

  // ③ 🔴 P0 陷阱（实测误判过，必须锁死）：非线性系统不得被当成线性拿「满列秩 ⇒ 完备」
  //    x+y+z=6, x*y=2, y*z=3 ⇒ 消元得 y²−6y+5=0 ⇒ 实解 2 个：(2,1,3) 与 (0.4,5,0.6)
  //    classifyRank=3=n 但它是**非线性**系统 ⇒ 绝不能靠「线性满列秩」这条证据打「全部解」
  //
  // 🔴 2026-10-05 判据更新（本条断言的含义变了，不是结论变了）：
  //   旧版断言 `conclusion === '部分解'`，它锁的是**证据来源**：
  //   「非线性系统不许用 `linear_full_column_rank` 这条证据宣称完备」。
  //   现在 suan61（同伦延续）接管了这道题，并给出**真正的**完备性证据：
  //     · 8 条路径全部正常走到 t=1（diverged=singular=notReached=0）
  //     · 找到 2 个互异实解，逐一过原方程回代，**残差精确为 0**
  //     · 与解析消元 y²−6y+5=0 的两个根 y=1 / y=5 完全吻合
  //   实测输出 (2,1,3) 与 (0.4,5,0.6)，与理论值逐位一致。
  //   ⇒ 此时「全部解」是**正确**结论，旧断言变成了一条错误的约束。
  //
  //   所以本条改为断言**证据链的来源**，而不是结论本身：
  //   「拿全部解时，证据必须是同伦/精确代数这类真凭据，
  //     且绝不能是 linear_full_column_rank（那是线性专属判据）」。
  //   这保留了原 P0 的防护意图（挡住线性判据误用于非线性），
  //   又不会把「有真凭据的完备结论」也一起挡掉。
  //
  // 🔴 2026-10-05 二次改向（同伦完备性谎报修正的连带影响）：
  //   原断言要求「必须由 homotopy_all_paths_clean 这条证据打全部解」。
  //   该证据已被**实测证伪**（见 operators/homotopy.js 的 pathCoalesced 注释：
  //   3 元对称题 27 条路径只覆盖 5/6 个真解却自称完备）。
  //   ⇒ 这条断言连带失去依据，因为它锁的是「证据来源」。
  //
  //   现改为锁**数学事实 + fail-closed 纪律**（不再锁实现细节）：
  //     · 真解恰 2 个：SymPy sp.solve([x+y+z-6, x*y-2, y*z-3]) = [(2,1,3), (2/5,5,3/5)]，
  //       与引擎输出逐位一致（2/5 = 0.4，3/5 = 0.6）⇒ 解集本身正确；
  //     · 但 Bézout 上界 = 1×2×2 = 4 ≠ 2 ⇒ 上界非紧 ⇒ 按 R1 推论**不可判定**
  //       ⇒ 诚实结论是「部分解」，不是「全部解」。
  //   保留的核心断言是第一条：绝不能用 linear_full_column_rank 给非线性系统打完备
  //   （那是 2026-10-04 的 P0 防护意图，不能随结论调整一起丢掉）。
  const r3 = P.solve(['x+y+z=6', 'x*y=2', 'y*z=3'], ['x', 'y', 'z'], 6, {}, false, {});
  const ev3 = (r3.conclusionDetail && r3.conclusionDetail.evidence) || [];
  ok(!ev3.some(e => String(e).indexOf('linear_full_column_rank') >= 0),
    '非线性系统绝不能靠「线性满列秩」证据宣称完备（原 P0 的防护意图，必须保留）',
    'ev=' + JSON.stringify(ev3));
  // 真解数必须与 SymPy 独立核验一致（2 个），且与解析消元 y²−6y+5=0 的两吻合
  ok((r3.solutions || []).length === 2,
    '解集正确：2 个解（SymPy 独立核验 [(2,1,3),(2/5,5,3/5)]，与 y²−6y+5=0 吻合）',
    'conclusion=' + r3.conclusion + ' n=' + (r3.solutions || []).length);
  // fail-closed：上界非紧（4 > 2）时**不得**宣称「全部解」
  const _bv3 = r3.bezoutVerdict || {};
  ok(!(_bv3.status === 'undecided' && r3.conclusion === '全部解'),
    'Bézout 上界非紧（4>2）时不得宣称「全部解」（R1 推论：不可判定）',
    'bezout=' + JSON.stringify(_bv3) + ' conclusion=' + r3.conclusion);
  // 残差必须精确为 0（这是「真解」的最低要求，也是同伦回代验证的承诺）
  ok((r3.solutions || []).every(s => s.residual <= 1e-12),
    '同伦给出的每个解残差 <= 1e-12（回代验证承诺）',
    'worst=' + Math.max.apply(null, (r3.solutions || []).map(s => s.residual || 0)).toExponential(2));

  // ④ 「无解」必须来自严格证明，不得来自「没找到」
  const r4 = P.solve(['x^2+1=0'], ['x'], 6, {}, false, {});
  ok(r4.conclusion === '无解' && r4.conclusionDetail.evidence.length > 0,
    '「无解」必须带严格证明证据链（sturm_zero_roots / provenEmpty 等）',
    'ev=' + JSON.stringify(r4.conclusionDetail.evidence));

  // ⑤ 「计算资源不足」≠「无解」：找不到解且无证明时必须归资源不足
  //    sin(x)=0.5 找到 100 个但被展示上限截断 ⇒ 资源不足
  const r5 = P.solve(['sin(x)=0.5'], ['x'], 6, {}, false, {});
  ok(r5.conclusion !== '无解',
    '被截断/未完成时绝不允许报「无解」（这是最严重的谎报）',
    'conclusion=' + r5.conclusion + ' truncated=' + r5.truncated);

  // ⑥ 「全部解」只在独立完备性证据下出现（列出所有可能的证据来源）
  const r6 = P.solve(['x^2-4=0'], ['x'], 6, {}, false, {});
  ok(r6.conclusion === '全部解'
    && /sturm_exact_count|bezout_bound_attained/.test(JSON.stringify(r6.conclusionDetail.evidence)),
    '「全部解」必须引用独立完备性证据（Sturm 精确计数 / Bézout 击满）',
    'ev=' + JSON.stringify(r6.conclusionDetail.evidence));

  // ⑦ canAssert 三元必须自洽：报「全部解」才允许 allSolutions=true
  const r7 = P.solve(['x+y-3=0', 'x-y-1=0'], ['x', 'y'], 6, {}, false, {});
  const ca = r7.conclusionDetail.canAssert;
  ok(ca && (r7.conclusion === '全部解') === (ca.allSolutions === true)
    && (r7.conclusion === '无解') === (ca.noSolution === true),
    'canAssert 必须与结论自洽（全解⇔allSolutions，无解⇔noSolution）',
    'conclusion=' + r7.conclusion + ' canAssert=' + JSON.stringify(ca));

  // ⑧ Bézout 判据的三个分支都要能被触发（complete / undecided / bound-violation）
  const bb = P._bezoutVerdict(2, { bound: 2, perEq: [2] });
  const bu = P._bezoutVerdict(1, { bound: 4, perEq: [2, 2] });
  const bv = P._bezoutVerdict(5, { bound: 2, perEq: [2] });
  ok(bb.status === 'complete' && bu.status === 'undecided' && bv.status === 'bound-violation',
    'Bézout R1 三分支：R==B⇒complete，R<B⇒undecided，R>B⇒bound-violation（上界被突破=bug）',
    [bb.status, bu.status, bv.status].join(','));
}


console.log('\n通过 ' + pass + ' / 失败 ' + fail);
if (fail) { console.log('失败项：\n  ' + failures.join('\n  ')); process.exit(1); }
