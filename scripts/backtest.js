#!/usr/bin/env node
/*
  Rolling backtest of the match model over one or more Premier League seasons.

  For every match day of a test season, fit on everything that happened before
  that day (previous season + the test season to date), predict the day's
  matches, then score them. Nothing from the future leaks into a prediction.

  Variants (all produce home/draw/away probabilities and a scoreline grid):
    poisson-goals   attack/defence fit on goals only
    poisson-xg      same fit on a goals/xG blend (CONFIG.poisson.xgBlend)   (production setting)
    poisson-xg100   same fit on xG only
    elo             Elo run forward from a flat start through the prior season, then live
    blend           production model: CONFIG.blend.plPoissonWeight × poisson-xg + rest × elo
  Baselines:
    uniform, home-prior (last season's raw H/D/A rates)
    understat-postmatch  Understat's per-match "forecast". NOT a pre-match prediction — it is
                    computed from the shots of the match itself and sees the result. Reported
                    only as a ceiling for what perfect xG knowledge would give.

  Metrics (lower is better except accuracy):
    RPS     ranked probability score — the standard for ordered 1X2 outcomes
    Brier   multi-class Brier score
    LogL    mean negative log-likelihood of the observed outcome
    Acc     share of matches where the highest-probability outcome happened
    O/U, BTTS  Brier scores of the over-2.5 and both-teams-score probabilities (variants with a grid)
  Plus: 95% bootstrap interval for the RPS gap between blend and poisson-goals, monthly RPS,
  and calibration of the blend's home-win probability.

  Usage:
    node scripts/backtest.js                 # test 2025-26 (prior 2024-25)
    node scripts/backtest.js 2024 2025       # several test seasons, pooled + per-season
    node scripts/backtest.js --tune          # coordinate search over the main constants
    node scripts/backtest.js --no-xg
  Writes backtest/results-<seasons>.md and .json (or backtest/tuning.md with --tune).
*/
const fs = require("fs");
const path = require("path");
const FM = require("../models.js");

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const SEASONS = args.filter((a) => /^\d{4}$/.test(a)).map(Number);
if (!SEASONS.length) SEASONS.push(2025);
const USE_XG = !args.includes("--no-xg");
const TUNE = args.includes("--tune");
const C = FM.CONFIG;

const readFeed = (season) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", `epl-${season}.json`), "utf8")).map(FM.normalise).sort((a, b) => a.date - b.date);
const readXG = (season) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "data", `xg-epl-${season}.json`), "utf8")); } catch { return []; } };

/* ---------- scoring ---------- */
const outcomeOf = (m) => (m.hg > m.ag ? 0 : m.hg === m.ag ? 1 : 2);
function score(p, o) {
  const y = [0, 0, 0]; y[o] = 1;
  let rps = 0, cp = 0, cy = 0;
  for (let i = 0; i < 2; i++) { cp += p[i]; cy += y[i]; rps += (cp - cy) ** 2; }
  return { rps: rps / 2, brier: p.reduce((s, x, i) => s + (x - y[i]) ** 2, 0), logl: -Math.log(Math.max(1e-9, p[o])), acc: p.indexOf(Math.max(...p)) === o ? 1 : 0 };
}
const VARIANTS = ["poisson-goals", "poisson-xg", "poisson-xg100", "elo", "blend", "uniform", "home-prior", "understat-postmatch"];

