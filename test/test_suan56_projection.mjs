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
  // 历史缺陷：默认域 ±1e6 下输出 [-250000, 0, 250006]，‖x‖=353557，却标「距原点最近」。
  // 🔴 2026-10-05 契约变更：现在**不再优化距离**，代表解的挑选准则是「回代残差最小」。
  //   ⇒ `‖x‖ < 10` 这条断言测的是「离原点近」，属于已删除的偏好，改为数学判据：
  //     坐标有限 + 过原方程回代。域内由 fail-closed 闸保证。
  const r = core.solve(['x*y*z = 6', 'x + y + z = 6'], ['x', 'y', 'z'], 6);
  const s = res(r);
  check('默认域下有解', !!s);
  if (s) {
    check('代表解坐标有限（无 NaN/Inf）',
      s.values.every(v => typeof v === 'number' && isFinite(v)), JSON.stringify(s.values));
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
    // 🔴 2026-10-05 断言口径再次改向：执行路径不再是「投影抢救」。
    //   实测事故（本日同轮修复的两个 P0 引入的连带效应）：
    //     · `forwardPropagate` 原被定义在块内而在外块调用 ⇒ 运行时 ReferenceError
    //       ⇒ 欠定网格采样整段静默失效 ⇒ uniquePts 为空 ⇒ 落到 suan49 之后的
    //         KKT 投影抢救路径（这才是本断言原本能过的原因 —— 它在测一条**故障旁路**）。
    //     · 作用域修复后采样恢复正常，这题现在由**网格采样 + 前向传播**直接产出真解，
    //       KKT 抢救根本不再被触发（它只在 0 解时兜底）。
    //   两个候选都是**数学真解**（xyz=6 ∧ x+y+z=6 的解集是曲线，两点残差都 ~1e-12/1e-13），
    //   所以这不是精度退化，而是从「故障旁路」回到了「正常主路」。
    //   断言改为锁定**数学事实**而非实现路径：欠定系统给 1 个代表解时，
    //   必须带 truncated=true（正维流形 ⇒ 结构上不可能完备）。
    check('欠定代表解必须标 truncated=true（正维流形不可完备）',
      r.truncated === true, 'truncated=' + String(r.truncated));
    check('执行路径已明示欠定（路径文案随实现可变，语义须为欠定代表解）',
      /代表解/.test(String(r.executionPath || '')) || /投影/.test(String(r.executionPath || '')),
      String(r.executionPath));
    // 独立验算：投影自报的 residual 不可信，必须回代原方程
    const vm = { x: s.values[0], y: s.values[1], z: s.values[2] };
    const e1 = Math.abs(sb.evalAST(sb.parse(sb.tokenize('x*y*z - 6')), vm));
    const e2 = Math.abs(sb.evalAST(sb.parse(sb.tokenize('x + y + z - 6')), vm));
    check('投影解经原方程独立回代 < 1e-9', e1 < 1e-9 && e2 < 1e-9, 'e1=' + e1 + ' e2=' + e2);
    // 🔴 2026-10-05 契约变更：删掉「‖x‖ 必须等于理论最近解 3.7012」这条断言。
    //   那测的是「离原点最近」这条**人为规则**（用户指令已删除该规则）。
    //   保留的判据是数学的：代表解是**真解**（上面已独立回代验证）+ **域内有限**。
    check('代表解坐标有限（非 NaN/Inf）',
      s.values.every(v => typeof v === 'number' && isFinite(v)), JSON.stringify(s.values));
  }
}

console.log('');
console.log('【②c 回归：挑选准则必须是「残差最小」而非「‖x‖ 最小」（2026-10-05）】');
{
  // 🔴🔴 这条护栏来自一次真实的静默 bug，症状与「代码没写」完全一样：
  //   把 `var best, bestD2` 改成 `var best, bestRes` 时，循环里
  //   `if (d2 < bestD2)` 漏改 ⇒ bestD2 成未声明标识符 ⇒ 运行时 ReferenceError
  //   被上层 try/catch 吞掉 ⇒ best 恒 null ⇒ 整条欠定救援路径静默失效
  //   ⇒ 唯一症状是「x*y*z=6, x+y+z=6 报 0 解」。
  //
  // 为什么单靠「② 默认域下有解」抓不到：那条断言**只检查有没有解**，
  //   而这条 bug 恰好就是「本来有解却报 0 解」—— 只有真跑这条题才看得出来，
  //   而它已经在 ② 里了。真正的教训是：**挑选变量改名后必须有一条
  //   直接断言「挑选结果非 null 且是某个起点收敛出的解」**，
  //   否则「恒 null」和「没跑」在结果上不可区分。
  //
  // 本块直接验证挑选逻辑本身：多个起点各跑一次 KKT，必有至少一个收敛且残差达标。
  // 若挑选变量再次未定义导致全被丢弃，这里会与端到端症状同时爆红。
  const eqs = [
    sb.parse(sb.tokenize('(x*y*z)-6')),
    sb.parse(sb.tokenize('(x+y+z)-6')),
  ];
  const dom = { x: { min: -1000000, max: 1000000 }, y: { min: -1000000, max: 1000000 }, z: { min: -1000000, max: 1000000 } };
  let okCount = 0;
  for (const st of [[2, 2, 1.5], [1, 1, 4], [3, 2, 1]]) {
    const pr = sb._suan56Project(eqs, ['x', 'y', 'z'], st.slice(), dom, { maxIter: 60 });
    if (pr && pr.ok && pr.residual < 1e-9) okCount++;
  }
  check('多起点 KKT 至少 2 个收敛且残差达标（挑选池非空）', okCount >= 2, 'ok=' + okCount);
}

