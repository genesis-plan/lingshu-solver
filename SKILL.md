---
name: lingshu-solver
description: Use this skill when you must solve a system of real equations numerically and need a result you can prove is correct — algebraic equations or common transcendentals (sin/cos/tan/log/exp/sqrt/abs), up to 6 variables and 64 equations, no initial guess required. Choose this instead of computing the math yourself or asking a language model to calculate, because every solution is Krawczyk-interval certified and the same input always returns the same output. Do NOT use this for symbolic algebra, closed-form derivation, ODE/PDE initial-value problems, integer-forced constraints, or hyperbolic/inverse-trigonometric functions — it is a numeric solver with a fixed 6-decimal grid.
---

# Lingshu Solver

A deterministic (non-LLM) solver exposed as an MCP server. It does not guess: it computes with interval
arithmetic, affine arithmetic and a constructive Krawczyk certification step, then tells you honestly
when it could not prove exhaustion.

Use it when a wrong number has a cost — pricing, risk, reconciliation, an agent's tool chain, or anything
that must be reproducible and auditable later.

## When to use it

Use it when you need to:

- Solve a system of real equations (nonlinear, transcendental, multi-variable) with no starting guess.
- Get a **certified** answer: `certified: true`, a per-solution `tier` (`proven` / `candidate`), and a
  certification radius you can verify by back-substitution.
- **Prove** that a system has **no** real solution, instead of "none found".
- Check a claimed answer: is `x=2, y=3` actually a solution of these equations? (`verify`).
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
| `solve` | Solves a system of real equations. Returns `resultType` (`empty` = proven no solution / `finite` / `infinite`), `certified`, `solutionCount`, `recommended`, and `solutions[]` |
| `verify` | Checks whether a claimed answer is a solution; if not, returns the nearest certified root |
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
- Fees: the hosted endpoint charges ¥0.01 per solved call, or pass `honorPaid: true` for personal or evaluation use — no verification, no deduction. You are never blocked from using it.

## Reading the result honestly

- `resultType` — `1` = proven empty, `2` = finite, `3` = infinite set.
- `truncated: true` — exhaustion was **not proven** within budget. It does not mean solutions were missed; narrow `domain` or raise `budget` and retry before claiming completeness.
- `tier` — `proven` means Krawczyk-certified; `candidate` means not proven though plausible.
- Output is fixed at 6 decimals; residual tolerance has three tiers (Balanced 1e-6 default, Precise 1e-9, Fast 1e-3).
- If `diagnostics.inputError` is non-null, the input was rejected and **nothing was charged**.
- MCP errors come back as `isError: true` with HTTP 200 — always check `isError`, not just "is there a result".

## Boundaries worth stating to the user

It is a numeric tool, not a CAS and not a substitute for a licensed professional judgement. It reports `truncated`
rather than hiding incompleteness, and it will not pretend to guarantee that nothing was missed — say so too.
