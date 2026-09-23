#!/usr/bin/env node
/**
 * 灵数求解器 · MCP 远程服务端（HTTP / Streamable HTTP，零依赖）
 *
 * 设计目标：让求解器以「常驻公网服务」形态运行，满足 Smithery / 远程 AI 智能体
 * 对「运行中的服务器网址」的要求。与 mcp-server.js（stdio 版）共享同一套：
 *   - solver-core.js 求解核心（同源，零分叉）
 *   - TOOLS / shapeResult / doSolve 逻辑（复制保持一致，含中文「∈」UTF-8 处理）
 *
 * 协议：Streamable HTTP（MCP 2025-03-26 草案）
 *   - POST /mcp   收发 JSON-RPC 2.0（initialize / tools/list / tools/call）
 *   - GET  /      健康检查（返回服务元信息，便于浏览器/Smithery 探活）
 *   - GET  /health 同上，纯文本 OK
 *
 * 零依赖：仅用 Node 内置 http / fs / path / crypto，无需 npm install。
 *
 * ── 按次计费（2026-09-18 新增）────────────────────────────────────────
 * 本文件额外承载「托管端点按次计费」：每次 solve 成功产出结果扣 1 分钱。
 *   - 开关：LS_METERING=on 才启用（默认 off —— 自建部署者不被强行收费，
 *           开源工具保持诚实；我们自己的托管端点用 systemd Environment 打开）
 *   - 单价：LS_PRICE_CENTS，默认 1（分）
 *   - 凭证：Authorization: Bearer <key>，或 ?key=<key>（x-api-key 亦可）
 *   - 账本：credits.json（0600，原子写）+ credits.json.ledger.jsonl（只增审计流水）
 *   - 只在「成功返回结果」时扣费：输入不合法 / 内部异常 / 余额不足 一律不扣
 *   - 免计费：initialize / tools/list / give_feedback / GET /credit / GET /pricing；
 *             以及来自本机回环且未经代理的请求（自检、定时任务）
 *   - 管理端点需 LS_ADMIN_TOKEN（未设置则管理端点整体 503，fail-closed，
 *     绝不对外暴露「无凭证可加钱」的口子）
 *   - 收款方式 LS_PAY_TO / LS_PAY_CHANNEL：未配置时订单可建但明确标注「不可付款」，
 *     代码不代填任何收款账号（避免伪造收款信息）
 *
 * 计费的强制边界（诚实声明）：只有本托管端点能强制。网页版（单文件静态页）与
 * npx 本地版跑在使用者自己的机器上，无法也不应被拦截 —— 二者永久免费。
 *
 * 运行：
 *   PORT=3000 node http-mcp-server.js
 *   （LINGSHU_HTML 环境变量可重定向 index.html 位置，默认同目录）
 *   LS_METERING=on LS_PRICE_CENTS=1 LS_ADMIN_TOKEN=<随机串> LS_PAY_TO=<收款说明> \
 *     node http-mcp-server.js
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const solverCore = require('./solver-core');
const { solve } = solverCore;

const SERVER_NAME = 'lingshu-solver';
const SERVER_VERSION = '1.0.8';
const PORT = parseInt(process.env.PORT || '3000', 10);

// ---- 护栏常量（防畸形/恶意输入耗尽资源，与 stdio 版一致）----
const MAX_TOTAL_CHARS = 100 * 1024;
const MAX_EQ_COUNT = 64;
const MAX_VAR_COUNT = 6;

// ---- 安全等保加固（2026-09-01）：防 DoS / 限速 / 日志轮转 / 反馈脱敏 ----
// 请求体上限：JSON-RPC 包裹 100KB 方程文本后仍有富余；超限直接 413，防内存耗尽型 DoS
const MAX_BODY_BYTES = 256 * 1024;
// 每 IP 限速：滑动窗口，默认 120 次/分钟（测试可用 LS_RATE_MAX 覆盖）
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = parseInt(process.env.LS_RATE_MAX || '120', 10);
// 会话 TTL：超 1 小时的非 SSE 会话定时清理，防 sessions Map 无限增长
const SESSION_TTL_MS = 60 * 60 * 1000;
// 日志轮转：单文件超 5MB 滚动为 .1，只保留一代，防磁盘写满
const MAX_LOG_BYTES = 5 * 1024 * 1024;

const rateMap = new Map(); // ip -> [timestamps]
function rateAllowed(ip) {
  const now = Date.now();
  let arr = rateMap.get(ip);
  if (!arr) { arr = []; rateMap.set(ip, arr); }
  while (arr.length && arr[0] <= now - RATE_WINDOW_MS) arr.shift();
  if (arr.length >= RATE_MAX) return false;
  arr.push(now);
  if (rateMap.size > 10000) { for (const [k, v] of rateMap) { if (v.length === 0) rateMap.delete(k); } }
  return true;
}

function pruneSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [k, v] of sessions) {
    if (!v.sse && v.createdAt < cutoff) sessions.delete(k);
  }
}

function rotateIfNeeded(p) {
  try { const st = fs.statSync(p); if (st.size > MAX_LOG_BYTES) fs.renameSync(p, p + '.1'); } catch (_e) {}
}

// 敏感信息脱敏（合规：反馈文本落盘前隐去手机号/证件号/邮箱/超长数字串）
function redactSensitive(s) {
  return String(s)
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[已隐去]')
    .replace(/\d{12,}/g, '[已隐去]')
    .replace(/(^|[^0-9])1[3-9]\d{9}([^0-9]|$)/g, '$1[已隐去]$2');
}

// ---- 本地日志（仅元数据，零数据不外传）----
const LOG_PATH = path.resolve(__dirname, 'calls.log');
const FEEDBACK_PATH = path.resolve(__dirname, 'feedback.log');
function appendLog(p) {
  try { rotateIfNeeded(LOG_PATH); fs.appendFileSync(LOG_PATH, JSON.stringify(p) + '\n'); } catch (_e) {}
}

// ============================================================================
// 按次计费（1 分/次）—— 账本、凭证、扣费
// ============================================================================
const METERING_ON = String(process.env.LS_METERING || 'off').trim().toLowerCase() === 'on';
const PRICE_CENTS = Math.max(0, parseInt(process.env.LS_PRICE_CENTS || '1', 10) || 0);
const ADMIN_TOKEN = (process.env.LS_ADMIN_TOKEN || '').trim();
const PAY_TO = (process.env.LS_PAY_TO || '').trim();
const PAY_CHANNEL = (process.env.LS_PAY_CHANNEL || 'manual').trim();
// 付款页地址（可选）。配置后，订单响应会附带带订单号与金额的直达链接，
// 付款页据此才展示收款码（未带有效订单号时不展示，降低收款码被滥用的风险）。
const PAY_PAGE = (process.env.LS_PAY_PAGE || '').trim();
// 对公静态收款码图片地址（可选，推荐）。放咱们自己的 COS / 服务器，不用任何第三方支付平台。
// 配置后，订单 / 付款响应会附上可扫码的对公收款码，付款人直接扫码转账并备注订单号。
// 这正是「我们的方法」：不接支付宝 / 微信 / 工行商户 API，收款入口 = 公司已有的对公账户。
const PAY_TO_QR = (process.env.LS_PAY_TO_QR || '').trim();
// 「灵付 LingPay」：本项目自研的 Agent 支付协议标识（不依赖任何支付平台商户 API）。
// 统一收款入口 = 工银e支付银联聚合码（公司账户，支持支付宝 / 微信 / 银联扫码）。
const LINGPAY_PROTOCOL = 'LingPay/1.0 (corporate-static)';

// ============================================================================
// 安全护栏：收款账号防替换（fail-closed）
// ----------------------------------------------------------------------------
// 把「合法对公收款标识」钉死在代码里（与凭据库 credentials.md 一致）。运行时若
// 环境变量 LS_PAY_TO / LS_PAY_TO_QR 被篡改为别的账号 / 码，端点**拒绝生成任何
// 付款意图**（fail-closed）—— 而不是把错误账号展示给用户去付。这样攻击者即便改了
// 配置文件也收不到钱，最多让收款暂时不可用（「不能收就算了」的安全取舍）。
// 钉死值来自凭据库（2026-09-22 接通的公司对公户与工银e支付银联聚合码解码链接）。
const PINNED_ACCOUNT = '3602026809201658423';                 // 广州市红尘灵境数字科技有限公司 对公基本存款账户
const PINNED_ACCOUNT_NAME = '广州市红尘灵境数字科技有限公司';
// 工银e支付银联聚合码解码链接（qr.95516.com 是银联官方码址，逐字节已回解验证）。
// 生产当前主要靠账户号转账（码为可选）；仅当 LS_PAY_TO_QR 也设了才比对前缀。
const PINNED_QR_PREFIX = 'https://qr.95516.com/';
// 运行时校验：env 给的收款标识必须与钉死的完全一致
const RECEIPT_TAMPERED = !!PAY_TO && PAY_TO !== PINNED_ACCOUNT;          // 账号被换 → 硬失败（fail-closed）
const RECEIPT_QR_WARN = !!PAY_TO_QR && !PAY_TO_QR.startsWith(PINNED_QR_PREFIX); // 码被换到非银联官方址 → 告警（不硬拦，避免误伤 COS 镜像）
function receiptPinHash() {
  return crypto.createHash('sha256').update(PINNED_ACCOUNT + '|' + PINNED_ACCOUNT_NAME + '|' + PINNED_QR_PREFIX, 'utf8').digest('hex');
}
const RECEIPT_PIN_HASH = receiptPinHash(); // 启动期可见的钉死指纹，便于运维肉眼确认未被篡改
const CREDITS_PATH = path.resolve(process.env.LS_CREDITS_PATH || path.join(__dirname, 'credits.json'));
const CREDIT_LEDGER_PATH = CREDITS_PATH + '.ledger.jsonl';
// 自建部署者若不想让自己的回环请求被计费，可关掉（默认开：本机自检/定时任务免费）
const FREE_LOOPBACK = String(process.env.LS_FREE_LOOPBACK || '1') !== '0';
// 是否要求「携带凭证的调用必须走 TLS」（默认 off，便于迁移期直连 :3000 调试）。
// 说明：Bearer 凭证走明文 HTTP＝在公网裸奔，路上任何人都能抓走并花掉余额。
// 迁移到 https://<域名>/mcp 后应置为 on；本机回环请求豁免。
const REQUIRE_TLS = String(process.env.LS_REQUIRE_TLS || 'off').trim().toLowerCase() === 'on';
// 管理面是否只接受本机回环访问（默认 on，fail-closed）。
// 理由：管理令牌一旦走公网明文就等于泄露。运维改走 SSH 隧道
//   ssh -N -L 3000:127.0.0.1:3000 root@<host>   →  curl localhost:3000/admin/...
// 这样管理令牌永远不会经过公网。要放宽（例如放到带 TLS 的反代后面）再置 off。
const ADMIN_LOOPBACK_ONLY = String(process.env.LS_ADMIN_LOOPBACK_ONLY || '1') !== '0';
// 订单创建限速：默认 10 单/小时/IP（防刷单表；与 /mcp 的 120次/分 独立）
const ORDER_WINDOW_MS = 60 * 60 * 1000;
const ORDER_RATE_MAX = parseInt(process.env.LS_ORDER_RATE_MAX || '10', 10);
// 按次计费：固定 1 分钱/次（¥0.01/call）。灵付 LingPay 模式下，下单 = 预购 N 次调用，
// 建议额 = N × ¥0.01；付款人向对公聚合码付任意正金额，按实收折算 N' = 实收/¥0.01 次入账。
const PER_CALL_CENTS = PRICE_CENTS; // 恒为 1
const DEFAULT_ORDER_CALLS = 100;    // 默认预购 100 次（建议 ¥1.00）；可传 calls 调整
const MAX_ORDER_CALLS = 1000000;    // 单次订单上限 100 万次（建议 ¥10000），防刷单
const ORDER_TTL_DAYS = 365;

let ledger = { version: 1, priceCents: PRICE_CENTS, createdAt: new Date().toISOString(), keys: {}, orders: {} };
// 账本文件的 mtime:size 指纹，用于检测「运维在进程外手工改过账本」
let ledgerStamp = null;
// 信任制（honor system）声明计数：调用方「声明已付款」即放行的次数（不验证、不扣余额）。
// 用于衡量「声明付款」vs「真付款」的转化，评估信任制是否真带来收入（与计费账本分离，不进钱账）。
let honorClaims = 0;

function stampOf() {
  try { const st = fs.statSync(CREDITS_PATH); return st.mtimeMs + ':' + st.size; } catch (_e) { return null; }
}

function loadLedger() {
  try {
    const raw = fs.readFileSync(CREDITS_PATH, 'utf8');
    const j = JSON.parse(raw);
    if (j && typeof j === 'object' && j.keys && typeof j.keys === 'object') {
      ledger = Object.assign({ version: 1, keys: {}, orders: {} }, j);
      if (ledger.orders && typeof ledger.orders !== 'object') ledger.orders = {};
    }
  } catch (_e) {
    // 首次运行（无账本）或账本损坏：一律从「空账本」起 —— fail-closed。
    // 无 key 即无余额即拒绝服务，绝不会因读不到账本而放行。
  }
  ledgerStamp = stampOf();
}

// 外部（运维手工）改动检测。
// 账本是内存副本 + 整份写回，若不检测，运维在磁盘上的手工修会被下一次写入**静默覆盖**
// （实测踩过：清理 contact 字段后，服务一有请求就把旧内容写回去了）。
// 因此在任何变更/查看前先比对指纹，被人手改过就重新载入。
// 载入失败时**保留内存版本**并记审计 —— 绝不因一次坏编辑把账本清空（那等于拒绝所有付费客户）。
function refreshLedgerIfChanged() {
  try {
    const cur = stampOf();
    if (cur === ledgerStamp) return false;
    let j = null;
    try { j = JSON.parse(fs.readFileSync(CREDITS_PATH, 'utf8')); } catch (e) {
      ledgerAudit({ event: 'external_reload_rejected', reason: 'parse_failed', err: (e && e.message) || String(e) });
      ledgerStamp = cur;
      return false;
    }
    if (!j || typeof j !== 'object' || !j.keys || typeof j.keys !== 'object') {
      ledgerAudit({ event: 'external_reload_rejected', reason: 'bad_shape' });
      ledgerStamp = cur;
      return false;
    }
    ledger = Object.assign({ version: 1, keys: {}, orders: {} }, j);
    if (!ledger.orders || typeof ledger.orders !== 'object') ledger.orders = {};
    ledgerStamp = cur;
    ledgerAudit({ event: 'external_reload_ok', keyCount: Object.keys(ledger.keys).length, orderCount: Object.keys(ledger.orders).length });
    return true;
  } catch (_e) { return false; }
}

function saveLedger() {
  // 原子写：同目录临时文件 → fsync → rename，避免半截 JSON 让账本不可读
  const tmp = CREDITS_PATH + '.tmp';
  const body = JSON.stringify(ledger, null, 2);
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeSync(fd, body);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, CREDITS_PATH);
  ledgerStamp = stampOf();
}

// 只增审计流水：钱相关的每一次变动都必须留痕，且与快照文件分离
function ledgerAudit(ev) {
  try {
    fs.appendFileSync(CREDIT_LEDGER_PATH, JSON.stringify(Object.assign({ ts: new Date().toISOString() }, ev)) + '\n');
  } catch (_e) {}
}

// 凭证只存 SHA-256，不存明文 —— 账本文件即使泄露也不能直接拿去调用
const hashKey = (k) => crypto.createHash('sha256').update(String(k), 'utf8').digest('hex');
const maskKey = (k) => {
  const s = String(k);
  return s.length <= 14 ? s.slice(0, 4) + '…' : s.slice(0, 8) + '…' + s.slice(-4);
};
const newKey = () => 'lsk_' + crypto.randomBytes(24).toString('hex');
const newOrderId = () => 'LS-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + crypto.randomBytes(3).toString('hex');
const yuan = (cents) => '¥' + (cents / 100).toFixed(2);

function extractKey(req, query) {
  const auth = (req.headers['authorization'] || '').toString();
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (m) return m[1].trim();
  const xa = (req.headers['x-api-key'] || '').toString().trim();
  if (xa) return xa;
  const q = query ? (query.get('key') || '').trim() : '';
  if (q) return q;
  return null;
}

// 「源地址为本机回环，且未经反代」——与计费豁免开关无关的纯粹事实判断。
// 一旦存在 X-Forwarded-For 就绝不认：否则反代会把全世界都伪装成 127.0.0.1。
function isLoopbackSource(req) {
  if ((req.headers['x-forwarded-for'] || '').toString().trim()) return false;
  const ra = String(req.socket.remoteAddress || '');
  return /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/.test(ra);
}

// 计费豁免：可被 LS_FREE_LOOPBACK=0 关掉（测试需要，否则本机用例全被免单）
function isLoopback(req) {
  if (!FREE_LOOPBACK) return false;
  return isLoopbackSource(req);
}

function baseUrl(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'http').toString().split(',')[0].trim() || 'http';
  const host = (req.headers.host || ('localhost:' + PORT)).toString();
  return proto + '://' + host;
}

// 传输是否加密：只看反代声明的 X-Forwarded-Proto。
// 无该头 ⇒ 请求是直连本进程端口（明文 HTTP）⇒ 视为不安全。
function isSecureTransport(req) {
  const p = (req.headers['x-forwarded-proto'] || '').toString().split(',')[0].trim().toLowerCase();
  return p === 'https';
}

function buildCtx(req, query) {
  const key = extractKey(req, query);
  return {
    key: key,
    keyHash: key ? hashKey(key) : null,
    keyMask: key ? maskKey(key) : null,
    isInternal: isLoopback(req),
    secure: isSecureTransport(req)
  };
}

// 免费替代路径 —— 必须写在计费错误里一起返回。
// 不作假墙：本地版与网页版真实存在且永久免费，agent 应被告知，而不是被迫付费。
function freeAlternatives() {
  return [
    '本地版（离线、免费、无次数限制、零数据外传）：npx -y lingshu-solver',
    '网页版（免费）：https://genesis-plan.github.io/lingshu-solver/',
    '源码/自建：https://github.com/genesis-plan/lingshu-solver （自建端点默认不计费）'
  ];
}

function paymentInfo(orderId, amountCents) {
  // 安全护栏：账号被篡改 → fail-closed，绝不向用户展示错误收款账号
  if (RECEIPT_TAMPERED) {
    return {
      channel: PAY_CHANNEL,
      configured: false,
      tampered: true,
      securityAlert: '收款账号与钉死值不符（疑似被篡改），已 fail-closed：不再生成任何付款意图，避免向用户展示错误账号。请检查 LS_PAY_TO 配置。',
      pinnedAccount: PINNED_ACCOUNT,
      pinnedAccountName: PINNED_ACCOUNT_NAME
    };
  }
  if (!PAY_TO) {
    return {
      channel: PAY_CHANNEL,
      configured: false,
      note: '收款方式尚未配置：订单可创建，但在服务端设置 LS_PAY_TO 之前无法完成付款。',
      adminTodo: '在服务端设置 LS_PAY_TO（收款码链接或收款账号说明）与 LS_PAY_CHANNEL，然后重启服务。'
    };
  }
  // 对公静态收款（灵付 LingPay）：不接任何支付平台商户 API，收款入口 = 公司已有的对公账户。
  // 单价 1 分/次是「折算率 / 定价信号」：实际收款为「自愿支持额」（任何正金额都收），按 ¥0.01/次折算调用次数入账。
  const info = {
    channel: PAY_CHANNEL,
    method: 'corporate-static',
    protocol: LINGPAY_PROTOCOL,
    configured: true,
    payTo: PAY_TO,
    payToName: PINNED_ACCOUNT_NAME,
    payToQr: (PAY_TO_QR && PAY_TO_QR.startsWith(PINNED_QR_PREFIX)) ? PAY_TO_QR : (PAY_TO_QR || null),
    receiptVerified: true,           // 账号已与钉死值比对一致，客户端可据此信任
    qrTampered: RECEIPT_QR_WARN || undefined,
    rateNote: '本服务按次计费 ' + yuan(PRICE_CENTS) + '/次。对公静态收款不强制每笔恰收 1 分（银行也不支持 1 分转账），' +
      '实际可付任意「自愿支持额」，我们将按 ' + yuan(PRICE_CENTS) + '/次 折算调用次数入账（收到 ' + yuan(500) + ' 即入账 500 次）。',
    instructions: [
      '1. POST /pay/order 创建订单，响应给出订单号（形如 LS-YYYYMMDD-xxxxxx）与专属 key（key 只出现这一次，请立即保存）',
      '2. 向对公账户（payTo / payToQr）转账任意支持额，务必在付款备注中填写订单号',
      '3. 作者拿对公流水跑 reconcile-bank.js，按「订单号 + 金额」批量入账（按 ' + yuan(PRICE_CENTS) + '/次 折算），通常数日内到账；期间可先用 honorPaid:true 免费调用',
      '4. 之后每次调用带上 Authorization: Bearer <key> 即可'
    ]
  };
  // 带订单号的直达付款链接：只有付款页拿到有效订单号才会展示收款码
  if (PAY_PAGE && orderId) {
    info.payUrl = PAY_PAGE +
      (PAY_PAGE.indexOf('?') >= 0 ? '&' : '?') +
      'order=' + encodeURIComponent(orderId) +
      (amountCents > 0 ? '&amount=' + amountCents : '');
    info.payUrlNotice = '打开此链接按提示付款；付款备注必须填写订单号 ' + orderId + '。';
  }
  return info;
}

/** 当前实际可用的付款通道（灵付 LingPay：仅对公静态收款，不接任何支付平台商户 API） */
function availableChannels() {
  const a = [];
  if (PAY_TO && !RECEIPT_TAMPERED) a.push({ channel: 'corporate-static', mode: 'manual', protocol: LINGPAY_PROTOCOL, label: '对公静态收款（公司账户转账，备注订单号，按 ' + yuan(PRICE_CENTS) + '/次 折算入账，流水批量核对）' });
  return a;
}

