// node test/server_test.js  - end-to-end room flow against a running server (default http://localhost:3000)
import fs from 'node:fs';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
const base = process.env.BASE || 'http://localhost:3000';
const post = async (p, b) => { const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, body: await r.json() }; };
const get = async (p) => (await fetch(base + p)).json();
const w = JSON.parse(fs.readFileSync(new URL('../examples/example_weights.json', import.meta.url)));

const a = (await post('/api/rooms', { name: 'Jojo' })).body;
let st = await get(`/api/rooms/${a.code}/state?token=${a.token}`);
assert.equal(st.phase, 'lobby');
assert.equal((await post(`/api/rooms/${a.code}/start`, { token: a.token })).status, 409, 'cannot start alone');
const b = (await post(`/api/rooms/${a.code}/join`, { name: 'Friend' })).body;
assert.equal(b.side, 'red');
assert.equal((await post(`/api/rooms/${a.code}/join`, { name: 'Third' })).status, 409, 'room full');
assert.equal((await post(`/api/rooms/${a.code}/upload`, { token: a.token, weights: w })).status, 409, 'upload before start');
assert.equal((await post(`/api/rooms/${a.code}/start`, { token: b.token })).status, 403, 'guest cannot start');
assert.equal((await post(`/api/rooms/${a.code}/start`, { token: a.token, minutes: 5 })).status, 200);
const bad = await post(`/api/rooms/${a.code}/upload`, { token: a.token, weights: { format: 'nope' } });
assert.equal(bad.status, 422); assert.ok(bad.body.details.length);
assert.equal((await post(`/api/rooms/${a.code}/upload`, { token: a.token, weights: w, lock: true })).status, 200);
st = await get(`/api/rooms/${a.code}/state?token=${b.token}`);
assert.equal(st.phase, 'training'); assert.equal(st.blue.locked, true); assert.equal(st.red.uploaded, false);
assert.equal(st.blue.summary, undefined, 'opponent file details are hidden');
assert.equal((await post(`/api/rooms/${a.code}/upload`, { token: b.token, weights: w, lock: true })).status, 200);
st = await get(`/api/rooms/${a.code}/state?token=${b.token}`);
assert.equal(st.phase, 'playing'); assert.ok(st.result.startAt > Date.now());
const rep = await fetch(`${base}/api/rooms/${a.code}/replay`);
const series = await rep.json();
console.log('series', series.wins, 'matches', series.matches.length, 'startAt in', st.result.startAt - Date.now(), 'ms');
assert.ok(series.matches.length >= 2);
const zip = await fetch(base + '/kit.zip'); const buf = Buffer.from(await zip.arrayBuffer());
fs.writeFileSync(new URL('../examples/_kit_test.zip', import.meta.url), buf);
console.log('kit.zip bytes', buf.length, 'EOCD ok', buf.readUInt32LE(buf.length - 22) === 0x06054b50);
const rules = await (await fetch(base + '/RULES.md')).text(); assert.ok(rules.includes('football-ai-v1'));
assert.equal((await fetch(base + '/src/../package.json')).status === 200, false, 'traversal blocked');
// --- regression checks for bugs found in the audit ---
const h = (await post('/api/rooms', { name: 'Host' })).body;
const again = (await post(`/api/rooms/${h.code}/join`, { name: 'Host', token: h.token })).body;
assert.equal(again.side, 'blue', 'host reconnect must not take the red seat');
const c = (await post('/api/rooms', { name: 'C' })).body, d = (await post(`/api/rooms/${c.code}/join`, { name: 'D' })).body;
await post(`/api/rooms/${c.code}/start`, { token: c.token, minutes: 5 });
await post(`/api/rooms/${c.code}/upload`, { token: c.token, weights: w, lock: true });
await post(`/api/rooms/${c.code}/upload`, { token: c.token, weights: w });
assert.equal((await get(`/api/rooms/${c.code}/state?token=${c.token}`)).blue.locked, false, 're-upload clears lock');
const evil = structuredClone(w); evil.agents[0].layers[0].act = 'toString';
assert.equal((await post(`/api/rooms/${c.code}/upload`, { token: d.token, weights: evil })).status, 422, 'prototype act name rejected');
for (const bad of ['/src/%2e%2e/server/server.js', '/src/..%2fserver%2fserver.js', '/..%2fserver%2fserver.js', '/src/%252e%252e/package.json']) {
  const r = await fetch(base + bad); assert.ok(r.status === 403 || r.status === 404, `traversal ${bad} -> ${r.status}`);
}
assert.equal((await fetch(base + '/src/sim.js')).status, 200);
const st2 = await get(`/api/rooms/${c.code}/state?token=${c.token}`); assert.equal(st2.blue.online, true);
console.log('server flow OK');
void zlib;
