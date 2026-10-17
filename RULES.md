# Football AI Arena - complete rules and training guide

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

A single JSON file, format `football-ai-v1`:

```json
{
  "format": "football-ai-v1",
  "agents": [
    { "layers": [ { "w": [[/* 46 numbers */], "...one row per output neuron"], "b": ["one bias per output neuron"], "act": "tanh" },
                  { "w": [[...]], "b": [...], "act": "tanh" } ] },
    { "layers": [ ... ] }
  ]
}
```

- `agents` holds **1 or 2** networks. Network 0 drives cube 0, network 1 drives cube 1. With only 1 network it drives both cubes
  (the observation contains the cube index so one network can still play two roles).
- Each network is a plain feed-forward MLP (**no recurrence / no memory**, it only sees the current observation).
- Layer `w` has shape **[out][in]** (the same as PyTorch `nn.Linear.weight`). `act` is `"tanh"`, `"relu"` or `"linear"`.
- First layer input size = **46**. Last layer output size = **5**. Outputs are clamped to [-1, 1] by the game.
- **Older files still work:** a network with 33 inputs only receives the first 33 observation numbers (no effect info),
  and a network with 3 outputs (move_x, move_z, kick) kicks with the default low angle (8.5 deg) at full strength.
- Limits per network: at most **6 layers**, each layer at most **256 wide**, at most **40000 parameters** in total.
- Helper to write the file: `training/export_weights.py` (`export_torch` or `export_numpy`).
- Check it before uploading: `node tools/validate.js my_weights.json` (the upload page also validates it).

## 3. The arena (identical for everyone, never changes)

Units are metres and seconds. Axes: **x = pitch length, z = pitch width, y = up**. Pitch centre is (0, 0, 0).

| Constant | Value |
|---|---|
| Pitch length x | from -30 to +30 (60 m) |
| Pitch width z | from -20 to +20 (40 m) |
| Corners | all four rounded with radius 7 m (nothing can wedge in a corner) |
| Invisible walls | around the whole pitch, infinitely high up to an invisible ceiling at y = 14 |
| Goal mouth | centred on each end line, 10 m wide (z in [-5, 5]) normally, 4 m high, net pocket 3 m deep. Power-ups can widen/narrow the width temporarily |
| Blue goal (blue defends) | at x = -30 |
| Red goal (red defends) | at x = +30 |
| Cube | 1.5 m wide, 1.5 m tall, collision radius 0.9 m. Cubes stay on the ground (they cannot jump) |
| Ball | sphere, radius 0.6 m. It rolls and bounces in 3D (gravity 20 m/s^2), floor bounce 0.55, speed cap 45 m/s |
| Cube speed | up to 9 m/s, acceleration 45 m/s^2 (they have a little inertia, they do not turn instantly) |
| Decision rate | physics runs at 60 Hz; your AI picks an action every 3 physics steps = **20 decisions per second** (the action is held in between) |

### Kicking (angle + strength)

A kick needs the ball within 0.5 m of the cube surface (and low enough to reach). The ball always flies **away from the cube**
(horizontal direction cube -> ball). Your AI chooses two more things with every kick:

- **angle**: 0..70 degrees above the ground (output -1 = flat, +1 = 70 deg). It can never be higher than 70 deg, so the ball can't get stuck going straight up.
- **strength**: ball speed 6..20 m/s (output -1 = weakest, +1 = strongest). A weak kick also recovers faster:
  cooldown 0.25 s (weakest) to 0.5 s (strongest).
