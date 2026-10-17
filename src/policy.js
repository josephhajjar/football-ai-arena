// Loads and validates a player's weights file and runs it as a small MLP.
//
// File format ("football-ai-v1"):
// {
//   "format": "football-ai-v1",
//   "agents": [ NET, NET ]           // 1 or 2 networks. If only 1, it controls both cubes.
// }
// NET = { "layers": [ { "w": [[...in numbers...], ...out rows...], "b": [...out numbers...], "act": "tanh"|"relu"|"linear" }, ... ] }
// w is shaped [out][in] (same as PyTorch nn.Linear.weight).
// First layer in = 46 (or the legacy 33: the extra effect inputs are simply not given to the network).
// Last layer out = 5 (or the legacy 3: kick angle / strength then use their defaults).

import { CONFIG as C, OBS_SIZE, ACT_SIZE, LEGACY_OBS_SIZE, LEGACY_ACT_SIZE } from './config.js';

export const FORMAT = 'football-ai-v1';
const ACTS = { tanh: Math.tanh, relu: (x) => (x > 0 ? x : 0), linear: (x) => x };

export function validateWeights(json) {
  const errors = [];
  if (!json || typeof json !== 'object') return { ok: false, errors: ['File is not a JSON object'] };
  if (json.format !== FORMAT) errors.push(`"format" must be "${FORMAT}"`);
  if (!Array.isArray(json.agents) || json.agents.length < 1 || json.agents.length > 2) {
    errors.push('"agents" must be an array with 1 or 2 networks');
    return { ok: false, errors };
  }
  json.agents.forEach((net, ni) => {
    const tag = `agents[${ni}]`;
    if (!net || !Array.isArray(net.layers) || net.layers.length < 1 || net.layers.length > C.MAX_LAYERS) {
      errors.push(`${tag}.layers must be an array of 1..${C.MAX_LAYERS} layers`); return;
    }
    let prev = null, params = 0;
    net.layers.forEach((L, li) => {
      const t = `${tag}.layers[${li}]`;
      if (li === 0) {
        const r0 = L && Array.isArray(L.w) && Array.isArray(L.w[0]) ? L.w[0].length : -1;
        if (r0 !== OBS_SIZE && r0 !== LEGACY_OBS_SIZE) { errors.push(`${t}: input size must be ${OBS_SIZE} (or legacy ${LEGACY_OBS_SIZE}), got ${r0}`); prev = -1; return; }
        prev = r0;
      }
      if (prev === -1) return;
      if (!L || !Array.isArray(L.w) || !Array.isArray(L.b)) { errors.push(`${t} needs "w" and "b" arrays`); return; }
      const out = L.w.length;
      if (out < 1 || out > C.MAX_WIDTH) { errors.push(`${t}: output size ${out} must be 1..${C.MAX_WIDTH}`); return; }
      if (L.b.length !== out) errors.push(`${t}: "b" has ${L.b.length} entries but "w" has ${out} rows`);
      if (typeof L.act !== 'string' || !Object.hasOwn(ACTS, L.act)) errors.push(`${t}: "act" must be tanh, relu or linear`);
      for (let r = 0; r < out; r++) {
        const row = L.w[r];
        if (!Array.isArray(row) || row.length !== prev) { errors.push(`${t}: row ${r} must have ${prev} numbers (layer input size)`); return; }
        for (let k = 0; k < row.length; k++) if (typeof row[k] !== 'number' || !Number.isFinite(row[k])) { errors.push(`${t}: w[${r}][${k}] is not a finite number`); return; }
      }
      for (const v of L.b) if (typeof v !== 'number' || !Number.isFinite(v)) { errors.push(`${t}: bias contains a non-finite number`); return; }
      params += out * prev + out; prev = out;
    });
    if (prev !== -1 && prev !== ACT_SIZE && prev !== LEGACY_ACT_SIZE) errors.push(`${tag}: last layer must output ${ACT_SIZE} values (or legacy ${LEGACY_ACT_SIZE}), got ${prev}`);
    if (params > C.MAX_PARAMS) errors.push(`${tag}: ${params} parameters exceeds the limit of ${C.MAX_PARAMS}`);
  });
  return { ok: errors.length === 0, errors: errors.slice(0, 10) };
}

export class MlpPolicy {
  constructor(net) {
    this.layers = net.layers.map((L) => ({
      w: L.w.map((r) => Float64Array.from(r)), b: Float64Array.from(L.b), act: ACTS[L.act], n: L.w.length,
    }));
  }
  // obs: Float64Array(46) -> [moveX, moveZ, kick, angle, strength] (or 3 values for legacy nets), each clamped to [-1, 1]
  act(obs) {
    let x = obs;
    for (const L of this.layers) {
      const y = new Float64Array(L.n);
      for (let r = 0; r < L.n; r++) {
        const row = L.w[r]; let s = L.b[r];
        for (let k = 0; k < row.length; k++) s += row[k] * x[k];
        y[r] = L.act(s);
      }
      x = y;
    }
    const n = x.length, o = new Array(n);
    for (let k = 0; k < n; k++) { const v = x[k]; o[k] = Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0; }
    return o;
  }
}

// Returns [policy, policy] for a validated weights file.
export function policiesFromWeights(json) {
  const nets = json.agents.map((n) => new MlpPolicy(n));
  return [nets[0], nets[1] || new MlpPolicy(json.agents[0])];
}

// Builds a random (untrained) weights file; handy for tests and as a format example.
export function randomWeights(rand = Math.random, hidden = [32, 32], inSize = OBS_SIZE, outSize = ACT_SIZE) {
  const mk = () => {
    const sizes = [inSize, ...hidden, outSize], layers = [];
    for (let l = 0; l < sizes.length - 1; l++) {
      const s = Math.sqrt(1 / sizes[l]);
      layers.push({
        w: Array.from({ length: sizes[l + 1] }, () => Array.from({ length: sizes[l] }, () => (rand() * 2 - 1) * s)),
        b: new Array(sizes[l + 1]).fill(0),
        act: 'tanh',
      });
    }
    return { layers };
  };
  return { format: FORMAT, agents: [mk(), mk()] };
}
