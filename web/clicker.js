// Cube Clicker: an idle/clicker game for the downtime while your AI trains. Earns trophies -> coins.
import { ITEMS, UPGRADES, TROPHIES, itemCost, fmt } from '/src/clicker.js';
import { sfx } from '/audio.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class Clicker {
  constructor(root, { report, toast }) {
    this.root = root; this.report = report; this.toast = toast; this.key = null; this.timers = [];
  }

  mount(key) {
    this.unmount(); this.key = key;
    let s = null; try { s = JSON.parse(localStorage.getItem(key) || 'null'); } catch { /* ignore */ }
    this.s = s || { goals: 0, total: 0, owned: {}, upg: {}, clicks: 0, last: Date.now() };
    this.frenzy = { cps: 0, click: 0 };           // seconds left of x7 helpers / x20 clicks
    this.golden = null; this.nextGolden = Date.now() + (25 + Math.random() * 40) * 1000;
    this.lastReported = -1;
    const off = Math.min(2 * 3600, (Date.now() - this.s.last) / 1000);                      // helpers kept working while the tab was closed
    if (off > 2) this.add(this.cps() * off);
    this.build();
    this.timers.push(setInterval(() => this.tick(), 100));
    this.timers.push(setInterval(() => this.save(), 2000));
    this.timers.push(setInterval(() => this.send(), 4000));
    this.render(true);
  }
  unmount() { this.timers.forEach(clearInterval); this.timers = []; if (this.key) this.save(); this.key = null; this.root.innerHTML = ''; }

  // ---- numbers ----
  mult(kind) { let m = 1; for (const u of UPGRADES) if (this.s.upg[u.id] && u[kind]) m *= u[kind]; return m; }
  cps() { let c = 0; for (const it of ITEMS) if (it.cps) c += (this.s.owned[it.id] || 0) * it.cps; return c * this.mult('cpsMult') * (this.frenzy.cps > 0 ? 7 : 1); }
  power() { let p = 1; for (const it of ITEMS) if (it.click) p += (this.s.owned[it.id] || 0) * it.click; return p * this.mult('clickMult') * (this.frenzy.click > 0 ? 20 : 1); }
  add(n) { this.s.goals += n; this.s.total += n; }

  save() { if (!this.key) return; this.s.last = Date.now(); try { localStorage.setItem(this.key, JSON.stringify(this.s)); } catch { /* ignore */ } }
  send() { if (this.key && Math.floor(this.s.total) !== this.lastReported) { this.lastReported = Math.floor(this.s.total); this.report(this.lastReported); } }

  // ---- ui ----
  build() {
    this.root.innerHTML = `
      <h2>⚽ Cube Clicker <small>(trophies pay 🪙 coins while your AI trains)</small></h2>
      <div class="ck">
        <div class="ck-main">
          <div class="ck-count"><b id="ckGoals">0</b> goals</div>
          <div class="ck-rate" id="ckRate"></div>
          <div class="ck-ballwrap"><button id="ckBall" aria-label="Kick the ball">⚽</button><div id="ckFloat"></div><button id="ckGolden" class="hidden" aria-label="Golden boot">🥇</button></div>
          <div class="ck-trophy"><div class="bar2"><i id="ckBar"></i></div><div id="ckNext" class="hint"></div></div>
          <div id="ckBuff" class="ck-buff"></div>
        </div>
        <div class="ck-shop"><div id="ckItems"></div><div id="ckUpg"></div></div>
      </div>`;
    const ball = this.root.querySelector('#ckBall');
    ball.addEventListener('pointerdown', (e) => { e.preventDefault(); this.click(e); });
    ball.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); this.click(null); } });
    this.root.querySelector('#ckGolden').onclick = () => this.takeGolden();
    this.root.querySelector('#ckItems').innerHTML = ITEMS.map((it) => `<button class="ck-item" data-id="${it.id}"><span class="ic">${it.icon}</span><span class="tx"><b>${esc(it.name)}</b> <i class="own"></i><small>${esc(it.desc)}</small></span><span class="co"></span></button>`).join('');
    this.root.querySelector('#ckUpg').innerHTML = UPGRADES.map((u) => `<button class="ck-upg" data-id="${u.id}" title="${esc(u.desc)}"><span class="ic">${u.icon}</span><span class="tx"><b>${esc(u.name)}</b><small>${esc(u.desc)}</small></span><span class="co"></span></button>`).join('');
    this.root.querySelectorAll('.ck-item').forEach((b) => { b.onclick = () => this.buy(b.dataset.id); });
    this.root.querySelectorAll('.ck-upg').forEach((b) => { b.onclick = () => this.buyUpg(b.dataset.id); });
  }

  click(e) {
    const p = this.power(); this.add(p); this.s.clicks++;
    const ball = this.root.querySelector('#ckBall'); ball.classList.remove('kick'); void ball.offsetWidth; ball.classList.add('kick');
    const f = this.root.querySelector('#ckFloat'), d = document.createElement('span'); d.textContent = '+' + fmt(p);
    const r = ball.getBoundingClientRect(), fr = f.getBoundingClientRect();
    const x = e ? e.clientX - fr.left : r.width / 2, y = e ? e.clientY - fr.top : r.height / 2;
    d.style.left = x + (Math.random() * 40 - 20) + 'px'; d.style.top = y - 10 + 'px'; f.appendChild(d); setTimeout(() => d.remove(), 800);
    if (this.s.clicks % 3 === 0) sfx.tick(0.1);
    this.render();
  }
  buy(id) {
    const it = ITEMS.find((i) => i.id === id), n = this.s.owned[id] || 0, c = itemCost(it, n);
    if (this.s.goals < c) { sfx.denied(); return; }
    this.s.goals -= c; this.s.owned[id] = n + 1; sfx.coin(); this.render(true);
  }
  buyUpg(id) {
    const u = UPGRADES.find((x) => x.id === id);
    if (this.s.upg[id] || this.s.goals < u.cost) { sfx.denied(); return; }
    this.s.goals -= u.cost; this.s.upg[id] = 1; sfx.power('power'); this.render(true);
  }

  // golden boot: random bonus, like a golden cookie
  takeGolden() {
    const g = this.root.querySelector('#ckGolden'); g.classList.add('hidden'); this.golden = null;
    const roll = Math.random(), cps = this.cps();
    if (roll < 0.45) { const gain = Math.max(100, cps * 300); this.add(gain); this.toast(`🥇 Golden Boot: +${fmt(gain)} goals!`, 'coin'); }
    else if (roll < 0.8) { this.frenzy.cps = 20; this.toast('🥇 Hot streak! Helpers x7 for 20 s', 'coin'); }
    else { this.frenzy.click = 12; this.toast('🥇 Click frenzy! Clicks x20 for 12 s', 'coin'); }
    sfx.goal(); this.render(true);
  }

  tick() {
    const dt = 0.1;
    this.add(this.cps() * dt);
    if (this.frenzy.cps > 0) this.frenzy.cps = Math.max(0, this.frenzy.cps - dt);
    if (this.frenzy.click > 0) this.frenzy.click = Math.max(0, this.frenzy.click - dt);
    const now = Date.now(), g = this.root.querySelector('#ckGolden');
    if (!this.golden && now >= this.nextGolden && g) {
      this.golden = { until: now + 12000 }; g.classList.remove('hidden');
      g.style.left = 8 + Math.random() * 72 + '%'; g.style.top = 8 + Math.random() * 60 + '%'; sfx.invite();
    }
    if (this.golden && now > this.golden.until) { this.golden = null; g.classList.add('hidden'); this.nextGolden = now + (40 + Math.random() * 70) * 1000; }
    this.render();
  }

  render(full) {
    const q = (s) => this.root.querySelector(s); if (!q('#ckGoals')) return;
    q('#ckGoals').textContent = fmt(this.s.goals);
    q('#ckRate').textContent = `${fmt(this.cps())} goals/s · ${fmt(this.power())} per click`;
    const next = TROPHIES.find((t) => this.s.total < t[0]);
    if (next) {
      const prev = TROPHIES[TROPHIES.indexOf(next) - 1], lo = prev ? prev[0] : 0;
      q('#ckBar').style.width = Math.min(100, ((this.s.total - lo) / (next[0] - lo)) * 100) + '%';
      q('#ckNext').textContent = `🏆 Next trophy at ${fmt(next[0])} goals → +${next[1]} 🪙 (${fmt(Math.max(0, next[0] - this.s.total))} to go)`;
    } else { q('#ckBar').style.width = '100%'; q('#ckNext').textContent = '🏆 All trophies won! Legend.'; }
    const buff = [this.frenzy.cps > 0 ? `🔥 Helpers x7 (${Math.ceil(this.frenzy.cps)}s)` : '', this.frenzy.click > 0 ? `⚡ Clicks x20 (${Math.ceil(this.frenzy.click)}s)` : ''].filter(Boolean).join('  ');
    q('#ckBuff').textContent = buff;
    this.root.querySelectorAll('.ck-item').forEach((b) => {
      const it = ITEMS.find((i) => i.id === b.dataset.id), n = this.s.owned[it.id] || 0, c = itemCost(it, n);
      b.querySelector('.co').textContent = fmt(c); b.querySelector('.own').textContent = n ? '×' + n : ''; b.disabled = this.s.goals < c;
    });
    this.root.querySelectorAll('.ck-upg').forEach((b) => {
      const u = UPGRADES.find((x) => x.id === b.dataset.id), owned = !!this.s.upg[u.id];
      b.querySelector('.co').textContent = owned ? '✔' : fmt(u.cost); b.disabled = owned || this.s.goals < u.cost; b.classList.toggle('done', owned);
    });
    void full;
  }
}
