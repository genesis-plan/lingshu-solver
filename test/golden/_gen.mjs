// 引擎模块化生成器（第二版：共享作用域 attach 架构）
//
// 为什么不是「每个模块一个独立 ES module」：
//   原引擎是 15978 行单作用域 + 6 个隐式全局（_solveRecursionCount / __LS_ROOT_START / ...），
//   靠「宽松模式的隐式全局」跨函数共享状态。ES module 恒为严格模式，独立模块里
//   `x = 0` 直接 ReferenceError，且 import 绑定不可写 ⇒ 拆成独立模块必炸。
// 所以采用 attach（装填）架构：
//   每个模块 = 一个 install*(S) 函数，把自己的函数装到共享 scope S 上；
//   S 只有一个 ⇒ 单作用域语义 100% 保留，同时文件/目录层面是真模块化。
//
// 切分方式：深度感知找出「顶层块」（函数声明 / 顶层 const|let|var），339 个函数一个不少地搬迁，
// 块内代码原样，只把 `function f(` 改写成 `S.f = function f(` 并把其他标识符引用改成 `S.x`。
// 字符串/注释会先打码，避免把报错文案里的算子名误改。
// 不变式：切完必须跑 test/golden/diff.mjs 与重构前基线逐字节对拍。
import fs from 'fs';
import path from 'path';

const OUT = 'src/engine';
const html = fs.readFileSync('index.html', 'utf8');
const code = html.match(/<script id="solver-core">([\s\S]*?)<\/script>/)[1];
const L = code.split('\n');

const DECL = /^(?:async\s+function\s+[\w$]+|function\s+[\w$]+|const\s+[\w$]+\s*=|let\s+[\w$]+\s*=|var\s+[\w$]+\s*=)/;
const depthBefore = [];
let d = 0;
for (const line of L) { depthBefore.push(d); for (const ch of line) { if (ch === '{') d++; else if (ch === '}') d--; } }
const starts = [];
for (let i = 0; i < L.length; i++) if (depthBefore[i] === 0 && DECL.test(L[i])) starts.push(i);
starts.push(L.length);

const chunks = [];
for (let k = 0; k < starts.length - 1; k++) {
  const from = starts[k], nextDecl = starts[k + 1];
  const isFn = /^(?:async\s+function|function)/.test(L[from]);
  let to = nextDecl;
  if (isFn) for (let i = from; i < nextDecl; i++) if (i > from && depthBefore[i] === 0) { to = i + 1; break; }
  chunks.push({ from, to, isFn, text: L.slice(from, to).join('\n') });
}

function declName(t, isFn) {
  if (isFn) { const m = t.match(/^(?:async\s+)?function\s+([\w$]+)/); return m ? { kind: 'fn', name: m[1] } : { kind: 'raw', name: null }; }
  const m = t.match(/^(?:const|let|var)\s+([\w$]+)\s*=/); return m ? { kind: 'var', name: m[1] } : { kind: 'raw', name: null };
}

