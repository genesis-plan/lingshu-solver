// 引擎模块静态审计器（生产级体检）
//
// 目的：不是拍脑袋说「代码有点乱」，而是把能机器判定的问题全量扫出来，带行/计数做实据：
//   1. 模块体量（行数 / 函数数 / 注释率）—— 找过大过小、注释缺失
//   2. 顶层函数重复定义 —— 同名词在多个区块里定义 = 命名冲突或死代码
//   3. 死代码 —— 定义之外零引用（注意：算子函数会作为值传给 _op，那也算引用，会被算进来）
//   4. 隐式全局 —— 原引擎「无声明直接赋值」的全局，ESM 严格模式必须先 var；
//                   这里再扫一遍还有没有漏网的（之前已经修出 __LS_MSNEWTON_DONE 一个）
//   5. console 调用、空 catch（吞异常）、TODO/FIXME/HACK —— 生产级红线
// 用法: node scripts/audit.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = path.join(ROOT, 'src/engine');

function walk(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) out.push(...walk(p, r));
    else if (e.name.endsWith('.js')) out.push(r.replace(/\.js$/, ''));
  }
  return out;
}

const mods = walk(ENGINE);
const blockSrc = new Map(mods.map((m) => [m, fs.readFileSync(path.join(ENGINE, m + '.js'), 'utf8')]));
const body = mods.map((m) => blockSrc.get(m)).join('\n');

// —— 1. 模块体量 ——
const fileStats = mods.map((m) => {
  const src = blockSrc.get(m);
  const L = src.split('\n');
  const fn = (L.filter((l) => /^(?:async\s+)?function\s+/.test(l)).length);
  const cm = L.filter((l) => /^\s*(\/\/|\/\*|\*)/.test(l)).length;
  return { mod: m, 行: L.length, 函数: fn, 注释行: cm, 注释率: L.length ? Math.round((cm / L.length) * 100) + '%' : '-' };
}).sort((a, b) => b.行 - a.行);

// —— 2/3. 函数定义与死代码 ——
const decls = {};                                    // name -> 定义处区块列表
const where = {};
for (const m of mods) {
  for (const [, n] of blockSrc.get(m).matchAll(/^(?:async\s+)?function\s+([\w$]+)/gm)) {
    decls[n] = (decls[n] || 0) + 1;
    (where[n] = where[n] || []).push(m);
  }
}
const dupDefs = Object.entries(decls).filter(([, c]) => c > 1);
// UI 层的函数（如 openAgreement/copyText）在 HTML 里是靠 onclick="函数名()" 引用的，
// 在 src/engine 里零引用属于「字符串引用」误判，必须把 index.html 全文纳入候选再判死。
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const dead = [];
for (const [n, c] of Object.entries(decls)) {
  const total = (body.match(new RegExp('\\b' + n + '\\b', 'g')) || []).length;
  if (total - c === 0 && !html.includes(n)) dead.push(n);
}

// —— 4. 隐式全局 ——
const IMPLICIT = new Set(['_solveRecursionCount', '__LS_ROOT_START', '__LS_SOLVE_ACTIVE', '__LS_BRANCH_BUDGET', '__LS_MSNEWTON_DONE', 'branchBudget', '_varsTouched']);
// 全文中「任何位置」用 var/let/const/function 声明过的名字（不限行首）——
// 必须这么宽，否则 `  var a = 1` 这种缩进的局部变量会被误报成「隐式全局」（第一版就 flood 了 160 个）
const declared = new Set([...Object.keys(decls)]);
for (const m of mods) for (const [, n] of blockSrc.get(m).matchAll(/\b(?:var|let|const|function)\s+([\w$]+)/g)) declared.add(n);
const implicitGlobals = new Set();
for (const line of body.split('\n')) {
  const m = /^\s*([A-Za-z_$][\w$]*)\s*=[^=]/.exec(line);
  // 候选必须是：行首裸赋值（隐式全局的写法） + 全文从没声明过它 + 不在已知清单
  if (m && !declared.has(m[1]) && !IMPLICIT.has(m[1])) implicitGlobals.add(m[1]);
}

// —— 5. 生产级红线 ——
const redlines = {
  console调用: (body.match(/console\.(log|warn|error|info|debug)/g) || []).length,
  空catch吞异常: (body.match(/catch\s*\([^)]*\)\s*\{\s*\}/g) || []).length,
  TODO_FIXME_HACK: (body.match(/\b(TODO|FIXME|XXX|HACK)\b/g) || []).length,
};

// 输出
const pad = (s, n) => String(s).padEnd(n, ' ');
console.log('══ 引擎模块静态审计（源：src/engine，' + mods.length + ' 模块 / ' + body.split('\n').length + ' 行）══\n');
console.log(pad('模块', 26) + pad('行数', 7) + pad('函数', 6) + pad('注释行', 7) + '注释率');
for (const s of fileStats) console.log(pad(s.mod, 26) + pad(s.行, 7) + pad(s.函数, 6) + pad(s.注释行, 7) + s.注释率);

console.log('\n── 生产级红线 ──');
for (const [k, v] of Object.entries(redlines)) console.log(pad(k, 22) + v + (v ? '  ⚠️' : '  ✅'));

console.log('\n── 顶层函数重复定义 (' + dupDefs.length + ') ──');
dupDefs.forEach(([n, c]) => console.log(pad(n, 30) + '×' + c + '  定义于: ' + where[n].join(', ')));

console.log('\n── 疑似死代码（定义外零引用）(' + dead.length + ') ──');
console.log(dead.length ? dead.slice(0, 40).join(', ') + (dead.length > 40 ? ' ...(+' + (dead.length - 40) + ')' : '') : '无');

console.log('\n── 隐式全局（漏网）(' + implicitGlobals.size + ') ──');
console.log(implicitGlobals.size ? [...implicitGlobals].join(', ') : '无（7 个已知已声明）');

fs.writeFileSync(path.join(ROOT, 'scripts', 'audit-result.json'), JSON.stringify({
  fileStats, redlines, dupDefs, dead, implicitGlobals: [...implicitGlobals],
  totalLines: body.split('\n').length, totalFns: Object.keys(decls).length,
}, null, 1));
console.log('\n明细 → scripts/audit-result.json');