/* ---------- one season ---------- */
function runSeason(TEST, { quiet = false } = {}) {
  const PRIOR = TEST - 1;
  const prior = readFeed(PRIOR), test = readFeed(TEST).filter((m) => m.played);
  if (USE_XG) FM.attachXG([...prior, ...test], [...readXG(PRIOR), ...readXG(TEST)]);
  const priorTeams = FM.teamsOf(prior), testTeams = FM.teamsOf(test);
  const promoted = testTeams.filter((t) => !priorTeams.includes(t)), relegated = priorTeams.filter((t) => !testTeams.includes(t));
  const hp = [0, 0, 0]; prior.forEach((m) => hp[outcomeOf(m)]++); const homePrior = hp.map((x) => x / prior.length);
  const avgTotalPrior = prior.reduce((s, m) => s + m.hg + m.ag, 0) / prior.length;

  // Elo from a flat 1500 through the prior season; promoted sides start where the relegated ones finished.
  const elo = {}; const get = (t) => (elo[t] ??= 1500);
  const update = (m) => { const exp = FM.eloExpected(get(m.home) + C.elo.homeAdv - get(m.away)), act = m.hg > m.ag ? 1 : m.hg < m.ag ? 0 : 0.5, gd = Math.abs(m.hg - m.ag), G = gd <= 1 ? 1 : gd === 2 ? 1.5 : (11 + gd) / 8, d = C.elo.K * G * (act - exp); elo[m.home] = get(m.home) + d; elo[m.away] = get(m.away) - d; };
  prior.forEach(update);
  promoted.forEach((t) => (elo[t] = relegated.length ? relegated.reduce((s, r) => s + get(r), 0) / relegated.length : 1450));

  const fitFor = (history, asOf, xgBlend) => {
    const base = FM.fitPoisson(prior, asOf, {}, xgBlend), pr = {};
    if (relegated.length) { const att = relegated.reduce((s, t) => s + base.att[t], 0) / relegated.length, def = relegated.reduce((s, t) => s + base.def[t], 0) / relegated.length; promoted.forEach((t) => (pr[t] = { att, def })); }
    return FM.fitPoisson(history, asOf, pr, xgBlend);
  };
  const lam = (f, m) => ({ lh: f.mu * f.home * f.att[m.home] * f.def[m.away], la: f.mu * f.att[m.away] * f.def[m.home] });
  const mk = (l) => FM.marketsFromGrid(FM.scoreGrid(l.lh, l.la));

  const records = []; // one per match per variant: {season, variant, month, rps, brier, logl, acc, ou, btts}
  const days = [...new Set(test.map((m) => m.date.toISOString().slice(0, 10)))];
  let seen = [];
  for (const day of days) {
    const asOf = new Date(day + "T00:00:00Z"), todays = test.filter((m) => m.date.toISOString().slice(0, 10) === day), history = [...prior, ...seen];
    const fits = { "poisson-goals": fitFor(history, asOf, 0) };
    if (USE_XG) { fits["poisson-xg"] = fitFor(history, asOf, C.poisson.xgBlend); if (!TUNE) fits["poisson-xg100"] = fitFor(history, asOf, 1); }
    for (const m of todays) {
      const o = outcomeOf(m), month = day.slice(0, 7), ou = m.hg + m.ag > 2.5 ? 1 : 0, bt = m.hg > 0 && m.ag > 0 ? 1 : 0;
      const rec = (variant, k, p) => { const s = score(p || [k.H, k.D, k.A], o); records.push({ season: TEST, variant, month, match: m.id, ...s, ou: k ? (k.over25 - ou) ** 2 : null, btts: k ? (k.btts - bt) ** 2 : null, pH: p ? p[0] : k.H }); };
      const lg = lam(fits["poisson-goals"], m); rec("poisson-goals", mk(lg));
      let lp = lg;
      if (fits["poisson-xg"]) { lp = lam(fits["poisson-xg"], m); rec("poisson-xg", mk(lp)); }
      if (fits["poisson-xg100"]) rec("poisson-xg100", mk(lam(fits["poisson-xg100"], m)));
      const le = FM.eloLambdas(get(m.home), get(m.away), avgTotalPrior); rec("elo", mk(le));
      const w = C.blend.plPoissonWeight, lb = { lh: Math.exp(w * Math.log(lp.lh) + (1 - w) * Math.log(le.lh)), la: Math.exp(w * Math.log(lp.la) + (1 - w) * Math.log(le.la)) };
      rec("blend", mk(lb));
      if (!TUNE) { rec("uniform", null, [1 / 3, 1 / 3, 1 / 3]); rec("home-prior", null, homePrior); if (m.forecast) rec("understat-postmatch", null, [m.forecast.h, m.forecast.d, m.forecast.a]); }
    }
    todays.forEach(update); seen = seen.concat(todays);
  }
  if (!quiet) console.error(`  ${TEST}-${String(TEST + 1).slice(2)}: ${test.length} matches, promoted ${promoted.join("/")} (prior = ${relegated.join("/")})`);
  return records;
}

