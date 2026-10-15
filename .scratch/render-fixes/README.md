Riviera rendering fixes
======================

Code: `34c70167aa2884e170529ba76e6d31e02a083b37` (includes `0b078492`, `ac203294`, `fd1fdc3a`). Baseline: archived production `21771a1`, build `98d0ea0f`. No push or deployment performed.

Findings and changes
--------------------

1. The terrain budget replaced narrow dry beaches outside the road corridor with 40 m triangles. These interpolate below the water plane even where the original 10 m DEM is positive. This is geometry loss, not a failed sand texture, reversed normal, shadow cascade, or missing material. At world X/Z `(497.2,2810.8)`, actual rendered Y changes from `-1.254421` to `+0.543978` with water at zero. Preserve mapped beach extents and dry sand cells at DEM resolution, aligned with complete coarse cells to prevent overlap; pass the same beach mask through runtime, worker and bake paths. The source terrain and water/render paths in 21771a1 match the pre-fix current source (see source-comparison.json).
2. Props used detailed DEM heights even when the emitted mesh was coarse; sunbeds also reused the umbrella origin height despite their offset. At the actual lounger `(6727.630859,3021.921143)`, the old mesh is `-1.092925` while placement is `+0.651430`. The fixed mesh is `+0.653430`. Contact queries now reconstruct the emitted final triangles, including omitted cells, lowered seams and their actual index diagonals. Beds sample their own four corners and tilt to the ground, their slab bottoms rest at zero local height, and beach people sample their own position.
3. The sun already uses a fixed-size texel-snapped frustum; there are no cascades to switch. AO rotated a sparse sampling kernel every frame without temporal accumulation, and DOF also changed sample locations. Both seeds are now spatially stable. With identical geometry/light and only post time changing, the archived AO changes roughly 42,000/64,000 pixels (maximum about 200/255); fixed AO changes zero pixels in both comparisons. Existing quality settings, texture anisotropy and intentional film grain remain intact.
4. A matching long road band is a real 9.5 m streetlight pole shadow. A ray from the road towards the sun intersects pole instance 0 at station 154.309; the band disappears when only that caster is disabled. Kept the real shadow. This diagnoses a matching band, not an exact reconstruction of the user's unknown pose.

The exact near-black Mac tone did not reproduce with software WebGL: the old flooded beach appears blue/foamy here. The submerged geometry and floating props reproduce in the actual archived build, and the fixed dry shore occludes the water at the same overhead pose. Mac Chrome/Safari colour matching remains unverified.

Evidence
--------

All files are relative to this directory. Conditions: afternoon, clear, Huracan with default orange paint (the user’s green paint was not reconstructed), 640x400 fixed resolution, Chromium/SwiftShader, no traffic. Camera and simulation fixtures are in camera-poses.json. Camera poses and weather are chosen reproductions; the user's exact play state is unavailable.

- Same-pose old/fixed overhead: [old-production-21771a1/high-overhead.png](old-production-21771a1/high-overhead.png), [after-optimized/high-overhead.png](after-optimized/high-overhead.png); Low/Medium/High stills and water/shadow isolation shots alongside them.
- Actual organised beach with loungers: [after-verified/beach-loungers-overhead.png](after-verified/beach-loungers-overhead.png); numerical old/new contacts in root-cause.json and bed-scan-before/after.json.
- Same-pose chase views: [old-production-21771a1/road-chase.png](old-production-21771a1/road-chase.png), [after-verified/road-chase.png](after-verified/road-chase.png).
- Driving: both folders contain `drive-0.png` through `drive-7.png`, `drive.json`, and `drive.mp4` (10 fps, six 1/60 s physics steps per frame). Station/speed sequences match, starting at 43.17 km/h. Orbit evidence: `orbit-0.png` through `orbit-2.png`. The sequence is a short visual check; the AO time-isolation result is the direct flicker regression measurement.
- Pole diagnosis: [after-verified/pole-band.png](after-verified/pole-band.png), `pole-band-caster-off.png`, `caster-diagnosis.json`.
- AO measurements: [old-production-21771a1/ao-temporal.json](old-production-21771a1/ao-temporal.json), [after-verified/ao-temporal.json](after-verified/ao-temporal.json).

`after-verified` was captured after shoreline/post/prop changes and before ocean ordering; `after-optimized` includes ocean ordering. The later coarse-diagonal fix affects contacts on coarse terrain; these beach fixtures use the preserved fine terrain. The code and clean-archive validation hashes are recorded in validation.json.

Performance
-----------

GPU-finished synchronous render wall time (four warmups, 12 samples/preset), excluding simulation and DOM. Draw ranges include mirror/reflection cadence. Same overhead fixture, fixed 640x400 resolution. Raw samples are saved as perf.json in each capture folder.

| Preset | 21771a1 median ms | Fixed median ms | Draws before | Draws after |
| --- | ---: | ---: | --- | --- |
| Low | 17.60 | 18.60 | 85 / 164 | 86 / 166 |
| Medium | 17.30 | 17.75 | 97 / 187 | 98 / 189 |
| High | 14.70 | 16.35 | 130 / 348 | 131 / 351 |

These are noisy shared-VPS SwiftShader measurements, not hardware fps. The measurements do **not** establish hardware performance non-regression: median differences are +1.00 / +0.45 / +1.65 ms, while individual samples vary much more. An additional same-scene ABBA experiment changes only ocean render order (24 samples/order/preset): median old/new is 16.50/13.25 ms Low, 10.65/14.75 ms Medium, 21.45/18.65 ms High. Its mixed result reinforces the timing limitation. Raw data and pixel differences are in after-optimized/water-order-*.json. Image channel mean differences are below 0.005/255 across all presets (a few edge pixels and cadence-dependent mirror pixels differ).

The retained fine beach adds one visible terrain draw, or two to three including mirror passes. The opaque ocean now renders after opaque land so land depth can reject hidden ocean fragments; quality and anisotropy presets are unchanged. The actual old release used fixed anisotropy 8, while the current preset system uses 2/4/8; the same-scene ABBA comparison keeps these current settings fixed. Hardware profiling on Mac Chrome/Safari remains needed before claiming a frame-time non-regression.

Validation and reproduction
---------------------------

All required checks passed on a clean git archive of code commit 34c7016: detached npm test; physics regression (426 passed, zero failures); events; syntax (253 modules); browser imports (203 modules); staging Wrangler deployment **dry-run**. Focused surface regression tests passed (both emitted diagonals, omitted refined cells, fitted bed corners). Exit markers and logs are in gates/. The focused Riviera road/shoreline sampling log is shoreline-focused-final.log. No push or real deploy occurred.

Evidence harnesses: tools/render-fixes-browser.mjs (`release-pair`) and tools/render-fixes-water-perf.mjs (`after-optimized`), through tools/browser-slot.sh. They run in a private archive, serve the old release from `/tmp/render-fixes-21771a1` created with `git archive 21771a1`, inject main-capture-hook.js into served main.js, expose AO only in the served post.js, freeze the normal RAF, and capture directly from the canvas. Production main.js is unchanged. Install Playwright separately at `/tmp/pw` and set the Chromium path in the harness for another environment. The CDN route serves the installed Three 0.170.0 package. Use a private dependencies link/install, never mutate the shared checkout. Encode clips using `ffmpeg -framerate 10 -i drive-%d.png -c:v libx264 -pix_fmt yuv420p drive.mp4`.
