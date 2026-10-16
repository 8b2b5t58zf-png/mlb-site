// ===== NBA v1：資料來自 ESPN 公開 JSON（瀏覽器端抓取）=====
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const ESPN_ST = "https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?seasontype=2";
// 先讀排程存好的 data/nba/*.json（快、穩）；超過 12 小時才直接連 ESPN；ESPN 也抓不到就用舊檔並註明時間
const NFRESH = 12*3600e3, NFILE = {};
let NST_AT = null;   // 目前戰績資料的抓取時間
async function nbaFile(name){
  if(!(name in NFILE)) NFILE[name] = fetch(`data/nba/${name}.json?t=${Math.floor(Date.now()/3e5)}`).then(r => r.ok ? r.json() : null).catch(() => null);
  return NFILE[name];
}
const nAge = f => f && f.fetched_at ? Date.now() - Date.parse(f.fetched_at) : Infinity;
async function nbaGet(name, pick, url){
  const f = await nbaFile(name), v = f ? pick(f) : null;
  const markAt = t => { if(!dataAt || t < dataAt) dataAt = t; };
  if(v && nAge(f) < NFRESH){ markAt(Date.parse(f.fetched_at)); return {data:v, at:Date.parse(f.fetched_at)}; }
  const before = usedCache;
  try{ const d = await getJSON(url); return {data:d, at: usedCache !== before ? usedCache : Date.now()}; }
  catch(e){ if(v){ const t = Date.parse(f.fetched_at);
    // 排程檔 24 小時內仍算正常（ESPN 也抓不到時）（只顯示資料時間）；更舊才算真的抓不到
    if(nAge(f) < 24*3600e3) markAt(t); else if(!usedCache || t < usedCache) usedCache = t; return {data:v, at:t}; } throw e; }
}
// 30 隊台灣常用隊名（ESPN 縮寫 → [全名, 簡稱]），來源 /workspace/nba/teams.md
const NZH = {ATL:["亞特蘭大老鷹","老鷹"],BOS:["波士頓塞爾提克","塞爾提克"],BKN:["布魯克林籃網","籃網"],CHA:["夏洛特黃蜂","黃蜂"],CHI:["芝加哥公牛","公牛"],
CLE:["克里夫蘭騎士","騎士"],DAL:["達拉斯獨行俠","獨行俠"],DEN:["丹佛金塊","金塊"],DET:["底特律活塞","活塞"],GS:["金州勇士","勇士"],HOU:["休士頓火箭","火箭"],
IND:["印第安納溜馬","溜馬"],LAC:["洛杉磯快艇","快艇"],LAL:["洛杉磯湖人","湖人"],MEM:["曼菲斯灰熊","灰熊"],MIA:["邁阿密熱火","熱火"],MIL:["密爾瓦基公鹿","公鹿"],
MIN:["明尼蘇達灰狼","灰狼"],NO:["紐奧良鵜鶘","鵜鶘"],NY:["紐約尼克","尼克"],OKC:["奧克拉荷馬雷霆","雷霆"],ORL:["奧蘭多魔術","魔術"],PHI:["費城七六人","七六人"],
PHX:["鳳凰城太陽","太陽"],POR:["波特蘭拓荒者","拓荒者"],SAC:["沙加緬度國王","國王"],SA:["聖安東尼奧馬刺","馬刺"],TOR:["多倫多暴龍","暴龍"],UTAH:["猶他爵士","爵士"],WSH:["華盛頓巫師","巫師"]};
const ntn = t => (NZH[t.abbreviation]||[t.displayName])[0];
const nts = t => (NZH[t.abbreviation]||[,t.shortDisplayName||t.displayName])[1];

