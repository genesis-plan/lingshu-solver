/* 模块 lex：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function tokenize(str, declaredVars) {
    const tokens = [];
    let i = 0;
    const funcs = ['sin', 'cos', 'tan', 'ln', 'exp', 'sqrt', 'log', 'log10', 'abs', 'diff', 'int', 'ode', 'lim',
                  'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
                  'floor', 'ceil', 'gamma', 'log2', 'mod'];
    // 🔴 2026-10-04 修 P0 数学正确性 bug：调用方声明过的变量名一律当变量，【不得】被当成数学常数。
    //   起因（实测）：方程组 a+b+c+d+e+f-60=0, a-b=1, b-c=1, c-d=1, d-e=1, e-f=1 的真解是
    //   (12.5, 11.5, 10.5, 9.5, 8.5, 7.5)（和=60 ✓），但 evalAST 算出第 1 个方程残差 −5.78。
    //   逐层打印 AST 才发现：tokenize 把变量名 `e` 识别成了欧拉数 2.718281828459045，
    //   于是 `a+b+c+d+e` 被解析成 `a+b+c+d+2.718...`。
    //   **这是静默错误**（不抛异常、直接算错），对「数学正确性」是致命的 ——
    //   单字母变量名 e / i / f 这类最常见的建模命名会中招，且用户完全无从察觉。
    //   修法：调用方（setup 解析层 + 未声明标识符门禁）把自己知道的 varNames 传进来，
    //   声明过的优先当变量；未声明时保持旧行为（e 仍是欧拉数）⇒ 向后兼容零回归。
    // ⚠ 只在「调用方明确声明了变量名」时才改变行为；不要在此处猜。
    // declaredVars 允许是数组或 Set（内部用 has()/new Set() 两种形式，见 solver.js 的 _lsEntryProt 是 Set）。
    const declared = (declaredVars && (declaredVars.length !== undefined || declaredVars.size !== undefined))
        ? new Set(declaredVars) : null;

    while (i < str.length) {
        const ch = str[i];

        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
            i++;
            continue;
        }

        // 数字
        if (/\d/.test(ch) || (ch === '.' && i + 1 < str.length && /\d/.test(str[i + 1]))) {
            let num = '';
            while (i < str.length && /\d/.test(str[i])) {
                num += str[i];
                i++;
            }
            if (i < str.length && str[i] === '.') {
                num += '.';
                i++;
                while (i < str.length && /\d/.test(str[i])) {
                    num += str[i];
                    i++;
                }
            }
            // 科学计数法
            if (i < str.length && (str[i] === 'e' || str[i] === 'E')) {
                let expPart = str[i];
                i++;
                if (i < str.length && (str[i] === '+' || str[i] === '-')) {
                    expPart += str[i];
                    i++;
                }
                if (i < str.length && /\d/.test(str[i])) {
                    while (i < str.length && /\d/.test(str[i])) {
                        expPart += str[i];
                        i++;
                    }
                    num += expPart;
                } else {
                    // 不是科学计数法，回退
                    i -= expPart.length;
                }
            }
            tokens.push({ type: 'num', value: parseFloat(num) });
            continue;
        }

        // 变量名或函数名（支持英文字母、下划线、希腊字母——θ/α/β 等数学惯例变量名；
        // π 在常量检查中保持为圆周率常数，其余希腊字母视为普通变量）
        if (/[a-zA-Z_\u0370-\u03FF\u2080-\u209F]/.test(ch)) {
            let name = '';
            while (i < str.length && /[a-zA-Z0-9_\u0370-\u03FF\u2080-\u209F]/.test(str[i])) {
                name += str[i];
                i++;
            }
            // 检查 pi / π 和 e 常量
            // ⚠ declared 优先：调用方声明过这个名字 ⇒ 它是变量，不是常数（见函数头注释的 P0 说明）
            if (declared && declared.has(name)) {
                tokens.push({ type: 'var', name: name });
            } else if (name === 'pi' || name === 'π') {
                tokens.push({ type: 'num', value: Math.PI });
            } else if (name === 'e' && !funcs.includes(name)) {
                tokens.push({ type: 'num', value: Math.E });
            } else if (funcs.includes(name)) {
                tokens.push({ type: 'func', name: name });
            } else {
                tokens.push({ type: 'var', name: name });
            }
            continue;
        }

        // 运算符
        if ('+-*/^(),='.includes(ch)) {
            tokens.push({ type: 'op', value: ch });
            i++;
            continue;
        }

        // 未知字符：不再静默吞掉（曾导致 x² 被误读成 x 等静默破坏方程），
        // 改为抛出明确错误，由 runSolver 捕获并提示用户。
        var hint = "";
        if (ch === '²') hint = "（如需平方请写成 x^2）";
        else if (ch === '³') hint = "（如需立方请写成 x^3）";
        else if (ch === '√') hint = "（如需开方请写成 sqrt(x)）";
        else if (ch === '≤') hint = "（如需上界请写成 x <= 上限）";
        else if (ch === '≥') hint = "（如需下界请写成 x >= 下限）";
        else if (ch === '≠') hint = "（不等于请写成 x != 值）";
        else if (ch === '·' || ch === '×') hint = "（乘号请写成 *）";
        else if (ch === '÷') hint = "（除号请写成 /）";
        throw new Error("无法识别的字符 '" + ch + "'（位于第 " + (i + 1) + " 位）" + hint + "。求解器仅支持 ASCII 运算符 + - * / ^ ( ) =、英文字母变量名与内置函数（sin/cos/tan/ln/exp/sqrt/arcsin…）。");
    }

    return tokens;
}


