#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
能力扫描：定位现有 CAS（SymPy 1.14 / NumPy / SciPy）在【6 变量以内方程系统】上的真实短板。

方法：每题跑三种路线，记录【是否给对 + 耗时 + 是否严格判定】。
  · 数值路线：linsolve / solve / nroots —— 数值/符号求解
  · 线性代数：numpy.linalg.solve / lstsq
  · 严格路线：Sylvester 结式 + Sturm 精确计数

扫描不是为了"赢"，是为了找到【别人做不了而我们能严格做】的格子。
"""
import json
import time
import sys

import sympy as sp
import numpy as np

T0 = time.perf_counter()

# ⚠ 口径常量：与 node 侧 capability_lingshu.mjs 严格一致（改一处必须改两处）。
#   两侧都 WARMUP 预热 + REPEAT 取均值，否则量到的不是同一个东西。
WARMUP = 3
REPEAT = 5


def warmup():
    """预热：把 import 之外的首次调用成本（JIT/缓存/符号表初始化）挪到计时之外"""
    xw, yw = sp.symbols("x y", real=True)
    for _ in range(WARMUP):
        for eqs, syms in (([xw + yw - 3, xw - yw - 1], (xw, yw)),
                          ([xw ** 2 + yw ** 2 - 4, xw * yw - 1], (xw, yw))):
            try:
                sp.linsolve(eqs, syms)
            except Exception:
                pass
            try:
                sp.solve(eqs, syms, dict=True)
            except Exception:
                pass


def timed(fn, *a, **kw):
    """计时跑 REPEAT 次取均值（口径与 node 侧一致）"""
    t = time.perf_counter()
    try:
        for _ in range(REPEAT):
            r = fn(*a, **kw)
        return {"ok": True, "ms": (time.perf_counter() - t) * 1000 / REPEAT, "val": r}
    except Exception as e:
        return {"ok": False, "ms": (time.perf_counter() - t) * 1000 / REPEAT,
                "err": type(e).__name__ + ": " + str(e)[:120]}


def res_polys(exprs, subs):
    """残差：把候选解代回原方程组"""
    mx = 0.0
    for e in exprs:
        v = e.subs(subs)
        try:
            v = complex(v)
            mx = max(mx, abs(v))
        except TypeError:
            mx = max(mx, float("inf"))
    return mx


# ══════════════ 扫描题库 ══════════════
x, y, z, w, v, u = sp.symbols("x y z w v u", real=True)

CASES = []


def add(cid, group, desc, eqs, syms, known=None):
    CASES.append(dict(id=cid, group=group, desc=desc,
                      eqs=eqs, syms=syms, known=known))


# ── A 组：线性系统（suan60 的地盘）
add("A1", "linear", "6元稠密整数唯一解",
    [x + 2*y + 3*z + w + 4*v + 5*u - 100,
     2*x - y + z - 3*w + v - u - 20,
     -x + 3*y + 2*z - w + 2*v - 3*u - 55,
     4*x + y - 2*z + 5*w - v + u - 130,
     -3*x + y + 4*z - 2*w + 3*v - u - 45,
     2*x - 4*y + z + w - 2*v + 5*u - 75],
    (x, y, z, w, v, u))

add("A2", "linear", "6元稀疏带状 三对角",
    [2*x - y + 0*z + 0*w + 0*v + 0*u - 1,
     x + 3*y - z + 0*w + 0*v + 0*u - 2,
     0*x + y + 4*z - w + 0*v + 0*u - 3,
     0*x + 0*y + z + 5*w - v + 0*u - 4,
     0*x + 0*y + 0*z + w + 6*v - u - 5,
     0*x + 0*y + 0*z + 0*w + v + 7*u - 6],
    (x, y, z, w, v, u))

add("A3", "linear", "6元 有理系数（分母大）",
    [sp.Rational(1, 7)*x + sp.Rational(1, 11)*y + z - 3,
     x + sp.Rational(1, 13)*y + sp.Rational(1, 17)*z - 2,
     sp.Rational(1, 19)*x + y + sp.Rational(1, 23)*z - 1],
    (x, y, z))

add("A4", "linear", "5元 秩亏（无穷多解）",
    [2*x + z + w - 5, y - w + 1, 3*x - z - w, 4*x + y + 2*z + w - 9,
     x + y - w - 0],
    (x, y, z, w))

# ── B 组：非线性但可精确降维（suan59 的地盘）
add("B1", "nonlinear", "二元二次系统 x²+y²=4, xy=1",
    [x**2 + y**2 - 4, x*y - 1], (x, y))

add("B2", "nonlinear", "二元三次 x³+y³=35, x²+y²=5",
    [x**3 + y**3 - 35, x**2 + y**2 - 5], (x, y))

add("B3", "nonlinear", "三元 9点Bézout（每个二次）",
    [x**2 + y + z - 1, y**2 + x + z - 1, z**2 + x + y - 1], (x, y, z))

add("B4", "nonlinear", "三元混合 二次+三次",
    [x**2 + y**2 - 4, y**2 + z**2 - 9, z**2 - x**2 - 5], (x, y, z))

# ── C 组：n 元对称排列系统（n! 解，采样法的噩梦）
_ALLSYM = (x, y, z, w, v, u)
_CONST = {x: 1, y: 2, z: 3, w: 4, v: 5, u: 6}
for n in (4, 5, 6):
    syms = _ALLSYM[:n]
    e = [s - _CONST[s] for s in syms]
    # 相邻两变量之和不变 ⇒ 强制它们构成一个 n-循环
    for i in range(n):
        a, b = syms[i], syms[(i + 1) % n]
        e.append(a + b - (_CONST[a] + _CONST[b]))
    add("C%d" % n, "symmetric", "%d元对称排列系统" % n, e, syms)

# ── D 组：丢番图 / 整根（LLL 候选区）
add("D1", "diophantine", "三元整根（对称）x+y+z=S, xy+yz+zx=P, xyz=Q",
    [x + y + z - 6, x*y + y*z + z*x - 11, x*y*z - 6], (x, y, z))

add("D2", "diophantine", "四元整根 Pythagorean 变体",
    [x**2 + y**2 - z**2 - w**2,
     x + y + z - w - 12,
     x*y - 20],
    (x, y, z, w))

# ── E 组：超定/不相容（严格无解判定区）
add("E1", "linear", "8方程6元 不相容（应严格判无解）",
    [x + y + z + w + v + u - 1,
     2*x + 2*y + 2*z + 2*w + 2*v + 2*u - 3,
     x - y + z - w + v - u - 2,
     3*x + 3*y + z + w - v - u - 5,
     x + 2*y - z + 2*w - v + u - 3,
     -x + y + 3*z - 2*w + 4*v - 3*u - 7,
     4*x - y + 2*z - 3*w + v + 2*u - 9,
     x - 3*y - z + 4*w - 2*v - u + 5],
    (x, y, z, w, v, u))

add("E2", "linear", "6元 秩亏但【相容】（真相：3 维解流形）",
    [x + y + z + w + v + u - 1,
     2*x + 2*y + 2*z + 2*w + 2*v + 2*u - 2,
     x + 2*y + 3*z + 4*w + 5*v + 6*u - 5,
     -3*x - y + 2*z - w + 2*v - u - 1],
    (x, y, z, w, v, u))
# ⚠ 上一行的 desc 原写「6元 秩亏但无解（相容性失败）」—— 【描述是错的】，已改。
#   独立 BigInt 精确 RREF 核验（linear_arbiter.mjs 同一套算法）：
#     rank(A) = 3 = rank([A|b]) ⇒ 【相容】，解集是 3 维仿射簇，不是空集。
#   当时下这个判断的依据是「6 个未知数只有 4 个方程 ⇒ 看着像无解」，
#   属于凭直觉下结论。教训：欠定（列数 > 秩）≠ 无解，
#   无解的判据是 rank(A) < rank([A|b])，两者是完全不同的东西。


# ══════════════ 跑扫描 ══════════════
def _is_linear(eqs, syms):
    """判定方程组是否全线性。用 Poly.total_degree() 不用 Expr.is_linear
    （后者在某些 Add/expand 形态上不存在）。"""
    for e in eqs:
        try:
            if sp.Poly(sp.expand(e), *syms).total_degree() > 1:
                return False
        except Exception:
            return False
    return True


def run_sympy_solve(c):
    eqs, syms = c["eqs"], c["syms"]
    if _is_linear(eqs, syms):
        t = time.perf_counter()
        try:
            # ⚠ 口径对齐（与 node 侧 capability_lingshu.mjs 严格一致）：
            #   两侧都是 WARMUP=3（不计时）+ REPEAT=5 取均值。
            #   初版两侧都只跑 1 次，但 node 侧是【冷启动】（首次 parse + JIT）而
            #   Python 侧 import 早已付掉 ⇒ 口径不对称，会得出假的「灵数更慢」结论。
            for _ in range(REPEAT):
                sol = sp.linsolve(eqs, syms)
            ms = (time.perf_counter() - t) * 1000 / REPEAT
            fin = sol is not sp.EmptySet
            tup = list(sol) if fin else []
            pts = []
            for tp in tup[:200]:
                try:
                    pts.append([complex(sp.N(s)) for s in tp])
                except Exception:
                    pts.append(None)
            return {"route": "linsolve", "ok": True, "ms": ms, "n_sol": len(tup),
                    "finite": fin, "pts": pts[:50]}
        except Exception as e:
            return {"route": "linsolve", "ok": False,
                    "ms": (time.perf_counter() - t) * 1000,
                    "err": type(e).__name__ + ": " + str(e)[:150]}
    r = timed(lambda: sp.solve(eqs, syms, dict=True))
    return {"route": "solve", **r}

def run_numpy(c):
    """只有线性系统能走 numpy"""
    eqs, syms = c["eqs"], c["syms"]
    if not _is_linear(eqs, syms):
        return {"route": "numpy", "ok": None, "skip": "非线性"}
    cols = list(syms)
    A, b = [], []
    for e in eqs:
        P = sp.Poly(sp.expand(e), *cols)
        # P.nth(i) 是第 i 个生成元的系数（gens 顺序 = cols 顺序）
        # 常数项是所有列的乘积，Poly 约定为 P.coeff_monomial(1) 会错位，
        # 这里用 terms() 字典按指数元组取，语义无歧义。
        # P.terms() 形如 [((1,0), c), ((0,1), c), ((0,0), c)] —— exp 就是指数元组本身
        cd = {exp: float(co) for exp, co in P.terms()}
        zero_exp = tuple([0] * len(cols))
        row = []
        for i in range(len(cols)):
            e1 = list(zero_exp)
            e1[i] = 1
            row.append(cd.get(tuple(e1), 0.0))
        A.append(row)
        b.append(-cd.get(zero_exp, 0.0))
    A, b = np.array(A, dtype=float), np.array(b, dtype=float)
    t = time.perf_counter()
    try:
        # 口径对齐：REPEAT 次取均值（与另两侧一致）
        for _ in range(REPEAT):
            sol, res, rank, sv = np.linalg.lstsq(A, b, rcond=None)
        return {"route": "numpy-lstsq", "ok": True,
                "ms": (time.perf_counter() - t) * 1000 / REPEAT, "rank": int(rank),
                "resid": float(np.max(np.abs(A.dot(sol) - b))), "sol": sol.tolist()}
    except Exception as e:
        return {"route": "numpy-lstsq", "ok": False, "err": str(e)[:100]}


print("=" * 78)
print("灵数 · 能力扫描  —— 目标：找出【现有 CAS 做不了 / 做得很慢】而我们能严格做的格子")
print("口径：WARMUP=%d 预热 + REPEAT=%d 取均值（与 node 侧严格一致）" % (WARMUP, REPEAT))
print("=" * 78)
warmup()

out = []
for c in CASES:
    rec = {"id": c["id"], "group": c["group"], "desc": c["desc"],
           "n": len(c["syms"]), "m": len(c["eqs"])}
    rec["sympy"] = run_sympy_solve(c)
    rec["numpy"] = run_numpy(c)
    # 题面外置：灵数侧（node）要跑【同一批题】才能对比。
    # ⚠ 与线性对测同一条纪律：题面必须外置成共享文件，两侧绝不各自造题。
    #   之前线性对测就是因为两侧各造各的随机题，对比结论全废。
    # 用 sstr（人可读的 infix 字符串），只把 ** 转成 ^（灵数 parser 的幂运算符）。
    # 曾试过 srepr：机器可 eval 但极冗长（Add(Mul(Integer(5), Symbol('u'...))），
    # node 侧还得写个 srepr 解释器，不值当。sstr 直接可读、可人工核对。
    rec["eqs_src"] = [sp.sstr(e).replace("**", "^") for e in c["eqs"]]
    rec["vars"] = [str(s) for s in c["syms"]]
    out.append(rec)

    s, np_ = rec["sympy"], rec["numpy"]
    ss = ("%7.2fms" % s["ms"]) if s.get("ok") else ("  FAIL  ")
    if s.get("ok") and "n_sol" in s:
        ss += "  n_sol=%d" % s["n_sol"]
    if not s.get("ok") and s.get("err"):
        ss += "  " + s["err"][:46]
    ns = ("%7.2fms rank=%s" % (np_["ms"], np_.get("rank"))) if np_.get("ok") else "    —    "
    print("%-4s %-6s %-26s SymPy[%s]  NumPy[%s]" % (c["id"], c["group"], c["desc"][:26], ss, ns))

print("\n" + "=" * 78)
print("总耗时 %.1f ms" % ((time.perf_counter() - T0) * 1000))


def jsonable(o):
    """把任意对象转成可 JSON 序列化的结构。

    ⚠ json.dump(default=str) 只兜得住【值】，兜不住【键】：
       sp.solve(..., dict=True) 返回 {x: sol}，Symbol 当键会直接抛
       TypeError: keys must be str/int/float/bool/None, not Symbol。
       之前这脚本就是这样白跑一轮（扫描全做完，最后写文件才炸）。
    """
    if isinstance(o, dict):
        return {str(k): jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [jsonable(v) for v in o]
    if isinstance(o, (str, int, float, bool)) or o is None:
        return o
    return str(o)


with open("test/benchmarks/capability_scan.json", "w", encoding="utf-8") as f:
    json.dump(jsonable(out), f, ensure_ascii=False, indent=1)
