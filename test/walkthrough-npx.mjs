// 真·MCP 客户端回归测试（官方 SDK）——通过 npx 拉取「已发布的」lingshu-solver 包
// 模拟用户照 Glama/Smithery 页面上的 `npx -y lingshu-solver` 命令接入
// 运行：node test/walkthrough-npx.mjs   （首次会从 npm 下载包，耐心等）
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORK = path.resolve(__dirname, '..');
const log = (...a) => console.log(...a);
function assert(c, m) { if (c) log('    ✅', m); else { log('    ❌', m); process.exitCode = 1; } }

const client = new Client({ name: 'walkthrough-agent-npx', version: '1.0.0' }, { capabilities: {} });
let step = 0;
try {
  step = 1; log('[1] npx -y lingshu-solver（拉取已发布包，stdio）');
  // 用托管 node 的 npx；PATH 必须含托管 node 才能在子进程里解析 node
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['-y', 'lingshu-solver'],
    cwd: WORK,
    env: { ...process.env, PATH: process.env.PATH }
  });
  await client.connect(transport);
  log('    serverInfo:', JSON.stringify(client.getServerVersion()));

  step = 2; log('[2] tools/list');
  const names = (await client.listTools()).tools.map(t => t.name);
  log('    工具:', names.join(', ')); assert(names.includes('solve'), 'solve 可见（npx 发布包）');

  step = 3; log('[3] tools/call solve（含 sin/cos 超越函数）');
  const r = await client.callTool({ name: 'solve', arguments: { equations: ['sin(x) = 0.5', 'cos(y) = 0'], variables: ['x', 'y'] } });
  assert(r.isError !== true, 'sin/cos 方程组正常返回');
  const parsed = JSON.parse((r.content[0] || {}).text || '{}');
  assert(typeof parsed.solutionCount === 'number', `解数=${parsed.solutionCount}`);

  step = 4; log('[4] 确定性复测（同输入3次）');
  const run = async () => JSON.stringify((await client.callTool({ name: 'solve', arguments: { equations: ['x^2 + y^2 = 25', 'x + y = 7'] } })).content);
  const a = await run(), b = await run(), c = await run();
  assert(a === b && b === c, '字节级一致（确定性）');

  step = 5; log('[5] 错误路径（isError）');
  const bad = await client.callTool({ name: 'solve', arguments: { equations: Array(7).fill('x=1'), variables: ['v1','v2','v3','v4','v5','v6','v7'] } });
  assert(bad.isError === true, '变量>6 → isError=true');
  log('\n=== npx 发布包真SDK走通 ===');
} catch (e) {
  log(`\n[!] npx 第${step}步失败:`, e && e.message ? e.message : e); process.exitCode = 1;
} finally { try { await client.close(); } catch (_) {} }
