#!/usr/bin/env node
/**
 * 灵数求解器 · MCP stdio 服务端（零依赖）
 *
 * 手工实现 JSON-RPC 2.0 + 换行符分隔 JSON（与官方 MCP SDK 客户端一致，不依赖任何 MCP SDK）。
 * 核心求解能力来自同目录 solver-core.js（读取 index.html 的已验证核心脚本）。
 *
 * 暴露工具：
 *   1) solve         —— 求解方程组，返回结构化结果（含可信层级 tier 与 truncated 标记）
 *   2) give_feedback —— 供 AI 智能体主动回报卡点或建议
 *
 * 安全原则：离线、零数据、结构化错误不泄露内部堆栈；调用日志仅记元数据（不记方程内容）。
 *
 * 运行：node mcp-server.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { solve } = require('./solver-core');

const SERVER_NAME = 'lingshu-solver';
const SERVER_VERSION = '1.0.16';

// ---- 护栏常量（防畸形/恶意输入耗尽资源）----
const MAX_TOTAL_CHARS = 100 * 1024;   // 单次请求方程文本总长上限 100KB
const MAX_EQ_COUNT = 64;              // 方程数量上限
const MAX_VAR_COUNT = 6;              // 变量数量上限（与产品规格一致）

// ---- 本地日志（仅元数据，零数据不外传）----
const LOG_PATH = path.resolve(__dirname, 'calls.log');
const FEEDBACK_PATH = path.resolve(__dirname, 'feedback.log');
function appendLog(p) {
  try {
    fs.appendFileSync(LOG_PATH, JSON.stringify(p) + '\n');
  } catch (_e) { /* 日志失败不影响服务 */ }
}

// ---- 求解结果整理 ----
// 数值格式化：固定 6 位小数（产品规格「6位小数有限网格」），与界面一致。
// 解点 values 经 roundToGrid 吸附到 6 位网格，实际残差通常 ≤ 1e-9。
const fmt6 = (v) => (typeof v === 'number' && isFinite(v)) ? v.toFixed(6) : String(v);
// 确定性浮点吸附：消除 IEEE-754 末位 ULP 抖动，保证「同输入输出字节级可复现」
const detF = (v) => (typeof v === 'number' && isFinite(v)) ? Number(v.toFixed(12)) : null;

function shapeResult(r) {
  const sols = Array.isArray(r.solutions) ? r.solutions : [];
  const meta = r.meta || {};
  // 变量名：优先用求解器识别结果，否则退化为 x1/x2/...
  const varNames = (Array.isArray(r.varNames) && r.varNames.length)
    ? r.varNames
    : (sols[0] && Array.isArray(sols[0].values) ? sols[0].values.map((_, i) => 'x' + (i + 1)) : []);

  // 推荐解：取范数最小者（与界面"距原点最近"一致）
  let recommended = null;
  let best = Infinity;
  for (const s of sols) {
    if (!s || !Array.isArray(s.values)) continue;
    let d = 0;
    for (const v of s.values) d += v * v;
    if (d < best) { best = d; recommended = s; }
  }
  const tierSet = new Set(sols.map(s => (s && s.tier) || 'unknown'));
  const allProven = sols.length > 0 && [...tierSet].every(t => t === 'proven');
  const typeName = r.resultType === 1 ? 'empty' : r.resultType === 3 ? 'infinite' : 'finite';

  // 每个解：保留机器友好字段（values/tier/certified）+ 人类可读 text；
  // 内部数值（residual/certifiedRadius）收进 internals，机器可整块跳过。
  const cleanSols = sols.map((s) => {
    const vals = Array.isArray(s.values) ? s.values : [];
    const text = varNames.map((vn, i) => `${vn}=${fmt6(vals[i])}`).join(', ');
    return {
      values: vals,
      tier: s.tier || 'unknown',
      certified: !!s.certified,
      text: text,
      cert: s.cert || null,
      internals: {
        residual: detF(s.residual),
        certifiedRadius: detF(s.certifiedRadius)
      }
    };
  });
  const recommendedClean = recommended ? cleanSols[sols.indexOf(recommended)] : null;

  // 人类可读总览（A）
  let summary;
  if (typeName === 'empty') {
    summary = '严格证明：该方程组无实数解。';
  } else if (typeName === 'infinite') {
    summary = `无限解集；给出距原点最近的推荐解（共展示 ${sols.length} 个候选）。`;
  } else {
    summary = `找到 ${sols.length} 个实数解${allProven ? '（全部经 Krawczyk 区间认证）' : ''}。`;
  }

  // 诊断信息（B）：仅精选对调用方有用的少量字段，不再透传 meta 中 19 个内部运维字段，
  // 以降低机器侧 token 噪音。如需完整内部轨迹，可另接调试端点。
  const diagnostics = {
    solverVersion: meta.solverVersion || null,
    truncated: !!(r.truncated || meta.truncated),
    // 解析失败原因（如 NO_EQUATION）。新增：让调用方能区分「输入不可解析」与「已证明无解」，
    // 并让托管端点的计费层把「解析失败」判为非计费情形（不收「我解析不了」的钱）。
    inputError: r.error || null,
    terminatedBy: meta.terminatedBy || null,
    provenCount: (typeof r.provenCount === 'number') ? r.provenCount : null,
    completeness: detF(r.completeness)
  };

  return {
    resultType: r.resultType,
    resultTypeName: typeName,
    certified: allProven,
    truncated: diagnostics.truncated,
    precisionDecimals: 6,
    solutionCount: sols.length,
    summary: summary,
    recommended: recommendedClean,
    solutions: cleanSols,
    warnings: r.warnings || [],
    reportId: meta.reportId || r.reportId || null,
    certification: r.certification || null,
    diagnostics: diagnostics
  };
}

