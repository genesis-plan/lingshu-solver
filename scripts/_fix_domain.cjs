// 去掉硬编码 ±1e6，改为按方程量级自适应（见 constants.js 的说明）
//
// 为什么必须改（实测 2026-10-03）：
//   solve(["x=10000000"], ["x"]) 返回「空结果 / 已证明无解」—— 而 x=1e7 真实存在。
//   这是 fail-closed 的漏洞：它没有说「不确定」，而是撒谎说「无解」。
//   1e7 这个量级在几何级数、组合计数、AI 生成的规模题里非常常见。
//
// 改法不是「换成 ±∞」（全域穷举会爆预算），而是：
//   默认域 = inferDomainHalfWidth(方程里出现过的最大常量) × 10，夹在 [1e-6, 1e12]。
//   读不出常量时才用 1e12 兜底，由分支定界做区间收缩。
const fs = require('fs');
const p = 'src/engine/pipeline/solver.js';
let s = fs.readFileSync(p, 'utf8');

const ORIG = '/1000000/g';
let count = 0;

// 情形 A：形如 var _lo = -1000000, _hi = 1000000;  → 用推断值
const A_OLD = '                    var _lo = -1000000, _hi = 1000000;';
const A_NEW = '                    var _lo = -_lsHalfW, _hi = _lsHalfW;';

// 情形 B：{ min: -1000000, max: 1000000 } → 用推断值
const B_OLD = '{ min: -1000000, max: 1000000 }';
const B_NEW = '{ min: -_lsHalfW, max: _lsHalfW }';

// 情形 C：标量 -1000000 / 1000000（isNaN 回退）
const C_OLD = 'if (isNaN(_dlo)) _dlo = -1000000;';
const C_NEW = 'if (isNaN(_dlo)) _dlo = -_lsHalfW;';
const D_OLD = 'if (isNaN(_dhi)) _dhi = 1000000;';
const D_NEW = 'if (isNaN(_dhi)) _dhi = _lsHalfW;';
const E_OLD = 'min: isNaN(Number(_dval.min)) ? -1000000 : Number(_dval.min),';
const E_NEW = 'min: isNaN(Number(_dval.min)) ? -_lsHalfW : Number(_dval.min),';
const F_OLD = 'max: isNaN(Number(_dval.max)) ? 1000000 : Number(_dval.max)';
const F_NEW = 'max: isNaN(Number(_dval.max)) ? _lsHalfW : Number(_dval.max)';

const pairs = [[A_OLD, A_NEW], [B_OLD, B_NEW], [C_OLD, C_NEW], [D_OLD, D_NEW], [E_OLD, E_NEW], [F_OLD, F_NEW]];
for (const [o, n] of pairs) {
  if (!s.includes(o)) { console.error('✗ 未找到: ' + o.trim().slice(0, 60)); process.exit(1); }
  s = s.split(o).join(n);
  count++;
}

// 在 _solveImpl 的域初始化段之前声明 _lsHalfW
const ANCHOR = '    // 初始化 D0：优先使用传入的 initialD0（分支定界递归调用），否则默认 [-1000000, 1000000]';
if (!s.includes(ANCHOR)) { console.error('✗ 找不到 D0 初始化锚点'); process.exit(1); }
const DECL = [
  '    // 默认域半宽：按方程里出现过的最大常量自适应（constants.js 有完整理由）。',
  '    // 旧实现硬编码 1e6，实测会让 x=10000000 这类真实解被静默判成「无解」。',
  '    var _lsHalfW = inferDomainHalfWidth(state.equationStrs || state._origEqStrs || []);',
  '    if (!(isFinite(_lsHalfW) && _lsHalfW > 0)) _lsHalfW = _LS_DOMAIN_FALLBACK;',
].join('\n');
s = s.replace(ANCHOR, DECL + '\n' + ANCHOR.replace('[-1000000, 1000000]', '[-halfW, +halfW]'));

// 第二处（_globalBranchCertify 之前的 _gbDom）也需要
const ANCHOR2 = '                    var _lo = -1000000, _hi = 1000000;';
if (s.includes(ANCHOR2)) {
  console.log('· 第二处 _gbDom 的 var 声明已被上面的替换覆盖（预期内，同名变量）');
}

fs.writeFileSync(p, s, 'utf8');
console.log('✓ 已替换 ' + count + ' 处硬编码 ±1e6，改为自适应 _lsHalfW');
