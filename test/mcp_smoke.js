'use strict';
/**
 * 灵数求解器 · MCP stdio 冒烟测试（零依赖）
 *
 * 目的：在 CI 里验证「AI 智能体经 MCP stdio 接入」这条主路径仍然可用
 *       —— 拉起 mcp-server.js 子进程，走真实 JSON-RPC：initialize → tools/list → tools/call solve。
 *
 * 零依赖约束：GitHub Actions 的 regression.yml 只做 checkout + setup-node，
 *              不执行 npm install，故本文件不得 require 任何第三方包（含 MCP SDK）。
 *
 * 运行：node test/mcp_smoke.js
 * 退出码：0 = 全部通过；1 = 有失败
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;
const TIMEOUT_MS = 60000;

let failed = 0;
function assert(cond, msg) {
  if (cond) console.log('  ✅', msg);
  else { console.log('  ❌', msg); failed++; }
}

const child = spawn(NODE, ['mcp-server.js'], { cwd: REPO_ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const pending = new Map();

child.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch (_) { continue; }
    if (msg && msg.id != null && pending.has(msg.id)) {
      const res = pending.get(msg.id);
      pending.delete(msg.id);
      res(msg);
    }
  }
});
child.stderr.on('data', (d) => process.stderr.write('[mcp-server] ' + d));

function send(obj) { child.stdin.write(JSON.stringify(obj) + '\n'); }
function request(obj, label) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pending.has(obj.id)) { pending.delete(obj.id); resolve({ __timeout: true, __label: label }); }
    }, TIMEOUT_MS);
    pending.set(obj.id, (m) => { clearTimeout(timer); resolve(m); });
    send(obj);
  });
}

(async () => {
  console.log('=== 灵数求解器 MCP stdio 冒烟测试 ===');

  // [1] initialize
  const init = await request({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mcp-smoke', version: '1.0.0' } }
  }, 'initialize');
  assert(!init.__timeout, 'initialize 未超时');
  assert(init && init.result && init.result.serverInfo, 'initialize 返回 serverInfo');
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  // [2] tools/list
  const list = await request({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, 'tools/list');
  const tools = (list && list.result && list.result.tools) || [];
  const names = tools.map((t) => t.name);
  assert(names.includes('solve'), 'tools/list 暴露 solve 工具');

  // [3] tools/call solve —— 圆与直线交点（确定性、有解析解）
  const call = await request({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'solve', arguments: { equations: ['x^2 + y^2 = 25', 'x + y = 7'], variables: ['x', 'y'] } }
  }, 'tools/call solve');
  assert(call && call.result && !call.result.isError, 'solve 未返回 isError');
  let payload = {};
  try { payload = JSON.parse(((call.result || {}).content || [{}])[0].text || '{}'); } catch (_) { /* 保持空对象 */ }
  assert(typeof payload.solutionCount === 'number', '返回 solutionCount');
  assert((payload.solutions || []).length >= 1, `解数 ≥ 1（实得 ${(payload.solutions || []).length}）`);
  assert((payload.solutions || []).every((s) => s.tier === 'proven' || s.tier === 'candidate'),
    '每个解都带 tier 标注（诚实分级）');

  // [4] 变量数超限 → 必须报错（fail-closed 边界）
  const bad = await request({
    jsonrpc: '2.0', id: 4, method: 'tools/call',
    params: {
      name: 'solve',
      arguments: { equations: ['v1=1', 'v2=1', 'v3=1', 'v4=1', 'v5=1', 'v6=1', 'v7=1'], variables: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7'] }
    }
  }, 'tools/call 超限');
  assert(bad && bad.result && bad.result.isError === true, '变量数 > 6 → isError=true（fail-closed）');

  child.kill();
  console.log(failed === 0 ? '\n=== 冒烟测试全部通过 ===' : `\n=== 冒烟测试失败 ${failed} 项 ===`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('冒烟测试异常：', e && e.message ? e.message : e);
  try { child.kill(); } catch (_) {}
  process.exit(1);
});
