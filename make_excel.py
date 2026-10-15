# -*- coding: utf-8 -*-
# 產生「MLB 賽事分析」Excel 檔：python3 make_excel.py
# 資料全部即時取自 MLB 官方免費 API；中文對照表直接讀 app.js / players.js
import json, re, os, urllib.request
from datetime import datetime, timedelta, timezone
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill

API = "https://statsapi.mlb.com/api/v1"
TZ = timezone(timedelta(hours=8))          # 台灣時間 UTC+8
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = "/workspace/mlb-analysis.xlsx"

def get(path):                              # 抓 API 資料
    return json.load(urllib.request.urlopen(API + path, timeout=30))

# ---- 讀取網頁用的中文對照表 ----
app = open(os.path.join(HERE, "app.js"), encoding="utf-8").read()
TEAM_ZH = {int(i): (f, s) for i, f, s in re.findall(r'(\d+):\["([^"]+)","([^"]+)"\]', app)}
DIV = {int(i): n for i, n in re.findall(r'(\d+):"([^"]+)"', re.search(r'const DIV = \{(.*?)\};', app).group(1))}
SERIES = dict(re.findall(r'"([^"]+)":"([^"]+)"', re.search(r'const SERIES = \{(.*?)\};', app).group(1)))
pj = open(os.path.join(HERE, "players.js"), encoding="utf-8").read()
PLAYER_ZH = {int(i): n for i, n in re.findall(r'(\d+):"([^"]+)"', pj)}
UNMAPPED = set()

def tn(t): return TEAM_ZH.get(t["id"], (t.get("name"),))[0]
def pn(p):
    if p["id"] not in PLAYER_ZH: UNMAPPED.add(p["fullName"])
    return PLAYER_ZH.get(p["id"], p["fullName"])
def tw(s): return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(TZ).strftime("%m/%d %H:%M")

# ---- 戰績 ----
season = datetime.now(TZ).year
q = lambda y: get(f"/standings?leagueId=103,104&season={y}&standingsTypes=regularSeason&hydrate=team")
st = q(season)
if not st.get("records"): season -= 1; st = q(season)
TEAM = {}
for rec in st["records"]:
    for t in rec["teamRecords"]: TEAM[t["team"]["id"]] = dict(t, div=DIV.get(rec["division"]["id"], ""))

# ---- 預測模型（與網頁相同）----
def pyth(rs, ra): return rs**1.83 / (rs**1.83 + ra**1.83)
def strength(i): t = TEAM[i]; return 0.5*float(t["winningPercentage"]) + 0.5*pyth(t["runsScored"], t["runsAllowed"])
# 模型 v2（與 app.js modelV2、scripts/log_predictions.py 相同）
import math
LG_ERA, LG_WHIP, REG = 4.20, 1.30, 40
sig = lambda x: 1/(1+math.exp(-x))
def ip_num(s): a, _, b = str(s).partition("."); return int(a) + (int(b) if b else 0)/3
PST = {}
def pitcher(pid):
    if pid in PST: return PST[pid]
    d = get(f"/people/{pid}/stats?stats=season&group=pitching&season={season}")
    sp = d["stats"][0]["splits"] if d.get("stats") else []
    tot = [x for x in sp if "team" not in x] or sp
    s = dict(gs=0, ip=0.0, er=0, h=0, bb=0)
    for x in tot:
        t = x["stat"]; s["gs"] += t.get("gamesStarted", 0); s["ip"] += ip_num(t.get("inningsPitched", 0))
        s["er"] += t.get("earnedRuns", 0); s["h"] += t.get("hits", 0); s["bb"] += t.get("baseOnBalls", 0)
    s["era"] = tot[0]["stat"]["era"] if len(tot) == 1 else (f'{9*s["er"]/s["ip"]:.2f}' if s["ip"] else "-")
    s["whip"] = tot[0]["stat"]["whip"] if len(tot) == 1 else (f'{(s["h"]+s["bb"])/s["ip"]:.2f}' if s["ip"] else "-")
    PST[pid] = s; return s
