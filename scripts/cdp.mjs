// Dev-only visual QA helper. Launch the app with WebView2 remote debugging (see docs/development/setup.md),
// then: node scripts/cdp.mjs <out.png|-> "<async JS body>"  — evaluates JS in the main webview and screenshots it.
const [, , out, expr = "1"] = process.argv;
const targets = await (await fetch("http://127.0.0.1:9333/json")).json();
// CDP_TARGET=overlay|atlas|act-tracker selects that window; default is the main window.
const want = process.env.CDP_TARGET ?? "main";
const windowOf = (url) => (url.includes("#overlay") ? "overlay" : url.includes("#atlas") ? "atlas" : url.includes("#act-tracker") ? "act-tracker" : "main");
const page = targets.find((t) => t.type === "page" && (t.url.includes("localhost:1420") || t.url.startsWith("http://tauri.localhost")) && windowOf(t.url) === want);
if (!page) throw new Error("page not found: " + JSON.stringify(targets.map((t) => t.url)));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg);
};
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const ev = await send("Runtime.evaluate", { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true });
console.log(JSON.stringify(ev.result?.result?.value ?? ev.result?.exceptionDetails?.exception?.description ?? null));
// CDP_MOUSE="x,y" moves the real pointer (for :hover states) before the screenshot.
if (process.env.CDP_MOUSE) {
  const [x, y] = process.env.CDP_MOUSE.split(",").map(Number);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await new Promise((r) => setTimeout(r, 900));
}
if (out !== "-") {
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(out, Buffer.from(shot.result.data, "base64"));
  console.log("saved", out);
}
ws.close();
