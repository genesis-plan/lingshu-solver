// suan56：欠定系统「最近解」的流形投影法（KKT 阻尼牛顿）
// 锁定三件事：① 数学正确（KKT 解）② 宽域不退化 ③ fail-closed（残差门槛）
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const core = require('D:/Projects/genesis-plan/lingshu-solver/solver-core.js');
const sb = core.raw();

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  OK   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  → ' + detail : '')); }
}
function res(r) { return (r.solutions || [])[0]; }
function norm(s) { return s ? Math.sqrt(s.values.reduce((a, b) => a + b * b, 0)) : NaN; }

console.log('【① KKT 投影法直接验证（独立于端到端接线）】');
{
  const eqs = ['x*y*z - 6', 'x + y + z - 6'].map(e => sb.parse(sb.tokenize(e)));
  const vns = ['x', 'y', 'z'];
  const dom = { x: { min: -1e6, max: 1e6 }, y: { min: -1e6, max: 1e6 }, z: { min: -1e6, max: 1e6 } };

  // 从真解附近出发 ⇒ 0 步即达标
  const r0 = sb._suan56Project(eqs, vns, [1, 2, 3], dom, { maxIter: 60 });
  check('从真解出发 ok=true', r0 && r0.ok === true);
  check('从真解出发残差为 0', r0 && r0.residual < 1e-12, r0 ? String(r0.residual) : 'null');

  // 从远处出发 ⇒ 牛顿应收敛到真解
  const r1 = sb._suan56Project(eqs, vns, [1000, 0.001, 6], dom, { maxIter: 60 });
  check('从远处出发收敛', r1 && r1.ok === true, r1 ? ('res=' + r1.residual) : 'null');
  if (r1 && r1.ok) {
    const v = r1.values;
    // 独立验算：残差必须真的为 0
    const vm = { x: v[0], y: v[1], z: v[2] };
    const e1 = Math.abs(sb.evalAST(eqs[0], vm));
    const e2 = Math.abs(sb.evalAST(eqs[1], vm));
    check('返回值独立验算残差 < 1e-9', e1 < 1e-9 && e2 < 1e-9, 'e1=' + e1 + ' e2=' + e2);
    // 范数应接近理论最近解 3.70（(2.5321, 0.9358, 2.5321) 之类）
    const n = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    check('‖x‖ 落在 3.69~3.75（真最近解附近）', n > 3.69 && n < 3.75, '‖x‖=' + n.toFixed(4));
  }

  // 不可行起点 ⇒ 明确失败（不假装收敛）
  const r2 = sb._suan56Project(eqs, vns, [0, 0, 0], dom, { maxIter: 60 });
  check('从 (0,0,0) 出发如实失败（该点残差 -6 不可行）', r2 === null || r2.ok === false);

  // 非欠定（m >= n）⇒ 不适用
  const r3 = sb._suan56Project(eqs, ['x', 'y'], [1, 2], { x: dom.x, y: dom.y }, { maxIter: 60 });
  check('非欠定（2 方程 2 变量）返回 null', r3 === null);

  // 变量数不匹配 ⇒ 不抛错
  let threw = false;
  try { sb._suan56Project(eqs, ['x', 'y'], [1, 2, 3], dom, { maxIter: 60 }); } catch (e) { threw = true; }
  check('起点维数不匹配时不抛错', !threw);
}

console.log('');
console.log('【② 端到端：宽域不得退化（这正是 suan56 要修的缺陷）】');
{
  // 修前：默认域 ±1e6 下输出 [-250000, 0, 250006]，‖x‖=353557，却标「距原点最近」
  const r = core.solve(['x*y*z = 6', 'x + y + z = 6'], ['x', 'y', 'z'], 6);
  const s = res(r);
  check('默认域下有解', !!s);
  if (s) {
    const n = norm(s);
    check('默认域下 ‖x‖ < 10（修前是 353557）', n < 10, '‖x‖=' + n.toFixed(2));
    check('残差 < 1e-9（是解）', s.residual < 1e-9, 'res=' + s.residual.toExponential(2));
    // ── 2026-10-03 新增：两个曾经的静默失败点 ──
    // 症状都是「看起来跑了、其实没跑」，不写断言就会静默回潮。
    check('不再报 HARD_TIMEOUT（投影抢救已接线）', r.error !== 'HARD_TIMEOUT', String(r.error));
    // ⚠⚠ 2026-10-04 断言改向：原断言是 `r.truncated === false`，理由写的是
    //   「拿到了真解就不是『没算完』」。**这个推理是错的**，本轮实测推翻：
    //
    //   投影法只证明「至少存在一个解」—— 那是**存在性**，不是**完备性**。
    //   它只在主求解失败后才跑，主求解为何失败（超时/未收敛/预算耗尽）并不可知。
    //   把 truncated 清掉 = 对外宣称「这就是全部解」，而 Agent 客群靠这个字段
    //   判断能否收工。x*y*z=6 & x+y+z=6 是**正维流形**（无穷多解），
    //   报「结果完整」在语义上根本不成立。
    //
    //   与域门控、displayCapped 门控同源一条纪律：**存在性 ≠ 完备性，
    //   宁可 unknown / truncated，绝不谎称找全**（比慢严重得多）。
    check('truncated 保持 true（只证存在性，未证完备性）', r.truncated === true, String(r.truncated));
    check('不再报「8 秒预算被中止」（欠定路径没进主求解，该文案是误报）',
      String(r.message || '').indexOf('8 秒') < 0, String(r.message));
    check('warnings 不含误报的「8 秒预算被中止」',
      !(r.warnings || []).some(w => String(w).indexOf('8 秒') >= 0), JSON.stringify(r.warnings));
    check('执行路径标记为投影抢救', String(r.executionPath || '').indexOf('投影') >= 0, String(r.executionPath));
    // 独立验算：投影自报的 residual 不可信，必须回代原方程
    const vm = { x: s.values[0], y: s.values[1], z: s.values[2] };
    const e1 = Math.abs(sb.evalAST(sb.parse(sb.tokenize('x*y*z - 6')), vm));
    const e2 = Math.abs(sb.evalAST(sb.parse(sb.tokenize('x + y + z - 6')), vm));
    check('投影解经原方程独立回代 < 1e-9', e1 < 1e-9 && e2 < 1e-9, 'e1=' + e1 + ' e2=' + e2);
    // 理论最近解 (2.5321, 0.9358, 2.5321)，‖x‖≈3.7012
    check('‖x‖ 落在 3.69~3.71（理论最近解 3.7012）', n > 3.69 && n < 3.71, '‖x‖=' + n.toFixed(4));
  }
}

