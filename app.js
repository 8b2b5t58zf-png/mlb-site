// MLB 官方免費 API 的網址開頭
const API = "https://statsapi.mlb.com/api/v1";
// 自動使用今年球季（若今年還沒資料，會改用去年）
let season = new Date().getFullYear();

// 30 支球隊的台灣常用中文名稱（用球隊 id 對照）：[全名, 簡稱]
const ZH = {108:["洛杉磯天使","天使"],109:["亞利桑那響尾蛇","響尾蛇"],110:["巴爾的摩金鶯","金鶯"],111:["波士頓紅襪","紅襪"],
112:["芝加哥小熊","小熊"],113:["辛辛那提紅人","紅人"],114:["克里夫蘭守護者","守護者"],115:["科羅拉多落磯","落磯"],
116:["底特律老虎","老虎"],117:["休士頓太空人","太空人"],118:["堪薩斯市皇家","皇家"],119:["洛杉磯道奇","道奇"],
120:["華盛頓國民","國民"],121:["紐約大都會","大都會"],133:["運動家","運動家"],134:["匹茲堡海盜","海盜"],
135:["聖地牙哥教士","教士"],136:["西雅圖水手","水手"],137:["舊金山巨人","巨人"],138:["聖路易紅雀","紅雀"],
139:["坦帕灣光芒","光芒"],140:["德州遊騎兵","遊騎兵"],141:["多倫多藍鳥","藍鳥"],142:["明尼蘇達雙城","雙城"],
143:["費城費城人","費城人"],144:["亞特蘭大勇士","勇士"],145:["芝加哥白襪","白襪"],146:["邁阿密馬林魚","馬林魚"],
147:["紐約洋基","洋基"],158:["密爾瓦基釀酒人","釀酒人"]};
// 小工具：取中文全名／簡稱，找不到就用英文原名
const tn = t => (ZH[t.id]||[t.name])[0];
const ts = t => (ZH[t.id]||[,t.abbreviation||t.name])[1];

// 分區代號對照中文名稱
const DIV = {201:"美聯東區",202:"美聯中區",200:"美聯西區",204:"國聯東區",205:"國聯中區",203:"國聯西區"};

// 小工具：抓取網址並轉成 JSON 資料
// 抓資料，成功時存一份到瀏覽器（localStorage）；失敗時改用上次存的舊資料
let usedCache = null;   // 若本區塊用了舊資料，記下那份資料的時間
async function getJSON(url){
  const key = "mlbcache:" + url.replace(/startDate=[^&]*&endDate=[^&]*/,"sched"); // 賽程網址每天不同，統一一個鑰匙
  try{
    const r = await fetch(url);
    if(!r.ok) throw new Error("HTTP " + r.status);
    const data = await r.json();
    try{ localStorage.setItem(key, JSON.stringify({t:Date.now(), data})); }catch(e){}  // 空間不夠就略過
    return data;
  }catch(e){
    const c = JSON.parse(localStorage.getItem(key) || "null");
    if(!c) throw e;
    if(!usedCache || c.t < usedCache) usedCache = c.t;
    return c.data;
  }
}
// 台灣時間（UTC+8）完整日期
const twFull = t => new Date(t).toLocaleString("zh-TW",{timeZone:"Asia/Taipei",hour12:false}) + "（台灣時間）";

// 骨架畫面：資料載入前先顯示灰色閃動條
const skeleton = n => Array.from({length:n},(_, i)=>`<div class="sk" style="width:${90-i*7}%"></div>`).join("");

// 執行一個區塊：先顯示骨架，成功顯示資料；失敗顯示錯誤＋重試按鈕
async function runSection(ids, fn){
  for(const id of ids){ document.getElementById("st-"+id).innerHTML = ""; document.getElementById(id).innerHTML = id==="chart" ? '<canvas id="winChart"></canvas>' : skeleton(5); }
  usedCache = null;
  try{
    await fn();
    if(usedCache) for(const id of ids) document.getElementById("st-"+id).innerHTML = `<div class="stale">⚠️ 目前無法連線，顯示的是先前存下的資料（更新於 ${twFull(usedCache)}）</div>`;
    return true;
  }catch(e){
    for(const id of ids) document.getElementById("st-"+id).innerHTML = `<div class="err">😢 資料載入失敗（${e.message||e}）<button onclick='runSection(${JSON.stringify(ids)}, ${fn.name})'>重試</button></div>`;
    for(const id of ids) if(id!=="chart") document.getElementById(id).innerHTML = "";
    return false;
  }
}

