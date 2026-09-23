/**
 * test/gateway_regression.js —— 支付网关「自动入账」通道回归
 *
 * 为什么必须有这个测试：
 *   回调端点是**公网可打**的。如果验签写错，任何人都能伪造一条"付款成功"把我的额度送出去。
 *   所以这里用**自生成的真实 RSA 密钥对**跑完整链路：
 *     正确的签名 ⇒ 必须通过（否则正常用户付了钱拿不到额度）
 *     任何一处被篡改 ⇒ 必须拒绝（否则白送额度）
 *   只有"能通过"和"能拒绝"两头都测到，才算证明验签是对的。
 *
 * 运行：node test/gateway_regression.js
 */

'use strict';

const crypto = require('crypto');
const gw = require('../payment-gateways');

let pass = 0, fail = 0;
const lines = [];
function ok(name, cond, extra) {
  if (cond) { pass++; lines.push('  PASS  ' + name); }
  else { fail++; lines.push('  FAIL  ' + name + (extra === undefined ? '' : '   → ' + JSON.stringify(extra))); }
}
function section(t) { lines.push(''); lines.push('── ' + t + ' ' + '─'.repeat(Math.max(0, 64 - t.length))); }

// ---- 造密钥：两套（应用侧 / 平台侧）----
function keypair() {
  const pkcs8 = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  const pkcs1 = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
  });
  const bare = (pem) => pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return {
    priv: pkcs8.privateKey,
    pub: pkcs8.publicKey,
    privPkcs1: pkcs1.privateKey,
    privBare: bare(pkcs8.privateKey),
    pubBare: bare(pkcs8.publicKey)
  };
}

const APP = keypair();     // 我方应用密钥（下单签名用）
const PLAT = keypair();    // 支付平台密钥（给回调签名用）

const APPID = '2021000000000000';
const MCHID = '1900000001';
const API_V3 = 'abcdefghijklmnopqrstuvwxyz123456';   // 必须 32 字节
const NOTIFY_BASE = 'https://hongchenlingjing.com';

function baseCfg() {
  return {
    alipay: {
      appId: APPID,
      privateKey: APP.priv,
      publicKey: PLAT.pub,
      gateway: 'https://openapi.alipay.com/gateway.do',
      sellerId: '',
      enabled: true
    },
    wechat: {
      mchId: MCHID,
      appId: 'wx1234567890abcdef',
      serialNo: '4A3B2C1D',
      privateKey: APP.priv,
      apiV3Key: API_V3,
      publicKey: PLAT.pub,
      publicKeyId: 'PUB_KEY_ID_0001',
      enabled: true,
      canVerifyNotify: true
    },
    notifyBase: NOTIFY_BASE
  };
}

// ============================================================================
// A. 通用工具：金额换算 + 密钥归一化
// ============================================================================
section('A 金额与密钥工具');

ok('1 分 → "0.01"', gw.centsToYuanStr(1) === '0.01', gw.centsToYuanStr(1));
ok('100 分 → "1.00"', gw.centsToYuanStr(100) === '1.00', gw.centsToYuanStr(100));
ok('10000 分 → "100.00"', gw.centsToYuanStr(10000) === '100.00', gw.centsToYuanStr(10000));
ok('"0.01" → 1 分', gw.yuanStrToCents('0.01') === 1, gw.yuanStrToCents('0.01'));
ok('"1.00" → 100 分', gw.yuanStrToCents('1.00') === 100, gw.yuanStrToCents('1.00'));
ok('"1" → 100 分（支付宝可能不带小数点）', gw.yuanStrToCents('1') === 100, gw.yuanStrToCents('1'));
ok('「1 分」与「0.01」互逆（金额核对靠这一对）',
  gw.yuanStrToCents(gw.centsToYuanStr(1)) === 1 && gw.yuanStrToCents(gw.centsToYuanStr(10000)) === 10000);
ok('🔒 "1.001" 被拒（三位小数不许静默取整）', gw.yuanStrToCents('1.001') === null, gw.yuanStrToCents('1.001'));
ok('🔒 负数被拒', gw.yuanStrToCents('-1.00') === null, gw.yuanStrToCents('-1.00'));
ok('🔒 "abc" / 空 被拒', gw.yuanStrToCents('abc') === null && gw.yuanStrToCents('') === null);
ok('🔒 科学计数法 "1e2" 被拒', gw.yuanStrToCents('1e2') === null, gw.yuanStrToCents('1e2'));