console.log('');
console.log('【②b 回归：欠定线性「推荐解」必须是最近的（2026-10-03 修）】');
{
  // 真缺陷：suan60 沿零空间采样 196 个点，按采样顺序输出，却在 resultTypeName 里
  // 声称给的是「推荐解」。数学上最近的 (1.5, 1.5, 3)（‖x‖=3.6742）**确实在列表里**，
  // 但排在第 127 位；输出首位是 (3, 0, 3)（‖x‖=4.2426）。
  const r = core.solve(['x + y + z = 6', 'x + y - z = 0'], ['x', 'y', 'z'], 6);
  const all = r.solutions || [];
  const s = res(r);
  check('欠定线性有解', !!s);
  if (s && all.length) {
    const n0 = norm(s);
    check('首位即最近解 ‖x‖≈3.6742（修前首位是 4.2426）', n0 > 3.67 && n0 < 3.68, '‖x‖=' + n0.toFixed(4));
    // 不变式：首位范数 == 全集最小范数（不是「碰巧小」，是「就是最小」）
    let minN = Infinity;
    for (const x of all) minN = Math.min(minN, norm(x));
    check('首位范数 == 全集最小范数（最近解不是碰运气采到的）', Math.abs(minN - n0) < 1e-6,
      '首位=' + n0.toFixed(4) + ' 全集min=' + minN.toFixed(4));
    const vm = { x: s.values[0], y: s.values[1], z: s.values[2] };
    const e1 = Math.abs(sb.evalAST(sb.parse(sb.tokenize('x + y + z - 6')), vm));
    const e2 = Math.abs(sb.evalAST(sb.parse(sb.tokenize('x + y - z')), vm));
    check('最近解经原方程独立回代 < 1e-9', e1 < 1e-9 && e2 < 1e-9, 'e1=' + e1 + ' e2=' + e2);
  }
}

console.log('');
console.log('【③ fail-closed：投影必须过残差门槛】');
{
  // 构造一个残差无法压到 1e-9 的情形：x*y*z = 6 但域限制在 z=0 附近
  const r = core.solve(['x*y*z = 6', 'x + y + z = 6'], ['x', 'y', 'z'], 6,
    { x: [0.5, 3], y: [0.5, 3], z: [1e-9, 1e-8] });
  const s = res(r);
  if (s) {
    check('域内无解时不得给出假解（残差须达标）', s.residual < 1e-6, 'res=' + s.residual.toExponential(2));
    check('域内无解时解必须落在给定域内',
      s.values[2] >= 1e-9 - 1e-9 && s.values[2] <= 1e-8 + 1e-9,
      'z=' + s.values[2]);
  } else {
    check('域内无解时给空（诚实）', true);
  }
  // 投影抢救的三重闸之一：域外解必须被拒。
  // z 被限死在 1e-9~1e-8（真解需 z≈2.53），投影若不查域就会给出域外的 x,y。
  check('投影不得给出越域解（fail-closed 第③闸）',
    !s || s.values.every((v, i) => {
      const box = [[0.5, 3], [0.5, 3], [1e-9, 1e-8]][i];
      return v >= box[0] - 1e-6 && v <= box[1] + 1e-6;
    }), s ? JSON.stringify(s.values) : 'null');
}

console.log('');
console.log('【④ 零行为变更：线性欠定仍走伪逆闭式解（suan56 不介入）】');
{
  const r = core.solve(['x + y = 3'], ['x', 'y'], 6);
  const s = res(r);
  check('线性欠定 x+y=3 → (1.5,1.5)', s && Math.abs(s.values[0] - 1.5) < 1e-6 && Math.abs(s.values[1] - 1.5) < 1e-6,
    s ? JSON.stringify(s.values) : 'null');
  check('线性欠定不标 suan56Projection（走伪逆）', !r.suan56Projection);

  const r2 = core.solve(['x + y + z = 6', 'x + y - z = 0'], ['x', 'y', 'z'], 6);
  const s2 = res(r2);
  check('线性三元欠定 → (1.5,1.5,3)', s2 && Math.abs(s2.values[0] - 1.5) < 1e-6 && Math.abs(s2.values[2] - 3) < 1e-6,
    s2 ? JSON.stringify(s2.values) : 'null');
}

console.log('');
console.log('【⑤ 性能护栏：不得因多起点而变慢到不可用】');
{
  const t0 = performance.now();
  const r = core.solve(['x*y*z = 6', 'x + y + z = 6'], ['x', 'y', 'z'], 6);
  const ms = performance.now() - t0;
  check('三元正维 < 400ms（修前 962ms）', ms < 400, ms.toFixed(0) + 'ms');
}

console.log('');
console.log('通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail > 0 ? 1 : 0);
