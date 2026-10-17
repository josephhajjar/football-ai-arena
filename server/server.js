// Football AI Arena server. Zero runtime dependencies (Node 18+).
//   node server/server.js          -> http://localhost:3000
//   PORT=8080 node server/server.js
//
// Flow: create room -> friend joins with code -> host starts the training timer (minigames pop up
// while the AIs train and pay coins) -> both upload weights files ("lock in" ends the wait early) ->
// the SERVER runs the series LIVE (so nobody's machine decides the result) and streams it over a
// WebSocket; the humans spend coins on power-ups/hazards while it plays. Finished series can be replayed.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateWeights, policiesFromWeights } from '../src/policy.js';
import { idleBot } from '../src/bots.js';
import { CONFIG as C, POWERS, ECONOMY } from '../src/config.js';
import { buildRules } from '../tools/gen_rules.js';
import { attachWebSocket } from './ws.js';
import { LiveSeries } from './live.js';
import { GAMES, MiniSession } from './minigames.js';
import { coinsForScore, clickerCap, MAX_CLICKER_COINS } from '../src/clicker.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const FAST = !!process.env.FB_TEST_FAST;   // test mode: seconds instead of minutes, tiny matches (never set in real use)
const GRACE_SECONDS = 60;           // extra time to finish uploading after the timer hits zero
const COUNTDOWN_MS = FAST ? 1500 : 12000;   // pause before kickoff of the first match
const GAP_SECONDS = FAST ? 0.5 : 6;         // pause between matches of a series
const TIME_SCALE = FAST ? 0.05 : 1;         // scales minigame scheduling
const LIVE_OPTS = FAST ? { matchOpts: { matchSeconds: 6, overtimeSeconds: 0, goalsToWin: 2 }, maxMatches: 2, winsNeeded: 2 } : {};
const MAX_BODY = 8 * 1024 * 1024;

const rooms = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
};

// ---------- helpers ----------
const now = () => Date.now();
const rid = (n) => crypto.randomBytes(n).toString('hex');
function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    let c = ''; for (let i = 0; i < 4; i++) c += A[crypto.randomInt(A.length)];
    if (!rooms.has(c)) return c;
  }
}
const cleanName = (s, d) => (String(s || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 20) || d);

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > MAX_BODY) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}

// ---------- room logic ----------
function sideOf(room, token) {
  if (!token) return null;
  if (room.blue && room.blue.token === token) return 'blue';
  if (room.red && room.red.token === token) return 'red';
  return null;
}

function netSummary(w) {
  return w.agents.map((n) => n.layers[0].w[0].length + '-' + n.layers.map((l) => l.w.length).join('-')).join(' | ');
}

const sendRoom = (room, msg, droppable = false) => { for (const c of room.conns) c.send(msg, droppable); };
const connectedSides = (room) => { const s = new Set(); for (const c of room.conns) if (c.data.side) s.add(c.data.side); return s; };

