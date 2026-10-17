// Scripted opponents. They only use the same observation vector an AI gets,
// so they are fair sparring partners while training.
import { CONFIG as C } from './config.js';

const HL = C.HALF_LENGTH, HW = C.HALF_WIDTH;

export const idleBot = { act: () => [0, 0, 0, 0, 0] };

export function randomBot(rng) {
  return { act: () => [rng() * 2 - 1, rng() * 2 - 1, rng() > 0.7 ? 1 : 0, rng() * 2 - 1, rng() * 2 - 1] };
}

function go(dx, dz) {
  const l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l];
}

// Agent 0 attacks: gets behind the ball (relative to the opponent goal) and pushes/kicks it forward.
// Agent 1 defends: stays between the ball and our goal, kicks the ball away when close.
export function chaserBot() {
  return {
    act(o) {
      const selfX = o[0] * HL, selfZ = o[1] * HW;
      const bdx = o[12] * 2 * HL, bdz = o[13] * 2 * HW;     // vector self -> ball
      const ballX = selfX + bdx, ballZ = selfZ + bdz;
      const kick = o[5] > 0.5 && o[4] === 0 ? 1 : 0;
      const attacker = o[32] === 0;
      if (attacker) {
        const gx = HL - ballX, gz = 0 - ballZ;
        const gl = Math.hypot(gx, gz) || 1;
        const tx = ballX - (gx / gl) * 1.8, tz = ballZ - (gz / gl) * 1.8;
        const dist = Math.hypot(bdx, bdz);
        if (dist < 2.6 && selfX < ballX + 0.5) return [...go(bdx, bdz), kick, -0.7, 1];
        return [...go(tx - selfX, tz - selfZ), kick, -0.7, 1];
      }
      const tx = Math.max(-HL + 6, Math.min(ballX - 2, 0)), tz = ballZ * 0.6;
      const dist = Math.hypot(bdx, bdz);
      if (dist < 6 && ballX < 5) return [...go(bdx, bdz), kick, 0.2, 1];   // defender clears with a lofted kick
      return [...go(tx - selfX, tz - selfZ), kick, 0.2, 1];
    },
  };
}

export const BOT_NAMES = ['idle', 'random', 'chaser'];

export function makeBot(name, rng) {
  if (name === 'idle') return [idleBot, idleBot];
  if (name === 'random') return [randomBot(rng), randomBot(rng)];
  if (name === 'chaser') return [chaserBot(), chaserBot()];
  throw new Error(`unknown bot "${name}"`);
}
