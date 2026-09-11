(async () => {
  const MY_TEAM = "Arsenal";
  const data = await FM.loadAll();
  const state = { comp: "pl", team: "", show: "upcoming" };
  const listEl = document.getElementById("fixtureList");
  const teamSel = document.getElementById("teamFilter");
  const showSel = document.getElementById("showFilter");
  document.getElementById("snapshotNote").textContent = `Data snapshot: ${FM.CONFIG.snapshotDate} (fixturedownload.com). Kick-off times converted to your timezone.`;

  const COMP = {
    pl: { name: "Premier League", roundLabel: "Matchweek", zones: [{ cls: "zone-a", from: 1, to: 4, label: "Champions League" }, { cls: "zone-b", from: 5, to: 5, label: "Europa League" }, { cls: "zone-c", from: 18, to: 20, label: "Relegation" }] },
    ucl: { name: "Champions League", roundLabel: "Matchday", zones: [{ cls: "zone-a", from: 1, to: 8, label: "Round of 16" }, { cls: "zone-b", from: 9, to: 24, label: "Knockout play-off" }, { cls: "zone-c", from: 25, to: 36, label: "Eliminated" }] },
  };

  function fillTeams() {
    const teams = FM.teamsOf(data[state.comp]);
    teamSel.innerHTML = '<option value="">All teams</option>' + teams.map((t) => `<option value="${t}" ${t === state.team ? "selected" : ""}>${t}</option>`).join("");
    if (!teams.includes(state.team)) { state.team = ""; teamSel.value = ""; }
  }

  function renderList() {
    const comp = COMP[state.comp];
    let matches = data[state.comp];
    if (state.team) matches = matches.filter((m) => m.home === state.team || m.away === state.team);
    if (state.show === "upcoming") matches = matches.filter((m) => !m.played);
    if (state.show === "results") matches = matches.filter((m) => m.played);
    if (!matches.length) { listEl.innerHTML = '<p class="empty">Nothing to show.</p>'; return; }

    const nextId = data[state.comp].find((m) => !m.played && (!state.team || m.home === state.team || m.away === state.team))?.id;
    const rounds = new Map();
    matches.forEach((m) => { if (!rounds.has(m.round)) rounds.set(m.round, []); rounds.get(m.round).push(m); });

    listEl.innerHTML = [...rounds.entries()].map(([r, ms]) => {
      const first = ms[0].date, last = ms[ms.length - 1].date;
      const span = first.toDateString() === last.toDateString()
        ? FM.fmtDate(first, { day: "numeric", month: "short" })
        : `${FM.fmtDate(first, { day: "numeric", month: "short" })} – ${FM.fmtDate(last, { day: "numeric", month: "short" })}`;
      return `<section class="round"><div class="round-head"><span>${comp.roundLabel} ${r}</span><span>${span}</span></div>${ms.map(renderMatch.bind(null, nextId)).join("")}</section>`;
    }).join("");
  }

  function renderMatch(nextId, m) {
    const mine = m.home === MY_TEAM || m.away === MY_TEAM;
    let scoreCls = "m-score", score = FM.fmtDate(m.date, { hour: "2-digit", minute: "2-digit" });
    if (m.played) {
      score = `${m.hg} – ${m.ag}`; scoreCls += " done";
      const focus = state.team || (mine ? MY_TEAM : null);
      if (focus) {
        const isHome = m.home === focus, gf = isHome ? m.hg : m.ag, ga = isHome ? m.ag : m.hg;
        scoreCls += gf > ga ? " win" : gf < ga ? " loss" : " draw";
      }
    }
    return `<div class="match ${mine ? "mine" : ""} ${m.id === nextId ? "next-up" : ""}">
      <div class="m-date"><b>${FM.fmtDate(m.date, { weekday: "short", day: "numeric", month: "short" })}</b>${m.played ? "FT" : FM.fmtDate(m.date, { hour: "2-digit", minute: "2-digit" })}</div>
      <div class="m-home">${m.home}</div>
      <div class="${scoreCls}">${score}</div>
      <div class="m-away">${m.away}</div>
      <div class="m-venue">${m.venue}</div>
    </div>`;
  }

  function renderTable() {
    const comp = COMP[state.comp];
    const rows = FM.table(data[state.comp]);
    document.getElementById("tableTitle").textContent = `${comp.name} table · after ${rows.reduce((s, r) => s + r.p, 0) / 2} games`;
    const zone = (pos) => comp.zones.find((z) => pos >= z.from && pos <= z.to)?.cls || "";
    document.getElementById("tableWrap").innerHTML = `<table class="tbl"><thead><tr><th>#</th><th>Team</th><th>P</th><th>GD</th><th>Pts</th><th>Form</th></tr></thead><tbody>${rows.map((r, i) => `<tr class="${zone(i + 1)} ${r.team === MY_TEAM ? "mine" : ""} ${state.team === r.team ? "mine" : ""}"><td>${i + 1}</td><td class="team">${r.team}</td><td>${r.p}</td><td>${r.gd > 0 ? "+" : ""}${r.gd}</td><td><b style="color:var(--text)">${r.pts}</b></td><td><span class="form">${r.form.map((f) => `<i class="${f}">${f}</i>`).join("")}</span></td></tr>`).join("")}</tbody></table>`;
    const colors = { "zone-a": "var(--blue)", "zone-b": "var(--violet)", "zone-c": "var(--red)" };
    document.getElementById("tableLegend").innerHTML = comp.zones.map((z) => `<span><i style="background:${colors[z.cls]}"></i>${z.label}</span>`).join("");
  }

  function render() { renderList(); renderTable(); }

  document.querySelectorAll("#compPills .pill").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("#compPills .pill").forEach((x) => x.classList.toggle("on", x === b));
    state.comp = b.dataset.comp; fillTeams(); render();
  }));
  teamSel.addEventListener("change", () => { state.team = teamSel.value; render(); });
  showSel.addEventListener("change", () => { state.show = showSel.value; render(); });

  const params = new URLSearchParams(location.search);
  if (params.get("comp") === "ucl") document.querySelector('[data-comp="ucl"]').click();
  if (params.get("team")) { state.team = params.get("team"); }
  fillTeams(); render();
})();
