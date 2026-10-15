// ===== NBA v1：資料來自 ESPN 公開 JSON（瀏覽器端抓取）=====
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const ESPN_ST = "https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?seasontype=2";
// 30 隊台灣常用隊名（ESPN 縮寫 → [全名, 簡稱]），來源 /workspace/nba/teams.md
const NZH = {ATL:["亞特蘭大老鷹","老鷹"],BOS:["波士頓塞爾提克","塞爾提克"],BKN:["布魯克林籃網","籃網"],CHA:["夏洛特黃蜂","黃蜂"],CHI:["芝加哥公牛","公牛"],
CLE:["克里夫蘭騎士","騎士"],DAL:["達拉斯獨行俠","獨行俠"],DEN:["丹佛金塊","金塊"],DET:["底特律活塞","活塞"],GS:["金州勇士","勇士"],HOU:["休士頓火箭","火箭"],
IND:["印第安納溜馬","溜馬"],LAC:["洛杉磯快艇","快艇"],LAL:["洛杉磯湖人","湖人"],MEM:["曼菲斯灰熊","灰熊"],MIA:["邁阿密熱火","熱火"],MIL:["密爾瓦基公鹿","公鹿"],
MIN:["明尼蘇達灰狼","灰狼"],NO:["紐奧良鵜鶘","鵜鶘"],NY:["紐約尼克","尼克"],OKC:["奧克拉荷馬雷霆","雷霆"],ORL:["奧蘭多魔術","魔術"],PHI:["費城七六人","七六人"],
PHX:["鳳凰城太陽","太陽"],POR:["波特蘭拓荒者","拓荒者"],SAC:["沙加緬度國王","國王"],SA:["聖安東尼奧馬刺","馬刺"],TOR:["多倫多暴龍","暴龍"],UTAH:["猶他爵士","爵士"],WSH:["華盛頓巫師","巫師"]};
const ntn = t => (NZH[t.abbreviation]||[t.displayName])[0];
const nts = t => (NZH[t.abbreviation]||[,t.shortDisplayName||t.displayName])[1];

// 模型（見 /workspace/nba/model.md）：實力＝勝率50%＋畢氏勝率(指數14)50%，依場數往 .500 拉回 g/(g+5)；Log5；主場 logit +0.221（2025-26 例行賽主場勝率 55.5%）
const NM = {exp:14, k:5, hca:0.221, minG:10};
const NT = {};   // 球隊 id → {w,l,pf,pa,g,abbr,...}
function nStrength(t){
  if(!t || !t.g) return 0.5;
  const py = t.pf**NM.exp/(t.pf**NM.exp + t.pa**NM.exp), r = 0.5*t.w/t.g + 0.5*py;
  return 0.5 + (r-0.5)*t.g/(t.g+NM.k);
}
function nModel(hId, aId){
  const h = nStrength(NT[hId]), a = nStrength(NT[aId]);
  const q1 = log5(h, a), q2 = sig(logit(q1) + NM.hca);
  const R1 = Math.round(q1*1000), F = Math.round(q2*1000);
  return {d1:(R1-500)/10, d2:(F-R1)/10, F:F/10};
}
// 美國日期 YYYYMMDD（ESPN 用美東日期）
const usDay = off => { const d = new Date(Date.now() - 5*3600e3 + off*864e5); return d.toISOString().slice(0,10).replace(/-/g,""); };
const twT = s => new Date(s).toLocaleString("zh-TW",{timeZone:"Asia/Taipei",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});
const stv = (e, n) => { const s = e.stats.find(x=>x.name===n); return s ? s : {}; };

