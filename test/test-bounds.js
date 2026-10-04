/**
 * 解数上界层（bounds.js）回归测试。
 *
 * ── 这一层为什么必须单独有测试 ────────────────────────────────────
 *   bounds.js 产出的 `best` 会被 solver-service 拿去判「找全了吗」。
 *   也就是说：**一个算错的上界 = 求解器谎称找全了**。比算错解本身更坏 ——
 *   解错了当场就能验证（你把 x=2 代回去），上界错了要等到有人不信你为止。
 *
 * 断言来源的原则同 test-polytope.js：期望值必须能手算，或者必须是硬不变量。
 *
 * 两条**必须靠回归算例**才挡得住的 bug（都真实踩过，写在这里留档）：
 *   1. Bézout 在 Laurent（含负指数）系统上会**低估**。反例
 *        x^-1 + y - 1 = 0 , x + y^-1 - 1 = 0
 *      两个方程各自最高指数都是 1 ⇒ Bézout = 1，但 (C*)^2 里实打实 2 个解
 *      （消元得 y²-y+1=0）。低估的上界配上 found===bound 就会判 complete，
 *      于是谎称「找全了」。修法是把 laurentSafe:false 的界挡在 best 之外。
 *      ↓ 下面 §4 的 Laurent 反例就是它的护栏。
 *   2. 多齐次 Bézout **不是**「永不比总次数差」。x^2+y^2-1=0, x-y=0 里
 *      分块永久式 = 4 > 总次数 Bézout = 2（P^1×P^1 比 P^2 多一族无穷远解）。
 *
 * 不变量清单（随机 200 例，每条对应一条定理）：
 *   I1  BKK ≤ Bézout            Newton 多胞形 ⊆ deg·Δ_n，混合体积单调
 *   I2  Kushnirenko 一致性       支撑相同时必须和 BKK 相等（不等就是 bug）
 *   I3  best 是筛选集的最小值    直接重算一遍，防「筛选逻辑被改坏」
 *   I4  best ≥ 0 且有限          上界不能是负数或 NaN
 *   I5  Laurent 系统不得用不安全界 见上面 bug 1
 *   I6  端到端 found ≤ bound    把 bounds 和求解器绑一起验（最有价值的一条）
 *
 * 运行：node test/test-bounds.js
 */
'use strict';

const { solutionBounds } = require('../services/bounds.js');
const svc = require('../services/solver-service.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`  ✗ ${name}${extra !== undefined ? '  got: ' + JSON.stringify(extra) : ''}`);
}
function eq(name, got, want) { ok(name, got === want, { got, want }); }
const get = (r, name) => { const b = (r.bounds || []).find((x) => x.name === name); return b ? b.value : null; };

