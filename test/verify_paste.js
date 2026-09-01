// 永久回归：豆包/通义粘贴（Unicode 符号 + 打竖换行）与变量自动识别
// 驱动真实核心（solver-core 加载 Desktop/灵数求解器/index.html），不依赖网页 DOM。
const { solve } = require('../solver-core');

let pass = 0, fail = 0;
function check(name, eqs, expect, dom) {
  try {
    const r = solve(eqs, [], 6, dom || undefined);
    const got = (r.solutions || []).map(s => (r.varNames || []).map((v, i) => `${v}=${Number(s.values[i]).toFixed(4)}`).join(','));
    const ok = expect(got, r);
    console.log(`${ok ? '✅' : '❌'} ${name}: vars=[${(r.varNames||[]).join(',')}] sols=${JSON.stringify(got)}`);
    if (ok) pass++; else fail++;
  } catch (e) {
    console.log(`❌ ${name}: ERROR ${e.message}`);
    fail++;
  }
}

// 1. log2 此前被错误线性化为 log(2)*x → 错解 3.32；现应 =2
check('log2(对数方程)', ['log2(x-1)+log2(x+2)=2'], (g) => g.length === 1 && g[0] === 'x=2.0000');
// 2. 豆包 U+2212 减号（核心路径此前未归一化 → 0 解）
check('U+2212 减号', ['4(x−2)+3=2x+7'], (g) => g.length === 1 && g[0] === 'x=6.0000');
// 3. 豆包打竖（换行打断隐式乘法，核心路径去换行后）
check('打竖换行(单串)', ['4\n(\nx\n−\n2\n)\n+\n3\n=\n2\nx\n+\n7'], (g) => g.length === 1 && g[0] === 'x=6.0000');
// 4. U+00B7 中点乘
check('U+00B7 乘号', ['2·x=6'], (g) => g.length === 1 && g[0] === 'x=3.0000');
// 5. 变量自动识别：A,b,c（非 X,Y）
check('A,b,c 自动识别', ['3A+2b=12', '2A-b=1'], (g, r) =>
  (r.varNames || []).join('') === 'Ab' && g.length === 1 && g[0] === 'A=2.0000,b=3.0000');
// 6. 变量自动识别：单字母 a
check('a 自动识别', ['a^2-4=0'], (g, r) => (r.varNames || []).join('') === 'a' && g.length === 2);
// 7. 变量自动识别：多字符 theta（限域 [0,2π]；默认全域 ±1e6 对周期方程会穷举 ~63 万根，属重负载非缺陷）
//    注：theta 会被归一化为希腊符号 θ（正确行为），变量名与域键均随之映射
check('theta 自动识别', ['sin(theta)=0.5'], (g, r) => (r.varNames || []).join('') === 'θ' && g.length === 2, { theta: [0, Math.PI * 2] });

console.log(`\n结果: PASS=${pass} FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
