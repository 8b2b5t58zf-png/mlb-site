"use strict";
// 預測焦點：兩聯盟、勝率方向、門檻、低信心、缺值、先發、延賽／取消／舊日、鎖定、平手、日界。
// 不讀寫 data/，也不改追蹤事件路徑。
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {execSync} = require("child_process");

const root = path.resolve(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");

function loadWhy(){
  const context = {
    console, Intl, URL,
    requestAnimationFrame(){},
    addEventListener(){},
    MutationObserver: class { observe(){} },
    document: {
      addEventListener(){},
      documentElement: {},
      fonts: {ready: Promise.resolve()},
      querySelectorAll(){ return []; },
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(read("why-text.js"), context, {filename:"why-text.js"});
  return context;
}

const W = loadWhy();
const {pickFocus, focusFavPct, focusIpEnough, ccCard} = W;
const twKey = d => vm.runInContext("twKey(" + JSON.stringify(d) + ")", W);
const MLB = [53, 60], NBA = [60, 70];
let n = 0, fail = 0;
function test(name, fn){
  n++;
  try{ fn(); }
  catch(e){ fail++; console.error("FAIL", name, e && e.message); }
}

function cand(over){
  return Object.assign({
    i:0, fh:0.62, day:"2026-11-10", status:"ok", starters:"both", sampleOk:true, inPlay:false, locked:false,
  }, over);
}
function run(cands, opts){
  return pickFocus(cands, Object.assign({cuts:MLB, today:"2026-11-10", day:"2026-11-10", needStarters:true}, opts));
}

test("日界：台灣日期以 UTC+8 切換", () => {
  assert.strictEqual(twKey("2026-11-10T15:59:00Z"), "2026-11-10");
  assert.strictEqual(twKey("2026-11-10T16:00:00Z"), "2026-11-11");
  assert.strictEqual(twKey("2026-11-10T15:59:59Z"), "2026-11-10");
});

test("先四捨五入到一位小數，再對中門檻，與卡片信心標籤同一側", () => {
  const band = (fh, cuts) => {
    const raw = focusFavPct(fh);
    if(raw == null) return "toss";
    return raw >= cuts[1] ? "strong" : raw >= cuts[0] ? "lean" : "toss";
  };
  const cases = [
    [0.5294, 52.9, "toss"],
    [0.5295, 53, "lean"],
    [0.53, 53, "lean"],
    [0.4705, 52.9, "toss"],
    [0.4704, 53, "lean"],
    [0.5994, 59.9, "lean"],
    [0.5995, 60, "strong"],
    [0.4005, 59.9, "lean"],
    [0.4004, 60, "strong"],
    [0.5, 50, "toss"],
  ];
  for(const [fh, raw, expect] of cases){
    assert.strictEqual(focusFavPct(fh), raw, String(fh));
    assert.strictEqual(band(fh, MLB), expect, String(fh));
    const got = run([cand({fh})]);
    if(expect === "toss") assert.strictEqual(got, null, String(fh));
    else assert.strictEqual(got.txt, expect === "strong" ? "預測信心高" : "預測信心中", String(fh));
  }
});

test("NBA 中門檻同樣先四捨五入", () => {
  const nba = [
    [0.5994, 59.9, null],
    [0.5995, 60, "預測信心中"],
    [0.6994, 69.9, "預測信心中"],
    [0.6995, 70, "預測信心高"],
    [0.3005, 69.9, "預測信心中"],
    [0.3004, 70, "預測信心高"],
  ];
  for(const [fh, raw, txt] of nba){
    assert.strictEqual(focusFavPct(fh), raw, String(fh));
    const got = run([cand({fh})], {cuts:NBA, needStarters:false});
    if(txt == null) assert.strictEqual(got, null, String(fh));
    else assert.strictEqual(got.txt, txt, String(fh));
  }
});

test("NBA 門檻 60／70，客隊高勝率也可", () => {
  assert.strictEqual(run([cand({fh:0.5994, starters:"partial"})], {cuts:NBA, needStarters:false}), null);
  assert.strictEqual(run([cand({fh:0.60, starters:"partial"})], {cuts:NBA, needStarters:false}).txt, "預測信心中");
  assert.strictEqual(run([cand({fh:0.6994})], {cuts:NBA, needStarters:false}).txt, "預測信心中");
  const away = run([
    cand({i:0, fh:0.62}),
    cand({i:1, fh:0.25}),
  ], {cuts:NBA, needStarters:false});
  assert.strictEqual(away.i, 1);
  assert.strictEqual(away.txt, "預測信心高");
  assert.strictEqual(away.q, 75);
});

test("勝率方向：客隊較高勝於主隊中等", () => {
  const r = run([
    cand({i:0, fh:0.58}),
    cand({i:1, fh:0.35}),
  ]);
  assert.strictEqual(r.i, 1);
  assert.strictEqual(r.txt, "預測信心高");
});

test("低信心整天不選，不挑最接近五成；客隊剛好達標仍可", () => {
  assert.strictEqual(run([
    cand({i:0, fh:0.51}),
    cand({i:1, fh:0.49}),
    cand({i:2, fh:0.48}),
  ]), null);
  assert.strictEqual(run([cand({fh:0.5})]), null);
  assert.strictEqual(run([cand({fh:0.40})]).txt, "預測信心高");
});

test("缺值與異常勝率不選，旁邊合格場仍可", () => {
  for(const fh of [null, undefined, NaN, Infinity, 0, 1, -0.2, 1.01, "0.8", ""]){
    assert.strictEqual(focusFavPct(fh), null, String(fh));
    assert.strictEqual(run([cand({fh})]), null, String(fh));
  }
  assert.strictEqual(run([cand({i:0, fh:null}), cand({i:1, fh:0.66})]).i, 1);
});

test("先發局數未滿 40 或沒有局數，不算資料完整", () => {
  assert.strictEqual(focusIpEnough(40), true);
  assert.strictEqual(focusIpEnough(40.1), true);
  assert.strictEqual(focusIpEnough(39.2), false);
  assert.strictEqual(focusIpEnough(0), false);
  assert.strictEqual(focusIpEnough(null), false);
  assert.strictEqual(focusIpEnough(undefined), false);
  assert.strictEqual(focusIpEnough(NaN), false);
  const app = read("app.js");
  assert.ok(app.includes("focusIpEnough(hpS && hpS.ip) && focusIpEnough(apS && apS.ip)"));
  assert.ok(app.includes("S.ip < 40"));
});

test("先發不全、樣本不足不選", () => {
  assert.strictEqual(run([cand({starters:"partial", fh:0.8})]), null);
  assert.strictEqual(run([cand({starters:"none", fh:0.8})]), null);
  assert.strictEqual(run([cand({starters:undefined, fh:0.8})]), null);
  assert.strictEqual(run([cand({sampleOk:false, fh:0.8})]), null);
  assert.strictEqual(run([cand({sampleOk:undefined, fh:0.8})]), null);
  const nba = run([cand({starters:"partial", fh:0.8, sampleOk:true})], {cuts:NBA, needStarters:false});
  assert.strictEqual(nba.txt, "預測信心高");
  assert.strictEqual(run([cand({starters:"partial", fh:0.8, sampleOk:false})], {cuts:NBA, needStarters:false}), null);
});

test("延賽、取消、保留不選", () => {
  for(const status of ["postponed", "cancelled", "suspended", "pp-pending", ""]){
    assert.strictEqual(run([cand({status, fh:0.8})]), null, status);
  }
  assert.strictEqual(run([
    cand({i:0, status:"postponed", fh:0.9}),
    cand({i:1, status:"ok", fh:0.56}),
  ]).i, 1);
});

test("舊日不選；下一個比賽日可以", () => {
  assert.strictEqual(run([cand({fh:0.8})], {day:"2026-11-09", today:"2026-11-10"}), null);
  assert.strictEqual(run([cand({day:"2026-11-09", fh:0.8})], {day:"2026-11-09", today:"2026-11-10"}), null);
  const next = run([cand({day:"2026-11-11", fh:0.64})], {day:"2026-11-11", today:"2026-11-10"});
  assert.strictEqual(next.i, 0);
  assert.strictEqual(run([
    cand({i:0, day:"2026-11-10", fh:0.55}),
    cand({i:1, day:"2026-11-11", fh:0.8}),
  ]).i, 0);
});

test("日界場次只跟所屬台灣日比較", () => {
  const late = "2026-11-10T15:59:00Z", early = "2026-11-10T16:00:00Z";
  assert.notStrictEqual(twKey(late), twKey(early));
  const r = run([
    cand({i:0, day:twKey(late), fh:0.55}),
    cand({i:1, day:twKey(early), fh:0.8}),
  ], {day:twKey(late), today:twKey(late)});
  assert.strictEqual(r.i, 0);
});

test("進行中沒有鎖定不選；有鎖定就用該勝率", () => {
  assert.strictEqual(run([cand({inPlay:true, locked:false, fh:0.9})]), null);
  const r = run([
    cand({i:0, inPlay:true, locked:false, fh:0.9}),
    cand({i:1, inPlay:true, locked:true, fh:0.62}),
  ]);
  assert.strictEqual(r.i, 1);
  assert.strictEqual(r.q, 62);
});

test("平手取索引較小者，不偏好主隊", () => {
  const same = run([
    cand({i:2, fh:0.70}),
    cand({i:1, fh:0.30}),
  ]);
  assert.strictEqual(same.i, 1);
  assert.strictEqual(same.q, 70);
  const earlier = run([
    cand({i:3, fh:0.62}),
    cand({i:0, fh:0.38}),
  ]);
  assert.strictEqual(earlier.i, 0);
});

test("不因賽果、關鍵戰或五五波改選", () => {
  const r = run([
    cand({i:0, fh:0.52, key:true, correct:true, final:"客 1 : 0 主", txt:"再贏一場晉級"}),
    cand({i:1, fh:0.66, key:false, correct:false, final:"客 0 : 8 主"}),
  ]);
  assert.strictEqual(r.i, 1);
  assert.strictEqual(r.txt, "預測信心高");
  assert.ok(!/五五|最接近|保證|穩/.test(r.txt));
});

test("已過列表、空候選、缺參數都不選", () => {
  assert.strictEqual(run([cand({fh:0.8})], {past:true}), null);
  assert.strictEqual(pickFocus([], {cuts:MLB, today:"2026-11-10", day:"2026-11-10"}), null);
  assert.strictEqual(pickFocus([cand()], null), null);
  assert.strictEqual(pickFocus([cand()], {}), null);
});

test("卡片徽章是預測焦點", () => {
  const html = ccCard({lg:"mlb", focus:"預測信心高", time:"11/10（二）20:08", A:"釀酒人", H:"道奇", conf:"高", tc:"strong", ap:"38", hp:"62", favHome:true, reason:"主因", body:""});
  assert.ok(html.includes("預測焦點"));
  assert.ok(html.includes("預測信心高"));
  assert.ok(!html.includes("數據焦點"));
  const plain = ccCard({lg:"nba", focus:"", time:"11/10（二）20:08", A:"塞爾提克", H:"尼克", conf:"低", tc:"toss", ap:"51", hp:"49", favHome:false, reason:"兩隊勝率接近", body:""});
  assert.ok(!plain.includes("預測焦點"));
  assert.ok(plain.includes("兩隊勝率接近"));
});

test("頁面接線沿用既有門檻，不再以距離 0.5 選場", () => {
  const app = read("app.js"), nba = read("nba.js"), why = read("why-text.js");
  assert.ok(app.includes("cuts:[53, 60]"));
  assert.ok(app.includes("needStarters:true"));
  assert.ok(app.includes('starterStatus === "both"'));
  assert.ok(nba.includes("cuts:[60, 70]"));
  assert.ok(nba.includes("needStarters:false"));
  assert.ok(nba.includes("th.g >= NM.minG && ta.g >= NM.minG"));
  assert.ok(!why.includes("Math.abs(a.fh"));
  assert.ok(!why.includes("數據焦點"));
  assert.ok(!app.includes("本日勝率最接近"));
  assert.ok(why.includes("預測焦點"));
});

test("可見文案不含禁用詞，也不把命中率寫成勝率", () => {
  const banned = /優勢|占優|看好|熱門|明牌|穩過|包牌|五五波|略占上風|數據焦點|爆冷/;
  for(const f of ["why-text.js", "app.js", "nba.js", "index.html"]){
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert.ok(!banned.test(src), f);
  }
  const app = read("app.js"), nba = read("nba.js");
  assert.ok(app.includes("MLB 版本2 命中率"));
  assert.ok(app.includes("不列入版本2 命中率"));
  assert.ok(nba.includes("NBA 目前版本命中率"));
  assert.ok(nba.includes("全部場次"));
  assert.ok(nba.includes("看各信心分級"));
  assert.ok(!nba.includes("計算方式"));
  assert.ok(!nba.includes("樣本少於"));
  assert.ok(!app.includes("MLB v2"));
  assert.ok(!app.includes("驗證過"));
  assert.ok(!read("index.html").includes("驗證過"));
  assert.ok(!nba.includes("舊版模型"));
  assert.ok(!app.includes("現行"));
  assert.ok(!app.includes("較早"));
});

test("追蹤事件與 LINE 網址未改", () => {
  const html = read("index.html");
  for(const s of [
    "https://lin.ee/n5vh3y9",
    "line-feedback-about",
    "line-feedback-footer",
    "line-feedback-float-predict",
    "https://aisportslab.goatcounter.com/count",
    "why-text.js?v=202611111816",
    "nba.js?v=202611111816",
    "app.js?v=202611111816",
    "style.css?v=202611111816",
    "賽前預測與賽後紀錄分開列出",
  ]) assert.ok(html.includes(s), s);
  assert.ok(read("why-text.js").includes("ref-open-"));
  assert.ok(read("why-text.js").includes("expand-"));
  assert.ok(read("nba.js").includes("hitrate-more-nba"));
  assert.ok(read("app.js").includes('path:key, title:`${LG_NOW.toUpperCase()} ${name}`'));
});

test("歷史回測公開檔只有結果，頁面沒有計算方式", () => {
  const raw = read("data/backtest.json");
  const d = JSON.parse(raw);
  assert.ok(!/rule|period|brier|blend|mlb_v2|version|看好|優勢|占優|公式/.test(raw));
  assert.strictEqual(d.mlb.season, "2026");
  assert.strictEqual(d.nba.season, "2025-26");
  assert.strictEqual(d.mlb.hit_pct, 58.2);
  assert.strictEqual(d.nba.hit_pct, 69.9);
  assert.strictEqual(d.mlb.tiers["高"].hit_pct, 63.7);
  assert.strictEqual(d.mlb.tiers["高"].n, 201);
  assert.strictEqual(d.mlb.tiers["中"].hit_pct, 59.2);
  assert.strictEqual(d.mlb.tiers["低"].hit_pct, 51.4);
  assert.strictEqual(d.mlb.tie50, 71);
  assert.strictEqual(d.nba.tiers["高"].hit_pct, 78.3);
  assert.strictEqual(d.nba.tiers["高"].n, 451);
  assert.strictEqual(d.nba.tiers["中"].hit_pct, 69.4);
  assert.strictEqual(d.nba.tiers["低"].hit_pct, 60.5);
  assert.strictEqual(d.nba.tie50, 19);
  const why = read("why-text.js");
  const note = "這是過去比賽的事後驗算，和本季正式紀錄分開列出、不合併。命中是指勝率超過五成的一方贏球；勝率剛好五成的場次不列入命中率。不是投注建議。";
  assert.ok(why.includes("歷史回測"));
  assert.ok(why.includes(note));
  assert.ok(why.includes("信心高的歷史回測命中率"));
  assert.ok(why.includes("7/1 起"));
  assert.ok(why.includes("含季中賽"));
  assert.ok(read("app.js").includes('histCard("mlb")'));
  assert.ok(read("nba.js").includes('histCard("nba")'));
  for(const f of ["why-text.js", "app.js", "nba.js", "index.html", "style.css"]) assert.ok(!read(f).includes("計算方式"), f);
});

test("這次差異不含資料、工作流程、腳本與部署設定", () => {
  const files = execSync("git status --porcelain=v1 -uall", {cwd:root, encoding:"utf8"}).trim().split("\n").filter(Boolean).map(l => {
    const m = l.match(/^[ MADRCU?!]{1,2} +(.*)$/);
    if(!m) throw new Error("無法解析 git status：" + [...l].map(c => c.charCodeAt(0)).join(",") + " " + JSON.stringify(l));
    return m[1].replace(/.* -> /, "");
  });
  const banned = /^(data\/(?!backtest\.json$)|\.github\/|scripts\/|vercel\.json|CNAME|sitemap\.xml|robots\.txt)/;
  const hit = files.filter(f => banned.test(f));
  assert.deepStrictEqual(hit, []);
});

if(fail){ console.error(fail + "/" + n + " failed"); process.exit(1); }
console.log(n + " passed");