// ══ 1. 手算真值 ═════════════════════════════════════════════════════
console.log('手算真值（每条的界都能手推）:');
{
  // (a) 圆 × 直线：2 个解。Bézout = 2·1 = 2，正好等于解数 ⇒ complete 可断言。
  const a = solutionBounds(['x^2+y^2=1', 'x-y=0']);
  eq('x^2+y^2=1 , x-y=0  ⇒ best=2', a.best.value, 2);
  eq('  … 来源是 bezout_total_degree', a.best.name, 'bezout_total_degree');
  eq('  … scopeKey=C^n', a.best.scopeKey, 'C^n');

  // (b) a·b=1, b·c=2, c·a=3 —— 稀疏三元系统的招牌算例。
  // 真值 2 个解（abc=±√6 ⇒ a=±√6/2 等）。Bézout 会虚高到 8，BKK 才对。
  const b = solutionBounds(['a*b-1=0', 'b*c-2=0', 'c*a-3=0']);
  eq('a*b=1,b*c=2,c*a=3 ⇒ best=2（真值就是 2）', b.best.value, 2);
  eq('  … 来源是 bkk_mixed_volume', b.best.name, 'bkk_mixed_volume');
  eq('  … scopeKey=(C*)^n（BKK 只覆盖非零坐标）', b.best.scopeKey, '(C*)^n');
  eq('  … bezout 必须比 bkk 松（稀疏系统上 BKK 才有意义）',
    get(b, 'bezout_total_degree') > get(b, 'bkk_mixed_volume'), true);

  // (c) x^100+x-1=0, y-1=0：Newton 多胞形是 [0,100]×[0,1]，混合体积 = 100。
  // 这是 (C*)^2 里的 100 个复解，所以 100 是真值不是上界。
  const c = solutionBounds(['x^100+x-1=0', 'y-1=0']);
  eq('x^100+x-1 , y-1 ⇒ bkk=100（真值，不是上界）', get(c, 'bkk_mixed_volume'), 100);

  // (d) x^2y+1=0 , xy^2+1=0 ⇒ x=y, x^3=-1 ⇒ 3 解。BKK=3 紧，Bézout=9 松。
  const d = solutionBounds(['x^2*y+1=0', 'x*y^2+1=0']);
  eq('x^2y+1 , xy^2+1 ⇒ best=3（真值 3）', d.best.value, 3);
  eq('  … bezout=9（稀疏 ⇒ BKK 紧得多）', get(d, 'bezout_total_degree'), 9);
  eq('  … 多齐次=5（介于两者之间）', get(d, 'multihomogeneous_bezout'), 5);

  // (e) 一元的三次多项式：所有界都得 ≥ 3（1,2,3 三个实根）。
  const e = solutionBounds(['x^3-6x^2+11x-6=0']);
  eq('x^3-6x^2+11x-6 ⇒ best=3', e.best.value, 3);
  eq('  … kushnirenko 与 bkk 一致（同支撑）', get(e, 'kushnirenko'), get(e, 'bkk_mixed_volume'));
  eq('  … descartes_real=3', get(e, 'descartes_real'), 3);
  eq('  … fewnomial 只在 n===1 时算解数', (e.bounds || []).find((x) => x.name === 'fewnomial_deng_rojas_russell').appliesToSolutionCount, true);

  // (f) 单个含负指数的方程：Milnor–Thom 那种按总次数的界对它不成立，
  //     但 BKK（只覆盖 (C*)^n）必须给出 2。
  const f = solutionBounds(['x^-1+y-1=0', 'x+y^-1-1=0']);
  eq('Laurent ⇒ best 来自 bkk 而非 bezout', f.best.name, 'bkk_mixed_volume');

  // (g) 常数方程归约到非零常数 ⇒ 解数 0，不需要任何上界搜索。
  const g = solutionBounds(['1=0', 'x-1=0']);
  eq('1=0 ⇒ best.value=0', g.best.value, 0);
  eq('  … 界名 constant_equation', g.best.name, 'constant_equation');
}

// ══ 2. fail-closed：拿不到上界就说拿不到 ════════════════════════════
console.log('fail-closed（拿不到上界时 best 必须是 null，绝不猜一个数）:');
{
  const s = solutionBounds(['sin(x)=0']);
  eq('sin(x)=0 ⇒ available=false', s.available, false);
  eq('  … reason=not_polynomial', s.reason, 'not_polynomial');
  eq('  … best=null（不是 undefined：schema 必须稳定）', s.best, null);

  const u = solutionBounds(['x^2+y^2=1']);   // 一方程两变量，欠定
  eq('x^2+y^2=1（欠定）⇒ available=false', u.available, false);
  eq('  … reason=underdetermined', u.reason, 'underdetermined');
  eq('  … best=null', u.best, null);

  const v = solutionBounds(['1=0']);   // 归约成非零常数，方程里根本没有变量
  eq('1=0（无变量）⇒ available=false', v.available, false);
  eq('  … reason=no_variables', v.reason, 'no_variables');
  eq('  … best=null', v.best, null);

  // 早退分支的键必须齐全：键缺失和 null 对 Agent 是两件不同的事。
  for (const [lab, r] of [['sin', s], ['欠定', u], ['无变量', v]]) {
    ok(`${lab} 早退分支字段齐全（best/bestPositive/bounds/unavailable 都在）`,
      'best' in r && 'bestPositive' in r && 'bounds' in r && 'unavailable' in r,
      Object.keys(r).join(','));
  }
}

