// Generates RULES.md from src/config.js so the document can never disagree with the game.
//   node tools/gen_rules.js            -> writes RULES.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG as C, POWERS, ECONOMY, OBS_SIZE, ACT_SIZE, LEGACY_OBS_SIZE, LEGACY_ACT_SIZE, OBS_LAYOUT, ACT_LAYOUT } from '../src/config.js';

export function buildRules() {
  const obsRows = OBS_LAYOUT.map(([i, d]) => `| ${i} | ${d} |`).join('\n');
  const actRows = ACT_LAYOUT.map(([i, d]) => `| ${i} | ${d} |`).join('\n');
  const powRows = Object.entries(POWERS).map(([id, p]) =>
    `| \`${id}\` | ${p.name} | ${p.kind === 'power' ? 'power-up (yours)' : 'hazard (vs enemy)'} | ${p.cost} | ${p.duration} s | ${p.target} | ${p.desc} |`).join('\n');
  const stepsPerSec = Math.round(1 / (C.DT * C.ACTION_REPEAT));
  return `# Football AI Arena - complete rules and training guide

> Paste this whole document to your AI assistant. It contains everything needed to train your two football AIs
> and to export them in the exact file format the game accepts.

## 1. What you are doing

Two players each train **2 AI cubes** (a team of 2) on their own computer for a fixed time (the room creator picks it, e.g. 20 min).
When the timer ends each player uploads **one weights file** (never code). The server then plays a series of matches between the
two teams **live** using fixed, identical physics. Whoever wins the series wins.

Everything is on the honour system between friends: train only inside the time limit, upload only the weights file.

While the AIs train, the humans can play short **minigames** in the browser to earn **coins** (this does not affect your AI's training).
During the live series the humans spend coins on **power-ups and hazards** (section 4). Your AI cannot buy anything, but it *sees* the
effects in its observation, so a good AI learns to react to bombs, shrinking goals and so on (section 7 explains how to train for it).

Teams: **BLUE** (room creator) and **RED** (guest). The arena is perfectly symmetric and the world is shown to every
AI rotated so that it **always attacks toward +x**, so the same AI works for either colour.

## 2. What you upload (the deliverable)

A single JSON file, format \`football-ai-v1\`:

\`\`\`json
{
  "format": "football-ai-v1",
  "agents": [
    { "layers": [ { "w": [[/* ${OBS_SIZE} numbers */], "...one row per output neuron"], "b": ["one bias per output neuron"], "act": "tanh" },
                  { "w": [[...]], "b": [...], "act": "tanh" } ] },
    { "layers": [ ... ] }
  ]
}
\`\`\`

- \`agents\` holds **1 or 2** networks. Network 0 drives cube 0, network 1 drives cube 1. With only 1 network it drives both cubes
  (the observation contains the cube index so one network can still play two roles).
- Each network is a plain feed-forward MLP (**no recurrence / no memory**, it only sees the current observation).
- Layer \`w\` has shape **[out][in]** (the same as PyTorch \`nn.Linear.weight\`). \`act\` is \`"tanh"\`, \`"relu"\` or \`"linear"\`.
- First layer input size = **${OBS_SIZE}**. Last layer output size = **${ACT_SIZE}**. Outputs are clamped to [-1, 1] by the game.
- **Older files still work:** a network with ${LEGACY_OBS_SIZE} inputs only receives the first ${LEGACY_OBS_SIZE} observation numbers (no effect info),
  and a network with ${LEGACY_ACT_SIZE} outputs (move_x, move_z, kick) kicks with the default low angle (${C.KICK_DEFAULT_ELEVATION} deg) at full strength.
- Limits per network: at most **${C.MAX_LAYERS} layers**, each layer at most **${C.MAX_WIDTH} wide**, at most **${C.MAX_PARAMS} parameters** in total.
- Helper to write the file: \`training/export_weights.py\` (\`export_torch\` or \`export_numpy\`).
- Check it before uploading: \`node tools/validate.js my_weights.json\` (the upload page also validates it).

## 3. The arena (identical for everyone, never changes)

Units are metres and seconds. Axes: **x = pitch length, z = pitch width, y = up**. Pitch centre is (0, 0, 0).

| Constant | Value |
|---|---|
| Pitch length x | from -${C.HALF_LENGTH} to +${C.HALF_LENGTH} (${C.HALF_LENGTH * 2} m) |
| Pitch width z | from -${C.HALF_WIDTH} to +${C.HALF_WIDTH} (${C.HALF_WIDTH * 2} m) |
| Corners | all four rounded with radius ${C.CORNER_RADIUS} m (nothing can wedge in a corner) |
| Invisible walls | around the whole pitch, infinitely high up to an invisible ceiling at y = ${C.CEILING} |
| Goal mouth | centred on each end line, ${C.GOAL_HALF_WIDTH * 2} m wide (z in [-${C.GOAL_HALF_WIDTH}, ${C.GOAL_HALF_WIDTH}]) normally, ${C.GOAL_HEIGHT} m high, net pocket ${C.GOAL_DEPTH} m deep. Power-ups can widen/narrow the width temporarily |
| Blue goal (blue defends) | at x = -${C.HALF_LENGTH} |
| Red goal (red defends) | at x = +${C.HALF_LENGTH} |
| Cube | ${C.PLAYER_HALF * 2} m wide, ${C.PLAYER_HEIGHT} m tall, collision radius ${C.PLAYER_RADIUS} m. Cubes stay on the ground (they cannot jump) |
| Ball | sphere, radius ${C.BALL_RADIUS} m. It rolls and bounces in 3D (gravity ${C.GRAVITY} m/s^2), floor bounce ${C.BALL_FLOOR_BOUNCE}, speed cap ${C.BALL_MAX_SPEED} m/s |
| Cube speed | up to ${C.MAX_SPEED} m/s, acceleration ${C.ACCEL} m/s^2 (they have a little inertia, they do not turn instantly) |
| Decision rate | physics runs at ${Math.round(1 / C.DT)} Hz; your AI picks an action every ${C.ACTION_REPEAT} physics steps = **${stepsPerSec} decisions per second** (the action is held in between) |

### Kicking (angle + strength)

A kick needs the ball within ${C.KICK_REACH} m of the cube surface (and low enough to reach). The ball always flies **away from the cube**
(horizontal direction cube -> ball). Your AI chooses two more things with every kick:

- **angle**: ${0}..${C.KICK_MAX_ELEVATION} degrees above the ground (output -1 = flat, +1 = ${C.KICK_MAX_ELEVATION} deg). It can never be higher than ${C.KICK_MAX_ELEVATION} deg, so the ball can't get stuck going straight up.
- **strength**: ball speed ${C.KICK_MIN_SPEED}..${C.KICK_SPEED} m/s (output -1 = weakest, +1 = strongest). A weak kick also recovers faster:
  cooldown ${C.KICK_COOLDOWN_MIN} s (weakest) to ${C.KICK_COOLDOWN} s (strongest).
- Horizontal ball velocity = speed * cos(angle) (+30% of the cube's own velocity), vertical = speed * sin(angle).
- A flat strong kick is a shot; a high medium kick is a lob over defenders; a soft kick is a pass or a dribble nudge.

Collision behaviour:
- Cubes bump each other and the walls; the ball is bounced by cubes (cube velocity adds to it, so dribbling and pushing work) and walls (bounce ${C.BALL_WALL_BOUNCE}).
- **No pinning:** if the ball is squeezed between a cube and a wall, the cube is pushed out of the way instead. If it is still trapped it is popped toward the centre of the pitch.
- **No stalling:** if the ball moves less than 1 m for ${C.STALL_SECONDS} s it is re-spawned at the centre (kickoff positions reset).
- Cubes cannot enter the goal nets. Only the ball can.

Scoring: a goal counts when the whole ball crosses the end line **inside the goal mouth** (below the ${C.GOAL_HEIGHT} m bar). Blue scores in the RED goal (x = +${C.HALF_LENGTH}); red scores in the BLUE goal (x = -${C.HALF_LENGTH}).
After each goal there is a ${C.GOAL_PAUSE_SECONDS} s celebration pause (not counted on the clock), then everyone resets to kickoff positions (small random jitter of the spawn spots; bombs and mud pits are removed).
Kickoff: ball at centre with a tiny random nudge. Blue cubes start on the left half (x = -${C.SPAWN_X}), red on the right (x = +${C.SPAWN_X}), z = +-${C.SPAWN_Z}.

## 4. Power-ups and hazards (bought by the humans with coins)

During the live series each human has a coin balance and can buy the items below at any time while play is running (not during the goal
celebration). Coins come from minigames played during training, plus ${ECONOMY.GOAL} coins per goal, ${ECONOMY.MATCH_WIN} per match win, and +1 every ${ECONOMY.PASSIVE_EVERY_SECONDS} s of play.
Purchase limits: ${ECONOMY.GLOBAL_COOLDOWN} s between any two purchases, ${ECONOMY.SAME_COOLDOWN} s before the same item again.
"ownCube"/"enemyCube" means the human picks which of the two cubes; "point" means they click a spot on the pitch.

| id | Name | Type | Cost | Duration | Target | Effect |
|---|---|---|---|---|---|---|
${powRows}

Details: Turbo also raises acceleration 1.5x. Mud: cubes inside the circle (radius ${C.MUD_RADIUS} m) move at ${C.MUD_SPEED_FACTOR}x and the ball rolling in it
drags heavily. Bomb: blast radius ${C.BOMB_RADIUS} m, shoves cubes up to ${C.BOMB_CUBE_IMPULSE} m/s (heavy cubes 20%) and stuns them (reduced steering for ${C.BOMB_STUN} s),
and sends the ball away at up to ${C.BOMB_BALL_IMPULSE} m/s with ${C.BOMB_BALL_LIFT} m/s of lift. Walls, the ceiling and the no-pinch rule still apply, so nothing leaves the map.
Goal width factors stack multiplicatively (clamped to 0.4x..2.2x). Max ${C.MAX_BOMBS} bombs and ${C.MAX_MUD} mud pits at a time.

## 5. Match and series rules

- A **match** lasts ${C.MATCH_SECONDS} s of game clock, or ends immediately when a team reaches **${C.GOALS_TO_WIN} goals**.
- Tied at full time: **sudden-death overtime** of up to ${C.OVERTIME_SECONDS} s (next goal wins). Still tied: the match is a draw.
- A **series** is repeated matches; first to **${C.SERIES_WINS_NEEDED} match wins** takes the series. After ${C.SERIES_MAX_MATCHES} matches with no winner the series is a draw.
- Matches run live on the server in real time. Every match uses a different random seed.
- If a player uploads nothing, their team just stands still.

## 6. What your AI sees: the observation (${OBS_SIZE} numbers per cube)

Every value is a float. Everything is expressed in the team's **own frame** (red's world is rotated 180 degrees so red also attacks +x; x and z both flip).
Each cube gets its own vector (so a team gets 2 vectors per decision; they differ in the "self" and "teammate" parts and in index 32).

| Index | Meaning |
|---|---|
${obsRows}

Constants used in the scalings: HALF_LENGTH = ${C.HALF_LENGTH}, HALF_WIDTH = ${C.HALF_WIDTH}, MAX_SPEED = ${C.MAX_SPEED}, KICK_COOLDOWN = ${C.KICK_COOLDOWN}, GOALS_TO_WIN = ${C.GOALS_TO_WIN}, GOAL_HALF_WIDTH = ${C.GOAL_HALF_WIDTH}, BOMB_FUSE = ${C.BOMB_FUSE}.
"Opponent 0/1" are the two enemy cubes in a fixed order (their agent index 0 and 1). Indices ${LEGACY_OBS_SIZE}-${OBS_SIZE - 1} are all "neutral" (1.0 / 0.0) when no effect is active.

## 7. What your AI outputs: the action (${ACT_SIZE} numbers per cube)

| Index | Meaning |
|---|---|
${actRows}

The (move_x, move_z) vector is clipped to length 1, then scaled by the cube's current max speed. Movement is smoothed by the acceleration limit.

## 8. The training environment (same physics as the real match)

Requirements: Node.js 18+ (the simulator) and Python 3 with numpy (gymnasium optional). Folder layout is in this kit:
\`src/\` (simulator, used by everything), \`training/\` (environment + export helpers), \`tools/\` (validate + local match).

\`\`\`python
import sys; sys.path.insert(0, "training")
from football_env import FootballEnv

env = FootballEnv(opponent="chaser", chaos=0.0)   # opponent: "idle" | "random" | "chaser" | "self" | "some_weights.json"
obs, info = env.reset(seed=0)                    # obs.shape == (2, ${OBS_SIZE})  (row = cube 0, cube 1 of YOUR team)
obs, reward, done, truncated, info = env.step(action)   # action.shape == (2, ${ACT_SIZE}), values in [-1, 1]
# info: events (goal/kick/touch/power/explode...), score [blue, red], winner, clock, ball [x,y,z],
#       players [[x,z,vx,vz] x4], fx (goal widths, bombs, mud, cube effect bits), obs_opp
env.use_power(1, "bomb", x=3.0, z=-2.0)         # queue an effect for the next step (team 0 = you, 1 = opponent)
\`\`\`

- Your team is always the one the env controls and it always attacks +x in the observation (the env plays you as blue; that is equivalent to red).
- **Self-play:** \`FootballEnv(opponent="self")\`, then \`env.step(my_action, opponent_action)\` where the opponent's observation is \`info["obs_opp"]\` (also in its own frame, attacking +x).
- **Chaos (recommended for the second half of training):** \`chaos=0.3\` fires random power-ups/hazards at both teams so your AI learns to dodge bombs, avoid mud,
  and keep scoring when a goal changes size. \`chaos=1\` is about one effect every 3 s. In the real series the effects are chosen by humans and are usually
  aimed at the moment they hurt most.
- **Reward:** \`reward_fn(prev, cur, events)\` is replaceable (\`FootballEnv(reward_fn=...)\`). The default is shaped: +10 goal, -10 conceded, +0.02 per ball touch, and ball progress toward +x.
- Speed: about 6,000 environment steps/s per process (each step = ${C.ACTION_REPEAT} physics ticks = 1/${stepsPerSec} s of game time). Run several processes/envs in parallel for more.
- Episode: \`env.reset(seed)\` starts a ${C.MATCH_SECONDS} s match (\`match_seconds=...\` shortens it, handy for training). \`done\` is True when the match ends.
- Non-Python? \`node training/bridge.js\` speaks JSON lines on stdin/stdout (see the header of that file). Or import \`src/sim.js\` directly in JS (\`new Game(...)\`, \`game.obs(team)\`, \`game.step(blueActions, redActions)\`, \`game.applyPower(team, id, {cube, x, z})\`).
- A tiny working example (evolution strategies, numpy only): \`python training/example_train_es.py --minutes 2 --out my_weights.json\`.

Export and test locally:
\`\`\`
python -c "from export_weights import export_torch; export_torch([net0, net1], 'my_weights.json')"   # run from training/
node tools/validate.js my_weights.json
node tools/play.js my_weights.json bot:chaser            # plays a whole series, prints scores, writes replay.json
\`\`\`
(replay.json can be loaded in the web viewer with "Load replay file" to watch it in 3D.)

## 9. Practical advice for a strong AI

- Start by beating \`chaser\`, then switch to self-play (against older copies of yourself) so you do not overfit one opponent.
- Use the shaped reward early (ball progress, touches) and make goals dominate the reward later.
- Use the kick controls: a strong flat kick when you have a clear shot, a soft touch to dribble, a lob (angle ~ +0.3 to +0.7) to clear the ball over opponents.
  Output the angle and strength **only matter on the step you kick** (kick > 0.5), so they can be learned with the same reward.
- Remember the two cubes have different roles: use observation index 32 (cube index) and the teammate vector to split attacker/defender.
- Networks are feed-forward and stateless. Keep them small (e.g. 2 hidden layers of 32-128); they run ${stepsPerSec} times per second per cube.
- Train with randomised seeds (different kickoffs). The real series uses unseen seeds.
- Make sure the final file passes \`node tools/validate.js\`. Upload before the timer + ${60} s grace ends. Uploading early and pressing **Lock in** ends the wait if your opponent has locked in too.
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'RULES.md');
  fs.writeFileSync(out, buildRules());
  console.log('wrote', out);
}