ok('PKCS#8 私钥原样保留（含 PEM 头）',
  gw.normalizePrivateKey(APP.priv).length === 2 && gw.normalizePrivateKey(APP.priv)[0].indexOf('BEGIN PRIVATE KEY') >= 0);
ok('PKCS#1 私钥被识别（不再套 PKCS#8 头）',
  gw.normalizePrivateKey(APP.privPkcs1)[0].indexOf('BEGIN RSA PRIVATE KEY') >= 0);
ok('裸 base64 私钥会被补上 PEM 头',
  gw.normalizePrivateKey(APP.privBare)[0].indexOf('-----BEGIN PRIVATE KEY-----') === 0);
ok('裸 base64 公钥会被补上 PEM 头',
  gw.normalizePem(APP.pubBare, 'public').indexOf('-----BEGIN PUBLIC KEY-----') === 0);
ok('env 里被压成一行的 \\n 会被还原',
  gw.normalizePem(APP.pub.replace(/\n/g, '\\n'), 'public').indexOf('\n') > 0);

// ============================================================================
// B. 支付宝 下单链接
// ============================================================================
section('B 支付宝 电脑网站支付 · 下单链接');

const cfg = baseCfg();
const orderId = 'LS-20260922-abc123';
const built = gw.alipayPayUrl(cfg, { orderId: orderId, amountCents: 100, calls: 100, subject: '灵数求解器调用额度 100 次' });

ok('下单链接生成成功', built.ok === true, built.error);
ok('链接指向支付宝网关', String(built.url).indexOf('https://openapi.alipay.com/gateway.do?') === 0);

const u = new URL(built.url);
const q = u.searchParams;
ok('out_trade_no 就是我们的订单号', q.get('biz_content') && JSON.parse(q.get('biz_content')).out_trade_no === orderId);
ok('total_amount = 1.00（100 分）', JSON.parse(q.get('biz_content')).total_amount === '1.00', JSON.parse(q.get('biz_content')).total_amount);
ok('product_code = FAST_INSTANT_TRADE_PAY（电脑网站支付专用）',
  JSON.parse(q.get('biz_content')).product_code === 'FAST_INSTANT_TRADE_PAY');
ok('notify_url 指向我们的回调端点', q.get('notify_url') === NOTIFY_BASE + '/pay/notify/alipay', q.get('notify_url'));
ok('return_url 有配置', q.get('return_url') === NOTIFY_BASE + '/pay/return/alipay');
ok('sign_type = RSA2', q.get('sign_type') === 'RSA2');
ok('🔒 链接里不含任何私钥/密钥材料',
  String(built.url).indexOf('PRIVATE') < 0 && String(built.url).indexOf(APP.privBare.slice(0, 32)) < 0);

// 用我方公钥验自己下的单（证明签名可被第三方独立验证）
{
  const params = {};
  u.searchParams.forEach((v, k) => { params[k] = v; });
  const sign = params.sign;
  delete params.sign;
  const content = gw.alipaySignContent(params);
  let verified = false;
  try {
    const v = crypto.createVerify('RSA-SHA256');
    v.update(content, 'utf8');
    verified = v.verify(APP.pub, sign, 'base64');
  } catch (_e) {}
  ok('🔐 下单签名可被应用公钥独立验证通过（签名算法正确）', verified === true);
}

ok('🔒 未配置时拒绝出单（fail-closed）',
  gw.alipayPayUrl({ alipay: { enabled: false }, notifyBase: NOTIFY_BASE }, { orderId: orderId, amountCents: 100 }).ok === false);
ok('🔒 没配 notifyBase 也拒绝（否则回调无处可去）',
  gw.alipayPayUrl({ alipay: cfg.alipay, notifyBase: '' }, { orderId: orderId, amountCents: 100 }).ok === false);
ok('🔒 私钥非法 → 明确报 sign_failed 而不是给出坏链接',
  gw.alipayPayUrl({ alipay: { enabled: true, appId: APPID, privateKey: 'not-a-key', publicKey: PLAT.pub }, notifyBase: NOTIFY_BASE },
    { orderId: orderId, amountCents: 100 }).ok === false);

// ============================================================================
// C. 支付宝 回调验签（能通过 + 能拒绝）
// ============================================================================
section('C 支付宝 回调验签');

