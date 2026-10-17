// Training-downtime minigames: short, tense 1v1 games played in the browser while your AI trains.
// All games are server-authoritative (the server simulates, browsers send inputs and draw snapshots).
// A game is a "Round" game: win rounds until you reach `need`. Winner earns coins for the series shop.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const r2 = (v) => Math.round(v * 100) / 100;
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

class Round {
  constructor(opts = {}) {
    this.need = opts.need || 2;
    this.scores = [0, 0]; this.roundsWon = [0, 0];
    this.round = 1; this.phase = 'countdown'; this.timer = 2.8;
    this.done = false; this.winner = -1; this.banner = ''; this.age = 0;
    this.input = [{}, {}];
    this.rng = opts.rng || Math.random;
    this.resetRound();
  }
  setInput(side, inp, now) { Object.assign(this.input[side], this.cleanInput(inp)); }
  cleanInput(inp) { return inp || {}; }
  step(dt, now) {
    this.age += dt;
    if (this.age > 300 && !this.done) { this.done = true; this.winner = this.scores[0] > this.scores[1] ? 0 : this.scores[1] > this.scores[0] ? 1 : -1; this.phase = 'done'; return; }
    if (this.phase === 'countdown') { this.timer -= dt; if (this.timer <= 0) { this.phase = 'play'; this.onPlayStart(now); } }
    else if (this.phase === 'play') this.stepPlay(dt, now);
    else if (this.phase === 'roundEnd') {
      this.timer -= dt;
      if (this.timer <= 0) {
        if (this.done) this.phase = 'done';
        else { this.round++; this.resetRound(); this.phase = 'countdown'; this.timer = 2.0; this.banner = ''; }
      }
    }
  }
  onPlayStart() {}
  // winner: 0/1 or -1 for a replayed round
  endRound(winner, text) {
    this.banner = text; this.phase = 'roundEnd'; this.timer = 2.4;
    if (winner >= 0) {
      this.scores[winner]++; this.roundsWon[winner]++;
      if (this.scores[winner] >= this.need) { this.done = true; this.winner = winner; }
    }
  }
  snapshot() { return { phase: this.phase, timer: r2(Math.max(0, this.timer)), scores: this.scores, round: this.round, need: this.need, banner: this.banner, ...this.state() }; }
}

