# ⚽ Football AI Arena

Two players. Each trains **2 AI cubes** on their own PC for a fixed time (default 10 min). Then both upload
**one weights file**, the server plays a best-of series in a fixed 3D arena, and everyone watches the same replay
live from a camera of their choice. Honour system: only the trained weights are submitted, never code.

## Run it

```bash
# nothing to install (three.js is bundled in web/vendor)
npm start          # http://localhost:3000
```

Friend on the same Wi-Fi: `http://<your-LAN-IP>:3000`. Over the internet: start a tunnel next to the server,
e.g. `cloudflared tunnel --url http://localhost:3000`, and send the printed URL. (Or deploy to any Node host.)

1. You: **Create room** → send your friend the 4-letter code / invite link.
2. Friend: opens the link → **Join**.
3. You: set the training minutes → **Start training timer**.
4. Both: download the kit (`/kit.zip`) and press **Copy rules for my AI**, paste to your AI assistant, train.
5. Upload your `weights.json`, press **Lock in**. When both locked (or the timer + 60 s grace ends) the match runs.
6. Watch. Cameras `1`–`7`: Broadcast, Top down, Ball, Blue goal, Red goal, Cube cam (press again to cycle cubes), Free orbit (drag + wheel).

## While you wait: minigames, coins, power-ups
- **Minigames** pop up during training (host sets interval, best-of, which games, coin payout): Cube Sumo, Bomb Tag,
  Light Cycles, Air Hockey, Quick Draw. Real-time 1v1, server-authoritative. Winning pays more coins.
- **Live series**: matches now run live on the server and stream to both browsers. Spend coins on power-ups
  (Turbo, Power Boots, Iron Cube, Tight Goal) and hazards (Wide Goal, Bomb, Mud Pit, Ice Beam, Confusion).
  Hotkeys Q W E R T A S D F; bombs/mud: click the pitch. Coins also come from goals, match wins and time played.
- **Kick control**: AIs now choose kick angle (0-70 deg) and strength. Old 33-input / 3-output weights files still work.

## How it works

- `src/` – the deterministic simulation (the single source of truth, used by server, browser and training).
- `server/server.js` – rooms, training timer, upload validation, runs the series, serves the kit. No dependencies.
- `web/` – lobby + Three.js replay viewer. Practice mode runs in the browser with the same sim.
- `training/` – `bridge.js` + `football_env.py` (Gymnasium-style env), `export_weights.py`, a tiny ES example.
- `tools/` – `validate.js`, `play.js` (local series + replay file), `gen_rules.js` (writes `RULES.md` from `src/config.js`).

All game constants live in `src/config.js`; `RULES.md` is generated from it (`npm run docs`).

## Rules (summary)
Pitch 60×40 m, rounded corners (r=7), invisible walls + ceiling, 10 m × 4 m goals. Cubes 1.5 m, max 9 m/s, kick with cooldown.
Ball squeezed against a wall pops free; ball stalled 8 s respawns. Match: 120 s or first to 5, sudden-death OT.
Series: first to 2 match wins (max 5 matches). Full details in `RULES.md`.

## Tests
```bash
npm test                      # physics + rules checks
node test/effects.js          # kick + power-ups + fuzz
node test/minigames_test.js   # all 5 minigames
node test/ws_flow_test.js     # full online flow (spawns its own server)
node server/server.js &       # then:
node test/server_test.js      # full room flow
```