function _greekNameToSymbol(s) {
    var MAP = {
        'alpha':'α','beta':'β','delta':'δ','epsilon':'ε','zeta':'ζ','eta':'η',
        'theta':'θ','iota':'ι','kappa':'κ','lambda':'λ','mu':'μ','nu':'ν','xi':'ξ',
        'omicron':'ο','rho':'ρ','sigma':'σ','tau':'τ','upsilon':'υ','phi':'φ',
        'chi':'χ','psi':'ψ','omega':'ω',
        'Alpha':'Α','Beta':'Β','Delta':'Δ','Epsilon':'Ε','Zeta':'Ζ','Eta':'Η',
        'Theta':'Θ','Iota':'Ι','Kappa':'Κ','Lambda':'Λ','Mu':'Μ','Nu':'Ν',
        'Xi':'Ξ','Omicron':'Ο','Rho':'Ρ','Sigma':'Σ','Tau':'Τ','Upsilon':'Υ',
        'Phi':'Φ','Chi':'Χ','Psi':'Ψ','Omega':'Ω'
    };
    return String(s).replace(/\b([A-Za-z]+)\b/g, function(m){ return MAP.hasOwnProperty(m) ? MAP[m] : m; });
}


/**
 * 词法归一化（隐式乘补乘号、全角归一化、Unicode 上标、Greek 名、函数名补括号…）。
 *
 * @param {string} str 原始方程片段
 * @param {Set<string>} [protNames] 受保护标识符（声明的变量名）集合。
 *   显式传入优先；不传则回退模块级 _LS_PROTECTED_NAMES（历史行为，保留给无上下文调用点）。
 *   ⚠ 为什么必须有这个参数（P0，2026-10-03）：保护表原先是**模块级可变全局**且从不恢复，
 *     而 solve() 的未声明标识符门禁在 _solveImpl 设置保护表**之前**就调 fuzzyFix ——
 *     于是门禁读到的是「上一次 solve 残留的表」。后果：solve 之后 fuzzyFix("2x") 永久
 *     变成 "2x"（乘号再也插不进去），且不可逆。显式传参让每个求解点的保护表自洽。
 */