// ---------------------------------------------------------------------------------------------
// 1) CUBE SUMO - shove the other cube off a platform that keeps shrinking. WASD + SPACE (dash).
// ---------------------------------------------------------------------------------------------
class Sumo extends Round {
  cleanInput(i) { const o = {}; if ('mx' in i) o.mx = clamp(num(i.mx), -1, 1); if ('mz' in i) o.mz = clamp(num(i.mz), -1, 1); if (i.dash) o.dash = true; return o; }
  resetRound() {
    this.t = 0; this.R = 10;
    this.pl = [-4, 4].map((x) => ({ x, z: 0, vx: 0, vz: 0, cd: 0, dash: 0, fell: false }));
    this.input.forEach((i) => { i.dash = false; });
  }
  stepPlay(dt) {
    this.t += dt;
    this.R = Math.max(3.6, 10 - Math.max(0, this.t - 3) * 0.19);
    const [a, b] = this.pl;
    this.pl.forEach((p, i) => {
      const inp = this.input[i]; let mx = inp.mx || 0, mz = inp.mz || 0; const l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; }
      p.cd = Math.max(0, p.cd - dt); p.dash = Math.max(0, p.dash - dt);
      if (inp.dash && p.cd <= 0) {
        let dx = mx, dz = mz; if (Math.hypot(dx, dz) < 0.2) { const o = this.pl[1 - i]; dx = o.x - p.x; dz = o.z - p.z; }
        const dl = Math.hypot(dx, dz) || 1; p.vx = (dx / dl) * 17; p.vz = (dz / dl) * 17; p.cd = 1.5; p.dash = 0.28;
      }
      inp.dash = false;
      if (p.dash <= 0 && !p.fell) {
        const dvx = mx * 8 - p.vx, dvz = mz * 8 - p.vz, dl = Math.hypot(dvx, dvz), m = 36 * dt;
        if (dl > m) { p.vx += dvx / dl * m; p.vz += dvz / dl * m; } else { p.vx += dvx; p.vz += dvz; }
      }
      p.x += p.vx * dt; p.z += p.vz * dt;
    });
    let dx = b.x - a.x, dz = b.z - a.z; const d = Math.hypot(dx, dz) || 0.001;
    if (d < 2) {
      dx /= d; dz /= d; const push = (2 - d) / 2;
      a.x -= dx * push; a.z -= dz * push; b.x += dx * push; b.z += dz * push;
      const rv = (b.vx - a.vx) * dx + (b.vz - a.vz) * dz;
      if (rv < 0) {
        const j = -(1 + 0.9) * rv / 2; a.vx -= dx * j; a.vz -= dz * j; b.vx += dx * j; b.vz += dz * j;
        if (a.dash > 0) { b.vx += dx * 6; b.vz += dz * 6; }
        if (b.dash > 0) { a.vx -= dx * 6; a.vz -= dz * 6; }
      }
    }
    this.pl.forEach((p) => { if (Math.hypot(p.x, p.z) > this.R + 0.45) p.fell = true; });
    if (a.fell && b.fell) this.endRound(-1, 'Both fell! Replay');
    else if (a.fell) this.endRound(1, 'Blue fell off!');
    else if (b.fell) this.endRound(0, 'Red fell off!');
  }
  onPlayStart() { this.input.forEach((i) => { i.dash = false; }); }
  state() { return { g: 'sumo', R: r2(this.R), p: this.pl.map((p) => [r2(p.x), r2(p.z), r2(p.vx), r2(p.vz), r2(p.cd), p.fell ? 1 : 0, p.dash > 0 ? 1 : 0]) }; }
}

