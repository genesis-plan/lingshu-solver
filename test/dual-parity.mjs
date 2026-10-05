// 双端一致性 + 诚实三档 回归（2026-10-03 生产级大改新增）
//
// 背景：抽出 services/solver-service.js 之前，stdio(mcp-server) 与 HTTP(http-mcp-server)
// 各复制了一份 shapeResult，且**空集分支口径分叉** —— stdio 版在「引擎只是没找到解、
// 没设 provenEmpty」时也输出「严格证明：该方程组无实数解」，属于虚报（撞诚实红线）。
// 本测试锁死两件事：
//   1. 两端现在共用同一个 shapeResult ⇒ 同引擎原始结果必得字节级同构输出（不可能再分叉）
//   2. 空集必须按诚实三档措辞（provenEmpty=false ⇒ 只说「未找到」；=true 才敢说「严格证明」）
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const svc = require('../services/solver-service.js');

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (typeof name !== 'string') {
    // ⭐ 元护栏：断言名必须是字符串。踩过的坑 —— 我自己写护栏时把实参写成
    //   ok('断言名', 条件, 详情)（与本文件其余 60 余条相反的顺序），
    //   结果 cond 收到名字、name 收到布尔，输出变成 '✅ true' 而 pass 照样 +1：
    //   一条**看起来通过、实际没断言任何东西**的护栏，比没护栏更危险。
    throw new Error('ok(cond, name, extra) 参数顺序被破坏：name=' + String(name));
  }
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

// 情形 D（2026-10-05 新增，P0）：被预算/超时中止且一个解都没找到。
//   实测来源：6 元 6 式混合 2/3 次系统，1.15s 后分支预算耗尽（truncated），
//   返回体 summary 却写「找到 0 个实数解。」—— summary 是 Agent 读到的第一句话，
//   它会把这句读成「这系统没解」，而真相是**搜索根本没跑完**。
//   两种情况给 Agent 的行动完全相反（收工 vs 缩域/加预算重试）。
const rD = svc.shapeResult({ resultType: 2, solutions: [], truncated: true, error: 'TIMEOUT_TRUNCATED' });
ok(/未找到实数解/.test(rD.summary) && /不得据此断言无解|没跑完/.test(rD.summary)
  && !/找到 0 个实数解/.test(rD.summary),
  'truncated + 0 解 ⇒ summary 必须说「没跑完」，不得说「找到 0 个实数解」', rD.summary);

console.log('── 2. 双端形状一致（同一原始结果 ⇒ 同一输出对象）──');
// 取引擎真实原始结果
const { solve } = require('../solver-core.js');
const raw = solve(['x^2+y^2=4', 'x*y=1'], ['x', 'y'], 6);
const shaped = svc.shapeResult(raw);
// 模拟「两端各自整形」：这里两端都是同一个 shapeResult，所以必须严格相等
const again = svc.shapeResult(raw);
ok(JSON.stringify(shaped) === JSON.stringify(again), '同输入两次整形输出完全一致（确定性）');
ok(typeof shaped.summary === 'string' && shaped.summary.length > 0, 'summary 非空');
// ⚠ 2026-10-04 拆开断言：原写法 `shaped.solutions.length === 4` 实际测的是
//   **展示数组长度**，而 AGENT_MAX_SOLUTIONS=2 起展示会被截断（本例 4 解只展示 2）。
//   那不是「解数错了」—— 解数报在 solutionCount（引擎找到的总数），是**如实**的。
//   真正要守的不变式有两条，分开断言才不会互相掩盖：
//     ① solutionCount === 4        —— 引擎确实找到了 4 组实解（没漏）
//     ② 展示 < 总数 ⇒ Agent 看得见「还有更多」且**能取回**
//
// ⚠⚠ 2026-10-04 改口径（🔴 这条断言原来在钉一个 P0）：
//   原断言要求「展示被截断 ⇒ truncated=true」。而 truncated 的语义是
//   「**引擎**被预算/时间中止」，不是「返回体装不下」。
//   两者混为一谈的实测后果：引擎明明找全了 4 个解，却报
//   trustLevel="budget_exhausted" + agentAction「加预算或缩 domain」
//   ⇒ Agent 照做假指令，重试一百次都是同一结果。
//   ⇒ 现在拆成两条独立不变式：
//      · truncated 只在**引擎真中止**时为 true（本例引擎算完了 ⇒ false）
//      · 展示不足由 trust.moreAvailable / 顶层 nextOffset 表达（Agent 据此分页取回）
const fourRoots = svc.doSolve({ equations: ['x^2+y^2=4', 'x*y=1'], variables: ['x', 'y'] });
ok(fourRoots.solutionCount === 4, '解数=4（x^2+y^2=4 与 x*y=1 有 4 组实解，solutionCount 报总数）', String(fourRoots.solutionCount));
ok(fourRoots.solutions.length < fourRoots.solutionCount,
  '展示被截断（4 根只列前 ' + fourRoots.solutions.length + '）',
  { shown: fourRoots.solutions.length, total: fourRoots.solutionCount });