async function nbaStandings(){
  const d = await getJSON(ESPN_ST);
  let html = '<div class="divs">';
  for(const conf of d.children){
    const rows = conf.standings.entries.map(e => {
      const t = {id:e.team.id, abbr:e.team.abbreviation, team:e.team, w:+stv(e,"wins").value||0, l:+stv(e,"losses").value||0,
        pf:+stv(e,"pointsFor").value||0, pa:+stv(e,"pointsAgainst").value||0, apf:stv(e,"avgPointsFor").displayValue, apa:stv(e,"avgPointsAgainst").displayValue,
        gb:stv(e,"gamesBehind").displayValue, pct:stv(e,"winPercent").displayValue, diff:stv(e,"differential").displayValue};
      t.g = t.w + t.l; NT[t.id] = t; return t;
    }).sort((x,y)=> (y.g? y.w/y.g:0) - (x.g? x.w/x.g:0) || x.team.displayName.localeCompare(y.team.displayName));
    html += `<div><h3>${conf.name.startsWith("East")?"東區":"西區"}</h3><table><tr><th>球隊</th><th>勝-敗</th><th>勝率</th><th>勝差</th><th>場均得分</th><th>場均失分</th><th>得失分差</th></tr>`;
    for(const t of rows) html += `<tr><td>${ntn(t.team)}</td><td>${t.w}-${t.l}</td><td>${t.pct||"-"}</td><td>${t.gb||"-"}</td><td>${t.g?t.apf:"-"}</td><td>${t.g?t.apa:"-"}</td><td>${t.g?t.diff:"-"}</td></tr>`;
    html += "</table></div>";
  }
  const none = Object.values(NT).every(t=>!t.g);
  document.getElementById("nba-standings").innerHTML = (none ? '<p class="note">2026-27 例行賽尚未開打，戰績皆為 0 勝 0 敗。</p>' : "") + html + "</div>";
}

const INJ_ZH = {"Out":"缺陣","Day-To-Day":"每日觀察","Questionable":"出賽成疑","Doubtful":"可能缺陣","Probable":"可能出賽","Suspension":"禁賽"};
let NINJ = null;
async function nbaInjuries(){
  if(NINJ) return;
  NINJ = {};
  try{ const d = await getJSON(`${ESPN}/injuries`); for(const t of d.injuries||[]) NINJ[t.id] = t.injuries||[]; }catch(e){}
}

