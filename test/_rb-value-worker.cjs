#!/usr/bin/env node
/**
 * test/_rb-value-worker.cjs — rootbound-value 的单遍执行器（被 spawn 多次）
 *
 * 契约：argv[2] = 题集 JSON 路径；argv[3] = 期望的 MAX_MS。
 * 输出 JSON：{ rbMs[], e2eMs[], proven, dist }。
 *
 * ⚠ LS_RB_MAX_MS 由环境变量传入 —— 根界的 MAX_MS 是模块级 const，
 *   要在多个值之间切换就必须分进程跑（const 在模块加载时就固定了）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = 'D:/Projects/genesis-plan/lingshu-solver';
const RB = require(path.join(ROOT, 'services/rootbound.js'));
const svc = require(path.join(ROOT, 'services/solver-service.js'));
const cases = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const wantMs = parseInt(process.argv[3] || '300', 10);

const rbMs = [], e2eMs = [];
let proven = 0;
const dist = {};
for (const c of cases) {
  const t0 = process.hrtime.bigint();
  let r = null, err = null;
  try { r = RB.rootBounds(c.eqs, c.vars); } catch (e) { err = e.message; }
  const d1 = Number(process.hrtime.bigint() - t0) / 1e6;
  rbMs.push(d1);
  if (r && r.proven) proven++;

  const t1 = process.hrtime.bigint();
  let concl = '?';
  try {
    // ⚠ doSolve 直接返回**对象**（conclusion/canAssert/...），
    //   不是 MCP 的 {content:[{text}]} 包装 —— 第一版按包装解析导致
    //   4态分布全是「Unexpected end of JSON input」（150/150），结论无效。
    const out = svc.doSolve({ equations: c.eqs, variables: c.vars });
    concl = (out && out.conclusion) || '?';
  } catch (e) { concl = 'err:' + e.message; }
  e2eMs.push(Number(process.hrtime.bigint() - t1) / 1e6);
  dist[concl] = (dist[concl] || 0) + 1;
}
process.stdout.write(JSON.stringify({
  rbMs: rbMs.map((x) => Math.round(x * 1000) / 1000),
  e2eMs: e2eMs.map((x) => Math.round(x * 1000) / 1000),
  proven, dist, wantMs,
}));
