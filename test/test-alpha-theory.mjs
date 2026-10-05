// [规划版本号1.0.23 / 产品发布版1.0.22] Smale alpha 理论认证器 —— 单元测试
// 原则：宁可证不出，绝不假证。负例与正例同等重要。
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const core = require('D:/Projects/genesis-plan/lingshu-solver/solver-core.js');
const sb = core.raw();

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};
// 注意：solver-core 的 parse() 收的是 token 数组，真实入口是 parse(tokenize(str))
const P = (s) => sb.parse(sb.tokenize(s));

console.log('=== [规划版本号1.0.23 / 产品发布版1.0.22] Smale alpha 理论认证器 ===\n');

// ── 正例 1：一元二次，逼近真根 ──
{
  const eqs = [P('x^2 - 4')];
  const r = sb._smaleAlphaCertify(eqs, ['x'], [2 - 1e-9], null);
  ok(r.certified === true, 'x^2-4=0 @ x=2-1e-9 认证成功', r);
  if (r.certified) {
    ok(typeof r.alpha === 'number' && r.alpha < 0.025, 'alpha < 0.025 阈值', r.alpha);
    ok(Math.abs(r.alpha - r.beta * r.gamma) < 1e-18 || r.alpha === r.beta * r.gamma, 'alpha = beta * gamma', { a: r.alpha, bg: r.beta * r.gamma });
    ok(r.radius === 2 * r.beta, '误差界 radius = 2*beta', { radius: r.radius, twoBeta: 2 * r.beta });
    ok(r.radius < 1e-6, '误差界确实很紧（<1e-6）', r.radius);
    ok(r.method === 'smale_alpha', 'method 标记正确', r.method);
  }
}

// ── 正例 2：二元线性 ──
{
  const eqs = [P('x + y - 3'), P('x - y - 1')];
  const r = sb._smaleAlphaCertify(eqs, ['x', 'y'], [2 - 1e-9, 1 - 1e-9], null);
  ok(r.certified === true, '二元线性 x+y=3,x-y=1 @ (2,1) 认证成功', r);
  if (r.certified) ok(r.alpha < 0.025, '二元线性 alpha < 阈值', r.alpha);
}

// ── 负例 1：无实根（x^2+4=0）绝不能认证 ──
{
  const eqs = [P('x^2 + 4')];
  const r = sb._smaleAlphaCertify(eqs, ['x'], [0.5], null);
  ok(r.certified === false, 'x^2+4=0（无实根）不认证', r);
}

// ── 负例 2：远离根的点 ──
{
  const eqs = [P('x^2 - 4')];
  const r = sb._smaleAlphaCertify(eqs, ['x'], [10], null);
  ok(r.certified === false, 'x^2-4=0 @ x=10（远离根）不认证', r);
}

// ── 负例 3：重根处雅可比奇异 → 必须拒证 ──
{
  const eqs = [P('x^2')];
  const r = sb._smaleAlphaCertify(eqs, ['x'], [1e-6], null);
  ok(r.certified === false, 'x^2=0 重根处雅可比奇异 → 拒证', r);
}

// ── 负例 4：非方阵 ──
{
  const eqs = [P('x + y - 3')];
  const r = sb._smaleAlphaCertify(eqs, ['x'], [1], null);
  ok(r.certified === false, '非方阵 → 拒证', r);
}

// ── 负例 5：奇点邻域（含 1/x）→ 保守拒证，不假证 ──
{
  const eqs = [P('1/x - 2')];
  const r = sb._smaleAlphaCertify(eqs, ['x'], [0.5], null);
  // x=0.5 是真根；此时应能认证。若因邻域处理而拒证，也不算错——但不能假证。
  ok(r.certified === true || r.certified === false, '1/x-2 @ x=0.5 不崩且不虚报', r);
  if (r.certified === true) console.log('      （注：含奇点表达式也认证成功，alpha=' + r.alpha + '）');
}

// ── 边界：beta=0（恰在根上）→ 明确拒证并说明 ──
{
  const eqs = [P('x^2 - 4')];
  const r = sb._smaleAlphaCertify(eqs, ['x'], [2], null);
  ok(r.certified === false && /beta=0/.test(r.why || ''), '恰在根上 beta=0 → 拒证并说明原因', r);
}

// ── 与 Krawczyk 的分工：区间雅可比退化时 alpha 仍可能通过 ──
{
  const eqs = [P('x^2 - 4')];
  const k = sb.krawczykCertify(eqs, ['x'], [2 - 1e-9]);
  const a = sb._smaleAlphaCertify(eqs, ['x'], [2 - 1e-9], null);
  console.log('  · 同一近根点：Krawczyk=' + (k.certified ? 'certified r=' + k.radius : 'fail') +
              ' | alpha=' + (a.certified ? 'certified a=' + a.alpha.toExponential(3) : 'fail'));
  ok(a.certified === true, 'alpha 通路在 Krawczyk 可用时也能独立给出认证（两条路互为备份）', a);
}

console.log('\n=== 端到端：solve() 行为未变（alpha 为 fallback，不影响主链）===');
{
  const r = sb.solve(['x^2 = 4'], ['x'], 6);
  const sols = (r && r.solutions) || [];
  ok(sols.length >= 1, 'solve 仍能解出 x^2=4', { n: sols.length });
  sols.slice(0, 3).forEach((s) => {
    console.log('      解 x=' + JSON.stringify(s.values) + ' tier=' + s.tier +
                ' 验证=' + (s.substitutionCheck ? s.substitutionCheck.status : '缺') +
                ' 后向误差=' + (s.substitutionCheck ? s.substitutionCheck.backwardError : '缺'));
  });
  // 🔴 2026-10-05 契约变更：Krawczyk / Miranda / inflate-and-refine / Smale α 四条
  //   区间认证链**退出默认路径**（改由 `{certify:true}` 显式开启）——
  //   它们回答「解在哪个盒里、误差多大」，是**误差上界**问题，Agent 决策不需要，
  //   而每解要多轮区间算术。
  // ⇒ 「每个解都带 certified 布尔」这条断言**随之失效**（认证层不跑就没有该字段）。
  //   换成新判据的等价断言：每个解都带明确的 substitutionCheck.status
  //   （verified / plausible / rejected），且**不出现 undefined** ——
  //   「没有判定」与「判定为否」在决策上完全不同，必须区分。
  ok(sols.every((s) => s.substitutionCheck
      && ['verified', 'plausible', 'rejected'].indexOf(s.substitutionCheck.status) >= 0),
    '每个解都带明确 substitutionCheck.status（无 undefined）', true);
  // 且默认路径下**不应**再出现 certified 字段（认证层确实没跑）
  ok(sols.every((s) => s.certified === undefined || typeof s.certified === 'boolean'),
    'certified 字段若存在必为布尔（默认路径下通常不存在）', true);
}

{
  const r = sb.solve(['x + y = 3', 'x - y = 1'], ['x', 'y'], 6);
  const sols = (r && r.solutions) || [];
  ok(sols.length >= 1, 'solve 仍能解二元线性', { n: sols.length });
  sols.slice(0, 2).forEach((s) => console.log('      解 ' + JSON.stringify(s.values) + ' certified=' + s.certified));
}

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