def model_v2(h, a, hp, ap):
    """回傳主隊勝率與逐步差值（起點 50% → 戰績 → 主場 → 先發，一位小數加總等於最終）"""
    sh, sa = strength(h), strength(a)
    p = (sh - sh*sa) / (sh + sa - 2*sh*sa)
    xb = 0.250*math.log(p/(1-p))
    used = bool(hp and ap)
    rera = lambda s: (9*s["er"] + LG_ERA*REG)/(s["ip"] + REG)
    rwhip = lambda s: (s["h"] + s["bb"] + LG_WHIP*REG)/(s["ip"] + REG)
    xs = 0.137*(rera(ap)-rera(hp)) + 0.606*(rwhip(ap)-rwhip(hp)) if used else 0
    R1, R2, F = (round(sig(v)*1000) for v in (xb, xb+0.082, xb+0.082+xs))
    return F/1000, dict(standings=(R1-500)/10, home=(R2-R1)/10, starter=(F-R2)/10, final=F/10, used=used)

# ---- 賽程 ----
now = datetime.now(timezone.utc)
d = get(f"/schedule?sportId=1&startDate={(now-timedelta(14)).date()}&endDate={(now+timedelta(7)).date()}"
        "&hydrate=linescore,probablePitcher,decisions,team,seriesStatus")
games = [g for x in d.get("dates", []) for g in x["games"]]
done = [g for g in games if g["status"]["abstractGameState"] == "Final"][::-1][:5]
nxt = [g for g in games if g["status"]["abstractGameState"] == "Preview"][:4]

# ---- Excel 格式工具 ----
wb = Workbook(); wb.remove(wb.active)
HFILL = PatternFill("solid", fgColor="DDE6F3")
def sheet(name, headers, rows, widths, wrap=()):
    ws = wb.create_sheet(name); ws.append(headers)
    for c in ws[1]: c.font = Font(bold=True); c.fill = HFILL; c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    for r in rows: ws.append(r)
    for i, w in enumerate(widths): ws.column_dimensions[chr(65+i)].width = w
    for row in ws.iter_rows(min_row=2):
        for c in row: c.alignment = Alignment(vertical="top", wrap_text=(c.column-1) in wrap)
    ws.freeze_panes = "A2"; return ws

# 工作表 1：勝負預測（模型 v2，差值為主隊角度）
rows, past = [], not nxt
for g in (nxt or done):
    H, A = g["teams"]["home"], g["teams"]["away"]
    if H["team"]["id"] not in TEAM or A["team"]["id"] not in TEAM: continue
    hp = pitcher(H["probablePitcher"]["id"]) if H.get("probablePitcher") else None
    ap = pitcher(A["probablePitcher"]["id"]) if A.get("probablePitcher") else None
    p, st = model_v2(H["team"]["id"], A["team"]["id"], hp, ap)
    hpct = round(st["final"]); fp = max(hpct, 100-hpct)
    fav = "五五波：雙方各 50%" if hpct == 50 else f'看好：{tn(H["team"]) if hpct > 50 else tn(A["team"])} {fp}%'
    tier = "很有把握" if fp >= 60 else "略佔優勢" if fp >= 55 else "五五波"
    sp = lambda x, s: f'{pn(x["probablePitcher"])}（ERA {s["era"]}、WHIP {s["whip"]}）' if x.get("probablePitcher") else "未公布"
    sg = lambda v: "±0.0%" if abs(v) < 0.05 else f"{v:+.1f}%"
    rows.append([tw(g["gameDate"]), SERIES.get(g.get("seriesStatus", {}).get("description", ""), g.get("seriesStatus", {}).get("description", "")),
                 tn(A["team"]), tn(H["team"]), fav, tier, f'{100-st["final"]:.1f}%', f'{st["final"]:.1f}%',
                 "50.0%", sg(st["standings"]), sg(st["home"]), sg(st["starter"]) if st["used"] else "資料不足，未調整",
                 sp(A, ap), sp(H, hp)])
