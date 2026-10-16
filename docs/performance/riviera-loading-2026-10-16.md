# Riviera loading investigation, 16 October 2026

Live staging and production both reported `/release.json` SHA `8af1aef`, build
`2bb3d70651d3`, version `2026.10.15.3`. The staging HTML and `/sw.js` manifest
also agreed on that build. `/version.json` is not an emitted endpoint (404).
No authentication, deployment, credential, service-worker policy, map geometry,
terrain, nearby wheel-contact surface, roundabout or airborne code was changed.

## Measured cause

The shared native T3 browser reproduced a cold staging Riviera visit sitting at
“BUILDING TERRAIN · 25%”. This percentage is a phase milestone, not downloaded
bytes. `loadMap` starts `loadBakedWorldData` before HUD/sky work; `buildMapWorld`
then awaits it behind that label. The old loader always tried worker generation
before the release's already-built terrain/road packs on a cache miss.

- Cold worker: **65,559.7 ms** total: map 238.9 ms, terrain 16,630.9 ms, roads
  48,384.7 ms. Buffer load 66,240.1 ms; decoded geometry 151,809,686 bytes.
- Warm existing IndexedDB generation cache: **1,095 ms**, with no generation.
  Its saved `workerTimings` describes the original cold generation, not this hit.
- Same live release, existing `?bakedownload` path: **2,885.9 ms** buffer load,
  35,902,203 compressed bytes, 232.9 ms buffer decoding, 330.7 ms shader compile.
  One-map setup completed in 10.66 s with recurring game rendering paused.
- Live lighter-map comparison: Megara packs 1,386,528 bytes, **388.3 ms** buffer
  load, 2.47 s total map swap. The previous Riviera world detached/disposed.
- Patched local bundled client using the exact live Riviera map and baked bytes:
  **1,810.9 ms** buffer load in the first run. Download counts advanced visibly;
  map setup completed in 12.80 s. The final locally emitted service-worker build
  completed buffer load in **2,267.1 ms** and setup in **11.29 s**.
  A repeat load through that service worker took **3,113.7 ms** for buffers
  while the full archive test suite was using CPU. Both exact content-addressed
  gzip packs were verified present in `asr-content-v1`; it never regenerated.

The original map JSON and terrain downloads took about 399 ms each; all observed
world/map requests were HTTP 200. There were no world-load exceptions. Expected
Three warnings concern cloned render-target textures and the absent parallel
shader-compile extension. No failing asset, serialized terrain/road transfer, or
release/cache mismatch explains the 65-second worker wait.

Native browser renderer: **ANGLE Vulkan SwiftShader**. Do not interpret these
numbers as desktop GPU performance. On the ungated original run the first
software-rendered frame caused a 20.8-second main-thread task after readiness;
a warm direct run reported a 37.4-second first-frame proxy. That is distinct from
the 65.6-second worker computation. Later phase comparisons suppress only the
recurring named game `frame` callback; actual world construction, texture upload
and shader preparation still run. Main-thread scenery/traffic construction still
contains roughly 2–5 s tasks on this VPS; this patch does not claim to eliminate
those or improve racing FPS. Raw observations accompany this report in JSON.

## Implementation and recovery evidence

Cold packaged loads now fetch the two existing exact build packs in parallel.
Existing valid generated caches stay usable; download failure/corruption falls
back to the existing worker, and the existing runtime generation path remains.
The download deadline aborts both HTTP lanes after 45 seconds. No geometry is
simplified or omitted; the existing full Riviera bake equality/contact tests
continue to exercise the same data. Download/inflate timing is summed across
parallel lanes and can exceed elapsed buffer-load time.
The legacy `downloadBytes` metric counts compressed response-body bytes,
including reads served from cache. Service-worker resource timing can report
zero `transferSize` even on a cache miss; it is not proof of zero network use.

The loading screen shows actual transferred MB and explicit texture-upload and
shader stages. Progress cannot move backwards when preloading overlaps later
builders. After eight seconds it shows elapsed wall time and a shared-component
“RETURN TO MENU” action. Replacing the document safely stops outstanding work.
The percent is never advanced by a timer.

A controlled native-browser recovery test held just the two world responses.
At eight seconds the screen showed “DOWNLOADING TERRAIN + ROADS”, 25%, elapsed
time, and the return action; clicking it navigated to a fresh `?menu=1` title
screen. The release screenshot is this real UI under that controlled network
wait; it contains no diagnostic overlay. The same control supports Enter/Space.

## Validation

- 12 focused loading/cache/deadline/recovery/detail-budget tests passed.
- Separate physics regression: **1,146 passed, zero failed**.
- Syntax and browser import-graph checks passed.
- Clean committed-archive `npm test`: **PASS in 338.9 s**; unit, damage,
  physics and world groups all exited zero. The full Riviera bake equality,
  Riviera/Psychiko rendered terrain and wheel/shoulder scans passed. Events
  and ghost-lap checks also passed. The validation archive is commit `2c42ff8`;
  the subsequent amendment adds only the final evidence and results here.
- Bundled production-style browser exercised Riviera and Megara, and the native
  long-load recovery click succeeded.
- The first worktree-wide test attempt encountered the map-world source-hash
  guard during intermediate edits; those optional builder edits were removed,
  and the unchanged world-detail budget guard now passes. It also exposed the
  repository's existing all-history author check (`muse`, `Codex` absent from
  CREDITS). The committed-archive release validation avoids unrelated branch
  history, as the deployment workflow requires. No guard or tolerance was edited.

Local logs are under `.scratch/riviera-loading/`: `archive-test.log`,
`focused-tests.log`, `physics-regress.log`, `events.log`, and `ghost.log`.
No push, deploy, secret change, auth change, additional browser system or
delegated agent was used. The native browser tab and local preview server were
closed after measurement; the implementation worktree's index was isolated.
