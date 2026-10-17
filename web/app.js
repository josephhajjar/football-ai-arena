import { Viewer, CAMERAS } from '/viewer.js';
import { validateWeights, policiesFromWeights } from '/src/policy.js';
import { runSeries } from '/src/match.js';
import { makeBot } from '/src/bots.js';
import { makeRng } from '/src/rng.js';
import { CONFIG as C, POWERS } from '/src/config.js';
import { Net } from '/net.js';
import { MiniUI } from '/minigames.js';
import { sfx } from '/audio.js';
import { Clicker } from '/clicker.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

let session = null;        // { code, token|null, side }
let state = null;          // last room state (HTTP)
let serverOffset = 0;      // serverNow - clientNow (ms), from HTTP polling (WebSocket gives a better one)
let pollTimer = null, sigPrev = '';
let viewer = null;
let playback = { mode: 'none', t: 0, paused: false, speed: 1 };   // mode: live | local
let live = null;           // series object being filled by the WebSocket stream
let coins = 0;
const net = new Net();
const offset = () => (net.alive ? net.offset : serverOffset);
const mySide = () => (state && state.me === 'blue' ? 0 : state && state.me === 'red' ? 1 : null);

function notice(msg, kind = 'err') {
  const n = $('notice'); if (!msg) { n.classList.add('hidden'); return; }
  n.textContent = msg; n.className = kind === 'info' ? 'info' : '';
}
async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  let j = {}; try { j = await r.json(); } catch { /* ignore */ }
  if (!r.ok) { const e = new Error(j.error || `Request failed (${r.status})`); e.details = j.details; throw e; }
  return j;
}

// ---------------- home ----------------
$('inName').value = store.get('fb.name') || '';
$('btnCreate').onclick = async () => {
  try {
    const name = $('inName').value.trim() || 'Blue'; store.set('fb.name', name);
    const r = await api('/api/rooms', { name });
    enterRoom({ code: r.code, token: r.token, side: 'blue' });
  } catch (e) { notice(e.message); }
};
$('btnJoin').onclick = async () => {
  try {
    const code = $('inCode').value.trim().toUpperCase(); if (code.length !== 4) return notice('Enter the 4-letter room code.');
    const name = $('inName').value.trim() || 'Red'; store.set('fb.name', name);
    const saved = JSON.parse(store.get('fb.room.' + code) || 'null');
    const r = await api(`/api/rooms/${code}/join`, { name, token: saved && saved.token });
    enterRoom({ code, token: r.token, side: r.side });
  } catch (e) { notice(e.message); }
};
$('btnWatch').onclick = () => {
  const code = $('inCode').value.trim().toUpperCase(); if (code.length !== 4) return notice('Enter the 4-letter room code.');
  enterRoom({ code, token: null, side: null });
};
$('btnCopyRules').onclick = async () => {
  try { const t = await (await fetch('/RULES.md')).text(); await navigator.clipboard.writeText(t); notice('Rules copied. Paste them into your AI assistant.', 'info'); }
  catch { window.open('/RULES.md', '_blank'); }
};
$('pracOppKind').onchange = () => $('pracRedWrap').classList.toggle('hidden', $('pracOppKind').value !== 'file');

const readJson = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => { try { res(JSON.parse(r.result)); } catch { rej(new Error(`${file.name} is not valid JSON`)); } }; r.onerror = () => rej(new Error('cannot read file')); r.readAsText(file); });

$('btnPractice').onclick = async () => {
  const msg = $('pracMsg'); msg.textContent = ''; msg.className = 'hint';
  try {
    const fb = $('pracBlue').files[0]; if (!fb) throw new Error('Choose your (blue) weights file first.');
    const wb = await readJson(fb); let v = validateWeights(wb);
    if (!v.ok) throw new Error('Blue file invalid:\n' + v.errors.join('\n'));
    const kind = $('pracOppKind').value, rng = makeRng(Date.now() & 0xffff);
    let mkRed;
    if (kind === 'file') {
      const fr = $('pracRed').files[0]; if (!fr) throw new Error('Choose the red weights file.');
      const wr = await readJson(fr); v = validateWeights(wr); if (!v.ok) throw new Error('Red file invalid:\n' + v.errors.join('\n'));
      mkRed = () => policiesFromWeights(wr);
    } else mkRed = () => makeBot(kind, rng);
    msg.textContent = 'Simulating…'; await new Promise((r) => setTimeout(r, 30));
    const res = runSeries(() => ({ blue: policiesFromWeights(wb), red: mkRed() }), Math.floor(Math.random() * 1e6));
    startLocal({ version: 1, names: { blue: 'You', red: kind === 'file' ? 'Opponent' : 'Bot ' + kind }, gap: 6, ...res });
  } catch (e) { msg.textContent = e.message; msg.className = 'hint bad'; }
};
$('replayFile').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { const j = await readJson(f); if (!j.matches) throw new Error('Not a replay file'); startLocal(j); } catch (err) { $('pracMsg').textContent = err.message; $('pracMsg').className = 'hint bad'; }
};

