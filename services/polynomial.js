/**
 * 多项式解析 → 支撑集 / Newton 多胞形（代数 ↔ 几何桥接的第一步）。
 *
 * 为什么自己写解析器，而不复用引擎的 parse()：
 *   引擎的 AST 是给**求值**用的（嵌套一元多项式、三角函数节点、区间算术…），
 *   从它反推「指数向量集合」要穿过一整层语义，任何一处引擎改动都会让桥接层
 *   悄悄失真。桥接层要的是一个**极窄、极硬的契约**：
 *       要么给我一组 (系数, 指数向量)，要么明确告诉我「这不是多项式」。
 *   所以这里写一个只认 + - * ^ ( ) 数字 变量 的小解析器，遇到 sin / sqrt /
 *   非整数指数一律 fail-closed 抛错，绝不猜。
 *
 * ── 为什么要支持 Laurent（负指数）───────────────────────────────────
 *   BKK 定理的舞台是 (C*)^n —— 所有变量**非零**。负指数在环面上完全合法，
 *   Newton 多胞形照样是格多胞形，混合体积照样是解数上界。
 *   而我们的求解器本来就把「含 1/x 的方程」当作合法输入，所以必须支持。
 *   代价：`x=0` 处的解**不在**环面界的覆盖范围内 —— 这个洞在 bounds.js 里
 *   单独标出来（zeroCoordinateRisk），不藏着。
 *
 * ── 隐式乘法（2x、xy、2(x+1)）必须支持 ──────────────────────────────
 *   Agent 写方程不会规规矩矩打星号。不支持就 90% 的输入直接判成「非多项式」，
 *   整个桥接层等于没做。规则：factor 后面紧跟 num / id / '(' 就算乘。
 *   歧义只有一处：`name(` 且 name 不是已声明变量 ⇒ 函数调用 ⇒ 直接拒绝
 *   （宁可拒绝，也不把 sin(x) 猜成 s*i*n*(x)）。
 */
'use strict';

function fail(type, msg, extra) {
  const e = new Error(msg);
  e.type = type;
  Object.assign(e, extra || {});
  return e;
}

const ID_START = /[\p{L}_]/u;
const ID_BODY = /[\p{L}\p{N}_]/u;

function tokenize(src) {
  if (typeof src !== 'string') throw fail('invalid_input', 'expression must be a string');
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      let j = i;
      let seenDot = false;
      while (j < src.length) {
        const c = src[j];
        if (c >= '0' && c <= '9') { j++; continue; }
        if (c === '.' && !seenDot) { seenDot = true; j++; continue; }
        break;
      }
      if (j < src.length && (src[j] === 'e' || src[j] === 'E')) {
        let k = j + 1;
        if (k < src.length && (src[k] === '+' || src[k] === '-')) k++;
        if (k < src.length && src[k] >= '0' && src[k] <= '9') {
          while (k < src.length && src[k] >= '0' && src[k] <= '9') k++;
          j = k;
        }
      }
      const v = parseFloat(src.slice(i, j));
      if (!Number.isFinite(v)) throw fail('not_polynomial', `bad number at position ${i}: ${src.slice(i, j)}`);
      out.push({ t: 'num', v });
      i = j;
      continue;
    }
    if (ID_START.test(ch)) {
      let j = i;
      while (j < src.length && ID_BODY.test(src[j])) j++;
      out.push({ t: 'id', v: src.slice(i, j) });
      i = j;
      continue;
    }
    if ('+-*^()=/'.indexOf(ch) >= 0) { out.push({ t: ch }); i++; continue; }
    throw fail('not_polynomial', `unexpected character "${ch}" at position ${i} — this parser accepts polynomials only`);
  }
  return out;
}

// ── 多项式（稀疏单项式表）的小代数 ──────────────────────────────────
// mono := { c: number, e: number[] }（e 的长度 = 变量个数，允许负分量）

function polyZero(n) { return []; }
function polyConst(c, n) {
  if (c === 0) return [];
  return [{ c, e: new Array(n).fill(0) }];
}

