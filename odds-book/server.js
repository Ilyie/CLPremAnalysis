// Odds Book — local server. Binds to 127.0.0.1 only, so nothing outside this laptop can reach it.
const express = require("express");
const fs = require("fs");
const path = require("path");

const PORT = 3000;
const DATA_FILE = path.join(__dirname, "data", "data.json");
const SEED_FILE = path.join(__dirname, "data", "seed.json");

// ── Storage: one JSON file. Read on every request, write on every change. Fine for a single user.
function load() {
  if (!fs.existsSync(DATA_FILE)) fs.copyFileSync(SEED_FILE, DATA_FILE);
  const db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  // If seed.json gained fixtures since data.json was created, pull them in without touching existing data.
  const seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf8"));
  const have = new Set(db.matches.map(m => m.id));
  const missing = seed.matches.filter(m => !have.has(m.id));
  if (missing.length) { db.matches.push(...missing); save(db); console.log(`Added ${missing.length} fixtures from seed.json`); }
  return db;
}
function save(db) {
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE); // atomic swap so a crash mid-write can't corrupt the file
}
const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/state", (req, res) => res.json(load()));

app.put("/api/settings", (req, res) => {
  const db = load(); Object.assign(db.settings, req.body); save(db); res.json(db.settings);
});

app.put("/api/elo/:comp", (req, res) => {
  const db = load(); db.elo[req.params.comp] = req.body; save(db); res.json(db.elo);
});

// Matches
app.post("/api/matches", (req, res) => {
  const db = load();
  const m = { id: id(), comp: "PL", home: "", away: "", date: "", round: "", status: "scheduled", hg: null, ag: null, note: "", ...req.body };
  db.matches.push(m); save(db); res.json(m);
});
app.put("/api/matches/:id", (req, res) => {
  const db = load();
  const m = db.matches.find(x => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: "match not found" });
  Object.assign(m, req.body);
  if (m.status === "finished" && m.hg != null && m.ag != null) settle(db, m);
  save(db); res.json(m);
});
app.delete("/api/matches/:id", (req, res) => {
  const db = load();
  db.matches = db.matches.filter(x => x.id !== req.params.id);
  db.bets = db.bets.filter(b => b.matchId !== req.params.id);
  save(db); res.json({ ok: true });
});

// Bets
app.post("/api/bets", (req, res) => {
  const db = load();
  const b = { id: id(), placedAt: new Date().toISOString(), result: "open", pnl: 0, ...req.body };
  db.bets.push(b);
  const m = db.matches.find(x => x.id === b.matchId);
  if (m && m.status === "finished" && m.hg != null) settle(db, m);
  save(db); res.json(b);
});
app.delete("/api/bets/:id", (req, res) => {
  const db = load(); db.bets = db.bets.filter(b => b.id !== req.params.id); save(db); res.json({ ok: true });
});

// Settle every bet on a finished match: outcome 0 = home, 1 = draw, 2 = away
function settle(db, m) {
  const outcome = m.hg > m.ag ? 0 : m.hg === m.ag ? 1 : 2;
  for (const b of db.bets.filter(b => b.matchId === m.id)) {
    b.correct = b.pick === outcome;
    b.result = b.correct ? "won" : "lost";
    b.pnl = b.correct ? +(b.stake * (b.odds - 1)).toFixed(2) : -b.stake;
  }
}

// CSV export for analysis in Python / Excel
app.get("/api/export.csv", (req, res) => {
  const db = load();
  const rows = [["bet_id","placed_at","comp","round","date","home","away","pick","stake","odds","odds_source","elo_p_home","elo_p_draw","elo_p_away","my_prob","hg","ag","result","correct","pnl","bankroll_after"]];
  let bank = db.settings.startingBankroll;
  const bets = [...db.bets].sort((a, b) => a.placedAt.localeCompare(b.placedAt));
  for (const b of bets) {
    const m = db.matches.find(x => x.id === b.matchId) || {};
    if (b.result !== "open") bank += b.pnl;
    rows.push([b.id, b.placedAt, m.comp, m.round, m.date, m.home, m.away, ["home","draw","away"][b.pick], b.stake, b.odds, b.source,
      b.eloP?.[0], b.eloP?.[1], b.eloP?.[2], b.myProb ?? "", m.hg ?? "", m.ag ?? "", b.result, b.correct ?? "", b.pnl, b.result === "open" ? "" : bank.toFixed(2)]);
  }
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=bets.csv");
  res.send(rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n"));
});

app.listen(PORT, "127.0.0.1", () => console.log(`Odds Book running → http://localhost:${PORT}  (only this machine can reach it)`));
