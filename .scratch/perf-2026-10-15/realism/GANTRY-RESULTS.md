# Gantry clearance

Fresh free-roam/driving-mode starts move to 20 m beyond the event start; solo races and the front race grid row move to 30 m before it (later rows keep their existing spacing). Multiplayer waiting placements use the same grid helper. Timing/checkpoint stations and auto-tow/recovery logic are unchanged. Existing gantry shapes and their rendering budgets are unchanged; this adds zero draw calls, triangles, texture bytes or per-frame JS.

The Node guard uses the real geometry shared with the rendered road/event arches and Megara's batched pier. It loads all four maps, every catalogue event, all 70 car configurations, solo spawns and eight grid slots. The central default-cockpit region is NDC x ±0.9, y −0.8…0.85; real raycasts against each post's projected bounds reject hits closer than 20 m. All 13,510 checks pass. The old Riviera MINI spawn fails the same detector, guarding the reported regression. The old source `main.js` used s=start−4; the new free-roam start is s=start+20, on the same road lane. Checkpoint resolution is untouched.

Evidence is in `.scratch/realism/gantry-*.png`, `gantry-report.json`, `gantry-focused.log`, and five `gantry-*-review.webp` contact sheets. All 15 captures were inspected: Aygo, MINI, Z4, 911 Carrera and SVJ at the original spawn, new free-roam spawn and front grid row. Original red post intrusion reproduced in all five; the free-roam post is now behind the car. The front grid row retains a clear road corridor through the distant arch. Browser errors: zero.

Rendered counts vary between these screenshots because the camera moves 24 m forward for free roam and 26 m backward for the grid, changing culling. They are not a geometry/performance regression comparison. The placement helper adds only startup arithmetic and the geometry refactor uses the same post sizes, triangle counts and transforms. No shadow/post/AO/light pass was added.

The same 13,510 raycast checks were rerun against the final cockpit geometry/eye positions from `5836731` and passed; see `gantry-final-cockpit.log`. The original obstruction remains detected.

All 15 browser captures were refreshed with the final `5836731` cockpit structure and inspected again. The updated changelog WebP shows the mounted mirror, wheel and shell retained while the post clears the view.

Six release gates passed on isolated candidate `d5e755f1f188fea84a56e03a7c1554ec1670708c` (parent `87f0d64`); logs/exit markers are in `.scratch/realism/gantry-gates/`. The rebase preserves the independently gated cockpit commit `5836731`; only initial-placement functions/imports differ in main.js. Final cockpit raycasts and captures were repeated after that merge.

Fresh rebased archive `0875b4137ddcc0f723f8bda4df58dbab16815b0a`: 11 focused tests passed (gantry raycasts, rendered POV owner lock, cockpit structure and graphics lock), plus syntax, browser imports and events checks. The cockpit camera source hash remains intact. Logs: `gantry-rebased-*.log`.
