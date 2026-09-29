#!/usr/bin/env node
/**
 * 灵数求解器 · Agent 接入演示（零依赖，仅用 Node 原生 fetch）
 *
 * 跑法：
 *   node examples/agent-demo.cjs
 *
 * 作用：向生产端点 https://hongchenlingjing.com/mcp 发起一次真实 MCP 调用，
 *       展示 agent 如何用它做「确定性、可认证的实根计算」。
 * 不依赖任何 SDK；协议为 MCP Streamable-HTTP（initialize → notifications/initialized → tools/call）。
 */

const BASE = process.env.LINGSHU_URL || "https://hongchenlingjing.com/mcp";
const H = { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" };

async function mcp(method, params, sid) {
  const headers = { ...H };
  if (sid) headers["Mcp-Session-Id"] = sid;
  const r = await fetch(BASE, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: Math.floor(Math.random() * 1e6), method, params }),
  });
  const newSid = r.headers.get("mcp-session-id") || sid;
  const txt = await r.text();
  let msg;
  try { msg = JSON.parse(txt); } catch { msg = { raw: txt.slice(0, 300) }; }
  return { sid: newSid, msg };
}
const textOf = (r) => r.msg?.result?.content?.[0]?.text || JSON.stringify(r.msg).slice(0, 400);

(async () => {
  console.log("▶ 连接", BASE);
  const init = await mcp("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "agent-demo", version: "1.0" },
  });
  await fetch(BASE, {
    method: "POST",
    headers: { ...H, "Mcp-Session-Id": init.sid },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });

  // 1) 多项式实根（带构造性认证）
  const pr = await mcp("tools/call", { name: "poly_roots", arguments: { coefficients: [1, -2, -5, 6], honorPaid: true } }, init.sid);
  const prj = JSON.parse(textOf(pr));
  console.log("poly_roots([1,-2,-5,6]) =>");
  console.log("   解数:", prj.solutionCount, "| 认证:", prj.certified);
  console.log("   根:", (prj.solutions || []).map((s) => s.values?.[0]).join(", "));

  // 2) 候选根认证：2.1 是不是根？
  const vf = await mcp("tools/call", { name: "verify", arguments: { equation: "x^3 - 2*x^2 - 5*x + 6 = 0", candidate: 2.1, honorPaid: true } }, init.sid);
  const vfj = JSON.parse(textOf(vf));
  console.log("verify(2.1) => verdict:", vfj.verdict, "| 最近认证根:", JSON.stringify(vfj.nearestCertifiedRoot?.values ?? vfj.certifiedRoot?.values));

  console.log("\n✓ 以上结果来自生产端点实时返回，可断网复算、可回代验证。");
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
