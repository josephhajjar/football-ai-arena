// Runs whole matches / series headlessly and records a compact replay for the viewer.
import { CONFIG as C } from './config.js';
import { Game } from './sim.js';

const r2 = (v) => Math.round(v * 100) / 100;

// teams = { blue: [policy, policy], red: [policy, policy] }, policy.act(obs) -> [mx, mz, kick]
// Replay frame layout: [ballX, ballY, ballZ, p0x, p0z, p1x, p1z, p2x, p2z, p3x, p3z, clockSeconds, overtimeFlag]
// One frame per AI decision (20 per second); the viewer interpolates between them.
export function runMatch(teams, seed = 1, opts = {}) {
  const g = new Game({ seed, ...opts });
  const frames = [], events = [];
  const record = () => {
    const b = g.ball, P = g.players;
    frames.push([r2(b.x), r2(b.y), r2(b.z), r2(P[0].x), r2(P[0].z), r2(P[1].x), r2(P[1].z),
      r2(P[2].x), r2(P[2].z), r2(P[3].x), r2(P[3].z), Math.round(g.clock * 10) / 10, g.overtime ? 1 : 0]);
  };
  record();
  const maxSteps = Math.ceil((g.matchSeconds + g.overtimeSeconds + 60) / (C.DT * C.ACTION_REPEAT)) + 1000;
  for (let n = 0; n < maxSteps && !g.done; n++) {
    const ob = g.obs(0), or = g.obs(1);
    const ab = [teams.blue[0].act(ob[0]), teams.blue[1].act(ob[1])];
    const ar = [teams.red[0].act(or[0]), teams.red[1].act(or[1])];
    const ev = g.step(ab, ar);
    record();
    for (const e of ev) if (e.type === 'goal' || e.type === 'kick') events.push({ ...e, f: frames.length - 1 });
  }
  // Let the final goal play out: keep physics running for ~2 seconds.
  const zero = [[0, 0, 0], [0, 0, 0]];
  g.done = false; g.pause = 1000;
  for (let n = 0; n < 40; n++) { g.step(zero, zero); record(); }
  g.done = true;
  return {
    seed, score: g.score.slice(), winner: g.winner, overtime: g.overtime,
    seconds: Math.round(g.clock * 10) / 10, fps: 1 / (C.DT * C.ACTION_REPEAT), frames, events,
  };
}

// makeTeams(matchIndex) -> teams. Plays until someone wins SERIES_WINS_NEEDED matches.
export function runSeries(makeTeams, seedBase = 1, opts = {}) {
  const need = opts.winsNeeded ?? C.SERIES_WINS_NEEDED, max = opts.maxMatches ?? C.SERIES_MAX_MATCHES;
  const wins = [0, 0], matches = [];
  for (let i = 0; i < max && wins[0] < need && wins[1] < need; i++) {
    const m = runMatch(makeTeams(i), seedBase + i * 7919, opts);
    if (m.winner >= 0) wins[m.winner]++;
    matches.push(m);
  }
  const winner = wins[0] > wins[1] ? 0 : wins[1] > wins[0] ? 1 : -1;
  return { wins, winner, matches };
}
