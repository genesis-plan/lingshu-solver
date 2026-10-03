#!/usr/bin/env bash
# api-push 的前置准备：把推送所需的元信息与原始字节落盘到 .push-tmp/。
#
# 为什么要单独一个 Bash 脚本：本机 node 进程 spawn 子进程全部返回 EBUSY
# （cmd.exe 与 git.exe 都不行，2026-10-03 实测），所以所有 git 调用必须在
# Bash 里跑，Node 只做纯网络 IO。
#
# 用法：
#   bash scripts/api-push-prepare.sh
#   export TOK=<github token>
#   node scripts/api-push.mjs
#
# 产物（全部在 .push-tmp/，已被 .gitignore 忽略）：
#   entries.z   git ls-tree -r -z HEAD 的原始输出（NUL 分隔）
#   parsed.json  解析后的条目数组（mode/type/sha/path），含路径合法性硬闸
#   shas.txt    本次 tree 里所有 blob 的 sha，一行一个
#   blobs.raw   git cat-file --batch 的原始输出（含对象头，Node 按 size 切分）
#   meta.json   HEAD/parent/tree/message/author/committer
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .push-tmp

# ── 1. 条目表 ──
# ⚠ 必须用 -z。不带 -z 时 git 在 core.quotePath=true（默认）下会把非 ASCII
# 文件名输出成加引号 + 八进制转义的字面量，例如
#   docs/01-产品作用.md → "docs/01-\344\272\247\345\223\201\344\275\234\347\224\250.md"
# 直接拿这些字面量当路径用，会推出一个名叫 `"docs` 的垃圾目录，
# 而且 GitHub 不会报错 —— 静默产出错误内容。-z 是 NUL 分隔，不引号不转义。
git ls-tree -r -z HEAD > .push-tmp/entries.z

node -e '
const fs = require("fs");
const parts = fs.readFileSync(".push-tmp/entries.z").toString("utf8").split("\0").filter(Boolean);
const out = [];
for (const line of parts) {
  const tab = line.indexOf("\t");
  if (tab < 0) throw new Error("条目无 tab 分隔: " + JSON.stringify(line));
  const meta = line.slice(0, tab).split(" ");
  out.push({ mode: meta[0], type: meta[1], sha: meta[2], path: line.slice(tab + 1) });
}
// 第二道保险：即便用了 -z，也拒绝任何像转义残留的路径
const bad = out.filter(e =>
  e.path.includes("\"") || /\\[0-7]{3}/.test(e.path) || /^\s|\s$/.test(e.path) || e.path === "");
if (bad.length) {
  console.error("非法路径 " + bad.length + " 个:");
  bad.slice(0, 5).forEach(b => console.error("  " + JSON.stringify(b.path)));
  process.exit(1);
}
fs.writeFileSync(".push-tmp/parsed.json", JSON.stringify(out));
const blobs = out.filter(e => e.type === "blob");
fs.writeFileSync(".push-tmp/shas.txt", blobs.map(b => b.sha).join("\n") + "\n");
console.log("条目 " + out.length + "，blob " + blobs.length);
'

# ── 2. 原始字节 ──
# ⚠ 必须走 git cat-file，不能从工作树读文件。本机 core.autocrlf=true，
# 工作树是 CRLF、仓库里是 LF，从工作树算出的 sha 有 159/165 与记录不符。
git cat-file --batch < .push-tmp/shas.txt > .push-tmp/blobs.raw