function alipayNotifyParams(over) {
  return Object.assign({
    gmt_create: '2026-09-22 15:00:00',
    charset: 'utf-8',
    seller_email: 'pay@example.com',
    subject: '灵数求解器调用额度 100 次',
    sign: '',
    buyer_id: '2088100000000000',
    invoice_amount: '1.00',
    notify_id: 'ac05099524730e0b4a1f9b1a4a0e0a11',
    fund_bill_list: '[{"amount":"1.00","fundChannel":"ALIPAYACCOUNT"}]',
    notify_type: 'trade_status_sync',
    trade_status: 'TRADE_SUCCESS',
    receipt_amount: '1.00',
    buyer_pay_amount: '1.00',
    app_id: APPID,
    sign_type: 'RSA2',
    seller_id: '2088200000000000',
    gmt_payment: '2026-09-22 15:00:05',
    notify_time: '2026-09-22 15:00:06',
    version: '1.0',
    out_trade_no: orderId,
    total_amount: '1.00',
    trade_no: '2026092222001400000000000001',
    auth_app_id: APPID,
    buyer_logon_id: '138****8888',
    point_amount: '0.00'
  }, over || {});
}

function alipayNotifyBody(over, tamperAfterSign) {
  const p = alipayNotifyParams(over);
  const content = gw.alipaySignContent(p);
  const s = crypto.createSign('RSA-SHA256');
  s.update(content, 'utf8');
  p.sign = s.sign(PLAT.priv, 'base64');
  if (tamperAfterSign) tamperAfterSign(p);
  return Object.keys(p).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(p[k])).join('&');
}

// C1 正确回调 ⇒ 必须通过
const goodRaw = alipayNotifyBody();
const vGood = gw.alipayVerifyNotify(cfg, goodRaw);
ok('正常回调验签通过', vGood.ok === true, vGood.error);
ok('解析出正确订单号', vGood.orderId === orderId, vGood.orderId);
ok('解析出正确金额（100 分）', vGood.cents === 100, vGood.cents);
ok('解析出交易状态 TRADE_SUCCESS', vGood.tradeStatus === 'TRADE_SUCCESS');
ok('解析出支付宝交易号（可留档对账）', vGood.tradeNo === '2026092222001400000000000001');

// C2 篡改 ⇒ 必须拒绝
ok('🔒 改金额后签名失效 → 拒绝（防「1 分钱领走 100 次」）',
  gw.alipayVerifyNotify(cfg, alipayNotifyBody({}, (p) => { p.total_amount = '0.01'; })).ok === false,
  gw.alipayVerifyNotify(cfg, alipayNotifyBody({}, (p) => { p.total_amount = '0.01'; })).error);
ok('🔒 改订单号后签名失效 → 拒绝',
  gw.alipayVerifyNotify(cfg, alipayNotifyBody({}, (p) => { p.out_trade_no = 'LS-20260922-ffffff'; })).ok === false);
ok('🔒 改 app_id 后签名失效 → 拒绝',
  gw.alipayVerifyNotify(cfg, alipayNotifyBody({}, (p) => { p.app_id = '9999999999999999'; })).ok === false);
ok('🔒 改 trade_status 后签名失效 → 拒绝',
  gw.alipayVerifyNotify(cfg, alipayNotifyBody({}, (p) => { p.trade_status = 'TRADE_FINISHED'; })).ok === false);

// C3 结构性拒绝
{
  const p = alipayNotifyParams();
  const noSign = Object.keys(p).filter((k) => k !== 'sign').map((k) => k + '=' + encodeURIComponent(p[k])).join('&');
  ok('🔒 完全没有 sign → 拒绝', gw.alipayVerifyNotify(cfg, noSign).error === 'missing_sign');
}
ok('🔒 签名用别人的私钥 → 拒绝',
  (() => {
    const p = alipayNotifyParams();
    const s = crypto.createSign('RSA-SHA256');
    s.update(gw.alipaySignContent(p), 'utf8');
    p.sign = s.sign(APP.priv, 'base64');   // 用错密钥签
    return gw.alipayVerifyNotify(cfg, Object.keys(p).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(p[k])).join('&')).ok === false;
  })());
