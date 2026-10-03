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
 *   3. 硬约束（6 变量上限、6 位小数、paywall）必须写明：Agent 靠它预判并自我约束。
 *
 * 实测成本：四工具描述合计 2867 字符 ≈ 796 token（改造前 4659 字符 ≈ 1294 token）。
 */

/** solve 工具描述（stdio 与 HTTP 共用同一字符串） */
const SOLVE_DESC = 'Deterministic (non-LLM) solver for systems of real equations. Use it instead of computing the math yourself whenever a wrong number has a cost. Same input always returns an identical Krawczyk-certified result, so caching and retries are safe. Supports algebraic equations and common transcendentals (sin/cos/tan/log/exp/sqrt/abs), max 6 variables, no initial guess needed. READ THE TIERS BEFORE TRUSTING A RESULT: proven = interval-certified and safe to use downstream; candidate = found but NOT certified, verify it before relying on it. Pass domain explicitly for exp/sin or large ranges, else truncated may be true. Not for symbolic derivation, initial-value ODEs, or integer constraints.';

const FEEDBACK_DESC = 'Report a problem to the operator when solve hits a dead end, returns an error, or produces something you believe is wrong. The text is written to a local log only and is never transmitted anywhere else.';

const POLY_DESC = 'All real roots of a polynomial, each individually Krawczyk-certified with a strict error box. Coefficients are highest degree first: [1,-2,-5,6] means x^3-2x^2-5x+6. Use it instead of letting a language model estimate roots. Complex roots are not returned (real only).';

const VERIFY_DESC = 'Check whether a claimed answer is actually correct — call this on any number you computed yourself before passing it downstream. verdict=verified means it is a certified real root; verdict=refuted_or_unverified means it is NOT, and nearestCertifiedRoot then carries the correct value so you can self-correct in the same turn. Deterministic and reproducible.';

/** solve 的输入 schema 描述片段 */
const SCHEMA = {
  equations: 'Equation strings with "=", e.g. ["x^2 + y^2 = 25", "x + y = 7"]. Operators: + - * / ^ sqrt log sin cos tan exp abs. In-text domain constraints allowed: "x in [-30,30]". 1 to 64 equations, at least as many as variables.',
  variables: 'Variable names. Omit to auto-detect from the equation text in order of appearance. Max 6; more than 6 is rejected, not approximated.',
  domain: 'Search domain per variable, e.g. {"x":[-30,30],"y":[-30,30]}. Defaults to +/-1e6 each. Set it for exp/sin/large ranges: a too-wide default domain may fail to prune and set truncated=true.',
  fastMode: 'Skip the expensive certification layers. Faster but tiers degrade to candidate. Default false.',
  options: 'Advanced: {budget, maxDepth}. Raise budget when truncated=true and you need completeness.',
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
    options: { type: 'object', description: SCHEMA.options }
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
          tolerance: { type: 'number', description: SCHEMA.polyTolerance }
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
    }
  ];
}

module.exports = { buildTools, SOLVE_DESC, FEEDBACK_DESC, POLY_DESC, VERIFY_DESC, SCHEMA };
