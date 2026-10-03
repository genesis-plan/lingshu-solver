// 黄金基线用例集（重构前后共用同一份，避免用例漂移导致「对拍通过了但其实测的是另一回事」）
// 归一化口径抽到 ./norm.mjs，与 capture_original.mjs（抓基线）共用，杜绝两边口径不一致。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CASES, norm } from './norm.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const entry = path.join(ROOT, 'dist/lingshu.mjs');
if (!fs.existsSync(entry)) { console.error('先跑 node scripts/build.mjs 再对拍'); process.exit(1); }
const sb = await import(pathToFileURL(entry).href);

export { CASES, norm };

export function runAll() {
  const out = [];
  for (const [name, eqs, vs] of CASES) {
    const rec = { name, eqs, varNames: vs };
    try {
      rec.result = norm(sb.solve(eqs, vs, 6));
    } catch (e) {
      rec.throw = String((e && e.message) || e);
    }
    out.push(rec);
    process.stdout.write('.');
  }
  process.stdout.write('\n');
  return out;
}
