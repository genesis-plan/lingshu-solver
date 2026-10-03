/* 模块 ui：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function openAgreement() {
    var m = document.getElementById('agreementModal');
    if (m) m.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeAgreement() {
    var m = document.getElementById('agreementModal');
    if (m) m.classList.remove('open');
    document.body.style.overflow = '';
}


function openAgentModal() {
    var m = document.getElementById('agentModal');
    if (!m) return;
    try {
        // 解析 mcp-server.js 与 index.html 同目录时的绝对路径（供配置使用）
        var u = new URL('mcp-server.js', location.href);
        var p = decodeURIComponent(u.pathname);
        if (p.charAt(0) === '/' && /^[A-Za-z]:/.test(p.slice(1))) p = p.slice(1);
        var cmd = 'node "' + p + '"';
        var cfg = JSON.stringify(
            { mcpServers: { "lingshu-solver": { command: "node", args: [p] } } },
            null, 2
        );
        var ce = document.getElementById('agentCmd'); if (ce) ce.textContent = cmd;
        var cf = document.getElementById('agentCfg'); if (cf) cf.textContent = cfg;
    } catch (e) { /* 路径解析失败不影响弹窗展示 */ }
    m.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeAgentModal() {
    var m = document.getElementById('agentModal');
    if (m) m.classList.remove('open');
    document.body.style.overflow = '';
}
// 复制文本：elId=源元素，btnId=按钮（复制后短暂高亮）

function copyText(elId, btnId) {
    var el = document.getElementById(elId);
    var txt = el ? el.textContent : '';
    copyToClipboard(txt, btnId);
}

function copyTextRaw(txt, btn) {
    copyToClipboard(txt, btn ? btn.id : null);
}

function copyToClipboard(txt, btnId) {
    function mark(b) {
        if (!b) return;
        b.textContent = '已复制';
        b.classList.add('copied');
        setTimeout(function () { b.textContent = '复制'; b.classList.remove('copied'); }, 1200);
    }
    var btn = btnId ? document.getElementById(btnId) : null;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { mark(btn); }, function () { fallbackCopy(txt, btn); });
    } else {
        fallbackCopy(txt, btn);
    }
}

function fallbackCopy(txt, btn) {
    try {
        var ta = document.createElement('textarea');
        ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
        if (btn) { btn.textContent = '已复制'; btn.classList.add('copied');
            setTimeout(function () { btn.textContent = '复制'; btn.classList.remove('copied'); }, 1200); }
    } catch(e) { _lsNoteInternal(e, 'ui.js:79 UI 交互异常不影响求解，有意忽略'); }
}
// 点击遮罩空白处关闭（两个弹窗）

var SOLVER_VERSION = "lingshu-solver/1.0.22";

// —— 确定性可复现契约（Certified Real-Root Computation 六属性之「确定性可复现」）——
// 纯 JS 同步 SHA-256（零依赖，浏览器/Node 通用，免 Web Crypto 异步）。
// reportId = 'ls1-' + sha256(输入+版本+预算)；相同输入跨运行/平台逐位重算一致 ⇒
// 可复现性可被机器验证（Decision Physics DP-1），而非仅文字声称。

var EXAMPLES = [
    // 1: 最少1个变量（1变量，2个解）
    ["x^2 = 4"],
    // 2: 最多6个变量（三对角线性系统，唯一整数解 1,2,3,4,5,6）
    ["x + y = 3", "x + 2*y + z = 8", "y + 2*z + a = 12", "z + 2*a + b = 16", "a + 2*b + c = 20", "b + 2*c = 17"],
    // 3: 空集无解（平行直线矛盾，sound 证明无解）
    ["x + y = 3", "x + y = 5"],
    // 4: 有限个解·全部（圆×双曲线，4个解全部经 Krawczyk 认证）
    ["x*x + y*y - 4 = 0", "x*y - 1 = 0"],
    // 5: 有限个解·部分（高频振荡多解，预算内未完全穷尽，显式标记 truncated）
    ["sin(20*x) = 0.5", "sin(20*y) = 0.5"],
    // 6: 无限解·推荐（欠定，输出距原点最近的推荐解）
    ["x + y = 3"]
];

