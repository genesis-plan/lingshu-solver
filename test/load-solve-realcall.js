#!/usr/bin/env node
/**
 * test/load-solve-realcall.js — 真实调用路径的大规模压测（只测自家求解器）
 *
 * ⚠ 与仓库里其他测试的根本区别：**走 Agent 真实的调用路径**，不是内核直调。
 *   Agent → MCP `tools/call` → HTTP → http-mcp-server.js → services/solver-service.js
 *   ⇒ 量到的是 Agent 真正付出的东西：HTTP 开销 + 序列化 + 体积控制 + 4 态决策标记。
 *   内核直调（solver-core.js raw()）量不到返回体体积，也量不到 shapeResult 的降级逻辑，
 *   那不是 Agent 拿到的东西。
 *
 * 用法：node test/load-solve-realcall.js [题数] [并发]
 *   例：node test/load-solve-realcall.js 2000 8
 *
 * ⚠ 2026-10-05：默认**抬高**服务端的每 IP 限速（LS_RATE_MAX）。
 *   理由：那个 120 次/分 的桶是**防 DoS 护栏**，不是求解器的一部分；它按 IP 计，
 *   生产环境里每个 Agent 一个 IP、每秒 2 次够用。但压测是**单机高并发**打同一个
 *   127.0.0.1 ⇒ 501 题里有 380 题（76%）拿到的是 101B 的限流垃圾
 *   （`{"error":{"code":-32000,"message":"Rate limit exceeded..."}}`），
 *   而它是 `json.error` 不是 `json.result.isError` ⇒ 会被当正常结果统计进去。
 *   我们要量的是求解器，不是护栏 ⇒ 抬高它，并在报告里显式标注「已抬高」。
 *   同时客户端仍保留限流检测 + 退避重试（双保险，且能报出命中次数）。
 *
 * 本脚本【不进 verify 链】（与 measure-decision.mjs 同理）：
 *   它是测量工具不是回归测试 —— 输出的是分布与反例清单，靠人看数字判断，
 *   没有「必须为真」的断言（大规模随机题上钉硬断言会变成 flaky 源）。
 *
 * 测什么（Agent 真关心的四件事）
 *   ① 拿不拿得到结果（成功率 / 超时 / 崩没崩）
 *   ② 多快（p50 / p95 / p99 / max，HTTP 全链路）
 *   ③ 拿到的是不是【能决策的结论】（4 态 conclusion 分布 + canAssert 自洽）
 *   ④ 给的数对不对（回代残差 + 不等式约束违反 + 谎报检测）
 */
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const NODE = process.execPath;
const SERVER = path.join(__dirname, '..', 'http-mcp-server.js');
const ADMIN = 'loadtest';
const PORT = 39317 + (process.pid % 500);

const N_CASES = parseInt(process.argv[2] || '2000', 10);
const CONC = parseInt(process.argv[3] || '8', 10);
const PER_CALL_TIMEOUT_MS = 20000;
// 压测期抬高每 IP 限速（防 DoS 护栏，与求解器无关）；设 0 表示「完全不抬」。
const RATE_MAX = process.env.LOAD_RATE_MAX || '200000';
// 预热题数（不计入统计）：JIT + 服务首次加载 + HTTP 连接池都要先热起来，
// 否则前几十题的耗时是「冷启动噪声」，会把 p95/p99 抬高 ⇒ 违反「公平预热」硬约束。
const WARMUP = parseInt(process.env.LOAD_WARMUP || '40', 10);
// 限流退避重试上限
const MAX_RETRY = 6;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────────────────────────────────
// 1. 题面生成：确定性 LCG（可复现），覆盖 Agent 真实会问的题型
// ─────────────────────────────────────────────────────────────────────
let _seed = 20261005;
function rnd() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }
function ri(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }
function coeff() { return ri(-9, 9) || 3; }

const NAMES = ['x', 'y', 'z', 'u', 'v', 'w'];

