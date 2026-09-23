#!/usr/bin/env node
/**
 * 灵数托管端点 · 上线前闸门（pre-deploy gate）
 *
 * 与 metering_regression.js 的分工：
 *   - metering_regression：功能正确性（下单/入账/扣费/余额/并发…），用「理想化」env。
 *   - 本闸门：**用生产真实 env** 验证两件最怕出事的东西：
 *       (1) 收款去向护栏在线上真实配置下**不误报**（否则会 fail-closed 拒收，钱一分收不到）；
 *       (2) 配置真被换掉时**一定报**、且只拒收款、不拒服务（「不能收就算了」）。
 *     另外验证「不付钱也能用」的免费路径在生产 env 下确实走得通。
 *
 * 生产真实配置（取自 /opt/lingshu/metering.env）：
 *   LS_PAY_TO  = 一句给人看的说明文字（含付款页链接，不含账号数字）
 *   LS_PAY_TO_QR = 未设置
 *   LS_PAY_PAGE  = https://hongchenlingjing.com/pay/
 *   LS_PAY_CHANNEL = manual
 *
 * 运行：node test/predeploy_gate.js
 * 退出码：0 全通过（可上线）；1 有失败（禁止上线）
 */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SERVER = path.resolve(__dirname, '..', 'http-mcp-server.js');
const PINNED_ACCOUNT = '3602026809201658423';
const PINNED_QR_URL = 'https://qr.95516.com/01020001/wcqr?f=ICBCqr&X=1&T=3&P=13&I=e03d925776684b4d&N=b4cbb142eeafe2bddce7a7878c57f5ca&L=09253a28e43998a37f27ab44fba914bf945dc63f02a5239d';

// ── 生产真实 env（逐字节照抄 /opt/lingshu/metering.env 的相关值）──
const PROD_PAY_TO = '微信/支付宝扫码付款（工银e支付·中国工商银行商户聚合码）：https://hongchenlingjing.com/pay/ ；企业客户可对公转账（账户信息见该页面）。付款务必备注订单号，并邮件 553420544@qq.com 告知以便确认到账。';
const PROD_ENV = {
  LS_METERING: 'on',
  LS_PRICE_CENTS: '1',
  LS_PAY_CHANNEL: 'manual',
  LS_PAY_TO: PROD_PAY_TO,
  LS_PAY_PAGE: 'https://hongchenlingjing.com/pay/',
  LS_FREE_LOOPBACK: '0',
  LS_REQUIRE_TLS: 'off',
  LS_RATE_MAX: '100000'
};

let pass = 0, fail = 0;
const lines = [];
function ok(name, cond, extra) {
  if (cond) { pass++; lines.push('  PASS  ' + name); }
  else { fail++; lines.push('  FAIL  ' + name + (extra !== undefined ? '   → ' + JSON.stringify(extra) : '')); }
}
function section(t) { lines.push(''); lines.push('── ' + t + ' ' + '─'.repeat(Math.max(0, 60 - t.length))); }

