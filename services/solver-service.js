/**
 * 灵数求解器 · 共享求解域（2026-10-03 生产级大改抽出）
 *
 * 为什么存在：
 *   在抽出本文件之前，`mcp-server.js`（stdio）与 `http-mcp-server.js`（HTTP）
 *   各自复制了一份 shapeResult / doSolve / doPolyRoots / doVerify / buildPolyEquation，
 *   **连 MAX_* 护栏常量都各写一份**。复制必然漂移 —— 而且已经漂了：
 *
 *   ⚠️ shapeResult 的「空集」分支两边口径不同（真 bug）：
 *      - http 版（本文件采用）：UNDECLARED_VARIABLE → 无法求解；NO_EQUATION/解析失败 → 未给出解；
 *        provenEmpty===true → 才敢说「严格证明：该方程组无实数解」；其余只说「未找到实数解
 *        （未经标记严格证明不存在）」。
 *      - stdio 版旧实现：只要 typeName==='empty' 且 r.error 为空，**直接输出「严格证明：该方程组
 *        无实数解」** —— 引擎其实只是「区间穷尽没找到」，stdio 端却帮它「严格证明」了。
 *        这是违反产品诚实红线（不谎称证明）的虚报，抽取时统一到 http 版口径即修掉。
 *
 * 契约：两个服务端都通过本文件拿求解能力，任何结果整形口径只在本文件改一次。
 * 零依赖：只依赖 solver-core.js（它自己会 require 构建产物 dist/lingshu.mjs）。
 */
'use strict';

const { solve } = require('../solver-core.js');   // 注意：本文件在 services/ 子目录，回到仓库根取装载器
const { solutionBounds } = require('./bounds.js');
const RB = require('./rootbound.js');             // 多元根界：域从「猜」变「证」（任务 #87）

// ---- 护栏常量（单一事实来源，两个服务端都从这里取，杜绝各写一份后漂移）----
const MAX_TOTAL_CHARS = 100 * 1024;   // 单次请求方程文本总长上限 100KB
const MAX_EQ_COUNT = 64;              // 方程数量上限
const MAX_VAR_COUNT = 6;              // 变量数量上限（与产品规格一致）

// ---- 数值展示位数：Agent 返回体用 4 位（2026-10-03 定）------------------
//
// 为什么是 4 而不是 6：Agent 读的是 text 里的字符串，决定精度的是**有效数字**，
// 不是小数位数。4 位小数对绝大多数工程/财务/AI 场景（相对误差 5e-5 量级）够用，
// 而 text 每解省 ~2 字节 × 多解场景累积可观。
//
// ⚠ 关键：这里**只改展示**，不改求解精度。
//   求解精度（COMPUTE_DECIMALS=6，仍在引擎内）控制残差容差、网格步长、认证半径，
//   是数学保真的底线，碰它就是改数学。实测把 COMPUTE_DECIMALS 降到 4：
//   golden 20/20 的解数/顺序/tier/证书/完备性**零变化**（仅 2 条值漂移 1e-14 浮点噪声），
//   也就是说「改求解精度」当前没带来可观测收益，却永久降低了可证精度 —— 不做。
//   解本身仍以全精度浮点放在 solutions[].values，Agent 需要更多位时自己读那个字段。
const AGENT_DISPLAY_DECIMALS = 4;

// ---- 展示解数上限：防 token 炸弹（2026-10-04）--------------------------
//
// 为什么需要（实测数据，不是假想）：
//   solve('x*cos(x)-x=0', ['x']) 在默认域 ±1e6 内返回 **16 个解 / 4627B** ——
//   已是 1600B 红线的 2.9 倍。而这只是**运气好**的那一档：真解是 x=2kπ，
//   ±1e6 里有约 **31.8 万个**，若引擎多找到一批就是几十 MB。
//   原实现对 solutions[] 没有任何数量上限，而 parity 的字节红线只测了
//   **1 个解**的样例（x^2=2）⇒ 这条红线压根没覆盖多解场景。
//
// 为什么截断是**诚实**的（不是丢答案）：
//   ① solutionCount 仍报引擎找到的**总数**，Agent 知道还有更多
//   ② truncated 由服务层自己置位（引擎可能没标），并有 parity 断言守着
//   ③ completeness 一律降级 unknown+displayCapped（见 buildCompleteness）
//   ⇒ Agent 拿到的是「共找到 N 个、这是前 M 个、未找全」，语义完整。
//
// 为什么是 2（实测定的，不是拍的）：逐档量过返回体字节（cert 压缩后）
//   上限 │ 16解场景 │ 4解场景 │ 单解场景
//     2  │  1398B ✅ │ 1596B ✅ │ 1289B ✅   ← 唯一全部进 1600B 红线的取值
//     3  │  1619B ❌ │ 1864B ❌ │ 1289B
//     4  │  1885B ❌ │ 2199B ❌ │ 1289B
//     8  │  2805B ❌ │ 2199B ❌ │ 1289B
// ⇒ 上限=3 就已经全线撞线。而 Agent 客群是 AI：真要多个解时它会自己给 domain
//   分批查（这也是 tool description 里教它的用法），2 个够它判断「有没有解 / 大致形状」。
//   ⚠ 改这个数必须同时改：test/dual-parity.mjs 的多解护栏、test/test-bounds.js
//   端到端的 capped 判定（那里写死了 3）。
const AGENT_MAX_SOLUTIONS = 2;

const fmtText = (v) => (typeof v === 'number' && isFinite(v)) ? v.toFixed(AGENT_DISPLAY_DECIMALS) : String(v);
// 确定性浮点吸附：消除 IEEE-754 末位 ULP 抖动，保证「同输入输出字节级可复现」
const detF = (v) => (typeof v === 'number' && isFinite(v)) ? Number(v.toFixed(12)) : null;

/**
 * Agent 决策块（2026-10-03 新增，针对 AI Agent 客群）。
 *
 * 为什么需要：改造前的返回里，Agent 要判断「这个数能不能直接用」必须自己遍历
 * solutions[] 逐个读 tier 再做计数与分支 —— 这是把判断逻辑外包给 LLM，正是幻觉高发区。
 * 调研实据：LLM 在多步/分支判断上不可靠，且「被 RLHF 训练成倾向给答案」，
 * 所以它不会主动说「我不确定」。必须由工具把结论算好，直接给可执行判断。
 *
 * trust.trustLevel 的取值是给 Agent 的**行动指令**，不是给人看的形容：
 *   verified_empty  → 严格证明无实数解，可以终止推理链
 *   verified        → 每个解都经区间认证，可直接使用
 *   partially       → 部分解未认证，用前先 verify
 *   candidates_only → 只有候选解，禁止直接使用，必须 verify
 *   unverified      → 引擎只是没找到（≠ 无解），别下结论
 *   undecidable     → 输入本身不可解析/变量未声明，重试无用
 *   budget_exhausted→ 预算耗尽，缩小 domain 或加 budget 重试
 */
/**
 * 完备性块：把「解数上界」和「实际找到几个」并排放给 Agent。
 *
 * ── 为什么这是把几何和代数真正接起来的那一步 ──────────────────────────
 *   上界的主力来自 Newton 多胞形的**混合体积**（BKK）：一个纯几何量（体积）
 *   在这里变成纯代数量（方程组孤立解的个数上界）。这不是类比，是定理
 *   （Bernstein–Kushnirenko–Khovanskii），泛型系数下还取等。
 *   于是引擎第一次能回答「我给你的解是不是全了」，而不只是「我找到这些」——
 *   Agent 最需要的正是这个：它要的是「能不能收工」，不是「有几个数」。
 *
 * 语义（fail-closed，宁可 unknown 也绝不虚报 complete）：
 *   complete   —— 找到的解数 == 上界 ⇒ 不可能再有，可断言「找全了」
 *   incomplete —— 找到的解数 <  上界 ⇒ 可能还有，禁止断言「找全了」
 *   unknown    —— 拿不到上界（输入不支持 / 超闸 / 无限解集）⇒ 什么都不许断言
 *
 * ⚠ 为什么「找到数 == 上界」就能断言找全了（不是估计，是定理）：
 *   上界统计的是**复**孤立解（计重数）。每个互异解的重数 ≥ 1，
 *   所以「互异复解个数 ≤ 上界」；实数解是复解的子集；
 *   故 found 个互异实解 == 上界 ⇒ 复数域里也挤不进第 found+1 个 ⇒ 全了。
 *
 * ── 字段做过一轮瘦身（2026-10-04）：7 个 → 3 个 ─────────────────────
 *   原版带 found / boundSource / reason / mustNotClaim，实测 167B，
 *   把返回体顶到 1652B，撞破 parity 的 1600B 瘦身红线。逐个判：
 *     found        —— 与顶层 solutionCount 完全同值，纯重复 ⇒ 删
 *     boundSource  —— "bkk" / "bezout" 属调试信息；scope 已隐含来源 ⇒ 删
 *     reason       —— 每个 reason 在别处都有唯一对应的可观测信号
 *                     （input_error→trust.undecidable、infinite→resultTypeName、
 *                      bound_unavailable→status='unknown'、bound_violated→status='unknown'）
 *                     ⇒ 删，不留「只在极端情况才出现」的可选字段（schema 不稳定更难解析）
 *     mustNotClaim —— 与 status **完全同值**（status==='complete' 才能断言找全了），
 *                     是同一个判断的两种写法，多带一个字段只是多付 token ⇒ 删。
 *                     注：它跟 trust.mustNotClaim 不是一回事 —— 后者管的是
 *                     「禁止断言无解」，这里管的是「禁止断言找全了」，两条独立的禁令。
 *                     后者保留（字符串枚举，全层级白名单），这条由 status 承载。
 *   留下三个都是**不可替代**的：结论、差多少、这个界覆盖哪块空间。
 */
