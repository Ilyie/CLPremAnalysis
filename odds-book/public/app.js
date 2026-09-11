// ── State
let db = null;
let ui = { view: "matches", comp: "PL", status: "upcoming", betsFilter: "open", eloComp: "PL" };
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const api = (method, url, body) => fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) }).then(r => r.json());
const OUT = ["Home", "Draw", "Away"];
const pct = x => (x * 100).toFixed(1) + "%";
const bar = p => ["h","d","a"].map((c, i) => `<div class="${c}" style="width:${pct(p[i])}">${p[i] >= 0.1 ? pct(p[i]) : ""}</div>`).join("");
const money = x => (x < 0 ? "−" : "") + Math.abs(x).toFixed(2);

// ── Elo → win/draw/loss (same model as the analysis artifact)
const fact = n => { let f = 1; for (let i = 2; i <= n; i++) f *= i; return f; };
const pois = (k, l) => Math.exp(-l) * Math.pow(l, k) / fact(k);
function wdl(eloH, eloA) {
  const { hfa, goals } = db.settings;
  const E = 1 / (1 + Math.pow(10, -(eloH + hfa - eloA) / 400));
  const lh = goals * E, la = goals * (1 - E);
  let H = 0, D = 0, A = 0;
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) { const p = pois(i, lh) * pois(j, la); if (i > j) H += p; else if (i === j) D += p; else A += p; }
  const s = H + D + A; return [H / s, D / s, A / s];
}
const eloOf = (comp, name) => (db.elo[comp].find(t => t.name === name) || { elo: 1600 }).elo;
const eloOdds = p => p.map(x => 1 / (x * (1 + db.settings.margin)));
const matchProbs = m => wdl(eloOf(m.comp, m.home), eloOf(m.comp, m.away));

// ── Bankroll
function bankroll() {
  const settled = db.bets.filter(b => b.result !== "open");
  const open = db.bets.filter(b => b.result === "open").reduce((s, b) => s + b.stake, 0);
  const pnl = settled.reduce((s, b) => s + b.pnl, 0);
  return { available: db.settings.startingBankroll + pnl - open, pnl, open };
}
function renderBank() {
  const b = bankroll();
  $("#bank").textContent = money(b.available);
  const d = $("#bank-delta"); d.textContent = (b.pnl >= 0 ? "+" : "") + money(b.pnl) + (b.open ? ` · ${money(b.open)} in open bets` : "");
  d.className = b.pnl >= 0 ? "pos" : "neg";
}

// ── Matches view
function renderMatches() {
  const list = $("#match-list"); list.innerHTML = "";
  let ms = db.matches.filter(m => m.comp === ui.comp);
  if (ui.status === "upcoming") ms = ms.filter(m => m.status === "scheduled");
  else if (ui.status !== "all") ms = ms.filter(m => m.status === ui.status);
  ms.sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.round.localeCompare(b.round));
  if (!ms.length) { list.innerHTML = `<div class="empty">No ${ui.status === "all" ? "" : ui.status} matches here yet. Add one with the button above.</div>`; return; }
  for (const m of ms) {
    const p = matchProbs(m), o = eloOdds(p);
    const bets = db.bets.filter(b => b.matchId === m.id);
    const el = document.createElement("div"); el.className = "match";
    el.innerHTML = `
      <div class="meta">${m.date || "no date"}<br>${m.round || ""}<br><span class="status ${m.status}">${{ scheduled: "scheduled", live: "in play", finished: "finished" }[m.status]}</span></div>
      <div><div class="teams">${m.home}<small>v</small>${m.away}${m.hg != null ? `<span class="score">${m.hg}–${m.ag}</span>` : ""}</div>
        <div class="odds-line"><span>Elo ${eloOf(m.comp, m.home)} v ${eloOf(m.comp, m.away)}</span><span>Elo book odds ${o.map(x => x.toFixed(2)).join(" / ")}</span></div></div>
      <div><div class="probbar">${bar(p)}</div></div>
      <div class="actions">
        ${m.status !== "finished" ? `<button class="primary small" data-act="bet">Place bet</button>` : ""}
        ${m.status === "scheduled" ? `<button class="ghost small" data-act="live">Kick off</button>` : ""}
        ${m.status !== "finished" ? `<button class="ghost small" data-act="result">Enter result</button>` : `<button class="ghost small" data-act="result">Edit result</button>`}
        <button class="ghost small" data-act="del" title="Delete match and its bets">✕</button>
      </div>
      ${bets.length ? `<div class="mybets">${bets.map(b => `<span class="${b.result}">${OUT[b.pick]} · ${money(b.stake)} @ ${b.odds.toFixed(2)} (${b.source === "elo" ? "Elo" : b.bookName || "book"})${b.result !== "open" ? ` → ${b.result} ${b.pnl >= 0 ? "+" : ""}${money(b.pnl)}` : ""}</span>`).join("")}</div>` : ""}`;
    el.querySelectorAll("[data-act]").forEach(btn => btn.onclick = () => action(btn.dataset.act, m));
    list.appendChild(el);
  }
}
async function action(act, m) {
  if (act === "bet") return openBet(m);
  if (act === "live") { await api("PUT", `/api/matches/${m.id}`, { status: "live" }); return refresh(); }
  if (act === "result") return openResult(m);
  if (act === "del" && confirm(`Delete ${m.home} v ${m.away} and any bets on it?`)) { await api("DELETE", `/api/matches/${m.id}`); return refresh(); }
}

