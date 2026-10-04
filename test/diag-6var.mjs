// 6 元二次专项诊断：看时间到底花在哪、下一步指令对不对
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const P = require('../solver-core.js').raw();

const eqs = ['x1+x2+x3+x4+x5+x6-6=0', 'x1*x2+x3*x4+x5*x6-3=0', 'x1*x2*x3+x4*x5*x6-2=0',
  'x1^2+x2^2+x3^2+x4^2+x5^2+x6^2-6=0', 'x1-x2+x3-x4+x5-x6=0', 'x1*x6-x2*x5+x3*x4=0'];
const vns = ['x1', 'x2', 'x3', 'x4', 'x5', 'x6'];

const t0 = performance.now();
const r = P.solve(eqs.slice(), vns, 6, null, false, {});
const ms = performance.now() - t0;

console.log('耗时 ' + ms.toFixed(0) + 'ms');
console.log('error =', r.error);
console.log('解数 =', (r.solutions || []).length);
console.log('truncated =', r.truncated, '| confidence =', r.confidence);
console.log('\n── nextAction（给 Agent 的结构化指令）──');
console.log(JSON.stringify(r.nextAction, null, 2));
console.log('\n── message ──');
console.log(r.message);
console.log('\n── operatorProfile (TOP12 耗时) ──');
const prof = (r.meta && r.meta.operatorProfile) || [];
for (const p of prof) console.log(`  ${String(p.ms).padStart(9)}ms  ${p.op.padEnd(8)} ${p.name}  calls=${p.calls} gain=${p.gain} err=${p.errors}`);
console.log('  合计(算子内) =', (r.meta && r.meta.operatorProfileTotalMs), 'ms / elapsedMs =', (r.meta && r.meta.elapsedMs));