// ══ 3. 不变量 I1–I4（随机）════════════════════════════════════════
console.log('随机不变量:');
{
  let seed = 20261004;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const ri = (m) => Math.floor(rnd() * m);

  const BAD = { i1: [], i2: [], i3: [], i4: [], i5: [] };
  let used = 0;

  for (let t = 0; t < 200; t++) {
    const n = 2 + ri(2);                       // 2..3 维
    const eqs = [];
    for (let i = 0; i < n; i++) {
      const cnt = 2 + ri(4);                   // 2..5 项
      const seen = new Set();
      const terms = [];
      let guard = 0;
      while (terms.length < cnt && guard++ < cnt * 40) {
        const exps = [];
        for (let k = 0; k < n; k++) exps.push(ri(3));
        const key = exps.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        terms.push({ exps, coef: rnd() < 0.3 ? -1 : 1 });
      }
      let s = '';
      for (const tm of terms) {
        let mono = '';
        for (let k = 0; k < n; k++) {
          if (tm.exps[k] === 0) continue;
          mono += (mono ? '*' : '') + 'v' + (k + 1) + (tm.exps[k] > 1 ? '^' + tm.exps[k] : '');
        }
        s += (tm.coef > 0 ? '+' : '-') + (tm.coef < 0 ? '' : '') + (mono || '1');
        if (mono === '1') s = s;
      }
      eqs.push(s.replace(/^\+/, '') + '=0');
    }

    let r;
    try { r = solutionBounds(eqs); } catch (err) { continue; }
    if (!r || r.available !== true) continue;
    used++;
    const laurent = r.equations.some((e) => e.laurent);

    const bez = get(r, 'bezout_total_degree');
    const bkk = get(r, 'bkk_mixed_volume');

    // I1  BKK ≤ Bézout（Newton 多胞形 ⊆ d_i·Δ_n，混合体积对参数单调）
    if (bkk !== null && bez !== null && Number.isFinite(bkk) && Number.isFinite(bez) && bkk > bez) {
      BAD.i1.push({ eqs, bkk, bez });
    }
    // I2  同支撑时 Kushnirenko 必须与 BKK 相等（代码里标了 agreesWithBKK，这里独立复核）
    const kush = get(r, 'kushnirenko');
    if (kush !== null && bkk !== null && kush !== bkk) BAD.i2.push({ eqs, kush, bkk });
    // I3  best 必须是「coversAllRealSolutions 且（非 Laurent 或 laurentSafe）」集合里的最小值
    const cand = (r.bounds || []).filter((b) => b.coversAllRealSolutions && (!laurent || b.laurentSafe));
    if (cand.length) {
      const mn = Math.min.apply(null, cand.map((b) => b.value));
      if (!r.best || r.best.value !== mn) BAD.i3.push({ eqs, best: r.best && r.best.value, mn });
    }
    // I4  best 必须是有限非负数
    if (r.best && !(Number.isFinite(r.best.value) && r.best.value >= 0)) BAD.i4.push({ eqs, best: r.best.value });
    // I5  Laurent 系统上 best 必须来自 laurentSafe 的界（防 bug 1 回归）
    if (laurent && r.best) {
      const src = (r.bounds || []).find((b) => b.name === r.best.name);
      if (src && src.laurentSafe === false) BAD.i5.push({ eqs, name: r.best.name });
    }
  }

  eq(`I1 BKK ≤ Bézout（${used} 例）`, BAD.i1.length, 0);
  eq(`I2 Kushnirenko ≡ BKK（${used} 例）`, BAD.i2.length, 0);
  eq(`I3 best = 筛选集最小值（${used} 例）`, BAD.i3.length, 0);
  eq(`I4 best 有限非负（${used} 例）`, BAD.i4.length, 0);
  eq(`I5 Laurent 不用不安全界（${used} 例）`, BAD.i5.length, 0);
}

// ══ 4. Laurent 反例护栏（bug 1 的回归测试）═══════════════════════════
console.log('Laurent（bug 1 回归护栏）:');
{
  // 这两个方程在 (C*)^2 里恰有 2 个复解（消元 ⇒ y²-y+1=0）。
  // 2026-10-04 前：best = bezout = 1 < 2 —— 上界**低估**，配合 found===bound
  // 会让求解器谎称「找全了」。修复后 best 必须来自 bkk = 2。
  const r = solutionBounds(['x^-1+y-1=0', 'x+y^-1-1=0']);
  eq('x^-1+y-1 , x+y^-1-1 ⇒ best=2（不能是 1）', r.best.value, 2);
  eq('  … 且必须来自 bkk_mixed_volume', r.best.name, 'bkk_mixed_volume');
  eq('  … bezout 那条仍在 bounds 里作信息，但不得当 best',
    get(r, 'bezout_total_degree'), 1);
}

