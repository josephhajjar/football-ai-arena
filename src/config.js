// ALL game constants live here. They are identical for every player and never change.
// RULES.md is generated from this file (npm run docs), so the numbers can never drift.

export const CONFIG = Object.freeze({
  // --- simulation clock ---
  DT: 1 / 60,               // physics step (seconds)
  ACTION_REPEAT: 3,         // AI picks an action every 3 physics steps => 20 decisions/second

  // --- pitch (metres). x = length axis, z = width axis, y = up. Centre of pitch is (0,0,0) ---
  HALF_LENGTH: 30,          // pitch spans x in [-30, 30]
  HALF_WIDTH: 20,           // pitch spans z in [-20, 20]
  CORNER_RADIUS: 7,         // all four corners are rounded (no corner to get stuck in)
  CEILING: 14,              // invisible ceiling height
  GOAL_HALF_WIDTH: 5,       // goal mouth spans z in [-5, 5]  (10 m wide) - can change temporarily via power-ups
  GOAL_HEIGHT: 4,           // goal mouth is 4 m high
  GOAL_DEPTH: 3,            // net pocket behind each goal line

  // --- players (cubes) ---
  PLAYER_HALF: 0.75,        // cube is 1.5 m wide
  PLAYER_RADIUS: 0.9,       // collision cylinder radius
  PLAYER_HEIGHT: 1.5,
  MAX_SPEED: 9,             // m/s
  ACCEL: 45,                // m/s^2 (cubes have a little inertia)
  PLAYER_BOUNCE: 0.3,

  // --- kick ---
  KICK_REACH: 0.5,          // gap allowed between cube surface and ball surface to kick
  KICK_COOLDOWN: 0.5,       // seconds (cooldown of a full-strength kick)
  KICK_COOLDOWN_MIN: 0.25,  // seconds (cooldown of the weakest kick)
  KICK_SPEED: 20,           // m/s ball speed after a full-strength kick
  KICK_MIN_SPEED: 6,        // m/s ball speed after the weakest kick
  KICK_MAX_ELEVATION: 70,   // degrees: kick angle ranges from 0 (flat) to 70 (never straight up)
  KICK_DEFAULT_ELEVATION: 8.5, // degrees used when an AI has no angle output (legacy 3-output nets)
  KICK_ABS_MAX: 30,         // m/s hard cap even with Power Boots

  // --- ball ---
  BALL_RADIUS: 0.6,
  GRAVITY: 20,
  BALL_FLOOR_BOUNCE: 0.55,
  BALL_WALL_BOUNCE: 0.7,
  BALL_PLAYER_BOUNCE: 0.6,
  GROUND_DRAG: 0.5,         // horizontal slowdown per second while rolling
  AIR_DRAG: 0.05,
  BALL_MAX_SPEED: 45,       // safety cap (m/s)

  // --- match rules ---
  MATCH_SECONDS: 120,       // regulation length of one match
  GOALS_TO_WIN: 5,          // a match ends instantly when a team reaches this
  OVERTIME_SECONDS: 60,     // sudden-death golden goal if tied at full time
  GOAL_PAUSE_SECONDS: 1.5,  // celebration pause after a goal (not counted on the clock)
  STALL_SECONDS: 8,         // if the ball hardly moves for this long it is re-spawned at centre

  // --- series rules ---
  SERIES_WINS_NEEDED: 2,    // first to win this many matches wins the series
  SERIES_MAX_MATCHES: 5,    // after this many matches without a winner the series is a draw

  // --- spawn ---
  SPAWN_X: 12,
  SPAWN_Z: 6,
  SPAWN_JITTER: 1.5,

  // --- effects (see POWERS below) ---
  BOMB_FUSE: 2.0,           // seconds from placing a bomb to the blast
  BOMB_RADIUS: 6.5,         // blast radius (m)
  BOMB_CUBE_IMPULSE: 17,    // m/s speed kick at the bomb centre (fades to 0 at the edge)
  BOMB_BALL_IMPULSE: 20,    // m/s horizontal ball speed kick at the centre
  BOMB_BALL_LIFT: 7,        // m/s upward ball speed kick at the centre
  BOMB_STUN: 0.7,           // seconds a blasted cube has reduced control
  MUD_RADIUS: 5.5,
  MUD_SPEED_FACTOR: 0.5,
  SPEED_FACTOR: 1.5,
  ICE_FACTOR: 0.4,
  KICK_BOOST: 1.35,
  HEAVY_MASS: 5,
  SMALL_GOAL_FACTOR: 0.64,
  BIG_GOAL_FACTOR: 1.7,
  MAX_BOMBS: 4,
  MAX_MUD: 3,

  // --- AI file limits ---
  MAX_LAYERS: 6,
  MAX_WIDTH: 256,
  MAX_PARAMS: 40000,        // per network
});

