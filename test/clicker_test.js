// node test/clicker_test.js - Cube Clicker rules: trophies, costs, anti-cheat cap.
import assert from 'node:assert/strict';
import { coinsForScore, clickerCap, MAX_CLICKER_COINS, TROPHIES, ITEMS, itemCost, fmt } from '../src/clicker.js';
assert.equal(coinsForScore(0), 0); assert.equal(coinsForScore(399), 0); assert.equal(coinsForScore(400), 4);
assert.equal(coinsForScore(1200), 8); assert.equal(coinsForScore(1e12), MAX_CLICKER_COINS); assert.equal(MAX_CLICKER_COINS, 60);
assert.equal(coinsForScore(NaN), 0); assert.equal(coinsForScore(-1), 0);
assert.equal(clickerCap(0), 4); assert.equal(clickerCap(5), 24); assert.equal(clickerCap(-3), 4);
assert.ok(TROPHIES.every((t, i) => i === 0 || t[0] > TROPHIES[i - 1][0]), 'trophies increase');
assert.equal(itemCost(ITEMS[1], 0), 20); assert.ok(itemCost(ITEMS[1], 10) > itemCost(ITEMS[1], 9));
assert.equal(fmt(999), '999'); assert.equal(fmt(1500), '1.50K'); assert.equal(fmt(2.5e6), '2.50M');
// a diligent 20 minute session should land well under the cap but give a real reward
let goals = 0, cps = 0, click = 1, owned = {}, t = 0;      // simple bot: 4 clicks/s, buys the best-value thing it can afford
const mult = 1;
while (t < 20 * 60) {
  goals += (cps + click * 4) * mult; t++;
  for (const it of ITEMS) { const c = itemCost(it, owned[it.id] || 0); if (goals >= c * 1.0 && (it.cps ? cps / (it.cps) < 1e9 : true)) { if (it.id === 'boot' && (owned.boot || 0) >= 12) continue; goals -= c; owned[it.id] = (owned[it.id] || 0) + 1; if (it.cps) cps += it.cps; if (it.click) click += it.click; } }
}
const total = coinsForScore(goals * 2);
console.log('20 min bot total ~', Math.round(goals), 'goals-in-hand; coins ~', total);
assert.ok(total >= 4 && total <= 60);
console.log('clicker rules OK');
