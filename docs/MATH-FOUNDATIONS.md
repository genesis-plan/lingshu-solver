# 顶刊已证明数学成果 → 灵数算子创新方案

> 调研时间：2026-10-04 · 方法：WebSearch + WebFetch 查证原文（arXiv 全文 / 期刊开放 PDF / 作者主页）
> 纪律：每条都标注【已证明定理】/【启发式】/【不确定】。**不确定的必须明说不确定。**
> 所有引用均经查证修正，**勘误记录见文末**。

---

## 零、先回答三个问题

### Q1：集合收缩的思想还在吗？

**在，而且是骨架。** 实测证据：

| 证据 | 位置 |
|---|---|
| 12 个收缩算子（`suan25`–`suan34`） | `src/engine/operators/contract.js` 766 行 |
| 收缩轮次与增益被记录 | `meta.contractionRounds` / `meta.contractionGain`（实测 2 元题收缩 1 轮、增益 27.631） |
| 收缩被登记为独立机制 | `meta.operatorsContracted: ["suan25"]` |
| 区间收缩核心算子 | `_iIntersect` / `_contractionChanged` / `_iRoot`（`src/engine/interval/core.js`） |

**但收缩只覆盖了「单方程、单点、区间算术」这一层。**
真正顶刊级的收缩理论——**Schichl–Neumaier 排除域**——目前**没有实现**。

### Q2：目前求解器的思想是什么？

一句话：**先用廉价算子把定义域收紧，再用 Krawczyk 逐点认证存在+唯一，最后靠四道门控声明完备性。**

```
输入 → 算子链（约 60 个 suan*，按 registry 调度）
     → 区间收缩（contract.js）收紧 D0
     → 候选解生成（牛顿 / 结式消元 / 精确线性代数 Bareiss）
     → Krawczyk 认证（certify.js）⇒ proven / candidate 分级
     → 完备性门控（本轮新加，见 §2）
     → fail-closed 输出
```

**方法论定位（实测支撑）**：与 SymPy 的真正差异**不是速度，是「是否给出数学判定」**。
线性题快 28.3×（12/12），二元 177×，三元 ≥3702×，完备性判定 15/15 vs SymPy 0/15。

### Q3：面对没有数值限制，会爆炸吗？

**四道闸门实测兜住了，但本轮查出 1 处真破口并已修。** 数据：

| 场景 | 结果 | 兜住机制 |
|---|---|---|
| 6 元稠密二次（无任何限制） | 8009ms 撞 8 秒预算 → `HARD_TIMEOUT` + `truncated:true` + `confidence:"low"` | 8 秒硬预算 + 显式标注不完整 |
| 7 变量 | fail-closed（返回空，不给假答案） | 变量数硬闸 |
| `sin(x)=0` 无界 | 返回 100 个但 `truncated:true` → **本轮修复后已降级为未验证** | 截断门控 |
| `x^5-10^20*x+1=0` | **Sturm 独立算出 3 根只找到 1 个 → 本轮修复后已降级并报缺 2 个** | Sturm 门控（新增） |
| `x^2+y^2+z^2=1, x+y+z=100` | 0.384ms 严格证无解（区间值域最小 9591 > 0） | 区间算术 |
| 默认域 | `[-1000000, 1000000]`（**不是记忆里的 [-10000,10000]**） | — |

**关键结论**：变量范围硬编码在 `[-1e6, 1e6]`，二分深度上界由预算兜住，**不会内存爆炸也不会无限循环**。
但**「不爆炸」≠「完备」** —— 破口恰恰在这里，本轮修的就是它。

---

## 一、Schichl–Neumaier 排除域（SIAM J. Numer. Anal. 2004）★ 最高优先级

### 1.1 为什么这是你要的「集合收缩」

分支定界求**全部**零点时的致命问题：**子盒里明明没解，却排不掉**（因为零点在盒外不远处），
导致每个零点周围堆出一大堆小盒，**聚簇效应（cluster effect）** 吞掉全部算力。

**原文明确：奇异零点处无任何已知技术能消除聚簇效应** ⇒ 这就是 fail-closed 的理论边界。

### 1.2 排除域的精确公式（Thm 4.3）

设 Krawczyk 收缩二次式 `λ²a − λw + b ≤ 0`，则：

```
判别式 D_j = w_j² − 4·a_j·b_j
  D_j > 0  ⇒ 排除域 = 上根      （此区已证明无根，可丢弃）
             包含域 = 下根      （此区已证明有根）
两者之差 = 被证明为空的「壳」⇒ 整壳可裁掉
```

### 1.3 ★ 关键工程发现：Thm 7.2 的恒成立版本

**Thm 4.3 的判别式 `D = w² − 4ab > 0` 可能失效**（`a_j b_j < 0` 时 D 恒正但无信息量）。

**Thm 7.2 用 `D× = w×² + 4b·a×`（加号）** —— 恒成立，**几乎总可用**。

⇒ **落地做法：排除域用 Thm 7.2 的一般形式（`+`），仅在 `D_j > 0` 成立时用 Thm 4.3 收紧。**

### 1.4 聚簇效应的量化界（原文）

不可消除的盒数 **≥** `V / εⁿ`，其中 `V = Δⁿ / |det F'(x*)|`，`Δ = C·εᵏ`。
- `k = 1`（约束传播）随维数**指数恶化**
- **`k = 2` 是避免聚簇的充要条件**

### 1.5 落地算法骨架（6 变量）

```
for 每个候选根 x*（已 Krawczyk 认证）:
    构造排除域 E(x*)  = Thm7.2 的一般形式
    for 队列里的每个盒 B:
        if B ∩ E(x*) ≠ ∅:
            B 整盒丢弃          ← 聚簇效应消失
        else if B ∩ 包含域 ≠ ∅:
            提升优先级 / 缩小后再判
        else:
            正常分裂
```

**预期收益**：`_globalBranchCertify` 的分裂次数应显著下降；当前 6 元稠密二次撞满 8 秒的路径有望跑完。

### 1.6 ⚠️ 三处存疑（不要依赖）

| 存疑项 | 结论 |
|---|---|
| "BFS 逐次收缩定理（Branin–Freddman–Smith）" | **极可能不存在**。Branin 1972 真实存在但属连续化/动力系统，其全局收敛性已被证有缺陷、两个猜想被 Zufiria 等证伪 |
| "Neumaier ε-inflation 排除域精化" | Schichl–Neumaier 原文中**不存在**。ε-inflation 出处是 Mayer 1998，但不属于排除域理论。论文所谓「显著放大排除域的精化」就是 Thm 4.3/5.1/7.2 本身 |
| "逆不变量 + Bernstein 矩阵"作排除域工具 | 未找到权威定理出处，**不建议在完备性关键路径上依赖** |

### 1.7 Kantovich vs Krawczyk（一个可立即用的结论）

**Shen–Neumaier Cor 3.3 严格证明：Kantorovich 是 Krawczyk + 斜语的特例。**

⇒ **永远优先 Krawczyk**：条件更易验证（只需近似逆而非斜率）、界更紧。

强度链：`Kantorovich ⟹ 广义 Miranda ⟹ Borsuk`（**反向不成立**）。
⚠️ **Miranda 只给存在性、不给唯一性** —— 这是它在完备性场景的致命弱点，**不要用它替代 Krawczyk 做唯一性声明**。

---

## 二、本轮已落地：完备性 fail-closed 修复（真 bug）

### 2.1 破口

`_assignCompleteness` 里 `provenIsComplete: true` 是**硬编码常量，无任何门控**。

实测 `x^5-10^20*x+1=0`：Sturm 独立算出域内 **3 个实根**，只找到 1 个，
`sturmIncomplete={realRootRoots:3, found:1, missing:2}` 已写进 result —— **但没有任何下游消费它**。

> **根因不是 Sturm 不算数，而是「算了不等于用」。**
> 全仓库 `grep sturmIncomplete` 只有 2 处命中：写入点 1 处 + 死字段 1 处，**零消费点**。
> 一个「已算出但没人读」的字段是负债，不是保护。

同时 `2^x+x^2-100=0` 返回 2 个 `certified:false` 的 candidate，也报 `complete:true`
—— **Krawczyk 只能证明「候选点附近根唯一」，无法证明「没有别的根」**。

### 2.2 修法：四道门控（都先 grep 核实字段真实存在）

| 门控 | 条件 | 依据 |
|---|---|---|
| ① Sturm 独立计数 | `sturmIncomplete.missing > 0` | 已算出的独立证据 |
| ② 无认证候选解 | `candidateCount > 0` 且无 Sturm/单调分段完备性证据 | Krawczyk 的逻辑边界 |
| ③ 截断 | `truncated === true` | 资源耗尽即不完整 |
| ④ 精确计数 > 返回数 | `exactCount > solutions.length` | resultant.js 的截断路径 |

任一命中 ⇒ `provenIsComplete: false` + `incompleteReasons[]` + `warnings[]` + 顶层 `missingRealRootCount`。

**顺带把独立计数透传到顶层**（`expectedRealRootCount` / `missingRealRootCount`）——
凡是「已算出但没被消费」的字段都要提到顶层，否则下一个人还会踩。

### 2.3 ⚠️ 过程中我自己犯的一个错

第一版门控里我写了 `state.result.displayCapped === true` —— **这个字段不存在，是我凭记忆编的**。

> **教训：门控字段必须先 `grep` 核实存在。**
> 凭记忆写门控 = 造一条永不触发的假保护，**比没有保护更危险**（给人虚假安全感）。
> 真实字段是 `truncated` 和 `exactCount`。

### 2.4 实测修复效果

```
x^5-10^20*x+1=0
  provenCount      = 1
  expectedRealRoot = 3        ← 新增
  missingRealRoot  = 2        ← 新增
  provenIsComplete = false    ← 修复前是 true（谎报）
  incompleteReasons= ["Sturm 独立计数证明域内共 3 个实根，本次仅找到 1 个，缺 2 个"]

sin(x)=0
  provenIsComplete = false    ← 修复前是 true
  reasons = ["计算被资源上限中止，结果不完整（truncated）"]

x^2-2=0 / x-cos(x)=0 / 二元10题 / 6元线性   → 仍 complete:true（无回归）
```

golden 基线同步：20 用例 `pass=20 fail=0`（**解数一个没变**，漂移的只是新契约字段）。

### 2.5 顺带修掉的另一个真 bug：二分边界根丢失（与完备性无关）

**现象**：一元 `x^2−1=0` 在 `[-2,2]` 上返回 **0 解**（应 2 解 ±1），残 4 盒。
开关排除域都一样 ⇒ **与排除域无关**，是 `_globalBranchCertify` 的既有缺陷。

**根因**：`x=±1` 恰好落在盒的**分割边界**上，被切成 `[−1.03125,−1]` 与 `[−1,−0.99994]`。
Krawczyk 判 `certified=false`（根在盒端点，`iVecInterior` 的严格内部判定失败），
于是继续细分到 `minWidth=1e-4` 停下 → 残盒 → 0 解。
但同一式中 `[-1.5,−0.5]` 的中点正好是 −1 时，Krawczyk 给 `certified=true`。

**修法**：细分前先看**中点本身是否已是解**（残差 ≤ 1e-12），是则记解。
残差 ≤ 1e-12 是精确代数事实（`F(x̂)=0`），不依赖任何不完备假设 ⇒ sound。

**⚠️ 修法本身的坑（第一版写错了）**：写成「中点命中就 `continue`」——
`x^5−5x^3+4x` 在 `[-3,3]` 上首盒中点恰是根 0，直接 `continue` 丢掉整个盒内的 ±1、±2，
**实测从 4 解退化成 1 解**。
> **中点命中只能「记下这个解」，绝不能终止该盒的搜索 —— 盒里可能有别的根。**
> 同时 `iVecDisjoint`（严格无解剪枝）在中点命中时也必须跳过：它说「无解」而中点已被证明是解 ⇒ 矛盾。

**修后实测**：

| 题 | 修前 | 修后 |
|---|---|---|
| `x^2−1=0` | 0 解 / 残 4 | **2 解（±1）** |
| `x^5−5x^3+4x=0` | — | **5 解（0,±1,±2）** |
| `x^2=y^2=u^2=v^2=1` | 0 解 | **16 解** |

⚠️ 残盒仍不为 0（根同时是两个相邻盒的端点，两侧薄盒必然进残盒）——
这是 fail-closed 的**正确**表现（宁可留残盒也不谎报完备），故测试只断言解数，不断言残盒为 0。

### 2.6 文档 bug：`completeness.scope` 与实际域不符

原代码硬写 `scope: '...声明定义域[-10000,10000]...'`，而 `_domBoxOf` 的实测默认域是
`[-1e6, 1e6]`（**差 100 倍**）。写死的 scope 会让 Agent 按错误的域判断完备性。
已改为**从实际域动态生成**（遍历 `state._initD0` 输出 `x∈[lo,hi]`），绝不写死数值。
> 教训与 §2.3 同源：**凭记忆写死的事实性常量 = 定时炸弹**。要么动态取，要么 grep 实测。

---

## 三、防爆炸：根数上界的分层防御（防爆炸专用）

### 3.1 分层表（严格 vs 经验，逐层标注）

| 层 | 界 | 公式 | 严格? | n≤6 可编码? |
|---|---|---|---|---|
| L0 | Sturm 精确计数 | 序列符号变化 | ✅定理 | ✅（已有） |
| L1 | **BKK 混合体积** | `MV(P₁,…,P_n)`，系数一般时**取等** | ✅定理 | ✅（Mayer–Sturmfels / Chen unmixing） |
| L2 | **多齐次 Bézout** | `Σ_k (Π_j k_j!) · perm(D·k₁…k_r)` | ✅定理 | ✅（永久式可算；**最优分组 NP-hard** ⇒ 用贪心/穷举，n≤6 分组数很少） |
| L3 | Bézout | `Π d_i` | ✅定理 | ✅ |
| L3' | **超定子集 min** | `min_{|S|=n} Π_{i∈S} d_i` | ✅定理 | ✅（C(20,6)=38760 可枚举） |
| L4 | Fujiwara 根界 | `2·max_i \|a_{n-i}/a_n\|^{1/i}` | ✅定理 | ✅ |
| L5 | Landau–Mignotte | `2^deg·‖f‖₁` | ✅定理 | ✅（**是因子分离保证，不是根数界，别混用**） |
| L6 | Bihan–Sottile 正实解 | `(e²+3)/4 · 2^{C(k,2)} n^k` | ✅定理 | ✅ |
| L7 | Khovanskii | `2^{C(t-1,2)}(n+1)^{t-1}` | ✅定理 | ⚠️ **仅理论，n=6,t=13 时约 10³⁰，编码无意义** |
| L8 | OPTM / Milnor | `d(2d−1)^{n-1}` | ✅定理 | ✅（**正维/退化时用，n=6,d=2 时 486 比 Bézout 的 64 还差 7.6 倍**） |
| — | 「MV > 10⁵ 就拒绝」 | — | ❌**经验** | ✅ |
| — | 「优先解对角部分」 | — | ❌**渐近 on-average** | ⚠️ 不保证每实例 |

