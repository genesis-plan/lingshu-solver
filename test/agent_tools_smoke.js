#!/usr/bin/env node
/**
 * test/agent_tools_smoke.js — 验证 1.0.15 新增的 agent 适配工具 poly_roots / verify 端到端可用。
 * 启动托管端点（metering=off，免费免 key），逐项断言后退出。
 */
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const NODE = process.execPath;
const SERVER = path.join(__dirname, '..', 'http-mcp-server.js');
const ADMIN = 'testadmin';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + JSON.stringify(extra) : '')); }
}

function req(port, method, p, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ hostname: '127.0.0.1', port, path: p, method, headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': data ? Buffer.byteLength(data) : 0 }, headers || {}) }, (res) => {
      let s = ''; res.on('data', d => s += d); res.on('end', () => { let j = null; try { j = JSON.parse(s); } catch (e) {} resolve({ status: res.statusCode, json: j, raw: s }); });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
function waitHealth(port) {
  return new Promise((resolve) => {
    const t = setInterval(() => {
      req(port, 'GET', '/health').then((r) => { if (r.status === 200) { clearInterval(t); resolve(); } }).catch(() => {});
    }, 200);
    setTimeout(() => { clearInterval(t); resolve(); }, 8000);
  });
}
function mcp(port, tool, args, key) {
  return req(port, 'POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args || {} } },
    key ? { 'Authorization': 'Bearer ' + key } : {}).then((r) => {
      const res = r.json && r.json.result;
      const isError = !!(res && res.isError);
      const c = res && res.content && res.content[0];
      const payload = c ? JSON.parse(c.text) : r.json;
      return { isError, payload, raw: r.json };
    });
}
function spawnServer(port) {
  const credits = path.join(os.tmpdir(), 'lingshu_agent_tools_' + port + '_' + Date.now() + '.json');
  const env = Object.assign({}, process.env, {
    LS_METERING: 'off', LS_PRICE_CENTS: '1',
    LS_CREDITS_PATH: credits, PORT: String(port), LS_ADMIN_TOKEN: ADMIN, LS_FREE_LOOPBACK: '0'
  });
  const child = spawn(NODE, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  child.unref();
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => process.stderr.write('[server:' + port + '] ' + d));
  return { child, credits };
}

(async () => {
  const PORT = 39231;
  const { child } = spawnServer(PORT);
  await waitHealth(PORT);

  // 1) poly_roots：x³−2x²−5x+6 = (x-3)(x-1)(x+2) → 实根 3, 1, -2，全部 Krawczyk 认证
  //
  // ⚠⚠ 2026-10-04 改为**走 Agent 的真实路径**（分页取全），原来只查单次返回。
  //   改的原因不是断言变松了，是原断言在钉一个 P0：单次只返回 AGENT_MAX_SOLUTIONS=2 个，
  //   而 poly_roots 的工具描述承诺 "All real roots" ⇒ 3 根只给 2 个且无法取回第 3 个，
  //   是一个**无法完成的契约**。
  //   现在产品给了 nextOffset + n 入参，Agent 必须能自己翻页拿全 ——
  //   这条断言就是守住「Agent 走完这条路能拿到全部 3 个根」这个**端到端**事实。
  const pr = await mcp(PORT, 'poly_roots', { coefficients: [1, -2, -5, 6] });
  ok('poly_roots 返回 3 个解', pr.payload && pr.payload.solutionCount === 3, pr.payload && pr.payload.solutionCount);
  ok('poly_roots 全部 proven（certified=true）', pr.payload && pr.payload.certified === true, pr.payload && pr.payload.certified);
  {
    // 模拟 Agent：按 nextOffset 翻页直到取完
    const got = [];
    let page = pr.payload, hops = 0, converged = true;
    while (page && hops < 10) {
      if (Array.isArray(page.solutions)) got.push(...page.solutions.map(s => s.values[0]));
      if (page.nextOffset === undefined || page.nextOffset === null) break;
      const np = await mcp(PORT, 'poly_roots', { coefficients: [1, -2, -5, 6], n: page.nextOffset });
      if (!np.payload || !Array.isArray(np.payload.solutions)) { converged = false; break; }
      if (np.payload.nextOffset !== undefined && np.payload.nextOffset <= page.nextOffset) { converged = false; break; }
      page = np.payload; hops++;
    }
    if (page && page.nextOffset !== undefined && page.nextOffset !== null) converged = false;
    const vals = got.map(v => Number(v.toFixed(6))).sort((a, b) => a - b);
    ok('poly_roots 分页取全 -2, 1, 3（Agent 走 nextOffset 能拿全，契约可完成）',
      JSON.stringify(vals) === JSON.stringify([-2, 1, 3]), vals);
    ok('poly_roots 分页收敛（nextOffset 严格递增，不死循环）', converged, { hops });
  }

  // 2) verify：x²=4，候选 2 是根 → verified
  const v2 = await mcp(PORT, 'verify', { equation: 'x^2 = 4', candidate: 2 });
  ok('verify(2) 判定 verified', v2.payload && v2.payload.verdict === 'verified', v2.payload && v2.payload.verdict);

  // 3) verify：x²=4，候选 2.1 不是根 → refuted，并附最近认证根
  const v21 = await mcp(PORT, 'verify', { equation: 'x^2 = 4', candidate: 2.1 });
  ok('verify(2.1) 判定 refuted_or_unverified', v21.payload && v21.payload.verdict === 'refuted_or_unverified', v21.payload && v21.payload.verdict);
  ok('verify(2.1) 附 nearestCertifiedRoot', !!(v21.payload && v21.payload.nearestCertifiedRoot), v21.payload && v21.payload.nearestCertifiedRoot);

  // 4) verify 多变量：x+y=7, x-y=1 → 真解 (4,3)；候选 {x:4,y:3} 应 verified
  const vm = await mcp(PORT, 'verify', { equation: 'x + y = 7', candidate: { x: 4, y: 3 }, variables: ['x', 'y'] });
  // 注意：单方程两变量有无穷解，候选 (4,3) 满足 → 在邻域内应能找到匹配认证根
  ok('verify({x:4,y:3}) 返回 verdict 字段', vm.payload && typeof vm.payload.verdict === 'string', vm.payload && vm.payload.verdict);

  // 5) 异常输入：coefficients 长度 < 2 → isError
  const bad = await mcp(PORT, 'poly_roots', { coefficients: [1] });
  ok('poly_roots 畸形系数 → isError', bad.isError === true, bad.payload);

  // 6) 异常输入：equation 无 = → isError
  const badv = await mcp(PORT, 'verify', { equation: 'not an equation', candidate: 1 });
  ok('verify 无等号方程 → isError', badv.isError === true, badv.payload);

  // 7) tools/list 包含两个新工具
  const tl = await req(PORT, 'POST', '/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const names = (tl.json && tl.json.result && tl.json.result.tools || []).map(t => t.name).sort();
  ok('tools/list 含 poly_roots', names.includes('poly_roots'), names);
  ok('tools/list 含 verify', names.includes('verify'), names);

  child.kill('SIGKILL');
  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