// ══ 3b. 热带次数界的护栏（2026-10-04，**低估比没界更危险**）═══════════════
console.log('热带次数界（绝不得当解数上界）:');
{
  // 曾经的 bug：把 Thm 1.3 的「Tdeg ≤ |M|−1」逐方程相乘当 (C*)^n 的解数上界。
  // 那是个范畴错误 —— Tdeg 是**热带超曲面的次数**（tropicalize 之后的几何对象），
  // 与代数解的个数之间没有「逐条相乘」的关系。
  // 反例：x²−2=0 与 y²−3=0 各有 2 个实根 ⇒ 共 4 个；
  //       每条支撑 {0,2} 给 |M|−1 = 1，相乘 = 1 ⇒ **界把 4 压成 1**。
  // 低估会让 completeness 判成 complete ⇒ 求解器谎称找全了。
  const r = solutionBounds(['x^2-2=0', 'y^2-3=0']);
  eq('x²−2 , y²−3 ⇒ best=4（不得被压成 1）', r.best.value, 4);
  ok('best ≥ 真实解数 4（不等即说明有界在低估）', r.best.value >= 4, r.best);
  // 另一组：x²+y²=25, xy=12 有 4 个实解（x,y = ±3,±4 与 ±4,±3）
  const r2 = solutionBounds(['x^2+y^2=25', 'x*y=12']);
  eq('x²+y²=25 , xy=12 ⇒ best=4（不得被压成 2）', r2.best.value, 4);
  // ⭐ 结构性护栏：bounds 里**不得出现**任何按支撑集跨度（diam₁/|M|）算的界。
  //   这条比逐个反例更强：将来有人再写一条同类界，立刻被抓。
  const forbidden = (r.bounds || []).filter((b) =>
    /diam|l1|spread|support.?size|\|M\|-1/i.test((b.name || '') + ' ' + (b.basis || '')));
  eq('bounds 里没有任何「支撑集跨度」类界（数量）', forbidden.length, 0);
  ok('  … 逐个列出便于排查', forbidden.length === 0, forbidden.map((b) => b.name));
  // 热带层仍作为独立几何出口可用，但语义是「热带次数的上界」
  const TROP = require('../services/tropical.js');
  const t = TROP.tropicalDegreeBound([{ exponents: [0], coeff: 1 }, { exponents: [2], coeff: -2 }], 1);
  ok('热带层仍暴露 diam₁（作为几何量）', t.l1diameter === 2, t.l1diameter);
  ok('  … 且自称是上界而非解数', /UPPER BOUND/.test(t.caveat), t.caveat.slice(0, 40));
}

