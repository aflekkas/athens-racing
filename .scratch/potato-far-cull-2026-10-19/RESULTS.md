# Potato far cull, Riviera, 2026-10-19

Owner: "stop drawing distant road". Goal: Riviera on Potato under 200 draw calls per frame.

**What changed.** On Potato, on Riviera only, the static world beyond **340 m** from the camera is no longer submitted: the race road, terrain tiles,
surrounding roads, block buildings, the far scenery and the signal lamps (`src/far-cull.js`, run from the scenery LOD pass every 6 frames or after a
teleport). The aerial-perspective fog gets a far term (`apFar` in `src/env.js`, a uniform: no shader recompile, zero on every other class) that is fully
opaque at 300 m (40 m before the cut) and starts at 90 m, so the world ends in the horizon haze and nothing pops. Hysteresis: a chunk hides at 370 m and
comes back at 340 m. Render only: physics, collision, the route, the minimap, traffic and the AI never read `visible`. Low / Med / High / Ultra keep their draw
distances (guarded) and draw the world to the horizon as before. `src/map-world.js`, `src/scenery.js` and `src/terrain.js` are untouched, so the
detail-budget fixed-pose hash guard needed no regeneration. The cockpit is untouched.

Why 340 m: the sweep (world only, 2 rivals) gave 221 / 226 / 229 mean calls for 200 / 260 / 320 m, i.e. the distance barely matters between 200 and 340 m;
the rest is the near world, the cockpit and the cars. So the far edge is the largest the owner's 250-350 m range allows. At 300 km/h the fog's far edge is
3.6 s ahead.

## Fixed poses, no rivals / traffic / police (`tools/far-cull-capture.mjs`, 1280x800, Potato)

Longest straight (s=5712) and sharpest corner (s=9394). The heaviest frame of six, i.e. including the in-car mirror pass every 3rd frame.

| camera | pose | calls before (max frame) | calls after (max frame) | lightest frame before → after | triangles (k) before → after (last frame) | cull |
|---|---|---|---|---|---|---|
| cockpit | straight | 252 | 139 | 205 → 103 | 1139 → 412 | 817 managed, 737 hidden, 0.438 ms/update |
| cockpit | corner | 156 | 125 | 121 → 91 | 529 → 562 | 817 managed, 766 hidden, 0.196 ms/update |
| chase | straight | 239 | 138 | 239 → 138 | 1139 → 415 | 817 managed, 736 hidden, 1.48 ms/update |
| chase | corner | 153 | 126 | 153 → 126 | 518 → 273 | 817 managed, 766 hidden, 0.124 ms/update |

Every frame of every pose is under 200 calls (budget test: `tools/far-cull-budget.test.mjs`).

## Interleaved profile (tools/lowend-profile.mjs, 4x CPU throttle, 640x360, 120 frames, before and after run side by side, 2 rounds, `measure.sh`)

Scenario "default" = the profiler's race: 2 rivals on the grid beside the player, 2 traffic, police. "World only" = 2 rivals, no traffic, no police.
The 2 rivals sit 6-11 m from the player in these runs and cost about 60 calls together (~30 each, nothing to do with distance).
`calls max` is a mirror-pass frame, `no-mirror` a frame without the mirror pass. Submit / render ms are noisy on this shared machine (they ranged 36-117 ms between
rounds of the same build); the call and triangle counts are deterministic.

| class | scenario | build | calls mean | calls no-mirror | calls max | triangles (k) | render submit ms (4x) | render ms (4x) | step ms (4x) | rounds |
|---|---|---|---|---|---|---|---|---|---|---|
| potato | default (2 rivals, 2 traffic, police) | before | 350 | 324 | 400 | 1270 | 85 | 85 | 33.4 | 2 |
| potato | default (2 rivals, 2 traffic, police) | after | 238 | 212 | 288 | 971 | 64 | 64 | 43.8 | 2 |
| potato | world only (2 rivals, no traffic, no police) | before | 288 | 266 | 330 | 1269 | 54 | 56 | 30.1 | 2 |
| potato | world only (2 rivals, no traffic, no police) | after | 220 | 200 | 262 | 967 | 52 | 52 | 20.1 | 2 |
| low | default (2 rivals, 2 traffic, police) | before | 313 | 288 | 364 | 1282 | 71 | 71 | 20.7 | 2 |
| low | default (2 rivals, 2 traffic, police) | after | 314 | 288 | 364 | 1280 | 89 | 89 | 17.9 | 2 |
| low | default (2 rivals, 2 traffic, police) | low + the cull (report only) | 240 | 214 | 288 | 979 | 56 | 59 | 19.7 | 2 |
| low | world only (2 rivals, no traffic, no police) | before | 296 | 275 | 339 | 1275 | 67 | 67 | 17.8 | 2 |
| low | world only (2 rivals, no traffic, no police) | after | 296 | 276 | 339 | 1269 | 59 | 59 | 16.8 | 2 |
| low | world only (2 rivals, no traffic, no police) | low + the cull (report only) | 220 | 199 | 262 | 965 | 101 | 101 | 17.6 | 2 |


Reading it:
* Potato, world only: 288 → 220 calls (mean), 266 → 200 without the mirror pass, 1269k → 967k triangles. Default: 350 → 238 (the before's second round was 311, the first 388: a full-detail traffic car near the player in some runs).
* **Under 200 is reached whenever the two grid rivals are not beside the player** (every pose above: 91-139) and **not** with them there (200 in a no-mirror frame, 220 mean, 262 in a mirror frame, world only; 238 mean in default). What is left in that scene: the cockpit 44 (locked), two rivals ~62, near world ~100 (the 13 prop kinds, ~13 road meshes, 9 terrain tiles, 16 parked-car levels, 10 street-furniture batches, osm roads 5, gantries, the 7 signal halos).
* Low could **not** hit 200 with the same cull in the rival scenes (report only, the cull is not applied to Low): world only 296 → 220, default 314 → 240, identical to Potato's, i.e. the cull alone is worth about 75 calls on either class. (I did not capture Low's clean poses.) Its fog edge would be the same 300 m wall, which on a stronger class is a visible loss, so I did not apply it.
* The next lever for the rival scene is the rivals' near car model (about 31 calls each at 6-11 m: body 10, wheels 12, calipers 4, cabin); lowering the Potato vehicle-LOD factor from .45 to .25 changed nothing at that range (the first LOD step is clamped to >= 5 m), so it needs an owner decision on how a rival looks at 6-10 m.

## Screenshots (1280x800, Potato, before = prod 07be9d90 + nothing, after = this change)

`before-{cockpit,chase}-{straight,corner}-1280x800.webp` and `after-...`. In the straight shot the backdrop hills and the far buildings become haze; in the corner the
distant headland becomes a pale haze silhouette against the sea. The fog edge is a soft ramp (90 m to 300 m), not a line.

Other maps were looked at and are NOT changed: Megara 94 → 93, Penteli 96 → 94, Psychiko 694 → 674 calls at their corner pose (the far cull is gated to Riviera in
`src/main.js`: below 3% there, and the mountain backdrops of Megara and Penteli are part of their look). Psychiko's 600+ calls are a separate problem.

Cost of the cull itself: 817 managed meshes, 0.06-0.5 ms per update at 1x (every 6 frames).
