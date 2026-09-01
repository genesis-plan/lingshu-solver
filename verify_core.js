'use strict';
const { solve } = require('./solver-core');

function show(label, eqs, vars, dom) {
  const t0 = Date.now();
  let r;
  try {
    r = solve(eqs, vars || [], 6, dom);
  } catch (e) {
    console.log(label, '=> THREW', e.message);
    return;
  }
  const dt = Date.now() - t0;
  const sols = r.solutions || [];
  const meta = r.meta || {};
  console.log(
    label,
    '| resultType=', r.resultType,
    '| #sol=', sols.length,
    '| meta.truncated=', !!meta.truncated,
    '| t=', dt + 'ms'
  );
  if (sols[0]) {
    console.log('   第一解:', JSON.stringify(sols[0]).slice(0, 200));
  }
  if (r.warnings && r.warnings.length) {
    console.log('   warnings:', JSON.stringify(r.warnings).slice(0, 160));
  }
}

console.log('=== solver-core 加载验证 ===');
show('1) x^2=4 (2解)', ['x^2 = 4'], ['x']);
show('2) 6变量三对角 (唯一解)', ['x+y=3', 'x+2y+z=8', 'y+2z+a=14', 'z+2a+b=20', 'a+2b+c=26', 'b+2c=31'], ['x', 'y', 'z', 'a', 'b', 'c']);
show('3) 空集无解', ['x+y=3', 'x+y=5'], ['x', 'y']);
show('4) 圆×双曲线 (4解)', ['x^2 + y^2 = 4', 'x*y = 1'], ['x', 'y']);
show('5) 高频+域 (截断)', ['sin(20*x)=0.5', 'sin(20*y)=0.5'], ['x', 'y'], { x: [-30, 30], y: [-30, 30] });
show('6) 无限解推荐', ['x+y=3'], ['x', 'y']);
console.log('=== 完成 ===');