// ── Add match
$("#btn-add-match").onclick = () => { $("#m-comp").value = ui.comp; fillTeamSelects(); $("#dlg-match").showModal(); };
$("#m-comp").onchange = fillTeamSelects;
function fillTeamSelects() {
  const names = db.elo[$("#m-comp").value].map(t => t.name);
  for (const id of ["#m-home", "#m-away"]) $(id).innerHTML = names.map(n => `<option>${n}</option>`).join("");
  $("#m-away").selectedIndex = 1;
}
$("#m-cancel").onclick = () => $("#dlg-match").close();
$("#form-match").onsubmit = async e => {
  if (e.submitter?.value !== "ok") return;
  const home = $("#m-home").value, away = $("#m-away").value;
  if (home === away) { e.preventDefault(); alert("Home and away must differ."); return; }
  await api("POST", "/api/matches", { comp: $("#m-comp").value, home, away, date: $("#m-date").value, round: $("#m-round").value });
  refresh();
};

// ── Place bet
let betMatch = null, betPick = 0;
function openBet(m) {
  betMatch = m; betPick = 0;
  const p = matchProbs(m), o = eloOdds(p);
  $("#b-title").textContent = `${m.home} v ${m.away}`;
  $("#b-probbar").innerHTML = bar(p);
  $("#b-odds").innerHTML = `<tr><th></th><th class="n">${m.home}</th><th class="n">Draw</th><th class="n">${m.away}</th></tr>
    <tr><td>Elo probability</td>${p.map(x => `<td class="n">${pct(x)}</td>`).join("")}</tr>
    <tr><td>Fair odds</td>${p.map(x => `<td class="n">${(1 / x).toFixed(2)}</td>`).join("")}</tr>
    <tr><td>Elo book odds (${(db.settings.margin * 100).toFixed(1)}% margin)</td>${o.map(x => `<td class="n">${x.toFixed(2)}</td>`).join("")}</tr>`;
  $("#b-pick").innerHTML = [m.home, "Draw", m.away].map((n, i) => `<label class="${i === 0 ? "on" : ""}"><input type="radio" name="pick" value="${i}" ${i === 0 ? "checked" : ""}>${n}<b>${o[i].toFixed(2)}</b></label>`).join("");
  $$("#b-pick label").forEach(l => l.onclick = () => { $$("#b-pick label").forEach(x => x.classList.remove("on")); l.classList.add("on"); betPick = +l.querySelector("input").value; updateBet(); });
  $("#b-source").value = "elo"; $("#b-bookname").value = ""; ["#b-oh", "#b-od", "#b-oa", "#b-myprob", "#b-note"].forEach(s => $(s).value = "");
  $("#b-stake").value = 10; $("#b-book-row").classList.add("hidden");
  updateBet(); $("#dlg-bet").showModal();
}
function currentOdds() {
  if ($("#b-source").value === "elo") return eloOdds(matchProbs(betMatch));
  return [+$("#b-oh").value, +$("#b-od").value, +$("#b-oa").value];
}
function updateBet() {
  const p = matchProbs(betMatch), o = currentOdds(), odds = o[betPick], stake = +$("#b-stake").value || 0;
  $("#b-return").value = odds > 1 ? `${money(stake * (odds - 1))} profit (${money(stake * odds)} back)` : "enter odds";
  $$("#b-pick label b").forEach((b, i) => b.textContent = o[i] > 1 ? o[i].toFixed(2) : "—");
  const my = +$("#b-myprob").value / 100;
  let s = odds > 1 ? `Elo gives this pick ${pct(p[betPick])}; these odds imply ${pct(1 / odds)}. Elo's edge: ${((p[betPick] * odds - 1) * 100).toFixed(1)}%.` : "";
  if (my) s += ` Your edge: ${((my * odds - 1) * 100).toFixed(1)}%.`;
  $("#b-edge").textContent = s;
}
$("#b-source").onchange = () => { $("#b-book-row").classList.toggle("hidden", $("#b-source").value === "elo"); updateBet(); };
["#b-oh", "#b-od", "#b-oa", "#b-stake", "#b-myprob"].forEach(s => $(s).oninput = updateBet);
$("#b-cancel").onclick = () => $("#dlg-bet").close();
$("#form-bet").onsubmit = async e => {
  if (e.submitter?.value !== "ok") return;
  const o = currentOdds(), odds = o[betPick], stake = +$("#b-stake").value;
  if (!(odds > 1)) { e.preventDefault(); alert("Enter valid odds for all three outcomes."); return; }
  if (stake > bankroll().available) { e.preventDefault(); alert("Stake is more than your available bankroll."); return; }
  const p = matchProbs(betMatch);
  await api("POST", "/api/bets", {
    matchId: betMatch.id, pick: betPick, stake, odds: +odds.toFixed(3), source: $("#b-source").value,
    bookName: $("#b-bookname").value, bookOdds: $("#b-source").value === "book" ? o : null,
    eloP: p.map(x => +x.toFixed(4)), eloOdds: eloOdds(p).map(x => +x.toFixed(3)),
    myProb: $("#b-myprob").value ? +$("#b-myprob").value / 100 : null, note: $("#b-note").value,
  });
  refresh();
};

