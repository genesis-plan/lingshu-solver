# Smithery 上架资料（填 URL 即发布）

> 用途：备案通过、HTTPS 端点就绪后，把本文件内容粘贴到 Smithery 注册表单即可发布。
> 当前阻塞：Smithery 要求 HTTPS URL；待 `hongchenlingjing.com` 备案完成 + 证书启用后，填 `https://hongchenlingjing.com/mcp`。

---

## 1. 基础信息

| 字段 | 内容 |
|---|---|
| Server Name (id) | `lingshu-solver` |
| Display Name | 灵数求解器 (Lingshu Solver) |
| 协议 (Transport) | Streamable HTTP |
| 端点 URL | `https://hongchenlingjing.com/mcp` |
| 分类 (Category) | `math` / `developer-tools` / `reasoning` |
| 标签 (Tags) | `solver`, `algebra`, `equation-system`, `math`, `mcp`, `agent-tool`, `代数`, `方程组` |
| 开源仓库 | https://github.com/genesis-plan/lingshu-solver |
| 许可证 | Apache-2.0 |

---

## 2. 一句话描述（Short Description）

**中文**：灵数求解器——面向 AI 智能体与开发者的**确定性**代数方程组求解 MCP 服务。同样的题永远得到同样的答案，没有大模型的随机与幻觉，每个解可回代验证。已验证解数学保真、全局穷尽尽力而为。

**English**：Lingshu Solver — a **deterministic** MCP service for algebraic equation systems, built for AI agents and developers. Same input always yields the same verified answer — no LLM randomness, no hallucination. Mathematically faithful, best-effort global exhaustion.

---

## 3. 详细介绍（Long Description，Markdown）

### 灵数求解器 (Lingshu Solver)

一个轻量、确定性的代数方程组求解服务，通过 MCP (Model Context Protocol) 暴露给 AI 智能体调用。

**核心能力**
- 求解**多变量非线性代数方程组**（最多 6 个未知量；方程数须 ≥ 变量数，**无"10方程"硬封顶**）
- **确定性**：同样的输入永远返回完全相同的实数解，无随机、无幻觉
- 返回**全部实数解**（区间分支定界，尽力全局穷尽）
- 每个解标注**认证层级**（`proven` / `likely` / `candidate`）与残差，诚实区分"已验证"与"近似"
- 支持域约束（如 `x ∈ [0, 10]`）、快速模式、可选数值精度档位

**设计原则（诚实优先）**
- 不虚构、不夸大：解的认证状态如实返回，绝不声称"保证不漏解"
- 计算固定 6 位小数有限网格，残差容差三档（Balanced 1e-6 / Precise 1e-9 / Fast 1e-3）
- 变量范围 **±100万（约 ±1e6）**

**适用场景**
- AI Agent 在推理中需要求解代数约束
- 教育、工程、会计中的方程组计算
- 作为更大推理管线的数值子模块

**快速开始（MCP 客户端配置）**
```json
{
  "mcpServers": {
    "lingshu-solver": {
      "url": "https://hongchenlingjing.com/mcp"
    }
  }
}
```

---

## 4. 工具 Schema（Smithery 表单需填写）

### 工具 1：`solve`

```json
{
  "name": "solve",
  "description": "确定性实数方程组求解（非大模型、无随机、同输入输出可复现）。输入含 '=' 的方程字符串数组与可选变量名/域约束，返回结构化结果：resultType(empty/finite/infinite)、每解含 values 与 tier(proven/likely/candidate) 及 residual、certified、recommended、truncated。变量≤6、方程≥变量数(≤64护栏)、默认域±1e6、固定6位小数。truncated=true表示未证明已穷尽（不等于一定漏解）。遇问题可调用 give_feedback。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "equations": {
        "type": "array",
        "items": { "type": "string" },
        "description": "方程数组，如 [\"x^2 + y^2 = 25\", \"x + y = 7\"]。支持 + - * / ^ 、sqrt、sin/cos/tan、log/exp、abs 等。"
      },
      "variables": {
        "type": "array",
        "items": { "type": "string" },
        "description": "未知量名称数组，如 [\"x\", \"y\"]，最多 6 个。"
      },
      "domain": {
        "type": "array",
        "items": {
          "type": "object",
        "properties": {
            "variable": { "type": "string" },
            "min": { "type": "number" },
            "max": { "type": "number" }
          }
        },
        "description": "可选，变量定义域约束，如 [{variable:\"x\", min:0, max:10}]。"
      },
      "fastMode": {
        "type": "boolean",
        "description": "可选，true 使用 Fast 档（残差 1e-3，更快）。默认 false（Balanced 1e-6）。"
      }
    },
    "required": ["equations", "variables"]
  }
}
```

### 工具 2：`give_feedback`

```json
{
  "name": "give_feedback",
  "description": "提交使用反馈、报错或建议，帮助完善求解器。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "type": { "type": "string", "enum": ["bug", "feature", "praise", "other"] },
      "message": { "type": "string" },
      "contact": { "type": "string", "description": "可选联系方式" }
    },
    "required": ["type", "message"]
  }
}
```

---

## 5. 示例对话（供 Smithery 展示）

**用户/Agent**：帮我解 `x² + y² = 25` 且 `x + y = 7`
**调用**：`solve(equations=["x^2 + y^2 = 25","x + y = 7"], variables=["x","y"])`
**返回**：两个解 `(4, 3)` 与 `(3, 4)`，均 `proven`，残差 < 1e-6。

---

## 6. 发布检查清单
- [ ] `https://hongchenlingjing.com/mcp` 可达且返回 JSON-RPC 握手
- [ ] `tools/list` 返回上述两个工具
- [ ] 服务器 systemd 自启、崩溃拉起已验证
- [ ] 描述无"保证不漏解"等绝对化承诺（保持诚实口径）
- [ ] 贴上 GitHub 仓库与许可证链接
