'use strict';
const { spawn } = require('child_process');
const path = require('path');

const server = spawn('node', [path.resolve(__dirname, 'mcp-server.js')], {
  cwd: __dirname, stdio: ['pipe', 'pipe', 'inherit']
});

let buf = Buffer.alloc(0);
const SEP = Buffer.from('\r\n\r\n');
const responses = [];

function send(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.from('Content-Length: ' + body.length + '\r\n\r\n', 'utf8');
  server.stdin.write(Buffer.concat([header, body]));
}

function pump() {
  let i;
  while ((i = buf.indexOf(SEP)) !== -1) {
    const header = buf.slice(0, i).toString('utf8');
    const m = /Content-Length:\s*(\d+)/i.exec(header);
    if (!m) { buf = buf.slice(i + 4); continue; }
    const len = +m[1];
    const start = i + 4;
    if (buf.length < start + len) return;
    const raw = buf.slice(start, start + len).toString('utf8');
    buf = buf.slice(start + len);
    try {
      const msg = JSON.parse(raw);
      if (msg && msg.jsonrpc === '2.0') responses.push(msg);
    } catch (_e) {}
  }
}

server.stdout.on('data', (c) => { buf = Buffer.concat([buf, c]); pump(); });

function finish(ok, note) {
  console.log('\n=== 冒烟测试结论 ===');
  console.log('收到响应数:', responses.length);
  const tools = responses.find(r => r.tools);
  console.log('tools/list 工具名:', tools ? tools.tools.map(t => t.name) : '(无)');
  const call = responses.find(r => r.content);
  if (call) {
    const txt = call.content[0] && call.content[0].type === 'text' ? call.content[0].text : '';
    const parsed = JSON.parse(txt);
    console.log('tools/call(solve) resultType:', parsed.resultType, '| #sol:', parsed.solutionCount, '| truncated:', parsed.truncated);
  }
  console.log(ok ? 'PASS ✅' : 'FAIL ❌', note || '');
  server.kill();
  process.exit(ok ? 0 : 1);
}

// 发送三帧
setTimeout(() => {
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
}, 100);
setTimeout(() => {
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
}, 300);
setTimeout(() => {
  send({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'solve', arguments: { equations: ['x^2 = 4'], variables: ['x'], decimals: 6 } }
  });
}, 500);
setTimeout(() => {
  const ok = responses.length >= 3 &&
    responses.some(r => r.tools && r.tools.length === 2) &&
    responses.some(r => r.content && JSON.parse(r.content[0].text).resultType === 2);
  finish(ok, ok ? '' : '响应不完整或结果不符预期');
}, 1500);
