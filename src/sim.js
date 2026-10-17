// Deterministic football simulation. No dependencies, runs in Node and in the browser.
//
// Players 0,1 = BLUE team (attack toward +x, defend the goal at x = -HALF_LENGTH)
// Players 2,3 = RED team  (attack toward -x, defend the goal at x = +HALF_LENGTH)
// Every AI sees the world in "own frame": the world is rotated 180 degrees for red so
// that every AI always attacks toward +x. Actions are also given in that frame.

import { CONFIG as C, POWERS, OBS_SIZE } from './config.js';
import { makeRng } from './rng.js';

const HL = C.HALF_LENGTH, HW = C.HALF_WIDTH, CR = C.CORNER_RADIUS;
const BR = C.BALL_RADIUS, PR = C.PLAYER_RADIUS;
const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sec = (s) => Math.round(s / C.DT);

// Signed distance to the rounded-rectangle pitch outline. d > 0 is outside. (nx,nz) = outward normal.
const _sd = { d: 0, nx: 0, nz: 0 };
export function pitchSdf(x, z) {
  const cx = HL - CR, cz = HW - CR;
  const sx = x >= 0 ? 1 : -1, sz = z >= 0 ? 1 : -1;
  const ax = Math.abs(x) - cx, az = Math.abs(z) - cz;
  const ox = Math.max(ax, 0), oz = Math.max(az, 0);
  const len = Math.hypot(ox, oz);
  if (len > 0) {
    _sd.d = len - CR; _sd.nx = (ox / len) * sx; _sd.nz = (oz / len) * sz;
  } else if (ax > az) {
    _sd.d = ax - CR; _sd.nx = sx; _sd.nz = 0;
  } else {
    _sd.d = az - CR; _sd.nx = 0; _sd.nz = sz;
  }
  return _sd;
}

export const FX_BITS = { speed: 1, kick: 2, heavy: 4, invert: 8, slow: 16, stun: 32, mud: 64 };

export class Game {
  constructor(opts = {}) {
    this.matchSeconds = opts.matchSeconds ?? C.MATCH_SECONDS;
    this.goalsToWin = opts.goalsToWin ?? C.GOALS_TO_WIN;
    this.overtimeSeconds = opts.overtimeSeconds ?? C.OVERTIME_SECONDS;
    this.reset(opts.seed ?? 1);
  }

  reset(seed = 1) {
    this.seed = seed;
    this.rng = makeRng(seed);
    this.players = [0, 1, 2, 3].map((i) => ({
      i, team: i < 2 ? 0 : 1, x: 0, z: 0, vx: 0, vz: 0, cd: 0,
      speed: 0, kick: 0, heavy: 0, invert: 0, slow: 0, stun: 0, mud: false,   // effect timers in ticks
    }));
    this.ball = { x: 0, y: BR, z: 0, vx: 0, vz: 0, vy: 0 };
    this.score = [0, 0];
    this.tick = 0;          // physics ticks elapsed (including pauses)
    this.clockTicks = 0;    // ticks that count toward the match clock
    this.pause = 0;         // celebration ticks left
    this.overtime = false;
    this.done = false;
    this.winner = -1;       // 0 blue, 1 red, -1 none/draw
    this.stallTimer = 0;
    this.stallRef = { x: 0, y: BR, z: 0 };
    // effects
    this.bombs = [];        // {x, z, fuse(ticks), team}
    this.mud = [];          // {x, z, r, left(ticks)}
    this.goalMods = [];     // {end, mul, left(ticks)}   end 0 = blue goal (x=-HL), 1 = red goal (x=+HL)
    this.gw = [C.GOAL_HALF_WIDTH, C.GOAL_HALF_WIDTH];
    this.spawn();
    return this;
  }

  get clock() { return this.clockTicks * C.DT; }

