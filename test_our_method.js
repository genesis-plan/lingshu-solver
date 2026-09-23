#!/usr/bin/env node
/**
 * test_our_method.js — 灵付 LingPay（对公静态收款 + 银行流水对账 + 收款账号防替换护栏）冒烟测试
 * 启动托管端点（metering=on，对公收款配真实钉死账号），逐项断言后退出。
 */
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const NODE = 'C:/Users/Administrator/.workbuddy/binaries/node/versions/22.12.0/node.exe';
const SERVER = 'C:/Users/Administrator/Desktop/灵数求解器/http-mcp-server.js';
const RECON = 'C:/Users/Administrator/Desktop/灵数求解器/reconcile-bank.js';
const ADMIN = 'testadmin';

// 与生产一致的钉死值（凭据库 credentials.md，2026-09-22）
const REAL_ACCOUNT = '3602026809201658423';
const REAL_QR = 'https://qr.95516.com/01020001/wcqr?f=ICBCqr&X=1&T=3&P=13&I=e03d925776684b4d&N=b4cbb142eeafe2bddce7a7878c57f5ca&L=09253a28e43998a37f27ab44fba914bf945dc63f02a5239d';
const WRONG_ACCOUNT = '6225880000000000'; // 攻击者可能塞进来的假账号

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
      const c = r.json && r.json.result && r.json.result.content && r.json.result.content[0];
      return c ? JSON.parse(c.text) : r.json;
    });
}
function spawnServer(port, payTo, payToQr) {
  const credits = path.join(os.tmpdir(), 'lingshu_test_credits_' + port + '_' + Date.now() + '.json');
  const env = Object.assign({}, process.env, {
    LS_METERING: 'on', LS_PRICE_CENTS: '1', LS_PAY_TO: payTo, LS_PAY_TO_QR: payToQr || '',
    LS_CREDITS_PATH: credits, PORT: String(port), LS_ADMIN_TOKEN: ADMIN, LS_FREE_LOOPBACK: '0'
  });
  const child = spawn(NODE, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  child.unref();
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => process.stderr.write('[server:' + port + '] ' + d));
  return { child, credits };
}

