// 生成 6 变量线性对测的【单一题面事实来源】linear_cases.json
//
// 为什么要有这个文件（修的是真缺陷，不是为了好看）：
//   原先 bench_linear_sympy.py 用 Python random.seed(20261003)，
//   bench_linear_lingshu.mjs 用手写 LCG(20261003) —— 两者序列完全不同。
//   也就是说 sparse-rand6 这一题【两侧根本不是同一道题】，对测结论无效。
//   （实测抓到：JS 侧那组 rank(A)=5 < rank([A|b])=6 ⇒ 不相容无解；
//     而 SymPy 侧拿到的是另一组满秩可解的题并给出了解 —— 双方都没错，是题不同。）
//   ⇒ 题面必须外置成共享 JSON，两侧只读不造。
//
// 编码约定：每个系数是「数字」或「字符串 p/q」。
//   数字 → 整数（精确）；字符串 → 有理数（精确，不走 float，避免 1/3 变 0.333… 丢精度）。
//   两侧各自按本语言的有理数类型解析，但解析的是同一个字符串，数学上严格同题。
import fs from 'fs';
import { performance } from 'perf_hooks';

const C = [];

// ① 稀疏带状 6×6（Markowitz 最优序可命中 ⇒ 应零 fill-in）
const A1 = [];
for (let i = 0; i < 6; i++) {
    const r = new Array(6).fill(0);
    r[i] = 4 + i;
    if (i + 1 < 6) r[i + 1] = -1;
    if (i > 0) r[i - 1] = -1;
    A1.push(r);
}
C.push({ name: 'banded6', kind: 'sparse-banded', A: A1, b: [1, 1, 1, 1, 1, 1] });

// ② 下三角 6×6（presolve singletonRow 应全消）
const L = [[2, 0, 0, 0, 0, 0], [1, 3, 0, 0, 0, 0], [2, -1, 4, 0, 0, 0],
[0, 1, 2, 5, 0, 0], [0, 0, 1, -1, 6, 0], [0, 0, 0, 1, 2, 7]];
const x0 = [1, 2, 3, 4, 5, 6];
C.push({ name: 'triangular6', kind: 'triangular', A: L, b: L.map(r => r.reduce((s, a, j) => s + a * x0[j], 0)) });

// ③ 稠密整数 6×6
const A3 = [[3, -1, 2, 0, 1, -2], [1, 4, 0, 2, -1, 1], [2, 0, -3, 1, 2, 0],
[0, 1, 1, 5, -2, 1], [1, -1, 0, 2, 3, 1], [2, 1, 1, 0, -1, 4]];
C.push({ name: 'dense-int6', kind: 'dense-int', A: A3, b: [5, 6, 7, 8, 9, 10] });

// ④ 过定不相容 8×6（在 A3 上复制两行、改 rhs 制造矛盾）
C.push({
    name: 'overdet-incon6', kind: 'overdet-inconsistent',
    A: [...A3, A3[0].slice(), A3[1].slice()], b: [5, 6, 7, 8, 9, 10, 99, 98]
});

// ⑤ 循环对角占优 6×6（⇒ 唯一解，diagDominant 可提前定论）
const A5 = [];
for (let i = 0; i < 6; i++) { const r = new Array(6).fill(-1); r[i] = 12; A5.push(r); }
C.push({ name: 'cyc-dom6', kind: 'diag-dominant', A: A5, b: [1, 1, 1, 1, 1, 1] });

// ⑥ 稀疏随机 6×6（原手写 LCG 那一组；题面既然被独立核过是【不相容无解】，
//    就把它当无解用例留下 —— 正好测 fail-closed，不是浪费）
let s = 20261003;
const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const A6 = [];
for (let i = 0; i < 6; i++) {
    const r = new Array(6).fill(0);
    for (let j = 0; j < 6; j++) r[j] = rnd() < 0.45 ? Math.floor(rnd() * 17 - 8) : 0;
    if (r.every(v => v === 0)) r[i] = 5;
    A6.push(r);
}
const b6 = []; for (let i = 0; i < 6; i++) b6.push(Math.floor(rnd() * 41 - 20));
C.push({ name: 'sparse-rand6-incon', kind: 'sparse-rand-inconsistent', A: A6, b: b6 });

