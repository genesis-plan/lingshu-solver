'use strict';
/**
 * 灵数求解器 · 回归测试套件（零依赖）
 * 抽 solver-core 实跑 benchmarks/ 下三套常驻考卷，比对 known 参考解 + 统计 tier 与 truncated。
 * 运行：node test/regression.js
 */
const fs = require('fs');
const path = require('path');
const { solve } = require('../solver-core');

const TOL = 0.01; // known 参考解多四舍五入到 4 位小数，0.01 容差足够

function loadSet(file) {
  const p = path.resolve(__dirname, 'benchmarks', file);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  return j.cases || [];
}

function hitKnown(known, solutions) {
  // 每个 known 点是否被某个 solution 命中
  const solVals = solutions.map(s => (s && Array.isArray(s.values) ? s.values : []));
  let hit = 0;
  for (const k of known) {
    let ok = false;
    for (const sv of solVals) {
      if (sv.length !== k.length) continue;
      let d = 0;
      for (let i = 0; i < k.length; i++) d = Math.max(d, Math.abs(sv[i] - k[i]));
      if (d <= TOL) { ok = true; break; }
    }
    if (ok) hit++;
  }
  return { hit, total: known.length };
}

function runSet(file) {
  const cases = loadSet(file);
  let nCase = 0, nCrash = 0, nTrunc = 0;
  let knownTotal = 0, knownHit = 0;
  const tiers = { proven: 0, candidate: 0, structural: 0, unknown: 0 };
  const fails = [];
  for (const c of cases) {
    nCase++;
    let r;
    try {
      r = solve(c.eq, c.vars || [], 6, c.dom);
    } catch (e) {
      nCrash++;
      fails.push({ id: c.id, err: e.message });
      continue;
    }
    const sols = r.solutions || [];
    if (r.meta && r.meta.truncated) nTrunc++;
    for (const s of sols) tiers[s.tier || 'unknown'] = (tiers[s.tier || 'unknown'] || 0) + 1;
    if (Array.isArray(c.known) && c.known.length) {
      const h = hitKnown(c.known, sols);
      knownTotal += h.total; knownHit += h.hit;
      if (h.hit < h.total) fails.push({ id: c.id, miss: h.total - h.hit, got: sols.length, known: h.total });
    }
  }
  return { file, nCase, nCrash, nTrunc, knownTotal, knownHit, tiers, fails };
}

const sets = ['own.json', 'mcp.json', 'textbook.json'];
console.log('=== 灵数求解器 回归套件 ===');
let totCase = 0, totCrash = 0, totTrunc = 0, totKT = 0, totKH = 0;
for (const s of sets) {
  const r = runSet(s);
  totCase += r.nCase; totCrash += r.nCrash; totTrunc += r.nTrunc;
  totKT += r.knownTotal; totKH += r.knownHit;
  console.log(`\n[${r.file}] 用例=${r.nCase} 崩溃=${r.nCrash} 截断=${r.nTrunc}`);
  console.log(`  known 命中=${r.knownHit}/${r.knownTotal} (${(100 * r.knownHit / Math.max(1, r.knownTotal)).toFixed(1)}%)`);
  console.log(`  tier: proven=${r.tiers.proven} candidate=${r.tiers.candidate} structural=${r.tiers.structural} unknown=${r.tiers.unknown}`);
  if (r.fails.length) {
    console.log('  未完全命中/异常:');
    for (const f of r.fails.slice(0, 12)) console.log('    -', JSON.stringify(f));
  }
}
console.log('\n=== 汇总 ===');
console.log(`总用例=${totCase} 崩溃=${totCrash} 截断=${totTrunc}`);
console.log(`known 总命中=${totKH}/${totKT} (${(100 * totKH / Math.max(1, totKT)).toFixed(1)}%)`);
console.log(totCrash === 0 ? '✅ 无崩溃' : '❌ 有崩溃');
process.exit(totCrash === 0 ? 0 : 1);