const CASES = [];
function add(group, equations, variables, domain, opts) {
  CASES.push({ group, equations, variables, domain: domain || undefined, opts: opts || undefined });
}

// (a) 一元多项式 1~4 次
//
// ⚠ 2026-10-05 修：**原版把拼好的多项式丢掉了**。上面那堆字符串拼接算出了 `s`，
//   但 add() 里写的是 `${c[deg]}*x^${deg}` —— 只有最高次项 ⇒ 2000 题里 280 道
//   poly1 全是 `3*x^4 = 0` 这种只有零根的东西，多项式路径被系统性绕过，
//   测出来的「多项式很快」是假的。现在用 polyStr() 拼完整多项式。
function polyStr(c) {   // c[k] = x^k 的系数
  let s = '';
  for (let k = c.length - 1; k >= 0; k--) {
    const a = c[k];
    if (a === 0) continue;
    const body = k === 0 ? String(Math.abs(a))
      : (Math.abs(a) === 1 ? '' : Math.abs(a) + '*') + (k === 1 ? 'x' : 'x^' + k);
    if (!s) s = (a < 0 ? '-' : '') + body;
    else s += (a < 0 ? '-' : '+') + body;
  }
  return s || '0';
}
for (let i = 0; i < Math.round(N_CASES * 0.14); i++) {
  const deg = ri(1, 4);
  const c = [];
  for (let k = 0; k <= deg; k++) c.push(coeff());
  c[deg] = c[deg] || 1;
  add('poly1', [polyStr(c) + ' = 0'], ['x'], { x: [-30, 30] });
}

// (b) 多元线性（2~6 元，方阵为主，含少量欠定/超定）
for (let i = 0; i < Math.round(N_CASES * 0.20); i++) {
  const n = ri(2, 6);
  const vs = NAMES.slice(0, n);
  const rows = ri(1, 20) <= 3 ? ri(1, n - 1) : n;      // 少量欠定
  const eqs = [];
  for (let r = 0; r < rows; r++) {
    let e = '';
    for (let k = 0; k < n; k++) e += (k ? '+' : '') + coeff() + '*' + vs[k];
    eqs.push(e + ' = ' + ri(-50, 50));
  }
  add('linear' + n, eqs, vs, undefined);
}

// (c) 多元非线性（平方和 / 乘积 / 混合）
for (let i = 0; i < Math.round(N_CASES * 0.16); i++) {
  const n = ri(2, 3);
  const vs = NAMES.slice(0, n);
  const kind = ri(1, 3);
  const eqs = [];
  if (kind === 1) {
    let e = '';
    for (let k = 0; k < n; k++) e += (k ? '+' : '') + vs[k] + '^2';
    eqs.push(e + ' = ' + ri(1, 40));
    for (let k = 1; k < n; k++) eqs.push(vs[k] + '-' + vs[0] + ' = ' + ri(-3, 3));
  } else if (kind === 2) {
    eqs.push(vs[0] + '*' + vs[1] + ' = ' + ri(1, 20));
    eqs.push(vs[0] + '+' + vs[1] + ' = ' + ri(1, 15));
    for (let k = 2; k < n; k++) eqs.push(vs[k] + '^2 = ' + ri(1, 9));
  } else {
    eqs.push(vs[0] + '^2 + ' + vs[1] + ' = ' + ri(1, 20));
    eqs.push(vs[0] + ' - ' + vs[1] + '^2 = ' + ri(-5, 5));
    for (let k = 2; k < n; k++) eqs.push(vs[k] + ' = ' + ri(1, 5));
  }
  add('nonlinear' + n, eqs, vs, undefined);
}

// (d) 带不等式约束（本轮新闸门的重点回归面）
for (let i = 0; i < Math.round(N_CASES * 0.12); i++) {
  const c = ri(1, 9);
  const strict = rnd() < 0.5;
  add('ineq', [`x^2 = ${c * c}`, `x ${strict ? '>' : '>='} 0`], ['x'], undefined);
  add('ineq-negative', [`x^2 = ${c * c}`, `x ${strict ? '<' : '<='} 0`], ['x'], undefined);
}