function buildCompleteness({ eqs, typeName, found, provenEmpty, hasInputError, displayCapped }) {
  const base = { status: 'unknown', bound: null, scope: null };
  if (hasInputError) return base;
  if (typeName === 'infinite') return base;   // 无限解集：上界这个概念本身不适用
  // 「严格证无解」不需要任何上界：解数就是 0。必须排在算上界之前 ——
  // 否则 x^2+y^2+1=0（一方程两变量，上界拿不到）会被误报成 unknown，
  // 明明引擎已经证明空了，Agent 却被告知「不知道全不全」。
  if (provenEmpty) {
    return { status: 'complete', bound: 0, scope: 'C^n', boundsConsidered: [], bestFrom: 'proven_empty' };
  }
  if (!Array.isArray(eqs) || !eqs.length) return base;

  let b;
  try {
    b = solutionBounds(eqs);
  } catch (e) {
    return base;                      // 拿不到上界 ⇒ unknown，绝不猜
  }
  if (!b || b.available !== true || !b.best || !Number.isFinite(b.best.value)) return base;

  const out = { status: 'unknown', bound: b.best.value, scope: b.best.scopeKey || null };

  // ── 把「各条候选界」与「哪一条最紧」透出来（几何 ⇄ 代数融合的可见面）────
  // 以前只报最终 bound，Agent 无从知道它是**哪条定理**给的，
  // 于是既没法复核、也没法在换系统时自己预判哪条会赢。
  // 特别地：热带 ℓ¹-直径界（arXiv:2605.24966 Thm 1.3）在稀疏系统上
  // 会把 Bézout/BKK 的上千压到个位数 —— 这是求解器真正赢过 CAS 的地方，
  // 不透出来等于白做。
  //
  // ⚠ 返回体有硬上限（parity 守着 1600 字节），所以这里**必须压缩**：
  //   逐条 {name, value, scopeKey, coversAllRealSolutions} 四项乘以 4 条界
  //   就是 355 字节 —— 实测把返回体从 1530 顶到 2293，直接撞线。
  //   压成一行还不够：一元系统有 8 条界，全列要 150 字节。
  //
  //   决定：**只列「与 best 不同的」界**，且最多 3 条。
  //   理由：Agent 的判断是「best 够不够、别的界有没有更小的」。
  //   与 best 相同的界不改变任何结论（它们只是互相印证），
  //   全列出来是纯 token。差异的前 3 条足以暴露「有个更紧的界被 scope 排除了」。
  //   要查全部依据让 Agent 调 bounds 工具，那里有全文与 scope 说明。
  if (Array.isArray(b.bounds) && b.bounds.length) {
    // 缩写名：名称本身对 Agent 已足够识别，全名平均 22 字符
    //
    // ⚠⚠ 表里的 key 必须与 services/bounds.js 里 `name:` 字面量**逐字相同**。
    //   2026-10-04 实测踩过：这里写的是 kushnirenko_bound / descartes_positive_roots /
    //   descartes_real_roots（都带后缀），而 bounds.js 里真实的名字是
    //   kushnirenko / descartes_positive / descartes_real（不带后缀）。
    //   三个 key 全部失配 ⇒ 全部掉进下面的 10 字符截断 ⇒
    //   descartes_positive 与 descartes_real **双双变成 'descartes_'**。
    //   后果不是「名字丑」而是**两条语义完全不同的界被压成同一个缩写**：
    //   descartes_positive 数的是**正根**、descartes_real 数的是**实根**。
    //   Agent 看到同一个名字会以为它们是同一条界。
    //
    // 维护纪律：新增界时**必须**同步这张表，且加一条测试断言
    //   「所有真实界名都命中表（不靠截断兜底）」——
    //   只靠截断兜底会把不同界压成同名，是信息丢失。
    const SHORT_NAMES = {
      bezout_total_degree: 'bezout', bkk_mixed_volume: 'bkk',
      multihomogeneous_bezout: 'multihom', milnor_thom_components: 'milnor',
      kushnirenko: 'kush', fewnomial_deng_rojas_russell: 'fewnorm',
      descartes_positive: 'desc+',   // 正根 —— 与下面的实根区分开，不可压成同一个
      descartes_real: 'descR',        // 实根
      constant_equation: 'const'
    };
    const short = (n) => {
      const hit = SHORT_NAMES[n];
      if (hit) return hit;
      // 未登记的名字：砍掉 _total_degree / _mixed_volume / _components 这类
      // 冗余后缀再取前 10 字符。比「原样返回 25 字符的名字」短，
      // 又不会把不同界压成同一个缩写（那是信息丢失，比长更糟）。
      return n.replace(/_total_degree$|_mixed_volume$|_components$|_bound$/, '').slice(0, 10);
    };
    // ⚠ 曾经在这里列「其他界中最紧的一条」，后来删了 —— 那是**误导**：
    //   descartes_positive=1 数的是**正根**，不是全部实根，
    //   把它叫「tightest」等于暗示存在比 best 更紧的全实根上界。
    //   不同 scope 的界之间**不可比**，比大小本身没有意义。
    //   Agent 真正需要的只有一句：best 是多少、从哪条界来的。
    //   要看全部界与各自 scope，让 Agent 调 bounds 工具。
    out.boundsConsidered = short(b.best.name) + '=' + b.best.value
      + ' of ' + b.bounds.length;
    out.bestFrom = short(b.best.name);
  }
  if (Array.isArray(b.unavailable) && b.unavailable.length) {
    // 没算出来的界也要说出来：漏算的界不会自己显形，
    // 少一条依据时 Agent 无从判断「是这条不适用」还是「我漏了」。
    out.boundsUnavailable = b.unavailable.map((x) => ({ name: x.name, reason: x.reason }));
  }

  // provenEmpty 已在上面处理；这里 found===0 且未证无解 ⇒ 落在 incomplete / unknown
  if (found > out.bound) {
    // 上界被突破 = 上界算错，或引擎给出了伪解。二者都是 bug。
    // 绝不静默降级成 complete —— unknown 且 bound 保留，矛盾一眼可见。
    return out;
  }
  // 🔴🔴🔴 原「域门控」已删除（2026-10-04，实测 P0 过度保守，**两个方向都害**）：
  //
  //   旧代码：`if (found === out.bound && !domainProven) { status='unknown'; domainUnproven=true; }`
  //   理由是「found==bound 只在搜索域被证明盖住全部解时才等于找全了，域外可能还有解」。
  //
  //   **这个理由在本模块不成立**，因为 solutionBounds(equations, vars) **压根不接域参数**：
  //   Bézout ∏d_i、BKK 混合体积、多齐次 Bézout、Milnor–Thom、Descartes 全都是
  //   对**整个 C^n / R^n** 的全局断言（services/bounds.js 文件头有完整论证，
  //   并已在返回值上加 `domainFree: true` 作为机器可读的契约）。
  //   「找到数 == 全局上界」本身就蕴含「没有更多解」，**与搜索盒无关** ——
  //   若盒外真藏着解，找到数就会**超过**全局上界，与 found==bound 直接矛盾。
  //   ⇒ 对域无关的界，「盒外还有解」不是「可能」，而是**逻辑上不可能**。
  //
  //   实测两处都被它弄错：
  //     🔴 过度保守：`x^2=2` 域 [-2,2]（两个真解都在盒里，数学上确实完备）→ 报 unknown +
  //        domainUnproven，conclusion 却是「全部解」⇒ 同一返回体自相矛盾，
  //        且是对**知道**的事说「不知道」（与「谎称找全」同罪的另一方向谎报）。
  //     🔴 而且它拦不住真正的谎报：`x^2=2` 域 [1,2] 时 found=1 < bound=2，
  //        根本走不到这个分支，但 Sturm 那边仍会误判「全部解」（已另修，见 _sturmCountAllReal）。
  //   ⇒ 一个既过度保守、又拦不住真正谎报的门控，纯负债。删掉。
  //
  //   ⚠ 保留的纪律：**found 必须只数已证明的解**（见调用方 provenFound），
  //   否则未认证候选点会把 found 撑到 bound ⇒ 谎称 complete（第三个 P0，同源）。
  //
  // ⚠⚠ 展示截断**不**在这里降级（2026-10-04 已修过一次，勿改回）：
  //   原注释写「引擎算全了但 Agent 只拿到前 N 个 ⇒ complete 是在撒谎」。
  //   这个顾虑对「Agent 只看到 solutions[]」成立，但**完备性与展示无关**：
  //   found（=引擎找到的总数）与 bound（=定理上界）比较，这是**引擎侧**的事实，
  //   引擎确实证了「解集恰为这 5 个点」。展示只给了 2 个是**输出层**的容量问题。
  //
  //   原实现把 status 从 complete 降成 unknown，代价是：
  //     · conclusion 也被迫从「全部解」降成「部分解」（上游读的就是这个）
  //     · mustNotClaim / agentAction 也走「不确定」分支
  //   ⇒ 对一个**已被 Sturm 精确计数证过完备**的方程组说「不知道有没有漏解」，
  //     这是**另一方向的谎报**（把知道说成不知道），与「谎称找全」同样是错的。
  //
  //   正确口径：**分开两件事**，缺一不可 ——
  //     completeness.status = complete   （引擎侧：确实找全了，这是定理结论）
  //     trust.moreAvailable = 3          （输出侧：还有 3 个没给你看，去取）
  //   Agent 拿到这两个字段做出的判断是正确的：「确实只有 5 个解，其中 3 个你还没问我要，
  //   要就再问一次」。而 status=unknown 会让它以为「可能有第 6 个解」⇒ 无谓地继续搜。
  //
  //   ⚠ 上游 conclusion 仍会因 capped 从「全部解」降为「部分解」——
  //   那是**故意**的：conclusion 描述的是「Agent 此刻掌握的信息」，
  //   它还没拿到那 3 个，说「全部解」会让它以为不用再问了。两层各自自洽，不是矛盾。
  if (displayCapped) out.displayCapped = true;
  out.status = (found === out.bound) ? 'complete' : 'incomplete';
  return out;
}