  spawn() {
    const J = C.SPAWN_JITTER, r = this.rng;
    const jit = () => (r() * 2 - 1) * J;
    const sp = [
      [-C.SPAWN_X, -C.SPAWN_Z], [-C.SPAWN_X, C.SPAWN_Z],
      [C.SPAWN_X, C.SPAWN_Z], [C.SPAWN_X, -C.SPAWN_Z],
    ];
    this.players.forEach((p, i) => {
      p.x = sp[i][0] + jit(); p.z = sp[i][1] + jit();
      p.vx = p.vz = 0; p.cd = 0; p.stun = 0;
    });
    const b = this.ball;
    b.x = 0; b.y = BR; b.z = 0;
    b.vx = (r() * 2 - 1) * 0.6; b.vz = (r() * 2 - 1) * 0.6; b.vy = 0;
    this.stallTimer = 0;
    this.stallRef = { x: b.x, y: b.y, z: b.z };
    this.bombs.length = 0; this.mud.length = 0;   // no bombs/mud left on the kickoff spots
  }

  // ---------- effects ----------
  speedMul(p) {
    return (p.speed > 0 ? C.SPEED_FACTOR : 1) * (p.slow > 0 ? C.ICE_FACTOR : 1) * (p.mud ? C.MUD_SPEED_FACTOR : 1);
  }
  kickMul(p) { return p.kick > 0 ? C.KICK_BOOST : 1; }
  mass(p) { return p.heavy > 0 ? C.HEAVY_MASS : 1; }

  // team: 0 blue / 1 red (who buys it). arg: { cube: 0|1, x, z }. Returns { ok, error?, events }.
  // Cost, cooldowns and who may call this are enforced by the server, not here.
  applyPower(team, id, arg = {}) {
    const spec = POWERS[id];
    if (!spec) return { ok: false, error: 'Unknown item' };
    const dur = sec(spec.duration), ev = [];
    let target = null;
    if (spec.target === 'ownCube' || spec.target === 'enemyCube') {
      const ci = arg.cube === 1 ? 1 : arg.cube === 0 ? 0 : -1;
      if (ci < 0) return { ok: false, error: 'Choose a cube' };
      target = this.players[(spec.target === 'ownCube' ? team : 1 - team) * 2 + ci];
    }
    let x = 0, z = 0;
    if (spec.target === 'point') {
      x = Number(arg.x); z = Number(arg.z);
      if (!Number.isFinite(x) || !Number.isFinite(z)) return { ok: false, error: 'Choose a spot on the pitch' };
      const s = pitchSdf(x, z);
      if (s.d > -1) { const k = s.d + 1; x -= s.nx * k; z -= s.nz * k; }   // keep it inside the pitch
    }
    switch (id) {
      case 'speed': target.speed = Math.max(target.speed, dur); break;
      case 'kick': target.kick = Math.max(target.kick, dur); break;
      case 'heavy': target.heavy = Math.max(target.heavy, dur); break;
      case 'ice': target.slow = Math.max(target.slow, dur); break;
      case 'invert': target.invert = Math.max(target.invert, dur); break;
      case 'smallgoal': this.goalMods.push({ end: team, mul: C.SMALL_GOAL_FACTOR, left: dur }); break;
      case 'biggoal': this.goalMods.push({ end: 1 - team, mul: C.BIG_GOAL_FACTOR, left: dur }); break;
      case 'bomb':
        if (this.bombs.length >= C.MAX_BOMBS) return { ok: false, error: 'Too many bombs on the pitch' };
        this.bombs.push({ x, z, fuse: sec(C.BOMB_FUSE), team }); break;
      case 'mud':
        if (this.mud.length >= C.MAX_MUD) return { ok: false, error: 'Too many mud pits' };
        this.mud.push({ x, z, r: C.MUD_RADIUS, left: dur }); break;
      default: return { ok: false, error: 'Unknown item' };
    }
    ev.push({ type: 'power', team, id, cube: arg.cube, x: spec.target === 'point' ? x : undefined, z: spec.target === 'point' ? z : undefined });
    this.updateGoals();
    return { ok: true, events: ev };
  }

