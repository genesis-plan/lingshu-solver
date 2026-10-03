// 能力全景扫描：找出剩余缺口（慢 / 错 / 证不出）
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const core = require('D:/Projects/genesis-plan/lingshu-solver/solver-core.js');

const CASES = [
  // [题, 变量, 真解个数或'many', 备注]
  ['x^2 - 2 = 0', ['x'], 2, '二次'],
  ['x^5 - x - 1 = 0', ['x'], 1, '五次（一般不可解）'],
  ['x^8 - 16*x^7 + ... ', ['x'], 0, '占位'],
  ['exp(x) = 3', ['x'], 1, '超越'],
  ['exp(x) = x + 1', ['x'], 1, '超越+线性'],
  ['cos(x) = x', ['x'], 1, '超越不动点'],
  ['x*cos(x) = 1', ['x'], 'many', '超越混合'],
  ['sin(x) = x/2', ['x'], 1, '超越含 x'],
  ['sqrt(x) + sqrt(x+1) = 3', ['x'], 1, '根式'],
  ['x^3 - 3*x + 1 = 0', ['x'], 3, '三根（不可约）'],
  ['(x-1)*(x-2)*(x-3) = 0', ['x'], 3, '可分解'],
  ['x^4 - 10*x^2 + 9 = 0', ['x'], 4, '双二次'],
  ['1/x + 1/y = 3', ['x', 'y'], '2d', '分式二元'],
  ['x*y = 6', ['x', 'y'], 'curve', '正维曲线'],
  ['x^2 + y^2 = 4', ['x', 'y'], 'curve', '圆'],
  ['x^2 - y = 1', ['x', 'y'], 'curve', '抛物线'],
  ['x + y + z = 6', ['x', 'y', 'z'], 'plane', '平面'],
  ['x*y - z = 0', ['x', 'y', 'z'], 'curve3', '锥面'],
  ['x^2 + y^2 + z^2 = 1', ['x', 'y', 'z'], 'sphere', '球面'],
  ['x^2 - 2*y = 3', ['x', 'y'], 'curve', '抛物线'],
  ['tan(x) = x', ['x'], 'many', '超越多根'],
  ['x^2 = 2', ['x'], 2, '√2'],
  ['x^3 = 2', ['x'], 1, '∛2'],
  ['2*x + 3*y = 7', ['x', 'y'], 'line', '欠定线性'],
  ['x^2 + y^2 = 4, x + y = 2', ['x', 'y'], 2, '恰定'],
  ['sin(x)*sin(y) = 0.5', ['x', 'y'], 'many', '超越二元'],
];

console.log('题'.padEnd(30) + '耗时'.padStart(9) + '解数  rt                    备注');
const slow = [], wrong = [];
CASES.forEach(([eq, vns, exp, note]) => {
  if (eq.indexOf('...') >= 0) return;
  // 预热
  for (let k = 0; k < 2; k++) { try { core.solve([eq], vns, 6); } catch (e) {} }
  const ts = [];
  let r;
  for (let k = 0; k < 3; k++) {
    const t0 = performance.now();
    try { r = core.solve([eq], vns, 6); } catch (e) { r = null; }
    ts.push(performance.now() - t0);
  }
  ts.sort((a, b) => a - b);
  const ms = ts[1];
  const s = r ? (r.solutions || []) : [];
  const rt = r ? (r.resultTypeName || '-') : 'THROW';
  const expStr = exp === 'many' ? '≥1' : (typeof exp === 'number' ? String(exp) : exp);
  const nOk = (exp === 'many') ? s.length > 0 : (typeof exp === 'number' ? s.length === exp : true);
  const tag = nOk ? '  ' : '⚠️';
  if (ms > 100) slow.push([eq, ms, s.length, expStr]);
  if (!nOk) wrong.push([eq, s.length, expStr]);
  console.log(tag + ' ' + eq.padEnd(28) + ms.toFixed(1).padStart(8) + 'ms ' +
    String(s.length).padStart(4) + '  ' + String(rt).slice(0, 20).padEnd(20) + ' ' + note +
    '  (应 ' + expStr + ')');
});

console.log('');
console.log('=== 慢题（>100ms）===');
slow.forEach(s => console.log('  ' + s[0].padEnd(30) + s[1].toFixed(0) + 'ms  解=' + s[2] + ' (应 ' + s[3] + ')'));
console.log('');
console.log('=== 解数不符 ===');
if (!wrong.length) console.log('  （无）');
wrong.forEach(w => console.log('  ' + w[0].padEnd(30) + '得 ' + w[1] + ' 应 ' + w[2]));