### 3.2 n≤6 的 Bézout 数值表（`Π d_i`，d 全等）

| 次数 d | n=2 | n=3 | n=4 | n=5 | **n=6** |
|---|---|---|---|---|---|
| 2 | 4 | 8 | 16 | 32 | **64** |
| 3 | 9 | 27 | 81 | 243 | **729** |
| 4 | 16 | 64 | 256 | 1024 | **4096** |
| 5 | 25 | 125 | 625 | 3125 | **15625** |
| 8 | 64 | 512 | 4096 | 32768 | **262144** |
| 10 | 100 | 1000 | 10000 | 100000 | **1000000** |

**工程判断**：d≤5 轻松；d=6–8 尚可；**d≥10 应拒绝或改用稀疏方法**。

### 3.3 稀疏收紧：多元 Descartes（Bihan–Dickenstein / Bihan–Dickenstein–Forsgård）

**为什么对 6 变量特别重要**：
`Π d_i` 随支撑中的**指数落差**增长；Descartes 系稀疏界**对指数落差完全不敏感**。

实测差距示例（`n=6`，支撑含 `2e_1`）：`Π d_i = 32` vs Descartes 界 `= 7`（**4.6×**）。
把指数落差放大到 10⁶ 量级，比值就是 10⁶ 量级。**这才是「防爆炸」的实质含义。**

**主定理（BDF 2021, Math. Ann. 381:1283–1307, Thm 2.4）**：

```
b_j    = (-1)^j · det A(j)                      [8×8 行列式，O(n³)]
λ_ℓ    = Σ_{j∈K_σℓ} b_j                         [同射线分组聚合]
μ_ℓ    = λ_0 + λ_1 + … + λ_ℓ                    [部分和]
bound  = 1 + sgnvar(μ_0, …, μ_{k-1})            [sgnvar = 符号变化数]
且 bound ≤ k ≤ n+2，k = n+2 当且仅当 C uniform
```

**比旧版更好的地方**：BD2017 用 `max{...}`，BDF 2021 改成 `min{...}` —— **从「取最大」变「取最小」是结构性改进**。

**"Optimal" 的含义（Thm 3.4）**：对**任意** circuit 支撑 `A` 和**任意** strict ordering，**存在**秩 n 的 `C` 使解数**恰等于**该界 ⇒ **逐点最优**。

**奇偶性剪枝（Prop 2.14）**：`1+sgnvar(μ) ≡ n_A(C) (mod 2)`，且原文明确
> "n_A(C) > 0 if sgnvar(μ) is even"

⇒ 界为奇数时，根数只能取 `{1, 3, …, 界}`，**立即排除「界内偶数个根」整类分支**。

**超高收益特判（BD2017 Cor 3.4）**：支撑 = simplex 全体顶点 + 任一内点（signature `{1,n+1}`）⇒
**正实解数 ≤ 2**（稀疏体积界是 n+1）。**全维数统一结果，强烈建议做特判。**

**circuit 的根数 ≤ n+1（Bihan 2007, JLMS 75(1):116–132）**，且可达。

### 3.4 离散混合体积（Bihan 2016, DCG 55(4):907–933）

```
D(W₁,…,W_r) = Σ_{I⊆[r]} (−1)^{r−|I|} · |Σ_{i∈I} W_i|      [集合 Minkowski 和的基数]
Thm 4.15（非负性）：D ≥ 0
Thm 1.4（Kouchnirenko）：D ≤ Π_i (|W_i| − 1)
```

- n≤6 时**完全可枚举**，是 Kouchnirenko 数的**严格更好且仍可计算**的下界
- `|W_i| = 2`（双线性）时 `D ∈ {0,1}` ⇒ **精确判定「该双线性系统在正象限是否有解」**
- ⚠️ 失效：Thm 4.15 的非负性**只对 (4.1) 这种结构化集合族成立**，任意指定 `W_I` 可为负

### 3.5 正性约束的锐界（并纠正一个流传错误）

| 结果 | 公式 | 常数 |
|---|---|---|
| Bihan–Sottile 2007（**正**实解） | `< (e²+3)/4 · 2^{C(k,2)} · n^k` | `(e²+3)/4 ≈ 2.597` |
| Bates–Bihan–Sottile 2007（**非零**实解，奇指数子群） | `< (e⁴+3)/4 · 2^{C(k,2)} · n^k` | `(e⁴+3)/4 ≈ 14.40` |

**正确比值 = `(e⁴+3)/(e²+3) ≈ 5.543`，不是 4.4。**
（出处是 Bates–Bihan–Sottile 2007，不是 Bihan–Sottile 2007。）

**真正的意义**：naive 做法把正交象限界乘以象限数 `2ⁿ`（**随 n 指数增长**）；
BBS 把它换成**常数 ≈ 5.543** ⇒ **n 不出现在指数上**，且 k 固定、n 大时渐近 sharp。

**二变量三项式的唯一完全解决特例**：Li–Rojas–Wang 2003 ⇒ **正实解 ≤ 5**（锐）。
⚠️ Sturmfels 2005 v1 稿曾写「至多 20」—— **那是过时且错误的**，2003 年后已改为 5。

### 3.6 单变量：Sturm vs Descartes vs VAS（结论反直觉）

| | Sturm | Descartes / Vincent / VAS |
|---|---|---|
| 输出 | **精确计数** | **上界**（`var ∈ {0,1}` 时才是精确） |
| 多次根 | 需先 `p/gcd(p,p')` 取平方自由部分 | Vincent/VAS 直接假设无重根 |
| 底层数学 | 互插 + Sturm 序列符号恒定性 | Möbius 变换 + Wronskian 符号 |

**结论 1**：「区间内精确根计数」**没有比 Sturm 更快的已证明通用方法**。要精确计数，Sturm 仍是唯一有确定答案的。

**结论 2（反直觉但已证明）**：**Sturm 在最坏与期望复杂度上都不占优**。
arXiv:2506.04436 原文：

> "In practice, **sturm is rarely used**. It is slower than descartes by **several orders of magnitude**, almost always."

| | 最坏情况 | 期望（均匀随机） |
|---|---|---|
| Descartes | `Õ_B(d⁴τ²)` | **`Õ_B(d² + dτ)`** |
| Sturm | `Õ_B(d⁴τ²)` | `Õ_B(d²τ)` |

若 `d ~ τ` ⇒ `Θ(d²)` vs `Θ(d³)`，**差约 d 倍**。
Sturm 侧摊还界：`O(dL + d·lg d)` 次探针，总复杂度 `Õ(d³L)`（Du–Sharma–Yap 2007）。

**决策规则**：
- 要**精确**区间计数 ⇒ Sturm（唯一）
- 只需判「是 0 个 / 恰 1 个」⇒ Descartes/Vincent（`var∈{0,1}` 是**充要**判定）
- 高次隔离（d≥10³）⇒ Descartes/VAS（Mathematica/Sage/SymPy 默认）
- CAD / 量词消元 / 实闭域基础 ⇒ Sturm 不可替代

**唯一有「每步固定比例收缩」严格保证的**：VCA/VAG 二分，**|I_k| = (B−A)/2^k**（**恒等式，非估计**），需 `k > log₂((B−A)/ε)` 步。
⚠️ **VAS 没有统一的每步几何收缩率**（区间在 Möbius 变换下长度不按固定比例缩小）——**未找到严格定界，标为不确定**。

**Vincent–Alesina–Galuzzi 定理**：若 `p` 无重根，则存在 `δ = δ(p) > 0`，使 `|b−a| < δ` 时
`var_ab(p) = 1 ⟺ p 在 (a,b) 中恰有一个根` ⇒ **充要判定**。
⚠️ **`δ` 只有存在性证明，未找到可计算的显式值**。

---

## 四、算子创新方案（按「已证明 + 高收益 + 可编码」排序）

### ★★★ 创新 1：Krawczyk 排除域算子 —— ✅ 已落地（2026-10-04）

**顶刊依据**：Schichl & Neumaier, *SIAM J. Numer. Anal.* 42(1):383–408, 2004
（DOI `10.1137/S0036142902418898`；⚠ 不是 Sci. Comput. 24(2):383–412, 2002 —— 那是 Kearfott 1997 的经验评估论文）
**解决什么**：聚簇效应 —— 分支定界的主要算力黑洞
**落点**：`src/engine/certify.js` 的 `_exclusionRegion` / `_secondPartialAbs` / `_precondAt`，
集成在 `_globalBranchCertify` 的**细分前**（`suan35-exclude`）

#### 实测收益（A/B 对照，同一题只切换 `exclusion` 开关）

| 题 | 盒数（关） | 盒数（开） | 削减 | 解数 | 完备性 |
|---|---|---|---|---|---|
| `x^2=4, y^2=9` | 105282 | **23** | **−99.98%** | 4/4 ✅ | 残盒 0 |
| `xy=6, x+y=5` | 119354 | **112** | **−99.91%** | 2/2 ✅ | — |
| `x^2+y^2=13, xy=6` | 90956 | **195** | **−99.79%** | 4/4 ✅ | — |
| `x^3=8, y^2=3` | 94578 | **15** | **−99.98%** | 2/2 ✅ | — |
| `x^2=y^2=u^2=v^2=1` | 38167 | **8191** | **−78.5%** | 16/16 ✅ | — |
| `x^5−1e20x+1`（域内 3 根） | 163 | **131** | −19.6% | 2/2 ✅ | 残 2（诚实留痕） |

**SOUNDNESS 违反数 = 0**（排除域未改变任何一题的解数，硬断言在 `test/test-exclusion.mjs` 第 2 节）

#### 🔴 三条踩坑记录（这一节的价值主要在这里）

**① 排除域必须建在【非零点】上 —— 建在零点上等于没用**

第一版把排除域挂在「Krawczyk 认证成功之后」，结果 `excludedByRegion` **恒为 0**、一点收益都没有。
根因：`b_i = |C·F(z)|_i`，在**精确零点**上 `F(z)=0 ⇒ b=0 ⇒ λ×=0 ⇒ 排除域退化为点` ⇒ 直接返回 null。
**这是论文的已知性质**（Ex 8.1/8.2/8.4 全命中此情形），不是 bug —— 是「在零点处建排除域」这个用法本身没用。
论文 §7 的原意是：任取**试探点** `z` 都能建排除域，用来剪掉 `z` 周围的大片无根区。
现版改在**分裂点（盒中点）**建域 —— 中点一般不是零点，`F(x̂)≠0` 才有 `b>0`。
⇒ 剪枝量从 0 跳到 99.8%。

**② 完备性判据必须因排除域降级（fail-closed 红线）**

原判据 `complete = (residualBoxes.length === 0)` 把「被排除域剪掉的盒」当成已证明无根。
实测：圆与直线 `x^2+y^2=25, x−y=1` ⇒ 81 盒 / 排除 46 / 残 0 ⇒ **旧判据报 `complete=true`（错，实际 0 解）**。

> **勘误（2026-10-04 复核）**：上面「实际 0 解」是**过期结论**，已被后续修复推翻。
> 当时 `solve()` 传的是对象 `{equations:[...], domain:{...}}`（正确签名是方程字符串数组），
> 引擎返回 `NO_EQUATION` 被我误读成「0 解」。用正确调用
> `S.solve(['x^2+y^2-25=0','x-y-1=0'])` 实测返回 `[[4,3],[-3,-4]]` —— 正是圆与直线的两个交点。
> ⇒ 排除域机制本身没问题，问题在**调用方式**。保留此条是为了防止同一误读再犯。
依据：论文第 7 页原文 —— *"For singular (and hence for sufficiently ill-conditioned) zeros,
the argument does not apply, and no technique is known to remove the cluster effect in this case."*
即病态/奇异零点处排除域**必然失效**。
现版：`complete = (residualBoxes.length === 0) && exclCount === 0`，
并新增 `exclPrunedCount` / `exclPrunedSample` / `incompleteBecause` 让剪掉的盒**可归因、不凭空消失**。

**③ 顺带修掉一个与排除域无关的既有真 bug：边界根丢失**

现象：`x^2−1=0` 在 `[-2,2]` 返回 **0 解**（应 2 解 ±1），残 4 盒。开关排除域都一样。
根因：`x=±1` 恰在盒的**分割边界**上，被切成 `[−1.03125,−1]` 与 `[−1,−0.99994]`；
Krawczyk 判 `certified=false`（根在盒端点，`iVecInterior` 的严格内部判定失败）→ 细分到 `minWidth` 停下 → 残盒。
同一式中 `[-1.5,−0.5]` 的中点正好是 −1 时 Krawczyk 给 `certified=true`。
修法：细分前先看**中点是否已是解**（残差 ≤ 1e-12），是则记解。
⚠️ **第一版修法写错**：写成「中点命中就 `continue`」—— `x^5−5x^3+4x` 在 `[-3,3]` 上首盒中点恰是根 0，
直接 `continue` 丢掉整个盒内的 ±1、±2，退化成 1 解（实测 4 解→1 解）。
**中点命中只能记解，绝不能终止该盒的搜索** —— 盒里可能有别的根。
修好后：`x^2=1 ⇒ 2 解` / `x^5−5x^3+4x ⇒ 5 解` / `x^2=y^2=u^2=v^2=1 ⇒ 16 解`。

#### 论文的 4 处印刷错误（本实现的修正，测试第 1 节是护栏）