// 「灵付 LingPay」：本项目自研的 Agent 支付意图协议（不依赖任何支付平台商户 API）。
// 统一收款入口 = 工银e支付银联聚合码（支持支付宝 / 微信 / 银联扫码），钱落公司对公户。
// 目标：让「带钱包、或被用户授权的 AI Agent」能读懂一个结构化付款意图，自行或代其人类完成付款；
// 收款后由运营方拿对公流水跑 reconcile-bank.js，按订单号 + ¥0.01/次 折算，幂等入账。
function lingpayIntent(orderId, calls, amountCents) {
  const info = paymentInfo(orderId, amountCents);
  return {
    protocol: LINGPAY_PROTOCOL,
    orderId: orderId,
    payTo: info.payTo || null,
    payToQr: info.payToQr || null,
    ratePerCallCents: PRICE_CENTS,
    rateNote: '本服务按次计费 ' + yuan(PRICE_CENTS) + '/次；对公静态收款不强制每笔恰收 1 分，按实收金额折算（建议 ' + yuan(amountCents) + ' ≈ ' + calls + ' 次）。',
    suggestedCalls: calls,
    suggestedAmountCents: amountCents,
    suggestedAmountDisplay: yuan(amountCents),
    memo: orderId,                // 付款备注必须包含订单号，否则无法对账入账
    agentSteps: [
      '1. 向钱包持有者展示 payToQr（或 payTo 账户信息）。',
      '2. 请持有者向该对公聚合码转账任意正金额（建议 ≥ ' + yuan(amountCents) + '）；付款备注 memo 必须含订单号 ' + orderId + '。',
      '3. 持有者付款后，将「订单号 ' + orderId + ' + 实付金额 + 到账日期」回报给服务运营方；运营方跑 reconcile-bank.js 按订单号入账。',
      '4. 入账后（通常数日内）用 apiKey 调 solve 即不再走信任制：Authorization: Bearer <key>。',
      '5. 入账前若急需使用，可暂用 honorPaid:true 免费调用，待入账后余额覆盖。'
    ],
    crediting: '无平台实时回调：运营方按对公流水（订单号匹配）批量入账，按 ' + yuan(PRICE_CENTS) + '/次 折算，幂等（重复流水不重复入账）。',
    honestNote: '这是「静态聚合码 + 流水对账」模式，不是实时 API 扣款；到账 latency 取决于流水导出频率。如需实时自动入账，须接入支付平台商户 API（当前未接，也不强制）。'
  };
}

