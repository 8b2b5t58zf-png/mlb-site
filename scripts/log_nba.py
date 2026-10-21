# -*- coding: utf-8 -*-
# NBA 預測紀錄：開打前每小時記下預測（只記例行賽），開打後固定為正式預測，賽後補上結果。資料來源：ESPN 公開 JSON
import json, os, re, math, urllib.request
from datetime import datetime, timedelta, timezone

ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
ST = "https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?seasontype=2"
TZ = timezone(timedelta(hours=8))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "nba-predictions.json")
MODEL = "blend_v1"   # 上季畢氏(14)拉回×0.6 混本季（勝率50%+畢氏50%），w=g/(g+10)；Log5 夾1~99%；主場logit+0.221
UA = {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"}
def get(u): return json.load(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=30))

js = open(os.path.join(ROOT, "nba.js"), encoding="utf-8").read()
ZH = dict(re.findall(r'(\w+):\["[^"]+","([^"]+)"\]', js))   # 縮寫 → 簡稱
tn = lambda t: ZH.get(t["abbreviation"], t.get("shortDisplayName") or t["displayName"])

# 優先用排程剛存的 data/nba/*.json（fetch_nba.py），沒有才直接抓 ESPN；記下所用戰績的抓取時間
NBA_DIR = os.path.join(ROOT, "data", "nba")
def saved(name):
    try: return json.load(open(os.path.join(NBA_DIR, name), encoding="utf-8"))
    except Exception: return None
_st = saved("standings.json")
if _st: ST_DATA, ST_AT = _st["data"], _st["fetched_at"]
else: ST_DATA, ST_AT = get(ST), datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
_sb = saved("scoreboard.json")

# 與 nba.js 相同的模型
T = {}
for conf in ST_DATA["children"]:
    for e in conf["standings"]["entries"]:
        s = {x["name"]: x.get("value") for x in e["stats"]}
        w, l = int(s.get("wins") or 0), int(s.get("losses") or 0)
        T[e["team"]["id"]] = dict(w=w, l=l, g=w + l, pf=s.get("pointsFor") or 0, pa=s.get("pointsAgainst") or 0)
PRIOR = {k: 0.5 + (v["prior_pyth"] - 0.5) * 0.6 for k, v in saved("prior_2526.json")["teams"].items()}
def strength(t, tid):
    pr = PRIOR.get(tid, 0.5)
    if not t or not t["g"]: return pr
    py = t["pf"]**14 / (t["pf"]**14 + t["pa"]**14); cur = 0.5*t["w"]/t["g"] + 0.5*py; w = t["g"] / (t["g"] + 10)
    return w*cur + (1 - w)*pr
def model(h, a, neutral=False):
    h, a = strength(T.get(h), h), strength(T.get(a), a)
    q = min(0.99, max(0.01, (h - h*a) / (h + a - 2*h*a))); q2 = 1/(1 + math.exp(-(math.log(q/(1-q)) + (0 if neutral else 0.221))))
    return round(q2, 4)

now = datetime.fromisoformat(os.environ["NBA_NOW"]) if os.environ.get("NBA_NOW") else datetime.now(timezone.utc)   # NBA_NOW 只供本機測試
LOCK = timedelta(minutes=60)
data = json.load(open(OUT, encoding="utf-8")) if os.path.exists(OUT) else {"records": []}
ORIG = json.dumps(data["records"], sort_keys=True, ensure_ascii=False)
recs = {r["id"]: r for r in data["records"]}
nowtw = lambda: now.astimezone(TZ).strftime("%Y-%m-%d %H:%M") + " (UTC+8)"
evs = {}
for off in range(-3, 3):
    d = (now - timedelta(hours=5) + timedelta(days=off)).strftime("%Y%m%d")
    day = (_sb or {}).get("days", {}).get(d) or get(f"{ESPN}/scoreboard?dates={d}")
    for e in day.get("events", []): evs[e["id"]] = e
for e in evs.values():
    if e["season"]["type"] != 2: continue
    c = e["competitions"][0]; H = next(x for x in c["competitors"] if x["homeAway"] == "home"); A = next(x for x in c["competitors"] if x["homeAway"] == "away")
    if any(not x["team"].get("id") or str(x["team"]["id"]) in ("0", "-1") or x["team"].get("abbreviation") == "TBD" for x in (H, A)): continue   # 對戰未定不預測
    start = datetime.fromisoformat(e["date"].replace("Z", "+00:00")); state = e["status"]["type"]["state"]
    r = recs.get(e["id"])
    if state == "pre" and now < start:
        if r is None:
            r = recs[e["id"]] = {"id": e["id"], "gameTime": start.astimezone(TZ).strftime("%Y-%m-%d %H:%M") + " (UTC+8)",
                "away": tn(A["team"]), "home": tn(H["team"]), "snapshots": [], "official": None,
                "predictedWinner": None, "final": None, "actualWinner": None, "correct": None}
        if r["official"] is None:
            p = model(H["team"]["id"], A["team"]["id"], c.get("neutralSite", False))
            r["latestStandingsAt"] = ST_AT   # 開打前最後一次所用戰績的抓取時間
            if not r["snapshots"] or r["snapshots"][-1]["homeWinProb"] != p:
                r["snapshots"].append({"at": nowtw(), "model": MODEL, "homeWinProb": p, "standingsFetchedAt": ST_AT,
                    "homeGames": T.get(H["team"]["id"], {}).get("g", 0), "awayGames": T.get(A["team"]["id"], {}).get("g", 0)})
    # 開打前 60 分鐘內鎖定正式預測（at＝實際鎖定時間，早於開打）；已有 official 永不改寫
    if r and r["official"] is None and r["snapshots"] and state == "pre" and start - LOCK <= now < start:
        sn = r["snapshots"][-1]
        r["official"] = {**sn, "at": nowtw(), "snapshotAt": sn["at"], "standingsFetchedAt": r.get("latestStandingsAt") or sn.get("standingsFetchedAt")}
        r["predictedWinner"] = r["home"] if r["official"]["homeWinProb"] >= 0.5 else r["away"]
    # 保險：開打前沒跑到（排程延遲），開打後才用開賽前最後一份快照補上（at 保留快照時間）
    if r and r["official"] is None and (state != "pre" or now >= start) and r["snapshots"]:
        r["official"] = {**r["snapshots"][-1], "standingsFetchedAt": r.get("latestStandingsAt") or r["snapshots"][-1].get("standingsFetchedAt")}
        r["predictedWinner"] = r["home"] if r["official"]["homeWinProb"] >= 0.5 else r["away"]
    if r and r["official"] and r["final"] is None and e["status"]["type"]["completed"]:
        hs, as_ = int(H["score"]), int(A["score"])
        if hs != as_:
            r["final"] = f'{r["away"]} {as_} : {hs} {r["home"]}'
            r["actualWinner"] = r["home"] if hs > as_ else r["away"]
            r["correct"] = r["actualWinner"] == r["predictedWinner"]
new = {"records": sorted(recs.values(), key=lambda r: r["gameTime"])}
if json.dumps(new["records"], sort_keys=True, ensure_ascii=False) != ORIG or "updated" not in data:
    json.dump({"updated": nowtw(), **new}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"NBA 紀錄共 {len(recs)} 場")