// 模型 blend_v1（見 /workspace/analysis/nba_early_report.md）：上一季畢氏(14)往 .500 拉回 ×0.6 當起點，
// 本季實力＝勝率50%＋畢氏勝率(指數14)50%，依場數混合 w=g/(g+10)；Log5（夾 1%～99%）；主場 logit +0.221
const NM = {exp:14, k:10, r:0.6, hca:0.221, minG:10, ver:"blend_v1"};
const NT = {};   // 球隊 id → {w,l,pf,pa,g,abbr,...}
let NPRIOR = {}, NPYTH = {}; // 球隊 id → 上一季（2025-26 例行賽）拉回後實力，data/nba/prior_2526.json
async function nbaPrior(){ try{ const r = await fetch("data/nba/prior_2526.json?v=1"); if(r.ok){ const d = await r.json(); for(const [id,t] of Object.entries(d.teams)) { NPRIOR[id] = 0.5 + (t.prior_pyth-0.5)*NM.r; NPYTH[id] = t.prior_pyth; } } }catch(e){} }
function nStrength(t, id){
  const pr = NPRIOR[id] ?? 0.5;
  if(!t || !t.g) return pr;
  const py = t.pf**NM.exp/(t.pf**NM.exp + t.pa**NM.exp), cur = 0.5*t.w/t.g + 0.5*py, w = t.g/(t.g+NM.k);
  return w*cur + (1-w)*pr;
}
function nModel(hId, aId, neutral){
  const h = nStrength(NT[hId], hId), a = nStrength(NT[aId], aId);
  const q1 = Math.min(0.99, Math.max(0.01, log5(h, a))), q2 = sig(logit(q1) + (neutral ? 0 : NM.hca));
  const R1 = Math.round(q1*1000), F = Math.round(q2*1000);
  // 拆解（附錄規格）：本季戰績 p1（只看本季、w=1，0 場＝.5）→ 上一季實力 → 主場（吸收捨入）
  const cu = t => !t || !t.g ? 0.5 : 0.5*t.w/t.g + 0.5*t.pf**NM.exp/(t.pf**NM.exp + t.pa**NM.exp);
  const p1 = Math.min(0.99, Math.max(0.01, log5(cu(NT[hId]), cu(NT[aId]))));
  const s1 = Math.round((p1-0.5)*1000)/10, s2 = Math.round((q1-p1)*1000)/10, Fx = Math.round(q2*1000)/10;
  return {d1:(R1-500)/10, d2:(F-R1)/10, F:F/10, s1, s2, s3:Math.round((Fx-50-s1-s2)*10)/10};
}
// 美國日期 YYYYMMDD（ESPN 用美東日期）
const usDay = off => { const d = new Date(Date.now() - 5*3600e3 + off*864e5); return d.toISOString().slice(0,10).replace(/-/g,""); };
const usDate = d => new Date(d - 5*3600e3).toISOString().slice(0,10);
const twT = s => new Date(s).toLocaleString("zh-TW",{timeZone:"Asia/Taipei",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});
const stv = (e, n) => { const s = e.stats.find(x=>x.name===n); return s ? s : {}; };

async function nbaStandings(){
  const g = await nbaGet("standings", f => f.data, ESPN_ST), d = g.data; NST_AT = g.at;
  let html = '<div class="divs">';
  for(const conf of d.children){
    const rows = conf.standings.entries.map(e => {
      const t = {id:e.team.id, abbr:e.team.abbreviation, team:e.team, w:+stv(e,"wins").value||0, l:+stv(e,"losses").value||0,
        pf:+stv(e,"pointsFor").value||0, pa:+stv(e,"pointsAgainst").value||0, apf:stv(e,"avgPointsFor").displayValue, apa:stv(e,"avgPointsAgainst").displayValue,
        gb:stv(e,"gamesBehind").displayValue, pct:stv(e,"winPercent").displayValue, diff:stv(e,"differential").displayValue};
      t.g = t.w + t.l; t.raw = e; NT[t.id] = t; return t;
    }).sort((x,y)=> (y.g? y.w/y.g:0) - (x.g? x.w/x.g:0) || x.team.displayName.localeCompare(y.team.displayName));
    html += `<div><h3>${conf.name.startsWith("East")?"東區":"西區"}</h3><table class="nst"><tr><th>球隊</th><th>勝</th><th>敗</th><th class="dk">勝率</th><th>勝差</th><th class="dk">場均得分</th><th class="dk">場均失分</th><th class="dk">得失分差</th></tr>`;
    for(const t of rows) html += `<tr><td class="nw">${nts(t.team)}</td><td>${t.w}</td><td>${t.l}</td><td>${t.pct||"-"}</td><td>${t.gb||"-"}</td><td class="dk">${t.g?t.apf:"-"}</td><td class="dk">${t.g?t.apa:"-"}</td><td class="dk">${t.g?t.diff:"-"}</td></tr>`;
    html += "</table></div>";
  }
  const none = Object.values(NT).every(t=>!t.g);
  document.getElementById("nba-standings").innerHTML = (none ? '<p class="note">2026-27 例行賽尚未開打，戰績皆為 0 勝 0 敗。</p>' : "") + html + "</div>";
}


