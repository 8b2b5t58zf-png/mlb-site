# -*- coding: utf-8 -*-
# 賽後結算守候：GitHub 的定時排程常延遲好幾小時，所以改由這支程式「守著」比賽。
# 有 24 小時內要開打、或 12 小時內已開打但還沒結算的比賽，就每 10 分鐘看一次；
# 一看到官方比分 Final，就跑原本的 log_predictions.py（完整模式，邏輯不變）並提交。
# 單次最多守 5 小時 40 分（GitHub 上限 6 小時），還有比賽沒結算就自己再開下一輪接手。
import json, os, subprocess, sys, time, urllib.request
from datetime import datetime, timedelta, timezone
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TZ = timezone(timedelta(hours=8))
POLL, MAX = 600, 5*3600 + 40*60
T0 = time.time()
RUN_ID = int(os.environ.get("GITHUB_RUN_ID", "0") or 0)
CHAIN = os.environ.get("CHAIN") == "1"
WF = "mlb-settle.yml"

def sh(cmd, check=True): print("+", cmd, flush=True); return subprocess.run(cmd, shell=True, cwd=ROOT, check=check)
def out(cmd): return subprocess.run(cmd, shell=True, cwd=ROOT, capture_output=True, text=True).stdout.strip()
def log(*a): print(datetime.now(TZ).strftime("%m/%d %H:%M"), *a, flush=True)
def sync(): sh("git fetch -q origin main && git reset -q --hard origin/main")

def others():
    """比自己早開始、還在跑的守候（避免同時兩個在守）"""
    try:
        ids = json.loads(out(f"gh run list --workflow {WF} -L 20 --json databaseId,status") or "[]")
        return [r["databaseId"] for r in ids if r["status"] in ("in_progress", "queued") and r["databaseId"] < RUN_ID]
    except Exception as e: log("查詢其他守候失敗：", e); return []

def pending():
    now = datetime.now(TZ); res = []
    for r in json.load(open(os.path.join(ROOT, "data", "predictions.json"), encoding="utf-8"))["records"]:
        if r.get("final") or r.get("status") == "cancelled": continue
        t = datetime.strptime(r["gameTime"][:16], "%Y-%m-%d %H:%M").replace(tzinfo=TZ)
        if now - timedelta(hours=12) <= t <= now + timedelta(hours=24): res.append((r["gamePk"], t))
    return res

def finals(pks):
    d = json.load(urllib.request.urlopen("https://statsapi.mlb.com/api/v1/schedule?sportId=1&gamePks=" + ",".join(map(str, pks)), timeout=30))
    # 延賽的舊場次 API 也標 Final（同一個 gamePk 會出現兩次），要排除
    bad = ("Postponed", "Cancelled", "Suspended")
    return sorted({g["gamePk"] for dt in d.get("dates", []) for g in dt["games"]
                   if g["status"]["abstractGameState"] == "Final" and not g["status"].get("detailedState", "").startswith(bad)})

def settle():
    """每次都從最新的 repo 重新跑；推送失敗就丟掉本地結果重來（不做合併，避免衝突）"""
    for i in range(4):
        sync()
        sh("python3 scripts/log_predictions.py")
        sh("git add data/predictions.json")
        if subprocess.run("git diff --cached --quiet", shell=True, cwd=ROOT).returncode == 0: log("沒有變動"); return
        sh('git commit -q -m "賽後結算：MLB 預測紀錄"')
        if sh("git push -q origin HEAD:main", check=False).returncode == 0: log("已提交結算"); return
        time.sleep(20)
    log("推送失敗 4 次"); sys.exit(1)

if CHAIN:   # 上一輪剛交棒：等它結束（最多 3 分鐘）
    for _ in range(18):
        if not others(): break
        time.sleep(10)
elif others(): log("已有守候在跑，這次直接結束"); sys.exit(0)

while True:
    sync()
    p = pending()
    if not p: log("24 小時內沒有要守的比賽，結束"); break
    now = datetime.now(TZ)
    started = [pk for pk, t in p if t <= now]
    log("守候中：", [f"{pk} {t:%m/%d %H:%M}" for pk, t in p], "已開打：", started)
    if started:
        try: f = finals(started)
        except Exception as e: log("MLB API 失敗，下次再試：", e); f = []
        if f: log("已結束：", f); settle(); continue
    if time.time() - T0 + POLL > MAX:
        log("接近 6 小時上限，交棒給下一輪")
        sh(f"gh workflow run {WF} --ref main -f chain=1"); break
    time.sleep(POLL)
