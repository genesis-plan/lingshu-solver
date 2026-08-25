// 真·MCP 客户端回归测试（官方 SDK）——本地 stdio 端点
// 运行（从仓库根目录）：node test/walkthrough-stdio.mjs
// 会拉起 node mcp-server.js 子进程，模拟本地 AI 智能体/桌面客户端接入。
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';

const NODE = process.env.NODE || 'node';
const CWD = path.resolve(__dirname, '..'); // 仓库根（含 mcp-server.js / solver-core.js）
const log = (...a) => console.log(...a);
function assert(c, m) { if (c) log('    ✅', m); else { log('    ❌', m); process.exitCode = 1; } }

const client = new Client({ name: 'walkthrough-agent-stdio', version: '1.0.0' }, { capabilities: {} });
let step = 0;
try {
  step = 1; log('[1] 拉起子进程 node mcp-server.js (stdio)');
  await client.connect(new StdioClientTransport({ command: NODE, args: ['mcp-server.js'], cwd: CWD, env: { ...process.env } }));
  log('    serverInfo:', JSON.stringify(client.getServerVersion()));

  step = 2; log('[2] tools/list');
  const names = (await client.listTools()).tools.map(t => t.name);
  log('    工具:', names.join(', ')); assert(names.includes('solve'), 'solve 可见（stdio）');

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
  log('\n=== B路（本地stdio）真SDK走通 ===');
} catch (e) {
  log(`\n[!] B路第${step}步失败:`, e && e.message ? e.message : e); process.exitCode = 1;
} finally { try { await client.close(); } catch (_) {} }
