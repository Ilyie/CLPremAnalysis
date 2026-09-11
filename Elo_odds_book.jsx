import { useState, useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";

// ── Club Elo snapshot (latest openly mirrored copy of clubelo.com, 6 Apr 2025).
// est:true = not in the snapshot; placeholder to replace from clubelo.com.
const PL_TEAMS = [
  ["Arsenal",2001],["Aston Villa",1837],["Bournemouth",1780],["Brentford",1764],["Brighton",1787],
  ["Chelsea",1855],["Coventry",1545],["Crystal Palace",1803],["Everton",1749],["Fulham",1780],
  ["Hull",1483],["Ipswich",1600,true],["Leeds",1683],["Liverpool",2017],["Man City",1919],
  ["Man United",1787],["Newcastle",1842],["Nott'm Forest",1812],["Sunderland",1555],["Tottenham",1790],
];
const CL_TEAMS = [
  ["AEK Athens",1557],["Arsenal",2001],["Aston Villa",1837],["Atlético",1865],["Barcelona",1955],
  ["Bayern",1923],["Bodø/Glimt",1640],["Dortmund",1780],["Club Brugge",1720],["Como",1598],
  ["Fenerbahçe",1697],["Feyenoord",1750],["Galatasaray",1669],["Inter",1964],["LASK",1426],
  ["Lens",1672],["Lille",1776],["Liverpool",2017],["Man City",1919],["Man United",1787],
  ["Napoli",1836],["Paris SG",1959],["Porto",1694],["PSV",1770],["RB Leipzig",1737],
  ["Betis",1745],["Real Madrid",1964],["Roma",1790],["Sabah",1400,true],["Shakhtar",1650,true],
  ["Slavia Praha",1650,true],["Slovan Bratislava",1500,true],["Sporting",1779],["Stuttgart",1713],
  ["Viking",1471],["Villarreal",1767],
];
// Real 26/27 league-phase fixtures (home, away), all 8 matchdays.
const CL_FIX = `AEK Athens-LASK,Club Brugge-Aston Villa,Dortmund-Villarreal,Porto-Man City,Lille-Betis,Real Madrid-Inter,Barcelona-Feyenoord,Stuttgart-Viking,Liverpool-Atlético,Paris SG-Slovan Bratislava,Sporting-Galatasaray,Napoli-Arsenal,Fenerbahçe-Roma,PSV-Shakhtar,Como-RB Leipzig,Bayern-Bodø/Glimt,Man United-Sabah,Slavia Praha-Lens,
Lens-Sporting,Sabah-Slavia Praha,Arsenal-Lille,Atlético-Man United,Inter-Club Brugge,Galatasaray-Barcelona,RB Leipzig-PSV,Viking-Bayern,Villarreal-Napoli,Feyenoord-Como,LASK-Liverpool,Roma-Real Madrid,Aston Villa-Fenerbahçe,Shakhtar-AEK Athens,Bodø/Glimt-Dortmund,Man City-Paris SG,Betis-Porto,Slovan Bratislava-Stuttgart,
Fenerbahçe-Slavia Praha,Sabah-Dortmund,Roma-Slovan Bratislava,Porto-PSV,Liverpool-Villarreal,Man City-AEK Athens,Paris SG-Barcelona,Napoli-Bodø/Glimt,Stuttgart-Atlético,Como-Man United,Lille-Galatasaray,Aston Villa-Viking,Club Brugge-Lens,Bayern-Arsenal,Inter-Shakhtar,Real Madrid-RB Leipzig,Betis-Feyenoord,Sporting-LASK,
Shakhtar-Sporting,Galatasaray-Stuttgart,Atlético-Bayern,Barcelona-Aston Villa,Feyenoord-Inter,Bodø/Glimt-Lille,LASK-Slovan Bratislava,Man United-Roma,Villarreal-Paris SG,AEK Athens-Real Madrid,Fenerbahçe-Liverpool,Dortmund-Betis,Porto-Napoli,PSV-Club Brugge,RB Leipzig-Man City,Lens-Como,Slavia Praha-Arsenal,Viking-Sabah,
Bodø/Glimt-LASK,Galatasaray-Aston Villa,Arsenal-Dortmund,Como-AEK Athens,Feyenoord-Porto,Man City-Napoli,RB Leipzig-Lens,Real Madrid-PSV,Slovan Bratislava-Betis,Sabah-Barcelona,Slavia Praha-Villarreal,Atlético-Viking,Club Brugge-Liverpool,Inter-Stuttgart,Shakhtar-Fenerbahçe,Lille-Bayern,Paris SG-Roma,Sporting-Man United,
Viking-Feyenoord,Villarreal-Sabah,AEK Athens-Galatasaray,Roma-Sporting,Aston Villa-Paris SG,Barcelona-Man City,Bayern-Slavia Praha,Man United-RB Leipzig,Napoli-Club Brugge,Betis-Como,Slovan Bratislava-Shakhtar,Arsenal-Real Madrid,Dortmund-Inter,LASK-Fenerbahçe,Liverpool-Porto,PSV-Atlético,Lens-Bodø/Glimt,Stuttgart-Lille,
Bodø/Glimt-Atlético,Galatasaray-Feyenoord,AEK Athens-Roma,Aston Villa-Dortmund,Inter-Liverpool,Porto-Slavia Praha,Lille-Slovan Bratislava,Real Madrid-LASK,Stuttgart-Club Brugge,Fenerbahçe-Villarreal,Sabah-Napoli,Como-Paris SG,Man United-Bayern,RB Leipzig-Shakhtar,Lens-Man City,Betis-Arsenal,Sporting-Barcelona,Viking-PSV,
Arsenal-Sabah,Roma-Lille,Atlético-Fenerbahçe,Dortmund-AEK Athens,Club Brugge-Bodø/Glimt,Bayern-Betis,Barcelona-Como,Shakhtar-Real Madrid,Feyenoord-RB Leipzig,LASK-Porto,Liverpool-Lens,Man City-Sporting,Paris SG-Galatasaray,PSV-Stuttgart,Slavia Praha-Aston Villa,Napoli-Viking,Villarreal-Man United,Slovan Bratislava-Inter`
  .split(/,\s*/).map(s => s.split("-"));

// ── Maths
const fact = n => { let f = 1; for (let i = 2; i <= n; i++) f *= i; return f; };
const pois = (k, l) => Math.exp(-l) * Math.pow(l, k) / fact(k);
function wdl(eloH, eloA, hfa, goals) {
  const dr = eloH + hfa - eloA;
  const E = 1 / (1 + Math.pow(10, -dr / 400));   // Elo expected score
  const lh = goals * E, la = goals * (1 - E);     // split total goals by strength
  let H = 0, D = 0, A = 0;
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
    const p = pois(i, lh) * pois(j, la);
    if (i > j) H += p; else if (i === j) D += p; else A += p;
  }
  const s = H + D + A;
  return [H / s, D / s, A / s];
}
const bookOdds = (p, margin) => p.map(x => 1 / (x * (1 + margin)));
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const gauss = r => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

