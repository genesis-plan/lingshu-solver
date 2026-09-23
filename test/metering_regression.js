#!/usr/bin/env node
/**
 * 灵数求解器 · 按次计费（1 分/次）端到端回归
 *
 * 真起一个 http-mcp-server 子进程（计费开、独立临时账本、独立端口），用真 HTTP 打通全链路：
 *   免费面（health/pricing/initialize/tools/list/give_feedback/credit 查询）
 *   → 无凭证拒绝 → 下单发 key → 管理员确认到账 → 带 key 求解扣 1 分
 *   → 失败不扣费 → 余额耗尽拒绝 → 批量请求逐次计费 → ?key= 与 x-api-key 亦可用
 *   → 管理端点鉴权（无 token / 错 token / 未配置时 503）→ 台账汇总 → 凭证轮换/停用
 *
 * 关键环境开关：LS_FREE_LOOPBACK=0
 *   生产上「本机回环且未经代理」的请求免计费（自检/定时任务）。而本回归脚本的客户端
 *   恰在 127.0.0.1 —— 若不关掉该豁免，全部用例都会被当成内部请求而免单，测不出收费墙。
 *
 * 运行：node test/metering_regression.js
 * 退出码：0 全通过；1 有失败（供 CI 直接判定）
 */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PORT = parseInt(process.env.LS_TEST_PORT || '3199', 10);
const ADMIN_TOKEN = 'test-admin-token-0123456789';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-meter-'));
const CREDITS = path.join(TMP, 'credits.json');
const SERVER = path.resolve(__dirname, '..', 'http-mcp-server.js');

let pass = 0, fail = 0;
const lines = [];
function ok(name, cond, extra) {
  if (cond) { pass++; lines.push('  PASS  ' + name); }
  else { fail++; lines.push('  FAIL  ' + name + (extra !== undefined ? '   → ' + JSON.stringify(extra) : '')); }
}
function section(t) { lines.push(''); lines.push('── ' + t + ' ' + '─'.repeat(Math.max(0, 60 - t.length))); }

function req(method, urlPath, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const data = opts.body === undefined ? null : Buffer.from(JSON.stringify(opts.body), 'utf8');
    const headers = Object.assign({}, opts.headers || {});
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = data.length; }
    const r = http.request({ host: '127.0.0.1', port: PORT, method: method, path: urlPath, headers: headers }, (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { b += c; });
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(b); } catch (_e) { /* 非 JSON 响应保留原文 */ }
        resolve({ status: res.statusCode, body: b, json: j });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

