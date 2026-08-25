// 真·MCP 客户端回归测试（官方 SDK）——远程 HTTP 端点
// 运行：先在别处起 http-mcp-server.js（PORT=3000），或用 MCP_URL 指向运行中的端点
//   node test/walkthrough-http.mjs
//   MCP_URL=http://127.0.0.1:3000/mcp node test/walkthrough-http.mjs
// 注意：必须用真实 @modelcontextprotocol/sdk 客户端跑通，不能只看 HTTP 200。
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const BASE_URL = process.env.MCP_URL || 'http://159.75.154.206:3000/mcp';
const log = (...a) => console.log(...a);
function assert(c, m) { if (c) log('    ✅', m); else { log('    ❌', m); process.exitCode = 1; } }

const client = new Client({ name: 'walkthrough-agent-http', version: '1.0.0' }, { capabilities: {} });
let step = 0;
try {
  step = 1;
  log(`[${step}] connect → initialize + 握手 (${BASE_URL})`);
  await client.connect(new StreamableHTTPClientTransport(new URL(BASE_URL)));
  log('    serverInfo:', JSON.stringify(client.getServerVersion()));

  step = 2; log(`[${step}] tools/list`);
  const tools = await client.listTools();
  const names = (tools.tools || []).map(t => t.name);
  log('    工具:', names.join(', '));
  assert(names.includes('solve'), 'solve 可见'); assert(names.includes('give_feedback'), 'give_feedback 可见');

  step = 3; log(`[${step}] tools/call solve`);
  const r = await client.callTool({ name: 'solve', arguments: { equations: ['x^2 + y^2 = 25', 'x + y = 7'] } });
  assert(r.isError !== true, 'solve 正常返回');
  const parsed = JSON.parse((r.content[0] || {}).text || '{}');
  assert(parsed.resultTypeName === 'finite', 'finite'); assert(parsed.solutionCount >= 1, `解数=${parsed.solutionCount}`);

  step = 4; log(`[${step}] 确定性复测（同输入3次字节比对）`);
  const run = async () => JSON.stringify((await client.callTool({ name: 'solve', arguments: { equations: ['x^2 + y^2 = 25', 'x + y = 7'] } })).content);
  const a = await run(), b = await run(), c = await run();
  assert(a === b && b === c, '字节级一致（确定性）');

  step = 5; log(`[${step}] 错误路径（isError）`);
  const bad = await client.callTool({ name: 'solve', arguments: { equations: [] } });
  assert(bad.isError === true, '空方程 → isError=true（LLM 可读）');

  step = 6; log(`[${step}] give_feedback`);
  const fb = await client.callTool({ name: 'give_feedback', arguments: { message: '真SDK回归测试' } });
  assert(fb.isError !== true, 'give_feedback 成功');
  log('\n=== A路（远程HTTP）真SDK走通 ===');
} catch (e) {
  log(`\n[!] A路第${step}步失败:`, e && e.message ? e.message : e); process.exitCode = 1;
} finally { try { await client.close(); } catch (_) {} }
