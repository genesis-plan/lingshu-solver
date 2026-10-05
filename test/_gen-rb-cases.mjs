#!/usr/bin/env node
/**
 * test/_gen-rb-cases.mjs — 从 rootbound-parity.mjs 抽出题集写到 _rb-cases.json
 *
 * 为什么要有这个中转：题集 CASES 只在 parity 脚本里定义，而 parity 脚本在
 * import 时就会去读预生成结果。要在跑 parity **之前**先落盘题集，就必须能
 * 访问那份CASES 又不能执行 parity 的主流程。
 *   最早版本是在 npm script 里用 node -e 正则抓再 eval —— 转义地狱，
 *   而且 npm script 里的引号在 sh 与 cmd 下行为不同，极易再次踩坑。
 * 正解：独立小文件，两边共用同一份解析逻辑。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'test', 'rootbound-parity.mjs'), 'utf8');
const m = src.match(/const CASES = \[([\s\S]*?)\n\];/);
if (!m) { console.error('❌ 没能从 rootbound-parity.mjs 里抓到 CASES'); process.exit(1); }
// eslint-disable-next-line no-eval
const CASES = eval('[' + m[1] + ']');
if (!Array.isArray(CASES) || !CASES.length) { console.error('❌ CASES 解析结果异常'); process.exit(1); }
fs.writeFileSync(path.join(ROOT, 'test', '_rb-cases.json'), JSON.stringify(CASES), 'utf8');
console.log('题集已落盘：' + CASES.length + ' 条');
