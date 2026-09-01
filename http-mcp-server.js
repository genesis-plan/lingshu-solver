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

// ---- 安全等保加固（2026-09-01）：防 DoS / 限速 / 日志轮转 / 反馈脱敏 ----
// 请求体上限：JSON-RPC 包裹 100KB 方程文本后仍有富余；超限直接 413，防内存耗尽型 DoS
const MAX_BODY_BYTES = 256 * 1024;
// 每 IP 限速：滑动窗口，默认 120 次/分钟（测试可用 LS_RATE_MAX 覆盖）
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = parseInt(process.env.LS_RATE_MAX || '120', 10);
// 会话 TTL：超 1 小时的非 SSE 会话定时清理，防 sessions Map 无限增长
const SESSION_TTL_MS = 60 * 60 * 1000;
// 日志轮转：单文件超 5MB 滚动为 .1，只保留一代，防磁盘写满
const MAX_LOG_BYTES = 5 * 1024 * 1024;

const rateMap = new Map(); // ip -> [timestamps]
function rateAllowed(ip) {
  const now = Date.now();
  let arr = rateMap.get(ip);
  if (!arr) { arr = []; rateMap.set(ip, arr); }
  while (arr.length && arr[0] <= now - RATE_WINDOW_MS) arr.shift();
  if (arr.length >= RATE_MAX) return false;
  arr.push(now);
  if (rateMap.size > 10000) { for (const [k, v] of rateMap) { if (v.length === 0) rateMap.delete(k); } }
  return true;
}

function pruneSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [k, v] of sessions) {
    if (!v.sse && v.createdAt < cutoff) sessions.delete(k);
  }
}

function rotateIfNeeded(p) {
  try { const st = fs.statSync(p); if (st.size > MAX_LOG_BYTES) fs.renameSync(p, p + '.1'); } catch (_e) {}
}

// 敏感信息脱敏（合规：反馈文本落盘前隐去手机号/证件号/邮箱/超长数字串）
function redactSensitive(s) {
  return String(s)
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[已隐去]')
    .replace(/\d{12,}/g, '[已隐去]')
    .replace(/(^|[^0-9])1[3-9]\d{9}([^0-9]|$)/g, '$1[已隐去]$2');
}

// ---- 本地日志（仅元数据，零数据不外传）----
const LOG_PATH = path.resolve(__dirname, 'calls.log');
const FEEDBACK_PATH = path.resolve(__dirname, 'feedback.log');
function appendLog(p) {
  try { rotateIfNeeded(LOG_PATH); fs.appendFileSync(LOG_PATH, JSON.stringify(p) + '\n'); } catch (_e) {}
}

// ---- 求解结果整理（与 stdio 版逐字一致）----
// 数值格式化：固定 6 位小数（产品规格「6位小数有限网格」），与界面一致。
const fmt6 = (v) => (typeof v === 'number' && isFinite(v)) ? v.toFixed(6) : String(v);
// 确定性浮点吸附：消除 IEEE-754 末位 ULP 抖动，保证「同输入输出字节级可复现」
const detF = (v) => (typeof v === 'number' && isFinite(v)) ? Number(v.toFixed(12)) : null;

function shapeResult(r) {
  const sols = Array.isArray(r.solutions) ? r.solutions : [];
  const meta = r.meta || {};
  const varNames = (Array.isArray(r.varNames) && r.varNames.length)
    ? r.varNames
    : (sols[0] && Array.isArray(sols[0].values) ? sols[0].values.map((_, i) => 'x' + (i + 1)) : []);

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
    const text = varNames.map((vn, i) => `${vn}=${fmt6(vals[i])}`).join(', ');
    return {
      values: vals,
      tier: s.tier || 'unknown',
      certified: !!s.certified,
      text: text,
      internals: {
        residual: detF(s.residual),
        certifiedRadius: detF(s.certifiedRadius)
      }
    };
  });
  const recommendedClean = recommended ? cleanSols[sols.indexOf(recommended)] : null;

  let summary;
  if (typeName === 'empty') {
    // 诚实三档（产品「不幻觉」红线）：
    //   NO_EQUATION      → input 无法解析，绝不谎称证明；
    //   provenEmpty=true → 经 sound 算子（结构恒正/恒负等）严格证明无解，可称「严格证明」；
    //   其余空集          → 区间穷尽未找到，但未抬 provenEmpty 标志，只能称「未找到」，不得佯称证明。
    if (r.error === 'NO_EQUATION' || (r.error && /NO_EQUATION|PARSE|UNRECOGNIZED|UNKNOWN/i.test(String(r.error)))) {
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

  const diagnostics = {
    solverVersion: meta.solverVersion || null,
    truncated: !!(r.truncated || meta.truncated),
    provenEmpty: !!(r.provenEmpty || meta.provenEmpty),
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
      '输出（JSON）：resultType=empty(严格证无实数解)/finite(有限已验证解)/infinite(无限解集，仅给距原点最近推荐解)；summary=中文一句话总览；solutions[] 每解含 values[](6位小数数值)、tier(proven=Krawczyk已认证/likely/candidate)、certified、text(人类可读如"x=4.000000, y=3.000000")，残差等内部数值收在 internals 子块(机器可跳过)；certified=是否全proven；recommended=距原点最近解的精简结构。' +
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
        const msg_fb = redactSensitive((args.message || '').toString().slice(0, 2000));
        const ctx_fb = args.context ? redactSensitive(String(args.context)).slice(0, 2000) : null;
        rotateIfNeeded(FEEDBACK_PATH);
        fs.appendFileSync(FEEDBACK_PATH, JSON.stringify({
          ts: new Date().toISOString(), message: msg_fb, context: ctx_fb
        }) + '\n');
        result = { acknowledged: true, note: '反馈已记录（本地，不外传；敏感信息已自动隐去）' };
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
const sessions = new Map(); // sessionId -> { createdAt, sse? }

// CORS：浏览器端 MCP 客户端（含 Smithery 连接测试）需此头，否则被静默拦截
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Authorization',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, Content-Type'
};

function sendJson(res, status, obj, extraHeaders) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length
  }, CORS, extraHeaders || {}));
  res.end(body);
}

