#!/usr/bin/env node
/*
  Rolling backtest of the match model on a full Premier League season.

  For every match day of the test season, fit on everything that happened
  before that day (previous season + the test season to date), predict the
  day's matches, then score the predictions against what happened.
  Nothing from the future ever leaks into a prediction.

  Variants scored (all produce home/draw/away probabilities):
    poisson-goals   attack/defence fit on goals only
    poisson-xg50    same fit on a 50/50 blend of goals and Understat xG   (production setting)
    poisson-xg100   same fit on xG only
    elo             Elo run forward from a flat start through the prior season, then live
    blend-xg50      production model: 60% poisson-xg50 + 40% elo (geometric blend of lambdas)
  Baselines:
    uniform         1/3 each
    home-prior      last season's raw home/draw/away rates
    understat-postmatch  Understat's per-match "forecast". NOT a pre-match prediction: Understat
                    computes it from the shots of the match itself, so it knows the result's
                    xG. It is reported as a ceiling for what a perfect xG reading would give,
                    never as a competitor.

  Metrics (lower is better except accuracy):
    RPS   ranked probability score — the standard for ordered 1X2 outcomes
    Brier multi-class Brier score (sum of squared errors over the 3 outcomes)
    LogL  mean negative log-likelihood of the observed outcome
    Acc   share of matches where the highest-probability outcome happened

  Usage: node scripts/backtest.js [testSeason=2025] [--no-xg]
  Writes backtest/results-<season>.md and .json
*/
const fs = require("fs");
const path = require("path");
const FM = require("../models.js");

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const TEST = parseInt(args.find((a) => /^\d{4}$/.test(a)) || "2025", 10);
const PRIOR = TEST - 1;
const USE_XG = !args.includes("--no-xg");
const C = FM.CONFIG;

const readFeed = (season) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", `epl-${season}.json`), "utf8")).map(FM.normalise).sort((a, b) => a.date - b.date);
const readXG = (season) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "data", `xg-epl-${season}.json`), "utf8")); } catch { return []; } };

const prior = readFeed(PRIOR), test = readFeed(TEST).filter((m) => m.played);
if (USE_XG) {
  const joined = FM.attachXG([...prior, ...test], [...readXG(PRIOR), ...readXG(TEST)]);
  console.log(`xG attached to ${joined} of ${prior.length + test.length} matches`);
}
const priorTeams = FM.teamsOf(prior), testTeams = FM.teamsOf(test);
const promoted = testTeams.filter((t) => !priorTeams.includes(t));
const relegated = priorTeams.filter((t) => !testTeams.includes(t));

/* ---------- scoring ---------- */
const outcomeOf = (m) => (m.hg > m.ag ? 0 : m.hg === m.ag ? 1 : 2);
function score(p, o) { // p = [H, D, A]
  const y = [0, 0, 0]; y[o] = 1;
  let rps = 0, cp = 0, cy = 0;
  for (let i = 0; i < 2; i++) { cp += p[i]; cy += y[i]; rps += (cp - cy) ** 2; }
  rps /= 2;
  const brier = p.reduce((s, x, i) => s + (x - y[i]) ** 2, 0);
  const logl = -Math.log(Math.max(1e-9, p[o]));
  const acc = p.indexOf(Math.max(...p)) === o ? 1 : 0;
  return { rps, brier, logl, acc };
}
const variants = ["poisson-goals", "poisson-xg50", "poisson-xg100", "elo", "blend-xg50", "uniform", "home-prior", "understat-postmatch"];
const totals = Object.fromEntries(variants.map((v) => [v, { rps: 0, brier: 0, logl: 0, acc: 0, n: 0 }]));
const calib = { bins: Array.from({ length: 10 }, () => ({ p: 0, y: 0, n: 0 })) }; // for blend-xg50 home win
function add(v, p, o) { if (!p) return; const s = score(p, o); const t = totals[v]; t.rps += s.rps; t.brier += s.brier; t.logl += s.logl; t.acc += s.acc; t.n++; }

/* ---------- baselines ---------- */
const hp = [0, 0, 0]; prior.forEach((m) => hp[outcomeOf(m)]++); const homePrior = hp.map((x) => x / prior.length);

/* ---------- Elo from a flat start ---------- */
function eloFromFlat(matchesInOrder) {
  const elo = {}; const get = (t) => (elo[t] ??= 1500);
  return {
    elo, get,
    update(m) {
      const dr = get(m.home) + C.elo.homeAdv - get(m.away);
      const exp = FM.eloExpected(dr), act = m.hg > m.ag ? 1 : m.hg < m.ag ? 0 : 0.5;
      const gd = Math.abs(m.hg - m.ag), G = gd <= 1 ? 1 : gd === 2 ? 1.5 : (11 + gd) / 8;
      const d = C.elo.K * G * (act - exp); elo[m.home] = get(m.home) + d; elo[m.away] = get(m.away) - d;
    },
  };
}
const eloState = eloFromFlat();
prior.forEach((m) => eloState.update(m));
promoted.forEach((t) => { eloState.elo[t] = relegated.length ? relegated.reduce((s, r) => s + eloState.get(r), 0) / relegated.length : 1450; }); // promoted start where the relegated sides ended
const avgTotalPrior = prior.reduce((s, m) => s + m.hg + m.ag, 0) / prior.length;