function polyAdd(a, b) {
  const out = a.map((m) => ({ c: m.c, e: m.e.slice() }));
  for (const m of b) {
    let hit = null;
    for (const o of out) {
      let same = true;
      for (let k = 0; k < o.e.length; k++) if (o.e[k] !== m.e[k]) { same = false; break; }
      if (same) { hit = o; break; }
    }
    if (hit) hit.c += m.c; else out.push({ c: m.c, e: m.e.slice() });
  }
  return out.filter((m) => m.c !== 0);
}
const polySub = (a, b) => polyAdd(a, b.map((m) => ({ c: -m.c, e: m.e })));
function polyNeg(a) { return a.map((m) => ({ c: -m.c, e: m.e.slice() })); }

function polyMul(a, b) {
  const out = [];
  for (const u of a) for (const v of b) {
    const e = new Array(u.e.length);
    for (let k = 0; k < e.length; k++) e[k] = u.e[k] + v.e[k];
    out.push({ c: u.c * v.c, e });
  }
  // 合并同类项
  const merged = [];
  for (const m of out) {
    let hit = null;
    for (const o of merged) {
      let same = true;
      for (let k = 0; k < o.e.length; k++) if (o.e[k] !== m.e[k]) { same = false; break; }
      if (same) { hit = o; break; }
    }
    if (hit) hit.c += m.c; else merged.push(m);
  }
  return merged.filter((m) => m.c !== 0);
}

/** 除以单项式（Laurent 才有意义）：要求整个除数只有一个单项式 */
function polyDivByMono(a, den) {
  if (den.length !== 1) {
    throw fail('not_polynomial',
      'division is only supported by a monomial (e.g. /x, /2, /(3*x^2)); '
      + 'a general denominator would not give a Laurent polynomial');
  }
  const d = den[0];
  if (d.c === 0) throw fail('not_polynomial', 'division by zero');
  return a.map((m) => {
    const e = new Array(m.e.length);
    for (let k = 0; k < e.length; k++) e[k] = m.e[k] - d.e[k];
    return { c: m.c / d.c, e };
  }).filter((m) => m.c !== 0);
}

// ── 递归下降 ────────────────────────────────────────────────────────

/**
 * @param src  表达式文本（不含 = ）
 * @param vars 变量名数组（有序，决定指数向量的坐标顺序）
 */