/**
 * 组装付款信息（灵付 LingPay）。
 * 只有「对公静态收款」一种通道，不接任何支付平台商户 API——无回调、无异步、无平台依赖。
 * 保留回调式签名（cb）仅为兼容 createOrder 的调用点；内部直接同步返回 paymentInfo。
 */
function buildPayment(req, pref, orderId, amountCents, calls, cb) {
  return cb({ payment: paymentInfo(orderId, amountCents) });
}

function paywallError(reason, ctx) {
  const k = (ctx && ctx.keyHash) ? ledger.keys[ctx.keyHash] : null;
  const msgMap = {
    missing_key: '本次请求未携带凭证（缺少 Authorization: Bearer <key>），无法计费。',
    invalid_key: '凭证无效（该 key 不在账本中），无法计费。',
    key_disabled: '该凭证已被停用，无法计费。',
    insufficient_balance: '余额不足，无法本次计费。',
    insecure_transport: '拒绝在明文 HTTP 上处理凭证：Bearer 凭证走明文等于在公网裸奔。请改用 HTTPS 端点调用。'
  };
  const extra = (reason === 'insecure_transport')
    ? { secureEndpointHint: '请把客户端里的端点从 http://... 换成 https://<你的域名>/mcp（X-Forwarded-Proto 必须是 https）。' }
    : { authHeader: 'Authorization: Bearer <key>（亦支持 x-api-key 或 ?key=<key>）' };

  // 付款入口必须直达：调用方撞到「余额不足」时，不应还得再问一次「那我去哪付」。
  // 只列已配置的收款方式；未配置就明说，绝不给出死链。
  const pay = { paymentConfigured: !!PAY_TO };
  if (PAY_TO) {
    if (PAY_PAGE) pay.paymentPage = PAY_PAGE;
    pay.payTo = PAY_TO;
    pay.howToPay = [
      '1. POST /pay/order {"calls":1000} 创建订单 → 响应含 orderId、apiKey，以及付款入口（payment / lingpay）',
      '2. 打开 payUrl 扫码（若配置了收款码）或向对公账户转账任意支持额，备注订单号（账户信息见该页面 / lingpay.payTo）',
      '3. 付款备注必须填写订单号；作者拿对公流水批量对账入账（按 ' + yuan(PRICE_CENTS) + '/次 折算），通常数日内；金额不符的来款一律原路退回',
      '4. 管理员确认到账后余额入账，之后带 Authorization: Bearer <key> 调用即可'
    ];
  } else {
    pay.adminTodo = '服务端未配置 LS_PAY_TO：订单可创建但无法付款，请先在服务端配置收款方式。';
  }

  return Object.assign({
    type: 'payment_required',
    reason: reason,
    message: '灵数远程端点按次计费：每次 solve 收费 ' + PRICE_CENTS + ' 分钱（' + yuan(PRICE_CENTS) + '/次）。' + (msgMap[reason] || ''),
    priceCentsPerCall: PRICE_CENTS,
    currency: 'CNY',
    balanceCents: k ? k.balanceCents : null,
    callsRemaining: k ? Math.floor(k.balanceCents / PRICE_CENTS) : null,
    howToGetKey: [
      'GET  /pricing            查看价格、套餐与付款方式',
      'POST /pay/order          {"calls":1000} 创建订单 → 响应含 orderId 与 apiKey',
      'GET  /credit             携带 key 查询余额（免费）'
    ],
    payment: pay,
    freeAlternatives: freeAlternatives(),
    note: '输入不合法、方程无法解析、内部错误、余额不足均不扣费：仅在成功产出求解结果时才扣 ' + PRICE_CENTS + ' 分钱。'
  }, extra);
}

// 前置校验：只判断「能不能计费」，不改变余额
function meterPreCheck(ctx) {
  if (!METERING_ON) return { ok: true, free: true };
  if (ctx.isInternal) return { ok: true, free: true };   // 本机自检免单
  if (REQUIRE_TLS && !ctx.secure) return { ok: false, err: paywallError('insecure_transport', ctx) };
  if (!ctx.key) return { ok: false, err: paywallError('missing_key', ctx) };
  const k = ledger.keys[ctx.keyHash];
  if (!k) return { ok: false, err: paywallError('invalid_key', ctx) };
  if (k.disabled) return { ok: false, err: paywallError('key_disabled', ctx) };
  if (k.balanceCents < PRICE_CENTS) return { ok: false, err: paywallError('insufficient_balance', ctx) };
  return { ok: true, free: false };
}

// 计费判据：只对「真的执行了数学求解」的结果收费。
// 解析不到任何方程（solver 回 NO_EQUATION，已透出为 diagnostics.inputError）属输入问题、
// 不是服务交付 → 不计费。避免「收 1 分钱只换来一句『我解析不了你的输入』」的差体验。
function isBillable(result) {
  if (!result) return false;
  if (result.diagnostics && result.diagnostics.inputError) return false;
  return true;
}

// 扣费：只在本次调用已成功产出结果后调用（调用方保证）
function meterCharge(ctx) {
  const k = ledger.keys[ctx.keyHash];
  if (!k) return 0;
  k.balanceCents -= PRICE_CENTS;
  k.spentCents = (k.spentCents || 0) + PRICE_CENTS;
  k.calls = (k.calls || 0) + 1;
  k.lastUsedAt = new Date().toISOString();
  try { saveLedger(); } catch (e) {
    // 落盘失败不回滚内存扣减（宁可少收，绝不多收；重启后以磁盘为准）
    ledgerAudit({ event: 'save_failed', key: k.mask, err: (e && e.message) || String(e) });
  }
  ledgerAudit({ event: 'charge', key: k.mask, cents: PRICE_CENTS, balanceCents: k.balanceCents, tool: 'solve' });
  return PRICE_CENTS;
}

// ---- 订单限速（独立于 /mcp 的限速，防刷单表）----
const orderRate = new Map();
function orderAllowed(ip) {
  const now = Date.now();
  let arr = orderRate.get(ip);
  if (!arr) { arr = []; orderRate.set(ip, arr); }
  while (arr.length && arr[0] <= now - ORDER_WINDOW_MS) arr.shift();
  if (arr.length >= ORDER_RATE_MAX) return false;
  arr.push(now);
  if (orderRate.size > 10000) for (const [k, v] of orderRate) { if (v.length === 0) orderRate.delete(k); }
  return true;
}

function pruneOrders() {
  const cutoff = Date.now() - ORDER_TTL_DAYS * 24 * 3600 * 1000;
  let dirty = false;
  for (const [id, o] of Object.entries(ledger.orders || {})) {
    if (!o || !o.createdAt) { delete ledger.orders[id]; dirty = true; continue; }
    const t = Date.parse(o.createdAt);
    if (isFinite(t) && t < cutoff && o.status !== 'pending') { delete ledger.orders[id]; dirty = true; }
  }
  return dirty;
}

function adminGuard(req) {
  // 管理面只接受本机回环（fail-closed）：防止管理令牌经公网明文传输。
  // 注意判据与计费豁免共用 isLoopback（要求「源地址回环 且 无 X-Forwarded-For」），
  // 因此将来若把 /admin 挂到反代后面，会自动被拒 —— 这是刻意的。
  if (ADMIN_LOOPBACK_ONLY && !isLoopbackSource(req)) {
    return {
      ok: false, code: 403, type: 'loopback_only',
      msg: 'admin endpoints are loopback-only (set LS_ADMIN_LOOPBACK_ONLY=off to relax). ' +
           'Use an SSH tunnel: ssh -N -L 3000:127.0.0.1:3000 root@<host>, then curl http://127.0.0.1:3000/admin/...'
    };
  }
  if (!ADMIN_TOKEN) {
    return { ok: false, code: 503, type: 'admin_disabled', msg: 'admin endpoints disabled: set LS_ADMIN_TOKEN on the server' };
  }
  const t = (req.headers['x-admin-token'] || '').toString();
  if (!t) return { ok: false, code: 403, type: 'forbidden', msg: 'forbidden' };
  const a = Buffer.from(t, 'utf8');
  const b = Buffer.from(ADMIN_TOKEN, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, code: 403, type: 'forbidden', msg: 'forbidden' };
  return { ok: true };
}

function readBody(req, cb) {
  let raw = '';
  let n = 0;
  let done = false;
  const finish = (o) => { if (done) return; done = true; cb(o); };
  req.setEncoding('utf8');
  req.on('data', (c) => {
    n += c.length;
    // 超限必须立刻回调，否则 req.destroy() 后 'end' 不再触发 → 响应永不返回（客户端挂死）
    if (n > 64 * 1024) { try { req.destroy(); } catch (_e) {} return finish({ err: 'body_too_large' }); }
    raw += c;
  });
  req.on('end', () => {
    if (!raw.trim()) return finish({ body: {} });
    try { finish({ body: JSON.parse(raw) }); } catch (_e) { finish({ err: 'bad_json' }); }
  });
  req.on('error', () => finish({ err: 'read_error' }));
  req.on('aborted', () => finish({ err: 'aborted' }));
}