function doSolve(args) {
  const eqs = args && args.equations;
  if (!Array.isArray(eqs) || eqs.length === 0) {
    throw { type: 'invalid_input', message: 'equations 必须是非空字符串数组' };
  }
  if (eqs.length > MAX_EQ_COUNT) {
    throw { type: 'invalid_input', message: `方程数量超过上限 ${MAX_EQ_COUNT}` };
  }
  let total = 0;
  for (const e of eqs) {
    if (typeof e !== 'string') throw { type: 'invalid_input', message: '每条方程必须是字符串' };
    total += e.length;
  }
  if (total > MAX_TOTAL_CHARS) {
    throw { type: 'invalid_input', message: '方程文本总长超过 100KB 上限' };
  }
  const vars = (args && Array.isArray(args.variables)) ? args.variables : [];
  if (vars.length > MAX_VAR_COUNT) {
    throw { type: 'invalid_input', message: `变量数量超过上限 ${MAX_VAR_COUNT}` };
  }
  const domain = (args && args.domain) || undefined;
  const fastMode = !!(args && args.fastMode);
  const opts = (args && args.options) || {};
  // 输出精度固定为 6 位小数（产品规格「6位小数有限网格」），与界面一致，不提供位数切换
  const r = solve(eqs, vars, 6, domain, fastMode, opts);
  return shapeResult(r);
}

// ---- 新工具：poly_roots / verify（agent 时代适配，薄封装 solve，不碰内核）----
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

function doPolyRoots(args) {
  const coeffs = args && args.coefficients;
  if (!Array.isArray(coeffs) || coeffs.length < 2) throw { type: 'invalid_input', message: 'coefficients 必须是长度≥2 的数组（最高次系数在前）' };
  for (const c of coeffs) if (typeof c !== 'number' || !isFinite(c)) throw { type: 'invalid_input', message: 'coefficients 须为有限数字' };
  const eq = buildPolyEquation(coeffs);
  const r = solve([eq], ['x'], 6, undefined, false, {});
  return shapeResult(r);
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
      matchedRoot: { values: matched.values, tier: matched.tier, certified: !!matched.certified, cert: matched.cert || null,
        text: varNames.map(function (vn, i) { return vn + '=' + fmt6(matched.values[i]); }).join(', ') },
      reportId: shaped.reportId, certification: shaped.certification
    };
  }
  let nearest = null;
  try {
    // refuted：在更宽域（默认 ±1e6）重算，给 Agent 全局最近的「真认证根」——
    // 否则当 LLM 把根算偏（如猜 2.1、真根 2）时，窄邻域内无解会导致 nearest 为空，
    // Agent 看不到正确值，verify 就失去了「纠正 LLM」的核心价值。
    const rb = solve([eq], varNames, 6, undefined, false, {});
    const solsB = (rb.solutions || []).filter(function (s) { return Array.isArray(s.values); });
    if (solsB.length) {
      let bestD = Infinity, bestS = null;
      for (const s of solsB) { let d = 0; for (let i = 0; i < s.values.length; i++) d += (s.values[i] - candPoint[i]) * (s.values[i] - candPoint[i]); if (d < bestD) { bestD = d; bestS = s; } }
      nearest = { values: bestS.values, tier: bestS.tier || null, certified: !!bestS.certified, cert: bestS.cert || null,
        text: varNames.map(function (vn, i) { return vn + '=' + fmt6(bestS.values[i]); }).join(', ') };
    }
  } catch (_e) { /* 宽域重算失败不致命，nearest 保持 null */ }
  return {
    verdict: 'refuted_or_unverified', isRoot: false, candidate: cand,
    message: '在候选点 ±' + margin + ' 邻域内未找到与之匹配的认证根；候选不是经验证的实根。' + (nearest ? '（全局最近认证根见 nearestCertifiedRoot）' : '（该方程在默认域内也无实根）'),
    nearestCertifiedRoot: nearest, reportId: shaped.reportId
  };
}

