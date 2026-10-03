# 02 · User guide

> How to use the three forms, how to call the MCP tools, how to self-host, and the FAQ.
> For design rationale see [03 · Design ideas](03-%E8%AE%BE%E8%AE%A1%E6%80%9D%E6%83%B3.md); for algorithm
> details see [04 · Technical reference](04-%E6%8A%80%E6%9C%AF%E5%8F%82%E8%80%83.md).

---

## 1. The three forms

| Form | Entry | Install | Cost | Data |
|---|---|---|---|---|
| **Web page** | <https://hongchenlingjing.com/> (mirror: [GitHub Pages](https://genesis-plan.github.io/lingshu-solver/) / [COS](https://hclj-1409755229.cos.ap-guangzhou.myqcloud.com/lingshu-solver/index.html)) | none | No charge today | Computed **inside the browser** — equations never leave the device |
| **Local MCP (stdio)** | `npx -y lingshu-solver` / `node mcp-server.js` | Node ≥ 18 on the machine | No charge today | Local process, **offline, nothing sent out** |
| **Remote MCP (HTTP)** | `https://hongchenlingjing.com/mcp` | none | No per-call charge today (metering off); passing `honorPaid: true` **releases the call for free** | Solved in server memory; **equation contents are not written to disk** |

All three share the **same solving core** (`<script id="solver-core">` inside `index.html`), so results are identical.

---

## 2. Web page

Open the link → type equations (one per line, or separated by `,`) → press solve.

- Accepts equalities like `x^2 + y^2 = 25` and domain constraints like `x in [-30,30]`; notation is normalised (Unicode minus, superscripts, Greek letters).
- An expression without `=` is treated as `= 0`.
- The page ships 6 categorised example presets — one click shows you what it can solve.
- Everything runs in the browser: no upload, no cookies, no analytics, no third-party scripts.

---

## 3. Connecting an AI agent (MCP)

### 3.1 Recommended: local stdio (offline)

```json
{
  "mcpServers": {
    "lingshu-solver": {
      "command": "npx",
      "args": ["-y", "lingshu-solver"]
    }
  }
}
```

- Works with any MCP client: Claude Desktop, Cursor, Cline, VS Code, and similar.
- You can also `git clone` and point at a local path:

```json
{ "mcpServers": { "lingshu-solver": { "command": "node", "args": ["<absolute-path>/mcp-server.js"] } } }
```

### 3.2 Zero install: the hosted HTTP endpoint

```json
{
  "mcpServers": {
    "lingshu-solver": {
      "type": "http",
      "url": "https://hongchenlingjing.com/mcp"
    }
  }
}
```

- Protocol: MCP **Streamable HTTP** (`initialize` → `notifications/initialized` → `tools/call`); both SSE and plain JSON responses are parsed.
- Billing and the free path: see [06 · Commercial licence and pricing](06-%E5%95%86%E4%B8%9A%E6%8E%88%E6%9D%83%E4%B8%8E%E6%94%B6%E8%B4%B9.md). In one line: **pass `honorPaid: true` and the call is released for free** (the hosted endpoint charges nothing today).
- Always use `https://`: sending a bearer credential over plaintext HTTP exposes it on the public internet.

### 3.3 Tool inventory

| Form | Tools |
|---|---|
| Local stdio (`mcp-server.js`) | `solve`, `give_feedback`, `poly_roots`, `verify` |
| Hosted HTTP (`http-mcp-server.js`) | `solve`, `give_feedback`, `poly_roots`, `verify`, `pay` |

---

## 4. Tool contracts

### 4.1 `solve` — solve a system of equations

**Input**

```json
{
  "equations": ["x^2 + y^2 = 25", "x + y = 7"],
  "variables": ["x", "y"],
  "domain": { "x": [-30, 30], "y": [-30, 30] },
  "honorPaid": true
}
```

| Parameter | Required | Notes |
|---|---|---|
| `equations` | ✅ | Array of equation strings. **One equation per array element** — cramming several into one element yields zero solutions. Supports `+ - * / ^ sqrt log sin cos tan exp abs`, and in-text domain constraints like `"x in [-30,30]"`; no `=` means `= 0` |
| `variables` | ✕ | Variable names; auto-detected in order of appearance if omitted (≤ 6) |
| `domain` | ✕ | Explicit search domain; **strongly recommended for fast-growing functions (exp/sinh) or "finite · partial" demos**, otherwise the default ±1e6 may fail to prune and `truncated` is raised |
| `budget` / `maxDepth` | ✕ | Search budget (default `BUDGET=5e5` boxes, `MAXDEPTH=28`); raise for pathological systems |
| `fastMode` | ✕ | Switches to the Fast residual tier (1e-3) |
| `honorPaid` | ✕ | **Hosted endpoint only**: `true` declares personal or evaluation use — served free, no verification, no balance deduction |

