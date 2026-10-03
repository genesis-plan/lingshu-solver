// 灵数 solver-core 段内取码器（只读，不修改）
// 用法: node peek-core.mjs <起始行> <结束行>
import fs from 'fs';
const html = fs.readFileSync('D:/Projects/genesis-plan/lingshu-solver/index.html', 'utf8');
const m = html.match(/<script id="solver-core">([\s\S]*?)<\/script>/);
if (!m) { console.error('未找到 solver-core 段'); process.exit(1); }
const startOffset = html.indexOf(m[0]) + '<script id="solver-core">'.length;
const segStartLine = html.slice(0, startOffset).split('\n').length; // 段首在原文件中的行号
const lines = m[1].split('\n');
const a = parseInt(process.argv[2] || '1', 10);
const b = parseInt(process.argv[3] || String(a + 60), 10);
for (let i = a; i <= b && i <= lines.length; i++) {
  console.log(String(i).padStart(6) + '| ' + lines[i - 1]);
}
console.error('—— 段内共 ' + lines.length + ' 行；段首位于原文件第 ' + segStartLine + ' 行');
