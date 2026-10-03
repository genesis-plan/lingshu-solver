// 双端一致性 + 诚实三档 回归（2026-10-03 生产级大改新增）
//
// 背景：抽出 services/solver-service.js 之前，stdio(mcp-server) 与 HTTP(http-mcp-server)
// 各复制了一份 shapeResult，且**空集分支口径分叉** —— stdio 版在「引擎只是没找到解、
// 没设 provenEmpty」时也输出「严格证明：该方程组无实数解」，属于虚报（撞诚实红线）。
// 本测试锁死两件事：
//   1. 两端现在共用同一个 shapeResult ⇒ 同引擎原始结果必得字节级同构输出（不可能再分叉）
//   2. 空集必须按诚实三档措辞（provenEmpty=false ⇒ 只说「未找到」；=true 才敢说「严格证明」）
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const svc = require('../services/solver-service.js');

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
};

console.log('── 1. 空集措辞：诚实三档 ──');
// 情形 A：引擎没找到解、没证明无解（最容易被误报成「严格证明」的那条）
const rA = svc.shapeResult({ resultType: 1, solutions: [] });
ok(/未找到实数解/.test(rA.summary) && !/严格证明：该方程组无实数解/.test(rA.summary),
  'provenEmpty=false ⇒ 只能说「未找到实数解」，不得佯称证明', rA.summary);

// 情形 B：引擎经 sound 算子严格证明无解
const rB = svc.shapeResult({ resultType: 1, solutions: [], provenEmpty: true });
ok(/严格证明：该方程组无实数解/.test(rB.summary),
  'provenEmpty=true ⇒ 才敢说「严格证明：该方程组无实数解」', rB.summary);

// 情形 C：未声明标识符（无法求解，绝不能说成无解）
const rC = svc.shapeResult({ resultType: 1, solutions: [], error: 'UNDECLARED_VARIABLE', message: '未声明 foo' });
ok(/未声明/.test(rC.summary) && !/无实数解/.test(rC.summary),
  'UNDECLARED_VARIABLE ⇒ 报「无法求解」，不谎称无解', rC.summary);

console.log('── 2. 双端形状一致（同一原始结果 ⇒ 同一输出对象）──');
// 取引擎真实原始结果
const { solve } = require('../solver-core.js');
const raw = solve(['x^2+y^2=4', 'x*y=1'], ['x', 'y'], 6);
const shaped = svc.shapeResult(raw);
// 模拟「两端各自整形」：这里两端都是同一个 shapeResult，所以必须严格相等
const again = svc.shapeResult(raw);
ok(JSON.stringify(shaped) === JSON.stringify(again), '同输入两次整形输出完全一致（确定性）');
ok(typeof shaped.summary === 'string' && shaped.summary.length > 0, 'summary 非空');
ok(shaped.solutions.length === 4, '解数=4（x^2+y^2=4 与 x*y=1 有 4 组实解）', String(shaped.solutions.length));
ok(shaped.diagnostics.inputError === null, '正常解出时 inputError=null');

console.log('── 3. 三工具经共享层可用（两端同一份）──');
const p1 = svc.doSolve({ equations: ['x^2-4=0'] , variables: ['x'] });
ok(p1.solutionCount >= 1, 'doSolve 出解', String(p1 && p1.solutionCount));
const p2 = svc.doPolyRoots({ coefficients: [1, -3, 2] });
ok(p2.solutionCount >= 1, 'doPolyRoots 出解', String(p2 && p2.solutionCount));
const p3 = svc.doVerify({ equation: 'x^2-4=0', candidate: 2 });
ok(p3.verdict === 'verified', 'doVerify 认出 x=2 为根', String(p3 && p3.verdict));

console.log('── 4. 护栏常量单一来源 ──');
ok(svc.MAX_VAR_COUNT === 6 && svc.MAX_EQ_COUNT === 64 && svc.MAX_TOTAL_CHARS === 100 * 1024,
  'MAX_VAR=6 / MAX_EQ=64 / MAX_CHARS=100KB',
  svc.MAX_VAR_COUNT + '/' + svc.MAX_EQ_COUNT + '/' + svc.MAX_TOTAL_CHARS);