ws = sheet("勝負預測", ["比賽時間(UTC+8)", "系列賽", "客隊", "主隊", "結論", "信心", "客隊勝率", "主隊勝率",
                    "起點", "戰績(主隊)", "主場(主隊)", "先發(主隊)", "客隊預定先發", "主隊預定先發"],
           rows, [16, 12, 16, 16, 26, 10, 10, 10, 8, 11, 11, 16, 30, 30], wrap=(12, 13))
ws.append([]); ws.append(["⚠️ 簡易估算，非保證結果、非投注建議。主隊勝率＝起點 50%＋戰績＋主場＋先發（模型 v2，依 2026 例行賽回測）。" + ("（目前無即將開打比賽，改列最近比賽）" if past else "")])

# 工作表 2：賽後分析
def pline(p):
    s = p["stats"]["pitching"]
    return f'{pn(p["person"])} 投 {s["inningsPitched"]} 局、被敲 {s["hits"]} 安、失 {s["earnedRuns"]} 分自責、{s["strikeOuts"]} 次三振、{s["baseOnBalls"]} 次保送'
rows = []
for g in done:
    box = get(f'/game/{g["gamePk"]}/boxscore'); L = g["linescore"]
    H, A = g["teams"]["home"], g["teams"]["away"]
    W, Lo = ("home", "away") if H["score"] > A["score"] else ("away", "home")
    wn, ln = tn(g["teams"][W]["team"]), tn(g["teams"][Lo]["team"])
    big = max(L["innings"], key=lambda i: (i[W].get("runs") or 0, -i["num"]))
    inn = lambda s: " ".join(str(i[s].get("runs", "-")) for i in L["innings"])
    sp = lambda s: box["teams"][s]["players"]["ID%d" % box["teams"][s]["pitchers"][0]]
    t = box["teams"][W]
    hs = [t["players"]["ID%d" % i] for i in t["batters"]]
    hs = [p for p in hs if p["stats"].get("batting", {}).get("atBats", 0) > 0]
    hs.sort(key=lambda p: -(p["stats"]["batting"]["rbi"]*2 + p["stats"]["batting"]["hits"]))
    hs = [p for p in hs[:2] if p["stats"]["batting"]["hits"] or p["stats"]["batting"]["rbi"]]
    hit = "、".join(f'{pn(p["person"])}（{p["stats"]["batting"]["atBats"]} 打數 {p["stats"]["batting"]["hits"]} 安、{p["stats"]["batting"]["rbi"]} 分打點'
                    + (f'、{p["stats"]["batting"]["homeRuns"]} 支全壘打' if p["stats"]["batting"]["homeRuns"] else "") + "）" for p in hs)
    lw, ll = L["teams"][W], L["teams"][Lo]
    why = f'關鍵在第 {big["num"]} 局，{wn} 單局攻下 {big[W].get("runs",0)} 分。'
    if lw["hits"] != ll["hits"]: why += f'安打數 {lw["hits"]} 比 {ll["hits"]}，' + ("勝方打線更有效率。" if lw["hits"] > ll["hits"] else "勝方雖安打較少，但把握住得分機會。")
    if ll["errors"]: why += f'{ln} 出現 {ll["errors"]} 次失誤。'
    dc = g.get("decisions", {})
    rows.append([tw(g["gameDate"]), f'{tn(A["team"])} {A["score"]} : {H["score"]} {tn(H["team"])}', wn, why,
                 f'客 {inn("away")}\n主 {inn("home")}', f'{lw["hits"]} / {ll["hits"]}', f'{lw["errors"]} / {ll["errors"]}',
                 "勝方：" + pline(sp(W)) + "\n敗方：" + pline(sp(Lo)), hit,
                 "／".join(x for x in [f'勝投 {pn(dc["winner"])}' if dc.get("winner") else "", f'敗投 {pn(dc["loser"])}' if dc.get("loser") else "", f'救援 {pn(dc["save"])}' if dc.get("save") else ""] if x)])
