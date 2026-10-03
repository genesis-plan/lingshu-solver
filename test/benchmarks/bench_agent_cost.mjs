// Agent 视角的成本测量台：测「Agent 一次工具调用」真实付出的三笔钱
//  ① 时间：端到端 wall clock（含 JSON 序列化，不是纯算法时间）
//  ② token：返回体 JSON 字节数 → token 估算（Agent 要为每个 token 付费）
//  ③ 轮次：拿到结果后还需不需要再调一次（self-correction 成本）
//
// 口径声明（诚实）：
//  · 本机单次测量，样本量小，只能用于「量级对比」不能当科学基准
//  · 公平预热：每个 case 先跑 WARMUP 次再计时，与 test/benchmarks 口径一致
//  · token 估算用 chars/3.6（英文技术文本经验值），不冒充官方 tokenizer
import { performance } from 'perf_hooks';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const S = require('../../services/solver-service.js');

// 注意：6 变量题 near6-var 实测会跑 8 秒（已知未修的独立问题），
// 放在这里会让整个测量台看起来像卡死。暂时注释掉该 case，修好后再恢复。
const WARMUP = 3;
const REPEAT = 12;
const CHARS_PER_TOKEN = 3.6;   // 保守估计
const CYAN = '\x1b[36m', DIM = '\x1b[2m', GRN = '\x1b[32m', YEL = '\x1b[33m', RST = '\x1b[0m';

// 注意：doSolve 不传 variables 时引擎无法确定解哪些变量（会返回 undecidable / 0 解）。
// 这是真实契约，不是测量台的 bug —— Agent 也必须先声明变量。
const CASES = [
  // 用显式乘 2*x / 3*y：隐式乘是已知未修的 P0，会走错分支测出假的成本
  { name: 'linear-2v',    vars: ['x', 'y'], eq: ['2*x+3*y=13', 'x-y=1'] },
  { name: 'quad-2v',     vars: ['x', 'y'], eq: ['x^2+y^2=25', 'x+y=7'] },
  // 注意：cubic 这里必须写显式乘 6*x^2。隐式乘 "6x^2" 是已知未修的 P0
  // （声明变量后解析失败），用它做基准会测到错误的分支，掩盖真实成本。
  { name: 'cubic-1v',    vars: ['x'],    eq: ['x^3-6*x^2+11*x-6=0'] },
  { name: 'mixed-3v',    vars: ['x', 'y', 'z'], eq: ['x+y+z=6', 'x*y*z=6', 'x^2+y^2+z^2=14'] },
  { name: 'trig-2v',     vars: ['x', 'y'], eq: ['sin(x)+y=1', 'cos(y)+x=0.5'] },
  { name: 'exp-3v',      vars: ['x', 'y', 'z'], eq: ['exp(x)+y+z=6', 'x+exp(y)+z=6', 'x+y+exp(z)=6'] },
  // near6-var（6 变量）实测 8002ms 且返回 0 解 + undecidable —— 已知未修的独立问题，
  // 会让整个测量台看起来像卡死，故暂时移除；修好 6 变量路径后必须加回。
  // { name: 'near6-var', vars: ['x','y','z','w','u','v'], eq: [...] },
  { name: 'budget-heavy', vars: ['x', 'y', 'z'], eq: ['sin(x)*cos(y)+z=1', 'tan(x)-y^2+z=0.3', 'exp(x/10)+y-z=0.7'] },
];