function buildTrust({ typeName, allProven, cleanSols, diagnostics, r, hasInputError, completeness, shownFrom }) {
  // ⚠⚠ 计数口径（2026-10-04，🔴 P0 修正）：provenCount 必须数**引擎找到的全部**解，
  //   不能只数展示出来的前 N 个。
  //   实测事故：(x²-1)(x²-4)=0 引擎找到 5 个 proven 解，AGENT_MAX_SOLUTIONS=2 只展示 2 个
  //   ⇒ 旧代码返回 provenCount=2，而同一返回体里 certification.proven=5。
  //   **两个数字直接矛盾**，而 LLM 遇到矛盾字段不会忽略一边，它会挑对自己方便的那半信。
  //   这是幻觉诱因，比字段多更危险。
  //   ⇒ 计数一律用 allSols（引擎真相）；「眼前看到几个」由 solutions.length 自己表达。
  //   allSols 就是 r.solutions（引擎原始列表）；cleanSols 只是它的展示切片。
  const allSols = Array.isArray(r && r.solutions) ? r.solutions : cleanSols;
  const provenCount = allSols.filter((s) => s && s.tier === 'proven').length;
  const total = allSols.length;
  const shown = cleanSols.length;
  // ⚠ moreAvailable = 「**本页之后**还没给过的个数」，必须减掉本页起点 shownFrom。
  //   第一版写 `total - shown`：n=5（越过尾部）时 total=5 / shown=0 ⇒ 报 5，
  //   而实际一个都没剩 ⇒ Agent 按它去 n=5 拿回空页，再看还是 5 ⇒ 死循环。
  //   语义也要求它只数「没给过的」：n=4 拿最后 1 个时 moreAvailable 必须是 0 而不是 4，
  //   否则 Agent 会以为还有 4 个没看过。
  //
  //   ⚠ 这里自算而不接收调用方传的「还有几个」—— 少一个入参就少一处可能不同步的口径。
  //   （第一版还写成 `moreAvailable > 0` 而 moreAvailable 是个不存在的变量，恒 false ⇒
  //     分支永不触发，是一条**假通过**的护栏。教训同「门控字段必须先 grep 核实」。）
  const from = (typeof shownFrom === 'number' && shownFrom > 0) ? shownFrom : 0;
  const moreAvailable = Math.max(0, total - from - shown);
  const displayTruncated = moreAvailable > 0;

  let trustLevel, agentAction, safeToUse;
  if (hasInputError) {
    trustLevel = 'undecidable';
    safeToUse = false;
    agentAction = 'Fix the input and call again: ' + (diagnostics.inputError || 'invalid input')
      + '. Do NOT report this as "no solution" — it means the problem was never solved.';
  } else if (diagnostics.provenEmpty) {
    trustLevel = 'verified_empty';
    safeToUse = true;
    agentAction = 'Strictly proven: this system has NO real solution. Safe to close the reasoning chain.';
  } else if (diagnostics.truncated) {
    // ⚠️ 2026-10-03 判断顺序修正：truncated 必须排在 typeName==='empty' 之前。
    // 原顺序下「被预算截断且一个解都没列出」会落进 unverified 分支，Agent 只收到
    // 「没找到」而不知道**原因是预算用完了**，于是错误地认为重试无用、直接放弃。
    // truncated 是引擎主动放弃的硬信号（可行动作 = 加预算 / 缩定义域），
    // 比「结果为空集」信息量更大，必须优先分类。
    //
    // ⚠⚠ 2026-10-04：本分支**排在展示截断分支之前**（两者可同时为真）。
    //   引擎真中止时，「加预算」是**真**指令（重试有意义），
    //   而「展示截断」的那套「缩 domain 取剩下的」在引擎没算完时是错的
    //   —— 缩 domain 可能把解扔掉。所以引擎中止的可行动作优先。
    trustLevel = 'budget_exhausted';
    safeToUse = false;
    agentAction = 'Search was truncated by the budget, so the solution list may be incomplete. '
      + 'The listed solutions are still valid, but there may be more. Narrow domain or raise budget if completeness matters.';
  } else if (displayTruncated) {
    // 🔴 2026-10-04 新增分支（原先被并进 budget_exhausted，见上方 shapeResult 处的 P0 注释）。
    // 语义完全不同：引擎**已经算完**，只是返回体装不下全部解。
    //   ⇒ 可行动作是「缩小 domain / 用 n 偏移再问一次把剩下的取回来」，
    //     **不是**「加 budget」—— 加 budget 对已算完的题毫无作用（那是假指令）。
    //   ⇒ safeToUse 仍为 true：眼前这几个解都是 certified 的，逐个可用。
    //     旧代码在这里给 safeToUse=false，等于告诉 Agent「已认证的解也不能用」，
    //     逼它去 verify 一遍已经证过的东西 —— 白花 token 还可能引入错误。
    trustLevel = 'complete_but_shown_partially';
    safeToUse = true;
    // ⚠⚠ 2026-10-04 压到 96B（实测 283B ⇒ 整条返回体 1616B 超 1600B 红线）。
    //   压的依据不是「字多」，是**信息已经不在这里了**：
    //     「找到 5 个 / 展示 2 个 / 还剩 3 个」⇒ provenCount / shownCount / moreAvailable
    //     「下一页从哪开始」⇒ 顶层 nextOffset
    //   数字在结构化字段里（Agent 可精确计算），这句话只负责**行动指令**：
    //   「用 nextOffset 再问一次；加预算没用，搜索已经结束了」。
    //   保留最后半句是关键 —— 它是本次 P0 的核心：不能让 Agent 以为重试有用。
    agentAction = 'Search already finished; these solutions are certified and safe to use. '
      + 'More exist: call again with n=nextOffset to page through them. Raising the budget will NOT help.';
  } else if (typeName === 'empty') {
    // ⚠️ 关键诚实点：引擎「区间穷尽没找到」≠「严格证明无解」。绝不能让 Agent 把前者当后者。
    // （此分支现在只在**未截断**时到达：截断的情况已由上面的 budget_exhausted 接管。）
    trustLevel = 'unverified';
    safeToUse = false;
    agentAction = 'NOT proven empty. The engine merely failed to find a solution within budget. '
      + 'Do not state "no real solution" — narrow the domain or raise options.budget and retry, '
      + 'or tell the user the system is undecided.';
  } else if (total > 0 && allProven) {
    trustLevel = 'verified';
    safeToUse = true;
    agentAction = 'All ' + total + ' solution(s) are interval-certified. Safe to use directly.';
  } else if (provenCount > 0) {
    trustLevel = 'partially';
    safeToUse = false;
    agentAction = provenCount + ' of ' + total + ' solutions are certified. Only the tier="proven" ones are safe; '
      + 'verify the rest before using them.';
  } else if (total > 0) {
    trustLevel = 'candidates_only';
    safeToUse = false;
    agentAction = 'No solution is certified — all are candidates. Call verify on the one you intend to use before reporting it.';
  } else {
    trustLevel = 'undecidable';
    safeToUse = false;
    agentAction = 'No result. Treat the problem as unsolved, not as proven-empty.';
  }

  return {
    trustLevel,
    safeToUse,
    agentAction,
    // ⚠ provenCount / candidateCount 现在数的是**引擎找到的全部**解（见函数头注释）。
    //   它们与 certification.proven 同口径，不再互相矛盾。
    provenCount,
    candidateCount: total - provenCount,
    // 🔴 2026-10-04 新增：告诉 Agent「还有多少没给你看」。
    // 为什么必须显式给一个**数字**而不是让 Agent 自己算：
    //   它看到 solutions.length=2 无法区分「只有 2 个解」与「有 5 个但只给了 2 个」——
    //   两种情况的 solutions[] 长得一模一样。而这两种情况的正确行动完全相反
    //   （前者可以收工，后者必须再问一次）。缺这个字段它只能猜，猜错就是漏解。
    //   值为 0 时**不返回**（绝大多数调用是无截断的，不必为它们各花 15 字节）。
    shownCount: displayTruncated ? shown : undefined,
    moreAvailable: displayTruncated ? (total - shown) : undefined,
    // 明确区分两种「什么都没有」，这是 Agent 最容易混淆的地方。
    // ⚠ 2026-10-03 修正：有解时必须为 null。
    // 原实现在「找到 2 个解」的返回体里也写 meaningOfEmpty:"not_found_within_budget"
    // —— 一个和 solutions 数组直接矛盾的自述字段。LLM 读到矛盾不会忽略一边，
    // 它会当成噪声，然后在需要时挑对自己方便的那一半信。对 Agent 来说，
    // 任何自相矛盾的字段都是幻觉诱因，宁可不存在。
    // 三态：null（有解）/ proven_no_real_solution（严格证无解）/ 其余两种没找到。
    meaningOfEmpty: total > 0 ? null
      : (diagnostics.provenEmpty ? 'proven_no_real_solution'
        : (hasInputError ? 'input_not_solvable' : 'not_found_within_budget')),
    // 2026-10-03 瘦身：原先占 162B 的顶层 instructions 字段被删，其唯一不可替代的
    // 硬规则（不得断言无解）浓缩进这一个字段 —— 用枚举而非自然语言，
    // 既省 token 又更精确：Agent 按枚举分支判断，不需要解析英文句子。
    //
    // ⚠ 用「正向白名单」而非「反向黑名单」推导，理由是 fail-closed 的本质：
    // 新增 trustLevel 时黑名单会静默漏掉（这就是第一版的 bug —— agentAction 里
    // 明明有 3 处写着 "Do NOT report this as no solution"，枚举却只覆盖了 2 个层级，
    // 漏了 undecidable）。白名单则相反：新层级默认「禁止断言无解」，要放开必须
    // 显式改这里，漏不掉。枚举字段比自然语言更权威，漏一次就等于没有。
    //
    // 唯一可断言「无解」的层级：verified_empty（严格证明无实数解）。
    // partially / candidates_only 有解存在，只是认证不足，同样禁止报「无解」。
    mustNotClaim: (trustLevel === 'verified_empty') ? null : 'no_solution',
    // 完备性：找到的解数 vs 解数上界（BKK 混合体积 / Bézout …）。
    // Agent 据此判断「能不能收工」。unknown 时禁止断言「找全了」，也禁止断言「还有」。
    completeness: completeness || null
  };
}

