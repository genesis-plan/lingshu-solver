'use strict';
// 对账桥单元测试：验证「按订单号匹配 → 调 confirm 入账；无订单号跳过；幂等不重复」
const R = require('../payment-reconciler');
const assert = require('assert');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra != null ? JSON.stringify(extra) : ''); }
}

(async () => {
  const calls = [];
  R.setConfirm((orderId, cents) => { calls.push({ orderId, cents }); return Promise.resolve({ status: 200, json: { creditedCents: cents } }); });
  R._seen.clear();

  // 场景：t1 含订单号+1分；t2 无订单号；t3 含同订单号但 2 分（金额不符，仍应调 confirm 由服务端 409）
  R.setFetch(() => ([
    { txId: 't1', orderRef: '付灵数 LS-20260922-abc123 共1分', amountCents: 1 },
    { txId: 't2', orderRef: '无备注的流水', amountCents: 1 },
    { txId: 't3', orderRef: 'LS-20260922-abc123', amountCents: 2 }
  ]));
  await R.tick();

  ok('t1 命中订单号并调 confirm(1分)', calls.some(c => c.orderId === 'LS-20260922-abc123' && c.cents === 1), calls);
  ok('t3 金额不符仍调 confirm(2分) 交由服务端核对', calls.some(c => c.orderId === 'LS-20260922-abc123' && c.cents === 2), calls);
  ok('t2 无订单号被跳过（不调 confirm）', !calls.some(c => c.cents === 1 && c.orderId == null), calls);
  const abcCalls = calls.filter(c => c.orderId === 'LS-20260922-abc123');
  ok('同订单号两笔流水各调一次', abcCalls.length === 2, abcCalls);

  // 幂等：再次 tick，t1/t3 已 seen，不应再调
  R.setFetch(() => ([
    { txId: 't1', orderRef: 'LS-20260922-abc123', amountCents: 1 },
    { txId: 't3', orderRef: 'LS-20260922-abc123', amountCents: 2 }
  ]));
  const before = calls.length;
  await R.tick();
  ok('幂等：已处理交易号不重复调 confirm', calls.length === before, { before, after: calls.length });

  // 新流水 t4 应被处理
  R.setFetch(() => ([{ txId: 't4', orderRef: 'LS-20260923-def456', amountCents: 1 }]));
  await R.tick();
  ok('t4 新订单号被处理', calls.some(c => c.orderId === 'LS-20260923-def456' && c.cents === 1), calls);

  console.log(`\n对账桥测试：PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
