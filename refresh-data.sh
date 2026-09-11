#!/usr/bin/env bash
# Pull fresh fixture/result snapshots from fixturedownload.com into ./data
# and stamp the snapshot date into models.js. Run from the repo root.
set -euo pipefail
cd "$(dirname "$0")"
curl -sSL "https://fixturedownload.com/feed/json/epl-2026" -o data/epl-2026.json
curl -sSL "https://fixturedownload.com/feed/json/champions-league-2026" -o data/ucl-2026.json
curl -sSL "https://fixturedownload.com/feed/json/epl-2025" -o data/epl-2025.json
curl -sSL "https://fixturedownload.com/feed/json/champions-league-2025" -o data/ucl-2025.json
today=$(date +%F)
sed -i '' "s/snapshotDate: \"[0-9-]*\"/snapshotDate: \"$today\"/" models.js
python3 -c "import json;[json.load(open(f)) for f in ['data/epl-2026.json','data/ucl-2026.json','data/epl-2025.json','data/ucl-2025.json']]" && echo "Data refreshed ($today)."