| # | 位置 | 印刷 | 正确 | 证据 |
|---|---|---|---|---|
| ① | 式(49) `λ×ᵢ` | `bᵢ/(w×ᵢ+√D×ᵢ)` | **`2bᵢ/(w×ᵢ+√D×ᵢ)`** | Ex 8.3 印 `λ×=0.277656`；印刷式算得 0.138828（正好一半），修正式逐位吻合。照抄印刷式 ⇒ 排除域半径**白白小一半** |
| ② | 式(51) | `[z−λ×v, z+λ×]` | `[z−λ×v, z+λ×v]` | 右端漏 `v`，与式(50) 不一致 |
| ③ | Ex 8.1 分段式 | 分子 `30` | `20` | 两分支在 `v₂=1` 处不连续 |
| ④ | Ex 8.2 `B₁` | `⅙[[1,0],[2,0]]` | `[[0.5,0],[0,0]]` | 印本给 `λᵉ=0.667` 与式(54) 的 `λᵉ=1` 矛盾 |

#### 降级开关

`opts.exclusion === false` 完全关闭排除域剪枝（A/B 对照 + 运行期降级口，走 `state.solveOpts`）。

### ★★★ 创新 2：稀疏感知分支定界（`suan36-bkk`）

**顶刊依据**：BKK 定理（Mayer–Sturmfels, Math. Comp. 71:1507–1516, 2002；Chen unmixing, DCG 61(3), 2019）
**解决什么**：稀疏系统被当稠密做 → 路径数虚高
**落点**：`algebra/multivar.js` 进入分支定界前
**收益**：n=6、支撑 13 个单项式时 BKK 常为几十，`Π d_i` 却是 46656 ⇒ **~1000×**
**风险**：中。精确 MV 是 #P-hard，但 n≤6 毫秒–秒级；可退化为多齐次 Bézout（永久式，可编码）

### ★★ 创新 3：circuit 特判（`suan37-circuit`）

**顶刊依据**：Bihan–Dickenstein IMRN 2017 Cor 3.4（signature `{1,n+1}` ⇒ 正实解 ≤ 2）；Bihan JLMS 2007（≤ n+1）
**解决什么**：形如「和/和平方/积」的对称系统 —— **灵数最擅长的题型恰好命中这里**
**落点**：`recognize.js` 识别对称结构后直接给出**精确上界**
**收益**：D1/D2 类丢番题型从「跑出来才知道几个解」变成「先证明最多 2 个」⇒ **完备性可直接证明，无需搜索**
**风险**：低。签名计算是 `O(n²)` 行列式

### ★★ 创新 4：Sturm 计数 → 二分收缩的零成本替换

**顶刊依据**：arXiv:2506.04436（Sturm 比 Descartes 慢几个数量级）；Sturm 摊还 `O(dL+d·lg d)`
**解决什么**：高次单变量隔离速度
**落点**：`numeric/linear.js` 的 `_sturmCountAsc` 旁边
**收益**：d≥10 时数量级提升
**风险**：中。需正确实现 Möbius 变换 + 符号变化

### ★ 创新 5：超定子集 min 上界

**顶刊依据**：`min_{|S|=n} Π_{i∈S} d_i`（Bézout 在子集上成立 ⇒ 对全系统成立，因 `Z(S) ⊇ Z(F)`）
**解决什么**：`m > n` 超定场景 —— 这是 BKK/Bézout 的**理论空白区**
**落点**：`algebra/exact.js` 判定不相容前
**收益**：把「Bézout 不适用」变成「取子集 min，仍是严格上界」
**风险**：低。纯组合枚举，C(20,6)=38760

### ★ 创新 6：Fujiwara 界作为「何时放弃暴力」判据

**顶刊依据**：Fujiwara 界（+ Landau–Mignotte, Math. Comp. 28:1153–1157, 1974）
**解决什么**：整根问题中，d=100 且根界 10⁶ ⇒ 枚举不可能 ⇒ 提前 fail-closed 而非撞预算
**落点**：`numeric/polynomial.js`
**风险**：低。一行公式

---

## 五、勘误记录（我查证时发现的错误引用）

| # | 常见/我引用的 | 查证结论 |
|---|---|---|
| 1 | Schichl–Neumaier 载于 *SIAM J. Sci. Comput.* 24(2):383–412, 2002 | ❌ **应为 *SIAM J. Numer. Anal.* 42(1):383–408, 2004**，DOI `10.1137/S0036142902418898`。那个卷期位置属于 Kearfott 1997 的**经验评估**论文，勿混用 |
| 2 | Henrici–Oliveira 界 `2^{n(n−1)/2}(n+1)^{n−1}` | ❌ **未能查证**（5 组检索 + 2 篇权威综述定向确认）。该式型实为 **Khovanskii** 界的参数化写法（Sturmfels, Amer. Math. Monthly 105(10):907–922, 1998, Thm 3.3） |
| 3 | Chistov 根数上界 | ❌ **未找到**。检索到的 Chistov (2011/2012) 是**算法复杂度界**，非根数上界 |
| 4 | Avendaño–Bihan–Dickenstein, *Found. Comput. Math.* 2016 两篇 | ❌ **不存在**（逐一核对该刊 vol.16 全部目录）。实际是 **Bihan 单作者**, DCG 55(4):907–933, 2016 |
| 5 | "非零实解界比正实解界差 **4.4 倍**" | ❌ 正确是 **`(e⁴+3)/(e²+3) ≈ 5.543`**，且出自 **Bates–Bihan–Sottile 2007**（非 Bihan–Sottile 2007） |
| 6 | "BFS 逐次收缩定理" | ❌ **极可能不存在**。Branin 1972 的全局收敛性已被证有缺陷、两个猜想被 Zufiria 等证伪 |
| 7 | "Neumaier ε-inflation 排除域精化" | ❌ Schichl–Neumaier 原文中不存在 |
| 8 | "Kushnirenko 界 `n!·vol(Δ_A)` = 格点数" | ❌ **该等号不是无条件恒等式**，需回查原文 |
| 9 | "系统对称 ⇒ 锐界 = 重数" | ❌ 字面不成立。对称使解成**轨道**出现（orbit-stabilizer），不减少重数 |
| 10 | "Strzeboński 的常数 16" | ⚠️ 原文明确写 "determined experimentally"，**不是定理** |
| 11 | Sturm 界在随机输入上 ≈ `2^10`–`2^20` | ⚠️ 原研究报告的是**朴素实现的界**，不是最优实现的界，勿混用 |
| 12 | Vincent–Alesina–Galuzzi 的 `δ` 可计算 | ⚠️ **只有存在性证明，未找到可计算显式值** |
| 13 | Khovanskii 界的三个参数化变体 | ⚠️ 文献流通 `2^{C(t-1,2)}(n+1)^{t-1}`（原始）、`2^{C(t,2)}(d+1)^t`（Sturmfels，更弱）、`2^{C(ℓ+n,2)}(n+1)^{ℓ+n}`（=原始式）。**t=4,n=2 时分别 216 与 5184，差 24 倍** ⇒ 引用具体数字必须写明「t=单项式数, n=变量数」 |
| 14 | 「OPT/Milnor 比 Bézout 更紧」 | ❌ **不一定**。n=6,d=2 时 OPTM = 486，而 Bézout = 64 ⇒ **反而差 7.6 倍**。OPTM 只在**正维/退化**（Bézout 失效）时有用 |
| 15 | BDF 原文 `k ≤ n+1` | ⚠️ 与上下文（`k ≤ n+2`、后文用 `k=n+2`）矛盾，**判定为排印错误**，按 `k ≤ n+2` 使用（未核对印刷版 PDF） |

---

## 五·bis、三条「宁可少给不可给错」的机制（2026-10-04 落地）

本节三处改动都不是完备性证明，而是**输出契约的诚实性**。用户已明确
「认证不是重点」，但「数学正确性」是重点 —— 而正确性的真实威胁不是精度，
是**静默地说谎**。

### 5·bis.1 最终残差闸门（`_finalResidualGate`）

**事故**：`120000·p·(1+p)^360 = 2500000`，`p ∈ [−2.5e9, 2.5e9]`
返回 **9650 个解**，其中 **9468 个自报 `residual: 0`**。

独立回代揭穿：`p = ±1.25e9` 处 `(1+p)^360` 溢出成 `±Infinity`，
而 `Infinity − 2500000 = Infinity`。**溢出被当成了零残差。**

为什么会漏过：伪解的残差是在**子 state**（窄域，不溢出）里算的，
回到父 state 后这个 `residual=0` 被原样继承。前两道过滤用
已收窄的 `D0` + 可能被改写的 AST，对着子域是对的 ⇒ 全部漏过。

**闸门判据**（三道，与前两道都不同）：
1. 用 `state.equationStrs` **原始字符串**重新解析，不复用任何可能被改写的 AST；
2. 直接取 `evalAST` 的**值**，而非相减后的残差 ——
   `Infinity − Infinity = NaN`，而 `NaN` 与 0 比较恒为 `false`，
   在下游极易被「当作已通过」；
3. 阈值用**后向稳定残差**：`|f(x)| ≤ τ·Σ|terms|`，τ = 1e-11。

**第 3 条的由来（踩坑记录）**：初版阈值写的是 `max(1e-6, |rhs|·1e-7)`，
其中 `|rhs|` 取「等号右端的常数」。但 `expr = 0` 是方程的**标准写法** ⇒
右端恒为 0 ⇒ **容差恒等于 1e-6**。实测后果：`x² − 1e13 = 0` 的两个真根
（±3162277.66）被当伪解杀掉 —— 因为 `x = 3162277.6601683795` 时
`x²` 的双精度舍入误差本身就是 `0.001953125`。

> **教训**：双精度求值误差上界是 `eps·Σ|terms|`（Higham 标准结论）。
> 所以「残差真的是 0」这件事**没有绝对阈值可判** ——
> 用固定 `1e-6` 判残差，在大系数问题上**等价于把所有解都判成伪解**。

`Σ|terms|` 由 `evalASTScale`（`ast/basic.js`）估计，`^` 走 `|a|^|b|`、
`*` 走乘积、`/` 走保守的和。函数节点**刻意不计入** ⇒ 含 `sin/exp/log`
的表达式拿到偏小的尺度、更严的容差（fail-closed 方向）。

**闸门位置比闸门逻辑更关键**：第一版放在 `_filterIllDefined` 旁边，
一个伪解都没拦住 —— 因为 `_mergeGlobalBranch` 在那之后又塞了一批解。
必须放在**所有写入路径的最后一个**之后。

实测：9650 → **1 个真解** `p = 0.01955308479666175`。

### 5·bis.2 截断传播：超时不能谎报 `NO_SOLUTION`

**事故**：6 元稠密二次跑满 7910ms，`suan47` 因时间闸门置
`state.truncated = true`，但对外返回 `{error: "NO_SOLUTION", truncated: undefined}`。

根因是 `state.truncated` 与 `state.result` **两条互不相通的通道**：
- `branch.js` 递归只搬了 `unconverged`，**没搬 `truncated`**；
- `suan49` 构造 `state.result` 时只写自己知道的字段，根本不读 `state.truncated`；
- 全仓 **26 处**写 `error: "NO_SOLUTION"` —— 逐个加判据必然漏网。

**为什么是 P0**：Agent 拿到 `NO_SOLUTION` 会直接向用户断言「这系统无解」，
而真相是「没算完」。0 解至少还带着「可能还有」的语气，谎报则是笃定。

**修法**：`branch.js` 补 `truncated` 传播 + `_finish` 尾部**单一收口**
（保证以后新增算子也不会漏）。收口做四件事：
`error` 由 `NO_SOLUTION` 降级为 `TIMEOUT_TRUNCATED`、`provenEmpty` 显式撤销、
写 `mustNotClaim: 'no_solution'`、注入结构化 `nextAction`。

> **教训**：字段有两条通道（`state.x` 与 `state.result.x`）时，
> **递归边界和收尾处各要同步一次**。分散修补必有漏网，单一收口点才是可靠解。
>
> 同理：`unconverged`（没收敛）与 `truncated`（因预算主动放弃）语义不同，
> 只有后者能支撑「不许断言无解」。二者恰好同源触发，
> 所以历史上一直以为搬 `unconverged` 就够了。

### 5·bis.3 分支定界止损：方阵 + 小域 ⇒ 放弃指数递归

**实测**：6 元稠密二次 8036ms / 0 解，时间**全烧在 `suan47` 的递归里**
（`suan47` 独占 6698ms，32 次 `solve()` 递归调用）。缩窄定义域**无效**
（窄域 [0,3] 仍 7899ms）—— 瓶颈是**维数**不是域宽。

**止损判据**：方阵（`#eq == #vars`）且最大盒宽 ≤ `1e3` ⇒ 置 `truncated` 并返回。

**数学依据**（两条，分开看）：
- **找根**：多起点阻尼牛顿在窄盒子里从任意起点都能收敛（局部二次收敛，
  与域宽无关）。`suan47_tryNewton` 已试过、没找到 ⇒ 再分支 1000 次也找不到。
- **证无解**：需要在整个 D0 上**穷尽**。但 `[−W, W]^n` 在 6 位小数网格下
  的点数是 `(2W/1e-6)^n`；W=1000、n=4 时是 `2×10²⁸` 个点 ——
  不可能穷尽 ⇒ 分支定界在这类尺度上**永远给不出「已证无解」**，
  只会烧光预算。

阈值 `1e3` 与 movability 模块的 `convergence_hopeless` 口径一致。

**硬门槛 `n ≥ 2`**：1 维上二分**不指数**（每层只多 2 个子问题，10 层封顶 1024），
且单变量走 `suan51`/`suan20` 专用路径 —— 漏了这个门槛会掐断
`x² − 1e13` 这类一元题的补充路径（实测踩过，`g013-rational-loan` 从 1 解变 0 解）。

实测：`suan47` **6698ms → 9.8ms（684 倍）**；6 元二次总耗时 7880ms → 1209ms。

### 5·bis.4 三处时间阈值必须同源

之前有三个独立阈值，且**不同源**：

