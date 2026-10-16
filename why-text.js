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
  spWait: "先發投手未公布，未調整",
  total: "合計 → {t} {p}%（約 {r}%）",
  // 參考數據（只寫事實，最多 4 列，固定順序）
  refBtn: "參考數據",
  refTitle: "參考數據（未計入勝率）",
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
  return `<details class="refd" data-lg="${lg}"><summary>${WHY_TXT.refBtn} ›</summary><div class="ref-t">${WHY_TXT.refTitle}</div><ul>${lines.map(x=>`<li>${x}</li>`).join("")}</ul></details>`;
}
// 展開時記一次 GoatCounter 事件
document.addEventListener("toggle", e => {
  const d = e.target; if(!d.classList || !d.classList.contains("refd") || !d.open) return;
  try{ if(window.goatcounter && window.goatcounter.count) window.goatcounter.count({path:`ref-open-${d.dataset.lg}`, title:"參考數據展開", event:true}); }catch(_){}
}, true);
