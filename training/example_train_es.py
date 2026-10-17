"""
Tiny working example: evolution strategies (numpy only) vs the "chaser" bot, then export.
It is deliberately simple - it shows the whole pipeline (env -> train -> export), your AI should do better!

    python training/example_train_es.py --minutes 2 --out my_weights.json
    node tools/validate.js my_weights.json
    node tools/play.js my_weights.json bot:chaser
"""
import argparse
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from football_env import FootballEnv, OBS_SIZE, ACT_SIZE  # noqa: E402
from export_weights import export_numpy  # noqa: E402

HIDDEN = 24
SHAPES = [(HIDDEN, OBS_SIZE), (HIDDEN,), (ACT_SIZE, HIDDEN), (ACT_SIZE,)]
SIZES = [int(np.prod(s)) for s in SHAPES]
N = sum(SIZES)


def unpack(theta):
    out, i = [], 0
    for s, n in zip(SHAPES, SIZES):
        out.append(theta[i:i + n].reshape(s)); i += n
    return out


def policy(theta, obs):          # obs (2, 33) -> action (2, 3); one shared net, agent index is in the obs
    w1, b1, w2, b2 = unpack(theta)
    h = np.tanh(obs @ w1.T + b1)
    return np.tanh(h @ w2.T + b2)


def rollout(env, theta, seed, seconds=30):
    obs, _ = env.reset(seed=seed)
    total, done, steps = 0.0, False, 0
    while not done and steps < seconds * 20:
        obs, r, done, _, _ = env.step(policy(theta, obs))
        total += r; steps += 1
    return total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, default=1.0)
    ap.add_argument("--out", default="my_weights.json")
    ap.add_argument("--pop", type=int, default=16)
    args = ap.parse_args()

    env = FootballEnv(opponent="chaser", match_seconds=30)
    rng = np.random.default_rng(0)
    theta = rng.normal(0, 0.3, N)
    sigma, lr = 0.2, 0.05
    t_end = time.time() + args.minutes * 60
    gen = 0
    while time.time() < t_end:
        eps = rng.normal(0, 1, (args.pop, N))
        seed = int(rng.integers(1_000_000))
        scores = np.array([rollout(env, theta + sigma * e, seed) for e in eps])
        adv = (scores - scores.mean()) / (scores.std() + 1e-8)
        theta = theta + lr / (args.pop * sigma) * (eps.T @ adv) * sigma
        gen += 1
        print(f"gen {gen:3d}  mean reward {scores.mean():7.2f}  best {scores.max():7.2f}", flush=True)

    w1, b1, w2, b2 = unpack(theta)
    net = [(w1, b1, "tanh"), (w2, b2, "tanh")]
    export_numpy([net], args.out)     # one network, used for both cubes
    print("wrote", args.out)


if __name__ == "__main__":
    main()
