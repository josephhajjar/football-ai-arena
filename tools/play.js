// Play a local test series and write a replay you can open in the viewer.
//   node tools/play.js blue.json red.json            two weights files
//   node tools/play.js blue.json bot:chaser          vs a built-in bot (idle | random | chaser)
//   options: --out replay.json   --seed 42   --single (one match only)
import fs from 'node:fs';
import { validateWeights, policiesFromWeights } from '../src/policy.js';
import { makeBot } from '../src/bots.js';
import { makeRng } from '../src/rng.js';
import { runSeries } from '../src/match.js';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const out = flag('--out', 'replay.json');
const seed = Number(flag('--seed', 1));
const single = args.includes('--single'); if (single) args.splice(args.indexOf('--single'), 1);
const [a, b] = args;
if (!a || !b) { console.error('usage: node tools/play.js <blue.json|bot:name> <red.json|bot:name> [--out replay.json] [--seed N] [--single]'); process.exit(2); }

const rng = makeRng(seed);
function load(spec) {
  if (spec.startsWith('bot:')) return () => makeBot(spec.slice(4), rng);
  const json = JSON.parse(fs.readFileSync(spec, 'utf8'));
  const v = validateWeights(json);
  if (!v.ok) { console.error(`${spec} is invalid:\n  - ${v.errors.join('\n  - ')}`); process.exit(1); }
  return () => policiesFromWeights(json);
}
const shortName = (s) => (s.startsWith('bot:') ? 'Bot ' + s.slice(4) : s.split(/[\\/]/).pop().replace(/\.json$/, '').slice(0, 14));
const mkBlue = load(a), mkRed = load(b);
const t = Date.now();
const res = runSeries(() => ({ blue: mkBlue(), red: mkRed() }), seed, single ? { winsNeeded: 1, maxMatches: 1 } : {});
res.matches.forEach((m, i) => console.log(`match ${i + 1}: blue ${m.score[0]} - ${m.score[1]} red  (${m.seconds}s${m.overtime ? ', overtime' : ''})`));
console.log(`series: blue ${res.wins[0]} - ${res.wins[1]} red  =>`, res.winner < 0 ? 'DRAW' : res.winner === 0 ? 'BLUE wins' : 'RED wins', `(${Date.now() - t} ms)`);
fs.writeFileSync(out, JSON.stringify({ version: 1, names: { blue: shortName(a), red: shortName(b) }, ...res }));
console.log(`replay written to ${out}  (open the web viewer and use "Load replay file")`);