- Horizontal ball velocity = speed * cos(angle) (+30% of the cube's own velocity), vertical = speed * sin(angle).
- A flat strong kick is a shot; a high medium kick is a lob over defenders; a soft kick is a pass or a dribble nudge.

Collision behaviour:
- Cubes bump each other and the walls; the ball is bounced by cubes (cube velocity adds to it, so dribbling and pushing work) and walls (bounce 0.7).
- **No pinning:** if the ball is squeezed between a cube and a wall, the cube is pushed out of the way instead. If it is still trapped it is popped toward the centre of the pitch.
- **No stalling:** if the ball moves less than 1 m for 8 s it is re-spawned at the centre (kickoff positions reset).
- Cubes cannot enter the goal nets. Only the ball can.

Scoring: a goal counts when the whole ball crosses the end line **inside the goal mouth** (below the 4 m bar). Blue scores in the RED goal (x = +30); red scores in the BLUE goal (x = -30).
After each goal there is a 1.5 s celebration pause (not counted on the clock), then everyone resets to kickoff positions (small random jitter of the spawn spots; bombs and mud pits are removed).
Kickoff: ball at centre with a tiny random nudge. Blue cubes start on the left half (x = -12), red on the right (x = +12), z = +-6.

## 4. Power-ups and hazards (bought by the humans with coins)

During the live series each human has a coin balance and can buy the items below at any time while play is running (not during the goal
celebration). Coins come from minigames played during training, plus 10 coins per goal, 15 per match win, and +1 every 3 s of play.
Purchase limits: 1.2 s between any two purchases, 3 s before the same item again.
"ownCube"/"enemyCube" means the human picks which of the two cubes; "point" means they click a spot on the pitch.

| id | Name | Type | Cost | Duration | Target | Effect |
|---|---|---|---|---|---|---|
| `speed` | Turbo | power-up (yours) | 20 | 8 s | ownCube | Chosen cube runs 1.5x faster and accelerates faster. |
| `kick` | Power Boots | power-up (yours) | 25 | 10 s | ownCube | Chosen cube kicks 35% harder (hard cap 30 m/s). |
| `heavy` | Iron Cube | power-up (yours) | 25 | 8 s | ownCube | Chosen cube is 5x heavier: shoves others aside and mostly ignores bombs. |
| `smallgoal` | Tight Goal | power-up (yours) | 30 | 10 s | none | Your own goal gets 36% narrower. Still possible to score in. |
| `biggoal` | Wide Goal | hazard (vs enemy) | 30 | 10 s | none | The enemy goal gets 70% wider. |
| `bomb` | Bomb | hazard (vs enemy) | 25 | 2 s | point | Pick a spot: after a 2 s fuse it blasts cubes and the ball outward. |
| `mud` | Mud Pit | hazard (vs enemy) | 20 | 8 s | point | Pick a spot: cubes inside move at half speed and the ball drags. |
| `ice` | Ice Beam | hazard (vs enemy) | 25 | 5 s | enemyCube | Chosen enemy cube is slowed to 40% speed. |
| `invert` | Confusion | hazard (vs enemy) | 35 | 5 s | enemyCube | Chosen enemy cube's movement is reversed. |

Details: Turbo also raises acceleration 1.5x. Mud: cubes inside the circle (radius 5.5 m) move at 0.5x and the ball rolling in it
drags heavily. Bomb: blast radius 6.5 m, shoves cubes up to 17 m/s (heavy cubes 20%) and stuns them (reduced steering for 0.7 s),
and sends the ball away at up to 20 m/s with 7 m/s of lift. Walls, the ceiling and the no-pinch rule still apply, so nothing leaves the map.
Goal width factors stack multiplicatively (clamped to 0.4x..2.2x). Max 4 bombs and 3 mud pits at a time.

## 5. Match and series rules

- A **match** lasts 120 s of game clock, or ends immediately when a team reaches **5 goals**.
- Tied at full time: **sudden-death overtime** of up to 60 s (next goal wins). Still tied: the match is a draw.
- A **series** is repeated matches; first to **2 match wins** takes the series. After 5 matches with no winner the series is a draw.
- Matches run live on the server in real time. Every match uses a different random seed.
- If a player uploads nothing, their team just stands still.

## 6. What your AI sees: the observation (46 numbers per cube)

Every value is a float. Everything is expressed in the team's **own frame** (red's world is rotated 180 degrees so red also attacks +x; x and z both flip).
Each cube gets its own vector (so a team gets 2 vectors per decision; they differ in the "self" and "teammate" parts and in index 32).