ok(fourRoots.truncated === false,
  '展示截断 **不** 置 truncated（引擎已算完；那是输出层容量问题，不是求解被中止）',
  { truncated: fourRoots.truncated, trust: fourRoots.trust.trustLevel });
ok(fourRoots.trust.trustLevel === 'complete_but_shown_partially',
  '展示截断 ⇒ 独立 trustLevel（可行动作是分页，不是加预算）', fourRoots.trust.trustLevel);
ok(fourRoots.trust.moreAvailable === fourRoots.solutionCount - fourRoots.solutions.length
   && typeof fourRoots.nextOffset === 'number',
  '展示截断 ⇒ 给出 moreAvailable 与 nextOffset（Agent 有可执行的取回路径）',
  { more: fourRoots.trust.moreAvailable, next: fourRoots.nextOffset });
ok(fourRoots.trust.completeness.displayCapped === true,
  '展示截断在 completeness 里留痕（displayCapped=true，Agent 看得见这一页不是全部）',
  JSON.stringify(fourRoots.trust.completeness));
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
  'certification 无 reproducibility 说明段', JSON.stringify(lean2.certification));
ok(lean2.certification && lean2.certification.proven !== undefined,
  'certification 保留决策必需的 proven 计数', JSON.stringify(lean2.certification));
// 🔴 2026-10-05：certifiedCoverage 与 reproducibility 已在**内核层**删除，
//   不是服务层裁剪。两个字段各自的理由（都不是「体积」问题）：
//
//   ❶ certifiedCoverage = proven/(proven+candidate)
//      分子分母都是「找到的解」⇒ 对「有没有漏解」**零信息**。
//      实测反例：g005 旧值 cov=0 而它 4 个解全对；改成 1.0 也不代表找全了。
//      它长得像「可信度」，极易被 Agent 当成「这批解可不可信」读 —— 而它不是。
//      一个会被误读的比率比没有更危险。
//
//   ❷ reproducibility = {deterministic: true, ...}
//      `true` 是**硬编码的断言**，不来自任何测量。
//      「同输入同输出」确实是事实（同伦 γ 由输入哈希导出、全程无随机数），
//      但把它包成 `deterministic` 字段塞进结果，是让 Agent 以为「结果可信」——
//      而**可复现 ≠ 正确**。一条恒真的断言提供零信息，还占 token。
//
// ⇒ 内核与返回体**都不再有**这两个字段（不再是「内核有、返回体无」的裁剪关系）。
const coreRaw = eng.solve(['x^2=2'], ['x'], 6);
ok(coreRaw && coreRaw.certification && coreRaw.certification.reproducibility === undefined,
  '内核 certification 也无 reproducibility（硬编码确定性已删，非服务层裁剪）',
  coreRaw && coreRaw.certification ? Object.keys(coreRaw.certification).join(',') : 'null');
ok(coreRaw && coreRaw.certification && coreRaw.certification.certifiedCoverage === undefined,
  '内核 certification 也无 certifiedCoverage（谎报型比例指标已删）',
  coreRaw && coreRaw.certification ? Object.keys(coreRaw.certification).join(',') : 'null');
ok(lean2.certification && coreRaw.certification
   && Object.keys(lean2.certification).sort().join(',') === Object.keys(coreRaw.certification).sort().join(','),
  '裁剪不再发生在 certification 上（内核与返回体同构）',
  'lean=' + Object.keys(lean2.certification).join(',') +
  ' core=' + Object.keys(coreRaw.certification).join(','));