// ---- 工具定义 ----
const TOOLS = [
  {
    name: 'solve',
    description: 'Deterministic solver for systems of real equations. This is not a language model: no randomness, and identical input always returns an identical, reproducible result. Use it when you need a verifiable, reproducible numeric answer for algebraic equations or common transcendentals (sin/cos/tan/log/exp/sqrt/abs); it works well as a non-hallucinating math backend for an AI agent. Not suitable for symbolic algebra, closed-form proofs, initial-value ODEs, or mandatory integer equality. INPUT: equations (array of strings containing an equals sign, e.g. ["x^2+y^2=25","x+y=7"]); supported operators + - * / ^ sqrt log sin cos tan exp abs, with in-text domain constraints such as x in [-30,30]; variables (optional, auto-detected, max 6); domain (optional, e.g. {"x":[-30,30]}), defaulting to +/-1e6 per variable. HARD LIMITS: at most 6 variables; 1 to 64 equations and the equation count must be at least the variable count; up to 100KB of equation text per call; output is fixed at 6 decimal places and is not configurable. OUTPUT (JSON): resultType is empty (no real solutions, proven), finite (finite verified solutions) or infinite (infinite solution set, only the recommended nearest-to-origin solution is given); summary; solutions[] with values[] (6-decimal numbers), tier (proven means Krawczyk-certified, otherwise likely or candidate), certified, text; residual and other internals under internals; recommended holds the compact nearest-to-origin structure. truncated=true means the global branch-and-bound did not finish inside the budget; it does not necessarily mean solutions were missed and in most cases every real solution was found; narrow the domain or raise options.budget and retry if you need a completeness guarantee. Errors return error.type (invalid_input or internal_error). If something looks wrong, call give_feedback rather than guessing. The same input always produces the exact same output, so caching and retries are safe. PAYMENT: this endpoint is free to use. Pass honorPaid:true to declare personal or evaluation use and the call is served with no verification and no balance deduction; payment is voluntary and never enforced.',
    inputSchema: {
      type: 'object',
      properties: {
        equations: {
          type: 'array', items: { type: 'string' },
          description: 'Array of equation strings, e.g. ["x^2 + y^2 = 25", "x + y = 7"]. Supports + - * / ^ sqrt log sin cos tan exp abs, plus in-text domain constraints such as x in [-30,30].'
        },
        variables: {
          type: 'array', items: { type: 'string' },
          description: 'Variable names (optional). If omitted they are auto-detected from the equation text, in order of appearance. Maximum 6.'
        },
        domain: {
          type: 'object',
          description: 'Explicit search domain (optional), e.g. {"x":[-30,30],"y":[-30,30]}. Recommended for near-infinite solution sets or fast-growing functions such as exp or sinh; without it the default +/-1e6 may fail to prune and set truncated.'
        },
        fastMode: { type: 'boolean', description: 'Fast mode (default false).' },
        options: { type: 'object', description: 'Advanced options (optional), e.g. {budget:500000, maxDepth:28}' }
      },
      required: ['equations']
    }
  },
  {
    name: 'give_feedback',
    description: 'Report a problem to the operator when solve hits a dead end, returns an error, or produces something you believe is wrong. The text is written to a local log only and is never transmitted anywhere else.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'What you hit, what you expected, and what you actually got.' },
        context: { type: 'string', description: 'Optional context: the triggering scenario or input characteristics.' }
      },
      required: ['message']
    }
  },
  {
    name: 'poly_roots',
    description: 'All real roots of a polynomial, each individually certified by Krawczyk with a strict error box. Coefficients are ordered highest degree first, so [1,-2,-5,6] means x^3-2x^2-5x+6. Deterministic and reproducible; complex roots are not returned (real numbers only). Use it as a reliable polynomial root component instead of letting a general language model estimate roots. Free to use: pass honorPaid:true to declare personal or evaluation use.',
    inputSchema: {
      type: 'object',
      properties: {
        coefficients: { type: 'array', items: { type: 'number' }, description: 'Polynomial coefficients, highest degree first. [1,-2,-5,6] means x^3-2x^2-5x+6.' },
        tolerance: { type: 'number', description: 'Tolerance used to decide a root (optional; internal precision is used by default).' }
      },
      required: ['coefficients']
    }
  },
  {
    name: 'verify',
    description: 'Check whether a claimed answer is correct. Give the equation plus a candidate value (a number for a single variable, {variable:value} pairs, or an array in variable order); the same certified kernel runs in a neighbourhood around the candidate. If a matching certified root is found the result is verified together with the error box; otherwise it is refuted and the nearest certified root is returned, so the calling agent immediately sees the correct value. Deterministic, not an LLM, reproducible across calls. Free to use: pass honorPaid:true to declare personal or evaluation use.',
    inputSchema: {
      type: 'object',
      properties: {
        equation: { type: 'string', description: 'A single equation containing an equals sign, e.g. "x^2 = 4".' },
        candidate: { description: 'The claimed answer: a number (single variable, default variable x), {variable:value} for multiple variables, or an array in variables order.', oneOf: [{ type: 'number' }, { type: 'object' }, { type: 'array' }] },
        variables: { type: 'array', items: { type: 'string' }, description: 'Variable names (required for multiple variables or array candidates), e.g. ["x","y"].' },
        tolerance: { type: 'number', description: 'Neighbourhood radius (optional, default 1e-3) within which a matching certified root is searched.' }
      },
      required: ['equation', 'candidate']
    }
  }
];