/* ---------- rolling loop ---------- */
const days = [...new Set(test.map((m) => m.date.toISOString().slice(0, 10)))];
const fitFor = (history, asOf, xgBlend) => {
  const base = FM.fitPoisson(prior, asOf, {}, xgBlend);
  const pr = {}; // promoted prior = average fitted rating of the sides that went down
  if (relegated.length) { const att = relegated.reduce((s, t) => s + base.att[t], 0) / relegated.length, def = relegated.reduce((s, t) => s + base.def[t], 0) / relegated.length; promoted.forEach((t) => (pr[t] = { att, def })); }
  return FM.fitPoisson(history, asOf, pr, xgBlend);
};
const lam = (f, m) => ({ lh: f.mu * f.home * f.att[m.home] * f.def[m.away], la: f.mu * f.att[m.away] * f.def[m.home] });
const probs = (l) => { const k = FM.marketsFromGrid(FM.scoreGrid(l.lh, l.la)); return [k.H, k.D, k.A]; };

const t0 = Date.now();
let seen = [];
for (const day of days) {
  const asOf = new Date(day + "T00:00:00Z");
  const todays = test.filter((m) => m.date.toISOString().slice(0, 10) === day);
  const history = [...prior, ...seen];
  const fits = { "poisson-goals": fitFor(history, asOf, 0) };
  if (USE_XG) { fits["poisson-xg50"] = fitFor(history, asOf, 0.5); fits["poisson-xg100"] = fitFor(history, asOf, 1); }
  for (const m of todays) {
    const o = outcomeOf(m);
    const lg = lam(fits["poisson-goals"], m); add("poisson-goals", probs(lg), o);
    let lx = null;
    if (USE_XG) { lx = lam(fits["poisson-xg50"], m); add("poisson-xg50", probs(lx), o); add("poisson-xg100", probs(lam(fits["poisson-xg100"], m)), o); }
    const le = FM.eloLambdas(eloState.get(m.home), eloState.get(m.away), avgTotalPrior); add("elo", probs(le), o);
    const lp = lx || lg, w = C.blend.plPoissonWeight;
    const lb = { lh: Math.exp(w * Math.log(lp.lh) + (1 - w) * Math.log(le.lh)), la: Math.exp(w * Math.log(lp.la) + (1 - w) * Math.log(le.la)) };
    const pb = probs(lb); add("blend-xg50", pb, o);
    const b = calib.bins[Math.min(9, Math.floor(pb[0] * 10))]; b.p += pb[0]; b.y += o === 0 ? 1 : 0; b.n++;
    add("uniform", [1 / 3, 1 / 3, 1 / 3], o); add("home-prior", homePrior, o);
    if (m.forecast) add("understat-postmatch", [m.forecast.h, m.forecast.d, m.forecast.a], o);
  }
  todays.forEach((m) => eloState.update(m)); // results become known only after the day's predictions
  seen = seen.concat(todays);
}

/* ---------- report ---------- */
const rows = variants.filter((v) => totals[v].n).map((v) => { const t = totals[v]; return { variant: v, n: t.n, rps: t.rps / t.n, brier: t.brier / t.n, logl: t.logl / t.n, acc: t.acc / t.n }; }).sort((a, b) => a.rps - b.rps);
const f3 = (x) => x.toFixed(4), f1 = (x) => (x * 100).toFixed(1) + "%";
let md = `# Backtest — Premier League ${TEST}-${String(TEST + 1).slice(2)}\n\nRolling daily refits, trained on ${PRIOR}-${String(TEST).slice(2)} plus the test season to date. ${test.length} matches scored. ${USE_XG ? "Understat xG attached." : "Goals only (--no-xg)."} Promoted: ${promoted.join(", ")} (prior = mean of ${relegated.join(", ")}).\n\n`;
md += `| Variant | Matches | RPS ↓ | Brier ↓ | Log loss ↓ | Accuracy ↑ |\n|---|---:|---:|---:|---:|---:|\n`;
rows.forEach((r) => (md += `| ${r.variant} | ${r.n} | ${f3(r.rps)} | ${f3(r.brier)} | ${f3(r.logl)} | ${f1(r.acc)} |\n`));
md += `\n\`understat-postmatch\` is Understat's per-match xG-based result probability, computed from the shots in that match — it sees the result and is a ceiling, not a rival. Sportsbook closing lines score about 0.19–0.20 RPS on the Premier League; 0.21 is a respectable public model.\n`;
md += `\n## Calibration of blend-xg50, home-win probability\n\n| Predicted | Observed | Matches |\n|---:|---:|---:|\n`;
calib.bins.forEach((b) => { if (b.n) md += `| ${f1(b.p / b.n)} | ${f1(b.y / b.n)} | ${b.n} |\n`; });
md += `\nRuntime ${((Date.now() - t0) / 1000).toFixed(1)}s. Config: K=${C.elo.K}, HFA=${C.elo.homeAdv}, goals/pt=${C.elo.goalsPerPoint}, half-life=${C.poisson.halfLifeDays}d, prior=${C.poisson.priorMatches}, rho=${C.poisson.rho}, blend=${C.blend.plPoissonWeight}.\n`;
fs.mkdirSync(path.join(ROOT, "backtest"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "backtest", `results-${TEST}.md`), md);
fs.writeFileSync(path.join(ROOT, "backtest", `results-${TEST}.json`), JSON.stringify({ test: TEST, rows, calibration: calib.bins, config: C }, null, 2));
console.log(md);