// 示例可选搜索域（与 EXAMPLES 一一对应；null 表示使用默认搜索范围 ±100万）。
// 仅标题5 需要显式域：高频多解系统在有限域内才触发全局分支定界的预算截断，
// 从而真实演示"有限个解·部分（截断）"——这是本工具诚实边界的活样本。

var EXAMPLE_DOMS = [null, null, null, null, { x: [-30, 30], y: [-30, 30] }, null];
// 示例点击后自动求解时携带的域（由 loadExample 写入，runSolver 消费后清空）

var pendingExampleDomain = null;

// 分类标签（与示例一一对应）

var EXAMPLE_CATS = [
    "1️⃣ 最少变量", "6️⃣ 最多变量", "⚠ 空集无解", "🔢 有限解·全部", "📊 有限解·部分", "♾ 无限解"
];


var EXAMPLE_DESCS = [
    "→ 预期：<strong>2个解</strong> x = 2 与 x = −2（各经 Krawczyk 认证，残差≈0）。这是变量数下界（最少 1 个变量）的演示：单个变量也能稳定求解。",
    "→ 预期：<strong>唯一解</strong> (x,y,z,a,b,c) = (1,2,3,4,5,6)（Krawczyk 认证）。这是变量数上界（最多 6 个变量）的演示：6 元线性方程组确定性求得唯一整数解。",
    "→ 预期：<strong>无解</strong>。x + y 同时等于 3 与 5，两条平行直线无交点；由 sound 算子严格证明定义域内不存在实数解（provenEmpty），绝不静默返回空。",
    "→ 预期：<strong>4个解，全部找到</strong>。圆 x²+y²=4 与双曲线 xy=1 相交 4 点，均经 Krawczyk 不动点认证（残差~1e-9），无遗漏、无伪解。",
    "→ 预期：<strong>找到大量解，但显式标记可能未穷尽（truncated）</strong>。sin(20x)=0.5 与 sin(20y)=0.5 在 [-30,30]² 内有极多交点；全局区间分支定界在预算(50万盒)内未能完全判定残余盒，结果带 truncated 横幅与告警——正是\"已尽力穷尽、极端情况可能漏但不假证\"的诚实体现。要拿到全部解请缩小域。",
    "→ 预期：<strong>无限解集（推荐解）</strong>。方程数(1)少于变量数(2)，系统欠定，真实解构成一条直线（无限多个）。本工具不输出包围盒，只输出距原点最近的推荐解 (1.5,1.5)（残差验证通过）。该点是真解但非唯一，要全部解请增加方程约束。"
];

// 示例补充说明（与示例一一对应，无说明则为空字符串）

var EXAMPLE_FAKE_NOTES = [
    "", "", "", "",
    "ℹ <strong>关于\"部分（截断）\"：</strong>本例在有限域 [-30,30]² 内交点极密，全局分支定界预算(50万盒)耗尽后仍有残余盒未证。已找到的解均数学保真，但<strong>不排除仍有个别交点未被找到</strong>——此时工具显式标 truncated 并给出残余告警，绝不谎称已穷尽。这是本工具有意保留的诚实边界（见\"能力与边界\"）。",
    ""
];


function toggleInfoPanel() {
    var card = document.getElementById('infoCard');
    if (card.classList.contains('open')) {
        card.classList.remove('open');
    } else {
        card.classList.add('open');
    }
}


function loadExample(n) {
    try {
        var idx = n - 1;
        if (idx < 0 || idx >= EXAMPLES.length) return;
        document.getElementById("equations").value = EXAMPLES[idx].join("\n");
        document.getElementById("variables").value = "";

        // 显示示例说明
        var hint = document.getElementById("exampleHint");
        var catEl = document.getElementById("hintCategory");
        var descEl = document.getElementById("hintDescription");
        var fakeEl = document.getElementById("hintFakeNote");

        if (catEl) catEl.textContent = EXAMPLE_CATS[idx] || "";
        if (descEl) descEl.innerHTML = EXAMPLE_DESCS[idx] || "";

        if (fakeEl) {
            if (EXAMPLE_FAKE_NOTES[idx]) {
                fakeEl.innerHTML = EXAMPLE_FAKE_NOTES[idx];
                fakeEl.classList.add("show");
            } else {
                fakeEl.classList.remove("show");
            }
        }

        if (hint) hint.classList.add("show");

        // 点击示例即自动求解（带可选域），走与手动"求解"完全相同的路径
        pendingExampleDomain = (EXAMPLE_DOMS && EXAMPLE_DOMS[idx]) ? EXAMPLE_DOMS[idx] : null;
        runSolver();
    } catch(e) {
        alert("示例加载出错: " + e.message);
    }
}