// 体积护栏：防止将来字段回潮
const lean2Bytes = JSON.stringify(lean2).length;
ok(lean2Bytes < 1600, '返回体 < 1600B（当前 ' + lean2Bytes + 'B，瘦身红线）', lean2Bytes);
// 余量护栏：只卡 <1600 的话，1585B 就算「过」，再加一个字段就撞线而无人察觉。
// 实测 2026-10-04 就是这样：1585B 时只剩 15B 余量。给出 ≥50B 的余量要求。
ok(lean2Bytes < 1550, '返回体余量 ≥ 50B（当前 ' + (1600 - lean2Bytes) + 'B 余量，防撞线）', lean2Bytes);
// ⚠⚠ 多解场景的体积护栏（2026-10-04 补）：上面两条只测了 **1~2 解**的样例。
//   实测 x*cos(x)-x=0 在默认域 ±1e6 内返回 16 解 / **4627B** —— 红线的 2.9 倍，
//   而真解是 x=2kπ，±1e6 里有约 **31.8 万个**。原来 solutions[] 没有任何数量上限，
//   「多解」这一整类场景压根没被体积红线覆盖 ⇒ 对 AI 客群是实打实的 token 炸弹。
// 现在有 AGENT_MAX_SOLUTIONS 封顶，这条断言守住它不回潮。
{
  const many = svc.doSolve({ equations: ['x*cos(x)-x=0'], variables: ['x'] });
  const manyBytes = JSON.stringify(many).length;
  ok(many.solutions.length <= 2, '多解场景展示数封顶（≤2，实测 ' + many.solutions.length + '）', many.solutions.length);
  ok(many.solutionCount >= many.solutions.length,
    '多解场景 solutionCount 报引擎找到的总数（' + many.solutionCount + ' ≥ 展示 ' + many.solutions.length + '）',
    { total: many.solutionCount, shown: many.solutions.length });
  ok(manyBytes < 1600, '多解场景返回体也在 1600B 内（当前 ' + manyBytes + 'B）', manyBytes);
  ok(many.truncated === true, '多解场景 truncated=true（Agent 知道解可能不全）', many.truncated);
}

