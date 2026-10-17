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
let usedCache = null;
const PRE_NOTE = {};   // 區塊狀態列前綴（NBA 開季前：「例行賽 10/21 開打」）
let dataAt = null;      // 排程存檔的資料時間（正常狀況，只顯示一行灰字）   // 若本區塊用了舊資料，記下那份資料的時間
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

const RETRY = {};
const twMD = t => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Taipei",hour12:false,month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}).formatToParts(new Date(t)).map(x=>[x.type,x.value])); return `${p.month}/${p.day} ${p.hour==="24"?"00":p.hour}:${p.minute}`; };
const twShort = t => new Date(t).toLocaleString("zh-TW",{timeZone:"Asia/Taipei",hour12:false,month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});
// 執行一個區塊：先顯示骨架，成功顯示資料；失敗顯示錯誤＋重試按鈕
async function runSection(ids, fn){
  for(const id of ids){ document.getElementById("st-"+id).innerHTML = ""; document.getElementById(id).innerHTML = id==="chart" ? '<canvas id="winChart"></canvas>' : skeleton(5); }
  usedCache = null; dataAt = null;
  try{
    await fn();
    if(usedCache) for(const id of ids) document.getElementById("st-"+id).innerHTML = `<div class="stale">暫時抓不到最新資料，目前顯示 ${twMD(usedCache)} 的資料</div>`;
    else for(const id of ids){ const pre = PRE_NOTE[id];
      if(pre != null) document.getElementById("st-"+id).innerHTML = `<div class="dtime">${[pre, dataAt ? `資料時間 ${twMD(dataAt)}` : ""].filter(Boolean).join("・")}</div>`;
      else if(dataAt) document.getElementById("st-"+id).innerHTML = `<div class="dtime">資料時間：${twMD(dataAt)}</div>`; }
    setTimeout(markNav, 0);
    return true;
  }catch(e){
    // 不顯示技術錯誤字串；一分鐘後自動重試
    for(const id of ids) document.getElementById("st-"+id).innerHTML = `<div class="err"><span>暫時抓不到資料，稍後會自動重試</span><button onclick='runSection(${JSON.stringify(ids)}, ${fn.name})'>重新整理</button></div>`;
    clearTimeout(RETRY[ids[0]]); RETRY[ids[0]] = setTimeout(() => runSection(ids, fn), 60000);
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
        backgroundColor:teams.map(t=>t.team.league.id===103?"#d4af37":"#4a5563")}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},title:{display:true,text:"金色＝美國聯盟，灰色＝國家聯盟",color:"#8b949e"}},
      scales:{y:{min:0.3,max:0.7,ticks:{color:"#8b949e"},grid:{color:"#262e39"}},x:{ticks:{color:"#8b949e"},grid:{display:false}}}}
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
// ===== 預測模型 v2（依數據分析師 2026 例行賽回測建議）=====
// 步驟：① 兩隊戰績 Log5 → 縮回 50% 附近（基礎勝率）② 主場加成 ③ 先發投手 ERA、WHIP 差距
const MODEL_V = "v2";
const LG = {era:4.20, whip:1.30, reg:40};   // 聯盟平均 ERA、WHIP；投手數據先加 40 局平均表現（往平均拉回）
const sig = x => 1/(1+Math.exp(-x)), logit = p => Math.log(p/(1-p));
function log5(h, a){ return (h - h*a) / (h + a - 2*h*a); }
// 局數 "112.1" 代表 112 又 1/3 局
const ipNum = s => { const [a,b] = String(s).split("."); return +a + (+b||0)/3; };
const regERA  = s => (9*s.er + LG.era*LG.reg) / (s.ip + LG.reg);
const regWHIP = s => (s.h + s.bb + LG.whip*LG.reg) / (s.ip + LG.reg);
let FIPC = null;   // FIP 常數（由全聯盟數據算出）
const fip = s => s.ip>0 && FIPC!==null ? (13*s.hr + 3*(s.bb+s.hbp) - 2*s.so)/s.ip + FIPC : null;

// 算出主隊勝率與逐步差值（依 report.md：起點 50% → 戰績 → 主場 → 先發；四捨五入到 0.1%，加總等於最終）
function modelV2(hId, aId, hp, ap){
  const xb = 0.250*logit(log5(strength(hId), strength(aId)));
  const used = !!(hp && ap);
  const xs = used ? 0.137*(regERA(ap)-regERA(hp)) + 0.606*(regWHIP(ap)-regWHIP(hp)) : 0;
  const q1 = sig(xb), q2 = sig(xb+0.082), q3 = sig(xb+0.082+xs);
  const R1 = Math.round(q1*1000), R2 = Math.round(q2*1000), F = Math.round(q3*1000);
  return {final:q3, used, d1:(R1-500)/10, d2:(R2-R1)/10, d3:(F-R2)/10, F:F/10};
}

// 抓先發投手本季成績（若有轉隊，取全季合計）
const PSTAT = {};
async function loadPitchers(ids){
  ids = ids.filter(id => id && !(id in PSTAT));
  if(!ids.length) return;
  const d = await getJSON(`${API}/people?personIds=${ids.join(",")}&hydrate=stats(group=[pitching],type=[season],season=${season})`);
  for(const p of d.people||[]){
    const sp = (p.stats&&p.stats[0]&&p.stats[0].splits)||[];
    const tot = sp.find(x=>!x.team) ; const list = tot ? [tot] : sp;
    const s = {gs:0,ip:0,er:0,h:0,bb:0,hbp:0,hr:0,so:0};
    for(const x of list){ const t=x.stat; s.gs+=t.gamesStarted||0; s.ip+=ipNum(t.inningsPitched||0); s.er+=t.earnedRuns||0; s.h+=t.hits||0; s.bb+=t.baseOnBalls||0; s.hbp+=t.hitByPitch||0; s.hr+=t.homeRuns||0; s.so+=t.strikeOuts||0; }
    s.era = list.length===1 ? list[0].stat.era : (s.ip? (9*s.er/s.ip).toFixed(2):"-");
    s.whip = list.length===1 ? list[0].stat.whip : (s.ip? ((s.h+s.bb)/s.ip).toFixed(2):"-");
    PSTAT[p.id] = s;
  }
}
// 對戰看點用：球隊打擊（場均得分）、投手群 ERA、本季交手戰績（參考，不計入勝率）
const TSTAT = {}, H2H = {};
async function loadTeamHit(){
  try{
    const d = await getJSON(`${API}/teams/stats?season=${season}&group=hitting&stats=season&sportId=1`);
    for(const x of d.stats[0].splits){ const t=x.stat; if(t.gamesPlayed) TSTAT[x.team.id] = Object.assign(TSTAT[x.team.id]||{}, {rpg:(t.runs/t.gamesPlayed).toFixed(2)}); }
  }catch(e){}
}
async function loadH2H(aId, hId){
  const k = aId+"-"+hId; if(k in H2H) return;
  try{
    const d = await getJSON(`${API}/schedule?sportId=1&season=${season}&gameType=R&teamId=${hId}&opponentId=${aId}`);
    let hw=0, aw=0;
    for(const g of (d.dates||[]).flatMap(x=>x.games)){
      if(g.status.abstractGameState!=="Final") continue;
      const hs = g.teams.home.team.id===hId ? g.teams.home : g.teams.away, as = hs===g.teams.home ? g.teams.away : g.teams.home;
      if(hs.isWinner) hw++; else if(as.isWinner) aw++;
    }
    H2H[k] = hw+aw ? {hw, aw} : null;
  }catch(e){ H2H[k] = null; }
}
async function loadFIPC(){
  if(FIPC!==null) return;
  const d = await getJSON(`${API}/teams/stats?season=${season}&group=pitching&stats=season&sportId=1`);
  let ip=0,er=0,hr=0,bb=0,hbp=0,so=0;
  for(const x of d.stats[0].splits){ const t=x.stat; TSTAT[x.team.id] = Object.assign(TSTAT[x.team.id]||{}, {era:t.era}); ip+=ipNum(t.inningsPitched); er+=t.earnedRuns; hr+=t.homeRuns; bb+=t.baseOnBalls; hbp+=t.hitByPitch; so+=t.strikeOuts; }
  FIPC = 9*er/ip - (13*hr + 3*(bb+hbp) - 2*so)/ip;
}