// ---- stdio 帧格式：换行符分隔的 JSON（与官方 MCP SDK 客户端一致）----
// 官方 SDK 的 serializeMessage 写 `JSON + '\n'`，ReadBuffer 按行解析；
// 故服务端也必须用同样格式收发，否则 Claude/Cursor/Cline 等 stdio 客户端收不到响应。
let lineBuf = '';

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function handle(msg) {
  const id = msg.id;
  const method = msg.method;
  const params = msg.params || {};

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
      }
    });
    return;
  }
  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    return;
  }
  if (method === 'tools/call') {
    const name = params.name;
    const args = params.arguments || {};
    const t0 = Date.now();
    try {
      let result;
      if (name === 'solve') {
        result = doSolve(args);
      } else if (name === 'give_feedback') {
        const msg_fb = (args.message || '').toString().slice(0, 2000);
        fs.appendFileSync(FEEDBACK_PATH, JSON.stringify({
          ts: new Date().toISOString(), message: msg_fb, context: args.context || null
        }) + '\n');
        result = { acknowledged: true, note: '反馈已记录（本地，不外传）' };
      } else if (name === 'poly_roots') {
        result = doPolyRoots(args);
      } else if (name === 'verify') {
        result = doVerify(args);
      } else {
        throw { type: 'unknown_tool', message: '未知工具: ' + name };
      }
      const dt = Date.now() - t0;
      appendLog({
        ts: new Date().toISOString(), tool: name, status: 'ok',
        dtMs: dt, resultType: result.resultType, nSol: result.solutionCount,
        truncated: result.truncated
      });
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } });
    } catch (e) {
      const dt = Date.now() - t0;
      const errObj = (e && e.type) ? e : { type: 'internal_error', message: (e && e.message) || String(e) };
      appendLog({
        ts: new Date().toISOString(), tool: name, status: 'error',
        dtMs: dt, errorType: errObj.type
      });
      // 工具级错误：返回 isError=true 的工具结果（而非 JSON-RPC error 帧），
      // 让接入的 LLM 能读到结构化错误并自我纠正，而不是收到一个异常。
      send({
        jsonrpc: '2.0', id,
        result: { content: [{ type: 'text', text: JSON.stringify(errObj, null, 2) }], isError: true }
      });
    }
    return;
  }
  // 其他方法：忽略（含通知，无 id 不回包）
}

function pump() {
  let nl;
  while ((nl = lineBuf.indexOf('\n')) !== -1) {
    const line = lineBuf.slice(0, nl).replace(/\r$/, '');
    lineBuf = lineBuf.slice(nl + 1);
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg && msg.jsonrpc === '2.0') handle(msg);
    } catch (_e) { /* 畸形行忽略 */ }
  }
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  lineBuf += chunk;
  pump();
});
// 不强制 process.exit，避免最后一个响应帧被截断丢失
process.stdin.on('end', () => {});

// 启动日志（仅元数据）
appendLog({ ts: new Date().toISOString(), event: 'server_start', name: SERVER_NAME, version: SERVER_VERSION });
