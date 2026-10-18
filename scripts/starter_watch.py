# -*- coding: utf-8 -*-
# 先發守候：GitHub 的 15 分鐘排程常延遲 2–5 小時，所以改由這支程式守著。
# 有 24 小時內要開打、還沒鎖定正式預測的比賽，就每 12 分鐘看一次：
#   只看 6 小時內開打的場次，用 1 次 schedule 查先發與開賽時間；跟存檔最後一筆快照不同，
#   才跑原本的 log_predictions.py（ONLY_PKS 只更新那幾場；快照規則不變）並提交。
# 單次最多守 5 小時 40 分（GitHub 上限 6 小時），還有比賽要守就自己再開下一輪接手。
import json, os, subprocess, sys, time, urllib.request
from datetime import datetime, timedelta, timezone
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TZ = timezone(timedelta(hours=8))
POLL, MAX, NEAR = 720, 5*3600 + 40*60, timedelta(hours=6)
T0 = time.time()
RUN_ID = int(os.environ.get("GITHUB_RUN_ID", "0") or 0)
CHAIN = os.environ.get("CHAIN") == "1"
WF = "mlb-light.yml"

def sh(cmd, check=True, env=None): print("+", cmd, flush=True); return subprocess.run(cmd, shell=True, cwd=ROOT, check=check, env=env)
def out(cmd): return subprocess.run(cmd, shell=True, cwd=ROOT, capture_output=True, text=True).stdout.strip()
def log(*a): print(datetime.now(TZ).strftime("%m/%d %H:%M"), *a, flush=True)
def sync(): sh("git fetch -q origin main && git reset -q --hard origin/main")
def gt(r): return datetime.strptime(r["gameTime"][:16], "%Y-%m-%d %H:%M").replace(tzinfo=TZ)

def others():
    try:
        rs = json.loads(out(f"gh run list --workflow {WF} -L 20 --json databaseId,status") or "[]")
        return [r["databaseId"] for r in rs if r["status"] in ("in_progress", "queued") and r["databaseId"] < RUN_ID]
    except Exception as e: log("查詢其他守候失敗：", e); return []

def watch_list():
    now = datetime.now(TZ)
    recs = json.load(open(os.path.join(ROOT, "data", "predictions.json"), encoding="utf-8"))["records"]
    return [r for r in recs if not r.get("official") and r.get("snapshots") and r.get("status") != "cancelled" and now < gt(r) <= now + timedelta(hours=24)]

def changed(recs):
    """6 小時內開打的場次：API 先發或開賽時間跟最後一筆快照不同 → 回傳 gamePk"""
    now = datetime.now(TZ); near = {r["gamePk"]: r for r in recs if gt(r) <= now + NEAR}
    if not near: return []
    d = json.load(urllib.request.urlopen("https://statsapi.mlb.com/api/v1/schedule?sportId=1&gamePks=" + ",".join(map(str, near)) + "&hydrate=probablePitcher", timeout=30))
    need = []
    for g in (x for dt in d.get("dates", []) for x in dt["games"]):
        r = near.get(g["gamePk"])
        if r is None or g["status"].get("detailedState", "").startswith("Postponed"): continue   # 延賽的舊場次 API 也會列出，跳過
        last = r["snapshots"][-1]
        pid = lambda s: (g["teams"][s].get("probablePitcher") or {}).get("id")
        old = lambda s: (last.get(s + "Starter") or {}).get("id")
        api_t = datetime.fromisoformat(g["gameDate"].replace("Z", "+00:00")).astimezone(TZ).strftime("%Y-%m-%d %H:%M")
        if pid("home") != old("home") or pid("away") != old("away") or api_t != r["gameTime"][:16]: need.append(g["gamePk"])
    return sorted(set(need))

def update(pks):
    """每次從最新 repo 重跑；推送失敗就丟掉本地結果重來（不做合併）"""
    env = dict(os.environ, ONLY_PKS=",".join(map(str, pks)))
    for i in range(4):
        sync()
        sh("python3 scripts/log_predictions.py", env=env)
        sh("git add data/predictions.json")
        if subprocess.run("git diff --cached --quiet", shell=True, cwd=ROOT).returncode == 0: log("沒有變動（快照與上一筆相同）"); return
        sh('git commit -q -m "先發更新：MLB 預測紀錄"')
        if sh("git push -q origin HEAD:main", check=False).returncode == 0: log("已提交先發更新"); return
        time.sleep(20)
    log("推送失敗 4 次"); sys.exit(1)

if CHAIN:
    for _ in range(18):
        if not others(): break
        time.sleep(10)
elif others(): log("已有先發守候在跑，這次直接結束"); sys.exit(0)

while True:
    sync()
    w = watch_list()
    if not w: log("24 小時內沒有要守的比賽，結束"); break
    log("守候中：", [f'{r["gamePk"]} {r["gameTime"][5:16]}' for r in w])
    try: c = changed(w)
    except Exception as e: log("MLB API 失敗，下次再試：", e); c = []
    if c: log("先發或時間有變：", c); update(c)
    if time.time() - T0 + POLL > MAX:
        log("接近 6 小時上限，交棒給下一輪")
        sh(f"gh workflow run {WF} --ref main -f chain=1"); break
    time.sleep(POLL)