// ── 5. Agent 契约（2026-10-03 针对 AI Agent 客群新增）──
// 为什么要锁：Agent 客群的核心价值不是「算得准」，而是「知道自己算得准不准」。
// trust 块一旦被后续改动删掉/弱化，Agent 就会退回到「自己遍历 solutions 猜可信度」，
// 那正是幻觉高发路径。这组断言是防止有人无意删掉这张决策表。
console.log('── 5. Agent 决策块 trust：Agent 客群的核心契约 ──');
const tA = svc.shapeResult({ resultType: 1, solutions: [] });                      // 没找到
const tB = svc.shapeResult({ resultType: 1, solutions: [], provenEmpty: true });   // 证明无解
const tC = svc.shapeResult({ resultType: 1, solutions: [], error: 'UNDECLARED_VARIABLE' }); // 输入不可解
const tD = svc.shapeResult({                                                     // 全部已证
  resultType: 2, solutions: [{ values: [1, 2], tier: 'proven', certified: true, residual: 0 }]
});

ok(tA.trust && tA.trust.trustLevel === 'unverified' && tA.trust.safeToUse === false,
  '引擎没找到 ⇒ trustLevel=unverified 且 safeToUse=false（不得被当成无解）',
  tA.trust && tA.trust.trustLevel);
ok(/Do not state|do not/i.test(tA.trust.agentAction),
  'unverified 时 agentAction 明令禁止宣称「无实数解」', tA.trust.agentAction);
ok(tA.trust.meaningOfEmpty === 'not_found_within_budget',
  'meaningOfEmpty=not_found_within_budget（与「已证明无解」区分开）', tA.trust.meaningOfEmpty);
// 回归（2026-10-03）：原实现在「找到 2 个解」时也写 meaningOfEmpty:"not_found_within_budget"，
// 与 solutions 数组直接矛盾。LLM 遇到自相矛盾的字段不会忽略，会当成噪声后挑对自己方便的那半信。
// 任何自相矛盾的自述字段都是幻觉诱因。
ok(tD.trust.meaningOfEmpty === null,
  '有解时 meaningOfEmpty=null（不得与 solutions 数组自相矛盾）',
  JSON.stringify(tD.trust.meaningOfEmpty));
// 程序化版本（Agent 无需解析英文句子即可分支）—— 这是 2026-10-03 删 instructions 后的替代载体
ok(tA.trust.mustNotClaim === 'no_solution',
  'unverified 时 mustNotClaim=no_solution（程序化禁断言，不必读英文）', tA.trust.mustNotClaim);
ok(tB.trust.mustNotClaim === null,
  'verified_empty 时 mustNotClaim=null（已严格证无解，Agent 可放心断言）', tB.trust.mustNotClaim);

ok(tB.trust.trustLevel === 'verified_empty' && tB.trust.safeToUse === true,
  'provenEmpty=true ⇒ trustLevel=verified_empty 且 safeToUse=true', tB.trust.trustLevel);
ok(tB.trust.meaningOfEmpty === 'proven_no_real_solution',
  'meaningOfEmpty=proven_no_real_solution', tB.trust.meaningOfEmpty);

ok(tC.trust.trustLevel === 'undecidable' && tC.trust.meaningOfEmpty === 'input_not_solvable',
  '输入不可解 ⇒ undecidable（不是「无解」）', tC.trust.trustLevel);

ok(tD.trust.trustLevel === 'verified' && tD.trust.provenCount === 1 && tD.trust.candidateCount === 0,
  '全认证 ⇒ verified 且 provenCount 正确', JSON.stringify(tD.trust));
// 原断言要求 instructions 字符串里含 tier（2026-10-03 瘦身时该字段已删，162B）。
// 断言的**意图**是「Agent 必须知道不能把 candidate 当 proven 用」——
// 意图不变，只是载体从自然语言 instructions 换成程序化可判的枚举：
//   tier 规则已在 tool description 里（READ THE TIERS BEFORE TRUSTING A RESULT）
//   「不得断言无解」这条硬规则浓缩为 trust.mustNotClaim
//
// ⚠ 2026-10-03 语义收紧：本条原为 mustNotClaim === null，理由是「已证有解，无禁用断言」。
// 改为白名单推导后语义更准 —— verified 只证明「列出的解都真」，不证明「解集完备」，
// 所以 Agent 依然**不能**拿它去断言「无解」（比如 certifiedCoverage<1 时）。
// mustNotClaim 描述的是「禁止断言什么」，与 safeToUse 描述的「能用什么」是两件事。
ok(tD.trust.mustNotClaim === 'no_solution',
  'verified 时 mustNotClaim=no_solution（有解，禁止断言无解；白名单只放 verified_empty）',
  JSON.stringify(tD.trust.mustNotClaim));
ok(typeof tD.trust.agentAction === 'string' && /certified/i.test(tD.trust.agentAction),
  'agentAction 明确说明解已认证（Agent 决策依据仍在）', tD.trust.agentAction);

