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
function buildTrust({ typeName, allProven, cleanSols, diagnostics, r, hasInputError }) {
  const provenCount = cleanSols.filter((s) => s.tier === 'proven').length;
  const total = cleanSols.length;

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
    trustLevel = 'budget_exhausted';
    safeToUse = false;
    agentAction = 'Search was truncated by the budget, so the solution list may be incomplete. '
      + 'The listed solutions are still valid, but there may be more. Narrow domain or raise budget if completeness matters.';
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
    provenCount,
    candidateCount: total - provenCount,
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
  };
}

function shapeResult(r) {
  const sols = Array.isArray(r.solutions) ? r.solutions : [];
  const meta = r.meta || {};
  const varNames = (Array.isArray(r.varNames) && r.varNames.length)
    ? r.varNames
    : (sols[0] && Array.isArray(sols[0].values) ? sols[0].values.map((_, i) => 'x' + (i + 1)) : []);

  // 推荐解：距原点最近（范数最小），与界面一致
  let recommended = null, best = Infinity;
  for (const s of sols) {
    if (!s || !Array.isArray(s.values)) continue;
    let d = 0;
    for (const v of s.values) d += v * v;
    if (d < best) { best = d; recommended = s; }
  }
  const tierSet = new Set(sols.map(s => (s && s.tier) || 'unknown'));
  const allProven = sols.length > 0 && [...tierSet].every(t => t === 'proven');
  const typeName = r.resultType === 1 ? 'empty' : r.resultType === 3 ? 'infinite' : 'finite';

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
      cert: s.cert || null
    };
  });
  const recommendedClean = recommended ? cleanSols[sols.indexOf(recommended)] : null;

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
  } else {
    summary = `找到 ${sols.length} 个实数解${allProven ? '（全部经 Krawczyk 区间认证）' : ''}。`;
  }

  // diagnostics 只保留 Agent 决策 / fail-closed 必需项（2026-10-03 瘦身，185B → 精简）。
  // ⚠ provenEmpty 是 fail-closed 的关键（区分「严格证明无解」与「预算内没找到」），
  //   buildTrust 依赖它，故**保留在本地变量里**，只是不进返回体 ——
  //   对 Agent 而言 trust.trustLevel/agentAction 已把这件事说清了（verified_empty vs unverified），
  //   再给一个原始布尔是重复。删它曾导致 buildTrust 的 provenEmpty 分支静默失效。
  const _provenEmpty = !!(r.provenEmpty || meta.provenEmpty);
  const diagnostics = {
    // 保留：Agent 必须能把「输入不可解析」与「已证明无解」分开，
    // 否则会把"我读不懂你的输入"误报成"这个系统无解"。托管端计费层也据此判非计费。
    inputError: r.error || null,
    inputErrorMessage: r.message || null,
    // 保留：truncated=true 时 Agent 必须知道"解可能不全"，这直接影响它能否断言无解。
    truncated: !!(r.truncated || meta.truncated),
  };
  // buildTrust 用的完整视图（不进入返回体，仅内部传递）
  const trustDiag = Object.assign({}, diagnostics, { provenEmpty: _provenEmpty });
  // 以下已从返回体删除（实测 185B → 约 90B）：
  //   solverVersion  —— 版本信息在 tool description 与 reportId 里都有，Agent 决策不用
  //   terminatedBy   —— 终止原因属调试信息；Agent 只关心 truncated 这个布尔
  //   provenCount    —— 与 trust.provenCount 完全同值，纯重复
  //   completeness   —— 完备性已在 certification.certifiedCoverage 体现，且它是 detF 数值对象（体积大）

  return {
    resultType: r.resultType,
    resultTypeName: typeName,
    certified: allProven,
    truncated: diagnostics.truncated,
    precisionDecimals: AGENT_DISPLAY_DECIMALS,   // Agent 展示位数（4）。内部计算精度仍为 6，见 AGENT_DISPLAY_DECIMALS 处说明
    solutionCount: sols.length,
    // Agent 决策块放最前：LLM 读 JSON 时前面的字段权重更高，先给结论再给细节
    trust: buildTrust({
      typeName, allProven, cleanSols, diagnostics: trustDiag, r,
      hasInputError: !!(r.error)
    }),
    // 2026-10-03 瘦身：顶层 instructions 字段已删（162B）。
    // 它原是自然语言版读法指引，与 tool description 的 "READ THE TIERS" 段重复；
    // 其唯一不可替代的硬规则（unverified/budget_exhausted 时不得断言无解）
    // 已浓缩进 trust.mustNotClaim（枚举形式，更精确且更省）。
    summary: summary,
    recommended: recommendedClean,
    solutions: cleanSols,
    warnings: r.warnings || [],
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

/** 裁剪 certification：只留 Agent 决策必需的汇总计数，去掉 reproducibility 说明段。 */
function shapeCertification(cert) {
  if (!cert || typeof cert !== 'object') return cert || null;
  return {
    proven: cert.proven,
    candidate: cert.candidate,
    structural: cert.structural,
    emptyProof: cert.emptyProof,
    // 覆盖率是「有多少解被认证过」的关键信号，Agent 据此判断整体可信度
    certifiedCoverage: cert.certifiedCoverage
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
  return shapeResult(solve(eqs, vars, 6, domain, fastMode, opts));
}

function doPolyRoots(args) {
  const coeffs = args && args.coefficients;
  if (!Array.isArray(coeffs) || coeffs.length < 2) throw { type: 'invalid_input', message: 'coefficients 必须是长度≥2 的数组（最高次系数在前）' };
  for (const c of coeffs) if (typeof c !== 'number' || !isFinite(c)) throw { type: 'invalid_input', message: 'coefficients 须为有限数字' };
  const eq = buildPolyEquation(coeffs);
  return shapeResult(solve([eq], ['x'], 6, undefined, false, {}));
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
  const shaped = shapeResult(r);
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
