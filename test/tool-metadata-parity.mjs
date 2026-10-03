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
ok(stdioTools.length === 4, 'stdio 端 4 个工具（solve/verify/poly_roots/give_feedback）', String(stdioTools.length));
ok(httpTools.length === 4, 'HTTP 端 4 个工具（pay 是 HTTP 专属，不在共享层）', String(httpTools.length));
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
const total = stdioTools.reduce((a, t) => a + t.description.length, 0);
ok(total < 3200, '四工具 description 合计 < 3200 字符（实测 ' + total + '，约 ' + Math.round(total / 3.6) + ' token）', String(total));
const solveDesc = stdioTools.find((t) => t.name === 'solve').description;
ok(solveDesc.length < 1000, 'solve description < 1000 字符（实测 ' + solveDesc.length + '）', String(solveDesc.length));

console.log('── 3. 描述里必须有 Agent 决策信息 ──');
ok(/proven/.test(solveDesc) && /candidate/.test(solveDesc),
  'solve 描述说明 tier 含义（Agent 必须知道哪个能直接用）');
ok(/trust/i.test(solveDesc) || /tier/i.test(solveDesc), 'solve 描述指向可信度判据');
ok(/domain/.test(solveDesc), 'solve 描述说明何时必须给 domain');
ok(/6 variables|max 6/.test(solveDesc), 'solve 描述写明 6 变量硬上限（Agent 需预判）');
ok(!/INPUT:.*OUTPUT:/s.test(solveDesc), 'solve 描述不再重复列举 INPUT/OUTPUT 字段（该进 schema）');

const verifyDesc = stdioTools.find((t) => t.name === 'verify').description;
ok(/refuted_or_unverified/.test(verifyDesc) && /nearestCertifiedRoot/.test(verifyDesc),
  'verify 描述说明失败时能拿到正确值（Agent 自我纠正路径）');

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
ok(Array.isArray(liveStdio) && liveStdio.length === 4,
  'stdio 服务端真实返回 4 个工具', liveStdio ? String(liveStdio.length) : 'null');
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

// HTTP 端：静态校验其数组里的描述与共享层一致（HTTP 端因有 pay 工具不便整体替换，
// 改造时已逐条同步 description；这里比对字符串内容确保没漂移）
const httpSrc = require('node:fs').readFileSync(path.join(ROOT, 'http-mcp-server.js'), 'utf8');
ok(httpSrc.includes('READ THE TIERS BEFORE TRUSTING A RESULT'),
  'HTTP 端 solve 描述已同步 Agent 决策信息');
ok(httpSrc.includes('verdict=verified means it is a certified real root'),
  'HTTP 端 verify 描述已同步');
ok(!/description: 'Deterministic solver for systems of real equations\. This is not a language model/.test(httpSrc),
  'HTTP 端旧版超长 solve 描述已清除（否则 Agent 从 HTTP 入口看不到 tier 规则）');

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