/* ---------- aggregation ---------- */
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
function summarise(records) {
  const byV = {}; records.forEach((r) => (byV[r.variant] ??= []).push(r));
  return VARIANTS.filter((v) => byV[v]).map((v) => { const rs = byV[v]; return { variant: v, n: rs.length, rps: mean(rs.map((r) => r.rps)), brier: mean(rs.map((r) => r.brier)), logl: mean(rs.map((r) => r.logl)), acc: mean(rs.map((r) => r.acc)), ou: rs[0].ou != null ? mean(rs.map((r) => r.ou)) : null, btts: rs[0].btts != null ? mean(rs.map((r) => r.btts)) : null }; }).sort((a, b) => a.rps - b.rps);
}
function bootstrapGap(records, a, b, n = 2000) { // 95% CI of mean RPS(a) - RPS(b), paired by match
  const A = {}, B = {}; records.forEach((r) => { if (r.variant === a) A[r.season + ":" + r.match] = r.rps; if (r.variant === b) B[r.season + ":" + r.match] = r.rps; });
  const d = Object.keys(A).filter((k) => k in B).map((k) => A[k] - B[k]);
  const means = []; for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < d.length; j++) s += d[Math.floor(Math.random() * d.length)]; means.push(s / d.length); }
  means.sort((x, y) => x - y);
  return { gap: mean(d), lo: means[Math.floor(n * 0.025)], hi: means[Math.floor(n * 0.975)], n: d.length };
}
const f3 = (x) => (x == null ? "—" : x.toFixed(4)), f1 = (x) => (x * 100).toFixed(1) + "%";
function table(rows) {
  let md = `| Variant | Matches | RPS ↓ | Brier ↓ | Log loss ↓ | Accuracy ↑ | O/U 2.5 Brier ↓ | BTTS Brier ↓ |\n|---|---:|---:|---:|---:|---:|---:|---:|\n`;
  rows.forEach((r) => (md += `| ${r.variant} | ${r.n} | ${f3(r.rps)} | ${f3(r.brier)} | ${f3(r.logl)} | ${f1(r.acc)} | ${f3(r.ou)} | ${f3(r.btts)} |\n`));
  return md;
}

/* ---------- tuning ---------- */
if (TUNE) {
  const t0 = Date.now();
  const grid = [
    ["poisson.halfLifeDays", [90, 180, 270, 365]],
    ["poisson.rho", [-0.05, -0.1, -0.15]],
    ["poisson.xgBlend", [0.25, 0.5, 0.75, 1]],
    ["poisson.priorMatches", [3, 5, 8]],
    ["blend.plPoissonWeight", [0.4, 0.6, 0.8, 1]],
    ["elo.homeAdv", [40, 60, 80]],
  ];
  const getC = (k) => k.split(".").reduce((o, p) => o[p], C), setC = (k, v) => { const ps = k.split("."); ps.slice(0, -1).reduce((o, p) => o[p], C)[ps.at(-1)] = v; };
  const evalBlend = () => { const recs = SEASONS.flatMap((s) => runSeason(s, { quiet: true })); return mean(recs.filter((r) => r.variant === "blend").map((r) => r.rps)); };
  let md = `# Tuning — coordinate search on blend RPS, seasons ${SEASONS.join(", ")}\n\nEach constant is varied on its own with the others at their current values; the best value is kept before moving to the next. One pass.\n\n`;
  let base = evalBlend(); md += `Starting blend RPS: ${f3(base)}\n\n| Constant | Value | Blend RPS | |\n|---|---:|---:|---|\n`;
  console.error(`start ${f3(base)}`);
  for (const [k, values] of grid) {
    const orig = getC(k); let best = orig, bestR = base;
    for (const v of values) { setC(k, v); const r = evalBlend(); const mark = r < bestR - 1e-6 ? "better" : v === orig ? "current" : ""; md += `| ${k} | ${v} | ${f3(r)} | ${mark} |\n`; console.error(`  ${k}=${v} -> ${f3(r)} ${mark}`); if (r < bestR - 1e-6) { best = v; bestR = r; } }
    setC(k, best); base = bestR; md += `| **${k}** | **keep ${best}** | **${f3(bestR)}** | |\n`;
  }
  md += `\nFinal blend RPS ${f3(base)} with ${JSON.stringify({ poisson: C.poisson, blend: C.blend, elo: C.elo })}\n\nDifferences under ~0.001 RPS are inside noise for one season (see bootstrap interval in the main backtest). Change models.js only for gains that hold across seasons.\n\nRuntime ${((Date.now() - t0) / 1000).toFixed(0)}s.\n`;
  fs.mkdirSync(path.join(ROOT, "backtest"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "backtest", "tuning.md"), md);
  console.log(md);
  process.exit(0);
}

