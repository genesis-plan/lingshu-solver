// 合规门禁专项测试：敏感信息拦截 + 正常数学零误伤
'use strict';
const { solve } = require('../solver-core');

let pass = 0, fail = 0;
function expectBlock(label, eqs, vars) {
  try { solve(eqs, vars || [], 6); fail++; console.log('FAIL(未拦截) ' + label); }
  catch (e) {
    if (e && e.type === 'invalid_input') { pass++; console.log('PASS(拦截) ' + label + ' → ' + e.message.slice(0, 42) + '…'); }
    else { fail++; console.log('FAIL(错误类型不对) ' + label + ' → ' + (e.message || e)); }
  }
}
function expectOk(label, eqs, vars, dom) {
  try {
    const r = solve(eqs, vars || [], 6, dom);
    if (r && (r.solutions || r.resultType)) { pass++; console.log('PASS(放行) ' + label + ' → rt=' + r.resultType + ' N=' + (r.solutions || []).length); }
    else { fail++; console.log('FAIL(结果异常) ' + label); }
  } catch (e) { fail++; console.log('FAIL(误拦截) ' + label + ' → ' + (e.message || e)); }
}

console.log('=== 应拦截 ===');
expectBlock('手机号', ['x + 13812345678 = 0']);
expectBlock('手机号(纯数字)', ['13800138000']);
expectBlock('身份证号', ['x = 110101199003074512']);
expectBlock('身份证号(尾部X)', ['x = 11010119900307451X']);
expectBlock('银行卡类长数字', ['x * 6222020200112233 = 1']);
expectBlock('邮箱', ['x + zhangsan@example.com = 0']);
expectBlock('中文文字', ['其中a等于1']);
expectBlock('中文人名', ['张三 + x = 5']);
expectBlock('变量名中文', ['x + y = 3'], ['中文']);
expectBlock('总长超限(>100KB)', ['x' + '+1'.repeat(60000) + '=0']);

console.log('=== 应放行（正常数学，零误伤）===');
expectOk('一元二次', ['x^2 - 5*x + 6 = 0']);
expectOk('二元方程组', ['x + y = 7', 'x - y = 1']);
expectOk('希腊/下标变量', ['θ + 1 = 3'], ['θ']);
expectOk('小数与负数', ['2.5*x + 3.7 = -1.3']);
expectOk('函数 sqrt/log/sin', ['sqrt(x) = 3', 'log(x) = 1', 'sin(x) = 0.5'], ['x'], { x: [0, 6] });
expectOk('区间约束', ['x ∈ [1, 100]', 'x^2 = 4']);
expectOk('10位数字放行', ['x + 1234567890 = 0']);
expectOk('豆包竖式粘贴', ['4\n(\nx\n−\n2\n)\n+\n3\n=\n2\nx\n+\n7']);

console.log('\nPASS=' + pass + ' FAIL=' + fail);
process.exit(fail ? 1 : 0);
