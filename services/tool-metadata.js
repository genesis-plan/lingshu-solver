/**
 * MCP 工具元数据 —— stdio 端与 HTTP 端**唯一来源**（2026-10-03 新增）。
 *
 * 为什么抽出：改造前 `mcp-server.js` 与 `http-mcp-server.js` 各自手抄了一份 TOOLS，
 * 结果 stdio 端把 solve 的 description 从 2160 字符压到 790 字符时，HTTP 端没跟着改——
 * **同一个工具在两个入口对 Agent 呈现不同的能力说明**，这比代码分叉更隐蔽：
 * 代码分叉有测试会红，文案分叉没有任何测试会发现。
 * 与 services/solver-service.js（求解域共享层）同一个思路：能共享的绝不复制。
 *
 * 描述的写法原则（面向 AI Agent 这个客群，不是面向人类读者）：
 *   1. 只写「Agent 决策必需」的信息：何时用、何时别用、结果怎么读、什么时候必须重试。
 *   2. 参数细节写进 inputSchema 的字段 description，不要在工具级描述里重复列举
 *      —— 工具级描述每轮对话都在上下文里，重复列举等于每轮都收重复税。
 *   3. 硬约束（6 变量上限、解坐标全精度输出、paywall）必须写明：Agent 靠它预判并自我约束。
 *      ⚠ 2026-10-05：这里**不要**再写「6 位小数/有限网格」—— 网格已废除，
 *        描述里写死位数会让 Agent 误以为 values 是被截断的。要位数就让它读 values。
 *
 * 实测成本：四工具描述合计 2867 字符 ≈ 796 token（改造前 4659 字符 ≈ 1294 token）。
 */

/**
 * solve 工具描述（stdio 与 HTTP 共用同一字符串）
 *
 * ⚠⚠ 长度是**硬预算**（tools-parity 守 <1000 且余量 ≥30 字符，每轮对话都收这份描述的税）。
 *   2026-10-04 加分页说明时被迫砍掉四处纯修辞/重复，每处都记下判据：
 *     ① "Use it instead of computing the math yourself whenever a wrong number has a cost."（82B）
 *     ② "so caching and retries are safe"（36B，同输入同输出已由 reportId 承载）
 *   ③ "when more exist the response carries …"（30B，nextOffset 这个键名自带语义）
 *    ④ "initial-value "（9B，「不支持 ODE」这个信息没丢，只丢限定词）
 *    ⑤ "BEFORE TRUSTING A RESULT"（27B，"READ THE TIERS" 已含警告语气）
 *   —— 砍它们的判据是：**不含任何可判定信息**（既没说输入什么、也没说输出什么、
 *   也没说结果可不可信），纯劝告。而下面每一句都有 Agent 可据此行动的事实。
 *   ⇒ 以后再加内容，只能从「不含可判定信息」的那一类里砍，别去砍 tier / 分页 / 完备性。
 */
const SOLVE_DESC = 'Deterministic (non-LLM) solver for systems of real equations. Same input always returns the identical result — no hallucination, no randomness. Supports algebraic equations and common transcendentals (sin/cos/tan/log/exp/sqrt/abs), max 6 variables, no initial guess needed. READ THE trust BLOCK: it tells you, per result, whether the value is safe to use directly or must be verified first. Pass domain explicitly for exp/sin or large ranges, else truncated may be true. Not for symbolic derivation, ODEs, or integer constraints. '
  // completeness（2026-10-04）：解数上界来自 Newton 多胞形的混合体积（BKK）/ Bézout。
  // Agent 真正要的是「能不能收工」，不是「有几个数」，所以这条必须写进工具级描述 ——
  // 否则 Agent 不知道返回体里有这个字段，会永远靠猜（猜错就是漏解或空转）。
  // ⚠ 长度受 tools-parity 的 <1000 字符红线约束（每轮对话都收这份描述的税），
  //   所以只留「三态怎么行动」+「(C*)^n 的坑」，定理细节进 SKILL.md 与使用指南。
  + 'trust.completeness.status: complete = found count equals a proven bound, safe to claim you found them all; incomplete/unknown = do not. scope \'(C*)^n\' excludes zero-coordinate solutions. '
  // 分页（2026-10-04）：**必须**写进工具级描述，否则 Agent 永远发现不了 n 这个参数 ——
  //   参数在 inputSchema 里只是「一个可选数字」，它没有理由猜到那是翻页用。
  //   实测 16 解场景 solutions 只有 2 个，不教它分页它就会拿 2 个当全部 ⇒ 漏解。
  //
  // ⚠⚠ 这段是 tools-parity <1000 字符红线的最后 200 字符预算，写它时必须**同时**满足：
  //   ① Agent 看得懂「怎么取回剩下的」；② Agent 分得清「已算完」与「没算完」——
  //   这两件事分别对应「漏解」与「假指令（去加预算）」两种真实事故。
  //   所以 budget_exhausted 的对照不能砍：它 2026-10-04 才修掉一个 P0
  //   （引擎已找全却报 budget_exhausted，Agent 照做假指令重试一百次）。
  //   已砍的三处修辞/重复（各带判据，见文件头）：
  //     "Use it instead of computing the math yourself…"(82B)、"so caching and retries are safe"(36B)、
  //     "the response carries nextOffset and trust.moreAvailable" 里的后者(30B，数字在字段里自带)
  + 'At most 2 solutions are listed; call again with n=nextOffset for the rest. trust.trustLevel=complete_but_shown_partially means the search already finished (raising the budget will NOT help); budget_exhausted means it did not.';