| 位置 | 旧值 | 问题 |
|---|---|---|
| `scheduler.js` 硬闸门 | 8000ms | 只在算子执行**前**检查 ⇒ 对「suan47 内部跑 6.7 秒」完全管不了 |
| `branch.js` 看门狗 | **10000ms** | **10000 > 8000 ⇒ 永远等不到，是死代码** |
| `branch.js` 递归入口 | 无 | 子树之间不查 ⇒ 第一个子树吃光预算后第二个仍照跑 |

现在统一到 `_LS_BRANCH_TIME_BUDGET_MS`（8000，留 150ms 收尾余量），
且闸门下推到**递归调用点**与**两个子树之间**。

> **教训**：**内层保护阈值必须 ≤ 外层硬闸门，否则内层等于没写。**
> 两处各写一个数字必然漂移，而漂移的方向恰好是「看起来有保护、实际没有」。

---

## 五·ter、后向稳定残差：一个根因、三处症状（2026-10-04 落地）

> 本节是本轮**唯一一个根因牵出三处 P0** 的案例，也是全项目最重要的一条数学事实。
> 三个症状分处三个文件、修法各不相同，但**病根是同一句话**。

### 0. 事实：绝对残差阈值在大系数题上数学上不可达

**定理（Higham 2002《Accuracy and Stability of Numerical Algorithms》SIAM 第 2 版 §3.1）**：
`p(x) = Σᵢ aᵢxⁱ` 用 Horner 递推在 IEEE 双精度下求值，舍入误差满足

```
|p̂(x) − p(x)| ≤ γ_n · Σᵢ |aᵢ xⁱ|,    γ_n = n·u/(1−nu) ≈ n·eps
```

关键点：**误差上界与「各项本身的量级」成正比，不是与首项系数成正比。**

**推论（工程上必须照做）**：「`|p(r)| < 某个固定小阈值`」这种判据，在系数大的多项式上**在双精度下根本达不到**，
无论牛顿迭代多准。所以判据必须写成**后向（相对）形式**：

```
|p(x)| ≤ τ · Σᵢ |aᵢ xⁱ|,    τ = 1e-11
```

τ 的定标依据：γ_n ≈ n·eps，n ≤ 64 时 γ_n ≤ 1.4e-14，取 1e-11 是它的 ~700 倍（留 3~4 个数量级余量）；
同时 1e-11 远小于任何**有意义**的残差（1e-9），不会把伪解放进来。

τ=1e-11 这一口径现在**全项目三处一致**：
`polynomial.js:polyIsRootWithin` / `pipeline/solver.js:_finalResidualGate` / `certify.js` 的 `backwardError`。

### 1. 症状①：真根被静默丢弃 ⇒ 谎报 `NO_SOLUTION`（P0）

**实测事故**：`5x⁴ − 1e12·x² + 7 = 0`

| 量 | 值 |
|---|---|
| 旧判据 | `|p(r)| < 1e-3 · max(1, |a₄|)` = `1e-3 × 5` = **5e-3** |
| 真根位置 | `x ≈ ±4.4721e5`（另有两个小根 `±2.6458e-6`） |
| 在真根处的 `Σ|aᵢxⁱ|` | ≈ **4e23** |
| 双精度舍入地板 | `ulp(2e23) ≈ 3.4e7` |
| 结论 | `|p(r)| < 5e-3` **比舍入地板小 10 个数量级** ⇒ 不可能满足 |

**后果**：4 个实根只认出 2 个大的，小根被自己的判据抹掉，对外报 `NO_SOLUTION` ——
而引擎自己的 Sturm 计数明确说域内有 4 个实根。**这是数学正确性 P0：给错答案且不报错。**

**修法**（`src/engine/numeric/polynomial.js`）：

```js
function polyTermScale(coeffs, x) {          // Σ|aᵢxⁱ|，任一项非有限 ⇒ Infinity
    const ax = Math.abs(x);
    let s = 0;
    for (let i = coeffs.length - 1; i >= 0; i--) {
        const t = Math.abs(coeffs[i]) * Math.pow(ax, i);
        if (!isFinite(t)) return Infinity;
        s += t;
    }
    return s;
}

function polyIsRootWithin(coeffs, x, tau) {
    const val = polyEval(coeffs, x);
    if (!isFinite(val)) return false;                    // fail-closed
    const s = polyTermScale(coeffs, x);
    if (!isFinite(s)) return false;                     // fail-closed
    return Math.abs(val) <= Math.max(1e-12, (tau || 1e-11) * s);
}
```

替换掉 3 处「尺度盲」魔数：`rationalRootTheorem` 内、`polynomialAllRoots` 的有理根验证、扫描根验证。
**fail-closed 方向**：值非有限、尺度非有限 ⇒ 一律判「不是根」。

### 2. 症状②：`residual` 字段与 `values` 不同源（P0，字段撒谎）

`src/engine/certify.js` 的 `_certifySolutions` 在认证通过后做**盒内牛顿精化**，
把 `sol.values` 从 6 位网格值换成全精度真根 —— **但没重算 `sol.residual`**。

**实测**：`x⁴ − 13x² + 4 = 0`

| 字段 | 值 |
|---|---|
| `values` | `-3.5615528128088556`（真根） |
| 实算真残差 | **2.2169e-12** |
| 自报 `residual` | **1.6493e-5** ← 那是 `p(−3.561553)` 即**网格点**的残差 |

**差 7 个数量级。** 一个机器精度的真根被报成「残差 1.6e-5」，Agent 拿它判断可信度必然误判为不可信。

**修法**：凡是「值被换掉」的地方，依赖该值的派生字段必须一起重算。

```js
sol.residual = maxRes;
// 后向误差：|f| / Σ|terms|。绝对残差在大系数题上永远很大（相消误差不可消除），
// 只有归一化后才知道这个解到底准不准。与 polyIsRootWithin 同口径。
var _beMax = 0;
for (var _bi2 = 0; _bi2 < eqs.length; _bi2++) {
    var _sc = 0;
    try { _sc = evalASTScale(eqs[_bi2], vmap); } catch (_e2) { _sc = 0; }
    if (!isFinite(_sc) || _sc <= 0) continue;
    var _fe2 = evalAST(eqs[_bi2], vmap);
    if (!isFinite(_fe2)) { _beMax = Infinity; break; }
    var _r2 = Math.abs(_fe2) / _sc;
    if (_r2 > _beMax) _beMax = _r2;
}
sol.backwardError = _beMax;
```

> **教训**：`values` / `residual` / `backwardError` / `certified` 是**同一个解的四个视图**。
> 任何一处改数值，其余三处必须同步 —— 否则字段之间互相矛盾，Agent 无从判断。

### 3. 症状③：完备性声明用了「过滤前」的快照（P0，声称有漏解却报 complete）

`pipeline/solver.js` 里 `_sturmCompletenessCheck` 在 **solver.js:1086** 就跑完了，
那时 `solutions` 还是**未过滤**的快照。之后 `_filterIllDefined` / `_finalResidualGate` /
`_mergeGlobalBranch` 会继续剔除解，但 `sturmCompleteness.found` **不再更新**。

**实测**：`5x⁴ − 1e12x² + 7 = 0` ⇒ 域内 4 个实根，过滤前 `found=4`、Sturm 也数出 4 ⇒ 判 `complete:true`；
但最终只输出 2 个解。**Agent 拿到 `complete:true` 会断言「全部解都在这里」—— 直接违反数学正确性。**

**修法**：`_assignCompleteness` 新增**门控⓪**，按**最终输出**重算，并同步刷新顶层透传字段。

```js
// —— 门控⓪：Sturm 计数的 found 必须按【最终输出】重算（2026-10-04）——
var _sc = state.result.sturmCompleteness;
if (_sc && _sc.certified === true && typeof _sc.realRootCount === 'number') {
    var _finalFound = (state.result.solutions || []).length;
    if (_finalFound !== _sc.found) {
        _sc.found = _finalFound;
        _sc.complete = (_sc.realRootCount === _finalFound);
        if (_sc.complete) { delete _sc.missing; }
        else { _sc.missing = _sc.realRootCount - _finalFound; }
    }
    if (!_sc.complete) {
        state.result.sturmIncomplete = { provenRealRoots: _sc.realRootCount, found: _sc.found,
            missing: _sc.realRootCount - _sc.found };
    } else { state.result.sturmIncomplete = null; }
    state.result.expectedRealRootCount = _sc.realRootCount;
    state.result.missingRealRootCount = _sc.complete === false ? _sc.missing : 0;
}
```

门控① 的措辞同时补了**反方向**（独立计数比输出还少 ⇒ 也是矛盾，同样不可宣称完备）。

### 4. 派生修复：confidence 判据的**两次**修正（一次比一次更数学）

这一节记录同一个字段改了三版的过程。**第二版是我犯的错**，值得完整留档。

#### v1（错）：绝对残差

绝对残差在相消误差大的题上**永远很大**，用它算 confidence 等于永远 `low`。

#### v2（**也错**）：后向误差

`operators/algebra.js`（`suan20`）改为**逐式**算后向误差（不能拿 `max|f|` 去比一个总量）：

```js
var res = 0, be = 0;
for (var ei = 0; ei < origEqs.length; ei++) {
    var rv = Math.abs(evalAST(origEqs[ei], fullVars));
    if (rv > res) res = rv;
    var sc = 0;
    try { sc = evalASTScale(origEqs[ei], fullVars); } catch (e0) { sc = 0; }
    if (!isFinite(sc) || sc <= 0) { be = (rv > 0) ? Infinity : be; continue; }
    var r2 = rv / sc;
    if (r2 > be) be = r2;
}
return { values: fullValues, residual: res, backwardError: be };
```

`solver.js` 的 `_resyncConfidence` 按 `maxBE` 分档（`<1e-9 ⇒ high`）。
这版**解决了 v1**（大系数真根不再被误判 `low`），**但判据本身选错了**。

#### v2 为什么错：点态量 vs 一阶量

| | 回答的问题 | 数学性质 |
|---|---|---|
| **后向误差** | 这个**点**代入原式的相对误差多大 | **点态量** |
| **confidence 该回答的** | 这批解的**存在性**有没有被证明 | **一阶量** |

**「点残差小」与「解集被证明过」是两个不同的命题**，两者可以任意独立。

**实测反例**：`x+y−3=0, x−y−1=0, z−1=0`（欠定，解集是 3 维空间里的一条直线，**无穷多解**）。
引擎自己在 `message` 里写「未证明解集完备」，但那个代表点**精确满足三式** ⇒ `backwardError = 0` ⇒ v2 报 `confidence: "high"`。

⇒ 一个「只算出流形上一点」的结果被标成「高置信」。读者会以为「答案就是它」，
**与项目「宁可少给不可给错」的红线相反**。

数学表述：欠定时点态误差可以任意小（把点投影到解流形上即可），**而存在性证明根本不存在**。

> ⚠️ 诚实记录：这个反例我一度误判成「恰定唯一解、`high` 是对的」——
> 手工核算 `rank = 3 = n` 确实是唯一解 (2,1,1)，引擎没报错。
> 真正的判据要靠**独立的秩判定**（见下），不能靠「点残差为 0」反推解集维数。

#### v3（现版本，正确）：只看认证覆盖率

```js
function _resyncConfidence(state) {
    var res = state && state.result;
    if (!res || !res.solutions || !res.solutions.length) return;
    var proven = 0;
    for (var i = 0; i < res.solutions.length; i++) {
        var s = res.solutions[i];
        if (s && (s.tier === 'proven' || s.certified === true)) proven++;
    }
    res.confidence = (proven === res.solutions.length) ? "high"
        : (proven > 0 ? "medium" : "low");
}
```

口径：全部 `tier==='proven'` ⇒ `high`；部分 ⇒ `medium`；无 ⇒ `low`；无解 ⇒ 不动
（空结果没有「解的可信度」可言，交给 `provenEmpty` / `truncated` 表达）。

`algebra.js` 里 v2 那段**删掉**，改为占位 `'low'` + 注释说明「本算子不判，认证后由
`_resyncConfidence` 统一算」—— 因为 `suan20` 产出的解**此刻还没认证**
（`tier` 要等 `_certifySolutions` 的 Krawczyk/Miranda 跑完才定）。

### 4b. 为什么残差本来就不该当「可信度」：零测试的不可判定性

「x 是否是真解」= **零测试（zero test）**。这个问题在一般情形下**不可判定**：

| 文献 | 结论 |
|---|---|
| **Richardson 1968**, *J. Symbolic Logic* **33**(4):514–520 | 对含 `x, e^x, sin x, \|x\|, π, ln2` 的表达式类，「**是否存在 x 使 A(x)=0**」与「**A(x) 恒等于 0**」都**不可判定** |
| **Blömer 1991**, FOCS **32**:670–677（*Computing sums of radicals in polynomial time*） | 即使退化到「有理数的**平方根和**」，零判定也只是 **co-NP**（单向误差蒙特卡洛，多项式时间） |
| **Blömer 1998**, ESA，LNCS **1461**:151–162，DOI `10.1007/3-540-68530-8_13`，Zbl **0929.65026** | 推广到含「整数的实根」的表达式，仍是**单向误差**概率算法 |
| 现状 | **判定非零和的符号至今是公开问题**（Blömer 的结果只蕴含「判符号 ∈ NP ⇒ 判符号 ∈ co-NP」） |

**⇒ 任何「|f(x)| < ε ⇒ x 是根」的推理都不是证明，只是启发式。**

这直接决定了本项目里残差的**唯一合法用途**（两处，都 fail-closed）：

| 用途 | 位置 | 性质 |
|---|---|---|
| **筛选器**（剔伪解） | `polyIsRootWithin` / `_finalResidualGate` | 只做减法，不产出可信度；判据是 `\|p(x)\| ≤ τ·Σ\|aᵢxⁱ\|`（τ=1e-11），**不是**绝对阈值 |
| **诊断量** | `backwardError` 字段 | 只给 Web 端调试与回归测试；**不进 Agent 决策面** |

**可信度必须由区间算子给出的存在性/唯一性证书回答**：Krawczyk / Miranda / MK-test / Sturm 计数。
这与 `completeness.undecidability` 里已经写着的那句是同一件事（本项目一直诚实标注了它，
只是 `confidence` 此前没有对齐）。

### 4c. 「Agent 的结果不都要」：残差在返回体里的现状（实测）