const STRATS = [
  ["favorite", "Always back the favorite", "#1F6B3F"],
  ["underdog", "Always back the underdog", "#B23A3A"],
  ["draw", "Always back the draw", "#6B6B6B"],
  ["home", "Always back the home side", "#3F6BA6"],
  ["value", "Value bets (flat stake)", "#C9871B"],
  ["kelly", "Value bets (¼ Kelly stake)", "#7A3FA6"],
];

function simulate({ teams, fixtures, hfa, goals, margin, bookErr, myErr, edge, runs, seed }) {
  const elo = Object.fromEntries(teams.map(t => [t.name, t.elo]));
  const N = fixtures.length, start = 100, stake = 1;
  const curves = STRATS.map(() => new Float64Array(N + 1));
  const stats = STRATS.map(() => ({ final: 0, bets: 0, wins: 0, profitable: 0, dd: 0 }));
  for (let run = 0; run < runs; run++) {
    const r = rng(seed + run * 7919);
    const bookNoise = {}, myNoise = {};
    for (const t of teams) { bookNoise[t.name] = gauss(r) * bookErr; myNoise[t.name] = gauss(r) * myErr; }
    const fx = [...fixtures]; for (let i = fx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [fx[i], fx[j]] = [fx[j], fx[i]]; }
    const bank = STRATS.map(() => start), peak = STRATS.map(() => start), dd = STRATS.map(() => 0);
    STRATS.forEach((_, s) => curves[s][0] += start);
    fx.forEach(([h, a], g) => {
      const truth = wdl(elo[h], elo[a], hfa, goals);
      const book = bookOdds(wdl(elo[h] + bookNoise[h], elo[a] + bookNoise[a], hfa, goals), margin);
      const mine = wdl(elo[h] + myNoise[h], elo[a] + myNoise[a], hfa, goals);
      const u = r(); const result = u < truth[0] ? 0 : u < truth[0] + truth[1] ? 1 : 2;
      const fav = book.indexOf(Math.min(...book)), dog = book.indexOf(Math.max(...book));
      const ev = mine.map((p, i) => p * book[i] - 1);
      const best = ev.indexOf(Math.max(...ev));
      STRATS.forEach(([key], s) => {
        if (bank[s] <= 0) { curves[s][g + 1] += 0; return; }
        let pick = -1, amt = 0;
        if (key === "favorite") { pick = fav; amt = stake; }
        else if (key === "underdog") { pick = dog; amt = stake; }
        else if (key === "draw") { pick = 1; amt = stake; }
        else if (key === "home") { pick = 0; amt = stake; }
        else if (ev[best] > edge) {
          pick = best;
          if (key === "value") amt = stake;
          else { const b = book[best] - 1, p = mine[best]; amt = Math.min(bank[s] * 0.25 * (p * b - (1 - p)) / b, bank[s] * 0.1); }
        }
        if (pick >= 0 && amt > 0) {
          amt = Math.min(amt, bank[s]);
          stats[s].bets++;
          if (result === pick) { bank[s] += amt * (book[pick] - 1); stats[s].wins++; } else bank[s] -= amt;
        }
        peak[s] = Math.max(peak[s], bank[s]); dd[s] = Math.max(dd[s], (peak[s] - bank[s]) / peak[s]);
        curves[s][g + 1] += Math.max(bank[s], 0);
      });
    });
    STRATS.forEach((_, s) => { stats[s].final += bank[s]; if (bank[s] > start) stats[s].profitable++; stats[s].dd += dd[s]; });
  }
  const step = Math.max(1, Math.floor(N / 120));
  const chart = [];
  for (let g = 0; g <= N; g += step) { const row = { g }; STRATS.forEach(([k], s) => row[k] = +(curves[s][g] / runs).toFixed(2)); chart.push(row); }
  return { chart, stats: stats.map(s => ({ final: s.final / runs, bets: s.bets / runs, hit: s.bets ? s.wins / s.bets : 0, profitable: s.profitable / runs, dd: s.dd / runs })) };
}

