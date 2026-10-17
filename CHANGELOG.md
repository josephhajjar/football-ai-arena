# Changelog

## v2.1.0 - Downtime update
- **Cube Clicker**: an idle/clicker game for the training downtime. Click the ball, buy helpers and upgrades, catch Golden Boots. Trophies pay coins (server-checked and capped by training time).
- **Minigame lag fixes**: hidden 3D stadium no longer renders behind minigames, cached canvas art, 60 Hz server loop and snapshots, dead-reckoning on the client, instant local paddle in Air Hockey, no more full-screen blur.
- **Minigame polish**: particles, screen shake, impact sounds.

## v2.0.0 - Energy update
- AIs choose **kick angle** (0-70 deg) and **kick strength** (6-20 m/s); old weights files still work.
- **Live matches**: the server runs the series in real time and streams it over WebSockets.
- **Coins + shop**: 9 power-ups and hazards (Turbo, Power Boots, Iron Cube, Tight Goal, Wide Goal, Bomb, Mud Pit, Ice Beam, Confusion).
- **Training minigames**: Cube Sumo, Bomb Tag, Light Cycles, Air Hockey, Quick Draw - real-time 1v1, host-configurable.
- Effects visible to the AIs (46-number observation) and a `chaos` training mode.
- Sound effects, explosions, camera shake, ball trail, event feed.

## v1.1.0 - Hardening
- Code audit: fixed host-rejoin seat bug, weights validation hole, static-file hardening, re-upload lock bug, Python path bug.
- Auto-resume after refresh, online indicator, mobile layout, replay download.

## v1.0.0 - First playable version
- Deterministic 3D football simulation (rounded arena, invisible walls, anti-pinch and anti-stall rules).
- Rooms with codes, training timer, weights upload, server-run best-of series, synced 3D replay with 7 cameras.
- Training kit: Gymnasium-style Python env, export helpers, auto-generated RULES.md for AI assistants.
