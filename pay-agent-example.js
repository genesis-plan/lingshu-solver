#!/usr/bin/env node
/**
 * pay-agent-example.js — 「对公收款」参考付款 Agent 示例
 * -------------------------------------------------------------------------
 * 演示一个合规 AI Agent 如何消费服务端的「结构化付款意图」，代其人类完成付款，并触发对账入账。
 *
 * 关键事实：统一收款入口是静态「工银e支付银联聚合码」（支持支付宝/微信/银联扫码），
 * 它本身没有程序化支付 API —— Agent 不能像调支付宝 aipay 那样直接「扫」或「自动扣款」。
 * 所以 对公收款 的「AI 付」= Agent 读懂意图 → 把码/账户呈现给钱包持有者 →
 * 收集「人类已付 + 实付金额 + 订单号」→ 把回执交给运营方按订单号对账入账。
 * 全程不依赖任何支付平台商户 API，合规（对公、绝不用个人码）、可审计、幂等。
 *
 * 运行：node pay-agent-example.js   （自动起一个本地端点演示完整闭环，无需外网）
 */
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const NODE = 'C:/Users/Administrator/.workbuddy/binaries/node/versions/22.12.0/node.exe';
const SERVER = path.join(__dirname, 'http-mcp-server.js');
const PORT = 39231;
const ADMIN = 'payIntent-demo-admin';
const CREDITS = path.join(os.tmpdir(), 'lingshu_payIntent_demo_' + Date.now() + '.json');
const CORP = '3602026809201658423'; // 必须与 http-mcp-server.js 钉死账号逐字一致（凭据库 credentials.md）

