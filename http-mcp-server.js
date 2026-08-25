#!/usr/bin/env node
/**
 * 灵数求解器 · MCP 远程服务端（HTTP / Streamable HTTP，零依赖）
 *
 * 设计目标：让求解器以「常驻公网服务」形态运行，满足 Smithery / 远程 AI 智能体
 * 对「运行中的服务器网址」的要求。与 mcp-server.js（stdio 版）共享同一套：
 *   - solver-core.js 求解核心（同源，零分叉）
 *   - TOOLS / shapeResult / doSolve 逻辑（复制保持一致，含中文「∈」UTF-8 处理）
 *
 * 协议：Streamable HTTP（MCP 2025-03-26 草案）
 *   - POST /mcp   收发 JSON-RPC 2.0（initialize / tools/list / tools/call）
 *   - GET  /      健康检查（返回服务元信息，便于浏览器/Smithery 探活）
 *   - GET  /health 同上，纯文本 OK
 *
 * 零依赖：仅用 Node 内置 http / fs / path / crypto，无需 npm install。
 *
 * 运行：
 *   PORT=3000 node http-mcp-server.js
 *   （LINGSHU_HTML 环境变量可重定向 index.html 位置，默认同目录）
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { solve } = require('./solver-core');

const SERVER_NAME = 'lingshu-solver';
const SERVER_VERSION = '4.1.0';
const PORT = parseInt(process.env.PORT || '3000', 10);

// ---- 护栏常量（防畸形/恶意输入耗尽资源，与 stdio 版一致）----
const MAX_TOTAL_CHARS = 100 * 1024;
const MAX_EQ_COUNT = 64;
const MAX_VAR_COUNT = 6;

// ---- 本地日志（仅元数据，零数据不外传）----
const LOG_PATH = path.resolve(__dirname, 'calls.log');
const FEEDBACK_PATH = path.resolve(__dirname, 'feedback.log');
function appendLog(p) {
  try { fs.appendFileSync(LOG_PATH, JSON.stringify(p) + '\n'); } catch (_e) {}
}

// ---- 求解结果整理（与 stdio 版逐字一致）----
function shapeResult(r) {
  const sols = Array.isArray(r.solutions) ? r.solutions : [];
  const meta = r.meta || {};
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
  return {
    resultType: r.resultType,
    resultTypeName: typeName,
    certified: allProven,
    truncated: !!(r.truncated || meta.truncated),
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
  const r = solve(eqs, vars, 6, domain, fastMode, opts);
  return shapeResult(r);
}

// ---- 工具定义（与 stdio 版一致）----
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

// ---- JSON-RPC 处理（与 stdio 版 handle 同构，改为返回对象）----
function handleRpc(msg, ip) {
  const id = msg.id;
  const method = msg.method;
  const params = msg.params || {};

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
      }
    };
  }
  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
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
        ts: new Date().toISOString(), ip: ip, tool: name, status: 'ok',
        dtMs: dt, resultType: result.resultType, nSol: result.solutionCount,
        truncated: result.truncated
      });
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } };
    } catch (e) {
      const dt = Date.now() - t0;
      const errObj = (e && e.type) ? e : { type: 'internal_error', message: (e && e.message) || String(e) };
      appendLog({
        ts: new Date().toISOString(), ip: ip, tool: name, status: 'error',
        dtMs: dt, errorType: errObj.type
      });
      return {
        jsonrpc: '2.0', id,
        result: { content: [{ type: 'text', text: JSON.stringify(errObj, null, 2) }], isError: true }
      };
    }
  }
  // 通知类（无 id）或其它方法：返回 null（HTTP 下以 202/空体处理）
  return null;
}

// ---- HTTP 服务 ----
const sessions = new Map(); // sessionId -> { createdAt }

function sendJson(res, status, obj, extraHeaders) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length
  }, extraHeaders || {}));
  res.end(body);
}

const server = http.createServer((req, res) => {
  // 健康检查
  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    return sendJson(res, 200, {
      name: SERVER_NAME,
      version: SERVER_VERSION,
      status: 'ok',
      transport: 'streamable-http',
      endpoints: { mcp: 'POST /mcp', health: 'GET /health' },
      tools: TOOLS.map(t => t.name)
    });
  }

  // MCP 端点：Streamable HTTP
  if (req.method === 'POST' && req.url === '/mcp') {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').toString().split(',')[0].trim();
    const sessionId = req.headers['mcp-session-id'] || crypto.randomUUID();
    if (!sessions.has(sessionId)) sessions.set(sessionId, { createdAt: Date.now() });

    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch (_e) {
        return sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      }
      // 批量请求支持
      const batch = Array.isArray(msg) ? msg : [msg];
      const responses = [];
      for (const m of batch) {
        if (m && m.jsonrpc === '2.0') {
          const r = handleRpc(m, ip);
          if (r !== null) responses.push(r);
        }
      }
      const headers = { 'mcp-session-id': sessionId };
      if (Array.isArray(msg)) {
        if (responses.length === 0) { res.writeHead(202, headers); return res.end(); }
        return sendJson(res, 200, responses, headers);
      } else {
        if (responses.length === 0) { res.writeHead(202, headers); return res.end(); }
        return sendJson(res, 200, responses[0], headers);
      }
    });
    return;
  }

  // MCP 端点仅接受 POST。GET（SSE 流）/ DELETE（会话终止）本服务不支持，
  // 按 MCP Streamable HTTP 规范返回 405（而非 404），避免真实客户端误报 onerror。
  if (req.url === '/mcp') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', 'Allow': 'POST' });
    return res.end('Method Not Allowed. MCP endpoint accepts POST only.');
  }

  // 其它：404
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found. MCP endpoint: POST /mcp');
});

server.listen(PORT, '0.0.0.0', () => {
  appendLog({ ts: new Date().toISOString(), event: 'server_start', name: SERVER_NAME, version: SERVER_VERSION, port: PORT });
  console.log(`[${SERVER_NAME}] HTTP MCP server listening on 0.0.0.0:${PORT}`);
  console.log(`  health : GET  http://localhost:${PORT}/health`);
  console.log(`  mcp    : POST http://localhost:${PORT}/mcp`);
});
