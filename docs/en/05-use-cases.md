# 05 · Use cases

> Where it genuinely fits, how to wire it in, what you get, and — equally important — **when not to use it**.
> Integration is always MCP (local stdio or remote HTTP); the difference between scenarios is only *who calls
> it and what they do with the result*.

---

## 0. First, the decision rule

If **any two** of the following hold, this tool has value:

1. **The result must be reproducible** — the same input has to give the same answer (otherwise you cannot cache, audit, or regression-test it).
2. **Being wrong has a cost** — the result feeds pricing, risk control, reporting, or a simulation convergence criterion downstream.
3. **You need a certificate that "this number was computed correctly"** — something a person or another system can check independently, not "another model also said so".
4. **The data cannot leave the domain** — the equations themselves are business information and must not go to an external service.

Conversely, if what you need is "simplify this expression for me" or "derive this formula", you want a symbolic
CAS, not this.

---

## 1. Math backend for AI agents (most common, lands first)

**Pain**: ask an LLM to do arithmetic and it will happily invent numbers; ask twice and you may get two
answers. One fabricated digit anywhere in the chain and everything downstream is wrong.

**How**: hang `solve` off the agent's toolset (one MCP config line, see [02 · User guide](02-usage-guide.md#3-connecting-an-ai-agent-mcp)).

**Typical call**:

```json
{ "equations": ["2x + 3y = 12", "x - y = 1"], "domain": { "x": [-100, 100], "y": [-100, 100] } }
```

**What you get**: structured solutions + `certified: true` + certification radius + back-substitution residual.
The agent can replace "I computed it" with "I called a certified solver; here is the result, here is the certificate".

