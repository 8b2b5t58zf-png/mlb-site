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
    const cards = report.cards || [];
    const orderOk = cards.length === 6
      && cards[0].tms[0].ha === "主" && cards[0].tms[0].nm === "道奇" && cards[0].tms[1].ha === "客" && cards[0].tms[1].nm === "釀酒人"
      && cards[0].pct[0] === "62%" && cards[0].pct[1] === "38%"
      && cards[0].bar[0] === "fav:62%" && cards[0].bar[1] === "oth:38%"
      && cards[0].pitch[0] === "主 山本由伸" && cards[0].pitch[1] === "客 大谷翔平"
      && cards[0].cmp.includes("客 釀酒人") && cards[0].cmp.includes("主 道奇")
      && cards[1].tms[0].ha === "客" && cards[1].tms[0].nm === "響尾蛇" && cards[1].tms[1].nm === "教士"
      && cards[2].tms[0].nm === "尼克" && cards[2].tms[1].nm === "塞爾提克"
      && cards[3].tms[0].ha === "主" && cards[3].tms[0].nm === "道奇" && cards[3].tms[1].ha === "客"
      && cards[4].tms[0].ha === "客" && cards[4].tms[0].nm === "光芒" && cards[4].tms[1].ha === "主" && cards[4].tms[1].nm === "金鶯"
      && cards[4].pct[0] === "50%" && cards[4].pct[1] === "50%"
      && cards[5].tms[0].nm === "拓荒者" && cards[5].tms[1].nm === "塞爾提克"
      && cards[5].time.includes("10/20（二）08:08") && cards[5].time.includes("（台灣時間）")
      && cards.every(c => c.tms.length === 2 && c.tms[0].ha && c.tms[1].ha && /（[日一二三四五六]）\d{2}:\d{2}/.test(c.time || "（日）00:00"));
    const dateOk = cards.filter(c => c.time).every(c => /（[日一二三四五六]）\d{2}:\d{2}/.test(c.time));
    console.log(w, JSON.stringify(report));
    const hitOk = report.hit === "客@主" || report.hit === "對戰（客@主）";
    if(report.page > 1 || rowOver.length || !(report.badges || []).includes("預測焦點") || report.w !== w || !orderOk || !dateOk || !hitOk){
      console.error("layout fail", w, {orderOk, dateOk, hit:report.hit, hitOk, rowOver});
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
