// Cube Clicker rules, shared by the browser game (web/clicker.js) and the server (which pays out the coins).
// The server never trusts the browser: it only pays for trophies reached, capped by how long training has run.

// [goals needed, coins paid]. Total possible per training round = 60 coins.
export const TROPHIES = [[400, 4], [1200, 4], [3600, 5], [10800, 5], [32400, 6], [97200, 6], [291600, 7], [874800, 7], [2624400, 8], [7873200, 8]];
export const MAX_CLICKER_COINS = TROPHIES.reduce((n, t) => n + t[1], 0);

export function coinsForScore(score) {
  let c = 0;
  for (const [need, pay] of TROPHIES) if (Number.isFinite(score) && score >= need) c += pay;
  return c;
}
// anti-cheat cap: at most 4 coins per minute of training (+4 to start)
export const clickerCap = (elapsedMin) => Math.floor(Math.max(0, elapsedMin) * 4) + 4;

// cost = base * 1.15^owned (a bit steeper for the click item)
export const ITEMS = [
  { id: 'boot',    name: 'Better Boots',    icon: '👟', base: 15,     growth: 1.3,  click: 1,    desc: '+1 goal per click' },
  { id: 'ballboy', name: 'Ball Boy',        icon: '🧒', base: 20,     growth: 1.15, cps: 0.5,    desc: 'Fetches balls: +0.5 goals/s' },
  { id: 'striker', name: 'Striker',         icon: '⚽', base: 120,    growth: 1.15, cps: 4,      desc: 'Scores for you: +4 goals/s' },
  { id: 'pitch',   name: 'Training Pitch',  icon: '🥅', base: 700,    growth: 1.15, cps: 20,     desc: '+20 goals/s' },
  { id: 'crowd',   name: 'Roaring Crowd',   icon: '📣', base: 4000,   growth: 1.15, cps: 110,    desc: '+110 goals/s' },
  { id: 'academy', name: 'Youth Academy',   icon: '🏫', base: 25000,  growth: 1.15, cps: 600,    desc: '+600 goals/s' },
  { id: 'stadium', name: 'Stadium',         icon: '🏟️', base: 160000, growth: 1.15, cps: 3500,   desc: '+3,500 goals/s' },
];

// one-time upgrades
export const UPGRADES = [
  { id: 'proboots', name: 'Pro Boots',      icon: '🥾', cost: 250,    desc: 'Clicks are worth x2',        clickMult: 2 },
  { id: 'scout',    name: 'Scout Network',  icon: '🔭', cost: 3000,   desc: 'All helpers +50%',           cpsMult: 1.5 },
  { id: 'sponsor',  name: 'Sponsor Deal',   icon: '💼', cost: 60000,  desc: 'Everything x2',              cpsMult: 2, clickMult: 2 },
  { id: 'tv',       name: 'TV Rights',      icon: '📺', cost: 600000, desc: 'All helpers x2',             cpsMult: 2 },
];

export const itemCost = (item, owned) => Math.ceil(item.base * item.growth ** owned);

export function fmt(n) {
  if (n < 1000) return n < 10 && n % 1 ? n.toFixed(1) : String(Math.floor(n));
  const u = ['K', 'M', 'B', 'T']; let i = -1;
  while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
  return (n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : Math.floor(n)) + u[i];
}