// 步驟一：抓戰績資料，畫出戰績表
async function loadStandings(){
  let d = await getJSON(`${API}/standings?leagueId=103,104&season=${season}&standingsTypes=regularSeason&hydrate=team`);
  if(!d.records || d.records.length===0){ season--; d = await getJSON(`${API}/standings?leagueId=103,104&season=${season}&standingsTypes=regularSeason&hydrate=team`); }
  document.getElementById("season").textContent = season;
  let html = '<div class="divs">';
  const all = [];
  for(const rec of d.records){
    html += `<div><h3>${DIV[rec.division.id]||"分區"}</h3><table><tr><th>球隊</th><th>勝</th><th>敗</th><th>勝率</th><th>勝差</th></tr>`;
    for(const t of rec.teamRecords){
      html += `<tr><td>${tn(t.team)}</td><td>${t.wins}</td><td>${t.losses}</td><td>${t.winningPercentage}</td><td>${t.gamesBack}</td></tr>`;
      all.push(t); TEAM[t.team.id]=t;
    }
    html += "</table></div>";
  }
  document.getElementById("standings").innerHTML = html + "</div>";
  drawChart(all);
}

// 步驟二：用 Chart.js 畫出各隊勝率長條圖（由高到低排序）
function drawChart(teams){
  teams.sort((a,b)=>b.winningPercentage-a.winningPercentage);
  new Chart(document.getElementById("winChart"),{
    type:"bar",
    data:{labels:teams.map(t=>ts(t.team)||tn(t.team)),
      datasets:[{label:"勝率",data:teams.map(t=>parseFloat(t.winningPercentage)),
        backgroundColor:teams.map(t=>t.team.league.id===103?"#c8102e":"#002d72")}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},title:{display:true,text:"紅色＝美國聯盟，藍色＝國家聯盟"}},
      scales:{y:{min:0.3,max:0.7}}}
  });
}

// 步驟三：抓排行榜（每項前 5 名）
async function loadLeaders(cats, group, elId){
  const d = await getJSON(`${API}/stats/leaders?leaderCategories=${Object.keys(cats).join(",")}&season=${season}&statGroup=${group}&limit=5&sportId=1`);
  let html = "";
  for(const L of d.leagueLeaders||[]){
    html += `<div><h3>${cats[L.leaderCategory]}</h3><table><tr><th>球員</th><th>球隊</th><th>數據</th></tr>`;
    for(const p of L.leaders) html += `<tr><td>${p.rank}. ${pn(p.person)}</td><td>${tn(p.team)}</td><td>${p.value}</td></tr>`;
    html += "</table></div>";
  }
  document.getElementById(elId).innerHTML = html || "查無資料";
}

// ===== 比賽預測 + 賽後分析 =====
// 存每隊的戰績資料（由戰績表步驟填入），以球隊 id 當鑰匙
const TEAM = {};

// 畢氏期望勝率：用得分(RS)與失分(RA)推算「應該」有的勝率
function pyth(rs, ra){ return rs**1.83 / (rs**1.83 + ra**1.83); }
// 每隊實力分數＝實際勝率與畢氏勝率各一半
function strength(id){ const t = TEAM[id]; return 0.5*parseFloat(t.winningPercentage) + 0.5*pyth(t.runsScored, t.runsAllowed); }
// Log5 公式：A 隊實力 a、B 隊實力 b 時，A 贏的機率；主場隊再加 4%
function predictHome(hId, aId){
  const h = strength(hId), a = strength(aId);
  let p = (h - h*a) / (h + a - 2*h*a);
  return Math.min(0.95, p + 0.04);
}
// 把 UTC 時間轉成台灣時間字串
// 季後賽系列名稱中文化
const SERIES = {"World Series":"世界大賽","AL Championship Series":"美聯冠軍賽","NL Championship Series":"國聯冠軍賽","AL Division Series":"美聯分區系列賽","NL Division Series":"國聯分區系列賽","AL Wild Card Series":"美聯外卡賽","NL Wild Card Series":"國聯外卡賽"};
const sz = s => SERIES[s] || s;
const tw = s => new Date(s).toLocaleString("zh-TW",{timeZone:"Asia/Taipei",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});

// 抓最近 14 天到未來 7 天的賽程（含比分、先發投手）
async function loadGames(){
  const fmt = d => d.toISOString().slice(0,10);
  const now = new Date();
  const s = fmt(new Date(now - 14*864e5)), e = fmt(new Date(+now + 7*864e5));
  const d = await getJSON(`${API}/schedule?sportId=1&startDate=${s}&endDate=${e}&hydrate=linescore,probablePitcher,decisions,team,seriesStatus`);
  const games = (d.dates||[]).flatMap(x=>x.games);
  const done = games.filter(g=>g.status.abstractGameState==="Final").reverse().slice(0,5); // 最近 5 場已完賽
  const next = games.filter(g=>g.status.abstractGameState==="Preview").slice(0,4);         // 接下來 4 場
  renderPredict(next.length ? next : done, !next.length);
  await renderAnalysis(done);
}