// ⑥b 稀疏随机【满秩可解】对照组（同分布但已核过相容）——
//     没有对照组的话，⑥ 一题无法区分「正确判无解」与「一律报无解」
const A6b = [[3, 0, 2, 0, -1, 0], [0, 4, 0, 1, 0, 2], [-2, 0, 5, 0, 0, 1],
[0, -1, 0, 6, 2, 0], [1, 0, 0, 0, 3, -1], [0, 2, 1, 0, 0, 7]];
C.push({ name: 'sparse-rand6-solvable', kind: 'sparse-rand-solvable', A: A6b, b: [7, -3, 11, 5, -2, 9] });

// ⑦ 对角阵（⇒ singletonRow 全消，零消元）
const A7 = []; for (let i = 0; i < 6; i++) { const r = new Array(6).fill(0); r[i] = 10; A7.push(r); }
C.push({ name: 'diagonal6', kind: 'diagonal', A: A7, b: [1, 1, 1, 1, 1, 1] });

// ⑧ 有理系数 6×6（用字符串保精确：1/3 不能先变 float 再喂给 SymPy）
C.push({
    name: 'rational6', kind: 'rational',
    A: [['1/3', '1/7', 0, 0, 0, 0], [0, '2/3', '1/5', 0, 0, 0], [0, 0, '3/7', '1/3', 0, 0],
    [0, 0, 0, '4/9', '1/5', 0], [0, 0, 0, 0, '5/3', '1/7'], ['1/5', 0, 0, 0, 0, '6/11']],
    b: [1, 1, 1, 1, 1, 1]
});

// ⑨ 欠定 4×6（4 方程 6 未知 ⇒ 解集 2 维仿射簇）
C.push({
    name: 'underdet6', kind: 'underdetermined',
    A: [[1, 2, 0, 0, 0, 0], [0, 1, 3, 0, 0, 0], [0, 0, 1, 4, 0, 0], [0, 0, 0, 1, 5, 0]],
    b: [1, 2, 3, 4]
});

// ⑩ 重复行 + 单例行混合（presolve 应大量命中）
C.push({
    name: 'presolve-heavy6', kind: 'presolve-heavy',
    A: [[1, 0, 0, 0, 0, 0], [0, 2, 0, 0, 0, 0], [0, 0, 3, 0, 0, 0],
    [1, 0, 0, 0, 0, 0], [2, 4, 0, 0, 0, 0], [0, 0, 0, 7, 1, 1]],
    b: [2, 4, 6, 2, 12, 5]
});

// ⑪ 病态大系数（条件数极大 ⇒ 检验是走精确有理还是会被 float 吃掉）
C.push({
    name: 'illcond-bigcoef', kind: 'ill-conditioned-big-coef',
    A: [[1, 1e7, 0, 0, 0, 0], [0, 1, 1e7, 0, 0, 0], [0, 0, 1, 1e7, 0, 0],
    [0, 0, 0, 1, 1e7, 0], [0, 0, 0, 0, 1, 1e7], [1e7, 0, 0, 0, 0, 1]],
    b: [1, 1, 1, 1, 1, 1]
});

const out = { generator: 'make_linear_cases.mjs', n: C.length, cases: C };
fs.writeFileSync('D:/Projects/genesis-plan/lingshu-solver/test/benchmarks/linear_cases.json', JSON.stringify(out, null, 1));
console.log('已写 linear_cases.json：' + C.length + ' 题');
console.log(C.map(c => '  · ' + c.name).join('\n'));
