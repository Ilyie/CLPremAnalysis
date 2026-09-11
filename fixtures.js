(async () => {
  const MY_TEAM = "Arsenal";
  const ctx = await FM.buildContext();
  const { data } = ctx;
  const state = { comp: "pl", team: "", show: "upcoming", view: "table" };
  const $ = (id) => document.getElementById(id);
  $("snapshotNote").textContent = `Data snapshot: ${FM.CONFIG.snapshotDate} (fixturedownload.com, Understat xG). Probabilities come from the same model as the analysis page.`;

  const COMP = {
    pl: { name: "Premier League", roundLabel: "Matchweek", zones: [{ cls: "zone-a", from: 1, to: 4, label: "Champions League" }, { cls: "zone-b", from: 5, to: 5, label: "Europa League" }, { cls: "zone-c", from: 18, to: 20, label: "Relegation" }] },
    ucl: { name: "Champions League", roundLabel: "Matchday", zones: [{ cls: "zone-a", from: 1, to: 8, label: "Round of 16" }, { cls: "zone-b", from: 9, to: 24, label: "Knockout play-off" }, { cls: "zone-c", from: 25, to: 36, label: "Eliminated" }] },
  };
  const predCache = new Map();
  const predictionFor = (m) => { const k = state.comp + m.id; if (!predCache.has(k)) predCache.set(k, FM.predict(m, state.comp, ctx)); return predCache.get(k); };
  const analysisLink = (m) => `analysis.html?comp=${state.comp}&match=${m.id}`;

  function fillTeams() {
    const teams = FM.teamsOf(data[state.comp]);
    $("teamFilter").innerHTML = '<option value="">All teams</option>' + teams.map((t) => `<option value="${t}" ${t === state.team ? "selected" : ""}>${t}</option>`).join("");
    if (!teams.includes(state.team)) { state.team = ""; $("teamFilter").value = ""; }
  }
  const visible = () => {
    let ms = data[state.comp];
    if (state.team) ms = ms.filter((m) => m.home === state.team || m.away === state.team);
    if (state.show === "upcoming") ms = ms.filter((m) => !m.played);
    if (state.show === "results") ms = ms.filter((m) => m.played);
    return ms;
  };

  /* ---------- this week strip with countdown ---------- */
  function renderWeek() {
    const now = new Date(), horizon = new Date(now.getTime() + 7 * 864e5);
    let ms = data[state.comp].filter((m) => !m.played && m.date >= now && m.date <= horizon);
    if (state.team) ms = ms.filter((m) => m.home === state.team || m.away === state.team);
    const mine = ms.filter((m) => m.home === MY_TEAM || m.away === MY_TEAM);
    const pick = [...mine, ...ms.filter((m) => !mine.includes(m)).sort((a, b) => FM.entropy([predictionFor(a).H, predictionFor(a).D, predictionFor(a).A]) - FM.entropy([predictionFor(b).H, predictionFor(b).D, predictionFor(b).A]))].slice(0, 4);
    if (!pick.length) { $("weekStrip").innerHTML = ""; return; }
    $("weekStrip").innerHTML = pick.map((m, i) => {
      const p = predictionFor(m), fav = p.H >= p.A ? m.home : m.away, favP = Math.max(p.H, p.A);
      const tag = i === 0 && mine.includes(m) ? "Next for " + MY_TEAM : FM.entropy([p.H, p.D, p.A]) > 1.5 ? "Toss-up this week" : "This week";
      return `<a class="week-card" href="${analysisLink(m)}"><div class="k">${tag}</div><div class="t">${m.home} v ${m.away}</div><div class="s">${FM.fmtDate(m.date)} · ${fav} ${FM.pct(favP)}</div><div class="countdown" data-ts="${m.date.getTime()}"></div></a>`;
    }).join("");
    tickCountdown();
  }
  function tickCountdown() {
    const now = Date.now();
    document.querySelectorAll(".countdown").forEach((el) => {
      const d = +el.dataset.ts - now; if (d < 0) { el.textContent = "Kicked off"; return; }
      const h = Math.floor(d / 36e5), m = Math.floor((d % 36e5) / 6e4);
      el.textContent = h >= 48 ? `in ${Math.floor(h / 24)}d ${h % 24}h` : `in ${h}h ${String(m).padStart(2, "0")}m`;
    });
  }
  setInterval(tickCountdown, 60000);

  /* ---------- fixture list ---------- */
  function renderList() {
    const comp = COMP[state.comp], matches = visible();
    if (!matches.length) { $("fixtureList").innerHTML = '<p class="empty">Nothing to show.</p>'; $("roundNav").innerHTML = ""; return; }
    const nextId = data[state.comp].find((m) => !m.played && (!state.team || m.home === state.team || m.away === state.team))?.id;
    const rounds = new Map();
    matches.forEach((m) => { if (!rounds.has(m.round)) rounds.set(m.round, []); rounds.get(m.round).push(m); });
    $("roundNav").innerHTML = rounds.size > 1 ? `<span class="note" style="margin:0 0.4rem 0 0">${comp.roundLabel}</span>` + [...rounds.keys()].map((r) => `<button data-round="${r}">${r}</button>`).join("") : "";
    $("roundNav").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { document.getElementById("round-" + b.dataset.round)?.scrollIntoView({ behavior: "smooth", block: "start" }); }));
    $("fixtureList").innerHTML = [...rounds.entries()].map(([r, ms]) => {
      const first = ms[0].date, last = ms[ms.length - 1].date;
      const span = first.toDateString() === last.toDateString() ? FM.fmtDate(first, { day: "numeric", month: "short" }) : `${FM.fmtDate(first, { day: "numeric", month: "short" })} – ${FM.fmtDate(last, { day: "numeric", month: "short" })}`;
      return `<section class="round" id="round-${r}"><div class="round-head"><span>${comp.roundLabel} ${r}</span><span>${span}</span></div>${ms.map((m) => renderMatch(nextId, m)).join("")}</section>`;
    }).join("");
  }
  function renderMatch(nextId, m) {
    const mine = m.home === MY_TEAM || m.away === MY_TEAM;
    let scoreCls = "m-score", score = FM.fmtDate(m.date, { hour: "2-digit", minute: "2-digit" }), prob = "";
    if (m.played) {
      score = `${m.hg} – ${m.ag}`; scoreCls += " done";
      const focus = state.team || (mine ? MY_TEAM : null);
      if (focus) { const isHome = m.home === focus, gf = isHome ? m.hg : m.ag, ga = isHome ? m.ag : m.hg; scoreCls += gf > ga ? " win" : gf < ga ? " loss" : " draw"; }
      prob = m.xgh != null ? `<div class="m-prob"><div class="pt"><span>xG ${m.xgh.toFixed(1)}</span><span>${m.xga.toFixed(1)}</span></div></div>` : `<div></div>`;
    } else {
      const p = predictionFor(m);
      prob = `<div class="m-prob"><a href="${analysisLink(m)}" title="Open analysis"><div class="pb"><i class="h" style="width:${(p.H * 100).toFixed(1)}%"></i><i class="d" style="width:${(p.D * 100).toFixed(1)}%"></i><i class="a" style="width:${(p.A * 100).toFixed(1)}%"></i></div><div class="pt"><span>${FM.pct(p.H)}</span><span>${FM.pct(p.D)}</span><span>${FM.pct(p.A)}</span></div></a></div>`;
    }
    return `<div class="match ${mine ? "mine" : ""} ${m.id === nextId ? "next-up" : ""}">
      <div class="m-date"><b>${FM.fmtDate(m.date, { weekday: "short", day: "numeric", month: "short" })}</b>${m.played ? "FT" : FM.fmtDate(m.date, { hour: "2-digit", minute: "2-digit" })}</div>
      <div class="m-home">${m.home}</div><div class="${scoreCls}">${score}</div><div class="m-away">${m.away}</div>${prob}
      <div class="m-venue">${m.venue}</div></div>`;
  }

  /* ---------- tables ---------- */
  function renderTable() {
    const comp = COMP[state.comp];
    const hasXG = state.comp === "pl" && data.pl.some((m) => m.xgh != null);
    $("tblToggle").style.display = hasXG ? "" : "none";
    if (!hasXG) state.view = "table";
    const zone = (pos) => comp.zones.find((z) => pos >= z.from && pos <= z.to)?.cls || "";
    const rowCls = (t, i) => `${zone(i + 1)} ${t === MY_TEAM || t === state.team ? "mine" : ""}`;
    if (state.view === "xg") {
      const rows = FM.xgTable(data.pl);
      $("tableTitle").textContent = "xG table · sorted by expected points";
      $("tableWrap").innerHTML = `<table class="tbl"><thead><tr><th>#</th><th>Team</th><th>P</th><th>xG</th><th>xGA</th><th>xPts</th><th>Pts</th><th title="Points minus expected points">Luck</th></tr></thead><tbody>${rows.map((r, i) => `<tr class="${rowCls(r.team, i)}"><td>${i + 1}</td><td class="team">${r.team}</td><td>${r.p}</td><td>${r.xg.toFixed(1)}</td><td>${r.xga.toFixed(1)}</td><td><b style="color:var(--text)">${r.xpts.toFixed(1)}</b></td><td>${r.pts}</td><td class="${r.luck > 0.5 ? "luck-pos" : r.luck < -0.5 ? "luck-neg" : ""}">${r.luck > 0 ? "+" : ""}${r.luck.toFixed(1)}</td></tr>`).join("")}</tbody></table>`;
      $("tableLegend").innerHTML = `<span>xPts = points a team's xG "deserved", from the same scoreline model as the predictions. Luck &gt; 0 = ahead of its underlying numbers.</span>`;
      return;
    }
    const rows = FM.table(data[state.comp]);
    $("tableTitle").textContent = `${comp.name} table · after ${rows.reduce((s, r) => s + r.p, 0) / 2} games`;
    $("tableWrap").innerHTML = `<table class="tbl"><thead><tr><th>#</th><th>Team</th><th>P</th><th>GD</th><th>Pts</th><th>Form</th></tr></thead><tbody>${rows.map((r, i) => `<tr class="${rowCls(r.team, i)}"><td>${i + 1}</td><td class="team">${r.team}</td><td>${r.p}</td><td>${r.gd > 0 ? "+" : ""}${r.gd}</td><td><b style="color:var(--text)">${r.pts}</b></td><td><span class="form">${r.form.map((f) => `<i class="${f}">${f}</i>`).join("")}</span></td></tr>`).join("")}</tbody></table>`;
    const colors = { "zone-a": "var(--blue)", "zone-b": "var(--violet)", "zone-c": "var(--red)" };
    $("tableLegend").innerHTML = comp.zones.map((z) => `<span><i style="background:${colors[z.cls]}"></i>${z.label}</span>`).join("");
  }

  /* ---------- calendar export ---------- */
  function exportICS() {
    const ms = visible().filter((m) => !m.played);
    if (!ms.length) return;
    const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const esc = (s) => String(s).replace(/([,;])/g, "\\$1");
    const name = COMP[state.comp].name + (state.team ? " · " + state.team : "");
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CLPremAnalysis//Fixtures//EN", `X-WR-CALNAME:${esc(name)}`];
    ms.forEach((m) => {
      const p = predictionFor(m);
      lines.push("BEGIN:VEVENT", `UID:clprem-${state.comp}-${m.id}@clpremanalysis`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(m.date)}`, `DTEND:${stamp(new Date(m.date.getTime() + 2 * 36e5))}`,
        `SUMMARY:${esc(`${m.home} v ${m.away}`)}`, `LOCATION:${esc(m.venue)}`, `DESCRIPTION:${esc(`${COMP[state.comp].roundLabel} ${m.round}. Model: ${m.home} ${FM.pct(p.H)} / draw ${FM.pct(p.D)} / ${m.away} ${FM.pct(p.A)}`)}`, "END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    const blob = new Blob([lines.join("\r\n")], { type: "text/calendar" }), url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.ics` });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function render() { renderWeek(); renderList(); renderTable(); }
  document.querySelectorAll("#compPills .pill").forEach((b) => b.addEventListener("click", () => { document.querySelectorAll("#compPills .pill").forEach((x) => x.classList.toggle("on", x === b)); state.comp = b.dataset.comp; fillTeams(); render(); }));
  $("teamFilter").addEventListener("change", (e) => { state.team = e.target.value; render(); });
  $("showFilter").addEventListener("change", (e) => { state.show = e.target.value; render(); });
  $("tblToggle").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { $("tblToggle").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); state.view = b.dataset.view; renderTable(); }));
  $("icsBtn").addEventListener("click", exportICS);

  const params = new URLSearchParams(location.search);
  if (params.get("comp") === "ucl") document.querySelector('[data-comp="ucl"]').click();
  if (params.get("team")) state.team = params.get("team");
  fillTeams(); render();
})();
