// 注释简化工具（可复用）
//
// 目标：把「废话备注」删掉，把「为什么」保住。
//   - 删：分隔装饰线、空注释、超短废话（「定义变量」「求和」「这里开始」…）、全局重复的同一句话
//   - 留（白名单）：诚实红线 / 不谎称证明 / 数学依据（Krawczyk·Miranda·Bézout）/ 安全审计 /
//                    踩坑原因 / 版本号原因 / fail-closed / 确定性可复现 等「为什么」型注释
//
// 用法: node scripts/simplify-comments.mjs --dry-run    # 只统计不动手
//       node scripts/simplify-comments.mjs              # 实际改写
//
// 说明：本工具只动「独立注释行」（整行以 // 开头），绝不动行尾注释与字符串里的 //（如 https://），
//       所以不会破坏代码语义；改完用 `npm run golden` 验证零行为变更。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');

// 只处理「产品代码」：引擎模块 + 服务层 + 根产品 js（测试与原型目录不动）
function walk(dir, rel = '', out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) walk(p, r, out);
    else if (/\.(js|mjs)$/.test(e.name)) out.push(r);
  }
  return out;
}
// 注意：walk 返回的是「相对入参 dir」的路径，必须原样带着 dir 拼绝对路径。
// 曾经写成 path.join(ROOT, f) 导致 src/engine 前缀被丢掉、32 个引擎文件全被 existsSync 跳过，
// 工具静默「什么都没做」——凡是静默成功都要当成失败看待。
const files = [
  ...walk(path.join(ROOT, 'src', 'engine')).map((r) => path.join(ROOT, 'src', 'engine', r)),
  ...walk(path.join(ROOT, 'services')).map((r) => path.join(ROOT, 'services', r)),
  ...['mcp-server.js', 'http-mcp-server.js', 'solver-core.js', 'reconcile-bank.js', 'native-bridge.js']
    .map((f) => path.join(ROOT, f))
];

const MISSING = files.filter((f) => !fs.existsSync(f));
if (MISSING.length) {
  console.error('✗ 目标文件不存在，工具中止（不写任何文件）：');
  for (const f of MISSING) console.error('  ' + f);
  process.exit(1);
}

// ── 白名单：命中就绝不删（这些是「为什么」，是产品资产）──
const KEEP = /诚实|谎称|不?[能得]?证明|红线|严格证明|未找到实数解|无法求解|Krawczyk|Miranda|Bézout|Bezout|定理|否则|因为|所以|安全|审计|可复现|确定性|fail-closed|failclosed|兜底|防|拒绝|不可|必须|禁止|不得|踩坑|原因|为何|为什么|剂|预算|超时|截断|完备|上界|下界|区间|认证|规划版本号|1\.0\.2\d|2026-|版本漂移|护栏|常量单一来源|共享层|单一事实|旧做法|新做法|注意（|注意:|注意，/;

// ── 二级白名单：人工逐条复核后追加（「短但有信息量」的注释）──
// 判据：说了代码本身看不出来的意图 —— 调度取舍 / 算法名 / 数学术语 / 意图声明。
// 这几条单看都像废话，删了会丢真信息：
//   「已是多项式 ⇒ suan51 闭式路径更快，不抢」  调度决策（谁抢谁）
//   「跳过条件：欠定不走分支定界…」              fail-closed 前置条件
//   「用多起始点牛顿法求解边界方程组」            算法名（牛顿法 = 哪条数值路线）
//   「尝试从方程中推导新已知值（模式匹配）」      意图（不是纯代数，是模式识别）
//   「计算梯度·方向乘积（用于 Armijo 条件）」    数学术语（Armijo 是收敛判据名）
//   「更新前记录旧残差，用于判断是否停滞」        为什么（停滞检测）
const KEEP2 = /已是多项式|不抢|跳过条件|多起始点|牛顿法|模式匹配|Armijo|梯度|停滞|旧残差|闭式路径|不抢|象限|混合符号|闭式|走分支定界/;
const KEEPALL = new RegExp(KEEP.source + '|' + KEEP2.source);

