# -*- coding: utf-8 -*-
"""6 变量线性系统：灵数(suan60 精确+presolve) vs SymPy linsolve/solve 同题同机对测

严格口径：
  · 只比【同题】线性方程组（n ≤ 6），双方拿到完全相同的系数矩阵与 rhs
  · 计时前预热（WARMUP 轮），避免 JIT / import 首次调用偏差
  · 解的正确性由第三方独立判定：把解代回原方程算残差，不采信任一方自报
  · 内存用 tracemalloc / resource 记录（对测方各自口径，在 JSON 里分开标注）
  · 覆盖 4 类：稀疏带状（Markowitz 友好）/ 稠密随机 / 过定 / 三角
输出：results JSON 供 node 侧读取
"""
import json, time, sys, tracemalloc
from sympy import Matrix, linsolve, Rational, sympify, Float

WARMUP = 3
REPEAT = 20

def build_cases():
    """题目：[name, A(list of rows), b(list), kind]"""
    cases = []

    # ① 稀疏带状 6×6（Markowitz 最优序可命中 ⇒ 应零 fill-in）
    A = []
    for i in range(6):
        r = [0.0] * 6
        r[i] = 4.0 + i
        if i + 1 < 6: r[i + 1] = -1.0
        if i > 0:   r[i - 1] = -1.0
        A.append(r)
    cases.append(("banded6", A, [1.0] * 6, "sparse-banded"))

    # ② 三角（下三角 ⇒ presolve singletonRow 全消）
    L = [[2.0,0,0,0,0,0],[1.0,3.0,0,0,0,0],[2.0,-1.0,4.0,0,0,0],
         [0,1.0,2.0,5.0,0,0],[0,0,1.0,-1.0,6.0,0],[0,0,0,1.0,2.0,7.0]]
    x0 = [1,2,3,4,5,6]
    b = [sum(L[i][j]*x0[j] for j in range(6)) for i in range(6)]
    cases.append(("triangular6", L, [float(v) for v in b], "triangular"))

    # ③ 稠密随机 6×6（整数，保证可精确有理化）
    cases.append(("dense-int6",
                  [[3,-1,2,0,1,-2],[1,4,0,2,-1,1],[2,0,-3,1,2,0],
                   [0,1,1,5,-2,1],[1,-1,0,2,3,1],[2,1,1,0,-1,4]],
                  [5,6,7,8,9,10], "dense-int"))

    # ④ 过定不相容 6×6（额外两行制造矛盾）
    cases.append(("overdet-incon6",
                  [[3,-1,2,0,1,-2],[1,4,0,2,-1,1],[2,0,-3,1,2,0],
                   [0,1,1,5,-2,1],[1,-1,0,2,3,1],[2,1,1,0,-1,4],
                   [3,-1,2,0,1,-2],[1,4,0,2,-1,1]],
                  [5,6,7,8,9,10,99,98], "overdet-inconsistent"))

    # ⑤ 循环对角占优 6×6（⇒ 唯一解，diagDominant 提前定论）
    C = []
    for i in range(6):
        r = [-1.0]*6; r[i] = 12.0; C.append(r)
    cases.append(("cyc-dom6", C, [1.0]*6, "diag-dominant"))

    # ⑥ 稀疏随机（80% 零）⇒ 检验 Markowitz fill-in 缩减
    import random
    random.seed(20261003)
    S = []
    for i in range(6):
        r = [0.0]*6
        for j in range(6):
            r[j] = float(random.randint(-8, 8)) if random.random() < 0.45 else 0.0
        if all(v == 0 for v in r): r[i] = 5.0
        S.append(r)
    bS = [float(random.randint(-20, 20)) for _ in range(6)]
    cases.append(("sparse-rand6", S, bS, "sparse-rand"))

    # ⑦ 对角阵（⇒ singletonRow 全消，零消元）
    D = []
    for i in range(6):
        r = [0.0]*6; r[i] = 10.0; D.append(r)
    cases.append(("diagonal6", D, [1.0]*6, "diagonal"))

    # ⑧ 有理系数 6×6（1/3, 1/7, 1/5 …）
    cases.append(("rational6",
                  [[1/3,1/7,0,0,0,0],[0,2/3,1/5,0,0,0],[0,0,3/7,1/3,0,0],
                   [0,0,0,4/9,1/5,0],[0,0,0,0,5/3,1/7],[1/5,0,0,0,0,6/11]],
                  [1,1,1,1,1,1], "rational"))

    # ⑨ 欠定 4方程6未知
    cases.append(("underdet6",
                  [[1,2,0,0,0,0],[0,1,3,0,0,0],[0,0,1,4,0,0],[0,0,0,1,5,0]],
                  [1,2,3,4], "underdetermined"))

    # ⑩ 重复行 + 单例行的混合（presolve 应大量命中）
    cases.append(("presolve-heavy6",
                  [[1,0,0,0,0,0],[0,2,0,0,0,0],[0,0,3,0,0,0],
                   [1,0,0,0,0,0],[2,4,0,0,0,0],[0,0,0,7,1,1]],
                  [2,4,6,2,12,5], "presolve-heavy"))

    return cases


