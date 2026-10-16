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
ORIG = json.dumps(data.get("records", []), sort_keys=True, ensure_ascii=False)   # 原始內容，用來判斷有沒有變動
recs = {r["gamePk"]: r for r in data["records"]}
nowtw = lambda: datetime.now(TZ).strftime("%Y-%m-%d %H:%M") + " (UTC+8)"

# 舊版 v1 紀錄：原欄位一律不動，只補上 snapshots 與 official（就是當時那筆預測）
for r in recs.values():
    if "snapshots" not in r:
        snap = {k: r.get(k) for k in ("predictedAt", "homeWinProb", "awayWinProb", "model")}
        snap["at"] = snap.pop("predictedAt")
        r["snapshots"] = [snap]; r["official"] = dict(snap, note="v1 舊紀錄，視為正式預測")

ONLY = os.environ.get("ONLY_PKS", "").strip()   # 15 分鐘輕量檢查發現先發有變時，只更新這幾場
d = get(f"/schedule?sportId=1&gamePks={ONLY}&hydrate=probablePitcher") if ONLY else get(f"/schedule?sportId=1&startDate={(now-timedelta(7)).date()}&endDate={(now+timedelta(7)).date()}&hydrate=probablePitcher")
added = snaps = frozen = filled = unfrozen = 0
# 取消：完整模式下，排程範圍內、從未開打（沒有結果）的紀錄，賽程查不到這場 → 再單場確認一次，查不到就標 cancelled（快照保留）
SEEN = {x["gamePk"] for dt in d.get("dates", []) for x in dt["games"]}
cancelled = 0
if not ONLY:
    lo, hi = (now-timedelta(7)).astimezone(TZ).strftime("%Y-%m-%d"), (now+timedelta(7)).astimezone(TZ).strftime("%Y-%m-%d")
    for r in recs.values():
        if r["gamePk"] in SEEN or r.get("final") or r.get("status") == "cancelled" or not (lo <= r["gameTime"][:10] <= hi): continue
        if not get(f"/schedule?sportId=1&gamePk={r['gamePk']}").get("dates"):
            r["status"] = "cancelled"; cancelled += 1
for g in (x for dt in d.get("dates", []) for x in dt["games"]):
    pk, H, A = g["gamePk"], g["teams"]["home"], g["teams"]["away"]
    state = g["status"]["abstractGameState"]
    ppd = g["status"].get("detailedState", "").startswith("Postponed")   # 延賽：API 可能標 Final，但其實沒開打，不能鎖
    start = datetime.fromisoformat(g["gameDate"].replace("Z", "+00:00"))
    r = recs.get(pk)
    # 0) 依 API 目前的開賽時間：還沒開打就不能鎖定（解除過早的正式紀錄，舊快照留著當歷史）；賽程改期就更新時間
    if r is not None and ((state == "Preview" and now < start) or ppd):
        gt = start.astimezone(TZ).strftime("%Y-%m-%d %H:%M") + " (UTC+8)"
        if r.get("gameTime") != gt: r["gameTime"], r["date"] = gt, start.astimezone(TZ).strftime("%Y-%m-%d")
        if r.get("official") is not None:
            r["official"] = None; r["predictedWinner"] = None; unfrozen += 1
    # 1) 尚未開打：記一筆快照（只往後加，不覆蓋；和上一筆相同就不重複記）
    if state == "Preview" and now < start and H["team"]["id"] in TEAM and A["team"]["id"] in TEAM:
        if r is None:
            r = recs[pk] = {"gamePk": pk, "date": start.astimezone(TZ).strftime("%Y-%m-%d"),
                "gameTime": start.astimezone(TZ).strftime("%Y-%m-%d %H:%M") + " (UTC+8)",
                "away": tn(A["team"]), "home": tn(H["team"]), "snapshots": [], "official": None,
                "predictedWinner": None, "final": None, "actualWinner": None, "correct": None}
            added += 1
        if r.get("official") is None:
            hpp, app_ = H.get("probablePitcher"), A.get("probablePitcher")
            hp = pitcher(hpp["id"]) if hpp else None
            ap = pitcher(app_["id"]) if app_ else None
            p, st = model_v2(H["team"]["id"], A["team"]["id"], hp, ap)
            snap = {"at": nowtw(), "model": MODEL, "homeWinProb": round(p, 4),
                    "steps": {"standings": st["standings"], "home": st["home"], "starter": st["starter"]},
                    "starterUsed": st["starterUsed"],
                    "starterStatus": "both" if (hpp and app_) else "partial" if (hpp or app_) else "none",
                    "hasStarters": bool(hpp and app_),   # 相容舊欄位：兩隊都公布才是 true
                    "homeStarter": hpp and {"id": hpp["id"], "name": hpp["fullName"]},
                    "awayStarter": app_ and {"id": app_["id"], "name": app_["fullName"]}}
            last = r["snapshots"][-1] if r["snapshots"] else None
            if not last or {k: v for k, v in last.items() if k != "at"} != {k: v for k, v in snap.items() if k != "at"}:
                r["snapshots"].append(snap); snaps += 1
    # 2) 已開打：正式預測＝開打前最後一筆快照（固定後不再改）
    # 鎖定條件：依本次 API 的 gameDate；比賽進行中／結束，或已過開賽時間（延賽不鎖）
    if r and r.get("official") is None and not ppd and (state in ("Live", "Final") or now >= start) and r["snapshots"]:
        r["official"] = r["snapshots"][-1]
        r["predictedWinner"] = r["home"] if r["official"]["homeWinProb"] >= 0.5 else r["away"]
        frozen += 1
    # 3) 已結束：補實際結果（只填結果欄位）
    if r and r.get("official") and r["final"] is None and state == "Final" and "score" in H and H["score"] != A["score"]:
        r["final"] = f'{r["away"]} {A["score"]} : {H["score"]} {r["home"]}'
        r["homeScore"], r["awayScore"] = H["score"], A["score"]
        r["actualWinner"] = r["home"] if H["score"] > A["score"] else r["away"]
        r["correct"] = r["actualWinner"] == r["predictedWinner"]
        filled += 1

new = {"records": sorted(recs.values(), key=lambda r: r["gameTime"])}
# 有資料變動才更新時間並寫檔（避免每小時都產生沒意義的 commit）
if json.dumps(new["records"], sort_keys=True, ensure_ascii=False) != ORIG or "updated" not in data:
    new = {"updated": nowtw(), **new}
    json.dump(new, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"新比賽 {added}、新快照 {snaps}、固定正式預測 {frozen}、補上結果 {filled}、解除過早鎖定 {unfrozen}、取消 {cancelled}；總共 {len(recs)} 場")