function pricingDoc(req) {
  const base = baseUrl(req);
  return {
    product: '灵数求解器 · 托管远程端点',
    server: SERVER_NAME,
    version: SERVER_VERSION,
    endpoint: base + '/mcp',
    metering: METERING_ON ? 'on' : 'off',
    requireTls: REQUIRE_TLS ? 'on' : 'off',
    account: {
      required: false,
      model: '凭证即账号（API key 就是身份，也是余额载体）。不设注册、不设密码、不设用户名。',
      personalDataCollected: false,
      note: '本服务不收集、不存储任何个人信息（姓名/电话/邮箱/微信号等）。服务端只留凭证的 SHA-256、订单与余额元数据，以及调用来源 IP（仅用于防刷与计费对账，不用于用户画像、不向第三方提供）。你在建单时提交的任何联系方式与备注一律丢弃、不落盘。凭证明文仅在建单响应中出现一次，请自行保存；遗失可用订单号联系作者轮换（/admin/rotate）。',
      recovery: '凭证遗失：凭订单号联系作者轮换，新凭证继承余额，旧凭证立即失效。若订单号与凭证明文同时丢失，则无法找回余额——请至少保存订单号。'
    },
    price: {
      centsPerCall: PRICE_CENTS,
      display: yuan(PRICE_CENTS) + ' / 次',
      currency: 'CNY',
      unit: 'per successful solve call',
      billingRule: '仅当 solve 成功产出求解结果时扣费；输入不合法、方程无法解析（响应里 diagnostics.inputError 非空）、内部错误、余额不足，一律不扣费。'
    },
    model: '按次付费：每次 solve 固定收费 ' + PRICE_CENTS + ' 分钱（' + yuan(PRICE_CENTS) + '），不预充、无其他金额、无其他档位。',
    freeTools: ['initialize', 'tools/list', 'give_feedback', 'GET /credit', 'GET /pricing'],
    auth: 'Authorization: Bearer <key>（亦支持 x-api-key 或 ?key=<key>）',
    howToBuy: [
      'POST ' + base + '/pay/order   （预购 N 次：body 可传 {"calls":N}，缺省 ' + DEFAULT_ORDER_CALLS + '；不支持套餐/plan）',
      '响应给出 orderId 与 apiKey（apiKey 只出现一次，请立即保存）',
      'GET  ' + base + '/pay/order?orderId=<id>  查询订单状态',
      'GET  ' + base + '/credit  携带 key 查询余额（免费）'
    ],
    payment: paymentInfo(),
    paymentChannels: availableChannels(),
    autoCredit: {
      enabled: false,
      method: 'corporate-static',
      note: '灵付 LingPay：当前走「对公静态收款 + 银行流水批量对账」（reconcile-bank.js），不接任何支付平台商户 API、无需第三方商户号；按 ' + yuan(PRICE_CENTS) + '/次 折算入账（多付多得）。',
      guardrails: [
        '账号钉死：LS_PAY_TO 与代码钉死的对公账号逐字比对，被篡改即 fail-closed 拒绝生成付款意图（防收款账号被换）',
        '对账：流水按订单号匹配、实收金额按 ' + yuan(PRICE_CENTS) + '/次 折算，少付少得、多付多得',
        '幂等：同一订单重复流水只入账一次',
        'fail-closed：账号被换 / 未配收款 → 绝不「当作已付款」展示错误账号'
      ]
    },
    freeAlternatives: freeAlternatives(),
    honorSystem: {
      enabled: true,
      how: 'solve 入参传 honorPaid:true 即声明「我已付款」并直接放行，无需凭证、不扣余额。',
      why: '零摩擦入口：没有支付通道凭证又想直接用的人也能用。最坏情况＝白嫖（求解边际成本≈0）；有人真去付对公账户那 1 分即净赚。',
      ask: '若你确实想支持，请调用 pay 工具创建订单并通过对公账户付款（备注订单号），让作者真的收到钱；信任制仅作兜底。'
    },
    notes: [
      '单价固定 ' + PRICE_CENTS + ' 分/次，按次付费、不预充、无其他金额、无其他档位：每次 solve 都必须先付 1 分钱。',
      '无需注册账号：凭证（key）即身份，不设用户名、不设密码。',
      '不收集、不存储任何个人信息：服务端只留凭证 SHA-256 与订单/余额元数据，没有你的联系方式。',
      '凭证仅以 SHA-256 存储于服务端账本，不存明文；明文仅在你建单时返回一次，请自行保存。',
      '接入请用 HTTPS：Bearer 凭证走明文 HTTP 会在公网裸奔，路上任何人抓走即可花掉余额。',
      '网页版与 npx 本地版永远免费：托管端点买的是「免安装、常驻、公网可直连、带账单台账」。'
    ]
  };
}

// ---- 求解结果整理（与 stdio 版逐字一致）----
// 数值格式化：固定 6 位小数（产品规格「6位小数有限网格」），与界面一致。
const fmt6 = (v) => (typeof v === 'number' && isFinite(v)) ? v.toFixed(6) : String(v);
// 确定性浮点吸附：消除 IEEE-754 末位 ULP 抖动，保证「同输入输出字节级可复现」
const detF = (v) => (typeof v === 'number' && isFinite(v)) ? Number(v.toFixed(12)) : null;

function shapeResult(r) {
  const sols = Array.isArray(r.solutions) ? r.solutions : [];
  const meta = r.meta || {};
  const varNames = (Array.isArray(r.varNames) && r.varNames.length)
    ? r.varNames
    : (sols[0] && Array.isArray(sols[0].values) ? sols[0].values.map((_, i) => 'x' + (i + 1)) : []);

  let recommended = null, best = Infinity;
  for (const s of sols) {
    if (!s || !Array.isArray(s.values)) continue;
    let d = 0;
    for (const v of s.values) d += v * v;
    if (d < best) { best = d; recommended = s; }
  }
  const tierSet = new Set(sols.map(s => (s && s.tier) || 'unknown'));
  const allProven = sols.length > 0 && [...tierSet].every(t => t === 'proven');
  const typeName = r.resultType === 1 ? 'empty' : r.resultType === 3 ? 'infinite' : 'finite';

  const cleanSols = sols.map((s) => {
    const vals = Array.isArray(s.values) ? s.values : [];
    const text = varNames.map((vn, i) => `${vn}=${fmt6(vals[i])}`).join(', ');
    return {
      values: vals,
      tier: s.tier || 'unknown',
      certified: !!s.certified,
      text: text,
      internals: {
        residual: detF(s.residual),
        certifiedRadius: detF(s.certifiedRadius)
      }
    };
  });
  const recommendedClean = recommended ? cleanSols[sols.indexOf(recommended)] : null;

  let summary;
  if (typeName === 'empty') {
    // 诚实三档（产品「不幻觉」红线）：
    //   NO_EQUATION      → input 无法解析，绝不谎称证明；
    //   provenEmpty=true → 经 sound 算子（结构恒正/恒负等）严格证明无解，可称「严格证明」；
    //   其余空集          → 区间穷尽未找到，但未抬 provenEmpty 标志，只能称「未找到」，不得佯称证明。
    if (r.error === 'NO_EQUATION' || (r.error && /NO_EQUATION|PARSE|UNRECOGNIZED|UNKNOWN/i.test(String(r.error)))) {
      summary = '部分方程无法解析（疑似缺少 "=" 或含不支持的语法），未给出解。求 expr=0 的根可写 "expr=0"，或直接裸写 "expr"。';
    } else if (r.provenEmpty === true) {
      summary = '严格证明：该方程组无实数解。';
    } else {
      summary = '未找到实数解（未经标记严格证明不存在；可缩小定义域或提高预算重试）。';
    }
  } else if (typeName === 'infinite') {
    summary = `无限解集；给出距原点最近的推荐解（共展示 ${sols.length} 个候选）。`;
  } else {
    summary = `找到 ${sols.length} 个实数解${allProven ? '（全部经 Krawczyk 区间认证）' : ''}。`;
  }

  const diagnostics = {
    solverVersion: meta.solverVersion || null,
    truncated: !!(r.truncated || meta.truncated),
    provenEmpty: !!(r.provenEmpty || meta.provenEmpty),
    // 解析失败原因（如 NO_EQUATION）。新增：让调用方能区分「输入不可解析」与「已证明无解」，
    // 并让托管端点的计费层把「解析失败」判为非计费情形（不收「我解析不了」的钱）。
    inputError: r.error || null,
    terminatedBy: meta.terminatedBy || null,
    provenCount: (typeof r.provenCount === 'number') ? r.provenCount : null,
    completeness: detF(r.completeness)
  };

  return {
    resultType: r.resultType,
    resultTypeName: typeName,
    certified: allProven,
    truncated: diagnostics.truncated,
    precisionDecimals: 6,
    solutionCount: sols.length,
    summary: summary,
    recommended: recommendedClean,
    solutions: cleanSols,
    warnings: r.warnings || [],
    diagnostics: diagnostics
  };
}

/**
 * 信任制响应的「代传微请求」块（层 1：利用 Agent 是忠实转发器的特性）。
 * Agent 自己付不了钱也没有良心，但它会把工具返回原样带给背后的人类。
 * 我们借这道返回，把一个结构化、可机读的付费请求塞进去 —— 人类看到就有概率付。
 * 不降级任何数学结果（保真红线），只追加一个 support 块。
 */
function honorSupportBlock() {
  const info = paymentInfo(null, PRICE_CENTS); // 复用同一套收款说明（未配 LS_PAY_TO 时诚实标注未配置）
  const block = {
    mode: 'honor', // 本次经信任制放行，未验证、未扣余额
    note: '本结果经「信任制」放行。若你（或调用你的智能体）将其用于产品或商业/自动化流程，请按下方方式付费支持作者（' +
      yuan(PRICE_CENTS) + '/次）。个人/评估用途可免费继续使用。',
    reciprocity: '你刚免费拿到了一个经 Krawczyk 区间认证的实数解——若它帮到了你，回 1 分是公平的（互惠规范）。',
    identity: '支持一位独立开发者维护这个「离线、无 LLM、可审计」的数学工具，让你成为「让好工具活下去」的人。',
    publicGood: '你的 1 分让这个托管端点继续对所有人免费开放——包括未来那些付不起/不愿付的人。',
    payTo: info.configured ? info.payTo : null,
    payUrl: info.payUrl || null,
    channelConfigured: info.configured,
    payInstruction: info.configured
      ? '付款时备注你的用途即可；我们不做强制验证，靠信任制运转。也可调用本服务的 pay 工具创建正式订单。'
      : '服务端尚未配置 LS_PAY_TO（收款码链接），请联系作者配置后再付款；在此之前请自由使用，或调用 pay 工具预建订单。',
    whyItMatters: '托管端点按次计费是我们唯一的可持续来源；你的一次 1 分付款，能帮助这个确定性离线求解器持续免费对外开放。'
  };
  // 我们的方法（不依赖支付宝 / 微信商户）：对公静态收款 + 银行流水批量对账。
  // 没支付宝、没商户号也能收——用的是公司本就有的对公账户；代码、对账脚本、账本全在咱们自己服务器，可审计、合规（对公、绝不用个人码）。
  block.ourMethod = {
    channel: 'corporate-static',
    how: '调用本服务的 pay 工具创建订单 → 向对公账户转账任意支持额并备注订单号 → 作者跑 reconcile-bank.js 按 ' + yuan(PRICE_CENTS) + '/次 折算入账。',
    why: '1 分/次是折算率与定价信号，不是每笔强收 1 分；你付多少支持额，就按 1 分/次换多少调用次数。',
    honestNote: '对公静态收款无平台实时回调，入账经银行流水批量核对（通常数日内）；在此期间你可用 honorPaid:true 免费调用，等入账后再带 key。'
  };
  return block;
}

function doSolve(args) {
  const eqs = args && args.equations;
  if (!Array.isArray(eqs) || eqs.length === 0) {
    throw { type: 'invalid_input', message: 'equations 必须是非空字符串数组' };
  }
  if (eqs.length > MAX_EQ_COUNT) {
    throw { type: 'invalid_input', message: `方程数量超过上限 ${MAX_EQ_COUNT}` };
  }
  let total = 0;
  for (const e of eqs) {
    if (typeof e !== 'string') throw { type: 'invalid_input', message: '每条方程必须是字符串' };
    total += e.length;
  }
  if (total > MAX_TOTAL_CHARS) {
    throw { type: 'invalid_input', message: '方程文本总长超过 100KB 上限' };
  }
  const vars = (args && Array.isArray(args.variables)) ? args.variables : [];
  if (vars.length > MAX_VAR_COUNT) {
    throw { type: 'invalid_input', message: `变量数量超过上限 ${MAX_VAR_COUNT}` };
  }
  const domain = (args && args.domain) || undefined;
  const fastMode = !!(args && args.fastMode);
  const opts = (args && args.options) || {};
  const r = solve(eqs, vars, 6, domain, fastMode, opts);
  return shapeResult(r);
}

