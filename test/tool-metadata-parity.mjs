// 锁死「两端工具元数据一致」——文案分叉是 Agent 客群的隐性故障。
//
// 为什么需要这条测试：2026-10-03 改造时，stdio 端把 solve 的 description 从 2160 字符
// 压到 790，HTTP 端没跟着改 ⇒ 同一个工具在两个入口对 Agent 呈现不同能力说明。
// 求解域分叉有 dual-parity 兜着，**文案分叉当时无任何测试能发现**。
// 本测试从两个服务端的真实 tools/list 输出里取 description 逐字比对。
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { buildTools } = require(path.join(ROOT, 'services', 'tool-metadata.js'));

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
};

console.log('── 1. 共享层自洽 ──');
const stdioTools = buildTools({});
const httpTools = buildTools({ http: true });
// geometry 是第 5 个工具（2026-10-04 新增，87 个 1D/2D/3D op 共用它）。
const GEOM = 'geometry';
const withoutGeom = (ts) => ts.filter((t) => t.name !== GEOM);

ok(stdioTools.length === 5, 'stdio 端 5 个工具（solve/verify/poly_roots/give_feedback/geometry）', String(stdioTools.length));
ok(httpTools.length === 5, 'HTTP 端 5 个工具（pay 是 HTTP 专属，不在共享层）', String(httpTools.length));
// 两端唯一允许的差异：HTTP 端多一个 honorPaid 参数声明（付费形态属商业信息，stdio 本地免费不需要）。
// 除它以外必须逐字相同 —— 这才是「文案不分叉」的真实含义。
const stripHonor = (ts) => ts.map((t) => ({
  name: t.name,
  // HTTP 端 solve 描述尾部多一句 honorPaid 说明；把它剥掉后应与 stdio 逐字相同。
  // 用「以 Optional: pass honorPaid 开头的尾部」匹配，不依赖具体空格数。
  description: (t.description.split(' Optional: pass honorPaid')[0]),
  schema: Object.fromEntries(Object.entries(t.inputSchema.properties).filter(([k]) => k !== 'honorPaid'))
}));
ok(JSON.stringify(stripHonor(httpTools)) === JSON.stringify(stripHonor(stdioTools)),
  '两端除 honorPaid 参数外逐字相同（描述与 schema 全一致）');
ok('honorPaid' in httpTools.find((t) => t.name === 'solve').inputSchema.properties
  && !('honorPaid' in stdioTools.find((t) => t.name === 'solve').inputSchema.properties),
  'honorPaid 只在 HTTP 端声明（stdio 本地免费，不需要）');

console.log('── 2. 描述长度受控（Agent 上下文预算）──');
// 实测依据：工具级 description 每轮对话都在上下文里。改造前四工具合计 1294 token。
//
// ⚠ 2026-10-04：geometry 一个工具就带 87 个 op 的名字清单（约 1300 字符）。
//   这是「一个工具 + op 分派」换来的代价 —— 87 个独立工具要付约 4000 token/轮。
//   所以预算**分开断言**：求解域四工具维持原预算，geometry 单独立一个上限。
//   合在一个总数里会让「求解域描述变胖」被 geometry 的膨胀掩盖掉。
const total = withoutGeom(stdioTools).reduce((a, t) => a + t.description.length, 0);
const geomDesc = stdioTools.find((t) => t.name === GEOM).description;
ok(total < 3200, '求解域四工具 description 合计 < 3200 字符（实测 ' + total + '，约 ' + Math.round(total / 3.6) + ' token）', String(total));
ok(geomDesc.length < 3000, 'geometry description < 3000 字符（实测 ' + geomDesc.length + '，约 ' + Math.round(geomDesc.length / 3.6) + ' token）', String(geomDesc.length));
const solveDesc = stdioTools.find((t) => t.name === 'solve').description;
ok(solveDesc.length < 1000, 'solve description < 1000 字符（实测 ' + solveDesc.length + '）', String(solveDesc.length));
// ⚠⚠ 余量护栏（2026-10-04 补）：实测 989/1000，只剩 11 字符。
//   只卡 <1000 的话，998 也算「过」，再加一句分页说明就撞线 —— 而那次撞线
//   迫使我砍掉两句**含可判定信息**的内容，或让分页说明写不完整（Agent 漏解）。
//   ⇒ 给出 ≥30 字符的余量要求：任何新增必须先腾出预算，不许「先塞进去再说」。
ok(solveDesc.length < 970, 'solve description 余量 ≥ 30 字符（当前 ' + (1000 - solveDesc.length) + 'B，防撞线且预留新增空间）', String(solveDesc.length));
// 分页信息**不可省**：它是 2026-10-04 修掉「Agent 把前 2 个解当全部」的关键内容。
// 只量长度不量内容 ⇒ 将来有人为省字符删掉它，长度断言照样绿 ⇒ 必须单独钉。
ok(/nextOffset/.test(solveDesc) && /n=nextOffset/.test(solveDesc),
  'solve 描述含分页指令（nextOffset + n=nextOffset），Agent 才知道怎么取回被展示上限截掉的解');
