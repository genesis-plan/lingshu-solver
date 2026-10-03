// 黄金基线「归一化口径」的唯一定义：capture（抓基线）与 suite/diff（验重构）必须共用同一份，
// 否则会出现「基线 vs 现值字段口径不同 → 20/20 全漂」的假失败。
//
// 参与比较的字段：
//   - 结果类型 / 解数 / 候选 / 证书数 / 截断 / 硬超时 / 正维 / 完备性 / 界
//   - 解的**顺序**（顺序变了就是行为变了）、values、residual（toExponential(12) 固定格式）、tier、cert 方法
// 不参与比较：timeMs（耗时必抖），由 diff.mjs 忽略。
export function norm(r) {
  if (!r) return null;
  const sols = (r.solutions || []).map((s) => ({
    values: s.values,
    residual: typeof s.residual === 'number' ? Number(s.residual.toExponential(12)) : s.residual,
    tier: s.tier,
    certified: s.certified,
    method: s.cert && s.cert.method,
  }));
  return {
    resultTypeName: r.resultTypeName,
    exactSolutionCount: r.exactSolutionCount,
    provenCount: r.provenCount,
    candidateCount: r.candidateCount,
    certificateCount: r.certification ? r.certification.length : 0,
    truncated: !!r.truncated,
    hardTimeout: !!r.hardTimeout,
    positiveDim: !!r.positiveDim,
    completenessProven: r.completeness ? r.completeness.provenIsComplete : null,
    bound: r.bound || null,
    nSolutions: sols.length,
    solutions: sols,
  };
}

export const CASES = [
  ['g001-2d-basic', ['x^2+y^2=4', 'x*y=1'], ['x', 'y']],
  ['g002-2d-resultant', ['x^2-2=0', 'y-3=0'], ['x', 'y']],
  ['g003-3d-sphere', ['x^2+y^2+z^2=14', 'x+y+z=6', 'x*y*z=6'], ['x', 'y', 'z']],
  ['g004-3d-linear', ['x+y+z=6', 'y+z=3', 'z=1'], ['x', 'y', 'z']],
  ['g005-4d-couple-ok', ['x^2+y^2+z^2+w^2=30', 'x+y+z+w=10', 'x*y=4', 'z*w=6'], ['x', 'y', 'z', 'w']],
  ['g006-4d-partial', ['x^2+y^2+z^2=14', 'x+y+z+w=10', 'x*y=4', 'z*w=6'], ['x', 'y', 'z', 'w']],
  ['g007-5d-chain', ['x+y+z+w+v=10', 'x^2+y^2+z^2+w^2+v^2=30', 'x*y=z', 'z*v=w', 'w*v=x'], ['x', 'y', 'z', 'w', 'v']],
  ['g008-n7-failclosed', ['a+b+c+d+e+f+g=7', 'a*b=1', 'c*d=1', 'e*f=1', 'g*a=1', 'b*c=1', 'd*e=1'], ['a', 'b', 'c', 'd', 'e', 'f', 'g']],
  ['g009-positive-dim', ['x-y=0'], ['x', 'y']],
  ['g010-no-real-sol', ['x^2+1=0'], ['x']],
  ['g011-trig', ['sin(x)=0.5'], ['x']],
  ['g012-abs-miranda', ['abs(x)-2=0'], ['x']],
  ['g013-rational-loan', ['120000*p*(1+p)^360-2500000=0'], ['p']],
  ['g014-division-equation', ['x^2-4=0', '(x-2)/(x+2)=0'], ['x', 'y']],
  ['g015-bezout8', ['x^2+y^2+z^2=3', 'x*y=1', 'y*z=1'], ['x', 'y', 'z']],
  ['g016-2d-watt', ['x^3+y^3-3*a*x*y=0', 'x+y=1'], ['x', 'y']],
  ['g017-exp-equation', ['exp(x)-2=0'], ['x']],
  ['g018-inequality-domain', ['x^2-4=0', 'x>0'], ['x']],
  ['g019-repeated-root', ['x^3-3*x^2+3*x-1=0'], ['x']],
  ['g020-big-scale', ['x*y-1e6=0', 'x+y-2000=0'], ['x', 'y']],
];