  updateGoals() {
    const m = [1, 1];
    for (const g of this.goalMods) m[g.end] *= g.mul;
    this.gw[0] = C.GOAL_HALF_WIDTH * clamp(m[0], 0.4, 2.2);
    this.gw[1] = C.GOAL_HALF_WIDTH * clamp(m[1], 0.4, 2.2);
  }

  // Compact snapshot of everything effect-related, for drawing.
  fxState() {
    const bits = this.players.map((p) => (p.speed > 0 ? 1 : 0) | (p.kick > 0 ? 2 : 0) | (p.heavy > 0 ? 4 : 0) | (p.invert > 0 ? 8 : 0) | (p.slow > 0 ? 16 : 0) | (p.stun > 0 ? 32 : 0) | (p.mud ? 64 : 0));
    const r2 = (v) => Math.round(v * 100) / 100;
    return {
      gw: [r2(this.gw[0]), r2(this.gw[1])],
      bombs: this.bombs.map((b) => [r2(b.x), r2(b.z), r2(b.fuse * C.DT)]),
      mud: this.mud.map((m) => [r2(m.x), r2(m.z), m.r]),
      cubes: bits,
    };
  }

  explode(b, events) {
    const R = C.BOMB_RADIUS;
    for (const p of this.players) {
      const dx = p.x - b.x, dz = p.z - b.z, d = Math.hypot(dx, dz);
      if (d >= R) continue;
      const k = 1 - d / R;
      let ux, uz;
      if (d > 0.05) { ux = dx / d; uz = dz / d; } else { const a = this.rng() * Math.PI * 2; ux = Math.cos(a); uz = Math.sin(a); }
      const mf = p.heavy > 0 ? 0.2 : 1;
      p.vx += ux * C.BOMB_CUBE_IMPULSE * (0.35 + 0.65 * k) * mf;
      p.vz += uz * C.BOMB_CUBE_IMPULSE * (0.35 + 0.65 * k) * mf;
      if (p.heavy <= 0) p.stun = Math.max(p.stun, sec(C.BOMB_STUN));
    }
    const bl = this.ball, dx = bl.x - b.x, dz = bl.z - b.z, d = Math.hypot(dx, dz);
    if (d < R) {
      const k = 1 - d / R;
      let ux, uz;
      if (d > 0.05) { ux = dx / d; uz = dz / d; } else { const a = this.rng() * Math.PI * 2; ux = Math.cos(a); uz = Math.sin(a); }
      bl.vx += ux * C.BOMB_BALL_IMPULSE * (0.3 + 0.7 * k); bl.vz += uz * C.BOMB_BALL_IMPULSE * (0.3 + 0.7 * k);
      bl.vy += C.BOMB_BALL_LIFT * (0.3 + 0.7 * k);
    }
    events.push({ type: 'explode', x: Math.round(b.x * 100) / 100, z: Math.round(b.z * 100) / 100 });
  }