// Power-ups (for you) and hazards (against your opponent). Humans buy these with coins during
// the live series; the AIs see their effect through the observation vector.
// target: 'none' | 'ownCube' | 'enemyCube' | 'point' (a spot on the pitch)
export const POWERS = Object.freeze({
  speed:     { name: 'Turbo',       kind: 'power',  cost: 20, duration: 8,  target: 'ownCube',   icon: '⚡', desc: 'Chosen cube runs 1.5x faster and accelerates faster.' },
  kick:      { name: 'Power Boots', kind: 'power',  cost: 25, duration: 10, target: 'ownCube',   icon: '🥾', desc: 'Chosen cube kicks 35% harder (hard cap 30 m/s).' },
  heavy:     { name: 'Iron Cube',   kind: 'power',  cost: 25, duration: 8,  target: 'ownCube',   icon: '🛡️', desc: 'Chosen cube is 5x heavier: shoves others aside and mostly ignores bombs.' },
  smallgoal: { name: 'Tight Goal',  kind: 'power',  cost: 30, duration: 10, target: 'none',      icon: '🥅', desc: 'Your own goal gets 36% narrower. Still possible to score in.' },
  biggoal:   { name: 'Wide Goal',   kind: 'hazard', cost: 30, duration: 10, target: 'none',      icon: '📐', desc: 'The enemy goal gets 70% wider.' },
  bomb:      { name: 'Bomb',        kind: 'hazard', cost: 25, duration: 2,  target: 'point',     icon: '💣', desc: 'Pick a spot: after a 2 s fuse it blasts cubes and the ball outward.' },
  mud:       { name: 'Mud Pit',     kind: 'hazard', cost: 20, duration: 8,  target: 'point',     icon: '🟤', desc: 'Pick a spot: cubes inside move at half speed and the ball drags.' },
  ice:       { name: 'Ice Beam',    kind: 'hazard', cost: 25, duration: 5,  target: 'enemyCube', icon: '🧊', desc: 'Chosen enemy cube is slowed to 40% speed.' },
  invert:    { name: 'Confusion',   kind: 'hazard', cost: 35, duration: 5,  target: 'enemyCube', icon: '🌀', desc: "Chosen enemy cube's movement is reversed." },
});

// Coin economy for the live series (minigame coins are defined in server/minigames.js).
export const ECONOMY = Object.freeze({
  PASSIVE_EVERY_SECONDS: 3,   // +1 coin per this many seconds of play (both teams)
  GOAL: 10,                   // coins for scoring a goal
  MATCH_WIN: 15,              // coins for winning a match
  GLOBAL_COOLDOWN: 1.2,       // seconds between any two purchases by one player
  SAME_COOLDOWN: 3,           // seconds before the same item can be bought again by one player
});

export const LEGACY_OBS_SIZE = 33;   // older weights files with 33 inputs still work (extra inputs are cut off)
export const LEGACY_ACT_SIZE = 3;    // older weights files with 3 outputs still work (default kick angle/strength)
export const OBS_SIZE = 46;
export const ACT_SIZE = 5;