function mkReq(port) {
  return (method, urlPath, opts) => new Promise((resolve, reject) => {
    opts = opts || {};
    const data = opts.body === undefined ? null : Buffer.from(JSON.stringify(opts.body), 'utf8');
    const headers = Object.assign({}, opts.headers || {});
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = data.length; }
    const r = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers }, (res) => {
      let b = ''; res.setEncoding('utf8');
      res.on('data', c => { b += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (_e) { /* 保留原文 */ } resolve({ status: res.statusCode, body: b, json: j }); });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function startServer(port, envOverride) {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-gate-'));
  const child = spawn(process.execPath, [SERVER], {
    env: Object.assign({}, process.env, PROD_ENV, {
      PORT: String(port),
      LS_CREDITS_PATH: path.join(TMP, 'credits.json')
    }, envOverride || {}),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.bootLog = '';
  child.stdout.on('data', d => { child.bootLog += d.toString(); });
  child.stderr.on('data', d => { child.bootLog += d.toString(); });
  return child;
}

async function waitReady(port, timeoutMs) {
  const req = mkReq(port);
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const r = await req('GET', '/health'); if (r.status === 200) return true; } catch (_e) { /* 未就绪 */ }
    await new Promise(r => setTimeout(r, 120));
  }
  return false;
}
async function mcp(port, method, params, key) {
  const req = mkReq(port);
  const h = {};
  if (key) h['Authorization'] = 'Bearer ' + key;
  const r = await req('POST', '/mcp', { headers: h, body: { jsonrpc: '2.0', id: 1, method, params } });
  if (r.json && r.json.result && Array.isArray(r.json.result.content) && r.json.result.content[0]) {
    try { r.payload = JSON.parse(r.json.result.content[0].text); } catch (_e) { r.payload = null; }
  }
  return r;
}

async function main() {
  // ══════════ A. 生产真实配置：护栏必须「不误报」 ══════════
  const P1 = parseInt(process.env.LS_GATE_PORT_A || '3187', 10);
  const a = startServer(P1, {});
  try {
    if (!await waitReady(P1, 15000)) throw new Error('A 实例未就绪：\n' + a.bootLog);
    const req = mkReq(P1);

    section('A 生产真实配置 · 护栏不误报（误报=拒收=钱一分收不到）');
    const h = await req('GET', '/health');
    ok('GET /health 200', h.status === 200, h.status);
    ok('★ 护栏未误报：health.receiptVerified === true',
      h.json && h.json.receiptVerified === true, h.json && { receiptVerified: h.json.receiptVerified, receiptTampered: h.json.receiptTampered });
    ok('未标记篡改（receiptTampered 字段缺省）',
      h.json && (h.json.receiptTampered === undefined || h.json.receiptTampered === false), h.json && h.json.receiptTampered);
    ok('钉死指纹 pinHash 展示（64 位 hex，运维肉眼可对）',
      h.json && /^[0-9a-f]{64}$/.test(String(h.json.receiptPinHash || '')), h.json && h.json.receiptPinHash);
    ok('线上收款去向 = 钉死对公账号（尾号可核对）',
      h.json && h.json.receiptPinAccount === PINNED_ACCOUNT.slice(0, 4) + '****' + PINNED_ACCOUNT.slice(-4), h.json && h.json.receiptPinAccount);
    ok('health 明示收款方式 = 对公静态（不接支付平台 API）',
      h.json && h.json.payChannel === 'corporate-static', h.json && h.json.payChannel);

    section('A2 定价铁律：固定 1 分/次、无套餐、无其他金额');
    const pr = await req('GET', '/pricing');
    ok('GET /pricing 200', pr.status === 200, pr.status);
    ok('单价 = ¥0.01 / 次', pr.json && pr.json.price && pr.json.price.display === '¥0.01 / 次', pr.json && pr.json.price);
    ok('price.centsPerCall === 1', pr.json && pr.json.price && pr.json.price.centsPerCall === 1, pr.json && pr.json.price);
    ok('★ 不暴露 bundles（无套餐）', pr.json && pr.json.bundles === undefined, pr.json && pr.json.bundles);

    section('A3 付费入口可用（未被 fail-closed 拦）');
    const o = await req('POST', '/pay/order', { body: {} });
    ok('POST /pay/order 201', o.status === 201, { status: o.status, body: (o.body || '').slice(0, 160) });
    ok('订单固定 1 次调用 / 1 分钱', o.json && o.json.calls === 1 && o.json.amountCents === 1, o.json && { calls: o.json.calls, amountCents: o.json.amountCents });
    ok('返回 apiKey（仅此一次）', !!(o.json && /^[A-Za-z0-9_-]{16,}/.test(String(o.json.apiKey || ''))), o.json && (o.json.apiKey ? 'len=' + o.json.apiKey.length : 'missing'));
    ok('★ 付款意图存在且未标记篡改（线上真能收到钱）',
      !!(o.json && o.json.payment && o.json.payment.configured === true && o.json.payment.tampered !== true && (o.json.payment.payUrl || o.json.payment.payTo || o.json.payable === true)),
      o.json && o.json.payment);
    ok('付款意图指向对公静态收款渠道', !!(o.json && Array.isArray(o.json.paymentChannels) && o.json.paymentChannels.some(c => c.channel === 'corporate-static')), o.json && o.json.paymentChannels);

    section('A4 ★ 免费路径：不付钱也能用（信任制 + 概率）');
    const noKey = await mcp(P1, 'tools/call', { name: 'solve', arguments: { equations: ['x^2=4'] } });
    ok('无凭证求解被收费墙拦下（payment_required / missing_key）',
      noKey.payload && noKey.payload.type === 'payment_required' && noKey.payload.reason === 'missing_key',
      noKey.payload && { type: noKey.payload.type, reason: noKey.payload.reason });
    ok('撞墙处给出免费路径 freePath',
      !!(noKey.payload && noKey.payload.freePath && /honorPaid/.test(String(noKey.payload.freePath.how || ''))), noKey.payload && noKey.payload.freePath);
    ok('免费路径标明付费自愿、非强制',
      !!(noKey.payload && noKey.payload.freePath && /自愿|非强制|不是强制/.test(JSON.stringify(noKey.payload.freePath))), noKey.payload && noKey.payload.freePath);
    const honor = await mcp(P1, 'tools/call', { name: 'solve', arguments: { equations: ['x^2=4'], honorPaid: true } });
    ok('★ honorPaid:true → 真的出解（不付钱也能用）', !!(honor.payload && honor.payload.solutionCount >= 1), honor.payload && honor.payload.solutionCount);
    ok('响应标注经信任制放行（support.mode = honor）', !!(honor.payload && honor.payload.support && honor.payload.support.mode === 'honor'), honor.payload && honor.payload.support);
    const freeCred = await req('GET', '/credit');
    ok('查询余额无凭证 → 401 missing_key（查询不收费，但需凭证对账）',
      freeCred.status === 401 && freeCred.json && freeCred.json.error && freeCred.json.error.type === 'missing_key', { status: freeCred.status, body: (freeCred.body || '').slice(0, 120) });
    const withKey = await req('GET', '/credit', { headers: { Authorization: 'Bearer ' + (o.json && o.json.apiKey) } });
    ok('带凭证查询余额 → 200，且尚未到账（余额 0、剩余 0 次）',
      withKey.status === 200 && withKey.json && withKey.json.balanceCents === 0, withKey.json && { status: withKey.status, balanceCents: withKey.json && withKey.json.balanceCents });

    section('A5 ★ 零人工闭环：付款后自助入账（作者无需触发任何东西）');
    ok('建单响应即给出自助入账指引 selfCredit（闭环写在撞墙处）',
      !!(o.json && o.json.selfCredit && /selfReportPaid/.test(JSON.stringify(o.json.selfCredit))), o.json && o.json.selfCredit);
    ok('pricing 首选入账方式 = self-report（零人工）',
      !!(pr.json && pr.json.creditModes && pr.json.creditModes.prefer === 'self-report'), pr.json && pr.json.creditModes);
    ok('pricing 明说真营收以流水核对为准（不自欺）',
      !!(pr.json && pr.json.creditModes && /流水|核对/.test(JSON.stringify(pr.json.creditModes))), pr.json && pr.json.creditModes);
    const claim = await mcp(P1, 'tools/call', { name: 'pay', arguments: { orderId: o.json.orderId, selfReportPaid: true } });
    ok('★ 自助入账成功（credited / verified:false）',
      !!(claim.payload && claim.payload.status === 'credited' && claim.payload.verified === false),
      claim.payload && { status: claim.payload.status, verified: claim.payload.verified });
    const cred2 = await req('GET', '/credit', { headers: { Authorization: 'Bearer ' + o.json.apiKey } });
    ok('★ 入账后余额立即到账（无需任何人审核）', !!(cred2.json && cred2.json.balanceCents === 1), cred2.json && cred2.json.balanceCents);
    const solvePaid = await mcp(P1, 'tools/call', { name: 'solve', arguments: { equations: ['x^2=4'] } }, o.json.apiKey);
    ok('★ 入账后的 key 立即能求解', !!(solvePaid.payload && solvePaid.payload.solutionCount >= 1), solvePaid.payload && solvePaid.payload.solutionCount);
    const h3 = await req('GET', '/health');
    ok('health 分栏计数：honorClaims 与 selfReportClaims 各自独立',
      !!(h3.json && typeof h3.json.honorClaims === 'number' && h3.json.selfReportClaims >= 1), h3.json && { honor: h3.json.honorClaims, self: h3.json.selfReportClaims });
  } finally {
    a.kill('SIGKILL');
  }

  // ══════════ B. 账号被换：必须报，且只拒收款、不拒服务 ══════════
  const P2 = parseInt(process.env.LS_GATE_PORT_B || '3188', 10);
  const EVILL = '6222020200112233445'; // 攻击者把自己的 19 位卡号塞进配置
  const b = startServer(P2, {
    LS_PAY_TO: '请转账至 ' + EVILL + ' （户名：某人）',
    LS_PAY_PAGE: 'https://hongchenlingjing.com/pay/'
  });
  try {
    if (!await waitReady(P2, 15000)) throw new Error('B 实例未就绪：\n' + b.bootLog);
    const req = mkReq(P2);

    section('B 攻击场景 · 对公账号被换成攻击者账号');
    const h2 = await req('GET', '/health');
    ok('★ 检测到篡改：receiptVerified === false', h2.json && h2.json.receiptVerified === false, h2.json && h2.json.receiptVerified);
    ok('★ receiptTampered === true', h2.json && h2.json.receiptTampered === true, h2.json && h2.json.receiptTampered);

    const o2 = await req('POST', '/pay/order', { body: {} });
    ok('★ fail-closed：付款意图被拒（不向用户展示错误账号）',
      !!(o2.json && o2.json.payment && o2.json.payment.tampered === true && o2.json.payment.configured === false), o2.json && o2.json.payment);
    ok('不暴露攻击者账号（payload 里查不到坏卡号）',
      o2.body.indexOf(EVILL) < 0, '出现在响应里');
    ok('给出问题清单 problems（运维能定位）',
      !!(o2.json && o2.json.payment && Array.isArray(o2.json.payment.problems) && o2.json.payment.problems.length > 0), o2.json && o2.json.payment && o2.json.payment.problems);
    ok('★ 服务本身不停摆：honorPaid 仍能出解（不能收就算了）',
      await (async () => { const r = await mcp(P2, 'tools/call', { name: 'solve', arguments: { equations: ['x^2=4'], honorPaid: true } }); return !!(r.payload && r.payload.solutionCount >= 1); })(), 'solve 失败');
  } finally {
    b.kill('SIGKILL');
  }

  // ══════════ C. 收款码被换：同样必须报 ══════════
  const P3 = parseInt(process.env.LS_GATE_PORT_C || '3189', 10);
  const c = startServer(P3, { LS_PAY_TO_QR: 'https://evil.example.com/my-qr.png' });
  try {
    if (!await waitReady(P3, 15000)) throw new Error('C 实例未就绪：\n' + c.bootLog);
    section('C 攻击场景 · 收款码被指向第三方');
    const h3 = await mkReq(P3)('GET', '/health');
    ok('★ 收款码被换 → receiptVerified === false', h3.json && h3.json.receiptVerified === false, h3.json && h3.json.receiptVerified);
  } finally {
    c.kill('SIGKILL');
  }

  // ══════════ D. 钉死值自证：线上码必须与代码里钉死的一致 ══════════
  section('D 钉死值自证（代码内的账号/码 = 公司真实收款去向）');
  const src = fs.readFileSync(SERVER, 'utf8');
  ok('代码钉死对公账号 = ' + PINNED_ACCOUNT.slice(0, 4) + '****' + PINNED_ACCOUNT.slice(-4), src.indexOf(PINNED_ACCOUNT) >= 0);
  ok('代码钉死收款码 = 银联官方聚合码（qr.95516.com）', src.indexOf(PINNED_QR_URL) >= 0);
  ok('代码含公司主体名（户名核对用）', src.indexOf('广州市红尘灵境数字科技有限公司') >= 0);
  ok('废弃的支付平台自动入账代码已清零（Alipay/WeChat 回调）',
    !/notify\/alipay|notify\/wechat|LS_ALIPAY_|LS_WECHAT_/.test(src));

  console.log(lines.join('\n'));
  console.log('');
  console.log('上线前闸门：PASS ' + pass + ' / FAIL ' + fail + ' / 共 ' + (pass + fail));
  console.log(fail === 0 ? '✅ 可以上线' : '⛔ 禁止上线（存在失败项）');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(String(e && e.stack || e)); process.exit(1); });