// ---- 工具定义（与 stdio 版一致）----
const TOOLS = [
  {
    name: 'solve',
    description: '求解实数方程组的确定性数值引擎（非大模型，无随机、同输入输出可复现）。适用：需可验证、可复现的实数解（代数或 sin/cos/tan/log/exp/sqrt/abs 等常见超越函数），尤其给 AI Agent 当"不会胡说"的数学后端。' +
      '不适用：纯符号推导/闭式证明、微分方程初值问题、整数/必不等于等强制约束（暂不支持）。' +
      '输入：equations 为含 "=" 的方程字符串数组，如 ["x^2+y^2=25","x+y=7"]；variables 可选（不填自动识别，最多6个）；domain 可选（如 {"x":[-30,30]}），否则默认每变量 ±1e6。' +
      '硬限制：变量 ≤6；方程 1–64 条且数量须 ≥ 变量数；单次方程文本 ≤100KB；输出固定 6 位小数（不可切换）。' +
      '输出（JSON）：resultType=empty(严格证无实数解)/finite(有限已验证解)/infinite(无限解集，仅给距原点最近推荐解)；summary=中文一句话总览；solutions[] 每解含 values[](6位小数数值)、tier(proven=Krawczyk已认证/likely/candidate)、certified、text(人类可读如"x=4.000000, y=3.000000")，残差等内部数值收在 internals 子块(机器可跳过)；certified=是否全proven；recommended=距原点最近解的精简结构。' +
      'truncated=true：预算内未完成全局分支判定、未证明已穷尽——不等于一定漏解，多数情况全部真解已找到；极端病态下可能遗漏个别解，可缩 domain 或提高 budget 重试。' +
      '错误返回 error.type（invalid_input=输入不合法/超限，internal_error=内部异常）。遇卡点或认为结果有误，请调用 give_feedback（内容仅落本地日志，不外传）。相同输入永远返回完全相同结果，可安全缓存与重复调用。' +
      '★ 计费边界（Agent 必读）：honorPaid:true = 你声明本次为「个人/评估用途」，直接放行不扣费；若结果将用于产品或商业/自动化流程，必须走付费通道（GET /pricing 取得订单与 key）——这是对作者唯一的可持续支持，合规的自动化 Agent 应走此路径。',
    inputSchema: {
      type: 'object',
      properties: {
        equations: {
          type: 'array', items: { type: 'string' },
          description: '方程字符串数组，如 ["x^2 + y^2 = 25", "x + y = 7"]。支持 + - * / ^ sqrt log sin cos tan exp abs，以及 in-text 域约束 "x ∈ [-30,30]"。'
        },
        variables: {
          type: 'array', items: { type: 'string' },
          description: '变量名数组（可选）。不填则由方程文本自动识别，顺序按出现。最多 6 个。'
        },
        domain: {
          type: 'object',
          description: '显式搜索域（可选）。形如 {"x":[-30,30],"y":[-30,30]}。对"有限解·部分"演示或快增长函数（exp/sinh）建议显式给定，否则默认 ±1e6 可能剪枝失效并触发 truncated。'
        },
        fastMode: { type: 'boolean', description: '快速模式（默认 false）' },
        honorPaid: { type: 'boolean', description: '信任制：声明本次为「个人/评估用途」即放行（不验证、不扣余额）。适合个人/评估用途；若结果将用于产品/商业/自动化流程，请改走付费通道（GET /pricing 取得订单与 key）以支持作者——合规的自动化 Agent 应走此路径。' },
        options: { type: 'object', description: '高级选项（可选），如 {budget:500000, maxDepth:28}' }
      },
      required: ['equations']
    }
  },
  {
    name: 'give_feedback',
    description: 'AI 智能体在调用 solve 遇到卡点、错误、或认为结果有问题时，主动回报。' +
      '回报内容仅落本地 feedback.log，不会外传。帮助作者持续改进。',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: '反馈内容：遇到了什么、期望什么、实际得到什么。' },
        context: { type: 'string', description: '可选上下文：触发场景、输入特征等。' }
      },
      required: ['message']
    }
  },
  {
    name: 'pay',
    description: '灵付 LingPay：为本次/后续求解创建一笔真实付费订单（' + yuan(PRICE_CENTS) + '/次），返回订单号、专属 key 与结构化付款意图（lingpay）。' +
      '统一收款入口 = 工银e支付银联聚合码（支持支付宝/微信/银联扫码），钱落公司对公户，不接任何支付平台商户 API。' +
      '适合「想真正付费支持作者」的个人，或带钱包/被用户授权的合规 AI Agent：一次调用拿到订单号与对公收款方式，' +
      '向对公聚合码转任意「自愿支持额」并备注订单号，运营方跑 reconcile-bank.js 按 ' + yuan(PRICE_CENTS) + '/次 折算入账；付款后凭 key 调 solve 即不再走信任制。' +
      '若服务端未配置收款方式（LS_PAY_TO 为空），订单仍可创建但 lingpay.payTo 为 null，此时请改用 honorPaid:true 或联系作者。',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: '付款通道：当前固定为 corporate-static（对公静态收款，灵付 LingPay）；留空即可。' },
        calls: { type: 'number', description: '预购调用次数（默认 ' + DEFAULT_ORDER_CALLS + '，上限 ' + MAX_ORDER_CALLS + '）。建议额 = calls × ' + yuan(PRICE_CENTS) + '；实际付多少按实收折算次数。' }
      },
      required: []
    }
  }
];

// 【与 stdio 版唯一的刻意差异】本文件是「托管远程端点」，按次计费，故在 solve 的
// 描述尾部追加计费说明，让 agent 在调用前就知道价格与免费替代路径。
// 注意：这只是「分发形态」元信息，shapeResult / doSolve / 输入校验仍与 stdio 版逐字零分叉。
const PRICING_NOTE = '【计费·仅托管远程端点】本端点每次 solve 收费 ' + PRICE_CENTS + ' 分钱（' + yuan(PRICE_CENTS) + '/次），' +
  '需在请求头携带 Authorization: Bearer <key>；尚无凭证时请先 GET /pricing 获取套餐与付款方式（无需注册账号，凭证即身份）。' +
  '信任制：solve 入参传 honorPaid:true 即声明「个人/评估用途」并直接放行（不验证、不扣余额）。' +
  '若结果用于产品/商业/自动化流程，请走付费通道（GET /pricing 取得订单，通过对公账户付款支持作者）支持作者——合规的自动化 Agent 应走此路径；个人/评估用途可免费继续。' +
  '托管端点收款走公司「对公静态收款 + 银行流水对账」，不接任何支付平台商户 API：下单 → 对公转账备注订单号 → 作者批量入账（按 ' + yuan(PRICE_CENTS) + '/次 折算）。' +
  '本地版（npx -y lingshu-solver）与网页版永久免费、无次数限制、离线不外传 —— 若不便付费请直接用它们。' +
  '免费调用：initialize / tools/list / give_feedback / GET /credit。';

const TOOLS_PUBLIC = METERING_ON
  ? TOOLS.map(t => t.name === 'solve' ? Object.assign({}, t, { description: t.description + PRICING_NOTE }) : t)
  : TOOLS;

// ---- JSON-RPC 处理（与 stdio 版 handle 同构，改为返回对象）----
function handleRpc(msg, ip, ctx) {
  ctx = ctx || { key: null, keyHash: null, keyMask: null, isInternal: true };
  const id = msg.id;
  const method = msg.method;
  const params = msg.params || {};

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
      }
    };
  }
  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: TOOLS_PUBLIC } };
  }
  if (method === 'tools/call') {
    const name = params.name;
    const args = params.arguments || {};
    const t0 = Date.now();
    let chargedCents = 0;
    let freeCall = true;
    let honorClaimed = false;
    try {
      let result;
      if (name === 'solve') {
        // ── 信任制（honor system）：调用方声明「我已付款」即放行，不验证、不扣余额。
        // 设计取舍（用户决策）：没有支付通道凭证、又想直接用的人，给一个零摩擦入口。
        // 最坏情况＝白嫖（求解是确定性离线计算，边际成本≈0，不亏）；最好情况＝有人真去
        // 付静态收款码那 1 分。转化靠 calls.log 里的 honorClaimed 计数衡量。
        const honor = !!(args && args.honorPaid === true);
        if (honor) {
          result = doSolve(args);
          result.support = honorSupportBlock();   // 层1：代传微请求，借 Agent「忠实转发器」特性触达付款人
          freeCall = true;
          honorClaimed = true;
          honorClaims++;
        } else {
          // 计费（先查后扣，全程同步：solve 是同步函数，Node 单线程 ⇒ 查与扣之间不可能被插入并发）
          const meter = meterPreCheck(ctx);
          if (!meter.ok) throw meter.err;          // 落到下方 catch → isError，不扣费
          freeCall = !!meter.free;
          result = doSolve(args);
          // 只有成功产出结果、且不是「解析失败」才扣
          chargedCents = (meter.free || !isBillable(result)) ? 0 : meterCharge(ctx);
        }
      } else if (name === 'give_feedback') {
        const msg_fb = redactSensitive((args.message || '').toString().slice(0, 2000));
        const ctx_fb = args.context ? redactSensitive(String(args.context)).slice(0, 2000) : null;
        rotateIfNeeded(FEEDBACK_PATH);
        fs.appendFileSync(FEEDBACK_PATH, JSON.stringify({
          ts: new Date().toISOString(), message: msg_fb, context: ctx_fb
        }) + '\n');
        result = { acknowledged: true, note: '反馈已记录（本地，不外传；敏感信息已自动隐去）' };
      } else if (name === 'pay') {
        // 真实付费路径（与信任制并列）：给「想真付」的人/合规 Agent 一次调用拿到付款入口。
        if (!METERING_ON) {
          result = { note: '本端点未启用计费，无需付款；直接调用 solve 即可。', freeAlternatives: freeAlternatives() };
        } else {
          const o = createOrder(ip, args || {});
          if (o.error) throw o.error.error;   // 转成 isError（如通道不可用）
          result = {
            orderId: o.orderId,
            apiKey: o.key,
            apiKeyNotice: '此 key 仅在本响应出现一次，请立即保存；付款后凭它调用 solve 即不再走信任制。',
            amountCents: o.amountCents,
            amountDisplay: yuan(o.amountCents),
            payable: !!(o.payment && (o.payment.configured || o.payment.payUrl || o.payment.codeUrl || o.payment.mode === 'auto')),
            payment: o.payment,
            howToUse: {
              endpoint: 'POST /mcp',
              header: 'Authorization: Bearer ' + o.key,
              note: '付款后凭此 key 调用 solve 即不再走信任制（也不需 honorPaid）。'
            },
            note: '这是一笔真实付费订单（' + yuan(PRICE_CENTS) + '/次，共 ' + o.calls + ' 次）。若 payment 为 null 或 payable=false（服务端未配收款方式），请改用 honorPaid:true 或联系作者。',
            lingpay: lingpayIntent(o.orderId, o.calls, o.amountCents)
          };
        }
      } else {
        throw { type: 'unknown_tool', message: '未知工具: ' + name };
      }
      const dt = Date.now() - t0;
      appendLog({
        ts: new Date().toISOString(), ip: ip, tool: name, status: 'ok',
        dtMs: dt, resultType: result.resultType, nSol: result.solutionCount,
        truncated: result.truncated,
        key: ctx.keyMask, chargedCents: chargedCents, freeCall: freeCall, honorClaimed: honorClaimed
      });
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } };
    } catch (e) {
      const dt = Date.now() - t0;
      const errObj = (e && e.type) ? e : { type: 'internal_error', message: (e && e.message) || String(e) };
      appendLog({
        ts: new Date().toISOString(), ip: ip, tool: name, status: 'error',
        dtMs: dt, errorType: errObj.type, reason: errObj.reason || null,
        key: ctx.keyMask, chargedCents: 0
      });
      return {
        jsonrpc: '2.0', id,
        result: { content: [{ type: 'text', text: JSON.stringify(errObj, null, 2) }], isError: true }
      };
    }
  }
  // 通知类（无 id）或其它方法：返回 null（HTTP 下以 202/空体处理）
  return null;
}

