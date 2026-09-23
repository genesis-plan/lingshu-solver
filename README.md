# 灵数求解器 · Lingshu Solver

[![License](https://img.shields.io/github/license/genesis-plan/lingshu-solver)](LICENSE)
[![Stars](https://img.shields.io/github/stars/genesis-plan/lingshu-solver?style=social)](https://github.com/genesis-plan/lingshu-solver/stargazers)
[![Last Commit](https://img.shields.io/github/last-commit/genesis-plan/lingshu-solver)](https://github.com/genesis-plan/lingshu-solver/commits)
[![MCP](https://img.shields.io/badge/MCP-Streamable%20HTTP-blue)](https://modelcontextprotocol.io)
[![Deterministic](https://img.shields.io/badge/core-deterministic%20%2F%20non--LLM-green)](https://genesis-plan.github.io/lingshu-solver/)

> **确定性**实数方程组求解引擎 · 面向 AI 智能体与普通用户的 MCP 工具
> 同样的题永远得到同样的答案，没有大模型的随机与幻觉，每个解都能回代验证。免费、网页打开即用、也能被 AI 智能体直接调用。

灵数求解器（代号 Epsilon，V4.1）是一个**离线、确定性、零数据**的实数方程组求解器，
覆盖 ≤6 个变量、实数解、轻量数值定位。它不要求用户提供初值，采用区间算术做保守收缩 +
Krawczyk 算子做解认证，并尽力穷尽多解。

👉 **给用户看的产品介绍（大白话，帮你看懂它能干嘛、适不适合你）**：[点这里](intro.html) ｜ [国内 COS 在线版](https://hclj-1409755229.cos.ap-guangzhou.myqcloud.com/lingshu-solver/intro.html)

---

## 🚀 快速上手（30 秒）

### 如果你完全不懂技术 —— 直接用网页版
**打开这个链接就能用，不用安装任何东西：**
👉 **https://genesis-plan.github.io/lingshu-solver/** （GitHub Pages，海外/通用）

**国内用户（更快，腾讯云 COS 托管）：**
👉 **https://hclj-1409755229.cos.ap-guangzhou.myqcloud.com/lingshu-solver/index.html**

在输入框写方程（例如 `x^2 + y^2 = 25` 和 `x + y = 7`），点求解即可。
页面里有 6 个示例按钮，点一下就知道它能解什么。

### 如果你是 AI 用户（Claude / Cursor / Cline 等）

**方式 A · 远程托管（已上线，开箱即用）**

常驻公网服务已开放，**HTTPS 端点：`https://hongchenlingjing.com/mcp`**（开机自启、崩溃自动拉起，任何支持 Streamable HTTP 的 MCP 客户端可直接连）。

```json
{
  "mcpServers": {
    "lingshu-solver": {
      "type": "http",
      "url": "https://hongchenlingjing.com/mcp"
    }
  }
}
```

> **不付钱也能用。** 这个端点按次计费（**固定 ¥0.01 / 次**），但走「**信任制**」：`solve` 入参加
> `"honorPaid": true`（声明本次为个人/评估用途）即**免费放行，不验证、不扣余额**。
> 不想付费请直接用方式 B / 网页版（永久免费、不限次）；愿意支持就走
> [付款页](https://hongchenlingjing.com/pay/)（对公账户，**付款后自助入账，立即生效**，无需任何人审核）。

**方式 B · 本地 stdio（需本机 Node）**
```json
{
  "mcpServers": {
    "lingshu-solver": {
      "command": "npx",
      "args": ["-y", "lingshu-solver"]
    }
  }
}
```
> `npx` 版已发布到 npm，现在即可一键 `npx -y lingshu-solver`。如需最新源码也可 `git clone` 后用方式 C。

**方式 C · 本地 clone + 指定路径**
```bash
git clone https://github.com/genesis-plan/lingshu-solver.git
cd lingshu-solver
node mcp-server.js
```
MCP 配置：
```json
{ "mcpServers": { "lingshu-solver": { "command": "node", "args": ["本地绝对路径/灵数求解器/mcp-server.js"] } } }
```

### 如果你是开发者
```bash
git clone https://github.com/genesis-plan/lingshu-solver.git
cd lingshu-solver
node mcp-server.js        # 启动 MCP 服务端
node test/regression.js   # 跑回归测试（28 用例）
```

---

本仓库包含：
- `index.html` —— 单文件产品（浏览器内 UI + 已验证核心脚本 `<script id="solver-core">`）
- `solver-core.js` —— Node 引擎加载器（读取 index.html 核心脚本，零依赖，供 MCP/测试复用）
- `mcp-server.js` —— 零依赖 MCP stdio 服务端（手工 JSON-RPC 2.0 + 换行符分隔 JSON，与官方 MCP SDK 线格式对齐）
- `package.json` —— 标准元数据，`node mcp-server.js` 本地启动即作为 MCP 工具（发布 npm 后亦可 `npx lingshu-solver`）
- `test/` —— 回归套件 + 冒烟测试 + 三套常驻考卷

---

## 能力边界（诚实声明）

| 维度 | 说明 |
|---|---|
| 已验证解 | 每个找到的解都经 Krawczyk 认证（`tier=proven`），误差 ≤ 认证半径，数学保真 |
| 穷尽性 | **尽力穷尽多解**；极端病态（雅可比高度奇异、解簇极近）在预算内可能遗漏个别解，此时显式标记 `truncated=true`，**绝不谎称已穷尽** |
| `truncated` 语义 | 仅表示「全局分支未在预算内完全判定所有盒子（无法证明已穷尽）」，**不等于一定遗漏**；绝大多数情况全部真解已找到 |
| 变量数 | ≤6 |
| 数值范围 | 默认搜索域 ±1e6；对快增长函数（exp/sinh）或大域，建议显式给定 `domain` 以避免剪枝失效 |
| 确定性 | 无随机分支，同输入永远同输出 |
| 部署 | 纯本地、离线、零数据（无网络、无存储、无第三方依赖） |

**不保证**：对一切输入 100% 穷尽；对高度病态系统在预算内必收敛。这些是诚实边界，不是缺陷。

---

## 作为 MCP 工具使用

### 1. 三种接入形态

| 形态 | 端点 / 命令 | 适用 |
|---|---|---|
| **远程 HTTP（已上线）** | `https://hongchenlingjing.com/mcp`（常驻、HTTPS、崩溃自动拉起） | 任何支持 Streamable HTTP 的 MCP 客户端，零安装 |
| 本地 stdio（npx） | `npx -y lingshu-solver` | 本机已装 Node，npm 已发布，直接可用 |
| 本地 stdio（clone） | `node mcp-server.js` | 开发者 / 离线自托管 |

**远程 HTTP 服务端代码**：`http-mcp-server.js`（零依赖，仅用 Node 内置模块；与 `mcp-server.js` 共享 `solver-core.js` 求解核心，结果同源一致）。如需自托管远程服务：
```bash
PORT=3000 node http-mcp-server.js
```

### 2. 计费（**仅限「托管远程端点」**）

**本地 stdio（npx / clone）与网页版永久免费、无次数限制、离线不外传，且以后也不会收费。**
只有**我们自托管的远程 HTTP 端点**按次收费 —— 买的是「免安装、常驻、公网可直连、带账单台账」这份运维，不是数学能力。

| 项 | 值 |
|---|---|
| 单价 | **固定 ¥0.01 / 次**（每次 `solve` 1 分钱）—— **不预充、无套餐、无其他档位、不设折扣** |
| 计费时机 | **仅在成功产出求解结果时扣费** |
| 不扣费 | 输入不合法、方程无法解析（响应里 `diagnostics.inputError` 非空）、内部错误、余额不足 |
| **免费路径** | `solve` 传 `"honorPaid": true` → **免费放行**（不验证、不扣余额）。本服务按**信任制**运转：愿意支持的付费，不愿意的照常使用 |
| 免费工具 | `initialize` / `tools/list` / `give_feedback` / 余额查询 / 价格查询 |
| 凭证 | 请求头 `Authorization: Bearer <key>`（亦支持 `x-api-key` 或 `?key=<key>`） |
| 注册账号 | **不需要**。凭证即身份（不设用户名、不设密码、不收邮箱手机号） |
| 个人信息 | **不收集、不存储**。服务端只留凭证的 SHA-256 与订单/余额元数据；你提交的联系方式与自由文本一律被丢弃 |
| 入账 | **付款后自助入账**：调 MCP `pay` 工具传 `{"orderId":"<订单号>","selfReportPaid":true}` → 立即入账、立即放行。**无需等待任何人工审核** |
| 传输安全 | 接入请用 `https://hongchenlingjing.com/mcp`：Bearer 凭证走明文 HTTP 会在公网裸奔 |

托管端点自带价格与下单接口（**域名为 `hongchenlingjing.com`**）：
```bash
curl  https://hongchenlingjing.com/pricing                                 # 价格表（无需凭证）
curl -X POST https://hongchenlingjing.com/pay/order \
      -H 'Content-Type: application/json' -d '{}'                          # 下单（每次恒为 1 次 = 1 分），响应给出 orderId 与 apiKey
curl  https://hongchenlingjing.com/credit -H 'Authorization: Bearer <key>'  # 查余额（免费）
```
人工付款入口（对公账户 + 聚合码，**付款后自助入账，立即生效**）：<https://hongchenlingjing.com/pay/>

**我们自己怎么核对营收**（诚实分栏，不把「凭声明的额度」当收入）：
`/admin/ledger` 同时给出 `verifiedRevenueCents`（对公流水核对过的**真营收**）与 `selfReportedCents`
（凭付款方声明的额度）；`/health` 给出 `selfReportClaims` 与 `honorClaims` 两个独立计数。
**声明类额度不计入营收** —— 这一步是为了不虚报。

> **自托管者不受此计费约束。** `http-mcp-server.js` 的计费默认**关闭**（`LS_METERING=off`），
> 只有显式 `LS_METERING=on` 才启用 —— clone 出去自己跑，全免费，不会被我们收钱。
> 相关环境变量：`LS_METERING` / `LS_PRICE_CENTS`（默认 1 分）/ `LS_ADMIN_TOKEN`（管理端点凭证，
> **未设置时管理端点整体返回 503**，fail-closed，不存在「无凭证即可加钱」的口子）/
> `LS_ADMIN_LOOPBACK_ONLY`（默认开：管理端点只接受本机回环，运维走 SSH 隧道，管理令牌绝不经公网）/
> `LS_REQUIRE_TLS`（默认关；置 on 后携带凭证的调用必须是 HTTPS，否则拒绝并提示改用 HTTPS）/
> `LS_PAY_TO`（收款方式，未配置时订单会明确标注「不可付款」）。
>
> **到账走「对公收款」——对公静态收款 + 付款方自助入账，不接任何支付平台商户 API。**
> 下单返回结构化付款意图（`payIntent` 块：订单号、对公码、备注、Agent 可机读步骤）；付款人向公司对公账户
> （`LS_PAY_TO`，运行时与代码内钉死的广州市红尘灵境数字科技有限公司·工行户 `3602026809201658423` 比对）付款后，
> **再调一次 `pay` 传 `{"orderId":"<订单号>","selfReportPaid":true}` 即立即入账、立即放行** ——
> 全程**零人工**：收款方不需要跑任何对账脚本、不需要看任何流水。
> 为什么敢不验证：同一道门的 `honorPaid:true` 本来就免费 ⇒ 「声明已付」不会造成额外损失，只是让诚实付款的人不必等。
> 自助入账的单在账本里标注 `amountVerified:false` / `creditedBy:self_report`；真营收仍以对公流水核对为准
> （可选跑 `reconcile-bank.js`，非必经流程）。
> **收款账号防替换护栏**：`LS_PAY_TO` 被改成别的账号即 fail-closed 拒绝生成付款意图（防收款账号被换）；
> 收款码链接被指向非银联官方址同样拒绝。
>
> 凭证在服务端只存 **SHA-256**（不存明文）；每次扣费写入只增审计流水 `credits.json.ledger.jsonl`。

### 3. 在 MCP 客户端（Claude Desktop / Cursor / Cline / VS Code 等）配置

**推荐 · 本地 stdio 零安装（npm 已发布，现在即可用）：**
```json
{
  "mcpServers": {
    "lingshu-solver": {
      "command": "npx",
      "args": ["-y", "lingshu-solver"]
    }
  }
}
```
> **远程 HTTP 端点（零安装，已上线）：**
> ```json
> { "mcpServers": { "lingshu-solver": { "type": "http", "url": "https://hongchenlingjing.com/mcp" } } }
> ```
> 该端点按次计费（固定 ¥0.01/次），但**不付费也能用**：`solve` 传 `"honorPaid": true` 即免费放行。
> 愿意支持请见[付款页](https://hongchenlingjing.com/pay/)（付款后自助入账，立即生效）。

**本地 stdio · 一行命令（npm 已发布，直接可用）：**
```json
{
  "mcpServers": {
    "lingshu-solver": {
      "command": "npx",
      "args": ["-y", "lingshu-solver"]
    }
  }
}
```
> 注：`npx -y lingshu-solver` 已发布到 npm，直接可用。如需指定本地路径，用下方「手动指定本地路径」版（先 clone 仓库）。

**备选 · 手动指定本地路径（已 clone 仓库时）：**
```json
{
  "mcpServers": {
    "lingshu-solver": {
      "command": "node",
      "args": ["把这里替换成你本地的绝对路径/灵数求解器/mcp-server.js"]
    }
  }
}
```

> 手动版需将 `args` 中的路径替换为你本机的 `mcp-server.js` 绝对路径（例如 `C:/Users/你的用户名/Desktop/灵数求解器/mcp-server.js`）。npx 版无需此步。

### 工具一：`solve`

输入：
```json
{
  "equations": ["x^2 + y^2 = 25", "x + y = 7"],
  "variables": ["x", "y"],
  "domain": { "x": [-30, 30], "y": [-30, 30] }
}
```
- `equations`：方程字符串数组（必填），支持 `+ - * / ^ sqrt log sin cos tan exp abs`，以及 in-text 域约束 `"x ∈ [-30,30]"`。
- `variables`：变量名数组（可选，不填则按出现顺序自动识别，最多 6 个）。
- `domain`：显式搜索域（可选）。**对"有限解·部分"演示或快增长函数建议给定**，否则默认 ±1e6 可能剪枝失效并触发 `truncated`。

> 输出精度固定 6 位小数（产品规格「6位小数有限网格」），不提供位数切换；解点 `values` 经网格吸附，实际残差通常 ≤ 1e-9。

输出（节选）：
```json
{
  "resultType": 2,
  "resultTypeName": "finite",
  "certified": true,
  "truncated": false,
  "precisionDecimals": 6,
  "solutionCount": 2,
  "summary": "找到 2 个实数解（全部经 Krawczyk 区间认证）。",
  "recommended": { "values": [3, 4], "tier": "proven", "certified": true, "text": "x=3.000000, y=4.000000", "internals": { "residual": 0, "certifiedRadius": 0.00001 } },
  "solutions": [ { "values": [3, 4], "tier": "proven", "certified": true, "text": "x=3.000000, y=4.000000", "internals": { "residual": 0, "certifiedRadius": 0.00001 } }, ... ],
  "warnings": []
}
```
- `resultType`：`1=empty(无解)` / `2=finite(有限解)` / `3=infinite(无限解集，仅给距原点最近的推荐解)`。
- `summary`：中文一句话总览，适合直接展示给用户或日志。
- 每解字段：`values`（6 位小数数值数组）、`tier`、`certified`、`text`（人类可读，如 `"x=3.000000, y=4.000000"`）；残差等内部数值收在 `internals` 子块，机器可整块跳过以降低 token 噪音。
- `tier`：`proven`（Krawczyk 认证）/ `candidate`（未证但可能为解）/ `structural`（结构推导）。

### 工具二：`give_feedback`

AI 智能体遇到卡点/错误/疑似问题时主动回报，仅落本地 `feedback.log`，不外传：
```json
{ "name": "give_feedback", "arguments": { "message": "x^2=4 期望2解", "context": "批量求解场景" } }
```

---

## 本地验证

```bash
node verify_core.js                    # 引擎加载 + 6 个代表性用例
node test/regression.js                # 三套常驻考卷回归（28 用例，known 命中率统计）
node test/verify_paste.js              # 粘贴容错专项（7 例）
node test/verify_issueA.js             # 周期/高频单变量多解专项（15 例）
node test/verify_compliance.js         # 输入门禁专项（20 例）
```

---

## 示例（6 类结果覆盖）

| 标题 | 方程 | 预期 |
|---|---|---|
| 最少 1 变量 | `x^2 = 4` | 2 解 |
| 最多 6 变量 | 6 元三对角线性 | 唯一解 |
| 空集无解 | `x+y=3` 与 `x+y=5` | 空集（sound 证无解） |
| 有限解·全部 | 圆 × 双曲线 `x²+y²=4, xy=1` | 4 解全认证 |
| 有限解·部分 | `sin(20x)=0.5, sin(20y)=0.5`（域 [-30,30]） | 多解 + `truncated` 横幅 |
| 无限解·推荐 | `x+y=3` | 无限集，推荐 (1.5,1.5) |

---

## 文档

- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) —— 产品现状：数学框架 / 结构框架 / 代码框架 / 算法框架 / 处理流程（忠实于真实实现）
- [CHANGELOG.md](./CHANGELOG.md) —— 能力、边界与修复记录
- 发明专利申请书系列（已提交）

## 许可

**非商业免费 + 商业须书面授权**（自有《灵数求解器商业授权许可协议》，非开源协议）：

- **非商业用途免费**：个人学习/研究/教学/评测，非营利组织与教育机构内部使用，小团队（年营收 ≤100 万元）内部评估（≤3 实例）。
- **商业用途须事先取得书面授权**：任何以营利为目的的产品/服务/业务、SaaS/云/API 转售、集成嵌入、再分发托管，均须联系版权方（553420544@qq.com）取得《商业授权协议》。
- **版本适用**：1.0.4 起适用本协议；1.0.3 及更早版本按其发布时的 Apache License 2.0 提供（历史事实，不可撤回，但不延伸至新版本）。

完整条款见 [LICENSE](./LICENSE)。