// ── Enter result
let resultMatch = null;
function openResult(m) {
  resultMatch = m; $("#r-title").textContent = `${m.home} v ${m.away}`;
  $("#r-hl").firstChild.textContent = m.home + " "; $("#r-al").firstChild.textContent = m.away + " ";
  $("#r-hg").value = m.hg ?? ""; $("#r-ag").value = m.ag ?? ""; $("#dlg-result").showModal();
}
$("#r-cancel").onclick = () => $("#dlg-result").close();
$("#form-result").onsubmit = async e => {
  if (e.submitter?.value !== "ok") return;
  await api("PUT", `/api/matches/${resultMatch.id}`, { status: "finished", hg: +$("#r-hg").value, ag: +$("#r-ag").value });
  refresh();
};

// ── Bets view
function renderBets() {
  let bets = [...db.bets].sort((a, b) => b.placedAt.localeCompare(a.placedAt));
  if (ui.betsFilter === "open") bets = bets.filter(b => b.result === "open");
  if (ui.betsFilter === "settled") bets = bets.filter(b => b.result !== "open");
  const tb = $("#bets-table tbody"); tb.innerHTML = "";
  if (!bets.length) { tb.innerHTML = `<tr><td colspan="11" class="empty" style="border:0">No ${ui.betsFilter === "all" ? "" : ui.betsFilter} bets.</td></tr>`; return; }
  for (const b of bets) {
    const m = db.matches.find(x => x.id === b.matchId) || {};
    const tr = document.createElement("tr"); tr.className = b.result;
    tr.innerHTML = `<td>${b.placedAt.slice(0, 10)}</td><td>${m.home} v ${m.away}${m.hg != null ? ` <b>${m.hg}–${m.ag}</b>` : ""}<br><small>${m.comp} ${m.round || ""}</small></td>
      <td>${[m.home, "Draw", m.away][b.pick]}</td><td class="n">${money(b.stake)}</td><td class="n">${b.odds.toFixed(2)}</td>
      <td>${b.source === "elo" ? "Elo model" : b.bookName || "bookmaker"}</td><td class="n">${pct(b.eloP[b.pick])}</td><td class="n">${b.myProb ? pct(b.myProb) : "—"}</td>
      <td>${b.result}${b.correct === true ? " ✓" : b.correct === false ? " ✗" : ""}</td>
      <td class="n ${b.pnl > 0 ? "pos" : b.pnl < 0 ? "neg" : ""}">${b.result === "open" ? "—" : (b.pnl >= 0 ? "+" : "") + money(b.pnl)}</td>
      <td><button class="ghost small" title="Delete bet">✕</button></td>`;
    tr.querySelector("button").onclick = async () => { if (confirm("Delete this bet?")) { await api("DELETE", `/api/bets/${b.id}`); refresh(); } };
    tb.appendChild(tr);
  }
}

