# 真·走查实测报告（官方 MCP SDK 端到端）

> 目的：用户要求"模拟用户 / 智能体 / 大模型走一次流程，发现它、使用它"。
> 本轮用**真实官方客户端 `@modelcontextprotocol/sdk@1.30.0`**（Claude / Cursor / Cline 同源）做端到端走查，而不是只看 HTTP 200 或手动 Content-Length 帧。

## 一、走查方法

| 路线 | Transport | 端点 |
|------|-----------|------|
| A 路（远程 HTTP） | `StreamableHTTPClientTransport` | 生产服务 `http://159.75.154.206:3000/mcp` |
| B 路（本地 stdio） | `StdioClientTransport` 拉起 `node mcp-server.js` | 本地子进程 |

覆盖步骤：`initialize` 握手 → `tools/list` → `tools/call(solve)` → 确定性复测（同输入连跑 3 次字节比对）→ 错误路径 → `give_feedback`。

## 二、本轮新发现（3 个真实客户端兼容性问题）

1. **stdio 帧格式不兼容（致命）**
   手写 stdio 服务用 `Content-Length` 分帧，但官方 SDK 客户端用**换行符分隔 JSON**
   （`serializeMessage` = `JSON + '\n'`；`ReadBuffer` 按行解析）。双向均不匹配 → SDK 永远收不到
   `initialize` 响应 → `Request timed out`。这是 B 路最初超时的根因。

2. **`GET` / `DELETE /mcp` 返回 404（规范不符）**
   官方 SDK 在 `initialized` 后会异步 `GET /mcp` 开 SSE 流；规范允许服务端以 **405** 表示
   "不支持 SSE 流"，但本服务返回 404 → SDK 触发 `onerror`（"Failed to open SSE stream"）。
   虽不阻断基本调用，但真实客户端会收到错误信号、日志被污染。

3. **工具错误用 JSON-RPC `error` 而非 `isError`（体验问题）**
   非法输入时服务端返回 JSON-RPC `error` 帧，SDK 的 `callTool` 直接**抛异常**，
   接入的 LLM 拿不到可读错误、无法自愈。应返回工具级 `result:{ content, isError:true }`。

> 与上一轮复盘的 `result` 未包裹 bug 同属一类：**手写 MCP 服务必须等于官方 SDK 的线格式**。
> 仅验 HTTP 200 或手动 Content-Length 帧会漏掉这些问题。

## 三、已修复

- `mcp-server.js`：`send()` 改为 `JSON + '\n'`；stdin 解析改为按行（换行符分隔），与官方 SDK 对齐。
- `http-mcp-server.js`：`GET` / `DELETE /mcp` 返回 **405**（`Allow: POST`）；`tools/call` 错误改为 `isError:true` 工具结果。
- 两文件错误 framing 同步修正，保持双端（stdio / HTTP）一致。

## 四、验证结果（全部用真实 SDK 跑通）

| 步骤 | A 路（远程 HTTP） | B 路（本地 stdio） |
|------|------------------|-------------------|
| initialize 握手 | ✅ | ✅ |
| tools/list 看到 solve / give_feedback | ✅ | ✅ |
| solve 真实求解（x²+y²=25, x+y=7 → (4,3)，certified=proven） | ✅ | ✅ |
| 确定性：同输入连跑 3 次字节级一致 | ✅ | ✅ |
| 含超越函数 sin/cos：解出 28 个解 | — | ✅ |
| 错误路径：isError=true（LLM 可读） | ✅ | ✅ |
| give_feedback 闭环 | ✅ | — |
| `GET /mcp` 返回 405（无 onerror） | ✅ | — |

结论：**修复后，灵数求解器的 MCP 服务（HTTP 远程 + stdio 本地）已能被真实 MCP 客户端端到端调用**，
包括求解、确定性、错误处理与反馈闭环。

## 五、回归测试落库

- `test/walkthrough-http.mjs` —— 远程 HTTP 真 SDK 走查（默认指向生产端点，可用 `MCP_URL` 覆盖）。
- `test/walkthrough-stdio.mjs` —— 本地 stdio 真 SDK 走查（从仓库根运行，自动拉起 `mcp-server.js`）。

**建议：今后任何 MCP 相关改动，提交前必跑这两个脚本（需 `npm i @modelcontextprotocol/sdk`）。**
仅"HTTP 200"或"手动帧"验证不足以证明真实客户端可用。

## 六、遗留 / 待办

- 本地测试若用 3099 端口，注意 Windows 下 `pkill` 不可靠，旧实例会残留占端口；建议每次用新端口或先清理。
- `hongchenlingjing.com` 备案批下 → 切 HTTPS → Smithery 正式发布（走 `smithery.yaml`）。
- 安全收尾：服务器密码 / COS 密钥等建议择期更换。