// 信心門檻（2025-26 回測）：未滿 60% 勢均力敵、60–70% 略占上風、70% 以上明顯看好；開季到 1/14 最高只寫「看好」
const nEarly = (dt=new Date()) => { const m = dt.getMonth(), d = dt.getDate(); return m >= 8 || (m === 0 && d <= 14); };
const nTier = (p, early) => p >= 70 ? (early ? ["lean","看好"] : ["strong","明顯看好"]) : p >= 60 ? ["lean","略占上風"] : ["toss","接近五五波"];
const nWord = (p, early) => p >= 70 ? (early ? "看好" : "明顯看好") : p >= 60 ? "略占上風" : "勢均力敵";
let NALL = [];   // 近期所有賽程（判斷背靠背：前 36 小時內同隊有比賽）
function nbaCard(ev){
  const c = ev.competitions[0], H = c.competitors.find(x=>x.homeAway==="home"), A = c.competitors.find(x=>x.homeAway==="away");
  const th = NT[H.team.id] || {g:0,w:0,l:0}, ta = NT[A.team.id] || {g:0,w:0,l:0};
  const m = nModel(H.team.id, A.team.id, c.neutralSite), hp = Math.round(m.F), ap = 100-hp;
  const favHome = hp >= ap, fp = Math.max(hp, ap), fav = favHome ? H.team : A.team, oth = favHome ? A.team : H.team;
  const early = nEarly(new Date(ev.date)), [tc, tl] = nTier(fp, early), k = favHome ? 1 : -1, s1 = k*m.d1, s2 = k*m.d2;
  const small = th.g < NM.minG || ta.g < NM.minG;
  const big = fp === 50 ? `五五波：雙方各 <span class="num">50%</span>` : `${nWord(fp, early)}：${nts(fav)} <span class="num">${fp}%</span>`;
  // 為什麼這樣預測：本季戰績、上一季實力、主場（只寫計入模型的項目）
  const pc = t => t.g ? t.w/t.g : 0;
  let t1;
  if(!th.g && !ta.g) t1 = WHY_TXT.preseason;
  else { const [X, Y, xt, yt] = pc(th) >= pc(ta) ? [H, A, th, ta] : [A, H, ta, th];
    t1 = Math.abs(pc(th)-pc(ta)) < 0.02 ? wf("recClose", {p:wpct(pc(xt)), op:wpct(pc(yt))}, ["p","op"])
      : wf("rec", {t:nts(X.team), w:xt.w, l:xt.l, p:wpct(pc(xt)), o:nts(Y.team), op:wpct(pc(yt))}, ["w","l","p","op"]); }
  const pX = m.s2 >= 0 ? H : A;
  const t2 = th.g >= 30 && ta.g >= 30 ? WHY_TXT.priorLate : NPYTH[pX.team.id] != null ? wf("prior", {t:nts(pX.team), p:wpct(NPYTH[pX.team.id])}, ["p"]) : wf("prior", {t:nts(pX.team), p:""}).replace("（畢氏勝率 ）","");
  const t3 = c.neutralSite ? WHY_TXT.neutral : wf("home", {t:nts(H.team)});
  const why = whyBlock2([[k*m.s1, t1, "rec"], [k*m.s2, t2, "prior"], [k*m.s3, t3, "home"]], nts(fav), fp, favHome ? m.F : Math.round((100-m.F)*10)/10);
  // 參考數據（固定四列：近 10 場、主客場、場均得失分差、休息天數）
  const sv = (t, re) => { const e = t && t.raw && t.raw.stats.find(x => re.test(x.name||"") || re.test(x.type||"")); return e && e.displayValue && e.displayValue !== "0-0" ? e.displayValue.split("-") : null; };
  const la = sv(ta, /last ?ten|^l10$/i), lh = sv(th, /last ?ten|^l10$/i), ra = sv(ta, /^road$/i), rh = sv(th, /^home$/i);
  const pyd = t => t.g ? wsg((t.pf - t.pa) / t.g) : null;
  const rest = x => { const t0 = new Date(ev.date), prev = NALL.filter(e => e.id !== ev.id && e.competitions[0].competitors.some(c => c.team.id === x.team.id) && new Date(e.date) < t0).map(e => new Date(e.date)).sort((p,q)=>q-p)[0];
    if(!prev) return null; const dd = Math.round((new Date(usDate(t0)) - new Date(usDate(prev)))/864e5) - 1;
    return dd <= 0 ? wf("b2b", {t:nts(x.team)}) : wf("rest", {t:nts(x.team), n:dd}, ["n"]); };
  const rs = [rest(A), rest(H)].filter(Boolean).join("，");
  const ref = refBlock([
    la && lh ? wf("last10", {a:nts(A.team), aw:la[0], al:la[1], h:nts(H.team), hw:lh[0], hl:lh[1]}, ["aw","al","hw","hl"]) : "",
    ra && rh ? wf("homeAway", {h:nts(H.team), hw:rh[0], hl:rh[1], a:nts(A.team), aw:ra[0], al:ra[1]}, ["hw","hl","aw","al"]) : "",
    pyd(ta) && pyd(th) ? wf("diff", {a:nts(A.team), ad:pyd(ta), h:nts(H.team), hd:pyd(th)}, ["ad","hd"]) : "",
    rs,
  ], "nba");
  return `<div class="pcard">${small?`<span class="wait-tag">樣本不足</span>`:""}
    <div class="meta"><span class="nw">客 ${nts(A.team)}</span> @ <span class="nw">主 ${nts(H.team)}</span><br>${twT(ev.date)}（台灣時間）</div>
    <div class="headline">${big}</div>
    ${early && fp >= 70 ? '<div class="early-note">開季數據少，保守看待</div>' : ""}
    <div class="tier-row"><span class="tier ${tc}">${tl}</span>${fp!==50?`<span class="upset">${nts(oth)}仍有 ${100-fp}% 勝率</span>`:""}</div>
    <div class="pbar-lab"><span>客 ${nts(A.team)} <span class="num">${ap}%</span></span><span>主 ${nts(H.team)} <span class="num">${hp}%</span></span></div>
    <div class="pbar" role="img" aria-label="${ntn(A.team)} ${ap}%，${ntn(H.team)} ${hp}%"><div class="${favHome?"oth":"fav"}" style="width:${ap}%"></div><div class="${favHome?"fav":"oth"}" style="width:${hp}%"></div></div>
    ${why}${ref}
    ${NST_AT && Date.now() - NST_AT > NFRESH ? `<div class="upd">依據 ${twT(NST_AT)}（台灣時間）時的戰績</div>` : `<div class="upd">戰績更新：${twT(NST_AT || Date.now())}（台灣時間）</div>`}</div>`;
}

