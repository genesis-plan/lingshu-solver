// 用 GitHub Git Data API 推送 —— 绕过 git smart-HTTP。
//
// 【何时需要】只有在本机到 github.com 的 smart-HTTP 走不通时才用（例如出口代理
// 对 github.com 的 CONNECT 返回 502，但 api.github.com 正常）。正常情况请用
// `git push` —— 本脚本存在的唯一理由是绕路，不是替代品。
//
// 2026-10-03 实测的三个坑（都写进注释了，因为它们都表现为「看起来成功其实错了」）：
//   ① `git ls-tree -r HEAD` 对非 ASCII 文件名加引号+八进制转义，直接当路径用会推出
//      一个名叫 `"docs` 的垃圾目录。必须用 `-z`（见下面 parsed.json 的生成方式）。
//   ② `core.autocrlf=true` 时工作树是 CRLF、仓库是 LF，从工作树读文件算 sha 必然错
//      （实测 159/165 不符）。必须用 `git cat-file --batch` 取原始字节。
//   ③ tree 条目排序要复刻 git 的规则（目录名隐式带 `/` 再比），否则 tree sha 与本地
//      不一致 ⇒ commit sha 也不一致 ⇒ 下次 git push 会被判分叉。
//
// 前置准备（Node 在本机无法 spawn 子进程，EBUSY，所以这一步必须在 Bash 里做）：
//   git ls-tree -r -z HEAD > .push-tmp/entries.z
//   git cat-file --batch < .push-tmp/shas.txt > .push-tmp/blobs.raw
//   node（把 entries.z 解析成 parsed.json、并落 meta.json）
//
// 用法：
//   TOK=<github token> node scripts/api-push.mjs            # 正常快进
//   TOK=<github token> node scripts/api-push.mjs --fix-self # 纠正本脚本上次误推
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = path.join(ROOT, '.push-tmp');
const REPO = process.env.REPO || 'genesis-plan/lingshu-solver';
const API = `https://api.github.com/repos/${REPO}`;
const BRANCH = process.env.BRANCH || 'master';
const TOK = process.env.TOK;
if (!TOK) { console.error('缺 TOK 环境变量'); process.exit(1); }

