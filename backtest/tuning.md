# Tuning — coordinate search on blend RPS, seasons 2024, 2025

Each constant is varied on its own with the others at their current values; the best value is kept before moving to the next. One pass.

Starting blend RPS: 0.2037

| Constant | Value | Blend RPS | |
|---|---:|---:|---|
| poisson.halfLifeDays | 90 | 0.2037 |  |
| poisson.halfLifeDays | 180 | 0.2037 | current |
| poisson.halfLifeDays | 270 | 0.2038 |  |
| poisson.halfLifeDays | 365 | 0.2039 |  |
| **poisson.halfLifeDays** | **keep 180** | **0.2037** | |
| poisson.rho | -0.05 | 0.2039 |  |
| poisson.rho | -0.1 | 0.2037 | current |
| poisson.rho | -0.15 | 0.2036 | better |
| **poisson.rho** | **keep -0.15** | **0.2036** | |
| poisson.xgBlend | 0.25 | 0.2042 |  |
| poisson.xgBlend | 0.5 | 0.2036 | current |
| poisson.xgBlend | 0.75 | 0.2032 | better |
| poisson.xgBlend | 1 | 0.2030 | better |
| **poisson.xgBlend** | **keep 1** | **0.2030** | |
| poisson.priorMatches | 3 | 0.2029 | better |
| poisson.priorMatches | 5 | 0.2030 | current |
| poisson.priorMatches | 8 | 0.2032 |  |
| **poisson.priorMatches** | **keep 3** | **0.2029** | |
| blend.plPoissonWeight | 0.4 | 0.2036 |  |
| blend.plPoissonWeight | 0.6 | 0.2029 | current |
| blend.plPoissonWeight | 0.8 | 0.2027 | better |
| blend.plPoissonWeight | 1 | 0.2028 |  |
| **blend.plPoissonWeight** | **keep 0.8** | **0.2027** | |
| elo.homeAdv | 40 | 0.2026 | better |
| elo.homeAdv | 60 | 0.2027 | current |
| elo.homeAdv | 80 | 0.2028 |  |
| **elo.homeAdv** | **keep 40** | **0.2026** | |

Final blend RPS 0.2026 with {"poisson":{"halfLifeDays":180,"priorMatches":3,"iterations":60,"rho":-0.15,"maxGoals":10,"xgBlend":1},"blend":{"plPoissonWeight":0.8},"elo":{"K":20,"homeAdv":40,"goalsPerPoint":0.0045}}

Differences under ~0.001 RPS are inside noise for one season (see bootstrap interval in the main backtest). Change models.js only for gains that hold across seasons.

Runtime 90s.