  // Observation for one team, in that team's own frame. Returns [Float64Array, Float64Array].
  obs(team) {
    const s = team === 0 ? 1 : -1;       // frame sign: red is rotated 180 degrees
    const mates = team === 0 ? [0, 1] : [2, 3];
    const opps = team === 0 ? [2, 3] : [0, 1];
    const P = this.players, b = this.ball;
    const tl = this.overtime ? 0 : Math.max(0, 1 - this.clockTicks * C.DT / this.matchSeconds);
    const sd = (this.score[team] - this.score[1 - team]) / this.goalsToWin;
    const bx = s * b.x, bz = s * b.z;
    const ownGw = this.gw[team] / C.GOAL_HALF_WIDTH, oppGw = this.gw[1 - team] / C.GOAL_HALF_WIDTH;
    const out = [];
    for (let k = 0; k < 2; k++) {
      const me = P[mates[k]], mate = P[mates[1 - k]];
      const mx = s * me.x, mz = s * me.z;
      const o = new Float64Array(OBS_SIZE);
      o[0] = mx / HL; o[1] = mz / HW;
      o[2] = s * me.vx / C.MAX_SPEED; o[3] = s * me.vz / C.MAX_SPEED;
      o[4] = me.cd / C.KICK_COOLDOWN;
      o[5] = this.canKick(me) ? 1 : 0;
      o[6] = bx / HL; o[7] = b.y / 10; o[8] = bz / HW;
      o[9] = s * b.vx / 25; o[10] = b.vy / 25; o[11] = s * b.vz / 25;
      o[12] = (bx - mx) / (2 * HL); o[13] = (bz - mz) / (2 * HW);
      const put = (idx, q) => {
        o[idx] = (s * q.x - mx) / (2 * HL); o[idx + 1] = (s * q.z - mz) / (2 * HW);
        o[idx + 2] = s * q.vx / C.MAX_SPEED; o[idx + 3] = s * q.vz / C.MAX_SPEED;
      };
      put(14, mate); put(18, P[opps[0]]); put(22, P[opps[1]]);
      o[26] = (HL - mx) / (2 * HL); o[27] = (0 - mz) / (2 * HW);
      o[28] = (-HL - mx) / (2 * HL); o[29] = (0 - mz) / (2 * HW);
      o[30] = tl; o[31] = sd; o[32] = k;
      o[33] = ownGw; o[34] = oppGw;
      o[35] = this.speedMul(me); o[36] = this.kickMul(me); o[37] = me.heavy > 0 ? 1 : 0; o[38] = me.invert > 0 ? 1 : 0; o[39] = me.mud ? 1 : 0;
      if (this.bombs.length) {
        const list = this.bombs.map((bm) => ({ bm, d: Math.hypot(bm.x - me.x, bm.z - me.z) })).sort((a, c) => a.d - c.d);
        for (let n = 0; n < 2 && n < list.length; n++) {
          const bm = list[n].bm, base = 40 + n * 3;
          o[base] = (s * bm.x - mx) / (2 * HL); o[base + 1] = (s * bm.z - mz) / (2 * HW); o[base + 2] = bm.fuse * C.DT / C.BOMB_FUSE;
        }
      }
      out.push(o);
    }
    return out;
  }

  canKick(p) {
    const b = this.ball;
    const d = Math.hypot(b.x - p.x, b.z - p.z);
    return d <= PR + BR + C.KICK_REACH && b.y - BR < C.PLAYER_HEIGHT + 0.5;
  }

  // actionsBlue / actionsRed: arrays of 2 actions [moveX, moveZ, kick, angle?, strength?], each in the team's own frame.
  // Runs ACTION_REPEAT physics ticks. Returns a list of events that happened.
  step(actionsBlue, actionsRed) {
    const world = [
      actionsBlue[0], actionsBlue[1],
      [-actionsRed[0][0], -actionsRed[0][1], ...actionsRed[0].slice(2)],
      [-actionsRed[1][0], -actionsRed[1][1], ...actionsRed[1].slice(2)],
    ];
    const events = [];
    for (let i = 0; i < C.ACTION_REPEAT && !this.done; i++) this.tickOnce(world, events);
    return events;
  }