// 信心門檻（2025-26 回測）：未滿 60% 勢均力敵、60–70% 略占上風、70% 以上明顯看好；開季到 1/14 最高只寫「看好」
const nEarly = (dt=new Date()) => { const m = dt.getMonth(), d = dt.getDate(); return m >= 8 || (m === 0 && d <= 14); };
const nTier = (p, early) => p >= 70 ? (early ? ["lean","看好"] : ["strong","明顯看好"]) : p >= 60 ? ["lean","略占上風"] : ["toss","接近五五波"];
const nWord = (p, early) => p >= 70 ? (early ? "看好" : "明顯看好") : p >= 60 ? "略占上風" : "勢均力敵";
let NALL = [];   // 近期所有賽程（判斷背靠背：前 36 小時內同隊有比賽）
function nbaCard(ev){
  const c = ev.competitions[0], H = c.competitors.find(x=>x.homeAway==="home"), A = c.competitors.find(x=>x.homeAway==="away");
  const th = NT[H.team.id] || {g:0,w:0,l:0}, ta = NT[A.team.id] || {g:0,w:0,l:0};
  const m = nModel(H.team.id, A.team.id), hp = Math.round(m.F), ap = 100-hp;
  const favHome = hp >= ap, fp = Math.max(hp, ap), fav = favHome ? H.team : A.team, oth = favHome ? A.team : H.team;
  const early = nEarly(new Date(ev.date)), [tc, tl] = nTier(fp, early), k = favHome ? 1 : -1, s1 = k*m.d1, s2 = k*m.d2;
  const small = th.g < NM.minG || ta.g < NM.minG;
  const big = fp === 50 ? `五五波：雙方各 <span class="num">50%</span>` : `${nWord(fp, early)}：${nts(fav)} <span class="num">${fp}%</span>`;
  const head = fp === 50 ? "兩隊勢均力敵，接近五五波" : !th.g && !ta.g ? "還沒有本季戰績，目前只依主場判斷" : Math.abs(m.d1) >= Math.abs(m.d2) ? `${nts(m.d1>0?H.team:A.team)}本季表現較好，是看好主因` : "兩隊實力接近，主場可能是關鍵";
  const li = (v, txt) => `<li><span class="dl ${dCls(v)}">${dTxt(v)}</span><span>${txt}</span></li>`;
  const pyd = t => t.g ? (t.pf - t.pa) / t.g : null;
  const t1 = !th.g && !ta.g ? "戰績：兩隊本季都還沒出賽，未調整" : Math.abs(m.d1) < 1 ? "戰績：兩隊本季表現相近" : `戰績：${nts(m.d1>0?H.team:A.team)}本季表現較${nts(m.d1>0?A.team:H.team)}好`;
  const c1 = (th.g || ta.g) ? chip("戰績", `${ta.w}-${ta.l}`, `${th.w}-${th.l}`, bt(ta.g?ta.w/ta.g:0, th.g?th.w/th.g:0)) + chip("場均分差", ta.g?sgn(pyd(ta).toFixed(1)):"-", th.g?sgn(pyd(th).toFixed(1)):"-", bt(pyd(ta), pyd(th))) : "";
  const inj = side => (NINJ[side.team.id]||[]).filter(x=>x.status!=="Active").slice(0,4).map(x=>`${npn(x.athlete.displayName)}（${INJ_ZH[x.status]||x.status}）`).join("、");
  const ia = NINJ ? inj(A) : "", ih = NINJ ? inj(H) : "";
  const injBox = (ia || ih) ? `<div class="why-k"><div class="why-kh">傷兵名單 <span class="ref-tag">參考，不計入勝率</span></div><div class="mk-focus">${ia?`${nts(A.team)}：${ia}`:""}${ia&&ih?"<br>":""}${ih?`${nts(H.team)}：${ih}`:""}</div></div>` : "";
  const b2b = [A, H].filter(x => { const t0 = new Date(ev.date); return NALL.some(e => e.id !== ev.id && e.competitions[0].competitors.some(c => c.team.id === x.team.id) && t0 - new Date(e.date) > 0 && t0 - new Date(e.date) < 36*3600e3); }).map(x => `${nts(x.team)}昨天剛出賽（背靠背）`).join("<br>");
  const b2bBox = b2b ? `<div class="why-k"><div class="why-kh">賽程 <span class="ref-tag">參考，不計入勝率</span></div><div class="mk-focus">${b2b}</div></div>` : "";
  return `<div class="pcard">${small?`<span class="wait-tag">樣本不足</span>`:""}
    <div class="meta"><span class="nw">客 ${nts(A.team)}</span> @ <span class="nw">主 ${nts(H.team)}</span><br>${twT(ev.date)}（台灣時間）</div>
    <div class="headline">${big}</div>
    ${early && fp >= 70 ? '<div class="early-note">開季數據少，保守看待</div>' : ""}
    <div class="tier-row"><span class="tier ${tc}">${tl}</span>${fp!==50?`<span class="upset">${nts(oth)}仍有 ${100-fp}% 勝率</span>`:""}</div>
    <div class="pbar-lab"><span>客 ${nts(A.team)} <span class="num">${ap}%</span></span><span>主 ${nts(H.team)} <span class="num">${hp}%</span></span></div>
    <div class="pbar" role="img" aria-label="${ntn(A.team)} ${ap}%，${ntn(H.team)} ${hp}%"><div class="${favHome?"oth":"fav"}" style="width:${ap}%"></div><div class="${favHome?"fav":"oth"}" style="width:${hp}%"></div></div>
    <div class="why"><div class="why-h">為什麼這樣預測？</div><div class="why-c">${head}</div>
      <ul class="why-l"><li><span class="dl ${dCls(s1)}">${dTxt(s1)}</span><span>${t1}${c1?`<span class="chips">${c1}</span>`:""}</span></li>${li(s2, `主場：${nts(H.team)}主場優勢`)}</ul></div>
    ${b2bBox}${injBox}
    <div class="upd">最後更新：${twT(Date.now())}（台灣時間）</div></div>`;
}

async function nbaGames(){
  const days = [-2,-1,0,1,2,3].map(usDay);
  const res = await Promise.all(days.map(d => getJSON(`${ESPN}/scoreboard?dates=${d}`).catch(()=>({events:[]}))));
  const evs = res.flatMap(r=>r.events||[]);
  const seen = new Set(), all = evs.filter(e => !seen.has(e.id) && seen.add(e.id));
  let up = all.filter(e => e.status.type.state==="pre" && e.season.type===2);
  let note = "";
  if(!up.length){
    // 例行賽還沒開打：顯示開幕賽程
    const o = await Promise.all(["20261020","20261021","20261022"].map(d => getJSON(`${ESPN}/scoreboard?dates=${d}`).catch(()=>({events:[]}))));
    up = o.flatMap(r=>r.events||[]).filter(e => e.season.type===2 && e.status.type.state==="pre");
    note = '<p class="note">例行賽 10/21（台灣時間）開打。以下為開幕賽程，兩隊都還沒有本季戰績，預測目前只依主場優勢，開打後會隨戰績更新。</p>';
  }
  NALL = all.concat(up);
  await nbaInjuries();
  document.getElementById("nba-predict").innerHTML = note + (up.slice(0,8).map(nbaCard).join("") || "<p>近期沒有例行賽</p>");
  const done = all.filter(e => e.status.type.completed).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5);
  await nbaRecaps(done);
}