// ── 5b. mustNotClaim 全层级覆盖（2026-10-03 修 fail-closed 漏洞）──
// 背景：第一版用黑名单（只列 unverified / budget_exhausted）漏掉了 undecidable，
// 而 agentAction 里明明有 3 处写着 "Do NOT report this as no solution"。
// 枚举字段比自然语言权威，漏一次等于没有。改成正向白名单后这里锁死不变式。
// 不变式：只有 verified_empty 允许断言无解，其余 6 个层级一律禁止。
console.log('── 5b. mustNotClaim 白名单不变式：7 层级全覆盖 ──');
const tF = svc.shapeResult({                                                     // 部分认证
  resultType: 2,
  solutions: [
    { values: [1], tier: 'proven', certified: true, residual: 0 },
    { values: [2], tier: 'candidate', certified: false, residual: 1e-3 }
  ]
});
const tG = svc.shapeResult({                                                     // 全候选
  resultType: 2, solutions: [{ values: [1], tier: 'candidate', certified: false, residual: 1 }]
});
const tH = svc.shapeResult({                                                     // 预算截断
  resultType: 1, solutions: [], truncated: true
});
ok(tF.trust.meaningOfEmpty === null && tG.trust.meaningOfEmpty === null,
  'partially / candidates_only 也为 null（有任何解即非空）',
  [tF.trust.meaningOfEmpty, tG.trust.meaningOfEmpty].join(','));

const LAYERS = [
  ['verified_empty', tB.trust],
  ['verified', tD.trust],
  ['partially', tF.trust],
  ['candidates_only', tG.trust],
  ['unverified', tA.trust],
  ['undecidable', tC.trust],
  ['budget_exhausted', tH.trust]
];
ok(LAYERS.length === 7 && LAYERS.every(([n, t]) => t && t.trustLevel === n),
  '7 个 trustLevel 全部构造成功且被 buildTrust 正确分类',
  LAYERS.map(([n, t]) => n + '=' + (t && t.trustLevel)).join(', '));
ok(LAYERS.every(([n, t]) => n === 'verified_empty' ? t.mustNotClaim === null : t.mustNotClaim === 'no_solution'),
  'mustNotClaim 白名单不变式成立：仅 verified_empty 为 null，其余 6 层级全为 no_solution',
  LAYERS.map(([n, t]) => n + ':' + t.mustNotClaim).join(', '));
ok(tC.trust.mustNotClaim === 'no_solution',
  'undecidable 时 mustNotClaim=no_solution（第一版漏洞点：黑名单漏了它）', tC.trust.mustNotClaim);
ok(tF.trust.mustNotClaim === 'no_solution',
  'partially 时 mustNotClaim=no_solution（有解存在，禁止报无解）', tF.trust.mustNotClaim);
ok(tG.trust.mustNotClaim === 'no_solution',
  'candidates_only 时 mustNotClaim=no_solution', tG.trust.mustNotClaim);
ok(tH.trust.mustNotClaim === 'no_solution',
  'budget_exhausted 时 mustNotClaim=no_solution', tH.trust.mustNotClaim);
// 回归：判断顺序修正（2026-10-03，被上面 5b 逼出来的真 bug）。
// 「被预算截断 + 一个解都没列出」原先落进 unverified，Agent 只知道「没找到」、
// 不知道原因是预算用完，于是以为重试无用。truncated 是更强的可行动信号，必须优先。
ok(tH.trust.trustLevel === 'budget_exhausted',
  'truncated=true 时即便结果为空集也判 budget_exhausted（不是 unverified）—— Agent 才知道该加预算重试',
  tH.trust.trustLevel);
ok(/raise budget|narrow domain/i.test(tH.trust.agentAction),
  'budget_exhausted 的 agentAction 给出可执行动作（加预算 / 缩定义域）', tH.trust.agentAction);
// 未截断的空集仍应是 unverified（不能被上面的顺序修正带偏）
ok(tA.trust.trustLevel === 'unverified',
  '未截断的空集仍是 unverified（顺序修正未污染该分支）', tA.trust.trustLevel);
// 反向锁：agentAction 里凡是说"别报无解"的层级，mustNotClaim 必须同时是 no_solution。
// 这是把自然语言与枚举绑在一起，防止将来改 agentAction 措辞时忘了同步枚举。
const SAYS_NO_SOLUTION = /do not report this as|do not state|not as proven-empty/i;
ok(LAYERS.every(([, t]) => !SAYS_NO_SOLUTION.test(t.agentAction) || t.mustNotClaim === 'no_solution'),
  '一致性：凡 agentAction 含「禁止宣称无解」措辞的层级，mustNotClaim 必为 no_solution',
  LAYERS.filter(([, t]) => SAYS_NO_SOLUTION.test(t.agentAction))
    .map(([n, t]) => n + '→' + t.mustNotClaim).join(', '));

