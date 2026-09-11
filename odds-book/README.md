# Odds Book 2026/27 — local paper-betting tracker

A private web app that runs on your laptop only. Place fake-money bets on
Premier League and Champions League matches, enter results, and see whether
you, the Elo model, or the bookmaker forecasts best.

## Run it (first time)

1. Install Node.js 18 or newer from https://nodejs.org if you don't have it
   (check with `node -v` in Terminal).
2. In Terminal:

       cd odds-book
       npm install
       npm start

3. Open http://localhost:3000 in your browser.

Every time after that: `cd odds-book && npm start`. Stop it with Ctrl+C.

The server binds to 127.0.0.1, so nothing on your Wi-Fi or the internet can
reach it — only this machine.

## What's inside

    server.js          the local server (Express), about 100 lines
    public/index.html  the pages
    public/app.js      the Elo model, betting logic, stats
    public/style.css
    public/chart.umd.js  Chart.js, bundled so it works offline
    data/seed.json     starting Elo ratings + all 380 PL and 144 CL fixtures
    data/data.json     YOUR data. Created on first run. Back this file up.

To start over from scratch, stop the server and delete data/data.json.

## Workflow per match

1. Matches → all 380 PL fixtures and 144 CL fixtures are already loaded. Add match is only for extras like cup games.
2. Place bet → pick outcome, choose "Elo model" odds or type a real
   bookmaker's three odds, set stake, optionally type your own probability.
3. On matchday press Kick off (optional — just marks it in play).
4. Enter result → the final score settles every bet on that match and marks
   it correct / incorrect.
5. Stats → bankroll curve, ROI, hit rate by source and pick type, your
   calibration, and Brier scores (Elo vs you vs the bookmaker).
6. Bets → Export CSV for pandas / Excel.

## Keep the Elo ratings fresh

Settings → Elo ratings. The seed values are from an April 2025 mirror of
clubelo.com and five teams are placeholders. Copy today's numbers from
clubelo.com/Ranking — they move 50+ points over a season and every new bet's
odds depend on them. Bets already placed keep the odds they were placed at.