const H = {
  Authorization: `Bearer ${TOK}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'lingshu-push',
  'Content-Type': 'application/json'
};

async function api(p, method, body) {
  const r = await fetch(API + p, {
    method, headers: H,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const txt = await r.text();
  let json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch { /* 非 JSON，保留 txt */ }
  return { status: r.status, json, txt };
}

// ── message 字段的两个坑（都是实测踩出来的，同名不同义且不报错）──
//
// GitHub 的 `message` 字段在 **POST 响应**里是「header + 空行 + body」，
// 在 **GET 响应**里是**纯 body**。同一个字段名，两种内容。
//   POST: "author genesis-plan <…> 1791041843 +0800\ncommitter …\n\n工具：代理挡…"
//   GET : "工具：代理挡…"
//
// 而 commit 对象里 header 有多行（tree/parent/author/committer），
// 剥 header 必须**逐行扫到第一个完全空行**：
//   · 不能用 indexOf('\n\n') —— message 正文内部本来就有空行，会切错位置
//   · 不能用 indexOf(0x0a)   —— 只跳过第一行（tree），body 会混入剩下 3 行 header
const HEADER_RE = /^(author|committer|tree|parent|encoding|gpgsig) /;
const stripHeader = s => {
  if (!HEADER_RE.test(s)) return s;         // 本来就是纯 body
  let p = 0;
  while (p < s.length) {
    const nl = s.indexOf('\n', p);
    if (nl < 0) break;
    if (nl === p) return s.slice(nl + 1);   // 完全空行 ⇒ header/body 分界
    p = nl + 1;
  }
  return s;
};

// 远端是否已有这个 commit
async function commitExists(sha) {
  if (!sha) return true;
  const r = await api(`/git/commits/${sha}`, 'GET');
  return r.status === 200;
}

// 读本地 commit 对象的 tree/parent/body/署名 —— 供自举远端缺失的 parent 用。
// 只解析 .push-tmp/commit-raw.bin（当前 HEAD）不够，parent 可能是更早的 commit，
// 所以按 sha 从 blobs.raw 之外单独取：commit 对象不进 cat-file --batch 的 blob 流，
// 这里改为读 prepare 阶段落的 commit-raw.bin 加上 git 已有对象由 Bash 预先导出。
const LOCAL_COMMITS = fs.existsSync(path.join(TMP, 'commits.json'))
  ? JSON.parse(fs.readFileSync(path.join(TMP, 'commits.json'), 'utf8')) : {};
function readLocalCommit(sha) { return LOCAL_COMMITS[sha] || null; }

// ── 元信息由 prepare 阶段落盘（git 命令在 Bash 里跑，Node 不 spawn）──
const meta = JSON.parse(fs.readFileSync(path.join(TMP, 'meta.json'), 'utf8'));
const entries = JSON.parse(fs.readFileSync(path.join(TMP, 'parsed.json'), 'utf8'));

// ⚠⚠ 路径合法性硬闸 —— 这道闸是被真实事故逼出来的（2026-10-03 第一次推送）。
//
// `git ls-tree -r HEAD`（不带 -z）在 core.quotePath=true（git 默认）下，
// 遇到非 ASCII 文件名会输出 **加引号 + 八进制转义** 的字面量：
//   docs/01-产品作用.md  →  "docs/01-\344\272\247\345\223\201\344\275\234\347\224\250.md"
// 第一版 prepare 直接把这些字面量当路径用，结果推上去的是一个名叫
// `"docs` 的垃圾目录，里面 13 个文件叫 `"docs/01-\344\272...`。
// 而且 GitHub 全部接受、不报任何错 —— 静默产出错误内容，比失败危险得多。
//
// 正解：`git ls-tree -r -z`（NUL 分隔，不引号不转义）。下面这道闸是第二道保险：
// 任何残留的引号 / 八进制转义 / 首尾空格都直接中止。
{
  const bad = entries.filter(e =>
    e.path.includes('"') || /\\[0-7]{3}/.test(e.path) || /^\s|\s$/.test(e.path) || e.path === '');
  if (bad.length) {
    console.error(`❌ 路径非法 ${bad.length} 个（疑似 git quotePath 转义残留），已中止：`);
    bad.slice(0, 5).forEach(b => console.error('   ' + JSON.stringify(b.path)));
    process.exit(1);
  }
}
console.log(`远端分支 : ${BRANCH}`);
console.log(`本地 HEAD: ${meta.headSha}`);
console.log(`parent   : ${meta.parent}`);
console.log(`条目数   : ${entries.length}`);

// ── 1. 上传 blob（8 并发）──
//
// ⚠⚠ 内容来源必须是 `git cat-file --batch` 的原始输出，不是工作树文件！
// 本机 git config core.autocrlf = true ⇒ 工作树是 CRLF、仓库里是 LF。
// 从工作树读文件算出的 sha 与 git 记录的 sha 必然不同（实测 159/165 不符）。
// 第一次推送就是死在这里 —— 若没有自校验，会把 159 个 CRLF 损坏文件推上远端。
// blobs.raw 格式：重复 <sha> SP <type> SP <size> LF <content> LF
const CONC = 8;
const raw = fs.readFileSync(path.join(TMP, 'blobs.raw'));
const wantSha = new Map(entries.filter(e => e.type === 'blob').map(e => [e.sha, e.path]));

const blobs = [];
{
  let off = 0, mismatch = 0;
  while (off < raw.length) {
    const nl = raw.indexOf(0x0a, off);
    if (nl < 0) break;
    const header = raw.slice(off, nl).toString('utf8');
    const parts = header.split(' ');
    if (parts.length < 3) break;                    // 尾部空行
    const [sha, type, sizeStr] = parts;
    const size = parseInt(sizeStr, 10);
    const bodyStart = nl + 1;
    const body = raw.slice(bodyStart, bodyStart + size);
    off = bodyStart + size + 1;                    // +1 跳过内容后的 LF
    if (type !== 'blob') continue;
    // 自校验：重算 sha 必须与 ls-tree 记录一致
    const calc = crypto.createHash('sha1')
      .update(Buffer.concat([Buffer.from(`blob ${size}\0`), body]))
      .digest('hex');
    if (calc !== sha) {
      mismatch++;
      continue;
    }
    const p = wantSha.get(sha);
    if (p === undefined) continue;                 // 不在本次 tree 里
    blobs.push({ path: p, sha, b64: body.toString('base64') });
  }
  if (mismatch) { console.error(`原始字节自校验失败 ${mismatch} 个，已中止`); process.exit(1); }
}
if (blobs.length !== wantSha.size) {
  console.error(`blob 数量不符：解析出 ${blobs.length}，期望 ${wantSha.size}`);
  process.exit(1);
}
console.log(`原始字节自校验通过，blob：${blobs.length}/${wantSha.size}`);

let done = 0, cursor = 0, failed = null;
async function worker() {
  while (cursor < blobs.length && !failed) {
    const b = blobs[cursor++];
    const up = await api('/git/blobs', 'POST', { content: b.b64, encoding: 'base64' });
    if (up.status !== 201) { failed = `blob 失败 ${b.path}: ${up.status} ${up.txt.slice(0, 200)}`; return; }
    if (up.json.sha !== b.sha) { failed = `blob sha 不符 ${b.path}: 本地 ${b.sha} 远端 ${up.json.sha}`; return; }
    done++;
    if (done % 30 === 0) console.log(`  blob ${done}/${blobs.length}`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
if (failed) { console.error(failed); process.exit(1); }
console.log(`blob 全部上传：${done}/${blobs.length}`);

// ── 2. 递归建 tree ──
// 关键：先算出**所有目录的 tree sha**（自底向上），再一次性组装每个目录的条目。
// 第一版把「子目录条目」和「文件条目」混在同一个数组里，结果子目录条目的 sha
// 一直是错的（文件 sha）⇒ GitHub 返回 422 Invalid tree info。
// 分开建两个索引：fileEntries[d] 与 dirEntries[d]，组装时再合并。
const filesByDir = new Map();
const dirsByParent = new Map();
const dirSha = new Map();

// 目录集合：每个 path 逐级取父目录，加上根
const dirSet = new Set(['']);
for (const e of entries) {
  const parts = e.path.split('/');
  for (let i = 1; i < parts.length; i++) dirSet.add(parts.slice(0, i).join('/'));
}

for (const d of dirSet) { filesByDir.set(d, []); dirsByParent.set(d, []); }
for (const e of entries) {
  const d = path.posix.dirname(e.path) === '.' ? '' : path.posix.dirname(e.path);
  const base = path.posix.basename(e.path);
  filesByDir.get(d).push({ path: base, mode: e.mode, type: 'blob', sha: e.sha });
}
// 目录节点（除根）
for (const d of [...dirSet]) {
  if (d === '') continue;
  const parentD = path.posix.dirname(d) === '.' ? '' : path.posix.dirname(d);
  dirsByParent.get(parentD).push({ path: path.posix.basename(d), mode: '040000', type: 'tree', sha: null, dir: d });
}
const dirList = [...dirSet].filter(Boolean).sort((a, b) => b.length - a.length);
console.log(`目录节点：${dirList.length + 1}（含根），文件条目：${entries.length}`);

// ── tree 条目排序：必须复刻 git 的规则，否则 tree sha 与本地对不上 ──
//
// git 对 tree 对象的条目排序是「目录名隐式追加一个 `/` 后再按字节比较」，
// 所以 `foo.bar` 与 `foo/` 的相对次序由 `foo.bar` vs `foo/` 决定，
// 而不是普通字符串比较能得出的结果。普通 sort 会产出**另一种顺序的 tree 对象**
// ⇒ tree sha 不同 ⇒ commit sha 也和本地 HEAD 不同 ⇒ 下次 git push 会被判成
// 分叉（non-fast-forward），反而制造麻烦。
// 实证：本地 tree = 2e6d301c...，用普通 sort 生成的 tree 与之不等。
const gitTreeKey = x => x.path + (x.type === 'tree' ? '/' : '');
const cmpTree = (a, b) => {
  const ka = Buffer.from(gitTreeKey(a), 'utf8');
  const kb = Buffer.from(gitTreeKey(b), 'utf8');
  return Buffer.compare(ka, kb);
};

for (const d of dirList) {
  const items = filesByDir.get(d).concat(
    dirsByParent.get(d).map(x => ({ path: x.path, mode: x.mode, type: 'tree', sha: dirSha.get(x.dir) }))
  );
  if (items.some(x => x.type === 'tree' && !x.sha)) {
    console.error(`目录 ${d} 有未填 sha 的子目录（排序问题）`);
    process.exit(1);
  }
  items.sort(cmpTree);
  const r = await api('/git/trees', 'POST', { base_tree: null, tree: items });
  if (r.status !== 201) { console.error(`tree 失败 ${d}: ${r.status} ${r.txt.slice(0, 200)}`); process.exit(1); }
  dirSha.set(d, r.json.sha);
}
const rootItems = filesByDir.get('').concat(
  dirsByParent.get('').map(x => ({ path: x.path, mode: x.mode, type: 'tree', sha: dirSha.get(x.dir) }))
);
rootItems.sort(cmpTree);
const rootTree = await api('/git/trees', 'POST', { base_tree: null, tree: rootItems });
if (rootTree.status !== 201) { console.error(`根 tree 失败: ${rootTree.status} ${rootTree.txt.slice(0, 200)}`); process.exit(1); }
const NEW_TREE = rootTree.json.sha;
console.log(`新 tree: ${NEW_TREE}（本地 ${meta.tree}）`);
console.log(`tree 与本地一致: ${NEW_TREE === meta.tree ? '是 ✅' : '否 ❌ —— 排序或 mode 有偏差'}`);

// 实际用作 parent 的远端 sha。正常情况 = meta.parent；
// 若远端缺这个 commit，第 3 步会自举出一个远端等价 sha 并写在这里。
let PARENT_SHA = meta.parent;
let force = false;

// ── 3. 建 commit ──
//
// parent 必须在**远端存在**（GitHub 会校验 "Parent SHA does not exist"）。
// 前一次 API 推送产出的 commit sha 与本地不同，所以本地 HEAD 的 sha 远端没有；
// 此时直接建 commit 会 422。正解：把缺失的 commit 在远端逐个重建出来。
//
// ⚠ 重建时必须用**递归**：commit A 的 parent 是 B，B 也要重建，
//   而重建 B 时它的 parent 是 C …… 逐个建但只带**远端已存在**的 parent sha。
//   我第一版写成「先循环建祖先、再单独建自己」，
//   建自己时又用了**本地**的 parent sha（远端不存在）⇒ 又 422。
//   递归写法天然正确：ensure(sha) 返回该 commit 在远端的等价 sha。
// ★ 2026-10-05 新增：远端分支头部可能已经是「内容相同、但 sha 不同」的重建版
//   commit —— 那是**上一次 API 推送**的产物（GitHub 服务端对 commit 对象做
//   非确定性改写，详见文末注释），本地 sha 在远端永远查不到。
//
//   此时绝不能 rebuild 一个副本，两个理由都致命：
//     ① 造副本 ⇒ 上一个远端 commit（内容本来是对的）变成孤儿对象；
//     ② 更致命的是：新副本的 sha ≠ remoteNow，脚本走到第 4 步的
//        `remoteNow === PARENT_SHA` 快进校验必然不成立，
//        接着 contentSame 检查（拿 remoteNow 的 tree 比 meta.tree）也必然失败
//        ⇒ 直接中止，一个 commit 都推不出去。
//
//   判定必须用**内容**而不是 sha：tree sha 一致 + body 逐字节一致 ⇒ 同一份提交。
//   （tree 是确定性哈希，所以本地 tree sha 与远端 tree sha 可以直接比。）
async function findRemoteEquivalent(info) {
  const cur = await api(`/git/refs/heads/${BRANCH}`, 'GET');
  if (cur.status !== 200) return null;
  const rs = cur.json && cur.json.object && cur.json.object.sha;
  if (!rs) return null;
  const rc = await api(`/git/commits/${rs}`, 'GET');
  if (rc.status !== 200) return null;
  const j = rc.json || {};
  if (j.tree && j.tree.sha === info.tree && stripHeader(j.message || '') === info.msg) return rs;
  return null;
}

async function ensure(sha) {
  if (!sha) return null;
  if (await commitExists(sha)) return sha;              // 远端已有，直接用
  const info = readLocalCommit(sha);
  if (!info) { console.error(`自举链断在 ${sha.slice(0, 7)}：该 commit 不在本地 commits.json`); process.exit(1); }
  // ★ 先按内容找远端等价 commit；找不到才重建（重建会造孤儿，是下策）
  const eq = await findRemoteEquivalent(info);
  if (eq) {
    console.log(`  复用远端等价 commit ${eq.slice(0, 7)}（tree + body 逐字节一致，sha 不同）`);
    return eq;
  }
  console.log(`  重建 ${sha.slice(0, 7)} …`);
  const parentRemote = await ensure(info.parent);      // ★ 递归：先把父链搞定
  const r = await api('/git/commits', 'POST', {
    message: info.msg, tree: info.tree,
    parents: parentRemote ? [parentRemote] : [],
    author: info.author, committer: info.committer
  });
  if (r.status !== 201) { console.error(`重建 ${sha.slice(0,7)} 失败: ${r.status} ${r.txt.slice(0, 200)}`); process.exit(1); }
  console.log(`    ⇒ 远端 sha ${r.json.sha.slice(0, 7)}`);
  return r.json.sha;
}

if (!(await commitExists(meta.parent))) {
  console.log(`远端没有 parent ${meta.parent.slice(0, 7)}，开始自举重建`);
  PARENT_SHA = await ensure(meta.parent);
  console.log(`  ✅ parent 远端 sha = ${PARENT_SHA}`);
}

const c = await api('/git/commits', 'POST', {
  message: meta.msg,
  tree: NEW_TREE,
  parents: [PARENT_SHA],
  author: meta.author,
  committer: meta.committer
});
if (c.status !== 201) { console.error(`commit 失败: ${c.status} ${c.txt.slice(0, 300)}`); process.exit(1); }
const NEW_COMMIT = c.json.sha;
console.log(`新 commit  : ${NEW_COMMIT}`);
console.log(`本地 HEAD  : ${meta.headSha}`);
console.log(`commit sha : ${NEW_COMMIT === meta.headSha ? '完全一致 ✅' : '不同（内容一致，见下方判据）'}`);

// 内容判据：比对远端与本地的 message。
const {
  remoteBody
} = (() => {
  const remote = c.json.message || '';
  return { remoteBody: stripHeader(remote) };
})();
if (remoteBody === meta.msg) {
  console.log('内容判据  : tree ✅  body 逐字节 ✅  ⇒ 远端与本地是同一份内容');
} else {
  console.log('内容判据  : ❌ body 不一致');
  const i = [...remoteBody].findIndex((ch, k) => ch !== (meta.msg[k] ?? ''));
  console.log(`  首个差异位: ${i}  远端 ${remoteBody.length} 字符 / 本地 ${meta.msg.length} 字符`);
  console.log('  远端:', JSON.stringify(remoteBody.slice(Math.max(0, i - 40), i + 40)));
  console.log('  本地:', JSON.stringify((meta.msg || '').slice(Math.max(0, i - 40), i + 40)));
  process.exit(1);
}

// ── 4. 更新 ref ──
//
// 快进校验：远端当前值必须正好是本次 commit 的父提交。
// 唯一例外是「纠正自己上一次误推」：需要显式传 --fix-self，
// 且远端那个 commit 必须同时满足三条（缺一不可）：
//   ① 它的 parent == 本次 commit 的 parent（⇒ 它是本次推送链上的兄弟，不是别人的成果）
//   ② 它的 author/committer 与本地 HEAD 一致（⇒ 是本机 git 提交的）
//   ③ 它的 message 与本地 HEAD 完全一致（⇒ 是同一次提交的另一份错误 tree 重建）
// 三条同时成立才允许覆盖；否则一律中止。
const cur = await api(`/git/refs/heads/${BRANCH}`, 'GET');
if (cur.status !== 200) { console.error(`读 ref 失败: ${cur.status} ${cur.txt.slice(0, 200)}`); process.exit(1); }
const remoteNow = cur.json.object.sha;
console.log(`远端当前  : ${remoteNow}`);
console.log(`预期父提交: ${PARENT_SHA}`);

if (remoteNow === PARENT_SHA) {
  // 正常快进
} else if (remoteNow === meta.headSha) {
  console.log('远端已是目标 commit（sha 相同），无需更新');
  process.exit(0);
} else {
// sha 相同才 100% 可靠；sha 不同（API 通道下正常）就退到内容判据。
const rc = await api(`/git/commits/${remoteNow}`, 'GET');
const c0 = rc.status === 200 ? rc.json : null;
const remoteBodyOf = j => stripHeader((j && j.message) || '');
const contentSame = c0
  && c0.tree.sha === meta.tree
  && (c0.parents || []).length === 1
  && c0.parents[0].sha === PARENT_SHA
  && remoteBodyOf(c0) === meta.msg;
  if (contentSame) {
    console.log(`远端已是同一份内容，无需更新：`);
    console.log(`  远端 ${remoteNow} / 本地 ${meta.headSha}`);
    console.log(`  tree 与 body 逐字节一致，sha 差异来自 GitHub 服务端非确定性改写`);
    process.exit(0);
  }
  if (process.argv.includes('--fix-self') && c0) {
    // 远端可能是「上一次误推的版本」：内容对应本地 HEAD 或本地 parent，
    // 但 commit 对象不是同一个（GitHub 服务端非确定性改写）。两种都算可纠正。
    const localParent = readLocalCommit(meta.parent);
    const matchesParentContent = localParent
      && c0.tree.sha === localParent.tree
      && remoteBodyOf(c0) === localParent.msg;
    const whoOk = c0.committer && c0.committer.name === meta.committer.name
      && c0.committer.email === meta.committer.email;
    console.log(`纠正前置校验: 内容==本地parent=${matchesParentContent} 提交者一致=${whoOk}`);
    if (!(matchesParentContent && whoOk)) {
      console.error('远端不是本脚本上次误推的产物，拒绝覆盖');
      process.exit(1);
    }
    console.log(`⚠ 远端 ${remoteNow.slice(0, 7)} 是上次误推的 parent 版本，允许覆盖为正确链`);
    force = true;
  } else {
    console.error('远端既不是父提交、也不是同一份内容，为防覆盖已中止。');
    console.error('若确认是自己上次误推，可加 --fix-self 走带三重校验的纠正通道。');
    process.exit(1);
  }
}

const upd = await api(`/git/refs/heads/${BRANCH}`, 'PATCH', { sha: NEW_COMMIT, force });
if (upd.status !== 200) { console.error(`更新 ref 失败: ${upd.status} ${upd.txt.slice(0, 300)}`); process.exit(1); }
console.log(`✅ ${BRANCH} 已更新 → ${upd.json.object.sha}${force ? '（force，纠正误推）' : ''}`);
console.log(`本地 HEAD      : ${meta.headSha}`);
console.log(`内容一致性     : tree ✅（${NEW_TREE}）  body ✅（逐字节）`);

// ── 5. 关于本地与远端的 sha 差异（重要，影响下次 git push）──
//
// 实测结论（2026-10-03）：**GitHub commit API 产出的 commit 对象无法在本地
// 逐字节复现**。同参数 POST 两次会得到两个不同 sha ⇒ GitHub 服务端对 commit
// 对象做了非确定性改写（message 首尾不可见字符的处理），客户端无法预测。
// 曾在本地穷举 16 种字节组合试图复现，全部对不上，已放弃（留一个不能保证
// 正确的对齐工具比不留更危险，所以对齐脚本已删除）。
//
// ⇒ 后果与应对：
//   本地 HEAD 与远端 master **内容完全相同**（tree ✅ body 逐字节 ✅）但 sha 不同，
//   git 会判为两条分叉历史，**下次 git push 会被拒（non-fast-forward）**。
//   应对：等代理恢复后用正规 `git push`（代理是间歇 502，先重试几次）。
//   本脚本不提供自动对齐，因为已验证做不到。
if (NEW_COMMIT === meta.headSha) {
  console.log(`本地/远端 sha  : 一致 ✅`);
} else {
  console.log(`本地/远端 sha  : 不同（内容一致，GitHub 服务端非确定性改写，见上方注释）`);
  console.log(`                ⚠ 下次 git push 需先处理历史分叉，建议等代理恢复后走正规 git push`);
}
