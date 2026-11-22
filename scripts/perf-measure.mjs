// Dev-only performance harness (docs/development/setup.md → "Performance measurements").
//   PERF_DIR=<scratch folder> node scripts/perf-measure.mjs <vaalytics.exe> <label> [navRounds] [idleSecs]
// <exe> must be a build with the VAALYTICS_DATA_DIR override (a debug build with the bundled
// frontend: `npx tauri build --debug --no-bundle`). Each run copies $PERF_DIR/qa-base (a COPY of a
// data folder: vaalytics.db + caches; never the real one) to a fresh folder, launches the app with
// WebView2 remote debugging on :9333, and measures startup, idle RAM/CPU (host + WebView2), idle on
// Location Atlas, IPC timings, first visit of every module, repeated navigation (JS heap after GC,
// DOM nodes, memory). Writes $PERF_DIR/result-<label>.json and kills the process it started.
import { spawn, execFileSync } from "node:child_process";
import { cpSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const S = process.env.PERF_DIR;
if (!S) throw new Error("set PERF_DIR to a scratch folder that contains qa-base/");
const [, , exe, label, navRounds = "1", idleSecs = "60"] = process.argv;
const run = join(S, "run-" + label);
rmSync(run, { recursive: true, force: true });
mkdirSync(run, { recursive: true });
cpSync(join(S, "qa-base"), join(run, "data"), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function procs(hostPid) {
  const ps = `Get-CimInstance Win32_Process | ? { $_.ProcessId -eq ${hostPid} -or ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like '*${run.replace(/\//g, "\\").split("\\").pop()}*') } | % { "$($_.ProcessId)|$($_.Name)|$($_.WorkingSetSize)|$($_.PrivatePageCount)|$($_.KernelModeTime + $_.UserModeTime)" }`;
  const out = execFileSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" });
  return out.trim().split(/\r?\n/).filter(Boolean).map((l) => {
    const [pid, name, ws, priv, cpu] = l.split("|");
    return { pid: +pid, host: +pid === hostPid, ws: +ws, priv: +priv, cpu100ns: +cpu };
  });
}
function summarize(p) {
  const h = p.filter((x) => x.host), w = p.filter((x) => !x.host);
  const sum = (a, k) => a.reduce((s, x) => s + x[k], 0);
  return { hostWsMB: sum(h, "ws") / 2 ** 20, hostPrivMB: sum(h, "priv") / 2 ** 20, wvCount: w.length, wvWsMB: sum(w, "ws") / 2 ** 20, wvPrivMB: sum(w, "priv") / 2 ** 20, hostCpu: sum(h, "cpu100ns"), wvCpu: sum(w, "cpu100ns") };
}
async function cpuOver(hostPid, secs) {
  const a = summarize(procs(hostPid));
  const t0 = Date.now();
  await sleep(secs * 1000);
  const b = summarize(procs(hostPid));
  const wall = (Date.now() - t0) * 1e4; // 100ns units
  return { ...b, hostCpuPct: (100 * (b.hostCpu - a.hostCpu)) / wall, wvCpuPct: (100 * (b.wvCpu - a.wvCpu)) / wall };
}
const r1 = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !["hostCpu", "wvCpu"].includes(k)).map(([k, v]) => [k, typeof v === "number" ? Math.round(v * 10) / 10 : v]));