  tickOnce(act, events) {
    const dt = C.DT, P = this.players, b = this.ball;
    this.tick++;
    const frozen = this.pause > 0;

    // ---- effect timers (frozen during the goal celebration) ----
    if (!frozen) {
      for (const p of P) {
        if (p.speed > 0) p.speed--; if (p.kick > 0) p.kick--; if (p.heavy > 0) p.heavy--;
        if (p.invert > 0) p.invert--; if (p.slow > 0) p.slow--; if (p.stun > 0) p.stun--;
        p.mud = false;
        for (const m of this.mud) if (Math.hypot(p.x - m.x, p.z - m.z) < m.r) { p.mud = true; break; }
      }
      if (this.goalMods.length) { this.goalMods = this.goalMods.filter((g) => --g.left > 0); this.updateGoals(); }
      if (this.mud.length) this.mud = this.mud.filter((m) => --m.left > 0);
      if (this.bombs.length) {
        const live = [];
        for (const bm of this.bombs) { if (--bm.fuse <= 0) this.explode(bm, events); else live.push(bm); }
        this.bombs = live;
      }
    }

    // ---- players ----
    for (const p of P) {
      let mx = 0, mz = 0, kick = 0, ang, str;
      if (!frozen) {
        const a = act[p.i] || [0, 0, 0];
        mx = Number.isFinite(a[0]) ? a[0] : 0; mz = Number.isFinite(a[1]) ? a[1] : 0;
        kick = Number.isFinite(a[2]) ? a[2] : 0; ang = a[3]; str = a[4];
        if (p.invert > 0) { mx = -mx; mz = -mz; }
      }
      const l = Math.hypot(mx, mz);
      if (l > 1) { mx /= l; mz /= l; }
      const sm = this.speedMul(p);
      const dvx = mx * C.MAX_SPEED * sm - p.vx, dvz = mz * C.MAX_SPEED * sm - p.vz;
      const dl = Math.hypot(dvx, dvz), maxd = C.ACCEL * dt * (p.speed > 0 ? 1.5 : 1) * (p.stun > 0 ? 0.2 : 1) * (p.mud ? 0.7 : 1);
      if (dl > maxd) { p.vx += (dvx / dl) * maxd; p.vz += (dvz / dl) * maxd; } else { p.vx += dvx; p.vz += dvz; }
      p.x += p.vx * dt; p.z += p.vz * dt;
      p.cd = Math.max(0, p.cd - dt);
      if (kick > 0.5 && p.cd <= 0 && this.canKick(p)) {
        let nx = b.x - p.x, nz = b.z - p.z;
        const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
        const el = (Number.isFinite(ang) ? (clamp(ang, -1, 1) + 1) / 2 * C.KICK_MAX_ELEVATION : C.KICK_DEFAULT_ELEVATION) * DEG;
        const s01 = Number.isFinite(str) ? (clamp(str, -1, 1) + 1) / 2 : 1;
        const v = Math.min(C.KICK_ABS_MAX, (C.KICK_MIN_SPEED + s01 * (C.KICK_SPEED - C.KICK_MIN_SPEED)) * this.kickMul(p));
        b.vx = nx * v * Math.cos(el) + p.vx * 0.3; b.vz = nz * v * Math.cos(el) + p.vz * 0.3;
        b.vy = v * Math.sin(el);
        p.cd = C.KICK_COOLDOWN_MIN + (C.KICK_COOLDOWN - C.KICK_COOLDOWN_MIN) * s01;
        events.push({ type: 'kick', agent: p.i, el: Math.round(el / DEG), v: Math.round(v * 10) / 10 });
      }
    }

    // ---- player vs player, player vs wall ----
    for (let it = 0; it < 2; it++) {
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
        const a = P[i], c = P[j];
        let dx = c.x - a.x, dz = c.z - a.z;
        const d = Math.hypot(dx, dz), min = 2 * PR;
        if (d < min) {
          if (d < 1e-6) { dx = 1; dz = 0; } else { dx /= d; dz /= d; }
          const ma = this.mass(a), mc = this.mass(c), tot = ma + mc;
          const push = min - d;
          a.x -= dx * push * (mc / tot); a.z -= dz * push * (mc / tot);
          c.x += dx * push * (ma / tot); c.z += dz * push * (ma / tot);
          const rv = (c.vx - a.vx) * dx + (c.vz - a.vz) * dz;
          if (rv < 0) {
            const j2 = -(1 + C.PLAYER_BOUNCE) * rv / (1 / ma + 1 / mc);
            a.vx -= dx * j2 / ma; a.vz -= dz * j2 / ma; c.vx += dx * j2 / mc; c.vz += dz * j2 / mc;
          }
        }
      }
      for (const p of P) this.clampPlayer(p);
    }

