# -*- coding: utf-8 -*-
"""三元多项式系统：灵数(suan59 三元结式) vs SymPy，同题同机。

★ 关键口径（吸取 10-03 教训）：
  SymPy 的 Groebner 基在三元系统上会**组合爆炸**（实测单题 >9 分钟未完成、被迫 kill）。
  Windows 的 Python 没有 SIGALRM ⇒ 用**每题独立子进程 + 父进程 join 超时后 kill**，
  超时如实记为 `timeout`（不是 0，也不是漏测）——「跑不完」本身就是重要数据。
"""
import json, time, sys, subprocess, os

HERE = os.path.dirname(os.path.abspath(__file__))
PER_CASE_TIMEOUT = 20          # 每题 20 秒上限

CASES = [
    ("sum/sumsq/xyz(6)",     ["x + y + z - 6", "x**2 + y**2 + z**2 - 14", "x*y*z - 6"]),
    ("Vieta(6,11,6)",         ["x + y + z - 6", "x*y + y*z + z*x - 11", "x*y*z - 6"]),
    ("3 quad",                ["x**2 + y**2 + z**2 - 1", "x**2 - y**2 + z**2 - 1", "x**2 + y**2 - z**2 - 1"]),
    ("xyz=6,sum=6,sumsq=14",  ["x*y*z - 6", "x + y + z - 6", "x**2 + y**2 + z**2 - 14"]),
    ("cubic chain",           ["x**3 - 3*x - y", "y**3 - 3*y - x", "z - x - y"]),
    ("sphere+plane+quad",     ["x**2 + y**2 + z**2 - 4", "x + y + z - 1", "x - y"]),
    ("mixed deg",             ["x**2 + y - z", "y**2 + z - x", "z**2 + x - y"]),
    ("bezout 8",              ["x**2 - y*z", "y**2 - x*z", "z**2 - x*y"]),
]

# 子进程入口：读 argv 里的 JSON，跑 solve，打印结果
CHILD = r'''
import json, sys, time
from sympy import symbols, solve as sym_solve, sympify
x, y, z = symbols('x y z')
eqs = json.loads(sys.argv[1])
t0 = time.perf_counter()
try:
    raw = sym_solve([sympify(e) for e in eqs], [x, y, z], dict=True)
except Exception as e:
    print(json.dumps({"ms": (time.perf_counter()-t0)*1000, "sols": [], "err": str(e)[:120]}))
    sys.exit(0)
ms = (time.perf_counter()-t0)*1000
sols = []
for d in raw:
    try:
        a = complex(sympify(d[x]).evalf()); b = complex(sympify(d[y]).evalf()); c = complex(sympify(d[z]).evalf())
    except Exception:
        continue
    if abs(a.imag) < 1e-9 and abs(b.imag) < 1e-9 and abs(c.imag) < 1e-9:
        sols.append([a.real, b.real, c.real])
print(json.dumps({"ms": ms, "sols": sols, "err": None}))
'''


def run_child(eqs, budget):
    p = subprocess.Popen([sys.executable, '-c', CHILD, json.dumps(eqs)],
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    t0 = time.perf_counter()
    try:
        out, err = p.communicate(timeout=budget)
        el = (time.perf_counter() - t0) * 1000
        line = out.decode('utf-8', 'replace').strip().splitlines()
        payload = json.loads(line[-1]) if line else {"ms": el, "sols": [], "err": "no output"}
        payload["ms"] = min(payload.get("ms", el), el)
        payload["timeout"] = False
        return payload
    except subprocess.TimeoutExpired:
        p.kill()
        try:
            p.communicate(timeout=5)
        except Exception:
            pass
        return {"ms": budget * 1000.0, "sols": [], "err": "TIMEOUT", "timeout": True}


def check(eq_strs, sols):
    from sympy import sympify, symbols
    x, y, z = symbols('x y z')
    fs = [sympify(e) for e in eq_strs]
    ok = 0
    worst = 0.0
    for s in sols:
        vals = {x: sympify(float(s[0])), y: sympify(float(s[1])), z: sympify(float(s[2]))}
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


res = []
for name, eqs in CASES:
    run_child(eqs, 3.0)                      # 预热（超时也不阻塞）
    r = run_child(eqs, PER_CASE_TIMEOUT)
    ok, worst = check(eq_strs=eqs, sols=r["sols"])
    res.append({
        "name": name, "eqs": eqs,
        "sympy_ms": round(r["ms"], 1), "sympy_n": len(r["sols"]),
        "sympy_valid": ok, "sympy_worst": worst,
        "sympy_timeout": bool(r.get("timeout")),
        "sympy_err": r.get("err"),
    })
    tag = "  [TIMEOUT >%ds]" % PER_CASE_TIMEOUT if r.get("timeout") else ""
    print("[sympy] %-24s %9.1fms n=%2d valid=%2d%s" % (name, r["ms"], len(r["sols"]), ok, tag), flush=True)

with open(os.path.join(HERE, 'sympy_ternary.json'), 'w', encoding='utf-8') as fh:
    json.dump(res, fh, ensure_ascii=False, indent=1)
print("\nwrote sympy_ternary.json")
