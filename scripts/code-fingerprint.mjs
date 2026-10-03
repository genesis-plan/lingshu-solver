// 代码指纹：证明「注释/格式化类改动没有触碰任何一行代码」。
//
// 原理：本工具只删注释行、只改注释文本。那么「剥掉全部注释后的代码」必须逐字节不变。
// 做法：逐字符扫描每行，跟踪单引号/双引号/反引号是否在字符串内，只在字符串外遇到 //
//       时才截断（避免把 URL 'https://' 里的 // 当注释）。再整体剥掉 /* */ 块注释，
//       去空行后取 SHA-256 前 16 位作指纹。
//
// 用法：
//   node scripts/code-fingerprint.mjs            # 生成/覆盖指纹
//   node scripts/code-fingerprint.mjs --check    # 与已有指纹比对，不一致则非零退出
//
// 何时必须跑：任何「删注释 / 格式化 / 压缩代码」的改动之后，作为 golden 之外的第二道闸。
// 注意：它只能证明代码没变，不能证明行为没变 —— 行为仍以 test/golden/diff.mjs 为准。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const FP = path.join(ROOT, 'scripts', 'code-fingerprint.json');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = [
  ...walk(path.join(ROOT, 'src', 'engine')),
  ...walk(path.join(ROOT, 'services')),
  ...['mcp-server.js', 'http-mcp-server.js', 'solver-core.js', 'reconcile-bank.js', 'native-bridge.js']
    .map((f) => path.join(ROOT, f))
];

const MISSING = files.filter((f) => !fs.existsSync(f));
if (MISSING.length) {
  console.error('✗ 目标文件不存在：');
  for (const f of MISSING) console.error('  ' + f);
  process.exit(1);
}

function stripLineComment(line) {
  let sq = false, dq = false, bq = false;
  for (let i = 0; i < line.length - 1; i++) {
    const c = line[i], n = line[i + 1];
    if (c === '\\') { i++; continue; }
    if (c === "'" && !dq && !bq) sq = !sq;
    else if (c === '"' && !sq && !bq) dq = !dq;
    else if (c === '`' && !sq && !dq) bq = !bq;
    else if (c === '/' && n === '/' && !sq && !dq && !bq) return line.slice(0, i);
  }
  return line;
}

const manifest = {};
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const noLine = src.split('\n').map(stripLineComment);
  const noBlock = noLine.join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const code = noBlock.split('\n').map((s) => s.trim()).filter(Boolean).join('\n');
  manifest[path.relative(ROOT, f).split(path.sep).join('/')] = {
    hash: crypto.createHash('sha256').update(code).digest('hex').slice(0, 16),
    lines: code.split('\n').length
  };
}

const totalLines = Object.values(manifest).reduce((a, b) => a + b.lines, 0);

if (CHECK) {
  if (!fs.existsSync(FP)) {
    console.error('✗ 指纹文件不存在，先跑 `node scripts/code-fingerprint.mjs` 生成基线。');
    process.exit(1);
  }
  const base = JSON.parse(fs.readFileSync(FP, 'utf8'));
  const diffs = [];
  for (const k of new Set([...Object.keys(base), ...Object.keys(manifest)])) {
    if (!base[k]) diffs.push('+ 新增文件 ' + k);
    else if (!manifest[k]) diffs.push('- 丢失文件 ' + k);
    else if (base[k].hash !== manifest[k].hash) {
      diffs.push('~ 代码已变 ' + k + '  ' + base[k].hash + ' → ' + manifest[k].hash +
        '（' + base[k].lines + ' → ' + manifest[k].lines + ' 行）');
    }
  }
  if (!diffs.length) {
    console.log('✅ 代码指纹一致：' + Object.keys(manifest).length + ' 个文件 / ' + totalLines + ' 行纯代码未被触碰');
  } else {
    console.log('✗ 代码指纹不一致（' + diffs.length + ' 处）：');
    for (const d of diffs) console.log('  ' + d);
    process.exit(1);
  }
} else {
  fs.writeFileSync(FP, JSON.stringify(manifest, null, 2) + '\n');
  console.log('已写入代码指纹：' + Object.keys(manifest).length + ' 个文件 / ' + totalLines + ' 行纯代码');
  console.log('→ ' + path.relative(ROOT, FP));
  console.log('复核：node scripts/code-fingerprint.mjs --check');
}
