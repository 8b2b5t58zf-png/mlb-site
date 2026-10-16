// ===== 「為什麼這樣預測」與「參考數據」文案集中處（style-guide 第十八、十九節）=====
// 內容編輯可直接改這裡的字。{x} 由程式填入；數字會自動套等寬字。只影響顯示，不影響勝率。
const WHY_TXT = {
  title: "為什麼這樣預測？",
  // 總結句（依信心分級，不帶數字）
  sum: {
    strong: "各項指標都站在{t}這邊，模型給出明顯優勢",
    lean: "{t}靠{item}拉開些微差距，但還不到穩定領先",
    toss: "兩隊條件接近，這場要看臨場表現",
  },
  item: {rec:"戰績", home:"主場優勢", sp:"先發投手", prior:"上一季實力"},
  rec: "{t}本季 {w} 勝 {l} 敗，勝率 {p} 高於{o}的 {op}，戰績面占優",
  recClose: "兩隊戰績相近（{p} 對 {op}），這項影響不大",
  preseason: "新球季尚未開打，依上一季實力估算",
  prior: "開季場次還少，參考{t}上季得失分表現（畢氏勝率 {p}）",
  priorLate: "本季樣本已足，上季實力只占小幅比重",
  home: "{t}坐鎮主場，主場優勢",
  neutral: "中立場地，不計主場優勢",
  sp: "{p} 本季 ERA {era}、WHIP {whip}，數據優於{o}的 {oera}／{owhip}",
  spMixed: "{a}與{h}互有優劣",
  spClose: "{a}與{h}數據相近",
  spWait: "先發未公布，未調整",
  spOne: "{t}先發尚未公布，暫不調整",   // 模型規則：兩隊都公布才調整，只公布一邊時不調整
  // 先發投手對比（style-guide 第二十一節）
  pLabel: "先發",
  pLine: "ERA {era}・WHIP {whip}・{ip} 局",
  pSmall: "（樣本少）",
  pTbd: "尚未公布",
  pChange: "先發異動：原定{p}（勝率已重算）",
  pBefore: "（異動前 {t} {p}%）",
  pAnn: "先發已公布（勝率已重算）",
  pAnnBefore: "（公布前 {t} {p}%）",
  dayAll: "{d} 共 {n} 場・先發全部公布",
  dayHead: "{d} 共 {n} 場", dayA: "{a} 場已公布先發", dayB: "{b} 場待公布",   // 數量為 0 的段落不顯示
  noSp: "賽前未公布先發",
  total: "合計 → {t} {p}%（約 {r}%）",
  // 參考數據（只寫事實，最多 4 列，固定順序）
  refBtn: "參考數據",
  refTitle: "以下數據未計入勝率",
  refOpen: "▲", refClosed: "▼",
  last10: "近 10 場：{a} {aw}-{al}，{h} {hw}-{hl}",
  last10Post: "例行賽最後 10 場：{a} {aw}-{al}，{h} {hw}-{hl}",
  homeAway: "{h}主場 {hw}-{hl}，{a}客場 {aw}-{al}",
  diff: "場均得失分差：{a} {ad}，{h} {hd}",
  b2b: "{t}背靠背出賽",
  rest: "{t}休息 {n} 天",
};
const wn = v => `<span class="num">${v}</span>`;
// 套模板：字串值當球隊／人名，數字欄位（陣列 nums 內的 key）包等寬
function wf(key, o, nums=[]){ return WHY_TXT[key].replace(/\{(\w+)\}/g, (_, k) => o[k]==null ? "" : nums.includes(k) ? wn(o[k]) : o[k]); }
const wpct = v => v.toFixed(3).replace(/^0/, "");
const wsg = v => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1);
// 各列四捨五入到 0.1，最後一列＝合計減前面各列（吸收捨入差），合計剛好等於最終勝率（數據分析師規格）
function whyFit(vals, target){
  const r = vals.map(v => Math.round(v*10)/10), n = r.length - 1;
  r[n] = Math.round((target - r.slice(0,n).reduce((a,b)=>a+b,0))*10)/10;
  return r;
}
const wd = v => Math.abs(v) < 0.05 ? "±0.0%" : (v > 0 ? "▲+" : "▼−") + Math.abs(v).toFixed(1) + "%";
const wc = v => Math.abs(v) < 0.05 ? "zero" : v > 0 ? "up" : "down";
// rows＝[[數值, 句子, key]]；fav/fp 為卡片看好方與整數勝率
// F＝看好方最終勝率（一位小數）
function whyBlock2(rows, favName, fp, F){
  const vals = whyFit(rows.map(r=>r[0]), F - 50);
  const tk = fp >= 60 ? "strong" : fp >= 53 ? "lean" : "toss";
  let best = 0; vals.forEach((v,i)=>{ if(v > vals[best]) best = i; });
  const head = fp === 50 || tk === "toss" ? WHY_TXT.sum.toss : WHY_TXT.sum[tk].replace("{t}", favName).replace("{item}", WHY_TXT.item[rows[best][2]]);
  const li = rows.map((r,i) => `<li><span class="dl ${wc(vals[i])}">${wd(vals[i])}</span><span>${r[1]}</span></li>`).join("");
  return `<div class="why"><div class="why-h">${WHY_TXT.title}</div><div class="why-c">${head}</div>
    <ul class="why-l">${li}<li class="why-tot"><span class="dl"></span><span>${wf("total", {t:favName, p:F.toFixed(1), r:fp}, ["p","r"])}</span></li></ul></div>`;
}
// 參考數據：lines＝字串陣列（空的略過），最多 4 列；預設收合
function refBlock(lines, lg){
  lines = lines.filter(Boolean).slice(0,4);
  if(!lines.length) return "";
  return `<details class="refd" data-lg="${lg}"><summary>${WHY_TXT.refBtn} <span class="ref-c">${WHY_TXT.refClosed}</span><span class="ref-o">${WHY_TXT.refOpen}</span></summary><div class="ref-t">${WHY_TXT.refTitle}</div><ul>${lines.map(x=>`<li>${x}</li>`).join("")}</ul></details>`;
}
// 展開時記一次 GoatCounter 事件
document.addEventListener("toggle", e => {
  const d = e.target; if(!d.classList || !d.classList.contains("refd") || !d.open) return;
  try{ if(window.goatcounter && window.goatcounter.count) window.goatcounter.count({path:`ref-open-${d.dataset.lg}`, title:"參考數據展開", event:true}); }catch(_){}
}, true);
// 日期分組標籤（台灣時間），例：10/17（五）；st＝{last:null} 每次渲染新建一個
const WD = "日一二三四五六";
function dayHdr(d, st){
  const t = new Date(new Date(d).getTime() + 8*3600e3), k = t.toISOString().slice(0,10);
  if(st.last === k) return ""; st.last = k;
  if(st.cnt && st.cnt[k] === 1) return "";
  return `<div class="dgrp">${t.getUTCMonth()+1}/${t.getUTCDate()}（${WD[t.getUTCDay()]}）・台灣時間</div>`;
}

