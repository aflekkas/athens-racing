# High500 variance follow-up — source-only preparation

The original `after.json` remains FAILED and unchanged. No overall visual/budget acceptance is claimed. The original High500 delta is +18 calls/+798 triangles both On and Off; its cause remains unestablished. `&notraffic` had no consumer in standalone Athens and did not disable traffic.

## Proposed separate pair (requires a new parent browser grant)

Run two sequential navigation jobs, at most 90 seconds each, through browser-slot, High only and case `500-surface`. Set `TERRAIN_CASE_IDS=500-surface`, `TERRAIN_CLASSES=high`, `TERRAIN_DEADLINE_MS=90000`, and use a new `.scratch/terrain-material/high500-variance/` output folder. Preserve all original reports/photos. The harness now refuses to overwrite an existing phase receipt. The entire canonical cases file stays unchanged (1ed8de1f414891265145f60bdeb2e7a50366c803b09cdd9cb9bab7f790abede6), as do camera, world80055 and exact served manifest a6ea9d0c3981e5f3111b375f4ebb1f0e47785bd2a46e2acc2617671033510293.

Before: complete runtime from 36c020b87be7d762e87858b904561b9c2a676e8a. After: complete runtime from 547630c70b9d7bc4a497cceeaffeb0015d2eb4cd. Both are reconstructed from immutable Git blobs (all src files plus index/style), not a module overlay or full archive. `variance-source-fixtures.json` records every file hash and exact paths. Only athens-materials.js differs. Existing immutable assets and authenticated SHA-cell caches are reused read-only via the existing GET-only helper; no downloads or cell copies. Before launch, the harness verifies all 416 source blobs and HTTP manifest/source pins again.

## Proof-only protocol delta

Publicly pause from zero simulation elapsed. With sparse camera layers during admission only, call native activateFrame and render(0) until all nine surrounding cells are active, ground.ready(v,1/240) and loading opacity zero. Native session/stream updates remain active. Then unpause and require exactly 24 successful 1/240 physics steps, activating/rendering every eight steps. Stop on the first held/failed step. Restore camera layers and prior public pause in finally. All photos/compile/GPU samples use restored layers and native render(0). No physical flags, source injection, traffic/pool/RNG changes, material hiding, or render callbacks are installed.

After each final fresh native frame, read renderer.renderLists.get(scene,0). Record each draw object, material/cache key, draw range/group intersection, instancing, nominal triangle count, and NPC-root ancestry; also active/visible NPC id/model/type/pose/edge and their draw contributions. This is scene-list accounting, explicitly separate from renderer.info whole-frame totals including postprocessing. Existing strict calls/triangles/resource guards, packet/foreground limestone picks, nine-cell/source identities, full-scene compile On/Off, camera and color-space checks stay intact. No attribution of the prior variance is made until this inventory exists.

## Source-only verification

Codex gpt-6.1-sol implemented the harness and synthetic checks. `node --test tools/athens-materials.test.mjs`: 9 PASS, 0 FAIL, 0 SKIP. The tests execute the actual readiness function against delayed admission schedules (1/4/11 activations), reject nonzero initial elapsed and held physics, and verify layer/public-pause restoration. Native-list accounting is tested with grouped ranges, instancing caps, double-sided transparent passes and NPC ancestry. A temporary loader negative control restores premature unpaused stepping: the selected readiness test produces 0 PASS / 1 FAIL as expected. `node --check tools/terrain-material.browser.mjs` passes.

No browser, proxy/server, GPU, archive or full suite was launched for this preparation. The next pair is pending a specific parent allocation. No new visual PASS or performance claim.

## Storage/cleanup

Disk before preparation: 49% (70G used / 75G free). Complete small fixtures are intentionally retained only in the existing task temp `/tmp/athens-terrain-material.sBHJ/paired-source` (~9.9 MB combined) for the requested future pair; all shared dependencies/assets/caches stay read-only. No running or queued process was left. Final cleanup remains pending completion of that allocated proof.