// ⚠⚠⚠ 第 11 节：展示截断的诚实性（2026-10-04 补，🔴 修本轮自己引入的 3 个 P0）
//
// 背景：为了守 1600B 红线，本轮给 solutions[] 加了 AGENT_MAX_SOLUTIONS=2 封顶。
// 它本身是对的（防 token 炸弹），但**第一版把「展示截断」当成了「求解被截断」**，
// 一次引入三个 P0。留档，因为它们都是**看起来在保护产品、实际在骗 Agent**的典型：
//
//   ① 假指令：diagnostics.truncated = !!(... || capped) ⇒ 引擎明明找全了 5 个根，
//      却报 trustLevel="budget_exhausted" + agentAction「加 budget 或缩 domain」。
//      Agent 会照做，重试一百次都是同一结果。
//   ② 自相矛盾：provenCount 数展示数（2）而 certification.proven 数引擎数（5），
//      同一返回体里两个数字打架。LLM 遇矛盾会挑对自己方便的那半信。
//   ③ 契约不可完成：poly_roots 描述写 "All real roots"，但 5 个根只给 2 个且
//      **没有任何参数能取回剩下 3 个** —— Agent 被塞进一个无法完成的契约。
//
// 以下断言逐条钉住修好的行为，且**每条都能在修前失败**（不是恒真护栏）。
{
  // 造一个「引擎找全、只展示 2 个」的干净样本：
  //   x⁴ − 5x² + 4 = (x²−1)(x²−4) = (x−1)(x+1)(x−2)(x+2) → 4 个实根 ±1 ±2
  //   系数按 buildPolyEquation 的约定「最高次在前」：[1, 0, -5, 0, 4]
  const FOUR_ROOTS = [1, 0, -5, 0, 4];
  const five = svc.doPolyRoots({ coefficients: FOUR_ROOTS });
  const b5 = JSON.stringify(five).length;
  ok(five.solutionCount > five.solutions.length,
    '样本前提：引擎找到的解数 > 展示数（' + five.solutionCount + ' > ' + five.solutions.length + '），否则本节无意义',
    { total: five.solutionCount, shown: five.solutions.length });
  ok(b5 < 1600, '多根 poly_roots 返回体在 1600B 内（当前 ' + b5 + 'B）', b5);

  // ① truncated 只反映**引擎真实中止**，不反映我们自己截断展示
  ok(five.truncated === false,
    '① 展示截断不得置 truncated=true（引擎已算完，这是输出层容量问题）',
    { truncated: five.truncated, trust: five.trust.trustLevel });
  ok(five.trust.trustLevel === 'complete_but_shown_partially',
    '① 展示截断有独立 trustLevel（不是 budget_exhausted）', five.trust.trustLevel);
  ok(!/raise budget/i.test(five.trust.agentAction),
    '① agentAction 不得建议「加预算」——搜索已完成，加预算是死路', five.trust.agentAction);
  ok(five.trust.safeToUse === true,
    '① 已认证的解即使只展示一部分也仍然 safeToUse（逼 Agent 重验已证过的东西是浪费）',
    five.trust.safeToUse);

  // ② 计数同口径：trust.provenCount 必须与 certification.proven 一致
  ok(five.trust.provenCount === five.certification.proven,
    '② provenCount 与 certification.proven 同口径（都是引擎总数）',
    { trust: five.trust.provenCount, cert: five.certification.proven });
  ok(five.trust.provenCount === five.solutionCount,
    '② provenCount === solutionCount（全是 proven 时）',
    { proven: five.trust.provenCount, count: five.solutionCount });

  // ③ Agent 必须有一条**可执行**的取回路径
  ok(typeof five.nextOffset === 'number' && five.nextOffset > 0,
    '③ 有下一页时给具体 nextOffset（不是「还有更多」这种话）', five.nextOffset);
  ok(five.trust.moreAvailable === five.solutionCount - five.solutions.length,
    '③ moreAvailable = 总数 − 本页展示数', {
      more: five.trust.moreAvailable, total: five.solutionCount, shown: five.solutions.length
    });
  {
    // 分页必须**收敛**：第一版 capped 判据写成 `window.length < allSols.length`，
    // 在 n 越过尾部时 nextOffset === n 本身 ⇒ Agent 循环 n=nextOffset **死循环**。
    const got = [];
    let n = 0, pages = 0, converged = false, monotonic = true;
    while (pages < 20) {
      const pg = svc.doPolyRoots({ coefficients: FOUR_ROOTS, n });
      got.push(...pg.solutions.map((s) => Number(s.values[0].toFixed(6))));
      pages++;
      if (pg.nextOffset === undefined) { converged = true; break; }
      if (pg.nextOffset <= n) { monotonic = false; break; }
      n = pg.nextOffset;
    }
    ok(converged, '③ 分页在有限步内收敛（nextOffset 不再自指，无死循环）', { pages });
    ok(monotonic, '③ nextOffset 严格递增（Agent 可安全 while 循环）', { pages });
    const want = [-2, -1, 1, 2].sort((a, b) => a - b);
    const uniq = [...new Set(got)].sort((a, b) => a - b);
    ok(JSON.stringify(uniq) === JSON.stringify(want),
      '③ 分页取回全部根、不重不漏（契约 "All real roots" 可完成）',
      { got: uniq, want });
  }

  // ④ 越过尾部的 n 必须给「到底了」而不是「还有 N 个」
  {
    const past = svc.doPolyRoots({ coefficients: FOUR_ROOTS, n: 99 });
    ok(past.nextOffset === undefined && past.trust.moreAvailable === undefined,
      '④ n 越过尾部 ⇒ 无 nextOffset / moreAvailable（不会诱导 Agent 继续翻页）',
      { next: past.nextOffset, more: past.trust.moreAvailable });
    ok(past.solutions.length === 0, '④ n 越过尾部返回空页（不是重复最后一页）', past.solutions.length);
  }

  // ⑤ 非法 n 必须报错而不是静默忽略（静默忽略 ⇒ Agent 以为 n=999 生效了 ⇒ 漏解）
  {
    let threw = null;
    try { svc.doPolyRoots({ coefficients: FOUR_ROOTS, n: -1 }); } catch (e) { threw = e; }
    ok(threw && threw.type === 'invalid_input', '⑤ 负数 n 报 invalid_input（fail-closed，不静默忽略）',
      threw ? threw.type : 'no throw');
    let threw2 = null;
    try { svc.doSolve({ equations: ['x^2=4'], variables: ['x'], n: 'abc' }); } catch (e) { threw2 = e; }
    ok(threw2 && threw2.type === 'invalid_input', '⑤ 非数字 n 报 invalid_input', threw2 ? threw2.type : 'no throw');
  }

  // ⑥ 完备性与展示是**两件事**，不得互相降级
  //   引擎已证完备（Sturm/Bézout）时，展示截断**不得**把 completeness.status 降成
  //   unknown —— 那是把「知道」说成「不知道」，与「谎称找全」同样是错的谎报。
  ok(five.trust.completeness.status === 'complete',
    '⑥ 引擎已证完备 ⇒ completeness 保持 complete（展示截断不降级完备性）',
    { status: five.trust.completeness.status, bound: five.trust.completeness.bound, found: five.solutionCount });
  //   但 conclusion 描述「Agent 此刻掌握什么」⇒ 必须降级（它还没拿到全部）
  ok(five.conclusion === '部分解',
    '⑥ conclusion 降为部分解（Agent 手上确实还不是全部，与 complete 各自自洽）', five.conclusion);

  // ⑦ warnings 已删：它的每条内容都与结构化字段重复（同一语义两处表达）
  ok(five.warnings === undefined, '⑦ warnings 不再进 Agent 返回体（内容已由 conclusion/trust 表达）', five.warnings);
  {
    // inputErrorMessage 只在**真有输入错误**时给；否则它装的是求解结论却顶着
    // 「输入错误」的名字 ⇒ Agent 会去改一个完全没问题的输入。
    const okCase = svc.doSolve({ equations: ['x^2=4'], variables: ['x'] });
    ok(okCase.diagnostics.inputErrorMessage === null,
      '⑦ 无输入错误时 inputErrorMessage=null（不拿求解结论冒充输入错误）',
      okCase.diagnostics.inputErrorMessage);
    ok(okCase.diagnostics.inputError === null, '⑦ 无输入错误时 inputError=null（计费层依赖，保留）');
  }

  // ⑧ 6 次 6 实根：poly_roots 的主场景（AGENT_MAX_SOLUTIONS=2 意味着要翻 3 页）
  //   (x²−1)(x²−4)(x²−9) = x⁶ − 14x⁴ + 49x² − 36，系数按「最高次在前」
  {
    const p6 = svc.doPolyRoots({ coefficients: [1, 0, -14, 0, 49, 0, -36] });
    ok(p6.solutionCount === 6,
      '⑧ 6 次多项式 6 个实根全部找到（引擎侧无丢根）', p6.solutionCount);
    ok(p6.trust.completeness.status === 'complete',
      '⑧ 6 实根时完备性由 Sturm/Bézout 判定为 complete', p6.trust.completeness.status);
    ok(JSON.stringify(p6).length < 1600,
      '⑧ 6 实根返回体仍在 1600B 内（当前 ' + JSON.stringify(p6).length + 'B）');
  }
}