function parseExpr(src, vars) {
  const toks = tokenize(src);
  if (!toks.length) throw fail('not_polynomial', 'empty expression');
  const n = vars.length;
  const idx = new Map();
  vars.forEach((v, i) => idx.set(v, i));
  let p = 0;

  const peek = () => toks[p] || null;
  const at = (t) => { const k = peek(); return k && k.t === t; };

  function parseExpr_() {
    let left = parseTerm();
    for (;;) {
      const tk = peek();
      if (!tk) break;
      if (tk.t === '+') { p++; left = polyAdd(left, parseTerm()); continue; }
      if (tk.t === '-') { p++; left = polySub(left, parseTerm()); continue; }
      break;
    }
    return left;
  }

  function parseTerm() {
    let left = parseFactor();
    for (;;) {
      const tk = peek();
      if (!tk) break;
      if (tk.t === '*') { p++; left = polyMul(left, parseFactor()); continue; }
      if (tk.t === '/') { p++; left = polyDivByMono(left, parseFactor()); continue; }
      // 隐式乘法：紧跟 num / id / '('
      if (tk.t === 'num' || tk.t === 'id' || tk.t === '(') { left = polyMul(left, parseFactor()); continue; }
      break;
    }
    return left;
  }

  function parseFactor() {
    let sign = 1;
    while (at('-')) { p++; sign = -sign; }
    while (at('+')) { p++; }
    const base = parsePower();
    return sign < 0 ? polyNeg(base) : base;
  }

  function parsePower() {
    const base = parseAtom();
    if (at('^')) {
      p++;
      let neg = false;
      if (at('-')) { p++; neg = true; }
      else if (at('+')) { p++; }
      const tk = peek();
      if (!tk || tk.t !== 'num') {
        throw fail('not_polynomial', 'exponent must be a literal integer (e.g. x^3, x^-1)');
      }
      const k = neg ? -tk.v : tk.v;
      if (!Number.isInteger(k)) {
        throw fail('not_polynomial', `exponent must be an integer, got ${tk.v} — fractional powers leave the polynomial world`);
      }
      p++;
      // 快速幂（指数绝对值限制，防 Agent 喂 x^99999999 把内存打爆）
      const absk = Math.abs(k);
      if (absk > 4096) throw fail('resource_limit', `exponent magnitude ${absk} too large (cap 4096)`);
      let out = polyConst(1, n);
      const bse = k < 0 ? polyDivByMono(polyConst(1, n), base) : base;
      const m = k < 0 ? absk : k;
      for (let i = 0; i < m; i++) out = polyMul(out, bse);
      return out;
    }
    return base;
  }

  function parseAtom() {
    const tk = peek();
    if (!tk) throw fail('not_polynomial', 'unexpected end of expression');
    if (tk.t === 'num') { p++; return polyConst(tk.v, n); }
    if (tk.t === '(') {
      p++;
      const inner = parseExpr_();
      if (!at(')')) throw fail('not_polynomial', 'missing ")"');
      p++;
      return inner;
    }
    if (tk.t === 'id') {
      const name = tk.v;
      const nxt = toks[p + 1];
      if (idx.has(name)) {
        p++;
        const e = new Array(n).fill(0);
        e[idx.get(name)] = 1;
        return [{ c: 1, e }];
      }
      if (nxt && nxt.t === '(') {
        throw fail('not_polynomial',
          `function call "${name}(...)" — this parser handles polynomials only, `
          + 'so no root count / solution bound can be derived from it');
      }
      // 尝试拆成若干单字符变量的连乘（Agent 常写 xy 而不是 x*y）
      //
      // ⚠ 为什么是「把 token 拆开重解析」而不是「在这里直接乘完返回」（真 bug）：
      //   第一版在这里把 x·y 算完再返回，结果 `xy^2` 被解析成 (xy)^2 = x²y²，
      //   而数学惯例是 `^` 比隐式乘法更紧，xy^2 = x·y²。差一个指数向量，
      //   Newton 多胞形就整个错，混合体积跟着错，而且**不报错**。
      //   正确做法是往 token 流里塞回独立的 'x','y'，让 parsePower 正常
      //   处理 `^` 的作用域 —— 幂自然只作用在最后一个变量上。
      const chars = Array.from(name);
      if (chars.length > 1 && chars.every((c) => idx.has(c))) {
        toks.splice(p, 1, ...chars.map((c) => ({ t: 'id', v: c })));
        return parsePower();
      }
      throw fail('unknown_variable',
        `"${name}" is not a declared variable. Declared: ${vars.join(', ') || '(none)'}`);
    }
    throw fail('not_polynomial', `unexpected token "${tk.t}"`);
  }

  const res = parseExpr_();
  if (p !== toks.length) throw fail('not_polynomial', `trailing input at token ${p}`);
  return res;
}

// ── 方程（带 = ）────────────────────────────────────────────────────

/** 字符级顶层 '=' 位置（括号外；'==' 当成单个 '='，跳过第二个字符） */
function topLevelEqualsPos(src) {
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === '=' && depth === 0) {
      if (src[i + 1] === '=') { i++; continue; }
      return i;
    }
  }
  return -1;
}

/**
 * 解析一个方程 → 多项式（全部移到左边：lhs - rhs = 0）。
 * @returns { variables, monomials, terms, degree, laurent, constant, zero }
 */
