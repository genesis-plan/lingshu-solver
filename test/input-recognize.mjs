// 输入识别层专项测试（src/engine/input/recognize.js）
//
// 为什么必须独立成文件：识别错 ⇒ 静默给错答案或谎称无解，后果比崩溃严重。
// 它是纯函数（无副作用、不碰引擎状态），所以能脱离求解器直接测 —— 这是抽成模块的核心收益。
import { classifyInput, classifyInputs, solvableInputs, INPUT_KIND } from '../dist/lingshu.mjs';

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  实际: ' + JSON.stringify(extra) : '')); }
}

console.log('── 1. 方程识别（Agent 最常见输入）──');
ok(classifyInput('x^2+y^2=25').kind === INPUT_KIND.EQUATION, '标准方程 → equation');
ok(classifyInput('2*x+3*y=13').kind === INPUT_KIND.EQUATION, '带显式乘的方程 → equation');
ok(classifyInput('x＝5').kind === INPUT_KIND.EQUATION, '全角＝ 归一化后仍是方程');
ok(classifyInput('  x^2=4  ').kind === INPUT_KIND.EQUATION, '首尾空白容错');

console.log('\n── 2. 裸表达式：应补 =0 ──');
ok(classifyInput('x^2-1').kind === INPUT_KIND.NEEDS_EQUALS, '裸表达式 → needsEquals');
ok(classifyInput('x^2-1').needsEquals === true, 'needsEquals 标志置位');
ok(classifyInput('3*x-6').kind === INPUT_KIND.NEEDS_EQUALS, '带乘的裸表达式 → needsEquals');
ok(classifyInput('x^2-1').normalized === 'x^2-1', 'normalized 不篡改内容（只归一化全角/空白）');

console.log('\n── 3. 约束与域：绝不能被补 =0（否则污染识别）──');
ok(classifyInput('x in [0,1]').kind === INPUT_KIND.DOMAIN, 'x in [0,1] → domain');
ok(classifyInput('x∈[0,1]').kind === INPUT_KIND.DOMAIN, 'x∈[0,1]（Unicode 成员符）→ domain');
ok(classifyInput('x <= 5').kind === INPUT_KIND.INEQUALITY, 'x <= 5 → inequality');
ok(classifyInput('x >= -3').kind === INPUT_KIND.INEQUALITY, 'x >= -3 → inequality');
ok(classifyInput('x < 5').kind === INPUT_KIND.INEQUALITY, 'x < 5 → inequality（无等号也不补 =0）');
ok(classifyInput('x in Z').kind === INPUT_KIND.DOMAIN, '整数约束 → domain（不补 =0）');

console.log('\n── 4. fail-closed：不确定就拒收，绝不猜 ──');
ok(classifyInput('解这个方程 x^2=4').kind === INPUT_KIND.ILLEGAL, '含中文 → illegal');
ok(classifyInput('solve for x').kind === INPUT_KIND.ILLEGAL, '英文自然语言 → illegal');
ok(classifyInput('find the roots of x^2=4').kind === INPUT_KIND.ILLEGAL, '整句自然语言 → illegal');
ok(classifyInput('').kind === INPUT_KIND.ILLEGAL, '空串 → illegal');
ok(classifyInput('   ').kind === INPUT_KIND.ILLEGAL, '纯空白 → illegal');
ok(classifyInput('???').kind === INPUT_KIND.ILLEGAL, '纯符号 → illegal（不猜它想干什么）');
ok(classifyInput(123).kind === INPUT_KIND.ILLEGAL, '非字符串 → illegal');
ok(classifyInput(null).kind === INPUT_KIND.ILLEGAL, 'null → illegal');
ok(classifyInput('sin(x)=0').kind === INPUT_KIND.EQUATION, '函数名 sin 不被误判为自然语言');

console.log('\n── 5. 全角符号归一化 ──');
ok(classifyInput('２*x＋３*y＝１３').normalized.includes('='), '全角＝→= 归一化');
ok(classifyInput('（x＋y）＝7').normalized.includes('('), '全角（→( 归一化');

console.log('\n── 6. 批量与筛选 ──');
const batch = classifyInputs(['x^2=4', 'y', 'x in [0,1]', '求 x']);
ok(batch.length === 4, '批量分类保留全部条目（不静默丢弃）');
ok(batch[0].index === 0 && batch[3].index === 3, '保留原始下标，便于回溯是哪条出错');
const solv = solvableInputs(['x^2=4', 'x^2-1', 'x in [0,1]', '求 x', 'y']);
ok(solv.length === 2, '可求解项只取方程 + 裸表达式（域约束、非法项、纯单词均被排除）',
  '得到 ' + solv.map(s => s.normalized).join(' | '));

console.log('\n── 7. 幂等性：同一输入重复分类结果一致 ──');
const a1 = classifyInput('x^2+y^2=25').kind;
const a2 = classifyInput('x^2+y^2=25').kind;
const a3 = classifyInput('x^2+y^2=25').kind;
ok(a1 === a2 && a2 === a3, '重复调用结果一致（无隐藏状态）');

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