const FEEDBACK_DESC = 'Report a problem to the operator when solve hits a dead end, returns an error, or produces something you believe is wrong. The text is written to a local log only and is never transmitted anywhere else.';

const POLY_DESC = 'All real roots of a polynomial, each individually Krawczyk-certified with a strict error box. Coefficients are highest degree first: [1,-2,-5,6] means x^3-2x^2-5x+6. Use it instead of letting a language model estimate roots. Complex roots are not returned (real only). At most 2 roots are listed per call; when more exist the response carries nextOffset and trust.moreAvailable — call again with n=nextOffset to get the rest, otherwise you will report an incomplete root set.';

'use strict';

const { opList } = require('./geometry/index.js');   // op 清单从几何层动态取，杜绝「加了 op 忘了写进描述」

const VERIFY_DESC = 'Check whether a claimed answer is actually correct — call this on any number you computed yourself before passing it downstream. verdict=verified means it is a certified real root; verdict=refuted_or_unverified means it is NOT, and nearestCertifiedRoot then carries the correct value so you can self-correct in the same turn. Deterministic and reproducible.';

/**
 * geometry 工具描述。
 *
 * 为什么是「一个工具 + op 分派」而不是 87 个独立工具：
 *   tools/list 的结果**每轮对话都在上下文里**。87 个工具 × 各约 200 字符
 *   description+schema ≈ 4000 token/轮的固定开销；一个工具 + op 名字清单
 *   只有约 600 token。完整签名**按需**在 op 错误时返回（一次性成本）。
 *
 * op 清单由几何层动态生成 —— 新增 op 时描述自动跟上，不会出现
 * 「代码里有但 Agent 看不见」的静默遗漏（这类遗漏没有任何测试能发现）。
 */
const GEOM_OP_LIST = (function () {
  const by = opList();
  return ['1D', '2D', '3D', 'any']
    .map(k => k + ': ' + by[k].join(','))
    .join(' | ');
})();

const GEOMETRY_DESC = 'Deterministic 1D/2D/3D geometry: distances, intersections, areas, volumes, angles, convex hull, point-in-polygon, rotations. Closed-form (not iterative), exact up to floating-point rounding, identical output for identical input. Use it instead of doing geometry yourself. Pass {op, ...args} with op one of: '
  + GEOM_OP_LIST
  + '. The remaining args are passed flat and depend on op (p, q, a, b, c, d, r, poly, pts, angle, lambda, center, axis, segment, a1,b1,c1,a2,b2,c2, ...). Send an unknown op to receive the full catalog with every signature. '
  + 'READ trust.trustLevel: exact = safe to use directly; definitely_none = computed proof that there is NO intersection, safe to state as a conclusion; degenerate = the INPUT is degenerate (parallel / collinear / coplanar / coincident), do NOT invent a value — report the degeneracy instead.';

/** solve 的输入 schema 描述片段 */
const SCHEMA = {
  equations: 'Equation strings with "=", e.g. ["x^2 + y^2 = 25", "x + y = 7"]. Operators: + - * / ^ sqrt log sin cos tan exp abs. In-text domain constraints allowed: "x in [-30,30]". 1 to 64 equations, at least as many as variables.',
  variables: 'Variable names. Omit to auto-detect from the equation text in order of appearance. Max 6; more than 6 is rejected, not approximated.',
  domain: 'Search domain per variable, e.g. {"x":[-30,30],"y":[-30,30]}. Defaults to +/-1e6 each. Set it for exp/sin/large ranges: a too-wide default domain may fail to prune and set truncated=true.',
  fastMode: 'Skip the expensive certification layers. Faster but tiers degrade to candidate. Default false.',
  options: 'Advanced: {budget, maxDepth}. Raise budget when truncated=true and you need completeness.',
  offset: 'Pagination offset for the solution list. Omit for the first page. When a response carries nextOffset, pass it back as n to get the remaining solutions — the response shows at most 2 at a time.',
  coefficients: 'Highest degree first, e.g. [1,-2,-5,6] means x^3-2x^2-5x+6.',
  polyTolerance: 'Root-decision tolerance (optional; internal precision by default).',
  equation: 'A single equation with "=", e.g. "x^2 = 4".',
  candidate: 'The claimed answer: a number (single variable, defaults to x), {variable:value} pairs, or an array in variables order.',
  verifyVariables: 'Required for multi-variable or array candidates, e.g. ["x","y"].',
  verifyTolerance: 'Search radius around the candidate (default 1e-3).',
  fbMessage: 'What you hit, what you expected, and what you actually got.',
  fbContext: 'Optional context: the triggering scenario or input characteristics.'
};