// candidate 场景：不能只靠顶层布尔 certified，Agent 需要计数
const tE = svc.shapeResult({
  resultType: 2,
  solutions: [
    { values: [1], tier: 'proven', certified: true, residual: 0 },
    { values: [2], tier: 'candidate', certified: false, residual: 0.1 }
  ]
});
ok(tE.trust.trustLevel === 'partially' && tE.trust.safeToUse === false,
  '部分认证 ⇒ partially 且 safeToUse=false', tE.trust.trustLevel);
ok(tE.trust.provenCount === 1 && tE.trust.candidateCount === 1,
  'provenCount/candidateCount 供程序化分支（不需 LLM 自己数）',
  tE.trust.provenCount + '/' + tE.trust.candidateCount);

console.log('── 6. verify 给 Agent 可执行的纠正 ──');
const vBad = svc.doVerify({ equation: 'x^2-4=0', candidate: 1.5 });
ok(vBad.verdict === 'refuted_or_unverified' && vBad.trust && vBad.trust.safeToUse === false,
  '错值被 refute 且 safeToUse=false', vBad.verdict);
ok(vBad.trust && vBad.trust.corrected !== null && /Replace it/.test(vBad.trust.agentAction),
  'refute 时直接给出 corrected 值与「必须替换」指令（防 Agent 沿用错数）',
  JSON.stringify(vBad.trust && vBad.trust.corrected));
ok(vBad.trust && typeof vBad.trust.correctionMagnitude === 'number',
  'correctionMagnitude 可量化偏差（Agent 可据此判断错得多离谱）');
const vGood = svc.doVerify({ equation: 'x^2-4=0', candidate: 2 });
ok(vGood.trust && vGood.trust.safeToUse === true && vGood.trust.corrected === null,
  'verify 通过时 safeToUse=true 且 corrected=null（无需改动）');

console.log('── 7. 结构化错误：Agent 能程序化自愈 ──');
let e1 = null;
try { svc.doSolve({ equations: ['x^2=4'], variables: ['a','b','c','d','e','f','g'] }); }
catch (e) { e1 = e; }
ok(e1 && e1.fix && /Substitute|split|Substitute the extra/i.test(e1.fix),
  '超 6 变量 ⇒ 错误自带修复处方（不只说「超限」）', e1 && e1.fix && e1.fix.slice(0, 60));
ok(e1 && e1.retryable === false && e1.limit === 6,
  '超限错误标 retryable=false + limit=6（Agent 知道原样重试无用）');
let e2 = null;
try { svc.doSolve({ equations: ['x^2=4'], variables: ['x'], domain: { z: [0, 1] } }); }
catch (e) { e2 = e; }
ok(e2 && e2.undeclared && e2.undeclared.includes('z'),
  'domain 含未声明变量 ⇒ 结构化指出 undeclared 字段（原来静默通过，会得到错误答案）',
  JSON.stringify(e2 && e2.undeclared));

console.log('── 8. 返回体瘦身：Agent 不该为用不上的字段付 token ──');
const lean = svc.doSolve({ equations: ['x^2=2'], variables: ['x'] });
const leanStr = JSON.stringify(lean);
ok(!leanStr.includes('internals'),
  'solve 返回体不含 internals（残差已于 2026-10-03 移除，Agent 决策不依赖它）');
ok(!leanStr.includes('"residual"'),
  'solve 返回体不含 residual 字段');
const solFields = Object.keys((lean.solutions || [])[0] || {}).sort().join(',');
ok(solFields === 'cert,certified,text,tier,values',
  'solutions[] 字段恰为 cert/certified/text/tier/values（无多余内部量）', solFields);
ok(lean.solutions[0] && lean.solutions[0].cert && lean.solutions[0].cert.status,
  '可信度证据仍在（cert.status 保留区间认证，替代残差的作用）',
  lean.solutions[0] && lean.solutions[0].cert && lean.solutions[0].cert.status);

console.log('── 9. 展示位数 4 位 / 计算精度 6 位：两层必须分离 ──');
// 为什么要锁：2026-10-03 把 Agent 展示位数从 6 降到 4。曾经的实现方式是直接改
// 引擎常量 COMPUTE_DECIMALS —— 那是**求解精度**，实测降到 4 对 golden 20/20 的
// 解数/顺序/证书/完备性零改变（只换来永久降低的可证精度），属于数学保真让步，不能做。
// 正确做法是只改展示层。这组断言防止后人「顺手把常量也改成 4」。
const disp = svc.doSolve({ equations: ['x^2=2'], variables: ['x'] });
ok(disp.precisionDecimals === 4, 'precisionDecimals = 4（Agent 展示位数）', disp.precisionDecimals);
ok(/=\s*-?\d+\.\d{4}\b/.test((disp.solutions[0] || {}).text || ''),
  'text 恰为 4 位小数', (disp.solutions[0] || {}).text);
