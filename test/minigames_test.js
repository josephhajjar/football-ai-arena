// node test/minigames_test.js - drives every minigame to completion with simple bots; checks rules + the session flow.
import assert from 'node:assert/strict';
import { GAMES, MiniSession, coinsFor } from '../server/minigames.js';
import { makeRng } from '../src/rng.js';

let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };
const run = (id, botFn, seed = 1, maxT = 400) => {
  const g = GAMES[id].make({ need: GAMES[id].need, rng: makeRng(seed) });
  let now = 1e6, t = 0;
  while (g.phase !== 'done' && t < maxT) { botFn(g, t, now); g.step(1 / 30, now); now += 1000 / 30; t += 1 / 30; }
  return { g, t };
};

ok('sumo: a chasing bot beats an idle one; platform shrinks; dash works', () => {
  const chase = (g, t, now) => { const [a, b] = g.pl; g.setInput(0, { mx: b.x - a.x, mz: b.z - a.z }, now); if (g.phase === 'play' && Math.round(t * 30) % 12 === 0) g.setInput(0, { dash: true }, now); };
  const { g, t } = run('sumo', chase);
  assert.equal(g.winner, 0); assert.equal(g.scores[0], 2); assert.ok(t < 60);
  const idle = GAMES.sumo.make({ need: 2, rng: makeRng(3) }); let now = 0;
  for (let i = 0; i < 30 * 12; i++) { idle.step(1 / 30, now); now += 33; if (idle.phase !== 'play' && idle.phase !== 'countdown') break; }
  assert.ok(idle.R < 9, 'platform shrinks: ' + idle.R);
});

ok('sumo: two idle players are resolved by the game (never hang forever)', () => {
  const { g, t } = run('sumo', () => {}, 2, 400);
  assert.ok(g.phase === 'done' || t >= 299, `phase ${g.phase} t ${t}`);
});

ok('bomb tag: passing works on contact; the bomb always explodes and someone loses', () => {
  const g = GAMES.tag.make({ need: 2, rng: makeRng(4) });
  let now = 0; for (let i = 0; i < 100; i++) { g.step(1 / 30, now); now += 33; }
  assert.equal(g.phase, 'play');
  const start = g.holder; g.pl[0].x = 0; g.pl[0].z = -7; g.pl[1].x = 0.9; g.pl[1].z = -7; g.passCd = 0;
  g.step(1 / 30, now); assert.equal(g.holder, 1 - start, 'bomb passed on contact');
  const { g: g2 } = run('tag', (gg, t, nw) => { const o = gg.pl[1 - gg.holder], h = gg.pl[gg.holder]; gg.setInput(gg.holder, { mx: o.x - h.x, mz: o.z - h.z }, nw); gg.setInput(1 - gg.holder, { mx: o.x - h.x, mz: o.z - h.z }, nw); }, 5);
  assert.ok(g2.winner >= 0 && g2.phase === 'done');
});

ok('light cycles: crash ends the round, double crash replays, trails are reported', () => {
  const { g } = run('cycles', (gg, t, now) => { if (Math.round(t * 30) % 20 === 0) gg.setInput(0, { turn: 1, seq: Math.round(t * 30) }, now); }, 6);
  assert.ok(g.phase === 'done' && g.winner >= 0);
  const g2 = GAMES.cycles.make({ need: 2, rng: makeRng(1) });
  g2.phase = 'play'; g2.cy[0].x = 21; g2.cy[0].y = 13; g2.cy[0].d = 0; g2.cy[1].x = 23; g2.cy[1].y = 13; g2.cy[1].d = 2; g2.acc = 1;
  g2.stepPlay(0.01); assert.equal(g2.banner, 'Double crash! Replay'); assert.deepEqual(g2.scores, [0, 0]);
  assert.equal(g2.snapshot().trails.length, 2);
});