// 畫出預測卡片
// 30 隊代表色（球隊主色）
const COLOR = {108:"#BA0021",109:"#A71930",110:"#DF4601",111:"#BD3039",112:"#0E3386",113:"#C6011F",114:"#00385D",115:"#33006F",
116:"#0C2340",117:"#EB6E1F",118:"#004687",119:"#005A9C",120:"#AB0003",121:"#FF5910",133:"#003831",134:"#27251F",135:"#2F241D",
136:"#005C5C",137:"#FD5A1E",138:"#C41E3A",139:"#092C5C",140:"#003278",141:"#134A8E",142:"#002B5C",143:"#E81828",144:"#CE1141",
145:"#27251F",146:"#00A3E0",147:"#0C2340",158:"#12284B"};
// 信心分級（看好方的機率）
function tier(p){
  if(p >= 0.60) return ["strong","💪 很有把握"];
  if(p >= 0.55) return ["lean","👍 略佔優勢"];
  return ["toss","⚖️ 五五波"];
}
// 畫出預測卡片：大標題＋信心標籤＋左右對比條
function renderPredict(games, isPast){
  let html = isPast ? "<p>目前沒有即將開打的比賽，改顯示最近比賽的賽前估算：</p>" : "";
  for(const g of games){
    const H = g.teams.home, A = g.teams.away;
    if(!TEAM[H.team.id] || !TEAM[A.team.id]) continue;
    const p = predictHome(H.team.id, A.team.id), hp = Math.round(p*100), ap = 100-hp;
    const favHome = hp >= ap, fp = Math.max(hp, ap), fav = favHome ? H.team : A.team;
    const [tc, tl] = tier(fp/100);
    const pp = x => x.probablePitcher ? pn(x.probablePitcher) : "未公布";
    html += `<div class="pcard">
      <div class="meta">${tw(g.gameDate)}（台灣時間）${g.seriesStatus ? "｜"+sz(g.seriesStatus.description) : ""}</div>
      <div class="headline">看好：${tn(fav)} ${fp}%</div>
      <div><span class="tier ${tc}">${tl}</span></div>
      <div class="vs"><span>客 ${tn(A.team)}</span><span>主 ${tn(H.team)}</span></div>
      <div class="cmp" role="img" aria-label="${tn(A.team)} ${ap}%，${tn(H.team)} ${hp}%">
        <div class="away${favHome?"":" fav"}" style="width:${ap}%;background:${COLOR[A.team.id]||"#666"}">${ts(A.team)} ${ap}%</div>
        <div class="home${favHome?" fav":""}" style="width:${hp}%;background:${COLOR[H.team.id]||"#666"}">${ts(H.team)} ${hp}%</div>
      </div>
      <div class="detail">預定先發：${ts(A.team)} ${pp(A)}／${ts(H.team)} ${pp(H)}<br>
        實力分數：${ts(A.team)} ${strength(A.team.id).toFixed(3)}、${ts(H.team)} ${strength(H.team.id).toFixed(3)}</div>
    </div>`;
  }
  document.getElementById("predict").innerHTML = html || "查無比賽";
}

// 投手成績轉成中文一句話
function pLine(p){ const s = p.stats.pitching; return `${pn(p.person)} 投 ${s.inningsPitched} 局、被敲 ${s.hits} 安、失 ${s.earnedRuns} 分自責、${s.strikeOuts} 次三振、${s.baseOnBalls} 次保送`; }