**Output (abridged)**

```json
{
  "resultType": 2,
  "resultTypeName": "finite",
  "certified": true,
  "truncated": false,
  "precisionDecimals": 4,
  "solutionCount": 2,
  "trust": {
    "trustLevel": "verified", "safeToUse": true,
    "agentAction": "All 2 solution(s) are interval-certified. Safe to use directly.",
    "provenCount": 2, "candidateCount": 0,
    "meaningOfEmpty": null, "mustNotClaim": "no_solution"
  },
  "summary": "Found 2 real solutions (all Krawczyk-interval certified).",
  "recommended": {
    "values": [2, 3], "tier": "proven", "certified": true,
    "text": "x=2.0000, y=3.0000",
    "cert": { "status": "proven", "method": "krawczyk_newton", "enclosure": [[2,2],[3,3]], "backwardError": 0, "krawczykRadius": 0 }
  },
  "solutions": [ { "values": [2, 3], "tier": "proven", "certified": true, "text": "x=2.0000, y=3.0000", "cert": { "status": "proven", "method": "krawczyk_newton", "enclosure": [[2,2],[3,3]], "backwardError": 0, "krawczykRadius": 0 } } ],
  "warnings": [],
  "reportId": "ls1-...",
  "certification": { "proven": 2, "candidate": 0, "structural": 0, "emptyProof": null, "certifiedCoverage": 1 },
  "diagnostics": { "inputError": null, "inputErrorMessage": null, "truncated": false }
}
```

| Field | Meaning |
|---|---|
| `resultType` | `1=empty` (**proven** to have no real solution) / `2=finite` / `3=infinite` (infinite set; only the recommended solution is given) |
| `certified` | Whether every returned solution is certified |
| `truncated` | `true` = exhaustion was not proven within budget (**does not mean solutions were missed**); narrow `domain` or raise `budget` and retry |
| `solutionCount` | Number of solutions |
| `summary` | A one-line overview. Note: `summary` and the page copy are **Chinese**; if you need another language, let your own LLM layer rewrite it — the structured fields above are the authoritative interface |
| `recommended` | The solution nearest the origin (smallest norm) |
| `solutions[]` | Per solution: `values` (full float), `tier`, `certified`, `text` (4-decimal display string), `cert` (certification block: status / method / enclosure / backwardError). **No `internals`** — residuals were removed on 2026-10-03: an agent's decision rests on `tier` + `cert` (interval certification), not on a residual magnitude. Residuals remain in the web build and the regression suite for debugging. |
| `tier` | `proven` (Krawczyk certified) / `candidate` (not proven but plausible) / `structural` (derived structurally) |
| `precisionDecimals` | Always `4` (agent-facing display digits since 2026-10-03; **internal computation stays at 6** — see the FAQ) |
| `trust` | **The agent decision block (read this first)**: `trustLevel` (verified / verified_empty / partially / candidates_only / budget_exhausted / unverified / undecidable), `safeToUse`, `agentAction` (what to do this time), `mustNotClaim` (when `no_solution`, you **must not** claim there is no solution — branch on this enum instead of parsing English), `meaningOfEmpty` (why there is nothing — `null` whenever `solutions[]` is non-empty) |
| `certification` | Certification summary: per-tier counts + `certifiedCoverage` |
| `reportId` | Deterministic reproducibility credential (same input ⇒ same reportId) |
| `diagnostics` | Diagnostics; a non-null `inputError` means this call was rejected as invalid input — **no charge is made in that case** |

> **No top-level `instructions` field** (removed 2026-10-03, 162 B). It duplicated the tool description's "READ THE TIERS" section; its one non-redundant hard rule ("must not claim no-solution unless `trustLevel` is `verified_empty`") now lives in `trust.mustNotClaim` as an enum.
>
> `mustNotClaim` is a **positive whitelist**: only `verified_empty` returns `null`; all six other levels return `"no_solution"`. If a new `trustLevel` is ever added it is forbidden from claiming no-solution by default, so a future level can never silently lose this guarantee.

### 4.2 `give_feedback` — feedback

Report a stuck point, a suspected wrong result, or a suggestion. The message is written to a local
`feedback.log` and is **never transmitted anywhere**.