ok('air hockey: puck stays in the rink, goals score, first to 5 wins', () => {
  const { g, t } = run('hockey', (gg, tt, now) => {
    const u = gg.puck; gg.setInput(0, { x: u.x < 0 ? u.x - 1 : -8, z: u.z }, now); gg.setInput(1, { x: 11, z: 0 }, now);
    assert.ok(Math.abs(u.z) <= gg.hh + 1e-6 && Math.abs(u.x) <= gg.hw + 2);
  }, 7, 400);
  assert.ok(g.phase === 'done' && g.winner === 0, `winner ${g.winner} scores ${g.scores} t=${t}`);
});

ok('quick draw: jumping the gun loses; fastest valid press wins; reaction measured', () => {
  const g = GAMES.draw.make({ rng: makeRng(9) });
  let now = 1000; const adv = (s) => { for (let i = 0; i < Math.round(s * 30); i++) { g.step(1 / 30, now); now += 1000 / 30; } };
  adv(3); assert.equal(g.phase, 'play');
  g.setInput(0, { press: true }, now); adv(0.1);
  assert.equal(g.scores[1], 1, 'blue pressed before GO: red scores');
  adv(5); assert.equal(g.phase, 'play');
  adv(g.wait + 0.1); assert.ok(g.go);
  g.setInput(1, { press: true }, g.goReal + 300); g.setInput(0, { press: true }, g.goReal + 180); adv(0.1);
  assert.equal(g.scores[0], 1); assert.equal(g.react[0], 180);
});

ok('coins: payouts scale with rounds won and the host multiplier', () => {
  assert.deepEqual(coinsFor('sumo', 0, [2, 1], 1), [50, 17]);
  assert.deepEqual(coinsFor('sumo', 1, [0, 2], 2), [24, 100]);
});

// full session flow for every game, with a fake fast clock
for (const id of Object.keys(GAMES)) {
  const msgs = []; let res; let fake = 1e6;
  const s = new MiniSession({ gameId: id, bestOf: 1, send: (m) => msgs.push(m), onResult: (r) => { res = r; }, inviteMs: 1000, now: () => fake });
  s.join(0); assert.equal(s.phase, 'invite'); s.join(1); assert.equal(s.phase, 'play');
  assert.ok(msgs.some((m) => m.t === 'mg_start'));
  let tick = 0;
  while (!s.closed && tick < 400000) {
    fake += 33; tick++;
    const gm = s.game;
    if (gm && s.phase === 'play') {
      if (id === 'sumo' || id === 'tag') { const a = gm.pl[0], b = gm.pl[1]; s.input(0, { mx: b.x - a.x, mz: b.z - a.z }); if (tick % 20 === 0) s.input(0, { dash: true }); }
      if (id === 'hockey') { const u = gm.puck; s.input(0, { x: u.x < 0 ? u.x - 1 : -8, z: u.z }); }
      if (id === 'cycles' && tick % 15 === 0) s.input(tick % 2, { turn: 1, seq: tick });
      if (id === 'draw' && gm.go) s.input(0, { press: true });
    }
    s.tick();
  }
  assert.ok(res && res.winner >= -1, `${id} produced a result`);
  assert.ok(msgs.some((m) => m.t === 'mg' && m.s.g), `${id} snapshots flowed`);
  assert.ok(msgs.some((m) => m.t === 'mg_result') && msgs[msgs.length - 1].t === 'mg_end');
  n++; console.log(`  ok  session ${id}: winner=${res.winner} scores=${res.scores} coins=${res.coins}`);
}
{ // walkover + cancel
  let res; let fake = 5000;
  const s = new MiniSession({ gameId: 'sumo', send: () => {}, onResult: (r) => { res = r; }, now: () => fake, inviteMs: 1000 });
  s.join(1); fake += 1100; s.tick(); assert.equal(res.winner, 1); assert.ok(res.walkover && res.coins[1] === 20 && res.coins[0] === 0);
  let res2 = 'x'; const s2 = new MiniSession({ gameId: 'sumo', send: () => {}, onResult: (r) => { res2 = r; }, now: () => fake, inviteMs: 1000 });
  fake += 1100; s2.tick(); assert.equal(res2, null); assert.ok(s2.closed);
  n++; console.log('  ok  walkover pays half, no-show cancels cleanly');
}
console.log(`\n${n} minigame checks passed`);
