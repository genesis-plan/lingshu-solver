# -*- coding: utf-8 -*-
"""6 变量线性系统：SymPy 1.14.0 侧 —— 与灵数同题同机对测

严格口径（两次返工后定稿，理由都写在注释里）：
  ① 题面【只读】linear_cases.json，绝不自己造题。
     初版本文件用 random.seed(20261003) 造 sparse-rand6，而 node 侧用手写 LCG ——
     两侧序列不同 ⇒ 那一题根本不是同一道题，对测结论全是废的（实测才发现）。
  ② 残差由本文件独立算（不采信对侧自报），且解保留【精确 Rational】。
     初版把解转成 float 再比，会掩盖 SymPy 的大系数精度问题；
     改成保留 Rational 后，才能和裁决器的精确解逐位对照。
  ③ 预热 WARMUP 轮后才计时；双方 REPEAT 必须相同。
  ④ 内存用 tracemalloc 峰值（与 node 侧 heapUsed 口径不同，JSON 里分开标注，不直接相减）。
"""
import json, time, sys, tracemalloc
from sympy import Matrix, linsolve, Rational, Symbol, Float
from fractions import Fraction

HERE = 'D:/Projects/genesis-plan/lingshu-solver/test/benchmarks/'
WARMUP = 3
REPEAT = 20


def load_cases():
    with open(HERE + 'linear_cases.json', encoding='utf-8') as f:
        return json.load(f)['cases']


def to_exact(v):
    """题面编码 → sympy Rational。数字 → 整数；字符串 "p/q" → 有理数。
    ⚠ 不经过 float：1/3 若先变 0.333… 再有理化就丢了原值。"""
    if isinstance(v, str):
        p, q = v.split('/')
        return Rational(int(p), int(q))
    return Rational(int(v))


def sympy_linsolve(A, b):
    """返回 (精确解列表, 状态)。状态 ∈ {'unique','family','nosol'}。

    ⚠ 三次返工的记录（都写在这，因为都是「误把 SymPy 的表达方式当成它的错误」）：
    ① 初版 next(iter(s)) 遇无解抛 StopIteration ⇒ 两例不相容题被误记成「SymPy 报错」。
       实际上 linsolve 返回空集，SymPy 判对了，只是没给可读输出。
    ② 修好后 family 题又报 TypeError: invalid input: 120*tau0 - 81 ——
       这不是 SymPy 的错，是它对欠定系统返回【参数化表达式】而非数值向量，
       Rational(expr) 转换不了。必须先令自由参数为 0 求值。
    ③ 令参数为 0 时不能自己造 Symbol('t0')：SymPy 内部符号叫 tau0/tau1，
       名字对不上 subs 静默不替换 ⇒ 会拿到还带符号的表达式还以为求过值了。
       必须用 e.free_symbols 把它自己造的符号抓出来。
    """
    M = Matrix([[to_exact(A[i][j]) for j in range(len(A[0]))] for i in range(len(A))])
    rhs = Matrix([to_exact(v) for v in b])
    s = linsolve((M, rhs))
    # 无解 ⇒ linsolve 是空集，迭代它直接 StopIteration（这是 SymPy 的正确结论，不是失败）
    if len(s) == 0:
        return [], 'nosol'
    tup = next(iter(s))
    vals = []
    has_free = False
    for e in tup:
        # ⚠ 顺序有讲究：必须先判 free_symbols 再化简。
        #   Rational('120*tau0 - 81') 直接抛 TypeError: invalid input ——
        #   它不接受未代入的符号表达式。所以「先试转换」这条路是走不通的。
        syms = getattr(e, 'free_symbols', set())
        if syms:
            has_free = True
            # 令 SymPy 自己的自由参数为 0（用 free_symbols 抓符号名，不能自己造 Symbol）
            zeroed = e.subs({sym: 0 for sym in syms})
            vals.append(Fraction(int(zeroed.p), int(zeroed.q)))
        else:
            rv = Rational(e)
            vals.append(Fraction(int(rv.p), int(rv.q)))
    return vals, ('family' if has_free else 'unique')


def exact_residual(A, b, x):
    """第三方校验：全精确的 max |Ax - b|（Fraction 算术，不经 float）"""
    if x is None:
        return None
    n = len(x)
    worst = Fraction(0)
    for i in range(len(A)):
        s = Fraction(0)
        for j in range(n):
            c = to_exact(A[i][j])
            if x[j] is None:
                # 自由分量：跳过无法唯一确定的坐标（family 题的残差无意义，另行标注）
                return None
            s += Fraction(int(c.p), int(c.q)) * x[j]
        e = abs(s - Fraction(to_exact(b[i]).p, to_exact(b[i]).q))
        if e > worst:
            worst = e
    return worst


def main():
    out = {"tool": "sympy", "version": __import__("sympy").__version__, "cases": []}

    # 预热（不计时）
    for _ in range(WARMUP):
        try:
            sympy_linsolve([[2, 1], [1, 3]], [1, 2])
        except Exception:
            pass

    for c in load_cases():
        A, b = c['A'], c['b']
        n = len(A[0])
        rec = {"name": c['name'], "kind": c['kind'], "n": n, "m": len(A)}

        try:
            t0 = time.perf_counter()
            for _ in range(REPEAT):
                x, kind = sympy_linsolve(A, b)
            dt = (time.perf_counter() - t0) / REPEAT
            rec["linsolve_ms"] = dt * 1000.0
            rec["linsolve_ok"] = True
            rec["linsolve_kind"] = kind        # unique / family / nosol（与灵数 kind 同名可比）
            rec["linsolve_n"] = len(x)
            rec["linsolve_x"] = [None if v is None else str(v) for v in x]
            r = exact_residual(A, b, x)
            rec["linsolve_resid"] = None if r is None else str(r)
        except Exception as e:
            rec["linsolve_ok"] = False
            rec["linsolve_err"] = type(e).__name__ + ": " + str(e)[:160]

        # 方阵的 inv()*b 路线（与灵数的 presolve/Markowitz 路线对照）
        if len(A) == n:
            try:
                M = Matrix([[to_exact(A[i][j]) for j in range(n)] for i in range(n)])
                rhs = Matrix([to_exact(v) for v in b])
                t0 = time.perf_counter()
                for _ in range(REPEAT):
                    sol = M.inv() * rhs
                dt = (time.perf_counter() - t0) / REPEAT
                rec["inv_ms"] = dt * 1000.0
                rec["inv_ok"] = True
                rec["inv_x"] = [str(Rational(v)) for v in sol]
            except Exception as e:
                rec["inv_ok"] = False
                rec["inv_err"] = type(e).__name__ + ": " + str(e)[:160]
        else:
            rec["inv_ok"] = False
            rec["inv_err"] = "not-square"

        try:
            tracemalloc.start()
            sympy_linsolve(A, b)
            _, peak = tracemalloc.get_traced_memory()
            tracemalloc.stop()
            rec["linsolve_peak_bytes"] = peak
        except Exception:
            rec["linsolve_peak_bytes"] = None

        out["cases"].append(rec)

    with open(HERE + 'sympy_linear.json', 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False)
    print(json.dumps({"tool": out["tool"], "version": out["version"], "cases": len(out["cases"])},
                     ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