// ---------------------------------------------------------------------------------------------
// 2) BOMB TAG - hot potato. Touch the other cube to pass the bomb. Holder of the bomb when it blows up loses.
// ---------------------------------------------------------------------------------------------
class BombTag extends Round {
  cleanInput(i) { return Sumo.prototype.cleanInput(i); }
  resetRound() {
    this.hw = 13; this.hh = 8;
    this.pillars = [[-5, -3], [5, -3], [-5, 3], [5, 3]]; this.pr = 1.3;
    this.pl = [-8, 8].map((x) => ({ x, z: 0, vx: 0, vz: 0, cd: 0, dash: 0, stun: 0 }));
    this.holder = this.rng() < 0.5 ? 0 : 1;
    this.fuseTotal = 14 + this.rng() * 6; this.fuse = this.fuseTotal; this.passCd = 0; this.flash = 0;
    this.input.forEach((i) => { i.dash = false; });
  }
  stepPlay(dt) {
    this.fuse -= dt; this.passCd = Math.max(0, this.passCd - dt); this.flash = Math.max(0, this.flash - dt);
    const R = 0.9;
    this.pl.forEach((p, i) => {
      const inp = this.input[i]; let mx = inp.mx || 0, mz = inp.mz || 0; const l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; }
      p.cd = Math.max(0, p.cd - dt); p.dash = Math.max(0, p.dash - dt); p.stun = Math.max(0, p.stun - dt);
      if (inp.dash && p.cd <= 0 && p.stun <= 0) {
        let dx = mx, dz = mz; if (Math.hypot(dx, dz) < 0.2) { dx = p.vx; dz = p.vz; }
        const dl = Math.hypot(dx, dz); if (dl > 0.01) { p.vx = dx / dl * 15; p.vz = dz / dl * 15; p.cd = 2.6; p.dash = 0.22; }
      }
      inp.dash = false;
      if (p.dash <= 0) {
        const sp = (i === this.holder ? 7.9 : 7.0) * (p.stun > 0 ? 0 : 1);
        const dvx = mx * sp - p.vx, dvz = mz * sp - p.vz, dl = Math.hypot(dvx, dvz), m = 40 * dt;
        if (dl > m) { p.vx += dvx / dl * m; p.vz += dvz / dl * m; } else { p.vx += dvx; p.vz += dvz; }
      }
      p.x += p.vx * dt; p.z += p.vz * dt;
      p.x = clamp(p.x, -this.hw + R, this.hw - R); p.z = clamp(p.z, -this.hh + R, this.hh - R);
      for (const [px, pz] of this.pillars) {
        const dx = p.x - px, dz = p.z - pz, d = Math.hypot(dx, dz), min = this.pr + R;
        if (d < min) { const nx = d > 0.001 ? dx / d : 1, nz = d > 0.001 ? dz / d : 0; p.x = px + nx * min; p.z = pz + nz * min; const vn = p.vx * nx + p.vz * nz; if (vn < 0) { p.vx -= vn * nx; p.vz -= vn * nz; } }
      }
    });
    const [a, b] = this.pl; let dx = b.x - a.x, dz = b.z - a.z; const d = Math.hypot(dx, dz) || 0.001;
    if (d < 2 * R + 0.15 && this.passCd <= 0) {
      const old = this.holder; this.holder = 1 - old; this.passCd = 0.9; this.flash = 0.3;
      const from = this.pl[old], to = this.pl[this.holder]; dx = (from.x - to.x) / d; dz = (from.z - to.z) / d;
      from.vx = dx * 9; from.vz = dz * 9; from.dash = 0.12; to.stun = 0.45; to.vx = 0; to.vz = 0;
    } else if (d < 2 * R) {   // soft body collision otherwise
      dx /= d; dz /= d; const push = (2 * R - d) / 2; a.x -= dx * push; a.z -= dz * push; b.x += dx * push; b.z += dz * push;
    }
    if (this.fuse <= 0) this.endRound(1 - this.holder, `${this.holder === 0 ? 'Blue' : 'Red'} blew up!`);
  }
  onPlayStart() { this.input.forEach((i) => { i.dash = false; }); }
  state() {
    return { g: 'tag', hw: this.hw, hh: this.hh, pillars: this.pillars, pr: this.pr, holder: this.holder, u: r2(clamp(1 - this.fuse / this.fuseTotal, 0, 1)), flash: this.flash > 0 ? 1 : 0,
      p: this.pl.map((p) => [r2(p.x), r2(p.z), r2(p.vx), r2(p.vz), r2(p.cd), p.stun > 0 ? 1 : 0, p.dash > 0 ? 1 : 0]) };
  }
}

