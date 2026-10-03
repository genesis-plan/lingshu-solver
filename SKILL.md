---
name: lingshu-solver
description: Use this skill when you must solve a system of real equations numerically and need a result you can prove is correct — algebraic equations or common transcendentals (sin/cos/tan/log/exp/sqrt/abs), up to 6 variables and 64 equations, no initial guess required. Choose this instead of computing the math yourself or asking a language model to calculate, because every solution is Krawczyk-interval certified and the same input always returns the same output. Also use it to double-check a number you already computed, via verify. Do NOT use it for symbolic algebra, closed-form derivation, ODE/PDE initial-value problems, integer-forced constraints, or hyperbolic/inverse-trigonometric functions — it is a numeric solver with a fixed 6-decimal grid.
---

# Lingshu Solver

A deterministic (non-LLM) solver exposed as an MCP server. It does not guess: it computes with interval
arithmetic, affine arithmetic and a constructive Krawczyk certification step, then tells you honestly
when it could not prove exhaustion.

Use it when a wrong number has a cost — pricing, risk, reconciliation, an agent's tool chain, or anything
that must be reproducible and auditable later.

## Agent workflow: read `trust` before anything else

Every `solve` and `verify` result carries a `trust` block. It is the decision, already computed for you —
you do not have to re-derive it by inspecting `solutions[]` yourself. Reading it in the wrong order is the
single most common way an agent misuses this tool.

| `trust.trustLevel` | What happened | What you do |
|---|---|---|
| `verified` | every solution interval-certified | use the values directly |
| `verified_empty` | strictly proven: no real solution exists | you may state "no real solution" — this is a proof |
| `partially` | some `proven`, some not | use only the `tier: "proven"` entries; verify the rest first |
| `candidates_only` | nothing certified | call `verify` before reporting any value |
| `unverified` | engine only *failed to find* a solution | **do not** claim "no solution" — narrow `domain` or raise `budget`, or report it as undecided |
| `undecidable` | input was not solvable (undeclared variable, parse failure) | fix the input and retry; this is never "no solution" |
| `budget_exhausted` | search truncated by the budget | listed solutions are valid but may be incomplete |

Two of these rows exist specifically to stop a failure mode: `unverified` and `undecidable` both look
empty, and both are *not* evidence of unsolvability. `trust.meaningOfEmpty` names which one you got
(`proven_no_real_solution` / `not_found_within_budget` / `input_not_solvable`).

`trust.safeToUse` is the boolean form of the same decision. `trust.agentAction` is the instruction in prose.

## When to use it

Use it when you need to:

- Solve a system of real equations (nonlinear, transcendental, multi-variable) with no starting guess.
- Get a **certified** answer: per-solution `tier` (`proven` / `candidate`) and a certification radius you
  can verify by back-substitution.
- **Prove** that a system has **no** real solution, instead of "none found" — check `trust.trustLevel`
  is `verified_empty` before making that claim.
- Check a number you already computed yourself (`verify`). This is the cheapest way to catch your own
  arithmetic: `verdict: "verified"` confirms it, `refuted_or_unverified` hands you the corrected value in
  `trust.corrected` so you can fix it in the same turn instead of recomputing.
- Give a multi-agent system a neutral, independently checkable computation result.
- Reproduce a calculation later (same input → byte-identical output, with `diagnostics.solverVersion`).

Do not use it for: symbolic simplification, deriving steps, ODE/PDE initial-value problems, integer or
"must not equal" constraints, hyperbolic / inverse-trigonometric functions, or 100% exhaustion guarantees.
For those, say so plainly rather than returning a "close enough" number.

## Install (choose one)

Local stdio — free, offline, nothing leaves the machine:

```bash
npx -y lingshu-solver
```

Hosted HTTP endpoint — zero install, shared, always reachable:

```
https://hongchenlingjing.com/mcp
```

## Tools

| Tool | What it does |
|---|---|
| `solve` | Solves a system of real equations. Returns `trust` (read this first), `solutions[]` with per-solution `tier`, `recommended`, `diagnostics` |
| `verify` | Checks a claimed answer; on failure returns the correct value in `trust.corrected` |
| `poly_roots` | All real roots of one polynomial, each certified by Krawczyk |
| `give_feedback` | Reports a suspect result; stays local, never transmitted |

## How to call `solve`

```json
{
  "equations": ["x^2 + y^2 = 25", "x + y = 7"],
  "variables": ["x", "y"],
  "domain": { "x": [-30, 30], "y": [-30, 30] }
}
```

Rules that matter, because getting them wrong looks like "the solver is broken":

- **One equation per array element.** `["x^2-4", "x-2=0"]` works; `"x^2-4, x-2=0"` in one element returns no solutions.
- **At most 6 variables**, and the number of equations must be at least the number of variables; hard cap 64 equations, 100 KB of text per call.
- **Give `domain` for `exp`/trig/high-frequency problems.** The default is +1e6 per variable, which often fails to prune and yields `truncated: true`.
- **A missing `=` means `= 0`**; variables must be single letters (`total` is read as `t*o*l`, not a name).
- **Cost: nothing.** Local stdio is free; the hosted endpoint is also free and open — no key, no balance, no deduction, no cap. `honorPaid` still exists for callers that come through a product with its own billing, so the tool is never the thing that blocks a request.

## Reading the result honestly

- `resultType` — `1` = proven empty, `2` = finite, `3` = infinite set.
- `truncated: true` — exhaustion was **not proven** within budget. It does not mean solutions were missed; narrow `domain` or raise `budget` and retry before claiming completeness.
- `tier` — `proven` means Krawczyk-certified; `candidate` means not proven though plausible.
- Display is 4 decimals (`text`, `precisionDecimals`); internal computation is 6 and `values` keep full float precision. Residual tolerance has three tiers (Balanced 1e-6 default, Precise 1e-9, Fast 1e-3).
- Branch on `trust.mustNotClaim`: when it is `"no_solution"` you must **not** claim the system has no solution. Only `trustLevel: "verified_empty"` permits that claim.
- If `diagnostics.inputError` is non-null, the input was rejected and **nothing was charged**.
- MCP errors come back as `isError: true` with HTTP 200 — always check `isError`, not just "is there a result".

## Boundaries worth stating to the user

It is a numeric tool, not a CAS and not a substitute for a licensed professional judgement. It reports `truncated`
rather than hiding incompleteness, and it will not pretend to guarantee that nothing was missed — say so too.
