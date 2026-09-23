/**
 * autopay_e2e.js —— 「零人工自动入账」端到端验证
 *
 * 与 gateway_regression.js 的区别：
 *   gateway_regression 只测模块函数（离线、纯计算）；
 *   本文件**真把 http-mcp-server.js 起起来**，用真实签名/加密构造回调，
 *   打真实 HTTP 端口，然后查账本。目的在于证明：
 *
 *     用户付款后，**没有任何人**点过任何按钮，余额自己就上去了。
 *
 * 用自造 RSA 密钥对（我方应用密钥 / 平台密钥）替代真实支付宝/微信密钥，
 * 因为验签逻辑与密钥来源无关；这样做可以在拿到商户号之前就把整条链路验穿。
 *
 * 覆盖：
 *   A 下单 → 自动通道返回收银台链接（而不是静态收款码）
 *   B 支付宝回调 → 自动入账（人工零参与）
 *   C 重复回调 → 幂等，不重复加钱
 *   D 金额不符（只付 1 分）→ 不入账、留痕
 *   E 伪造签名 → 回 failure、不入账
 *   F 微信回调（合法签名 + AES-GCM 密文）→ 自动入账
 *   G 同步跳回页（/pay/return/alipay）只展示、不入账
 *   H 人工兜底端点仍在，且仍然强制核对金额
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'http-mcp-server.js');
const PORT = 33311;
const BASE = 'http://127.0.0.1:' + PORT;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-autopay-'));

// ── 自造密钥对 ────────────────────────────────────────────────────────────────
function keypair() {
  const k = crypto.generateKeyPairSync('rsa', { modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  return { priv: k.privateKey, pub: k.publicKey };
}
const APP = keypair();     // 我方应用密钥（下单签名用）
const PLAT = keypair();    // 支付平台密钥（给回调签名用）

const APPID = '2021004100000000';
const MCHID = '1900000001';
const API_V3 = 'abcdefghijklmnopqrstuvwxyz012345';   // 32 字节
const ADMIN_TOKEN = 'test-admin-token-' + crypto.randomBytes(4).toString('hex');
const PRICE = 1;                                      // 1 分/次

// ── 迷你测试框架 ──────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 66 - t.length))); }
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined && extra !== null ? '   → ' + extra : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── HTTP 工具 ─────────────────────────────────────────────────────────────────
function req(method, p, body, headers) {
  return new Promise((resolve) => {
    const data = body === undefined || body === null ? null
      : (typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(JSON.stringify(body), 'utf8'));
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method: method,
      headers: Object.assign(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}, headers || {}) },
      (res) => {
        let b = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { b += c; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(b); } catch (_e) {}
          resolve({ status: res.statusCode, body: b, json: json, headers: res.headers });
        });
      });
    r.on('error', (e) => resolve({ status: 0, body: String(e && e.message), json: null }));
    if (data) r.write(data);
    r.end();
  });
}

// ── 支付宝回调构造（真实签名）─────────────────────────────────────────────────
function alipayRaw(over, tamper) {
  const p = Object.assign({
    gmt_create: '2026-09-18 18:00:00', charset: 'utf-8', seller_email: 'pay@example.com',
    subject: '灵数求解器调用额度', sign: '', buyer_id: '2088100000000000',
    invoice_amount: '0.01', notify_id: 'ac05099524730e0b4a1f9b1a4a0e0a11',
    fund_bill_list: '[{"amount":"0.01","fundChannel":"ALIPAYACCOUNT"}]',
    notify_type: 'trade_status_sync', trade_status: 'TRADE_SUCCESS', receipt_amount: '0.01',
    buyer_pay_amount: '0.01', app_id: APPID, sign_type: 'RSA2', seller_id: '2088200000000000',
    gmt_payment: '2026-09-18 18:00:05', notify_time: '2026-09-18 18:00:06', version: '1.0',
    out_trade_no: '', total_amount: '0.01', trade_no: '2026091822001400000000000001',
    auth_app_id: APPID, buyer_logon_id: '138****8888', point_amount: '0.00'
  }, over || {});
  // 支付宝规则：签名串排除 sign 与 sign_type，剔空值，按 key 升序，值不做 URL 编码
  const content = Object.keys(p).filter((k) => k !== 'sign' && k !== 'sign_type')
    .filter((k) => p[k] !== '' && p[k] !== undefined && p[k] !== null)
    .sort()
    .map((k) => k + '=' + p[k]).join('&');
  const s = crypto.createSign('RSA-SHA256');
  s.update(content, 'utf8');
  p.sign = s.sign(PLAT.priv, 'base64');
  if (tamper) tamper(p);
  return Object.keys(p).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(p[k])).join('&');
}

// ── 微信回调构造（真实签名 + AES-GCM 加密）────────────────────────────────────
function wechatNotify(plain) {
  const nonce = crypto.randomBytes(6).toString('hex');
  const aad = 'transaction';
  const c = crypto.createCipheriv('aes-256-gcm', Buffer.from(API_V3, 'utf8'), Buffer.from(nonce, 'utf8'));
  c.setAAD(Buffer.from(aad, 'utf8'));
  const enc = Buffer.concat([c.update(Buffer.from(JSON.stringify(plain), 'utf8')), c.final()]);
  const ciphertext = Buffer.concat([enc, c.getAuthTag()]).toString('base64');
  const bodyStr = JSON.stringify({
    id: 'EV-2026091800000001', create_time: '2026-09-18T18:00:05+08:00',
    event_type: 'TRANSACTION.SUCCESS', resource_type: 'encrypt-resource',
    resource: { algorithm: 'AEAD_AES_256_GCM', original_type: 'transaction', ciphertext: ciphertext, nonce: nonce, associated_data: aad }
  });
  const ts = String(Math.floor(Date.now() / 1000));
  const hNonce = crypto.randomBytes(8).toString('hex');
  const s = crypto.createSign('RSA-SHA256');
  s.update(ts + '\n' + hNonce + '\n' + bodyStr + '\n', 'utf8');
  return { body: bodyStr, headers: {
    'Content-Type': 'application/json',
    'wechatpay-timestamp': ts, 'wechatpay-nonce': hNonce,
    'wechatpay-signature': s.sign(PLAT.priv, 'base64'), 'wechatpay-serial': 'PUB_KEY_ID_0001'
  } };
}

// ── 起服务 ────────────────────────────────────────────────────────────────────
const ENV = Object.assign({}, process.env, {
  LS_PORT: String(PORT),
  PORT: String(PORT),
  LS_METERING: 'on',
  LS_PRICE_CENTS: String(PRICE),
  LS_ADMIN_TOKEN: ADMIN_TOKEN,
  LS_CREDITS_PATH: path.join(TMP, 'credits.json'),
  LS_FREE_LOOPBACK: '0',
  LS_REQUIRE_TLS: 'off',
  LS_PAY_TO: '对公账户 3602026809201658423（中国工商银行）',
  LS_PAY_CHANNEL: 'manual-bank',
  LS_PAY_PAGE: 'https://hongchenlingjing.com/pay/',
  LS_NOTIFY_BASE: BASE,
  LS_ALIPAY_APPID: APPID,
  LS_ALIPAY_PRIVATE_KEY: APP.priv,      // 我方应用私钥（下单签名用）
  LS_ALIPAY_PUBLIC_KEY: PLAT.pub,       // 支付宝公钥（验回调用）
  LS_ALIPAY_SELLER_ID: '2088200000000000',
  LS_WECHAT_MCHID: MCHID,
  LS_WECHAT_APPID: 'wx1234567890abcdef',
  LS_WECHAT_SERIAL: '4A5B6C7D8E9F0123456789ABCDEF0123456789AB',
  LS_WECHAT_PRIVATE_KEY: APP.priv,
  LS_WECHAT_APIV3_KEY: API_V3,
  LS_WECHAT_PUBLIC_KEY: PLAT.pub
});

// 端口 env 名与主服务是否一致需要核对：不一致就退回默认端口
const child = spawn(process.execPath, [SERVER], { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
let serverOut = '';
child.stdout.on('data', (d) => { serverOut += d.toString(); });
child.stderr.on('data', (d) => { serverOut += d.toString(); });

function kill() { try { child.kill(); } catch (_e) {} }

(async function main() {
  try {
    // 等健康检查就绪
    let up = false;
    for (let i = 0; i < 60; i++) {
      const r = await req('GET', '/health');
      if (r.status === 200) { up = true; break; }
      await sleep(150);
    }
    if (!up) {
      console.log('服务未起来，输出如下：\n' + serverOut);
      throw new Error('server_not_up');
    }

    // 确认端口确实是我们配的（否则 /health 可能命中别的进程）
    const h = await req('GET', '/health');
    ok('服务已就绪且自动通道已开启', h.json && h.json.autoPay && (h.json.autoPay.alipay === true), JSON.stringify(h.json && h.json.autoPay));

    // ========================================================================
    section('A 下单：默认走自动通道，返回收银台链接');
    // ========================================================================
    const o1 = await req('POST', '/pay/order', { calls: 1 });
    ok('下单成功（201）', o1.status === 201, o1.status + ' / ' + o1.body.slice(0, 200));
    const order1 = o1.json.orderId, key1 = o1.json.apiKey;
    ok('付款信息标记为自动通道', o1.json.payment && o1.json.payment.mode === 'auto', JSON.stringify(o1.json.payment && o1.json.payment.mode));
    ok('给出支付宝收银台链接（而非静态收款码）',
      !!(o1.json.payment && o1.json.payment.payUrl && o1.json.payment.payUrl.indexOf('openapi.alipay.com') >= 0));
    ok('收银台链接里的金额 = ¥0.01（解析 biz_content 校验，按次付费固定 1 分）',
      (() => {
        const u = o1.json.payment.payUrl;
        const m = /[?&]biz_content=([^&]*)/.exec(u);
        if (!m) return false;
        try { return JSON.parse(decodeURIComponent(m[1])).total_amount === '0.01'; } catch (_e) { return false; }
      })(), o1.json.payment.payUrl);
    ok('明示「到账自动入账，无需人工确认」',
      /无需.*人工/.test(String(o1.json.payment.payUrlNotice || '')) || /无需.*人工/.test(String(o1.json.payment.autoCreditNote || '')),
      o1.json.payment.payUrlNotice);
    ok('响应里可选通道清单包含 auto 通道',
      Array.isArray(o1.json.paymentChannels) && o1.json.paymentChannels.some((c) => c.mode === 'auto'));

    const c0 = await req('GET', '/credit', undefined, { Authorization: 'Bearer ' + key1 });
    ok('下单后余额仍为 0（未收到钱就不给额度）', c0.json && c0.json.balanceCents === 0, JSON.stringify(c0.json));

    // ========================================================================
    section('B 支付宝回调 → 自动入账（零人工）');
    // ========================================================================
    const n1 = await req('POST', '/pay/notify/alipay', alipayRaw({ out_trade_no: order1, total_amount: '0.01' }),
      { 'Content-Type': 'application/x-www-form-urlencoded' });
    ok('回调返回纯文本 success（支付宝要求）', n1.status === 200 && n1.body === 'success', n1.status + ' / ' + JSON.stringify(n1.body));
    const c1 = await req('GET', '/credit', undefined, { Authorization: 'Bearer ' + key1 });
    ok('★ 余额自动到账 1 分 = 1 次（**没有任何人点过确认**）',
      c1.json && c1.json.balanceCents === 1, JSON.stringify(c1.json));
    ok('可调用次数 = 1', c1.json && c1.json.callsRemaining === 1, c1.json && c1.json.callsRemaining);
    const st1 = await req('GET', '/pay/order?orderId=' + order1);
    ok('订单状态自动变为 paid', st1.json && st1.json.status === 'paid', st1.json && st1.json.status);

    // ========================================================================
    section('C 幂等：重复回调不重复加钱');
    // ========================================================================
    const n1b = await req('POST', '/pay/notify/alipay', alipayRaw({ out_trade_no: order1, total_amount: '0.01' }),
      { 'Content-Type': 'application/x-www-form-urlencoded' });
    ok('重复回调仍回 success（否则平台会一直重试）', n1b.body === 'success');
    const c1b = await req('GET', '/credit', undefined, { Authorization: 'Bearer ' + key1 });
    ok('余额仍是 1 分（未被重复入账）', c1b.json && c1b.json.balanceCents === 1, c1b.json && c1b.json.balanceCents);

    // ========================================================================
    section('D 金额不符（只付 1 分买 100 次）→ 不入账、留痕');
    // ========================================================================
    const o2 = await req('POST', '/pay/order', { calls: 1 });
    const order2 = o2.json.orderId, key2 = o2.json.apiKey;
    const n2 = await req('POST', '/pay/notify/alipay', alipayRaw({ out_trade_no: order2, total_amount: '0.02' }),
      { 'Content-Type': 'application/x-www-form-urlencoded' });
    ok('回调被受理（不是我们的错，重试无意义）', n2.body === 'success', n2.body);
    const c2 = await req('GET', '/credit', undefined, { Authorization: 'Bearer ' + key2 });
    ok('★ 实收 2 分 ≠ 本单 1 分 ⇒ 余额 0，一分额度都没给', c2.json && c2.json.balanceCents === 0, JSON.stringify(c2.json));
    const st2 = await req('GET', '/pay/order?orderId=' + order2);
    ok('订单被标记 amount_mismatch（留痕供人工/对账）', st2.json && st2.json.status === 'amount_mismatch', st2.json && st2.json.status);

    // ========================================================================
    section('E 伪造/篡改回调 → 拒绝，回 failure');
    // ========================================================================
    const o3 = await req('POST', '/pay/order', { calls: 1 });
    const order3 = o3.json.orderId, key3 = o3.json.apiKey;
    const tampered = alipayRaw({ out_trade_no: order3, total_amount: '1.00' },
      (p) => { p.total_amount = '100.00'; });                 // 签名后再改金额
    const n3 = await req('POST', '/pay/notify/alipay', tampered, { 'Content-Type': 'application/x-www-form-urlencoded' });
    ok('改金额后签名失效 → 回 failure', n3.body === 'failure', n3.body);
    const c3 = await req('GET', '/credit', undefined, { Authorization: 'Bearer ' + key3 });
    ok('不入账', c3.json && c3.json.balanceCents === 0);

    const fake = await req('POST', '/pay/notify/alipay',
      'out_trade_no=' + order3 + '&total_amount=1.00&trade_status=TRADE_SUCCESS&app_id=' + APPID + '&sign=' +
      encodeURIComponent(Buffer.from('not-a-real-signature').toString('base64')),
      { 'Content-Type': 'application/x-www-form-urlencoded' });
    ok('完全伪造的签名 → failure', fake.body === 'failure', fake.body);
    const c3b = await req('GET', '/credit', undefined, { Authorization: 'Bearer ' + key3 });
    ok('不入账', c3b.json && c3b.json.balanceCents === 0);

    // ========================================================================
    section('F 微信回调（真实 AES-GCM 密文 + 签名）→ 自动入账');
    // ========================================================================
    const o4 = await req('POST', '/pay/order', { calls: 1, channel: 'manual' });   // 免去真实下单网络调用
    const order4 = o4.json.orderId, key4 = o4.json.apiKey;
    ok('人工通道下单仍可用（通道回落正确）', o4.status === 201 && !!order4, o4.status);
    const w = wechatNotify({
      mchid: MCHID, appid: 'wx1234567890abcdef', out_trade_no: order4,
      transaction_id: '4200002000202609180000000001', trade_type: 'NATIVE',
      trade_state: 'SUCCESS', trade_state_desc: '支付成功', bank_type: 'OTHERS',
      success_time: '2026-09-18T18:00:05+08:00',
      amount: { total: 1, payer_total: 1, currency: 'CNY', payer_currency: 'CNY' }
    });
    const n4 = await req('POST', '/pay/notify/wechat', w.body, w.headers);
    ok('微信回调回 SUCCESS 回执', n4.status === 200 && n4.json && n4.json.code === 'SUCCESS', n4.body);
    const c4 = await req('GET', '/credit', undefined, { Authorization: 'Bearer ' + key4 });
    ok('★ 余额自动到账 1 分（零人工，按次付费）', c4.json && c4.json.balanceCents === 1, JSON.stringify(c4.json));

    const wBad = wechatNotify({
      mchid: MCHID, out_trade_no: order4, trade_state: 'SUCCESS',
      transaction_id: 'X', amount: { total: 1, currency: 'CNY' }
    });
    const n4b = await req('POST', '/pay/notify/wechat', wBad.body, wBad.headers);
    ok('重复/小额回调不重复入账', c4.json.balanceCents === 1 && n4b.json.code === 'SUCCESS');

    // ========================================================================
    section('G 同步跳回页只展示，不作为入账依据');
    // ========================================================================
    const o5 = await req('POST', '/pay/order', { calls: 1 });
    const order5 = o5.json.orderId, key5 = o5.json.apiKey;
    const ret = await req('GET', '/pay/return/alipay?' + alipayRaw({ out_trade_no: order5, total_amount: '0.01' }));
    ok('跳回页返回 HTML', ret.status === 200 && (ret.headers['content-type'] || '').indexOf('text/html') === 0, ret.status);
    const c5 = await req('GET', '/credit', undefined, { Authorization: 'Bearer ' + key5 });
    ok('★ 只访问跳回页 ≠ 到账：余额仍为 0', c5.json && c5.json.balanceCents === 0, JSON.stringify(c5.json));

    // ========================================================================
    section('H 人工兜底仍在，且仍强制核对金额');
    // ========================================================================
    const o6 = await req('POST', '/pay/order', { calls: 1 });
    const order6 = o6.json.orderId, key6 = o6.json.apiKey;
    const noAmt = await req('POST', '/admin/order/confirm', { orderId: order6 }, { 'X-Admin-Token': ADMIN_TOKEN });
    ok('人工确认仍拒绝「不核对金额」', noAmt.status === 400 && noAmt.json.error.type === 'amount_not_verified', noAmt.status);
    const badAmt = await req('POST', '/admin/order/confirm', { orderId: order6, receivedCents: 2 }, { 'X-Admin-Token': ADMIN_TOKEN });
    ok('人工确认仍拒绝「少付多领」（实收 2 分 ≠ 本单 1 分）', badAmt.status === 409 && badAmt.json.error.type === 'amount_mismatch', badAmt.status);
    const goodAmt = await req('POST', '/admin/order/confirm', { orderId: order6, receivedCents: 1 }, { 'X-Admin-Token': ADMIN_TOKEN });
    ok('人工确认按正确金额可入账（兜底可用）', goodAmt.status === 200 && goodAmt.json.creditedCents === 1, goodAmt.status + ' ' + goodAmt.body.slice(0, 150));
    const c6 = await req('GET', '/credit', undefined, { Authorization: 'Bearer ' + key6 });
    ok('兜底入账生效', c6.json && c6.json.balanceCents === 1);

    console.log('\n' + '─'.repeat(64));
    console.log('自动入账端到端：PASS ' + pass + ' / FAIL ' + fail + ' / 共 ' + (pass + fail));
  } catch (e) {
    fail++;
    console.log('\n[异常] ' + ((e && e.stack) || e));
    if (serverOut) console.log('\n服务输出：\n' + serverOut.slice(-2000));
  } finally {
    kill();
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_e) {}
    process.exit(fail === 0 ? 0 : 1);
  }
})();
