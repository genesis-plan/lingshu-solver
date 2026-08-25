#!/usr/bin/env node
/**
 * 灵数求解器 · MCP stdio 服务端（零依赖）
 *
 * 手工实现 JSON-RPC 2.0 + Content-Length 分帧（不依赖任何 MCP SDK）。
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
const SERVER_VERSION = '4.1.0';

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
function shapeResult(r) {
  const sols = Array.isArray(r.solutions) ? r.solutions : [];
  const meta = r.meta || {};
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
  return {
    resultType: r.resultType,
    resultTypeName: typeName,
    certified: allProven,
    truncated: !!(r.truncated || meta.truncated),
    // 输出精度固定 6 位小数（产品规格「6位小数有限网格」），与界面一致，不提供位数切换。
    // 解点 values 经 roundToGrid 吸附到 6 位网格，实际残差通常 ≤ 1e-9。
    precisionDecimals: 6,
    solutionCount: sols.length,
    recommended: recommended,
    solutions: sols,
    warnings: r.warnings || [],
    diagnostics: r.diagnostics || null
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

// ---- 工具定义 ----
const TOOLS = [
  {
    name: 'solve',
    description: '求解实数方程组的确定性数值引擎（非大模型，无随机、同输入输出可复现）。适用：需可验证、可复现的实数解（代数或 sin/cos/tan/log/exp/sqrt/abs 等常见超越函数），尤其给 AI Agent 当"不会胡说"的数学后端。' +
      '不适用：纯符号推导/闭式证明、微分方程初值问题、整数/必不等于等强制约束（暂不支持）。' +
      '输入：equations 为含 "=" 的方程字符串数组，如 ["x^2+y^2=25","x+y=7"]；variables 可选（不填自动识别，最多6个）；domain 可选（如 {"x":[-30,30]}），否则默认每变量 ±1e6。' +
      '硬限制：变量 ≤6；方程 1–64 条且数量须 ≥ 变量数；单次方程文本 ≤100KB；输出固定 6 位小数（不可切换）。' +
      '输出（JSON）：resultType=empty(严格证无实数解)/finite(有限已验证解)/infinite(无限解集，仅给距原点最近推荐解)；solutions[] 每解含 values[] 与 tier(proven=Krawczyk已认证/likely/candidate) 及 residual；certified=是否全proven；recommended=距原点最近解。' +
      'truncated=true：预算内未完成全局分支判定、未证明已穷尽——不等于一定漏解，多数情况全部真解已找到；极端病态下可能遗漏个别解，可缩 domain 或提高 budget 重试。' +
      '错误返回 error.type（invalid_input=输入不合法/超限，internal_error=内部异常）。遇卡点或认为结果有误，请调用 give_feedback（内容仅落本地日志，不外传）。相同输入永远返回完全相同结果，可安全缓存与重复调用。',
    inputSchema: {
      type: 'object',
      properties: {
        equations: {
          type: 'array', items: { type: 'string' },
          description: '方程字符串数组，如 ["x^2 + y^2 = 25", "x + y = 7"]。支持 + - * / ^ sqrt log sin cos tan exp abs，以及 in-text 域约束 "x ∈ [-30,30]"。'
        },
        variables: {
          type: 'array', items: { type: 'string' },
          description: '变量名数组（可选）。不填则由方程文本自动识别，顺序按出现。最多 6 个。'
        },
        domain: {
          type: 'object',
          description: '显式搜索域（可选）。形如 {"x":[-30,30],"y":[-30,30]}。对"有限解·部分"演示或快增长函数（exp/sinh）建议显式给定，否则默认 ±1e6 可能剪枝失效并触发 truncated。'
        },
        fastMode: { type: 'boolean', description: '快速模式（默认 false）' },
        options: { type: 'object', description: '高级选项（可选），如 {budget:500000, maxDepth:28}' }
      },
      required: ['equations']
    }
  },
  {
    name: 'give_feedback',
    description: 'AI 智能体在调用 solve 遇到卡点、错误、或认为结果有问题时，主动回报。' +
      '回报内容仅落本地 feedback.log，不会外传。帮助作者持续改进。',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: '反馈内容：遇到了什么、期望什么、实际得到什么。' },
        context: { type: 'string', description: '可选上下文：触发场景、输入特征等。' }
      },
      required: ['message']
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