// values 必须仍是全精度浮点（Agent 要更多位时读它），不能跟着截到 4 位
const v0 = (disp.solutions[0] || {}).values;
ok(Array.isArray(v0) && v0.length === 1 &&
   String(v0[0]).replace('-', '').replace('.', '').length > 6,
  'values 仍是全精度浮点（未被截到 4 位）', v0 && v0[0]);
ok(Math.abs(Math.abs(v0[0]) - Math.SQRT2) < 1e-12,
  'values 精度未被展示位数污染（sqrt2 全精度）', v0 && v0[0]);
// 引擎常量必须还是 6
const eng = require('../dist/lingshu.mjs');
ok(eng.COMPUTE_DECIMALS === 6,
  '引擎 COMPUTE_DECIMALS 仍为 6（计算精度不因展示位数而降低）', eng.COMPUTE_DECIMALS);

// ── 10. 返回体瘦身第二刀（2026-10-03）：砍纯冗余字段 ──
// 为什么要砍：Agent 每轮都要读整个返回体，字节即 token。实测砍掉 440B = 23%（534→411 token）。
// 但**只能砍纯冗余**，fail-closed 依据一个都不能少 —— 这组断言就是防手滑的护栏。
const lean2 = svc.doSolve({ equations: ['x^2=2'], variables: ['x'] });
const lean2Keys = Object.keys(lean2);
ok(!lean2Keys.includes('instructions'),
  '顶层 instructions 已删（162B 自然语言，内容已并入 tool description 与 trust 枚举）', lean2Keys.join(','));
ok(!JSON.stringify(lean2.diagnostics).includes('solverVersion'),
  'diagnostics 已删 solverVersion（版本在 tool description 与 reportId 里）', JSON.stringify(lean2.diagnostics));
ok(lean2.diagnostics.inputError !== undefined && lean2.diagnostics.truncated !== undefined,
  'diagnostics 保留 fail-closed 必需项 inputError + truncated', JSON.stringify(lean2.diagnostics));
ok(lean2.diagnostics.provenEmpty === undefined,
  'diagnostics 不再暴露 provenEmpty 原始布尔（已由 trust.meaningOfEmpty 枚举表达）');
ok(lean2.certification && lean2.certification.reproducibility === undefined,
  'certification 已删 reproducibility 说明段（可复现性由 reportId 承载）', JSON.stringify(lean2.certification));
ok(lean2.certification && lean2.certification.proven !== undefined
   && lean2.certification.certifiedCoverage !== undefined,
  'certification 保留决策必需的 proven 计数与 certifiedCoverage', JSON.stringify(lean2.certification));
// 内核 certification 必须仍是完整版（Web 端与回归测试依赖 reproducibility）。
// ⚠ 2026-10-03 修正：原断言写成 svc.solverCoreCertification ? ... : null，
// 而该导出根本不存在 ⇒ coreFull 恒为 null ⇒ ok(coreFull === null || ...) 恒真，
// 是一条**假通过**的护栏。改为直接打引擎原始 solve() 结果验证。
const coreRaw = eng.solve(['x^2=2'], ['x'], 6);
ok(coreRaw && coreRaw.certification && coreRaw.certification.reproducibility !== undefined,
  '内核 certification 仍带 reproducibility（服务层只裁副本，未动内核）',
  coreRaw && coreRaw.certification ? Object.keys(coreRaw.certification).join(',') : 'null');
ok(coreRaw && coreRaw.certification && coreRaw.certification.reproducibility
     && coreRaw.certification.reproducibility.deterministic === true,
  '内核 reproducibility.deterministic=true（Decision Physics DP-1 可复现性未被服务层截断）');
ok(lean2.certification && lean2.certification.reproducibility === undefined
   && coreRaw.certification.reproducibility !== undefined,
  '裁剪只发生在服务层：同一次求解，内核有 reproducibility / 返回体没有',
  JSON.stringify(lean2.certification));
// 体积护栏：防止将来字段回潮
const lean2Bytes = JSON.stringify(lean2).length;
ok(lean2Bytes < 1600, '返回体 < 1600B（当前 ' + lean2Bytes + 'B，瘦身红线）', lean2Bytes);

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