// ============================================================================
// 入账（唯一入口）—— 自动回调 / 人工确认 都走这里，保证幂等与同一套审计
// ============================================================================
/**
 * 给订单入账。返回值恒为对象。
 *   成功：{ ok:true, credited:bool, alreadyPaid:bool, orderId, keyMask, creditedCents, balanceCents, callsRemaining }
 *   失败：{ ok:false, reason:'order_not_found'|'amount_mismatch'|'amount_not_verified'|'key_missing', … }
 *
 * 调用方**必须**已独立确认「这条到账是真的」（回调验签 / 人工核对流水），本函数不负责鉴真。
 * 幂等：status 已是 paid 则直接返回，绝不重复加余额。
 */
function creditOrder(orderId, opt) {
  const o = ledger.orders[orderId];
  if (!o) return { ok: false, reason: 'order_not_found', orderId: orderId };
  const kp = ledger.keys[o.keyHash];
  const o2 = opt || {};
  const paidAmount = o.calls * PRICE_CENTS;
  // 折算入账：对公静态收款时，实收「自愿支持额」可能 ≠ 订单面值（1 分），
  // 我们按实收金额逐分折算调用次数入账（1 分=1 次），而非只入订单面值的 1 分。
  const creditedCents = (o2.expectExactAmount === false && Number.isInteger(o2.receivedCents) && o2.receivedCents > 0)
    ? o2.receivedCents
    : paidAmount;
  const done = (credited, already) => ({
    ok: true, credited: credited, alreadyPaid: !!already, orderId: orderId,
    keyMask: kp ? kp.mask : null, creditedCents: credited ? creditedCents : 0,
    balanceCents: kp ? kp.balanceCents : null,
    callsRemaining: kp ? Math.floor(kp.balanceCents / PRICE_CENTS) : null
  });

  if (o.status === 'paid') return done(false, true);

  // ── 金额核对（fail-closed）：自动通道防「少付多领」的**唯一**关口 ─────────────
  // 验签只证明「这条通知确实来自支付平台」，**不证明金额对**；
  // 平台也允许用户改付款金额（或攻击者拿一份合法签名塞 1 分钱），所以必须逐分比对。
  if (o2.expectExactAmount !== false) {
    // 「没传」与「传了但非法」必须分开：前者是 400 缺少核对，后者是 409 金额不符。
    if (o2.receivedCents === undefined || o2.receivedCents === null) {
      return { ok: false, reason: 'amount_not_verified', orderId: orderId, expectedCents: paidAmount, expectedDisplay: yuan(paidAmount) };
    }
    if (!Number.isInteger(o2.receivedCents) || o2.receivedCents !== paidAmount) {
      const badType = !Number.isInteger(o2.receivedCents);
      // 只有来自支付平台回调的「金额不符」才改订单状态留痕；
      // 人工确认时输错金额属操作失误，订单必须保持 pending 以便重试。
      if (o2.markMismatch === true) {
        o.status = 'amount_mismatch';
        o.lastNotifyAt = new Date().toISOString();
        o.receivedCents = o2.receivedCents;
        o.channel = o2.channel || o.channel;
        saveLedger();
      }
      ledgerAudit({ event: 'order_amount_mismatch', orderId: orderId, key: kp ? kp.mask : null,
        expectedCents: paidAmount, receivedCents: badType ? null : o2.receivedCents,
        channel: o2.channel || null, source: o2.source || null, marked: o2.markMismatch === true });
      appendLog({ ts: new Date().toISOString(), event: 'order_amount_mismatch', orderId: orderId,
        expectedCents: paidAmount, receivedCents: badType ? null : o2.receivedCents, channel: o2.channel || null });
      return { ok: false, reason: 'amount_mismatch', orderId: orderId,
        expectedCents: paidAmount, expectedDisplay: yuan(paidAmount),
        receivedCents: badType ? null : o2.receivedCents,
        receivedDisplay: badType ? null : yuan(o2.receivedCents),
        outOfRange: badType ? 'receivedCents 必须是整数（单位：分）' : null };
    }
  }

  if (!kp) return { ok: false, reason: 'key_missing', orderId: orderId };

  kp.balanceCents += creditedCents;
  o.status = 'paid';
  o.paidAt = new Date().toISOString();
  o.channel = o2.channel || o.channel || PAY_CHANNEL;
  o.txRef = o2.txRef || o.txRef || null;
  o.amountVerified = (o2.expectExactAmount !== false);   // 是否由服务端核对过实收金额
  o.creditedBy = o2.source || 'manual';                  // reconcile（对公流水批量对账）/ admin / honor
  o.creditedCents = creditedCents;
  if (Number.isInteger(o2.receivedCents)) o.receivedCents = o2.receivedCents;
  saveLedger();
  ledgerAudit({ event: 'order_paid', orderId: orderId, key: kp.mask, cents: creditedCents, channel: o.channel,
    txRef: o.txRef, amountVerified: o.amountVerified, receivedCents: o.receivedCents || null, source: o.creditedBy });
  appendLog({ ts: new Date().toISOString(), event: 'order_paid', orderId: orderId, channel: o.channel,
    cents: paidAmount, source: o.creditedBy });
  return done(true, false);
}

// ---- 建单逻辑（被 /pay/order 路由与 MCP `pay` 工具共用，零分叉）----
// 返回 { orderId, key, calls, amountCents, payment, discarded } 或 { error:{status,error} }
function createOrder(ip, body) {
  // 灵付 LingPay：按次计费 ¥0.01/次；下单即预购 N 次（建议额 N×¥0.01）。
  // 付款人可付任意正金额，reconcile-bank.js 按实收折算 N'=实收/¥0.01 次入账（多付多得、少付少得）。
  if (body && body.plan !== undefined) {
    return { error: { status: 400, error: { type: 'no_bundles', message: '本服务按次付费（¥0.01/次），不支持套餐/订阅；下单即预购 N 次调用，传 calls=N 即可（缺省 ' + DEFAULT_ORDER_CALLS + '）。' } } };
  }
  let calls = Number((body && body.calls));
  if (!Number.isFinite(calls) || calls < 1) calls = DEFAULT_ORDER_CALLS;
  calls = Math.floor(calls);
  if (calls > MAX_ORDER_CALLS) calls = MAX_ORDER_CALLS;
  const amountCents = calls * PRICE_CENTS;
  const orderId = newOrderId();
  const key = newKey();
  const keyHash = hashKey(key);
  const nowIso = new Date().toISOString();
  // ── 隐私红线（与 privacy.html 的公开承诺一致）──────────────────────
  // 本服务「不设账号、不收集不存储任何个人信息」。因此建单**只**落：
  //   订单号、凭证 SHA-256、次数、金额、状态、时间戳、来源 IP（元数据）。
  // 明确**不落**：姓名/电话/邮箱/微信号等联系方式，以及任何客户端提交的自由文本。
  const discarded = [];
  if (body.contact !== undefined) discarded.push('contact');
  if (body.note !== undefined) discarded.push('note');
  ledger.keys[keyHash] = {
    mask: maskKey(key), balanceCents: 0, createdAt: nowIso, lastUsedAt: null,
    calls: 0, spentCents: 0, disabled: false,
    note: '订单 ' + orderId          // 仅服务端生成的订单号，绝不写入客户端自由文本
  };
  ledger.orders[orderId] = {
    keyHash: keyHash, calls: calls, amountCents: amountCents,
    status: 'pending', createdAt: nowIso, paidAt: null, channel: null, txRef: null,
    ip: ip                            // 与 nginx 日志同类的最小元数据，已在 privacy.html 披露
  };
  pruneOrders();
  try { saveLedger(); } catch (e) {
    delete ledger.keys[keyHash]; delete ledger.orders[orderId];
    return { error: { status: 500, error: { type: 'internal_error', message: '账本写入失败，订单未创建：' + ((e && e.message) || String(e)) } } };
  }
  ledgerAudit({ event: 'order_created', orderId: orderId, key: maskKey(key), calls: calls, amountCents: amountCents, ip: ip });
  appendLog({ ts: nowIso, ip: ip, event: 'order_created', orderId: orderId, calls: calls, amountCents: amountCents });
  // 灵付 LingPay：统一收款入口 = 对公静态聚合码（不接任何支付平台商户 API）
  const payment = paymentInfo(orderId, amountCents);
  if (payment.error) return { error: { status: 400, error: payment.error } };
  return { orderId, key, calls, amountCents, payment, discarded };
}

// ---- HTTP 服务 ----
const sessions = new Map(); // sessionId -> { createdAt, sse? }

// CORS：浏览器端 MCP 客户端（含 Smithery 连接测试）需此头，否则被静默拦截
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Authorization',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, Content-Type'
};

function sendJson(res, status, obj, extraHeaders) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length
  }, CORS, extraHeaders || {}));
  res.end(body);
}

