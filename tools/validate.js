// node tools/validate.js my_weights.json
import fs from 'node:fs';
import { validateWeights } from '../src/policy.js';

const file = process.argv[2];
if (!file) { console.error('usage: node tools/validate.js <weights.json>'); process.exit(2); }
let json;
try { json = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error('Cannot read/parse file:', e.message); process.exit(1); }
const v = validateWeights(json);
if (v.ok) {
  const sizes = json.agents.map((n) => n.layers.map((l) => l.w.length).join('-'));
  console.log(`OK  ${json.agents.length} network(s): ${json.agents.map((n, i) => n.layers[0].w[0].length + '-' + sizes[i]).join('  |  ')}`);
} else {
  console.error('INVALID weights file:'); v.errors.forEach((e) => console.error('  - ' + e)); process.exit(1);
}