// 精簡卡片（§24）：預設收合，點一下原地展開；一次只開一張
const hhmm = d => new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Taipei",hour12:false,hour:"2-digit",minute:"2-digit"}).format(new Date(d)).replace(/^24/,"00");
const CONF = {strong:"高", lean:"中", toss:"低"};
let CC_N = 0;
// items: [{k:名稱, t:隊名, v:對主隊的百分點, sfx:句型}]，fav: 看好方是否主隊
function mainReason(items, favHome, wait, fp){
  if(fp != null && fp < 51) return "兩隊勝率接近" + (wait ? "（先發公布後會重算）" : "");
  const k = favHome ? 1 : -1, xs = items.filter(x => x.v != null).map(x => ({...x, f:k*x.v}));
  let c = xs.filter(x => x.f > 0).sort((a,b) => b.f - a.f);
  if(!c.length) c = xs.slice().sort((a,b) => Math.abs(b.v) - Math.abs(a.v));
  if(!c.length) return "";
  let s = c.length > 1 && Math.abs(Math.abs(c[0].f) - Math.abs(c[1].f)) < 0.5 ? `${c[0].k}與${c[1].k}影響相近` : `主因：${c[0].t}${c[0].sfx}`;
  return s + (wait ? "（先發公布後會重算）" : "");
}
function ccCard(o){   // spec-compact v1
  const id = `cc-${++CC_N}`, ft = o.focus ? `<span class="cc-focus">數據焦點</span>` : "", cf = `<span class="tier ${o.tc} cc-conf">信心 ${o.conf}</span>`;
  return `<div class="pcard cc${o.focus?" focus":""}">
  <button type="button" class="cc-head" aria-expanded="false" aria-controls="${id}" data-lg="${o.focus?"focus":o.lg}">
    <span class="cc-r1"><span class="cc-ser">${ft}${o.ser||""}</span><span class="cc-rt"><span class="cc-time num">${o.time}</span>${o.tag?`<span class="cc-tag">${o.tag}</span>`:""}<span class="cc-c1">${cf}</span></span></span>
    <span class="cc-r2"><span class="cc-tm">${o.A}</span><span class="cc-c2">${cf}</span><span class="cc-tm r">${o.H}</span></span>
    <span class="cc-r3"><span class="num cc-p">${o.ap}%</span><span class="cc-bar"><span class="${o.favHome?"oth":"fav"}" style="width:${o.ap}%"></span><span class="${o.favHome?"fav":"oth"}" style="width:${o.hp}%"></span></span><span class="num cc-p r">${o.hp}%</span></span>
    <span class="cc-r4"><span class="cc-why">${o.focus || o.reason || ""}</span><span class="cc-more">看分析 ›</span></span>
  </button>
  <div class="cc-body" id="${id}" inert><div class="cc-in">${o.body}</div></div></div>`;
}
function ccSet(b, open){
  const p = document.getElementById(b.getAttribute("aria-controls"));
  b.setAttribute("aria-expanded", open); b.querySelector(".cc-more").textContent = open ? "收起 ‹" : "看分析 ›";
  p.inert = !open; p.style.maxHeight = p.scrollHeight + "px";
  if(open){ p.classList.add("open"); setTimeout(() => { if(b.getAttribute("aria-expanded")==="true") p.style.maxHeight = "none"; }, 220); }
  else { p.offsetHeight; p.classList.remove("open"); p.style.maxHeight = "0px"; }
}
document.addEventListener("click", e => {
  const b = e.target.closest && e.target.closest(".cc-head"); if(!b) return;
  const open = b.getAttribute("aria-expanded") !== "true";
  document.querySelectorAll('.cc-head[aria-expanded="true"]').forEach(x => { if(x !== b) ccSet(x, false); });
  ccSet(b, open);
  if(open){ setTimeout(() => { if(b.getBoundingClientRect().top < 0) b.scrollIntoView({block:"nearest"}); }, 230);
    try{ if(window.goatcounter && window.goatcounter.count) window.goatcounter.count({path:`expand-${b.dataset.lg}`, title:"看分析展開", event:true}); }catch(_){} }
});