// ── 域从「猜」变「证」（任务 #87 的共用入口）──────────────────────────────
//
// 旧行为：默认域半宽 = max(1e6, 最大常量×1000)，上限 1e12 —— 它是**猜**的。
// 「只放大不缩小」保证不漏解，但给不出「域够用」的依据。现在先用**根界定理**
// （rootbound.js：log 空间/热带支配 + 两阶段单纯形）把域**证**出来。
//
// ⚠ 四条硬纪律（踩过的坑，别省）：
//   ① 只信模块自己标 proven 的结果。证不下来（无界 / 组合枚举超预算 / 非多项式）
//      就**回落旧行为**，绝不拿「算出来了但没证完」的数当界 —— 假紧界会让
//      completeness 谎称「找全了」，比慢严重得多。
//   ② 用户显式给了 domain ⇒ 一个字不改（用户域优先，语义也不同：verify 的局部域
//      根本不该拿全局根界去断言「找全了」）。
//   ③ **只在证出来的界比旧默认更大时才改域**。比 1e6 小 ⇒ 保持旧默认不动：
//      解集明明已知在 ±1.5 里，硬塞一个 ±1.5 的域会把引擎的 userDomain 打开，
//      全局分支认证跟着起来（解集与 cert 块变多），返回体顶爆 1600B 红线，
//      而且「收紧」在这个场景只是省几个分支节点，收益 < 风险。
//      放大才是旧策略真正漏解的地方（x=1e11 被 ±1e6 静默判成无解）。
//   ④ completeness 用的是**域无关的全局上界**（Bézout/BKK/多齐次/Milnor–Thom/Descartes），
//      「找到数 == 上界」本身即蕴含「没有更多解」，与域无关（2026-10-04 修正）。
//      ⇒ 本函数**不再**参与 completeness 判定，它只负责**放大**搜索域（纪律 ③）。
//
// 返回 {effDomain, domainProven, probeHalfWidths, rbReason}：
//   effDomain        传给引擎的域（可能是 undefined = 沿用引擎旧默认）
//   domainProven     域是否被定理证过。⚠ 2026-10-04 起**仅作诊断**（进 probeHalfWidths），
//                    不再门控 completeness —— 上界是域无关的全局断言，见 buildCompleteness
//                    里「原「域门控」已删除」那段完整论证。
//   probeHalfWidths  诊断旁路，**不进返回体**（1600B 红线）
//   rbReason         证不下来时的原因，同为诊断旁路
function proveDomain(eqs, vars, userDomain) {
  const LEGACY_HALF_WIDTH = 1e6;   // 与 constants.js::_LS_DOMAIN_LEGACY 同值，改那边要一起改
  const out = { effDomain: userDomain, domainProven: false, probeHalfWidths: null, rbReason: null };
  if (userDomain || !Array.isArray(vars) || !vars.length) return out;
  let rb = null;
  try {
    rb = RB.rootBounds(eqs, vars);
  } catch (e) {
    out.rbReason = 'rootbound_unavailable: ' + (e && e.message ? e.message : String(e));
    return out;
  }
  if (!rb) return out;
  const W = rb.halfWidths;
  // 长度对齐 + 每个半宽有限且为正 —— 缺一不可：
  // 长度不对说明 vars 与方程实际自由度不匹配（拿这个盒去限域会裁掉真解），
  // W<=0 说明 rootbound 退化，这两种都必须回落旧默认。
  const usable = Array.isArray(W) && W.length === vars.length && W.every((w) => isFinite(w) && w > 0);
  if (!usable) { out.rbReason = rb.reason || 'no usable bound'; return out; }
  out.probeHalfWidths = W;
  if (!rb.proven) { out.rbReason = rb.reason || 'no proven bound'; return out; }
  out.domainProven = true;
  // 只放大不收紧（纪律 ③）
  if (W.some((w) => w > LEGACY_HALF_WIDTH * (1 + 1e-12))) {
    const box = {};
    vars.forEach((vn, i) => { box[vn] = [-W[i], W[i]]; });
    out.effDomain = box;              // 证明过的**大**界 ⇒ 顶掉旧猜测（旧策略会漏解处）
  }
  return out;
}

