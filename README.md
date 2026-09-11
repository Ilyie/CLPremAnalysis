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
| `fixtures.html` + `fixtures.js` | Remaining PL and UCL fixtures in local time with model win probabilities on every match, this-week strip with countdowns, matchweek navigation, team filter, live table and Understat-style xG table, calendar (.ics) export |
| `analysis.html` + `analysis.js` | Per-match probabilities, fair odds, head-to-head comparison, full market set (1X2, totals, BTTS, draw no bet, clean sheet, Asian handicap, correct score), bookmaker edge check, toss-ups and bankers for the week, Monte Carlo season simulation with position-by-position heatmap, SPI-style power rankings, backtest quality panel, methodology. Permalinks: `?comp=pl&match=<id>` |
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
- **Blend.** PL matches use an 80/20 geometric blend of the Poisson fit and the Elo-implied line (Elo carries the summer-transfer prior the goal data can't see yet). The weight was 60/40; `node scripts/backtest.js 2024 2025 --tune` showed 80/20 scores better in both seasons, so it moved. Champions League matches are Elo-only because an attack/defence fit isn't identifiable across 15 leagues.
- **Power rankings** rate every PL and UCL club on one scale: offence and defence as expected goals for/against an average club on a neutral pitch, overall rating as the expected share of points against that club — FiveThirtyEight's SPI definition.
- **Simulation.** Every remaining fixture is sampled from its own scoreline grid, tables are ranked (points, GD, GF), and the process is repeated 2,000–20,000 times. Ratings don't update mid-simulation, so real-world variance is slightly understated.

The full reasoning for each constant is in the Methodology section of `analysis.html`.

## Backtest

`node scripts/backtest.js 2024 2025` replays two full seasons with a fresh fit every match day (each trained on its previous season plus the season to date, no look-ahead) and scores every variant on ranked probability score (RPS), Brier, log loss, accuracy, and Brier for the over-2.5 and both-teams-score markets. It also reports a paired-bootstrap 95% interval for the gap between the production model and its baselines, RPS by month, and calibration. Sportsbook closing lines sit around 0.19–0.20 RPS on the Premier League.

Pooled over 2024-25 and 2025-26 (760 matches), current config:

| Variant | RPS ↓ | Accuracy | O/U 2.5 Brier ↓ |
|---|---:|---:|---:|
| blend (production: 80% goal model with xG + 20% Elo) | ~0.2033 | ~51% | ~0.255 |
| poisson-xg (goal model, 50% xG) | 0.2035 | 51.3% | 0.260 |
| poisson-goals (no xG) | 0.2059 | 48.9% | 0.258 |
| elo | 0.2071 | 50.5% | 0.249 |
| home-prior baseline | 0.2322 | 41.7% | — |

xG is worth about 0.002 RPS over goals alone; the interval on that gap just touches zero at 760 matches, so it is probably real but not yet proven. Elo on its own is clearly worse for 1X2 but slightly better on totals, which is why the blend keeps some of it. Exact numbers regenerate in `backtest/results-2024-2025.md`; the analysis page reads the JSON and shows them.

`node scripts/backtest.js 2024 2025 --tune` runs a one-pass coordinate search over half-life, rho, xG share, prior strength, blend weight and Elo home advantage and writes `backtest/tuning.md`. Rule of the repo: a change that doesn't improve the backtest across seasons doesn't ship, and gains under ~0.001 RPS are noise.

## Also in this repo

- `odds-book/` — a local paper-betting tracker (Express + Chart.js). Place fake-money bets at Elo or bookmaker odds, enter results, compare calibration and Brier scores. See its own README. Your personal `odds-book/data/data.json` is git-ignored.
- `Elo_odds_book.jsx` — a React/Recharts strategy simulator: how favourite, underdog, draw, home, value and Kelly strategies perform over a season against a noisy bookmaker.

## Refresh the data

```bash
./refresh-data.sh
```

The fixturedownload feed doesn't allow cross-origin browser requests, which is why the data is bundled rather than fetched live.
