# -*- coding: utf-8 -*-
# 每小時把 ESPN NBA 公開資料存成網站內的檔案（data/nba/*.json），網頁先讀這些檔案，抓不到才直接連 ESPN。
# 每個檔案都有 fetched_at（ISO 8601，UTC）。某一項抓失敗就保留上一次的檔案，不覆蓋。
import json, os, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone

ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
ST = "https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?seasontype=2"
NLB = "https://site.web.api.espn.com/apis/site/v3/sports/basketball/nba/leaders?seasontype=2&limit=10&season="
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "nba")
UA = {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"}
os.makedirs(OUT, exist_ok=True)

def get(u):
    last = None
    for _ in range(3):
        try: return json.load(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=30))
        except Exception as e: last = e
    raise last
def save(name, payload):
    payload = {"fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), **payload}
    json.dump(payload, open(os.path.join(OUT, name), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("saved", name)
def job(name, fn):
    try: save(name, fn())
    except Exception as e: print("FAILED", name, e)   # 保留舊檔

# 只留網頁用得到的欄位，避免每小時提交大檔
TK = ("id", "abbreviation", "displayName", "shortDisplayName")
team = lambda t: {k: t.get(k) for k in TK}
def slim_ev(e):
    c = e["competitions"][0]
    return {"id": e["id"], "date": e["date"], "season": {"type": e["season"]["type"]},
            "status": {"type": {k: e["status"]["type"].get(k) for k in ("state", "completed", "name")}},
            "competitions": [{"competitors": [{"homeAway": x["homeAway"], "score": x.get("score"), "team": team(x["team"])} for x in c["competitors"]]}]}
def slim_sum(d):
    comp = d["header"]["competitions"][0]
    hdr = {"competitions": [{"competitors": [{"homeAway": x["homeAway"], "score": x.get("score"), "team": team(x["team"]),
            "linescores": [{"displayValue": l.get("displayValue")} for l in x.get("linescores", [])]} for x in comp["competitors"]]}]}
    pl = []
    for b in d.get("boxscore", {}).get("players", []):
        st = b["statistics"][0]
        pl.append({"team": {"id": b["team"]["id"]}, "statistics": [{"names": st.get("names"), "labels": st.get("labels"),
            "athletes": [{"athlete": {"displayName": a["athlete"]["displayName"]}, "stats": a.get("stats", [])} for a in st.get("athletes", [])]}]})
    return {"header": hdr, "boxscore": {"players": pl}}

now = datetime.now(timezone.utc)
us = lambda off: (now - timedelta(hours=5) + timedelta(days=off)).strftime("%Y%m%d")

def scoreboard():
    days = {}
    for off in range(-3, 4):
        d = us(off); days[d] = {"events": [slim_ev(e) for e in get(f"{ESPN}/scoreboard?dates={d}").get("events", [])]}
    # 例行賽開幕日（2026-27），開打前網頁要顯示開幕賽程
    for d in ["20261020", "20261021", "20261022"]:
        if d not in days and d >= us(0): days[d] = {"events": [slim_ev(e) for e in get(f"{ESPN}/scoreboard?dates={d}").get("events", [])]}
    return {"days": days}
def summaries():
    sb = json.load(open(os.path.join(OUT, "scoreboard.json"), encoding="utf-8"))
    evs = [e for v in sb["days"].values() for e in v.get("events", []) if e["status"]["type"]["completed"]]
    evs = sorted({e["id"]: e for e in evs}.values(), key=lambda e: e["date"], reverse=True)[:5]
    return {"games": {e["id"]: slim_sum(get(f"{ESPN}/summary?event={e['id']}")) for e in evs}}
def leaders():
    yr = now.year + 1 if now.month >= 9 else now.year
    out = {}
    # 某一季暫時抓不到（例如 ESPN 回 500）就沿用上一份存檔的那一季，不讓整個檔案停在舊時間；
    # 本季還沒開打時 ESPN 回 404，檔案照樣更新時間，網頁就知道「剛確認過、本季還沒有排行」，不必再連 ESPN
    try: old = json.load(open(os.path.join(OUT, "leaders.json"), encoding="utf-8")).get("seasons", {})
    except Exception: old = {}
    for y in (yr, yr - 1):
        try:
            d = get(NLB + str(y)); L = d.get("leaders") or {}
            cats = [{"name": c["name"], "leaders": [{"displayValue": l.get("displayValue"), "athlete": {"displayName": l["athlete"]["displayName"]},
                     "team": {k: (l.get("team") or {}).get(k) for k in ("abbreviation", "displayName", "shortDisplayName")} if l.get("team") else None}
                     for l in c.get("leaders", [])[:10]]}
                    for c in L.get("categories", []) if c["name"] in ("pointsPerGame", "reboundsPerGame", "assistsPerGame")]
            out[str(y)] = {"requestedSeason": d.get("requestedSeason"), "leaders": {"categories": cats}}
        except Exception as e:
            print("leaders", y, e)
            if str(y) in old and not (isinstance(e, urllib.error.HTTPError) and e.code == 404): out[str(y)] = old[str(y)]; print("leaders", y, "沿用舊檔")
    if not out: raise RuntimeError("no leaders")
    return {"seasons": out}

job("scoreboard.json", scoreboard)
def standings():
    d = get(ST)
    return {"data": {"children": [{"name": c["name"], "standings": {"entries": [{"team": team(e["team"]),
        "stats": [{k: x.get(k) for k in ("name", "value", "displayValue")} for x in e["stats"]]} for e in c["standings"]["entries"]]}} for c in d["children"]]}}
def injuries():
    d = get(f"{ESPN}/injuries")
    return {"data": {"injuries": [{"id": t["id"], "injuries": [{"status": i.get("status"), "athlete": {"displayName": i["athlete"]["displayName"]}}
        for i in t.get("injuries", [])]} for t in d.get("injuries", [])]}}
job("standings.json", standings)
job("injuries.json", injuries)
job("leaders.json", leaders)
job("summaries.json", summaries)
