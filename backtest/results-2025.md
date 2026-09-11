# Backtest — Premier League 2025-26

Rolling daily refits, trained on 2024-25 plus the test season to date. 380 matches scored. Understat xG attached. Promoted: Burnley, Leeds, Sunderland (prior = mean of Ipswich, Leicester, Southampton).

| Variant | Matches | RPS ↓ | Brier ↓ | Log loss ↓ | Accuracy ↑ |
|---|---:|---:|---:|---:|---:|
| understat-postmatch | 380 | 0.1795 | 0.5552 | 0.9416 | 57.4% |
| poisson-xg50 | 380 | 0.2103 | 0.6215 | 1.0338 | 49.2% |
| blend-xg50 | 380 | 0.2104 | 0.6210 | 1.0320 | 48.7% |
| poisson-xg100 | 380 | 0.2107 | 0.6229 | 1.0359 | 50.0% |
| elo | 380 | 0.2115 | 0.6225 | 1.0331 | 48.9% |
| poisson-goals | 380 | 0.2124 | 0.6254 | 1.0396 | 46.3% |
| home-prior | 380 | 0.2286 | 0.6568 | 1.0847 | 42.6% |
| uniform | 380 | 0.2322 | 0.6667 | 1.0986 | 42.6% |

`understat-postmatch` is Understat's per-match xG-based result probability, computed from the shots in that match — it sees the result and is a ceiling, not a rival. Sportsbook closing lines score about 0.19–0.20 RPS on the Premier League; 0.21 is a respectable public model.

## Calibration of blend-xg50, home-win probability

| Predicted | Observed | Matches |
|---:|---:|---:|
| 9.2% | 0.0% | 2 |
| 17.8% | 18.2% | 22 |
| 25.3% | 20.0% | 55 |
| 35.6% | 43.8% | 96 |
| 45.3% | 41.6% | 77 |
| 54.3% | 54.7% | 75 |
| 63.9% | 52.5% | 40 |
| 74.1% | 83.3% | 12 |
| 84.6% | 100.0% | 1 |

Runtime 3.5s. Config: K=20, HFA=60, goals/pt=0.0045, half-life=180d, prior=5, rho=-0.1, blend=0.6.