async function nbaGames(){
  const days = [-2,-1,0,1,2,3].map(usDay);
  const sbd = d => nbaGet("scoreboard", f => f.days && f.days[d], `${ESPN}/scoreboard?dates=${d}`).then(x => x.data).catch(()=>null);
  const res0 = await Promise.all(days.map(sbd));
  if(res0.every(x => x === null)) throw new Error("scoreboard");
  const res = res0.map(x => x || {events:[]});
  const evs = res.flatMap(r=>r.events||[]);
  const seen = new Set(), all = evs.filter(e => !seen.has(e.id) && seen.add(e.id));
  let up = all.filter(e => e.status.type.state==="pre" && e.season.type===2);
  let note = "";
  if(!up.length){
    // 例行賽還沒開打：顯示開幕賽程
    const o = (await Promise.all(["20261020","20261021","20261022"].map(sbd))).map(x => x || {events:[]});
    up = o.flatMap(r=>r.events||[]).filter(e => e.season.type===2 && e.status.type.state==="pre");
    note = '<p class="note">例行賽 10/21（台灣時間）開打。以下為開幕賽程，兩隊都還沒有本季戰績，預測目前依上一季實力加主場優勢，開打後會逐步改看本季戰績。</p>';
  }
  NALL = all.concat(up);
  document.getElementById("nba-predict").innerHTML = note + ((DG => up.slice(0,8).map(e => dayHdr(e.date, DG) + nbaCard(e)).join(""))({last:null}) || nbaNoGames(all));
  const done = all.filter(e => e.status.type.completed).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5);
  await nbaRecaps(done);
}