(async () => {
  // ============ 主路径：真实钉死账号 ============
  const PORT = 39221;
  const srv = spawnServer(PORT, REAL_ACCOUNT, REAL_QR);
  await waitHealth(PORT);

  // 1. /health 计费状态 + 账号已验证
  const h = await req(PORT, 'GET', '/health');
  ok('health: metering=on', h.json && h.json.metering === 'on');
  ok('health: autoCredit=false（无平台回调）', h.json && h.json.autoCredit === false);
  ok('health: receiptTampered=false（账号已验证）', h.json && h.json.receiptTampered === undefined, h.json && h.json.receiptTampered);
  ok('health: receiptVerified=true', h.json && h.json.receiptVerified === true);
  ok('health: honorClaims=0 初始', h.json && h.json.honorClaims === 0);

  // 2. 对公开单：可付、返回对公入口
  const o = await req(PORT, 'POST', '/pay/order', {});
  const orderId = o.json && o.json.orderId;
  const apiKey = o.json && o.json.apiKey;
  ok('开单返回订单号 LS-...', !!orderId && /^LS-\d{8}-[0-9a-f]{6}$/.test(orderId), orderId);
  ok('开单返回 apiKey', !!apiKey);
  ok('payable=true（对公已配且账号已验证）', o.json && o.json.payable === true, o.json && o.json.payable);
  ok('payment.configured=true', o.json && o.json.payment && o.json.payment.configured === true);
  ok('payment.method=corporate-static', o.json && o.json.payment && o.json.payment.method === 'corporate-static');
  ok('payment.payTo=钉死账号', o.json && o.json.payment && o.json.payment.payTo === REAL_ACCOUNT, o.json && o.json.payment);
  ok('payment.payToName=公司名', o.json && o.json.payment && o.json.payment.payToName === '广州市红尘灵境数字科技有限公司');
  ok('payment.payToQr=银联官方码址', o.json && o.json.payment && o.json.payment.payToQr === REAL_QR);
  ok('payment.receiptVerified=true', o.json && o.json.payment && o.json.payment.receiptVerified === true);
  ok('payment.rateNote 说明折算', o.json && o.json.payment && /折算/.test(o.json.payment.rateNote || ''));

  // 2b. 灵付 LingPay：开单响应含结构化付款意图
  ok('lingpay 意图存在', o.json && !!o.json.lingpay, o.json && o.json.lingpay);
  ok('lingpay.protocol=LingPay/1.0 (corporate-static)', o.json && o.json.lingpay && o.json.lingpay.protocol === 'LingPay/1.0 (corporate-static)', o.json && o.json.lingpay && o.json.lingpay.protocol);
  ok('lingpay.memo=订单号', o.json && o.json.lingpay && o.json.lingpay.memo === orderId, o.json && o.json.lingpay);
  ok('lingpay.payToQr=银联官方码址', o.json && o.json.lingpay && o.json.lingpay.payToQr === REAL_QR);
  ok('lingpay.agentSteps 为数组', o.json && o.json.lingpay && Array.isArray(o.json.lingpay.agentSteps) && o.json.lingpay.agentSteps.length >= 3);
  ok('lingpay.suggestedCalls 默认 1（固定单价、不预充）', o.json && o.json.lingpay && o.json.lingpay.suggestedCalls === 1, o.json && o.json.lingpay);
  ok('lingpay.suggestedAmountDisplay=¥0.01', o.json && o.json.lingpay && o.json.lingpay.suggestedAmountDisplay === '¥0.01', o.json && o.json.lingpay);

  // 2c. 定价铁律：固定 1 分/次、不预充 —— 任何 prebuy（calls≠1）一律拒
  const o50 = await req(PORT, 'POST', '/pay/order', { calls: 50 });
  ok('calls=50 被拒 400 fixed_price（不预充）', o50.status === 400 && o50.json && o50.json.error && o50.json.error.type === 'fixed_price', o50.status);
  const o0 = await req(PORT, 'POST', '/pay/order', { calls: 0 });
  ok('calls=0 被拒 400 fixed_price', o0.status === 400 && o0.json && o0.json.error && o0.json.error.type === 'fixed_price', o0.status);

  // 3. 信任制：无 key 也能 solve
  const hs = await mcp(PORT, 'solve', { equations: ['x^2=4'], honorPaid: true });
  ok('honorPaid solve 成功出解', hs && hs.resultType !== undefined && hs.solutionCount >= 1);
  ok('无双重 ¥ 符号', !(JSON.stringify(hs).includes('¥¥')));

  // 4. 银行流水对账：按实收 500 分折算入账 500 次
  const conf = await req(PORT, 'POST', '/admin/order/confirm', { orderId, receivedCents: 500, expectExactAmount: false, channel: 'corporate-bank', source: 'reconcile' },
    { 'X-Admin-Token': ADMIN });
  ok('对账入账 http=200', conf.status === 200, conf.status);
  ok('creditedCents=500（按实收折算）', conf.json && conf.json.creditedCents === 500, conf.json);
  ok('callsRemaining=500', conf.json && conf.json.callsRemaining === 500, conf.json);

  // 5. 凭 key 查询余额
  const cr = await req(PORT, 'GET', '/credit?key=' + apiKey);
  ok('credit 余额=500分', cr.json && cr.json.balanceCents === 500, cr.json);
  ok('credit 调用余=500次', cr.json && cr.json.callsRemaining === 500, cr.json);

  // 6. 幂等：再对账同笔订单不重复加
  const conf2 = await req(PORT, 'POST', '/admin/order/confirm', { orderId, receivedCents: 500, expectExactAmount: false, channel: 'corporate-bank', source: 'reconcile' },
    { 'X-Admin-Token': ADMIN });
  ok('幂等：alreadyPaid=true', conf2.json && conf2.json.alreadyPaid === true, conf2.json);
  const cr2 = await req(PORT, 'GET', '/credit?key=' + apiKey);
  ok('幂等后余额仍=500', cr2.json && cr2.json.balanceCents === 500, cr2.json);

  // 7. MCP `pay` 工具返回 lingpay 意图（固定 1 次）
  const mp = await mcp(PORT, 'pay', {});
  ok('MCP pay 返回 orderId', mp && /^LS-/.test(mp.orderId || ''), mp);
  ok('MCP pay 返回 lingpay 意图', mp && mp.lingpay && mp.lingpay.protocol === 'LingPay/1.0 (corporate-static)', mp && mp.lingpay);
  ok('MCP pay lingpay.suggestedCalls=1（固定单价）', mp && mp.lingpay && mp.lingpay.suggestedCalls === 1, mp && mp.lingpay);

  // 8. reconcile-bank.js 解析单测（注入 confirm，干跑）
  const { parseStatement } = require(RECON);
  const csv = '日期,摘要,收入\n2026-09-23,灵数求解 LS-20260923-deadbe,5.00\n2026-09-23,手续费,2.00\n2026-09-23,无订单号转账,10.00';
  const rows = parseStatement(csv);
  ok('解析命中带订单号行', rows.length === 1, rows);
  ok('订单号提取正确', rows[0] && rows[0].orderId === 'LS-20260923-deadbe', rows[0]);
  ok('金额折算 5.00元→500分', rows[0] && rows[0].amountCents === 500, rows[0]);

  // 收尾主服务器
  try { srv.child.kill('SIGKILL'); } catch (e) {}
  try { fs.rmSync(srv.credits, { force: true }); fs.rmSync(srv.credits + '.ledger.jsonl', { force: true }); } catch (e) {}

  // ============ 安全护栏：账号被篡改 → fail-closed ============
  const TP = 39222;
  const tsrv = spawnServer(TP, WRONG_ACCOUNT, '');
  await waitHealth(TP);
  const th = await req(TP, 'GET', '/health');
  ok('[安全] health.receiptTampered=true（账号被换）', th.json && th.json.receiptTampered === true, th.json);
  const to = await req(TP, 'POST', '/pay/order', {});
  ok('[安全] 篡改账号下开单 payable=false', to.json && to.json.payable === false, to.json && to.json.payable);
  ok('[安全] payment.tampered=true', to.json && to.json.payment && to.json.payment.tampered === true, to.json && to.json.payment);
  ok('[安全] payment.securityAlert 存在', to.json && to.json.payment && !!to.json.payment.securityAlert, to.json && to.json.payment);
  ok('[安全] payment.payTo 不暴露错误账号', to.json && to.json.payment && to.json.payment.payTo !== WRONG_ACCOUNT, to.json && to.json.payment);
  try { tsrv.child.kill('SIGKILL'); } catch (e) {}
  try { fs.rmSync(tsrv.credits, { force: true }); fs.rmSync(tsrv.credits + '.ledger.jsonl', { force: true }); } catch (e) {}

  // 汇总
  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常:', e); process.exit(1); });
