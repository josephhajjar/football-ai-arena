// node test/effects.js - kick angle/strength, power-ups, hazards, bombs, and a containment fuzz with random effects.
import assert from 'node:assert/strict';
import { CONFIG as C, POWERS, OBS_SIZE } from '../src/config.js';
import { Game } from '../src/sim.js';
import { makeRng } from '../src/rng.js';
import { makeBot } from '../src/bots.js';
import { runMatch } from '../src/match.js';
import { randomWeights, validateWeights, policiesFromWeights } from '../src/policy.js';

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };
const Z = [0, 0, 0, 0, 0];
const idle = () => [Z, Z, Z, Z];
const quiet = (g) => { g.players.forEach((p, i) => { p.x = [-20, -20, 20, 20][i]; p.z = [-12, 12, 12, -12][i]; }); };
const kickOnce = (act) => {
  const g = new Game({ seed: 3 }); quiet(g);
  const p = g.players[0]; p.x = 0; p.z = 0; g.ball.x = 1.8; g.ball.z = 0; g.ball.vx = g.ball.vz = 0;
  const a = idle(); a[0] = act;
  const ev = []; g.tickOnce(a, ev);
  return { g, ev: ev.find((e) => e.type === 'kick') };
};

ok('kick angle: -1 = flat, 0 = 35 deg, +1 = 70 deg (never higher)', () => {
  for (const [ang, deg] of [[-1, 0], [0, 35], [1, 70], [5, 70], [-9, 0]]) {
    const { g, ev } = kickOnce([0, 0, 1, ang, 1]);
    assert.ok(ev, 'no kick event');
    const b = g.ball, el = Math.atan2(b.vy, Math.hypot(b.vx, b.vz)) * 180 / Math.PI;
    assert.ok(Math.abs(el - deg) < 4, `angle ${ang}: expected ~${deg}, got ${el.toFixed(1)}`);
    assert.ok(el <= C.KICK_MAX_ELEVATION + 1, 'above 70 degrees');
  }
});

ok('kick strength: weakest 6 m/s, strongest 20 m/s, cooldown scales', () => {
  const lo = kickOnce([0, 0, 1, -1, -1]), hi = kickOnce([0, 0, 1, -1, 1]);
  assert.ok(Math.abs(lo.ev.v - C.KICK_MIN_SPEED) < 0.01 && Math.abs(hi.ev.v - C.KICK_SPEED) < 0.01, `${lo.ev.v} ${hi.ev.v}`);
  assert.ok(lo.g.players[0].cd < hi.g.players[0].cd);
  assert.ok(Math.abs(hi.g.players[0].cd - (C.KICK_COOLDOWN - C.DT)) < 0.02);
});

ok('legacy 3-value actions still kick (default low angle, full strength)', () => {
  const { g, ev } = kickOnce([0, 0, 1]);
  assert.ok(ev && ev.v === C.KICK_SPEED && ev.el === Math.round(C.KICK_DEFAULT_ELEVATION), JSON.stringify(ev));
  assert.ok(g.ball.vx > 19);
});

ok('a 70 degree full-power kick never leaves the ceiling or gets stuck', () => {
  const g = new Game({ seed: 3 }); quiet(g);
  const p = g.players[0]; p.x = 0; p.z = 0; g.ball.x = 1.8;
  const a = idle(); a[0] = [0, 0, 1, 1, 1];
  g.tickOnce(a, []);
  let maxY = 0;
  for (let i = 0; i < 600; i++) { g.tickOnce(idle(), []); maxY = Math.max(maxY, g.ball.y); assert.ok(g.ball.y <= C.CEILING); }
  assert.ok(maxY > 6 && maxY < C.CEILING);
  assert.ok(g.ball.y <= C.BALL_RADIUS + 0.01 || Math.abs(g.ball.vy) < 15, 'ball keeps bouncing normally');
});

ok('legacy weights files (33 in / 3 out) validate and play; new files (46/5) too', () => {
  const legacy = randomWeights(makeRng(2), [16, 16], 33, 3), modern = randomWeights(makeRng(2));
  assert.ok(validateWeights(legacy).ok && validateWeights(modern).ok);
  const r = runMatch({ blue: policiesFromWeights(legacy), red: policiesFromWeights(modern) }, 4);
  assert.ok(r.frames.length > 100);
  assert.equal(policiesFromWeights(legacy)[0].act(new Float64Array(OBS_SIZE)).length, 3);
  assert.equal(policiesFromWeights(modern)[0].act(new Float64Array(OBS_SIZE)).length, 5);
});

const stepsFor = (g, secs, act = idle()) => { for (let i = 0; i < secs / C.DT; i++) g.tickOnce(act, []); };