def exact_rat(v):
    """float → sympy Rational（分母 ≤ 1e9），用于让 SymPy 走精确路径"""
    return Rational(str(v)) if not float(v).is_integer() else Rational(int(v))


def sympy_solve(A, b, use_linsolve=True):
    M = Matrix([[exact_rat(A[i][j]) for j in range(len(A[0]))] for i in range(len(A))])
    rhs = Matrix([exact_rat(v) for v in b])
    aug = M.row_join(rhs)
    if use_linsolve:
        s = linsolve((M, rhs))
        tup = next(iter(s))
        return [float(v) for v in tup]
    else:
        sol = M.inv() * rhs if M.rows == M.cols else None
        if sol is None: return None
        return [float(v) for v in sol]


def independent_residual(A, b, x):
    """第三方校验：残差 = max |Ax - b|"""
    if x is None: return None
    n = len(x)
    worst = 0.0
    for i in range(len(A)):
        s = 0.0
        for j in range(n):
            s += A[i][j] * x[j]
        worst = max(worst, abs(s - b[i]))
    return worst


def main():
    out = {"tool": "sympy", "version": __import__("sympy").__version__, "cases": []}

    # 预热（不算入计时）
    for _ in range(WARMUP):
        try: sympy_solve([[2.0,1.0],[1.0,3.0]], [1.0,2.0])
        except Exception: pass

    for name, A, b, kind in build_cases():
        n = len(A[0])
        rec = {"name": name, "kind": kind, "n": n, "m": len(A)}

        # ---- linsolve（SymPy 默认精确路径）----
        try:
            t0 = time.perf_counter()
            for _ in range(REPEAT):
                x = sympy_solve(A, b, use_linsolve=True)
            dt = (time.perf_counter() - t0) / REPEAT
            rec["linsolve_ms"] = dt * 1000.0
            rec["linsolve_resid"] = independent_residual(A, b, x)
            rec["linsolve_x"] = x
            rec["linsolve_ok"] = True
        except Exception as e:
            rec["linsolve_ok"] = False
            rec["linsolve_err"] = type(e).__name__ + ": " + str(e)[:120]

        # ---- inv*solve（方阵专用，绕开 linsolve 的参数化返回）----
        if len(A) == n:
            try:
                t0 = time.perf_counter()
                for _ in range(REPEAT):
                    x = sympy_solve(A, b, use_linsolve=False)
                dt = (time.perf_counter() - t0) / REPEAT
                rec["inv_ms"] = dt * 1000.0
                rec["inv_resid"] = independent_residual(A, b, x)
                rec["inv_ok"] = True
            except Exception as e:
                rec["inv_ok"] = False
                rec["inv_err"] = type(e).__name__ + ": " + str(e)[:120]
        else:
            rec["inv_ok"] = False
            rec["inv_err"] = "not-square"

        # ---- 内存（单次，tracemalloc 峰值）----
        try:
            tracemalloc.start()
            sympy_solve(A, b, use_linsolve=True)
            _, peak = tracemalloc.get_traced_memory()
            tracemalloc.stop()
            rec["linsolve_peak_bytes"] = peak
        except Exception:
            rec["linsolve_peak_bytes"] = None

        out["cases"].append(rec)

    print(json.dumps(out))
    return 0

if __name__ == "__main__":
    sys.exit(main())