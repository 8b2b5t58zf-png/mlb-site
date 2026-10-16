"""Internal odds benchmark (NOT shown on site).
Fetches h2h moneyline (region us) from The Odds API and stores de-vigged
median implied probabilities per game, keeping the latest pre-game snapshot.
Cost: events endpoint = 0 credits; odds endpoint = 1 credit (1 market x 1 region).
"""
import json, os, statistics, sys, urllib.request, urllib.parse
from datetime import datetime, timezone
from pathlib import Path

KEY = os.environ.get("ODDS_API_KEY")
BASE = "https://api.the-odds-api.com/v4/sports"
SPORTS = ["baseball_mlb", "basketball_nba"]
OUT = Path(__file__).resolve().parent.parent / "data" / "odds"

def get(url, params):
    params = dict(params, apiKey=KEY)
    with urllib.request.urlopen(f"{url}?{urllib.parse.urlencode(params)}", timeout=30) as r:
        return json.load(r), r.headers.get("x-requests-remaining"), r.headers.get("x-requests-last")

def iso(t): return datetime.fromisoformat(t.replace("Z", "+00:00"))

def main():
    if not KEY:
        print("ODDS_API_KEY missing"); sys.exit(1)
    OUT.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc)
    for sport in SPORTS:
        events, _, _ = get(f"{BASE}/{sport}/events", {})  # free
        upcoming = [e for e in events if iso(e["commence_time"]) > now]
        if not upcoming:
            print(f"{sport}: no upcoming events, skipped (0 credits)"); continue
        data, remaining, last = get(f"{BASE}/{sport}/odds",
                                    {"regions": "us", "markets": "h2h", "oddsFormat": "decimal"})
        print(f"{sport}: {len(data)} games, cost {last}, remaining {remaining}")
        path = OUT / f"{sport}.json"
        store = json.loads(path.read_text()) if path.exists() else {"games": {}}
        fetched_at = now.isoformat(timespec="seconds").replace("+00:00", "Z")
        for g in data:
            if iso(g["commence_time"]) <= now:
                continue  # only pre-game snapshots
            home, away = g["home_team"], g["away_team"]
            ph, pa = [], []
            for b in g.get("bookmakers", []):
                for m in b.get("markets", []):
                    if m["key"] != "h2h": continue
                    pr = {o["name"]: o["price"] for o in m["outcomes"]}
                    if home in pr and away in pr and len(pr) == 2:
                        ih, ia = 1 / pr[home], 1 / pr[away]
                        ph.append(ih / (ih + ia)); pa.append(ia / (ih + ia))
            if not ph: continue
            mh = statistics.median(ph); ma = statistics.median(pa)
            s = mh + ma
            store["games"][g["id"]] = {
                "commence_time": g["commence_time"], "home_team": home, "away_team": away,
                "home_prob": round(mh / s, 4), "away_prob": round(ma / s, 4),
                "bookmakers": len(ph), "fetched_at": fetched_at,
            }
        store["updated_at"] = fetched_at
        path.write_text(json.dumps(store, ensure_ascii=False, indent=1, sort_keys=True))

if __name__ == "__main__":
    main()