// (e) 区间约束 x in [a,b]（严格/非严格两种括号）
for (let i = 0; i < Math.round(N_CASES * 0.08); i++) {
  const a = ri(-5, 2), b = a + ri(1, 8);
  add('interval', [`x^2 = ${ri(1, 20)}`, `x in [${a},${b}]`], ['x'], undefined);
}

// (f) 无解方程（平方和 = 负数）
for (let i = 0; i < Math.round(N_CASES * 0.08); i++) {
  const n = ri(1, 3);
  const vs = NAMES.slice(0, n);
  let e = '';
  for (let k = 0; k < n; k++) e += (k ? '+' : '') + vs[k] + '^2';
  add('nosol', [e + ' = -' + ri(1, 30)], vs, undefined);
}

// (g) 超越函数（exp/sin/sqrt）—— 真实场景里 Agent 常问
for (let i = 0; i < Math.round(N_CASES * 0.10); i++) {
  const kind = ri(1, 3);
  if (kind === 1) add('trans', [`exp(x) = ${ri(1, 50)}`], ['x'], { x: [-5, 8] });
  else if (kind === 2) add('trans', [`sin(x) = ${(rnd() * 1.6 - 0.8).toFixed(3)}`], ['x'], { x: [-3.2, 3.2] });
  else add('trans', [`sqrt(x) = ${ri(1, 20)}`], ['x'], { x: [0, 100] });
}

// (h) 6 元密/稀疏二次（压到上限，看会不会撞预算）
for (let i = 0; i < Math.round(N_CASES * 0.06); i++) {
  const vs = NAMES.slice(0, 6);
  const eqs = [];
  for (let k = 0; k < 6; k++) eqs.push(vs[k] + '^2 + ' + vs[(k + 1) % 6] + ' = ' + ri(1, 12));
  add('sixvar', eqs, vs, undefined);
}

// (i) 现实建模题（金融/配比/盈亏/运动），固定题面
const MODELING = [
  [['r*(1+r)^10 = 2'], ['r'], { r: [0, 1] }],
  [['p*q = 50000', 'p+q = 500'], ['p', 'q'], undefined],
  [['0.3*x+0.7*y = 500', 'x+y = 1000'], ['x', 'y'], undefined],
  [['x^2+y^2 = 100', 'x-y = 0'], ['x', 'y'], undefined],
  [['t^2-4*t+3 = 0'], ['t'], undefined],
  [['a+b+c = 100', 'a-b = 10', 'b-c = 5'], ['a', 'b', 'c'], undefined],
];
for (const [eqs, vs, dm] of MODELING) add('modeling', eqs, vs, dm);

// 补齐/截断到 N_CASES
while (CASES.length < N_CASES) {
  const src = CASES[CASES.length % Math.max(1, CASES.length - 1)] || CASES[0];
  CASES.push(Object.assign({}, src));
}
CASES.length = Math.min(CASES.length, N_CASES);