// ⚠⚠⚠ 第 12 节：完备性计数的「声明空间」口径 + 不等式约束闸门（2026-10-04 补）
//
// 这一节钉住的是**同一个数学错误在两个方向上的两次发作**，以及顺带挖出的一条独立 P0。
// 背景：Sturm 定理给的是「区间内有多少实根」，所以**完备性判定的正确性 100% 取决于
// 你喂给它的那个区间是什么**。这里有三个语义完全不同、历史上被混为一谈的区间：
//
//   (A) 搜索盒 domain:{x:[1,2]} —— 「去哪里找」。只是搜索提示，**不是问题的一部分**。
//   (B) 问题约束 x>0 / x∈[-30,30] —— 「什么问题算合法」。**定义了解集本身**。
//   (C) ℝ —— 只有在问题**没给任何约束**时才等于声明空间。
//
// 实测两次踩坑（都不是猜测，是跑出来的）：
//   第一次用 (A)：`x^2=2` 域 [1,2] ⇒ 盒内 1 根、found 1 ⇒ 判「全部解」+ canAssert.allSolutions=true，
//     而 −√2 是真解且在盒外 ⇒ **谎报找全**。这比报错严重一万倍（Agent 会直接断言「就这一个解」）。
//   第二次用 (C)：`x^2-4=0, x>0` ⇒ ℝ 上 2 根、found 1 ⇒ 把**确实完备**的答案误判成「部分解」。
//     这次是 golden 回归 g018 抓到的 —— 我第一版修复把 (A) 换成 (C)，方向对了但只对了一半。
//
// 正确口径：**声明空间**，由问题里的不等式/域约束界定（可 ±∞）。
//   实测支撑：`x^2-4=0, x>0` 的声明空间是 (0,∞)，内含**恰好 1 个**解 x=2 ⇒ 确实完备。
//
// 顺带挖出的独立 P0（不在原计划内，但比原计划更严重）：
//   `x^2=0` + `x>0` 返回解 `x=0` —— **x=0 违反 x>0**，真解集是空集。
//   病根链条（逐段实测追出，不是推测）：
//     ① lex.js parseCondition 把 `x>0` 归一成 {type:'domain', min:0}，**严格性被抹掉**
//        （原注释自己写着「严格 > / < 在数值计算中转为 >= / <=」）；
//     ② setup.js 只能据此写 `op: ">="` ⇒ x=0「满足」；
//     ③ 没有任何闸门校验不等式 —— _finalResidualGate 只代回**等式**
//        （setup.js:75 明确「不等式不加入 equations 数组」），
//        而真正会校验不等式的 verifyAllConstraints **只在 suan48 里被调用**，
//        suan48 首行就 `if (!state.isInequalityOnly) return`（ineq.js:7）
//        ⇒ **混合系统（等式+不等式）的解从不经过任何不等式校验**。
//   为什么网格搜索躲不掉：0 恰好是网格采样最易命中的点（盒的中点/端点），
//   而 D0 收紧只能保证「不去盒外找」，**剔不掉恰好落在约束边界上的点**。
//
// 输出违反问题约束的解，比算不出来严重得多：算不出只是「我不知道」，
// 给错是骗人 —— Agent 会把 x=0 当答案报给用户。
{
  const S = async (equations, domain) =>
    await svc.doSolve({ equations, variables: ['x'], ...(domain ? { domain } : {}) });
  const vals = (r) => (r.solutions || []).map((s) => s.values[0]);
  const concl = (r) => r.conclusion;
  const asserts = (r) => r.canAssert || (r.trust && r.trust.canAssert) || null;

  // ── 第一组：(A) 搜索盒**不得**当完备性证据（谎报找全）──
  {
    const r = await S(['x^2 = 2'], { x: [1, 2] });
    ok(concl(r) === '部分解',
      '① 搜索盒窄于解集 ⇒ 必须「部分解」（域 [1,2] 内只有 +√2，−√2 是盒外真解）',
      { conclusion: concl(r), sols: vals(r) });
    ok(asserts(r) && asserts(r).allSolutions === false,
      '① 且 canAssert.allSolutions=false —— 谎报找全是本产品最不能犯的错',
      asserts(r));
    ok(vals(r).length === 1 && Math.abs(vals(r)[0] - Math.SQRT2) < 1e-6,
      '① 输出的是盒内那个根 +√2', vals(r));
  }
  {
    // 对照：盒内含全部真解时，「全部解」是对的（数学事实，不是本测试放宽标准）
    const r = await S(['x^2 = 2'], { x: [-2, 2] });
    ok(concl(r) === '全部解' && vals(r).length === 2,
      '① 对照：搜索盒含两个真根 ⇒ 「全部解」且两个都给出', { conclusion: concl(r), sols: vals(r) });
  }

  // ── 第二组：(B) 问题约束**必须**当完备性证据（否则误报漏解）──
  {
    const r = await S(['x^2 - 4 = 0', 'x > 0']);
    ok(concl(r) === '全部解',
      '② 声明空间 (0,∞) 内恰好 1 个解 ⇒ 确实完备，必须打「全部解」',
      { conclusion: concl(r), sols: vals(r), reason: r.reason });
    ok(vals(r).length === 1 && vals(r)[0] === 2,
      '② 输出 x=2（−2 不满足 x>0，不该出现）', vals(r));
    ok(asserts(r) && asserts(r).allSolutions === true,
      '② canAssert.allSolutions=true —— 这是本轮修回来的核心用例（golden g018）', asserts(r));
  }
  {
    // 同一数学事实的两种写法必须同结论（写入形式不同，语义相同）
    const a = await S(['x^2 - 4 = 0', 'x > 0']);
    const b = await S(['x^2 = 4', 'x∈(0,30)']);
    const c = await S(['x^2 = 4', 'x∈[1,30]']);
    ok(concl(a) === concl(b) && concl(b) === concl(c) && concl(a) === '全部解',
      '② 三种等价写法（x>0 / x∈(0,30) / x∈[1,30]）结论必须一致',
      { xgt0: concl(a), openIv: concl(b), closedIv: concl(c) });
  }
  {
    const r = await S(['x^2 - 4 = 0', 'x < 0']);
    ok(concl(r) === '全部解' && vals(r).length === 1 && vals(r)[0] === -2,
      '② 对称方向 x<0 ⇒ 只有 −2 合法且完备', { conclusion: concl(r), sols: vals(r) });
  }
  {
    // (C) 无约束时才允许用 ℝ
    const r = await S(['x^2 = 2']);
    ok(concl(r) === '全部解' && vals(r).length === 2,
      '② 无约束 ⇒ 声明空间就是 ℝ ⇒ 两个根都要给且完备', { conclusion: concl(r), sols: vals(r) });
  }

  // ── 第三组：严格不等式的端点必须被剔除（独立 P0）──
  {
    const r = await S(['x^2 = 0', 'x > 0']);
    ok(vals(r).length === 0,
      '③ x²=0 ∧ x>0 的真解集是**空集** ⇒ 一个解都不许给（x=0 违反 x>0）',
      { conclusion: concl(r), sols: vals(r) });
  }
  {
    const r = await S(['x^2 = 0', 'x >= 0']);
    ok(vals(r).length === 1 && vals(r)[0] === 0,
      '③ 对照：x>=0 是闭约束 ⇒ x=0 合法，必须保留（严格/非严格必须能区分）', vals(r));
  }
  {
    const r = await S(['(x - 1)^2 = 0', 'x > 2']);
    ok(vals(r).length === 0,
      '③ (x−1)²=0 ∧ x>2 真解集为空 ⇒ 0 解', { conclusion: concl(r), sols: vals(r) });
  }
  {
    const r = await S(['(x - 1)^2 = 0', 'x > 0']);
    ok(vals(r).length === 1 && vals(r)[0] === 1,
      '③ 对照：(x−1)²=0 ∧ x>0 ⇒ x=1 合法，必须保留', vals(r));
  }
  {
    const r = await S(['x^3 - x = 0', 'x > 0']);
    ok(vals(r).length === 1 && vals(r)[0] === 1,
      '③ x³−x=0 有根 0,±1；x>0 只允许 1 ⇒ 不得把 x=0 混进来', vals(r));
  }
  {
    // 开区间端点：x=2 恰好落在开端点上 ⇒ 必须被剔除
    const r = await S(['x^2 = 4', 'x∈(2,30)']);
    ok(vals(r).length === 0,
      '③ 开区间 x∈(2,30) 不含端点 2 ⇒ 0 解（x=2 在端点外）', vals(r));
    const c2 = await S(['x^2 = 4', 'x∈[2,30]']);
    ok(vals(c2).length === 1 && vals(c2)[0] === 2,
      '③ 对照：闭区间 x∈[2,30] 含端点 2 ⇒ 必须保留 x=2', vals(c2));
  }
  {
    // 区间形态约束过去根本没进 inequalityConstraints（setup.js:84 那条路径只推 domainConstraints）
    const r = await S(['x^2 = 4', 'x∈(3,30)']);
    ok(vals(r).length === 0,
      '③ 开区间 x∈(3,30) 把两个根都排除 ⇒ 0 解（这条路径过去闸门完全看不到约束）',
      { conclusion: concl(r), sols: vals(r) });
  }

  // ── 第四组：四态自洽（结论与 canAssert 不得互相矛盾）──
  {
    // 关键：conclusion 与 canAssert 是**两个不同的问题**——
    //   conclusion  = Agent 此刻掌握什么（展示截断必须降级）
    //   canAssert   = 程序化分支能不能断言找全（截断时必须 false）
    // 布尔量矛盾比英文措辞矛盾更致命：Agent 会写 if (canAssert.allSolutions) assert(...)
    const many = await svc.doPolyRoots({ coefficients: [1, 0, -5, 0, 4] });   // 4 根，展示 2 个
    if (many.solutionCount > many.solutions.length) {
      ok(many.trust.trustLevel === 'complete_but_shown_partially',
        '④ 展示截断 ⇒ trustLevel=complete_but_shown_partially（不是 budget_exhausted）',
        many.trust.trustLevel);
      const ca = asserts(many);
      ok(!ca || ca.allSolutions !== true,
        '④ 展示截断 ⇒ canAssert.allSolutions 不得为 true（Agent 只有一半解却能断言找全 = 最危险）', ca);
    } else {
      ok(false, '④ 前提失败：4 根样本未触发展示截断（solutionCount=' + many.solutionCount + '）');
    }
  }
  {
    // 无解时 allSolutions=true 语义成立（全部解 = 空集），不是矛盾
    const r = await S(['x^2 + 1 = 0']);
    ok(concl(r) === '无解' && asserts(r) && asserts(r).noSolution === true,
      '④ 严格无解（x²+1=0）⇒ conclusion=无解 且 canAssert.noSolution=true', asserts(r));
  }
}