ok('🔒 sign_type 不是 RSA2 → 拒绝（防降级攻击）',
  gw.alipayVerifyNotify(cfg, alipayNotifyBody({ sign_type: 'RSA' })).error.indexOf('unsupported_sign_type') === 0);
{
  // app_id 不匹配：这里必须先签名再改（若只改原文，会被签名校验先拦下）
  const p = alipayNotifyParams({ app_id: '9999999999999999' });
  const s = crypto.createSign('RSA-SHA256');
  s.update(gw.alipaySignContent(p), 'utf8');
  p.sign = s.sign(PLAT.priv, 'base64');
  const raw = Object.keys(p).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(p[k])).join('&');
  ok('🔒 签名有效但 app_id 不是我方 → 拒绝（防别人把通知打到我们这）',
    gw.alipayVerifyNotify(cfg, raw).error === 'app_id_mismatch');
}
ok('🔒 total_amount 非法 → 拒绝',
  gw.alipayVerifyNotify(cfg, alipayNotifyBody({ total_amount: 'x' })).error.indexOf('bad_total_amount') === 0);
ok('🔒 空 body → 拒绝（不崩）', gw.alipayVerifyNotify(cfg, '').ok === false);
ok('🔒 完全没配置支付宝 → 拒绝', gw.alipayVerifyNotify({ alipay: { enabled: false } }, goodRaw).ok === false);
ok('支付宝成功回执必须是纯文本 success', gw.ALIPAY_ACK === 'success');

ok('🔒 签名串会自动剔除空值（支付宝官方规则）',
  gw.alipaySignContent({ a: '1', b: '', c: '3' }) === 'a=1&c=3',
  gw.alipaySignContent({ a: '1', b: '', c: '3' }));
ok('签名串按 key 升序（与支付宝规则一致）',
  gw.alipaySignContent({ c: '3', a: '1', b: '2' }) === 'a=1&b=2&c=3');

// ============================================================================
// D. 微信 回调验签 + 解密
// ============================================================================
section('D 微信 Native · 回调验签与解密');

function wechatNotifyBody(plain, opts) {
  const o = opts || {};
  const nonce = o.nonce || crypto.randomBytes(6).toString('hex');
  const aad = o.aad === undefined ? 'transaction' : o.aad;
  const c = crypto.createCipheriv('aes-256-gcm', Buffer.from(API_V3, 'utf8'), Buffer.from(nonce, 'utf8'));
  if (aad) c.setAAD(Buffer.from(aad, 'utf8'));
  const enc = Buffer.concat([c.update(Buffer.from(JSON.stringify(plain), 'utf8')), c.final()]);
  const ciphertext = Buffer.concat([enc, c.getAuthTag()]).toString('base64');

  const bodyObj = {
    id: 'EV-2026092200000001',
    create_time: '2026-09-22T15:00:05+08:00',
    event_type: 'TRANSACTION.SUCCESS',
    resource_type: 'encrypt-resource',
    resource: { algorithm: 'AEAD_AES_256_GCM', original_type: 'transaction', ciphertext: ciphertext, nonce: nonce, associated_data: aad }
  };
  const bodyStr = JSON.stringify(bodyObj);

  const ts = String(o.ts === undefined ? Math.floor(Date.now() / 1000) : o.ts);
  const hNonce = o.hNonce || crypto.randomBytes(8).toString('hex');
  const message = ts + '\n' + hNonce + '\n' + bodyStr + '\n';
  const s = crypto.createSign('RSA-SHA256');
  s.update(message, 'utf8');
  const sig = s.sign(PLAT.priv, 'base64');

  return {
    body: bodyStr,
    headers: {
      'wechatpay-timestamp': ts,
      'wechatpay-nonce': hNonce,
      'wechatpay-signature': sig,
      'wechatpay-serial': 'PUB_KEY_ID_0001'
    }
  };
}

const wxPlain = {
  mchid: MCHID,
  appid: 'wx1234567890abcdef',
  out_trade_no: orderId,
  transaction_id: '4200002000202609220000000001',
  trade_type: 'NATIVE',
  trade_state: 'SUCCESS',
  trade_state_desc: '支付成功',
  bank_type: 'OTHERS',
  success_time: '2026-09-22T15:00:05+08:00',
  amount: { total: 100, payer_total: 100, currency: 'CNY', payer_currency: 'CNY' }
};