function cleanInput(text) {
    // 1. LaTeX 格式处理
    if (/\\begin\{cases\}|\\\(|\\\\\\\\/.test(text)) {
        text = text.replace(/\\\(/g, '').replace(/\\\)/g, '');
        text = text.replace(/\\begin\{cases\}/g, '').replace(/\\end\{cases\}/g, '');
        text = text.replace(/\\\\\\\\/g, '\n');
        text = text.replace(/\\(,|;|!|\s)/g, '');
        text = text.replace(/\\cdot\s*/g, '*');
    }
    // 2. 统一符号
    text = text.replace(/[\u201C\u201D\u2018\u2019]/g, '"');  // 智能引号
    text = text.replace(/[\u2212\u2013\u2014]/g, '-');        // 各种减号/破折号
    text = text.replace(/\u00D7/g, '*');                       // 乘号 ×
    text = text.replace(/\u00F7/g, '/');                       // 除号 ÷
    // 3. 把 x_1, x_2 等带下标的变量名转为 x1, x2
    text = text.replace(/([a-zA-Z])_(\d+)/g, '$1$2');
    // 4. 隐式乘法：变量空格变量 → 变量*变量（如 x1 x2 → x1*x2，注意不跨行）
    text = text.replace(/([a-zA-Z]\w*)[ \t]+([a-zA-Z]\w*)/g, '$1*$2');
    // 5. 隐式乘法：数字空格变量 → 数字*变量（如 2 x1 → 2*x1，注意不跨行）
    text = text.replace(/(\d+\.?\d*)[ \t]+([a-zA-Z]\w*)/g, '$1*$2');
    // 6. 隐式乘法：变量空格数字 → 变量*数字（如 x1 2 → x1*2，注意不跨行）
    text = text.replace(/([a-zA-Z]\w*)[ \t]+(\d+\.?\d*)/g, '$1*$2');
    // 7. 去掉多余空格（但保留换行）
    text = text.replace(/[ \t]+/g, ' ');
    return text.trim();
}


function runSolver() {
    // 变量名框"自动识别回显"开关：用户从未手动编辑过该框（_varsTouched=false）时，
    // 计算后把求解器实际识别到的变量名回填显示，让用户确认识别结果；
    // 用户一旦手动输入过（如补充 e 作为变量），oninput 置 true，此后不再覆盖。
    if (typeof _varsTouched === 'undefined') { _varsTouched = false; }
    var eqText = document.getElementById("equations").value.trim();
    if (!eqText) {
        showError("请输入方程");
        return;
    }
    // 自动检测并清理 LaTeX 格式输入（如 \begin{cases}...\\...\end{cases}）
    eqText = cleanInput(eqText);
    var varText = document.getElementById("variables").value.trim();

    // 按行拆分方程；但兼容"豆包式打竖粘贴"：若整段只含一个 '=' 却跨多行，
    // 说明是单条方程被换行拆散，合并换行成一条方程（否则每字符会被当成假方程）。
    var _rawLines = eqText.split("\n").map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
    var _eqCount = (_rawLines.join('').match(/=/g) || []).length;
    var eqLines = (_eqCount === 1 && _rawLines.length > 1) ? [_rawLines.join('')] : _rawLines;
    if (eqLines.length === 0) {
        showError("请输入方程");
        return;
    }

    var varList = varText ? varText.split(",").map(function(v) { return v.trim(); }).filter(function(v) { return v.length > 0; }) : [];

    // 显示计算中状态
    var btn = document.querySelector(".solve-btn");
    var origText = btn.textContent;
    btn.textContent = "计算中...";
    btn.disabled = true;

    // 使用 setTimeout 让 UI 更新后再执行计算
    setTimeout(function() {
        try {
            // 示例自动求解时携带其声明域；手动求解时为 null（使用默认搜索范围 ±100万）
            var _dom = pendingExampleDomain || undefined;
            pendingExampleDomain = null;
            var result = solve(eqLines, varList, 6, _dom);
            // 变量名自动识别回显（用户未手动编辑过变量名框时）：
            // 把求解器实际识别到的变量名回填到框里，让用户一眼确认"识别对了没"。
            // e / pi / π 等保留常数符号不会被识别为变量，清单里缺了它们即知歧义。
            if (!_varsTouched && result.varNames && result.varNames.length) {
                document.getElementById("variables").value = result.varNames.join(", ");
            }
            // 保留常数歧义提示：方程中出现 e / pi / π 且未被识别为变量 → 显式说明，
            // 避免用户以为"e 是变量却没解出来"。
            if (!varText) {
                var _rv = result.varNames || [];
                var _hints = [];
                if (/(^|[^A-Za-z0-9_])e($|[^A-Za-z0-9_])/.test(eqText) && _rv.indexOf('e') < 0) {
                    _hints.push("提示：方程中的 e 被识别为欧拉常数 e≈2.718281828…（非变量）。若需将 e 用作变量，请在\"变量名\"框中手动填入 e。");
                }
                if (/\b(pi|π)\b/.test(eqText) && _rv.indexOf('pi') < 0 && _rv.indexOf('π') < 0) {
                    _hints.push("提示：方程中的 pi/π 被识别为圆周率常数 π≈3.14159265…（非变量）。");
                }
                if (_hints.length) {
                    result.warnings = (result.warnings || []).concat(_hints);
                }
            }
            displayResult(result, eqLines);
        } catch(e) {
            if (e && e.type === 'invalid_input') {
                showError(e.message || "输入不是有效的数学方程");
            } else {
                showError("求解器内部错误: " + (e.message || String(e)));
            }
        }
        btn.textContent = origText;
        btn.disabled = false;
    }, 50);
}


function _fmtResidual(r) {
    if (r === undefined || r === null || r !== r) return "?";
    var tol = Math.pow(10, -COMPUTE_DECIMALS); // 残差达标判据固定为计算容差，与 UI 显示小数位无关
    var tolStr = tol < 1e-3 ? tol.toExponential(0) : String(tol);
    if (Math.abs(r) < tol) return "< " + tolStr;
    return r.toExponential(2);
}


function _residualAtDisplayed(values, eqLines, varNames) {
    if (!eqLines || !eqLines.length || !values || !varNames) return null;
    var vmap = {};
    for (var k = 0; k < varNames.length && k < values.length; k++) { vmap[varNames[k]] = values[k]; }
    var mx = 0;
    for (var i = 0; i < eqLines.length; i++) {
        var e = String(eqLines[i]);
        var idx = e.indexOf('=');
        var f;
        try {
            var A = idx >= 0 ? e.slice(0, idx) : e, B = idx >= 0 ? e.slice(idx + 1) : '0';
            f = evalAST(parse(tokenize('(' + A + ')-(' + B + ')')), vmap);
        } catch (err) { f = NaN; }
        if (isFinite(f)) mx = Math.max(mx, Math.abs(f)); else return null;   // 有未识别变量 ⇒ 放弃，交由调用方回退
    }
    return mx;
}


function _escHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}


