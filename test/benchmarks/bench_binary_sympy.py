# -*- coding: utf-8 -*-
"""二元多项式系统：灵数(suan59 结式消元) vs SymPy solve 同题同机对测
严格口径：
  · 只比【同题】(x^2+y^2=25, x+y=1) 这类两式两元多项式系统
  · 计时前预热（去掉 JIT / import 首次调用偏差）
  · 解的正确性由第三方独立判定：把解代回两原方程算残差，不采信任一方自报
输出：results JSON 供 node 侧读取
"""
import json, time, sys
from sympy import symbols, solve, Poly, nroots, Rational, sympify, Eq
from sympy.solvers import solve as sym_solve

x, y = symbols('x y')

# 题目：两个方程（残差形式，LHS-RHS=0），字符串
CASES = [
    ("xy=6, x+y=5",            ["x*y - 6",  "x + y - 5"]),
    ("circle x line",          ["x**2 + y**2 - 25", "x + y - 1"]),
    ("circle x hyperbola",     ["x**2 + y**2 - 4",  "x*y - 1"]),
    ("cubic x quad",           ["x**3 - 3*x - y",   "x**2 + y**2 - 4"]),
    ("deg3 x deg3",            ["x**3 - y",         "y**3 - x"]),
    ("Watt curve",             ["x**2 + y**2 - 1",  "x**2 - y"]),
    ("quartic x quad",         ["x**4 - 1",         "x**2 + y**2 - 5"]),
    ("mixed 3/2",              ["x**3 - y**2",      "x + y - 1"]),
    ("no real sol",            ["x**2 + y**2 + 1",  "x - y"]),
    ("6 bezsout",              ["x**3 - 3*x - y",   "y**3 - 3*y - x"]),
]

WARMUP = 3
REPEAT = 5

def to_sympy(s):
    return s.replace('^', '**')

def independent_check(eq_strs, sols):
    """第三方校验：把解代回两原方程，残差 ≤ 1e-7 视为有效解。返回 (有效数, 最大残差)"""
    fs = [sympify(to_sympy(e)) for e in eq_strs]
    ok = 0; worst = 0.0
    for (a, b) in sols:
        try:
            vals = {x: sympify(float(a)), y: sympify(float(b))}
        except Exception:
            continue
        r = 0.0
        for f in fs:
            try:
                v = abs(complex(f.subs(vals)))
            except Exception:
                v = float('inf')
            r = max(r, v)
        worst = max(worst, r)
        if r <= 1e-7:
            ok += 1
    return ok, worst

def sympy_solve_real(eq_strs):
    """SymPy 通用 solve → 只保留实数解（数值化）"""
    fs = [sympify(to_sympy(e)) for e in eq_strs]
    try:
        raw = sym_solve(fs, [x, y], dict=True)
    except Exception:
        return []
    out = []
    for d in raw:
        try:
            a = complex(sympify(d[x]).evalf())
            b = complex(sympify(d[y]).evalf())
        except Exception:
            continue
        if abs(a.imag) < 1e-9 and abs(b.imag) < 1e-9:
            out.append((a.real, b.real))
    return out

def sympy_nsolve_scan(eq_strs):
    """SymPy nroots 路线：把 Res_y 消元后 nroots（这是 SymPy 的『真·完备』路线，
       相当于手工做一次结式消元）——用来对比完备性能力"""
    f = Poly(sympify(to_sympy(eq_strs[0])), y, domain='EX')
    g = Poly(sympify(to_sympy(eq_strs[1])), y, domain='EX')
    # 手工消元：解 f 关于 y = ... 不行，改用 resultant
    from sympy import resultant
    R = resultant(f.as_expr(), g.as_expr(), y)
    try:
        P = Poly(R, x, domain='EX')
    except Exception:
        return None
    if P.degree() < 1:
        return None
    try:
        rts = nroots(P, maxsteps=200)
    except Exception:
        return None
    return [complex(r) for r in rts if abs(complex(r).imag) < 1e-9]

results = []
for name, eq_strs in CASES:
    fs = [sympify(to_sympy(e)) for e in eq_strs]
    # ---- 预热 ----
    for _ in range(WARMUP):
        try: sym_solve(fs, [x, y], dict=True)
        except Exception: pass
    # ---- 计时 ----
    ts = []
    for _ in range(REPEAT):
        t0 = time.perf_counter()
        sols = sympy_solve_real(eq_strs)
        ts.append((time.perf_counter() - t0) * 1000)
    ms = min(ts)
    ok, worst = independent_check(eq_strs, sols)
    # ---- nroots 路线（计时）----
    tn = None; ncount = None
    for _ in range(WARMUP):
        sympy_nsolve_scan(eq_strs)
    ts2 = []
    for _ in range(REPEAT):
        t0 = time.perf_counter()
        rr = sympy_nsolve_scan(eq_strs)
        ts2.append((time.perf_counter() - t0) * 1000)
    if rr is not None:
        tn = min(ts2)
        ncount = len(rr)
    results.append({
        "name": name, "eqs": eq_strs,
        "sympy_solve_ms": round(ms, 3), "sympy_solve_n": len(sols), "sympy_solve_valid": ok,
        "sympy_solve_worst_res": worst,
        "sympy_nroots_ms": (round(tn, 3) if tn is not None else None),
        "sympy_nroots_n": ncount,
    })
    print(f"[sympy] {name:22s} solve={ms:9.3f}ms n={len(sols):2d} valid={ok:2d} | nroots={('%.3fms'%tn) if tn else 'n/a':>12s} n={ncount}", flush=True)

with open('D:/Projects/genesis-plan/lingshu-solver/test/benchmarks/sympy_binary.json', 'w', encoding='utf-8') as fh:
    json.dump(results, fh, ensure_ascii=False, indent=1)
print("\nwrote sympy_binary.json")
