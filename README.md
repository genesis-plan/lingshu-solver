# 灵数求解器 · Lingshu Solver

> ≤6 维确定性实数方程组求解引擎 · 面向 AI 智能体与普通用户的 MCP 工具

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

**方式 A · 远程托管（零安装，免密即用）**
我们已部署常驻公网服务，直接填 URL 即可，无需本机装 Node：
```json
{
  "mcpServers": {
    "lingshu-solver": {
      "url": "http://159.75.154.206:3000/mcp"
    }
  }
}
```
> 端点：`http://159.75.154.206:3000/mcp`（Streamable HTTP）。服务运行于腾讯云轻量服务器，开机自启、崩溃自动拉起。
> ⚠️ 当前为**裸 IP + HTTP 临时端点**，`hongchenlingjing.com` 备案通过后我们将切换为 `https://hongchenlingjing.com/mcp` 固定 HTTPS 域名（届时更新此处）。此临时端点可用于对接测试，Smithery 等需 HTTPS 的平台待备案后正式接入。

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
> `npx` 版需本包发布到 npm 后才可用（正在处理）；在此之前可先 `git clone` 后用方式 C。

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
- `mcp-server.js` —— 零依赖 MCP stdio 服务端（手工 JSON-RPC 2.0 + Content-Length 分帧）
- `package.json` —— 标准元数据，`npx lingshu-solver` 一行接入
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
| **远程 HTTP（已上线）** | `http://159.75.154.206:3000/mcp` | 任何支持 Streamable HTTP 的 MCP 客户端，零安装 |
| 本地 stdio（npx） | `npx -y lingshu-solver` | 本机已装 Node，待 npm 发布后可用 |
| 本地 stdio（clone） | `node mcp-server.js` | 开发者 / 离线自托管 |

**远程 HTTP 服务端代码**：`http-mcp-server.js`（零依赖，仅用 Node 内置模块；与 `mcp-server.js` 共享 `solver-core.js` 求解核心，结果同源一致）。如需自托管远程服务：
```bash
PORT=3000 node http-mcp-server.js
```

### 2. 在 MCP 客户端（Claude Desktop / Cursor / Cline / VS Code 等）配置

**推荐 · 远程托管（零安装，已上线）：**
```json
{
  "mcpServers": {
    "lingshu-solver": {
      "url": "http://159.75.154.206:3000/mcp"
    }
  }
}
```

**本地 stdio · 一行命令（需先发 npm，暂未发布；当前请用 clone 版）：**
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
> 注：`npx lingshu-solver` 需本包发布到 npm 后才可用，我们正在处理。在此之前请用下方「手动指定本地路径」版（先 clone 仓库）。

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
  "recommended": { "values": [3, 4], "tier": "proven", "residual": 0 },
  "solutions": [ { "values": [3, 4], "tier": "proven", "residual": 0 }, ... ],
  "warnings": []
}
```
- `resultType`：`1=empty(无解)` / `2=finite(有限解)` / `3=infinite(无限解集，仅给距原点最近的推荐解)`。
- `tier`：`proven`（Krawczyk 认证）/ `candidate`（未证但可能为解）/ `structural`（结构推导）。

### 工具二：`give_feedback`

AI 智能体遇到卡点/错误/疑似问题时主动回报，仅落本地 `feedback.log`，不外传：
```json
{ "name": "give_feedback", "arguments": { "message": "x^2=4 期望2解", "context": "批量求解场景" } }
```

---

## 本地验证

```bash
node verify_core.js        # 引擎加载 + 6 个代表性用例
node mcp_smoke.js          # MCP 字节级冒烟（initialize/tools/list/tools/call）
node mcp_smoke2.js         # give_feedback + 错误结构化（不泄露堆栈）
node test/regression.js    # 三套常驻考卷回归（28 用例，known 命中率统计）
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

- 《灵数求解器_代码流程中文说明.md》—— 从解析到输出的完整内部流程（面向数学背景读者）
- 《灵数求解器商业化战略白皮书.md》—— 定位、能力边界、风险
- 发明专利申请书系列（已提交）

## 许可

Apache License 2.0 —— 见 [LICENSE](./LICENSE)。