// ─────────────────────────────────────────────────────────────────────
// 2. HTTP MCP 客户端（真实调用路径）
// ─────────────────────────────────────────────────────────────────────
function req(port, method, p, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({
      hostname: '127.0.0.1', port, path: p, method, timeout: PER_CALL_TIMEOUT_MS,
      headers: Object.assign(
        { 'Content-Type': 'application/json', 'Content-Length': data ? Buffer.byteLength(data) : 0 },
        headers || {})
    }, (res) => {
      let s = '';
      res.setEncoding('utf8');
      res.on('data', d => s += d);
      res.on('end', () => { let j = null; try { j = JSON.parse(s); } catch (e) { } resolve({ status: res.statusCode, json: j, raw: s }); });
    });
    r.on('timeout', () => { r.destroy(new Error('timeout')); });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
// ⚠ 2026-10-05 关键修正：限流响应是 `json.error`（**不是** `json.result.isError`），
//   形如 {"jsonrpc":"2.0","id":null,"error":{"code":-32000,"message":"Rate limit exceeded..."}}
//   原实现 `res = r.json.result` ⇒ undefined ⇒ isError=false ⇒ payload 退化成整个 r.json
//   ⇒ **被当成正常结果统计**。这就是 500 题跑次里 76%「无 conclusion」的真凶。
//   现在显式识别并标 rateLimited，由调用方退避重试；重试也拿不到才算真失败。
function mcp(port, tool, args) {
  return req(port, 'POST', '/mcp',
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args || {} } },
    { 'Authorization': 'Bearer ' + ADMIN })
    .then((r) => {
      const j = r.json || {};
      // ① JSON-RPC 层错误（限流 / 非法请求 / 内部错）
      if (j.error) {
        const code = j.error.code;
        return {
          isError: true,
          rateLimited: code === -32000,
          status: r.status,
          errText: String(j.error.message || '').slice(0, 160),
          payload: null
        };
      }
      // ② HTTP 层非 200
      if (r.status !== 200) return { isError: true, status: r.status, errText: (r.raw || '').slice(0, 160), payload: null };
      const res = j.result;
      const isError = !!(res && res.isError);
      const c = res && res.content && res.content[0];
      let payload = null;
      if (c && c.text) { try { payload = JSON.parse(c.text); } catch (e) { payload = { _parseError: true, text: String(c.text).slice(0, 200) }; } }
      return { isError, payload: payload || j, status: r.status };
    });
}
// 带退避重试的调用：只有 rateLimited 才重试（其他错误重试也没用，反而拖慢）
async function mcpRetry(port, tool, args, stats) {
  let last = null;
  for (let a = 0; a <= MAX_RETRY; a++) {
    const r = await mcp(port, tool, args);
    if (r.rateLimited) {
      stats.rateLimitHits++;
      last = r;
      // 指数退避 + 抖动：200ms → 400 → 800 → 1600 → 3200 → 6400（上限 8s）
      await sleep(Math.min(8000, 200 * Math.pow(2, a)) + Math.random() * 120);
      continue;
    }
    if (a > 0) stats.retried++;
    return r;
  }
  return last;
}
function waitHealth(port) {
  return new Promise((resolve) => {
    const t = setInterval(() => {
      req(port, 'GET', '/health').then((r) => { if (r.status === 200) { clearInterval(t); resolve(true); } }).catch(() => { });
    }, 200);
    setTimeout(() => { clearInterval(t); resolve(false); }, 15000);
  });
}

// ─────────────────────────────────────────────────────────────────────
// 3. 校验：把返回的数代回原式，看残差；并检查不等式约束
// ─────────────────────────────────────────────────────────────────────
// 用内核的解析器做回代 —— 但注意：**判定用的是返回体里的数**，不是内核内部状态，
// 这样才是在验 Agent 拿到的东西。
const { createRequire } = require('module');
const require2 = createRequire(__filename);
let RAW = null;
try { RAW = require2('../solver-core.js').raw(); } catch (e) { /* 拿不到就只做结构校验 */ }

function residualOf(eqs, vs, vals) {
  if (!RAW || !RAW.parse || !RAW.evalNode) return null;
  let worst = 0;
  for (const e of eqs) {
    try {
      const parts = String(e).split('=');
      if (parts.length < 2) continue;
      const f = RAW.parse(parts[0] + '-(' + parts[1] + ')');
      const scope = {};
      for (let i = 0; i < vs.length; i++) scope[vs[i]] = Number(vals[i]);
      const v = RAW.evalNode(f, scope);
      if (typeof v === 'number' && isFinite(v)) worst = Math.max(worst, Math.abs(v));
      else return null;
    } catch (err) { return null; }
  }
  return worst;
}