sheet("賽後分析", ["比賽時間(UTC+8)", "比分", "勝隊", "為什麼贏？", "逐局得分", "安打(勝/敗)", "失誤(勝/敗)", "先發投手", "勝方關鍵打者", "勝敗投手"],
      rows, [15, 30, 16, 45, 24, 10, 10, 50, 40, 30], wrap=(1, 3, 4, 7, 8, 9))

# 工作表 3：聯盟戰績
rows = [[t["div"], tn(t["team"]), t["wins"], t["losses"], float(t["winningPercentage"]), t["gamesBack"], t["runsScored"], t["runsAllowed"], t["runDifferential"],
         round(pyth(t["runsScored"], t["runsAllowed"]), 3)] for t in TEAM.values()]
ws = sheet("聯盟戰績", ["分區", "球隊", "勝", "敗", "勝率", "勝差", "得分", "失分", "得失分差", "畢氏期望勝率"], rows, [12, 18, 6, 6, 8, 6, 8, 8, 10, 12])
for c in ws["E"][1:]: c.number_format = "0.000"

# 工作表 4、5：排行榜
def leaders(cats, group):
    r = get(f'/stats/leaders?leaderCategories={",".join(cats)}&season={season}&statGroup={group}&limit=5&sportId=1')
    return [[cats[L["leaderCategory"]], p["rank"], pn(p["person"]), tn(p["team"]), p["value"]] for L in r["leagueLeaders"] for p in L["leaders"]]
H5 = ["項目", "名次", "球員", "球隊", "數據"]; W5 = [10, 6, 18, 18, 8]
sheet("打擊排行", H5, leaders({"homeRuns": "全壘打", "battingAverage": "打擊率", "runsBattedIn": "打點"}, "hitting"), W5)
sheet("投手排行", H5, leaders({"earnedRunAverage": "防禦率", "strikeouts": "三振", "wins": "勝投"}, "pitching"), W5)

# 工作表 6：說明
sheet("說明", ["項目", "內容"], [
    ["資料來源", "MLB 官方 Stats API（statsapi.mlb.com），所有數字皆為官方資料，未自行編造"],
    ["更新時間", datetime.now(TZ).strftime("%Y-%m-%d %H:%M") + "（台灣時間 UTC+8）"],
    ["球季", f"{season}（戰績、排行榜為例行賽數據）"],
    ["預測模型 v2", "依 2026 例行賽回測（7/1 後 1,148 場測試）。σ(x)=1/(1+e^-x)，L＝兩隊實力分數 Log5 的 ln(p/(1-p))\n① 戰績：σ(0.250·L) − 50%（實力分數＝實際勝率×50%＋畢氏期望勝率×50%）\n② 主場：σ(0.082＋0.250·L) − ①\n③ 先發：再加 0.137×(客ERA−主ERA)＋0.606×(客WHIP−主WHIP)，投手數據先加 40 局聯盟平均（ERA 4.20、WHIP 1.30）；先發未公布則不調整\n三格依序計算、四捨五入到 0.1%，加總等於最終勝率"],
    ["注意", "預測只是簡易估算，未考慮先發投手、傷兵、季後賽狀態，不是保證結果，也不是投注建議"],
    ["賽後分析", "依官方逐局比分、安打、失誤、先發投手成績、勝方打者（打點×2＋安打排序取前 2）自動整理"],
    ["譯名", "球隊與球員中文名取自網頁 app.js / players.js 對照表" + ("；未對照（保留英文）：" + "、".join(sorted(UNMAPPED)) if UNMAPPED else "；本次全部皆有對照")],
    ["重新產生", "執行：python3 make_excel.py"]], [12, 90], wrap=(1,))

wb.save(OUT); print("已儲存", OUT, "| 未對照球員：", sorted(UNMAPPED) or "無")
