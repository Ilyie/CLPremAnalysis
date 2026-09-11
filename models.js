/* ==========================================================================
   models.js — shared football model engine (no dependencies)
   Used by fixtures.html and analysis.html.

   What lives here:
     1. Data loading (bundled JSON snapshots in /data)
     2. League tables from played results
     3. Elo ratings: seeded by hand, then updated match-by-match
     4. Poisson attack/defence model (Dixon-Coles style) fitted on goals
     5. Match probability engine: scoreline grid → 1X2, O/U, BTTS, fair odds
     6. Bookmaker maths: implied probability, overround, vig removal, Kelly
     7. Monte Carlo season simulation
   Every constant has a comment explaining why it was chosen — the analysis
   page renders those reasons in its "Methodology" section.
   ========================================================================== */
const FM = (() => {
  "use strict";

  /* ---------- 1. Constants (the "decisions") ---------- */
  const CONFIG = {
    snapshotDate: "2026-09-10",   // when /data/*.json was pulled from fixturedownload.com
    elo: {
      K: 20,          // World Football Elo convention for league games
      homeAdv: 60,    // ~ the home edge seen in PL/UCL since crowds returned (≈0.25 goals)
      goalsPerPoint: 0.0045, // Elo diff → goal supremacy. 100 pts ≈ 64% expectation ≈ +0.45 goals
    },
    poisson: {
      halfLifeDays: 180, // recency weight half-life (Dixon-Coles time decay)
      priorMatches: 5,   // pseudo-matches shrinking each team toward its prior (early-season stabiliser)
      iterations: 60,    // alternating MLE updates — converges well before this
      rho: -0.10,        // Dixon-Coles low-score correction (draws at 0-0/1-1 are under-predicted by plain Poisson)
      maxGoals: 10,      // scoreline grid size; P(>10 goals) is negligible
      xgBlend: 0.5,      // share of the fitted "goal signal" taken from xG when Understat data is attached (0 = goals only, 1 = xG only)
    },
    blend: { plPoissonWeight: 0.8 }, // PL: 80% fitted Poisson, 20% Elo — tuned on 2024-26 (was 60/40; see backtest/tuning.md). UCL: 100% Elo
    sim: { defaultRuns: 5000 },
  };

  /* Seed Elo ratings, summer 2026 (approximate ClubElo scale, ~1500 = average
     top-flight side). The live ClubElo API was unreachable when this was built,
     so these are hand-entered priors; every 2026-27 result in /data then
     updates them, so the ratings shown on the page are seed + results to date. */
  const SEED_ELO = {
    // Premier League 2026-27
    "Arsenal": 2000, "Liverpool": 1950, "Man City": 1950, "Chelsea": 1880,
    "Newcastle": 1850, "Aston Villa": 1830, "Spurs": 1800, "Man Utd": 1780,
    "Brighton": 1790, "Crystal Palace": 1780, "Bournemouth": 1780, "Nott'm Forest": 1760,
    "Brentford": 1760, "Fulham": 1740, "Everton": 1720, "Leeds": 1680,
    "Sunderland": 1660, "Ipswich": 1610, "Coventry": 1600, "Hull": 1560,
    // Champions League 2026-27 (non-PL)
    "Paris": 2050, "Barcelona": 1980, "Bayern München": 2000, "Real Madrid": 1950,
    "Inter": 1930, "Atleti": 1870, "Napoli": 1850, "B. Dortmund": 1830,
    "Sporting CP": 1800, "Roma": 1790, "Villarreal": 1780, "Leipzig": 1760,
    "Stuttgart": 1760, "Porto": 1740, "PSV": 1740, "Real Betis": 1740,
    "Lille": 1740, "Galatasaray": 1720, "Como": 1720, "Club Brugge": 1700,
    "Fenerbahçe": 1700, "Lens": 1700, "Feyenoord": 1680, "Slavia Praha": 1680,
    "Shakhtar": 1620, "Bodø/Glimt": 1620, "AEK Athens": 1600, "Viking": 1520,
    "S. Bratislava": 1500, "LASK": 1500, "Sabah": 1400,
  };

  // Last season's promoted trio — their fitted PL ratings become the prior for this year's promoted sides.
  const PROMOTED_2025 = ["Burnley", "Leeds", "Sunderland"];
  const PROMOTED_2026 = ["Coventry", "Hull", "Ipswich"];

  /* ---------- 2. Data ---------- */
  const cache = {};
  async function loadJSON(path) {
    if (cache[path]) return cache[path];
    const res = await fetch(path);
    if (!res.ok) throw new Error("Failed to load " + path);
    const data = await res.json();
    cache[path] = data;
    return data;
  }
  // fixturedownload.com is not consistent about club names across seasons; map every spelling to one canonical form.
  const FEED_NAME_MAP = { "Nottingham Forest": "Nott'm Forest", "Sheffield Utd": "Sheffield United", "Manchester United": "Man Utd", "Manchester City": "Man City", "Tottenham": "Spurs", "Newcastle United": "Newcastle", "Wolverhampton Wanderers": "Wolves" };
  const canon = (t) => FEED_NAME_MAP[t] || t;
  function normalise(m) {
    return {
      id: m.MatchNumber,
      round: m.RoundNumber,
      date: new Date(m.DateUtc.replace(" ", "T")),
      venue: m.Location,
      home: canon(m.HomeTeam),
      away: canon(m.AwayTeam),
      hg: m.HomeTeamScore,
      ag: m.AwayTeamScore,
      played: m.HomeTeamScore !== null && m.AwayTeamScore !== null,
    };
  }
  async function loadAll() {
    const [pl, ucl, pl25, ucl25] = await Promise.all([
      loadJSON("data/epl-2026.json"), loadJSON("data/ucl-2026.json"),
      loadJSON("data/epl-2025.json"), loadJSON("data/ucl-2025.json"),
    ]);
    const byDate = (a, b) => a.date - b.date || a.id - b.id;
    return {
      pl: pl.map(normalise).sort(byDate),
      ucl: ucl.map(normalise).sort(byDate),
      pl25: pl25.map(normalise).sort(byDate),
      ucl25: ucl25.map(normalise).sort(byDate),
    };
  }
  const teamsOf = (matches) => [...new Set(matches.flatMap((m) => [m.home, m.away]))].sort();

  /** Optional Understat xG files (data/xg-epl-<season>.json from scripts/fetch_understat.py). Missing files are fine. */
  async function loadXG(seasons) {
    const out = [];
    for (const s of seasons) {
      try { const rows = await loadJSON(`data/xg-epl-${s}.json`); out.push(...rows); } catch (e) { /* not fetched yet */ }
    }
    return out;
  }
  /** Join xG rows onto feed matches by (home, away, same calendar day). Mutates matches: adds xgh/xga/forecast. Returns count joined. */
  function attachXG(matches, xgRows) {
    const key = (h, a, d) => `${h}|${a}|${d.toISOString().slice(0, 10)}`;
    const idx = new Map(xgRows.filter((r) => r.xgh != null).map((r) => [key(r.home, r.away, new Date(r.date)), r]));
    let n = 0;
    for (const m of matches) {
      const r = idx.get(key(m.home, m.away, m.date));
      if (r) { m.xgh = r.xgh; m.xga = r.xga; if (r.forecast) m.forecast = r.forecast; n++; }
    }
    return n;
  }

  /* ---------- 3. League tables ---------- */
  function table(matches, teams) {
    const rows = Object.fromEntries((teams || teamsOf(matches)).map((t) => [t, { team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, form: [] }]));
    for (const m of matches) {
      if (!m.played) continue;
      const h = rows[m.home], a = rows[m.away];
      h.p++; a.p++; h.gf += m.hg; h.ga += m.ag; a.gf += m.ag; a.ga += m.hg;
      if (m.hg > m.ag) { h.w++; a.l++; h.pts += 3; h.form.push("W"); a.form.push("L"); }
      else if (m.hg < m.ag) { a.w++; h.l++; a.pts += 3; a.form.push("W"); h.form.push("L"); }
      else { h.d++; a.d++; h.pts++; a.pts++; h.form.push("D"); a.form.push("D"); }
    }
    return Object.values(rows).map((r) => ({ ...r, gd: r.gf - r.ga, form: r.form.slice(-5) })).sort(rank);
  }
  const rank = (a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team);

  /* ---------- 4. Elo ---------- */
  function eloExpected(dr) { return 1 / (1 + Math.pow(10, -dr / 400)); }
  function goalMultiplier(gd) { return gd <= 1 ? 1 : gd === 2 ? 1.5 : (11 + gd) / 8; }
  /** Run seed ratings forward through every played match (all competitions, chronological). */
  function computeElo(playedMatches) {
    const elo = { ...SEED_ELO };
    const history = [];
    const sorted = [...playedMatches].filter((m) => m.played).sort((a, b) => a.date - b.date);
    for (const m of sorted) {
      if (!(m.home in elo) || !(m.away in elo)) continue;
      const dr = elo[m.home] + CONFIG.elo.homeAdv - elo[m.away];
      const exp = eloExpected(dr);
      const actual = m.hg > m.ag ? 1 : m.hg < m.ag ? 0 : 0.5;
      const delta = CONFIG.elo.K * goalMultiplier(Math.abs(m.hg - m.ag)) * (actual - exp);
      elo[m.home] += delta; elo[m.away] -= delta;
      history.push({ ...m, delta: +delta.toFixed(1), expected: exp });
    }
    return { elo, history };
  }

  /* ---------- 5. Poisson attack / defence (Dixon-Coles flavour) ---------- */
  /**
   * Fits λ_home = μ · H · att[home] · def[away],  λ_away = μ · att[away] · def[home]
   * by weighted alternating MLE. Weights decay with age (half-life CONFIG.poisson.halfLifeDays).
   * priors: {team: {att, def}} pseudo-observations for teams with little data.
   */
  function fitPoisson(matches, asOf, priors = {}, xgBlend = CONFIG.poisson.xgBlend) {
    const played = matches.filter((m) => m.played);
    // "Goal signal": goals, xG, or a blend. xG is less noisy than goals (a 1-0 win off one deflection is still a bad performance).
    const sig = played.map((m) => (m.xgh != null && xgBlend > 0)
      ? { h: (1 - xgBlend) * m.hg + xgBlend * m.xgh, a: (1 - xgBlend) * m.ag + xgBlend * m.xga }
      : { h: m.hg, a: m.ag });
    let xgMatches = 0; played.forEach((m) => { if (m.xgh != null) xgMatches++; });
    const teams = [...new Set([...teamsOf(played), ...Object.keys(priors)])].sort(); // a team with a prior but no games yet still gets a rating
    const xi = Math.LN2 / CONFIG.poisson.halfLifeDays;
    const w = played.map((m) => Math.exp(-xi * Math.max(0, (asOf - m.date) / 864e5)));
    const n0 = CONFIG.poisson.priorMatches;

    const att = {}, def = {};
    teams.forEach((t) => { att[t] = 1; def[t] = 1; });
    const sumW = w.reduce((a, b) => a + b, 0);
    const mu = played.reduce((s, m, i) => s + w[i] * (sig[i].h + sig[i].a), 0) / (2 * sumW); // avg goal signal per team per game
    let H = 1.1; // home multiplier, re-estimated each iteration

    for (let it = 0; it < CONFIG.poisson.iterations; it++) {
      // attack update
      const num = {}, den = {};
      teams.forEach((t) => { const p = priors[t] || { att: 1, def: 1 }; num[t] = n0 * p.att; den[t] = n0; });
      played.forEach((m, i) => {
        num[m.home] += w[i] * sig[i].h; den[m.home] += w[i] * mu * H * def[m.away];
        num[m.away] += w[i] * sig[i].a; den[m.away] += w[i] * mu * def[m.home];
      });
      teams.forEach((t) => (att[t] = num[t] / den[t]));
      // defence update (def > 1 = concedes more)
      teams.forEach((t) => { const p = priors[t] || { att: 1, def: 1 }; num[t] = n0 * p.def; den[t] = n0; });
      played.forEach((m, i) => {
        num[m.away] += w[i] * sig[i].h; den[m.away] += w[i] * mu * H * att[m.home];
        num[m.home] += w[i] * sig[i].a; den[m.home] += w[i] * mu * att[m.away];
      });
      teams.forEach((t) => (def[t] = num[t] / den[t]));
      // home advantage update
      let hn = 0, hd = 0;
      played.forEach((m, i) => { hn += w[i] * sig[i].h; hd += w[i] * mu * att[m.home] * def[m.away]; });
      H = hn / hd;
      // normalise: geometric mean of att and def = 1 (keeps μ meaningful)
      const gA = Math.exp(teams.reduce((s, t) => s + Math.log(att[t]), 0) / teams.length);
      const gD = Math.exp(teams.reduce((s, t) => s + Math.log(def[t]), 0) / teams.length);
      teams.forEach((t) => { att[t] /= gA; def[t] /= gD; });
    }
    return { att, def, mu, home: H, teams, sampleSize: played.length, xgMatches, xgBlend: xgMatches ? xgBlend : 0 };
  }

  /** Build the PL model: last season + this season, promoted sides get last year's promoted trio as prior. */
  function buildPLModel(data, asOf, xgBlend = CONFIG.poisson.xgBlend) {
    const base = fitPoisson(data.pl25, asOf, {}, xgBlend);
    const promotedPrior = {
      att: PROMOTED_2025.reduce((s, t) => s + base.att[t], 0) / PROMOTED_2025.length,
      def: PROMOTED_2025.reduce((s, t) => s + base.def[t], 0) / PROMOTED_2025.length,
    };
    const priors = {};
    PROMOTED_2026.forEach((t) => (priors[t] = promotedPrior));
    const fit = fitPoisson([...data.pl25, ...data.pl], asOf, priors, xgBlend);
    return { ...fit, promotedPrior };
  }

  function poissonPmf(lambda, max) {
    const out = new Array(max + 1);
    let p = Math.exp(-lambda);
    for (let k = 0; k <= max; k++) { out[k] = p; p *= lambda / (k + 1); }
    return out;
  }
  function tau(x, y, lh, la, rho) { // Dixon-Coles correction
    if (x === 0 && y === 0) return 1 - lh * la * rho;
    if (x === 0 && y === 1) return 1 + lh * rho;
    if (x === 1 && y === 0) return 1 + la * rho;
    if (x === 1 && y === 1) return 1 - rho;
    return 1;
  }

  /* ---------- 5b. Match engine ---------- */
  function eloLambdas(eloH, eloA, avgTotal) {
    const dr = eloH + CONFIG.elo.homeAdv - eloA;
    const s = dr * CONFIG.elo.goalsPerPoint; // expected goal supremacy
    return { lh: Math.max(0.15, (avgTotal + s) / 2), la: Math.max(0.15, (avgTotal - s) / 2) };
  }
  function scoreGrid(lh, la) {
    const N = CONFIG.poisson.maxGoals, rho = CONFIG.poisson.rho;
    const ph = poissonPmf(lh, N), pa = poissonPmf(la, N);
    const grid = [];
    let total = 0;
    for (let x = 0; x <= N; x++) {
      grid[x] = [];
      for (let y = 0; y <= N; y++) { const p = ph[x] * pa[y] * tau(x, y, lh, la, rho); grid[x][y] = p; total += p; }
    }
    for (let x = 0; x <= N; x++) for (let y = 0; y <= N; y++) grid[x][y] /= total;
    return grid;
  }
  function marketsFromGrid(grid) {
    let H = 0, D = 0, A = 0, over25 = 0, btts = 0, over15 = 0, over35 = 0, csH = 0, csA = 0;
    const scores = [], margin = {}; // margin[k] = P(home goals - away goals = k)
    grid.forEach((row, x) => row.forEach((p, y) => {
      if (x > y) H += p; else if (x < y) A += p; else D += p;
      if (x + y > 2.5) over25 += p; if (x + y > 1.5) over15 += p; if (x + y > 3.5) over35 += p;
      if (x > 0 && y > 0) btts += p;
      if (y === 0) csH += p; if (x === 0) csA += p;
      margin[x - y] = (margin[x - y] || 0) + p;
      scores.push({ x, y, p });
    }));
    scores.sort((a, b) => b.p - a.p);
    // Asian handicap on the home side: whole lines can push (stake returned), half lines cannot.
    const ah = [-1.5, -1, -0.5, 0, 0.5, 1, 1.5].map((line) => {
      let win = 0, push = 0, lose = 0;
      Object.entries(margin).forEach(([k, p]) => { const adj = +k + line; if (adj > 0) win += p; else if (adj === 0) push += p; else lose += p; });
      return { line, win, push, lose, fair: 1 + lose / win }; // EV = 0 ⇒ odds = 1 + P(lose)/P(win)
    });
    const dnbH = H / (H + A), dnbA = A / (H + A);
    return { H, D, A, over25, under25: 1 - over25, over15, over35, btts, csH, csA, dnbH, dnbA, ah, topScores: scores.slice(0, 10),
             fair: { H: 1 / H, D: 1 / D, A: 1 / A, over25: 1 / over25, under25: 1 / (1 - over25), btts: 1 / btts, dnbH: 1 / dnbH, dnbA: 1 / dnbA, csH: 1 / csH, csA: 1 / csA } };
  }

  /**
   * Predict one fixture. comp = "pl" | "ucl".
   * ctx = { elo, plModel, avgTotal: {pl, ucl} }
   */
  function predict(m, comp, ctx) {
    const eloH = ctx.elo[m.home], eloA = ctx.elo[m.away];
    const e = eloLambdas(eloH, eloA, ctx.avgTotal[comp]);
    let lh = e.lh, la = e.la, poisson = null, wP = 0;
    if (comp === "pl" && ctx.plModel) {
      const f = ctx.plModel;
      poisson = { lh: f.mu * f.home * f.att[m.home] * f.def[m.away], la: f.mu * f.att[m.away] * f.def[m.home] };
      wP = CONFIG.blend.plPoissonWeight;
      lh = Math.exp(wP * Math.log(poisson.lh) + (1 - wP) * Math.log(e.lh)); // geometric blend
      la = Math.exp(wP * Math.log(poisson.la) + (1 - wP) * Math.log(e.la));
    }
    const grid = scoreGrid(lh, la);
    const mk = marketsFromGrid(grid);
    return { match: m, comp, lh, la, grid, ...mk, eloH, eloA, eloDiff: eloH + CONFIG.elo.homeAdv - eloA,
             eloWinExp: eloExpected(eloH + CONFIG.elo.homeAdv - eloA), eloLambdas: e, poissonLambdas: poisson, poissonWeight: wP };
  }

  /* ---------- 5c. Power ratings (SPI-style) ---------- */
  /**
   * Offence = expected goals against an average side on a neutral pitch; defence = expected goals conceded.
   * Overall = share of available points expected against an average side (FiveThirtyEight's SPI definition).
   * PL teams use the fitted attack/defence; everyone else uses Elo alone (no home advantage).
   */
  function powerRatings(ctx) {
    const teams = new Map();
    const plTeams = ctx.plModel ? ctx.plModel.teams.filter((t) => teamsOf(ctx.data.pl).includes(t)) : [];
    const uclTeams = teamsOf(ctx.data.ucl);
    const fieldElo = [...new Set([...plTeams, ...uclTeams])].reduce((s, t) => s + (ctx.elo[t] || 1500), 0) / new Set([...plTeams, ...uclTeams]).size;
    const spiOf = (lh, la) => { const k = marketsFromGrid(scoreGrid(lh, la)); return (3 * k.H + k.D) / 3; };
    for (const t of new Set([...plTeams, ...uclTeams])) {
      let off, def, source;
      if (plTeams.includes(t)) { const f = ctx.plModel; off = f.mu * f.att[t]; def = f.mu * f.def[t]; source = "goal model"; }
      else { const dr = (ctx.elo[t] || 1500) - fieldElo, sup = dr * CONFIG.elo.goalsPerPoint, T = ctx.avgTotal.ucl; off = Math.max(0.15, (T + sup) / 2); def = Math.max(0.15, (T - sup) / 2); source = "elo"; }
      teams.set(t, { team: t, off, def, spi: spiOf(off, def), elo: ctx.elo[t], source, pl: plTeams.includes(t), ucl: uclTeams.includes(t) });
    }
    return [...teams.values()].sort((a, b) => b.spi - a.spi);
  }

  /* ---------- 5d. xG table (Understat-style) ---------- */
  /** Expected points per played match from its xG, via the same scoreline grid the predictions use. */
  function xgTable(matches, teams) {
    const rows = Object.fromEntries((teams || teamsOf(matches)).map((t) => [t, { team: t, p: 0, pts: 0, gf: 0, ga: 0, xg: 0, xga: 0, xpts: 0, withXG: 0 }]));
    for (const m of matches) {
      if (!m.played) continue;
      const h = rows[m.home], a = rows[m.away];
      h.p++; a.p++; h.gf += m.hg; h.ga += m.ag; a.gf += m.ag; a.ga += m.hg;
      if (m.hg > m.ag) h.pts += 3; else if (m.hg < m.ag) a.pts += 3; else { h.pts++; a.pts++; }
      if (m.xgh != null) {
        const k = marketsFromGrid(scoreGrid(Math.max(0.05, m.xgh), Math.max(0.05, m.xga)));
        h.xg += m.xgh; h.xga += m.xga; a.xg += m.xga; a.xga += m.xgh;
        h.xpts += 3 * k.H + k.D; a.xpts += 3 * k.A + k.D; h.withXG++; a.withXG++;
      }
    }
    return Object.values(rows).map((r) => ({ ...r, gd: r.gf - r.ga, xgd: r.xg - r.xga, luck: r.pts - r.xpts })).sort((a, b) => b.xpts - a.xpts || b.xgd - a.xgd);
  }

  /** Shannon entropy of an outcome distribution in bits — 1.585 is a pure coin-toss between three outcomes. */
  const entropy = (ps) => -ps.reduce((s, p) => s + (p > 0 ? p * Math.log2(p) : 0), 0);

  /* ---------- 6. Bookmaker maths ---------- */
  /** decimal odds → implied probabilities, overround, and vig-free (multiplicative normalisation) */
  function bookmaker(odds) { // odds = {H, D, A} decimal
    const keys = Object.keys(odds).filter((k) => odds[k] > 1);
    const implied = {}; let sum = 0;
    keys.forEach((k) => { implied[k] = 1 / odds[k]; sum += implied[k]; });
    const fair = {}; keys.forEach((k) => (fair[k] = implied[k] / sum));
    return { implied, overround: sum - 1, fair, fairOdds: Object.fromEntries(keys.map((k) => [k, 1 / fair[k]])) };
  }
  /** Expected value per 1 unit staked and fractional Kelly stake given model prob p and decimal odds o */
  function edge(p, o, kellyFraction = 0.25) {
    const b = o - 1, ev = p * b - (1 - p);
    const kelly = Math.max(0, (p * b - (1 - p)) / b);
    return { ev, kelly, stake: kelly * kellyFraction };
  }

  /* ---------- 7. Monte Carlo ---------- */
  function cumulativeGrid(grid) { // flatten to cumulative array for sampling
    const cum = [], cells = [];
    let acc = 0;
    grid.forEach((row, x) => row.forEach((p, y) => { acc += p; cum.push(acc); cells.push([x, y]); }));
    return { cum, cells };
  }
  function sampleScore(cg) {
    const r = Math.random(), cum = cg.cum;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid; }
    return cg.cells[lo];
  }
  /**
   * Simulate the rest of a competition. thresholds: array of {key, from, to} position bands (1-indexed inclusive).
   * Returns per-team probabilities of finishing in each band, expected points and position.
   */
  function simulate(matches, comp, ctx, runs, bands) {
    const teams = teamsOf(matches);
    const idx = Object.fromEntries(teams.map((t, i) => [t, i]));
    const n = teams.length;
    const base = teams.map(() => ({ pts: 0, gd: 0, gf: 0 }));
    for (const m of matches) if (m.played) applyResult(base, idx, m.home, m.away, m.hg, m.ag);
    const remaining = matches.filter((m) => !m.played).map((m) => ({ h: idx[m.home], a: idx[m.away], cg: cumulativeGrid(predict(m, comp, ctx).grid) }));

    const out = teams.map(() => ({ pts: 0, pos: 0, bands: Object.fromEntries(bands.map((b) => [b.key, 0])), posDist: new Array(n).fill(0) }));
    const order = teams.map((_, i) => i);
    for (let r = 0; r < runs; r++) {
      const s = base.map((x) => ({ ...x }));
      for (const f of remaining) { const [x, y] = sampleScore(f.cg); applyResult(s, null, f.h, f.a, x, y, true); }
      order.sort((a, b) => s[b].pts - s[a].pts || s[b].gd - s[a].gd || s[b].gf - s[a].gf || Math.random() - 0.5);
      order.forEach((ti, pos) => {
        const o = out[ti]; o.pts += s[ti].pts; o.pos += pos + 1; o.posDist[pos]++;
        for (const b of bands) if (pos + 1 >= b.from && pos + 1 <= b.to) o.bands[b.key]++;
      });
    }
    return teams.map((t, i) => ({
      team: t, currentPts: base[i].pts, played: matches.filter((m) => m.played && (m.home === t || m.away === t)).length,
      xPts: out[i].pts / runs, xPos: out[i].pos / runs,
      bands: Object.fromEntries(bands.map((b) => [b.key, out[i].bands[b.key] / runs])),
      posDist: out[i].posDist.map((c) => c / runs),
    })).sort((a, b) => a.xPos - b.xPos);
  }
  function applyResult(s, idx, h, a, hg, ag, byIndex = false) {
    const H = byIndex ? s[h] : s[idx[h]], A = byIndex ? s[a] : s[idx[a]];
    H.gf += hg; H.gd += hg - ag; A.gf += ag; A.gd += ag - hg;
    if (hg > ag) H.pts += 3; else if (hg < ag) A.pts += 3; else { H.pts++; A.pts++; }
  }

  /* ---------- Context builder ---------- */
  function avgGoals(matches) { const p = matches.filter((m) => m.played); return p.reduce((s, m) => s + m.hg + m.ag, 0) / Math.max(1, p.length); }
  async function buildContext() {
    const data = await loadAll();
    const xg = await loadXG([2025, 2026]);
    const xgJoined = attachXG([...data.pl25, ...data.pl], xg);
    const asOf = new Date();
    const { elo, history } = computeElo([...data.pl, ...data.ucl]);
    const plModel = buildPLModel(data, asOf);
    const avgTotal = {
      pl: avgGoals([...data.pl25, ...data.pl]),
      ucl: avgGoals([...data.ucl25.filter((m) => m.round <= 8), ...data.ucl]), // league phase only
    };
    return { data, elo, eloHistory: history, plModel, avgTotal, asOf, xgJoined };
  }

  /* ---------- Formatting helpers ---------- */
  const pct = (p, d = 0) => (p * 100).toFixed(d) + "%";
  const odds = (o) => (o >= 100 ? o.toFixed(0) : o.toFixed(2));
  const fmtDate = (d, opts) => d.toLocaleString(undefined, opts || { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return { CONFIG, SEED_ELO, PROMOTED_2026, loadAll, loadJSON, loadXG, attachXG, normalise, teamsOf, table, computeElo, fitPoisson, buildPLModel, predict, bookmaker, edge, simulate, buildContext, pct, odds, fmtDate, eloExpected, eloLambdas, scoreGrid, marketsFromGrid, powerRatings, xgTable, entropy };
})();
if (typeof module !== "undefined") module.exports = FM;