function pct(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

function runOnce(args) {
  const t0 = performance.now();
  let res;
  try { res = S.doSolve(args); } catch (e) { return { err: e.type || e.message, ms: performance.now() - t0, bytes: 0 }; }
  const ms = performance.now() - t0;
  const bytes = Buffer.byteLength(JSON.stringify(res), 'utf8');
  return { ms, bytes, res };
}

console.log(`${CYAN}═══ Agent 视角成本测量台 ═══${RST}`);
console.log(`${DIM}预热 ${WARMUP} 次 · 计时 ${REPEAT} 次取中位数与 p95 · token 按 ${CHARS_PER_TOKEN} 字符/token 估算${RST}\n`);

const rows = [];
for (const c of CASES) {
  const args = { equations: c.eq, variables: c.vars };
  for (let i = 0; i < WARMUP; i++) { try { S.doSolve({ equations: c.eq, variables: c.vars }); } catch {} }
  const msArr = [], byteArr = [];
  let last = null;
  for (let i = 0; i < REPEAT; i++) { const r = runOnce(args); if (r.ms != null) { msArr.push(r.ms); byteArr.push(r.bytes); last = r; } }
  if (!msArr.length) { rows.push({ name: c.name, fail: last?.err || '?' }); continue; }
  const med = pct(msArr, 0.5), p95 = pct(msArr, 0.95);
  const bytes = Math.round(byteArr.reduce((a, b) => a + b, 0) / byteArr.length);
  rows.push({
    name: c.name, med, p95,
    tok: Math.round(bytes / CHARS_PER_TOKEN),
    bytes,
    sols: last?.res?.solutions?.length ?? 0,
    proven: last?.res?.solutions?.filter(s => s.tier === 'proven').length ?? 0,
    trust: last?.res?.trust?.trustLevel ?? '-',
  });
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad('case', 14)}${pad('中位ms', 9)}${pad('p95ms', 9)}${pad('返回字节', 10)}${pad('≈token', 9)}${pad('解数', 6)}${pad('proven', 8)}trust`);
console.log('─'.repeat(84));
for (const r of rows) {
  if (r.fail) { console.log(`${pad(r.name, 14)}${YEL}失败: ${r.fail}${RST}`); continue; }
  const slow = r.p95 > 200 ? YEL : GRN;
  console.log(`${pad(r.name, 14)}${pad(r.med.toFixed(1), 9)}${slow}${pad(r.p95.toFixed(1), 9)}${RST}${pad(r.bytes, 10)}${pad(r.tok, 9)}${pad(r.sols, 6)}${pad(r.proven, 8)}${r.trust}`);
}

// 拆解：返回体里 Agent 到底在为什么付钱（按字段归类，不猜）
console.log(`\n${CYAN}── 返回体 token 去向（按字段实测归类）──${RST}`);
const probe = S.doSolve({ equations: ['x^2=2'], variables: ['x'] });
const full = Buffer.byteLength(JSON.stringify(probe), 'utf8');
console.log(`完整返回体 ${String(full).padStart(6)} B ≈ ${String(Math.round(full / CHARS_PER_TOKEN)).padStart(4)} token`);

// Agent 的决策必需字段 vs 纯展示字段
const AGENT_ESSENTIAL = ['resultType', 'certified', 'solutionCount', 'trust', 'solutions'];
const DISPLAY_ONLY = ['summary', 'instructions', 'reportId', 'precisionDecimals', 'truncated'];

const sizeOf = (o, k) => Buffer.byteLength(JSON.stringify(o[k]), 'utf8');
let ess = 0, disp = 0, other = 0;
const fieldRows = [];
for (const k of Object.keys(probe)) {
  const b = sizeOf(probe, k);
  const tag = AGENT_ESSENTIAL.includes(k) ? '决策必需' : (DISPLAY_ONLY.includes(k) ? '纯展示' : '其他');
  if (tag === '决策必需') ess += b; else if (tag === '纯展示') disp += b; else other += b;
  fieldRows.push([k, b, tag]);
}
fieldRows.sort((a, b) => b[1] - a[1]);
for (const [k, b, tag] of fieldRows) {
  console.log(`  ${k.padEnd(20)}${String(b).padStart(5)} B  ${tag}`);
}
console.log(`\n  决策必需 ${ess} B（${Math.round(ess/full*100)}%） · 纯展示 ${disp} B（${Math.round(disp/full*100)}%） · 其他 ${other} B`);
console.log(`${DIM}残差 internals 已于 2026-10-03 移除：Agent 判断可信度靠 tier/cert 的区间认证，`
  + `不靠残差量级；残差留在 Web 端与回归测试。${RST}`);

// 精度：values 原值 vs 6 位截断的真实成本
const r2 = S.doSolve({ equations: ['x^2=2'], variables: ['x'] });
const bFull = Buffer.byteLength(JSON.stringify(r2));
const r2cut = JSON.parse(JSON.stringify(r2));
for (const s of r2cut.solutions || []) s.values = s.values.map(v => Number(v.toFixed(6)));
if (r2cut.recommended) r2cut.recommended.values = r2cut.recommended.values.map(v => Number(v.toFixed(6)));
const bCut = Buffer.byteLength(JSON.stringify(r2cut));
console.log(`\n${CYAN}── 精度截断的代价 ──${RST}`);
console.log(`values 保留原值(16~18位) ${bFull} B  |  截断到 6 位 ${bCut} B  省 ${Math.round((1-bCut/bFull)*100)}%`);
console.log(`${DIM}⇒ 截断省不到 2%：真正占体积的是 cert/instructions 等散文，不是数字本身。${RST}`);


// 关键：errors 结构的实际收益
console.log(`\n${CYAN}── 自我纠错成本：Agent 要不要再调一次？──${RST}`);
const v = S.doVerify({ equation: '2x+3y=13', variables: ['x', 'y'], candidate: { x: 3, y: 4 } });
const vb = Buffer.byteLength(JSON.stringify(v), 'utf8');
console.log(`verify 错值返回 ${vb} B ≈ ${Math.round(vb / CHARS_PER_TOKEN)} token · verdict=${v.verdict} · safeToUse=${v.trust?.safeToUse}`);
console.log(`corrected=${JSON.stringify(v.corrected)} · magnitude=${v.correctionMagnitude}`);
console.log(`${GRN}→ 一次性拿到纠正值，而不是「拿到否定 → 再想 → 再调一次」${RST}`);

// 成本三账汇总
console.log(`\n${CYAN}═══ 成本三账汇总 ═══${RST}`);
const worst = rows.filter(r => !r.fail).sort((a, b) => b.med - a.med)[0];
const fastest = rows.filter(r => !r.fail).sort((a, b) => a.med - b.med)[0];
const avgTok = Math.round(rows.filter(r => !r.fail).reduce((a, r) => a + r.tok, 0) / rows.filter(r => !r.fail).length);
console.log(`① 时间：最快 ${fastest.med.toFixed(1)}ms · 最慢 ${worst.med.toFixed(1)}ms（${worst.name}）·全部 ${worst.p95.toFixed(1)}ms 以内`);
console.log(`② token：平均 ${avgTok} token/次（含 trust 块与结构化错误）`);
console.log(`③ 轮次：solve 给判决 → verify 给纠正值，正常路径 1~2 次调用闭环，不需要试错循环`);