function fuzzyFix(str, protNames) {
    // ── 受保护标识符占位符（词法歧义：声明变量整词优先）──
    // 命中保护表的整词先替换为 §§N§§ 占位符；后续所有隐式乘 / 拆字
    // 规则都碰不到它（§ 与数字都不在任何标识符字符类里），末尾统一还原，
    // 保证 tokenize 看到的仍是原名。于是声明了 total ⇒ 全程保持 total，不会被撕开。
    var _lsProt = (protNames !== undefined && protNames !== null) ? protNames : _LS_PROTECTED_NAMES;
    var _lsProtValues = {};
    if (_lsProt && _lsProt.size) {
        var _lsProtIdx = 0;
        str = str.replace(/[a-zA-Z_\u0370-\u03FF\u2080-\u209F][a-zA-Z0-9_\u0370-\u03FF\u2080-\u209F]*/g, function(p) {
            if (!_lsProt.has(p)) return p;
            var _k = '\u00A7\u00A7' + (_lsProtIdx++) + '\u00A7\u00A7';
            _lsProtValues[_k] = p;
            return _k;
        });
    }
    let s = str;


    // 全角符号归一化（必须在最前面执行）
    // ＝→=, （→(, ）→), ＋→+, －→-, ＊→*, ／→/, ，→,, ．→., ：→:
    s = s.replace(/[\uFF1D\uFF08\uFF09\uFF0B\uFF0D\uFF0A\uFF0F\uFF0C\uFF0E\uFF1A]/g, function(ch) {
        const map = { '\uFF1D': '=', '\uFF08': '(', '\uFF09': ')', '\uFF0B': '+',
                      '\uFF0D': '-', '\uFF0A': '*', '\uFF0F': '/', '\uFF0C': ',',
                      '\uFF0E': '.', '\uFF1A': ':' };
        return map[ch] || ch;
    });

    // 去除换行：从豆包/通义等复制时方程常"打竖"（每个字符独立成行），
    // 换行会打断隐式乘法的相邻性（如 4⏎(x-2)、2⏎x），致解析失败→0解。
    // 核心路径以"方程数组"为契约，单条方程内的换行直接去除（不影响数组层面的多方程分隔）。
    s = s.replace(/\r?\n/g, '');

    // Unicode上标转 ^N 表示法（必须在其他规则之前执行）
    // ⁰¹²³⁴⁵⁶⁷⁸⁹ → ^0 ^1 ^2 ...
    s = s.replace(/[\u2070\u00B9\u00B2\u00B3\u2074\u2075\u2076\u2077\u2078\u2079]+/g, function(match) {
        const map = { '\u2070': '0', '\u00B9': '1', '\u00B2': '2', '\u00B3': '3',
                      '\u2074': '4', '\u2075': '5', '\u2076': '6', '\u2077': '7',
                      '\u2078': '8', '\u2079': '9' };
        let digits = '';
        for (const ch of match) digits += map[ch];
        return '^' + digits;
    });

    // ** 转 ^ （Python风格幂运算）
    s = s.replace(/\*\*/g, '^');

    // 连续运算符合并: ++ → +, -- → +, +- → -, -+ → -
    s = s.replace(/\+\+/g, '+');
    s = s.replace(/--/g, '+');
    s = s.replace(/\+-|-\+/g, '-');

    // pow(base, exp) → (base)^(exp) （C/Python风格幂函数）
    // 需要循环处理嵌套情况
    let prevPow;
    do {
        prevPow = s;
        s = s.replace(/\bpow\s*\(\s*([^,()]+(?:\([^)]*\))?[^,()]*)\s*,\s*([^()]+(?:\([^)]*\))?[^()]*)\s*\)/g, '($1)^($2)');
    } while (s !== prevPow);

    // 微积分符号转换
    // ∫(expr, x, a, b) → int(expr, x, a, b)
    s = s.replace(/\u222B\s*\(/g, 'int(');
    s = s.replace(/\u222B\s*/g, 'int(');

    // d/dx(expr) → diff(expr, x) — 用括号匹配精确处理
    s = (function(input) {
        let result = '';
        let i = 0;
        while (i < input.length) {
            // 匹配 d/dx 模式
            const match = input.slice(i).match(/^d\s*\/\s*d([a-zA-Z_]\w*)\s*\(/);
            if (match) {
                const varName = match[1];
                const openParenIdx = i + match[0].length - 1; // '(' 的位置
                // 找到匹配的右括号
                let depth = 1;
                let j = openParenIdx + 1;
                while (j < input.length && depth > 0) {
                    if (input[j] === '(') depth++;
                    if (input[j] === ')') depth--;
                    if (depth === 0) break;
                    j++;
                }
                if (depth === 0) {
                    // 提取括号内容
                    const innerContent = input.slice(openParenIdx + 1, j);
                    result += 'diff(' + innerContent + ',' + varName + ')';
                    i = j + 1;
                    continue;
                }
            }
            result += input[i];
            i++;
        }
        return result;
    })(s);

    // 数学符号转换
    // ÷ → /
    s = s.replace(/÷/g, '/');
    // × → *
    s = s.replace(/×/g, '*');
    // 兼容从其他 AI（豆包/通义等）复制时带入的 Unicode 数学符号：
    // 减号 − / 短破折号 – / 长破折号 —（U+2212/U+2013/U+2014）→ ASCII -
    // 注意：core/MCP 路径只走 fuzzyFix（不走 cleanInput），此处补齐，否则 U+2212 会让 lexer 抛"无法识别字符"→ 解析失败 → 变量看似"未识别"。
    s = s.replace(/[−–—]/g, '-');
    // 中点乘号 ·（U+00B7，豆包常用）→ *
    s = s.replace(/·/g, '*');
    // 不等号 ≠（U+2260）→ !=（约束语法已支持）
    s = s.replace(/≠/g, '!=');
    // ASCII "pi" → Unicode "π"（交给下方隐式乘与 tokenizer 常量识别，避免 pi 被字母×字母规则误拆成 p*i）
    s = s.replace(/\bpi\b/g, 'π');
    // ASCII 希腊字母名 → Unicode 符号（alpha→α, theta→θ, ...），便于用常见拼写声明变量名。
    // 须在隐式乘/单字母拆解规则之前执行，使 theta 先归一化为 θ 再走后续规则，避免被拆成 t*h*e*t*a。
    // 函数名（sin/cos…）及被占用的 gamma/pi 不在映射表内，不受影响。
    s = _greekNameToSymbol(s);
    // （π 保持原字符，交由下方隐式乘规则与 tokenizer 常量识别处理；
    //  不再转为 'pi'，避免 2πx 粘连成假变量 pix 导致假阴性）
    // √( → sqrt( 以及 √x → sqrt(x)
    s = s.replace(/√\s*\(/g, 'sqrt(');
    s = s.replace(/√\s*([a-zA-Z_]\w*)/g, 'sqrt($1)');
    // ≤ → <=, ≥ → >=
    s = s.replace(/≤/g, '<=');
    s = s.replace(/≥/g, '>=');
    // 全角等号 ＝ → = （补全角归一化中漏掉的）
    s = s.replace(/＝/g, '=');
    // |expr| → abs(expr)（竖线绝对值），循环处理简单嵌套
    var prevAbs;
    do {
        prevAbs = s;
        s = s.replace(/\|([^|]+)\|/g, 'abs($1)');
    } while (s !== prevAbs);

    // 极限箭头转换: lim(x→a, expr) 或 lim(x->a, expr) → lim(expr, x, a)
    // 也支持全角箭头 →（U+FF8C 或实际 U+2192）
    // 匹配 lim(x → a, ...) 和 lim(x->a, ...)
    s = s.replace(/lim\s*\(\s*([a-zA-Z_]\w*)\s*(?:→|->)\s*([^,]+)\s*,\s*/g, 'lim($2, $1, ');

    // 函数名跟变量（带空格），补括号: sin x -> sin(x)
    // 注意：\b 开头；log10/log2 前置避免被 log 截走；函数名捕获为 $1、变量为 $2
    s = s.replace(/\b(log10|log2|sin|cos|tan|ln|exp|sqrt|log|abs|diff|int|ode|lim|cot|sec|csc|arcsin|arccos|arctan|sinh|cosh|tanh|floor|ceil|gamma|mod)\s+([a-zA-Z_]\w*)/g, '$1($2)');

    // 函数名紧跟变量无空格无括号，也补括号: sin2x -> sin(2x)（与上方带空格的 sin x 互补；sin(x)/sin(2x) 因后是 ( 不参与匹配）
    s = s.replace(/\b(log10|log2|sin|cos|tan|ln|exp|sqrt|log(?!2|10)|abs|diff|int|ode|lim|cot|sec|csc|arcsin|arccos|arctan|sinh|cosh|tanh|floor|ceil|gamma|mod)([0-9a-zA-Z_.]+)/g, '$1($2)');

    // 保护科学计数法（数字后跟 e/E 和可选符号及数字，如 1e100, 2e+5, 3.5e-10）
    // 必须在隐式乘法规则之前执行，防止 1e100 被拆成 1*e100
    // 使用 §§ 前缀避免隐式乘法规则 (\d)([a-zA-Z_]) 破坏标记
    var _sciValues = {};
    var _sciIdx = 0;
    s = s.replace(/(\d+(?:\.\d+)?)[eE]([+-]?\d+)/g, function(m) {
        var k = '\u00A7\u00A7SCI' + (_sciIdx++);
        _sciValues[k] = m;
        return k;
    });

    // 保护函数名中的数字，防止 log2( 被拆成 log2*(
    // 使用简单标记替换，避免被 (\d)\( 规则破坏
    s = s.replace(/log2\(/g, '§§LOG2§§');
    s = s.replace(/log10\(/g, '§§LOG10§§');

    // ── 占位符「原子化」（2026-10-03 修复的 P0：声明变量后隐式乘全失效）──
    //
    // 症结：声明 x 后，"2x=4" 先被替成 "2§§0§§=4"。隐式乘规则是
    //   (\d)([a-zA-Z_\u0370-\u03FF])  → § 不在右字符类里，乘号插不进去。
    // 于是 tokenizer 拿到 "2x"（无乘号）→ 解析失败 → 0 解。Agent 最自然的写法直接失效。
    //
    // 为什么不在隐式乘字符类里加 §（试过，golden 立刻变红，g020 由 1 解变 0 解）：
    //   那会让占位符参与「变量×变量」拆字与「≥3 字母拆单字母」两条规则，
    //   而这两条规则的 § 排除（(?![\w.§])）正是保护占位符不被拆开的地方 ——
    //   一旦 § 进字符类，拆字规则先一步把占位符撕碎，保护就自相矛盾。
    //
    // 正解：占位符在语法上是**一个原子**，不靠字符类参与规则，而靠下面这组
    // 「先补乘号」的前置规则。它只做一件事——把占位符当成已经写好的原子 token，
    // 在它与数字/字母/括号的接缝处补上缺失的乘号，与它是否可拆无关。
    // 拆字类规则照旧看不见 §（保护不变），补乘号类规则由本段代劳（乘法恢复）。

    if (_lsProtValues && Object.keys(_lsProtValues).length) {
        // ⚠ 不要对 alternation 分隔符 | 做正则转义（试过：转义后变字面量 \|，
        //   正则从「匹配任一占位符」退化成「匹配整串 §§0§§|§§1§§」，永远匹配不到 ⇒ 乘号补不进 ⇒ 0 解）。
        //   占位符形如 §§12§§，只含 § 与数字，两者都不是正则元字符，直接 join('|') 即可。
        var _lsProtKeys = Object.keys(_lsProtValues).join('|');
        // 数字 × 占位符：2§§0§§ → 2*§§0§§
        s = s.replace(new RegExp('(\\d)(' + _lsProtKeys + ')', 'g'), '$1*$2');
        // 占位符 × 数字：§§0§§2 → §§0§§*2
        s = s.replace(new RegExp('(' + _lsProtKeys + ')(\\d)', 'g'), '$1*$2');
        // 占位符 × 占位符：§§0§§§§1§§ → §§0§§*§§1§§（声明 x,y 时 "xy" 才不会被当一个词）
        s = s.replace(new RegExp('(' + _lsProtKeys + ')\\1', 'g'), '$1*$1');
        // 占位符 × 字母（含希腊）：§§0§§x → §§0§§*x ；x§§0§§ → x*§§0§§
        s = s.replace(new RegExp('(' + _lsProtKeys + ')([a-zA-Z_\\u0370-\\u03FF])', 'g'), '$1*$2');
        s = s.replace(new RegExp('([a-zA-Z_\\u0370-\\u03FF])(' + _lsProtKeys + ')', 'g'), '$1*$2');
        // 占位符 × 左/右括号：(x)§§0§§ → (x)*§§0§§ ；total§§0§§(x) → §§0§§*(x)
        // ⚠ 绝不能把 ^ 当作需补乘号的运算符：占位符紧跟 ^ 时是幂（total^2），
        //   插乘号会变成 total*2，语义直接反了（golden 15/20 变红即此故）。
        s = s.replace(new RegExp('(' + _lsProtKeys + ')(\\()', 'g'), '$1*$2');
        s = s.replace(new RegExp('\\)(' + _lsProtKeys + ')', 'g'), '$1*$2');
    }

    // 数字直接跟变量（含希腊字母如 π），插入乘号: 2x -> 2*x ; 2π -> 2*π
    s = s.replace(/(\d)([a-zA-Z_\u0370-\u03FF])/g, '$1*$2');

    // 变量×变量并列: xy -> x*y （仅当两个字母均为孤立单字母，避免拆坏多字符变量名 x1/xvar、函数名 sin/cos 等；同时支持带空格 x y -> x*y）
    // 用循环重复替换，避免 JS String.replace 全局匹配不重叠导致 "xy z" 第一次吃掉 y 后 y z 漏拆
    {
        let _prev;
        do {
            _prev = s;
            s = s.replace(/(?<![\w.§])([a-zA-Z_\u0370-\u03FF])\s*([a-zA-Z_\u0370-\u03FF])(?![\w.§(])/g, '$1*$2');
        } while (s !== _prev);
    }

    // 连续≥3 单字母（含希腊）标识符按单字母拆: xyz -> x*y*z（排除已知函数名；长度2已在上方 xy 规则处理；含数字如 x1y 不匹配故不误拆）
    s = s.replace(/\b([a-zA-Z_\u0370-\u03FF]{3,})\b/g, function(m) {
        const _f = ['sin','cos','tan','ln','exp','sqrt','log','log10','abs','diff','int','ode','lim','cot','sec','csc','arcsin','arccos','arctan','sinh','cosh','tanh','floor','ceil','gamma','log2','mod'];
        if (_f.includes(m)) return m;
        return m.split('').join('*');
    });

    // 数字跟左括号: 2(x -> 2*(x
    s = s.replace(/(\d)\(/g, '$1*(');

    s = s.replace(/§§LOG2§§/g, 'log2(');
    s = s.replace(/§§LOG10§§/g, 'log10(');

    // 右括号跟左括号: )( -> )*(
    s = s.replace(/\)\(/g, ')*(');

    // 右括号跟变量: )x -> )*x
    s = s.replace(/\)([a-zA-Z_])/g, ')*$1');

    // 变量跟左括号: x( -> x*(
    s = s.replace(/([a-zA-Z_]\w*)\(/g, function(match, p1) {
        const funcs = ['sin', 'cos', 'tan', 'ln', 'exp', 'sqrt', 'log', 'log10', 'abs', 'diff', 'int', 'ode', 'lim',
                      'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
                      'floor', 'ceil', 'gamma', 'log2', 'mod'];
        if (funcs.includes(p1)) {
            return p1 + '(';
        }
        return p1 + '*(';
    });

    // 变量跟数字: x2 -> x*2 (但要排除变量名本身包含数字的情况如x2)
    // 这里不处理，因为x2是一个合法的变量名

    // 自动补全缺失的右括号
    let leftParens = 0;
    let rightParens = 0;
    for (const ch of s) {
        if (ch === '(') leftParens++;
        if (ch === ')') rightParens++;
    }
    if (leftParens > rightParens) {
        s += ')'.repeat(leftParens - rightParens);
    }

    // 恢复科学计数法（在隐式乘法、括号补全等规则之后执行）
    Object.keys(_sciValues).forEach(function(k) {
        s = s.split(k).join(_sciValues[k]);
    });

    // 还原受保护标识符占位符（必须在 tokenizer 之前：tokenize 不认 §）
    Object.keys(_lsProtValues).forEach(function(k) {
        s = s.split(k).join(_lsProtValues[k]);
    });

    return s;
}


function parseCondition(str) {
    var s = str.trim();

    // 归一化：中文术语 → 数学符号
    s = s.replace(/属于/g, '\u2208');       // ∈
    s = s.replace(/大于等于/g, '\u2265');   // ≥
    s = s.replace(/小于等于/g, '\u2264');   // ≤
    s = s.replace(/不等于/g, '\u2260');     // ≠
    s = s.replace(/大于/g, '>');
    s = s.replace(/小于/g, '<');

    // 全角括号/逗号 → 半角
    s = s.replace(/[\uFF3B\u3010]/g, '[').replace(/[\uFF3D\u3011]/g, ']');
    s = s.replace(/\uFF0C/g, ',');
    s = s.replace(/\uFF0D/g, '-');

    // 归一化：pi/π 变体
    s = s.replace(/\bpi\b/g, 'π');

    // 归一化：inf 变体
    s = s.replace(/\b(?:[+-]?infinity|[+-]?inf)\b/gi, function(m) {
        if (m === 'inf' || m === 'Inf' || m === '+inf' || m === '+Inf') return '∞';
        if (m === '-inf' || m === '-Inf') return '-∞';
        if (m === 'Infinity' || m === '+Infinity') return '∞';
        if (m === '-Infinity') return '-∞';
        return m;
    });

    // 移除空格
    s = s.replace(/\s+/g, '');

    // ---- 模式1: x∈[a,b] 或 x∈(a,b) ----
    // 支持 ∞ / -∞ / Unicode 无穷符号 \u221E / π
    var m1 = s.match(/^([a-zA-Z_\u0370-\u03FF]\w*)\u2208[\[\(]([^,\]]+),([^,\]]+)[\]\)]$/);
    if (m1) {
        var vn = m1[1], lo = m1[2], hi = m1[3];
        // 2026-10-04：括号形态决定端点开闭（[a,b] 闭、(a,b) 开、(a,b] 半开）。
        // 过去一律按闭区间处理，与模式2 是同一类信息丢失（见模式2 的 P0 注释）。
        // 数值搜索域仍用闭区间（保守不漏），但约束校验必须按真实开闭判。
        var _loOpen = m1[0].indexOf('\uFF08') >= 0 || m1[0].indexOf('(') >= 0;
        var _hiOpen = m1[0].lastIndexOf('\uFF09') >= 0 || m1[0].lastIndexOf(')') >= 0;
        if (lo === '-\u221E' || lo === '-∞' || lo === '-inf') lo = -Infinity;
        if (hi === '\u221E' || hi === '∞' || hi === 'inf' || hi === '+∞') hi = Infinity;
        // 处理 π 边界
        if (lo === 'π') lo = Math.PI;
        if (hi === 'π') hi = Math.PI;
        var loNum = parseFloat(lo), hiNum = parseFloat(hi);
        if (isFinite(loNum) && isFinite(hiNum) && loNum < hiNum) {
            return { type: 'domain', varName: vn, min: loNum, max: hiNum, minStrict: _loOpen, maxStrict: _hiOpen };
        }
        if (isFinite(loNum) && isFinite(hiNum) && loNum >= hiNum) {
            return { type: 'warn', message: '无效区间: ' + vn + '∈[' + lo + ',' + hi + '] 下界≥上界，将被忽略' };
        }
        if (isFinite(loNum) && !isFinite(hiNum)) {
            return { type: 'domain', varName: vn, min: loNum, minStrict: _loOpen };
        }
        if (isFinite(hiNum) && !isFinite(loNum)) {
            return { type: 'domain', varName: vn, max: hiNum, maxStrict: _hiOpen };
        }
    }

    // ---- 模式2: x>a, x<a, x>=a, x<=a, x≥a, x≤a ----
    //
    // 🔴 2026-10-04 修 P0：严格性过去在这里被**丢弃**（原注释：「严格 > / < 在数值计算中转为 >= / <=」）。
    //   实测后果：`x^2=0` + `x>0` 返回解 `x=0` —— x=0 **违反** x>0，真解集是空集。
    //   病根链条（实测追出）：本函数把 `x>0` 归一成 domain{min:0}（无严格标志）
    //   → setup.js:27 只能写 op >= → 终态不等式闸门看到的是 x>=0
    //   → x=0 「满足」 ⇒ 闸门放行。
    //   根因是**信息在词法层就被抹掉了**，下游任何一道闸门都救不回来。
    //   ⇒ 现在显式带出 minStrict / maxStrict。数值搜索域仍按闭区间处理（保守，不会漏），
    //     但「这个点是否满足原约束」必须按严格语义判 —— 二者本就是两件事。
    // 正则说明：[><\u2265\u2264]=? 已覆盖 >, >=, <, <=, ≥, ≤
    var m2 = s.match(/^([a-zA-Z_\u0370-\u03FF]\w*)([><\u2265\u2264]=?)(-?\d+\.?\d*(?:[eE][+-]?\d+)?)$/);
    if (m2) {
        var vn = m2[1], op = m2[2], val = parseFloat(m2[3]);
        if (!isNaN(val) && isFinite(val)) {
            if (op === '>' || op === '>=' || op === '\u2265') {
                return { type: 'domain', varName: vn, min: val, minStrict: (op === '>') };
            }
            if (op === '<' || op === '<=' || op === '\u2264') {
                return { type: 'domain', varName: vn, max: val, maxStrict: (op === '<') };
            }
        }
    }

    // ---- 模式3: a<x<b, a≤x≤b, a<x≤b, a≤x<b ----
    var m3 = s.match(/^(-?\d+\.?\d*(?:[eE][+-]?\d+)?)([<>\u2265\u2264]=?)([a-zA-Z_\u0370-\u03FF]\w*)([<>\u2265\u2264]=?)(-?\d+\.?\d*(?:[eE][+-]?\d+)?)$/);
    if (m3) {
        var loVal = parseFloat(m3[1]), vn = m3[3], hiVal = parseFloat(m3[5]);
        if (!isNaN(loVal) && !isNaN(hiVal) && isFinite(loVal) && isFinite(hiVal) && loVal < hiVal) {
            return { type: 'domain', varName: vn, min: loVal, max: hiVal, minStrict: (m3[2] === '>'), maxStrict: (m3[4] === '<') };
        }
    }

    // ---- 模式4: x∈R, x∈ℝ → 无约束，跳过 ----
    if (s.match(/^[a-zA-Z_\u0370-\u03FF]\w*\u2208[R\u211D]$/)) {
        return { type: 'skip' };
    }

    // ---- 模式5: x∈Z, x∈ℤ, x∈N, x∈ℕ → 仅警告 ----
    if (s.match(/^[a-zA-Z_\u0370-\u03FF]\w*\u2208[Z\u2124N\u2115]$/)) {
        return { type: 'warn', kind: 'integer-unenforced', message: '整数约束(x∈ℤ/ℕ)无法在当前求解器中强制执行；已按实数域求解，返回的解不一定为整数，请知悉（未静默忽略）' };
    }

    // ---- 模式6: x≠a, x!=a → 仅警告 ----
    var m6 = s.match(/^([a-zA-Z_]\w*)(?:\u2260|!=)(-?\d+\.?\d*(?:[eE][+-]?\d+)?)$/);
    if (m6) {
        return { type: 'warn', message: '不等约束 "' + m6[1] + '\u2260' + m6[2] + '" 无法精确表示，将尝试求解近似值' };
    }

    // 无法识别的条件
    return null;
}


function Parser(tokens) {
    let pos = 0;

    function peek() {
        return pos < tokens.length ? tokens[pos] : null;
    }

    function consume() {
        return tokens[pos++];
    }

    function match(type, value) {
        const tok = peek();
        if (!tok) return false;
        if (tok.type !== type) return false;
        if (value !== undefined && tok.value !== value && tok.name !== value) return false;
        return true;
    }

    function expect(type, value) {
        const tok = peek();
        if (!tok) {
            throw new Error('意外的表达式结尾');
        }
        if (tok.type !== type || (value !== undefined && tok.value !== value && tok.name !== value)) {
            throw new Error('解析错误: 期望 ' + type + (value ? ' "' + value + '"' : '') + '，得到 ' + JSON.stringify(tok));
        }
        return consume();
    }

    function parseExpression() {
        let left = parseTerm();
        while (match('op', '+') || match('op', '-')) {
            const op = consume().value;
            const right = parseTerm();
            left = { type: 'binop', op: op, left: left, right: right };
        }
        return left;
    }

    function parseTerm() {
        let left = parseFactor();
        while (match('op', '*') || match('op', '/')) {
            const op = consume().value;
            const right = parseFactor();
            left = { type: 'binop', op: op, left: left, right: right };
        }
        return left;
    }

    function parseFactor() {
        let base = parseUnary();
        if (match('op', '^')) {
            consume();
            const exp = parseFactor(); // 右结合
            return { type: 'binop', op: '^', left: base, right: exp };
        }
        return base;
    }

    function parseUnary() {
        if (match('op', '-')) {
            consume();
            const operand = parseFactor();
            return { type: 'unary', op: '-', operand: operand };
        }
        if (match('op', '+')) {
            consume();
            return parseUnary();
        }
        return parsePrimary();
    }

    function parsePrimary() {
        const tok = peek();
        if (!tok) {
            throw new Error('意外的表达式结尾');
        }

        if (tok.type === 'num') {
            consume();
            return { type: 'num', value: tok.value };
        }

        if (tok.type === 'var') {
            consume();
            return { type: 'var', name: tok.name };
        }

        if (tok.type === 'func') {
            consume();
            expect('op', '(');
            const firstArg = parseExpression();
            // 检查是否有多参数（逗号分隔）
            if (match('op', ',')) {
                const args = [firstArg];
                while (match('op', ',')) {
                    consume();
                    args.push(parseExpression());
                }
                expect('op', ')');
                return { type: 'func', name: tok.name, args: args };
            }
            expect('op', ')');
            return { type: 'func', name: tok.name, arg: firstArg };
        }

        if (tok.type === 'op' && tok.value === '(') {
            consume();
            const expr = parseExpression();
            expect('op', ')');
            return expr;
        }

        throw new Error('解析错误: 意外的token ' + JSON.stringify(tok));
    }

    this.parse = function() {
        const result = parseExpression();
        if (pos < tokens.length) {
            throw new Error('解析错误: 多余的token ' + JSON.stringify(tokens[pos]));
        }
        return result;
    };
}
