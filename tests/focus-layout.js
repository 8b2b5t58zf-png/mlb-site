"use strict";
// 以 Chrome 裝置寬度量測試頁：360、374 與桌面，確認整頁與卡片第一行不橫向溢出。
const {spawn} = require("child_process");
const fs = require("fs");
const path = require("path");

const chromeBin = process.env.CHROME || "google-chrome";
const fixture = "file://" + path.resolve(__dirname, "focus-fixture.html");
const outDir = process.env.FOCUS_SHOT_DIR || "/tmp/focus-shots";
const port = 9333 + (process.pid % 1000);
fs.mkdirSync(outDir, {recursive:true});

const chrome = spawn(chromeBin, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
  "--hide-scrollbars", "--allow-file-access-from-files",
  "--user-data-dir=/tmp/chrome-focus-cdp-" + process.pid,
  "--remote-debugging-port=" + port,
  fixture,
], {stdio:"ignore"});

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
async function target(){
  for(let i = 0; i < 40; i++){
    try{
      const list = await (await fetch("http://127.0.0.1:" + port + "/json")).json();
      const page = list.find(t => t.type === "page" && t.webSocketDebuggerUrl);
      if(page) return page;
    }catch(e){}
    await sleep(150);
  }
  throw new Error("chrome 沒有開出頁面");
}

async function session(wsUrl){
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  let n = 0;
  const pending = new Map();
  ws.addEventListener("message", ev => {
    const msg = JSON.parse(ev.data);
    if(msg.id && pending.has(msg.id)){ pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  function send(method, params){
    const id = ++n;
    return new Promise((res, rej) => {
      pending.set(id, msg => msg.error ? rej(new Error(method + " " + JSON.stringify(msg.error))) : res(msg.result || {}));
      ws.send(JSON.stringify({id, method, params}));
    });
  }
  return {ws, send};
}

(async () => {
  const page = await target();
  const {ws, send} = await session(page.webSocketDebuggerUrl);
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Runtime.evaluate", {expression:"document.fonts.ready.then(()=>measure())", awaitPromise:true});
  const widths = [360, 374, 1280];
  let fail = 0;
  for(const w of widths){
    await send("Emulation.setDeviceMetricsOverride", {width:w, height:1400, deviceScaleFactor:1, mobile:w < 800});
    await send("Runtime.evaluate", {expression:"measure()", awaitPromise:true});
    const ev = await send("Runtime.evaluate", {expression:"document.getElementById('report').textContent", returnByValue:true});
    const report = JSON.parse(ev.result.value);
    const rowOver = (report.rows || []).filter(x => x.over);
    console.log(w, JSON.stringify(report));
    if(report.page > 1 || rowOver.length || !(report.badges || []).includes("預測焦點") || report.w !== w){
      console.error("layout fail", w);
      fail++;
    }
    const shot = await send("Page.captureScreenshot", {format:"png", captureBeyondViewport:true, fromSurface:true});
    fs.writeFileSync(path.join(outDir, "focus-" + w + ".png"), Buffer.from(shot.data, "base64"));
  }
  ws.close();
  chrome.kill("SIGKILL");
  if(fail) process.exit(1);
  console.log("layout ok");
})().catch(err => { console.error(err); chrome.kill("SIGKILL"); process.exit(1); });