// ══ 5. 端到端：found ≤ bound（把上界和求解器绑一起验）══════════════
console.log('端到端（求解器实际找到的解数不得超过上界）:');
{
  const cases = [
    { eqs: ['x^2+y^2=25', 'x*y=12'], vars: ['x', 'y'], found: 4, bound: 4 },
    { eqs: ['x+y=3', 'x-y=1'], vars: ['x', 'y'], found: 1, bound: 1 },
    { eqs: ['x^2-2=0', 'y^2-3=0'], vars: ['x', 'y'], found: 4, bound: 4 },
    { eqs: ['x^3-6x^2+11x-6=0'], vars: ['x'], found: 3, bound: 3 },
    { eqs: ['x^2+y^2=1', 'x-y=0'], vars: ['x', 'y'], found: 2, bound: 2 }
  ];
  for (const c of cases) {
    const r = svc.doSolve({ equations: c.eqs, variables: c.vars });
    const comp = r.trust.completeness;
    // ⚠ 2026-10-04 拆成两层断言（原来一条断言同时管 found / bound / status，
    //   结果任何门控一落地就整条红，而它其实**不在这条断言的管辖范围**）：
    //   · found / bound —— 这条断言真正要守的：**上界不得低估**（本文件 3b 节的血泪）。
    //     低估会让 found===bound 判成 complete ⇒ 谎称找全，是最严重的错。
    //   · status —— 引擎侧的定理事实，展示截断**不影响**它（见下方长注释）。
    ok(`${c.eqs.join(' , ')} ⇒ found=${c.found} 且 completeness.bound=${c.bound}（上界未低估）`,
      r.solutionCount === c.found && comp.bound === c.bound,
      { found: r.solutionCount, status: comp.status, bound: comp.bound, scope: comp.scope });
    // 展示是否被截断：从**返回体自己**读，不写死数字 ——
    //   写死 `> 2` 就是「与 AGENT_MAX_SOLUTIONS 同步」的人工负担，
    //   改那常数时忘了改这里就会得到一条恒假/恒真的假护栏（2026-10-04 踩过）。
    const capped = r.solutionCount > r.solutions.length;
    // status 的期望值：**恒为 complete**（2026-10-04 改口径）。
    //
    // ⚠⚠ 原断言要求「展示被截断 ⇒ status=unknown(displayCapped)」，本轮**推翻**了它。
    //   它在钉一个过度保守的门控：对已被 Sturm/Bézout **证过完备**的方程组，
    //   因为 Agent 眼前只摆了 2 个解，就把 status 降成 unknown ——
    //   那是把「知道」说成「不知道」，**与「谎称找全」同样是谎报**，只是方向相反。
    //
    //   为什么原来那么写（原注释的理由）：「引擎视角 complete ≠ Agent 视角 complete」。
    //   这个顾虑本身对，但**解法错了**：正确做法不是把 status 降级，
    //   而是让 Agent 拿到「确实只有 N 个、其中你还差几个、怎么取回」这三件事：
    //     · completeness.status = complete   （引擎 Knows what it knows：定理结论）
    //     · conclusion         = 部分解      （Agent 此刻掌握什么：决策事实）
    //     · trust.moreAvailable + nextOffset （怎么把剩下的取回来：可执行动作）
    //   三者同时给出时 Agent 的判断是准确的；而 status=unknown 会让它以为
    //   「可能有第 N+1 个解」⇒ 无谓地继续搜索，或干脆不敢收工。
    //
    //   详细论证见 docs/MATH-FOUNDATIONS.md §10.5。
    ok(`${c.eqs.join(' , ')} ⇒ status=complete（展示截断不降级完备性：引擎已证完备）`,
      comp.status === 'complete',
      { got: comp.status, bound: comp.bound, found: r.solutionCount });
    if (capped) {
      // 展示截断必须在**另外两处**留痕，否则「Agent 只看到一部分」这件事就不可见了
      ok(`  … 且展示截断在 conclusion/trust 处留痕（status 不背这个锅）`,
        r.conclusion === '部分解'
        && comp.displayCapped === true
        && r.trust.moreAvailable === r.solutionCount - r.solutions.length
        && typeof r.nextOffset === 'number',
        {
          conclusion: r.conclusion, displayCapped: comp.displayCapped,
          moreAvailable: r.trust.moreAvailable, nextOffset: r.nextOffset
        });
      ok(`  … 且不是 domainUnproven（那是另一种降级，语义不同）`,
        comp.domainUnproven !== true,
        { domainUnproven: comp.domainUnproven });
    }
  }
}

// ══ 6. 规模闸：超预算时必须明说「这条界没给出」══════════════════════
console.log('规模闸（超预算时报 unavailable，不是静默少一条）:');
{
  const dense = ['a^2+b^2+c^2+d^2+e^2+f^2-1=0', 'a*b+c*d+e*f-1=0',
    'a+b+c+d+e+f-3=0', 'a*b*c-1=0', 'd*e*f-2=0', 'a*d+b*e+c*f-1=0'];
  const t0 = Date.now();
  const r = solutionBounds(dense);
  const ms = Date.now() - t0;
  eq('6 变量稠密 ⇒ BKK 进 unavailable', (r.unavailable || []).map((u) => u.name).join(','), 'bkk_mixed_volume');
  eq('  … reason=resource_limit', r.unavailable[0].reason, 'resource_limit');
  eq('  … best 仍由 bezout 给出（降级，不是全无）', r.best.name, 'bezout_total_degree');
  ok(`  … 耗时 < 1500ms（实测 ${ms}ms）`, ms < 1500, ms);
}