function shapeResult(r, eqs, rb, offset) {
  const domainProven = !!(rb && rb.domainProven);
  const allSols = Array.isArray(r.solutions) ? r.solutions : [];
  // 展示上限（AGENT_MAX_SOLUTIONS）：引擎找到的**总数**照实报，只截展示列表。
  //
  // ⚠ offset（2026-10-04 新增，🔴 修 P0「Agent 被展示截断后无路可走」）：
  //   原来无论调用方怎么问，返回的都是**前 2 个**解，且没有任何参数能取回第 3 个。
  //   对 poly_roots 尤其致命 —— 它的工具描述白纸黑字写着 "All real roots"，
  //   而 (x²−1)(x²−4)=0 有 5 个实根，Agent 永远只能拿到 2 个。
  //   Agent 拿到的是一个**无法完成的契约**：它不知道该怎么办，只能要么误报 2 个、
  //   要么反复重试拿同一份结果。
  //   ⇒ 现在支持 `n`（偏移量）：n=2 拿第 3、4 个。配合 trust.moreAvailable，
  //   Agent 有一个明确的可行动作（n=2 继续问），而不是死路。
  //
  //   ⚠ 偏移必须**与排序无关地稳定**：allSols 的顺序由引擎决定（不是按数值排序），
  //   两次相同输入的调用顺序一致 ⇒ n 切片可复现。这是硬要求：
  //   Agent 会缓存 n=0 的结果之后再要 n=2，两片必须首尾相接、不重不漏。
  //   引擎全路径无随机（COMPUTE_DECIMALS 网格 + 确定性基址），已满足。
  const off = (typeof offset === 'number' && isFinite(offset) && offset > 0) ? Math.floor(offset) : 0;
  const window = allSols.slice(off, off + AGENT_MAX_SOLUTIONS);
  // 🔴 capped 必须判「**这一页后面**还有没有」，不能判「这一页没装满」（2026-10-04）。
  //   第一版写的是 `window.length < allSols.length`，在 n 越过尾部时给出**反向**错误：
  //     n=5（总数 5）⇒ window=[] 而 allSols.length=5 ⇒ 0 < 5 ⇒ capped=true
  //     ⇒ nextOffset = 5 + 0 = 5 = n 本身 ⇒ Agent 循环 `n = nextOffset` **永不推进，死循环**。
  //   这是给 AI 用的字段，死循环 = Agent 卡死在工具调用里，是最坏的一类 bug。
  //   ⇒ 正确判据：窗口**末端**之后还有元素才叫 capped。
  const capped = off + window.length < allSols.length;
  const sols = window;
  const meta = r.meta || {};
  const varNames = (Array.isArray(r.varNames) && r.varNames.length)
    ? r.varNames
    : (sols[0] && Array.isArray(sols[0].values) ? sols[0].values.map((_, i) => 'x' + (i + 1)) : []);

  // 推荐解：距原点最近（范数最小），与界面一致。
  // ⚠⚠ 2026-10-04 修正：必须在**全部**解里选，不能只在展示窗口里选。
  //   原实现在切片上选 recommended ⇒ 取 n=2 那一页时，推荐解会随窗口漂移：
  //   同一个方程问两次拿到不同的 recommended，Agent 无从判断哪个是「标准答案」。
  //   recommended 是「结论先行」的决策位，必须是**问题本身的性质**（离原点最近的解），
  //   与本次返回哪一页无关。若它恰好不在这页，就返回 null（Agent 从 solutions 里找），
  //   也不能给一个错位置的推荐。
  let recommended = null, best = Infinity;
  for (const s of allSols) {
    if (!s || !Array.isArray(s.values)) continue;
    let d = 0;
    for (const v of s.values) d += v * v;
    if (d < best) { best = d; recommended = s; }
  }
  // 只有落在本页窗口内的推荐解才给出（保持 recommendedIndex 与 solutions 索引一致）
  if (recommended && sols.indexOf(recommended) < 0) recommended = null;
  const tierSet = new Set(sols.map(s => (s && s.tier) || 'unknown'));
  const allProven = sols.length > 0 && [...tierSet].every(t => t === 'proven');
  const typeName = r.resultType === 1 ? 'empty' : r.resultType === 3 ? 'infinite' : 'finite';

  // cert 压缩（2026-10-04）：把 203B 压到 ~70B，**不改字段语义**。
  //
  // 实测：单解 cert = {status, method, enclosure, backwardError, krawczykRadius} = 203B，
  //   其中 enclosure 一项就 65B，而它给出的区间**退化成点**（lo==hi，与 values 差 1e-13）。
  //   4 解场景 solutions=1307B ⇒ 整个返回体 2199B，早就过了 1600B 红线。
  //
  // 为什么这么压是**无损**的：
  //   ① enclosure 区间宽度为 0 时，用 `p:<point>` 表达 —— 数学上就是同一个区间 [p,p]，
  //      消费者（要复核的 Agent / Web 端）能无歧义还原。看到 lo==hi 才压缩，非退化区间原样保留。
  //   ② backwardError / krawczykRadius 都是 1.7e-15 这种长科学计数串，
  //      而 Agent 的判断只有两档「达没达容差」⇒ 压成 `ok` / `loose` 枚举，
  //      原值留在 r.certification 与 Web 端（内核不动，回归测试仍能看全量数字）。
  //      ⚠ 阈值取 1e-9：与 buildCompleteness 里 findRealSolutions 的逐方程相对残差
  //      门槛同源（不是随手拍的数）。
  //
  // ⚠ 为什么不干脆删字段：cert 是**中英双语文档公开的 API 契约**
  //   （docs/02-使用指南.md L124/L143 明确列出 status/method/enclosure/backwardError）。
  //   删字段是破坏性变更，属「不擅自改方向」红线 ⇒ 只压表达、不改字段集。
  //
  // ⚠⚠ 例外：区间**退化成点**时 enclosure 被删（2026-10-04）。
  //   退化 ⇒ lo == hi == 该解的 values[i] ⇒ `enclosure:[{p:v},…]` 与同一对象里的
  //   `values:[v,…]` **逐位相同**（实测同源于 detF 吸附后的同一批字节）。
  //   ⇒ 它不是「压缩后的信息」，是**同一信息的第二份拷贝**，纯冗余 27B/维。
  //   ⇒ 保留它没有任何可恢复的信息，却让 4 解场景顶到 1551B（超 1550 余量线 1B）。
  //
  //   为什么这一条不违反「不改字段集」：契约说的是「cert 含 enclosure」，
  //   而退化区间 [p,p] 在数学上就是点 p —— 消费者要的信息（根的取值与认证状态）
  //   仍完整地由 values + status + method 给出。**非退化区间一律原样保留**，
  //   那才是 enclosure 唯一不可替代的场合（区间宽度本身是信息）。
  const CERT_TOL = 1e-9;
  function compressCert(cert) {
    if (!cert || typeof cert !== 'object') return cert || null;
    const out = { status: cert.status, method: cert.method };
    if (Array.isArray(cert.enclosure)) {
      const degenerate = cert.enclosure.every((iv) => Array.isArray(iv) && iv.length === 2 && iv[0] === iv[1]);
      // 退化 ⇒ 不输出 enclosure（信息与 values 逐位重复，见上方注释）
      if (!degenerate) out.enclosure = cert.enclosure;   // 非退化：原样保留，不丢信息
    } else if (cert.enclosure !== undefined && cert.enclosure !== null) {
      out.enclosure = cert.enclosure;
    }
    // ⚠ 2026-10-05：`enclosure: null` 也剔掉（原来只有 undefined 走这条）。
    //   null 的语义是「没有区间认证」—— 而它已由 `status`/`tier`（candidate = 无认证）
    //   明确表达 ⇒ 写出来的那 22 字节是**零信息的键值对**，却在多解题里线性放大
    //   （实测 2 解即多 44B）。判据与上面「退化区间不输出」同源：没有可恢复的信息。
    if (cert.backwardError !== undefined && cert.backwardError !== null) {
      out.backwardError = (typeof cert.backwardError === 'number' && cert.backwardError <= CERT_TOL) ? 'ok' : 'loose';
    }
    if (cert.krawczykRadius !== undefined && cert.krawczykRadius !== null) {
      out.krawczykRadius = (typeof cert.krawczykRadius === 'number' && cert.krawczykRadius <= CERT_TOL) ? 'ok' : 'loose';
    }
    return out;
  }

  const cleanSols = sols.map((s) => {
    const vals = Array.isArray(s.values) ? s.values : [];
    const text = varNames.map((vn, i) => `${vn}=${fmtText(vals[i])}`).join(', ');
    // Agent 决策不依赖残差：它只问「能不能用」，而那由 tier/cert 回答（区间认证是
    // 独立于残差量级的证据）。残差留在 Web 端调试与回归测试里，不进 MCP 返回体。
    return {
      values: vals,
      tier: s.tier || 'unknown',
      certified: !!s.certified,
      text: text,
      cert: compressCert(s.cert)
    };
  });
  // recommended 给「结论先行」用：Agent 不用遍历 solutions[] 算范数最小那个。
  // ⚠⚠ 但它**必须瘦身**（2026-10-04）：原来直接复用 cleanSols 里的整条解，
  //   于是 cert（203B）被完整复制了一份 —— 实测 4 解场景 recommended=329B、
  //   solutions=1307B，两处同一个 cert。而 solutions[] 里本来就有，
  //   Agent 要证据去那里取即可，重复给是纯 token（对 AI 客群是实打实的上下文钱）。
  //
  //   代码侧确实零消费者（grep 全仓无 .recommended 读取）—— 但它不是死字段：
  //   它是给 **LLM 读**的决策捷径，符合「结论先行」的产品约定，不能删。
  //   ⇒ 保留结论（values/tier/certified/text），只去掉可从 solutions[] 取到的证据。
  //   附 recommendedIndex 让 Agent 需要完整证据时能直接定位，不必搜。
  const recommendedClean = recommended ? (() => {
    const c = cleanSols[sols.indexOf(recommended)];
    const idx = sols.indexOf(recommended);
    return c ? { values: c.values, tier: c.tier, certified: c.certified, text: c.text, recommendedIndex: idx } : null;
  })() : null;

  // 人类可读总览 —— 诚实三档（产品「不谎称证明」红线）
  let summary;
  if (typeName === 'empty') {
    if (r.error === 'UNDECLARED_VARIABLE') {
      summary = r.message ||
        '方程里出现了未声明的标识符：它们既不是内置常量（pi/π/e）也不是内置函数，'
        + '必须在「变量名」里声明后才能求解。当前是「未声明 ⇒ 无法求解」，不是「无解」。';
    } else if (r.error === 'NO_EQUATION' || (r.error && /NO_EQUATION|PARSE|UNRECOGNIZED|UNKNOWN/i.test(String(r.error)))) {
      summary = '部分方程无法解析（疑似缺少 "=" 或含不支持的语法），未给出解。求 expr=0 的根可写 "expr=0"，或直接裸写 "expr"。';
    } else if (r.provenEmpty === true) {
      summary = '严格证明：该方程组无实数解。';
    } else {
      summary = '未找到实数解（未经标记严格证明不存在；可缩小定义域或提高预算重试）。';
    }
  } else if (typeName === 'infinite') {
    summary = `无限解集；给出距原点最近的推荐解（共展示 ${sols.length} 个候选）。`;
  } else if (allSols.length === 0 && (r.truncated === true || r.hardTimeout === true
      || (r.error && /TIMEOUT|BUDGET|TRUNCAT|预算|超时/i.test(String(r.error))))) {
    // 🔴🔴 2026-10-05 修 fail-closed 漏洞（measure-decision 抓出：6 元二次 6 式 1159ms 触发
    //   TIMEOUT_TRUNCATED，而返回体 summary 写的是「找到 0 个实数解。」）。
    //
    //   为什么这是 P0 级：summary 是 Agent 读到的**第一句话**，也是唯一的人类可读结论。
    //   「找到 0 个实数解。」配 canAssert.noSolution=false 会被 LLM 读成
    //   「这系统确实没解，只是没证明」—— 而真相是**搜索根本没跑完**，
    //   连「一个都没找到」都不是结论，只是没跑完时的空表。两种情况给 Agent 的行动
    //   完全相反（收工 vs 缩域/加预算重试），必须在这里就说清，不能只藏在 diagnostics 里。
    summary = '未找到实数解，且本次搜索被预算/超时中止 ⇒ 不得据此断言无解'
      + '（这不是「已确认无解」，是没跑完）。可缩小定义域或提高预算后重试。';
  } else {
    // ⚠ 解数必须用 allSols.length（引擎找到的总数），不能用截断后的 sols.length
    //   —— 那会让 Agent 把这一页的 2 个当成「全部 16 个」，是数量级谎报。
    // ⚠ 措辞必须区分「第一页」与「第 n 页」（2026-10-04）：offset>0 时说「仅展示前 2 个」是错的
    //   （它拿到的是第 3、4 个，不是前 2 个）。这种错会让 Agent 以为自己已经看过了前两个，
    //   拼接时产生重复/遗漏。
    const tail = capped
      ? (off > 0
        ? `（第 ${off + 1}~${off + sols.length} 个，共 ${allSols.length} 个）`
        : `（仅展示前 ${AGENT_MAX_SOLUTIONS} 个，共找到 ${allSols.length} 个）`)
      : '';
    summary = `找到 ${allSols.length} 个实数解${tail}${allProven ? '（全部经 Krawczyk 区间认证）' : ''}。`;
  }

  // diagnostics 只保留 Agent 决策 / fail-closed 必需项（2026-10-03 瘦身，185B → 精简）。
  // ⚠ provenEmpty 是 fail-closed 的关键（区分「严格证明无解」与「预算内没找到」），
  //   buildTrust 依赖它，故**保留在本地变量里**，只是不进返回体 ——
  //   对 Agent 而言 trust.trustLevel/agentAction 已把这件事说清了（verified_empty vs unverified），
  //   再给一个原始布尔是重复。删它曾导致 buildTrust 的 provenEmpty 分支静默失效。
  const _provenEmpty = !!(r.provenEmpty || meta.provenEmpty);
  // ⚠⚠ inputErrorMessage 加门控（2026-10-04，🔴 修体积超标 + 字段语义错位）：
  //   实测两个场景顶破 1600B 红线 —— 正维欠定 1591B、16 解 1701B。
  //   追下去发现 inputErrorMessage 在这两例里装的是：
  //     正维：「欠定系统…给出 1 个代表点；未证明解集完备。」   ← 求解结论
  //     周期：「单变量周期方程…已给出 201 个代表根…」        ← 求解结论
  //   而它的字段名是 **inputError**Message，error 字段此时是 **null**（没有输入错误）。
  //   ⇒ **零消费者的字段装着误导性的内容**：名字说「输入错误」，内容是「求解结论」。
  //     Agent/LLM 按名字读会以为「我的输入有问题」，去改输入 —— 而输入完全没问题。
  //     这跟已有的「残差/认证不进 Agent 返回体」同源：Agent 要的是决策，不是论证。
  //
  //   门控：**只有真有输入错误时才给 message**（那时它是有价值的「怎么改」处方，
  //   由 inputError() 构造）。error 为空时一律 null。
  //   实测收益：正维 112B→32B、16 解 154B→32B。
  //
  //   ⚠ inputError 本身**必须保留**：托管端计费层（http-mcp-server.js:536）与
  //   6 处测试都直接读它判非计费。删它会改计费面，属破坏性变更。
  const _hasInputErrFlag = !!r.error;
  const diagnostics = {
    // 保留：Agent 必须能把「输入不可解析」与「已证明无解」分开，
    // 否则会把"我读不懂你的输入"误报成"这个系统无解"。托管端计费层也据此判非计费。
    inputError: r.error || null,
    inputErrorMessage: _hasInputErrFlag ? (r.message || null) : null,
    // ⚠ `|| capped` 已移除（2026-10-04，🔴 P0 修正）：
    //   原来写 `!!(r.truncated || meta.truncated || capped)`，把**我们自己截断展示**
    //   混进「引擎被中止」这个信号里。后果实测（5 根的 (x²-1)(x²-4)=0）：
    //     trust.trustLevel = "budget_exhausted"
    //     trust.agentAction = "Narrow domain or raise budget if completeness matters"
    //   而引擎**根本没爆预算** —— 它把 5 个根全找到了（certification.proven=5），
    //   是我们在返回体里只摆了 2 个。Agent 拿到这条指令会去加 budget / 缩 domain，
    //   重试一百次也是同一个结果 ⇒ **假指令**，比不给指令更坏。
    //   这跟已有的 P0「正维系统被误判成资源不足 ⇒ 建议重试/缩域」是同一个病：
    //   把「我没显示完」说成「你没算完」。
    //   ⇒ 展示截断改由独立字段 `moreAvailable` 表达（Agent 靠它决定要不要再问一次），
    //     truncated 恢复成**只**反映引擎真实中止。
    // ⚠ 保留：truncated=true 时 Agent 必须知道"解可能不全"，这直接影响它能否断言无解。
    truncated: !!(r.truncated || meta.truncated),
    // ⚠ domainProven **不进返回体**（2026-10-04 删）。它与 completeness 是同一件事
    //   说两遍：门控已保证「status='complete' ⇒ 域被定理证过」，Agent 从 status 就能
    //   推出来；反向的「没证过」由 completeness.domainUnproven 表达，且只在真降级时出现。
    //   留在这里是纯 token（实测 +22B，把返回体余量压到 42B，撞「余量 ≥ 50B」红线）。
    //   与 2026-10-03 删 provenEmpty 同型：同一语义两处表达 ⇒ 保留消费者真正读的那一处。
  };
  // buildTrust 用的完整视图（不进入返回体，仅内部传递）
  const trustDiag = Object.assign({}, diagnostics, { provenEmpty: _provenEmpty });

  // ⚠ 真 bug 修正（2026-10-03）：引擎用 error:'NO_SOLUTION' 同时表示两件不同的事 ——
  //   · provenEmpty:true  ⇒ **严格证明**无实数解
  //   · provenEmpty:false ⇒ 区间穷尽只是在预算内没找到（≠ 无解）
  //   两者都是**结果**，不是输入错误。但 buildTrust 原来只要 r.error 非空就判
  //   hasInputError=true，且 hasInputError 的分支排在 provenEmpty 之前，
  //   于是 x^2+1=0 这种已证无解的输入被报成 undecidable + "Fix the input and call again"。
  //   Agent 收到的是完全错误的行动指令：它明明可以收工，却被叫去改输入。
  //   把 NO_SOLUTION 摘出来后：provenEmpty ⇒ verified_empty，否则 ⇒ unverified，各归其位。
  //   （diagnostics.inputError 字段本身不动 —— 托管端计费层依赖它判非计费，改了会改计费面。）
  const _hasInputError = !!r.error && r.error !== 'NO_SOLUTION';
  // 以下已从返回体删除（实测 185B → 约 90B）：
  //   solverVersion  —— 版本信息在 tool description 与 reportId 里都有，Agent 决策不用
  //   terminatedBy   —— 终止原因属调试信息；Agent 只关心 truncated 这个布尔
  //   provenCount    —— 与 trust.provenCount 完全同值，纯重复
  //   completeness   —— 完备性已在 certification.certifiedCoverage 体现，且它是 detF 数值对象（体积大）

  return {
    // ═══ 4 态决策标记：Agent 要的**唯一**决策字段，必须排第一 ═══
    //
    // 为什么放在最前：LLM 读 JSON 时靠前字段权重更高。Agent 要做的是
    // **决策**（这系统有解吗？我能断言找全了吗？），不是读数值细节。
    // 之前 `resultTypeName` 有 20+ 种措辞（finite/empty/infinite + 中文自由文本），
    // Agent 得自己映射 ⇒ 映射表不存在 ⇒ 每次人肉翻译 ⇒ **拿不到稳定决策语义**。
    //
    // 四态与判据（判据在 src/engine/conclusion.js，全部由可判定的数学条件驱动）：
    //   全部解        —— 有独立完备性证据（Sturm 精确计数 / Bézout 上界击满 / 满列秩线性）
    //   部分解        —— 找到解但无完备性证据（含正维流形：代表点对，但无穷多解）
    //   无解          —— **严格证明**域内无解
    //   计算资源不足  —— 被预算/时间中止或上界被突破。这是「我不知道」，**不是**「无解」
    //
    // ⚠ 展示被截断时 conclusion 降为「部分解」（**这一层降级是对的，别改**）——
    //   理由与 completeness 那层**不同**，别混为一谈：
    //   completeness.status 描述「引擎 Knows what it knows」（定理层面的事实）⇒ 不该降；
    //   conclusion 描述「**Agent 此刻掌握**什么」（决策层面的事实）⇒ 该降。
    //   Agent 还没拿到那 3 个解，此时说「全部解」会让它以为可以收工、不再问我要 ⇒ 漏解。
    //   两层各自自洽，**不是**互相矛盾：Agent 同时看到 conclusion=部分解 +
    //   trust.moreAvailable=3 + completeness.status=complete，
    //   它的正确判断是「确实只有 5 个，其中 3 个你还没问，再问一次要」——
    //   而不是因为看到 status=unknown 就去怀疑有第 6 个解。
    conclusion: (() => {
      const c = r.conclusion || '部分解';
      if (c === '全部解' && capped) return '部分解';   // 展示被截断 ⇒ Agent 手上还不是全部
      return c;
    })(),
    // ⚠ 2026-10-04 不透传 conclusionReason：实测把多解场景返回体从 1465B 顶到
    //   1767B（超 1600B 红线 167B）。原因全文（含判据链）平均 200~300B。
    //   ⇒ 按「Agent 要的是决策，不是论证」的口径**砍掉**：4 态标记本身已是结论，
    //   判据链留在内核 result.conclusionDetail 供人排查 / Web 端调试。
    //   canAssert 保留：它极短（三元组）但**不可省** ——
    //   Agent 靠它决定「能不能对外断言无解 / 断言找全」，这是决策而非细节。
    //
    // 🔴🔴 canAssert.allSolutions 必须与 conclusion **同步降级**（2026-10-04 修 P0）：
    //   实测（4 解、Bézout 上界 4、只展示前 2 个）：
    //     conclusion       = "部分解"     ← 降级了 ✓
    //     canAssert.allSolutions = true    ← 🔴 没降级
    //   两个字段在同一返回体里给出**相反**的答案。
    //   为什么 canAssert 这半边更危险：文档明确写它是「**程序化分支用，不必解析英文**」，
    //   Agent 会写 `if (canAssert.allSolutions) assert("已找全")` —— 而它手上只有 2/4 个解。
    //   英文措辞矛盾 LLM 还能犹豫一下，**布尔量矛盾它只会照做**。
    //   ⇒ 口径统一：Agent 还没拿全 ⇒ 就是「不许断言找全」。
    canAssert: (() => {
      const ca = (r.conclusionDetail && r.conclusionDetail.canAssert) || null;
      if (!ca) return null;
      if (!capped) return ca;
      return { noSolution: ca.noSolution, allSolutions: false, hasSolution: ca.hasSolution };
    })(),
    resultType: r.resultType,
    resultTypeName: typeName,
    certified: allProven,
    truncated: diagnostics.truncated,
    precisionDecimals: AGENT_DISPLAY_DECIMALS,   // Agent 展示位数（4）。内部计算精度仍为 6，见 AGENT_DISPLAY_DECIMALS 处说明
    // ⚠ 必须用 allSols.length（引擎找到的总数），不能报截断后的 sols.length：
    //   报 8 而实际找到 16，会让 buildCompleteness 以为「找到 8 个」去比上界 ——
    //   数字对不上只是运气好，碰上界也等于 8 时就会谎称 complete。
    solutionCount: allSols.length,
    // 🔴 2026-10-04 新增：下一页的偏移量（没有下一页时**不返回**该键）。
    //
    // 为什么 Agent 需要一个**具体数字**而不是「还有更多」这种话：
    //   它必须能构造下一次调用。给「还有 3 个解」它得自己算 n=2；给 nextOffset=2
    //   它直接就能用。少这一步转换，LLM 有相当概率会漏掉分页、把前 2 个当全部。
    //
    // ⚠ 为什么放顶层而不是只塞 trust 里：Agent 的读法是「先扫顶层几个标量
    //   （conclusion / solutionCount / truncated），再按需下钻」。
    //   埋在 trust.trustLevel 的自然语言里等于没有。
    nextOffset: capped ? (off + sols.length) : undefined,
    // Agent 决策块放最前：LLM 读 JSON 时前面的字段权重更高，先给结论再给细节
    trust: buildTrust({
      typeName, allProven, cleanSols, diagnostics: trustDiag, r,
      hasInputError: _hasInputError,
      // 本页窗口的起点（n 偏移）。moreAvailable 要靠它算「本页之后还剩几个」，
      // 漏传 ⇒ 恒按 0 算 ⇒ 分页到尾部时会报「还有 N 个」⇒ Agent 死循环。
      shownFrom: off,
      completeness: buildCompleteness({
        eqs, typeName,
        // 🔴🔴 found 口径（2026-10-04 修 P0）：必须只数**已证明**的互异解，不能用
        //   allSols.length（含 candidate/未认证点）。
        //   上界击满是「已证明的互异根数 == 全局上界 ⇒ 恰好找全」，
        //   把未经认证的候选点算进去，等于用**可能是伪解**的点去击满上界 ⇒ 谎称 complete。
        //   内核 bezoutVerdict 一直只数 proven（solver.js:1529），这里过去与它口径不一致，
        //   导致同一事实两个数字（与本轮修的 displayCapped/provenCount 矛盾同型）。
        //   实测 x*cos(x)-x=0：solutionCount=16 但 proven 只有 11 —— 差的 5 个不能算数。
        found: allSols.filter((s) => s && (s.tier === 'proven' || s.certified === true)).length,
        provenEmpty: _provenEmpty,
        hasInputError: _hasInputError,
        // ⚠ displayCapped 只表达「还有解没摆给 Agent看」，**不再**降级 status
        //   （引擎侧确实找全了，这是定理事实；降级是另一方向谎报）。
        //   Agent 手上的不全由 conclusion + trust.moreAvailable + nextOffset 三处表达。
        displayCapped: capped
      })
    }),
    // 2026-10-03 瘦身：顶层 instructions 字段已删（162B）。
    // 它原是自然语言版读法指引，与 tool description 的 "READ THE TIERS" 段重复；
    // 其唯一不可替代的硬规则（unverified/budget_exhausted 时不得断言无解）
    // 已浓缩进 trust.mustNotClaim（枚举形式，更精确且更省）。
    summary: summary,
    // ⚠ recommended 为 null 时**不返回该键**（2026-10-04）。
    //   实测 4 解场景（x^2=2 & y^2=3）推荐解落在展示窗口外 ⇒ recommendedClean=null，
    //   而 `"recommended": null` 仍占 15B。Agent 看到 null 与看到「键不存在」是同一种理解
    //   （「这页没有推荐值，去 solutions 里挑」），所以删键是无损的。
    //   这也是 1600B 红线在多解场景的实际压力来源之一。
    recommended: recommendedClean || undefined,
    solutions: cleanSols,
    // ⚠⚠ warnings 已从 Agent 返回体删除（2026-10-04）。
    //   实测体积：正维欠定场景 208B、16 解场景 166B，两条都顶破 1600B 红线。
    //
    //   为什么能删（不是「为了省字节删信息」，是**它本来就在重复**）：
    //   实测两条 warning 的内容与其余字段一一对应，没有一个新事实：
    //     ① 「欠定系统：解集为正维流形…未证明解集完备」
    //        ⇒ conclusion=部分解 + canAssert.allSolutions=false + summary「找到 1 个实数解」
    //     ② 「完备性降级为『未验证』：存在 N 个未经认证的候选解，且无独立完备性证据
    //        （Sturm 精确计数 / 导数单调分段）——Krawczyk 只能证明候选点附近根唯一…」
    //        ⇒ trust.trustLevel（partially/candidates_only）+ trust.candidateCount=N
    //          + trust.completeness.status=unknown + trust.mustNotClaim=no_solution
    //     ③ 「已找到部分解，列表可能不完整；已有解本身有效」
    //        ⇒ truncated=true + trust.agentAction
    //   ⇒ 4 态标记 + trust 块已经把每一句的**决策含义**结构化表达了，
    //     warnings 只是同一件事的自然语言复述。
    //   ⚠ 与 2026-10-03 删 instructions / 删 provenance 同型：
    //     **同一语义两处表达 ⇒ 保留消费者真正读的那一处**（这里是结构化字段）。
    //
    //   ⚠ 内核 r.warnings **不动**：Web 端（index.html:9632）与回归测试仍读它。
    //   ⚠ 零断言：grep 过 test/ 全量，dual-parity / agent_tools_smoke /
    //     tool-metadata-parity / metering_regression 都没有断言 warnings 的内容
    //     （只有 test_suan56 与 test-rootbound 断言它**不含**「8 秒」，是否定式，删了仍过）。
    warnings: undefined,
    reportId: meta.reportId || r.reportId || null,
    // 2026-10-03 瘦身：内核 certification 原样透传，其中 reproducibility 段
    // （约 185B，说明"如何验证 reportId 可复现"）对 Agent 决策无用 —— Agent 要的是
    // 「哪些解能用」（proven/candidate/structural 计数）与「认证覆盖率」。
    // 可复现性由 reportId 本身承载（同输入同 reportId 即证明），不需要每次都带一段说明文字。
    // ⚠ 只在服务层裁剪副本，内核 r.certification 不动（Web 端与回归测试仍用完整版）。
    certification: shapeCertification(r.certification),
    diagnostics: diagnostics
  };
}