// 說明列尾端的「看算法 ▾」：開關下方的算法說明
document.addEventListener("click", e => {
  const b = e.target.closest && e.target.closest(".algo-tog"); if(!b) return;
  const d = document.getElementById(b.getAttribute("aria-controls")); d.open = !d.open;
  b.setAttribute("aria-expanded", d.open); b.textContent = d.open ? "看算法 ▴" : "看算法 ▾";
});

// 某天只有一場：不放日期標題，日期改寫在卡片第一行
const twKey = d => new Date(new Date(d).getTime() + 8*3600e3).toISOString().slice(0,10);
function dayCounts(ds){ const m = {}; for(const d of ds){ const k = twKey(d); m[k] = (m[k]||0) + 1; } return m; }
function cardTime(d, st){ const t = new Date(new Date(d).getTime() + 8*3600e3);
  return st && st.cnt && st.cnt[twKey(d)] === 1 ? `${t.getUTCMonth()+1}/${t.getUTCDate()}（${WD[t.getUTCDay()]}）${hhmm(d)}` : hhmm(d); }

// 第一行放不下時，信心標籤移到第二行中間
function ccFit(){ document.querySelectorAll(".cc-head").forEach(h => { if(!h.offsetParent) return; const r = h.querySelector(".cc-r1"); h.classList.remove("tight"); const t = r.scrollWidth > r.clientWidth + 1; h.classList.toggle("tight", t); }); }
addEventListener("resize", ccFit);
new MutationObserver(() => requestAnimationFrame(ccFit)).observe(document.documentElement, {childList:true, subtree:true});