服务端 `shapeResult` 的裁剪已把残差挡在 Agent 决策面之外（实测确认）：

| 字段 | Agent 返回体 | 说明 |
|---|---|---|
| `solutions[].residual` | ❌ 不给 | Agent 只问「能不能用」，那由 `tier`/`certified` 回答；**区间认证是独立于残差量级的证据** |
| `solutions[].backwardError` | ❌ 不给 | 纯诊断量 |
| `solutions[].cert.backwardError` | ✅ 给，但压成 `ok`/`loose` | `1.7e-15` 这种长科学计数串对 Agent 没用，它只有「达没达容差」两档 ⇒ 压成枚举（`CERT_TOL=1e-9`），原值留内核 |
| `solutions[].cert.krawczykRadius` | ✅ 同上 | `ok`/`loose`，暴露**证据强度**而非精度 |
| `result.confidence` | ❌ 不给（服务层零出现） | 只给 Web 端 `index.html` 的徽章用 |

⚠️ **`loose` 状态必须保留、不能为了好看删掉**：实测 `5x⁴−1e12x²+7=0` 的 Krawczyk 包络
`[-3.4e7, 3.3e7]` 宽达 6.7e7（是真根跨度的 150 倍，**根本没收紧**），
但根仍被严格包含 ⇒ `certified:true` + `backwardError:"loose"`。
这是**诚实的组合**：解已证，只是包络松。Agent 需要看到的正是这个区分。

### 5. 实测收益 + 一个自己制造的回归

| 用例 | 修前 | 修后 |
|---|---|---|
| `5x⁴−1e12x²+7=0` 端到端 | 0 解 + `NO_SOLUTION` | **2 解 + `confidence:high`，每个 `backwardError<1e-9`** |
| `x⁴−13x²+4=0` | 缺根 | **4 根齐全** |
| `x⁵−1e20x+1=0` | 2 根 | **3 根，Sturm 3/3 变完备** |
| 新护栏 `test-backward-residual.mjs` | — | **22/22 全绿，5 节** |
| golden 基线 | — | `pass=20 fail=0`（8 处漂移全是 `residual` 变真：3.29e-9→4.44e-16 等；解数/`tier`/`certified`/`method` 全未变） |
| `npm run verify` | — | **`VERIFY_EXIT=0`**，fingerprint 53 文件 / 20516 行一致 |

**自己制造的回归（已修，值得留档）**：换后向判据后 `x⁴−13x²+4=0` 从 4 根掉到 **0 根**。
逐层拆发现：`scanRealRoots` 的牛顿精修把**输出网格精度 `tolerance=1e-6`** 当停机判据，
只把根算到 `|p(r)| ≈ 1.9e-7`，而该处尺度 329 ⇒ 阈值 3.3e-9 ⇒ **自己的判据把四个真根全灭**。

修法：新增 `polyNewtonPolish`，停机判据改为**「新一步在双精度下不再改变 x」**，与输出网格彻底解耦。

> **教训**：「根算到 1e-6」≠「根报出来保留 6 位小数」。这两件事混用会让后向判据**永远通不过**。

### 6. 如实留下的缺口

`5x⁴−1e12x²+7=0` 在 `x=±2.6458e-6` 还有 2 个真根，但规格要求 **6 位绝对小数网格**，
该值被 `roundToGrid` 压到 `0.000003`（残差 −2）⇒ **不可表示**。
已钉进护栏第 5 节：必须诚实报「缺 2」，**不许报 `complete`**。

---

## 五·quat、精确有理数证明 + 正维解集的三重谎报（2026-10-04 落地）

这一节记录同一轮里连着的两个 P0。**第二个比第一个严重**，因为它不是「少给」而是「谎报」。

### 1. 精确有理数证明：严格强于 Krawczyk 区间包含

**命题**：对 `A∈ℚ^{m×n}`、`b∈ℚ^m` 与候选 `x∈ℚ^n`，若 `A·x − b` 在 **ℚ 上逐式恒等于 0**，
则 `x` 是该方程组的**严格解**（不是「近似解」）。

**为什么需要它**（不能靠残差小代替）：

1. 消元产出的是**双精度浮点解**，再经 `roundToGrid` 到 6 位网格。
   **网格化本身就破坏精确性** ⇒ 浮点残差只能支撑「误差 < 1e-6」的**数值复核**，
   支撑不了「x 是解」的**证明**。
2. 但若 x 恰为有理数且在 ℚ 上严格满足全部方程，代入即**恒等式** ⇒ 得到真证明。

**强度排序**（这张表是本节的核心）：

| 方法 | 证了什么 | 性质 |
|---|---|---|
| Krawczyk 区间包含 | 「根在盒 `X` 内」（`K(X)⊂Int(X)`） | 区间论证，**前提是根孤立** |
| **ℚ 上精确代入** | 「代入**恒等于** 0」 | **严格强于前者**，且**不需要孤立性前提** |
| 无条件零测试 | — | **不可判定**（Richardson 1968，见 §6.4） |

实现（`_s17ExactLinearProof`，`operators/algebra.js`）口径 fail-closed：
分数用 `toString()` 取十进制字面量（**不能用「符号 × 绝对值」的字符串**，
那样 `parts[0]` 恒为 `"1"`，所有非零数都被转成 `1/1` —— 这个 bug 我犯过并当场修了）；
分母上限 `1e9`；全程 double 分数运算配 **`2^53` 溢出守卫**，越界立即放弃。

**实测收益**：`x+y−3=0, x−y−1=0, x+2y−4=0`（超定相容，唯一解 `(2,1)`）

| | 修前 | 修后 |
|---|---|---|
| `executionPath` | `高斯消元` | `高斯消元 + 精确有理数证明` |
| `tier` | **缺失** | `proven` |
| `certifiedCoverage` | `0` | `1` |
| `confidence` | `low` | `high` |

⇒ 修前 Agent 收到 `candidates_only` +「调 verify 复核」，**而这个解三式残差全 0，
早已被精确验证过**。

### 2. P0：正维解集被当成有限离散解集（三重谎报）

**实测事故**：`x−y=0, x−y=0`（两式相同，秩亏）

| 指标 | 修前 | 修后 |
|---|---|---|
| `resultType` | `2` 有限离散孤立采样点 | `3` 无限解集(推荐解) ✅ |
| 解数 | **191 / 175 / 172（每次不同）** | `1`（代表点）稳定 ✅ |
| tier 分布 | 174 `proven` + 1 `candidate` | `1` `proven`（且是精确证明）✅ |
| `certifiedCoverage` | `0.99`（**谎报的完备性**） | `1`（真） ✅ |
| `solutionSpaceDimension` | 缺失 | `1` ✅ |

**三重谎报**，任意一条都足以让 Agent 断言错误：

1. **解集类型错**：解集是一条**直线**（无穷多解），却报「有限离散孤立采样点」。
   Agent 会以为只有这 ~180 个解 ⇒ **漏掉无穷多**。
2. **证明是假的**：那 174 个 `proven` 由 Krawczyk 打出，而**区间论证在正维流形上前提不成立**（见下）。
3. **不确定**：每次运行点数不同（191/175/172）⇒ 违反产品承诺的「确定性可复现」。

#### 数学根因：区间法的完备性论证依赖「根是孤立的」

区间分支定界 / Krawczyk 的完备性论证是：把根**隔离**到互不相交的小盒，
每个盒内**恰一根**，再穷尽所有盒 ⇒ 无遗漏。

而**正维解流形上不存在隔离盒** —— 直线上每一点的任意小邻域里都有无穷多根，
「雅可比局部可逆 ⇒ 根孤立」这个前提根本不成立。
⇒ 在流形上跑区间认证，得到的 `proven` 是**假证明**。
**这比返回 0 解严重得多**：0 解至少还带着「可能还有」的语气，谎报则是笃定。

#### 三处修复（各自对应一个谎报）

| 修法 | 位置 | 治哪一条 |
|---|---|---|
| 方阵 `gaussianSolve` 返回 `null` 时用秩感知的 `gaussianSolveRect` 分类（区分「不相容」与「秩亏」） | `operators/algebra.js: suan17` | ① 解集类型 |
| `resultType===3` 时**不接**全局区间分支定界 | `pipeline/solver.js: _finish` | ②③ 假证明 + 不确定 |
| 已被 ℚ 精确代入证明的解，**区间认证层不得降级** | `certify.js: _certifySolutions` | ② 自相矛盾（`tier=candidate` 却带 `certMethod='exact_rational_substitution'`） |

第 3 条的理由是数学的：区间认证与精确代入是**两条独立的证明路径**，
后者严格强于前者（代入恒等式 vs 区间包含）⇒ **已有更强证明在手，弱证明失败不构成降级理由**。

#### 护栏

第 8 节 8 条，含反向 fail-closed：真正**恰定**的系统不得被「正维守卫」误伤。

---

## 六、定理引用核查结果（2026-10-04 逐条查证）

### 6.1 已落地定理 —— 引用核实正确

| 定理 / 方法 | 一手出处 | 核查结论 |
|---|---|---|
| Moore–Kioustelidis test | Moore, R.E. & Kioustelidis, J.B., "A simple test for accuracy of approximate solutions to nonlinear (or linear) systems", *SIAM J. Numer. Anal.* **17**:521–529 (1980) | ✅ 引用正确。它是 **Miranda 假说的可计算检验** |
| Miranda ≥ Moore | Frommer, Lang & Schnurr (2004), "A comparison of the Moore and Miranda existence tests", *Computing* **72**(3–4):349–354 | ✅ 原文结论「**Miranda test is always at least as powerful as the Moore test**」⇒ 选 MK-test 比 Moore 原 test 更强，与代码一致 |
| Krawczyk 算子 | Shen & Neumaier (1988), *Computing* **40**(1):85–89, DOI `10.1007/BF02242192` | ✅ `K(X)=x̂−Yf(x̂)+(I−YF'(X))(X−x̂)`，判据 `K(X)⊂Int(X)`（该文 Theorem 1，归功 L. Qi 的锐化版） |
| Rump ε-inflation | 膨胀本身是**启发式** | ✅ 代码注释已如实标注：**soundness 不来自膨胀，来自其后仍走的 Krawczyk 判据**。这个措辞是准确的 |
| Schichl–Neumaier 排除域 | *SIAM J. Numer. Anal.* 2004 | ✅ 走作者主页 29 页开放 PDF 精读（未逐字比对印刷版） |
| Cauchy 根界 | Cauchy (1829) | ✅ 形式 `1+max|aᵢ/a_n|` 正确。但 `Math.min(1000000, …)` 是**工程选择不是定理**，已在文档标注 |
| **Shub–Smale α 理论** | Shub–Smale, *Theoretical Computer Science* (1995)；实现见 Hauenstein–Sottile TOMS **Algorithm 921** | ✅ **已在代码里**（`certify.js:197+`）—— 上一轮清点漏了这条，本轮补上 |

### 6.2 纠正一条错引：Hansen–Sengupta

| 项 | 内容 |
|---|---|
| 我原来写的 | 「Hansen–Sengupta 1981, *On interval Gauss–Seidel methods*」 |
| **正确出处** | Hansen, N.K. & Sengupta, S., "Bounding solutions of systems of equations using interval analysis", **BIT 21**:203–211 (1981) |
| 「区间 Gauss–Seidel 方法」最早提出者 | **Alefeld & Herzberger (1970)** —— Hansen–Sengupta 是其**扩展**，不是原始方法 |
| 处置 | 已改文档 §5 勘误表；代码逻辑（区间 Gauss–Seidel 收缩）**不受影响**，只是出处标注错误 |

### 6.3 查到了但**判定不落地**的定理（附实测理由，不是遗漏）

> 这一节是本轮「查论文」的核心产出。**每一条都查到了、也读了，但都给了不落地的实测理由。**
> 按战略口径（认正不是重点，重点是数学正确性 + 时间消耗 + Agent 拿决策），收益低或有 soundness 风险的**一律不落地**。

**① 多界取 min 锐化正根上界**
文献：Akritas–Strzeboński–Vigklas (2006), "Implementations of a new theorem for computing bounds for positive roots of polynomials", *Computing* **78**(4):355–367, DOI `10.1007/s00607-006-0186-y`, Zbl 1108.65045；
Kioustelidis (1986), *J. Comput. Appl. Math.* **16**(2):241–244；Ştefănescu (2005), *J. Univ. Comput. Sci.* **11**(12):2132–2141。
AKVS 摘要原文：「applying various implementations of our theorem – and **taking the minimum of the computed values** – greatly improves the estimation」。

- **收益被我实测证伪**：`scanRealRoots` 采样点数**固定 2000**（`step = scanRange/2000`），
  收紧界**不省时间**，只提高分辨率。⇒ 时间消耗这条（战略重点②）拿不到。
- **存在 soundness 陷阱**：这三类是**正根**界，Cauchy 是**全根**界。
  直接取 min 会把**负根丢到界外**。sound 合并必须按符号类分别取 min：
  ```
  正根用W+ = min(Cauchy, B⁺(p))，负根绝对值用 W− = min(Cauchy, B⁺(p(−x)))，
  最终扫描域 W = max(W+, W−)
  ```
- ⇒ 收益低 + 要新增一处**易错的 soundness 逻辑**（这类错误会直接变成 P0）。**不落地。**

**② Ibragimov (2025) combined vertex method**
*I numer. Algorithms* **99**:627–649 —— 指出 Newton/Krawczyk 对**区间（非点）系数**系统一般不适用，提出 combined vertex method。
- ⚠ **适用性边界不匹配**：其结论针对**区间系数**系统，本项目是**点系数**求解器。
  套用会把**正确的东西判成不适用**。**不落地。**

**③ Lee (2025-12) arXiv:`2512.01355`**
"A priori bounds for certified Krawczyk homotopy tracking" —— 首个 Krawczyk 认证**同伦追踪**的复杂度分析。
- 面向**沿路径跟踪解**（homotopy continuation）。本项目做**孤立根 + 分支定界**，**无路径可跟**。**不落地。**

**④ 谱预条件** —— 当前瓶颈是**维数**（6 元方阵），不是预条件质量。**不落地。**

**⑤ 高阶区间迭代（八阶 / Ostrowski–Schiffer）** —— 收敛阶高，但每步区间算术成本指数上升。
本项目瓶颈在**盒数**而非单盒迭代阶数。**不落地。**