// ---------------------------------------------------------------------------------------------
// 3) LIGHT CYCLES - leave a wall behind you, make the other one crash. A/D or arrows to turn.
// ---------------------------------------------------------------------------------------------
class Cycles extends Round {
  cleanInput(i) { const o = {}; if (i.turn === -1 || i.turn === 1) { o.turn = i.turn; o.seq = num(i.seq); } return o; }
  resetRound() {
    this.W = 46; this.H = 26; this.grid = new Uint8Array(this.W * this.H);
    this.cy = [{ x: 6, y: 13, d: 0, dead: false, q: [], seq: -1 }, { x: 39, y: 13, d: 2, dead: false, q: [], seq: -1 }];
    this.cy.forEach((c, i) => { this.grid[c.y * this.W + c.x] = i + 1; });
    this.trails = [[this.cy[0].y * this.W + this.cy[0].x], [this.cy[1].y * this.W + this.cy[1].x]];
    this.acc = 0; this.t = 0;
    this.input.forEach((i) => { delete i.turn; });
  }
  stepPlay(dt) {
    this.t += dt;
    this.cy.forEach((c, i) => {
      const inp = this.input[i];
      if (inp.turn && inp.seq !== c.seq) { c.seq = inp.seq; if (c.q.length < 2) c.q.push(inp.turn); }
    });
    const interval = Math.max(0.065, 0.115 - this.t * 0.0011);
    this.acc += dt;
    while (this.acc >= interval && this.phase === 'play') {
      this.acc -= interval;
      const nx = [], DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
      for (const c of this.cy) { const t = c.q.shift(); if (t) c.d = (c.d + t + 4) % 4; nx.push([c.x + DX[c.d], c.y + DY[c.d]]); }
      const crash = nx.map(([x, y]) => x < 0 || y < 0 || x >= this.W || y >= this.H || this.grid[y * this.W + x] !== 0);
      if (nx[0][0] === nx[1][0] && nx[0][1] === nx[1][1]) crash[0] = crash[1] = true;
      this.cy.forEach((c, i) => { if (crash[i]) c.dead = true; else { c.x = nx[i][0]; c.y = nx[i][1]; this.grid[c.y * this.W + c.x] = i + 1; this.trails[i].push(c.y * this.W + c.x); } });
      if (crash[0] && crash[1]) this.endRound(-1, 'Double crash! Replay');
      else if (crash[0]) this.endRound(1, 'Blue crashed!');
      else if (crash[1]) this.endRound(0, 'Red crashed!');
    }
  }
  state() { return { g: 'cycles', W: this.W, H: this.H, c: this.cy.map((c) => [c.x, c.y, c.d, c.dead ? 1 : 0]), trails: this.trails }; }
}

