(async () => {
  const MY_TEAM = "Arsenal";
  const ctx = await FM.buildContext();
  const { data } = ctx;
  const C = FM.CONFIG;
  const state = { comp: "pl", fixtureId: null, pred: null };
  const $ = (id) => document.getElementById(id);
  const sign = (n, d = 0) => (n > 0 ? "+" : "") + n.toFixed(d);

  /* ---------- fixture picker ---------- */
  function fillFixtures() {
    const upcoming = data[state.comp].filter((m) => !m.played).slice(0, 80);
    const sel = $("fixtureSel");
    sel.innerHTML = upcoming.map((m) => `<option value="${m.id}">${FM.fmtDate(m.date, { day: "numeric", month: "short" })} · ${m.home} v ${m.away}</option>`).join("");
    const mine = upcoming.find((m) => m.home === MY_TEAM || m.away === MY_TEAM);
    state.fixtureId = (mine || upcoming[0]).id;
    sel.value = state.fixtureId;
  }

  /* ---------- match card ---------- */
  const barLabel = (name, p) => (p >= 0.3 ? `${name} ${FM.pct(p)}` : p >= 0.09 ? FM.pct(p) : "");
  function renderMatch() {
    const m = data[state.comp].find((x) => x.id === state.fixtureId);
    const p = FM.predict(m, state.comp, ctx);
    state.pred = p;
    const best = p.topScores[0];
    $("matchCard").innerHTML = `
      <h3>${state.comp === "pl" ? "Premier League · Matchweek" : "Champions League · Matchday"} ${m.round} · ${FM.fmtDate(m.date)} · ${m.venue}</h3>
      <div style="font-family:var(--display);font-size:1.5rem;font-weight:600;color:var(--text);margin-bottom:0.9rem">${m.home} <span style="color:var(--faint);font-weight:400">v</span> ${m.away}</div>
      <div class="prob-bar">
        <div class="ph" style="flex:${p.H}" title="${m.home} ${FM.pct(p.H)}">${barLabel(m.home, p.H)}</div>
        <div class="pd" style="flex:${p.D}" title="Draw ${FM.pct(p.D)}">${barLabel("Draw", p.D)}</div>
        <div class="pa" style="flex:${p.A}" title="${m.away} ${FM.pct(p.A)}">${barLabel(m.away, p.A)}</div>
      </div>
      <div class="stat-grid">
        <div class="stat"><div class="k">Fair odds 1 / X / 2</div><div class="v">${FM.odds(p.fair.H)} · ${FM.odds(p.fair.D)} · ${FM.odds(p.fair.A)}</div><div class="s">no margin, decimal</div></div>
        <div class="stat"><div class="k">Expected goals</div><div class="v">${p.lh.toFixed(2)} – ${p.la.toFixed(2)}</div><div class="s">model λ, home – away</div></div>
        <div class="stat"><div class="k">Most likely score</div><div class="v">${best.x} – ${best.y}</div><div class="s">${FM.pct(best.p, 1)} of outcomes</div></div>
        <div class="stat"><div class="k">Over 2.5 goals</div><div class="v">${FM.pct(p.over25)}</div><div class="s">fair ${FM.odds(p.fair.over25)} / under ${FM.odds(p.fair.under25)}</div></div>
        <div class="stat"><div class="k">Both teams score</div><div class="v">${FM.pct(p.btts)}</div><div class="s">fair ${FM.odds(p.fair.btts)}</div></div>
        <div class="stat"><div class="k">Double chance 1X / X2</div><div class="v">${FM.pct(p.H + p.D)} · ${FM.pct(p.A + p.D)}</div><div class="s">fair ${FM.odds(1 / (p.H + p.D))} · ${FM.odds(1 / (p.A + p.D))}</div></div>
      </div>`;
    renderWhy(m, p);
    renderHeat(m, p);
    renderBook();
  }

  function formOf(team, comp) {
    return data[comp].filter((x) => x.played && (x.home === team || x.away === team)).slice(-5)
      .map((x) => { const gf = x.home === team ? x.hg : x.ag, ga = x.home === team ? x.ag : x.hg; return gf > ga ? "W" : gf < ga ? "L" : "D"; });
  }

  function renderWhy(m, p) {
    const f = ctx.plModel;
    const items = [];
    items.push(`<li><b>Ratings gap.</b> ${m.home} sits at Elo ${p.eloH.toFixed(0)}, ${m.away} at ${p.eloA.toFixed(0)}. Add ${C.elo.homeAdv} for home advantage and the effective gap is ${sign(p.eloDiff)}, which Elo alone converts to a ${FM.pct(p.eloWinExp)} expectation for the home side (a win counts 1, a draw ½).</li>`);
    if (state.comp === "pl") {
      items.push(`<li><b>Goal model.</b> From last season plus this one, ${m.home} rates attack ${f.att[m.home].toFixed(2)} / defence ${f.def[m.home].toFixed(2)}; ${m.away} attack ${f.att[m.away].toFixed(2)} / defence ${f.def[m.away].toFixed(2)} (1.00 = league average). With the fitted home boost of ×${f.home.toFixed(2)} that gives ${p.poissonLambdas.lh.toFixed(2)} – ${p.poissonLambdas.la.toFixed(2)} expected goals.</li>`);
      items.push(`<li><b>Blend.</b> Final λ is a ${Math.round(p.poissonWeight * 100)}/${Math.round((1 - p.poissonWeight) * 100)} geometric blend of the goal model (${p.poissonLambdas.lh.toFixed(2)} – ${p.poissonLambdas.la.toFixed(2)}) and the Elo-implied line (${p.eloLambdas.lh.toFixed(2)} – ${p.eloLambdas.la.toFixed(2)}). The goal model knows how teams score; Elo carries a summer-transfer prior the goal data can't see yet after ${data.pl.filter((x) => x.played).length / 10} rounds.</li>`);
      if (FM.PROMOTED_2026.includes(m.home) || FM.PROMOTED_2026.includes(m.away)) items.push(`<li><b>Promoted side.</b> ${FM.PROMOTED_2026.filter((t) => t === m.home || t === m.away).join(" and ")} have no Premier League history in the data, so they start from the average of last season's promoted trio (attack ${f.promotedPrior.att.toFixed(2)}, defence ${f.promotedPrior.def.toFixed(2)}) and drift as results arrive.</li>`);
    } else {
      items.push(`<li><b>Elo only.</b> Champions League sides come from 15 leagues, and half the field has no European matches in the data, so a goal model can't be fitted across them. Expected goals come straight from the Elo gap: ${sign(p.eloDiff)} points × ${C.elo.goalsPerPoint} goals/point = ${sign(p.eloDiff * C.elo.goalsPerPoint, 2)} goal supremacy around a league-phase average of ${ctx.avgTotal.ucl.toFixed(2)} goals per game.</li>`);
    }
    const fh = formOf(m.home, state.comp), fa = formOf(m.away, state.comp);
    items.push(`<li><b>Form is already inside the ratings.</b> ${m.home} last ${fh.length}: ${fh.join(" ") || "—"}. ${m.away}: ${fa.join(" ") || "—"}. Each of those results moved Elo by up to ±${C.elo.K} × a goal-margin multiplier, so form isn't double-counted as a separate factor.</li>`);
    items.push(`<li><b>Draw share.</b> Plain Poisson under-rates 0-0 and 1-1. The Dixon-Coles correction (ρ = ${C.poisson.rho}) shifts a little mass onto those scores, which is why the draw sits at ${FM.pct(p.D)} rather than a couple of points lower.</li>`);
    items.push(`<li><b>What this is not.</b> No injuries, no lineups, no fixture congestion, no weather. Those are exactly the things a sharp book prices and this model can't, so treat an "edge" below as a conversation starter, not a signal.</li>`);
    $("whyCard").innerHTML = `<h3>Why the model says this</h3><ul class="why">${items.join("")}</ul>`;
  }

  function renderHeat(m, p) {
    const N = 5;
    let max = 0; for (let x = 0; x <= N; x++) for (let y = 0; y <= N; y++) max = Math.max(max, p.grid[x][y]);
    let html = `<div class="hd"></div>` + Array.from({ length: N + 1 }, (_, y) => `<div class="hd">${y}</div>`).join("");
    for (let x = 0; x <= N; x++) {
      html += `<div class="hd">${x}</div>`;
      for (let y = 0; y <= N; y++) {
        const v = p.grid[x][y], a = Math.pow(v / max, 0.7);
        const col = x > y ? "255,61,78" : x < y ? "56,189,248" : "251,191,36";
        html += `<div style="background:rgba(${col},${(0.08 + 0.75 * a).toFixed(2)})" title="${x}-${y}: ${FM.pct(v, 1)}">${(v * 100).toFixed(1)}</div>`;
      }
    }
    $("heatCard").innerHTML = `<h3>Scoreline probabilities (%) · rows ${m.home}, columns ${m.away}</h3><div class="heat">${html}</div>
      <p class="note">Top scorelines: ${p.topScores.slice(0, 5).map((s) => `${s.x}-${s.y} (${FM.pct(s.p, 1)})`).join(", ")}. Red = home win, blue = away win, gold = draw.</p>`;
  }

  /* ---------- bookmaker comparison ---------- */
  function renderBook() {
    const o = { H: +$("oddsH").value, D: +$("oddsD").value, A: +$("oddsA").value };
    const out = $("bookOut");
    if (!(o.H > 1 && o.D > 1 && o.A > 1)) { out.innerHTML = '<p class="note" style="margin:0">Enter all three prices to see implied probability, overround and edge.</p>'; return; }
    const b = FM.bookmaker(o), p = state.pred;
    const rows = [["H", "Home", p.H], ["D", "Draw", p.D], ["A", "Away", p.A]].map(([k, name, mp]) => {
      const e = FM.edge(mp, o[k]);
      return `<tr><td class="team" style="text-align:left">${name}</td><td>${o[k].toFixed(2)}</td><td>${FM.pct(b.implied[k], 1)}</td><td>${FM.pct(b.fair[k], 1)}</td><td>${FM.pct(mp, 1)}</td><td class="${e.ev >= 0 ? "edge-pos" : "edge-neg"}">${sign(e.ev * 100, 1)}%</td><td>${e.stake > 0 ? FM.pct(e.stake, 1) : "—"}</td></tr>`;
    }).join("");
    out.innerHTML = `<table class="tbl"><thead><tr><th style="text-align:left">Outcome</th><th>Odds</th><th>Implied</th><th>Book fair</th><th>Model</th><th>EV</th><th>¼ Kelly</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="note"><b style="color:var(--text)">Overround ${FM.pct(b.overround, 1)}</b> — the implied probabilities sum to ${FM.pct(1 + b.overround, 1)}; the extra is the book's margin. "Book fair" rescales them to 100% so you're comparing opinion to opinion. EV is the expected return per 1 unit staked at the model's probability. Kelly is shown at a quarter, because full Kelly assumes the model is exactly right and it isn't.</p>`;
  }

  /* ---------- season simulation ---------- */
  function simTable(rows, cols, zones) {
    const zone = (i) => zones.find((z) => i + 1 >= z.from && i + 1 <= z.to)?.cls || "";
    const cell = (v) => `<td class="pb"><span>${FM.pct(v, v < 0.1 && v > 0 ? 1 : 0)}<span class="bar-mini" style="width:3.2rem"><i style="width:${(v * 100).toFixed(0)}%"></i></span></span></td>`;
    return `<table class="tbl"><thead><tr><th>#</th><th>Team</th><th>P</th><th>Pts</th><th>xPts</th>${cols.map((c) => `<th>${c.label}</th>`).join("")}</tr></thead><tbody>${rows.map((r, i) => `<tr class="${zone(i)} ${r.team === MY_TEAM ? "mine" : ""}"><td>${i + 1}</td><td class="team">${r.team}</td><td>${r.played}</td><td>${r.currentPts}</td><td><b style="color:var(--text)">${r.xPts.toFixed(1)}</b></td>${cols.map((c) => cell(r.bands[c.key])).join("")}</tr>`).join("")}</tbody></table>`;
  }
  async function runSim() {
    const runs = +$("simRuns").value, btn = $("runSim");
    btn.disabled = true; $("simNote").textContent = `Simulating ${runs.toLocaleString()} seasons…`;
    await new Promise((r) => setTimeout(r, 30));
    const t0 = performance.now();
    const pl = FM.simulate(data.pl, "pl", ctx, runs, [{ key: "title", from: 1, to: 1 }, { key: "top4", from: 1, to: 4 }, { key: "top6", from: 1, to: 6 }, { key: "rel", from: 18, to: 20 }]);
    $("simPL").innerHTML = simTable(pl, [{ key: "title", label: "Title" }, { key: "top4", label: "Top 4" }, { key: "top6", label: "Top 6" }, { key: "rel", label: "Releg." }],
      [{ cls: "zone-a", from: 1, to: 4 }, { cls: "zone-b", from: 5, to: 6 }, { cls: "zone-c", from: 18, to: 20 }]);
    const ucl = FM.simulate(data.ucl, "ucl", ctx, runs, [{ key: "top8", from: 1, to: 8 }, { key: "po", from: 9, to: 24 }, { key: "out", from: 25, to: 36 }]);
    $("simUCL").innerHTML = simTable(ucl, [{ key: "top8", label: "Top 8" }, { key: "po", label: "Play-off" }, { key: "out", label: "Out" }],
      [{ cls: "zone-a", from: 1, to: 8 }, { cls: "zone-b", from: 9, to: 24 }, { cls: "zone-c", from: 25, to: 36 }]);
    $("simNote").textContent = `${runs.toLocaleString()} seasons in ${((performance.now() - t0) / 1000).toFixed(1)}s. Sorted by average finishing position. xPts = mean final points.`;
    btn.disabled = false;
  }

  /* ---------- ratings tables ---------- */
  function renderRatings() {
    const teams = [...new Set([...FM.teamsOf(data.pl), ...FM.teamsOf(data.ucl)])];
    const rows = teams.map((t) => ({ t, elo: ctx.elo[t], seed: FM.SEED_ELO[t], pl: FM.teamsOf(data.pl).includes(t), ucl: FM.teamsOf(data.ucl).includes(t) })).sort((a, b) => b.elo - a.elo);
    $("eloTable").innerHTML = `<table class="tbl"><thead><tr><th>#</th><th>Team</th><th>Comp</th><th>Seed</th><th>Now</th><th>Δ</th></tr></thead><tbody>${rows.map((r, i) => `<tr class="${r.t === MY_TEAM ? "mine" : ""}"><td>${i + 1}</td><td class="team">${r.t}</td><td style="font-family:var(--mono);font-size:0.68rem">${[r.pl && "PL", r.ucl && "UCL"].filter(Boolean).join("+")}</td><td>${r.seed}</td><td><b style="color:var(--text)">${r.elo.toFixed(0)}</b></td><td class="${r.elo - r.seed >= 0 ? "edge-pos" : "edge-neg"}">${sign(r.elo - r.seed)}</td></tr>`).join("")}</tbody></table>`;
    const f = ctx.plModel;
    const ad = FM.teamsOf(data.pl).map((t) => ({ t, att: f.att[t], def: f.def[t], net: f.att[t] / f.def[t] })).sort((a, b) => b.net - a.net);
    $("adTable").innerHTML = `<table class="tbl"><thead><tr><th>#</th><th>Team</th><th>Attack</th><th>Defence</th><th>Strength</th></tr></thead><tbody>${ad.map((r, i) => `<tr class="${r.t === MY_TEAM ? "mine" : ""}"><td>${i + 1}</td><td class="team">${r.t}${FM.PROMOTED_2026.includes(r.t) ? ' <span style="font-family:var(--mono);font-size:0.6rem;color:var(--orange)">PROM</span>' : ""}</td><td>${r.att.toFixed(2)}</td><td>${r.def.toFixed(2)}</td><td><b style="color:var(--text)">${r.net.toFixed(2)}</b></td></tr>`).join("")}</tbody></table>
      <p class="note">Home boost ×${f.home.toFixed(2)} · league average ${f.mu.toFixed(2)} goals per team per game · ${f.sampleSize} matches in the fit.</p>`;
  }

  /* ---------- methodology ---------- */
  function renderMethod() {
    const plPlayed = data.pl.filter((x) => x.played).length, uclPlayed = data.ucl.filter((x) => x.played).length;
    const blocks = [
      ["The metric: implied probability and the overround", `A decimal price of 2.00 says "50%". Every sportsbook prices from a probability, then shades every outcome so the three of them add up to more than 100% — that surplus is the overround (also called vig, juice or margin), typically 2–8% on a top-flight 1X2 market. That is the one metric shared across every platform, which is why this page speaks in probabilities and converts to odds only at the end.`,
       `To recover the book's honest opinion the page divides each implied probability by the total (multiplicative de-vigging). This is the simplest standard method; it slightly over-corrects long shots compared with the "power" or Shin methods, but for a 3-way market the difference is fractions of a percent and the transparency is worth more.`],
      ["Where the probabilities come from: a scoreline grid", `Football scores are close to Poisson: goals arrive at a roughly constant rate. Give each side an expected-goals rate (λ) and the probability of any scoreline is the product of two Poisson probabilities. Sum the cells and you get home/draw/away, over/under, both-teams-score and double-chance from one consistent model instead of pricing each market separately.`,
       `Plain Poisson is known to under-predict 0-0 and 1-1 and over-predict 1-0/0-1. Dixon and Coles (1997) fixed this with a small dependence parameter ρ; the page uses ρ = ${C.poisson.rho}, the value repeatedly found in Premier League fits. It is fixed rather than estimated because estimating ρ from one season is noisy and the value is stable across leagues.`],
      ["Team strength, part one: attack and defence from goals", `Each Premier League team gets an attack multiplier and a defence multiplier, fitted by weighted maximum likelihood so that λ<sub>home</sub> = μ × home boost × attack<sub>home</sub> × defence<sub>away</sub>. Data: all 380 games of 2025-26 and the ${plPlayed} played so far in 2026-27. Older games count for less: a half-life of ${C.poisson.halfLifeDays} days means last September's results carry about a quarter of the weight of last week's. Fitted home boost ≈ ×${ctx.plModel.home.toFixed(2)}, which matches the long-run Premier League figure.`,
       `Every team is shrunk toward a prior with the weight of ${C.poisson.priorMatches} pseudo-matches. For established sides the prior is "average"; for Coventry, Hull and Ipswich it is the mean of what Burnley, Leeds and Sunderland turned out to be last season. Promoted teams as a group are the most predictable thing in the league — they are usually bad — so the prior is doing real work in September.`],
      ["Team strength, part two: Elo", `Elo is a single number per team, updated after every match by K × (result − expectation), with the World Football Elo convention of K = ${C.elo.K} and a goal-difference multiplier (×1.5 for a two-goal win, larger beyond). Home advantage is ${C.elo.homeAdv} points, roughly a quarter of a goal. Elo is used because it works across competitions — an Arsenal win at Napoli moves Arsenal's rating in the Premier League model too.`,
       `Seed ratings are approximate ClubElo values from summer 2026, entered by hand because the ClubElo API was unreachable when the page was built. That is the single biggest source of error here and it is labelled as such in the ratings table. All ${plPlayed + uclPlayed} played 2026-27 matches then update the seeds in date order, so the "Now" column is evidence-adjusted.`],
      ["Combining the two (Premier League only)", `For Premier League games the final λ is a geometric blend: ${Math.round(C.blend.plPoissonWeight * 100)}% goal model, ${Math.round((1 - C.blend.plPoissonWeight) * 100)}% Elo-implied. The goal model is the better predictor over a season, but in September it has only three rounds of current data and knows nothing about summer transfers; the Elo seed carries that prior. The weight should move toward the goal model as the season goes on — that is a known simplification, not a tuned number.`,
       `Elo is turned into goals with ${C.elo.goalsPerPoint} goals of supremacy per rating point, so a 100-point gap is about +0.45 goals. That constant was chosen so a 100-point favourite's Poisson win probability matches its Elo expectation (~64%). Total goals are set to the competition average (Premier League ${ctx.avgTotal.pl.toFixed(2)}, Champions League league phase ${ctx.avgTotal.ucl.toFixed(2)}) rather than varying by team — a second simplification.`],
      ["Champions League: Elo only", `Thirty-six clubs from fifteen leagues, each playing eight opponents. Half of them have no European games in the 2025-26 data and their domestic results are not in the data at all, so an attack/defence fit is not identifiable. Elo handles this by construction, so Champions League matches use the Elo-implied line alone. This is also why the Champions League probabilities should be trusted less: they rest more heavily on the hand-entered seeds.`],
      ["The simulation", `For every unplayed fixture the page builds its scoreline grid once, then in each simulated season draws a score from that grid, applies it to the current table, and ranks by points, goal difference, goals scored (UEFA actually uses head-to-head first for ties in the league phase; the difference is rarely material). Repeating this ${C.sim.defaultRuns.toLocaleString()} times and counting gives the title, top-four and relegation probabilities. Sampling error at 5,000 runs is about ±1 percentage point on a 50% outcome, ±0.3 on a 5% one.`,
       `The matches are simulated independently: ratings do not update mid-simulation. That understates variance a little (real seasons have momentum and injuries) — the true probabilities are slightly less extreme than shown.`],
      ["The bookmaker check: EV and Kelly", `Expected value = model probability × (odds − 1) − (1 − model probability). Positive means the model thinks the price is too big. The suggested stake is the Kelly criterion, (p·b − q)/b, divided by four: full Kelly maximises long-run growth only if your probabilities are exactly right, and a quarter-Kelly gives up very little growth while roughly halving drawdowns when they aren't. Books employ people whose job is to know what this model cannot, so an apparent edge is usually the model being wrong about something specific — lineups, injuries, motivation — before it is the book being wrong.`],
      ["Data", `Fixtures and results come from fixturedownload.com snapshots stored in <code>/data</code> (last pulled ${C.snapshotDate}); the feed does not allow browser requests, so refresh with <code>./refresh-data.sh</code>. The Champions League file covers the league phase only; knockout rounds appear once drawn.`],
    ];
    $("method").innerHTML = blocks.map(([t, ...ps], i) => `<details ${i === 0 ? "open" : ""}><summary>${String(i + 1).padStart(2, "0")} · ${t}</summary>${ps.map((p) => `<p>${p}</p>`).join("")}</details>`).join("");
  }

  /* ---------- wiring ---------- */
  document.querySelectorAll("#compPills .pill").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("#compPills .pill").forEach((x) => x.classList.toggle("on", x === b));
    state.comp = b.dataset.comp; fillFixtures(); renderMatch();
  }));
  $("fixtureSel").addEventListener("change", (e) => { state.fixtureId = +e.target.value; renderMatch(); });
  ["oddsH", "oddsD", "oddsA"].forEach((id) => $(id).addEventListener("input", renderBook));
  $("runSim").addEventListener("click", runSim);

  fillFixtures(); renderMatch(); renderRatings(); renderMethod();
})();