// 季後賽系列名稱中文化
const SERIES = {"World Series":"世界大賽","AL Championship Series":"美聯冠軍賽","NL Championship Series":"國聯冠軍賽","AL Division Series":"美聯分區系列賽","NL Division Series":"國聯分區系列賽","AL Wild Card Series":"美聯外卡賽","NL Wild Card Series":"國聯外卡賽"};
const sz = s => SERIES[s] || s;
const tw = s => new Date(s).toLocaleString("zh-TW",{timeZone:"Asia/Taipei",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});

// 抓最近 14 天到未來 7 天的賽程（含比分、先發投手）
async function loadGames(){
  const fmt = d => d.toISOString().slice(0,10);
  const now = new Date();
  const s = fmt(new Date(now - 14*864e5)), e = fmt(new Date(+now + 7*864e5));
  const d = await getJSON(`${API}/schedule?sportId=1&startDate=${s}&endDate=${e}&hydrate=linescore,probablePitcher,decisions,team,seriesStatus,weather`);
  const games = (d.dates||[]).flatMap(x=>x.games);
  const done = games.filter(g=>g.status.abstractGameState==="Final" && g.linescore && g.linescore.innings && !["Postponed","Cancelled"].includes(g.status.detailedState)).reverse().slice(0,5); // 最近 5 場已完賽
  // 季後賽：同一系列只顯示下一場還沒打完的比賽（前一戰打完才出現下一戰；預測紀錄不受影響）
  const POST = ["F","D","L","W"], skey = g => g.gameType + ":" + [g.teams.home.team.id, g.teams.away.team.id].sort().join("-");
  const firstOpen = {};
  for(const g of games.filter(g=>POST.includes(g.gameType) && g.status.abstractGameState!=="Final").sort((a,b)=>new Date(a.gameDate)-new Date(b.gameDate))) if(!(skey(g) in firstOpen)) firstOpen[skey(g)] = g;
  const real = g => !!(TEAM[g.teams.home.team.id] && TEAM[g.teams.away.team.id]);   // 兩隊都確定才算
  const next = games.filter(g=>g.status.abstractGameState==="Preview" && real(g) && (!POST.includes(g.gameType) || firstOpen[skey(g)] === g)).slice(0,4);
  // 對戰組合未定的季後賽系列：不出卡片，只顯示一行開打日期
  const SNAME = {W:"世界大賽", L:"聯盟冠軍賽", D:"分區系列賽", F:"外卡系列賽"}, tbdSeen = {};
  const tbd = games.filter(g=>POST.includes(g.gameType) && g.status.abstractGameState==="Preview" && !real(g)).sort((a,b)=>new Date(a.gameDate)-new Date(b.gameDate)).filter(g => !tbdSeen[g.gameType] && (tbdSeen[g.gameType] = 1)).map(g => `${SNAME[g.gameType]} ${twWD(g.gameDate)}開打<br>對戰組合待${g.gameType==="W" ? "聯盟冠軍賽" : "前一輪"}結束後確定`);
  const nr = games.filter(g=>g.status.abstractGameState==="Preview" && real(g))[0];
  PEXTRA = {post: next.some(g => POST.includes(g.gameType)), tbd, nextAt: nr ? nr.gameDate : null};         // 接下來 4 場
  const show = next.length ? next : done;
  if(location.protocol !== "file:"){ try{ const r = await fetch("data/predictions.json?t="+Date.now()); if(r.ok) for(const x of (await r.json()).records){ if(x.status === "cancelled") continue; if(x.official) OFFICIAL[x.gamePk] = x.official; if(x.snapshots) SNAPS[x.gamePk] = x.snapshots; } }catch(e){} }
  // 先抓先發投手成績與 FIP 常數，再畫預測卡
  await Promise.all([loadFIPC(), loadTeamHit(), ...show.map(g=>loadH2H(g.teams.away.team.id, g.teams.home.team.id)), loadPitchers(show.flatMap(g=>[g.teams.home.probablePitcher, g.teams.away.probablePitcher]).filter(Boolean).map(p=>p.id))]);
  renderPredict(show, !next.length);
  daySummary(show);
  await renderAnalysis(done);
}

// 先發總覽：依目前列出的預測卡；卡片跨多天時只算最早那天（台灣日期）；沒有卡片才隱藏
function daySummary(games){
  const day = d => new Date(new Date(d).getTime() + 8*3600e3).toISOString().slice(0,10);
  games = games.filter(x => TEAM[x.teams.home.team.id] && TEAM[x.teams.away.team.id] && !x.rescheduledFrom);   // 與卡片同一份；延賽場次不列入今日摘要（§21）
  let el = document.getElementById("mlb-day");
  if(!el){ el = document.createElement("p"); el.id = "mlb-day"; el.className = "day-sum"; (document.getElementById("mlb-acc")||document.querySelector("#sec-predict h2")).after(el); }
  if(!games.length){ el.hidden = true; return; }
  const d0 = games.map(x => day(x.gameDate)).sort()[0], g = games.filter(x => day(x.gameDate) === d0);
  const md = `${+d0.slice(5,7)}/${+d0.slice(8,10)}`;
  const a = g.filter(x => x.teams.home.probablePitcher && x.teams.away.probablePitcher).length;
  el.hidden = false; el.innerHTML = a === g.length ? wf("dayAll", {d:md, n:g.length}, ["n"]) : [wf("dayHead", {d:md, n:g.length}, ["n"]), a ? wf("dayA", {a}, ["a"]) : "", wf("dayB", {b:g.length-a}, ["b"])].filter(Boolean).join("・");
}
const noSp = o => o && (o.starterStatus ? o.starterStatus !== "both" : o.hasStarters === false || ("homeStarter" in o && (!o.homeStarter || !o.awayStarter)));
// 畫出預測卡片
// 信心分級（看好方的機率）
function tier(p){
  if(p >= 0.60) return ["strong","明顯看好"];
  if(p >= 0.53) return ["lean","略占上風"];
  return ["toss","接近五五波"];
}
// 系列賽狀態（只用 API 的 seriesStatus）
const NEXT = {"AL Wild Card Series":"美聯分區系列賽","NL Wild Card Series":"國聯分區系列賽","AL Division Series":"美聯冠軍賽","NL Division Series":"國聯冠軍賽","AL Championship Series":"世界大賽","NL Championship Series":"世界大賽"};
const tById = id => ({id, name:""});
function seriesPost(ss){      // 賽後：比賽結束後的系列戰狀態
  if(!ss || !ss.totalGames || ss.totalGames<2) return "";
  const W = ss.wins, L = ss.losses, lead = ss.winningTeam && ts(tById(ss.winningTeam.id));
  if(ss.isOver && lead) return ss.description==="World Series" ? `${lead}以 ${W}:${L} 拿下世界大賽` : `${lead}以 ${W}:${L} 晉級${NEXT[ss.description]||"下一輪"}`;
  if(ss.isTied || W===L) return W ? `系列賽 ${W}:${L} 戰成平手` : "";
  return lead ? `${lead}系列賽 ${W}:${L} 領先` : "";
}
// 系列賽標籤（卡片第一行）：「ALCS 第 4 戰」，第 6、7 戰加「（如有需要）」
const SER_AB = {"World Series":"WS","AL Championship Series":"ALCS","NL Championship Series":"NLCS","AL Division Series":"ALDS","NL Division Series":"NLDS","AL Wild Card Series":"AL 外卡","NL Wild Card Series":"NL 外卡"};
function serTag(g){
  const ss = g.seriesStatus, n = g.seriesGameNumber;
  if(!ss || !n || !["F","D","L","W"].includes(g.gameType)) return "";
  const ab = SER_AB[ss.description] || sz(ss.description);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Taipei",hour12:false,month:"numeric",day:"numeric",weekday:"short",hour:"2-digit",minute:"2-digit"}).formatToParts(new Date(g.gameDate)).map(x=>[x.type,x.value]));
  const wd = {Sun:"日",Mon:"一",Tue:"二",Wed:"三",Thu:"四",Fri:"五",Sat:"六"}[p.weekday];
  const ifn = (n >= 6 && (g.gamesInSeries||ss.totalGames) >= 7) ? "（如有需要）" : "";
  return `<div class="ser-row"><span class="ser-tag">${ab} 第 <span class="num">${n}</span> 戰${ifn}</span></div>`;
}
// 第三行縮短：「系列賽 2:1 守護者領先」／「系列賽 2:2 平手」
function serShort(ss){
  if(!ss || !ss.totalGames || ss.totalGames<2 || (!ss.wins && !ss.losses)) return "";
  if(ss.isTied || ss.wins===ss.losses) return `系列賽 ${ss.wins}:${ss.losses} 平手`;
  return `系列賽 ${ss.wins}:${ss.losses} ${ts(tById(ss.winningTeam.id))}領先`;
}
function seriesPre(ss){       // 賽前：目前系列戰比數
  if(!ss || !ss.totalGames || ss.totalGames<2 || (!ss.wins && !ss.losses)) return "";
  if(ss.isTied || ss.wins===ss.losses) return `系列賽目前 ${ss.wins}:${ss.losses}`;
  return `系列賽目前 ${ss.wins}:${ss.losses}（${ts(tById(ss.winningTeam.id))}領先）`;
}