# ── 3. 提交元信息 ──
# 落一份 commit 对象原始字节。message 直接从它切，**不走 git log**。
#
# ⚠⚠ message 切分必须**逐行扫到完全空行**（2026-10-03 的真正根因，之前一直在错位）：
#
#   commit 对象的结构是：<header 行>\n<header 行>\n\n<body>
#   本仓库的 commit header 有 **4 行**（tree / parent / author / committer）。
#   第一版用 `raw.indexOf(0x0a)+1` 找 body 起点 —— 那只跳过**第一行**（tree 行），
#   于是 body 里混进了 parent/author/committer 三行（116 字节）。
#   症状极具迷惑性：
#     · message 末尾 60 字符**看起来完全一样**（因为多出来的 header 在开头）
#     · 但长度差 116 ⇒ commit sha 完全不同
#     · 反复调换行、加减字节都修不好，因为根因在**开头**不在结尾
#   ⇒ 只要 message 里混进 header，GitHub 会把它当正文存下来，
#     远端 commit 就多出 116 字节，本地永远对不上。
#
#   正解：从头逐行走，遇到**第一个完全空行**才是 header/body 分界。
#   （message 正文内部也有空行，所以不能用 indexOf('\n\n')，必须逐行判断。）
git cat-file commit HEAD > .push-tmp/commit-raw.bin
#
# ⚠⚠ message 必须**去掉末尾那个换行**再提交给 API，这是 sha 对不上的最后一道原因
#   （2026-10-03 实测踩了 3 小时才定位）：
#   git 存进 commit 对象的 message 是 `…exit=0。\n`（结尾有 \n），
#   而 GitHub 的 commit API 会把传入 message 的**尾部换行剥掉**再存。
#   ⇒ 内容完全一致（人读一模一样），但对象差 1 字节 ⇒ sha 完全不同。
#   实测：本地 0dcb70d（body 1539B）⇒ 远端 8798dfb（body 1538B），
#   手工按 1538 字节重算 header+body，sha 精确等于远端 8798dfb，确认就是这一个字节。
#   去掉尾换行后，API 重建的 commit 与本地**逐字节相同** ⇒ sha 相同 ⇒
#   本地与远端是同一条历史，下次 git push 不会被判分叉。
#
# 标量字段仍用 git log（对这些字段的加工可预测），但输出**总是带尾换行**，
# 必须 trimEnd 全裁 —— 否则 GitHub 报「name can't contain a newline character」（422）。
J() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.stringify(s.trimEnd())))'; }
{
  echo "{"
  printf '  "headSha": "%s",\n' "$(git rev-parse HEAD)"
  printf '  "parent": "%s",\n' "$(git rev-parse HEAD^)"
  printf '  "tree": "%s",\n' "$(git rev-parse 'HEAD^{tree}')"
  printf '  "author": { "name": %s, "email": %s, "date": %s },\n' \
    "$(git log -1 --format=%an | J)" "$(git log -1 --format=%ae | J)" "$(git log -1 --format=%aI | J)"
  printf '  "committer": { "name": %s, "email": %s, "date": %s },\n' \
    "$(git log -1 --format=%cn | J)" "$(git log -1 --format=%ce | J)" "$(git log -1 --format=%cI | J)"
  printf '  "msg": %s,\n' "$(node -e '
const fs=require("fs");
const raw=fs.readFileSync(".push-tmp/commit-raw.bin");
// ★ 逐行扫，遇到第一个「完全空行」才是 header/body 分界。
//   不能用 indexOf(0x0a)（只跳过 tree 一行 ⇒ body 混入 3 行 header）
//   也不能用 indexOf("\n\n")（正文内部也有空行）
let p=0,he=-1;
while(p<raw.length){const nl=raw.indexOf(0x0a,p);if(nl<0)break;if(nl===p){he=p;break;}p=nl+1;}
if(he<0) throw new Error("commit 对象里找不到 header/body 分界空行");
let body=raw.slice(he+1).toString("utf8");
// ⚠ 去掉尾部换行 —— GitHub commit API 会自己剥掉它。
if(body.endsWith("\n")) body=body.slice(0,-1);
// ★ 硬自检：body 绝不能以 header 关键字开头
for(const pre of ["author ","committer ","tree "]){
  if(body.startsWith(pre)) throw new Error("body 混入 commit header（以 "+JSON.stringify(pre)+" 开头）");
}
process.stdout.write(JSON.stringify(body));
')"
  printf '  "msgBytes": %s\n' "$(node -e '
const fs=require("fs");
const raw=fs.readFileSync(".push-tmp/commit-raw.bin");
let p=0,he=-1;
while(p<raw.length){const nl=raw.indexOf(0x0a,p);if(nl<0)break;if(nl===p){he=p;break;}p=nl+1;}
process.stdout.write(String(raw.length-(he+1)));
')"
  echo "}"
} > .push-tmp/meta.json

# 硬闸：字段残留换行 ⇒ GitHub 422；message 必须是纯 body（不含 header）且已剥尾换行
node -e '
const fs = require("fs");
const m = require("./.push-tmp/meta.json");
const fields = [["author.name", m.author.name], ["author.email", m.author.email],
  ["author.date", m.author.date], ["committer.name", m.committer.name],
  ["committer.email", m.committer.email], ["committer.date", m.committer.date]];
const bad = fields.filter(([, v]) => /[\r\n]/.test(v));
if (bad.length) { console.error("字段含换行: " + bad.map(x => x[0]).join(", ")); process.exit(1); }
for (const pre of ["author ", "committer ", "tree "]) {
  if (m.msg.startsWith(pre)) { console.error("❌ msg 混进了 commit header：" + JSON.stringify(pre)); process.exit(1); }
}
const raw = fs.readFileSync(".push-tmp/commit-raw.bin");
let p = 0, he = -1;
while (p < raw.length) { const nl = raw.indexOf(0x0a, p); if (nl < 0) break; if (nl === p) { he = p; break; } p = nl + 1; }
const full = raw.slice(he + 1).toString("utf8");
const expected = full.endsWith("\n") ? full.slice(0, -1) : full;
const ok = m.msg === expected;
console.log("本地 body 字节:", Buffer.byteLength(full, "utf8"),
  "→ 提交 msg 字节:", Buffer.byteLength(m.msg, "utf8"),
  ok ? "✅ 与剥尾换行后的纯 body 一致" : "❌ 不一致");
if (!ok) process.exit(1);
console.log("msg 开头 40 字:", JSON.stringify(m.msg.slice(0, 40)));
console.log("headSha =", m.headSha);
console.log("author  =", JSON.stringify(m.author));
'
echo "准备完成：$(wc -c < .push-tmp/blobs.raw) 字节原始内容"
echo "下一步：export TOK=<token> && node scripts/api-push.mjs"