// ---------------------------------------------------------------------------------------------
// 4) AIR HOCKEY - first to 5 goals (or most goals after 100 s, then sudden death). Mouse / touch to move.
// ---------------------------------------------------------------------------------------------
class Hockey extends Round {
  constructor(opts) { super({ ...opts, need: 5 }); }
  cleanInput(i) { const o = {}; if ('x' in i) o.x = num(i.x); if ('z' in i) o.z = num(i.z); return o; }
  resetRound() {
    this.hw = 16; this.hh = 9; this.gw = 2.8; this.pr = 1.15; this.ur = 0.72;
    this.pad = [{ x: -11, z: 0, vx: 0, vz: 0 }, { x: 11, z: 0, vx: 0, vz: 0 }];
    this.input[0].x = -11; this.input[0].z = 0; this.input[1].x = 11; this.input[1].z = 0;
    const toward = this.lastScorer === undefined ? (this.rng() < 0.5 ? -1 : 1) : (this.lastScorer === 0 ? -1 : 1);   // serve toward the player who conceded
    this.puck = { x: 0, z: 0, vx: toward * 3.5, vz: (this.rng() - 0.5) * 3 };
    this.clock = this.clock || 0; this.sudden = this.sudden || false;
  }
  stepPlay(dt) {
    this.clock += dt;
    this.pad.forEach((p, i) => {
      const inp = this.input[i], side = i === 0 ? -1 : 1;
      let tx = clamp(inp.x ?? p.x, side < 0 ? -this.hw + this.pr : 0.4 + this.pr * 0.3, side < 0 ? -0.4 - this.pr * 0.3 : this.hw - this.pr);
      let tz = clamp(inp.z ?? p.z, -this.hh + this.pr, this.hh - this.pr);
      const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz), max = 30 * dt;
      const nx = d > max ? p.x + dx / d * max : tx, nz = d > max ? p.z + dz / d * max : tz;
      p.vx = (nx - p.x) / dt; p.vz = (nz - p.z) / dt; p.x = nx; p.z = nz;
    });
    const u = this.puck;
    const sub = 3;
    for (let s = 0; s < sub; s++) {
      const h = dt / sub;
      u.x += u.vx * h; u.z += u.vz * h;
      for (const p of this.pad) {
        const dx = u.x - p.x, dz = u.z - p.z, d = Math.hypot(dx, dz), min = this.pr + this.ur;
        if (d < min) {
          const nx = d > 0.001 ? dx / d : 1, nz = d > 0.001 ? dz / d : 0;
          u.x = p.x + nx * min; u.z = p.z + nz * min;
          const rv = (u.vx - p.vx) * nx + (u.vz - p.vz) * nz;
          if (rv < 0) { u.vx -= (1 + 0.92) * rv * nx; u.vz -= (1 + 0.92) * rv * nz; }
        }
      }
      if (u.z > this.hh - this.ur) { u.z = this.hh - this.ur; if (u.vz > 0) u.vz = -u.vz * 0.97; }
      if (u.z < -this.hh + this.ur) { u.z = -this.hh + this.ur; if (u.vz < 0) u.vz = -u.vz * 0.97; }
      const inGoal = Math.abs(u.z) < this.gw - 0.1;
      if (Math.abs(u.x) > this.hw - this.ur && !inGoal) { u.x = Math.sign(u.x) * (this.hw - this.ur); if (u.vx * Math.sign(u.x) > 0) u.vx = -u.vx * 0.97; }
      if (Math.abs(u.x) > this.hw + this.ur) { this.lastScorer = u.x > 0 ? 0 : 1; this.scoreGoal(this.lastScorer); return; }
    }
    const sp = Math.hypot(u.vx, u.vz), damp = Math.exp(-0.12 * dt); u.vx *= damp; u.vz *= damp;
    if (sp > 36) { u.vx *= 36 / sp; u.vz *= 36 / sp; }
    if (Math.hypot(u.vx, u.vz) < 1.2 && Math.abs(u.x) < this.hw) { u.vx += (u.x >= 0 ? -1 : 1) * 4 * dt; }   // never let it die in the middle
    if (!this.sudden && this.clock >= 100) {
      if (this.scores[0] !== this.scores[1]) { this.done = true; this.winner = this.scores[0] > this.scores[1] ? 0 : 1; this.endRoundNoScore(this.winner === 0 ? 'Time! Blue wins' : 'Time! Red wins'); }
      else { this.sudden = true; this.banner = ''; }
    }
  }
  scoreGoal(w) {
    this.scores[w]++; this.roundsWon[w]++;
    if (this.scores[w] >= this.need || this.sudden) { this.done = true; this.winner = w; }
    this.banner = w === 0 ? 'GOAL Blue!' : 'GOAL Red!'; this.phase = 'roundEnd'; this.timer = this.done ? 2.4 : 1.6;
  }
  endRoundNoScore(text) { this.banner = text; this.phase = 'roundEnd'; this.timer = 2.4; }
  state() { return { g: 'hockey', hw: this.hw, hh: this.hh, gw: this.gw, pr: this.pr, ur: this.ur, sudden: this.sudden ? 1 : 0, clock: r2(Math.max(0, 100 - this.clock)), puck: [r2(this.puck.x), r2(this.puck.z), r2(this.puck.vx), r2(this.puck.vz)], pad: this.pad.map((p) => [r2(p.x), r2(p.z)]) }; }
}