// ── 废话模式 ──
const BORING = /^(定义|声明|初始化|设置|获取|读取|写入|创建|新建|开始|结束|返回|计算|求和|循环|判断|这里|这里开始|下面|下面开始|上面|以上|以下|简单|默认|注意|说明|注释|本文件|此文件|函数|变量|常量|参数|结果|步骤|流程|逻辑|代码|实现|处理|转换|追加|删除|添加|修改|检查|验证|输出|输入|求解|整理|组装|拼接|构造|生成|产生|取出|赋值|比较|交换|清空|启动|停止|关闭|打开|展示|显示|渲染|绑定|订阅|监听|发送|接收|响应|请求|调用|执行|运行|完毕|ok|done|true|false|null|undefined)$/i;

// 纯装饰线（只有符号没有文字）才删。
// 反例必须留：`// ===== 阶段 3｜代数闭式求解（cost 1~3）=====` 是流水线导航锚点，
// 删了 solver.js 就读不出「一共有哪几个阶段」——文字部分一个字不动。
const DECOR = /^[\s=_~*#-]{3,}$|^[=\-~*#]{2,}\s*$/;

// ── 贴职责（restate）：注释只把紧邻代码的语义再念一遍 ──
// 判据三件套（同时满足才删，宁可漏删不可错删）：
//   ① 以「动词+常见宾语」开头（计算/限制/得到/取/转成/遍历…），且总长 ≤ 24 字；
//   ② 不含任何数学/逻辑符号（= ⇒ → | ∈ Σ Π ∫ ≤ ≥ ≠ x y z i j k n m f g h t …）；
//   ③ 不含 KEEP 里任何「为什么」词。
// 反例（必须保留）：「化成 1：整行除以主元（有理精确）」「R7 严格对角占优（唯一解定论）」
//   ——它们带规则编号或数学结论，删了代码就成了天书。
const RESTATE = /^(计算|限制|得到|取到|取出|转成|变成|遍历|累加|依次|逐个|逐行|跳过|过滤|排序|比较|判断|尝试|确保|保持|记录|更新|建立|构造出?|生成|产出|得到|求出|处理|扩展|映射|整理|汇总|清空|重置|备份|恢复|继续|开始|结束|进入|退出|返回|传出|传入|读取|写入|追加|清点|对齐|裁剪|收集|汇总|走|做|用|把|将)(?!.*(必须|否则|因为|所以|注意|不可|不能|防止|避免|踩坑|实测|实测教训|第三方|病根|教训))/;
const MATHY = /[=＝⇒→⟹|｜∈∉ΣΠ∫∑∏≤≥≠≈∞√±]|\b[A-Za-z]\s*\(|\bR[0-9]|\bKrawczyk|\bMiranda|\bB[eé]zout|\bSturm|\bBareiss|\bSylvester|\bPRS\b|\bLevy|\bMarkowitz|\bGauss|\bJacobi|\bNewton|\bphase[ _]?[12I]/i;

// 全局重复计数（同一句注释文本出现 ≥2 次 → 后面全是废话重复）
const textCount = new Map();
function collect(lines) {
  for (const L of lines) {
    const t = L.trim();
    if (!t.startsWith('//')) continue;
    const txt = t.replace(/^\/+/, '').trim();
    if (!txt) continue;
    textCount.set(txt, (textCount.get(txt) || 0) + 1);
  }
}

const report = [];
const deletedLog = [];   // 导出所有被删注释原文，供人工复核
let scanned = 0;
let headShrunk = 0;

// ── 规则 1：模块头同构块瘦身 ──
// 32 个模块的头部都是同一段 5 行模板（只差模块名）：
//   /* 模块 algebra/resultant
//    * 来源：由 test/golden/_gen.mjs 从 index.html 里的 <script id="solver-core"> 机械切分。
//    * 约定：本文件是「构建期拼接」的一个区块，内部标识符保持原样（裸名引用保留），
//    *       由构建脚本接到与其它区块的同一作用域。改这个模块只动本文件，不要动 index.html。
//    */
// 压成一行，信息量不减（约定仍在，只是不再重复 4 行）。
// 只在「文件第 1 行就是 /* 模块 … 且第 2~5 行是固定模板」时触发，绝不误伤正文档块。
function slimModuleHead(lines) {
  if (lines[0] === undefined) return lines;
  const m = /^(\s*)\/\* 模块 (\S+)\s*$/.exec(lines[0]);
  if (!m) return lines;
  const indent = m[1];
  const mod = m[2];
  // 模板后续行必须逐行匹配（含缩进变体），否则放弃——宁可少删也不误删
  const pat = [
    /^\s*\* 来源：.*机械切分。\s*$/,
    /^\s*\* 约定：本文件是「构建期拼接」的一个区块.*$/,
    /^\s*\*\s+由构建脚本接到与其它区块的同一作用域。.*$/,
    /^\s*\*\/\s*$/
  ];
  if (lines.length < 5) return lines;
  for (let i = 0; i < pat.length; i++) {
    if (!pat[i].test(lines[1 + i])) return lines;
  }
  headShrunk++;
  return [
    `${indent}/* 模块 ${mod}：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */`,
    ...lines.slice(5)
  ];
}

for (const f of files) {
  if (!fs.existsSync(f)) continue;
  scanned++;
  const src = fs.readFileSync(f, 'utf8');
  const raw = src.split('\n');
  collect(raw);            // 全局重复统计必须先扫全部文件，所以这里只收集不改写
  const before = raw.length;
  const lines = slimModuleHead(raw);
  const headDelta = before - lines.length;
  const kept = [];
  let removed = 0;
  for (const L of lines) {
    const t = L.trim();
    const isCommentLine = t.startsWith('//') && !t.startsWith('///') && !/^https?:\/\//i.test(t);
    if (isCommentLine) {
      const txt = t.replace(/^\/+/, '').trim();
      const empty = txt === '' || txt === '/';
      const decor = DECOR.test(txt);
      const boring = BORING.test(txt);
      // 短注释不做「见长即留」也不做「短即删」——短≠废话。
      // 「辛普森」「梯形校正」「重根」「科学计数法」都是 3-5 字的领域概念标签，
      // 删了读者就得靠猜；真正该删的短注释已经被 BORING / RESTATE 覆盖。
      const dup = (textCount.get(txt) || 0) >= 2;
      // 贴职责：注释只把紧邻代码的语义再念一遍（「计算雅可比矩阵」在 matrix 构造前、
      // 「限制采样点数量」在 Math.min 前）。这类删掉不损失任何信息。
      const restate = txt.length <= 24 && RESTATE.test(txt) && !MATHY.test(txt);
      if ((empty || decor || boring || dup || restate) && !KEEPALL.test(txt)) {
        const why = empty ? 'empty' : decor ? 'decor' : boring ? 'boring' : dup ? 'dup' : 'restate';
        deletedLog.push(path.relative(ROOT, f) + '\t' + why + '\t' + txt);
        removed++;
        continue;
      }
    }
    kept.push(L);
  }
  const total = src.split('\n').length;
  const shrank = total - kept.length;
  report.push({ f: path.relative(ROOT, f), total, keptLines: kept.length, removed: removed + headDelta, rate: total ? Math.round((shrank / total) * 100) + '%' : '-' });
  if (!DRY && kept.length !== total) fs.writeFileSync(f, kept.join('\n'));
}

console.log(DRY ? '【DRY RUN · 只统计不改写】' : '【已改写】');
if (scanned !== files.length) {
  console.error('✗ 覆盖率异常：目标 ' + files.length + ' 个文件，实扫 ' + scanned + ' 个。已中止。');
  process.exit(1);
}
console.log('覆盖文件：' + scanned + ' 个');
console.log('文件'.padEnd(34) + '原行'.padEnd(8) + '新行'.padEnd(8) + '删注释行'.padEnd(10) + '占比');
let tT = 0, tK = 0, tR = 0;
for (const r of report.sort((a, b) => b.removed - a.removed)) {
  if (r.removed === 0) continue;
  tT += r.total; tK += r.keptLines; tR += r.removed;
  console.log(r.f.padEnd(34) + String(r.total).padEnd(8) + String(r.keptLines).padEnd(8) + String(r.removed).padEnd(10) + r.rate);
}
console.log('合计：原 ' + tT + ' 行 → 新 ' + tK + ' 行（删注释行 ' + tR + '，占 ' + (tT ? Math.round((tR / tT) * 100) : 0) + '%）');
console.log('模块头瘦身：' + headShrunk + ' 个文件（每个 5 行 → 1 行）');
if (process.argv.includes('--log')) {
  const out = path.join(ROOT, 'scripts', '_deleted-comments.tsv');
  fs.writeFileSync(out, deletedLog.join('\n') + '\n');
  console.log('被删清单已导出：' + path.relative(ROOT, out) + '（' + deletedLog.length + ' 条）');
}
console.log('提示：改完务必跑 `npm run golden`（20/20）与 `node test/dual-parity.mjs`；注释不影响行为，但保险。');
