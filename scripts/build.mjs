// 构建脚本（零运行时依赖）
//
// 为什么需要它：
//   引擎源码被切成 src/engine 下 32 个「区块」（plain script，内容零改写），
//   因为原引擎是单作用域 + 6 个隐式全局（_solveRecursionCount / __LS_ROOT_START / ...），
//   拆成独立 ESM 模块会立刻 ReferenceError，而且裸名改写会破坏对象字面量键/简写/解构。
//   所以：文件层面模块化（改一处只动一个文件），构建期拼接到同一作用域。
//
// 产出：
//   dist/lingshu.mjs           ESM（Node / MCP / npm）
//   dist/lingshu.global.js     经典脚本，挂 globalThis.LingShu（浏览器，可直接 file:// 打开）
//   index.html                 里面的 <script id="solver-core"> 区块被替换为构建产物
//                              ⚠️ index.html 的该区块是产物，手改会被下次构建抹掉；改去 src/engine/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Windows 上 new URL(...).pathname 会得到 "/D:/..." 这种带前导斜杠的怪路径，必须走 fileURLToPath
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = 'src/engine';

// 区块装载顺序：常量/基础设施 → 代数 → 算子 → 流水线 → UI
// （函数声明具提升性，跨区块引用不依赖顺序；这里只影响「初始化语句」的执行先后，
//   目前只有 OPS_* 表在初始化时调 _op，故 _op 所在的 operators/registry 里已把它排到最前）
const RANK = {
  constants: 1, lex: 2, 'ast/basic': 3, 'interval/core': 4, 'interval/affine': 5,
  'algebra/exact': 6, 'algebra/multivar': 7, 'algebra/resultant': 8, 'algebra/simplex': 9,
  'algebra/homotopy': 9.5,
  'numeric/polynomial': 10, 'numeric/linear': 11, 'numeric/root': 12, ode: 13,
  'rootbound-poly': 14, certify: 15, conclusion: 16,
  'operators/setup': 17, 'operators/pre': 18, 'operators/screen': 19, 'operators/support': 20,
  'operators/geometry': 21, 'operators/homotopy': 21.5, 'operators/contract': 22, 'operators/numeric': 23, 'operators/post': 24,
  'operators/branch': 25, 'operators/ineq': 26, 'operators/output': 27, 'operators/registry': 28,
  'pipeline/dimroute': 28.5,
  'pipeline/scheduler': 29, 'pipeline/solver': 30, 'pipeline/report': 31, 'pipeline/output': 32, ui: 33,
};

// 递归收集 src/engine 下**所有** .js（RANK 里写的是相对路径，如 'operators/setup'）。
// ⚠️ 旧实现只 readdirSync 了 src/engine 顶层，导致 operators/ 子目录里
//    漏写进 RANK 的模块（最典型：operators/algebra.js，定义 suan14 等一整套代数算子）
//    被静默丢弃 → 拼出来的引擎缺函数 → ESM 一 import 就 "suan14 is not defined"。
//    现在：整树扫描 + RANK 有就按 RANK 排序，没有就排后（rank 500）。
//    函数声明有提升，跨区块引用不依赖顺序；顺序只影响「初始化语句」的执行先后。
function listBlocks() {
  const mods = [];
  (function walk(dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(p, r);
      else if (e.name.endsWith('.js')) mods.push(r.replace(/\.js$/, ''));
    }
  })(path.join(ROOT, ENGINE), '');

  return mods
    .map((mod) => ({
      mod,
      rank: RANK[mod] !== undefined ? RANK[mod] : 500,
      src: fs.readFileSync(path.join(ROOT, ENGINE, mod + '.js'), 'utf8'),
    }))
    .sort((a, b) => (a.rank - b.rank) || (a.mod < b.mod ? -1 : 1));
}

// 顶层隐式全局：原脚本靠宽松模式「typeof x === 'undefined' 就赋值」顺手建全局，
// 拼进 ESM（严格模式）必须先显式 var 声明，否则赋值直接 ReferenceError。
const IMPLICIT = ['_solveRecursionCount', '__LS_ROOT_START', '__LS_SOLVE_ACTIVE', '__LS_BRANCH_BUDGET', '__LS_MSNEWTON_DONE', 'branchBudget', '_varsTouched'];

const blocks = listBlocks();