// ── UI
const css = `
  .eb{font-family:"Helvetica Neue",Arial,sans-serif;background:#F2F5EF;color:#14261C;min-height:100vh;padding:28px 24px 48px;font-variant-numeric:tabular-nums}
  .eb h1{font-size:30px;font-weight:700;letter-spacing:-.02em;margin:0}
  .eb .sub{color:#4E6255;font-size:14px;margin:6px 0 20px;max-width:64ch;line-height:1.5}
  .eb .tabs{display:flex;gap:6px;margin-bottom:22px;border-bottom:2px solid #14261C}
  .eb .tab{padding:8px 14px;background:none;border:0;font:inherit;font-size:15px;color:#4E6255;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px}
  .eb .tab.on{color:#14261C;border-bottom-color:#14261C;font-weight:700}
  .eb .comp{display:inline-flex;border:1.5px solid #14261C;border-radius:999px;overflow:hidden;margin-bottom:18px}
  .eb .comp button{padding:6px 16px;background:none;border:0;font:inherit;font-size:14px;cursor:pointer;color:#14261C}
  .eb .comp button.on{background:#14261C;color:#F2F5EF}
  .eb .grid{display:grid;grid-template-columns:minmax(260px,340px) 1fr;gap:28px}
  @media(max-width:760px){.eb .grid{grid-template-columns:1fr}}
  .eb label{display:block;font-size:13px;color:#4E6255;margin:12px 0 4px}
  .eb select,.eb input[type=number]{width:100%;font:inherit;font-size:15px;padding:7px 9px;border:1.5px solid #B9C6BC;border-radius:6px;background:#fff;color:#14261C}
  .eb input[type=range]{width:100%;accent-color:#1F6B3F}
  .eb .ledger{background:#fff;border:1.5px solid #14261C;border-radius:10px;padding:18px 20px}
  .eb .vs{font-size:22px;font-weight:700;display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:4px}
  .eb .elo{font-size:13px;color:#4E6255;display:flex;justify-content:space-between;margin-bottom:16px}
  .eb .bar{display:flex;height:34px;border-radius:6px;overflow:hidden;margin:10px 0 14px}
  .eb .bar div{display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:14px;min-width:0}
  .eb table{width:100%;border-collapse:collapse;font-size:14px}
  .eb th{text-align:left;font-weight:600;color:#4E6255;padding:6px 4px;border-bottom:1.5px solid #14261C}
  .eb td{padding:7px 4px;border-bottom:1px solid #E0E7E1}
  .eb td.n,.eb th.n{text-align:right}
  .eb .warn{color:#8A5A00;font-size:12px}
  .eb .btn{background:#1F6B3F;color:#fff;border:0;border-radius:6px;padding:10px 16px;font:inherit;font-size:15px;font-weight:600;cursor:pointer;margin-top:16px;width:100%}
  .eb .btn.ghost{background:none;color:#1F6B3F;border:1.5px solid #1F6B3F}
  .eb .note{font-size:13px;color:#4E6255;line-height:1.5;margin-top:10px}
  .eb details{margin-top:20px} .eb summary{cursor:pointer;font-size:14px;color:#1F6B3F}
  .eb .ratings{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:6px 14px;margin-top:10px}
  .eb .ratings div{display:flex;align-items:center;gap:8px;font-size:13px}
  .eb .ratings input{width:72px}
  .eb .sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:middle}
`;