// 修正過程圖（從看好方的角度）：起點 50% → 戰績 → 主場 → 先發 → 最終
function favSteps(m, favHome){
  const k = favHome ? 1 : -1;
  return {d1:k*m.d1, d2:k*m.d2, d3:k*m.d3, F: favHome ? m.F : Math.round((100-m.F)*10)/10};
}
const dCls = v => Math.abs(v) < 0.05 ? "zero" : v > 0 ? "up" : "down";
const dTxt = v => Math.abs(v) < 0.05 ? "±0.0%" : (v>0?"▲+":"▼−") + Math.abs(v).toFixed(1) + "%";
function bridge(m, s, fav){
  const X = v => Math.max(0, Math.min(100, (v-35)/30*100));   // 顯示範圍 35%～65%
  const seg = (from, to, cls) => `<span class="br-seg ${cls}" style="left:${X(Math.min(from,to))}%;width:${Math.max(X(Math.max(from,to))-X(Math.min(from,to)),0.8)}%"></span>`;
  const row = (label, from, to, cls, val, extra="") => `<div class="br-row ${extra}"><span class="br-l">${label}</span><span class="br-track">${seg(from,to,cls)}</span><span class="br-v">${val}</span></div>`;
  const p1 = 50+s.d1, p2 = p1+s.d2;
  return `<div class="bridge"><div class="br-cap">${ts(fav)}（看好方）勝率的計算過程</div>
    ${row("起點", 35, 50, "start", "50.0%", "muted")}
    ${row("戰績", 50, p1, dCls(s.d1), dTxt(s.d1))}
    ${row("主場", p1, p2, dCls(s.d2), dTxt(s.d2))}
    ${m.used ? row("先發投手", p2, s.F, dCls(s.d3), dTxt(s.d3)) : `<div class="br-row na"><span class="br-l">先發投手</span><span class="br-track"></span><span class="br-v">資料不足，未調整</span></div>`}
    ${row("最終勝率", 35, s.F, "final", s.F.toFixed(1)+"%")}</div>`;
}

