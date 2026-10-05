/* 模块 operators/registry：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
var OPS_SETUP = [
    _op('suan1', '方程/不等式解析与标准化', suan1, 1, 'setup'),
    _op('suan2', '变量提取与计数', suan2, 1, 'setup'),
    _op('suan3', '变量数硬校验(>6 终止)', suan3, 1, 'guard')
];

// —— 早期拦截层（解析+D0 初始化后立即执行，顺序敏感）——

var OPS_PRE = [
    _op('suan4', '非法算子拦截', suan4, 1, 'guard'),
    _op('suan5', '系数范围检测', suan5, 1, 'guard'),
    _op('suan6', '常量二次校验化简', suan6, 1, 'guard'),
    _op('suan7', '前向传播矛盾检测(区间包络)', suan7, 2, 'prove', false, true),
    _op('suan8', '边界极限行为预判', suan8, 1, 'analyze'),
    _op('suan9', '自动定义域约束推导', suan9, 1, 'contract', true, true)
];

// —— 轻量矛盾筛查层 ——

var OPS_SCREEN = [
    _op('suan10', '常数约束/赋值矛盾检测', suan10, 1, 'prove', false, true),
    _op('suan11', '结构恒正/恒负检测', suan11, 1, 'prove', false, true),
    _op('suan12', '压缩映射基础区间缩集', suan12, 2, 'contract', true, true),
    _op('suan13', '表达式特征标记', suan13, 1, 'analyze')
];

// —— 代数闭式求解层（强顺序依赖：化简 → 消元 → 回代，不可乱序、不可进不动点）——

var OPS_ALGEBRA = [
    _op('suan14', '流形奇点预检测标记', suan14, 2, 'analyze'),
    _op('suan15', '微积分表达式化简', suan15, 2, 'rewrite'),
    _op('suan16', '基础化简兼容分支', suan16, 1, 'rewrite'),
    // suan61：同伦延续（Numerical Algebraic Geometry）。
    // 置于 suan17 之前 —— 它接管的是**方阵非线性多项式系统**（n>=3、至少一阶>=2、
    // 全多项式），而 suan17/suan59/suan60 分别是线性/二元符号/线性精确栈，三者都不管这类题。
    // 为什么不放更后面：同伦给的是**可证明的完备性**（gamma trick 概率1保证），
    // 而区间收缩 + 分支定界只能证「找到的是真解」、永远无法证「没漏」⇒
    // 放后面会被前面的收缩/采样路径先判成 done，白白浪费唯一带完备性凭据的方法。
    // 实测收益：x+y+z-6=0, xy+yz+zx-11=0, xyz-6=0（解={1,2,3} 的 6 个排列）
    //   本算法 6/6 全找到并认证；改前只找到 2 个。
    // sound=true 的依据：路径追踪本身是数值过程，完备性由「全部路径正常收敛 + 逐一过原方程
    //   回代 + 去重数一致」三条合取给出（见 homotopy.js 顶部注释与 suan61 内裁决段）。
    //   任一条不成立 ⇒ completenessProven=false ⇒ 降级为部分解，绝不谎报。
     _op('suan61', '同伦延续(gamma trick+路径追踪, 带完备性裁决)', suan61, 3, 'solve', false, true),
    // suan60：3..6 元全线性系统的精确求解栈（presolve 裁剪 + Markowitz 稀疏序 +
    // O(n²) 精确代入验证）。置于 suan17 之前 —— 同题实测比 SymPy 1.14 linsolve 快 ~33×
    // （7 胜 0 负），且多出「精确秩判定」与「无解/秩亏的严格证明」两项能力。
    // 只接管 3..6 元且全线性；n<=2、非全线性、或精确通道不可用（无理系数）一律不抢，
    // 自动落到 suan17 ⇒ 零行为变更。
    _op('suan60', '线性系统精确栈(presolve+Markowitz+精确验证)', suan60, 2, 'solve'),
    _op('suan17', '线性方程组高斯消元', suan17, 2, 'solve'),
    _op('suan18', '图论拆分独立子系统', suan18, 2, 'analyze'),
    _op('suan19', '变量显式代入消元', suan19, 3, 'rewrite'),
    // suan59：二元多项式结式消元。置于 suan19 之后 —— 显式代入能降维的先降维，
    // 降不掉的（如 xy=6 与 x+y=5）由结式接管；suan19 已降维时本算子自动不抢。
    _op('suan59', '二元多项式结式消元(闭式完备)', suan59, 2, 'solve'),
    _op('suan20', '单变量多项式有理根枚举', suan20, 3, 'solve'),
    _op('suan21', '欠定系统标记', suan21, 1, 'analyze')
];

// —— 单变量专项层（在欠定判定之后）——

var OPS_ALGEBRA2 = [
    _op('suan50', '多分式通分去分母', suan50, 1, 'rewrite'),
    _op('suan51', '一元多项式快速路径(闭式求根)', suan51, 1, 'prove', false, true),
    _op('suan58', '基本三角方程符号通解', suan58, 1, 'prove', false, true),
    _op('suan55', '导数单调性分段求根', suan55, 1, 'solve'),
    _op('suan22', '单变量超越方程牛顿求解', suan22, 3, 'solve'),
    _op('suan23', '分式有理式变量替换', suan23, 2, 'rewrite'),
    // suan24 收缩依赖数值求根的完备性，若 polynomialAllRoots 漏根则不严格 ⇒ sound=false
    _op('suan24', '多项式全域根收割', suan24, 3, 'contract', true, false),
];

// —— 收缩层【核心】：全部只收窄 D0，按 cost 分层 + 不动点回流 ——

var OPS_CONTRACT = [
    // cost 1 —— 单遍扫描，最便宜，允许层内反复压到不动点
    _op('suan25', '区间算术值域收缩', suan25, 1, 'contract', true, true),
    _op('suan26', '奇偶对称区间压缩(保守)', suan26, 1, 'contract', true, true),
    // cost 2 —— 区间求值一遍
    _op('suan27', 'HC4-Revise 约束收缩', suan27, 2, 'contract', true, true),
    _op('suan28', '约束反演系统化(项一致性)', suan28, 2, 'contract', true, true),
    _op('suan29', '导数单调性剪枝(中值定理)', suan29, 2, 'prove', true, true),
    _op('suan30', '单调性+凸凹性剪枝', suan30, 2, 'prove', true, true),
    // cost 3 —— 逐维 box-consistency
    _op('suan31', 'Box-Consistency BC3', suan31, 3, 'contract', true, true),
    _op('suan32', '成对 2B/3B Box-Consistency', suan32, 3, 'contract', true, true),
    // cost 4 —— 矩阵预条件 / 线性规划
    _op('suan33', 'Hansen-Sengupta 区间 Gauss-Seidel', suan33, 4, 'contract', true, true),
    _op('suan34', 'LP Narrowing(线性松弛+单纯形)', suan34, 4, 'contract', true, true)
];

// —— 几何/拓扑分析层（setup 性质：写 manifoldInfo / startPoints，不收缩域）——

var OPS_GEOMETRY = [
    _op('suan35', '投影反证剪枝', suan35, 4, 'prove', false, true),
    _op('suan36', '雅可比秩引导投影方向', suan36, 3, 'analyze'),
    _op('suan37', '流形类型分类', suan37, 3, 'analyze'),
    _op('suan38', '固定规则均匀采样', suan38, 3, 'sample'),
    _op('suan39', '零空间流形投影校准', suan39, 3, 'sample')
];

// —— 数值求解层 ——

var OPS_NUMERIC = [
    _op('suan40', '线搜索牛顿迭代(Armijo)', suan40, 4, 'solve'),
    _op('suan41', '区间牛顿兜底求精', suan41, 4, 'solve'),
    _op('suan42', '区间解点残差过滤', suan42, 2, 'filter')
];

// —— 后处理层 ——

var OPS_POST = [
    _op('suan43', '解点精度标准化修正', suan43, 1, 'filter'),
    _op('suan44', '全局约束复核校验', suan44, 2, 'filter'),
    _op('suan45', '物理限位边界过滤', suan45, 1, 'filter'),
    _op('suan46', '解集去重合并', suan46, 2, 'filter')
];

// —— 兜底与输出层 ——

var OP_BRANCH = _op('suan47', '分支定界递归二分', suan47, 5, 'search');

var OP_INEQ = _op('suan48', '不等式系统求解', suan48, 4, 'solve');

var OP_OUTPUT = _op('suan49', '收敛判定与结果输出', suan49, 1, 'output');

// 上述 7 个编号从未实现函数体、不在任何调度数组中，仅为历史占位，避免改动其他
// 算子编号引发引用错位。注意：suan36 曾列于此（占位），已于 2026-08-21 落地实现

// —— 盒体积（对数尺度，避免高维乘积溢出）：用于度量收缩进展 ——