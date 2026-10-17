// node test/ws_flow_test.js - spawns the server in fast-test mode and plays a whole room over real HTTP + WebSocket:
// minigame -> coins -> upload -> LIVE series with a purchase -> late-joining spectator -> replay -> rematch.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomWeights, validateWeights } from '../src/policy.js';
import { makeRng } from '../src/rng.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3100 + Math.floor(Math.random() * 500), base = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, ['server/server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', FB_TEST_FAST: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const done = (code) => { srv.kill(); process.exit(code); };
process.on('uncaughtException', (e) => { console.error(e, '\n--- server log ---\n' + log); done(1); });
process.on('unhandledRejection', (e) => { console.error(e, '\n--- server log ---\n' + log); done(1); });
const post = async (p, b) => { const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, body: await r.json() }; };
const get = async (p) => (await fetch(base + p)).json();
for (let i = 0; i < 50; i++) { try { await fetch(base + '/'); break; } catch { await sleep(100); } }

class Client {
  constructor(code, token, name) {
    this.name = name; this.msgs = []; this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.opened = new Promise((res) => { this.ws.onopen = () => { this.send({ t: 'hello', code, token }); res(); }; });
    this.ws.onmessage = (e) => { const m = JSON.parse(e.data); this.msgs.push(m); this.onmsg && this.onmsg(m); };
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  async waitFor(type, ms = 20000, pred = () => true) {
    const t0 = Date.now();
    for (;;) { const m = this.msgs.find((x) => x.t === type && pred(x)); if (m) return m; if (Date.now() - t0 > ms) throw new Error(`${this.name}: timeout waiting for ${type}\n` + log); await sleep(25); }
  }
}

// ---- lobby ----
const host = (await post('/api/rooms', { name: 'Host' })).body;
const guest = (await post(`/api/rooms/${host.code}/join`, { name: 'Guest' })).body;
const spectate = await get(`/api/rooms/${host.code}/state`);
assert.equal(spectate.me, null); assert.equal(spectate.settings.minigames.enabled, true);
// host settings
let r = await post(`/api/rooms/${host.code}/settings`, { token: guest.token, settings: { minigames: { enabled: false } } });
assert.equal(r.status, 403, 'guest cannot change settings');
r = await post(`/api/rooms/${host.code}/settings`, { token: host.token, settings: { minigames: { games: ['draw', 'nope'], bestOf: 1, intervalMin: 999, firstAtMin: 2, coinMult: 2 } } });
assert.equal(r.status, 200);
const mgs = r.body.settings.minigames;
assert.deepEqual(mgs.games, ['draw']); assert.equal(mgs.intervalMin, 30); assert.equal(mgs.coinMult, 2); assert.equal(mgs.bestOf, 1);

const H = new Client(host.code, host.token, 'host'), G = new Client(host.code, guest.token, 'guest');
await H.opened; await G.opened;
const w = await H.waitFor('welcome'); assert.equal(w.side, 'blue'); assert.equal((await G.waitFor('welcome')).side, 'red');

// ---- training + minigame ----
assert.equal((await post(`/api/rooms/${host.code}/start`, { token: host.token, minutes: 5 })).status, 200);
assert.equal((await post(`/api/rooms/${host.code}/settings`, { token: host.token, settings: {} })).status, 409, 'settings locked after start');
// ---- Cube Clicker payout: capped by training time, cheating gets nothing extra ----
G.send({ t: 'clicker', score: 5000 });
const ck1 = await G.waitFor('coins', 5000, (m) => m.src === 'clicker'); assert.equal(ck1.gain[1], 4, 'first minute is capped at 4 coins');
await sleep(900); G.send({ t: 'clicker', score: 1e15 }); await sleep(500);
assert.equal(G.msgs.filter((m) => m.t === 'coins' && m.src === 'clicker').length, 1, 'huge fake score gets no extra coins inside the time cap');
G.send({ t: 'clicker', score: -5 }); G.send({ t: 'clicker', score: 'abc' });
console.log('clicker cap OK');
const inv = await H.waitFor('mg_invite', 30000); assert.equal(inv.id, 'draw');
await G.waitFor('mg_invite');
H.send({ t: 'mg_join' }); G.send({ t: 'mg_join' });
await H.waitFor('mg_start');
// the host bot presses SPACE the instant it turns green
let pressedRounds = 0;
H.onmsg = (m) => { if (m.t === 'mg' && m.s.g === 'draw' && m.s.phase === 'play' && m.s.go) H.send({ t: 'mg_input', i: { press: true } }); };
const res = await H.waitFor('mg_result', 60000);
H.onmsg = null; void pressedRounds;
assert.equal(res.winner, 0); assert.deepEqual(res.scores, [3, 0]);
assert.deepEqual(res.coins, [Math.round((25 + 3 * 3) * 2), Math.round(8 * 2)], 'coins pay 2x multiplier');
const coinMsg = await H.waitFor('coins', 20000, (m) => m.src !== 'clicker'); assert.deepEqual(coinMsg.c, [res.coins[0], res.coins[1] + 4]);
await H.waitFor('mg_end', 15000);
let st = await get(`/api/rooms/${host.code}/state?token=${host.token}`);
assert.equal(st.coins, res.coins[0]); assert.equal(st.mini, null);
console.log('minigame OK, coins', res.coins);

// ---- upload + lock => live series ----
const wts = randomWeights(makeRng(3), [16, 16]); assert.ok(validateWeights(wts).ok);
for (const [t, c] of [[host.token, H], [guest.token, G]]) assert.equal((await post(`/api/rooms/${host.code}/upload`, { token: t, weights: wts, lock: true })).status, 200);
const ss = await H.waitFor('series_start'); assert.ok(ss.startAt > Date.now() - 100);
st = await get(`/api/rooms/${host.code}/state?token=${host.token}`); assert.equal(st.phase, 'playing');
assert.equal((await fetch(`${base}/api/rooms/${host.code}/replay`)).status, 404, 'no replay while live');
const ms0 = await H.waitFor('match_start', 10000);
assert.equal(ms0.m, 0);

// guest cannot buy more than they have; host buys a goal-shrinker mid-match (blue coins >= 30 from the minigame)
H.send({ t: 'power', id: 'smallgoal', req: 1 });
const pr = await H.waitFor('power_result', 5000, (m) => m.req === 1);
assert.ok(pr.ok, JSON.stringify(pr)); assert.ok(pr.balance <= res.coins[0] + 5 - 30 + 5);
G.send({ t: 'power', id: 'mud', x: 3, z: 3, req: 2 });
const gp = await G.waitFor('power_result', 5000, (m) => m.req === 2);
assert.ok(gp.ok || /Not enough/.test(gp.error), JSON.stringify(gp));
const fxFrame = await H.waitFor('f', 5000, (m) => m.fx && Math.abs(m.fx.gw[0] - 5 * 0.64) < 0.01);
assert.ok(fxFrame, 'the shrunken blue goal shows up in the frame stream');
// spectator joins late and gets a snapshot with the frames so far
await sleep(900);
const S = new Client(host.code, 'bogus', 'spec'); await S.opened;
const snap = await S.waitFor('snapshot', 5000);
const histFrames = snap.matches.reduce((n, m) => n + m.frames.length, 0);
assert.ok(snap.matches.length >= 1 && histFrames > 5, 'late joiner receives history');
S.send({ t: 'power', id: 'speed', cube: 0, req: 9 }); await sleep(300);
assert.ok(!S.msgs.some((m) => m.t === 'power_result'), 'spectators cannot buy');
console.log('live series running: late joiner snapshot frames =', histFrames);

const end = await H.waitFor('series_end', 60000);
assert.ok(end.winner >= -1);
await sleep(300);
st = await get(`/api/rooms/${host.code}/state?token=${host.token}`);
assert.equal(st.phase, 'done'); assert.ok(st.result && st.result.matches.length >= 1);
const rep = await (await fetch(`${base}/api/rooms/${host.code}/replay`)).json();
assert.ok(rep.matches[0].frames.length > 50 && rep.matches[0].fx.length >= 1 && rep.matches[0].events.some((e) => e.type === 'power'));
const framesSeen = H.msgs.filter((m) => m.t === 'f' && m.m === 0).length;
assert.equal(rep.matches[0].frames.length, framesSeen + 1, 'client saw every frame the replay contains');

// ---- rematch ----
assert.equal((await post(`/api/rooms/${host.code}/rematch`, { token: guest.token })).status, 403);
assert.equal((await post(`/api/rooms/${host.code}/rematch`, { token: host.token })).status, 200);
st = await get(`/api/rooms/${host.code}/state?token=${host.token}`);
assert.equal(st.phase, 'lobby'); assert.equal(st.coins, 0);
await H.waitFor('rematch');
console.log('WS flow OK');
done(0);
