// Live, server-authoritative series. Runs the football sim in real time (20 decisions per second),
// streams every frame to all connected browsers, accepts power-up purchases and keeps the coin economy.
// Everything is also recorded so the finished series can be replayed from a file.
import zlib from 'node:zlib';
import { CONFIG as C, POWERS, ECONOMY } from '../src/config.js';
import { Game } from '../src/sim.js';

export const STEP_MS = C.DT * C.ACTION_REPEAT * 1000;   // 50 ms per AI decision
const OUTRO_STEPS = 40;                                  // 2 s of play-out after the final whistle
const r2 = (v) => Math.round(v * 100) / 100;
const KEEP = new Set(['goal', 'kick', 'power', 'explode', 'stall', 'pop']);

export class LiveSeries {
  // teamsFor(matchIndex) -> { blue: [policy, policy], red: [policy, policy] }
  constructor({ names, teamsFor, coins, broadcast, seedBase = 1, countdownMs = 12000, gapSeconds = 6, winsNeeded = C.SERIES_WINS_NEEDED, maxMatches = C.SERIES_MAX_MATCHES, now = Date.now, onFinish = () => {}, onError = () => {}, matchOpts = {} }) {
    Object.assign(this, { names, teamsFor, broadcast, seedBase, countdownMs, gapSeconds, winsNeeded, maxMatches, now, onFinish, onError, matchOpts });
    this.coins = [coins[0] | 0, coins[1] | 0];
    this.state = 'idle';           // idle | countdown | playing | outro | gap | done
    this.matches = [];             // finished matches (full replay data)
    this.cur = null; this.game = null;
    this.wins = [0, 0];
    this.pending = [];             // events from purchases, attached to the next frame
    this.cool = [{ global: 0, same: {} }, { global: 0, same: {} }];
    this.passiveAcc = 0; this.timer = null; this.stopped = false;
    this.t0 = 0; this.nextAt = 0;
  }

  start() {
    this.t0 = this.now() + this.countdownMs; this.nextAt = this.t0;
    this.state = 'countdown';
    this.broadcast({ t: 'series_start', startAt: this.t0, names: this.names, gap: this.gapSeconds, coins: this.coins, winsNeeded: this.winsNeeded });
    this.timer = setTimeout(() => this.beginMatch(0, this.t0), Math.max(0, this.t0 - this.now()));
  }

  stop() { this.stopped = true; clearTimeout(this.timer); }

  beginMatch(i, startAt) {
    if (this.stopped) return;
    const seed = this.seedBase + i * 7919;
    this.game = new Game({ seed, ...this.matchOpts });
    this.teams = this.teamsFor(i);
    this.cur = { i, seed, frames: [], events: [], fx: [], lastFx: '', startAt, startOffset: (startAt - this.t0) / 1000, step: 0, outro: 0 };
    this.passiveAcc = 0;
    this.state = 'playing';
    const f0 = this.record(this.game, 0);
    this.broadcast({ t: 'match_start', m: i, seed, startAt, f: f0.frame, fx: f0.fx, c: this.coins, wins: this.wins, startOffset: this.cur.startOffset });
    this.schedule();
  }

  // push frame + (changed) fx state into the recording; returns what to send
  record(g) {
    const c = this.cur, b = g.ball, P = g.players;
    const frame = [r2(b.x), r2(b.y), r2(b.z), r2(P[0].x), r2(P[0].z), r2(P[1].x), r2(P[1].z), r2(P[2].x), r2(P[2].z), r2(P[3].x), r2(P[3].z), Math.round(g.clock * 10) / 10, g.overtime ? 1 : 0];
    c.frames.push(frame);
    const fx = g.fxState(), js = JSON.stringify(fx);
    let sendFx;
    if (js !== c.lastFx) { c.lastFx = js; c.fx.push({ f: c.frames.length - 1, s: fx }); sendFx = fx; }
    return { frame, fx: sendFx };
  }

  schedule() {
    if (this.stopped) return;
    const c = this.cur;
    const due = c.startAt + (c.step + 1) * STEP_MS;
    this.timer = setTimeout(() => this.tick(), Math.max(1, due - this.now()));
  }

  tick() {
    try { this.tickUnsafe(); } catch (e) { this.stopped = true; this.onError(e); }
  }

  tickUnsafe() {
    if (this.stopped || !this.cur) return;
    const c = this.cur;
    let n = 0;
    while (this.cur === c && (this.state === 'playing' || this.state === 'outro') && c.startAt + (c.step + 1) * STEP_MS <= this.now() && n < 6) { this.stepOnce(); n++; }
    if (this.cur === c && (this.state === 'playing' || this.state === 'outro')) {
      const lag = this.now() - (c.startAt + (c.step + 1) * STEP_MS);
      if (lag > 400) c.startAt += lag;      // server is struggling: slow motion instead of an endless catch-up
      this.schedule();
    }
  }