// ─────────────────────────────────────────────────────────────────────
// 4. 主流程
// ─────────────────────────────────────────────────────────────────────
(async () => {
  const credits = path.join(os.tmpdir(), 'lingshu_load_' + PORT + '_' + Date.now() + '.json');
  const child = spawn(NODE, [SERVER], {
    env: Object.assign({}, process.env, {
      LS_METERING: 'off', LS_PRICE_CENTS: '1', LS_CREDITS_PATH: credits,
      PORT: String(PORT), LS_ADMIN_TOKEN: ADMIN, LS_FREE_LOOPBACK: '0',
      LS_RATE_MAX: RATE_MAX     // ★ 抬高防 DoS 限速桶（护栏，非求解器；见文件头说明）
    }),
    stdio: ['ignore', 'pipe', 'pipe'], detached: true
  });
  child.unref();
  child.stdout.on('data', () => { });
  child.stderr.on('data', (d) => process.stderr.write('[server] ' + d));

  const up = await waitHealth(PORT);
  if (!up) { console.error('❌ 服务未起来'); child.kill(); process.exit(1); }
  console.log(`服务已就绪 port=${PORT}  metering=off  LS_RATE_MAX=${RATE_MAX}`);

  // ── 预热：不进统计 ──
  // 不预热的话前几十题混着 JIT 编译 / 首次 require / HTTP 连接建立的冷启动成本，
  // p95/p99 会被这几个噪声点抬起来 ⇒ 那就是拿冷启动当性能数据，不公平也不真实。
  const stats = { rateLimitHits: 0, retried: 0 };
  {
    const t0 = process.hrtime.bigint();
    for (let k = 0; k < WARMUP; k++) {
      const c = CASES[k % CASES.length];
      const args = { equations: c.equations };
      if (c.variables) args.variables = c.variables;
      if (c.domain) args.domain = c.domain;
      await mcpRetry(PORT, 'solve', args, stats);
    }
    console.log(`预热 ${WARMUP} 题完成（${(Number(process.hrtime.bigint() - t0) / 1e6).toFixed(0)}ms，不计入统计）`);
    stats.rateLimitHits = 0; stats.retried = 0;   // 预热期的限流/重试不计
  }
  console.log(`题目 ${CASES.length} 道 · 并发 ${CONC} · 单次超时 ${PER_CALL_TIMEOUT_MS}ms\n`);

  const results = new Array(CASES.length);
  let cursor = 0;
  const tStart = process.hrtime.bigint();
  async function worker() {
    while (cursor < CASES.length) {
      const i = cursor++;
      const c = CASES[i];
      const t0 = process.hrtime.bigint();
      try {
        const args = { equations: c.equations };
        if (c.variables) args.variables = c.variables;
        if (c.domain) args.domain = c.domain;
        const r = await mcpRetry(PORT, 'solve', args, stats);
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        results[i] = { i, c, ms, r };
      } catch (e) {
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        results[i] = { i, c, ms, err: String(e && e.message || e) };
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  const wallMs = Number(process.hrtime.bigint() - tStart) / 1e6;

  // ── 汇总 ──
  const times = [];
  const byGroup = {};
  const conclusions = {};
  const trustLevels = {};
  let httpErr = 0, toolErr = 0, parseErr = 0, throttledFinal = 0;
  let errorSamples = [];
  let badResidual = [], overBudgetBytes = [], ineqViolation = [], lieClaims = [], contractBad = [];
  let undecidableCases = [];
  let noConclusion = [];

  const REDLINE = 1600;
  let bytesList = [];

  for (const row of results) {
    const { i, c, ms, r, err } = row;
    times.push(ms);
    const g = c.group;
    byGroup[g] = byGroup[g] || { n: 0, ms: 0, ok: 0, err: 0 };
    byGroup[g].n++; byGroup[g].ms += ms;

    if (err) { httpErr++; byGroup[g].err++; if (errorSamples.length < 5) errorSamples.push({ i, kind: 'http', msg: String(err).slice(0, 160) }); continue; }
    const p = r.payload;
    if (r.rateLimited) { throttledFinal++; byGroup[g].err++; if (errorSamples.length < 5) errorSamples.push({ i, kind: 'ratelimit', msg: r.errText }); continue; }
    if (r.isError || !p || p._parseError) {
      toolErr++; parseErr += p && p._parseError ? 1 : 0; byGroup[g].err++;
      if (errorSamples.length < 5) errorSamples.push({ i, kind: p && p._parseError ? 'parse' : 'tool', msg: (r.errText || JSON.stringify(p).slice(0, 160)) });
      continue;
    }
    byGroup[g].ok++;

    const concl = p.conclusion || '(无)';
    if (!p.conclusion) {
      // ⚠ 拿不到 conclusion 时**必须留样**：大规模跑时这可能是限流/降级响应，
      //   若直接统计进「(无)」就是拿垃圾数据出结论。
      if (noConclusion.length < 6)
        noConclusion.push({ i, eqs: c.equations.slice(0, 2), bytes: Buffer.byteLength(JSON.stringify(p), 'utf8'), payload: JSON.stringify(p).slice(0, 300) });
    }
    conclusions[concl] = (conclusions[concl] || 0) + 1;
    const tl = p.trust && p.trust.trustLevel || '(无)';
    trustLevels[tl] = (trustLevels[tl] || 0) + 1;

    // 返回体字节（Agent 真正付出的 token 成本）
    const b = Buffer.byteLength(JSON.stringify(p), 'utf8');
    bytesList.push(b);
    if (b > REDLINE) {
      // 字段级分解 —— 只报「超了多少」没用，得知道**哪个字段**撑爆的
      const parts = Object.entries(p).map(([k, v]) => [k, Buffer.byteLength(JSON.stringify(v), 'utf8')])
        .sort((a, b2) => b2[1] - a[1]).slice(0, 6);
      overBudgetBytes.push({ i, bytes: b, eqs: c.equations.slice(0, 2), top: parts });
    }

    // 契约自洽：conclusion=全部解 时 canAssert.allSolutions 必须是 true；反之亦然
    //
    // ⚠ 2026-10-05 修正判据（第一版误报 12 题，全是 conclusion='无解'）：
    //   `conclusion.js:251` 的无解分支就是 `{noSolution:true, allSolutions:true}` ——
    //   **解集为空时「已拿到全部解」是真的**（0 个解就是全部），所以 allSolutions=true 是对的。
    //   第一版把「conclusion != 全部解 且 allSolutions===true」一律判为矛盾，
    //   把「无解」这个**正确**的组合也算进去了 ⇒ 12 条全是我的误报，不是产品的 bug。
    //   真正的矛盾只可能出现在「部分解 / 计算资源不足」这两种**明确没找全**的状态上。
    if (p.canAssert) {
      const partial = (concl === '部分解' || concl === '计算资源不足');
      if (concl === '全部解' && p.canAssert.allSolutions !== true)
        contractBad.push({ i, why: 'conclusion=全部解 但 allSolutions!==true', concl, all: p.canAssert.allSolutions });
      if (partial && p.canAssert.allSolutions === true)
        contractBad.push({ i, why: 'conclusion=' + concl + '（没找全）但 allSolutions===true', concl, eqs: c.equations.slice(0, 2) });
      if (concl === '无解' && (p.solutions || []).length > 0)
        contractBad.push({ i, why: '结论无解却给了解', n: p.solutions.length });
      if (p.canAssert.noSolution === true && (p.solutions || []).length > 0)
        contractBad.push({ i, why: '断言 noSolution 却给了解', n: p.solutions.length });
      if (concl === '无解' && p.canAssert.allSolutions !== true)
        contractBad.push({ i, why: '无解但 allSolutions!==true（空集即全部，应为 true）', concl });
    }

    // undecidable 题目本身要留样 —— 大规模跑时它可能是**题面生成**的锅，也可能是产品真缺陷
    if (tl === 'undecidable')
      undecidableCases.push({ i, eqs: c.equations.slice(0, 3), vars: c.variables, msg: (p.message || '').slice(0, 120) });

    // 回代残差（只对给了解的题）
    const sols = p.solutions || [];
    if (sols.length) {
      for (const s of sols) {
        const vals = s.values || s;
        const res = residualOf(c.equations, c.variables || ['x'], vals);
        if (res !== null && res > 1e-3) {
          badResidual.push({ i, eqs: c.equations, vals, res });
          break;
        }
      }
      // 不等式约束：x>0 却给 x=0 / x<0 之类
      for (const eq of c.equations) {
        const m = String(eq).match(/^\s*([a-zA-Z]\w*)\s*(>=|<=|>|<)\s*(-?\d+(?:\.\d+)?)\s*$/);
        if (!m) continue;
        const [, vn, op, num] = m;
        const idx = (c.variables || ['x']).indexOf(vn);
        if (idx < 0) continue;
        const thr = Number(num);
        for (const s of sols) {
          const v = Number((s.values || s)[idx]);
          const okv = op === '>' ? v > thr + 1e-9 : op === '>=' ? v >= thr - 1e-9
            : op === '<' ? v < thr - 1e-9 : v <= thr + 1e-9;
          if (!okv) ineqViolation.push({ i, eq, val: v, eqs: c.equations });
        }
      }
    }

    // 谎报：conclusion=全部解 且 provenCount>0，但一个解都拿不到（拿不到就说找全 = 谎报）
    if (concl === '全部解' && sols.length === 0 && !(p.canAssert && p.canAssert.noSolution === true))
      lieClaims.push({ i, why: '说全部解但 0 个解且未断言无解', eqs: c.equations });
  }

  times.sort((a, b) => a - b);
  const q = (p) => times[Math.min(times.length - 1, Math.floor(times.length * p))];
  bytesList.sort((a, b) => a - b);

  const out = {
    generated: new Date().toISOString(),
    cases: CASES.length, conc: CONC,
    timing: { p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), p99: +q(0.99).toFixed(2), max: +times[times.length - 1].toFixed(2), mean: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(2) },
    throughput: { wallMs: +wallMs.toFixed(0), callsPerSec: +(CASES.length / (wallMs / 1000)).toFixed(1), conc: CONC, warmup: WARMUP, rateMax: RATE_MAX },
    bytes: { p50: bytesList[Math.floor(bytesList.length * 0.5)], p95: bytesList[Math.floor(bytesList.length * 0.95)], max: bytesList[bytesList.length - 1], overRedline: overBudgetBytes.length, redline: REDLINE },
    failures: { httpErr, toolErr, parseErr, throttledFinal, rateLimitHits: stats.rateLimitHits, retried: stats.retried, errorSamples },
    conclusions, trustLevels,
    issues: {
      badResidual: badResidual.length, badResidualSample: badResidual.slice(0, 5),
      ineqViolation: ineqViolation.length, ineqViolationSample: ineqViolation.slice(0, 5),
      lieClaims: lieClaims.length, lieClaimsSample: lieClaims.slice(0, 5),
      contractBad: contractBad.length, contractBadSample: contractBad.slice(0, 5),
      overBudgetBytes: overBudgetBytes.length, overBudgetBytesAll: overBudgetBytes.map(s => ({ i: s.i, bytes: s.bytes, group: CASES[s.i].group, top: s.top.slice(0, 3) })), overBudgetBytesSample: overBudgetBytes.slice(0, 6),
      undecidable: undecidableCases.length, undecidableSample: undecidableCases.slice(0, 6),
      noConclusion: noConclusion.length, noConclusionSample: noConclusion
    },
    byGroup: Object.entries(byGroup).map(([k, v]) => ({ group: k, n: v.n, ok: v.ok, err: v.err, meanMs: +(v.ms / v.n).toFixed(2) }))
      .sort((a, b) => b.meanMs - a.meanMs)
  };

  console.log('════════ 真实调用路径大规模压测结果 ════════');
  console.log(`题数 ${out.cases} · 并发 ${out.conc}`);
  console.log(`\n【耗时 ms（HTTP 全链路）】p50 ${out.timing.p50} · p95 ${out.timing.p95} · p99 ${out.timing.p99} · max ${out.timing.max} · mean ${out.timing.mean}`);
  console.log(`【返回体 B】p50 ${out.bytes.p50} · p95 ${out.bytes.p95} · max ${out.bytes.max} · 超 ${out.bytes.redline}B 红线 ${out.bytes.overRedline} 题`);
  console.log(`【吞吐】墙钟 ${(wallMs / 1000).toFixed(1)}s · ${out.throughput.callsPerSec} calls/s（并发 ${CONC}，已预热 ${WARMUP} 题，LS_RATE_MAX=${RATE_MAX}）`);
  console.log(`【失败】http ${out.failures.httpErr} · tool-error ${out.failures.toolErr} · 解析失败 ${out.failures.parseErr} · 限流重试后仍失败 ${out.failures.throttledFinal}`);
  console.log(`        限流命中 ${out.failures.rateLimitHits} 次（已退避重试，成功 ${out.failures.retried} 次）`);
  if (out.failures.errorSamples.length) {
    console.log(`        失败样本：`);
    for (const s of out.failures.errorSamples) console.log(`          [${s.kind}] #${s.i} ${s.msg}`);
  }
  console.log(`\n【4 态 conclusion 分布】`);
  for (const [k, v] of Object.entries(conclusions).sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(8)} ${v}  (${(v / CASES.length * 100).toFixed(1)}%)`);
  console.log(`\n【trustLevel 分布】`);
  for (const [k, v] of Object.entries(trustLevels).sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(30)} ${v}`);
  console.log(`\n【问题清单】`);
  console.log(`   残差 >1e-3 的解      ${out.issues.badResidual}`);
  console.log(`   违反不等式约束的解    ${out.issues.ineqViolation}`);
  console.log(`   谎报（说找全却给不出）${out.issues.lieClaims}`);
  console.log(`   conclusion/canAssert 自相矛盾 ${out.issues.contractBad}`);
  console.log(`   undecidable（输入不可解）    ${out.issues.undecidable}`);
  console.log(`\n【分组均值 ms】`);
  for (const g of out.byGroup) console.log(`   ${g.group.padEnd(16)} n=${String(g.n).padStart(4)}  ok=${String(g.ok).padStart(4)} err=${String(g.err).padStart(3)}  mean ${g.meanMs}`);

  if (out.issues.overBudgetBytes.length) {
    console.log(`\n【超 ${REDLINE}B 红线的题 —— 字段级分解】`);
    for (const s of out.issues.overBudgetBytes)
      console.log(`   #${s.i} ${s.bytes}B  ${JSON.stringify(s.eqs).slice(0, 70)}\n      ${s.top.map(([k, v]) => k + '=' + v + 'B').join(' · ')}`);
  }
  if (out.issues.undecidableSample.length) {
    console.log(`\n【undecidable 样本】`);
    for (const s of out.issues.undecidableSample)
      console.log(`   #${s.i} ${JSON.stringify(s.eqs).slice(0, 90)} vars=${JSON.stringify(s.vars)}  ${s.msg}`);
  }
  for (const [name, arr, key] of [
    ['残差 >1e-3', out.issues.badResidualSample, 'res'],
    ['违反不等式', out.issues.ineqViolationSample, 'eq'],
    ['谎报', out.issues.lieClaimsSample, 'why'],
    ['契约矛盾', out.issues.contractBadSample, 'why'],
  ]) {
    if (!arr.length) continue;
    console.log(`\n【${name}样本】`);
    for (const s of arr) console.log('   ' + JSON.stringify(s).slice(0, 240));
  }

  fs.writeFileSync(path.join(__dirname, 'load-solve-realcall.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log(`\n明细落盘：test/load-solve-realcall.json`);

  child.kill();
  process.exit(0);
})();