// 命中率依信心分組（spec-accuracy-display §2）：只算正式紀錄、同版本、排除取消與剛好 50%
function confGroups(recs, isVer, cuts, lg){   // cuts: [中下限, 高下限]（看好方勝率，整數 %，與卡片信心標籤相同）
  const done = recs.filter(x => x.status !== "cancelled" && x.official && isVer(x) && x.correct !== null && x.correct !== undefined);
  const half = done.filter(x => x.official.homeWinProb === 0.5).length;
  const G = [["低", `未滿 <span class="num">${cuts[0]}%</span>`], ["中", `<span class="num">${cuts[0]}</span>～未滿 <span class="num">${cuts[1]}%</span>`], ["高", `<span class="num">${cuts[1]}%</span> 以上`]].map(([n, r]) => ({n, r, xs:[]}));
  for(const x of done){ const hp = x.official.homeWinProb; if(hp === 0.5) continue;
    const p = Math.max(hp, 1-hp), q = Math.round(p*100); G[q >= cuts[1] ? 2 : q >= cuts[0] ? 1 : 0].xs.push({p, ok:!!x.correct}); }
  const rows = G.map(g => { const n = g.xs.length, k = g.xs.filter(x => x.ok).length;
    const v = n >= 50 ? `平均預測 <span class="num">${Math.round(g.xs.reduce((a,x)=>a+x.p,0)/n*100)}%</span>｜實際 <span class="num">${Math.round(k/n*100)}%</span>（<span class="num">${k}/${n}</span> 場）` : `累積中（<span class="num">${n}</span> 場）`;
    return `<div class="cg-row"><span class="cg-l">信心 ${g.n}<span class="cg-r">${g.r}</span></span><span class="cg-v">${v}</span></div>`; }).join("");
  return `<div class="cg" id="cg-${lg}"><div class="cg-h">依信心分組（每組滿 <span class="num">50</span> 場才顯示命中率）</div>${rows}${half ? `<div class="cg-n">勝率剛好 <span class="num">50%</span> 的 <span class="num">${half}</span> 場不分組、不計命中率</div>` : ""}</div>`;
}

// 今日數據焦點（§25 修訂、spec-accuracy-display §3）：只看列表第一天；cands: [{i, fh(主隊勝率 0-1), key(季後賽關鍵戰), txt(系列賽句)}]
function pickFocus(cands){
  if(!cands.length) return null;
  const key = cands.filter(c => c.key);
  const c = (key.length ? key : cands).slice().sort((a,b) => Math.abs(a.fh-.5) - Math.abs(b.fh-.5))[0];
  const hp = Math.round(c.fh*100), ap = 100-hp;
  return {i:c.i, txt: c.txt || `本日勝率最接近（${ap}%：${hp}%）`};
}