  stepOnce() {
    const g = this.game, c = this.cur;
    const zero = [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];
    let ev;
    if (this.state === 'outro') {
      ev = g.step(zero, zero);
    } else {
      const ob = g.obs(0), or = g.obs(1);
      const act = (p, o) => { try { return p.act(o); } catch { return [0, 0, 0, 0, 0]; } };
      ev = g.step([act(this.teams.blue[0], ob[0]), act(this.teams.blue[1], ob[1])], [act(this.teams.red[0], or[0]), act(this.teams.red[1], or[1])]);
    }
    c.step++;
    const events = [...this.pending, ...ev]; this.pending = [];
    // economy
    if (this.state === 'playing') {
      for (const e of events) if (e.type === 'goal') this.coins[e.team] += ECONOMY.GOAL;
      if (g.pause === 0 && (this.passiveAcc += STEP_MS / 1000) >= ECONOMY.PASSIVE_EVERY_SECONDS) { this.passiveAcc = 0; this.coins[0]++; this.coins[1]++; }
    }
    const { frame, fx } = this.record(g);
    const keep = [];
    for (const e of events) if (KEEP.has(e.type)) { const o = { ...e, f: c.frames.length - 1 }; c.events.push(o); keep.push(e); }
    this.broadcast({ t: 'f', m: c.i, k: c.frames.length - 1, f: frame, ev: keep.length ? keep : undefined, fx, c: this.coins }, true);

    if (this.state === 'playing' && g.done) {
      this.state = 'outro'; c.outro = OUTRO_STEPS; g.done = false; g.pause = 100000;
    } else if (this.state === 'outro' && --c.outro <= 0) this.endMatch();
  }

  endMatch() {
    const g = this.game, c = this.cur;
    g.done = true;
    const [s0, s1] = g.score, winner = s0 > s1 ? 0 : s1 > s0 ? 1 : -1;
    if (winner >= 0) { this.wins[winner]++; this.coins[winner] += ECONOMY.MATCH_WIN; }
    const m = {
      seed: c.seed, score: g.score.slice(), winner, overtime: g.overtime, seconds: Math.round(g.clock * 10) / 10,
      fps: 1000 / STEP_MS, frames: c.frames, events: c.events, fx: c.fx, startOffset: c.startOffset, complete: true,
    };
    this.matches.push(m); this.cur = null; this.game = null;
    const over = this.wins[0] >= this.winsNeeded || this.wins[1] >= this.winsNeeded || this.matches.length >= this.maxMatches;
    const seriesWinner = this.wins[0] > this.wins[1] ? 0 : this.wins[1] > this.wins[0] ? 1 : -1;
    this.nextAt = this.now() + this.gapSeconds * 1000;
    this.broadcast({ t: 'match_end', m: this.matches.length - 1, score: m.score, winner, overtime: m.overtime, seconds: m.seconds, wins: this.wins, coins: this.coins, over, seriesWinner, nextAt: over ? 0 : this.nextAt });
    if (over) { this.finish(seriesWinner); return; }
    this.state = 'gap';
    this.timer = setTimeout(() => { try { this.beginMatch(this.matches.length, this.nextAt); } catch (e) { this.stopped = true; this.onError(e); } }, this.gapSeconds * 1000);
  }

  finish(winner) {
    this.state = 'done';
    const full = { version: 1, names: this.names, gap: this.gapSeconds, wins: this.wins.slice(), winner, matches: this.matches };
    const gz = zlib.gzipSync(JSON.stringify(full));
    const pub = {
      startAt: this.t0, wins: this.wins.slice(), winner, gap: this.gapSeconds,
      matches: this.matches.map((m, index) => ({ index, startOffset: m.startOffset, duration: m.frames.length / m.fps, score: m.score, winner: m.winner, seconds: m.seconds, overtime: m.overtime })),
    };
    this.broadcast({ t: 'series_end', wins: this.wins, winner, coins: this.coins });
    this.onFinish({ gz, pub, coins: this.coins.slice() });
  }

  // A human buys an item. side: 'blue' | 'red'. cmd: { id, cube, x, z }
  command(side, cmd) {
    const si = side === 'blue' ? 0 : side === 'red' ? 1 : -1;
    if (si < 0) return { ok: false, error: 'Spectators cannot buy items' };
    if (this.state !== 'playing' || !this.game || this.game.done || this.game.pause > 0) return { ok: false, error: 'Items can only be used while play is running' };
    const spec = cmd && POWERS[cmd.id];
    if (!spec) return { ok: false, error: 'Unknown item' };
    const t = this.now(), cd = this.cool[si];
    if (t < cd.global) return { ok: false, error: 'Wait a moment before the next item' };
    if ((cd.same[cmd.id] || 0) > t) return { ok: false, error: `${spec.name} is cooling down` };
    if (this.coins[si] < spec.cost) return { ok: false, error: `Not enough coins (need ${spec.cost})` };
    const res = this.game.applyPower(si, cmd.id, cmd);
    if (!res.ok) return res;
    this.coins[si] -= spec.cost;
    cd.global = t + ECONOMY.GLOBAL_COOLDOWN * 1000; cd.same[cmd.id] = t + ECONOMY.SAME_COOLDOWN * 1000;
    this.pending.push(...res.events);
    return { ok: true, balance: this.coins[si], id: cmd.id };
  }

  snapshot() {
    const matches = this.matches.slice();
    if (this.cur) {
      const c = this.cur, g = this.game;
      matches.push({ seed: c.seed, score: g.score.slice(), winner: -1, overtime: g.overtime, seconds: g.clock, fps: 1000 / STEP_MS, frames: c.frames, events: c.events, fx: c.fx, startOffset: c.startOffset, complete: false });
    }
    return {
      t: 'snapshot', state: this.state, names: this.names, gap: this.gapSeconds, startAt: this.t0, wins: this.wins, coins: this.coins,
      nextAt: this.state === 'gap' ? this.nextAt : 0, winsNeeded: this.winsNeeded, matches,
      currentStartAt: this.cur ? this.cur.startAt : 0,
    };
  }
}
