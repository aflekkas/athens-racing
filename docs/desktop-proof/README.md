# Peristeri road-query QA proof

These two JPEGs are original screenshots of our own Athens Racing game, captured by Codex gpt-6.1-sol with Playwright/Electron on Apple M4 Pro Metal. No third-party screenshot or downloaded media is included. Source/copyright: Athens Racing project, own in-game evidence; permitted for this project review under AGENTS.md. They are documentation only and are excluded from the game build and runtime fingerprint.

| Baseline installed game | Combined candidate methods |
|---|---|
| ![Baseline Peristeri cockpit](peristeri-before.jpg) | ![Combined Peristeri cockpit](peristeri-combined-after.jpg) |

Aventador SVJ cockpit, Peristeri, medium300m, DPR2, CSS1440×868 / canvas2880×1736. Both runs use the same spawn, held accelerator, copied preferences and hardware. Traffic and OS scheduling are unseeded; NPC trajectories differ. Both travel about298–299m before a building collision; the player stays in cell-7,-8. Screenshots establish actual scene execution; frame-time conclusions come from the recorded60s traces, not these still images.

| 60-second run | Frames | p99 ms | Max RAF ms | >25 / >50 / >100 ms |
|---|---:|---:|---:|---:|
| Baseline installed game | 6997 | 10.4 | 475.0 | 24 / 10 / 1 |
| Combined exact candidate methods | 7086 | 9.4 | 58.9 | 23 / 4 / 0 |

The candidate image is **method-injected source QA**, replacing only roads.safe and queryCache.rememberConnected on the original runtime while preserving real reservation callbacks. It is not proof of the rebuilt installer. Replaying600actual footprint inputs against the same resident world and restored cache state gives zero result mismatches,803→34.4ms total. Four50–59ms frames remain. Chalandri, sustained player tile-boundary driving, rebuilt native packages and Windows performance remain unverified. Density, collision samples, visual quality and the256KiB cache cap are unchanged.

The two images were visually inspected before inclusion. Original source filenames, exact byte sizes and SHA256:

- docs/desktop-proof/peristeri-before.jpg: .scratch/desktop-check/runtime-review/peristeri-60s.jpg, 302201bytes, SHA256 4dd4395494f600a925ad98f6fbbb4030dd1bf75bbeae96a4551a4434651d8a12
- docs/desktop-proof/peristeri-combined-after.jpg: .scratch/desktop-check/runtime-review/peristeri-combined-60s.jpg, 292020bytes, SHA256 968e89ff8308dce2b56024ae86cd89ed1d3e1859a8be134602654b90e2451512