// ---------------- stage (3D viewer + HUD) ----------------
const names = () => (viewer && viewer.series && viewer.series.names) || { blue: 'Blue', red: 'Red' };

function ensureViewer() {
  if (viewer) return viewer;
  viewer = new Viewer($('canvasWrap'));
  const cams = $('cams');
  CAMERAS.forEach((c) => {
    const b = document.createElement('button'); b.dataset.id = c.id; b.innerHTML = `<kbd>${c.key}</kbd>${c.label}`;
    b.onclick = () => viewer.setCamera(c.id); cams.appendChild(b);
  });
  const mute = document.createElement('button'); mute.id = 'btnMute'; mute.textContent = sfx.muted ? '🔇' : '🔊';
  mute.onclick = () => { sfx.setMuted(!sfx.muted); mute.textContent = sfx.muted ? '🔇' : '🔊'; }; cams.appendChild(mute);
  viewer.onCamera = (id, pc) => {
    cams.querySelectorAll('button[data-id]').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
    const pb = cams.querySelector('[data-id=player]'); pb.innerHTML = `<kbd>6</kbd>Cube cam${id === 'player' ? ' (' + ['B1', 'B2', 'R1', 'R2'][pc] + ')' : ''}`;
  };
  viewer.setCamera('broadcast');
  viewer.getTime = currentTime;
  viewer.onHud = updateHud;
  viewer.onEvent = onGameEvent;
  buildShop();
  window.addEventListener('keydown', (e) => {
    if ($('stage').classList.contains('hidden') || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'Escape') { stopTargeting(); hideChooser(); return; }
    const cam = CAMERAS.find((c) => c.key === e.key); if (cam) viewer.setCamera(cam.id);
    if (e.code === 'Space' && playback.mode === 'local') { e.preventDefault(); togglePause(); }
    const hi = HOT.indexOf(e.key.toLowerCase()); if (hi >= 0 && shopActive() && !e.ctrlKey && !e.metaKey) buy(Object.keys(POWERS)[hi]);
    if (chooser && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'x')) pickCube(e.key.toLowerCase() === 'z' ? 0 : 1);
  });
  viewer.renderer.domElement.addEventListener('pointerdown', onPick);
  return viewer;
}

const LIVE_DELAY = 0.22;
let lastTick = performance.now();
function currentTime() {
  const now = performance.now(), dt = (now - lastTick) / 1000; lastTick = now;
  if (playback.mode === 'live' && live) playback.t = (Date.now() + offset() - live.t0) / 1000 - LIVE_DELAY;
  else if (playback.mode === 'local' && !playback.paused) {
    const total = viewer.series ? viewer.series.total : 0;
    playback.t = Math.min(playback.t + dt * playback.speed, total + 0.01);
  }
  return playback.t;
}