**Watch out**:
- Equations must be **separate array elements** (cramming them into one element yields zero solutions).
- When you see `truncated: true`, tell the user honestly ("there may be more solutions, but I cannot prove
  exhaustion here") rather than presenting it as the complete answer.

---

## 2. Trustworthy intermediate results in multi-agent collaboration

**Pain**: agent A computes a number and hands it to agent B, which can only *believe* it. If A computed it with
an LLM, the whole chain is only as reliable as its weakest link.

**How**: insert `solve` as a **neutral third-party node**. Each party trusts the *certified result*, not the other
agent's arithmetic; the certification fields (`certified`, `tier`, `certifiedRadius`) are themselves a transferable credential.

**What you get**: a checkable certificate that "this number really satisfies the equation", passable along with the
message and re-verified independently by either side.

**Watch out**: the certificate proves the *solution* satisfies the *given* equations and passed interval
verification — **it does not prove the equations were modelled correctly**. Feed it wrong equations and it will
certify the wrong answer.

---

## 3. Off-chain computation / verifiable computation certificate

**Pain**: some pipelines require "compute off-chain, trust on-chain", but recomputing is expensive and blind
trust is risky.

**How**: run solving as an off-chain step and store the certified fields alongside the output as a verifiable
certificate.

**What you get**: determinism + reproducibility ⇒ anyone re-running the same input gets a **byte-identical**
result and the same certification conclusion.

**Watch out**: this is **deterministic and reproducible, not a zero-knowledge proof**. Do not treat it as a zk scheme.

---

## 4. A verification layer for finance / tax / risk control / RPA

**Pain**: automation pipelines contain a batch of "must be exact" intermediate quantities (allocation factors,
solving for a rate, limit balancing, reconciliation ties-out). A mistake becomes a wrong ledger entry or a
wrong decision immediately.

**How**: call `solve` at each computation point and route on the certification result:
**certified → post automatically; uncertified / `truncated` → route to human review**.

```
compute request → solve → certified? ──yes──▶ post automatically (certificate written to logs)
                                │
                                └──no───▶ MANUAL_REVIEW queue (with diagnostics attached)
```

**What you get**: a fail-closed gate — when it is not sure it does not let the number through, instead of
guessing a number into the books.

**Watch out**: this is a **math computing tool** and produces **no** tax, audit or legal conclusion. Treat it as a
computing and checking component; conclusion and compliance responsibility stay with the user.

---

## 5. Enterprise private deployment / intranet embedding

**Pain**: many industries (finance, manufacturing, healthcare, government) cannot send business parameters to an
external service, yet still need a reliable equation solver internally.

**How**:
- Run `npx -y lingshu-solver` directly (local stdio, offline, nothing leaves); or
- Self-host `http-mcp-server.js` (`PORT=3000 node http-mcp-server.js`), where **metering is off by default**, so an
  intranet deployment is simply an internal service (deployment and config in [02 · User guide](02-usage-guide.md#6-self-hosting-the-http-form)).

**What you get**: data stays in-domain, zero third-party dependencies (clean supply chain), runs in an offline
environment, callable by both internal systems and agents.

**Watch out**: when self-hosting, configure your own nginx security headers and rate limits; keep the admin
endpoints on their default double lock (loopback + token).

---

## 6. Education and self-study

**Pain**: a student asks an LLM a math question and gets a plausible-looking answer they cannot check.

**How**: use the web form directly (<https://hongchenlingjing.com/>), or run the local build inside your notes / toolchain.

**What you get**:
- Deterministic answers you can reproduce and compare against homework or the textbook;
- Every solution is **checkable by back-substitution** (plug it back in and see if both sides match) — which is
  itself a good way to learn;
- When it cannot solve it, it says whether that is "proven empty" or "budget exhausted", instead of inventing something.

**Watch out**: it is not a step-by-step tutor (no symbolic derivation); the explanatory reasoning still belongs to a human or a textbook.

---

## 7. Audit and compliance evidence

**Pain**: "how was this number computed at the time?" is often impossible to reproduce later — the model version
changed, the random seed changed, the library was upgraded, and the conclusion can never be recovered.

**How**: store the full `solve` response (including `diagnostics.solverVersion`, certification fields and
diagnostics) with the business log.

**What you get**: a reproducible computation certificate afterwards (input + version + certification conclusion +
residual) — with the version and input intact, anyone can re-run the same result.

**Watch out**: record `diagnostics.solverVersion` together with it — the version is the precondition for
reproducibility (see [08 · Version management](08-%E7%89%88%E6%9C%AC%E7%AE%A1%E7%90%86.md)).

---

## 8. Cases where it clearly does not fit (so you do not waste a trial)

| Case | Why it does not fit | Use instead |
|---|---|---|
| Symbolic derivation, closed-form solutions, formula simplification | It is a numeric solver, no symbolic algebra | SymPy / Mathematica and similar CAS |
| Differential equations (ODE/PDE) | A different kind of math problem | Dedicated ODE/PDE solvers |
| Integer programming / Diophantine constraints | Integer enforcement is unsupported (it reports `integer-unenforced`) | MILP / CP solvers |
| High-precision scientific computing (multi-precision, large matrices) | 6-decimal internal computation grid (4-decimal agent display) | MPFR/GMP, professional numerical libraries |
| Large-scale optimisation (thousands of variables) | Hard cap of 6 variables | A professional optimiser |
| Financial investment or medical diagnosis conclusions | It is a computing tool and gives no professional conclusion (compliance red line) | The corresponding licensed professional judgement |
| "Guarantee that nothing is missed" | In the general case this is mathematically undecidable; no implementation can promise it | Problem-specific algorithms over a restricted input class |

---

## 9. The two ways to connect (common to every scenario)

| Method | Suits | Command / URL |
|---|---|---|
| **Local stdio** (recommended: free, offline, no latency) | single-machine agents, intranet, local debugging | `npx -y lingshu-solver` or `node mcp-server.js` |
| **Hosted HTTP endpoint** | zero install, shared across machines, direct from the public internet | `https://hongchenlingjing.com/mcp` (no per-call charge today; `honorPaid: true` is free) |

> To run the whole loop as code (including a reference payment agent) run `node pay-agent-example.js` in the repository.
