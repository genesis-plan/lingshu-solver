// 灵数能力边界实测：覆盖各计算类型，每题带已知真解（ground truth）
// 目的：用数据回答"它到底缺什么"，而不是凭猜。
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const core = require('D:/Projects/genesis-plan/lingshu-solver/solver-core.js');

// check: (vals) => bool  验证一组解是否正确
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const CASES = [
  // ── 一元 ──
  { t: '一元一次', eqs: ['2*x + 3 = 7'], v: ['x'], exp: 1, check: (s) => s.some(v => near(v[0], 2)) },
  { t: '一元二次(双根)', eqs: ['x^2 - 4 = 0'], v: ['x'], exp: 2, check: (s) => [-2, 2].every(r => s.some(v => near(v[0], r))) },
  { t: '一元三次', eqs: ['x^3 - 6*x^2 + 11*x - 6 = 0'], v: ['x'], exp: 3, check: (s) => [1, 2, 3].every(r => s.some(v => near(v[0], r, 1e-5))) },
  { t: '一元四次', eqs: ['x^4 - 10*x^2 + 9 = 0'], v: ['x'], exp: 4, check: (s) => [1, 3, -1, -3].every(r => s.some(v => near(v[0], r, 1e-5))) },
  { t: '超越 sin 多根', eqs: ['sin(x) = 0'], v: ['x'], exp: 'many', check: (s) => s.length >= 3 },
  { t: '超越 cos(x)=x', eqs: ['cos(x) = x'], v: ['x'], exp: 1, check: (s) => s.some(v => near(v[0], 0.7390851332)) },
  { t: '指数方程', eqs: ['2^x = 8'], v: ['x'], exp: 1, check: (s) => s.some(v => near(v[0], 3, 1e-5)) },
  { t: '对数方程', eqs: ['ln(x) = 2'], v: ['x'], exp: 1, check: (s) => s.some(v => near(v[0], 7.389056099, 1e-5)) },
  { t: '分式方程', eqs: ['1/x + 1/(x-1) = 3'], v: ['x'], exp: 1, check: (s) => s.some(v => near(v[0], 1.788854382, 1e-5)) },
  { t: '绝对值', eqs: ['abs(x - 1) = 3'], v: ['x'], exp: 2, check: (s) => [-2, 4].every(r => s.some(v => near(v[0], r, 1e-5))) },

  // ── 多元线性 ──
  { t: '二元线性方阵', eqs: ['x + y = 3', 'x - y = 1'], v: ['x', 'y'], exp: 1, check: (s) => s.some(v => near(v[0], 2) && near(v[1], 1)) },
  { t: '三元线性', eqs: ['x + y + z = 6', '2*x - y = 1', 'y + z = 3'], v: ['x', 'y', 'z'], exp: 1, check: (s) => s.some(v => near(v[0], 3) && near(v[1], 5) && near(v[2], -2)) },
  { t: '六元线性(上限)', eqs: ['x1+x2+x3+x4+x5+x6=21','x1-x2=1','x2-x3=1','x3-x4=1','x4-x5=1','x5-x6=1'], v: ['x1','x2','x3','x4','x5','x6'], exp: 1, check: (s) => s.some(v => Math.abs(v[0] - 6) < 1e-4) },
  { t: '线性欠定(无穷解)', eqs: ['x + y = 3'], v: ['x', 'y'], exp: 'inf', check: () => true },
  { t: '线性超定(过约束)', eqs: ['x + y = 3', 'x - y = 1', 'x + y = 9'], v: ['x', 'y'], exp: 0, check: (s) => s.length === 0 || !s.some(v => near(v[0], 2) && near(v[1], 1)) },

  // ── 多元非线性 ──
  { t: '圆+线', eqs: ['x^2 + y^2 = 4', 'x + y = 2'], v: ['x', 'y'], exp: 2, check: (s) => [[2, 0], [0, 2]].every(([a, b]) => s.some(v => near(v[0], a, 1e-5) && near(v[1], b, 1e-5))) },
  { t: '对称型 xy=6', eqs: ['x * y = 6', 'x + y = 5'], v: ['x', 'y'], exp: 2, check: (s) => [[3, 2], [2, 3]].every(([a, b]) => s.some(v => near(v[0], a) && near(v[1], b))) },
  { t: '三元非线性', eqs: ['x*y*z = 6', 'x + y + z = 6', 'x + y - z = 0'], v: ['x', 'y', 'z'], exp: 1, check: (s) => s.some(v => near(v[2], v[0] + v[1], 1e-5)) },
  { t: '含参方程', eqs: ['x + y = 5', 'y - x = 1'], v: ['x', 'y'], exp: 1, check: (s) => s.some(v => near(v[0], 2) && near(v[1], 3)) },

  // ── 混合/困难 ──
  { t: '含超越的多变量', eqs: ['sin(x) + y = 1', 'x - y = 0'], v: ['x', 'y'], exp: 1, check: (s) => s.some(v => Math.abs(Math.sin(v[0]) + v[1] - 1) < 1e-6) },
  { t: '病态(近奇异)', eqs: ['x + y = 1', 'x + 1.0000001*y = 1'], v: ['x', 'y'], exp: 1, check: (s) => s.length >= 1 },
  { t: '无解系统', eqs: ['x^2 + y^2 = 0', 'x + y = 5'], v: ['x', 'y'], exp: 0, check: (s) => s.length === 0 },
  { t: '高次多项式系统', eqs: ['x^2 + y^2 = 1', 'x^3 + y^3 = 0'], v: ['x', 'y'], exp: 'any', check: (s) => s.every(v => near(v[0] * v[0] + v[1] * v[1], 1, 1e-5)) },
  { t: '双曲型', eqs: ['x * y = 12', 'x / y = 3'], v: ['x', 'y'], exp: 1, check: (s) => s.some(v => near(v[0], 6) && near(v[1], 2)) },
  { t: '联立三元高次', eqs: ['x + y + z = 12', 'x*y*z = 36', 'x + y = 2*z'], v: ['x', 'y', 'z'], exp: 'any', check: (s) => s.length >= 1 },
  { t: '混合超越+代数', eqs: ['x*y = 1', 'x + y = cos(0) + 2'], v: ['x', 'y'], exp: 1, check: (s) => s.some(v => near(v[0] * v[1], 1, 1e-6)) }
];