    // ---- ball ----
    b.vy -= C.GRAVITY * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    let drag = b.y <= BR + 1e-3 ? C.GROUND_DRAG : C.AIR_DRAG;
    if (this.mud.length && b.y <= BR + 0.3) for (const m of this.mud) if (Math.hypot(b.x - m.x, b.z - m.z) < m.r) { drag += 3.5; break; }
    const dr = Math.exp(-drag * dt);
    b.vx *= dr; b.vz *= dr;
    const sp = Math.hypot(b.vx, b.vy, b.vz);
    if (sp > C.BALL_MAX_SPEED) { const k = C.BALL_MAX_SPEED / sp; b.vx *= k; b.vy *= k; b.vz *= k; }
    this.ballFloorCeiling();

    for (let it = 0; it < 4; it++) {
      for (const p of P) this.ballVsPlayer(p, events);
      this.ballVsWalls();
      // If the ball was shoved into a wall the player gives way instead ("pinch out").
      for (const p of P) {
        const ov = this.overlap(p);
        if (ov > 1e-3) {
          const dx = p.x - b.x, dz = p.z - b.z, dl = Math.hypot(dx, dz) || 1;
          p.x += (dx / dl) * ov; p.z += (dz / dl) * ov;
          this.clampPlayer(p);
        }
      }
    }
    for (const p of P) {
      const ov = this.overlap(p);
      if (ov > 0.02) {
        // Ball is trapped between a cube and a wall: pop it out toward the middle of the pitch.
        let cx = -b.x, cz = -b.z; const cl = Math.hypot(cx, cz) || 1; cx /= cl; cz /= cl;
        b.x += cx * (ov + 0.3); b.z += cz * (ov + 0.3);
        b.vx = cx * 6; b.vz = cz * 6; b.vy = 5;
        this.ballVsWalls();
        events.push({ type: 'pop' });
        break;
      }
    }

    // ---- goals ----
    const end = b.x > 0 ? 1 : 0;
    if (!frozen && Math.abs(b.z) < this.gw[end] && Math.abs(b.x) > HL + BR && b.y < C.GOAL_HEIGHT) {
      const team = b.x > 0 ? 0 : 1;   // ball in the +x goal => blue scored
      this.score[team]++;
      events.push({ type: 'goal', team, score: this.score.slice() });
      this.pause = Math.round(C.GOAL_PAUSE_SECONDS / dt);
      this.checkEnd(true);
    }