// ---------------------------------------------------------------------------------------------
// 5) QUICK DRAW - wait for GO, then smash SPACE / click / tap. Too early (or on a decoy flash) loses the round.
// ---------------------------------------------------------------------------------------------
class QuickDraw extends Round {
  constructor(opts) { super({ ...opts, need: 3 }); }
  cleanInput() { return {}; }
  setInput(side, inp, now) { if (inp && inp.press && this.phase === 'play') this.presses.push([side, now || Date.now()]); }
  resetRound() {
    this.wait = 1.4 + this.rng() * 3.4; this.t = 0; this.go = false; this.react = [null, null]; this.decoy = 0; this.presses = [];
    this.decoys = []; const n = Math.floor(this.rng() * 3); for (let i = 0; i < n; i++) this.decoys.push(0.5 + this.rng() * Math.max(0.1, this.wait - 0.9));
  }
  onPlayStart(now) { this.presses = []; this.goReal = (now || Date.now()) + this.wait * 1000; }
  step(dt, now) { this.lastNow = now; super.step(dt, now); }
  stepPlay(dt) {
    this.t += dt; this.decoy = Math.max(0, this.decoy - dt);
    for (let i = this.decoys.length - 1; i >= 0; i--) if (this.t >= this.decoys[i]) { this.decoys.splice(i, 1); this.decoy = 0.22; }
    if (!this.go && this.t >= this.wait) this.go = true;
    if (this.presses.length) {
      const early = this.presses.filter(([, ts]) => ts < this.goReal);
      if (early.length) {                                     // jumped the gun (the earliest offender loses)
        early.sort((x, y) => x[1] - y[1]); const loser = early[0][0];
        this.presses = []; return this.endRound(1 - loser, `${loser === 0 ? 'Blue' : 'Red'} jumped the gun!`);
      }
      this.presses.sort((x, y) => x[1] - y[1]);
      const [w, ts] = this.presses[0]; this.presses = [];
      this.react[w] = Math.round(ts - this.goReal);
      return this.endRound(w, `${w === 0 ? 'Blue' : 'Red'} wins the draw! ${this.react[w]} ms`);
    }
    if (this.go && this.t > this.wait + 2.5) this.endRound(-1, 'Too slow! Replay');
  }
  state() { return { g: 'draw', go: this.go ? 1 : 0, decoy: this.decoy > 0 ? 1 : 0, react: this.react }; }
}

export const GAMES = {
  sumo:   { name: 'Cube Sumo',    icon: '🥋', blurb: 'Shove the other cube off a shrinking platform.', help: 'WASD / arrows: move · SPACE: dash (1.5 s cooldown)', make: (o) => new Sumo(o), need: 2, reward: { win: 40, lose: 12, perRound: 5 } },
  tag:    { name: 'Bomb Tag',     icon: '💣', blurb: 'Hot potato! Touch the other cube to pass the bomb.', help: 'WASD / arrows: move · SPACE: dash. Whoever holds the bomb when it blows up loses.', make: (o) => new BombTag(o), need: 2, reward: { win: 40, lose: 12, perRound: 5 } },
  cycles: { name: 'Light Cycles', icon: '🏍️', blurb: 'Trap the other cycle with your light wall.', help: 'A/D or ←/→: turn left/right (tap the buttons on a phone)', make: (o) => new Cycles(o), need: 2, reward: { win: 40, lose: 12, perRound: 5 } },
  hockey: { name: 'Air Hockey',   icon: '🏒', blurb: 'First to 5 goals, or most goals after 100 s.', help: 'Mouse / finger: move your paddle (WASD also works)', make: (o) => new Hockey(o), need: 5, reward: { win: 45, lose: 12, perRound: 3 } },
  draw:   { name: 'Quick Draw',   icon: '🔫', blurb: 'Wait for GO, then hit SPACE / tap first. Do not jump the gun!', help: 'SPACE / click / tap when the light turns green. Decoy flashes are traps!', make: (o) => new QuickDraw(o), need: 3, reward: { win: 25, lose: 8, perRound: 3 } },
};

export function coinsFor(gameId, winner, roundsWon, mult = 1) {
  const r = GAMES[gameId].reward, out = [0, 0];
  for (const s of [0, 1]) out[s] = Math.round(((winner === s ? r.win : r.lose) + r.perRound * roundsWon[s]) * mult);
  return out;
}

