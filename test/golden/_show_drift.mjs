// 逐条列出 golden 漂移的**字段级**差异，用于人工核实「是改进还是谎报」。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');
const sb = await import(pathToFileURL(path.join(ROOT, 'dist/lingshu.mjs')).href);
const { CASES, norm } = await import('./suite.mjs');
const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/golden/baseline.json'), 'utf8'));

const only = process.argv[2] ? new RegExp(process.argv[2]) : null;

for (let i = 0; i < CASES.length; i++) {
  const [name, eqs, vs] = CASES[i];
  if (only && !only.test(name)) continue;
  const b = base[i].result || {};
  let cur;
  try { cur = norm(sb.solve(eqs, vs, 6)); } catch (e) { console.log('== ' + name + ' THROW ' + e.message); continue; }
  const keys = new Set([...Object.keys(b), ...Object.keys(cur || {})]);
  const diffs = [];
  for (const k of keys) {
    const bv = JSON.stringify(b[k]), cv = JSON.stringify(cur ? cur[k] : undefined);
    if (bv !== cv) diffs.push('  ' + k + '\n      base: ' + String(bv).slice(0, 150) + '\n      cur : ' + String(cv).slice(0, 150));
  }
  if (diffs.length) {
    console.log('== ' + name + '  ' + JSON.stringify(eqs).slice(0, 80) + '  (' + diffs.length + ' 字段)');
    console.log(diffs.join('\n'));
  }
}