const npS = n => { const z = npn(n); return /[A-Za-z]/.test(z) ? ` ${z} ` : z; };
const STYPE = {1:"熱身賽",2:"例行賽",3:"季後賽",5:"季中錦標賽"};
async function nbaRecaps(games){
  let html = "";
  for(const ev of games){
    let d; try{ d = await getJSON(`${ESPN}/summary?event=${ev.id}`); }catch(e){ continue; }
    const comp = d.header.competitions[0], H = comp.competitors.find(x=>x.homeAway==="home"), A = comp.competitors.find(x=>x.homeAway==="away");
    const hs = +H.score, as = +A.score, W = hs > as ? H : A, L = W === H ? A : H;
    const q = side => (side.linescores||[]).map(x=>+x.displayValue);
    const qw = q(W), ql = q(L);
    // 單節分差最大的一節
    let bi = -1, bm = 0; qw.forEach((v,i)=>{ if(v-(ql[i]||0) > bm){ bm = v-(ql[i]||0); bi = i; } });
    const qn = i => i < 4 ? `第 ${i+1} 節` : `延長賽第 ${i-3} 節`;
    // 兩隊得分王（boxscore）
    const top = tid => { const b = (d.boxscore.players||[]).find(x=>x.team.id===tid); if(!b) return null;
      const st = b.statistics[0], ix = st.names ? st.names.indexOf("PTS") : st.labels.indexOf("PTS"), ir = (st.names||st.labels).indexOf("REB"), ia = (st.names||st.labels).indexOf("AST");
      const p = st.athletes.filter(a=>a.stats && a.stats.length).sort((x,y)=>+y.stats[ix] - +x.stats[ix])[0];
      return p ? {n:npS(p.athlete.displayName), pts:+p.stats[ix], reb:p.stats[ir], ast:p.stats[ia]} : null; };
    const tw_ = top(W.team.id), tl_ = top(L.team.id);
    const R = [];
    if(bi >= 0) R.push(`${qn(bi)}${nts(W.team)}單節贏 ${bm} 分（${qw[bi]} 比 ${ql[bi]}），拉開比數。`);
    if(tw_) R.push(`${nts(W.team)}由${tw_.n}攻下全隊最高 ${tw_.pts} 分（${tw_.reb} 籃板、${tw_.ast} 助攻）。`);
    if(tl_) R.push(`${nts(L.team)}得分最高是${tl_.n} ${tl_.pts} 分。`);
    if(hs-as === 0) continue;
    const ls = `<table class="ls"><tr><th>球隊</th>${qw.map((_,i)=>`<th>${i<4?i+1:"OT"+(i-3)}</th>`).join("")}<th>總分</th></tr>`
      + [A,H].map(s=>`<tr><td>${nts(s.team)}</td>${q(s).map(v=>`<td>${v}</td>`).join("")}<td><b>${s.score}</b></td></tr>`).join("") + "</table>";
    html += `<article><h3><span class="ah-d">${twT(ev.date)}（台灣時間）・${STYPE[ev.season.type]||""}</span><span class="ah-s">${nts(A.team)} ${as} : ${hs} ${nts(H.team)}</span></h3>
      <div class="hl"><div class="hl-title">${nts(W.team)} 為什麼贏？</div><ol>${R.map(x=>`<li>${x}</li>`).join("")}</ol></div>
      <details class="full"><summary>看各節比分</summary>${ls}</details></article>`;
  }
  document.getElementById("nba-analysis").innerHTML = html || "最近沒有已完賽的比賽";
}

let nbaLoaded = false;