// 當天無比賽／休賽季的固定說法（style-guide 第十五節）
function nbaNoGames(all){
  const nx = all.filter(e => e.status.type.state === "pre").sort((a,b) => a.date.localeCompare(b.date))[0];
  if(nx){ const d = new Date(nx.date).toLocaleDateString("zh-TW",{timeZone:"Asia/Taipei",month:"numeric",day:"numeric"}); return `<p class="note">今天沒有比賽，下一場是 ${d}</p>`; }
  return '<p class="note">NBA 目前休賽中</p>';
}
const npS = n => { const z = npn(n); return /[A-Za-z]/.test(z) ? ` ${z} ` : z; };
const STYPE = {1:"熱身賽",2:"例行賽",3:"季後賽",5:"季中錦標賽"};
async function nbaRecaps(games){
  let html = "";
  const DG = {last:null};
  for(const ev of games){
    let d; try{ d = (await nbaGet("summaries", f => f.games && f.games[ev.id], `${ESPN}/summary?event=${ev.id}`)).data; }catch(e){ continue; }
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
    html += dayHdr(ev.date, DG) + `<article><h3><span class="ah-d">${twT(ev.date)}（台灣時間）・${STYPE[ev.season.type]||""}</span><span class="ah-s">${nts(A.team)} ${as} : ${hs} ${nts(H.team)}</span></h3>
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
  const has = x => x && x.leaders && (x.leaders.categories||[]).length;
  const lf = await nbaFile("leaders");
  if(lf && nAge(lf) < NFRESH && !has((lf.seasons||{})[yr])) d = null;   // 排程剛確認本季還沒有排行，不必再連 ESPN
  else try{ d = (await nbaGet("leaders", f => has(f.seasons && f.seasons[yr]) ? f.seasons[yr] : null, NLB + yr)).data; }catch(e){}
  if(!has(d)){ cur = false; d = (await nbaGet("leaders", f => f.seasons && f.seasons[yr-1], NLB + (yr-1))).data; }
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
  const r = await fetch("data/nba-predictions.json?t=" + Date.now()); if(!r.ok) throw new Error("nba-predictions");
  const d = await r.json(), GOAL = 50;
  const isNew = x => (x.official||{}).model === NM.ver, old = d.records.filter(x => x.official && x.correct !== null && !isNew(x)), oOk = old.filter(x=>x.correct).length;
  const done = d.records.filter(x => x.official && x.correct !== null && isNew(x)), n = done.length, ok = done.filter(x => x.correct).length;
  let html = n >= GOAL ? `<div class="hr-big">${Math.round(ok/n*100)}%</div><div class="hr-sub">NBA 模型命中率（共 ${n} 場）</div>`
    : `<div class="hr-big muted">累積中</div><div class="hr-prog"><div class="hr-bar"><div style="width:${n/GOAL*100}%"></div></div><span>${NM.ver}：${n} / ${GOAL} 場</span></div><div class="hr-ref">滿 ${GOAL} 場正式預測後顯示命中率</div>`;
  if(old.length) html += `<p class="note">舊版模型 v1 另計：${old.length} 場猜對 ${oOk} 場</p>`;
  html += `<p class="hr-upd">最後更新：${fmtT(d.updated)}（台灣時間）</p>`;
  if(!d.records.length){ el.innerHTML = html + '<p class="note">2026-27 例行賽 10/21（台灣時間）開打，開打前會開始記錄。</p>'; return; }
  html += '<div class="tblwrap" style="overflow-x:auto"><table class="hrt"><tr><th>比賽時間</th><th>對戰（客 @ 主）</th><th>預測</th><th class="dk">勝率</th><th class="dk">實際比分</th><th class="dk">結果</th></tr>';
  for(const x of d.records.slice().reverse().slice(0,15)){
    const sn = x.official || x.snapshots[x.snapshots.length-1], hp = sn.homeWinProb, pw = hp >= .5 ? x.home : x.away;
    html += `<tr><td class="nw dt">${fmtD(x.gameTime)}</td><td class="nw mu">${x.away} @ ${x.home}</td><td class="nw">${pw}${x.correct==null?"":" "+resMark(x.correct)}${x.official?"":`<div class="tent">未開賽・預測會更新</div>`}</td><td class="num dk">${Math.round(Math.max(hp,1-hp)*100)}%</td><td class="dk">${x.final||"尚未開打／進行中"}</td><td class="dk">${x.correct===null?"待賽":x.correct?"猜對":"猜錯"}</td></tr>`;
  }
  el.innerHTML = html + "</table></div>";
}
async function secNbaStand(){ await nbaStandings(); }
async function secNbaGames(){ if(!Object.keys(NT).length) await nbaStandings(); await nbaPrior(); await nbaGames(); }
async function loadNBA(){
  if(nbaLoaded) return; nbaLoaded = true;
  await runSection(["nba-standings"], secNbaStand);
  await runSection(["nba-predict","nba-analysis"], secNbaGames);
  await runSection(["nba-hit"], nbaHit);
  await runSection(["nba-leaders"], nbaLeaders);
}