// 為每場已完賽比賽產生分析文章（全部取自官方 boxscore 數據）
async function renderAnalysis(games){
  let html = "";
  for(const g of games){
    const box = await getJSON(`${API}/game/${g.gamePk}/boxscore`);
    const L = g.linescore, H = g.teams.home, A = g.teams.away;
    const homeWin = H.score > A.score;
    const W = homeWin ? "home":"away", Lo = homeWin ? "away":"home";
    const wName = tn(g.teams[W].team), lName = tn(g.teams[Lo].team);
    // 逐局比分表
    let ls = `<table class="ls"><tr><th>球隊</th>${L.innings.map(i=>`<th>${i.num}</th>`).join("")}<th>分</th><th>安</th><th>失誤</th></tr>`;
    for(const side of ["away","home"]) ls += `<tr><td>${ts(g.teams[side].team)}</td>${L.innings.map(i=>`<td>${i[side].runs ?? "-"}</td>`).join("")}<td><b>${L.teams[side].runs}</b></td><td>${L.teams[side].hits}</td><td>${L.teams[side].errors}</td></tr>`;
    ls += "</table>";
    // 找出得分最多的一局（關鍵局）
    const big = L.innings.reduce((m,i)=> (i[W].runs||0) > (m[W].runs||0) ? i : m, L.innings[0]);
    // 先發投手＝投手名單的第一位
    const sp = side => { const t = box.teams[side]; return t.players["ID"+t.pitchers[0]]; };
    // 勝方表現最好的打者：依「打點＋安打」排序取前 2 名
    const t = box.teams[W];
    const hitters = t.batters.map(id=>t.players["ID"+id]).filter(p=>p.stats.batting && p.stats.batting.atBats>0)
      .sort((x,y)=>(y.stats.batting.rbi*2+y.stats.batting.hits)-(x.stats.batting.rbi*2+x.stats.batting.hits)).slice(0,2)
      .filter(p=>p.stats.batting.hits>0 || p.stats.batting.rbi>0)
      .map(p=>{const b=p.stats.batting; return `${pn(p.person)}（${b.atBats} 打數 ${b.hits} 安、${b.rbi} 分打點${b.homeRuns?`、${b.homeRuns} 支全壘打`:""}）`;});
    // 組合成文章
    const reasons = [];
    reasons.push(`關鍵在第 ${big.num} 局，${wName} 單局攻下 ${big[W].runs} 分。`);
    if(L.teams[W].hits !== L.teams[Lo].hits) reasons.push(`安打數 ${L.teams[W].hits} 比 ${L.teams[Lo].hits}，${L.teams[W].hits>L.teams[Lo].hits?"勝方打線更有效率":"勝方雖安打較少，但把握住得分機會"}。`);
    if(L.teams[Lo].errors>0) reasons.push(`${lName} 出現 ${L.teams[Lo].errors} 次失誤。`);
    // ===== 三行重點：全部由比賽數據依規則組成，不加任何臆測 =====
    const ws = sp(W).stats.pitching, wsName = pn(sp(W).person);
    const wb = t.batters.map(id=>t.players["ID"+id]).filter(p=>p.stats.batting && p.stats.batting.atBats>0);
    const hr = wb.filter(p=>p.stats.batting.homeRuns>0).sort((x,y)=>y.stats.batting.rbi-x.stats.batting.rbi)[0];
    const rbiMan = wb.filter(p=>p.stats.batting.rbi>=2).sort((x,y)=>y.stats.batting.rbi-x.stats.batting.rbi)[0];
    const key = hr || rbiMan;
    // 第一行：關鍵局＋關鍵一擊
    let h1 = big[W].runs>1 ? `${wName}第 ${big.num} 局一口氣攻下 ${big[W].runs} 分；` : `${wName}第 ${big.num} 局攻下關鍵 1 分；`;
    if(hr) h1 += `${pn(hr.person)}${hr.stats.batting.homeRuns>1?`雙響砲`:`開轟`}，全場貢獻 ${hr.stats.batting.rbi} 分打點！`;
    else if(rbiMan) h1 += `${pn(rbiMan.person)}全場 ${rbiMan.stats.batting.hits} 安 ${rbiMan.stats.batting.rbi} 分打點，火力全開！`;
    else h1 += `一舉拿下比賽主導權！`;
    // 第二行：勝方先發投手
    const ip = parseFloat(ws.inningsPitched);
    let h2 = `先發 ${wsName} 主投 ${ws.inningsPitched} 局${ws.runs===0?"無失分":`只失 ${ws.earnedRuns} 分自責`}、送出 ${ws.strikeOuts} 次三振`;
    h2 += ip>=6 && ws.earnedRuns<=3 ? "，穩穩守住場面。" : ip<5 ? "，之後交給牛棚接手。" : "，交出稱職內容。";
    // 第三行：牛棚／救援，或敗方失誤
    const bpRuns = t.pitchers.slice(1).reduce((s,id)=>s+(t.players["ID"+id].stats.pitching.runs||0),0);
    const bpN = t.pitchers.length-1;
    let h3;
    if(g.decisions && g.decisions.save) h3 = `終局由 ${pn(g.decisions.save)} 關門拿下救援成功${bpRuns===0?`，牛棚 ${bpN} 位投手零失分`:""}，${wName}守住勝利！`;
    else if(L.teams[Lo].errors>0) h3 = `${lName}全場出現 ${L.teams[Lo].errors} 次失誤，防守失誤讓對手有機可乘。`;
    else if(bpN>0) h3 = `牛棚 ${bpN} 位投手接力${bpRuns===0?"零失分":`共失 ${bpRuns} 分`}，終場 ${g.teams[W].score} 比 ${g.teams[Lo].score} 拿下勝利。`;
    else h3 = `${wsName} 一人投完全場，終場 ${g.teams[W].score} 比 ${g.teams[Lo].score} 收下勝利！`;
    html += `<article><h3>${tw(g.gameDate)}｜${tn(A.team)} ${A.score} : ${H.score} ${tn(H.team)}</h3>
      <div class="hl"><div class="hl-title">⚡ 三行重點</div><ol><li>${h1}</li><li>${h2}</li><li>${h3}</li></ol></div>
      <details class="full"><summary>📖 看完整分析</summary>
      ${ls}
      <p><b>${wName} 為什麼贏？</b>${reasons.join("")}</p>
      <p><b>先發投手：</b>勝方 ${pLine(sp(W))}；敗方 ${pLine(sp(Lo))}。</p>
      ${hitters.length?`<p><b>勝方關鍵打者：</b>${hitters.join("、")}。</p>`:""}
      ${g.decisions?`<p><small>勝投：${(g.decisions.winner&&pn(g.decisions.winner))||"-"}｜敗投：${(g.decisions.loser&&pn(g.decisions.loser))||"-"}${g.decisions.save?"｜救援成功："+pn(g.decisions.save):""}</small></p>`:""}
      </details>
    </article>`;
  }
  document.getElementById("analysis").innerHTML = html || "最近沒有已完賽的比賽";
}

