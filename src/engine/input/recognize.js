/* 模块 input/recognize：输入识别层（构建期拼接区块）
 *
 * 存在理由（2026-10-03）：
 *   此前「输入是什么」的知识散在三处 —— operators/setup.js 里逐条 if/else 猜
 *   方程 / 约束 / 警告、pipeline/solver.js 里另有一套自动补 "=0"、还有一处
 *   _complianceGuard 查自然语言。后果是三处口径可以互相矛盾，且都无从测试。
 *   本模块把「一句话该被当成什么」收敛成一张决策表 + 一个纯函数 classify()。
 *
 * 职责边界（严格）：
 *   ✓ 分类：这条输入是 方程 / 域约束 / 不等式 / 定义域 / 警告 / 需补等号 / 非法
 *   ✓ 归一化：全角符号、空白、隐式乘修不修（只判不修，修复交给 lex 层 fuzzyFix）
 *   ✗ 不做：解析 AST、求根、裁剪、猜变量（那些属于 solver 与 setup）
 *
 * 为什么单独成模块而不是塞进 setup.js：
 *   分类是纯函数（无副作用、可单测、不碰引擎状态），而 setup.js 是有状态流水线的一段。
 *   混在一起时「判断」与「执行」无法分别验证 —— 而判断出错的后果正是
 *   「静默给出错误答案」，必须能单独测。
 */
var INPUT_KIND = {
    EQUATION: 'equation',        // 标准方程（含可自动补 =0 的裸表达式）
    DOMAIN: 'domain',            // x in [a,b] 形式定义域
    INEQUALITY: 'inequality',    // f(x) <= g(x) 形式
    CONDITION: 'condition',      // 整数/枚举等非等式约束
    NEEDS_EQUALS: 'needsEquals', // 裸表达式，应补 =0
    ILLEGAL: 'illegal',          // 自然语言等必须拒收
};

