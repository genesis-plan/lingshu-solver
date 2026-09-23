#!/usr/bin/env node
/**
 * reconcile-bank.js — 灵数托管端点「对公静态收款」对账脚本（零依赖）
 *
 * 这是「我们的方法」的收尾闭环：不接支付宝 / 微信 / 工行任何商户 API，
 * 收款入口 = 公司本就有的对公账户。付款人向对公账户转账任意「自愿支持额」并备注订单号
 * （LS-YYYYMMDD-xxxxxx），作者导出对公流水（CSV），跑本脚本按「订单号 + 实收金额」批量入账，
 * 折算规则：¥0.01/次（实收 N 分 = N 次调用）。全程跑在咱们自己服务器，可审计、合规（对公）。
 *
 * 用法：
 *   干跑（只报告、不入账）：
 *     node reconcile-bank.js 对公流水.csv
 *   实际入账（POST /admin/order/confirm）：
 *     node reconcile-bank.js 对公流水.csv --apply
 *   或：LS_RECONCILE_APPLY=1 node reconcile-bank.js 对公流水.csv
 *
 * 配置（均来自运行环境，非新注册）：
 *   PORT            本服务端口（默认 3000）
 *   LS_ADMIN_TOKEN  管理令牌（/admin/order/confirm 需要）
 *
 * 流水格式假设（主流对公网银 CSV 通用，已尽量自适应）：
 *   - 自动探测分隔符：逗号 / 分号 / 制表符；
 *   - 含订单号的那一格（形如 LS-20260923-1a2b3c）被识别为订单；
 *   - 正数金额被识别为入账额：含小数点 → 视为「元」×100 得分；
 *     纯整数 → 视为「元」×100（当 <100000），否则视为「分」。
 *   一行同时命中「订单号 + 正数金额」即视为一笔待对账来款。
 */
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');

const ADMIN_TOKEN = process.env.LS_ADMIN_TOKEN || '';
const PORT = parseInt(process.env.PORT || '3000', 10);
const ORDER_RE = /LS-\d{8}-[0-9a-f]{6}/;

// 金额解析：返回「分」，或 null。
// 只接受「数字 + 可选小数点」的格子；日期（含 -）、文字、带括号的负数等一律排除，
// 避免把「2026-09-23」误当成 2026 元。
function parseAmount(s) {
  if (s == null) return null;
  const raw = String(s).trim();
  if (raw === '') return null;
  if (/^[-(]/.test(raw)) return null;       // 负数 / 括号负＝支出，跳过
  const t = raw.replace(/[￥$¥,\s（）()]/g, '');
  if (/[^0-9.]/.test(t)) return null;        // 含非数字字符（如日期里的 -）→ 不是金额
  if (t.indexOf('.') >= 0) {
    const n = parseFloat(t);
    return isFinite(n) ? Math.round(n * 100) : null;
  }
  const n = parseInt(t, 10);
  if (!isFinite(n) || n <= 0) return null;
  return n < 100000 ? n * 100 : n;          // 整数默认当「元」（6 位以上视为「分」）
}

// 解析整段流水文本 → [{ raw, orderId, amountCents }]
function parseStatement(text) {
  const lines = String(text).split(/\r?\n/).filter(l => l.trim().length);
  const out = [];
  for (const line of lines) {
    const delim = line.includes('\t') ? '\t' : (line.includes(';') ? ';' : ',');
    const cells = line.split(delim).map(c => c.trim().replace(/^"|"$/g, ''));
    let orderId = null;
    for (const c of cells) {
      const m = ORDER_RE.exec(c);
      if (m) { orderId = m[0]; break; }
    }
    if (!orderId) continue;                 // 没订单号的流水（如手续费、内部转账）不参与对账
    let amountCents = null;
    for (const c of cells) {
      const v = parseAmount(c);
      if (v && v > 0) { amountCents = v; break; }
    }
    out.push({ raw: line, orderId, amountCents });
  }
  return out;
}

// 对账主流程：把匹配到的流水逐笔入账。confirmFn(orderId, receivedCents) → Promise<{status,json}>。
// dryRun=true 时只收集、不调 confirm。
async function reconcile(text, confirmFn, dryRun) {
  const rows = parseStatement(text);
  const results = [];
  for (const r of rows) {
    if (r.amountCents == null) {
      results.push({ orderId: r.orderId, amountCents: null, skipped: 'no_amount' });
      continue;
    }
    let res = { status: 'dry-run', json: { creditedCents: r.amountCents, dryRun: true } };
    if (!dryRun && confirmFn) res = await confirmFn(r.orderId, r.amountCents);
    results.push(Object.assign({ orderId: r.orderId, amountCents: r.amountCents }, res));
  }
  return results;
}

function defaultConfirm(orderId, receivedCents) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      orderId, receivedCents,
      expectExactAmount: false,             // 对公静态：按实收金额折算，不要求恰为 1 分
      channel: 'corporate-bank',
      source: 'reconcile'
    });
    const req = http.request({
      hostname: '127.0.0.1', port: PORT, path: '/admin/order/confirm', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-Admin-Token': ADMIN_TOKEN }
    }, (res) => {
      let s = ''; res.on('data', d => s += d);
      res.on('end', () => { let j = null; try { j = JSON.parse(s); } catch (e) {} resolve({ status: res.statusCode, json: j }); });
    });
    req.on('error', (e) => resolve({ status: 0, json: { error: e.message } }));
    req.write(body); req.end();
  });
}

function printReport(rows, dryRun) {
  console.log('\n==== 对账结果 ====');
  console.log('模式: ' + (dryRun ? '干跑（未入账）' : '入账') + '   匹配行: ' + rows.length);
  let totalCents = 0, credited = 0, skipped = 0, failed = 0;
  for (const r of rows) {
    if (r.amountCents == null) { skipped++; console.log(`  ✗ ${r.orderId}  无金额，跳过`); continue; }
    totalCents += r.amountCents;
    const ok = r.status === 200 || r.status === 'dry-run';
    if (ok) credited++; else failed++;
    const cred = (r.json && r.json.creditedCents != null) ? r.json.creditedCents : (dryRun ? r.amountCents : null);
    const calls = cred != null ? Math.floor(cred / 1) : null;
    console.log(`  ${ok ? '✓' : '✗'} ${r.orderId}  实收 ¥${(r.amountCents / 100).toFixed(2)}  →  入账 ${cred != null ? '¥' + (cred / 100).toFixed(2) : '?'} (${calls != null ? calls + ' 次' : '?'})  http=${r.status}`);
  }
  console.log(`\n合计匹配金额: ¥${(totalCents / 100).toFixed(2)}   可入账: ${credited}   跳过: ${skipped}   失败: ${failed}`);
  console.log(dryRun ? '（干跑模式：未实际入账。加 --apply 才入账）' : '（已入账；幂等，重复跑同笔订单不会重复加余额）');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const file = args.find(a => !a.startsWith('--'));
  const dryRun = !(args.includes('--apply') || process.env.LS_RECONCILE_APPLY === '1');
  if (!file) {
    console.log('用法: node reconcile-bank.js <对公流水.csv> [--apply]');
    process.exit(1);
  }
  let text;
  try { text = fs.readFileSync(path.resolve(file), 'utf8'); }
  catch (e) { console.error('读文件失败: ' + e.message); process.exit(1); }
  reconcile(text, dryRun ? null : defaultConfirm, dryRun).then((rows) => {
    printReport(rows, dryRun);
    process.exit(0);
  });
}

module.exports = { parseStatement, parseAmount, reconcile, ORDER_RE };