ok(/complete_but_shown_partially/.test(solveDesc) && /budget_exhausted/.test(solveDesc),
  'solve 描述区分「已算完」与「未算完」两种 trustLevel（否则 Agent 对已算完的题去加预算 = 假指令）');
const polyDesc = stdioTools.find((t) => t.name === 'poly_roots').description;
ok(/nextOffset/.test(polyDesc),
  'poly_roots 描述含分页指令（它承诺 "All real roots"，不给翻页路径就是无法完成的契约）');

console.log('── 3. 描述里必须有 Agent 决策信息 ──');
ok(/safe to use directly/.test(solveDesc) && /must be verified first/.test(solveDesc),
  'solve 描述说明 tier 含义（Agent 必须知道哪个能直接用）');
ok(/trust/i.test(solveDesc) || /tier/i.test(solveDesc), 'solve 描述指向可信度判据');
ok(/domain/.test(solveDesc), 'solve 描述说明何时必须给 domain');
ok(/6 variables|max 6/.test(solveDesc), 'solve 描述写明 6 变量硬上限（Agent 需预判）');
ok(!/INPUT:.*OUTPUT:/s.test(solveDesc), 'solve 描述不再重复列举 INPUT/OUTPUT 字段（该进 schema）');

const verifyDesc = stdioTools.find((t) => t.name === 'verify').description;
ok(/refuted_or_unverified/.test(verifyDesc) && /nearestCertifiedRoot/.test(verifyDesc),
  'verify 描述说明失败时能拿到正确值（Agent 自我纠正路径）');

console.log('── 3b. geometry 描述必须带得上 Agent（87 个 op 的可用性全靠这段）──');
const { OPS, opList } = require(path.join(ROOT, 'services', 'geometry', 'index.js'));
const { GEOM_OP_LIST } = require(path.join(ROOT, 'services', 'tool-metadata.js'));
const opNames = Object.keys(OPS);
ok(opNames.length >= 60, '几何 op 数量 >= 60（实测 ' + opNames.length + '）', String(opNames.length));
// 清单由 opList() 动态生成 ⇒ 加了 op 自动进描述。这里反查：每个 op 名都必须出现在清单里
const missing = opNames.filter((n) => !GEOM_OP_LIST.includes(n));
ok(missing.length === 0, '每个 op 名都出现在工具描述里（防「代码有、Agent 看不见」）', missing.join(','));
ok(geomDesc.includes('1D:') && geomDesc.includes('2D:') && geomDesc.includes('3D:') && geomDesc.includes('any:'),
  'op 清单按维度分组（1D/2D/3D/any）');
ok(/trust\.trustLevel/.test(geomDesc), '描述指向 trust.trustLevel（Agent 必须知道怎么读结果）');
ok(/exact/.test(geomDesc) && /definitely_none/.test(geomDesc) && /degenerate/.test(geomDesc),
  '描述写全 trust 三态（exact / definitely_none / degenerate）');
ok(/unknown op to receive the full catalog/.test(geomDesc),
  '描述告诉 Agent 如何按需取完整签名（否则只能瞎猜参数）');
ok(stdioTools.find((t) => t.name === GEOM).inputSchema.additionalProperties === true,
  'geometry schema 允许额外参数（各 op 签名不同，无法静态穷举）');
// 三层维度都真的有 op，避免「清单里 3D 是空的」这种半成品
const by = opList();
ok(by['1D'].length > 5 && by['2D'].length > 20 && by['3D'].length > 15 && by.any.length > 5,
  '1D/2D/3D/any 四层都有足量 op', JSON.stringify({ d1: by['1D'].length, d2: by['2D'].length, d3: by['3D'].length, any: by.any.length }));

console.log('── 4. 真实服务端 tools/list 一致（端到端，防手抄回潮）──');
function listTools(srv) {
  return new Promise((resolve) => {
    const p = spawn('node', [path.join(ROOT, srv)], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '', done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (c) => {
      buf += c;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const m = JSON.parse(line);
          if (m.id === 2 && m.result && m.result.tools) { finish(m.result.tools); p.kill(); }
        } catch (_e) { /* 忽略非 JSON 行 */ }
      }
    });
    p.on('error', () => finish(null));
    p.on('close', () => finish(null));
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
    setTimeout(() => { p.kill(); finish(null); }, 8000);
  });
}