### 6.4 本轮新查证的定理：零测试（zero test）与其不可判定边界

这一组是「为什么残差不能当可信度」的**数学依据**，逐条查了一手来源。

| 文献 | 出处（已核实） | 结论 |
|---|---|---|
| **Richardson 定理** | Richardson, D. (1968), "Some unsolvable problems involving elementary functions of a real variable", *Journal of Symbolic Logic* **33**(4):514–520, JSTOR `2271358` | 对由 `x, e^x, sin x, \|x\|` 与有理数、`π`、`ln2` 生成，且对 `+ − × ∘` 封闭的表达式类 `E`：**「是否存在 x 使 A(x)=0」与「A(x) 恒等于 0」都不可判定**。另：**Tarski–Seidenberg 定理说明实数域一阶理论可判定，所以不能把 `sin` 完全去掉**（去掉就落入可判定侧） |
| **Blömer 1991** | Blömer, J., "Computing sums of radicals in polynomial time", FOCS **32**:670–677, DOI `10.1109/SFCS.1991.185434` | 「有理数平方根和是否为零」可在**多项式时间**判定（Monte Carlo），即该问题 ∈ **co-NP**。⚠️ 他**没有**解决符号判定 |
| **Blömer 1998** | Blömer, J., "A probabilistic zero-test for expressions involving roots of rational numbers", ESA'98, LNCS **1461**:151–162, DOI `10.1007/3-540-68530-8_13`, Zbl **0929.65026**, MSC 65H05 | 推广到含「整数的实根」的表达式，**仍是单向误差**（`E=0` 时必答对；`E≠0` 时误判概率可任意小）。作者称「已实现且预期实用」 |
| 符号判定的现状 | Mulzer & Rote (2008), *J. ACM* **55**(2) 引用 Blömer | **判定非零和的符号至今是公开问题**；Blömer 的结果只蕴含「若符号判定 ∈ NP 则 ∈ co-NP」 |

**⇒ 对本项目的三条硬约束**（都已在代码里落实）：

1. **残差不是证明**。「|f(x)| < ε ⇒ x 是根」只是启发式。
   ⇒ 残差只许做**筛选器**（`polyIsRootWithin` / `_finalResidualGate`，只做减法），
   以及**诊断量**（`backwardError`，只给 Web 端与回归测试）。
2. **可信度只能由区间算子的存在唯一性证书回答**（Krawczyk / Miranda / MK-test / Sturm 计数）。
   ⇒ `confidence` v3 口径只看认证覆盖率（见「五·ter」§4）。
3. **不可判定性必须诚实标注**。`completeness.undecidability` 里已经写着
   「对任意超越系统，Richardson 不可判定定理表明不存在判定『有解/无解/几解』的通用算法」——
   这句话一直是对的，现在 `confidence` 也与它对齐了。

> **口径统一的价值**：`completeness.undecidability` 早就承认了不可判定性，
> 而 `confidence` 此前（v1/v2）却用「残差小 ⇒ high」暗示可判定。
> **同一个返回体里两套自相矛盾的哲学**，是本轮修正的真正动机。

### 6.5 本轮新增的「待查 / 不确定」清单（并入 §七 表格口径）

| 项 | 状态 |
|---|---|
| Rump ε-inflation 一手出处年份（1983 vs 2006） | ⚠️ 未逐字核到印刷版。**不影响 soundness**（soundness 来自 Krawczyk 判据） |
| AKVS Thm 5 完整公式全文 | ⚠️ 只据**摘要与综述转述**。**未据其推导任何代码**，故不构成正确性风险 |
| `1e6` 硬截断是否等价于合法域假设 | ⚠️ **未查证**。`polynomial.js:205`、`algebra.js:317` 两处。见下 |

> **唯一需要您拍板的一条**（不是技术判断，是规格语义）：
> `1e6` 硬截断 —— 是**按 Cauchy 界自适应**（更数学，但会改变既有输出），还是**保留 1e6 但显式标注截断**（保守，但输出里多一个字段）？
> AI 已倾向后者（fail-closed 口径下，显式承认截断优于静默收紧），但这会动对外输出结构，**不替您拍**。

---

## 七、明确的「查不到 / 不确定」清单

| 项 | 状态 |
|---|---|
| Miranda 定理的精确矩阵不等式 | ❌ 未取得一手原文，**未凭记忆编造** |
| Schichl–Neumaier 排除域公式的一手 PDF 逐字核验 | ⚠️ 通过作者主页 29 页开放 PDF 精读，但未逐字比对印刷版 |
| 「Bihan–Dickenstein 2017 vs BDF 2021」的 ordering 定义在非 circuit 支撑上的推广 | ❌ 未查证 |
| Forsgård 的 essential variables 归约定理 | ❌ **本轮未核实到定理形式**，未纳入 |
| Basker–Bihan–Sturmfels ε-认证混合体积 | ⚠️ 未单独查证，**不建议依赖** |
| 多齐次 Bézout 最优分组 NP-hard（Malajovich 归因） | ⚠️ 未单独查证 |
| m 个方程的精确 OPTM 常数（Barone–Basu 系列） | ⚠️ 未查证 |
| VAS 每步几何收缩率 | ❌ **未找到严格定界** |
| Heath-Brown–Wooley / Greaves 筛法的 δ 有效性与具体值 | ⚠️ 只确认「存在 δ>0」的定性结论，**不可直接编码为硬上界** |

---

## 八、拆掉「认证的魔窟」：全局区间分支定界剥离出默认路径（2026-10-04）

### 8.1 先诊断，再动手：300ms 到底买到了什么

用户指令是「把认证的魔窟去掉」。**没有按字面删**，先做 CPU profiler 与 A/B，
因为「魔窟」是个比喻，必须换成可测量的量。

`operatorProfile` 与墙钟的差（差值 = 认证层 + 收口层的全部开销）：

| 题 | wall | timeMs（算子实算） | gap |
|---|---|---|---|
| 3元非线性 | 332ms | 9ms | **326.0ms** |
| 4元稠密 | 363ms | 42ms | **361.0ms** |

`--cpu-prof` 自耗时排名（632 hits）：排除域仿射包络算术
（`_affMul` / `_affRad` / `_affAdd` / `_affSub` / `_affineEval` / `_buildAffEnv`）
合计 **32.8%**，加上 `_globalBranchCertify` 15% + `prunedByExclusion` 14.6%
+ `boxInsideRegion` 6% ≈ **占 68%**。

**决定性证据** —— 那 300ms 的产出是什么：

| 题 | 盒数 | complete | 残盒 | provenIsComplete |
|---|---|---|---|---|
| 3元 | 1886 | **false** | 5 | **false** |
| 4元 | 1323 | **false** | 353 | **false** |
| 5元 | 1036 | **false** | 839 | **false** |
| 6元 | 475 | **false** | 476 | **false** |

⇒ **从未**给出完备性，**一个解都没多找到**。这是「认证的魔窟」的实质：
**既不给解，也不给完备性，只烧掉 70~90% 的墙钟并报一个诚实的失败。**

补充对照实验（排除域剪枝不是元凶）：关掉剪枝只省 5~26ms ⇒ 开销在**遍历规模**，
不在剪枝算法。根因是域太大：默认域 ±1e6，切到 `minWidth=1e-4` 需
`log₂(2e6/1e-4) ≈ 34` 级/变量 ⇒ 盒数 `~2^(34n)`，n=3 就 `~10^30`
⇒ **完备穷举数学上不可行**，必然撞 300ms 硬预算。

### 8.2 落地：默认关、按需开

`state.userDomain = initialD0` 恒非 null ⇒ 全局分支定界**默认就在跑**。
现改为**默认不跑**，需要完备穷尽时显式传 `{ globalBranch: true }`。

A/B 实测（关 = 默认，开 = 显式 opt-in）：

| 题 | 关 | 开 | 省 | 解集 |
|---|---|---|---|---|
| 3元非线性 | **38ms** | 313ms | 275ms | **完全相同** |
| 4元稠密 | **81ms** | 520ms | 439ms | **完全相同** |
| 5元耦合 | **70ms** | 416ms | 346ms | **完全相同** |
| 6元稠密二次 | **247ms** | 515ms | 268ms | **完全相同** |
| **合计** | **436ms** | **1764ms** | **1328ms (75.3%)** | 零差异 |

口径与产品定位一致：**Agent 要的是一个「决策结果」（一个解 + 它是否被证明），
不是「全部结果」这份清单。** 完备穷举是离线审计需求，不是默认路径需求。

### 8.3 🔴 剥离时自己引入的 P0：完备性谎报「找全了」

⚠ 这一节是本轮**最要紧的教训**，必须留痕。

关掉全局分支后，`completeness.provenIsComplete` 从 `false` **翻成了 `true`**。
根因：门控③ 靠 `state.result.truncated` 触发，而 `truncated` 恰恰是
`_mergeGlobalBranch` 在 `complete=false` 时置的 ⇒ 关掉分支 ⇒ 不置 `truncated`
⇒ 无 gap ⇒ `isComplete=true`。

**「没跑过穷举」与「穷举过且穷尽了」在逻辑上完全不同**：前者对「有没有漏解」
**零信息**，报 `true` 是纯谎报，且直接违反产品最硬的红线
（Agent 靠它判断能否断言「找全了」）。

修法：`_assignCompleteness` 新增**门控⑤** —— 全局分支未运行**且无独立完备性证据**
⇒ 无条件降级为「未验证」，并在 `incompleteReasons` 里写明归因。

反向核对（门控⑤ 不得误伤）：单变量题 `x³−x=0` 仍有
`sturmCompleteness = {certified:true, realRootCount:3, found:3, complete:true}`
—— 这是 **Sturm 独立计数**给出的完备性证据，与全局分支无关，
所以 `provenIsComplete=true` 是**合法的**，门控⑤ 正确地放行了。
`x²−2=0` / `x⁵−x=0` / `x⁴−5x²+4=0` 同样通过。

### 8.4 多元先验根界：把「猜的域」变成「证的域」

**定理（多元 Cauchy 的 log 空间形式 / 热带平衡不等式）**
设 `p(x) = Σ_γ c_γ x^γ = 0`（非零解），令 `v_i = ln|x_i|`，
`A_γ = ln|c_γ| + ⟨γ,v⟩`。由 `Σ_γ c_γ x^γ = 0` 得最大项必被其余项抵消，
取 `α*`=最大项指数、`β*`=次大项，则三条**必要条件**同时成立：

```
α* 支配： ⟨γ−α*, v⟩ ≤ ln|c_α*| − ln|c_γ|        ∀γ≠α*
β* 支配： ⟨γ−β*, v⟩ ≤ ln|c_β*| − ln|c_γ|        ∀γ∉{α*,β*}
平衡带： ⟨α*−β*, v⟩ ≤ ln|c_β*| − ln|c_α*| + ln(s−1)
```

全是 `v` 上的**线性**不等式 ⇒ 每个支配对 `(α*,β*)` 给出一个多面体，
真解必落在**某个**这样的多面体内（组合极大值）⇒ 「所有解 ⊆ 盒」被**证**出来。

实测收益（4元稠密题 `x²+y²+z²+w²=30, x+y+z+w=10, x·y=4, z·w=6`）：
服务层给出 proven 半宽 **20**，从 ±1e6 收紧 **5 万倍** ⇒ 切盒级数从
`~2^(34·4)` 降到 `~log₂(40/1e-4)≈19` ⇒ 盒数量级降 **10^70**。

#### ⚠ 为什么必须上单纯形 LP（第一版实现是 unsound 的）

第一版引擎实现只取平衡带那一行，然后把其它变量项**直接丢掉**：
`v_k ≤ (ln|c_β*|−ln|c_α*|)/d`。**这是错的** ——
`v_j = ln|x_j|` **可以是负的**（`|x_j|<1`），所以 `⟨γ,v⟩` 里其它变量的项
**不是**「非负 slack」，不能从不等式里丢掉。丢掉它们解出的 `v_k` 上界会
**小于**真上界 ⇒ **假紧界** ⇒ 直接裁掉真解，且**不报任何错**。

服务层 `services/rootbound.js` 正是为这个才上两阶段单纯形
（`dirBounds` → `lpMax` 解出真正的上确界）。现把 LP 搬进引擎
（`_rbLpMax` / `_rbDirBounds` / `_rbMakeRows`），引擎自足，不依赖 `require`。

三条 LP 陷阱（每条都会**静默给假答案**，逐条照搬服务层的踩坑注释）：
① `b<0` 时**结构系数与松弛系数要一起翻号**（只翻结构系数 ⇒ 约束 sneak 成 `Av ≥ b`）；
② 比值检验**必须收第二象限**（漏了 ⇒ 无界被当「最优 obj=0」⇒ 界退化成 `|x| ≤ e^0 = 1`）；
③ Phase II 入基候选**必须包含松弛列**（只放结构列 ⇒ 无界被吞成有限 obj）。

四条方向纪律（错一条就是假紧界）：
① 支配行方向是 **γ 减 α**（写反 ⇒ 区域变成「α 不是最大项」）；
② **取 max 不取 min**（真解只落在某一个 `(α*,β*)` 区域，其余是噪声）；
③ 候选对**穷举**（实测反例 `x+y=3` 在 `x=2.618` 处真实最大项是**常数项**，
`ln3 > ln2.618`，任何按「α_k 最大」切片的启发式都会漏）；
④ 超预算 ⇒ **整体返回 null**，绝不返回「没证完但算出来了」的界。

#### 引擎内实测生效

| 题 | priorRootBound | halfWidths |
|---|---|---|
| 3元 | **applied=true** | `[9, 18, 18]` |
| 4/5/6元 | null（超预算，fail-closed） | — |

`null` 是**正确行为**（诚实降级），不是失败。

#### 与服务层的分工修正

服务层已有 `MAX_COMBOS` / `MAX_MS` 双重预算（实测：4元 217ms 可用，
5/6元诚实降级到 301ms，6元从 6584ms 降下来）。**纪律③「只在证出来的界比旧默认更大时才改域」**
是在**旧分支定界**下得出的判断，其前提（默认路径会跑穷举）已被本轮推翻 ⇒ 纪律更新。