// ── OPS 表 → 阶段（权威：算子注册处） ──
const OPS_TABLE = {};
for (const t of ['OPS_SETUP', 'OPS_PRE', 'OPS_SCREEN', 'OPS_ALGEBRA', 'OPS_ALGEBRA2', 'OPS_CONTRACT', 'OPS_GEOMETRY', 'OPS_NUMERIC', 'OPS_POST']) {
  const m = code.match(new RegExp('var\\s+' + t + '\\s*=\\s*\\[([\\s\\S]*?)\\n\\];'));
  if (m) for (const mm of m[1].matchAll(/_op\(\s*'(suan\d+)'/g)) OPS_TABLE[mm[1]] = t;
}
OPS_TABLE['suan47'] = 'OP_BRANCH'; OPS_TABLE['suan48'] = 'OP_INEQ'; OPS_TABLE['suan49'] = 'OP_OUTPUT';
const STAGE2MOD = {
  OPS_SETUP: 'operators/setup', OPS_PRE: 'operators/pre', OPS_SCREEN: 'operators/screen',
  OPS_ALGEBRA: 'operators/algebra', OPS_ALGEBRA2: 'operators/algebra',
  OPS_CONTRACT: 'operators/contract', OPS_GEOMETRY: 'operators/geometry',
  OPS_NUMERIC: 'operators/numeric', OPS_POST: 'operators/post',
  OP_BRANCH: 'operators/branch', OP_INEQ: 'operators/ineq', OP_OUTPUT: 'operators/output',
};

const RULES = [
  [/^(parse|getFuncChildren|getFuncChildrenAll|gammaLanczos|evalAST|evalLimit|aitkenAccelerate|hessianTaylorApprox|matrixDeterminant|extractVariables|decomposeByVariableGraph|hasVariable|isLinear|extractLinearCoefficients|extractVarCoefficient|findExplicitForm|astNodeCount|substituteVar|astEqual|hasCalculusOp|scanASTForLargeNumbers|_isLinearAST|_linearSystemConsistent|_permutations|_symmetryExpand)$/, 'ast/basic'],
  [/^(gaussianSolve|gaussianSolveRect|extractPolynomialCoefficients|_sturmCompletenessCheck|_rat50|_pointResidual|isPolynomial|collectVariableDenominators|tryRationalTransform|replaceDivisionByOne)$/, 'numeric/linear'],
  [/^(_simplexCore|_lpMaximize|_generateCorners)$/, 'algebra/simplex'],
  [/^(_cloneBox|_intervalJacobian)$/, 'interval/core'],
  [/^(_hc4Node2|_hc4Node)$/, 'operators/contract'],
  [/^(_suan56Project)$/, 'operators/geometry'],
  [/^(_suan57Prune)$/, 'operators/post'],
  [/^(_s58ConstVal|_s58MatchBasicTrig|_suan58BasicTrig)$/, 'operators/screen'],
  [/^(_suan55Monotone|_suan55Refine|_armijoLineSearch)$/, 'numeric/root'],
  [/^(_suan59SolveBinaryPoly|_suan59RunTernary|_suan59SolveTernaryPoly)$/, 'algebra/resultant'],
  [/^(_ieeeReset|_utf8Bytes|_sha256|_computeReportId)$/, 'pipeline/report'],
  [/^(_movabilityFull|_updateMovability|_hasExplodedMovability)$/, 'pipeline/scheduler'],
  [/^(_recommendKey|_recommendKeyCmp|pickRecommended|sortAndOutput|verifyAllConstraints|_runTail)$/, 'pipeline/output'],
  [/^(_greekNameToSymbol|tokenize|fuzzyFix|parseCondition|Parser|ParserNode)$/, 'lex'],
  [/^(_iAdd|_iSub|_iMul|_iRecip|_iIntersect|_iHull|_iEmpty|_iNorm|_iRoot|_iDelta|_iDiv|_iPow|_iAbs|_iMax|_iMin|_midVars|intervalEval|_rangeEval|_partialRange|_diffAST|rToI|iMul|iAdd|iMatVec|rMatVec|rMatIMat|iMatSubReal|iMatSub|realIdentity|iVecInterior|realMatInv|iVecDisjoint|_boxLogVolume|_boxMid|_contractionChanged|_clampBox|_declareNoSolution|_mergeBox|_emptyBox)$/, 'interval/core'],
  [/^(_Aff|_affRad|_affToInterval|_affAdd|_affSub|_affMul|_affInv|_affDiv|_affCmp|_affNearlyEqual|_buildAffEnv|_affineEval|_ivExcludesZero|_affHas|_affTrim)$/, 'interval/affine'],
  [/^(_s59Num.*|_s59P.*|_s59BQOps|_s59BQ.*|_s59BT.*|_s59PRS.*|_s59SquareFree|_s59Y.*|BQNorm|BQAdd|BQSub|BQScale|BQMul|BQIsZero|BQIsConst|BQEval|BQDegX|BQDegY|BQTotalDeg|BQMaxAbs|BTNorm|BTAdd|BTSub|BTMul|BTIsZero|BTDegZ)$/, 'algebra/multivar'],
  [/^(_s60.*|suan60)$/, 'algebra/exact'],
  [/^(_s59.*|suan59)$/, 'algebra/resultant'],
  [/^(_sturmChainAsc|_sturmVariations|_sturmCountAsc|_polyRemainderAsc|_polyDerivAsc|_polyTrimAsc|_polyEvalAsc|_bisectRoot1D|_recScanInterval|_linearCoef1D|_detectPeriod1D|_eqRefsOnlyAllowed|_polyGcd|_polyDivExact|polyEval|syntheticDivide|solveQuadraticFormula|rationalRootTheorem|polynomialAllRoots|scanRealRoots|polyDerivative|_uniToDoubles)$/, 'numeric/polynomial'],
  [/^(_mirandaCertify|_inflateRefineCertify|_krawczykOnce|_krawczykOnBox|krawczykCertify|_smaleFact|_smaleInfNorm|_smalePickDomain|_smaleAlphaCertify|_certifySolutions|_globalBranchCertify|_mergeGlobalBranch|_numJac|_assertContraction|_mirandaBox|_signAt|_newtonRefine|_domBoxOf)$/, 'certify'],
  [/^(_genCorners|generateStartPoints|_multiStartNewton|suan47_tryNewton|_newtonSolve|deduplicateSolutions|roundToGrid|_bisectRoot|_secantSolve)$/, 'numeric/root'],
  [/^(picardSolve|duhamelDecompose|enhancedODESolve|standardRK4|classifyODE|hasY2Term|checkLinearODE|isLinearODE|isLinearInY|estimateLipschitzConstant|isContractionMapping|extractLinearYTerm|odeSolve)$/, 'ode'],
  [/^(_suan56Project|_suan57Prune|suan58|_simplexCore|_lpMaximize|hasPolynomial)$/, 'operators/support'],
  [/^(_op|_suan52.*|_runOp|_runSeq|_runPipeline|_runContractionFixpoint|_routeOperators)$/, 'pipeline/scheduler'],
  [/^(solve|_solveImpl|_finish|_buildMeta|_collectVars|_faithfulEqsBindable|_residualAt|_filterIllDefined|_enforceVarInvariant|_complianceGuard|_lsTryWholeIdentifier|getOutputVarNames|reconstructSolution|_assignTiers|_assignEmptiness|_assignCompleteness|_assignCertBlock|_suan0_classify|_isPolynomialSystem|_numericJacobianRank|_matrixRank|_opRoutingLog|_runStage|_opRunLog|_opCost|_opCostTable)$/, 'pipeline/solver'],
  [/^(openAgreement|closeAgreement|openAgentModal|closeAgentModal|copyText|copyTextRaw|copyToClipboard|fallbackCopy|toggleInfoPanel|loadExample|cleanInput|runSolver|_fmtResidual|_residualAtDisplayed|_escHtml|displayResult|showError|runDemo)$/, 'ui'],
];

const ownedBy = Object.create(null);
const moduleMembers = new Map();
function put(mod, chunk, name, kind) {
  if (!moduleMembers.has(mod)) moduleMembers.set(mod, []);
  moduleMembers.get(mod).push({ name, kind, text: chunk.text });
  if (name) ownedBy[name] = mod;
}
const IMPLICIT = ['_solveRecursionCount', '__LS_ROOT_START', '__LS_SOLVE_ACTIVE', '__LS_BRANCH_BUDGET', 'branchBudget', '_varsTouched'];

for (const c of chunks) {
  const { name, kind } = declName(c.text, c.isFn);
  if (c.isFn) {
    let mod = null;
    if (/^suan\d+$/.test(name) && OPS_TABLE[name]) mod = STAGE2MOD[OPS_TABLE[name]];
    else for (const [re, m] of RULES) if (re.test(name)) { mod = m; break; }
    if (!mod) mod = /^suan\d+$/.test(name) ? 'operators/unassigned' : 'operators/support';
    put(mod, c, name, 'fn');
  } else {
    let mod = 'constants';
    if (/_op\('suan/.test(c.text) || /^var\s+(OPS_|OP_)/.test(c.text)) mod = 'operators/registry';
    else if (/^var\s+(SOLVER_VERSION|EXAMPLES|EXAMPLE_|pendingExampleDomain)/.test(c.text)) mod = 'ui';
    else if (name && /^(eqFeatures|skipOperators)$/.test(name)) mod = 'operators/screen';
    if (name) ownedBy[name] = mod;
    put(mod, c, name, 'var');
  }
}

// ══ 装填式生成 ══
const RENAME = Object.create(null);
for (const k of Object.keys(ownedBy)) RENAME[k] = 1;
for (const k of IMPLICIT) RENAME[k] = 1;
const NAMES = Object.keys(RENAME).sort((a, b) => b.length - a.length);
const RE_NAME = new RegExp('(?<![\\w$.])(?:' + NAMES.join('|') + ')(?![\\w$])', 'g');

function renameIdentifiers(src) {
  const stash = [];
  const tok = (i) => ' ' + i + ' ';
  let s = src.replace(/\/\*[\s\S]*?\*\//g, (m) => { stash.push(m); return tok(stash.length - 1); });
  s = s.replace(/'(?:\\.|[^'\\])*'/g, (m) => { stash.push(m); return tok(stash.length - 1); });
  s = s.replace(/"(?:\\.|[^"\\])*"/g, (m) => { stash.push(m); return tok(stash.length - 1); });
  s = s.replace(/`(?:\\.|[^`\\])*`/g, (m) => { stash.push(m); return tok(stash.length - 1); });
  s = s.replace(/\/\/[^\n]*/g, (m) => { stash.push(m); return tok(stash.length - 1); });
  s = s.replace(RE_NAME, 'S.$&');
  return s.replace(/ (\d+) /g, (_, i) => stash[+i]);
}

fs.rmSync(OUT, { recursive: true, force: true });

const RANK = ['constants, 'lex', 'ast/basic', 'interval/core', 'interval/affine',
  'algebra/exact', 'algebra/multivar', 'algebra/resultant', 'algebra/simplex',
  'numeric/polynomial', 'numeric/linear', 'numeric/root', 'ode', 'certify',
  'operators/setup', 'operators/pre', 'operators/screen', 'operators/support',
  'operators/geometry', 'operators/contract', 'operators/numeric', 'operators/post',
  'operators/branch', 'operators/ineq', 'operators/output', 'operators/registry',
  'pipeline/scheduler', 'pipeline/solver', 'pipeline/report', 'pipeline/output', 'ui'];
const rank = (m) => { const i = RANK.indexOf(m); return i < 0 ? 999 : i; };

function pascal(s) { return s.split(/[/\-]/).map(x => x[0].toUpperCase() + x.slice(1)).join(''); }

for (const [mod, mem] of moduleMembers) {
  const mems = mod === 'operators/registry' ? [...mem].sort((a, b) => (a.name === '_op' ? -1 : b.name === '_op' ? 1 : 0)) : mem;
  // 关键：区块内容一个字都不改（裸标识符引用全部保留），拼接后靠同一作用域解析。
  // 曾试过把裸名改成 S.x，结果对象字面量键/简写/解构会被改坏（{foo} / {foo:bar} / {foo()}）。
  let src = '/* 模块 ' + mod + '\n' +
    ' * 来源：由 test/golden/_gen.mjs 从 index.html 里的 <script id="solver-core"> 机械切分。\n' +
    ' * 约定：本文件是「构建期拼接」的一个区块，内部标识符保持原样（裸名引用保留），\n' +
    ' *       由构建脚本接到与其它区块的同一作用域。改这个模块只动本文件，不要动 index.html。\n' +
    ' */\n';
  src += mems.map((m) => m.text).join('\n\n');
  const rel = path.join(OUT, mod + '.js');
  fs.mkdirSync(path.dirname(rel), { recursive: true });
  fs.writeFileSync(rel, src);
}

// 注：隐式全局与统一出口改由 scripts/build.mjs 负责（区块拼接后统一 var 声明 + export 尾巴）

const totalFn = [...moduleMembers.values()].reduce((a, m) => a + m.filter(x => x.kind === 'fn').length, 0);
console.log('模块文件', mods.length, '| 函数合计', totalFn, '(应 339)');
for (const m of mods) console.log('  ' + m.padEnd(22), moduleMembers.get(m).length);