| Index | Meaning |
|---|---|
| 0 | self x / HALF_LENGTH |
| 1 | self z / HALF_WIDTH |
| 2 | self vx / MAX_SPEED |
| 3 | self vz / MAX_SPEED |
| 4 | kick cooldown remaining / KICK_COOLDOWN (0 = ready) |
| 5 | 1 if the ball is close enough to kick right now (and height ok), else 0 |
| 6 | ball x / HALF_LENGTH |
| 7 | ball y / 10 (height above ground) |
| 8 | ball z / HALF_WIDTH |
| 9 | ball vx / 25 |
| 10 | ball vy / 25 |
| 11 | ball vz / 25 |
| 12 | (ball x - self x) / (2*HALF_LENGTH) |
| 13 | (ball z - self z) / (2*HALF_WIDTH) |
| 14 | teammate: (x - self x) / (2*HALF_LENGTH) |
| 15 | teammate: (z - self z) / (2*HALF_WIDTH) |
| 16 | teammate: vx / MAX_SPEED |
| 17 | teammate: vz / MAX_SPEED |
| 18 | opponent 0: relative x (same scaling as teammate) |
| 19 | opponent 0: relative z |
| 20 | opponent 0: vx / MAX_SPEED |
| 21 | opponent 0: vz / MAX_SPEED |
| 22 | opponent 1: relative x |
| 23 | opponent 1: relative z |
| 24 | opponent 1: vx / MAX_SPEED |
| 25 | opponent 1: vz / MAX_SPEED |
| 26 | (opponent goal centre x - self x) / (2*HALF_LENGTH); opponent goal centre is (+HALF_LENGTH, 0) |
| 27 | (opponent goal centre z - self z) / (2*HALF_WIDTH) |
| 28 | (own goal centre x - self x) / (2*HALF_LENGTH); own goal centre is (-HALF_LENGTH, 0) |
| 29 | (own goal centre z - self z) / (2*HALF_WIDTH) |
| 30 | fraction of regulation time remaining (1 -> 0, stays 0 in overtime) |
| 31 | (own goals - opponent goals) / GOALS_TO_WIN |
| 32 | agent index of this cube in your team (0 or 1) |
| 33 | own goal half-width / GOAL_HALF_WIDTH (1 = normal, <1 narrowed by Tight Goal) |
| 34 | enemy goal half-width / GOAL_HALF_WIDTH (1 = normal, >1 widened by Wide Goal) |
| 35 | self speed multiplier (1 normal, 1.5 Turbo, 0.4 Ice Beam, 0.5 in Mud; they multiply) |
| 36 | self kick power multiplier (1 normal, 1.35 Power Boots) |
| 37 | 1 if self is an Iron Cube (heavy), else 0 |
| 38 | 1 if self movement is reversed by Confusion, else 0 |
| 39 | 1 if self is inside a Mud Pit, else 0 |
| 40 | nearest bomb: (x - self x) / (2*HALF_LENGTH)  (0 if no bomb) |
| 41 | nearest bomb: (z - self z) / (2*HALF_WIDTH)    (0 if no bomb) |
| 42 | nearest bomb: fuse remaining / BOMB_FUSE (0 if no bomb) |
| 43 | 2nd nearest bomb: relative x (same scaling) |
| 44 | 2nd nearest bomb: relative z |
| 45 | 2nd nearest bomb: fuse remaining / BOMB_FUSE |

Constants used in the scalings: HALF_LENGTH = 30, HALF_WIDTH = 20, MAX_SPEED = 9, KICK_COOLDOWN = 0.5, GOALS_TO_WIN = 5, GOAL_HALF_WIDTH = 5, BOMB_FUSE = 2.
"Opponent 0/1" are the two enemy cubes in a fixed order (their agent index 0 and 1). Indices 33-45 are all "neutral" (1.0 / 0.0) when no effect is active.

## 7. What your AI outputs: the action (5 numbers per cube)

| Index | Meaning |
|---|---|
| 0 | move_x in [-1, 1] (+1 = toward the enemy goal) |
| 1 | move_z in [-1, 1] |
| 2 | kick: fires when > 0.5 (ball in reach and cooldown 0) |
| 3 | kick angle in [-1, 1]: maps linearly to 0..70 degrees above the ground (-1 = flat, +1 = 70 deg). Direction left/right is always away from your cube. |
| 4 | kick strength in [-1, 1]: maps linearly to a ball speed of 6..20 m/s (and a cooldown of 0.25..0.5 s) |

