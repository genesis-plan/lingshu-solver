#!/usr/bin/env node
/**
 * pay-agent-example.js — 「对公收款」参考付款 Agent 示例（零人工闭环版）
 * -------------------------------------------------------------------------
 * 演示一个合规 AI Agent 如何消费服务端的「结构化付款意图」、代其人类完成付款，
 * 并**自助入账**（不需要运营方跑任何脚本、不需要任何人确认）。
 *
 * 关键事实：统一收款入口是静态「工银e支付银联聚合码」（支持支付宝/微信/银联扫码），
 * 它本身没有程序化支付 API —— Agent 不能像调支付宝 aipay 那样直接「扫」或「自动扣款」。
 * 所以「AI 付」= Agent 读懂意图 → 把码/账户呈现给钱包持有者 → 人类扫码付款 →
 * Agent 回服务端**声明本单已付**（selfReportPaid:true）→ 立即入账、立即放行。
 *
 * 为什么敢不验证（信任制）：同一道门的 solve honorPaid:true 本来就免费，
 * 所以「声明已付」不会多出任何损失，只是让诚实付款的人不必等对账。
 * 账本会把这类额度标注 amountVerified:false / creditedBy:self_report，
 * 真营收仍以银行流水核对为准 —— 数字不虚报。
 *
 * 运行：node pay-agent-example.js   （自动起一个本地端点演示完整闭环，无需外网）
 */
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const NODE = process.execPath;
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
      res.on('end', () => { let j = null; try { j = JSON.parse(s); } catch (e) {} resolve({ status: res.statusCode, json: j, raw: s }); });
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
function mcp(name, args, key) {
  return req('POST', '/mcp',
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: name, arguments: args || {} } },
    key ? { Authorization: 'Bearer ' + key } : undefined
  ).then((r) => {
    const c = r.json && r.json.result && r.json.result.content && r.json.result.content[0];
    let payload = null;
    try { payload = c ? JSON.parse(c.text) : null; } catch (e) { payload = null; }
    return { status: r.status, payload: payload, raw: r.raw };
  });
}

// ── 参考付款 Agent 的核心能力 ──────────────────────────────────────────────
class PayAgent {
  constructor(baseUrl) { this.base = baseUrl; }

  // 步骤 1：向服务端请求一笔订单与付款意图
  async requestPayment() {
    const r = await req('POST', '/pay/order', {});
    if (r.status !== 201 || !r.json) throw new Error('开单失败: ' + r.status + ' ' + r.raw);
    return r.json; // 含 orderId / apiKey / payIntent / selfCredit
  }

  // 步骤 2：把结构化意图翻成「人类能执行」的动作（Agent 的本职：可读 → 可呈现）
  presentToHuman(order) {
    const lp = order.payIntent;
    if (!lp) throw new Error('服务端未返回 payIntent 意图（可能未配置 LS_PAY_TO）');
    return {
      showQrOrAccount: lp.payToQr || lp.payTo,
      memo: lp.memo,
      say: '请向该对公聚合码付款（建议 ' + lp.suggestedAmountDisplay + ' ≈ ' + lp.suggestedCalls + ' 次）；' +
           '备注建议含订单号 ' + lp.memo + '（便于需要时与银行流水交叉核对）。'
    };
  }

  // 步骤 3：人类付款后，Agent 自助入账 —— 这是零人工闭环的关键一步。
  // 注意：入参只需订单号 + 声明；金额由服务端按订单面值算，Agent 不必猜/不必传。
  async selfCredit(orderId) {
    const r = await mcp('pay', { orderId: orderId, selfReportPaid: true });
    if (r.payload && r.payload.type) throw new Error('自助入账失败: ' + r.payload.type + ' — ' + (r.payload.message || ''));
    return r.payload;
  }

  // 可选：把人类实付额作为「备注」交给运营方做流水交叉核对（核实营收用，非必需流程）。
  buildReconcileNote(order, paidCents) {
    return {
      orderId: order.payIntent.orderId,
      receivedCents: Math.round(paidCents),
      expectExactAmount: false,     // 对公静态收款：按实收折算，不要求恰等于建议额
      channel: 'corporate-bank',
      source: 'reconcile'
    };
  }
}