```
{ "name": "give_feedback", "arguments": { "message": "x^2=4 expected 2 solutions", "context": "batch solving" } }
```

### 4.3 `poly_roots` and `verify`

- `poly_roots`: all real roots of a polynomial, each individually certified by Krawczyk with a strict error box. Coefficients are ordered highest degree first, so `[1,-2,-5,6]` means `x^3-2x^2-5x+6`. Complex roots are not returned.
- `verify`: checks a claimed answer. Give the equation plus a candidate value (a number for one variable, `{variable:value}` pairs, or an array in variable order). If a matching certified root is found the result is `verified` together with its error box; otherwise it is `refuted` and the nearest certified root is returned so the calling agent immediately sees the correct value.

### 4.4 `pay` — payment on the hosted endpoint and self-crediting

```
{ "name": "pay", "arguments": { "orderId": "LS-20260923-xxxxxx", "selfReportPaid": true } }
```

- Call it after paying; `selfReportPaid: true` declares "I have paid" ⇒ **credited and released immediately**, with no manual review and no waiting for reconciliation.
- Passing only `orderId` does not declare payment (the call returns `self_report_required`, guarding against accidental credit).
- Details and compliance wording: [06 · Commercial licence and pricing](06-%E5%95%86%E4%B8%9A%E6%8E%88%E6%9D%83%E4%B8%8E%E6%94%B6%E8%B4%B9.md).

### 4.5 Errors

| `error.type` | Trigger | Handling |
|---|---|---|
| `invalid_input` | equations not a non-empty array of strings / a single non-string / >64 equations / >100KB text / >6 variables / fewer equations than variables | Fix per the returned hint and retry |
| `internal_error` | Internal exception | Returned structured, with **no stack trace leaked** |
| `unknown_tool` | Called a tool that does not exist | Check the tool name |

> MCP convention: tool errors come back as `result.isError === true` with HTTP 200. **Callers must check
> `isError`** — do not treat "there is a result in the response" as success.

### 4.6 Quick reference for integrators

| If you want to know | Read this field |
|---|---|
| Is there a solution? | `resultType` |
| Are the solutions trustworthy? | `certified` plus each solution's `tier` |
| Which solution to use? | `recommended` |
| Could solutions be missing? | `truncated` |
| Did it error? | `isError` + `error.type` |
| Was this call charged? | Charged only when it returns a real result with an empty `diagnostics.inputError` |

---

## 5. Examples covering all six result shapes

| Title | Equations | Expected |
|---|---|---|
| Fewest variables | `x^2 = 4` | 2 solutions |
| Most variables | 6-variable tridiagonal linear system | unique solution |
| Proven empty | `x+y=3` together with `x+y=5` | empty set (**proven** to have no solution) |
| Finite · all certified | `x^2+y^2=4`, `xy=1` | 4 solutions, all certified |
| Finite · partial | `sin(20x)=0.5`, `sin(20y)=0.5` (domain `[-30,30]`) | many solutions + `truncated` |
| Infinite · recommended | `x+y=3` | infinite set, recommends `(1.5,1.5)` |

---

## 6. Self-hosting (the HTTP form)

```bash
PORT=3000 node http-mcp-server.js
```

Zero dependencies, Node built-ins only. Shares `solver-core.js` with the local stdio form, so results match.

**The defaults are safe**: metering is off by default, admin endpoints return 503 altogether when no token
is configured, and admin endpoints accept loopback only by default.

| Environment variable | Default | Effect |
|---|---|---|
| `PORT` | 3000 | Listen port (note: the variable is `PORT`, not `LS_PORT`) |
| `LS_METERING` | `off` | Metering switch. **Off by default for self-hosting** ⇒ clone it, run it yourself, and it is free — we never charge you |
| `LS_PRICE_CENTS` | `1` | Price (cents/call), only applies when metering is on |
| `LS_FREE_LOOPBACK` | `1` | Loopback requests are not charged |
| `LS_RATE_MAX` | `120` | Per-IP per-minute request cap (429 beyond that) |
| `LS_ORDER_RATE_MAX` | `10` | Per-IP per-hour order cap |
| `LS_ADMIN_TOKEN` | unset | Admin token (`X-Admin-Token` header); **unset ⇒ `/admin/*` returns 503** (fail-closed: there is no "add money with no credential" hole) |
| `LS_ADMIN_LOOPBACK_ONLY` | `1` | Admin endpoints accept loopback only (operators use an SSH tunnel; the token never travels the public network) |
| `LS_REQUIRE_TLS` | `off` | When `on`, credential-bearing plaintext calls are rejected (trusts `X-Forwarded-Proto: https`) |
| `LS_CREDITS_PATH` | `credits.json` | Ledger path |
| `LS_PAY_TO` / `LS_PAY_PAGE` / `LS_PAY_CHANNEL` | unset | Payment destination / payment page URL / payment channel; when unset the order states plainly that **it cannot be paid**, never a dead link |