export default function EloOddsBook() {
  const [tab, setTab] = useState("odds");
  const [comp, setComp] = useState("PL");
  const [pl, setPl] = useState(PL_TEAMS.map(([name, elo, est]) => ({ name, elo, est: !!est })));
  const [cl, setCl] = useState(CL_TEAMS.map(([name, elo, est]) => ({ name, elo, est: !!est })));
  const teams = comp === "PL" ? pl : cl, setTeams = comp === "PL" ? setPl : setCl;
  const [home, setHome] = useState("Arsenal"), [away, setAway] = useState("Liverpool");
  const [hfa, setHfa] = useState(50), [goals, setGoals] = useState(2.75), [margin, setMargin] = useState(0.05);
  const [bookErr, setBookErr] = useState(40), [myErr, setMyErr] = useState(80), [edge, setEdge] = useState(0.05), [runs, setRuns] = useState(50), [seed, setSeed] = useState(1);
  const [res, setRes] = useState(null);

  const fixtures = useMemo(() => comp === "CL" ? CL_FIX : teams.flatMap(h => teams.filter(a => a !== h).map(a => [h.name, a.name])), [comp, teams]);
  const th = teams.find(t => t.name === home) || teams[0], ta = teams.find(t => t.name === away) || teams[1];
  const p = wdl(th.elo, ta.elo, hfa, goals), fair = p.map(x => 1 / x), book = bookOdds(p, margin);
  const pct = x => (x * 100).toFixed(1) + "%";
  const run = () => setRes(simulate({ teams, fixtures, hfa, goals, margin, bookErr, myErr, edge, runs, seed }));

  return (
    <div className="eb"><style>{css}</style>
      <h1>Elo odds book — 2026/27</h1>
      <p className="sub">Win / draw / loss probabilities from Club Elo ratings, the odds a bookmaker would post on them, and a simulator to test betting strategies against a season of results.</p>
      <div className="tabs">
        <button className={"tab" + (tab === "odds" ? " on" : "")} onClick={() => setTab("odds")}>Match odds</button>
        <button className={"tab" + (tab === "sim" ? " on" : "")} onClick={() => setTab("sim")}>Simulate strategies</button>
      </div>
      <div className="comp">
        <button className={comp === "PL" ? "on" : ""} onClick={() => { setComp("PL"); setRes(null); setHome("Arsenal"); setAway("Liverpool"); }}>Premier League</button>
        <button className={comp === "CL" ? "on" : ""} onClick={() => { setComp("CL"); setRes(null); setHome("Real Madrid"); setAway("Inter"); }}>Champions League</button>
      </div>

      {tab === "odds" && (
        <div className="grid">
          <div>
            <label>Home team</label>
            <select value={th.name} onChange={e => setHome(e.target.value)}>{teams.map(t => <option key={t.name}>{t.name}</option>)}</select>
            <label>Away team</label>
            <select value={ta.name} onChange={e => setAway(e.target.value)}>{teams.map(t => <option key={t.name}>{t.name}</option>)}</select>
            <label>Home advantage: {hfa} Elo points</label>
            <input type="range" min={0} max={120} value={hfa} onChange={e => setHfa(+e.target.value)} />
            <label>Expected total goals per match: {goals.toFixed(2)}</label>
            <input type="range" min={2} max={3.5} step={0.05} value={goals} onChange={e => setGoals(+e.target.value)} />
            <label>Bookmaker margin: {(margin * 100).toFixed(1)}%</label>
            <input type="range" min={0} max={0.12} step={0.005} value={margin} onChange={e => setMargin(+e.target.value)} />
            <p className="note">Fair odds = 1 ÷ probability. Book odds shave every price so the implied probabilities add to {(100 * (1 + margin)).toFixed(1)}% instead of 100%.</p>
          </div>
          <div className="ledger">
            <div className="vs"><span>{th.name}</span><span style={{ fontSize: 14, color: "#4E6255", fontWeight: 400 }}>vs</span><span>{ta.name}</span></div>
            <div className="elo"><span>Elo {th.elo}{th.est && " (placeholder)"}</span><span>Elo {ta.elo}{ta.est && " (placeholder)"}</span></div>
            <div className="bar">
              <div style={{ width: pct(p[0]), background: "#1F6B3F" }}>{pct(p[0])}</div>
              <div style={{ width: pct(p[1]), background: "#6B6B6B" }}>{pct(p[1])}</div>
              <div style={{ width: pct(p[2]), background: "#B23A3A" }}>{pct(p[2])}</div>
            </div>
            <table>
              <thead><tr><th>Outcome</th><th className="n">Probability</th><th className="n">Fair odds</th><th className="n">Book odds</th><th className="n">Book implied</th></tr></thead>
              <tbody>
                {[th.name + " win", "Draw", ta.name + " win"].map((o, i) => (
                  <tr key={o}><td>{o}</td><td className="n">{pct(p[i])}</td><td className="n">{fair[i].toFixed(2)}</td><td className="n">{book[i].toFixed(2)}</td><td className="n">{pct(1 / book[i])}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="note">The gap between fair odds and book odds is what you're up against on every bet. To profit you need to be right about a team's strength by more than that gap.</p>
          </div>
        </div>
      )}

      {tab === "sim" && (
        <div className="grid">
          <div>
            <p className="note" style={{ marginTop: 0 }}>{comp === "PL" ? "Plays the full 380-game double round robin." : "Plays the real 144 league-phase fixtures."} Results are drawn from the Elo probabilities. The bookmaker and you each see the teams through your own rating errors — that's what makes value betting possible, or not.</p>
            <label>Bookmaker rating error: ±{bookErr} Elo points</label>
            <input type="range" min={0} max={200} step={5} value={bookErr} onChange={e => setBookErr(+e.target.value)} />
            <label>Your rating error: ±{myErr} Elo points</label>
            <input type="range" min={0} max={200} step={5} value={myErr} onChange={e => setMyErr(+e.target.value)} />
            <label>Bookmaker margin: {(margin * 100).toFixed(1)}%</label>
            <input type="range" min={0} max={0.12} step={0.005} value={margin} onChange={e => setMargin(+e.target.value)} />
            <label>Minimum edge for a value bet: {(edge * 100).toFixed(0)}%</label>
            <input type="range" min={0} max={0.3} step={0.01} value={edge} onChange={e => setEdge(+e.target.value)} />
            <label>Home advantage: {hfa} Elo points</label>
            <input type="range" min={0} max={120} value={hfa} onChange={e => setHfa(+e.target.value)} />
            <label>Seasons to simulate: {runs}</label>
            <input type="range" min={1} max={300} value={runs} onChange={e => setRuns(+e.target.value)} />
            <button className="btn" onClick={run}>Run simulation</button>
            <button className="btn ghost" onClick={() => { setSeed(s => s + 1); setRes(null); }}>New random seed ({seed})</button>
            <p className="note">Bankroll starts at 100. Flat strategies stake 1 per game. Kelly stakes a quarter of the Kelly fraction, capped at 10% of bankroll.</p>
          </div>
          <div className="ledger">
            {!res ? <p className="note" style={{ margin: 0 }}>Set the sliders and run the simulation. Try: your error 80 vs bookmaker 40 (realistic), then flip them to see what beating the market looks like.</p> : (
              <>
                <div style={{ height: 300 }}>
                  <ResponsiveContainer>
                    <LineChart data={res.chart} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                      <XAxis dataKey="g" tick={{ fontSize: 11 }} label={{ value: "games", position: "insideBottomRight", fontSize: 11, dy: 6 }} />
                      <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
                      <Tooltip formatter={v => v.toFixed(1)} labelFormatter={g => `after ${g} games`} />
                      <ReferenceLine y={100} stroke="#14261C" strokeDasharray="4 4" />
                      {STRATS.map(([k, label, c]) => <Line key={k} type="monotone" dataKey={k} name={label} stroke={c} dot={false} strokeWidth={2} isAnimationActive={false} />)}
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <table style={{ marginTop: 14 }}>
                  <thead><tr><th>Strategy</th><th className="n">Avg final bankroll</th><th className="n">Bets / season</th><th className="n">Hit rate</th><th className="n">Seasons in profit</th><th className="n">Avg max drawdown</th></tr></thead>
                  <tbody>{STRATS.map(([k, label, c], i) => { const s = res.stats[i]; return (
                    <tr key={k}><td><span className="sw" style={{ background: c }} />{label}</td>
                      <td className="n" style={{ color: s.final >= 100 ? "#1F6B3F" : "#B23A3A", fontWeight: 600 }}>{s.final.toFixed(1)}</td>
                      <td className="n">{s.bets.toFixed(0)}</td><td className="n">{pct(s.hit)}</td><td className="n">{pct(s.profitable)}</td><td className="n">{pct(s.dd)}</td></tr>); })}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      )}

      <details>
        <summary>Edit Elo ratings ({teams.filter(t => t.est).length} placeholders to replace)</summary>
        <p className="note">Snapshot: Club Elo, 6 Apr 2025 (latest openly mirrored copy). Update from clubelo.com — ratings move 50+ points across a season. Placeholders are marked.</p>
        <div className="ratings">
          {teams.map((t, i) => (
            <div key={t.name}>
              <input type="number" value={t.elo} onChange={e => { const v = +e.target.value; setTeams(ts => ts.map((x, j) => j === i ? { ...x, elo: v, est: false } : x)); setRes(null); }} />
              <span>{t.name}</span>{t.est && <span className="warn">placeholder</span>}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
