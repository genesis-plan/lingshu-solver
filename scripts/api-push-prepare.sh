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
# ⚠⚠ 为什么不能用 `git log --format=%B` 当 message 来源（第一版就是那么写的，错了）：
# commit 对象是 `header\n\nbody`，但 header 可能有**多个续行块**（gpgsig / encoding /
# mergetag…），续行以空格开头。第一版用「第一个空行」切分，结果切出的 body 里
# 混进了后续 header 的一部分：本地 commit body 实为 3927 字节，%B 只有 3811 字节，
# 差 116 字节。用 %B 重建的 commit sha 与本地不一致（57d89a5 → a453eaf）——
# 内容「看起来等价」，但下次 git push 会被判成两条历史分叉。
# 正解：零加工，直接读 cat-file 的原始字节。
git cat-file commit HEAD > .push-tmp/commit-raw.bin
#
# 标量字段仍用 git log（它对这些字段的加工是可预测的），但输出**总是带尾换行**，
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
  printf '  "msg": %s\n' "$(node -e '
const fs=require("fs");
const raw=fs.readFileSync(".push-tmp/commit-raw.bin");
// header 续行以空格开头，不可能是空行 ⇒「第一个完全空行」就是 header/body 的正确分界。
const sep=raw.indexOf(0x0a)+1;
const blank=raw.indexOf(0x0a,sep)+1;
process.stdout.write(JSON.stringify(raw.slice(blank).toString("utf8")));
')"
  echo "}"
} > .push-tmp/meta.json

# 硬闸：字段残留换行 ⇒ GitHub 422；message 必须与 commit 对象 body 逐字节相等
node -e '
const fs = require("fs");
const m = require("./.push-tmp/meta.json");
const fields = [["author.name", m.author.name], ["author.email", m.author.email],
  ["author.date", m.author.date], ["committer.name", m.committer.name],
  ["committer.email", m.committer.email], ["committer.date", m.committer.date]];
const bad = fields.filter(([, v]) => /[\r\n]/.test(v));
if (bad.length) { console.error("字段含换行: " + bad.map(x => x[0]).join(", ")); process.exit(1); }
const raw = fs.readFileSync(".push-tmp/commit-raw.bin");
const sep = raw.indexOf(0x0a) + 1, blank = raw.indexOf(0x0a, sep) + 1;
const body = raw.slice(blank);
const msgB = Buffer.from(m.msg, "utf8");
const ok = msgB.equals(body);
console.log("msg 字节  :", msgB.length, " commit body 字节:", body.length, ok ? "✅ 逐字节相等" : "❌ 不等");
if (!ok) process.exit(1);
console.log("headSha =", m.headSha);
console.log("author  =", JSON.stringify(m.author));
'
echo "准备完成：$(wc -c < .push-tmp/blobs.raw) 字节原始内容"
echo "下一步：export TOK=<token> && node scripts/api-push.mjs"