**Ledger and privacy**: the ledger (`credits.json`) stores order id + SHA-256 of the credential + balance/counts
+ timestamps + source IP; the append-only audit stream is `credits.json.ledger.jsonl`. **Neither credentials
nor raw equations are ever written to disk in plaintext.** The payment destination is guarded: changing
`LS_PAY_TO` to another account fails closed and no payment intent is generated (protects against the payment
destination being swapped).

**Reverse proxy**: when exposing it, proxy `/mcp`, `/health`, `/pricing`, `/credit`, `/pay/order` and add CSP,
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, a request body size cap and rate limiting. A `/mcp`
proxy **must** forward `X-Forwarded-For` — the loopback billing exemption depends on it, and without it external
requests get misclassified as local.

---

## 7. FAQ

**Q: Can it be wrong?**
It does not "invent" answers: every solution it returns passes interval certification and can be checked by
back-substitution, so the solutions it gives are faithful. But it does **not** promise to find every solution
for every input — when it cannot prove exhaustion within budget it says so with `truncated`.

**Q: Why does the same problem sometimes find no solution?**
Usually the search domain is wrong (default ±1e6). For `exp`, trigonometric or high-frequency functions pass an
explicit domain, e.g. `{"x": [-30, 30]}`.

**Q: Does `truncated: true` mean the result is unusable?**
No. It only means exhaustion was **not proven** within budget. In most cases every real solution was in fact
found; if some are missing, narrow `domain` or raise `budget` and retry.

**Q: Which functions are supported?**
`+ - * / ^`, `sqrt`, `log`, `sin`, `cos`, `tan`, `exp`, `abs`. No hyperbolic or inverse trigonometric functions (deliberately not implemented).

**Q: Can precision be adjusted?**
No. There is no user-facing precision switch. Two separate numbers matter, and they are not the same thing:
- **Internal computation: 6 decimals.** This is the product spec and it fixes the solver's own grid, tolerance and certification radius. It is not adjustable.
- **Agent-facing display: 4 decimals** (`solutions[].text`, `precisionDecimals`). The underlying `solutions[].values` stay at full float precision, so nothing is lost — read `values` if you need more digits.

Residual tolerance has three tiers: Balanced 1e-6 (default), Precise 1e-9, Fast 1e-3. Lowering the display precision does not lower the computed precision; that separation was measured, not assumed (see [03 · Design ideas](03-%E8%AE%BE%E8%AE%A1%E6%80%9D%E6%83%B3.md)).

**Q: Will my equations be uploaded?**
The web form computes entirely in the browser; equations never leave the device. The local form runs offline.
The hosted endpoint records **metadata only** (time / IP / tool / duration / result type) — **not** the equation
contents. See [privacy.html](../privacy.html).

**Q: Do I need to register an account?**
No. On the hosted endpoint **the credential is the identity** (no username, password, email or phone number);
self-hosting has no account concept at all.

**Q: How is the credential passed?**
Header `Authorization: Bearer <key>` or `x-api-key`. **Credentials in a URL query string are not accepted** —
query strings get written to access logs by the reverse proxy, which is equivalent to leaking the credential.

**Q: If I self-host, will you charge me?**
No. Metering defaults to off (`LS_METERING=off`); only the hosted endpoint that we operate charges per call.

---

## 8. Running the tests locally

```bash
node test/verify_core.js               # engine load + representative cases
node test/regression.js                # three standing exam papers (28 cases)
node test/p0_fix_regression.js         # core fix regression (18 checks)
node test/verify_paste.js              # paste tolerance (7 cases)
node test/verify_issueA.js             # periodic / high-frequency univariate multi-root (15 cases)
node test/verify_compliance.js         # input gate (20 cases)
node test/mcp_smoke.js                 # MCP stdio smoke (8/8)
node test/walkthrough-stdio.mjs        # end-to-end walkthrough of all three forms
node test/metering_regression.js       # metering and payment regression (149 checks)
node test/predeploy_gate.js            # pre-deploy gate (40 checks, needs production env)
```