// ===== NBA 排行榜（場均得分／籃板／助攻）=====
const NLB = "https://site.web.api.espn.com/apis/site/v3/sports/basketball/nba/leaders?seasontype=2&limit=10&season=";
async function nbaLeaders(){
  const yr = new Date().getMonth() >= 8 ? new Date().getFullYear()+1 : new Date().getFullYear();
  let d = null, cur = true;
  try{ d = await getJSON(NLB + yr); }catch(e){}
  if(!d || !(d.leaders && (d.leaders.categories||[]).length)){ cur = false; d = await getJSON(NLB + (yr-1)); }
  const sname = (d.requestedSeason||{}).displayName || "";
  const cats = {pointsPerGame:"場均得分", reboundsPerGame:"場均籃板", assistsPerGame:"場均助攻"};
  let html = cur ? `<p class="note">${sname} 例行賽。開季初期出賽場數少，排名變動會比較大。</p>` : `<p class="note">${yr-1}-${String(yr).slice(2)} 例行賽尚未開打，以下為上季（${sname}）例行賽排行，開打後自動換成本季。</p>`;
  const cs = Object.keys(cats).map(k => d.leaders.categories.find(c => c.name === k)).filter(Boolean);
  html += `<div class="tabs" role="tablist">${cs.map((c,i)=>`<button role="tab" aria-selected="${i===0}" data-ntab="${c.name}">${cats[c.name].slice(2)}</button>`).join("")}</div>`;
  for(const [ci, c] of cs.entries()){
    html += `<div class="ntabp" data-ntab="${c.name}" ${ci?"hidden":""}><h3>${cats[c.name]}</h3><table><tr><th>球員</th><th>球隊</th><th>數據</th></tr>`;
    c.leaders.slice(0,10).forEach((l,i) => { html += `<tr><td>${i+1}. ${npn(l.athlete.displayName)}</td><td>${l.team ? nts(l.team) : "-"}</td><td class="num">${l.displayValue}</td></tr>`; });
    html += "</table></div>";
  }
  const box = document.getElementById("nba-leaders"); box.innerHTML = html;
  box.querySelectorAll("button[data-ntab]").forEach(b => b.onclick = () => {
    box.querySelectorAll("button[data-ntab]").forEach(x => x.setAttribute("aria-selected", x === b));
    box.querySelectorAll(".ntabp").forEach(p => p.hidden = p.dataset.ntab !== b.dataset.ntab); });
}
// ===== NBA 預測命中率：讀 data/nba-predictions.json（由每小時排程寫入）=====
async function nbaHit(){
  const el = document.getElementById("nba-hit");
  const r = await fetch("data/nba-predictions.json?t=" + Date.now()); if(!r.ok) throw new Error("HTTP " + r.status);
  const d = await r.json(), GOAL = 50;
  const done = d.records.filter(x => x.official && x.correct !== null), n = done.length, ok = done.filter(x => x.correct).length;
  let html = n >= GOAL ? `<div class="hr-big">${Math.round(ok/n*100)}%</div><div class="hr-sub">NBA 模型命中率（共 ${n} 場）</div>`
    : `<div class="hr-big muted">累積中</div><div class="hr-prog"><div class="hr-bar"><div style="width:${n/GOAL*100}%"></div></div><span>已完賽 ${n} / ${GOAL} 場，滿 ${GOAL} 場後顯示命中率</span></div>`;
  html += `<p class="hr-upd">最後更新：${d.updated}</p>`;
  if(!d.records.length){ el.innerHTML = html + '<p class="note">2026-27 例行賽 10/21（台灣時間）開打，開打前會開始記錄。</p>'; return; }
  html += '<div style="overflow-x:auto"><table class="hrt"><tr><th>比賽時間</th><th>對戰（客 @ 主）</th><th>預測勝方</th><th>預測勝率</th><th>實際比分</th><th>結果</th></tr>';
  for(const x of d.records.slice().reverse().slice(0,15)){
    const sn = x.official || x.snapshots[x.snapshots.length-1], hp = sn.homeWinProb, pw = hp >= .5 ? x.home : x.away;
    html += `<tr><td class="nw">${x.gameTime.replace(" (UTC+8)","")}</td><td class="nw">${x.away} @ ${x.home}</td><td>${pw}${x.official?"":"（暫定）"}</td><td class="num">${Math.round(Math.max(hp,1-hp)*100)}%</td><td>${x.final||"尚未開打／進行中"}</td><td>${x.correct===null?"待賽":x.correct?"猜對":"猜錯"}</td></tr>`;
  }
  el.innerHTML = html + "</table></div>";
}
async function secNbaStand(){ await nbaStandings(); }
async function secNbaGames(){ if(!Object.keys(NT).length) await nbaStandings(); await nbaGames(); }
async function loadNBA(){
  if(nbaLoaded) return; nbaLoaded = true;
  await runSection(["nba-standings"], secNbaStand);
  await runSection(["nba-predict","nba-analysis"], secNbaGames);
  await runSection(["nba-hit"], nbaHit);
  await runSection(["nba-leaders"], nbaLeaders);
}
