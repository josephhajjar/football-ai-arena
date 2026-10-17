// Minigame overlay: invite card, live canvas rendering of the server's snapshots, input handling, result screen.
import { sfx } from '/audio.js';

const BLUE = '#3d84ff', RED = '#ff5a4d';
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class MiniUI {
  constructor({ net, getSide, getName }) {
    this.net = net; this.getSide = getSide; this.getName = getName;
    this.el = document.createElement('div'); this.el.id = 'mg'; this.el.className = 'hidden';
    this.el.innerHTML = `
      <div id="mgInvite" class="mgcard hidden"></div>
      <div id="mgPlay" class="hidden">
        <canvas id="mgCanvas"></canvas>
        <div id="mgTop"><span id="mgTitle"></span><span id="mgScore"></span><span id="mgRound"></span></div>
        <div id="mgHelp"></div>
        <div id="mgBanner"></div>
        <div id="mgTouch" class="hidden"><button id="mgDash">DASH</button></div>
        <div id="mgTurn" class="hidden"><button id="mgL">⟲</button><button id="mgR">⟳</button></div>
      </div>
      <div id="mgResult" class="mgcard hidden"></div>`;
    document.body.appendChild(this.el);
    this.q = (s) => this.el.querySelector(s);
    this.canvas = this.q('#mgCanvas'); this.g = this.canvas.getContext('2d');
    this.state = 'idle'; this.cur = null; this.prev = null; this.tCur = 0; this.tPrev = 0; this.gid = null;
    this.keys = new Set(); this.seq = 0; this.lastSent = ''; this.lastSendAt = 0; this.mouse = null; this.joy = null; this.lastCount = -1;
    this.bind();
    const loop = () => { this.draw(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  get active() { return this.state !== 'idle'; }
  show(part) { for (const id of ['mgInvite', 'mgPlay', 'mgResult']) this.q('#' + id).classList.toggle('hidden', id !== part); this.el.classList.toggle('hidden', !part); }

  handle(m) {
    const side = this.getSide();
    if (side == null) return;                       // spectators don't play
    if (m.t === 'mg_invite') this.invite(m);
    else if (m.t === 'mg_joined') this.joined(m);
    else if (m.t === 'mg_start') this.start(m);
    else if (m.t === 'mg') this.snapshot(m.s);
    else if (m.t === 'mg_result') this.result(m);
    else if (m.t === 'mg_end') this.end();
  }

  // ---------- invite ----------
  invite(m) {
    this.state = 'invite'; this.gid = m.id; this.myJoined = false;
    sfx.invite(); this.flashTitle(m.name);
    const box = this.q('#mgInvite');
    box.innerHTML = `<div class="mgicon">${esc(m.icon)}</div><h2>${esc(m.name)}</h2><p>${esc(m.blurb)}</p>
      <p class="hint">${esc(m.help)}</p>
      <p class="coins">Win <b>${Math.round(m.reward.win * m.mult)}</b> 🪙 · play and still get <b>${Math.round(m.reward.lose * m.mult)}</b> 🪙</p>
      <div class="bar"><i id="mgBar"></i></div>
      <div class="row" style="justify-content:center"><button id="mgJoin" class="primary">▶ Play now (Enter)</button><button id="mgSkip" class="ghost">Skip (Esc)</button></div>
      <p class="hint" id="mgWho">Your AI keeps training in the background.</p>`;
    this.deadline = m.deadline; this.inviteStart = Date.now();
    this.q('#mgJoin').onclick = () => this.join(); this.q('#mgSkip').onclick = () => this.skip();
    this.show('mgInvite');
  }
  join() { if (this.state !== 'invite' || this.myJoined) return; this.myJoined = true; this.net.send({ t: 'mg_join' }); const b = this.q('#mgJoin'); b.disabled = true; b.textContent = 'Waiting for your opponent…'; }
  skip() { if (this.state !== 'invite') return; this.net.send({ t: 'mg_decline' }); this.end(); }
  joined(m) { const w = this.q('#mgWho'); if (w && this.state === 'invite') { const side = this.getSide(); w.textContent = m.joined[1 - side] ? 'Your opponent is ready!' : 'Waiting for the other player…'; } }
  flashTitle(name) {
    const base = document.title; let n = 0; clearInterval(this.ft);
    this.ft = setInterval(() => { document.title = n++ % 2 ? base : `🎮 ${name}!`; if (this.state !== 'invite' || n > 40) { clearInterval(this.ft); document.title = base; } }, 700);
  }

  // ---------- play ----------
  start(m) {
    this.state = 'play'; this.gid = m.id; this.cur = this.prev = null; this.lastCount = -1; this.keys.clear(); this.seq = 0; this.mouse = null; this.joy = null;
    this.q('#mgTitle').textContent = m.name; this.q('#mgHelp').textContent = m.help; this.q('#mgBanner').textContent = '';
    this.q('#mgTouch').classList.toggle('hidden', !(m.id === 'sumo' || m.id === 'tag') || !('ontouchstart' in window));
    this.q('#mgTurn').classList.toggle('hidden', !(m.id === 'cycles') || !('ontouchstart' in window));
    this.show('mgPlay'); this.resize();
  }
  snapshot(s) {
    this.prev = this.cur; this.tPrev = this.tCur; this.cur = s; this.tCur = performance.now();
    const side = this.getSide(), you = side === 0 ? 'YOU' : '', opp = side === 1 ? 'YOU' : '';
    this.q('#mgScore').innerHTML = `<b style="color:${BLUE}">${you ? 'YOU ' : 'Blue '}${s.scores[0]}</b> : <b style="color:${RED}">${s.scores[1]} ${opp ? 'YOU' : 'Red'}</b>`;
    this.q('#mgRound').textContent = s.g === 'hockey' ? (s.sudden ? 'SUDDEN DEATH' : `${Math.ceil(s.clock)}s`) : `Round ${s.round} · first to ${s.need}`;
    const b = this.q('#mgBanner');
    if (s.phase === 'countdown') {
      const n = Math.ceil(s.timer); b.textContent = n > 0 ? String(n) : 'GO!'; b.className = 'big';
      if (n !== this.lastCount) { this.lastCount = n; if (n > 0) sfx.beep(false); }
    } else if (s.phase === 'roundEnd') { b.textContent = s.banner; b.className = 'mid'; if (this.lastCount !== -2) { this.lastCount = -2; sfx.whistle(); } }
    else { if (this.lastCount !== -1 && this.lastCount !== 0) { sfx.beep(true); } this.lastCount = s.phase === 'play' ? 0 : this.lastCount; b.textContent = ''; b.className = ''; }
    if (s.phase === 'countdown') this.lastCount = Math.ceil(s.timer) === 0 ? 0 : this.lastCount;
    if (s.g === 'tag' && s.phase === 'play' && s.flash) sfx.pass();
    if (s.g === 'draw' && s.phase === 'play' && s.go && !this.drawGoSeen) { this.drawGoSeen = true; sfx.beep(true); }
    if (s.g === 'draw' && s.phase !== 'play') this.drawGoSeen = false;
    if (s.g === 'sumo' && this.prev && s.phase === 'play') s.p.forEach((p, i) => { if (p[5] && !this.prev.p[i][5]) sfx.crash(); });
    if (s.g === 'tag' && s.phase === 'play' && Math.random() < 0.0) sfx.tick(s.u);
  }
  result(m) {
    this.state = 'result';
    const side = this.getSide(), won = m.winner === side, draw = m.winner < 0;
    const gain = m.coins[side];
    if (won) sfx.win(); else sfx.lose(); sfx.coin();
    const box = this.q('#mgResult');
    box.innerHTML = `<div class="mgicon">${won ? '🏆' : draw ? '🤝' : '😤'}</div><h2>${m.walkover ? (won ? 'Walkover win' : 'You missed it') : won ? 'VICTORY!' : draw ? 'Draw' : 'Defeat'}</h2>
      <p>${esc(m.name)}${m.walkover ? '' : ` · ${m.scores[side]} – ${m.scores[1 - side]}`}</p><div class="gain">+${gain} 🪙</div>
      <p class="hint">Coins are spent on power-ups and hazards during the live match.</p>${won ? '<div class="confetti"></div>' : ''}`;
    if (won) { const c = box.querySelector('.confetti'); for (let i = 0; i < 28; i++) { const s = document.createElement('i'); s.textContent = ['🎉', '✨', '🪙', '⭐'][i % 4]; s.style.left = Math.random() * 100 + '%'; s.style.animationDelay = Math.random() * 1.2 + 's'; c.appendChild(s); } }
    this.show('mgResult');
  }
  end() { this.state = 'idle'; this.cur = this.prev = null; this.show(null); this.keys.clear(); }

  // ---------- input ----------
  bind() {
    const down = (e) => {
      if (this.state === 'invite') { if (e.key === 'Enter') { e.preventDefault(); this.join(); } else if (e.key === 'Escape') this.skip(); return; }
      if (this.state !== 'play') return;
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'w', 'a', 's', 'd'].includes(k)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(k);
      if (this.gid === 'sumo' || this.gid === 'tag') { if (k === ' ' || k === 'shift') this.net.send({ t: 'mg_input', i: { dash: true } }); }
      if (this.gid === 'cycles') { if (k === 'a' || k === 'arrowleft') this.turn(-1); if (k === 'd' || k === 'arrowright') this.turn(1); }
      if (this.gid === 'draw' && (k === ' ' || k === 'enter')) this.net.send({ t: 'mg_input', i: { press: true } });
      this.sendMove();
    };
    const up = (e) => { this.keys.delete(e.key.toLowerCase()); if (this.state === 'play') this.sendMove(); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    window.addEventListener('blur', () => { this.keys.clear(); if (this.state === 'play') this.sendMove(); });
    window.addEventListener('resize', () => this.resize());
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      if (this.state !== 'play') return;
      c.setPointerCapture(e.pointerId);
      if (this.gid === 'draw') this.net.send({ t: 'mg_input', i: { press: true } });
      else if (this.gid === 'cycles') this.turn(e.clientX < innerWidth / 2 ? -1 : 1);
      else if (this.gid === 'sumo' || this.gid === 'tag') { if (e.pointerType === 'mouse' && e.button === 2) this.net.send({ t: 'mg_input', i: { dash: true } }); else this.joy = { x: e.clientX, y: e.clientY, id: e.pointerId, dx: 0, dy: 0 }; }
      else if (this.gid === 'hockey') this.pointerTo(e);
    });
    c.addEventListener('pointermove', (e) => {
      if (this.state !== 'play') return;
      if (this.gid === 'hockey') this.pointerTo(e);
      else if (this.joy && this.joy.id === e.pointerId) { this.joy.dx = e.clientX - this.joy.x; this.joy.dy = e.clientY - this.joy.y; this.sendMove(); }
    });
    c.addEventListener('pointerup', (e) => { if (this.joy && this.joy.id === e.pointerId) { this.joy = null; this.sendMove(); } });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    this.q('#mgDash').addEventListener('pointerdown', (e) => { e.preventDefault(); this.net.send({ t: 'mg_input', i: { dash: true } }); });
    this.q('#mgL').addEventListener('pointerdown', (e) => { e.preventDefault(); this.turn(-1); });
    this.q('#mgR').addEventListener('pointerdown', (e) => { e.preventDefault(); this.turn(1); });
    setInterval(() => { if (this.state === 'play') { this.sendMove(true); } }, 80);
  }
  turn(t) { this.net.send({ t: 'mg_input', i: { turn: t, seq: ++this.seq } }); }
  sendMove(force) {
    if (this.gid === 'sumo' || this.gid === 'tag') {
      let mx = (this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0) - (this.keys.has('a') || this.keys.has('arrowleft') ? 1 : 0);
      let mz = (this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0) - (this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0);
      if (this.joy) { const l = Math.hypot(this.joy.dx, this.joy.dy); if (l > 8) { mx = this.joy.dx / Math.max(l, 50) ; mz = this.joy.dy / Math.max(l, 50); } }
      const key = mx.toFixed(2) + ',' + mz.toFixed(2);
      if (key !== this.lastSent || (force && Date.now() - this.lastSendAt > 400)) { this.lastSent = key; this.lastSendAt = Date.now(); this.net.send({ t: 'mg_input', i: { mx, mz } }); }
    } else if (this.gid === 'hockey') {
      // keyboard nudges the target when the mouse is not being used
      if (this.keys.size && this.cur && this.cur.g === 'hockey') {
        const side = this.getSide(); const pad = this.cur.pad[side];
        const dx = ((this.keys.has('d') || this.keys.has('arrowright')) ? 1 : 0) - ((this.keys.has('a') || this.keys.has('arrowleft')) ? 1 : 0);
        const dz = ((this.keys.has('s') || this.keys.has('arrowdown')) ? 1 : 0) - ((this.keys.has('w') || this.keys.has('arrowup')) ? 1 : 0);
        if (dx || dz) this.net.send({ t: 'mg_input', i: { x: pad[0] + dx * 3, z: pad[1] + dz * 3 } });
      }
    }
  }
  pointerTo(e) {
    if (!this.hk || !this.cur) return;
    const r = this.canvas.getBoundingClientRect(), px = (e.clientX - r.left) * (this.canvas.width / r.width) / this.dpr, py = (e.clientY - r.top) * (this.canvas.height / r.height) / this.dpr;
    const x = (px - this.hk.ox) / this.hk.s, z = (py - this.hk.oy) / this.hk.s, now = performance.now();
    if (now - (this.lastPtr || 0) < 28) return; this.lastPtr = now;
    this.net.send({ t: 'mg_input', i: { x, z } });
  }

  resize() {
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = innerWidth * this.dpr; this.canvas.height = innerHeight * this.dpr;
    this.canvas.style.width = innerWidth + 'px'; this.canvas.style.height = innerHeight + 'px';
  }

  // ---------- drawing ----------
  interp() {
    const s = this.cur; if (!s) return null;
    const dt = this.tCur - this.tPrev, a = this.prev && dt > 1 ? clamp((performance.now() - this.tCur) / dt, 0, 1) : 1;
    const P = this.prev && this.prev.g === s.g ? this.prev : s;
    const mix = (x, y) => (Array.isArray(x) ? x.map((v, i) => mix(v, y[i])) : typeof x === 'number' && typeof y === 'number' ? lerp(y, x, a) : x);
    return { ...s, p: s.p ? mix(s.p, P.p) : undefined, puck: s.puck ? mix(s.puck, P.puck) : undefined, pad: s.pad ? mix(s.pad, P.pad) : undefined };
  }
  draw() {
    if (this.state !== 'play' || !this.cur) return;
    const g = this.g, W = innerWidth, H = innerHeight, s = this.interp(); if (!s) return;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const bg = g.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, Math.max(W, H) * 0.75); bg.addColorStop(0, '#16223f'); bg.addColorStop(1, '#070b16');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const t = performance.now() / 1000;
    ({ sumo: () => this.drawSumo(g, s, W, H, t), tag: () => this.drawTag(g, s, W, H, t), cycles: () => this.drawCycles(g, s, W, H, t), hockey: () => this.drawHockey(g, s, W, H, t), draw: () => this.drawQuick(g, s, W, H, t) })[s.g]();
  }
  cube(g, x, y, size, col, label, alpha = 1, angle = 0) {
    g.save(); g.translate(x, y); g.rotate(angle); g.globalAlpha = alpha;
    g.shadowColor = col; g.shadowBlur = 18; g.fillStyle = col;
    g.beginPath(); g.roundRect(-size / 2, -size / 2, size, size, size * 0.2); g.fill();
    g.shadowBlur = 0; g.fillStyle = 'rgba(255,255,255,0.22)'; g.beginPath(); g.roundRect(-size / 2 + 3, -size / 2 + 3, size - 6, size * 0.4, size * 0.15); g.fill();
    g.restore();
    if (label) { g.save(); g.globalAlpha = alpha; g.fillStyle = '#fff'; g.font = 'bold 13px system-ui'; g.textAlign = 'center'; g.fillText(label, x, y - size * 0.75); g.restore(); }
  }
  drawSumo(g, s, W, H, t) {
    const sc = Math.min(W, H * 1.1) * 0.42 / 10, cx = W / 2, cy = H / 2 + 10, me = this.getSide();
    g.fillStyle = 'rgba(255,255,255,0.5)'; for (let i = 0; i < 60; i++) { const x = (Math.sin(i * 91.3) * 0.5 + 0.5) * W, y = (Math.sin(i * 47.1 + 2) * 0.5 + 0.5) * H; g.fillRect(x, y, 2, 2); }
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.setLineDash([6, 8]); g.beginPath(); g.arc(cx, cy, 10 * sc, 0, 7); g.stroke(); g.setLineDash([]);
    const R = s.R * sc, danger = clamp(1 - (s.R - 3.6) / 6.4, 0, 1), rim = `hsl(${190 - danger * 190}, 100%, 60%)`;
    const pl = g.createRadialGradient(cx, cy, 10, cx, cy, R); pl.addColorStop(0, '#2a3552'); pl.addColorStop(1, '#1a2238');
    g.save(); g.shadowColor = rim; g.shadowBlur = 28 + danger * 20; g.fillStyle = pl; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill(); g.restore();
    g.strokeStyle = rim; g.lineWidth = 4; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 1; for (let r = 1; r < R / sc; r += 2) { g.beginPath(); g.arc(cx, cy, r * sc, 0, 7); g.stroke(); }
    s.p.forEach((p, i) => {
      const x = cx + p[0] * sc, y = cy + p[1] * sc, fell = p[5], col = i === 0 ? BLUE : RED;
      if (p[6]) { g.strokeStyle = col; g.globalAlpha = 0.4; g.lineWidth = sc * 1.4; g.beginPath(); g.moveTo(x, y); g.lineTo(x - p[2] * 0.07 * sc, y - p[3] * 0.07 * sc); g.stroke(); g.globalAlpha = 1; }
      this.cube(g, x, y, sc * 1.9, col, i === me ? 'YOU' : '', fell ? 0.45 : 1, Math.atan2(p[3], p[2]) * 0.15);
      if (!fell) { const cd = clamp(p[4] / 1.5, 0, 1); g.strokeStyle = cd > 0 ? 'rgba(255,255,255,0.35)' : '#7dffb2'; g.lineWidth = 3; g.beginPath(); g.arc(x, y, sc * 1.3, -Math.PI / 2, -Math.PI / 2 + (1 - cd) * Math.PI * 2); g.stroke(); }
    });
  }
  drawTag(g, s, W, H, t) {
    const sc = Math.min(W * 0.9 / (s.hw * 2), H * 0.8 / (s.hh * 2)), cx = W / 2, cy = H / 2 + 10, me = this.getSide();
    const heat = s.u * s.u;
    if (s.phase === 'play') { const p = 0.5 + 0.5 * Math.sin(t * (3 + s.u * 22) * 2); g.fillStyle = `rgba(255,40,20,${heat * 0.22 * p})`; g.fillRect(0, 0, W, H); }
    g.save(); g.shadowColor = '#7b5cff'; g.shadowBlur = 24; g.strokeStyle = '#7b5cff'; g.lineWidth = 4; g.fillStyle = '#10182e'; g.beginPath(); g.roundRect(cx - s.hw * sc, cy - s.hh * sc, s.hw * 2 * sc, s.hh * 2 * sc, 18); g.fill(); g.stroke(); g.restore();
    g.strokeStyle = 'rgba(255,255,255,0.05)'; for (let x = -s.hw; x <= s.hw; x += 2) { g.beginPath(); g.moveTo(cx + x * sc, cy - s.hh * sc); g.lineTo(cx + x * sc, cy + s.hh * sc); g.stroke(); }
    for (const [px, pz] of s.pillars) { g.save(); g.shadowColor = '#a58bff'; g.shadowBlur = 14; g.fillStyle = '#2b2f55'; g.strokeStyle = '#a58bff'; g.lineWidth = 3; g.beginPath(); g.arc(cx + px * sc, cy + pz * sc, s.pr * sc, 0, 7); g.fill(); g.stroke(); g.restore(); }
    s.p.forEach((p, i) => {
      const x = cx + p[0] * sc, y = cy + p[1] * sc, col = i === 0 ? BLUE : RED, holder = s.holder === i;
      this.cube(g, x, y, sc * 1.7, col, i === me ? 'YOU' : '', p[5] ? 0.6 : 1, Math.atan2(p[3], p[2]) * 0.1);
      if (holder) {
        const pulse = 0.5 + 0.5 * Math.sin(t * (3 + s.u * 22) * 2), r = sc * (0.75 + 0.2 * pulse);
        g.save(); g.shadowColor = '#ff3b1f'; g.shadowBlur = 20 + 30 * pulse; g.fillStyle = '#111'; g.beginPath(); g.arc(x, y - sc * 1.3, r, 0, 7); g.fill(); g.strokeStyle = `rgba(255,${80 + 120 * (1 - pulse) | 0},40,1)`; g.lineWidth = 4; g.stroke(); g.fillStyle = '#ffd34d'; g.font = `${(r * 1.3) | 0}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('💣', x, y - sc * 1.3); g.restore();
      }
      if (p[5]) { g.fillStyle = '#fff27a'; g.font = '16px system-ui'; g.textAlign = 'center'; g.fillText('✦ ✦', x, y - sc * 1.4); }
    });
    if (s.flash) { g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(0, 0, W, H); }
  }
  drawCycles(g, s, W, H, t) {
    const sc = Math.min(W * 0.94 / s.W, H * 0.8 / s.H), cx = W / 2 - s.W * sc / 2, cy = H / 2 - s.H * sc / 2 + 12, me = this.getSide();
    g.save(); g.shadowColor = '#18e0ff'; g.shadowBlur = 20; g.fillStyle = '#060c1c'; g.strokeStyle = '#18e0ff'; g.lineWidth = 3; g.fillRect(cx, cy, s.W * sc, s.H * sc); g.strokeRect(cx, cy, s.W * sc, s.H * sc); g.restore();
    g.strokeStyle = 'rgba(24,224,255,0.07)'; g.lineWidth = 1; for (let x = 0; x <= s.W; x++) { g.beginPath(); g.moveTo(cx + x * sc, cy); g.lineTo(cx + x * sc, cy + s.H * sc); g.stroke(); } for (let y = 0; y <= s.H; y++) { g.beginPath(); g.moveTo(cx, cy + y * sc); g.lineTo(cx + s.W * sc, cy + y * sc); g.stroke(); }
    s.trails.forEach((tr, i) => {
      const col = i === 0 ? '#3d84ff' : '#ff5a4d'; g.save(); g.shadowColor = col; g.shadowBlur = 12; g.fillStyle = col;
      for (const idx of tr) g.fillRect(cx + (idx % s.W) * sc + 1, cy + Math.floor(idx / s.W) * sc + 1, sc - 2, sc - 2); g.restore();
    });
    s.c.forEach((c, i) => {
      const x = cx + c[0] * sc + sc / 2, y = cy + c[1] * sc + sc / 2;
      g.save(); g.shadowColor = '#fff'; g.shadowBlur = 22; g.fillStyle = c[3] ? '#ff9d2b' : '#fff'; g.beginPath(); g.arc(x, y, sc * (c[3] ? 1.4 + 0.3 * Math.sin(t * 20) : 0.75), 0, 7); g.fill(); g.restore();
      if (i === me) { g.fillStyle = '#fff'; g.font = 'bold 12px system-ui'; g.textAlign = 'center'; g.fillText('YOU', x, y - sc * 1.3); }
    });
  }
  drawHockey(g, s, W, H, t) {
    const sc = Math.min(W * 0.94 / (s.hw * 2), H * 0.78 / (s.hh * 2)), cx = W / 2, cy = H / 2 + 14, me = this.getSide();
    this.hk = { s: sc, ox: cx, oy: cy };
    g.save(); g.shadowColor = '#4fb8ff'; g.shadowBlur = 26; g.fillStyle = '#0d1d3a'; g.strokeStyle = '#4fb8ff'; g.lineWidth = 4; g.beginPath(); g.roundRect(cx - s.hw * sc, cy - s.hh * sc, s.hw * 2 * sc, s.hh * 2 * sc, 36); g.fill(); g.stroke(); g.restore();
    g.strokeStyle = 'rgba(120,200,255,0.35)'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx, cy - s.hh * sc); g.lineTo(cx, cy + s.hh * sc); g.stroke(); g.beginPath(); g.arc(cx, cy, 2.6 * sc, 0, 7); g.stroke();
    for (const sd of [-1, 1]) { g.save(); g.shadowColor = sd < 0 ? BLUE : RED; g.shadowBlur = 24; g.strokeStyle = sd < 0 ? BLUE : RED; g.lineWidth = 8; g.beginPath(); g.moveTo(cx + sd * s.hw * sc, cy - s.gw * sc); g.lineTo(cx + sd * s.hw * sc, cy + s.gw * sc); g.stroke(); g.restore(); g.fillStyle = (sd < 0 ? BLUE : RED) + '33'; g.fillRect(sd < 0 ? cx - s.hw * sc - 26 : cx + s.hw * sc, cy - s.gw * sc, 26, s.gw * 2 * sc); }
    s.pad.forEach((p, i) => { const col = i === 0 ? BLUE : RED; g.save(); g.shadowColor = col; g.shadowBlur = 20; g.fillStyle = col; g.beginPath(); g.arc(cx + p[0] * sc, cy + p[1] * sc, s.pr * sc, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.arc(cx + p[0] * sc, cy + p[1] * sc, s.pr * sc * 0.5, 0, 7); g.fill(); g.restore(); if (i === me) { g.fillStyle = '#fff'; g.font = 'bold 12px system-ui'; g.textAlign = 'center'; g.fillText('YOU', cx + p[0] * sc, cy + p[1] * sc - s.pr * sc - 6); } });
    const u = s.puck, sp = Math.hypot(u[2], u[3]);
    g.save(); g.shadowColor = '#fff'; g.shadowBlur = 12 + sp; g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = s.ur * sc * 1.2; g.lineCap = 'round'; g.beginPath(); g.moveTo(cx + u[0] * sc, cy + u[1] * sc); g.lineTo(cx + (u[0] - u[2] * 0.03) * sc, cy + (u[1] - u[3] * 0.03) * sc); g.stroke(); g.fillStyle = '#f5f7ff'; g.beginPath(); g.arc(cx + u[0] * sc, cy + u[1] * sc, s.ur * sc, 0, 7); g.fill(); g.restore();
  }
  drawQuick(g, s, W, H, t) {
    let col = '#7a1b1b', text = 'WAIT…', sub = 'Do NOT press yet';
    if (s.phase === 'play') { if (s.go) { col = '#10c76a'; text = 'NOW!'; sub = 'SPACE / click / tap'; } else if (s.decoy) { col = '#d9a400'; text = 'TRAP!'; sub = 'not yet…'; } }
    else if (s.phase === 'countdown') { col = '#1a2440'; text = 'Get ready'; sub = ''; }
    else { col = '#1a2440'; text = ''; sub = ''; }
    g.fillStyle = col; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.arc(W / 2, H / 2, Math.min(W, H) * 0.3, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = `900 ${Math.min(W, H) * 0.16 | 0}px system-ui`; g.fillText(text, W / 2, H / 2 + Math.min(W, H) * 0.05);
    g.font = `600 ${Math.min(W, H) * 0.035 | 0}px system-ui`; g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillText(sub, W / 2, H / 2 + Math.min(W, H) * 0.14);
    if (s.react && (s.react[0] != null || s.react[1] != null)) { g.font = `700 ${Math.min(W, H) * 0.05 | 0}px system-ui`; g.fillText(`Blue ${s.react[0] ?? '–'} ms     Red ${s.react[1] ?? '–'} ms`, W / 2, H * 0.82); }
  }
}
