# 灵数求解器 · Lingshu Solver

[![License](https://img.shields.io/badge/license-非商业免费%20%2F%20商业须书面授权-blue)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-Streamable%20HTTP%20%2B%20stdio-blue)](https://modelcontextprotocol.io)
[![Deterministic](https://img.shields.io/badge/core-deterministic%20%2F%20non--LLM-green)](docs/03-设计思想.md)
[![npm](https://img.shields.io/npm/v/lingshu-solver)](https://www.npmjs.com/package/lingshu-solver)

> **确定性**实数方程组求解器 —— 同样的题永远得到同样的答案，不含大模型、无随机、无幻觉。
> 每个找到的解都经 **Krawczyk 区间认证**（`certified: true`），可复现、可回代验证、可进审计链。

**它给两种对象用**：普通用户（网页打开即用）与 AI Agent（标准 MCP 工具，一行接入）。

| | 说明 |
|---|---|
| **是** | 确定性（非大模型）的实数方程组**数值**求解引擎；代数方程与常见超越函数（`sin/cos/tan/log/exp/sqrt/abs`）均可 |
| **不是** | 符号 CAS（不输出解析推导）、微分方程求解器、整数规划求解器，也不是"保证不漏解"的完备判定器 |

---

## 30 秒上手

**① 网页版（零安装，永久免费）**

- 主站：<https://hongchenlingjing.com/>
- 备用镜像：<https://genesis-plan.github.io/lingshu-solver/> ｜ <https://hclj-1409755229.cos.ap-guangzhou.myqcloud.com/lingshu-solver/index.html>

在输入框写方程（如 `x^2 + y^2 = 25` 与 `x + y = 7`），点求解。计算全部在浏览器内完成，方程不出设备。

**② AI Agent 接入（MCP，两种形态任选）**

```json
// 本地 stdio —— 永久免费、不限次数、离线，推荐
{ "mcpServers": { "lingshu-solver": { "command": "npx", "args": ["-y", "lingshu-solver"] } } }
```

```json
// 远程托管端点 —— 免安装、常驻、公网直连（固定 ¥0.01/次；传 honorPaid 即免费放行）
{ "mcpServers": { "lingshu-solver": { "type": "http", "url": "https://hongchenlingjing.com/mcp" } } }
```

> **不想付费也照常用**：远程端点走**信任制** —— `solve` 入参加 `"honorPaid": true` 即免费放行（不验证、不扣余额）；
> 本地 `npx` 版与网页版永久免费。愿意支持请看[付款页](https://hongchenlingjing.com/pay/)（对公账户，付款后自助入账、立即生效，无需任何人审核）。

**③ 开发者**

```bash
git clone https://github.com/genesis-plan/lingshu-solver.git
cd lingshu-solver
node mcp-server.js          # 启动本地 MCP（stdio）服务端
node test/regression.js     # 常驻考卷回归
```

---

## 能力边界（诚实声明）

| 维度 | 说明 |
|---|---|
| 已验证解 | 每个找到的解经 Krawczyk 认证（`tier=proven`），误差 ≤ 认证半径，数学保真 |
| 穷尽性 | **尽力穷尽多解**；预算内未证明穷尽时显式标 `truncated=true`，**绝不谎称已完备** |
| `truncated` 语义 | 仅表示「全局分支未在预算内完全判定」，**不等于一定漏解**；多数情况下全部真解已找到 |
| 变量数 | ≤ 6 |
| 方程数 | 1–64 条（服务端护栏），且须 ≥ 变量数 |
| 数值范围 | 默认搜索域 ±1e6；对快增长函数（`exp/sinh`）建议显式给定 `domain` |
| 输出精度 | 固定 6 位小数（不提供位数切换） |
| 确定性 | 无随机分支，同输入永远同输出，可安全缓存 |
| 数据 | 网页端零上行；本地版离线；托管端点不落盘方程内容 |
| 依赖 | 零第三方依赖（只用 Node 内置模块与浏览器标准 API） |

**不保证**：对一切输入 100% 穷尽；对高度病态系统在预算内必收敛。
这是数值数学的诚实下界（'保证找到全部解'在一般情形下不可判定），不是待修缺陷。

---

## 文档

| 文档 | 内容 |
|---|---|
| [01 · 产品作用](docs/01-产品作用.md) | 它是什么、解决什么问题、给谁用、能力与边界、对外口径 |
| [02 · 使用指南](docs/02-使用指南.md) | 三种形态上手、MCP 工具契约（入参/出参/错误）、自托管部署、常见问题 |
| [03 · 设计思想](docs/03-设计思想.md) | 六条设计原则、为什么可信、为什么不用大模型、有意不做的事 |
| [04 · 技术参考](docs/04-技术参考.md) | 数学框架、算法流水线、49 个算子全表、规格硬约束、测试体系 |
| [05 · 应用场景](docs/05-应用场景.md) | 七类可落地场景（Agent 后端 / 多 Agent / 链下计算 / 财税风控 / 私有化 / 教育 / 审计）与不适用场景 |
| [06 · 商业授权与收费](docs/06-商业授权与收费.md) | 许可模型、免费范围、托管端点计费、企业年授权、发票与收款 |
| [07 · 授权合同](docs/07-授权合同.md) | 商业授权合同模板、关键条款说明、签署流程 |
| [08 · 版本管理](docs/08-版本管理.md) | 版本号语义、发布流程与一致性清单、兼容性承诺、版本历史 |
| [09 · 项目历史](docs/09-项目历史.md) | 从起因到当前的阶段沿革与定位 |

> 隐私与安全承诺另见：[privacy.html](privacy.html)（对外页面）。

---

## 许可（摘要）

**非商业免费 + 商业须书面授权**（自有《灵数求解器商业授权许可协议》，非开源协议）：

- **非商业用途免费**：个人学习/研究/教学/评测；非营利组织与教育机构内部使用；年营收 ≤ 100 万元的团队内部评估（≤ 3 实例）。
- **商业用途须事先取得书面授权**：任何以营利为目的的产品/服务/业务、SaaS/云/API 转售、集成嵌入、再分发托管，均须取得《商业授权协议》。
- **版本适用**：`1.0.4` 起适用本协议；`1.0.3` 及更早版本按其发布时的 Apache License 2.0 提供（历史事实，不可撤回，但不延伸至新版本）。

完整条款见 [LICENSE](LICENSE) ｜ 授权范围与报价见 [06 · 商业授权与收费](docs/06-商业授权与收费.md) ｜ 合同见 [07 · 授权合同](docs/07-授权合同.md)

---

## 联系

- 商务 / 授权 / 反馈：553420544@qq.com（亦可用仓库 Issues）
- 版权方：广州市红尘灵境数字科技有限公司
- 备案：粤ICP备2026031206号-3 ｜ 粤公网安备44011402001444号