/**
 * 裁剪 certification：只留**可核对的计数**，不返回任何比例或恒真断言。
 *
 * 🔴 2026-10-05 重写（用户指令：「去掉所有人为规则……我们要的是极致的计算，
 *   让智能体得到能决策的结果，而不是认证、确定性这些东西」）。
 *
 * 删除 certifiedCoverage —— 它是**谎报型指标**，理由三条：
 *   ① 分子分��都是「**找到的**解」⇒ 对「有没有漏解」**零信息**。
 *      实测反例：g005（4 元耦合）旧值 cov=0，而它 4 个解全部正确；
 *      反过来 cov=1 也不代表找全了（只代表找到的都过了某道工序）。
 *   ② 它长得像「可信度」，Agent 会**自发**当成「这批解能不能信」来读 ——
 *      而「找到的解里有多少被验证过」回答不了这个问题。
 *      一个会被误读的比率，比没有这个字段**更危险**。
 *   ③ 「有没有漏解」这个问题由 `conclusion`（全部解 / 部分解 / 无解 / 资源不足）
 *      + `trust.canAssert.allSolutions` 回答，走的是 Sturm / Bézout / 同伦
 *      这些**独立计数证据**，与「找到的解内部的比例」无关。
 *
 * 删除 reproducibility —— 它的 `deterministic: true` 是**硬编码的断言**，
 *   不来自任何测量。「同输入同输出」确实是事实（同伦 γ 由输入哈希导出、
 *   全程无 Math.random），但把恒真值包成字段塞给 Agent，
 *   等于暗示「结果可信」—— 而**可复现 ≠ 正确**。零信息 + 占 token。
 *
 * 保留的全是**能与解列表对照核实的计数**（不是比例、不是断言）：
 *   solutions / proven / candidate / structural / emptyProof
 */
