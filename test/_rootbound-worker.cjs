#!/usr/bin/env node
/**
 * test/_rootbound-worker.cjs — rootbound-parity 的单遍执行器（被 spawn 两次）
 *
 * 契约：stdin 无输入；argv[2] 是题集 JSON 路径；stdout 输出 JSON 数组，
 *       每项 { snap, ms }。snap 里的浮点一律 toPrecision(17)（双精度完整表示），
 *       这样「逐位相同」才真的等于 IEEE-754 逐比特相同。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RB = require(path.join(ROOT, 'services/rootbound.js'));
const cases = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

function snap(rb) {
  return {
    proven: rb.proven, truncated: rb.truncated, combos: rb.combos,
    halfWidths: rb.halfWidths.map((w) => (isFinite(w) ? w.toPrecision(17) : String(w))),
    perVar: rb.perVar.map((p) => ({
      name: p.name, pairs: p.pairs,
      minAbs: p.minAbs === null ? null : p.minAbs.toPrecision(17),
      maxAbs: p.maxAbs === null ? null : p.maxAbs.toPrecision(17),
    })),
    unbounded: rb.unbounded.slice(), free: rb.free.slice(),
    zeroCoordinateRisk: rb.zeroCoordinateRisk,
    zeroCoordinateIndices: rb.zeroCoordinateIndices.slice(),
    supportTermTotal: rb.supportTermTotal,
    reason: rb.reason,
  };
}

const out = [];
for (const c of cases) {
  const t0 = process.hrtime.bigint();
  let s, err = null;
  try { s = snap(RB.rootBounds(c.eqs, c.vars)); } catch (e) { s = { error: e.message }; err = e.message; }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  out.push({ snap: s, ms: Math.round(ms * 1000) / 1000, err });
}
process.stdout.write(JSON.stringify(out));
