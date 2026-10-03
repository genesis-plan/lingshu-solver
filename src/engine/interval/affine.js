/* 模块 interval/affine：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function _Aff(c, e) { return { c: c, e: e || {} }; }

function _affRad(a) { if (!a) return 0; var r = 0; for (var k in a.e) r += Math.abs(a.e[k]); return r; }

function _affToInterval(a) { if (!a) return null; var r = _affRad(a); return _iNorm({ min: a.c - r, max: a.c + r }); }
// sound 容差：区间求值受浮点舍入影响，包络可能偏离真值几个 ulp（如 12/5 经 12*(1/5)

function _ivExcludesZero(iv) {
  if (!iv || !isFinite(iv.min) || !isFinite(iv.max)) return false;
  var pad = Math.max(1e-12, 1e-12 * Math.max(1, Math.abs(iv.min), Math.abs(iv.max)));
  return iv.max < -pad || iv.min > pad;
}

function _affAdd(a, b) { var e = {}; for (var k in a.e) e[k] = a.e[k]; for (var k in b.e) e[k] = (e[k] || 0) + b.e[k]; return _Aff(a.c + b.c, e); }

function _affSub(a, b) { var e = {}; for (var k in a.e) e[k] = a.e[k]; for (var k in b.e) e[k] = (e[k] || 0) - b.e[k]; return _Aff(a.c - b.c, e); }

function _affMul(a, b) {
  // 一阶 AA 乘法（de Figueiredo 2004）：线性项 + 二次残差保守吸收为新噪声 ε
  var ra = _affRad(a), rb = _affRad(b), e = {};
  for (var i in a.e) e[i] = (e[i] || 0) + b.c * a.e[i];
  for (var i in b.e) e[i] = (e[i] || 0) + a.c * b.e[i];
  var xlo = a.c - ra, xhi = a.c + ra, ylo = b.c - rb, yhi = b.c + rb;
  var cross = Math.abs((xlo - a.c) * (yhi - b.c) + (xhi - a.c) * (ylo - b.c)) / 2;
  var gamma = cross;
  // 二次项重复计数修正（2026-10-02，紧性改进，sound 不变）：
  //   x*x 这类【同一仿射表达式自乘】时 a.e 与 b.e 是同一组噪声符号、代表同一个不确定量，
  //   原双重循环把它当成两个独立噪声累加 ⇒ 半径多出 |e_i*e_i|，包络宽约 2 倍。
  //   实测：x^2 @ [2,4] 得 [1,17]，真值 [4,16] —— 仍 sound（含真值），但恒松一倍。
  //   正确性论证：(c+e)^2 = c^2 + 2ce + e^2，其中 e^2 是【同一个】 e 的平方，只应计一次；
  //   cross 项已覆盖 Taylor 余项的一阶部分，跳过重复计数后包络仍含真值。
  //   注意：本函数历史上多次因 unsound 被修，改动必须经蒙特卡洛包含性验证 + 全回归。
  var _selfMul = (a === b);
  for (var i in a.e) for (var j in b.e) {
    if (_selfMul && i === j) continue;
    gamma += Math.abs(a.e[i] * b.e[j]);
  }
  var sym = _affSym++; e[sym] = gamma;
  return _Aff(a.c * b.c, e);
}

function _affInv(b) {
  // 1/b 一阶泰勒，误差保守界 |(b-b0)^2|/(2 b0^2 ξ^2)，ξ∈盒，min|ξ|=|b0|-rb
  // ⚠️ 修正（sound 正确性，2026-09-07）：旧实现 r=0-b=-b，lin=(-1/b.c²)·(-b) 的中心 lin.c 已是 1/b.c，
  //   return 又写 1/b.c + lin.c → 中心被双重计数为 2/b.c（如 1/5 算成 0.4、12/5 算成 4.8），
  //   导致所有含除法的区间包络 / 中值定理判无解（suan7/suan29/suan35 等）系统性假阴性。
  //   正确：dev = b - b.c（中心 0）做一阶泰勒，lin.c=0，return 中心恰为 1/b.c，且噪声符号正确。
  var rb = _affRad(b); if (b.c === 0) return null;
  var dev = _affSub(b, _Aff(b.c, {}));   // b - b0，中心为 0
  var lin = _affMul(dev, _Aff(-1 / (b.c * b.c), {}));   // 一阶项，中心为 0
  var e = {}; for (var k in lin.e) e[k] = lin.e[k];
  var m = Math.abs(b.c) - rb; if (m <= 0) return null;
  var err = (rb * rb) / (2 * b.c * b.c * m * m);
  var sym = _affSym++; e[sym] = err;
  return _Aff(1 / b.c + lin.c, e);   // 现 lin.c=0 → 中心 = 1/b.c
}

function _affDiv(a, b) { var ib = _affInv(b); return ib ? _affMul(a, ib) : null; }

function _buildAffEnv(intervals) {
  var env = {}; _affSym = 0;
  if (intervals) for (var name in intervals) {
    var iv = intervals[name];
    if (!iv || iv.min > iv.max) { env[name] = _Aff(iv ? (iv.min + iv.max) / 2 : 0, {}); continue; }
    var e = {}; e[_affSym++] = (iv.max - iv.min) / 2; env[name] = _Aff((iv.min + iv.max) / 2, e);
  }
  return env;
}

function _affineEval(ast, env) {
  if (!ast) return null;
  if (ast.type === 'num') return _Aff(ast.value, {});
  if (ast.type === 'var') {
    if (env[ast.name]) return env[ast.name];
    var e = {}; e[_affSym++] = 1e6; return _Aff(0, e); // 默认全域 [-1e6,1e6]
  }
  if (ast.type === 'binop') {
    var l = _affineEval(ast.left, env), r = _affineEval(ast.right, env);
    if (!l || !r) return null;
    if (ast.op === '+') return _affAdd(l, r);
    if (ast.op === '-') return _affSub(l, r);
    if (ast.op === '*') return _affMul(l, r);
    if (ast.op === '/') return _affDiv(l, r);
    if (ast.op === '^') {
      // 修复（sound 优先，2026-10-02）：旧实现用 Number.isInteger(Math.round(r.c)) 判整数幂，
      // 非整数指数被 Math.round 截断后照常返回仿射结果（x^0.2857→x^0=1、x^0.5→x^1、x^1.7→x^2），
      // 包络不覆盖真值 ⇒ unsound，且会把"明明有根"的式子判成无解。
      // 正确口径：指数必须是【精确非负整数】（Number.isInteger(r.c)，不做任何 round），否则 return null 降级 _rangeEval。
      // 负幂另加拒绝：_affInv 的一阶误差界 err=rb²/(2c²m²) 在 rb/c 不小时过紧（实测 x^-1@[2,3] 给 [0.315,0.485]，
      // 真值 [1/3,1/2] 落在盒外 ⇒ unsound）。负幂一律交 _rangeEval（端点取幂 + 倒数，精确且保守）。
      if (Object.keys(r.e).length === 0 && Number.isInteger(r.c) && r.c >= 0 && Math.abs(r.c) < 100) {
        var n = r.c; if (n === 0) return _Aff(1, {}); if (n === 1) return l;
        var acc = l; for (var p = 1; p < Math.abs(n); p++) acc = _affMul(acc, l);
        return n < 0 ? _affInv(acc) : acc;
      }
      return null; // 非整数幂：不能给出可信包络 ⇒ 保守交还 _rangeEval
    }
    return null;
  }
  if (ast.type === 'func') {
    var arg = ast.arg || (ast.args ? ast.args[0] : null);
    var av = arg ? _affineEval(arg, env) : null;
    if (!av) return null;
    var iv = _affToInterval(av); if (!iv) return null;
    // 超越函数降级：仿射自变量 → 保守区间函数包围（复用 _rangeEval，无递归环）
    var tmp = { type: 'func', name: ast.name, arg: { type: 'var', name: '__a' } };
    var rv = _rangeEval(tmp, { __a: iv });
    if (!rv || !isFinite(rv.min) || !isFinite(rv.max)) return null; // 含 ±Inf：交还 _rangeEval 直接给出保守区间
    // 关键修复（P0-2）：旧实现 return _Aff((rv.min+rv.max)/2, {}) 把合法区间宽度丢成 0，
    // 致 intervalEval(sin x)@[-2,2] 塌成 [0,0]（unsound：真值须含 [-1,1]）。
    // 正确做法：用半径 (rv.max-rv.min)/2 的噪声符号把 rv 完整编码为仿射，
    // 使 _affToInterval 还原为 [rv.min, rv.max]（sound 且紧致），Krawczyk 雅可比随之可信。
    var e = {}; e[_affSym++] = (rv.max - rv.min) / 2;
    return _Aff((rv.min + rv.max) / 2, e);
  }
  if (ast.type === 'unary') {
    var u = _affineEval(ast.operand, env);
    if (!u) return null;
    if (ast.op === '-') return _affSub(_Aff(0, {}), u);
    if (ast.op === '+') return u;
    return null;
  }
  return null;
}