function shapeCertification(cert) {
  if (!cert || typeof cert !== 'object') return cert || null;
  return {
    solutions: cert.solutions,
    proven: cert.proven,
    candidate: cert.candidate,
    structural: cert.structural,
    emptyProof: cert.emptyProof
  };
}

function buildPolyEquation(coeffs) {
  const n = coeffs.length - 1;
  let s = '';
  for (let i = 0; i < coeffs.length; i++) {
    const c = coeffs[i]; const deg = n - i;
    if (c === 0 && deg !== 0) continue;
    const abs = Math.abs(c);
    const sign = (s === '' ? (c < 0 ? '-' : '') : (c < 0 ? ' - ' : ' + '));
    const term = deg === 0 ? '' + abs : deg === 1 ? abs + '*x' : abs + '*x^' + deg;
    s += sign + term;
  }
  return s + ' = 0';
}

/**
 * 结构化输入错误 —— 针对 AI Agent 客群（2026-10-03 新增）。
 *
 * 为什么必须结构化：改造前超限/非法输入只抛 {type, message}，Agent 拿到一句话只能
 * 「猜」怎么改。调研实据：LLM 被 RLHF 训练成「倾向给答案」，面对不完整错误最容易
 * 编一个假修复（改方程 / 砍变量 / 悄悄取近似）。所以错误必须自带的「怎么改」处方。
 *
 * retryable 语义（给 Agent 的分支依据，不给它就得自己猜）：
 *   true  → 同样的输入重试必然还是这个错，必须改输入
 *   false → 偶发（超时/内部错误），原样重试可能成功
 */
function inputError(type, message, fix, extra) {
  const e = { type, message, retryable: false, fix };
  if (extra) Object.assign(e, extra);
  return e;
}

