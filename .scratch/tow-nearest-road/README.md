# Tow onto the nearest road (owner decision 2026-10-18)

Real game, real physics and recovery fade, private server: `tools/tow-nearest-road-browser.mjs` (numbers in `report.json`).

| Scenario | Before | After |
| --- | --- | --- |
| (a) Riviera free roam, 30 m into a field | `a-riviera-free-roam-before.webp` | `a-riviera-free-roam-after.webp`: on the carriageway, lane-centred, facing the heading |
| (b) Psychiko race, 20 m into a side street | `b-psychiko-side-street-before.webp` | `b-psychiko-side-street-after.webp`: back on the route at the nearest point, not before where it left |
| (c) Psychiko race, 300+ m down a non-route street | `c-psychiko-300m-street-before.webp` | `c-psychiko-300m-street-after.webp`: on that street's lane, progress unchanged |

(d) the multiplayer server scenario has no picture: it runs over WebSocket against the private server (see the script).