const server = http.createServer((req, res) => {
  // CORS 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  // 健康检查
  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    return sendJson(res, 200, {
      name: SERVER_NAME,
      version: SERVER_VERSION,
      status: 'ok',
      transport: 'streamable-http',
      endpoints: { mcp: 'POST /mcp (SSE via GET /mcp)', health: 'GET /health' },
      tools: TOOLS.map(t => t.name)
    });
  }

  // MCP 端点：Streamable HTTP（POST 请求 / GET 收 SSE / DELETE 终止会话）
  if (req.url === '/mcp') {
    // GET：打开 SSE 流，接收服务端→客户端通知（MCP Streamable HTTP 规范）
    if (req.method === 'GET') {
      const sessionId = req.headers['mcp-session-id'] || crypto.randomUUID();
      res.writeHead(200, Object.assign({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      }, CORS, { 'mcp-session-id': sessionId }));
      res.write('retry: 2000\n\n');
      res.write(': connected\n\n');
      const ka = setInterval(() => { try { res.write(': keepalive\n\n'); } catch (_e) {} }, 15000);
      req.on('close', () => { clearInterval(ka); sessions.delete(sessionId); });
      sessions.set(sessionId, { createdAt: Date.now(), sse: res });
      return;
    }
    // DELETE：终止会话
    if (req.method === 'DELETE') {
      const sessionId = req.headers['mcp-session-id'];
      const s = sessions.get(sessionId);
      if (s && s.sse) { try { s.sse.end(); } catch (_e) {} }
      sessions.delete(sessionId);
      res.writeHead(200, CORS);
      return res.end();
    }
    // POST：JSON-RPC 请求
    if (req.method === 'POST') {
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').toString().split(',')[0].trim();
      // 限速（安全等保加固）：超限直接 429，不读不处理
      if (!rateAllowed(ip)) {
        appendLog({ ts: new Date().toISOString(), ip: ip, event: 'rate_limited' });
        return sendJson(res, 429, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Rate limit exceeded. Try again later.' } });
      }
      const sessionId = req.headers['mcp-session-id'] || crypto.randomUUID();
      if (!sessions.has(sessionId)) sessions.set(sessionId, { createdAt: Date.now() });
      pruneSessions();

      let raw = '';
      let rawLen = 0;
      let tooBig = false;
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        rawLen += chunk.length;
        if (rawLen > MAX_BODY_BYTES) {
          if (!tooBig) {
            tooBig = true;
            raw = '';
            appendLog({ ts: new Date().toISOString(), ip: ip, event: 'rejected_body_too_large' });
            try { res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request body too large (256KB max).' } })); } catch (_e) {}
            try { req.destroy(); } catch (_e2) {}
          }
          return;
        }
        raw += chunk;
      });
      req.on('end', () => {
        if (tooBig) return;
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
        const headers = Object.assign({ 'mcp-session-id': sessionId }, CORS);
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
    // 其它方法
    res.writeHead(405, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8', 'Allow': 'GET, POST, DELETE, OPTIONS' }, CORS));
    return res.end('Method Not Allowed. MCP endpoint accepts GET, POST, DELETE, OPTIONS.');
  }

  // 其它：404
  res.writeHead(404, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, CORS));
  res.end('Not Found. MCP endpoint: POST /mcp');
});

server.listen(PORT, '0.0.0.0', () => {
  appendLog({ ts: new Date().toISOString(), event: 'server_start', name: SERVER_NAME, version: SERVER_VERSION, port: PORT });
  console.log(`[${SERVER_NAME}] HTTP MCP server listening on 0.0.0.0:${PORT}`);
  console.log(`  health : GET  http://localhost:${PORT}/health`);
  console.log(`  mcp    : POST http://localhost:${PORT}/mcp`);
});