The (move_x, move_z) vector is clipped to length 1, then scaled by the cube's current max speed. Movement is smoothed by the acceleration limit.

## 8. The training environment (same physics as the real match)

Requirements: Node.js 18+ (the simulator) and Python 3 with numpy (gymnasium optional). Folder layout is in this kit:
`src/` (simulator, used by everything), `training/` (environment + export helpers), `tools/` (validate + local match).

```python
import sys; sys.path.insert(0, "training")
from football_env import FootballEnv

env = FootballEnv(opponent="chaser", chaos=0.0)   # opponent: "idle" | "random" | "chaser" | "self" | "some_weights.json"
obs, info = env.reset(seed=0)                    # obs.shape == (2, 46)  (row = cube 0, cube 1 of YOUR team)
obs, reward, done, truncated, info = env.step(action)   # action.shape == (2, 5), values in [-1, 1]
# info: events (goal/kick/touch/power/explode...), score [blue, red], winner, clock, ball [x,y,z],
#       players [[x,z,vx,vz] x4], fx (goal widths, bombs, mud, cube effect bits), obs_opp
env.use_power(1, "bomb", x=3.0, z=-2.0)         # queue an effect for the next step (team 0 = you, 1 = opponent)
```

- Your team is always the one the env controls and it always attacks +x in the observation (the env plays you as blue; that is equivalent to red).
- **Self-play:** `FootballEnv(opponent="self")`, then `env.step(my_action, opponent_action)` where the opponent's observation is `info["obs_opp"]` (also in its own frame, attacking +x).
- **Chaos (recommended for the second half of training):** `chaos=0.3` fires random power-ups/hazards at both teams so your AI learns to dodge bombs, avoid mud,
  and keep scoring when a goal changes size. `chaos=1` is about one effect every 3 s. In the real series the effects are chosen by humans and are usually
  aimed at the moment they hurt most.
- **Reward:** `reward_fn(prev, cur, events)` is replaceable (`FootballEnv(reward_fn=...)`). The default is shaped: +10 goal, -10 conceded, +0.02 per ball touch, and ball progress toward +x.
- Speed: about 6,000 environment steps/s per process (each step = 3 physics ticks = 1/20 s of game time). Run several processes/envs in parallel for more.
- Episode: `env.reset(seed)` starts a 120 s match (`match_seconds=...` shortens it, handy for training). `done` is True when the match ends.
- Non-Python? `node training/bridge.js` speaks JSON lines on stdin/stdout (see the header of that file). Or import `src/sim.js` directly in JS (`new Game(...)`, `game.obs(team)`, `game.step(blueActions, redActions)`, `game.applyPower(team, id, {cube, x, z})`).
- A tiny working example (evolution strategies, numpy only): `python training/example_train_es.py --minutes 2 --out my_weights.json`.

Export and test locally:
```
python -c "from export_weights import export_torch; export_torch([net0, net1], 'my_weights.json')"   # run from training/
node tools/validate.js my_weights.json
node tools/play.js my_weights.json bot:chaser            # plays a whole series, prints scores, writes replay.json
```
(replay.json can be loaded in the web viewer with "Load replay file" to watch it in 3D.)

## 9. Practical advice for a strong AI

- Start by beating `chaser`, then switch to self-play (against older copies of yourself) so you do not overfit one opponent.
- Use the shaped reward early (ball progress, touches) and make goals dominate the reward later.
- Use the kick controls: a strong flat kick when you have a clear shot, a soft touch to dribble, a lob (angle ~ +0.3 to +0.7) to clear the ball over opponents.
  Output the angle and strength **only matter on the step you kick** (kick > 0.5), so they can be learned with the same reward.
- Remember the two cubes have different roles: use observation index 32 (cube index) and the teammate vector to split attacker/defender.
- Networks are feed-forward and stateless. Keep them small (e.g. 2 hidden layers of 32-128); they run 20 times per second per cube.
- Train with randomised seeds (different kickoffs). The real series uses unseen seeds.
- Make sure the final file passes `node tools/validate.js`. Upload before the timer + 60 s grace ends. Uploading early and pressing **Lock in** ends the wait if your opponent has locked in too.