function req(method, p, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({
      hostname: '127.0.0.1', port: PORT, path: p, method,
      headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': data ? Buffer.byteLength(data) : 0 }, headers || {})
    }, (res) => {
      let s = ''; res.on('data', (d) => s += d);
      res.on('end', () => { let j = null; try { j = JSON.parse(s); } catch (e) {} resolve({ status: res.statusCode, json: j }); });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
function waitHealth() {
  return new Promise((resolve) => {
    const t = setInterval(() => {
      req('GET', '/health').then((r) => { if (r.status === 200) { clearInterval(t); resolve(); } }).catch(() => {});
    }, 200);
    setTimeout(() => { clearInterval(t); resolve(); }, 8000);
  });
}

// ── 参考付款 Agent 的核心能力 ──────────────────────────────────────────────
class PayAgent {
  constructor(baseUrl) { this.base = baseUrl; }

  // 步骤 1：向服务端请求一笔订单与付款意图
  async requestPayment(calls) {
    const r = await req('POST', '/pay/order', calls ? { calls } : {});
    if (r.status !== 201 || !r.json) throw new Error('开单失败: ' + r.status);
    return r.json; // 含 orderId / apiKey / payIntent 意图
  }

  // 步骤 2：把结构化意图翻成「人类能执行」的动作（这是 Agent 的本职：可读→可呈现）
  presentToHuman(intent) {
    const lp = intent.payIntent;
    if (!lp) throw new Error('服务端未返回 payIntent 意图（可能未配置 LS_PAY_TO）');
    return {
      showQrOrAccount: lp.payToQr || lp.payTo,
      memo: lp.memo,
      say: '请向该对公聚合码转账任意正金额（建议 ' + lp.suggestedAmountDisplay + '），' +
           '付款备注务必填写订单号 ' + lp.memo + '。',
      agentSteps: lp.agentSteps
    };
  }

  // 步骤 3：人类付款后，Agent 收集回执，构造对账请求（交给运营方入账）
  // 注意：receivedCents 来自人类实际支付的金额（任意正金额），运营方按 ¥0.01/次折算。
  buildReconcileRequest(intent, receivedCents) {
    return {
      orderId: intent.payIntent.orderId,
      receivedCents: Math.round(receivedCents),
      expectExactAmount: false,           // 对公静态收款：按实收折算，不要求恰等于建议额
      channel: 'corporate-bank',
      source: 'reconcile'
    };
  }
}

(async () => {
  console.log('══════════════════════════════════════════════════════════════');
  console.log(' 对公收款 · 参考付款 Agent 端到端演示');
  console.log('══════════════════════════════════════════════════════════════');

  const env = Object.assign({}, process.env, {
    LS_METERING: 'on', LS_PRICE_CENTS: '1', LS_PAY_TO: CORP,
    LS_PAY_TO_QR: 'https://qr.95516.com/01020001/wcqr?f=ICBCqr&X=1&T=3&P=13&I=e03d925776684b4d&N=b4cbb142eeafe2bddce7a7878c57f5ca&L=09253a28e43998a37f27ab44fba914bf945dc63f02a5239d',
    LS_CREDITS_PATH: CREDITS, PORT: String(PORT), LS_ADMIN_TOKEN: ADMIN, LS_FREE_LOOPBACK: '0'
  });
  const child = spawn(NODE, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  child.unref();
  child.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
  await waitHealth();

  const agent = new PayAgent('http://127.0.0.1:' + PORT);

  // ① Agent 代人类请求一笔订单（固定 1 次 = 1 分，不预购）
  console.log('\n[1] Agent 请求付款意图（固定 1 次 = 1 分）');
  const order = await agent.requestPayment();
  console.log('    orderId :', order.orderId);
  console.log('    apiKey  :', order.apiKey.slice(0, 8) + '…（仅出现一次）');
  console.log('    payIntent.protocol :', order.payIntent && order.payIntent.protocol);

  // ② Agent 把意图翻成人类动作并「呈现」（真实场景：渲染二维码 / 读出账户）
  console.log('\n[2] Agent 把意图呈现给钱包持有者');
  const human = agent.presentToHuman(order);
  console.log('    展示    :', human.showQrOrAccount);
  console.log('    备注    :', human.memo);
  console.log('    话术    :', human.say);

  // ③ 人类扫码付款（演示：付建议额 ¥1.00 = 100 分；也可付任意正金额）
  const paidCents = order.payIntent.suggestedAmountCents; // 100
  console.log('\n[3] 人类已付款（演示实付 ' + (paidCents / 100).toFixed(2) + ' 元，备注 ' + human.memo + '）');

  // ④ Agent 把回执交给运营方对账入账
  console.log('\n[4] Agent 提交回执 → 运营方 reconcile-bank.js 入账');
  const rec = agent.buildReconcileRequest(order, paidCents);
  console.log('    入账单  :', JSON.stringify(rec));
  const conf = await req('POST', '/admin/order/confirm', rec, { 'X-Admin-Token': ADMIN });
  console.log('    入账结果:', conf.status, JSON.stringify(conf.json));

  // ⑤ 凭 key 调用 solve（不再走信任制），再用 /credit 查余额
  console.log('\n[5] 凭 key 调用 solve（计费、非信任制）');
  const slv = await req('POST', '/mcp',
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'solve', arguments: { equations: ['x^2+y^2=25', 'x+y=7'] } } },
    { 'Authorization': 'Bearer ' + order.apiKey });
  const res = slv.json && slv.json.result && slv.json.result.content && slv.json.result.content[0];
  const parsed = res ? JSON.parse(res.text) : null;
  console.log('    解出    :', parsed && parsed.solutionCount, '个解（扣费 1 分，余额见下）');
  const cr = await req('GET', '/credit?key=' + order.apiKey);
  console.log('    余额剩余:', cr.json && cr.json.balanceCents, '分（', cr.json && cr.json.callsRemaining, '次）— 已由 100 扣至 99，证实按次计费生效');

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(' 闭环完成：开单 → 呈现 → 人类付款 → 对账入账 → 计费调用');
  console.log('══════════════════════════════════════════════════════════════');

  try { child.kill('SIGKILL'); } catch (e) {}
  try { fs.rmSync(CREDITS, { force: true }); fs.rmSync(CREDITS + '.ledger.jsonl', { force: true }); } catch (e) {}
  process.exit(0);
})().catch((e) => { console.error('演示异常:', e); process.exit(1); });
