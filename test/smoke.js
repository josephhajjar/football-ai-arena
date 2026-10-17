// node test/smoke.js  - checks the rules that matter: determinism, containment, anti-pinch, goals, file validation.
import assert from 'node:assert/strict';
import { CONFIG as C, OBS_SIZE } from '../src/config.js';
import { Game } from '../src/sim.js';
import { makeRng } from '../src/rng.js';
import { runMatch, runSeries } from '../src/match.js';
import { makeBot } from '../src/bots.js';
import { randomWeights, validateWeights, policiesFromWeights } from '../src/policy.js';

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };
const Z = [[0, 0, 0], [0, 0, 0]];

ok('determinism: same seed + same policies => identical replay', () => {
  const a = runMatch({ blue: makeBot('chaser'), red: makeBot('random', makeRng(3)) }, 7);
  const b = runMatch({ blue: makeBot('chaser'), red: makeBot('random', makeRng(3)) }, 7);
  assert.deepEqual(a.frames, b.frames);
});

ok('containment: ball and cubes never leave the arena (random flailing, 8 matches)', () => {
  for (let s = 1; s <= 8; s++) {
    const g = new Game({ seed: s }), rng = makeRng(s * 31);
    const bots = [makeBot('random', rng), makeBot('random', rng)];
    for (let i = 0; i < 6000 && !g.done; i++) {
      g.step([bots[0][0].act(), bots[0][1].act()], [bots[1][0].act(), bots[1][1].act()]);
      const b = g.ball;
      assert.ok(Number.isFinite(b.x + b.y + b.z), 'ball NaN');
      assert.ok(Math.abs(b.x) <= C.HALF_LENGTH + C.GOAL_DEPTH + 1e-6 && Math.abs(b.z) <= C.HALF_WIDTH + 1e-6, `ball escaped ${b.x},${b.z}`);
      assert.ok(b.y <= C.CEILING && b.y >= 0, 'ball height');
      for (const p of g.players) assert.ok(Math.abs(p.x) <= C.HALF_LENGTH && Math.abs(p.z) <= C.HALF_WIDTH, 'cube escaped');
    }
  }
});

ok('round corners: ball fired into every corner stays inside the rounded outline and keeps moving out', () => {
  const cx = C.HALF_LENGTH - C.CORNER_RADIUS, cz = C.HALF_WIDTH - C.CORNER_RADIUS;
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const g = new Game({ seed: 1 });
    g.players.forEach((p, i) => { p.x = [-5, -5, 5, 5][i]; p.z = [-2, 2, 2, -2][i]; });
    g.ball.x = sx * 26; g.ball.z = sz * 16; g.ball.vx = sx * 14; g.ball.vz = sz * 14;
    for (let i = 0; i < 400; i++) {
      g.tickOnce([Z[0], Z[0], Z[0], Z[0]], []);
      const dx = Math.max(0, Math.abs(g.ball.x) - cx), dz = Math.max(0, Math.abs(g.ball.z) - cz);
      assert.ok(Math.hypot(dx, dz) <= C.CORNER_RADIUS - C.BALL_RADIUS + 1e-6, 'ball outside corner arc');
    }
  }
});

ok('anti-pinch: cube pushing the ball into a wall never pins it', () => {
  const g = new Game({ seed: 1 });
  const p = g.players[0];
  p.x = 0; p.z = 17.4; g.ball.x = 0; g.ball.z = 19.0; g.ball.vx = g.ball.vz = 0;
  let maxOverlap = 0;
  for (let i = 0; i < 240; i++) {
    g.tickOnce([[0, 1, 0], Z[0], Z[0], Z[0]], []);
    maxOverlap = Math.max(maxOverlap, g.overlap(p));
    assert.ok(g.ball.z <= C.HALF_WIDTH - C.BALL_RADIUS + 1e-6, 'ball inside wall');
  }
  assert.ok(g.overlap(p) < 0.05, 'ball still squeezed: ' + g.overlap(p));
  assert.ok(maxOverlap < 0.2, 'overlap too large: ' + maxOverlap);
});

ok('goal: ball rolled into the red goal scores for blue; into blue goal scores for red', () => {
  for (const [dir, team] of [[1, 0], [-1, 1]]) {
    const g = new Game({ seed: 2 });
    g.players.forEach((p, i) => { p.x = [-20, -20, 20, 20][i]; p.z = [-12, 12, 12, -12][i]; });
    g.ball.x = dir * 24; g.ball.z = 0; g.ball.vx = dir * 12; g.ball.vz = 0;
    let scored = false;
    for (let i = 0; i < 200 && !scored; i++) { const ev = []; g.tickOnce([Z[0], Z[0], Z[0], Z[0]], ev); scored = ev.some((e) => e.type === 'goal' && e.team === team); }
    assert.ok(scored, 'no goal for team ' + team);
    assert.deepEqual(g.score, team === 0 ? [1, 0] : [0, 1]);
  }
});

ok('goal: ball over the crossbar does not score', () => {
  const g = new Game({ seed: 2 });
  g.players.forEach((p, i) => { p.x = [-20, -20, 20, 20][i]; p.z = [-12, 12, 12, -12][i]; });
  g.ball.x = 27; g.ball.y = 6; g.ball.z = 0; g.ball.vx = 15; g.ball.vy = 3;
  for (let i = 0; i < 200; i++) g.tickOnce([Z[0], Z[0], Z[0], Z[0]], []);
  assert.deepEqual(g.score, [0, 0]);
});

ok('red frame mirrors blue frame (rotation by 180 degrees)', () => {
  const g = new Game({ seed: 4 });
  const ob = g.obs(0), or = g.obs(1);
  assert.equal(ob[0].length, OBS_SIZE);
  // blue cube 0 and red cube 0 start at opposite spots => same relative geometry in own frame (up to jitter)
  assert.ok(Math.abs(ob[0][0] + 0.4) < 0.15 && Math.abs(or[0][0] + 0.4) < 0.15);
  assert.equal(ob[1][32], 1); assert.equal(or[0][32], 0);
});

ok('match ends: first to goalsToWin, and bots finish a full series', () => {
  const r = runSeries(() => ({ blue: makeBot('chaser'), red: makeBot('idle') }), 11);
  assert.ok(r.winner === 0 && r.wins[0] === 2, JSON.stringify(r.wins));
});

ok('weights: random file validates; broken files are rejected with messages', () => {
  const w = randomWeights(makeRng(1));
  assert.ok(validateWeights(w).ok);
  const run = runMatch({ blue: policiesFromWeights(w), red: policiesFromWeights(w) }, 5);
  assert.ok(run.frames.length > 100);
  const bad = structuredClone(w); bad.agents[0].layers[0].w[0].pop();
  assert.ok(!validateWeights(bad).ok);
  const nan = structuredClone(w); nan.agents[0].layers[0].b[0] = null;
  assert.ok(!validateWeights(nan).ok);
  const big = randomWeights(makeRng(1), [256, 256, 256]);
  assert.ok(!validateWeights(big).ok, 'param cap');
  const wrongOut = structuredClone(w); wrongOut.agents[1].layers.pop();
  assert.ok(!validateWeights(wrongOut).ok);
});

console.log(`\n${n} checks passed`);