const t0 = performance.now();
const child = spawn(exe, [], {
  env: { ...process.env, VAALYTICS_DATA_DIR: join(run, "data"), WEBVIEW2_USER_DATA_FOLDER: join(run, "wv2"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9333 --remote-allow-origins=http://127.0.0.1" },
  stdio: "ignore",
});
let page;
while (!page) {
  if (performance.now() - t0 > 60000) throw new Error("no CDP target");
  try {
    const t = await (await fetch("http://127.0.0.1:9333/json")).json();
    page = t.find((x) => x.type === "page" && x.url.startsWith("http://tauri.localhost") && !x.url.includes("#"));
  } catch {}
  if (!page) await sleep(50);
}
const tTarget = performance.now() - t0;
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send("Runtime.evaluate", { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true })).result?.result?.value;

// Ready = the shell's section nav or the game-selection screen is rendered.
let tReady;
while (true) {
  const ok = await ev(`return !!document.querySelector('nav[aria-label="Sections"] button') || /Path of Exile/.test(document.body?.innerText ?? '')`);
  if (ok) { tReady = performance.now() - t0; break; }
  if (performance.now() - t0 > 60000) throw new Error("not ready");
  await sleep(25);
}
const result = { label, startup: { cdpTargetMs: Math.round(tTarget), readyMs: Math.round(tReady) } };
// Enter PoE 1 if on game selection.
const onSelect = await ev(`return !document.querySelector('nav[aria-label="Sections"] button')`);
result.startedOnGameSelect = onSelect;

await sleep(5000);
result.idle1 = r1(await cpuOver(child.pid, +idleSecs));

// Idle on the Location Atlas page (polls the PoE 1 log every 2 s while visible).
await ev(`const b=[...document.querySelectorAll('nav[aria-label="Sections"] button')].find(b=>b.innerText.includes('Location Atlas'));b?.click();`);
await sleep(5000);
result.atlasIdle = r1(await cpuOver(child.pid, +idleSecs));
// IPC timings of the heaviest reads (main-thread commands before this change).
result.ipc = await ev(`
  const inv = window.__TAURI_INTERNALS__.invoke; const out = {};
  const lg = (await inv('market_leagues',{game:'poe1'}))[0]?.name;
  for (const [cmd,args] of [['market_overview',{game:'poe1',league:lg,category:'unique-armours'}],['session_list',{game:'poe2',query:{}}],['get_diagnostics',{}]]) {
    const ts=[]; for (let i=0;i<10;i++){ const t=performance.now(); try{await inv(cmd,args);}catch(e){out[cmd+'_err']=String(e);} ts.push(performance.now()-t);} ts.sort((a,b)=>a-b); out[cmd]=Math.round(ts[5]*10)/10;
  }
  return out;`);

// Visit every module of both games; first visit includes lazy chunk load.
const NAV = `[...document.querySelectorAll('nav[aria-label="Sections"] button, nav[aria-label="Application"] button')]`;
async function visitAll(timings) {
  const n = await ev(`return ${NAV}.length`);
  for (let i = 0; i < n; i++) {
    const t = await ev(`
      const b = ${NAV}[${i}]; if (!b) return null;
      const name = b.innerText.trim().split('\\n')[0];
      const main = document.querySelector('main') ?? document.body;
      const t0 = performance.now(); b.click();
      // settle: wait until no Suspense fallback / spinner and two frames passed
      for (let k = 0; k < 400; k++) {
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        if (!main.querySelector('[aria-busy="true"], [data-suspense-fallback]')) break;
      }
      return { name, ms: Math.round(performance.now() - t0) };`);
    if (t) timings.push(t);
    await sleep(400);
  }
}
async function switchGame(target) {
  // back to game selection via the game switch button, then click target game card
  await ev(`const b=[...document.querySelectorAll('button')].find(b=>b.title==='Switch game');b?.click();`);
  await sleep(800);
  await ev(`const b=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Open '+${JSON.stringify(target)});b?.click();`);
  await sleep(1500);
}
result.firstVisit = {};
for (const g of ["Path of Exile", "Path of Exile 2"]) {
  if (await ev(`return !document.querySelector('nav[aria-label="Sections"] button')`)) {
    await ev(`const b=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Open '+${JSON.stringify(g)});b?.click();`);
    await sleep(1500);
  }
  const shellGame = await ev(`return document.body.innerText.slice(0,4000)`);
  const timings = [];
  await visitAll(timings);
  result.firstVisit[g] = timings;
  result["afterVisit_" + g] = r1(summarize(procs(child.pid)));
  await switchGame(g === "Path of Exile" ? "Path of Exile 2" : "Path of Exile");
}
// Repeated navigation rounds for leak detection.
result.rounds = [];
for (let r = 0; r < +navRounds; r++) {
  const timings = [];
  await visitAll(timings);
  const heap = await ev(`return performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576*10)/10 : null`);
  await send("HeapProfiler.collectGarbage");
  const heapGc = await ev(`return performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576*10)/10 : null`);
  const dom = await ev(`return document.getElementsByTagName('*').length`);
  result.rounds.push({ round: r + 1, at: Math.round((performance.now() - t0) / 1000), heapMB: heap, heapAfterGcMB: heapGc, domNodes: dom, ...r1(summarize(procs(child.pid))), avgNavMs: Math.round(timings.reduce((s, t) => s + t.ms, 0) / Math.max(1, timings.length)) });
}
await sleep(5000);
result.idle2 = r1(await cpuOver(child.pid, +idleSecs));
ws.close();
execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
writeFileSync(join(S, `result-${label}.json`), JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));
process.exit(0);