const server = http.createServer((req, res) => {
  // CORS 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  // 路径解析：必须剥离查询串（原先拿 req.url 整串比对，带 ?key=<key> 会掉到 404）
  let pathname = '/';
  let query = new URLSearchParams('');
  try {
    const u = new URL(req.url || '/', 'http://placeholder.invalid');
    pathname = u.pathname;
    query = u.searchParams;
  } catch (_e) { /* 非法 URL 视为根路径 */ }
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').toString().split(',')[0].trim();
  const ctx = buildCtx(req, query);
  // 单一同步点：每个请求入口先对一次磁盘指纹。
  // 运维在进程外手工改过账本就重新载入 —— 否则内存副本会在下次写入时把手工修静默覆盖。
  refreshLedgerIfChanged();

  // 健康检查（含计费状态：便于外部一条 curl 自证收费墙是否真的开着）
  if (req.method === 'GET' && (pathname === '/' || pathname === '/health')) {
    // solverVersion 从已加载的求解沙箱实时读取，保证 /health 报告的版本与实际核心一致（不靠手写常量，杜绝假版本）
    let solverVersion = null;
    try { solverVersion = solverCore.raw().SOLVER_VERSION || null; } catch (_e) { /* index.html 未就绪时降级为 null */ }
    return sendJson(res, 200, {
      name: SERVER_NAME,
      version: SERVER_VERSION,
      solverVersion,
      status: 'ok',
      transport: 'streamable-http',
      metering: METERING_ON ? 'on' : 'off',
      priceCentsPerCall: METERING_ON ? PRICE_CENTS : 0,
      requireTls: REQUIRE_TLS ? 'on' : 'off',
      // 到账是否已自动化：灵付 LingPay 走对账批量入账（false = 非实时 API 自动入账）
      autoCredit: false,
      receiptVerified: !RECEIPT_TAMPERED,
      receiptTampered: RECEIPT_TAMPERED || undefined,
      honorClaims: honorClaims,
      accountRequired: false,
      endpoints: {
        mcp: 'POST /mcp (SSE via GET /mcp)',
        health: 'GET /health',
        pricing: 'GET /pricing',
        order: 'POST /pay/order',
        credit: 'GET /credit'
      },
      tools: TOOLS.map(t => t.name)
    });
  }

  // ---- GET /pricing：公开价格表（无需凭证）----
  if (req.method === 'GET' && pathname === '/pricing') {
    return sendJson(res, 200, pricingDoc(req));
  }

  // ---- GET /credit：查询余额（免费；仅读自己的 key）----
  if (req.method === 'GET' && pathname === '/credit') {
    if (!METERING_ON) {
      return sendJson(res, 200, { metering: 'off', note: '本端点未启用计费，调用免费。', freeAlternatives: freeAlternatives() });
    }
    if (!ctx.key) {
      return sendJson(res, 401, { error: { type: 'missing_key', message: '缺少凭证：请带 Authorization: Bearer <key> 或 ?key=<key>。', howToGetKey: paywallError('missing_key', ctx).howToGetKey } });
    }
    const k = ledger.keys[ctx.keyHash];
    if (!k) {
      return sendJson(res, 401, { error: { type: 'invalid_key', message: '凭证无效（该 key 不在账本中）。' } });
    }
    return sendJson(res, 200, {
      key: k.mask,
      balanceCents: k.balanceCents,
      balanceDisplay: yuan(k.balanceCents),
      callsRemaining: Math.floor(k.balanceCents / PRICE_CENTS),
      priceCentsPerCall: PRICE_CENTS,
      calls: k.calls || 0,
      spentCents: k.spentCents || 0,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt || null,
      disabled: !!k.disabled
    });
  }

  // ---- POST /pay/order：创建订单并发凭证（无需凭证，但限速；防刷单表）----
  if (req.method === 'POST' && pathname === '/pay/order') {
    if (!METERING_ON) {
      return sendJson(res, 200, { metering: 'off', note: '本端点未启用计费，无需下单；直接调用即可。', freeAlternatives: freeAlternatives() });
    }
    if (!orderAllowed(ip)) {
      appendLog({ ts: new Date().toISOString(), ip: ip, event: 'order_rate_limited' });
      return sendJson(res, 429, { error: { type: 'rate_limited', message: '下单过于频繁（' + ORDER_RATE_MAX + ' 单/小时）。' } });
    }
    return readBody(req, ({ body, err }) => {
      if (err === 'body_too_large') return sendJson(res, 413, { error: { type: 'body_too_large', message: '请求体过大（64KB 上限）。' } });
      if (err) return sendJson(res, 400, { error: { type: 'bad_json', message: '请求体不是合法 JSON。' } });
      const r = createOrder(ip, body);
      if (r.error) return sendJson(res, r.error.status, { error: r.error.error });
      const { orderId, key, payment, discarded } = r;
      return sendJson(res, 201, {
        orderId: orderId,
        apiKey: key,
        apiKeyNotice: '此 key 仅在本响应中出现一次（服务端只存 SHA-256），请立即保存。若遗失，可用订单号联系作者重置。',
        calls: r.calls,
        amountCents: r.amountCents,
        amountDisplay: yuan(r.amountCents),
        priceCentsPerCall: PRICE_CENTS,
        status: 'pending',
        payable: !!(payment && (payment.configured || payment.payUrl || payment.codeUrl || payment.mode === 'auto')),
        payment: payment,
        paymentChannels: availableChannels(),
        lingpay: lingpayIntent(orderId, r.calls, r.amountCents),
        privacy: {
          accountRequired: false,
          personalDataCollected: false,
          note: '无需注册账号：此 key 即身份（凭证即账号）。本服务不收集、不存储任何个人信息（姓名/电话/邮箱/微信号等），服务端只留凭证的 SHA-256 与账目元数据；明文凭证仅在本响应出现一次，请自行保存。',
          contactPolicy: '如需与我们联系，请自行保存上面的订单号——系统里没有你的联系方式，我们无法主动联系你。',
          discardedFields: discarded,
          discardedNotice: discarded.length
            ? ('你提交的 ' + discarded.join('、') + ' 字段已被丢弃，未被存储（本服务不收集个人信息）。')
            : null
        },
        howToUse: {
          endpoint: baseUrl(req) + '/mcp',
          secureEndpointRecommended: '生产接入请用 https://<域名>/mcp —— Bearer 凭证走明文 HTTP 会在公网裸奔。',
          header: 'Authorization: Bearer ' + key,
          verifyBalance: 'GET ' + baseUrl(req) + '/credit'
        }
      });
    });
  }

  // ---- GET /pay/order?orderId=：查订单状态（不返回 key，避免凭订单号取走凭证）----
  if (req.method === 'GET' && pathname === '/pay/order') {
    const orderId = (query.get('orderId') || '').trim();
    if (!orderId) return sendJson(res, 400, { error: { type: 'missing_orderId', message: '缺少 orderId 查询参数。' } });
    const o = ledger.orders[orderId];
    if (!o) return sendJson(res, 404, { error: { type: 'order_not_found', message: '订单不存在：' + orderId } });
    return sendJson(res, 200, {
      orderId: orderId, calls: o.calls, amountCents: o.amountCents, amountDisplay: yuan(o.amountCents),
      status: o.status, createdAt: o.createdAt, paidAt: o.paidAt || null,
      payment: paymentInfo(orderId, o.amountCents),
      lingpay: lingpayIntent(orderId, o.calls, o.amountCents)
    });
  }

  // ---- 管理端点（必须带 X-Admin-Token；未配置 LS_ADMIN_TOKEN 时整体 503，fail-closed）----
  if (pathname.indexOf('/admin/') === 0) {
    const g = adminGuard(req);
    if (!g.ok) return sendJson(res, g.code, { error: { type: g.type || 'forbidden', message: g.msg } });

    // POST /admin/order/confirm：确认到账 → 给该订单的 key 入账
    if (req.method === 'POST' && pathname === '/admin/order/confirm') {
      return readBody(req, ({ body, err }) => {
        if (err) return sendJson(res, 400, { error: { type: err, message: '请求体不合法。' } });
        const orderId = String((body && body.orderId) || '').trim();
        const o = ledger.orders[orderId];
        if (!o) return sendJson(res, 404, { error: { type: 'order_not_found', message: '订单不存在：' + orderId } });

        // ── 灵付 LingPay 人工确认路径：仍强制核对金额（fail-closed）────────────
        // 本端点用于：① 走对公静态收款码/转账的老通道，作者拿流水按订单号折算入账；
        // ② 金额不符/订单丢失时的兜底人工处置。正常到账由作者跑 reconcile-bank.js 批量入账。
        const received = (body && body.receivedCents !== undefined) ? body.receivedCents : undefined;
        if (received === undefined && !(body && body.acknowledgeUnverified === true)) {
          return sendJson(res, 400, {
            error: {
              type: 'amount_not_verified',
              message: '拒绝在未核对金额的情况下入账：请传 receivedCents（银行流水里实际到账的分数）。',
              orderId: orderId,
              expectedCents: o.amountCents,
              expectedDisplay: yuan(o.amountCents),
              whyItMatters: '付款链接里的 amount 参数是客户端可改的；不核对金额 = 1 分钱的转账可以领走整单额度。',
              alternative: '灵付 LingPay：走「对公静态收款 + 银行流水对账」——付款后由作者按订单号批量折算入账（按 ' + yuan(PRICE_CENTS) + '/次），无需平台回调。',
              orPass: 'acknowledgeUnverified:true（表示你已自行核对，风险自担）'
            }
          });
        }
        const r = creditOrder(orderId, {
          receivedCents: received,
          // 默认：传了 receivedCents 就要求「逐分相等」（防少付多领）；
          // 但调用方（如 reconcile-bank.js 的对公静态折算）可显式传 expectExactAmount:false，
          // 表示「按实收金额折算入账，不要求恰为订单面值」——此处尊重该显式开关。
          expectExactAmount: (body && body.expectExactAmount !== undefined) ? !!body.expectExactAmount : (received !== undefined),
          channel: (body && body.channel) || null,
          txRef: (body && body.txRef) || null,
          source: 'admin'
        });
        if (!r.ok) {
          if (r.reason === 'amount_mismatch') {
            return sendJson(res, 409, {
              error: {
                type: 'amount_mismatch',
                message: '实收金额与订单金额不符，已拒绝入账（防「少付多领」）。',
                orderId: orderId,
                expectedCents: r.expectedCents, expectedDisplay: r.expectedDisplay,
                receivedCents: Number.isInteger(r.receivedCents) ? r.receivedCents : null,
                receivedDisplay: r.receivedDisplay || null,
                outOfRange: !Number.isInteger(r.receivedCents) ? 'receivedCents 必须是整数（单位：分）' : null,
                howToProceed: [
                  '核对银行流水后重试，传正确的 receivedCents',
                  '若确实要按实收金额入账（部分到账 / 善意补偿 / 客户讨价），改用 POST /admin/credit {"orderId":"…","cents":<分>,"reason":"…"}',
                  '若确认要按整单入账，传 acknowledgeUnverified:true'
                ]
              }
            });
          }
          return sendJson(res, r.reason === 'order_not_found' ? 404 : 500, {
            error: { type: r.reason, message: '入账未完成：' + r.reason + '（订单 ' + orderId + '）' }
          });
        }
        return sendJson(res, 200, {
          orderId: orderId, status: 'paid', alreadyPaid: r.alreadyPaid, key: r.keyMask,
          creditedCents: r.creditedCents, balanceCents: r.balanceCents, callsRemaining: r.callsRemaining,
          amountVerified: received !== undefined,
          amountNotice: r.alreadyPaid
            ? '该订单此前已入账，未重复入账。'
            : (received !== undefined
              ? ('已核对实收 ' + yuan(received) + '，与订单金额一致。')
              : '⚠️ 未核对金额即入账（acknowledgeUnverified）——请自行留存银行流水凭证，以便日后对账。')
        });
      });
    }

    // POST /admin/credit：手工入账（送额度/线下转账/补偿）—— 目标可用 keyHash / apiKey / orderId 指定
    if (req.method === 'POST' && pathname === '/admin/credit') {
      return readBody(req, ({ body, err }) => {
        if (err) return sendJson(res, 400, { error: { type: err, message: '请求体不合法。' } });
        const cents = body && body.cents;
        if (typeof cents !== 'number' || Math.floor(cents) !== cents || cents === 0) {
          return sendJson(res, 400, { error: { type: 'invalid_cents', message: 'cents 必须是非零整数（可为负以扣减）。' } });
        }
        let keyHash = null;
        if (body.apiKey) keyHash = hashKey(String(body.apiKey).trim());
        else if (body.keyHash) keyHash = String(body.keyHash).trim();
        else if (body.orderId) {
          const o = ledger.orders[String(body.orderId).trim()];
          if (!o) return sendJson(res, 404, { error: { type: 'order_not_found', message: '订单不存在。' } });
          keyHash = o.keyHash;
        }
        const k = keyHash ? ledger.keys[keyHash] : null;
        const reason = String((body && body.reason) || 'manual');
        if (!k) {
          // 无 key 时按「新发一张凭证」处理（管理员送额度给某人）
          if (!body.issueNew) {
            return sendJson(res, 404, { error: { type: 'key_not_found', message: '未找到该凭证。若需新发一张，请传 issueNew:true。' } });
          }
          const nk = newKey();
          const nh = hashKey(nk);
          ledger.keys[nh] = {
            mask: maskKey(nk), balanceCents: cents, createdAt: new Date().toISOString(),
            lastUsedAt: null, calls: 0, spentCents: 0, disabled: false, note: reason
          };
          saveLedger();
          ledgerAudit({ event: 'key_issued', key: maskKey(nk), cents: cents, reason: reason });
          return sendJson(res, 201, { apiKey: nk, apiKeyNotice: '此 key 仅出现一次，请立即保存。', balanceCents: cents, callsRemaining: Math.floor(cents / PRICE_CENTS), note: reason });
        }
        k.balanceCents += cents;
        k.note = (k.note ? k.note + ' | ' : '') + reason;
        saveLedger();
        ledgerAudit({ event: 'admin_credit', key: k.mask, cents: cents, balanceCents: k.balanceCents, reason: reason });
        return sendJson(res, 200, { key: k.mask, creditedCents: cents, balanceCents: k.balanceCents, callsRemaining: Math.floor(k.balanceCents / PRICE_CENTS) });
      });
    }

    // POST /admin/key/disable：停用凭证（盗用/退款）
    if (req.method === 'POST' && pathname === '/admin/key/disable') {
      return readBody(req, ({ body, err }) => {
        if (err) return sendJson(res, 400, { error: { type: err, message: '请求体不合法。' } });
        const keyHash = body.apiKey ? hashKey(String(body.apiKey).trim()) : String((body && body.keyHash) || '').trim();
        const k = ledger.keys[keyHash];
        if (!k) return sendJson(res, 404, { error: { type: 'key_not_found', message: '未找到该凭证。' } });
        k.disabled = !!body.disabled;
        k.note = (k.note ? k.note + ' | ' : '') + (k.disabled ? 'disabled by admin' : 'enabled by admin');
        saveLedger();
        ledgerAudit({ event: k.disabled ? 'key_disabled' : 'key_enabled', key: k.mask });
        return sendJson(res, 200, { key: k.mask, disabled: k.disabled, balanceCents: k.balanceCents });
      });
    }

    // POST /admin/rotate：凭证遗失重置 —— 新 key 继承旧 key 余额（旧 key 立即失效）
    if (req.method === 'POST' && pathname === '/admin/rotate') {
      return readBody(req, ({ body, err }) => {
        if (err) return sendJson(res, 400, { error: { type: err, message: '请求体不合法。' } });
        let keyHash = null;
        if (body.orderId) {
          const o = ledger.orders[String(body.orderId).trim()];
          if (!o) return sendJson(res, 404, { error: { type: 'order_not_found', message: '订单不存在。' } });
          keyHash = o.keyHash;
        } else if (body.apiKey) keyHash = hashKey(String(body.apiKey).trim());
        else if (body.keyHash) keyHash = String(body.keyHash).trim();
        const old = ledger.keys[keyHash];
        if (!old) return sendJson(res, 404, { error: { type: 'key_not_found', message: '未找到旧凭证。' } });
        const nk = newKey();
        const nh = hashKey(nk);
        ledger.keys[nh] = {
          mask: maskKey(nk), balanceCents: old.balanceCents, createdAt: new Date().toISOString(),
          lastUsedAt: null, calls: old.calls || 0, spentCents: old.spentCents || 0, disabled: false,
          note: 'rotate from ' + old.mask + (old.note ? ' | ' + old.note : '')
        };
        delete ledger.keys[keyHash];
        if (body.orderId) ledger.orders[String(body.orderId).trim()].keyHash = nh;
        saveLedger();
        ledgerAudit({ event: 'key_rotated', from: old.mask, to: maskKey(nk), balanceCents: old.balanceCents });
        return sendJson(res, 200, { apiKey: nk, apiKeyNotice: '此 key 仅出现一次，请立即保存。', oldKeyMask: old.mask, balanceCents: old.balanceCents, callsRemaining: Math.floor(old.balanceCents / PRICE_CENTS) });
      });
    }

    // GET /admin/ledger：只读台账（key 一律脱敏）
    if (req.method === 'GET' && pathname === '/admin/ledger') {
      const keys = Object.entries(ledger.keys).map(([h, k]) => ({
        keyHash: h.slice(0, 12) + '…', mask: k.mask, balanceCents: k.balanceCents,
        calls: k.calls || 0, spentCents: k.spentCents || 0,
        disabled: !!k.disabled, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt || null, note: k.note || null
      }));
      const orders = Object.entries(ledger.orders).map(([id, o]) => ({
        orderId: id, calls: o.calls, amountCents: o.amountCents, status: o.status,
        createdAt: o.createdAt, paidAt: o.paidAt || null, channel: o.channel || null, txRef: o.txRef || null
      }));
      const totalBalance = keys.reduce((s, k) => s + k.balanceCents, 0);
      const totalSpent = keys.reduce((s, k) => s + k.spentCents, 0);
      const paidOrders = orders.filter(o => o.status === 'paid');
      return sendJson(res, 200, {
        metering: METERING_ON ? 'on' : 'off', priceCentsPerCall: PRICE_CENTS,
        summary: {
          keyCount: keys.length,
          totalBalanceCents: totalBalance, totalBalanceDisplay: yuan(totalBalance),
          totalSpentCents: totalSpent, totalSpentDisplay: yuan(totalSpent),
          totalCalls: keys.reduce((s, k) => s + k.calls, 0),
          honorClaims: honorClaims,
          orderCount: orders.length, paidOrderCount: paidOrders.length,
          paidRevenueCents: paidOrders.reduce((s, o) => s + o.amountCents, 0),
          paidRevenueDisplay: yuan(paidOrders.reduce((s, o) => s + o.amountCents, 0))
        },
        payment: paymentInfo(), keys: keys, orders: orders
      });
    }
    return sendJson(res, 404, { error: { type: 'not_found', message: '未知管理端点。', available: ['POST /admin/order/confirm', 'POST /admin/credit', 'POST /admin/key/disable', 'POST /admin/rotate', 'GET /admin/ledger'] } });
  }

  // MCP 端点：Streamable HTTP（POST 请求 / GET 收 SSE / DELETE 终止会话）
  if (pathname === '/mcp') {
    // GET：打开 SSE 流，接收服务端→客户端通知（MCP Streamable HTTP 规范）
    if (req.method === 'GET') {
      const sessionId = req.headers['mcp-session-id'] || crypto.randomUUID();
      res.writeHead(200, Object.assign({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      }, CORS, { 'mcp-session-id': sessionId }));
      res.write('retry: 2000\n\n');
      res.write(': connected\n\n');
      const ka = setInterval(() => { try { res.write(': keepalive\n\n'); } catch (_e) {} }, 15000);
      req.on('close', () => { clearInterval(ka); sessions.delete(sessionId); });
      sessions.set(sessionId, { createdAt: Date.now(), sse: res });
      return;
    }
    // DELETE：终止会话
    if (req.method === 'DELETE') {
      const sessionId = req.headers['mcp-session-id'];
      const s = sessions.get(sessionId);
      if (s && s.sse) { try { s.sse.end(); } catch (_e) {} }
      sessions.delete(sessionId);
      res.writeHead(200, CORS);
      return res.end();
    }
    // POST：JSON-RPC 请求
    if (req.method === 'POST') {
      // 限速（安全等保加固）：超限直接 429，不读不处理
      if (!rateAllowed(ip)) {
        appendLog({ ts: new Date().toISOString(), ip: ip, event: 'rate_limited' });
        return sendJson(res, 429, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Rate limit exceeded. Try again later.' } });
      }
      const sessionId = req.headers['mcp-session-id'] || crypto.randomUUID();
      if (!sessions.has(sessionId)) sessions.set(sessionId, { createdAt: Date.now() });
      pruneSessions();

      let raw = '';
      let rawLen = 0;
      let tooBig = false;
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        rawLen += chunk.length;
        if (rawLen > MAX_BODY_BYTES) {
          if (!tooBig) {
            tooBig = true;
            raw = '';
            appendLog({ ts: new Date().toISOString(), ip: ip, event: 'rejected_body_too_large' });
            try { res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request body too large (256KB max).' } })); } catch (_e) {}
            try { req.destroy(); } catch (_e2) {}
          }
          return;
        }
        raw += chunk;
      });
      req.on('end', () => {
        if (tooBig) return;
        let msg;
        try {
          msg = JSON.parse(raw);
        } catch (_e) {
          return sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        }
        // 批量请求支持
        const batch = Array.isArray(msg) ? msg : [msg];
        const responses = [];
        for (const m of batch) {
          if (m && m.jsonrpc === '2.0') {
            const r = handleRpc(m, ip, ctx);
            if (r !== null) responses.push(r);
          }
        }
        const headers = Object.assign({ 'mcp-session-id': sessionId }, CORS);
        if (Array.isArray(msg)) {
          if (responses.length === 0) { res.writeHead(202, headers); return res.end(); }
          return sendJson(res, 200, responses, headers);
        } else {
          if (responses.length === 0) { res.writeHead(202, headers); return res.end(); }
          return sendJson(res, 200, responses[0], headers);
        }
      });
      return;
    }
    // 其它方法
    res.writeHead(405, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8', 'Allow': 'GET, POST, DELETE, OPTIONS' }, CORS));
    return res.end('Method Not Allowed. MCP endpoint accepts GET, POST, DELETE, OPTIONS.');
  }

  // 其它：404
  res.writeHead(404, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, CORS));
  res.end('Not Found. MCP endpoint: POST /mcp');
});

