# 贡献指南（Contributing）

感谢对**灵数求解器**的兴趣。本仓库采用与「灵脑 LingNao」一致的文档标准。

## 文档标准（必读）

公共产品仓库的文档**只服务两类人**：

1. **使用者** —— 怎么装、怎么配、怎么调（MCP / 网页 / CLI）。
2. **贡献者** —— 怎么 fork、架构在哪、怎么跑测试、怎么提 PR。

**不记录内部过程**：思考草稿、营销话术、曝光文案、内部走查/审计报告、调研纪要等**不进仓库根目录**，确有参考价值的归入 `docs/`，过时即删。

### 根目录文件约定
- `README.md` —— 唯一面向使用者的入口（装、配、调、能力边界）。
- `CHANGELOG.md` —— **按版本、只写对用户重要的变更**；不写逐次 commit 流水。
- `LICENSE` / `CONTRIBUTING` / `CODE_OF_CONDUCT` / `SECURITY` —— OSS 惯例文件。
- 其余深度资料放 `docs/`（如 `产品说明（完整版）.md`、`被发现性审计报告.md`、`promotion-kit.md`、`smithery-listing.md`、`roadmap.md`）。

## 本地开发

```bash
git clone https://github.com/genesis-plan/lingshu-solver.git
cd lingshu-solver
node mcp-server.js          # 启动 MCP stdio 服务端
node test/regression.js     # 回归套件（28 用例）
```

其他验证脚本：
```bash
node verify_core.js         # 引擎加载 + 6 个代表性用例
node mcp_smoke.js           # MCP 字节级冒烟（initialize/tools/list/tools/call）
node mcp_smoke2.js          # give_feedback + 错误结构化（不泄露堆栈）
node test/walkthrough-stdio.mjs   # stdio 端到端走查
node test/walkthrough-npx.mjs     # npx 端到端走查
node test/walkthrough-http.mjs    # 远程 HTTP 端到端走查
```

## 提 PR 前
- 跑通 `node test/regression.js`，确保 0 崩溃、known 命中率不降。
- 修改公共行为时，同步更新 `README.md` 的「能力边界」与 `CHANGELOG.md`。
- 不引入运行时第三方依赖（核心保持零依赖、离线、确定性）。

## 诚实优先
本产品对外口径坚持「已验证解数学保真 + 全局穷尽尽力而为」。任何改动不得暗示 100% 穷尽或声称不存在的保证；无法证明已穷尽时必须保留 `truncated` 标记。
