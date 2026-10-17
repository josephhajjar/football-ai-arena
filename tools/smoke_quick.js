import { runMatch } from '../src/match.js';
import { makeBot } from '../src/bots.js';
import { makeRng } from '../src/rng.js';

const t = Date.now();
const rng = makeRng(5);
const m = runMatch({ blue: makeBot('chaser', rng), red: makeBot('idle', rng) }, 1);
console.log('chaser vs idle', m.score, 'winner', m.winner, 'sec', m.seconds, 'frames', m.frames.length, 'ms', Date.now() - t);
const m2 = runMatch({ blue: makeBot('chaser', rng), red: makeBot('chaser', rng) }, 2);
console.log('chaser vs chaser', m2.score, m2.seconds, 'ot', m2.overtime);
const m3 = runMatch({ blue: makeBot('random', rng), red: makeBot('idle', rng) }, 3);
console.log('random vs idle', m3.score, m3.seconds);