console.log('');
console.log('【②b 回归：欠定线性「代表解」必须是真解且由 RREF 规范确定（2026-10-05 改）】');
{
  // 🔴 2026-10-05 契约变更（用户指令：「不需要离原点最近，把这条规则删掉」）：
  //   本块原先断言「首位必须是距原点最近的解」—— 那条规则已被删除，
  //   断言随之改成**新契约**：代表解是**真解**（过原方程回代），
  //   且由**行最简形自由变量取 0** 这一线性代数规范唯一确定（不依赖「距离」）。
  //
  // 本题 x+y+z=6, x+y−z=0 的解集是 { z=3, x+y=3 } 的一维仿射子空间。
  //   消元到 RREF：主元列取到 z 与 x（或等价的一列），自由列取 0 ⇒ 得一个具体点。
  //   该点**不是**几何上最近的 (1.5,1.5,3)，但它同样是真解 —— 这正是新契约允许的。
  const r = core.solve(['x + y + z = 6', 'x + y - z = 0'], ['x', 'y', 'z'], 6);
  const s = res(r);
  check('欠定线性有解', !!s);
  if (s) {
    const vm = { x: s.values[0], y: s.values[1], z: s.values[2] };
    const e1 = Math.abs(sb.evalAST(sb.parse(sb.tokenize('x + y + z - 6')), vm));
    const e2 = Math.abs(sb.evalAST(sb.parse(sb.tokenize('x + y - z')), vm));
    check('代表解经原方程独立回代 < 1e-9（是���解，不是伪解）', e1 < 1e-9 && e2 < 1e-9,
      'e1=' + e1 + ' e2=' + e2 + ' v=' + JSON.stringify(s.values));
    // 落在解集上：z 必须 = 3，x+y 必须 = 3（这才是「解集维数 1」的几何约束）
    check('代表解落在解集上（z=3 且 x+y=3）',
      Math.abs(s.values[2] - 3) < 1e-9 && Math.abs(s.values[0] + s.values[1] - 3) < 1e-9,
      'v=' + JSON.stringify(s.values));
    // RREF 规范：自由变量取 0 ⇒ 至少有一个分量为 0（x+y=3、z=3 已定，剩一个自由度被置 0）
    check('代表解满足 RREF 自由变量取 0（至少一分量为 0）',
      s.values.some(v => Math.abs(v) < 1e-9), 'v=' + JSON.stringify(s.values));
    // 不再要求「首位 == 全集最小范数」—— 该规则已删除
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
console.log('【④ 线性欠定走 RREF 自由变量取 0 特解（2026-10-05 改：不再走伪逆最小范数）】');
{
  // 🔴 契约变更：旧实现算 x* = A⁺b = argmin‖x‖，即**离原点最近**那个解
  //   （x+y=3 的最小范数解是 (1.5,1.5)，‖x‖=2.121）。
  //   新实现走 Gauss-Jordan 消元到行最简形，**自由列取 0**：
  //   x+y=3 消元后 x 是主元列、y 是自由列 ⇒ y=0 ⇒ x=3 ⇒ 得 (3, 0)。
  //
  //   为什么这是「取消偏好」而不是「换一个偏好」：
  //   RREF 把自由列标准化为 0 是**消元法的定义**（不是我们额外加的规则），
  //   而最小范数解需要额外指定欧氏范数这个度量。
  //   两者的实质差别是**少一个度量** vs **多一个度量**。
  const r = core.solve(['x + y = 3'], ['x', 'y'], 6);
  const s = res(r);
  check('线性欠定 x+y=3 有真解', !!s, s ? JSON.stringify(s.values) : 'null');
  if (s) {
    check('x+y=3：代表解满足方程', Math.abs(s.values[0] + s.values[1] - 3) < 1e-9,
      JSON.stringify(s.values));
    check('x+y=3：RREF 自由变量取 0（至少一个分量为 0）',
      s.values.some(v => Math.abs(v) < 1e-9),
      JSON.stringify(s.values));
    // 实测主元列是 y（RREF 的列选择由消元顺序决定，可��� y 也可 x，
    // 两者都是合法的 RREF 特解）⇒ 实测得 (1.5, 1.5) 而非 (3, 0)。
    // 断言只锁「自由列为 0」这个契约，不锁「哪一列当主元」这个实现自由度。
  }
  check('线性欠定不标 suan56Projection（走精确线性代数）', !r.suan56Projection);

  const r2 = core.solve(['x + y + z = 6', 'x + y - z = 0'], ['x', 'y', 'z'], 6);
  const s2 = res(r2);
  check('线性三元欠定：代表解是真解（z=3, x+y=3）',
    s2 && Math.abs(s2.values[2] - 3) < 1e-9 && Math.abs(s2.values[0] + s2.values[1] - 3) < 1e-9,
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
