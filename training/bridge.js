// Training bridge: exposes the exact same simulation used in real matches over stdin/stdout,
// one JSON object per line. football_env.py talks to this. You can also use it from any language.
//
// -> {"cmd":"reset","seed":1,"opponent":"chaser"|"idle"|"random"|"self"|"<weights.json path>","matchSeconds":120,"goalsToWin":5,"overtimeSeconds":0,"chaos":0}
//      chaos (0..1): how often random power-ups/hazards are fired at both teams during training (1 = about one every 3 s)
// <- {"obs":[[46],[46]],"obsRed":[[46],[46]],"info":{...}}
// -> {"cmd":"step","blue":[[mx,mz,kick,angle,strength],[...]],"red":[...],"powers":[{"team":0,"id":"bomb","x":3,"z":4}]}
//      "red" only needed when opponent is "self". "powers" is optional (ids: see POWERS in src/config.js).
// <- {"obs":..,"obsRed":..,"done":false,"winner":-1,"score":[0,0],"clock":1.0,"events":[...],"ball":[x,y,z],"players":[[x,z,vx,vz]x4]}
import fs from 'node:fs';
import readline from 'node:readline';
import { Game } from '../src/sim.js';
import { POWERS } from '../src/config.js';
import { makeBot } from '../src/bots.js';
import { makeRng } from '../src/rng.js';
import { validateWeights, policiesFromWeights } from '../src/policy.js';

let game = null, opp = null, oppMode = 'chaser', chaos = 0, chaosRng = makeRng(1);
const POWER_IDS = Object.keys(POWERS);
const rl = readline.createInterface({ input: process.stdin });
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const arr = (list) => list.map((a) => Array.from(a, (v) => Math.round(v * 1e6) / 1e6));

function buildOpponent(name, seed) {
  if (name === 'self') return null;
  if (['idle', 'random', 'chaser'].includes(name)) return makeBot(name, makeRng(seed + 99));
  const json = JSON.parse(fs.readFileSync(name, 'utf8'));
  const v = validateWeights(json);
  if (!v.ok) throw new Error('opponent weights invalid: ' + v.errors.join('; '));
  return policiesFromWeights(json);
}

rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return send({ error: 'bad json' }); }
  try {
    if (msg.cmd === 'reset') {
      const seed = msg.seed ?? Math.floor(Math.random() * 1e9);
      oppMode = msg.opponent ?? 'chaser';
      chaos = Math.max(0, Math.min(1, Number(msg.chaos) || 0)); chaosRng = makeRng(seed + 7);
      opp = buildOpponent(oppMode, seed);
      game = new Game({
        seed, matchSeconds: msg.matchSeconds, goalsToWin: msg.goalsToWin,
        overtimeSeconds: msg.overtimeSeconds ?? 0,
      });
      send({ obs: arr(game.obs(0)), obsRed: arr(game.obs(1)), info: { seed } });
    } else if (msg.cmd === 'step') {
      if (!game) return send({ error: 'call reset first' });
      const or = game.obs(1);
      const red = opp ? [opp[0].act(or[0]), opp[1].act(or[1])] : msg.red;
      if (!red) return send({ error: 'opponent is "self": pass "red" actions' });
      const pre = [];
      if (Array.isArray(msg.powers)) for (const p of msg.powers) { const r = game.applyPower(p.team ? 1 : 0, p.id, p); if (r.ok) pre.push(...r.events); }
      if (chaos > 0 && chaosRng() < chaos / 60 * 3) {            // ~chaos/20 per step => chaos=1: one effect per ~3 s
        const r = chaosRng, id = POWER_IDS[Math.floor(r() * POWER_IDS.length)];
        const res = game.applyPower(r() < 0.5 ? 0 : 1, id, { cube: r() < 0.5 ? 0 : 1, x: (r() * 2 - 1) * 26, z: (r() * 2 - 1) * 16 });
        if (res.ok) pre.push(...res.events);
      }
      const events = [...pre, ...game.step(msg.blue, red)];
      const b = game.ball;
      send({
        obs: arr(game.obs(0)), obsRed: arr(game.obs(1)), done: game.done, winner: game.winner,
        score: game.score.slice(), clock: game.clock, events, ball: [b.x, b.y, b.z],
        players: game.players.map((p) => [p.x, p.z, p.vx, p.vz]), fx: game.fxState(),
      });
    } else if (msg.cmd === 'close') {
      process.exit(0);
    } else send({ error: 'unknown cmd' });
  } catch (e) { send({ error: String(e.message || e) }); }
});
