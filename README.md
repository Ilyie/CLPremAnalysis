# CLPremAnalysis

Prediction models for the 2026-27 Champions League and Premier League. A static web app — no frameworks, no build step — plus the model engine behind it.

## Run it

```bash
python3 -m http.server 8399
```

Then open http://localhost:8399. (Any static server works; the pages load `data/*.json` with `fetch`, so opening the HTML files directly from disk won't.)

## What's here

| File | Purpose |
| --- | --- |
| `index.html` | Landing page |
| `fixtures.html` + `fixtures.js` | Remaining PL and UCL fixtures in local time, team filter, live tables from results |
| `analysis.html` + `analysis.js` | Match probabilities, fair odds, scoreline heatmap, bookmaker edge check, Monte Carlo season simulation, methodology |
| `models.js` | The engine: Elo, Dixon-Coles Poisson attack/defence fit, scoreline grid → markets, vig removal, Kelly, season simulation |
| `data/` | Fixture and result snapshots from fixturedownload.com (PL + UCL, 2025-26 and 2026-27) |
| `refresh-data.sh` | Re-pulls the snapshots and stamps the date into `models.js` |
| `scripts/fetch_understat.py` | Pulls per-match Understat xG into `data/xg-epl-<season>.json` (no dependencies) |
| `scripts/backtest.js` | Rolling-refit backtest of every model variant on a full season; writes `backtest/` |
| `styles.css`, `football.css` | Theme tokens and page styles |

## The models, briefly

- **Implied probability** is the shared currency of every sportsbook: a decimal price is `1 / p` plus margin. The page works in probabilities and only converts to odds at the end. A bookmaker's three prices are de-vigged by dividing each implied probability by their sum (the overround).
- **Scoreline model.** Each side gets an expected-goals rate λ; the joint distribution is a Poisson product with the Dixon-Coles low-score correction (ρ = −0.10). Home/draw/away, over/under, BTTS and double chance all fall out of the same grid, so the markets are consistent with each other.
- **Premier League strength** comes from a weighted maximum-likelihood attack/defence fit on 2025-26 plus the current season (recency half-life 180 days), shrunk toward priors with 5 pseudo-matches. Promoted clubs take last season's promoted trio as their prior. When Understat xG is present the fit uses a 50/50 blend of xG and goals — xG measures performance, goals measure outcome, and finishing skill is partly real.
- **Elo** (K = 20, home advantage 60, goal-margin multiplier) runs across both competitions and updates from every played result. Seeds are approximate ClubElo values from summer 2026 entered by hand — the ClubElo API was down at build time — and are labelled as such in the ratings table.
- **Blend.** PL matches use a 60/40 geometric blend of the Poisson fit and the Elo-implied line (Elo carries the summer-transfer prior the goal data can't see yet). Champions League matches are Elo-only because an attack/defence fit isn't identifiable across 15 leagues.
- **Simulation.** Every remaining fixture is sampled from its own scoreline grid, tables are ranked (points, GD, GF), and the process is repeated 2,000–20,000 times. Ratings don't update mid-simulation, so real-world variance is slightly understated.

The full reasoning for each constant is in the Methodology section of `analysis.html`.

## Backtest

`node scripts/backtest.js 2025` replays the 2025-26 season with a fresh fit every match day (trained on 2024-25 plus the season to date, no look-ahead) and scores each variant. Ranked probability score (RPS) is the headline number; sportsbook closing lines sit around 0.19–0.20 on the Premier League.

| Variant | RPS ↓ | Log loss ↓ | Accuracy |
|---|---:|---:|---:|
| poisson-xg50 (goal model, 50% xG) | 0.2103 | 1.034 | 49.2% |
| blend-xg50 (production: 60% goal model + 40% Elo) | 0.2104 | 1.032 | 48.7% |
| poisson-xg100 | 0.2107 | 1.036 | 50.0% |
| elo | 0.2115 | 1.033 | 48.9% |
| poisson-goals (no xG) | 0.2124 | 1.040 | 46.3% |
| home-prior baseline | 0.2286 | 1.085 | 42.6% |

xG is worth about 0.002 RPS over goals alone, which is roughly the gap between a mid-table public model and a good one. Full tables and calibration in `backtest/results-2025.md`. Rule of the repo: a change that doesn't improve the backtest doesn't ship.

## Also in this repo

- `odds-book/` — a local paper-betting tracker (Express + Chart.js). Place fake-money bets at Elo or bookmaker odds, enter results, compare calibration and Brier scores. See its own README. Your personal `odds-book/data/data.json` is git-ignored.
- `Elo_odds_book.jsx` — a React/Recharts strategy simulator: how favourite, underdog, draw, home, value and Kelly strategies perform over a season against a noisy bookmaker.

## Refresh the data

```bash
./refresh-data.sh
```

The fixturedownload feed doesn't allow cross-origin browser requests, which is why the data is bundled rather than fetched live.
