# Menu review corrections

The existing layout is retained. The static white Carrera asset is removed; the hero uses the actual selected CarModel, full trim name and saved paint. Garage, hero and READY TO DRIVE share that identity. Two paint-heavy trims, convertible, bus and motorcycle were selected through the real garage confirmation flow; all identities match (review-validation.json).

The studio starts after two animation frames and an idle callback, through a dynamic import. Menu interaction never awaits it. Browser QA blocked that module, activated PLAY, and verified cancellation without allocating a map world. The studio renders on demand, with environment reflections, warm key/teal fill, tinted glass, wheel materials, fixed detailed LOD and roof/window clipping for closed-car seats. It releases its renderer/model on leaving the title. No full map is loaded.

Local badge is DEV only; staging remains STAGING · version, production has no badge. The local footer no longer repeats DEV. Environment and keyboard/gamepad tests pass.

## Final exact-snapshot A/B measurements

Before: 9d6d58d069b3c60355d2c2d0eecf738230f3cfee. After: 2b98a01d24d9cdf1ec14ad8583b5dc81bfabd5c3. Five pairs, AB/BA/AB/BA/AB, one Chromium job and browser slot (see final-ab/run.log for slot/ticket), same local server and dependency mirror. 20 raw cold/warm observations in final-ab/ab-performance.json. This additional run validates the final combined source, superseding the isolated patch performance figures below. Shared-host warm timings remain noisy. No interactive cold regression is observed; painted cold median is 34.6 ms higher. The hero cannot block interaction, as demonstrated with its module deliberately held pending.

Median milliseconds; transfer bytes measured at painted menu:

| Variant | Cache | Interactive ms | Painted ms | Transfer bytes |
|---|---|---:|---:|---:|
| before | cold | 865 | 938.7 | 4343203 |
| before | warm | 7680.9 | 7727.6 | 9259 |
| after | cold | 829.1 | 973.3 | 4341027 |
| after | warm | 2894 | 2960.6 | 9259 |

Cold bytes: 4,343,203 → 4,341,027. Warm bytes: 9,259 → 9,259. All 20 samples have zero maps/worlds, zero map requests, and zero main-world geometries/textures.

## Interleaved A/B measurements

One Chromium browser job/slot, five pairs per baseline, alternating AB / BA / AB / BA / AB. Each variant has cold and warm runs; 40 raw observations in ab-performance.json. Cold uses cleared browser cache; warm reloads after the prior hero settles. Same local server and Three mirror, auth configuration fixture and guest setting on both sides. A first-title DOM MutationObserver records interactive time; two animation frames record painted-menu time. The hero is never awaited for either measurement. These shared-host observations show no regression; warm samples remain noisy.

Original baseline: 2109e25. Reviewed static-hero baseline: 9d6d58d069b3c60355d2c2d0eecf738230f3cfee. After is the isolated correction patch based on 9d6d58d. Later integration includes concurrent prod work; the final post-paint material guard does not affect menu timing.

All values are median milliseconds, except transfer bytes (at the painted-menu observation).

| Baseline | Variant | Cache | Interactive ms | Painted ms | Transfer bytes |
|---|---|---|---:|---:|---:|
| original | before | cold | 1115.9 | 4685.1 | 4231518 |
| original | before | warm | 10140.8 | 10260.2 | 9409 |
| original | after | cold | 965.3 | 1031.6 | 4317604 |
| original | after | warm | 4715.9 | 4825.3 | 9259 |
| reviewed | before | cold | 949.8 | 1056.7 | 4343203 |
| reviewed | before | warm | 7925.1 | 7973.7 | 9259 |
| reviewed | after | cold | 716.7 | 771.5 | 4317604 |
| reviewed | after | warm | 2492 | 2558.7 | 9259 |

Every measurement has zero worlds, zero map requests, and zero main-world geometries/textures. Deferred studio resources are separate; across 30 entries: {'geometries': [66, 333], 'textures': [4, 9], 'drawCalls': [66, 333]}. Those allocations happen only after the menu has painted. The old static hero image is no longer transferred. Transfer totals include the local Three dependency; warm totals are largely the application HTML. Timing of the deferred import can change bytes observed at paint.

## Visual evidence

Inspected after/menu-1920.png, after/menu-1280.png and after/menu-390.png; hero-sheet.png contains all 30 garage entries at default paints. selected-*.png additionally proves custom paint and non-default trim round trips. before/ retains the original title screenshots. The low-poly models remain visibly procedural and the contact shadow is hard; this is not photorealistic showroom rendering. Paint reflections and glass now read, closed-car seats are contained, and bus/bike framing fits.

## Validation provenance

Final combined source snapshot: 2b98a01d24d9cdf1ec14ad8583b5dc81bfabd5c3, archived from Git for every required gate. This incorporates concurrent shared menu/release changes rather than replacing them. Full npm, physics, events, syntax, browser imports and staging dry-run logs are in review-gates/. Final browser evidence uses this combined source. The snapshot is an immutable unreferenced commit object; publication happens only after checks pass. Previous diagnostic gate snapshots 9936bb6 and 1fe55e8 are superseded by this combined validation.

A subsequent concurrent legal-links addition in About/Credits was preserved with a clean three-way merge. Final menu tests, syntax and browser-import checks passed on clean archive 0cdeccacf3961674b2d9051fb36d748ce65e29ca (publication-check.log). Title/hero implementation and final A/B source remain unchanged.