// 「為什麼這樣預測」：結論句＋三條（戰績、主場、先發），數字與修正過程圖相同
let SS_NOW = null, GTYPE_NOW = null;
const OFFICIAL = {}, SNAPS = {};   // SNAPS：gamePk → 排程快照（含當時先發）
let GPK_NOW = null, SPCHG = null;   // gamePk → 正式預測紀錄（判斷是否為舊版模型）
// 數字小標籤：較佳一方加粗（客隊數字在前）
function chip(label, av, hv, better){   // better: "a" / "h" / ""
  if(av==null || hv==null || av==="-" || hv==="-") return "";
  return `<span class="chip">${label} ${better==="a"?`<b>${av}</b>`:av} 對 ${better==="h"?`<b>${hv}</b>`:hv}</span>`;
}
const bt = (a,h,low) => a==null||h==null||isNaN(a)||isNaN(h)||a===h ? "" : ((low ? a<h : a>h) ? "a":"h");
const sgn = v => (v>0?"+":"") + v;
const homeRec = t => { const r = t && t.records && (t.records.splitRecords||[]).find(x=>x.type==="home"); return r ? r : null; };
const sd = arr => { const v = arr.filter(x=>!isNaN(x)); if(v.length<2) return null; const m = v.reduce((a,b)=>a+b,0)/v.length; return Math.sqrt(v.reduce((a,b)=>a+(b-m)**2,0)/v.length); };
// 對戰看點：回傳 [{txt, z}]，z＝差距÷聯盟標準差（用來挑焦點；交手、主場戰績不參與挑選）
function matchup(A, H){
  const sa = TSTAT[A.id]||{}, sh = TSTAT[H.id]||{}, all = Object.values(TSTAT), out = [];
  if(sa.rpg && sh.rpg && sa.rpg!==sh.rpg){ const X = +sa.rpg > +sh.rpg ? [A,sa,sh] : [H,sh,sa], s0 = sd(all.map(t=>+t.rpg));
    out.push({z: s0 ? Math.abs(sa.rpg-sh.rpg)/s0 : 0, short:`${ts(X[0])}打線較強`, txt:`${ts(X[0])}打線每場平均多得 ${(X[1].rpg-X[2].rpg).toFixed(2)} 分（<b>${X[1].rpg}</b> 對 ${X[2].rpg}）`}); }
  if(sa.era && sh.era && sa.era!==sh.era){ const [X,Y,a,b] = +sa.era < +sh.era ? [A,H,sa.era,sh.era] : [H,A,sh.era,sa.era], s0 = sd(all.map(t=>+t.era));
    out.push({z: s0 ? Math.abs(sa.era-sh.era)/s0 : 0, short:`${ts(X)}投手群較穩`, txt:`${ts(X)}投手群防禦率 <b>${a}</b>，優於${ts(Y)}的 ${b}`}); }
  out.sort((x,y)=>y.z-x.z);
  if(out.length && out[0].z < 0.5) out.unshift({z:-2, close:true, txt:"兩隊打線和投手群相當接近"});
  const hr = homeRec(TEAM[H.id]); if(hr) out.push({z:-1, txt:`${ts(H)}本季主場 ${hr.wins}勝${hr.losses}敗`});
  const h2 = H2H[A.id+"-"+H.id];
  if(h2){ const n = h2.hw+h2.aw, [X,w,l] = h2.aw > h2.hw ? [A,h2.aw,h2.hw] : [H,h2.hw,h2.aw];
    out.push({z:-1, txt:`本季交手${ts(X)} ${w}勝${l}敗（共 ${n} 場）${n<4?"（場數少，僅供參考）":""}`}); }
  return out;
}
function whyBlock(A, H, m, s, ap, hp, aP, hP, fav, fp){
  const favHome = fav.id === H.id, ta = TEAM[A.id], th = TEAM[H.id];
  // ① 戰績
  const pa = +ta.winningPercentage, ph = +th.winningPercentage, [X, Y, xt, yt] = ph >= pa ? [H, A, th, ta] : [A, H, ta, th];
  const t1 = Math.abs(pa - ph) < 0.02 ? wf("recClose", {p:wpct(+xt.winningPercentage), op:wpct(+yt.winningPercentage)}, ["p","op"])
    : wf("rec", {t:ts(X), w:xt.wins, l:xt.losses, p:wpct(+xt.winningPercentage), o:ts(Y), op:wpct(+yt.winningPercentage)}, ["w","l","p","op"]);
  // ② 主場
  const t2 = wf("home", {t:ts(H)});
  // ③ 先發
  let t3;
  if(!m.used && (aP ? 1 : 0) + (hP ? 1 : 0) === 1) t3 = wf("spOne", {t:ts(aP ? H : A)});
  else if(!m.used) t3 = WHY_TXT.spWait;
  else if(Math.abs(m.d3) < 0.05) t3 = wf("spClose", {a:pn(aP), h:pn(hP)});
  else {
    const eraH = +hp.era < +ap.era, eraA = +ap.era < +hp.era, whH = +hp.whip < +ap.whip, whA = +ap.whip < +hp.whip;
    if((eraH && whA) || (eraA && whH)) t3 = wf("spMixed", {a:pn(aP), h:pn(hP)});
    else { const hA = m.d3 > 0, [P, S, O, OS] = hA ? [hP, hp, aP, ap] : [aP, ap, hP, hp];
      t3 = wf("sp", {p:pn(P), era:S.era, whip:S.whip, o:pn(O), oera:OS.era, owhip:OS.whip}, ["era","whip","oera","owhip"]); }
  }
  if(m.used && SPCHG){ const isC = SPCHG.p0c != null, p0 = isC ? SPCHG.p0c : SPCHG.p0a;
    if(p0 != null && Math.abs(p0*100 - m.F) >= 1){ const hp0 = p0*100, H0 = hp0 >= 50; t3 += wf(isC ? "pBefore" : "pAnnBefore", {t:ts(H0?H:A), p:Math.round(H0?hp0:100-hp0)}, ["p"]); } }
  const html = whyBlock2([[s.d1, t1, "rec"], [s.d2, t2, "home"], [m.used ? s.d3 : 0, t3, "sp"]], ts(fav), fp, s.F);
  // 參考數據（事實，不計入勝率）
  const spl = (t, type) => t && t.records && (t.records.splitRecords||[]).find(x=>x.type===type);
  const la = spl(ta,"lastTen"), lh = spl(th,"lastTen"), ha = spl(ta,"away"), hh = spl(th,"home");
  const pg = t => { const g = t.wins + t.losses; return g ? wsg((t.runsScored - t.runsAllowed)/g) : null; };
  const ref = refBlock([
    la && lh ? wf(GTYPE_NOW && GTYPE_NOW !== "R" ? "last10Post" : "last10", {a:ts(A), aw:la.wins, al:la.losses, h:ts(H), hw:lh.wins, hl:lh.losses}, ["aw","al","hw","hl"]) : "",
    ha && hh ? wf("homeAway", {h:ts(H), hw:hh.wins, hl:hh.losses, a:ts(A), aw:ha.wins, al:ha.losses}, ["hw","hl","aw","al"]) : "",
    pg(ta) && pg(th) ? wf("diff", {a:ts(A), ad:pg(ta), h:ts(H), hd:pg(th)}, ["ad","hd"]) : "",
  ], "mlb");
  return html + ref;
}
// 先發異動／公布：和排程較早的快照比。同一邊換人＝異動（金字）；原本沒人、現在有人＝公布（白字）；異動優先
function spChange(pk, aP, hP){
  const sn = SNAPS[pk]; if(!sn || !sn.length) return null;
  const out = {chg:{}, ann:{}};
  for(const [side, cur] of [["away", aP], ["home", hP]]){
    if(!cur) continue;
    for(let i = sn.length-1; i >= 0; i--){ const k = side+"Starter"; if(!(k in sn[i])) continue; const o = sn[i][k];
      if(o && o.id !== cur.id){ out.chg[side] = pn({id:o.id, fullName:o.name}); out.p0c ??= sn[i].homeWinProb; break; } }
  }
  // 公布：只在「轉為兩隊都公布」時顯示；找最近一筆不是兩隊都有先發的快照
  if(aP && hP){ const j = sn.map(x => "homeStarter" in x && (!x.homeStarter || !x.awayStarter)).lastIndexOf(true);
    if(j >= 0){ for(const side of ["away","home"]) if(!sn[j][side+"Starter"] && !out.chg[side]) out.ann[side] = true; if(out.ann.away || out.ann.home) out.p0a = sn[j].homeWinProb; } }
  const any = o => o.away || o.home;
  return any(out.chg) || any(out.ann) ? out : null;
}
// 先發投手對比列（勝率條下方；左客右主，不分好壞色）
function pitchRow(aP, hP, ap, hp, chg){
  const ipTxt = v => { const w = Math.floor(v + 1e-9), o = Math.round((v - w)*3); return `${w}.${o}`; };
  const col = (P, S, side) => {
    if(!P) return `<div class="pc-col"><div class="pc-tbd">${WHY_TXT.pTbd}</div></div>`;
    const line = S && S.era && S.era !== "-" ? wf("pLine", {era:S.era, whip:S.whip, ip:ipTxt(S.ip)}, ["era","whip","ip"]).split("・").map(x=>`<span class="nw">${x}</span>`).join("・") + (S.ip < 40 ? `<span class="pc-small">${WHY_TXT.pSmall}</span>` : "") : "";
    const ch = chg && chg.chg[side] ? `<div class="pc-chg">${wf("pChange", {p:chg.chg[side]})}</div>` : chg && chg.ann[side] ? `<div class="pc-ann">${WHY_TXT.pAnn}</div>` : "";
    return `<div class="pc-col"><div class="pc-n">${pn(P)}</div>${line ? `<div class="pc-s">${line}</div>` : ""}${ch}</div>`;
  };
  return `<div class="pitch"><div class="pc-lab">${WHY_TXT.pLabel}</div><div class="pc-row">${col(aP, ap, "away")}<div class="pc-div"></div>${col(hP, hp, "home")}</div></div>`;
}
// 爆冷提醒（標籤旁小字；只用劣勢方勝率與先發 ERA／WHIP）
function upset(A, H, ap, hp, aP, hP, fav, fp){
  if(fp === 50) return "";
  const favHome = fav.id === H.id, U = favHome ? A : H, uS = favHome ? ap : hp, fS = favHome ? hp : ap, uP = favHome ? aP : hP;
  if(uS && fS && +uS.whip < +fS.whip) return `${ts(U)}先發${pn(uP)}被上壘率較低，是翻盤的本錢`;
  if(uS && fS && +uS.era < +fS.era) return `${ts(U)}先發${pn(uP)}防禦率較低，是翻盤的本錢`;
  return `${ts(U)}仍有 ${100-fp}% 勝率，爆冷並不少見`;
}