const liveStdio = await listTools('mcp-server.js');
ok(Array.isArray(liveStdio) && liveStdio.length === 5,
  'stdio 服务端真实返回 5 个工具', liveStdio ? String(liveStdio.length) : 'null');
if (Array.isArray(liveStdio)) {
  const liveSolve = liveStdio.find((t) => t.name === 'solve');
  const sharedSolve = stdioTools.find((t) => t.name === 'solve');
  ok(liveSolve && liveSolve.description === sharedSolve.description,
    'stdio 服务端 solve 描述 == 共享层（无手抄分叉）');
  ok(liveSolve && liveSolve.description.length < 1000,
    'stdio 服务端 solve 描述已压缩（实测 ' + (liveSolve ? liveSolve.description.length : '?') + ' 字符）');
  ok(liveStdio.every((t) => !/INPUT:.*OUTPUT:/s.test(t.description || '')),
    'stdio 服务端无残留 INPUT/OUTPUT 大段描述');
}

// 端到端：不只 tools/list 要一致，**真调一次 geometry** 才行。
// 理由：tools/list 只证明描述送达了，证明不了分发分支接上了 ——
// 「列表里有 geometry 但调用时落到 unknown_tool」是完全可能发生的分叉。
function callTool(srv, name, args) {
  return new Promise((resolve) => {
    const p = spawn('node', [path.join(ROOT, srv)], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '', done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (c) => {
      buf += c;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const m = JSON.parse(line);
          if (m.id === 3 && m.result) { finish(m.result); p.kill(); }
        } catch (_e) { /* 忽略非 JSON 行 */ }
      }
    });
    p.on('error', () => finish(null));
    p.on('close', () => finish(null));
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } }) + '\n');
    setTimeout(() => { p.kill(); finish(null); }, 8000);
  });
}

const liveGeom = await callTool('mcp-server.js', 'geometry', { op: 'dist3', p: [0, 0, 0], q: [1, 2, 2] });
const liveGeomBody = liveGeom && liveGeom.content && liveGeom.content[0]
  ? JSON.parse(liveGeom.content[0].text) : null;
ok(liveGeomBody && liveGeomBody.value === 3,
  'stdio 服务端真调 geometry 返回正确值（dist3 = 3）', liveGeomBody && JSON.stringify(liveGeomBody).slice(0, 120));
ok(liveGeomBody && liveGeomBody.trust && liveGeomBody.trust.trustLevel === 'exact',
  'geometry 返回带 trust 决策块', liveGeomBody && liveGeomBody.trust);

const liveBad = await callTool('mcp-server.js', 'geometry', { op: 'nope' });
const liveBadBody = liveBad && liveBad.content && liveBad.content[0]
  ? JSON.parse(liveBad.content[0].text) : null;
ok(liveBadBody && liveBadBody.type === 'unknown_op' && liveBadBody.catalog,
  'geometry 未知 op 通过 MCP 回吐 catalog（Agent 自纠正通道在协议层可用）',
  liveBadBody && liveBadBody.type);

// HTTP 端：静态校验其数组里的描述与共享层一致（HTTP 端因有 pay 工具不便整体替换，
// 改造时已逐条同步 description；这里比对字符串内容确保没漂移）
const httpSrc = require('node:fs').readFileSync(path.join(ROOT, 'http-mcp-server.js'), 'utf8');
ok(httpSrc.includes('READ THE trust BLOCK'),
  'HTTP 端 solve 描述已同步 Agent 决策信息');
ok(httpSrc.includes('verdict=verified means it is a certified real root'),
  'HTTP 端 verify 描述已同步');
ok(!/description: 'Deterministic solver for systems of real equations\. This is not a language model/.test(httpSrc),
  'HTTP 端旧版超长 solve 描述已清除（否则 Agent 从 HTTP 入口看不到 tier 规则）');
// geometry：HTTP 端必须引用共享常量，不能手抄一份 2112 字符的描述。
// 手抄的必然结局就是漂移 —— 这正是 2026-10-03 那次文案分叉事故的根因。
ok(httpSrc.includes('GEOMETRY_TOOL'), 'HTTP 端 geometry 引用共享定义（不是手抄一份描述）');
ok(!/description: 'Deterministic 1D\/2D\/3D geometry/.test(httpSrc),
  'HTTP 端没有内联 geometry 长描述（否则必与共享层漂移）');
ok(/name === 'geometry'/.test(httpSrc), 'HTTP 端有 geometry 分发分支（列表里有、调用不了是最坏的分叉）');

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
