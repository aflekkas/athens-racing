# Baked building depth costs

Baseline: `a6471544e888cdd5bfd107ec6c2cae075fd84990`. Tested code candidate: `7e102fb8009ecf226b0cc5d1dfad58015b0600fe` (before the final evidence-only additions).

Both phases use the same candidate archive, with the baseline building source for before. The baseline building module is unchanged from `239defc`, verified against the parent above. The browser generates the candidate colours using the same terrain heights, asserts exact position/normal buffer equality, then swaps only colours in one frozen scene. Camera poses and full-scene counters are in `.scratch/realism/paired-report.json`.

## Building resource cost

| Map | Calls before → after | Triangles before → after | Geometry bytes before → after | Texture bytes before → after | Bake loop median ms | Full build median ms before → after |
|---|---:|---:|---:|---:|---:|---:|
| riviera | 23 → 23 | 10688 → 10688 | 1410816 → 1410816 | 0 → 0 | 0.607 | 75.380 → 67.377 |
| penteli | 7 → 7 | 212 → 212 | 27984 → 27984 | 0 → 0 | 0.016 | 0.561 → 0.589 |
| megara | 1 → 1 | 164 → 164 | 21648 → 21648 | 0 → 0 | 0.012 | 0.352 → 0.383 |
| psychiko | 28 → 28 | 78044 → 78044 | 10301808 → 10301808 | 0 → 0 | 3.987 | see separate cold-build audit |

The added rendering cost is zero: existing colour values change in place. There is no new per-frame JS, attribute, texture, material, geometry or rendering pass. Flat height sampling isolates the CPU building generator from terrain interpolation. The direct-loop microbenchmark uses the generated vertex counts/buffers with representative bounds. Alternating paired full-build samples and bake-only p95 are retained in `costs.json`; shared-host preemption and garbage collection make high-percentile/full-build timing noisy. These are startup CPU costs, not SwiftShader GPU frame-time claims.

Full-scene texture accounting estimates uncompressed RGBA bytes and mipmaps for material textures, excluding framebuffer attachments and driver overhead. The changelog WebP is a release-note asset, not a world texture.

## Scope

Brighter roofs, 15–35% linear-RGB directional wall darkening and a further 16% wall-base attenuation, interpolated over existing triangles. A fixed south-west modelling cue remains through day/night; this is not physically accurate occlusion or a narrow contact shadow. No new contact-ring meshes, projected polygons, lights, window atlases, reflections, post effects or motion effects. Existing car blobs are retained. The helper is documented for offline Athens tiles in `docs/realism-tricks.md`.

## Visual review and gates

All 32 screenshots (16 pairs) were captured and visually inspected using `review-pairs-1.webp` through `review-pairs-4.webp`. Riviera start/mid, Penteli mid and Megara overview cover day/night and chase/cockpit. Every pair has identical camera transforms, full-scene draw calls, triangles, geometry bytes and estimated texture bytes; shadow maps are disabled. Penteli mid and Megara overview contain little or no visible building frontage, so these views mainly verify preservation of the sparse world. Riviera shows the subtle base/face shading.

All six required release gates passed on the isolated candidate archive: npm test, physics regression, events, syntax, browser imports, and staging deploy dry run (no deployment). Logs and exit markers are in `.scratch/realism/gates/`. The final screenshot-harness fix removes a needless simulation step after map switches; release-image checks also passed after replacing the preliminary WebP.

Psychiko landed concurrently and uses the same `buildBuildings()` helper. Its additional resource audit (`psychiko-costs.json`) is unchanged at 28 building draws, 78,044 triangles, 10,301,808 geometry bytes and zero texture bytes. The single cold-build times in that file are diagnostic only, not a speed comparison. Its street-circuit ground conditions are preserved in the separate rain/splash integration.

Final six-gate validation passed on `f663fe34f9fd810c4a331c062489687a228b2dd9`, based on Psychiko-integrated `f525f45`; logs are in `.scratch/realism/current-building-gates/`. The final rebase also preserves the subsequent independent tyre-grip HUD removal. No building implementation changed during that rebase.