// 兩隊對比表：較佳一方加粗並標 ◀ ▶
function compare(A, H, ap, hp){
  const ta = TEAM[A.id], th = TEAM[H.id];
  const r = (name, desc, av, hv, better) => {   // better: "a" / "h" / ""
    const L = better==="a" ? `<b>◀ ${av}</b>` : av, R = better==="h" ? `<b>${hv} ▶</b>` : hv;
    return `<tr><td>${L}</td><td class="mid">${name}<div class="desc">${desc}</div></td><td>${R}</td></tr>`;
  };
  const cmpv = (a,h,low) => a==null||h==null||a===h ? "" : ((low ? a<h : a>h) ? "a":"h");
  let s = `<table class="cmpt"><thead><tr><th>客 ${ts(A)}</th><th class="mid">指標</th><th>主 ${ts(H)}</th></tr></thead><tbody>`;
  s += r("戰績", "本季例行賽勝敗場數", `${ta.wins}勝${ta.losses}敗`, `${th.wins}勝${th.losses}敗`, cmpv(+ta.winningPercentage, +th.winningPercentage));
  s += r("得分", "整季總得分，越多越好", ta.runsScored, th.runsScored, cmpv(ta.runsScored, th.runsScored));
  s += r("失分", "整季總失分，越少越好", ta.runsAllowed, th.runsAllowed, cmpv(ta.runsAllowed, th.runsAllowed, true));
  if(ap && hp){
    const fa = fip(ap), fh = fip(hp);
    s += r("先發 ERA", "每 9 局被打回的自責分，越低越好", ap.era, hp.era, cmpv(+ap.era, +hp.era, true));
    s += r("先發 WHIP", "平均每局讓幾人上壘（安打＋保送），越低越好", ap.whip, hp.whip, cmpv(+ap.whip, +hp.whip, true));
    s += r("先發 FIP", "只看三振、保送、全壘打的失分能力，越低越好", fa==null?"-":fa.toFixed(2), fh==null?"-":fh.toFixed(2), cmpv(fa, fh, true));
    s += r("先發場數", "本季先發次數，場數少時數據會往聯盟平均修正", ap.gs, hp.gs, "");
  }
  return s + `</tbody></table>`;
}



// 台灣時間「10/23（五）」／加時間「10/18（日）08:00」
function twWD(d, withTime){
  const t = new Date(new Date(d).getTime() + 8*3600e3), wd = "日一二三四五六"[t.getUTCDay()];
  return `${t.getUTCMonth()+1}/${t.getUTCDate()}（${wd}）` + (withTime ? String(t.getUTCHours()).padStart(2,"0") + ":" + String(t.getUTCMinutes()).padStart(2,"0") : "");
}
function emptyCard(nextAt){ return `<div class="empty-card">${nextAt ? `今天沒有比賽，下一戰 ${twWD(nextAt, true)}` : "今天沒有比賽，下一戰時間待公布"}</div>`; }
let PEXTRA = {post:false, tbd:[], nextAt:null};
// 畫出預測卡片
function renderPredict(games, isPast){
  let html = isPast ? "<p>目前沒有即將開打的比賽，改顯示最近比賽的賽前估算：</p>" : "";
  const DG = {last:null, cnt:dayCounts(games.filter(g => TEAM[g.teams.home.team.id] && TEAM[g.teams.away.team.id]).map(g => g.gameDate))};
  // 今日數據焦點：列表第一天、兩隊先發都公布的場次
  games = games.filter(g => !(g.status && g.status.detailedState === "Postponed")).sort((a,b) => new Date(a.gameDate) - new Date(b.gameDate));   // 依開賽時間排序；延賽的原日期場次不顯示（§21）
  const isPP = g => !!g.rescheduledFrom;   // 延賽改期後的場次
  const vg = games.filter(g => TEAM[g.teams.home.team.id] && TEAM[g.teams.away.team.id]);
  const day0 = vg.length ? twKey(vg[0].gameDate) : null;
  const FC = pickFocus(vg.map((g,i) => ({g,i})).filter(({g}) => !isPast && !isPP(g) && twKey(g.gameDate) === day0 && g.teams.home.probablePitcher && g.teams.away.probablePitcher).map(({g,i}) => {
    const hp = PSTAT[g.teams.home.probablePitcher.id], ap = PSTAT[g.teams.away.probablePitcher.id], m = modelV2(g.teams.home.team.id, g.teams.away.team.id, hp, ap);
    const ss = g.seriesStatus, need = ss && ss.totalGames ? Math.ceil(ss.totalGames/2) : 0;
    const key = !!(need && (ss.wins === need-1 || ss.losses === need-1 || g.seriesGameNumber === ss.totalGames));
    let txt = "";
    if(ss && need && !ss.isOver){
      if(ss.wins === need-1 && ss.losses < need-1 && ss.winningTeam) txt = `${ts(tById(ss.winningTeam.id))}再贏一場晉級`;
      else txt = serShort(ss); }
    return {i, fh:m.final, key, txt};
  }));
  if(FC){ const f = vg[FC.i]; games = [f, ...games.filter(g => g !== f)]; }
  const todayK = twKey(new Date().toISOString()), live = vg.filter(g => !isPP(g));
  if(!isPast && vg.length && !live.some(g => twKey(g.gameDate) === todayK)) html += emptyCard((live[0] || vg[0]).gameDate);
  for(const g of games){
    const H = g.teams.home, A = g.teams.away;
    if(!TEAM[H.team.id] || !TEAM[A.team.id]) continue;
    html += dayHdr(g.gameDate, DG);
    const aP = A.probablePitcher, hP = H.probablePitcher;
    const ap = aP && PSTAT[aP.id], hp = hP && PSTAT[hP.id];
    const m = modelV2(H.team.id, A.team.id, hp, ap);
    const hpct = Math.round(m.F), apct = 100 - hpct;  // 長條用整數 %
    const favHome = hpct >= apct, fp = Math.max(hpct, apct), fav = favHome ? H.team : A.team;
    const [tc, tl] = tier(fp/100);
    const st = favSteps(m, favHome);
    SS_NOW = g.seriesStatus; GTYPE_NOW = g.gameType; GPK_NOW = g.gamePk;
    SPCHG = spChange(g.gamePk, aP, hP);
    const off = OFFICIAL[g.gamePk];
    const v1note = off && off.model && !off.model.startsWith(MODEL_V) ? `<div class="vnote">此場正式紀錄為舊版模型 ${off.model.slice(0,2)}</div>` : "";
    const w = g.weather && g.weather.condition ? `參考資訊：天氣 ${g.weather.condition}${g.weather.temp?`，氣溫 ${Math.round((g.weather.temp-32)*5/9)}°C`:""}（不列入勝率計算）` : "";
    const wait = !aP || !hP;
    const ss0 = g.seriesStatus, post = ["F","D","L","W"].includes(g.gameType) && ss0 && !ss0.isOver;
    const wH0 = !ss0 ? 0 : ss0.wins === ss0.losses ? ss0.wins : (ss0.winningTeam && ss0.winningTeam.id === H.team.id ? ss0.wins : ss0.losses), wA0 = ss0 ? ss0.wins + ss0.losses - wH0 : 0;
    const sb = post ? seriesBar({lg:"mlb", ab:SER_AB[ss0.description] || sz(ss0.description), n:g.gamesInSeries || ss0.totalGames, gameNo:g.seriesGameNumber, wH:wH0, wA:wA0,
      pNext:hpct/100, pH:modelV2(H.team.id, A.team.id).final, pA:1 - modelV2(A.team.id, H.team.id).final, H:ts(H.team), A:ts(A.team)}) : "";
    const ser = serTag(g).replace(/^<div class="ser-row">|<\/div>$/g,"");
    const reason = mainReason([
      {k:"戰績", t:ts(m.d1>=0?H.team:A.team), v:m.d1, sfx:"戰績較佳"},
      {k:"主場", t:ts(H.team), v:m.d2, sfx:"主場優勢"},
      m.used ? {k:"先發投手", t:ts(m.d3>=0?H.team:A.team), v:m.d3, sfx:"先發較佳"} : {v:null}], favHome, wait, fp);
    const body = `${pitchRow(aP, hP, ap, hp, SPCHG)}
      ${v1note}${whyBlock(A.team, H.team, m, st, ap, hp, aP, hP, fav, fp)}
      <div class="tier-row"><span class="tier ${tc}">${tl}</span><span class="upset">${upset(A.team, H.team, ap, hp, aP, hP, fav, fp)}</span></div>
      ${serShort(g.seriesStatus) ? `<div class="meta">${serShort(g.seriesStatus)}</div>` : ""}
      <details class="algo"><summary>看算法</summary>${bridge(m, st, fav)}
        <p class="desc">戰績：兩隊實力分數（勝率與畢氏期望勝率各半）用 Log5 比較，再依回測縮回 50% 附近；主場與先發投手依 2026 例行賽回測校正。三格差值依序計算，加總等於最終勝率。模型 ${MODEL_V}。</p>${sb ? SER_ALGO : ""}</details>
      <details class="algo"><summary>兩隊數據對比</summary>${compare(A.team, H.team, ap, hp)}</details>
      ${w ? `<div class="ref">${w}</div>` : ""}
      <div class="upd">最後更新：${tw(Date.now())}（台灣時間）</div>`;
    html += sb + ccCard({lg:"mlb", pp: isPP(g) ? `延賽至 ${twWD(g.gameDate, true)}（勝率將重算）` : "", focus: FC && g === vg[FC.i] && !isPP(g) ? FC.txt : "", ser, time:cardTime(g.gameDate, DG), tag: wait ? "等先發" : "先發已公布", A:ts(A.team), H:ts(H.team), conf:CONF[tc], tc, ap:apct, hp:hpct, favHome, reason, body});
  }
  const X = PEXTRA;
  if(!html.includes('class="pcard')) html = emptyCard(X.nextAt);
  else if(X.post && !isPast) html += '<p class="po-note">下一戰在本戰結束後顯示</p>';
  html += X.tbd.map(t => `<p class="tbd-note">${t}</p>`).join("");
  document.getElementById("predict").innerHTML = html;
}

