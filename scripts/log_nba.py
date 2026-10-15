# -*- coding: utf-8 -*-
# NBA 預測紀錄：開打前每小時記下預測（只記例行賽），開打後固定為正式預測，賽後補上結果。資料來源：ESPN 公開 JSON
import json, os, re, math, urllib.request
from datetime import datetime, timedelta, timezone

ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
ST = "https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?seasontype=2"
TZ = timezone(timedelta(hours=8))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "nba-predictions.json")
MODEL = "n1：勝率50%+畢氏(14)50%、拉回g/(g+5)、Log5、主場logit+0.221"
UA = {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"}
def get(u): return json.load(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=30))

js = open(os.path.join(ROOT, "nba.js"), encoding="utf-8").read()
ZH = dict(re.findall(r'(\w+):\["[^"]+","([^"]+)"\]', js))   # 縮寫 → 簡稱
tn = lambda t: ZH.get(t["abbreviation"], t.get("shortDisplayName") or t["displayName"])

# 與 nba.js 相同的模型
T = {}
for conf in get(ST)["children"]:
    for e in conf["standings"]["entries"]:
        s = {x["name"]: x.get("value") for x in e["stats"]}
        w, l = int(s.get("wins") or 0), int(s.get("losses") or 0)
        T[e["team"]["id"]] = dict(w=w, l=l, g=w + l, pf=s.get("pointsFor") or 0, pa=s.get("pointsAgainst") or 0)
def strength(t):
    if not t or not t["g"]: return 0.5
    py = t["pf"]**14 / (t["pf"]**14 + t["pa"]**14); r = 0.5*t["w"]/t["g"] + 0.5*py
    return 0.5 + (r - 0.5) * t["g"] / (t["g"] + 5)
def model(h, a):
    h, a = strength(T.get(h)), strength(T.get(a))
    q = (h - h*a) / (h + a - 2*h*a); q2 = 1/(1 + math.exp(-(math.log(q/(1-q)) + 0.221)))
    return round(q2, 4)

now = datetime.now(timezone.utc)
data = json.load(open(OUT, encoding="utf-8")) if os.path.exists(OUT) else {"records": []}
ORIG = json.dumps(data["records"], sort_keys=True, ensure_ascii=False)
recs = {r["id"]: r for r in data["records"]}
nowtw = lambda: datetime.now(TZ).strftime("%Y-%m-%d %H:%M") + " (UTC+8)"
evs = {}
for off in range(-3, 3):
    d = (now - timedelta(hours=5) + timedelta(days=off)).strftime("%Y%m%d")
    for e in get(f"{ESPN}/scoreboard?dates={d}").get("events", []): evs[e["id"]] = e
for e in evs.values():
    if e["season"]["type"] != 2: continue
    c = e["competitions"][0]; H = next(x for x in c["competitors"] if x["homeAway"] == "home"); A = next(x for x in c["competitors"] if x["homeAway"] == "away")
    start = datetime.fromisoformat(e["date"].replace("Z", "+00:00")); state = e["status"]["type"]["state"]
    r = recs.get(e["id"])
    if state == "pre" and now < start:
        if r is None:
            r = recs[e["id"]] = {"id": e["id"], "gameTime": start.astimezone(TZ).strftime("%Y-%m-%d %H:%M") + " (UTC+8)",
                "away": tn(A["team"]), "home": tn(H["team"]), "snapshots": [], "official": None,
                "predictedWinner": None, "final": None, "actualWinner": None, "correct": None}
        if r["official"] is None:
            p = model(H["team"]["id"], A["team"]["id"])
            if not r["snapshots"] or r["snapshots"][-1]["homeWinProb"] != p:
                r["snapshots"].append({"at": nowtw(), "model": MODEL, "homeWinProb": p,
                    "homeGames": T.get(H["team"]["id"], {}).get("g", 0), "awayGames": T.get(A["team"]["id"], {}).get("g", 0)})
    if r and r["official"] is None and (state != "pre" or now >= start) and r["snapshots"]:
        r["official"] = r["snapshots"][-1]
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