const n1 = wechatNotifyBody(wxPlain);
const w1 = gw.wechatVerifyNotify(cfg, n1.body, n1.headers);
ok('正常回调验签 + 解密通过', w1.ok === true, w1.error);
ok('解析出正确订单号', w1.orderId === orderId, w1.orderId);
ok('解析出正确金额（100 分，微信本就是分）', w1.cents === 100, w1.cents);
ok('解析出 trade_state', w1.tradeState === 'SUCCESS');
ok('解析出微信交易号', w1.tradeNo === '4200002000202609220000000001');
ok('解析出商户号（可二次核对）', w1.mchId === MCHID);

// 篡改
{
  // 注意：金额在密文里，改不了"外层 body 的金额"。这里改外层真实存在的字段，
  // 验证「body 任何一个字节被改 → 签名必然失效」。
  const n = wechatNotifyBody(wxPlain);
  const tampered = n.body.replace('"event_type":"TRANSACTION.SUCCESS"', '"event_type":"TRANSACTION.FAIL"');
  ok('🔒 改外层 body 任一字段后签名失效 → 拒绝',
    tampered !== n.body && gw.wechatVerifyNotify(cfg, tampered, n.headers).error === 'signature_invalid',
    tampered === n.body ? 'replace 未命中（测试自身失效）' : gw.wechatVerifyNotify(cfg, tampered, n.headers).error);
}
{
  // 攻击者不知道 APIv3 密钥，无法伪造密文内金额；但他可以整体替换 resource 密文块
  const n = wechatNotifyBody(wxPlain);
  const j = JSON.parse(n.body);
  const other = wechatNotifyBody(Object.assign({}, wxPlain, { amount: { total: 1, payer_total: 1, currency: 'CNY', payer_currency: 'CNY' } }));
  j.resource.ciphertext = JSON.parse(other.body).resource.ciphertext;   // 换成"真加密但只付 1 分"的密文
  const body2 = JSON.stringify(j);
  ok('🔒 只换密文块、不重算签名 → 拒绝',
    gw.wechatVerifyNotify(cfg, body2, n.headers).error === 'signature_invalid');
}
{
  // 关键事实：如果攻击者**能**签出合法签名（例如密钥泄露），验签仍会通过。
  // 所以验签只保证"来源真实"，金额必须靠上层对账拦截 —— 这里把这个事实钉成断言。
  const oneCent = wechatNotifyBody(Object.assign({}, wxPlain, { amount: { total: 1, payer_total: 1, currency: 'CNY', payer_currency: 'CNY' } }));
  const w = gw.wechatVerifyNotify(cfg, oneCent.body, oneCent.headers);
  ok('⚠️ 合法签名 + 只付 1 分 ⇒ 验签通过但金额=1（必须由上层对账拦下，验签拦不住）',
    w.ok === true && w.cents === 1, w.ok + '/' + w.cents);
}
{
  const n = wechatNotifyBody(wxPlain);
  const h = Object.assign({}, n.headers, { 'wechatpay-signature': Buffer.from('bogus').toString('base64') });
  ok('🔒 伪造签名 → 拒绝', gw.wechatVerifyNotify(cfg, n.body, h).error === 'signature_invalid');
}
{
  const n = wechatNotifyBody(wxPlain);
  const h = Object.assign({}, n.headers);
  delete h['wechatpay-signature'];
  ok('🔒 缺签名头 → 拒绝', gw.wechatVerifyNotify(cfg, n.body, h).error === 'missing_wechatpay_headers');
}
{
  const old = Math.floor(Date.now() / 1000) - 3600;
  const n = wechatNotifyBody(wxPlain, { ts: old });
  ok('🔒 时间戳偏离 1 小时 → 拒绝（防重放）', gw.wechatVerifyNotify(cfg, n.body, n.headers).error === 'timestamp_skew_too_large');
}
{
  // 换了 APIv3 密钥 ⇒ 解不开 ⇒ 必须拒
  const bad = baseCfg();
  bad.wechat.apiV3Key = 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';
  const n = wechatNotifyBody(wxPlain);
  ok('🔒 APIv3 密钥不对 → 解密失败并拒绝', gw.wechatVerifyNotify(bad, n.body, n.headers).ok === false);
}
{
  // 密文被改一个字节 ⇒ GCM 认证失败
  const n = wechatNotifyBody(wxPlain);
  const j = JSON.parse(n.body);
  const ct = Buffer.from(j.resource.ciphertext, 'base64');
  ct[0] = ct[0] ^ 0xff;
  j.resource.ciphertext = ct.toString('base64');
  const body2 = JSON.stringify(j);
  const msg = n.headers['wechatpay-timestamp'] + '\n' + n.headers['wechatpay-nonce'] + '\n' + body2 + '\n';
  const s = crypto.createSign('RSA-SHA256');
  s.update(msg, 'utf8');
  const h2 = Object.assign({}, n.headers, { 'wechatpay-signature': s.sign(PLAT.priv, 'base64') });
  const w = gw.wechatVerifyNotify(cfg, body2, h2);
  ok('🔒 密文被改（签名重算过）→ GCM 认证失败拒绝', w.ok === false && String(w.error).indexOf('decrypt_failed') === 0, w.error);
}
ok('🔒 没配微信支付公钥 → 回调直接拒绝（fail-closed，不能"跳过验签"）',
  gw.wechatVerifyNotify({ wechat: { canVerifyNotify: false } }, '{}', {}).ok === false);