// ── Stats view
let chart = null;
function renderStats() {
  const settled = db.bets.filter(b => b.result !== "open").sort((a, b) => a.placedAt.localeCompare(b.placedAt));
  const staked = settled.reduce((s, b) => s + b.stake, 0), pnl = settled.reduce((s, b) => s + b.pnl, 0);
  const hits = settled.filter(b => b.correct).length;
  const brier = arr => arr.length ? arr.reduce((s, [p, y]) => s + (p - y) ** 2, 0) / arr.length : null;
  const kpi = (l, v, c = "") => `<div class="kpi"><span>${l}</span><strong class="${c}">${v}</strong></div>`;
  $("#kpis").innerHTML = kpi("Settled bets", settled.length) + kpi("Hit rate", settled.length ? pct(hits / settled.length) : "—")
    + kpi("Total staked", money(staked)) + kpi("Profit / loss", (pnl >= 0 ? "+" : "") + money(pnl), pnl >= 0 ? "pos" : "neg")
    + kpi("ROI", staked ? (pnl / staked * 100).toFixed(1) + "%" : "—", pnl >= 0 ? "pos" : "neg")
    + kpi("Avg odds taken", settled.length ? (settled.reduce((s, b) => s + b.odds, 0) / settled.length).toFixed(2) : "—");

  // bankroll curve
  let bank = db.settings.startingBankroll; const pts = [bank];
  for (const b of settled) { bank += b.pnl; pts.push(+bank.toFixed(2)); }
  const ctx = $("#bank-chart").getContext("2d");
  if (chart) chart.destroy();
  chart = new Chart(ctx, { type: "line", data: { labels: pts.map((_, i) => i), datasets: [{ label: "Bankroll after each settled bet", data: pts, borderColor: "#1F6B3F", backgroundColor: "rgba(31,107,63,.08)", fill: true, tension: .2, pointRadius: 2 }] },
    options: { animation: false, plugins: { legend: { display: false } }, scales: { x: { title: { display: true, text: "settled bets" } } } } });

  const group = (key, label) => {
    const g = {}; for (const b of settled) { const k = key(b); (g[k] ||= []).push(b); }
    const rows = Object.entries(g).map(([k, bs]) => { const st = bs.reduce((s, b) => s + b.stake, 0), pl = bs.reduce((s, b) => s + b.pnl, 0); return `<tr><td>${k}</td><td class="n">${bs.length}</td><td class="n">${pct(bs.filter(b => b.correct).length / bs.length)}</td><td class="n ${pl >= 0 ? "pos" : "neg"}">${(pl >= 0 ? "+" : "") + money(pl)}</td><td class="n">${(pl / st * 100).toFixed(1)}%</td></tr>`; });
    return `<tr><th>${label}</th><th class="n">Bets</th><th class="n">Hit</th><th class="n">P&amp;L</th><th class="n">ROI</th></tr>` + (rows.join("") || `<tr><td colspan="5" class="hint">nothing settled yet</td></tr>`);
  };
  $("#by-source").innerHTML = group(b => b.source === "elo" ? "Elo model" : b.bookName || "bookmaker", "Source");
  $("#by-pick").innerHTML = group(b => OUT[b.pick] + (b.odds < 2 ? " (favourite)" : b.odds >= 3 ? " (long shot)" : " (mid)"), "Pick");

  // calibration of my own probabilities
  const mine = settled.filter(b => b.myProb);
  const buckets = [[0, .35], [.35, .5], [.5, .65], [.65, 1.01]];
  $("#calib").innerHTML = `<tr><th>You said</th><th class="n">Bets</th><th class="n">Avg said</th><th class="n">Actually landed</th></tr>` + buckets.map(([lo, hi]) => {
    const bs = mine.filter(b => b.myProb >= lo && b.myProb < hi); if (!bs.length) return "";
    return `<tr><td>${pct(lo)}–${pct(Math.min(hi, 1))}</td><td class="n">${bs.length}</td><td class="n">${pct(bs.reduce((s, b) => s + b.myProb, 0) / bs.length)}</td><td class="n">${pct(bs.filter(b => b.correct).length / bs.length)}</td></tr>`;
  }).join("") || `<tr><td colspan="4" class="hint">type your own probability when placing bets to see this</td></tr>`;

  const rows = [["Elo model", brier(settled.map(b => [b.eloP[b.pick], b.correct ? 1 : 0]))], ["You", brier(mine.map(b => [b.myProb, b.correct ? 1 : 0]))],
    ["Bookmaker (from odds you typed)", brier(settled.filter(b => b.bookOdds).map(b => { const imp = b.bookOdds.map(o => 1 / o), s = imp.reduce((a, x) => a + x, 0); return [imp[b.pick] / s, b.correct ? 1 : 0]; }))]];
  $("#brier").innerHTML = `<tr><th>Forecaster</th><th class="n">Brier score</th></tr>` + rows.map(([n, v]) => `<tr><td>${n}</td><td class="n">${v == null ? "—" : v.toFixed(4)}</td></tr>`).join("");
}

