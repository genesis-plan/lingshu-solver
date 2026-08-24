'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const server = spawn('node', [path.resolve(__dirname, 'mcp-server.js')], {
  cwd: __dirname, stdio: ['pipe', 'pipe', 'inherit']
});
let buf = Buffer.alloc(0);
const SEP = Buffer.from('\r\n\r\n');
const responses = [];
function send(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  server.stdin.write(Buffer.concat([Buffer.from('Content-Length: ' + body.length + '\r\n\r\n', 'utf8'), body]));
}
function pump() {
  let i;
  while ((i = buf.indexOf(SEP)) !== -1) {
    const header = buf.slice(0, i).toString('utf8');
    const m = /Content-Length:\s*(\d+)/i.exec(header);
    if (!m) { buf = buf.slice(i + 4); continue; }
    const len = +m[1], start = i + 4;
    if (buf.length < start + len) return;
    const raw = buf.slice(start, start + len).toString('utf8');
    buf = buf.slice(start + len);
    try { const msg = JSON.parse(raw); if (msg && msg.jsonrpc === '2.0') responses.push(msg); } catch (_e) {}
  }
}
server.stdout.on('data', (c) => { buf = Buffer.concat([buf, c]); pump(); });

function finish() {
  const fb = responses.find(r => r.content && r.content[0] && r.content[0].text && r.content[0].text.includes('反馈已记录'));
  const err = responses.find(r => r.isError);
  let errOk = false, noStack = true;
  if (err) {
    const txt = err.content[0].text;
    const parsed = JSON.parse(txt);
    errOk = parsed.error && parsed.error.type === 'invalid_input';
    if (txt.includes('at ') || txt.includes('\\n')) noStack = false;
  }
  const fbLog = fs.existsSync(path.resolve(__dirname, 'feedback.log')) ? fs.readFileSync(path.resolve(__dirname, 'feedback.log'), 'utf8') : '';
  console.log('give_feedback 响应:', fb ? 'OK ✅' : 'FAIL ❌');
  console.log('feedback.log 已写入:', fbLog.includes('冒烟反馈') ? 'OK ✅' : '(空/无)');
  console.log('错误结构化(isError + error.type):', errOk ? 'OK ✅' : 'FAIL ❌');
  console.log('错误未泄露堆栈:', noStack ? 'OK ✅' : 'FAIL ❌');
  server.kill();
  process.exit((fb && errOk && noStack) ? 0 : 1);
}
setTimeout(() => send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'give_feedback', arguments: { message: '冒烟反馈：x^2=4 期望2解', context: 'test' } } }), 100);
setTimeout(() => send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'solve', arguments: { equations: [] } } }), 300);
setTimeout(() => finish(), 1200);
