// 从~/.git-credentials 取 GitHub token，**不回显**。
//
// 为什么需要这个文件：本机凭据文件是 UTF-16LE 编码的（BOM + 宽字符），
// 直接 grep 抓会拿到带 NUL 的乱码；且在 Bash 单行里写带反斜杠的正则
// 会被 shell 吃掉转义（实测 2026-10-05踩过一次，脚本直接语法错）。
//
// 唯一输出：token 写到.push-tmp/tok.txt（权限尽力收紧），stdout 只报长度。
import fs from 'fs';
import path from 'path';
import os from 'os';

const home = os.homedir();
const cred = path.join(home, '.git-credentials');

let t = fs.readFileSync(cred, 'utf8');
// UTF-16LE 判定：开头有 BOM，或第 2 个字符就是 NUL
if (t.charCodeAt(0) === 0xfeff || t.charCodeAt(1) === 0) {
  t = Buffer.from(t.replace(/^﻿/, ''), 'utf16le').toString('utf16le');
}
const m = t.match(/https:\/\/[^:@/]+:([^@\s]+)@github\.com/);
if (!m) {
  console.error('❌ 凭据里没找到 github.com 条目');
  process.exit(1);
}
const tok = m[1];
if (!/^gh[pousr]_[A-Za-z0-9]{20,}$/.test(tok)) {
  console.error('❌ token 形态不像 GitHub PAT（ghp_/gho_/ghu_/ghs_/ghr_ 前缀 + 20+ 字符）');
  process.exit(1);
}
const out = path.resolve(process.cwd(), '.push-tmp', 'tok.txt');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, tok);
console.log('✅ token 已取到，长度 ' + tok.length + ' 前缀 ' + tok.slice(0, 4) + '****');