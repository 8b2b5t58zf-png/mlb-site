# 15 分鐘輕量檢查（盡量不打 API）：
# 1) 先只看存檔：有沒有「還沒開打、4 小時內開打、兩隊先發還沒都公布」的比賽；沒有就直接結束（0 次連線）
# 2) 有的話，只用 1 次 schedule 查這幾場的先發；跟存檔最後一筆不同才輸出場次，讓 workflow 跑完整紀錄（只更新這幾場）
import json, os, sys, urllib.request
from datetime import datetime, timedelta, timezone
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TZ = timezone(timedelta(hours=8)); now = datetime.now(timezone.utc)
out = os.environ.get("GITHUB_OUTPUT")
def emit(pks):
    if out: open(out, "a").write(f"pks={','.join(map(str, pks))}\n")
    print("需要更新：", pks or "無")
recs = json.load(open(os.path.join(ROOT, "data", "predictions.json"), encoding="utf-8"))["records"]
cand = {}
for r in recs:
    if r.get("official") or not r.get("snapshots"): continue
    t = datetime.strptime(r["gameTime"][:16], "%Y-%m-%d %H:%M").replace(tzinfo=TZ)
    last = r["snapshots"][-1]
    if now < t <= now + timedelta(hours=4) and last.get("starterStatus") != "both": cand[r["gamePk"]] = last
if not cand: emit([]); sys.exit(0)
d = json.load(urllib.request.urlopen("https://statsapi.mlb.com/api/v1/schedule?sportId=1&gamePks=" + ",".join(map(str, cand)) + "&hydrate=probablePitcher", timeout=30))
need = []
for g in (x for dt in d.get("dates", []) for x in dt["games"]):
    last = cand.get(g["gamePk"]); 
    if last is None: continue
    ids = lambda s: ((g["teams"][s].get("probablePitcher") or {}).get("id"))
    old = lambda s: ((last.get(s + "Starter") or {}).get("id"))
    if ids("home") != old("home") or ids("away") != old("away") or g["gameDate"] != datetime.strptime(next(r for r in recs if r["gamePk"]==g["gamePk"])["gameTime"][:16], "%Y-%m-%d %H:%M").replace(tzinfo=TZ).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"):
        need.append(g["gamePk"])
emit(need)