ok('speed: Turbo makes the chosen cube faster, expires on time', () => {
  const g = new Game({ seed: 5 }); quiet(g);
  assert.ok(g.applyPower(0, 'speed', { cube: 0 }).ok);
  const a = idle(); a[0] = [1, 0, 0, 0, 0]; a[1] = [1, 0, 0, 0, 0];
  stepsFor(g, 1.2, a);
  assert.ok(g.players[0].vx > g.players[1].vx * 1.4, `${g.players[0].vx} vs ${g.players[1].vx}`);
  stepsFor(g, POWERS.speed.duration, idle());
  assert.equal(g.players[0].speed, 0);
});

ok('ice: slows enemy cube; invert: reverses its movement; both only on the enemy', () => {
  const g = new Game({ seed: 5 }); quiet(g);
  g.applyPower(0, 'ice', { cube: 0 }); g.applyPower(0, 'invert', { cube: 1 });
  const a = idle(); a[2] = [-1, 0, 0, 0, 0]; a[3] = [-1, 0, 0, 0, 0];
  stepsFor(g, 1, a);
  assert.ok(Math.abs(g.players[2].vx) < 0.45 * C.MAX_SPEED, 'ice');
  assert.ok(g.players[3].vx > 3, 'inverted: pushed +x although asking -x');
  assert.equal(g.players[0].slow, 0);
});

ok('heavy: Iron Cube shoves a normal cube and shrugs off a bomb', () => {
  const g = new Game({ seed: 5 }); quiet(g);
  g.players[0].x = 0; g.players[0].z = 0; g.players[2].x = 2.4; g.players[2].z = 0;
  g.applyPower(0, 'heavy', { cube: 0 });
  const a = idle(); a[0] = [1, 0, 0, 0, 0];
  stepsFor(g, 1, a);
  assert.ok(g.players[2].x - 2.4 > 3, 'light cube pushed away');
  const h = new Game({ seed: 5 }); quiet(h);
  h.players[0].x = 0; h.players[0].z = 0; h.players[1].x = 3; h.players[1].z = 0;
  h.applyPower(0, 'heavy', { cube: 0 }); h.applyPower(1, 'bomb', { x: 1.5, z: 0 });
  stepsFor(h, 2.1);
  assert.ok(Math.abs(h.players[0].x) < Math.abs(h.players[1].x - 3) * 0.6 + 0.01 || Math.abs(h.players[0].vx) < 4);
});

ok('goal size: Tight Goal narrows own goal, Wide Goal widens the enemy goal, then restore', () => {
  const g = new Game({ seed: 5 }); quiet(g);
  g.applyPower(0, 'smallgoal'); g.applyPower(0, 'biggoal');
  assert.ok(Math.abs(g.gw[0] - 5 * C.SMALL_GOAL_FACTOR) < 1e-9 && Math.abs(g.gw[1] - 5 * C.BIG_GOAL_FACTOR) < 1e-9);
  assert.ok(Math.abs(g.obs(0)[0][33] - C.SMALL_GOAL_FACTOR) < 1e-9 && Math.abs(g.obs(0)[0][34] - C.BIG_GOAL_FACTOR) < 1e-9);
  assert.ok(Math.abs(g.obs(1)[0][33] - C.BIG_GOAL_FACTOR) < 1e-9, 'red sees its own goal as the wide one');
  stepsFor(g, 10.2);
  assert.equal(g.gw[0], 5); assert.equal(g.gw[1], 5);
});

ok('goal size: ball at z=6 scores in a wide goal but not in a normal one', () => {
  for (const [wide, expect] of [[false, 0], [true, 1]]) {
    const g = new Game({ seed: 6 }); quiet(g);
    if (wide) g.applyPower(1, 'biggoal');          // red widens the blue... target is team 0's end? (red buys -> enemy = blue goal at -x)
    g.ball.x = -24; g.ball.z = 6.4; g.ball.vx = -14; g.ball.vz = 0;
    for (let i = 0; i < 160; i++) g.tickOnce(idle(), []);
    assert.equal(g.score[1], expect, `wide=${wide}`);
  }
});

ok('a narrowed goal can still be scored in', () => {
  const g = new Game({ seed: 6 }); quiet(g);
  g.applyPower(1, 'smallgoal');       // red narrows its own goal (+x end)
  g.ball.x = 24; g.ball.z = 1; g.ball.vx = 14;
  for (let i = 0; i < 160; i++) g.tickOnce(idle(), []);
  assert.equal(g.score[0], 1);
});