function defaultSettings() {
  return { minigames: { enabled: true, intervalMin: 4, firstAtMin: 2, games: Object.keys(GAMES), bestOf: 3, coinMult: 1 } };
}
// Validate host settings from the browser into safe values.
function cleanSettings(inp, cur) {
  const out = JSON.parse(JSON.stringify(cur)), m = (inp && inp.minigames) || {}, o = out.minigames;
  const num = (v, lo, hi, d) => { const x = Number(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d; };
  if ('enabled' in m) o.enabled = !!m.enabled;
  if ('intervalMin' in m) o.intervalMin = num(m.intervalMin, 0.5, 30, o.intervalMin);
  if ('firstAtMin' in m) o.firstAtMin = num(m.firstAtMin, 0.25, 30, o.firstAtMin);
  if ('bestOf' in m) o.bestOf = [1, 3, 5].includes(Number(m.bestOf)) ? Number(m.bestOf) : o.bestOf;
  if ('coinMult' in m) o.coinMult = num(m.coinMult, 0.25, 5, o.coinMult);
  if (Array.isArray(m.games)) { const g = m.games.filter((id) => Object.hasOwn(GAMES, id)); if (g.length) o.games = [...new Set(g)]; }
  return out;
}

function publicState(room, token) {
  const me = sideOf(room, token);
  if (me) room[me].lastSeen = now();
  const online = connectedSides(room);
  const side = (s) => {
    const p = room[s];
    return p ? { name: p.name, joined: true, online: online.has(s) || now() - (p.lastSeen || 0) < 6000, uploaded: !!p.weights, locked: !!p.locked, summary: me === s && p.weights ? p.summary : undefined } : { joined: false };
  };
  const st = {
    code: room.code, phase: room.phase, me, serverNow: now(),
    blue: side('blue'), red: side('red'),
    trainMinutes: room.trainMinutes, trainStartAt: room.trainStartAt, trainEndAt: room.trainEndAt,
    uploadDeadline: room.trainEndAt ? room.trainEndAt + GRACE_SECONDS * 1000 : null,
    rules: { matchSeconds: C.MATCH_SECONDS, goalsToWin: C.GOALS_TO_WIN, winsNeeded: C.SERIES_WINS_NEEDED, maxMatches: C.SERIES_MAX_MATCHES },
    settings: room.settings, coins: me ? room.coins[me === 'blue' ? 0 : 1] : null,
    nextMiniAt: room.phase === 'training' && room.settings.minigames.enabled && !room.mg ? room.nextMgAt : null,
    mini: room.mg ? { id: room.mg.gameId, phase: room.mg.phase } : null,
    powers: POWERS, economy: ECONOMY,
    games: Object.entries(GAMES).map(([id, g]) => ({ id, name: g.name, icon: g.icon, blurb: g.blurb })),
  };
  if (room.result) st.result = room.result.public;
  if (room.error) st.error = room.error;
  return st;
}

function startTraining(room, minutes) {
  room.trainMinutes = minutes;
  room.trainStartAt = now();
  room.trainEndAt = room.trainStartAt + minutes * 60000;
  room.nextMgAt = room.trainStartAt + room.settings.minigames.firstAtMin * 60000 * TIME_SCALE;
  room.mgQueue = []; room.clickGranted = [0, 0];
  room.phase = 'training';
}

function runRoom(room) {
  if (room.phase !== 'training') return;
  try { startLive(room); } catch (e) { liveFailed(room, e); }
}

function liveFailed(room, e) {
  console.error(`[${room.code}] live series failed:`, e);
  if (room.live) room.live.stop();
  room.live = null; room.phase = 'lobby'; room.trainEndAt = room.trainStartAt = null; room.result = null;
  for (const s of ['blue', 'red']) if (room[s]) { room[s].locked = false; room[s].weights = null; }
  room.error = 'The match crashed on the server. Please start a new training round.';
  sendRoom(room, { t: 'series_error', error: room.error });
}

function startLive(room) {
  if (room.mg) { room.mg.cancel(); room.mg = null; }
  const mk = (p) => (p && p.weights ? policiesFromWeights(p.weights) : [idleBot, idleBot]);
  const blue = mk(room.blue), red = mk(room.red);          // policies are stateless: shared by every match
  const noUpload = { blue: !room.blue.weights, red: !room.red.weights };
  room.live = new LiveSeries({
    names: { blue: room.blue.name, red: room.red.name }, teamsFor: () => ({ blue, red }), coins: room.coins,
    broadcast: (m, d) => sendRoom(room, m, d), seedBase: crypto.randomInt(1, 2 ** 30), countdownMs: COUNTDOWN_MS, gapSeconds: GAP_SECONDS, ...LIVE_OPTS,
    onFinish: (r) => {
      const id = rid(4);
      room.result = { id, gz: r.gz, public: { ...r.pub, id, noUpload } };
      room.coins = r.coins; room.live = null; room.phase = 'done';
      console.log(`[${room.code}] series finished ${r.pub.wins.join('-')} (${r.pub.matches.length} matches), replay ${Math.round(r.gz.length / 1024)} KB`);
    },
    onError: (e) => liveFailed(room, e),
  });
  room.phase = 'playing';
  room.live.start();
}

function startMini(room) {
  const cfg = room.settings.minigames;
  if (!room.mgQueue.length) {
    room.mgQueue = cfg.games.filter((id) => Object.hasOwn(GAMES, id)).sort(() => Math.random() - 0.5);
    if (room.lastMini && room.mgQueue.length > 1 && room.mgQueue[room.mgQueue.length - 1] === room.lastMini) room.mgQueue.reverse();
  }
  const gameId = room.mgQueue.pop(); room.lastMini = gameId;
  room.mg = new MiniSession({
    gameId, bestOf: cfg.bestOf, coinMult: cfg.coinMult, send: (m) => sendRoom(room, m),
    onResult: (res) => {
      if (!res) return;
      room.coins[0] += res.coins[0]; room.coins[1] += res.coins[1];
      sendRoom(room, { t: 'coins', c: room.coins, gain: res.coins });
    },
  });
}

// slow loop: training deadline, minigame scheduling, room cleanup
setInterval(() => {
  const t = now();
  for (const [code, room] of rooms) {
    if (room.phase === 'training') {
      if (t > room.trainEndAt + GRACE_SECONDS * 1000) runRoom(room);
      else if (room.settings.minigames.enabled && !room.mg && t >= room.nextMgAt && room.trainEndAt - t > 100000 * TIME_SCALE) {
        const sides = connectedSides(room);
        if (sides.has('blue') && sides.has('red')) startMini(room);
      }
    }
    if (t - room.createdAt > 6 * 3600 * 1000) { if (room.live) room.live.stop(); rooms.delete(code); }
  }
}, 500);

// fast loop: minigame physics (~30 Hz)
setInterval(() => {
  for (const room of rooms.values()) {
    const mg = room.mg;
    if (!mg) continue;
    try { mg.tick(); } catch (e) { console.error('minigame error', e); mg.cancel(); }
    if (mg.closed) { room.mg = null; room.nextMgAt = now() + room.settings.minigames.intervalMin * 60000 * TIME_SCALE; }
  }
}, 8);

// ---------- API ----------
async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1);   // after "api"
  const method = req.method;

  if (parts[0] === 'rooms' && parts.length === 1 && method === 'POST') {
    const b = await readBody(req);
    if (rooms.size >= 200) return json(res, 503, { error: 'Server is full, try again later.' });
    const code = newCode(), token = rid(12);
    rooms.set(code, { code, createdAt: now(), phase: 'lobby', blue: { name: cleanName(b.name, 'Blue'), token }, red: null,
      settings: defaultSettings(), coins: [0, 0], clickGranted: [0, 0], conns: new Set(), mg: null, mgQueue: [], nextMgAt: 0, live: null });
    return json(res, 200, { code, token, side: 'blue' });
  }

  const room = rooms.get(String(parts[1] || '').toUpperCase());
  if (parts[0] !== 'rooms' || !room) return json(res, 404, { error: 'Room not found. Check the code.' });
  const action = parts[2] || 'state';

  if (method === 'GET' && action === 'state') return json(res, 200, publicState(room, url.searchParams.get('token')));
  if (method === 'GET' && action === 'replay') {
    if (!room.result) return json(res, 404, { error: 'no replay yet (the series is still being played)' });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Cache-Control': 'public, max-age=3600', ETag: room.result.id });
    return res.end(room.result.gz);
  }
  if (method !== 'POST') return json(res, 405, { error: 'method not allowed' });
  const b = await readBody(req);

  if (action === 'join') {
    const mine = sideOf(room, b.token);
    if (mine) return json(res, 200, { code: room.code, token: b.token, side: mine });   // reconnect, never a second seat
    if (room.red) return json(res, 409, { error: 'Room is full (you can still watch it as a spectator).' });
    if (room.phase !== 'lobby') return json(res, 409, { error: 'Room already started.' });
    room.red = { name: cleanName(b.name, 'Red'), token: rid(12) };
    return json(res, 200, { code: room.code, token: room.red.token, side: 'red' });
  }

  const me = sideOf(room, b.token);
  if (!me) return json(res, 403, { error: 'Not a player in this room.' });

  if (action === 'start') {
    if (me !== 'blue') return json(res, 403, { error: 'Only the room creator can start.' });
    if (!room.red) return json(res, 409, { error: 'Waiting for your opponent to join.' });
    if (room.phase !== 'lobby') return json(res, 409, { error: 'Already started.' });
    room.error = null;
    if (b.settings) room.settings = cleanSettings(b.settings, room.settings);
    const minutes = Math.max(0.5, Math.min(120, Number(b.minutes) || 10));
    startTraining(room, minutes);
    return json(res, 200, publicState(room, b.token));
  }

  if (action === 'settings') {
    if (me !== 'blue') return json(res, 403, { error: 'Only the room creator can change settings.' });
    if (room.phase !== 'lobby') return json(res, 409, { error: 'Settings are locked once training has started.' });
    room.settings = cleanSettings(b.settings, room.settings);
    return json(res, 200, publicState(room, b.token));
  }

  if (action === 'upload') {
    if (room.phase !== 'training') return json(res, 409, { error: room.phase === 'lobby' ? 'Training has not started yet.' : 'Too late, the match already started.' });
    if (now() > room.trainEndAt + GRACE_SECONDS * 1000) return json(res, 409, { error: 'Upload window closed.' });
    const p = room[me];
    if (b.weights !== undefined) {
      const v = validateWeights(b.weights);
      if (!v.ok) return json(res, 422, { error: 'Weights file rejected', details: v.errors });
      p.weights = b.weights; p.summary = netSummary(b.weights); p.uploadedAt = now();
      p.locked = false;   // a fresh file must be locked in again on purpose
    }
    if (b.lock !== undefined) {
      if (b.lock && !p.weights) return json(res, 422, { error: 'Upload a weights file before locking in.' });
      p.locked = !!b.lock;
    }
    if (room.blue.locked && room.red && room.red.locked) runRoom(room);
    return json(res, 200, publicState(room, b.token));
  }

  if (action === 'rematch') {
    if (me !== 'blue') return json(res, 403, { error: 'Only the room creator can start a rematch.' });
    if (room.phase !== 'done') return json(res, 409, { error: 'The series is not finished yet.' });
    for (const s of ['blue', 'red']) { room[s].weights = null; room[s].locked = false; room[s].summary = null; }
    room.result = null; room.phase = 'lobby'; room.trainStartAt = room.trainEndAt = null; room.coins = [0, 0]; room.clickGranted = [0, 0]; room.mg = null;
    sendRoom(room, { t: 'rematch' });
    return json(res, 200, publicState(room, b.token));
  }

  return json(res, 404, { error: 'unknown action' });
}