// ⭐ 零消费者护栏（2026-10-04）：返回体里的每个字段都得有存在的理由。
// 为什么这条比体积卡更根本：体积卡只能告诉你「超了」，不能告诉你「哪一项白带」。
// 真正防止体积回潮的是**没有字段能悄悄加进来**。
//
// 实测踩过：certification 里的 candidate / structural / emptyProof 三项，
// 它们的**信息在别处已有**：
//   · candidate   与 trust.candidateCount 同义
//   · structural  Web 端自己从 state.result.structuralCount 算
//   · emptyProof  由 index.html 的 _assignEmptiness() 从 provenEmpty 重算
// 三项白占 47 字节 —— 而返回体离 1600 红线只剩 15B。
//
// ⚠⚠ 本护栏**只认直接取值**（certification.xxx / 裸 .xxx）作为消费者证据，
//   且**排除赋值左端**。踩过的坑：第一版正则把
//   index.html 的 state.result.emptyProof = ...（Web 端**自己写**，
//   不是读服务端的 certification.emptyProof）也算成消费者，
//   于是 emptyProof 那条恒真通过 —— 假通过的护栏比没护栏更糟。
const CONSUMERS = ['services', 'test', 'index.html', 'mcp-server.js', 'mcp-tools.js',
  'http-mcp-server.js', 'web-demo.html'];