function parseEquation(src, vars) {
  if (typeof src !== 'string' || !src.trim()) throw fail('invalid_input', 'equation must be a non-empty string');
  const V = (Array.isArray(vars) && vars.length) ? vars.slice() : inferVariables(src);
  if (!V.length) throw fail('no_variables', `no variables found in "${src}"`);

  const cp = topLevelEqualsPos(src);
  let monos;
  if (cp < 0) {
    monos = parseExpr(src, V);                          // 没有 '=' ⇒ 视为 expr = 0
  } else {
    const step = (src[cp + 1] === '=') ? 2 : 1;
    monos = polySub(parseExpr(src.slice(0, cp), V), parseExpr(src.slice(cp + step), V));
  }
  return shape(monos, V, src);
}

function shape(monos, V, src) {
  const n = V.length;
  let degree = -Infinity;
  let laurent = false;
  for (const m of monos) {
    let deg = 0;
    for (const x of m.e) { deg += x; if (x < 0) laurent = true; }
    if (deg > degree) degree = deg;
  }
  if (degree === -Infinity) degree = 0;
  return {
    source: src,
    variables: V.slice(),
    monomials: monos.map((m) => ({ coef: m.c, exps: m.e.slice() })),
    terms: monos.length,
    degree,
    laurent,
    zero: monos.length === 0
  };
}

/** 未给变量表时，从文本里推断（按出现顺序） */
function inferVariables(src) {
  const toks = tokenize(src);
  const seen = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t !== 'id') continue;
    const nxt = toks[i + 1];
    if (nxt && nxt.t === '(') continue;          // 函数调用，不是变量
    if (seen.indexOf(t.v) < 0) {
      // 多字符未声明标识符：先整体记录，若后面证明拆不开会由 parseExpr 报错
      seen.push(t.v);
    }
  }
  // 去掉纯数字的？tokenize 已把数字分成 num
  return seen;
}

// ── Newton 多胞形 ───────────────────────────────────────────────────

/** 支撑集 = 指数向量的集合（Newton 多胞形 = 这些点的凸包） */
function support(parsed) {
  return parsed.monomials.map((m) => m.exps.slice());
}

/**
 * 系统级解析：一组方程 → 各自的多项式结构。
 * 变量表取**并集**并按首次出现排序，保证各方程的指数向量在同一坐标系里
 * （否则混合体积是在拿不同坐标系的点做 Minkowski 和，结果毫无意义）。
 */
function parseSystem(equations, vars) {
  if (!Array.isArray(equations) || equations.length === 0) {
    throw fail('invalid_input', 'equations must be a non-empty array of strings');
  }
  let V = (Array.isArray(vars) && vars.length) ? vars.slice() : null;
  if (!V) {
    const acc = [];
    for (const eq of equations) for (const v of inferVariables(eq)) if (acc.indexOf(v) < 0) acc.push(v);
    V = acc;
  }
  // 声明的变量不足（方程里出现了别的符号）时，按首次出现补进来，而不是报错 ——
  // 但补进来的必须报告给调用方，因为它改变了「变量个数 = 维数」这个前提
  const extra = [];
  for (const eq of equations) {
    for (const v of inferVariables(eq)) {
      if (V.indexOf(v) >= 0) continue;
      // 多字符标识符可能是 xy 这种连写，先让解析器决定；这里只补单字符的
      if (Array.from(v).length === 1 && v.length <= 2) { V.push(v); extra.push(v); }
    }
  }
  const polys = equations.map((eq) => parseEquation(eq, V));
  return {
    variables: V,
    extraVariables: extra,
    equations: polys,
    /** 每个方程在每个变量上的最低次数 ⇒ 判断「是否有变量=0 的解」风险 */
    minDegrees: polys.map((p) => {
      const n = V.length;
      const mins = new Array(n).fill(Infinity);
      for (const m of p.monomials) {
        for (let k = 0; k < n; k++) if (m.exps[k] < mins[k]) mins[k] = m.exps[k];
      }
      return mins.map((x) => (x === Infinity ? null : x));
    })
  };
}

module.exports = {
  parseSystem,
  parseEquation,
  parseExpr,
  tokenize,
  support,
  topLevelEqualsPos,
  inferVariables,
  polyAdd, polySub, polyMul, polyNeg, polyConst, polyDivByMono
};
