// 决策导向测量（Agent 客群专用工具，非回归测试）
//
// 用法：node test/measure-decision.mjs
// 用途：改动引擎后跑一遍，看「决策价值 / 时间代价」比的变化。这是本项目的
//       **北极星指标** —— 用户明确要的是「Agent 能得到一个决策结果，
//       而不是得到全部结果」，所以验收标准不是完备性而是「能不能决策」。
//       因此本脚本【不进 verify 链】：它没有断言，只出测量表，靠人看数字。
//
// Agent 真实关心的三件事
//   ① 数学对不对（解的残差、是否假解）
//   ② 花了多少时间
//   ③ Agent 拿到的是不是一个【能决策的结论】，而不是一堆未标注的数
// 本脚本不做认证完备性证明（用户已明确：那不是重点），只测「决策价值 / 时间代价」比。
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const P = require('../solver-core.js').raw();

// Agent 实际会问的问题类型：日常建模，不是学术完备性题
const CASES = [
  ['金融复利', ['r*(1+r)^10-1000=0'], ['r']],
  ['等速运动', ['t^2-4*t+3=0'], ['t']],
  ['混合配比', ['0.3*x+0.7*y-500=0', 'x+y-1000=0'], ['x', 'y']],
  ['约束优化', ['x^2+y^2-100=0', 'x-y=0'], ['x', 'y']],
  ['盈亏平衡', ['p*q-50000=0', 'p+q-500=0'], ['p', 'q']],
  ['3元线性', ['a+b+c-100=0', 'a-b=10', 'b-c=5'], ['a', 'b', 'c']],
  ['4元线性', ['a+b+c+d-100=0','a-b=1','b-c=2','c-d=3'], ['a','b','c','d']],
  ['6元线性', ['a+b+c+d+e+f-60=0','a-b=1','b-c=1','c-d=1','d-e=1','e-f=1'], ['a','b','c','d','e','f']],
  ['非线性2x2', ['x^2+y^2-25=0','x*y-6=0'], ['x','y']],
  ['三元非线性', ['x^2+y^2+z^2-9=0','x+y+z-5=0','x-y=0'], ['x','y','z']],
  ['6元二次', ['x1+x2+x3+x4+x5+x6-6=0','x1*x2+x3*x4+x5*x6-3=0','x1*x2*x3+x4*x5*x6-2=0','x1^2+x2^2+x3^2+x4^2+x5^2+x6^2-6=0','x1-x2+x3-x4+x5-x6=0','x1*x6-x2*x5+x3*x4=0'], ['x1','x2','x3','x4','x5','x6']],
  ['超越方程', ['x-cos(x)-1=0'], ['x']],
  ['对数方程', ['log(x)-x+2=0'], ['x']],
];

const vnsForTok = ['a','b','c','d','e','f','x','y','z','p','q','r','t','x1','x2','x3','x4','x5','x6'];
const toAst = eq => {
  const i = eq.indexOf('=');
  if (i < 0) {
    // ⚠ 无 '=' 的方程：不要瞎拆（拆出空串会算出假残差，2026-10-04 踩过：
    //   'a+b+c+d+e+f-60' 被拆成 lhs='a+...-60' + rhs='' ⇒ eval 出 -5.78 的假残差，
    //   一度被我误判成「6元线性是假解」）。直接整体当表达式。
    return P.parse(P.tokenize(eq, vnsForTok));
  }
  return { type: 'binop', op: '-', left: P.parse(P.tokenize(eq.slice(0, i), vnsForTok)), right: P.parse(P.tokenize(eq.slice(i + 1), vnsForTok)) };
};

console.log('题名'.padEnd(14) + 'ms'.padStart(8) + '解数'.padStart(6) + '最大残差'.padStart(12) +
  '路径'.padEnd(22) + 'Agent 能不能决策');
console.log('─'.repeat(110));

let totMs = 0, slow = [], unusable = [];
for (const [name, eqs, vns] of CASES) {
  const t0 = performance.now();
  let r;
  try {
    r = P.solve(eqs.slice(), vns, 6, null, false, {});
  } catch (e) {
    console.log(name.padEnd(14) + '  CRASH ' + e.message.slice(0, 50));
    continue;
  }
  const ms = performance.now() - t0;
  totMs += ms;
  const sols = r.solutions || [];
  // 真解残差（自己算，不信引擎自报）
  let maxRes = 0;
  for (const s of sols) {
    const vmap = {};
    vns.forEach((v, i) => vmap[v] = s.values[i]);
    for (const e of eqs) {
      try {
        const a = toAst(e);
        const val = Math.abs(P.evalAST(a, vmap));
        if (isFinite(val) && val > maxRes) maxRes = val;
      } catch (_) { /* ignore */ }
    }
  }
  const path = (r.executionPath || r.error || '?').slice(0, 20);
  // Agent 决策可用性判定：有没有「能行动」的结论
  let decidable;
  if (r.error === 'NO_SOLUTION' || r.provenEmpty === true) decidable = '可决策(判无解)';
  else if (maxRes > 1e-6) decidable = '★不可用(残差过大)';
  else if (sols.length === 0) decidable = '★不可用(0解但无证明)';
  else if (r.truncated) decidable = '可用(截断已标注)';
  else decidable = '可用';
  if (ms > 500) slow.push(name + ' ' + ms.toFixed(0) + 'ms');
  if (decidable.startsWith('★')) unusable.push(name);
  console.log(name.padEnd(14) + ms.toFixed(1).padStart(8) + String(sols.length).padStart(6) +
    maxRes.toExponential(1).padStart(12) + path.padEnd(22) + decidable);
}
console.log('─'.repeat(110));
console.log('总耗时 ' + totMs.toFixed(0) + 'ms | 慢题(>500ms): ' + (slow.join(', ') || '无') +
  ' | Agent 不可用: ' + (unusable.join(', ') || '无'));