### 8.5 顺带修的性能缺陷：BFS 队列的 O(n²)

`queue.shift()` 在 BFS 队列上是 **O(n)**（每次要把后续元素整体前移），
n 个盒累计 **O(n²)** 次元素搬移。3元题切 2335 个盒 ⇒ 约 270 万次搬移。
改成头指针 `qHead` 是标准 BFS 写法，**语义完全等价**（顺序一致、去重一致）。

### 8.6 护栏

第 9 节「多元先验根界：只许放松，绝不裁掉真解」**9 条**（护栏 46 → 55）：
暴力网格独立枚举真解后核对界是否包住每一个真解（含 `x=2.618` 常数项反例）、
非多项式 fail-closed、正维解集不接、默认关 A/B 一致、墙钟必须真的更低、
**门控⑤ 不得谎报完备**、**Sturm 独立证据时不得误伤**。

---

## 第九章 ≤6 变量的数学判据与 4 态决策标记（2026-10-04）

### 9.0 调研结论先行：≤6 在数学上**没有**特殊性

用户的直觉是「无限变量的定理对 n≤6 应该有特殊办法」。查证后必须诚实回答：**没有**。

| 传闻 | 查证结果 |
|---|---|
| CAD「>4 变量不可用」 | 工程经验阈值，非数学断点 |
| Gröbner「n,l ≤ 5」 | 出自 Manocha 1998 报告的**工程经验**，非定理 |
| 「Hearn 五变量以内自动求解」 | **查不到/不存在**。Hearn 的相关工作是 Hearn & Zaverski, *Automated solution of the **quintic*** (AMS PSAM 53, 1998)，讲**一元五次方程**，与变量数无关 |
| Abel–Ruffini 对应「五元」 | **无数学类比**。前者是 Galois 群问题；多元 generic system 解集是有限点集，数值上可解 |
| TSDP 对 ≤3 次有保证 | ✅ 唯一真正的「次数/维数小 ⇒ 有保证」（Luo/Thurston/Sturm 2004） |
| Richardson 定理 | 只针对含**超越函数**（sin/exp/|x|）的表达式类；纯多项式由 Tarski–Seidenberg **完全可判定** |

⇒ **≤6 的真正价值是工程量**（路径构造的规模）：

```
n=6, d=2 →    64 条 homotopy 路径   ✅ JS 轻松
n=6, d=3 →   729 条                  ✅ 可行
n=6, d=4 →  4096 条                  ⚠️ 开始疼
n=6, d≥5 → 15625 条起                ❌ 路径构造本身成瓶颈
```

### 9.1 找到的可编码严格判据

`src/engine/rootbound-poly.js` 落地的是 **R1（Bézout 判据）**：

| ID | 规则 | 类型 | 出处 |
|---|---|---|---|
| **R1** | 认证根数 R == Bézout 上界 B ⇒ 完备；R>B ⇒ bug；R<B ⇒ 不可判定 | **严格** | Masser–Wüstholz (1983) + Sottile arXiv:math/0007142 Thm 1.1（界是紧的，generic 恰有 ∏dᵢ 个互异根） |
| R2 | ∃z 使 rank J_F(z) < n ⇒ 该点所在分支正维 | **严格（单向）** | Bertini 手册 |
| R3 | 所有根处 J_F 非奇异 ⇒ Krawczyk 一致覆盖必终止 | **严格** | Krawczyk 1969 / Neumaier 1973 |
| R8 | 隔离实解数 > d(2d−1)^(n−1) ⇒ bug | **严格** | Milnor 1964 / Thom 1964 |
| R9 | ∃v≠0: fᵢ⁺(v)=0 ∀i ⟺ 正维 | **严格充要** | 代数几何首形式 |

**两条必须写进注释的纠正**（否则会用错方向）：

1. **实数域上 Bézout 失效**（Barone & Basu arXiv:1303.1577 引言原句）⇒ `dⁿ` **不是**实解数上界。
   但 `R>B` 仍是 bug（实解数 ≤ 复根数 ≤ B），`R==B` 仍能判完备（此时全部复根为实）。
2. **「雅可比亏 ⇒ 正维」不是充要** —— 反例 `ℝ²` 上 `f₁=x², f₂=y²`，解集 `{(0,0)}` 是 0 维的但 `J(0,0)=0`。
   所以 R2 只能**单向**用（发现亏秩 ⇒ 警惕正维，没发现 ⇒ 不保证）。

**用户预期的方向反了**：Bézout 界是**紧的**（generic 可达），所以
「命中数 > 上界 ⇒ 有遗漏」是错的（那是 bug）；
正确方向是「命中数 == 上界 ⇒ 完备」「命中数 < 上界 ⇒ **不可判定**（合法状态，不是失败）」。

### 9.2 4 态决策标记的判据

`src/engine/conclusion.js`。每一态都由**可判定的数学条件**驱动，不靠措辞：

| 结论 | 触发条件 |
|---|---|
| **全部解** | 有独立完备性证据：① Sturm 精确计数吻合 ② **Bézout 上界击满（R==B）** ③ 线性满列秩（`effectiveDim=0` + `classifyRank≥nVars` + 全部解 proven + **路径声明线性**） |
| **部分解** | 找到 ≥1 解但无任何完备性证据（含正维流形：代表点有效，「全部」不可断言） |
| **无解** | **严格证明**域内无解（`provenEmpty` / `proof_empty` / `sturm_zero_roots` / 区间包络 / 导数单调 / 快速矛盾 / 投影反证） |
| **计算资源不足** | 被预算/深度/时间中止，或 Bézout 上界被突破。**这是「我不知道」，不是「无解」** |

**判定顺序有严格理由**（从最确定到最不确定）：
资源不足优先（否则「没算完」被说成「无解」）→ 无解 → 全部解 → 部分解（兜底）。

### 9.3 12 项实测

```
OK  线性唯一解         => 全部解       ev=["linear_full_column_rank=2=2"]
OK  线性3元           => 全部解       ev=["linear_full_column_rank=3=3"]
OK  超定线性相容       => 全部解       ev=["linear_full_column_rank=2=2"]
OK  非线性3元(P0陷阱)  => 部分解       ev=[]
OK  秩亏正维2x2        => 部分解       ev=[]
OK  超定不相容         => 无解         ev=["provenEmpty","proof_empty","proof_empty"]
OK  x^2-4            => 全部解       ev=["sturm_exact_count=2","bezout_bound_attained"]
OK  2元Bezout击满       => 全部解       ev=["bezout_bound_attained"]   ← 新定理在多元上首次成立
OK  x^2+1            => 无解         ev=[..., "sturm_zero_roots", ...]
OK  欠定正维4元        => 部分解       n=1
OK  真欠定线性         => 部分解       n=1
OK  sin超越           => 计算资源不足  n=100（被展示上限截断，确实是资源不足）
```

Bézout 上界实测：`x²-4` B=2 ✓、`x³-x` B=3 ✓、超定 3eq/2var B=null（方阵检查生效）✓、
`sin(x)-0.5` B=null（fail-closed）✓、`x⁹-1` B=null（预算闸门）✓。

### 9.4 🔴 修自己的 P0：「线性满列秩」被非线性系统误触发

`x+y+z=6, x*y=2, y*z=3` 被判「全部解」，实际有 **2 个**实解（消元得 `y²−6y+5=0`）。

根因：判据只查 `classifyRank >= nVars`，**漏了「必须是线性」这个前提** ——
`classifyRank` 是调度器的**结构预判标签**，对非线性系统也填 3。

修法：加 `_isLinearPath`（要求 `executionPath` 含「高斯消元」/「精确线性代数」/「线性」且不含「非线性」）。

> **教训：门控字段名对、语义也对，但适用前提没写全 ⇒ 假保护比没有保护更危险。**

### 9.5 🔴 修自己的 P0：欠定正维题被误判「计算资源不足」

`x²+y²=5, z²+w²=5, x+y+z+w=6`（3方程4变量）判「计算资源不足」。

根因：欠定正维系统**故意**置 `truncated=true` 表达「未穷尽」（存在性 vs 完备性），
机械按 `truncated ⇒ 资源不足` 会误报。Agent 拿到「计算资源不足」会建议重试/缩域 ⇒ **假指令**。

修法：加 `_posDimAny` 判定，正维时不走资源不足格，落到「部分解」并说明
「不是计算失败，重试或缩域都不会改变『无穷多解』这个事实」。

### 9.6 输出层瘦身的纪律

**内部完整保留**（`result` 里字段照旧，供人排查与 golden 对拍），
瘦的是**给 Agent 的那份** —— 在出口生成精简副本。

理由：删内部字段会让 golden/护栏失去回归基准，而**数学正确性证据永远不能删**。
MATH-FOUNDATIONS 记录的每一条「砍了什么、为什么砍」都必须给出**消费者证据**（grep 结果）。


---

## 第十章 🔴 展示截断引入的 3 个 P0：一次「保护产品」的改动如何骗 Agent

### 10.0 背景：为什么要封顶

实测 `x*cos(x)-x=0` 在默认域 ±1e6 内返回 **16 解 / 4627B** ——
而真解是 `x = 2kπ`，±1e6 里有约 **31.8 万个**。
`solutions[]` 没有任何数量上限 ⇒ 对 AI 客群是实打实的 **token 炸弹**。

于是加 `AGENT_MAX_SOLUTIONS = 2` 封顶。**这个决定本身是对的**。
但第一版实现同时犯了三个错 —— 三个都属于「看起来在保护产品、实际在骗 Agent」。

### 10.1 P0 ①：把「我没显示完」说成「你没算完」⇒ 假指令

原实现：
```js
truncated: !!(r.truncated || meta.truncated || capped)   // ← capped 是我们自己截的
```

实测（`(x²−1)(x²−4) = 0`，5 个实根）：
```
trust.trustLevel = "budget_exhausted"
trust.agentAction = "Narrow domain or raise budget if completeness matters"
certification.proven = 5          ← 引擎把 5 个根全找到了
```

引擎**根本没爆预算**。Agent 拿到这条指令会去加 budget / 缩 domain，
**重试一百次都是同一结果**。

> 假指令比不给指令更坏：不给指令时 Agent 会自己判断，给了假指令它会**照做**。

这与 §9.5 的 P0 是同一个病 —— 把「我没显示完」说成「你没算完」。

**修法**：
- `truncated` 恢复成**只**反映引擎真实中止
- 展示截断走独立字段 `trust.moreAvailable` + 顶层 `nextOffset`
- 新增独立 `trustLevel = complete_but_shown_partially`（排在 `budget_exhausted` **之后** ——
  引擎真中止时「加预算」是**真**指令，优先级必须更高）

### 10.2 P0 ②：同一返回体里两个数字互相矛盾

```
trust.provenCount = 2          ← 数的是展示切片
certification.proven = 5       ← 数的是引擎全量
```

> **LLM 遇到矛盾字段不会忽略一边，它会挑对自己方便的那半信。**
> 这是幻觉诱因，比字段多更危险。

**修法**：计数一律用 `r.solutions`（引擎真相）；「眼前看到几个」由 `solutions.length` 自己表达。
并加护栏断言 `provenCount === certification.proven`。

### 10.3 P0 ③：`poly_roots` 被塞进一个**无法完成的契约**

工具描述白纸黑字写着 **"All real roots"**，而 5 个根只给 2 个，
且**没有任何参数能取回剩下 3 个**。Agent 被塞进一个死路：
要么误报 2 个（漏解），要么反复重试拿同一份结果（空转）。

**修法**：加 `n` 偏移入参 + 顶层 `nextOffset`，并写进 `SOLVE_DESC` / `POLY_DESC`。

⚠ 参数只放进 `inputSchema` **不够** —— 它在 Agent 眼里只是「一个可选数字」，
没有任何理由被猜到是翻页用。实测口径必须写进**工具级描述**。

### 10.4 🔴 修「分页死循环」：capped 判据写反

第一版 `capped` 判据写成 `window.length < allSols.length`：

```
n=5（总数 5）⇒ window=[] 而 allSols.length=5 ⇒ 0 < 5 ⇒ capped=true
             ⇒ nextOffset = 5 + 0 = 5 = n 本身 ⇒ Agent 循环 n=nextOffset 永不推进
```

给 AI 用的字段死循环 = **Agent 卡死在工具调用里**，是最坏的一类 bug。

正确判据：**窗口末端之后**还有元素才叫 capped：
```js
const capped = off + window.length < allSols.length;
```

`moreAvailable` 同理必须减掉本页起点：`Math.max(0, total - shownFrom - shown)`。

### 10.5 🔴 修「完备性被过度降级」：把「知道」说成「不知道」

第一版还有一条过度保守的门控：展示截断 ⇒ `completeness.status` 从 `complete` 降成 `unknown`。

对 `x²+y²+z²=1` 这类**已被 Sturm / Bézout 证过完备**的方程组，
说「不知道有没有第 5 个解」是**另一方向的谎报** —— 与「谎称找全」同样是错的。

**完备性与展示是两件独立的事**，缺一不可：

| 字段 | 描述什么 | 展示截断时的值 |
|---|---|---|
| `completeness.status` | **引擎** Knows what it knows（定理结论） | `complete`（**不降级**） |
| `conclusion` | **Agent 此刻**掌握什么（决策事实） | `部分解`（**必须降级**） |
| `trust.moreAvailable` + `nextOffset` | 怎么把剩下的取回来 | 数字 |

Agent 同时看到这三行，它的判断是正确的：「确实只有 5 个，其中 3 个你还没问，再问一次要」。
而 `status=unknown` 会让它以为「可能有第 6 个」⇒ 无谓地继续搜。

### 10.6 两个假阳性护栏（本轮自己踩的）

1. **`displayTruncated = moreAvailable > 0` 而 `moreAvailable` 是不存在的变量** ⇒ 恒 `false` ⇒
   分支永不触发，护栏**假通过**。假通过的护栏比没有护栏更糟（它给了虚假安全感）。
   ⇒ 教训同「门控字段必须先 grep 核实」：**写完门控必须实测它真能触发**。
2. **测试脚本把 `buildPolyEquation` 的系数顺序搞反**（它约定最高次在前，我给了常数在前），
   一度以为「一元多项式恒定丢 1 个根」并准备当 P0 上报。
   ⇒ **动手报 bug 前必须先核实接口约定**。差点把一个不存在的产品 bug 写进文档。