const rows = [];
console.log('=== 灵数能力边界实测（每题带已知真解）===\n');
console.log('  ' + '类型'.padEnd(22) + '预期'.padEnd(7) + '实得'.padEnd(6) + '验证'.padEnd(6) + '耗时ms'.padStart(8) + '  判定');
console.log('  ' + '-'.repeat(72));

for (const c of CASES) {
  let res = null, err = null;
  const t0 = performance.now();
  try { res = core.solve(c.eqs, c.v, 6); } catch (e) { err = e.message || String(e); }
  const ms = performance.now() - t0;
  const sols = (res && res.solutions) || [];
  const vals = sols.map(s => s.values);
  let verdict = '?';
  if (err) verdict = '❌报错';
  else if (vals.length === 0) verdict = (c.exp === 0 || c.exp === 'inf') ? '✅' : '❌漏解';
  else if (!c.check(vals)) verdict = '❌错解';
  else if (c.exp !== 'any' && c.exp !== 'inf' && typeof c.exp === 'number' && vals.length !== c.exp) {
    verdict = (vals.length > c.exp) ? '⚠️多解' : '❌漏解';
  } else verdict = '✅';
  const cert = sols.length ? (sols.every(s => s.certified) ? '全认证' : '含未认证') : '-';
  rows.push({ t: c.t, exp: c.exp, got: vals.length, verdict, ms: Math.round(ms), cert });
  console.log('  ' + c.t.padEnd(22) + String(c.exp).padEnd(7) + String(vals.length).padEnd(6) +
              (vals.length ? (sols.every(s => s.certified) ? '✓' : '✗') : '-').padEnd(6) +
              String(Math.round(ms)).padStart(8) + '  ' + verdict + '  [' + cert + ']');
}

const fail = rows.filter(r => r.verdict.startsWith('❌'));
const warn = rows.filter(r => r.verdict.startsWith('⚠️'));
console.log('\n=== 汇总 ===');
console.log('  探针 ' + rows.length + ' 类：通过 ' + (rows.length - fail.length - warn.length) +
            ' / 多解警告 ' + warn.length + ' / 失败 ' + fail.length);
const avg = Math.round(rows.reduce((a, r) => a + r.ms, 0) / rows.length);
console.log('  平均耗时 ' + avg + ' ms，最慢 ' + Math.max(...rows.map(r => r.ms)) + ' ms');
if (fail.length) {
  console.log('\n  ✗ 失败明细（真正的能力缺口）：');
  fail.forEach(r => console.log('    · ' + r.t + ' —— 预期 ' + r.exp + ' 实得 ' + r.got + ' [' + r.verdict + ']'));
}
if (warn.length) {
  console.log('\n  ⚠️ 多解警告：');
  warn.forEach(r => console.log('    · ' + r.t + ' —— 预期 ' + r.exp + ' 实得 ' + r.got));
}
