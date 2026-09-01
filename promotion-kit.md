# 灵数求解器 · 推广曝光作战包

> 目标：在「备案等待期」内，用**不依赖备案/HTTPS** 的渠道让产品被知道、被使用。
> 合规边界：只推广已合规上线的入口（COS 国内网页版、Pages 海外网页版、GitHub clone 版 MCP）。不推备案中域名、不开网站、不公开裸 IP。

---

## 一、产品定位话术（复制即用，确定性领衔，诚实口径）

**一句话（中文）**
> 灵数求解器：一个**确定性**的方程组求解工具。同样的题永远得到同样的答案，没有大模型的随机与幻觉，每个解都能回代验证。网页打开即用，也能当 MCP 工具给 AI 智能体调用。

**一句话（英文）**
> Lingshu Solver — a **deterministic** equation-system solver. Same input, always the same verified answer — no LLM randomness, no hallucination. Runs in the browser or as an MCP tool for AI agents.

**诚实标注（务必保留，不承诺"保证不漏解"）**
> 确定性算法，已验证解数学保真 + 全局穷尽尽力而为。最多 6 个未知数（方程数须 ≥ 变量数，无"10方程"封顶），范围 ±100万。适合个人/会计/AI Agent 的轻量数值工具。

---

## 二、现在就能提交的目录（只需 GitHub URL，不卡备案）

按优先级排，全部免费、只需仓库地址 `https://github.com/genesis-plan/lingshu-solver`：

| 优先级 | 渠道 | 提交方式 | 说明 |
|---|---|---|---|
| P0 | **mcpservers.org** | 网页表单提交 | 1 天批准，简单，立刻有反向链接 |
| P0 | **awesome-mcp-servers** (92k★) | GitHub PR（YAML） | 生态最高曝光，PR 制，建议先有 Glama badge |
| P1 | **cursor.directory** | 网页提交 plugin+MCP | Cursor 用户直接发现 |
| P1 | **Glama** | 需 `glama.json`+`Dockerfile` | 拿质量分 badge，awesome 的入场券 |
| P1 | **PulseMCP** | 网页提交 | 垂直 MCP 流量 |
| P2 | **Official MCP Registry** | `mcp-publisher` | 官方注册表，最高信任 |
| P2 | **Docker MCP Registry** | 需 Dockerfile+LICENSE+SECURITY.md | PR 制 |

> 注：Smithery 因要求「运行中服务器的 HTTPS URL」，等 `hongchenlingjing.com` 备案后补填，不在本期。

---

## 三、内容种草文案（复制即发，被动获客）

### 3.1 知乎回答模板（搜「方程组怎么解」「非线性方程求解」「AI 怎么解方程」等高流量问题下答）
```
很多工程/财务问题最终都落成一个非线性方程组，Excel 解不了、手算太慢。
我写了一个纯网页的求解器，不用装任何东西，打开就能用：
👉 https://hclj-1409755229.cos.ap-guangzhou.myqcloud.com/lingshu-solver/index.html
（海外镜像：https://genesis-plan.github.io/lingshu-solver/）
最多 6 个未知数、方程数不限（须 ≥ 变量数），对非线性的做确定性全局求解，已验证的解保真。
比如 x²+y²=25, x+y=7 能直接解出 (4,3)(3,4)。也提供 MCP 版给 AI 智能体调用。
```

### 3.2 CSDN / 掘金 技术文大纲（标题含「实战」「从零」）
- 标题示例：《不用装软件，6 变量非线性方程组怎么秒解？一个开源求解器的实践》
- 结构：痛点 → 求解器原理（区间分支定界，白话讲）→ 在线试用链接 → 给 AI Agent 用的 MCP 接入 → 源码 GitHub
- 文末统一签名块 + 网页版链接（不写硬广，写「附开源工具」）

### 3.3 公众号短文（私域沉淀）
- 标题：《我做了个能解方程组的网页工具，免费给 AI 用》
- 短文 + 网页版二维码/链接，引导到 GitHub 看 MCP 用法。

### 3.4 V2EX / 少数派（中文极客）
- 帖：《分享一个纯前端方程组求解器 + MCP 工具，免费》
- 突出「零依赖、能当 AI 工具」。

### 3.5 英文社区（注意：Reddit 新号会被 spam 删，用老号或养号）
- **Hacker News** Show HN（永久反向链接，值得发）：
  > Show HN: Lingshu Solver – a browser-based deterministic algebraic equation solver (up to 6 vars) that also works as an MCP tool for AI agents. Same input, same verified answer — no LLM randomness. Zero deps.
  > https://github.com/genesis-plan/lingshu-solver
- **Product Hunt**（免费发布，真实反馈驱动下一版）：标题 + 一句话 + 网页版链接。
- **Reddit**：r/mcp、r/MCPservers、r/LocalLLaMA、r/ClaudeAI —— **务必用有 karma 的老号**，新号静默删除。

---

## 四、AI Agent 用户直达（开发者/智能体）
```
MCP 接入（stdio，需 Node）：
git clone https://github.com/genesis-plan/lingshu-solver
cd lingshu-solver && node mcp-server.js
客户端配置：
{ "mcpServers": { "lingshu-solver": { "command": "node", "args": ["/绝对路径/mcp-server.js"] } } }
```
（注：npx 版待发 npm 后可用；当前用 clone 路径版。）

---

## 五、合规红线（不可越）
- ❌ 不推 `hongchenlingjing.com`（备案中，提前开=驳回）
- ❌ 不开网站、不绑备案域名到国内服务器
- ❌ 不公开宣传裸 IP `159.75.154.206:3000`（仅小范围技术试用）
- ✅ 只推：COS 网页版 / Pages 网页版 / GitHub

---

## 六、效果衡量（用已有日志）
- 服务器 `/opt/lingshu/calls.log` 已含来源 IP，备案前若有外部真实调用（clone 版 MCP）能看见。
- GitHub 流量、目录批准数、网页版 COS 访问量（可在腾讯云 COS 控制台看请求数）作为曝光指标。

---

## 七、待办（我可代执行 / 需你确认）
- [ ] 我代发 **awesome-mcp-servers** PR（用你已有 PAT，立即曝光到 92k★ 仓库）—— 需你确认
- [ ] 我准备 **Glama** 所需 `glama.json` + `Dockerfile`（提升 awesome PR 通过率）
- [ ] 你用自己账号发：知乎/CSDN/掘金/公众号/V2EX 文案（上方复制即用）
- [ ] 你用老号发 Reddit / HN / Product Hunt
- [ ] 备案一到 → 填 Smithery + 切 HTTPS，全面对外
