// 更新因「去掉人为规则 / 剥离安全认证」重构而合法漂移的 golden 基线。
//
// 纪律（与 _show_drift.mjs 配套）：
//   1. 先跑 `node test/golden/_show_drift.mjs` **逐字段**核实，确认是改进而非谎报；
//   2. 只更新确认过的字段，其余保持逐字节不变（禁止整份重抓 —— 那会掩盖别的漂移）；
//   3. 任何一条改动都要写进 BASELINE-NOTES.md，说明为什么变。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');
const sb = await import(pathToFileURL(path.join(ROOT, 'dist/lingshu.mjs')).href);
const { CASES, norm } = await import('./suite.mjs');
const bp = path.join(ROOT, 'test/golden/baseline.json');
const base = JSON.parse(fs.readFileSync(bp, 'utf8'));

// 本次重构导致的字段漂移白名单（每条都已用 _show_drift.mjs 逐字段核实）
// 说明：全部只涉及 solutions[] 里的**认证元数据**（certified / method /
//   cert 块内的 enclosure+krawczykRadius）消失，以及由认证元数据驱动的
//   provenCount / candidateCount / completenessProven。解向量本身逐位不变
//   （g005/g007 的解值有变，但都是精度提升，见 BASELINE-NOTES.md）。
const WHITELIST = {
  'g001-2d-basic': ['solutions'],
  'g002-2d-resultant': ['solutions'],
  'g003-3d-sphere': ['solutions'],
  'g004-3d-linear': ['solutions'],
  'g005-4d-couple-ok': ['provenCount', 'candidateCount', 'completenessProven', 'solutions'],
  'g006-4d-partial': ['solutions'],
  'g007-5d-chain': ['solutions'],
  'g009-positive-dim': ['provenCount', 'candidateCount', 'solutions'],
  'g011-trig': ['solutions'],
  'g012-abs-miranda': ['solutions'],
  'g013-rational-loan': ['solutions'],
  'g014-division-equation': ['provenCount', 'candidateCount', 'completenessProven', 'solutions'],
  'g015-bezout8': ['solutions'],
  'g017-exp-equation': ['solutions'],
  'g018-inequality-domain': ['solutions'],
  'g019-repeated-root': ['provenCount', 'candidateCount', 'completenessProven', 'solutions'],
  'g020-big-scale': ['provenCount', 'candidateCount', 'completenessProven', 'solutions'],
  // 🔴 2026-10-05 新增：同伦完备性谎报修正导致的 resultTypeName 降级（2 例）
  // 详见 BASELINE-NOTES.md「同伦完备性谎报」一节。要点：
  //   g005 / g007 的**解向量与解数完全未变**，只有对外结论从「全部解」退回「部分解」。
  //   旧基线的「全部解」依据是 `homotopy_all_paths_clean` 这条证据，
  //   而该证据已被实测证伪（同题 27 条路径只覆盖 5/6 个真解）。
  //   两题的 Bézout 上界分别�� 8 与 4，而实解数是 4 与 2 ⇒ 上界非紧 ⇒
  //   按 rootbound-poly.js 的 R1 推论本就是「不可判定」，「部分解」才是诚实结论。
  //   已用 SymPy sp.solve 独立核验 g005 真解恰为 4 个（{1,4}×{2,3} 的排列）。
  'g005-4d-couple-ok': ['provenCount', 'candidateCount', 'completenessProven', 'solutions', 'resultTypeName'],
  'g007-5d-chain': ['provenCount', 'candidateCount', 'completenessProven', 'solutions', 'resultTypeName'],
};

let changed = 0, names = [];
for (let i = 0; i < CASES.length; i++) {
  const [name, eqs, vs] = CASES[i];
  const allow = WHITELIST[name];
  if (!allow) continue;
  let cur;
  try { cur = norm(sb.solve(eqs, vs, 6)); } catch (e) { continue; }
  let touched = false;
  for (const f of allow) {
    if (JSON.stringify(base[i].result[f]) === JSON.stringify(cur[f])) continue;
    base[i].result[f] = cur[f];
    changed++; touched = true;
  }
  if (touched) names.push(name);
}
fs.writeFileSync(bp, JSON.stringify(base, null, 2), 'utf8');
console.log('updated ' + changed + ' fields across ' + names.length + ' cases:');
for (const n of names) console.log('  - ' + n);