function displayResult(result, eqLines) {
    var resultSection = document.getElementById("resultSection");
    var errorSection = document.getElementById("errorSection");

    // 隐藏两个区域
    resultSection.classList.remove("show");
    errorSection.classList.remove("show");

    // 总是显示结果分类（无解也需要明确告知用户，避免误以为故障）
    document.getElementById("execPath").textContent = result.executionPath || "-";
    document.getElementById("timeMs").textContent = result.timeMs ? (Math.round(result.timeMs) + "ms") : "-";

    var html = "";
    // 资源截断显著提示（合规要求：结果可能不完整必须让用户直接看到，而非仅 JSON 暴露）
    var _trunc = (result.meta && result.meta.truncated) || result.truncated;
    if (_trunc) {
        html += '<div class="trunc-banner"><strong>⚠ 结果可能不完整（资源截断 / truncated）</strong>：本次计算在计算预算内未能完全收敛，部分真解可能未被找到或仅以未收敛区间表示。请勿据此做出关键决策；建议缩小变量范围、减少变量数或调大计算资源后重试。</div>';
    }
    var outVars = result.varNames || [];

    // 结果类型分类标签（3种形态：1 空集无解 / 2 有限个解 / 3 无限解集（推荐解））
    var typeLabels = { 1: "空集无解", 2: "有限个解", 3: "无限解集（推荐解）" };
    var typeColors = { 1: "#dc3545", 2: "#28a745", 3: "#17a2b8" };
    var rt = result.resultType || 2;
    html += '<div style="margin-bottom:10px">';
    html += '<span style="background:' + (typeColors[rt] || '#28a745') + ';color:#fff;padding:3px 12px;border-radius:12px;font-size:13px;font-weight:bold;display:inline-block">类型' + rt + ': ' + (typeLabels[rt] || '未知') + '</span>';
    if (result.resultTypeDesc) {
        html += '<div style="font-size:13px;color:#666;margin-top:6px;line-height:1.5;padding:8px 12px;background:#f8f9fa;border-radius:6px">' + _escHtml(result.resultTypeDesc) + '</div>';
    }
    // 人话总结：无解 / 唯一解 / 有限个解 / 无限个解
    var summaryText = "", summaryColor = "";
    var solCount = (result.solutions || []).length;
    if (rt === 1) {
        summaryText = "该方程组无解（空集）— 在变量定义域内，不存在任何一组实数能同时满足全部方程。这本身是确定的数学结论，并非计算失败。";
        summaryColor = "#dc3545";
    } else if (rt === 2) {
        if (solCount === 1) {
            summaryText = "唯一解 — 有且仅有一组实数解满足所有方程";
            summaryColor = "#28a745";
        } else {
            summaryText = "有限个解 — 共有 " + solCount + " 组孤立实数解";
            summaryColor = "#28a745";
        }
    } else if (rt === 3) {
        if (solCount > 0) {
            summaryText = "无限个解（欠定系统）— 方程数少于变量数，解集构成参数化集合，存在无限多个解；已输出距原点最近的推荐解。增加方程约束可确定唯一解";
        } else {
            summaryText = "无限个解（欠定系统）— 方程数少于变量数，解集构成参数化集合，存在无限多个解，但未能生成有效推荐解";
        }
        summaryColor = "#17a2b8";
    }
    if (summaryText) {
        html += '<div style="font-size:14px;color:' + summaryColor + ';margin-top:6px;padding:8px 12px;background:' + (rt === 1 ? '#fff0f0' : '#f8fff8') + ';border-radius:6px;border:1px solid ' + summaryColor + '44;font-weight:bold">' + summaryText + '</div>';
    }
    // 诊断信息：为何无解 / 内部错误详情（多专家评审 P0-2 — 用户必须看到"为什么无解"）
    if (result.message || result.error || result.detail) {
        var _diag = result.message || result.error || "";
        if (result.detail) _diag += (result.message || result.error ? "　" : "") + result.detail;
        var _diagColor = result.error ? "#dc3545" : "#0c5460";
        var _diagBg = result.error ? "#f8d7da" : "#d1ecf1";
        html += '<div style="font-size:13px;color:' + _diagColor + ';margin-top:6px;padding:8px 12px;background:' + _diagBg + ';border-radius:6px;border:1px solid ' + _diagColor + '44;line-height:1.6">';
        html += '<b>诊断信息</b>：' + _escHtml(_diag);
        html += '</div>';
    }
    if (rt === 1) {
        html += '<div style="font-size:12px;color:#856404;margin-top:6px;padding:8px 12px;background:#fff8e1;border-radius:6px;border:1px solid #ffe69c;line-height:1.6">';
        html += '<b>怎么看这条结果</b>：① 无解是合法的数学结论，不代表工具出错；② 常见原因——方程相互矛盾（如同一关系被赋予不同的值）、或约束过紧无交集；③ 请核对方程是否抄写正确，或调整 / 放宽约束后重试。';
        html += '</div>';
    }
    if (result.unconverged) {
        html += '<div style="font-size:13px;color:#e83e8c;margin-top:6px;padding:6px 12px;background:#fff0f5;border-radius:6px">⚠ 存在未收敛大区间 — 大区间包裹碎片化解集，可能不完全收敛。请调大资源或缩小初始范围重试</div>';
    }
    if (result.manifold && result.manifold.hasRedundancy) {
        html += '<div style="font-size:12px;color:#555;margin-top:4px;padding:6px 12px;background:#f5f0ff;border-radius:6px;border:1px solid #e0d8f0">';
        html += '<b>流形参数化</b>：维度 ' + result.manifold.dimension + '，雅可比秩 ' + result.manifold.rank + '，' + (result.manifold.tangentBasis ? '切空间基已计算' : '无切空间基');
        html += '</div>';
    }
    html += '</div>';

        // 结果可信度说明（对所有含解的结果适用）
        // 修复（2026-10-02，诚实优先）：旧文案对所有含解结果【无条件】宣称"每个点都经残差验证（<1e-6），可直接使用"。
        // 实测 5307.27=1000000*i/(1-(1+i)^-360)：展示值 i=0.004083 的代入残差为 2.46e-1（> 1e-6），
        // 页面却仍写"<1e-6、可直接使用" ⇒ 用户拿这个月利率去算，月供对不上账。文案必须按真实残差说话。
        if (rt === 2 || rt === 3) {
            var _tolD = Math.pow(10, -COMPUTE_DECIMALS);
            var _resAll = 0, _resAllUnknown = false;
            for (var _sa = 0; _sa < result.solutions.length; _sa++) {
                var _sv2 = result.solutions[_sa].values || [];
                var _rd2 = [];
                for (var _rdi = 0; _rdi < _sv2.length; _rdi++) { _rd2.push(Number(_sv2[_rdi].toFixed(6))); }
                var _rr = _residualAtDisplayed(_rd2, eqLines, result.solutions[_sa].varNames || outVars);
                if (_rr === null) { _resAllUnknown = true; } else { _resAll = Math.max(_resAll, _rr); }
            }
            var _allOk = !_resAllUnknown && _resAll < _tolD;
            html += '<div style="font-size:12px;margin-bottom:8px;padding:8px 12px;border-radius:6px;line-height:1.5;'
                  + (_allOk ? 'color:#155724;background:#f0fff0;border:1px solid #c3e6cb;' : 'color:#856404;background:#fff8e1;border:1px solid #ffe69c;') + '">';
            if (_allOk) {
                html += '<b>✓ 可信说明</b>：下方"解列表"中的每个点都经残差验证（&lt;1e-6），满足全部方程，可直接使用。';
            } else {
                html += '<b>⚠ 注意（残差未达代入容差）</b>：下列值已按 ' + COMPUTE_DECIMALS + ' 位小数截断显示；'
                      + (_resAllUnknown ? '其中部分解无法独立复算残差' : '代入原式后最大残差为 ' + _fmtResidual(_resAll))
                      + '（大于容差 1e-' + COMPUTE_DECIMALS + '）。这些点是数值近似解而非严格根：请用更高精度的原始值复核，'
                      + '或接受这一量级的代入偏差（把数截断到 ' + COMPUTE_DECIMALS + ' 位小数本身就会带来这么大的偏差）。';
            }
            if (rt === 3) {
                html += ' 本例为欠定系统（无限解集），仅输出距原点最近的推荐解；该点是真解但非唯一，如需更多解请增加方程约束。';
            }
            html += '</div>';
        }
        // 主准则：距原点最近（‖x‖² 最小）；等距时按字典序最小化 |x_i|（真全序，确定性、可复现——产品承诺）
        var minSol = (result.solutions && result.solutions.length >= 1) ? pickRecommended(result.solutions) : null;
        var minDist2 = 0;
        if (minSol) { for (var _mvi = 0; _mvi < minSol.values.length; _mvi++) minDist2 += minSol.values[_mvi] * minSol.values[_mvi]; }
        // 显示推荐解（唯一解时标"唯一解"，多个解时标"推荐解"）
        if (result.solutions.length >= 1) {
            var recLabel = (result.resultType === 3) ? "推荐解（距原点最近）" : (result.solutions.length === 1 ? "唯一解" : "推荐解（距原点最近，等距取字典序最小 |xᵢ|）");
            html += '<div style="font-size:12px;color:#28a745;margin-bottom:6px;padding:8px 12px;background:#f0fff0;border-radius:6px;border:1px solid #c3e6cb">';
            html += '<b>' + recLabel + '</b>：';
            html += '<div style="margin-top:4px;font-size:13px;font-family:monospace">';
            for (var _mvi = 0; _mvi < outVars.length; _mvi++) {
                var _v = Number(minSol.values[_mvi].toFixed(6));
                var _vnEsc = _escHtml(outVars[_mvi]);
                if (Math.abs(minSol.values[_mvi]) < 1e-9) {
                    html += '<span style="margin-right:10px;color:#dc3545;font-weight:bold">' + _vnEsc + ' = ' + _v + '</span>';
                } else {
                    html += '<span style="margin-right:10px">' + _vnEsc + ' = ' + _v + '</span>';
                }
            }
            var _zc = 0; for (var _mz = 0; _mz < minSol.values.length; _mz++) if (Math.abs(minSol.values[_mz]) < 1e-9) _zc++;
            // 残差必须在【展示给用户的值（6 位小数截断）】上算（2026-10-02 修正），否则用户拿到的数与残差自相矛盾
            var _dispVals = [];
            for (var _dq = 0; _dq < outVars.length; _dq++) { _dispVals.push(Number(minSol.values[_dq].toFixed(6))); }
            var _resDisp0 = _residualAtDisplayed(_dispVals, eqLines, outVars);
            html += '  <span style="color:#999;font-size:11px">' + _zc + ' 个零分量，距原点 ' + Math.sqrt(minDist2).toFixed(6)
                  + '，残差 ' + _fmtResidual(_resDisp0 === null ? minSol.residual : _resDisp0);
            if (_resDisp0 !== null && typeof minSol.residual === 'number' && Math.abs(_resDisp0) > Math.abs(minSol.residual) * 2 + 1e-12) {
                html += ' <span style="color:#856404">（已截断到 6 位小数：该显示值代回原式残差 ' + _fmtResidual(_resDisp0) + '，截断前残差 ' + _fmtResidual(minSol.residual) + '）</span>';
            }
            html += '</span>';
            html += '</div></div>';
        }

        for (var si = 0; si < result.solutions.length; si++) {
            var sol = result.solutions[si];
            var confidence = result.confidence || "medium";
            var confidenceLabel = { high: "高", medium: "中", low: "低" }[confidence] || confidence;

            html += '<div class="solution-card">';
            html += '  <div class="solution-header">';
            html += '    <span class="solution-title">解 ' + (si + 1) + '</span>';
            html += '    <span class="confidence-badge confidence-' + confidence + '">置信度: ' + confidenceLabel + '</span>';
            html += '  </div>';
            html += '  <div class="solution-vars">';

            for (var vi = 0; vi < outVars.length; vi++) {
                var val = sol.values[vi];
                if (typeof val === "number") val = Number(val.toFixed(6));
                html += '    <div class="var-item">';
                html += '      <span class="var-name">' + _escHtml(outVars[vi]) + '</span>';
                html += '      <span class="var-value">' + (val !== undefined ? _escHtml(val) : "?") + '</span>';
                html += '    </div>';
            }

            html += '  </div>';
            // 残差口径（2026-10-02）：在展示值（6 位小数）上算残差；与截断前残差差异大时显式说明
            var _dv = []; for (var _tvi = 0; _tvi < sol.values.length; _tvi++) { _dv.push(Number(sol.values[_tvi].toFixed(6))); }
            var _rd = _residualAtDisplayed(_dv, eqLines, outVars);
            html += '  <div class="residual-info">残差: ' + _fmtResidual(_rd === null ? sol.residual : _rd);
            if (_rd !== null && typeof sol.residual === 'number' && Math.abs(_rd) > Math.abs(sol.residual) * 2 + 1e-12) {
                html += ' <span style="color:#856404">（该显示值已截断到 6 位小数，代回原式残差 ' + _fmtResidual(_rd) + '；截断前残差 ' + _fmtResidual(sol.residual) + '）</span>';
            }
            html += '</div>';
            html += '</div>';
        }

    // 显示警告
    if (result.warnings && result.warnings.length > 0) {
        html += '<div class="warnings-section">';
        for (var wi = 0; wi < result.warnings.length; wi++) {
            html += '<div class="warning-item">' + _escHtml(result.warnings[wi]) + '</div>';
        }
        html += '</div>';
    }

    document.getElementById("resultContent").innerHTML = html;
    resultSection.classList.add("show");

    // 滚动到结果区域
    setTimeout(function() {
        var target = resultSection.classList.contains("show") ? resultSection : errorSection;
        target.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
}


function showError(msg) {
    var errorSection = document.getElementById("errorSection");
    document.getElementById("errorContent").textContent = msg;
    document.getElementById("resultSection").classList.remove("show");
    errorSection.classList.add("show");
    errorSection.scrollIntoView({ behavior: "smooth", block: "start" });
}
