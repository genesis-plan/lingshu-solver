// 单用例驱动：node verify_compliance_one.js '<json: eqs>' '[json: vars]' '[json: dom]'
'use strict';
const { solve } = require('../solver-core');
const eqs = JSON.parse(process.argv[2]);
const vars = process.argv[3] ? JSON.parse(process.argv[3]) : [];
const dom = process.argv[4] ? JSON.parse(process.argv[4]) : undefined;
try {
  const r = solve(eqs, vars, 6, dom);
  console.log('SOLVED rt=' + r.resultType + ' N=' + (r.solutions || []).length + ' truncated=' + r.truncated + ' ms=' + r.timeMs);
} catch (e) {
  console.log('THREW type=' + (e && e.type) + ' msg=' + (e && e.message ? e.message.slice(0, 60) : e));
}
