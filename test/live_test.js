// node test/live_test.js - runs a short live series in real time, buys items mid-match, checks messages and replay.
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { LiveSeries } from '../server/live.js';
import { makeBot } from '../src/bots.js';
import { makeRng } from '../src/rng.js';
import { ECONOMY, POWERS } from '../src/config.js';

const msgs = []; let fin = null;
const rng = makeRng(2);
const live = new LiveSeries({
  names: { blue: 'A', red: 'B' }, coins: [100, 5], countdownMs: 200, gapSeconds: 0.3, winsNeeded: 1, maxMatches: 2,
  matchOpts: { matchSeconds: 6, overtimeSeconds: 0, goalsToWin: 3 },
  teamsFor: () => ({ blue: makeBot('chaser', rng), red: makeBot('idle', rng) }),
  broadcast: (m) => msgs.push(m), seedBase: 11, onFinish: (r) => { fin = r; },
});
live.start();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(900);
// purchases
let r = live.command('blue', { id: 'bomb', x: 5, z: 5 }); assert.ok(r.ok, JSON.stringify(r)); assert.equal(r.balance, 100 - POWERS.bomb.cost + (live.coins[0] - (100 - POWERS.bomb.cost)));
r = live.command('blue', { id: 'speed', cube: 0 }); assert.ok(!r.ok && /moment/.test(r.error), 'global cooldown: ' + JSON.stringify(r));
r = live.command('red', { id: 'ice', cube: 0 }); assert.ok(!r.ok && /Not enough/.test(r.error), 'red only has ~5 coins');
r = live.command(null, { id: 'speed', cube: 0 }); assert.ok(!r.ok);
await sleep(1400);
r = live.command('blue', { id: 'bomb', x: 5, z: 5 }); assert.ok(!r.ok && /cooling/.test(r.error), 'same-item cooldown ' + JSON.stringify(r));
r = live.command('blue', { id: 'speed', cube: 1 }); assert.ok(r.ok, JSON.stringify(r));
r = live.command('blue', { id: 'speed', cube: 7 }); assert.ok(!r.ok);
const snap = live.snapshot(); assert.equal(snap.t, 'snapshot'); assert.ok(snap.matches[snap.matches.length - 1].frames.length > 20);
const t0 = Date.now();
while (!fin && Date.now() - t0 < 30000) await sleep(100);
assert.ok(fin, 'series finished');
const types = msgs.reduce((a, m) => ((a[m.t] = (a[m.t] || 0) + 1), a), {});
console.log(types, 'wins', live.wins, 'coins', live.coins);
assert.ok(types.series_start === 1 && types.match_start >= 1 && types.f > 100 && types.match_end >= 1 && types.series_end === 1);
const full = JSON.parse(zlib.gunzipSync(fin.gz));
assert.ok(full.matches[0].frames.length === msgs.filter((m) => m.t === 'f' && m.m === 0).length + 1, 'every streamed frame is in the replay');
assert.ok(full.matches[0].events.some((e) => e.type === 'power' && e.id === 'bomb'), 'bomb purchase recorded');
assert.ok(full.matches[0].events.some((e) => e.type === 'explode'), 'explosion recorded');
assert.ok(full.matches[0].fx.length > 2, 'fx timeline recorded');
// frame spacing ~50ms
const fm = msgs.filter((m) => m.t === 'f' && m.m === 0);
assert.deepEqual(fm.slice(0, 5).map((m) => m.k), [1, 2, 3, 4, 5]);
console.log('live engine OK: frames', full.matches[0].frames.length, 'events', full.matches[0].events.length);
live.stop();