// 账本在启动时加载（不在模块顶层读盘，便于测试脚本先设 LS_CREDITS_PATH 再 require）
loadLedger();

server.listen(PORT, '0.0.0.0', () => {
  appendLog({
    ts: new Date().toISOString(), event: 'server_start', name: SERVER_NAME, version: SERVER_VERSION, port: PORT,
    metering: METERING_ON ? 'on' : 'off', priceCents: METERING_ON ? PRICE_CENTS : 0,
    adminEnabled: !!ADMIN_TOKEN, payConfigured: !!PAY_TO,
    receiptPinHash: RECEIPT_PIN_HASH, receiptTampered: RECEIPT_TAMPERED,
    keyCount: Object.keys(ledger.keys).length, orderCount: Object.keys(ledger.orders).length
  });
  console.log(`[${SERVER_NAME}] HTTP MCP server listening on 0.0.0.0:${PORT}`);
  console.log(`  health : GET  http://localhost:${PORT}/health`);
  console.log(`  mcp    : POST http://localhost:${PORT}/mcp`);
  console.log(`  metering: ${METERING_ON ? 'ON  ' + PRICE_CENTS + ' 分/次' : 'off (免费)'}`);
  console.log(`  tls     : ${REQUIRE_TLS ? 'REQUIRED for credentialed calls' : 'not enforced (凭证可走明文，迁移期)'}`);
  console.log(`  account : not required (key = account); collects no personal data`);
  console.log(`  pricing : GET  http://localhost:${PORT}/pricing`);
  console.log(`  pay     : 灵付 LingPay（corporate-static，对公静态收款 + 流水对账，不接任何支付平台商户 API）`);
  console.log(`  admin   : ${ADMIN_TOKEN ? 'enabled' : 'DISABLED (未设 LS_ADMIN_TOKEN)'}${ADMIN_LOOPBACK_ONLY ? ' [loopback-only]' : ' [reachable remotely]'} | payTo: ${PAY_TO ? 'configured' : 'NOT configured (未设 LS_PAY_TO)'}`);
  console.log(`  receipt : pinned=${PINNED_ACCOUNT}  tamper=${RECEIPT_TAMPERED ? 'YES ⚠ 账号被篡改，已 fail-closed 拒绝收款' : 'OK (verified)'}${RECEIPT_QR_WARN ? '  [qr warn: LS_PAY_TO_QR 非银联官方址]' : ''}`);
  if (RECEIPT_TAMPERED) {
    console.warn('[SECURITY] 收款账号与钉死值不符，已 fail-closed：不再生成任何付款意图。请立即检查 LS_PAY_TO 配置是否被篡改。');
  }
  if (METERING_ON && !PAY_TO) {
    console.warn('[warn] 计费已开但未配置 LS_PAY_TO：订单可创建却无法付款。');
  }
});