(async () => {
  console.log('══════════════════════════════════════════════════════════════');
  console.log(' 对公收款 · 参考付款 Agent 端到端演示（零人工闭环）');
  console.log('══════════════════════════════════════════════════════════════');

  const env = Object.assign({}, process.env, {
    LS_METERING: 'on', LS_PRICE_CENTS: '1', LS_PAY_TO: CORP,
    LS_PAY_TO_QR: 'https://qr.95516.com/01020001/wcqr?f=ICBCqr&X=1&T=3&P=13&I=e03d925776684b4d&N=b4cbb142eeafe2bddce7a7878c57f5ca&L=09253a28e43998a37f27ab44fba914bf945dc63f02a5239d',
    LS_CREDITS_PATH: CREDITS, PORT: String(PORT), LS_ADMIN_TOKEN: ADMIN, LS_FREE_LOOPBACK: '0'
  });
  const child = spawn(NODE, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
  await waitHealth();

  const agent = new PayAgent('http://127.0.0.1:' + PORT);
  let failed = 0;
  const check = (name, cond, extra) => {
    console.log((cond ? '  ✅ ' : '  ❌ ') + name + (cond || extra === undefined ? '' : '   → ' + JSON.stringify(extra)));
    if (!cond) failed++;
  };

  // ① Agent 代人类请求一笔订单（固定 1 次 = 1 分，不预购、无套餐）
  console.log('\n[1] Agent 请求付款意图（固定 1 次 = 1 分）');
  const order = await agent.requestPayment();
  console.log('    orderId :', order.orderId);
  console.log('    apiKey  :', order.apiKey.slice(0, 8) + '…（仅出现一次）');
  console.log('    protocol:', order.payIntent && order.payIntent.protocol);
  check('订单固定 calls=1 / amountCents=1', order.calls === 1 && order.amountCents === 1, { calls: order.calls, amountCents: order.amountCents });
  check('响应即带自助入账指引 selfCredit', !!(order.selfCredit && /selfReportPaid/.test(JSON.stringify(order.selfCredit))));

  // ② Agent 把意图翻成人类动作并「呈现」（真实场景：渲染二维码 / 读出账户）
  console.log('\n[2] Agent 把意图呈现给钱包持有者');
  const human = agent.presentToHuman(order);
  console.log('    展示    :', human.showQrOrAccount);
  console.log('    备注    :', human.memo);
  console.log('    话术    :', human.say);

  // ③ 人类扫码付款（演示：按建议额付 1 分；人类也可自愿多付，属支持性质）
  const paidCents = order.payIntent.suggestedAmountCents;
  console.log('\n[3] 人类已付款（演示实付 ' + (paidCents / 100).toFixed(2) + ' 元，备注 ' + human.memo + '）');

  // ④ ★ Agent 自助入账：不需要运营方做任何事
  console.log('\n[4] ★ Agent 自助入账（selfReportPaid:true）— 运营方零参与');
  const credited = await agent.selfCredit(order.orderId);
  console.log('    status  :', credited.status, '| verified:', credited.verified, '| 入账:', credited.creditedCents, '分（', credited.creditedCalls, '次）');
  check('自助入账 = credited', credited.status === 'credited', credited.status);
  check('诚实标注 verified:false', credited.verified === false, credited.verified);

  // ⑤ 凭 key 调用 solve（不再走信任制），再用 /credit 查余额
  console.log('\n[5] 凭 key 调用 solve（计费、非信任制）');
  const slv = await mcp('solve', { equations: ['x^2+y^2=25', 'x+y=7'] }, order.apiKey);
  console.log('    解出    :', slv.payload && slv.payload.solutionCount, '个解');
  check('入账后的 key 立即能求解', !!(slv.payload && slv.payload.solutionCount >= 1), slv.payload && slv.payload.type);
  const cr = await req('GET', '/credit?key=' + order.apiKey);
  console.log('    余额剩余:', cr.json && cr.json.balanceCents, '分（', cr.json && cr.json.callsRemaining, '次）— 1 分已扣至 0，证实按次计费生效');
  check('余额由 1 分扣至 0', !!(cr.json && cr.json.balanceCents === 0), cr.json && cr.json.balanceCents);

  // ⑥ 对账分栏：真营收 vs 凭声明的额度（数字不虚报）
  console.log('\n[6] 台账分栏（凭声明的额度 ≠ 已核实营收）');
  const lg = await req('GET', '/admin/ledger', null, { 'X-Admin-Token': ADMIN });
  const s = lg.json && lg.json.summary;
  console.log('    verifiedRevenueCents:', s && s.verifiedRevenueCents, '| selfReportedCents:', s && s.selfReportedCents, '| honorClaims:', s && s.honorClaims);
  check('自助入账被单独计数，不计入已核实营收', !!(s && s.selfReportedCents === 1 && s.verifiedRevenueCents === 0), s);

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(failed === 0
    ? ' 闭环完成：开单 → 呈现 → 人类付款 → 自助入账 → 计费调用（全程零人工）'
    : ' ❌ 演示失败 ' + failed + ' 项');
  console.log('══════════════════════════════════════════════════════════════');

  try { child.kill('SIGKILL'); } catch (e) {}
  try { fs.rmSync(CREDITS, { force: true }); fs.rmSync(CREDITS + '.ledger.jsonl', { force: true }); } catch (e) {}
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error('演示异常:', e && e.message || e); process.exit(1); });