const fmtClock = (s, ot) => { s = Math.max(0, s); return `${ot ? 'OT ' : ''}${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
let lastHudSig = '', lastBombTick = 0, shopT = 0;
function updateHud(h) {
  const nm = names();
  const need = (state && state.rules.winsNeeded) || 2;
  let banner = '', cls = 'neutral', sub = '';
  if (h.countdown > 0) { banner = Math.ceil(h.countdown) + ''; sub = 'Kickoff!'; }
  else if (h.seriesOver) {
    const w = viewer.series.winner;
    banner = w < 0 ? 'DRAW' : `${w === 0 ? nm.blue : nm.red} WINS`; cls = w === 0 ? 'blue' : w === 1 ? 'red' : 'neutral';
    sub = `Series ${viewer.series.wins[0]} – ${viewer.series.wins[1]}`;
  } else if (h.matchOver) {
    const m = h.matchResult;
    banner = m.winner < 0 ? 'DRAW' : `${m.winner === 0 ? nm.blue : nm.red} wins match ${h.matchIndex + 1}`; cls = m.winner === 0 ? 'blue' : m.winner === 1 ? 'red' : 'neutral';
    sub = `${m.score[0]} – ${m.score[1]}`; if (banner.length > 22) banner = banner.slice(0, 22);
  } else if (h.goal >= 0) { banner = 'GOAL!'; cls = h.goal === 0 ? 'blue' : 'red'; sub = h.goal === 0 ? nm.blue : nm.red; }
  const sig = [h.score, h.matchIndex, banner, sub, Math.floor(h.clock), h.overtime, h.winsSoFar, nm.blue, nm.red].join('|');
  if (sig !== lastHudSig) {
    lastHudSig = sig;
    $('nameBlue').textContent = nm.blue; $('nameRed').textContent = nm.red;
    $('scoreBlue').textContent = h.score[0]; $('scoreRed').textContent = h.score[1];
    $('clock').textContent = fmtClock(h.clock, h.overtime);
    $('matchInfo').textContent = `Match ${h.matchIndex + 1} · series ${h.winsSoFar[0]}–${h.winsSoFar[1]} (first to ${need})`;
    const b = $('banner'); b.className = cls; b.innerHTML = banner ? `${esc(banner)}<small>${esc(sub)}</small>` : '';
  }
  if (playback.mode === 'local') {
    const seek = $('pbSeek'); if (document.activeElement !== seek) seek.value = String(Math.round(Math.max(0, playback.t) / Math.max(1, h.total) * 1000));
  }
  // ticking bombs
  const now = performance.now();
  if (h.fx.bombs.length && now - lastBombTick > 230) { lastBombTick = now; const f = Math.min(...h.fx.bombs.map((b) => b[2])); sfx.tick(1 - Math.min(1, f / C.BOMB_FUSE)); }
  if (now - shopT > 150) { shopT = now; refreshShop(); }
}

function showStage(on) {
  $('stage').classList.toggle('hidden', !on);
  if (on) { ensureViewer(); viewer.resize(); }
  if (viewer) viewer.active = on;
  refreshShop();
}
function togglePause() { playback.paused = !playback.paused; $('pbPlay').textContent = playback.paused ? '▶' : '⏸'; }

function startLocal(series, fromLive = false) {
  stopTargeting(); hideChooser();
  series.finished = true; series.live = false;
  ensureViewer(); viewer.setSeries(series); showStage(true);
  playback = { mode: 'local', t: fromLive ? 0 : -1, paused: false, speed: 1 };
  lastHudSig = '';
  $('playback').classList.remove('hidden'); $('pbPlay').textContent = '⏸'; $('pbSpeed').value = '1';
  $('btnLeave').textContent = '✕ Close'; refreshShop();
}
$('pbPlay').onclick = togglePause;
$('pbRestart').onclick = () => { playback.t = -1; playback.paused = false; $('pbPlay').textContent = '⏸'; };
$('pbSpeed').onchange = (e) => { playback.speed = Number(e.target.value); };
$('pbSeek').oninput = (e) => { if (viewer.series) playback.t = Number(e.target.value) / 1000 * viewer.series.total; };
$('pbNext').onclick = () => {
  const { i } = viewer.locate(playback.t); const ms = viewer.series.matches;
  playback.t = ms[Math.min(ms.length - 1, i + 1)].startOffset;
};
$('btnLeave').onclick = () => { showStage(false); $('playback').classList.add('hidden'); if (playback.mode === 'local') playback.mode = 'none'; stopTargeting(); hideChooser(); };

// ---------------- game events: sound + feed ----------------
function toast(html, cls = '') {
  const feed = $('feed'), d = document.createElement('div'); d.className = 'toast ' + cls; d.innerHTML = html; feed.appendChild(d);
  while (feed.children.length > 4) feed.firstChild.remove();
  setTimeout(() => d.classList.add('out'), 3200); setTimeout(() => d.remove(), 3800);
}
function onGameEvent(e) {
  const nm = names();
  if (e.type === 'kick') sfx.kick(e.v || 20);
  else if (e.type === 'goal') { sfx.goal(); }
  else if (e.type === 'explode') sfx.explode();
  else if (e.type === 'power') {
    const p = POWERS[e.id]; if (!p) return;
    const who = e.team === 0 ? nm.blue : nm.red;
    toast(`${p.icon} <b class="${e.team === 0 ? 'b' : 'r'}">${esc(who)}</b> used <b>${esc(p.name)}</b>`, p.kind);
    sfx.power(p.kind);
  }
}

// ---------------- shop (power-ups & hazards) ----------------
const HOT = ['q', 'w', 'e', 'r', 't', 'a', 's', 'd', 'f'];
const cool = {}; let globalCool = 0, reqN = 0, targeting = null, chooser = null;
function shopActive() { return !!(live && playback.mode === 'live' && mySide() != null && live.state === 'playing' && !$('stage').classList.contains('hidden')); }
function buildShop() {
  const box = $('shop'); box.innerHTML = '';
  Object.entries(POWERS).forEach(([id, p], i) => {
    const b = document.createElement('button'); b.className = 'item ' + p.kind; b.dataset.id = id; b.title = `${p.name}: ${p.desc}`;
    b.innerHTML = `<span class="ic">${p.icon}</span><span class="nm">${esc(p.name)}</span><span class="co">${p.cost} 🪙</span><kbd>${HOT[i].toUpperCase()}</kbd><i class="cd"></i>`;
    b.onclick = () => buy(id); box.appendChild(b);
  });
}
function refreshShop() {
  const on = shopActive(), now = Date.now();
  $('shopWrap').classList.toggle('hidden', !on && !(live && mySide() != null && playback.mode === 'live'));
  $('coinChip').textContent = `🪙 ${coins}`;
  document.querySelectorAll('#shop .item').forEach((b) => {
    const id = b.dataset.id, p = POWERS[id], left = Math.max((cool[id] || 0) - now, globalCool - now, 0);
    b.disabled = !on || coins < p.cost || left > 0;
    b.classList.toggle('poor', coins < p.cost);
    b.querySelector('.cd').style.width = left > 0 ? Math.min(100, left / 30) + '%' : '0';
  });
}
function buy(id) {
  const p = POWERS[id]; if (!p) return;
  if (!shopActive()) return;
  if (coins < p.cost) { sfx.denied(); toast(`Not enough coins for ${esc(p.name)} (${p.cost} 🪙)`, 'err'); return; }
  if (Date.now() < globalCool || Date.now() < (cool[id] || 0)) { sfx.denied(); return; }
  hideChooser(); stopTargeting();
  if (p.target === 'none') sendPower(id, {});
  else if (p.target === 'point') startTargeting(id);
  else showChooser(id);
}
function sendPower(id, extra) { net.send({ t: 'power', id, req: ++reqN, ...extra }); }
function showChooser(id) {
  const p = POWERS[id], mine = mySide(), team = p.target === 'ownCube' ? mine : 1 - mine, col = team === 0 ? 'b' : 'r', pre = team === 0 ? 'B' : 'R';
  const box = $('chooser'); chooser = { id };
  box.innerHTML = `<div class="ct">${p.icon} ${esc(p.name)} — which cube?</div>
    <button data-c="0" class="${col}">${pre}1 <kbd>Z</kbd></button><button data-c="1" class="${col}">${pre}2 <kbd>X</kbd></button><button class="ghost" data-c="x">✕</button>`;
  box.classList.remove('hidden');
  box.querySelectorAll('button').forEach((b) => { b.onclick = () => { if (b.dataset.c === 'x') hideChooser(); else pickCube(Number(b.dataset.c)); }; });
}
function pickCube(c) { if (!chooser) return; const id = chooser.id; hideChooser(); sendPower(id, { cube: c }); }
function hideChooser() { chooser = null; $('chooser').classList.add('hidden'); }
function startTargeting(id) {
  const p = POWERS[id]; targeting = id;
  viewer.setPreview({ r: id === 'bomb' ? C.BOMB_RADIUS : C.MUD_RADIUS, color: id === 'bomb' ? 0xff4433 : 0x8b5a2b });
  $('targetHint').textContent = `${p.icon} Click the pitch to place ${p.name} — Esc to cancel`; $('targetHint').classList.remove('hidden');
  $('stage').classList.add('aiming');
}
function stopTargeting() { if (!targeting) return; targeting = null; if (viewer) viewer.setPreview(null); $('targetHint').classList.add('hidden'); $('stage').classList.remove('aiming'); }
function onPick(e) {
  if (!targeting) return;
  const pt = viewer.pickGround(e.clientX, e.clientY); if (!pt) return;
  const id = targeting; stopTargeting(); sendPower(id, { x: pt.x, z: pt.z });
}

// ---------------- WebSocket: live match + minigames ----------------
let mini = null, clicker = null, clickerKey = null;
function clickerEl() {                       // created on demand, so an old cached page can never break it
  let el = document.getElementById('clickerCard');
  if (!el) { el = document.createElement('section'); el.id = 'clickerCard'; el.className = 'card hidden'; const room = document.getElementById('room'); (room && room.parentNode ? room.parentNode : document.body).insertBefore(el, room ? room.nextSibling : null); }
  return el;
}
function syncClicker() {
  const card = clickerEl(), want = !!(state && state.phase === 'training' && state.me);
  if (!want) { if (clickerKey) { clicker.unmount(); clickerKey = null; } card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  const key = `fb.clicker.${state.code}.${state.trainStartAt}.${state.me}`;
  if (clickerKey === key) return;
  clicker = clicker || new Clicker(card, { report: (score) => net.send({ t: 'clicker', score }), toast });
  clicker.mount(key); clickerKey = key;
}
function setCoins(n, gain) {
  const was = coins; coins = n;
  for (const id of ['roomCoins', 'coinChip']) { const el = document.getElementById(id); if (el) { el.textContent = `🪙 ${coins}`; if (n !== was) { el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); } } }
  if (gain) toast(`+${gain} 🪙`, 'coin');
  refreshShop();
}
function wireNet() {
  mini = mini || new MiniUI({ net, getSide: mySide });
  for (const t of ['mg_invite', 'mg_joined', 'mg_start', 'mg', 'mg_result', 'mg_end']) net.on(t, (m) => mini.handle(m));
  net.on('welcome', (m) => { const si = m.side === 'blue' ? 0 : m.side === 'red' ? 1 : -1; if (si >= 0) setCoins(m.coins[si]); });
  net.on('_close', () => { if (session) notice('Connection lost, reconnecting…'); });
  net.on('_open', () => { notice(''); });
  net.on('coins', (m) => { const si = mySide(); if (si != null) { setCoins(m.c[si], m.gain ? m.gain[si] : 0); if (m.gain && m.gain[si]) sfx.coin(); } });
  net.on('series_error', (m) => { notice(m.error); live = null; showStage(false); playback.mode = 'none'; poll(); });
  net.on('rematch', () => { live = null; showStage(false); playback.mode = 'none'; setCoins(0); poll(); });

  const liveFrom = (m) => {
    live = { live: true, finished: false, names: m.names || (live && live.names) || { blue: 'Blue', red: 'Red' }, gap: m.gap, matches: [], wins: [0, 0], total: 1e9, t0: m.startAt, state: 'countdown' };
    return live;
  };
  net.on('series_start', (m) => {
    liveFrom(m); ensureViewer(); viewer.setSeries(live); playback = { mode: 'live', t: -10, paused: false, speed: 1 };
    $('playback').classList.add('hidden'); $('btnLeave').textContent = '✕ Back to room'; lastHudSig = ''; showStage(true);
    const si = mySide(); if (si != null) setCoins(m.coins[si]); sfx.whistle();
  });
  net.on('snapshot', (m) => {
    if (m.state === 'done') return;
    liveFrom(m); live.state = m.state; live.wins = m.wins; live.names = m.names;
    live.matches = m.matches.map((mm, i) => ({ ...mm, index: i }));
    ensureViewer(); viewer.setSeries(live); live.total = 1e9;
    playback = { mode: 'live', t: -10, paused: false, speed: 1 };
    $('playback').classList.add('hidden'); $('btnLeave').textContent = '✕ Back to room'; lastHudSig = ''; showStage(true);
    const si = mySide(); if (si != null) setCoins(m.coins[si]);
  });
  net.on('match_start', (m) => {
    if (!live) return;
    live.state = 'playing'; live.wins = m.wins;
    viewer.addMatch({ index: m.m, seed: m.seed, frames: [m.f], startOffset: m.startOffset, fps: 20, fx: m.fx ? [{ f: 0, s: m.fx }] : [], events: [] });
    const si = mySide(); if (si != null) setCoins(m.c[si]); sfx.whistle();
  });
  net.on('f', (m) => {
    if (!live || !viewer) return;
    viewer.appendFrame(m.m, m.k, m.f, m.ev, m.fx);
    const si = mySide(); if (si != null && m.c[si] !== coins) setCoins(m.c[si]);
  });
  net.on('match_end', (m) => {
    if (!live) return;
    const mm = live.matches[m.m]; if (mm) { mm.complete = true; mm.score = m.score; mm.winner = m.winner; mm.overtime = m.overtime; mm.seconds = m.seconds; mm.duration = mm.frames.length / mm.fps; }
    live.wins = m.wins; live.state = 'gap'; live.winner = m.seriesWinner;
    const si = mySide(); if (si != null) setCoins(m.coins[si]);
    if (m.over) { live.finished = true; live.state = 'done'; const last = live.matches[live.matches.length - 1]; live.total = last.startOffset + last.frames.length / last.fps; }
  });
  net.on('series_end', (m) => {
    if (!live) return;
    live.finished = true; live.winner = m.winner; live.wins = m.wins; live.state = 'done';
    const last = live.matches[live.matches.length - 1]; if (last) live.total = last.startOffset + last.frames.length / last.fps;
    poll();
  });
  net.on('power_result', (m) => {
    if (m.ok) { const p = POWERS[m.id]; cool[m.id] = Date.now() + 3000; globalCool = Date.now() + 1200; if (m.balance !== undefined) setCoins(m.balance); void p; }
    else { sfx.denied(); toast(esc(m.error || 'Cannot use that now'), 'err'); }
    refreshShop();
  });
}

// ---------------- room ----------------
function enterRoom(s) {
  session = s; notice(''); live = null; coins = 0;
  if (s.token) store.set('fb.room.' + s.code, JSON.stringify({ token: s.token, side: s.side }));
  store.set('fb.current', s.code);
  $('home').classList.add('hidden'); $('room').classList.remove('hidden');
  $('roomTag').classList.remove('hidden');
  $('roomTag').innerHTML = `<span class="code">${esc(s.code)}</span><button id="btnShare">Copy invite link</button><button id="btnExit" class="ghost">Leave</button>`;
  $('btnShare').onclick = () => { const u = `${location.origin}/#${s.code}`; navigator.clipboard.writeText(u).then(() => notice('Invite link copied. Your friend just opens it, types a name and presses Join.', 'info')); };
  $('btnExit').onclick = leaveRoom;
  location.hash = s.code; sigPrev = '';
  if (!wireNet.done) { wireNet(); wireNet.done = true; }
  net.connect(s.code, s.token);
  clearInterval(pollTimer); poll(); pollTimer = setInterval(poll, 900);
  requestAnimationFrame(tickTimers);
}
function leaveRoom() {
  store.del('fb.current'); document.title = 'Football AI Arena';
  clearInterval(pollTimer); net.close(); if (mini) mini.end(); if (clickerKey) { clicker.unmount(); clickerKey = null; } clickerEl().classList.add('hidden'); session = null; state = null; live = null; showStage(false); playback.mode = 'none';
  $('room').classList.add('hidden'); $('home').classList.remove('hidden'); $('roomTag').classList.add('hidden'); history.replaceState(null, '', location.pathname);
}

