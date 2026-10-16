# Rain overlay audit

CPU/resource baseline: `87558ec5d2f2dd916b32b6e9fc6e78a290b18571` (world rain/spray/splash unchanged through `5836731`). Final visual baseline: `5836731`, so both image phases include the final cockpit structure and rain overlay. Before code is preserved in `.scratch/realism/before-weather.js`, `rain-before.mjs` and `splash-before.mjs`. Initial tested candidate: `1a3f52e127bf3c79d63ee66cb9fa4cc1b3a01aae`; final source also smooths the mist mask. Final validation and landing SHAs are recorded with the handoff.

## Audit and implementation

- Falling rain previously allocated 6,000 instanced streaks, rendering 1,800 under the owner-locked low weather setting. It now draws two camera-space scrolling texture layers, four triangles, one call. No drop positions, per-drop velocities, lifetime updates or particle collision.
- Tyre spray previously allocated 600 CPU particles and updated/drew 220 under the lock. It now uses two rear-wheel wake cards per moving car, globally bounded at 18 for the player/rivals and six nearest traffic cars, in one call. Stopped/dry cars submit none; multiplayer suppression is retained.
- Road wetness/puddles previously evaluated noise, animated ripple normals and reduced roughness. The same road materials now sample a static blue-channel mask and darken their existing colour. No extra road/decal geometry or pass, no ripple animation or wetness-induced gloss/reflection response. Wet-grip accumulation/drying/physics are untouched.
- Water-entry splash previously used 420 CPU particles and an 80-triangle foam ring. It now has one expanding mist billboard plus one foam-ring texture quad: four triangles, the same two calls. Multiplayer reset remains compatible.
- Cockpit windscreen drops/wipers preserve the single tiled-alpha overlay from `5836731`, coordinated with the cockpit-structure agent. Its import, dropMaterial wrapper, attachment/update block and `cockpit-rain.js` helper are unchanged by the world-rain merge. No new light, shadow, reflection, AO or post-processing pass.

All maps use the same weather hooks and shared `rain-overlays.js`. The 128×128 RGBA atlas is 65,536 bytes, no mipmaps, shared with puddles and splash and retained across map teardown using the existing `userData.shared` convention. Startup atlas generation is measured separately in `rain-costs.json`: one module-lifetime bake, not per-frame JS. It adds texture storage but removes more allocated geometry storage; there are no new world draw calls. This is the justification for the atlas rather than thousands of individual streaks and spray particles.

## Measurements

Raw deterministic resource counts and CPU samples: `.scratch/realism/rain-costs.json`. CPU method: 100 warm-up updates, 1,000 measured updates, nine nearby cars at 30 m/s. Baseline uses the locked 220-particle update pool and seven emissions/update (approximately its 40% emission probability); candidate updates 18 anchored cards. Timings are CPU wall-clock samples on a shared host, not SwiftShader GPU frame-time claims. Cold atlas bake runs are measured from fresh module instances; scheduling and JIT compilation make them noisier than steady-state updates.

| Subsystem | Calls before → after | Triangles before → after | Point particles before → after | Allocated geometry bytes before → after |
|---|---:|---:|---:|---:|
| Falling rain + maximum tyre wakes | 2 → 2 | 3,600 → 40 | 220 → 0 | 108,060 → 720 |
| Active water-entry splash | 2 → 2 | 80 → 4 | 420 → 0 | 8,144 → 280 |

Falling rain's 1,800 old streak instances are triangles, not Three.js point primitives. New texture storage is 65,536 bytes total, replacing the splash's separate 5,461-byte mipmapped texture and shared across all four effects. Net allocated geometry + texture storage falls by 55,129 bytes (approximately 54 KiB). Road-mask texture reads replace multiple procedural noise evaluations; no new road draw calls or triangles.

## Captures

`.scratch/realism/rain-{before,after}-{day,night}-{chase,cockpit}.png`, plus `rain-day-comparison.webp` and `rain-night-comparison.webp`. Scripted identical Riviera-mid camera poses, frozen scene, wetness 0.8 and speed 25 m/s. The harness swaps weather subsystems in place, restores original lamp material intensities before reinitialization, and swaps the wet shader snippet/uniforms on the same road meshes. It does not change the cockpit overlay. Full-scene counters and camera transforms: `rain-report.json`.

The wetness/puddle design is deliberately matte and dark. Rain uses layered streaks, and spray is smaller and anchored behind the rear wheels. These are inexpensive weather cues rather than individual simulated droplets. No silent quality trade: matched captures are adjacent to the cost report.

Final inspected captures: all four before/after camera pairs have identical transforms and draw calls, 3,592 fewer triangles and 220 fewer points. Day chase/cockpit: 272/239 calls; night: 274/241 calls. The maximum-pool benchmark includes nine cars; captures contain the player wake, hence eight rain/spray triangles rather than the 40-triangle maximum. Shader/JavaScript error list is empty. The separate `splash-before.png` and `splash-after.png` fixture shows the replacement water-entry feedback; background geometry adds 14 triangles and two calls in both views.

Measured batch CPU time (5,000 updates, process CPU accounting): 0.00627 → 0.00332 ms/update. The shared atlas cold bake costs 14.658 CPU ms once per module lifetime (16.699 ms wall median), never per frame or per map. This one-time cost buys the lower steady-state CPU and memory footprint. Full raw samples, wall medians/p95 and splash update costs remain in `rain-costs.json`.

Pre-cockpit validation: combined candidate `99dcb5779b9d749c6447396079a84f8001f9d72a`, based on Psychiko-integrated `f525f45`. All six gates exited 0; logs and markers are in `.scratch/realism/final-rain-gates/`. This includes the final smooth mist / foam artwork and the three preserved Psychiko street-circuit branches in ground.js. The separately landed building step is identical to the building code in this candidate. No deployment or push was run.

Final merged validation: all six release gates passed on clean archive `c30dfc4c445d158db78e46a0cb8373148d537b18`, parent `5836731`; logs and exit markers are in `.scratch/realism/merged-rain-gates/`. The cockpit import, material wrapper and entire windscreen attachment/update section match `5836731` exactly. Fresh combined archive `4df5a542f333af88a220612e036bc772550998b3`, including the separately landed gantry fix `c4f0eca`, passed 29 focused tests plus syntax, imports and events; see `final-combined-*.log`. World-rain implementation sources are identical across these last two archives.
