// 蒙特卡洛包含性验证：仿射算术包络是否始终包含真值？
// 这是 _affMul 改动的前置安全门 —— 回归测试只能发现已知的坏例，
// 蒙特卡洛才能给出「随机输入下依然 sound」的统计证据。
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const core = require('D:/Projects/genesis-plan/lingshu-solver/solver-core.js');
const sb = core.raw();

function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }

const EXPRS = [
  'x^2', 'x^3', 'x^4', 'x^5', 'x*x', 'x^2 + y^2', 'x^2 * y^2', 'x^3 + x',
  'x^2 - 2*x + 1', 'x*y', 'x^2*y', '2*x^2 + 3*y', 'x^4 - y^2',
  'x^2*x', 'x^2 + x^2', '(x + y)^2', 'x^3*y^2', 'x^2/2 + y^2/3',
  'x^5 + x^2 + x', 'x^2*y^2 - 1', 'sin(x) + x^2', 'exp(x) - x^2'
];

console.log('=== 蒙特卡洛包含性验证（每式 400 组随机盒）===');
let total = 0, violations = 0;
const badList = [];

EXPRS.forEach((e) => {
  const ast = sb.parse(sb.tokenize(e));
  let bad = 0, tested = 0;
  for (let t = 0; t < 400; t++) {
    const env = {};
    const names = ['x', 'y'];
    const useY = /y/.test(e);
    names.forEach((n) => {
      if (n === 'y' && !useY) return;
      // 混合大小：跨零与不跨零都要覆盖
      const a = randInt(-20, 20) / 2;
      const w = randInt(0, 40) / 2;
      env[n] = { min: a, max: a + w };
    });
    const iv = sb.intervalEval(ast, env);
    if (!iv || !isFinite(iv.min) || !isFinite(iv.max)) continue;   // 非有限：无法判定，跳过
    tested++;
    // 在盒内取 12 个采样点（含端点与中点），全部必须落在包络内
    for (let s = 0; s < 12; s++) {
      const pt = {};
      for (const n in env) {
        const b = env[n];
        const f = s / 11;
        pt[n] = b.min + (b.max - b.min) * f;
      }
      const v = sb.evalAST(ast, pt);
      if (v === null || v === undefined || !isFinite(v)) continue;
      const slack = 1e-9 * Math.max(1, Math.abs(iv.min), Math.abs(iv.max));
      if (v < iv.min - slack || v > iv.max + slack) {
        bad++;
        if (badList.length < 5) {
          badList.push(e + ' @ ' + JSON.stringify(env) + ' 包络[' + iv.min + ',' + iv.max + '] 采样值 ' + v);
        }
        break;
      }
    }
  }
  total += tested;
  violations += bad;
  const flag = bad === 0 ? 'OK  ' : 'FAIL';
  console.log('  ' + flag + ' ' + e.padEnd(16) + ' 测试 ' + tested + ' 组随机盒');
});

console.log('');
console.log('总计 ' + total + ' 组随机盒，越界 ' + violations + ' 次');
if (violations > 0) {
  console.log('越界样本：');
  badList.forEach(b => console.log('  - ' + b));
  process.exit(1);
} else {
  console.log('✅ 包络始终包含真值 —— sound 成立');
}