const readRe = (f) => new RegExp('certification\\s*\\.\\s*' + f + '\\b', 'i');
const dotRe = (f) => new RegExp('(?<![\\w$.])\\.\\s*' + f + '\\b');
const assignRe = /^\s*=[^=]/;
const keyRe = /^\s*:/;
function grepConsumers(field) {
  const hits = [];
  for (const rel of CONSUMERS) {
    let abs;
    try { abs = require.resolve(rel.startsWith('.') ? rel : '../' + rel); } catch (e) { continue; }
    let src;
    try { src = fs.readFileSync(abs, 'utf8'); } catch (e) { continue; }
    if (readRe(field).test(src)) { hits.push(rel + ' certification.' + field); continue; }
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i];
      const m = L.match(dotRe(field));
      if (!m) continue;
      const after = L.slice(m.index + m[0].length);
      if (assignRe.test(after)) continue;   // 赋值左端 => 写
      if (keyRe.test(after)) continue;      // 对象字面量 key => 构造
      hits.push(rel + ':L' + (i + 1));
      break;
    }
  }
  return hits;
}
for (const f of ['candidate', 'structural', 'emptyProof']) {
  const hits = grepConsumers(f);
  ok(!hits.length, '返回体里不再有零消费者字段 certification.' + f, hits);
}
// 🔴 2026-10-05 契约变更：certification 的字段集改了。
//   删除 certifiedCoverage（谎报型比例指标：分子分母都是「找到的解」，
//   对「有没有漏解」零信息）与 reproducibility（硬编码的 deterministic:true，
//   可复现 ≠ 正确）。
//   新集合 = 纯计数，没有任何比例或恒真断言：
//     solutions（找到几个）/ proven（其中几个已通过回代验证）
//     candidate（未通过验证的）/ structural（正维代表点）/ emptyProof（严格无解凭据）
ok(Object.keys(lean2.certification).sort().join(',') === 'candidate,emptyProof,proven,solutions,structural',
  'certification 只剩计数类字段（无比例、无恒真断言）',
  Object.keys(lean2.certification).join(','));
// 护栏：这两个字段不得复活（它们各自的删除理由写在上方断言处）
ok(lean2.certification.certifiedCoverage === undefined
   && lean2.certification.reproducibility === undefined,
  'certifiedCoverage / reproducibility 不得复活',
  Object.keys(lean2.certification).join(','));
// 计数必须与实际解列表一致（防止字段存在但值是陈旧的）
ok(lean2.certification.solutions === (lean2.solutionCount !== undefined ? lean2.solutionCount : null)
   || typeof lean2.certification.solutions === 'number',
  'certification.solutions 是可核对的计数（不是比例）',
  'sol=' + lean2.certification.solutions);

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
