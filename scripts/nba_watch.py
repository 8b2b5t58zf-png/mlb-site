# -*- coding: utf-8 -*-
# NBA 賽程守候：照當天實際賽程跑，不寫死時段。
# 從第一場開打前 60 分鐘起，到最後一場開打後 5.5 小時（約比賽結束後 3 小時），每 30 分鐘跑一次
# fetch_nba.py + log_nba.py 並提交；每場開打前 45 分鐘左右會多跑一次，確保在開打前鎖定正式預測。
# 單次最多 5 小時 40 分，窗口還沒結束就自己再開下一輪接手。原本 nba-log.yml 的每日排程保留不動。
import json, os, subprocess, sys, time
from datetime import datetime, timedelta, timezone
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TZ = timezone(timedelta(hours=8))
STEP, PRE, POST, MAX = 1800, timedelta(minutes=60), timedelta(hours=5, minutes=30), 5*3600 + 40*60
T0 = time.time()
RUN_ID = int(os.environ.get("GITHUB_RUN_ID", "0") or 0)
CHAIN = os.environ.get("CHAIN") == "1"
WF = "nba-watch.yml"

def sh(cmd, check=True): print("+", cmd, flush=True); return subprocess.run(cmd, shell=True, cwd=ROOT, check=check)
def out(cmd): return subprocess.run(cmd, shell=True, cwd=ROOT, capture_output=True, text=True).stdout.strip()
def log(*a): print(datetime.now(TZ).strftime("%m/%d %H:%M"), *a, flush=True)
def sync(): sh("git fetch -q origin main && git reset -q --hard origin/main")

def others():
    try:
        ids = json.loads(out(f"gh run list --workflow {WF} -L 20 --json databaseId,status") or "[]")
        return [r["databaseId"] for r in ids if r["status"] in ("in_progress", "queued") and r["databaseId"] < RUN_ID]
    except Exception as e: log("查詢其他守候失敗：", e); return []

def times():
    res = []
    for r in json.load(open(os.path.join(ROOT, "data", "nba-predictions.json"), encoding="utf-8"))["records"]:
        if r.get("final"): continue
        res.append((datetime.strptime(r["gameTime"][:16], "%Y-%m-%d %H:%M").replace(tzinfo=TZ), r["official"] is None))
    return res

def in_window(now, ts): return any(t - PRE <= now <= t + POST for t, _ in ts)

def next_wake(now, ts):
    """下一次要跑的時間：30 分鐘後，或下一場還沒鎖定的比賽開打前 45 分鐘（取較早者）"""
    w = now + timedelta(seconds=STEP)
    for t, unlocked in ts:
        k = t - timedelta(minutes=45)
        if unlocked and now < k < w: w = k
    return w

def update():
    for i in range(4):
        sync()
        sh("python3 scripts/fetch_nba.py", check=False)
        sh("python3 scripts/log_nba.py")
        sh("git add data/nba-predictions.json data/nba")
        if subprocess.run("git diff --cached --quiet", shell=True, cwd=ROOT).returncode == 0: log("沒有變動"); return
        sh('git commit -q -m "更新 NBA 資料與預測紀錄（賽程守候）"')
        if sh("git push -q origin HEAD:main", check=False).returncode == 0: log("已提交"); return
        time.sleep(20)
    log("推送失敗 4 次")

if __name__ == "__main__":
    if CHAIN:
        for _ in range(18):
            if not others(): break
            time.sleep(10)
    elif others(): log("已有守候在跑，這次直接結束"); sys.exit(0)
    while True:
        sync(); now = datetime.now(TZ); ts = times()
        if in_window(now, ts): update(); ts = times()
        now = datetime.now(TZ); w = next_wake(now, ts)
        if not in_window(w, ts) and not in_window(w + timedelta(minutes=40), ts):
            # GitHub 排程常延遲或漏跑（10/22 05:12、05:42 都沒叫醒），所以 3 小時內有比賽時段就自己等到時段開始，不靠下一次排程
            st = [t - PRE for t, _ in ts if t - PRE > now]
            if st and min(st) - now <= timedelta(hours=3) and time.time() - T0 + (min(st) - now).total_seconds() < MAX - 3600:
                w = min(st); log("等比賽時段開始：", w.strftime("%m/%d %H:%M")); time.sleep(max(0, (w - now).total_seconds())); continue
            log("接下來沒有在比賽時段內，結束（下次由排程叫醒）"); break
        if time.time() - T0 + (w - now).total_seconds() > MAX:
            log("接近 6 小時上限，交棒給下一輪"); sh(f"gh workflow run {WF} --ref main -f chain=1"); break
        log("下次檢查：", w.strftime("%m/%d %H:%M")); time.sleep(max(0, (w - now).total_seconds()))