// ── 隐式全局自动兜底 ───────────────────────────────────────────────
// 原引擎是浏览器宽松脚本，有些「全局状态」是靠行首裸赋值（function 内 `resultTypeName = '...'`）
// 隐式创建 window 属性的，全文搜不到任何 var/let/const 声明。审计器（scripts/audit.mjs）扫出
// 这类漏网的有 16 个：B/opts/viol/gm/cy/_fe/_hi/resultTypeName/resultTypeDesc/recD2/rhsNode/
// _ineqRight/maxRounds/equationStrs/text/summaryColor。
// 浏览器宽松模式下能跑，一旦拼进 ESM（严格模式）就是 ReferenceError，属于定时炸弹。
// 这里按「行首裸赋值 + 全文零声明」自动扫出来，统一 var 声明 —— 语义完全不变。
const _declaredAll = new Set();
for (const m of body0Safe(blocks)) _declaredAll.add(m);
const extraImplicit = new Set();
for (const line of body0Safe(blocks).split('\n')) {
  const m = /^\s*([A-Za-z_$][\w$]*)\s*=[^=]/.exec(line);
  if (m && !_declaredAll.has(m[1]) && !IMPLICIT.includes(m[1])) extraImplicit.add(m[1]);
}
const allImplicit = [...new Set([...IMPLICIT, ...extraImplicit])].sort();
function body0Safe(bs) { return bs.map((b) => b.src).join('\n'); }

const body = [
  '// ─── 灵数求解器引擎（构建产物，勿手改；源码见 src/engine） ───',
  '// 模块装载顺序：' + blocks.map((b) => b.mod).join(' → '),
  '',
  '// 原引擎的隐式全局（' + IMPLICIT.length + ' 个已知 + ' + extraImplicit.size + ' 个自动扫出），ES 严格模式必须显式声明',
  allImplicit.map((g) => 'var ' + g + ';').join(' '),
  '',
  '// 非致命异常观测点：原来有 8 处 `catch(e){}` 静默吞异常；这里改成显式调用本钩子（默认空实现），',
  '// 语义（继续容错）不变，但异常有处可查，生产环境可替换成本地日志/上报，杜绝 fail-silent。',
  'function _lsNoteInternal(e, ctx) { void e; void ctx; }',
  '',
  ...blocks.map((b) => '// ═══════════════════ 模块：' + b.mod + ' ═══════════════════\n' + b.src),
].join('\n');

// 导出面：所有「真·顶层」函数声明 + 顶层 var/const/let
//
// 为什么必须按「词法深度」过滤：
//   原引擎是单作用域宽松脚本，有些**局部变量**（最常见的是 eqFeatures / skipOperators）
//   恰好顶格书写（行首第 0 列），但在词法上它们位于某个 function 体内（花括号深度 > 0）。
//   之前只按「行首第 0 列」收集，会把它们塞进 export { ... }，
//   而 ESM 严格模式下 export 一个函数局部 var 会在解析期直接报
//   "SyntaxError: Export 'eqFeatures' is not defined"。
//   这里逐行跟踪花括号深度：只有「该行开始时 depth === 0」的声明才是真·顶层。
function publicNames(bodyText) {
  const set = new Set();
  let depth = 0;                       // 当前词法花括号深度
  for (const line of bodyText.split('\n')) {
    const depthStart = depth;          // 本行开始时是否已经处在某个函数体/块里
    if (depthStart === 0) {
      // ^ 保证声明顶格（前面只有空白），depthStart===0 保证它不在任何函数体里
      let m = /^(?:async\s+)?function\s+([\w$]+)/.exec(line);
      if (m) set.add(m[1]);
      m = /^(?:const|let|var)\s+([\w$]+)\s*=/.exec(line);
      if (m) set.add(m[1]);
    }
    // 更新深度：统计本行花括号（净变化；跨行的对象/函数字面量最终会配平）
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
    }
  }
  return [...set].sort();
}
const names = publicNames(body);

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });

// 1) ESM
const esm = body + '\n\nexport { ' + names.join(', ') + ' };\n';
fs.writeFileSync(path.join(ROOT, 'dist/lingshu.mjs'), esm);

// 2) 全局经典脚本（浏览器 file:// 直开）
const glob = body + '\n\nglobalThis.LingShu = { ' + names.join(', ') + ' };\n';
fs.writeFileSync(path.join(ROOT, 'dist/lingshu.global.js'), glob);

// 3) 注入 index.html（保留 <script id="solver-core"> 这个 id，下游 solver-core.js/旧代码找它）
const htmlPath = path.join(ROOT, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');
const re = /<script id="solver-core">([\s\S]*?)<\/script>/;
if (!re.test(html)) { console.error('index.html 里找不到 <script id="solver-core">'); process.exit(1); }
html = html.replace(re, () => '<script id="solver-core">\n' + glob + '\n</script>');
fs.writeFileSync(htmlPath, html);

console.log('构建完成');
console.log('  区块数', blocks.length, '| 导出名', names.length);
console.log('  dist/lingshu.mjs      ESM');
console.log('  dist/lingshu.global.js  经典脚本');
console.log('  index.html           solver-core 区块已替换为构建产物（'+ glob.length +' 字节）');