### 10.7 体积：砍掉的都是「同一语义两处表达」

修完 3 个 P0 后返回体顶破 1600B 红线（正维 1591B、16 解 1701B）。
追下去发现超标的**不是新加的字段，是一直在重复表达的旧字段**：

| 砍掉 | 体积 | 依据 |
|---|---|---|
| `warnings` | 208B / 166B | 逐句核对：三条 warning 的内容与 `conclusion` + `trust` + `completeness` **一一对应，没有一个新事实** |
| `diagnostics.inputErrorMessage`（非输入错误时） | 80B / 122B | 零消费者，且装的**不是输入错误**（是求解结论）却顶着 `inputError` 的名字 ⇒ Agent 会去改一个完全没问题的输入 |
| `cert.enclosure`（区间退化成点时） | 27B/维 | `lo==hi==values[i]` ⇒ 与同一对象里的 `values` **逐位相同**，是同一信息的第二份拷贝 |
| `recommended: null` 的键 | 15B | Agent 看到 `null` 与看到「键不存在」是同一种理解 |

**非退化区间一律原样保留** `enclosure` —— 那才是它唯一不可替代的场合（区间宽度本身是信息）。
`inputError` 本身**必须保留**（托管端计费层 `http-mcp-server.js:536` 与 6 处测试直接读它）。

修后各场景余量：

| 场景 | 修前 | 修后 | 余量 |
|---|---|---|---|
| 16 解 `x*cos(x)-x=0` | 1701B ❌ | **1398B** | 202B |
| 4 解 `x²=2 & y²=3` | 1570B ❌ | **1438B** | 162B |
| 5 根 `(x²−1)(x²−4)` | 1616B ❌ | **1448B** | 152B |
| 单解 `x²=4` | 1295B ✅ | **1236B** | 364B |
| 正维欠定 3eq/4var | 1591B ❌ | **1326B** | 274B |
| 超定不相容 | 913B ✅ | **880B** | 720B |

## 第十一章 🔴 完备性计数的「声明空间」口径：Sturm 区间语义的两次踩坑（2026-10-04）

### 11.0 病根：Sturm 定理数的是「**区间**内有多少实根」

Sturm 序列给的是

$$\#\{\text{实根} \cap (a, b]\} = V(a) - V(b)$$

—— 它数的是**区间**，不是「解集」。所以完备性判定的正确性 **100% 取决于喂给它的区间是什么**。
本项目历史上把**三个语义完全不同**的区间当成了同一个东西，这就是两次踩坑的全部来源：

| 类型 | 例 | 数学地位 | 完备性该怎么判 |
|---|---|---|---|
| **(A) 搜索盒** `domain:{x:[1,2]}` | 「哪里找」 | **搜索提示**，不是问题的一部分 | **不能**当完备性证据 |
| **(B) 问题约束** `x>0` / `x∈[-30,30]` | 写在方程串里的不等式 | **问题的一部分**，它定义了解集本身 | **应当**用它 |
| **(C) ℝ** | 没有任何约束 | 这时才等于声明空间 | 只有无约束时用 |

判据一句话：**盒是「我去哪找」，约束是「什么算对」**。拿「我去哪找」当「什么算对」，就会谎报找全。

### 11.1 第一次踩坑（前轮已修）：拿 (A) 当证据 ⇒ **谎报找全**

```
solve('x^2=2', domain:{x:[1,2]})
```

域 `[1,2]` 内只有 `+√2` 一根，found = 1，域内计数 = 1 ⇒ 判「全部解」+ `canAssert.allSolutions=true`。

**但 `−√2 ≈ −1.4142` 是真解，且在盒外。** 这是在向 Agent 谎报「已找全」。

### 11.2 第二次踩坑（本轮由 golden g018 抓到）：一刀切用 (C) ⇒ **过度保守的谎报**

修法如果简化成「不信盒子就改用全 ℝ」，会撞上相反方向的错误：

```
solve('x^2-4=0, x>0')
```

声明空间是 `(0,∞)`，其中**恰好** 1 个解 `x=2`，结论本该是「全部解」。
但 ℝ 上 `x²−4` 有 ±2 两根，found 1 ≠ 2 ⇒ 误判「部分解」。

这次不是多给了，是**少给了、还嘴硬说已经找全不了**。方向反了，但同样是数学错误 ——
Agent 拿到「部分解」会怀疑工具、去加预算重算，纯属浪费。

> 两次踩坑的共同教训：**不是「盒子不可信」或「ℝ 最保险」，而是「必须先问清楚这个区间是问题的一部分吗」**。
> `x>0` 写在方程串里，它就是问题的一部分；`domain` 只是搜索提示。前者该用，后者不该用。

### 11.3 修法：声明空间口径

新增 `_sturmCountRange(coeffsAsc, lo, hi, opts)` 支持 ±∞ 端点与开闭修正，
新增 `_declaredIntervalOf(state, vn)` 从 `state.domainConstraints` + `state.inequalityConstraints`
推导声明空间区间（可 ±Infinity），`scope` 显式区分 `'R'`（无约束）与 `'declared'`（有约束）。
`conclusion.js` 的两处白名单同步放开 `'declared'`。

#### 🔴 端点语义必须实测，不能猜

`V(a) − V(b)` 数的是 **`(a, b]`** —— **右端点含、左端点不含**。实测确认：

| 算例 | 计数区间 | 结果 | 验证 |
|---|---|---|---|
| `x−1` | `[0,1]` | **1** | 根 1 = 右端点，**计入** |
| `x²−4` | `[−2,0]` | **0** | 根 −2 = 左端点，**不计入** |

由此得到两条**方向相反**的端点修正，漏掉任何一条都是数学错误：

- `loClosed = true`（声明空间含 L）⇒ 若 `p(L)=0` 必须**补回 +1**
  （漏补 ⇒ **谎报找全**）
- `hiClosed = false`（声明空间不含 H）⇒ 若 `p(H)=0` 必须**剔除 −1**
  （漏剔 ⇒ 保守降级）

`_polyRootAtStrict` 用**相对容差**（与该点多项式量级比较），避免 `x=1e6` 附近的根被绝对容差吃掉；
求值失败一律 `return false`（fail-closed）。

#### 实测结果

| 输入 | 修前 | 修后 |
|---|---|---|
| `x^2-4=0, x>0`（golden g018） | 部分解（误报漏解） | **全部解** + `allSolutions=true`** ✅** |
| `x^2=2` 域 `[1,2]` | 谎报「全部解」 | **部分解** + `allSolutions=false` ✅（不回归）|
| `x^2-4=0, x<0` | — | 全部解，只给 −2 ✅ |
| `x>0` / `x∈(0,30)` / `x∈[1,30]` 三种等价写法 | — | 结论一致 ✅ |
| 无约束时 | — | 用 ℝ（`scope='R'`）✅ |

golden：**19/20 → 20/20**。

### 11.4 域无关上界契约（`domainFree: true`）：旧门控方向是反的

`solutionBounds(equations, vars)` **压根不接域参数**（`services/bounds.js:122`）——
Bézout `∏dᵢ`、BKK 混合体积、多齐次 Bézout、Milnor–Thom、Descartes
全都是**对整个 ℂⁿ / ℝⁿ 的全局断言**。

于是有一条很强的逻辑：**「找到数 == 全局上界」本身就蕴含「没有更多解」**。
若盒外真藏着解，找到数就会**超过**全局上界，与 `found == bound` 直接矛盾。
⇒ 对域无关的界，「盒外还有解」不是「可能」，而是**逻辑上不可能**。

实测双向验证旧 `domainUnproven` 门控**方向反了**：

| 算例 | 旧逻辑 | 数学事实 |
|---|---|---|
| `x^2=2` 域 `[−2,2]` | 报 `unknown` | 🔴 两真解都在盒内，**确实完备**（且与 `conclusion=全部解` 自相矛盾）|
| `x^2=2` 域 `[1,2]` | 走不到该分支 | 🔴 盒外有 `−√2`，**根本没拦住** |

即这条断言**没防住真正的谎报，却挡住了正确的结论**。真正的谎报现在由 §11.3 的
Sturm 声明空间证据独立堵住。`test/test-rootbound.js` 里钉旧行为的断言已推翻并重写（43 → 47 条，全过）。

### 11.5 🔴🔴 独立 P0：混合系统的解**从不**校验不等式

这不是上面那条链的副作用，是**另一个独立缺陷**，被 golden 之外的探针抓到：

```
solve('x^2=0, x>0')   ⇒   返回解 x = 0
```

**`x = 0` 违反 `x > 0`，真解集是空集。** 输出违反问题约束的解，比算不出来严重得多 ——
算不出只是「我不知道」，给错是骗人。

#### 病根链条（三段，逐段实测追出，不是推测）

1. **`lex.js` `parseCondition` 把严格性抹掉**：`x>0` 被归一成 `{type:'domain', min:0}`，
   `minStrict` 从未记录。原注释自己就写着「严格 > / < 在数值计算中转为 >= / <=」。
2. **`setup.js` 只能据此写 `op: ">="`** ⇒ `x = 0`「满足」。
3. **没有任何闸门校验不等式**：
   - `_finalResidualGate` 只代回**等式** AST（`setup.js` 明确「不等式不加入 equations 数组」）
   - 真正会校验不等式的 `verifyAllConstraints` **只在 `suan48` 里被调用**，
     而 `suan48` 首行就 `if (!state.isInequalityOnly) return`
   - ⇒ **混合系统（等式 + 不等式）的解从不经过任何不等式校验**

#### 为什么网格搜索躲不掉

`0` 恰好是网格采样**最易命中**的点（盒的中点 / 端点）；
而分支定界只能保证「不去盒外找」，**剔不掉恰好落在约束边界上的点**。

#### 因果验证（严谨做法：不能靠推测）

临时把 `_declaredIntervalOf` 的结果短路成全 ℝ 重跑，`x^2=0, x>0` **仍输出 `[[0]]`**（完全相同）
⇒ 证明该缺陷与 §11.3 的完备性口径改动**无关**，是既有独立缺陷。

> 教训：修完备性判定时顺手看到「答案也不对」，很容易当成同一件事的连带效应。
> 这次是**先隔离再归因**（短路掉新代码做对照实验），否则会把两个 bug 混成一个修，
> 修好一个以为另一个也好了 —— 留下一个会复发的雷。

#### 修法（三段全修）

- **`lex.js`**：`x∈[a,b]`/`x∈(a,b)` 按括号形态记 `minStrict`/`maxStrict`；
  `x>a`/`x>=a`、链式 `a<x<b` 同样保留严格性
- **`setup.js`**：两条路径都透传严格标志（`">"` / `">="`）；
  且**无比较符的区间形态**（`x∈[-30,30]` 等）过去**只**推 `domainConstraints`、不推 `inequalityConstraints`
  ⇒ 终态闸门完全看不到它，这条也补上
- **`solver.js`**：新增 `_finalConstraintGate(state)`（与 `_finalResidualGate` 对称的**不等式约束终态闸门**），
  调用位置紧随 `_finalResidualGate`（必须是所有写入路径的最后一个，否则就是假闸门）。
  配套 `_constraintsVerifiable(values, constraints, varNames)` 区分「**明确违反**」与「**无法验证**」：
  全部可求值时 `false` 即真违反；有一项求不出时 `false` 只说明验证不了，**不能据此剔除**
  （不因验证不了就误杀）。

#### 实测

| 输入 | 修前 | 修后 |
|---|---|---|
| `x^2=0, x>0` | 🔴 输出解 `x=0` | **0 解** ✅ |
| `x^2=0, x>=0` | 保留 0 | 保留 0 ✅（严格 / 非严格可区分）|
| `(x-1)^2=0, x>2` | — | 0 解 ✅ |
| `(x-1)^2=0, x>0` | — | 保留 1 ✅ |
| `x^3-x=0, x>0` | — | 只给 1（`x=0` 被正确剔除）✅ |
| `x∈(2,30)` 开区间端点 | 闸门看不到该约束 | 0 解 ✅ |
| `x∈[2,30]` 闭区间端点 | 闸门看不到该约束 | 保留 2 ✅ |
| `x∈(3,30)` | 闸门看不到该约束 | 0 解 ✅ |

#### 护栏

`test/dual-parity.mjs` 新增第 12 节（**25 条断言**，97 → **122 条，0 失败**），四组：

1. **(A) 搜索盒不得当完备性证据** —— 3 条
2. **(B) 问题约束必须当完备性证据** —— 8 条（含 golden g018 用例 + 三种等价写法一致性 + 对称方向）
3. **③ 严格不等式的端点必须被剔除** —— 9 条
4. **④ 四态自洽** —— 5 条

### 11.6 本轮改动清单（供审计）

| 文件 | 行数变化 | 内容 |
|---|---|---|
| `src/engine/numeric/polynomial.js` | 389 → 446 | 新增 `_sturmCountRange` / `_polyRootAtStrict`；`_sturmCountAllReal` 改为委托 |
| `src/engine/numeric/linear.js` | 380 → 453 | 新增 `_declaredIntervalOf`；重写 `_sturmCompletenessCheck` |
| `src/engine/pipeline/solver.js` | 1116 → 1155 | 新增 `_finalConstraintGate` / `_constraintsVerifiable`；门控①文案动态化 |
| `src/engine/operators/setup.js` | 146 → 178 | 两条路径透传严格性 + 区间形态也推进 `inequalityConstraints` |
| `src/engine/lex.js` | 429 → 431 | `parseCondition` 保留 `minStrict` / `maxStrict` |
| `src/engine/conclusion.js` | 171 → 173 | 两处 scope 白名单放开 `'declared'` + 踩坑留痕注释 |

导出数 440 → **443**（35 区块）。全量 `verify` **EXIT=0**（所有测试节 0 失败 + 指纹一致 55 文件 / 21603 行）。

> `_sturmCountAsc` **刻意保持原样不重构** —— 它的语义是 `(lo,hi]` 且端点必为有限数，
> 盒内诊断要的就是这个口径。混用两套端点语义会引入**难以察觉的 ±1 偏差**，
> 那类偏差不会让测试变红，只会让完备性判定悄悄说错话。