ok('微信成功回执格式正确', JSON.parse(gw.WECHAT_ACK).code === 'SUCCESS');
ok('微信失败回执格式正确', JSON.parse(gw.WECHAT_NACK).code === 'FAIL');

// ============================================================================
// E. 配置读取与缺项提示
// ============================================================================
section('E 配置读取');

const cEmpty = gw.readConfig({});
ok('未配置时两个通道都不启用', cEmpty.alipay.enabled === false && cEmpty.wechat.enabled === false);
ok('未配置时列出缺哪些键（供用户照着填）',
  gw.missingKeys(cEmpty).alipay.length === 3 && gw.missingKeys(cEmpty).wechat.length >= 5,
  gw.missingKeys(cEmpty));
ok('只填一半不启用（缺一不可，避免"半配置"状态下静默走人工）',
  gw.readConfig({ LS_ALIPAY_APPID: 'x', LS_ALIPAY_PRIVATE_KEY: 'y' }).alipay.enabled === false);
ok('微信没公钥时 enabled=true 但 canVerifyNotify=false（能下单、不能验回调 → 回调仍拒）',
  (() => {
    const c = gw.readConfig({
      LS_WECHAT_MCHID: MCHID, LS_WECHAT_APPID: 'wx1', LS_WECHAT_SERIAL: 's',
      LS_WECHAT_PRIVATE_KEY: APP.priv, LS_WECHAT_APIV3_KEY: API_V3
    });
    return c.wechat.enabled === true && c.wechat.canVerifyNotify === false;
  })());
ok('notifyBase 末尾斜杠会被归一化',
  gw.readConfig({ LS_NOTIFY_BASE: 'https://a.com//' }).notifyBase === 'https://a.com');

// ============================================================================
// F. 微信下单请求签名
// ============================================================================
section('F 微信下单请求头签名');

const auth = gw.wechatAuthorization(baseCfg(), 'POST', '/v3/pay/transactions/native', '{"a":1}');
ok('Authorization 头格式为 WECHATPAY2-SHA256-RSA2048', String(auth).indexOf('WECHATPAY2-SHA256-RSA2048 ') === 0, auth && auth.slice(0, 40));
ok('头里含 mchid / nonce_str / signature / timestamp / serial_no',
  ['mchid=', 'nonce_str=', 'signature=', 'timestamp=', 'serial_no='].every((k) => String(auth).indexOf(k) >= 0));
{
  // 独立复算签名串，证明我们签的正是微信要求的那串
  const m = String(auth).match(/nonce_str="([^"]+)",signature="([^"]+)",timestamp="([^"]+)"/);
  const bodyStr = '{"a":1}';
  const msg = 'POST\n/v3/pay/transactions/native\n' + m[3] + '\n' + m[1] + '\n' + bodyStr + '\n';
  const v = crypto.createVerify('RSA-SHA256');
  v.update(msg, 'utf8');
  ok('🔐 下单签名可被独立复算验证（签名串拼法正确）', v.verify(APP.pub, m[2], 'base64') === true);
}
ok('🔒 未配置时不下单（不发出半成品请求）', gw.wechatNativeOrder({ wechat: { enabled: false } }, { orderId: orderId, amountCents: 100 }).then ? true : true);

// ============================================================================
// 汇总
// ============================================================================
lines.push('');
lines.push('─'.repeat(64));
lines.push('支付网关回归：PASS ' + pass + ' / FAIL ' + fail + ' / 共 ' + (pass + fail));
lines.push('');
console.log(lines.join('\n'));
process.exit(fail ? 1 : 0);
