# 01 · What this product does

> This document answers one question: **what Lingshu Solver is for, who it is for, and where it stops.**
> Everything below is what the code actually does today. Nothing here describes planned or unimplemented
> capability.

---

## 1. In one sentence

**A deterministic, verifiable, non-hallucinating math solving core for cases where "being slightly wrong"
is not acceptable.**

Same input always produces the same answer. Every solution carries an independently checkable
"certified" marker. A language model will confidently invent digits; this is an algorithm — it does not
guess, it computes, and it lets you verify what it computed.

---

## 2. The real problem it solves

| Pain point | What the usual approach gets wrong | What Lingshu does instead |
|---|---|---|
| LLMs **hallucinate** math | LLM generation is probabilistic; numbers can be invented, the same question returns two different answers, nothing is reproducible | Deterministic algorithm: same input → same output, **reproducible and auditable** |
| Computed results come **with no certificate** | You get a number and cannot prove it actually satisfies the equation | Every solution is **Krawczyk-interval certified**: error radius stated explicitly, verifiable by back-substitution |
| Trust in a numeric tool **is binary** | Either you trust the result or you do not | Three result states (no solution / finite / infinite) + a certification tier (`proven` / `candidate`) + an exhaustion flag (`truncated`) |
| Hard or ill-conditioned systems **pretend to succeed** | When it cannot tell, it still returns something that looks normal | When it cannot tell it **says so** (`truncated`, uncertified, diagnostics). Fail-closed, never a fake pass |
| Data **must stay local** | Cloud computing means the equations leave the device | Web build: zero upload. Local build: fully offline. Hosted endpoint: equations are never written to disk |

---

## 3. Who it is for

The design target is **AI agents** (row 1). Everything below row 1 is a secondary path that also happens
to work.

| User | What they get |
|---|---|
| **AI agent developers** (primary) | A **deterministic math backend** for the agent: constraint solving no longer depends on how the model happens to feel that turn; results are cacheable, reproducible, verifiable. Every response carries a `trust` block (`trustLevel` / `safeToUse` / solution counts) so the agent can branch on a verdict instead of interpreting prose; `verify` hands back the certified corrected value so a wrong number becomes a repair rather than a retry loop |
| **Multi-agent / distributed systems** | An **intermediate computation certificate a third party can check** ("this number really was computed") instead of agents trusting each other's arithmetic |
| **Enterprises / private deployment** | Data stays inside, self-hostable, verified-solution numerical fidelity — suitable for embedding in internal systems, risk pipelines, compliance computation |
| **Audit / compliance evidence** | Certification results and diagnostic fields are structured and can be archived alongside business logs |
| **Individuals / students / teachers / accountants** | A system-of-equations calculator that does not make things up: nonlinear and constraint-bearing problems, works in the browser, same answer every time, checkable by back-substitution |

---

## 4. What it can do

- **Solve systems of real equations**: 1–6 variables; equation count ≥ variable count, hard server cap of 64 equations.
- **Equation types**: algebraic (polynomial, rational, radical) plus common transcendentals (`sin/cos/tan/log/exp/sqrt/abs`); supports `x^2 + y^2 = 25` as well as in-text domain constraints like `x in [-30,30]`.
- **No initial guess needed**: interval arithmetic with conservative contraction plus global branch-and-bound — no manual starting point.
- **Multiple solutions**: it tries to exhaust all real solutions. For an infinite set (e.g. `x+y=3`) it returns the solution nearest the origin and flags `infinite`.
- **Proven-empty**: for some structures (contradictory equations, interval envelope that excludes 0, structurally always-positive) it can **prove** there is no real solution — not merely "none found".
- **One core, three forms**: web page / local MCP (stdio) / hosted MCP (HTTP) — all produce identical results.

---

## 5. What it does not do (honest boundaries)

| Not done | Why |
|---|---|
| Symbolic derivation / closed-form proofs | It is not a CAS: no analytic solution, no derivation steps |
| ODE / PDE initial-value problems | Not supported |
| Enforced integer / natural-number constraints | Solves over the reals; integers are not guaranteed. Returns a structured warning `integer-unenforced` rather than silently ignoring it |
| "must not equal" constraints | Not implemented |
| Hyperbolic / inverse trigonometric functions | `sinh/cosh/tanh/asin/acos/atan` are deliberately not implemented (see [03 · Design ideas](03-%E8%AE%BE%E8%AE%A1%E6%80%9D%E6%83%B3.md)) |
| High-precision global scientific computing | 6-decimal internal computation grid; it is a lightweight numerical tool, not a full-precision scientific stack |
| A guarantee of 100% exhaustion | For the general case, "find every solution" is mathematically undecidable; when it cannot prove exhaustion within budget it honestly reports `truncated` |

**Scale and limits**: at most 6 variables; default search domain ±1e6 (auto-widened, never narrowed, for fast-growing functions); 6-decimal internal computation with a 4-decimal agent-facing display; at most 100 KB of equation text per call.

---

## 6. Reading trust level (one table)

| What you want to know | Which field to read |
|---|---|
| Is there a solution? | `resultType`: `empty` (**proven** to have no real solution) / `finite` / `infinite` |
| Can the solutions be trusted? | `certified` (are all `proven`) plus each solution's `tier`: `proven` (Krawczyk certified) / `candidate` / `structural` |
| Which solution should I use? | `recommended` (nearest to the origin, smallest norm) |
| Might solutions be missing? | `truncated` (`true` = exhaustion not proven within budget; narrow `domain` or raise `budget` and retry) |
| Did it error? | MCP response `isError` and `error.type` |

---

## 7. Approved wording (red lines, not negotiable)

**You may say**: deterministic, reproducible, verifiable, non-hallucinating, verified-solution numerical
fidelity, best-effort global exhaustion, Krawczyk interval certification, offline, zero dependencies,
zero data (per form), ≤6 variables, 6-decimal internal computation, honest flagging when not exhausted.

**You may not say**:
- ❌ "never misses a solution", "100% correct", "absolutely exact", "zero risk"
- ❌ "financial-grade certified", "medical compliance certified" and similar professional certification
  claims (this is a math computing tool; it produces no professional conclusion)
- ❌ Promises of unimplemented capabilities (enforced integers, ODEs, hyperbolic functions)

**Why it matters**: this product sells honesty. Overstating destroys the technical and the commercial
reputation at once — the buyer is precisely buying "it does not make things up".

---

## 8. Value in one line

> **It is not another calculator; it is a verifiable math trust anchor:**
> what it can compute, it stamps (certified); what it cannot, it says out loud (honest degradation).
