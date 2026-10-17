// Tiny synthesized sound effects (WebAudio, no files). Browsers only allow sound after a click/keypress,
// so the context is created lazily and resumed on the first user gesture.
let ctx = null, master = null, muted = false;
try { muted = localStorage.getItem('fb.muted') === '1'; } catch { /* ignore */ }

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    ctx = new AC(); master = ctx.createGain(); master.gain.value = muted ? 0 : 0.5; master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, () => ensure(), { passive: true }));

function tone(freq, dur, { type = 'sine', vol = 0.3, slide = 0, delay = 0 } = {}) {
  const c = ensure(); if (!c || muted) return;
  const t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
}
function noise(dur, { vol = 0.4, lp = 1200, delay = 0 } = {}) {
  const c = ensure(); if (!c || muted) return;
  const n = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), t = c.currentTime + delay;
  f.type = 'lowpass'; f.frequency.value = lp; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.buffer = buf; s.connect(f); f.connect(g); g.connect(master); s.start(t);
}

export const sfx = {
  setMuted(m) { muted = m; try { localStorage.setItem('fb.muted', m ? '1' : '0'); } catch { /* ignore */ } if (master) master.gain.value = m ? 0 : 0.5; },
  get muted() { return muted; },
  kick(v = 20) { tone(110 + v * 3, 0.09, { type: 'triangle', vol: 0.18 + Math.min(0.25, v / 90), slide: -60 }); noise(0.05, { vol: 0.12, lp: 900 }); },
  goal() { [392, 523, 659, 784].forEach((f, i) => tone(f, 0.5, { type: 'sawtooth', vol: 0.12, delay: i * 0.09 })); noise(0.9, { vol: 0.12, lp: 3000 }); },
  explode() { noise(0.7, { vol: 0.7, lp: 700 }); tone(80, 0.6, { type: 'sine', vol: 0.5, slide: -50 }); },
  tick(u = 0) { tone(900 + u * 600, 0.04, { type: 'square', vol: 0.12 }); },
  coin() { tone(988, 0.08, { type: 'square', vol: 0.1 }); tone(1319, 0.18, { type: 'square', vol: 0.1, delay: 0.07 }); },
  power(kind) { if (kind === 'hazard') { tone(220, 0.25, { type: 'sawtooth', vol: 0.15, slide: -120 }); tone(165, 0.3, { type: 'square', vol: 0.08, delay: 0.1 }); } else { tone(523, 0.12, { type: 'triangle', vol: 0.2 }); tone(784, 0.2, { type: 'triangle', vol: 0.2, delay: 0.08 }); } },
  denied() { tone(150, 0.14, { type: 'square', vol: 0.12 }); },
  beep(final = false) { tone(final ? 1100 : 660, final ? 0.35 : 0.12, { type: 'square', vol: 0.14 }); },
  invite() { [660, 880, 660, 880].forEach((f, i) => tone(f, 0.12, { type: 'triangle', vol: 0.2, delay: i * 0.14 })); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.22, delay: i * 0.11 })); },
  lose() { [392, 330, 262].forEach((f, i) => tone(f, 0.35, { type: 'sine', vol: 0.2, delay: i * 0.16 })); },
  whistle() { tone(2100, 0.5, { type: 'sine', vol: 0.12 }); tone(2300, 0.5, { type: 'sine', vol: 0.1, delay: 0.02 }); },
  pass() { tone(300, 0.1, { type: 'square', vol: 0.18, slide: 500 }); },
  crash() { noise(0.35, { vol: 0.4, lp: 1500 }); tone(120, 0.3, { type: 'sawtooth', vol: 0.25, slide: -80 }); },
  hit() { tone(180, 0.08, { type: 'square', vol: 0.15, slide: -90 }); },
};