let polling = false;
async function poll() {
  if (!session || polling) return;
  polling = true;
  const t0 = Date.now();
  try {
    const st = await api(`/api/rooms/${session.code}/state?token=${session.token || ''}`);
    serverOffset = st.serverNow - (t0 + Date.now()) / 2;
    state = st; if (!net.alive) notice('');
    const { serverNow, ...rest } = st; void serverNow;
    if (rest.me === 'blue' && rest.phase === 'lobby') delete rest.settings;       // the host's own edits must not re-render the form under their fingers
    const sig = JSON.stringify(rest);
    if (sig !== sigPrev) { sigPrev = sig; renderRoom(); }
    syncClicker();
  } catch (e) { notice(e.message); if (/not found/i.test(e.message)) { store.del('fb.current'); leaveRoom(); } }
  polling = false;
}

const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function tickTimers() {
  if (!session) return;
  const el = document.getElementById('timer');
  if (state) {
    const nowS = Date.now() + offset();
    if (el && state.phase === 'training') {
      const left = state.trainEndAt - nowS;
      if (left > 0) { el.textContent = mmss(left); el.classList.toggle('low', left < 60000); document.title = `${mmss(left)} · Football AI Arena`; }
      else { el.textContent = '0:00'; el.classList.add('low'); document.title = '⏰ Upload now!'; const g = document.getElementById('grace'); if (g) g.textContent = `Time is up! Upload window closes in ${mmss(state.uploadDeadline - nowS)}`; }
      const nm = document.getElementById('nextMini');
      if (nm) nm.textContent = state.mini ? '🎮 Minigame in progress' : state.nextMiniAt ? (state.nextMiniAt > nowS ? `🎮 Next minigame in ${mmss(state.nextMiniAt - nowS)}` : '🎮 Minigame starting…') : '🎮 Minigames off';
    }
  }
  requestAnimationFrame(tickTimers);
}