// 投手成績轉成中文一句話
function pLine(p){ const s = p.stats.pitching; return `${pn(p.person)} 投 ${s.inningsPitched} 局、被敲 ${s.hits} 安、失 ${s.earnedRuns} 分自責、${s.strikeOuts} 次三振、${s.baseOnBalls} 次保送`; }

// 為每場已完賽比賽產生分析文章（全部取自官方 boxscore 數據）
async function renderAnalysis(games){
  let html = "";
  const DG = {last:null};
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
    // ===== 三行重點（依內容規範：①打擊 ②先發 ③牛棚/終結；沒資料就跳過）=====
    const sW = g.teams[W].score, sL = g.teams[Lo].score, score = `${sW} 比 ${sL}`;
    const wb = t.batters.map(id=>t.players["ID"+id]).filter(p=>p.stats.batting && p.stats.batting.atBats>0);
    const byRbi = (x,y)=>y.stats.batting.rbi-x.stats.batting.rbi;
    const hr2 = wb.filter(p=>p.stats.batting.homeRuns>=2).sort(byRbi)[0];
    const hr1 = wb.filter(p=>p.stats.batting.homeRuns===1).sort(byRbi)[0];
    const rbiMan = wb.slice().sort(byRbi)[0];
    const HL = [];
    // ① 勝負關鍵打擊
    if(hr2) HL.push(`${pn(hr2.person)}雙響砲，貢獻 ${hr2.stats.batting.rbi} 分打點`);
    else if(hr1) HL.push(`${pn(hr1.person)}開轟，全場 ${hr1.stats.batting.rbi} 分打點`);
    else if(rbiMan && rbiMan.stats.batting.rbi>=2) HL.push(`${pn(rbiMan.person)}${rbiMan.stats.batting.hits} 安 ${rbiMan.stats.batting.rbi} 打點，打線核心`);
    else if(sW-sL===1) HL.push(`${ts(g.teams[W].team)}以 ${score} 一分險勝`);
    else if(sW-sL>=5) HL.push(`${ts(g.teams[W].team)}打線爆發，${score} 大勝`);
    // ② 先發投手
    const wsP = sp(W), ws = wsP.stats.pitching, dec = g.decisions || {};
    const lp = dec.loser && box.teams[Lo].players["ID"+dec.loser.id];
    if(dec.winner && dec.winner.id===wsP.person.id && ipNum(ws.inningsPitched)>=6 && ws.earnedRuns<=3) HL.push(`${pn(wsP.person)}投 ${ws.inningsPitched} 局失 ${ws.earnedRuns} 分，優質先發拿下勝投`);
    else if(ws.strikeOuts>=8) HL.push(`${pn(wsP.person)}飆 ${ws.strikeOuts} 次三振`);
    else if(lp && lp.stats.pitching.earnedRuns>=5) HL.push(`${pn(lp.person)}${lp.stats.pitching.inningsPitched} 局失 ${lp.stats.pitching.earnedRuns} 分，吞下敗投`);
    // ③ 牛棚／終結
    const bpRuns = t.pitchers.slice(1).reduce((s,id)=>s+(t.players["ID"+id].stats.pitching.runs||0),0), bpN = t.pitchers.length-1;
    if(dec.save) HL.push(`${pn(dec.save)}關門，拿下救援成功`);
    else if(bpN>0 && bpRuns===0) HL.push(`牛棚 ${bpN} 位投手零失分`);
    // 驚嘆號一篇最多一個：只加在第一條
    if(HL.length) HL[0] += "！";
    const spost = seriesPost(g.seriesStatus);
    html += dayHdr(g.gameDate, DG) + `<article><h3><span class="ah-d">${tw(g.gameDate)}${noSp(OFFICIAL[g.gamePk]) ? `・${WHY_TXT.noSp}` : ""}</span><span class="ah-s">${tn(A.team)} ${A.score} : ${H.score} ${tn(H.team)}</span></h3>
      <div class="hl"><div class="hl-title">三行重點</div>${spost?`<div class="hl-s">${spost}</div>`:""}<ol>${HL.map(x=>`<li>${x}</li>`).join("")}</ol></div>
      <details class="full"><summary>看完整分析</summary>
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

// "2026-10-18 08:00 (UTC+8)" → "10/18 上午08:00"（與全站時間格式一致）
const fmtD = s => { const m = String(s).match(/(\d+)-(\d+)-(\d+) (\d+:\d+)/); return m ? `${+m[2]}/${+m[3]} ${m[4]}` : s; };
const fmtDH = s => { const m = String(s).match(/(\d+)-(\d+)-(\d+) (\d+:\d+)/); return m ? `<span class="dd">${+m[2]}/${+m[3]}</span> <span class="tt">${m[4]}</span>` : s; };
const TENT = '<div class="tent"><span class="tl">未開賽・預測會更新</span><span class="ts">未開賽・會更新</span></div>';
const resMark = c => c === null || c === undefined ? '<span class="rm wait">待賽</span>' : c ? '<span class="rm ok" aria-label="猜對">✓</span>' : '<span class="rm bad" aria-label="猜錯">✗</span>';
const fmtT = s => { const m = String(s).match(/(\d+)-(\d+)-(\d+) (\d+):(\d+)/); if(!m) return s; const h=+m[4]; return `${+m[2]}/${+m[3]} ${h<12?"上午":"下午"}${String(h%12||12).padStart(2,"0")}:${m[5]}`; };
const FULL2SHORT = Object.fromEntries(Object.values(ZH));
const short = n => FULL2SHORT[n] || n;
// 首頁準度一行（規格 #2）：只算開賽前鎖定的正式紀錄、依版本分開、排除取消、勝率剛好 50% 不計
function accLine(id, recs, isVer, label, href){
  const el = document.getElementById(id); if(!el) return;
  const done = recs.filter(x => x.status !== "cancelled" && x.official && isVer(x) && x.correct !== null && x.correct !== undefined && x.official.homeWinProb !== 0.5);
  const n = done.length, k = done.filter(x => x.correct).length;
  const t = n >= 50 ? `${label} 命中率 <span class="num">${Math.round(k/n*100)}%</span>（<span class="num">${k}/${n}</span> 場）` : n===0 ? `${label} 尚無結算場次` : `${label} 累積中（<span class="num">${n}</span> 場）`;
  el.innerHTML = `${t}・<a href="${href}">看命中率 ›</a>`; el.hidden = false;
}
// 預測命中率：讀取網站上的 data/predictions.json
async function secHit(){
  const el = document.getElementById("hit");
  if(location.protocol === "file:"){ el.innerHTML = '<p class="note">直接開啟本機檔案時無法讀取預測紀錄，請到線上網站查看：<a href="https://8b2b5t58zf-png.github.io/mlb-site/#mlb-hitrate">點這裡</a></p>'; return; }
  const r = await fetch("data/predictions.json?t=" + Date.now());
  if(!r.ok) throw new Error("predictions");
  const d = await r.json();
  accLine("mlb-acc", d.records, x => (x.official.model||"").startsWith(MODEL_V), "MLB v2", "#mlb-hitrate");
  d.records = d.records.filter(x => x.status !== "cancelled");   // 取消的比賽（賽程已無此場、從未開打）不列入
  // 只計算「正式預測」（開打前最後一筆快照；舊 v1 紀錄即為正式預測）
  const off = d.records.filter(x => x.official);
  const ver = x => (x.official.model||"").slice(0,2);
  const done = off.filter(x => x.correct !== null), n = done.length, ok = done.filter(x => x.correct).length;
  const GOAL = 50;
  const vers = [...new Set([...off.map(ver), MODEL_V])].sort();
  const vline = v => { const dv = done.filter(x=>ver(x)===v), k = dv.length;
    return k >= GOAL ? `${v}：命中率 ${Math.round(dv.filter(x=>x.correct).length/k*100)}%（共 ${k} 場）` : `${v}：累積中（目前 ${k} 場，滿 ${GOAL} 場後顯示）`; };
  // 正式命中率以目前模型（v2）為準；舊版只留一行小字
  const dv = done.filter(x=>ver(x)===MODEL_V), nv = dv.length, okv = dv.filter(x=>x.correct).length;
  let html = nv >= GOAL
    ? `<div class="hr-big">${Math.round(okv/nv*100)}%</div><div class="hr-sub">${MODEL_V} 命中率（共 ${nv} 場）</div>`
    : `<div class="hr-big muted">累積中</div><div class="hr-prog"><div class="hr-bar"><div style="width:${nv/GOAL*100}%"></div></div><span>${MODEL_V}：${nv} / ${GOAL} 場</span></div>`;
  html += `<div class="hr-ref">2026 例行賽回測約 57.8%<br>季後賽場數少，正式命中率預計於 2027 例行賽累積後顯示</div>`;
  const old = vers.filter(v=>v!==MODEL_V).map(v=>`舊版 ${v}：${off.filter(x=>ver(x)===v).length} 場，不列入正式命中率`);
  if(old.length) html += `<div class="hr-vers">${old.join("<br>")}</div>`;
  html += confGroups(d.records, x => (x.official.model||"").startsWith(MODEL_V), [53, 60], "mlb");
  html += btCard("mlb", "mlb_v2", "MLB 2026 例行賽 7/1 起・MLB v2", [53, 60]);
  html += `<p class="hr-upd">最後更新：${fmtT(d.updated)}（台灣時間）</p>`;
  html += '<div class="tblwrap" style="overflow-x:auto"><table class="hrt"><tr><th>比賽時間</th><th class="mu-h"><span class="mu-full">對戰（客 @ 主）</span><span class="mu-short">客 @ 主</span></th><th class="md">模型</th><th>預測</th><th class="dk">預測勝率</th><th class="dk">實際比分</th><th class="dk">結果</th></tr>';
  for(const x of d.records.slice().reverse().slice(0,15)){
    const snap = x.official || x.snapshots[x.snapshots.length-1], hp = snap.homeWinProb;
    const pw = hp >= 0.5 ? x.home : x.away, p = Math.max(hp, 1-hp);
    const tag = x.official ? "" : TENT;
    const v = (snap.model||"").slice(0,2);
    html += `<tr><td class="nw dt">${fmtDH(x.gameTime)}</td><td class="nw mu">${short(x.away)} @ ${short(x.home)}</td><td class="md"><span class="vp ${v}">${v}</span></td><td class="nw">${short(pw)}${x.correct==null?"":" "+resMark(x.correct)}${tag}${noSp(x.official) ? `<div class="nosp">${WHY_TXT.noSp}</div>` : ""}</td><td class="dk">${Math.round(p*100)}%</td><td class="dk">${x.final || "尚未開打／進行中"}</td><td class="dk">${x.correct === null ? "待賽" : x.correct ? "猜對" : "猜錯"}</td></tr>`;
  }
  el.innerHTML = html + "</table></div>";
}

// 每個區塊各自的載入步驟（取名字是為了讓「重試」按鈕能再呼叫一次）
async function secStandings(){ await loadStandings(); }
async function secGames(){ if(!Object.keys(TEAM).length) await loadStandings(); await loadGames(); }
async function secBatting(){ await loadLeaders({homeRuns:"全壘打",battingAverage:"打擊率",runsBattedIn:"打點"},"hitting","batting"); }
async function secPitching(){ await loadLeaders({earnedRunAverage:"防禦率",strikeouts:"三振",wins:"勝投"},"pitching","pitching"); }

// ===== 導覽列與聯盟切換 =====
const NAVS = {
  mlb:[["sec-predict","預測"],["sec-analysis","賽後"],["sec-hit","命中率"],["sec-standings","戰績"],["sec-batting","排行"]],
  nba:[["nsec-predict","預測"],["nsec-analysis","賽後"],["nsec-hit","命中率"],["nsec-standings","戰績"],["nsec-leaders","排行"]]};
const ICON = {"預測":'<path d="M3 17l5-5 4 4 8-8"/><path d="M14 8h6v6"/>',"賽後":'<path d="M5 4h10l4 4v12H5z"/><path d="M8 12h8M8 16h6"/>',"命中率":'<circle cx="12" cy="12" r="8"/><path d="M8 12l3 3 5-6"/>',"戰績":'<path d="M8 4h8v5a4 4 0 01-8 0z"/><path d="M12 13v4M8 20h8"/>',"排行":'<path d="M5 20V12M12 20V5M19 20v-8"/>'};
let LG_NOW = "mlb", TAB_NOW = "predict", NAV_READY = false;
const TABS = ["predict","recap","hitrate","standings","leaders"];
function renderNav(){
  const L = NAVS[LG_NOW];
  const href = i => `#${LG_NOW}-${TABS[i]}`;
  document.getElementById("topnav").innerHTML = L.map(([id,t],i)=>`<a href="${href(i)}" data-tab="${TABS[i]}">${t}</a>`).join("");
  document.getElementById("bottomnav").innerHTML = L.map(([id,t],i)=>`<a href="${href(i)}" data-tab="${TABS[i]}"><span class="ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[t]}</svg></span><span>${t}</span></a>`).join("");
  markNav();
}
function markNav(){
  document.querySelectorAll("#topnav a, #bottomnav a").forEach(a => a.dataset.tab===TAB_NOW ? a.setAttribute("aria-current","page") : a.removeAttribute("aria-current"));
}
function showTab(){
  const i = TABS.indexOf(TAB_NOW);
  for(const lg of ["mlb","nba"]) NAVS[lg].forEach(([id],k)=>{ const el=document.getElementById(id); if(!el) return; const on = lg===LG_NOW && k===i; el.classList.toggle("tab-off", !on); el.classList.toggle("tab-on", on); });
  document.body.classList.toggle("tab-predict", TAB_NOW===TABS[0]);
  document.body.classList.toggle("view-about", TAB_NOW==="about");
  document.getElementById("about").hidden = TAB_NOW!=="about";
  if(TAB_NOW!=="about") try{ localStorage.setItem("aisl:tab", TAB_NOW); }catch(e){}
  markNav();
  // 圖表在隱藏時畫出來會是 0 大小，顯示後重新量尺寸
  if(TAB_NOW==="standings" && LG_NOW==="mlb") requestAnimationFrame(()=>{ try{ const c = window.Chart && Chart.getChart("winChart"); if(c){ c.resize(); c.update("none"); } }catch(e){} });
}
function setLeague(lg){
  LG_NOW = lg; try{ localStorage.setItem("aisl:league", lg); }catch(e){}
  document.body.classList.toggle("lg-nba", lg==="nba");
  document.querySelectorAll(".lgsw button").forEach(b => b.setAttribute("aria-selected", b.dataset.lg===lg));
  document.getElementById("lg-tag").textContent = "｜" + lg.toUpperCase();
  document.getElementById("tg-scope").textContent = lg==="nba" ? "用 2025-26 季比賽驗證過" : "用 2026 整季比賽驗證過";
  document.getElementById("tg-link").href = lg==="nba" ? "validation-nba.html" : "validation.html";
  document.getElementById("lg-sub").textContent = lg==="nba" ? "AI 運動實驗室・NBA 美國職籃勝負預測與賽後分析" : "AI 運動實驗室・美國職棒大聯盟勝負預測與賽後分析";
  document.getElementById("foot").innerHTML = lg==="nba" ? '<p class="foot-src">AI Sports Lab 為個人數據分析網站，非投注建議。資料來源：MLB Stats API、ESPN。</p><p><a href="#about" data-go="about" class="foot-about">關於與免責</a>・<a href="validation-nba.html">NBA 回測說明</a></p>' : '<p class="foot-src">AI Sports Lab 為個人數據分析網站，非投注建議。資料來源：MLB Stats API、ESPN。</p><p><a href="#about" data-go="about" class="foot-about">關於與免責</a>・<a href="validation.html">回測說明</a></p>';
  document.title = `AI Sports Lab｜${lg.toUpperCase()} 勝負預測與賽後分析`;
  renderNav();
  if(lg==="nba") loadNBA();
}
// 網址 #mlb-standings → {lg, tab}；舊的 #sec-xxx / #nsec-xxx 也認得
function parseHash(h){
  h = decodeURIComponent((h||"").replace(/^#/,""));
  if(h==="about") return {lg:LG_NOW, tab:"about"};
  let m = h.match(/^(mlb|nba)-(predict|recap|hitrate|standings|leaders)$/);
  if(m) return {lg:m[1], tab:m[2]};
  for(const lg of ["mlb","nba"]){ const k = NAVS[lg].findIndex(([id])=>id===h); if(k>=0) return {lg, tab:TABS[k]}; }
  if(h==="sec-pitching") return {lg:"mlb", tab:"leaders"};
  return null;
}
// GoatCounter：每切一區算一次（第一次載入由 count.js 自己算，不重複）
let GC_LAST = null;
function gcCount(){
  const key = location.pathname + location.hash;
  if(GC_LAST === null){ GC_LAST = key; return; }
  if(key === GC_LAST) return;
  GC_LAST = key;
  try{
    const name = (NAVS[LG_NOW][Math.max(0,TABS.indexOf(TAB_NOW))]||[])[1] || TAB_NOW;
    if(window.goatcounter && window.goatcounter.count) window.goatcounter.count({path:key, title:`${LG_NOW.toUpperCase()} ${name}`, event:false});
  }catch(e){}
}
function go(lg, tab, push){ setTimeout(() => typeof ccFit === "function" && ccFit(), 0);
  if(tab!=="about" && !TABS.includes(tab)) tab = "predict";
  TAB_NOW = tab;
  if(lg!==LG_NOW || !NAV_READY){ NAV_READY = true; setLeague(lg); } else { try{ localStorage.setItem("aisl:league", lg); }catch(e){} }
  showTab();
  const h = tab==="about" ? "#about" : `#${lg}-${tab}`;
  if(location.hash !== h){ if(push) history.pushState(null,"",location.pathname+h); else history.replaceState(null,"",location.pathname+h); }
  gcCount();
  scrollTo(0,0);
}
function setupNav(){
  try{ history.scrollRestoration = "manual"; }catch(e){}
  document.querySelectorAll(".lgsw button").forEach(b => b.onclick = () => { if(b.dataset.lg!==LG_NOW) go(b.dataset.lg, TAB_NOW, true); });
  const navClick = e => { const a = e.target.closest("a[data-tab]"); if(!a) return; e.preventDefault(); go(LG_NOW, a.dataset.tab, a.dataset.tab!==TAB_NOW); };
  document.getElementById("topnav").addEventListener("click", navClick);
  document.getElementById("bottomnav").addEventListener("click", navClick);
  // 排行榜「打擊／投手」切換
  document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => {
    document.querySelectorAll(".tabs button").forEach(x => x.setAttribute("aria-selected", x===b));
    document.getElementById("tab-bat").hidden = b.dataset.tab!=="bat";
    document.getElementById("tab-pit").hidden = b.dataset.tab!=="pit";
  });
  addEventListener("popstate", () => { const p = parseHash(location.hash) || {lg:"mlb", tab:"predict"}; go(p.lg, p.tab, false); });
  addEventListener("hashchange", () => { const p = parseHash(location.hash); if(p && (p.lg!==LG_NOW || p.tab!==TAB_NOW)) go(p.lg, p.tab, false); });
  document.addEventListener("click", e => { const a = e.target.closest("a[data-go]"); if(!a) return; e.preventDefault(); go(LG_NOW, a.dataset.go, true); });
  // 優先順序：網址 # > ?lg= > 上次記住的 > 預設 MLB 預測
  let p = parseHash(location.hash), lg = "mlb", tab = "predict";
  try{
    const q = new URLSearchParams(location.search).get("lg");
    const sl = localStorage.getItem("aisl:league"), st = localStorage.getItem("aisl:tab");
    if(p){ lg = p.lg; tab = p.tab; }
    else if(q){ lg = q; tab = st || "predict"; }
    else { lg = sl || "mlb"; tab = st || "predict"; }
  }catch(e){ if(p){ lg=p.lg; tab=p.tab; } }
  lg = lg==="nba" ? "nba" : "mlb";
  if(location.search) history.replaceState(null,"",location.pathname+location.hash);
  go(lg, tab, false);
}
setupNav();

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

// 樣式：只有純數字的表格格子用等寬字（隊名、球員名維持一般字體）
(function(){
  const NUM=/^[\s\d.,:%+\-–\/()]+$/;
  const mark=root=>root.querySelectorAll&&root.querySelectorAll("td:not(.n)").forEach(td=>{const t=td.textContent.trim(); if(t&&/\d/.test(t)&&NUM.test(t)) td.classList.add("n");});
  mark(document);
  new MutationObserver(ms=>ms.forEach(m=>m.addedNodes.forEach(n=>n.nodeType===1&&mark(n)))).observe(document.body,{childList:true,subtree:true});
})();