// 不得放进方程的符号。命中即判 ILLEGAL 并原样回传给用户（fail-closed：宁可拒收也不猜）。
// 覆盖中/日/韩表意文字 + 常见自然语言标点。此前散在 pipeline 的 _complianceGuard 里，
// 挪到此处与分类逻辑同源，避免「分类说合法、门禁说非法」这类矛盾。
var _LS_INPUT_ILLEGAL_CHARS = /[\u2E80-\u2EFF\u3040-\u30FF\u3130-\u318F\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/;

// 自然语言里常见的、但不含表意文字的干扰项（如 "solve for x"、"x=" 里的单词）。
// 这些不能一律判非法（"sin" 等函数名是合法的），只标记出明显成句的部分。
var _LS_INPUT_NATURAL_HINT = /\b(solve|find|compute|calculate|please|help|unknown|undefined|null|nan|equation|answer)\b/i;

// 引擎真正认识的英文标识符（函数名 + 常用符号名）。用于把「数学表达式里的合法英文」
// 与「英文句子」区分开：sin(x)=0 合法，find the roots of x^2=4 不合法。
var _LS_INPUT_FUNC_NAMES = /^(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|sec|csc|cot|log|log2|log10|ln|exp|sqrt|cbrt|abs|sign|floor|ceil|round|min|max|mod|pow|hypot|pi|e|gamma|erf|fact|ln|deg|rad)$/i;

/**
 * 判定一条输入属于哪一类。纯函数：不改参数，不碰引擎状态。
 * @param {string} raw 一条输入（可含全角符号与空白）
 * @returns {{kind: string, reason: string, normalized: string, needsEquals: boolean, raw: string}}
 */
function classifyInput(raw) {
    const res = { kind: '', reason: '', normalized: '', needsEquals: false, raw: raw };
    if (typeof raw !== 'string') {
        res.kind = INPUT_KIND.ILLEGAL;
        res.reason = 'not_a_string';
        return res;
    }

    // 1) 归一化：全角符号 → 半角；去首尾空白。与 lex.fuzzyFix 保持同源认知，
    //    但不在此处做隐式乘/拆字 —— 那是词法层的职责，识别层不该越界。
    let s = raw.replace(/[\uFF1D\uFF08\uFF09\uFF0B\uFF0D\uFF0A\uFF0F\uFF0C\uFF0E\uFF1A]/g, function (ch) {
        const map = {
            '\uFF1D': '=', '\uFF08': '(', '\uFF09': ')', '\uFF0B': '+', '\uFF0D': '-',
            '\uFF0A': '*', '\uFF0F': '/', '\uFF0C': ',', '\uFF0E': '.', '\uFF1A': ':'
        };
        return map[ch] || ch;
    }).trim();
    res.normalized = s;

    // 2) 硬拒收：含表意文字 ⇒ 一定不是数学输入。
    if (_LS_INPUT_ILLEGAL_CHARS.test(s)) {
        res.kind = INPUT_KIND.ILLEGAL;
        res.reason = 'contains_natural_language';
        return res;
    }
    if (s === '') {
        res.kind = INPUT_KIND.ILLEGAL;
        res.reason = 'empty';
        return res;
    }

    // 3) 定义域：x in [a,b] / x∈[a,b] / x in Z。必须先于不等式判，
    //    否则 "x in [0,1]" 会被 needsEquals 收走并补成 "x in [0,1]=0" —— 域约束被静默销毁。
    //    "in" 必须后接集合起点（方括号 / 花括号 / 圆括号 或大写集合名），
    //    否则 "x+in=5" 这类把 in 当变量名的写法会被误判成定义域。
    //    用 \b 边界保证 "sin"/"asin" 里的 in 不命中。
    //    ⚠ 硬约束：本行正则不得出现未配对的花括号字面量。build.mjs 靠逐行数花括号
    //    判断「是否顶层声明」，注释与正则里的花括号同样计数 —— 一处失衡会让其后
    //    所有顶层函数从 export 表里消失（曾导致 classifyInputs/solvableInputs 静默丢导出）。
    //    要匹配花括号请写成 \x7B。
    if (/[\u2208\u2209]/.test(s) || /\bin\s*[\[\x7B（(]/.test(s) || /\bin\s+[A-Z]/.test(s)) {
        res.kind = INPUT_KIND.DOMAIN;
        res.reason = 'domain_constraint';
        return res;
    }

    // 3b) 自然语言外壳：有等号但裹着英文句子（如 "find the roots of x^2=4"）。
    //     必须在「有等号 ⇒ 方程」之前判，否则整句连同等号一起被当合法方程透传，
    //     解析层再报错——那时用户看到的是语法错误，而不是"这不是数学输入"。
    //     白名单是引擎真有的函数名；白名单外的英文单词出现 ≥2 个 ⇒ 判句子。
    //
    // 🔴 2026-10-05 P0 修复（实测事故：`x+y+z-6, xy+yz+zx-11, xyz-6` 返回 0 解）：
    //   原实现用 `s.match(/[A-Za-z]{2,}/g)` 扫「词」，这把**连写的隐式乘法**也当成了单词 ——
    //   `xy+yz+zx=11` 扫出 ['xy','yz','zx'] 三个 2 字母「词」，都不在函数名白名单
    //   ⇒ 整条判 ILLEGAL ⇒ **方程被静默丢弃**，3 元题退化成 2 元欠定 ⇒ 输出 0 解 + 「计算资源不足」。
    //   数学上 `xy` 是一个标识符（隐式乘法），不是英文单词；二者的区别不在字母数，
    //   而在**分隔方式**：英文单词由空格分隔并各自成段，数学记号则与运算符/数字粘连。
    //   所以判据改为：按空白切段，只把「整段是纯字母（无数字、无运算符）」的段计为单词。
    //   逐例核对（全部保持原行为，只有连写那条改变）：
    //     "find the roots of x^2=4" → 词 find/the/roots/of = 4 ⇒ illegal  ✔ 不变
    //     "solve x^2=4"            → 词 solve = 1 ⇒ equation（沿用旧口径）✔ 不变
    //     "answer=5"               → 段 'answer=5' 含数字 ⇒ 0 词 ⇒ equation ✔ 不变
    //     "compute x^2-4"          → 词 compute = 1 ⇒ needsEquals ✔ 不变
    //     "please help"            → 词 please/help = 2 ⇒ illegal ✔ 不变
    //     "xy+yz+zx=11"            → 1 段含运算符 ⇒ 0 词 ⇒ equation ✔ **修复**
    //     "ax+by=c"                → 同上 ✔ **修复**
    const _segs = s.split(/\s+/).filter(function (t) { return t.length > 0; });
    const _words = _segs.filter(function (t) {
        return /^[A-Za-z]{2,}$/.test(t);
    });
    if (_words.length >= 2) {
        let allKnown = true;
        for (let i = 0; i < _words.length; i++) {
            if (!_LS_INPUT_FUNC_NAMES.test(_words[i])) { allKnown = false; break; }
        }
        if (!allKnown) {
            res.kind = INPUT_KIND.ILLEGAL;
            res.reason = 'natural_language';
            return res;
        }
    }

    // 4) 不等式：含 <= >= < >。注意必须在「是否已有等号」之前判，
    //    因为 "x < 5" 没有等号，会被下面的 needsEquals 误收。
    if (/<=|>=|<|>/.test(s)) {
        res.kind = INPUT_KIND.INEQUALITY;
        res.reason = 'has_inequality';
        return res;
    }

    // 5) 已有等号 ⇒ 标准方程。
    if (s.indexOf('=') !== -1) {
        res.kind = INPUT_KIND.EQUATION;
        res.reason = 'has_equals';
        return res;
    }

    // 6) 无等号：若像自然语言（solve/compute…）则拒收，否则视为裸表达式，应补 =0。
    //    分界依据是「是否含数学运算符或数字」——纯单词才是自然语言。
    if (/[+\-*/^()=<>]|[\d]/.test(s)) {
        res.kind = INPUT_KIND.NEEDS_EQUALS;
        res.needsEquals = true;
        res.reason = 'bare_expression';
        return res;
    }
    if (_LS_INPUT_NATURAL_HINT.test(s)) {
        res.kind = INPUT_KIND.ILLEGAL;
        res.reason = 'natural_language';
        return res;
    }

    // 7) 纯单词且不认识 ⇒ 非法（fail-closed，不猜它想干什么）。
    res.kind = INPUT_KIND.ILLEGAL;
    res.reason = 'unrecognised';
    return res;
}

/**
 * 批量分类，保持原顺序，返回带 kind 的副本数组。
 * 不合法项不丢弃 —— 由调用方决定是拒收还是警告，避免"悄悄少一条方程"。
 */
function classifyInputs(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (let i = 0; i < list.length; i++) {
        const c = classifyInput(list[i]);
        c.index = i;
        out.push(c);
    }
    return out;
}

/**
 * 只取「可进入求解」的输入（方程 + 需要补等号的裸表达式）。
 * 自动补 "=0" 的行为收敛在此函数的调用方（solver 入口），此处只负责判定与筛选，
 * 避免「谁决定补等号」这件事散在多处。
 */
function solvableInputs(list) {
    return classifyInputs(list).filter(function (c) {
        return c.kind === INPUT_KIND.EQUATION || c.kind === INPUT_KIND.NEEDS_EQUALS;
    });
}
