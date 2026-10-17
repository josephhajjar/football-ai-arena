"""
Football AI Arena - training environment (Gymnasium style).

This runs the *exact same simulation* that decides the real match (training/bridge.js, needs Node 18+).
You control your TEAM of 2 cubes. The opponent is a built-in bot, a weights file, or "self".

    from football_env import FootballEnv
    env = FootballEnv(opponent="chaser")
    obs, info = env.reset(seed=0)            # obs: float32 array (2, 46)  -> one row per cube
    obs, reward, terminated, truncated, info = env.step(env.action_space.sample())   # action (2, 5)

Action per cube: [move_x, move_z, kick, kick_angle, kick_strength], each in [-1, 1]
    kick fires when > 0.5; kick_angle -1..+1 maps to 0..70 degrees up; kick_strength -1..+1 maps to 6..20 m/s
Everything is in "own frame": you always attack toward +x. See RULES.md for the full spec.

opponent options:
    "idle"        stands still
    "random"      random flailing
    "chaser"      simple scripted attacker + defender (good first sparring partner)
    "self"        you supply the opponent's actions:  env.step(my_action, opp_action)
                  info["obs_opp"] gives the opponent's observations (also in its own frame)
    "path.json"   a weights file (football-ai-v1) plays the opponent

Chaos: FootballEnv(chaos=0.3) randomly fires power-ups and hazards (bombs, mud, ice, goal size...) at both teams
so your AI learns to survive them. In the real series your friend and you fire them by hand with coins.
Use env.use_power(team, "bomb", x=3, z=4) / env.use_power(0, "speed", cube=1) to trigger one yourself (ids: see RULES.md).

Reward: by default a shaped team reward (goal +10 / conceded -10, ball progress toward the enemy
goal, small touch bonus). Pass reward_fn=your_function to replace it:
    reward_fn(prev_state, state, events) -> float
where state is a dict with keys ball=[x,y,z] (world frame, blue attacks +x), score=[blue, red], clock.
"""
import json
import os
import subprocess
import atexit

import numpy as np

try:
    import gymnasium as gym
    from gymnasium import spaces
    _Base = gym.Env
except Exception:  # gymnasium not installed: fall back to a plain class with the same interface
    gym = None
    spaces = None
    _Base = object

OBS_SIZE = 46
ACT_SIZE = 5
HALF_LENGTH = 30.0
HERE = os.path.dirname(os.path.abspath(__file__))


def default_reward(prev, cur, events):
    r = 0.0
    for e in events:
        if e["type"] == "goal":
            r += 10.0 if e["team"] == 0 else -10.0
        elif e["type"] == "touch" and e["agent"] in (0, 1):
            r += 0.02
    r += 0.5 * (cur["ball"][0] - prev["ball"][0]) / HALF_LENGTH   # pushing the ball toward +x is good
    return r


class FootballEnv(_Base):
    metadata = {"render_modes": []}

    def __init__(self, opponent="chaser", match_seconds=120, goals_to_win=5, overtime_seconds=0,
                 reward_fn=default_reward, node="node", chaos=0.0):
        if isinstance(opponent, str) and opponent.endswith(".json"):
            opponent = os.path.abspath(opponent)      # the node bridge runs from the kit folder
        self.opponent = opponent
        self.match_seconds = match_seconds
        self.goals_to_win = goals_to_win
        self.overtime_seconds = overtime_seconds
        self.reward_fn = reward_fn
        self.chaos = chaos
        self._pending_powers = []
        if spaces is not None:
            self.observation_space = spaces.Box(-np.inf, np.inf, (2, OBS_SIZE), dtype=np.float32)
            self.action_space = spaces.Box(-1.0, 1.0, (2, ACT_SIZE), dtype=np.float32)
        self._proc = subprocess.Popen(
            [node, os.path.join(HERE, "bridge.js")], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            text=True, bufsize=1, cwd=os.path.dirname(HERE))
        atexit.register(self.close)
        self._state = None
        self._seed_counter = 0

    # -- plumbing --
    def _call(self, msg):
        self._proc.stdin.write(json.dumps(msg) + "\n")
        self._proc.stdin.flush()
        line = self._proc.stdout.readline()
        if not line:
            raise RuntimeError("bridge.js exited (is Node installed? run `node -v`)")
        out = json.loads(line)
        if "error" in out:
            raise RuntimeError(out["error"])
        return out

    # -- gym API --
    def reset(self, seed=None, options=None):
        if seed is None:
            self._seed_counter += 1
            seed = int.from_bytes(os.urandom(3), "little") + self._seed_counter
        out = self._call({"cmd": "reset", "seed": int(seed), "opponent": self.opponent,
                          "matchSeconds": self.match_seconds, "goalsToWin": self.goals_to_win,
                          "overtimeSeconds": self.overtime_seconds, "chaos": self.chaos})
        self._state = {"ball": [0.0, 0.6, 0.0], "score": [0, 0], "clock": 0.0}
        info = {"obs_opp": np.asarray(out["obsRed"], dtype=np.float32), "seed": seed}
        return np.asarray(out["obs"], dtype=np.float32), info

    def step(self, action, opp_action=None):
        action = np.clip(np.asarray(action, dtype=np.float64).reshape(2, ACT_SIZE), -1, 1)
        msg = {"cmd": "step", "blue": action.tolist()}
        if self._pending_powers:
            msg["powers"] = self._pending_powers; self._pending_powers = []
        if self.opponent == "self":
            if opp_action is None:
                raise ValueError('opponent="self" requires env.step(action, opp_action)')
            msg["red"] = np.clip(np.asarray(opp_action, dtype=np.float64).reshape(2, ACT_SIZE), -1, 1).tolist()
        out = self._call(msg)
        cur = {"ball": out["ball"], "score": out["score"], "clock": out["clock"]}
        reward = float(self.reward_fn(self._state, cur, out["events"]))
        self._state = cur
        terminated = bool(out["done"])
        info = {
            "events": out["events"], "score": out["score"], "winner": out["winner"], "clock": out["clock"],
            "ball": out["ball"], "players": out["players"], "fx": out.get("fx"),   # world frame; [x, z, vx, vz] x4 (0,1 = you)
            "obs_opp": np.asarray(out["obsRed"], dtype=np.float32),
        }
        return np.asarray(out["obs"], dtype=np.float32), reward, terminated, False, info

    def use_power(self, team, power_id, cube=0, x=0.0, z=0.0):
        """Queue a power-up/hazard for the next step. team 0 = you, 1 = opponent."""
        self._pending_powers.append({"team": int(team), "id": power_id, "cube": int(cube), "x": float(x), "z": float(z)})

    def close(self):
        p = getattr(self, "_proc", None)
        if p and p.poll() is None:
            try:
                p.stdin.write('{"cmd":"close"}\n'); p.stdin.flush()
            except Exception:
                pass
            try:
                p.wait(timeout=2)
            except Exception:
                p.kill()