// ── Settings view
function renderSettings() {
  const s = db.settings;
  $("#s-bank").value = s.startingBankroll; $("#s-hfa").value = s.hfa; $("#s-goals").value = s.goals; $("#s-margin").value = (s.margin * 100).toFixed(1);
  $("#elo-note").textContent = s.eloSnapshot;
  const grid = $("#elo-grid"); grid.innerHTML = "";
  for (const t of db.elo[ui.eloComp]) {
    const l = document.createElement("label");
    l.innerHTML = `<input type="number" step="1" value="${t.elo}" data-name="${t.name}"><span>${t.name}</span>${t.placeholder ? `<span class="ph">placeholder</span>` : ""}`;
    grid.appendChild(l);
  }
}
$("#btn-save-settings").onclick = async () => {
  await api("PUT", "/api/settings", { startingBankroll: +$("#s-bank").value, hfa: +$("#s-hfa").value, goals: +$("#s-goals").value, margin: +$("#s-margin").value / 100 });
  refresh();
};
$("#btn-save-elo").onclick = async () => {
  const list = $$("#elo-grid input").map(i => ({ name: i.dataset.name, elo: +i.value, placeholder: false }));
  await api("PUT", `/api/elo/${ui.eloComp}`, list); refresh();
};

// ── Wiring
$$("nav button").forEach(b => b.onclick = () => { ui.view = b.dataset.view; $$("nav button").forEach(x => x.classList.toggle("on", x === b)); $$(".view").forEach(v => v.classList.toggle("on", v.id === "view-" + ui.view)); render(); });
const seg = (sel, key, prop) => $$(sel + " button").forEach(b => b.onclick = () => { ui[key] = b.dataset[prop]; $$(sel + " button").forEach(x => x.classList.toggle("on", x === b)); render(); });
seg("#comp-seg", "comp", "comp"); seg("#status-seg", "status", "status"); seg("#bets-seg", "betsFilter", "f"); seg("#elo-seg", "eloComp", "comp");

function render() {
  renderBank();
  ({ matches: renderMatches, bets: renderBets, stats: renderStats, settings: renderSettings })[ui.view]();
}
async function refresh() { db = await api("GET", "/api/state"); render(); }
refresh();
