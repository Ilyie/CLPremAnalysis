#!/usr/bin/env python3
"""
Understat xG loader.

Pulls per-match expected goals for Premier League seasons from Understat's
JSON endpoint (the same one their league page calls) and writes
data/xg-epl-<season>.json in a small, stable shape:

  [{ "date": "2025-08-15 19:00:00Z", "home": "Liverpool", "away": "Bournemouth",
     "hg": 4, "ag": 2, "xgh": 2.33, "xga": 1.57,
     "forecast": {"h": 0.55, "d": 0.23, "a": 0.22} }, ...]

Team names are mapped to the fixturedownload.com spellings used everywhere
else in this repo so the two sources join on (date, home, away).

Usage:  python3 scripts/fetch_understat.py            # seasons 2024 2025 2026
        python3 scripts/fetch_understat.py 2025 2026  # specific seasons
Understat's season "2025" means 2025-26. No third-party packages needed.
"""
import json, sys, urllib.request, gzip, io, pathlib, ssl, subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
LEAGUE = "EPL"
SEASONS = [int(s) for s in sys.argv[1:]] or [2024, 2025, 2026]

# Understat title -> fixturedownload name
NAME_MAP = {
    "Manchester City": "Man City", "Manchester United": "Man Utd", "Newcastle United": "Newcastle",
    "Nottingham Forest": "Nott'm Forest", "Tottenham": "Spurs", "Wolverhampton Wanderers": "Wolves",
}

def fetch(season):
    url = f"https://understat.com/getLeagueData/{LEAGUE}/{season}"
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (CLPremAnalysis xG loader)",
        "X-Requested-With": "XMLHttpRequest",
        "Accept-Encoding": "gzip",
        "Referer": f"https://understat.com/league/{LEAGUE}/{season}",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
    except urllib.error.URLError as e:
        if "CERTIFICATE_VERIFY_FAILED" not in str(e):
            raise
        # python.org builds of Python on macOS ship without root certificates
        # until "Install Certificates.command" is run. curl uses the system store, so fall back to it.
        raw = subprocess.run(["curl", "-sSL", "--compressed", "-A", "Mozilla/5.0", "-H", "X-Requested-With: XMLHttpRequest", url],
                             check=True, capture_output=True).stdout
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.GzipFile(fileobj=io.BytesIO(raw)).read()
    return json.loads(raw)

def convert(payload):
    out = []
    for m in payload["dates"]:
        played = bool(m["isResult"])
        row = {
            "date": m["datetime"].replace(" ", "T") + "Z",   # Understat times are UTC
            "home": NAME_MAP.get(m["h"]["title"], m["h"]["title"]),
            "away": NAME_MAP.get(m["a"]["title"], m["a"]["title"]),
            "hg": int(m["goals"]["h"]) if played else None,
            "ag": int(m["goals"]["a"]) if played else None,
            "xgh": round(float(m["xG"]["h"]), 3) if played else None,
            "xga": round(float(m["xG"]["a"]), 3) if played else None,
        }
        f = m.get("forecast")
        if f: row["forecast"] = {"h": float(f["w"]), "d": float(f["d"]), "a": float(f["l"])}
        out.append(row)
    return out

for season in SEASONS:
    data = convert(fetch(season))
    path = ROOT / "data" / f"xg-epl-{season}.json"
    path.write_text(json.dumps(data, separators=(",", ":")))
    played = sum(1 for r in data if r["hg"] is not None)
    print(f"{path.relative_to(ROOT)}: {len(data)} matches, {played} with xG")