/* ---------- main ---------- */
const t0 = Date.now();
const records = SEASONS.flatMap((s) => runSeason(s));
const pooled = summarise(records);
const label = SEASONS.map((s) => `${s}-${String(s + 1).slice(2)}`).join(", ");
let md = `# Backtest — Premier League ${label}\n\nRolling daily refits, each test season trained on its previous season plus the test season to date. ${records.filter((r) => r.variant === "blend").length} matches scored. ${USE_XG ? "Understat xG attached." : "Goals only (--no-xg)."}\n\n## Pooled\n\n${table(pooled)}`;
if (SEASONS.length > 1) SEASONS.forEach((s) => (md += `\n## ${s}-${String(s + 1).slice(2)}\n\n${table(summarise(records.filter((r) => r.season === s)))}`));
const gapXG = bootstrapGap(records, "blend", "poisson-goals"), gapElo = bootstrapGap(records, "blend", "elo");
md += `\n## Is the production model actually better?\n\nPaired bootstrap, 95% interval of the RPS difference (negative = production better):\n\n| Comparison | Mean gap | 95% interval | Matches |\n|---|---:|---:|---:|\n| blend − poisson-goals | ${gapXG.gap.toFixed(4)} | ${gapXG.lo.toFixed(4)} to ${gapXG.hi.toFixed(4)} | ${gapXG.n} |\n| blend − elo | ${gapElo.gap.toFixed(4)} | ${gapElo.lo.toFixed(4)} to ${gapElo.hi.toFixed(4)} | ${gapElo.n} |\n\nIf an interval includes zero the improvement is not distinguishable from luck at this sample size.\n`;
md += `\n\`understat-postmatch\` is Understat's per-match xG-based result probability computed from the shots in that match — it sees the result and is a ceiling, not a rival. Sportsbook closing lines score about 0.19–0.20 RPS on the Premier League; 0.21 is a respectable public model.\n`;
const months = [...new Set(records.filter((r) => r.variant === "blend").map((r) => r.season + " " + r.month))].sort();
md += `\n## Blend RPS by month\n\n| Month | RPS | Matches |\n|---|---:|---:|\n`;
months.forEach((k) => { const rs = records.filter((r) => r.variant === "blend" && r.season + " " + r.month === k); md += `| ${k.split(" ")[1]} | ${f3(mean(rs.map((r) => r.rps)))} | ${rs.length} |\n`; });
const bins = Array.from({ length: 10 }, () => ({ p: 0, y: 0, n: 0 }));
records.filter((r) => r.variant === "blend").forEach((r) => { const b = bins[Math.min(9, Math.floor(r.pH * 10))]; b.p += r.pH; b.n++; });
// observed home-win rate needs the outcome: recover from acc/rps is messy, so recompute from data
const outcomes = {}; SEASONS.forEach((s) => readFeed(s).forEach((m) => { if (m.played) outcomes[s + ":" + m.id] = outcomeOf(m); }));
records.filter((r) => r.variant === "blend").forEach((r) => { const b = bins[Math.min(9, Math.floor(r.pH * 10))]; if (outcomes[r.season + ":" + r.match] === 0) b.y++; });
md += `\n## Calibration of blend, home-win probability\n\n| Predicted | Observed | Matches |\n|---:|---:|---:|\n`;
bins.forEach((b) => { if (b.n) md += `| ${f1(b.p / b.n)} | ${f1(b.y / b.n)} | ${b.n} |\n`; });
md += `\nRuntime ${((Date.now() - t0) / 1000).toFixed(1)}s. Config: K=${C.elo.K}, HFA=${C.elo.homeAdv}, goals/pt=${C.elo.goalsPerPoint}, half-life=${C.poisson.halfLifeDays}d, prior=${C.poisson.priorMatches}, rho=${C.poisson.rho}, xgBlend=${C.poisson.xgBlend}, blend=${C.blend.plPoissonWeight}.\n`;
fs.mkdirSync(path.join(ROOT, "backtest"), { recursive: true });
const stem = `results-${SEASONS.join("-")}`;
fs.writeFileSync(path.join(ROOT, "backtest", `${stem}.md`), md);
fs.writeFileSync(path.join(ROOT, "backtest", `${stem}.json`), JSON.stringify({ seasons: SEASONS, pooled, perSeason: Object.fromEntries(SEASONS.map((s) => [s, summarise(records.filter((r) => r.season === s))])), gaps: { xg: gapXG, elo: gapElo }, calibration: bins, config: C }, null, 2));
console.log(md);
