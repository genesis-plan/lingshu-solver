# Lingshu Solver

**Category:** Certified Real-Root Computation

[![License](https://img.shields.io/badge/license-free%20for%20non--commercial%20%2F%20commercial%20needs%20written%20permission-blue)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-Streamable%20HTTP%20%2B%20stdio-blue)](https://modelcontextprotocol.io)
[![Deterministic](https://img.shields.io/badge/core-deterministic%20%2F%20non--LLM-green)](docs/en/01-product-role.md)
[![npm](https://img.shields.io/npm/v/lingshu-solver)](https://www.npmjs.com/package/lingshu-solver)

> A **deterministic** solver for systems of real equations. The same problem always produces the same
> answer — no language model, no randomness, no hallucination. Every solution it reports is
> **Krawczyk-certified** (`certified: true`), reproducible, checkable by substitution, and usable as an
> audit trail.

**Built for AI agents.** Connect it as an MCP tool and your model stops guessing arithmetic. It is a
deterministic, non-LLM numerical engine: same input, same answer, every reported solution interval-certified
and checkable by substitution. Three things matter to a calling agent, and all three are built in:

| What an agent needs | What this tool does |
|---|---|
| **A verdict it can branch on without guessing** | every result carries a `trust` block — a 7-level `trustLevel`, `safeToUse`, and `provenCount` / `candidateCount` so you never have to count solutions yourself |
| **Honesty about "no answer"** | an empty result is never silently "no real solution" — `meaningOfEmpty` distinguishes *proven* empty / not found within budget / input not solvable |
| **A way to fix its own mistake** | `verify` returns the certified corrected value and how far off the original was, so a wrong number becomes a repair, not a retry loop |

Humans can use the web page too (zero install) — but the design target is the agent: compact tool
descriptions, structured errors that say what to change, and no prose the model has to pay for on every turn.

🔬 **Live demo against the production endpoint:**
<https://hclj-1409755229.cos.ap-guangzhou.myqcloud.com/lingshu-solver/demo.html> — call the real MCP
endpoint right from the browser and watch `poly_roots` return certified real roots and `verify` judge a
candidate value. Thirty seconds is enough to see why "an LLM will mis-compute this, Lingshu can certify it".

| | |
|---|---|
| **Yes** | a deterministic (non-LLM) **numerical** engine for systems of real equations; algebraic equations and common transcendentals (`sin/cos/tan/log/exp/sqrt/abs`) all work |
| **No** | a symbolic CAS (no analytic derivation), an ODE solver, an integer-programming solver, and it does **not** claim guaranteed completeness |

---

## 30 seconds to start

**① AI agent (MCP — pick either form)**

```json
// local stdio — permanently free, unlimited, offline. Recommended.
{ "mcpServers": { "lingshu-solver": { "command": "npx", "args": ["-y", "lingshu-solver"] } } }
```

```json
// hosted endpoint — no install, always on, reachable over the public internet
{ "mcpServers": { "lingshu-solver": { "type": "http", "url": "https://hongchenlingjing.com/mcp" } } }
```

> **It also works if you never pay:** the hosted endpoint runs on an honor system — pass
> `"honorPaid": true` in the `solve` arguments and the call is released for free (no verification, no
> balance deduction). The `npx` local version and the web version are permanently free. If you do want to
> support it, see the [payment page](https://hongchenlingjing.com/pay/) — a corporate account, self-service
> crediting, effective immediately, no human approval anywhere in the loop.

**② Web (zero install, permanently free)**

- Main site: <https://hongchenlingjing.com/>
- Mirrors: <https://genesis-plan.github.io/lingshu-solver/> ·
  <https://hclj-1409755229.cos.ap-guangzhou.myqcloud.com/lingshu-solver/index.html>

Type equations into the box (for example `x^2 + y^2 = 25` and `x + y = 7`) and press solve. Everything is
computed inside your browser; the equations never leave your device.

**③ Developer**

```bash
git clone https://github.com/genesis-plan/lingshu-solver.git
cd lingshu-solver
node mcp-server.js          # start the local MCP (stdio) server
node test/regression.js     # standing regression suite
```

---

## Honest boundaries

| Dimension | What it means |
|---|---|
| Verified solutions | every reported solution is Krawczyk-certified (`tier=proven`); error is within the certified radius; mathematically faithful |
| Completeness | **best effort** at finding all solutions; when exhaustiveness could not be proven within budget it says so explicitly with `truncated=true` — it never claims completeness it did not prove |
| `truncated` semantics | only means "the global branch search did not finish inside the budget"; it does **not** mean solutions were missed. In most cases every real solution was found |
| Variables | ≤ 6 |
| Equations | 1–64 (server-side guard), and the count must be ≥ the variable count |
| Search range | default ±1e6 per variable; supply `domain` explicitly for fast-growing functions (`exp/sinh`) |
| Output precision | No user-facing switch. Internal computation is fixed at 6 decimals; the agent-facing display is 4 decimals (`precisionDecimals`) while `solutions[].values` keep full float precision |
| Determinism | no random branching; identical input always yields identical output, so caching is safe |
| Data | web version sends nothing upward; local version runs offline; the hosted endpoint does not persist equation contents |
| Dependencies | zero third-party dependencies (Node built-ins and standard browser APIs only) |

**Not guaranteed:** 100% exhaustiveness for every input, or convergence inside budget for highly
pathological systems. That is the honest floor of numerical mathematics ("guaranteeing all solutions"
is undecidable in the general case), not a defect to be fixed.

---

## Documentation

The machine-readable description for AI agents lives at [llms.txt](llms.txt).

Three of the design docs are in English; the deep-dive docs (design rationale, technical reference,
licence and pricing, contract, versioning, history) are still in their original Chinese. Each row below
tells you which is which.

| Doc | Language | Contents |
|---|---|---|
| [01 · Product role](docs/en/01-product-role.md) | **EN** | what it is, what problem it solves, who it is for, capabilities and limits, official wording |
| [02 · User guide](docs/en/02-usage-guide.md) | **EN** | the three forms, the MCP tool contract (input/output/errors), self-hosting, FAQ |
| [05 · Use cases](docs/en/05-use-cases.md) | **EN** | applicable scenarios (agent backend / multi-agent / off-chain computation / tax and finance control / on-prem / education / audit) and the ones that do not apply |
| [03 · Design ideas](docs/03-%E8%AE%BE%E8%AE%A1%E6%80%9D%E6%83%B3.md) | 中文 | six design principles, why it is trustworthy, why no LLM, what it deliberately refuses to do |
| [04 · Technical reference](docs/04-%E6%8A%80%E6%9C%AF%E5%8F%82%E8%80%83.md) | 中文 | mathematical framework, algorithm pipeline, operator table, hard spec constraints, test suite |
| [06 · Commercial licence and pricing](docs/06-%E5%95%86%E4%B8%9A%E6%8E%88%E6%9D%83%E4%B8%8E%E6%94%B6%E8%B4%B9.md) | 中文 | licence model, what is free, hosted-endpoint metering, enterprise annual licence, invoicing |
| [07 · Licence contract](docs/07-%E6%8E%88%E6%9D%83%E5%90%88%E5%90%8C.md) | 中文 | commercial licence template, clause walkthrough, signing flow |
| [08 · Versioning](docs/08-%E7%89%88%E6%9C%AC%E7%AE%A1%E7%90%86.md) | 中文 | version semantics, release flow and the consistency checklist, compatibility promises, history |
| [09 · Project history](docs/09-%E9%A1%B9%E7%9B%AE%E5%8E%86%E5%8F%B2.md) | 中文 | how it got from the original problem to where it stands now |

If you read only one page, read [01 · Product role](docs/en/01-product-role.md) — it states the limits and
the approved wording.

> Privacy and security commitments are published separately: [privacy.html](privacy.html).

---

## Licence (summary)

**Free for non-commercial use; commercial use requires written permission** (a proprietary licence of our
own, not an open-source licence):

- **Non-commercial, free:** personal study / research / teaching / evaluation; internal use by non-profit
  organisations and educational institutions; internal evaluation by teams with annual revenue up to RMB 1
  million (≤ 3 instances).
- **Commercial use needs prior written permission:** any product, service or business operated for profit,
  resale of SaaS/cloud/API, integration, embedding, or redistribution as a hosted service.
- **Version applicability:** this licence applies from `1.0.4`. Versions `1.0.3` and earlier remain under
  the Apache License 2.0 as published at the time (a historical fact, not revocable, and it does not extend
  to later versions).

Full terms in [LICENSE](LICENSE) · scope and pricing in
[06 · Commercial licence and pricing](docs/06-%E5%95%86%E4%B8%9A%E6%8E%88%E6%9D%83%E4%B8%8E%E6%94%B6%E8%B4%B9.md)
· contract in [07 · Licence contract](docs/07-%E6%8E%88%E6%9D%83%E5%90%88%E5%90%8C.md)

---

## Contact

- Business / licence / feedback: 553420544@qq.com (or open an issue in this repository)
- Copyright holder: Guangzhou Hongchen Lingjing Digital Technology Co., Ltd. (广州市红尘灵境数字科技有限公司)
- Filing: 粤ICP备2026031206号-3 · 粤公网安备44011402001444号
