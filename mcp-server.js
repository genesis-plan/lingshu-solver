#!/usr/bin/env node
const { shapeResult, doSolve, doPolyRoots, doVerify, MAX_TOTAL_CHARS, MAX_EQ_COUNT, MAX_VAR_COUNT } = require('./services/solver-service.js'); // 求解域共享层（2026-10-03：与 HTTP 端同口径）
const { buildTools } = require('./services/tool-metadata.js');   // 工具元数据共享层：与 HTTP 端同一份描述，杜绝文案分叉
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
const SERVER_VERSION = '1.0.22';


// ---- 护栏常量（防畸形/恶意输入耗尽资源）----

// ---- 本地日志（仅元数据，零数据不外传）----
const LOG_PATH = path.resolve(__dirname, 'calls.log');
const FEEDBACK_PATH = path.resolve(__dirname, 'feedback.log');
function appendLog(p) {
  try {
    fs.appendFileSync(LOG_PATH, JSON.stringify(p) + '\n');
  } catch (_e) { /* 日志失败不影响服务 */ }
}


// ---- 工具定义 ----
// 工具元数据来自 services/tool-metadata.js —— 与 HTTP 端共用一份，杜绝文案分叉
// （曾出现 stdio 端压了 description 而 HTTP 端没跟上的分叉，代码测试发现不了）
const TOOLS = buildTools({});

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