function playerCard(side, p) {
  const label = side === 'blue' ? 'BLUE' : 'RED';
  let st = p.joined ? '' : 'Waiting to join…';
  if (p.joined && state.phase === 'training') st = p.locked ? '🔒 locked in' : p.uploaded ? '✅ weights uploaded' : '⏳ still training…';
  else if (p.joined) st = 'ready';
  const dot = p.joined ? `<span title="${p.online ? 'online' : 'not connected right now'}" style="color:${p.online ? '#4ade80' : '#6b7a99'}">●</span> ` : '';
  return `<div class="pl ${side}"><div class="nm">${dot}${esc(p.joined ? p.name : '—')} ${state.me === side ? '<span class="ok">(you)</span>' : ''}</div><div class="st">${label} · ${esc(st)}</div></div>`;
}

function minigameSettingsCard(s, host) {
  const m = s.settings.minigames, games = s.games || [];
  if (!host) {
    return `<div class="card"><h2>Minigames while training</h2><p class="hint">${m.enabled ? `Every ${m.intervalMin} min (first at ${m.firstAtMin} min) · best of ${m.bestOf} · coins ×${m.coinMult} · ${games.filter((g) => m.games.includes(g.id)).map((g) => g.icon + ' ' + esc(g.name)).join(', ')}` : 'Off'}. Winning earns 🪙 coins you spend on power-ups and hazards in the live match.</p></div>`;
  }
  return `<div class="card"><h2>Minigames while training <small>(earn 🪙 coins for the live match)</small></h2>
    <label class="inline"><input type="checkbox" id="mgOn" ${m.enabled ? 'checked' : ''}> Enabled</label>
    <div class="grid3" id="mgSettings">
      <label>Every (min) <input type="number" id="mgEvery" min="0.5" max="30" step="0.5" value="${m.intervalMin}"></label>
      <label>First one after (min) <input type="number" id="mgFirst" min="0.25" max="30" step="0.25" value="${m.firstAtMin}"></label>
      <label>Best of <select id="mgBest">${[1, 3, 5].map((n) => `<option ${n === m.bestOf ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>Coin payout <select id="mgMult">${[0.5, 1, 1.5, 2, 3].map((n) => `<option value="${n}" ${n === m.coinMult ? 'selected' : ''}>×${n}</option>`).join('')}</select></label>
    </div>
    <div class="games">${games.map((g) => `<label class="gchip" title="${esc(g.blurb)}"><input type="checkbox" class="mgGame" value="${esc(g.id)}" ${m.games.includes(g.id) ? 'checked' : ''}> ${g.icon} ${esc(g.name)}</label>`).join('')}</div>
    <p class="hint">A pop-up invites both of you at those times; accept to play a 1-minute duel while your AI trains.</p></div>`;
}

let upMsgHtml = '', typedMinutes = null, saveT = null;
function renderRoom() {
  const s = state, el = $('room'); if (!s) return;
  const mi = document.getElementById('inMinutes'); if (mi) typedMinutes = mi.value;
  if (s.error) notice(s.error);
  if (s.phase !== 'training') document.title = 'Football AI Arena';
  if (s.coins != null && s.coins !== coins && !live) setCoins(s.coins);
  const players = `<div class="players">${playerCard('blue', s.blue)}${playerCard('red', s.red)}</div>`;
  let body = '';
  if (s.phase === 'lobby') {
    const host = s.me === 'blue';
    body = `<div class="card"><h2>Lobby</h2>${players}
      ${s.red.joined ? '' : `<p class="hint">Send the code <b>${esc(s.code)}</b> (or the invite link) to your friend.</p>`}
      ${host ? `<div class="row"><label class="inline">Training time (minutes) <input id="inMinutes" type="number" min="0.5" max="120" step="0.5" value="${esc(typedMinutes || s.trainMinutes || 20)}" style="width:90px"></label>
        <button id="btnStart" class="primary" ${s.red.joined ? '' : 'disabled'}>Start training timer</button></div>`
        : s.me ? '<p class="hint">Waiting for the room creator to start the training timer…</p>' : '<p class="hint">You are watching this room.</p>'}
      <details><summary>Match rules</summary><p class="hint">Best of series: first to ${s.rules.winsNeeded} match wins (max ${s.rules.maxMatches} matches). A match is ${s.rules.matchSeconds}s or first to ${s.rules.goalsToWin} goals, with sudden-death overtime on a tie. Matches run live: spend 🪙 coins on power-ups and hazards while they play.</p></details>
    </div>
    ${s.me ? minigameSettingsCard(s, host) : ''}
    ${kitCard()}`;
  } else if (s.phase === 'training') {
    const mine = s.me ? s[s.me] : null;
    body = `<div class="card"><h2>Training in progress</h2>${players}
      <div class="bigtimer" id="timer">--:--</div><div class="result hint" id="grace"></div>
      ${s.me ? `<div class="chips"><span class="chip" id="roomCoins">🪙 ${coins}</span><span class="chip" id="nextMini"></span></div>
      <p class="hint">Keep this tab open: minigames pop up on their own while your AI trains. Coins you win are spent on power-ups during the live match.</p>` : ''}
      ${s.me ? uploadCard(mine) : '<p class="hint">You are watching. The match starts when the timer ends or both players lock in.</p>'}</div>${kitCard()}`;
  } else if (s.phase === 'playing' || s.phase === 'done') {
    const r = s.result;
    body = `<div class="card"><h2>${s.phase === 'playing' ? 'Live match in progress' : 'Series finished'}</h2>${players}
      ${r ? `<div class="result">${r.winner < 0 ? 'Draw' : (r.winner === 0 ? esc(s.blue.name) : esc(s.red.name)) + ' wins'} — series ${r.wins[0]}–${r.wins[1]}</div>
      <p class="hint">${r.matches.map((m) => `Match ${m.index + 1}: ${m.score[0]}–${m.score[1]}${m.overtime ? ' (OT)' : ''}`).join(' · ')}</p>
      ${r.noUpload.blue || r.noUpload.red ? `<p class="hint bad">Missing upload: ${[r.noUpload.blue && s.blue.name, r.noUpload.red && s.red.name].filter(Boolean).map(esc).join(', ')} (that team stood still).</p>` : ''}` : '<p class="hint">Open the viewer and spend your coins!</p>'}
      <div class="row"><button id="btnWatchAgain" class="primary">${s.phase === 'playing' ? '▶ Open live viewer' : '▶ Watch replay'}</button>
        ${s.me === 'blue' && s.phase === 'done' ? '<button id="btnRematch">Rematch (new training round)</button>' : ''}
        ${s.phase === 'done' ? `<a class="btn ghost" href="/api/rooms/${esc(s.code)}/replay" download="replay-${esc(s.code)}.json">⬇ Save replay</a>` : ''}</div></div>`;
  }
  el.innerHTML = body;
  const um = document.getElementById('upMsg'); if (um && upMsgHtml) um.innerHTML = upMsgHtml;
  wireRoom();
}

function kitCard() {
  return `<div class="card"><h2>Your AI toolkit</h2>
    <p class="hint">Give your AI assistant the rules + the kit, let it build and train your 2 cubes on your own PC, then upload the weights file.</p>
    <div class="row"><a class="btn primary" href="/kit.zip" download>⬇ Download kit</a><button id="btnRules">📋 Copy rules for my AI</button><a class="btn ghost" href="/RULES.md" target="_blank">Open RULES.md</a></div></div>`;
}
function uploadCard(mine) {
  return `<h2 style="margin-top:14px">Upload your trained AIs</h2>
    <div class="drop" id="drop">Drop your <b>weights .json</b> here or <input type="file" id="fileW" accept=".json" style="display:inline-block"></div>
    <div id="upMsg">${mine && mine.uploaded ? `<p class="ok">✅ Uploaded: ${esc(mine.summary || '')}</p>` : '<p class="hint">Nothing uploaded yet. You can re-upload any time before locking in.</p>'}</div>
    <div class="row"><button id="btnLock" class="primary" ${mine && mine.uploaded ? '' : 'disabled'}>${mine && mine.locked ? '🔓 Unlock' : '🔒 Lock in &amp; ready'}</button>
    <span class="hint">When both players lock in, the match starts right away; otherwise at the end of the timer + 60 s upload grace.</span></div>`;
}

function readSettings() {
  return { minigames: {
    enabled: $('mgOn').checked, intervalMin: Number($('mgEvery').value), firstAtMin: Number($('mgFirst').value),
    bestOf: Number($('mgBest').value), coinMult: Number($('mgMult').value), games: [...document.querySelectorAll('.mgGame:checked')].map((c) => c.value),
  } };
}
function saveSettings() {
  clearTimeout(saveT);
  saveT = setTimeout(async () => { try { await api(`/api/rooms/${session.code}/settings`, { token: session.token, settings: readSettings() }); } catch (e) { notice(e.message); } }, 300);
}

async function openViewer() {
  if (live && playback.mode === 'live') { showStage(true); return; }
  if (viewer && viewer.series && viewer.series.finished && viewer.series.matches.length) { startLocal(viewer.series, true); playback.t = -1; return; }
  try { const series = await api(`/api/rooms/${session.code}/replay`); startLocal(series, true); playback.t = -1; } catch (e) { notice(e.message); }
}

function wireRoom() {
  const on = (id, fn) => { const e = document.getElementById(id); if (e) e.onclick = fn; };
  on('btnRules', $('btnCopyRules').onclick);
  on('btnStart', async () => {
    try { await api(`/api/rooms/${session.code}/start`, { token: session.token, minutes: Number($('inMinutes').value), settings: document.getElementById('mgOn') ? readSettings() : undefined }); poll(); } catch (e) { notice(e.message); }
  });
  on('btnRematch', async () => { try { live = null; showStage(false); await api(`/api/rooms/${session.code}/rematch`, { token: session.token }); poll(); } catch (e) { notice(e.message); } });
  on('btnWatchAgain', openViewer);
  on('btnLock', async () => {
    try { await api(`/api/rooms/${session.code}/upload`, { token: session.token, lock: !state[state.me].locked }); poll(); } catch (e) { notice(e.message); }
  });
  document.querySelectorAll('#room #mgOn, #room #mgSettings input, #room #mgSettings select, #room .mgGame').forEach((i) => { i.onchange = saveSettings; });
  const f = document.getElementById('fileW');
  if (f) {
    const handle = async (file) => {
      const msg = $('upMsg');
      const show = (h) => { upMsgHtml = h; msg.innerHTML = h; };
      try {
        const w = await readJson(file); const v = validateWeights(w);
        if (!v.ok) { show(`<p class="bad">Rejected before upload:</p><pre class="err">${esc(v.errors.join('\n'))}</pre>`); return; }
        show('<p class="hint">Uploading…</p>');
        await api(`/api/rooms/${session.code}/upload`, { token: session.token, weights: w }); upMsgHtml = ''; poll();
      } catch (e) { show(`<p class="bad">${esc(e.message)}</p>${e.details ? `<pre class="err">${esc(e.details.join('\n'))}</pre>` : ''}`); }
    };
    f.onchange = () => f.files[0] && handle(f.files[0]);
    const drop = $('drop');
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) handle(e.dataTransfer.files[0]); };
  }
}

// open invite link  /#CODE, or resume the room this browser was in before a refresh
{
  const hashCode = /^#[A-Za-z]{4}$/.test(location.hash) ? location.hash.slice(1).toUpperCase() : null;
  const code = hashCode || store.get('fb.current');
  if (hashCode) $('inCode').value = hashCode;
  if (code) {
    let saved = null; try { saved = JSON.parse(store.get('fb.room.' + code) || 'null'); } catch { /* ignore */ }
    if (saved && saved.token) enterRoom({ code, token: saved.token, side: saved.side });
    else if (store.get('fb.current') === code && !hashCode) store.del('fb.current');
  }
}