/** honorPaid 的统一说明（付费/免费口径属商业信息，两端必须一致） */
const HONOR_PAID_DESC = 'Honor system: set true to declare this call personal or evaluation use. It is released for free with no verification and no balance deduction. Set false only when this runs inside a product, a commercial pipeline or an automated workflow; payment is voluntary and never enforced.';
const HONOR_PAID_DISCLAIMER = ' Optional: pass honorPaid:true to declare personal or evaluation use — it is then served free with no key, no balance and no deduction; payment is voluntary and never enforced.';

/**
 * 构造工具定义。
 * @param {object} opts
 * @param {boolean} opts.http true = HTTP 端（多一个 honorPaid 参数声明）
 */
function buildTools(opts) {
  const isHttp = !!(opts && opts.http);
    const solveProps = {
    equations: { type: 'array', items: { type: 'string' }, description: SCHEMA.equations },
    variables: { type: 'array', items: { type: 'string' }, description: SCHEMA.variables },
    domain: { type: 'object', description: SCHEMA.domain },
    fastMode: { type: 'boolean', description: SCHEMA.fastMode },
    options: { type: 'object', description: SCHEMA.options },
    n: { type: 'number', description: SCHEMA.offset }
  };
  if (isHttp) solveProps.honorPaid = { type: 'boolean', description: HONOR_PAID_DESC };

  return [
    {
      name: 'solve',
      description: SOLVE_DESC + (isHttp ? HONOR_PAID_DISCLAIMER : ''),
      inputSchema: { type: 'object', properties: solveProps, required: ['equations'] }
    },
    {
      name: 'give_feedback',
      description: FEEDBACK_DESC,
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: SCHEMA.fbMessage },
          context: { type: 'string', description: SCHEMA.fbContext }
        },
        required: ['message']
      }
    },
    {
      name: 'poly_roots',
      description: POLY_DESC,
      inputSchema: {
        type: 'object',
        properties: {
          coefficients: { type: 'array', items: { type: 'number' }, description: SCHEMA.coefficients },
          tolerance: { type: 'number', description: SCHEMA.polyTolerance },
          n: { type: 'number', description: SCHEMA.offset }
        },
        required: ['coefficients']
      }
    },
    {
      name: 'verify',
      description: VERIFY_DESC,
      inputSchema: {
        type: 'object',
        properties: {
          equation: { type: 'string', description: SCHEMA.equation },
          candidate: { description: SCHEMA.candidate, oneOf: [{ type: 'number' }, { type: 'object' }, { type: 'array' }] },
          variables: { type: 'array', items: { type: 'string' }, description: SCHEMA.verifyVariables },
          tolerance: { type: 'number', description: SCHEMA.verifyTolerance }
        },
        required: ['equation', 'candidate']
      }
    },
    GEOMETRY_TOOL
  ];
}

/**
 * geometry 工具定义（单独导出，供 HTTP 端那一份尚未迁移到 buildTools 的
 * TOOLS 数组直接引用 —— 两端仍是同一个对象，不是两份文案）。
 *
 * 87 个 op 共用一个工具（理由见 GEOMETRY_DESC 上方注释）。
 * additionalProperties:true 是**必须的**：各 op 的签名不同（p,q / a,b,c / poly / r ...），
 * 无法在一份静态 schema 里穷举，只能允许平铺的额外键，由几何层自己校验。
 */
const GEOMETRY_TOOL = {
  name: 'geometry',
  description: GEOMETRY_DESC,
  inputSchema: {
    type: 'object',
    properties: {
      op: { type: 'string', description: 'Geometry operation name. See the tool description for the full list, or send an unknown value to receive the catalog with signatures.' }
    },
    required: ['op'],
    additionalProperties: true
  }
};

module.exports = {
  buildTools, GEOMETRY_TOOL,
  SOLVE_DESC, FEEDBACK_DESC, POLY_DESC, VERIFY_DESC, GEOMETRY_DESC, GEOM_OP_LIST, SCHEMA
};