ok('bomb: fuse, blast pushes cubes and ball away, nothing ends up outside the map', () => {
  const g = new Game({ seed: 7 }); quiet(g);
  g.players[0].x = 26; g.players[0].z = 16; g.players[2].x = 20; g.players[2].z = 14;
  g.ball.x = 27; g.ball.z = 16.5;
  g.applyPower(1, 'bomb', { x: 25, z: 15.5 });
  assert.equal(g.bombs.length, 1);
  assert.ok(Math.abs(g.obs(0)[0][42] - 1) < 1e-9, 'obs shows fuse');
  let boom = false;
  for (let i = 0; i < 3 / C.DT; i++) {
    const ev = []; g.tickOnce(idle(), ev); if (ev.some((e) => e.type === 'explode')) boom = true;
    for (const p of g.players) { const { d } = pitchCheck(p.x, p.z); assert.ok(d <= 1e-6, 'cube escaped the map during blast'); }
    assert.ok(Math.abs(g.ball.x) <= C.HALF_LENGTH + C.GOAL_DEPTH && Math.abs(g.ball.z) <= C.HALF_WIDTH, 'ball escaped');
  }
  assert.ok(boom && g.bombs.length === 0);
});
function pitchCheck(x, z) {
  const cx = C.HALF_LENGTH - C.CORNER_RADIUS, cz = C.HALF_WIDTH - C.CORNER_RADIUS;
  const ox = Math.max(0, Math.abs(x) - cx), oz = Math.max(0, Math.abs(z) - cz);
  return { d: Math.hypot(ox, oz) - C.CORNER_RADIUS + C.PLAYER_RADIUS - (Math.abs(x) <= cx && Math.abs(z) <= cz ? 0 : 0), };
}

ok('mud: slows cubes inside the pit only; bombs/mud are cleared at kickoff after a goal', () => {
  const g = new Game({ seed: 7 }); quiet(g);
  g.players[0].x = -5; g.players[0].z = 0; g.players[1].x = -5; g.players[1].z = 15;
  g.applyPower(0, 'mud', { x: -5, z: 0 });
  const a = idle(); a[0] = [0, 1, 0, 0, 0]; a[1] = [0, 1, 0, 0, 0]; a[1] = [0, -1, 0, 0, 0];
  stepsFor(g, 0.6, a);
  assert.ok(g.players[0].mud);
  g.applyPower(0, 'bomb', { x: 0, z: 0 });
  g.ball.x = 27; g.ball.z = 0; g.ball.vx = 14;
  for (let i = 0; i < 240 && g.pause === 0; i++) g.tickOnce(idle(), []);
  for (let i = 0; i < 200; i++) g.tickOnce(idle(), []);
  assert.equal(g.bombs.length + g.mud.length, 0, 'cleared after the goal reset');
});

ok('validation of targets: bad cube, bad point, unknown id are rejected', () => {
  const g = new Game({ seed: 7 });
  assert.ok(!g.applyPower(0, 'speed', {}).ok);
  assert.ok(!g.applyPower(0, 'bomb', { x: 'a', z: 1 }).ok);
  assert.ok(!g.applyPower(0, 'nuke', {}).ok);
  const r = g.applyPower(0, 'bomb', { x: 9999, z: -9999 });
  assert.ok(r.ok); const b = g.bombs[0];
  assert.ok(Math.abs(b.x) < C.HALF_LENGTH && Math.abs(b.z) < C.HALF_WIDTH, 'point pulled inside the pitch');
});

ok('FUZZ: 200 matches with random effects fired constantly: ball and cubes never leave the map, nothing NaN', () => {
  let violations = 0, explosions = 0, goals = 0;
  const ids = Object.keys(POWERS);
  for (let s = 1; s <= 200; s++) {
    const r = makeRng(s * 77), g = new Game({ seed: s, matchSeconds: 40, overtimeSeconds: 5 });
    const bots = [makeBot('chaser'), makeBot('random', makeRng(s))];
    for (let i = 0; i < 900 && !g.done; i++) {
      if (r() < 0.12) {
        const id = ids[Math.floor(r() * ids.length)];
        g.applyPower(r() < 0.5 ? 0 : 1, id, { cube: r() < 0.5 ? 0 : 1, x: (r() * 2 - 1) * 40, z: (r() * 2 - 1) * 30 });
      }
      const ob = g.obs(0), or = g.obs(1);
      const ev = g.step([bots[0][0].act(ob[0]), bots[0][1].act(ob[1])], [bots[1][0].act(or[0]), bots[1][1].act(or[1])]);
      for (const e of ev) { if (e.type === 'explode') explosions++; if (e.type === 'goal') goals++; }
      const b = g.ball;
      const fin = [b.x, b.y, b.z, b.vx, b.vy, b.vz, ...g.players.flatMap((p) => [p.x, p.z, p.vx, p.vz])].every(Number.isFinite);
      const inside = Math.abs(b.x) <= C.HALF_LENGTH + C.GOAL_DEPTH + 1e-6 && Math.abs(b.z) <= C.HALF_WIDTH + 1e-6 && b.y >= 0 && b.y <= C.CEILING + 1e-6;
      const cubes = g.players.every((p) => Math.abs(p.x) <= C.HALF_LENGTH && Math.abs(p.z) <= C.HALF_WIDTH);
      const mouthOk = Math.abs(b.x) <= C.HALF_LENGTH + 1e-6 || Math.abs(b.z) <= g.gw[b.x > 0 ? 1 : 0] + 1e-6;
      if (!fin || !inside || !cubes || !mouthOk) { violations++; console.log('violation', s, i, b); break; }
    }
  }
  assert.equal(violations, 0);
  assert.ok(explosions > 100 && goals > 20, `explosions ${explosions}, goals ${goals}`);
});

console.log(`\n${n} effect checks passed`);