// 預測命中率：讀取網站上的 data/predictions.json
async function secHit(){
  const el = document.getElementById("hit");
  if(location.protocol === "file:"){ el.innerHTML = '<p class="note">📂 直接開啟本機檔案時無法讀取預測紀錄，請到線上網站查看：<a href="https://8b2b5t58zf-png.github.io/mlb-site/#sec-hit">點這裡</a></p>'; return; }
  const r = await fetch("data/predictions.json?t=" + Date.now());
  if(!r.ok) throw new Error("HTTP " + r.status);
  const d = await r.json();
  const done = d.records.filter(x => x.correct !== null), ok = done.filter(x => x.correct).length;
  const rate = done.length ? Math.round(ok / done.length * 100) + "%" : "尚無已完賽紀錄";
  let html = `<p><b>命中率：${rate}</b>（已完賽 ${done.length} 場中猜對 ${ok} 場；總紀錄 ${d.records.length} 筆，等待結果 ${d.records.length - done.length} 筆）<br><small>最後更新：${d.updated.replace("(UTC+8)","（台灣時間）")}</small></p>`;
  html += '<div style="overflow-x:auto"><table><tr><th>比賽時間</th><th>對戰（客 @ 主）</th><th>預測勝方</th><th>預測勝率</th><th>實際比分</th><th>結果</th></tr>';
  for(const x of d.records.slice().reverse().slice(0,15)){
    const p = x.predictedWinner === x.home ? x.homeWinProb : x.awayWinProb;
    html += `<tr><td>${x.gameTime.replace(" (UTC+8)","")}</td><td>${x.away} @ ${x.home}</td><td>${x.predictedWinner}</td><td>${Math.round(p*100)}%</td><td>${x.final || "尚未開打／進行中"}</td><td>${x.correct === null ? "⏳" : x.correct ? "✅ 猜對" : "❌ 猜錯"}</td></tr>`;
  }
  el.innerHTML = html + "</table></div>";
}

// 每個區塊各自的載入步驟（取名字是為了讓「重試」按鈕能再呼叫一次）
async function secStandings(){ await loadStandings(); }
async function secGames(){ if(!Object.keys(TEAM).length) await loadStandings(); await loadGames(); }
async function secBatting(){ await loadLeaders({homeRuns:"全壘打",battingAverage:"打擊率",runsBattedIn:"打點"},"hitting","batting"); }
async function secPitching(){ await loadLeaders({earnedRunAverage:"防禦率",strikeouts:"三振",wins:"勝投"},"pitching","pitching"); }

// 主程式：先載戰績（預測要用），其餘區塊同時載入；任何一區失敗不影響其他區
(async()=>{
  await runSection(["standings","chart"], secStandings);
  await Promise.all([
    runSection(["predict","analysis"], secGames),
    runSection(["batting"], secBatting),
    runSection(["pitching"], secPitching),
    runSection(["hit"], secHit),
  ]);
})();