// 可指定端口的请求工厂（降级/多进程用例需要）
function mkReq(port) {
  return (method, urlPath, opts) => new Promise((resolve, reject) => {
    opts = opts || {};
    const data = opts.body === undefined ? null : Buffer.from(JSON.stringify(opts.body), 'utf8');
    const headers = Object.assign({}, opts.headers || {});
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = data.length; }
    const r = http.request({ host: '127.0.0.1', port: port, method: method, path: urlPath, headers: headers }, (res) => {
      let b = ''; res.setEncoding('utf8');
      res.on('data', c => { b += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (_e) {} resolve({ status: res.statusCode, body: b, json: j }); });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

// 调用 MCP：返回 { status, json }，并把 tools/call 的文本载荷解析出来便于断言
async function mcp(method, params, key, headers) {
  const h = Object.assign({}, headers || {});
  if (key) h['Authorization'] = 'Bearer ' + key;
  const r = await req('POST', '/mcp', { headers: h, body: { jsonrpc: '2.0', id: 1, method: method, params: params } });
  if (r.json && r.json.result && Array.isArray(r.json.result.content) && r.json.result.content[0]) {
    try { r.payload = JSON.parse(r.json.result.content[0].text); } catch (_e) { r.payload = null; }
  }
  return r;
}
const solveCall = (eqs, key, headers) => mcp('tools/call', { name: 'solve', arguments: { equations: eqs } }, key, headers);

async function waitReady(timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await req('GET', '/health');
      if (r.status === 200) return true;
    } catch (_e) { /* 还没起来 */ }
    await new Promise(r => setTimeout(r, 120));
  }
  return false;
}

async function main() {
  const child = spawn(process.execPath, [SERVER], {
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      LS_METERING: 'on',
      LS_PRICE_CENTS: '1',
      LS_ADMIN_TOKEN: ADMIN_TOKEN,
      LS_PAY_TO: '3602026809201658423',
      LS_PAY_PAGE: 'https://hongchenlingjing.com/pay/',
      LS_CREDITS_PATH: CREDITS,
      LS_FREE_LOOPBACK: '0',
      LS_RATE_MAX: '100000'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let bootLog = '';
  child.stdout.on('data', d => { bootLog += d.toString(); });
  child.stderr.on('data', d => { bootLog += d.toString(); });

  try {
    if (!await waitReady(15000)) throw new Error('服务未在 15s 内就绪；启动输出：\n' + bootLog);

    // ── A. 免费面：不带任何凭证也必须可用，否则 MCP 客户端连握手都过不去 ──
    section('A 免费面（无需凭证）');
    const h = await req('GET', '/health');
    ok('GET /health 200', h.status === 200, h.status);
    ok('health.metering = on', h.json && h.json.metering === 'on', h.json && h.json.metering);
    ok('health.priceCentsPerCall = 1', h.json && h.json.priceCentsPerCall === 1, h.json && h.json.priceCentsPerCall);

    const pr = await req('GET', '/pricing');
    ok('GET /pricing 200', pr.status === 200, pr.status);
    ok('pricing 单价显示 ¥0.01 / 次', pr.json && pr.json.price && pr.json.price.display === '¥0.01 / 次', pr.json && pr.json.price);
    ok('pricing 按次付费、无套餐（不暴露 bundles 数组）',
      pr.json && (pr.json.bundles === undefined || pr.json.bundles === null) &&
      /按次付费/.test(pr.json.model || '') && /1 分钱/.test(pr.json.model || ''),
      pr.json && { model: pr.json.model, bundles: pr.json.bundles });
    ok('pricing 声明免费替代路径（不作假墙）',
      pr.json && Array.isArray(pr.json.freeAlternatives) && pr.json.freeAlternatives.some(s => /npx/.test(s)), pr.json && pr.json.freeAlternatives);
    ok('pricing 含计费规则「仅成功才扣费」', pr.json && /仅当/.test(pr.json.price.billingRule), pr.json && pr.json.price.billingRule);

    const init = await mcp('initialize', {});
    ok('initialize 免凭证可用', init.status === 200 && init.json && init.json.result && init.json.result.serverInfo, init.status);
    const tl = await mcp('tools/list', {});
    ok('tools/list 免凭证可用', tl.status === 200 && tl.json && tl.json.result && Array.isArray(tl.json.result.tools), tl.status);
    const solveTool = tl.json && tl.json.result.tools.find(t => t.name === 'solve');
    ok('solve 工具描述已带计费说明', !!solveTool && /计费/.test(solveTool.description) && /1 分钱/.test(solveTool.description));
    ok('工具名清单 = solve/give_feedback/pay（对公收款 新增 pay 工具）',
      tl.json && tl.json.result.tools.map(t => t.name).sort().join(',') === 'give_feedback,pay,solve',
      tl.json && tl.json.result.tools.map(t => t.name));

    const fb = await mcp('tools/call', { name: 'give_feedback', arguments: { message: '回归测试反馈' } });
    ok('give_feedback 免费可用', fb.status === 200 && fb.payload && fb.payload.acknowledged === true, fb.payload);

    // ── B. 收费墙：无凭证 / 错凭证 一律拒绝，且给出可操作的付费指引 ──
    section('B 收费墙');
    const noKey = await solveCall(['x^2=4']);
    ok('无凭证 solve → isError', noKey.json && noKey.json.result && noKey.json.result.isError === true);
    ok('无凭证 solve → payment_required / missing_key',
      noKey.payload && noKey.payload.type === 'payment_required' && noKey.payload.reason === 'missing_key', noKey.payload && noKey.payload.reason);
    ok('拒绝响应含价格与获取凭证步骤',
      noKey.payload && noKey.payload.priceCentsPerCall === 1 && Array.isArray(noKey.payload.howToGetKey) && noKey.payload.howToGetKey.length >= 3, noKey.payload && noKey.payload.howToGetKey);
    ok('拒绝响应含免费替代路径',
      noKey.payload && Array.isArray(noKey.payload.freeAlternatives) && noKey.payload.freeAlternatives.length >= 2);
    // 付款入口必须直达：撞到收费墙的调用方应当立刻知道「去哪付」，
    // 而不是只被指去再调一次 /pricing。这是把「能收费」变成「真收得到」的最后一环。
    ok('拒绝响应含收款方式（已配置）',
      noKey.payload && noKey.payload.payment && noKey.payload.payment.paymentConfigured === true,
      noKey.payload && noKey.payload.payment);
    ok('拒绝响应直达付款页',
      noKey.payload && noKey.payload.payment && noKey.payload.payment.paymentPage === 'https://hongchenlingjing.com/pay/',
      noKey.payload && noKey.payload.payment && noKey.payload.payment.paymentPage);
    ok('拒绝响应给出逐步付款指引',
      noKey.payload && noKey.payload.payment && Array.isArray(noKey.payload.payment.howToPay) && noKey.payload.payment.howToPay.length >= 4,
      noKey.payload && noKey.payload.payment && noKey.payload.payment.howToPay);
    ok('付款指引含「备注必须填订单号」与「原路退回」口径',
      noKey.payload && noKey.payload.payment && Array.isArray(noKey.payload.payment.howToPay) &&
        noKey.payload.payment.howToPay.some(s => /备注.*订单号/.test(s)) &&
        noKey.payload.payment.howToPay.some(s => /原路退回/.test(s)),
      noKey.payload && noKey.payload.payment && noKey.payload.payment.howToPay);
    ok('拒绝响应不含任何凭证明文',
      noKey.payload && !/lsk_[0-9a-f]{20,}/.test(JSON.stringify(noKey.payload)));

    const badKey = await solveCall(['x^2=4'], 'lsk_' + 'f'.repeat(48));
    ok('伪凭证 solve → invalid_key', badKey.payload && badKey.payload.reason === 'invalid_key', badKey.payload && badKey.payload.reason);

    const noKeyCredit = await req('GET', '/credit');
    ok('GET /credit 无凭证 → 401', noKeyCredit.status === 401, noKeyCredit.status);

    // ── C. 下单 → 管理员确认到账 → 余额可用 ──
    section('C 下单与到账');
    // 故意提交联系方式与自由文本：本服务承诺「不收集、不存储任何个人信息」（见 privacy.html），
    // 因此这些字段必须被丢弃，且不得出现在账本任何位置。
    const CANARY_MAIL = 'canary-person@example.com';
    const CANARY_PHONE = '13800138000';
    const CANARY_NAME = '张三四';
    const ord = await req('POST', '/pay/order', { body: { contact: CANARY_MAIL + ' / ' + CANARY_PHONE, note: '我叫' + CANARY_NAME } });
    ok('POST /pay/order 201', ord.status === 201, ord.status);
    const orderId = ord.json && ord.json.orderId;
    const apiKey = ord.json && ord.json.apiKey;
    ok('订单返回 orderId 与 apiKey', !!orderId && /^lsk_[0-9a-f]{48}$/.test(String(apiKey)), { orderId: orderId, keyPrefix: apiKey && apiKey.slice(0, 8) });
    ok('订单金额 = 1 次 × 1 分 = 1 分 (¥0.01)（按次付费，固定单价、不预充）',
      ord.json && ord.json.amountCents === 1 && ord.json.amountDisplay === '¥0.01', ord.json && { c: ord.json.amountCents, d: ord.json.amountDisplay });
    ok('订单响应含「key 只出现一次」告示', ord.json && /仅在本响应中出现一次/.test(ord.json.apiKeyNotice || ''));
    ok('订单响应含收款方式（已配置）', ord.json && ord.json.payment && ord.json.payment.configured === true, ord.json && ord.json.payment);
    ok('订单响应给出「带订单号+金额」的直达付款链接',
      ord.json && ord.json.payment && ord.json.payment.payUrl ===
        'https://hongchenlingjing.com/pay/?order=' + orderId + '&amount=1',
      ord.json && ord.json.payment && ord.json.payment.payUrl);
    ok('直达链接的金额即为订单金额（不多不少）',
      ord.json && ord.json.payment && /(?:[?&])amount=1(?:&|$)/.test(String(ord.json.payment.payUrl)));
    ok('付款链接附「备注必须填订单号」提示',
      ord.json && ord.json.payment && String(ord.json.payment.payUrlNotice || '').indexOf(orderId) >= 0);
    ok('付款链接不泄露凭证（不含 apiKey）',
      ord.json && ord.json.payment && String(ord.json.payment.payUrl || '').indexOf(String(ord.json.apiKey)) < 0);

    // 隐私：不建账号、不收个人信息
    ok('订单明确声明「无需账号、不收集个人信息」',
      ord.json && ord.json.privacy && ord.json.privacy.accountRequired === false && ord.json.privacy.personalDataCollected === false,
      ord.json && ord.json.privacy);
    ok('提交的 contact/note 被明确丢弃并回告',
      ord.json && ord.json.privacy && (ord.json.privacy.discardedFields || []).indexOf('contact') >= 0 &&
      (ord.json.privacy.discardedFields || []).indexOf('note') >= 0 && !!ord.json.privacy.discardedNotice,
      ord.json && ord.json.privacy && ord.json.privacy.discardedFields);
    ok('建单响应提示生产接入须走 HTTPS',
      ord.json && /https/.test((ord.json.howToUse || {}).secureEndpointRecommended || ''),
      ord.json && ord.json.howToUse);

    const ledgerRaw1 = JSON.parse(fs.readFileSync(CREDITS, 'utf8'));
    const ledgerText1 = fs.readFileSync(CREDITS, 'utf8');
    ok('账本不存明文 key（只存 SHA-256）',
      Object.keys(ledgerRaw1.keys).every(k => /^[0-9a-f]{64}$/.test(k)) && !ledgerText1.includes(apiKey));
    ok('新 key 初始余额 = 0', Object.values(ledgerRaw1.keys)[0].balanceCents === 0, Object.values(ledgerRaw1.keys)[0].balanceCents);
    ok('🔒 账本里搜不到任何个人信息（邮箱/手机号/姓名 canary 全无）',
      !ledgerText1.includes(CANARY_MAIL) && !ledgerText1.includes(CANARY_PHONE) && !ledgerText1.includes(CANARY_NAME),
      { mail: ledgerText1.includes(CANARY_MAIL), phone: ledgerText1.includes(CANARY_PHONE), name: ledgerText1.includes(CANARY_NAME) });
    ok('账本订单记录不含 contact 字段', ledgerRaw1.orders[orderId].contact === undefined, Object.keys(ledgerRaw1.orders[orderId]));
    ok('账本 key 的 note 只含服务端生成的订单号',
      Object.values(ledgerRaw1.keys)[0].note === '订单 ' + orderId, Object.values(ledgerRaw1.keys)[0].note);

    const zero = await solveCall(['x^2=4'], apiKey);
    ok('余额 0 的 key → insufficient_balance', zero.payload && zero.payload.reason === 'insufficient_balance', zero.payload && zero.payload.reason);
    ok('余额 0 的拒绝响应回传 balanceCents=0 与剩余次数 0',
      zero.payload && zero.payload.balanceCents === 0 && zero.payload.callsRemaining === 0, zero.payload && { b: zero.payload.balanceCents, r: zero.payload.callsRemaining });
    ok('余额不足时也直达付款页（不必再问「去哪付」）',
      zero.payload && zero.payload.payment && zero.payload.payment.paymentPage === 'https://hongchenlingjing.com/pay/' &&
      Array.isArray(zero.payload.payment.howToPay) && zero.payload.payment.howToPay.length >= 4,
      zero.payload && zero.payload.payment);

    const ordQ = await req('GET', '/pay/order?orderId=' + encodeURIComponent(orderId));
    ok('GET /pay/order?orderId= 返回 pending', ordQ.status === 200 && ordQ.json.status === 'pending', ordQ.json);
    ok('订单查询不回传 key', !/(lsk_[0-9a-f]{48})/.test(ordQ.body));

    const adminNoTok = await req('POST', '/admin/order/confirm', { body: { orderId: orderId } });
    ok('管理端点无 token → 403', adminNoTok.status === 403, adminNoTok.status);
    const adminBadTok = await req('POST', '/admin/order/confirm', { headers: { 'X-Admin-Token': ADMIN_TOKEN + 'x' }, body: { orderId: orderId } });
    ok('管理端点错 token → 403', adminBadTok.status === 403, adminBadTok.status);
    // 管理面回环限制：哪怕令牌正确，只要来源看似外部（这里用伪造 X-Forwarded-For 模拟"经反代/来自公网"）
    // 也必须拒绝 —— 否则管理令牌会在公网明文里裸奔。
    const adminRemote = await req('GET', '/admin/ledger', { headers: { 'X-Admin-Token': ADMIN_TOKEN, 'X-Forwarded-For': '203.0.113.7' } });
    ok('管理端点看起来来自外部 → 403 loopback_only（管理令牌绝不走公网）',
      adminRemote.status === 403 && adminRemote.json && adminRemote.json.error && adminRemote.json.error.type === 'loopback_only',
      { status: adminRemote.status, j: adminRemote.json });

    // ── C2. 确认到账必须核对金额（钱路上唯一能防「少付多领」的关口）──
    // 付款页显示的金额来自 URL 参数、客户端可改；所以「该付多少钱」只能在确认这一步核对。
    // 若不核对：下 100 次的单，只转 1 分钱，也能领走 100 次额度。
    section('C2 到账金额核对');
    const noAmt = await req('POST', '/admin/order/confirm', { headers: { 'X-Admin-Token': ADMIN_TOKEN }, body: { orderId: orderId } });
    ok('不传 receivedCents → 拒绝入账 400 amount_not_verified',
      noAmt.status === 400 && noAmt.json && noAmt.json.error && noAmt.json.error.type === 'amount_not_verified',
      { s: noAmt.status, j: noAmt.json && noAmt.json.error });
    ok('拒绝时回告「本单应付多少」（expectedCents / expectedDisplay）',
      noAmt.json && noAmt.json.error && noAmt.json.error.expectedCents === 1 && noAmt.json.error.expectedDisplay === '¥0.01',
      noAmt.json && noAmt.json.error && { c: noAmt.json.error.expectedCents, d: noAmt.json.error.expectedDisplay });
    ok('拒绝时说明「为什么必须核」（amount 参数客户端可改）',
      noAmt.json && noAmt.json.error && /amount/.test(noAmt.json.error.whyItMatters || ''), noAmt.json && noAmt.json.error && noAmt.json.error.whyItMatters);

    const under = await req('POST', '/admin/order/confirm', { headers: { 'X-Admin-Token': ADMIN_TOKEN }, body: { orderId: orderId, receivedCents: 2 } });
    ok('🔒 少付多领被拦：实收 2 分 ≠ 本单 1 分 → 拒绝 409 amount_mismatch',
      under.status === 409 && under.json && under.json.error && under.json.error.type === 'amount_mismatch',
      { s: under.status, j: under.json && under.json.error });
    ok('拒绝时给出两条正确出路（按实收用 /admin/credit，或按整单 acknowledgeUnverified）',
      under.json && under.json.error && Array.isArray(under.json.error.howToProceed) &&
      under.json.error.howToProceed.some(s => /admin\/credit/.test(s)) &&
      under.json.error.howToProceed.some(s => /acknowledgeUnverified/.test(s)),
      under.json && under.json.error && under.json.error.howToProceed);

    const over = await req('POST', '/admin/order/confirm', { headers: { 'X-Admin-Token': ADMIN_TOKEN }, body: { orderId: orderId, receivedCents: 9999 } });
    ok('多付也不放行（金额必须精确相等）→ 409', over.status === 409, over.status);

    const badType = await req('POST', '/admin/order/confirm', { headers: { 'X-Admin-Token': ADMIN_TOKEN }, body: { orderId: orderId, receivedCents: '100' } });
    ok('receivedCents 传字符串 → 409（必须是整数分）', badType.status === 409, badType.status);

    const stillPending = await req('GET', '/pay/order?orderId=' + encodeURIComponent(orderId));
    ok('🔒 三次拒绝之后订单仍是 pending、一分钱额度都没出去',
      stillPending.json && stillPending.json.status === 'pending', stillPending.json && stillPending.json.status);
    const ledgerAfterReject = JSON.parse(fs.readFileSync(CREDITS, 'utf8'));
    ok('🔒 拒绝后该 key 余额仍是 0（没被静默入账）',
      Object.values(ledgerAfterReject.keys)[0].balanceCents === 0, Object.values(ledgerAfterReject.keys)[0].balanceCents);

    const conf = await req('POST', '/admin/order/confirm', { headers: { 'X-Admin-Token': ADMIN_TOKEN }, body: { orderId: orderId, receivedCents: 1, txRef: 'test-tx-001' } });
    ok('金额核对通过 → 确认到账 200', conf.status === 200, conf.status);
    ok('到账 1 分 / 剩余 1 次', conf.json && conf.json.creditedCents === 1 && conf.json.callsRemaining === 1, conf.json);
    ok('响应标明「金额已核对」并复述实收金额', conf.json && conf.json.amountVerified === true && /¥0\.01/.test(conf.json.amountNotice || ''), conf.json);
    const ledgerAfterPaid = JSON.parse(fs.readFileSync(CREDITS, 'utf8'));
    ok('台账记录了 amountVerified 与实收金额（可审计、可对账）',
      ledgerAfterPaid.orders[orderId].amountVerified === true && ledgerAfterPaid.orders[orderId].receivedCents === 1,
      { v: ledgerAfterPaid.orders[orderId].amountVerified, r: ledgerAfterPaid.orders[orderId].receivedCents });
    ok('台账订单记录不含 contact 字段（隐私复核）', ledgerAfterPaid.orders[orderId].contact === undefined);

    const conf2 = await req('POST', '/admin/order/confirm', { headers: { 'X-Admin-Token': ADMIN_TOKEN }, body: { orderId: orderId, receivedCents: 1 } });
    ok('重复确认不重复入账（alreadyPaid）', conf2.json && conf2.json.alreadyPaid === true && conf2.json.balanceCents === 1, conf2.json);

    // 按次付费：每解一次都要先付 1 分。测试为跑通「扣费级联 / 余额耗尽 / 审计归属」，
    // 用管理面 admin/credit 一次性把该 key 补足到 100 分（等效于连下 100 笔 1 分订单，
    // 扣费语义完全一致）。生产上这一步由支付平台回调逐笔完成，不会人工干预。
    const fund = await req('POST', '/admin/credit', { headers: { 'X-Admin-Token': ADMIN_TOKEN }, body: { apiKey: apiKey, cents: 99, reason: '回归级联测试预充（等效逐次下单）' } });
    ok('admin/credit 补足额度至 100 分（供扣费级联测试）', fund.status === 200 && fund.json && fund.json.balanceCents === 100, fund.json);

    // 逃逸舱（acknowledgeUnverified）刻意留到 F 段台账汇总**之后**再测：
    // 它会多建一单、多算一笔营收，放在这里会污染上面那些"精确对账"的断言。
    const ESCAPE_HATCH_TEST = async () => {
      const ordEsc = await req('POST', '/pay/order', { body: {} });
      const esc = await req('POST', '/admin/order/confirm', { headers: { 'X-Admin-Token': ADMIN_TOKEN }, body: { orderId: ordEsc.json.orderId, acknowledgeUnverified: true } });
      ok('显式 acknowledgeUnverified:true → 放行，但标明「未核对」并留凭证要求',
        esc.status === 200 && esc.json && esc.json.amountVerified === false && /未核对/.test(esc.json.amountNotice || ''),
        { s: esc.status, j: esc.json });
      const ledgerAfterEsc = JSON.parse(fs.readFileSync(CREDITS, 'utf8'));
      ok('逃逸入账在台账里被标为未核对（能事后查出哪些单没核金额）',
        ledgerAfterEsc.orders[ordEsc.json.orderId].amountVerified === false);
    };

    const credit1 = await req('GET', '/credit', { headers: { 'Authorization': 'Bearer ' + apiKey } });
    ok('GET /credit 带 key → 余额 100 分 / 100 次',
      credit1.status === 200 && credit1.json.balanceCents === 100 && credit1.json.callsRemaining === 100, credit1.json);
    ok('GET /credit 返回脱敏 key 而非明文', credit1.json && credit1.json.key !== apiKey && /…/.test(credit1.json.key), credit1.json && credit1.json.key);

    // ── D. 扣费语义：成功才扣、失败不扣、逐次扣 ──
    section('D 扣费语义');
    const s1 = await solveCall(['x^2=4'], apiKey);
    ok('带余额 key 求解成功', s1.payload && Array.isArray(s1.payload.solutions) && s1.payload.solutionCount >= 1, s1.payload && s1.payload.summary);
    const credit2 = await req('GET', '/credit', { headers: { 'Authorization': 'Bearer ' + apiKey } });
    ok('成功一次后余额 100 → 99 分', credit2.json.balanceCents === 99, credit2.json.balanceCents);
    ok('成功一次后 calls 计数 = 1 且 spentCents = 1',
      credit2.json.calls === 1 && credit2.json.spentCents === 1, { calls: credit2.json.calls, spent: credit2.json.spentCents });

    const invalid = await solveCall([], apiKey);
    ok('空方程 → invalid_input', invalid.payload && invalid.payload.type === 'invalid_input', invalid.payload);
    const credit3 = await req('GET', '/credit', { headers: { 'Authorization': 'Bearer ' + apiKey } });
    ok('输入不合法不扣费（仍 99 分）', credit3.json.balanceCents === 99, credit3.json.balanceCents);

    // 解析不到任何方程：solver 事实求是回 resultType=empty + diagnostics.inputError='NO_EQUATION'。
    // 这属于「输入问题」而非「服务交付」，因此必须不扣费 —— 否则等于收 1 分钱只换来一句「我解析不了」。
    const unparsed = await solveCall(['hello world'], apiKey);
    ok('无法解析的方程 → resultType=empty 且 diagnostics.inputError=NO_EQUATION',
      unparsed.payload && unparsed.payload.resultType === 1 &&
      unparsed.payload.diagnostics && unparsed.payload.diagnostics.inputError === 'NO_EQUATION',
      unparsed.payload && unparsed.payload.diagnostics);
    const credit3b = await req('GET', '/credit', { headers: { 'Authorization': 'Bearer ' + apiKey } });
    ok('解析失败不扣费（仍 99 分）', credit3b.json.balanceCents === 99, credit3b.json.balanceCents);
    ok('正常求解结果不带 inputError',
      s1.payload && s1.payload.diagnostics && s1.payload.diagnostics.inputError === null,
      s1.payload && s1.payload.diagnostics);

    // 批量 JSON-RPC：一次 HTTP 里 3 个 solve ⇒ 应扣 3 分
    const batchBody = [1, 2, 3].map(i => ({ jsonrpc: '2.0', id: i, method: 'tools/call', params: { name: 'solve', arguments: { equations: ['x^2=4'] } } }));
    const batch = await req('POST', '/mcp', { headers: { 'Authorization': 'Bearer ' + apiKey }, body: batchBody });
    ok('批量请求返回 3 条响应', batch.status === 200 && Array.isArray(batch.json) && batch.json.length === 3, batch.status);
    const credit4 = await req('GET', '/credit', { headers: { 'Authorization': 'Bearer ' + apiKey } });
    ok('批量 3 次各计 1 分（99 → 96）', credit4.json.balanceCents === 96, credit4.json.balanceCents);

    // ?key= 查询参数与 x-api-key 头
    const qk = await req('GET', '/credit?key=' + encodeURIComponent(apiKey));
    ok('?key= 查询参数可取余额（路由已剥离查询串）', qk.status === 200 && qk.json.balanceCents === 96, { s: qk.status, j: qk.json });
    const xk = await solveCall(['x^2=9'], null, { 'x-api-key': apiKey });
    ok('x-api-key 头亦可计费调用', xk.payload && xk.payload.solutionCount >= 1, xk.payload && xk.payload.summary);
    const credit5 = await req('GET', '/credit', { headers: { 'Authorization': 'Bearer ' + apiKey } });
    ok('x-api-key 调用后余额 96 → 95', credit5.json.balanceCents === 95, credit5.json.balanceCents);

    // ── E. 余额耗尽：剩余 95 次全部花光，下一次必须拒绝 ──
    section('E 余额耗尽');
    for (let i = 0; i < 95; i++) await solveCall(['x^2=4'], apiKey);
    const credit6 = await req('GET', '/credit', { headers: { 'Authorization': 'Bearer ' + apiKey } });
    ok('95 次用完余额归零', credit6.json.balanceCents === 0 && credit6.json.callsRemaining === 0, credit6.json);
    ok('累计扣费精确等于 100 分（1+3+1+95，无多扣无漏扣）',
      credit6.json.spentCents === 100 && credit6.json.calls === 100, { spent: credit6.json.spentCents, calls: credit6.json.calls });
    const drained = await solveCall(['x^2=4'], apiKey);
    ok('余额归零后拒绝（insufficient_balance）', drained.payload && drained.payload.reason === 'insufficient_balance', drained.payload && drained.payload.reason);
    ok('被拒请求未把余额扣成负数',
      (await req('GET', '/credit', { headers: { 'Authorization': 'Bearer ' + apiKey } })).json.balanceCents === 0);

    // ── F. 台账与凭证运维 ──
    section('F 台账与凭证运维');
    const lg = await req('GET', '/admin/ledger', { headers: { 'X-Admin-Token': ADMIN_TOKEN } });
    ok('GET /admin/ledger 200', lg.status === 200, lg.status);
    ok('台账汇总：1 个 key、1 张已付订单、订单营收 1 分、累计调用 100 次',
      lg.json && lg.json.summary.keyCount === 1 && lg.json.summary.paidOrderCount === 1 &&
      lg.json.summary.paidRevenueCents === 1 && lg.json.summary.totalCalls === 100,
      lg.json && lg.json.summary);
    ok('台账内 key 一律脱敏', lg.json && lg.json.keys.every(k => /…/.test(k.mask) && /…/.test(k.keyHash)));

    const cred = await req('POST', '/admin/credit', { headers: { 'X-Admin-Token': ADMIN_TOKEN }, body: { apiKey: apiKey, cents: 7, reason: '回归补偿' } });
    ok('POST /admin/credit 手工入账 7 分', cred.status === 200 && cred.json.balanceCents === 7, cred.json);
    const issued = await req('POST', '/admin/credit', { headers: { 'X-Admin-Token': ADMIN_TOKEN }, body: { issueNew: true, cents: 5, reason: '新发测试凭证' } });
    ok('issueNew 新发凭证含 5 分', issued.status === 201 && /^lsk_[0-9a-f]{48}$/.test(String(issued.json.apiKey)), issued.status);
    const issuedKey = issued.json.apiKey;

    const rot = await req('POST', '/admin/rotate', { headers: { 'X-Admin-Token': ADMIN_TOKEN }, body: { apiKey: apiKey } });
    ok('凭证轮换后新 key 继承余额 7 分', rot.status === 200 && rot.json.balanceCents === 7, rot.json);
    const rotKey = rot.json.apiKey;
    ok('旧 key 轮换后立即失效（invalid_key）',
      (await solveCall(['x^2=4'], apiKey)).payload.reason === 'invalid_key');
    ok('新 key 可正常计费调用（7 → 6）',
      (await solveCall(['x^2=4'], rotKey)).payload.solutionCount >= 1 &&
      (await req('GET', '/credit', { headers: { 'Authorization': 'Bearer ' + rotKey } })).json.balanceCents === 6);

    const dis = await req('POST', '/admin/key/disable', { headers: { 'X-Admin-Token': ADMIN_TOKEN }, body: { apiKey: issuedKey, disabled: true } });
    ok('停用凭证 200', dis.status === 200 && dis.json.disabled === true, dis.json);
    ok('已停用凭证 → key_disabled', (await solveCall(['x^2=4'], issuedKey)).payload.reason === 'key_disabled');

    const unk = await req('GET', '/admin/unknown', { headers: { 'X-Admin-Token': ADMIN_TOKEN } });
    ok('未知管理端点 → 404', unk.status === 404, unk.status);

    const o404 = await req('GET', '/pay/order?orderId=LS-19700101-ffffff');
    ok('不存在的订单 → 404', o404.status === 404, o404.status);
    const oBad = await req('POST', '/pay/order', { body: { calls: 0 } });
    ok('calls=0 → 400', oBad.status === 400, oBad.status);
    const oPlan = await req('POST', '/pay/order', { body: { plan: 'standard' } });
    ok('按套餐下单被拒（按次付费不支持套餐）→ 400 no_bundles',
      oPlan.status === 400 && oPlan.json && oPlan.json.error && oPlan.json.error.type === 'no_bundles', oPlan.json);
    const oBadPlan = await req('POST', '/pay/order', { body: { plan: 'nope' } });
    ok('未知套餐同样被拒 → 400 no_bundles', oBadPlan.status === 400 && oBadPlan.json && oBadPlan.json.error && oBadPlan.json.error.type === 'no_bundles', oBadPlan.json);

    // ── G. 审计流水与限速开关 ──
    section('G 审计流水与限速开关');
    const ledRaw = fs.readFileSync(CREDITS + '.ledger.jsonl', 'utf8');
    const led = ledRaw.trim().split('\n').map(s => JSON.parse(s));
    // 精确对账：主 key 上共扣 100 次（1 单次 + 3 批量 + 1 x-api-key + 95 耗尽），
    // 轮换后的新 key 再扣 1 次 ⇒ 合计 101 次，且必须按凭证正确归属（不能张冠李戴）。
    const chargeEvents = led.filter(e => e.event === 'charge');
    const byKey = chargeEvents.reduce((m, e) => { m[e.key] = (m[e.key] || 0) + 1; return m; }, {});
    const counts = Object.values(byKey).sort((a, b) => b - a);
    ok('审计流水 charge 事件共 101 次，且按凭证正确归属（100 + 1）',
      chargeEvents.length === 101 && counts.length === 2 && counts[0] === 100 && counts[1] === 1,
      { n: chargeEvents.length, byKey: byKey });
    ok('审计流水的扣费累计金额 = 101 分',
      chargeEvents.reduce((s, e) => s + e.cents, 0) === 101, chargeEvents.reduce((s, e) => s + e.cents, 0));
    ok('审计流水含订单创建/到账/轮换/停用',
      ['order_created', 'order_paid', 'key_rotated', 'key_disabled'].every(ev => led.some(e => e.event === ev)),
      [...new Set(led.map(e => e.event))]);
    // 脱敏不变量：流水与快照里都不得出现「完整 key」（lsk_ + 48 位十六进制）。
    // 注意掩码形态 lsk_ab12…ef90 本身含 lsk_ 前缀，故判据必须是完整长度，而非裸 lsk_。
    ok('审计流水无完整明文 key（不匹配 lsk_[0-9a-f]{48}）', !/lsk_[0-9a-f]{48}/.test(ledRaw));
    ok('账本快照无完整明文 key', !/lsk_[0-9a-f]{48}/.test(fs.readFileSync(CREDITS, 'utf8')));
    ok('账本文件权限 0600（仅属主可读写）',
      process.platform === 'win32' ? true : ((fs.statSync(CREDITS).mode & 0o777) === 0o600),
      process.platform === 'win32' ? 'win32 跳过' : (fs.statSync(CREDITS).mode & 0o777).toString(8));

    // ── M. 账本可被运维在进程外手工编辑（改动不被静默覆盖 / 坏编辑不清空账本）──
    section('M 账本外部编辑');
    const snapM = JSON.parse(fs.readFileSync(CREDITS, 'utf8'));
    const MARKER = 'f'.repeat(64);
    snapM.keys[MARKER] = {
      mask: 'lsk_marker…0001', balanceCents: 12345, createdAt: new Date().toISOString(),
      lastUsedAt: null, calls: 0, spentCents: 0, disabled: false, note: '运维手工注入的标记'
    };
    fs.writeFileSync(CREDITS, JSON.stringify(snapM, null, 2), { mode: 0o600 });
    const ordM = await req('POST', '/pay/order', { body: {} });
    ok('外部编辑后建单仍成功（不因指纹变化而拒绝服务）', ordM.status === 201, ordM.status);
    const afterM = JSON.parse(fs.readFileSync(CREDITS, 'utf8'));
    ok('🔒 运维手工注入的记录在服务写盘后仍在（没被内存副本静默覆盖）',
      !!afterM.keys[MARKER] && afterM.keys[MARKER].balanceCents === 12345,
      afterM.keys[MARKER] ? afterM.keys[MARKER].balanceCents : 'MISSING');

    fs.writeFileSync(CREDITS, '{ 这不是合法 JSON', { mode: 0o600 });
    const cBad = await req('GET', '/credit', { headers: { 'Authorization': 'Bearer ' + rotKey } });
    ok('账本被写坏时余额仍按内存版本正确返回（坏编辑不清空账本 = 不会拒绝所有付费客户）',
      cBad.status === 200 && cBad.json.balanceCents === 6, { s: cBad.status, j: cBad.json });
    const hBad = await req('GET', '/health');
    ok('账本被写坏后服务仍健康（不崩）', hBad.status === 200 && hBad.json && hBad.json.status === 'ok', hBad.status);
    const ledM = fs.readFileSync(CREDITS + '.ledger.jsonl', 'utf8');
    ok('审计流水记录了「拒绝载入坏账本」',
      /external_reload_rejected/.test(ledM) && /parse_failed/.test(ledM));

    // ── J. 到账金额核对的逃逸舱 ──
    // 位置讲究：必须①在 F 段台账总额断言**之后**（它会多建一单、多算一笔营收），
    //          ②在主测试服务 `child.kill()` **之前**（之后再发请求就是 ECONNREFUSED）。
    section('J 未核对金额的逃逸舱');
    await ESCAPE_HATCH_TEST();

    child.kill();

    // ── H. 计费关闭 + 管理员未配置：两种降级必须都成立 ──
    section('H 降级：计费关闭 / 管理员未配置（另一进程）');
    const TMP2 = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-meter-off-'));
    const child2 = spawn(process.execPath, [SERVER], {
      env: Object.assign({}, process.env, {
        PORT: String(PORT + 1), LS_METERING: 'off', LS_CREDITS_PATH: path.join(TMP2, 'credits.json'),
        LS_FREE_LOOPBACK: '0', LS_RATE_MAX: '100000'
      }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const PORT_SAVED = PORT;
    try {
      // 复用同一套请求函数，临时切端口
      const req2 = mkReq(PORT + 1);
      let ready = false;
      const t0 = Date.now();
      while (Date.now() - t0 < 15000) {
        try { const r = await req2('GET', '/health'); if (r.status === 200) { ready = true; break; } } catch (_e) {}
        await new Promise(r => setTimeout(r, 120));
      }
      ok('计费关闭进程就绪', ready);
      const h2 = await req2('GET', '/health');
      ok('计费关闭时 health.metering = off', h2.json && h2.json.metering === 'off', h2.json && h2.json.metering);
      const s2 = await req2('POST', '/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'solve', arguments: { equations: ['x^2=4'] } } } });
      ok('计费关闭时无凭证也能求解（自建部署者不被强收）',
        s2.json && s2.json.result && s2.json.result.isError !== true, s2.json && s2.json.result);
      const tl2 = await req2('POST', '/mcp', { body: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} } });
      const st2 = tl2.json.result.tools.find(t => t.name === 'solve');
      ok('计费关闭时 solve 描述不含计费说明（与 stdio 版一致）', !/【计费/.test(st2.description));
      const adm2 = await req2('POST', '/admin/order/confirm', { body: { orderId: 'x' } });
      ok('未配置 LS_ADMIN_TOKEN 时管理端点 503（fail-closed，无「空手加钱」口子）', adm2.status === 503, adm2.status);
      const cr2 = await req2('GET', '/credit');
      ok('计费关闭时 /credit 返回免费说明', cr2.status === 200 && cr2.json.metering === 'off', cr2.json);
      const po2 = await req2('POST', '/pay/order', { body: { calls: 10 } });
      ok('计费关闭时下单被明确拒绝并提示无需下单', po2.status === 200 && po2.json.metering === 'off', po2.json);
    } finally {
      child2.kill();
      void PORT_SAVED;
    }

    // ── I. TLS 强制（第三个进程：LS_REQUIRE_TLS=on）──
    section('I 传输加密强制（另一进程）');
    const TMP3 = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-meter-tls-'));
    const child3 = spawn(process.execPath, [SERVER], {
      env: Object.assign({}, process.env, {
        PORT: String(PORT + 2), LS_METERING: 'on', LS_PRICE_CENTS: '1',
        LS_ADMIN_TOKEN: ADMIN_TOKEN, LS_REQUIRE_TLS: 'on', LS_PAY_TO: 'test-payto',
        LS_CREDITS_PATH: path.join(TMP3, 'credits.json'),
        LS_FREE_LOOPBACK: '0', LS_RATE_MAX: '100000'
      }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    try {
      const req3 = mkReq(PORT + 2);
      let ready3 = false;
      const t3 = Date.now();
      while (Date.now() - t3 < 15000) {
        try { const r = await req3('GET', '/health'); if (r.status === 200) { ready3 = true; break; } } catch (_e) {}
        await new Promise(r => setTimeout(r, 120));
      }
      ok('TLS 强制进程就绪', ready3);
      const h3 = await req3('GET', '/health');
      ok('health.requireTls = on', h3.json && h3.json.requireTls === 'on', h3.json && h3.json.requireTls);

      const plainNoKey = await req3('POST', '/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'solve', arguments: { equations: ['x^2=4'] } } } });
      const pnk = plainNoKey.json && plainNoKey.json.result ? JSON.parse(plainNoKey.json.result.content[0].text) : null;
      ok('明文 + 无凭证 → 先报 insecure_transport（先教他用 HTTPS，而不是敷衍"缺凭证"）',
        pnk && pnk.reason === 'insecure_transport', pnk && pnk.reason);

      // 回环发一张凭证（管理面只认回环，故此处可用）
      const ord3 = await req3('POST', '/pay/order', { body: {} });
      const conf3 = await req3('POST', '/admin/order/confirm', { headers: { 'X-Admin-Token': ADMIN_TOKEN }, body: { orderId: ord3.json.orderId, receivedCents: 1 } });
      ok('TLS 进程内建单并到账 1 次（按次付费）', ord3.status === 201 && conf3.status === 200 && conf3.json.creditedCents === 1, conf3.json);
      const key3 = ord3.json.apiKey;

      const plainKey = await req3('POST', '/mcp', { headers: { 'Authorization': 'Bearer ' + key3 }, body: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'solve', arguments: { equations: ['x^2=4'] } } } });
      const pk = plainKey.json && plainKey.json.result ? JSON.parse(plainKey.json.result.content[0].text) : null;
      ok('明文 HTTP + 有效凭证 → 被拒 insecure_transport（凭证不在公网裸奔）', pk && pk.reason === 'insecure_transport', pk && pk.reason);
      ok('被拒后余额未被扣（仍 1 分）',
        (await req3('GET', '/credit', { headers: { 'Authorization': 'Bearer ' + key3 } })).json.balanceCents === 1);

      // 模拟「经 TLS 反代到达」：X-Forwarded-Proto: https + X-Forwarded-For
      const tlsHeaders = { 'Authorization': 'Bearer ' + key3, 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '203.0.113.7' };
      const viaTls = await req3('POST', '/mcp', { headers: tlsHeaders, body: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'solve', arguments: { equations: ['x^2=4'] } } } });
      const vt = viaTls.json && viaTls.json.result ? JSON.parse(viaTls.json.result.content[0].text) : null;
      ok('经 TLS 反代（X-Forwarded-Proto: https）→ 放行并正常求解', vt && vt.solutionCount >= 1, vt && vt.summary);
      ok('TLS 路径下正常扣费（1 → 0 分）',
        (await req3('GET', '/credit', { headers: tlsHeaders })).json.balanceCents === 0);
    } finally {
      child3.kill();
      try { fs.rmSync(TMP3, { recursive: true, force: true }); } catch (_e) {}
    }
  } catch (e) {
    fail++;
    lines.push('');
    lines.push('  ERROR  运行中断：' + ((e && e.stack) || String(e)));
    try { child.kill(); } catch (_e) {}
  } finally {
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_e) {}
  }

  const head = [
    '灵数求解器 · 按次计费（1 分/次）端到端回归',
    '  服务端 : ' + SERVER,
    '  端口   : ' + PORT + ' (+' + (PORT + 1) + ' 降级进程)',
    '  账本   : 临时目录（测试后清理，不碰生产 credits.json）',
    ''
  ].join('\n');
  const tail = ['', '─'.repeat(64), '结果：PASS ' + pass + ' / FAIL ' + fail + ' / 共 ' + (pass + fail)].join('\n');
  console.log(head + lines.join('\n') + tail);
  process.exit(fail === 0 ? 0 : 1);
}

main();