// One invite -> join -> play -> result flow for a room. The room's server code calls tick() at ~30 Hz.
export class MiniSession {
  constructor({ gameId, bestOf = 3, coinMult = 1, send, onResult, now = Date.now, inviteMs = 18000 }) {
    this.gameId = gameId; this.meta = GAMES[gameId]; this.coinMult = coinMult; this.send = send; this.onResult = onResult; this.now = now;
    this.bestOf = bestOf;
    this.phase = 'invite'; this.joined = [false, false]; this.declined = [false, false]; this.deadline = now() + inviteMs; this.game = null; this.closeAt = 0;
    this.lastTick = now(); this.sendAcc = 0; this.result = null;
    this.inviteMsg = { t: 'mg_invite', id: gameId, name: this.meta.name, icon: this.meta.icon, blurb: this.meta.blurb, help: this.meta.help, deadline: this.deadline, reward: this.meta.reward, mult: coinMult };
    this.send(this.inviteMsg);
  }

  // messages that bring a (re)connecting browser up to date
  resync() {
    const out = [];
    if (this.phase === 'invite') { out.push(this.inviteMsg); out.push({ t: 'mg_joined', joined: this.joined }); }
    else if (this.phase === 'play' && this.game) { out.push({ t: 'mg_start', id: this.gameId, name: this.meta.name, help: this.meta.help, need: this.game.need }); out.push({ t: 'mg', s: this.game.snapshot() }); }
    else if (this.phase === 'result' && this.result) out.push({ t: 'mg_result', id: this.gameId, name: this.meta.name, ...this.result });
    return out;
  }

  join(side) {
    if (this.phase !== 'invite') return;
    this.joined[side] = true;
    this.send({ t: 'mg_joined', joined: this.joined });
    if (this.joined[0] && this.joined[1]) this.begin();
  }
  decline(side) { if (this.phase !== 'invite') return; this.declined[side] = true; this.send({ t: 'mg_joined', joined: this.joined, declined: this.declined }); if (this.declined[0] || this.declined[1]) this.cancel(); }

  begin() {
    this.phase = 'play';
    const need = this.meta.need === 2 ? Math.ceil(this.bestOf / 2) : this.meta.need;
    this.game = this.meta.make({ need });
    this.lastTick = this.now();
    this.send({ t: 'mg_start', id: this.gameId, name: this.meta.name, help: this.meta.help, need: this.game.need });
  }

  input(side, inp) { if (this.phase === 'play' && this.game && !this.game.done) this.game.setInput(side, inp, this.now()); }

  cancel() { if (this.phase === 'closed') return; this.phase = 'closed'; this.send({ t: 'mg_end', cancelled: true }); this.onResult(null); }

  tick() {
    const t = this.now();
    if (this.phase === 'invite') {
      if (t >= this.deadline) {
        if (this.joined[0] !== this.joined[1]) {
          const w = this.joined[0] ? 0 : 1, coins = [0, 0]; coins[w] = Math.round(this.meta.reward.win * 0.5 * this.coinMult);
          this.finish({ winner: w, scores: [0, 0], walkover: true, coins });
        } else this.cancel();
      }
      return;
    }
    if (this.phase === 'play') {
      const dt = Math.min(0.1, (t - this.lastTick) / 1000); this.lastTick = t;
      this.game.step(dt, t);
      this.sendAcc += dt;
      const every = this.gameId === 'cycles' ? 1 / 20 : 1 / 30;
      if (this.sendAcc >= every) { this.sendAcc = 0; this.send({ t: 'mg', s: this.game.snapshot() }); }
      if (this.game.phase === 'done') {
        const g = this.game;
        this.send({ t: 'mg', s: g.snapshot() });
        this.finish({ winner: g.winner, scores: g.scores.slice(), coins: coinsFor(this.gameId, g.winner, g.roundsWon, this.coinMult) });
      }
      return;
    }
    if (this.phase === 'result' && t >= this.closeAt) { this.phase = 'closed'; this.send({ t: 'mg_end' }); }
  }

  finish(res) {
    this.phase = 'result'; this.closeAt = this.now() + 5500; this.result = res;
    this.onResult(res);
    this.send({ t: 'mg_result', id: this.gameId, name: this.meta.name, ...res });
  }
  get closed() { return this.phase === 'closed'; }
}