// ---------- kit zip (store-only zip writer, no dependencies) ----------
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function makeZip(files) {   // files: [{name, data: Buffer}]
  const locals = [], centrals = []; let offset = 0;
  const d = new Date();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = Buffer.from(f.name), crc = crc32(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(f.data.length, 18); lh.writeUInt32LE(f.data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, name, f.data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(dosTime, 12); ch.writeUInt16LE(dosDate, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(f.data.length, 20); ch.writeUInt32LE(f.data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + f.data.length;
  }
  const cdSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function kitFiles() {
  const out = [];
  const add = (rel, dir = 'football-ai-kit') => out.push({ name: `${dir}/${rel.replace(/\\/g, '/')}`, data: fs.readFileSync(path.join(ROOT, rel)) });
  for (const f of ['src/config.js', 'src/rng.js', 'src/sim.js', 'src/policy.js', 'src/bots.js', 'src/match.js',
    'training/bridge.js', 'training/football_env.py', 'training/export_weights.py', 'training/example_train_es.py',
    'tools/validate.js', 'tools/play.js']) add(f);
  out.push({ name: 'football-ai-kit/package.json', data: Buffer.from('{ "name": "football-ai-kit", "private": true, "type": "module" }\n') });
  out.push({ name: 'football-ai-kit/RULES.md', data: Buffer.from(buildRules()) });
  return out;
}

// ---------- static files ----------
function serveFile(res, file, req) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname);
    if (p.startsWith('/api/')) return await api(req, res, url);
    if (p === '/RULES.md') { res.writeHead(200, { 'Content-Type': MIME['.md'], 'Content-Disposition': 'inline; filename="RULES.md"' }); return res.end(buildRules()); }
    if (p === '/kit.zip') {
      const zip = makeZip(kitFiles());
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="football-ai-kit.zip"', 'Content-Length': zip.length });
      return res.end(zip);
    }
    let rel = p === '/' ? '/index.html' : p;
    let base = path.join(ROOT, 'web');
    if (rel.startsWith('/src/')) { base = path.join(ROOT, 'src'); rel = rel.slice(4); }   // browser reuses the exact same sim modules
    const file = path.normalize(path.join(base, rel));
    if (!file.startsWith(base + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
    serveFile(res, file, req);
  } catch (e) {
    if (!res.headersSent) json(res, 400, { error: String(e.message || e) });
    else res.end();
  }
});

// ---------- WebSocket: minigames, live match frames, purchases ----------
attachWebSocket(server, (conn) => {
  conn.data = { room: null, side: null };
  conn.on('message', (str) => {
    let m; try { m = JSON.parse(str); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'ping') return conn.send({ t: 'pong', c: m.c, serverNow: now() });
    if (!conn.data.room) {
      if (m.t !== 'hello') return;
      const room = rooms.get(String(m.code || '').toUpperCase());
      if (!room) return conn.send({ t: 'error', error: 'Room not found' });
      conn.data.room = room; conn.data.side = sideOf(room, m.token);
      room.conns.add(conn); conn.on('close', () => room.conns.delete(conn));
      conn.send({ t: 'welcome', side: conn.data.side, serverNow: now(), phase: room.phase, coins: room.coins });
      if (room.live) conn.send(room.live.snapshot());
      if (room.mg) for (const x of room.mg.resync()) conn.send(x);
      return;
    }
    const { room, side } = conn.data, idx = side === 'blue' ? 0 : side === 'red' ? 1 : -1;
    if (idx < 0) return;                                  // spectators are read-only
    if (m.t === 'mg_join' && room.mg) room.mg.join(idx);
    else if (m.t === 'mg_decline' && room.mg) room.mg.decline(idx);
    else if (m.t === 'mg_input' && room.mg) room.mg.input(idx, m.i);
    else if (m.t === 'clicker' && room.phase === 'training') {
      // Cube Clicker payout: coins for trophies reached, never more than the time cap allows
      const t = now(); if (t - (conn.data.lastClick || 0) < 700) return; conn.data.lastClick = t;
      const score = Number(m.score); if (!Number.isFinite(score) || score < 0) return;
      const target = Math.min(coinsForScore(score), clickerCap((t - room.trainStartAt) / 60000), MAX_CLICKER_COINS), delta = target - room.clickGranted[idx];
      if (delta > 0) {
        room.clickGranted[idx] = target; room.coins[idx] += delta;
        const gain = [0, 0]; gain[idx] = delta;
        sendRoom(room, { t: 'coins', c: room.coins, gain, src: 'clicker' });
      }
    }
    else if (m.t === 'power' && room.live) {
      const r = room.live.command(side, m);
      conn.send({ t: 'power_result', req: m.req, ...r });
    }
  });
});

process.on('uncaughtException', (e) => console.error('uncaught:', e));
process.on('unhandledRejection', (e) => console.error('unhandled:', e));

server.listen(PORT, HOST, () => {
  console.log(`Football AI Arena running:  http://localhost:${PORT}`);
  console.log('Friend on same network:      http://<your-LAN-IP>:' + PORT);
  console.log('Over the internet: run a tunnel, e.g.  cloudflared tunnel --url http://localhost:' + PORT);
});