// Human readable description of the observation vector. Used by the docs generator.
export const OBS_LAYOUT = [
  [0, 'self x / HALF_LENGTH'],
  [1, 'self z / HALF_WIDTH'],
  [2, 'self vx / MAX_SPEED'],
  [3, 'self vz / MAX_SPEED'],
  [4, 'kick cooldown remaining / KICK_COOLDOWN (0 = ready)'],
  [5, '1 if the ball is close enough to kick right now (and height ok), else 0'],
  [6, 'ball x / HALF_LENGTH'],
  [7, 'ball y / 10 (height above ground)'],
  [8, 'ball z / HALF_WIDTH'],
  [9, 'ball vx / 25'],
  [10, 'ball vy / 25'],
  [11, 'ball vz / 25'],
  [12, '(ball x - self x) / (2*HALF_LENGTH)'],
  [13, '(ball z - self z) / (2*HALF_WIDTH)'],
  [14, 'teammate: (x - self x) / (2*HALF_LENGTH)'],
  [15, 'teammate: (z - self z) / (2*HALF_WIDTH)'],
  [16, 'teammate: vx / MAX_SPEED'],
  [17, 'teammate: vz / MAX_SPEED'],
  [18, 'opponent 0: relative x (same scaling as teammate)'],
  [19, 'opponent 0: relative z'],
  [20, 'opponent 0: vx / MAX_SPEED'],
  [21, 'opponent 0: vz / MAX_SPEED'],
  [22, 'opponent 1: relative x'],
  [23, 'opponent 1: relative z'],
  [24, 'opponent 1: vx / MAX_SPEED'],
  [25, 'opponent 1: vz / MAX_SPEED'],
  [26, '(opponent goal centre x - self x) / (2*HALF_LENGTH); opponent goal centre is (+HALF_LENGTH, 0)'],
  [27, '(opponent goal centre z - self z) / (2*HALF_WIDTH)'],
  [28, '(own goal centre x - self x) / (2*HALF_LENGTH); own goal centre is (-HALF_LENGTH, 0)'],
  [29, '(own goal centre z - self z) / (2*HALF_WIDTH)'],
  [30, 'fraction of regulation time remaining (1 -> 0, stays 0 in overtime)'],
  [31, '(own goals - opponent goals) / GOALS_TO_WIN'],
  [32, 'agent index of this cube in your team (0 or 1)'],
  // --- effects (all 0/1 or 1.0 when nothing special is happening) ---
  [33, 'own goal half-width / GOAL_HALF_WIDTH (1 = normal, <1 narrowed by Tight Goal)'],
  [34, 'enemy goal half-width / GOAL_HALF_WIDTH (1 = normal, >1 widened by Wide Goal)'],
  [35, 'self speed multiplier (1 normal, 1.5 Turbo, 0.4 Ice Beam, 0.5 in Mud; they multiply)'],
  [36, 'self kick power multiplier (1 normal, 1.35 Power Boots)'],
  [37, '1 if self is an Iron Cube (heavy), else 0'],
  [38, '1 if self movement is reversed by Confusion, else 0'],
  [39, '1 if self is inside a Mud Pit, else 0'],
  [40, 'nearest bomb: (x - self x) / (2*HALF_LENGTH)  (0 if no bomb)'],
  [41, 'nearest bomb: (z - self z) / (2*HALF_WIDTH)    (0 if no bomb)'],
  [42, 'nearest bomb: fuse remaining / BOMB_FUSE (0 if no bomb)'],
  [43, '2nd nearest bomb: relative x (same scaling)'],
  [44, '2nd nearest bomb: relative z'],
  [45, '2nd nearest bomb: fuse remaining / BOMB_FUSE'],
];

export const ACT_LAYOUT = [
  [0, 'move_x in [-1, 1] (+1 = toward the enemy goal)'],
  [1, 'move_z in [-1, 1]'],
  [2, 'kick: fires when > 0.5 (ball in reach and cooldown 0)'],
  [3, 'kick angle in [-1, 1]: maps linearly to 0..70 degrees above the ground (-1 = flat, +1 = 70 deg). Direction left/right is always away from your cube.'],
  [4, 'kick strength in [-1, 1]: maps linearly to a ball speed of 6..20 m/s (and a cooldown of 0.25..0.5 s)'],
];
