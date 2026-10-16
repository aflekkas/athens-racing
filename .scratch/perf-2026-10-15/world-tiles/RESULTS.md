# World tiles: contract and runtime foundation

2026-10-15. This is an incremental foundation, **not milestone-1 acceptance**. No default gameplay activation or startup/residency reduction is claimed by this step. AWT/1 draft and validator were committed first in `8a528da57b7468a68f4af829adb216d5e64aa77f`, refined in `af89d7a9d1a6dc4bce0488759e838057fa2bf39d` (bounded edge-hash validation and concave outlines <=40 triangles).

The initial full-suite clean archive baseline is `f1dd16cf1610dc75841e6db65235dbb2f5b9fef8`. The bundler was rebased onto concurrent green frame-pacing commit `9e5e85f9b7cccf4ba907a87672250051029d9430`, preserving its ragdoll-worker publication. The final archive is rebased onto `5c72f29b95fc8b5eda05b5f3299da484715e0c02` (including the owner simplification). Its full npm suite, 433 physics checks, events, syntax, imports and staging dry run all passed (`gates-owner/`). Earlier rebased focused/physics/events/syntax/import/dry-run checks passed; the final runtime suite has 17 passing tests. The added library has no imports from the game entry point and creates no worlds at menu boot. Required release gates are run against this archive plus the enumerated runtime files with a private candidate, not the shared checkout. Commit generation uses a private index; no shared index/working-tree mutation, push or deploy.

## What is implemented

Worker fetch, declared-length and SHA-256 validation, gzip/shared ASR decoding, typed CSR contact indexes, worker-calculated bounds, layered contact queries, ring/velocity prefetch, bounded concurrency and byte reservations, cancellation/version races, explicit retry, frame-budget activation iterators, reference-counted shared materials, LRU eviction, pinned spawn/tow and target readiness, tile-local rendering, 512 m origin rebasing. Directed graph ownership, speed-weighted routing and turn/access restrictions are available separately. Final deployment inventory enforces 20000 files and 25 MiB/file, including immutable copies.

No fork of the ASR codec. The schema and runtime call `src/baked-geometry.js`. The new triangle streams use existing typed-array infrastructure. No tile textures, trees or beach props are introduced by the format/library.

## Browser lifecycle evidence

`browser-worker-runtime.json`: actual browser module workers, gzip/SHA verification, three.js scene construction and disposal. Synthetic 40-cell flat terrain fixture, 80 teleports, logical X extends beyond 40 km. Browser job ran through `tools/browser-slot.sh`.

- Unavailable sampled contacts: 0. Worker errors: 0.
- Max measured activation step: 0.5 ms; activation steps >50 ms: 0.
- Downloaded tile bytes: 24272.
- Peak accounted resident bytes: 864200; peak resident plus reservations: 2853327.
- 40 active geometries share one material. After disposal: 0 geometries, 0 materials and 0 accounted resident bytes.

This verifies a small worker/scene lifecycle; it is **not** evidence of actual Athens startup transfer, vehicle contact safety, a twenty-minute browser driving plateau, or production timing. SwiftShader GPU timings are excluded. A second real-browser fixture under a 512 KiB residency cap completed 183 evictions with zero unavailable sampled contacts, peak accounted resident 345680 bytes, resident plus reservations 411937 bytes and max object-activation step 0.6 ms. Disposal again returned geometry/material/resident counts to zero (`browser-cap-runtime.json`).

No product-visible change was made in the foundation commit, so there are no before/after game screenshots for this step.

The deterministic scheduler unit test covers twenty *simulated* minutes with high-speed interests and repeated teleports under an injected byte budget. Structural tests exercise corrupt downloads, missing neighbours, layer separation, disposed/stale jobs, pins and disposal. These do not replace real driving gates.

Object construction is frame-budgeted; explicit GPU upload staging and dense-map long-task validation remain follow-up work. These fixtures do not claim that all actual map activation/upload work meets the final 50 ms gate.

## Migration status

The existing-map converter is a separate, still-gated follow-up. Early runs incorrectly included inactive legacy LOD ranges; they are not acceptance measurements. Subsequent conversion selects the finest active range, shares canonical boundary heights, inserts adaptive border vertices into both render/contact topology, and uses indexed arrays/shared codec compression.

`surface-neighbourhood-metrics.json` compares real decoded/indexed surface buffers offline: Riviera startup 29333217 → 5713239 bytes and residency 316119079 → 47894241 bytes; Megara startup 1064242 → 1049825 and residency 9425592 → 9913515 bytes. These exclude legacy map/DEM/scenery and browser timings, and are not total-map acceptance. Penteli still has rejected seams.

`migration-intermediate.json` is retained as diagnostic evidence, not a performance win. The final release must still satisfy all three-map startup, residency, time-to-control, collision, seam, AI/tow/police/multiplayer/replay and real-time stress requirements before default activation. Legacy map/DEM/scenery retention must also be removed before claiming tile-only Athens loading.

## Hosting and cost

The earlier research inventory was 1336 files / 182780523 bytes. The rebased dry run reports 1366 physical packaged assets / 190136696 bytes; Wrangler reports 1398 served entries. Largest file: 19689626 bytes, below 25 MiB. Both counts are well below 20000. Even 443 individual three-map tile cells plus immutable duplicates add fewer than 900 files, well below 20000. Whole-Attica's measured 10664 occupied cells would exceed the cap if every tile were duplicated; pack <=24 MiB regional bundles before that expansion. R2 is not necessary for the existing maps or measured Athens-basin cell count.

Planning traffic at 10 MiB/player/month is 0.98 / 9.77 / 97.66 GiB for 100 / 1000 / 10000 players. Static-asset delivery is free/unlimited under Cloudflare's published pricing (links in the format document), conditional on asset-first routing. Current `run_worker_first:true` still invokes the dynamic Worker for assets; the static bypass must be verified before claiming unrestricted $0 delivery. Accounts/multiplayer are excluded. Generated bytes/km², startup transfer, residency reduction and cold/warm control times remain separate acceptance measurements.


Final physical deployment inventory is in `deployment-inventory.json`: 1337 files, 185474873 bytes, largest 19689626 bytes. This replaces the earlier inventory for the owner-simplified build.