    // ---- clock / pause ----
    if (frozen) {
      this.pause--;
      if (this.pause === 0 && !this.done) this.spawn();
    } else {
      this.clockTicks++;
      this.checkEnd(false);
      // stall protection
      const r = this.stallRef;
      if (Math.hypot(b.x - r.x, b.z - r.z) + Math.abs(b.y - r.y) > 1) {
        r.x = b.x; r.y = b.y; r.z = b.z; this.stallTimer = 0;
      } else if ((this.stallTimer += dt) > C.STALL_SECONDS) {
        this.spawn();
        events.push({ type: 'stall' });
      }
    }
  }

  checkEnd(afterGoal) {
    if (this.done) return;
    const [s0, s1] = this.score;
    if (afterGoal) {
      if (s0 >= this.goalsToWin || s1 >= this.goalsToWin || this.overtime) this.finish();
      return;
    }
    const t = this.clockTicks * C.DT;
    if (!this.overtime && t >= this.matchSeconds) {
      if (s0 !== s1) this.finish();
      else if (this.overtimeSeconds > 0) this.overtime = true;
      else this.finish();
    } else if (this.overtime && t >= this.matchSeconds + this.overtimeSeconds) this.finish();
  }

  finish() {
    this.done = true;
    const [s0, s1] = this.score;
    this.winner = s0 > s1 ? 0 : s1 > s0 ? 1 : -1;
  }

  clampPlayer(p) {
    const s = pitchSdf(p.x, p.z);
    if (s.d + PR > 0) {
      const k = s.d + PR;
      p.x -= s.nx * k; p.z -= s.nz * k;
      const vn = p.vx * s.nx + p.vz * s.nz;
      if (vn > 0) { p.vx -= vn * s.nx; p.vz -= vn * s.nz; }
    }
  }

  overlap(p) {
    const b = this.ball;
    if (b.y - BR >= C.PLAYER_HEIGHT) return 0;
    return Math.max(0, PR + BR - Math.hypot(b.x - p.x, b.z - p.z));
  }

  ballFloorCeiling() {
    const b = this.ball;
    if (b.y < BR) {
      b.y = BR;
      if (b.vy < 0) { b.vy = -b.vy * C.BALL_FLOOR_BOUNCE; if (b.vy < 1) b.vy = 0; }
    }
    if (b.y > C.CEILING - BR) { b.y = C.CEILING - BR; if (b.vy > 0) b.vy = -b.vy * 0.5; }
  }

  ballVsPlayer(p, events) {
    const b = this.ball;
    if (b.y - BR >= C.PLAYER_HEIGHT) return;
    let dx = b.x - p.x, dz = b.z - p.z;
    const d = Math.hypot(dx, dz), min = PR + BR;
    if (d >= min) return;
    if (d < 1e-6) { const l = Math.hypot(b.x, b.z) || 1; dx = -b.x / l; dz = -b.z / l; } else { dx /= d; dz /= d; }
    const push = min - d;
    b.x += dx * push; b.z += dz * push;
    const rv = (b.vx - p.vx) * dx + (b.vz - p.vz) * dz;
    if (rv < 0) {
      const j = -(1 + C.BALL_PLAYER_BOUNCE) * rv;
      b.vx += dx * j; b.vz += dz * j;
      events.push({ type: 'touch', agent: p.i });
    }
  }

  ballVsWalls() {
    const b = this.ball;
    const end = b.x >= 0 ? 1 : 0, gw = this.gw[end];
    const inMouth = Math.abs(b.z) < gw && b.y < C.GOAL_HEIGHT && Math.abs(b.x) > HL - 2 * BR;
    if (inMouth) {
      const sx = b.x >= 0 ? 1 : -1;
      if (Math.abs(b.x) > HL - BR * 0.5) {
        if (b.y > C.GOAL_HEIGHT - BR) { b.y = C.GOAL_HEIGHT - BR; if (b.vy > 0) b.vy = -b.vy * 0.4; }
      }
      if (Math.abs(b.x) > HL) {
        const zl = gw - BR;
        if (b.z > zl) { b.z = zl; if (b.vz > 0) b.vz = -b.vz * C.BALL_WALL_BOUNCE; }
        if (b.z < -zl) { b.z = -zl; if (b.vz < 0) b.vz = -b.vz * C.BALL_WALL_BOUNCE; }
      }
      const back = HL + C.GOAL_DEPTH - BR;
      if (Math.abs(b.x) > back) {
        b.x = sx * back;
        if (b.vx * sx > 0) b.vx = -b.vx * C.BALL_WALL_BOUNCE;
      }
      return;
    }
    const s = pitchSdf(b.x, b.z);
    if (s.d + BR > 0) {
      const k = s.d + BR;
      b.x -= s.nx * k; b.z -= s.nz * k;
      const vn = b.vx * s.nx + b.vz * s.nz;
      if (vn > 0) { b.vx -= (1 + C.BALL_WALL_BOUNCE) * vn * s.nx; b.vz -= (1 + C.BALL_WALL_BOUNCE) * vn * s.nz; }
    }
  }
}