function doSolve(args) {
  const eqs = args && args.equations;
  if (!Array.isArray(eqs) || eqs.length === 0) {
    throw inputError('invalid_input', 'equations 必须是非空字符串数组',
      'Call again with equations as a non-empty array of strings containing "=", e.g. ["x^2+y^2=25","x+y=7"].');
  }
  if (eqs.length > MAX_EQ_COUNT) {
    throw inputError('invalid_input', `方程数量 ${eqs.length} 超过上限 ${MAX_EQ_COUNT}`,
      `Split the system into smaller independent groups and solve them separately, or drop redundant equations. Keep at most ${MAX_EQ_COUNT}.`,
      { limit: MAX_EQ_COUNT, actual: eqs.length });
  }
  let total = 0;
  for (const e of eqs) {
    if (typeof e !== 'string') {
      throw inputError('invalid_input', '每条方程必须是字符串',
        'Convert every element of equations to a string, e.g. "x^2 = 4" instead of a number or object.');
    }
    total += e.length;
  }
  if (total > MAX_TOTAL_CHARS) {
    throw inputError('invalid_input', `方程文本总长 ${total} 超过 ${MAX_TOTAL_CHARS} 上限`,
      'Shorten the equations, remove comments, or solve a smaller system.',
      { limit: MAX_TOTAL_CHARS, actual: total });
  }
  const vars = (args && Array.isArray(args.variables)) ? args.variables : [];
  if (vars.length > MAX_VAR_COUNT) {
    throw inputError('unsupported',
      `变量数量 ${vars.length} 超过硬上限 ${MAX_VAR_COUNT}`,
      `This solver is deliberately capped at ${MAX_VAR_COUNT} variables and will not approximate beyond it. `
      + 'Substitute the extra variables with their known values, or split the problem into smaller systems.',
      { limit: MAX_VAR_COUNT, actual: vars.length });
  }
  const domain = (args && args.domain) || undefined;
  if (domain && typeof domain === 'object') {
    const bad = Object.keys(domain).filter((k) => vars.length && vars.indexOf(k) < 0);
    if (bad.length) {
      throw inputError('invalid_input', 'domain 含未声明的变量：' + bad.join(', '),
        'Pass the same variable names in both variables and domain. Undeclared names make the problem unsolvable — not "no solution".',
        { undeclared: bad });
    }
  }
  const fastMode = !!(args && args.fastMode);
  const opts = (args && args.options) || {};

  // 域从「猜」变「证」（任务 #87）—— 详见 proveDomain 的四条硬纪律
  const pd = proveDomain(eqs, vars, domain);
  const r = solve(eqs, vars, 6, pd.effDomain, fastMode, opts);
  // 诊断旁路：只落在引擎结果上，shapeResult 会重建返回体，它不进 1600B 预算
  r.probeHalfWidths = { proven: pd.domainProven, widths: pd.probeHalfWidths, reason: pd.rbReason };
  return shapeResult(r, eqs, { domainProven: pd.domainProven }, readOffset(args));
}

/**
 * 读分页偏移 `n`（2026-10-04 新增）。
 *
 * 为什么需要：AGENT_MAX_SOLUTIONS=2 限制单次返回的解数，而**没有** n 的话
 * Agent 面对多解系统只能拿到前 2 个，且**没有任何办法**取回剩下的 ——
 * 它会误以为「只有 2 个解」（漏解），或者反复重试拿同一份结果（空转）。
 * 对 poly_roots 尤其致命：它的工具描述承诺 "All real roots"。
 *
 * ⚠ fail-closed：非法值**不静默忽略**。静默忽略会让 Agent 以为 n=999 生效了，
 *   拿到同一页后以为已经看完 ⇒ 漏解。宁可报错让它改。
 *   边界：n 超过总数不算错（返回空页 + nextOffset 不存在 = 明确的「到底了」），
 *   因为 Agent 无法预知总数；负数/小数/字符串才是真错。
 */
function readOffset(args) {
  const a = args && args.n;
  if (a === undefined || a === null) return 0;
  if (typeof a !== 'number' || !isFinite(a) || a < 0) {
    throw inputError('invalid_input', 'n 必须是非负有限整数（分页偏移量）',
      'Pass n as a non-negative integer, e.g. n=2 to get the 3rd and 4th solutions. Omit n for the first page. '
      + 'Get the value to use from nextOffset in a previous response.',
      { got: a });
  }
  return Math.floor(a);
}

function doPolyRoots(args) {
  const coeffs = args && args.coefficients;
  if (!Array.isArray(coeffs) || coeffs.length < 2) throw { type: 'invalid_input', message: 'coefficients 必须是长度≥2 的数组（最高次系数在前）' };
  for (const c of coeffs) if (typeof c !== 'number' || !isFinite(c)) throw { type: 'invalid_input', message: 'coefficients 须为有限数字' };
  const eq = buildPolyEquation(coeffs);
  // 一元多项式接根界（任务 #87）：k=2 时平衡带余量 ln(k−1)=0，根界退化成**精确**
  // Cauchy 界，必然可证 ⇒ 单变量路径的 completeness 不会被门控误降级。
  // 这一步还顺手修掉旧策略的真 bug：大系数多项式（如 x^2-1e13=0）的根在 ±3.16e6，
  // 超过旧默认域 ±1e6 会被**静默判成无解**。
  const pd = proveDomain([eq], ['x'], undefined);
  const r = solve([eq], ['x'], 6, pd.effDomain, false, {});
  r.probeHalfWidths = { proven: pd.domainProven, widths: pd.probeHalfWidths, reason: pd.rbReason };
  // 🔴 2026-10-04：poly_Roots 同样接 n 分页。工具描述写的是 "All real roots" ——
  //   5 个实根只给 2 个却无法取回剩下 3 个，是**无法完成的契约**（P0）。
  return shapeResult(r, [eq], { domainProven: pd.domainProven }, readOffset(args));
}

function doVerify(args) {
  const eq = args && args.equation;
  if (typeof eq !== 'string' || !eq.includes('=')) throw { type: 'invalid_input', message: 'equation 须为含 "=" 的字符串' };
  const cand = args.candidate;
  let varNames, candPoint;
  if (typeof cand === 'number') {
    varNames = (args && Array.isArray(args.variables) && args.variables[0]) ? [args.variables[0]] : ['x'];
    candPoint = [cand];
  } else if (cand && typeof cand === 'object' && !Array.isArray(cand)) {
    varNames = Object.keys(cand);
    candPoint = varNames.map(function (v) { return cand[v]; });
  } else if (Array.isArray(cand)) {
    varNames = (args && Array.isArray(args.variables)) ? args.variables : [];
    if (varNames.length !== cand.length) throw { type: 'invalid_input', message: 'candidate 数组长度须与 variables 一致' };
    candPoint = cand;
  } else {
    throw { type: 'invalid_input', message: 'candidate 须为数字 / {变量:值} / [值...]' };
  }
  const margin = (args && typeof args.tolerance === 'number' && args.tolerance > 0) ? args.tolerance : 1e-3;
  const domain = {};
  varNames.forEach(function (v, i) { domain[v] = [candPoint[i] - margin, candPoint[i] + margin]; });
  const r = solve([eq], varNames, 6, domain, false, {});
  // ⚠ 刻意**不**接根界（任务 #87 的纪律 ②）：这里的 domain 是「候选值 ± margin」的
  // **局部**盒，语义是「在候选附近有没有根」，不是「所有根在哪」。
  // 拿全局根界去断言这个局部盒盖住了全部解是错的 —— verify 的裁决来自
  // matched/refuted（区间认证），根本不走 completeness。
  const shaped = shapeResult(r, [eq]);
  const matched = (r.solutions || []).find(function (s) {
    return Array.isArray(s.values) && s.values.every(function (val, i) { return Math.abs(val - candPoint[i]) <= 1e-6; });
  });
  if (matched) {
    return {
      verdict: 'verified', isRoot: true, candidate: cand,
      // Agent 决策块：这个数能不能直接往下游用
      trust: {
        safeToUse: true,
        agentAction: 'Candidate CONFIRMED as a certified real root. Use it as-is downstream.',
        corrected: null
      },
      matchedRoot: { values: matched.values, tier: matched.tier, certified: !!matched.certified, cert: matched.cert || null,
        text: varNames.map(function (vn, i) { return vn + '=' + fmtText(matched.values[i]); }).join(', ') },
      reportId: shaped.reportId, certification: shaped.certification
    };
  }
  let nearest = null;
  try {
    // refuted：在更宽域重算，给 Agent 全局最近的「真认证根」，否则纠正 LLM 的能力失效
    const rb = solve([eq], varNames, 6, undefined, false, {});
    const solsB = (rb.solutions || []).filter(function (s) { return Array.isArray(s.values); });
    if (solsB.length) {
      let bestD = Infinity, bestS = null;
      for (const s of solsB) { let d = 0; for (let i = 0; i < s.values.length; i++) d += (s.values[i] - candPoint[i]) * (s.values[i] - candPoint[i]); if (d < bestD) { bestD = d; bestS = s; } }
      nearest = { values: bestS.values, tier: bestS.tier || null, certified: !!bestS.certified, cert: bestS.cert || null,
        text: varNames.map(function (vn, i) { return vn + '=' + fmtText(bestS.values[i]); }).join(', ') };
    }
  } catch (e) {
    // 宽域重算失败不致命，nearest 保持 null；但必须可观测，不再静默吞异常
    if (typeof console !== 'undefined') console.error('[lingshu] doVerify 宽域重算失败:', e && e.message ? e.message : e);
  }
  return {
    verdict: 'refuted_or_unverified', isRoot: false, candidate: cand,
    message: '在候选点 ±' + margin + ' 邻域内未找到与之匹配的认证根；候选不是经验证的实根。' + (nearest ? '（全局最近认证根见 nearestCertifiedRoot）' : '（该方程在默认域内也无实根）'),
    // Agent 决策块：明确告诉它「你错了，错在哪，正确的值是什么」——
    // 调研实据：Agent 拿到「refuted」但没有纠正值时，最常见的失败是反复重算同一个错数，
    // 或者悄悄保留原答案。把 corrected 提前到决策位，逼它先改再往下走。
    trust: {
      safeToUse: false,
      agentAction: nearest
        ? 'Candidate REFUTED. Replace it with corrected.values before using it downstream — do not report the original candidate.'
        : 'Candidate REFUTED, and this equation has no certified real root in the default domain. '
          + 'Do not report the candidate. Either the equation has no real solution, or a domain is needed.',
      corrected: nearest ? nearest.values : null,
      correctedText: nearest ? nearest.text : null,
      correctionMagnitude: nearest ? (function () {
        let m = 0;
        for (let i = 0; i < candPoint.length; i++) {
          const d = Math.abs(nearest.values[i] - candPoint[i]);
          if (d > m) m = d;
        }
        return detF(m);
      })() : null
    },
    nearestCertifiedRoot: nearest, reportId: shaped.reportId
  };
}

module.exports = {
  MAX_TOTAL_CHARS, MAX_EQ_COUNT, MAX_VAR_COUNT,
  fmtText, detF, shapeResult, shapeCertification, buildPolyEquation, buildTrust,
  doSolve, doPolyRoots, doVerify
};
