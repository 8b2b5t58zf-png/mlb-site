# -*- coding: utf-8 -*-
# 每日預測紀錄：比賽開打前記下預測，比賽結束後補上實際結果
# 規則：同一場比賽的預測一旦記錄就不再修改（避免事後諸葛）
import json, os, re, urllib.request
from datetime import datetime, timedelta, timezone

API = "https://statsapi.mlb.com/api/v1"
TZ = timezone(timedelta(hours=8))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "predictions.json")
MODEL = "v2：Log5縮回(0.250)、主場+0.082、先發ERA×0.137+WHIP×0.606（拉回40局）"

def get(p): return json.load(urllib.request.urlopen(API + p, timeout=30))

# 中文隊名：讀網頁的 app.js 對照表
app = open(os.path.join(ROOT, "app.js"), encoding="utf-8").read()
ZH = {int(i): f for i, f, s in re.findall(r'(\d+):\["([^"]+)","([^"]+)"\]', app)}
tn = lambda t: ZH.get(t["id"], t["name"])

# 與 app.js 相同的模型
def pyth(rs, ra): return rs**1.83 / (rs**1.83 + ra**1.83)
now = datetime.now(timezone.utc)
season = now.year
st = get(f"/standings?leagueId=103,104&season={season}&standingsTypes=regularSeason")
if not st.get("records"): season -= 1; st = get(f"/standings?leagueId=103,104&season={season}&standingsTypes=regularSeason")
TEAM = {t["team"]["id"]: t for r in st["records"] for t in r["teamRecords"]}
def strength(i): t = TEAM[i]; return 0.5*float(t["winningPercentage"]) + 0.5*pyth(t["runsScored"], t["runsAllowed"])
import math
LG_ERA, LG_WHIP, REG = 4.20, 1.30, 40
sig = lambda x: 1/(1+math.exp(-x))
def ip_num(s): a, _, b = str(s).partition("."); return int(a) + (int(b) if b else 0)/3
PST = {}
def pitcher(pid):
    """先發投手本季成績（有轉隊就加總）"""
    if pid in PST: return PST[pid]
    d = get(f"/people/{pid}/stats?stats=season&group=pitching&season={season}")
    sp = d["stats"][0]["splits"] if d.get("stats") else []
    tot = [x for x in sp if "team" not in x] or sp
    s = dict(gs=0, ip=0.0, er=0, h=0, bb=0)
    for x in tot:
        t = x["stat"]; s["gs"] += t.get("gamesStarted", 0); s["ip"] += ip_num(t.get("inningsPitched", 0))
        s["er"] += t.get("earnedRuns", 0); s["h"] += t.get("hits", 0); s["bb"] += t.get("baseOnBalls", 0)
    PST[pid] = s; return s
def model_v2(h, a, hp, ap):
    """與 app.js modelV2 相同；回傳主隊勝率與三步驟（一位小數，加總等於最終）"""
    sh, sa = strength(h), strength(a)
    p = (sh - sh*sa) / (sh + sa - 2*sh*sa)
    xb = 0.250*math.log(p/(1-p))
    used = bool(hp and ap)   # 出賽少的投手已往聯盟平均拉回
    rera = lambda s: (9*s["er"] + LG_ERA*REG)/(s["ip"] + REG)
    rwhip = lambda s: (s["h"] + s["bb"] + LG_WHIP*REG)/(s["ip"] + REG)
    xs = 0.137*(rera(ap)-rera(hp)) + 0.606*(rwhip(ap)-rwhip(hp)) if used else 0
    # 依序計算（主隊角度）：起點 50% → 戰績 → 主場 → 先發，一位小數加總等於最終
    R1, R2, F = (round(sig(v)*1000) for v in (xb, xb+0.082, xb+0.082+xs))
    return sig(xb+0.082+xs), {"start": 50.0, "standings": (R1-500)/10, "home": (R2-R1)/10, "starter": (F-R2)/10, "final": F/10, "starterUsed": used}

data = json.load(open(OUT, encoding="utf-8")) if os.path.exists(OUT) else {"records": []}
recs = {r["gamePk"]: r for r in data["records"]}

d = get(f"/schedule?sportId=1&startDate={(now-timedelta(7)).date()}&endDate={(now+timedelta(2)).date()}&hydrate=probablePitcher")
added = filled = 0
for g in (x for dt in d.get("dates", []) for x in dt["games"]):
    pk, H, A = g["gamePk"], g["teams"]["home"], g["teams"]["away"]
    state = g["status"]["abstractGameState"]
    # 1) 尚未開打、且沒記錄過 → 記下預測
    if pk not in recs and state == "Preview" and H["team"]["id"] in TEAM and A["team"]["id"] in TEAM:
        hp = pitcher(H["probablePitcher"]["id"]) if H.get("probablePitcher") else None
        ap = pitcher(A["probablePitcher"]["id"]) if A.get("probablePitcher") else None
        p, steps = model_v2(H["team"]["id"], A["team"]["id"], hp, ap)
        p = round(p, 4)
        recs[pk] = {"gamePk": pk,
            "gameTime": datetime.fromisoformat(g["gameDate"].replace("Z", "+00:00")).astimezone(TZ).strftime("%Y-%m-%d %H:%M") + " (UTC+8)",
            "away": tn(A["team"]), "home": tn(H["team"]), "homeWinProb": p, "awayWinProb": round(1-p, 4),
            "predictedWinner": tn(H["team"]) if p >= 0.5 else tn(A["team"]),
            "model": MODEL, "steps": steps,
            "homeStarter": H.get("probablePitcher", {}).get("fullName"), "awayStarter": A.get("probablePitcher", {}).get("fullName"), "predictedAt": datetime.now(TZ).strftime("%Y-%m-%d %H:%M") + " (UTC+8)",
            "final": None, "actualWinner": None, "correct": None}
        added += 1
    # 2) 已記錄、已結束、還沒填結果 → 補實際結果（只填結果欄位，預測欄位不動）
    r = recs.get(pk)
    if r and r["final"] is None and state == "Final" and "score" in H and H["score"] != A["score"]:
        r["final"] = f'{r["away"]} {A["score"]} : {H["score"]} {r["home"]}'
        r["actualWinner"] = r["home"] if H["score"] > A["score"] else r["away"]
        r["correct"] = r["actualWinner"] == r["predictedWinner"]
        filled += 1

data = {"updated": datetime.now(TZ).strftime("%Y-%m-%d %H:%M") + " (UTC+8)",
        "records": sorted(recs.values(), key=lambda r: r["gameTime"])}
json.dump(data, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"新增預測 {added} 筆、補上結果 {filled} 筆、總共 {len(recs)} 筆")