// ══ 6b. 缩写表护栏：真实界名必须**逐字**命中表，不靠截断兜底 ════════
// 2026-10-04 实测 bug：solver-service.js 的 SHORT_NAMES 表里写的是
//   kushnirenko_bound / descartes_positive_roots / descartes_real_roots（带后缀），
//   而 bounds.js 里真实名字是 kushnirenko / descartes_positive / descartes_real。
//   三个 key 全失配 ⇒ 全掉进 10 字符截断 ⇒ descartes_positive 与
//   descartes_real **双双变成 'descartes_'** —— 两条语义完全不同的界
//   （正根上界 vs 实根上界）被压成同一个缩写，Agent 会误以为是同一条界。
// 这条断言比「名字好不好看」重要得多：它是**信息丢失**的护栏。
console.log('缩写表（真实界名必须逐字命中，不靠截断）:');
{
  const svc = require('../services/solver-service.js');
  // 收集多个系统能触发到的**全部**真实界名
  const systems = [
    ['x^2=2'], ['x^2-2=0', 'y^2-3=0'], ['x^2+y^2=25', 'x*y=12'],
    ['x^2*y+1=0', 'x*y^2+1=0'], ['x^3-6x^2+11x-6=0'],
    ['x^10+y^10-1=0', 'x^10-y^10-1=0']
  ];
  const all = new Set();
  for (const s of systems) {
    try {
      const r = solutionBounds(s);
      for (const b of (r.bounds || [])) all.add(b.name);
      for (const u of (r.unavailable || [])) all.add(u.name);
    } catch (e) { /* 拿不到就跳过，不因此漏掉别的系统 */ }
  }
  // 直接从 bounds.js 源码取注册的名字 —— 断言不能只覆盖「我碰巧试出来的」
  const src = require('fs').readFileSync(require.resolve('../services/bounds.js'), 'utf8');
  for (const m of src.matchAll(/name:\s*'([a-z_]+)'/g)) all.add(m[1]);

  // 与 solver-service.js 的表逐字比对
  const svcSrc = require('fs').readFileSync(require.resolve('../services/solver-service.js'), 'utf8');
  const tblBlock = svcSrc.match(/SHORT_NAMES\s*=\s*\{([\s\S]*?)\n\s*\};/);
  ok('solver-service.js 里有 SHORT_NAMES 表（可被本断言读到）', !!tblBlock, '未找到表');
  const table = new Set();
  if (tblBlock) {
    for (const m of tblBlock[1].matchAll(/([a-z_]+)\s*:\s*'([^']*)'/g)) table.add(m[1]);
  }
  const missing = [...all].filter((n) => !table.has(n));
  eq('所有真实界名都在缩写表里（数量）', missing.length, 0);
  ok('  … 逐个列出便于排查', missing.length === 0, missing);

  // 结构性护栏：缩写**必须两两不同**。两条界压成同一个缩写 = 信息丢失。
  const seen = new Map();
  for (const n of all) {
    const abbr = (tblBlock && new RegExp(n + "\\s*:\\s*'([^']*)'").exec(tblBlock[1]));
    if (!abbr) continue;
    const a = abbr[1];
    if (seen.has(a)) { ok(`缩写 '${a}' 不撞名`, false, [seen.get(a), n]); }
    seen.set(a, n);
  }
  ok('  … descartes 正根/实根缩进不同缩写（撞名就是信息丢失）',
    seen.get('desc+') === 'descartes_positive' && seen.get('descR') === 'descartes_real',
    { 'desc+': seen.get('desc+'), 'descR': seen.get('descR') });

  // 端到端：x^2=2 的返回体里 bestFrom 必须是可识别的缩写（不是截断名）
  const r = svc.doSolve({ equations: ['x^2=2'], variables: ['x'] });
  const bc = r.trust.completeness;
  ok('x^2=2 ⇒ bestFrom=bezout（不是截断名）', bc.bestFrom === 'bezout', bc.bestFrom);
  ok('  … boundsConsidered 报出「一共几条界」', /=\d+ of \d+$/.test(bc.boundsConsidered), bc.boundsConsidered);
  ok('  … 且没有任何 ' + "'" + '_' + "'" + ' 结尾的截断名',
    !/_$/.test(bc.bestFrom), bc.bestFrom);
}

// ══ 7. 确定性 ══════════════════════════════════════════════════════
console.log('确定性:');
{
  const a = JSON.stringify(solutionBounds(['x^2*y+1=0', 'x*y^2+1=0']));
  const b = JSON.stringify(solutionBounds(['x^2*y+1=0', 'x*y^2+1=0']));
  eq('同一输入两次结果字节级一致', a === b, true);
}

console.log('\n上界测试: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
