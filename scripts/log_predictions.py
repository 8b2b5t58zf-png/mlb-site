# -*- coding: utf-8 -*-
# 每日預測紀錄：比賽開打前記下預測，比賽結束後補上實際結果
# 規則：同一場比賽的預測一旦記錄就不再修改（避免事後諸葛）
import json, os, re, urllib.request
from datetime import datetime, timedelta, timezone

API = "https://statsapi.mlb.com/api/v1"
TZ = timezone(timedelta(hours=8))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "predictions.json")
MODEL = "v1：勝率50%+畢氏勝率50%、Log5、主場+4%"

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
def predict_home(h, a):
    h, a = strength(h), strength(a)
    return min(0.95, (h - h*a) / (h + a - 2*h*a) + 0.04)

data = json.load(open(OUT, encoding="utf-8")) if os.path.exists(OUT) else {"records": []}
recs = {r["gamePk"]: r for r in data["records"]}

d = get(f"/schedule?sportId=1&startDate={(now-timedelta(7)).date()}&endDate={(now+timedelta(2)).date()}")
added = filled = 0
for g in (x for dt in d.get("dates", []) for x in dt["games"]):
    pk, H, A = g["gamePk"], g["teams"]["home"], g["teams"]["away"]
    state = g["status"]["abstractGameState"]
    # 1) 尚未開打、且沒記錄過 → 記下預測
    if pk not in recs and state == "Preview" and H["team"]["id"] in TEAM and A["team"]["id"] in TEAM:
        p = round(predict_home(H["team"]["id"], A["team"]["id"]), 4)
        recs[pk] = {"gamePk": pk,
            "gameTime": datetime.fromisoformat(g["gameDate"].replace("Z", "+00:00")).astimezone(TZ).strftime("%Y-%m-%d %H:%M") + " (UTC+8)",
            "away": tn(A["team"]), "home": tn(H["team"]), "homeWinProb": p, "awayWinProb": round(1-p, 4),
            "predictedWinner": tn(H["team"]) if p >= 0.5 else tn(A["team"]),
            "model": MODEL, "predictedAt": datetime.now(TZ).strftime("%Y-%m-%d %H:%M") + " (UTC+8)",
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
